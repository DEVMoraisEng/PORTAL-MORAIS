# -*- coding: utf-8 -*-
"""Números do financeiro por unidade. Dados inventados."""
import json

from venda.mc import financeiro_condominio as F

HOJE = "2026-11-09"


def p(data, valor, tipo="pre", **extra):
    base = {"data": data, "valor": valor, "tipo": tipo, "recebido": 0, "aberto": valor, "pago": False, "parcial": False}
    base.update(extra)
    return base


def test_cinco_colunas_e_soma_exata():
    r = F.resumo_da_venda([
        p("2026-10-10", 1000.10, recebido=1000.10, aberto=0, pago=True),
        p("2026-11-01", 200.20),                               # vencida
        p("2026-11-09", 300.30),                               # vence hoje: ainda não venceu
        p("2026-12-10", 400.40),
        p("2027-06-01", 5000.55, tipo="terceiros"),
        p("2026-11-20", 72000.00, tipo="entrada", permuta=True),
    ], HOJE)
    assert (r["recebido"], r["vencido"], r["a_vencer"], r["caixa"], r["permuta"]) == (1000.10, 200.20, 700.70, 5000.55, 72000.00)
    assert r["dias_atraso"] == 8
    assert r["proxima"] == {"data": "2026-11-09", "valor": 300.30}


def test_parcial_conta_o_que_entrou_e_o_saldo():
    r = F.resumo_da_venda([p("2026-11-01", 1000, recebido=400, aberto=600, parcial=True)], HOJE)
    assert (r["recebido"], r["vencido"]) == (400, 600)


def test_permuta_vencida_nao_vira_vencido():
    r = F.resumo_da_venda([p("2026-01-01", 72000, tipo="entrada", permuta=True)], HOJE)
    assert (r["vencido"], r["permuta"], r["dias_atraso"]) == (0, 72000, 0)


def test_fgts_vencido_nao_vira_vencido_do_comprador():
    r = F.resumo_da_venda([p("2026-01-01", 9000, tipo="terceiros")], HOJE)
    assert (r["vencido"], r["caixa"]) == (0, 9000)


def test_recebido_com_juros_e_o_dinheiro_que_entrou():
    r = F.resumo_da_venda([p("2026-10-01", 1000, recebido=1035.5, aberto=0, pago=True)], HOJE)
    assert r["recebido"] == 1035.5


def test_retrato_antigo_sem_campos_novos_nao_quebra():
    velha = [{"data": "2026-10-01", "valor": 100, "tipo": "pre", "pago": True, "parcial": False},
             {"data": "2026-10-02", "valor": 50, "tipo": "pre", "pago": False, "parcial": True}]
    r = F.resumo_da_venda(velha, HOJE)
    assert (r["recebido"], r["vencido"]) == (100, 50)


def texto(v):
    return {"type": "rich_text", "rich_text": [{"plain_text": v}]}


def linha(unidade, nome, venda="", retrato="", em=""):
    return {"properties": {"UNIDADE": {"type": "title", "title": [{"plain_text": unidade}]}, "PROPONENTE": texto(nome),
                           "MC - VENDA ID": texto(venda), "MC - RETRATO": texto(retrato), "MC - RETRATO EM": texto(em)}}


def test_montar_totais_batem_com_as_unidades_e_separa_os_avisos():
    ret = json.dumps({"parcelas": [p("2026-12-01", 0.1), p("2026-12-02", 0.2)]})
    d = F.montar([
        linha("10", "COMPRADOR B", "id1", ret, "2026-11-09 08:04"),
        linha("9", "COMPRADOR A", "id2", ret, "2026-11-09 08:03 | ERRO 2026-11-09 08:05: caiu"),
        linha("11", "COMPRADOR C"),
        linha("12", "COMPRADOR D", "id4", "ERRO: sem leitura", " | ERRO x"),
        linha("", "SEM UNIDADE", "id5", ret, "2026-11-09 08:04"),
    ], HOJE)
    assert [u["unidade"] for u in d["unidades"]] == ["9", "10"]
    assert d["totais"]["a_vencer"] == 0.6                     # em float 0.1+0.2+0.1+0.2 não daria 0,60 exato
    assert d["nao_lancadas"] == ["11"] and d["sem_leitura"] == ["12"]
    assert d["unidades"][0]["erro_leitura"] is True and d["unidades"][1]["erro_leitura"] is False
    assert d["lido"] == "2026-11-09 08:04"
    assert "centavos" not in d["unidades"][0]


