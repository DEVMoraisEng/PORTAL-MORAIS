"""Mapa de vendas: venda nova fica RESERVADA até o sinal ser confirmado (regra do dono, 08/10/2026)."""
import fetch_vendas as F


def test_sem_sinal_e_venda_nova_fica_reservada():
    assert F.aguardando_sinal(None, "2026-10-08") is True
    assert F.aguardando_sinal("", {"start": "2026-11-01"}) is True
    assert F.aguardando_sinal(None, None) is True          # sem data da venda: ainda em andamento


def test_sinal_confirmado_vira_vendida():
    assert F.aguardando_sinal("2026-10-09", "2026-10-08") is False
    assert F.aguardando_sinal({"start": "2026-10-09"}, None) is False


def test_venda_antiga_continua_vendida():
    assert F.aguardando_sinal(None, "2026-09-30") is False
    assert F.aguardando_sinal(None, {"start": "2025-01-10"}) is False
