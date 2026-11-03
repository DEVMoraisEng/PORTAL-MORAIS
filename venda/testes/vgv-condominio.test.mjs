/* 03/11/2026 (dono): VGV do condomínio só com contrato ASSINADO, no mês da data de assinatura.
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const V = createRequire(import.meta.url)("../vgv-condominio.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");

const ler = (l, c) => (l.v[c] === undefined ? null : l.v[c]);
const linha = (id, v) => ({ id, v: Object.assign({ "CONDOMÍNIO": "RESERVA DE TESTE" }, v) });
const LINHAS = [
  linha("a", { "UNIDADE": "4", "ASSINATURA - SITUAÇÃO": "ASSINADO", "DATA DE ASSINATURA DO CONTRATO": "2026-10-31", "DATA DA VENDA": "2026-10-20", "VALOR DE VENDA": 300000 }),
  linha("b", { "UNIDADE": "17", "ASSINATURA - SITUAÇÃO": "ASSINADO", "DATA DE ASSINATURA DO CONTRATO": "2026-11-02", "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": 310000, "VALOR DE VENDA": 999 }),
  linha("c", { "UNIDADE": "18", "ASSINATURA - SITUAÇÃO": "ASSINADO", "DATA DA VENDA": "2026-09-15", "VALOR DE VENDA": 290000 }),
  linha("d", { "UNIDADE": "39", "ASSINATURA - SITUAÇÃO": "ENVIADO", "DATA DE ASSINATURA DO CONTRATO": "2026-11-03", "VALOR DE VENDA": 335000 }),
  linha("e", { "UNIDADE": "15", "ASSINATURA - SITUAÇÃO": "CANCELADO", "DATA DA VENDA": "0002-10-31", "VALOR DE VENDA": 305000 }),
  linha("f", { "UNIDADE": "32", "DATA DA VENDA": "2026-11-03", "VALOR DE VENDA": 325000 }),
  linha("g", { "UNIDADE": "40", "ASSINATURA - SITUAÇÃO": "assinado", "DATA DA VENDA": "0002-01-01", "VALOR DE VENDA": "R$ 280.000,00" })
];
const IT = V.itens(LINHAS, ler);

test("só ASSINADO conta; enviado fica em assinatura; cancelado e sem contrato ficam fora", () => {
  assert.deepEqual(IT.map(i => i.estado), ["assinado", "assinado", "assinado", "assinando", "fora", "fora", "assinado"]);
  const r = V.resumo(IT, V.periodo("tudo", { hoje: "2026-11-03" }));
  assert.equal(r.n, 3, "a casa 40 tem data inválida: não entra em período nenhum");
  assert.equal(r.vgv, 900000);
  assert.deepEqual(r.assinando, { n: 1, vgv: 335000 });
  assert.equal(r.semData, 1);
});

test("mês da venda = data de assinatura do contrato; sem ela, data da venda", () => {
  assert.equal(IT[0].data, "2026-10-31");
  assert.equal(IT[2].data, "2026-09-15");
  const out = V.resumo(IT, V.periodo("mes", { hoje: "2026-11-03", mes: "2026-10" }));
  assert.equal(out.n, 1); assert.equal(out.vgv, 300000);
  assert.equal(out.ant.vgv, 290000, "outubro compara com setembro");
});

test("valor do contrato vale antes do valor de venda; texto em reais é lido", () => {
  assert.equal(IT[1].valor, 310000);
  assert.equal(IT[6].valor, 280000);
});

test("ano antes de 2000 é data inválida", () => {
  assert.equal(V.dataIso("0002-10-31"), "");
  assert.equal(V.dataIso({ start: "2026-10-31" }), "2026-10-31");
  assert.equal(V.dataIso("2026-13-01"), "");
});

test("períodos: este mês compara com os mesmos dias do mês passado; trimestre, ano e livre", () => {
  const h = { hoje: "2026-11-03" };
  const m = V.periodo("mesat", h);
  assert.deepEqual([m.de, m.ate, m.ant.de, m.ant.ate], ["2026-11-01", "2026-11-03", "2026-10-01", "2026-10-03"]);
  const t = V.periodo("tri", { hoje: "2026-11-03", tri: "2026-4" });
  assert.deepEqual([t.de, t.ate, t.ant.de, t.ant.ate], ["2026-10-01", "2026-12-31", "2026-07-01", "2026-09-30"]);
  const a = V.periodo("ano", h);
  assert.deepEqual([a.de, a.ate, a.ant.de, a.ant.rotulo], ["2026-01-01", "2026-12-31", "2025-01-01", "2025"]);
  const l = V.periodo("livre", { hoje: "2026-11-03", de: "2026-11", ate: "2026-09" });
  assert.deepEqual([l.de, l.ate, l.ant.de, l.ant.ate], ["2026-09-01", "2026-11-30", "2026-06-01", "2026-08-31"], "de/até invertidos se acertam");
  assert.equal(V.periodo("tudo", h).ant, null);
  const mar = V.periodo("mesat", { hoje: "2027-03-31" });
  assert.equal(mar.ant.ate, "2027-02-28", "31 de março compara até o último dia de fevereiro");
});

test("série por mês cobre do primeiro ao último mês assinado, marcando o período", () => {
  const r = V.resumo(IT, V.periodo("mes", { hoje: "2026-11-03", mes: "2026-11" }));
  assert.deepEqual(r.porMes.map(x => [x.mes, x.vgv, x.noPeriodo]), [["2026-09", 290000, false], ["2026-10", 300000, false], ["2026-11", 310000, true]]);
  assert.equal(r.acumulado.vgv, 900000);
});

test("vendas.html carrega o módulo e desenha o VGV abaixo da tabela", () => {
  assert.match(vendas, /<script src="venda\/vgv-condominio\.js\?v=\d+"><\/script>/);
  const tabela = vendas.indexOf('id="cd-wrap"'), vgv = vendas.indexOf('id="cd-vgv"');
  assert.ok(tabela > 0 && vgv > tabela, "o bloco do VGV vem logo depois da tabela das unidades");
  assert.match(vendas, /vgvRender\(\)/);
});
