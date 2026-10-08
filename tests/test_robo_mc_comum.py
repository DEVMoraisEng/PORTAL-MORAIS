# -*- coding: utf-8 -*-
"""Testes de robo_mc_comum.py — só a escolha de credencial (MC_CRED), que é
lida do ambiente NO IMPORT do módulo (mesmo padrão de robo_mc_contas.py: o
robô troca os ATRIBUTOS do módulo depois, não adianta só mexer em
os.environ). Por isso cada teste dá `importlib.reload` com o ambiente já
armado, e desfaz o reload no fim para não vazar estado entre testes.

Sem Playwright de verdade: `robo_mc_comum` importa só
`playwright.sync_api.TimeoutError` no topo, que existe (o pacote está
instalado nesta máquina para os testes) mas nunca é chamado aqui."""
import importlib

import pytest

import robo_mc_comum as comum


VARS = ("MC_CRED", "MC_ROBO_USUARIO", "MC_ROBO_SENHA", "MC_USUARIO", "MC_SENHA", "MC_URL")


@pytest.fixture
def recarregar(monkeypatch):
    """Limpa as variáveis relevantes, deixa o teste montar o ambiente que
    quiser, recarrega o módulo e devolve o módulo recarregado. Ao final,
    recarrega de novo com o ambiente original (limpo) para não deixar o
    módulo com credencial de outro teste."""
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    yield lambda: importlib.reload(comum)
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    importlib.reload(comum)


def test_mc_cred_robo_com_as_duas_novas_preenchidas_usa_robo(monkeypatch, recarregar):
    monkeypatch.setenv("MC_CRED", "robo")
    monkeypatch.setenv("MC_ROBO_USUARIO", "robo@exemplo.com")
    monkeypatch.setenv("MC_ROBO_SENHA", "senha-robo-ficticia")
    monkeypatch.setenv("MC_USUARIO", "antigo@exemplo.com")
    monkeypatch.setenv("MC_SENHA", "senha-antiga-ficticia")
    mod = recarregar()
    assert (mod.MC_USUARIO, mod.MC_SENHA) == ("robo@exemplo.com", "senha-robo-ficticia")


def test_sem_mc_cred_usa_antiga_mesmo_com_robo_preenchida(monkeypatch, recarregar):
    # o robô de clientes não seta MC_CRED — mesmo com os secrets novos
    # preenchidos no repositório, ele tem de continuar no login antigo
    monkeypatch.setenv("MC_ROBO_USUARIO", "robo@exemplo.com")
    monkeypatch.setenv("MC_ROBO_SENHA", "senha-robo-ficticia")
    monkeypatch.setenv("MC_USUARIO", "antigo@exemplo.com")
    monkeypatch.setenv("MC_SENHA", "senha-antiga-ficticia")
    mod = recarregar()
    assert (mod.MC_USUARIO, mod.MC_SENHA) == ("antigo@exemplo.com", "senha-antiga-ficticia")


def test_mc_cred_robo_mas_faltando_um_dos_dois_recua_para_antiga(monkeypatch, recarregar):
    monkeypatch.setenv("MC_CRED", "robo")
    monkeypatch.setenv("MC_ROBO_USUARIO", "robo@exemplo.com")
    # MC_ROBO_SENHA fica de fora (secret ainda não preenchido pelo dono)
    monkeypatch.setenv("MC_USUARIO", "antigo@exemplo.com")
    monkeypatch.setenv("MC_SENHA", "senha-antiga-ficticia")
    mod = recarregar()
    assert (mod.MC_USUARIO, mod.MC_SENHA) == ("antigo@exemplo.com", "senha-antiga-ficticia")


def test_mc_cred_robo_sem_nenhuma_credencial_fica_vazio(monkeypatch, recarregar):
    monkeypatch.setenv("MC_CRED", "robo")
    mod = recarregar()
    assert (mod.MC_USUARIO, mod.MC_SENHA) == ("", "")


def test_mc_cred_maiusculo_tambem_conta(monkeypatch, recarregar):
    monkeypatch.setenv("MC_CRED", "ROBO")
    monkeypatch.setenv("MC_ROBO_USUARIO", "robo@exemplo.com")
    monkeypatch.setenv("MC_ROBO_SENHA", "senha-robo-ficticia")
    mod = recarregar()
    assert (mod.MC_USUARIO, mod.MC_SENHA) == ("robo@exemplo.com", "senha-robo-ficticia")
