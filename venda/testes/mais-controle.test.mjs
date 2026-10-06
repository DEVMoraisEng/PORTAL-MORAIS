/* mcLancar / mcEstado (MaisControleVenda.gs): só disparam o workflow do GitHub e
 * leem as duas colunas de retorno. Dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { criarGas, notionFalso, assinar, texto, COLUNAS_REAIS, DB_ID_PADRAO, PAGE_ID_PADRAO } from "./fakes.mjs";

const DIA = 86400000;
const tokenDe = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + DIA });
const PROPS = { NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO,
                GITHUB_TOKEN: "gh-teste", GH_REPO_MC: "Org-Teste/REPO-TESTE" };
const COLS = Object.assign({}, COLUNAS_REAIS, { "MC - SITUAÇÃO": "rich_text", "MC - VENDA ID ": "rich_text" });

function montar({ props = PROPS, valores = {}, colunas = COLS, gh = 204 } = {}) {
  const n = notionFalso({ colunas, valores });
  const despachos = [];
  const g = criarGas({ props, rotas: (url, opt) => {
    if (url.startsWith("https://api.github.com/")) { despachos.push({ url, corpo: JSON.parse(opt.payload), opt }); return { status: gh, texto: "" }; }
    return n.rota(url, opt);
  } });
  return { g, n, despachos };
}
const sit = (n) => n.pagina.properties["MC - SITUAÇÃO"].rich_text.map((t) => t.plain_text).join("");

test("prévia: anota PROCESSANDO e dispara o workflow sem aplicar", () => {
  const { g, n, despachos } = montar();
  const r = g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO, aplicar: false });
  assert.equal(r.ok, true);
  assert.match(sit(n), /^PROCESSANDO \(prévia\)/);
  assert.equal(despachos.length, 1);
  assert.equal(despachos[0].url, "https://api.github.com/repos/Org-Teste/REPO-TESTE/dispatches");
  assert.deepEqual(despachos[0].corpo, { event_type: "mc-venda", client_payload: { pageId: PAGE_ID_PADRAO, aplicar: false } });
  assert.equal(despachos[0].opt.headers.Authorization, "Bearer gh-teste");
});

test("lançar exige prévia OK antes", () => {
  const { g, despachos } = montar({ valores: { "MC - SITUAÇÃO": texto("RECUSADA: falta CPF") } });
  const r = g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO, aplicar: true });
  assert.equal(r.erro, "MC_SEM_PREVIA");
  assert.equal(despachos.length, 0);
});

test("lançar depois da prévia OK dispara com aplicar", () => {
  const { g, despachos } = montar({ valores: { "MC - SITUAÇÃO": texto("PRÉVIA OK — cliente já existe") } });
  const r = g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO, aplicar: true });
  assert.equal(r.ok, true);
  assert.equal(despachos[0].corpo.client_payload.aplicar, true);
});

test("já lançada, processando ou sem configuração não disparam", () => {
  let m = montar({ valores: { "MC - VENDA ID ": texto("venda-1") } });
  assert.equal(m.g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO }).erro, "MC_JA_LANCADA");
  m = montar({ valores: { "MC - SITUAÇÃO": texto("PROCESSANDO (prévia) — 06/10") } });
  assert.equal(m.g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO }).erro, "MC_PROCESSANDO");
  const semRepo = Object.assign({}, PROPS); delete semRepo.GH_REPO_MC;
  m = montar({ props: semRepo });
  assert.equal(m.g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO }).erro, "MC_NAO_CONFIGURADO");
  for (const x of [m]) assert.equal(x.despachos.length, 0);
});

test("perfil TESTES não dispara", () => {
  const { g, despachos } = montar();
  assert.equal(g.chamar({ action: "mcLancar", token: tokenDe("TESTES"), pageId: PAGE_ID_PADRAO }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(despachos.length, 0);
});

test("GitHub recusou: situação vira ERRO e a resposta diz o motivo", () => {
  const { g, n } = montar({ gh: 404 });
  const r = g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO });
  assert.equal(r.erro, "MC_DISPARO_FALHOU");
  assert.match(sit(n), /^ERRO: não consegui acionar o robô \(HTTP 404\)/);
});

test("colunas MC faltando: erro legível", () => {
  const { g } = montar({ colunas: COLUNAS_REAIS });
  assert.match(g.chamar({ action: "mcEstado", token: tokenDe(), pageId: PAGE_ID_PADRAO }).erro, /^COLUNA_FALTANDO: MC - SITUAÇÃO/);
});

test("estado devolve situação e id da venda (nome de coluna com espaço sobrando)", () => {
  const { g } = montar({ valores: { "MC - SITUAÇÃO": texto("CRIADA no Mais Controle"), "MC - VENDA ID ": texto("venda-9") } });
  const r = g.chamar({ action: "mcEstado", token: tokenDe(), pageId: PAGE_ID_PADRAO });
  assert.deepEqual(r, { ok: true, situacao: "CRIADA no Mais Controle", vendaId: "venda-9" });
});

test("PROCESSANDO vencido (mais de 15 min) libera pedir de novo; o recente não", () => {
  const velho = Date.now() - 16 * 60 * 1000, novo = Date.now() - 60 * 1000;
  let m = montar({ valores: { "MC - SITUAÇÃO": texto("PROCESSANDO (prévia) — 06/10 01:00 [t=" + velho + "]") } });
  assert.equal(m.g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO }).ok, true);
  m = montar({ valores: { "MC - SITUAÇÃO": texto("PROCESSANDO (prévia) — 06/10 01:00 [t=" + novo + "]") } });
  assert.equal(m.g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO }).erro, "MC_PROCESSANDO");
});

test("lançar leva a assinatura da prévia e o carimbo de hora", () => {
  const { g, n } = montar({ valores: { "MC - SITUAÇÃO": texto("PRÉVIA OK [#0a1b2c3d] — cliente já existe") } });
  assert.equal(g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO, aplicar: true }).ok, true);
  assert.match(sit(n), /^PROCESSANDO \(lançamento\) — .* \[t=\d+\] \[#0a1b2c3d\]$/);
});

test("GitHub sem resposta (exceção no fetch) vira ERRO, não fica PROCESSANDO", () => {
  const n = notionFalso({ colunas: COLS });
  const g = criarGas({ props: PROPS, rotas: (url, opt) => (url.startsWith("https://api.github.com/") ? { lancar: "DNS" } : n.rota(url, opt)) });
  assert.equal(g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO }).erro, "MC_DISPARO_FALHOU");
  assert.match(sit(n), /sem resposta do GitHub/);
});
