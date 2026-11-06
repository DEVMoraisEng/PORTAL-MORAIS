import copy, json, pathlib
from venda.mc import boletos as B
from venda.mc import regras as R

BASE = json.loads((pathlib.Path(__file__).parent / "dados" / "antecipacao" / "base.json").read_text(encoding="utf-8"))

def venda(**mudar):
    v = copy.deepcopy(BASE)
    v["customer"] = {"cpf": "00000000000", "address": {"zipCode": "75250000", "address": "RUA A",
                     "addressNumber": "1", "neighborhood": "CENTRO", "city": {"id": "x"}}}
    v.update(mudar)
    return v

def parcela(v, tipo_id, data, valor=100.0, **extra):
    p = {"id": "p-%d" % len(v["tradeReceivable"]["installments"]), "plannedDate": data, "plannedValue": valor,
         "readjustmentDetail": {"type": {"id": tipo_id}}, "billings": [], "receipts": [], "received": False}
    p.update(extra)
    v["tradeReceivable"]["installments"].append(p)
    return p

def acao(linhas, pid):
    return [l for l in linhas if l["parcela"] == pid][0]["acao"]

def test_novembro_so_5_dias_antes():
    v = venda(); v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)
    perto = parcela(v, R.TIPO_SINAL, "2026-11-10")
    longe = parcela(v, R.TIPO_SINAL, "2026-11-30")
    l = B.selecionar(v, "2026-11", hoje="2026-11-06")
    assert acao(l, perto["id"]) == "emitir" and acao(l, longe["id"]) == "aguardar"
    assert acao(B.selecionar(v, "2026-11", hoje="2026-11-25"), longe["id"]) == "emitir"
    assert acao(B.selecionar(v, "2026-11", hoje="2026-11-24"), longe["id"]) == "aguardar"

def test_dezembro_emite_o_mes_inteiro_no_dia_1():
    v = venda(); v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)
    fim = parcela(v, R.TIPO_SINAL, "2026-12-30")
    assert acao(B.selecionar(v, "2026-12", hoje="2026-12-01"), fim["id"]) == "emitir"

def test_vencida_sem_boleto_vai_para_decidir():
    v = venda(); v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)
    velha = parcela(v, R.TIPO_SINAL, "2026-12-02")
    assert acao(B.selecionar(v, "2026-12", hoje="2026-12-03"), velha["id"]) == "decidir"

def test_so_o_mes_vigente():
    v = venda(); v["tradeReceivable"]["installments"] = []
    a = parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)          # ato
    b = parcela(v, R.TIPO_SINAL, "2026-11-30")
    c = parcela(v, R.TIPO_SINAL, "2026-12-30")
    l = B.selecionar(v, "2026-11", hoje="2026-11-28")
    assert [x["parcela"] for x in l] == [b["id"]] and acao(l, b["id"]) == "emitir"

def test_ato_em_aberto_pula():
    v = venda(); v["tradeReceivable"]["installments"] = []
    a = parcela(v, R.TIPO_SINAL, "2026-11-03")
    assert acao(B.selecionar(v, "2026-11", hoje="2026-11-01"), a["id"]) == "pular"

def test_financiamento_e_fgts_pulam():
    v = venda(); v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-01", received=True)
    f = parcela(v, R.TIPO_FINANCIAMENTO, "2026-11-30"); g = parcela(v, R.TIPO_FGTS, "2026-11-30")
    l = B.selecionar(v, "2026-11", hoje="2026-11-01")
    assert acao(l, f["id"]) == "pular" and acao(l, g["id"]) == "pular"

def test_ja_tem_boleto_pula_e_falhou_antes_decide():
    v = venda(); v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-01", received=True)
    r = parcela(v, R.TIPO_ENTRADA, "2026-11-10", billings=[{"status": "REGISTERED"}])
    f = parcela(v, R.TIPO_ENTRADA, "2026-11-11", billings=[{"status": "FAILED"}])
    l = B.selecionar(v, "2026-11", hoje="2026-11-01")
    assert acao(l, r["id"]) == "pular" and acao(l, f["id"]) == "decidir"

def test_permuta_lancada_como_entrada_nunca_emite():
    v = venda(); v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-01", received=True)
    c = parcela(v, R.TIPO_ENTRADA, "2026-11-10", comment="Permuta - carro")
    assert acao(B.selecionar(v, "2026-11", hoje="2026-11-01"), c["id"]) == "pular"

def test_cadastro_incompleto_decide():
    v = venda(); v["customer"]["address"]["zipCode"] = ""; v["tradeReceivable"]["installments"] = []
    parcela(v, R.TIPO_SINAL, "2026-10-01", received=True)
    e = parcela(v, R.TIPO_ENTRADA, "2026-11-10")
    assert acao(B.selecionar(v, "2026-11", hoje="2026-11-01"), e["id"]) == "decidir"

def test_outra_obra_nao_entra():
    v = venda(work={"name": "OUTRA OBRA"})
    assert B.selecionar(v, "2026-11", hoje="2026-11-01") == []

def test_indices_faltando_pede_o_mes_de_referencia():
    tab = [{"name": "INCC-M", "periods": [{"date": "2026-09-01"}]},
           {"name": "IPCA + 1% a.m.", "periods": [{"date": "2026-08-01"}]}]
    assert B.indices_faltando(tab, "2026-11") == ["IPCA + 1% a.m. 2026-09"]

def test_travas_saldo_e_teto():
    linhas = [{"acao": "emitir"}] * 3
    assert B.travas(linhas, saldo=2) == "saldo de 2 créditos não cobre 3 boletos"
    assert B.travas([{"acao": "emitir"}] * 41, saldo=100) == "41 boletos passam do teto de 40 por rodada"
    assert B.travas(linhas, saldo=100) is None
