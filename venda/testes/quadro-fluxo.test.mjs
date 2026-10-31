/* 31/10/2026 (dono): o quadro "FLUXO DE PAGAMENTO PRO SOLUTO" do cartão da unidade segue o fluxo alterado no portal.
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Q = require("../quadro-fluxo.js");
const F = require("../FluxoLivre.js");
const D = require("../../venda-dossie.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");

/* venda de 350 mil: crédito 244.800, FGTS 8.688,73 → pro soluto 96.511,27, com um balão a mais que a proposta */
const FLUXO = {
  valor: 350000, entrega: "2028-11-30",
  linhas: [
    { t: "sinal", v: 1000, n: 1, d: "2026-10-31", i: 1, x: "" },
    { t: "sinal", v: 9000, n: 1, d: "2026-11-30", i: 1, x: "" },
    { t: "pre", v: 1500, n: 12, d: "2026-11-15", i: 1, x: "" },
    { t: "pre", v: 700, n: 12, d: "2027-11-15", i: 1, x: "" },
    { t: "balao", v: 20000, n: 1, d: "2027-12-15", i: 1, x: "" },
    { t: "balao", v: 10000, n: 1, d: "2027-06-15", i: 1, x: "pedido do cliente" },
    { t: "balao", v: 30111.27, n: 1, d: "2028-11-15", i: 1, x: "" },
    { t: "fin", v: 244800, n: 1, d: "", i: 1, x: "" },
    { t: "fgts", v: 8688.73, n: 1, d: "", i: 1, x: "" }
  ]
};
const texto = (f) => F.serializar(f);

test("sem fluxo alterado (vazio, ilegível ou não-texto): null — o cartão segue as colunas do simulador", () => {
  for (const t of ["", "   ", "{nada", '{"v":1}', null, undefined, 42]) assert.equal(Q.doTexto(t), null, String(t));
});

test("fluxo alterado: grupos na ordem do contrato, só o que o cliente paga, total = pro soluto", () => {
  const fx = Q.doTexto(texto(FLUXO));
  assert.equal(F.validar(FLUXO).ok, true, "o exemplo fecha ao centavo");
  assert.equal(fx.alterado, true);
  assert.deepEqual(fx.L.filter((x) => x.grupo).map((x) => x.grupo), ["SINAL", "PARCELAS PRÉ-CHAVES", "BALÕES"]);
  assert.equal(fx.total, 96511.27);
  assert.equal(fx.total, Math.round((fx.valor - fx.credito - fx.fgts - fx.subsidio) * 100) / 100, "pro soluto = valor − crédito − FGTS − subsídio");
  assert.deepEqual([fx.valor, fx.credito, fx.fgts, fx.subsidio], [350000, 244800, 8688.73, 0]);
  assert.ok(!fx.L.some((x) => /Financiamento|FGTS/.test(x.rot || "")), "financiamento e FGTS ficam fora do pro soluto");
});

test("cada linha: rótulo numerado por tipo, descrição, quantidade × valor, datas de/até e subtotal", () => {
  const fx = Q.doTexto(texto(FLUXO));
  const linha = (rot) => fx.L.find((x) => x.rot === rot);
  assert.deepEqual(linha("Pré-chaves 1"), { rot: "Pré-chaves 1", qtd: 12, val: 1500, ult: null, sub: 18000, quando: "15/11/2026 a 15/10/2027" });
  /* balões em ordem de data, não na ordem digitada */
  assert.deepEqual(fx.L.filter((x) => /^Balão/.test(x.rot || "")).map((x) => [x.rot, x.quando]),
    [["Balão 1 — pedido do cliente", "15/06/2027"], ["Balão 2", "15/12/2027"], ["Balão 3", "15/11/2028"]]);
  assert.equal(linha("Sinal 1").quando, "31/10/2026");
});

test("última parcela diferente (centavos do Redistribuir) e intervalo de meses aparecem", () => {
  const f = { valor: 10000.05, linhas: [{ t: "pos", v: 1000, n: 10, d: "2029-01-10", i: 3, x: "", u: 1000.05 }] };
  const fx = Q.doTexto(texto(f));
  assert.deepEqual(fx.L, [{ grupo: "PÓS-CHAVES" },
    { rot: "Pós-chaves", qtd: 10, val: 1000, ult: 1000.05, sub: 10000.05, quando: "10/01/2029 a 10/04/2031 (a cada 3 meses)" }]);
});

test("permuta e entrada à vista entram no pro soluto; venda sem comissão vem marcada", () => {
  const f = { valor: 50000, semComissao: true, linhas: [
    { t: "entrada", v: 5000, n: 1, d: "2026-10-31", i: 1, x: "" },
    { t: "permuta", v: 45000, n: 1, d: "2026-10-31", i: 1, x: "carro de teste 2020" }] };
  const fx = Q.doTexto(texto(f));
  assert.deepEqual(fx.L.map((x) => x.grupo || x.rot), ["ENTRADA À VISTA", "Entrada à vista", "PERMUTA", "Permuta — carro de teste 2020"]);
  assert.equal(fx.total, 50000);
  assert.equal(fx.semComissao, true);
});

test("vendas.html: carrega o quadro depois do FluxoLivre e o condFluxo usa a coluna FLUXO PERSONALIZADO", () => {
  const iF = vendas.indexOf('src="venda/FluxoLivre.js'), iQ = vendas.indexOf('src="venda/quadro-fluxo.js');
  assert.ok(iF > 0 && iQ > iF, "quadro-fluxo.js depois do FluxoLivre.js");
  const fluxo = vendas.slice(vendas.indexOf("function condFluxo(l){"), vendas.indexOf("function cdAchaNum("));
  assert.match(fluxo, /QuadroFluxo\.doTexto\(cdVal\(l,"FLUXO PERSONALIZADO"\)\)/);
  assert.match(vendas, /x\.ult\?/, "mostra a última parcela diferente");
  assert.match(vendas, /function condAplicarGravados\(/);
  assert.match(vendas, /condAplicarGravados\(String\(id\),ev\.detail\.gravados\)/);
});

test("dossiê: ao salvar ou voltar o fluxo avisa a tela com a coluna como ficou gravada", () => {
  const ed = { valor: FLUXO.valor, entrega: FLUXO.entrega, linhas: FLUXO.linhas };
  const salvo = D.detalheFluxoGravado("pg-1", ed, false);
  assert.equal(salvo.pageId, "pg-1");
  assert.deepEqual(Q.doTexto(salvo.gravados["FLUXO PERSONALIZADO"]), Q.doTexto(texto(FLUXO)));
  assert.equal(JSON.parse(D.detalheFluxoGravado("pg-1", { ...ed, semComissao: true }, false).gravados["FLUXO PERSONALIZADO"]).semComissao, true);
  assert.deepEqual(D.detalheFluxoGravado("pg-1", ed, true), { pageId: "pg-1", gravados: { "FLUXO PERSONALIZADO": "" } });
  const dossie = fs.readFileSync(path.join(RAIZ, "venda-dossie.js"), "utf8");
  assert.match(dossie, /new CustomEvent\(EVENTO_GRAVADO, \{ detail: detalheFluxoGravado\(pageId, ed, voltar\) \}\)/);
});
