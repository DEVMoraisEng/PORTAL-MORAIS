# -*- coding: utf-8 -*-
"""Testes das funções puras de robo_mc_contas.py (T1) — sem rede, sem
playwright. Dados fictícios só ("BANCO MODELO 1234-5"), como manda o repo
público. A segunda metade (Rodada 1) testa os consertos da revisão com
`monkeypatch` (fakes de `api`/`requests`/`sys.modules`) — ainda sem rede
nenhuma de verdade."""
import sys
import types

import pytest

import robo_mc_contas as r


# ============================================================================
# conta_do_erp
# ============================================================================

def test_conta_do_erp_com_digito_de_agencia_e_numero():
    item = {
        "id": "uuid-1", "name": "CONTA MODELO", "bankCode": "756",
        "agency": "1234", "agencyDigit": "5",
        "account": "6789", "accountDigit": "0",
    }
    c = r.conta_do_erp(item)
    assert c == {
        "id": "uuid-1", "nome": "CONTA MODELO", "banco": "756",
        "agencia": "1234-5", "numero": "6789-0",
    }


def test_conta_do_erp_sem_digito_fica_so_o_numero():
    item = {"id": "uuid-2", "name": "CONTA MODELO 2", "bankCode": "001",
            "agency": "100", "agencyDigit": "", "account": "222", "accountDigit": ""}
    c = r.conta_do_erp(item)
    assert c["agencia"] == "100"
    assert c["numero"] == "222"


def test_conta_do_erp_numero_vazio_tira_digitos_do_nome():
    item = {"id": "uuid-3", "name": "BANCO MODELO - Conta corrente: 1234-5 - SICOOB",
            "bankCode": "756", "agency": "1", "agencyDigit": "", "account": "", "accountDigit": ""}
    c = r.conta_do_erp(item)
    assert c["numero"] == "1234-5"


def test_conta_do_erp_numero_vazio_e_nome_sem_digitos_fica_vazio():
    item = {"id": "uuid-4", "name": "CONTA SEM NUMERO NO NOME",
            "bankCode": "756", "agency": "1", "agencyDigit": "", "account": "", "accountDigit": ""}
    c = r.conta_do_erp(item)
    assert c["numero"] == ""


def test_conta_do_erp_item_vazio_nao_quebra():
    c = r.conta_do_erp({})
    assert c == {"id": "", "nome": "", "banco": "", "agencia": "", "numero": ""}
    assert r.conta_do_erp(None) == c


# ============================================================================
# planejar
# ============================================================================

def _conta_erp(id_="e1", nome="CONTA MODELO 1", banco="756", agencia="1-2", numero="1000-1"):
    return {"id": id_, "nome": nome, "banco": banco, "agencia": agencia, "numero": numero}


def _pagina_notion(page_id="p1", id_erp="e1", nome="CONTA MODELO 1", banco="756",
                    agencia="1-2", numero="1000-1", situacao="Ativa"):
    return {"page_id": page_id, "id_erp": id_erp, "nome": nome, "banco": banco,
            "agencia": agencia, "numero": numero, "situacao": situacao}


def test_planejar_primeira_carga_desmarca_aparece():
    plano = r.planejar([_conta_erp()], [], primeira_carga=True)
    assert len(plano["criar"]) == 1
    assert plano["criar"][0]["aparece"] is False


def test_planejar_conta_nova_fora_da_primeira_carga_marca_aparece():
    plano = r.planejar([_conta_erp()], [], primeira_carga=False)
    assert len(plano["criar"]) == 1
    assert plano["criar"][0]["aparece"] is True


def test_planejar_criar_tem_todos_os_campos_esperados():
    plano = r.planejar([_conta_erp(id_="e9", nome="CONTA MODELO 9")], [], primeira_carga=False)
    item = plano["criar"][0]
    assert item["id_erp"] == "e9"
    assert item["nome"] == "CONTA MODELO 9"
    assert set(item.keys()) == {"id_erp", "nome", "banco", "agencia", "numero", "aparece"}


def test_planejar_atualizacao_nunca_toca_aparece():
    erp = [_conta_erp(nome="CONTA MODELO 1 - NOME NOVO")]
    notion = [_pagina_notion()]  # nome antigo diferente
    plano = r.planejar(erp, notion, primeira_carga=False)
    assert plano["criar"] == []
    assert len(plano["atualizar"]) == 1
    u = plano["atualizar"][0]
    assert u["id"] == "p1"
    assert u["campos"] == {"nome": "CONTA MODELO 1 - NOME NOVO"}
    assert "aparece" not in u["campos"]
    assert "Aparece" not in u["campos"]


