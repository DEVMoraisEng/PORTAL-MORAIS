#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_vendas.py — PORTAL-MORAIS
Morais Engenharia e Construção

Lê o Notion (VENDAS + DOCUMENTOS) e publica JSON estático em dist/.
É isto que deixa o portal rápido igual ao RAS-SEMANAL: o navegador baixa
um arquivo pronto em vez de esperar o Apps Script paginar o Notion ao vivo.

O Apps Script continua existindo — ele só cuida de LOGIN e ESCRITA.
Leitura passa a vir daqui.

Variáveis de ambiente (Settings > Secrets and variables > Actions > Secrets):
  NOTION_TOKEN        -> token da integração do Notion   <<< ÚNICO SEGREDO DE VERDADE

Os IDs das bases ficam fixos aqui embaixo de propósito: um ID de base do Notion
não é credencial (sem o token ele não abre nada, e ele já aparece na URL da
página). Deixar como secret só dava trabalho de configuração à toa.
Dá pra sobrescrever por variável de ambiente se algum dia mudar de base.

Saídas:
  dist/schema.json      -> definição das colunas (nome, tipo, opções, editável)
  dist/vendas.json      -> todos os registros de VENDAS
  dist/documentos.json  -> índice endereço -> {habite, obra_iniciada}
  dist/updated.json     -> carimbo de data/hora da última atualização
