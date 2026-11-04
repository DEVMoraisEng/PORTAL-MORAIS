# -*- coding: utf-8 -*-
"""Testes do robo_mc_anexos.py sem Mais Controle nem Supabase (ERP e storage falsos)."""
import datetime as dt
import importlib
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
ra = importlib.import_module("robo_mc_anexos")

HOJE = dt.date.today()
D = lambda n: (HOJE - dt.timedelta(days=n)).isoformat()   # noqa: E731


def aud_falsa():
    return {"dict": {"st": ["OK", "DIVERGENTE"]},
            "cols": {"id": [101, 101, 202, 303, 404], "dp": [D(5), D(5), D(40), D(10), D(200)],
                     "st": [1, 1, 0, 0, 1]},
            "fiscal": [["DUP", 3, "x"]]}


class ErpFalso:
    def __init__(self, validade=604800):
        self.validade = validade
        self.pedidos = []

    UU = "%08d-0000-4000-8000-000000000000"

    def pedir(self, metodo, caminho, corpo=None, params=None):
        self.pedidos.append((caminho, params))
        if caminho.startswith("/trade-payables/") or (caminho.startswith("/payable-installments/") and "paginated" not in caminho):
            raise AssertionError("o robô não pode mandar o nº do lançamento nas rotas de UUID: " + caminho)
        if caminho == "/payable-installments/paginated-result":
            if params.get("dateField") == "PLANNED":
                raise RuntimeError("HTTP 400")             # 1ª forma recusada: tenta a próxima
            if params["page"] > 0:
                return {"content": [], "hasNextPage": False}
            return {"content": [{"id": self.UU % n, "plannedDate": "2026-10-01", "value": 10,
                                 "tradePayable": {"id": self.UU % (n + 50), "code": n, "folderId": 9},
                                 "filteredPaids": [{"id": self.UU % (n + 90), "payingDate": "2026-10-01"}]}
                                for n in (101, 303, 555)], "hasNextPage": True}
        if caminho == "/folder":
            if params["origin"] == "TRADE_PAYABLE":
                return [{"id": 5, "files": [{"id": "f%sL" % params["id"][:8], "name": "Boleto 123.pdf", "type": "application/pdf", "sizeInBytes": 10}]}]
            return [{"id": 6}]                         # pasta da baixa sem a lista: o robô abre a pasta
        if caminho == "/folder/6":
            return {"files": [{"id": "fP", "name": "comprovante.jpg", "type": "image/jpeg"},
                              {"id": "tmp", "name": "x", "temporary": True}]}
        if caminho.endswith("/get-url"):
            return {"url": "https://bucket.s3.amazonaws.com/a?X-Amz-Expires=%d&X-Amz-Signature=z" % self.validade}
        raise AssertionError(caminho)

    def fechar(self):
        pass


def test_escolhe_alertas_e_janela():
    alvo = ra.escolher(aud_falsa())
    assert set(alvo) == {101, 303}               # 202 é OK sem alerta; 404 está fora dos 90 dias; 303 tem DUP
    ra.ESCOPO = "todos"
    try:
        assert set(ra.escolher(aud_falsa())) == {101, 202, 303}
    finally:
        ra.ESCOPO = "alertas"


def test_rodada_com_link_longo_do_mc_nao_copia(monkeypatch):
    subidos = []
    monkeypatch.setattr(ra, "sb_subir", lambda *a: subidos.append(a))
    monkeypatch.setattr(ra, "sb_apagar", lambda c: None)
    leitor = ra.LeitorMC(ErpFalso(validade=604800))
    itens, est = ra.rodada(leitor, aud_falsa(), {101: D(5)})
    a = itens["101"]["a"]
    assert {x["o"] for x in a} == {"L", "P"} and len(a) == 2       # temporário fica de fora
    assert all(x["u"].startswith("https://") and not x.get("p") for x in a)
    assert not subidos and est["copiados"] == 0


def test_rodada_com_link_curto_copia_e_assina(monkeypatch):
    class R:
        content = b"%PDF-1.4"
        def raise_for_status(self):
            pass
    subidos = []
    monkeypatch.setattr(ra, "sb_subir", lambda c, b, m: subidos.append(c))
    monkeypatch.setattr(ra, "sb_assinar", lambda c, s=0: "https://sb/assinado/" + c)
    monkeypatch.setattr(ra, "sb_apagar", lambda c: None)
    monkeypatch.setattr(ra.requests, "get", lambda *a, **k: R())
    leitor = ra.LeitorMC(ErpFalso(validade=300))
    itens, est = ra.rodada(leitor, aud_falsa(), {101: D(5)})
    assert est["copiados"] == 2 and len(subidos) == 2
    assert all(x["p"].startswith("auditoria/anexos/101/") for x in itens["101"]["a"])


