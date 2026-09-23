#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_contas.py — PORTAL-MORAIS · espelha as contas bancárias do Mais
Controle no Notion (banco CONTAS BANCÁRIAS, na mesma página da (EMP) Projeto
2.0), para dar à obra nova o campo "Conta bancária" já ligado.

O que o robô faz, em ordem:
  1. Lê as contas ATIVAS do ERP (login por API; se o WAF recusar — 403 — ou
     der erro de rede, recua para login pela tela com Playwright e refaz a
     mesma consulta de dentro da página).
  2. Acha (ou cria) o banco CONTAS BANCÁRIAS no Notion, no mesmo pai da (EMP)
     Projeto 2.0, e garante a coluna CONTA BANCÁRIA na base de obras.
  3. Casa as contas do ERP com as páginas do Notion pelo "ID ERP" e decide o
     que criar/atualizar/marcar como sumida ou que voltou — nunca mexendo em
     "Aparece" de conta já cadastrada (isso é decisão do dono, pelo painel).
  4. Com --ligar-antigas: liga as obras antigas (sem a relação, com texto na
     coluna CONTA) à conta certa, casando pelos dígitos do número.

MODOS (variáveis de ambiente, mesmo padrão dos outros robôs do MC):
  APLICAR=1              grava de verdade (no Notion). Sem ela, só simula.
  MC_ROBO_USUARIO/SENHA  credencial que enxerga TODAS as contas do ERP —
                         única que este robô usa para gravar (ver
                         `decidir_credenciais`). Sem ela, cai para
                         MC_USUARIO/MC_SENHA só para simular, com aviso, e
                         desliga APLICAR mesmo que a variável esteja ligada:
                         o login antigo não vê todas as contas, e gravar com
                         ele faria as que faltam reaparecerem depois como
                         "novas" (e marcadas em Aparece, sem o dono decidir).

SECRETS: NOTION_TOKEN (via fetch_vendas), MC_ROBO_USUARIO, MC_ROBO_SENHA
(novos), MC_USUARIO, MC_SENHA (recuo só-simulação).

