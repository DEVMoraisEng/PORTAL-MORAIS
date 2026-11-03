# -*- coding: utf-8 -*-
"""Pedido mc-anexos (venda/mc/anexos.py): contrato no recebimento e ZIP no Orçamento. Sem rede; dados inventados."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import anexos as A  # noqa: E402
from venda.mc.erp import Erp, ErpErro  # noqa: E402
from venda.mc.testes.test_anexo import HttpFake, Resp, erp_com  # noqa: E402
from venda.mc.testes.test_condominio import DB_COND, LINHA_ID, NotionLinha, linha_cond  # noqa: E402
from venda.mc.testes.test_regras import txt  # noqa: E402

OBRA_COND = {"id": "obra-cond", "name": "CONDOMÍNIO RESERVA TESTE"}
ZIP_NOME = "Un 12 - FULANA DE TESTE.zip"
CONTRATO = "CONTRATO CONDOMÍNIO RESERVA TESTE CASA 12 - FULANA DE TESTE.pdf"


def zip_col(nome=ZIP_NOME):
    return {"type": "files", "files": [{"name": nome, "type": "file", "file": {"url": "https://s3.falso/zip"}}]}


class NotionAnexos(NotionLinha):
    def __init__(self, props):
        super().__init__(props)
        self.baixados = []

    def baixar(self, url):
        self.baixados.append(url)
        return b"PK-zip-teste" if url.endswith("/zip") else b"%PDF-1.4 assinado"


class ErpArquivos:
    """O que anexos.py usa do Erp: pastas da venda e do Orçamento, subir e anexar."""

    def __init__(self, obras=None, pasta_venda=None, pasta_orc=None, cabe=True, falha_anexo=None):
        self._obras = [OBRA_COND] if obras is None else obras
        self.pasta_venda = pasta_venda   # None = a venda ainda não tem pasta
        self.pasta_orc = {"id": "pasta-cv", "name": "Contratos Venda", "files": []} if pasta_orc is None else pasta_orc
        self.cabe, self.falha_anexo = cabe, falha_anexo
        self.feito = []

    tem_arquivo = staticmethod(Erp.tem_arquivo)

    def obras(self):
        return self._obras

    def pasta_da_venda(self, venda_id, criar=False):
        return self.pasta_venda

    def pasta_do_orcamento(self, obra_id, nome):
        self.feito.append(("orcamento", obra_id, nome))
        return self.pasta_orc or None

    def cabe_na_pasta(self, pasta_id, tamanho):
        return self.cabe

    def anexar(self, venda_id, nome, conteudo):
        if self.falha_anexo:
            raise ErpErro(self.falha_anexo)
        self.feito.append(("anexar", venda_id, nome, conteudo))

    def subir_arquivo(self, pasta_id, nome, conteudo, mime):
        self.feito.append(("subir", pasta_id, nome, conteudo, mime))


def linha(**mudar):
    p = linha_cond(**{"MC - VENDA ID": txt("venda-9"),
                      "MC - SITUAÇÃO": txt("CRIADA | venda venda-9\nParcelas: 3\nContrato: não anexado (coluna CONTRATO ASSINADO vazia)\nTotal: R$ 1,00")})
    p.update(mudar)
    return p


def sit(n):
    return n.gravado.get("MC - SITUAÇÃO", "")


def montar(props, monkeypatch, **erp):
    monkeypatch.setenv("DB_VENDAS_COND", DB_COND)
    n = NotionAnexos(props)
    for k in ("MC - VENDA ID", "MC - SITUAÇÃO"):   # o NotionFake zera as duas ao nascer
        if k in props:
            n.props[k] = props[k]
    return n, ErpArquivos(**erp)


def test_trocar_linha_igual_ao_apps_script():
    assert A.trocar_linha("", "Contrato", "x") == "ainda não lançada\nContrato: x"
    assert A.trocar_linha(A.trocar_linha("", "Contrato", "x"), "Contrato", "y") == "ainda não lançada\nContrato: y"
    assert A.trocar_linha("CRIADA\nContrato: a\nTotal: 1", "Contrato", "b") == "CRIADA\nContrato: b\nTotal: 1"
    assert A.trocar_linha("PRÉVIA OK [#0a1b2c3d]", "Contratos (ZIP)", "ok") == "PRÉVIA OK [#0a1b2c3d]\nContratos (ZIP): ok"
    assert A.trocar_linha("Contrato: cabeçalho", "Contrato", "z") == "Contrato: cabeçalho\nContrato: z"


def test_venda_criada_antes_do_pdf_anexa_agora_e_troca_so_a_linha(monkeypatch):
    n, e = montar(linha(), monkeypatch)
    r = A.processar(LINHA_ID, n, e, aplicar=True)
    assert ("anexar", "venda-9", CONTRATO, b"%PDF-1.4 assinado") in e.feito
    assert "CONTRATO_ANEXADO" in r["codigos"] and not r["falhou"]
    assert sit(n) == "CRIADA | venda venda-9\nParcelas: 3\nContrato: anexado no recebimento\nTotal: R$ 1,00"


def test_contrato_ja_na_pasta_nao_sobe_de_novo(monkeypatch):
    pasta = {"id": "p", "files": [{"name": CONTRATO[:-4], "extension": ".pdf"}]}
    n, e = montar(linha(), monkeypatch, pasta_venda=pasta)
    r = A.processar(LINHA_ID, n, e, aplicar=True)
    assert not [x for x in e.feito if x[0] == "anexar"] and n.baixados == []
    assert "CONTRATO_JA_ANEXADO" in r["codigos"]
    assert "Contrato: anexado no recebimento" in sit(n)


def test_sem_aplicar_e_bloqueado_nao_gravam_no_erp(monkeypatch):
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch)
    A.processar(LINHA_ID, n, e, aplicar=False, bloqueado=True)
    assert [x[0] for x in e.feito] == ["orcamento"]
    assert "Contrato: não anexado — gravar no Mais Controle está desligado" in sit(n)
    assert "Contratos (ZIP): não enviado — gravar no Mais Controle está desligado" in sit(n)


def test_zip_vai_para_a_pasta_contratos_venda_do_orcamento_da_obra(monkeypatch):
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch)
    r = A.processar(LINHA_ID, n, e, aplicar=True)
    assert ("orcamento", "obra-cond", "Contratos Venda") in e.feito
    assert ("subir", "pasta-cv", ZIP_NOME, b"PK-zip-teste", "application/zip") in e.feito
    assert "ZIP_ENVIADO" in r["codigos"]
    assert sit(n).endswith("Contratos (ZIP): enviado para Orçamento > Arquivos > Contratos Venda")
    # de novo, com o ZIP já na pasta: não sobe
    e2 = ErpArquivos(pasta_orc={"id": "pasta-cv", "name": "Contratos Venda", "files": [{"name": ZIP_NOME}]},
                     pasta_venda={"id": "p", "files": [{"name": CONTRATO}]})
    r = A.processar(LINHA_ID, n, e2, aplicar=True)
    assert [x[0] for x in e2.feito] == ["orcamento"] and "ZIP_JA_ENVIADO" in r["codigos"]


def test_zip_sem_pasta_ou_sem_obra_diz_o_que_fazer_e_o_contrato_segue(monkeypatch):
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch, pasta_orc={})
    r = A.processar(LINHA_ID, n, e, aplicar=True)
    assert r["falhou"] and "ZIP_SEM_PASTA" in r["codigos"] and "CONTRATO_ANEXADO" in r["codigos"]
    assert "não tem a pasta \"Contratos Venda\"" in sit(n)
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch, obras=[])
    A.processar(LINHA_ID, n, e, aplicar=True)
    assert "não enviado (obra \"CONDOMÍNIO RESERVA TESTE\" não encontrada" in sit(n)


def test_obra_e_sempre_a_do_endereco_da_venda_e_a_pasta_configuravel(monkeypatch):
    """Revisão 03/11: nada de obra fixa por variável (um 2º condomínio iria para a obra errada)."""
    monkeypatch.setenv("MC_OBRA_CONTRATOS_VENDA", "Condominio Reserva dos Testes")
    monkeypatch.setenv("MC_PASTA_CONTRATOS_VENDA", "Outra Pasta")
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch,
                  obras=[{"id": "o2", "name": "CONDOMÍNIO RESERVA DOS TESTES"}, OBRA_COND])
    A.processar(LINHA_ID, n, e, aplicar=True)
    assert ("orcamento", "obra-cond", "Outra Pasta") in e.feito
    assert not [x for x in e.feito if x[0] == "orcamento" and x[1] == "o2"]


def test_falha_no_anexo_nao_impede_o_zip_e_sem_espaco_nao_sobe(monkeypatch):
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch, falha_anexo="HTTP 500")
    r = A.processar(LINHA_ID, n, e, aplicar=True)
    assert "CONTRATO_FALHOU" in r["codigos"] and "ZIP_ENVIADO" in r["codigos"] and r["falhou"]
    assert "Contrato: não anexado (HTTP 500) — use o botão Anexar contrato" in sit(n)
    n, e = montar(linha(**{"CONTRATOS ASSINADOS (ZIP)": zip_col()}), monkeypatch, cabe=False)
    A.processar(LINHA_ID, n, e, aplicar=True)
    assert not [x for x in e.feito if x[0] == "subir"] and "armazenamento" in sit(n)


def test_venda_nao_lancada_sem_zip_nada_a_fazer(monkeypatch):
    n, e = montar(linha_cond(), monkeypatch)
    r = A.processar(LINHA_ID, n, e, aplicar=True)
    assert r["codigos"] == ["NADA_A_FAZER"] and e.feito == [] and "MC - SITUAÇÃO" not in n.gravado


def test_relê_a_situacao_na_hora_de_gravar(monkeypatch):
    """O lançamento pode ter escrito CRIADA enquanto este pedido esperava: a linha entra no texto NOVO."""
    n, e = montar(linha_cond(**{"MC - VENDA ID": txt("venda-9"), "MC - SITUAÇÃO": txt("PROCESSANDO (lançamento)")}), monkeypatch)
    lido = {"n": 0}
    original = n.pagina

    def pagina(pid):
        lido["n"] += 1
        if lido["n"] > 1:
            n.props["MC - SITUAÇÃO"] = txt("CRIADA | venda venda-9\nContrato: anexado no recebimento")
        return original(pid)
    n.pagina = pagina
    A.processar(LINHA_ID, n, e, aplicar=True)
    assert sit(n) == "CRIADA | venda venda-9\nContrato: anexado no recebimento"


def test_main_so_roda_pelo_porteiro(monkeypatch, capsys):
    monkeypatch.delenv("MC_VIA", raising=False)
    assert A.main(["--page", LINHA_ID, "--aplicar"]) == 2
    assert "SO_PELO_PORTEIRO" in capsys.readouterr().out


def test_anotar_falha_troca_so_as_linhas_pedidas():
    class N:
        def __init__(self):
            self.props = {"MC - SITUAÇÃO": txt("CRIADA | v\nContrato: pedido ao robô em 03/11\nContratos (ZIP): enviado para X")}
            self.gravado = {}

        def pagina(self, pid):
            return {"properties": self.props}

        def gravar_textos(self, pid, props, valores):
            self.gravado.update(valores)
            return []
    n = N()
    A.anotar_falha(n, "p", "o robô falhou (X)")
    assert n.gravado["MC - SITUAÇÃO"] == "CRIADA | v\nContrato: o robô falhou (X)\nContratos (ZIP): enviado para X"


# ---- erp.py: as rotas de arquivos lidas no site (HTTP falso) ----
class HttpPastas(HttpFake):
    def __init__(self, pastas_orc, **kw):
        super().__init__(**kw)
        self.pastas_orc = pastas_orc

    def request(self, metodo, url, json=None, params=None, headers=None, timeout=None):
        rota = url.split("/services")[1]
        if rota == "/folder" and metodo == "GET" and (params or {}).get("origin") == "PLANNING":
            self.chamadas.append((metodo, rota, json, params))
            return Resp(200, self.pastas_orc)
        if rota.startswith("/file/") and "/check-storage-capacity/" in rota:
            self.chamadas.append((metodo, rota, json, params))
            return Resp(200, {"exceedStorageCapacity": False, "totalStorageCapacity": 1})
        return super().request(metodo, url, json, params, headers, timeout)


def test_erp_pasta_do_orcamento_por_nome_e_subir_arquivo():
    pastas = [{"id": "f1", "name": "Projetos", "files": []}, {"id": "f2", "name": "contratos  venda", "files": [{"name": "x"}]}]
    http = HttpPastas(pastas)
    e = erp_com(http)
    p = e.pasta_do_orcamento("obra-1", "Contratos Venda")
    assert p["id"] == "f2"
    assert http.chamadas[0] == ("GET", "/folder", None, {"id": "obra-1", "origin": "PLANNING"})
    assert e.cabe_na_pasta("f2", 123) is True
    assert http.chamadas[1][1] == "/file/f2/check-storage-capacity/123"
    assert e.subir_arquivo("f2", "Un 01 - X.zip", b"PK", "application/zip") == "arq1"
    rotas = [(c[0], c[1]) for c in http.chamadas[2:]]
    assert rotas == [("GET", "/system-configuration"), ("POST", "/file"), ("S3", "https://bucket.exemplo.test"),
                     ("PATCH", "/file/set-temporary")]
    assert http.chamadas[3][2] == {"name": "Un 01 - X.zip", "type": "application/zip", "sizeInBytes": 2}
    assert http.chamadas[3][3] == {"folderId": "f2"}
    assert e.pasta_do_orcamento("obra-1", "Não Existe") is None
    try:
        erp_com(HttpPastas(pastas + [{"id": "f3", "name": "CONTRATOS VENDA"}])).pasta_do_orcamento("o", "Contratos Venda")
        assert False
    except ErpErro as x:
        assert "2 pastas" in str(x)


def test_erp_pasta_da_venda_sem_criar_e_tem_arquivo():
    http = HttpFake()
    assert erp_com(http).pasta_da_venda("v1") is None
    assert ("POST", "/folder") not in [(c[0], c[1]) for c in http.chamadas]
    assert Erp.tem_arquivo({"files": [{"name": "CONTRATO X", "extension": "pdf"}]}, "contrato x.pdf")
    assert Erp.tem_arquivo({"files": [{"name": "Un 01 - Á.zip"}]}, "UN 01 - A.zip")
    assert not Erp.tem_arquivo({"files": [{"name": "outro.pdf"}]}, "contrato x.pdf")
    assert not Erp.tem_arquivo(None, "x")
    # revisão 03/11: registro que ficou de um envio que falhou não conta como enviado
    assert not Erp.tem_arquivo({"files": [{"name": "a.zip", "temporary": True, "sizeInBytes": 10}]}, "a.zip")
    assert not Erp.tem_arquivo({"files": [{"name": "a.zip", "sizeInBytes": 0}]}, "a.zip")
    assert Erp.tem_arquivo({"files": [{"name": "a.zip", "temporary": False, "sizeInBytes": 10}]}, "a.zip")


class HttpFalhaS3(HttpFake):
    """S3 ou set-temporary recusam; o DELETE do registro órfão responde `apaga`."""
    def __init__(self, s3=201, confirma=200, apaga=200):
        super().__init__(s3=s3)
        self.confirma, self.apaga = confirma, apaga

    def request(self, metodo, url, json=None, params=None, headers=None, timeout=None):
        rota = url.split("/services")[1]
        if rota == "/file/delete-batch" and metodo == "DELETE":
            self.chamadas.append((metodo, rota, json, params))
            return Resp(self.apaga, None)
        if rota == "/file/set-temporary" and self.confirma >= 300:
            self.chamadas.append((metodo, rota, json, params))
            return Resp(self.confirma, {"x": 1})
        return super().request(metodo, url, json, params, headers, timeout)


def test_envio_que_falha_apaga_o_registro_orfao_ou_diz_que_ficou():
    for http in (HttpFalhaS3(s3=403), HttpFalhaS3(confirma=500)):
        try:
            erp_com(http).subir_arquivo("f2", "a.zip", b"PK", "application/zip")
            assert False
        except ErpErro as x:
            assert "registro apagado" in str(x), str(x)
        assert ("DELETE", "/file/delete-batch", None, {"fileIds": ["arq1"]}) in http.chamadas
    http = HttpFalhaS3(s3=403, apaga=500)
    try:
        erp_com(http).subir_arquivo("f2", "a.zip", b"PK", "application/zip")
        assert False
    except ErpErro as x:
        assert "ficou na pasta" in str(x) and "apague" in str(x)
