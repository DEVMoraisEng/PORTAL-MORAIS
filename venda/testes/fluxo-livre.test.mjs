import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");

/* casa de 305 mil com o fluxo padrão do simulador (números inventados) */
const gavetas = {
  assinatura: "2026-10-30", entrega: "2028-12-30", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-30",
  pre1N: 12, pre1Valor: 860, pre1Data: "2026-12-10", pre2N: 12, pre2Valor: 330, pre2Data: "2027-12-10",
  balao1Valor: 10000, balao1Data: "2027-12-10", balao2Valor: 7000, balao2Data: "2028-06-10",
  posN: 0, posValor: 0, credito: 248720, fgts: 15000, subsidio: 0
};

test("fluxo padrão vira lista e fecha com o valor da casa", () => {
  const f = F.doPadrao(gavetas);
  assert.equal(f.valor, 305000);
  assert.equal(f.entrega, "2028-12-30");
  assert.deepEqual(f.linhas.map((l) => l.t), ["sinal", "sinal", "sinal", "sinal", "pre", "pre", "balao", "balao", "fin", "fgts"]);
  const r = F.validar(f);
  assert.equal(r.diferenca, 0);
  assert.deepEqual(r.erros, []);
  assert.equal(r.ok, true);
});

test("excedente do valor para entrada entra como Entrada à vista na assinatura", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { credito: 247720 }), 1000);
  const e = f.linhas.find((l) => l.t === "entrada");
  assert.deepEqual([e.v, e.d], [1000, "2026-10-30"]);
  assert.equal(F.validar(f).ok, true);
});

test("um balão a mais não salva até a conta fechar; diferença diz quanto sobra", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 });
  const r = F.validar(f);
  assert.equal(r.ok, false);
  assert.equal(r.diferenca, -10000);
  assert.match(r.erros[0], /^Sobram R\$ 10\.000,00/);
});

test("Redistribuir joga a diferença na linha e os centavos na última parcela", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 });
  const k = f.linhas.findIndex((l) => l.t === "pre");          // 12 × 860 = 10.320 → tem de virar 320
  const r = F.redistribuir(f, k);
  const l = r.linhas[k];
  assert.equal(l.v, 26.66);
  assert.equal(l.u, 26.74);                                      // 11 × 26,66 + 26,74 = 320,00
  assert.equal(F.validar(Object.assign({}, f, { linhas: r.linhas })).ok, true);
});

test("Redistribuir recusa quando a linha ficaria zerada", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 50000, n: 1, d: "2027-06-10", i: 1 });
  assert.match(F.redistribuir(f, 0).erro, /zerada/);
});

test("redistribuir livre: a pessoa ajusta à mão e libera quando bate ao centavo", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 });
  f.linhas[4] = Object.assign({}, f.linhas[4], { v: 10320 / 12 - 10000 / 12 });   // 26,666… arredonda
  assert.equal(F.validar(f).ok, false);                                            // 12 × 26,67 = 320,04: sobram 4 centavos
  assert.equal(F.validar(f).diferenca, -0.04);
  f.linhas[4].v = 26.66; f.linhas[4].u = 26.74;
  assert.equal(F.validar(f).ok, true);
});

test("data fora da entrega só avisa (quem trava é a conta)", () => {
  const f = { valor: 2000, entrega: "2028-06-30", linhas: [
    { t: "pre", v: 100, n: 10, d: "2028-01-10", i: 1 },      // última em 10/10/2028
    { t: "pos", v: 1000, n: 1, d: "2028-06-10", i: 1 }] };
  const r = F.validar(f);
  assert.equal(r.ok, true);
  assert.match(r.avisos[0], /^Linha 1: .*depois da entrega das chaves \(10\/10\/2028\)/);
  assert.match(r.avisos[1], /^Linha 2: pós-chaves/);
});

test("permuta exige a descrição do bem; financiamento não exige data", () => {
  const f = { valor: 100000, entrega: "", linhas: [{ t: "permuta", v: 40000, n: 1, d: "2026-11-15", i: 1, x: "" }, { t: "fin", v: 60000, n: 1, d: "", i: 1 }] };
  assert.deepEqual(F.validar(f).erros, ["Linha 1: descreva o bem da permuta"]);
  f.linhas[0].x = "veículo marca/modelo/ano/placa";
  assert.equal(F.validar(f).ok, true);
});

