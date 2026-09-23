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
  2. Usa o banco CONTAS BANCÁRIAS do Notion (id fixo em CONTAS_DB_ID; sem
     ele, acha/cria no mesmo pai da (EMP) Projeto 2.0) e garante as colunas.
  3. Casa as contas do ERP com as páginas do Notion pelo "ID ERP" e decide o
     que criar/atualizar/marcar como sumida ou que voltou — nunca mexendo em
     "Aparece" de conta já cadastrada (isso é decisão do dono, pelo painel).
  4. Coluna CONTA das obras (23/09/26): ela é uma SELEÇÃO cujas opções são os
     nomes das contas do ERP (+ PESSOA FÍSICA, CRIAR CONTA e DÚVIDA). Toda
     rodada mantém as opções em dia (conta nova entra, conta renomeada no ERP
     é renomeada na opção — e as obras acompanham). Na PRIMEIRA rodada com
     APLICAR, se a CONTA ainda for a fórmula antiga, ela é convertida: cada
     obra recebe a conta real que a fórmula descrevia; o que não der para
     casar com segurança fica "DÚVIDA", para alguém escolher depois.

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
# Banco criado à mão no Notion (23/09/26). Com ele, o robô não precisa achar
# a página-pai da base de obras (que a integração não enxerga).
CONTAS_DB_ID = os.environ.get("CONTAS_DB_ID", "").strip()
COL_CONTA_OBRAS = "CONTA"              # seleção na (EMP) Projeto 2.0
COL_OPCAO = "Nome na obra"             # nome da opção na CONTA das obras
OPC_PF, OPC_CRIAR, OPC_DUVIDA = "PESSOA FÍSICA", "CRIAR CONTA", "DÚVIDA"
OPCOES_ESPECIAIS = [OPC_PF, OPC_CRIAR, OPC_DUVIDA]

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
    if t == "formula" and v:
        x = v.get(v.get("type"))
        return "" if x is None else str(x)
    if t == "number":
        return "" if v is None else str(v)
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
    "voltou"}: "criar" ganha "aparece" (False na primeira carga — ver
    `decidir_primeira_carga`); nenhuma
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
# "Ag 4321 Conta 1234-5" vira "432112345" e uma conta CURTA pode casar
# atravessando a fronteira entre agência e número (ex.: "21123" bateria,
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


def _grupos_digitos(texto):
    return [g for g in (so_digitos(x) for x in _GRUPO_DIGITOS_TEXTO.findall(texto or "")) if g]


def _candidatos_por_digitos(texto, contas):
    """Contas cujo número (só dígitos) é IGUAL a algum grupo de dígitos do
    texto. Mesma regra usada por `casar_texto_conta` e pela contagem de
    ambíguas do `ligar_obras_antigas` — uma só, para as duas não divergirem."""
    grupos = _grupos_digitos(texto)
    if not grupos:
        return []
    return [c for c in (contas or []) if so_digitos(c.get("numero")) and so_digitos(c.get("numero")) in grupos]


def contas_para_casar(contas_notion):
    """Converte as páginas do banco (formato `_notion_para_dict`: page_id,
    numero, banco, situacao) no contrato de `casar_texto_conta` (id, numero,
    banco) — e tira as contas "Sumiu do ERP": obra antiga nunca é ligada a
    conta que não existe mais no ERP."""
    return [
        {"id": d["page_id"], "numero": d.get("numero", ""), "banco": d.get("banco", "")}
        for d in (contas_notion or [])
        if d.get("page_id") and N(d.get("situacao", "")) != _SITUACAO_SUMIU
    ]


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
    grupos = _grupos_digitos(texto)
    if not grupos:
        return None
    candidatos = _candidatos_por_digitos(texto, contas)
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
    COL_OPCAO: {"rich_text": {}},
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


