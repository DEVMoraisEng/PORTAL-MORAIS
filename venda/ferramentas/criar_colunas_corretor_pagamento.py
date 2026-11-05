# -*- coding: utf-8 -*-
"""Colunas de pagamento da comissão na base CORRETORES – CONTRATO (dono, 05/11/2026).

O contrato da CASA DE RUA monta o {{COMISSAO_FORMA}} dos dados do corretor (venda/ContratoVenda.js,
formaComissaoCorretor) e a aba Contrato deixa preencher e "Salvar no cadastro do corretor". Para isso a base
precisa destas 5 colunas de TEXTO: CHAVE PIX, BANCO, AGÊNCIA, CONTA, TITULAR DA CONTA.

Uso (uma vez em cada ambiente: teste e produção):
    py -3.14 venda/ferramentas/criar_colunas_corretor_pagamento.py <id da base CORRETORES> <arquivo do token>
        -> só MOSTRA o que existe e o que falta (padrão; não grava nada)
    py -3.14 venda/ferramentas/criar_colunas_corretor_pagamento.py <id da base> <arquivo do token> --criar
        -> cria as que faltam (PATCH /databases/{id}); as que já existem não são tocadas

Coluna com o mesmo nome mas de outro tipo NÃO é trocada: o script avisa e para (o portal só grava texto).
O token fica num arquivo fora do repositório; o script nunca o imprime. Repositório público: nenhum dado real aqui.
"""
import argparse
import json
import pathlib
import sys
import unicodedata
import urllib.request

COLUNAS = ["CHAVE PIX", "BANCO", "AGÊNCIA", "CONTA", "TITULAR DA CONTA"]
NOTION = "https://api.notion.com/v1"
VERSAO = "2022-06-28"


def chave(s):
    """Mesma normalização do RegrasVenda.chave: sem acento, maiúsculas, um espaço."""
    t = unicodedata.normalize("NFD", str(s or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.upper().split())


def plano(propriedades):
    """propriedades = o "properties" do GET /databases/{id}. Devolve {existem, faltam, tipo_errado: [(nome, tipo)]}."""
    por_chave = {chave(n): (n, (p or {}).get("type")) for n, p in (propriedades or {}).items()}
    existem, faltam, errado = [], [], []
    for c in COLUNAS:
        achou = por_chave.get(chave(c))
        if not achou:
            faltam.append(c)
        elif achou[1] != "rich_text":
            errado.append((achou[0], achou[1]))
        else:
            existem.append(achou[0])
    return {"existem": existem, "faltam": faltam, "tipo_errado": errado}


def corpo_patch(faltam):
    return {"properties": {c: {"rich_text": {}} for c in faltam}}


def _pedir(metodo, caminho, token, corpo=None):
    req = urllib.request.Request(NOTION + caminho, method=metodo,
                                 data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Notion-Version": VERSAO,
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main(argv=None, pedir=_pedir):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base", help="id da base CORRETORES – CONTRATO (com ou sem hífens)")
    ap.add_argument("token", help="arquivo com o token do Notion (fora do repositório)")
    modo = ap.add_mutually_exclusive_group()
    modo.add_argument("--ver", action="store_true", help="só mostra (padrão)")
    modo.add_argument("--criar", action="store_true", help="cria as colunas que faltam")
    a = ap.parse_args(argv)
    base = a.base.replace("-", "").strip()
    token = pathlib.Path(a.token).read_text(encoding="utf-8").strip()
    db = pedir("GET", "/databases/" + base, token)
    titulo = "".join(t.get("plain_text", "") for t in (db.get("title") or []))
    p = plano(db.get("properties"))
    print("base:", titulo or base)
    print("já existem:", ", ".join(p["existem"]) or "nenhuma")
    print("faltam:", ", ".join(p["faltam"]) or "nenhuma")
    if p["tipo_errado"]:
        for n, t in p["tipo_errado"]:
            print("ATENÇÃO: a coluna %s existe com o tipo %s (o portal só grava texto) — troque à mão no Notion" % (n, t))
        return 2
    if not a.criar:
        if p["faltam"]:
            print("nada gravado (modo --ver). Para criar: repita com --criar")
        return 0
    if not p["faltam"]:
        print("nada a criar")
        return 0
    pedir("PATCH", "/databases/" + base, token, corpo_patch(p["faltam"]))
    print("criadas:", ", ".join(p["faltam"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
