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
        {"id": "pg-1", "properties": {"Conta": {"type": "title", "title": [{"plain_text": "CONTA MODELO 1234-5"}]},
                                      "Número": {"type": "rich_text", "rich_text": [{"plain_text": "1234-5"}]}}},
        {"id": "pg-2", "properties": {"Conta": {"type": "title", "title": [{"plain_text": "CONTA MODELO 2 9999-0"}]}}},
        # sem título -> não entra no mapa
        {"id": "pg-3", "properties": {"Conta": {"type": "title", "title": []}}},
    ]
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: paginas)

    mapa = r.mapa_contas_por_id()
    assert mapa == {"pg-1": {"nome": "CONTA MODELO 1234-5", "numero": "1234-5"},
                    "pg-2": {"nome": "CONTA MODELO 2 9999-0", "numero": ""}}


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
    fila = r.fila_de_obras(mapa_contas={"pg-x": {"nome": "CONTA MODELO X", "numero": ""}})
    assert len(fila) == 1
    assert fila[0]["conta_exata"] == ""
    assert fila[0]["conta"] == "TEXTO LIVRE DA CONTA"


def test_fila_de_obras_com_relacao_preenche_conta_exata_pelo_mapa(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_id="pg-conta-1")])
    fila = r.fila_de_obras(mapa_contas={"pg-conta-1": {"nome": "CONTA MODELO 1234-5", "numero": "1234-5"}})
    assert fila[0]["conta_exata"] == "CONTA MODELO 1234-5"
    assert fila[0]["conta_numero"] == "1234-5"
    assert fila[0]["conta_nao_resolvida"] is False


def test_fila_de_obras_relacao_apontando_para_pagina_fora_do_mapa_fica_vazia(monkeypatch):
    # a página relacionada não está (ainda) no mapa — não inventa nome, e a
    # obra fica como "conta pedida e não resolvida" (I1 da revisão final)
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_id="pg-desconhecida")])
    fila = r.fila_de_obras(mapa_contas={"pg-conta-1": {"nome": "CONTA MODELO 1234-5", "numero": ""}})
    assert fila[0]["conta_exata"] == ""
    assert fila[0]["conta_nao_resolvida"] is True
    assert r.tem_conta_pedida(fila[0]) is True


def test_fila_de_obras_sem_mapa_contas_nao_quebra(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(conta_id="pg-conta-1")])
    fila = r.fila_de_obras()  # mapa_contas=None
    assert fila[0]["conta_exata"] == ""
    # relação existe, mas sem mapa não se resolve: conta pedida, não resolvida
    assert fila[0]["conta_nao_resolvida"] is True


def test_fila_de_obras_ignora_pagina_sem_mais_controle_criar(monkeypatch):
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(mais_controle="Criada")])
    assert r.fila_de_obras() == []


def test_fila_atualizar_com_relacao_preenche_conta_exata(monkeypatch):
    # padronizar_endereco preenche zero à esquerda em QD/LT — o título tem de
    # bater com o que "fila_atualizar" compara (o mesmo padronizado)
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [_pagina_obra(titulo="RUA MODELO QD 1 LT 2", conta_id="pg-conta-1")])
    fila = r.fila_atualizar({"RUA MODELO QD 01 LT 02"}, mapa_contas={"pg-conta-1": {"nome": "CONTA MODELO 1234-5", "numero": "1234-5"}})
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

    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            vistos["chamado"] = (texto_busca, alvo, prefixo, sigilo)
        return alvo or texto_busca

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO 1234-5", "conta": "texto qualquer"})
    assert ok is True
    # a relação busca por PEDAÇO (tentativas_busca), escolhe por prefixo, e
    # nunca imprime nome de conta (sigilo=True) — nunca a linha inteira, e
    # nunca o texto livre de CONTA como busca
    texto_busca, alvo, prefixo, sigilo = vistos["chamado"]
    assert texto_busca in r.tentativas_busca("CONTA MODELO 1234-5")
    assert alvo == "CONTA MODELO 1234-5"
    assert prefixo is True
    assert sigilo is True


def test_preencher_conta_relacao_pedida_e_nao_escolhida_devolve_false(monkeypatch):
    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            raise RuntimeError("não apareceu na lista (fictício)")
        return "Cliente"

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO 1234-5", "conta": ""})
    assert ok is False


