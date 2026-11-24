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


def test_observacao_parcelas_iguais():
    ps = [{"valor": 8750.0, "data": "2026-11-24"}, {"valor": 8750.0, "data": "2026-12-24"}]
    assert K.observacao("CNPJ: 00000000000191", " corretor  teste", 17500.0, ps) == \
        "PIX CNPJ: 00000000000191. Corretor CORRETOR TESTE. Comissão total R$ 17.500,00 em 2 x R$ 8.750,00."

def test_observacao_parcelas_diferentes():
    ps = [{"valor": 10000.0, "data": "2026-11-24"}, {"valor": 7500.0, "data": "2026-12-24"}]
    assert K.observacao("CPF: 11144477735", "CORRETOR TESTE", 17500.0, ps) == \
        "PIX CPF: 11144477735. Corretor CORRETOR TESTE. Comissão total R$ 17.500,00 em R$ 10.000,00 + R$ 7.500,00."

def test_condicao_que_nao_bate_com_parcelas():
    ps2 = [{"valor": 1.0, "data": HOJE}, {"valor": 1.0, "data": "2026-12-24"}]
    ps1 = ps2[:1]
    args = ("D", "O", "p", "c", "f", {"id": "c-1"}, {"id": "w-1"})
    with pytest.raises(ValueError):
        K.corpo_titulo(ps2, *args[:5], args[5], args[6], {"id": "x", "type": "IN_CASH"}, "", HOJE)
    with pytest.raises(ValueError):
        K.corpo_titulo(ps1, *args[:5], args[5], args[6], {"id": "x", "type": "FINANCING"}, "", HOJE)

def test_descricao_corta_em_150():
    d = K.descricao(4, "X" * 400)
    assert len(d) == 150 and d.startswith("COMISSÃO CORRETOR UNIDADE 04 - X")

def test_fronteiras_de_data():
    assert K.ler_parcelas("10@2026-10-25", HOJE)[0]["data"] == "2026-10-25"   # hoje-30
    assert K.ler_parcelas("10@2027-12-29", HOJE)[0]["data"] == "2027-12-29"   # hoje+400
    for t in ("10@2026-10-24", "10@2027-12-30"):                               # -31 e +401
        with pytest.raises(K.Recusa) as e:
            K.ler_parcelas(t, HOJE)
        assert e.value.codigo == "PARCELAS_INVALIDAS"

def test_um_centavo_acima_do_saldo():
    with pytest.raises(K.Recusa) as e:
        K.conferir_saldo([{"valor": 8750.01, "data": HOJE}], 17500.0, 8750.0)
    assert e.value.codigo == "ACIMA_DO_SALDO"

def test_ja_lancado_negativo():
    with pytest.raises(K.Recusa) as e:
        K.conferir_saldo([{"valor": 10.0, "data": HOJE}], 17500.0, -5.0)
    assert e.value.codigo == "JA_LANCADO_INVALIDO"


# ----------------------------------------------------------------- Tarefa 3: processar (ERP e Notion de mentira)
import copy  # noqa: E402
import json  # noqa: E402
from venda.mc.erp import ErpErro  # noqa: E402

DB = "c" * 32
PAGE = "p" * 32

def txt(s): return {"type": "rich_text", "rich_text": [{"plain_text": s}] if s else []}
def num(v): return {"type": "number", "number": v}
def titulo(s): return {"type": "title", "title": [{"plain_text": s}]}

def pagina(estado="", comissao=10000.0):
    return {"id": PAGE, "parent": {"database_id": DB}, "properties": {
        "UNIDADE": titulo("7"), "COMISSÃO": num(comissao), "CORRETOR": txt("CORRETOR TESTE"),
        "CPF CORRETOR": txt("111.444.777-35"), "EMAIL CORRETOR": txt("corretor@teste.example"),
        "MC - VENDA ID": txt("v-1"), "MC - COMISSÃO": txt(estado)}}

class NotionFake:
    def __init__(self, pg, corretores=None):
        self.pg, self.gravado, self.corretores = copy.deepcopy(pg), [], corretores or []
    def pagina(self, _): return copy.deepcopy(self.pg)
    def gravar_textos(self, _pid, _props, valores):
        self.gravado.append(valores)
        for k, v in valores.items(): self.pg["properties"][k] = txt(v)
        return []
    def linhas(self, _db): return self.corretores

