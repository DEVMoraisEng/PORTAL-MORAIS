/* 04/11/2026 (dono): "os fluxos que nós fazemos a mão devem seguir o princípio do simulador — tirei das primeiras
 * parcelas pré-chaves, sobe automaticamente o valor do primeiro balão etc., ou pelo menos um campo de sugestão".
 * FluxoLivre.guiar(f, travadas, padrao): a diferença vai para as linhas destravadas de pré-chaves, balões e pós-chaves,
 * proporcional à régua do simulador (860/parcela, 330/parcela, 10.000, 7.000; pós-chaves até o teto). Números inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");

const c = (v) => Math.round(v * 100);
/* a régua do simulador (48x) + financiamento: soma 199.999,92 */
const base = () => ({
  valor: 199999.92, entrega: "2028-11-30",
  linhas: [
    { t: "sinal", v: 10000, n: 1, d: "2026-11-05", i: 1, x: "" },          // 0
    { t: "pre", v: 860, n: 12, d: "2026-12-10", i: 1, x: "" },             // 1  1ª parte
    { t: "pre", v: 330, n: 12, d: "2027-12-10", i: 1, x: "" },             // 2  2ª parte
    { t: "balao", v: 10000, n: 1, d: "2027-12-10", i: 1, x: "" },          // 3  1º balão
    { t: "balao", v: 7000, n: 1, d: "2028-11-10", i: 1, x: "" },           // 4  2º balão (chaves)
    { t: "pos", v: 788.33, n: 24, d: "2028-12-10", i: 1, x: "" },          // 5  pós-chaves no teto
    { t: "fin", v: 139800, n: 1, d: "", i: 1, x: "" }                      // 6
  ]
});
const total = (l) => F.totalLinha(l);

test("régua fecha", () => assert.equal(F.validar(base()).diferenca, 0));

test("tirou das 1ªs pré-chaves: 2ª parte e balões sobem na proporção 3.960 / 10.000 / 7.000; fecha ao centavo", () => {
  const f = base();
  f.linhas[1].v = 760;                                         // −100 × 12 = faltam 1.200
  const r = F.guiar(f, [1]);
  assert.ok(r.linhas && !r.erro, r.erro);
  assert.equal(r.sugestao, null);
  assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0, "fecha ao centavo");
  assert.deepEqual(r.mudou.slice().sort(), [2, 3, 4]);
  const add = [2, 3, 4].map((k) => total(r.linhas[k]) - total(base().linhas[k]));
  const W = 3960 + 10000 + 7000;
  [3960, 10000, 7000].forEach((w, j) => assert.ok(Math.abs(add[j] - 1200 * w / W) < 0.05, "linha " + (j + 2) + ": " + add[j]));
  assert.equal(r.linhas[1].v, 760, "a linha travada fica como a pessoa digitou");
  assert.equal(total(r.linhas[5]), total(base().linhas[5]), "pós-chaves no teto não sobe");
  for (const k of [0, 6]) assert.deepEqual(r.linhas[k], F.normalizar(base()).linhas[k], "fixo não muda");
  /* datas e quantidades ficam */
  [2, 3, 4].forEach((k) => assert.deepEqual([r.linhas[k].n, r.linhas[k].d], [base().linhas[k].n, base().linhas[k].d]));
});

test("os centavos fecham no último balão; a soma confere em vários cortes", () => {
  for (const v of [859.99, 801.37, 123.45, 1, 900]) {
    const f = base(); f.linhas[1].v = v;
    const r = F.guiar(f, [1]);
    assert.ok(r.linhas, v + ": " + r.erro);
    assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0, String(v));
    assert.ok(r.linhas.every((l) => l.v > 0), "nenhuma linha zerada");
  }
});

test("travadas não mudam: só as destravadas absorvem", () => {
  const f = base(); f.linhas[1].v = 760;
  const r = F.guiar(f, [1, 3]);
  assert.deepEqual(r.mudou.slice().sort(), [2, 4]);
  assert.equal(total(r.linhas[3]), 10000);
  assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0);
  /* travadas também como objeto { k: true } */
  assert.deepEqual(F.guiar(f, { 1: true, 3: true }).mudou.slice().sort(), [2, 4]);
});

test("sobra (aumentou uma linha): as outras descem, e o pós-chaves também desce proporcional", () => {
  const f = base(); f.linhas[3].v = 12000;                     // 1º balão +2.000: sobram 2.000
  const r = F.guiar(f, [3]);
  assert.ok(r.linhas, r.erro);
  assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0);
  assert.ok(r.mudou.includes(5), "pós-chaves desce");
  assert.ok(r.linhas[5].v < 788.33 && !r.linhas[5].u, "parcela pós-chaves igual nas 24, abaixo do teto");
  assert.ok(total(r.linhas[1]) < 10320 && total(r.linhas[4]) < 7000);
});