def test_preencher_conta_relacao_pedida_e_nao_escolhida_nao_imprime_nome(monkeypatch, capsys):
    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            raise RuntimeError("não apareceu na lista (fictício)")
        return "Cliente"

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    r.preencher_conta(_PageFake(), {"conta_exata": "CONTA SIGILOSA 1234-5", "conta": ""})
    saida = capsys.readouterr().out
    assert "CONTA SIGILOSA" not in saida
    assert "1234-5" not in saida


def test_preencher_conta_texto_livre_pedido_e_nao_escolhido_devolve_false(monkeypatch):
    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            raise RuntimeError("não apareceu na lista (fictício)")
        return "Cliente"

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "BANCO MODELO - Conta corrente: 1234-5"})
    assert ok is False


def test_preencher_conta_texto_livre_pedido_e_nao_escolhido_nao_imprime_nome(monkeypatch, capsys):
    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            raise RuntimeError("não apareceu na lista (fictício)")
        return "Cliente"

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "BANCO SIGILOSO - Conta corrente: 1234-5"})
    saida = capsys.readouterr().out
    assert "BANCO SIGILOSO" not in saida
    assert "1234-5" not in saida


def test_preencher_conta_texto_livre_escolhido_com_sucesso(monkeypatch):
    monkeypatch.setattr(r, "escolher_na_lista", lambda *a, **k: "CONTA MODELO 1234-5")
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "BANCO MODELO - Conta corrente: 1234-5"})
    assert ok is True


def test_preencher_conta_texto_livre_escolhido_nao_imprime_nome(monkeypatch, capsys):
    monkeypatch.setattr(r, "escolher_na_lista", lambda *a, **k: "CONTA SIGILOSA 1234-5")
    r.preencher_conta(_PageFake(), {"conta_exata": "", "conta": "BANCO SIGILOSO - Conta corrente: 1234-5"})
    saida = capsys.readouterr().out
    assert "CONTA SIGILOSA" not in saida
    assert "BANCO SIGILOSO" not in saida


def test_preencher_conta_relacao_tem_prioridade_sobre_texto(monkeypatch):
    # com conta_exata preenchida, nunca cai no caminho do texto livre — se
    # caísse, a busca por pedaço de "conta" apareceria em vistos também
    chamadas_conta = []

    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            chamadas_conta.append(texto_busca)
        return alvo or texto_busca

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO 1234-5", "conta": "outro texto qualquer"})
    assert chamadas_conta == [r.tentativas_busca("CONTA MODELO 1234-5")[0]]


# ============================================================================
# tem_conta_pedida / tentativas_busca (funções puras)
# ============================================================================

def test_tem_conta_pedida_com_relacao():
    assert r.tem_conta_pedida({"conta_exata": "CONTA MODELO 1234-5", "conta": ""}) is True


def test_tem_conta_pedida_com_texto_livre():
    assert r.tem_conta_pedida({"conta_exata": "", "conta": "BANCO MODELO - Conta corrente: 1234-5"}) is True


def test_tem_conta_pedida_pessoa_fisica_nao_conta():
    assert r.tem_conta_pedida({"conta_exata": "", "conta": "PESSOA FISICA"}) is False
    assert r.tem_conta_pedida({"conta_exata": "", "conta": "pessoa fisica"}) is False


def test_tem_conta_pedida_nada_pedido():
    assert r.tem_conta_pedida({"conta_exata": "", "conta": ""}) is False
    assert r.tem_conta_pedida({}) is False


def test_tentativas_busca_pedaco_do_nome():
    tentativas = r.tentativas_busca("BANCO MODELO INCORPORACOES CENTRO - Conta corrente: 1234-5")
    assert tentativas[0] == "BANCO MODELO INCORPORA"       # até " - ", cortado em 22 caracteres
    assert "1234-5" not in tentativas[0]                    # não é a linha inteira


def test_tentativas_busca_vazio():
    assert r.tentativas_busca("") == []
    assert r.tentativas_busca(None) == []


def test_tentativas_busca_sem_repetir():
    # nome curto: as 3 regras (até " - ", 2 palavras, 1ª palavra) podem dar
    # o mesmo texto — não repete tentativa
    tentativas = r.tentativas_busca("CONTA MODELO")
    assert len(tentativas) == len(set(tentativas))


# ============================================================================
# escolha_por_prefixo (função pura) — item 3 da revisão
# ============================================================================

def test_escolha_por_prefixo_igualdade_exata():
    textos = ["CONTA MODELO 1234-5", "OUTRA CONTA"]
    assert r.escolha_por_prefixo(textos, "CONTA MODELO 1234-5") == 0