def test_planejar_sem_mudanca_nao_gera_atualizacao():
    plano = r.planejar([_conta_erp()], [_pagina_notion()], primeira_carga=False)
    assert plano["criar"] == []
    assert plano["atualizar"] == []
    assert plano["sumiu"] == []
    assert plano["voltou"] == []


def test_planejar_conta_que_sumiu_do_erp():
    notion = [_pagina_notion(situacao="Ativa")]
    plano = r.planejar([], notion, primeira_carga=False)
    assert plano["sumiu"] == [{"id": "p1"}]
    assert plano["criar"] == plano["atualizar"] == plano["voltou"] == []


def test_planejar_conta_que_ja_estava_marcada_sumida_nao_repete():
    notion = [_pagina_notion(situacao="Sumiu do ERP")]
    plano = r.planejar([], notion, primeira_carga=False)
    assert plano["sumiu"] == []


def test_planejar_conta_que_voltou():
    erp = [_conta_erp()]
    notion = [_pagina_notion(situacao="Sumiu do ERP")]
    plano = r.planejar(erp, notion, primeira_carga=False)
    assert plano["voltou"] == [{"id": "p1"}]
    assert plano["sumiu"] == []
    assert plano["criar"] == []


def test_planejar_conta_que_voltou_com_dado_mudado_tambem_atualiza():
    erp = [_conta_erp(nome="CONTA MODELO 1 - NOVO NOME")]
    notion = [_pagina_notion(situacao="Sumiu do ERP")]
    plano = r.planejar(erp, notion, primeira_carga=False)
    assert plano["voltou"] == [{"id": "p1"}]
    assert plano["atualizar"] == [{"id": "p1", "campos": {"nome": "CONTA MODELO 1 - NOVO NOME"}}]


def test_planejar_lista_vazias_nao_quebra():
    plano = r.planejar([], [], primeira_carga=True)
    assert plano == {"criar": [], "atualizar": [], "sumiu": [], "voltou": []}


def test_planejar_notion_sem_id_erp_e_ignorado_no_casamento_e_no_sumiu():
    notion = [{"page_id": "px", "id_erp": "", "nome": "", "banco": "", "agencia": "", "numero": "", "situacao": "Ativa"}]
    plano = r.planejar([_conta_erp()], notion, primeira_carga=False)
    # a página sem ID ERP não é candidata a "sumiu" (não dá para saber a que conta do ERP ela corresponde)
    assert plano["sumiu"] == []
    assert len(plano["criar"]) == 1


# ============================================================================
# casar_texto_conta
# ============================================================================

CONTAS_TESTE = [
    {"id": "c1", "numero": "1234-5", "banco": "SICOOB"},
    {"id": "c2", "numero": "9999-0", "banco": "BANCO MODELO"},
]


def test_casar_texto_conta_casamento_unico():
    texto = "OBRA MODELO - Conta corrente: 1234-5 - SICOOB"
    assert r.casar_texto_conta(texto, CONTAS_TESTE) == "c1"


def test_casar_texto_conta_sem_digitos_no_texto_devolve_none():
    assert r.casar_texto_conta("CONTA SEM NUMERO NENHUM", CONTAS_TESTE) is None


def test_casar_texto_conta_texto_vazio_devolve_none():
    assert r.casar_texto_conta("", CONTAS_TESTE) is None
    assert r.casar_texto_conta(None, CONTAS_TESTE) is None


def test_casar_texto_conta_pessoa_fisica_devolve_none():
    assert r.casar_texto_conta("PESSOA FISICA", CONTAS_TESTE) is None
    assert r.casar_texto_conta("pessoa fisica", CONTAS_TESTE) is None


def test_casar_texto_conta_ambiguo_sem_banco_no_texto_devolve_none():
    contas = [
        {"id": "c1", "numero": "1234-5", "banco": "SICOOB"},
        {"id": "c2", "numero": "1234-5", "banco": "BANCO MODELO"},
    ]
    # duas contas com o MESMO número — o texto não tem banco para desempatar
    assert r.casar_texto_conta("Conta: 1234-5", contas) is None


def test_casar_texto_conta_ambiguo_desempata_pelo_banco():
    contas = [
        {"id": "c1", "numero": "1234-5", "banco": "SICOOB"},
        {"id": "c2", "numero": "1234-5", "banco": "BANCO MODELO"},
    ]
    texto = "Conta corrente: 1234-5 - SICOOB"
    assert r.casar_texto_conta(texto, contas) == "c1"


