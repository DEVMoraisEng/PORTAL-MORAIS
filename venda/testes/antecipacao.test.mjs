/* Antecipação: conta dos 5 jeitos e as 5 travas (spec v2, 31/10/2026). Gabarito: a venda sintética `base` (unidade 13). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const A = createRequire(import.meta.url)("../Antecipacao.js");
const R = JSON.parse(fs.readFileSync(new URL("./dados/antecipacao-retratos.json", import.meta.url), "utf8"));
const DATA = "2026-10-21";
const c = (x) => Math.round(x * 100) / 100;
const soma = (l) => c(l.reduce((s, p) => s + p.valor, 0));
/* Saldo de depois = o que fica em aberto. Paga e recebida em parte (no retrato de antes) nunca entram: senão o sinal,
   os terceiros e as pré já pagas (245.220,05 na venda base) somariam como se ainda fossem devidos. */
const abertas = (res, r = R.base) => {
  const fora = new Set(r.parcelas.filter((p) => p.pago || p.parcial).map((p) => p.id));
  for (const p of res.depois) if (fora.has(p.id)) assert.ok(p.acao === "igual" && p.raw === p.rawAntes && p.valor === p.valorAntes, "paga mudou " + p.id);
  return res.depois.filter((p) => p.acao !== "quita" && !fora.has(p.id));
};

test("valor digitado", () => {
  assert.equal(A.lerValor("30.000,00"), 30000);
  assert.equal(A.lerValor("30000"), 30000);
  assert.equal(A.lerValor("1.234,5"), 1234.5);
  for (const x of ["", "0", "-10", "abc", "1,2,3"]) assert.equal(A.lerValor(x), null, x);
});

test("saldo corrigido da venda base é a soma das pré/balão/pós em aberto", () => {
  const s = A.situacao(R.base, DATA);
  assert.equal(s.saldo, soma(s.elegiveis));
  assert.ok(s.saldo > 30000);
});

for (const modo of ["A", "B", "C"]) {
  test("jeito " + modo + ": saldo de antes = antecipação + saldo de depois, ao centavo, e travas ok", () => {
    const antes = A.situacao(R.base, DATA).saldo;
    const res = A.simular(R.base, { modo, valor: 30000, dataPg: DATA });
    assert.equal(res.ok, true, res.erro);
    assert.equal(c(30000 + soma(abertas(res))), antes);
    assert.deepEqual(res.travas, []);
  });
}

test("números da prova de 21/10 (unidade 13, 12,30%): saldo, balão de dez/26, pós-chaves", () => {
  const s = A.situacao(R.base, DATA);
  assert.equal(s.saldo, 37446.74);
  assert.equal(s.balaoes.find((b) => b.data === "2026-12-10").valor, 10055.54);
  assert.equal(A.simular(R.base, { modo: "E", dataPg: DATA }).valor, 19025.04);
});

test("jeito B: todas caem na mesma proporção (pós-chaves ~157,64; balão de dez/26 ~1.999,67)", () => {
  const res = A.simular(R.base, { modo: "B", valor: 30000, dataPg: DATA });
  const pos = abertas(res).filter((p) => p.tipo === "pos");
  assert.ok(pos.every((p) => Math.abs(p.valor - 157.64) <= 0.02), pos.map((p) => p.valor).join(" "));
  assert.ok(Math.abs(abertas(res).find((p) => p.data === "2026-12-10" && p.tipo === "balao").valor - 1999.67) <= 0.02);
});

test("jeito C: ficam nov e dez/26 (331,84) e o balão de dez/26 reduzido; nada depois de dez/26", () => {
  const res = A.simular(R.base, { modo: "C", valor: 30000, dataPg: DATA });
  const ficam = abertas(res).filter((p) => ["pre", "balao", "pos"].includes(p.tipo) && p.data >= DATA);
  assert.deepEqual(ficam.map((p) => p.data + " " + p.tipo).sort(), ["2026-11-10 pre", "2026-12-10 balao", "2026-12-10 pre"]);
  assert.ok(ficam.filter((p) => p.tipo === "pre").every((p) => p.valor === 331.84 || p.acao === "reduz"));
});

test("jeito A: sem pagar até a 15ª pós-chaves (mai/2028), que fica reduzida", () => {
  const res = A.simular(R.base, { modo: "A", valor: 30000, dataPg: DATA });
  assert.equal(res.resumo.proximo.data, "2028-05-10");
  assert.ok(res.resumo.proximo.valor < 792.71);
});

test("D: quitar o balão inteiro custa o valor corrigido dele; metade deixa o balão na mesma data", () => {
  const s = A.situacao(R.base, DATA);
  const b = s.balaoes[0];
  const inteiro = A.simular(R.base, { modo: "D", valor: b.valor, dataPg: DATA, parcelaId: b.id });
  assert.equal(inteiro.depois.find((p) => p.id === b.id).acao, "quita");
  const meio = A.simular(R.base, { modo: "D", valor: 5000, dataPg: DATA, parcelaId: b.id });
  const p = meio.depois.find((x) => x.id === b.id);
  assert.equal(p.acao, "reduz"); assert.equal(p.data, b.data); assert.equal(p.valor, c(b.valor - 5000));
  assert.deepEqual(meio.travas, []);
});

