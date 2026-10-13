#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_bases.py — PORTAL-MORAIS · espelho diário do Mais Controle no Notion

Mantém dois bancos no Notion, criados pelo próprio robô na primeira rodada
(na mesma página onde fica a base de obras "(EMP) Projeto 2.0"):

  MC - OBRAS ATIVAS   todas as obras do MC que não estão Finalizadas, com
                      endereço (rua, quadra, lote, setor, CEP, cidade) e o
                      proprietário com documento, IE, e-mail, telefone etc.
  MC - FORNECEDORES   todos os fornecedores do MC (ativos e inativos) com
                      documento, segmento, categoria, contatos, endereço e
                      dados bancários/PIX.

Como funciona:
  1. Entra no MC com o login() de robo_mc_comum.py (o mesmo dos outros robôs,
     inclusive o código de e-mail do MFA).
  2. Abre as telas Fornecedores e Obras só para pegar os cabeçalhos de acesso
     que o próprio sistema usa, e daí lê tudo pela API interna do MC
     (legacy-api e prod-erp-api) — muito mais rápido e estável que ler a tela.
  3. Grava no Notion: cria a linha que falta, atualiza só o que mudou.
     NUNCA apaga linha: obra que finaliza vira STATUS "Finalizada"; obra ou
     fornecedor que some do MC vira STATUS "Fora do MC".

O robô só LÊ o Mais Controle. Por isso ele grava no Notion sempre, sem a trava
APLICAR dos outros robôs. Para só simular (ler tudo e mostrar o que faria):
SIMULAR=1.

