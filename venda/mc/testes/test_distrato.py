# -*- coding: utf-8 -*-
"""Distrato no Mais Controle com Notion e ERP de mentira. Dados inventados."""
import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import distrato as D  # noqa: E402
from venda.mc.erp import ErpErro  # noqa: E402

BASE_DIST = "d" * 32


def txt(s):
    return {"type": "rich_text", "rich_text": [{"plain_text": s}] if s else []}


def sel(s):
    return {"type": "select", "select": {"name": s} if s else None}


def parcela(pid, data, valor, recebido=0.0, quitada=None):
    quitada = (recebido >= valor) if quitada is None else quitada
    return {"id": pid, "plannedDate": data + "T00:00:00", "plannedValue": valor, "received": quitada,
            "receipts": [{"value": recebido}] if recebido else [], "sumOfReceivedValues": recebido,
            "pendingValue": round(valor - recebido, 2)}


def venda(parcelas, desc="VENDA CASA 02 - COMPRADOR EXEMPLO", reaj=True):
    total = sum(p["plannedValue"] for p in parcelas)
    return {"id": "v-1", "description": desc, "readjustmentEnabled": reaj, "work": {"name": "RUA TESTE QD 01 LT 02"},
            "tradeReceivable": {"id": "tr-1", "grossValue": total, "value": total, "taxWithhold": 0,
                                "numberOfInstallments": len(parcelas), "installments": parcelas}}


SINAL = parcela("p1", "2026-09-01", 10000.0, 10000.0)
ABERTAS = [parcela("p2", "2026-11-01", 50000.0), parcela("p3", "2026-12-01", 140000.0)]


class ErpFake:
    def __init__(self, v):
        self.v = copy.deepcopy(v)
        self.chamadas = []
        self.apagada = False
        self.ignora_put = False

    def pedir(self, metodo, caminho, corpo=None, params=None):
        self.chamadas.append((metodo, caminho))
        if metodo == "GET" and caminho == "/sales/v-1":
            if self.apagada:
                raise ErpErro("GET /sales/v-1 -> HTTP 404: não existe")
            return copy.deepcopy(self.v)
        if metodo == "DELETE" and caminho == "/sales/v-1":
            self.apagada = True
            return None
        if metodo == "PUT" and caminho == "/readjustment-sales/v-1":
            if not self.ignora_put:
                self.v = copy.deepcopy(corpo)
            return {"id": "v-1"}
        raise AssertionError("rota inesperada: %s %s" % (metodo, caminho))

    def gravou(self):
        return [c for c in self.chamadas if c[0] != "GET"]


class NotionFake:
    def __init__(self, props, base=BASE_DIST):
        self.props = dict(props)
        self.props.setdefault(D.COL_ESTADO, txt(""))
        self.base = base

    def pagina(self, pid):
        return {"parent": {"database_id": self.base}, "properties": self.props}

    def gravar_textos(self, pid, props, valores):
        for k, v in valores.items():
            self.props[k] = txt(v)
        return []

    def estado(self):
        return "".join(x["plain_text"] for x in self.props[D.COL_ESTADO]["rich_text"])


# ------------------------------------------------------------------ regra pura

def test_sem_recebimento_exclui():
    pl = D.plano(venda(ABERTAS), recebeu=False)
    assert pl["acao"] == "EXCLUIR" and len(pl["removidas"]) == 2 and pl["corpo"] is None


def test_com_sinal_mantem_so_recebidas_e_marca_descricao():
    pl = D.plano(venda([SINAL] + ABERTAS), recebeu=True, destino="RETIDO")
    assert pl["acao"] == "ALTERAR"
    assert [p["id"] for p in pl["corpo"]["tradeReceivable"]["installments"]] == ["p1"]
    assert pl["corpo"]["description"] == "VENDA CASA 02 - COMPRADOR EXEMPLO (Distrato)"
    assert pl["corpo"]["tradeReceivable"]["grossValue"] == 10000.0
    assert pl["corpo"]["tradeReceivable"]["numberOfInstallments"] == 1


def test_descricao_nao_ganha_sufixo_duas_vezes():
    assert D.descricao_nova("VENDA X (Distrato)") == "VENDA X (Distrato)"
    pl = D.plano(venda([SINAL], desc="VENDA X (Distrato)"), recebeu=True, destino="DEVOLVIDO")
    assert pl["acao"] == "NADA"


def test_recusa_excluir_se_erp_tem_recebimento():
    with pytest.raises(D.Recusa) as e:
        D.plano(venda([SINAL] + ABERTAS), recebeu=False)
    assert e.value.codigo == "ERP_TEM_RECEBIMENTO"


