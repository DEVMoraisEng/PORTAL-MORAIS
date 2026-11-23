# -*- coding: utf-8 -*-
"""Distrato de venda lançada à mão, achada pela casa (venda/mc/distrato_manual.py). Dados inventados."""
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import distrato_manual as M  # noqa: E402

OBRA = "RUA TESTE QD 01 LT 02"


def rt(s):
    return {"type": "rich_text", "rich_text": [{"plain_text": s}] if s else []}


def sel(s):
    return {"type": "select", "select": {"name": s} if s else None}


def arquivo(estado="SEM VENDA NO MAIS CONTROLE (a linha não tinha MC - VENDA ID) — nada a fazer no ERP",
            sinal="SIM", destino="RETIDO", casa="2", data="2026-10-21T12:00:00.000Z"):
    return {"id": "arq1", "properties": {
        "MC - DISTRATO": rt(estado), "ENDEREÇO": rt(OBRA), "CASA": rt(casa),
        "DATA": {"type": "date", "date": {"start": data}}, "HOUVE SINAL": sel(sinal), "DESTINO DO SINAL": sel(destino),
        "VENDA - PAGE ID": rt("0123456789abcdef0123456789abcdef"), "MC - VENDA ID": rt("")}}


class NotionFake:
    def __init__(self, arqs, comprador_atual=""):
        self.arqs, self.atual, self.gravado = arqs, comprador_atual, {}

    def linhas(self, db):
        return self.arqs

    def pagina(self, pid):
        return {"properties": {"CLIENTES": rt(self.atual)}}

    def gravar_textos(self, pid, props, valores):
        self.gravado.update(valores)
        return []


def venda(vid, desc, recebida=True, aberta=False):
    parcs = [{"id": vid + "-p1", "plannedValue": 5000, "plannedDate": "2026-08-18",
              "receipts": [{"value": 5000}] if recebida else [], "sumOfReceivedValues": 5000 if recebida else 0}]
    if aberta:
        parcs.append({"id": vid + "-p2", "plannedValue": 100000, "plannedDate": "2026-12-01", "receipts": [],
                      "sumOfReceivedValues": 0})
    return {"id": vid, "description": desc, "readjustmentEnabled": True, "work": {"name": OBRA},
            "tradeReceivable": {"installments": parcs, "value": 5000, "taxWithhold": 0}}


class ErpFake:
    def __init__(self, vendas):
        self.v = {x["id"]: x for x in vendas}
        self.puts = []

    def recebimentos(self):
        return [{"saleId": vid, "workName": OBRA, "description": x["description"], "customerName": "SPE EXEMPLO",
                 "referenceDate": "2026-08-18"} for vid, x in self.v.items()]

    def pedir(self, metodo, caminho, corpo=None, params=None):
        vid = caminho.rsplit("/", 1)[-1]
        if metodo == "GET":
            return copy.deepcopy(self.v[vid])
        if metodo == "PUT":
            self.puts.append(vid)
            self.v[vid] = copy.deepcopy(corpo)
            return {}
        raise AssertionError(metodo)


def test_venda_manual_com_sinal_retido_vira_distrato_so_na_descricao():
    n, e = NotionFake([arquivo()]), ErpFake([venda("v1", "CASA 02 - COMPRADORA ANTIGA")])
    c = M.processar(n, e, aplicar=True, hoje="23/11/2026")
    assert c["APLICAR"] == 1 and e.puts == ["v1"]
    assert e.v["v1"]["description"] == "CASA 02 - COMPRADORA ANTIGA (Distrato)"
    assert n.gravado["MC - VENDA ID"] == "v1" and n.gravado["MC - DISTRATO"].startswith("DISTRATO APLICADO")


def test_sem_aplicar_nao_grava_nada():
    n, e = NotionFake([arquivo()]), ErpFake([venda("v1", "CASA 02")])
    assert M.processar(n, e)["APLICAR"] == 1 and e.puts == [] and n.gravado == {}


def test_venda_do_comprador_atual_fica_fora():
    n = NotionFake([arquivo()], comprador_atual="Fulano Novo De Tal")
    e = ErpFake([venda("v1", "VENDA CASA 02 - FULANO NOVO DE TAL")])
    c = M.processar(n, e, aplicar=True, hoje="23/11/2026")
    assert c["LIMPO"] == 1 and e.puts == [] and n.gravado["MC - DISTRATO"].startswith("CONFERIDO PELA CASA")


def test_venda_com_parcela_em_aberto_so_avisa():
    n, e = NotionFake([arquivo()]), ErpFake([venda("v1", "CASA 02", aberta=True)])
    c = M.processar(n, e, aplicar=True, hoje="23/11/2026")
    assert c["ATENCAO"] == 1 and e.puts == [] and n.gravado["MC - DISTRATO"].startswith("ATENÇÃO")


def test_sem_sinal_nao_exclui_venda_manual_so_avisa():
    n, e = NotionFake([arquivo(sinal="NÃO", destino="NÃO HOUVE")]), ErpFake([venda("v1", "CASA 02", recebida=False)])
    assert M.processar(n, e, aplicar=True)["ATENCAO"] == 1 and e.puts == []


def test_devolvido_so_avisa():
    n, e = NotionFake([arquivo(destino="DEVOLVIDO")]), ErpFake([venda("v1", "CASA 02")])
    assert M.processar(n, e, aplicar=True)["ATENCAO"] == 1 and e.puts == []


def test_duas_vendas_da_casa_so_avisa():
    n, e = NotionFake([arquivo()]), ErpFake([venda("v1", "CASA 02 - A"), venda("v2", "VENDA CASA 2 - B")])
    assert M.processar(n, e, aplicar=True)["ATENCAO"] == 1 and e.puts == []


def test_ja_marcada_ou_outra_casa_nao_mexe():
    n = NotionFake([arquivo()])
    e = ErpFake([venda("v1", "CASA 02 (Distrato)"), venda("v2", "CASA 01 - OUTRA")])
    assert M.processar(n, e, aplicar=True)["LIMPO"] == 1 and e.puts == []


def test_arquivo_ja_tratado_e_pulado():
    n = NotionFake([arquivo(estado="DISTRATO APLICADO — venda x"), arquivo(estado="CONFERIDO PELA CASA em 23/11/2026: ...")])
    e = ErpFake([venda("v1", "CASA 02")])
    c = M.processar(n, e, aplicar=True)
    assert c["pendentes"] == 0 and e.puts == [] and n.gravado == {}


def test_mesmo_comprador_tolera_digitacao_e_ignora_preposicoes():
    assert M.mesmo_comprador("Beltrana Exemplo Ficticia", "BELTRANA EXEMPLO FICTICIAA", "CASA 02")
    assert M.mesmo_comprador("Ciclano de Teste Inventado", "SPE", "CASA 02 - CICLANO DE TESTE INVENTADU")
    assert not M.mesmo_comprador("Ciclano de Teste Inventado", "SPE", "CASA 02 - FULANA DE OUTRO")
    assert not M.mesmo_comprador("", "x", "y")
