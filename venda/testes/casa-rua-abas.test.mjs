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