def test_recusa_se_tela_diz_recebido_e_erp_nao():
    with pytest.raises(D.Recusa) as e:
        D.plano(venda(ABERTAS), recebeu=True, destino="RETIDO")
    assert e.value.codigo == "ERP_SEM_RECEBIMENTO"


def test_recusa_parcela_recebida_em_parte():
    parcial = parcela("p9", "2026-10-01", 20000.0, 5000.0)
    with pytest.raises(D.Recusa) as e:
        D.plano(venda([SINAL, parcial] + ABERTAS), recebeu=True, destino="RETIDO")
    assert e.value.codigo == "PARCELA_RECEBIDA_EM_PARTE"


def test_juros_ou_desconto_contam_como_recebimento():
    p = parcela("p8", "2026-10-01", 1000.0)
    p["receipts"] = [{"value": 0, "discountValue": 1000.0}]
    p["received"] = True
    assert D.tem_recebimento(p)


def test_recusa_venda_nao_reajustavel():
    with pytest.raises(D.Recusa) as e:
        D.plano(venda(ABERTAS, reaj=False), recebeu=False)
    assert e.value.codigo == "VENDA_NAO_REAJUSTAVEL"


def test_respostas_invalidas():
    with pytest.raises(D.Recusa):
        D.normalizar("talvez", "")
    with pytest.raises(D.Recusa):
        D.normalizar("sim", "")
    assert D.normalizar("não", "qualquer") == (False, "")
    assert D.normalizar("SIM", "devolvido") == (True, "DEVOLVIDO")


def test_assinatura_muda_com_resposta():
    a = D.plano(venda([SINAL] + ABERTAS), True, "RETIDO")
    b = D.plano(venda([SINAL] + ABERTAS), True, "DEVOLVIDO")
    assert D.assinatura(a) != D.assinatura(b)


# ------------------------------------------------------------------ fluxo

def test_previa_na_venda_nao_grava_no_erp():
    n = NotionFake({D.COL_VENDA_ID: txt("v-1")}, base="b" * 32)
    erp = ErpFake(venda([SINAL] + ABERTAS))
    r = D.processar("pg", n, erp, "sim", "retido")
    assert r["situacao"] == "PREVIA" and erp.gravou() == []
    assert n.estado().startswith("DISTRATO PRÉVIA OK [#")
    assert "[recebeu=sim destino=retido]" in n.estado() and "REMOVER 2" in n.estado()


def test_previa_sem_venda_id_recusa():
    n = NotionFake({D.COL_VENDA_ID: txt("")})
    r = D.processar("pg", n, ErpFake(venda(ABERTAS)), "nao", "")
    assert r["codigo"] == "SEM_VENDA_ID" and n.estado().startswith("DISTRATO RECUSADO")


def _arquivo(previa, sinal="NÃO", destino="NÃO HOUVE", vid="v-1"):
    return {D.COL_VENDA_ID: txt(vid), D.COL_PREVIA_ACEITA: txt(previa), D.COL_SINAL: sel(sinal),
            D.COL_DESTINO: sel(destino)}


def _previa(v, recebeu, destino):
    n = NotionFake({D.COL_VENDA_ID: txt("v-1")})
    D.processar("pg", n, ErpFake(v), recebeu, destino)
    return n.estado()


