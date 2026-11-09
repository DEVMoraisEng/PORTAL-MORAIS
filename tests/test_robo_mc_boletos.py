import copy, json, pathlib

import robo_mc_boletos as RB
from venda.mc import seguradas as S
from venda.mc import regras as R

BASE = json.loads((pathlib.Path(__file__).parent.parent / "venda" / "mc" / "testes" / "dados"
                   / "antecipacao" / "base.json").read_text(encoding="utf-8"))
HOJE = "2026-11-06"


def venda(**mudar):
    v = copy.deepcopy(BASE)
    v["customer"] = {"cpf": "00000000000", "address": {"zipCode": "75250000", "address": "RUA A",
                     "addressNumber": "1", "neighborhood": "CENTRO", "city": {"id": "x"}}}
    v["tradeReceivable"]["installments"] = []
    v.update(mudar)
    return v


def parcela(v, tipo_id, data, valor=100.0, tabela=None, **extra):
    p = {"id": "p-%d" % len(v["tradeReceivable"]["installments"]), "plannedDate": data, "plannedValue": valor,
         "readjustmentDetail": {"type": {"id": tipo_id}}, "billings": [], "receipts": [], "received": False}
    if tabela:
        p["readjustmentDetail"]["table"] = {"name": tabela}
    p.update(extra)
    v["tradeReceivable"]["installments"].append(p)
    return p


def venda_com_entradas(n, nome="FULANO TESTE", valor=100.0):
    v = venda(description="VENDA UNIDADE 1 - " + nome)
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)          # o ato
    for i in range(n):
        parcela(v, R.TIPO_ENTRADA, "2026-11-%02d" % min(8 + i, 10), valor=valor)
    return v


def venda_com_uma_entrada_do_mes(nome="FULANO TESTE", valor=100.0):
    return venda_com_entradas(1, nome, valor)


def venda_com_duas_entradas_do_mes():
    return venda_com_entradas(2)


class ErpDeMentira:
    def __init__(s, vendas, saldo=100, indices_ok=True, falha_leitura_n=None):
        s.vendas = {v["id"]: v for v in vendas}
        s.saldo, s.posts, s.indices_ok = saldo, 0, indices_ok
        s.falha_leitura_n, s.leituras = falha_leitura_n, 0

    def parcelas(s):
        return [p["id"] for v in s.vendas.values() for p in v["tradeReceivable"]["installments"]
                if p["plannedDate"].startswith("2026-11") and not p.get("received")]

    def pedir(s, metodo, caminho, corpo=None, params=None):
        if caminho == "/receipt-installments":
            return {"last": True, "content": [{"workName": "CONDOMÍNIO RESERVA DOS IPÊS", "saleId": i}
                                              for i in s.vendas]}
        if caminho.startswith("/sales/"):
            s.leituras += 1
            if s.falha_leitura_n == s.leituras:
                raise RuntimeError("o ERP caiu")
            return copy.deepcopy(s.vendas[caminho.split("/")[2]])
        if caminho == "/readjustment-tables/all":
            return [{"id": "t1", "name": "INCC-M"}, {"id": "t2", "name": "IPCA + 1% a.m."}]
        if caminho.startswith("/readjustment-tables/"):
            nome = "INCC-M" if caminho.endswith("t1") else "IPCA + 1% a.m."
            return {"name": nome, "periods": [{"date": "2026-09-01"}] if s.indices_ok else []}
        raise AssertionError(caminho)

    def pedir_core(s, metodo, caminho, corpo=None, params=None):
        if metodo == "GET" and caminho == "/billings/balances":
            return {"balance": s.saldo}
        assert metodo == "POST" and caminho.endswith("/generation")
        s.posts += 1
        pid = caminho.split("/")[3]
        for v in s.vendas.values():
            for p in v["tradeReceivable"]["installments"]:
                if p["id"] == pid:
                    p["billings"] = [{"status": "DRAFT"}]