def test_escolha_por_prefixo_opcao_comeca_com_o_alvo():
    # a opção do combo mostra mais do que o nome pedido (ex. agência/número
    # numa segunda linha, ou sufixo do banco)
    textos = ["CONTA MODELO 1234-5 - AG 100", "OUTRA CONTA"]
    assert r.escolha_por_prefixo(textos, "CONTA MODELO 1234-5") == 0


def test_escolha_por_prefixo_nao_aceita_opcao_mais_curta_que_o_nome():
    # I2 da revisão final: a direção reversa (nome pedido começa com a
    # opção) foi removida — a opção "mãe" não serve para a conta "filha"
    textos = ["CONTA MODELO", "OUTRA CONTA"]
    assert r.escolha_por_prefixo(textos, "CONTA MODELO 1234-5") is None


def test_escolha_por_prefixo_duas_candidatas_falha_sem_chutar():
    # NUNCA "a mais parecida" — com 2+ candidatas, devolve None
    textos = ["CONTA MODELO 1234-5 - AG 100", "CONTA MODELO 1234-5 - AG 200"]
    assert r.escolha_por_prefixo(textos, "CONTA MODELO 1234-5") is None


def test_escolha_por_prefixo_nenhuma_candidata():
    textos = ["OUTRA CONTA", "MAIS OUTRA"]
    assert r.escolha_por_prefixo(textos, "CONTA MODELO 1234-5") is None


def test_escolha_por_prefixo_alvo_vazio():
    assert r.escolha_por_prefixo(["QUALQUER COISA"], "") is None
    assert r.escolha_por_prefixo(["QUALQUER COISA"], None) is None


def test_escolha_por_prefixo_ignora_acento_e_caixa():
    textos = ["Conta Modêlo 1234-5"]
    assert r.escolha_por_prefixo(textos, "conta modelo 1234-5") == 0


def test_escolha_por_prefixo_ignora_opcao_em_branco_do_combo():
    # Rodada 2: combo real costuma ter uma opção vazia/placeholder ("",
    # "SELECIONE"); sem ignorá-la, `alvo_n.startswith(N(""))` bate sempre
    # (prefixo vazio), viraria "duas candidatas" e a escolha certa falharia
    textos = ["", "SELECIONE", "CONTA MODELO - Conta corrente: 1234-5"]
    assert r.escolha_por_prefixo(textos, "CONTA MODELO") == 2


# ============================================================================
# criar_no_mc / completar_no_mc — não marcam "pronta" quando a conta pedida
# não foi escolhida (item 2 da revisão: a garantia não pode se desfazer na
# rodada seguinte). Fakes genéricos para o `page` do Playwright: todas as
# funções de módulo que criar_no_mc/completar_no_mc chamam por cima (que já
# têm teste próprio, ou dependem do DOM de verdade) são substituídas; só o
# que decide o RESULTADO (preencher_conta, APLICAR) fica sob controle do
# teste.
# ============================================================================

class _AnyLocator:
    """Aceita qualquer chamada/atributo e sempre devolve a si mesmo — o
    suficiente para as cadeias `page.locator(...).filter(...).last.click()`
    etc. que criar_no_mc/completar_no_mc fazem fora dos pontos que este
    teste controla."""

    def __getattr__(self, nome):
        return self

    def __call__(self, *a, **k):
        return self


class _FakePageSalva:
    def __init__(self):
        self._rede = []

    def locator(self, *a, **k):
        return _AnyLocator()

    def wait_for_timeout(self, *a, **k):
        pass

    def wait_for_url(self, *a, **k):
        pass  # não levanta -> "fechou" (o MC salvou e trocou de rota)

    def evaluate(self, *a, **k):
        return ""

    @property
    def keyboard(self):
        return _AnyLocator()


def _obra_ficticia(**over):
    o = {
        "id": "obra-1", "titulo": "RUA MODELO QD 01 LT 02", "casas": 1, "area": 100.0,
        "rt": "ENGENHEIRO MODELO", "resp": "RESPONSAVEL MODELO", "cliente": "CLIENTE MODELO",
        "cidade": "CIDADE MODELO", "conta": "", "conta_exata": "CONTA MODELO 1234-5",
    }
    o.update(over)
    return o


