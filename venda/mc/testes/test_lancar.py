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
        for k, v in valores.items():   # como o Notion: a próxima leitura já vê o texto
            self.props[k] = txt(v)
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




def previa_e_lanca(n, e):
    """Prévia, depois o lançamento — como na tela (o PROCESSANDO leva a assinatura vista)."""
    r = L.processar("p1", n, e)
    assert r["situacao"] == "PREVIA", r
    assin = L.R.assinatura_da_situacao(n.props["MC - SITUAÇÃO"]["rich_text"][0]["plain_text"])
    n.props["MC - SITUAÇÃO"] = txt("PROCESSANDO (lançamento) — 06/10 01:00 [t=1] [#%s]" % assin)
    return L.processar("p1", n, e, aplicar=True)


def test_previa_nao_grava_no_erp_e_anota_no_notion_com_assinatura():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e)
    assert r["situacao"] == "PREVIA" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("PRÉVIA OK [#")
    assert r["corpo_venda"]["tradeReceivable"]["defaultAccount"] == {"id": "conta-1"}


def test_aplicar_depois_da_previa_cria_cliente_e_venda_e_grava_id():
    n, e = NotionFake(pagina()), ErpFake()
    r = previa_e_lanca(n, e)
    assert r["situacao"] == "CRIADA"
    assert [t for t, _ in e.criados] == ["cliente", "venda"]
    assert e.criados[1][1]["customer"] == {"id": "cli-novo"}
    assert n.gravado["MC - VENDA ID"] == "venda-nova"


def test_aplicar_sem_previa_ou_com_dado_mudado_recusa():
    n, e = NotionFake(pagina()), ErpFake()
    assert L.processar("p1", n, e, aplicar=True)["codigo"] == "PREVIA_DESATUALIZADA" and e.criados == []
    n, e = NotionFake(pagina()), ErpFake()
    L.processar("p1", n, e)
    assin = L.R.assinatura_da_situacao(n.props["MC - SITUAÇÃO"]["rich_text"][0]["plain_text"])
    n.props["CONTRATO - SINAL VALOR"] = {"type": "number", "number": 6000}
    n.props["VALOR FINANCIADO"] = {"type": "number", "number": 229000}
    n.props["MC - SITUAÇÃO"] = txt("PROCESSANDO (lançamento) [#%s]" % assin)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["codigo"] == "PREVIA_DESATUALIZADA" and e.criados == []


def test_cliente_existente_pelo_cpf_nao_cria_outro():
    n, e = NotionFake(pagina()), ErpFake(clientes=[{"id": "cli-velho", "cpf": CPF_OK}])
    previa_e_lanca(n, e)
    assert [t for t, _ in e.criados] == ["venda"] and e.criados[0][1]["customer"] == {"id": "cli-velho"}


def test_venda_da_casa_ja_lancada_nao_duplica_e_nao_preenche_venda_id():
    rec = [{"workName": OBRA, "description": "VENDA CASA 2 - OUTRA GRAFIA", "saleId": "s-antiga", "customerName": "Y"}]
    n, e = NotionFake(pagina()), ErpFake(recebimentos=rec)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "JA_EXISTE" and e.criados == []
    assert "MC - VENDA ID" not in n.gravado and "s-antiga" in n.gravado["MC - SITUAÇÃO"]


def test_venda_da_obra_sem_casa_na_descricao_recusa():
    rec = [{"workName": OBRA, "description": "SO O NOME DE ALGUEM", "saleId": "s-x"}]
    n, e = NotionFake(pagina()), ErpFake(recebimentos=rec)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["codigo"] == "VENDA_SEM_CASA_NA_OBRA" and e.criados == []


def test_obra_nao_encontrada_ou_repetida_recusa():
    for obras in ([], [{"id": "a", "name": OBRA}, {"id": "b", "name": OBRA.lower()}]):
        n, e = NotionFake(pagina()), ErpFake(obras=obras)
        r = L.processar("p1", n, e, aplicar=True)
        assert r["situacao"] == "RECUSADA" and e.criados == []


def test_obra_sem_conta_padrao_recusa():
    n, e = NotionFake(pagina()), ErpFake(conta=False)
    assert L.processar("p1", n, e)["codigo"] == "OBRA_SEM_CONTA"


def test_faltas_recusam_antes_de_falar_com_o_erp():
    class Explode(ErpFake):
        def obras(self):
            raise AssertionError("não devia chamar o ERP")
    n, e = NotionFake(pagina(CPF=txt("123"))), Explode()
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "RECUSADA" and any("CPF" in m for m in r["motivos"])


def test_ja_lancada_pelo_notion_nao_repete():
    n = NotionFake(pagina())
    n.props["MC - VENDA ID"] = txt("venda-x")
    e = ErpFake()
    assert L.processar("p1", n, e, aplicar=True)["situacao"] == "JA_LANCADA" and e.criados == []


def test_bloqueado_vira_previa_com_aviso_e_nao_grava():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e, aplicar=False, bloqueado=True)
    assert r["situacao"] == "PREVIA" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("BLOQUEADO:")


def test_cpf_em_dois_clientes_recusa():
    cli = [{"id": "a", "cpf": CPF_OK}, {"id": "b", "cpf": CPF_OK}]
    n, e = NotionFake(pagina()), ErpFake(clientes=cli)
    assert L.processar("p1", n, e)["situacao"] == "RECUSADA" and e.criados == []


def test_notion_falha_depois_de_criar_levanta():
    class NotionQueFalha(NotionFake):
        def gravar_textos(self, pid, props, valores):
            if "MC - VENDA ID" in valores:
                raise RuntimeError("Notion fora")
            return super().gravar_textos(pid, props, valores)
    n, e = NotionQueFalha(pagina()), ErpFake()
    try:
        previa_e_lanca(n, e)
        assert False, "devia levantar"
    except L.FalhaNotion:
        pass


def test_main_sem_segredos_anota_erro_e_log_sem_dado(monkeypatch, capsys):
    monkeypatch.delenv("MC_ROBO_EMAIL", raising=False)
    monkeypatch.delenv("MC_ROBO_SENHA", raising=False)
    monkeypatch.setenv("NOTION_TOKEN", "x")
    anotado = {}

    class N(NotionFake):
        def __init__(self, *_):
            super().__init__(pagina())

        def gravar_textos(self, pid, props, valores):
            anotado.update(valores)
            return []
    monkeypatch.setattr(L, "Notion", N)
    assert L.main(["--page", "a" * 32]) == 2
    assert anotado["MC - SITUAÇÃO"].startswith("ERRO:")
    saida = capsys.readouterr().out
    assert "SEM_SEGREDOS" in saida and CPF_OK not in saida and "Fulano" not in saida


def test_main_excecao_inesperada_nao_deixa_processando(monkeypatch, capsys):
    for k in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA"):
        monkeypatch.setenv(k, "x")
    anotado = {}

    class N(NotionFake):
        def __init__(self, *_):
            super().__init__(pagina())

        def gravar_textos(self, pid, props, valores):
            anotado.update(valores)
            return []

    class E(ErpFake):
        def __init__(self, *_):
            super().__init__()

        def obras(self):
            raise ValueError("html no lugar de json")
    monkeypatch.setattr(L, "Notion", N)
    monkeypatch.setattr(L, "Erp", E)
    assert L.main(["--page", "a" * 32]) == 1
    assert anotado["MC - SITUAÇÃO"].startswith("ERRO: falha inesperada (ValueError)")
    assert "html no lugar" not in capsys.readouterr().out
