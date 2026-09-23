# -*- coding: utf-8 -*-
"""Testes das funções puras de robo_mc_obras.py — sem rede, sem Playwright de
verdade (só `monkeypatch` nas funções que fariam a chamada). Dados fictícios
só ("BANCO MODELO 1234-5", "CONTA MODELO"), como manda o repo público.

Cobre a tarefaB/T4: leitura da relação CONTA BANCÁRIA -> nome exato da conta
(id_relacionado, mapa_contas_por_id, fila_de_obras/fila_atualizar) e a regra
de não marcar "Criada" quando havia conta pedida e ela não foi escolhida
(preencher_conta, criar_no_mc)."""
import robo_mc_obras as r


# ============================================================================
# id_relacionado
# ============================================================================

def test_id_relacionado_prop_relation_com_item():
    prop = {"type": "relation", "relation": [{"id": "pagina-conta-1"}]}
    assert r.id_relacionado(prop) == "pagina-conta-1"


def test_id_relacionado_prop_relation_vazia():
    prop = {"type": "relation", "relation": []}
    assert r.id_relacionado(prop) == ""


def test_id_relacionado_prop_none():
    assert r.id_relacionado(None) == ""


def test_id_relacionado_prop_de_outro_tipo_devolve_vazio():
    # confirma que txt() mesmo NÃO lendo relation não é usado aqui por engano
    prop = {"type": "rich_text", "rich_text": [{"plain_text": "não é relação"}]}
    assert r.id_relacionado(prop) == ""


def test_id_relacionado_so_o_primeiro_id():
    prop = {"type": "relation", "relation": [{"id": "primeira"}, {"id": "segunda"}]}
    assert r.id_relacionado(prop) == "primeira"


# ============================================================================
# mapa_contas_por_id — reaproveita rc._achar_filho_banco (robo_mc_contas)
# ============================================================================

def test_mapa_contas_por_id_sem_pai_devolve_vazio(monkeypatch):
    monkeypatch.setattr(r, "api", lambda metodo, caminho, corpo=None: {"parent": {}})
    assert r.mapa_contas_por_id() == {}


def test_mapa_contas_por_id_banco_nao_existe_devolve_vazio(monkeypatch):
    monkeypatch.setattr(r, "api", lambda metodo, caminho, corpo=None: {"parent": {"page_id": "pai-ficticio"}})
    monkeypatch.setattr(r.rc, "_achar_filho_banco", lambda pai: None)
    assert r.mapa_contas_por_id() == {}


def test_mapa_contas_por_id_monta_id_pagina_para_nome(monkeypatch):
    monkeypatch.setattr(r, "api", lambda metodo, caminho, corpo=None: {"parent": {"page_id": "pai-ficticio"}})
    monkeypatch.setattr(r.rc, "_achar_filho_banco", lambda pai: "banco-contas-ficticio")

    paginas = [
        {"id": "pg-1", "properties": {"Conta": {"type": "title", "title": [{"plain_text": "CONTA MODELO 1234-5"}]}}},
        {"id": "pg-2", "properties": {"Conta": {"type": "title", "title": [{"plain_text": "CONTA MODELO 2 9999-0"}]}}},
        # sem título -> não entra no mapa
        {"id": "pg-3", "properties": {"Conta": {"type": "title", "title": []}}},
    ]
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: paginas)

    mapa = r.mapa_contas_por_id()
    assert mapa == {"pg-1": "CONTA MODELO 1234-5", "pg-2": "CONTA MODELO 2 9999-0"}


# ============================================================================
# fila_de_obras / fila_atualizar — conta_exata pelo mapa
# ============================================================================

def _pagina_obra(id_="obra-1", mais_controle="Criar", status="Em andamento",
                  conta_id=None, conta_texto="", titulo="RUA MODELO QD 1 LT 2",
                  last_edited="2026-09-01T00:00:00.000Z"):
    props = {
        "MAIS CONTROLE": {"type": "select", "select": {"name": mais_controle}},
        "Status": {"type": "select", "select": {"name": status}},
        "Projeto": {"type": "title", "title": [{"plain_text": titulo}]},
        "Nº DE CASAS": {"type": "number", "number": 1},
        "ÁREA CONSTRUÍDA AVERBADA": {"type": "number", "number": 100},
        "ÁREA PÓS HABITE-SE": {"type": "number", "number": None},
        "ENGENHEIRO RT": {"type": "rich_text", "rich_text": [{"plain_text": "ENGENHEIRO MODELO"}]},
        "Responsável Pela Obra": {"type": "rich_text", "rich_text": [{"plain_text": "RESPONSAVEL MODELO"}]},
        "Proprietário": {"type": "rich_text", "rich_text": [{"plain_text": "CLIENTE MODELO"}]},
        "Cidade": {"type": "rich_text", "rich_text": [{"plain_text": "CIDADE MODELO"}]},
        "CONTA": {"type": "rich_text", "rich_text": [{"plain_text": conta_texto}]},
        "CONTA BANCÁRIA": {"type": "relation", "relation": ([{"id": conta_id}] if conta_id else [])},
    }
    return {"id": id_, "properties": props, "last_edited_time": last_edited}


