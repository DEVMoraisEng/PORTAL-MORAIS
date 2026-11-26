# -*- coding: utf-8 -*-
"""Conferência de compras (OC) — 16/11/2026: fornecedores, dias úteis e o que vira alerta."""
import datetime as dt
import json

import robo_mc_ocs as ro

D = dt.date


def test_fornecedores_da_lista_e_acao():
    assert ro.acao_do_fornecedor("Rocha Mármores e Granitos") == ("ROCHA MARMORES E GRANITOS", "APROVAR")
    assert ro.acao_do_fornecedor("ROCHA MARMORES E GRANITOS LTDA") == ("ROCHA MARMORES E GRANITOS", "APROVAR")
    assert ro.acao_do_fornecedor("VIDRO ALVES") == ("VIDRO ALVES", "APROVAR")
    assert ro.acao_do_fornecedor("Serralheria do Fábio") == ("SERRALHERIA DO FABIO", "PARCELA")
    assert ro.acao_do_fornecedor("Casa do Construtor") is None
    assert ro.acao_do_fornecedor("") is None


def test_fornecedor_extra_pelo_ambiente(monkeypatch):
    monkeypatch.setenv("OCS_FORNECEDORES", "Gesso Bom=PARCELA;Qualquer=APAGAR")
    assert ro.acao_do_fornecedor("GESSO BOM ME") == ("GESSO BOM", "PARCELA")
    assert ro.acao_do_fornecedor("Qualquer") is None          # ação inválida não entra


def test_feriados_moveis_2027():
    f = ro.feriados(2027)
    assert D(2027, 3, 26) in f            # sexta-feira santa (páscoa 28/03/2027)
    assert D(2027, 2, 8) in f and D(2027, 2, 9) in f   # carnaval
    assert D(2027, 5, 27) in f            # Corpus Christi
    assert D(2026, 11, 20) in ro.feriados(2026)


def test_proximo_dia_util():
    assert ro.proximo_dia_util(D(2026, 11, 16)) == D(2026, 11, 17)       # segunda → terça
    assert ro.proximo_dia_util(D(2026, 11, 13)) == D(2026, 11, 16)       # sexta → segunda
    assert ro.proximo_dia_util(D(2026, 11, 19)) == D(2026, 11, 23)       # quinta → (20 feriado, fds) → segunda
    assert ro.proximo_dia_util(D(2026, 12, 24)) == D(2026, 12, 28)       # véspera de Natal → segunda


def test_data_da_parcela_nunca_no_passado():
    assert ro.data_da_parcela(D(2026, 11, 16), D(2026, 11, 16)) == D(2026, 11, 17)
    assert ro.data_da_parcela(D(2026, 11, 14), D(2026, 11, 16)) == D(2026, 11, 16)   # SIM no sábado, robô na segunda
    assert ro.data_da_parcela(D(2026, 11, 2), D(2026, 11, 16)) == D(2026, 11, 16)    # robô atrasado: hoje (útil)
    assert ro.data_da_parcela(D(2026, 11, 2), D(2026, 11, 15)) == D(2026, 11, 16)    # hoje é domingo → segunda


def test_dia_local_em_goiania():
    assert ro.dia_local("2026-11-17T01:30:00+00:00") == D(2026, 11, 16)    # 22:30 do dia 16 em Goiânia
    assert ro.dia_local("2026-11-16T12:00:00Z") == D(2026, 11, 16)
    assert ro.dia_local(None) is None


def test_mesma_data_nos_dois_formatos():
    assert ro.mesma_data("17/11/2026", D(2026, 11, 17))
    assert ro.mesma_data("2026-11-17", D(2026, 11, 17))
    assert not ro.mesma_data("05/11/2026", D(2026, 11, 17))


NO = {"id": "6486e261-b336-4263-99e5-a27de4efb5ca", "number": 8312, "creationDate": "2026-11-16T10:00:00",
      "approvalStatus": "AWAITING", "purchaseStatus": None, "description": "MARMORES E GRANITOS",
      "supplier": {"id": "x", "person": {"name": "Rocha Mármores e Granitos"}},
      "costCenters": [{"id": "c", "work": {"name": "52 QD 81 LT 12"}}]}


