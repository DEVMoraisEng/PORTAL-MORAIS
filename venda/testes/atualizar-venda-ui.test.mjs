/* 07/11/2026 — Atualizar venda pela proposta: quando o botão aparece na Planilha Casas Condomínio e o que a
 * janela grava (só o marcado, com o carimbo). DOM mínimo de mentira; só dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
const simul = fs.readFileSync(path.join(RAIZ, "simulacoes.html"), "utf8");
function trecho(src, ini) {
  const i = src.indexOf(ini); assert.ok(i >= 0, "não achei " + ini);
  let p = src.indexOf("{", i), n = 0, j = p;
  for (; j < src.length; j++) { if (src[j] === "{") n++; else if (src[j] === "}" && --n === 0) break; }
  return src.slice(i, j + 1);
}

test("as duas telas carregam venda/atualizar-venda.js", () => {
  assert.match(vendas, /<script src="venda\/atualizar-venda\.js\?v=\d+"><\/script>/);
  assert.match(simul, /<script src="venda\/atualizar-venda\.js\?v=\d+"><\/script>/);
  assert.match(simul, /AtualizarVendaUI\.botaoHtml\(p\.id,'prop','bt'\)/);
});

test("planilha: botão só com proposta ligada, sem contrato e para quem grava", () => {
  const ctx = { window: { AtualizarVendaUI: { botaoHtml: (pid) => "<BT " + pid + ">" } }, SO_LEITURA: false };
  ctx.AtualizarVendaUI = ctx.window.AtualizarVendaUI;
  vm.createContext(ctx);
  vm.runInContext([
    vendas.match(/const cdNormK=.*;/)[0],
    trecho(vendas, "function cdVal(l,nome)"), trecho(vendas, "function cdTemArq(v)"), trecho(vendas, "function cdSit(l,col)"),
    trecho(vendas, "function condPodeAtualizarVenda(l)"), trecho(vendas, "function condAtualizarVendaHtml(l)"),
  ].join("\n"), ctx);
  const linha = (v) => ({ id: "x", v: Object.assign({ "UNIDADE": "13" }, v) });
  assert.equal(ctx.condPodeAtualizarVenda(linha({ "ID PROPOSTA": "abc" })), true);
  assert.match(ctx.condAtualizarVendaHtml(linha({ "ID PROPOSTA": "abc" })), /<BT abc>/);
  assert.equal(ctx.condPodeAtualizarVenda(linha({})), false, "sem proposta ligada");
  assert.equal(ctx.condPodeAtualizarVenda(linha({ "ID PROPOSTA": "abc", "CONTRATO GERADO": [{ name: "c.pdf" }] })), false, "contrato gerado");
  assert.equal(ctx.condPodeAtualizarVenda(linha({ "ID PROPOSTA": "abc", "ASSINATURA - SITUAÇÃO": "ENVIADO" })), false, "envelope criado");
  ctx.SO_LEITURA = true;
  assert.equal(ctx.condPodeAtualizarVenda(linha({ "ID PROPOSTA": "abc" })), false, "só leitura");
});

/* DOM de mentira: só o que a janela usa */
function domFalso() {
  const porId = {};
  function el(tag) {
    const e = { tag, id: "", children: [], style: {}, dataset: {}, checked: false, disabled: false, textContent: "", className: "",
      classList: { toggle() {}, add() {}, remove() {} }, _html: "",
      addEventListener(t, f) { (this._ev = this._ev || {})[t] = f; }, appendChild(c) { this.children.push(c); if (c.id) porId[c.id] = c; varrer(c._html); },
      remove() { delete porId[this.id]; }, querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, parentNode: null };
    Object.defineProperty(e, "innerHTML", { get() { return this._html; }, set(v) { this._html = v; varrer(v); } });
    return e;
  }
  function varrer(html) {
    for (const m of String(html || "").matchAll(/<(\w+)[^>]*\sid="([^"]+)"[^>]*>/g)) {
      const e = el(m[1]); e.id = m[2]; if (/type="checkbox"[^>]*checked|checked[^>]*type="checkbox"/.test(m[0])) e.checked = true;
      porId[m[2]] = e;
    }
  }
  const document = { head: el("head"), body: el("body"), getElementById: (i) => porId[i] || null,
    createElement: (t) => el(t), addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  return { document, porId };
}

test("janela: compara, desmarca um, aplica só o marcado com o carimbo", async () => {
  const { document, porId } = domFalso();
  const pedidos = [];
  const respostas = {
    simsVendaComparar: { ok: true, proposta: "0123", unidade: "15", carimbo: "abcd1234", diferencas: [
      { coluna: "VALOR DE VENDA", naVenda: "R$ 289.000,00", naProposta: "R$ 284.500,00" },
      { coluna: "PROPONENTE", naVenda: "JOAO DA SILVA SAURO", naProposta: "JOAO DA SILVA" }] },
    simsVendaAplicar: { ok: true, aplicados: ["VALOR DE VENDA"] },
  };
  const ctx = { document, window: {}, console, setTimeout, String, Array, Object, Promise,
    chamar: async (p) => { pedidos.push(p); return respostas[p.action]; } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "venda", "atualizar-venda.js"), "utf8"), ctx);
  let aplicou = null;
  await ctx.AtualizarVendaUI.abrir("pid-1", { aoAplicar: (a) => { aplicou = a; } });
  assert.equal(pedidos[0].action, "simsVendaComparar");
  assert.ok(porId["av-c0"] && porId["av-c1"], "uma caixa por campo");
  assert.equal(porId["av-aplicar"].textContent, "Aplicar 2 mudanças");
  porId["av-c1"].checked = false; porId["av-c1"]._ev.change();
  assert.equal(porId["av-aplicar"].textContent, "Aplicar 1 mudança");
  await porId["av-aplicar"].onclick();
  const ap = pedidos.find((p) => p.action === "simsVendaAplicar");
  assert.deepEqual(Array.from(ap.colunas), ["VALOR DE VENDA"]);
  assert.equal(ap.carimbo, "abcd1234");
  assert.equal(ap.pageId, "pid-1");
  assert.ok(aplicou && aplicou.ok);
  assert.match(porId["av-corpo"].innerHTML, /Venda atualizada/);
});

test("janela: contrato gerado mostra a frase certa e não oferece aplicar", async () => {
  const { document, porId } = domFalso();
  const ctx = { document, console, setTimeout, String, Array, Object, Promise,
    chamar: async () => ({ ok: false, erro: "CONTRATO_JA_GERADO", mensagem: "x" }) };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "venda", "atualizar-venda.js"), "utf8"), ctx);
  await ctx.AtualizarVendaUI.abrir("pid-2");
  assert.match(porId["av-corpo"].innerHTML, /distrato ou aditivo/);
  assert.equal(porId["av-aplicar"], undefined);
});
