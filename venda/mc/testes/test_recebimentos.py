# -*- coding: utf-8 -*-
"""venda/mc/recebimentos.py — baixas do sinal/entrada e alteração de sinal/financiamento/FGTS (05/11/2026).
Notion e ERP falsos (nenhuma rede). Só dados inventados: o repositório é público."""
import copy
import json

import pytest

from venda.mc import recebimentos as M
from venda.mc import regras as R
from venda.mc.erp import ErpErro

VID = "11111111-2222-3333-4444-555555555555"


def rt(s):
    return {"type": "rich_text", "rich_text": [{"plain_text": s}] if s else []}


def num(v):
    return {"type": "number", "number": v}


def dat(s):
    return {"type": "date", "date": {"start": s} if s else None}


def arqs(*nomes):
    return {"type": "files", "files": [{"name": n, "type": "file", "file": {"url": "https://arquivo.test/" + n}} for n in nomes]}


def props(**x):
    base = {"MC - VENDA ID": rt(VID), "CONTRATO - SINAL VALOR": num(5000), "CONTRATO - ENTRADA VALOR": num(10000),
            "VALOR FINANCIADO": num(150000), "VALOR DO SUBSÍDIO": num(None), "VALOR DO FGTS": num(None),
            "RECEBIMENTO - SINAL PAGAMENTOS": rt(""), "RECEBIMENTO - SINAL COMPROVANTE": arqs(),
            "RECEBIMENTO - ENTRADA PAGAMENTOS": rt(""), "MC - RECEBIMENTOS": rt("")}
    base.update(x)
    return base


def pags(*l):
    return rt(json.dumps([{"id": i, "data": d, "valor": v, "arquivo": a} for i, d, v, a in l]))


def parcela(pid, tipo, valor, data="2026-11-01", recebidos=(), table=None):
    return {"id": pid, "plannedValue": valor, "plannedDate": data,
            "readjustmentDetail": {"type": {"id": tipo}, "table": table, "rawValue": valor, "reference": 0},
            "receipts": [{"id": "r-%s-%d" % (pid, i), "value": v, "receivingDate": d} for i, (v, d) in enumerate(recebidos)],
            "sumOfReceivedValues": sum(v for v, _ in recebidos), "received": sum(v for v, _ in recebidos) >= valor - 0.005}


def venda_base(fgts=False):
    ps = [parcela("p-sinal", R.TIPO_SINAL, 5000.0), parcela("p-entrada", R.TIPO_ENTRADA, 10000.0, "2026-12-01"),
          parcela("p-fin", R.TIPO_FINANCIAMENTO, 150000.0, "2026-12-10")]
    if fgts:
        ps.append(parcela("p-fgts", R.TIPO_FGTS, 20000.0, "2026-12-10"))
    tot = sum(p["plannedValue"] for p in ps)
    return {"id": VID, "date": "2026-11-01", "readjustmentEnabled": True, "description": "VENDA TESTE",
            "tradeReceivable": {"grossValue": tot, "value": tot, "taxWithhold": 0, "numberOfInstallments": len(ps),
                                "defaultAccount": {"id": "conta-padrao", "name": "CONTA PADRAO TESTE"}, "installments": ps}}


class Notion:
    def __init__(self, pr, arquivos=None):
        self.pr = pr
        self.arquivos = arquivos or {}
        self.gravado = {}

    def pagina(self, pid):
        return {"id": pid, "parent": {"database_id": "d" * 32}, "properties": self.pr}

    def baixar(self, url):
        return self.arquivos.get(url.rsplit("/", 1)[-1], b"")

    def gravar_texto_longo(self, pid, props, nome, texto):
        if R.chave(nome) not in {R.chave(k) for k in props}:
            return False
        self.gravado[nome] = texto
        return True

    def gravar_textos(self, pid, props, valores):
        self.gravado.update(valores)
        return []

    def resultado(self):
        return json.loads(self.gravado[M.COL_RESULTADO])


