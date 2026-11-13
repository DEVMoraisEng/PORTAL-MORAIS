# -*- coding: utf-8 -*-
"""Auditoria Financeira — categorias renomeadas no ERP em 11/11/2026 e o alerta
de custo de obra depois da ENTREGA da casa.

Dados inventados: nenhum fornecedor, pessoa, CPF/CNPJ ou endereço real."""
from datetime import date

import pandas as pd
import pytest

import auditoria_regras as ar
import robo_auditoria_fin as robo
from auditoria_regras import Motor, manual_padrao_linhas, nome_atual

CC_OBRA = "QD 99 LT 01 - RUA FICTICIA"
CC_ADM = "ESCRITÓRIO - MORAIS ENGENHARIA"


def manual_antigo():
    """O manual como está no Supabase antes do ajuste: linhas de nome antigo,
    energia/água de obra descontinuadas em Utilidades."""
    cats = [c for c in manual_padrao_linhas()[1] if c["categoria"] not in ar.RENOMEADAS.values()]
    for nome, plano, uso, esc in (("Conta de energia", "Utilidades", "descontinuada", "ANY"),
                                  ("Conta de água", "Utilidades", "descontinuada", "ANY"),
                                  ("Fatura de Água", "Utilidades", "ok", "ADM"),
                                  ("Conta de internet", "Utilidades", "descontinuada", "ANY"),
                                  ("Uso do solo", "TAXAS GERAIS - OBRA E AVERBAÇÃO", "ok", "OBRA")):
        cats.append(dict(categoria=nome, secao_id="P1-06", plano=plano, classificacao="Outros",
                         escopo=esc, uso=uso, texto="", palavras="", ordem=99, ativo=True))
    return cats


# ---------------------------------------------------------------- nomes
@pytest.mark.parametrize("antigo,novo", [
    ("Conta de energia", "Energia de obra / unidade"),
    ("Conta de água", "Água de obra / unidade"),
    ("CONTA DE AGUA", "Água de obra / unidade"),
    ("Fatura de Água", "Fatura de Água (Escritório)"),
    ("Uso do solo", "Taxa de Uso do Solo (Obra)"),
    ("Conta de internet", "Internet de obra"),
    ("Energia de obra / unidade", "Energia de obra / unidade"),
    ("Materiais (Obras)", "Materiais (Obras)"),
    ("", ""),
])
def test_nome_atual(antigo, novo):
    assert nome_atual(antigo) == novo


def test_manual_padrao_sem_lacunas_nem_nomes_antigos():
    nomes = {c["categoria"]: c for c in manual_padrao_linhas()[1]}
    for antigo in ar.RENOMEADAS:
        assert antigo not in nomes
    for novo in ("Energia de obra / unidade", "Água de obra / unidade"):
        assert nomes[novo]["plano"] == "Custos de Obra — Taxas e Legalização"
        assert nomes[novo]["escopo"] == "OBRA" and nomes[novo]["uso"] == "ok"
    assert nomes["Fatura de Água (Escritório)"]["escopo"] == "ADM"
    assert nomes["Eventos de vendas e relacionamento com corretores"]["plano"] == "Venda de casa"
    assert nomes["Imobilizado - Stand de vendas"]["plano"] == "Imobilizado (somente fluxo de caixa)"
    assert nomes["Imobilizado - Stand de vendas"]["uso"] == "restrita"
    assert not hasattr(ar, "LACUNAS")


# ---------------------------------------------------------------- motor
@pytest.mark.parametrize("manual", [None, "antigo"], ids=["manual-novo", "manual-antigo"])
@pytest.mark.parametrize("cat", ["Conta de energia", "Energia de obra / unidade"])
def test_energia_de_obra_conforme_com_nome_antigo_ou_novo(manual, cat):
    m = Motor(manual_antigo() if manual else None)
    st, sug, _, motivo, _, _ = m.classificar("ENERGIA UC 1234567 REF OUT/2026 CASA 2", "", cat,
                                             "Custos de Obra — Taxas e Legalização", CC_OBRA)
    assert st == "OK", motivo
    assert sug is None


@pytest.mark.parametrize("manual", [None, "antigo"], ids=["manual-novo", "manual-antigo"])
@pytest.mark.parametrize("cat", ["Conta de água", "Água de obra / unidade"])
def test_agua_de_obra_conforme(manual, cat):
    m = Motor(manual_antigo() if manual else None)
    st, *_ = m.classificar("AGUA UC 7654321 REF SET/2026", "", cat,
                           "Custos de Obra — Taxas e Legalização", CC_OBRA)
    assert st == "OK"


