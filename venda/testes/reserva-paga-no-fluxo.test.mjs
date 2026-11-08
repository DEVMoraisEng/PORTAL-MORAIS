/* 08/11/2026 (dono): reserva gerada = ao gerar o contrato pergunta se já foi paga; paga, a data do sinal não trava.
   E mês sem pré-chaves entre duas partes não salva mais (era só aviso). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.HOJE_VENDA_TESTE_ = "2026-11-08";
const F = require("../FluxoLivre.js");
const D = require("../../venda-dossie.js");

const base = (sinais) => ({ valor: 100000, entrega: "2028-11-30", linhas: sinais.concat([
  { t: "pre", v: 1000, n: 20, d: "2026-12-15", i: 1, x: "" }, { t: "fin", v: 70000, n: 1, d: "", i: 1, x: "" }]) });
const de = (r, t) => r.linhas.filter((l) => l.t === t);
const REF = { assinatura: "2026-11-08", hoje: "2026-11-08" };
const soma = (ls) => Math.round(ls.reduce((s, l) => s + l.v * l.n, 0) * 100);

test("mês sem pré-chaves entre duas partes não salva e diz qual mês", () => {
  const f = { valor: 100000, entrega: "2028-11-30", assinatura: "2026-11-08", linhas: [
    { t: "sinal", v: 10000, n: 1, d: "2026-11-30", i: 1, x: "" },
    { t: "pre", v: 500, n: 11, d: "2026-12-15", i: 1, x: "" }, { t: "pre", v: 500, n: 11, d: "2027-12-15", i: 1, x: "" },
    { t: "fin", v: 79000, n: 1, d: "", i: 1, x: "" }] };
  const r = F.validar(f);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /pré-chaves sem parcela em 11\/2027/.test(e) && /Encaixar as pré-chaves/.test(e)), JSON.stringify(r.erros));
  assert.ok(!r.avisos.some((a) => /sem parcela em/.test(a)));
});

test("Encaixar resolve o mês vazio: o fluxo volta a salvar", () => {
  const f = { valor: 100000, entrega: "2028-11-30", linhas: [
    { t: "sinal", v: 10000, n: 1, d: "2026-11-30", i: 1, x: "" },
    { t: "pre", v: 500, n: 11, d: "2026-12-15", i: 1, x: "" }, { t: "pre", v: 500, n: 11, d: "2027-12-15", i: 1, x: "" },
    { t: "fin", v: 79000, n: 1, d: "", i: 1, x: "" }] };
  const e = F.encaixarPre(f);
  const r = F.validar(Object.assign({}, f, { linhas: e.linhas }));
  assert.ok(!r.erros.some((x) => /sem parcela em/.test(x)), JSON.stringify(r.erros));
});

test("sinal de valor igual ao da reserva vira a reserva paga, com a data do pagamento", () => {
  const f = base([{ t: "sinal", v: 1000, n: 1, d: "2026-11-03", i: 1, x: "" }, { t: "sinal", v: 9000, n: 1, d: "2026-11-30", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 1000, data: "2026-11-07" }, REF);
  assert.deepEqual(de(r, "prereserva").map((l) => [l.v, l.d]), [[1000, "2026-11-07"]]);
  assert.deepEqual(de(r, "sinal").map((l) => [l.v, l.d]), [[9000, "2026-11-30"]]);
  assert.equal(soma(r.linhas), soma(f.linhas));
});

test("caso da unidade 13: sinal inteiro com data passada e só a reserva paga — o resto segue a data do fluxo e trava por ser antes de hoje", () => {
  const f = base([{ t: "sinal", v: 10000, n: 1, d: "2026-11-07", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 1000, data: "2026-11-07" }, REF);
  assert.deepEqual(de(r, "prereserva").map((l) => [l.v, l.d]), [[1000, "2026-11-07"]]);
  assert.deepEqual(de(r, "sinal").map((l) => [l.v, l.d]), [[9000, "2026-11-07"]]);
  assert.equal(soma(r.linhas), soma(f.linhas));
  const v = F.validar(Object.assign({}, f, REF, { linhas: r.linhas }));
  assert.ok(v.erros.some((e) => /sinal vence em 07\/11\/2026, antes de hoje/.test(e)), JSON.stringify(v.erros));
});

test("o que ainda vai ser pago mantém a data do fluxo; a reserva continua contando como sinal", () => {
  const f = base([{ t: "sinal", v: 10000, n: 1, d: "2026-11-30", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 1000, data: "2026-11-07" }, REF);
  assert.deepEqual(de(r, "sinal").map((l) => [l.v, l.d]), [[9000, "2026-11-30"]]);
  assert.equal(soma(de(r, "sinal")) + soma(de(r, "prereserva")), 1000000);
  assert.ok(r.mudou.some((m) => /parte do sinal/.test(m)), JSON.stringify(r.mudou));
  const v = F.validar(Object.assign({}, f, REF, { linhas: r.linhas }));
  assert.ok(!v.erros.some((e) => /antes de hoje/.test(e)), JSON.stringify(v.erros));
});

test("sinal todo pago pela reserva: a data antiga não trava e não sobra linha de sinal", () => {
  const f = base([{ t: "sinal", v: 10000, n: 1, d: "2026-11-01", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 10000, data: "2026-11-01" }, REF);
  assert.equal(de(r, "sinal").length, 0);
  assert.deepEqual(de(r, "prereserva").map((l) => [l.v, l.d]), [[10000, "2026-11-01"]]);
  const v = F.validar(Object.assign({}, f, REF, { linhas: r.linhas }));
  assert.ok(!v.erros.some((e) => /antes de hoje/.test(e)), JSON.stringify(v.erros));
});

test("sinal em série: abate da mais antiga e o total não muda", () => {
  const f = base([{ t: "sinal", v: 3000, n: 3, d: "2026-11-30", i: 1, x: "" }, { t: "sinal", v: 1000, n: 1, d: "2027-02-28", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 4000, data: "2026-11-07" }, REF);
  assert.deepEqual(de(r, "sinal").map((l) => [l.v, l.d]), [[2000, "2026-12-30"], [3000, "2027-01-30"], [1000, "2027-02-28"]]);
  assert.equal(soma(r.linhas), soma(f.linhas));
});

test("já está certo: não muda nada (não grava fluxo à toa)", () => {
  const f = base([{ t: "prereserva", v: 1000, n: 1, d: "2026-11-07", i: 1, x: "" }, { t: "sinal", v: 9000, n: 1, d: "2026-11-30", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 1000, data: "2026-11-07" }, REF);
  assert.deepEqual(r.mudou, []);
});

test("reserva corrigida para menos devolve a diferença ao sinal; maior que o sinal é recusada", () => {
  const f = base([{ t: "prereserva", v: 3000, n: 1, d: "2026-11-07", i: 1, x: "" }, { t: "sinal", v: 7000, n: 1, d: "2026-11-30", i: 1, x: "" }]);
  const r = F.reservaNoFluxo(f, { valor: 1000, data: "2026-11-07" }, REF);
  assert.deepEqual(de(r, "sinal").map((l) => [l.v, l.d]), [[9000, "2026-11-30"]]);
  assert.equal(soma(r.linhas), soma(f.linhas));
  assert.match(F.reservaNoFluxo(f, { valor: 20000, data: "2026-11-07" }, REF).erro, /passa do sinal/);
});

test("tela: a pergunta mostra Sim, Ainda não e Cancelar; já registrada, só confirma com valor e data", () => {
  const est = { gerado: false, etapa: "NENHUM", pre: null };
  const nova = D.htmlContrato(est, { perguntaReserva: { valor: "1.000,00", data: "", registrada: false } });
  assert.match(nova, /A reserva já foi paga\?/);
  assert.match(nova, /data-acao="c-res-sim"/);
  assert.match(nova, /data-acao="c-res-nao"/);
  assert.match(nova, /data-acao="c-res-cancelar"/);
  const reg = D.htmlContrato(est, { perguntaReserva: { valor: "1.000,00", data: "2026-11-07", registrada: true } });
  assert.match(reg, /value="2026-11-07"/);
  assert.match(reg, /value="1\.000,00"/);
  assert.match(reg, /data-acao="c-res-sim"/);
  assert.doesNotMatch(reg, /data-acao="c-res-nao"/);
  assert.doesNotMatch(D.htmlContrato(est, {}), /c-res-sim/);
});

test("tela: mês vazio mostra o botão Encaixar", () => {
  const f = { valor: 100000, valorOriginal: 100000, entrega: "2028-11-30", linhas: [
    { t: "sinal", v: 10000, n: 1, d: "2026-11-30", i: 1, x: "" },
    { t: "pre", v: 500, n: 11, d: "2026-12-15", i: 1, x: "" }, { t: "pre", v: 500, n: 11, d: "2027-12-15", i: 1, x: "" },
    { t: "fin", v: 79000, n: 1, d: "", i: 1, x: "" }], historico: [], alterado: false, motivo: "x", motivoPreco: "" };
  f.padrao = { valor: 100000, linhas: f.linhas };
  const h = D.htmlFluxoVivo(f);
  assert.match(h, /data-acao="c-fluxo-encaixar"/);
});