def test_casar_texto_conta_nenhuma_bate():
    assert r.casar_texto_conta("Conta corrente: 5555-5 - SICOOB", CONTAS_TESTE) is None


def test_casar_texto_conta_lista_vazia_devolve_none():
    assert r.casar_texto_conta("Conta corrente: 1234-5", []) is None


def test_casar_texto_conta_nao_atravessa_fronteira_entre_grupos():
    # "Ag 3233 Conta 1234-5" JUNTANDO os dígitos vira "323312345" — uma conta
    # CURTA cujo número atravessa a fronteira ("33123", por exemplo) bateria
    # por engano se a comparação fosse substring do texto inteiro emendado.
    # Comparando GRUPO a grupo, isso não acontece.
    contas = [{"id": "curta", "numero": "33123", "banco": ""}]
    assert r.casar_texto_conta("Ag 3233 Conta 1234-5", contas) is None


def test_casar_texto_conta_grupo_com_digito_verificador_casa_exato():
    contas = [{"id": "c1", "numero": "1234-5", "banco": ""}]
    assert r.casar_texto_conta("Ag 3233 Conta 1234-5", contas) == "c1"


def test_casar_texto_conta_desempate_por_codigo_do_banco_isolado_no_texto():
    contas = [
        {"id": "c1", "numero": "1234-5", "banco": "756"},
        {"id": "c2", "numero": "1234-5", "banco": "341"},
    ]
    assert r.casar_texto_conta("Ag 100 Conta 1234-5 Banco 756", contas) == "c1"


def test_casar_texto_conta_desempate_por_codigo_nao_e_substring():
    # o código "56" não pode casar dentro do grupo "756" — teria de ser um
    # GRUPO inteiro igual a "56".
    contas = [
        {"id": "c1", "numero": "1234-5", "banco": "56"},
        {"id": "c2", "numero": "1234-5", "banco": "341"},
    ]
    assert r.casar_texto_conta("Ag 100 Conta 1234-5 Banco 756", contas) is None


def test_casar_texto_conta_desempate_por_nome_do_banco_via_tabela_de_codigo():
    # a coluna Banco das contas do ERP guarda o CÓDIGO ("756"), não "SICOOB"
    # — o desempate tem de reconhecer o nome pela tabela.
    contas = [
        {"id": "c1", "numero": "1234-5", "banco": "756"},
        {"id": "c2", "numero": "1234-5", "banco": "341"},
    ]
    assert r.casar_texto_conta("Conta corrente: 1234-5 - SICOOB", contas) == "c1"
    assert r.casar_texto_conta("Conta corrente: 1234-5 - ITAU", contas) == "c2"


# ============================================================================
# decidir_credenciais (T2) — regra corrigida da credencial
# ============================================================================

def test_decidir_credenciais_usa_robo_e_permite_aplicar(monkeypatch):
    monkeypatch.setenv("MC_ROBO_USUARIO", "robo@exemplo.com")
    monkeypatch.setenv("MC_ROBO_SENHA", "senha-ficticia")
    monkeypatch.setenv("APLICAR", "1")
    monkeypatch.delenv("MC_USUARIO", raising=False)
    monkeypatch.delenv("MC_SENHA", raising=False)
    usuario, senha, aplicar, aviso = r.decidir_credenciais()
    assert (usuario, senha) == ("robo@exemplo.com", "senha-ficticia")
    assert aplicar is True
    assert aviso is None


def test_decidir_credenciais_sem_robo_cai_para_antiga_e_desliga_aplicar(monkeypatch):
    monkeypatch.delenv("MC_ROBO_USUARIO", raising=False)
    monkeypatch.delenv("MC_ROBO_SENHA", raising=False)
    monkeypatch.setenv("MC_USUARIO", "antigo@exemplo.com")
    monkeypatch.setenv("MC_SENHA", "senha-antiga-ficticia")
    monkeypatch.setenv("APLICAR", "1")  # ligado na variável, mas tem de ser desligado
    usuario, senha, aplicar, aviso = r.decidir_credenciais()
    assert (usuario, senha) == ("antigo@exemplo.com", "senha-antiga-ficticia")
    assert aplicar is False
    assert aviso and "MC_ROBO_USUARIO" in aviso


def test_decidir_credenciais_sem_nenhuma_credencial(monkeypatch):
    for var in ("MC_ROBO_USUARIO", "MC_ROBO_SENHA", "MC_USUARIO", "MC_SENHA", "APLICAR"):
        monkeypatch.delenv(var, raising=False)
    usuario, senha, aplicar, aviso = r.decidir_credenciais()
    assert usuario == "" and senha == ""
    assert aplicar is False
    assert aviso


