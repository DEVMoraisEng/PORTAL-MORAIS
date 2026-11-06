# -*- coding: utf-8 -*-
"""Boletos do mês do Reserva dos Ipês pela Cobrança Fácil (regra do dono, 06/11/2026).
As funções de regra são PURAS; as de ERP recebem o cliente (ErpPeloPorteiro no servidor)."""
import calendar

from . import distrato as D
from . import retrato as RT

EMITE = {"sinal", "entrada", "pre", "pos", "balao"}
# status que o ERP mostra como boleto vivo, agendado, pago ou em cancelamento: nunca emitir de novo
BLOQUEIA = {"AWAITING", "DRAFT", "ISSUED", "REGISTERED", "SETTLED", "RECEIVED", "PENDING_WRITE_OFF"}
TETO = 40
TABELAS = ("INCC-M", "IPCA + 1% a.m.")
# Regra do dono (06/11/2026): em novembro/2026 o boleto sai só 5 dias corridos antes do vencimento.
# Mês fora daqui = emite o mês inteiro assim que a parcela aparece (a partir de dezembro/2026).
ANTECEDENCIA_DIAS = {"2026-11": 5}

def _cadastro_ok(venda: dict) -> bool:
    c = venda.get("customer") or {}
    a = c.get("address") or {}
    return bool((c.get("cpf") or c.get("cnpj")) and a.get("zipCode") and a.get("address")
                and a.get("addressNumber") and a.get("neighborhood") and a.get("city"))

def _dias(de: str, ate: str) -> int:
    import datetime as dt
    return (dt.date.fromisoformat(ate) - dt.date.fromisoformat(de)).days

def selecionar(venda: dict, mes: str, hoje: str | None = None) -> list[dict]:
    """Uma linha por parcela da venda que vence em `mes` (AAAA-MM).
    acao: emitir | aguardar (ainda fora da antecedência do mês) | pular | decidir.
    `hoje` (AAAA-MM-DD) = dia da rodada; padrão: a data de hoje."""
    import datetime as dt
    hoje = hoje or dt.date.today().isoformat()
    antecedencia = ANTECEDENCIA_DIAS.get(mes)
    if ((venda.get("work") or {}).get("name") or "").strip() != RT.OBRA:
        return []
    ins = (venda.get("tradeReceivable") or {}).get("installments") or []
    sinais = sorted((str(p.get("plannedDate") or "")[:10], p.get("id") or "") for p in ins if RT._tipo(p) == "sinal")
    ato_id = sinais[0][1] if sinais else None
    cadastro = _cadastro_ok(venda)
    out = []
    for p in ins:
        data = str(p.get("plannedDate") or "")[:10]
        if data[:7] != mes:
            continue
        tipo = RT._tipo(p)
        linha = {"venda": venda.get("id"), "parcela": p.get("id"), "data": data, "tipo": tipo,
                 "valor": round(float(p.get("plannedValue") or 0), 2)}
        st = [str(b.get("status") or "") for b in p.get("billings") or []]
        if D.tem_recebimento(p):
            linha.update(acao="pular", motivo="já recebida")
        elif str(p.get("comment") or "").strip().lower().startswith("permuta"):
            linha.update(acao="pular", motivo="permuta (o carro paga, não é boleto)")
        elif tipo == "sinal" and p.get("id") == ato_id:
            linha.update(acao="pular", motivo="ato (sempre por Pix, nunca boleto)")
        elif tipo not in EMITE:
            linha.update(acao="pular" if tipo == "terceiros" else "decidir", motivo="tipo %s não emite" % tipo)
        elif any(s in BLOQUEIA for s in st):
            linha.update(acao="pular", motivo="já tem boleto (%s)" % ",".join(st))
        elif st:
            linha.update(acao="decidir", motivo="boleto anterior %s" % ",".join(st))
        elif linha["valor"] <= 0:
            linha.update(acao="decidir", motivo="valor zero")
        elif not cadastro:
            linha.update(acao="decidir", motivo="cadastro do comprador incompleto (CPF, CEP, endereço, número, bairro ou cidade)")
        elif data < hoje:
            linha.update(acao="decidir", motivo="venceu em %s sem boleto" % data)
        elif antecedencia is not None and _dias(hoje, data) > antecedencia:
            import datetime as dt
            quando = (dt.date.fromisoformat(data) - dt.timedelta(days=antecedencia)).isoformat()
            linha.update(acao="aguardar", motivo="emite a partir de %s (%d dias antes)" % (quando, antecedencia))
        else:
            linha.update(acao="emitir", motivo="")
        out.append(linha)
    return out

def _mes_menos(mes: str, n: int) -> str:
    a, m = int(mes[:4]), int(mes[5:7]) - n
    while m < 1:
        a, m = a - 1, m + 12
    return "%04d-%02d" % (a, m)

def indices_faltando(tabelas: list[dict], mes: str) -> list[str]:
    """Referência = 2 meses antes (regra de 06/10). Devolve 'TABELA AAAA-MM' de cada índice que falta."""
    ref = _mes_menos(mes, 2)
    falta = []
    for nome in TABELAS:
        t = [x for x in tabelas if (x.get("name") or "").strip().upper() == nome.upper()]
        meses = {str(p.get("date") or "")[:7] for x in t for p in x.get("periods") or []}
        if ref not in meses:
            falta.append("%s %s" % (nome, ref))
    return falta

def travas(linhas: list[dict], saldo: int, teto: int = TETO) -> str | None:
    n = sum(1 for l in linhas if l["acao"] == "emitir")
    if n > teto:
        return "%d boletos passam do teto de %d por rodada" % (n, teto)
    if n > saldo:
        return "saldo de %d créditos não cobre %d boletos" % (saldo, n)
    return None

def vendas_do_mes(erp, mes: str) -> list[str]:
    """Ids das vendas do condomínio com parcela vencendo no mês (lista de recebimentos da API legada)."""
    a, m = int(mes[:4]), int(mes[5:7])
    fim = "%s-%02d" % (mes, calendar.monthrange(a, m)[1])
    ids, pg = set(), 0
    while True:
        c = erp.pedir("GET", "/receipt-installments", params={
            "startDate": mes + "-01", "endDate": fim, "dateField": "PLANNED", "type": "ALL",
            "page": str(pg), "size": "500"}) or {}
        for x in c.get("content") or []:
            if (x.get("workName") or "").strip() == RT.OBRA and x.get("saleId"):
                ids.add(x["saleId"])
        if c.get("last") or not c.get("content"):
            return sorted(ids)
        pg += 1

def ler_venda(erp, venda_id: str) -> dict:
    return erp.pedir("GET", "/sales/%s" % venda_id) or {}

def ler_tabelas(erp) -> list[dict]:
    todas = erp.pedir("GET", "/readjustment-tables/all") or []
    return [erp.pedir("GET", "/readjustment-tables/%s" % t["id"]) or {} for t in todas
            if (t.get("name") or "").strip().upper() in {n.upper() for n in TABELAS}]

def ler_saldo(erp) -> int:
    return int((erp.pedir_core("GET", "/billings/balances") or {}).get("balance") or 0)
