/* assinaturaEnviar / assinaturaEstado (AssinaturaVenda.gs) com Notion e Clicksign falsos.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, notionFalso, clicksignFalso, PDF_ASSINADO, assinar, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const CV = createRequire(import.meta.url)("../ContratoVenda.js");
const DIA = 86400000;
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + DIA });
const PAGE = PAGE_ID_PADRAO, OBRA = "fedcba9876543210fedcba9876543210";
const TOKEN_CS = "token-clicksign-secreto-de-teste";

const tit = (s) => ({ title: [{ type: "text", plain_text: s, text: { content: s } }] });
const sel = (s) => ({ select: s === null ? null : { name: s } });
const num = (n) => ({ number: n });
const dat = (s) => ({ date: { start: s } });
const rel = (id) => ({ relation: [{ id }] });
const eml = (s) => ({ email: s });
const rt = texto;

const TEST_SPE = [{ nome: "Testemunha Um Spe", email: "t1.spe@teste.example", cpf: "000.000.005-15" },
                  { nome: "Testemunha Dois Spe", email: "t2.spe@teste.example", cpf: "000.000.006-04" }];
const TEST_PF = [{ nome: "Testemunha Um Pf", email: "t1.pf@teste.example", cpf: "000.000.007-87" },
                 { nome: "Testemunha Dois Pf", email: "t2.pf@teste.example", cpf: "000.000.008-68" }];
const PROPS = {
  NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO,
  DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr", DB_DOCUMENTOS: "db-doc",
  CLICKSIGN_TOKEN: TOKEN_CS,
  ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify(TEST_SPE), ASSINATURA_TESTEMUNHAS_PF: JSON.stringify(TEST_PF),
};

function colunasVenda(sem = []) {
  const c = Object.assign({}, COLUNAS_REAIS, {
    " VALOR NA MÃO ": "number", "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": "number", " COMISSÃO ": "number",
    CORRETOR: { tipo: "select", opcoes: ["Corretor Teste"] }, SETOR: { tipo: "select", opcoes: ["Setor Teste"] },
    "OBRA-AUTO": "relation", CASA: "rich_text", "Email": "email",
    "ASSINATURA - ENVELOPE ID": "rich_text", "ASSINATURA - SITUAÇÃO": "rich_text", "CONTRATO ASSINADO": "files",
  });
  for (const [nome, tipo] of Object.entries(CV.TIPOS))
    c[nome] = tipo === "select" ? { tipo, opcoes: ["PIX", "COMPRADOR", "VENDEDOR"] } : tipo;
  for (const s of sem) delete c[s];
  return c;
}

const GERADO = { files: [{ name: "velho.pdf", type: "file", file: { url: "https://s3.falso/velho" } },
                         { name: "CONTRATO - RESIDENCIAL TESTE QD 07 LT 12 - 01-10-2026.pdf", type: "file", file: { url: "https://s3.falso/gerado" } }] };
const PDF_GERADO = "%PDF-1.4 contrato gerado de teste";
const VENDA = {
  "ENDEREÇO": tit("RESIDENCIAL TESTE QD 07 LT 12"), CASA: rt("3"),
  "CLIENTES ": rt("Fulano de Teste"), "CPF ": rt("000.000.001-91"), "Email": eml("fulano@teste.example"),
  "COMPRADOR 1 - DOCUMENTO": rt("RG 1234567 SSP/GO"), "COMPRADOR 1 - NACIONALIDADE": rt("brasileiro"),
  "COMPRADOR 1 - ESTADO CIVIL": rt("solteiro"), "COMPRADOR 1 - PROFISSÃO": rt("analista"),
  "COMPRADOR 1 - ENDEREÇO": rt("Rua das Palmeiras, 10, Setor Teste"),
  "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(300000), " COMISSÃO ": num(9000), " VALOR NA MÃO ": num(291000),
  CORRETOR: sel("Corretor Teste"), SETOR: sel("Setor Teste"), "OBRA-AUTO": rel(OBRA),
  "CONTRATO - ALVARÁ Nº": rt("AL-77"), "CONTRATO - ALVARÁ DATA": dat("2026-03-10"),
  "CONTRATO - MATRÍCULA INDIVIDUAL": rt("M-9001"), "CONTRATO - CRI DA MATRÍCULA": rt("1º CRI de Teste"),
  "CONTRATO - ÁREA DO LOTE (M²)": num(250),
  "CONTRATO - SINAL VALOR": num(10000), "CONTRATO - SINAL DATA": dat("2026-10-01"),
  "CONTRATO - ENTRADA VALOR": num(20000), "CONTRATO - ENTRADA VENCIMENTO": dat("2026-10-15"),
  "CONTRATO - FORMA DE PAGAMENTO": sel("PIX"), "CONTRATO - COMISSÃO FORMA": sel("PIX"),
  "CONTRATO - COMISSÃO VENCIMENTO": rt("na assinatura do financiamento"), "CONTRATO - COMISSÃO PAGA POR": sel("COMPRADOR"),
  "DATA DA ENTREGA": dat("2027-06-30"),
  "CONTRATO GERADO": GERADO,
};
const OBRA_PG = { "PROPRIETARIO DOCUMENTO": rt("Construtora Teste Ltda"), "CPF/CNPJ ": sel("00.000.000/0001-00"), "OBRA FINALIZADA?": sel("NÃO") };
const VENDEDOR = {
  NOME: tit("Construtora Teste Ltda"), TIPO: sel("PJ"), "CPF/CNPJ": rt("00.000.000/0001-00"), "ENDEREÇO / SEDE": rt("Av. Teste, 100"),
  "REPRESENTANTE NOME": rt("Beltrano Representante"), "REPRESENTANTE CPF": rt("000.000.002-72"), "REPRESENTANTE E-MAIL": rt("beltrano@teste.example"),
  "REPRESENTANTE RG": rt("RG 7654321 SSP/GO"), "REPRESENTANTE NACIONALIDADE": rt("brasileiro"), "REPRESENTANTE ESTADO CIVIL": rt("casado"),
  BANCO: rt("Banco Teste"), "AGÊNCIA": rt("0001"), CONTA: rt("12345-6"), PIX: rt("pix@teste.example"),
};
const LOTEAMENTO = { SETOR: tit("Setor Teste"), "DENOMINAÇÃO": rt("Residencial Teste"), "MUNICÍPIO/UF": rt("Cidade Teste/GO"),
                     "MATRÍCULA DO LOTEAMENTO": rt("M-100"), "CARTÓRIO": rt("Cartório Teste") };
const CORRETOR = { NOME: tit("Corretor Teste"), CRECI: rt("CRECI 123"), "CPF/CNPJ": rt("000.000.003-53"), "E-MAIL": rt("corretor@teste.example") };

const mescla = (base, mud) => {
  const r = Object.assign({}, base);
  for (const [k, v] of Object.entries(mud || {})) { if (v === null) delete r[k]; else r[k] = v; }
  return r;
};

/* Põe no último PDF de CONTRATO GERADO o carimbo dos dados (como o GerarContrato faz), ou o carimbo
 * dado em `modo` (texto). Usa o próprio servidor falso e apaga as chamadas/logs dessa conta. */
function carimbar(g, n, modo) {
  const pr = n.pagina.properties["CONTRATO GERADO"], arqs = (pr && pr.files) || [];
  if (!arqs.length) return;
  let st = typeof modo === "string" ? modo : "";
  if (!st) {
    try {
      const f = g.ctx.ctrFontes_(g.ctx.colunas_(), PAGE);
      if (!f.fontes) return;
      st = g.ctx.ctrCarimbo_(g.ctx.ContratoVenda.montarDadosContrato(f.fontes));
    } catch (e) { return; } finally { g.chamadas.length = 0; g.logs.length = 0; }
  }
  pr.files = arqs.map((a, i) => (i === arqs.length - 1 ? Object.assign({}, a, { name: a.name.replace(/\.pdf$/, " [#" + st + "].pdf") }) : a));
}

function cenario({ venda, vendedor, props, colunas, cs = {}, semProps = [], extras, carimbo = true } = {}) {
  const bases = { "db-vend": [mescla(VENDEDOR, vendedor)], "db-lote": [LOTEAMENTO], "db-corr": [CORRETOR],
                  "db-doc": [Object.assign({ "ENDEREÇO": tit("RESIDENCIAL TESTE QD 07 LT 12") }, OBRA_PG)] };
  const cols = colunas || colunasVenda();
  const valores = Object.fromEntries(Object.entries(mescla(VENDA, venda)).filter(([k]) => k in cols));
  const n = notionFalso({ colunas: cols, valores, paginasExtras: { [OBRA]: OBRA_PG }, paginasDb: { [OBRA]: "db-doc" }, bases,
                          s3: { gerado: { buf: Buffer.from(PDF_GERADO, "utf8"), mime: "application/pdf" } } });
  const c = clicksignFalso(cs);
  const p = Object.assign({}, PROPS, props);
  for (const s of semProps) delete p[s];
  const g = criarGas({ props: p, rotas: (url, opt) => c.rota(url, opt) || n.rota(url, opt), extras });
  if (carimbo) carimbar(g, n, carimbo);
  const acao = (action, tok = tokenDe()) => g.chamar({ action, token: tok, pageId: PAGE });
  const txt = (col) => (n.pagina.properties[col].rich_text || []).map((t) => t.plain_text).join("");
  return { g, n, c, p, acao, txt, enviar: (tok) => acao("assinaturaEnviar", tok), estado: (tok) => acao("assinaturaEstado", tok) };
}
const csCalls = (c) => c.c.chamadas.map((x) => x.metodo + " " + x.caminho);
const PESSOAIS = ["Fulano", "Beltrano", "Testemunha", "fulano@", "beltrano@", "t1.spe", "000.000.0", "Construtora"];