def test_ja_visto_antigo_so_renova(monkeypatch):
    monkeypatch.setattr(ra, "sb_apagar", lambda c: None)
    erp = ErpFalso()
    leitor = ra.LeitorMC(erp)
    ant = {"anexos": {"itens": {"303": {"v": "x", "a": [{"f": "fZ", "u": "https://velho", "x": "2000-01-01T00:00"}]},
                                 "999": {"v": "x", "a": [{"f": "q", "p": "auditoria/anexos/999/q"}]}}}}
    aud = dict(aud_falsa(), **ant)
    apagados = []
    monkeypatch.setattr(ra, "sb_apagar", lambda c: apagados.extend(c))
    itens, est = ra.rodada(leitor, aud, {303: D(60)})          # pagamento antigo: não consulta o lançamento
    assert not any(c.startswith("/trade-payables/") for c, _ in erp.pedidos)
    assert itens["303"]["a"][0]["u"].startswith("https://bucket")      # link vencido renovado
    assert apagados == ["auditoria/anexos/999/q"]                       # saiu da janela: apaga a cópia


def test_descoberta_acha_o_campo_e_sai_com_codigo(monkeypatch):
    leitor = ra.LeitorMC(ErpFalso())
    assert ra.descobrir(leitor, {101: D(5), 303: D(10)}) == 0
    assert leitor.campo_num == "tradePayable.code"
    assert any("PLANNED" in r for r, _ in leitor.erros_rota)          # o erro da 1ª forma aparece


def test_descoberta_sem_lancamento_sai_com_erro():
    leitor = ra.LeitorMC(ErpFalso())
    assert ra.descobrir(leitor, {999: D(5)}) == 1


def test_validade():
    assert ra.validade_s("https://x/a?X-Amz-Expires=3600") == 3600
    assert ra.validade_s("https://x/a") is None


class ErpComCentroDeCusto(ErpFalso):
    """03/11 (2ª descoberta no servidor): sem costCenterIds o MC recusa a lista; a tela do porteiro pediu com eles."""
    TELA = ("https://legacy-api.maiscontroleerp.com.br/maiscontrole/services/payable-installments/paginated-result"
            "?page=0&size=20&dateField=PLANNED&startDate=2026-11-01&endDate=2026-11-30"
            "&costCenterIds=11111111-0000-4000-8000-000000000000&costCenterIds=22222222-0000-4000-8000-000000000000"
            "&status=OPEN")

    def pedido_da_tela(self, trecho, espera=20.0):
        return self.TELA if trecho in self.TELA else None

    def pedir(self, metodo, caminho, corpo=None, params=None):
        if caminho == "/payable-installments/paginated-result":
            self.pedidos.append((caminho, params))
            if not params.get("costCenterIds"):
                raise RuntimeError('HTTP 400: {"message":"O centro de custo deve ser especificado"}')
            assert params["costCenterIds"] == ["11111111-0000-4000-8000-000000000000", "22222222-0000-4000-8000-000000000000"]
            if params.get("status") == ["OPEN"]:            # só as abertas: nenhuma paga — tenta sem a situação
                return {"content": [], "hasNextPage": False}
            p = dict(params, page=int(params["page"][0]))
            return ErpFalso.pedir(self, metodo, caminho, corpo, dict(p, dateField=None))
        return ErpFalso.pedir(self, metodo, caminho, corpo, params)


def test_lista_copia_os_parametros_da_tela_e_troca_janela_e_pagina():
    erp = ErpComCentroDeCusto()
    leitor = ra.LeitorMC(erp)
    assert ra.descobrir(leitor, {101: D(5), 303: D(10)}) == 0
    assert leitor.params_ok[0] == "da tela, sem filtro de situação"
    q = [p for c, p in erp.pedidos if c == "/payable-installments/paginated-result"][0]
    assert q["dateField"] == ["DATE_OF_PAYMENT"] and q["size"] == ["100"] and q["page"] == ["0"]
    assert q["startDate"] == [(HOJE - dt.timedelta(days=ra.DIAS + 120)).isoformat()]
    assert q["endDate"] == [(HOJE + dt.timedelta(days=30)).isoformat()]
    assert leitor.formato_da_tela()["costCenterIds"] == "uuid×2" and leitor.formato_da_tela()["status"] == "OPEN"
    assert [t[0] for t in leitor.tentativas][:3] == ["da tela, por data de pagamento", "da tela", "da tela, sem filtro de situação"]


