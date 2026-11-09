/* Tela Boletos e Financeiro e o Apps Script dela (09/11/2026). Dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const BF = require("../../boletos-financeiro.js");

const item = (parcela, extra) => Object.assign({ parcela, unidade: "01", comprador: "COMPRADOR A", tipo: "pre", data: "2026-11-30", valor: 1900, motivo: "emite a partir de 2026-11-25" }, extra);
const vazio = { emitidos: [], a_emitir: [], aguardando: [], decidir: [], seguradas: [], pulados: [] };
const dados = (g, extra) => Object.assign({ rodada: { modo: "emissao", mes: "2026-11", nome: "2026-11-09_100000", saldo: 99, trava: null }, grupos: Object.assign({}, vazio, g) }, extra);

test("boletos: cabeçalho, grupos e motivo do pulado", () => {
  const h = BF.htmlBoletos(dados({ pulados: [item("p", { motivo: "ato (sempre por Pix, nunca boleto)" })] }), {});
  assert.match(h, /Boletos de novembro\/2026/);
  assert.match(h, /09\/11 às 10:00 · 99 créditos · sem trava/);
  assert.match(h, /Pulados <b>1<\/b>/);
  assert.match(h, /ato \(sempre por Pix, nunca boleto\)/);
});

test("boletos: status do boleto em português", () => {
  const h = BF.htmlBoletos(dados({ emitidos: [item("e", { motivo: "já tem boleto (REGISTERED)" })] }), {});
  assert.match(h, /boleto registrado/);
  assert.doesNotMatch(h, /REGISTERED/);
});

test("boletos: Segurar só para quem pode e nunca em emitido ou pulado", () => {
  const g = { aguardando: [item("a")], emitidos: [item("e")], pulados: [item("p")], seguradas: [item("s")] };
  const adm = BF.htmlBoletos(dados(g), { podeSegurar: true });
  assert.match(adm, /data-acao="segurar" data-parcela="a"/);
  assert.match(adm, /data-acao="soltar" data-parcela="s"/);
  assert.doesNotMatch(adm, /data-parcela="e"/);
  assert.doesNotMatch(adm, /data-parcela="p"/);
  assert.doesNotMatch(BF.htmlBoletos(dados(g), { podeSegurar: false }), /data-acao/);
});

test("boletos: pedido enviado troca o botão", () => {
  const h = BF.htmlBoletos(dados({ aguardando: [item("a")] }), { podeSegurar: true, pedidos: { a: 1 } });
  assert.match(h, /pedido enviado/);
  assert.doesNotMatch(h, /data-acao/);
});

test("boletos: trava, seguradas ilegíveis, prévia e robô que nunca rodou", () => {
  const h = BF.htmlBoletos(dados({}, { rodada: { modo: "previa", mes: "2026-11", nome: "2026-11-09_100000", trava: "saldo curto" }, trava_seguradas: "Não consegui ler" }), {});
  assert.match(h, /Trava: saldo curto/);
  assert.match(h, /Não consegui ler/);
  assert.match(h, /só a lista, sem emitir/);
  assert.doesNotMatch(h, /sem trava/);
  assert.match(BF.htmlBoletos({ rodada: null, grupos: vazio }, {}), /ainda não rodou/);
});

test("boletos: datas do motivo no formato brasileiro", () => {
  const h = BF.htmlBoletos(dados({ aguardando: [item("a", { motivo: "emite a partir de 2026-11-25 (5 dias antes)" })], decidir: [item("d", { motivo: "venceu em 2026-11-03 sem boleto: não emite, só aviso" })] }), {});
  assert.match(h, /emite a partir de 25\/11\/2026 \(5 dias antes\)/);
  assert.match(h, /venceu em 03\/11\/2026 sem boleto/);
  assert.doesNotMatch(h, /2026-11-/);
});

test("boletos: a coluna do motivo tem classe própria, para não ser espremida no celular", () => {
  assert.match(BF.htmlBoletos(dados({ aguardando: [item("a")] }), {}), /<td class="mot">/);
  assert.match(readFileSync(new URL("../../boletos-financeiro.html", import.meta.url), "utf8"), /\.mot\{min-width/);
});

test("boletos: pedido recusado pelo servidor aparece na tela", () => {
  const h = BF.htmlBoletos(dados({}, { recusas: [{ parcela: "x", unidade: "01", motivo: "parcela fora da lista", em: "09/11/2026 14:12" }] }), {});
  assert.match(h, /Não consegui atender o pedido da Unidade 01 em 09\/11\/2026 14:12: parcela fora da lista/);
});

test("financeiro: a nota não afirma nada sobre juros antes da conferência com uma baixa real", () => {
  assert.doesNotMatch(fin({}), /juros/);
});

test("boletos: filtro por grupo mostra só aquele bloco, e a contagem fica no botão", () => {
  const g = { aguardando: [item("a")], pulados: [item("p", { motivo: "ato (sempre por Pix, nunca boleto)" })] };
  const so = BF.htmlBoletos(dados(g), { grupo: "pulados" });
  assert.match(so, /class="chip ativo ne" data-grupo="pulados"/);
  assert.match(so, /Todas <b>2<\/b>/);
  assert.match(so, /Aguardando <b>1<\/b>/);
  assert.match(so, /ato \(sempre/);
  assert.doesNotMatch(so, /emite a partir/);
});

test("boletos: busca por unidade exata ou comprador muda a contagem", () => {
  const g = { aguardando: [item("a"), item("b", { unidade: "10", comprador: "COMPRADOR Z" })] };
  assert.match(BF.htmlBoletos(dados(g), { buscaBoletos: "10" }), /Aguardando <b>1<\/b>/);
  assert.match(BF.htmlBoletos(dados(g), { buscaBoletos: "comprador z" }), /Aguardando <b>1<\/b>/);
  assert.match(BF.htmlBoletos(dados(g), { buscaBoletos: "ninguém" }), /Nenhuma parcela para mostrar/);
});

test("boletos: cada motivo de decidir vira um bloco com o que fazer e quem resolve", () => {
  const g = { decidir: [item("v", { motivo: "venceu em 2026-11-03 sem boleto: não emite, só aviso" }), item("c", { motivo: "cadastro do comprador incompleto (CPF)" }),
                        item("i", { motivo: "índice do mês ainda não lançado: INCC" }), item("r", { motivo: "SEM_CONFIRMACAO: conferir" }), item("o", { motivo: "valor zero" })] };
  const h = BF.htmlBoletos(dados(g), {});
  for (const t of ["Venceu sem boleto", "Cadastro do comprador incompleto", "Índice do mês não lançado", "Emissão sem confirmação ou recusada", "Outros casos"]) assert.match(h, new RegExp(t));
  assert.match(h, /Quem resolve: Vendas/);
  assert.match(h, /Completar CPF/);
});

test("boletos: próximo mês só aparece quando tem parcela, com botão de segurar", () => {
  assert.doesNotMatch(BF.htmlBoletos(dados({}), {}), /data-grupo="proximo_mes"/);
  const d = dados({ proximo_mes: [item("n", { data: "2026-12-10" })] }, { rodada: { modo: "emissao", mes: "2026-11", nome: "2026-11-27_100000", proximo_mes: "2026-12" } });
  const h = BF.htmlBoletos(d, { podeSegurar: true });
  assert.match(h, /dezembro\/2026 <b>1<\/b>/);
  assert.match(h, /Próximo mês: dezembro\/2026/);
  assert.match(h, /data-acao="segurar" data-parcela="n"/);
});

test("boletos: lista do próximo mês que falhou avisa", () => {
  assert.match(BF.htmlBoletos(dados({}, { rodada: { modo: "emissao", mes: "2026-11", nome: "2026-11-27_100000", proximo_falhou: true } }), {}), /lista do próximo mês/);
});

const TITULOS = [
  { coluna: "vencido", unidade: "02", comprador: "COMPRADOR B", tipo: "pre", sub: "", data: "2026-10-28", valor: 3800, pago_em: "", dias_atraso: 12 },
  { coluna: "recebido", unidade: "01", comprador: "COMPRADOR A", tipo: "sinal", sub: "", data: "2026-10-30", valor: 42000, pago_em: "2026-10-31", dias_atraso: 0 },
  { coluna: "recebido", unidade: "02", comprador: "COMPRADOR B", tipo: "pre", sub: "", data: "2026-10-28", valor: 15300, pago_em: "", dias_atraso: 0 },
  { coluna: "caixa", unidade: "01", comprador: "COMPRADOR A", tipo: "terceiros", sub: "fgts", data: "2027-08-01", valor: 180000, pago_em: "", dias_atraso: 0 }
];

test("financeiro: os números são botões, e clicar mostra só os títulos daquele número", () => {
  const lista = fin({ titulos: TITULOS });
  assert.match(lista, /class="num" data-coluna="vencido"/);
  assert.match(lista, /COMPRADOR 01/);
  const v = fin({ titulos: TITULOS }, { coluna: "vencido" });
  assert.match(v, /class="num ativo" data-coluna="vencido" aria-pressed="true"/);
  assert.match(v, /Vencido: títulos <small>1<\/small>/);
  assert.match(v, /R\$ 3\.800,00/);
  assert.match(v, /28\/10\/2026/);
  assert.match(v, /12 dias/);
  assert.match(v, /Cobrar o comprador/);
  assert.match(v, /Quem resolve: Financeiro/);
  assert.doesNotMatch(v, /42\.000,00<\/td>/);
  assert.doesNotMatch(v, /so-vencido/);
  assert.match(v, /id="ver-unidades"/);
});

test("financeiro: recebido mostra a data da baixa e o que entrou em parte; FGTS pelo nome", () => {
  const r = fin({ titulos: TITULOS }, { coluna: "recebido" });
  assert.match(r, /31\/10\/2026/);
  assert.match(r, /em parte/);
  assert.match(r, /Recebido: títulos <small>2<\/small>/);
  assert.match(fin({ titulos: TITULOS }, { coluna: "caixa" }), /<td>FGTS<\/td>/);
});

test("financeiro: busca vale nos títulos, e número sem título não quebra", () => {
  const b = fin({ titulos: TITULOS }, { coluna: "recebido", busca: "02" });
  assert.match(b, /Recebido: títulos <small>1<\/small>/);
  assert.match(fin({ titulos: TITULOS }, { coluna: "permuta" }), /Nenhum título para mostrar/);
  assert.match(fin({}, { coluna: "coluna-que-nao-existe" }), /COMPRADOR 01/);
});

test("financeiro: singular quando há um título só", () => {
  const h = fin({ titulos: TITULOS });
  assert.match(h, /1 título</);
  assert.match(h, /2 títulos</);
  assert.doesNotMatch(h, /1 títulos/);
});

test("página: o bloco colorido só muda a faixa, não o texto", () => {
  assert.match(readFileSync(new URL("../../boletos-financeiro.html", import.meta.url), "utf8"), /\.bloco\.ru,\.bloco\.al,\.bloco\.ok,\.bloco\.ma,\.bloco\.ne\{background:var\(--sup\);color:var\(--text\)\}/);
});

test("escapa nome com HTML", () => {
  const h = BF.htmlBoletos(dados({ aguardando: [item("a", { comprador: "<img src=x onerror=1>" })] }), {});
  assert.doesNotMatch(h, /<img/);
});

const unid = (unidade, extra) => Object.assign({ unidade, comprador: "COMPRADOR " + unidade, recebido: 10, a_vencer: 20, vencido: 0, caixa: 30, permuta: 0, dias_atraso: 0, proxima: { data: "2026-11-30", valor: 1900 }, lido: "2026-11-09 08:04" }, extra);
const fin = (f, op) => BF.htmlFinanceiro({ financeiro: Object.assign({ lido: "2026-11-09 08:04", totais: { recebido: 118300, a_vencer: 302700, vencido: 3800, caixa: 550000, permuta: 72000 }, unidades: [unid("01"), unid("02", { vencido: 3800, dias_atraso: 12 })], nao_lancadas: [], sem_leitura: [] }, f) }, Object.assign({ agora: new Date(2026, 10, 9, 9, 0).getTime() }, op));

test("financeiro: totais, vencido em destaque e hora da leitura", () => {
  const h = fin({});
  assert.match(h, /118\.300,00/);
  assert.match(h, /3\.800,00 · 12 dias/);
  assert.match(h, /09\/11\/2026 às 08:04/);
  assert.match(h, /30\/11\/2026 · 1\.900,00/);
  assert.match(h, /A vencer é o valor de hoje/);
});

test("financeiro: aviso das vendas não lançadas, sem linha na lista", () => {
  const um = fin({ nao_lancadas: ["04"] });
  assert.match(um, /1 venda na planilha ainda não foi lançada no Mais Controle e não entra nesta conta: Unidade 04\./);
  assert.doesNotMatch(um, /COMPRADOR 04/);
  assert.match(fin({ nao_lancadas: ["04", "05"] }), /2 vendas na planilha ainda não foram lançadas no Mais Controle e não entram nesta conta: Unidades 04, 05\./);
});

test("financeiro: busca por unidade exata ou nome, e só com vencido", () => {
  assert.doesNotMatch(fin({}, { busca: "01" }), /COMPRADOR 02/);
  assert.match(fin({}, { busca: "comprador 02" }), /COMPRADOR 02/);
  const v = fin({}, { soVencido: true });
  assert.match(v, /COMPRADOR 02/);
  assert.doesNotMatch(v, /COMPRADOR 01/);
  assert.match(fin({}, { busca: "ninguém" }), /Nenhuma unidade para mostrar/);
});

test("financeiro: leitura velha, Notion fora e venda com leitura falha avisam", () => {
  assert.match(fin({ lido: "2026-11-07 08:00" }), /mais de 26 horas/);
  assert.doesNotMatch(fin({}), /mais de 26 horas/);
  assert.match(fin({ falha_leitura: true }), /leitura anterior/);
  assert.match(fin({ unidades: [unid("01", { erro_leitura: true })] }), /leitura de 09\/11\/2026 às 08:04/);
});

test("financeiro: arquivo sem nada não quebra", () => {
  const h = BF.htmlFinanceiro({}, {});
  assert.match(h, /Ainda sem leitura/);
  assert.match(h, /Nenhuma unidade/);
});

/* ---- Apps Script num contexto de mentira ---- */
function gs(acessos) {
  const pedidos = [], cache = {};
  const ctx = vm.createContext({
    console: { log() {}, error() {} }, pedidos,
    temAcesso_: (s, c) => (s.a || []).includes(c) || ["ADM", "MASTER"].includes(s.t),
    prop_: () => "db-fila",
    notion_: (m, c, corpo) => { if (ctx.falha) throw new Error("x"); pedidos.push(corpo); return {}; },
    CacheService: { getScriptCache: () => ({ get: k => cache[k], put: (k, v) => { cache[k] = v; } }) },
    supaCfg_: () => ({ url: "https://s", key: "k" }),
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ signedURL: "/object/sign/x" }) }) },
    acessos
  });
  vm.runInContext(readFileSync(new URL("../../apps-script/BoletosFinanceiro.gs", import.meta.url), "utf8"), ctx);
  return ctx;
}
const ID = "a".repeat(32);
const COMERCIAL = { u: "vendedor", t: "GERAL", a: ["BOLETOS E FINANCEIRO"] };
const ADM = { u: "dono", t: "ADM", a: [] };

