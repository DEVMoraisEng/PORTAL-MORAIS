# -*- coding: utf-8 -*-
"""Lança a venda de uma casa no Mais Controle a partir da página do Notion.

Uso:
    python -m venda.mc.lancar --page <id>              # PRÉVIA: só lê e mostra
    python -m venda.mc.lancar --page <id> --aplicar    # cria cliente (se faltar) e venda
    python -m venda.mc.lancar --page <id> --bloqueado  # pediram gravar, mas MC_APLICAR está desligado
    python -m venda.mc.lancar --page <id> --marcar-erro "texto"   # o workflow falhou antes do robô

Ambiente: NOTION_TOKEN, MC_ROBO_EMAIL, MC_ROBO_SENHA. Sem --aplicar NADA é
gravado no ERP; o Notion recebe só o texto em "MC - SITUAÇÃO".

Travas:
- só se grava o que foi visto na prévia: a prévia grava uma assinatura [#xxxxxxxx]
  dos valores; o lançamento recalcula e recusa se mudou;
- venda da mesma casa já existente → não cria (e NÃO preenche "MC - VENDA ID":
  pode ser venda antiga de outro comprador, de antes de um distrato);
- venda da mesma obra cuja descrição não diz a casa → recusa e pede conferência.

O log do Actions é PÚBLICO: o stdout leva só a situação e códigos; o texto
completo (com valores) vai só para o Notion."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import regras as R
from .erp import Erp, ErpErro
from .notion import Notion


class FalhaNotion(Exception):
    pass


def processar(page_id: str, notion, erp, aplicar: bool = False, dias: int = R.DIAS_FINANCIAMENTO,
              bloqueado: bool = False) -> dict:
    """bloqueado=True: pediram para gravar, mas o repositório não liberou (MC_APLICAR)."""
    pg = notion.pagina(page_id)
    props = pg.get("properties") or {}
    d = R.dados_da_pagina(props)
    res = {"situacao": None, "codigo": None, "motivos": [], "avisos": [], "pageId": page_id,
           "obra": d["endereco"], "casa": d["casa"]}

    def fim(situacao, texto_notion=None, venda_id=None, codigo=None, obrigatorio=False):
        res["situacao"], res["codigo"] = situacao, codigo or situacao
        valores = {R.COL["situacao"]: texto_notion or situacao}
        if venda_id:
            valores[R.COL["venda_id"]] = venda_id
        try:
            faltou = notion.gravar_textos(page_id, props, valores)
            if faltou:
                res["avisos"].append("COLUNA_FALTANDO")
                if obrigatorio:
                    raise FalhaNotion("colunas faltando: " + ", ".join(faltou))
        except FalhaNotion:
            raise
        except Exception as e:
            if obrigatorio:   # venda CRIADA e o id não foi anotado: o job tem de falhar alto
                raise FalhaNotion(str(e)[:200])
            res["avisos"].append("NOTION_NAO_ANOTADO")
        return res

    if d.get("venda_id_atual"):
        res["venda"] = {"id": d["venda_id_atual"]}
        return fim("JA_LANCADA", "JÁ LANÇADA (venda %s)" % d["venda_id_atual"])

    f = R.faltas(d, dias)
    if f:
        res["motivos"] = f
        return fim("RECUSADA", "RECUSADA: " + "; ".join(f), codigo="FALTAS")

    obras = [o for o in erp.obras() if R.chave(o.get("name")) == R.chave(d["endereco"])]
    if len(obras) != 1:
        m = "Obra '%s' %s no Mais Controle" % (d["endereco"], "não encontrada" if not obras else "repetida (%d)" % len(obras))
        res["motivos"] = [m]
        return fim("RECUSADA", "RECUSADA: " + m, codigo="OBRA_NAO_ENCONTRADA" if not obras else "OBRA_REPETIDA")
    obra = obras[0]
    conta = (erp.obra(obra["id"]) or {}).get("defaultAccount") or {}
    if not conta.get("id"):
        m = "A obra não tem conta padrão no Mais Controle (a conta da venda vem da obra)"
        res["motivos"] = [m]
        return fim("RECUSADA", "RECUSADA: " + m, codigo="OBRA_SEM_CONTA")

    mesma, sem_casa = R.venda_da_casa(erp.recebimentos(), obra["name"], d["casa"])
    if mesma:
        v = mesma[0]
        res["venda"] = {"id": v["id"], "todas": [x["id"] for x in mesma]}
        res["motivos"] = ["Já existe venda da CASA %02d desta obra no Mais Controle" % d["casa"]]
        return fim("JA_EXISTE", "JÁ EXISTE no Mais Controle — venda %s (\"%s\", cliente: %s). Nada foi criado. "
                   "Se for venda antiga (distrato), confira no ERP antes de seguir."
                   % (v["id"], v["descricao"][:60], v["cliente"][:60] or "?"))
    if sem_casa:
        lista = "; ".join("venda %s (\"%s\")" % (x["id"], x["descricao"][:50]) for x in sem_casa[:3])
        res["motivos"] = ["Há venda desta obra sem a casa na descrição"]
        return fim("RECUSADA", "RECUSADA: há venda desta obra no Mais Controle sem o número da casa na descrição — "
                   "%s. Confira no ERP; se for de outra casa, corrija a descrição para \"CASA 0N - NOME\" e peça a prévia de novo."
                   % lista, codigo="VENDA_SEM_CASA_NA_OBRA")

    clientes = erp.cliente_por_cpf(d["comprador"]["cpf"])
    if len(clientes) > 1:
        res["motivos"] = ["CPF do comprador aparece em %d clientes no Mais Controle" % len(clientes)]
        return fim("RECUSADA", "RECUSADA: " + res["motivos"][0], codigo="CPF_EM_VARIOS_CLIENTES")
    cliente_novo = None if clientes else R.corpo_cliente(d)
    res["cliente"] = {"existe": bool(clientes), "id": clientes[0]["id"] if clientes else None}
    if cliente_novo:
        try:
            homs = erp.homonimos(cliente_novo["name"])
        except ErpErro:
            homs = None
            res["avisos"].append("HOMONIMO_NAO_CONSULTADO")
        if homs:
            papeis = ", ".join(sorted({_papel(h) for h in homs}))
            mesmo_cpf = any(R.so_digitos(h.get("cpf")) == d["comprador"]["cpf"] for h in homs)
            res["motivos"] = ["Já existe cadastro com o mesmo nome no Mais Controle (%s)" % papeis]
            return fim("RECUSADA", "RECUSADA: já existe no Mais Controle um cadastro de %s com o mesmo nome do comprador%s, "
                       "e o ERP não aceita dois com nome igual. %s Depois peça a prévia de novo." % (
                           papeis, " e o mesmo CPF" if mesmo_cpf else "",
                           "Abra esse cadastro no Mais Controle e marque também como Cliente."
                           if mesmo_cpf else "Confira se é a mesma pessoa: se for, marque o cadastro também como "
                           "Cliente e ponha o CPF; se não for, diferencie o nome de um dos dois."),
                       codigo="NOME_JA_CADASTRADO")

    vendedor_id = None
    if d.get("corretor"):
        try:
            vs = erp.participante_por_nome(d["corretor"])
            if len(vs) == 1:
                vendedor_id = vs[0]["id"]
            else:
                res["avisos"].append("CORRETOR_NAO_ACHADO")
        except ErpErro:
            res["avisos"].append("CORRETOR_NAO_CONSULTADO")

    corpo = R.corpo_venda(d, obra, res["cliente"]["id"] or "(CLIENTE NOVO)", conta,
                          responsavel_id=getattr(erp, "user_id", None), vendedor_id=vendedor_id,
                          dias_financiamento=dias)
    assin = R.assinatura(corpo, d["comprador"]["cpf"])
    res["corpo_venda"] = corpo
    res["parcelas"] = [{"rotulo": p["rotulo"], "valor": p["valor"], "data": p["data"]}
                       for p in R.parcelas(d, dias)]
    resumo = "; ".join("%s R$ %.2f em %s" % (p["rotulo"], p["valor"], p["data"]) for p in res["parcelas"])

    if not aplicar:
        return fim("PREVIA", ("BLOQUEADO: gravar no Mais Controle está desligado neste ambiente (MC_APLICAR) — "
                              if bloqueado else "") + "PRÉVIA OK [#%s] — %s%s; conta da obra: %s%s; %s" % (
            assin, "cliente novo será criado; " if cliente_novo else "cliente já existe; ",
            corpo["description"].split(" - ")[0], conta.get("name") or conta["id"],
            "; vendedor: corretor" if vendedor_id else "", resumo),
            codigo="BLOQUEADO" if bloqueado else "PREVIA")

    vista = R.assinatura_da_situacao(d.get("situacao_atual"))
    if vista != assin:
        res["motivos"] = ["Os dados mudaram depois da prévia"]
        return fim("RECUSADA", "RECUSADA: os dados da venda mudaram depois da prévia — peça a prévia de novo e confira.",
                   codigo="PREVIA_DESATUALIZADA")

    if cliente_novo:
        criado = erp.criar_cliente(cliente_novo) or {}
        if not criado.get("id"):
            res["motivos"] = ["O ERP não devolveu o id do cliente criado"]
            return fim("ERRO", "ERRO: cliente não confirmado — confira no Mais Controle antes de repetir",
                       codigo="CLIENTE_SEM_ID")
        corpo["customer"] = {"id": criado["id"]}
        res["cliente"] = {"existe": False, "criado": True, "id": criado["id"]}
    venda = erp.criar_venda(corpo) or {}
    if not venda.get("id"):
        res["motivos"] = ["O ERP não devolveu o id da venda"]
        return fim("ERRO", "ERRO: venda não confirmada — confira no Mais Controle antes de repetir",
                   codigo="VENDA_SEM_ID")
    res["venda"] = {"id": venda["id"]}
    return fim("CRIADA", "CRIADA no Mais Controle (venda %s) — %s" % (venda["id"], resumo), venda["id"],
               obrigatorio=True)


PAPEIS = {"CUSTOMER": "Cliente", "SUPPLIER": "Fornecedor", "EMPLOYEE": "Funcionário", "SELLER": "Vendedor"}


def _papel(p: dict) -> str:
    r = p.get("role") or p.get("roles") or ""
    if isinstance(r, list):
        return "/".join(PAPEIS.get(str(x), str(x)) for x in r) or "cadastro"
    return PAPEIS.get(str(r), str(r) or "cadastro")


def _anotar_erro(notion, page, texto, manter_erro_anterior=False) -> None:
    try:
        props = notion.pagina(page).get("properties") or {}
        cel = props.get(R.COL["situacao"]) or {}
        atual = "".join(t.get("plain_text", "") for t in cel.get("rich_text") or [])
        if manter_erro_anterior and atual.strip() and not atual.startswith("PROCESSANDO"):
            return   # o robô já anotou o resultado (ERRO, RECUSADA...); não trocar por um aviso genérico
        notion.gravar_textos(page, props, {R.COL["situacao"]: "ERRO: " + texto[:300]})
    except Exception:
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true", help="pediram gravar, mas MC_APLICAR não está ligado")
    ap.add_argument("--marcar-erro", default=None, help="só anota ERRO na situação (o workflow falhou)")
    ap.add_argument("--dias-financiamento", type=int, default=R.DIAS_FINANCIAMENTO)
    a = ap.parse_args(argv)

    def sair(res, codigo_saida):
        # stdout = log PÚBLICO do Actions: só situação e códigos, nunca nomes, CPF, valores ou corpo do ERP
        print(json.dumps({"situacao": res.get("situacao"), "codigo": res.get("codigo"),
                          "avisos": res.get("avisos") or []}, ensure_ascii=False))
        return codigo_saida

    notion = Notion(os.environ["NOTION_TOKEN"]) if os.environ.get("NOTION_TOKEN") else None
    if a.marcar_erro is not None:
        if notion:
            _anotar_erro(notion, a.page, a.marcar_erro or "o robô falhou — veja o GitHub Actions",
                         manter_erro_anterior=True)
        return sair({"situacao": "ERRO", "codigo": "WORKFLOW_FALHOU"}, 1)
    falta = [n for n in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA") if not os.environ.get(n)]
    if falta:
        if notion:
            _anotar_erro(notion, a.page, "o robô está sem configuração (segredos do GitHub)")
        return sair({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}, 2)
    erp = Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    try:
        res = processar(a.page, notion, erp, aplicar=a.aplicar and not a.bloqueado,
                        dias=a.dias_financiamento, bloqueado=a.bloqueado)
    except FalhaNotion:
        # a venda pode ter sido CRIADA: falhar alto para alguém conferir antes de repetir
        _anotar_erro(notion, a.page, "a venda pode ter sido criada, mas o id não foi anotado — confira no Mais Controle antes de repetir")
        return sair({"situacao": "ERRO", "codigo": "NOTION_FALHOU_DEPOIS_DE_CRIAR"}, 1)
    except ErpErro as e:
        _anotar_erro(notion, a.page, "o Mais Controle recusou — " + str(e)[:250])
        return sair({"situacao": "ERRO", "codigo": "ERP_RECUSOU"}, 1)
    except Exception as e:   # rede, JSON, o que for: nunca deixar PROCESSANDO preso
        _anotar_erro(notion, a.page, "falha inesperada (%s) — tente de novo" % type(e).__name__)
        return sair({"situacao": "ERRO", "codigo": type(e).__name__}, 1)
    ok = res.get("situacao") in ("PREVIA", "CRIADA", "JA_EXISTE", "JA_LANCADA")
    return sair(res, 0 if ok else 1)


if __name__ == "__main__":
    sys.exit(main())
