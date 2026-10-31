# -*- coding: utf-8 -*-
"""Venda do condomínio: parcelas a partir do fluxo do simulador. Dados inventados (repositório público)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import condominio as C  # noqa: E402
from venda.mc import lancar as L  # noqa: E402
from venda.mc import regras as R  # noqa: E402
from venda.mc.testes.test_lancar import ErpFake, NotionFake  # noqa: E402
from venda.mc.testes.test_regras import data, num, pagina, sel, txt  # noqa: E402

COND_ID = "a" * 32


def fluxo_props(**mudar):
    p = {
        "UNIDADE": {"type": "title", "title": [{"plain_text": "12"}]},
        "DATA DE ASSINATURA DO CONTRATO": data("2026-10-10"), "DIA PAGAMENTO PARCELAS": num(31),
        "DATA DA ENTREGA": data("2028-12-15"),
        "VALOR SINAL ATO": num(5000), "VALOR SINAL 30 DIAS": num(2000), "DATA SINAL 30 DIAS": data("2026-11-09"),
        "VALOR SINAL 60 DIAS ": num(None), "VALOR SINAL 90 DIAS ": num(None),
        "Nº PARCELAS 1º PARTE PRÉ CHAVES": num(2), "VALOR 1º PARTE PRÉ CHAVES": num(1000),
        "DATA 1º PARTE PRÉ CHAVES": data("2026-11-30"),
        "Nº PARCELAS 2º PARTE PRÉ CHAVES": num(1), "VALOR 2º PARTE PRÉ CHAVES": num(500),
        "DATA 2º PARTE PRÉ CHAVES": data("2027-01-31"),
        "VALOR 1º BALÃO": num(3000), "DATA 1º BALÃO (12/27)": data("2027-12-31"),
        "VALOR BALÃO ENTREGA DE CHAVES": num(4000), "DATA 2º BALÃO (25º PARCELA)": data("2028-11-30"),
        "Nº PARCELAS PÓS CHAVES": num(3), "VALOR PÓS CHAVES": num(800), "DATA  PÓS CHAVES ": data("2029-01-31"),
    }
    p.update(mudar)
    return p


def dados_venda(**mudar):
    base = {"ENDEREÇO": {"type": "title", "title": [{"plain_text": "CONDOMÍNIO RESERVA TESTE"}]},
            "CASA": num(12), "CONDOMÍNIO - VENDA ID": txt(COND_ID),
            "CONTRATO - SINAL VALOR": num(None), "CONTRATO - ENTRADA VALOR": num(None),
            "VALOR FINANCIADO": num(200000), "VALOR DO SUBSÍDIO": num(None), "VALOR DO FGTS": num(10000),
            "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(228900), "COMISSÃO": num(10000),
            "VALOR NA MÃO": num(228900), "CONTRATO - COMISSÃO PAGA POR": sel("COMPRADOR")}
    base.update(mudar)
    return pagina(**base)


def test_data_no_dia_cai_no_fim_do_mes():
    assert C.data_no_dia("2026-11-30", 3, 31) == "2027-02-28"
    assert C.data_no_dia("2027-01-31", 1, None) == "2027-02-28"
    assert C.data_no_dia("2026-12-10", 12, 10) == "2027-12-10"


def test_parcelas_do_fluxo_tipos_tabelas_e_datas():
    fx = C.fluxo(fluxo_props())
    assert fx["unidade"] == 12 and fx["dia"] == 31 and fx["dP"] == "2029-01-31"
    ps = C.parcelas(fx, {"data_venda": "2026-10-10", "fgts": 10000, "financiado": 200000})
    rot = [p["rotulo"] for p in ps]
    assert rot == ["Sinal ato", "Sinal 30 dias", "Pré-chaves 1ª parte 1/2", "Pré-chaves 1ª parte 2/2",
                   "Pré-chaves 2ª parte 1/1", "Balão 12/27", "Balão entrega de chaves",
                   "Pós-chaves 1/3", "Pós-chaves 2/3", "Pós-chaves 3/3", "FGTS", "Financiamento"]
    por = {p["rotulo"]: p for p in ps}
    assert por["Sinal ato"]["data"] == "2026-10-10" and por["Sinal ato"]["tabela"] is None
    assert por["Pré-chaves 1ª parte 2/2"]["data"] == "2026-12-31" and por["Pré-chaves 1ª parte 2/2"]["tabela"] == "INCC-M"
    assert por["Balão 12/27"]["tipo"] == R.TIPO_INTERMEDIARIA and por["Balão 12/27"]["tabela"] == "INCC-M"
    assert por["Balão entrega de chaves"]["tipo"] == R.TIPO_CHAVES
    assert por["Pós-chaves 2/3"]["data"] == "2029-02-28" and por["Pós-chaves 2/3"]["tabela"] == "IPCA + 1% a.m."
    assert por["Financiamento"]["tabela"] is None and por["FGTS"]["data"] == "2026-11-09"


def test_faltas_do_fluxo():
    fx = C.fluxo(fluxo_props(**{"DIA PAGAMENTO PARCELAS": num(None), "DATA  PÓS CHAVES ": data(None)}))
    f = C.faltas_do_fluxo(fx, 13)
    assert any("DIA PAGAMENTO" in x for x in f) and any("PÓS CHAVES" in x for x in f)
    assert any("diferente da UNIDADE" in x for x in f)


def _livre(linhas, valor=228900, **extra):
    import json
    return {"FLUXO PERSONALIZADO": {"type": "rich_text", "rich_text": [{"plain_text": json.dumps({"v": 1, "valor": valor, "entrega": "2028-12-15", "linhas": linhas, **extra})}]}}


# mesmo total da linha de teste (228.900): sinal em 2x, um balão a mais, permuta, pós-chaves com a última diferente
LIVRE = [{"t": "sinal", "v": 3500, "n": 2, "d": "2026-10-10", "i": 1},
         {"t": "pre", "v": 500, "n": 3, "d": "2026-11-30", "i": 1},
         {"t": "balao", "v": 1500, "n": 2, "d": "2027-06-30", "i": 6},
         {"t": "balao", "v": 4000, "n": 1, "d": "2028-11-30", "i": 1},
         {"t": "permuta", "v": 1000, "n": 1, "d": "2026-11-15", "i": 1, "x": "veículo marca/modelo/ano/placa"},
         {"t": "pos", "v": 790, "n": 3, "d": "2029-01-31", "i": 1, "u": 820},
         {"t": "fin", "v": 200000, "n": 1, "d": "", "i": 1}, {"t": "fgts", "v": 10000, "n": 1, "d": "", "i": 1}]


def test_fluxo_ilegivel_recusa_e_lista_que_nao_fecha_recusa():
    sem = C.fluxo(fluxo_props())
    assert sem["personalizado"] is False and sem["livre"] is None and C.faltas_do_fluxo(sem, sem["unidade"]) == []
    com = C.fluxo(fluxo_props(**{"FLUXO PERSONALIZADO": {"type": "rich_text", "rich_text": [{"plain_text": '{"v":1}'}]}}))
    assert any("ilegível" in x for x in C.faltas_do_fluxo(com, com["unidade"]))
    torto = C.fluxo(fluxo_props(**_livre(LIVRE, valor=230000)))
    assert any("não fecha" in x for x in C.faltas_do_fluxo(torto, torto["unidade"]))


def test_parcelas_do_fluxo_alterado_linha_a_linha():
    fx = C.fluxo(fluxo_props(**_livre(LIVRE)))
    assert C.faltas_do_fluxo(fx, fx["unidade"]) == []
    ps = C.parcelas(fx, {"data_venda": "2026-09-01"}, 30)
    assert round(sum(p["valor"] for p in ps), 2) == 228900
    por = {p["rotulo"]: p for p in ps}
    assert por["Sinal 1/2"]["tipo"] == R.TIPO_SINAL and por["Sinal 2/2"]["data"] == "2026-11-10"
    assert por["Balão 2/2"]["data"] == "2027-12-30" and por["Balão 2/2"]["tipo"] == R.TIPO_INTERMEDIARIA
    assert por["Balão"]["tipo"] == R.TIPO_CHAVES, "o balão na data do balão da entrega continua CHAVES"
    assert por["Permuta - veículo marca/modelo/ano/placa"]["tipo"] == R.TIPO_ENTRADA
    assert por["Permuta - veículo marca/modelo/ano/placa"]["tabela"] is None
    assert (por["Pós-chaves 3/3"]["valor"], por["Pós-chaves 3/3"]["tabela"]) == (820, C.TABELA_POS)
    assert por["Pós-chaves 2/3"]["data"] == "2029-02-28"
    assert (por["Financiamento"]["data"], por["FGTS"]["valor"]) == ("2026-11-09", 10000)
    assert [p["data"] for p in ps] == sorted(p["data"] for p in ps)


def test_previa_do_fluxo_alterado_leva_a_permuta_no_comentario(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n, e = NotionLinha(linha_cond(**_livre(LIVRE))), ErpLinha()
    r = L.processar(LINHA_ID, n, e)
    assert r["situacao"] == "PREVIA", r
    inst = r["corpo_venda"]["tradeReceivable"]["installments"]
    assert len(inst) == 14 and round(sum(i["plannedValue"] for i in inst), 2) == 228900
    assert any(i["comment"] == "Permuta - veículo marca/modelo/ano/placa" for i in inst)


def test_valor_da_casa_mudado_no_fluxo_alterado_vira_o_total_e_a_comissao_pela_regra():
    linhas = [dict(l) for l in LIVRE]
    linhas[4]["v"] = 6000                                    # permuta 5 mil maior: casa de 233.900
    fx = C.fluxo(fluxo_props(**{"PRAZO ENTRADA": num(48)}, **_livre(linhas, valor=233900)))
    d = {"total": 228900, "aquisicao": 228900, "comissao": 10000}
    C.ajustar_dados_livre(fx, d)
    assert (d["total"], d["aquisicao"]) == (233900, 233900)
    assert d["comissao"] == 10525.5   # 4,5% (48 meses) de 233.900
    igual = {"total": 228900, "aquisicao": 228900, "comissao": 10000}
    C.ajustar_dados_livre(C.fluxo(fluxo_props(**_livre(LIVRE))), igual)
    assert igual["comissao"] == 10000, "sem mudar o valor da casa a comissão da linha fica"


def test_escolher_obra_e_sempre_o_condominio_inteiro():
    obras = [{"id": "g", "name": "CONDOMÍNIO RESERVA TESTE"}, {"id": "c12", "name": "RESERVA TESTE CASA 12"},
             {"id": "c1", "name": "RESERVA TESTE CASA 1"}]
    assert [o["id"] for o in C.escolher_obra(obras, "CONDOMÍNIO RESERVA TESTE", 12)] == ["g"]
    assert [o["id"] for o in C.escolher_obra(obras, "CONDOMÍNIO RESERVA TESTE", 30)] == ["g"]
    assert [o["id"] for o in C.escolher_obra(obras[:1], "Condominio Reserva Teste", 12)] == ["g"]


class NotionDuas(NotionFake):
    def __init__(self, venda, cond, mae=None):
        super().__init__(venda)
        self.cond = {"properties": cond, "parent": {"database_id": mae or "b" * 32}}

    def pagina(self, pid):
        return self.cond if pid == COND_ID else super().pagina(pid)


class ErpCond(ErpFake):
    def __init__(self, tabelas=None, **kw):
        super().__init__(obras=[{"id": "g", "name": "CONDOMÍNIO RESERVA TESTE"}], **kw)
        self._tabs = tabelas if tabelas is not None else [{"id": "ti", "name": "INCC-M"}, {"id": "tp", "name": "IPCA + 1% a.m."}]

    def tabelas_reajuste(self):
        return self._tabs


def test_previa_do_condominio_usa_tabelas_e_referencia_2(monkeypatch):
    monkeypatch.delenv("DB_VENDAS_COND", raising=False)
    n = NotionDuas(dados_venda(), fluxo_props())
    r = L.processar("p", n, ErpCond(), aplicar=False)
    assert r["situacao"] == "PREVIA", r
    inst = r["corpo_venda"]["tradeReceivable"]["installments"]
    assert len(inst) == 12
    pre = [i for i in inst if i["comment"].startswith("Pré-chaves")]
    assert all(i["readjustmentDetail"]["table"] == {"id": "ti", "name": "INCC-M"} for i in pre)
    assert all(i["readjustmentDetail"]["reference"] == 2 for i in pre)
    pos = [i for i in inst if i["comment"].startswith("Pós-chaves")]
    assert pos[0]["readjustmentDetail"]["table"]["id"] == "tp"
    sinal = inst[0]
    assert sinal["readjustmentDetail"]["table"] is None and sinal["readjustmentDetail"]["reference"] == 0
    assert r["corpo_venda"]["description"].startswith("VENDA UNIDADE 12 - ")
    assert "Pós-chaves 3x" in n.gravado["MC - SITUAÇÃO"]


def test_condominio_sem_tabela_recusa():
    n = NotionDuas(dados_venda(), fluxo_props())
    r = L.processar("p", n, ErpCond(tabelas=[{"id": "ti", "name": "INCC-M"}]), aplicar=False)
    assert r["codigo"] == "TABELA_DE_REAJUSTE" and "IPCA" in n.gravado["MC - SITUAÇÃO"]


def test_condominio_soma_diferente_recusa():
    n = NotionDuas(dados_venda(**{"VALOR NA MÃO": num(300000), "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(310000)}),
                   fluxo_props())
    r = L.processar("p", n, ErpCond(), aplicar=False)
    assert r["codigo"] == "FALTAS" and "Soma das parcelas" in n.gravado["MC - SITUAÇÃO"]


def test_condominio_de_outra_base_recusa(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", "c" * 32)
    n = NotionDuas(dados_venda(), fluxo_props())
    r = L.processar("p", n, ErpCond(), aplicar=False)
    assert r["codigo"] == "CONDOMINIO_OUTRA_BASE"


def test_resumo_agrupa_series():
    fx = C.fluxo(fluxo_props())
    ps = C.parcelas(fx, {"data_venda": "2026-10-10"})
    t = R.resumo_parcelas(ps)
    assert "Pré-chaves 1ª parte 2x R$ 1.000,00 de 30/11/2026 a 31/12/2026" in t
    assert "Pós-chaves 3x R$ 800,00 de 31/01/2029 a 31/03/2029" in t
    assert "Sinal ato R$ 5.000,00 em 10/10/2026" in t


def test_corretor_novo_leva_email_celular_e_creci(monkeypatch):
    monkeypatch.delenv("DB_VENDAS_COND", raising=False)
    cond = fluxo_props(**{"EMAIL CORRETOR": txt("corretor@exemplo.test"), "CELULAR CORRETOR": txt("(62) 90000-0001"),
                          "CRECI": num(12345)})
    n = NotionDuas(dados_venda(), cond)
    e = ErpCond()
    L.processar("p", n, e)
    L.processar("p", n, e, aplicar=True)
    cor = e.criados[0][1]
    assert cor["role"] == "SUPPLIER" and cor["email"] == "corretor@exemplo.test"
    assert cor["phones"] == [{"number": "62900000001"}] and cor["comment"] == "Corretor — CRECI 12345"


def test_condominio_financiamento_30_dias_apos_assinatura_e_cpf_do_corretor_da_pasta(monkeypatch):
    monkeypatch.delenv("DB_VENDAS_COND", raising=False)
    fx = C.fluxo(fluxo_props())
    ps = C.parcelas(fx, {"data_venda": "2026-09-01", "fgts": 100, "financiado": 1000})
    assert {p["rotulo"]: p["data"] for p in ps}["Financiamento"] == "2026-11-09"   # assinatura 10/10 + 30
    cond = fluxo_props(**{"CPF CORRETOR": txt("111.444.777-35")})
    n = NotionDuas(dados_venda(), cond)
    n.corretores = []
    e = ErpCond()
    r = L.processar("p", n, e)
    assert r["situacao"] == "PREVIA", r
    L.processar("p", n, e, aplicar=True)
    assert e.criados[0][1]["role"] == "SUPPLIER" and e.criados[0][1]["cpf"] == "11144477735"


def test_venda_ja_lancada_com_unidade_na_descricao_e_reconhecida():
    recs = [{"workName": "CONDOMÍNIO RESERVA TESTE", "description": "VENDA UNIDADE 12 - OUTRO NOME", "saleId": "s12",
             "customerName": "OUTRO"},
            {"workName": "CONDOMÍNIO RESERVA TESTE", "description": "VENDA UNIDADE 07 - X", "saleId": "s7"}]
    mesma, sem = R.venda_da_casa(recs, "CONDOMÍNIO RESERVA TESTE", 12)
    assert [v["id"] for v in mesma] == ["s12"] and sem == []


def test_condominio_sem_comissao_paga_por_usa_valor_de_venda(monkeypatch):
    monkeypatch.delenv("DB_VENDAS_COND", raising=False)
    venda = dados_venda(**{"CONTRATO - COMISSÃO PAGA POR": {"type": "select", "select": None},
                           "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(228900),
                           "VALOR NA MÃO": num(220000)})
    r = L.processar("p", NotionDuas(venda, fluxo_props()), ErpCond(), aplicar=False)
    assert r["situacao"] == "PREVIA", r


# ---------------- entrega 7: o robô lê a própria linha do condomínio ----------------
LINHA_ID = "d" * 32
DB_COND = "e" * 32


def linha_cond(**mudar):
    """Linha da BANCO DE DADOS VENDAS CONDOMÍNIO com tudo que a venda precisa (fluxo que fecha em 228.900)."""
    p = fluxo_props(**{
        "CONDOMÍNIO": sel("RESERVA TESTE"), "PROPONENTE": txt("Fulana De Teste"), "CPF PROPONENTE": txt("529.982.247-25"),
        "Email": {"type": "email", "email": "fulana@exemplo.test"}, "Nº Whatsapp": {"type": "phone_number", "phone_number": "(62) 90000-0000"},
        "DATA DA VENDA": data("2026-09-01"), "VALOR DE VENDA": num(228900), "VALOR DO CRÉDITO": num(200000),
        "SUBISÍDIO": num(None), "VALOR DO FGTS": num(10000), " COMISSÃO ": num(10000),
        "CORRETOR": txt("Corretor Exemplo"), "IMOBILIÁRIA": txt("Imobiliária Exemplo"),
        "CONTRATO ASSINADO": {"type": "files", "files": [{"name": "assinado.pdf", "file": {"url": "https://s3.falso/assinado"}}]},
    })
    p.update(mudar)
    return p


class NotionLinha(NotionFake):
    """Notion com UMA página: a linha do condomínio (parent = DB_COND)."""
    def __init__(self, props, mae=DB_COND):
        super().__init__(props)
        self.mae = mae
        self.lidas = []

    def pagina(self, pid):
        self.lidas.append(pid)
        return {"properties": self.props, "parent": {"database_id": self.mae}}

    def baixar(self, url):
        return b"%PDF-1.4 assinado"


class ErpLinha(ErpCond):
    def anexar(self, venda_id, nome, conteudo):
        self.criados.append(("anexo", nome))


def test_linha_do_condominio_e_reconhecida_pela_base_ou_pelo_titulo():
    pg = {"properties": linha_cond(), "parent": {"database_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}}
    assert C.e_linha_do_condominio(pg, DB_COND)
    assert not C.e_linha_do_condominio(pg, "f" * 32)
    assert C.e_linha_do_condominio(pg, "")   # sem DB_VENDAS_COND: o título UNIDADE decide
    assert not C.e_linha_do_condominio({"properties": dados_venda()}, "")


def test_dados_da_linha_comprador_valores_corretor_e_colunas_de_retorno():
    d = C.dados_da_linha(linha_cond(**{"MC - SITUAÇÃO": txt("PRÉVIA OK [#0a1b2c3d] — x"), "MC - VENDA ID": txt("")}), LINHA_ID)
    assert d["endereco"] == "CONDOMÍNIO RESERVA TESTE" and d["casa"] == 12
    assert d["comprador"] == {"nome": "Fulana De Teste", "cpf": "52998224725", "email": "fulana@exemplo.test", "telefone": "62900000000"}
    assert (d["total"], d["aquisicao"], d["comissao_paga_por"]) == (228900, 228900, "VENDEDOR")
    assert (d["financiado"], d["fgts"], d["subsidio"]) == (200000, 10000, None)
    assert (d["corretor"], d["imobiliaria"], d["data_venda"]) == ("Corretor Exemplo", "Imobiliária Exemplo", "2026-10-10")   # 31/10: = assinatura
    assert d["condominio_id"] == LINHA_ID and d["situacao_atual"].startswith("PRÉVIA OK")
    assert d["contrato_arquivos"] == [{"nome": "assinado.pdf", "url": "https://s3.falso/assinado"}]
    assert C.dados_da_linha(linha_cond(**{"CONDOMÍNIO": sel("Condomínio Reserva Teste")}), LINHA_ID)["endereco"] == "Condomínio Reserva Teste"


def test_previa_e_lancamento_pela_linha_do_condominio(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n, e = NotionLinha(linha_cond()), ErpLinha()
    r = L.processar(LINHA_ID, n, e)
    assert r["situacao"] == "PREVIA", r
    assert n.lidas == [LINHA_ID], "a linha é lida uma vez (não procura CONDOMÍNIO - VENDA ID)"
    corpo = r["corpo_venda"]
    assert corpo["description"].startswith("VENDA UNIDADE 12 - FULANA DE TESTE")
    assert len(corpo["tradeReceivable"]["installments"]) == 12
    assert n.gravado["MC - SITUAÇÃO"].startswith("PRÉVIA OK [#")
    assin = R.assinatura_da_situacao(n.gravado["MC - SITUAÇÃO"])
    n.props["MC - SITUAÇÃO"] = txt("PROCESSANDO (lançamento) — 07/10 10:00 [t=1] [#%s]" % assin)
    r = L.processar(LINHA_ID, n, e, aplicar=True)
    assert r["situacao"] == "CRIADA", r
    assert n.gravado["MC - VENDA ID"] == "venda-nova"
    assert ("anexo", "CONTRATO CONDOMÍNIO RESERVA TESTE CASA 12 - FULANA DE TESTE.pdf") in e.criados
    assert [t for t, _ in e.criados] == ["cliente", "cliente", "venda", "anexo"]


def test_linha_do_condominio_ja_lancada_nao_repete(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n, e = NotionLinha(linha_cond()), ErpLinha()
    n.props["MC - VENDA ID"] = txt("venda-9")   # o NotionFake zera as duas colunas ao nascer
    r = L.processar(LINHA_ID, n, e, aplicar=True)
    assert r["situacao"] == "JA_LANCADA" and e.criados == []


def test_linha_do_condominio_com_faltas_recusa_sem_falar_com_o_erp(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n = NotionLinha(linha_cond(**{"CPF PROPONENTE": txt("529.982.247-24"), "DIA PAGAMENTO PARCELAS": num(None)}))
    r = L.processar(LINHA_ID, n, ErpLinha())
    assert r["codigo"] == "FALTAS"
    assert "CPF do comprador" in n.gravado["MC - SITUAÇÃO"] and "DIA PAGAMENTO" in n.gravado["MC - SITUAÇÃO"]


def test_caminho_antigo_continua_casa_da_vendas_com_condominio_venda_id(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", "b" * 32)
    n = NotionDuas(dados_venda(), fluxo_props())
    r = L.processar("p", n, ErpCond(), aplicar=False)
    assert r["situacao"] == "PREVIA", r
    assert r["corpo_venda"]["description"].startswith("VENDA UNIDADE 12 - ")


# 30/10/2026 (dono): o endereço do cliente no Mais Controle é a unidade que ele está comprando
def test_endereco_do_cliente_e_a_unidade_comprada():
    e = C.endereco_do_cliente("RESERVA DOS IPÊS", 7)
    assert e["address"] == "CONDOMÍNIO RESERVA DOS IPÊS" and e["neighborhood"] == "CONDOMÍNIO RESERVA DOS IPÊS"
    assert e["complement"] == "UNIDADE 07" and e["addressNumber"] == "S/N"
    assert e["zipCode"] == "75250000"   # só dígitos, como o ERP guarda
    assert e["city"]["name"] == "Senador Canedo" and e["city"]["state"]["abbreviation"] == "GO"
    outro = C.endereco_do_cliente("Condomínio Reserva Teste", 31)   # sem cidade conhecida: sem CEP nem cidade
    assert outro["complement"] == "UNIDADE 31" and "zipCode" not in outro and "city" not in outro
    assert C.endereco_do_cliente("", 31) == {} and C.endereco_do_cliente("RESERVA DOS IPÊS", None) == {}


def test_corpo_cliente_do_condominio_leva_o_endereco_da_unidade():
    d = C.dados_da_linha(linha_cond(), LINHA_ID)
    corpo = R.corpo_cliente(d)
    assert corpo["address"]["address"] == "CONDOMÍNIO RESERVA TESTE"
    assert corpo["address"]["complement"].startswith("UNIDADE ")
    rua = R.corpo_cliente(R.dados_da_pagina(pagina()))
    assert "address" not in rua             # casa de rua: como antes


# 30/10/2026: VALOR PARA ENTRADA da proposta acima do sinal = "pagamento único na assinatura" (ContratoVenda.excedenteSinal)
PROPOSTA_ID = "f" * 32


class NotionComProposta(NotionLinha):
    """A linha do condomínio e a proposta (ID PROPOSTA) com o VALOR PARA ENTRADA."""
    def __init__(self, props, valor_para_entrada, legivel=True):
        super().__init__(props)
        self.proposta = {"VALOR PARA ENTRADA": num(valor_para_entrada)}
        self.legivel = legivel

    def pagina(self, pid):
        if pid == PROPOSTA_ID:
            self.lidas.append(pid)
            if not self.legivel:
                raise RuntimeError("Notion GET página -> HTTP 404")
            return {"properties": self.proposta}
        return super().pagina(pid)


def linha_com_entrada(**mudar):
    """Sinal de 10 mil no ato e 50 mil para a entrada na proposta: 40 mil à vista na assinatura (228.900 + 3.000 + 40.000)."""
    base = {"VALOR SINAL ATO": num(10000), "VALOR SINAL 30 DIAS": num(None), "VALOR DE VENDA": num(271900),
            "ID PROPOSTA": txt("ffffffff-ffff-ffff-ffff-" + "f" * 12)}
    base.update(mudar)
    return linha_cond(**base)


def test_excedente_do_valor_para_entrada_passa_do_sinal_e_nao_conta_no_fluxo_alterado():
    fx = C.fluxo(linha_com_entrada())
    assert fx["id_proposta"] == PROPOSTA_ID
    assert C.excedente_sinal(fx, 50000) == 40000
    assert C.excedente_sinal(fx, 9000) == 0 and C.excedente_sinal(fx, None) == 0
    fx["livre"] = {"valor": 1, "entrega": "", "linhas": []}
    assert C.excedente_sinal(fx, 50000) == 0, "no fluxo alterado o excedente já é linha da lista"


def test_parcelas_com_excedente_tem_entrada_a_vista_na_assinatura():
    fx = C.fluxo(linha_com_entrada())
    fx["excedente"] = 40000
    ps = C.parcelas(fx, {"data_venda": "2026-09-01", "fgts": 10000, "financiado": 200000})
    assert [p["rotulo"] for p in ps][:2] == ["Sinal ato", "Entrada à vista"]
    ent = ps[1]
    assert (ent["tipo"], ent["valor"], ent["data"], ent["tabela"]) == (R.TIPO_ENTRADA, 40000, "2026-10-10", None)
    assert round(sum(p["valor"] for p in ps), 2) == 271900


def test_venda_com_entrada_de_50_mil_sem_fluxo_alterado_fecha_a_soma(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n = NotionComProposta(linha_com_entrada(), 50000)
    r = L.processar(LINHA_ID, n, ErpLinha())
    assert r["situacao"] == "PREVIA", r
    assert n.lidas == [LINHA_ID, PROPOSTA_ID]
    inst = r["corpo_venda"]["tradeReceivable"]["installments"]
    ent = [i for i in inst if i["comment"] == "Entrada à vista"]
    assert len(ent) == 1 and ent[0]["plannedValue"] == 40000 and ent[0]["plannedDate"].startswith("2026-10-10")
    assert ent[0]["readjustmentDetail"]["table"] is None
    assert round(sum(i["plannedValue"] for i in inst), 2) == 271900
    assert "Soma das parcelas" not in n.gravado["MC - SITUAÇÃO"]


def test_fluxo_alterado_nao_soma_o_excedente_de_novo(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    lista = {"valor": 271900, "entrega": "2028-12-15", "linhas": [
        {"t": "sinal", "v": 10000, "n": 1, "d": "2026-10-10", "i": 1, "x": ""},
        {"t": "entrada", "v": 40000, "n": 1, "d": "2026-10-10", "i": 1, "x": ""},
        {"t": "pre", "v": 1000, "n": 2, "d": "2026-11-30", "i": 1, "x": ""},
        {"t": "pre", "v": 500, "n": 1, "d": "2027-01-31", "i": 1, "x": ""},
        {"t": "balao", "v": 3000, "n": 1, "d": "2027-12-31", "i": 1, "x": ""},
        {"t": "balao", "v": 4000, "n": 1, "d": "2028-11-30", "i": 1, "x": ""},
        {"t": "pos", "v": 800, "n": 3, "d": "2029-01-31", "i": 1, "x": ""},
        {"t": "fin", "v": 200000, "n": 1, "d": "", "i": 1, "x": ""},
        {"t": "fgts", "v": 10000, "n": 1, "d": "", "i": 1, "x": ""}]}
    n = NotionComProposta(linha_com_entrada(**{"FLUXO PERSONALIZADO": txt(json.dumps(lista))}), 50000)
    r = L.processar(LINHA_ID, n, ErpLinha())
    assert r["situacao"] == "PREVIA", r
    assert PROPOSTA_ID not in n.lidas, "com a lista a proposta nem é lida"
    inst = r["corpo_venda"]["tradeReceivable"]["installments"]
    assert [i["plannedValue"] for i in inst if i["comment"] == "Entrada à vista"] == [40000]


def test_proposta_ilegivel_fica_sem_excedente_e_a_soma_recusa(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n = NotionComProposta(linha_com_entrada(), 50000, legivel=False)
    r = L.processar(LINHA_ID, n, ErpLinha())
    assert r["codigo"] == "FALTAS" and "Soma das parcelas" in n.gravado["MC - SITUAÇÃO"]


def test_isencao_da_comissao_zera_a_comissao_e_a_observacao_diz_venda_direta():
    """30/10: desconto "isentar a comissão" no Alterar fluxo grava semComissao; o robô não cobra comissão nenhuma."""
    linhas = [dict(l) for l in LIVRE]
    linhas[4]["v"] = 500                                     # permuta 500 menor: casa de 228.400
    fx = C.fluxo(fluxo_props(**{"PRAZO ENTRADA": num(24)}, **_livre(linhas, valor=228400, semComissao=True)))
    assert fx["livre"]["semComissao"] is True
    d = {"total": 228900, "aquisicao": 228900, "comissao": 11445}
    C.ajustar_dados_livre(fx, d)
    assert (d["total"], d["aquisicao"], d["comissao"], d["sem_comissao"]) == (228400, 228400, 0, True)
    assert "Sem comissão (venda direta)" in R.observacao({**d, "corretor": ""})
    assert "Comissão:" not in R.observacao(d)
    sem = C.fluxo(fluxo_props(**_livre(LIVRE, semComissao="sim")))
    assert "semComissao" not in sem["livre"], "só true vale (igual ao FluxoLivre.ler)"


def test_previa_da_venda_direta_fecha_com_o_valor_novo_e_sem_comissao(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    linhas = [dict(l) for l in LIVRE]
    linhas[4]["v"] = 500
    n, e = NotionLinha(linha_cond(**_livre(linhas, valor=228400, semComissao=True))), ErpLinha()
    r = L.processar(LINHA_ID, n, e)
    assert r["situacao"] == "PREVIA", r
    inst = r["corpo_venda"]["tradeReceivable"]["installments"]
    assert round(sum(i["plannedValue"] for i in inst), 2) == 228400
    assert "Comissão:" not in json.dumps(r["corpo_venda"], ensure_ascii=False)


def test_data_da_venda_do_condominio_e_a_data_de_assinatura():
    """31/10/2026 (dono): DATA DA VENDA = DATA DE ASSINATURA DO CONTRATO; a coluna só vale sem assinatura."""
    assert C.dados_da_linha(linha_cond(), LINHA_ID)["data_venda"] == "2026-10-10"
    assert C.dados_da_linha(linha_cond(**{"DATA DA VENDA": data(None)}), LINHA_ID)["data_venda"] == "2026-10-10"
    sem = linha_cond(**{"DATA DE ASSINATURA DO CONTRATO": data(None)})
    assert C.dados_da_linha(sem, LINHA_ID)["data_venda"] == "2026-09-01"
