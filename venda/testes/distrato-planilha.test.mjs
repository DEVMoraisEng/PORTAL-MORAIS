/* 11/11/2026 — Distrato pela Planilha Casas Condomínio (vendas.html, aba Resumo do cartão): o botão só aparece
 * com proposta ligada e para quem grava, e o pedido é o mesmo distrato da proposta em Simulações.
 * Só dados inventados. */
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
function ctxNovo(extra) {
  const ctx = Object.assign({ SO_LEITURA: false, COND: { titulo: "UNIDADE", linhas: [] },
    esc: (s) => String(s).replace(/</g, "&lt;"), console }, extra || {});
  vm.createContext(ctx);
  vm.runInContext([
    vendas.match(/const cdNormK=.*;/)[0],
    trecho(vendas, "function cdVal(l,nome)"),
    trecho(vendas, "function condPodeDistrato(l)"), trecho(vendas, "function condDistratoHtml(l)"),
    trecho(vendas, "async function condDistrato(id)"),
  ].join("\n"), ctx);
  return ctx;
}
const linha = (v) => ({ id: "L1", v: Object.assign({ "UNIDADE": "99" }, v) });

test("o cartão chama o distrato na aba Resumo", () => {
  assert.match(vendas, /condAtualizarVendaHtml\(l\)\+\s*condDistratoHtml\(l\)\+/);
});

test("botão só com proposta ligada e para quem grava", () => {
  const ctx = ctxNovo();
  assert.match(ctx.condDistratoHtml(linha({ "ID PROPOSTA": "abc" })), /Confirmar distrato/);
  assert.match(ctx.condDistratoHtml(linha({ "ID PROPOSTA": "abc" })), /Distrato da unidade 99/);
  assert.doesNotMatch(ctx.condDistratoHtml(linha({})), /Confirmar distrato/, "sem proposta: só o aviso");
  assert.match(ctx.condDistratoHtml(linha({})), /não tem proposta ligada/);
  ctx.SO_LEITURA = true;
  assert.equal(ctx.condDistratoHtml(linha({ "ID PROPOSTA": "abc" })), "", "só leitura não vê");
});

function domFalso(motivo) {
  const els = {
    "cd-dist-aviso": { style: {}, textContent: "", innerHTML: "" },
    "cd-dist-motivo": { value: motivo },
    "cd-dist-ok": { disabled: false },
    "cd-dist-box": { style: {} },
  };
  return { getElementById: (id) => els[id] || null, els };
}

test("sem motivo não chama o servidor", async () => {
  const chamadas = [];
  const doc = domFalso("   ");
  const ctx = ctxNovo({ document: doc, confirm: () => true, chamar: async (p) => { chamadas.push(p); return { ok: true }; },
    setInterval: () => 0, clearInterval: () => {}, condRender: () => {} });
  ctx.COND.linhas = [linha({ "ID PROPOSTA": "abc" })];
  await ctx.condDistrato("L1");
  assert.equal(chamadas.length, 0);
  assert.match(doc.els["cd-dist-aviso"].textContent, /motivo/);
});

test("confirmado: pede o distrato da proposta e tira a linha da planilha", async () => {
  const chamadas = [];
  const doc = domFalso("Cliente desistiu");
  let redesenhou = 0;
  const ctx = ctxNovo({ document: doc, confirm: () => true,
    chamar: async (p, tempo, prio) => { chamadas.push({ p, tempo, prio }); return { ok: true, unidade: "99", distrato: "d1", distratoUrl: "https://x", arquivos: { copiados: 2 } }; },
    setInterval: () => 0, clearInterval: () => {}, condRender: () => { redesenhou++; } });
  ctx.COND.linhas = [linha({ "ID PROPOSTA": "abc" }), { id: "L2", v: { "UNIDADE": "98" } }];
  await ctx.condDistrato("L1");
  assert.equal(chamadas.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(chamadas[0].p)), { action: "simsStatusInternoAcao", pageId: "abc", status: "DISTRATO", motivo: "Cliente desistiu" });
  assert.equal(chamadas[0].prio, true);
  assert.deepEqual(ctx.COND.linhas.map((x) => x.id), ["L2"]);
  assert.equal(redesenhou, 1);
  assert.match(doc.els["cd-dist-aviso"].innerHTML, /Distrato feito/);
});

test("erro do servidor: mostra a mensagem, não tira a linha e libera o botão", async () => {
  const doc = domFalso("x");
  const ctx = ctxNovo({ document: doc, confirm: () => true,
    chamar: async () => ({ ok: false, erro: "DISTRATOS", mensagem: "Não consegui gravar o distrato (nada foi apagado)" }),
    setInterval: () => 0, clearInterval: () => {}, condRender: () => {} });
  ctx.COND.linhas = [linha({ "ID PROPOSTA": "abc" })];
  await ctx.condDistrato("L1");
  assert.equal(ctx.COND.linhas.length, 1);
  assert.equal(doc.els["cd-dist-ok"].disabled, false);
  assert.match(doc.els["cd-dist-aviso"].textContent, /nada foi apagado/);
});
