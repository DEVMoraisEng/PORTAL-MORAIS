# -*- coding: utf-8 -*-
"""05/11/2026 (dono, CASA DE RUA): contrato assinado por todos -> Orçamento da obra da casa (pasta "Contratos Venda")
e venda lançada sem clique (prévia -> lançamento, com o carimbo). Mesmo processo que o robô do servidor roda pela fila
(venda.mc.lancar e venda.mc.anexos), com Notion e ERP de mentira. Dados inventados."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import anexos as A  # noqa: E402
from venda.mc import lancar as L  # noqa: E402
from venda.mc.erp import Erp, ErpErro  # noqa: E402
from venda.mc.testes.test_lancar import ErpFake, NotionFake, previa_e_lanca  # noqa: E402
from venda.mc.testes.test_regras import pagina, txt  # noqa: E402

OBRA = "RUA TESTE QD 01 LT 02"   # = ENDEREÇO da página de teste (test_regras.pagina)
CONTRATO = "CONTRATO RUA TESTE QD 01 LT 02 CASA 02 - FULANO DE TAL.pdf"
PDF = {"type": "files", "files": [{"name": "CONTRATO ASSINADO - RUA TESTE.pdf", "type": "file", "file": {"url": "https://s3.falso/pdf"}}]}
ZIP_RUA = "CONTRATOS RUA TESTE QD 01 LT 02 CASA 02 - FULANO DE TAL e BELTRANA DE TAL.zip"


class NotionRua(NotionFake):
    """A casa da VENDAS (sem parent do condomínio) — lança e manda arquivos."""

    def __init__(self, props):
        super().__init__(props)
        self.baixados = []

    def baixar(self, url):
        self.baixados.append(url)
        return b"PK-zip" if url.endswith("/zip") else b"%PDF-1.4 assinado"


class ErpRua(ErpFake):
    """ErpFake do lançamento + as pastas de arquivos (recebimento e Orçamento por obra), que guardam o que subiu."""

    def __init__(self, obras=None, orcamentos=None, cabe=True, **kw):
        super().__init__(obras=obras, **kw)
        # pasta "Contratos Venda" de cada obra; obra fora do dicionário = Orçamento sem a pasta
        self.orc = {"obra-1": {"id": "pasta-obra-1", "name": "Contratos Venda", "files": []}} if orcamentos is None else orcamentos
        self.pastas_venda, self.cabe, self.feito = {}, cabe, []

    tem_arquivo = staticmethod(Erp.tem_arquivo)

    def pasta_do_orcamento(self, obra_id, nome):
        self.feito.append(("orcamento", obra_id, nome))
        return self.orc.get(obra_id)

    def pasta_da_venda(self, venda_id, criar=False):
        if venda_id not in self.pastas_venda and criar:
            self.pastas_venda[venda_id] = {"id": "pv-" + venda_id, "files": []}
        return self.pastas_venda.get(venda_id)

    def anexar(self, venda_id, nome, conteudo, mime="application/pdf"):
        self.feito.append(("anexar", venda_id, nome))
        self.pasta_da_venda(venda_id, criar=True)["files"].append({"name": nome})

    def cabe_na_pasta(self, pasta_id, tamanho):
        return self.cabe

    def subir_arquivo(self, pasta_id, nome, conteudo, mime):
        self.feito.append(("subir", pasta_id, nome, mime))
        for p in self.orc.values():
            if p and p.get("id") == pasta_id:
                p["files"].append({"name": nome})


def casa(**mudar):
    return pagina(**dict({"CONTRATO ASSINADO": PDF}, **mudar))


def sit(n):
    return n.props["MC - SITUAÇÃO"]["rich_text"][0]["plain_text"]


def subidos(e):
    return [x for x in e.feito if x[0] in ("subir", "anexar")]


def test_assinada_sem_venda_contrato_vai_ao_orcamento_da_obra_do_endereco(monkeypatch):
    monkeypatch.delenv("MC_PASTA_CONTRATOS_VENDA", raising=False)
    n = NotionRua(casa())
    # obra parecida (outro lote) e o condomínio: só a de nome = ENDEREÇO serve, como no lançamento
    e = ErpRua(obras=[{"id": "obra-x", "name": OBRA + " - B"}, {"id": "obra-1", "name": OBRA}],
               orcamentos={"obra-1": {"id": "pasta-obra-1", "name": "Contratos Venda", "files": []},
                           "obra-x": {"id": "pasta-x", "name": "Contratos Venda", "files": []}})
    r = A.processar("p1", n, e, aplicar=True)
    assert subidos(e) == [("subir", "pasta-obra-1", CONTRATO, "application/pdf")]
    assert "ORCAMENTO_ENVIADO" in r["codigos"] and not r["falhou"]
    assert sit(n) == "ainda não lançada\nContrato no Orçamento: enviado para Orçamento > Arquivos > Contratos Venda"


def test_processo_inteiro_previa_lancamento_anexos_e_nada_repete(monkeypatch):
    """Assinada -> anexos (Orçamento) -> prévia -> lançamento (anexa no recebimento) -> anexos de novo (nada sobe)."""
    monkeypatch.delenv("MC_PASTA_CONTRATOS_VENDA", raising=False)
    n, e = NotionRua(casa()), ErpRua()
    A.processar("p1", n, e, aplicar=True)
    r = previa_e_lanca(n, e)
    assert r["situacao"] == "CRIADA" and r.get("contrato_anexado")
    assert n.gravado["MC - VENDA ID"] == "venda-nova"
    assert [t for t, _ in e.criados].count("venda") == 1
    assert ("anexar", "venda-nova", CONTRATO) in e.feito
    antes = len(subidos(e))
    r2 = A.processar("p1", n, e, aplicar=True)   # o pedido que a vigia faz quando a venda aparece
    assert len(subidos(e)) == antes, "nada sobe de novo"
    assert {"CONTRATO_JA_ANEXADO", "ORCAMENTO_JA_ENVIADO"} <= set(r2["codigos"])
    assert sit(n).startswith("CRIADA | venda venda-nova\n")
    assert "Contrato: anexado no recebimento" in sit(n)
    assert sit(n).endswith("Contrato no Orçamento: enviado para Orçamento > Arquivos > Contratos Venda")
    # e o lançamento de novo (pedido repetido) não relança
    r3 = L.processar("p1", n, e, aplicar=True)
    assert r3["situacao"] == "JA_LANCADA" and [t for t, _ in e.criados].count("venda") == 1


def test_previa_e_bloqueado_nao_gravam_nada(monkeypatch):
    n, e = NotionRua(casa()), ErpRua()
    A.processar("p1", n, e, aplicar=False, bloqueado=True)
    assert subidos(e) == []
    assert "Contrato no Orçamento: não enviado — gravar no Mais Controle está desligado neste ambiente" in sit(n)
    n, e = NotionRua(casa()), ErpRua()
    A.processar("p1", n, e)
    assert subidos(e) == [] and "prévia: iria para Orçamento > Arquivos > Contratos Venda" in sit(n)


def test_pasta_inexistente_ou_obra_errada_vira_erro_claro(monkeypatch):
    n, e = NotionRua(casa()), ErpRua(orcamentos={})
    r = A.processar("p1", n, e, aplicar=True)
    assert r["falhou"] and "ORCAMENTO_SEM_PASTA" in r["codigos"] and subidos(e) == []
    assert ("Contrato no Orçamento: não enviado (o Orçamento da obra não tem a pasta \"Contratos Venda\" em Arquivos — "
            "crie a pasta no Mais Controle e clique em Anexar contrato no Mais Controle)") in sit(n)
    n, e = NotionRua(casa()), ErpRua(obras=[])
    r = A.processar("p1", n, e, aplicar=True)
    assert "ORCAMENTO_SEM_OBRA" in r["codigos"] and ("obra \"%s\" não encontrada no Mais Controle" % OBRA) in sit(n)
    n, e = NotionRua(casa()), ErpRua(obras=[{"id": "obra-1", "name": OBRA}, {"id": "obra-2", "name": OBRA.lower()}])
    A.processar("p1", n, e, aplicar=True)
    assert ("obra \"%s\" repetida no Mais Controle" % OBRA) in sit(n) and subidos(e) == []


def test_duas_pastas_com_o_mesmo_nome_e_sem_espaco_nao_sobem(monkeypatch):
    class Duas(ErpRua):
        def pasta_do_orcamento(self, obra_id, nome):
            raise ErpErro("há 2 pastas \"Contratos Venda\" no Orçamento")
    n, e = NotionRua(casa()), Duas()
    r = A.processar("p1", n, e, aplicar=True)
    assert "ORCAMENTO_FALHOU" in r["codigos"] and "há 2 pastas" in sit(n) and subidos(e) == []
    n, e = NotionRua(casa()), ErpRua(cabe=False)
    A.processar("p1", n, e, aplicar=True)
    assert subidos(e) == [] and "armazenamento" in sit(n)


def test_contrato_ainda_nao_assinado_nada_a_fazer():
    n, e = NotionRua(pagina()), ErpRua()
    r = A.processar("p1", n, e, aplicar=True)
    assert r["codigos"] == ["NADA_A_FAZER"] and e.feito == []


def test_zip_da_casa_de_rua_vai_a_mesma_pasta_da_obra_da_casa(monkeypatch):
    z = {"type": "files", "files": [{"name": ZIP_RUA, "type": "file", "file": {"url": "https://s3.falso/zip"}}]}
    n, e = NotionRua(casa(**{"CONTRATOS ASSINADOS (ZIP)": z})), ErpRua()
    r = A.processar("p1", n, e, aplicar=True)
    assert subidos(e) == [("subir", "pasta-obra-1", CONTRATO, "application/pdf"),
                          ("subir", "pasta-obra-1", ZIP_RUA, "application/zip")]
    assert {"ORCAMENTO_ENVIADO", "ZIP_ENVIADO"} <= set(r["codigos"])
    assert [x for x in e.feito if x[0] == "orcamento"] == [("orcamento", "obra-1", "Contratos Venda")], "uma consulta só"


def test_anotar_falha_troca_tambem_a_linha_do_orcamento():
    n = NotionRua(pagina())
    n.props["MC - SITUAÇÃO"] = txt("ainda não lançada\nContrato no Orçamento: pedido ao robô em 05/11 10:00")
    A.anotar_falha(n, "p1", "o robô falhou (X) — tente de novo pelo botão")
    assert sit(n) == "ainda não lançada\nContrato no Orçamento: o robô falhou (X) — tente de novo pelo botão"
