/* 06/11/2026 (dono): aba Pré-reserva do cartão do condomínio. Sem contrato gerado: a aba fica disponível. Com
 * contrato gerado e sem pré-reserva (termo, situação ou data limite): oculta. Só dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
function trecho(src, ini) {
  const i = src.indexOf(ini); assert.ok(i >= 0, "não achei " + ini);
  let p = src.indexOf("{", i), n = 0, j = p;
  for (; j < src.length; j++) { if (src[j] === "{") n++; else if (src[j] === "}" && --n === 0) break; }
  return src.slice(i, j + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  vendas.match(/const cdNormK=.*;/)[0],
  trecho(vendas, "function cdVal(l,nome)"), trecho(vendas, "function cdTemArq(v)"), trecho(vendas, "function cdSit(l,col)"),
  trecho(vendas, "function condUsaPreReserva(l)"), trecho(vendas, "function condMostraAbaPR(l)"), trecho(vendas, "function condEtapas(l)"),
].join("\n"), ctx);
const linha = (v) => ({ id: "x", v: Object.assign({ "CONDOMÍNIO": "RESERVA DOS IPÊS", "UNIDADE": "13" }, v) });

test("sem contrato gerado: aba disponível, mesmo sem nada da pré-reserva", () => {
  assert.equal(ctx.condMostraAbaPR(linha({})), true);
  assert.equal(ctx.condMostraAbaPR(linha({ "CONTRATO GERADO": [] })), true);
});
test("contrato gerado (PDF ou envelope) e sem pré-reserva: oculta", () => {
  assert.equal(ctx.condMostraAbaPR(linha({ "CONTRATO GERADO": [{ name: "c.pdf" }] })), false);
  assert.equal(ctx.condMostraAbaPR(linha({ "ASSINATURA - SITUAÇÃO": "ENVIADO" })), false);
});
test("contrato gerado com pré-reserva (termo, situação ou data limite): continua aparecendo", () => {
  const c = { "CONTRATO GERADO": [{ name: "c.pdf" }] };
  assert.equal(ctx.condMostraAbaPR(linha({ ...c, "PRÉ-RESERVA - TERMO GERADO": [{ name: "t.pdf" }] })), true);
  assert.equal(ctx.condMostraAbaPR(linha({ ...c, "PRÉ-RESERVA - SITUAÇÃO": "ASSINADO" })), true);
  assert.equal(ctx.condMostraAbaPR(linha({ ...c, "PRÉ-RESERVA - DATA LIMITE": "2026-11-11" })), true);
});
test("a faixa de etapas não ganha a Pré-reserva só por estar sem contrato (o termo é opcional)", () => {
  const e = ctx.condEtapas(linha({}));
  assert.ok(!e.itens.some(x => x.nome === "Pré-reserva"));
  assert.equal(e.itens[e.atual].nome, "Datas do fluxo");
});
test("as abas usam a regra nova", () => {
  assert.match(trecho(vendas, "function condAbasHtml(l)"), /const pr=condMostraAbaPR\(l\);/);
});
