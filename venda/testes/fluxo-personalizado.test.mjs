/* 14/11/2026 (dono): fluxo personalizado sem proposta, só no portal — a conta (venda/fluxo-personalizado.js).
   O fluxo padrão vem do fpcGerar do simulador (cópia em fixtures/fluxo-calc.js) e tem de passar inteiro no
   FluxoLivre.validar; depois de mexer numa linha, o guiar fecha a conta ao centavo. Valores de casa inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");
const P = require("../fluxo-personalizado.js");
const { fpcGerar } = require("./fixtures/fluxo-calc.js");

const HOJE = "2026-11-14";
const base = (o = {}) => ({ preco: 305000, aval: 306000, fin: 244800, fgts: 0, sub: 0, sinal: 0, nSinal: 4, prazo: 48,
                            assinatura: HOJE, dia: 10, diluir: [0, 0], ...o });
const gerar = (o, hoje = HOJE) => P.gerar(base(o), hoje, fpcGerar);
const resumo = (L) => L.map((l) => [l.t, l.v, l.n, l.d]);

test("fluxo padrão de 60.200 de entrada: sinal em 4x, 23 pré-chaves a partir de dezembro, balões e 24 pós-chaves", () => {
  const r = gerar();
  assert.equal(r.erro, undefined);
  assert.equal(r.entrada, 60200);
  assert.deepEqual(resumo(r.padrao.linhas), [
    ["sinal", 1000, 1, "2026-11-14"], ["sinal", 3000, 1, "2026-12-14"], ["sinal", 3000, 1, "2027-01-13"], ["sinal", 3000, 1, "2027-02-12"],
    ["pre", 938.18, 11, "2026-12-10"], ["pre", 330, 12, "2027-11-10"], ["balao", 10000, 1, "2027-12-10"], ["balao", 7000.1, 1, "2028-11-10"],
    ["pos", 788.33, 24, "2028-12-10"], ["fin", 244800, 1, ""]]);
  assert.equal(r.padrao.entrega, "2028-11-10");
  const v = F.validar(r.padrao, r.padrao);
  assert.deepEqual(v.erros, []);
  assert.equal(v.diferenca, 0);
});

test("1ª parcela: no mês da assinatura só se o dia ainda não passou; a pessoa pode escolher o mês seguinte", () => {
  assert.deepEqual(P.opcoesPrimeira(HOJE, HOJE, 20), [{ y: 2026, m: 11 }, { y: 2026, m: 12 }]);
  assert.deepEqual(P.opcoesPrimeira(HOJE, HOJE, 10), [{ y: 2026, m: 12 }, { y: 2027, m: 1 }]);
  const jan = gerar({ primeira: "2027-01" });
  const pres = jan.padrao.linhas.filter((l) => l.t === "pre");
  assert.deepEqual(pres.map((l) => [l.n, l.d]), [[10, "2027-01-10"], [12, "2027-11-10"]]);
  assert.equal(F.validar(jan.padrao, jan.padrao).ok, true);
});

test("varredura: prazo, sinal, FGTS, subsídio, diluição, dia e financiamento menor — tudo passa no validar", () => {
  let n = 0;
  for (const preco of [305000, 335000, 350000, 550000]) for (const prazo of [24, 36, 48]) for (const nSinal of [1, 2, 3, 4])
    for (const fgts of [0, 12345.67]) for (const sub of [0, 8000]) for (const diluir of [[0, 0], [100, 100], [25, 75]])
      for (const dia of [5, 20, 31]) for (const fin of [244800, 150000]) for (const sinal of [0, 25000]) {
        const caso = JSON.stringify({ preco, prazo, nSinal, fgts, sub, diluir, dia, fin, sinal });
        const r = gerar({ preco, prazo, nSinal, fgts, sub, diluir, dia, fin, sinal });
        assert.equal(r.erro, undefined, caso);
        assert.deepEqual(F.validar(r.padrao, r.padrao).erros, [], caso);
        n++;
      }
  assert.equal(n, 6912);
});

test("recusa: financiamento acima de 80% da avaliação, entrada abaixo do sinal mínimo, assinatura no passado", () => {
  const acima = gerar({ fin: 250000 });
  assert.match(acima.erro, /80% da avaliação/);
  assert.equal(acima.finMax, 244800);
  const curta = gerar({ fgts: 55000 });
  assert.match(curta.erro, /sinal mínimo é R\$ 10\.000,00/);
  assert.equal(curta.finMax, 240000);
  assert.match(gerar({ assinatura: "2026-11-13" }).erro, /anterior a hoje/);
  assert.match(P.gerar(base(), HOJE, null).erro, /não carregou/);
});

test("pós-chaves nasce travado: baixar a 1ª pré-chaves sobe a outra parte e os balões e não mexe na parcela pós-chaves", () => {
  const r = gerar({ preco: 335000 });
  const f = JSON.parse(JSON.stringify(r.padrao));
  const travas = P.travasIniciais(f.linhas);
  const kPos = f.linhas.findIndex((l) => l.t === "pos"), kPre = f.linhas.findIndex((l) => l.t === "pre");
  assert.deepEqual(travas, { [kPos]: true });
  f.linhas[kPre].v = 1000; delete f.linhas[kPre].u; travas[kPre] = true;
  const g = F.guiar(f, travas, r.padrao);
  assert.equal(g.erro, undefined);
  f.linhas = g.linhas;
  assert.equal(f.linhas[kPos].v, r.padrao.linhas[kPos].v);
  assert.equal(f.linhas[kPre].v, 1000);
  assert.deepEqual(F.validar(f, r.padrao).erros, []);
});

test("balão novo de 5 mil com o pós-chaves travado: sai das pré-chaves e dos outros balões, e o fluxo continua fechando", () => {
  const r = gerar({ preco: 335000 });
  const f = JSON.parse(JSON.stringify(r.padrao));
  const kPos = f.linhas.findIndex((l) => l.t === "pos");
  f.linhas.splice(kPos, 0, { t: "balao", v: 5000, n: 1, d: "2027-06-10", i: 1, x: "" });
  const g = F.guiar(f, { [kPos]: true, [kPos + 1]: true }, r.padrao);
  assert.equal(g.erro, undefined);
  f.linhas = g.linhas;
  assert.equal(f.linhas[kPos + 1].v, 788.33);
  assert.deepEqual(F.validar(f, r.padrao).erros, []);
});

test("coluna Última: vencimento da última parcela; vazio em linha de uma parcela", () => {
  assert.equal(P.ultimaData({ t: "pre", v: 100, n: 11, d: "2026-12-10", i: 1 }), "2027-10-10");
  assert.equal(P.ultimaData({ t: "balao", v: 100, n: 1, d: "2027-12-10", i: 1 }), "");
  assert.equal(P.ultimaData({ t: "pos", v: 100, n: 24, d: "", i: 1 }), "");
});

test("texto para o cliente: só unidade, valores e datas — nenhum campo de pessoa", () => {
  const r = gerar();
  const t = P.resumo(r.padrao, "Unidade 99 · Tipo 2", "14/11/2026").texto;
  assert.match(t, /\*Reserva do Ipês — Unidade 99 · Tipo 2\*/);
  assert.match(t, /Pré-chaves: 11 × R\$ 938,18 — de 10\/12\/2026 a 10\/10\/2027/);
  assert.match(t, /Financiamento: R\$ 244\.800,00/);
  assert.doesNotMatch(t, /CPF|cliente:|nome/i);
});
