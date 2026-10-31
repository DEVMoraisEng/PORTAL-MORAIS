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
    contratoEstado: { ok: true, gerado: true, etapa: "FINAL", pre: null, nome: "Contrato.pdf", url: "https://exemplo.invalid/c.pdf" },
    gerarPreContrato: { ok: true, nome: "PRÉ-CONTRATO - Unidade 13 [#0a1b2c3d].pdf", url: "https://exemplo.invalid/pre.pdf" },
    aprovarPreContrato: { ok: true, nome: "CONTRATO - Unidade 13 [#0a1b2c3d].pdf", url: "https://exemplo.invalid/c2.pdf" },
    assinaturaEstado: { ok: true, situacao: "", envelope: false, signatarios: [] },
    assinaturaEnviar: { ok: true, situacao: "ENVIADO" },
    mcEstado: { ok: true, situacao: "", vendaId: "" },
    mcLancar: { ok: true, aplicar: false },
    financeiroEstado: { ok: true, lancada: true, semLeitura: true, parcelas: [] },
    conferenciaEstado: { ok: true, feito: false, linhas: [], confirmados: {}, atual: false },
    preReservaEstado: { ok: true, gerado: false, nome: "", valor: 0, dataLimite: "" }
  };
  window.fetch = async function (url, opt) {
    var p = JSON.parse(opt.body); window.pedidos.push(p.action); (window.pedidosId = window.pedidosId || []).push(p.action + ":" + p.pageId);
    var r = window.respostas[p.action] || { ok: false, erro: "ACAO_DESCONHECIDA" };
    return { json: async function () { return JSON.parse(JSON.stringify(r)); } };
  };
  window.confirm = function () { return true; };
