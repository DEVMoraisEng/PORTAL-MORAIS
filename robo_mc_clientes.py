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

# Clientes do MC que NÃO são proprietários, mesmo com setor diferente de
# "Casa" (fornecedor, investidor avulso…). Nome como está no MC.
NAO_SAO_PROPRIETARIOS = [
]

# Nome curto (Proprietário Real) -> nome do cadastro, quando o robô não tem
# como adivinhar sozinho. Decidido em set/26.
DE_PARA_CURTOS = {
    "MOURA": "MOURA DANTAS EMPREENDIMENTOS LTDA",
    "RENATO SANTOS": "KARLLA FLEURY SOARES ARAUJO",
    "RENATOS SANTOS E ESPOSA": "KARLLA FLEURY SOARES ARAUJO",
}


def nome_limpo(s):
    """Nome no padrão do cadastro: MAIÚSCULAS e um espaço só. O MC tem nomes
    em minúsculas ("julivaldo Tobias Martins") e com espaço duplo — isso não é
    nome diferente, é digitação."""
    return " ".join(str(s or "").upper().split())


def mascarar(doc):
    """O log do Actions é visível a quem acessa o repositório: CPF/CNPJ nunca
    sai inteiro nele."""
    d = so_digitos(doc)
    return f"***{d[-4:]}" if d else "sem documento"


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
    """Abre o cadastro de um cliente pela busca da lista e lê nome/documento.
    RÁPIDO: espera o elemento certo aparecer, e não a rede "parar" — o MC fica
    fazendo chamadas o tempo todo, e esperar a rede parar custava ~15 s por
    passo (era isso que fazia a rodada levar mais de 20 min)."""
    busca = page.locator("input[placeholder*=busca i], input[placeholder*=Digite i]").first
    busca.fill(nome)
    alvo = page.locator("table tbody tr").filter(has_text=nome).first
    alvo.wait_for(state="visible", timeout=15000)
    alvo.locator("td").nth(1).click()
    page.get_by_text("Cadastro de Cliente", exact=False).first.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(700)      # os campos são preenchidos logo depois do título
    foto(page, "cadastro_" + N(nome)[:30].replace(" ", "_"), sensivel=True)
    tipo = radios_marcados(page)
    nome_mc = valor_por_rotulo(page, ["Nome Completo", "Razão Social", "Nome"]) or nome
    doc = valor_por_rotulo(page, ["CNPJ", "CPF", "CPF/CNPJ"]) or ""
    nasc = valor_por_rotulo(page, ["Aniversário", "Data de Nascimento", "Nascimento", "Data de Abertura"]) or ""
    page.go_back()
    page.locator("table tbody tr").first.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(400)
    return {"nome": nome_limpo(nome_mc), "doc": doc.strip(), "tipo": tipo, "nasc": nasc.strip()}


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


def limpar_opcoes(finais, renomear, log):
    validos = {N(x) for x in finais}
    for db, cols, rot in [(ID_OBRAS, ["Proprietário", "Proprietário Real"], "OBRAS"),
                          (ID_DOCS, ["PROPRIETARIO DOCUMENTO", "PROPRIETARIO REAL"], "DOCUMENTOS")]:
        esquema = api("GET", f"/databases/{db}").get("properties") or {}
        paginas = ler_banco(db, "opções em uso")
        for c in cols:
            k = col_real(esquema, c)
            if not k or esquema[k].get("type") != "select":
                continue
            # o que as páginas vão usar DEPOIS das trocas desta rodada
            em_uso = set()
            for pg in paginas:
                v = texto_de((pg.get("properties") or {}).get(k))
                if v:
                    em_uso.add(N(renomear.get(v, v)))
            ops = (esquema[k].get("select") or {}).get("options") or []
            manter = [o for o in ops if N(o["name"]) in validos or N(o["name"]) in em_uso]
            nomes_manter = {N(o["name"]) for o in manter}
            novos = [{"name": x.replace(",", " ")} for x in sorted(finais) if N(x) not in nomes_manter]
            sai = [o["name"] for o in ops if o not in manter]
            if not sai and not novos:
                continue
            log.append(f"Lista de {rot}.{k}: sai {len(sai)} opção(ões) sem uso" + (f" ({', '.join(sai[:8])}{'…' if len(sai) > 8 else ''})" if sai else "")
                       + f", entra {len(novos)} do cadastro")
            lista = [{"id": o["id"], "name": o["name"], "color": o.get("color", "default")} for o in manter] + novos
            if len(lista) > 100:
                log.append(f"   ! {k}: mais de 100 opções — o Notion não aceita trocar a lista inteira; ficou como está")
                continue
            if APLICAR:
                try:
                    api("PATCH", f"/databases/{db}", {"properties": {k: {"select": {"options": lista}}}})
                except SystemExit as e:
                    log.append(f"   ! {k}: o Notion recusou a limpeza ({str(e)[:120]})")


