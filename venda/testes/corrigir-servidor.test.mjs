/* Corrigir aqui (#43), aba Financeiro (#45) e vigia de assinaturas (#44) no PORTAL-VENDA falso: Apps Script em vm
 * e Notion em memória (fakes.mjs). Linha do condomínio inventada. 31/10/2026. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { criarGas, assinar, notionFalso, PAGE_ID_PADRAO, COLUNAS_REAIS } from "./fakes.mjs";

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
  "MC - SITUAÇÃO": "rich_text", "MC - VENDA ID": "rich_text"
};
function montar(valores = {}, extrasGs = []) {
  const n = notionFalso({ colunas: COLS, dbId: DB_COND, valores });
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
