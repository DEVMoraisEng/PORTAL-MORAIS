# -*- coding: utf-8 -*-
"""Fumaça da tela num Chromium sem janela: o painel da casa com o venda-dossie.js
e o assinatura-ui.js de verdade, e o PORTAL-VENDA falso (fetch interceptado).
Não sai para a rede. Uso: python venda/testes/fumaca_tela.py"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

RAIZ = pathlib.Path(__file__).resolve().parents[2]
PAGINA = "0123456789abcdef0123456789abcdef"
HTML = """<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="pn-body"></div>
<script>
  var OBRA_ABERTA = null;
  function sessao() { return { token: "t", tipo: "GERAL" }; }
  window.pedidos = [];
  window.respostas = {
    estado: { ok: true, tipoCasa: "CASA DE RUA", arquivos: {}, dossie: "CONFERIDO", observacao: "", doisCompradores: false },
    contratoEstado: { ok: true, gerado: true, nome: "Contrato.pdf", url: "https://exemplo.invalid/c.pdf" },
    assinaturaEstado: { ok: true, situacao: "", envelope: false, signatarios: [] },
    assinaturaEnviar: { ok: true, situacao: "ENVIADO" },
    mcEstado: { ok: true, situacao: "", vendaId: "" },
    mcLancar: { ok: true, aplicar: false }
  };
  window.fetch = async function (url, opt) {
    var p = JSON.parse(opt.body); window.pedidos.push(p.action);
    var r = window.respostas[p.action] || { ok: false, erro: "ACAO_DESCONHECIDA" };
    return { json: async function () { return JSON.parse(JSON.stringify(r)); } };
  };
  window.confirm = function () { return true; };
</script>
<script src="venda-dossie.js"></script>
</body></html>"""


def main() -> int:
    erros, falhas = [], []
    js = (RAIZ / "venda-dossie.js").read_text(encoding="utf-8")
    js = js.replace('var URL_PORTAL_VENDA = "', 'var URL_PORTAL_VENDA = "https://script.google.com/macros/s/FALSO/exec', 1)
    (RAIZ / "_fumaca-dossie.js").write_text(js, encoding="utf-8")
    (RAIZ / "_fumaca.html").write_text(HTML.replace('src="venda-dossie.js"', 'src="_fumaca-dossie.js"'), encoding="utf-8")
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            pg = b.new_page()
            pg.on("pageerror", lambda e: erros.append(str(e)))
            pg.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.abort())
            pg.goto((RAIZ / "_fumaca.html").as_uri())
            # o venda-dossie.js só chama o PORTAL-VENDA se a URL for de script.google.com
            pg.evaluate("""() => {}""")
            pg.evaluate("(id) => { OBRA_ABERTA = id; var d = document.createElement('div'); d.className='x'; d.textContent='painel'; document.getElementById('pn-body').appendChild(d); }", PAGINA)
            pg.wait_for_timeout(1500)
            texto = pg.inner_text("#pn-body")

            def conf(cond, msg):
                (falhas if not cond else []).append(msg)
                print(("ok   " if cond else "FALHA ") + msg)
            conf("Contrato" in texto, "bloco Contrato aparece")
            conf("Assinatura" in texto, "bloco Assinatura aparece (assinatura-ui.js carregou)")
            conf("Mais Controle" in texto, "bloco Mais Controle aparece")
            ultimo = pg.evaluate("() => document.getElementById('pn-body').lastElementChild.id")
            conf(ultimo == "contrato-wrap", "contrato-wrap continua o último filho do painel")
            env = pg.locator('[data-acao="a-enviar"]')
            conf(env.count() == 1 and env.is_enabled(), "Enviar para assinatura habilitado com contrato gerado")
            env.click(); pg.wait_for_timeout(500)
            conf("assinaturaEnviar" in pg.evaluate("() => window.pedidos"), "clique chama assinaturaEnviar")
            conf("Enviado" in pg.inner_text("#ass-wrap"), "situação ENVIADO aparece")
            prev = pg.locator('[data-acao="mc-previa"]')
            conf(prev.count() == 1 and prev.is_enabled(), "Ver prévia habilitado")
            conf(pg.locator('[data-acao="mc-lancar"]').is_disabled(), "Lançar travado sem PRÉVIA OK")
            pg.evaluate("() => { window.respostas.mcEstado = { ok: true, situacao: 'PRÉVIA OK [#0a1b2c3d] — cliente já existe', vendaId: '' }; }")
            prev.click(); pg.wait_for_timeout(500)
            conf("mcLancar" in pg.evaluate("() => window.pedidos"), "clique chama mcLancar")
            conf(pg.locator('[data-acao="mc-lancar"]').is_enabled(), "com PRÉVIA OK o Lançar libera")
            b.close()
    finally:
        (RAIZ / "_fumaca.html").unlink(missing_ok=True)
        (RAIZ / "_fumaca-dossie.js").unlink(missing_ok=True)
    for e in erros:
        print("ERRO JS:", e)
    return 1 if (falhas or erros) else 0


if __name__ == "__main__":
    sys.exit(main())
