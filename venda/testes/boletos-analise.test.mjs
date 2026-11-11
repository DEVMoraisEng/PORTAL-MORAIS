/* Análise financeira do condomínio (11/11/2026): contas da tela. Dados inventados.
 * O gabarito venda/testes/dados/financeiro-analise.json é gerado pelo Python (test_financeiro_condominio.py --gabarito):
 * os totais da tela sem filtro têm de ser os do servidor, centavo por centavo. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const BA = require("../../boletos-analise.js");
const GAB = JSON.parse(readFileSync(new URL("./dados/financeiro-analise.json", import.meta.url), "utf8"));
const ind = (lista, chave) => lista.find(x => x.chave === chave);
const parc = (extra) => Object.assign({ u: "01", t: "pre", s: "", d: "2026-10-10", o: 1000, v: 1000, a: 1000, m: 0, q: "", r: [] }, extra);
const fin = (parcelas, extra) => Object.assign({ hoje: "2026-11-11", unidades: [{ unidade: "01", comprador: "COMPRADOR A" }, { unidade: "02", comprador: "COMPRADOR B" }], parcelas, indices: {} }, extra);

/* ------------------------------------------------------------ amarra com o servidor */
test("sem filtro, os totais da tela são os do servidor", () => {
  assert.deepEqual(BA.resumo(GAB, {}).totais, GAB.totais);
});
test("sem filtro, as unidades da tela são as do servidor", () => {
  const campos = u => [u.unidade, u.comprador, u.recebido, u.a_vencer, u.vencido, u.caixa, u.permuta, u.dias_atraso, JSON.stringify(u.proxima)];
  assert.deepEqual(BA.resumo(GAB, {}).unidades.map(campos), GAB.unidades.map(campos));
});
test("sem filtro, os títulos da tela são os do servidor", () => {
  const campos = t => [t.unidade, t.coluna, t.tipo, t.data, t.valor, t.dias_atraso];
  const ordena = l => l.map(campos).map(x => JSON.stringify(x)).sort();
  assert.deepEqual(ordena(BA.resumo(GAB, {}).titulos), ordena(GAB.titulos));
});

/* ------------------------------------------------------------ categoria, situação e filtros */
test("categoria: permuta e Caixa têm categoria própria", () => {
  assert.equal(BA.categoria(parc({ m: 1, t: "entrada" })), "permuta");
  assert.equal(BA.categoria(parc({ t: "terceiros", s: "fgts" })), "caixa");
  assert.equal(BA.categoria(parc({ t: "balao" })), "balao");
  assert.equal(BA.categoria(parc({ t: "esquisito" })), "outro");
});
test("situação: pago, vencido e a vencer pelo saldo e pela data", () => {
  assert.equal(BA.situacao(parc({ a: 0 }), "2026-11-11"), "pago");
  assert.equal(BA.situacao(parc({ d: "2026-11-10" }), "2026-11-11"), "vencido");
  assert.equal(BA.situacao(parc({ d: "2026-11-11" }), "2026-11-11"), "avencer");   // vence hoje: ainda não venceu
});
test("período usa o vencimento da parcela e a data do recebimento", () => {
  const f = fin([parc({ d: "2026-09-10", a: 0, q: "2026-10-02", r: [["2026-10-02", 1000]] }), parc({ d: "2026-10-10" })]);
  const s = BA.filtrar(f, { de: "2026-10", ate: "2026-10" });
  assert.deepEqual(s.parcelas.map(p => p.d), ["2026-10-10"]);
  assert.deepEqual(s.recebimentos.map(r => [r.data, r.c]), [["2026-10-02", 100000]]);   // a parcela de setembro, paga em outubro
});
test("recebimento sem data só entra sem período", () => {
  const f = fin([parc({ a: 0, r: [["", 1000]] })]);
  assert.equal(BA.filtrar(f, {}).recebimentos.length, 1);
  assert.equal(BA.filtrar(f, { de: "2026-01", ate: "" }).recebimentos.length, 0);
});
test("tipo, unidade e situação filtram parcelas e recebimentos juntos", () => {
  const f = fin([parc({ a: 0, r: [["2026-10-10", 1000]] }), parc({ u: "02", t: "balao", r: [] })]);
  assert.equal(BA.filtrar(f, { unidade: "02" }).recebimentos.length, 0);
  assert.deepEqual(BA.filtrar(f, { tipo: "balao" }).parcelas.map(p => p.u), ["02"]);
  assert.deepEqual(BA.filtrar(f, { situacao: "pago" }).parcelas.map(p => p.u), ["01"]);
});
test("pagamento em partes entra em dois meses no recebido", () => {
  const s = BA.series(fin([parc({ d: "2026-08-15", a: 0, q: "2026-09-02", r: [["2026-08-15", 404.97], ["2026-09-02", 409.03]] })]), {});
  assert.equal(s.recebido["2026-08"], 404.97);
  assert.equal(s.recebido["2026-09"], 409.03);
});

