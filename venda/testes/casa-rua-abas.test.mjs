/* 04/11/2026 — painel da casa de rua em abas (venda/painel-casa.js + vendas.html). Só nomes de coluna, nenhum dado. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../painel-casa.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");

test("abas na ordem combinada", () => {
  assert.deepEqual(P.ABAS.map(a => a[0]), ["resumo", "documentos", "compradores", "contrato", "recebimentos", "andamento"]);
});

test("cada campo vai para a aba certa", () => {
  assert.equal(P.abaDoCampo("COMPRADOR 1 - ESTADO CIVIL"), "compradores");
  assert.equal(P.abaDoCampo("COMPRADOR 2 - CPF"), "compradores");
  assert.equal(P.abaDoCampo("CONTRATO - SINAL VALOR"), "contrato");
  assert.equal(P.abaDoCampo("CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS"), "contrato", "fora dos grupos, mas é do contrato");
  assert.equal(P.abaDoCampo("DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"), "documentos");
  assert.equal(P.abaDoCampo("ITBI PAGO"), "andamento");
  assert.equal(P.abaDoCampo("ASSINOU E ARMAZENOU CONTRATO DO BANCO?"), "andamento", "contrato do banco é andamento, não o nosso contrato");
});

test("Andamento por departamento, coluna nova cai em CADASTRO DA CASA", () => {
  assert.equal(P.departamento("MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?"), "BANCO E CORRESPONDENTE");
  assert.equal(P.departamento("RECEBEU?"), "BANCO E CORRESPONDENTE");
  assert.equal(P.departamento("RECEBEU TAXA VISTORIA?"), "ENTREGA DA CASA");
  assert.equal(P.departamento("EMITIU RCPM?"), "BANCO E CORRESPONDENTE");
  assert.equal(P.departamento("ITBI GERADO"), "CARTÓRIO E IMPOSTOS");
  assert.equal(P.departamento("Nº DE CADASTRO PREFEITURA"), "CARTÓRIO E IMPOSTOS");
  assert.equal(P.departamento("ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"), "ENTREGA DA CASA");
  assert.equal(P.departamento("AGUA TRANSFERIDA"), "ÁGUA E ENERGIA");
  assert.equal(P.departamento("DATA DA CONFERÊNCIA (TRANSFERÊNCIA)"), "ÁGUA E ENERGIA");
  assert.equal(P.departamento("ARMAZENOU CONTRATO COMPRA E VENDA?"), "CONTRATO");
  assert.equal(P.departamento("LAYOUT"), "CADASTRO DA CASA");
  const g = P.porDepartamento(["LAYOUT", "ITBI PAGO", "AGUA TRANSFERIDA", "ITBI GERADO"]);
  assert.deepEqual(g.map(x => x.titulo), ["CARTÓRIO E IMPOSTOS", "ÁGUA E ENERGIA", "CADASTRO DA CASA"]);
  assert.deepEqual(g[0].campos, ["ITBI PAGO", "ITBI GERADO"], "mantém a ordem recebida");
});

test("vendas.html: barra de abas no painel e cada parte com data-sec", () => {
  assert.match(vendas, /<div class="pn-abas cd-abas" id="pn-abas"><\/div>/);
  assert.match(vendas, /\["resumo","documentos","compradores","contrato","andamento"\]\.map\(k=>`<div data-sec="\$\{k\}">\$\{sec\[k\]\}<\/div>`\)/);
  assert.match(vendas, /#painel\[data-aba="contrato"\] #contrato-wrap/);
  assert.match(vendas, /#painel\[data-aba="recebimentos"\] #contrato-wrap>:not\(\.vb-rec\)\{display:none\}/);
  const r = vendas.slice(vendas.indexOf("function renderPainel("), vendas.indexOf("/* ---------- COMENTÁRIOS (item 3)"));
  assert.match(r, /pnDesenharAbas\(\);/);
  assert.match(r, /pedirDistrato/, "distrato continua no painel");
  assert.match(r, /enviarArquivo/, "arquivos continuam no painel");
});

const D = require("../../venda-dossie.js");
test("o que falta no contrato da casa aponta para a coluna da venda", () => {
  assert.deepEqual(P.colunasDaFalta("Comprador 1: nacionalidade"), ["COMPRADOR 1 - NACIONALIDADE"]);
  assert.deepEqual(P.colunasDaFalta("Comprador 1: nome"), ["CLIENTES"]);
  assert.deepEqual(P.colunasDaFalta("Imóvel: alvará (número)"), ["CONTRATO - ALVARÁ Nº"]);
  assert.deepEqual(P.colunasDaFalta("Imóvel: prazo previsto de conclusão das obras"), ["DATA DA ENTREGA"]);
  /* 05/11/2026: quem paga é sempre o comprador e a forma vem do cadastro do corretor — nenhuma caixa da venda */
  assert.deepEqual(P.colunasDaFalta("Negociação: comissão paga por"), []);
  assert.deepEqual(P.colunasDaFalta("Negociação: comissão (forma)"), []);
  assert.equal(P.colunasDaFalta("Negociação: valor na mão + comissão ≠ valor do contrato").length, 3);
  assert.deepEqual(P.colunasDaFalta("Vendedor: cadastro em VENDEDORES – CONTRATO"), [], "cadastro tem o formulário do servidor");
});
test("htmlContrato: falta da venda vira caixa; o resto continua em lista; sem campoVenda fica como antes", () => {
  const e = { gerado: false, conta: null };
  const faltas = ["Comprador 1: nacionalidade", "Vendedor: cadastro em VENDEDORES – CONTRATO", "Comprador 1: nacionalidade"];
  const comCaixa = D.htmlContrato(e, { faltas, campos: null, rascunho: {}, testes: false,
    campoVenda: (f) => /nacionalidade/.test(f) ? '<div class="campo">CX</div>' : "" });
  assert.match(comCaixa, /dz-faltas-venda/);
  assert.equal((comCaixa.match(/>CX</g) || []).length, 1, "a mesma caixa não se repete");
  assert.match(comCaixa, /<li>Vendedor: cadastro em VENDEDORES – CONTRATO<\/li>/);
  assert.doesNotMatch(comCaixa, /<li>Comprador 1: nacionalidade<\/li>/);
  const antes = D.htmlContrato(e, { faltas, campos: null, rascunho: {}, testes: false });
  assert.match(antes, /<li>Comprador 1: nacionalidade<\/li>/);
  assert.doesNotMatch(antes, /dz-faltas-venda/);
});
test("vendas.html: PainelFaltaCampo não abre coluna protegida ainda não carregada e só para a casa aberta", () => {
  const f = vendas.slice(vendas.indexOf("window.PainelFaltaCampo=function"), vendas.indexOf("function renderPainel("));
  assert.match(f, /!\(c\.sensivel&&PN_SENS\)/);
  assert.match(f, /semT\(OBRA_ABERTA\)!==semT\(PN_PAGE\)/);
  assert.match(vendas, /PN_V=V; PN_PAGE=pageId; PN_SENS=!!sensPendente;/);
});

