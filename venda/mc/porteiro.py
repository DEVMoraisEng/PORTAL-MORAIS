# -*- coding: utf-8 -*-
"""Mais Controle pela aba do Chrome do PORTEIRO (servidor do escritório) — sem login nenhum.

Regra do dono (14/10/2026): o ERP é acessado SEMPRE pelo Chrome do app. No servidor, o porteiro
(`python -m erp.porteiro`, no app) mantém um Chrome logado com o usuário do robô e com o aparelho
já confiável. Aqui só se abre uma ABA nova nesse Chrome (CDP em 127.0.0.1), copia-se a autenticação
do tráfego da própria tela e faz-se `fetch` de dentro da página. O ERP aceita uma sessão por usuário:
quem derruba é o LOGIN, não a aba — por isso nada aqui loga.

Liga com MC_VIA=porteiro (o robô do servidor põe sozinho). Porta: MC_PORTEIRO_PORTA (padrão 9230,
a do acesso "principal" do acessos.json do porteiro).
"""
from __future__ import annotations

import json
import os
import time

URL_CAPTURA = "https://acessar.maiscontroleerp.com.br/#/payable-installments"
HOST_LEGACY = "legacy-api.maiscontroleerp.com.br"
HOST_CORE = "prod-erp-api.maiscontroleerp.com.br"
CHAVES = ("authorization", "company-id", "user-id", "organization-unit-id")

# fetch de dentro da página: devolve status e texto (o corpo da recusa diz o campo que falta)
_JS_FETCH = """async ([metodo, url, cab, corpo]) => {
  const op = {method: metodo, headers: cab};   // igual ao erp/pagina.py do app (provado em produção)
  if (corpo !== null) { op.body = corpo; op.headers = Object.assign({"content-type": "application/json"}, cab); }
  const r = await fetch(url, op);
  return {status: r.status, texto: await r.text()};
}"""


class PorteiroErro(Exception):
    pass


def _host(url: str) -> str:
    u = url.split("://", 1)[-1]
    return u.split("/", 1)[0].split("?", 1)[0].lower()


class AbaPorteiro:
    """Uma aba no Chrome do porteiro. `cabecalhos(host)` = autenticação capturada; `fetch` = pedido pela página."""

    def __init__(self, page, fechar=None):
        self._page = page
        self._fechar = fechar
        self._cab: dict[str, dict] = {}
        page.on("request", self._ouvir)

    @classmethod
    def abrir(cls, porta: int | None = None, espera: float = 90.0) -> "AbaPorteiro":
        from playwright.sync_api import sync_playwright   # só no servidor
        porta = int(porta or os.environ.get("MC_PORTEIRO_PORTA") or 9230)
        pw = sync_playwright().start()
        try:
            nav = pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % porta, timeout=15000)
        except Exception as e:
            pw.stop()
            raise PorteiroErro("o Chrome do porteiro não responde na porta %d (%s) — o porteiro está ligado?"
                               % (porta, type(e).__name__)) from None
        ctx = nav.contexts[0] if nav.contexts else nav.new_context()
        page = ctx.new_page()

        def fechar():
            try:
                page.close()
            finally:
                pw.stop()          # só desconecta: o Chrome do porteiro continua aberto
        aba = cls(page, fechar)
        try:
            aba.capturar(espera)
        except Exception:
            aba.fechar()
            raise
        return aba

    def _ouvir(self, req) -> None:
        try:
            host = _host(req.url)
            if host not in (HOST_LEGACY, HOST_CORE):
                return
            cab = {k.lower(): v for k, v in (req.headers or {}).items() if k.lower() in CHAVES and v}
        except Exception:
            return                     # ouvinte nunca derruba a aba
        if "authorization" in cab:
            self._cab[host] = cab

    def capturar(self, espera: float = 90.0) -> None:
        """Abre a tela e espera ela chamar os dois back-ends (é dali que sai a autenticação)."""
        self._cab.clear()
        self._page.goto(URL_CAPTURA, wait_until="domcontentloaded")
        limite = time.monotonic() + espera
        while time.monotonic() < limite:
            if HOST_LEGACY in self._cab and HOST_CORE in self._cab:
                return
            if "#/login" in (self._page.url or "") or "#/mfa" in (self._page.url or ""):
                break
            self._page.wait_for_timeout(250)
        raise PorteiroErro("o Chrome do porteiro não está logado no Mais Controle — o porteiro precisa entrar "
                           "(python -m erp.porteiro estado, no servidor)")

    def cabecalhos(self, host: str) -> dict:
        return dict(self._cab.get(host) or {})

    def fetch(self, metodo: str, url: str, cabecalhos: dict, corpo=None) -> tuple[int, str]:
        r = self._page.evaluate(_JS_FETCH, [metodo.upper(), url, cabecalhos,
                                            None if corpo is None else json.dumps(corpo)])
        return int(r["status"]), str(r.get("texto") or "")

    def fechar(self) -> None:
        if self._fechar:
            f, self._fechar = self._fechar, None
            f()