def _silenciar_apoios_criar_no_mc(monkeypatch):
    for nome, valor in [
        ("ir_lista_obras", lambda page: None),
        ("ja_existe_no_mc", lambda page, titulo: False),
        ("clicar_texto", lambda page, texto, exato=True, timeout=8000: None),
        ("escrever", lambda page, sel, valor: str(valor)),
        ("ajustar_visiveis", lambda page, resp: None),
        ("abrir_secao", lambda page, titulo: None),
        ("fechar_replicar", lambda page: None),
        ("preencher_endereco", lambda page, o: None),
        ("desmarcar_compras", lambda page: None),
        ("foto", lambda page, nome, sensivel=False: None),
    ]:
        monkeypatch.setattr(r, nome, valor)
    # escolher_na_lista: só é chamado aqui para "tipo" e "cliente" — devolve
    # o alvo pedido, sem abrir lista de verdade
    monkeypatch.setattr(r, "escolher_na_lista", lambda page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero="": alvo or texto_busca)


def test_criar_no_mc_com_conta_escolhida_devolve_criada(monkeypatch):
    _silenciar_apoios_criar_no_mc(monkeypatch)
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: True)
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.criar_no_mc(_FakePageSalva(), _obra_ficticia())
    assert resultado == "criada"


def test_criar_no_mc_com_conta_pedida_e_nao_escolhida_nao_marca_criada(monkeypatch):
    _silenciar_apoios_criar_no_mc(monkeypatch)
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: False)
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.criar_no_mc(_FakePageSalva(), _obra_ficticia())
    assert resultado == "criada_sem_conta"
    assert resultado != "criada"  # main() só marca "Criada" para "criada"/"ja_existe"


def test_criar_no_mc_criada_sem_conta_nao_imprime_nome(monkeypatch, capsys):
    _silenciar_apoios_criar_no_mc(monkeypatch)
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: False)
    monkeypatch.setattr(r, "APLICAR", True)
    r.criar_no_mc(_FakePageSalva(), _obra_ficticia(conta_exata="CONTA BEM SIGILOSA 9999-9"))
    saida = capsys.readouterr().out
    assert "CONTA BEM SIGILOSA" not in saida
    assert "9999-9" not in saida


def _silenciar_apoios_completar_no_mc(monkeypatch, valor_conta=""):
    monkeypatch.setattr(r, "abrir_edicao", lambda page, titulo: None)
    monkeypatch.setattr(r, "abrir_secao", lambda page, titulo: None)
    monkeypatch.setattr(r, "escrever", lambda page, sel, valor: str(valor))
    monkeypatch.setattr(r, "fechar_replicar", lambda page: None)
    monkeypatch.setattr(r, "preencher_endereco", lambda page, o: None)
    monkeypatch.setattr(r, "foto", lambda page, nome, sensivel=False: None)
    monkeypatch.setattr(r, "escolher_na_lista", lambda page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero="": alvo or texto_busca)

    def fake_valor_campo(page, sel):
        return "" if sel == r.CAMPO["conta"] else "já preenchido no MC"

    monkeypatch.setattr(r, "valor_campo", fake_valor_campo)


def test_completar_no_mc_conta_pedida_nao_escolhida_nao_marca_completada(monkeypatch):
    # só a conta está pendente — nada mais muda: sem preencher_conta=True,
    # main() não deve chamar marcar_conferida (só faz isso para "completada"
    # e "nada a completar")
    _silenciar_apoios_completar_no_mc(monkeypatch)
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: False)
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.completar_no_mc(_FakePageSalva(), _obra_ficticia())
    assert resultado == "conta não escolhida"
    assert resultado not in ("completada", "nada a completar")


def test_completar_no_mc_conta_escolhida_conta_como_mudanca(monkeypatch):
    _silenciar_apoios_completar_no_mc(monkeypatch)
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: True)
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.completar_no_mc(_FakePageSalva(), _obra_ficticia())
    assert resultado == "completada"


def test_completar_no_mc_sem_conta_pedida_nao_chama_preencher_conta(monkeypatch):
    # obra sem relação e sem texto de CONTA: preencher_conta nem deveria
    # rodar (tem_conta_pedida = False)
    _silenciar_apoios_completar_no_mc(monkeypatch)
    chamou = []
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: chamou.append(1) or True)
    monkeypatch.setattr(r, "APLICAR", True)
    r.completar_no_mc(_FakePageSalva(), _obra_ficticia(conta_exata="", conta=""))
    assert chamou == []


