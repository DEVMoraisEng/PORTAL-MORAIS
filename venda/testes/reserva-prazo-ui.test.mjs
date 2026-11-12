/* 12/11/2026 (dono): Adiar / Reabrir reserva e a faixa "a reserva da unidade X cai amanhã" (venda/reserva-prazo-ui.js).
 * Sem navegador: um DOM mínimo e o chamar() simulado. Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fonte = fs.readFileSync(path.join(RAIZ, "venda", "reserva-prazo-ui.js"), "utf8");

function montar(respostas) {
  const pedidos = [], els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: "", style: {}, className: "", querySelectorAll: () => [] });
  const ctx = {
    console, Date, JSON, Math, Intl, setTimeout: () => 0, setInterval: () => 1,
    document: { hidden: false, getElementById: id => (id === "rp-estilo" ? {} : el(id)), head: { appendChild() {} } },
    chamar: async (p) => { pedidos.push(p); const r = respostas[p.action]; return typeof r === "function" ? r(p) : r; },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonte.replace('typeof window !== "undefined" ? window : globalThis', "window"), ctx);
  return { ctx, ui: ctx.ReservaPrazoUI, pedidos, el };
}
const AGORA = new Date("2026-11-12T15:00:00Z").getTime();   /* 12/11 12:00 em São Paulo */

test("datas: hoje em São Paulo, soma de dias e a sugestão (vence + 5, entre amanhã e hoje + 30)", () => {
  const { ui } = montar({});
  const t = ui._t;
  assert.equal(t.hojeIso(new Date("2026-11-13T02:30:00Z").getTime()), "2026-11-12");   /* 23:30 de 12/11 em SP */
  assert.equal(t.somaDias("2026-11-28", 5), "2026-12-03");
  assert.equal(t.sugestao("2026-11-14T02:59:59.000Z", AGORA), "2026-11-18");
  assert.equal(t.sugestao("2026-11-01T02:59:59.000Z", AGORA), "2026-11-13");   /* já vencida: amanhã */
  assert.equal(t.sugestao("2026-12-20T02:59:59.000Z", AGORA), "2026-12-12");   /* teto de 30 dias */
  assert.equal(t.br("2026-11-19"), "19/11/2026");
});

test("frase da faixa: unidade, cliente, corretor e quando cai", () => {
  const { ui } = montar({});
  const f = ui._t.frase({ unidade: "45", cliente: "CLIENTE TESTE", corretor: "CORRETOR TESTE", vence: "2026-11-14T02:59:59.000Z", quando: "amanha" });
  assert.match(f, /A reserva da <b>unidade 45<\/b> do cliente <b>CLIENTE TESTE<\/b> e corretor <b>CORRETOR TESTE<\/b> cai amanhã \(13\/11, às 23:59\)\./);
  assert.match(ui._t.frase({ unidade: "1", cliente: "A", corretor: "B", vence: "2026-11-13T02:59:59.000Z", quando: "hoje" }), /cai hoje, às 23:59/);
  assert.match(ui._t.frase({ unidade: "<x>", cliente: "", corretor: "", vence: "2026-11-13T02:59:59.000Z", quando: "hoje" }), /&lt;x&gt;.*sem nome.*sem corretor/);
});

test("faixa: pinta cada reserva; botão Adiar só para quem pode; some quando não há nada", async () => {
  const lista = [{ pageId: "p1", unidade: "45", cliente: "C", corretor: "K", vence: "2026-11-14T02:59:59.000Z", quando: "amanha" },
                 { pageId: "p2", unidade: "46", cliente: "D", corretor: "L", vence: "2026-11-13T02:59:59.000Z", quando: "hoje" }];
  const a = montar({ simsReservasVencendo: { ok: true, podeAdiar: true, reservas: lista } });
  await a.ui.faixa("f");
  const h = a.el("f").innerHTML;
  assert.equal((h.match(/class="rp-faixa"/g) || []).length, 2);
  assert.equal((h.match(/data-rp-i=/g) || []).length, 2);
  assert.equal(a.ctx.__rpPodeAdiar, true);
  const b = montar({ simsReservasVencendo: { ok: true, podeAdiar: false, reservas: lista } });
  await b.ui.faixa("f");
  assert.equal((b.el("f").innerHTML.match(/data-rp-i=/g) || []).length, 0);
  assert.match(b.el("f").innerHTML, /unidade 45/);
  const c = montar({ simsReservasVencendo: { ok: true, podeAdiar: true, reservas: [] } });
  await c.ui.faixa("f");
  assert.equal(c.el("f").innerHTML, ""); assert.equal(c.el("f").style.display, "none");
});

test("botões do cartão: Adiar na RESERVADA, Reabrir na que caiu há até 7 dias, nada para quem não pode", async () => {
  const { ui, ctx } = montar({ simsReservasVencendo: { ok: true, podeAdiar: true, reservas: [] } });
  await ui.faixa("f");
  const res = { id: "p1", status: "RESERVADA", unidade: "45", cliente: "C", dados: { reserva: { vence: "2026-11-14T02:59:59.000Z" } } };
  assert.match(ui.botoesProposta(res), /Adiar reserva/);
  const caiu = { id: "p2", status: "NEGADA", unidade: "45", dados: { reservaCaiu: { em: new Date(Date.now() - 2 * 86400000).toISOString() } } };
  assert.match(ui.botoesProposta(caiu), /Reabrir reserva que caiu/);
  const velha = { id: "p3", status: "NEGADA", unidade: "45", dados: { reservaCaiu: { em: new Date(Date.now() - 8 * 86400000).toISOString() } } };
  assert.equal(ui.botoesProposta(velha), "");
  assert.equal(ui.botoesProposta({ id: "p4", status: "NEGADA", dados: {} }), "");   /* negada à mão, sem queda */
  assert.equal(ui.botoesProposta({ id: "p5", status: "VENDIDA", dados: {} }), "");
  ctx.__rpPodeAdiar = false;
  assert.equal(ui.botoesProposta(res), "");
});

test("mensagens de erro do servidor viram texto em português", () => {
  const { ui } = montar({});
  assert.match(ui._t.msgErro({ ok: false, erro: "SEM_PERMISSAO_ADIAR" }), /diretoria/);
  assert.match(ui._t.msgErro({ ok: false, erro: "X", mensagem: "texto do servidor" }), /texto do servidor/);
  assert.match(ui._t.msgErro(null), /Sem resposta/);
});

test("as duas telas carregam o módulo e têm o lugar da faixa", () => {
  const sims = fs.readFileSync(path.join(RAIZ, "simulacoes.html"), "utf8"), vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
  for (const [h, id] of [[sims, "rp-faixa-prop"], [vendas, "rp-faixa-cond"]]) {
    assert.match(h, /venda\/reserva-prazo-ui\.js/);
    assert.ok(h.includes('id="' + id + '"'));
    assert.ok(h.includes('ReservaPrazoUI.faixa("' + id + '")'));
  }
  assert.ok(sims.includes("ReservaPrazoUI.botoesProposta(p)"));
});
