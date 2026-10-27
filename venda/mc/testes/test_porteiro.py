# -*- coding: utf-8 -*-
"""27/10/2026 — robôs no servidor: o cliente do ERP pela aba do Chrome do porteiro (sem login)."""
import json

import pytest

from venda.mc import erp as E
from venda.mc import porteiro as P

LEG = {"authorization": "Bearer tok-leg", "company-id": "emp-1", "user-id": "u-1", "organization-unit-id": "ou-1"}
CORE = {"authorization": "Bearer tok-core", "company-id": "emp-1"}


class AbaFalsa:
    def __init__(self, respostas, leg=LEG, core=CORE):
        self.respostas, self.pedidos, self.capturas = list(respostas), [], 0
        self._cab = {P.HOST_LEGACY: dict(leg), P.HOST_CORE: dict(core)}

    def cabecalhos(self, host):
        return dict(self._cab.get(host) or {})

    def capturar(self, espera=90.0):
        self.capturas += 1
        self._cab[P.HOST_LEGACY]["authorization"] = "Bearer tok-novo"

    def fetch(self, metodo, url, cab, corpo=None):
        self.pedidos.append((metodo, url, dict(cab), corpo))
        return self.respostas.pop(0)


def test_sem_login_usa_a_autenticacao_da_tela_e_monta_a_url():
    aba = AbaFalsa([(200, json.dumps([{"id": "x"}]))])
    erp = E.ErpPeloPorteiro(aba)
    assert erp.pedir("GET", "/folder", params={"id": "tr 1", "origin": "TRADE"}) == [{"id": "x"}]
    metodo, url, cab, corpo = aba.pedidos[0]
    assert (metodo, corpo) == ("GET", None)
    assert url == E.LEGACY + "/folder?id=tr+1&origin=TRADE"
    assert cab == {"authorization": "Bearer tok-leg", "company-id": "emp-1", "user-id": "u-1", "organization-unit-id": "ou-1"}


def test_api_nova_usa_o_token_dela():
    aba = AbaFalsa([(200, "")])
    assert E.ErpPeloPorteiro(aba).pedir_core("PATCH", "/financial/x", corpo={"a": 1}) is None
    metodo, url, cab, corpo = aba.pedidos[0]
    assert (metodo, url, corpo) == ("PATCH", E.CORE + "/financial/x", {"a": 1})
    assert cab == {"authorization": "Bearer tok-core", "company-id": "emp-1"}


def test_401_recaptura_e_repete_uma_vez():
    aba = AbaFalsa([(401, ""), (200, '{"ok": true}')])
    assert E.ErpPeloPorteiro(aba).pedir("POST", "/participants", corpo={"n": 1}) == {"ok": True}
    assert aba.capturas == 1
    assert aba.pedidos[1][2]["authorization"] == "Bearer tok-novo"


def test_401_duas_vezes_e_recusa_com_o_corpo_viram_ErpErro():
    with pytest.raises(E.ErpErro, match="HTTP 401"):
        E.ErpPeloPorteiro(AbaFalsa([(401, ""), (401, "")])).pedir("GET", "/sales/1")
    with pytest.raises(E.ErpErro, match=r"POST /readjustment-sales -> HTTP 422: .*name"):
        E.ErpPeloPorteiro(AbaFalsa([(422, '{"erro": "falta name"}')])).criar_venda({})


def test_porteiro_deslogado_e_ErpErro_legivel():
    aba = AbaFalsa([], leg={}, core={})
    with pytest.raises(E.ErpErro, match="porteiro precisa entrar"):
        E.ErpPeloPorteiro(aba).pedir("GET", "/sales/1")


def test_do_ambiente_e_segredos(monkeypatch):
    monkeypatch.delenv("MC_ROBO_EMAIL", raising=False)
    monkeypatch.delenv("MC_ROBO_SENHA", raising=False)
    monkeypatch.delenv("NOTION_TOKEN", raising=False)
    monkeypatch.setenv("MC_VIA", "porteiro")
    assert isinstance(E.do_ambiente(), E.ErpPeloPorteiro)
    assert E.faltam_segredos(("NOTION_TOKEN",)) == ["NOTION_TOKEN"], "no servidor não há senha do robô"
    monkeypatch.setenv("MC_VIA", "")
    assert E.faltam_segredos(("NOTION_TOKEN",)) == ["NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA"]


def test_aba_abre_sozinha_na_primeira_chamada_e_erro_do_porteiro_vira_ErpErro(monkeypatch):
    def falha(*a, **k):
        raise P.PorteiroErro("o Chrome do porteiro não responde na porta 9230")
    monkeypatch.setattr(P.AbaPorteiro, "abrir", classmethod(lambda cls, *a, **k: falha()))
    with pytest.raises(E.ErpErro, match="não responde na porta 9230"):
        E.ErpPeloPorteiro().pedir("GET", "/sales/1")


class PageFalsa:
    def __init__(self, reqs, url="https://acessar.maiscontroleerp.com.br/#/payable-installments"):
        self.reqs, self.url, self.ouvinte, self.esperas = reqs, url, None, 0

    def on(self, evento, f):
        self.ouvinte = f

    def goto(self, url, wait_until=None):
        for r in self.reqs:
            self.ouvinte(r)

    def wait_for_timeout(self, ms):
        self.esperas += 1


class Req:
    def __init__(self, url, headers):
        self.url, self.headers = url, headers


def test_captura_so_dos_dois_back_ends_e_ignora_telemetria():
    pg = PageFalsa([Req("https://api-data-event.maiscontroleerp.com.br/x", {"authorization": "Bearer tele"}),
                    Req("https://legacy-api.maiscontroleerp.com.br/maiscontrole/services/a", dict(LEG, accept="*/*")),
                    Req("https://prod-erp-api.maiscontroleerp.com.br/b", dict(CORE))])
    aba = P.AbaPorteiro(pg)
    aba.capturar(espera=1)
    assert aba.cabecalhos(P.HOST_LEGACY) == LEG
    assert aba.cabecalhos(P.HOST_CORE)["authorization"] == "Bearer tok-core"


def test_tela_no_login_e_porteiro_deslogado():
    aba = P.AbaPorteiro(PageFalsa([], url="https://acessar.maiscontroleerp.com.br/#/login"))
    with pytest.raises(P.PorteiroErro, match="não está logado"):
        aba.capturar(espera=5)
