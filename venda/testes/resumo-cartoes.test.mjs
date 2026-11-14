/* 13/11/2026 — Resumo do cartão do condomínio: 5 cartões travados (financiamento, sinal pago, reserva, assinatura da
 * compra e venda, corretor com WhatsApp). Só dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
const dossie = fs.readFileSync(path.join(RAIZ, "venda-dossie.js"), "utf8");
function trecho(src, ini) {
  const i = src.indexOf(ini); assert.ok(i >= 0, "não achei " + ini);
  let p = src.indexOf("{", i), n = 0, j = p;
  for (; j < src.length; j++) { if (src[j] === "{") n++; else if (src[j] === "}" && --n === 0) break; }
  return src.slice(i, j + 1);
}
function ctxNovo(extra) {
  const els = {};
  const ctx = Object.assign({ COND: { titulo: "UNIDADE", linhas: [], colunas: [] }, COND_ABERTA: "L1", window: {},
    esc: (s) => String(s).replace(/</g, "&lt;"), console, document: { getElementById: (id) => els[id] || null }, els }, extra || {});
  vm.createContext(ctx);
  vm.runInContext([
    vendas.match(/const cdNormK=.*;/)[0], vendas.match(/const cdNorm=.*;/)[0], vendas.match(/const cdBRL=.*;/)[0],
    trecho(vendas, "function cdVal(l,nome)"), trecho(vendas, "function cdTemArq(v)"), trecho(vendas, "function cdSit(l,col)"),
    "const CD_SINAL_LIDO={};",
    trecho(vendas, "function cdDataBR(v)"), trecho(vendas, "function cdKpi(rot,b,sp,id)"),
    trecho(vendas, "function condSinalTotal(l)"), trecho(vendas, "function condSinalHtml(l)"),
    trecho(vendas, "async function condSinalLer(id)"), trecho(vendas, "function condReservaHtml(l)"),
    trecho(vendas, "function condResumoMaisHtml(l)"),
  ].join("\n"), ctx);
  return ctx;
}
const linha = (v) => ({ id: "L1", v: Object.assign({ "UNIDADE": "99" }, v) });

test("os 5 cartões entram no grid dos KPIs, depois do correspondente", () => {
  const k = trecho(vendas, "function condKpisHtml(l,fx)");
  assert.match(k, /condCorrespondenteHtml\(l\)\+\s*condResumoMaisHtml\(l\);/);
  assert.match(vendas, /VendaBlocos\.aba\(COND_ABA\); \}[^\n]*\n\s*condSinalLer\(id\);/);
  assert.match(dossie, /window\.VendaBlocos\.financeiro = function \(id\) \{ return chamarVenda\(\{ action: "financeiroEstado", pageId: id \}, 60000\); \};/);
});

test("financiamento, assinatura e corretor com WhatsApp; nada editável", () => {
  const h = ctxNovo().condResumoMaisHtml(linha({ "VALOR DO CRÉDITO": 200000, "VALOR DO FGTS": 15000,
    "DATA DE ASSINATURA DO CONTRATO": "2026-11-10", "ASSINATURA - SITUAÇÃO": "ASSINADO",
    "CORRETOR": "Fulano de Tal", "CELULAR CORRETOR": "(62) 99999-0000" }));
  assert.match(h, /<small>Financiamento<\/small><b>R\$\s?200\.000,00<\/b><span>FGTS R\$\s?15\.000,00<\/span>/);
  assert.match(h, /<small>Compra e venda<\/small><b>10\/11\/2026<\/b><span>assinado por todos<\/span>/);
  assert.match(h, /href="https:\/\/wa\.me\/5562999990000"/);
  assert.match(h, /Fulano de Tal/);
  assert.match(h, /<small>Reserva<\/small><b>Vendida<\/b>/);
  assert.doesNotMatch(h, /<select|<input|onchange/);
});

test("reserva: contrato gerado, data limite do termo, padrão de 5 dias e 'cai amanhã' pela faixa", () => {
  const c = ctxNovo();
  assert.match(c.condReservaHtml(linha({ "CONTRATO GERADO": [{ name: "x.pdf" }] })), /Contrato gerado.*não cai mais/);
  assert.match(c.condReservaHtml(linha({ "PRÉ-RESERVA - DATA LIMITE": "2026-11-20" })), /Reservada.*cai em 20\/11\/2026/);
  assert.match(c.condReservaHtml(linha({})), /Reservada.*5 dias para gerar o contrato/);
  c.window.ReservaPrazoUI = { _t: { estado: { reservas: [{ unidade: "99", quando: "amanha" }] } } };
  vm.runInContext("window=this.window;", c);
  assert.match(c.condReservaHtml(linha({})), /Cai amanhã/);
});

test("sinal: total antes de ler; depois o pago das parcelas de Sinal do retrato", async () => {
  const c = ctxNovo();
  const l = linha({ "VALOR SINAL ATO": 1000, "VALOR SINAL 30 DIAS": 1000, "VALOR SINAL 60 DIAS": 1000, "VALOR SINAL 90 DIAS": 1000 });
  c.COND.linhas.push(l);
  assert.match(c.condSinalHtml(l), /<small>Sinal<\/small><b>R\$\s?4\.000,00<\/b><span>conferindo/);
  c.window.VendaBlocos = { financeiro: async () => ({ ok: true, lancada: true, parcelas: [
    { grupo: "Sinal", valor: 1000, situacao: "paga" }, { grupo: "Sinal", valor: 1000, situacao: "paga" },
    { grupo: "Sinal", valor: 1000, situacao: "atrasada" }, { grupo: "Sinal", valor: 1000, situacao: "aberta" },
    { grupo: "Pré-chaves", valor: 9999, situacao: "paga" }] }) };
  vm.runInContext("window=this.window; VendaBlocos=this.window.VendaBlocos;", c);
  c.els["cd-kpi-sinal"] = { outerHTML: "" };
  await c.condSinalLer("L1");
  assert.match(c.els["cd-kpi-sinal"].outerHTML, /Sinal pago.*R\$\s?2\.000,00.*de R\$\s?4\.000,00 · 2 em aberto · 1 atrasada/);
});

test("sinal: venda não lançada diz isso e não inventa pago", async () => {
  const c = ctxNovo(); const l = linha({ "VALOR SINAL ATO": 500 }); c.COND.linhas.push(l);
  c.window.VendaBlocos = { financeiro: async () => ({ ok: true, lancada: false, parcelas: [] }) };
  vm.runInContext("window=this.window; VendaBlocos=this.window.VendaBlocos;", c);
  c.els["cd-kpi-sinal"] = { outerHTML: "" };
  await c.condSinalLer("L1");
  assert.match(c.els["cd-kpi-sinal"].outerHTML, /<small>Sinal<\/small>.*venda ainda não lançada no Mais Controle/);
});