class ErpListaSemNumero(ErpFalso):
    """04/11 (3ª descoberta): a lista da tela não traz o nº do lançamento, só tradePayableId (UUID)."""
    def pedido_da_tela(self, trecho, espera=20.0):
        return ("https://legacy-api.maiscontroleerp.com.br/x/payable-installments/paginated-result?page=0&size=20"
                "&dateField=PLANNED&startDate=2026-11-01&endDate=2026-11-30&costCentreType=ALL")

    def pedir(self, metodo, caminho, corpo=None, params=None):
        if caminho == "/payable-installments/paginated-result":
            self.pedidos.append((caminho, params))
            if params["page"] != ["0"]:
                return {"content": [], "hasNextPage": False}
            U = self.UU
            return {"content": [
                {"id": U % 1, "tradePayableId": U % 151, "plannedDate": D(5), "dateOfPayment": D(5), "sumOfPaidValues": 10.0,
                 "remainingValue": 0, "description": "Areia", "filteredPaids": [{"id": U % 191, "payingDate": D(5), "paidValue": 10.0}]},
                {"id": U % 2, "tradePayableId": U % 353, "plannedDate": D(10), "dateOfPayment": D(10), "sumOfPaidValues": 25.5,
                 "remainingValue": 0, "description": "Cimento", "filteredPaids": []},
                {"id": U % 3, "tradePayableId": U % 999, "plannedDate": D(10), "dateOfPayment": D(10), "sumOfPaidValues": 25.5,
                 "remainingValue": 0, "description": "Outra coisa", "filteredPaids": []},          # mesmo dia e valor: desempata
                {"id": U % 4, "tradePayableId": U % 888, "plannedDate": D(3), "sumOfPaidValues": 77.0, "remainingValue": 0}],
                "hasNextPage": False}
        return ErpFalso.pedir(self, metodo, caminho, corpo, params)


def test_casa_pela_data_e_valor_quando_a_lista_nao_tem_o_numero():
    aud = {"dict": {"st": ["OK", "DIVERGENTE"]},
           "cols": {"id": [101, 303, 202], "dp": [D(5), D(10), D(10)], "dv": [D(5), D(10), D(10)], "st": [1, 1, 1],
                    "v": [10.0, 25.5, 25.5], "vp": [10.0, 25.5, 25.5], "d": ["AREIA", "Cimento CP-II", "x"], "nd": ["", "", ""]},
           "fiscal": []}
    alvo = ra.escolher(aud)
    assert set(alvo) == {101, 303, 202}
    aud["cols"]["d"][2] = "outra coisa"
    leitor = ra.LeitorMC(ErpListaSemNumero())
    leitor.preparar_casamento(aud, alvo)
    assert ra.descobrir(leitor, alvo) == 0
    mapa, _ = leitor.mapear(alvo, max_paginas=2)
    assert mapa[101]["tp"] == ErpFalso.UU % 151 and mapa[101]["baixas"] == [ErpFalso.UU % 191]
    assert mapa[202]["tp"] == ErpFalso.UU % 999            # "outra coisa" desempatou com a descrição
    assert 303 not in mapa or mapa[303]["tp"] == ErpFalso.UU % 353
    assert leitor.campo_num is None and leitor.casados >= 2


def test_datas_da_lista_em_texto_viram_iso_e_a_janela_e_a_do_escopo():
    """04/11 (3ª descoberta): 8 páginas lidas e 0 casados — a lista vem como texto e em ordem de data, e a janela
    larga (210 dias) gastava as páginas com parcelas mais velhas que o escopo."""
    assert ra._data_iso("2026-10-05T00:00:00") == "2026-10-05"
    assert ra._data_iso("05/10/2026") == "2026-10-05" and ra._data_iso("") == "" and ra._data_iso(None) == ""
    assert ra._mascara("1.234,56") == "9.999,99" and ra._mascara(None) == "vazio"

    class ErpTexto(ErpListaSemNumero):
        def pedir(self, metodo, caminho, corpo=None, params=None):
            r = ErpListaSemNumero.pedir(self, metodo, caminho, corpo, params)
            if caminho == "/payable-installments/paginated-result":
                for it in r.get("content") or []:
                    for k in ("plannedDate", "dateOfPayment"):
                        if it.get(k):
                            y, m, d = it[k][:10].split("-")
                            it[k] = "%s/%s/%s" % (d, m, y)
                    it["sumOfPaidValues"] = ("%.2f" % it["sumOfPaidValues"]).replace(".", ",")
            return r

    aud = {"dict": {"st": ["OK", "DIVERGENTE"]},
           "cols": {"id": [101, 303], "dp": [D(5), D(10)], "dv": [D(5), D(10)], "st": [1, 1],
                    "v": [10.0, 25.5], "vp": [10.0, 25.5], "d": ["AREIA", "Cimento CP-II"], "nd": ["", ""]},
           "fiscal": []}
    alvo = ra.escolher(aud)
    erp = ErpTexto()
    leitor = ra.LeitorMC(erp)
    leitor.preparar_casamento(aud, alvo)
    assert leitor.janela[0] < min(D(5), D(10)) and max(D(5), D(10)) < leitor.janela[1]
    mapa, _ = leitor.mapear(alvo, max_paginas=2)
    assert mapa[101]["tp"] == ErpFalso.UU % 151
    q = erp.pedidos[0][1]
    assert q["startDate"] == [leitor.janela[0]] and q["endDate"] == [leitor.janela[1]]
