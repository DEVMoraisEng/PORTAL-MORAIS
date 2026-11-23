# -*- coding: utf-8 -*-
"""Distrato de venda lançada À MÃO no Mais Controle (pedido do dono, 23/11/2026).

O distrato do portal só mexe no ERP quando a casa tem "MC - VENDA ID" (venda lançada pelo robô). Venda lançada à mão
ficava ativa depois do distrato, sem " (Distrato)" — e o robô do sinal via essa venda como "já existe" e não lançava o
novo comprador (casos de 21 e 22/10). Esta varredura diária olha só os arquivos da base DISTRATOS (casa de rua) com
"SEM VENDA NO MAIS CONTROLE" e procura a venda pela CASA (obra + número da casa na descrição), deixando de fora a venda
do comprador ATUAL da casa e as que começaram depois do distrato.

O que faz com o que achar (regras do robô de distrato, distrato.plano):
 - uma venda e o distrato só pede marcar a descrição (sinal recebido, nada em aberto) -> APLICA: descrição + " (Distrato)";
 - já marcada -> só anota;
 - excluir a venda, remover parcelas em aberto, devolução, ou mais de uma venda -> NÃO mexe no ERP: escreve
   "ATENÇÃO: ..." em MC - DISTRATO para alguém fazer à mão (a regra de 07/10 pede prévia vista para isso).
Cada arquivo é tratado uma vez: o texto novo em MC - DISTRATO não começa mais com "SEM VENDA NO MAIS CONTROLE".

Gravar (Notion e ERP) só com --aplicar (no servidor: _central\\ROBOS_APLICAR.txt). Sem ele, só conta.
Ambiente: NOTION_TOKEN, MC_VIA=porteiro; DB_DISTRATOS e DB_VENDAS opcionais (padrão: as bases de produção).
O stdout leva só contagens e códigos. Repositório público: nenhum dado real nos testes."""
from __future__ import annotations

import argparse
import datetime as _dt
import difflib
import json
import os
import sys

from . import distrato as D
from . import regras as R
from .erp import ErpErro, do_ambiente, faltam_segredos

DB_DISTRATOS_PADRAO = "3f3c5ab532d38100b62fdcfc2e380b3c"
DB_VENDAS_PADRAO = "33cc5ab532d38047ae3aee8b87ac1f4d"
MARCA_SEM = "SEM VENDA NO MAIS CONTROLE"
_FORA = {"DE", "DA", "DO", "DOS", "DAS", "E", "VENDA", "CASA", "CS", "LT", "QD"}


def _tokens(s) -> list[str]:
    return [t for t in R.chave(s).replace(",", " ").replace("-", " ").replace("/", " ").split()
            if len(t) >= 2 and t not in _FORA and not t.isdigit()]


def _parecido(a: str, b: str) -> bool:
    return a == b or (min(len(a), len(b)) >= 4 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.85)


def mesmo_comprador(nome, *textos) -> bool:
    """O 1º e o último nome do comprador aparecem (com erro pequeno de digitação) no cliente ou na descrição."""
    tn = _tokens(nome)
    if not tn:
        return False
    te = [t for x in textos for t in _tokens(x)]
    return all(any(_parecido(p, t) for t in te) for p in {tn[0], tn[-1]})


def vendas_da_casa(recebimentos: list[dict], endereco: str, casa: int) -> list[dict]:
    """[{id, descricao, cliente, inicio}] das vendas desta obra cuja descrição diz esta casa, sem as já distratadas."""
    alvo, por = R.chave(endereco), {}
    for r in recebimentos or []:
        sid = r.get("saleId")
        if not sid or R.chave(r.get("workName")) != alvo:
            continue
        v = por.setdefault(sid, {"id": sid, "descricao": r.get("description") or "", "cliente": r.get("customerName") or "",
                                 "inicio": "9999"})
        v["inicio"] = min(v["inicio"], str(r.get("referenceDate") or r.get("plannedDate") or "9999")[:10])
    return [v for v in por.values() if R.casa_da_descricao(v["descricao"]) == casa
            and "(DISTRATO)" not in R.chave(v["descricao"])]


def _txt(props: dict, nome: str) -> str:
    return D._txt(props, nome)


