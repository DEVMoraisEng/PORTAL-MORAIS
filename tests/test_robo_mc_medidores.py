# -*- coding: utf-8 -*-
"""Robô de medidores comprados (04/11/2026): o que conta como medidor e o contrato do arquivo."""
import robo_mc_medidores as rm


def test_so_padrao_de_energia_e_hidrometro_contam():
    assert rm.tipo_do_insumo("PADRÃO DE ENERGIA MONOFÁSICO - 5 m saída subterrânea") == "energia"
    assert rm.tipo_do_insumo("HIDROMETRO - 1,5m³/g saída 1/2") == "agua"
    assert rm.tipo_do_insumo("CAIXA DE HIDROMETRO") is None
    assert rm.tipo_do_insumo("KIT CAVALETE P/ HIDROMETRO") is None


def test_soma_por_obra_no_contrato_do_portal():
    obras = rm.somar([("TB 21 QD 50 LT 34", "656", "HIDROMETRO - 1,5m³/g saída 1/2", 1),
                      ("TB 21 QD 50 LT 34", "656", "HIDROMETRO - 1,5m³/g saída 1/2", 1),
                      ("TB 21 QD 50 LT 34", "659", "PADRÃO DE ENERGIA MONOFÁSICO - 5 m", "2"),
                      ("TB 17 QD 49 LT 11", "657", "KIT CAVALETE P/ HIDROMETRO", 2)])
    assert list(obras) == ["TB 21 QD 50 LT 34"]
    o = obras["TB 21 QD 50 LT 34"]
    assert o["agua"] == {"orcado": 0, "comprado": 2, "insumos": ["656 - HIDROMETRO - 1,5m³/g saída 1/2"]}
    assert o["energia"]["comprado"] == 2
    d = rm.documento(obras)
    assert d["ok"] and d["fonte"].startswith("Mais Controle") and "obras" in d


def test_descoberta_nunca_mostra_fornecedor_nem_valor():
    assert rm._mostrar("Fulano Materiais LTDA", "supplier.name") == "texto"
    assert rm._mostrar(1234.5, "totalValue") == "número"
    assert rm._mostrar("TB 21 QD 50 LT 34", "costCentre.name") == "TB 21 QD 50 LT 34"
    assert rm._mostrar("ATTENDED", "status") == "ATTENDED"
    assert rm._mostrar(2, "items[].quantity") == "2"


SOL_8192 = {"number": 8192, "approvalStatus": "APPROVED", "work": {"name": "TB 21 QD 50 LT 34"},
            "costCenters": [{"items": [
                {"status": "AWAITING_DELIVERY", "requestedAmount": 2.0, "purchaseOrderItem": {"id": "o1"}, "originItem": {"code": "656", "name": "HIDROMETRO - 1,5m³/g saída 1/2"}},
                {"status": "AWAITING_DELIVERY", "requestedAmount": 2.0, "purchaseOrderItem": {"id": "o2"}, "originItem": {"code": "659", "name": "PADRÃO DE ENERGIA MONOFÁSICO - 5 m"}},
                {"status": "AWAITING_DELIVERY", "requestedAmount": 2.0, "purchaseOrderItem": {"id": "o3"}, "originItem": {"code": "657", "name": "KIT CAVALETE P/ HIDROMETRO"}},
                {"status": "PENDING", "requestedAmount": 5.0, "purchaseOrderItem": None, "originItem": {"code": "656", "name": "HIDROMETRO - 1,5m³/g saída 1/2"}},
                {"status": "CANCELED", "requestedAmount": 9.0, "purchaseOrderItem": {"id": "o4"}, "originItem": {"code": "659", "name": "PADRÃO DE ENERGIA MONOFÁSICO - 5 m"}}]}]}


def test_solicitacao_8192_conta_so_o_que_virou_ordem_de_compra():
    obras = rm.somar(rm.compras_da_solicitacao(SOL_8192))
    o = obras["TB 21 QD 50 LT 34"]
    assert o["agua"]["comprado"] == 2 and o["energia"]["comprado"] == 2
    assert o["agua"]["insumos"] == ["656 - HIDROMETRO - 1,5m³/g saída 1/2"]


def test_solicitacao_recusada_nao_conta():
    assert rm.compras_da_solicitacao(dict(SOL_8192, approvalStatus="REJECTED")) == []


def test_data_no_formato_da_tela():
    import datetime as dt
    assert rm._com_data("2026-09-01T03:00:00.000Z", dt.date(2024, 11, 1)) == "2024-11-01T03:00:00.000Z"
    assert rm._com_data("2026-09-01", dt.date(2024, 11, 1)) == "2024-11-01"


def test_chave_da_obra_sem_cs():
    sol = dict(SOL_8192, work={"name": "TB 21 QD 50 LT 34 CS 2"})
    assert set(rm.somar(rm.compras_da_solicitacao(sol))) == {"TB 21 QD 50 LT 34"}


def test_so_as_obras_da_aba_apta():
    dados = {"ok": True, "ligacoes": [
        {"obra": "TB 17 QD 49 LT 11 CS 1", "v": {"STATUS": "NÃO LIGADO", "FEZ A SOLICITAÇÃO?": "NÃO"}},
        {"obra": "TB 17 QD 49 LT 11 CS 2", "v": {"STATUS": "NÃO LIGADO", "FEZ A SOLICITAÇÃO?": "NÃO"}},
        {"obra": "XX 01 QD 01 LT 01 CS 1", "v": {"STATUS": "LIGADO", "FEZ A SOLICITAÇÃO?": "SIM"}},
        {"obra": "XX 02 QD 01 LT 01 ÚNICA", "v": {"STATUS": "NÃO LIGADO", "FEZ A SOLICITAÇÃO?": "SIM"}}]}
    assert rm.obras_da_aba(dados) == {"TB17QD49LT11": "TB 17 QD 49 LT 11"}
    assert rm.chave_lote("TB 17 QD 49 LT 11") in rm.obras_da_aba(dados)


def test_guarda_a_solicitacao_para_o_link_do_mc():
    sol = dict(SOL_8192, id="6486e261-b336-4263-99e5-a27de4efb5ca")
    o = rm.somar(rm.compras_da_solicitacao(sol))["TB 21 QD 50 LT 34"]
    assert o["agua"]["solicitacoes"] == [{"id": "6486e261-b336-4263-99e5-a27de4efb5ca", "n": 8192}]
    assert o["energia"]["solicitacoes"][0]["n"] == 8192