/* ------------------------------------------------------------ indicadores */
test("indicadores do gabarito, sem filtro", () => {
  const L = BA.indicadores(GAB, {});
  assert.deepEqual(L.map(x => x.chave), ["carteira", "recebido", "vencido", "doze", "correcao", "pontualidade", "atraso", "incc"]);
  // carteira: soma de v das 22 parcelas = 140168,07 (conferido em python: Σ v)
  assert.equal(ind(L, "carteira").valor, 140168.07);
  assert.equal(ind(L, "recebido").valor, 8456.0);
  // vencido do comprador: 01 nov/26? não (vence 10/11, já venceu: 514,00) + 02 set (506,40) + out (810,00) = 1830,40
  assert.equal(ind(L, "vencido").valor, 1830.4);
  assert.equal(ind(L, "vencido").alerta, true);
  // 1830,40 de 10276,40 que venceram até hoje, sem Caixa e permuta
  assert.match(ind(L, "vencido").sub, /^Inadimplência 17,8% do que já venceu$/);
});
test("a receber em 12 meses ignora o período, respeita a unidade e deixa a permuta fora", () => {
  const f = fin([parc({ d: "2026-11-20", a: 500 }), parc({ d: "2027-10-31", a: 300 }), parc({ d: "2027-11-01", a: 999 }),
                 parc({ d: "2026-12-01", a: 72000, m: 1 }), parc({ u: "02", d: "2026-12-01", a: 50 }), parc({ d: "2026-11-01", a: 7 })]);
  assert.equal(ind(BA.indicadores(f, { de: "2026-01", ate: "2026-01", unidade: "01" }), "doze").valor, 800);
});
test("correção: valor atual menos o original, e o percentual", () => {
  const L = BA.indicadores(fin([parc({ o: 1000, v: 1012.5 }), parc({ o: 0, v: 50 }), parc({ o: 2000, v: 2000 })]), {});
  assert.equal(ind(L, "correcao").valor, 12.5);
  assert.match(ind(L, "correcao").sub, /^\+0,42% sobre o valor original$/);      // 12,5 / 3000
});
test("pontualidade e atraso médio só com parcela quitada", () => {
  const L = BA.indicadores(fin([parc({ a: 0, q: "2026-10-10" }), parc({ a: 0, q: "2026-10-20" }), parc({ a: 0, q: "2026-10-16" }),
                                parc({ a: 500, q: "" }), parc({ a: 0, q: "2026-10-01" })]), {});
  assert.equal(ind(L, "pontualidade").valor, "50%");            // 2 de 4 até o vencimento
  assert.equal(ind(L, "atraso").valor, "8 dias");               // (10 + 6) / 2
});
test("sem parcela quitada: pontualidade e atraso com traço", () => {
  const L = BA.indicadores(fin([parc({})]), {});
  assert.equal(ind(L, "pontualidade").valor, "—");
  assert.equal(ind(L, "atraso").valor, "—");
});
test("INCC-M em 12 meses com a série do gabarito", () => {
  // 11 meses lidos (nov/25 a set/26): produto de (1 + x/100) - 1 = 4,41%
  const x = ind(BA.indicadores(GAB, {}), "incc");
  assert.equal(x.valor, "4,41%");
  assert.equal(x.sub, "11 meses lidos, até setembro/2026 · último: 0,42%");
});
test("INCC-M usa só os últimos 12 meses", () => {
  const meses = {}; for (let i = 1; i <= 12; i++) meses["2025-" + String(i).padStart(2, "0")] = 1; meses["2026-01"] = 2;
  const x = ind(BA.indicadores(fin([], { indices: { tabelas: { "INCC-M": meses } } }), {}), "incc");
  assert.equal(x.valor, (Math.pow(1.01, 11) * 1.02 * 100 - 100).toFixed(2).replace(".", ",") + "%");
  assert.equal(x.sub, "até janeiro/2026 · último: 2,00%");
});
test("sem índices: traço e aviso", () => {
  const x = ind(BA.indicadores(fin([]), {}), "incc");
  assert.equal(x.valor, "—");
  assert.equal(x.sub, "índices ainda não lidos");
});

