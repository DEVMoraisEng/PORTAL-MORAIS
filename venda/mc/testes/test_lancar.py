# -*- coding: utf-8 -*-
"""Fluxo do lançamento com Notion e ERP de mentira. Dados inventados."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import lancar as L  # noqa: E402
from venda.mc.testes.test_regras import pagina, txt, CPF_OK  # noqa: E402

OBRA = "RUA TESTE QD 01 LT 02"


class NotionFake:
    def __init__(self, props):
        self.props = dict(props)
        self.props["MC - SITUAÇÃO"] = {"type": "rich_text", "rich_text": []}
        self.props["MC - VENDA ID"] = {"type": "rich_text", "rich_text": []}
        self.gravado = {}

    def pagina(self, pid):
        return {"properties": self.props}

    corretores = [{"properties": {"NOME": {"type": "title", "title": [{"plain_text": "Corretor Exemplo"}]},
                                  "CPF/CNPJ": {"type": "rich_text", "rich_text": [{"plain_text": "111.444.777-35"}]},
                                  "CRECI": {"type": "rich_text", "rich_text": [{"plain_text": "12345"}]}}}]

    def linhas(self, db_id):
        return self.corretores

    def gravar_textos(self, pid, props, valores):
        self.gravado.update(valores)
        for k, v in valores.items():   # como o Notion: a próxima leitura já vê o texto
            self.props[k] = txt(v)
        return []


class ErpFake:
    user_id = "u-robo"

    def __init__(self, obras=None, conta=True, recebimentos=None, clientes=None):
        self._obras = obras if obras is not None else [{"id": "obra-1", "name": OBRA}]
        self._conta = {"id": "conta-1", "name": "CONTA DA OBRA"} if conta else None
        self._rec = recebimentos or []
        self._cli = clientes or []
        self.criados = []

    def obras(self):
        return self._obras

    def obra(self, oid):
        return {"id": oid, "defaultAccount": self._conta}

    def recebimentos(self):
        return self._rec

    def cliente_por_cpf(self, cpf):
        return [c for c in self._cli if c["cpf"] == cpf]

    def participantes_por_documento(self, doc):
        return getattr(self, "_por_doc", [])

    def homonimos(self, nome):
        from venda.mc.regras import chave
        return [h for h in getattr(self, "_homs", []) if chave(h.get("name")) == chave(nome)]

    def criar_cliente(self, corpo):
        self.criados.append(("cliente", corpo))
        return {"id": "cli-novo"}

    def criar_venda(self, corpo):
        self.criados.append(("venda", corpo))
        return {"id": "venda-nova"}




def previa_e_lanca(n, e):
    """Prévia, depois o lançamento — como na tela (o PROCESSANDO leva a assinatura vista)."""
    r = L.processar("p1", n, e)
    assert r["situacao"] == "PREVIA", r
    assin = L.R.assinatura_da_situacao(n.props["MC - SITUAÇÃO"]["rich_text"][0]["plain_text"])
    n.props["MC - SITUAÇÃO"] = txt("PROCESSANDO (lançamento) — 06/10 01:00 [t=1] [#%s]" % assin)
    return L.processar("p1", n, e, aplicar=True)


def test_previa_nao_grava_no_erp_e_anota_no_notion_com_assinatura():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e)
    assert r["situacao"] == "PREVIA" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("PRÉVIA OK [#")
    assert r["corpo_venda"]["tradeReceivable"]["defaultAccount"] == {"id": "conta-1"}


def test_aplicar_depois_da_previa_cria_cliente_e_venda_e_grava_id():
    n, e = NotionFake(pagina()), ErpFake()
    r = previa_e_lanca(n, e)
    assert r["situacao"] == "CRIADA"
    assert [t for t, _ in e.criados] == ["cliente", "cliente", "venda"]
    assert e.criados[0][1]["role"] == "SUPPLIER" and e.criados[0][1]["name"] == "CORRETOR EXEMPLO"
    assert e.criados[2][1]["customer"] == {"id": "cli-novo"} and e.criados[2][1]["seller"] == {"id": "cli-novo"}
    assert n.gravado["MC - VENDA ID"] == "venda-nova"


def test_situacao_em_linhas_curtas_previa_e_criada():
    n, e = NotionFake(pagina()), ErpFake()
    L.processar("p1", n, e)
    linhas = n.gravado["MC - SITUAÇÃO"].split("\n")
    assert linhas[0].startswith("PRÉVIA OK [#") and " | VENDA CASA 02" in linhas[0]
    assert linhas[1] == "Cliente: FULANO DE TAL (novo, será criado)"
    assert any(x.startswith("Parcelas: 4 (") for x in linhas)
    assert any(x.startswith("- Sinal R$ ") for x in linhas)
    assert "Total: R$ 260.000,00" in linhas
    n2, e2 = NotionFake(pagina()), ErpFake()
    previa_e_lanca(n2, e2)
    assert n2.gravado["MC - SITUAÇÃO"].split("\n") == [
        "CRIADA | venda venda-nova", "Cliente: FULANO DE TAL (criado agora)",
        "Parcelas: 4 (sinal, entrada, financiamento, FGTS)", "Total: R$ 260.000,00",
        "Contrato: não anexado (coluna CONTRATO ASSINADO vazia)"]


def test_contagem_e_reais():
    ps = [{"rotulo": r, "valor": 1000.5} for r in
          ["Sinal ato", "Sinal 30 dias", "Pré-chaves 1ª parte 1/2", "Pré-chaves 1ª parte 2/2", "Balão 12/27",
           "Balão entrega de chaves", "Pós-chaves 1/1", "Financiamento", "FGTS", "Esquisita"]]
    assert L.R.contagem_parcelas(ps) == ("10 (sinais 2, pré-chaves 2, balões 2, pós-chaves, financiamento, FGTS, "
                                         "outras 1)")
    assert L.R.total_parcelas(ps) == "R$ 10.005,00"
    assert L.R.reais(1234567.8) == "R$ 1.234.567,80" and L.R.reais(0) == "R$ 0,00"


def test_aplicar_sem_previa_ou_com_dado_mudado_recusa():
    n, e = NotionFake(pagina()), ErpFake()
    assert L.processar("p1", n, e, aplicar=True)["codigo"] == "PREVIA_DESATUALIZADA" and e.criados == []
    n, e = NotionFake(pagina()), ErpFake()
    L.processar("p1", n, e)
    assin = L.R.assinatura_da_situacao(n.props["MC - SITUAÇÃO"]["rich_text"][0]["plain_text"])
    n.props["CONTRATO - SINAL VALOR"] = {"type": "number", "number": 6000}
    n.props["VALOR FINANCIADO"] = {"type": "number", "number": 229000}
    n.props["MC - SITUAÇÃO"] = txt("PROCESSANDO (lançamento) [#%s]" % assin)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["codigo"] == "PREVIA_DESATUALIZADA" and e.criados == []


def test_cliente_existente_pelo_cpf_nao_cria_outro():
    n, e = NotionFake(pagina()), ErpFake(clientes=[{"id": "cli-velho", "cpf": CPF_OK}])
    previa_e_lanca(n, e)
    assert [t for t, _ in e.criados] == ["cliente", "venda"] and e.criados[1][1]["customer"] == {"id": "cli-velho"}


def test_venda_da_casa_ja_lancada_nao_duplica_e_nao_preenche_venda_id():
    rec = [{"workName": OBRA, "description": "VENDA CASA 2 - OUTRA GRAFIA", "saleId": "s-antiga", "customerName": "Y"}]
    n, e = NotionFake(pagina()), ErpFake(recebimentos=rec)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "JA_EXISTE" and e.criados == []
    assert "MC - VENDA ID" not in n.gravado and "s-antiga" in n.gravado["MC - SITUAÇÃO"]


def test_venda_da_obra_sem_casa_na_descricao_recusa():
    rec = [{"workName": OBRA, "description": "SO O NOME DE ALGUEM", "saleId": "s-x"}]
    n, e = NotionFake(pagina()), ErpFake(recebimentos=rec)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["codigo"] == "VENDA_SEM_CASA_NA_OBRA" and e.criados == []


def test_obra_nao_encontrada_ou_repetida_recusa():
    for obras in ([], [{"id": "a", "name": OBRA}, {"id": "b", "name": OBRA.lower()}]):
        n, e = NotionFake(pagina()), ErpFake(obras=obras)
        r = L.processar("p1", n, e, aplicar=True)
        assert r["situacao"] == "RECUSADA" and e.criados == []


def test_obra_sem_conta_padrao_recusa():
    n, e = NotionFake(pagina()), ErpFake(conta=False)
    assert L.processar("p1", n, e)["codigo"] == "OBRA_SEM_CONTA"


def test_faltas_recusam_antes_de_falar_com_o_erp():
    class Explode(ErpFake):
        def obras(self):
            raise AssertionError("não devia chamar o ERP")
    n, e = NotionFake(pagina(CPF=txt("123"))), Explode()
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "RECUSADA" and any("CPF" in m for m in r["motivos"])


def test_ja_lancada_pelo_notion_nao_repete():
    n = NotionFake(pagina())
    n.props["MC - VENDA ID"] = txt("venda-x")
    e = ErpFake()
    assert L.processar("p1", n, e, aplicar=True)["situacao"] == "JA_LANCADA" and e.criados == []


def test_bloqueado_vira_previa_com_aviso_e_nao_grava():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.processar("p1", n, e, aplicar=False, bloqueado=True)
    assert r["situacao"] == "PREVIA" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("BLOQUEADO:")


def test_cpf_em_dois_clientes_recusa():
    cli = [{"id": "a", "cpf": CPF_OK}, {"id": "b", "cpf": CPF_OK}]
    n, e = NotionFake(pagina()), ErpFake(clientes=cli)
    assert L.processar("p1", n, e)["situacao"] == "RECUSADA" and e.criados == []


def test_notion_falha_depois_de_criar_levanta():
    class NotionQueFalha(NotionFake):
        def gravar_textos(self, pid, props, valores):
            if "MC - VENDA ID" in valores:
                raise RuntimeError("Notion fora")
            return super().gravar_textos(pid, props, valores)
    n, e = NotionQueFalha(pagina()), ErpFake()
    try:
        previa_e_lanca(n, e)
        assert False, "devia levantar"
    except L.FalhaNotion:
        pass


def test_main_sem_segredos_anota_erro_e_log_sem_dado(monkeypatch, capsys):
    monkeypatch.delenv("MC_ROBO_EMAIL", raising=False)
    monkeypatch.delenv("MC_ROBO_SENHA", raising=False)
    monkeypatch.setenv("NOTION_TOKEN", "x")
    anotado = {}

    class N(NotionFake):
        def __init__(self, *_, **__):
            super().__init__(pagina())

        def gravar_textos(self, pid, props, valores):
            anotado.update(valores)
            return []
    monkeypatch.setattr(L, "Notion", N)
    assert L.main(["--page", "a" * 32]) == 2
    assert anotado["MC - SITUAÇÃO"].startswith("ERRO:")
    saida = capsys.readouterr().out
    assert "SEM_SEGREDOS" in saida and CPF_OK not in saida and "Fulano" not in saida


def test_main_excecao_inesperada_nao_deixa_processando(monkeypatch, capsys):
    for k in ("NOTION_TOKEN", "MC_ROBO_EMAIL", "MC_ROBO_SENHA"):
        monkeypatch.setenv(k, "x")
    anotado = {}

    class N(NotionFake):
        def __init__(self, *_, **__):
            super().__init__(pagina())

        def gravar_textos(self, pid, props, valores):
            anotado.update(valores)
            return []

    class E(ErpFake):
        def __init__(self, *_, **__):
            super().__init__()

        def obras(self):
            raise ValueError("html no lugar de json")
    monkeypatch.setattr(L, "Notion", N)
    monkeypatch.setattr(L, "Erp", E)
    assert L.main(["--page", "a" * 32]) == 1
    assert anotado["MC - SITUAÇÃO"].startswith("ERRO: falha inesperada (ValueError)")
    assert "html no lugar" not in capsys.readouterr().out


def test_aviso_generico_nao_apaga_o_motivo_ja_anotado():
    n = NotionFake(pagina())
    n.props["MC - SITUAÇÃO"] = txt("ERRO: o Mais Controle recusou — login recusado (HTTP 401)")
    L._anotar_erro(n, "p", "o robô falhou", manter_erro_anterior=True)
    assert n.props["MC - SITUAÇÃO"]["rich_text"][0]["plain_text"].startswith("ERRO: o Mais Controle recusou")
    n = NotionFake(pagina())
    n.props["MC - SITUAÇÃO"] = txt("RECUSADA: já existe no Mais Controle um cadastro")
    L._anotar_erro(n, "p", "o robô falhou", manter_erro_anterior=True)
    assert n.gravado == {}
    n = NotionFake(pagina())
    n.props["MC - SITUAÇÃO"] = txt("PROCESSANDO [t=1]")
    L._anotar_erro(n, "p", "o robô falhou", manter_erro_anterior=True)
    assert "o robô falhou" in str(n.gravado)


class _Resp:
    def __init__(self, status, corpo):
        self.status_code, self._c = status, corpo

    def json(self):
        return self._c


class _Http:
    def __init__(self, resp):
        self.resp, self.cab = resp, None

    def post(self, url, json=None, headers=None, timeout=None):
        self.cab = headers
        return self.resp


def test_login_que_pede_codigo_explica_e_manda_o_aparelho():
    from venda.mc.erp import Erp, ErpErro
    http = _Http(_Resp(401, {"mfaToken": "x"}))
    for aparelho, trecho in (("", "falta o segredo MC_ROBO_APARELHO"), ("abc", "venceu")):
        try:
            Erp("e", "s", sessao=http, aparelho=aparelho).logar()
            assert False
        except ErpErro as e:
            assert trecho in str(e)
    assert http.cab["x-device-code"] == "abc"


def test_homonimo_fornecedor_recusa_na_previa_sem_criar_nada():
    n = NotionFake(pagina())
    e = ErpFake()
    e._homs = [{"id": "f1", "name": "FULANO DE TAL", "role": "SUPPLIER", "cpf": None}]
    r = L.processar("p", n, e, aplicar=False)
    assert r["situacao"] == "RECUSADA" and r["codigo"] == "NOME_JA_CADASTRADO"
    assert "Fornecedor" in n.gravado["MC - SITUAÇÃO"] and "diferencie o nome" in n.gravado["MC - SITUAÇÃO"]
    e._homs = [{"id": "f1", "name": "Fulano de Tal", "role": "SUPPLIER", "cpf": CPF_OK}]
    n = NotionFake(pagina())
    r = L.processar("p", n, e, aplicar=False)
    assert r["codigo"] == "NOME_JA_CADASTRADO" and "mesmo CPF" in n.gravado["MC - SITUAÇÃO"]
    assert "marque também como Cliente" in n.gravado["MC - SITUAÇÃO"]


def test_corretor_ja_cadastrado_vira_vendedor_sem_criar():
    n, e = NotionFake(pagina()), ErpFake()
    e._homs = [{"id": "cor-1", "name": "Corretor Exemplo", "role": "SUPPLIER"}]
    L.processar("p1", n, e)
    assert "Vendedor: CORRETOR EXEMPLO (já cadastrado)" in n.gravado["MC - SITUAÇÃO"]
    L.processar("p1", n, e, aplicar=True)
    assert [t for t, _ in e.criados] == ["cliente", "venda"] and e.criados[1][1]["seller"] == {"id": "cor-1"}


def test_corretor_em_dois_cadastros_prefere_fornecedor_e_recusa_se_ambiguo():
    n, e = NotionFake(pagina()), ErpFake()
    e._homs = [{"id": "a", "name": "CORRETOR EXEMPLO", "role": "CUSTOMER"},
               {"id": "b", "name": "CORRETOR EXEMPLO", "role": "SUPPLIER"}]
    assert L.processar("p1", n, e)["corpo_venda"]["seller"] == {"id": "b"}
    e._homs = [{"id": "a", "name": "CORRETOR EXEMPLO", "role": "SUPPLIER"},
               {"id": "b", "name": "CORRETOR EXEMPLO", "role": "SUPPLIER"}]
    n2 = NotionFake(pagina())
    r = L.processar("p1", n2, e)
    assert r["codigo"] == "PREVIA" and "sem Vendedor" in n2.gravado["MC - SITUAÇÃO"] and "seller" not in r["corpo_venda"]


def test_sem_corretor_vai_sem_vendedor():
    n = NotionFake(pagina(CORRETOR={"type": "select", "select": None}))
    r = L.processar("p1", n, ErpFake())
    assert r["codigo"] == "PREVIA" and "sem Vendedor" in n.gravado["MC - SITUAÇÃO"] and "seller" not in r["corpo_venda"]


def test_corretor_sem_cpf_no_cadastro_vai_sem_vendedor():
    n, e = NotionFake(pagina()), ErpFake()
    n.corretores = []
    r = L.processar("p1", n, e)
    assert r["codigo"] == "PREVIA" and "CORRETORES – CONTRATO" in n.gravado["MC - SITUAÇÃO"]
    L.processar("p1", n, e, aplicar=True)
    assert [t for t, _ in e.criados] == ["cliente", "venda"] and "seller" not in e.criados[-1][1]


def test_corretor_novo_leva_cpf_e_creci_do_cadastro():
    n, e = NotionFake(pagina()), ErpFake()
    L.processar("p1", n, e)
    L.processar("p1", n, e, aplicar=True)
    cor = e.criados[0][1]
    assert cor["cpf"] == "11144477735" and cor["type"] == "PERSON" and cor["comment"] == "Corretor — CRECI 12345"


def test_corretor_com_cpf_ja_no_erp_com_outro_nome_reaproveita():
    n, e = NotionFake(pagina()), ErpFake()
    e._por_doc = [{"id": "cor-9", "name": "OUTRO NOME", "role": "SUPPLIER"}]
    L.processar("p1", n, e)
    L.processar("p1", n, e, aplicar=True)
    assert [t for t, _ in e.criados] == ["cliente", "venda"] and e.criados[1][1]["seller"] == {"id": "cor-9"}


def test_sondar_nao_cria_nada_e_anota():
    n, e = NotionFake(pagina()), ErpFake()
    r = L.sondar("p1", n, e)
    assert r["codigo"] == "SONDA_LIVRE" and e.criados == [] and n.gravado["MC - SITUAÇÃO"].startswith("SONDA: SEM venda")
    rec = [{"workName": "RUA TESTE QD 01 LT 02", "description": "CASA 02 - X", "saleId": "s2", "customerName": "X"}]
    n, e = NotionFake(pagina()), ErpFake(recebimentos=rec)
    assert L.sondar("p1", n, e)["codigo"] == "SONDA_TEM_VENDA" and e.criados == []