class ErpFake:
    user_id = "u-1"
    def __init__(self, fornecedores=None, ja=None, post_sem_id=False, post_erro=None, anexo_erro=False):
        self.posts, self.anexos = [], []
        self.fornecedores = fornecedores if fornecedores is not None else [
            {"id": "f-1", "name": "CORRETOR TESTE", "status": "ACTIVE", "bankAccount": "PIX: 11144477735"}]
        self.ja, self.post_sem_id, self.post_erro, self.anexo_erro = ja or [], post_sem_id, post_erro, anexo_erro
        self.consultas_dia = []
    def ler_venda(self, _): return {"id": "v-1", "customer": {"name": "COMPRADOR TESTE"},
                                    "work": {"id": "w-1", "name": "OBRA TESTE", "status": "IN_PROGRESS"}}
    def obra(self, _): return {"defaultAccount": {"id": "c-1", "name": "CONTA TESTE"}}
    def participantes_por_documento(self, _): return [self.fornecedores[0]] if self.fornecedores else []
    def condicao_por_tipo(self, t): return {"id": "cond-" + t, "type": t}
    def anexar_titulo(self, tp, nome, conteudo):
        assert conteudo.startswith(b"%PDF")
        if self.anexo_erro:
            raise ErpErro("S3 fora")
        self.anexos.append(nome); return 200
    def pedir_core(self, metodo, caminho, corpo=None, params=None):
        # Ajuste ao brief: o passo 9 relê os anexos pelo CORE (GET /attachments/v2); o fake do brief não tinha pedir_core
        assert metodo == "GET" and caminho.startswith("/attachments/v2"), (metodo, caminho)
        return [{"name": n} for n in self.anexos]
    def pedir(self, metodo, caminho, corpo=None, params=None):
        if caminho.startswith("/participants"): return self.fornecedores
        if caminho == "/categories/all": return [{"id": "cat-1", "name": "Comissão Venda de Casa"}]
        if caminho == "/payment-methods/all": return [{"id": "pix-1", "name": "Pix"}]
        if caminho.startswith("/payable-installments/paginated-result"):
            self.consultas_dia.append((params or {}).get("startDate"))
            return {"content": self.ja}
        if metodo == "POST" and caminho == "/trade-payables":
            self.posts.append(corpo)
            if self.post_erro:
                raise self.post_erro
            return {} if self.post_sem_id else {"id": "tp-1"}
        if caminho == "/trade-payables/tp-1":
            c = self.posts[-1]
            return {"value": c["value"], "participant": c["participant"],
                    "installments": [{"plannedDate": i["plannedDate"], "plannedValue": i["plannedValue"]} for i in c["installments"]]}
        raise AssertionError((metodo, caminho))

def coluna(n):
    rt = n.pg["properties"]["MC - COMISSÃO"]["rich_text"]
    return rt[0]["plain_text"] if rt else ""

@pytest.fixture(autouse=True)
def _amb(monkeypatch):
    monkeypatch.setenv("DB_VENDAS_COND", DB)

def test_previa_e_lancar_parcelado():
    n, e = NotionFake(pagina()), ErpFake()
    r = K.processar(PAGE, n, e, "5000.00@2026-11-24;5000.00@2026-12-24", hoje=HOJE)
    assert r["situacao"] == "PREVIA" and e.posts == []
    assert n.gravado[-1]["MC - COMISSÃO"].startswith("PRÉVIA OK [#")
    r = K.processar(PAGE, n, e, "5000.00@2026-11-24;5000.00@2026-12-24", aplicar=True, hoje=HOJE)
    assert r["situacao"] == "LANCADA" and len(e.posts) == 1
    assert e.anexos == ["5000,00 - COMISSAO UNIDADE 07 PARCELA 1-2 - 24-11-2026.pdf",
                        "5000,00 - COMISSAO UNIDADE 07 PARCELA 2-2 - 24-12-2026.pdf"]
    assert "LANÇADA | título tp-1 | R$ 10.000,00" in n.pg["properties"]["MC - COMISSÃO"]["rich_text"][0]["plain_text"]

def test_aplicar_sem_previa_ou_previa_vencida():
    n, e = NotionFake(pagina()), ErpFake()
    assert K.processar(PAGE, n, e, "5000.00@2026-11-24", aplicar=True, hoje=HOJE)["codigo"] == "PREVIA_DESATUALIZADA"
    K.processar(PAGE, n, e, "5000.00@2026-11-24", hoje=HOJE)
    assert K.processar(PAGE, n, e, "6000.00@2026-11-24", aplicar=True, hoje=HOJE)["codigo"] == "PREVIA_DESATUALIZADA"
    assert e.posts == []

def test_saldo_conta_o_que_ja_foi_lancado_na_coluna():
    n = NotionFake(pagina("PRÉVIA OK [#00000000]\nLANÇADA | título tp-0 | R$ 8.000,00 | 1 parcela(s) | recibos: 1/1 | 24/11 10:00"))
    r = K.processar(PAGE, n, ErpFake(), "3000.00@2026-12-24", hoje=HOJE)
    assert r["codigo"] == "ACIMA_DO_SALDO"