class Erp:
    user_id = "usuario-robo"

    def __init__(self, venda, contas=(), estragar=None, recusar_baixa=False, nao_registra=False):
        self.venda = venda
        self.contas = list(contas)
        self.estragar = estragar
        self.recusar_baixa = recusar_baixa
        self.nao_registra = nao_registra
        self.baixas, self.puts, self.anexos = [], [], []
        self.n = 0

    def ler_venda(self, vid):
        assert vid == VID
        return copy.deepcopy(self.venda)

    def contas_bancarias(self):
        return copy.deepcopy(self.contas)

    def receber_parcela(self, parcela_id, valor, data, conta_id, responsavel_id=""):
        if self.recusar_baixa:
            raise ErpErro("POST /receipt-installments -> HTTP 400: recusado")
        self.baixas.append((parcela_id, valor, data, conta_id))
        if self.nao_registra:
            return {}
        for p in self.venda["tradeReceivable"]["installments"]:
            if p["id"] == parcela_id:
                self.n += 1
                p["receipts"].append({"id": "novo-%d" % self.n, "value": valor, "receivingDate": data})
                p["sumOfReceivedValues"] = round(p["sumOfReceivedValues"] + valor, 2)
                p["received"] = p["sumOfReceivedValues"] >= p["plannedValue"] - 0.005
        return {}

    def alterar_venda(self, vid, corpo):
        self.puts.append(copy.deepcopy(corpo))
        v = copy.deepcopy(corpo)
        for i, p in enumerate(v["tradeReceivable"]["installments"]):
            if not p.get("id"):
                p.update(id="criada-%d" % i, receipts=[], sumOfReceivedValues=0, received=False)
        if self.estragar and len(self.puts) == 1:
            self.estragar(v)
        self.venda = v
        return {}

    def anexar_se_faltar(self, vid, nome, conteudo, mime):
        self.anexos.append((nome, len(conteudo), mime))
        return "ANEXADO"


def rodar(pr, erp, aplicar=True, arquivos=None, tmp_path=None, **kw):
    n = Notion(pr, arquivos)
    guardados = []

    def guardar(v):
        guardados.append(copy.deepcopy(v))
        return "backup-teste.json"
    r = M.processar("page-teste", n, erp, aplicar=aplicar, agora="2026-11-05 10:00", guardar=guardar, **kw)
    return r, n, guardados


# ----------------------------------------------------------------- puro

def test_esperados_financiamento_soma_subsidio_e_vazio_e_none():
    e = M.esperados(props(**{"VALOR DO SUBSÍDIO": num(5000.5), "VALOR DO FGTS": num(None)}))
    assert e == {"SINAL": 5000.0, "ENTRADA": 10000.0, "FINANCIAMENTO": 155000.5, "FGTS": None}


def test_pagamentos_lista_nova_ignora_linha_estragada_e_confirmacao_antiga_vira_um_pagamento():
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": rt(json.dumps([{"id": "a1b2c3", "data": "2026-11-02", "valor": 3000},
                                                                     {"id": "x", "data": "02/11/2026", "valor": 1}]))})
    p = M.pagamentos(pr)
    assert p["SINAL"] == [{"id": "a1b2c3", "data": "2026-11-02", "valor": 3000.0, "arquivo": ""}]
    assert len(p["_avisos"]) == 1
    antigo = props(**{"RECEBIMENTO - ENTRADA PAGAMENTOS": rt(""), "RECEBIMENTO - ENTRADA DATA": dat("2026-10-01"),
                      "RECEBIMENTO - ENTRADA COMPROVANTE": arqs("velho.pdf")})
    e = M.pagamentos(antigo)["ENTRADA"]
    assert e == [{"id": "antigo", "data": "2026-10-01", "valor": 10000.0, "arquivo": "velho.pdf", "antigo": True}]


def test_identificar_conta_por_agencia_e_conta_e_ambiguidade():
    contas = [{"id": "c1", "name": "CONTA UM", "agency": "0123", "account": "45678", "accountDigit": "9"},
              {"id": "c2", "name": "CONTA DOIS", "agency": "0999", "account": "11111", "accountDigit": "0"}]
    txt = "Comprovante Pix\nPagador: banco 001 ag 7777 conta 22222-2\nRecebedor: Agência: 0123 Conta: 45678-9"
    c, motivo = M.identificar_conta(txt, contas)
    assert c["id"] == "c1" and motivo == ""
    assert M.identificar_conta("Agencia 999 conta 45678", contas)[0] is None, "agência de uma, conta de outra"
    dup = contas + [{"id": "c3", "name": "C3", "agency": "123", "account": "45678", "accountDigit": "9"}]
    assert M.identificar_conta(txt, dup) == (None, "mais de uma conta do Mais Controle aparece no comprovante")
    assert M.identificar_conta("", contas)[0] is None