def liga(tmp_path, monkeypatch):
    (tmp_path / "BOLETOS_APLICAR.txt").write_text("ok")
    monkeypatch.setattr(RB, "APLICAR", tmp_path / "BOLETOS_APLICAR.txt")


def relatorio(tmp_path):
    return json.loads(next(tmp_path.glob("*.json")).read_text(encoding="utf-8"))


def roda(erp, tmp_path, **kw):
    kw.setdefault("emitir", True)
    kw.setdefault("aprovadas", None)
    return RB.rodar(erp, "2026-11", pasta=tmp_path, hoje=HOJE, esperar=lambda s: None, **kw)


def test_sem_arquivo_de_aplicar_nunca_emite(tmp_path, monkeypatch):
    monkeypatch.setattr(RB, "APLICAR", tmp_path / "BOLETOS_APLICAR.txt")   # não existe
    erp = ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes()])
    assert roda(erp, tmp_path) == 0
    assert erp.posts == 0
    rel = relatorio(tmp_path)
    assert rel["modo"] == "previa" and rel["contagem"]["emitir"] == 1


def test_emite_tudo_com_o_interruptor(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()])
    assert roda(erp, tmp_path) == 0 and erp.posts == 2
    rel = relatorio(tmp_path)
    assert rel["modo"] == "emissao" and rel["contagem"]["emitidos"] == 2
    assert len(list(tmp_path.glob("*.html"))) == 1


def test_previa_pedida_nao_emite_mesmo_com_o_arquivo(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes()])
    assert roda(erp, tmp_path, emitir=False) == 0 and erp.posts == 0


def test_so_da_previa_emite_apenas_o_aprovado(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()])
    roda(erp, tmp_path, aprovadas={erp.parcelas()[0]})
    assert erp.posts == 1


def test_saldo_curto_nao_emite_nada(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()], saldo=1)
    assert roda(erp, tmp_path) == 2 and erp.posts == 0
    assert "saldo" in relatorio(tmp_path)["trava"]


def test_teto_nao_emite_nada(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_entradas(63)], saldo=500)   # teto 62 (dono, 07/11)
    assert roda(erp, tmp_path) == 2 and erp.posts == 0


def test_indice_faltando_manda_pre_para_decidir_e_deixa_o_sinal_emitir(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    v = venda(description="VENDA UNIDADE 1 - FULANO TESTE")
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)
    sinal = parcela(v, R.TIPO_SINAL, "2026-11-08")
    pre = parcela(v, R.TIPO_PARCELA, "2026-11-09", tabela="INCC-M")
    erp = ErpDeMentira(vendas=[v], indices_ok=False)
    assert roda(erp, tmp_path) == 0 and erp.posts == 1
    linhas = {l["parcela"]: l for l in relatorio(tmp_path)["linhas"]}
    assert linhas[sinal["id"]]["acao"] == "emitir"
    assert linhas[pre["id"]]["acao"] == "decidir"
    assert "índice do mês ainda não lançado" in linhas[pre["id"]]["motivo"]


def test_erro_na_leitura_antes_do_post_para_tudo_com_codigo_3(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    # leitura 1 = montar a lista; leitura 2 = releitura da 1ª parcela, antes do POST
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()], falha_leitura_n=2)
    assert roda(erp, tmp_path) == 3 and erp.posts == 0
    assert relatorio(tmp_path)["trava"]


def test_erp_fora_ao_montar_a_lista_sai_com_3(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes()], falha_leitura_n=1)
    assert roda(erp, tmp_path) == 3 and erp.posts == 0


def test_recusado_sai_com_1(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes()])
    antigo = erp.pedir_core

    def recusa(metodo, caminho, corpo=None, params=None):
        if metodo == "GET":
            return antigo(metodo, caminho)
        erp.posts += 1
        raise RuntimeError("POST %s -> HTTP 400: dados invalidos" % caminho)
    erp.pedir_core = recusa
    assert roda(erp, tmp_path) == 1 and erp.posts == 1


