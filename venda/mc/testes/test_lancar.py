# -*- coding: utf-8 -*-
"""Fluxo do lançamento com Notion e ERP de mentira. Dados inventados."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import lancar as L  # noqa: E402
from venda.mc.testes.test_regras import pagina, txt, CPF_OK  # noqa: E402

OBRA = "RUA TESTE QD 01 LT 02"


class NotionFake:
    def __init__(self, props):
        self.props = dict(props)
        self.props["MC - SITUAÇÃO"] = {"type": "rich_text", "rich_text": []}
        self.props["MC - VENDA ID"] = {"type": "rich_text", "rich_text": []}
        self.gravado = {}

    def pagina(self, pid):
        return {"properties": self.props}

    def gravar_textos(self, pid, props, valores):
        self.gravado.update(valores)
        return []


class ErpFake:
    user_id = "u-robo"

    def __init__(self, obras=None, conta=True, recebimentos=None, clientes=None):
        self._obras = obras if obras is not None else [{"id": "obra-1", "name": OBRA}]
        self._conta = {"id": "conta-1", "name": "CONTA DA OBRA"} if conta else None
        self._rec = recebimentos or []
        self._cli = clientes or []
        self.criados = []

    def obras(self):
        return self._obras

    def obra(self, oid):
        return {"id": oid, "defaultAccount": self._conta}

    def recebimentos(self):
        return self._rec

    def cliente_por_cpf(self, cpf):
        return [c for c in self._cli if c["cpf"] == cpf]

    def participante_por_nome(self, nome):
        return []

    def criar_cliente(self, corpo):
        self.criados.append(("cliente", corpo))
        return {"id": "cli-novo"}

    def criar_venda(self, corpo):
        self.criados.append(("venda", corpo))
        return {"id": "venda-nova"}


def test_previa_nao_grava_no_erp_e_anota_no_notion():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e)
    assert r["situacao"] == "PREVIA" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("PRÉVIA OK — cliente novo será criado")
    assert r["corpo_venda"]["tradeReceivable"]["defaultAccount"] == {"id": "conta-1"}


def test_aplicar_cria_cliente_e_venda_e_grava_id():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "CRIADA"
    assert [t for t, _ in e.criados] == ["cliente", "venda"]
    assert e.criados[1][1]["customer"] == {"id": "cli-novo"}
    assert n.gravado["MC - VENDA ID"] == "venda-nova"


def test_cliente_existente_pelo_cpf_nao_cria_outro():
    n, e = NotionFake(pagina()), ErpFake(clientes=[{"id": "cli-velho", "cpf": CPF_OK}])
    r = L.processar("p1", n, e, aplicar=True)
    assert [t for t, _ in e.criados] == ["venda"] and e.criados[0][1]["customer"] == {"id": "cli-velho"}


def test_venda_da_casa_ja_lancada_a_mao_nao_duplica():
    rec = [{"workName": OBRA, "description": "VENDA CASA 2 - OUTRA GRAFIA", "saleId": "s-antiga"}]
    n, e = NotionFake(pagina()), ErpFake(recebimentos=rec)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "JA_EXISTE" and e.criados == []
    assert n.gravado["MC - VENDA ID"] == "s-antiga"


def test_obra_nao_encontrada_ou_repetida_recusa():
    for obras in ([], [{"id": "a", "name": OBRA}, {"id": "b", "name": OBRA.lower()}]):
        n, e = NotionFake(pagina()), ErpFake(obras=obras)
        r = L.processar("p1", n, e, aplicar=True)
        assert r["situacao"] == "RECUSADA" and e.criados == []


def test_obra_sem_conta_padrao_recusa():
    n, e = NotionFake(pagina()), ErpFake(conta=False)
    assert L.processar("p1", n, e, aplicar=True)["situacao"] == "RECUSADA"


def test_faltas_recusam_antes_de_falar_com_o_erp():
    class Explode(ErpFake):
        def obras(self):
            raise AssertionError("não devia chamar o ERP")
    n, e = NotionFake(pagina(CPF=txt("123"))), Explode()
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "RECUSADA" and "CPF" in r["motivos"][0]


def test_ja_lancada_pelo_notion_nao_repete():
    p = pagina()
    n = NotionFake(p)
    n.props["MC - VENDA ID"] = txt("venda-x")
    e = ErpFake()
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "JA_LANCADA" and e.criados == []


def test_bloqueado_vira_previa_com_aviso_e_nao_grava():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e, aplicar=False, bloqueado=True)
    assert r["situacao"] == "PREVIA" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("BLOQUEADO:")


def test_cpf_em_dois_clientes_recusa():
    cli = [{"id": "a", "cpf": CPF_OK}, {"id": "b", "cpf": CPF_OK}]
    n, e = NotionFake(pagina()), ErpFake(clientes=cli)
    assert L.processar("p1", n, e, aplicar=True)["situacao"] == "RECUSADA" and e.criados == []
