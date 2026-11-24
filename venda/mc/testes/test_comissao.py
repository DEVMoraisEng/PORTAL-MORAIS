# -*- coding: utf-8 -*-
"""Comissão do corretor (condomínio). Dados inventados — o repositório é público."""
import os, sys
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import comissao as K  # noqa: E402

HOJE = "2026-11-24"

def test_ler_parcelas_ok():
    assert K.ler_parcelas("8750.00@2026-11-24;8750.00@2026-12-24", HOJE) == [
        {"valor": 8750.0, "data": "2026-11-24"}, {"valor": 8750.0, "data": "2026-12-24"}]

@pytest.mark.parametrize("t", ["", "0@2026-11-24", "-5@2026-11-24", "10@24/11/2026", "abc",
                               "10@2026-11-24;" * 7, "10@2020-01-01", "10@2030-01-01"])
def test_ler_parcelas_recusa(t):
    with pytest.raises(K.Recusa) as e:
        K.ler_parcelas(t, HOJE)
    assert e.value.codigo == "PARCELAS_INVALIDAS"

def test_saldo():
    ps = [{"valor": 8750.0, "data": HOJE}]
    assert K.conferir_saldo(ps, 17500.0, 0.0) == 17500.0
    assert K.conferir_saldo(ps, 17500.0, 8750.0) == 8750.0
    with pytest.raises(K.Recusa) as e:
        K.conferir_saldo([{"valor": 10000.0, "data": HOJE}], 17500.0, 8750.0)
    assert e.value.codigo == "ACIMA_DO_SALDO"
    with pytest.raises(K.Recusa) as e:
        K.conferir_saldo(ps, 0.0, 0.0)
    assert e.value.codigo == "SEM_COMISSAO"

def test_centavo_nao_vira_recusa():
    ps = [{"valor": 5833.33, "data": HOJE}, {"valor": 5833.33, "data": "2026-12-24"}, {"valor": 5833.34, "data": "2027-01-24"}]
    assert K.conferir_saldo(ps, 17500.0, 0.0) == 17500.0

def test_descricao_e_nome_do_recibo():
    assert K.descricao(4, "  maria  teste ") == "COMISSÃO CORRETOR UNIDADE 04 - MARIA TESTE"
    assert K.nome_recibo(4, {"valor": 8750.0, "data": "2026-11-24"}, 1, 2) == \
        "8750,00 - COMISSAO UNIDADE 04 PARCELA 1-2 - 24-11-2026.pdf"
    assert K.nome_recibo(12, {"valor": 1000.5, "data": "2026-11-24"}, 1, 1) == \
        "1000,50 - COMISSAO UNIDADE 12 - 24-11-2026.pdf"

def _corpo(n):
    ps = [{"valor": 8750.0, "data": "2026-11-24"}, {"valor": 8750.0, "data": "2026-12-24"}][:n]
    return K.corpo_titulo(ps, "D", "OBS", "part-1", "cat-1", "pix-1", {"id": "c-1", "name": "CONTA"},
                          {"id": "w-1", "name": "OBRA", "status": "IN_PROGRESS"},
                          {"id": "cond-1", "type": "FINANCING" if n > 1 else "IN_CASH"}, "u-1", HOJE)

def test_corpo_parcelado():
    c = _corpo(2)
    assert c["paymentCondition"] == {"id": "cond-1", "type": "FINANCING", "financing": True, "recurring": False}
    assert c["numberOfInstallments"] == 2 and c["numberOfFinancingInstallments"] == 2
    assert [(i["plannedDate"], i["plannedValue"], i["order"]) for i in c["installments"]] == \
        [("2026-11-24", 8750.0, 0), ("2026-12-24", 8750.0, 1)]
    assert c["value"] == 17500.0 and c["markedAsPaid"] is False and "markedPayingDate" not in c
    assert c["comment"] == "OBS" and c["participant"] == {"id": "part-1"} and c["paymentMethod"] == {"id": "pix-1"}
    assert c["costCentreDetails"][0]["work"]["id"] == "w-1" and c["costCentreDetails"][0]["value"] == 17500.0

def test_corpo_a_vista():
    c = _corpo(1)
    assert c["paymentCondition"]["type"] == "IN_CASH" and c["paymentCondition"]["financing"] is False
    assert c["numberOfInstallments"] == 1 and "numberOfFinancingInstallments" not in c

def test_quem_paga_vem_do_distrato():
    from venda.mc.distrato import QUEM_PAGA
    assert _corpo(1)["whoPays"] == QUEM_PAGA == "CLIENT"

def test_assinatura_muda_com_parcela_e_favorecido():
    base = {"parcelas": [{"valor": 1.0, "data": HOJE}], "favorecido_id": "a", "comissao": 10.0, "ja_lancado": 0.0}
    outra = dict(base, favorecido_id="b")
    assert K.assinatura(base) != K.assinatura(outra)
    assert K.assinatura_do_texto("PRÉVIA OK [#1a2b3c4d] | x") == "1a2b3c4d"
    assert K.assinatura_do_texto("CRIADA") is None