test("D: valor maior que a parcela é recusado", () => {
  const b = A.situacao(R.base, DATA).balaoes[0];
  assert.equal(A.simular(R.base, { modo: "D", valor: b.valor + 1, dataPg: DATA, parcelaId: b.id }).erro, "VALOR_ACIMA_DO_SALDO");
});

test("E: todas as pós-chaves = soma do valor corrigido delas; nada fica depois das chaves", () => {
  const s = A.situacao(R.base, DATA);
  const res = A.simular(R.base, { modo: "E", dataPg: DATA });
  const pos = s.elegiveis.filter((p) => p.tipo === "pos");
  assert.equal(res.valor, soma(pos));
  assert.equal(abertas(res).filter((p) => p.tipo === "pos").length, 0);
  assert.deepEqual(res.travas, []);
});

test("E: as últimas 6 pós-chaves; as primeiras continuam nas mesmas datas", () => {
  const res = A.simular(R.base, { modo: "E", quantas: 6, dataPg: DATA });
  const pos = abertas(res).filter((p) => p.tipo === "pos");
  assert.equal(pos.length, A.situacao(R.base, DATA).posAbertas - 6);
  assert.ok(pos.every((p) => p.acao === "igual"));
});

test("E sem pós-chaves (24x) dá SEM_POS_CHAVES", () => {
  const r = structuredClone(R.base); r.parcelas = r.parcelas.filter((p) => p.tipo !== "pos");
  assert.equal(A.simular(r, { modo: "E", dataPg: DATA }).erro, "SEM_POS_CHAVES");
});

test("valor zero, negativo e acima do saldo; igual ao saldo quita tudo", () => {
  const s = A.situacao(R.base, DATA).saldo;
  assert.equal(A.simular(R.base, { modo: "A", valor: 0, dataPg: DATA }).erro, "VALOR_INVALIDO");
  assert.equal(A.simular(R.base, { modo: "A", valor: -5, dataPg: DATA }).erro, "VALOR_INVALIDO");
  assert.equal(A.simular(R.base, { modo: "B", valor: s + 0.01, dataPg: DATA }).erro, "VALOR_ACIMA_DO_SALDO");
  const tudo = A.simular(R.base, { modo: "B", valor: s, dataPg: DATA });
  assert.equal(abertas(tudo).filter((p) => ["pre", "balao", "pos"].includes(p.tipo)).length, 0);
});

test("parcela vencida em aberto fica fora e aparece no aviso", () => {
  const r = structuredClone(R.base);
  const p = r.parcelas.find((x) => x.tipo === "pre" && !x.pago);
  const s = A.situacao(r, p.data + "x");   // "aaaa-mm-ddx" > "aaaa-mm-dd": o pagamento é depois do vencimento dela
  assert.ok(s.vencidas.some((v) => v.id === p.id));
  assert.ok(!s.elegiveis.some((v) => v.id === p.id));
});

test("paga e recebida em parte nunca mudam", () => {
  const r = structuredClone(R.base);
  const p = r.parcelas.find((x) => x.tipo === "pre" && !x.pago); p.parcial = true;
  const res = A.simular(r, { modo: "B", valor: 30000, dataPg: DATA });
  assert.ok(!res.depois.some((x) => x.id === p.id && x.acao !== "igual"));
});

test("travas pegam o que a conta nunca deve fazer", () => {
  const res = A.simular(R.base, { modo: "B", valor: 30000, dataPg: DATA });
  const mexe = (f) => { const x = structuredClone(res); f(x.depois.find((p) => p.acao === "reduz")); return A.travas(R.base, x); };
  assert.match(mexe((p) => { p.data = "2030-01-01"; }).join(" "), /^2/);
  assert.match(mexe((p) => { p.raw = p.rawAntes + 1; }).join(" "), /3/);
  assert.match(mexe((p) => { p.tipo = p.tipo === "balao" ? "pre" : "balao"; }).join(" "), /4/);
  const nova = structuredClone(res); nova.depois.push({ id: "nova", data: "2027-01-10", tipo: "pre", raw: 1, rawAntes: 0, valor: 1, valorAntes: 0, acao: "reduz" });
  assert.match(A.travas(R.base, nova).join(" "), /1/);
});

test("centavo fecha em 500 casos sorteados (ou NAO_FECHA com valor sugerido, nunca soma errada)", () => {
  let semente = 7, nf = 0; const sorteio = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
  const s = A.situacao(R.base, DATA).saldo;
  for (let i = 0; i < 500; i++) {
    const modo = ["A", "B", "C"][i % 3];
    const valor = c(1 + sorteio() * (s - 2));
    const res = A.simular(R.base, { modo, valor, dataPg: DATA });
    if (!res.ok) { assert.equal(res.erro, "NAO_FECHA"); assert.ok(res.sugestoes.length > 0, "sem sugestão " + modo + " " + valor); nf++; continue; }
    assert.equal(c(valor + soma(abertas(res))), s, modo + " " + valor);
  }
  assert.ok(nf <= 5, nf + " casos sem fechar");   // medido no plano: 4 em 3.000 com dados sintéticos
});
