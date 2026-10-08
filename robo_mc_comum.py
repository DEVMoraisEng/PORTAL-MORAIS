#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_mc_comum.py — PORTAL-MORAIS · funções comuns dos robôs do Mais Controle

Os dois robôs (robo_mc_clientes.py e robo_mc_obras.py) entram no Mais
Controle com Playwright, igual ao OR-ADO-REALIZADO, e gravam no Notion com o
mesmo NOTION_TOKEN dos outros fetch_*.py.

MODOS (variáveis de ambiente):
  APLICAR=1    grava de verdade (no MC e no Notion). SEM ela, só simula:
               lê tudo, preenche formulário sem salvar e imprime o que faria.
  DESCOBRIR=1  salva print + HTML de CADA tela em mc_evidencias/ — é o que
               eu preciso ver para acertar um seletor que falhe. Sem ela,
               só salva as telas de navegação (sem dado de cliente).

SECRETS: MC_URL (endereço da tela de login), MC_USUARIO, MC_SENHA, NOTION_TOKEN,
         MC_EMAIL_SENHA_APP (08/10/26 — senha de app do Gmail da conta do robô,
         para ler o código que o MC manda por e-mail a cada login).

Os seletores são por TEXTO visível (os rótulos que aparecem na tela:
"Contatos", "Clientes", "Nova Obra", "Nome da obra"…), não por classe CSS —
é o que menos quebra quando o MC muda o visual.
"""

import email
import html as _html
import imaplib
import os
import re
import time
import unicodedata
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout

MC_URL = os.environ.get("MC_URL", "").strip()

# Credencial: por padrão MC_USUARIO/MC_SENHA (login que os robôs sempre
# usaram). Com MC_CRED=robo no step E MC_ROBO_USUARIO/MC_ROBO_SENHA
# preenchidos, usa essa credencial nova (enxerga mais, ex. todas as contas
# bancárias); faltando qualquer uma das duas, recua para MC_USUARIO/MC_SENHA
# — o robô de clientes não seta MC_CRED e nunca sai do login antigo.
_CRED_ROBO = os.environ.get("MC_CRED", "").strip().lower() == "robo"
_ROBO_USUARIO = os.environ.get("MC_ROBO_USUARIO", "").strip()
_ROBO_SENHA = os.environ.get("MC_ROBO_SENHA", "")
if _CRED_ROBO and _ROBO_USUARIO and _ROBO_SENHA:
    MC_USUARIO, MC_SENHA = _ROBO_USUARIO, _ROBO_SENHA
else:
    MC_USUARIO = os.environ.get("MC_USUARIO", "").strip()
    MC_SENHA = os.environ.get("MC_SENHA", "")

APLICAR = os.environ.get("APLICAR", "").strip().lower() in ("1", "true", "sim")

# 08/10/26 — CÓDIGO DE AUTENTICAÇÃO POR E-MAIL. Desde 05/10 (troca para a conta
# moraisengdev@gmail.com) o MC manda TODO login de aparelho novo para a tela
# #/mfa e envia "O seu código de autenticação chegou" para o e-mail da conta —
# mesmo com a autenticação de dois fatores DESATIVADA nas configurações. O robô
# abre um navegador limpo a cada rodada, então para o MC é sempre aparelho
# novo. Solução: ler o código no Gmail da conta por IMAP (senha de app).
#   MC_EMAIL_SENHA_APP  senha de app do Google (16 letras) — secret
#   MC_EMAIL_USUARIO    opcional; sem ele, usa o próprio usuário do MC
MC_EMAIL_USUARIO = os.environ.get("MC_EMAIL_USUARIO", "").strip()
MC_EMAIL_SENHA_APP = os.environ.get("MC_EMAIL_SENHA_APP", "").replace(" ", "").strip()
REMETENTE_CODIGO = "nao-responda@maiscontroleerp.com.br"
_codigos_usados = set()
DESCOBRIR = os.environ.get("DESCOBRIR", "").strip().lower() in ("1", "true", "sim")

SAIDA = Path("mc_evidencias")
SAIDA.mkdir(exist_ok=True)
_seq = [0]


def N(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def so_digitos(s):
    return "".join(c for c in str(s or "") if c.isdigit())


def foto(page, nome, sensivel=False):
    """Print + HTML da tela. Tela com dado de cliente só com DESCOBRIR=1."""
    if sensivel and not DESCOBRIR:
        return
    _seq[0] += 1
    base = SAIDA / f"{_seq[0]:03d}_{nome}"
    try:
        page.screenshot(path=f"{base}.png", full_page=True)
    except Exception:
        pass
    if DESCOBRIR:
        try:
            Path(f"{base}.html").write_text(page.content(), encoding="utf-8")
        except Exception:
            pass


def esperar(page, ms=15000):
    try:
        page.wait_for_load_state("networkidle", timeout=ms)
    except PWTimeout:
        pass


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")


def abrir(p):
    # Navegador com cara de navegador comum: sem isto o Chromium do robô se
    # identifica como "HeadlessChrome", e há sistemas que recusam o login calados.
    b = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="pt-BR",
                        timezone_id="America/Sao_Paulo", user_agent=UA)
    ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
    page = ctx.new_page()
    page.set_default_timeout(20000)
    # registro de rede do login: o que o ENTRAR chamou e o que voltou
    page._rede = []
    def _resp(r):
        try:
            if r.request.resource_type in ("xhr", "fetch", "document"):
                page._rede.append(f"{r.request.method} {r.status} {r.url.split('?')[0][:110]}")
        except Exception:
            pass
    def _falhou(rq):
        try:
            page._rede.append(f"FALHOU {rq.method} {rq.url.split('?')[0][:110]} — {rq.failure}")
        except Exception:
            pass
    page.on("response", _resp)
    page.on("requestfailed", _falhou)
    page.on("console", lambda m: page._rede.append(f"console.{m.type}: {m.text[:150]}") if m.type in ("error", "warning") else None)
    return b, page


def _fill(loc, valor):
    """Digita como gente: o login do MC é AngularJS (ng-model) e só aceita o
    valor quando recebe os eventos de teclado/input."""
    loc.click()
    loc.fill("")
    loc.press_sequentially(valor, delay=25)
    loc.dispatch_event("input")
    loc.dispatch_event("change")
    loc.dispatch_event("blur")


_JS_MSG_ERRO = """
() => {
  const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const sel = "[class*=error i],[class*=erro i],[class*=alert i],[class*=toast i],[class*=invalid i],[class*=message i],[role=alert]";
  const t = [...document.querySelectorAll(sel)].filter(vis).map(e => e.innerText.trim()).filter(Boolean);
  return [...new Set(t)].join(" | ").slice(0, 400);
}
"""


_JS_DIAG = """
() => {
  const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const inp = [...document.querySelectorAll("input")].filter(vis).map(i =>
    `${i.type}#${i.id||"-"} name=${i.name||"-"} ph="${i.placeholder||""}" valor=${(i.value||"").length}ch`);
  const bts = [...document.querySelectorAll("button, input[type=submit], a.btn, [role=button]")].filter(vis).map(b =>
    `"${(b.innerText||b.value||"").trim().slice(0,30)}" type=${b.type||"-"}${b.disabled?" DESABILITADO":""}`);
  const frames = [...document.querySelectorAll("iframe")].map(f => f.src.slice(0,80));
  return { titulo: document.title, hash: location.hash, inputs: inp, botoes: bts, iframes: frames,
           captcha: !!document.querySelector("[class*=captcha i], iframe[src*=captcha i], iframe[src*=recaptcha i]") };
}
"""


def diagnostico(page, rotulo):
    """Imprime no LOG o que está visível na tela (sem valores digitados)."""
    try:
        d = page.evaluate(_JS_DIAG)
        print(f"--- DIAGNÓSTICO ({rotulo}) ---", flush=True)
        print(f"  título: {d['titulo']} | rota: {d['hash']} | captcha: {d['captcha']}", flush=True)
        for x in d["inputs"]:
            print(f"  campo: {x}", flush=True)
        for x in d["botoes"]:
            print(f"  botão: {x}", flush=True)
        for x in d["iframes"]:
            print(f"  iframe: {x}", flush=True)
    except Exception as e:
        print(f"  (diagnóstico falhou: {e})", flush=True)


# ---------------------------------------------------------------------------
# Código de autenticação (tela #/mfa) — lido no Gmail da conta
# ---------------------------------------------------------------------------

def extrair_codigo(texto):
    """Código do e-mail "O seu código de autenticação chegou". O corpo é HTML:
    tira as tags e pega o primeiro número de 6 dígitos (4 a 8 como recuo)
    DEPOIS de "código abaixo" — evita pegar CNPJ/telefone do rodapé."""
    t = re.sub(r"(?is)<(style|script)[^>]*>.*?</\1>", " ", str(texto or ""))
    t = re.sub(r"<[^>]+>", " ", t)
    t = N(_html.unescape(t))
    i = t.find("CODIGO ABAIXO")
    trecho = t[i:] if i >= 0 else t
    for padrao in (r"(?<![\d.,/-])(\d{6})(?![\d.,/-])", r"(?<![\d.,/-])(\d{4,8})(?![\d.,/-])"):
        m = re.search(padrao, trecho)
        if m:
            return m.group(1)
    # código com espaço entre os dígitos ("5 9 6 1 6 4")
    m = re.search(r"(?<!\d)((?:\d ){5}\d)(?!\d)", trecho)
    return m.group(1).replace(" ", "") if m else None


def _corpo_do_email(bruto):
    msg = email.message_from_bytes(bruto)
    partes = []
    for parte in (msg.walk() if msg.is_multipart() else [msg]):
        if parte.get_content_type() in ("text/html", "text/plain"):
            try:
                carga = parte.get_payload(decode=True) or b""
                partes.append(carga.decode(parte.get_content_charset() or "utf-8", "replace"))
            except Exception:
                pass
    return "\n".join(partes)


def _data_imap(epoch):
    meses = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    t = time.gmtime(epoch)
    return f"{t.tm_mday:02d}-{meses[t.tm_mon - 1]}-{t.tm_year}"


def codigo_do_email(desde, limite_s=180):
    """Espera o e-mail de código que chegou DEPOIS de `desde` (epoch) e devolve
    o código. Só leitura (BODY.PEEK): não marca nada como lido."""
    usuario = MC_EMAIL_USUARIO or (MC_USUARIO if MC_USUARIO.lower().endswith("@gmail.com") else "")
    if not (usuario and MC_EMAIL_SENHA_APP):
        raise SystemExit("O Mais Controle pediu o CÓDIGO DE AUTENTICAÇÃO (tela #/mfa), mas falta o secret "
                         "MC_EMAIL_SENHA_APP (senha de app do Gmail da conta do robô) — sem ele não dá para "
                         "ler o código. Veja o cabeçalho do robo_mc_comum.py.")
    fim = time.time() + limite_s
    tentativa = 0
    while time.time() < fim:
        tentativa += 1
        try:
            M = imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=30)
            try:
                M.login(usuario, MC_EMAIL_SENHA_APP)
            except imaplib.IMAP4.error as e:
                raise SystemExit(f"Gmail recusou a senha de app de {usuario}: {e} — confira o secret MC_EMAIL_SENHA_APP "
                                 "(precisa da verificação em duas etapas do Google ligada e do IMAP habilitado).")
            try:
                M.select("INBOX", readonly=True)
                _, d = M.search(None, f'(FROM "{REMETENTE_CODIGO}" SINCE {_data_imap(desde - 86400)})')
                ids = (d[0] or b"").split()[-15:]
                for num in reversed(ids):                     # mais novo primeiro
                    _, dados = M.fetch(num, "(INTERNALDATE BODY.PEEK[])")
                    cab = next((x for x in dados if isinstance(x, tuple)), None)
                    if not cab:
                        continue
                    quando = time.mktime(imaplib.Internaldate2tuple(cab[0]) or time.localtime(0))
                    if quando < desde - 20:
                        break                                 # daqui para trás é tudo antigo
                    cod = extrair_codigo(_corpo_do_email(cab[1]))
                    if cod and cod not in _codigos_usados:
                        _codigos_usados.add(cod)
                        print(f"MC: código de autenticação lido no e-mail ({len(cod)} dígitos, tentativa {tentativa})", flush=True)
                        return cod
            finally:
                try:
                    M.logout()
                except Exception:
                    pass
        except SystemExit:
            raise
        except Exception as e:
            print(f"  ! leitura do Gmail falhou ({str(e)[:120]}) — tento de novo", flush=True)
        time.sleep(6)
    raise SystemExit(f"O código de autenticação do Mais Controle não chegou ao Gmail em {limite_s}s.")


_SEL_CAMPO_CODIGO = ("input:visible:not([type=checkbox]):not([type=radio]):not([type=hidden])"
                     ":not([type=password]):not([type=email])")


def passar_mfa(page, desde):
    """Tela #/mfa: (se pedir) escolhe e-mail, lê o código no Gmail, digita e confirma."""
    foto(page, "mfa")
    diagnostico(page, "tela de código de autenticação (#/mfa)")
    campos = page.locator(_SEL_CAMPO_CODIGO)
    if not campos.count():
        # tela de escolha do canal antes do código: e-mail, depois enviar
        try:
            page.get_by_text(re.compile(r"e-?mail", re.I)).first.click(timeout=4000)
            page.wait_for_timeout(800)
            bt = page.locator("button:visible").filter(has_text=re.compile(r"enviar|continuar|receber", re.I))
            if bt.count():
                bt.first.click()
            esperar(page, 10000)
            page.wait_for_timeout(1500)
            diagnostico(page, "depois de escolher e-mail")
        except Exception as e:
            print(f"  ! não achei campo de código nem opção de e-mail ({str(e)[:80]})", flush=True)
        campos = page.locator(_SEL_CAMPO_CODIGO)

    codigo = codigo_do_email(desde)
    n = campos.count()
    caixas = 0
    for i in range(n):
        try:
            if (campos.nth(i).get_attribute("maxlength") or "") == "1":
                caixas += 1
        except Exception:
            pass
    if caixas >= 4:                     # uma caixinha por dígito
        for i, dig in enumerate(codigo[:caixas]):
            campos.nth(i).click()
            campos.nth(i).press_sequentially(dig, delay=40)
    elif n:
        _fill(campos.first, codigo)
    else:
        page.keyboard.type(codigo, delay=40)

    # "lembrar/confiar neste dispositivo", se existir
    try:
        lembrar = page.get_by_label(re.compile(r"lembr|confi|dispositivo", re.I))
        if lembrar.count():
            lembrar.first.check(timeout=2000)
    except Exception:
        pass

    bt = page.locator("button:visible, input[type=submit]:visible").filter(
        has_text=re.compile(r"validar|confirmar|autenticar|verificar|continuar|entrar|acessar|enviar", re.I)
    ).filter(has_not_text=re.compile(r"reenviar|voltar|cancelar", re.I))
    page.wait_for_timeout(500)
    if "/mfa" in page.url:              # há telas que já enviam ao completar os dígitos
        if bt.count():
            print(f"MC: confirmando o código (botão \"{(bt.first.inner_text() or '').strip()[:30]}\")", flush=True)
            bt.first.click()
        else:
            page.keyboard.press("Enter")
    try:
        page.wait_for_function("() => !location.hash.includes('/mfa')", timeout=40000)
    except PWTimeout:
        diagnostico(page, "código digitado, mas continua na tela #/mfa")
        msg = ""
        try:
            msg = page.evaluate(_JS_MSG_ERRO)
        except Exception:
            pass
        foto(page, "mfa_falhou")
        raise SystemExit(f"Mais Controle não aceitou o código de autenticação. Mensagem na tela: {msg or '(nenhuma)'}")
    esperar(page, 20000)
    page.wait_for_timeout(1500)


