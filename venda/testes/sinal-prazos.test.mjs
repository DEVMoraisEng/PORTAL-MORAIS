/* 14/11/2026 (dono, unidade 40): "sinal sempre é 0+30+60+90 (ou só até 60, ou só até 30); sempre que tiver somente
   duas parcelas é 0+30". O sinal de 10 mil tinha ficado em 90 dias (fev/2027) com o 30 e o 60 vazios. Números inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");

/* prazos em DIAS, como a planilha grava (assinatura 14/11 → 14/12, 13/01, 12/02) */
const gavetas = {
  assinatura: "2026-11-14", entrega: "2028-11-30", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-12-14", sinal60: 3000, data60: "2027-01-13", sinal90: 3000, data90: "2027-02-12",
  pre1N: 11, pre1Valor: 860, pre1Data: "2026-12-10", pre2N: 12, pre2Valor: 330, pre2Data: "2027-11-10",
  balao1Valor: 10000, balao1Data: "2027-12-10", balao2Valor: 7860, balao2Data: "2028-11-10",
  posN: 0, posValor: 0, credito: 248720, fgts: 15000, subsidio: 0
};
const P = F.doPadrao(gavetas);
const semSinal = P.linhas.filter((l) => l.t !== "sinal");
const s = (v, d, n) => ({ t: "sinal", v, n: n || 1, d, i: 1, x: "" });
const com = (sinais, base) => ({ valor: P.valor, entrega: P.entrega, linhas: [...sinais, ...(base || semSinal)] });
const errosSinal = (f, p) => F.validar(f, p === undefined ? P : p).erros.filter((e) => /sinal/i.test(e));

test("o fluxo da proposta (ato, 30, 60, 90) passa e leva os prazos do sinal", () => {
  assert.deepEqual(P.prazosSinal, ["2026-11-14", "2026-12-14", "2027-01-13", "2027-02-12"]);
  assert.deepEqual(F.validar(P, P).erros, []);
});

test("o caso da unidade 40: duas parcelas com a 2ª em 90 dias não salva — tem de ser ato + 30", () => {
  const e = errosSinal(com([s(2000, "2026-11-14"), s(8000, "2027-02-12")]));
  assert.equal(e.length, 1);
  assert.match(e[0], /^Linha 2: sinal vence em 12\/02\/2027: o sinal é ato \+ 30 \+ 60 \+ 90 dias, sem pular prazo — esta parcela vence em 14\/12\/2026 — use Corrigir datas$/);
  assert.deepEqual(errosSinal(com([s(2000, "2026-11-14"), s(8000, "2026-12-14")])), []);
});

test("uma, três e quatro parcelas: só ato; ato+30+60; ato+30+60+90 — pular o 60 não salva", () => {
  assert.deepEqual(errosSinal(com([s(10000, "2026-11-14")])), []);
  assert.match(errosSinal(com([s(10000, "2026-12-14")]))[0], /esta parcela vence em 14\/11\/2026/);
  assert.deepEqual(errosSinal(com([s(4000, "2026-11-14"), s(3000, "2026-12-14"), s(3000, "2027-01-13")])), []);
  assert.match(errosSinal(com([s(4000, "2026-11-14"), s(3000, "2026-12-14"), s(3000, "2027-02-12")]))[0], /Linha 3: .*vence em 13\/01\/2027/);
  assert.deepEqual(errosSinal(com([s(1000, "2026-11-14"), s(3000, "2026-12-14"), s(3000, "2027-01-13"), s(3000, "2027-02-12")])), []);
});

test("a ordem das linhas na tela não importa; cinco parcelas não salva", () => {
  assert.deepEqual(errosSinal(com([s(8000, "2026-12-14"), s(2000, "2026-11-14")])), []);
  const cinco = com([s(2000, "2026-11-14"), s(2000, "2026-12-14"), s(2000, "2027-01-13"), s(2000, "2027-02-12"), s(2000, "2027-03-14")]);
  assert.match(errosSinal(cinco).join(";"), /O sinal vai em no máximo 4 parcelas/);
});

