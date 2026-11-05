/* 05/11/2026 (dono), casa de rua: gerar o contrato final reserva a casa — RESERVADA = SIM, DATA DA RESERVA e
 * CONTRATO - GERADO EM = agora; 48 h para todos assinarem (RegrasVenda.reservaContrato, bloco do contrato).
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

test("aprovar o contrato da casa de rua grava RESERVADA = SIM, DATA DA RESERVA e CONTRATO - GERADO EM (data com hora)", () => {
  const t0 = Date.now();
  const { c, r, patches } = aprovar(Object.assign(colunasVenda(), COLS_RESERVA));
  assert.equal(r.ok, true, JSON.stringify(r));
  const p = patches.find((x) => x["CONTRATO - GERADO EM"]);
  assert.ok(p, JSON.stringify(patches));
  assert.deepEqual(p["RESERVADA "], { select: { name: "SIM" } }, "nome real da coluna, com o espaço sobrando");
  const em = p["CONTRATO - GERADO EM"].date.start;
  assert.match(em, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "com hora");
  assert.ok(Date.parse(em) >= t0 - 1000);
  assert.equal(p["DATA DA RESERVA"].date.start, em);
  /* o contrato continua anexado e o contratoEstado traz o prazo */
  assert.equal(c.arquivos().length, 1);
  const e = c.acao("contratoEstado");
  assert.equal(e.reserva.estado, "RESERVADA");
  assert.equal(Date.parse(e.reserva.ate) - Date.parse(em), 48 * H);
  /* depois de assinado por todos: VENDIDA */
  c.n.pagina.properties["ASSINATURA - SITUAÇÃO"] = { type: "rich_text", rich_text: [{ plain_text: "ASSINADO", text: { content: "ASSINADO" } }] };
  assert.equal(c.acao("contratoEstado").reserva.estado, "VENDIDA");
});

test("sem as colunas da reserva a geração segue: contrato anexado, aviso no log, nenhum PATCH com coluna inexistente", () => {
  const { c, r, patches } = aprovar(colunasVenda());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.arquivos().length, 1);
  assert.ok(!patches.some((x) => x["CONTRATO - GERADO EM"] || x.RESERVADA || x["DATA DA RESERVA"]));
  assert.ok(c.g.logs.some((l) => /reserva: coluna faltando ou de outro tipo: RESERVADA, DATA DA RESERVA, CONTRATO - GERADO EM/.test(l)), c.g.logs.join("\n"));
  assert.equal(c.acao("contratoEstado").reserva, undefined);
});

test("só a CONTRATO - GERADO EM faltando: grava as outras duas e avisa", () => {
  const cols = Object.assign(colunasVenda(), COLS_RESERVA);
  delete cols["CONTRATO - GERADO EM"];
  const { r, patches, c } = aprovar(cols);
  assert.equal(r.ok, true);
  const p = patches.find((x) => x["RESERVADA "]);
  assert.ok(p && p["DATA DA RESERVA"] && !p["CONTRATO - GERADO EM"]);
  assert.ok(c.g.logs.some((l) => /coluna faltando ou de outro tipo: CONTRATO - GERADO EM$/.test(l)));
});

test("bloco do contrato: 'Reservada até dd/mm hh:mm — 48 h para assinar'; vencido avisa e aponta o Cancelar envelope", () => {
  const est = D.estadoContrato({ ok: true, gerado: true, etapa: "FINAL", nome: "CONTRATO - X.pdf", url: "https://x",
                                 reserva: { estado: "RESERVADA", geradoEm: G, ate: "2026-11-07T13:00:00.000Z" } });
  assert.equal(est.reserva.ate, "2026-11-07T13:00:00.000Z");
  const ok = D.htmlReservaContrato(est.reserva, T + H);
  assert.match(ok, /Reservada até \d\d\/\d\d \d\d:\d\d — 48 h para assinar/);
  const venc = D.htmlReservaContrato(est.reserva, T + 49 * H);
  assert.ok(venc.includes(D.MSG_RESERVA_VENCIDA), venc);
  assert.match(venc, /Cancelar envelope/);
  assert.equal(D.MSG_RESERVA_VENCIDA, "Prazo de 48 h para assinar venceu — casa liberada no mapa");
  assert.match(D.htmlReservaContrato({ estado: "VENDIDA", ate: "2026-11-07T13:00:00.000Z" }, T + 99 * H), /casa vendida/);
  assert.equal(D.htmlReservaContrato(null), "");
  /* entra no bloco FINAL e no só leitura (envelope aberto) */
  assert.match(D.htmlContrato(est, { ocupadoContrato: null, testes: false }), /dz-reserva/);
  assert.match(D.htmlContratoLeitura(est, {}), /dz-reserva/);
  /* resposta sem prazo válido não vira bloco */
  assert.equal(D.estadoContrato({ gerado: true, reserva: { estado: "RESERVADA", ate: "<b>" } }).reserva, undefined);
});

test("vendas.html: mesma régua (reservaContratoDe / vendidaDe) e 'reservada' fora de vendida e disponível", () => {
  const html = readFileSync(new URL("../../vendas.html", import.meta.url), "utf8");
  const trecho = /const RESERVA_CONTRATO_MS=[\s\S]*?\nfunction situacoesDe/.exec(html)[0].replace(/\nfunction situacoesDe$/, "");
  const getV = (o, n) => o[n];
  const normNome = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  const f = new Function("getV", "normNome", "temCliente", trecho + "; return { reservaContratoDe, vendidaDe };");
  const { reservaContratoDe, vendidaDe } = f(getV, normNome, () => true);
  assert.equal(reservaContratoDe({}), null);
  assert.equal(vendidaDe({ valores: {} }), true, "sem contrato gerado: tem cliente = vendida (como sempre)");
  const agora = new Date().toISOString();
  assert.equal(reservaContratoDe({ "CONTRATO - GERADO EM": agora }), "RESERVADA");
  assert.equal(vendidaDe({ valores: { "CONTRATO - GERADO EM": agora } }), false);
  assert.equal(reservaContratoDe({ "CONTRATO - GERADO EM": new Date(Date.now() - 49 * H).toISOString() }), "LIBERADA");
  assert.equal(vendidaDe({ valores: { "CONTRATO - GERADO EM": agora, "ASSINATURA - SITUAÇÃO": "ASSINADO" } }), true);
  assert.match(html, /else if\(rc==="RESERVADA"\)\{ arr\.push\("reservada"\); \}/);
  assert.equal((html.match(/<option value="reservada">/g) || []).length, 2);
});
