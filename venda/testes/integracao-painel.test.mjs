/* O bloco se pendura no painel do vendas.html do dono. Se ele mudar o que o
 * bloco usa, este teste avisa antes de o bloco sumir em silêncio. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
const app = fs.readFileSync(path.join(RAIZ, "app.js"), "utf8");

test("vendas.html ainda tem o painel, a casa aberta e o recarregar", () => {
  assert.match(vendas, /id="pn-body"/);
  assert.match(vendas, /let OBRA_ABERTA\s*=/);
  assert.match(vendas, /async function abrirObra\(pageId\)/);
});
test("app.js ainda tem sessao() com o token", () => {
  assert.match(app, /function sessao\(\)/);
});
test("vendas.html carrega o venda-dossie.js depois do app.js", () => {
  const iApp = vendas.indexOf('src="app.js'), iDossie = vendas.indexOf('src="venda-dossie.js');
  assert.ok(iApp > 0 && iDossie > iApp);
});
test("abrirObra ainda marca o painel como carregando com um único filho .vazio contendo .load", () => {
  // é este placeholder, e só ele, que venda-dossie.js espera para saber que o painel ainda está carregando
  assert.match(vendas, /body\.innerHTML\s*=\s*['"]<div class="vazio"><span class="load"><\/span> Carregando…<\/div>['"]/);
});