def test_decidir_credenciais_robo_so_com_usuario_nao_conta(monkeypatch):
    # dado ausente/parcial não pode ser lido como "credencial presente" —
    # metade da credencial não loga em lugar nenhum.
    monkeypatch.setenv("MC_ROBO_USUARIO", "robo@exemplo.com")
    monkeypatch.delenv("MC_ROBO_SENHA", raising=False)
    monkeypatch.delenv("MC_USUARIO", raising=False)
    monkeypatch.delenv("MC_SENHA", raising=False)
    usuario, senha, aplicar, aviso = r.decidir_credenciais()
    assert usuario == "" and senha == ""
    assert aplicar is False


# ============================================================================
# Rodada 1 — consertos da revisão (tarefaA-review.md)
# ============================================================================

# ---- item 1 (CRÍTICO): comum.MC_USUARIO/SENHA, não os.environ -------------

def test_contas_via_playwright_troca_atributo_do_modulo_nao_so_o_ambiente(monkeypatch):
    """Prova do bug relatado: robo_mc_comum já leu MC_USUARIO/MC_SENHA do
    ambiente NO IMPORT. Se o conserto voltasse a só mexer em os.environ, o
    fake `login` abaixo veria a credencial ANTIGA do módulo, não a nova."""
    vistos = {}

    fake_comum = types.ModuleType("robo_mc_comum")
    fake_comum.MC_URL = "https://exemplo.invalido/login"
    fake_comum.MC_USUARIO = "usuario-antigo@exemplo.com"
    fake_comum.MC_SENHA = "senha-antiga-ficticia"

    class FakePage:
        def on(self, *a, **k):
            pass

    class FakeBrowser:
        def close(self):
            pass

    def fake_abrir(p):
        return FakeBrowser(), FakePage()

    def fake_login(page):
        vistos["usuario"] = fake_comum.MC_USUARIO
        vistos["senha"] = fake_comum.MC_SENHA

    fake_comum.abrir = fake_abrir
    fake_comum.login = fake_login

    class _CtxManager:
        def __enter__(self):
            return object()

        def __exit__(self, *a):
            return False

    fake_sync_api = types.ModuleType("playwright.sync_api")
    fake_sync_api.sync_playwright = lambda: _CtxManager()
    fake_playwright = types.ModuleType("playwright")
    fake_playwright.sync_api = fake_sync_api

    monkeypatch.setitem(sys.modules, "robo_mc_comum", fake_comum)
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_sync_api)
    monkeypatch.setattr(r, "_achar_no_storage", lambda page, script: "jwt-ficticio-123")
    monkeypatch.setattr(r, "listar_contas_playwright", lambda page, jwt, company: [])

    r._contas_via_playwright("usuario-novo@exemplo.com", "senha-nova-ficticia")

    assert vistos == {"usuario": "usuario-novo@exemplo.com", "senha": "senha-nova-ficticia"}


def test_contas_via_playwright_sem_mc_url_da_erro_claro_e_nao_abre_navegador(monkeypatch):
    fake_comum = types.ModuleType("robo_mc_comum")
    fake_comum.MC_URL = ""
    fake_comum.MC_USUARIO = ""
    fake_comum.MC_SENHA = ""

    def _nao_deveria_abrir():
        raise AssertionError("não deveria tentar abrir o navegador sem MC_URL")

    fake_sync_api = types.ModuleType("playwright.sync_api")
    fake_sync_api.sync_playwright = _nao_deveria_abrir
    fake_playwright = types.ModuleType("playwright")
    fake_playwright.sync_api = fake_sync_api

    monkeypatch.setitem(sys.modules, "robo_mc_comum", fake_comum)
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_sync_api)

    with pytest.raises(SystemExit, match="MC_URL"):
        r._contas_via_playwright("usuario@exemplo.com", "senha-ficticia")


# ---- item 2: database_id com hífen + renomeação em toda rodada ------------

def test_norm_id_ignora_hifen_e_caixa():
    assert r._norm_id("306c5ab5-32d3-812f-a14f-e9a281510128") == r._norm_id("306c5ab532d3812fa14fe9a281510128")