def test_oc_do_no_acha_os_campos():
    oc = ro.oc_do_no(NO)
    assert oc["numero"] == 8312 and oc["fornecedor"] == "Rocha Mármores e Granitos"
    assert oc["obra"] == "52 QD 81 LT 12" and oc["criada_em"] == "2026-11-16"
    assert oc["aprovacao_mc"] == "AWAITING" and not oc["cancelada"]
    assert ro.interessa(oc) == ("ROCHA MARMORES E GRANITOS", "APROVAR", False)


def test_oc_antiga_so_da_rocha_vidro_e_sem_lancamento():
    sem = ro.oc_do_no(dict(NO, creationDate="2026-10-01", tradePayables=[]))
    assert sem["tem_lancamento"] is False
    assert ro.interessa(sem, antigas="2026-05-01") == ("ROCHA MARMORES E GRANITOS", "APROVAR", True)
    com = ro.oc_do_no(dict(NO, creationDate="2026-10-01", tradePayables=[{"id": "x"}]))
    assert com["tem_lancamento"] is True and ro.interessa(com, antigas="2026-05-01") is None
    muito_velha = ro.oc_do_no(dict(NO, creationDate="2026-01-10", tradePayables=[]))
    assert ro.interessa(muito_velha, antigas="2026-05-01") is None
    fabio = ro.oc_do_no(dict(NO, creationDate="2026-10-01", approvalStatus="APPROVED",
                             supplier={"name": "Serralheria do Fabio"}))
    # 19/11 (dono): Fabio antigo APROVADO entra em qualquer data — a 2ª parcela é conferida na tela (parcela_aberta)
    assert ro.interessa(fabio, antigas="2026-05-01") == ("SERRALHERIA DO FABIO", "PARCELA", True)
    assert ro.interessa(dict(fabio, aprovacao_mc="AWAITING"), antigas="2026-05-01") is None     # não aprovada
    assert ro.interessa(dict(fabio, tem_lancamento=False), antigas="2026-05-01") is None       # a lista diz: sem lançamento
    fabio_velho = dict(fabio, criada_em="2021-03-10")
    assert ro.interessa(fabio_velho, antigas="2026-05-01") == ("SERRALHERIA DO FABIO", "PARCELA", True)
    assert ro.interessa(dict(fabio, cancelada=True), antigas="2026-05-01") is None
    outro = ro.oc_do_no(dict(NO, supplier={"name": "Casa do Construtor"}))
    assert ro.interessa(outro) is None


def test_antiga_sem_informacao_confere_na_tela():
    a = ro.oc_do_no(dict(NO, id="55555555-5555-5555-5555-555555555555", creationDate="2026-10-01"))
    b = ro.oc_do_no(dict(NO, id="66666666-6666-6666-6666-666666666666", creationDate="2026-10-02"))
    assert a["tem_lancamento"] is None
    vistos = []

    def sem_lanc(oc):
        vistos.append(oc["numero"])
        return oc["oc_id"] == a["oc_id"]
    novas, _ = ro.linhas_novas_e_atualizadas([a, b], {}, sem_lanc, antigas="2026-05-01")
    assert [x["oc_id"] for x in novas] == [a["oc_id"]] and len(vistos) == 2
    novas, _ = ro.linhas_novas_e_atualizadas([a], {}, None, antigas="2026-05-01")
    assert novas == []                     # sem como conferir: fica para a próxima rodada


def test_antigas_desde_meses_atras():
    assert ro.antigas_desde(dt.date(2026, 11, 16)) == "2026-05-01"
    assert ro.antigas_desde(dt.date(2026, 3, 2)) == "2025-09-01"