test("valores e tipos inválidos viram erro por linha", () => {
  const r = F.validar({ valor: 100, linhas: [{ t: "carro", v: 100, n: 1, d: "2026-11-01" }, { t: "sinal", v: 0, n: 0, d: "2026-02-30" }] });
  assert.equal(r.ok, false);
  assert.match(r.porLinha[0][0], /tipo/);
  assert.equal(r.porLinha[1].length, 3);   // valor, quantidade e data
});

test("expandir: parcela por parcela, a cada X meses, dia 31 cai no fim do mês", () => {
  const p = F.expandir([{ t: "pre", v: 100, n: 3, d: "2027-01-31", i: 1, u: 101 }, { t: "balao", v: 500, n: 2, d: "2027-01-15", i: 6 }]);
  assert.deepEqual(p.map((x) => [x.data, x.valor, x.rotulo]), [
    ["2027-01-15", 500, "Balão 1/2"], ["2027-01-31", 100, "Pré-chaves 1/3"], ["2027-02-28", 100, "Pré-chaves 2/3"],
    ["2027-03-31", 101, "Pré-chaves 3/3"], ["2027-07-15", 500, "Balão 2/2"]]);
  assert.equal(p[1].reajuste, "INCC-M");
});

/* regras da proposta (dono 29/10) — fluxo da proposta com 24 pós-chaves */
const comPos = Object.assign({}, gavetas, { posN: 24, posValor: 700, posData: "2029-01-10", credito: 248720 - 16800 });

test("fluxo da proposta passa nas regras dela mesma", () => {
  const p = F.doPadrao(comPos);
  assert.deepEqual(F.validar(p, p).erros, []);
});

test("financiamento e FGTS não mudam: trocar valor entre eles e as parcelas é recusado", () => {
  const p = F.doPadrao(comPos), f = F.normalizar(p);
  f.linhas.find((l) => l.t === "fin").v -= 1000;
  f.linhas.find((l) => l.t === "pre").v += 1000 / 12;
  assert.match(F.validar(f, p).erros.join(";"), /Financiamento, FGTS e subsídio não mudam/);
  const sem = F.normalizar(p);
  sem.linhas = sem.linhas.filter((l) => l.t !== "fgts");
  assert.match(F.validar(sem, p).erros.join(";"), /não mudam/);
});

test("pós-chaves: mesma quantidade da proposta, até o teto de R$ 788,33 e sem começar antes", () => {
  const p = F.doPadrao(comPos);
  const menos = F.normalizar(p); menos.linhas.find((l) => l.t === "pos").n = 12;
  assert.match(F.validar(menos, p).erros.join(";"), /tem de continuar com 24 parcelas/);
  const dividido = F.normalizar(p), k = dividido.linhas.findIndex((l) => l.t === "pos");
  dividido.linhas.splice(k, 1, { t: "pos", v: 700, n: 12, d: "2029-01-10", i: 1 }, { t: "pos", v: 700, n: 12, d: "2030-01-10", i: 1 });
  assert.deepEqual(F.validar(dividido, p).erros, [], "pode dividir em mais linhas se a quantidade for a mesma");
  const caro = F.normalizar(p); caro.linhas.find((l) => l.t === "pos").v = 800;
  assert.match(F.validar(caro, p).erros.join(";"), /acima do teto de R\$ 788,33/);
  const cedo = F.normalizar(p); cedo.linhas.find((l) => l.t === "pos").d = "2028-12-10";
  assert.match(F.validar(cedo, p).erros.join(";"), /não pode começar antes de 10\/01\/2029/);
  const semPos = F.doPadrao(gavetas), comNovo = F.normalizar(semPos);
  comNovo.linhas.push({ t: "pos", v: 100, n: 1, d: "2029-01-10", i: 1 });
  assert.match(F.validar(comNovo, semPos).erros.join(";"), /não tem pós-chaves/);
});

test("serializar e ler voltam o mesmo fluxo e descartam campos estranhos", () => {
  const f = F.doPadrao(gavetas);
  f.linhas[0].lixo = "<script>";
  const s = F.serializar(f);
  assert.doesNotMatch(s, /lixo/);
  assert.deepEqual(F.ler(s).linhas, F.normalizar(f).linhas);
  assert.equal(F.ler("não é json"), null);
  assert.ok(s.length < 1900 * 2);
});