def sincronizar(clientes):
    cad = ler_banco(ID_CADASTRO, "CADASTRO")
    col_tit = col_cpf = None
    if cad:
        p0 = cad[0].get("properties") or {}
        col_tit = next((k for k, v in p0.items() if v.get("type") == "title"), None)
        col_cpf = col_real(p0, "CPF/CNPJ")
    # DATA DE NASCIMENTO também passa a morar no cadastro (vem do "Aniversário"
    # do MC) — é o que deixa a fórmula DATA DE NASCIMENTO da obra ler de lá.
    col_nasc = col_real(p0, "DATA DE NASCIMENTO") if cad else None
    if cad and not col_nasc:
        print("Cadastro sem a coluna DATA DE NASCIMENTO — " + ("criando." if APLICAR else "seria criada."), flush=True)
        if APLICAR:
            api("PATCH", f"/databases/{ID_CADASTRO}", {"properties": {"DATA DE NASCIMENTO": {"rich_text": {}}}})
        col_nasc = "DATA DE NASCIMENTO"
    por_doc, por_nome = {}, {}
    for r in cad:
        pr = r.get("properties") or {}
        nome, doc = titulo_de(pr), texto_de(pr.get(col_cpf)) if col_cpf else ""
        item = {"id": r["id"], "nome": nome, "doc": doc, "casou": False,
                "nasc": texto_de(pr.get(col_nasc)) if col_nasc and pr.get(col_nasc) else ""}
        if so_digitos(doc):
            por_doc[so_digitos(doc)] = item
        por_nome[N(nome)] = item

    renomear, log = {}, []
    for c in clientes:
        d = so_digitos(c["doc"])
        alvo = por_doc.get(d) if d else None
        alvo = alvo or por_nome.get(N(c["nome"]))
        if not alvo:
            log.append(f"CRIAR no cadastro: {c['nome']} ({mascarar(c['doc'])}) — setor no MC: {c.get('setor') or '(vazio)'}")
            if APLICAR and col_tit:
                props = {col_tit: {"title": [{"text": {"content": c["nome"]}}]}}
                if col_cpf:
                    props[col_cpf] = {"rich_text": [{"text": {"content": c["doc"]}}]}
                if col_nasc and c.get("nasc"):
                    props[col_nasc] = {"rich_text": [{"text": {"content": c["nasc"]}}]}
                api("POST", "/pages", {"parent": {"database_id": ID_CADASTRO}, "properties": props})
            continue
        alvo["casou"] = True
        props = {}
        if c["nome"] and c["nome"] != alvo["nome"]:
            log.append(f"RENOMEAR: {alvo['nome']}  ->  {c['nome']}")
            renomear[alvo["nome"]] = c["nome"]
            props[col_tit] = {"title": [{"text": {"content": c["nome"]}}]}
        if d and so_digitos(alvo["doc"]) != d and col_cpf:
            log.append(f"DOCUMENTO: {c['nome']}  {mascarar(alvo['doc']) if alvo['doc'] else '(vazio)'}  ->  {mascarar(c['doc'])}")
            props[col_cpf] = {"rich_text": [{"text": {"content": c["doc"]}}]}
        if col_nasc and c.get("nasc") and c["nasc"] != alvo.get("nasc"):
            props[col_nasc] = {"rich_text": [{"text": {"content": c["nasc"]}}]}
            log.append(f"NASCIMENTO/ABERTURA: {c['nome']} preenchida")
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

    # Nomes CURTOS em Proprietário Real ("MOURA", "MORAIS ENGENHARIA"…): viram
    # o nome completo do cadastro quando só UM nome do cadastro começa com eles.
    # Os que servem para mais de um (ex.: "MOURA" = LTDA ou RAVENA) só são
    # listados — esses você escolhe na mão.
    finais = [renomear.get(i["nome"], i["nome"]) for i in por_nome.values()] + \
             [c["nome"] for c in clientes if not (por_doc.get(so_digitos(c["doc"])) or por_nome.get(N(c["nome"])))]
    finais_n = {N(x): x for x in finais}
    ambiguos = {}
    for db, cols in [(ID_OBRAS, ["Proprietário Real"]), (ID_DOCS, ["PROPRIETARIO REAL"])]:
        trocas = 0
        for pg in ler_banco(db, "nomes curtos"):
            pr = pg.get("properties") or {}
            props = {}
            for c in cols:
                k = col_real(pr, c)
                if not k or pr[k].get("type") != "select":
                    continue
                v = texto_de(pr[k])
                if not v or N(v) in finais_n or N(v) in {N(x) for x in renomear}:
                    continue
                fixo = next((DE_PARA_CURTOS[k] for k in DE_PARA_CURTOS if N(k) == N(v)), None)
                if fixo:
                    props[k] = {"select": {"name": fixo}}
                    continue
                cand = [x for x in finais if N(x).startswith(N(v) + " ")]
                if not cand:
                    # "CAIO YOSHIDA" -> "CAIO MANABU DIAS YOSHIDA": todas as
                    # palavras do nome curto aparecem, na ordem, no completo
                    pal = N(v).split()
                    def contem(full):
                        f = N(full).split(); i = 0
                        for w in f:
                            if i < len(pal) and w == pal[i]:
                                i += 1
                        return i == len(pal) and len(pal) >= 2
                    cand = [x for x in finais if contem(x)]
                if len(cand) == 1:
                    props[k] = {"select": {"name": cand[0].replace(",", " ")}}
                else:
                    ambiguos.setdefault(v, set()).update(cand)
            if props:
                trocas += 1
                if APLICAR:
                    patch(pg["id"], props)
        log.append(f"Nome curto -> completo em Proprietário Real: {trocas} páginas de {'OBRAS' if db == ID_OBRAS else 'DOCUMENTOS'}")
    if ambiguos:
        log.append("Nomes curtos que NÃO deu para completar sozinho (escolha na mão):")
        for v, c in sorted(ambiguos.items()):
            log.append(f"   {v}  ->  {' | '.join(sorted(c)) if c else 'nenhum nome do cadastro começa assim'}")

    # LIMPEZA DAS LISTAS: nas 4 colunas de proprietário, a lista de opções passa
    # a ter só os nomes do cadastro (os reais do MC). Opção antiga só sai se
    # nenhuma página usa mais — valor em uso nunca some.
    limpar_opcoes(finais, renomear, log)

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
            fora = {N(x) for x in NAO_SAO_PROPRIETARIOS}
            props = [x for x in lista if N(x["setor"]) != "CASA" and N(x["nome"]) not in fora]
            print(f"MC: {len(props)} clientes com setor diferente de Casa", flush=True)
            clientes = []
            for x in props:
                try:
                    c = ler_cadastro(page, x["nome"])
                    c["setor"] = x["setor"]
                    clientes.append(c)
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