def test_garantir_relacao_normaliza_hifen_e_renomeia(monkeypatch):
    id_obras_com_hifen = "306c5ab5-32d3-812f-a14f-e9a281510128"
    assert r._norm_id(id_obras_com_hifen) == r._norm_id(r.ID_OBRAS)

    chamadas = []

    def fake_api(metodo, caminho, corpo=None):
        chamadas.append((metodo, caminho, corpo))
        if metodo == "GET" and caminho == f"/databases/{r.ID_OBRAS}":
            return {"properties": {r.COL_RELACAO_OBRAS: {"type": "relation"}}}  # já existe: não recria
        if metodo == "GET" and caminho == "/databases/banco-ficticio":
            return {"properties": {
                "Obras relacionadas": {"type": "relation", "relation": {"database_id": id_obras_com_hifen}},
            }}
        if metodo == "PATCH" and caminho == "/databases/banco-ficticio":
            return {}
        raise AssertionError(f"chamada inesperada: {metodo} {caminho}")

    monkeypatch.setattr(r, "api", fake_api)
    r.garantir_relacao("banco-ficticio")

    renomeacoes = [c for c in chamadas if c[0] == "PATCH"]
    assert len(renomeacoes) == 1
    assert renomeacoes[0][2]["properties"]["Obras relacionadas"]["name"] == "Obras"


def test_garantir_relacao_tenta_renomear_mesmo_quando_a_coluna_ja_existia(monkeypatch):
    # a coluna CONTA BANCÁRIA já existe (rodada anterior) e o lado de volta
    # ainda não se chama "Obras" — tem de tentar renomear DE NOVO, não só na
    # rodada em que a coluna nasceu.
    chamadas = []

    def fake_api(metodo, caminho, corpo=None):
        chamadas.append((metodo, caminho, corpo))
        if metodo == "GET" and caminho == f"/databases/{r.ID_OBRAS}":
            return {"properties": {r.COL_RELACAO_OBRAS: {"type": "relation"}}}
        if metodo == "GET" and caminho == "/databases/banco-ficticio":
            return {"properties": {
                "Related to OBRAS": {"type": "relation", "relation": {"database_id": r.ID_OBRAS}},
            }}
        if metodo == "PATCH" and caminho == "/databases/banco-ficticio":
            return {}
        raise AssertionError(f"chamada inesperada: {metodo} {caminho}")

    monkeypatch.setattr(r, "api", fake_api)
    r.garantir_relacao("banco-ficticio")

    assert not any(c[0] == "PATCH" and c[1] == f"/databases/{r.ID_OBRAS}" for c in chamadas)  # não recriou a coluna
    renomeacoes = [c for c in chamadas if c[0] == "PATCH" and c[1] == "/databases/banco-ficticio"]
    assert len(renomeacoes) == 1


def test_garantir_relacao_nao_renomeia_se_ja_e_obras(monkeypatch):
    def fake_api(metodo, caminho, corpo=None):
        if metodo == "GET" and caminho == f"/databases/{r.ID_OBRAS}":
            return {"properties": {r.COL_RELACAO_OBRAS: {"type": "relation"}}}
        if metodo == "GET" and caminho == "/databases/banco-ficticio":
            return {"properties": {"Obras": {"type": "relation", "relation": {"database_id": r.ID_OBRAS}}}}
        raise AssertionError(f"não deveria fazer PATCH: {metodo} {caminho}")

    monkeypatch.setattr(r, "api", fake_api)
    r.garantir_relacao("banco-ficticio")  # não levanta AssertionError = não tentou PATCH


# ---- item 5: trava contra ERP vazio ----------------------------------------

def test_planejar_com_erp_vazio_marcaria_tudo_como_sumiu_por_isso_o_main_aborta_antes():
    # documenta POR QUE a trava do item 5 tem de ficar em main() (antes de
    # achar_ou_criar_banco/planejar): planejar() em si não tem como saber
    # se "erp vazio" é sumiço real ou falha de leitura — quem decide isso é
    # quem chama, olhando a CONTAGEM antes de repassar para planejar().
    notion = [_pagina_notion(), _pagina_notion(page_id="p2", id_erp="e2")]
    plano = r.planejar([], notion, primeira_carga=False)
    assert len(plano["sumiu"]) == 2  # é exatamente isso que main() evita aplicar


# ---- item 7: procura o banco pelos blocos do pai, não pelo /search --------

