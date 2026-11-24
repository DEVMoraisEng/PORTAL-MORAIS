# -*- coding: utf-8 -*-
"""Comissão do corretor do condomínio lançada pelo portal (spec aprovada em 24/11/2026).

O portal pede pela fila do servidor (mc-venda, acao "comissao"); este robô lê a linha da BANCO DE DADOS VENDAS
CONDOMÍNIO, monta UM título A PAGAR (à vista ou Parcelado) para o corretor (ou a imobiliária dele), com o recibo
de cada parcela anexado, e escreve a prévia/resultado em MC - COMISSÃO. Grava só com --aplicar (as 3 chaves da
fila) E o carimbo [#hash] da prévia vista. Repositório público: nenhum dado real aqui nem nos testes.

Esta parte do módulo é só regras puras (sem rede, sem ERP).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import re

from .distrato import QUEM_PAGA

COL_ESTADO = "MC - COMISSÃO"
MAX_PARCELAS = 6
_RE_PARC = re.compile(r"^(\d{1,7}(?:\.\d{1,2})?)@(\d{4}-\d{2}-\d{2})$")


class Recusa(Exception):
    def __init__(self, codigo: str, texto: str):
        super().__init__(texto)
        self.codigo, self.texto = codigo, texto


def ler_parcelas(texto: str, hoje: str) -> list[dict]:
    itens = [x for x in str(texto or "").split(";") if x.strip()]
    if not itens or len(itens) > MAX_PARCELAS:
        raise Recusa("PARCELAS_INVALIDAS", "informe de 1 a %d parcelas" % MAX_PARCELAS)
    base = _dt.date.fromisoformat(hoje)
    out = []
    for x in itens:
        m = _RE_PARC.match(x.strip())
        if not m:
            raise Recusa("PARCELAS_INVALIDAS", "parcela ilegível: %s" % x.strip()[:40])
        v, d = round(float(m.group(1)), 2), m.group(2)
        try:
            dd = _dt.date.fromisoformat(d)
        except ValueError:
            raise Recusa("PARCELAS_INVALIDAS", "data inválida: %s" % d)
        if v <= 0:
            raise Recusa("PARCELAS_INVALIDAS", "parcela tem de ser maior que zero")
        if not (base - _dt.timedelta(days=30) <= dd <= base + _dt.timedelta(days=400)):
            raise Recusa("PARCELAS_INVALIDAS", "vencimento fora do prazo aceito: %s" % d)
        out.append({"valor": v, "data": d})
    return out


def conferir_saldo(parcelas: list[dict], comissao: float, ja_lancado: float) -> float:
    if not comissao or comissao <= 0:
        raise Recusa("SEM_COMISSAO", "a venda não tem comissão (coluna COMISSÃO vazia ou venda direta)")
    if (ja_lancado or 0.0) < 0:
        raise Recusa("JA_LANCADO_INVALIDO", "valor já lançado inválido (negativo)")
    saldo = round(comissao - (ja_lancado or 0.0), 2)
    pedido = round(sum(p["valor"] for p in parcelas), 2)
    if pedido > saldo + 0.005:
        raise Recusa("ACIMA_DO_SALDO", "parcelas somam %s e o saldo da comissão é %s" % (reais(pedido), reais(saldo)))
    return saldo


def reais(v: float) -> str:
    s = "%.2f" % v
    i, c = s.split(".")
    return "R$ " + "{:,}".format(int(i)).replace(",", ".") + "," + c


def descricao(unidade: int, cliente: str) -> str:
    return ("COMISSÃO CORRETOR UNIDADE %02d - %s" % (unidade, " ".join(str(cliente or "").upper().split())))[:150]


def observacao(pix: str, corretor: str, comissao: float, parcelas: list[dict]) -> str:
    """`pix` já vem como "<tipo>: <chave>" (ex.: "CNPJ: 00000000000191")."""
    vals = {p["valor"] for p in parcelas}
    ps = ("%d x %s" % (len(parcelas), reais(parcelas[0]["valor"]))) if len(vals) == 1 else         " + ".join(reais(p["valor"]) for p in parcelas)
    return "PIX %s. Corretor %s. Comissão total %s em %s." % (
        pix, " ".join(str(corretor or "").upper().split()), reais(comissao), ps)


def nome_recibo(unidade: int, parcela: dict, i: int, n: int) -> str:
    d = parcela["data"]
    data = "%s-%s-%s" % (d[8:10], d[5:7], d[0:4])
    valor = ("%.2f" % parcela["valor"]).replace(".", ",")
    meio = (" PARCELA %d-%d" % (i, n)) if n > 1 else ""
    return "%s - COMISSAO UNIDADE %02d%s - %s.pdf" % (valor, unidade, meio, data)


def corpo_titulo(parcelas, descricao_, obs, participante_id, categoria_id, forma_id, conta, work, condicao,
                 responsavel_id, hoje) -> dict:
    total = round(sum(p["valor"] for p in parcelas), 2)
    n = len(parcelas)
    tipo = condicao.get("type")
    if tipo and tipo != ("FINANCING" if n > 1 else "IN_CASH"):
        raise ValueError("condição de pagamento não bate com o número de parcelas")
    corpo = {
        "paymentCondition": {"id": condicao["id"], "type": "FINANCING" if n > 1 else "IN_CASH",
                             "financing": n > 1, "recurring": False},
        "installments": [{"plannedDate": p["data"], "plannedValue": p["valor"], "markedAsPaid": False, "order": i}
                         for i, p in enumerate(parcelas)],
        "numberOfInstallments": n,
        "value": total,
        "description": descricao_,
        "comment": obs,
        "participant": {"id": participante_id},
        "referenceDate": parcelas[0]["data"],
        "date": hoje + "T00:00:00",
        "category": {"id": categoria_id},
        "whoPays": work.get("defaultWhoPays") or QUEM_PAGA,
        "costCentreType": "WORK",
        "costCentreDetails": [{"value": total, "percentage": 100,
                               "work": {"id": work["id"], "name": work.get("name"),
                                        "status": work.get("status") or "IN_PROGRESS"}}],
        "paymentMethod": {"id": forma_id},
        "numberPrecision": 2,
        "markedAsPaid": False,
        "account": {"id": conta["id"], "name": conta.get("name")},
        "freightageValue": 0, "otherValue": 0, "ipiValue": 0, "discountValue": 0,
    }
    if n > 1:
        corpo["numberOfFinancingInstallments"] = n
    if responsavel_id:
        corpo["responsible"] = {"id": responsavel_id}
    return corpo


def assinatura(plano: dict) -> str:
    chave = json.dumps({k: plano.get(k) for k in ("parcelas", "favorecido_id", "comissao", "ja_lancado")},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(chave.encode("utf-8")).hexdigest()[:8]


def assinatura_do_texto(texto) -> str | None:
    m = re.search(r"\[#([0-9a-f]{8})\]", str(texto or ""))
    return m.group(1) if m else None
