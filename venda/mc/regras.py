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
# catálogo GET {legado}/readjustment-installment-types, lido em 06/10/2026
TIPO_INTERMEDIARIA = "3a1c631a-e0db-4962-b4b5-32beee649806"
TIPO_PARCELA = "aff8eac2-40c6-4b59-a837-f09eb4c5b60b"
TIPO_CHAVES = "aa7ff517-46d6-4b46-8856-129448181fec"
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
    "email1": "COMPRADOR 1 - E-MAIL",
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
    "imobiliaria": "IMOBILIÁRIA",
    "situacao": "MC - SITUAÇÃO",
    "venda_id": "MC - VENDA ID",
    "condominio_id": "CONDOMÍNIO - VENDA ID",   # venda do condomínio: o fluxo de parcelas mora nessa página
}

REFERENCIA_REAJUSTE = 2   # índice de 2 meses antes (dono, 06/10/2026)
DIAS_FINANCIAMENTO = 30   # vencimento previsto do financiamento/FGTS: data da venda + 30
TOLERANCIA = 0.01


def chave(s) -> str:
    """Mesma normalização do RegrasVenda.chave: sem acento, maiúsculas, um espaço."""
    t = unicodedata.normalize("NFD", str(s or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.upper().split())


def so_hex(s) -> str:
    """Id de página do Notion (32 hex), aceitando com hífens ou dentro de um link."""
    m = re.search(r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}", str(s or ""))
    return m.group(0).replace("-", "").lower() if m else ""


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
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", s):   # "250.000" é milhar, não 250,0
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


_RE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_BR = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


def _data(x):
    """ISO 'aaaa-mm-dd' de uma data do Notion (date ou texto 'dd/mm/aaaa'); o resto passa como veio
    (e faltas() recusa)."""
    s = str(x or "").strip()[:10] if x else ""
    m = _RE_BR.match(s)
    if m:
        return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    return s or None


def _casa(x):
    """Número da casa; None se vazio OU se houver mais de um número ("1 e 2", "Casa 3 - Lote 5")."""
    if isinstance(x, (int, float)):
        return int(x)
    grupos = re.findall(r"\d+", str(x or ""))
    return int(grupos[0]) if len(grupos) == 1 else None


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
    casa_bruta = ler("casa")
    return {
        "endereco": titulo or ler("endereco") or "",
        "casa": _casa(casa_bruta),
        "casa_ambigua": casa_bruta not in (None, "") and _casa(casa_bruta) is None,
        "data_venda": _data(ler("data_venda")),
        "comprador": {"nome": nome1, "cpf": so_digitos(ler("cpf")),
                      "email": ler("email1") or ler("email"), "telefone": so_digitos(ler("telefone"))},
        "aquisicao": aquisicao,
        "total": total, "comissao": comissao, "valor_na_mao": na_mao, "comissao_paga_por": paga_por,
        "sinal": {"valor": _num(ler("sinal_valor")), "data": _data(ler("sinal_data"))},
        "entrada": {"valor": _num(ler("entrada_valor")), "data": _data(ler("entrada_data"))},
        "intermediaria": {"valor": _num(ler("intermediaria_valor")), "data": _data(ler("intermediaria_data"))},
        "financiado": _num(ler("financiado")),
        "subsidio": _num(ler("subsidio")),
        "fgts": _num(ler("fgts")),
        "corretor": ler("corretor"),
        "imobiliaria": ler("imobiliaria"),
        "venda_id_atual": ler("venda_id"),
        "condominio_id": so_hex(ler("condominio_id")),
        "situacao_atual": ler("situacao") or "",
    }


def assinatura(corpo_venda: dict, cpf: str) -> str:
    """8 caracteres que mudam se QUALQUER valor, data, parcela, obra, conta ou o CPF
    mudar. A prévia grava; o lançamento recalcula e recusa se não bater — assim
    só se grava o que alguém viu na prévia."""
    import hashlib
    import json as _json
    base = dict(corpo_venda)
    base.pop("customer", None)          # na prévia o cliente pode ainda não existir
    base.pop("seller", None)            # idem o corretor (o nome dele está na observação)
    txt = _json.dumps(base, sort_keys=True, ensure_ascii=False) + "|" + so_digitos(cpf)
    return hashlib.sha256(txt.encode("utf-8")).hexdigest()[:8]


_RE_ASSIN = re.compile(r"\[#([0-9a-f]{8})\]")


def assinatura_da_situacao(texto) -> str | None:
    m = _RE_ASSIN.search(str(texto or ""))
    return m.group(1) if m else None


# ---------------------------------------------------------------- parcelas

def _mais_dias(data_iso: str, dias: int) -> str:
    return (_dt.date.fromisoformat(data_iso[:10]) + _dt.timedelta(days=dias)).isoformat()


def parcelas(dados: dict, dias_financiamento: int = DIAS_FINANCIAMENTO) -> list[dict]:
    """[{tipo, rotulo, valor, data}] na ordem em que entram na venda.

    Financiamento = VALOR FINANCIADO + VALOR DO SUBSÍDIO (os dois são pagos pela
    Caixa na assinatura do contrato do banco). Sem data conhecida, financiamento
    e FGTS vencem na data da venda + `dias_financiamento` (é previsão; o ERP
    deixa editar a data quando o banco pagar)."""
    if dados.get("parcelas_prontas") is not None:   # condomínio: montadas por condominio.parcelas()
        return dados["parcelas_prontas"]
    out = []
    dv = dados.get("data_venda")

    def add(tipo, rotulo, valor, data):
        if valor is not None and valor > 0:
            out.append({"tipo": tipo, "rotulo": rotulo, "valor": round(float(valor), 2), "data": data})

    add(TIPO_SINAL, "Sinal", dados["sinal"]["valor"], dados["sinal"]["data"] or dv)
    add(TIPO_ENTRADA, "Entrada", dados["entrada"]["valor"], dados["entrada"]["data"])
    add(TIPO_INTERMEDIARIA, "Intermediária", dados["intermediaria"]["valor"], dados["intermediaria"]["data"])
    prev = _mais_dias(dv, dias_financiamento) if dv and _RE_ISO.match(dv) else None
    add(TIPO_FGTS, "FGTS", dados.get("fgts"), prev)
    fin = (dados.get("financiado") or 0) + (dados.get("subsidio") or 0)
    add(TIPO_FINANCIAMENTO, "Financiamento", fin or None, prev)
    return out


def resumo_parcelas(ps: list[dict]) -> str:
    """Texto curto das parcelas; série "Nome 1/N".."N/N" vira "Nome Nx R$ v de d1 a dN"."""
    partes, i = [], 0
    while i < len(ps):
        m = _RE_SERIE.match(ps[i]["rotulo"])
        if m:
            nome, n = m.group(1), int(m.group(3))
            grupo = ps[i:i + n]
            if len(grupo) == n and all(_RE_SERIE.match(g["rotulo"]) and _RE_SERIE.match(g["rotulo"]).group(1) == nome
                                       for g in grupo):
                vals = {g["valor"] for g in grupo}
                partes.append("%s %dx R$ %s de %s a %s" % (nome, n, "%.2f" % grupo[0]["valor"] if len(vals) == 1
                              else "variável", grupo[0]["data"], grupo[-1]["data"]))
                i += n
                continue
        partes.append("%s R$ %.2f em %s" % (ps[i]["rotulo"], ps[i]["valor"], ps[i]["data"]))
        i += 1
    return "; ".join(partes)


_RE_SERIE = re.compile(r"^(.*) (\d+)/(\d+)$")


def descricao(dados: dict) -> str:
    casa = dados.get("casa")
    return "VENDA CASA %02d - %s" % (casa or 0, " ".join(str(dados["comprador"]["nome"] or "").upper().split()))


def faltas(dados: dict, dias_financiamento: int = DIAS_FINANCIAMENTO) -> list[str]:
    f = []
    if not dados.get("endereco"):
        f.append("Venda sem ENDEREÇO")
    if dados.get("casa_ambigua"):
        f.append("CASA com mais de um número — deixe só o número da casa")
    elif not dados.get("casa"):
        f.append("Venda sem número da CASA")
    if not dados.get("data_venda"):
        f.append("Falta a DATA DA VENDA")
    elif not _RE_ISO.match(dados["data_venda"]):
        f.append("DATA DA VENDA em formato que não entendi")
    pp = dados.get("comissao_paga_por")
    if pp not in ("COMPRADOR", "VENDEDOR"):
        f.append("Falta COMISSÃO PAGA POR (comprador ou vendedor)")
    elif (pp == "COMPRADOR" and dados.get("valor_na_mao") and dados.get("comissao") is not None
          and dados.get("total") is not None
          and abs(dados["valor_na_mao"] + dados["comissao"] - dados["total"]) > TOLERANCIA):
        f.append("Valor na mão + comissão diferente do valor do contrato")
    if not str(dados.get("corretor") or "").strip():
        f.append("Falta o CORRETOR (ele vai como Vendedor no Mais Controle)")
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
        elif not _RE_ISO.match(p["data"]):
            f.append("Data da parcela %s em formato que não entendi" % p["rotulo"])
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


def corpo_corretor(dados: dict) -> dict:
    """POST {legado}/participants — corretor como Fornecedor, só com o nome (é o Vendedor da venda)."""
    return {"status": "ACTIVE", "type": "PERSON", "role": "SUPPLIER",
            "name": " ".join(str(dados.get("corretor") or "").upper().split()), "contacts": [], "phones": []}


def observacao(dados: dict) -> str:
    """Dados do corretor na observação da venda (o vendedor do ERP só aceita cadastro existente)."""
    partes = []
    if dados.get("corretor"):
        partes.append("Corretor: %s" % dados["corretor"])
    if dados.get("imobiliaria"):
        partes.append("Imobiliária: %s" % dados["imobiliaria"])
    if dados.get("comissao"):
        pp = {"COMPRADOR": "pelo comprador", "VENDEDOR": "pelo vendedor"}.get(dados.get("comissao_paga_por") or "", "")
        partes.append("Comissão: R$ %s%s" % (("%.2f" % dados["comissao"]).replace(".", ","), " (paga %s)" % pp if pp else ""))
    return " | ".join(partes)


def corpo_venda(dados: dict, obra: dict, cliente_id: str, conta: dict,
                responsavel_id: str | None = None, vendedor_id: str | None = None,
                dias_financiamento: int = DIAS_FINANCIAMENTO) -> dict:
    """POST {legado}/readjustment-sales.

    `obra` = {id, name}; `conta` = conta padrão da obra ({id, name, ...})."""
    ps = parcelas(dados, dias_financiamento)
    inst = []
    tabelas = dados.get("tabelas") or {}
    for p in ps:
        tab = p.get("tabela")
        comentario = p["rotulo"] if (p["rotulo"] == "Intermediária" or dados.get("parcelas_prontas") is not None) else None
        inst.append({"plannedValue": p["valor"], "plannedDate": p["data"], "comment": comentario,
                     "readjustmentDetail": {"type": {"id": p["tipo"]},
                                            "table": {"id": tabelas[tab], "name": tab} if tab else None,
                                            "rawValue": p["valor"], "reference": REFERENCIA_REAJUSTE if tab else 0}})
    total = round(sum(p["valor"] for p in ps), 2)
    tr = {
        "value": total, "grossValue": total, "taxWithhold": 0,
        "referenceDate": dados["data_venda"],
        "numberOfInstallments": len(inst),
        "nature": {"id": NATUREZA_VENDA, "name": "Venda"},   # o ERP exige o nome (NotBlank)
        "receivingCondition": {"id": CONDICAO_PARCELADO, "name": "Parcelado", "deferred": True},
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
    obs = observacao(dados)
    if obs:
        corpo["comment"] = obs
    return corpo


# ---------------------------------------------------------------- já existe?

_RE_CASA = re.compile(r"\b(?:CASAS?|CS|UNIDADE|UN)(?![A-MO-Z])[\s.\-:#]*(?:N[º°O.]?\s*)?0*(\d+)\s*([A-Z])?\b")


def casa_da_descricao(desc) -> int | None:
    """Número da casa na descrição da venda. None se não houver, ou se houver
    mais de um ("CASAS 01 E 02") ou sufixo de letra ("CASA 1A") — nesses casos
    não dá para afirmar de que casa é."""
    t = chave(desc).replace("º", "O").replace("°", "O")
    ms = list(_RE_CASA.finditer(t))
    if len(ms) != 1 or ms[0].group(2) or re.search(r"\bCASAS\b.*\d+\s*(?:E|,|/)\s*\d+", t):
        return None
    return int(ms[0].group(1))


def venda_da_casa(recebimentos: list[dict], obra_nome: str, casa: int) -> tuple[list[dict], list[dict]]:
    """(vendas da mesma casa, vendas da obra cuja descrição não diz a casa).

    Cada item: {id, descricao, cliente}. A segunda lista existe porque uma venda
    lançada à mão com descrição fora do padrão pode ser desta casa: nesse caso o
    robô recusa e pede conferência, em vez de arriscar uma venda duplicada."""
    alvo = chave(obra_nome)
    mesma, sem_casa, vistos = [], [], set()
    for r in recebimentos or []:
        sid = r.get("saleId")
        if chave(r.get("workName")) != alvo or not sid or sid in vistos:
            continue
        vistos.add(sid)
        item = {"id": sid, "descricao": r.get("description") or "", "cliente": r.get("customerName") or ""}
        c = casa_da_descricao(r.get("description"))
        if c == casa:
            mesma.append(item)
        elif c is None:
            sem_casa.append(item)
    return mesma, sem_casa
