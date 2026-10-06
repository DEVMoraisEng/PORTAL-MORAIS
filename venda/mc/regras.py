# -*- coding: utf-8 -*-
"""Regras PURAS do lançamento da venda no Mais Controle (entrega 4).

Nada aqui fala com rede: recebe o que foi lido do Notion e do ERP e devolve
os corpos que seriam enviados, ou a lista do que falta. Fase 0 lida em
06/10/2026 (ver CONTRATOS DE VENDA/DOCUMENTACAO/13):

- a Venda de Unidade é gravada por POST {legado}/readjustment-sales com o
  mesmo formato do GET /sales/{id};
- cada parcela é {plannedValue, plannedDate, readjustmentDetail:{type, table,
  rawValue, reference}} — é o que a própria tela monta;
- conta = conta padrão da OBRA (regra do dono); natureza "Venda"; condição
  "Parcelado"; juros compostos.
"""
from __future__ import annotations

import datetime as _dt
import re
import unicodedata

#: Ids do catálogo do ERP lidos de vendas reais (jun–out/2026).
TIPO_SINAL = "00e30a7a-7a49-422e-b8b1-3ba4f927e250"
TIPO_ENTRADA = "bc569ea7-63ae-401b-b3d1-faf65a6b4465"
TIPO_FINANCIAMENTO = "994f6f20-cebf-4499-839c-f61afda9b174"
TIPO_FGTS = "88da2643-8f30-4a17-9946-9039a9f1e1ce"
CONDICAO_PARCELADO = "9d00aa57-cb9d-4818-b411-8b6846374d37"
NATUREZA_VENDA = "85a40f0e-320c-4b0f-a0cc-54926c9d5aaf"

#: Colunas da base VENDAS (nomes como estão no Notion; comparação por chave()).
COL = {
    "endereco": "ENDEREÇO",
    "casa": "CASA",
    "data_venda": "DATA DA VENDA",
    "clientes": "CLIENTES",
    "cpf": "CPF",
    "email": "EMAIL",
    "telefone": "Nº Whatsapp",
    "valor_contrato": "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)",
    "comissao": "COMISSÃO",
    "valor_na_mao": "VALOR NA MÃO",
    "comissao_paga_por": "CONTRATO - COMISSÃO PAGA POR",
    "sinal_valor": "CONTRATO - SINAL VALOR",
    "sinal_data": "CONTRATO - SINAL DATA",
    "entrada_valor": "CONTRATO - ENTRADA VALOR",
    "entrada_data": "CONTRATO - ENTRADA VENCIMENTO",
    "intermediaria_valor": "CONTRATO - INTERMEDIÁRIA VALOR",
    "intermediaria_data": "CONTRATO - INTERMEDIÁRIA VENCIMENTO",
    "financiado": "VALOR FINANCIADO",
    "fgts": "VALOR DO FGTS",
    "subsidio": "VALOR DO SUBSÍDIO",
    "corretor": "CORRETOR",
    "situacao": "MC - SITUAÇÃO",
    "venda_id": "MC - VENDA ID",
}

DIAS_FINANCIAMENTO = 30   # vencimento previsto do financiamento/FGTS: data da venda + 30
TOLERANCIA = 0.01