def test_novas_e_atualizadas_nao_mexem_na_resposta():
    a = ro.oc_do_no(NO)
    ja_aprovada = ro.oc_do_no(dict(NO, id="11111111-1111-1111-1111-111111111111", approvalStatus="APPROVED"))
    fabio = ro.oc_do_no(dict(NO, id="22222222-2222-2222-2222-222222222222", approvalStatus="APPROVED",
                             supplier={"name": "Serralheria do Fabio"}))
    cancelada = ro.oc_do_no(dict(NO, id="33333333-3333-3333-3333-333333333333", approvalStatus="CANCELED"))
    existente = ro.oc_do_no(dict(NO, id="44444444-4444-4444-4444-444444444444", approvalStatus="APPROVED"))
    novas, atual = ro.linhas_novas_e_atualizadas([a, ja_aprovada, fabio, cancelada, existente],
                                                 {existente["oc_id"]: {"resposta": "SIM"}})
    ids = [x["oc_id"] for x in novas]
    assert a["oc_id"] in ids and fabio["oc_id"] in ids          # Fabio entra mesmo aprovada (a ação é na parcela)
    assert ja_aprovada["oc_id"] not in ids and cancelada["oc_id"] not in ids
    assert [x["oc_id"] for x in atual] == [existente["oc_id"]]
    assert all("resposta" not in x and "robo_situacao" not in x for x in novas + atual)
    # 16/11: upsert = INSERT … ON CONFLICT — sem fornecedor/acao (NOT NULL) a linha existente dava HTTP 400 (23502)
    assert all(x.get("fornecedor") and x.get("acao") for x in novas + atual)
    assert {x["acao"] for x in novas} == {"APROVAR", "PARCELA"}


def test_lista_da_resposta_nodes_ou_edges():
    nos, info = ro._lista_da_resposta({"data": {"purchaseOrder": {"nodes": [{"id": 1}], "pageInfo": {"hasNextPage": False}}}})
    assert nos == [{"id": 1}] and info == {"hasNextPage": False}
    nos, _ = ro._lista_da_resposta({"data": {"purchaseOrders": {"edges": [{"node": {"id": 2}}]}}})
    assert nos == [{"id": 2}]


def test_arquivos_validos_tira_temporario_e_poe_extensao():
    l = [{"id": "1", "name": "NF 123", "extension": "pdf", "sizeInBytes": 10},
         {"id": "2", "name": "boleto.pdf", "extension": "pdf"},
         {"id": "3", "name": "pela metade", "temporary": True},
         {"id": "4", "name": "vazio", "sizeInBytes": 0}]
    assert ro.arquivos_validos(l) == ["NF 123.pdf", "boleto.pdf"]


class AbaFalsa:
    def __init__(self, respostas):
        self.respostas, self.urls = respostas, []

    def cabecalhos(self, host):
        return {"authorization": "x"}

    def fetch(self, metodo, url, cab, corpo=None):
        self.urls.append(url)
        for trecho, (st, corpo_r) in self.respostas.items():
            if trecho in url:
                return st, json.dumps(corpo_r)
        return 404, ""


def test_anexos_da_oc_pelas_pastas_e_pela_rota_nova():
    aba = AbaFalsa({"/folder?": (200, [{"id": "p1", "name": "Notas", "files": [{"id": "f", "name": "NF 9.pdf"}]},
                                      {"id": "p2", "name": "Outros"}]),
                    "/folder/p2": (200, {"files": [{"id": "g", "name": "foto", "extension": "jpg"}]})})
    assert ro.anexos_da_oc(aba, "6486e261-b336-4263-99e5-a27de4efb5ca") == ["NF 9.pdf", "foto.jpg"]
    assert "origin=PURCHASE_ORDER" in aba.urls[0]
    aba2 = AbaFalsa({"/attachments/v2": (200, {"items": [{"id": "a", "fileName": "nota.xml"}]})})
    assert ro.anexos_da_oc(aba2, "6486e261-b336-4263-99e5-a27de4efb5ca") == ["nota.xml"]


def test_com_anexos_pula_feita_e_marca_as_outras():
    aba = AbaFalsa({"/folder?": (200, [{"id": "p", "files": [{"id": "f", "name": "NF.pdf"}]}])})
    linhas = [{"oc_id": "a", "numero": 1}, {"oc_id": "b", "numero": 2}]
    est = ro.com_anexos(aba, linhas, {"b": {"robo_situacao": "FEITO"}})
    assert linhas[0]["anexos"] == 1 and linhas[0]["anexos_nomes"] == "NF.pdf" and "anexos" not in linhas[1]
    assert est == {"conferidas": 1, "com_nf": 1, "erros": 0}