test("sem CLICKSIGN_TOKEN: CLICKSIGN_SEM_TOKEN e nenhuma chamada (nem ao Notion, nem à Clicksign)", () => {
  const c = cenario({ semProps: ["CLICKSIGN_TOKEN"] });
  assert.deepEqual(c.enviar(), { ok: false, erro: "CLICKSIGN_SEM_TOKEN" });
  assert.equal(c.c.chamadas.length, 0);
  assert.ok(!c.g.chamadas.some((x) => x.url.startsWith("https://api.notion.com/v1/pages")), "leu a página sem token");
});

test("envio feliz: ordem das chamadas, cabeçalhos e corpos; grava envelope e ENVIADO", () => {
  const c = cenario();
  const r = c.enviar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ENVIADO");
  const pend = { assinou: false, situacao: "pendente", data: "" };
  assert.ok(r.signatarios.every((s) => /@/.test(s.email)), "27/10: cada um com o e-mail para onde foi");
  assert.deepEqual(r.signatarios.map(({ email, ...s }) => s), [
    Object.assign({ papel: "Comprador 1", nome: "Fulano T." }, pend), Object.assign({ papel: "Vendedor (representante)", nome: "Beltrano R." }, pend),
    Object.assign({ papel: "Testemunha 1", nome: "Testemunha S." }, pend), Object.assign({ papel: "Testemunha 2", nome: "Testemunha S." }, pend)]);
  assert.ok(!JSON.stringify({ ...r, signatarios: r.signatarios.map(({ email, ...s }) => s) }).includes("@"), "e-mail fora do campo email");
  assert.deepEqual(csCalls(c), [
    "POST /envelopes", "POST /envelopes/env-1/documents",
    "POST /envelopes/env-1/signers", "POST /envelopes/env-1/signers", "POST /envelopes/env-1/signers", "POST /envelopes/env-1/signers",
    "POST /envelopes/env-1/requirements", "POST /envelopes/env-1/requirements",
    "POST /envelopes/env-1/requirements", "POST /envelopes/env-1/requirements",
    "POST /envelopes/env-1/requirements", "POST /envelopes/env-1/requirements",
    "POST /envelopes/env-1/requirements", "POST /envelopes/env-1/requirements",
    "PATCH /envelopes/env-1", "POST /envelopes/env-1/notifications"]);
  for (const x of c.c.chamadas) {
    assert.equal(x.headers.Authorization, TOKEN_CS, "Authorization sem Bearer, só o token");
    assert.equal(x.headers.Accept, "application/vnd.api+json");
    assert.equal(x.contentType, "application/vnd.api+json");
  }
  const [env, doc, s1, s2, , , q1, a1] = c.c.chamadas.map((x) => x.corpo);
  /* entrega 14: padrão "OBRA - COMPRADOR" (obra = endereço + CASA n) no envelope e no documento */
  assert.equal(env.data.attributes.name, "RESIDENCIAL TESTE QD 07 LT 12 CASA 3 - Fulano de Teste");
  assert.equal(doc.data.attributes.filename, "RESIDENCIAL TESTE QD 07 LT 12 CASA 3 - Fulano de Teste.pdf");
  assert.equal(doc.data.attributes.content_base64, "data:application/pdf;base64," + Buffer.from(PDF_GERADO).toString("base64"));
  assert.deepEqual(s1.data.attributes, { name: "Fulano de Teste", email: "fulano@teste.example", has_documentation: true,
                                         documentation: "000.000.001-91", refusable: true });
  assert.equal(s2.data.attributes.email, "beltrano@teste.example");
  assert.deepEqual(q1.data.attributes, { action: "agree", role: "buyer" });
  assert.deepEqual(q1.data.relationships, { document: { data: { type: "documents", id: "doc-1" } }, signer: { data: { type: "signers", id: "sig-1" } } });
  assert.deepEqual(a1.data.attributes, { action: "provide_evidence", auth: "email" });
  assert.equal(a1.data.relationships.signer.data.id, "sig-1");
  const roles = c.c.chamadas.filter((x) => x.corpo && x.corpo.data.attributes.action === "agree").map((x) => x.corpo.data.attributes.role);
  assert.deepEqual(roles, ["buyer", "seller", "witness", "witness"]);
  assert.deepEqual(c.c.chamadas.at(-2).corpo, { data: { id: "env-1", type: "envelopes", attributes: { status: "running" } } });
  assert.equal(c.c.estado.status, "running");
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  const papeis = JSON.parse(c.p["ASSINATURA_PAPEIS_env-1"]);
  assert.deepEqual(papeis, { "sig-1": "Comprador 1", "sig-2": "Vendedor (representante)", "sig-3": "Testemunha 1", "sig-4": "Testemunha 2" });
  /* duas gravações: o rascunho logo depois de criar o envelope, e ENVIADO depois de ativar */
  const sits = c.n.patches.map((x) => x["ASSINATURA - SITUAÇÃO"].rich_text.map((t) => t.text.content).join(""));
  assert.deepEqual(sits, ["RASCUNHO", "ENVIADO"]);
  assert.ok(c.g.logs.some((l) => l.includes("por ana.teste: ok")), c.g.logs.join(" | "));
});

test("trava: chama tryLock(10 s) e solta no fim; outra pessoa enviando → ASSINATURA_OCUPADA sem chamar ninguém", () => {
  const trava = { pedidos: [], soltas: 0, livre: true };
  const LockService = { getScriptLock: () => ({ tryLock: (ms) => { trava.pedidos.push(ms); return trava.livre; }, releaseLock: () => { trava.soltas++; } }) };
  const c = cenario({ extras: { LockService } });
  assert.equal(c.enviar().ok, true);
  assert.deepEqual(trava.pedidos, [10000]);
  assert.equal(trava.soltas, 1);
  trava.livre = false;
  const d = cenario({ extras: { LockService } });
  assert.deepEqual(d.enviar(), { ok: false, erro: "ASSINATURA_OCUPADA" });
  assert.equal(d.c.chamadas.length, 0);
  assert.equal(d.n.patches.length, 0);
});

test("o envelope fica anotado (RASCUNHO) logo depois de criado, antes de subir o documento", () => {
  let visto = null, c = null;
  c = cenario({ cs: { falhar: (m, cam) => { if (m === "POST" && cam.endsWith("/documents")) visto = [c.txt("ASSINATURA - ENVELOPE ID"), c.txt("ASSINATURA - SITUAÇÃO")]; return null; } } });
  assert.equal(c.enviar().ok, true);
  assert.deepEqual(visto, ["env-1", "RASCUNHO"]);
});

test("PDF sem carimbo (gerado antes desta versão) ou com carimbo de outros dados: CONTRATO_DESATUALIZADO, nada enviado", () => {
  for (const carimbo of [false, "00000000"]) {
    const c = cenario({ carimbo });
    assert.deepEqual(c.enviar(), { ok: false, erro: "CONTRATO_DESATUALIZADO" }, String(carimbo));
    assert.equal(c.c.chamadas.length, 0);
    assert.equal(c.n.patches.length, 0);
  }
  /* dado mudou depois de gerar: o carimbo calculado de outro representante não bate */
  const c = cenario();
  const nome = c.n.pagina.properties["CONTRATO GERADO"].files.at(-1).name;
  const d = cenario({ vendedor: { "REPRESENTANTE NOME": rt("Outro Representante Teste") }, carimbo: /\[#([0-9a-f]{8})\]/.exec(nome)[1] });
  assert.equal(d.enviar().erro, "CONTRATO_DESATUALIZADO");
});

test("envia o ÚLTIMO PDF de CONTRATO GERADO, baixado pela URL do Notion", () => {
  const c = cenario();
  c.enviar();
  assert.ok(c.g.chamadas.some((x) => x.url === "https://s3.falso/gerado"));
  assert.ok(!c.g.chamadas.some((x) => x.url === "https://s3.falso/velho"));
});

test("vendedor PF + corretor ligado: testemunhas PF e corretor como real_estate_broker", () => {
  const c = cenario({
    props: { ASSINATURA_INCLUIR_CORRETOR: "SIM" },
    vendedor: { TIPO: sel("PF"), NOME: tit("Construtora Teste Ltda"), "E-MAIL": rt("vendedor.pf@teste.example"),
                NACIONALIDADE: rt("brasileiro"), "ESTADO CIVIL": rt("casado"), "PROFISSÃO": rt("empresário"), RG: rt("RG 9") },
  });
  const r = c.enviar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const emails = c.c.chamadas.filter((x) => x.caminho.endsWith("/signers")).map((x) => x.corpo.data.attributes.email);
  assert.deepEqual(emails, ["fulano@teste.example", "vendedor.pf@teste.example", "t1.pf@teste.example", "t2.pf@teste.example", "corretor@teste.example"]);
  const roles = c.c.chamadas.filter((x) => x.corpo && x.corpo.data.attributes.action === "agree").map((x) => x.corpo.data.attributes.role);
  assert.deepEqual(roles, ["buyer", "seller", "witness", "witness", "real_estate_broker"]);
});

test("faltas de assinatura: FALTAM_DADOS legível e nenhuma chamada à Clicksign", () => {
  const c = cenario({ venda: { "Email": eml(null) }, semProps: ["ASSINATURA_TESTEMUNHAS_SPE"] });
  const r = c.enviar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Testemunhas: Propriedade ASSINATURA_TESTEMUNHAS_SPE não configurada (precisa de 2)",
                              "Comprador 1: e-mail (coluna Email)"]);
  assert.equal(c.c.chamadas.length, 0);
  assert.equal(c.n.patches.length, 0);
});

test("Propriedade com JSON quebrado vira falta legível", () => {
  const c = cenario({ props: { ASSINATURA_TESTEMUNHAS_SPE: "[{nome:" } });
  const r = c.enviar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.includes("Propriedade ASSINATURA_TESTEMUNHAS_SPE: JSON inválido"), JSON.stringify(r.faltas));
  assert.equal(c.c.chamadas.length, 0);
});