def test_achar_filho_banco_pagina_pelos_blocos_nao_pelo_search(monkeypatch):
    chamadas = []
    paginas = {
        None: {"results": [{"type": "child_database", "id": "outro-banco-ficticio",
                            "child_database": {"title": "OUTRO BANCO"}}],
               "has_more": True, "next_cursor": "cursor-2"},
        "cursor-2": {"results": [{"type": "child_database", "id": "banco-contas-ficticio",
                                  "child_database": {"title": "CONTAS BANCÁRIAS"}}],
                     "has_more": False},
    }

    def fake_api(metodo, caminho, corpo=None):
        chamadas.append((metodo, caminho))
        assert metodo == "GET"
        assert caminho.startswith("/blocks/pai-ficticio/children")
        cursor = caminho.split("start_cursor=")[1] if "start_cursor=" in caminho else None
        return paginas[cursor]

    monkeypatch.setattr(r, "api", fake_api)
    achado = r._achar_filho_banco("pai-ficticio")

    assert achado == "banco-contas-ficticio"
    assert chamadas  # confirma que passou pelo fake, não pulou a checagem
    assert not any("/search" in caminho for _, caminho in chamadas)


def test_achar_filho_banco_nao_acha_devolve_none(monkeypatch):
    def fake_api(metodo, caminho, corpo=None):
        return {"results": [], "has_more": False}

    monkeypatch.setattr(r, "api", fake_api)
    assert r._achar_filho_banco("pai-ficticio") is None


# ---- item 6: 401/403/erro de rede na LISTAGEM também recuam ---------------

def test_listar_contas_api_401_vira_login_recusado(monkeypatch):
    import requests

    class FakeResp:
        status_code = 401

    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResp())
    with pytest.raises(r.LoginRecusado):
        r.listar_contas_api("jwt-ficticio", "company-ficticia")


def test_listar_contas_api_403_vira_login_recusado(monkeypatch):
    import requests

    class FakeResp:
        status_code = 403

    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResp())
    with pytest.raises(r.LoginRecusado):
        r.listar_contas_api("jwt-ficticio", "company-ficticia")


def test_listar_contas_api_erro_de_rede_vira_login_recusado(monkeypatch):
    import requests

    def _boom(*a, **k):
        raise requests.exceptions.ConnectionError("sem rede (ficticio)")

    monkeypatch.setattr(requests, "get", _boom)
    with pytest.raises(r.LoginRecusado):
        r.listar_contas_api("jwt-ficticio", "company-ficticia")


def test_login_api_403_vira_login_recusado(monkeypatch):
    import requests

    class FakeResp:
        status_code = 403

    monkeypatch.setattr(requests, "post", lambda *a, **k: FakeResp())
    with pytest.raises(r.LoginRecusado):
        r.login_api("usuario@exemplo.com", "senha-ficticia")


def test_login_api_erro_de_rede_vira_login_recusado(monkeypatch):
    import requests

    def _boom(*a, **k):
        raise requests.exceptions.Timeout("sem resposta (ficticio)")

    monkeypatch.setattr(requests, "post", _boom)
    with pytest.raises(r.LoginRecusado):
        r.login_api("usuario@exemplo.com", "senha-ficticia")


# ============================================================================
# I3 (revisão final) — primeira carga: conta nova só nasce marcada quando o
# banco já tem ao menos uma página com Aparece marcado E uma com ID ERP
# ============================================================================

def _pag(id_erp="e1", aparece=False):
    d = _pagina_notion(id_erp=id_erp)
    d["aparece"] = aparece
    return d


def test_decidir_primeira_carga_banco_criado_agora():
    assert r.decidir_primeira_carga(True, [_pag(aparece=True)]) is True


def test_decidir_primeira_carga_banco_vazio():
    assert r.decidir_primeira_carga(False, []) is True


def test_decidir_primeira_carga_interrompida_nenhuma_marcada():
    # 1ª gravação caiu no meio: há páginas, todas desmarcadas -> ainda é primeira carga
    assert r.decidir_primeira_carga(False, [_pag("e1"), _pag("e2")]) is True


def test_decidir_primeira_carga_pagina_manual_sem_id_erp():
    # página manual (sem ID ERP) marcada num banco sem conta do ERP -> primeira carga
    assert r.decidir_primeira_carga(False, [_pag(id_erp="", aparece=True)]) is True


def test_decidir_primeira_carga_dono_ja_marcou():
    assert r.decidir_primeira_carga(False, [_pag("e1", aparece=True), _pag("e2")]) is False


def test_notion_para_dict_le_aparece():
    pg = {"id": "p1", "properties": {
        "Conta": {"type": "title", "title": [{"plain_text": "CONTA MODELO"}]},
        "Aparece": {"type": "checkbox", "checkbox": True},
    }}
    assert r._notion_para_dict(pg)["aparece"] is True
    pg["properties"]["Aparece"]["checkbox"] = False
    assert r._notion_para_dict(pg)["aparece"] is False
    del pg["properties"]["Aparece"]
    assert r._notion_para_dict(pg)["aparece"] is False


