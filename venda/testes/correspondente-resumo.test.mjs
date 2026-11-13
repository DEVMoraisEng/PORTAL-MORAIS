/* 13/11/2026 — CORRESPONDENTE na aba Resumo do cartão da Planilha Casas Condomínio (vendas.html).
 * Lista com as opções da coluna select, salva pelo caminho do Andamento, só leitura vê o nome.
 * Só dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
function trecho(src, ini) {
  const i = src.indexOf(ini); assert.ok(i >= 0, "não achei " + ini);
  let p = src.indexOf("{", i), n = 0, j = p;
  for (; j < src.length; j++) { if (src[j] === "{") n++; else if (src[j] === "}" && --n === 0) break; }
  return src.slice(i, j + 1);
}
function ctxNovo(colunas, extra) {
  const ctx = Object.assign({ SO_LEITURA: false, COND: { titulo: "UNIDADE", linhas: [], colunas },
    esc: (s) => String(s).replace(/</g, "&lt;"), console }, extra || {});
  vm.createContext(ctx);
  vm.runInContext([
    vendas.match(/const cdNormK=.*;/)[0],
    vendas.match(/const cdNorm=.*;/)[0],
    trecho(vendas, "function cdVal(l,nome)"),
    trecho(vendas, "function condCorrespondenteCol()"), trecho(vendas, "function condCorrespondenteHtml(l)"),
  ].join("\n"), ctx);
  return ctx;
}
const COL = [{ nome: "CORRESPONDENTE", tipo: "select", opcoes: ["ALFA CRED", "BETA"] }];
const linha = (v) => ({ id: "L1", v: Object.assign({ "UNIDADE": "99" }, v) });

test("o cartão põe o correspondente na aba Resumo", () => {
  const resumo = vendas.slice(vendas.indexOf("'<div data-sec=\"resumo\">'+"), vendas.indexOf("condLinkVendaHtml(l)+"));
  assert.match(resumo, /condCorrespondenteHtml\(l\)\+/);
});

test("lista com as opções da coluna, valor atual marcado, salva pelo Andamento", () => {
  const h = ctxNovo(COL).condCorrespondenteHtml(linha({ CORRESPONDENTE: "BETA" }));
  assert.match(h, /<select id="cd-corr"/);
  assert.match(h, /<option selected>BETA<\/option>/);
  assert.match(h, /<option>ALFA CRED<\/option>/);
  assert.match(h, /condAndSalvar\(COND_ABERTA,condCorrespondenteCol\(\)\.nome,this\.value,'cd-corr-st'\)/);
  assert.match(h, /data-and-key="L1\|CORRESPONDENTE"/);
  assert.match(h, /data-and-st="L1\|CORRESPONDENTE"/);
});

test("valor fora da lista continua aparecendo", () => {
  const h = ctxNovo(COL).condCorrespondenteHtml(linha({ CORRESPONDENTE: "GAMA" }));
  assert.match(h, /<option selected>GAMA<\/option>/);
});

test("só leitura vê o nome; sem a coluna não aparece", () => {
  const ctx = ctxNovo(COL); ctx.SO_LEITURA = true;
  const h = ctx.condCorrespondenteHtml(linha({ CORRESPONDENTE: "BETA" }));
  assert.doesNotMatch(h, /<select/); assert.match(h, /<b>BETA<\/b>/);
  assert.equal(ctxNovo([]).condCorrespondenteHtml(linha({})), "");
});

test("o Andamento continua sem o correspondente (não fica em dois lugares)", () => {
  assert.match(vendas, /const CD_AND_FORA=.*CORRESPONDENTE\/i;/);
});