test("linha de sinal com 2 parcelas mensais (14/11 e 14/12) cabe; com 3 a 3ª cai em 14/01 e não em 13/01", () => {
  assert.deepEqual(errosSinal(com([s(5000, "2026-11-14", 2)])), []);
  assert.match(errosSinal(com([s(3333.33, "2026-11-14", 3)]))[0], /sinal vence em 14\/01\/2027: .*vence em 13\/01\/2027/);
});

test("com reserva paga o restante pode começar no ato ou em 30 dias, sempre sem pular", () => {
  const pr = F.doPadrao(gavetas, 0, { valor: 1000, data: "2026-11-10" });   /* a reserva cobre o ato: sobram 30, 60 e 90 */
  assert.deepEqual(pr.linhas.filter((l) => l.t === "sinal").map((l) => l.d), ["2026-12-14", "2027-01-13", "2027-02-12"]);
  assert.deepEqual(F.validar(pr, pr).erros, []);
  const base = pr.linhas.filter((l) => l.t !== "sinal");
  assert.deepEqual(errosSinal(com([s(9000, "2026-12-14")], base), pr), []);                       /* só em 30 dias */
  assert.deepEqual(errosSinal(com([s(9000, "2026-11-14")], base), pr), []);                       /* só no ato */
  assert.match(errosSinal(com([s(9000, "2027-01-13")], base), pr)[0], /vence em 14\/11\/2026/);   /* direto em 60 dias: pulou */
  assert.match(errosSinal(com([s(4000, "2026-12-14"), s(5000, "2027-02-12")], base), pr)[0], /vence em 13\/01\/2027/);
});

test("Corrigir datas leva o sinal para os prazos em ordem, sem mudar valor nem o total do fluxo", () => {
  const f = com([s(2000, "2026-11-14"), s(8000, "2027-02-12")]);
  const r = F.corrigirDatas(f, P);
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.linhas.filter((l) => l.t === "sinal").map((l) => [l.v, l.d]), [[2000, "2026-11-14"], [8000, "2026-12-14"]]);
  assert.equal(F.soma(r.linhas), F.soma(f.linhas));
  assert.deepEqual(r.mudou, [1]);
  assert.deepEqual(errosSinal({ valor: f.valor, entrega: f.entrega, linhas: r.linhas }), []);
  /* série de 3 vira 3 linhas, com o centavo da última */
  const serie = com([Object.assign(s(3333.33, "2026-11-14", 3), { u: 3333.34 })]);
  const r2 = F.corrigirDatas(serie, P);
  assert.deepEqual(r2.linhas.filter((l) => l.t === "sinal").map((l) => [l.v, l.n, l.d]),
    [[3333.33, 1, "2026-11-14"], [3333.33, 1, "2026-12-14"], [3333.34, 1, "2027-01-13"]]);
  assert.equal(F.soma(r2.linhas), F.soma(serie.linhas));
  /* nada errado = nada muda */
  assert.deepEqual(F.corrigirDatas(P, P).mudou, []);
});

test("sem os prazos da venda (contrato sem a proposta): conta em dias com 3 dias de folga, mas pular prazo não passa", () => {
  const f = (sinais) => ({ valor: 20000, entrega: "", linhas: [...sinais, { t: "fin", v: 10000, n: 1, d: "", i: 1, x: "" }] });
  const es = (x) => F.validar(x).erros.filter((e) => /sinal/i.test(e));
  assert.deepEqual(es(f([s(2000, "2026-10-07"), s(8000, "2026-11-07")])), []);   /* 31 dias: mês cheio */
  assert.equal(es(f([s(2000, "2026-10-07"), s(8000, "2027-01-05")])).length, 1); /* 90 dias no lugar do 30 */
});
