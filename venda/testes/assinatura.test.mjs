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
    "OBRA-AUTO": "relation", CASA: "rich_text", "COMPRADOR 1 - E-MAIL": "email",
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
  "CLIENTES ": rt("Fulano de Teste"), "CPF ": rt("000.000.001-91"), "COMPRADOR 1 - E-MAIL": eml("fulano@teste.example"),
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
  "CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS": dat("2027-06-30"),
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

function cenario({ venda, vendedor, props, colunas, cs = {}, semProps = [] } = {}) {
  const bases = { "db-vend": [mescla(VENDEDOR, vendedor)], "db-lote": [LOTEAMENTO], "db-corr": [CORRETOR],
                  "db-doc": [Object.assign({ "ENDEREÇO": tit("RESIDENCIAL TESTE QD 07 LT 12") }, OBRA_PG)] };
  const cols = colunas || colunasVenda();
  const valores = Object.fromEntries(Object.entries(mescla(VENDA, venda)).filter(([k]) => k in cols));
  const n = notionFalso({ colunas: cols, valores, paginasExtras: { [OBRA]: OBRA_PG }, paginasDb: { [OBRA]: "db-doc" }, bases,
                          s3: { gerado: { buf: Buffer.from(PDF_GERADO, "utf8"), mime: "application/pdf" } } });
  const c = clicksignFalso(cs);
  const p = Object.assign({}, PROPS, props);
  for (const s of semProps) delete p[s];
  const g = criarGas({ props: p, rotas: (url, opt) => c.rota(url, opt) || n.rota(url, opt) });
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
  assert.deepEqual(r.signatarios, [
    { papel: "Comprador 1", assinou: false }, { papel: "Vendedor (representante)", assinou: false },
    { papel: "Testemunha 1", assinou: false }, { papel: "Testemunha 2", assinou: false }]);
  assert.ok(!JSON.stringify(r).includes("@"), "resposta com e-mail");
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
  assert.equal(env.data.attributes.name, "Contrato - RESIDENCIAL TESTE QD 07 LT 12");
  assert.equal(doc.data.attributes.filename, "CONTRATO - RESIDENCIAL TESTE QD 07 LT 12 - 01-10-2026.pdf");
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
  const c = cenario({ venda: { "COMPRADOR 1 - E-MAIL": eml(null) }, semProps: ["ASSINATURA_TESTEMUNHAS_SPE"] });
  const r = c.enviar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Testemunhas: Propriedade ASSINATURA_TESTEMUNHAS_SPE não configurada (precisa de 2)",
                              "Comprador 1: e-mail (coluna COMPRADOR 1 - E-MAIL)"]);
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
  for (const sit of ["ENVIADO", "ASSINADO", ""]) {
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

test("falha no meio (requisito recusado): não ativa, não grava, devolve o passo e o detalhe da Clicksign", () => {
  let n = 0;
  const c = cenario({ cs: { falhar: (m, cam) => (m === "POST" && cam.endsWith("/requirements") && ++n === 3
    ? { status: 422, json: { errors: [{ title: "Erro de validação", detail: "role inválido" }] } } : null) } });
  const r = c.enviar();
  assert.deepEqual(r, { ok: false, erro: "CLICKSIGN_FALHOU", passo: "requisitos", http: 422, detalhe: "Erro de validação: role inválido", envelopeId: "env-1" });
  assert.ok(!c.c.chamadas.some((x) => x.metodo === "PATCH"), "ativou o envelope depois do erro");
  assert.ok(!c.c.chamadas.some((x) => x.caminho.endsWith("/notifications")));
  assert.equal(c.c.estado.status, "draft");
  assert.equal(c.n.patches.length, 0);
  assert.ok(c.g.logs.some((l) => l.includes("falhou no passo requisitos http 422")), c.g.logs.join(" | "));
  assert.ok(!c.g.logs.join("\n").includes("role inválido"), "detalhe da Clicksign foi para o log");
});

test("falha no primeiro passo e exceção de rede também viram CLICKSIGN_FALHOU com o passo", () => {
  const a = cenario({ cs: { falhar: (m, cam) => (cam === "/envelopes" ? { status: 401, json: { errors: [{ title: "Não autorizado" }] } } : null) } });
  assert.deepEqual(a.enviar(), { ok: false, erro: "CLICKSIGN_FALHOU", passo: "envelope", http: 401, detalhe: "Não autorizado", envelopeId: "" });
  const b = cenario({ cs: { falhar: (m, cam) => (cam.endsWith("/documents") ? { lancar: "Timeout" } : null) } });
  const rb = b.enviar();
  assert.equal(rb.passo, "documento");
  assert.equal(rb.http, 0);
  assert.equal(b.n.patches.length, 0);
});

test("ativou mas o aviso falhou: grava ENVIADO e devolve ok com aviso", () => {
  const c = cenario({ cs: { falhar: (m, cam) => (cam.endsWith("/notifications") ? { status: 500, texto: "" } : null) } });
  const r = c.enviar();
  assert.equal(r.ok, true);
  assert.equal(r.aviso, "NOTIFICACAO_FALHOU");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
});

test("ativou mas o Notion não gravou: GRAVACAO_FALHOU com o id do envelope (para não mandar outro)", () => {
  const c = cenario();
  const rotaOriginal = c.g.ctx.UrlFetchApp.fetch;
  c.g.ctx.UrlFetchApp.fetch = (url, opt) => {
    if (url.startsWith("https://api.notion.com/v1/pages/") && String(opt.method).toUpperCase() === "PATCH") throw new Error("Notion fora");
    return rotaOriginal(url, opt);
  };
  const r = c.enviar();
  assert.deepEqual([r.ok, r.erro, r.envelopeId], [false, "GRAVACAO_FALHOU", "env-1"]);
  assert.ok(c.g.logs.some((l) => l.includes("env-1")));
});

test("colunas novas ausentes: COLUNA_FALTANDO com os nomes", () => {
  const c = cenario({ colunas: colunasVenda(["ASSINATURA - ENVELOPE ID", "CONTRATO ASSINADO"]) });
  const r = c.enviar();
  assert.match(r.erro, /^COLUNA_FALTANDO: /);
  assert.ok(r.erro.includes("ASSINATURA - ENVELOPE ID") && r.erro.includes("CONTRATO ASSINADO"), r.erro);
  assert.equal(c.c.chamadas.length, 0);
});

test("perfil TESTES não envia, mas consulta o estado", () => {
  const c = cenario();
  assert.equal(c.enviar(tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(c.c.chamadas.length, 0);
  assert.equal(c.estado(tokenDe("TESTES", [])).ok, true);
});

test("estado sem envelope: situação vazia e nenhuma chamada à Clicksign", () => {
  const c = cenario({ semProps: ["CLICKSIGN_TOKEN"] });
  assert.deepEqual(c.estado(), { ok: true, situacao: "", envelope: false, signatarios: [] });
  assert.equal(c.c.chamadas.length, 0);
});

test("estado em andamento: quem já assinou (evento sign), sem e-mail na resposta", () => {
  const c = cenario({ cs: { eventos: [{ type: "events", attributes: { name: "sign", data: { signer: { email: "FULANO@teste.example" } } } }] } });
  assert.equal(c.enviar().ok, true);
  const r = c.estado();
  assert.deepEqual(r, { ok: true, situacao: "ENVIADO", envelope: true, signatarios: [
    { papel: "Comprador 1", assinou: true }, { papel: "Vendedor (representante)", assinou: false },
    { papel: "Testemunha 1", assinou: false }, { papel: "Testemunha 2", assinou: false }] });
  assert.equal(c.c.estado.baixados, 0);
  assert.deepEqual(c.n.pagina.properties["CONTRATO ASSINADO"].files, []);
});

test("estado concluído: baixa o PDF assinado, anexa em CONTRATO ASSINADO (troca) e grava ASSINADO", () => {
  const c = cenario({ venda: { "CONTRATO ASSINADO": { files: [{ name: "antigo.pdf", type: "file", file: { url: "https://s3.falso/antigo" } }] } },
                      cs: { arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
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
  /* segunda consulta: já assinado e anexado — não baixa de novo */
  c.estado();
  assert.equal(c.c.estado.baixados, 1);
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
  }
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
