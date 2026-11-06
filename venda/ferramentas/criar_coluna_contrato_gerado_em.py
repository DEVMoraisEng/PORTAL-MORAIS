# -*- coding: utf-8 -*-
"""Coluna CONTRATO - GERADO EM na base BANCO DE DADOS VENDAS (casa de rua) — dono, 05/11/2026.

Gerar o contrato final no portal (venda/GerarContrato.gs, aprovarPreContratoMiolo_) grava nela o momento (data com
hora) e marca RESERVADA = SIM + DATA DA RESERVA. Dela saem as 48 h para todos assinarem (fetch_vendas.py
reserva_contrato, vendas.html, bloco do contrato). Sem a coluna, a geração segue normal (só avisa no log) e a casa
fica na régua de sempre.

Uso (uma vez em cada ambiente: teste e produção):
    py -3.14 venda/ferramentas/criar_coluna_contrato_gerado_em.py <id da base VENDAS> <arquivo do token>
        -> só MOSTRA o que existe e o que falta (padrão; não grava nada)
    py -3.14 venda/ferramentas/criar_coluna_contrato_gerado_em.py <id da base> <arquivo do token> --criar
        -> cria CONTRATO - GERADO EM (tipo Data) se faltar; nada mais é tocado

RESERVADA (Seleção/Status) e DATA DA RESERVA (Data) já são do mapa de vendas: o script só confere e avisa, não cria.
Coluna com o mesmo nome mas de outro tipo NÃO é trocada: o script avisa e para.
O token fica num arquivo fora do repositório; o script nunca o imprime. Repositório público: nenhum dado real aqui.
"""
import argparse
import json
import pathlib
import sys
import unicodedata
import urllib.request

CRIAR = {"CONTRATO - GERADO EM": ["date"]}
CONFERIR = {"RESERVADA": ["select", "status"], "DATA DA RESERVA": ["date"]}
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
    modo.add_argument("--criar", action="store_true", help="cria CONTRATO - GERADO EM se faltar")
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
        print("AVISO: a coluna %s não existe — o contrato gera sem ela (crie à mão, é a do mapa de vendas)" % n)
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
