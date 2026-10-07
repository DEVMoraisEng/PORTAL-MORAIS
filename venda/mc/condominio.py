# -*- coding: utf-8 -*-
"""Venda do condomínio: as parcelas saem do fluxo que o simulador grava na
BANCO DE DADOS VENDAS CONDOMÍNIO (uma linha por unidade). Puro: sem rede.

Regras do dono (06/10/2026):
- pré-chaves (parcelas mensais) e balões: reajuste INCC-M;
- pós-chaves: IPCA + 1% ao mês;
- referência do reajuste: índice de 2 meses antes;
- sinais, FGTS e financiamento: sem reajuste.
As datas seguem o simulador: parcela mensal no DIA PAGAMENTO PARCELAS; dia 29/30/31
num mês mais curto cai no último dia do mês."""
import calendar
import datetime as _dt

from . import regras as R

TABELA_PRE = "INCC-M"
TABELA_POS = "IPCA + 1% a.m."
REFERENCIA_MESES = 2

#: colunas da BANCO DE DADOS VENDAS CONDOMÍNIO (mesmos nomes do FX_COL_ do simulador)
FX = {
    "assinatura": "DATA DE ASSINATURA DO CONTRATO", "dia": "DIA PAGAMENTO PARCELAS",
    "entrega": "DATA DA ENTREGA", "data_venda": "DATA DA VENDA", "unidade": "UNIDADE",
    "vAto": "VALOR SINAL ATO",
    "dS30": "DATA SINAL 30 DIAS", "vS30": "VALOR SINAL 30 DIAS",
    "dS60": "DATA SINAL 60 DIAS", "vS60": "VALOR SINAL 60 DIAS",
    "dS90": "DATA SINAL 90 DIAS", "vS90": "VALOR SINAL 90 DIAS",
    "d1": "DATA 1º PARTE PRÉ CHAVES", "v1": "VALOR 1º PARTE PRÉ CHAVES", "n1": "Nº PARCELAS 1º PARTE PRÉ CHAVES",
    "d2": "DATA 2º PARTE PRÉ CHAVES", "v2": "VALOR 2º PARTE PRÉ CHAVES", "n2": "Nº PARCELAS 2º PARTE PRÉ CHAVES",
    "dB1": "DATA 1º BALÃO (12/27)", "vB1": "VALOR 1º BALÃO",
    "dB2": "DATA 2º BALÃO (25º PARCELA)", "vB2": "VALOR BALÃO ENTREGA DE CHAVES",
    "dP": "DATA PÓS CHAVES", "vP": "VALOR PÓS CHAVES", "nP": "Nº PARCELAS PÓS CHAVES",
}
_DATAS = {"assinatura", "entrega", "data_venda", "dS30", "dS60", "dS90", "d1", "d2", "dB1", "dB2", "dP"}


def fluxo(props: dict) -> dict:
    """Lê as colunas do fluxo da página do condomínio."""
    por_chave = {R.chave(n): p for n, p in (props or {}).items()}
    out = {}
    for k, nome in FX.items():
        v = R._valor(por_chave.get(R.chave(nome)))
        if k in _DATAS:
            out[k] = R._data(v)
        elif k == "unidade":
            out[k] = R._casa(v)
        else:
            out[k] = R._num(v)
    return out


def contato_corretor(props: dict) -> dict:
    """E-mail, celular e CRECI do corretor (a pasta do condomínio tem; a VENDAS das casas não)."""
    por_chave = {R.chave(n): p for n, p in (props or {}).items()}
    ler = lambda nome: R._valor(por_chave.get(R.chave(nome)))   # noqa: E731
    creci = ler("CRECI")
    if isinstance(creci, float) and creci.is_integer():
        creci = int(creci)
    return {"documento": R.so_digitos(ler("CPF CORRETOR")) or None,
            "email": (ler("EMAIL CORRETOR") or "").strip() or None,
            "telefone": R.so_digitos(ler("CELULAR CORRETOR")) or None,
            "creci": str(creci).strip() if creci not in (None, "") else None}


def data_no_dia(iso: str, meses: int, dia: int | None) -> str:
    """`iso` + `meses`, no `dia` escolhido (ou no mesmo dia de `iso`), limitado ao fim do mês."""
    d = _dt.date.fromisoformat(iso[:10])
    t = d.year * 12 + (d.month - 1) + meses
    a, m = t // 12, t % 12 + 1
    alvo = int(dia) if dia else d.day
    return _dt.date(a, m, min(max(1, alvo), calendar.monthrange(a, m)[1])).isoformat()