test("gs: sem o acesso não recebe nada; ação de outro módulo passa adiante", () => {
  const c = gs();
  assert.equal(c.bfRotear_("bfBoot", { u: "x", t: "GERAL", a: [] }, {}).erro, "SEM_PERMISSAO");
  assert.equal(c.bfRotear_("outraCoisa", ADM, {}), null);
});

test("gs: comercial vê e atualiza, mas não segura", () => {
  const c = gs();
  const boot = c.bfRotear_("bfBoot", COMERCIAL, {});
  assert.equal(boot.ok, true);
  assert.equal(boot.podeSegurar, false);
  assert.equal(boot.url, "https://s/storage/v1/object/sign/x");
  assert.equal(c.bfRotear_("bfSegurar", COMERCIAL, { acao: "segurar", parcela: ID }).erro, "APENAS_ADM");
  assert.equal(c.pedidos.length, 0);
  assert.equal(c.bfRotear_("bfAtualizar", COMERCIAL, {}).ok, true);
  const p = JSON.parse(c.pedidos[0].properties.PAYLOAD.rich_text[0].text.content);
  assert.equal(p.tarefa, "MoraisEng - Robo retratos");
  assert.equal(c.pedidos[0].properties.TIPO.select.name, "robo-rodar");
});

test("gs: ADM segura; o pedido leva quem pediu; dois cliques viram um pedido", () => {
  const c = gs();
  assert.equal(c.bfRotear_("bfBoot", ADM, {}).podeSegurar, true);
  assert.equal(c.bfRotear_("bfSegurar", ADM, { acao: "segurar", parcela: ID }).ok, true);
  assert.equal(c.bfRotear_("bfSegurar", ADM, { acao: "segurar", parcela: ID }).repetido, true);
  assert.equal(c.pedidos.length, 1);
  assert.equal(c.pedidos[0].properties.TIPO.select.name, "boleto-segurar");
  assert.deepEqual(JSON.parse(c.pedidos[0].properties.PAYLOAD.rich_text[0].text.content), { acao: "segurar", parcela: ID, quem: "dono" });
});