test("prazo de conclusão das obras não aparece no painel (o contrato usa a DATA DA ENTREGA)", () => {
  assert.equal(P.ocultoNoPainel("CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS"), true);
  assert.equal(P.ocultoNoPainel("DATA DA ENTREGA"), false);
  assert.deepEqual(P.colunasDaFalta("Imóvel: prazo previsto de conclusão das obras"), ["DATA DA ENTREGA"]);
});

test("05/11: o painel da casa de rua abre como modal central, igual ao cartão do condomínio", () => {
  const css = vendas.slice(vendas.indexOf("<style>"), vendas.indexOf("</style>"));
  const ini = css.indexOf("\n.painel{"), painel = css.slice(ini, css.indexOf("}", ini));
  assert.ok(ini > 0, "regra .painel existe");
  assert.ok(painel.includes("left:50%;transform:translateX(-50%)"), "centralizado, não preso à direita");
  assert.ok(painel.includes("width:min(880px,"), "mesma largura máxima do .cd-cardbox");
  assert.ok(painel.includes("border-radius:14px"));
  assert.ok(!painel.includes("right:0"), "não é mais aba lateral");
  assert.ok(css.includes(".pbody{padding:0 0 24px;overflow:auto;flex:1;min-height:0"), "rolagem só dentro do painel");
  assert.ok(css.includes(".painel{inset:0;top:0;left:0;transform:none;width:100vw;max-width:100vw;height:100%;border-radius:0}"), "celular: tela inteira");
  assert.ok(css.includes('#painel[data-compradores="1"] #pn-body [data-comprador2]{display:none}'), "seletor de compradores continua");
  assert.ok(vendas.includes('<aside class="painel" id="painel" role="dialog" aria-modal="true"'));
  assert.ok(vendas.includes('<button type="button" class="cd-bt" id="pn-fechar" onclick="fecharObra()">✕ Fechar</button>'));
  assert.ok(vendas.includes('<div class="overlay" id="overlay" onclick="fecharObra()"></div>'), "clique fora fecha");
  const js = vendas.slice(vendas.indexOf("function fecharObra("), vendas.indexOf("/* ---------- visualizador de PDF"));
  assert.ok(js.includes('e.key==="Escape"'), "Esc fecha");
  assert.ok(js.includes('e.key!=="Tab"'), "foco preso no Tab");
  assert.ok(js.includes('document.body.style.overflow="hidden"'), "página de trás não rola");
  assert.ok(js.includes("_pnFocoAntes=document.activeElement"), "foco volta para quem abriu");
  assert.ok(js.includes(".pdfoverlay.on"), "com distrato/visualizador por cima, o Esc é deles");
  const abrir = vendas.slice(vendas.indexOf("async function abrirObra("), vendas.indexOf("async function abrirObra(") + 300);
  assert.ok(abrir.includes("pnModalAbrir();"));
  /* o cartão do condomínio não muda */
  assert.ok(css.includes(".cd-ov{position:fixed;inset:0;background:rgba(15,30,45,.55);z-index:60;overflow:auto;padding:24px 12px}"));
  assert.ok(css.includes(".cd-cardbox{background:var(--sup);border-radius:14px;max-width:880px;margin:0 auto;padding:20px 22px;box-shadow:0 12px 40px rgba(0,0,0,.35)}"));
});

