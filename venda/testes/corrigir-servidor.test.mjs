/* Corrigir aqui (#43), aba Financeiro (#45) e vigia de assinaturas (#44) no PORTAL-VENDA falso: Apps Script em vm
 * e Notion em memória (fakes.mjs). Linha do condomínio inventada. 31/10/2026. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { criarGas, assinar, notionFalso, PAGE_ID_PADRAO, COLUNAS_REAIS } from "./fakes.mjs";
const CV = createRequire(import.meta.url)("../ContratoVenda.js");

const VENDA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = PAGE_ID_PADRAO, DB_COND = "db-cond";
const PROPS = { NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: "db-vendas", DB_VENDAS_COND: DB_COND };
const token = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + 86400000 });
const rt = (s) => ({ rich_text: [{ plain_text: s, text: { content: s } }] });
const COLS = { ...COLUNAS_REAIS,
  "UNIDADE": "title", "PROPONENTE": "rich_text", "CPF PROPONENTE": "rich_text", "RG PROPONENTE": "rich_text",
  "COMPRADOR 1": "rich_text", "CPF COMPRADOR 1": "rich_text", "RG COMPRADOR 1": "rich_text",
  "ESTADO CIVIL": { tipo: "select", opcoes: ["SOLTEIRO(A)", "CASADO(A)"] },
  "ENDEREÇO": "rich_text", "NÚMERO": "rich_text", "SETOR": "rich_text", "CIDADE": "rich_text", "CEP": "rich_text",
  "FIADOR 1": "rich_text", "CPF FIADOR 1": "rich_text",
  /* 01/11: bloco Fiadores — e-mail como email, estado civil do fiador 2 como select, REGIME como select */
  "EMAIL FIADOR 1": "email", "ESTADO CIVIL FIADOR 1": "rich_text", "CONJUGE FIADOR 1": "rich_text", "CPF CONJUGE FIADOR 1": "rich_text", "EMAIL CONJUGE FIADOR 1": "email",
  "FIADOR 2": "rich_text", "CPF FIADOR 2": "rich_text", "EMAIL FIADOR 2": "email", "ESTADO CIVIL FIADOR 2": { tipo: "select", opcoes: ["SOLTEIRO", "CASADO"] },
  "CONJUGE FIADOR 2": "rich_text", "CPF CONJUGE FIADOR 2": "rich_text", "EMAIL CONJUGE FIADOR 2": "email",
  "CONJUGE": "rich_text", "CPF CONJUGE": "rich_text", "EMAIL CONJUGE": "email", "REGIME": { tipo: "select", opcoes: ["COMUNHÃO PARCIAL DE BENS", "SEPARAÇÃO TOTAL DE BENS"] },
  "MC - SITUAÇÃO": "rich_text", "MC - VENDA ID": "rich_text"
};
function montar(valores = {}, extrasGs = [], dbId = DB_COND) {
  const n = notionFalso({ colunas: COLS, dbId, valores });
  const g = criarGas({ props: PROPS, rotas: (url, opt) => n.rota(url, opt) });
  for (const f of extrasGs) vm.runInContext(fs.readFileSync(path.join(VENDA, f), "utf8"), g.ctx, { filename: f });
  return { n, g };
}
const BASE = { "PROPONENTE": rt("FULANA TESTE"), "CPF PROPONENTE": rt("111.444.777-35"), "ENDEREÇO": rt("Rua Teste") };

test("corrigirConferenciaCampos: abre a coluna certa com o valor atual; select traz as opções da base", () => {
  const { g } = montar(BASE);
  let r = g.chamar({ action: "corrigirConferenciaCampos", token: token(), pageId: PAGE, item: "c1-id", campo: "nome" });
  assert.deepEqual(r, { ok: true, campos: [{ coluna: "PROPONENTE", rotulo: "Nome", valor: "FULANA TESTE", opcoes: null }] });
  r = g.chamar({ action: "corrigirConferenciaCampos", token: token(), pageId: PAGE, item: "c1-civil", campo: "estado_civil" });
  assert.deepEqual(r.campos[0].opcoes, ["SOLTEIRO(A)", "CASADO(A)"]);
  r = g.chamar({ action: "corrigirConferenciaCampos", token: token(), pageId: PAGE, item: "c1-end", campo: "endereco" });
  assert.deepEqual(r.campos.map((x) => x.coluna), ["ENDEREÇO", "NÚMERO", "SETOR", "CIDADE", "CEP"]);
  assert.equal(g.chamar({ action: "corrigirConferenciaCampos", token: token(), pageId: PAGE, item: "c2-id", campo: "nome" }).erro, "NAO_CORRIGE_AQUI");
});

