/* COTA GOOGLE no PORTAL-VENDA: contador diario de UrlFetch e linha do dia na planilha compartilhada.
   Sem rede: Apps Script, planilha e cache falsos em memoria; so dados inventados.
   Rodar: node --test venda/testes/cota-venda.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
const ARQUIVOS = ["CotaVenda.gs", "PortalVenda.gs"];
const PLANILHA = "planilha-falsa";
const DIA1_10H = Date.UTC(2026, 10, 1, 13, 0, 0);   // 01/11/2026 10:00 em Sao Paulo

function formatar(d, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(+d)).map((x) => [x.type, x.value]));
  return fmt.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour)
    .replace("mm", p.minute).replace("ss", p.second).replace(/^H$/, String(Number(p.hour)));
}

function planilhaFalsa() {
  const abas = new Map();
  const aba = (nome) => {
    const linhas = [];
    return { nome, linhas,
      getLastRow: () => linhas.length,
      appendRow: (l) => { linhas.push(l.slice()); },
      getRange: (a, col) => (typeof a === "string" ? { setNumberFormat() {} } :
        { setValues: (vs) => { vs.forEach((v, i) => v.forEach((x, j) => { linhas[a - 1 + i][col - 1 + j] = x; })); } }),
      getDataRange: () => ({ getValues: () => linhas.map((l) => l.slice()) }) };
  };
  return { abas, getSheetByName: (n) => abas.get(n) || null, insertSheet: (n) => { const s = aba(n); abas.set(n, s); return s; } };
}

function criar({ props: extra = {}, contador = true } = {}) {
  const estado = { agora: DIA1_10H, cache: new Map(), fetches: 0, planilha: planilhaFalsa(), aberturas: 0, emails: 0 };
  const props = { COTA_PLANILHA_ID: PLANILHA, ...extra };
  if (contador) props.RF_CONTADOR = "1";
  for (const k of Object.keys(props)) if (props[k] === null) delete props[k];
  const vivo = (k) => { const e = estado.cache.get(k); if (!e) return null; if (e.ate <= estado.agora) { estado.cache.delete(k); return null; } return e; };
  class DataFalsa extends Date {
    constructor(...a) { if (a.length) super(...a); else super(estado.agora); }
    static now() { return estado.agora; }
  }
  const ctx = {
    console: { log() {}, error() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (n) => (n in props ? props[n] : null),
      getProperties: () => ({ ...props }),
      setProperty: (n, v) => { props[n] = String(v); }, deleteProperty: (n) => { delete props[n]; } }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = vivo(k); return e ? e.v : null; },
      put: (k, v, seg) => { estado.cache.set(k, { v: String(v), ate: estado.agora + (seg || 600) * 1000 }); },
      remove: (k) => { estado.cache.delete(k); },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ setMimeType: () => ({ texto: t }) }) },
    Utilities: { sleep() {}, formatDate: formatar },
    UrlFetchApp: { fetch() { estado.fetches++; return { getContentText: () => "{}", getResponseCode: () => 200 }; },
                   fetchAll(l) { estado.fetches += l.length; return l.map(() => ({ getContentText: () => "{}" })); } },
    SpreadsheetApp: { openById: (id) => { estado.aberturas++; if (id !== PLANILHA) throw new Error("planilha nao existe"); return estado.planilha; } },
    MailApp: { sendEmail: () => { estado.emails++; } },
    ScriptApp: (() => {
      const gat = (estado.gatilhos = []);
      return {
        getProjectTriggers: () => gat.slice(),
        deleteTrigger: (t) => { const i = gat.indexOf(t); if (i >= 0) gat.splice(i, 1); },
        newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => {
          const t = { fn, m, getHandlerFunction: () => fn }; gat.push(t); return t; } }) }) }),
      };
    })(),
    Date: DataFalsa, JSON, Math, Object, Array, String, Number, RegExp, parseInt, parseFloat, isNaN, isFinite, Error, Map, Set, TypeError,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const arq of ARQUIVOS) {
    const f = path.join(RAIZ, arq);
    vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
  }
  return { ctx, estado, props };
}
const linhas = (e) => (e.planilha.abas.get("COTA GOOGLE") || { linhas: [] }).linhas.slice(1).map((l) => [l[0], l[1], l[2]]);
const buscar = (ctx, n) => { for (let i = 0; i < n; i++) ctx.UrlFetchApp.fetch("https://api.notion.com/v1/pages/x"); };

test("50 chamadas sobem o contador do dia em 50 (fetchAll conta cada pedido)", () => {
  const { ctx, estado } = criar();
  buscar(ctx, 48);
  ctx.UrlFetchApp.fetchAll([{ url: "https://api.notion.com/v1/a" }, { url: "https://api.notion.com/v1/b" }]);
  assert.equal(estado.fetches, 50);
  assert.equal(ctx.cvCotaTotalHoje_(), 50);
});

test("contador desligado (sem RF_CONTADOR) nao troca o UrlFetch nem grava", () => {
  const { ctx, estado } = criar({ contador: false });
  buscar(ctx, 5);
  assert.equal(ctx.cvCotaTotalHoje_(), 0);
  assert.equal(ctx.cvCotaCiclo_(true), false);
  assert.equal(estado.aberturas, 0);
});

test("virar o dia em Sao Paulo comeca chave nova", () => {
  const { ctx, estado } = criar();
  estado.agora = Date.UTC(2026, 10, 2, 2, 30);            // 01/11 23:30 em SP (ja 02/11 em UTC)
  buscar(ctx, 7);
  assert.equal(ctx.cvUfDia_(), "20261101");
  assert.equal(ctx.cvCotaTotalHoje_(), 7);
  estado.agora = Date.UTC(2026, 10, 2, 3, 30);            // 02/11 00:30 em SP
  assert.equal(ctx.cvCotaTotalHoje_(), 0);
  buscar(ctx, 1);
  assert.equal(ctx.cvCotaTotalHoje_(), 1);
});

test("sem COTA_PLANILHA_ID nada acontece e nada da erro", () => {
  const { ctx, estado } = criar({ props: { COTA_PLANILHA_ID: null } });
  buscar(ctx, 3);
  assert.doesNotThrow(() => ctx.cvCotaCiclo_(true));
  assert.doesNotThrow(() => ctx.doGet({ parameter: { action: "ping" } }));
  assert.equal(estado.aberturas, 0);
});

test("planilha que falha nao derruba quem chamou", () => {
  const { ctx } = criar({ props: { COTA_PLANILHA_ID: "outra" } });
  buscar(ctx, 3);
  assert.equal(ctx.cvCotaCiclo_(true), false);
});

test("grava uma linha do dia e atualiza a mesma linha; no maximo a cada 15 min", () => {
  const { ctx, estado } = criar();
  buscar(ctx, 3);
  assert.equal(ctx.cvCotaCiclo_(), true);
  buscar(ctx, 1);
  assert.equal(ctx.cvCotaCiclo_(), false);              // menos de 15 min
  assert.deepEqual(linhas(estado), [["2026-11-01", "PORTAL-VENDA", 3]]);
  estado.agora += 16 * 60000;
  assert.equal(ctx.cvCotaCiclo_(), true);
  assert.deepEqual(linhas(estado), [["2026-11-01", "PORTAL-VENDA", 4]]);
  estado.agora = Date.UTC(2026, 10, 2, 13, 0);            // dia seguinte
  buscar(ctx, 2);
  ctx.cvCotaCiclo_();
  assert.deepEqual(linhas(estado), [["2026-11-01", "PORTAL-VENDA", 4], ["2026-11-02", "PORTAL-VENDA", 2]]);
  assert.equal(estado.emails, 0);                          // quem avisa e o PORTAL-LEITURA
});

test("COTA_PROJETO troca o nome da linha (projeto de TESTE)", () => {
  const { ctx, estado } = criar({ props: { COTA_PROJETO: "PORTAL-VENDA-TESTE" } });
  buscar(ctx, 2);
  ctx.cvCotaCiclo_(true);
  assert.deepEqual(linhas(estado), [["2026-11-01", "PORTAL-VENDA-TESTE", 2]]);
});

/* rodada 1: pedido da tela nunca abre a planilha; quem grava e o gatilho proprio de 15 min */
test("doGet e doPost nunca abrem a planilha, nem com 15 min passados", () => {
  const { ctx, estado } = criar();
  buscar(ctx, 4);
  ctx.doGet({ parameter: { action: "ping" } });
  estado.agora += 16 * 60000;
  ctx.doPost({ parameter: { action: "ping" } });
  ctx.doGet({ parameter: { action: "ping" } });
  assert.equal(estado.aberturas, 0);
  assert.deepEqual(linhas(estado), []);
});

test("o gatilho cvCotaGatilho grava na planilha", () => {
  const { ctx, estado } = criar();
  buscar(ctx, 4);
  ctx.cvCotaGatilho();
  assert.deepEqual(linhas(estado), [["2026-11-01", "PORTAL-VENDA", 4]]);
});

test("cvCotaInstalar cria um gatilho de 15 min e, rodado de novo, nao duplica", () => {
  const { ctx, estado } = criar();
  estado.gatilhos.push({ getHandlerFunction: () => "vigiaAssinaturas" });   // outro gatilho do projeto fica
  ctx.cvCotaInstalar();
  ctx.cvCotaInstalar();
  const meus = estado.gatilhos.filter((t) => t.getHandlerFunction() === "cvCotaGatilho");
  assert.equal(meus.length, 1);
  assert.equal(meus[0].m, 15);
  assert.equal(estado.gatilhos.length, 2);
});