def test_aplicar_exclui(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda(ABERTAS)
    n = NotionFake(_arquivo(_previa(v, "nao", "")))
    erp = ErpFake(v)
    r = D.processar("arq", n, erp, "nao", "", aplicar=True)
    assert r["codigo"] == "APLICADO_EXCLUIR" and ("DELETE", "/sales/v-1") in erp.chamadas
    assert n.estado().startswith("DISTRATO APLICADO")


def test_aplicar_altera_e_confere(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda([SINAL] + ABERTAS)
    n = NotionFake(_arquivo(_previa(v, "sim", "retido"), "SIM", "RETIDO"))
    erp = ErpFake(v)
    r = D.processar("arq", n, erp, "sim", "retido", aplicar=True)
    assert r["codigo"] == "APLICADO_ALTERAR"
    assert [p["id"] for p in erp.v["tradeReceivable"]["installments"]] == ["p1"]
    assert erp.v["description"].endswith("(Distrato)")


def test_aplicar_recusa_se_erp_mudou_depois_da_previa(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda([SINAL] + ABERTAS)
    previa = _previa(v, "sim", "retido")
    v2 = venda([SINAL, parcela("p2", "2026-11-01", 50000.0, 50000.0), ABERTAS[1]])
    erp = ErpFake(v2)
    r = D.processar("arq", NotionFake(_arquivo(previa, "SIM", "RETIDO")), erp, "sim", "retido", aplicar=True)
    assert r["codigo"] == "PREVIA_DESATUALIZADA" and erp.gravou() == []


def test_aplicar_recusa_sem_db_distratos(monkeypatch):
    monkeypatch.delenv("DB_DISTRATOS", raising=False)
    v = venda(ABERTAS)
    erp = ErpFake(v)
    r = D.processar("arq", NotionFake(_arquivo(_previa(v, "nao", ""))), erp, "nao", "", aplicar=True)
    assert r["codigo"] == "SEM_DB_DISTRATOS" and erp.gravou() == []


def test_aplicar_recusa_pagina_de_outra_base(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda(ABERTAS)
    erp = ErpFake(v)
    n = NotionFake(_arquivo(_previa(v, "nao", "")), base="b" * 32)
    r = D.processar("arq", n, erp, "nao", "", aplicar=True)
    assert r["codigo"] == "PAGINA_FORA_DE_DISTRATOS" and erp.gravou() == []


def test_aplicar_recusa_resposta_diferente_do_arquivo(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda([SINAL] + ABERTAS)
    erp = ErpFake(v)
    n = NotionFake(_arquivo(_previa(v, "sim", "retido"), "SIM", "DEVOLVIDO"))
    r = D.processar("arq", n, erp, "sim", "retido", aplicar=True)
    assert r["codigo"] == "RESPOSTA_DIFERENTE_DO_ARQUIVO" and erp.gravou() == []


def test_aplicar_sem_venda_id_recusa(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    erp = ErpFake(venda(ABERTAS))
    r = D.processar("arq", NotionFake(_arquivo("[#12345678]", vid="")), erp, "nao", "", aplicar=True)
    assert r["codigo"] == "SEM_VENDA_ID" and erp.gravou() == []


def test_aplicar_duas_vezes_nao_regrava(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda(ABERTAS)
    n = NotionFake(_arquivo(_previa(v, "nao", "")))
    erp = ErpFake(v)
    D.processar("arq", n, erp, "nao", "", aplicar=True)
    antes = len(erp.gravou())
    r = D.processar("arq", n, erp, "nao", "", aplicar=True)
    assert r["situacao"] == "JA_APLICADO" and len(erp.gravou()) == antes


def test_bloqueado_vira_previa(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda(ABERTAS)
    n = NotionFake(_arquivo(_previa(v, "nao", "")))
    erp = ErpFake(v)
    r = D.processar("arq", n, erp, "nao", "", aplicar=False, bloqueado=True)
    assert r["codigo"] == "BLOQUEADO" and erp.gravou() == [] and n.estado().startswith("BLOQUEADO")


def test_alteracao_que_nao_pegou_falha_alto(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    v = venda([SINAL] + ABERTAS)
    n = NotionFake(_arquivo(_previa(v, "sim", "retido"), "SIM", "RETIDO"))
    erp = ErpFake(v)
    erp.ignora_put = True
    with pytest.raises(ErpErro):
        D.processar("arq", n, erp, "sim", "retido", aplicar=True)


def test_stdout_nao_leva_dados(monkeypatch, capsys):
    for k in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA"):
        monkeypatch.delenv(k, raising=False)
    assert D.main(["--page", "x" * 32, "--recebeu", "nao"]) == 2
    out = capsys.readouterr().out
    assert "SEM_SEGREDOS" in out


# ------------------------------------------------------------------ devolução (conta a pagar)

class ErpComCatalogos(ErpFake):
    user_id = "u-robo"

    def __init__(self, v):
        super().__init__(v)
        self.titulos = {}

    def obra(self, oid):
        return {"id": oid, "defaultAccount": {"id": "conta-1", "name": "CONTA DA OBRA"}}

    def pedir(self, metodo, caminho, corpo=None, params=None):
        if metodo == "GET" and caminho == "/payment-conditions/all":
            self.chamadas.append((metodo, caminho))
            return [{"id": "cond-parc", "type": "FINANCING"}, {"id": "cond-vista", "type": "IN_CASH"}]
        if metodo == "POST" and caminho == "/trade-payables":
            self.chamadas.append((metodo, caminho))
            assert params == {"userApprovesSaleCreation": "true"}
            self.titulos["tp-1"] = copy.deepcopy(corpo)
            return {"id": "tp-1"}
        if metodo == "GET" and caminho == "/trade-payables/tp-1":
            self.chamadas.append((metodo, caminho))
            return self.titulos["tp-1"]
        return super().pedir(metodo, caminho, corpo, params)


def venda_dev():
    v = venda([SINAL] + ABERTAS)
    v["customer"] = {"id": "cli-1"}
    v["work"] = {"id": "obra-1", "name": "RUA TESTE QD 01 LT 02", "defaultWhoPays": "CLIENT"}
    return v


def _previa_dev(monkeypatch, valor="", data=""):
    n = NotionFake({D.COL_VENDA_ID: txt("v-1")})
    D.processar("pg", n, ErpComCatalogos(venda_dev()), "sim", "devolvido", valor=valor, data=data, hoje="2026-10-07")
    return n.estado()


def test_devolucao_padrao_valor_recebido_e_hoje_mais_30(monkeypatch):
    monkeypatch.setenv("NATUREZA_DEVOLUCAO_ID", "cat-dev")
    t = _previa_dev(monkeypatch)
    assert "[devolver=10000.00 em 2026-11-06]" in t and "LANÇAR CONTA A PAGAR" in t


def test_devolucao_sem_natureza_avisa_e_nao_lanca(monkeypatch):
    monkeypatch.delenv("NATUREZA_DEVOLUCAO_ID", raising=False)
    t = _previa_dev(monkeypatch)
    assert "NATUREZA_DEVOLUCAO_ID" in t and "NÃO será lançada" in t and t.startswith("DISTRATO PRÉVIA OK")


def test_devolucao_maior_que_recebido_recusa(monkeypatch):
    monkeypatch.setenv("NATUREZA_DEVOLUCAO_ID", "cat-dev")
    t = _previa_dev(monkeypatch, valor="10.000,02")
    assert t.startswith("DISTRATO RECUSADO") and "maior que o recebido" in t


def test_aplicar_devolvido_altera_venda_e_lanca_titulo(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    monkeypatch.setenv("NATUREZA_DEVOLUCAO_ID", "cat-dev")
    previa = _previa_dev(monkeypatch, valor="8.000,00", data="20/11/2026")
    assert "[devolver=8000.00 em 2026-11-20]" in previa
    erp = ErpComCatalogos(venda_dev())
    n = NotionFake(_arquivo(previa, "SIM", "DEVOLVIDO"))
    r = D.processar("arq", n, erp, "sim", "devolvido", aplicar=True, valor="8000.00", data="2026-11-20", hoje="2026-10-08")
    assert r["codigo"] == "APLICADO_ALTERAR", n.estado()
    t = erp.titulos["tp-1"]
    assert t["participant"] == {"id": "cli-1"} and t["category"] == {"id": "cat-dev"}
    assert t["account"]["id"] == "conta-1" and t["costCentreDetails"][0]["work"]["id"] == "obra-1"
    assert t["installments"][0]["plannedValue"] == 8000.0 and t["markedAsPaid"] is False
    assert "conta a pagar da devolução LANÇADA" in n.estado()


def test_aplicar_devolvido_com_valor_diferente_da_previa_recusa(monkeypatch):
    monkeypatch.setenv("DB_DISTRATOS", BASE_DIST)
    monkeypatch.setenv("NATUREZA_DEVOLUCAO_ID", "cat-dev")
    previa = _previa_dev(monkeypatch, valor="8000", data="2026-11-20")
    erp = ErpComCatalogos(venda_dev())
    r = D.processar("arq", NotionFake(_arquivo(previa, "SIM", "DEVOLVIDO")), erp, "sim", "devolvido",
                    aplicar=True, valor="9000", data="2026-11-20")
    assert r["codigo"] == "PREVIA_DESATUALIZADA" and erp.gravou() == []


def test_titulo_recusado_nao_derruba_distrato(monkeypatch):
    monkeypatch.setenv("NATUREZA_DEVOLUCAO_ID", "cat-dev")

    class Recusa(ErpComCatalogos):
        def pedir(self, metodo, caminho, corpo=None, params=None):
            if metodo == "POST" and caminho == "/trade-payables":
                raise ErpErro("POST /trade-payables -> HTTP 400: campo obrigatório")
            return super().pedir(metodo, caminho, corpo, params)

    pl = D.plano(venda_dev(), True, "DEVOLVIDO")
    pl["devolucao"] = D.plano_devolucao(pl, venda_dev(), hoje="2026-10-07", categoria_id="cat-dev",
                                        conta={"id": "c"}, condicao={"id": "x", "type": "IN_CASH"})
    assert "NÃO lançada" in D.lancar_devolucao(Recusa(venda_dev()), pl["devolucao"])
