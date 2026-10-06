# -*- coding: utf-8 -*-
"""Regras puras do lançamento no Mais Controle. Dados inventados (repositório público)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import regras as R  # noqa: E402

CPF_OK = "52998224725"   # CPF de exemplo com dígito válido (não é de ninguém conhecido)


def txt(s):
    return {"type": "rich_text", "rich_text": [{"plain_text": s}]}


def num(n):
    return {"type": "number", "number": n}


def data(d):
    return {"type": "date", "date": {"start": d}}


def sel(s):
    return {"type": "select", "select": {"name": s}}


def pagina(**mudar):
    p = {
        "ENDEREÇO": {"type": "title", "title": [{"plain_text": "RUA TESTE QD 01 LT 02"}]},
        "CASA": num(2),
        "DATA DA VENDA": data("2026-10-01"),
        "CLIENTES": txt("Fulano De Tal E Beltrana De Tal"),
        "CPF": txt("529.982.247-25"),
        "EMAIL": {"type": "email", "email": "fulano@exemplo.com"},
        "Nº Whatsapp": {"type": "phone_number", "phone_number": "(62) 90000-0000"},
        "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(270000),
        "COMISSÃO": num(10000),
        "VALOR NA MÃO": num(260000),
        "CONTRATO - COMISSÃO PAGA POR": sel("COMPRADOR"),
        "CONTRATO - SINAL VALOR": num(5000),
        "CONTRATO - SINAL DATA": data("2026-09-28"),
        "CONTRATO - ENTRADA VALOR": num(10000),
        "CONTRATO - ENTRADA VENCIMENTO": data("2026-10-20"),
        "CONTRATO - INTERMEDIÁRIA VALOR": num(None),
        "CONTRATO - INTERMEDIÁRIA VENCIMENTO": data(None) if False else {"type": "date", "date": None},
        "VALOR FINANCIADO": num(230000),
        "VALOR DO SUBSÍDIO": num(5000),
        "VALOR DO FGTS": num(10000),
    }
    p.update(mudar)
    return p


def test_dados_da_pagina_le_tudo():
    d = R.dados_da_pagina(pagina())
    assert d["endereco"] == "RUA TESTE QD 01 LT 02" and d["casa"] == 2
    assert d["comprador"]["nome"] == "Fulano De Tal" and d["comprador"]["cpf"] == CPF_OK
    assert d["comprador"]["telefone"] == "62900000000"
    assert d["aquisicao"] == 260000


def test_aquisicao_comissao_paga_pelo_vendedor_e_o_total():
    d = R.dados_da_pagina(pagina(**{"CONTRATO - COMISSÃO PAGA POR": sel("VENDEDOR")}))
    assert d["aquisicao"] == 270000


def test_aquisicao_sem_valor_na_mao_usa_total_menos_comissao():
    d = R.dados_da_pagina(pagina(**{"VALOR NA MÃO": num(None)}))
    assert d["aquisicao"] == 260000


def test_parcelas_ordem_tipos_e_datas():
    d = R.dados_da_pagina(pagina())
    ps = R.parcelas(d)
    assert [p["rotulo"] for p in ps] == ["Sinal", "Entrada", "FGTS", "Financiamento"]
    assert ps[0]["tipo"] == R.TIPO_SINAL and ps[0]["data"] == "2026-09-28"
    assert ps[2]["tipo"] == R.TIPO_FGTS and ps[2]["data"] == "2026-10-31"
    assert ps[3]["valor"] == 235000 and ps[3]["tipo"] == R.TIPO_FINANCIAMENTO
    assert R.faltas(d) == []


def test_intermediaria_vira_entrada_com_comentario():
    d = R.dados_da_pagina(pagina(**{"CONTRATO - INTERMEDIÁRIA VALOR": num(5000),
                                    "CONTRATO - INTERMEDIÁRIA VENCIMENTO": data("2026-12-10"),
                                    "VALOR FINANCIADO": num(225000)}))
    corpo = R.corpo_venda(d, {"id": "o1", "name": "x"}, "c1", {"id": "k1"})
    inter = [i for i in corpo["tradeReceivable"]["installments"] if i["comment"] == "Intermediária"]
    assert len(inter) == 1 and inter[0]["readjustmentDetail"]["type"]["id"] == R.TIPO_ENTRADA
    assert R.faltas(d) == []


def test_soma_diferente_da_aquisicao_e_falta():
    d = R.dados_da_pagina(pagina(**{"VALOR FINANCIADO": num(200000)}))
    f = R.faltas(d)
    assert any("diferença R$ 30000.00" in x for x in f)


def test_cpf_invalido_e_sem_data_sao_faltas():
    d = R.dados_da_pagina(pagina(CPF=txt("111.111.111-11"), **{"DATA DA VENDA": {"type": "date", "date": None}}))
    f = R.faltas(d)
    assert "CPF do comprador vazio ou inválido" in f and "Falta a DATA DA VENDA" in f


def test_corpo_venda_formato_da_tela():
    d = R.dados_da_pagina(pagina())
    c = R.corpo_venda(d, {"id": "obra-1", "name": "RUA TESTE QD 01 LT 02"}, "cli-1", {"id": "conta-1"},
                      responsavel_id="u-1")
    assert c["description"] == "VENDA CASA 02 - FULANO DE TAL"
    assert c["interestRateAccumulateStrategy"] == "COMPOUND_INTEREST" and c["readjustmentEnabled"] is True
    tr = c["tradeReceivable"]
    assert tr["receivingCondition"] == {"id": R.CONDICAO_PARCELADO, "deferred": True}
    assert tr["defaultAccount"] == {"id": "conta-1"} and tr["nature"]["id"] == R.NATUREZA_VENDA
    assert tr["value"] == 260000 and tr["numberOfInstallments"] == 4
    p = tr["installments"][0]
    assert p["plannedValue"] == 5000 and p["readjustmentDetail"] == {
        "type": {"id": R.TIPO_SINAL}, "table": None, "rawValue": 5000, "reference": 0}


def test_corpo_cliente_pf():
    c = R.corpo_cliente(R.dados_da_pagina(pagina()))
    assert c["type"] == "PERSON" and c["role"] == "CUSTOMER" and c["cpf"] == CPF_OK
    assert c["name"] == "FULANO DE TAL" and c["phones"] == [{"number": "62900000000"}]


def test_venda_da_casa_acha_por_obra_e_casa():
    recs = [
        {"workName": "RUA TESTE QD 01 LT 02", "description": "CASA 02 - FULANO", "saleId": "s2"},
        {"workName": "RUA TESTE QD 01 LT 02", "description": "VENDA CS 01 - OUTRO", "saleId": "s1"},
        {"workName": "OUTRA QD 09 LT 09", "description": "CASA 02", "saleId": "x"},
        {"workName": "RUA TESTE QD 01 LT 02", "description": "1ª Sinal", "saleId": "s2"},
    ]
    assert R.venda_da_casa(recs, "rua teste qd 01 lt 02", 2) == ["s2"]
    assert R.venda_da_casa(recs, "RUA TESTE QD 01 LT 02", 3) == []


def test_casa_da_descricao_grafias_reais():
    for d, n in [("CASA 01", 1), ("VENDA CASA 2 - X", 2), ("VENDA CS 01 - Y", 1), ("CS 02", 2), ("CASA 3", 3)]:
        assert R.casa_da_descricao(d) == n
    assert R.casa_da_descricao("VENDA - SEM CASA") is None