def test_completar_no_mc_erro_ao_preencher_conta_tambem_nao_marca_completada(monkeypatch):
    # exceção dentro do bloco de conta (defensivo — preencher_conta não deve
    # levantar de verdade, mas o robô não pode confiar nisso) também conta
    # como conta pendente, não como sucesso silencioso
    _silenciar_apoios_completar_no_mc(monkeypatch)

    def fake_preencher_conta(page, o):
        raise RuntimeError("erro fictício")

    monkeypatch.setattr(r, "preencher_conta", fake_preencher_conta)
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.completar_no_mc(_FakePageSalva(), _obra_ficticia())
    assert resultado == "conta não escolhida"


# ============================================================================
# I2 (revisão final) — nomes parecidos, nos dois sentidos
# ============================================================================

def test_escolha_por_prefixo_nome_curto_nao_pega_conta_com_outra_palavra():
    # pedido "EMPRESA MODELO", só aparece "EMPRESA MODELO SPE 2" -> não escolhe
    assert r.escolha_por_prefixo(["EMPRESA MODELO SPE 2"], "EMPRESA MODELO") is None


def test_escolha_por_prefixo_nome_longo_nao_pega_conta_mae():
    # pedido "EMPRESA MODELO SPE 2", só aparece "EMPRESA MODELO" -> não escolhe
    assert r.escolha_por_prefixo(["EMPRESA MODELO"], "EMPRESA MODELO SPE 2") is None


def test_escolha_por_prefixo_as_duas_na_lista_escolhe_a_igual():
    textos = ["EMPRESA MODELO", "EMPRESA MODELO SPE 2"]
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO") == 0
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO SPE 2") == 1


def test_escolha_por_prefixo_nome_com_sufixo_de_separador_passa():
    for textos in (["EMPRESA MODELO - Conta corrente: 1234-5"],
                   ["EMPRESA MODELO \u2013 Conta corrente: 1234-5"],
                   ["EMPRESA MODELO (BANCO MODELO)"]):
        assert r.escolha_por_prefixo(textos, "EMPRESA MODELO") == 0, textos


def test_escolha_por_prefixo_parecida_com_separador_mas_outro_nome_nao_passa():
    # "EMPRESA MODELO SPE 2 - ..." começa com "EMPRESA MODELO" seguido de
    # " S" (outra palavra), não de separador
    assert r.escolha_por_prefixo(["EMPRESA MODELO SPE 2 - Conta corrente: 1234-5"], "EMPRESA MODELO") is None


def test_escolha_por_prefixo_confere_numero_quando_opcao_tem_digitos():
    textos = ["EMPRESA MODELO - Conta corrente: 9999-0"]
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO", numero="1234-5") is None
    textos = ["EMPRESA MODELO - Conta corrente: 1234-5"]
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO", numero="1234-5") == 0


def test_escolha_por_prefixo_numero_desempata_duas_com_separador():
    textos = ["EMPRESA MODELO - Conta corrente: 9999-0", "EMPRESA MODELO - Conta corrente: 1234-5"]
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO") is None       # sem número: 2 candidatas
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO", numero="1234-5") == 1


def test_escolha_por_prefixo_opcao_sem_digitos_nao_exige_numero():
    textos = ["EMPRESA MODELO (BANCO MODELO)"]
    assert r.escolha_por_prefixo(textos, "EMPRESA MODELO", numero="1234-5") == 0


def test_preencher_conta_passa_numero_do_banco_de_contas(monkeypatch):
    vistos = []

    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            vistos.append(numero)
        return alvo or texto_busca

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    r.preencher_conta(_PageFake(), {"conta_exata": "CONTA MODELO", "conta_numero": "1234-5", "conta": ""})
    assert vistos == ["1234-5"]


# ============================================================================
# I1 (revisão final) — relação que não se resolve = conta pedida e não resolvida
# ============================================================================

def test_resolver_conta_sem_relacao():
    assert r.resolver_conta({"type": "relation", "relation": []}, {}) == ("", "", False)
    assert r.resolver_conta(None, {}) == ("", "", False)


def test_resolver_conta_uma_no_mapa():
    mapa = {"pg-1": {"nome": "CONTA MODELO", "numero": "1234-5"}}
    prop = {"type": "relation", "relation": [{"id": "pg-1"}]}
    assert r.resolver_conta(prop, mapa) == ("CONTA MODELO", "1234-5", False)


def test_resolver_conta_fora_do_mapa():
    prop = {"type": "relation", "relation": [{"id": "pg-sumida"}]}
    assert r.resolver_conta(prop, {"pg-1": {"nome": "CONTA MODELO", "numero": ""}}) == ("", "", True)