def decidir(arquivo: dict, recebimentos: list[dict], comprador_atual: str, ler_venda) -> dict:
    """Puro (ler_venda é injetado). {acao: APLICAR|NADA|ATENCAO|LIMPO|PULAR, texto, venda_id?, plano?}"""
    props = arquivo.get("properties") or {}
    if not _txt(props, D.COL_ESTADO).upper().startswith(MARCA_SEM):
        return {"acao": "PULAR"}
    endereco, casa = _txt(props, "ENDEREÇO"), R._casa(_txt(props, "CASA"))
    data = _txt(props, "DATA")[:10]
    sinal, destino = R.chave(_txt(props, D.COL_SINAL)), R.chave(_txt(props, D.COL_DESTINO))
    if not endereco or not casa:
        return {"acao": "ATENCAO", "texto": "o arquivo não tem ENDEREÇO/CASA para procurar a venda no Mais Controle"}
    if sinal not in ("SIM", "NAO"):
        return {"acao": "ATENCAO", "texto": "o distrato não informou se houve sinal — confira a venda desta casa no Mais Controle"}
    vs = [v for v in vendas_da_casa(recebimentos, endereco, casa)
          if not (data and v["inicio"] > data)                                   # começou depois do distrato: é nova
          and not (comprador_atual and mesmo_comprador(comprador_atual, v["cliente"], v["descricao"]))]
    if not vs:
        return {"acao": "LIMPO", "texto": "nenhuma venda manual ativa desta casa no Mais Controle"}
    if len(vs) > 1:
        return {"acao": "ATENCAO", "texto": "%d vendas desta casa no Mais Controle (%s) — faça o distrato à mão"
                % (len(vs), "; ".join("%s \"%s\"" % (v["id"][:8], v["descricao"][:40]) for v in vs[:4]))}
    v = vs[0]
    try:
        pl = D.plano(ler_venda(v["id"]), sinal == "SIM", "RETIDO" if destino == "RETIDO" else
                     ("DEVOLVIDO" if destino == "DEVOLVIDO" else ""))
    except D.Recusa as e:
        return {"acao": "ATENCAO", "venda_id": v["id"], "texto": "venda %s ainda ativa no Mais Controle: %s" % (v["id"][:8], e.texto)}
    if pl["acao"] == "NADA":
        return {"acao": "NADA", "venda_id": v["id"], "texto": "venda %s já estava marcada" % v["id"][:8]}
    if pl["acao"] == "ALTERAR" and not pl["removidas"] and destino != "DEVOLVIDO":
        return {"acao": "APLICAR", "venda_id": v["id"], "plano": pl}
    return {"acao": "ATENCAO", "venda_id": v["id"], "texto": "venda %s (\"%s\") ainda ativa no Mais Controle — o distrato dela "
            "precisa ser feito à mão: %s" % (v["id"][:8], v["descricao"][:50], D.texto_previa(pl)[:600])}


def processar(notion, erp, aplicar: bool = False, hoje: str = "") -> dict:
    hoje = hoje or _dt.date.today().strftime("%d/%m/%Y")
    arquivos = notion.linhas(os.environ.get("DB_DISTRATOS") or DB_DISTRATOS_PADRAO)
    pend = [a for a in arquivos if _txt(a.get("properties") or {}, D.COL_ESTADO).upper().startswith(MARCA_SEM)]
    cont = {"arquivos": len(arquivos), "pendentes": len(pend), "APLICAR": 0, "NADA": 0, "ATENCAO": 0, "LIMPO": 0, "ERRO": 0}
    if not pend:
        return cont
    recs = erp.recebimentos()
    for a in pend:
        props = a.get("properties") or {}
        atual = ""
        pid = D._id_limpo(_txt(props, "VENDA - PAGE ID"))
        if pid:
            try:
                atual = R.dados_da_pagina((notion.pagina(pid) or {}).get("properties") or {})["comprador"]["nome"] or ""
            except Exception:   # noqa: BLE001 — sem a casa, a venda nova não é separada: só ATENÇÃO pode sair
                atual = ""
        try:
            dec = decidir(a, recs, atual, lambda vid: D.ler_venda(erp, vid))
            valores = {}
            if dec["acao"] == "APLICAR":
                texto = D.executar(erp, dec["plano"]) if aplicar else ""
                valores = {D.COL_ESTADO: "%s (venda lançada à mão, achada pela casa em %s)" % (texto, hoje),
                           D.COL_VENDA_ID: dec["venda_id"]}
            elif dec["acao"] == "NADA":
                valores = {D.COL_ESTADO: "CONFERIDO PELA CASA em %s: %s" % (hoje, dec["texto"]), D.COL_VENDA_ID: dec["venda_id"]}
            elif dec["acao"] == "LIMPO":
                valores = {D.COL_ESTADO: "CONFERIDO PELA CASA em %s: %s" % (hoje, dec["texto"])}
            elif dec["acao"] == "ATENCAO":
                valores = {D.COL_ESTADO: "ATENÇÃO (conferido pela casa em %s): %s" % (hoje, dec["texto"])}
            if aplicar and valores:
                notion.gravar_textos(a["id"], props, valores)
            cont[dec["acao"]] = cont.get(dec["acao"], 0) + 1
        except (ErpErro, Exception):   # noqa: BLE001 — um arquivo com problema não para os outros
            cont["ERRO"] += 1
    return cont


def main(argv=None) -> int:
    from .notion import Notion
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args(argv)
    if faltam_segredos(("NOTION_TOKEN",)):
        print(json.dumps({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}))
        return 2
    try:
        c = processar(Notion(os.environ["NOTION_TOKEN"]), do_ambiente(), aplicar=a.aplicar)
    except Exception as e:   # noqa: BLE001
        print(json.dumps({"situacao": "ERRO", "codigo": type(e).__name__}))
        return 1
    print("distratos de venda manual: " + json.dumps(c, ensure_ascii=False))
    return 1 if c.get("ERRO") else 0


if __name__ == "__main__":
    sys.exit(main())
