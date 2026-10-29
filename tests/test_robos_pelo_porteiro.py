# -*- coding: utf-8 -*-
"""30/10/26 — robôs antigos pela aba do Chrome do PORTEIRO (MC_VIA=porteiro), sem login.
Sem Playwright de verdade: objetos falsos no lugar do navegador e da página."""
import importlib

import pytest

import robo_mc_comum as comum
import robo_mc_contas as contas


class PaginaFalsa:
    def __init__(self, url_final):
        self.url = ""
        self._final = url_final
        self.fechada = False
        self.ouvintes = []

    def set_default_timeout(self, ms):
        pass

    def on(self, evento, f):
        self.ouvintes.append(evento)

    def goto(self, url, wait_until=None):
        self.url = self._final

    def wait_for_load_state(self, *a, **k):
        pass

    def wait_for_timeout(self, ms):
        pass

    def close(self):
        self.fechada = True


class NavegadorFalso:
    def __init__(self, pagina):
        self.pagina = pagina
        self.contexts = [self]

    def new_page(self):
        return self.pagina


class PlaywrightFalso:
    def __init__(self, pagina, falha=False):
        self.pagina, self.falha, self.porta = pagina, falha, None
        self.chromium = self

    def connect_over_cdp(self, url, timeout=None):
        self.porta = url
        if self.falha:
            raise ConnectionRefusedError()
        return NavegadorFalso(self.pagina)

    def launch(self, *a, **k):
        raise AssertionError("no porteiro o robô não pode abrir navegador próprio")


@pytest.fixture
def porteiro(monkeypatch):
    monkeypatch.setenv("MC_VIA", "porteiro")
    for v in ("MC_USUARIO", "MC_SENHA", "MC_URL", "MC_PORTEIRO_PORTA"):
        monkeypatch.delenv(v, raising=False)
    m = importlib.reload(comum)
    yield m
    monkeypatch.delenv("MC_VIA", raising=False)
    importlib.reload(comum)


def test_abrir_conecta_no_porteiro_e_close_fecha_so_a_aba(porteiro):
    pg = PaginaFalsa("https://acessar.maiscontroleerp.com.br/#/home")
    p = PlaywrightFalso(pg)
    b, page = porteiro.abrir(p)
    assert page is pg and p.porta == "http://127.0.0.1:9230"
    porteiro.login(page)                       # logado: não pede senha nenhuma
    b.close()
    assert pg.fechada


def test_login_no_porteiro_deslogado_para_com_aviso_e_nao_tenta_logar(porteiro):
    pg = PaginaFalsa("https://acessar.maiscontroleerp.com.br/#/login")
    b, page = porteiro.abrir(PlaywrightFalso(pg))
    with pytest.raises(SystemExit) as e:
        porteiro.login(page)
    assert "porteiro" in str(e.value) and "não faz login" in str(e.value)


def test_porteiro_desligado_da_erro_claro(porteiro):
    with pytest.raises(SystemExit) as e:
        porteiro.abrir(PlaywrightFalso(PaginaFalsa(""), falha=True))
    assert "9230" in str(e.value)


def test_sem_mc_via_continua_como_antes(monkeypatch):
    monkeypatch.delenv("MC_VIA", raising=False)
    m = importlib.reload(comum)
    assert m.VIA_PORTEIRO is False


def test_contas_no_porteiro_nao_pede_senha(monkeypatch):
    monkeypatch.setenv("MC_VIA", "porteiro")
    for v in ("MC_ROBO_USUARIO", "MC_ROBO_SENHA", "MC_USUARIO", "MC_SENHA"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("APLICAR", "1")
    usuario, senha, aplicar, aviso = contas.decidir_credenciais()
    assert (usuario, senha, aplicar, aviso) == ("", "", True, None)
    vistos = []
    monkeypatch.setattr(contas, "_contas_via_playwright", lambda u, s: vistos.append((u, s)) or [{"id": "1", "isActive": True}])
    monkeypatch.setattr(contas, "login_api", lambda *a: (_ for _ in ()).throw(AssertionError("não pode logar por API")))
    monkeypatch.setattr(contas, "conta_do_erp", lambda i: i["id"])
    assert contas.contas_ativas_do_erp("", "") == ["1"]
    assert vistos == [("", "")]
