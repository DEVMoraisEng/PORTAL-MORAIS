#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
completar_vendas.py — PORTAL-MORAIS · VENDAS completada a partir da OBRA

08/10/26 — As linhas de VENDAS ligadas a uma obra (relação OBRA-AUTO) nasciam
com ENDEREÇO, CASA ou SETOR vazios, e ficavam nos alertas "PREENCHER
ENDEREÇO" / "PREENCHER SETOR" mesmo com o valor certo logo ao lado (as colunas
-AUTO). Este script copia, SÓ PARA O QUE ESTÁ VAZIO:

    OBRA-AUTO  (título da obra) -> ENDEREÇO
    CASA-AUTO                   -> CASA
    SETOR-AUTO                  -> SETOR   (só se a opção já existe em VENDAS)

Nunca sobrescreve um valor preenchido e nunca mexe em linha sem obra ligada.
Roda no build do site (pages.yml), antes do fetch_vendas.py, então o alerta
some na mesma publicação. Sem APLICAR=1 é simulação (só imprime).
"""

import os
import sys

from fetch_vendas import ler_banco, api, valor

ID_VENDAS = (os.environ.get("VENDAS_DB_ID") or "33cc5ab532d38047ae3aee8b87ac1f4d").strip()
ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"     # (EMP) Projeto 2.0
APLICAR = os.environ.get("APLICAR", "").strip() == "1"


def N(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def pega(props, nome):
    for k, v in (props or {}).items():
        if N(k) == N(nome):
            return k, v
    return None, None


def vazio(v):
    return v is None or v == "" or v == [] or (isinstance(v, str) and not v.strip())


def primeiro(v):
    """Rollup/fórmula -> primeiro valor simples."""
    if isinstance(v, list):
        for x in v:
            if not vazio(x):
                return x
        return None
    return v


def o_que_preencher(props, titulos_obras, opcoes_setor):
    """Função PURA. `props` = propriedades CRUAS de uma página de VENDAS;
    `titulos_obras` = {id sem hífen: título da obra}; `opcoes_setor` = nomes
    das opções do select SETOR de VENDAS. Devolve ({coluna: valor Notion},
    [descrição curta])."""
    out, desc = {}, []
    _, rel = pega(props, "OBRA-AUTO")
    ids = [str(x.get("id") or "").replace("-", "") for x in ((rel or {}).get("relation") or [])]
    if len(ids) != 1:
        return out, desc                       # sem obra (ou mais de uma): não mexe

    # ENDEREÇO (título)
    k, p = pega(props, "ENDEREÇO")
    titulo = (titulos_obras.get(ids[0]) or "").strip()
    if k and p and p.get("type") == "title" and vazio(valor(p)) and titulo:
        out[k] = {"title": [{"text": {"content": titulo}}]}
        desc.append(f"ENDEREÇO = {titulo}")

    # CASA
    k, p = pega(props, "CASA")
    _, pa = pega(props, "CASA-AUTO")
    casa = primeiro(valor(pa)) if pa else None
    if k and p and p.get("type") == "number" and vazio(valor(p)) and isinstance(casa, (int, float)):
        out[k] = {"number": casa}
        desc.append(f"CASA = {casa:g}")

    # SETOR (select) — só com opção que já existe, na grafia de VENDAS
    k, p = pega(props, "SETOR")
    _, sa = pega(props, "SETOR-AUTO")
    setor = primeiro(valor(sa)) if sa else None
    if k and p and p.get("type") == "select" and vazio(valor(p)) and setor:
        real = next((o for o in opcoes_setor if N(o) == N(setor)), None)
        if real:
            out[k] = {"select": {"name": real}}
            desc.append(f"SETOR = {real}")
        else:
            desc.append(f"! SETOR '{setor}' não existe como opção em VENDAS — não preenchi")
    return out, desc


def titulo_de(props):
    for v in (props or {}).values():
        if (v or {}).get("type") == "title":
            return "".join(x.get("plain_text", "") for x in v.get("title") or [])
    return ""


def main():
    esquema = api("GET", f"/databases/{ID_VENDAS}").get("properties") or {}
    _, defs = pega(esquema, "SETOR")
    opcoes_setor = [o["name"] for o in (((defs or {}).get("select") or {}).get("options") or [])]
    titulos = {pg["id"].replace("-", ""): titulo_de(pg.get("properties")).strip()
               for pg in ler_banco(ID_OBRAS, "OBRAS")}
    mudou = 0
    for pg in ler_banco(ID_VENDAS, "VENDAS"):
        props = pg.get("properties") or {}
        novo, desc = o_que_preencher(props, titulos, opcoes_setor)
        if not desc:
            continue
        nome = titulo_de(props) or titulos.get(
            str(((pega(props, "OBRA-AUTO")[1] or {}).get("relation") or [{}])[0].get("id", "")).replace("-", ""), "?")
        print(f"  {nome}: " + " | ".join(desc), flush=True)
        if novo:
            mudou += 1
            if APLICAR:
                try:
                    api("PATCH", f"/pages/{pg['id']}", {"properties": novo})
                except SystemExit as e:
                    print(f"  ! não gravou: {str(e)[:150]}", flush=True)
    print(("APLICADO" if APLICAR else "SIMULAÇÃO") + f": {mudou} vendas completadas a partir da obra", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