test("faltas do contrato também barram (não envia contrato de cadastro incompleto)", () => {
  const c = cenario({ venda: { "CONTRATO - ALVARÁ Nº": rt("") } });
  const r = c.enviar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.includes("Imóvel: alvará (número)"));
  assert.equal(c.c.chamadas.length, 0);
});

test("sem contrato gerado: SEM_CONTRATO_GERADO e nenhuma chamada à Clicksign", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": { files: [] } } });
  assert.deepEqual(c.enviar(), { ok: false, erro: "SEM_CONTRATO_GERADO" });
  assert.equal(c.c.chamadas.length, 0);
});

test("envelope já aberto: ENVELOPE_ABERTO; cancelado, recusado ou expirado deixam enviar de novo", () => {
  for (const sit of ["ENVIADO", "ASSINADO", "RASCUNHO", ""]) {
    const c = cenario({ venda: { "ASSINATURA - ENVELOPE ID": rt("env-velho"), "ASSINATURA - SITUAÇÃO": rt(sit) } });
    assert.deepEqual(c.enviar(), { ok: false, erro: "ENVELOPE_ABERTO", situacao: sit }, sit);
    assert.equal(c.c.chamadas.length, 0, sit);
  }
  for (const sit of ["CANCELADO", "RECUSADO", "EXPIRADO"]) {
    const c = cenario({ venda: { "ASSINATURA - ENVELOPE ID": rt("env-velho"), "ASSINATURA - SITUAÇÃO": rt(sit) } });
    assert.equal(c.enviar().ok, true, sit);
    assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1", sit);
  }
});

test("falha no meio (requisito recusado): não ativa, APAGA o rascunho, limpa as colunas e os papéis, devolve o passo e o detalhe", () => {
  let n = 0;
  const c = cenario({ cs: { falhar: (m, cam) => (m === "POST" && cam.endsWith("/requirements") && ++n === 3
    ? { status: 422, json: { errors: [{ title: "Erro de validação", detail: "role inválido para fulano@teste.example" }] } } : null) } });
  const r = c.enviar();
  assert.deepEqual(r, { ok: false, erro: "CLICKSIGN_FALHOU", passo: "requisitos", http: 422,
                        detalhe: "Erro de validação: role inválido para ***@teste.example", envelopeId: "env-1", rascunhoApagado: true });
  assert.ok(!c.c.chamadas.some((x) => x.metodo === "PATCH"), "ativou o envelope depois do erro");
  assert.ok(!c.c.chamadas.some((x) => x.caminho.endsWith("/notifications")));
  assert.equal(csCalls(c).at(-1), "DELETE /envelopes/env-1");
  assert.equal(c.c.estado.apagado, true);
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "");
  assert.ok(!("ASSINATURA_PAPEIS_env-1" in c.p), "papéis ficaram nas Propriedades");
  assert.ok(c.g.logs.some((l) => l.includes("falhou no passo requisitos http 422")), c.g.logs.join(" | "));
  assert.ok(!c.g.logs.join("\n").includes("role inválido"), "detalhe da Clicksign foi para o log");
  /* apagado: pode enviar de novo */
  assert.equal(c.enviar().ok, true);
});

test("falha no primeiro passo e exceção de rede também viram CLICKSIGN_FALHOU com o passo", () => {
  const a = cenario({ cs: { falhar: (m, cam) => (cam === "/envelopes" ? { status: 401, json: { errors: [{ title: "Não autorizado" }] } } : null) } });
  assert.deepEqual(a.enviar(), { ok: false, erro: "CLICKSIGN_FALHOU", passo: "envelope", http: 401, detalhe: "Não autorizado", envelopeId: "" });
  assert.equal(a.n.patches.length, 0);
  const b = cenario({ cs: { falhar: (m, cam) => (cam.endsWith("/documents") ? { lancar: "Timeout" } : null) } });
  const rb = b.enviar();
  assert.equal(rb.passo, "documento");
  assert.equal(rb.http, 0);
  assert.equal(rb.rascunhoApagado, true);
  assert.equal(b.txt("ASSINATURA - ENVELOPE ID"), "");
});

test("envelope criado sem id na resposta (2xx sem corpo): falha visível no passo envelope", () => {
  const c = cenario({ cs: { falhar: (m, cam) => (cam === "/envelopes" ? { status: 201, texto: "" } : null) } });
  const r = c.enviar();
  assert.deepEqual([r.ok, r.erro, r.passo, r.detalhe], [false, "CLICKSIGN_FALHOU", "envelope", "resposta sem id"]);
  assert.equal(c.n.patches.length, 0);
});

test("rascunho que não deu para apagar: fica RASCUNHO (barra novo envio); Atualizar situação limpa quando ele some da Clicksign", () => {
  const c = cenario({ cs: { falhar: (m, cam) => {
    if (m === "POST" && cam.endsWith("/signers")) return { status: 422, json: { errors: [{ title: "Erro" }] } };
    if (m === "DELETE") return { status: 500, texto: "<html>erro com https://url.secreta/x</html>" };
    return null;
  } } });
  const r = c.enviar();
  assert.deepEqual([r.erro, r.passo, r.rascunhoApagado], ["CLICKSIGN_FALHOU", "signatarios", false]);
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "RASCUNHO");
  assert.ok(c.g.logs.some((l) => l.includes("rascunho nao apagado http 500")), c.g.logs.join(" | "));
  assert.ok(!c.g.logs.join("\n").includes("url.secreta"));
  assert.deepEqual(c.enviar(), { ok: false, erro: "ENVELOPE_ABERTO", situacao: "RASCUNHO" });
  /* ainda existe como rascunho: Atualizar mostra RASCUNHO, sem ler documento nem signatários */
  const antes = c.c.chamadas.length;
  assert.deepEqual(c.estado(), { ok: true, situacao: "RASCUNHO", envelope: true, signatarios: [] });
  assert.deepEqual(csCalls(c).slice(antes), ["GET /envelopes/env-1"]);
  /* apagado à mão na Clicksign: Atualizar limpa as duas colunas e deixa enviar */
  c.c.estado.apagado = true;
  assert.deepEqual(c.estado(), { ok: true, situacao: "", envelope: false, signatarios: [] });
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "");
  /* volta a enviar (aqui falha de novo nos signatários, mas já não é ENVELOPE_ABERTO) */
  assert.equal(c.enviar().passo, "signatarios");
  assert.equal(c.c.chamadas.filter((x) => x.caminho === "/envelopes").length, 2);
});

test("envelope ENVIADO que sumiu (404) NÃO limpa as colunas: só rascunho é limpo", () => {
  const c = cenario({ venda: { "ASSINATURA - ENVELOPE ID": rt("env-outro"), "ASSINATURA - SITUAÇÃO": rt("ENVIADO") } });
  const r = c.estado();
  assert.deepEqual([r.ok, r.erro, r.http], [false, "CLICKSIGN_FALHOU", 404]);
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-outro");
});

test("ativar sem resposta ou com 5xx: consulta o envelope; se já está running, segue (grava ENVIADO e notifica)", () => {
  for (const falha of [{ lancar: "Timeout" }, { status: 502, texto: "" }]) {
    let c = null;
    c = cenario({ cs: { falhar: (m) => { if (m === "PATCH") { c.c.estado.status = "running"; return falha; } return null; } } });
    const r = c.enviar();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
    assert.deepEqual(csCalls(c).slice(-3), ["PATCH /envelopes/env-1", "GET /envelopes/env-1", "POST /envelopes/env-1/notifications"]);
  }
});

test("ativar sem resposta e o envelope continua rascunho: falha antes de ativar (apaga o rascunho)", () => {
  const c = cenario({ cs: { falhar: (m) => (m === "PATCH" ? { lancar: "Timeout" } : null) } });
  const r = c.enviar();
  assert.deepEqual([r.ok, r.erro, r.passo, r.http, r.rascunhoApagado], [false, "CLICKSIGN_FALHOU", "ativar", 0, true]);
  assert.deepEqual(csCalls(c).slice(-2), ["GET /envelopes/env-1", "DELETE /envelopes/env-1"]);
  assert.ok(!c.c.chamadas.some((x) => x.caminho.endsWith("/notifications")));
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
});

test("ativar sem resposta e a consulta também falha: não apaga nada (pode ter ativado) e fica RASCUNHO", () => {
  const c = cenario({ cs: { falhar: (m, cam) => (m === "PATCH" || (m === "GET" && cam === "/envelopes/env-1") ? { lancar: "Timeout" } : null) } });
  const r = c.enviar();
  assert.deepEqual([r.ok, r.erro, r.passo, r.incerto, r.rascunhoApagado], [false, "CLICKSIGN_FALHOU", "ativar", true, false]);
  assert.ok(!c.c.chamadas.some((x) => x.metodo === "DELETE"));
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "RASCUNHO");
  assert.ok("ASSINATURA_PAPEIS_env-1" in c.p, "papéis apagados de um envelope que pode estar ativo");
});