def test_titulo_no_erp_que_a_coluna_nao_conhece():
    ja = [{"description": "COMISSÃO CORRETOR UNIDADE 07 - COMPRADOR TESTE", "paidTo": "X"}]
    r = K.processar(PAGE, NotionFake(pagina()), ErpFake(ja=ja), "1000.00@2026-11-24", hoje=HOJE)
    assert r["codigo"] == "TITULO_FORA_DA_COLUNA"

def test_dois_candidatos_obrigam_escolher_e_so_aceitam_os_da_previa():
    forn = [{"id": "f-1", "name": "CORRETOR TESTE", "status": "ACTIVE", "bankAccount": ""},
            {"id": "f-2", "name": "IMOBILIARIA TESTE", "status": "ACTIVE", "bankAccount": "PIX: 00000000000191"}]
    n, e = NotionFake(pagina()), ErpFake(fornecedores=forn)
    assert K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)["codigo"] == "ESCOLHER_FAVORECIDO"
    assert K.processar(PAGE, n, e, "1000.00@2026-11-24", favorecido_id="f-9", hoje=HOJE)["codigo"] == "FAVORECIDO_INVALIDO"
    assert K.processar(PAGE, n, e, "1000.00@2026-11-24", favorecido_id="f-1", hoje=HOJE)["codigo"] == "SEM_PIX"
    assert K.processar(PAGE, n, e, "1000.00@2026-11-24", favorecido_id="f-2", hoje=HOJE)["situacao"] == "PREVIA"

def test_post_sem_id_nao_repete_e_manda_conferir():
    n, e = NotionFake(pagina()), ErpFake(post_sem_id=True)
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["codigo"] == "INCERTO" and len(e.posts) == 1 and e.anexos == []

def test_recusas_de_entrada():
    assert K.processar(PAGE, NotionFake(pagina(comissao=None)), ErpFake(), "1@2026-11-24", hoje=HOJE)["codigo"] == "SEM_COMISSAO"
    pg = pagina(); pg["parent"]["database_id"] = "e" * 32
    assert K.processar(PAGE, NotionFake(pg), ErpFake(), "1@2026-11-24", hoje=HOJE)["codigo"] == "SO_CONDOMINIO"
    pg = pagina(); pg["properties"]["MC - VENDA ID"] = txt("")
    assert K.processar(PAGE, NotionFake(pg), ErpFake(), "1@2026-11-24", hoje=HOJE)["codigo"] == "SEM_VENDA_ID"


# ----------------------------------------------------------------- além do brief (foco de revisão)

def test_isencao_no_fluxo_personalizado_recusa_sem_comissao():
    # o semComissao mora no JSON da coluna FLUXO PERSONALIZADO (condominio.ler_livre), não na raiz do fluxo()
    pg = pagina()
    pg["properties"]["FLUXO PERSONALIZADO"] = txt(json.dumps({"valor": 1, "linhas": [], "semComissao": True}))
    e = ErpFake()
    assert K.processar(PAGE, NotionFake(pg), e, "1000.00@2026-11-24", hoje=HOJE)["codigo"] == "SEM_COMISSAO"
    assert e.posts == []

