# -*- coding: utf-8 -*-
"""Boletos do mês do Reserva dos Ipês pela Cobrança Fácil (regra do dono, 06/11/2026).
As funções de regra são PURAS; as de ERP recebem o cliente (ErpPeloPorteiro no servidor)."""
import calendar
import re
import time

from . import distrato as D
from . import retrato as RT
from .erp import ErpErro

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

def _parcela(venda: dict, parcela_id: str) -> dict | None:
    for p in (venda.get("tradeReceivable") or {}).get("installments") or []:
        if p.get("id") == parcela_id:
            return p
    return None

FALHOU = {"FAILED", "REJECTED"}

def _http(erro: str) -> int | None:
    """Status HTTP da mensagem do ErpErro ("<M> <caminho> -> HTTP <status>: <corpo>", erp.py) ou None."""
    m = re.search(r" -> HTTP (\d{3})\b", erro or "")
    return int(m.group(1)) if m else None

def _recusa_clara(erro: str) -> bool:
    """Só 4xx (fora 408 e 429) é recusa: o ERP leu o pedido e disse não. 5xx/408/429 podem ter concluído."""
    st = _http(erro)
    return st is not None and 400 <= st < 500 and st not in (408, 429)

def emitir_uma(erp, venda_id: str, parcela_id: str, esperar=time.sleep, tentativas: int = 3) -> dict:
    """Relê, emite UMA vez e relê. Nunca repete o POST: um pedido que estourou o prazo pode concluir depois.
    A emissão demora (o boleto nasce DRAFT, "Em processamento", e vira REGISTERED depois): relê até
    `tentativas` vezes, 10 s entre elas; DRAFT já conta como emitido. Decide pelo boleto mais novo:
    status de BLOQUEIA = EMITIDO; FAILED/REJECTED = RECUSADO; outro = SEM_CONFIRMACAO.
    A leitura ANTES do POST pode levantar (nada foi pedido); depois do POST nada levanta."""
    antes = _parcela(ler_venda(erp, venda_id), parcela_id)
    if antes is None:
        return {"situacao": "RECUSADO", "status": "", "motivo": "parcela sumiu da venda"}
    if antes.get("billings"):
        return {"situacao": "JA_TINHA", "status": ",".join(str(b.get("status")) for b in antes["billings"]), "motivo": ""}
    erro = ""
    try:
        erp.pedir_core("POST", "/billings/installments/%s/generation" % parcela_id)
    except Exception as e:   # qualquer falha: o pedido pode ter chegado; nunca repetir
        erro = (str(e) or type(e).__name__)[:300]
    recusa = _recusa_clara(erro)
    depois, leu, erro_leitura = {}, False, ""
    for i in range(tentativas):
        try:
            depois = _parcela(ler_venda(erp, venda_id), parcela_id) or {}
            leu = True
        except Exception as e:
            depois, erro_leitura = {}, (str(e) or type(e).__name__)[:300]
        if depois.get("billings") or recusa:
            break
        if i + 1 < tentativas:
            esperar(10)
    if depois.get("billings"):
        b = depois["billings"][-1]
        st = str(b.get("status") or "")
        if st.upper() in BLOQUEIA:
            return {"situacao": "EMITIDO", "status": st, "motivo": erro}
        if st.upper() in FALHOU:
            return {"situacao": "RECUSADO", "status": st, "motivo": str(b.get("failureReason") or "") or st}
        return {"situacao": "SEM_CONFIRMACAO", "status": st, "motivo": "boleto com status %s" % (st or "vazio")}
    if recusa:
        return {"situacao": "RECUSADO", "status": "", "motivo": erro}
    if not leu:
        return {"situacao": "SEM_CONFIRMACAO", "status": "",
                "motivo": "; ".join(x for x in (erro, "releitura falhou: " + erro_leitura) if x)}
    return {"situacao": "SEM_CONFIRMACAO", "status": "", "motivo": erro or "o ERP aceitou mas o boleto não apareceu"}