def test_plano_alteracao_fgts_novo_cria_parcela_e_recalcula_total():
    v = venda_base()
    pl = M.plano_alteracao(v, {"SINAL": 5000.0, "ENTRADA": 10000.0, "FINANCIAMENTO": 140000.0, "FGTS": 20000.0})
    assert pl["acao"] == "ALTERAR" and not pl["recusas"]
    assert [(m["item"], m["parcela"], m["de"], m["para"]) for m in pl["mudancas"]] == [
        ("FINANCIAMENTO", "p-fin", 150000.0, 140000.0), ("FGTS", None, 0.0, 20000.0)]
    inst = pl["corpo"]["tradeReceivable"]["installments"]
    novo = [p for p in inst if not p.get("id")][0]
    assert novo["plannedDate"] == "2026-12-10", "o FGTS vence junto com o financiamento"
    assert novo["readjustmentDetail"]["type"]["id"] == R.TIPO_FGTS and novo["readjustmentDetail"]["table"] is None
    assert pl["corpo"]["tradeReceivable"]["grossValue"] == 175000.0
    assert pl["corpo"]["tradeReceivable"]["numberOfInstallments"] == 4
    assert v["tradeReceivable"]["grossValue"] == 165000.0, "a venda original não muda"


def test_plano_alteracao_recusas_entrada_zerar_indice_e_recebido_maior():
    v = venda_base(fgts=True)
    v["tradeReceivable"]["installments"][0]["readjustmentDetail"]["table"] = {"id": "t", "name": "INCC"}
    v["tradeReceivable"]["installments"][2]["receipts"] = [{"id": "r", "value": 100000, "receivingDate": "2026-12-10"}]
    v["tradeReceivable"]["installments"][2]["sumOfReceivedValues"] = 100000
    pl = M.plano_alteracao(v, {"SINAL": 6000.0, "ENTRADA": 12000.0, "FINANCIAMENTO": 90000.0, "FGTS": 0.0})
    assert pl["acao"] == "NADA"
    assert set(pl["recusas"]) == {"SINAL", "FINANCIAMENTO", "FGTS"}
    assert "índice" in pl["recusas"]["SINAL"] and "já recebeu" in pl["recusas"]["FINANCIAMENTO"]
    assert "não apaga" in pl["recusas"]["FGTS"]
    assert "Entrada" in pl["avisos"][0] and "não altera" in pl["avisos"][0]


# ----------------------------------------------------------------- fluxo (prévia e aplicar)

def test_sinal_3k_mais_2k_duas_baixas_parciais_com_conta_do_comprovante_e_anexo(monkeypatch):
    monkeypatch.setattr(M, "texto_do_arquivo", lambda c, m: c.decode())
    contas = [{"id": "c-obra", "name": "CONTA DA OBRA TESTE", "agency": "4321", "account": "98765", "accountDigit": "0"}]
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 3000, "Sinal aaa111 - comp.pdf"),
                                                          ("bbb222", "2026-11-04", 2000, "")),
                  "RECEBIMENTO - SINAL COMPROVANTE": arqs("Sinal aaa111 - comp.pdf")})
    arquivos = {"Sinal aaa111 - comp.pdf": b"Recebedor agencia 4321 conta 98765-0"}
    erp = Erp(venda_base(), contas)

    r, n, _ = rodar(pr, erp, aplicar=False, arquivos=arquivos)
    assert r["situacao"] == "PREVIA" and erp.baixas == [] and erp.anexos == []
    s = n.resultado()["itens"]["SINAL"]
    assert s["situacao"] == "PREVIA" and s["pagamentos"]["aaa111"]["conta"] == "CONTA DA OBRA TESTE"
    assert "conta padrão (sem comprovante)" in s["pagamentos"]["bbb222"]["texto"]

    r, n, _ = rodar(pr, erp, aplicar=True, arquivos=arquivos)
    assert r["situacao"] == "OK", r
    assert erp.baixas == [("p-sinal", 3000.0, "2026-11-02", "c-obra"), ("p-sinal", 2000.0, "2026-11-04", "conta-padrao")]
    assert erp.anexos == [("COMPROVANTE SINAL 2026-11-02 aaa111.pdf", len(arquivos["Sinal aaa111 - comp.pdf"]), "application/pdf")]
    res = n.resultado()["itens"]["SINAL"]
    assert res["situacao"] == "BAIXADO"
    assert res["pagamentos"]["aaa111"]["recibos"] == ["novo-1"] and res["pagamentos"]["aaa111"]["anexo"] == "ANEXADO"
    assert res["mc"] == {"previsto": 5000.0, "recebido": 5000.0, "parcelas": 1}

    # rodar de novo (com o resultado gravado) não baixa nada outra vez
    pr2 = dict(pr, **{"MC - RECEBIMENTOS": rt(n.gravado[M.COL_RESULTADO])})
    r, n2, _ = rodar(pr2, erp, aplicar=True, arquivos=arquivos)
    assert r["situacao"] == "OK" and len(erp.baixas) == 2
    assert n2.resultado()["itens"]["SINAL"]["situacao"] == "BAIXADO"