def test_fila_de_obras_sem_relacao_conta_exata_fica_vazia(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_texto="TEXTO LIVRE DA CONTA")])
    fila = r.fila_de_obras(mapa_contas={"pg-x": "CONTA MODELO X"})
    assert len(fila) == 1
    assert fila[0]["conta_exata"] == ""
    assert fila[0]["conta"] == "TEXTO LIVRE DA CONTA"


def test_fila_de_obras_com_relacao_preenche_conta_exata_pelo_mapa(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_id="pg-conta-1")])
    fila = r.fila_de_obras(mapa_contas={"pg-conta-1": "CONTA MODELO 1234-5"})
    assert fila[0]["conta_exata"] == "CONTA MODELO 1234-5"


def test_fila_de_obras_relacao_apontando_para_pagina_fora_do_mapa_fica_vazia(monkeypatch):
    # a página relacionada não está (ainda) no mapa — não inventa nome
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_id="pg-desconhecida")])
    fila = r.fila_de_obras(mapa_contas={"pg-conta-1": "CONTA MODELO 1234-5"})
    assert fila[0]["conta_exata"] == ""


def test_fila_de_obras_sem_mapa_contas_nao_quebra(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_id="pg-conta-1")])
    fila = r.fila_de_obras()  # mapa_contas=None
    assert fila[0]["conta_exata"] == ""


def test_fila_de_obras_ignora_pagina_sem_mais_controle_criar(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(mais_controle="Criada")])
    assert r.fila_de_obras() == []


def test_fila_atualizar_com_relacao_preenche_conta_exata(monkeypatch):
    # padronizar_endereco preenche zero à esquerda em QD/LT — o título tem de
    # bater com o que "fila_atualizar" compara (o mesmo padronizado)
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(titulo="RUA MODELO QD 1 LT 2", conta_id="pg-conta-1")])
    fila = r.fila_atualizar({"RUA MODELO QD 01 LT 02"}, mapa_contas={"pg-conta-1": "CONTA MODELO 1234-5"})
    assert len(fila) == 1
    assert fila[0]["conta_exata"] == "CONTA MODELO 1234-5"


# ============================================================================
# preencher_conta — devolve False só quando havia conta PEDIDA e não escolhida
# ============================================================================

class _PageFake:
    """Só o suficiente para as chamadas de `escolher_na_lista`/`escrever` que
    `preencher_conta` faz por cima (elas mesmas são substituídas abaixo)."""


def test_preencher_conta_sem_pedido_nenhum_devolve_true(monkeypatch):
    monkeypatch.setattr(r, "escolher_na_lista", lambda *a, **k: "Cliente")
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": ""})
    assert ok is True


def test_preencher_conta_pessoa_fisica_nao_conta_como_pedido(monkeypatch):
    monkeypatch.setattr(r, "escolher_na_lista", lambda *a, **k: "Cliente")
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "PESSOA FISICA"})
    assert ok is True


def test_preencher_conta_relacao_escolhida_com_sucesso(monkeypatch):
    vistos = {}

    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False):
        if campo_sel == r.CAMPO["conta"]:
            vistos["chamado"] = (texto_busca, alvo, exato)
        return alvo or texto_busca

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO 1234-5", "conta": "texto qualquer"})
    assert ok is True
    # a relação usa igualdade EXATA — nunca o texto livre de CONTA como busca
    assert vistos["chamado"] == ("CONTA MODELO 1234-5", "CONTA MODELO 1234-5", True)


def test_preencher_conta_relacao_pedida_e_nao_escolhida_devolve_false(monkeypatch):
    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False):
        if campo_sel == r.CAMPO["conta"]:
            raise RuntimeError("não apareceu na lista (fictício)")
        return "Cliente"

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO 1234-5", "conta": ""})
    assert ok is False


def test_preencher_conta_texto_livre_pedido_e_nao_escolhido_devolve_false(monkeypatch):
    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False):
        if campo_sel == r.CAMPO["conta"]:
            raise RuntimeError("não apareceu na lista (fictício)")
        return "Cliente"

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "BANCO MODELO - Conta corrente: 1234-5"})
    assert ok is False


def test_preencher_conta_texto_livre_escolhido_com_sucesso(monkeypatch):
    monkeypatch.setattr(r, "escolher_na_lista", lambda *a, **k: "CONTA MODELO 1234-5")
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "BANCO MODELO - Conta corrente: 1234-5"})
    assert ok is True


def test_preencher_conta_relacao_tem_prioridade_sobre_texto(monkeypatch):
    # com conta_exata preenchida, nunca cai no caminho do texto livre — se
    # caísse, a busca por pedaço de "conta" apareceria em vistos também
    chamadas_conta = []

    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False):
        if campo_sel == r.CAMPO["conta"]:
            chamadas_conta.append(texto_busca)
        return alvo or texto_busca

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO 1234-5", "conta": "outro texto qualquer"})
    assert chamadas_conta == ["CONTA MODELO 1234-5"]