def test_aplicar_repetido_depois_de_lancado_nao_cria_outro():
    n, e = NotionFake(pagina()), ErpFake()
    K.processar(PAGE, n, e, "5000.00@2026-11-24", hoje=HOJE)
    assert K.processar(PAGE, n, e, "5000.00@2026-11-24", aplicar=True, hoje=HOJE)["situacao"] == "LANCADA"
    r = K.processar(PAGE, n, e, "5000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["codigo"] == "PREVIA_DESATUALIZADA" and len(e.posts) == 1

def test_titulo_do_erp_que_a_coluna_conhece_nao_recusa():
    ja = [{"description": "COMISSÃO CORRETOR UNIDADE 07 - COMPRADOR TESTE", "tradePayableId": "tp-0"}]
    n = NotionFake(pagina("LANÇADA | título tp-0 | R$ 4.000,00 | 1 parcela(s) | recibos: 1/1 | 24/11 10:00"))
    r = K.processar(PAGE, n, ErpFake(ja=ja), "6000.00@2026-11-24", hoje=HOJE)
    assert r["situacao"] == "PREVIA", r
    assert "R$ 6.000,00 de R$ 10.000,00" in coluna(n)
    # unidade 070 não é a 07
    ja2 = [{"description": "COMISSÃO CORRETOR UNIDADE 070 - OUTRO", "tradePayableId": "tp-x"}]
    assert K.processar(PAGE, NotionFake(pagina()), ErpFake(ja=ja2), "100.00@2026-11-24", hoje=HOJE)["situacao"] == "PREVIA"

def test_consulta_do_erp_uma_por_dia_pedido():
    e = ErpFake()
    K.processar(PAGE, NotionFake(pagina()), e, "1000.00@2026-11-24;1000.00@2026-12-24;1000.00@2026-12-24", hoje=HOJE)
    assert sorted(e.consultas_dia) == ["2026-11-24", "2026-12-24"]

def test_historico_lancada_nunca_e_apagado():
    antigo = "LANÇADA | título tp-0 | R$ 1.000,00 | 1 parcela(s) | recibos: 1/1 | 20/11 10:00"
    n, e = NotionFake(pagina("PRÉVIA OK [#00000000]\n" + antigo)), ErpFake()
    K.processar(PAGE, n, e, "5000.00@2026-11-24", hoje=HOJE)
    assert coluna(n).startswith("PRÉVIA OK [#") and antigo in coluna(n) and "[#00000000]" not in coluna(n)
    K.processar(PAGE, n, e, "5000.00@2026-11-24", aplicar=True, hoje=HOJE)
    linhas = coluna(n).split("\n")
    assert linhas[0] == antigo and linhas[1].startswith("LANÇADA | título tp-1 | R$ 5.000,00 | 1 parcela(s) | recibos: 1/1")
    assert "PRÉVIA" not in coluna(n)
    K.processar(PAGE, n, e, "1@2020-01-01", hoje=HOJE)   # recusa também guarda o histórico
    assert coluna(n).startswith("RECUSADO") and antigo in coluna(n) and "título tp-1" in coluna(n)

def test_previa_mostra_favorecido_pix_e_parcelas():
    n = NotionFake(pagina())
    K.processar(PAGE, n, ErpFake(), "5000.00@2026-11-24;5000.00@2026-12-24", hoje=HOJE)
    t = coluna(n)
    assert "Favorecido: CORRETOR TESTE" in t and "Pix: CPF: 11144477735" in t
    assert "Parcelas: 1/2 R$ 5.000,00 em 24/11/2026; 2/2 R$ 5.000,00 em 24/12/2026" in t
    assert "Conta: CONTA TESTE" in t

def test_bloqueado_prefixa_e_nao_grava():
    n, e = NotionFake(pagina()), ErpFake()
    r = K.processar(PAGE, n, e, "5000.00@2026-11-24", bloqueado=True, hoje=HOJE)
    assert r["codigo"] == "BLOQUEADO" and coluna(n).startswith("BLOQUEADO: gravar está desligado neste ambiente — PRÉVIA OK [#")
    assert e.posts == []

def test_corpo_lancado_tem_o_que_a_spec_pede():
    n, e = NotionFake(pagina()), ErpFake()
    K.processar(PAGE, n, e, "5000.00@2026-11-24;5000.00@2026-12-24", hoje=HOJE)
    K.processar(PAGE, n, e, "5000.00@2026-11-24;5000.00@2026-12-24", aplicar=True, hoje=HOJE)
    c = e.posts[0]
    assert c["description"] == "COMISSÃO CORRETOR UNIDADE 07 - COMPRADOR TESTE"
    assert c["paymentCondition"]["id"] == "cond-FINANCING" and c["category"] == {"id": "cat-1"}
    assert c["paymentMethod"] == {"id": "pix-1"} and c["account"]["id"] == "c-1" and c["participant"] == {"id": "f-1"}
    assert c["markedAsPaid"] is False and all(i["markedAsPaid"] is False for i in c["installments"])
    assert c["comment"] == "PIX CPF: 11144477735. Corretor CORRETOR TESTE. Comissão total R$ 10.000,00 em 2 x R$ 5.000,00."

def test_a_vista_usa_condicao_in_cash():
    n, e = NotionFake(pagina()), ErpFake()
    K.processar(PAGE, n, e, "5000.00@2026-11-24", hoje=HOJE)
    K.processar(PAGE, n, e, "5000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert e.posts[0]["paymentCondition"]["id"] == "cond-IN_CASH"
    assert e.anexos == ["5000,00 - COMISSAO UNIDADE 07 - 24-11-2026.pdf"]

def test_condicao_errada_vira_catalogo_faltando():
    class E2(ErpFake):
        def condicao_por_tipo(self, t): return {"id": "x", "type": "IN_CASH"}   # instalação que devolve a errada
    r = K.processar(PAGE, NotionFake(pagina()), E2(), "1.00@2026-11-24;1.00@2026-12-24", hoje=HOJE)
    assert r["codigo"] == "CATALOGO_FALTANDO"
    class E3(ErpFake):
        def condicao_por_tipo(self, t): return None
    assert K.processar(PAGE, NotionFake(pagina()), E3(), "1.00@2026-11-24", hoje=HOJE)["codigo"] == "CATALOGO_FALTANDO"
    class E4(ErpFake):
        def pedir(self, metodo, caminho, corpo=None, params=None):
            if caminho == "/categories/all": return [{"id": "z", "name": "Outra"}]
            return super().pedir(metodo, caminho, corpo, params)
    assert K.processar(PAGE, NotionFake(pagina()), E4(), "1.00@2026-11-24", hoje=HOJE)["codigo"] == "CATALOGO_FALTANDO"

def test_post_que_cai_por_rede_e_incerto_e_recusa_4xx_e_erro():
    for exc, cod in ((TimeoutError("sem resposta"), "INCERTO"),
                     (ErpErro("POST /trade-payables -> HTTP 500: x"), "INCERTO"),
                     (ErpErro("POST /trade-payables -> HTTP 400: campo"), "ERP_RECUSOU")):
        n, e = NotionFake(pagina()), ErpFake(post_erro=exc)
        K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
        r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
        assert r["codigo"] == cod and len(e.posts) == 1 and e.anexos == []
        assert "CONFIRA" in coluna(n)

def test_anexo_que_falha_nao_apaga_o_lancamento():
    n, e = NotionFake(pagina()), ErpFake(anexo_erro=True)
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["situacao"] == "LANCADA" and len(e.posts) == 1
    assert "LANÇADA | título tp-1 | R$ 1.000,00 | 1 parcela(s) | recibos: 0/1" in coluna(n)

def test_releitura_que_nao_bate_avisa():
    class E2(ErpFake):
        def pedir(self, metodo, caminho, corpo=None, params=None):
            if caminho == "/trade-payables/tp-1":
                return {"value": 1.0, "participant": {"id": "f-1"}, "installments": []}
            return super().pedir(metodo, caminho, corpo, params)
    n, e = NotionFake(pagina()), E2()
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["situacao"] == "LANCADA" and "releitura NÃO bateu: confira no Mais Controle" in coluna(n)

def test_nenhuma_excecao_escapa():
    class Quebrado(ErpFake):
        def ler_venda(self, _): raise RuntimeError("rede caiu")
    n = NotionFake(pagina())
    r = K.processar(PAGE, n, Quebrado(), "1000.00@2026-11-24", hoje=HOJE)
    assert r["situacao"] == "ERRO" and coluna(n).startswith("ERRO")
    class NotionQuebrado(NotionFake):
        def gravar_textos(self, *a): raise RuntimeError("notion fora")
    r = K.processar(PAGE, NotionQuebrado(pagina()), ErpFake(), "1000.00@2026-11-24", hoje=HOJE)
    assert r["situacao"] == "PREVIA" and "NOTION_NAO_ANOTADO" in r["avisos"]
    class NotionSemPagina(NotionFake):
        def pagina(self, _): raise RuntimeError("notion fora")
    r = K.processar(PAGE, NotionSemPagina(pagina()), ErpFake(), "1000.00@2026-11-24", hoje=HOJE)
    assert r["situacao"] == "ERRO"

def test_sem_favorecido_e_inativo():
    assert K.processar(PAGE, NotionFake(pagina()), ErpFake(fornecedores=[]), "1.00@2026-11-24", hoje=HOJE)["codigo"] == "SEM_FAVORECIDO"
    forn = [{"id": "f-1", "name": "CORRETOR TESTE", "status": "INACTIVE", "bankAccount": "PIX: 11144477735"}]
    assert K.processar(PAGE, NotionFake(pagina()), ErpFake(fornecedores=forn), "1.00@2026-11-24", hoje=HOJE)["codigo"] == "SEM_FAVORECIDO"

def test_pix_pelo_cadastro_de_corretores_so_para_o_documento_do_corretor():
    cad = [{"properties": {"Nome": titulo("CORRETOR TESTE"), "CPF/CNPJ": txt("111.444.777-35"),
                           "CHAVE PIX": txt("corretor@teste.example")}}]
    forn = [{"id": "f-1", "name": "CORRETOR TESTE", "status": "ACTIVE", "cpf": "11144477735", "bankAccount": ""}]
    n = NotionFake(pagina(), corretores=cad)
    assert K.processar(PAGE, n, ErpFake(fornecedores=forn), "1.00@2026-11-24", hoje=HOJE)["situacao"] == "PREVIA"
    assert "Pix: E-MAIL: corretor@teste.example" in coluna(n)
    forn2 = [{"id": "f-2", "name": "IMOBILIARIA TESTE", "status": "ACTIVE", "cnpj": "00000000000191", "bankAccount": ""}]
    n = NotionFake(pagina(), corretores=cad)
    assert K.processar(PAGE, n, ErpFake(fornecedores=forn2), "1.00@2026-11-24", hoje=HOJE)["codigo"] == "SEM_PIX"

def test_email_de_outro_cadastro_nao_vira_candidato():
    forn = [{"id": "f-1", "name": "CORRETOR TESTE", "status": "ACTIVE", "bankAccount": "PIX: 11144477735"},
            {"id": "f-3", "name": "OUTRO TESTE", "status": "ACTIVE", "email": "outro@teste.example",
             "bankAccount": "PIX: 00000000000191"}]
    n = NotionFake(pagina())
    assert K.processar(PAGE, n, ErpFake(fornecedores=forn), "1.00@2026-11-24", hoje=HOJE)["situacao"] == "PREVIA"
    assert "Candidatos" not in coluna(n)

@pytest.mark.parametrize("entrada,saida", [
    ("PIX: 11144477735", "CPF: 11144477735"), ("PIX: 00.000.000/0001-91", "CNPJ: 00.000.000/0001-91"),
    ("PIX: a@b.example", "E-MAIL: a@b.example"), ("PIX: +5562999990000", "TELEFONE: +5562999990000"),
    ("PIX: 62999990000", "TELEFONE: 62999990000"), ("PIX: 6299999000", "TELEFONE: 6299999000"),
    ("PIX: 123e4567-e89b-12d3-a456-426614174000", "ALEATÓRIA: 123e4567-e89b-12d3-a456-426614174000"),
    ("pix cnpj: 00000000000191", "CNPJ: 00000000000191"), ("BANCO 1 AG 2", None), ("PIX:", None), ("", None)])
def test_pix_do_cadastro(entrada, saida):
    assert K.pix_do_banco(entrada) == saida

def test_assinatura_cobre_o_pix():
    base = {"parcelas": [{"valor": 1.0, "data": HOJE}], "favorecido_id": "a", "comissao": 10.0, "ja_lancado": 0.0,
            "pix": "CPF: 11144477735"}
    assert K.assinatura(base) != K.assinatura(dict(base, pix="CNPJ: 00000000000191"))

def _main_fakes(monkeypatch):
    import venda.mc.notion as N
    n, e = NotionFake(pagina()), ErpFake()
    monkeypatch.setenv("NOTION_TOKEN", "x"); monkeypatch.setenv("MC_VIA", "porteiro")
    monkeypatch.setattr(N, "Notion", lambda _tok: n)
    monkeypatch.setattr(K, "do_ambiente", lambda: e)
    monkeypatch.setattr(K, "_hoje", lambda: HOJE)
    return n, e

def test_main_stdout_sem_nome_nem_valor(monkeypatch, capsys):
    n, e = _main_fakes(monkeypatch)
    assert K.main(["--page", PAGE, "--parcelas", "5000.00@2026-11-24"]) == 0
    assert K.main(["--page", PAGE, "--parcelas", "5000.00@2026-11-24", "--aplicar"]) == 0
    out = capsys.readouterr().out
    assert "CORRETOR" not in out and "COMPRADOR" not in out and "5000" not in out and "5.000" not in out
    assert [json.loads(x)["situacao"] for x in out.strip().splitlines()] == ["PREVIA", "LANCADA"]
    assert len(e.posts) == 1

def test_main_bloqueado_nao_grava(monkeypatch, capsys):
    n, e = _main_fakes(monkeypatch)
    K.main(["--page", PAGE, "--parcelas", "5000.00@2026-11-24"])
    K.main(["--page", PAGE, "--parcelas", "5000.00@2026-11-24", "--aplicar", "--bloqueado"])
    assert e.posts == [] and json.loads(capsys.readouterr().out.strip().splitlines()[-1])["codigo"] == "BLOQUEADO"

def test_main_marcar_erro_preserva_historico(monkeypatch, capsys):
    n, e = _main_fakes(monkeypatch)
    antigo = "LANÇADA | título tp-0 | R$ 1.000,00 | 1 parcela(s) | recibos: 1/1 | 20/11 10:00"
    n.pg["properties"]["MC - COMISSÃO"] = txt("PROCESSANDO (lançamento) [t=1]\n" + antigo)
    assert K.main(["--page", PAGE, "--parcelas", "x", "--marcar-erro", "caiu"]) == 1
    assert coluna(n).startswith("ERRO") and antigo in coluna(n)


# ----------------------------------------------------------------- erp.py: dois métodos novos

def test_erp_condicao_por_tipo():
    from venda.mc.erp import Erp
    e = Erp("", "")
    e.pedir = lambda m, c, **k: [{"id": "1", "type": "IN_CASH"}, {"id": "2", "type": "FINANCING"}]
    assert e.condicao_por_tipo("FINANCING")["id"] == "2" and e.condicao_por_tipo("RECURRING") is None

def test_erp_anexar_titulo(monkeypatch):
    import requests
    from venda.mc.erp import Erp
    e, vistos = Erp("", ""), {}
    def core(m, c, corpo=None, params=None):
        vistos["core"] = (m, c, corpo)
        return [{"url": "https://bucket.s3.amazonaws.com/x?a=1&b=2"}]
    e.pedir_core = core
    class Resp: status_code = 200
    def put(url, data=None, headers=None, timeout=None):
        vistos["put"] = (url, data, headers)
        return Resp()
    monkeypatch.setattr(requests, "put", put)
    assert e.anexar_titulo("tp-1", "a.pdf", b"%PDF-x") == 200
    assert vistos["core"][1] == "/attachments/v2/batch" and vistos["core"][2]["entityId"] == "tp-1"
    assert vistos["core"][2]["attachmentsItem"][0]["sizeInBytes"] == 6
    assert vistos["put"] == ("https://bucket.s3.amazonaws.com/x?a=1&b=2", b"%PDF-x", {"Content-Type": "application/pdf"})
    e.pedir_core = lambda *a, **k: {}
    with pytest.raises(ErpErro):
        e.anexar_titulo("tp-1", "a.pdf", b"%PDF-x")


# ----------------------------------------------------------------- rodada de conserto 1 (revisão da Tarefa 3)

class ErpListando(ErpFake):
    """O título criado aparece na listagem do dia (como no ERP); `titulos` = títulos já existentes por id."""
    def __init__(self, *a, titulos=None, lista_erro=False, conta_id="c-1", **k):
        super().__init__(*a, **k)
        self.titulos, self.lista_erro, self.conta_id = dict(titulos or {}), lista_erro, conta_id
    def obra(self, _): return {"defaultAccount": {"id": self.conta_id, "name": "CONTA TESTE"}}
    def pedir(self, metodo, caminho, corpo=None, params=None):
        if caminho.startswith("/payable-installments/paginated-result"):
            if self.lista_erro:
                raise ErpErro("GET /payable-installments/paginated-result -> HTTP 503: fora")
            self.consultas_dia.append((params or {}).get("startDate"))
            criados = [{"id": "i-%d" % i, "description": c["description"], "paidTo": "X", "tradePayableId": "tp-1"}
                       for i, c in enumerate(self.posts) if (params or {}).get("startDate") in
                       [x["plannedDate"] for x in c["installments"]] and not self.post_sem_id and not self.post_erro]
            return {"content": list(self.ja) + criados}
        if metodo == "GET" and caminho.startswith("/trade-payables/") and caminho != "/trade-payables/tp-1":
            return self.titulos[caminho.rsplit("/", 1)[1]]
        return super().pedir(metodo, caminho, corpo, params)

INCERTO_4MIL = "INCERTO | COMISSÃO CORRETOR UNIDADE 07 - COMPRADOR TESTE | datas 2026-11-24,2026-12-24 | R$ 4.000,00 | 24/11 10:00"
DESC07 = "COMISSÃO CORRETOR UNIDADE 07 - COMPRADOR TESTE"

def test_incerto_grava_linha_persistente():
    n, e = NotionFake(pagina()), ErpListando(post_sem_id=True)
    K.processar(PAGE, n, e, "1000.00@2026-11-24;2000.00@2026-12-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24;2000.00@2026-12-24", aplicar=True, hoje=HOJE)
    assert r["codigo"] == "INCERTO"
    assert ("INCERTO | %s | datas 2026-11-24,2026-12-24 | R$ 3.000,00 | " % DESC07) in coluna(n)

def test_incerto_com_titulo_no_erp_vira_lancada_e_conta_no_saldo():
    ja = [{"id": "i-9", "description": DESC07, "paidTo": "X", "tradePayableId": "tp-9"}]
    n = NotionFake(pagina(INCERTO_4MIL))
    e = ErpListando(ja=ja, titulos={"tp-9": {"id": "tp-9", "value": 4000.0}})
    r = K.processar(PAGE, n, e, "6000.00@2026-11-24", hoje=HOJE)
    assert r["situacao"] == "PREVIA", r
    t = coluna(n)
    assert "R$ 6.000,00 de R$ 10.000,00" in t and "INCERTO |" not in t
    assert any(ln.startswith("LANÇADA | título tp-9 | R$ 4.000,00 |") and ln.endswith("confirmado depois do incerto")
               for ln in t.split("\n"))
    n2 = NotionFake(pagina(INCERTO_4MIL))
    e2 = ErpListando(ja=ja, titulos={"tp-9": {"id": "tp-9", "value": 4000.0}})
    assert K.processar(PAGE, n2, e2, "7000.00@2026-11-24", hoje=HOJE)["codigo"] == "ACIMA_DO_SALDO"

def test_incerto_sem_titulo_no_erp_vira_conferido_e_segue():
    n, e = NotionFake(pagina(INCERTO_4MIL)), ErpListando()
    r = K.processar(PAGE, n, e, "10000.00@2026-11-24", hoje=HOJE)
    assert r["situacao"] == "PREVIA", r
    t = coluna(n)
    assert "INCERTO |" not in t and "INCERTO CONFERIDO | não criado | 2026-11-24,2026-12-24 | " in t
    assert "R$ 10.000,00 de R$ 10.000,00" in t
    assert {"2026-11-24", "2026-12-24"} <= set(e.consultas_dia)
    r = K.processar(PAGE, n, e, "10000.00@2026-11-24", hoje=HOJE)   # a linha conferida não volta a ser consultada nem conta
    assert r["situacao"] == "PREVIA" and "INCERTO CONFERIDO" in coluna(n)

def test_incerto_com_erp_fora_do_ar_recusa_e_nao_posta():
    for aplicar in (False, True):
        n, e = NotionFake(pagina(INCERTO_4MIL)), ErpListando(lista_erro=True)
        r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=aplicar, hoje=HOJE)
        assert r["codigo"] == "INCERTO_PENDENTE" and e.posts == []
        assert INCERTO_4MIL in coluna(n)

def test_incerto_com_titulo_sem_id_fica_pendente():
    ja = [{"id": "i-9", "description": DESC07, "paidTo": "X"}]
    n, e = NotionFake(pagina(INCERTO_4MIL)), ErpListando(ja=ja)
    assert K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)["codigo"] == "INCERTO_PENDENTE"
    assert INCERTO_4MIL in coluna(n)