def test_agua_de_obra_em_categoria_errada_sugere_a_nova():
    st, sug, plano, *_ = Motor().classificar("CONTA DE AGUA REF OUT/2026 CASA 3", "", "Outras Despesas",
                                             "Outras Despesas", CC_OBRA)
    assert sug == "Água de obra / unidade"
    assert plano == "Custos de Obra — Taxas e Legalização"
    assert st in ("DIVERGENTE", "GENERICA")


def test_agua_do_escritorio_vai_para_fatura_escritorio():
    m = Motor()
    st, sug, *_ = m.classificar("CONTA DE AGUA SALA REF OUT/2026", "", "Água de obra / unidade",
                                "Custos de Obra — Taxas e Legalização", CC_ADM)
    assert st == "DIVERGENTE" and sug == "Fatura de Água (Escritório)"
    st, *_ = m.classificar("CONTA DE AGUA SALA REF OUT/2026", "", "Fatura de Água", "Utilidades", CC_ADM)
    assert st == "OK"


def test_energia_da_casa_em_utilidades_do_escritorio_e_divergente():
    st, sug, *_ = Motor().classificar("ENERGIA UC 1234567 CASA 1", "", "Energia (Escritório)",
                                      "Utilidades", CC_OBRA)
    assert st == "DIVERGENTE" and sug == "Energia de obra / unidade"


def test_categoria_de_obra_no_cc_do_escritorio_aponta_cc():
    st, _, _, motivo, _, _ = Motor().classificar("CONTA DE ENERGIA", "", "Energia de obra / unidade",
                                                 "Custos de Obra — Taxas e Legalização", CC_ADM)
    assert st in ("CC", "DIVERGENTE")
    assert "descontinuada" not in motivo.lower() and "sem categoria" not in motivo.lower()


def test_nenhuma_sugestao_e_lacuna():
    m = Motor(manual_antigo())
    for desc in ("ENERGIA CASA 1", "AGUA CASA 1", "CONTA EQUATORIAL", "SANEAGO REF OUT"):
        for cat in ("Conta de energia", "Conta de água", "Outras Despesas"):
            st, sug, *_ = m.classificar(desc, "", cat, "x", CC_OBRA)
            assert "sem categoria no manual" not in (sug or "")
            assert st != "DESCONTINUADA"


def test_manual_antigo_avisa_o_que_ajustar():
    m = Motor(manual_antigo())
    avisos = " | ".join(m.manual_desatualizado)
    for antigo in ar.RENOMEADAS:
        assert f'"{antigo}"' in avisos
    assert "Energia de obra / unidade" in m.M and "Conta de energia" not in m.M
    assert Motor().manual_desatualizado == []


def test_manual_ja_ajustado_vale_o_do_supabase():
    cats = manual_padrao_linhas()[1]
    for c in cats:
        if c["categoria"] == "Água de obra / unidade":
            c["texto"] = "texto editado no portal"
    m = Motor(cats)
    assert m.M["Água de obra / unidade"]["texto"] == "texto editado no portal"


def test_stand_de_vendas_nao_e_auditado():
    st, sug, *_ = Motor().classificar("MONTAGEM STAND", "", "Imobilizado - Stand de vendas",
                                      "Imobilizado (somente fluxo de caixa)", CC_OBRA)
    assert st == "NAO_AVALIADO" and sug is None


def test_cadastro_erp_junta_nome_antigo_e_novo():
    linhas = [("Conta de água", "Custos de Obra — Taxas e Legalização", "Outros"),
              ("Água de obra / unidade", "Custos de Obra — Taxas e Legalização", "Outros")]
    out = Motor().cadastro_erp(linhas)
    assert out == []          # mesmo plano e classificação do manual: nada a ajustar


# ---------------------------------------------------------------- robô
def test_cats_util_aceita_os_dois_nomes():
    for x in ("Conta de energia", "Energia de obra / unidade", "Conta de água", "Água de obra / unidade",
              "Fatura de Água", "Fatura de Água (Escritório)", "Energia (Escritório)"):
        assert ar.N(x) in robo.CATS_UTIL


def _pag(linhas):
    base = dict(id=0, np="1", dc=None, dv=None, dp=None, v=100.0, vp=100.0, de=0.0, jm=0.0, f="FORNECEDOR X",
                d="", nd="", c="", g="", p="", fp="", q="", cb="", io=0, cc=CC_OBRA, ix="", oc="", st="OK")
    p = pd.DataFrame([dict(base, **l) for l in linhas])
    p["k"] = [f"k{i}" for i in range(len(p))]
    return p


def test_dup_de_agua_pela_uc_com_nome_antigo_e_novo():
    p = _pag([
        dict(id=1, c="Conta de água", d="AGUA UC: 1234567 REF OUT/2026", dp=date(2026, 11, 3), dc=date(2026, 10, 1)),
        dict(id=2, c="Água de obra / unidade", d="AGUA UC 1234567 REF OUT/2026", dp=date(2026, 11, 5), dc=date(2026, 10, 1)),
    ])
    achados = robo.fiscalizar(p, None)
    assert [a[0] for a in achados if a[0] == "DUP"] == ["DUP"]