test("ativar e notificar com 204 (sem corpo) contam como sucesso", () => {
  let c = null;
  c = cenario({ cs: { falhar: (m, cam) => {
    if (m === "PATCH") { c.c.estado.status = "running"; return { status: 204, texto: "" }; }
    if (cam.endsWith("/notifications")) return { status: 204, texto: "" };
    return null;
  } } });
  const r = c.enviar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.aviso, undefined);
  assert.ok(!c.c.chamadas.some((x) => x.metodo === "GET"), "consultou à toa");
});

test("ativou mas o aviso falhou: grava ENVIADO e devolve ok com aviso", () => {
  const c = cenario({ cs: { falhar: (m, cam) => (cam.endsWith("/notifications") ? { status: 500, texto: "" } : null) } });
  const r = c.enviar();
  assert.equal(r.ok, true);
  assert.equal(r.aviso, "NOTIFICACAO_FALHOU");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
});

/* Notion que falha nos PATCH da página quando `cair(props)` diz; conta as tentativas. */
function notionCaindo(c, cair) {
  const rotaOriginal = c.g.ctx.UrlFetchApp.fetch, estado = { tentativas: 0, cair };
  c.g.ctx.UrlFetchApp.fetch = (url, opt) => {
    if (url.startsWith("https://api.notion.com/v1/pages/") && String(opt.method).toUpperCase() === "PATCH") {
      const props = JSON.parse(opt.payload).properties;
      if (estado.cair(props)) { estado.tentativas++; throw new Error("Notion fora"); }
    }
    return rotaOriginal(url, opt);
  };
  return estado;
}
const gravaSituacao = (sit) => (props) => (props["ASSINATURA - SITUAÇÃO"].rich_text || []).map((t) => t.text.content).join("") === sit;

test("Notion não grava nem o rascunho: apaga o envelope recém-criado, nada é ativado", () => {
  const c = cenario();
  notionCaindo(c, gravaSituacao("RASCUNHO"));
  const r = c.enviar();
  assert.deepEqual(r, { ok: false, erro: "GRAVACAO_FALHOU", rascunhoApagado: true });
  assert.deepEqual(csCalls(c), ["POST /envelopes", "DELETE /envelopes/env-1"]);
});

test("ativou mas o Notion não gravou: tenta 3 vezes, guarda ASSINATURA_PENDENTE_<página>, notifica e recusa novo envio", () => {
  const c = cenario();
  const notion = notionCaindo(c, gravaSituacao("ENVIADO"));
  const r = c.enviar();
  assert.deepEqual([r.ok, r.erro, r.envelopeId], [false, "GRAVACAO_FALHOU", "env-1"]);
  assert.equal(notion.tentativas, 3);
  assert.equal(c.p["ASSINATURA_PENDENTE_" + PAGE], "env-1");
  assert.ok(c.c.chamadas.some((x) => x.caminho.endsWith("/notifications")), "envelope ativo ficou sem aviso aos signatários");
  assert.ok(c.g.logs.some((l) => l.includes("env-1")));
  /* mesmo com as colunas apagadas à mão, a chave pendente barra outro envio */
  c.n.pagina.properties["ASSINATURA - ENVELOPE ID"].rich_text = [];
  c.n.pagina.properties["ASSINATURA - SITUAÇÃO"].rich_text = [];
  assert.equal(c.enviar().erro, "ENVELOPE_ABERTO");
  assert.equal(c.c.chamadas.filter((x) => x.caminho === "/envelopes").length, 1);
  /* Atualizar situação usa o id guardado, grava as duas colunas e apaga a chave */
  c.c.estado.status = "running";
  notion.cair = () => false;
  const e = c.estado();
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.equal(e.situacao, "ENVIADO");
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.ok(!(("ASSINATURA_PENDENTE_" + PAGE) in c.p));
});

test("Notion falha uma vez depois de ativar: a 2ª tentativa grava e não sobra chave pendente", () => {
  const c = cenario();
  let vezes = 0;
  notionCaindo(c, (props) => gravaSituacao("ENVIADO")(props) && ++vezes === 1);
  assert.equal(c.enviar().ok, true);
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.ok(!(("ASSINATURA_PENDENTE_" + PAGE) in c.p));
});

test("download do contrato gerado sem resposta: CONTRATO_ILEGIVEL, log sem URL", () => {
  const c = cenario();
  const rotaOriginal = c.g.ctx.UrlFetchApp.fetch;
  c.g.ctx.UrlFetchApp.fetch = (url, opt) => { if (url === "https://s3.falso/gerado") throw new Error("Timeout em " + url); return rotaOriginal(url, opt); };
  assert.deepEqual(c.enviar(), { ok: false, erro: "CONTRATO_ILEGIVEL" });
  assert.equal(c.c.chamadas.length, 0);
  assert.ok(!c.g.logs.join("\n").includes("s3.falso"), c.g.logs.join(" | "));
});

test("colunas novas ausentes: COLUNA_FALTANDO com os nomes", () => {
  const c = cenario({ colunas: colunasVenda(["ASSINATURA - ENVELOPE ID", "CONTRATO ASSINADO"]) });
  const r = c.enviar();
  assert.match(r.erro, /^COLUNA_FALTANDO: /);
  assert.ok(r.erro.includes("ASSINATURA - ENVELOPE ID") && r.erro.includes("CONTRATO ASSINADO"), r.erro);
  assert.equal(c.c.chamadas.length, 0);
});

