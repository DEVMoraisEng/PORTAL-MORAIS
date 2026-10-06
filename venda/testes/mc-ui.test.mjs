/* Bloco "Mais Controle" da tela (htmlMC). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const D = createRequire(import.meta.url)("../../venda-dossie.js");
const ui = (x = {}) => Object.assign({ ocupado: null, msg: "", testes: false }, x);
const botao = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>')) || [null])[0];

test("sem estado: carregando", () => {
  assert.match(D.htmlMC(null, ui()), /carregando/);
});

test("nunca lançada: prévia liberada, lançar travado", () => {
  const h = D.htmlMC({ situacao: "", vendaId: "" }, ui());
  assert.match(h, /ainda não lançada/);
  assert.doesNotMatch(botao(h, "mc-previa"), /disabled/);
  assert.match(botao(h, "mc-lancar"), /disabled/);
});

test("PRÉVIA OK libera o lançar", () => {
  const h = D.htmlMC({ situacao: "PRÉVIA OK — cliente já existe", vendaId: "" }, ui());
  assert.doesNotMatch(botao(h, "mc-lancar"), /disabled/);
});

test("processando trava os dois e avisa; atualizar continua", () => {
  const h = D.htmlMC({ situacao: "PROCESSANDO (prévia) — 06/10", vendaId: "" }, ui());
  assert.match(botao(h, "mc-previa"), /disabled/);
  assert.match(botao(h, "mc-lancar"), /disabled/);
  assert.doesNotMatch(botao(h, "mc-atualizar"), /disabled/);
  assert.match(h, /robô está trabalhando/);
});

test("lançada: mostra o id e some com prévia/lançar", () => {
  const h = D.htmlMC({ situacao: "CRIADA no Mais Controle", vendaId: "v-1" }, ui());
  assert.match(h, /Venda no Mais Controle: v-1/);
  assert.equal(botao(h, "mc-previa"), null);
  assert.equal(botao(h, "mc-lancar"), null);
});

test("perfil TESTES não aciona; texto escapado", () => {
  const h = D.htmlMC({ situacao: "PRÉVIA OK <b>x</b>", vendaId: "" }, ui({ testes: true }));
  assert.match(botao(h, "mc-previa"), /disabled/);
  assert.match(h, /&lt;b&gt;x/);
});

test("mensagens por código", () => {
  assert.match(D.mensagemMC({ erro: "MC_SEM_PREVIA" }), /prévia primeiro/);
  assert.match(D.mensagemMC({ erro: "MC_NAO_CONFIGURADO" }), /não está configurado/);
});
