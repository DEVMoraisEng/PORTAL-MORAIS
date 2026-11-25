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

/* ---- Tarefa 6: tela (venda-dossie.js) ---- */
const D = createRequire(import.meta.url)("../../venda-dossie.js");
const botaoCom = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>')) || [null])[0];

test("parcelasDoForm reparte e confere a soma", () => {
  const r = D.parcelasDoForm({ modo: "parcelado", n: 3, total: 17500, hoje: "2026-11-24" });
  assert.equal(r.texto, "5833.33@2026-11-24;5833.33@2026-12-24;5833.34@2027-01-23");
  assert.equal(D.parcelasDoForm({ modo: "vista", total: 8750, datas: ["2026-11-24"] }).texto, "8750.00@2026-11-24");
  assert.equal(D.parcelasDoForm({ modo: "parcelado", valores: [5000, 0], datas: ["2026-11-24", "2026-12-24"] }).ok, false);
});

test("parcelasDoForm: centavos somam sem erro de ponto flutuante, limites e saldo", () => {
  const r = D.parcelasDoForm({ modo: "parcelado", n: 3, total: 0.1, hoje: "2026-11-24" });
  assert.equal(r.texto, "0.03@2026-11-24;0.03@2026-12-24;0.04@2027-01-23");
  assert.equal(D.parcelasDoForm({ modo: "parcelado", n: 7, total: 1000, hoje: "2026-11-24" }).ok, false);
  assert.equal(D.parcelasDoForm({ modo: "parcelado", n: 1, total: 1000, hoje: "2026-11-24" }).ok, false);
  const acima = D.parcelasDoForm({ modo: "vista", valores: ["10.000,00"], datas: ["2026-11-24"], saldo: 8750 });
  assert.equal(acima.ok, false);
  assert.match(acima.erro, /saldo/i);
  const dig = D.parcelasDoForm({ modo: "parcelado", valores: ["4.375,00", "4375,00"], datas: ["2026-11-24", "2026-12-24"], saldo: 8750 });
  assert.equal(dig.texto, "4375.00@2026-11-24;4375.00@2026-12-24");
  assert.equal(D.parcelasDoForm({ modo: "vista", total: 100, datas: [""] }).ok, false);
  assert.equal(D.parcelasDoForm({ modo: "vista", total: 100, datas: ["2026-13-45"] }).ok, false);
});