def test_retrato_com_formato_estranho_vira_sem_leitura():
    d = F.montar([linha("1", "X", "id", json.dumps({"parcelas": "nao"}), "2026-11-09 08:00"),
                  linha("2", "Y", "id", json.dumps([1]), "2026-11-09 08:00")], HOJE)
    assert d["sem_leitura"] == ["1", "2"] and d["unidades"] == []


def test_titulos_batem_com_cada_numero():
    ret = json.dumps({"parcelas": [
        p("2026-10-10", 1000.1, recebido=1000.1, aberto=0, pago=True, pagoEm="2026-10-11"),
        p("2026-11-01", 1000, recebido=400, aberto=600, parcial=True),
        p("2026-12-10", 400.4),
        p("2027-06-01", 5000, tipo="terceiros", sub="fgts"),
        p("2026-11-20", 72000, tipo="entrada", permuta=True)]})
    d = F.montar([linha("9", "COMPRADOR A", "id", ret, "2026-11-09 08:04")], HOJE)
    t = d["titulos"]
    for coluna, total in d["totais"].items():
        assert round(sum(x["valor"] for x in t if x["coluna"] == coluna), 2) == total, coluna
    ven = [x for x in t if x["coluna"] == "vencido"][0]
    assert (ven["unidade"], ven["comprador"], ven["valor"], ven["dias_atraso"]) == ("9", "COMPRADOR A", 600, 8)
    assert [x["pago_em"] for x in t if x["coluna"] == "recebido"] == ["2026-10-11", ""]
    assert [x["sub"] for x in t if x["coluna"] == "caixa"] == ["fgts"]
    assert "titulos" not in d["unidades"][0]


def test_titulos_em_ordem_de_unidade_e_vencimento():
    r1 = json.dumps({"parcelas": [p("2026-12-10", 1), p("2026-11-10", 2)]})
    d = F.montar([linha("10", "B", "i", r1, "2026-11-09 08:04"), linha("9", "A", "i", r1, "2026-11-09 08:04")], HOJE)
    assert [(x["unidade"], x["data"]) for x in d["titulos"]] == [("9", "2026-11-10"), ("9", "2026-12-10"), ("10", "2026-11-10"), ("10", "2026-12-10")]


# ---------------------------------------------------------------- 11/11/2026: parcelas para a análise da diretoria
import pathlib

GABARITO = pathlib.Path(__file__).resolve().parents[2] / "testes" / "dados" / "financeiro-analise.json"
HOJE_ANALISE = "2026-11-11"
INDICES_TESTE = {"lido": "2026-11-11 08:01", "tabelas": {
    "INCC-M": {"2025-11": 0.30, "2025-12": 0.25, "2026-01": 0.40, "2026-02": 0.35, "2026-03": 0.50, "2026-04": 0.45,
               "2026-05": 0.60, "2026-06": 0.55, "2026-07": 0.30, "2026-08": 0.20, "2026-09": 0.42},
    "IPCA + 1% a.m.": {"2026-09": 1.38}}}


def _mensais(de_ano, de_mes, n):
    y, m = de_ano, de_mes
    for _ in range(n):
        yield "%04d-%02d" % (y, m)
        m += 1
        if m > 12:
            y, m = y + 1, 1


def linhas_de_teste():
    """Quatro vendas inventadas: em dia com um atraso, inadimplente com parcial e juros, permuta, e uma não lançada."""
    a = [p("2026-03-10", 1000, tipo="sinal", recebido=1000, aberto=0, pago=True, pagoEm="2026-03-08", raw=1000,
           rec=[["2026-03-08", 1000]])]
    for k, mes in enumerate(_mensais(2026, 4, 12)):
        valor = round(500 * (1 + 0.004 * k), 2)
        d = mes + "-10"
        if mes < "2026-11":
            quando = mes + ("-20" if mes == "2026-07" else "-09")
            a.append(p(d, valor, raw=500, recebido=valor, aberto=0, pago=True, pagoEm=quando, rec=[[quando, valor]]))
        else:
            a.append(p(d, valor, raw=500, rec=[]))
    a.append(p("2027-06-01", 50000, tipo="terceiros", sub="fgts", raw=50000, rec=[]))
    b = [p("2026-07-15", 800, raw=800, recebido=800, aberto=0, pago=True, pagoEm="2026-07-15", rec=[["2026-07-15", 800]]),
         # pago em duas vezes, com 10,00 de juros que o resumo do ERP soma e os recebimentos não
         p("2026-08-15", 804, raw=800, recebido=814, aberto=0, pago=True, pagoEm="2026-09-02",
           rec=[["2026-08-15", 400], ["2026-09-02", 404]]),
         p("2026-09-15", 806.4, raw=800, recebido=300, aberto=506.4, parcial=True, rec=[["2026-09-20", 300]]),
         p("2026-10-15", 810, raw=800, rec=[]),
         p("2026-12-15", 815.67, raw=800, rec=[])]
    c = [p("2026-11-20", 72000, tipo="entrada", permuta=True, raw=72000, rec=[]),
         p("2027-01-10", 5000, tipo="balao", raw=4900, rec=[]),
         p("2026-10-30", 2000, tipo="entrada", raw=2000, recebido=2000, aberto=0, pago=True, pagoEm="2026-10-30", rec=[])]
    em = "2026-11-11 08:04"
    return [linha("01", "COMPRADOR A", "id1", json.dumps({"parcelas": a}), em),
            linha("02", "COMPRADOR B", "id2", json.dumps({"parcelas": b}), em),
            linha("03", "COMPRADOR C", "id3", json.dumps({"parcelas": c}), em),
            linha("04", "COMPRADOR D")]