def parcelas(fx: dict, dados: dict, dias_financiamento: int = R.DIAS_FINANCIAMENTO) -> list[dict]:
    """[{tipo, rotulo, valor, data, tabela}] — `tabela` = nome da tabela de reajuste ou None.
    `dados` = dados_da_pagina da VENDAS (FGTS, financiado, subsídio e data da venda)."""
    out = []
    dia = int(fx["dia"]) if fx.get("dia") else None

    def add(tipo, rotulo, valor, data, tabela=None):
        if valor is not None and valor > 0:
            out.append({"tipo": tipo, "rotulo": rotulo, "valor": round(float(valor), 2), "data": data, "tabela": tabela})

    def serie(tipo, nome, n, valor, primeira, tabela):
        n = int(n or 0)
        if not valor or valor <= 0 or n <= 0:
            return
        for i in range(n):
            data = data_no_dia(primeira, i, dia) if primeira and R._RE_ISO.match(primeira) else None
            add(tipo, "%s %d/%d" % (nome, i + 1, n), valor, data, tabela)

    add(R.TIPO_SINAL, "Sinal ato", fx.get("vAto"), fx.get("assinatura") or dados.get("data_venda"))
    add(R.TIPO_SINAL, "Sinal 30 dias", fx.get("vS30"), fx.get("dS30"))
    add(R.TIPO_SINAL, "Sinal 60 dias", fx.get("vS60"), fx.get("dS60"))
    add(R.TIPO_SINAL, "Sinal 90 dias", fx.get("vS90"), fx.get("dS90"))
    serie(R.TIPO_PARCELA, "Pré-chaves 1ª parte", fx.get("n1"), fx.get("v1"), fx.get("d1"), TABELA_PRE)
    serie(R.TIPO_PARCELA, "Pré-chaves 2ª parte", fx.get("n2"), fx.get("v2"), fx.get("d2"), TABELA_PRE)
    add(R.TIPO_INTERMEDIARIA, "Balão 12/27", fx.get("vB1"), fx.get("dB1"), TABELA_PRE)
    add(R.TIPO_CHAVES, "Balão entrega de chaves", fx.get("vB2"), fx.get("dB2"), TABELA_PRE)
    serie(R.TIPO_PARCELA, "Pós-chaves", fx.get("nP"), fx.get("vP"), fx.get("dP"), TABELA_POS)
    dv = fx.get("assinatura") or dados.get("data_venda")   # no condomínio o banco entra depois da assinatura
    prev = R._mais_dias(dv, dias_financiamento) if dv and R._RE_ISO.match(dv) else None
    add(R.TIPO_FGTS, "FGTS", dados.get("fgts"), prev)
    fin = (dados.get("financiado") or 0) + (dados.get("subsidio") or 0)
    add(R.TIPO_FINANCIAMENTO, "Financiamento", fin or None, prev)
    return out


def faltas_do_fluxo(fx: dict, casa: int | None) -> list[str]:
    f = []
    if not fx.get("assinatura"):
        f.append("Falta a DATA DE ASSINATURA DO CONTRATO na venda do condomínio")
    if not fx.get("dia"):
        f.append("Falta o DIA PAGAMENTO PARCELAS na venda do condomínio")
    if fx.get("nP") and not fx.get("dP"):
        f.append("Falta a DATA PÓS CHAVES (precisa da DATA DA ENTREGA) na venda do condomínio")
    if casa and fx.get("unidade") and fx["unidade"] != casa:
        f.append("A CASA da venda (%s) é diferente da UNIDADE do condomínio (%s)" % (casa, fx["unidade"]))
    return f


def escolher_obra(obras: list[dict], endereco: str, casa: int | None) -> list[dict]:
    """Obra da venda no Mais Controle: o centro de custo do condomínio inteiro (nome igual ao ENDEREÇO).
    Regra do dono (07/10/2026): NÃO há centro de custo por casa; a unidade vai na descrição
    ("VENDA UNIDADE 13 - NOME") e as vendas se diferenciam pelo cliente."""
    alvo = R.chave(endereco)
    return [o for o in obras if R.chave(o.get("name")) == alvo]