def test_baixa_ja_feita_a_mao_com_mesma_data_e_valor_nao_duplica_e_baixa_diferente_trava_o_item():
    v = venda_base()
    v["tradeReceivable"]["installments"][0] = parcela("p-sinal", R.TIPO_SINAL, 5000.0, recebidos=[(3000.0, "2026-11-02")])
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 3000, ""), ("bbb222", "2026-11-04", 2000, ""))})
    erp = Erp(v)
    r, n, _ = rodar(pr, erp)
    assert erp.baixas == [("p-sinal", 2000.0, "2026-11-04", "conta-padrao")]
    assert n.resultado()["itens"]["SINAL"]["pagamentos"]["aaa111"]["texto"] == "já estava baixado no Mais Controle"
    # no MC há uma baixa de outro valor que o portal não tem: nada é baixado no item
    v2 = venda_base()
    v2["tradeReceivable"]["installments"][0] = parcela("p-sinal", R.TIPO_SINAL, 5000.0, recebidos=[(2500.0, "2026-11-01")])
    erp2 = Erp(v2)
    r, n, _ = rodar(pr, erp2)
    assert erp2.baixas == []
    s = n.resultado()["itens"]["SINAL"]
    assert s["situacao"] == "RECUSADO" and "não está no portal" in s["texto"]


def test_pagamento_que_passa_da_parcela_e_recusado_e_os_outros_seguem():
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 4000, ""), ("bbb222", "2026-11-04", 2000, ""))})
    erp = Erp(venda_base())
    r, n, _ = rodar(pr, erp)
    assert erp.baixas == [("p-sinal", 4000.0, "2026-11-02", "conta-padrao")]
    s = n.resultado()["itens"]["SINAL"]
    assert s["pagamentos"]["bbb222"]["situacao"] == "RECUSADO" and "passa do que falta" in s["pagamentos"]["bbb222"]["texto"]


def test_sinal_maior_no_portal_altera_antes_de_baixar_e_guarda_a_venda():
    pr = props(**{"CONTRATO - SINAL VALOR": num(6000),
                  "RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 3000, ""), ("bbb222", "2026-11-04", 3000, ""))})
    erp = Erp(venda_base())
    r, n, guardados = rodar(pr, erp, aplicar=False)
    assert erp.puts == [] and guardados == []
    s = n.resultado()["itens"]["SINAL"]
    assert s["pagamentos"]["bbb222"]["situacao"] == "PREVIA", "a prévia planeja a baixa sobre a venda já alterada"
    r, n, guardados = rodar(pr, erp)
    assert r["situacao"] == "OK", r
    assert len(guardados) == 1 and guardados[0]["tradeReceivable"]["installments"][0]["plannedValue"] == 5000.0
    assert len(erp.puts) == 1 and erp.venda["tradeReceivable"]["grossValue"] == 166000.0
    assert [b[1] for b in erp.baixas] == [3000.0, 3000.0]


def test_fgts_novo_cria_parcela_no_mc_e_confere():
    pr = props(**{"VALOR DO FGTS": num(20000), "VALOR FINANCIADO": num(130000)})
    erp = Erp(venda_base())
    r, n, guardados = rodar(pr, erp)
    assert r["situacao"] == "OK", r
    fg = [p for p in erp.venda["tradeReceivable"]["installments"] if p["readjustmentDetail"]["type"]["id"] == R.TIPO_FGTS]
    assert len(fg) == 1 and fg[0]["plannedValue"] == 20000.0
    res = n.resultado()["itens"]
    assert res["FGTS"]["situacao"] == "ALTERADO" and "(parcela nova)" in res["FGTS"]["texto"]
    assert res["FINANCIAMENTO"]["situacao"] == "ALTERADO"
    assert res["FGTS"]["mc"]["previsto"] == 20000.0
    assert len(guardados) == 1


def test_divergencia_na_releitura_desfaz_com_o_json_guardado_e_nao_baixa():
    def estragar(v):   # o ERP "arredondou" o financiamento
        for p in v["tradeReceivable"]["installments"]:
            if p["id"] == "p-fin":
                p["plannedValue"] = 139999.0
    pr = props(**{"VALOR FINANCIADO": num(140000), "RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 5000, ""))})
    original = venda_base()
    erp = Erp(copy.deepcopy(original), estragar=estragar)
    r, n, guardados = rodar(pr, erp)
    assert r["situacao"] == "ERRO" and r["codigo"] == "ALTERACAO_FALHOU"
    assert len(erp.puts) == 2 and erp.puts[1] == guardados[0], "o segundo PUT é o JSON guardado antes"
    assert M.mesma_venda(erp.venda, original)
    assert erp.baixas == [], "com a alteração desfeita, nada é baixado"
    assert "DESFEITA" in n.resultado()["itens"]["FINANCIAMENTO"]["texto"]


def test_baixa_que_nao_aparece_na_releitura_vira_erro_e_para_o_item():
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 3000, ""), ("bbb222", "2026-11-04", 2000, ""))})
    erp = Erp(venda_base(), nao_registra=True)
    r, n, _ = rodar(pr, erp)
    assert r["situacao"] == "ERRO" and len(erp.baixas) == 1
    s = n.resultado()["itens"]["SINAL"]["pagamentos"]
    assert s["aaa111"]["situacao"] == "ERRO" and s["bbb222"]["situacao"] == "AGUARDANDO"