test("pós-chaves abaixo do teto sobe só até o teto; o resto vai para os outros", () => {
  const f = base();
  f.linhas[5].v = 700;                                          // 24 × 88,33 a menos = faltam 2.119,92
  f.linhas[1].v = 760;                                          // + 1.200
  const r = F.guiar(f, [1]);
  assert.ok(r.linhas, r.erro);
  assert.ok(c(r.linhas[5].v) <= c(F.POS_TETO) && c(r.linhas[5].u || 0) <= c(F.POS_TETO), "nunca acima do teto");
  assert.equal(F.validar({ ...f, linhas: r.linhas }, null).diferenca, 0);
  /* só o pós-chaves destravado e falta mais do que o teto deixa: não dá — vem a sugestão (todas destravadas) */
  const g = base(); g.linhas[5].v = 700; g.linhas[3].v = 5000;
  const s = F.guiar(g, [0, 1, 2, 3, 4]);
  assert.ok(s.erro, "impossível com as travas");
  assert.equal(F.validar(g).diferenca, F.validar({ ...g, linhas: s.linhas }).diferenca, "nada mudou");
  assert.ok(s.sugestao, "sugestão ignorando as travas");
  assert.ok(Object.values(s.sugestao).every((v) => v > 0));
});

test("tudo travado com diferença: não mexe e devolve a sugestão por linha (pelo peso do simulador)", () => {
  const f = base(); f.linhas[1].v = 760;
  const r = F.guiar(f, [1, 2, 3, 4, 5]);
  assert.ok(r.erro);
  assert.equal(r.mudou.length, 0);
  assert.deepEqual(r.linhas.map((l) => l.v), F.normalizar(f).linhas.map((l) => l.v), "nada muda");
  assert.ok(r.sugestao);
  const s = F.guiar(f, []);                                     // a sugestão = guiar sem travas
  for (const k of Object.keys(r.sugestao)) assert.equal(r.sugestao[k], s.linhas[k].v);
  assert.ok([1, 2, 3, 4].every((k) => k in r.sugestao), "pré-chaves e balões aparecem");
  assert.ok(!(0 in r.sugestao) && !(6 in r.sugestao), "fixos sem sugestão");
});

test("limite: nenhuma linha fica abaixo de R$ 1,00 por parcela; o que não cabe vai para as outras", () => {
  const f = base();
  f.linhas[2].v = 5;                                            // 2ª parte quase zerada (peso 3.960 continua)
  f.linhas[3].v = 30000;                                        // e o 1º balão +20.000: sobram 16.100
  const r = F.guiar(f, [3]);
  assert.ok(r.linhas, r.erro);
  assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0);
  assert.ok(r.linhas.every((l) => l.v >= 1), JSON.stringify(r.linhas.map((l) => l.v)));
  assert.equal(r.linhas[2].v, 1, "parou em R$ 1,00 por parcela; o resto foi para as outras");
  /* sobra maior que tudo o que é ajustável (o sinal subiu): impossível, nem a sugestão fecha */
  const g = base(); g.linhas[0].v = 70000;
  const s = F.guiar(g, [3]);
  assert.ok(s.erro);
  assert.equal(s.mudou.length, 0);
  assert.equal(s.sugestao, null, "nem destravando fecha");
});

test("tipos fixos nunca mudam (sinal, entrada, permuta, financiamento, FGTS, subsídio, pré-reserva)", () => {
  const f = base();
  f.linhas.push({ t: "entrada", v: 500, n: 1, d: "2026-11-05", i: 1, x: "" }, { t: "permuta", v: 1500, n: 1, d: "2026-11-20", i: 1, x: "carro" },
                { t: "fgts", v: 1000, n: 1, d: "", i: 1, x: "" }, { t: "prereserva", v: 1000, n: 1, d: "2026-10-30", i: 1, x: "" });
  const r = F.guiar(f, []);                                     // sobram 4.000
  assert.ok(r.linhas, r.erro);
  assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0);
  for (const k of [0, 6, 7, 8, 9, 10]) assert.equal(total(r.linhas[k]), total(F.normalizar(f).linhas[k]), "linha " + k);
  assert.ok(r.mudou.every((k) => ["pre", "balao", "pos"].includes(r.linhas[k].t)));
});

test("sem diferença: nada muda; linha extra de balão entra com o peso de balão", () => {
  const r = F.guiar(base(), []);
  assert.deepEqual([r.mudou, r.sugestao, r.erro], [[], null, undefined]);
  const f = base();
  f.linhas.push({ t: "balao", v: 3000, n: 1, d: "2028-06-10", i: 1, x: "" });   // balão novo digitado: sobram 3.000
  const g = F.guiar(f, [7]);
  assert.ok(g.linhas, g.erro);
  assert.equal(F.validar({ ...f, linhas: g.linhas }).diferenca, 0);
  assert.equal(g.linhas[7].v, 3000);
});

test("sem nenhuma linha ajustável: erro claro, sem sugestão", () => {
  const f = { valor: 20000, linhas: [{ t: "sinal", v: 10000, n: 1, d: "2026-11-05", i: 1, x: "" }, { t: "fin", v: 9000, n: 1, d: "", i: 1, x: "" }] };
  const r = F.guiar(f, []);
  assert.match(r.erro, /pré-chaves|balões/);
  assert.equal(r.sugestao, null);
});

test("teto do pós-chaves da proposta (padrao) vale quando é maior", () => {
  const f = base(); f.linhas[5].v = 700; f.linhas[1].v = 760;
  const padrao = { valor: 199999.92, linhas: [{ t: "pos", v: 900, n: 24, d: "2028-12-10", i: 1 }] };
  const r = F.guiar(f, [1, 2, 3, 4], padrao);                   // só o pós-chaves solto: sobe até 900
  assert.ok(r.linhas, r.erro);
  assert.ok(r.linhas[5].v > 788.33 && r.linhas[5].v <= 900);
  assert.equal(F.validar({ ...f, linhas: r.linhas }).diferenca, 0);
});
