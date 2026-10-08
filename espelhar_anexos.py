#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
espelhar_anexos.py — PORTAL-MORAIS (23/09/2026)

Copia os ANEXOS da base LIGAÇÕES DE ÁGUA E ENERGIA (NF MEDIDOR e qualquer
outra coluna de arquivo) para o bucket PRIVADO "anexos" do Supabase Storage.

POR QUE: abrir o PDF pelo portal passava pelo Apps Script, que ia ao Notion
buscar um link novo (o do Notion expira em 1 h). Esse pedido entrava na fila
das leituras, atrás das consultas pesadas, e chegava a levar 2 minutos. Com o
espelho, o Apps Script só ASSINA um link do Supabase (ação ligArquivo) — uma
chamada curta, sem Notion no caminho.

Nada fica público: o bucket é privado e o link assinado vale 15 minutos.

Caminho de cada arquivo:  lig/<id da linha sem hífen>/<COLUNA>/<hash>__<nome>
(o Melhorias.gs monta o MESMO caminho — mexeu num, mexa no outro.)

Um manifesto (anexos/_manifesto.json) guarda o que já foi copiado: cada build
só baixa e sobe o que é NOVO, e apaga do espelho o que saiu do Notion.

Variáveis: NOTION_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY (as mesmas do step
da Análise de Dados).
"""

import hashlib
import json
import os
import re
import time
import unicodedata
from urllib.parse import quote, urlparse

import requests

from fetch_vendas import ler_banco, TOKEN

ID_LIGACOES = "313c5ab532d3801e974ced0bb656c9d5"
BUCKET = "anexos"
MANIFESTO = "_manifesto.json"
LIMITE_NOVOS = 400          # por rodada; o resto entra no build seguinte
ORCAMENTO_S = 6 * 60        # não segura o build mais que isso

SUPA = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def slug(s):
    # igual ao normDist_ do Apps Script: tira só o acento (não outros símbolos)
    t = "".join(ch for ch in unicodedata.normalize("NFD", str(s or "")) if not unicodedata.combining(ch)).upper()
    return re.sub(r"[^A-Z0-9]+", "_", re.sub(r"\s+", " ", t).strip()).strip("_")


def nome_seguro(s):
    t = unicodedata.normalize("NFD", str(s or "arquivo")).encode("ascii", "ignore").decode()
    t = re.sub(r"[^A-Za-z0-9._-]+", "_", t).strip("_")
    return (t or "arquivo")[:120]


def garantir_bucket():
    r = requests.post(f"{SUPA}/storage/v1/bucket", headers=H,
                      json={"id": BUCKET, "name": BUCKET, "public": False}, timeout=30)
    if r.status_code in (200, 201):
        print("  bucket 'anexos' criado (privado).", flush=True)
    # 400/409 = já existe: tudo certo


def ler_manifesto():
    r = requests.get(f"{SUPA}/storage/v1/object/{BUCKET}/{MANIFESTO}", headers=H, timeout=30)
    if r.status_code == 200:
        try:
            return set(json.loads(r.content.decode("utf-8")))
        except Exception:
            pass
    return set()


def gravar_manifesto(caminhos):
    requests.post(f"{SUPA}/storage/v1/object/{BUCKET}/{MANIFESTO}",
                  headers=dict(H, **{"Content-Type": "application/json", "x-upsert": "true"}),
                  data=json.dumps(sorted(caminhos)).encode("utf-8"), timeout=60)


def main():
    if not TOKEN:
        raise SystemExit("Falta o secret NOTION_TOKEN.")
    if not SUPA or not KEY:
        raise SystemExit("Faltam os secrets SUPABASE_URL e/ou SUPABASE_SERVICE_KEY.")
    t0 = time.time()
    garantir_bucket()
    feitos = ler_manifesto()

    atuais = {}      # caminho -> url do Notion
    for pg in ler_banco(ID_LIGACOES, "LIGAÇÕES (anexos)"):
        pid = str(pg.get("id") or "").replace("-", "")
        for col, pp in (pg.get("properties") or {}).items():
            if (pp or {}).get("type") != "files":
                continue
            for f in pp.get("files") or []:
                if f.get("type") != "file":         # link externo já abre rápido
                    continue
                url = (f.get("file") or {}).get("url")
                if not url:
                    continue
                fixo = urlparse(url).path              # sem a assinatura, que muda
                h = hashlib.sha1((pid + "|" + fixo).encode()).hexdigest()[:10]
                caminho = f"lig/{pid}/{slug(col)}/{h}__{nome_seguro(f.get('name'))}"
                atuais[caminho] = url

    novos = [c for c in atuais if c not in feitos]
    print(f"  anexos no Notion: {len(atuais)} | já no espelho: {len(feitos & set(atuais))} | novos: {len(novos)}", flush=True)

    subidos = 0
    for c in novos[:LIMITE_NOVOS]:
        if time.time() - t0 > ORCAMENTO_S:
            print("  tempo da rodada esgotado — o resto sobe no próximo build.", flush=True)
            break
        try:
            b = requests.get(atuais[c], timeout=90)
            if b.status_code != 200:
                continue
            tipo = b.headers.get("Content-Type") or "application/octet-stream"
            r = requests.post(f"{SUPA}/storage/v1/object/{BUCKET}/{quote(c)}",
                              headers=dict(H, **{"Content-Type": tipo, "x-upsert": "true"}),
                              data=b.content, timeout=120)
            if r.status_code in (200, 201):
                feitos.add(c)
                subidos += 1
            else:
                print(f"  ! não subiu ({r.status_code}): {r.text[:120]}", flush=True)
        except Exception as e:
            print(f"  ! falhou: {str(e)[:120]}", flush=True)

    # arquivo removido/trocado no Notion sai do espelho
    sairam = [c for c in feitos if c.startswith("lig/") and c not in atuais]
    for i in range(0, len(sairam), 100):
        requests.delete(f"{SUPA}/storage/v1/object/{BUCKET}", headers=H,
                        json={"prefixes": sairam[i:i + 100]}, timeout=60)
    feitos -= set(sairam)

    gravar_manifesto(feitos)
    print(f"espelho de anexos: {subidos} novos, {len(sairam)} removidos, {len(feitos)} no total "
          f"({int(time.time() - t0)}s)", flush=True)


if __name__ == "__main__":
    main()
