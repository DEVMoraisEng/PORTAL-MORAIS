# -*- coding: utf-8 -*-
"""Retrato da venda do condomínio para a antecipação (spec v2, 31/10/2026). Puro: sem rede.
O portal faz a conta em cima deste retrato (venda/Antecipacao.js)."""
from . import regras as R
from . import distrato as D

OBRA = "CONDOMÍNIO RESERVA DOS IPÊS"
TABELA_PRE, TABELA_POS = "INCC-M", "IPCA + 1% a.m."


class ForaDoCondominio(ValueError):
    pass


def _tipo(p: dict) -> str:
    rd = p.get("readjustmentDetail") or {}
    t = (rd.get("type") or {}).get("id")
    tab = ((rd.get("table") or {}).get("name") or "").strip()
    if t == R.TIPO_SINAL:
        return "sinal"
    if t == R.TIPO_ENTRADA:
        return "entrada"
    if t in (R.TIPO_FGTS, R.TIPO_FINANCIAMENTO):
        return "terceiros"
    if t in (R.TIPO_INTERMEDIARIA, R.TIPO_CHAVES):
        return "balao"
    if t == R.TIPO_PARCELA:
        return "pos" if tab == TABELA_POS else "pre" if tab == TABELA_PRE else "outro"
    return "outro"


def normalizar(venda: dict, lido_em: str) -> dict:
    obra = ((venda.get("work") or {}).get("name") or "").strip()
    if obra != OBRA:
        raise ForaDoCondominio(obra or "sem obra")
    parcelas = []
    for p in (venda.get("tradeReceivable") or {}).get("installments") or []:
        rd = p.get("readjustmentDetail") or {}
        raw = float(rd.get("rawValue") or 0)
        valor = float(p.get("plannedValue") or 0)
        parcelas.append({"id": p.get("id"), "data": str(p.get("plannedDate") or "")[:10], "tipo": _tipo(p),
                         "tabela": ((rd.get("table") or {}).get("name") or None),
                         "raw": round(raw, 2), "valor": round(valor, 2),
                         "fator": 1 + float(rd.get("accumulatedReadjustmentValue") or 0) / 100 if rd.get("table") else 1.0,
                         "pago": D.tem_recebimento(p) and not D.recebida_em_parte(p),
                         "parcial": D.recebida_em_parte(p)})
    parcelas.sort(key=lambda x: (x["data"], x["id"] or ""))
    return {"v": 1, "venda": venda.get("id"), "obra": obra, "lido": lido_em[:10], "parcelas": parcelas}