def test_resolver_conta_titulo_vazio_no_mapa():
    prop = {"type": "relation", "relation": [{"id": "pg-1"}]}
    assert r.resolver_conta(prop, {"pg-1": {"nome": "", "numero": "1234-5"}}) == ("", "", True)


def test_resolver_conta_mais_de_uma_conta_relacionada():
    mapa = {"pg-1": {"nome": "CONTA MODELO 1", "numero": ""}, "pg-2": {"nome": "CONTA MODELO 2", "numero": ""}}
    prop = {"type": "relation", "relation": [{"id": "pg-1"}, {"id": "pg-2"}]}
    assert r.resolver_conta(prop, mapa) == ("", "", True)


def test_fila_de_obras_duas_contas_relacionadas_fica_nao_resolvida(monkeypatch):
    pg = _pagina_obra(conta_id="pg-1")
    pg["properties"]["CONTA BANCÁRIA"]["relation"].append({"id": "pg-2"})
    monkeypatch.setattr(r, "ler_banco", lambda db_id, rotulo: [pg])
    mapa = {"pg-1": {"nome": "CONTA MODELO 1", "numero": ""}, "pg-2": {"nome": "CONTA MODELO 2", "numero": ""}}
    fila = r.fila_de_obras(mapa_contas=mapa)
    assert fila[0]["conta_exata"] == ""
    assert fila[0]["conta_nao_resolvida"] is True


def test_tem_conta_pedida_nao_resolvida_conta_como_pedida():
    assert r.tem_conta_pedida({"conta_exata": "", "conta": "", "conta_nao_resolvida": True}) is True


def test_preencher_conta_nao_resolvida_devolve_false_sem_cair_no_texto(monkeypatch, capsys):
    chamadas_conta = []

    def fake_escolher(page, campo_sel, texto_busca, alvo=None, exato=False, prefixo=False, sigilo=False, numero=""):
        if campo_sel == r.CAMPO["conta"]:
            chamadas_conta.append(texto_busca)
        return alvo or texto_busca

    monkeypatch.setattr(r, "escolher_na_lista", fake_escolher)
    ok = r.preencher_conta(_PageFake(), {"conta_exata": "", "conta_nao_resolvida": True,
                                         "conta": "BANCO SIGILOSO - Conta corrente: 1234-5"})
    assert ok is False
    assert chamadas_conta == []          # nunca cai no texto livre
    saida = capsys.readouterr().out
    assert "BANCO SIGILOSO" not in saida and "1234-5" not in saida


def test_criar_no_mc_nao_resolvida_nao_cria(monkeypatch):
    _silenciar_apoios_criar_no_mc(monkeypatch)
    abriu = []
    monkeypatch.setattr(r, "ir_lista_obras", lambda page: abriu.append(1))
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.criar_no_mc(_FakePageSalva(), _obra_ficticia(conta_exata="", conta_nao_resolvida=True))
    assert resultado == "conta_nao_resolvida"
    assert abriu == []                   # nem abriu o formulário
    assert resultado not in ("criada", "ja_existe")


def test_completar_no_mc_nao_resolvida_com_conta_ja_preenchida_no_mc_nao_confere(monkeypatch):
    _silenciar_apoios_completar_no_mc(monkeypatch)
    monkeypatch.setattr(r, "valor_campo", lambda page, sel: "já preenchido no MC")
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: True)
    monkeypatch.setattr(r, "APLICAR", True)
    resultado = r.completar_no_mc(_FakePageSalva(), _obra_ficticia(conta_exata="", conta_nao_resolvida=True))
    assert resultado == "conta não escolhida"


# ============================================================================
# I5 (revisão final) — prints com a conta não vão para o artefato público
# ============================================================================

def test_criar_no_mc_prints_da_tela_sao_sensiveis(monkeypatch):
    _silenciar_apoios_criar_no_mc(monkeypatch)
    fotos = []
    monkeypatch.setattr(r, "foto", lambda page, nome, sensivel=False: fotos.append((nome.split("_")[0], sensivel)))
    monkeypatch.setattr(r, "preencher_conta", lambda page, o: True)
    monkeypatch.setattr(r, "APLICAR", True)
    r.criar_no_mc(_FakePageSalva(), _obra_ficticia())
    assert fotos, "criar_no_mc deveria tirar prints"
    assert all(sensivel for _, sensivel in fotos), fotos
