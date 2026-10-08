# -*- coding: utf-8 -*-
"""Tabelas de reajuste do Mais Controle alimentadas pelo Banco Central (SGS), todo mês.

    python -m venda.mc.indices             # só mostra o que faria
    python -m venda.mc.indices --aplicar   # cria as tabelas que faltam, lança os meses novos (o ERP recalcula ao salvar)

Regras do dono (06/10/2026): pré-chaves INCC-M; pós-chaves IPCA + 1% ao mês; referência 2 meses antes
(a referência é escolhida em cada parcela da venda, não na tabela).
Nunca apaga nem altera um mês já lançado: se o Banco Central revisar um número, só avisa.
O log é público, mas aqui só há índices públicos e contagens."""
import argparse
import datetime as _dt
import json
import os
import sys

import requests

from venda.mc.erp import Erp, ErpErro

SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.%d/dados"
DESDE = "2025-01"   # meses anteriores não servem a nenhuma venda nova
TABELAS = [
    {"nome": "INCC-M", "serie": 7456, "acrescimo": None},
    {"nome": "IPCA + 1% a.m.", "serie": 433, "acrescimo": 1.0},
]
TOLERANCIA = 0.000001


def serie_bcb(codigo: int, desde: str = DESDE, http=None) -> dict:
    """{'AAAA-MM': percentual} da série do SGS a partir de `desde`."""
    a, m = desde.split("-")
    r = (http or requests).get(SGS % codigo, params={"formato": "json", "dataInicial": "01/%s/%s" % (m, a)},
                               timeout=60)
    r.raise_for_status()
    out = {}
    for x in r.json():
        d, mes, ano = x["data"].split("/")
        out["%s-%s" % (ano, mes)] = round(float(x["valor"]), 6)
    return out


def mes_do_periodo(p: dict) -> str:
    return str(p.get("date") or "")[:7]


def valor(readjust: float, acrescimo) -> float:
    return round(readjust + (acrescimo or 0), 6)


def planejar(tabela: dict, existente: dict | None, serie: dict, desde: str = DESDE) -> dict:
    """O que falta lançar. `existente` = tabela como o ERP devolve (ou None se não existe)."""
    periodos = list((existente or {}).get("periods") or [])
    ja = {mes_do_periodo(p): p for p in periodos}
    novos, revisados = [], []
    for mes in sorted(serie):
        if mes < desde:
            continue
        if mes in ja:
            if abs(float(ja[mes].get("readjust") or 0) - serie[mes]) > TOLERANCIA:
                revisados.append(mes)
            continue
        novos.append({"date": mes + "-01", "readjust": serie[mes], "value": valor(serie[mes], tabela["acrescimo"])})
    corpo = dict(existente or {}, name=tabela["nome"], periods=periodos + novos)
    if tabela["acrescimo"]:
        corpo["addition"] = tabela["acrescimo"]
    return {"criar": existente is None, "novos": novos, "revisados": revisados, "corpo": corpo}


def conferir(salva: dict, plano: dict) -> list[str]:
    """Depois de gravar: todos os meses planejados estão lá com o valor certo?"""
    ja = {mes_do_periodo(p): p for p in salva.get("periods") or []}
    erros = []
    for p in plano["novos"]:
        s = ja.get(p["date"][:7])
        if not s or abs(float(s.get("readjust") or 0) - p["readjust"]) > TOLERANCIA:
            erros.append(p["date"][:7])
    return erros


def rodar(erp, aplicar: bool, series: dict) -> list[dict]:
    todas = erp.pedir("GET", "/readjustment-tables/all") or []
    res = []
    for t in TABELAS:
        achadas = [x for x in todas if (x.get("name") or "").strip().upper() == t["nome"].upper()]
        if len(achadas) > 1:
            res.append({"tabela": t["nome"], "situacao": "RECUSADA", "motivo": "mais de uma tabela com este nome"})
            continue
        existente = erp.pedir("GET", "/readjustment-tables/%s" % achadas[0]["id"]) if achadas else None
        plano = planejar(t, existente, series[t["serie"]])
        item = {"tabela": t["nome"], "criar": plano["criar"], "meses_novos": [p["date"][:7] for p in plano["novos"]],
                "revisados_no_bcb": plano["revisados"]}
        if not aplicar or (not plano["criar"] and not plano["novos"]):
            item["situacao"] = "PREVIA" if (plano["criar"] or plano["novos"]) else "EM_DIA"
            res.append(item)
            continue
        if plano["criar"]:
            salva = erp.pedir("POST", "/readjustment-tables", corpo=plano["corpo"]) or {}
        else:
            salva = erp.pedir("PUT", "/readjustment-tables/%s" % existente["id"], corpo=plano["corpo"]) or {}
        if not salva.get("id"):
            raise ErpErro("o ERP não devolveu a tabela %s" % t["nome"])
        salva = erp.pedir("GET", "/readjustment-tables/%s" % salva["id"]) or {}
        faltam = conferir(salva, plano)
        if faltam:
            raise ErpErro("tabela %s gravada sem os meses %s" % (t["nome"], ", ".join(faltam)))
        # o site só salva (PUT); a rota .../process existe no código mas dá 404 e ninguém a chama
        item.update(situacao="ATUALIZADA", id=salva["id"])
        res.append(item)
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args(argv)
    falta = [n for n in ("MC_ROBO_EMAIL", "MC_ROBO_SENHA") if not os.environ.get(n)]
    if falta:
        print(json.dumps({"situacao": "ERRO", "codigo": "SEM_SEGREDOS"}))
        return 2
    series = {t["serie"]: serie_bcb(t["serie"]) for t in TABELAS}
    erp = Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    try:
        res = rodar(erp, a.aplicar, series)
    except ErpErro as e:
        print(json.dumps({"situacao": "ERRO", "codigo": "ERP_RECUSOU", "motivo": str(e)[:300]}, ensure_ascii=False))
        return 1
    print(json.dumps({"hoje": _dt.date.today().isoformat(), "tabelas": res}, ensure_ascii=False, indent=1))
    return 1 if any(r["situacao"] == "RECUSADA" for r in res) else 0


if __name__ == "__main__":
    sys.exit(main())
