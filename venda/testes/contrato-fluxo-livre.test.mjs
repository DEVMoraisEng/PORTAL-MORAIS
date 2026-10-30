/* 29/10 (etapa 2 do Alterar fluxo): o texto do contrato a partir da lista livre (FLUXO PERSONALIZADO).
   Das gavetas o texto continua idêntico — os testes antigos de contrato-condominio*.test.mjs cobrem. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../ContratoVenda.js");
const T = require("../ConfissaoVenda.js");

const fluxo = { assinatura: "2026-10-30", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 305000,
                balao2Data: "2028-11-10", credito: 240000, fgts: 5000 };
const livre = { valor: 305000, entrega: "2028-12-01", linhas: [
  { t: "sinal", v: 2000, n: 5, d: "2026-10-30", i: 1 },                      // sinal em 5x (10.000)
  { t: "entrada", v: 1000, n: 1, d: "2026-10-30", i: 1 },
  { t: "pre", v: 500, n: 12, d: "2026-12-10", i: 1, u: 520 },               // 11 × 500 + 520 = 6.020
  { t: "balao", v: 5000, n: 2, d: "2027-06-10", i: 6 },                     // jun/2027 e dez/2027
  { t: "balao", v: 3980, n: 1, d: "2028-11-10", i: 1 },                     // o da entrega das chaves
  { t: "pos", v: 700, n: 24, d: "2029-01-10", i: 1 },                       // 16.800
  { t: "permuta", v: 12200, n: 1, d: "2026-11-15", i: 1, x: "veículo marca/modelo/ano/placa" },
  { t: "fin", v: 240000, n: 1, d: "", i: 1 }, { t: "fgts", v: 5000, n: 1, d: "", i: 1 }] };
const co = { fluxo, livre, comissao: 13725, valorParaEntrada: 50000 };

test("grupos da lista: sinais expandidos (o 1º no ato), balões a cada 6 meses, o da entrega marcado; soma = valor da casa", () => {
  const G = C.gruposFluxo(co);
  assert.deepEqual(G.sinais.map((s) => [s.d, s.v, !!s.ato]), [["2026-10-30", 2000, true], ["2026-11-30", 2000, false], ["2026-12-30", 2000, false],
    ["2027-01-30", 2000, false], ["2027-02-28", 2000, false]]);
  assert.deepEqual(G.baloes.map((b) => [b.d, !!b.chaves]), [["2027-06-10", false], ["2027-12-10", false], ["2028-11-10", true]]);
  assert.equal(G.posN, 24);
  assert.equal(C.somaGrupos(G), 305000);
  assert.equal(C.excedenteSinal(co), 0, "no fluxo alterado o excedente é linha, não conta de novo");
});

test("6.1 do fluxo alterado: mesmos incisos; última parcela diferente; balões; inciso VI da permuta", () => {
  const t = C.formaPagamentoCondominio(fluxo, livre).split("\n");
  assert.equal(t[0], "6.1. Preço total: R$ 305.000,00 (trezentos e cinco mil reais), a ser pago da seguinte forma:");
  assert.ok(t.some((l) => l.startsWith("a) R$ 2.000,00 (dois mil reais), no ato da assinatura deste instrumento, em 30/10/2026")), t.join("\n"));
  assert.ok(t.includes("e) R$ 2.000,00 (dois mil reais), com vencimento em 28/02/2027."), t.join("\n"));
  assert.ok(t.some((l) => /^a\) 1ª etapa: 11 parcelas mensais e sucessivas de R\$ 500,00 .* e a última de R\$ 520,00 .*vencendo-se a primeira em 10\/12\/2026 e as demais no dia 10/.test(l)), t.join("\n"));
  assert.ok(t.includes("c) R$ 3.980,00 (três mil novecentos e oitenta reais), com vencimento em 10/11/2028, ou na data da entrega das chaves, o que ocorrer primeiro."), t.join("\n"));
  assert.ok(t.includes("VI — BEM DADO EM PAGAMENTO (permuta), sem correção monetária:"));
  assert.ok(t.includes("a) veículo marca/modelo/ano/placa, recebido pelo valor de R$ 12.200,00 (doze mil e duzentos reais), com entrega em 15/11/2026."), t.join("\n"));
  assert.equal(C.negritoDaLinha("VI — BEM DADO EM PAGAMENTO (permuta), sem correção monetária:"), 61);
});

test("quadro-resumo: sinal pela lista, entrada à vista e permuta antes das parcelas corrigidas; pós pela lista", () => {
  const G = C.gruposFluxo(co);
  const pre = C.textoPreChaves(G);
  assert.match(pre, /^pagamento único de R\$ 1\.000,00 .*, na assinatura deste contrato; bem dado em pagamento \(permuta\): veículo/);
  assert.match(pre, /11 parcelas mensais e sucessivas de R\$ 500,00 .* cada e a última de R\$ 520,00 .*, vencendo todo dia 10, a primeira em 10\/12\/2026/);
  assert.match(pre, /todas corrigidas pelo INCC-M/);
  assert.match(C.textoPosChaves(G), /^24 parcelas mensais e sucessivas de R\$ 700,00 .* corrigidas pelo IPCA/);
  const v = C.valoresCondominio(co);
  assert.deepEqual([v.sinal, v.financiamento, v.comissao, v.precoMudou], [10000, 245000, 13725, false]);
});

test("valor da casa mudado (JC/JV): comissão pela regra sobre o valor novo", () => {
  const caro = { ...co, livre: { ...livre, valor: 310000, linhas: livre.linhas.map((l) => (l.t === "permuta" ? { ...l, v: 17200 } : l)) },
                 fluxo: { ...fluxo, prazoEntrada: 48 } };
  const v = C.valoresCondominio(caro);
  assert.equal(v.precoMudou, true);
  assert.equal(v.comissao, 13950);   // 4,5% de 310 mil (48 meses)
});

test("termo de confissão: pré sem a entrada à vista nem a permuta; totais pela lista", () => {
  const d = { condominio: co };
  const G = C.gruposFluxo(co);
  assert.equal(T.totalPre(G), 6020 + 13980);
  assert.equal(T.totalPos(G), 16800);
  assert.doesNotMatch(C.textoPreChaves(G, true), /pagamento único|permuta/);
  assert.deepEqual(T.quais(d), ["PRE", "POS"]);
});

test("30/10 (24x sem fiador): sem parcela depois das chaves o plano é SEM_POS; o Alterar fluxo que cria pós-chaves volta a COM_POS", () => {
  const sem = { ...co, livre: { ...livre, linhas: livre.linhas.map((l) => (l.t === "pos" ? { ...l, t: "pre", d: "2028-01-10", n: 1, v: 16800 } : l)) } };
  assert.equal(C.comPosChaves(co), true);
  assert.equal(C.comPosChaves(sem), false);
  const d = (c) => ({ vendedor: { tipo: "PJ" }, negociacao: { intermediariaValor: null }, comissao: {}, condominio: { ...c, fiadores: [{ nome: "FIADOR TESTE" }] } });
  assert.deepEqual([C.blocos(d(sem)).SEM_POS, C.blocos(d(sem)).COM_POS, C.blocos(d(sem)).TEM_FIADORES], [true, false, false]);
  assert.deepEqual([C.blocos(d(co)).SEM_POS, C.blocos(d(co)).COM_POS, C.blocos(d(co)).TEM_FIADORES], [false, true, true]);
  assert.deepEqual(T.quais({ condominio: sem }), []);
  assert.deepEqual(T.quais({ condominio: co }), ["PRE", "POS"]);
});