def _pagina_pai_das_obras():
    """Página onde o banco CONTAS BANCÁRIAS nasce: a mesma da (EMP) Projeto 2.0.

    23/09/26 — a base de obras não é filha DIRETA de uma página: ela está
    dentro de um bloco (coluna, toggle, callout...), e aí o Notion devolve
    parent = {"type": "block_id"}. Antes o robô parava aí. Agora sobe pelos
    blocos até achar a página. Se a base estiver solta no workspace (sem
    página nenhuma), use a variável NOTION_PAI_CONTAS com o id de uma página
    compartilhada com a integração."""
    fixo = os.environ.get("NOTION_PAI_CONTAS", "").strip()
    if fixo:
        return fixo
    atual = (api("GET", f"/databases/{ID_OBRAS}").get("parent") or {})
    for _ in range(12):
        tipo = atual.get("type")
        if tipo == "page_id":
            return atual["page_id"]
        if tipo == "block_id":
            atual = (api("GET", f"/blocks/{atual['block_id']}").get("parent") or {})
            continue
        break
    raise SystemExit(
        f"não achei a página onde a base de obras mora (parent = {atual.get('type') or 'desconhecido'}). "
        "Crie/escolha uma página no Notion, compartilhe com a integração e rode com a variável "
        "NOTION_PAI_CONTAS = id dessa página.")


def achar_ou_criar_banco(aplicar):
    """Pai = a mesma página da (EMP) Projeto 2.0. Procura o filho
    "CONTAS BANCÁRIAS" pelos blocos do pai (não pelo `/search` — índice
    atrasado cria duplicata); não achando e sem APLICAR, só avisa (não
    cria). Devolve (db_id | None, criado_agora)."""
    if CONTAS_DB_ID:
        if aplicar:
            preparar_banco_fixo(CONTAS_DB_ID)
        return CONTAS_DB_ID, False
    pai = _pagina_pai_das_obras()

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


def preparar_banco_fixo(db_id):
    """Banco criado à mão (CONTAS_DB_ID): nasce só com o título "Nome". Aqui
    o título vira "Conta", as colunas que faltam são criadas e o banco ganha
    o nome CONTAS BANCÁRIAS. Só acrescenta — nunca apaga coluna nenhuma."""
    db = api("GET", f"/databases/{db_id}")
    props = db.get("properties") or {}
    mudar = {}
    for nome, prop in props.items():
        if prop.get("type") == "title" and N(nome) != N("Conta"):
            mudar[nome] = {"name": "Conta"}
    tem = {N(k) for k in props}
    for nome, definicao in _COLUNAS_BANCO.items():
        if "title" in definicao or N(nome) in tem:
            continue
        mudar[nome] = definicao
    corpo = {"properties": mudar} if mudar else {}
    titulo = "".join(x.get("plain_text", "") for x in (db.get("title") or []))
    if N(titulo) != N(TITULO_BANCO_CONTAS):
        corpo["title"] = [{"type": "text", "text": {"content": TITULO_BANCO_CONTAS}}]
    if corpo:
        api("PATCH", f"/databases/{db_id}", corpo)
        print(f"Banco de contas preparado: {len(mudar)} coluna(s) ajustada(s)", flush=True)


# ============================================================================
# Coluna CONTA das obras — seleção com os nomes das contas do ERP
# ============================================================================

def nome_opcao(nome):
    """Nome de opção de seleção do Notion: sem vírgula (a API recusa), sem
    espaço sobrando, até 100 caracteres."""
    t = " ".join(str(nome or "").replace(",", " ").split())
    return t[:100]


def opcoes_das_contas(contas):
    """{page_id: nome da opção} para as contas ATIVAS. Duas contas com o mesmo
    nome no ERP ganham o final do número para não virarem a mesma opção."""
    ativas = [c for c in (contas or []) if c.get("page_id") and N(c.get("situacao", "")) != _SITUACAO_SUMIU]
    contagem = {}
    for c in ativas:
        contagem[N(nome_opcao(c.get("nome")))] = contagem.get(N(nome_opcao(c.get("nome"))), 0) + 1
    out = {}
    for c in ativas:
        base = nome_opcao(c.get("nome"))
        if not base:
            continue
        if contagem[N(base)] > 1:
            fim = so_digitos(c.get("numero"))[-4:] or str(c.get("id_erp") or "")[-4:]
            base = nome_opcao(f"{base[:90]} {fim}")
        out[c["page_id"]] = base
    return out


