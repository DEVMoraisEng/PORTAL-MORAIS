/* 26/11/2026 (financeiro): "gerei a reserva mas o cliente não pagou" — o ✕ da linha "Reserva (paga)" do Alterar fluxo
   tira a reserva: a linha sai e o valor volta para a 1ª parcela do sinal; o total do fluxo não muda. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");

const soma = (ls) => Math.round(ls.reduce((s, l) => s + l.v * l.n, 0) * 100);
const f = { valor: 305000, entrega: "2028-11-30", linhas: [
  { t: "prereserva", v: 1000, n: 1, d: "2026-11-25", i: 1, x: "" },
  { t: "sinal", v: 9000, n: 1, d: "2026-11-26", i: 1, x: "" },
  { t: "pre", v: 715.68, n: 10, d: "2027-01-20", i: 1, x: "" },
  { t: "fin", v: 244800, n: 1, d: "", i: 1, x: "" }] };

test("reserva não paga: a linha sai e os R$ 1.000 voltam para o sinal, que fica com R$ 10.000 na mesma data", () => {
  const r = F.reservaNoFluxo(f, { valor: 0, data: "" }, { hoje: "2026-11-26" });
  assert.equal(r.erro, undefined);
  assert.equal(r.linhas.filter((l) => l.t === "prereserva").length, 0);
  assert.deepEqual(r.linhas.filter((l) => l.t === "sinal").map((l) => [l.v, l.d]), [[10000, "2026-11-26"]]);
  assert.equal(soma(r.linhas), soma(f.linhas));
  assert.ok(r.mudou.some((m) => /reserva de R\$ 1\.000,00 não paga/.test(m)), JSON.stringify(r.mudou));
});

test("reserva não paga sem sinal no fluxo: o valor vira uma parcela de sinal", () => {
  const g = { ...f, linhas: f.linhas.filter((l) => l.t !== "sinal") };
  const r = F.reservaNoFluxo(g, { valor: 0, data: "" }, { assinatura: "2026-11-26", hoje: "2026-11-26" });
  assert.deepEqual(r.linhas.filter((l) => l.t === "sinal").map((l) => [l.v, l.d]), [[1000, "2026-11-26"]]);
  assert.equal(soma(r.linhas), soma(g.linhas));
});

test("reserva que tinha engolido o ato inteiro: o valor volta como o ato, na data da assinatura", () => {
  const g = { ...f, linhas: [{ t: "prereserva", v: 1000, n: 1, d: "2026-11-20", i: 1, x: "" },
    { t: "sinal", v: 3000, n: 1, d: "2026-12-26", i: 1, x: "" }, ...f.linhas.slice(2)] };
  const r = F.reservaNoFluxo(g, { valor: 0, data: "" }, { assinatura: "2026-11-26", hoje: "2026-11-26" });
  assert.deepEqual(r.linhas.filter((l) => l.t === "sinal").map((l) => [l.v, l.d]), [[1000, "2026-11-26"], [3000, "2026-12-26"]]);
  assert.equal(soma(r.linhas), soma(g.linhas));
});
