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

function montar({ props = PROPS, valores = {}, colunas = COLS, gh = 204, bases, esquemas } = {}) {
  const n = notionFalso({ colunas, valores, bases, esquemas });
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

test("27/10: com DB_FILA_ROBO, o pedido vai para a fila do servidor (Notion) e não para o GitHub", () => {
  const FILA = "f".repeat(32);
  const { g, n, despachos } = montar({ props: Object.assign({}, PROPS, { DB_FILA_ROBO: FILA }), bases: { [FILA]: [] },
    esquemas: { [FILA]: { PEDIDO: "title", TIPO: "select", PAYLOAD: "rich_text", "SITUAÇÃO": "select", "PEDIDO EM": "date" } } });
  const r = g.chamar({ action: "mcLancar", token: tokenDe(), pageId: PAGE_ID_PADRAO, aplicar: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.fila, true);
  assert.equal(r.semSinal, true, "servidor nunca deu sinal");
  assert.equal(despachos.length, 0, "não chama o GitHub");
  const linha = n.escritas.find((e) => e.metodo === "POST");
  assert.ok(linha, "pôs a linha na fila");
  assert.equal(linha.props["TIPO"].select.name, "mc-venda");
  assert.equal(linha.props["SITUAÇÃO"].select.name, "PENDENTE");
  assert.deepEqual(JSON.parse(linha.props["PAYLOAD"].rich_text[0].text.content), { pageId: PAGE_ID_PADRAO, aplicar: false });
  assert.match(sit(n), /^PROCESSANDO \(prévia\).*o servidor ainda não deu sinal/);
});

test("27/10: sinal do servidor — velho depois de 5 min, e o aviso diz desde quando", () => {
  const { g } = montar();
  const agora = Date.parse("2026-10-27T15:00:00Z");
  assert.equal(g.ctx.roboSinalVelho_("2026-10-27T14:57:00Z", agora), false);
  assert.equal(g.ctx.roboSinalVelho_("2026-10-27T14:50:00Z", agora), true);
  assert.equal(g.ctx.roboSinalVelho_("", agora), true);
  assert.equal(g.ctx.roboAvisoSinal_("2026-10-27T14:59:00Z", agora), "");
});