def test_gravar_agrupa_por_chaves():
    sb = ro.Supa("http://x", "k")
    lotes = []
    sb.pedir = lambda m, c, corpo=None, prefer="": lotes.append(corpo)
    sb.gravar([{"oc_id": "a", "acao": "APROVAR"}, {"oc_id": "b"}, {"oc_id": "c", "acao": "PARCELA"}])
    assert sorted(len(l) for l in lotes) == [1, 2]


def test_aprovada_sem_lancamento_entra_e_volta_para_aguardando():
    sem = ro.oc_do_no(dict(NO, id="77777777-7777-7777-7777-777777777777", creationDate="2026-10-13",
                           approvalStatus="APPROVED", purchaseStatus="PURCHASED", financialValue=0))
    com = ro.oc_do_no(dict(NO, id="88888888-8888-8888-8888-888888888888", creationDate="2026-10-13",
                           approvalStatus="APPROVED", financialValue=1500.0))
    assert sem["tem_lancamento"] is False and com["tem_lancamento"] is True
    novas, _ = ro.linhas_novas_e_atualizadas([sem, com], {}, antigas="2026-05-01")
    assert [x["oc_id"] for x in novas] == [sem["oc_id"]]
    v = ro.para_voltar([sem, com], {}, novas, antigas="2026-05-01")
    assert [o["oc_id"] for o in v] == [sem["oc_id"]]
    # com SIM do engenheiro, ou já feita pelo robô, não volta
    assert ro.para_voltar([sem], {sem["oc_id"]: {"acao": "APROVAR", "resposta": "SIM"}}, [], antigas="2026-05-01") == []
    assert ro.para_voltar([sem], {sem["oc_id"]: {"acao": "APROVAR", "robo_situacao": "FEITO"}}, [], antigas="2026-05-01") == []
    aguardando = dict(sem, aprovacao_mc="AWAITING_APPROVAL")
    assert ro.para_voltar([aguardando], {sem["oc_id"]: {"acao": "APROVAR"}}, [], antigas="2026-05-01") == []


def test_ao_vivo_mostra_o_passo(tmp_path, monkeypatch):
    import robo_mc_ocs as r
    arq = tmp_path / "ocs-ao-vivo.txt"
    monkeypatch.setattr(r, "AO_VIVO", arq)
    r.passo("OC 8312 (voltar): clicando Salvar")
    r.log("linha normal")
    txt = arq.read_text(encoding="utf-8")
    assert "clicando Salvar" in txt and "linha normal" in txt
    assert r._PASSO["txt"].endswith("clicando Salvar")


# ------------------------------------------------- 19/11: Serralheria antiga com a 2ª parcela em aberto
FABIO = dict(NO, supplier={"name": "Serralheria do Fabio"}, approvalStatus="APPROVED")


def _fabio(i, criada):
    return ro.oc_do_no(dict(FABIO, id="%08d-0000-0000-0000-000000000000" % i, number=i, creationDate=criada))


def test_serralheria_antiga_so_entra_com_a_2a_parcela_em_aberto():
    aberta, paga, sem_saber, nova = _fabio(1, "2024-02-01"), _fabio(2, "2025-06-01"), _fabio(3, "2026-10-01"), \
        _fabio(4, "2026-11-18")
    vistos = []

    def parcela_aberta(oc):
        vistos.append(oc["numero"])
        return {1: True, 2: False, 3: None}[oc["numero"]]
    novas, _ = ro.linhas_novas_e_atualizadas([aberta, paga, sem_saber, nova], {}, parcela_aberta=parcela_aberta)
    assert [x["numero"] for x in novas] == [1, 4]           # a nova (de 16/11 em diante) entra sem conferir
    assert sorted(vistos) == [1, 2, 3]
    assert all(x["acao"] == "PARCELA" for x in novas)
    novas, _ = ro.linhas_novas_e_atualizadas([aberta], {}, parcela_aberta=None)
    assert novas == []                                      # sem como conferir: fica fora