def test_baixa_automatica_nao_confunde_renomeacao_com_correcao():
    p = _pag([dict(id=1, c="Água de obra / unidade", st="DIVERGENTE", dp=date(2026, 11, 3))])
    val = [{"chave": "k0", "status": "CORRIGIR", "tipo": "AUDIT", "categoria_atual": "Conta de água",
            "centro_de_custo": CC_OBRA}]
    assert robo.baixar_corrigidos(val, p) == 0


def test_excecao_com_nome_antigo_vale_para_o_novo():
    p = _pag([dict(id=1, c="Água de obra / unidade", st="DIVERGENTE")])
    n = robo.aplicar_excecoes(p, [{"id": 7, "categoria": "Conta de água", "fornecedor": "FORNECEDOR X"}])
    assert n == 1 and p.ex.iloc[0] == 7


def test_preparar_pagamentos_troca_nome_antigo():
    df = pd.DataFrame([{"id_lancamento": "10", "valor_parcela": "50", "categoria": "Conta de energia",
                        "data_pagamento": "2026-11-01"}])
    p = robo.preparar_pagamentos(df)
    assert p.c.iloc[0] == "Energia de obra / unidade"


# ---------------------------------------------------------------- pós-obra pela entrega
def _casas(*vendas):
    return robo.casas_por_endereco([dict(endereco="RUA FICTICIA", casa=c, data_entrega=e) for c, e in vendas],
                                   lambda x: x)


def test_entrega_pela_casa_da_descricao():
    casas = _casas((1, "2026-05-10"), (2, None))["RUA FICTICIA"]
    assert robo.entrega_do_pagamento(casas, "CIMENTO CASA 1") == date(2026, 5, 10)
    assert robo.entrega_do_pagamento(casas, "CIMENTO CS 02") is None       # casa 2 não entregue
    assert robo.entrega_do_pagamento(casas, "CIMENTO") is None             # lote com casa não entregue


def test_entrega_sem_casa_na_descricao_quando_todas_entregues():
    casas = _casas((1, "2026-05-10"), (2, "2026-06-20"))["RUA FICTICIA"]
    assert robo.entrega_do_pagamento(casas, "CIMENTO") == date(2026, 6, 20)


def test_achados_pos_entrega():
    casas = _casas((1, "2026-05-10"), (2, None))
    p = _pag([
        dict(c="Materiais (Obras)", d="CIMENTO CASA 1", dp=date(2026, 8, 1)),            # 83 dias depois: pós-obra
        dict(c="Materiais (Obras)", d="CIMENTO CASA 1", dp=date(2026, 6, 1)),            # 22 dias: tolerância
        dict(c="Materiais (Obras)", d="CIMENTO CASA 2", dp=date(2026, 10, 1)),           # casa 2 não entregue
        dict(c="Mão de Obra Terceirizada", d="PINTURA", dp=date(2026, 10, 1)),          # lote não todo entregue
        dict(c="Conta de energia", d="ENERGIA CASA 1", dc=date(2026, 9, 1), dp=date(2026, 9, 10)),
        dict(c="Água de obra / unidade", d="AGUA CASA 1", dc=date(2026, 9, 1), dp=date(2026, 9, 10)),
        dict(c="Materiais (Obras)", d="CIMENTO CASA 1", dp=date(2026, 8, 1), cc="OUTRA OBRA"),
    ])
    p["cc_pad"] = p.cc.map(lambda x: "RUA FICTICIA" if x == CC_OBRA else x)
    achados = robo.achados_pos_entrega(p, casas)
    assert sorted((a[0], a[1]) for a in achados) == [("OBRA_FINALIZADA", 0), ("UTIL_ENTREGUE", 4),
                                                       ("UTIL_ENTREGUE", 5)]
    assert "pós-obra" in achados[0][2]


def test_texto_do_alerta_fala_de_entrega():
    t, d = robo.FISCAL_TIPOS["OBRA_FINALIZADA"]
    assert "entrega" in t.lower() and "ENTREGA" in d


# ---------------------------------------------------------------- 11/11 tarde: export velho e mais renomeações
OBRA_C = "Custos de Obra — Taxas e Legalização"


