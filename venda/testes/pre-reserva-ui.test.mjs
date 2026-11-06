/* 06/11/2026 (dono): termo de pré-reserva na pergunta do Reservar — campos e mensagens da tela. Só dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");

const ui = (x = {}) => Object.assign({ msg: "", faltas: null, ocupado: null, testes: false }, x);
const campo = (h, k) => (h.match(new RegExp('<input[^>]*data-pr-p="' + k + '"[^>]*>')) || [""])[0];

test("sugestão da data limite = hoje + 5 dias corridos (São Paulo)", () => {
  const s = D.sugestaoLimitePR();
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  assert.equal((Date.parse(s) - Date.parse(hoje)) / 864e5, 5);
});

test("pergunta do Reservar: três campos, data limite sugerida, pagamento hoje, Gerar termo e Agora não", () => {
  const h = D.htmlPreReservaRapida({ valor: null, dataPagamento: "", dataLimiteDigitada: "" }, ui());
  assert.match(campo(h, "valor"), /value=""/);
  assert.match(campo(h, "data"), /max="\d{4}-\d{2}-\d{2}"/);
  assert.match(campo(h, "limite"), new RegExp('value="' + D.sugestaoLimitePR() + '"'));
  assert.match(campo(h, "limite"), /min="\d{4}-\d{2}-\d{2}"/);
  assert.match(h, /data-acao="pr-rapido-gerar"[^>]*>Gerar termo</);
  assert.match(h, /data-acao="pr-rapido-fechar"[^>]*>Agora não</);
  assert.match(h, /reserva cai sozinha/);
});

test("pergunta do Reservar: data limite já gravada vale; ocupado trava tudo", () => {
  const h = D.htmlPreReservaRapida({ valor: 3000, dataPagamento: "2026-11-06", dataLimiteDigitada: "2026-11-20" }, ui({ ocupado: "rapido" }));
  assert.match(campo(h, "limite"), /value="2026-11-20"/);
  assert.match(campo(h, "data"), /value="2026-11-06"/);
  assert.match(h, /salvando e gerando o termo/);
  assert.match(h.match(/<button[^>]*pr-rapido-gerar[^>]*>/)[0], /disabled/);
});

/* o cartão inteiro (htmlPreReserva) usa listas de bancos que só existem no navegador; aqui confere a regra no código */
test("cartão: data limite gravada é o prazo; termo antigo sem ela não ganha sugestão", () => {
  const fs = require("node:fs"), src = fs.readFileSync(new URL("../../venda-dossie.js", import.meta.url), "utf8");
  assert.match(src, /limite: e\.dataLimiteDigitada \|\| \(e\.gerado \? "" : sugestaoLimitePR\(\)\)/);
  assert.match(src, /"O termo garante a unidade até "/);
  assert.match(src, /termo de antes da data limite/);
  assert.match(src, /limite: pd\.limite \|\| ""/);
});

test("mensagens da data limite", () => {
  assert.match(D.mensagemPR({ erro: "PR_LIMITE_PASSADA" }), /antes de hoje/);
  assert.match(D.mensagemPR({ erro: "PR_LIMITE_INVALIDA" }), /data limite/);
  assert.match(D.mensagemPR({ erro: "PR_LIMITE_ANTES_DO_PAGAMENTO" }), /antes da data do pagamento/);
});
