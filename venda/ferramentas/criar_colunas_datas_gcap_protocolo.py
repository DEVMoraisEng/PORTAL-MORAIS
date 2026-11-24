# -*- coding: utf-8 -*-
"""Colunas de data do GCAP e do protocolo de transferência na base BANCO DE DADOS VENDAS (casa de rua) — 24/11/2026.

O painel da casa de rua (vendas.html + venda/painel-casa.js) grava nelas, sozinho, o dia em que alguém marcou SIM em
GEROU E ARMAZENOU GCAP? / PAGOU GCAP? e o dia em que o protocolo de transferência de água/energia foi anexado. A data
aparece embaixo do cartão no Resumo e fica editável no Andamento. Sem as colunas o painel funciona como antes, só não
mostra data.

Uso (uma vez em cada ambiente: teste e produção):
    py -3.14 venda/ferramentas/criar_colunas_datas_gcap_protocolo.py <id da base VENDAS> <arquivo do token>
        -> só MOSTRA o que existe e o que falta (padrão; não grava nada)
    py -3.14 venda/ferramentas/criar_colunas_datas_gcap_protocolo.py <id da base> <arquivo do token> --criar
        -> cria as 4 colunas (tipo Data) que faltarem; nada mais é tocado

Coluna com o mesmo nome mas de outro tipo NÃO é trocada: o script avisa e para.
O token fica num arquivo fora do repositório; o script nunca o imprime. Repositório público: nenhum dado real aqui.
"""
import argparse
import json
import pathlib
import sys
import unicodedata
import urllib.request

CRIAR = {"DATA GEROU GCAP": ["date"], "DATA PAGOU GCAP": ["date"],
         "DATA PROTOCOLO DE TRANS. ÁGUA": ["date"], "DATA PROTOCOLO DE TRANS. ENERGIA": ["date"]}
CONFERIR = {"GEROU E ARMAZENOU GCAP?": ["select", "status"], "PAGOU GCAP?": ["select", "status"]}
NOTION = "https://api.notion.com/v1"
VERSAO = "2022-06-28"


def chave(s):
    """Mesma normalização do RegrasVenda.chave: sem acento, maiúsculas, um espaço."""
    t = unicodedata.normalize("NFD", str(s or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.upper().split())


def plano(propriedades):
    """Devolve {existem, faltam (só as de CRIAR), faltam_conferir, tipo_errado: [(nome, tipo)]}."""
    por_chave = {chave(n): (n, (p or {}).get("type")) for n, p in (propriedades or {}).items()}
    r = {"existem": [], "faltam": [], "faltam_conferir": [], "tipo_errado": []}
    for grupo, destino in ((CRIAR, "faltam"), (CONFERIR, "faltam_conferir")):
        for nome, tipos in grupo.items():
            achou = por_chave.get(chave(nome))
            if not achou:
                r[destino].append(nome)
            elif achou[1] not in tipos:
                r["tipo_errado"].append((achou[0], achou[1]))
            else:
                r["existem"].append(achou[0])
    return r


def corpo_patch(faltam):
    return {"properties": {c: {"date": {}} for c in faltam}}


def _pedir(metodo, caminho, token, corpo=None):
    req = urllib.request.Request(NOTION + caminho, method=metodo,
                                 data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Notion-Version": VERSAO,
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main(argv=None, pedir=_pedir):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base", help="id da base BANCO DE DADOS VENDAS (com ou sem hífens)")
    ap.add_argument("token", help="arquivo com o token do Notion (fora do repositório)")
    modo = ap.add_mutually_exclusive_group()
    modo.add_argument("--ver", action="store_true", help="só mostra (padrão)")
    modo.add_argument("--criar", action="store_true", help="cria as colunas de data que faltarem")
    a = ap.parse_args(argv)
    base = a.base.replace("-", "").strip()
    token = pathlib.Path(a.token).read_text(encoding="utf-8").strip()
    db = pedir("GET", "/databases/" + base, token)
    titulo = "".join(t.get("plain_text", "") for t in (db.get("title") or []))
    p = plano(db.get("properties"))
    print("base:", titulo or base)
    print("já existem:", ", ".join(p["existem"]) or "nenhuma")
    print("faltam:", ", ".join(p["faltam"]) or "nenhuma")
    for n in p["faltam_conferir"]:
        print("AVISO: a coluna %s não existe — o carimbo de data do GCAP não tem de onde partir" % n)
    if p["tipo_errado"]:
        for n, t in p["tipo_errado"]:
            print("ATENÇÃO: a coluna %s existe com o tipo %s — troque à mão no Notion" % (n, t))
        return 2
    if not a.criar:
        if p["faltam"]:
            print("nada gravado (modo --ver). Para criar: repita com --criar")
        return 0
    if not p["faltam"]:
        print("nada a criar")
        return 0
    pedir("PATCH", "/databases/" + base, token, corpo_patch(p["faltam"]))
    print("criada:", ", ".join(p["faltam"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