# ============================================================================
# C1 (revisão final) — contrato do --ligar-antigas e teste de ORQUESTRAÇÃO
# (api / ler_banco / ERP falsos)
# ============================================================================

def _pagina_conta_notion(page_id, id_erp, nome, numero, banco="756", situacao="Ativa", aparece=True):
    def rt(v):
        return {"type": "rich_text", "rich_text": [{"plain_text": v}] if v else []}
    return {"id": page_id, "properties": {
        "Conta": {"type": "title", "title": [{"plain_text": nome}]},
        "Banco": rt(banco), "Agência": rt("1-2"), "Número": rt(numero), "ID ERP": rt(id_erp),
        "Aparece": {"type": "checkbox", "checkbox": aparece},
        "Situação no ERP": {"type": "select", "select": {"name": situacao}},
    }}


def _pagina_obra_antiga(page_id, texto_conta, relacao=None):
    return {"id": page_id, "properties": {
        "CONTA": {"type": "rich_text", "rich_text": [{"plain_text": texto_conta}] if texto_conta else []},
        "CONTA BANCÁRIA": {"type": "relation", "relation": [{"id": x} for x in (relacao or [])]},
    }}


def test_contas_para_casar_converte_contrato_e_tira_sumidas():
    notion = [_pagina_notion(page_id="p1", numero="1000-1"),
              _pagina_notion(page_id="p2", id_erp="e2", numero="2000-2", situacao="Sumiu do ERP")]
    assert r.contas_para_casar(notion) == [{"id": "p1", "numero": "1000-1", "banco": "756"}]


def test_ligar_obras_antigas_orquestracao(monkeypatch, capsys):
    contas_notion = [r._notion_para_dict(pg) for pg in [
        _pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1"),
        _pagina_conta_notion("pg-b", "e2", "CONTA MODELO B", "2000-2"),
        _pagina_conta_notion("pg-sumida", "e3", "CONTA MODELO C", "3000-3", situacao="Sumiu do ERP"),
    ]]
    obras = [
        _pagina_obra_antiga("obra-1", "BANCO MODELO - Conta corrente: 1000-1"),       # liga em pg-a
        _pagina_obra_antiga("obra-2", "BANCO MODELO - Conta corrente: 3000-3"),       # só a sumida: sem par
        _pagina_obra_antiga("obra-3", "BANCO MODELO - Conta corrente: 2000-2", ["ja"]),  # já ligada: pula
        _pagina_obra_antiga("obra-4", "PESSOA FISICA"),                              # pula
        _pagina_obra_antiga("obra-5", ""),                                           # pula
    ]
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: obras if db_id == r.ID_OBRAS else [])
    chamadas = []
    monkeypatch.setattr(r, "api", lambda metodo, caminho, corpo=None: chamadas.append((metodo, caminho, corpo)) or {})

    r.ligar_obras_antigas(contas_notion, aplicar=True)

    assert chamadas == [("PATCH", "/pages/obra-1",
                         {"properties": {"CONTA BANCÁRIA": {"relation": [{"id": "pg-a"}]}}})]
    saida = capsys.readouterr().out
    assert "1 ligadas, 1 sem par, 0 ambíguas" in saida
    assert "CONTA MODELO" not in saida and "1000-1" not in saida


def test_ligar_obras_antigas_simulacao_nao_grava(monkeypatch):
    contas_notion = [r._notion_para_dict(_pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1"))]
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra_antiga("obra-1", "Conta 1000-1")])
    chamadas = []
    monkeypatch.setattr(r, "api", lambda *a, **k: chamadas.append(a) or {})
    r.ligar_obras_antigas(contas_notion, aplicar=False)
    assert chamadas == []


def test_ligar_obras_antigas_conta_ambiguas(monkeypatch, capsys):
    contas_notion = [r._notion_para_dict(pg) for pg in [
        _pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1", banco="001"),
        _pagina_conta_notion("pg-b", "e2", "CONTA MODELO B", "1000-1", banco="104"),
    ]]
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra_antiga("obra-1", "Conta 1000-1")])
    monkeypatch.setattr(r, "api", lambda *a, **k: {})
    r.ligar_obras_antigas(contas_notion, aplicar=True)
    assert "0 ligadas, 0 sem par, 1 ambíguas" in capsys.readouterr().out


