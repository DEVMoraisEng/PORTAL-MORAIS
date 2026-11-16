# -*- coding: utf-8 -*-
"""Conferência de compras (OC) — 16/11/2026: fornecedores, dias úteis e o que vira alerta."""
import datetime as dt

import robo_mc_ocs as ro

D = dt.date


def test_fornecedores_da_lista_e_acao():
    assert ro.acao_do_fornecedor("Rocha Mármores e Granitos") == ("ROCHA MARMORES E GRANITOS", "APROVAR")
    assert ro.acao_do_fornecedor("ROCHA MARMORES E GRANITOS LTDA") == ("ROCHA MARMORES E GRANITOS", "APROVAR")
    assert ro.acao_do_fornecedor("VIDRO ALVES") == ("VIDRO ALVES", "APROVAR")
    assert ro.acao_do_fornecedor("Serralheria do Fábio") == ("SERRALHERIA DO FABIO", "PARCELA")
    assert ro.acao_do_fornecedor("Casa do Construtor") is None
    assert ro.acao_do_fornecedor("") is None


def test_fornecedor_extra_pelo_ambiente(monkeypatch):
    monkeypatch.setenv("OCS_FORNECEDORES", "Gesso Bom=PARCELA;Qualquer=APAGAR")
    assert ro.acao_do_fornecedor("GESSO BOM ME") == ("GESSO BOM", "PARCELA")
    assert ro.acao_do_fornecedor("Qualquer") is None          # ação inválida não entra


def test_feriados_moveis_2027():
    f = ro.feriados(2027)
    assert D(2027, 3, 26) in f            # sexta-feira santa (páscoa 28/03/2027)
    assert D(2027, 2, 8) in f and D(2027, 2, 9) in f   # carnaval
    assert D(2027, 5, 27) in f            # Corpus Christi
    assert D(2026, 11, 20) in ro.feriados(2026)


def test_proximo_dia_util():
    assert ro.proximo_dia_util(D(2026, 11, 16)) == D(2026, 11, 17)       # segunda → terça
    assert ro.proximo_dia_util(D(2026, 11, 13)) == D(2026, 11, 16)       # sexta → segunda
    assert ro.proximo_dia_util(D(2026, 11, 19)) == D(2026, 11, 23)       # quinta → (20 feriado, fds) → segunda
    assert ro.proximo_dia_util(D(2026, 12, 24)) == D(2026, 12, 28)       # véspera de Natal → segunda


def test_data_da_parcela_nunca_no_passado():
    assert ro.data_da_parcela(D(2026, 11, 16), D(2026, 11, 16)) == D(2026, 11, 17)
    assert ro.data_da_parcela(D(2026, 11, 14), D(2026, 11, 16)) == D(2026, 11, 16)   # SIM no sábado, robô na segunda
    assert ro.data_da_parcela(D(2026, 11, 2), D(2026, 11, 16)) == D(2026, 11, 16)    # robô atrasado: hoje (útil)
    assert ro.data_da_parcela(D(2026, 11, 2), D(2026, 11, 15)) == D(2026, 11, 16)    # hoje é domingo → segunda


def test_dia_local_em_goiania():
    assert ro.dia_local("2026-11-17T01:30:00+00:00") == D(2026, 11, 16)    # 22:30 do dia 16 em Goiânia
    assert ro.dia_local("2026-11-16T12:00:00Z") == D(2026, 11, 16)
    assert ro.dia_local(None) is None


def test_mesma_data_nos_dois_formatos():
    assert ro.mesma_data("17/11/2026", D(2026, 11, 17))
    assert ro.mesma_data("2026-11-17", D(2026, 11, 17))
    assert not ro.mesma_data("05/11/2026", D(2026, 11, 17))


NO = {"id": "6486e261-b336-4263-99e5-a27de4efb5ca", "number": 8312, "creationDate": "2026-11-16T10:00:00",
      "approvalStatus": "AWAITING", "purchaseStatus": None, "description": "MARMORES E GRANITOS",
      "supplier": {"id": "x", "person": {"name": "Rocha Mármores e Granitos"}},
      "costCenters": [{"id": "c", "work": {"name": "52 QD 81 LT 12"}}]}


def test_oc_do_no_acha_os_campos():
    oc = ro.oc_do_no(NO)
    assert oc["numero"] == 8312 and oc["fornecedor"] == "Rocha Mármores e Granitos"
    assert oc["obra"] == "52 QD 81 LT 12" and oc["criada_em"] == "2026-11-16"
    assert oc["aprovacao_mc"] == "AWAITING" and not oc["cancelada"]
    assert ro.interessa(oc) == ("ROCHA MARMORES E GRANITOS", "APROVAR")


def test_oc_antiga_ou_de_outro_fornecedor_nao_entra():
    velha = ro.oc_do_no(dict(NO, creationDate="2026-10-01"))
    assert ro.interessa(velha) is None
    outro = ro.oc_do_no(dict(NO, supplier={"name": "Casa do Construtor"}))
    assert ro.interessa(outro) is None


def test_novas_e_atualizadas_nao_mexem_na_resposta():
    a = ro.oc_do_no(NO)
    ja_aprovada = ro.oc_do_no(dict(NO, id="11111111-1111-1111-1111-111111111111", approvalStatus="APPROVED"))
    fabio = ro.oc_do_no(dict(NO, id="22222222-2222-2222-2222-222222222222", approvalStatus="APPROVED",
                             supplier={"name": "Serralheria do Fabio"}))
    cancelada = ro.oc_do_no(dict(NO, id="33333333-3333-3333-3333-333333333333", approvalStatus="CANCELED"))
    existente = ro.oc_do_no(dict(NO, id="44444444-4444-4444-4444-444444444444", approvalStatus="APPROVED"))
    novas, atual = ro.linhas_novas_e_atualizadas([a, ja_aprovada, fabio, cancelada, existente],
                                                 {existente["oc_id"]: {"resposta": "SIM"}})
    ids = [x["oc_id"] for x in novas]
    assert a["oc_id"] in ids and fabio["oc_id"] in ids          # Fabio entra mesmo aprovada (a ação é na parcela)
    assert ja_aprovada["oc_id"] not in ids and cancelada["oc_id"] not in ids
    assert [x["oc_id"] for x in atual] == [existente["oc_id"]]
    assert all("resposta" not in x and "robo_situacao" not in x for x in novas + atual)
    assert {x["acao"] for x in novas} == {"APROVAR", "PARCELA"}


def test_lista_da_resposta_nodes_ou_edges():
    nos, info = ro._lista_da_resposta({"data": {"purchaseOrder": {"nodes": [{"id": 1}], "pageInfo": {"hasNextPage": False}}}})
    assert nos == [{"id": 1}] and info == {"hasNextPage": False}
    nos, _ = ro._lista_da_resposta({"data": {"purchaseOrders": {"edges": [{"node": {"id": 2}}]}}})
    assert nos == [{"id": 2}]