</script>
<script src="venda/Antecipacao.js"></script>
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
            # a linha do condomínio ainda sem envelope: o Enviar para assinatura depende do contrato FINAL
            pg.evaluate("() => { window.respostas.assinaturaEstado = { ok: true, situacao: '', envelope: false, signatarios: [] }; }")
            pg.evaluate(desenhar, COND)
            pg.wait_for_timeout(800)
            ass = pg.locator('#cd-card [data-acao="a-enviar"]')
            conf(ass.count() == 1 and ass.is_enabled(), "cartão: Enviar para assinatura habilitado com o contrato final")
            cartao = pg.inner_text("#cd-card").upper()   # o CSS do vendas.html põe os títulos em maiúsculas
            conf("CONTRATO" in cartao and "ASSINATURA" in cartao and "MAIS CONTROLE" in cartao, "cartão do condomínio mostra Contrato, Assinatura e Mais Controle")
            ped = pg.evaluate("() => window.pedidosId")
            conf(all(("%s:%s" % (a, COND)) in ped for a in ("contratoEstado", "mcEstado", "assinaturaEstado")), "os três estados pedidos para a linha do condomínio")
            antes = len(pg.evaluate("() => window.pedidosId"))
            pg.evaluate(desenhar, COND)   # o cartão se redesenha a cada gravação: não pede de novo
            pg.wait_for_timeout(500)
            conf(len(pg.evaluate("() => window.pedidosId")) == antes, "redesenhar o cartão não repete os pedidos")
            # entrega 9: "Gerar de novo" volta ao pré-contrato; o "Conferi" gera o final
            conf(pg.locator('#cd-card [data-acao="c-gerar"]').count() == 0, "cartão: não existe mais gerar o contrato direto")
            pg.locator('#cd-card [data-acao="c-pre"]').first.click(); pg.wait_for_timeout(500)
            conf(("gerarPreContrato:%s" % COND) in pg.evaluate("() => window.pedidosId"), "Gerar de novo no cartão chama gerarPreContrato com o id da linha")
            ver = pg.locator('#cd-card [data-acao="c-ver-pre"]')
            conf(ver.count() == 1 and pg.locator('#cd-card a[href*="exemplo.invalid"]').count() == 0,
                 "cartão: Visualizar pré-contrato é botão (PDF pelo portal), sem link do Drive")
            aprovar = pg.locator('#cd-card [data-acao="c-aprovar"]')
            conf(aprovar.count() == 1 and aprovar.is_enabled() and "Conferi, está tudo certo" in aprovar.inner_text(), "cartão: botão Conferi habilitado")
            conf(pg.locator('#cd-card [data-acao="c-pre"]').inner_text() == "Gerar pré-contrato de novo", "cartão: Gerar pré-contrato de novo")
            ass = pg.locator('#cd-card [data-acao="a-enviar"]')
            conf(ass.count() == 1 and ass.is_disabled(), "cartão: assinatura travada enquanto o pré-contrato não é conferido")
            aprovar.click(); pg.wait_for_timeout(500)
            conf(("aprovarPreContrato:%s" % COND) in pg.evaluate("() => window.pedidosId"), "Conferi chama aprovarPreContrato com o id da linha")
            conf("Contrato gerado" in pg.inner_text("#cd-card") and pg.locator('#cd-card [data-acao="c-ver"]').count() == 1, "cartão: depois do Conferi, contrato final com Visualizar")
            ass = pg.locator('#cd-card [data-acao="a-enviar"]')
            conf(ass.count() == 1 and ass.is_enabled(), "cartão: assinatura liberada com o contrato final")
            conf(not any(a.startswith("gerarContrato") for a in pg.evaluate("() => window.pedidosId")), "a tela nunca chama o gerarContrato antigo")
            conf(pg.locator('#contrato-wrap').count() == 1, "o painel da casa segue com um bloco só")
            pg.evaluate("() => { VendaBlocos.soltar(); document.getElementById('cd-card').innerHTML = ''; }")
            # 31/10: Antecipação de parcelas na aba Financeiro do cartão do condomínio, a 375 px (celular), sem janela e sem rede
            retrato = json.loads((RAIZ / "venda" / "testes" / "dados" / "antecipacao-retratos.json").read_text(encoding="utf-8"))["base"]
            hoje = pg.evaluate("() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())")
            pg.set_viewport_size({"width": 375, "height": 800})
            pg.evaluate("() => { document.getElementById('pn-body').style.display = 'none'; }")   # o painel de 560 px é só do cenário anterior
            pg.evaluate("""(r) => {
                window.respostas.mcEstado = { ok: true, situacao: 'LANÇADA', vendaId: 'venda-1' };
                window.respostas.antecipacaoEstado = { ok: true, pode: true, velho: false, processando: false, retrato: r, lido: '2026-10-21 10:00', temFiador: true };
                window.respostas.antecipacaoTexto = { ok: true, texto: 'Texto pronto para o WhatsApp' };
                window.abriu = [];
                window.open = function () { window.abriu.push('open'); return null; };   // a antecipação não abre janela nenhuma
                // área de transferência falsa: guarda o que foi copiado (modo 'ok') ou recusa (modo 'nega', como sem permissão)
                window.copiados = []; window.modoClip = 'ok';
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                    writeText: function (t) { if (window.modoClip !== 'ok') return Promise.reject(new Error('NotAllowedError')); window.copiados.push(t); return Promise.resolve(); } } });
            }""", retrato)
            pg.evaluate("""(id) => { var c = document.getElementById('cd-card');
                c.innerHTML = '<div class="cd-cardbox" data-aba="financeiro"><h3>Unidade 13</h3><div id="cd-venda"></div></div>';
                VendaBlocos.montar(document.getElementById('cd-venda'), id); VendaBlocos.aba('financeiro'); }""", COND)
            pg.wait_for_timeout(800)
            ab = pg.locator('#cd-card .vb-antec [data-acao="an-abrir"]')
            conf(ab.count() == 1 and ab.is_visible(), "Financeiro: botão Antecipar parcelas aparece com a venda lançada")
            conf(pg.locator('#cd-card .vb-fin').is_visible(), "Financeiro: a aba mostra o bloco das parcelas junto")
            conf(pg.locator('#cd-card .vb-mc').is_hidden(), "Financeiro: o bloco do Mais Controle fica na aba Contrato")
            largura = []

            def medir(rotulo):
                w = pg.evaluate("() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)")
                largura.append(w)
                conf(w <= 375, "375 px (%s): sem rolagem horizontal da página (scrollWidth %s)" % (rotulo, w))
            n0 = len(pg.evaluate("() => window.pedidos"))
            ab.click()
            pg.wait_for_selector('#cd-card [data-modo="B"]', timeout=5000)
            ped = pg.evaluate("() => window.pedidos")
            conf(ped.count("antecipacaoEstado") == 1 and len(ped) == n0 + 1, "Antecipar abre o painel com UMA chamada (antecipacaoEstado)")
            txt = pg.inner_text("#cd-card .vb-antec")
            conf("Com fiador: travas ligadas" in txt and "esticar prazo" in txt, "painel: travas ligadas e a nota do que não dá por aqui")
            conf(pg.locator('#cd-card [data-modo]').count() == 5, "painel: cinco cartões A a E")
            conf(pg.input_value("#ant-data") == hoje, "painel: data de hoje já preenchida (%s)" % hoje)
            medir("painel aberto")
            antes_b = pg.inner_text('#cd-card [data-an-card="B"]')
            n1 = len(pg.evaluate("() => window.pedidos"))
            pg.click("#ant-valor")
            pg.keyboard.type("30.000,00", delay=15)
            pg.wait_for_timeout(200)
            depois_b = pg.inner_text('#cd-card [data-an-card="B"]')
            conf(depois_b != antes_b and "Próximo pagamento" in depois_b, "digitar 30.000,00 muda o cartão B (%s)" % depois_b.split("\n")[-1][:70])
            conf(len(pg.evaluate("() => window.pedidos")) == n1, "digitar não chama o servidor (a conta é no navegador)")
            conf(pg.evaluate("() => document.activeElement && document.activeElement.id") == "ant-valor" and pg.input_value("#ant-valor") == "30.000,00",
                 "o foco e o texto digitado ficam no campo")
            medir("valor digitado")
            for m in ("A", "C", "E"):
                pg.click('#cd-card [data-modo="%s"]' % m)
                pg.wait_for_timeout(100)
                medir("jeito " + m)
            pg.click('#cd-card [data-modo="D"]')
            pg.wait_for_timeout(100)
            conf(pg.locator('#cd-card input[name="an-par"]').count() >= 1, "jeito D: lista de balões em aberto")
            medir("jeito D")
            rad = pg.evaluate("() => Array.from(document.querySelectorAll('#cd-card input[name=an-par]')).map(function (i) {"
                              " var l = i.closest('label'); return [i.getBoundingClientRect().width, getComputedStyle(l).textTransform]; })")
            conf(len(rad) >= 1 and all(r[0] < 40 for r in rad) and all(r[1] == "none" for r in rad),
                 "jeito D: rádios estreitos (%s px) e rótulo sem maiúsculas (%s)" % (rad[0][0] if rad else "?", rad[0][1] if rad else "?"))
            pg.click('#cd-card [data-modo="E"]')
            pg.wait_for_timeout(100)
            rade = pg.evaluate("() => Array.from(document.querySelectorAll('#cd-card input[name=an-e]')).map(function (i) {"
                               " var l = i.closest('label'); return [i.getBoundingClientRect().width, getComputedStyle(l).textTransform]; })")
            conf(len(rade) == 2 and all(r[0] < 40 for r in rade) and all(r[1] == "none" for r in rade), "jeito E: rádios estreitos e rótulo sem maiúsculas")
            pg.click('#cd-card [data-modo="D"]')
            pg.wait_for_timeout(100)
            pg.click('#cd-card [data-modo="B"]')
            pg.wait_for_timeout(100)
            pg.click('#cd-card [data-acao="an-tabela"]')
            pg.wait_for_timeout(100)
            conf(pg.locator('#cd-card .vb-antec table.cd-fl').count() == 1, "parcela por parcela: a tabela aparece")
            cx = pg.evaluate("() => { var t = document.querySelector('#cd-card .vb-antec table.cd-fl'), c = t.parentElement;"
                             " return [c.clientWidth, c.scrollWidth, getComputedStyle(c).overflowX]; }")
            conf(cx[2] == "auto", "a tabela rola dentro do contêiner (overflow-x %s; %s px visíveis de %s)" % (cx[2], cx[0], cx[1]))
            medir("tabela aberta")
            n2 = len(pg.evaluate("() => window.pedidos"))
            conf(pg.locator('#cd-card [data-acao="an-pdf"]').count() == 0 and "PDF" not in pg.inner_text("#cd-card .vb-antec"),
                 "a antecipação não tem mais botão nem palavra PDF")
            conf(pg.locator('#cd-card [data-acao="an-msg"]').inner_text() == "Copiar mensagem", "botão Copiar mensagem")
            pg.click('#cd-card [data-acao="an-msg"]')
            pg.wait_for_selector('#ant-texto', timeout=5000)
            pg.wait_for_selector('#cd-card .vb-antec [role="status"]', timeout=5000)
            ped = pg.evaluate("() => window.pedidos")
            conf(ped.count("antecipacaoTexto") == 1 and ped.count("antecipacaoPdf") == 0 and len(ped) == n2 + 1,
                 "Copiar mensagem chama antecipacaoTexto uma vez e nunca o PDF")
            conf(pg.evaluate("() => window.abriu").__len__() == 0, "nenhuma janela é aberta")
            conf(pg.evaluate("() => window.copiados") == ["Texto pronto para o WhatsApp"], "o texto foi para a área de transferência")
            conf("Texto pronto para o WhatsApp" in pg.input_value('#ant-texto'), "texto do WhatsApp aparece")
            conf("Mensagem copiada" in pg.inner_text('#cd-card .vb-antec [role="status"]'), "aviso: Mensagem copiada")
            conf(pg.locator('#cd-card .vb-antec a').count() == 0, "sem link de PDF")
            medir("mensagem copiada")
            # sem permissão para copiar: o texto fica selecionado e o aviso manda copiar com Ctrl+C
            pg.evaluate("() => { window.modoClip = 'nega'; }")
            pg.click('#cd-card [data-acao="an-copiar"]')
            pg.wait_for_function("() => /Selecione e copie/.test(document.querySelector('#cd-card .vb-antec [role=status]').textContent)", timeout=5000)
            sel = pg.evaluate("() => { var t = document.getElementById('ant-texto'); return [document.activeElement === t, t.selectionStart, t.selectionEnd, t.value.length]; }")
            conf(sel[0] and sel[1] == 0 and sel[2] == sel[3] > 0, "sem clipboard: o texto fica selecionado (%s)" % (sel,))
            conf("Mensagem copiada" not in pg.inner_text('#cd-card .vb-antec'), "sem clipboard: o aviso de copiado some")
            pg.evaluate("() => { window.modoClip = 'nega'; }")
            pg.click('#cd-card [data-acao="an-msg"]')
            pg.wait_for_function("() => /Selecione e copie/.test(document.querySelector('#cd-card .vb-antec [role=status]').textContent) && document.getElementById('ant-texto')", timeout=5000)
            conf(pg.evaluate("() => window.pedidos").count("antecipacaoTexto") == 2, "Copiar mensagem de novo, agora sem permissão, também mostra o texto")
            medir("selecione e copie")
            if os.environ.get("FUMACA_PRINT_ANT"):
                pg.screenshot(path=os.environ["FUMACA_PRINT_ANT"], full_page=True)
            # retrato de outro mês: nenhum número, só a mensagem e o botão de ler
            pg.evaluate("() => { window.respostas.antecipacaoEstado = { ok: true, pode: true, velho: true, processando: false, retrato: null, lido: '2026-09-30 10:00', temFiador: true }; }")
            pg.click('#cd-card [data-acao="an-abrir"]')
            pg.wait_for_timeout(100)
            pg.click('#cd-card [data-acao="an-abrir"]')
            pg.wait_for_selector('#cd-card [data-acao="an-ler"]', timeout=5000)
            conf(pg.locator('#cd-card [data-modo]').count() == 0 and "R$" not in pg.inner_text("#cd-card .vb-antec"),
                 "retrato velho: sem número e sem cartões, só ler de novo")
            medir("retrato velho")
            # leitura em andamento ao abrir: a tela passa a conferir sozinha (o relógio de 10 s é encurtado só aqui)
            pg.evaluate("""(r) => {
                var orig = window.setTimeout; window.setTimeout = function (f, ms) { return orig(f, ms === 10000 ? 150 : ms); };
                window.respostas.antecipacaoEstado = { ok: true, pode: true, velho: false, processando: true, retrato: r, lido: '2026-10-21 10:00', temFiador: true };
                window.pedidos.length = 0;
            }""", retrato)
            pg.click('#cd-card [data-acao="an-abrir"]')   # fecha
            pg.wait_for_timeout(100)
            pg.click('#cd-card [data-acao="an-abrir"]')   # abre: o estado volta processando
            pg.wait_for_function("() => window.pedidos.filter(function (a) { return a === 'antecipacaoEstado'; }).length >= 3", timeout=5000)
            conf("Lendo a venda no ERP" in pg.inner_text("#cd-card .vb-antec") and pg.locator('#cd-card [data-modo]').count() == 0,
                 "estado processando ao abrir: sem número, e a tela volta a perguntar sozinha")
            pg.evaluate("(r) => { window.respostas.antecipacaoEstado = { ok: true, pode: true, velho: false, processando: false, retrato: r, lido: '2026-10-21 10:05', temFiador: true }; }", retrato)
            pg.wait_for_selector('#cd-card [data-modo="B"]', timeout=5000)
            conf(pg.locator('#cd-card [data-modo]').count() == 5, "a leitura terminou: os cinco cartões voltam sozinhos")
            # erro no primeiro pedido (cartão novo, sem estado): mensagem e Tentar de novo
            pg.evaluate("() => { window.respostas.antecipacaoEstado = { ok: false, erro: 'SEM_RESPOSTA' }; VendaBlocos.soltar(); }")
            pg.evaluate("""(id) => { var c = document.getElementById('cd-card');
                c.innerHTML = '<div class="cd-cardbox" data-aba="financeiro"><h3>Unidade 13</h3><div id="cd-venda"></div></div>';
                VendaBlocos.montar(document.getElementById('cd-venda'), id); VendaBlocos.aba('financeiro'); }""", COND)
            pg.wait_for_selector('#cd-card .vb-antec [data-acao="an-abrir"]', timeout=5000)
            pg.click('#cd-card .vb-antec [data-acao="an-abrir"]')
            pg.wait_for_selector('#cd-card [data-tentar]', timeout=5000)
            conf("não respondeu" in pg.inner_text("#cd-card .vb-antec"), "erro ao abrir: mensagem em português e botão Tentar de novo")
            pg.evaluate("(r) => { window.respostas.antecipacaoEstado = { ok: true, pode: true, velho: false, processando: false, retrato: r, lido: '2026-10-21 10:05', temFiador: true }; }", retrato)
            pg.click('#cd-card [data-tentar]')
            pg.wait_for_selector('#cd-card [data-modo="B"]', timeout=5000)
            conf(pg.locator('#cd-card [data-modo]').count() == 5, "Tentar de novo abre o painel")
            print("largura máxima da página a 375 px:", max(largura))
            pg.set_viewport_size({"width": 1280, "height": 800})
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