test("perfil TESTES não envia nem atualiza a situação (Atualizar grava na casa)", () => {
  const c = cenario({ venda: { "ASSINATURA - ENVELOPE ID": rt("env-1"), "ASSINATURA - SITUAÇÃO": rt("ENVIADO") } });
  assert.equal(c.enviar(tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(c.estado(tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(c.c.chamadas.length, 0);
  assert.equal(c.n.patches.length, 0);
});

test("estado sem envelope: situação vazia e nenhuma chamada à Clicksign", () => {
  const c = cenario({ semProps: ["CLICKSIGN_TOKEN"] });
  assert.deepEqual(c.estado(), { ok: true, situacao: "", envelope: false, signatarios: [] });
  assert.equal(c.c.chamadas.length, 0);
});

test("estado em andamento: quem já assinou (evento sign) com a data, nome mascarado, e-mail só no campo email de cada um (27/10)", () => {
  const c = cenario({ cs: { eventos: [{ type: "events", attributes: { name: "sign", created: "2026-10-07T10:20:30.000-03:00",
                                                                     data: { signer: { email: "FULANO@teste.example" } } } }] } });
  assert.equal(c.enviar().ok, true);
  const r = c.estado();
  const pend = { assinou: false, situacao: "pendente", data: "" };
  assert.ok(r.signatarios.every((s) => /@/.test(s.email)));
  assert.deepEqual({ ...r, signatarios: r.signatarios.map(({ email, ...s }) => s) }, { ok: true, situacao: "ENVIADO", envelope: true, temAssinado: false, signatarios: [
    { papel: "Comprador 1", nome: "Fulano T.", assinou: true, situacao: "assinou", data: "2026-10-07T10:20:30.000-03:00" },
    Object.assign({ papel: "Vendedor (representante)", nome: "Beltrano R." }, pend),
    Object.assign({ papel: "Testemunha 1", nome: "Testemunha S." }, pend), Object.assign({ papel: "Testemunha 2", nome: "Testemunha S." }, pend)] });
  const semEmail = JSON.stringify({ ...r, signatarios: r.signatarios.map(({ email, ...s }) => s) });
  assert.ok(!semEmail.includes("@") && !JSON.stringify(r).includes("Fulano de Teste"), "e-mail fora do campo email ou nome inteiro");
  assert.equal(c.c.estado.baixados, 0);
  assert.deepEqual(c.n.pagina.properties["CONTRATO ASSINADO"].files, []);
});

const SIGN = (email) => ({ type: "events", attributes: { name: "sign", data: { signer: { email } } } });
const TODOS_ASSINARAM = ["fulano@teste.example", "beltrano@teste.example", "t1.spe@teste.example", "t2.spe@teste.example"].map(SIGN);

test("estado concluído: baixa o PDF assinado, anexa em CONTRATO ASSINADO (troca) e grava ASSINADO", () => {
  const c = cenario({ venda: { "CONTRATO ASSINADO": { files: [{ name: "antigo.pdf", type: "file", file: { url: "https://s3.falso/antigo" } }] } },
                      cs: { eventos: TODOS_ASSINARAM,
                            arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.equal(c.enviar().ok, true);
  c.c.estado.status = "closed";
  const r = c.estado();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ASSINADO");
  assert.ok(r.signatarios.every((s) => s.assinou));
  const arqs = c.n.pagina.properties["CONTRATO ASSINADO"].files;
  assert.equal(arqs.length, 1);
  assert.equal(arqs[0].name, "CONTRATO ASSINADO - RESIDENCIAL TESTE QD 07 LT 12 - 01-10-2026.pdf");
  assert.equal(c.n.uploads[arqs[0].file.url.split("/").pop()].buf.toString("utf8"), PDF_ASSINADO);
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ASSINADO");
  const baixar = c.g.chamadas.find((x) => x.url === "https://s3.clicksign.falso/assinado.pdf");
  assert.ok(!baixar.opt.headers || !baixar.opt.headers.Authorization, "mandou o token para o link do arquivo");
  assert.equal(r.aviso, undefined);
  assert.ok(!("ASSINATURA_PAPEIS_env-1" in c.p), "situação final: papéis apagados");
  /* segunda consulta: já assinado e anexado — não baixa de novo */
  c.estado();
  assert.equal(c.c.estado.baixados, 1);
});

test("closed sem o evento sign de alguém: continua ASSINADO, não marca essa pessoa e avisa ASSINATURAS_INCOMPLETAS", () => {
  const c = cenario({ cs: { eventos: TODOS_ASSINARAM.slice(0, 3),
                            arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.equal(c.enviar().ok, true);
  c.c.estado.status = "closed";
  const r = c.estado();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ASSINADO");
  assert.equal(r.aviso, "ASSINATURAS_INCOMPLETAS");
  assert.deepEqual(r.signatarios.map((s) => s.assinou), [true, true, true, false]);
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ASSINADO");
  assert.ok(c.g.logs.some((l) => l.includes("assinaturas incompletas")), c.g.logs.join(" | "));
});

test("download do PDF assinado sem resposta: DOWNLOAD_ASSINADO_FALHOU, log só com o código, sem URL", () => {
  const c = cenario({ cs: { eventos: TODOS_ASSINARAM, arquivos: { signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.equal(c.enviar().ok, true);
  c.c.estado.status = "closed";
  const rotaOriginal = c.g.ctx.UrlFetchApp.fetch;
  c.g.ctx.UrlFetchApp.fetch = (url, opt) => { if (url.includes("assinado.pdf")) throw new Error("Timeout em " + url); return rotaOriginal(url, opt); };
  assert.deepEqual(c.estado(), { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" });
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.ok(!c.g.logs.join("\n").includes("clicksign.falso"), c.g.logs.join(" | "));
});

test("estado concluído sem link do assinado: erro visível, situação não vira ASSINADO", () => {
  const c = cenario();
  assert.equal(c.enviar().ok, true);
  c.c.estado.status = "closed";
  const r = c.estado();
  assert.deepEqual([r.ok, r.erro], [false, "CLICKSIGN_SEM_LINK_ASSINADO: original"]);
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.deepEqual(c.n.pagina.properties["CONTRATO ASSINADO"].files, []);
});

test("estado: cancelado, recusado e expirado gravam a situação", () => {
  const casos = [[[], "CANCELADO"], [[{ type: "events", attributes: { name: "refusal", data: {} } }], "RECUSADO"],
                 [[{ type: "events", attributes: { name: "deadline", data: {} } }], "EXPIRADO"]];
  for (const [eventos, sit] of casos) {
    const c = cenario({ cs: { eventos } });
    c.enviar();
    c.c.estado.status = "canceled";
    assert.equal(c.estado().situacao, sit);
    assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), sit);
    assert.ok(!("ASSINATURA_PAPEIS_env-1" in c.p), sit + ": papéis ficaram");
  }
  /* em andamento os papéis continuam */
  const c = cenario();
  c.enviar(); c.c.estado.status = "running";
  c.estado();
  assert.ok("ASSINATURA_PAPEIS_env-1" in c.p);
});

test("estado com status desconhecido da Clicksign: erro visível, nada gravado", () => {
  const c = cenario();
  c.enviar();
  c.c.estado.status = "paused";
  const r = c.estado();
  assert.deepEqual([r.ok, r.erro], [false, "CLICKSIGN_STATUS_DESCONHECIDO: paused"]);
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
});

test("CLICKSIGN_URL: padrão sandbox; produção pela Propriedade; http recusado", () => {
  const prod = cenario({ props: { CLICKSIGN_URL: "https://app.clicksign.com/" }, cs: { base: "https://app.clicksign.com" } });
  assert.equal(prod.enviar().ok, true);
  assert.ok(prod.g.chamadas.some((x) => x.url === "https://app.clicksign.com/api/v3/envelopes"));
  const ruim = cenario({ props: { CLICKSIGN_URL: "http://app.clicksign.com" } });
  assert.deepEqual(ruim.enviar(), { ok: false, erro: "CLICKSIGN_URL_INVALIDA" });
  assert.equal(ruim.c.chamadas.length, 0);
});

test("nenhum log carrega token, nome, e-mail ou CPF", () => {
  const feliz = cenario(); feliz.enviar(); feliz.c.estado.status = "closed"; feliz.estado();
  const falha = cenario({ cs: { falhar: (m, cam) => (cam.endsWith("/signers") ? { status: 422, json: { errors: [{ detail: "Fulano de Teste inválido" }] } } : null) } });
  falha.enviar();
  for (const c of [feliz, falha]) {
    const todos = c.g.logs.join("\n");
    assert.ok(c.g.logs.length > 0, "nenhum log: o teste não prova nada");
    assert.ok(!todos.includes(TOKEN_CS), "log com o token");
    for (const s of PESSOAIS) assert.ok(!todos.includes(s), "log vazou: " + s);
  }
});

test("conferirAssinatura (rodar no editor): token aceito, testemunhas certas, sem segredo nem dado pessoal no log", () => {
  const c = cenario();
  c.c.chamadas.length = 0;
  const r = c.g.ctx.conferirAssinatura();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(csCalls(c), ["GET /envelopes?page%5Bsize%5D=1"]);
  assert.equal(c.c.chamadas[0].headers.Authorization, TOKEN_CS);
  const log = c.g.logs.join("\n");
  assert.ok(log.includes("sandbox"), log);
  assert.ok(log.includes("Clicksign aceitou o token (http 200)"), log);
  assert.ok(!log.includes(TOKEN_CS), "log com o token");
  for (const s of PESSOAIS) assert.ok(!log.includes(s), "log vazou: " + s);
});

test("conferirAssinatura: sem token não chama nada; 'Bearer' colado e token recusado viram orientação", () => {
  const sem = cenario({ semProps: ["CLICKSIGN_TOKEN"] });
  sem.c.chamadas.length = 0;
  assert.equal(sem.g.ctx.conferirAssinatura().ok, false);
  assert.equal(sem.c.chamadas.length, 0);
  assert.ok(sem.g.logs.join("\n").includes("CLICKSIGN_TOKEN não está nas Propriedades do script"));

  const bearer = cenario({ props: { CLICKSIGN_TOKEN: "Bearer " + TOKEN_CS } });
  bearer.c.chamadas.length = 0;
  assert.equal(bearer.g.ctx.conferirAssinatura().ok, false);
  assert.equal(bearer.c.chamadas.length, 0);
  assert.ok(bearer.g.logs.join("\n").includes("sem a palavra Bearer"));

  const rec = cenario({ cs: { falhar: (m, cam) => (cam.startsWith("/envelopes?") ? { status: 401, json: { errors: [{ title: "Unauthorized" }] } } : null) } });
  rec.c.chamadas.length = 0;
  assert.equal(rec.g.ctx.conferirAssinatura().ok, false);
  assert.ok(rec.g.logs.join("\n").includes("Clicksign recusou o token (http 401)"), rec.g.logs.join("\n"));
  assert.ok(rec.g.logs.join("\n").includes("A Clicksign disse: Unauthorized"), rec.g.logs.join("\n"));
});

test("conferirAssinatura: 403 mostra o motivo da Clicksign com e-mail mascarado; corpo sem JSON vira (sem detalhe)", () => {
  const neg = cenario({ cs: { falhar: (m, cam) => (cam.startsWith("/envelopes?") ? { status: 403, json: { errors: [{ title: "Forbidden", detail: "fulano@teste.example sem permissão" }] } } : null) } });
  neg.c.chamadas.length = 0;
  assert.equal(neg.g.ctx.conferirAssinatura().ok, false);
  const log = neg.g.logs.join("\n");
  assert.ok(log.includes("negou o acesso (http 403)"), log);
  assert.ok(log.includes("A Clicksign disse: Forbidden: ***@teste.example sem permissão"), log);
  assert.ok(!log.includes("fulano@"), "log com e-mail");
  const html = cenario({ cs: { falhar: (m, cam) => (cam.startsWith("/envelopes?") ? { status: 403, texto: "<html>bloqueado</html>" } : null) } });
  html.c.chamadas.length = 0;
  html.g.ctx.conferirAssinatura();
  assert.ok(html.g.logs.join("\n").includes("A Clicksign disse: (sem detalhe)"), html.g.logs.join("\n"));
});

test("conferirAssinatura: URL de produção avisa; testemunha inválida derruba o ok sem mostrar quem", () => {
  const prod = cenario({ props: { CLICKSIGN_URL: "https://app.clicksign.com", ASSINATURA_TESTEMUNHAS_PF: "{" }, cs: { base: "https://app.clicksign.com" } });
  prod.c.chamadas.length = 0;
  const r = prod.g.ctx.conferirAssinatura();
  assert.equal(r.ok, false);
  const log = prod.g.logs.join("\n");
  assert.ok(log.includes("PRODUÇÃO"), log);
  assert.ok(log.includes("ASSINATURA_TESTEMUNHAS_PF: não é um JSON válido"), log);
  for (const s of PESSOAIS) assert.ok(!log.includes(s), "log vazou: " + s);
});

/* ---- assinaturaReenviar ---- */
const reenviar = (c, tok) => c.acao("assinaturaReenviar", tok);
const notificacoes = (c) => c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/notifications").length;

test("reenviar: avisa os pendentes pela rota de notificações, guarda a hora e não grava na casa", () => {
  const c = cenario({ cs: { eventos: [SIGN("fulano@teste.example")] } });
  assert.equal(c.enviar().ok, true);
  const antes = notificacoes(c), patches = c.n.patches.length;
  const r = reenviar(c);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.pendentes, 3);
  assert.equal(r.situacao, "ENVIADO");
  assert.deepEqual(r.signatarios.map((s) => s.situacao), ["assinou", "pendente", "pendente", "pendente"]);
  assert.equal(notificacoes(c), antes + 1);
  const corpo = c.c.chamadas.filter((x) => x.caminho === "/envelopes/env-1/notifications").pop().corpo;
  assert.deepEqual(corpo, { data: { type: "notifications", attributes: {} } });
  assert.match(c.p["ASSINATURA_REENVIO_env-1"], /^\d+$/);
  assert.equal(c.n.patches.length, patches, "reenviar gravou na casa");
  assert.ok(!JSON.stringify({ ...r, signatarios: (r.signatarios || []).map(({ email, ...s }) => s) }).includes("@"));
  const todos = c.g.logs.join("\n");
  for (const s of PESSOAIS) assert.ok(!todos.includes(s), "log vazou: " + s);
  assert.match(todos, /reenviar 01234567 por ana\.teste: ok pendentes 3/);
});

test("reenviar: no máximo 1 a cada 10 minutos por envelope", () => {
  const c = cenario();
  c.enviar(); c.c.estado.status = "running";
  assert.equal(reenviar(c).ok, true);
  const n = notificacoes(c);
  const r = reenviar(c);
  assert.equal(r.erro, "REENVIO_RECENTE");
  assert.equal(r.minutos, 10);
  assert.equal(notificacoes(c), n);
  c.p["ASSINATURA_REENVIO_env-1"] = String(Date.now() - 11 * 60000);
  assert.equal(reenviar(c).ok, true);
});

test("reenviar: sem envelope, envelope não ativo, recusado ou ninguém pendente não notifica", () => {
  const sem = cenario();
  assert.deepEqual(reenviar(sem), { ok: false, erro: "SEM_ENVELOPE" });
  assert.equal(sem.c.chamadas.length, 0);
  for (const [status, sit] of [["closed", "ASSINADO"], ["canceled", "CANCELADO"], ["draft", "RASCUNHO"]]) {
    const c = cenario(); c.enviar(); c.c.estado.status = status;
    const n = notificacoes(c);
    assert.deepEqual(reenviar(c), { ok: false, erro: "ENVELOPE_NAO_ATIVO", situacao: sit });
    assert.equal(notificacoes(c), n);
  }
  const rec = cenario({ cs: { eventos: [{ type: "events", attributes: { name: "refusal", data: { signer: { email: "beltrano@teste.example" } } } }] } });
  rec.enviar();
  assert.deepEqual(reenviar(rec), { ok: false, erro: "ENVELOPE_NAO_ATIVO", situacao: "RECUSADO" });
  const todos = cenario({ cs: { eventos: TODOS_ASSINARAM } });
  todos.enviar();
  const n = notificacoes(todos), r = reenviar(todos);
  assert.equal(r.erro, "NINGUEM_PENDENTE");
  assert.equal(notificacoes(todos), n);
  assert.ok(!("ASSINATURA_REENVIO_env-1" in todos.p));
});

test("reenviar: Clicksign recusa → CLICKSIGN_FALHOU no passo reenviar, sem guardar a hora", () => {
  let falhar = false;
  const c = cenario({ cs: { falhar: (m, cam) => (falhar && m === "POST" && cam.endsWith("/notifications") ? { status: 422, json: { errors: [{ title: "Inválido" }] } } : null) } });
  c.enviar(); falhar = true;
  const r = reenviar(c);
  assert.deepEqual([r.ok, r.erro, r.passo, r.http], [false, "CLICKSIGN_FALHOU", "reenviar", 422]);
  assert.ok(!("ASSINATURA_REENVIO_env-1" in c.p));
});

test("reenviar: perfil TESTES não pode; trava ocupada → ASSINATURA_OCUPADA sem chamar a Clicksign; sem token avisa", () => {
  const c = cenario(); c.enviar();
  const n = c.c.chamadas.length;
  assert.equal(reenviar(c, tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(c.c.chamadas.length, n);
  const LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
  const d = cenario({ venda: { "ASSINATURA - ENVELOPE ID": rt("env-1"), "ASSINATURA - SITUAÇÃO": rt("ENVIADO") }, extras: { LockService } });
  assert.deepEqual(reenviar(d), { ok: false, erro: "ASSINATURA_OCUPADA" });
  assert.equal(d.c.chamadas.length, 0);
  const e = cenario({ semProps: ["CLICKSIGN_TOKEN"] });
  assert.deepEqual(reenviar(e), { ok: false, erro: "CLICKSIGN_SEM_TOKEN" });
});

test("estado final apaga a hora do último reenvio", () => {
  const c = cenario({ cs: { eventos: TODOS_ASSINARAM, arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  c.enviar(); c.p["ASSINATURA_REENVIO_env-1"] = "1";
  c.c.estado.status = "closed";
  assert.equal(c.estado().situacao, "ASSINADO");
  assert.ok(!("ASSINATURA_REENVIO_env-1" in c.p));
});

test("testemunhas (entrega 10): contratoEstado lista só id e nome; escolherTestemunhas grava, recusa ruim e TESTES, e volta ao padrão", () => {
  const OPS = [{ nome: "Escolha Um Teste", email: "e1@teste.example", cpf: "" }, { nome: "Escolha Dois Teste", email: "e2@teste.example", cpf: "" }];
  const c = cenario({ props: { ASSINATURA_TESTEMUNHAS_OPCOES: JSON.stringify(OPS) } });
  const t = c.acao("contratoEstado").testemunhas;
  const ids = t.opcoes.filter((o) => /Escolha/.test(o.nome)).map((o) => o.id);
  assert.equal(ids.length, 2);
  assert.doesNotMatch(JSON.stringify(t), /@/);
  const escolher = (x, tok = tokenDe()) => c.g.chamar({ action: "escolherTestemunhas", token: tok, pageId: PAGE, ids: x });
  assert.equal(escolher([ids[1], ids[0]], tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(escolher([ids[0], ids[0]]).erro, "TESTEMUNHAS_INVALIDAS");
  assert.equal(escolher(["nao-existe", ids[0]]).erro, "TESTEMUNHAS_INVALIDAS");
  const r = escolher([ids[1], ids[0]]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.testemunhas.escolhidas, [ids[1], ids[0]]);
  assert.deepEqual(c.acao("contratoEstado").testemunhas.escolhidas, [ids[1], ids[0]]);
  assert.deepEqual(escolher([]).testemunhas.escolhidas, []);
  assert.deepEqual(c.acao("contratoEstado").testemunhas.escolhidas, []);
});

test("testemunhas (entrega 10): as escolhidas são as que vão para a Clicksign; com envelope aberto não mudam", () => {
  const OPS = [{ nome: "Escolha Um Teste", email: "e1@teste.example", cpf: "" }, { nome: "Escolha Dois Teste", email: "e2@teste.example", cpf: "" }];
  const c = cenario({ props: { ASSINATURA_TESTEMUNHAS_OPCOES: JSON.stringify(OPS) } });
  const ids = c.acao("contratoEstado").testemunhas.opcoes.filter((o) => /Escolha/.test(o.nome)).map((o) => o.id);
  assert.equal(c.g.chamar({ action: "escolherTestemunhas", token: tokenDe(), pageId: PAGE, ids }).ok, true);
  assert.equal(c.enviar().ok, true);
  const corpos = c.c.chamadas.filter((x) => x.metodo === "POST" && /\/signers$/.test(x.caminho)).map((x) => JSON.stringify(x.corpo));
  assert.ok(corpos.some((b) => b.includes("e1@teste.example")) && corpos.some((b) => b.includes("e2@teste.example")), "escolhidas enviadas");
  const aberto = cenario({ props: { ASSINATURA_TESTEMUNHAS_OPCOES: JSON.stringify(OPS) },
                           venda: { "ASSINATURA - ENVELOPE ID": rt("env-velho"), "ASSINATURA - SITUAÇÃO": rt("ENVIADO") } });
  assert.equal(aberto.g.chamar({ action: "escolherTestemunhas", token: tokenDe(), pageId: PAGE, ids }).erro, "ENVELOPE_ABERTO");
});

test("entrega 14: temAssinado no estado e Ver contrato assinado pelo portal (base64, sem link; TESTES pode ver)", () => {
  const c = cenario({ cs: { eventos: TODOS_ASSINARAM,
                            arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.deepEqual(c.acao("verContratoAssinado"), { ok: false, erro: "SEM_ASSINADO" });
  assert.equal(c.enviar().ok, true);
  assert.equal(c.estado().temAssinado, false, "enviado: ainda sem PDF assinado");
  c.c.estado.status = "closed";
  const r = c.estado();
  assert.equal(r.situacao, "ASSINADO");
  assert.equal(r.temAssinado, true);
  const v = c.acao("verContratoAssinado", tokenDe("TESTES"));
  assert.equal(v.ok, true, JSON.stringify(v).slice(0, 200));
  assert.equal(Buffer.from(v.base64, "base64").toString("utf8"), PDF_ASSINADO);
  assert.match(v.nome, /^CONTRATO ASSINADO - /);
  assert.ok(!JSON.stringify(v).includes("https://"), "a resposta não leva link");
  assert.ok(!c.g.logs.join("\n").includes("s3."), "log sem URL");
});

/* ---- 29/10: assinaturaCancelar ---- */
test("cancelar: cada documento em andamento vira canceled (a API não cancela o envelope), grava CANCELADO e libera o Enviar", () => {
  const c = cenario();
  assert.equal(c.enviar().ok, true);
  const r = c.acao("assinaturaCancelar");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cancelou, true);
  assert.equal(r.situacao, "CANCELADO");
  const pd = c.c.chamadas.filter((x) => x.metodo === "PATCH" && /^\/envelopes\/env-1\/documents\//.test(x.caminho));
  assert.ok(pd.length >= 1);
  assert.deepEqual(pd[0].corpo, { data: { id: "doc-1", type: "documents", attributes: { status: "canceled" } } });
  assert.ok(!c.c.chamadas.some((x) => x.metodo === "PATCH" && x.caminho === "/envelopes/env-1" && x.corpo.data.attributes.status === "canceled"));
  assert.match(c.g.logs.join("\n"), /cancelar 01234567 por ana\.teste: ok/);
  /* o envelope continua running na Clicksign, mas com todos os documentos cancelados conta como cancelado */
  const de_novo = c.acao("assinaturaCancelar");
  assert.equal(de_novo.erro, "ENVELOPE_NAO_ATIVO");
});

test("cancelar: sem envelope não chama a Clicksign; perfil TESTES não pode", () => {
  const c = cenario();
  c.c.chamadas.length = 0;
  assert.equal(c.acao("assinaturaCancelar").erro, "SEM_ENVELOPE");
  assert.equal(c.c.chamadas.length, 0);
  assert.equal(c.acao("assinaturaCancelar", tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
});

/* ---- 429/503 da Clicksign: nova tentativa com espera crescente (teto de 180 s) ---- */
const soma = (a) => a.reduce((x, y) => x + y, 0);
test("429 nas 2 primeiras vezes do PATCH de ativar: tenta de novo e envia (2 esperas crescentes)", () => {
  let n = 0;
  const c = cenario({ cs: { falhar: (m) => (m === "PATCH" && ++n <= 2 ? { status: 429, json: { errors: [{ title: "Too many" }] } } : null) } });
  const r = c.enviar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const esperas = c.g.sleeps.filter((x) => x >= 1000);
  assert.deepEqual(esperas, [2000, 4000]);
  assert.equal(csCalls(c).filter((x) => x.startsWith("PATCH")).length, 3);
});
test("503 também tenta de novo; 500 e 422 não", () => {
  let n = 0;
  const a = cenario({ cs: { falhar: (m) => (m === "PATCH" && ++n === 1 ? { status: 503, texto: "" } : null) } });
  assert.equal(a.enviar().ok, true);
  assert.deepEqual(a.g.sleeps.filter((x) => x >= 1000), [2000]);
  const b = cenario({ cs: { falhar: (m, cam) => (cam.endsWith("/signers") ? { status: 422, json: { errors: [{ title: "x" }] } } : null) } });
  b.enviar();
  assert.equal(csCalls(b).filter((x) => x === "POST /envelopes/env-1/signers").length, 1);
  assert.deepEqual(b.g.sleeps.filter((x) => x >= 1000), []);
});
test("429 sempre: desiste dentro de 180 s no total e devolve CLICKSIGN_FALHOU", () => {
  const c = cenario({ cs: { falhar: (m, cam) => (cam === "/envelopes" ? { status: 429, json: { errors: [{ title: "Too many" }] } } : null) } });
  const r = c.enviar();
  assert.equal(r.erro, "CLICKSIGN_FALHOU");
  assert.equal(r.http, 429);
  const t = soma(c.g.sleeps);
  assert.ok(t > 0 && t <= 180000, "esperou " + t);
  assert.ok(c.g.sleeps.slice(0, 3).every((x, i, a) => i === 0 || x > a[i - 1]), "espera não cresceu");
});
test("Retry-After: 7 → a 1ª espera é de 7000 ms", () => {
  let n = 0;
  const c = cenario({ cs: { falhar: (m) => (m === "PATCH" && ++n === 1 ? { status: 429, headers: { "Retry-After": "7" }, json: { errors: [{ title: "x" }] } } : null) } });
  assert.equal(c.enviar().ok, true);
  assert.equal(c.g.sleeps.filter((x) => x >= 1000)[0], 7000);
});
test("pausa de 250 ms entre um POST de requisito e outro", () => {
  const c = cenario();
  assert.equal(c.enviar().ok, true);
  const reqs = csCalls(c).filter((x) => x.endsWith("/requirements")).length;
  assert.ok(reqs > 1);
  assert.ok(c.g.sleeps.filter((x) => x === 250).length >= reqs - 1, "pausas: " + c.g.sleeps.filter((x) => x === 250).length);
});

/* ---- rodada de conserto 1 ---- */
test("PATCH de ativar: 503 e depois 4xx com o envelope de fato ativo = envio ok, sem DELETE", () => {
  let n = 0, c;
  c = cenario({ cs: { falhar: (m) => {
    if (m !== "PATCH") return null;
    if (++n === 1) { c.c.estado.status = "running"; return { status: 503, texto: "" }; }
    return { status: 422, json: { errors: [{ title: "Envelope já em andamento" }] } };
  } } });
  const r = c.enviar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!csCalls(c).some((x) => x.startsWith("DELETE")), "apagou envelope ativo");
});
test("PATCH de ativar falha (4xx) e a consulta também: incerto, nada apagado", () => {
  const c = cenario({ cs: { falhar: (m, cam) => (m === "PATCH" ? { status: 422, json: { errors: [{ title: "x" }] } }
    : (m === "GET" && cam === "/envelopes/env-1" ? { lancar: "Timeout" } : null)) } });
  const r = c.enviar();
  assert.equal(r.incerto, true, JSON.stringify(r));
  assert.ok(!csCalls(c).some((x) => x.startsWith("DELETE")));
});
test("503 em POST não é repetido (só o 429); 429 em POST é", () => {
  const a = cenario({ cs: { falhar: (m, cam) => (m === "POST" && cam.endsWith("/signers") ? { status: 503, texto: "" } : null) } });
  const r = a.enviar();
  assert.equal(r.erro, "CLICKSIGN_FALHOU");
  assert.equal(csCalls(a).filter((x) => x === "POST /envelopes/env-1/signers").length, 1);
  let n = 0;
  const b = cenario({ cs: { falhar: (m, cam) => (m === "POST" && cam.endsWith("/signers") && ++n === 1 ? { status: 429, json: {} } : null) } });
  assert.equal(b.enviar().ok, true);
});
test("Retry-After: 1 com 429 permanente: no máximo 6 tentativas na chamada", () => {
  let n = 0;
  const c = cenario({ cs: { falhar: (m, cam) => (cam === "/envelopes" ? (n++, { status: 429, headers: { "retry-after": "1" }, json: {} }) : null) } });
  assert.equal(c.enviar().http, 429);
  assert.equal(n, 6);
  const esperas = c.g.sleeps.filter((x) => x >= 1000);
  assert.equal(esperas.length, 5, "5 esperas entre 6 tentativas: " + esperas);
  assert.ok(esperas.every((x) => x >= 1000), "alguma espera menor que o Retry-After: " + esperas);
});
test("Retry-After inválido (data, 0, negativo) cai na espera crescente", () => {
  for (const v of ["Wed, 21 Oct 2026 07:28:00 GMT", "0", "-5", "abc"]) {
    let n = 0;
    const c = cenario({ cs: { falhar: (m) => (m === "PATCH" && ++n === 1 ? { status: 429, headers: { "RETRY-after": v }, json: {} } : null) } });
    assert.equal(c.enviar().ok, true, v);
    assert.equal(c.g.sleeps.filter((x) => x >= 1000)[0], 2000, v);
  }
});
test("relógio: cada fetch leva 40 s -> para antes de passar de 180 s no total", () => {
  const base = Date.now();
  let c, fetches = 0;
  class Rel extends Date { static now() { return base + (c ? c.g.sleeps.reduce((x, y) => x + y, 0) : 0) + fetches * 40000; } }
  c = cenario({ extras: { Date: Rel }, cs: { falhar: (m, cam) => (cam === "/envelopes" ? (fetches++, { status: 429, json: {} }) : null) } });
  const r = c.enviar();
  assert.equal(r.http, 429);
  const total = c.g.sleeps.reduce((x, y) => x + y, 0) + fetches * 40000;
  assert.ok(total <= 180000 + 40000, "gastou " + total);
  assert.ok(fetches < 6, "fetches " + fetches);
});

test("PATCH de ativar 4xx e a consulta diz draft: apaga o rascunho (1 DELETE) e devolve a falha comum", () => {
  const c = cenario({ cs: { falhar: (m) => (m === "PATCH" ? { status: 422, json: { errors: [{ title: "x" }] } } : null) } });
  const r = c.enviar();
  assert.deepEqual([r.ok, r.erro, r.passo, r.http, r.incerto, r.rascunhoApagado], [false, "CLICKSIGN_FALHOU", "ativar", 422, undefined, true], JSON.stringify(r));
  assert.deepEqual(csCalls(c).filter((x) => x.startsWith("DELETE")), ["DELETE /envelopes/env-1"]);
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
});

/* ---- Descartar rascunho (assinaturaCancelar com envelope draft) ---- */
const comRascunho = (extra = {}) => cenario(Object.assign({ venda: { "ASSINATURA - ENVELOPE ID": rt("env-1"), "ASSINATURA - SITUAÇÃO": rt("RASCUNHO") } }, extra));
test("descartar: envelope draft -> DELETE, limpa as colunas e devolve descartou:true", () => {
  const c = comRascunho();
  const r = c.acao("assinaturaCancelar");
  assert.deepEqual(r, { ok: true, descartou: true, situacao: "", envelope: false, signatarios: [] }, JSON.stringify(r));
  assert.deepEqual(csCalls(c), ["GET /envelopes/env-1", "DELETE /envelopes/env-1"]);
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "");
  assert.match(c.g.logs.join(String.fromCharCode(10)), /cancelar 01234567 por ana\.teste: ok/);
});
test("descartar: envelope running segue o caminho de cancelar de sempre (sem DELETE)", () => {
  const c = cenario();
  assert.equal(c.enviar().ok, true);
  const r = c.acao("assinaturaCancelar");
  assert.equal(r.cancelou, true);
  assert.ok(!csCalls(c).some((x) => x.startsWith("DELETE")));
});
test("descartar: Clicksign não acha o envelope (404) -> limpa as colunas, sem DELETE", () => {
  const c = comRascunho();
  c.c.estado.apagado = true;
  const r = c.acao("assinaturaCancelar");
  assert.deepEqual([r.ok, r.descartou, r.situacao, r.envelope], [true, true, "", false], JSON.stringify(r));
  assert.ok(!csCalls(c).some((x) => x.startsWith("DELETE")));
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "");
});
test("descartar: consulta sem resposta (rede ou 5xx) NÃO apaga nada e pede nova tentativa", () => {
  for (const falha of [{ lancar: "Timeout" }, { status: 500, texto: "" }]) {
    const c = comRascunho({ cs: { falhar: (m) => (m === "GET" ? falha : null) } });
    const r = c.acao("assinaturaCancelar");
    assert.equal(r.ok, false);
    assert.equal(r.erro, "CLICKSIGN_FALHOU", JSON.stringify(r));
    assert.ok(!csCalls(c).some((x) => x.startsWith("DELETE")), "apagou sem confirmar");
    assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
  }
});
test("descartar: DELETE que a Clicksign recusa não limpa as colunas", () => {
  const c = comRascunho({ cs: { falhar: (m) => (m === "DELETE" ? { status: 422, json: { errors: [{ title: "x" }] } } : null) } });
  const r = c.acao("assinaturaCancelar");
  assert.equal(r.ok, false);
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
});

/* ---- vigia de assinaturas (AssinaturaVigia.gs): horário, gatilho e só o GET quando nada mudou ---- */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const VIGIA_SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "AssinaturaVigia.gs"), "utf8");
function relogioSP(hora) {   /* hora de São Paulo (UTC-3) em 2026-11-02 */
  const FIX = Date.UTC(2026, 10, 2, hora + 3, 0, 0);
  return class Fixo extends Date { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } };
}
const TOK_LONGO = assinar({ u: "ana.teste", t: "GERAL", a: ["VENDAS"], exp: Date.now() + 30 * DIA });
function vigiaCenario(hora) {
  const c = cenario({ extras: { Date: relogioSP(hora) }, props: { DB_VENDAS_COND: "db-cond" } });
  vm.runInContext(VIGIA_SRC, c.g.ctx, { filename: "AssinaturaVigia.gs" });
  return c;
}
const abrir = (c, pg) => { c.g.ctx.__abertos = [pg]; vm.runInContext("vigiaAbertos_ = function () { __chamouAbertos = (typeof __chamouAbertos === 'number' ? __chamouAbertos : 0) + 1; return __abertos; };", c.g.ctx); };
test("vigia fora de 7h-21h (São Paulo): nenhuma chamada de rede, nem ao Notion", () => {
  for (const h of [22, 23, 0, 3, 6, 21]) {
    const c = vigiaCenario(h);
    abrir(c, { id: PAGE, properties: {} });
    c.g.chamadas.length = 0;
    c.g.ctx.vigiaAssinaturas();
    assert.equal(c.g.chamadas.length, 0, "hora " + h);
    assert.equal(c.g.ctx.__chamouAbertos, undefined, "hora " + h);
  }
});
test("vigia dentro do horário (7h, 12h, 20h) roda", () => {
  for (const h of [7, 12, 20]) {
    const c = vigiaCenario(h);
    abrir(c, { id: PAGE, properties: {} });
    c.g.ctx.vigiaAssinaturas();
    assert.equal(c.g.ctx.__chamouAbertos, 1, "hora " + h + " " + c.g.logs.join(" | ") + " H=" + c.g.ctx.Utilities.formatDate(new c.g.ctx.Date(), "America/Sao_Paulo", "H"));
  }
});
test("vigia: gatilho de 30 em 30 minutos", () => {
  const c = vigiaCenario(12);
  const regs = [];
  c.g.ctx.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {},
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => regs.push([fn, n]) }) }) }) };
  c.g.ctx.instalarVigiaAssinaturas();
  assert.deepEqual(regs, [["vigiaAssinaturas", 30]]);
});
test("vigia: envelope sem mudança = 1 chamada (só o GET); mudou = caminho completo; falha do GET = caminho completo", () => {
  const c = vigiaCenario(12);
  const e0 = c.enviar(TOK_LONGO);
  assert.equal(e0.ok, true, JSON.stringify(e0));
  const pg = () => c.g.ctx.ctrLerPaginaVenda_(PAGE);
  /* 1ª vez: sem status guardado, caminho completo */
  c.c.chamadas.length = 0;
  c.g.ctx.vigiaUma_(c.g.ctx.colunas_(), pg());
  assert.ok(csCalls(c).includes("GET /envelopes/env-1/documents"), csCalls(c).join(" | "));
  /* nada mudou: só o GET do envelope */
  c.c.chamadas.length = 0;
  assert.equal(c.g.ctx.vigiaUma_(c.g.ctx.colunas_(), pg()), false);
  assert.deepEqual(csCalls(c), ["GET /envelopes/env-1"]);
  /* mudou: caminho completo de hoje */
  c.c.estado.status = "canceled";
  c.c.chamadas.length = 0;
  c.g.ctx.vigiaUma_(c.g.ctx.colunas_(), pg());
  assert.ok(csCalls(c).includes("GET /envelopes/env-1/documents") && csCalls(c).includes("GET /envelopes/env-1/signers"), csCalls(c).join(" | "));
});
test("vigia: GET do envelope sem resposta não conta como 'sem mudança' (segue o caminho completo)", () => {
  let negar = false;
  const c = (() => { const x = cenario({ extras: { Date: relogioSP(12) }, props: { DB_VENDAS_COND: "db-cond" },
    cs: { falhar: (m, cam) => (negar && m === "GET" && cam === "/envelopes/env-1" ? { status: 500, texto: "" } : null) } });
    vm.runInContext(VIGIA_SRC, x.g.ctx, { filename: "AssinaturaVigia.gs" }); return x; })();
  assert.equal(c.enviar(TOK_LONGO).ok, true);
  const pg = () => c.g.ctx.ctrLerPaginaVenda_(PAGE);
  c.g.ctx.vigiaUma_(c.g.ctx.colunas_(), pg());
  negar = true;
  c.c.chamadas.length = 0;
  c.g.ctx.vigiaUma_(c.g.ctx.colunas_(), pg());
  assert.ok(csCalls(c).length > 1, csCalls(c).join(" | "));
});

/* ---- rodada de conserto 1: Descartar nunca cancela envelope já enviado; limpeza da chave da vigia ---- */
const AVISO_JA_ENVIADO = "O contrato já tinha sido enviado aos signatários. Nada foi descartado — a situação foi atualizada.";
test("descartar + envelope running (ativação incerta): nenhum PATCH/DELETE, situação vira ENVIADO e vem o aviso", () => {
  const c = comRascunho();
  c.c.estado.status = "running";
  const r = c.g.chamar({ action: "assinaturaCancelar", token: tokenDe(), pageId: PAGE, descartar: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.descartou, false);
  assert.equal(r.situacao, "ENVIADO");
  assert.equal(r.aviso, AVISO_JA_ENVIADO);
  assert.ok(!csCalls(c).some((x) => x.startsWith("PATCH") || x.startsWith("DELETE")), csCalls(c).join(" | "));
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
});
test("descartar + envelope closed: nenhum PATCH/DELETE, situação atualizada e aviso", () => {
  const c = comRascunho({ cs: { eventos: TODOS_ASSINARAM, arquivos: { signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  c.c.estado.status = "closed";
  const r = c.g.chamar({ action: "assinaturaCancelar", token: tokenDe(), pageId: PAGE, descartar: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.descartou, false);
  assert.equal(r.aviso, AVISO_JA_ENVIADO);
  assert.ok(!csCalls(c).some((x) => x.startsWith("PATCH") || x.startsWith("DELETE")), csCalls(c).join(" | "));
  assert.notEqual(c.txt("ASSINATURA - SITUAÇÃO"), "RASCUNHO");
});
test("descartar + draft apaga como antes; Cancelar comum (sem descartar) com running continua cancelando", () => {
  const c = comRascunho();
  const r = c.g.chamar({ action: "assinaturaCancelar", token: tokenDe(), pageId: PAGE, descartar: true });
  assert.equal(r.descartou, true);
  assert.deepEqual(csCalls(c).filter((x) => x.startsWith("DELETE")), ["DELETE /envelopes/env-1"]);
  const d = comRascunho();
  d.c.estado.status = "running";
  assert.equal(d.acao("assinaturaCancelar").cancelou, true);
});
test("chave da vigia: apagada ao descartar, ao ficar closed e ao cancelar pelo botão", () => {
  const CH = "VIGIA_STATUS_env-1";
  let c = comRascunho();
  c.p[CH] = "draft";
  c.g.chamar({ action: "assinaturaCancelar", token: tokenDe(), pageId: PAGE, descartar: true });
  assert.ok(!(CH in c.p), "descartar deixou a chave");
  c = cenario({ cs: { eventos: TODOS_ASSINARAM, arquivos: { signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.equal(c.enviar().ok, true);
  c.p[CH] = "running";
  c.c.estado.status = "closed";
  assert.equal(c.estado().situacao, "ASSINADO");
  assert.ok(!(CH in c.p), "closed deixou a chave");
  c = cenario();
  assert.equal(c.enviar().ok, true);
  c.p[CH] = "running";
  assert.equal(c.acao("assinaturaCancelar").cancelou, true);
  assert.ok(!(CH in c.p), "cancelar deixou a chave");
});