test("bloco: sem comissão não mostra botão; prévia OK + ADM mostra Lançar", () => {
  assert.ok(!/data-acao="com-/.test(D.htmlComissao({ comissao: 0 }, {})));
  assert.ok(!/data-acao="com-/.test(D.htmlComissao({ comissao: null }, {})));
  const h = D.htmlComissao({ comissao: 17500, jaLancado: 0, texto: "PRÉVIA OK [#1a2b3c4d]\nFavorecido: X\nParcelas: 1/1 R$ 17.500,00 em " + "25/11/2026" }, { adm: true, hoje: "2026-11-25" });
  assert.ok(/data-acao="com-lancar"(?![^>]*disabled)/.test(h));
  const h2 = D.htmlComissao({ comissao: 17500, jaLancado: 0, texto: "PRÉVIA OK [#1a2b3c4d]" }, { adm: false });
  assert.ok(/data-acao="com-lancar"[^>]*disabled/.test(h2) || !/com-lancar/.test(h2));
  const h3 = D.htmlComissao({ comissao: 17500, jaLancado: 0, texto: "ERRO: falhou" }, { adm: true });
  assert.match(botaoCom(h3, "com-lancar"), /disabled/);
  const h4 = D.htmlComissao({ comissao: 17500, jaLancado: 0, texto: "PRÉVIA OK [#1a2b3c4d]", processando: true }, { adm: true });
  assert.match(botaoCom(h4, "com-lancar"), /disabled/);
  assert.match(botaoCom(h4, "com-previa"), /disabled/);
});

test("bloco: resumo em reais, saldo e sem saldo", () => {
  const h = D.htmlComissao({ comissao: 17500, jaLancado: 8750, texto: "" }, { adm: true, hoje: "2026-11-24" });
  assert.match(h, /17\.500,00/); assert.match(h, /8\.750,00/);
  assert.match(botaoCom(h, "com-previa"), /^<button(?![^>]*disabled)/);
  const z = D.htmlComissao({ comissao: 17500, jaLancado: 17500, texto: "" }, { adm: true });
  assert.ok(!/data-acao="com-(previa|lancar)"/.test(z));
});

test("prévia com candidatos desenha a escolha", () => {
  const t = "ESCOLHER FAVORECIDO: há 2 cadastros\nParcelas: 1/1 R$ 1.000,00 em 24/11/2026\nCandidatos:\n- f-1 | CORRETOR TESTE | 111.444.777-35 | sem Pix\n- f-2 | IMOBILIARIA TESTE | 00.000.000/0001-91 | 00000000000191";
  const h = D.htmlComissao({ comissao: 1000, jaLancado: 0, texto: t }, { adm: true });
  assert.ok(/name="com-fav" value="f-1"/.test(h) && /name="com-fav" value="f-2"/.test(h));
  assert.ok(!/data-acao="com-lancar"(?![^>]*disabled)/.test(h));
  assert.ok(!/<li[^>]*>f-1 \|/.test(h));
  const ok = "PRÉVIA OK [#1a2b3c4d] | d\nFavorecido: IMOBILIARIA TESTE | 00.000.000/0001-91\nPix: 00000000000191\n" + t.split("\n").slice(1).join("\n");
  const h2 = D.htmlComissao({ comissao: 1000, jaLancado: 0, texto: ok }, { adm: true, fav: "f-2" });
  assert.ok(/value="f-2"[^>]*checked/.test(h2));
  assert.ok(/data-acao="com-lancar"(?![^>]*disabled)/.test(h2));
  const h3 = D.htmlComissao({ comissao: 1000, jaLancado: 0, texto: ok }, { adm: true, fav: "" });
  assert.match(botaoCom(h3, "com-lancar"), /disabled/);
});

test("nada de texto de usuário sem escape", () => {
  const t = "ESCOLHER FAVORECIDO\nCandidatos:\n- f-1 | <img src=x onerror=1> | 1 | sem Pix\n- f-2 | B | 2 | Pix 3";
  const h = D.htmlComissao({ comissao: 1000, jaLancado: 0, texto: t + "\n<script>1</script>", corretor: "<b>x</b>" }, { adm: true, msg: "<i>" });
  assert.ok(!/<img|<script|<b>x|<i>/.test(h));
});

test("grupo Mais Controle inteiro: aparece no condomínio com venda, não na casa de rua", () => {
  const e = { situacao: "CRIADA", vendaId: "00000000-0000-0000-0000-0000000000b2" };
  const com = { estado: { comissao: 17500, jaLancado: 0, texto: "" } };
  const cond = D.htmlMC(e, { ocupado: null, msg: "", testes: false, condominio: true, comissao: com });
  assert.match(cond, /Comissão do corretor/); assert.ok(botaoCom(cond, "com-previa"));
  assert.ok(!/Comissão do corretor/.test(D.htmlMC(e, { ocupado: null, msg: "", testes: false, comissao: com })));
  const sem = D.htmlMC({ situacao: "", vendaId: "" }, { condominio: true, comissao: com });
  assert.match(sem, /Comissão do corretor/); assert.ok(!/data-acao="com-/.test(sem));
  assert.ok(D.htmlMC(e, { condominio: true, comissao: null }).length > 0);
  const direta = D.htmlMC(e, { condominio: true, comissao: { estado: { comissao: 0, texto: "" } } });
  assert.ok(!/data-acao="com-/.test(direta));
});

test("mensagemMC traduz os erros da comissão", () => {
  for (const c of ["SEM_PERMISSAO_LANCAR", "PARCELAS_INVALIDAS", "FAVORECIDO_INVALIDO", "SEM_VENDA_ID", "COLUNA_FALTANDO", "MC_SEM_PREVIA"])
    assert.ok(D.mensagemMC({ erro: c }) !== c, c);
  assert.match(D.mensagemMC({ erro: "SEM_PERMISSAO_LANCAR" }), /ADM|MASTER/);
});

/* 25/11/2026: depois de recarregar a página o Lançar só liga se o formulário bate com as parcelas da prévia */
const PAR2 = "PRÉVIA OK [#1a2b3c4d]\nParcelas: 1/2 R$ 8.750,00 em 2026-11-25".replace("2026-11-25", "25/11/2026") + "; 2/2 R$ 8.750,00 em 25/12/2026";
const estPrev = (texto) => ({ comissao: 17500, jaLancado: 0, texto });

test("comParcelasDaPrevia lê a linha Parcelas do robô", () => {
  const um = D.comParcelasDaPrevia("PRÉVIA OK\nParcelas: 1/1 R$ 17.500,00 em 25/11/2026");
  assert.equal(um.texto, "17500.00@2026-11-25");
  assert.equal(um.n, 1);
  const dois = D.comParcelasDaPrevia(PAR2);
  assert.equal(dois.texto, "8750.00@2026-11-25;8750.00@2026-12-25");
  assert.deepEqual(dois.datas, ["2026-11-25", "2026-12-25"]);
  assert.deepEqual(dois.valores, [8750, 8750]);
  const tres = D.comParcelasDaPrevia("Parcelas: 1/3 R$ 5.833,33 em 25/11/2026; 2/3 R$ 5.833,33 em 25/12/2026; 3/3 R$ 5.833,34 em 24/01/2027");
  assert.equal(tres.texto, "5833.33@2026-11-25;5833.33@2026-12-25;5833.34@2027-01-24");
  assert.equal(tres.n, 3);
  assert.equal(D.comParcelasDaPrevia("PRÉVIA OK\nFavorecido: X | 1"), null);
  assert.equal(D.comParcelasDaPrevia("Parcelas: 1/2 R$ 8.750,00 em 25/11/2026; lixo"), null);
  assert.equal(D.comParcelasDaPrevia("Parcelas: 1/2 R$ 8.750,00 em 31/02/2026; 2/2 R$ 8.750,00 em 25/12/2026"), null);
});

test("página recarregada: o formulário vem da prévia e o Lançar liga; mudar para à vista desliga", () => {
  const e = estPrev(PAR2), ui = { adm: true, hoje: "2026-11-25" };
  const c = D.comCalculo(e, ui);
  assert.equal(c.form.modo, "parcelado");
  assert.equal(c.form.n, 2);
  assert.deepEqual(c.form.valores, ["8.750,00", "8.750,00"]);
  assert.deepEqual(c.form.datas, ["2026-11-25", "2026-12-25"]);
  assert.equal(c.mudou, false);
  assert.equal(c.podeLancar, true);
  assert.match(botaoCom(D.htmlComissao(e, ui), "com-lancar"), /^(?!.*disabled)/);
  const c2 = D.comCalculo(e, { adm: true, hoje: "2026-11-25", modo: "vista" });
  assert.equal(c2.mudou, true);
  assert.equal(c2.podeLancar, false);
  assert.match(D.htmlComissao(e, { adm: true, hoje: "2026-11-25", modo: "vista" }), /peça a prévia de novo/);
});

test("prévia OK sem linha Parcelas e sem parcelasPrevia: não lança às cegas", () => {
  const e = estPrev("PRÉVIA OK [#1a2b3c4d]\nFavorecido: X");
  assert.equal(D.comCalculo(e, { adm: true, hoje: "2026-11-25" }).podeLancar, false);
  const ok = D.comCalculo(e, { adm: true, hoje: "2026-11-25", parcelasPrevia: "17500.00@2026-11-25" });
  assert.equal(ok.podeLancar, true);
});

test("recarregou (prévia de 2 parcelas) e mudou o select para 3: não volta para a prévia, trava o Lançar", () => {
  const e = estPrev(PAR2), ui = { adm: true, hoje: "2026-11-25", modo: "parcelado", n: 3, valores: null, datas: null };
  const c = D.comCalculo(e, ui);
  assert.equal(c.form.n, 3);
  assert.equal(c.mudou, true);
  assert.equal(c.podeLancar, false);
});

test("a linha da prévia atual vale mais que o parcelasPrevia velho da sessão", () => {
  const e = estPrev(PAR2);
  const c = D.comCalculo(e, { adm: true, hoje: "2026-11-25", parcelasPrevia: "1.00@2026-11-25" });
  assert.equal(c.mudou, false);
  assert.equal(c.podeLancar, true);
});

test("estado inicial REAL da tela (novoUiCom) conta como intocado: a página recarregada mostra a prévia", () => {
  /* 25/11: a tela criava o ui com modo "vista" e n 2 e o preenchimento pela prévia nunca acontecia — o teste acima
     usava um ui vazio e não pegava. Aqui o ui é o mesmo que a tela monta. */
  const ui = D.novoUiCom(true, "2026-11-25");
  const c = D.comCalculo(estPrev(PAR2), ui);
  assert.equal(c.form.modo, "parcelado");
  assert.deepEqual(c.form.valores, ["8.750,00", "8.750,00"]);
  assert.equal(c.podeLancar, true);
  const sem = D.comCalculo({ comissao: 17500, jaLancado: 0, texto: "" }, D.novoUiCom(true, "2026-11-25"));
  assert.equal(sem.form.modo, "vista");
  assert.deepEqual(sem.form.valores, ["17.500,00"]);
});