_RUIDO = {"SPE", "LTDA", "S/A", "SA", "ME", "EIRELI", "DE", "DA", "DO", "DOS", "DAS", "E",
          "CONTA", "CORRENTE", "C/C", "CC", "AG", "AGENCIA", "-", "–", "N", "NO", "NUM"}


def _tokens(texto):
    return {t for t in re.split(r"[^A-Z0-9/]+", N(texto)) if t and t not in _RUIDO and not t.isdigit()}


def _tokens_conta(c):
    tk = _tokens(c.get("nome"))
    banco = str(c.get("banco") or "").strip()
    if banco in BANCOS_CONHECIDOS:
        tk.add(N(BANCOS_CONHECIDOS[banco]))
    if "CAIXA" in tk:
        tk.add("CEF")
    return tk


def casar_obra_conta(texto, numero_obra, contas):
    """Função PURA: que conta a fórmula antiga da obra descrevia.

    `contas`: dicts com page_id, nome, numero, banco, situacao, opcao.
    Devolve (opcao | "", motivo): "" quando a fórmula estava vazia;
    PESSOA FÍSICA quando era pessoa física; DÚVIDA quando não dá para
    garantir UMA conta. Ordem (da mais segura para a menos):
      1. nome igual (sem acento/caixa);
      2. número da conta (dígitos da fórmula ou da coluna Nº DA CONTA),
         desempatado pelo banco;
      3. todas as palavras da fórmula presentes no nome da conta (+ nome do
         banco), com UMA candidata só — ou uma só entre as que batem também
         o número."""
    texto = str(texto or "").strip()
    if not texto:
        return "", "vazia"
    if N(texto) == N(OPC_PF):
        return OPC_PF, "pf"
    ativas = [c for c in (contas or []) if c.get("opcao") and N(c.get("situacao", "")) != _SITUACAO_SUMIU]
    iguais = [c for c in ativas if N(c.get("nome")) == N(texto) or N(c.get("opcao")) == N(texto)]
    if len(iguais) == 1:
        return iguais[0]["opcao"], "nome"

    fonte_digitos = texto + " " + str(numero_obra or "")
    por_numero = [c for c in ativas if so_digitos(c.get("numero"))
                  and so_digitos(c.get("numero")) in _grupos_digitos(fonte_digitos)]
    if len(por_numero) == 1:
        return por_numero[0]["opcao"], "numero"
    if len(por_numero) > 1:
        texto_n = N(texto)
        grupos = _grupos_digitos(fonte_digitos)
        com_banco = [c for c in por_numero if _banco_bate_no_texto(c.get("banco"), grupos, texto_n)]
        if len(com_banco) == 1:
            return com_banco[0]["opcao"], "numero"

    alvo = _tokens(texto)
    if alvo:
        contem = [c for c in ativas if alvo <= _tokens_conta(c)]
        if len(contem) == 1:
            return contem[0]["opcao"], "palavras"
        if len(contem) > 1 and por_numero:
            ids = {c["page_id"] for c in por_numero}
            dos_dois = [c for c in contem if c["page_id"] in ids]
            if len(dos_dois) == 1:
                return dos_dois[0]["opcao"], "palavras"
    return OPC_DUVIDA, "duvida"


def _opcoes_desejadas(contas):
    mapa = opcoes_das_contas(contas)
    return mapa, list(dict.fromkeys(list(mapa.values()) + OPCOES_ESPECIAIS))


