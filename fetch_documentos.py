#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_documentos.py — PORTAL-MORAIS
Morais Engenharia e Construção

Publica dist/docs.json: é o que a documentos.html (GESTÃO DE DOCUMENTOS — OBRA)
lê para abrir. Mesma arquitetura das telas de Vendas, Ligações e Pós Obra —
arquivo pronto no GitHub Pages (CDN), e não leitura ao vivo pelo Apps Script.

POR QUE UM ARQUIVO NOVO, E NÃO O documentos.json QUE JÁ EXISTE
--------------------------------------------------------------
O dist/documentos.json (gerado pelo fetch_vendas.py) é um RESUMO: só endereço,
habite-se, obra iniciada, nº de casas, cota e umas datas. Ele alimenta os
contadores do index.html e a aba "Estoque de Casas" do vendas.html. Mexer nele
para caber a base inteira quebraria essas duas telas sem aviso.

Este arquivo publica a base DOCUMENTOS COMPLETA (todas as colunas não
sensíveis), o schema ao vivo e as atividades de documentação. Nome diferente
(docs.json) justamente para as duas coisas conviverem.

O QUE NÃO ENTRA AQUI (e por quê)
--------------------------------
CPF/CNPJ. O dist/ é servido pelo GitHub Pages para QUALQUER UM que saiba a URL,
sem login — mesma razão pela qual o fetch_vendas.py já deixa CLIENTES e CPF
fora do vendas.json. A planilha mostra "•••" e o valor real vem pela ação
"docObra" do Code.gs, que confere o token de quem está logado.
Se um dia você decidir que o CPF/CNPJ do PROPRIETÁRIO (quase sempre a SPE, uma
empresa) pode ser público, troque PUBLICAR_CPF para True aqui embaixo — é uma
decisão sua, e é por isso que ela está numa constante e não escondida no meio
do código.

Anexos (colunas do tipo arquivo, ex.: CERTIDÃO DO LOTE ANEXADA) também ficam de
fora: a URL que o Notion devolve é assinada e daria o arquivo a quem tivesse o
JSON. Publicamos só a QUANTIDADE ("2 arq."), que é o que a tela precisa para
saber se está preenchido.

Variáveis de ambiente:
  NOTION_TOKEN  -> mesmo secret que o fetch_vendas.py já usa
