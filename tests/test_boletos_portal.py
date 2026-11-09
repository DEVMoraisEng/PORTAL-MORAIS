# -*- coding: utf-8 -*-
"""Arquivo da página Boletos e Financeiro e o Segurar/Soltar. Dados inventados."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "servidor"))
import boletos_portal as BP  # noqa: E402
from venda.mc import seguradas as S  # noqa: E402

ID1, ID2, ID3 = "a" * 32, "b" * 32, "c" * 32


def linha(parcela, acao, motivo="", **extra):
    return dict({"parcela": parcela, "acao": acao, "motivo": motivo, "unidade": "01", "comprador": "COMPRADOR A",
                 "tipo": "pre", "data": "2026-11-30", "valor": 100.0}, **extra)


def relatorio(tmp, linhas, resultados=(), nome="2026-11-09_100000"):
    (tmp / (nome + ".json")).write_text(json.dumps({
        "modo": "emissao", "mes": "2026-11", "hoje": "2026-11-09", "trava": None, "saldo": 99,
        "contagem": {}, "linhas": list(linhas), "resultados": list(resultados)}), encoding="utf-8")


def test_ignora_seguradas_json_ao_procurar_o_relatorio(tmp_path):
    relatorio(tmp_path, [linha(ID1, "aguardar")])
    S.gravar(tmp_path, {})
    assert BP.ultimo_relatorio(tmp_path)["nome"] == "2026-11-09_100000"


def test_pega_o_mais_novo_e_pula_o_ilegivel(tmp_path):
    relatorio(tmp_path, [], nome="2026-11-08_100000")
    relatorio(tmp_path, [], nome="2026-11-09_100000")
    (tmp_path / "2026-11-09_110000.json").write_text("{quebrado", encoding="utf-8")
    assert BP.ultimo_relatorio(tmp_path)["nome"] == "2026-11-09_100000"


def test_grupos_separam_cada_situacao():
    rel = {"linhas": [linha("e", "emitir"), linha("o", "emitir"), linha("r", "emitir"), linha("b", "pular", "já tem boleto (REGISTERED)", com_boleto=True),
                      linha("p", "pular", "ato (sempre por Pix, nunca boleto)"), linha("a", "aguardar", "emite a partir de 25/11"),
                      linha("d", "decidir", "venceu"), linha("s", "aguardar")],
           "resultados": [{"parcela": "o", "situacao": "EMITIDO"}, {"parcela": "r", "situacao": "SEM_CONFIRMACAO", "motivo": "x"}]}
    g = BP.grupos(rel, {"s": {"quem": "ADM", "em": "09/11/2026 14:12"}})
    ids = {k: [i["parcela"] for i in v] for k, v in g.items()}
    assert ids == {"emitidos": ["o", "b"], "a_emitir": ["e"], "aguardando": ["a"], "proximo_mes": [], "decidir": ["r", "d"], "seguradas": ["s"], "pulados": ["p"]}
    assert g["pulados"][0]["motivo"].startswith("ato")
    assert "ADM" in g["seguradas"][0]["motivo"]


def test_segurada_de_outro_mes_continua_na_tela():
    g = BP.grupos({"linhas": []}, {"x": {"quem": "ADM", "em": "01/11/2026 09:00", "rotulo": {"unidade": "07", "valor": 5}}})
    assert g["seguradas"][0]["unidade"] == "07" and g["seguradas"][0]["fora_do_relatorio"] is True


def test_sem_relatorio_nao_quebra():
    assert BP.grupos(None, {})["a_emitir"] == []


def test_segurar_e_soltar(tmp_path):
    relatorio(tmp_path, [linha(ID1, "aguardar")])
    assert BP.pedir("segurar", ID1, "ADM", tmp_path, agora="09/11/2026 14:12") == (True, "segurada")
    marca = S.ler(tmp_path)[ID1]
    assert marca["quem"] == "ADM" and marca["rotulo"]["unidade"] == "01"
    assert BP.pedir("soltar", ID1, "ADM", tmp_path) == (True, "solta")
    assert S.ler(tmp_path) == {}


def test_soltar_o_que_nao_esta_seguro_nao_e_erro(tmp_path):
    assert BP.pedir("soltar", ID1, "ADM", tmp_path)[0] is True


def test_recusa_parcela_pulada_ou_fora_da_lista(tmp_path):
    relatorio(tmp_path, [linha(ID1, "pular", "ato")])
    assert BP.pedir("segurar", ID1, "ADM", tmp_path)[0] is False
    assert BP.pedir("segurar", ID2, "ADM", tmp_path)[0] is False
    assert S.ler(tmp_path) == {}


def test_recusa_sem_quem_e_acao_estranha(tmp_path):
    relatorio(tmp_path, [linha(ID1, "aguardar")])
    assert BP.pedir("segurar", ID1, "", tmp_path)[0] is False
    assert BP.pedir("apagar", ID1, "ADM", tmp_path)[0] is False


def test_notion_fora_mantem_o_ultimo_financeiro(tmp_path):
    guardado = tmp_path / "fin.json"
    assert BP.financeiro("2026-11-09", lambda: [], guardado)["unidades"] == []
    guardado.write_text(json.dumps({"totais": {"recebido": 10}, "unidades": []}), encoding="utf-8")

    def cai():
        raise RuntimeError("Notion fora")
    d = BP.financeiro("2026-11-09", cai, guardado)
    assert d["totais"]["recebido"] == 10 and d["falha_leitura"] is True


def test_notion_fora_sem_nada_guardado_nao_quebra(tmp_path):
    def cai():
        raise RuntimeError("Notion fora")
    d = BP.financeiro("2026-11-09", cai, tmp_path / "nao-existe.json")
    assert d["falha_leitura"] is True and d["unidades"] == []


def test_montar_avisa_quando_as_seguradas_estao_ilegiveis(tmp_path):
    relatorio(tmp_path, [linha(ID1, "aguardar")])
    (tmp_path / "seguradas.json").write_text("{quebrado", encoding="utf-8")
    d = BP.montar(tmp_path, "2026-11-09", lambda: [], tmp_path / "fin.json")
    assert "seguradas" in d["trava_seguradas"] and d["rodada"]["saldo"] == 99


def test_publicar_nunca_lanca(monkeypatch):
    def cai():
        raise RuntimeError("sem rede")
    monkeypatch.setattr(BP, "montar", cai)
    msgs = []
    assert BP.publicar(msgs.append) is False and "FALHOU" in msgs[0]


def test_segurada_que_ganhou_boleto_na_tela_do_erp_aparece_como_emitida():
    g = BP.grupos({"linhas": [linha("x", "pular", "já tem boleto (REGISTERED)", com_boleto=True)]}, {"x": {"quem": "ADM", "em": "ontem"}})
    assert [i["parcela"] for i in g["emitidos"]] == ["x"] and g["seguradas"] == []


def test_aplicar_nao_mexe_em_pulada():
    linhas = [linha("x", "pular", "ato"), linha("y", "decidir", "venceu")]
    S.aplicar({"x": {"quem": "ADM", "em": "ontem"}, "y": {"quem": "ADM", "em": "ontem"}}, linhas)
    assert [l["acao"] for l in linhas] == ["pular", "segurada"]


def test_solta_depois_da_rodada_nao_some_da_tela():
    g = BP.grupos({"linhas": [linha("x", "segurada", "segurada por ADM")]}, {})
    assert "solta depois" in g["aguardando"][0]["motivo"]


def test_marca_malformada_conta_como_arquivo_ilegivel(tmp_path):
    import pytest
    for conteudo in ('{"parcelas": {"x": null}}', '{"parcelas": {"x": "sim"}}', '{"parcelas": {"x": false}}'):
        (tmp_path / "seguradas.json").write_text(conteudo, encoding="utf-8")
        with pytest.raises(S.SeguradasIlegiveis):
            S.ler(tmp_path)


def test_bytes_invalidos_contam_como_arquivo_ilegivel(tmp_path):
    import pytest
    (tmp_path / "seguradas.json").write_bytes(b'{"parcelas": {"\xff": {}}}')
    with pytest.raises(S.SeguradasIlegiveis):
        S.ler(tmp_path)


def test_rodada_com_erp_fora_nao_esvazia_a_tela_nem_impede_segurar(tmp_path):
    relatorio(tmp_path, [linha(ID1, "aguardar")], nome="2026-11-09_100000")
    (tmp_path / "2026-11-10_100000.json").write_text(json.dumps({
        "modo": "emissao", "mes": "2026-11", "hoje": "2026-11-10", "trava": "ERP fora ao montar a lista: caiu",
        "saldo": None, "contagem": {}, "linhas": [], "resultados": []}), encoding="utf-8")
    d = BP.montar(tmp_path, "2026-11-10", lambda: [], tmp_path / "fin.json")
    assert [i["parcela"] for i in d["grupos"]["aguardando"]] == [ID1]
    assert "ERP fora" in d["rodada"]["trava"]
    assert BP.pedir("segurar", ID1, "ADM", tmp_path)[0] is True


def test_nao_aceita_segurar_parcela_ja_emitida(tmp_path):
    relatorio(tmp_path, [linha(ID1, "emitir")], [{"parcela": ID1, "situacao": "EMITIDO"}])
    ok, msg = BP.pedir("segurar", ID1, "ADM", tmp_path)
    assert ok is False and S.ler(tmp_path) == {}


def test_recusa_aparece_no_arquivo_da_pagina_e_some_quando_da_certo(tmp_path):
    relatorio(tmp_path, [linha(ID1, "aguardar")])
    BP.registrar_recusa(ID1, "disco cheio", tmp_path, agora="09/11/2026 14:12")
    d = BP.montar(tmp_path, "2026-11-09", lambda: [], tmp_path / "fin.json")
    assert d["recusas"] == [{"parcela": ID1, "unidade": "01", "motivo": "disco cheio", "em": "09/11/2026 14:12"}]
    assert BP.pedir("segurar", ID1, "ADM", tmp_path)[0] is True
    assert BP.montar(tmp_path, "2026-11-09", lambda: [], tmp_path / "fin.json")["recusas"] == []


def test_recusas_ilegiveis_nao_impedem_publicar(tmp_path):
    (tmp_path / "recusas.json").write_text("{quebrado", encoding="utf-8")
    assert BP.montar(tmp_path, "2026-11-09", lambda: [], tmp_path / "fin.json")["recusas"] == []


def _com_previa(tmp, linhas):
    (tmp / "2026-11-27_100000.json").write_text(json.dumps({
        "modo": "emissao", "mes": "2026-11", "hoje": "2026-11-27", "trava": None, "saldo": 9, "contagem": {},
        "linhas": [linha(ID1, "aguardar")], "resultados": [], "proximo_mes": {"mes": "2026-12", "linhas": linhas}}), encoding="utf-8")


def test_proximo_mes_aparece_em_grupo_proprio_e_aceita_segurar(tmp_path):
    _com_previa(tmp_path, [linha(ID2, "emitir", data="2026-12-10"), linha(ID3, "pular", "ato")])
    d = BP.montar(tmp_path, "2026-11-27", lambda: [], tmp_path / "fin.json")
    assert [i["parcela"] for i in d["grupos"]["proximo_mes"]] == [ID2]
    assert "primeira rodada" in d["grupos"]["proximo_mes"][0]["motivo"]
    assert d["rodada"]["proximo_mes"] == "2026-12" and d["rodada"]["proximo_falhou"] is False
    assert BP.pedir("segurar", ID2, "ADM", tmp_path)[0] is True
    assert BP.pedir("segurar", ID3, "ADM", tmp_path)[0] is False
    d = BP.montar(tmp_path, "2026-11-27", lambda: [], tmp_path / "fin.json")
    assert d["grupos"]["proximo_mes"] == [] and [i["parcela"] for i in d["grupos"]["seguradas"]] == [ID2]
    assert "fora_do_relatorio" not in d["grupos"]["seguradas"][0]


def test_previa_que_falhou_vira_aviso_na_rodada(tmp_path):
    (tmp_path / "2026-11-27_100000.json").write_text(json.dumps({
        "modo": "emissao", "mes": "2026-11", "linhas": [linha(ID1, "aguardar")], "resultados": [],
        "proximo_mes": {"mes": "2026-12", "linhas": [], "falhou": True}}), encoding="utf-8")
    assert BP.montar(tmp_path, "2026-11-27", lambda: [], tmp_path / "fin.json")["rodada"]["proximo_falhou"] is True