def test_padrao_com_renomeacoes_exclusoes_e_mobiliario():
    nomes = {c["categoria"]: c for c in manual_padrao_linhas()[1]}
    for excluida in ("Certidão de Obra", "TLF / Uso do Solo (Obra)", "Uso do solo", "Conta de internet"):
        assert excluida not in nomes
    for nova in ("Taxa de Uso do Solo (Obra)", "Internet de obra"):
        assert nomes[nova]["plano"] == OBRA_C and nomes[nova]["escopo"] == "OBRA" and nomes[nova]["uso"] == "ok"
    mob = nomes["Mobiliário e decoração (unidade decorada)"]
    assert (mob["plano"], mob["classificacao"], mob["escopo"]) == ("Materiais", "Materiais", "OBRA")
    for regra in ar.R:
        for c in regra[1]:
            assert c not in ("Certidão de Obra", "TLF / Uso do Solo (Obra)"), regra


@pytest.mark.parametrize("cat,plano_velho", [
    ("Energia de obra / unidade", "Utilidades"),
    ("Conta de energia", "Utilidades"),
    ("Água de obra / unidade", "Utilidades"),
    ("Internet de obra", "Utilidades"),
    ("Taxa de Uso do Solo (Obra)", "TAXAS GERAIS - OBRA E AVERBAÇÃO"),
])
def test_export_com_plano_de_antes_da_renomeacao_nao_e_cadastro(cat, plano_velho):
    desc = {"Internet de obra": "INTERNET STAND", "Taxa de Uso do Solo (Obra)": "TLF LOTE 3"}.get(
        nome_atual(cat), "CONTA ENERGIA UC 123456 CASA 1" if "nergia" in cat else "CONTA AGUA UC 123456 CASA 1")
    st, *_ , alertas, _ = Motor().classificar(desc, "", cat, plano_velho, CC_OBRA)
    assert st == "OK", (st, alertas)
    assert Motor().cadastro_erp([(cat, plano_velho, "Materiais")] * 3) == []


def test_plano_errado_que_nao_e_o_antigo_continua_cadastro():
    st, *_ = Motor().classificar("CONTA ENERGIA UC 123456 CASA 1", "", "Energia de obra / unidade",
                                 "Outras Despesas", CC_OBRA)
    assert st == "CADASTRO"
    out = Motor().cadastro_erp([("Energia de obra / unidade", OBRA_C, "Materiais")])
    assert [x["tipo"] for x in out] == ["CLASSIFICACAO"]


def test_internet_escritorio_e_obra():
    m = Motor()
    st, sug, *_ = m.classificar("INTERNET STAND", "", "Internet / Celular", "Utilidades", CC_OBRA)
    assert st == "DIVERGENTE" and sug == "Internet de obra"
    st, sug, *_ = m.classificar("INTERNET SALA", "", "Conta de internet", "Utilidades", CC_ADM)
    assert st == "DIVERGENTE" and sug == "Internet / Celular"


@pytest.mark.parametrize("desc", ["TLF LOTE 3", "TAXA USO DO SOLO QD 9"])
def test_taxa_de_uso_do_solo_sugerida_para_taxas_gerais(desc):
    st, sug, *_ = Motor().classificar(desc, "", "Taxas gerais", "TAXAS GERAIS - OBRA E AVERBAÇÃO", CC_OBRA)
    assert sug == "Taxa de Uso do Solo (Obra)"


# ---------------------------------------------------------------- eventos de venda (regra do dono 11/11/2026)
CC_COND = "CONDOMÍNIO FICTICIO"


@pytest.mark.parametrize("desc,cat,plano", [
    ("SALGADOS PARA DIA D DE VENDAS", "Marketing", "Despesas Administrativas"),
    ("SALGADOS CAFÉ DA MANHA CORRETORES", "Alimentação / Lanches", "Despesas Administrativas"),
    ("BOLO DE CENOURA - DIA D", "Marketing", "Despesas Administrativas"),
    ("LOCAÇÃO DE MESAS PARA EVENTO DE LANÇAMENTO", "Locação de equipamentos", "Equipamentos"),
])
def test_lanche_de_evento_de_venda_sugere_eventos_de_vendas(desc, cat, plano):
    st, sug, *_ = Motor().classificar(desc, "", cat, plano, CC_COND)
    assert st == "DIVERGENTE" and sug == "Eventos de vendas e relacionamento com corretores"


@pytest.mark.parametrize("desc", ["SALGADOS PARA CAFÉ DA MANHÃ - RODADA DE NEGÓCIOS", "BOLOS PARA MEETING"])
def test_eventos_de_vendas_nao_e_mais_divergente(desc):
    st, *_ = Motor().classificar(desc, "", "Eventos de vendas e relacionamento com corretores", "Venda de casa", CC_COND)
    assert st != "DIVERGENTE"


def test_lanche_do_escritorio_continua_alimentacao():
    st, sug, *_ = Motor().classificar("CAFE E BOLOS DO ESCRITORIO", "", "Marketing", "", CC_ADM)
    assert sug == "Alimentação / Lanches"