def test_serralheria_antiga_que_ja_esta_na_conferencia_nao_e_aberta_de_novo():
    a = _fabio(1, "2024-02-01")

    def nao_pode(oc):
        raise AssertionError("não pode abrir o lançamento de quem já está na conferência")
    novas, atual = ro.linhas_novas_e_atualizadas([a], {a["oc_id"]: {"fornecedor": "SERRALHERIA DO FABIO",
                                                                   "acao": "PARCELA"}}, parcela_aberta=nao_pode)
    assert novas == [] and [x["oc_id"] for x in atual] == [a["oc_id"]]


def test_rever_parcela_paga_nunca_as_outras_depois_de_um_tempo():
    hoje = D(2026, 11, 19)
    assert ro.rever_parcela(None, hoje) is True
    assert ro.rever_parcela({"r": "paga", "em": "2020-01-01"}, hoje) is False
    assert ro.rever_parcela({"r": "aberta", "em": "2026-11-19"}, hoje) is False
    assert ro.rever_parcela({"r": "sem_lanc", "em": "2026-11-15"}, hoje) is False
    assert ro.rever_parcela({"r": "sem_lanc", "em": "2026-11-12"}, hoje) is True
    assert ro.rever_parcela({"r": "sem2", "em": "2026-11-01"}, hoje) is False
    assert ro.rever_parcela({"r": "varios", "em": "2026-10-01"}, hoje) is True


def test_candidatas_do_historico_e_juntar_com_a_rodada():
    velha, nova, rocha = _fabio(1, "2023-05-05"), _fabio(2, "2026-11-17"), ro.oc_do_no(dict(NO, creationDate="2023-01-01"))
    cancelada = dict(_fabio(3, "2024-01-01"), cancelada=True)
    nao_aprovada = dict(_fabio(6, "2024-01-01"), aprovacao_mc="AWAITING")
    cand = ro.candidatas_parcela([velha, nova, rocha, cancelada, nao_aprovada])
    assert [c["numero"] for c in cand] == [1]
    json.dumps(cand)                                        # vai para o arquivo do _central
    mais_velha = _fabio(5, "2022-01-01")
    junto = ro.juntar_candidatas([nova, velha], [mais_velha, velha])
    assert [o["numero"] for o in junto] == [2, 1, 5]        # sem repetir a que já veio na rodada


def test_ideia_calhas_pelo_nome_fantasia_ou_pela_razao_social():
    assert ro.acao_do_fornecedor("Ideia Calhas e Rufos")[1] == "PARCELA"
    assert ro.acao_do_fornecedor("IDEIAS E SOLUCOES COMERCIO E SERVICOS EM CALHAS LTDA")[1] == "PARCELA"
    assert ro.acao_do_fornecedor("Ideias e Soluções Comércio e Serviços em Calha e Rufos")[1] == "PARCELA"
    ideia = ro.oc_do_no(dict(FABIO, creationDate="2025-04-01", supplier={"name": "Ideia Calhas e Rufos"}))
    assert ro.interessa(ideia)[1:] == ("PARCELA", True)


# ------------------------------------------------- 19/11: solicitações de Bancada / Janela / Calhas / Portão sem OC
def _sol(i, itens, aprov="APPROVED", data="2026-11-01T10:00:00"):
    return {"id": "sol-%d" % i, "number": 900 + i, "approvalStatus": aprov, "creationDate": data,
            "work": {"name": "52 QD 81 LT 12"},
            "costCenters": [{"items": [dict(id="it-%d-%d" % (i, k), status=st, originItem={"name": nome},
                                            purchaseOrderItem=({"id": "poi", "purchaseOrder": {"id": oc}} if oc else None))
                                       for k, (nome, st, oc) in enumerate(itens)]}]}