test("corrigirConferencia: grava só a coluna da regra; CPF inválido recusa; coluna fora da regra é ignorada; TESTES não grava", () => {
  const { n, g } = montar(BASE);
  let r = g.chamar({ action: "corrigirConferencia", token: token(), pageId: PAGE, item: "c1-id", campo: "nome",
                     valores: { "PROPONENTE": "FULANA DE TESTE", "MC - VENDA ID": "invasor" } });
  assert.deepEqual(r, { ok: true, mudou: ["PROPONENTE"] });
  assert.deepEqual(Object.keys(n.patches[0]), ["PROPONENTE"]);
  assert.equal(n.pagina.properties["PROPONENTE"].rich_text[0].plain_text, "FULANA DE TESTE");
  assert.equal(g.chamar({ action: "corrigirConferencia", token: token(), pageId: PAGE, item: "c1-id", campo: "cpf",
                          valores: { "CPF PROPONENTE": "111.444.777-00" } }).erro, "CPF_INVALIDO");
  r = g.chamar({ action: "corrigirConferencia", token: token(), pageId: PAGE, item: "c1-id", campo: "cpf", valores: { "CPF PROPONENTE": "52998224725" } });
  assert.equal(n.pagina.properties["CPF PROPONENTE"].rich_text[0].plain_text, "529.982.247-25");
  r = g.chamar({ action: "corrigirConferencia", token: token(), pageId: PAGE, item: "c1-civil", campo: "estado_civil", valores: { "ESTADO CIVIL": "CASADO(A)" } });
  assert.equal(n.pagina.properties["ESTADO CIVIL"].select.name, "CASADO(A)");
  const antes = n.patches.length;
  assert.equal(g.chamar({ action: "corrigirConferencia", token: token("TESTES"), pageId: PAGE, item: "c1-id", campo: "nome",
                          valores: { "PROPONENTE": "X" } }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(n.patches.length, antes);
});

test("financeiroEstado: não lançada, lançada sem retrato e com retrato (da antecipação)", () => {
  let { g } = montar(BASE, ["FinanceiroVenda.gs"]);
  assert.deepEqual(g.chamar({ action: "financeiroEstado", token: token(), pageId: PAGE }), { ok: true, lancada: false, parcelas: [] });
  ({ g } = montar(Object.assign({ "MC - VENDA ID": rt("venda-erp-1") }, BASE), ["FinanceiroVenda.gs"]));
  const r = g.chamar({ action: "financeiroEstado", token: token(), pageId: PAGE });
  assert.equal(r.lancada, true); assert.equal(r.semLeitura, true); assert.deepEqual(r.parcelas, []);
  vm.runInContext('function antecipacaoRetrato_(id) { return { lidoEm: "2026-11-03 05:30", parcelas: [{ grupo: "Balão", numero: 1, de: 2, situacao: "aberta" }] }; }', g.ctx);
  const r2 = g.chamar({ action: "financeiroEstado", token: token(), pageId: PAGE });
  assert.equal(r2.lidoEm, "2026-11-03 05:30"); assert.equal(r2.parcelas.length, 1); assert.equal(r2.semLeitura, undefined);
});

test("vigia: marca o Andamento só quando o contrato fica ASSINADO e só com a coluna existente", () => {
  const { n, g } = montar(BASE, ["AssinaturaVigia.gs", "FinanceiroVenda.gs"]);
  const pg = { id: PAGE, properties: { "ASSINOU E ARMAZENOU CONTRATO": { type: "select", select: { name: "NÃO" } } } };
  n.db.properties["ASSINOU E ARMAZENOU CONTRATO"] = { type: "select", select: { options: [{ name: "SIM" }, { name: "NÃO" }] } };
  n.pagina.properties["ASSINOU E ARMAZENOU CONTRATO"] = { type: "select", select: { name: "NÃO" } };
  g.ctx.vigiaMarcarAndamento_(pg);
  assert.equal(n.pagina.properties["ASSINOU E ARMAZENOU CONTRATO"].select.name, "SIM");
  const antes = n.patches.length;
  g.ctx.vigiaMarcarAndamento_({ id: PAGE, properties: { "ASSINOU E ARMAZENOU CONTRATO": { type: "select", select: { name: "SIM" } } } });
  g.ctx.vigiaMarcarAndamento_({ id: PAGE, properties: {} });
  assert.equal(n.patches.length, antes);
});

/* ---- 01/11/2026 (teste e2e): bloco Fiadores na aba Contrato — salvarFiadores e conjugeEhFiador2 ---- */
const txtDe = (n, col) => { const p = n.pagina.properties[col]; return p.type === "email" ? p.email || "" : p.type === "select" ? (p.select ? p.select.name : "") : (p.rich_text || []).map((t) => t.plain_text).join(""); };

test("salvarFiadores: grava só as colunas da lista com o tipo da base; CPF formatado; responde as colunas gravadas", () => {
  const { n, g } = montar(BASE);
  const r = g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE,
    valores: { "FIADOR 2": "FIADORA TESTE", "CPF FIADOR 2": "52998224725", "EMAIL FIADOR 2": "F2@Teste.Example", "ESTADO CIVIL FIADOR 2": "casado" } });
  assert.deepEqual(r, { ok: true, gravou: ["FIADOR 2", "CPF FIADOR 2", "EMAIL FIADOR 2", "ESTADO CIVIL FIADOR 2"] });
  assert.equal(txtDe(n, "CPF FIADOR 2"), "529.982.247-25");
  assert.equal(n.pagina.properties["EMAIL FIADOR 2"].email, "f2@teste.example");
  assert.equal(n.pagina.properties["ESTADO CIVIL FIADOR 2"].select.name, "CASADO", "select: a opção da base");
  assert.deepEqual(Object.keys(n.patches[0]).sort(), ["CPF FIADOR 2", "EMAIL FIADOR 2", "ESTADO CIVIL FIADOR 2", "FIADOR 2"]);
  /* o mesmo valor de novo: nada a gravar */
  const antes = n.patches.length;
  assert.deepEqual(g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE, valores: { "FIADOR 2": "FIADORA TESTE" } }), { ok: true, gravou: [] });
  assert.equal(n.patches.filter((p) => "FIADOR 2" in p).length, 1, "nenhum PATCH novo da coluna");
  assert.ok(n.patches.length >= antes);
});

