# -*- coding: utf-8 -*-
"""Tabelas de reajuste alimentadas pelo Banco Central. Sem rede: ERP e séries falsos."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import indices as I  # noqa: E402

INCC, IPCA = I.TABELAS


class ErpFake:
    def __init__(self, tabelas=None, perde_mes=False):
        self.tabelas = {t["id"]: t for t in (tabelas or [])}
        self.chamadas, self.perde_mes = [], perde_mes

    def pedir(self, metodo, caminho, corpo=None, params=None):
        self.chamadas.append((metodo, caminho))
        if caminho == "/readjustment-tables/all":
            return [{"id": i, "name": t["name"]} for i, t in self.tabelas.items()]
        if metodo == "POST":
            corpo = dict(corpo, id="t%d" % (len(self.tabelas) + 1))
            self.tabelas[corpo["id"]] = corpo
            return corpo
        partes = caminho.split("/")
        if metodo == "PUT" and caminho.endswith("/process"):
            return None
        if metodo == "PUT":
            c = dict(corpo)
            if self.perde_mes:
                c["periods"] = c["periods"][:-1]
            self.tabelas[partes[2]] = c
            return c
        return self.tabelas.get(partes[2])


SERIES = {7456: {"2025-01": 0.5, "2025-02": 0.25}, 433: {"2025-01": 0.16, "2025-02": -0.32}}


def test_planejar_cria_com_acrescimo_e_valor_somado():
    p = I.planejar(IPCA, None, SERIES[433])
    assert p["criar"] and p["corpo"]["addition"] == 1.0 and p["corpo"]["name"] == "IPCA + 1% a.m."
    assert p["novos"] == [{"date": "2025-01-01", "readjust": 0.16, "value": 1.16},
                          {"date": "2025-02-01", "readjust": -0.32, "value": 0.68}]
    p = I.planejar(INCC, None, SERIES[7456])
    assert "addition" not in p["corpo"] and p["novos"][0]["value"] == 0.5


def test_planejar_so_acrescenta_mes_novo_e_avisa_revisao_sem_mudar():
    existente = {"id": "x", "name": "INCC-M", "periods": [{"id": "p1", "date": "2025-01-01T03:00:00", "readjust": 0.4}]}
    p = I.planejar(INCC, existente, SERIES[7456])
    assert not p["criar"] and [n["date"] for n in p["novos"]] == ["2025-02-01"]
    assert p["revisados"] == ["2025-01"] and p["corpo"]["periods"][0]["readjust"] == 0.4


def test_rodar_previa_nao_grava():
    erp = ErpFake()
    r = I.rodar(erp, False, SERIES)
    assert [x["situacao"] for x in r] == ["PREVIA", "PREVIA"]
    assert all(m == "GET" for m, _ in erp.chamadas)


def test_rodar_aplica_cria_confere_e_recalcula_e_depois_fica_em_dia():
    erp = ErpFake()
    r = I.rodar(erp, True, SERIES)
    assert [x["situacao"] for x in r] == ["ATUALIZADA", "ATUALIZADA"]
    assert ("PUT", "/readjustment-tables/t1/process") in erp.chamadas
    erp.chamadas.clear()
    r = I.rodar(erp, True, SERIES)
    assert [x["situacao"] for x in r] == ["EM_DIA", "EM_DIA"]
    assert all(m == "GET" for m, _ in erp.chamadas)


def test_rodar_mes_que_nao_ficou_gravado_e_erro():
    erp = ErpFake([{"id": "a", "name": "INCC-M", "periods": [{"date": "2025-01-01", "readjust": 0.5}]}], perde_mes=True)
    try:
        I.rodar(erp, True, {7456: SERIES[7456], 433: {}})
        assert False
    except I.ErpErro as e:
        assert "2025-02" in str(e)


def test_nome_repetido_recusa():
    erp = ErpFake([{"id": "a", "name": "INCC-M"}, {"id": "b", "name": "incc-m "}])
    r = I.rodar(erp, True, {7456: {}, 433: {}})
    assert r[0]["situacao"] == "RECUSADA"
