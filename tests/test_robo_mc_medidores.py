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