Repo público: o log deste robô imprime SÓ CONTAGENS — nunca nome de conta,
banco, agência ou número.
"""

import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

from fetch_vendas import api, ler_banco

# (EMP) Projeto 2.0 — mesma base que robo_mc_obras.py usa como fila de obras.
ID_OBRAS = "306c5ab532d3812fa14fe9a281510128"
TITULO_BANCO_CONTAS = "CONTAS BANCÁRIAS"
COL_RELACAO_OBRAS = "CONTA BANCÁRIA"

# Endereços do ERP (copiados de fontes/comprovantes-mais-controle/erp/hosts.py)
ACESSAR = "https://acessar.maiscontroleerp.com.br"
ERP_API = "https://prod-erp-api.maiscontroleerp.com.br"
LEGACY = "https://legacy-api.maiscontroleerp.com.br/maiscontrole/services"
URL_LOGIN = f"{LEGACY}/users/login"

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

MAX_PAGINAS_CONTAS = 50


def N(s):
    """Maiúsculas sem acento — mesma normalização de robo_mc_comum.N (não
    importamos de lá para não arrastar o playwright do topo do módulo)."""
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def _norm_id(s):
    """UUID do Notion sem hífen e minúsculo — a API ora devolve COM hífen
    ("306c5ab5-32d3-..."), ora sem (o formato compacto que usamos nas
    constantes deste módulo); comparar direto nunca bate."""
    return str(s or "").replace("-", "").lower()


def so_digitos(s):
    return "".join(c for c in str(s or "") if c.isdigit())


def txt(p):
    t = (p or {}).get("type")
    v = (p or {}).get(t)
    if t == "title" or t == "rich_text":
        return "".join(x.get("plain_text", "") for x in v or [])
    if t in ("select", "status"):
        return (v or {}).get("name") or ""
    if t == "checkbox":
        return bool(v)
    if t == "relation":
        return v or []
    return ""


def pega(pr, nome):
    for k, v in (pr or {}).items():
        if N(k) == N(nome):
            return v
    return None


# ============================================================================
# T1 — núcleo puro (sem rede)
# ============================================================================

_PADRAO_DIGITOS_NOME = re.compile(r"\d{3,}-?\d")


def _com_digito(valor, digito):
    """'1234' + '5' -> '1234-5'; '1234' + '' -> '1234'; '' -> ''."""
    valor = str(valor or "").strip()
    digito = str(digito or "").strip()
    if not valor:
        return ""
    return f"{valor}-{digito}" if digito else valor


def conta_do_erp(item):
    """Normaliza um item da listagem de contas do ERP.

    Campos de entrada (API): id, name, bankCode, agency, agencyDigit,
    account, accountDigit. Quando o número (account) vem vazio, tenta tirar
    os dígitos do próprio nome (padrão de conta embutida no texto, ex.:
    "... Conta corrente: 1234-5 - SICOOB")."""
    item = item or {}
    nome = str(item.get("name") or "").strip()
    numero = _com_digito(item.get("account"), item.get("accountDigit"))
    if not numero:
        m = _PADRAO_DIGITOS_NOME.search(nome)
        if m:
            numero = m.group(0)
    return {
        "id": str(item.get("id") or ""),
        "nome": nome,
        "banco": str(item.get("bankCode") or "").strip(),
        "agencia": _com_digito(item.get("agency"), item.get("agencyDigit")),
        "numero": numero,
    }


_CAMPOS_COMPARADOS = ("nome", "banco", "agencia", "numero")
_SITUACAO_SUMIU = "SUMIU DO ERP"


def planejar(erp, notion, primeira_carga):
    """Decide o que fazer no Notion a partir do ERP e do que já existe lá.

    `erp`: lista de dicts no formato de `conta_do_erp` (id, nome, banco,
    agencia, numero).
    `notion`: lista de dicts com o que já está na página — page_id, id_erp,
    nome, banco, agencia, numero, situacao.
    Casamento é pelo "ID ERP". Devolve {"criar", "atualizar", "sumiu",
    "voltou"}: "criar" ganha "aparece" (False só na primeira carga); nenhuma
    das outras listas jamais toca em "Aparece" — é decisão do dono, feita
    pelo painel, e o robô nunca a revisita depois de criada a página."""
    erp = erp or []
    notion = notion or []
    por_id_erp = {n["id_erp"]: n for n in notion if n.get("id_erp")}
    ids_no_erp = {c["id"] for c in erp if c.get("id")}

    criar, atualizar, voltou = [], [], []
    for c in erp:
        if not c.get("id"):
            continue
        existente = por_id_erp.get(c["id"])
        if existente is None:
            criar.append({
                "id_erp": c["id"],
                "nome": c.get("nome", ""),
                "banco": c.get("banco", ""),
                "agencia": c.get("agencia", ""),
                "numero": c.get("numero", ""),
                "aparece": not primeira_carga,
            })
            continue
        mudou = {
            campo: c.get(campo, "") for campo in _CAMPOS_COMPARADOS
            if c.get(campo, "") != existente.get(campo, "")
        }
        if mudou:
            atualizar.append({"id": existente["page_id"], "campos": mudou})
        if N(existente.get("situacao", "")) == _SITUACAO_SUMIU:
            voltou.append({"id": existente["page_id"]})

    sumiu = [
        {"id": n["page_id"]} for n in notion
        if n.get("id_erp") and n["id_erp"] not in ids_no_erp
        and N(n.get("situacao", "")) != _SITUACAO_SUMIU
    ]

    return {"criar": criar, "atualizar": atualizar, "sumiu": sumiu, "voltou": voltou}


# Cada GRUPO de dígitos do texto — não o texto inteiro emendado, senão
# "Ag 3233 Conta 1234-5" vira "323312345" e uma conta CURTA pode casar
# atravessando a fronteira entre agência e número (ex.: "33123" bateria,
# sem ser nem a agência nem a conta). O dígito verificador separado por
# hífen ("1234-5") entra no MESMO grupo do número, porque é assim que
# `conta_do_erp`/`_com_digito` também gravam ("1234-5" -> dígitos "12345").
_GRUPO_DIGITOS_TEXTO = re.compile(r"\d+(?:-\d+)?")

# código do Banco Central -> nome curto, só o suficiente para desempatar
# quando o texto cita o banco por extenso. A coluna "Banco" das contas do
# ERP guarda o CÓDIGO (ex. "756"), não o nome — comparar código com "SICOOB"
# direto nunca batia.
BANCOS_CONHECIDOS = {
    "001": "BB", "033": "SANTANDER", "077": "INTER", "104": "CAIXA",
    "237": "BRADESCO", "260": "NUBANK", "341": "ITAU", "748": "SICREDI",
    "756": "SICOOB", "290": "PAGBANK", "380": "PICPAY",
}


def _banco_bate_no_texto(banco_conta, grupos_digitos, texto_n):
    """`banco_conta` normalmente é o código (ex. "756"). Casa por: o próprio
    código aparecendo como um GRUPO de dígitos isolado no texto (nunca como
    substring solta — "56" não pode casar dentro de "756"), OU o nome do
    banco aparecendo no texto (o nome da tabela, para código conhecido; o
    valor gravado direto, quando não é um código)."""
    banco_conta = str(banco_conta or "").strip()
    if not banco_conta:
        return False
    if banco_conta.isdigit():
        if banco_conta in grupos_digitos:
            return True
        nome = BANCOS_CONHECIDOS.get(banco_conta)
        return bool(nome) and N(nome) in texto_n
    return N(banco_conta) in texto_n


def casar_texto_conta(texto, contas):
    """Acha, entre `contas` (dicts com "id", "numero", "banco"), a que o
    texto descreve — cada GRUPO de dígitos do texto comparado, por
    IGUALDADE EXATA, aos dígitos do número da conta (nunca substring do
    texto inteiro emendado — ver `_GRUPO_DIGITOS_TEXTO`). Exige UM
    candidato; empate se desfaz pelo banco (`_banco_bate_no_texto`).
    "PESSOA FISICA"/vazio/sem dígito -> None."""
    texto = (texto or "").strip()
    if not texto or N(texto) == "PESSOA FISICA":
        return None
    grupos = [g for g in (so_digitos(x) for x in _GRUPO_DIGITOS_TEXTO.findall(texto)) if g]
    if not grupos:
        return None
    candidatos = [c for c in (contas or []) if so_digitos(c.get("numero")) in grupos]
    if not candidatos:
        return None
    if len(candidatos) == 1:
        return candidatos[0]["id"]
    texto_n = N(texto)
    com_banco = [c for c in candidatos if _banco_bate_no_texto(c.get("banco"), grupos, texto_n)]
    if len(com_banco) == 1:
        return com_banco[0]["id"]
    return None


# ============================================================================
# T2 — cliente do ERP (login + listagem de contas)
# ============================================================================

class LoginRecusado(Exception):
    """403 do WAF, ou erro de rede — motivo para recuar para o Playwright."""


def decidir_credenciais():
    """MC_ROBO_USUARIO/SENHA é quem enxerga todas as contas — é o único login
    com que este robô pode GRAVAR. Sem ela, usa MC_USUARIO/SENHA só para
    simular (e desliga APLICAR mesmo que a variável de ambiente esteja
    ligada). Devolve (usuario, senha, aplicar_permitido, aviso|None)."""
    robo_usuario = os.environ.get("MC_ROBO_USUARIO", "").strip()
    robo_senha = os.environ.get("MC_ROBO_SENHA", "")
    aplicar_env = os.environ.get("APLICAR", "").strip().lower() in ("1", "true", "sim")
    if robo_usuario and robo_senha:
        return robo_usuario, robo_senha, aplicar_env, None

    usuario = os.environ.get("MC_USUARIO", "").strip()
    senha = os.environ.get("MC_SENHA", "")
    if usuario and senha:
        return usuario, senha, False, "faltam MC_ROBO_USUARIO/MC_ROBO_SENHA — só simulei"
    return "", "", False, "faltam MC_ROBO_USUARIO/MC_ROBO_SENHA e MC_USUARIO/MC_SENHA — nada a fazer"


def _cabecalhos_login():
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "pt-BR",
        "content-type": "application/json",
        "origin": ACESSAR,
        "referer": ACESSAR + "/",
        "user-agent": USER_AGENT,
    }


def login_api(usuario, senha):
    """POST {LEGACY}/users/login — sem navegador. 403 ou erro de rede viram
    LoginRecusado (é o sinal para recuar pelo Playwright)."""
    import requests  # já instalado pelo workflow (playwright + requests)

    try:
        resp = requests.post(
            URL_LOGIN, json={"username": usuario, "password": senha},
            headers=_cabecalhos_login(), timeout=45,
        )
    except requests.exceptions.RequestException as e:
        raise LoginRecusado(f"erro de rede no login por API: {e}") from e
    if resp.status_code == 403:
        raise LoginRecusado("login por API recusado (403) — provável bloqueio de WAF")
    try:
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        raise LoginRecusado(f"login por API falhou (HTTP {resp.status_code}): {e}") from e
    corpo = resp.json() or {}
    jwt_token = str(corpo.get("jwtToken") or "")
    empresas = corpo.get("companies") or []
    company_id = str((empresas[0] or {}).get("id") or "") if empresas else ""
    if not jwt_token or not company_id:
        raise LoginRecusado("login por API não devolveu jwtToken/companies — contrato mudou")
    return jwt_token, company_id


def _cabecalhos_contas(jwt_token, company_id):
    d = _cabecalhos_login()
    d["authorization"] = f"Bearer {jwt_token}"
    d["company-id"] = company_id
    return d


def listar_contas_api(jwt_token, company_id):
    """GET paginado {ERP_API}/bank-integration/bank-accounts, só ativas.

    401/403/erro de rede também viram LoginRecusado aqui — não só no login:
    o jwtToken pode vencer (ou o WAF recusar só a partir da segunda chamada)
    depois de um login que deu certo, e o sinal para recuar pelo Playwright
    é o mesmo."""
    import requests

    itens = []
    pagina = 1
    while True:
        try:
            resp = requests.get(
                f"{ERP_API}/bank-integration/bank-accounts",
                params={"pageIndex": pagina, "pageSize": 200, "isActive": "true"},
                headers=_cabecalhos_contas(jwt_token, company_id), timeout=45,
            )
        except requests.exceptions.RequestException as e:
            raise LoginRecusado(f"erro de rede na listagem de contas: {e}") from e
        if resp.status_code in (401, 403):
            raise LoginRecusado(f"listagem de contas recusada (HTTP {resp.status_code})")
        resp.raise_for_status()
        corpo = resp.json() or {}
        itens.extend(corpo.get("items") or [])
        if not corpo.get("hasNextPage"):
            break
        pagina += 1
        if pagina > MAX_PAGINAS_CONTAS:
            print(f"  ! parei em {MAX_PAGINAS_CONTAS} páginas de contas (API)", flush=True)
            break
    return itens


# ---- recuo por Playwright (login pela tela, consulta de dentro da página) --

_JS_TOKEN_NO_STORAGE = """() => {
  const bate = (chave) => /jwttoken/i.test(chave);
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k) continue;
      const v = store.getItem(k);
      if (bate(k) && v) return v;
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object" && parsed.jwtToken) return parsed.jwtToken;
      } catch (e) { /* não era JSON — segue */ }
    }
  }
  return null;
}"""

_JS_COMPANY_NO_STORAGE = """() => {
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k) continue;
      const v = store.getItem(k);
      try {
        const parsed = JSON.parse(v);
        const empresas = parsed && (parsed.companies || (parsed.company && [parsed.company]));
        if (empresas && empresas[0] && empresas[0].id) return String(empresas[0].id);
      } catch (e) { /* não era JSON — segue */ }
    }
  }
  return null;
}"""

_JS_FETCH_PAGINA = """(args) => fetch(args.url, {
  headers: {
    "accept": "application/json, text/plain, */*",
    "authorization": "Bearer " + args.jwt,
    "company-id": args.company,
  }
}).then(async r => {
  if (!r.ok) { return { __erro: r.status, __texto: (await r.text()).slice(0, 200) }; }
  return r.json();
})"""


def _achar_no_storage(page, script):
    try:
        return page.evaluate(script)
    except Exception:
        return None


def listar_contas_playwright(page, jwt_token, company_id):
    """Mesma consulta de `listar_contas_api`, feita de DENTRO da página (o
    fetch sai com a origem/cookies do navegador — é o que passa pelo WAF).
    `fetch` não levanta em HTTP de erro — quem confere é o `r.ok` do JS
    (`_JS_FETCH_PAGINA`), e aqui só traduzimos em exceção."""
    itens = []
    pagina = 1
    while True:
        url = (f"{ERP_API}/bank-integration/bank-accounts"
               f"?pageIndex={pagina}&pageSize=200&isActive=true")
        corpo = page.evaluate(_JS_FETCH_PAGINA, {"url": url, "jwt": jwt_token, "company": company_id}) or {}
        if corpo.get("__erro"):
            raise SystemExit(f"recuo por Playwright: a consulta de contas voltou HTTP {corpo['__erro']} "
                             f"— {corpo.get('__texto') or ''}")
        itens.extend(corpo.get("items") or [])
        if not corpo.get("hasNextPage"):
            break
        pagina += 1
        if pagina > MAX_PAGINAS_CONTAS:
            print(f"  ! parei em {MAX_PAGINAS_CONTAS} páginas de contas (recuo Playwright)", flush=True)
            break
    return itens


def _contas_via_playwright(usuario, senha):
    """Recuo: login pela tela (robo_mc_comum.login) e a mesma consulta feita
    de dentro da página. Import tardio de propósito — só aqui é que o
    playwright (e o robo_mc_comum, que o importa no topo) entram em cena;
    os testes deste módulo não podem depender de nenhum dos dois."""
    from playwright.sync_api import sync_playwright
    import robo_mc_comum as comum

    # robo_mc_comum lê MC_USUARIO/MC_SENHA do ambiente NO IMPORT (módulo já
    # carregado antes desta função rodar) — trocar os.environ depois não
    # muda o que ele já guardou em MC_USUARIO/MC_SENHA. Este robô pode logar
    # com outra credencial (MC_ROBO_*), então sobrescrevemos os ATRIBUTOS do
    # módulo diretamente, que é o que `comum.login` de fato lê.
    if not comum.MC_URL:
        raise SystemExit("recuo por Playwright: falta o secret MC_URL (robo_mc_comum.login exige).")
    comum.MC_USUARIO, comum.MC_SENHA = usuario, senha

    capturado = {}

    def _resp(r):
        if capturado.get("jwt"):
            return
        try:
            if r.request.method == "POST" and "/users/login" in r.url:
                corpo = r.json()
                jwt = corpo.get("jwtToken")
                empresas = corpo.get("companies") or []
                if jwt:
                    capturado["jwt"] = jwt
                    capturado["company"] = str((empresas[0] or {}).get("id") or "")
        except Exception:
            pass

    with sync_playwright() as p:
        b, page = comum.abrir(p)
        try:
            page.on("response", _resp)
            comum.login(page)
            jwt_token = capturado.get("jwt") or _achar_no_storage(page, _JS_TOKEN_NO_STORAGE)
            company_id = capturado.get("company") or _achar_no_storage(page, _JS_COMPANY_NO_STORAGE)
            if not jwt_token:
                raise SystemExit("recuo por Playwright: não achei o jwtToken (nem no storage, nem na resposta do login).")
            itens = listar_contas_playwright(page, jwt_token, company_id or "")
        finally:
            b.close()
    return itens


def contas_ativas_do_erp(usuario, senha):
    """Login por API; recua para Playwright em 403/erro de rede. Sempre
    filtra isActive (mesmo a API já pedindo só ativas — defesa em dobro)."""
    try:
        jwt_token, company_id = login_api(usuario, senha)
        itens = listar_contas_api(jwt_token, company_id)
        print("  login no ERP: por API", flush=True)
    except LoginRecusado as e:
        print(f"  ! login por API não deu: {e} — recuando para Playwright", flush=True)
        itens = _contas_via_playwright(usuario, senha)
        print("  login no ERP: recuo por Playwright", flush=True)
    return [conta_do_erp(i) for i in itens if i.get("isActive", True)]


# ============================================================================
# T3 — lado do Notion + main
# ============================================================================

_COLUNAS_BANCO = {
    "Conta": {"title": {}},
    "Banco": {"rich_text": {}},
    "Agência": {"rich_text": {}},
    "Número": {"rich_text": {}},
    "ID ERP": {"rich_text": {}},
    "Aparece": {"checkbox": {}},
    "Situação no ERP": {"select": {"options": [{"name": "Ativa"}, {"name": "Sumiu do ERP"}]}},
    "Atualizado em": {"date": {}},
}

_MAPA_CAMPO_PROPRIEDADE = {
    "nome": "Conta", "banco": "Banco", "agencia": "Agência", "numero": "Número",
}


def _texto_prop(chave, valor):
    tipo = "title" if chave == "Conta" else "rich_text"
    return {tipo: [{"text": {"content": str(valor or "")}}]}


_MAX_PAGINAS_BLOCOS = 50


def _achar_filho_banco(pai):
    """Lista os blocos-filho do pai (paginado) procurando um
    "child_database" chamado CONTAS BANCÁRIAS. Em vez do `/search`: ele lê
    de um índice que atrasa a indexar página nova, e um banco criado nesta
    MESMA rodada (ou por outra rodada minutos antes) pode ainda não
    aparecer — rodando de novo, o robô o criaria duplicado. `/blocks/.../
    children` lê a estrutura de verdade, sem atraso de índice."""
    cursor = None
    paginas = 0
    while True:
        caminho = f"/blocks/{pai}/children?page_size=100"
        if cursor:
            caminho += f"&start_cursor={cursor}"
        r = api("GET", caminho)
        for bloco in r.get("results") or []:
            if bloco.get("type") != "child_database":
                continue
            titulo = (bloco.get("child_database") or {}).get("title") or ""
            if N(titulo) == N(TITULO_BANCO_CONTAS):
                return bloco["id"]
        if not r.get("has_more"):
            return None
        cursor = r.get("next_cursor")
        paginas += 1
        if paginas > _MAX_PAGINAS_BLOCOS:
            print(f"  ! parei em {_MAX_PAGINAS_BLOCOS} páginas de blocos procurando o banco de contas", flush=True)
            return None


def achar_ou_criar_banco(aplicar):
    """Pai = a mesma página da (EMP) Projeto 2.0. Procura o filho
    "CONTAS BANCÁRIAS" pelos blocos do pai (não pelo `/search` — índice
    atrasado cria duplicata); não achando e sem APLICAR, só avisa (não
    cria). Devolve (db_id | None, criado_agora)."""
    obras = api("GET", f"/databases/{ID_OBRAS}")
    pai = (obras.get("parent") or {}).get("page_id")
    if not pai:
        raise SystemExit("a base de obras não tem page_id como pai — não sei onde criar o banco de contas.")

    achado = _achar_filho_banco(pai)
    if achado:
        return achado, False

    if not aplicar:
        print("Banco CONTAS BANCÁRIAS não existe — sem APLICAR, simulando (criaria o banco).", flush=True)
        return None, True

    novo = api("POST", "/databases", {
        "parent": {"type": "page_id", "page_id": pai},
        "title": [{"type": "text", "text": {"content": TITULO_BANCO_CONTAS}}],
        "properties": _COLUNAS_BANCO,
    })
    return novo["id"], True


def garantir_relacao(db_id):
    """Garante, na base de obras, a coluna CONTA BANCÁRIA (relação com o
    banco novo). E, EM TODA RODADA — não só quando a coluna nasce —, confere
    se o lado de volta (a relação que o Notion cria sozinho no banco novo)
    já se chama "Obras"; se ainda não (alguém não conseguiu renomear numa
    rodada anterior, ou renomeou de volta sem querer), tenta de novo."""
    esquema_obras = api("GET", f"/databases/{ID_OBRAS}").get("properties") or {}
    if not any(N(k) == N(COL_RELACAO_OBRAS) for k in esquema_obras):
        api("PATCH", f"/databases/{ID_OBRAS}", {
            "properties": {COL_RELACAO_OBRAS: {"relation": {"database_id": db_id, "dual_property": {}}}}
        })

    esquema_novo = api("GET", f"/databases/{db_id}").get("properties") or {}
    lado_de_volta = None
    for nome, prop in esquema_novo.items():
        # o "database_id" que o Notion devolve aqui vem COM hífen
        # ("306c5ab5-32d3-..."); ID_OBRAS está no formato compacto (sem
        # hífen) — comparar direto nunca bate. `_norm_id` neutraliza os dois.
        if prop.get("type") == "relation" and _norm_id((prop.get("relation") or {}).get("database_id")) == _norm_id(ID_OBRAS):
            lado_de_volta = nome
            break
    if lado_de_volta and N(lado_de_volta) != N("Obras"):
        api("PATCH", f"/databases/{db_id}", {"properties": {lado_de_volta: {"name": "Obras"}}})


def _notion_para_dict(pagina):
    pr = pagina.get("properties") or {}
    return {
        "page_id": pagina["id"],
        "id_erp": txt(pega(pr, "ID ERP")),
        "nome": txt(pega(pr, "Conta")),
        "banco": txt(pega(pr, "Banco")),
        "agencia": txt(pega(pr, "Agência")),
        "numero": txt(pega(pr, "Número")),
        "situacao": txt(pega(pr, "Situação no ERP")),
    }


def aplicar_plano(db_id, plano):
    agora = datetime.now(timezone.utc).isoformat()
    for c in plano["criar"]:
        propriedades = {_MAPA_CAMPO_PROPRIEDADE[k]: _texto_prop(_MAPA_CAMPO_PROPRIEDADE[k], v)
                        for k, v in c.items() if k in _MAPA_CAMPO_PROPRIEDADE}
        propriedades["ID ERP"] = _texto_prop("ID ERP", c["id_erp"])
        propriedades["Aparece"] = {"checkbox": bool(c["aparece"])}
        propriedades["Situação no ERP"] = {"select": {"name": "Ativa"}}
        propriedades["Atualizado em"] = {"date": {"start": agora}}
        api("POST", "/pages", {"parent": {"database_id": db_id}, "properties": propriedades})

    for u in plano["atualizar"]:
        propriedades = {_MAPA_CAMPO_PROPRIEDADE[k]: _texto_prop(_MAPA_CAMPO_PROPRIEDADE[k], v)
                        for k, v in u["campos"].items()}
        propriedades["Atualizado em"] = {"date": {"start": agora}}
        api("PATCH", f"/pages/{u['id']}", {"properties": propriedades})

    for s in plano["sumiu"]:
        api("PATCH", f"/pages/{s['id']}", {"properties": {
            "Situação no ERP": {"select": {"name": "Sumiu do ERP"}},
            "Atualizado em": {"date": {"start": agora}},
        }})

    for v in plano["voltou"]:
        api("PATCH", f"/pages/{v['id']}", {"properties": {
            "Situação no ERP": {"select": {"name": "Ativa"}},
            "Atualizado em": {"date": {"start": agora}},
        }})


def ligar_obras_antigas(contas_notion, aplicar):
    """Para cada obra sem a relação e com texto na coluna CONTA: casa com UMA
    conta do banco pelos dígitos do número (+ banco quando houver). Grava a
    relação só com APLICAR."""
    ligadas = sem_par = ambiguas = 0
    for pg in ler_banco(ID_OBRAS, "OBRAS"):
        pr = pg.get("properties") or {}
        relacao = pega(pr, COL_RELACAO_OBRAS)
        if relacao and txt(relacao):
            continue
        texto_conta = txt(pega(pr, "CONTA"))
        if not texto_conta or N(texto_conta) == "PESSOA FISICA":
            continue
        alvo = casar_texto_conta(texto_conta, contas_notion)
        if alvo is None:
            digitos = so_digitos(texto_conta)
            candidatos = [c for c in contas_notion if digitos and so_digitos(c.get("numero")) in digitos]
            if len(candidatos) > 1:
                ambiguas += 1
            else:
                sem_par += 1
            continue
        ligadas += 1
        if aplicar:
            api("PATCH", f"/pages/{pg['id']}", {
                "properties": {COL_RELACAO_OBRAS: {"relation": [{"id": alvo}]}}
            })
    print(f"--ligar-antigas: {ligadas} ligadas, {sem_par} sem par, {ambiguas} ambíguas"
          + ("" if aplicar else " (simulação)"), flush=True)


def main():
    ligar_antigas = "--ligar-antigas" in sys.argv[1:]

    usuario, senha, aplicar, aviso = decidir_credenciais()
    if aviso:
        print(f"  ! {aviso}", flush=True)
    if not (usuario and senha):
        print("Sem credencial nenhuma do ERP — nada a fazer.", flush=True)
        return 1

    contas_erp = contas_ativas_do_erp(usuario, senha)
    print(f"ERP: {len(contas_erp)} contas ativas", flush=True)

    if not contas_erp:
        # 0 contas quase certamente é falha de leitura (resposta sem
        # "items", página vazia por erro), não sumiço real de TODAS as
        # contas — se seguisse, `planejar` marcaria toda página do Notion
        # como "Sumiu do ERP". Aborta antes de tocar no Notion.
        print("  ! ERP devolveu 0 contas ativas — abortando sem mexer no Notion (não aplico nada nesta rodada).", flush=True)
        return 1

    db_id, criado_agora = achar_ou_criar_banco(aplicar)
    if db_id is None:
        # sem APLICAR e o banco ainda não existe: não há página nenhuma para
        # casar — simula como se fosse a primeira carga inteira, contra uma
        # lista vazia, só para mostrar as contagens.
        contas_notion, primeira_carga = [], True
    else:
        if aplicar:
            garantir_relacao(db_id)
        paginas_notion = ler_banco(db_id, "CONTAS BANCÁRIAS")
        contas_notion = [_notion_para_dict(pg) for pg in paginas_notion]
        primeira_carga = criado_agora or not contas_notion

    plano = planejar(contas_erp, contas_notion, primeira_carga)
    print(f"Plano: {len(plano['criar'])} para criar, {len(plano['atualizar'])} para atualizar, "
          f"{len(plano['sumiu'])} sumiram do ERP, {len(plano['voltou'])} voltaram", flush=True)

    pode_gravar = aplicar and db_id is not None
    if pode_gravar:
        aplicar_plano(db_id, plano)
        print("APLICADO", flush=True)
    else:
        print("SIMULAÇÃO — nada foi gravado no Notion", flush=True)

    if ligar_antigas:
        # relê o banco depois de aplicar o plano, para casar já com o que
        # acabou de ser criado/atualizado nesta rodada.
        contas_para_ligar = ([_notion_para_dict(pg) for pg in ler_banco(db_id, "CONTAS BANCÁRIAS")]
                              if pode_gravar else contas_notion)
        ligar_obras_antigas(contas_para_ligar, pode_gravar)

    return 0


if __name__ == "__main__":
    sys.exit(main())
