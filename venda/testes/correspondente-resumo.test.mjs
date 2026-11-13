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

test("o correspondente é o 3º cartão, depois de Valor de venda e Comissão", () => {
  const k = trecho(vendas, "function condKpisHtml(l,fx)");
  assert.match(k, /<small>Comissão<\/small>'\+com\+'<\/div>'\+\s*condCorrespondenteHtml\(l\);/);
  const resumo = vendas.slice(vendas.indexOf("'<div data-sec=\"resumo\">'+"), vendas.indexOf("condLinkVendaHtml(l)+"));
  assert.doesNotMatch(resumo, /condCorrespondenteHtml/, "não aparece duas vezes");
});

test("travado: mostra o nome, sem lista e sem salvar", () => {
  const h = ctxNovo(COL).condCorrespondenteHtml(linha({ CORRESPONDENTE: "BETA" }));
  assert.equal(h, '<div class="cd-kpi"><small>Correspondente</small><b>BETA</b></div>');
  assert.doesNotMatch(h, /<select|condAndSalvar/);
});

test("vazio mostra traço e avisa; sem a coluna não aparece", () => {
  const h = ctxNovo(COL).condCorrespondenteHtml(linha({}));
  assert.match(h, /<b>—<\/b><span>não veio da proposta<\/span>/);
  assert.equal(ctxNovo([]).condCorrespondenteHtml(linha({})), "");
});

test("o Andamento continua sem o correspondente (não fica em dois lugares)", () => {
  assert.match(vendas, /const CD_AND_FORA=.*CORRESPONDENTE\/i;/);
});
