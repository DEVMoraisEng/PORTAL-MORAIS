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
  assert.deepEqual(P.ABAS.map(a => a[0]), ["resumo", "documentos", "compradores", "contrato", "recebimentos", "andamento", "links"]);
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

/* 13/11/2026 (dono): o Andamento em ETAPAS na ordem da planilha de casas de rua da Secretária de Vendas
   (antes era por departamento e embaralhava a ordem do processo) */
test("Andamento em etapas na ordem da planilha; coluna nova cai em OUTROS CAMPOS", () => {
  assert.equal(P.etapa("MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?"), "CONTRATO DE COMPRA E VENDA E DOCUMENTOS AO CORRESPONDENTE");
  assert.equal(P.etapa("RECEBEU?"), "DEVOLUÇÃO E RECEBIMENTO DO BANCO", "RECEBEU? vem depois do cartório, como na planilha");
  assert.equal(P.etapa("RECEBEU TAXA VISTORIA?"), "TAXA DE VISTORIA E AGÊNCIA");
  assert.equal(P.etapa("ITBI GERADO"), "PREFEITURA, ITBI E CARTÓRIO");
  assert.equal(P.etapa("Nº DE CADASTRO PREFEITURA"), "PREFEITURA, ITBI E CARTÓRIO");
  assert.equal(P.etapa("ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"), "VISTORIA E ENTREGA DA CASA");
  assert.equal(P.etapa("AGUA TRANSFERIDA"), "VISTORIA E ENTREGA DA CASA");
  assert.equal(P.etapa("GEROU E ARMAZENOU GCAP?"), "GCAP", "GCAP depois da entrega, como na planilha");
  assert.equal(P.etapa("DATA DE ASSINATURA DO CONTRATO"), "CONFORMIDADE E CONTRATO DO BANCO", "junto do assinou e armazenou (12/11)");
  assert.equal(P.etapa("COLUNA NOVA QUALQUER"), "OUTROS CAMPOS");
  assert.equal(P.departamento, P.etapa, "nome antigo continua respondendo");
  /* a ordem da planilha (ORDEM_PREFIXOS do vendas.html, já resolvida nos nomes reais do Notion) não muda */
  const planilha = ["AVALIAÇÃO", "VALIDADE ", " VALOR NA MÃO ", " COMISSÃO ", "ARMAZENOU CONTRATO COMPRA E VENDA?", "EMITIU RCPM?",
    "MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?", "DATA DE ENVIO DOS DOCUMENTOS", "MANDOU P/ CONFORMIDADE?", "PROCESSO CONFORME?",
    "ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO", "VALOR DA PARCELA", "TEVE FGTS?", "VALOR DO FGTS",
    "TEM PROTOCOLO DE TRANS. ÁGUA", "TEM PROTOCOLO DE TRANS. ENERGIA", "RECEBEU TAXA VISTORIA?", "AGÊNCIA", "TEM NUMERO DE CADASTRO?",
    "Nº DE CADASTRO PREFEITURA", "ITBI GERADO", "ITBI PAGO", "DEU ENTRADA NO CARTORIO?", "FICOU PRONTO O REGISTRO?", "DEVOLVEU NO BANCO?",
    "RECEBEU?", "CASA APTA PARA A VISTORIA", "AGENDOU PRE VISTORIA?", "DATA DA PRÉ-VISTORIA", "TEM MANUAL DE OBRA?", "AGUA TRANSFERIDA",
    "ENERGIA TRANSFERIDA", "ENTREGOU A CASA E PEGOU TERMO DE ENTREGA?", "DATA DA ENTREGA", "PREENCHEU A PESQUISA?",
    "GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?", "ENG. RESPONSÁEL", "MODELO?", "RESERVADA", "TIPO"];
  const g = P.porEtapa(planilha.concat(["HISTÓRICO DO CONTRATO"]));
  assert.deepEqual(g.flatMap(x => x.campos).filter(n => planilha.includes(n)), planilha, "ler o Andamento = ler a planilha");
  assert.equal(g[0].titulo, "1 · AVALIAÇÃO E VALORES");
  assert.equal(g[g.length - 1].etapa, "OUTROS CAMPOS");
  assert.deepEqual(P.porEtapa(["ITBI PAGO", "AGUA TRANSFERIDA", "ITBI GERADO"]).map(x => x.titulo),
    ["1 · PREFEITURA, ITBI E CARTÓRIO", "2 · VISTORIA E ENTREGA DA CASA"], "numeração só das etapas que aparecem");
});