test("(c)(d) salvarFiadores: coluna fora da lista e CPF inválido recusam e nada é gravado; select fora das opções também", () => {
  const { n, g } = montar(BASE);
  let r = g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE, valores: { "FIADOR 1": "FIADOR TESTE", "MC - VENDA ID": "invasor" } });
  assert.equal(r.erro, "COLUNA_NAO_PERMITIDA");
  r = g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE, valores: { "FIADOR 1": "FIADOR TESTE", "CPF FIADOR 1": "111.444.777-00" } });
  assert.equal(r.erro, "CPF_INVALIDO");
  r = g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE, valores: { "ESTADO CIVIL FIADOR 2": "NAMORANDO" } });
  assert.equal(r.erro, "OPCAO_INVALIDA");
  assert.equal(n.patches.length, 0);
});

test("(e)(f) salvarFiadores: página de outra base e perfil TESTES não gravam", () => {
  const outra = montar(BASE, [], "db-de-outra-base");
  assert.equal(outra.g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE, valores: { "FIADOR 1": "FIADOR TESTE" } }).erro, "PAGINA_DE_OUTRA_BASE");
  assert.equal(outra.g.chamar({ action: "conjugeEhFiador2", token: token(), pageId: PAGE }).erro, "PAGINA_DE_OUTRA_BASE");
  assert.equal(outra.n.patches.length, 0);
  const { n, g } = montar(BASE);
  assert.equal(g.chamar({ action: "salvarFiadores", token: token("TESTES"), pageId: PAGE, valores: { "FIADOR 1": "FIADOR TESTE" } }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(g.chamar({ action: "conjugeEhFiador2", token: token("TESTES"), pageId: PAGE }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(n.patches.length, 0);
});

test("salvarFiadores: cônjuge do comprador (CONJUGE, CPF CONJUGE, EMAIL CONJUGE, REGIME) e a falta some", () => {
  const casado = Object.assign({}, BASE, { "ESTADO CIVIL": { select: { name: "CASADO(A)" } }, "CONJUGE": rt("CONJUGE TESTE") });
  const { n, g } = montar(casado);
  const r = g.chamar({ action: "salvarFiadores", token: token(), pageId: PAGE,
    valores: { "CPF CONJUGE": "111.444.777-35", "REGIME": "comunhão parcial de bens", "EMAIL CONJUGE": "conj@teste.example" } });
  assert.deepEqual(r, { ok: true, gravou: ["CPF CONJUGE", "REGIME", "EMAIL CONJUGE"] });
  assert.equal(n.pagina.properties["REGIME"].select.name, "COMUNHÃO PARCIAL DE BENS");
  /* o que o gerador lê da linha (ctrDadosCondominio_) já não dá falta de cônjuge */
  const c = g.ctx.ctrDadosCondominio_(g.ctx.ctrPorChave_(n.pagina.properties)).condominio;
  const d = { comprador1: { nome: "FULANA TESTE" }, comprador2: null, condominio: CV.montarCondominio(Object.assign({}, c, { fluxo: {} })) };
  assert.equal(d.condominio.conjugeComprador.regime, "comunhão parcial de bens");
  assert.deepEqual(CV.faltasContrato(d).filter((f) => /^Cônjuge/.test(f)), []);
});

test("(g) conjugeEhFiador2: copia o cônjuge do Fiador 1 para o Fiador 2 e o #74 deixa de faltar", () => {
  const linha = Object.assign({}, BASE, { "FIADOR 1": rt("FIADOR TESTE"), "CPF FIADOR 1": rt("111.444.777-35"), "EMAIL FIADOR 1": { email: "f1@teste.example" },
    "ESTADO CIVIL FIADOR 1": rt("CASADO"), "CONJUGE FIADOR 1": rt("FIADORA TESTE"), "CPF CONJUGE FIADOR 1": rt("52998224725"), "EMAIL CONJUGE FIADOR 1": { email: "f2@teste.example" } });
  const { n, g } = montar(linha);
  const r = g.chamar({ action: "conjugeEhFiador2", token: token(), pageId: PAGE });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.gravou.slice().sort(), ["CONJUGE FIADOR 2", "CPF CONJUGE FIADOR 1", "CPF CONJUGE FIADOR 2", "CPF FIADOR 2", "EMAIL CONJUGE FIADOR 2", "EMAIL FIADOR 2", "ESTADO CIVIL FIADOR 2", "FIADOR 2"]);
  assert.equal(txtDe(n, "FIADOR 2"), "FIADORA TESTE");
  assert.equal(txtDe(n, "CPF FIADOR 2"), "529.982.247-25");
  assert.equal(txtDe(n, "ESTADO CIVIL FIADOR 2"), "CASADO");
  assert.equal(txtDe(n, "CPF CONJUGE FIADOR 2"), "111.444.777-35");
  const fi = (i) => ({ nome: txtDe(n, "FIADOR " + i), cpf: txtDe(n, "CPF FIADOR " + i), email: txtDe(n, "EMAIL FIADOR " + i), estadoCivil: txtDe(n, "ESTADO CIVIL FIADOR " + i),
                      conjugeNome: txtDe(n, "CONJUGE FIADOR " + i), conjugeCpf: txtDe(n, "CPF CONJUGE FIADOR " + i), conjugeEmail: txtDe(n, "EMAIL CONJUGE FIADOR " + i) });
  const co = CV.montarCondominio({ nome: "CONDOMÍNIO TESTE", unidade: "1", fiadores: [fi(1), fi(2)],
    fluxo: { valorVenda: 300000, posN: 10, posValor: 1000, posData: "2029-01-10", prazoEntrada: 36 } });
  assert.deepEqual(CV.faltasConjugeFiadores(co), []);
  /* sem o cônjuge do fiador 1 preenchido: recusa, nada gravado */
  const sem = montar(Object.assign({}, linha, { "CPF CONJUGE FIADOR 1": rt("") }));
  assert.equal(sem.g.chamar({ action: "conjugeEhFiador2", token: token(), pageId: PAGE }).erro, "CONJUGE_FIADOR_1_INCOMPLETO");
  assert.equal(sem.n.patches.length, 0);
});

test("fiaEstado_: o bloco da tela com o tipo e as opções da base; coluna que a base não tem sai do bloco", () => {
  const { n, g } = montar(BASE);
  const pg = { parent: n.pagina.parent, properties: {}, propsCondominio: n.pagina.properties };
  const b = g.ctx.fiaEstado_(pg, ["Fiador 2: CPF", "Cônjuge do comprador 1: regime de bens"]);
  assert.equal(b.titulo, "Fiadores e cônjuge");
  const civil2 = b.fiadores[1].campos.find((c) => c.coluna === "ESTADO CIVIL FIADOR 2");
  assert.deepEqual([...civil2.opcoes], ["SOLTEIRO", "CASADO"], "select: as opções da base");
  assert.deepEqual([...b.conjuge.campos.find((c) => c.coluna === "REGIME").opcoes], ["COMUNHÃO PARCIAL DE BENS", "SEPARAÇÃO TOTAL DE BENS"]);
  delete n.pagina.properties["EMAIL CONJUGE FIADOR 2"];
  const b2 = g.ctx.fiaEstado_(pg, ["Fiador 2: CPF"]);
  assert.ok(!b2.fiadores[1].campos.some((c) => c.coluna === "EMAIL CONJUGE FIADOR 2"));
  assert.match(b2.semColuna.join(), /EMAIL CONJUGE FIADOR 2/);
  assert.equal(g.ctx.fiaEstado_(pg, []), null, "nada a mostrar");
});
