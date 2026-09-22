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

SECRETS: MC_URL (endereço da tela de login), MC_USUARIO, MC_SENHA, NOTION_TOKEN.

Os seletores são por TEXTO visível (os rótulos que aparecem na tela:
"Contatos", "Clientes", "Nova Obra", "Nome da obra"…), não por classe CSS —
é o que menos quebra quando o MC muda o visual.
"""

import os
import unicodedata
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout

MC_URL = os.environ.get("MC_URL", "").strip()
MC_USUARIO = os.environ.get("MC_USUARIO", "").strip()
MC_SENHA = os.environ.get("MC_SENHA", "")
APLICAR = os.environ.get("APLICAR", "").strip().lower() in ("1", "true", "sim")
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


def abrir(p):
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="pt-BR")
    page = ctx.new_page()
    page.set_default_timeout(20000)
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
        msg = ""
        try:
            msg = page.evaluate(_JS_MSG_ERRO)
        except Exception:
            pass
        raise SystemExit("Login no Mais Controle falhou — a tela de senha continua aberta. "
                         f"Mensagem na tela: {msg or '(nenhuma)'} — veja o DIAGNÓSTICO acima e mc_evidencias.")
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
