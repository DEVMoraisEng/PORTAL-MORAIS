# -*- coding: utf-8 -*-
import pytest


@pytest.fixture(autouse=True)
def _base_de_corretores(monkeypatch):
    """O robô procura o CPF/CNPJ do corretor na base CORRETORES – CONTRATO (os fakes devolvem as linhas)."""
    monkeypatch.setenv("DB_CORRETORES", "c" * 32)
