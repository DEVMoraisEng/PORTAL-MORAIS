# -*- coding: utf-8 -*-
"""Sinal confirmado no portal -> venda só com o sinal (venda/mc/sinal.py). Notion e ERP de mentira; dados inventados."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from venda.mc import sinal as S  # noqa: E402
from venda.mc.testes.test_lancar import ErpFake, NotionFake, OBRA  # noqa: E402
from venda.mc.testes.test_regras import pagina, txt  # noqa: E402

VAZIO = {"type": "number", "number": None}


def arq(nome):
    return {"name": nome, "type": "file", "file": {"url": "https://arquivo.exemplo/" + nome}}


class NotionSinal(NotionFake):
    def __init__(self, props, conteudo=b""):
        super().__init__(props)
        self.conteudo = conteudo

    def baixar(self, url):
        return self.conteudo


def pag(**mudar):
    p = pagina(**{"CONTRATO - SINAL VALOR": VAZIO})
    p.update(mudar)
    return p


def pagamentos(*lista):
    return txt(json.dumps([{"id": "a1b2c3d4", "data": d, "valor": v} for d, v in lista]))


def test_valor_do_contrato_vem_primeiro():
    n, e = NotionSinal(pagina()), ErpFake()
    r = S.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "CRIADA" and r["origem"] == "CONTRATO" and r["valor"] == 5000
    venda = [c for t, c in e.criados if t == "venda"][0]
    inst = venda["tradeReceivable"]["installments"]
    assert len(inst) == 1 and inst[0]["plannedValue"] == 5000 and inst[0]["readjustmentDetail"]["type"]["id"] == S.R.TIPO_SINAL
    assert "VALOR A CONFIRMAR" not in venda["description"] and venda["description"].startswith("VENDA CASA 02 - ")
    assert n.gravado["MC - VENDA ID"] == "venda-nova"


def test_sem_contrato_usa_a_soma_dos_pagamentos_do_portal():
    n = NotionSinal(pag(**{"RECEBIMENTO - SINAL PAGAMENTOS": pagamentos(("2026-11-20", 3000), ("2026-11-21", 2000))}))
    r = S.processar("p1", n, ErpFake(), aplicar=True)
    assert r["origem"] == "PORTAL" and r["valor"] == 5000


def test_sem_contrato_nem_portal_le_o_comprovante(monkeypatch):
    monkeypatch.setattr(S.REC, "texto_do_arquivo", lambda c, m: "Comprovante Pix\nValor: R$ 7.500,00\nTarifa: R$ 0,00")
    n = NotionSinal(pag(**{"RECEBIMENTO - SINAL COMPROVANTE": {"type": "files", "files": [arq("Sinal - pix.pdf")]}}), b"%PDF")
    r = S.processar("p1", n, ErpFake(), aplicar=True)
    assert r["origem"] == "COMPROVANTE" and r["valor"] == 7500


def test_sem_nada_legivel_cria_com_um_real_marcado(monkeypatch):
    monkeypatch.setattr(S.REC, "texto_do_arquivo", lambda c, m: "")
    n = NotionSinal(pag(**{"RECEBIMENTO - SINAL COMPROVANTE": {"type": "files", "files": [arq("foto.jpg")]}}))
    e = ErpFake()
    r = S.processar("p1", n, e, aplicar=True)
    assert r["origem"] == "A_CONFIRMAR" and r["valor"] == 1.0 and r["marcado"]
    venda = [c for t, c in e.criados if t == "venda"][0]
    assert venda["description"].endswith("SINAL VALOR A CONFIRMAR")
    assert venda["tradeReceivable"]["installments"][0]["comment"] == "Sinal - VALOR A CONFIRMAR"
    assert S.R.casa_da_descricao(venda["description"]) == 2   # a busca "venda desta casa" continua achando
    assert "VALOR A CONFIRMAR" in n.gravado["MC - SITUAÇÃO"]


def test_venda_ja_anotada_nao_faz_nada():
    n = NotionSinal(pagina())
    n.props["MC - VENDA ID"] = txt("venda-antiga")
    e = ErpFake()
    r = S.processar("p1", n, e, aplicar=True)
    assert r["situacao"] == "JA_LANCADA" and e.criados == [] and n.gravado == {}


def test_venda_da_mesma_casa_no_erp_nao_cria():
    rec = [{"saleId": "v9", "workName": OBRA, "description": "VENDA CASA 02 - OUTRO NOME", "customerName": "X"}]
    e = ErpFake(recebimentos=rec)
    r = S.processar("p1", NotionSinal(pagina()), e, aplicar=True)
    assert r["situacao"] == "JA_EXISTE" and e.criados == []


def test_mesmo_cliente_com_venda_de_outra_casa_lanca():
    rec = [{"saleId": "v9", "workName": OBRA, "description": "VENDA CASA 05 - FULANO DE TAL", "customerName": "X"}]
    e = ErpFake(recebimentos=rec, clientes=[{"id": "cli-1", "cpf": "52998224725"}])
    r = S.processar("p1", NotionSinal(pagina()), e, aplicar=True)
    assert r["situacao"] == "CRIADA" and [t for t, _ in e.criados] == ["venda"]
    assert e.criados[0][1]["customer"] == {"id": "cli-1"}


def test_previa_nao_grava_no_erp():
    n, e = NotionSinal(pagina()), ErpFake()
    r = S.processar("p1", n, e, bloqueado=True)
    assert r["situacao"] == "PREVIA" and r["codigo"] == "BLOQUEADO" and e.criados == []
    assert n.gravado["MC - SITUAÇÃO"].startswith("BLOQUEADO:") and "MC - VENDA ID" not in n.gravado


def test_condominio_fica_fora():
    p = pagina(**{"CONDOMÍNIO - VENDA ID": txt("0123456789abcdef0123456789abcdef")})
    e = ErpFake()
    assert S.processar("p1", NotionSinal(p), e, aplicar=True)["codigo"] == "CONDOMINIO" and e.criados == []


def test_cpf_invalido_recusa_sem_falar_com_o_erp():
    e = ErpFake()
    r = S.processar("p1", NotionSinal(pagina(CPF=txt("111"))), e, aplicar=True)
    assert r["situacao"] == "RECUSADA" and e.criados == []


def test_valor_do_texto():
    assert S.valor_do_texto("Valor: R$ 1.234,56") == 1234.56
    assert S.valor_do_texto("PIX enviado\nR$ 500,00\nData 20/11/2026") == 500.0
    assert S.valor_do_texto("Valor R$ 100,00\nValor R$ 200,00") is None      # dois valores: não chuta
    assert S.valor_do_texto("Saldo R$ 9.999,00\nValor do Pix R$ 300,00") == 300.0
    assert S.valor_do_texto("") is None and S.valor_do_texto("sem número") is None