def test_categoria_pelas_palavras_do_dono():
    assert ro.categoria_do_item("BANCADA GRANITO 1,20") == "Bancada"
    assert ro.categoria_do_item("Janela de correr 1,20x1,00") == "Janela"
    assert ro.categoria_do_item("RUFO GALVANIZADO") == "Calhas e rufos"
    assert ro.categoria_do_item("Calha moldada") == "Calhas e rufos"
    assert ro.categoria_do_item("Portão basculante") == "Portão"
    assert ro.categoria_do_item("Cimento CP II") is None
    # 19/11 (dono): tem que COMEÇAR com a palavra-chave
    assert ro.categoria_do_item("Pingadeira para janela") is None
    assert ro.categoria_do_item("Granito para bancada") is None
    assert ro.categoria_do_item("Fechadura de portão") is None
    assert ro.categoria_do_item("RUFOS EM CHAPA") == "Calhas e rufos"


def test_solicitacao_entra_com_um_item_da_lista_sem_oc():
    so_cimento = _sol(1, [("Cimento", "OPEN", None)])
    sem_oc = _sol(2, [("Cimento", "OPEN", "oc-1"), ("Bancada granito", "OPEN", None)])
    com_oc = _sol(3, [("Janela 1,20", "OPEN", "oc-2")])
    cancelada = _sol(4, [("Portão", "OPEN", None)], aprov="CANCELED")
    item_cancelado = _sol(5, [("Rufo", "CANCELED", None)])
    assert ro.solicitacao_pendente(so_cimento) is None
    r = ro.solicitacao_pendente(sem_oc)
    assert r["pendente"] is True and r["categorias"] == "Bancada" and r["itens"] == "Bancada granito"
    assert ro.solicitacao_pendente(com_oc)["pendente"] is False
    assert ro.solicitacao_pendente(cancelada) is None and ro.solicitacao_pendente(item_cancelado) is None


def test_linhas_das_solicitacoes_e_quando_sai_da_aba():
    agora = "2026-11-19T19:00:00+00:00"
    pend, virou_oc, ja_tinha_oc = _sol(1, [("Bancada", "OPEN", None)]), _sol(2, [("Janela", "OPEN", "oc-9")]), \
        _sol(3, [("Calha", "OPEN", "oc-8")])
    linhas, cont = ro.linhas_solicitacoes([pend, virou_oc, ja_tinha_oc, _sol(4, [("Areia", "OPEN", None)])],
                                          {"sol-2": {"pendente": True}}, "creationDate", agora)
    por = {x["sol_id"]: x for x in linhas}
    assert set(por) == {"sol-1", "sol-2", "sol-3"}
    assert por["sol-1"]["pendente"] is True and por["sol-1"]["resolvida_em"] is None
    assert por["sol-1"]["criada_em"] == "2026-11-01" and por["sol-1"]["numero"] == 901
    assert por["sol-2"]["pendente"] is False and por["sol-2"]["resolvida_em"] == agora      # a OC foi criada agora
    assert por["sol-3"]["resolvida_em"] == agora                                             # nunca aparece no mapa
    assert {k: cont[k] for k in ("com_material", "pendentes", "resolvidas")} == {"com_material": 3, "pendentes": 1,
                                                                                  "resolvidas": 1}
    linhas, _ = ro.linhas_solicitacoes([virou_oc], {"sol-2": {"pendente": False}}, "creationDate", agora)
    assert "resolvida_em" not in linhas[0]                                                   # mantém a data de antes
    json.dumps(linhas)


def test_data_da_solicitacao_de_cada_oc_fica_com_a_mais_antiga():
    a = _sol(1, [("Cimento", "OPEN", "oc-1")], data="2026-10-05T08:00:00")
    b = _sol(2, [("Areia", "OPEN", "oc-1"), ("Brita", "OPEN", "oc-2")], data="2026-10-01")
    m = ro.data_da_solicitacao_por_oc([a, b], "creationDate")
    assert m == {"oc-1": (902, "2026-10-01"), "oc-2": (902, "2026-10-01")}
    assert ro.data_da_solicitacao_por_oc([a], None) == {}