test("gs: recusa pedido estranho; falha do Notion não vira ok", () => {
  const c = gs();
  assert.equal(c.bfRotear_("bfSegurar", ADM, { acao: "apagar", parcela: ID }).erro, "PEDIDO_INVALIDO");
  assert.equal(c.bfRotear_("bfSegurar", ADM, { acao: "segurar", parcela: "../x" }).erro, "PEDIDO_INVALIDO");
  c.falha = true;
  assert.equal(c.bfRotear_("bfSegurar", ADM, { acao: "soltar", parcela: ID }).erro, "FILA_FALHOU");
});

test("a página está ligada: início, cache offline, gancho do Apps Script e atalho no Escritório", () => {
  const ler = a => readFileSync(new URL("../../" + a, import.meta.url), "utf8");
  assert.doesNotMatch(ler("index.html"), /boletos-financeiro\.html/);
  assert.match(ler("sw.js"), /"\.\/boletos-financeiro\.html","\.\/boletos-financeiro\.js"/);
  assert.match(ler("Melhorias.gs"), /bfRotear_\(action, sess, p\)/);
  assert.doesNotMatch(ler("escritorio-robos.html"), /href="boletos-financeiro\.html"/);
  assert.match(ler("escritorio-robos.html"), /id="s-agua"[^\n]*\n\s*<button type="button" id="s-boletos"[^>]*>[^<]*Boletos e Financeiro/);
  assert.match(ler("escritorio-robos.html"), /boletos-financeiro\.html\?embutido=1/);
  assert.match(ler("escritorio-robos.html"), /boletos:\s*\{ nome: "Boletos do mês"/);
  assert.match(ler("escritorio-robos.html"), /financeiro:\s*\{ nome: "Financeiro do condomínio"/);
  assert.match(ler("escritorio-robos.html"), /if \(chave === "financeiro"\) \{ trocarSala\("boletos"\)/);
  assert.match(ler("escritorio-robos.html"), /"documentos"\]\.forEach\(pega\);\n  pega\("financeiro"\)/);
  const pagina = ler("boletos-financeiro.html");
  assert.match(pagina, /embutido/);
  assert.match(pagina, /\.embutido header\{display:none\}/);
  assert.match(pagina, /"storage"/);
  assert.match(pagina, /src="boletos-financeiro\.js/);
  assert.match(pagina, /action: "bfBoot"/);
});
