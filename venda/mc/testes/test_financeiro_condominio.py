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