def sincronizar_coluna_conta(db_id, contas, aplicar):
    """Mantém a coluna CONTA das obras como seleção com os nomes das contas.

    - Coluna ainda é a FÓRMULA antiga -> `migrar_coluna_conta` (uma vez só).
    - Já é seleção -> acrescenta conta nova, renomeia a opção da conta que
      mudou de nome no ERP (as obras acompanham, porque a opção é a mesma) e
      grava em "Nome na obra" o nome da opção de cada conta.
    Imprime só contagens (repo público)."""
    mapa, desejadas = _opcoes_desejadas(contas)
    esquema = api("GET", f"/databases/{ID_OBRAS}").get("properties") or {}
    nome_col, prop = None, None
    for k, v in esquema.items():
        if N(k) == N(COL_CONTA_OBRAS):
            nome_col, prop = k, v
    if prop is None or prop.get("type") == "formula":
        return migrar_coluna_conta(nome_col, contas, mapa, desejadas, aplicar)
    if prop.get("type") != "select":
        print(f"  ! coluna {COL_CONTA_OBRAS} das obras é do tipo {prop.get('type')} — não mexi", flush=True)
        return

    existentes = (prop.get("select") or {}).get("options") or []
    por_nome = {N(o.get("name")): o for o in existentes}
    renomear, novas = 0, []
    for c in contas or []:
        nova = mapa.get(c.get("page_id"))
        velha = c.get("opcao")
        if not nova:
            continue
        if velha and N(velha) != N(nova) and N(velha) in por_nome and N(nova) not in por_nome:
            por_nome[N(velha)]["name"] = nova
            por_nome[N(nova)] = por_nome.pop(N(velha))
            renomear += 1
    for nome in desejadas:
        if N(nome) not in por_nome:
            novas.append({"name": nome})
            por_nome[N(nome)] = {"name": nome}
    print(f"CONTA das obras: {len(novas)} opção(ões) nova(s), {renomear} renomeada(s)"
          + ("" if aplicar else " (simulação)"), flush=True)
    if aplicar:
        if novas or renomear:
            opcoes = [{"id": o["id"], "name": o["name"]} if o.get("id") else {"name": o["name"]}
                      for o in list({id(o): o for o in por_nome.values()}.values())]
            api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {nome_col: {"select": {"options": opcoes}}}})
        _gravar_nome_na_obra(contas, mapa)


def _gravar_nome_na_obra(contas, mapa):
    for c in contas or []:
        nova = mapa.get(c.get("page_id"))
        if nova and N(c.get("opcao")) != N(nova):
            api("PATCH", f"/pages/{c['page_id']}", {"properties": {COL_OPCAO: _texto_prop(COL_OPCAO, nova)}})


def migrar_coluna_conta(nome_col, contas, mapa, desejadas, aplicar):
    """Troca a fórmula CONTA por uma seleção com o MESMO nome e preenche cada
    obra com a conta real que a fórmula descrevia (`casar_obra_conta`).

    Lê todas as obras ANTES de mexer no esquema — é o único momento em que o
    texto da fórmula ainda existe. Tenta converter a coluna no lugar (fica na
    mesma posição das visões); se o Notion recusar, cria a seleção ao lado,
    preenche e só então apaga a fórmula. A fórmula pode ser refeita a
    qualquer hora: ela só lê PROPRIETÁRIO (CADASTRO) e Nº DA CONTA, que
    continuam intactas."""
    contas_opc = [dict(c, opcao=mapa.get(c.get("page_id"), "")) for c in (contas or [])]
    obras = ler_banco(ID_OBRAS, "OBRAS")
    alvo, cont = {}, {}
    for pg in obras:
        pr = pg.get("properties") or {}
        texto = txt(pega(pr, COL_CONTA_OBRAS))
        numero = txt(pega(pr, "Nº DA CONTA"))
        opcao, motivo = casar_obra_conta(texto, numero, contas_opc)
        alvo[pg["id"]] = opcao
        cont[motivo] = cont.get(motivo, 0) + 1
    print("CONTA das obras (fórmula -> seleção): "
          f"{cont.get('nome', 0)} pelo nome, {cont.get('numero', 0)} pelo número, "
          f"{cont.get('palavras', 0)} pelas palavras, {cont.get('pf', 0)} pessoa física, "
          f"{cont.get('duvida', 0)} DÚVIDA, {cont.get('vazia', 0)} vazias"
          + ("" if aplicar else " (simulação — nada foi gravado)"), flush=True)
    if not aplicar:
        return

    opcoes = [{"name": n} for n in desejadas]
    col = nome_col or COL_CONTA_OBRAS
    antiga = None
    try:
        api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {col: {"select": {"options": opcoes}}}})
    except SystemExit:
        # o Notion não deixou converter no lugar: seleção nova ao lado
        antiga = col + " (FÓRMULA ANTIGA)"
        api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {col: {"name": antiga}}})
        api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {col: {"select": {"options": opcoes}}}})
    for pid, opcao in alvo.items():
        api("PATCH", f"/pages/{pid}", {"properties": {col: {"select": {"name": opcao} if opcao else None}}})
    if antiga:
        api("PATCH", f"/databases/{ID_OBRAS}", {"properties": {antiga: None}})
    _gravar_nome_na_obra(contas, mapa)
    print(f"CONTA das obras convertida para seleção ({len(alvo)} obras gravadas)", flush=True)


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
        "aparece": txt(pega(pr, "Aparece")) is True,
        "opcao": txt(pega(pr, COL_OPCAO)),
    }