"""

import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.request

NOTION_VERSION = "2022-06-28"
API = "https://api.notion.com/v1"

# IDs das bases (não são segredo — ver comentário no topo).
# PREENCHER: o ID da base VENDAS está no seu Code.gs, ou na URL da base no
# Notion (o bloco de 32 caracteres depois de /p/ ou do nome do workspace).
ID_VENDAS_PADRAO = "33cc5ab532d38047ae3aee8b87ac1f4d"  # base VENDAS
ID_DOCUMENTOS_PADRAO = "32fc5ab532d380a0900dd7f4bfc619bd"

TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
DB_VENDAS = (os.environ.get("VENDAS_DB_ID") or ID_VENDAS_PADRAO).strip()
DB_DOCS = (os.environ.get("DOCUMENTOS_DB_ID") or ID_DOCUMENTOS_PADRAO).strip()

SAIDA = "dist"

# Tipos que o usuário pode editar pelo site. rollup/formula/relation são
# calculados no Notion — mostramos, mas não deixamos escrever.
TIPOS_EDITAVEIS = {
    "title", "rich_text", "select", "status", "multi_select", "date",
    "checkbox", "number", "url", "email", "phone_number",
}


def norm(s):
    """Maiúsculas sem acento — pra comparar nomes de coluna com segurança.
    A base VENDAS tem typo real ('ENG. RESPONSÁEL'), então nunca comparamos
    string crua."""
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def api(method, path, body=None, tentativas=4):
    """Chamada ao Notion com retry em 429/5xx (o Actions falha feio sem isso)."""
    url = API + path
    dados = json.dumps(body).encode("utf-8") if body is not None else None
    for n in range(tentativas):
        req = urllib.request.Request(url, data=dados, method=method)
        req.add_header("Authorization", "Bearer " + TOKEN)
        req.add_header("Notion-Version", NOTION_VERSION)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            corpo = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503, 504) and n < tentativas - 1:
                espera = 2 ** n
                print(f"  ! HTTP {e.code}, tentando de novo em {espera}s", flush=True)
                time.sleep(espera)
                continue
            raise SystemExit(f"Notion {e.code} em {path}: {corpo}")
        except urllib.error.URLError as e:
            if n < tentativas - 1:
                time.sleep(2 ** n)
                continue
            raise SystemExit(f"Falha de rede em {path}: {e}")


def ler_banco(db_id, rotulo):
    """Pagina o banco inteiro (100 por vez)."""
    paginas, cursor, volta = [], None, 0
    while True:
        corpo = {"page_size": 100}
        if cursor:
            corpo["start_cursor"] = cursor
        r = api("POST", f"/databases/{db_id}/query", corpo)
        paginas.extend(r.get("results", []))
        volta += 1
        print(f"  {rotulo}: {len(paginas)} registros…", flush=True)
        if not r.get("has_more"):
            break
        cursor = r.get("next_cursor")
        if volta > 200:  # trava de segurança contra loop infinito
            print("  ! parei em 200 páginas", flush=True)
            break
    return paginas


def valor(prop):
    """Converte uma propriedade do Notion para um valor simples de JSON.
    Mesmo formato que o front-end já espera do Apps Script."""
    t = prop.get("type")

    if t == "title":
        return "".join(x.get("plain_text", "") for x in prop.get("title", []))
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in prop.get("rich_text", []))
    if t == "select":
        s = prop.get("select")
        return s.get("name") if s else None
    if t == "status":
        s = prop.get("status")
        return s.get("name") if s else None
    if t == "multi_select":
        return [x.get("name") for x in prop.get("multi_select", [])]
    if t == "date":
        d = prop.get("date")
        return d.get("start") if d else None
    if t == "checkbox":
        return bool(prop.get("checkbox"))
    if t == "number":
        return prop.get("number")
    if t in ("url", "email", "phone_number"):
        return prop.get(t)
    if t == "people":
        return [p.get("name") or p.get("id") for p in prop.get("people", [])]
    if t == "files":
        saida = []
        for f in prop.get("files", []):
            # arquivo hospedado no Notion expira; link externo não
            url = (f.get("file") or {}).get("url") or (f.get("external") or {}).get("url")
            saida.append({"name": f.get("name"), "url": url})
        return saida
    if t == "formula":
        f = prop.get("formula", {})
        return f.get(f.get("type"))
    if t == "rollup":
        r = prop.get("rollup", {})
        tr = r.get("type")
        if tr == "array":
            return [valor(x) for x in r.get("array", [])]
        return r.get(tr)
    if t == "relation":
        return [x.get("id") for x in prop.get("relation", [])]
    if t in ("created_time", "last_edited_time"):
        return prop.get(t)
    return None


def montar_schema(db_id):
    r = api("GET", f"/databases/{db_id}")
    campos = []
    for nome, d in (r.get("properties") or {}).items():
        t = d.get("type")
        opcoes = None
        if t in ("select", "status", "multi_select"):
            bloco = d.get(t) or {}
            opcoes = [o.get("name") for o in bloco.get("options", [])]
        campos.append({
            "nome": nome,
            "tipo": t,
            "opcoes": opcoes,
            "editavel": t in TIPOS_EDITAVEIS,
        })
    # ordem alfabética só pra saída ficar estável entre execuções;
    # a ordem de exibição é decidida no front-end
    campos.sort(key=lambda c: norm(c["nome"]))
    return campos


def achar(campos_norm, *fragmentos):
    """Acha o nome real da coluna por pedaço do nome (tolera typo/acento)."""
    for frag in fragmentos:
        alvo = norm(frag)
        for real, n in campos_norm:
            if alvo in n:
                return real
    return None


def gravar(nome, obj):
    caminho = os.path.join(SAIDA, nome)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(caminho) / 1024
    print(f"  -> {caminho} ({kb:.0f} KB)", flush=True)


def main():
    if not TOKEN:
        raise SystemExit(
            "Falta o secret NOTION_TOKEN no GitHub "
            "(Settings > Secrets and variables > Actions)."
        )
    if not DB_VENDAS:
        raise SystemExit(
            "Falta o ID da base VENDAS. Abra fetch_vendas.py e cole o ID em "
            "ID_VENDAS_PADRAO (linha ~40). Ele está no seu Code.gs, ou na URL "
            "da base no Notion: o bloco de 32 caracteres."
        )

    os.makedirs(SAIDA, exist_ok=True)
    agora = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())

    print("Lendo schema de VENDAS…", flush=True)
    campos = montar_schema(DB_VENDAS)
    gravar("schema.json", {"ok": True, "campos": campos, "updated_at": agora})

    print("Lendo registros de VENDAS…", flush=True)
    paginas = ler_banco(DB_VENDAS, "VENDAS")
    vendas = []
    for p in paginas:
        vals = {nome: valor(prop) for nome, prop in (p.get("properties") or {}).items()}
        vendas.append({"id": p["id"], "valores": vals})
    gravar("vendas.json", {
        "ok": True, "total": len(vendas), "vendas": vendas, "updated_at": agora,
    })

    # DOCUMENTOS: usado só pelos contadores "em breve" e "em construção".
    # Publicamos um índice enxuto endereço -> flags, não a base inteira.
    docs_idx = {}
    if DB_DOCS:
        print("Lendo DOCUMENTOS OBRAS…", flush=True)
        cd = montar_schema(DB_DOCS)
        cn = [(c["nome"], norm(c["nome"])) for c in cd]
        c_end = achar(cn, "ENDERECO", "OBRA", "NOME")
        c_hab = achar(cn, "APROVOU HABITE", "HABITE")
        c_obr = achar(cn, "OBRA INICIADA", "OBRA INCIADA")
        print(f"  colunas: endereço={c_end!r} habite={c_hab!r} obra={c_obr!r}", flush=True)

        for p in ler_banco(DB_DOCS, "DOCUMENTOS"):
            props = p.get("properties") or {}
            end = valor(props[c_end]) if c_end and c_end in props else None
            if not end:
                continue
            docs_idx[norm(end)] = {
                "habite": valor(props[c_hab]) if c_hab and c_hab in props else None,
                "obra_iniciada": valor(props[c_obr]) if c_obr and c_obr in props else None,
            }
        gravar("documentos.json", {
            "ok": True, "total": len(docs_idx), "docs": docs_idx,
            "colunas": {"endereco": c_end, "habite": c_hab, "obra_iniciada": c_obr},
            "updated_at": agora,
        })
    else:
        print("DOCUMENTOS_DB_ID não definido — pulando (contadores ficarão em '—').", flush=True)
        gravar("documentos.json", {"ok": False, "docs": {}, "updated_at": agora})

    gravar("updated.json", {"updated_at": agora})
    print(f"OK — {len(vendas)} vendas, {len(docs_idx)} documentos.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
