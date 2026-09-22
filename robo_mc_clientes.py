#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_clientes.py — PORTAL-MORAIS · proprietários pelo cadastro do Mais Controle

1. Entra no MC → Contatos → Clientes e lê todos os clientes cujo SETOR não é
   "Casa" (esses são os proprietários/investidores; "Casa" são compradores).
2. Abre o cadastro de cada um e lê o nome e o CPF/CNPJ.
3. Compara com o cadastro de proprietários do Notion (PROPRIETARIOS_PAI):
     - acha pelo documento; se não achar, pelo nome;
     - NOME diferente do MC  -> corrige o nome no cadastro E troca o nome
       antigo pelo novo em Proprietário / Proprietário Real das obras e em
       PROPRIETARIO DOCUMENTO / PROPRIETARIO REAL de DOCUMENTOS (a ligação
       obra ↔ cadastro é pelo nome — renomear só o cadastro quebraria);
     - CPF/CNPJ diferente ou vazio -> grava o do MC;
     - cliente do MC que não está no cadastro -> cria a linha;
     - linha do cadastro sem par no MC -> só lista, para você decidir.
Sem APLICAR=1 é simulação: lê tudo e só imprime o que faria.
"""

import sys

from playwright.sync_api import sync_playwright

from robo_mc_comum import (N, so_digitos, foto, esperar, abrir, login, ir_menu, ler_tabela, maior_pagina,
                           proxima_pagina, valor_por_rotulo, radios_marcados, APLICAR, SAIDA)
from fetch_vendas import ler_banco, api

ID_CADASTRO = "3e2c5ab532d38055a241db35f74e7bbc"
ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"
ID_DOCS = "32fc5ab532d380a0900dd7f4bfc619bd"


# ---------------------------------------------------------------- MC
def ler_clientes_mc(page):
    ir_menu(page, "Contatos", "Clientes")
    foto(page, "clientes_lista")
    maior_pagina(page)
    vistos, lista, voltas = set(), [], 0
    while voltas < 50:
        voltas += 1
        t = ler_tabela(page)
        if not t:
            raise SystemExit("Não achei a tabela de clientes — rode com DESCOBRIR=1 e me mande mc_evidencias.")
        cab = [N(c) for c in t["cab"]]
        i_nome = next((i for i, c in enumerate(cab) if c.startswith("NOME")), 1)
        i_setor = next((i for i, c in enumerate(cab) if c.startswith("SETOR")), None)
        novos = 0
        for l in t["linhas"]:
            if len(l) <= i_nome:
                continue
            nome = l[i_nome].strip()
            setor = l[i_setor].strip() if i_setor is not None and len(l) > i_setor else ""
            if not nome or N(nome) in vistos:
                continue
            vistos.add(N(nome))
            novos += 1
            lista.append({"nome": nome, "setor": setor})
        if not novos or not proxima_pagina(page):
            break
    print(f"MC: {len(lista)} clientes na lista", flush=True)
    return lista


def ler_cadastro(page, nome):
    """Abre o cadastro de um cliente pela busca da lista e lê nome/documento."""
    busca = page.locator("input[placeholder*=busca i], input[placeholder*=Digite i]").first
    busca.fill("")
    busca.fill(nome)
    esperar(page)
    page.wait_for_timeout(1500)
    alvo = page.locator("table tbody tr").filter(has_text=nome).first
    alvo.locator("td").nth(1).click()
    esperar(page)
    page.wait_for_timeout(1500)
    foto(page, "cadastro_" + N(nome)[:30].replace(" ", "_"), sensivel=True)
    tipo = radios_marcados(page)
    nome_mc = valor_por_rotulo(page, ["Nome Completo", "Razão Social", "Nome"]) or nome
    doc = valor_por_rotulo(page, ["CNPJ", "CPF", "CPF/CNPJ"]) or ""
    page.go_back()
    esperar(page)
    page.wait_for_timeout(1200)
    return {"nome": nome_mc.strip(), "doc": doc.strip(), "tipo": tipo}


# ---------------------------------------------------------------- Notion
def titulo_de(props):
    for v in (props or {}).values():
        if (v or {}).get("type") == "title":
            return "".join(x.get("plain_text", "") for x in v.get("title") or [])
    return ""


def texto_de(p):
    t = (p or {}).get("type")
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in p.get("rich_text") or [])
    if t == "select":
        return ((p.get("select") or {}).get("name")) or ""
    return ""


def col_real(props, nome):
    for k in (props or {}):
        if N(k) == N(nome):
            return k
    return None


def patch(pid, props):
    api("PATCH", f"/pages/{pid}", {"properties": props})


def sincronizar(clientes):
    cad = ler_banco(ID_CADASTRO, "CADASTRO")
    col_tit = col_cpf = None
    if cad:
        p0 = cad[0].get("properties") or {}
        col_tit = next((k for k, v in p0.items() if v.get("type") == "title"), None)
        col_cpf = col_real(p0, "CPF/CNPJ")
    por_doc, por_nome = {}, {}
    for r in cad:
        pr = r.get("properties") or {}
        nome, doc = titulo_de(pr), texto_de(pr.get(col_cpf)) if col_cpf else ""
        item = {"id": r["id"], "nome": nome, "doc": doc, "casou": False}
        if so_digitos(doc):
            por_doc[so_digitos(doc)] = item
        por_nome[N(nome)] = item

    renomear, log = {}, []
    for c in clientes:
        d = so_digitos(c["doc"])
        alvo = por_doc.get(d) if d else None
        alvo = alvo or por_nome.get(N(c["nome"]))
        if not alvo:
            log.append(f"CRIAR no cadastro: {c['nome']} ({c['doc'] or 'sem documento'})")
            if APLICAR and col_tit:
                props = {col_tit: {"title": [{"text": {"content": c["nome"]}}]}}
                if col_cpf:
                    props[col_cpf] = {"rich_text": [{"text": {"content": c["doc"]}}]}
                api("POST", "/pages", {"parent": {"database_id": ID_CADASTRO}, "properties": props})
            continue
        alvo["casou"] = True
        props = {}
        if c["nome"] and c["nome"] != alvo["nome"]:
            log.append(f"RENOMEAR: {alvo['nome']}  ->  {c['nome']}")
            renomear[alvo["nome"]] = c["nome"]
            props[col_tit] = {"title": [{"text": {"content": c["nome"]}}]}
        if d and so_digitos(alvo["doc"]) != d and col_cpf:
            log.append(f"DOCUMENTO: {c['nome']}  {alvo['doc'] or '(vazio)'}  ->  {c['doc']}")
            props[col_cpf] = {"rich_text": [{"text": {"content": c["doc"]}}]}
        if props and APLICAR:
            patch(alvo["id"], props)

    # o nome antigo nas obras e em DOCUMENTOS passa para o nome do MC
    if renomear:
        for db, cols in [(ID_OBRAS, ["Proprietário", "Proprietário Real"]),
                         (ID_DOCS, ["PROPRIETARIO DOCUMENTO", "PROPRIETARIO REAL"])]:
            trocas = 0
            for pg in ler_banco(db, "renomear"):
                pr = pg.get("properties") or {}
                props = {}
                for c in cols:
                    k = col_real(pr, c)
                    if not k or pr[k].get("type") != "select":
                        continue
                    atual = texto_de(pr[k])
                    for velho, novo in renomear.items():
                        if atual and N(atual) == N(velho):
                            props[k] = {"select": {"name": novo.replace(",", " ")}}
                if props:
                    trocas += 1
                    if APLICAR:
                        patch(pg["id"], props)
            log.append(f"{'Trocado' if APLICAR else 'Trocaria'} o nome em {trocas} páginas de {'OBRAS' if db == ID_OBRAS else 'DOCUMENTOS'}")

    sem_par = [i["nome"] for i in por_nome.values() if not i["casou"]]
    print(("APLICADO" if APLICAR else "SIMULAÇÃO — nada gravado") + f": {len(log)} ações", flush=True)
    for l in log:
        print("  " + l, flush=True)
    if sem_par:
        print(f"\nNo cadastro e SEM par no MC ({len(sem_par)}) — confira:", flush=True)
        for n in sorted(sem_par):
            print("  - " + n, flush=True)


def main():
    with sync_playwright() as p:
        b, page = abrir(p)
        try:
            login(page)
            lista = ler_clientes_mc(page)
            props = [x for x in lista if N(x["setor"]) != "CASA"]
            print(f"MC: {len(props)} clientes com setor diferente de Casa", flush=True)
            clientes = []
            for x in props:
                try:
                    clientes.append(ler_cadastro(page, x["nome"]))
                except Exception as e:
                    print(f"  ! não consegui abrir o cadastro de {x['nome']}: {str(e)[:120]}", flush=True)
                    foto(page, "erro_cadastro")
                    ir_menu(page, "Contatos", "Clientes")
                    maior_pagina(page)
            print(f"MC: {len(clientes)} cadastros lidos", flush=True)
        finally:
            b.close()
    sincronizar(clientes)


if __name__ == "__main__":
    sys.exit(main())