def test_5xx_que_cita_http_400_no_corpo_e_incerto():
    exc = ErpErro('POST /trade-payables -> HTTP 500: {"erro": "upstream respondeu HTTP 400 -> HTTP 404: x"}')
    n, e = NotionFake(pagina()), ErpListando(post_erro=exc)
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["codigo"] == "INCERTO" and len(e.posts) == 1

class NotionSemColunaNoLancamento(NotionFake):
    def __init__(self, pg, modo):
        super().__init__(pg); self.modo = modo
    def gravar_textos(self, pid, props, valores):
        if "LANÇADA | título tp-1" in valores.get("MC - COMISSÃO", ""):
            if self.modo == "faltante":
                return ["MC - COMISSÃO"]
            raise RuntimeError("notion fora")
        return super().gravar_textos(pid, props, valores)

def test_lancada_com_coluna_faltando_e_sem_anotar():
    n, e = NotionSemColunaNoLancamento(pagina(), "faltante"), ErpListando()
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["situacao"] == "LANCADA" and r["codigo"] == "LANCADA_SEM_ANOTAR" and len(e.posts) == 1

def test_reaplicar_depois_de_lancada_sem_anotar_nao_duplica():
    n, e = NotionSemColunaNoLancamento(pagina(), "erro"), ErpListando()
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["codigo"] == "LANCADA_SEM_ANOTAR"
    assert coluna(n).startswith("PRÉVIA OK [#")          # a prévia ficou: a linha LANÇADA não entrou
    r = K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)
    assert r["codigo"] == "TITULO_FORA_DA_COLUNA" and len(e.posts) == 1

