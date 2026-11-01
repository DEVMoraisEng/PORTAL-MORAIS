// Cota do Google (01/11): as telas só consultam o servidor com a aba aberta e
// com menos frequência. O ajudante pollSoVisivel fica marcado nos arquivos
// (POLL-INI/POLL-FIM); aqui ele é carregado com document e temporizadores falsos.
// Nenhuma chamada de rede: o "servidor" é um contador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("../../", import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), "utf8");

const ARQUIVOS = [
  { f: "atv-alertas.js", constante: "POLL_SINO_MS", minimo: 10 * 60 * 1000 },
  { f: "simulacoes.html", constante: "POLL_SIM_MS", minimo: 3 * 60 * 1000 },
  { f: "simulacoes.html", constante: "POLL_EMAIL_MS", minimo: 3 * 60 * 1000 },
  { f: "atividades.html", constante: "POLL_COMS_MS", minimo: 90 * 1000 },
];

function ajudante(src) {
  const m = src.match(/\/\*POLL-INI\*\/([\s\S]*?)\/\*POLL-FIM\*\//);
  assert.ok(m, "ajudante pollSoVisivel (POLL-INI/POLL-FIM) não encontrado");
  return m[1];
}

function mundo() {
  const w = { hidden: false, ouvintes: [], agora: 1_000_000, timers: [], chamadas: 0 };
  w.document = {
    get hidden() { return w.hidden; },
    addEventListener: (t, f) => { if (t === "visibilitychange") w.ouvintes.push(f); },
    removeEventListener: (t, f) => { w.ouvintes = w.ouvintes.filter((x) => x !== f); },
  };
  w.setInterval = (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; };
  w.clearInterval = (id) => { if (w.timers[id - 1]) w.timers[id - 1].morto = true; };
  w.Date = { now: () => w.agora };
  return w;
}

function carregar(src) {
  const w = mundo();
  const ctx = vm.createContext({ document: w.document, setInterval: w.setInterval, clearInterval: w.clearInterval, Date: w.Date });
  vm.runInContext(ajudante(src) + "\nthis.pollSoVisivel = pollSoVisivel;", ctx);
  return { w, poll: ctx.pollSoVisivel };
}

for (const a of ARQUIVOS) {
  const src = ler(a.f);
  const ms = () => {
    const m = src.match(new RegExp("const " + a.constante + String.raw`\s*=\s*([0-9*\s]+);`));
    assert.ok(m, a.constante + " não definido em " + a.f);
    return eval(m[1]);
  };

  test(a.f + " " + a.constante + ": intervalo >= " + a.minimo / 1000 + " s e usado com pollSoVisivel", () => {
    assert.ok(ms() >= a.minimo);
    assert.match(src, new RegExp(String.raw`pollSoVisivel\([\s\S]{0,1200}?\b` + a.constante + String.raw`\b`));
  });

  test(a.f + " " + a.constante + ": aba escondida = zero chamadas ao servidor", () => {
    const { w, poll } = carregar(src);
    w.hidden = true;
    poll(() => { w.chamadas++; }, ms());
    assert.equal(w.timers[0].ms, ms());
    for (let i = 0; i < 20; i++) w.timers[0].fn();
    assert.equal(w.chamadas, 0);
  });

  test(a.f + " " + a.constante + ": aba visível chama; ao voltar a ser visível atualiza uma vez se velho", () => {
    const { w, poll } = carregar(src);
    poll(() => { w.chamadas++; }, ms());
    w.timers[0].fn();
    assert.equal(w.chamadas, 1);
    w.hidden = true;
    w.agora += ms() + 1;
    w.ouvintes.forEach((f) => f());          // ainda escondida: nada
    assert.equal(w.chamadas, 1);
    w.hidden = false;
    w.ouvintes.forEach((f) => f());          // voltou e está velho: 1 chamada
    assert.equal(w.chamadas, 2);
    w.ouvintes.forEach((f) => f());          // recente: nada
    assert.equal(w.chamadas, 2);
  });
}

test("refazer o temporizador no mesmo slot não acumula ouvintes nem intervalos", () => {
  const { w, poll } = carregar(ler("atividades.html"));
  const slot = poll(() => {}, 90000);
  poll(() => {}, 90000, slot);
  assert.equal(w.ouvintes.length, 1);
  assert.equal(w.timers[0].morto, true);
});

test("nenhum setInterval solto restante nos pontos alterados", () => {
  const sino = ler("atv-alertas.js").replace(/\/\*POLL-INI\*\/[\s\S]*?\/\*POLL-FIM\*\//, "");
  assert.doesNotMatch(sino, /setInterval\(/);
  const ativ = ler("atividades.html");
  assert.doesNotMatch(ativ, /_poll=setInterval/);
  const sim = ler("simulacoes.html");
  assert.doesNotMatch(sim, /EMAILS_TIMER=setInterval/);
  assert.doesNotMatch(sim, /\}, 60000\);\s*\n\s*\}catch\(e\)/);
});