def test_solicitacao_so_fica_enquanto_em_aprovacao_ou_a_atender():
    em_aprov = dict(_sol(1, [("Bancada", "OPEN", None)]), status="AWAITING_APPROVAL")
    a_atender = dict(_sol(2, [("Janela", "OPEN", None)]), status="TO_ATTEND")
    atendida = dict(_sol(3, [("Portão", "OPEN", None)]), status="ATTENDED")
    texto = dict(_sol(4, [("Calha", "OPEN", None)]), status="A atender")
    assert ro.solicitacao_pendente(em_aprov)["pendente"] and ro.solicitacao_pendente(a_atender)["pendente"]
    assert ro.solicitacao_pendente(texto)["pendente"]
    assert ro.solicitacao_pendente(atendida)["pendente"] is False          # atendida sem OC: sai do mapa
    linhas, cont = ro.linhas_solicitacoes([em_aprov, atendida], {}, "creationDate")
    assert cont["status"] == {"AWAITING_APPROVAL": 1, "ATTENDED": 1}
    assert {x["sol_id"]: x["aprovacao_mc"] for x in linhas} == {"sol-1": "AWAITING_APPROVAL", "sol-3": "ATTENDED"}


def test_data_da_solicitacao_pela_coluna_vinculos_da_oc():
    a = _sol(1, [("Cimento", "OPEN", None)], data="2026-10-05T08:00:00")
    oc = ro.oc_do_no(dict(NO, purchaseRequests=[{"id": "sol-1", "number": 901}]))
    assert oc["solicitacoes"] == [("sol-1", 901)]
    so_num = ro.oc_do_no(dict(NO, id="77777777-7777-7777-7777-777777777777", purchaseRequestNumber=901))
    assert so_num["solicitacoes"] == [(None, 901)]
    m = ro.data_da_solicitacao_por_oc([a], "creationDate", [oc, so_num])
    assert m[oc["oc_id"]] == (901, "2026-10-05") and m[so_num["oc_id"]] == (901, "2026-10-05")
    json.dumps(oc)


def test_solicitacao_que_nao_entra_mais_sai_da_aba():
    agora = "2026-11-19T20:30:00+00:00"
    pingadeira = _sol(7, [("Pingadeira para janela", "OPEN", None)])
    linhas, cont = ro.linhas_solicitacoes([pingadeira], {"sol-7": {"pendente": True}}, "creationDate", agora)
    assert linhas == [{"sol_id": "sol-7", "pendente": False, "resolvida_em": agora, "visto_em": agora}]
    assert cont["resolvidas"] == 1
    assert ro.linhas_solicitacoes([pingadeira], {}, "creationDate", agora)[0] == []


# ------------------------------------------------- 26/11: Ideia Calhas — parcela única vale
class _PaginaFalsa:
    def __init__(self, parcelas):
        self.parcelas = parcelas        # {n: {"vencimento": ..., "pago": ...}}

    def evaluate(self, _js, arg):
        n, _marca = arg
        total = len(self.parcelas)
        if n in self.parcelas:
            return dict(self.parcelas[n], parcelas=total)
        return {"vencimento": None, "parcelas": total}


def test_ideia_com_parcela_unica_usa_a_1a_e_serralheria_continua_na_2a():
    unica = _PaginaFalsa({1: {"vencimento": "10/12/2026", "pago": False}})
    duas = _PaginaFalsa({1: {"vencimento": "01/11/2026", "pago": True}, 2: {"vencimento": "10/12/2026", "pago": False}})
    assert ro.parcela_alvo(unica, "Ideia Calhas e Rufos")[0] == 1
    assert ro.parcela_alvo(unica, "SELENILDE FERREIRA DE MOURA (IDEIA CALHAS E RUFOS)")[1]["vencimento"] == "10/12/2026"
    assert ro.parcela_alvo(unica, "Serralheria do Fabio") == (2, {"vencimento": None, "parcelas": 1})
    assert ro.parcela_alvo(duas, "Ideia Calhas e Rufos")[0] == 2
    assert ro.parcela_alvo(duas, "Serralheria do Fabio")[0] == 2
    assert ro.aceita_parcela_unica("IDEIAS E SOLUCOES COMERCIO E SERVICOS EM CALHAS LTDA")
    assert not ro.aceita_parcela_unica("Rocha Mármores e Granitos")