def test_assinatura_cobre_conta_e_descricao():
    base = {"parcelas": [{"valor": 1.0, "data": HOJE}], "favorecido_id": "a", "comissao": 10.0, "ja_lancado": 0.0,
            "pix": "CPF: 11144477735", "conta_id": "c-1", "descricao": "D"}
    assert K.assinatura(base) != K.assinatura(dict(base, conta_id="c-2"))
    assert K.assinatura(base) != K.assinatura(dict(base, descricao="E"))

def test_conta_mudou_entre_previa_e_aplicar():
    n, e = NotionFake(pagina()), ErpListando()
    K.processar(PAGE, n, e, "1000.00@2026-11-24", hoje=HOJE)
    e.conta_id = "c-2"
    assert K.processar(PAGE, n, e, "1000.00@2026-11-24", aplicar=True, hoje=HOJE)["codigo"] == "PREVIA_DESATUALIZADA"
    assert e.posts == []

@pytest.mark.parametrize("entrada,saida", [
    ("PIX - CPF 111.444.777-35", "CPF: 111.444.777-35"), ("PIX CPF: 11144477735", "CPF: 11144477735"),
    ("PIX: CNPJ - 00.000.000/0001-91", "CNPJ: 00.000.000/0001-91"), ("PIX - E-MAIL a@b.example", "E-MAIL: a@b.example"),
    ("PIX: cpf-x@y.example", "E-MAIL: cpf-x@y.example"), ("PIX - CPF 62999990000", "TELEFONE: 62999990000"),
    ("PIX CNPJ: 11144477735", "CPF: 11144477735"), ("PIX - CPF", None)])
def test_pix_com_tipo_escrito_classifica_pela_regra(entrada, saida):
    assert K.pix_do_banco(entrada) == saida
