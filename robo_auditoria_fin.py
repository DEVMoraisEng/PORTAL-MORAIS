#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_auditoria_fin.py — PORTAL-MORAIS · Auditoria Financeira (robô da madrugada)
Morais Engenharia e Construção

O QUE FAZ (uma vez por dia, de madrugada, pelo GitHub Actions)
  1. Baixa do Mais Controle as exportações da "API para relatórios"
     (pagamentos, lançamentos, faturamentos, recebimentos e obras) — as
     mesmas que a planilha "Modelo API – Excel" puxa.
  2. Lê o MANUAL do Supabase (editado pela aba Manual do portal) e roda o
     auditor (auditoria_regras.py) em cada pagamento.
  3. Calcula juros, atrasos, contas a pagar e a receber em aberto, os alertas
     de fiscalização e os cruzamentos com o Notion (conta da obra, obra
     finalizada, energia/água depois da entrega).
  4. Dá baixa sozinho no que foi marcado "Corrigir" e já foi corrigido no ERP.
  5. Grava tudo num arquivo do bucket PRIVADO "analise" do Supabase
     (auditoria/auditoria.json). A tela auditoria-financeira.html pede ao
     Apps Script um link assinado de 2 min — nada fica público.

SECRETS (GitHub > Settings > Secrets and variables > Actions)
  MC_API_USUARIO        e-mail da conta no Mais Controle (o da API para relatórios)
  MC_API_SENHA          a "Senha da API" (Configurações > Integração no MC) —
                        NÃO é a senha de login
  SUPABASE_URL          os mesmos da Análise de Dados / Orçado x Realizado
  SUPABASE_SERVICE_KEY
  NOTION_TOKEN          o mesmo dos outros fetch_*.py (só para os cruzamentos)
  Opcionais: MC_API_URL (padrão https://api-clientes.maiscontroleerp.com.br)
             ERP_CSV_PAGAMENTOS / ERP_CSV_OBRAS / ERP_CSV_RECEBIMENTOS — se a
             API falhar, usa as planilhas publicadas que a Análise de Dados já usa.

TESTE LOCAL (sem internet do MC e sem gravar nada):
  ARQUIVO_LOCAL=planilha.xlsx SAIDA_LOCAL=auditoria.json python robo_auditoria_fin.py
"""

import csv
import io
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import requests

from auditoria_regras import (LACUNA_A, LACUNA_E, ROTULOS, Motor, N, cc_tipo,
                              manual_padrao_linhas)

VERSAO = "2026-10-22 af1"
TZ = timezone(timedelta(hours=-3))
HOJE = datetime.now(TZ).date()

MC_API_URL = (os.environ.get("MC_API_URL") or "https://api-clientes.maiscontroleerp.com.br").strip().rstrip("/")
MC_USUARIO = os.environ.get("MC_API_USUARIO", "").strip()
MC_SENHA = os.environ.get("MC_API_SENHA", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
ARQUIVO_LOCAL = os.environ.get("ARQUIVO_LOCAL", "").strip()
SAIDA_LOCAL = os.environ.get("SAIDA_LOCAL", "").strip()
BUCKET, CAMINHO = "analise", "auditoria/auditoria.json"

EXPORTS = ["pagamentos", "lancamentos", "faturamentos", "recebimentos", "obras"]
FALLBACK_CSV = {"pagamentos": "ERP_CSV_PAGAMENTOS", "obras": "ERP_CSV_OBRAS", "recebimentos": "ERP_CSV_RECEBIMENTOS"}

# categorias que não entram em alguns alertas de fiscalização
CATS_SEM_DOC_OK = {N(x) for x in [
    "Salário", "Adiantamento Salarial", "FGTS", "INSS / IRRF Folha", "13º Salário", "Férias", "Rescisão",
    "Estagiário", "Contribuição Sindical", "Aporte Capital", "Distribuição de Lucros", "Cota Capital",
    "IRPJ / CSLL", "PIS / COFINS", "ISS", "IRRF s/ Serviços Tomados", "DARF RET (Incorporação)",
    "ISSQN Retido s/ Serviços de Obra", "Ganho de Capital", "Tarifas Bancárias", "IOF / Juros Bancários",
    "Financiamento Sala Comercial", "Amortização do Financiamento", "Juros Fase de Obras",
    "Juros Fase de Amortização", "Tarifa de Administração Caixa", "Aquisição de terreno",
    "Devolução sinal / entrada /  vlr a mais creditado", "Distrato", "Despesa JC pessoal", "Despesa JV pessoal"]}
CATS_OBRA_DIRETA = {N(x) for x in ["Materiais (Obras)", "Mão de Obra Terceirizada", "Locação de equipamentos"]}
CATS_UTIL = {N(x) for x in ["Conta de energia", "Conta de água", "Energia (Escritório)", "Fatura de Água"]}
# cobradas por unidade (mesmo valor várias vezes no mesmo dia é o normal)
CATS_POR_UNIDADE = {N(x) for x in ["Vistoria de Obra (Caixa / Prefeitura)", "Seguro RCPM (Obra)",
                                   "Seguro Financiamento (MIP/DFI)", "DARF RET (Incorporação)",
                                   "ISSQN Retido s/ Serviços de Obra", "ART / Taxas CREA de Obra",
                                   "Tarifa de Administração Caixa", "Tarifas Bancárias"]}
CATS_FISCAIS = {N(x) for x in ["FGTS", "INSS / IRRF Folha", "IRPJ / CSLL", "PIS / COFINS", "ISS",
                               "IRRF s/ Serviços Tomados", "DARF RET (Incorporação)",
                               "ISSQN Retido s/ Serviços de Obra", "Ganho de Capital", "IPTU de Terreno / Obra",
                               "IPTU - Administrativo", "ITBI", "Regularização de Obra (INSS / CNO / Averbação)"]}

FISCAL_TIPOS = {
    "DUP": ("Possível pagamento em duplicidade",
            "Mesmo fornecedor, mesmo valor e mesmo centro de custo em lançamentos diferentes, pagos com até 3 dias de diferença."),
    "SEM_OC": ("Material pago sem ordem de compra",
               "Materiais (Obras) a partir de R$ 1.000 sem ordem de compra vinculada no Mais Controle."),
    "SEM_DOC": ("Pagamento alto sem nº de documento",
                "A partir de R$ 10.000, sem nota/boleto informado (folha, impostos, aportes e tarifas ficam de fora)."),
    "TARDIO": ("Lançado muito depois do pagamento",
               "O título foi criado no Mais Controle mais de 30 dias depois da data do pagamento."),
    "COMPET": ("Competência distante do pagamento",
               "Competência mais de 90 dias antes ou depois do pagamento — conferir a data de competência."),
    "FORN_NOVO": ("Fornecedor novo com valor alto",
                  "Primeiro pagamento nos últimos 60 dias e já soma R$ 20.000 ou mais."),
    "A_CLASSIFICAR": ("Centro de custo \"A CLASSIFICAR\"",
                      "Pagamentos esperando a definição da obra — quanto mais antigo, pior para o custo da obra."),
    "CONTA_OBRA": ("Pago por conta diferente da conta da obra",
                   "A conta bancária do pagamento não é a CONTA cadastrada na obra ((EMP) Projeto 2.0)."),
    "OBRA_FINALIZADA": ("Custo de obra depois do término",
                        "Material, mão de obra ou locação pagos mais de 60 dias depois da DATA DE TÉRMINO DE OBRA (DOCUMENTOS)."),
    "UTIL_ENTREGUE": ("Energia/água paga depois da entrega",
                      "Conta de consumo com competência mais de 45 dias depois da DATA DA ENTREGA da casa (VENDAS) — titularidade não transferida?"),
}


def log(*a):
    print(*a, flush=True)


# =============================================================================
# CONVERSÕES TOLERANTES (a API manda texto; a planilha publicada vem em pt-BR)
# =============================================================================
def num(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return 0.0 if v != v else float(v)
    s = str(v).strip().replace("R$", "").replace(" ", "")
    if not s or s.lower() in ("none", "null", "nan", "-"):
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, pd.Timestamp):
        return None if pd.isna(v) else v.date()
    s = str(v).strip()
    if not s or s.lower() in ("none", "null", "nan", "nat"):
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    try:
        return pd.to_datetime(s).date()
    except Exception:
        return None


def txt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v != v:
        return ""
    s = str(v).strip()
    return "" if s.lower() in ("none", "nan") else s


def t0(v):
    """Texto de número inteiro sem o ".0" que o Excel/pandas acrescenta."""
    s = txt(v)
    return s[:-2] if re.fullmatch(r"-?\d+\.0", s) else s


def inteiro(v):
    x = num(v)
    return int(x) if x == int(x) else x


def ds(d):
    return d.isoformat() if d else ""


def brl(v):
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


# =============================================================================
# COLETA
# =============================================================================
def _csv_para_df(texto):
    linhas = list(csv.DictReader(io.StringIO(texto)))
    return pd.DataFrame(linhas)


def baixar_export(nome):
    url = f"{MC_API_URL}/data-exports/{nome}"
    ultimo = None
    for tentativa in range(3):
        try:
            r = requests.get(url, auth=(MC_USUARIO, MC_SENHA), timeout=180)
            if r.status_code == 200 and r.text.strip():
                r.encoding = "utf-8"
                return _csv_para_df(r.text.lstrip("﻿"))
            ultimo = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code in (401, 403):
                break                       # credencial errada: não adianta insistir
        except requests.RequestException as e:
            ultimo = str(e)
        time.sleep(15 * (tentativa + 1))
    raise RuntimeError(f"{nome}: {ultimo}")


def baixar_csv_publicado(url):
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    r.encoding = "utf-8"
    return _csv_para_df(r.text.lstrip("﻿"))


def coletar():
    """Devolve ({nome: DataFrame}, origem)."""
    if ARQUIVO_LOCAL:
        log(f"COLETA: arquivo local {ARQUIVO_LOCAL}")
        abas = {"pagamentos": "pagamentos", "lancamentos": "lancamentos", "faturamentos": "faturamentos",
                "recebimentos": "recebimentos", "obras": "obras"}
        out = {}
        for k, aba in abas.items():
            try:
                out[k] = pd.read_excel(ARQUIVO_LOCAL, sheet_name=aba, dtype=object)
            except Exception as e:
                log(f"  {k}: não lido ({e})")
                out[k] = pd.DataFrame()
        return out, "arquivo local"
    out, origem = {}, []
    for nome in EXPORTS:
        df = None
        if MC_USUARIO and MC_SENHA:
            try:
                df = baixar_export(nome)
                origem.append(f"{nome}=API")
            except Exception as e:
                log(f"  ! {nome} pela API falhou: {e}")
        if df is None and os.environ.get(FALLBACK_CSV.get(nome, "_"), "").strip():
            try:
                df = baixar_csv_publicado(os.environ[FALLBACK_CSV[nome]].strip())
                origem.append(f"{nome}=planilha publicada")
            except Exception as e:
                log(f"  ! {nome} pela planilha publicada falhou: {e}")
        if df is None:
            df = pd.DataFrame()
            origem.append(f"{nome}=sem dados")
        log(f"  {nome}: {len(df)} linhas")
        out[nome] = df
        time.sleep(2)                       # a API responde "Too many requests" se apertar
    return out, ", ".join(origem)


def col(df, *nomes):
    """Coluna por nome tolerante (acento/caixa/espaço). Série vazia se não existir."""
    mapa = {N(c).replace(" ", "_"): c for c in df.columns}
    for n in nomes:
        c = mapa.get(N(n).replace(" ", "_"))
        if c is not None:
            return df[c]
    return pd.Series([None] * len(df), index=df.index, dtype=object)


# =============================================================================
# SUPABASE
# =============================================================================
def _h(extra=None):
    h = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}
    if extra:
        h.update(extra)
    return h


def sb_ok():
    return bool(SUPABASE_URL and SUPABASE_KEY) and not SAIDA_LOCAL


def sb_get(tabela, query="select=*"):
    out, ini = [], 0
    while True:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{tabela}?{query}", timeout=60,
                         headers=_h({"Range-Unit": "items", "Range": f"{ini}-{ini + 999}"}))
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase {tabela}: HTTP {r.status_code} {r.text[:200]}")
        lote = r.json()
        out.extend(lote)
        if len(lote) < 1000:
            return out
        ini += 1000


def sb_upsert(tabela, linhas, conflito):
    for i in range(0, len(linhas), 500):
        r = requests.post(f"{SUPABASE_URL}/rest/v1/{tabela}?on_conflict={conflito}", timeout=60,
                          headers=_h({"Content-Type": "application/json",
                                      "Prefer": "resolution=merge-duplicates,return=minimal"}),
                          data=json.dumps(linhas[i:i + 500], ensure_ascii=False, default=str).encode("utf-8"))
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase upsert {tabela}: HTTP {r.status_code} {r.text[:300]}")


def sb_insert(tabela, linha):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{tabela}", timeout=60,
                      headers=_h({"Content-Type": "application/json", "Prefer": "return=minimal"}),
                      data=json.dumps(linha, ensure_ascii=False, default=str).encode("utf-8"))
    if r.status_code >= 300:
        log(f"  ! insert {tabela}: HTTP {r.status_code} {r.text[:200]}")


def storage_baixar():
    try:
        r = requests.get(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{CAMINHO}", headers=_h(), timeout=120)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        log(f"  (versão anterior não lida: {e})")
    return None


def storage_gravar(conteudo):
    corpo = json.dumps(conteudo, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{CAMINHO}", timeout=180, data=corpo,
                      headers=_h({"Content-Type": "application/json", "x-upsert": "true", "Cache-Control": "no-cache"}))
    if r.status_code >= 300:
        raise RuntimeError(f"Storage HTTP {r.status_code}: {r.text[:300]} — o bucket 'analise' existe?")
    return len(corpo)


# =============================================================================
# MANUAL
# =============================================================================
def carregar_manual():
    """(secoes, categorias, textos, origem). Semeia o Supabase na primeira vez."""
    secoes_p, cats_p, textos_p = manual_padrao_linhas()
    if not sb_ok():
        return secoes_p, cats_p, textos_p, "padrão (sem Supabase)"
    try:
        cats = sb_get("fin_manual_categorias", "select=*&order=secao_id.asc,ordem.asc")
        secoes = sb_get("fin_manual_secoes", "select=*&order=ordem.asc")
        textos_l = sb_get("fin_manual_textos", "select=*")
    except Exception as e:
        log(f"  ! manual do Supabase não lido ({e}) — usando o padrão de ago/2026")
        return secoes_p, cats_p, textos_p, "padrão (Supabase fora)"
    if not cats:
        log("  manual vazio no Supabase — semeando com o manual de ago/2026")
        agora = datetime.now(timezone.utc).isoformat()
        sb_upsert("fin_manual_secoes", [dict(s, atualizado_por="robô (semente)", atualizado_em=agora) for s in secoes_p], "id")
        sb_upsert("fin_manual_categorias", [dict(c, atualizado_por="robô (semente)", atualizado_em=agora) for c in cats_p], "categoria")
        sb_upsert("fin_manual_textos", [{"chave": k, "valor": v, "atualizado_por": "robô (semente)", "atualizado_em": agora}
                                        for k, v in textos_p.items()], "chave")
        return secoes_p, cats_p, textos_p, "padrão (semeado agora)"
    textos = dict(textos_p)
    for t in textos_l:
        textos[t["chave"]] = t["valor"]
    return (secoes or secoes_p), cats, textos, "Supabase"


# =============================================================================
# PREPARO DOS PAGAMENTOS
# =============================================================================
def preparar_pagamentos(df):
    p = pd.DataFrame({
        "id": col(df, "id_lancamento").map(lambda v: inteiro(v) if txt(v) else 0),
        "dc": col(df, "data_competencia").map(dt),
        "dv": col(df, "data_vencimento").map(dt),
        "dp": col(df, "data_pagamento").map(dt),
        "np": col(df, "numero_parcela").map(t0),
        "v": col(df, "valor_parcela").map(num),
        "vp": col(df, "valor_pago").map(num),
        "de": col(df, "valor_desconto").map(num),
        "jm": col(df, "valor_juros_e_multa").map(num),
        "f": col(df, "fornecedor").map(txt),
        "d": col(df, "descricao").map(txt),
        "nd": col(df, "numero_documento").map(txt),
        "c": col(df, "categoria").map(txt),
        "g": col(df, "grupo").map(txt),
        "p": col(df, "plano_de_conta").map(txt),
        "fp": col(df, "forma_pagamento").map(txt),
        "q": col(df, "quem_paga").map(txt),
        "cb": col(df, "conta_bancaria").map(txt),
        "io": col(df, "id_obra").map(lambda v: inteiro(v) if txt(v) else 0),
        "cc": col(df, "centro_de_custo").map(txt),
        "ix": col(df, "indice_item_orcamento").map(t0),
        "oc": col(df, "ordem_de_compra").map(txt),
    })
    p = p[(p.id != 0) | (p.v != 0)].reset_index(drop=True)
    # chave estável do pagamento: a validação feita no portal fica presa nela
    base = [f"{r.id}|{r.np}|{ds(r.dp)}|{r.vp:.2f}" for r in p.itertuples()]
    vistos = Counter()
    chaves = []
    for b in base:
        vistos[b] += 1
        chaves.append(b if vistos[b] == 1 else f"{b}#{vistos[b]}")
    p["k"] = chaves
    return p


def aplicar_excecoes(p, excecoes):
    """Exceções aprendidas ("aplicar a parecidos"): fornecedor + categoria (+ CC)."""
    p["ex"] = 0
    if not excecoes:
        return 0
    nf, nc, ncc = p.f.map(N), p.c.map(N), p.cc.map(N)
    total = 0
    for e in excecoes:
        if e.get("ativo") is False:
            continue
        m = pd.Series(True, index=p.index)
        if e.get("fornecedor"):
            m &= nf == N(e["fornecedor"])
        if e.get("categoria"):
            m &= nc == N(e["categoria"])
        if e.get("centro_de_custo"):
            m &= ncc == N(e["centro_de_custo"])
        if not (e.get("fornecedor") or e.get("categoria")):
            continue                        # exceção sem fornecedor nem categoria não vale (pegaria tudo)
        m &= p.st != "OK"
        p.loc[m & (p.ex == 0), "ex"] = int(e["id"])
        total += int(m.sum())
    return total


# =============================================================================
# CONTAS EM ABERTO (mesma conta das colunas "em aberto" da planilha do MC)
# =============================================================================
def contas_a_pagar(lanc, pag):
    if lanc is None or lanc.empty:
        return []
    pago = defaultdict(float)
    for r in pag.itertuples():
        pago[(r.id, r.io, r.np, r.ix)] += r.vp - r.jm + r.de
    out = []
    for _, r in lanc.iterrows():
        idl = inteiro(r.get("id_lancamento")) if txt(r.get("id_lancamento")) else 0
        io_ = inteiro(r.get("id_obra")) if txt(r.get("id_obra")) else 0
        npc = t0(r.get("numero_parcela"))
        ix = t0(r.get("indice_item_orcamento"))
        vp = num(r.get("valor_parcela"))
        aberto = max(0.0, vp - pago.get((idl, io_, npc, ix), 0.0))
        if aberto < 0.01:
            continue
        out.append([txt(r.get("centro_de_custo")), txt(r.get("fornecedor")), txt(r.get("categoria")),
                    ds(dt(r.get("data_vencimento"))), round(vp, 2), round(aberto, 2), txt(r.get("descricao")),
                    idl, npc, txt(r.get("conta_bancaria"))])
    return out


def contas_a_receber(fat, rec):
    if fat is None or fat.empty:
        return []
    recebido = defaultdict(float)
    if rec is not None and not rec.empty:
        for _, r in rec.iterrows():
            k = (inteiro(r.get("id_faturamento")) if txt(r.get("id_faturamento")) else 0,
                 inteiro(r.get("id_obra")) if txt(r.get("id_obra")) else 0,
                 inteiro(r.get("numero_parcela")) if txt(r.get("numero_parcela")) else 0)
            recebido[k] += num(r.get("valor_recebido")) - num(r.get("valor_juros_e_multa")) + num(r.get("valor_desconto"))
    out = []
    for _, r in fat.iterrows():
        k = (inteiro(r.get("id_faturamento")) if txt(r.get("id_faturamento")) else 0,
             inteiro(r.get("id_obra")) if txt(r.get("id_obra")) else 0,
             inteiro(r.get("numero_parcela")) if txt(r.get("numero_parcela")) else 0)
        vp = num(r.get("valor_parcela"))
        aberto = max(0.0, vp - recebido.get(k, 0.0))
        if aberto < 0.01:
            continue
        out.append([txt(r.get("centro_de_custo")), txt(r.get("cliente")), txt(r.get("natureza")),
                    ds(dt(r.get("data_vencimento"))), round(vp, 2), round(aberto, 2), txt(r.get("descricao")),
                    k[0], k[2], txt(r.get("conta_bancaria"))])
    return out


# =============================================================================
# FISCALIZAÇÃO (só ERP)
# =============================================================================
def fiscalizar(p, lanc):
    achados = []                           # [tipo, índice da linha, texto, valor]

    def add(t, i, texto):
        achados.append([t, int(i), texto])

    # DUP — mesmo fornecedor, valor, CC; lançamentos diferentes; até 3 dias
    cand = p[(p.f != "") & (p.v >= 300) & p.dp.notna() & (~p.c.map(N).isin(CATS_POR_UNIDADE))].copy()
    cand["nd_n"] = cand.nd.map(N)
    for _, g in cand.groupby([cand.f.map(N), cand.v.round(2), cand.cc.map(N)]):
        if len(g) < 2 or g.id.nunique() < 2:
            continue
        g = g.sort_values("dp")
        linhas = list(g.itertuples())
        for a_i, a in enumerate(linhas):
            for b in linhas[a_i + 1:]:
                dias = (b.dp - a.dp).days
                if dias > 3:
                    break
                if a.id == b.id:
                    continue
                mesmo_doc = a.nd_n and a.nd_n == b.nd_n
                mesma_desc = N(a.d) == N(b.d)
                if not (mesmo_doc or mesma_desc):
                    continue
                add("DUP", b.Index, f"Igual ao lançamento {a.id} — {a.dp.strftime('%d/%m/%Y')}, {brl(a.v)}")
    # SEM_OC
    for r in p[(p.c.map(N) == N("Materiais (Obras)")) & (p.v >= 1000) & (p.oc == "")].itertuples():
        add("SEM_OC", r.Index, "Sem ordem de compra")
    # SEM_DOC
    for r in p[(p.v >= 10000) & (p.nd == "") & (~p.c.map(N).isin(CATS_SEM_DOC_OK))].itertuples():
        add("SEM_DOC", r.Index, "Sem nº de documento")
    # TARDIO — data_lancamento vem da aba lançamentos
    if lanc is not None and not lanc.empty:
        dl = {}
        for idl, d0 in zip(col(lanc, "id_lancamento"), col(lanc, "data_lancamento")):
            if txt(idl):
                dl.setdefault(inteiro(idl), dt(d0))
        p["dl"] = p.id.map(lambda i: dl.get(i))
        for r in p.itertuples():
            if r.dl and r.dp and (r.dl - r.dp).days > 30:
                add("TARDIO", r.Index, f"Lançado em {r.dl.strftime('%d/%m/%Y')} — {(r.dl - r.dp).days} dias depois do pagamento")
    else:
        p["dl"] = None
    # COMPET
    for r in p.itertuples():
        if r.dc and r.dp and abs((r.dc - r.dp).days) > 90:
            add("COMPET", r.Index, f"Competência {r.dc.strftime('%m/%Y')} × pagamento {r.dp.strftime('%d/%m/%Y')}")
    # FORN_NOVO
    lim = HOJE - timedelta(days=60)
    for forn, g in p[p.f != ""].groupby(p.f.map(N)):
        prim = min((x for x in g.dp if x), default=None)
        if prim and prim >= lim and g.v.sum() >= 20000:
            for r in g.itertuples():
                add("FORN_NOVO", r.Index, f"Primeiro pagamento em {prim.strftime('%d/%m/%Y')} · total {brl(g.v.sum())}")
    # A_CLASSIFICAR
    for r in p[p.cc.map(lambda x: "A CLASSIFICAR" in N(x))].itertuples():
        idade = (HOJE - r.dp).days if r.dp else None
        add("A_CLASSIFICAR", r.Index, f"Há {idade} dias sem obra definida" if idade is not None else "Sem obra definida")
    return achados


# =============================================================================
# CRUZAMENTOS COM O NOTION (opcionais — sem NOTION_TOKEN, ficam de fora)
# =============================================================================
def cruzar_notion(p):
    if not os.environ.get("NOTION_TOKEN", "").strip() or ARQUIVO_LOCAL:
        return [], "sem NOTION_TOKEN" if not ARQUIVO_LOCAL else "teste local"
    try:
        import fetch_vendas as fv
        import fetch_analise_dados as fad
    except Exception as e:
        return [], f"módulos do portal não carregaram: {e}"
    achados = []
    pad = fad.padronizar_endereco
    p["cc_pad"] = p.cc.map(pad)
    try:
        # 1) CONTA da obra — (EMP) Projeto 2.0
        obras = fv.ler_banco("306c5ab532d3812fa14fe9a281510128", "OBRAS")
        conta_por_end = {}
        for pg in obras:
            ip = fad.indice_props(pg.get("properties"))
            end = fad.txt(ip, "Projeto", "ENDEREÇO")
            conta = fad.txt(ip, "CONTA")
            if end and conta and N(conta) not in ("CRIAR CONTA", "DUVIDA", "DÚVIDA", "VAZIA"):
                conta_por_end[pad(end)] = conta
        for r in p.itertuples():
            conta = conta_por_end.get(r.cc_pad)
            if conta and r.cb and N(conta) != N(r.cb) and r.dp and (HOJE - r.dp).days <= 365:
                achados.append(["CONTA_OBRA", int(r.Index), f"Conta da obra: {conta}"])
        log(f"  Notion OBRAS: {len(conta_por_end)} obras com CONTA")
    except Exception as e:
        log(f"  ! cruzamento CONTA falhou: {e}")
    try:
        # 2) obra finalizada — DOCUMENTOS
        docs = [fad.parse_doc(pg) for pg in fv.ler_banco(fv.DB_DOCS, "DOCUMENTOS")]
        termino = {}
        for d in docs:
            if d.get("endereco") and d.get("data_termino_obra"):
                t = dt(d["data_termino_obra"])
                k = pad(d["endereco"])
                if t and (k not in termino or t > termino[k]):
                    termino[k] = t
        for r in p.itertuples():
            t = termino.get(r.cc_pad)
            if t and r.dp and (r.dp - t).days > 60 and N(r.c) in CATS_OBRA_DIRETA:
                achados.append(["OBRA_FINALIZADA", int(r.Index), f"Término da obra em {t.strftime('%d/%m/%Y')}"])
        log(f"  Notion DOCUMENTOS: {len(termino)} obras com término")
    except Exception as e:
        log(f"  ! cruzamento DOCUMENTOS falhou: {e}")
    try:
        # 3) energia/água depois da entrega — VENDAS
        vendas = [fad.parse_venda(pg) for pg in fv.ler_banco(fv.DB_VENDAS, "VENDAS")]
        entrega = defaultdict(dict)          # endereço -> {casa: data}
        for v in vendas:
            if v.get("endereco") and v.get("data_entrega"):
                e = dt(v["data_entrega"])
                casa = int(v["casa"]) if isinstance(v.get("casa"), (int, float)) else 0
                if e:
                    entrega[pad(v["endereco"])][casa] = e
        for r in p.itertuples():
            casas = entrega.get(r.cc_pad)
            if not casas or not r.dc:
                continue
            eh_util = N(r.c) in CATS_UTIL or r.sc in (LACUNA_E, LACUNA_A)
            if not eh_util:
                continue
            m = re.search(r"\bCASA\s*0?(\d+)\b|\bCS\s*0?(\d+)\b", N(r.d))
            if m:
                e = casas.get(int(m.group(1) or m.group(2)))
            else:
                e = max(casas.values()) if casas and len(casas) >= 1 and 0 not in casas else casas.get(0)
            if e and (r.dc - e).days > 45:
                achados.append(["UTIL_ENTREGUE", int(r.Index), f"Casa entregue em {e.strftime('%d/%m/%Y')}"])
        log(f"  Notion VENDAS: {sum(len(x) for x in entrega.values())} casas entregues")
    except Exception as e:
        log(f"  ! cruzamento VENDAS falhou: {e}")
    return achados, "ok"


# =============================================================================
# BAIXA AUTOMÁTICA DO "CORRIGIR"
# =============================================================================
def baixar_corrigidos(validacoes, p):
    if not validacoes:
        return 0
    por_chave = {k: i for i, k in enumerate(p.k)}
    agora = datetime.now(timezone.utc).isoformat()
    baixas = []
    for v in validacoes:
        if v.get("status") != "CORRIGIR":
            continue
        ch = v.get("chave") or ""
        tipo = v.get("tipo") or "AUDIT"
        k = ch.split(":", 1)[1] if ":" in ch else ch
        i = por_chave.get(k)
        if i is None:
            continue                        # lançamento alterado/apagado no ERP: fica para conferência manual
        cat_agora = p.at[i, "c"]
        cc_agora = p.at[i, "cc"]
        mudou_cat = v.get("categoria_atual") and N(cat_agora) != N(v["categoria_atual"])
        mudou_cc = v.get("centro_de_custo") and N(cc_agora) != N(v["centro_de_custo"])
        resolvido = (tipo == "AUDIT" and (mudou_cat or mudou_cc or p.at[i, "st"] == "OK")) or \
                    (tipo != "AUDIT" and (mudou_cat or mudou_cc))
        if resolvido:
            baixas.append({"chave": ch, "status": "CORRIGIDO", "corrigido_em": agora,
                           "corrigido_por": "robô (corrigido no ERP)",
                           "obs": ((v.get("obs") or "") + f" | Agora: {cat_agora} · {cc_agora}").strip(" |")})
    if baixas and sb_ok():
        sb_upsert("fin_validacoes", baixas, "chave")
    return len(baixas)


# =============================================================================
# MONTAGEM DO ARQUIVO
# =============================================================================
class Dic:
    def __init__(self):
        self.d = {}

    def enc(self, nome, vals):
        m = self.d.setdefault(nome, {})
        out = []
        for v in vals:
            v = "" if v is None else str(v)
            if v not in m:
                m[v] = len(m)
            out.append(m[v])
        return out

    def listas(self):
        inv = {}
        for nome, m in self.d.items():
            arr = [None] * len(m)
            for s, i in m.items():
                arr[i] = s
            inv[nome] = arr
        return inv


def resumo_mensal_genericas(p):
    m = defaultdict(lambda: [0, 0])
    for dc, c in zip(p.dc, p.c):
        if not dc:
            continue
        k = dc.strftime("%Y-%m")
        m[k][0] += 1
        if c in ("Outras Despesas", "Taxas gerais"):
            m[k][1] += 1
    return {k: v for k, v in sorted(m.items())}


def main():
    t0 = time.time()
    log(f"AUDITORIA FINANCEIRA {VERSAO} — {HOJE.isoformat()}")
    dados, origem = coletar()
    if dados["pagamentos"].empty:
        msg = "Sem pagamentos — confira MC_API_USUARIO / MC_API_SENHA (Senha da API, não a de login)."
        if sb_ok():
            sb_insert("fin_coletas", {"ok": False, "origem": origem, "linhas": 0, "erro": msg})
        raise SystemExit(msg)

    secoes, cats, textos, origem_manual = carregar_manual()
    log(f"MANUAL: {len(cats)} categorias ({origem_manual})")
    motor = Motor(cats)

    p = preparar_pagamentos(dados["pagamentos"])
    log(f"AUDITANDO {len(p)} pagamentos…")
    res = [motor.classificar(r.d, r.f, r.c, r.p, r.cc) for r in p.itertuples()]
    p["st"] = [x[0] for x in res]
    p["sc"] = [x[1] or "" for x in res]
    p["sp"] = [x[2] or "" for x in res]
    p["m"] = [x[3] for x in res]
    p["a"] = [" || ".join(x[4]) for x in res]
    p["tc"] = [x[5] for x in res]
    log("  " + ", ".join(f"{k}={v}" for k, v in p.st.value_counts().items()))

    excecoes, validacoes = [], []
    if sb_ok():
        try:
            excecoes = sb_get("fin_excecoes", "select=*&ativo=eq.true")
            validacoes = sb_get("fin_validacoes", "select=*")
        except Exception as e:
            log(f"  ! validações/exceções não lidas: {e}")
    n_exc = aplicar_excecoes(p, excecoes)
    log(f"  exceções aplicadas: {n_exc}")

    obras = dados.get("obras")
    resp_obra, area_obra, status_obra = {}, {}, {}
    if obras is not None and not obras.empty:
        for i_, rp, ar, so in zip(col(obras, "id"), col(obras, "responsavel_obra"), col(obras, "area_total"), col(obras, "status_obra")):
            if txt(i_):
                k = inteiro(i_)
                resp_obra[k] = txt(rp)
                area_obra[k] = num(ar)
                status_obra[k] = txt(so)
    p["ro"] = p.io.map(lambda i: resp_obra.get(i, ""))

    lanc = dados.get("lancamentos")
    fiscal = fiscalizar(p, lanc)
    fn, situacao_notion = cruzar_notion(p)
    fiscal.extend(fn)
    log(f"  fiscalização: {len(fiscal)} achados · " + ", ".join(f"{k}={v}" for k, v in Counter(f[0] for f in fiscal).items())
        + f" · Notion: {situacao_notion}")

    pagar = contas_a_pagar(lanc, p)
    receber = contas_a_receber(dados.get("faturamentos"), dados.get("recebimentos"))
    log(f"  em aberto: {len(pagar)} a pagar, {len(receber)} a receber")

    # custo por m² (obra do ERP com área)
    m2 = []
    dir_mask = p.c.map(N).isin(CATS_OBRA_DIRETA)
    for io_, g in p[dir_mask & (p.io != 0)].groupby("io"):
        area = area_obra.get(io_, 0)
        if area and area > 20:
            total = float(g.v.sum())
            m2.append([g.cc.iloc[0], io_, round(area, 2), round(total, 2), round(total / area, 2),
                       status_obra.get(io_, ""), resp_obra.get(io_, "")])

    # exemplos reais para o manual (descrições de lançamentos conformes)
    exemplos = {}
    for c_, g in p[p.st == "OK"].groupby("c"):
        top = Counter(x for x in g.d if x and len(x) > 3).most_common(5)
        exemplos[c_] = [t for t, _ in top]

    baixas = baixar_corrigidos(validacoes, p)
    log(f"  baixas automáticas (corrigido no ERP): {baixas}")

    # o que mudou desde a última rodada
    mud = {}
    anterior = storage_baixar() if sb_ok() else None
    prev = None
    try:
        if anterior and anterior.get("cols"):
            ac, ad = anterior["cols"], anterior["dict"]
            prev = {k: [ad["cat"][c], ad["st"][s]] for k, c, s in zip(ac["k"], ac["c"], ac["st"])}
    except Exception as e:
        log(f"  (versão anterior em formato diferente: {e})")
    if prev:
        atual = {k: [c, s] for k, c, s in zip(p.k, p.c, p.st)}
        novos = [k for k in atual if k not in prev]
        recat = [k for k in atual if k in prev and N(prev[k][0]) != N(atual[k][0])]
        resolvidos = [k for k in atual if k in prev and prev[k][1] != "OK" and atual[k][1] == "OK"]
        mud = {"anterior": anterior.get("gerado"), "novos": len(novos), "removidos": len([k for k in prev if k not in atual]),
               "recategorizados": len(recat), "resolvidos": len(resolvidos),
               "novos_por_status": dict(Counter(atual[k][1] for k in novos))}

    dic = Dic()
    cols = {
        "k": list(p.k), "id": [int(x) for x in p.id], "np": list(p.np),
        "dc": [ds(x) for x in p.dc], "dv": [ds(x) for x in p.dv], "dp": [ds(x) for x in p.dp],
        "v": [round(x, 2) for x in p.v], "vp": [round(x, 2) for x in p.vp],
        "jm": [round(x, 2) for x in p.jm], "de": [round(x, 2) for x in p.de],
        "f": dic.enc("f", p.f), "d": list(p.d), "nd": list(p.nd), "oc": list(p.oc),
        "c": dic.enc("cat", p.c), "g": dic.enc("g", p.g), "p": dic.enc("plano", p.p),
        "cc": dic.enc("cc", p.cc), "cb": dic.enc("cb", p.cb), "fp": dic.enc("fp", p.fp),
        "io": [int(x) for x in p.io], "ro": dic.enc("ro", p.ro),
        "st": dic.enc("st", p.st), "sc": dic.enc("cat", p.sc), "sp": dic.enc("plano", p.sp),
        "m": dic.enc("m", p.m), "a": dic.enc("a", p.a), "tc": dic.enc("tc", p.tc), "ex": [int(x) for x in p.ex],
    }
    lac = p[p.sc.isin([LACUNA_E, LACUNA_A])]
    conteudo = {
        "versao": VERSAO,
        "gerado": datetime.now(TZ).strftime("%d/%m/%Y %H:%M"),
        "gerado_iso": datetime.now(timezone.utc).isoformat(),
        "hoje": HOJE.isoformat(),
        "fonte": "Mais Controle — API para relatórios (" + origem + ")",
        "n": len(p),
        "cols": cols,
        "dict": dic.listas(),
        "rotulos": ROTULOS,
        "cad": motor.cadastro_erp(zip(p.c, p.p, p.g)),
        "lacuna": {"n": int(len(lac)), "v": round(float(lac.v.sum()), 2),
                   "ne": int((lac.sc == LACUNA_E).sum()), "na": int((lac.sc == LACUNA_A).sum())},
        "fiscal": fiscal,
        "fiscal_tipos": {k: {"t": v[0], "d": v[1]} for k, v in FISCAL_TIPOS.items()},
        "notion": situacao_notion,
        "pagar": pagar,
        "receber": receber,
        "m2": m2,
        "exemplos": exemplos,
        "genericas_mes": resumo_mensal_genericas(p),
        "mudancas": mud,
        "manual_origem": origem_manual,
        "manual": {"secoes": secoes, "categorias": cats, "textos": textos},
        "cats_fiscais": sorted(CATS_FISCAIS),
    }

    resumo = {"status": dict(Counter(p.st)), "fiscal": dict(Counter(f[0] for f in fiscal)),
              "pagar": len(pagar), "receber": len(receber), "baixas": baixas, "mudancas": mud,
              "juros_total": round(float(p.jm.sum()), 2), "segundos": round(time.time() - t0, 1)}
    if SAIDA_LOCAL:
        with open(SAIDA_LOCAL, "w", encoding="utf-8") as fh:
            json.dump(conteudo, fh, ensure_ascii=False, separators=(",", ":"), default=str)
        log(f"GRAVADO LOCAL: {SAIDA_LOCAL} ({os.path.getsize(SAIDA_LOCAL) / 1e6:.1f} MB)")
    else:
        if not sb_ok():
            raise SystemExit("Falta SUPABASE_URL / SUPABASE_SERVICE_KEY.")
        tam = storage_gravar(conteudo)
        sb_insert("fin_coletas", {"ok": True, "origem": origem, "linhas": len(p), "resumo": resumo})
        log(f"GRAVADO no Supabase: {BUCKET}/{CAMINHO} ({tam / 1e6:.1f} MB)")
    log(f"PRONTO em {time.time() - t0:.0f}s")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"ERRO: {e}")
        if sb_ok():
            try:
                sb_insert("fin_coletas", {"ok": False, "origem": "robô", "linhas": 0, "erro": str(e)[:900]})
            except Exception:
                pass
        sys.exit(1)
