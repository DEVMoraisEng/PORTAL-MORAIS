import json
import os

from venda.mc import registro_aba


class _Sessao:
    def send(self, metodo):
        assert metodo == "Target.getTargetInfo"
        return {"targetInfo": {"targetId": "ABC123"}}

    def detach(self):
        pass


class _Ctx:
    def new_cdp_session(self, page):
        return _Sessao()


class _Pagina:
    context = _Ctx()


def test_registra_e_apaga(tmp_path):
    arq = registro_aba.registrar(_Pagina(), 9230, pasta=tmp_path)
    assert arq.name == f"{os.getpid()}-ABC123.json"
    assert json.loads(arq.read_text(encoding="utf-8")) == {"pid": os.getpid(), "aba": "ABC123", "porta": 9230}
    registro_aba.desregistrar(arq)
    assert not arq.exists()
    registro_aba.desregistrar(arq)          # duas vezes não quebra


def test_pagina_sem_cdp_nao_registra_nem_quebra(tmp_path):
    assert registro_aba.registrar(object(), 9230, pasta=tmp_path) is None
    assert list(tmp_path.iterdir()) == []


def test_mc_central_off_nao_registra(monkeypatch):
    monkeypatch.setenv("MC_CENTRAL", "off")
    assert registro_aba.registrar(_Pagina(), 9230) is None