def test_log_nao_leva_nome_nem_valor(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(RB, "APLICAR", tmp_path / "nao")
    roda(ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes(nome="FULANO TESTE", valor=1234.56)]),
         tmp_path, emitir=False)
    saida = capsys.readouterr().out
    assert "FULANO" not in saida and "1234" not in saida and "1.234" not in saida
    # 07/11: na prévia a linha mostra o que VAI sair ("a emitir"), não só o que já saiu
    assert saida.strip().splitlines()[-1].startswith("boletos: 1 a emitir, 0 emitidos, 0 aguardando, 0 decidir,")


def test_html_tem_comprador_e_valor_mas_sem_link_externo(tmp_path, monkeypatch):
    monkeypatch.setattr(RB, "APLICAR", tmp_path / "nao")
    roda(ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes(nome="FULANO <TESTE>", valor=1234.56)]),
         tmp_path, emitir=False)
    h = next(tmp_path.glob("*.html")).read_text(encoding="utf-8")
    assert "FULANO &lt;TESTE&gt;" in h and "1.234,56" in h and "http" not in h


def test_interruptor_desligado_no_meio_para_a_rodada(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()])
    antigo = erp.pedir_core

    def apaga_depois(metodo, caminho, corpo=None, params=None):
        r = antigo(metodo, caminho, corpo, params)
        if metodo == "POST":
            RB.APLICAR.unlink()
        return r
    erp.pedir_core = apaga_depois
    assert roda(erp, tmp_path) == 2 and erp.posts == 1
    rel = relatorio(tmp_path)
    assert rel["trava"] == "interruptor desligado no meio da rodada" and rel["contagem"]["emitidos"] == 1


def test_relatorio_e_gravado_a_cada_emissao(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()])
    antigo = erp.pedir_core
    vistos = []

    def espia(metodo, caminho, corpo=None, params=None):
        if metodo == "POST":   # antes do 2o POST o relatório já deve ter o 1o boleto
            vistos.append(len(list(tmp_path.glob("*.json"))) and relatorio(tmp_path)["contagem"]["emitidos"])
        return antigo(metodo, caminho, corpo, params)
    erp.pedir_core = espia
    roda(erp, tmp_path)
    assert vistos == [0, 1]


def test_falha_ao_gravar_relatorio_nao_muda_o_codigo(tmp_path, monkeypatch, capsys):
    liga(tmp_path, monkeypatch)
    monkeypatch.setattr(RB, "_gravar", lambda *a: (_ for _ in ()).throw(OSError("disco cheio")))
    erp = ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes()])
    assert roda(erp, tmp_path) == 0 and erp.posts == 1
    assert "não consegui gravar" in capsys.readouterr().err


def test_nome_do_relatorio_nao_sobrescreve_outro(tmp_path, monkeypatch):
    monkeypatch.setattr(RB, "APLICAR", tmp_path / "nao")
    for _ in range(2):
        roda(ErpDeMentira(vendas=[venda_com_uma_entrada_do_mes()]), tmp_path, emitir=False)
    assert len(list(tmp_path.glob("*.json"))) == 2 and len(list(tmp_path.glob("*.html"))) == 2


def _novo_relatorio(tmp_path, antes):
    return json.loads([p for p in tmp_path.glob("*.json") if p.name not in antes][0].read_text(encoding="utf-8"))