def test_bloqueado_sem_venda_id_e_pagina_de_outra_base(monkeypatch):
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 3000, ""))})
    erp = Erp(venda_base())
    r, n, _ = rodar(pr, erp, aplicar=False, bloqueado=True)
    assert r["codigo"] == "BLOQUEADO" and erp.baixas == []
    assert n.resultado()["itens"]["SINAL"]["pagamentos"]["aaa111"]["texto"].startswith("BLOQUEADO")
    r, n, _ = rodar(props(**{"MC - VENDA ID": rt("")}), erp)
    assert r["codigo"] == "SEM_VENDA_ID"
    monkeypatch.setenv("DB_VENDAS", "e" * 32)
    r, n, _ = rodar(pr, erp)
    assert r["codigo"] == "PAGINA_FORA_DE_VENDAS" and erp.baixas == []


def test_backup_nunca_dentro_do_repositorio(monkeypatch, tmp_path):
    monkeypatch.setenv("MC_BACKUP_VENDAS", str(M.RAIZ_REPO / "dist"))
    with pytest.raises(M.Recusa):
        M.guardar_venda({"id": VID}, "2026-11-05 10:00")
    monkeypatch.setenv("MC_BACKUP_VENDAS", str(tmp_path / "b"))
    caminho = M.guardar_venda(venda_base(), "2026-11-05 10:00")
    assert json.loads(open(caminho, encoding="utf-8").read()) == venda_base()


def test_stdout_sem_valores(capsys, monkeypatch):
    monkeypatch.setattr(M, "do_ambiente", lambda: Erp(venda_base()))
    pr = props(**{"RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 3000, ""))})
    import venda.mc.notion as N
    monkeypatch.setattr(N, "Notion", lambda tok: Notion(pr))
    monkeypatch.setenv("NOTION_TOKEN", "falso")
    monkeypatch.setenv("MC_VIA", "porteiro")
    assert M.main(["--page", "page-teste"]) == 0
    out = capsys.readouterr().out
    assert "3000" not in out and "3.000" not in out and json.loads(out.strip().splitlines()[-1])["situacao"] == "PREVIA"


def test_alteracao_que_falha_mantem_anotadas_as_baixas_da_rodada_anterior():
    ant = {"v": 1, "situacao": "OK", "itens": {"SINAL": {"situacao": "BAIXADO", "pagamentos": {
        "aaa111": {"situacao": "BAIXADO", "recibos": ["r-p-sinal-0"], "conta": "CONTA PADRAO TESTE"}}}}}
    v = venda_base()
    v["tradeReceivable"]["installments"][0] = parcela("p-sinal", R.TIPO_SINAL, 5000.0, recebidos=[(5000.0, "2026-11-02")])

    def estragar(x):
        x["tradeReceivable"]["installments"][2]["plannedValue"] = 1.0
    pr = props(**{"VALOR FINANCIADO": num(140000), "MC - RECEBIMENTOS": rt(json.dumps(ant)),
                  "RECEBIMENTO - SINAL PAGAMENTOS": pags(("aaa111", "2026-11-02", 5000, ""))})
    r, n, _ = rodar(pr, Erp(v, estragar=estragar))
    assert r["situacao"] == "ERRO"
    assert n.resultado()["itens"]["SINAL"]["pagamentos"]["aaa111"]["recibos"] == ["r-p-sinal-0"]
