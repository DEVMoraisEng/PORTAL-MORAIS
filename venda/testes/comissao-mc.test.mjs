/* Pedido da comissão do corretor ao robô (ComissaoMC.gs): mcComissao / mcComissaoEstado.
 * Notion e fila falsos. Dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, notionFalso, assinar, texto, COLUNAS_REAIS, PAGE_ID_PADRAO } from "./fakes.mjs";

const L = createRequire(import.meta.url)("../LogContratoVenda.js");
const DIA = 86400000, COND = "db-cond";
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + DIA });
const PROPS = { NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: "db-vendas", DB_VENDAS_COND: COND, DB_FILA_ROBO: "db-fila" };
const COLS = Object.assign({}, COLUNAS_REAIS, { "MC - SITUAÇÃO": "rich_text", "MC - VENDA ID": "rich_text", "MC - COMISSÃO": "rich_text",
  " COMISSÃO ": "number", CORRETOR: { tipo: "select", opcoes: ["CORRETOR TESTE"] }, "IMOBILIÁRIA": "rich_text" });
const HIST = "LANÇADA | título a | R$ 8.750,00 | 2 parcela(s)";
const PED = { action: "mcComissao", parcelas: "8750.00@2026-11-24" };

function montar({ valores = {}, colunas = COLS, dbId = COND, props = PROPS, filaStatus = 200 } = {}) {
  const v = Object.assign({ "MC - VENDA ID": texto("00000000-0000-0000-0000-0000000000b2") }, valores);
  const n = notionFalso({ colunas, valores: v, dbId });
  const fila = [];
  const g = criarGas({ props: Object.assign({}, props), rotas: (url, opt) => {
    const m = String(opt.method || "get").toUpperCase(), u = url.replace("https://api.notion.com/v1", "");
    const corpo = typeof opt.payload === "string" ? JSON.parse(opt.payload) : null;
    if (m === "POST" && u === "/pages" && corpo.parent.database_id === "db-fila") {
      if (filaStatus !== 200) return { status: filaStatus, json: { message: "falha" } };
      fila.push(JSON.parse(corpo.properties.PAYLOAD.rich_text[0].text.content)); return { json: { id: "f".repeat(32) } };
    }
    if (u === "/databases/db-fila/query") return { json: { results: [] } };
    return n.rota(url, opt);
  } });
  return { g, n, fila };
}
const chamar = (c, x, perfil, a) => c.g.chamar(Object.assign({ token: tokenDe(perfil, a), pageId: PAGE_ID_PADRAO }, x));
const col = (c) => c.n.pagina.properties["MC - COMISSÃO"].rich_text.map((t) => t.plain_text).join("");

test("comissaoJaLancada soma só as linhas LANÇADA", () => {
  const { g } = montar();
  const t = "PRÉVIA OK [#1a2b3c4d]\nLANÇADA | título a | R$ 8.750,00 | 2 parcela(s)\nLANÇADA | título b | R$ 1.000,50 | 1 parcela(s)\nINCERTO | x | datas 2026-11-24 | R$ 5.000,00 | y";
  assert.equal(g.ctx.comissaoJaLancada(t), 9750.5);
  assert.equal(g.ctx.comissaoJaLancada(""), 0);
});

test("lançar exige ADM/MASTER e prévia OK; prévia não", () => {
  const c = montar({ valores: { "MC - COMISSÃO": texto("") } });
  assert.equal(chamar(c, Object.assign({ aplicar: true }, PED), "GERAL").erro, "SEM_PERMISSAO_LANCAR");
  assert.equal(chamar(c, Object.assign({ aplicar: true }, PED), "ADM").erro, "MC_SEM_PREVIA");
  assert.equal(c.fila.length, 0);
  const r = chamar(c, PED, "GERAL");
  assert.equal(r.ok, true); assert.equal(r.aplicar, false);
  assert.equal(c.fila.at(-1).acao, "comissao");
  assert.equal(c.fila.at(-1).parcelas, "8750.00@2026-11-24");
  assert.match(col(c), /^PROCESSANDO \(prévia\) — \d\d\/\d\d \d\d:\w\w \[t=\d+\]( — o servidor|$)/);
});

test("aplicar com prévia OK leva o carimbo [#hash] e a fila recebe aplicar", () => {
  const c = montar({ valores: { "MC - COMISSÃO": texto("PRÉVIA OK [#1a2b3c4d] | COMISSÃO CORRETOR UNIDADE 04 - FULANO TESTE\nParcelas: x") } });
  const r = chamar(c, Object.assign({ aplicar: true, favorecido: "0a0b0c0d-0000-4000-8000-000000000001" }, PED), "MASTER");
  assert.equal(r.ok, true); assert.equal(r.aplicar, true);
  assert.match(col(c), /^PROCESSANDO \(lançamento\) — .* \[t=\d+\] \[#1a2b3c4d\]/);
  assert.equal(c.fila.at(-1).aplicar, true);
  assert.equal(c.fila.at(-1).favorecido, "0a0b0c0d-0000-4000-8000-000000000001");
  assert.equal(c.fila.at(-1).pageId, PAGE_ID_PADRAO.replace(/-/g, ""));
});

test("CRÍTICO: PROCESSANDO mantém LANÇADA, INCERTO e INCERTO CONFERIDO intactas (prévia e aplicar)", () => {
  const hist = [HIST, "INCERTO | desc | datas 2026-11-24 | R$ 100,00 | 24/11 10:00", "INCERTO CONFERIDO | não criado | 2026-11-24 | 24/11 11:00"];
  for (const aplicar of [false, true]) {
    const c = montar({ valores: { "MC - COMISSÃO": texto(["PRÉVIA OK [#1a2b3c4d]", ...hist].join("\n")) } });
    assert.equal(chamar(c, Object.assign({ aplicar }, PED), "ADM").ok, true);
    const t = col(c).split("\n");
    assert.match(t[0], /^PROCESSANDO/);
    assert.deepEqual(t.slice(1), hist);
    assert.ok(!/PRÉVIA OK/.test(col(c)));
  }
});

test("CRÍTICO: fila falhou — volta com ERRO e o histórico LANÇADA intacto, nada na fila", () => {
  const c = montar({ filaStatus: 500, valores: { "MC - COMISSÃO": texto("PRÉVIA OK [#1a2b3c4d]\n" + HIST) } });
  const r = chamar(c, PED, "ADM");
  assert.equal(r.ok, false);
  const t = col(c).split("\n");
  assert.equal(t[0], "ERRO: não consegui pôr o pedido na fila do servidor");
  assert.deepEqual(t.slice(1), [HIST]);
  assert.equal(c.fila.length, 0);
});

test("histórico muito longo é gravado inteiro (blocos de até 2000 caracteres)", () => {
  const longo = Array.from({ length: 60 }, (_, i) => "LANÇADA | título " + i + " | R$ 1,00 | 1 parcela(s) | " + "x".repeat(40));
  const c = montar({ valores: { "MC - COMISSÃO": texto("PRÉVIA OK [#1a2b3c4d]\n" + longo.join("\n")) } });
  assert.equal(chamar(c, PED, "ADM").ok, true);
  assert.deepEqual(col(c).split("\n").slice(1), longo);
});

test("parcela com lixo, vazia ou favorecido ruim não vai para a fila", () => {
  const c = montar({ valores: { "MC - COMISSÃO": texto("") } });
  const sete = Array(7).fill("1@2026-11-24").join(";");
  for (const parcelas of ["1@2026-11-24 && x", "", "1@2026-11-24;", sete])
    assert.equal(chamar(c, { action: "mcComissao", parcelas }, "ADM").erro, "PARCELAS_INVALIDAS", parcelas);
  assert.equal(chamar(c, Object.assign({}, PED, { favorecido: "x; rm" }), "ADM").erro, "FAVORECIDO_INVALIDO");
  assert.equal(c.fila.length, 0);
  assert.equal(col(c), "");
});

test("segundo clique com PROCESSANDO vivo é recusado; velho (>15 min) deixa pedir de novo", () => {
  const agora = Date.now();
  let c = montar({ valores: { "MC - COMISSÃO": texto("PROCESSANDO (prévia) — 24/11 10:00 [t=" + agora + "]") } });
  assert.equal(chamar(c, PED, "ADM").erro, "MC_PROCESSANDO");
  assert.equal(c.fila.length, 0);
  c = montar({ valores: { "MC - COMISSÃO": texto("PROCESSANDO (prévia) — 24/11 10:00 [t=" + (agora - 16 * 60000) + "]\n" + HIST) } });
  assert.equal(chamar(c, PED, "ADM").ok, true);
  assert.ok(col(c).includes(HIST));
});

test("recusas: página da VENDAS (rua), sem venda no MC, coluna faltando, sem fila", () => {
  assert.equal(chamar(montar({ dbId: "db-vendas" }), PED, "ADM").erro, "SO_CONDOMINIO");
  assert.equal(chamar(montar({ valores: { "MC - VENDA ID": texto("") } }), PED, "ADM").erro, "SEM_VENDA_ID");
  const semCol = Object.assign({}, COLS); delete semCol["MC - COMISSÃO"];
  assert.equal(chamar(montar({ colunas: semCol }), PED, "ADM").erro, "COLUNA_FALTANDO");
  const semFila = Object.assign({}, PROPS); delete semFila.DB_FILA_ROBO;
  assert.equal(chamar(montar({ props: semFila }), PED, "ADM").erro, "MC_NAO_CONFIGURADO");
});

test("perfil TESTES não pede; sem acesso a VENDAS não passa", () => {
  const c = montar();
  assert.equal(chamar(c, PED, "TESTES").erro, "SEM_PERMISSAO_TESTES");
  assert.equal(chamar(c, PED, "GERAL", []).erro, "SEM_PERMISSAO");
  assert.equal(c.fila.length, 0);
});

test("estado: lê comissão, corretor, imobiliária, texto, já lançado e processando", () => {
  const c = montar({ valores: { " COMISSÃO ": { number: 17500 }, CORRETOR: { select: { name: "CORRETOR TESTE" } }, "IMOBILIÁRIA": texto("IMOBILIARIA TESTE"),
    "MC - COMISSÃO": texto("PRÉVIA OK [#1a2b3c4d]\n" + HIST) } });
  const r = chamar(c, { action: "mcComissaoEstado" }, "GERAL");
  assert.equal(r.ok, true); assert.equal(r.comissao, 17500); assert.equal(r.jaLancado, 8750);
  assert.equal(r.corretor, "CORRETOR TESTE"); assert.equal(r.imobiliaria, "IMOBILIARIA TESTE");
  assert.equal(r.processando, false); assert.match(r.texto, /^PRÉVIA OK/);
  const p = montar({ valores: { "MC - COMISSÃO": texto("PROCESSANDO (prévia) — 24/11 10:00 [t=" + Date.now() + "]") } });
  assert.equal(chamar(p, { action: "mcComissaoEstado" }, "GERAL").processando, true);
  assert.equal(chamar(montar({ dbId: "db-vendas" }), { action: "mcComissaoEstado" }).erro, "SO_CONDOMINIO");
});

test("histórico do portal descreve prévia e lançamento", () => {
  assert.match(L.linha("mcComissao", { aplicar: false }, { ok: true }, "ana.teste", "t"), /prévia da comissão/);
  assert.match(L.linha("mcComissao", { aplicar: true }, { ok: true }, "ana.teste", "t"), /lançou a comissão do corretor/);
  assert.equal(L.linha("mcComissaoEstado", {}, { ok: true }, "ana.teste", "t"), "");
});
