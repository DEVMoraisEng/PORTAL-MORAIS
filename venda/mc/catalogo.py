# -*- coding: utf-8 -*-
"""Só LEITURA: procura no catálogo do Mais Controle (categorias e naturezas) os itens cujo nome contém um termo
e imprime id e nome. Serve para achar ids de configuração (ex.: NATUREZA_DEVOLUCAO_ID do distrato).

    python -m venda.mc.catalogo devolu
"""
import json
import os
import sys

from . import regras as R
from .erp import Erp, ErpErro


def _itens(resp):
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        return resp.get("content") or resp.get("data") or []
    return []


def buscar(erp, termo: str) -> list[dict]:
    alvo, out = R.chave(termo), []
    for recurso in ("categories", "natures"):
        vistos = set()
        for caminho, params in (("/%s/all" % recurso, None), ("/%s" % recurso, {"page": 0, "size": 2000})):
            try:
                itens = _itens(erp.pedir("GET", caminho, params=params))
            except ErpErro:
                continue
            for it in itens:
                nome = str(it.get("name") or "")
                if it.get("id") in vistos or alvo not in R.chave(nome):
                    continue
                vistos.add(it.get("id"))
                out.append({"lista": recurso, "id": it.get("id"), "nome": nome,
                            "pai": ((it.get("parent") or {}).get("name") if isinstance(it.get("parent"), dict) else None)})
            if vistos:
                break
    return out


def main(argv=None) -> int:
    termo = " ".join((argv if argv is not None else sys.argv[1:])).strip()
    if len(termo) < 3:
        print("informe um termo com 3+ letras")
        return 2
    erp = Erp(os.environ["MC_ROBO_EMAIL"].strip(), os.environ["MC_ROBO_SENHA"].strip(chr(13) + chr(10)),
              aparelho=os.environ.get("MC_ROBO_APARELHO", "").strip())
    achados = buscar(erp, termo)
    print(json.dumps(achados, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
