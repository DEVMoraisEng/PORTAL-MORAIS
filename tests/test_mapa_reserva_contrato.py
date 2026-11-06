"""Mapa de vendas: casa de rua com contrato gerado fica RESERVADA 48 h para assinar (regra do dono, 05/11/2026).
Só datas inventadas."""
from datetime import datetime, timedelta, timezone

import fetch_vendas as F

GERADO = "2026-11-05T10:00:00.000-03:00"           # = 13:00 UTC
G = datetime(2026, 11, 5, 13, 0, tzinfo=timezone.utc)


def sm(**kw):
    base = dict(tem_cliente=True, reservada="", data_reserva=None, sinal_data=None, data_venda="2026-11-04",
                gerado_em=GERADO, situacao_assinatura="ENVIADO", agora=G + timedelta(hours=1))
    base.update(kw)
    return F.situacao_mapa(**base)


def test_reserva_contrato_estados_e_prazo():
    assert F.reserva_contrato(None, "ENVIADO") is None
    assert F.reserva_contrato("", "ASSINADO") is None
    assert F.reserva_contrato("lixo", "ENVIADO") is None
    r = F.reserva_contrato(GERADO, "ENVIADO", G + timedelta(hours=47, minutes=59))
    assert r == {"estado": "RESERVADA", "geradoEm": "2026-11-05T13:00:00.000Z", "ate": "2026-11-07T13:00:00.000Z"}
    assert F.reserva_contrato(GERADO, "ENVIADO", G + timedelta(hours=48))["estado"] == "LIBERADA"
    assert F.reserva_contrato(GERADO, "assinado", G + timedelta(days=9))["estado"] == "VENDIDA"
    assert F.reserva_contrato("2026-11-05T13:00:00Z", None, G)["estado"] == "RESERVADA"
    assert F.reserva_contrato({"start": GERADO}, "", G)["ate"] == "2026-11-07T13:00:00.000Z"


def test_contrato_gerado_e_nao_assinado_fica_reservado_com_prazo():
    s = sm()
    assert s["vendida"] is False and s["reservada"] == "SIM" and s["motivoReserva"] == "CONTRATO"
    assert s["reservaAte"] == "2026-11-07T13:00:00.000Z"
    # o mapa conta 24 h de dataReserva: vai 24 h antes do fim para ele mostrar o prazo de 48 h
    assert s["dataReserva"] == "2026-11-06T13:00:00.000Z"


def test_48h_sem_todas_as_assinaturas_libera_a_casa():
    s = sm(agora=G + timedelta(hours=49), situacao_assinatura="ENVIADO")
    assert s == {"vendida": False, "reservada": "NÃO", "dataReserva": None, "motivoReserva": "", "reservaAte": None}


def test_assinado_por_todos_vira_vendida():
    s = sm(situacao_assinatura="ASSINADO", agora=G + timedelta(days=5))
    assert s["vendida"] is True and s["motivoReserva"] == "" and s["reservaAte"] is None


def test_precedencia_sobre_o_sinal():
    # assinado vence o SINAL: vendida mesmo sem o sinal confirmado
    assert sm(situacao_assinatura="ASSINADO", sinal_data=None)["vendida"] is True
    # pendente: o motivo é o contrato (com prazo), não o sinal
    assert sm(sinal_data=None)["motivoReserva"] == "CONTRATO"
    # vencido libera mesmo sem o sinal
    assert sm(sinal_data=None, agora=G + timedelta(hours=60))["reservada"] == "NÃO"


def test_sem_contrato_gerado_nada_muda():
    # venda antiga: CLIENTES preenchido = vendida, RESERVADA/DATA vêm da coluna
    assert F.situacao_mapa(True, "NÃO", None, None, "2025-03-01") == {
        "vendida": True, "reservada": "NÃO", "dataReserva": None, "motivoReserva": "", "reservaAte": None}
    # venda nova sem sinal: regra de 08/10
    assert F.situacao_mapa(True, "", None, None, "2026-10-20")["motivoReserva"] == "SINAL"
    # reserva de 24 h comum (sem cliente) passa como veio
    s = F.situacao_mapa(False, "SIM", "2026-11-05T12:00:00.000Z", None, None)
    assert s["reservada"] == "SIM" and s["dataReserva"] == "2026-11-05T12:00:00.000Z" and s["motivoReserva"] == ""