def gabarito():
    return dict(F.montar(linhas_de_teste(), HOJE_ANALISE), indices=INDICES_TESTE)


def test_repartir_mantem_o_recebido_do_erp_ao_centavo():
    # o resumo do ERP diz 1000,01 (com juros); os recebimentos somam 990,00
    assert F.repartir(100001, [["2026-10-01", 330.0], ["2026-10-15", 660.0]], "") == \
        [["2026-10-01", 333.33], ["2026-10-15", 666.68]]


def test_repartir_sem_recebimento_usa_a_quitacao_ou_fica_sem_data():
    assert F.repartir(50000, [], "2026-09-05") == [["2026-09-05", 500.0]]
    assert F.repartir(50000, None, "") == [["", 500.0]]
    assert F.repartir(0, [["2026-09-05", 10]], "") == []
    assert F.repartir(50000, [["2026-09-05", 0], ["2026-09-06", "n/d"]], "2026-09-07") == [["2026-09-07", 500.0]]


def test_parcelas_da_tela_somam_os_totais_ao_centavo():
    d = F.montar(linhas_de_teste(), HOJE_ANALISE)
    cent = lambda x: int(round(x * 100))
    assert sum(cent(v) for q in d["parcelas"] for _, v in q["r"]) == cent(d["totais"]["recebido"])
    assert sum(cent(q["a"]) for q in d["parcelas"]) == sum(cent(d["totais"][k]) for k in ("a_vencer", "vencido", "caixa", "permuta"))
    assert {q["u"] for q in d["parcelas"]} == {"01", "02", "03"}            # a não lançada fica fora


def test_parcela_da_tela_tem_as_chaves_do_plano():
    d = F.montar(linhas_de_teste(), HOJE_ANALISE)
    q = next(x for x in d["parcelas"] if x["u"] == "02" and x["d"] == "2026-08-15")
    assert q == {"u": "02", "t": "pre", "s": "", "d": "2026-08-15", "o": 800.0, "v": 804.0, "a": 0.0, "m": 0,
                 "q": "2026-09-02", "r": [["2026-08-15", 404.97], ["2026-09-02", 409.03]]}
    perm = next(x for x in d["parcelas"] if x["m"] == 1)
    assert (perm["u"], perm["a"], perm["r"]) == ("03", 72000.0, [])
    sem_rec = next(x for x in d["parcelas"] if x["u"] == "03" and x["d"] == "2026-10-30")
    assert sem_rec["r"] == [["2026-10-30", 2000.0]]                        # retrato antigo, sem rec: data da quitação


def test_parcela_sem_raw_usa_o_valor_como_original():
    ret = json.dumps({"parcelas": [p("2026-12-01", 123.45)]})
    d = F.montar([linha("9", "A", "i", ret, "2026-11-11 08:00")], HOJE_ANALISE)
    assert d["parcelas"][0]["o"] == 123.45


def test_parcelas_em_ordem_de_unidade_e_vencimento():
    d = F.montar(linhas_de_teste(), HOJE_ANALISE)
    chave = [(int(q["u"]), q["d"]) for q in d["parcelas"]]
    assert chave == sorted(chave)


def test_gabarito_da_analise_em_dia():
    """O node confere os mesmos totais na tela (venda/testes/boletos-analise.test.mjs)."""
    salvo = json.loads(GABARITO.read_text(encoding="utf-8"))
    assert salvo == json.loads(json.dumps(gabarito())), \
        "gabarito velho: py -3.14 -m venda.mc.testes.test_financeiro_condominio --gabarito"


if __name__ == "__main__":
    import sys
    if "--gabarito" in sys.argv:
        GABARITO.write_text(json.dumps(gabarito(), ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
        print("gravado", GABARITO)
