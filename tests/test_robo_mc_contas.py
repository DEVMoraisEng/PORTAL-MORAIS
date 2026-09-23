# -*- coding: utf-8 -*-
"""Testes das funções puras de robo_mc_contas.py (T1) — sem rede, sem
playwright. Dados fictícios só ("BANCO MODELO 1234-5"), como manda o repo
público."""
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
