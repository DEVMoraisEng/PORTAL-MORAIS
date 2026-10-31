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
/* Saldo de depois = o que fica em aberto. O que estava fora da conta no retrato de antes (paga, recebida em parte,
   vencida, ou tipo fora de pré/balão/pós) nunca entra: senão o sinal, os terceiros e as pré já pagas (245.220,05 na
   venda base) somariam como se ainda fossem devidos. E o que estava fora tem de ficar exatamente igual. */
const CONTA = ["pre", "balao", "pos"];
const foraDaConta = (r, data) => new Set(r.parcelas.filter((p) => p.pago || p.parcial || !CONTA.includes(p.tipo) || p.data < data).map((p) => p.id));
const abertas = (res, r = R.base, data = DATA) => {
  const fora = foraDaConta(r, data);
  for (const p of res.depois) if (fora.has(p.id)) assert.ok(p.acao === "igual" && p.raw === p.rawAntes && p.valor === p.valorAntes, "parcela fora da conta mudou " + p.id);
  return res.depois.filter((p) => p.acao !== "quita" && !fora.has(p.id));
};
/* Retrato com fator diferente em cada parcela (1,0 a 1,3), valor = c(raw × fator) arredondado como o ERP. */
const cERP = (x) => Math.round((Number(x) + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
function retratoHetero(semente) {
  const sorteio = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
  const r = structuredClone(R.base);
  for (const p of r.parcelas) if (CONTA.includes(p.tipo)) { p.fator = 1 + Number((sorteio() * 30).toFixed(4)) / 100; p.valor = cERP(p.raw * p.fator); }
  return r;
}

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
  assert.deepEqual(res.resumo.proximo, { data: "2028-05-10", valor: 312.35 });
});

test("resumo só olha o que estava em aberto: pré de nov/26 já paga não vira 'próximo pagamento'", () => {
  const r = structuredClone(R.base); r.parcelas.find((p) => p.tipo === "pre" && p.data === "2026-11-10").pago = true;
  // nov/26 paga = 331,84 a menos no saldo: 30.000 − 331,84 cobre o mesmo trecho que os 30.000 da venda base
  const res = A.simular(r, { modo: "A", valor: 29668.16, dataPg: DATA });
  assert.equal(res.ok, true, res.erro);
  assert.deepEqual(res.resumo.proximo, { data: "2028-05-10", valor: 312.35 });
});

test("simular com parcela vencida presente: ela fica igual, fora do saldo, e a conta fecha", () => {
  const D2 = "2026-11-15", r = R.base;
  const s = A.situacao(r, D2), venc = r.parcelas.find((p) => p.tipo === "pre" && p.data === "2026-11-10");
  assert.ok(s.vencidas.some((v) => v.id === venc.id));
  const res = A.simular(r, { modo: "B", valor: 20000, dataPg: D2 });
  assert.equal(res.ok, true, res.erro);
  assert.equal(res.depois.find((p) => p.id === venc.id).acao, "igual");
  assert.equal(c(20000 + soma(abertas(res, r, D2))), s.saldo);
  assert.deepEqual(res.travas, []);
});