def test_trava_e_indice_faltando_aparecem_no_stdout_sem_dado_pessoal(tmp_path, capsys, monkeypatch):
    liga(tmp_path, monkeypatch)
    v = venda(description="VENDA UNIDADE 1 - FULANO TESTE")
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)
    parcela(v, R.TIPO_SINAL, "2026-11-08", valor=1234.56)
    parcela(v, R.TIPO_SINAL, "2026-11-09", valor=1234.56)
    parcela(v, R.TIPO_PARCELA, "2026-11-09", valor=1234.56, tabela="INCC-M")
    erp = ErpDeMentira(vendas=[v], indices_ok=False, saldo=1)
    assert roda(erp, tmp_path) == 2 and erp.posts == 0
    linhas = capsys.readouterr().out.strip().splitlines()
    assert linhas[-1].startswith("boletos: ")
    assert "trava: saldo de 1 créditos não cobre 2 boletos" in linhas
    assert "índice faltando: INCC-M 2026-09, IPCA + 1% a.m. 2026-09" in linhas
    texto = "\n".join(linhas)
    assert "FULANO" not in texto and "1234" not in texto and "1.234" not in texto


def test_emitir_fora_do_mes_vigente_vira_previa_com_trava(tmp_path, capsys, monkeypatch):
    liga(tmp_path, monkeypatch)
    v = venda(description="VENDA UNIDADE 1 - FULANO TESTE")
    parcela(v, R.TIPO_SINAL, "2026-10-31", received=True)
    parcela(v, R.TIPO_ENTRADA, "2026-12-08")
    erp = ErpDeMentira(vendas=[v])
    assert RB.rodar(erp, "2026-12", True, None, tmp_path, hoje="2026-11-06", esperar=lambda s: None) == 2
    assert erp.posts == 0
    rel = relatorio(tmp_path)
    assert rel["modo"] == "previa" and rel["trava"] == "emissão só no mês vigente"
    assert "trava: emissão só no mês vigente" in capsys.readouterr().out.splitlines()