def chave(s) -> str:
    """Mesma normalização do RegrasVenda.chave: sem acento, maiúsculas, um espaço."""
    t = unicodedata.normalize("NFD", str(s or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.upper().split())


def so_digitos(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def cpf_valido(cpf) -> bool:
    d = so_digitos(cpf)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        dv = (soma * 10) % 11 % 10
        if dv != int(d[n]):
            return False
    return True


# ---------------------------------------------------------------- Notion

def _valor(pr):
    """Valor 'solto' de uma propriedade do Notion."""
    if not isinstance(pr, dict):
        return None
    t = pr.get("type")
    v = pr.get(t)
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in (v or [])).strip() or None
    if t in ("select", "status"):
        return (v or {}).get("name")
    if t == "number":
        return v
    if t == "date":
        return (v or {}).get("start")
    if t in ("email", "phone_number", "url"):
        return v or None
    if t == "formula":
        v = v or {}
        x = v.get(v.get("type"))
        return x.get("start") if isinstance(x, dict) else x
    if t == "people":
        return ", ".join(p.get("name", "") for p in (v or [])) or None
    return None


def _num(x):
    if x is None or x == "":
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).replace("R$", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def dados_da_pagina(props: dict) -> dict:
    """Lê as propriedades da página da venda e devolve `dados` (ver montar_venda)."""
    por_chave = {chave(k): v for k, v in (props or {}).items()}

    def ler(campo):
        return _valor(por_chave.get(chave(COL[campo])))

    titulo = None
    for v in (props or {}).values():
        if isinstance(v, dict) and v.get("type") == "title":
            titulo = _valor(v)
    clientes = ler("clientes") or ""
    nome1 = re.split(r"\s+E\s+|\s*[&,/]\s*", clientes, maxsplit=1)[0].strip() if clientes else ""
    total, comissao, na_mao = _num(ler("valor_contrato")), _num(ler("comissao")), _num(ler("valor_na_mao"))
    paga_por = chave(ler("comissao_paga_por"))
    if paga_por == "VENDEDOR":
        aquisicao = total
    elif na_mao and na_mao > 0:
        aquisicao = na_mao
    elif total is not None and comissao is not None:
        aquisicao = total - comissao
    else:
        aquisicao = None
    casa = ler("casa")
    return {
        "endereco": titulo or ler("endereco") or "",
        "casa": int(casa) if isinstance(casa, (int, float)) else (int(so_digitos(casa)) if so_digitos(casa) else None),
        "data_venda": (ler("data_venda") or "")[:10] or None,
        "comprador": {"nome": nome1, "cpf": so_digitos(ler("cpf")),
                      "email": ler("email"), "telefone": so_digitos(ler("telefone"))},
        "aquisicao": aquisicao,
        "sinal": {"valor": _num(ler("sinal_valor")), "data": (ler("sinal_data") or "")[:10] or None},
        "entrada": {"valor": _num(ler("entrada_valor")), "data": (ler("entrada_data") or "")[:10] or None},
        "intermediaria": {"valor": _num(ler("intermediaria_valor")), "data": (ler("intermediaria_data") or "")[:10] or None},
        "financiado": _num(ler("financiado")),
        "subsidio": _num(ler("subsidio")),
        "fgts": _num(ler("fgts")),
        "corretor": ler("corretor"),
        "venda_id_atual": ler("venda_id"),
    }


# ---------------------------------------------------------------- parcelas

def _mais_dias(data_iso: str, dias: int) -> str:
    return (_dt.date.fromisoformat(data_iso[:10]) + _dt.timedelta(days=dias)).isoformat()


def parcelas(dados: dict, dias_financiamento: int = DIAS_FINANCIAMENTO) -> list[dict]:
    """[{tipo, rotulo, valor, data}] na ordem em que entram na venda.

    Financiamento = VALOR FINANCIADO + VALOR DO SUBSÍDIO (os dois são pagos pela
    Caixa na assinatura do contrato do banco). Sem data conhecida, financiamento
    e FGTS vencem na data da venda + `dias_financiamento` (é previsão; o ERP
    deixa editar a data quando o banco pagar)."""
    out = []
    dv = dados.get("data_venda")

    def add(tipo, rotulo, valor, data):
        if valor is not None and valor > 0:
            out.append({"tipo": tipo, "rotulo": rotulo, "valor": round(float(valor), 2), "data": data})

    add(TIPO_SINAL, "Sinal", dados["sinal"]["valor"], dados["sinal"]["data"] or dv)
    add(TIPO_ENTRADA, "Entrada", dados["entrada"]["valor"], dados["entrada"]["data"])
    add(TIPO_ENTRADA, "Intermediária", dados["intermediaria"]["valor"], dados["intermediaria"]["data"])
    prev = _mais_dias(dv, dias_financiamento) if dv else None
    add(TIPO_FGTS, "FGTS", dados.get("fgts"), prev)
    fin = (dados.get("financiado") or 0) + (dados.get("subsidio") or 0)
    add(TIPO_FINANCIAMENTO, "Financiamento", fin or None, prev)
    return out


def descricao(dados: dict) -> str:
    casa = dados.get("casa")
    return "VENDA CASA %02d - %s" % (casa or 0, " ".join(str(dados["comprador"]["nome"] or "").upper().split()))


def faltas(dados: dict, dias_financiamento: int = DIAS_FINANCIAMENTO) -> list[str]:
    f = []
    if not dados.get("endereco"):
        f.append("Venda sem ENDEREÇO")
    if not dados.get("casa"):
        f.append("Venda sem número da CASA")
    if not dados.get("data_venda"):
        f.append("Falta a DATA DA VENDA")
    c = dados["comprador"]
    if not c.get("nome"):
        f.append("Falta o nome do comprador (CLIENTES)")
    if not cpf_valido(c.get("cpf")):
        f.append("CPF do comprador vazio ou inválido")
    if not dados.get("aquisicao") or dados["aquisicao"] <= 0:
        f.append("Falta o valor que a SPE recebe (valor do contrato / comissão / valor na mão)")
    ps = parcelas(dados, dias_financiamento)
    for p in ps:
        if not p["data"]:
            f.append("Parcela %s sem data" % p["rotulo"])
    if not ps:
        f.append("Nenhuma parcela com valor (sinal, entrada, FGTS, financiamento)")
    elif dados.get("aquisicao"):
        soma = round(sum(p["valor"] for p in ps), 2)
        dif = round(dados["aquisicao"] - soma, 2)
        if abs(dif) > TOLERANCIA:
            f.append("Soma das parcelas (R$ %.2f) diferente do valor que a SPE recebe (R$ %.2f): diferença R$ %.2f"
                     % (soma, dados["aquisicao"], dif))
    return f


# ---------------------------------------------------------------- corpos

def corpo_cliente(dados: dict) -> dict:
    """POST {legado}/participants — o mesmo objeto que a tela "Clientes > Novo" grava."""
    c = dados["comprador"]
    corpo = {"status": "ACTIVE", "type": "PERSON", "role": "CUSTOMER",
             "name": " ".join(str(c["nome"]).upper().split()), "cpf": so_digitos(c["cpf"]),
             "contacts": [], "phones": []}
    if c.get("email"):
        corpo["email"] = c["email"]
    if c.get("telefone"):
        corpo["phones"] = [{"number": c["telefone"]}]
    return corpo


def corpo_venda(dados: dict, obra: dict, cliente_id: str, conta: dict,
                responsavel_id: str | None = None, vendedor_id: str | None = None,
                dias_financiamento: int = DIAS_FINANCIAMENTO) -> dict:
    """POST {legado}/readjustment-sales.

    `obra` = {id, name}; `conta` = conta padrão da obra ({id, name, ...})."""
    ps = parcelas(dados, dias_financiamento)
    inst = []
    for p in ps:
        inst.append({"plannedValue": p["valor"], "plannedDate": p["data"],
                     "comment": p["rotulo"] if p["rotulo"] == "Intermediária" else None,
                     "readjustmentDetail": {"type": {"id": p["tipo"]}, "table": None,
                                            "rawValue": p["valor"], "reference": 0}})
    total = round(sum(p["valor"] for p in ps), 2)
    tr = {
        "value": total, "grossValue": total, "taxWithhold": 0,
        "referenceDate": dados["data_venda"],
        "numberOfInstallments": len(inst),
        "nature": {"id": NATUREZA_VENDA},
        "receivingCondition": {"id": CONDICAO_PARCELADO, "deferred": True},
        "defaultAccount": {"id": conta["id"]},
        "installments": inst,
    }
    if responsavel_id:
        tr["responsible"] = {"id": responsavel_id}
    corpo = {
        "date": dados["data_venda"],
        "description": descricao(dados),
        "readjustmentEnabled": True,
        "interestRateAccumulateStrategy": "COMPOUND_INTEREST",
        "work": {"id": obra["id"]},
        "customer": {"id": cliente_id},
        "tradeReceivable": tr,
        "withholds": [],
    }
    if vendedor_id:
        corpo["seller"] = {"id": vendedor_id}
    return corpo


# ---------------------------------------------------------------- já existe?

_RE_CASA = re.compile(r"\b(?:CASA|CS)\s*0*(\d+)\b")


def casa_da_descricao(desc) -> int | None:
    m = _RE_CASA.search(chave(desc))
    return int(m.group(1)) if m else None


def venda_da_casa(recebimentos: list[dict], obra_nome: str, casa: int, total_casas: int = 0) -> list[str]:
    """Ids de venda (saleId) da mesma obra cuja descrição aponta a mesma casa.

    Se a obra tem UMA casa só, qualquer venda da obra conta (a descrição antiga
    às vezes não diz a casa)."""
    alvo = chave(obra_nome)
    ids = []
    for r in recebimentos or []:
        if chave(r.get("workName")) != alvo or not r.get("saleId"):
            continue
        c = casa_da_descricao(r.get("description"))
        if c == casa or (c is None and total_casas == 1):
            if r["saleId"] not in ids:
                ids.append(r["saleId"])
    return ids
