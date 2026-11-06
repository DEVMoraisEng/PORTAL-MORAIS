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

def test_vendas_do_mes_pagina_e_filtra_a_obra():
    class Falso:
        def __init__(s): s.urls = []
        def pedir(s, metodo, caminho, corpo=None, params=None):
            s.urls.append((caminho, dict(params)))
            pg = int(params["page"])
            itens = [{"saleId": "v1", "workName": "CONDOMÍNIO RESERVA DOS IPÊS"},
                     {"saleId": "v2", "workName": "OUTRA"}] if pg == 0 else [{"saleId": "v1", "workName": "CONDOMÍNIO RESERVA DOS IPÊS"}]
            return {"content": itens, "last": pg == 1}
    f = Falso()
    assert B.vendas_do_mes(f, "2026-11") == ["v1"]
    assert f.urls[0][1]["startDate"] == "2026-11-01" and f.urls[0][1]["endDate"] == "2026-11-30"
    assert len(f.urls) == 2

class ErpFalso:
    def __init__(s, venda, ao_emitir="cria", erro=None, boleto=None, leituras_ruins=0, excecao=None):
        s.venda, s.ao_emitir, s.erro, s.posts = venda, ao_emitir, erro, 0
        s.boleto = boleto or {"status": "DRAFT"}
        s.leituras, s.leituras_ruins, s.excecao = 0, leituras_ruins, excecao
    def pedir(s, metodo, caminho, corpo=None, params=None):
        s.leituras += 1
        if s.leituras > 1 and s.leituras - 1 <= s.leituras_ruins:   # a 1ª leitura (antes do POST) sempre funciona
            raise RuntimeError("a releitura caiu")
        return copy.deepcopy(s.venda)
    def pedir_core(s, metodo, caminho, corpo=None, params=None):
        assert metodo == "POST" and caminho.endswith("/generation")
        s.posts += 1
        if s.ao_emitir == "cria":
            p = [q for q in s.venda["tradeReceivable"]["installments"] if caminho.split("/")[3] == q["id"]][0]
            p["billings"] = [dict(s.boleto)]
        if s.excecao:
            raise s.excecao
        if s.erro:
            raise B.ErpErro(s.erro)

def _uma(v):
    v["tradeReceivable"]["installments"] = []
    return parcela(v, R.TIPO_ENTRADA, "2026-11-10")

def test_emite_e_confirma():
    v = venda(); p = _uma(v); f = ErpFalso(v)
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "EMITIDO" and r["status"] == "DRAFT" and f.posts == 1

def test_nao_emite_se_ja_tem():
    v = venda(); p = _uma(v); p["billings"] = [{"status": "REGISTERED"}]; f = ErpFalso(v)
    assert B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)["situacao"] == "JA_TINHA" and f.posts == 0

def test_erro_mas_boleto_nasceu_conta_como_emitido_sem_repetir():
    v = venda(); p = _uma(v); f = ErpFalso(v, "cria", erro="a tela parou de responder")
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "EMITIDO" and f.posts == 1

def test_erro_e_nada_nasceu_fica_sem_confirmacao_e_nunca_repete():
    v = venda(); p = _uma(v); f = ErpFalso(v, "nada", erro="a tela parou de responder")
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "SEM_CONFIRMACAO" and f.posts == 1

def test_boleto_que_demora_aparece_na_segunda_leitura():
    v = venda(); p = _uma(v); f = ErpFalso(v, "nada"); esperas = []
    def esperar(s):
        esperas.append(s); p["billings"] = [{"status": "DRAFT"}]   # nasceu enquanto o robô esperava
    r = B.emitir_uma(f, v["id"], p["id"], esperar=esperar)
    assert r["situacao"] == "EMITIDO" and esperas == [10] and f.posts == 1

def test_recusa_do_erp_guarda_o_motivo():
    v = venda(); p = _uma(v); f = ErpFalso(v, "nada", erro="POST /billings -> HTTP 400: billing.data.invalid")
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "RECUSADO" and "billing.data.invalid" in r["motivo"]

# I1 — o status do boleto que apareceu decide
def test_boleto_que_nasce_falho_vira_recusa_com_o_motivo():
    v = venda(); p = _uma(v); f = ErpFalso(v, boleto={"status": "FAILED", "failureReason": "cpf.invalido"})
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "RECUSADO" and r["motivo"] == "cpf.invalido" and f.posts == 1

def test_boleto_rejeitado_sem_motivo_usa_o_status():
    v = venda(); p = _uma(v); f = ErpFalso(v, boleto={"status": "REJECTED"})
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "RECUSADO" and r["motivo"] == "REJECTED"

def test_boleto_com_status_estranho_fica_sem_confirmacao():
    v = venda(); p = _uma(v); f = ErpFalso(v, boleto={"status": "WRITTEN_OFF"})
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "SEM_CONFIRMACAO" and "WRITTEN_OFF" in r["motivo"] and f.posts == 1

def test_vale_o_boleto_mais_novo():
    v = venda(); p = _uma(v); f = ErpFalso(v, "nada")
    def esperar(s):
        p["billings"] = [{"status": "FAILED"}, {"status": "REGISTERED"}]
    r = B.emitir_uma(f, v["id"], p["id"], esperar=esperar)
    assert r["situacao"] == "EMITIDO" and r["status"] == "REGISTERED"

# I2 — 5xx, 408 e 429 são como prazo estourado: relê com espera, nunca repete
def test_erro_5xx_e_boleto_aparece_depois_conta_como_emitido():
    v = venda(); p = _uma(v); f = ErpFalso(v, "nada", erro="POST /billings -> HTTP 504: gateway"); esperas = []
    def esperar(s):
        esperas.append(s); p["billings"] = [{"status": "DRAFT"}]
    r = B.emitir_uma(f, v["id"], p["id"], esperar=esperar)
    assert r["situacao"] == "EMITIDO" and esperas == [10] and f.posts == 1

def test_erro_5xx_408_429_sem_boleto_fica_sem_confirmacao():
    for st in (500, 408, 429):
        v = venda(); p = _uma(v); f = ErpFalso(v, "nada", erro="POST /billings -> HTTP %d: x" % st); esperas = []
        r = B.emitir_uma(f, v["id"], p["id"], esperar=esperas.append)
        assert r["situacao"] == "SEM_CONFIRMACAO" and esperas == [10, 10] and f.posts == 1, st
        assert "HTTP %d" % st in r["motivo"]

# I3 — qualquer exceção no POST ou na releitura depois dele não sobe nem repete o POST
def test_excecao_qualquer_no_post_e_releitura_que_cai_nao_repetem():
    v = venda(); p = _uma(v); f = ErpFalso(v, "cria", excecao=RuntimeError("chrome fechou"), leituras_ruins=2)
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "EMITIDO" and f.posts == 1 and f.leituras == 4

def test_todas_as_releituras_caem_fica_sem_confirmacao():
    v = venda(); p = _uma(v); f = ErpFalso(v, "cria", leituras_ruins=99)
    r = B.emitir_uma(f, v["id"], p["id"], esperar=lambda s: None)
    assert r["situacao"] == "SEM_CONFIRMACAO" and "a releitura caiu" in r["motivo"] and f.posts == 1