def test_sem_confirmacao_em_rodada_anterior_nao_pede_de_novo(tmp_path, capsys, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira(vendas=[venda_com_duas_entradas_do_mes()])
    x, y = erp.parcelas()
    venda_id = list(erp.vendas)[0]
    (tmp_path / "2026-11-05_100000.json").write_text(json.dumps({
        "modo": "emissao", "mes": "2026-11", "hoje": "2026-11-05", "linhas": [], "trava": None,
        "resultados": [{"situacao": "SEM_CONFIRMACAO", "status": "", "motivo": "", "venda": venda_id, "parcela": x},
                       {"situacao": "EMITIDO", "status": "DRAFT", "motivo": "", "venda": venda_id, "parcela": "outra"}]}),
        encoding="utf-8")
    (tmp_path / "2026-10-30_100000.json").write_text(json.dumps({   # outro mês: não conta
        "mes": "2026-10", "hoje": "2026-10-30", "resultados": [{"situacao": "SEM_CONFIRMACAO", "parcela": y}]}),
        encoding="utf-8")
    (tmp_path / "2026-11-05_110000.json").write_text("{quebrado", encoding="utf-8")
    antes = {p.name for p in tmp_path.glob("*.json")}
    postados = []
    antigo = erp.pedir_core

    def espia(metodo, caminho, corpo=None, params=None):
        if metodo == "POST":
            postados.append(caminho.split("/")[3])
        return antigo(metodo, caminho, corpo, params)
    erp.pedir_core = espia
    assert roda(erp, tmp_path) == 0
    assert postados == [y]
    linhas = {l["parcela"]: l for l in _novo_relatorio(tmp_path, antes)["linhas"]}
    assert linhas[x]["acao"] == "decidir"
    assert linhas[x]["motivo"] == ("emissão sem confirmação em 2026-11-05: conferir no Mais Controle antes de emitir")
    err = capsys.readouterr().err
    assert err.count("relatório anterior ilegível") == 1 and "2026-11-05_110000.json" in err


def _relatorio(tmp_path):
    return json.loads(sorted(tmp_path.glob("20*.json"))[-1].read_text(encoding="utf-8"))


def test_parcela_segurada_nao_emite_09_11(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    v = venda_com_duas_entradas_do_mes()
    erp = ErpDeMentira([v])
    segura, livre = erp.parcelas()
    S.gravar(tmp_path, {segura: {"quem": "ADM", "em": "09/11/2026 09:00"}})
    assert RB.rodar(erp, "2026-11", True, None, tmp_path, HOJE, esperar=lambda s: None) == 0
    assert erp.posts == 1
    rel = _relatorio(tmp_path)
    ac = {l["parcela"]: l for l in rel["linhas"]}
    assert ac[segura]["acao"] == "segurada" and "ADM" in ac[segura]["motivo"]
    assert [r["parcela"] for r in rel["resultados"]] == [livre]
    assert rel["contagem"]["segurada"] == 1


def test_segurada_no_meio_da_rodada_nao_emite_09_11(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira([venda_com_duas_entradas_do_mes()])
    primeira, segunda = erp.parcelas()
    antigo = erp.pedir_core

    def post_e_segura(metodo, caminho, corpo=None, params=None):
        r = antigo(metodo, caminho, corpo, params)
        if metodo == "POST":
            S.gravar(tmp_path, {segunda: {"quem": "ADM", "em": "agora"}})
        return r
    erp.pedir_core = post_e_segura
    RB.rodar(erp, "2026-11", True, None, tmp_path, HOJE, esperar=lambda s: None)
    assert erp.posts == 1
    assert {l["parcela"]: l["acao"] for l in _relatorio(tmp_path)["linhas"]}[segunda] == "segurada"


def test_seguradas_ilegiveis_nao_emite_nada_09_11(tmp_path, monkeypatch, capsys):
    liga(tmp_path, monkeypatch)
    (tmp_path / "seguradas.json").write_text("{quebrado", encoding="utf-8")
    erp = ErpDeMentira([venda_com_duas_entradas_do_mes()])
    assert RB.rodar(erp, "2026-11", True, None, tmp_path, HOJE, esperar=lambda s: None) == 2
    assert erp.posts == 0
    assert "seguradas" in capsys.readouterr().out


def test_seguradas_quebradas_no_meio_da_rodada_para_09_11(tmp_path, monkeypatch):
    liga(tmp_path, monkeypatch)
    erp = ErpDeMentira([venda_com_duas_entradas_do_mes()])
    antigo = erp.pedir_core

    def post_e_quebra(metodo, caminho, corpo=None, params=None):
        r = antigo(metodo, caminho, corpo, params)
        if metodo == "POST":
            (tmp_path / "seguradas.json").write_text("{quebrado", encoding="utf-8")
        return r
    erp.pedir_core = post_e_quebra
    assert RB.rodar(erp, "2026-11", True, None, tmp_path, HOJE, esperar=lambda s: None) == 2
    assert erp.posts == 1


def test_seguradas_json_nao_atrapalha_a_conferencia_de_sem_confirmacao_09_11(tmp_path):
    S.gravar(tmp_path, {"x": {"quem": "ADM"}})
    assert RB._sem_confirmacao_antes(tmp_path, "2026-11") == {}


def test_relatorio_traz_saldo_unidade_e_comprador_separados_09_11(tmp_path, monkeypatch):
    monkeypatch.setattr(RB, "APLICAR", tmp_path / "nao-existe.txt")
    erp = ErpDeMentira([venda_com_uma_entrada_do_mes(nome="COMPRADOR Z")], saldo=77)
    RB.rodar(erp, "2026-11", False, None, tmp_path, HOJE, esperar=lambda s: None)
    rel = _relatorio(tmp_path)
    assert rel["saldo"] == 77
    l = [x for x in rel["linhas"] if x["acao"] == "emitir"][0]
    assert (l["unidade"], l["comprador"]) == ("1", "COMPRADOR Z")


def test_descricao_fora_do_formato_fica_inteira_09_11():
    assert RB._unidade_e_nome("OUTRA COISA") == ("", "OUTRA COISA")
    assert RB._unidade_e_nome("venda unidade 12 - FULANO - B") == ("12", "FULANO - B")
