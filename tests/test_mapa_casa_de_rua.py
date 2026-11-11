"""REGRA TRAVADA PELO DONO (Morais, 11/11/2026) — mapa de vendas das CASAS DE RUA.

Se este teste falhar, alguém mexeu na regra. Não "conserte" o teste: a regra só muda com pedido do próprio
Morais (ver REGRAS-TRAVADAS.md). Este mapa NÃO é o do condomínio (Reserva dos Ipês).
"""
import fetch_vendas as F


def test_vendida_precisa_de_cliente_e_data_da_venda():
    assert F.situacao_mapa(True, "", None, "2026-11-10")["vendida"] is True
    assert F.situacao_mapa(True, "", None, {"start": "2025-01-10"})["vendida"] is True
    assert F.situacao_mapa(True, "", None, None)["vendida"] is False
    assert F.situacao_mapa(True, "", None, "")["vendida"] is False
    assert F.situacao_mapa(False, "", None, "2026-11-10")["vendida"] is False


def test_reservada_e_so_o_sim_de_24h():
    s = F.situacao_mapa(False, "SIM", "2026-11-11T12:00:00.000Z", None)
    assert s == {"vendida": False, "reservada": "SIM", "dataReserva": "2026-11-11T12:00:00.000Z",
                 "motivoReserva": "", "reservaAte": None}


def test_sem_regua_do_sinal_nem_do_contrato():
    for nome in ("aguardando_sinal", "reserva_contrato", "INICIO_RESERVA_ATE_SINAL", "RESERVA_CONTRATO_HORAS"):
        assert not hasattr(F, nome), nome