test("13/11: modo lista (coluna lateral) com resumo do processo no topo e duas abas", () => {
  assert.deepEqual(P.ABAS_LISTA.map(a => a[0]), ["etapas", "documentos"]);
  assert.ok(vendas.includes('id="pn-modo" onclick="pnTrocarModo()"'), "botão de trocar o modo no cabeçalho");
  assert.ok(vendas.includes('<div class="pn-topo" id="pn-topo"></div>'));
  assert.ok(vendas.includes('#painel[data-modo="lista"]{top:0;right:0;left:auto;transform:none;width:min(640px,100vw)'), "lista = coluna à direita");
  assert.ok(vendas.includes('#painel[data-aba="lista-documentos"] #dossie-wrap{display:block}'));
  assert.ok(vendas.includes('localStorage.setItem("morais_pn_modo",PN_MODO)'), "escolha guardada por pessoa");
  assert.match(vendas.slice(vendas.indexOf("function renderPainel(")), /pnPorEtapa\(porAba\.andamento\)/);
});

test("vendas.html: barra de abas no painel e cada parte com data-sec", () => {
  assert.match(vendas, /<div class="pn-abas cd-abas" id="pn-abas"><\/div>/);
  assert.match(vendas, /\["resumo","documentos","compradores","contrato","andamento","links"\]\.map\(k=>`<div data-sec="\$\{k\}">\$\{sec\[k\]\}<\/div>`\)/);
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

/* 05/11/2026 (dono): painel da casa de rua — ENDEREÇO fora do Resumo e Comprador 1 com os dados do Resumo */
const RENDER = vendas.slice(vendas.indexOf("function renderPainel("), vendas.indexOf("/* ---------- COMENTÁRIOS (item 3)"));
test("ENDEREÇO não é mais caixa do Resumo nem editável por ninguém no painel (ADM inclusive)", () => {
  assert.doesNotMatch(RENDER, /campoPorNome\("ENDEREÇO"\)/, "o Resumo não monta mais a caixa do endereço");
  const ch = vendas.slice(vendas.indexOf("function campoHtml("), vendas.indexOf("function campoResumoHtml("));
  assert.doesNotMatch(ch, /editar\([^)]*"ENDEREÇO"/, "nenhum caminho do painel grava ENDEREÇO");
  assert.doesNotMatch(ch, /S\.tipo!=="ADM"/, "não há mais exceção para ADM");
  assert.match(ch, /normNome\(c\.nome\)==="ENDERECO"\) return [^\n]*somente leitura/);
  /* quem usa o endereço continua: título do painel, filtros, planilha */
  assert.match(vendas, /getElementById\("pn-end"\)\.textContent=getV\(V,"ENDEREÇO"\)/);
  assert.match(vendas, /getV\(v\.valores,"ENDEREÇO"\)\|\|""\)\.toLowerCase\(\)\.indexOf\(busca\)/);
  assert.match(vendas, /function editavelNaCelula\(c\)\{[^\n]*c\.nome!=="ENDEREÇO"/, "na planilha continua sem edição");
});

test("Comprador 1 espelha nome, CPF, WhatsApp e e-mail do Resumo (mesma coluna)", () => {
  assert.deepEqual(P.ESPELHO_COMPRADOR1.map(x => x.coluna), ["CLIENTES", "CPF", "Nº Whatsapp", "Email"]);
  const resumo = (vendas.match(/const RESUMO=\[([^\]]*)\]/) || [])[1] || "";
  P.ESPELHO_COMPRADOR1.forEach(x => assert.ok(resumo.includes('"' + x.coluna + '"'), x.coluna + " está no RESUMO"));
  assert.match(RENDER, /pnMarcarEspelho\(campoResumoHtml\(/, "a caixa do Resumo leva a marca do espelho");
  assert.match(RENDER, /c2&&g\.titulo==="Comprador 1"\?espC1/, "as caixas entram no grupo Comprador 1");
  assert.match(vendas, /aplicarLocal\(pageId,prop,valor\);\s*try\{ pnEspelhar\(prop,valor,el\); \}/, "editar uma atualiza a outra");
});

test("COMPRADOR 1 - E-MAIL só aparece se tiver algo diferente do Email (que é o que contrato e Clicksign leem)", () => {
  assert.equal(P.emailAntigoVisivel("", "a@b.co"), false);
  assert.equal(P.emailAntigoVisivel(null, ""), false);
  assert.equal(P.emailAntigoVisivel(" A@B.co ", "a@b.co"), false, "igual (sem caixa/espaço) = duplicado");
  assert.equal(P.emailAntigoVisivel("x@y.co", "a@b.co"), true, "diferente fica à vista: não some dado");
  assert.equal(P.emailAntigoVisivel("x@y.co", ""), true);
  const gc = fs.readFileSync(path.join(RAIZ, "venda", "GerarContrato.gs"), "utf8");
  assert.match(gc, /email: ctrTxt_\(cv\("Email"\)\)/, "o contrato lê o comprador 1 da coluna Email");
  const cs = fs.readFileSync(path.join(RAIZ, "venda", "ClicksignVenda.js"), "utf8");
  assert.match(cs, /comprador1: "coluna Email"/);
});

test("espelho no navegador: caixas marcadas e o valor novo vai para a outra aba", () => {
  const vm = require("node:vm");
  const ini = vendas.indexOf("function pnMarcarEspelho(");
  /* fim da função com \n ou \r\n (o checkout no Windows pode trazer CRLF) */
  const resto = vendas.slice(vendas.indexOf("function pnEspelhar(")), mFim = /\r?\n\}\r?\n/.exec(resto);
  const fimEsp = vendas.indexOf("function pnEspelhar(") + mFim.index + mFim[0].length;
  const caixas = [];
  function caixa(k, dono) { const i = { value: "velho", style: {} }; return { k, i, getAttribute: () => k, contains: (e) => e === dono, querySelectorAll: () => [i] }; }
  const el = {};
  caixas.push(caixa("EMAIL", el), caixa("EMAIL"), caixa("CPF"));
  const ctx = { window: { PainelCasa: P }, String, normNome: (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim(),
    esc: (s) => String(s), nomeExcluido: () => false, getV: (V, n) => V[n],
    campoPorNome: (n) => ({ nome: n, tipo: n === "Email" ? "email" : "rich_text", sensivel: n === "CPF" }),
    inputControl: (c, v) => `<input value="${v || ""}">`,
    document: { getElementById: () => ({ querySelectorAll: () => caixas }) } };
  vm.createContext(ctx);
  vm.runInContext(vendas.slice(ini, fimEsp), ctx);
  assert.match(ctx.pnMarcarEspelho('<div class="ri"><div class="k">Email</div></div>', "Email"), /^<div class="ri" data-espelho="EMAIL">/);
  assert.equal(ctx.pnMarcarEspelho('<div class="ri">x</div>', "BANCO"), '<div class="ri">x</div>', "coluna fora do espelho não muda");
  const h = ctx.pnEspelhoComprador1({ CLIENTES: "FULANO TESTE", Email: "a@b.co" }, "p1", true);
  assert.equal((h.match(/data-espelho=/g) || []).length, 4);
  assert.match(h, /data-espelho="CPF"><label>CPF [^]*?sens-ro/, "CPF protegido ainda não chegou: caixa travada");
  assert.match(h, /Nome <span[^>]*>\(o mesmo do Resumo\)/);
  ctx.pnEspelhar("Email", "novo@b.co", el);
  assert.deepEqual(caixas.map(c => c.i.value), ["velho", "novo@b.co", "velho"], "só a outra caixa da mesma coluna muda");
});

/* 09/11/2026 — aba Links e Resumo do processo */
test("layout, fotos e localização vão para a aba Links", () => {
  assert.equal(P.abaDoCampo("LAYOUT"), "links");
  assert.equal(P.abaDoCampo("FOTOS"), "links");
  assert.equal(P.abaDoCampo("LOCALIZAÇÃO"), "links");
  assert.equal(P.abaDoCampo("FOTOS DA VISTORIA"), "links", "começa com FOTOS");
  assert.equal(P.abaDoCampo("ITBI PAGO"), "andamento");
  assert.match(vendas, /#painel\[data-aba="links"\] #pn-body>\[data-sec="links"\]/);
});
test("resumo do processo acha as colunas pelo nome e pelo padrão", () => {
  const r = P.resolverProcesso(["SITUAÇÃO DO PROCESSO", "TITULARIDADES TRANSFERIDAS?", "RECEBEU?", "RECEBEU TAXA VISTORIA?",
    "GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?", "DATA PAGAMENTO GCAP", "ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"]);
  const m = Object.fromEntries(r.map(x => [x.chave, x.coluna]));
  assert.deepEqual(r.map(x => x.chave), ["vendida", "situacao", "ligacoes", "recebeu", "gerou_gcap", "pagou_gcap", "data_gcap", "entregue"]);
  assert.equal(m.recebeu, "RECEBEU?", "não pega RECEBEU TAXA VISTORIA?");
  assert.equal(m.data_gcap, "DATA PAGAMENTO GCAP");
  assert.equal(m.entregue, "ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?");
  assert.equal(r[0].calculado, true);
  const sem = P.resolverProcesso(["RECEBEU?"]);
  assert.deepEqual(sem.map(x => x.chave), ["vendida", "recebeu"], "coluna que não existe some");
});

/* 12/11/2026 (dono): duas datas de assinatura com nome que diz qual contrato é — só na tela */
test("datas de assinatura: rótulo de tela na casa de rua e no condomínio; Notion com o nome antigo; Caixa no Andamento", () => {
  const trecho = (ini, fim) => { const i = vendas.indexOf(ini); assert.ok(i >= 0, ini); return vendas.slice(i, vendas.indexOf(fim, i) + fim.length); };
  const fonte = [trecho("const _NORM_CACHE=", "\n"), trecho("function _normNomeBruto(", "\n"), trecho("function normNome(s){", "\n}"),
    trecho("const ROTULO_DATA_CV=", "\n"), trecho("const ROTULOS_RUA=", "\n"), trecho("function rotuloRua(", "\n"),
    trecho("const ROTULOS_COND=", "\n"), trecho("function cdRotuloTela(", "\n")].join("\n");
  const f = new Function(fonte + "\nreturn { rotuloRua, cdRotuloTela };")();
  assert.equal(f.rotuloRua("DATA DA VENDA"), "DATA DA ASSINATURA – COMPRA E VENDA (CONSTRUTORA)");
  assert.equal(f.rotuloRua("data de assinatura do contrato "), "DATA DA ASSINATURA – CONTRATO CAIXA");
  assert.equal(f.rotuloRua("ITBI PAGO "), "ITBI PAGO");
  assert.equal(f.cdRotuloTela("DATA DE ASSINATURA DO CONTRATO"), "DATA DA ASSINATURA – COMPRA E VENDA (CONSTRUTORA)");
  assert.equal(f.cdRotuloTela("DATA DE ASSINATURA DO CONTRATO NO BANCO"), "DATA DA ASSINATURA – CONTRATO CAIXA");
  assert.equal(f.cdRotuloTela("MANDOU P/ CORESSPONDENTE?"), "MANDOU P/ CORRESPONDENTE?");
  assert.match(vendas, /"Email","DATA DA VENDA","VALOR DE COMPRA/, "Resumo: só a compra e venda; a da Caixa fica no Andamento, junto do assinou e armazenou (dono 12/11)");
  assert.equal(f.rotuloRua("MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?"), "MANDOU TODOS OS DOCS. P/ CORRESPONDENTE?");
  assert.match(vendas, /data-col="\$\{esc\(c\.nome\)\}" title="Ordenar por \$\{esc\(c\.nome\.trim\(\)\)\}">\$\{esc\(rotuloRua\(c\.nome\)\)\}/, "planilha: data-col segue o nome do Notion");
});

test("pares: ASSINOU E ARMAZENOU + data da Caixa num bloco só, um em cima do outro (12/11)", () => {
  assert.deepEqual(P.agruparPares(["EMITIU RCPM?", "ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "VALOR DA PARCELA", "DATA DE ASSINATURA DO CONTRATO", "RECEBEU?"]),
    ["EMITIU RCPM?", ["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO"], "VALOR DA PARCELA", "RECEBEU?"]);
  assert.deepEqual(P.agruparPares(["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "RECEBEU?"]), ["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "RECEBEU?"], "sem a data, fica sozinho");
  assert.deepEqual(P.agruparPares(["DATA DE ASSINATURA DO CONTRATO "]), ["DATA DE ASSINATURA DO CONTRATO "]);
  assert.match(vendas, /pnItens\(nomes\)\.map\(it=>Array\.isArray\(it\)\?`<div class="pn-par">`/);
});