def decidir_primeira_carga(criado_agora, contas_notion):
    """Conta nova só nasce com "Aparece" MARCADO quando o banco já passou pela
    primeira carga E o dono já decidiu alguma coisa nele: tem ao menos uma
    página com "Aparece" marcado E ao menos uma página com "ID ERP". Fora
    disso é "primeira carga" (tudo nasce desmarcado). Olhar só "banco vazio"
    não basta: uma primeira gravação que cai no meio (ou uma página manual
    sem ID ERP num banco vazio) faria as restantes nascerem marcadas sem o
    dono escolher. Na dúvida, desmarcado — o dono marca pelo painel."""
    if criado_agora:
        return True
    contas_notion = contas_notion or []
    tem_marcada = any(c.get("aparece") is True for c in contas_notion)
    tem_id_erp = any(c.get("id_erp") for c in contas_notion)
    return not (tem_marcada and tem_id_erp)


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
        paginas_notion = ler_banco(db_id, "CONTAS BANCÁRIAS")
        contas_notion = [_notion_para_dict(pg) for pg in paginas_notion]
        primeira_carga = decidir_primeira_carga(criado_agora, contas_notion)

    plano = planejar(contas_erp, contas_notion, primeira_carga)
    print(f"Plano: {len(plano['criar'])} para criar, {len(plano['atualizar'])} para atualizar, "
          f"{len(plano['sumiu'])} sumiram do ERP, {len(plano['voltou'])} voltaram", flush=True)

    pode_gravar = aplicar and db_id is not None
    if pode_gravar:
        aplicar_plano(db_id, plano)
        print("APLICADO", flush=True)
    else:
        print("SIMULAÇÃO — nada foi gravado no Notion", flush=True)

    # coluna CONTA das obras: relê o banco depois de aplicar (as contas
    # novas já têm página); na simulação com o banco ainda vazio, usa o ERP
    # como se já estivesse gravado, só para mostrar as contagens.
    if pode_gravar:
        contas_para_coluna = [_notion_para_dict(pg) for pg in ler_banco(db_id, "CONTAS BANCÁRIAS")]
    elif contas_notion:
        contas_para_coluna = contas_notion
    else:
        contas_para_coluna = [dict(c, page_id="sim-" + c["id"], id_erp=c["id"], situacao="Ativa", opcao="")
                              for c in contas_erp]
    sincronizar_coluna_conta(db_id, contas_para_coluna, pode_gravar)
    if ligar_antigas:
        print("--ligar-antigas: sem efeito — a coluna CONTA já é preenchida pela conversão acima", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