def login(page):
    if not (MC_URL and MC_USUARIO and MC_SENHA):
        raise SystemExit("Faltam os secrets MC_URL, MC_USUARIO e/ou MC_SENHA.")
    page.goto(MC_URL, wait_until="domcontentloaded")
    esperar(page)
    page.wait_for_timeout(1500)
    foto(page, "login")
    # Só campos VISÍVEIS: a tela de login do MC tem, escondido, o formulário de
    # "esqueci a senha" com outro campo de e-mail (#fgtemail).
    usuario = page.locator(
        "input[type=email]:visible, input[name*=mail i]:visible, input[name*=user i]:visible, "
        "input[name*=login i]:visible, input[type=text]:visible").first
    _fill(usuario, MC_USUARIO)
    senha = page.locator("input[type=password]:visible").first
    _fill(senha, MC_SENHA)
    foto(page, "login_preenchido")
    diagnostico(page, "login preenchido, antes de clicar")
    # botão de entrar: primeiro pelo texto, depois qualquer submit visível
    bt = page.locator("button:visible, input[type=submit]:visible").filter(
        has_text=__import__("re").compile(r"entrar|acessar|login|logar", __import__("re").I))
    if not bt.count():
        bt = page.locator("button[type=submit]:visible, input[type=submit]:visible")
    page._rede.clear()
    desde = time.time() - 5          # o e-mail de código chega depois disto
    if bt.count():
        print(f"MC: clicando no botão \"{(bt.first.inner_text() or '').strip()[:30]}\"", flush=True)
        bt.first.click()
    else:
        print("MC: nenhum botão de entrar visível — usando Enter", flush=True)
        senha.press("Enter")
    # espera a tela de senha sumir (o MC troca de rota sem recarregar a página)
    try:
        page.wait_for_selector("input[type=password]:visible", state="hidden", timeout=30000)
    except PWTimeout:
        senha.press("Enter")          # segunda tentativa: alguns formulários só respondem ao Enter
        try:
            page.wait_for_selector("input[type=password]:visible", state="hidden", timeout=15000)
        except PWTimeout:
            pass
    esperar(page, 20000)
    page.wait_for_timeout(1500)
    foto(page, "pos_login")
    pw = page.locator("input[type=password]:visible")
    if pw.count():
        diagnostico(page, "depois de clicar em entrar")
        print("--- REDE depois do ENTRAR ---", flush=True)
        for x in (page._rede or ["(nenhuma chamada — o botão não disparou nada)"])[:40]:
            print("  " + x, flush=True)
        msg = ""
        try:
            msg = page.evaluate(_JS_MSG_ERRO)
        except Exception:
            pass
        raise SystemExit("Login no Mais Controle falhou — a tela de senha continua aberta. "
                         f"Mensagem na tela: {msg or '(nenhuma)'} — veja o DIAGNÓSTICO acima e mc_evidencias.")
    # 08/10/26 — antes o robô dava "login ok" PARADO na tela #/mfa e todo o
    # resto falhava por não achar menu/campo. Agora passa pelo código.
    if "/mfa" in page.url:
        print("MC: o sistema pediu código de autenticação (#/mfa) — buscando no e-mail", flush=True)
        passar_mfa(page, desde)
        if "/mfa" in page.url or "/login" in page.url:
            raise SystemExit(f"Login no Mais Controle não passou da autenticação ({page.url}).")
    print(f"MC: login ok ({page.url})", flush=True)


