/* 31/10/2026: casa 17 — o cliente passa de 24x para 36x pelo Alterar fluxo (FluxoLivre.mudarPrazo) e a comissão do
   contrato segue o prazo novo sozinha (ContratoVenda.planoDoFluxo, PR #35). Valores inventados no formato da casa 17. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");
const C = require("../ContratoVenda.js");

const valor = 96511.27 + 244800 + 8688.73;
const casa24 = { valor, entrega: "2028-11-30", linhas: [
  { t: "sinal", v: 1000, n: 1, d: "2026-10-31", i: 1 }, { t: "sinal", v: 29000, n: 1, d: "2026-11-10", i: 1 },
  { t: "pre", v: 1828.63, n: 12, d: "2026-11-10", i: 1 }, { t: "pre", v: 701.69, n: 12, d: "2027-11-10", i: 1 },
  { t: "balao", v: 21263.19, n: 1, d: "2027-12-10", i: 1 }, { t: "balao", v: 14884.24, n: 1, d: "2028-11-10", i: 1 },
  { t: "fin", v: 244800, n: 1, d: "", i: 1 }, { t: "fgts", v: 8688.73, n: 1, d: "", i: 1 }] };
const fluxo = { assinatura: "2026-10-31", diaPagamento: 10, entrega: "2028-11-30", valorVenda: valor, prazoEntrada: 24,
                balao2Data: "2028-11-10", credito: 244800, fgts: 8688.73 };

test("casa 17: 24x → 36x no Alterar fluxo muda a comissão do contrato para 4,75%; voltar a 24x devolve 5%", () => {
  const v24 = C.valoresCondominio({ fluxo, livre: casa24, valorParaEntrada: 0 });
  assert.deepEqual([v24.plano, v24.pctRegra], [24, 0.05]);
  const l36 = F.mudarPrazo(casa24, 36).linhas;
  const v36 = C.valoresCondominio({ fluxo, livre: { ...casa24, linhas: l36 }, valorParaEntrada: 0 });
  assert.deepEqual([v36.plano, v36.pctRegra, v36.comissao], [36, 0.0475, Math.round(valor * 0.0475 * 100) / 100]);
  const l48 = F.mudarPrazo(casa24, 48).linhas;
  assert.equal(C.valoresCondominio({ fluxo, livre: { ...casa24, linhas: l48 }, valorParaEntrada: 0 }).plano, 48);
  const volta = F.mudarPrazo({ ...casa24, linhas: l36 }, 24).linhas;
  assert.equal(C.valoresCondominio({ fluxo, livre: { ...casa24, linhas: volta }, valorParaEntrada: 0 }).pctRegra, 0.05);
});

test("o placar e a validação usam a mesma régua de prazo da comissão (0/12/24 pós-chaves → 24/36/48)", () => {
  for (const p of [24, 36, 48]) {
    const ls = F.mudarPrazo(casa24, p).linhas;
    assert.equal(F.prazoDasLinhas(ls), p);
    assert.equal(C.valoresCondominio({ fluxo, livre: { ...casa24, linhas: ls }, valorParaEntrada: 0 }).plano, p);
    assert.deepEqual(F.validar({ ...casa24, linhas: ls }, F.normalizar(casa24)).erros, []);
  }
});
