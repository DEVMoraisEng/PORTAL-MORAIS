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

    def pedir(self, metodo, caminho, corpo=None, params=None):
        self.pedidos.append((caminho, params))
        if caminho.startswith("/trade-payables/"):
            idl = int(caminho.rsplit("/", 1)[1])
            return {"id": idl, "folderId": 9, "installments": [{"id": 1, "paids": [{"id": idl * 10, "payingDate": "2026-10-01"}]}]}
        if caminho == "/folder":
            if params["origin"] == "TRADE_PAYABLE":
                return [{"id": 5, "files": [{"id": "f%sL" % params["id"], "name": "Boleto 123.pdf", "type": "application/pdf", "sizeInBytes": 10}]}]
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


def test_validade():
    assert ra.validade_s("https://x/a?X-Amz-Expires=3600") == 3600
    assert ra.validade_s("https://x/a") is None
