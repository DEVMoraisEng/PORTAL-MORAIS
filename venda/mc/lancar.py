# -*- coding: utf-8 -*-
"""Lança a venda de uma casa no Mais Controle a partir da página do Notion.

Uso:
    python -m venda.mc.lancar --page <id-da-pagina>             # PRÉVIA: só lê e mostra
    python -m venda.mc.lancar --page <id-da-pagina> --aplicar   # cria cliente (se faltar) e venda

Ambiente: NOTION_TOKEN, MC_ROBO_EMAIL, MC_ROBO_SENHA. Sem --aplicar NADA é
gravado no ERP; o Notion recebe só o texto da prévia em "MC - SITUAÇÃO".

Saída: um JSON {situacao, motivos, avisos, venda, cliente, ...} na última linha.
situacao: PREVIA | CRIADA | JA_EXISTE | JA_LANCADA | RECUSADA | ERRO.
O log nunca leva CPF, nome do comprador nem token (o log do Actions é público)."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import regras as R
from .erp import Erp, ErpErro
from .notion import Notion


def processar(page_id: str, notion, erp, aplicar: bool = False, dias: int = R.DIAS_FINANCIAMENTO,
              bloqueado: bool = False) -> dict:
    """bloqueado=True: pediram para gravar, mas o repositório não liberou (MC_APLICAR)."""
    pg = notion.pagina(page_id)
    props = pg.get("properties") or {}
    d = R.dados_da_pagina(props)
    res = {"situacao": None, "motivos": [], "avisos": [], "pageId": page_id,
           "obra": d["endereco"], "casa": d["casa"]}

    def fim(situacao, texto_notion=None, venda_id=None):
        res["situacao"] = situacao
        valores = {R.COL["situacao"]: texto_notion or situacao}
        if venda_id:
            valores[R.COL["venda_id"]] = venda_id
        try:
            faltou = notion.gravar_textos(page_id, props, valores)
            if faltou:
                res["avisos"].append("colunas que não existem no Notion: " + ", ".join(faltou))
        except Exception as e:  # o resultado vale mesmo se a anotação falhar
            res["avisos"].append("não consegui anotar no Notion: " + str(e)[:150])
        return res

    if d.get("venda_id_atual"):
        res["venda"] = {"id": d["venda_id_atual"]}
        return fim("JA_LANCADA", "JÁ LANÇADA (venda %s)" % d["venda_id_atual"])

    f = R.faltas(d, dias)
    if f:
        res["motivos"] = f
        return fim("RECUSADA", "RECUSADA: " + "; ".join(f))

    # obra pelo endereço (título da venda = nome da obra no ERP)
    obras = [o for o in erp.obras() if R.chave(o.get("name")) == R.chave(d["endereco"])]
    if len(obras) != 1:
        res["motivos"] = ["Obra '%s' %s no Mais Controle" % (d["endereco"], "não encontrada" if not obras else "repetida (%d)" % len(obras))]
        return fim("RECUSADA", "RECUSADA: " + res["motivos"][0])
    obra = obras[0]
    det = erp.obra(obra["id"])
    conta = det.get("defaultAccount") or {}
    if not conta.get("id"):
        res["motivos"] = ["A obra não tem conta padrão no Mais Controle (a conta da venda vem da obra)"]
        return fim("RECUSADA", "RECUSADA: " + res["motivos"][0])

    # venda da mesma casa já lançada à mão?
    ja = R.venda_da_casa(erp.recebimentos(), obra["name"], d["casa"])
    if ja:
        res["venda"] = {"id": ja[0], "todas": ja}
        res["motivos"] = ["Já existe venda da CASA %02d desta obra no Mais Controle" % d["casa"]]
        return fim("JA_EXISTE", "JÁ EXISTE no Mais Controle (venda %s) — nada criado" % ja[0], ja[0])

    clientes = erp.cliente_por_cpf(d["comprador"]["cpf"])
    if len(clientes) > 1:
        res["motivos"] = ["CPF do comprador aparece em %d clientes no Mais Controle" % len(clientes)]
        return fim("RECUSADA", "RECUSADA: " + res["motivos"][0])
    cliente_novo = None if clientes else R.corpo_cliente(d)
    res["cliente"] = {"existe": bool(clientes), "id": clientes[0]["id"] if clientes else None}

    vendedor_id = None
    if d.get("corretor"):
        try:
            vs = erp.participante_por_nome(d["corretor"])
            if len(vs) == 1:
                vendedor_id = vs[0]["id"]
            else:
                res["avisos"].append("corretor não achado como participante (fica sem vendedor)")
        except ErpErro:
            res["avisos"].append("não consegui procurar o corretor (fica sem vendedor)")

    corpo = R.corpo_venda(d, obra, res["cliente"]["id"] or "(CLIENTE NOVO)", conta,
                          responsavel_id=getattr(erp, "user_id", None), vendedor_id=vendedor_id,
                          dias_financiamento=dias)
    res["corpo_venda"] = corpo
    res["parcelas"] = [{"rotulo": p["rotulo"], "valor": p["valor"], "data": p["data"]}
                       for p in R.parcelas(d, dias)]
    resumo = "; ".join("%s R$ %.2f em %s" % (p["rotulo"], p["valor"], p["data"]) for p in res["parcelas"])

    if not aplicar:
        return fim("PREVIA", ("BLOQUEADO: gravar no Mais Controle está desligado neste ambiente (MC_APLICAR) — "
                              if bloqueado else "") + "PRÉVIA OK — %s%s; conta da obra: %s; %s" % (
            "cliente novo será criado; " if cliente_novo else "cliente já existe; ",
            corpo["description"].split(" - ")[0], conta.get("name") or conta["id"], resumo))

    if cliente_novo:
        criado = erp.criar_cliente(cliente_novo) or {}
        if not criado.get("id"):
            res["motivos"] = ["O ERP não devolveu o id do cliente criado"]
            return fim("ERRO", "ERRO: cliente não confirmado — confira no Mais Controle antes de repetir")
        corpo["customer"] = {"id": criado["id"]}
        res["cliente"] = {"existe": False, "criado": True, "id": criado["id"]}
    venda = erp.criar_venda(corpo) or {}
    if not venda.get("id"):
        res["motivos"] = ["O ERP não devolveu o id da venda"]
        return fim("ERRO", "ERRO: venda não confirmada — confira no Mais Controle antes de repetir")
    res["venda"] = {"id": venda["id"]}
    return fim("CRIADA", "CRIADA no Mais Controle (venda %s) — %s" % (venda["id"], resumo), venda["id"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--bloqueado", action="store_true", help="pediram gravar, mas MC_APLICAR não está ligado")
    ap.add_argument("--dias-financiamento", type=int, default=R.DIAS_FINANCIAMENTO)
    a = ap.parse_args(argv)
    falta = [n for n in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA") if not os.environ.get(n)]
    if falta:
        print(json.dumps({"situacao": "ERRO", "motivos": ["faltam segredos: " + ", ".join(falta)]}, ensure_ascii=False))
        return 2
    notion = Notion(os.environ["NOTION_TOKEN"])
    erp = Erp(os.environ["MC_ROBO_EMAIL"], os.environ["MC_ROBO_SENHA"])
    try:
        res = processar(a.page, notion, erp, aplicar=a.aplicar and not a.bloqueado,
                        dias=a.dias_financiamento, bloqueado=a.bloqueado)
    except (ErpErro, RuntimeError) as e:
        res = {"situacao": "ERRO", "motivos": [str(e)[:400]]}
        try:
            notion.gravar_textos(a.page, (notion.pagina(a.page).get("properties") or {}),
                                 {R.COL["situacao"]: "ERRO: " + str(e)[:300]})
        except Exception:
            pass
    # o log do Actions é público: só situação, motivos e avisos
    print(json.dumps({k: res.get(k) for k in ("situacao", "motivos", "avisos", "casa")}, ensure_ascii=False))
    return 0 if res.get("situacao") in ("PREVIA", "CRIADA", "JA_EXISTE", "JA_LANCADA") else 1


if __name__ == "__main__":
    sys.exit(main())