Variáveis: NOTION_TOKEN + as do login do MC (MC_URL, MC_USUARIO, MC_SENHA,
MC_EMAIL_SENHA_APP...). Opcionais: MC_OBRAS_DB_ID e MC_FORNECEDORES_DB_ID
(fixam os bancos, se um dia forem movidos de página), NOTION_PAI_MC (página
onde criar os bancos, se não quiser a da (EMP) Projeto 2.0).
"""

import os
import re
import sys
import time
import json
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from playwright.sync_api import sync_playwright

import robo_mc_comum as mc

# ---------------------------------------------------------------- config ----
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
NOTION_VERSAO = "2022-06-28"
ID_OBRAS_EMP = "306c5ab532d3812fa14fe9a281510128"     # (EMP) Projeto 2.0
NOTION_PAI_MC = os.environ.get("NOTION_PAI_MC", "").strip()

TITULO_OBRAS = "MC - OBRAS ATIVAS"
TITULO_FORN = "MC - FORNECEDORES"
OBRAS_DB_ID = os.environ.get("MC_OBRAS_DB_ID", "").strip()
FORN_DB_ID = os.environ.get("MC_FORNECEDORES_DB_ID", "").strip()

SIMULAR = os.environ.get("SIMULAR", "").strip().lower() in ("1", "true", "sim")

ACESSAR = "https://acessar.maiscontroleerp.com.br"
LEGACY = "https://legacy-api.maiscontroleerp.com.br/maiscontrole/services"
ERP_API = "https://prod-erp-api.maiscontroleerp.com.br"

CABECALHOS_MC = {"authorization", "organization-unit-id", "user-id", "company-id", "accept"}

STATUS_OBRA = {
    "IN_PROGRESS": "Em andamento",
    "TO_START": "A iniciar",
    "QUOTING": "Em orçamento",
    "PARALYZED": "Paralisada",
    "FINISHED": "Finalizada",
}
STATUS_FORN = {"ACTIVE": "Ativo", "INACTIVE": "Inativo"}
FORA_DO_MC = "Fora do MC"


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------ formatação ----
def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def digitos(s):
    return re.sub(r"\D", "", str(s or ""))


def limpo(s):
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def fmt_doc(cpf=None, cnpj=None):
    d = digitos(cnpj)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    d = digitos(cpf)
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return limpo(cnpj) or limpo(cpf)


def pf_pj(cpf=None, cnpj=None, tipo=None):
    if digitos(cnpj):
        return "PJ"
    if digitos(cpf):
        return "PF"
    if tipo == "LEGAL":
        return "PJ"
    if tipo:
        return "PF"
    return ""


def fmt_cep(c):
    d = digitos(c)
    return f"{d[:5]}-{d[5:]}" if len(d) == 8 else limpo(c)


def nome_de(x):
    """Campos do MC que às vezes vêm como objeto {name: ...} e às vezes texto."""
    if isinstance(x, dict):
        return limpo(x.get("name") or x.get("description") or "")
    return limpo(x)


def cidade_uf(addr):
    cid = (addr or {}).get("city") or {}
    uf = (cid.get("state") or {}).get("abbreviation") or ""
    return limpo(cid.get("name")), limpo(uf)


def fmt_endereco(addr):
    if not addr:
        return ""
    cid, uf = cidade_uf(addr)
    partes = [
        limpo(addr.get("address")),
        limpo(addr.get("addressNumber")),
        limpo(addr.get("complement")),
        limpo(addr.get("neighborhood")),
        ("CEP " + fmt_cep(addr.get("zipCode"))) if digitos(addr.get("zipCode")) else "",
        " - ".join(x for x in (cid, uf) if x),
    ]
    return ", ".join(p for p in partes if p)


def telefones(lista):
    nums = []
    for p in lista or []:
        n = limpo(p.get("number") if isinstance(p, dict) else p)
        if n and n not in nums:
            nums.append(n)
    return " / ".join(nums)


def data_iso(s):
    if isinstance(s, (int, float)) and s > 0:          # epoch em ms
        return datetime.fromtimestamp(s / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    if isinstance(s, (list, tuple)) and len(s) >= 3:     # [ano, mês, dia]
        try:
            return f"{int(s[0]):04d}-{int(s[1]):02d}-{int(s[2]):02d}"
        except (TypeError, ValueError):
            return None
    s = limpo(s)
    return s[:10] if re.match(r"\d{4}-\d{2}-\d{2}", s) else None


# quadra e lote: "QD 81 LT 09", "QD  E9   LT  52", "Quadra 12 Lote 3"...
_RX_QD = re.compile(r"\bQ(?:D|UADRA)\b\.?\s*([A-Z]{0,2}\s?\d+[A-Z]?|[A-Z]{1,2}\b)")
_RX_LT = re.compile(r"\bL(?:T|OTE)\b\.?\s*([A-Z]{0,2}\s?\d+[A-Z]?|[A-Z]{1,2}\b)")


def _dois_digitos(v):
    v = re.sub(r"\s+", "", v)
    return v.zfill(2) if v.isdigit() else v


def quadra_lote(*textos):
    qd = lt = ""
    for t in textos:
        t = sem_acento(limpo(t)).upper()
        if not t:
            continue
        if not qd:
            m = _RX_QD.search(t)
            if m:
                qd = _dois_digitos(m.group(1))
        if not lt:
            m = _RX_LT.search(t)
            if m:
                lt = _dois_digitos(m.group(1))
    return qd, lt


def opcao(s):
    """Nome válido para opção de seleção do Notion (sem vírgula, até 100)."""
    return limpo(s).replace(",", " -")[:100]


# --------------------------------------------------------------- MC: API ----
class MC:
    def __init__(self, page, h_legacy, h_erp):
        self.page = page
        self.h_legacy = h_legacy
        self.h_erp = h_erp

    def _get(self, url, headers):
        ultimo = ""
        for tent in range(4):
            try:
                r = self.page.request.get(url, headers=headers, timeout=60000)
                if r.ok:
                    return r.json()
                ultimo = f"HTTP {r.status}"
                if r.status in (401, 403):
                    break
            except Exception as e:
                ultimo = str(e)[:200]
            time.sleep(2 + tent * 3)
        raise RuntimeError(f"MC não respondeu {url.split('?')[0]} — {ultimo}")

    def legacy(self, caminho):
        return self._get(f"{LEGACY}/{caminho}", self.h_legacy)

    def erp(self, caminho):
        return self._get(f"{ERP_API}/{caminho}", self.h_erp)

    # ---- obras
    def obras_lista(self):
        todas, vistos = [], set()
        for pagina in range(1, 60):
            j = self.erp(f"work-management/works/detailed?pageIndex={pagina}&pageSize=100")
            itens = j.get("items") or []
            novos = [i for i in itens if i.get("id") not in vistos]
            for i in novos:
                vistos.add(i.get("id"))
            todas += novos
            if not itens or not novos or not j.get("hasNextPage"):
                break
        return todas

    def obra(self, id_):
        return self.legacy(f"works/{id_}")

    # ---- fornecedores
    def fornecedores_lista(self):
        todos = []
        for st in ("ACTIVE", "INACTIVE"):
            pagina, deste = 0, []
            while pagina < 40:
                j = self.legacy(f"participants?page={pagina}&role=SUPPLIER&size=500&sort=name&status={st}")
                cont = j.get("content") or []
                deste += cont
                total = j.get("totalElements")
                if not cont or (total is not None and len(deste) >= total) or (total is None and j.get("last", True)):
                    break
                pagina += 1
            todos += deste
        return todos

    def participante(self, id_):
        return self.legacy(f"participants/{id_}")


def capturar_acesso(page):
    """Pega os cabeçalhos que o próprio MC manda para as duas APIs."""
    base = ACESSAR
    try:
        u = urlparse(page.url)
        if u.netloc.endswith("maiscontroleerp.com.br") and u.netloc.startswith("acessar"):
            base = f"{u.scheme}://{u.netloc}"
    except Exception:
        pass

    def filtra(h):
        return {k: v for k, v in h.items() if k.lower() in CABECALHOS_MC}

    def pegar(rota, teste, nome):
        for tent in range(2):
            try:
                with page.expect_request(teste, timeout=60000) as ri:
                    if tent == 0:
                        page.evaluate("h => { location.hash = h }", rota)
                    else:
                        page.goto(f"{base}/{rota}", wait_until="domcontentloaded")
                        page.reload(wait_until="domcontentloaded")
                h = filtra(ri.value.all_headers())
                if any(k.lower() == "authorization" for k in h):
                    return h
            except Exception as e:
                log(f"  … {nome}: tentativa {tent + 1} sem resposta ({str(e)[:120]})")
            # sai da rota e volta, para o sistema refazer a chamada
            try:
                page.evaluate("() => { location.hash = '#/home' }")
                page.wait_for_timeout(2500)
            except Exception:
                pass
        mc.foto(page, f"bases_sem_acesso_{nome}")
        raise SystemExit(f"Não consegui pegar o acesso da API '{nome}' do MC (tela {rota}). "
                         "Veja o print em mc_evidencias.")

    h_legacy = pegar("#/supplier",
                     lambda r: "legacy-api." in r.url and "/participants" in r.url, "legacy")
    h_erp = pegar("#/work",
                  lambda r: "prod-erp-api." in r.url and "/work-management/works" in r.url, "erp")
    return base, h_legacy, h_erp


# --------------------------------------------------------- MC → registros ----
def registro_obra(d, status_lista, base):
    addr = d.get("address") or {}
    cli = d.get("customer") or {}
    cid, uf = cidade_uf(addr)
    qd, lt = quadra_lote(addr.get("complement"), d.get("name"), addr.get("address"))
    resp = d.get("responsible") or {}
    cpf = cli.get("cpf") or d.get("cpf")
    cnpj = cli.get("cnpj") or d.get("cnpj")
    tel = telefones(cli.get("phones")) or limpo(d.get("phoneNumber"))
    status = d.get("status") or status_lista
    return {
        "OBRA": limpo(d.get("name")) or "(sem nome)",
        "STATUS": STATUS_OBRA.get(status, limpo(status)),
        "ENDEREÇO": fmt_endereco(addr),
        "RUA": limpo(addr.get("address")),
        "NÚMERO": limpo(addr.get("addressNumber")),
        "QUADRA": qd,
        "LOTE": lt,
        "COMPLEMENTO": limpo(addr.get("complement")),
        "SETOR": opcao(addr.get("neighborhood")),
        "CEP": fmt_cep(addr.get("zipCode")),
        "CIDADE": opcao(cid),
        "UF": opcao(uf),
        "TIPO DA OBRA": opcao(nome_de(d.get("workType"))),
        "ÁREA (m²)": d.get("estimatedArea"),
        "ART": limpo(d.get("art")),
        "RESP. TÉCNICO": limpo(resp.get("technicalResponsible")),
        "RESP. OBRA": limpo(resp.get("workResponsible")),
        "PROPRIETÁRIO": limpo(cli.get("name")),
        "RAZÃO SOCIAL": limpo(cli.get("corporateName")),
        "PF/PJ": pf_pj(cpf, cnpj, cli.get("type") or d.get("customerType")),
        "CPF/CNPJ": fmt_doc(cpf, cnpj),
        "INSCRIÇÃO ESTADUAL": limpo(cli.get("stateTaxNumber") or d.get("stateTaxNumber")),
        "E-MAIL PROPRIETÁRIO": limpo(cli.get("email") or d.get("email")),
        "TELEFONE PROPRIETÁRIO": tel,
        "NASCIMENTO PROPRIETÁRIO": data_iso(cli.get("birthday")),
        "ENDEREÇO PROPRIETÁRIO": fmt_endereco(cli.get("address")),
        "LINK MC": f"{base}/#/work/{d.get('id')}",
        "MC ID": d.get("id"),
        "MODIFICADO NO MC": data_iso(d.get("modificationDate")),
    }


def registro_fornecedor(d, da_lista):
    addr = d.get("address") or da_lista.get("address") or {}
    cid, uf = cidade_uf(addr)
    cpf = d.get("cpf") or da_lista.get("cpf")
    cnpj = d.get("cnpj") or da_lista.get("cnpj")
    contatos = []
    for c in d.get("contacts") or []:
        partes = [limpo(c.get("name"))]
        if limpo(c.get("jobTitle")):
            partes[0] += f" ({limpo(c.get('jobTitle'))})"
        partes += [limpo(c.get("phoneNumber")), limpo(c.get("email"))]
        txt = " ".join(p for p in partes if p)
        if txt:
            contatos.append(txt)
    if not contatos and limpo(da_lista.get("firstContactName")):
        contatos.append(limpo(da_lista.get("firstContactName")))
    qual = da_lista.get("qualification")
    if qual is None and isinstance(d.get("supplierQualification"), (int, float)):
        qual = d.get("supplierQualification")
    segmento = nome_de(d.get("supplierSegment")) or limpo(da_lista.get("supplierSegmentName"))
    categoria = nome_de(d.get("lastCategory") or da_lista.get("lastCategory"))
    status = d.get("status") or da_lista.get("status")
    return {
        "FORNECEDOR": limpo(d.get("name") or da_lista.get("name")) or "(sem nome)",
        "RAZÃO SOCIAL": limpo(d.get("corporateName")),
        "PF/PJ": pf_pj(cpf, cnpj, d.get("type") or da_lista.get("type")),
        "CPF/CNPJ": fmt_doc(cpf, cnpj),
        "INSCRIÇÃO ESTADUAL": limpo(d.get("stateTaxNumber")),
        "INSCRIÇÃO MUNICIPAL": limpo(d.get("cityRegistration")),
        "SEGMENTO": opcao(segmento),
        "CATEGORIA": opcao(categoria),
        "TELEFONE": telefones(d.get("phones") or da_lista.get("phones")),
        "E-MAIL": limpo(d.get("email") or da_lista.get("email")),
        "CONTATOS": "; ".join(contatos),
        "ENDEREÇO": fmt_endereco(addr),
        "SETOR": limpo(addr.get("neighborhood")),
        "CIDADE": opcao(cid),
        "UF": opcao(uf),
        "CEP": fmt_cep(addr.get("zipCode")),
        "DADOS BANCÁRIOS / PIX": limpo(nome_de(d.get("bankAccount")) if isinstance(d.get("bankAccount"), dict)
                                       else d.get("bankAccount")),
        "QUALIFICAÇÃO": qual,
        "STATUS": STATUS_FORN.get(status, limpo(status)),
        "OBSERVAÇÃO": limpo(d.get("comment")),
        "MC ID": d.get("id") or da_lista.get("id"),
        "MODIFICADO NO MC": data_iso(d.get("modificationDate")),
    }


# -------------------------------------------------------------- esquemas ----
T, RT, SEL, NUM, URL, DATA = "title", "rich_text", "select", "number", "url", "date"

ESQ_OBRAS = [
    ("OBRA", T), ("STATUS", SEL), ("ENDEREÇO", RT), ("RUA", RT), ("NÚMERO", RT),
    ("QUADRA", RT), ("LOTE", RT), ("COMPLEMENTO", RT), ("SETOR", SEL), ("CEP", RT),
    ("CIDADE", SEL), ("UF", SEL), ("TIPO DA OBRA", SEL), ("ÁREA (m²)", NUM), ("ART", RT),
    ("RESP. TÉCNICO", RT), ("RESP. OBRA", RT),
    ("PROPRIETÁRIO", RT), ("RAZÃO SOCIAL", RT), ("PF/PJ", SEL), ("CPF/CNPJ", RT),
    ("INSCRIÇÃO ESTADUAL", RT), ("E-MAIL PROPRIETÁRIO", RT), ("TELEFONE PROPRIETÁRIO", RT),
    ("NASCIMENTO PROPRIETÁRIO", DATA), ("ENDEREÇO PROPRIETÁRIO", RT),
    ("LINK MC", URL), ("MC ID", RT), ("MODIFICADO NO MC", DATA),
]

ESQ_FORN = [
    ("FORNECEDOR", T), ("RAZÃO SOCIAL", RT), ("PF/PJ", SEL), ("CPF/CNPJ", RT),
    ("INSCRIÇÃO ESTADUAL", RT), ("INSCRIÇÃO MUNICIPAL", RT), ("SEGMENTO", SEL),
    ("CATEGORIA", SEL), ("TELEFONE", RT), ("E-MAIL", RT), ("CONTATOS", RT),
    ("ENDEREÇO", RT), ("SETOR", RT), ("CIDADE", SEL), ("UF", SEL), ("CEP", RT),
    ("DADOS BANCÁRIOS / PIX", RT), ("QUALIFICAÇÃO", NUM), ("STATUS", SEL),
    ("OBSERVAÇÃO", RT), ("MC ID", RT), ("MODIFICADO NO MC", DATA),
]

OPCOES_FIXAS = {
    "STATUS@obras": list(STATUS_OBRA.values()) + [FORA_DO_MC],
    "STATUS@forn": list(STATUS_FORN.values()) + [FORA_DO_MC],
    "PF/PJ": ["PF", "PJ"],
}


# ---------------------------------------------------------------- Notion ----
class Notion:
    def __init__(self, token):
        self.s = requests.Session()
        self.s.headers.update({
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSAO,
            "Content-Type": "application/json",
        })
        self._ultimo = 0.0

    def req(self, metodo, caminho, corpo=None):
        url = f"https://api.notion.com/v1/{caminho}"
        erro = ""
        for tent in range(6):
            espera = 0.35 - (time.time() - self._ultimo)      # ~3 req/s
            if espera > 0:
                time.sleep(espera)
            self._ultimo = time.time()
            try:
                r = self.s.request(metodo, url, data=json.dumps(corpo) if corpo is not None else None,
                                   timeout=60)
            except requests.RequestException as e:
                time.sleep(2 + tent * 2)
                erro = str(e)
                continue
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(float(r.headers.get("Retry-After", 2 + tent * 2)))
                erro = f"HTTP {r.status_code}"
                continue
            if not r.ok:
                raise RuntimeError(f"Notion {metodo} {caminho}: HTTP {r.status_code} — {r.text[:400]}")
            return r.json()
        raise RuntimeError(f"Notion {metodo} {caminho}: sem resposta ({erro})")

    def paginar(self, metodo, caminho, corpo=None):
        cursor = None
        while True:
            if metodo == "GET":
                c = caminho + ("&" if "?" in caminho else "?") + "page_size=100"
                if cursor:
                    c += f"&start_cursor={cursor}"
                j = self.req("GET", c)
            else:
                b = dict(corpo or {})
                b["page_size"] = 100
                if cursor:
                    b["start_cursor"] = cursor
                j = self.req("POST", caminho, b)
            yield from j.get("results", [])
            if not j.get("has_more"):
                return
            cursor = j.get("next_cursor")


def pagina_pai(no):
    if NOTION_PAI_MC:
        return NOTION_PAI_MC
    db = no.req("GET", f"databases/{ID_OBRAS_EMP}")
    pai = db.get("parent") or {}
    for _ in range(8):
        tipo = pai.get("type")
        if tipo == "page_id":
            return pai["page_id"]
        if tipo == "block_id":
            pai = (no.req("GET", f"blocks/{pai['block_id']}").get("parent") or {})
            continue
        break
    raise SystemExit("Não achei a página onde fica a (EMP) Projeto 2.0 para criar os bancos. "
                     "Crie a variável NOTION_PAI_MC com o ID da página desejada.")


def achar_banco(no, pai, titulo):
    alvo = sem_acento(titulo).upper()
    for b in no.paginar("GET", f"blocks/{pai}/children"):
        if b.get("type") == "child_database":
            if sem_acento((b.get("child_database") or {}).get("title", "")).upper().strip() == alvo:
                return b["id"]
    return None


def esquema_prop(nome, tipo, chave_status):
    if tipo == SEL:
        fixas = OPCOES_FIXAS.get(f"{nome}@{chave_status}") or OPCOES_FIXAS.get(nome) or []
        return {"select": {"options": [{"name": o} for o in fixas]}}
    if tipo == NUM:
        return {"number": {"format": "number"}}
    return {tipo: {}}


def preparar_banco(no, pai, titulo, db_id, esquema, chave):
    if not db_id:
        db_id = achar_banco(no, pai, titulo)
    if not db_id:
        props = {n: esquema_prop(n, t, chave) for n, t in esquema}
        if SIMULAR:
            log(f"[SIMULAÇÃO] criaria o banco '{titulo}' com {len(props)} colunas")
            return None
        db = no.req("POST", "databases", {
            "parent": {"type": "page_id", "page_id": pai},
            "title": [{"type": "text", "text": {"content": titulo}}],
            "is_inline": False,
            "properties": props,
        })
        log(f"Banco '{titulo}' criado: {db['id'].replace('-', '')}")
        return db["id"]
    # banco já existe: garante as colunas (só ACRESCENTA; não renomeia nem apaga)
    db = no.req("GET", f"databases/{db_id}")
    atuais = db.get("properties") or {}
    titulo_atual = next((n for n, p in atuais.items() if p.get("type") == "title"), None)
    faltam = {}
    for n, t in esquema:
        if t == T:
            if titulo_atual and titulo_atual != n:
                faltam[titulo_atual] = {"name": n}
            continue
        if n not in atuais:
            faltam[n] = esquema_prop(n, t, chave)
        elif atuais[n].get("type") != t:
            log(f"  aviso: coluna '{n}' de '{titulo}' é {atuais[n].get('type')}, esperado {t} — não mexi")
    if faltam and not SIMULAR:
        no.req("PATCH", f"databases/{db_id}", {"properties": faltam})
        log(f"  '{titulo}': colunas ajustadas: {', '.join(faltam)}")
    return db_id


def valor_notion(prop):
    t = prop.get("type")
    v = prop.get(t)
    if t in (T, RT):
        return "".join(x.get("plain_text", "") for x in (v or []))
    if t == SEL:
        return (v or {}).get("name", "")
    if t == NUM:
        return v
    if t == URL:
        return v or ""
    if t == DATA:
        return ((v or {}).get("start") or "")[:10] or None
    return v


def igual(tipo, a, b):
    if tipo == NUM:
        if a in (None, "") and b in (None, ""):
            return True
        try:
            return round(float(a), 2) == round(float(b), 2)
        except (TypeError, ValueError):
            return False
    return (a or "") == (b or "")


def montar_prop(tipo, valor):
    if tipo in (T, RT):
        txt = limpo(valor)[:2000]
        return {tipo: [{"type": "text", "text": {"content": txt}}] if txt else []}
    if tipo == SEL:
        return {"select": {"name": valor} if valor else None}
    if tipo == NUM:
        try:
            return {"number": round(float(valor), 4) if valor not in (None, "") else None}
        except (TypeError, ValueError):
            return {"number": None}
    if tipo == URL:
        return {"url": valor or None}
    if tipo == DATA:
        return {"date": {"start": valor} if valor else None}
    raise ValueError(tipo)


def sincronizar(no, db_id, titulo, esquema, registros, marcar_fora):
    """registros: lista de dicts (já no formato das colunas). Atualiza só o que
    mudou, cria o que falta, e o que sumiu do MC ganha STATUS 'Fora do MC'."""
    tipos = dict(esquema)
    existentes = {}
    duplicadas = 0
    if db_id:
        for p in no.paginar("POST", f"databases/{db_id}/query"):
            props = p.get("properties") or {}
            mid = valor_notion(props["MC ID"]) if "MC ID" in props else ""
            if not mid:
                continue
            if mid in existentes:
                duplicadas += 1
                continue
            existentes[mid] = p
    criar = atualizar = iguais = fora = 0
    vistos = set()
    for reg in registros:
        mid = reg["MC ID"]
        vistos.add(mid)
        pg = existentes.get(mid)
        if not pg:
            props = {n: montar_prop(tipos[n], reg.get(n)) for n in tipos}
            criar += 1
            if not SIMULAR:
                no.req("POST", "pages", {"parent": {"database_id": db_id}, "properties": props})
            continue
        atuais = pg.get("properties") or {}
        mudou = {}
        for n, t in tipos.items():
            if n not in atuais:
                continue
            if not igual(t, valor_notion(atuais[n]), reg.get(n)):
                mudou[n] = montar_prop(t, reg.get(n))
        if mudou:
            atualizar += 1
            if not SIMULAR:
                no.req("PATCH", f"pages/{pg['id']}", {"properties": mudou})
        else:
            iguais += 1
    if marcar_fora:
        for mid, pg in existentes.items():
            if mid in vistos:
                continue
            st = valor_notion((pg.get("properties") or {}).get("STATUS", {"type": SEL, SEL: None}))
            if st in (FORA_DO_MC, STATUS_OBRA["FINISHED"]):
                continue
            fora += 1
            if not SIMULAR:
                no.req("PATCH", f"pages/{pg['id']}", {"properties": {"STATUS": {"select": {"name": FORA_DO_MC}}}})
    pre = "[SIMULAÇÃO] " if SIMULAR else ""
    log(f"{pre}{titulo}: {criar} novas, {atualizar} atualizadas, {iguais} sem mudança, "
        f"{fora} marcadas '{FORA_DO_MC}'" + (f", {duplicadas} linhas duplicadas ignoradas" if duplicadas else ""))


# ------------------------------------------------------------------ main ----
def ler_mc():
    with sync_playwright() as p:
        b, page = mc.abrir(p)
        try:
            mc.login(page)
            log("Login no MC ok.")
            base, h_legacy, h_erp = capturar_acesso(page)
            api = MC(page, h_legacy, h_erp)

            lista = api.obras_lista()
            st = {}
            for o in lista:
                st[o.get("status")] = st.get(o.get("status"), 0) + 1
            log(f"Obras no MC: {len(lista)} {st}")
            ativas = [o for o in lista if o.get("status") != "FINISHED"]
            finalizadas = [o for o in lista if o.get("status") == "FINISHED"]
            obras = []
            for i, o in enumerate(ativas, 1):
                try:
                    obras.append(registro_obra(api.obra(o["id"]), o.get("status"), base))
                except Exception as e:
                    log(f"  ! obra {o.get('name')}: {e}")
                    raise
                if i % 50 == 0:
                    log(f"  … {i}/{len(ativas)} obras lidas")
            # finalizadas: só para o STATUS das linhas que já existirem no Notion
            obras_fim = [{"MC ID": o["id"], "STATUS": STATUS_OBRA["FINISHED"]} for o in finalizadas]

            flista = api.fornecedores_lista()
            log(f"Fornecedores no MC: {len(flista)}")
            forn = []
            for i, f in enumerate(flista, 1):
                try:
                    det = api.participante(f["id"])
                except Exception as e:
                    log(f"  ! fornecedor {f.get('name')}: detalhe falhou ({e}); usando só a lista")
                    det = {}
                forn.append(registro_fornecedor(det, f))
                if i % 100 == 0:
                    log(f"  … {i}/{len(flista)} fornecedores lidos")
            return obras, obras_fim, forn
        finally:
            try:
                b.close()
            except Exception:
                pass


def main():
    if not NOTION_TOKEN:
        raise SystemExit("Falta o secret NOTION_TOKEN.")
    no = Notion(NOTION_TOKEN)
    pai = pagina_pai(no)

    obras, obras_fim, forn = ler_mc()
    if not obras or not forn:
        # nunca marcar tudo como "Fora do MC" por causa de uma leitura vazia
        raise SystemExit(f"Leitura do MC veio vazia (obras={len(obras)}, fornecedores={len(forn)}) — nada gravado.")

    db_obras = preparar_banco(no, pai, TITULO_OBRAS, OBRAS_DB_ID, ESQ_OBRAS, "obras")
    db_forn = preparar_banco(no, pai, TITULO_FORN, FORN_DB_ID, ESQ_FORN, "forn")

    sincronizar(no, db_obras, TITULO_OBRAS, ESQ_OBRAS, obras, marcar_fora=False)
    # finalizadas: atualiza só o STATUS de quem já está no banco
    if db_obras and obras_fim:
        fim = {r["MC ID"] for r in obras_fim}
        n = 0
        for p in no.paginar("POST", f"databases/{db_obras}/query"):
            props = p.get("properties") or {}
            mid = valor_notion(props["MC ID"]) if "MC ID" in props else ""
            if mid in fim and valor_notion(props.get("STATUS", {"type": SEL, SEL: None})) != STATUS_OBRA["FINISHED"]:
                n += 1
                if not SIMULAR:
                    no.req("PATCH", f"pages/{p['id']}", {"properties": {"STATUS": {"select": {"name": STATUS_OBRA["FINISHED"]}}}})
        if n:
            log(f"{TITULO_OBRAS}: {n} obras marcadas Finalizada")
    # obras que sumiram de vez do MC (nem ativas nem finalizadas)
    if db_obras:
        todas = obras + obras_fim
        _marcar_fora(no, db_obras, {r["MC ID"] for r in todas}, TITULO_OBRAS)

    sincronizar(no, db_forn, TITULO_FORN, ESQ_FORN, forn, marcar_fora=True)
    log("Pronto.")


def _marcar_fora(no, db_id, ids_mc, titulo):
    n = 0
    for p in no.paginar("POST", f"databases/{db_id}/query"):
        props = p.get("properties") or {}
        mid = valor_notion(props["MC ID"]) if "MC ID" in props else ""
        if not mid or mid in ids_mc:
            continue
        if valor_notion(props.get("STATUS", {"type": SEL, SEL: None})) == FORA_DO_MC:
            continue
        n += 1
        if not SIMULAR:
            no.req("PATCH", f"pages/{p['id']}", {"properties": {"STATUS": {"select": {"name": FORA_DO_MC}}}})
    if n:
        log(f"{titulo}: {n} obras marcadas '{FORA_DO_MC}'")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"ERRO: {e}")
        sys.exit(1)
