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
COND = "00112233445566778899aabbccddeeff"
HTML = """<!doctype html><html><head><meta charset="utf-8"><style>/*CSS_DO_VENDAS*/</style></head><body>
<div class="pbody" id="pn-body" style="width:560px"></div>
<div id="cd-card"></div>
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
    var p = JSON.parse(opt.body); window.pedidos.push(p.action); (window.pedidosId = window.pedidosId || []).push(p.action + ":" + p.pageId);
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
    vendas = (RAIZ / "vendas.html").read_text(encoding="utf-8")
    css = vendas[vendas.index("<style>") + 7:vendas.index("</style>")]   # o CSS do painel de verdade
    html = HTML.replace('src="venda-dossie.js"', 'src="_fumaca-dossie.js"').replace("/*CSS_DO_VENDAS*/", css)
    (RAIZ / "_fumaca.html").write_text(html, encoding="utf-8")
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            pg = b.new_page()
            pg.on("pageerror", lambda e: erros.append(str(e)))
            pg.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.abort())
            pg.goto((RAIZ / "_fumaca.html").as_uri())
            # o venda-dossie.js só chama o PORTAL-VENDA se a URL for de script.google.com
            pg.evaluate("""() => {}""")
            # uma seção "de verdade" do painel (como o vendas.html desenha ENDEREÇO / DISTRATO)
            pg.evaluate("(id) => { OBRA_ABERTA = id; var b = document.getElementById('pn-body');"
                        " b.insertAdjacentHTML('beforeend', '<div class=\"grp\" id=\"grp-ref\">Distrato</div>"
                        "<div class=\"campo\"><label id=\"campo-ref\">Endereço</label><input></div>'); }", PAGINA)
            pg.wait_for_timeout(1500)
            texto = pg.inner_text("#pn-body")

            def conf(cond, msg):
                (falhas if not cond else []).append(msg)
                print(("ok   " if cond else "FALHA ") + msg)
            conf("CONTRATO" in texto.upper(), "bloco Contrato aparece")
            conf("ASSINATURA" in texto.upper(), "bloco Assinatura aparece (assinatura-ui.js carregou)")
            conf("MAIS CONTROLE" in texto.upper(), "bloco Mais Controle aparece")
            ultimo = pg.evaluate("() => document.getElementById('pn-body').lastElementChild.id")
            conf(ultimo == "contrato-wrap", "contrato-wrap continua o último filho do painel")
            env = pg.locator('[data-acao="a-enviar"]')
            conf(env.count() == 1 and env.is_enabled(), "Enviar para assinatura habilitado com contrato gerado")
            env.click(); pg.wait_for_timeout(500)
            conf("assinaturaEnviar" in pg.evaluate("() => window.pedidos"), "clique chama assinaturaEnviar")
            conf("Enviado" in pg.inner_text("#contrato-wrap .vb-ass"), "situação ENVIADO aparece")
            prev = pg.locator('[data-acao="mc-previa"]')
            conf(prev.count() == 1 and prev.is_enabled(), "Ver prévia habilitado")
            conf(pg.locator('[data-acao="mc-lancar"]').is_disabled(), "Lançar travado sem PRÉVIA OK")
            pg.evaluate("() => { window.respostas.mcEstado = { ok: true, situacao: 'PRÉVIA OK [#0a1b2c3d] — cliente já existe', vendaId: '' }; }")
            prev.click(); pg.wait_for_timeout(500)
            conf("mcLancar" in pg.evaluate("() => window.pedidos"), "clique chama mcLancar")
            conf(pg.locator('[data-acao="mc-lancar"]').is_enabled(), "com PRÉVIA OK o Lançar libera")
            # alinhamento: título e conteúdo dos blocos na mesma margem das seções do painel
            ref = pg.evaluate("() => ({ grp: document.getElementById('grp-ref').getBoundingClientRect().left,"
                              " campo: document.getElementById('campo-ref').getBoundingClientRect().left,"
                              " grpDir: document.getElementById('grp-ref').getBoundingClientRect().right })")
            for bloco in ("#dossie-wrap", "#contrato-wrap", "#pn-body .vb-ass", "#pn-body .vb-mc"):
                m = pg.evaluate("(sel) => { var w = document.querySelector(sel), g = w.querySelector(':scope > .grp'),"
                                " c = w.querySelector(':scope > .dz-linha, :scope > .dz-aviso, :scope > ul');"
                                " var cs = g && getComputedStyle(g);"
                                " return { grp: g && g.getBoundingClientRect().left, grpDir: g && g.getBoundingClientRect().right,"
                                " linha: cs && cs.borderBottomStyle + ' ' + cs.borderBottomWidth,"
                                " cont: c && c.getBoundingClientRect().left }; }", bloco)
                conf(m["grp"] == ref["grp"] and m["grpDir"] == ref["grpDir"], bloco + ": título na mesma margem das outras seções (%s × %s)" % (m["grp"], ref["grp"]))
                conf(m["linha"] == "solid 2px", bloco + ": título sublinhado como as outras seções")
                conf(m["cont"] == ref["campo"], bloco + ": conteúdo começa na margem do .campo (%s × %s)" % (m["cont"], ref["campo"]))
            # Mais Controle criada: tópicos e link
            pg.evaluate("() => { window.respostas.mcEstado = { ok: true, situacao: 'CRIADA | venda v-9\\nCliente: COMPRADOR EXEMPLO (já existia)\\nTotal: R$ 1,00', vendaId: 'v-9' }; }")
            pg.locator('[data-acao="mc-atualizar"]').click(); pg.wait_for_timeout(400)
            conf(pg.locator("#pn-body .vb-mc ul.mc-topicos li").count() == 2, "Mais Controle: situação em tópicos")
            link = pg.locator("#pn-body .vb-mc a.mc-abrir")
            conf(link.count() == 1 and link.get_attribute("target") == "_blank"
                 and link.get_attribute("href").endswith("/#/readjustment-sale/edit/v-9"), "Mais Controle: link Abrir no Mais Controle em nova aba")
            # Assinatura: lista e Reenviar link
            pg.evaluate("() => { window.respostas.assinaturaEstado = { ok: true, situacao: 'ENVIADO', envelope: true, signatarios: ["
                        "{ papel: 'Comprador 1', nome: 'Maria S.', assinou: true, situacao: 'assinou', data: '2026-10-07T10:20:00Z' },"
                        "{ papel: 'Testemunha 1', nome: 'Ana C.', assinou: false, situacao: 'pendente', data: '' }] };"
                        " window.respostas.assinaturaReenviar = { ok: true, situacao: 'ENVIADO', pendentes: 1 }; }")
            pg.locator('[data-acao="a-atualizar"]').click(); pg.wait_for_timeout(400)
            conf("✓ assinou" in pg.inner_text("#pn-body .vb-ass") and "pendente" in pg.inner_text("#pn-body .vb-ass"), "Assinatura: lista com assinou (marca de certo) e pendente")
            pg.locator('[data-acao="a-reenviar"]').click(); pg.wait_for_timeout(400)
            conf("assinaturaReenviar" in pg.evaluate("() => window.pedidos"), "Reenviar link chama assinaturaReenviar")
            conf("Link reenviado" in pg.inner_text("#pn-body .vb-ass"), "Reenviar link mostra a confirmação")
            import os
            if os.environ.get("FUMACA_PRINT"):
                pg.screenshot(path=os.environ["FUMACA_PRINT"], full_page=True)
            # entrega 7: o cartão do condomínio monta os mesmos blocos para a linha do condomínio
            desenhar = """(id) => { var c = document.getElementById('cd-card');
                c.innerHTML = '<div class="cd-cardbox"><h3>Unidade 13</h3><div id="cd-venda"></div></div>';
                VendaBlocos.montar(document.getElementById('cd-venda'), id); }"""
            pg.evaluate(desenhar, COND)
            pg.wait_for_timeout(800)
            cartao = pg.inner_text("#cd-card").upper()   # o CSS do vendas.html põe os títulos em maiúsculas
            conf("CONTRATO" in cartao and "ASSINATURA" in cartao and "MAIS CONTROLE" in cartao, "cartão do condomínio mostra Contrato, Assinatura e Mais Controle")
            ped = pg.evaluate("() => window.pedidosId")
            conf(all(("%s:%s" % (a, COND)) in ped for a in ("contratoEstado", "mcEstado", "assinaturaEstado")), "os três estados pedidos para a linha do condomínio")
            antes = len(pg.evaluate("() => window.pedidosId"))
            pg.evaluate(desenhar, COND)   # o cartão se redesenha a cada gravação: não pede de novo
            pg.wait_for_timeout(500)
            conf(len(pg.evaluate("() => window.pedidosId")) == antes, "redesenhar o cartão não repete os pedidos")
            pg.locator('#cd-card [data-acao="c-gerar"]').first.click(); pg.wait_for_timeout(500)
            conf(("gerarContrato:%s" % COND) in pg.evaluate("() => window.pedidosId"), "Gerar de novo no cartão chama gerarContrato com o id da linha")
            conf(pg.locator('#contrato-wrap').count() == 1, "o painel da casa segue com um bloco só")
            pg.evaluate("() => { VendaBlocos.soltar(); document.getElementById('cd-card').innerHTML = ''; }")
            b.close()
    finally:
        (RAIZ / "_fumaca.html").unlink(missing_ok=True)
        (RAIZ / "_fumaca-dossie.js").unlink(missing_ok=True)
    for e in erros:
        print("ERRO JS:", e)
    return 1 if (falhas or erros) else 0


if __name__ == "__main__":
    sys.exit(main())