test("dossiê: situação na etiqueta, dados em tabela e histórico recolhido com o que pede atenção à vista", () => {
  const D2 = require("../../venda-dossie.js");
  const h = D2.html({ tipoCasa: "CASA PRONTA", arquivos: {}, pendentes: [], dossie: "LIDO PELA IA – CONFERIR",
    observacao: "[03/11 ana.teste] Comprovante do comprador 1: o arquivo não parece ser um comprovante de endereço — nada foi preenchido",
    imovel: { arquivos: {}, dossie: "CONFERIDO", dados: { matricula: "1.234" },
              observacao: "[04/11 ana.teste] Matrícula do imóvel: o campo CONTRATO - MATRÍCULA INDIVIDUAL foi atualizado pelo documento mais recente" } },
    { dois: false, ocupado: null, msg: "" });
  assert.match(h, /dz-selo dz-selo-novo">LIDO PELA IA – CONFERIR/);
  assert.match(h, /dz-selo dz-selo-ok">CONFERIDO/);
  assert.match(h, /<dt>Matrícula<\/dt><dd>1\.234<\/dd>/);
  assert.match(h, /dz-obs-at[\s\S]*não parece ser um comprovante/, "o que pede atenção fica à vista");
  assert.match(h, /Histórico da leitura \(1\)[\s\S]*MATRÍCULA INDIVIDUAL atualizado/, "linha enxuta");
  assert.doesNotMatch(h, /<pre>/);
  assert.equal((h.match(/data-acao="ler-todos"/g) || []).length, 1, "sem nada novo, só o Ler documentos do topo");
  assert.equal(P.ocultoNoPainel("DOSSIÊ"), true);
});