def ir_menu(page, grupo, item):
    """Menu lateral do MC: o grupo abre um submenu ao passar o mouse/clicar."""
    g = page.get_by_text(grupo, exact=True).first
    g.hover()
    page.wait_for_timeout(600)
    alvo = page.get_by_text(item, exact=True)
    try:
        alvo.first.click(timeout=4000)
    except Exception:
        g.click()
        page.wait_for_timeout(600)
        alvo.first.click()
    esperar(page)
    page.wait_for_timeout(1000)


def clicar_texto(page, texto, exato=True, timeout=8000):
    loc = page.get_by_text(texto, exact=exato).first
    loc.wait_for(state="visible", timeout=timeout)
    loc.click()
    page.wait_for_timeout(500)


def input_por_rotulo(page, rotulo):
    """Primeiro <input> depois do texto do rótulo (tolera '*' e ':' no rótulo)."""
    return page.locator(
        "xpath=(//*[normalize-space(translate(text(),'*:',''))='%s']/following::input[1])[1]" % rotulo)


# Valor de um campo pelo rótulo, direto no DOM: acha o texto do rótulo e sobe
# até achar um <input> no mesmo bloco. Tenta os rótulos na ordem dada.
_JS_VALOR = """
(rotulos) => {
  const n = s => (s||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toUpperCase().replace(/[:*]/g,"").trim();
  for (const r of rotulos) {
    const alvo = n(r);
    const els = [...document.querySelectorAll("label,span,div,p,b,strong")]
      .filter(e => e.children.length === 0 && n(e.textContent) === alvo);
    for (const e of els) {
      let c = e.parentElement;
      for (let k = 0; k < 4 && c; k++, c = c.parentElement) {
        const i = c.querySelector("input:not([type=radio]):not([type=checkbox]):not([type=hidden])");
        if (i) return i.value;
      }
    }
  }
  return null;
}
"""


