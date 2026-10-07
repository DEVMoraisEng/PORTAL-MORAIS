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
    assert len(inter) == 1 and inter[0]["readjustmentDetail"]["type"]["id"] == R.TIPO_INTERMEDIARIA
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
    assert tr["receivingCondition"] == {"id": R.CONDICAO_PARCELADO, "name": "Parcelado", "deferred": True}
    assert tr["defaultAccount"] == {"id": "conta-1"} and tr["nature"] == {"id": R.NATUREZA_VENDA, "name": "Venda"}
    assert tr["value"] == 260000 and tr["numberOfInstallments"] == 4
    p = tr["installments"][0]
    assert p["plannedValue"] == 5000 and p["readjustmentDetail"] == {
        "type": {"id": R.TIPO_SINAL}, "table": None, "rawValue": 5000, "reference": 0}


def test_corpo_cliente_pf():
    c = R.corpo_cliente(R.dados_da_pagina(pagina()))
    assert c["type"] == "PERSON" and c["role"] == "CUSTOMER" and c["cpf"] == CPF_OK
    assert c["name"] == "FULANO DE TAL" and c["phones"] == [{"number": "62900000000"}]


OBRA = "RUA TESTE QD 01 LT 02"


def test_venda_da_casa_separa_mesma_casa_e_sem_casa():
    recs = [
        {"workName": OBRA, "description": "CASA 02 - FULANO", "saleId": "s2", "customerName": "X"},
        {"workName": OBRA, "description": "VENDA CS 01 - OUTRO", "saleId": "s1"},
        {"workName": "OUTRA QD 09 LT 09", "description": "CASA 02", "saleId": "x"},
        {"workName": OBRA, "description": "SO O NOME DE ALGUEM", "saleId": "s9"},
        {"workName": OBRA, "description": "CASA 02 - FULANO", "saleId": "s2"},
    ]
    mesma, sem = R.venda_da_casa(recs, "rua teste qd 01 lt 02", 2)
    assert [v["id"] for v in mesma] == ["s2"] and mesma[0]["cliente"] == "X"
    assert [v["id"] for v in sem] == ["s9"]
    mesma, sem = R.venda_da_casa(recs, OBRA, 3)
    assert mesma == [] and [v["id"] for v in sem] == ["s9"]


def test_casa_da_descricao_grafias_reais_e_variantes():
    # as grafias medidas no ERP em 06/10/2026 (nomes trocados por inventados)
    casos = [("VENDA CASA 02 - NOME", 2), ("CASA 02 - NOME", 2), ("CASA 01", 1), ("VENDA CS 01 - NOME", 1),
             ("CASA 3", 3), ("VENDA CASA 02 -  NOME", 2), ("VENDA CASA 1 - NOME", 1), ("CASA 01 -  NOME", 1),
             ("CS 02", 2), ("RPB 24 QD 26A L07 CASA 02 - NOME", 2),
             ("CASA-01", 1), ("CASA Nº 01", 1), ("CASA N. 01", 1), ("CS.01", 1), ("UNIDADE 01", 1), ("CASA01", 1)]
    for d, n in casos:
        assert R.casa_da_descricao(d) == n, d
    for d in ("SO O NOME", "CASAS 01 E 02", "CASA 1A - NOME", "CASA 1 E CASA 2"):
        assert R.casa_da_descricao(d) is None, d
    assert R.casa_da_descricao("CASA 1 - X") != 10 and R.casa_da_descricao("CASA 10 - X") == 10


def test_casa_com_dois_numeros_e_falta():
    d = R.dados_da_pagina(pagina(CASA=txt("1 e 2")))
    assert d["casa"] is None and "CASA com mais de um número — deixe só o número da casa" in R.faltas(d)


def test_data_em_texto_br_vira_iso_e_texto_estranho_e_falta():
    d = R.dados_da_pagina(pagina(**{"DATA DA VENDA": txt("01/10/2026")}))
    assert d["data_venda"] == "2026-10-01" and R.faltas(d) == []
    d = R.dados_da_pagina(pagina(**{"DATA DA VENDA": txt("outubro")}))
    assert "DATA DA VENDA em formato que não entendi" in R.faltas(d)


def test_numero_com_ponto_de_milhar():
    assert R._num("250.000") == 250000 and R._num("1.234.567") == 1234567 and R._num("250.000,50") == 250000.5
    assert R._num("10.5") == 10.5


def test_comissao_paga_por_obrigatoria_e_conta_da_mao():
    d = R.dados_da_pagina(pagina(**{"CONTRATO - COMISSÃO PAGA POR": {"type": "select", "select": None}}))
    assert "Falta COMISSÃO PAGA POR (comprador ou vendedor)" in R.faltas(d)
    d = R.dados_da_pagina(pagina(**{"VALOR NA MÃO": num(255000)}))
    assert "Valor na mão + comissão diferente do valor do contrato" in R.faltas(d)


def test_assinatura_muda_com_valor_e_cpf_mas_nao_com_cliente():
    d = R.dados_da_pagina(pagina())
    c1 = R.corpo_venda(d, {"id": "o"}, "(CLIENTE NOVO)", {"id": "k"})
    c2 = R.corpo_venda(d, {"id": "o"}, "cli-real", {"id": "k"})
    assert R.assinatura(c1, CPF_OK) == R.assinatura(c2, CPF_OK)
    assert R.assinatura(c1, CPF_OK) != R.assinatura(c1, "11144477735")
    d2 = R.dados_da_pagina(pagina(**{"CONTRATO - SINAL VALOR": num(5001), "VALOR FINANCIADO": num(229999)}))
    assert R.assinatura(R.corpo_venda(d2, {"id": "o"}, "x", {"id": "k"}), CPF_OK) != R.assinatura(c1, CPF_OK)
    assert R.assinatura_da_situacao("PRÉVIA OK [#0a1b2c3d] — x") == "0a1b2c3d"



def test_corretor_vai_na_observacao():
    d = R.dados_da_pagina(pagina(CORRETOR=sel("Corretor Exemplo"), **{"IMOBILIÁRIA": sel("Imob Exemplo")}))
    c = R.corpo_venda(d, {"id": "o"}, "c", {"id": "k"})
    assert c["comment"] == "Corretor: Corretor Exemplo | Imobiliária: Imob Exemplo | Comissão: R$ 10000,00 (paga pelo comprador)"
    d = R.dados_da_pagina(pagina(**{"COMISSÃO": num(None)}))
    assert "comment" not in R.corpo_venda(d, {"id": "o"}, "c", {"id": "k"})