"""

import json
import os
import re
import sys
import time

# Reaproveita os utilitários já validados do fetch_vendas.py (retry em 429/5xx,
# paginação, conversão de propriedade e a resolução de nomes de relation).
# Importar é seguro: o main() de lá está protegido por __main__.
import fetch_vendas as fv
from fetch_vendas import (api, ler_banco, valor, norm, gravar, montar_schema,
                          resolver_titulos_relacao, SAIDA, CAMPOS_SENSIVEIS,
                          TIPOS_EDITAVEIS)

# IDs das bases. Não são credencial (ver comentário no topo do fetch_vendas.py).
ID_DOCS_PADRAO = "32fc5ab532d380a0900dd7f4bfc619bd"   # BASE DE DADOS DOCUMENTOS
ID_ATV_PADRAO  = "330c5ab532d38009b6c2d5d6b77b6926"   # ATIVIDADES CONTROLE DE DOCUMENTAÇÕES

DB_DOCS = (os.environ.get("DOCUMENTOS_DB_ID") or ID_DOCS_PADRAO).strip()
DB_ATV  = (os.environ.get("ATIVIDADES_DOCS_DB_ID") or ID_ATV_PADRAO).strip()

# Ver o bloco "O QUE NÃO ENTRA AQUI" no topo.
PUBLICAR_CPF = False
OCULTAR_ANEXOS = True


# --------------------------------------------------------------------------
# BAIXA DE ATIVIDADE: TIPO da atividade -> coluna da OBRA que é escrita
# --------------------------------------------------------------------------
# Mesmo papel do BAIXA_MAP do Code.gs (setor de vendas). A diferença é que aqui
# eu NÃO tenho a lista de TIPOs da base ATIVIDADES CONTROLE DE DOCUMENTAÇÕES —
# ela não veio nos prints. Então funciona em duas camadas:
#
#   1. o mapa explícito abaixo, que você completa/corrige quando conferir os
#      tipos reais (rode conferirDocumentos() no Apps Script — ele lista os
#      TIPOs existentes e as colunas SIM/NÃO da base DOCUMENTOS);
#   2. um casamento automático por PALAVRAS do nome: "EMITIR USO DO SOLO" acha
#      "USO DO SOLO EMITIDO E ARMAZENADO". É um chute educado, e por isso a
#      TELA MOSTRA qual coluna vai ser escrita antes de você clicar em "Dar
#      baixa" — chute errado é visível, não silencioso.
#
# ATENÇÃO: quem VALIDA de verdade é o docBaixa_ do Code.gs, que refaz esta
# mesma conta no servidor. Este mapa aqui é só para a tela mostrar o alvo.
# Mexeu num, mexa no outro.
# Fechado em 10/09/2026 a partir da fórmula de validação que roda dentro da
# própria base de atividades (a que pinta 🟢 SIM / 🔴 NÃO): são esses os TIPOs
# que existem. O valor pode ser um PEDAÇO do nome da coluna — os nomes reais
# são longos e aparecem truncados no print do Notion.
# Mantenha igual ao BAIXA_MAP_DOCS do Code.gs: quem VALIDA é o servidor, este
# aqui só publica o alvo para a tela mostrar antes do clique.
BAIXA_MAP_DOCS = {
    "USO DO SOLO":          "USO DO SOLO SOLICITADO",        # CONFERIR
    "HABITE-SE":            "APROVOU HABITE-SE",             # CONFERIR
    "CERTIDAO DO LOTE":     "CERTIDÃO DO LOTE",
    "ALVARA":               "TAXAS ENTRADA ALVAR",
    "APROVACAO DE PROJETO": "PROJETO APROVADO E ALVARA",
    "PROJETO APROVADO":     "PROJETO FEITO",                 # CONFERIR
    "INCORPORACAO":         "FOI DADO ENTRADA NA INCORPORA",
    "INCORP. FINALIZADA":   "INCORPORAÇÃO FINALI",
    "RET":                  "FOI DATA A ENTRADA NO RET",
    "ARMAZENAR RET":        "RET ARMAZENADO",
    "ANEXAR RET":           "RET ARMAZENADO",
    "AGENDOU HABITE-SE":    "AGENDOU HABITE-SE",
    "ARMAZENAR HABITE-SE":  "ARMAZENOU HABITE-SE",
    "SCPO E VISTORIA":      "PAGOU BOLETOS DE VIS",          # CONFERIR
    "ART DE ACRESCIMO":     "EMITIU ART DE ACRESC",
    "CERTIDOES FINAIS":     "SAIRAM AS CERTIDOES",
    "ISSQN":                "GEROU E ARMAZENOU I",
    "CND + CNO":            "EMITIU CNO E CND",
    "CONTRATO MESTRE":      "CONTRATO MESTRE",
}

# Palavras que não ajudam a casar TIPO com coluna (ruído comum).
_RUIDO = {"DE", "DO", "DA", "DOS", "DAS", "E", "A", "O", "EM", "NA", "NO",
          "PARA", "COM", "?", "OBRA", "DATA", "FAZER", "CONFERIR", "EMITIR",
          "ARMAZENAR", "PAGAR", "SOLICITAR", "ENVIAR"}


def palavras(s):
    return [p for p in re.split(r"[^A-Z0-9]+", norm(s)) if p and p not in _RUIDO]


def coluna_da_baixa(tipo, colunas_sim):
    """Acha a coluna de marcação (SIM/NÃO) que corresponde ao TIPO da atividade.
    colunas_sim: lista de nomes reais de colunas select/status que têm 'SIM'."""
    if not tipo:
        return None
    exato = BAIXA_MAP_DOCS.get(tipo) or BAIXA_MAP_DOCS.get(norm(tipo))
    if exato:
        # o valor do mapa pode ser pedaço do nome: resolve para o nome real
        alvo = norm(exato)
        for col in colunas_sim:
            if norm(col) == alvo:
                return col
        for col in colunas_sim:
            if alvo in norm(col):
                return col
        return exato
    alvo = set(palavras(tipo))
    if not alvo:
        return None
    melhor, melhor_nota = None, 0
    for col in colunas_sim:
        c = set(palavras(col))
        if not c:
            continue
        comuns = len(alvo & c)
        if not comuns:
            continue
        # nota = quanto do TIPO foi coberto, com desempate por coluna mais curta
        nota = comuns / max(len(alvo), 1) + comuns / max(len(c), 1) * 0.5
        if nota > melhor_nota:
            melhor, melhor_nota = col, nota
    # abaixo de meia palavra em comum é chute demais: melhor não oferecer baixa
    return melhor if melhor_nota >= 0.6 else None


# --------------------------------------------------------------------------
def prop_tol(props, *nomes):
    """Acha a propriedade tolerando acento, caixa e espaço sobrando; se não
    achar pelo nome exato, aceita quem CONTENHA o fragmento."""
    for nome in nomes:
        if nome in props:
            return props[nome]
    for nome in nomes:
        alvo = norm(nome)
        for k, v in props.items():
            if norm(k) == alvo:
                return v
    for nome in nomes:
        alvo = norm(nome)
        for k, v in props.items():
            if alvo in norm(k):
                return v
    return None


def v_tol(props, *nomes):
    p = prop_tol(props, *nomes)
    return valor(p) if p else None


def eh_sensivel_docs(nome):
    """CPF/CNPJ é o único campo pessoal desta base. CLIENTE/TELEFONE não
    existem aqui — a base é de documentação de obra, não de venda."""
    if PUBLICAR_CPF:
        return False
    n = norm(nome)
    return bool(re.search(r"\bCPF\b|\bCNPJ\b|\bRG\b", n))


def atividade_feita(props):
    """A base tem uma fórmula de validação própria — a que pinta "🟢 SIM"
    quando a coluna da obra correspondente ao TIPO já está SIM. É ELA que manda
    aqui, e não uma coluna de nome fixo: o nome da fórmula pode mudar, o
    círculo verde não.
    Ordem: 1) fórmula com 🟢/🔴; 2) coluna "ATIVIDADE FINALIZADA" (o padrão do
    setor de vendas); 3) em branco conta como ABERTA — nunca o contrário, senão
    o sistema esconderia trabalho a fazer. Mantenha igual ao docsAtvFeita_ do
    Code.gs."""
    achou_sinal = False
    for _, pp in props.items():
        if pp.get("type") != "formula":
            continue
        v = str((pp.get("formula") or {}).get("string") or "")
        if "🟢" in v:
            return True
        if "🔴" in v or "🔵" in v:
            achou_sinal = True
    if achou_sinal:
        return False
    fin = v_tol(props, "ATIVIDADE FINALIZADA")
    if fin is True:
        return True
    if not fin:
        return False
    return "NAO" not in norm(fin)


def titulo_de(props):
    for _, pp in props.items():
        if pp.get("type") == "title":
            return valor(pp) or ""
    return ""


def main():
    if not os.environ.get("NOTION_TOKEN", "").strip():
        raise SystemExit("Falta o secret NOTION_TOKEN no GitHub Actions.")

    os.makedirs(SAIDA, exist_ok=True)
    agora = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())

    # o montar_schema() do fetch_vendas usa esta lista; sem preencher, ele
    # estoura ao marcar sensíveis (ela só é montada dentro do main() de lá)
    fv._SENS_NORM = [norm(x) for x in CAMPOS_SENSIVEIS if norm(x)]

    # ---- 1. SCHEMA DA BASE DOCUMENTOS ------------------------------------
    print("Lendo schema de DOCUMENTOS…", flush=True)
    campos = montar_schema(DB_DOCS)          # sem marcar_sensiveis: a regra é a daqui
    for c in campos:
        if eh_sensivel_docs(c["nome"]) or (OCULTAR_ANEXOS and c["tipo"] == "files"):
            c["sensivel"] = True
    ocultas = {c["nome"] for c in campos if c.get("sensivel")}
    print("  colunas NÃO publicadas (" + str(len(ocultas)) + "): "
          + (", ".join(sorted(ocultas)) if ocultas else "nenhuma"), flush=True)

    # colunas de marcação (as que a baixa de atividade escreve)
    colunas_sim = [c["nome"] for c in campos
                   if c["tipo"] in ("select", "status")
                   and c.get("opcoes") and any(norm(o) == "SIM" for o in c["opcoes"])]

    # ---- 2. REGISTROS ----------------------------------------------------
    print("Lendo registros de DOCUMENTOS…", flush=True)
    paginas = ler_banco(DB_DOCS, "DOCUMENTOS")

    # nomes das páginas ligadas por relation (OBRA-AUTO e afins): sem isto o
    # site mostraria o uuid cru no lugar do endereço
    ids_rel = []
    for pg in paginas:
        for _, prop in (pg.get("properties") or {}).items():
            if prop.get("type") == "relation":
                ids_rel += [x.get("id") for x in (prop.get("relation") or []) if x.get("id")]
    if ids_rel:
        print(f"Resolvendo nomes de {len(set(ids_rel))} página(s) ligada(s)…", flush=True)
        resolver_titulos_relacao(ids_rel)

    # o endpoint /databases às vezes não devolve relation/rollup (quando a
    # integração não tem acesso à base do outro lado). Completa pelo que as
    # páginas trazem — mesmo tratamento do fetch_vendas.py.
    nomes_schema = {norm(c["nome"]) for c in campos}
    extras = {}
    for pg in paginas:
        for nome, prop in (pg.get("properties") or {}).items():
            if norm(nome) in nomes_schema or norm(nome) in extras:
                continue
            extras[norm(nome)] = (nome, prop.get("type"))
    for _, (nome, tipo) in sorted(extras.items()):
        c = {"nome": nome, "tipo": tipo, "opcoes": None,
             "editavel": tipo in TIPOS_EDITAVEIS}
        if eh_sensivel_docs(nome) or (OCULTAR_ANEXOS and tipo == "files"):
            c["sensivel"] = True
            ocultas.add(nome)
        campos.append(c)
    if extras:
        print("  ! " + str(len(extras)) + " coluna(s) vieram das páginas, não do schema: "
              + ", ".join(repr(n) for n, _ in sorted(extras.values())), flush=True)
    campos.sort(key=lambda c: norm(c["nome"]))

    obras, descartados = [], 0
    for p in paginas:
        vals, sens = {}, {}
        for nome, prop in (p.get("properties") or {}).items():
            if nome in ocultas:
                descartados += 1
                v = valor(prop)
                if isinstance(v, list):
                    if v:
                        sens[nome] = len(v)      # nº de anexos
                elif v is not None and v != "":
                    sens[nome] = True            # preenchido, e só
                continue
            vals[nome] = valor(prop)
        reg = {"id": p["id"], "valores": vals}
        if sens:
            reg["sens"] = sens
        obras.append(reg)
    print(f"  {len(obras)} obras ({descartados} valores sensíveis descartados).", flush=True)

    # ---- 3. ATIVIDADES DE CONTROLE DE DOCUMENTAÇÕES ----------------------
    print("Lendo ATIVIDADES CONTROLE DE DOCUMENTAÇÕES…", flush=True)
    try:
        atv_paginas = ler_banco(DB_ATV, "ATIVIDADES DOCS")
    except SystemExit as e:
        # base não compartilhada com a integração: o resto do arquivo continua
        # valendo e a tela mostra a aba de atividades vazia, com aviso.
        print("  ! não consegui ler: " + str(e), flush=True)
        atv_paginas = None

    atividades, tipos_vistos = [], {}
    if atv_paginas is not None:
        for a in atv_paginas:
            props = a.get("properties") or {}
            if atividade_feita(props):
                continue
            rel = []
            resp = []
            for nome, prop in props.items():
                t = prop.get("type")
                if t == "relation" and "OBRA" in norm(nome):
                    rel = [x.get("id") for x in (prop.get("relation") or []) if x.get("id")]
                if t == "people" and "RESPONS" in norm(nome):
                    resp = [u.get("name") or u.get("id") for u in (prop.get("people") or [])]
            tipo = v_tol(props, "TIPO")
            if tipo:
                tipos_vistos[tipo] = tipos_vistos.get(tipo, 0) + 1
            atividades.append({
                "id": a.get("id"),
                "nome": titulo_de(props),
                "tipo": tipo,
                "responsavel": resp,
                "obraId": rel[0] if rel else None,
                "dataInicial": v_tol(props, "DATA INICIAL"),
                "dataFinal": v_tol(props, "DATA FINAL PREVISTA", "DATA FINAL"),
                # coluna da OBRA que a baixa escreve (ver coluna_da_baixa)
                "coluna": coluna_da_baixa(tipo, colunas_sim),
            })
        print(f"  {len(atividades)} atividade(s) em aberto.", flush=True)
        if tipos_vistos:
            print("  TIPOs encontrados (e a coluna que a baixa vai escrever):", flush=True)
            for t, n in sorted(tipos_vistos.items(), key=lambda x: -x[1]):
                col = coluna_da_baixa(t, colunas_sim)
                print(f"      {n:>4}x  {t!r} -> {col!r}"
                      + ("   *** SEM COLUNA: preencha BAIXA_MAP_DOCS ***" if not col else ""),
                      flush=True)

    schema_atv = []
    if atv_paginas is not None:
        try:
            schema_atv = montar_schema(DB_ATV)
        except SystemExit:
            schema_atv = []

    # ---- 4. GRAVA --------------------------------------------------------
    gravar("docs.json", {
        "ok": True,
        "updated_at": agora,
        "total": len(obras),
        "campos": campos,
        "obras": obras,
        "ocultas": sorted(ocultas),
        "colunasSim": colunas_sim,
        "atividades": atividades,
        "schemaAtv": schema_atv,
        "atividadesOk": atv_paginas is not None,
    })
    print(f"OK — {len(obras)} obras, {len(atividades)} atividades.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
