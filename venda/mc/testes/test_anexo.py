# -*- coding: utf-8 -*-
"""Anexo do contrato no recebimento (receita do site do ERP). Sem rede: HTTP falso."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import lancar as L  # noqa: E402
from venda.mc.erp import Erp, ErpErro  # noqa: E402
from venda.mc.testes.test_lancar import ErpFake, NotionFake  # noqa: E402
from venda.mc.testes.test_regras import pagina  # noqa: E402


class Resp:
    def __init__(self, status, corpo=None):
        self.status_code, self._c = status, corpo
        self.text = "" if corpo is None else "x"

    def json(self):
        return self._c


class HttpFake:
    def __init__(self, pastas=None, s3=201, saved=None):
        self.chamadas, self.pastas, self.s3, self.saved = [], pastas, s3, saved

    def request(self, metodo, url, json=None, params=None, headers=None, timeout=None):
        rota = url.split("/services")[1]
        self.chamadas.append((metodo, rota, json, params))
        if rota == "/system-configuration":
            return Resp(200, {"filesBucketURL": "https://bucket.exemplo.test", "filesAccessKey": "AK"})
        if rota.startswith("/sales/"):
            return Resp(200, {"id": "v1", "tradeReceivable": {"id": "tr1"}})
        if rota == "/folder" and metodo == "GET":
            return Resp(200, self.pastas or [])
        if rota == "/folder" and metodo == "POST":
            return Resp(200, {"id": "pasta-nova"})
        if rota == "/file" and metodo == "POST":
            return Resp(200, {"id": "arq1", "key": "k", "policy": "p", "signature": "s", "saved": self.saved})
        if rota == "/file/set-temporary":
            return Resp(200)
        raise AssertionError(rota)

    def post(self, url, data=None, files=None, timeout=None):
        self.chamadas.append(("S3", url, data, list(files)))
        return Resp(self.s3)


def erp_com(http):
    e = Erp("e", "s", sessao=http)
    e.token, e.company_id, e.user_id, e.ou_id = "t", "c", "u", "o"
    return e


def test_anexar_cria_pasta_registra_sobe_e_confirma():
    http = HttpFake()
    assert erp_com(http).anexar("v1", "CONTRATO X.pdf", b"%PDF") == "arq1"
    rotas = [(c[0], c[1]) for c in http.chamadas]
    assert rotas == [("GET", "/system-configuration"), ("GET", "/sales/v1"), ("GET", "/folder"),
                     ("POST", "/folder"), ("POST", "/file"), ("S3", "https://bucket.exemplo.test"),
                     ("PATCH", "/file/set-temporary")]
    assert http.chamadas[3][2] == {"origin": "TRADE_RECEIVABLE_READJUSTED", "tradeReceivable": {"id": "tr1"}}
    assert http.chamadas[4][3] == {"folderId": "pasta-nova"} and http.chamadas[4][2]["sizeInBytes"] == 4
    s3 = dict(http.chamadas[5][2])
    assert s3["AWSAccessKeyId"] == "AK" and s3["key"] == "k" and s3["acl"] == "private"
    assert [k for k, _ in http.chamadas[5][2]][:3] == ["AWSAccessKeyId", "acl", "success_action_status"]
    assert http.chamadas[6][3] == {"fileId": "arq1", "temporary": "false"}


def test_anexar_usa_pasta_existente_e_falha_do_s3_e_erro():
    http = HttpFake(pastas=[{"id": "pasta-velha"}], s3=403)
    try:
        erp_com(http).anexar("v1", "C.pdf", b"x")
        assert False
    except ErpErro as e:
        assert "403" in str(e)
    assert ("POST", "/folder") not in [(c[0], c[1]) for c in http.chamadas]
    assert http.chamadas[3][3] == {"folderId": "pasta-velha"}


class NotionComContrato(NotionFake):
    def __init__(self, props, falha=False):
        super().__init__(props)
        self.props["CONTRATO ASSINADO"] = {"type": "files", "files": [
            {"name": "contrato.pdf", "type": "file", "file": {"url": "https://arquivo.exemplo.test/c.pdf"}}]}
        self.falha = falha

    def baixar(self, url):
        if self.falha:
            raise RuntimeError("download do arquivo -> HTTP 403")
        return b"%PDF-teste"


class ErpAnexa(ErpFake):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.anexos = []

    def anexar(self, venda_id, nome, conteudo, mime="application/pdf"):
        self.anexos.append((venda_id, nome, conteudo))
        return "arq"


def test_venda_criada_anexa_o_contrato_com_nome_padrao():
    n, e = NotionComContrato(pagina()), ErpAnexa()
    L.processar("p1", n, e)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "CRIADA" and r.get("contrato_anexado")
    assert e.anexos == [("venda-nova", "CONTRATO RUA TESTE QD 01 LT 02 CASA 02 - FULANO DE TAL.pdf", b"%PDF-teste")]
    assert "contrato anexado no recebimento" in n.gravado["MC - SITUAÇÃO"]


def test_falha_no_anexo_nao_derruba_a_venda():
    n, e = NotionComContrato(pagina(), falha=True), ErpAnexa()
    L.processar("p1", n, e)
    r = L.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "CRIADA" and "ANEXO_FALHOU" in r["avisos"]
    assert n.gravado["MC - VENDA ID"] == "venda-nova" and "contrato NÃO anexado" in n.gravado["MC - SITUAÇÃO"]


def test_sem_contrato_avisa_e_venda_ja_lancada_so_anexa():
    n, e = NotionFake(pagina()), ErpAnexa()
    L.processar("p1", n, e)
    r = L.processar("p1", n, e, aplicar=True)
    assert "SEM_CONTRATO_PARA_ANEXAR" in r["avisos"] and e.anexos == []
    n2 = NotionComContrato(pagina())
    n2.props["MC - VENDA ID"] = {"type": "rich_text", "rich_text": [{"plain_text": "venda-antiga"}]}
    e2 = ErpAnexa()
    r = L.processar("p1", n2, e2, aplicar=True, anexar=True)
    assert r["situacao"] == "JA_LANCADA" and e2.anexos[0][0] == "venda-antiga" and e2.criados == []
    r = L.processar("p1", n2, ErpAnexa(), aplicar=False, anexar=True)
    assert r["situacao"] == "JA_LANCADA"