test("o resultado não depende da ordem das parcelas no retrato (desempate por data, tipo, id)", () => {
  const inv = structuredClone(R.base); inv.parcelas.reverse();
  const porId = (res) => Object.fromEntries(res.depois.map((p) => [p.id, [p.raw, p.valor, p.acao]]));
  // 663,68 e 10.387,38 (A) e 27.059,36 (C) param exatamente no empate de 10/12/2026 (pré e balão na mesma data)
  for (const modo of ["A", "B", "C"]) for (const valor of [30000, 663.68, 10387.38, 27059.36, 12345.67]) {
    const a = A.simular(R.base, { modo, valor, dataPg: DATA }), b = A.simular(inv, { modo, valor, dataPg: DATA });
    assert.equal(a.ok, b.ok, modo + " " + valor);
    if (a.ok) { assert.deepEqual(porId(a), porId(b), modo + " " + valor); assert.deepEqual(a.resumo, b.resumo); }
  }
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

test("E: quantas tem de ser inteiro de 1 até as pós em aberto; null/undefined = todas", () => {
  for (const q of [0, -3, "abc", "", NaN, Infinity, 2.7, 99, "6"]) {
    assert.equal(A.simular(R.base, { modo: "E", quantas: q, dataPg: DATA }).erro, "QUANTAS_INVALIDA", String(q));
  }
  for (const q of [null, undefined]) assert.equal(A.simular(R.base, { modo: "E", quantas: q, dataPg: DATA }).valor, 19025.04);
  assert.equal(A.simular(R.base, { modo: "E", quantas: 24, dataPg: DATA }).valor, 19025.04);
  assert.equal(A.simular(R.base, { modo: "E", quantas: 1, dataPg: DATA }).valor, 792.71);
});

test("entrada: data fora de aaaa-mm-dd dá DATA_INVALIDA; valor com mais de 2 casas ou não finito dá VALOR_INVALIDO", () => {
  for (const d of ["", "21/10/2026", "2026-10-21x", "2026-1-21", undefined, null, 20261021]) {
    assert.equal(A.simular(R.base, { modo: "A", valor: 1000, dataPg: d }).erro, "DATA_INVALIDA", String(d));
  }
  for (const v of [100.001, 0.005, NaN, Infinity, "abc", null]) {
    assert.equal(A.simular(R.base, { modo: "A", valor: v, dataPg: DATA }).erro, "VALOR_INVALIDO", String(v));
  }
  assert.equal(A.simular(R.base, { modo: "A", valor: 0.1 + 0.2, dataPg: DATA }).ok, true);   // ruído de ponto flutuante não é 3ª casa
  assert.equal(A.simular(R.base, { modo: "Z", valor: 1000, dataPg: DATA }).erro, "MODO_INVALIDO");
});

test("retrato incoerente (valor ≠ raw × fator numa parcela em aberto) é recusado antes da conta", () => {
  const r = structuredClone(R.base); const p = r.parcelas.find((x) => x.tipo === "pos"); p.valor = c(p.valor + 0.01);
  for (const modo of ["A", "B", "C", "E"]) assert.equal(A.simular(r, { modo, valor: 1000, dataPg: DATA }).erro, "RETRATO_INCOERENTE", modo);
  const pg = structuredClone(R.base); pg.parcelas.find((x) => x.pago && x.tipo === "pre").valor += 5;   // paga incoerente não importa
  assert.equal(A.simular(pg, { modo: "A", valor: 1000, dataPg: DATA }).ok, true);
});

test("D: a parcela escolhida cai exatamente o valor pago, nenhuma outra muda (0,08 no balão não fecha e sugere)", () => {
  const b = A.situacao(R.base, DATA).balaoes[0];
  const r8 = A.simular(R.base, { modo: "D", valor: 0.08, dataPg: DATA, parcelaId: b.id });
  assert.equal(r8.erro, "NAO_FECHA");
  assert.ok(r8.sugestoes.length > 0);
  for (let v = 0.01; v <= 1.5; v = c(v + 0.01)) {
    const res = A.simular(R.base, { modo: "D", valor: v, dataPg: DATA, parcelaId: b.id });
    const vs = res.ok ? [v] : (assert.equal(res.erro, "NAO_FECHA", String(v)), assert.ok(res.sugestoes.length > 0, "sem sugestão " + v), res.sugestoes);
    for (const s of vs) {
      const ok = res.ok ? res : A.simular(R.base, { modo: "D", valor: s, dataPg: DATA, parcelaId: b.id });
      assert.equal(ok.ok, true, "sugestão " + s);
      const pb = ok.depois.find((p) => p.id === b.id);
      assert.equal(c(pb.valorAntes - pb.valor), s, "caiu diferente do pago " + s);
      assert.deepEqual(ok.depois.filter((p) => p.id !== b.id && p.acao !== "igual"), [], "mexeu em outra " + s);
    }
  }
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

test("travas pegam adulteração em parcela fora da conta, sumida, repetida, fator, coerência e valor da antecipação", () => {
  const res = A.simular(R.base, { modo: "B", valor: 30000, dataPg: DATA });
  assert.deepEqual(A.travas(R.base, res), []);
  const pega = (nome, f, r = R.base, base = res) => { const x = structuredClone(base); f(x); assert.ok(A.travas(r, x).length > 0, nome); };
  const pagaPre = (x) => x.depois.find((p) => p.tipo === "pre" && p.data === "2025-03-10");
  pega("sinal pago vira quita", (x) => { const p = x.depois.find((q) => q.tipo === "sinal"); p.acao = "quita"; p.raw = 0; p.valor = 0; });
  pega("terceiros pago cai para 1", (x) => { const p = x.depois.find((q) => q.tipo === "terceiros"); p.raw = 1; p.valor = 1; p.acao = "reduz"; });
  pega("pré paga com valor mexido e ação igual", (x) => { const p = pagaPre(x); p.raw = c(p.raw - 0.01); p.valor = c(p.raw * p.fator); });
  pega("pré paga some do depois", (x) => { x.depois = x.depois.filter((p) => p !== pagaPre(x)); });
  pega("parcela repetida", (x) => { x.depois.push(structuredClone(x.depois[0])); });
  pega("elegível some e o valor compensa", (x) => { const i = x.depois.findIndex((p) => p.tipo === "pos"); x.valor = c(x.valor + x.depois[i].valor); x.depois.splice(i, 1); });
  pega("valor corrigido sobe sem o raw subir", (x) => { const ps = x.depois.filter((p) => p.tipo === "pos"); ps[0].valor = c(ps[0].valor + 50); ps[1].valor = c(ps[1].valor - 50); });
  pega("fator trocado", (x) => { const p = x.depois.find((q) => q.tipo === "pos"); p.fator = 5; });
  pega("valor ≠ raw × fator", (x) => { const p = x.depois.find((q) => q.acao === "reduz"); p.valor = c(p.valor - 0.01); x.valor = c(x.valor + 0.01); });
  pega("quita com valor sobrando", (x) => { const p = x.depois.find((q) => q.tipo === "pos"); p.acao = "quita"; x.valor = c(x.valor + p.valor); });
  for (const v of [NaN, undefined, 0, -1, Infinity, "30000"]) pega("valor da antecipação " + String(v), (x) => { x.valor = v; });
  const D2 = "2026-11-15", res2 = A.simular(R.base, { modo: "B", valor: 20000, dataPg: D2 });
  pega("vencida vira quita", (x) => { const p = x.depois.find((q) => q.tipo === "pre" && q.data === "2026-11-10"); p.acao = "quita"; p.raw = 0; p.valor = 0; x.valor = c(x.valor + 331.84); }, R.base, res2);
  const parc = structuredClone(R.base); const pp = parc.parcelas.find((p) => p.tipo === "pos"); pp.parcial = true;
  const res3 = A.simular(parc, { modo: "B", valor: 20000, dataPg: DATA });
  pega("recebida em parte reduzida", (x) => { const p = x.depois.find((q) => q.id === pp.id); p.raw = c(p.raw - 1); p.valor = c(p.raw * p.fator); p.acao = "reduz"; }, parc, res3);
});

for (const [nomeR, ret] of [["base", R.base], ["fatores 1,0 a 1,3 por parcela", retratoHetero(97)]]) {
  test("centavo fecha em 500 casos sorteados A-E, " + nomeR + " (ou NAO_FECHA com sugestão que fecha, nunca soma errada)", () => {
    let semente = 7; const sorteio = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
    const sit = A.situacao(ret, DATA), s = sit.saldo, nf = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    const confere = (o, res) => {
      assert.equal(res.ok, true, JSON.stringify(o) + " " + res.erro);
      assert.equal(c(res.valor + soma(abertas(res, ret))), s, JSON.stringify(o));
      assert.deepEqual(res.travas, []);
      const caiu = (p) => c(p.valorAntes - p.valor), mud = res.depois.filter((p) => p.acao !== "igual");
      if (o.modo === "A" || o.modo === "C")   // fora a divisa, quem o cliente não escolheu cai no máximo 0,05
        assert.ok(mud.filter((p) => p.acao === "reduz" && caiu(p) > 0.05).length <= 1, JSON.stringify(o));
      if (o.modo === "D") {
        assert.deepEqual(mud.filter((p) => p.id !== o.parcelaId), [], "D mexeu em outra " + JSON.stringify(o));
        assert.equal(caiu(res.depois.find((p) => p.id === o.parcelaId)), o.valor, "D caiu diferente do pago " + JSON.stringify(o));
      }
      if (o.modo === "E") assert.equal(mud.filter((p) => p.acao === "reduz").length, 0);
    };
    for (let i = 0; i < 500; i++) {
      const modo = ["A", "B", "C", "D", "E"][i % 5], o = { modo, dataPg: DATA };
      if (modo === "D") { const p = sit.elegiveis[Math.floor(sorteio() * sit.elegiveis.length)]; o.parcelaId = p.id; o.valor = c(0.01 + sorteio() * (p.valor - 0.01)); }
      else if (modo === "E") o.quantas = 1 + Math.floor(sorteio() * sit.posAbertas);
      else o.valor = c(1 + sorteio() * (s - 2));
      const res = A.simular(ret, o);
      if (res.ok) { confere(o, res); continue; }
      assert.equal(res.erro, "NAO_FECHA", JSON.stringify(o) + " " + res.erro);
      assert.ok(res.sugestoes.length > 0, "sem sugestão " + JSON.stringify(o));
      for (const v of res.sugestoes) { const o2 = { ...o, valor: v }; confere(o2, A.simular(ret, o2)); }
      nf[modo]++;
    }
    assert.ok(nf.A + nf.B + nf.C <= 5, JSON.stringify(nf) + " casos A/B/C sem fechar");
    assert.equal(nf.E, 0);
    assert.ok(nf.D <= 20, JSON.stringify(nf) + " casos D sem fechar");   // D exige queda exata: com fator > 1 nem todo centavo existe (medido 4 e 10 em 100)
  });
}
