/* 30/10: histórico do contrato (LogContratoVenda.js) — quem fez o quê e quando. Só dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const L = createRequire(import.meta.url)("../LogContratoVenda.js");

test("linha: só ação que grava e deu certo; quem e quando na frente", () => {
  assert.equal(L.linha("salvarFluxo", { motivo: "cliente pediu mais um balão" }, { ok: true }, "ana.teste", "30/10/2026 19:21"),
    "30/10/2026 19:21 — ana.teste — alterou o fluxo de pagamento: cliente pediu mais um balão");
  assert.equal(L.linha("salvarFluxo", { motivo: "x" }, { ok: false }, "ana.teste", "agora"), "");
  assert.equal(L.linha("contratoEstado", {}, { ok: true }, "ana.teste", "agora"), "");
  assert.match(L.linha("salvarCondicoesEspeciais", { texto: "" }, { ok: true }, "b", "t"), /apagou as condições especiais/);
  assert.match(L.linha("assinaturaCancelar", { doc: "PRE_RESERVA" }, { ok: true }, "b", "t"), /cancelou o envelope do termo de pré-reserva/);
  assert.match(L.linha("salvarCamposContrato", { campos: { CRECI: "1", "CPF/CNPJ": "2" } }, { ok: true }, "b", "t"), /preencheu campos do contrato: CRECI, CPF\/CNPJ/);
});

test("juntar: a mais nova em cima; passando do limite caem as mais antigas", () => {
  const s = L.juntar(L.juntar("", "linha 1"), "linha 2");
  assert.deepEqual(L.ler(s), ["linha 2", "linha 1"]);
  let t = "";
  for (let i = 0; i < 500; i++) t = L.juntar(t, "x".repeat(100) + i);
  assert.ok(t.length <= L.MAX);
  assert.match(L.ler(t)[0], /499$/);
});

test("assinaturaCancelar: o texto do histórico segue o que o servidor fez (descartou, só atualizou, cancelou)", () => {
  const l = (p, r) => L.linha("assinaturaCancelar", p, r, "b", "t");
  assert.match(l({ descartar: true }, { ok: true, descartou: true }), /descartou o rascunho do envelope do contrato na Clicksign/);
  assert.doesNotMatch(l({ descartar: true }, { ok: true, descartou: true }), /cancelou/);
  const so = l({ descartar: true }, { ok: true, descartou: false, cancelou: undefined });
  assert.match(so, /atualizou a situação \(o envelope já estava com os signatários; nada foi descartado\)/);
  assert.doesNotMatch(so, /cancelou/);
  assert.match(l({ doc: "PRE_RESERVA", descartar: true }, { ok: true, descartou: true }), /descartou o rascunho do envelope do termo de pré-reserva/);
  assert.match(l({}, { ok: true, cancelou: true }), /cancelou o envelope do contrato na Clicksign/);
  assert.match(l({ doc: "PRE_RESERVA" }, { ok: true }), /cancelou o envelope do termo de pré-reserva/);
});