/* ------------------------------------------------------------ séries */
test("FGTS e permuta fora do recebido × previsto e da inadimplência", () => {
  const s = BA.series(fin([parc({ t: "terceiros", d: "2026-09-01", a: 50000, v: 50000, o: 50000 }), parc({ m: 1, d: "2026-09-01", a: 72000, v: 72000, o: 72000 })]), {});
  assert.deepEqual(Object.values(s.previsto).filter(Boolean), []);
  assert.deepEqual(Object.values(s.inadimplencia).filter(Boolean), []);
  assert.deepEqual(s.porTipo.map(x => x.cat), ["permuta", "caixa"]);
});
test("previsto: até o mês atual o que vencia, depois o que falta entrar", () => {
  const s = BA.series(fin([parc({ d: "2026-10-10", v: 1000, a: 0 }), parc({ d: "2026-12-10", v: 1000, a: 400 })]), {});
  assert.equal(s.previsto["2026-10"], 1000);
  assert.equal(s.previsto["2026-12"], 400);
});
test("inadimplência no fim do mês: some quando a baixa entra", () => {
  // venceu 15/09, pago em 02/10: devia no fim de setembro, não no fim de outubro
  const s = BA.series(fin([parc({ d: "2026-09-15", v: 800, a: 0, q: "2026-10-02", r: [["2026-10-02", 800]] })]), {});
  assert.equal(s.inadimplencia["2026-09"], 800);
  assert.equal(s.inadimplencia["2026-10"], 0);
  assert.ok(!("2026-11" in s.inadimplencia));                 // mês atual ainda não fechou
});
test("inadimplência conta parcela antiga mesmo com o período começando depois", () => {
  const s = BA.series(fin([parc({ d: "2026-03-10", v: 500, a: 500 })]), { de: "2026-09", ate: "2026-10" });
  assert.deepEqual(s.meses, ["2026-09", "2026-10"]);
  assert.equal(s.inadimplencia["2026-09"], 500);
});
test("índice usado na correção do mês é o INCC-M de dois meses antes", () => {
  const s = BA.series(fin([parc({ d: "2026-11-10", o: 1000, v: 1004.2 })], { indices: { tabelas: { "INCC-M": { "2026-09": 0.42 } } } }), {});
  assert.equal(s.correcao["2026-11"], 4.2);
  assert.deepEqual(s.indiceUsado["2026-11"], { mes: "2026-09", valor: 0.42 });
});
test("período Tudo vai do primeiro ao último mês dos dados", () => {
  const s = BA.series(fin([parc({ d: "2026-08-10", a: 0, r: [["2026-07-30", 1000]] }), parc({ d: "2026-10-10" })]), {});
  assert.deepEqual(s.meses, ["2026-07", "2026-08", "2026-09", "2026-10"]);
});
test("a receber por tipo do maior para o menor, sem zero", () => {
  const s = BA.series(GAB, {});
  assert.deepEqual(s.porTipo.map(x => x.cat), ["permuta", "caixa", "balao", "pre"]);
});

/* ------------------------------------------------------------ filtro muda o financeiro */
test("filtro de unidade muda os cinco números", () => {
  const r = BA.resumo(GAB, { unidade: "02" });
  assert.deepEqual([r.totais.recebido, r.totais.vencido, r.totais.a_vencer], [1914, 1316.4, 815.67]);
  assert.deepEqual(r.unidades.map(u => u.unidade), ["02"]);
});
test("arquivo velho, sem parcelas: tudo vazio e nada quebra", () => {
  const velho = Object.assign({}, GAB); delete velho.parcelas;
  assert.equal(BA.temAnalise(velho), false);
  assert.equal(BA.temAnalise(GAB), true);
  assert.doesNotThrow(() => { BA.indicadores(velho, {}); BA.series(velho, {}); });
});
test("atalhos: este mês, próximos 3, este ano, tudo", () => {
  assert.deepEqual(BA.atalho("mes", "2026-11-11"), { de: "2026-11", ate: "2026-11" });
  assert.deepEqual(BA.atalho("3m", "2026-11-11"), { de: "2026-11", ate: "2027-01" });
  assert.deepEqual(BA.atalho("ano", "2026-11-11"), { de: "2026-01", ate: "2026-12" });
  assert.deepEqual(BA.atalho("tudo", "2026-11-11"), { de: "", ate: "" });
});