def valor_por_rotulo(page, rotulos):
    try:
        return page.evaluate(_JS_VALOR, rotulos)
    except Exception:
        return None


_JS_RADIO = """
() => { const r = [...document.querySelectorAll("input[type=radio]:checked")];
  return r.map(x => (x.closest("label") || x.parentElement || {}).textContent || x.value).join(" | "); }
"""


def radios_marcados(page):
    try:
        return page.evaluate(_JS_RADIO) or ""
    except Exception:
        return ""


# Tabela da tela (cabeçalho + linhas), lida inteira de uma vez.
_JS_TABELA = """
() => {
  const t = [...document.querySelectorAll("table")].find(x => x.querySelector("tbody tr"));
  if (!t) return null;
  const cab = [...t.querySelectorAll("thead th")].map(th => th.textContent.trim());
  const linhas = [...t.querySelectorAll("tbody tr")].map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent.trim()));
  return { cab, linhas };
}
"""


def ler_tabela(page):
    try:
        return page.evaluate(_JS_TABELA)
    except Exception:
        return None


# Troca o "Exibir N por página" para o maior número disponível.
_JS_MAIOR_PAGINA = """
() => {
  for (const s of document.querySelectorAll("select")) {
    const nums = [...s.options].map(o => Number(o.value || o.textContent)).filter(x => !isNaN(x) && x > 0);
    if (nums.length >= 2) {
      const max = Math.max(...nums);
      const o = [...s.options].find(o => Number(o.value || o.textContent) === max);
      s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));
      return max;
    }
  }
  return null;
}
"""


def maior_pagina(page):
    try:
        r = page.evaluate(_JS_MAIOR_PAGINA)
        esperar(page)
        page.wait_for_timeout(1500)
        return r
    except Exception:
        return None


def proxima_pagina(page):
    """Clica em 'próxima' da paginação. False se não houver/desabilitado."""
    for sel in ["a[aria-label*=Next i]", "a[aria-label*=Próx i]", "li.next:not(.disabled) a",
                "button[aria-label*=next i]", "text=»", "text=›"]:
        loc = page.locator(sel)
        if loc.count():
            el = loc.last
            cls = (el.get_attribute("class") or "") + " " + ((el.locator("xpath=..").get_attribute("class")) or "")
            if "disabled" in cls or el.is_disabled():
                return False
            el.click()
            esperar(page)
            page.wait_for_timeout(1200)
            return True
    return False