class _NotionFalso:
    """api/ler_banco falsos para o main: um banco de contas já existente e a
    base de obras; guarda toda gravação."""

    def __init__(self, paginas_contas, obras):
        self.paginas_contas = paginas_contas
        self.obras = obras
        self.gravacoes = []

    def api(self, metodo, caminho, corpo=None):
        if metodo != "GET":
            self.gravacoes.append((metodo, caminho, corpo))
        return {}

    def ler_banco(self, db_id, rotulo):
        if db_id == "banco-contas":
            return self.paginas_contas
        if db_id == r.ID_OBRAS:
            return self.obras
        raise AssertionError(f"ler_banco inesperado: {db_id}")


def _preparar_main(monkeypatch, notion, contas_erp, aplicar=True, argv=()):
    monkeypatch.setattr(r, "decidir_credenciais", lambda: ("robo@exemplo.com", "senha-ficticia", aplicar, None))
    monkeypatch.setattr(r, "contas_ativas_do_erp", lambda u, s: contas_erp)
    monkeypatch.setattr(r, "achar_ou_criar_banco", lambda aplicar: ("banco-contas", False))
    monkeypatch.setattr(r, "garantir_relacao", lambda db_id: None)
    monkeypatch.setattr(r, "api", notion.api)
    monkeypatch.setattr(r, "ler_banco", notion.ler_banco)
    monkeypatch.setattr(sys, "argv", ["robo_mc_contas.py", *argv])


def test_main_ligar_antigas_orquestracao_nao_quebra(monkeypatch):
    # é o caminho que quebrava com KeyError 'id' (C1)
    paginas = [_pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1")]
    obras = [_pagina_obra_antiga("obra-1", "BANCO MODELO - Conta corrente: 1000-1")]
    notion = _NotionFalso(paginas, obras)
    erp = [{"id": "e1", "nome": "CONTA MODELO A", "banco": "756", "agencia": "1-2", "numero": "1000-1"}]
    _preparar_main(monkeypatch, notion, erp, argv=["--ligar-antigas"])

    assert r.main() == 0
    assert ("PATCH", "/pages/obra-1",
            {"properties": {"CONTA BANCÁRIA": {"relation": [{"id": "pg-a"}]}}}) in notion.gravacoes


def test_main_conta_nova_nasce_desmarcada_quando_ninguem_marcou_ainda(monkeypatch):
    # primeira carga interrompida: já há página do ERP, nenhuma marcada
    paginas = [_pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1", aparece=False)]
    notion = _NotionFalso(paginas, [])
    erp = [{"id": "e1", "nome": "CONTA MODELO A", "banco": "756", "agencia": "1-2", "numero": "1000-1"},
           {"id": "e2", "nome": "CONTA MODELO B", "banco": "756", "agencia": "1-2", "numero": "2000-2"}]
    _preparar_main(monkeypatch, notion, erp)

    assert r.main() == 0
    criadas = [c for m, cam, c in notion.gravacoes if m == "POST" and cam == "/pages"]
    assert len(criadas) == 1
    assert criadas[0]["properties"]["Aparece"] == {"checkbox": False}


def test_main_conta_nova_nasce_marcada_depois_que_o_dono_marcou(monkeypatch):
    paginas = [_pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1", aparece=True)]
    notion = _NotionFalso(paginas, [])
    erp = [{"id": "e1", "nome": "CONTA MODELO A", "banco": "756", "agencia": "1-2", "numero": "1000-1"},
           {"id": "e2", "nome": "CONTA MODELO B", "banco": "756", "agencia": "1-2", "numero": "2000-2"}]
    _preparar_main(monkeypatch, notion, erp)

    assert r.main() == 0
    criadas = [c for m, cam, c in notion.gravacoes if m == "POST" and cam == "/pages"]
    assert len(criadas) == 1
    assert criadas[0]["properties"]["Aparece"] == {"checkbox": True}


def test_main_sem_aplicar_nao_grava_nada(monkeypatch):
    paginas = [_pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1")]
    obras = [_pagina_obra_antiga("obra-1", "Conta 1000-1")]
    notion = _NotionFalso(paginas, obras)
    erp = [{"id": "e2", "nome": "CONTA MODELO B", "banco": "756", "agencia": "1-2", "numero": "2000-2"}]
    _preparar_main(monkeypatch, notion, erp, aplicar=False, argv=["--ligar-antigas"])

    assert r.main() == 0
    assert notion.gravacoes == []


def test_main_erp_vazio_aborta_sem_tocar_no_notion(monkeypatch):
    notion = _NotionFalso([_pagina_conta_notion("pg-a", "e1", "CONTA MODELO A", "1000-1")], [])
    _preparar_main(monkeypatch, notion, [])
    assert r.main() == 1
    assert notion.gravacoes == []
