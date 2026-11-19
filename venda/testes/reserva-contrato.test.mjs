/* Casa de rua: a reserva pelo contrato (05/11) foi removida pela REGRAS-TRAVADAS de 11/11 — gerar o contrato não reserva.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { colunasVenda, cenario } from "./contrato-cenario.mjs";

const require = createRequire(import.meta.url);
const R = require("../RegrasVenda.js");
const D = require("../../venda-dossie.js");

const G = "2026-11-05T13:00:00.000Z", T = Date.parse(G), H = 3600 * 1000;
const COLS_RESERVA = { "RESERVADA ": { tipo: "select", opcoes: ["SIM", "NÃO"] }, "DATA DA RESERVA": "date",
                       "CONTRATO - GERADO EM": "date", "ASSINATURA - SITUAÇÃO": "rich_text" };

test("RegrasVenda.reservaContrato: sem data nada; < 48 h reservada; 48 h libera; ASSINADO vende", () => {
  assert.equal(R.reservaContrato("", "ENVIADO"), null);
  assert.equal(R.reservaContrato("lixo", "ENVIADO"), null);
  assert.deepEqual(R.reservaContrato(G, "ENVIADO", T + 47 * H), { estado: "RESERVADA", geradoEm: G, ate: "2026-11-07T13:00:00.000Z" });
  assert.equal(R.reservaContrato(G, "ENVIADO", T + 48 * H).estado, "LIBERADA");
  assert.equal(R.reservaContrato(G, "assinado", T + 99 * H).estado, "VENDIDA");
  assert.equal(R.reservaContrato("2026-11-05T10:00:00.000-03:00", "", T).ate, "2026-11-07T13:00:00.000Z");
});

function aprovar(cols) {
  const c = cenario({ colunas: cols });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  const antes = c.n.patches.length;
  const r = c.acao("aprovarPreContrato");
  return { c, r, patches: c.n.patches.slice(antes) };
}

test("REGRAS-TRAVADAS (11/11): aprovar o contrato da casa de rua NÃO grava RESERVADA, DATA DA RESERVA nem CONTRATO - GERADO EM", () => {
  const { c, r, patches } = aprovar(Object.assign(colunasVenda(), COLS_RESERVA));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!patches.some((x) => x["CONTRATO - GERADO EM"] || x["RESERVADA "] || x["DATA DA RESERVA"]), JSON.stringify(patches));
  assert.equal(c.arquivos().length, 1);
  assert.equal(c.acao("contratoEstado").reserva, undefined);
});

test("vendas.html: régua do contrato 48 h removida — tem cliente = vendida", () => {
  const html = readFileSync(new URL("../../vendas.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /reservaContratoDe|RESERVA_CONTRATO_MS/);
  assert.match(html, /function vendidaDe\(rec\)\{ return temCliente\(rec\); \}/);
  assert.equal((html.match(/<option value="reservada">/g) || []).length, 0);
});
