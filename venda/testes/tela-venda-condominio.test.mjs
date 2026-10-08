/* Tela de venda do condomínio (entrega 7): contrato, assinatura e Mais Controle direto na
 * linha da BANCO DE DADOS VENDAS CONDOMÍNIO (DB_VENDAS_COND), sem a casa na VENDAS.
 * Notion, Docs/Drive, Clicksign e GitHub falsos. Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, driveFalso, notionFalso, clicksignFalso, assinar, texto, COLUNAS_REAIS, DB_ID_PADRAO } from "./fakes.mjs";

const req = createRequire(import.meta.url);
const CV = req("../ContratoVenda.js");
const CondominioVenda = req("../CondominioVenda.js");

const DIA = 86400000;
const token = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + DIA });
const COND = "00112233445566778899aabbccddeeff", DB_COND = "db-cond";
const tit = (s) => ({ title: [{ type: "text", plain_text: s, text: { content: s } }] });
const sel = (s) => ({ select: s === null ? null : { name: s } });
const num = (n) => ({ number: n });
const dat = (s) => ({ date: s ? { start: s } : null });
const eml = (s) => ({ email: s });
const rt = texto;

/* linha do condomínio (nomes de coluna como na base, espaços sobrando inclusive) */
const LINHA = {
  UNIDADE: tit("13"), "CONDOMÍNIO": sel("RESERVA TESTE"),
  PROPONENTE: rt("Compradora de Teste"), "CPF PROPONENTE": rt("52998224725"), "RG PROPONENTE": rt("1234567 SSP/GO"),
  "PROFISSÃO PROPONENTE ": rt("analista"), "NACIONALIDADE PROPONENTE": rt("brasileira"), "ESTADO CIVIL": rt("solteira"),
  Email: eml("compradora@teste.example"), "Nº Whatsapp": { phone_number: "62 90000-0000" },
  "ENDEREÇO": rt("Rua das Palmeiras"), "NÚMERO": rt("10"), SETOR: rt("Setor do Cliente"), CIDADE: rt("Cidade Teste"), CEP: rt("74000-000"),
  "DATA DA VENDA": dat("2026-09-01"),
  "CONTRATO - ÁREA PRIVATIVA (M²)": num(70.5), "CONTRATO - FRAÇÃO IDEAL": rt("0,0125"),
  "CONTRATO - MATRÍCULA INDIVIDUAL": rt("M-13"), "CONTRATO - CRI DA MATRÍCULA": rt("1º CRI de Teste"),
  "CONTRATO - ALVARÁ Nº": rt("AL-1"), "CONTRATO - ALVARÁ DATA": dat("2026-01-10"), "CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS": dat("2028-12-01"),
  "DATA DE ASSINATURA DO CONTRATO": dat("2026-10-07"), "DIA PAGAMENTO PARCELAS": num(10), "DATA DA ENTREGA": dat("2028-12-01"),
  "VALOR DE VENDA": num(305000), "VALOR SINAL ATO": num(1000),
  "VALOR SINAL 30 DIAS": num(3000), "DATA SINAL 30 DIAS": dat("2026-11-07"),
  "VALOR SINAL 60 DIAS": num(3000), "DATA SINAL 60 DIAS ": dat("2026-12-07"),
  "VALOR SINAL 90 DIAS ": num(3000), "DATA SINAL 90 DIAS": dat("2027-01-07"),
  "Nº PARCELAS 1º PARTE PRÉ CHAVES": num(10), "VALOR 1º PARTE PRÉ CHAVES": num(924.07), "DATA 1º PARTE PRÉ CHAVES": dat("2026-11-10"),
  "Nº PARCELAS 2º PARTE PRÉ CHAVES": num(12), "VALOR 2º PARTE PRÉ CHAVES": num(295.49), "DATA 2º PARTE PRÉ CHAVES": dat("2027-09-10"),
  "VALOR 1º BALÃO": num(8954.18), "DATA 1º BALÃO (12/27)": dat("2027-12-10"),
  "VALOR BALÃO ENTREGA DE CHAVES": num(6267.88), "DATA 2º BALÃO (25º PARCELA)": dat("2028-11-10"),
  "Nº PARCELAS PÓS CHAVES": num(24), "VALOR PÓS CHAVES": num(705.89), "DATA  PÓS CHAVES ": dat("2029-01-10"),
  "VALOR DO CRÉDITO": num(244800), "VALOR DO FGTS": num(5250), "SUBISÍDIO": num(null),
  CORRETOR: rt("Corretor Teste"), CRECI: num(40167), "CPF CORRETOR": rt("246.813.579-28"), "EMAIL CORRETOR": eml("corretor@teste.example"),
  " COMISSÃO ": num(15250),
  /* colunas novas da entrega 7 (venda/COLUNAS-CONDOMINIO.md) */
  "CONTRATO GERADO": { files: [] }, "CONTRATO ASSINADO": { files: [] },
  "ASSINATURA - ENVELOPE ID": rt(""), "ASSINATURA - SITUAÇÃO": rt(""), "MC - SITUAÇÃO": rt(""), "MC - VENDA ID": rt(""),
};
const OBRA_PG = { "PROPRIETARIO DOCUMENTO": rt("Construtora Teste Ltda"), "CPF/CNPJ ": sel("00.000.000/0001-00"), "OBRA FINALIZADA?": sel("NÃO") };
const VENDEDOR = {
  NOME: tit("Construtora Teste Ltda"), TIPO: sel("PJ"), "CPF/CNPJ": rt("00.000.000/0001-00"), "ENDEREÇO / SEDE": rt("Av. Teste, 100"),
  "REPRESENTANTE NOME": rt("Beltrano Representante"), "REPRESENTANTE CPF": rt("111.444.777-35"), "REPRESENTANTE E-MAIL": rt("beltrano@teste.example"),
  "REPRESENTANTE RG": rt("RG 7654321 SSP/GO"), "REPRESENTANTE NACIONALIDADE": rt("brasileiro"), "REPRESENTANTE ESTADO CIVIL": rt("casado"),
  BANCO: rt("Banco Teste"), "AGÊNCIA": rt("0001"), CONTA: rt("12345-6"), PIX: rt("pix@teste.example"),
};
const EMPREENDIMENTO = { SETOR: tit("Condomínio Reserva Teste"), "DENOMINAÇÃO": rt("Condomínio Reserva Teste"), "MUNICÍPIO/UF": rt("Cidade Teste/GO"),
  "MATRÍCULA DO LOTEAMENTO": rt("M-500"), "CARTÓRIO": rt("Cartório Teste") };
const TEST_SPE = [{ nome: "Testemunha Um Spe", email: "t1.spe@teste.example", cpf: "000.000.005-15" },
                  { nome: "Testemunha Dois Spe", email: "t2.spe@teste.example", cpf: "000.000.006-04" }];
const TEST_PF = [{ nome: "Testemunha Um Pf", email: "t1.pf@teste.example", cpf: "000.000.007-87" },
                 { nome: "Testemunha Dois Pf", email: "t2.pf@teste.example", cpf: "000.000.008-68" }];

const MODELO_COND = [
  "CONTRATO — CONDOMÍNIO {{CONDOMINIO_NOME}} — UNIDADE {{UNIDADE}}",
  "COMPRADOR: {{COMPRADORES}}",
  "Valor: {{VALOR_TOTAL}}; intermediação {{VALOR_INTERMEDIACAO}}",
  "{{FORMA_PAGAMENTO_CONDOMINIO}}",
  "TESTEMUNHAS",
];

/* tipo de coluna a partir do valor cru ({title:…} → title) */
function colunasDe(valores) {
  const c = {};
  for (const [n, v] of Object.entries(valores)) {
    const tipo = Object.keys(v)[0];
    c[n] = tipo === "select" ? { tipo, opcoes: [] } : tipo;
  }
  return c;
}
/* schema da VENDAS (o PortalVenda resolve as colunas do dossiê nela em toda ação) */
const SCHEMA_VENDAS = { properties: Object.fromEntries(Object.entries(COLUNAS_REAIS).map(([n, t]) => {
  const tipo = typeof t === "string" ? t : t.tipo;
  return [n, { type: tipo, [tipo]: tipo === "select" ? { options: t.opcoes.map((o) => ({ name: o })) } : {} }];
})) };

function cenario({ linha = {}, sem = [], dbPagina = DB_COND, props = {}, gh = 204 } = {}) {
  const valores = Object.assign({}, LINHA, linha);
  for (const s of sem) delete valores[s];
  const n = notionFalso({ colunas: colunasDe(valores), valores, pageId: COND, dbId: dbPagina,
    bases: { "db-vend": [VENDEDOR], "db-lote": [EMPREENDIMENTO], "db-corr": [],
             "db-doc": [Object.assign({ "ENDEREÇO": tit("CONDOMÍNIO RESERVA TESTE") }, OBRA_PG)] } });
  const d = driveFalso({ modelos: { "modelo-cond": MODELO_COND, "modelo-obra": ["OBRA"], "modelo-pronto": ["PRONTO"] } });
  const c = clicksignFalso();
  const despachos = [];
  const p = Object.assign({
    NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO, DB_VENDAS_COND: DB_COND,
    DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr", DB_DOCUMENTOS: "db-doc",
    MODELO_PRONTO_ID: "modelo-pronto", MODELO_CONSTRUCAO_ID: "modelo-obra", MODELO_CONDOMINIO_ID: "modelo-cond", PASTA_PROVISORIA_ID: "pasta-prov",
    CLICKSIGN_TOKEN: "token-clicksign-de-teste",
    ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify(TEST_SPE), ASSINATURA_TESTEMUNHAS_PF: JSON.stringify(TEST_PF),
    GITHUB_TOKEN: "gh-teste", GH_REPO_MC: "Org-Teste/REPO-TESTE",
  }, props);
  const g = criarGas({ props: p, extras: d.extras, rotas: (url, opt) => {
    if (url.startsWith("https://api.github.com/")) { despachos.push(JSON.parse(opt.payload)); return { status: gh, texto: "" }; }
    if (url === "https://api.notion.com/v1/databases/" + DB_ID_PADRAO && String(opt.method || "get").toUpperCase() === "GET") return { json: SCHEMA_VENDAS };
    return c.rota(url, opt) || n.rota(url, opt);
  } });
  const acao = (action, extra = {}, tok = token()) => g.chamar(Object.assign({ action, token: tok, pageId: COND }, extra));
  const txt = (col) => (n.pagina.properties[col].rich_text || []).map((t) => t.plain_text).join("");
  /* entrega 9: contrato final = pré-contrato + "Conferi" (registros do Drive e chamadas zerados entre os dois) */
  const gerarFinal = () => {
    const pre = acao("gerarPreContrato");
    if (!pre.ok) return pre;
    d.zerar(); g.chamadas.length = 0;
    return acao("aprovarPreContrato");
  };
  return { g, n, d, c, despachos, acao, txt, gerarFinal };
}

test("paginaVirtual: título vira ENDEREÇO = CONDOMÍNIO …, UNIDADE vira texto, a linha aponta para ela mesma", () => {
  const pg = { id: COND, parent: { database_id: DB_COND }, properties: Object.fromEntries(Object.entries(LINHA).map(([k, v]) => [k, Object.assign({ type: Object.keys(v)[0] }, v)])) };
  const v = CondominioVenda.paginaVirtual(pg, COND, CV.TIPOS, [CV.COL.CONTRATO_GERADO], { "OBRA-AUTO": "relation", SETOR: "rich_text" });
  const titulos = Object.entries(v.properties).filter(([, p]) => p.type === "title");
  assert.deepEqual(titulos.map(([n, p]) => [n, p.title[0].plain_text]), [["ENDEREÇO", "CONDOMÍNIO RESERVA TESTE"]]);
  assert.equal(v.properties.UNIDADE.type, "rich_text");
  assert.equal(v.properties["CONDOMÍNIO - VENDA ID"].rich_text[0].plain_text, COND);
  assert.equal(v.properties.CASA.number, 13);
  assert.equal(v.properties["CONTRATO - COMISSÃO PAGA POR"].select.name, "VENDEDOR");
  assert.equal(v.properties["CLIENTES"].rich_text[0].plain_text, "Compradora de Teste");
  assert.equal(v.properties["CPF"].rich_text[0].plain_text, "529.982.247-25");
  assert.equal(v.properties["VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)"].number, 305000);
  assert.equal(v.properties["COMPRADOR 1 - ENDEREÇO"].rich_text[0].plain_text, "Rua das Palmeiras, 10 - Setor do Cliente - Cidade Teste - CEP 74000-000");
  assert.equal(v.properties["CONTRATO - SINAL VALOR"].type, "number", "coluna do contrato da casa de rua entra vazia no tipo certo");
  assert.equal(v.properties["OBRA-AUTO"].type, "relation");
  assert.equal(v.properties["SETOR"].rich_text[0].plain_text, "Setor do Cliente", "garantir não troca o que a linha já tem");
  assert.ok(!("CONTRATO GERADO" in v.properties) || v.properties["CONTRATO GERADO"] === pg.properties["CONTRATO GERADO"], "CONTRATO GERADO é a coluna real");
  assert.equal(v.propsCondominio, pg.properties);
});

test("gerarContrato na linha do condomínio: modelo do condomínio, PDF em CONTRATO GERADO da própria linha; contratoEstado vê", () => {
  const c = cenario();
  const est0 = c.acao("contratoEstado"); delete est0.testemunhas; delete est0.conta;   /* testemunhas e conta de recebimento têm testes próprios */
  assert.deepEqual(est0, { ok: true, gerado: false, etapa: "NENHUM", pre: null });
  const r = c.gerarFinal();
  assert.equal(r.ok, true, JSON.stringify(r));
  /* a linha é lida uma vez para montar o contrato e outra para o link do PDF — sem o GET extra
     que a casa da VENDAS faz para chegar à linha do condomínio */
  const gets = c.g.chamadas.filter((x) => x.url === "https://api.notion.com/v1/pages/" + COND && x.opt.method === "GET");
  assert.equal(gets.length, 2);
  assert.match(r.nome, /^CONTRATO - CONDOMÍNIO RESERVA TESTE - CASA 13 - .* \[#[0-9a-f]{8}\]\.pdf$/);
  const pars = c.d.estado.salvos[c.d.estado.copias[0].id].pars;
  assert.equal(pars[0], "CONTRATO — CONDOMÍNIO RESERVA TESTE — UNIDADE 13");
  assert.ok(pars[1].includes("Compradora de Teste") && pars[1].includes("529.982.247-25"), pars[1]);
  assert.equal(pars[2], "Valor: R$ 305.000,00; intermediação paga pelo VENDEDOR");
  assert.ok(pars.some((l) => l.startsWith("6.1. Preço total: R$ 305.000,00")));
  assert.equal(c.n.pagina.properties["CONTRATO GERADO"].files.length, 1);
  assert.equal(c.n.pagina.properties["CONTRATO GERADO"].files[0].name, r.nome);
  const e = c.acao("contratoEstado");
  assert.equal(e.gerado, true);
  assert.equal(e.nome, r.nome);
});

test("gerarContrato do condomínio: fluxo que não fecha trava com a falta (nada no Drive)", () => {
  const c = cenario({ linha: { "VALOR DE VENDA": num(310000) } });
  const r = c.acao("gerarContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Fluxo de pagamento: soma R$ 305.000,00 e não fecha com o valor de venda R$ 310.000,00"]);
  assert.equal(c.d.estado.copias.length, 0);
});

test("coluna nova faltando na linha do condomínio: COLUNA_FALTANDO com o nome", () => {
  assert.deepEqual(cenario({ sem: ["CONTRATO GERADO"] }).acao("gerarContrato"), { ok: false, erro: "COLUNA_FALTANDO: CONTRATO GERADO" });
  assert.deepEqual(cenario({ sem: ["CONTRATO GERADO"] }).acao("contratoEstado"), { ok: false, erro: "COLUNA_FALTANDO: CONTRATO GERADO" });
  assert.deepEqual(cenario({ sem: ["ASSINATURA - ENVELOPE ID", "CONTRATO ASSINADO"] }).acao("assinaturaEstado"),
    { ok: false, erro: "COLUNA_FALTANDO: ASSINATURA - ENVELOPE ID, CONTRATO ASSINADO" });
  assert.deepEqual(cenario({ sem: ["ASSINATURA - SITUAÇÃO"] }).acao("assinaturaEnviar"), { ok: false, erro: "COLUNA_FALTANDO: ASSINATURA - SITUAÇÃO" });
  assert.match(cenario({ sem: ["MC - VENDA ID"] }).acao("mcEstado").erro, /^COLUNA_FALTANDO: MC - SITUAÇÃO, MC - VENDA ID/);
  const m = cenario({ sem: ["MC - SITUAÇÃO"] });
  assert.match(m.acao("mcLancar").erro, /^COLUNA_FALTANDO: /);
  assert.equal(m.despachos.length, 0);
});

test("página de outra base (nem VENDAS nem DB_VENDAS_COND) é recusada em todas as ações da tela de venda", () => {
  for (const action of ["contratoEstado", "gerarContrato", "gerarPreContrato", "aprovarPreContrato", "mcEstado", "mcLancar", "assinaturaEstado", "assinaturaEnviar"]) {
    const c = cenario({ dbPagina: "db-outra" });
    assert.deepEqual(c.acao(action), { ok: false, erro: "PAGINA_DE_OUTRA_BASE" }, action);
    assert.equal(c.despachos.length, 0);
    assert.equal(c.c.chamadas.length, 0);
  }
  /* sem DB_VENDAS_COND configurada a linha do condomínio também não passa */
  assert.deepEqual(cenario({ props: { DB_VENDAS_COND: "" } }).acao("gerarContrato"), { ok: false, erro: "PAGINA_DE_OUTRA_BASE" });
});

test("Mais Controle na linha do condomínio: estado, prévia (dispara com o id da linha) e situação gravada nela", () => {
  const c = cenario({ linha: { "MC - SITUAÇÃO": rt("PRÉVIA OK [#0a1b2c3d] — cliente novo") } });
  assert.deepEqual(c.acao("mcEstado"), { ok: true, situacao: "PRÉVIA OK [#0a1b2c3d] — cliente novo", vendaId: "" });
  assert.equal(c.acao("mcLancar", { aplicar: true }).ok, true);
  assert.deepEqual(c.despachos, [{ event_type: "mc-venda", client_payload: { pageId: COND, aplicar: true } }]);
  assert.match(c.txt("MC - SITUAÇÃO"), /^PROCESSANDO \(lançamento\) — .* \[#0a1b2c3d\]$/);
  const j = cenario({ linha: { "MC - VENDA ID": rt("venda-7") } });
  assert.equal(j.acao("mcLancar").erro, "MC_JA_LANCADA");
});

test("assinatura na linha do condomínio: sem envelope; depois de gerar, envia e grava envelope e ENVIADO na linha", () => {
  const c = cenario();
  assert.deepEqual(c.acao("assinaturaEstado"), { ok: true, situacao: "", envelope: false, signatarios: [] });
  assert.equal(c.acao("assinaturaEnviar").erro, "SEM_CONTRATO_GERADO");
  assert.equal(c.gerarFinal().ok, true);
  const r = c.acao("assinaturaEnviar");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ENVIADO");
  assert.ok(r.signatarios.some((s) => s.papel === "Comprador 1"));
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.ok(!JSON.stringify(r).includes("@"), "resposta com e-mail");
});

test("assinatura do condomínio: dado mudado depois de gerar = CONTRATO_DESATUALIZADO", () => {
  const c = cenario();
  assert.equal(c.gerarFinal().ok, true);
  c.n.pagina.properties["DIA PAGAMENTO PARCELAS"] = { type: "number", number: 15 };
  const r = c.acao("assinaturaEnviar");
  assert.equal(r.erro, "CONTRATO_DESATUALIZADO", JSON.stringify(r));
});

test("perfil TESTES não grava na linha do condomínio", () => {
  const c = cenario();
  for (const action of ["gerarContrato", "gerarPreContrato", "aprovarPreContrato", "mcLancar", "assinaturaEnviar", "assinaturaEstado"])
    assert.equal(c.acao(action, {}, token("TESTES")).erro, "SEM_PERMISSAO_TESTES", action);
  assert.equal(c.acao("contratoEstado", {}, token("TESTES")).ok, true);
});

test("tela de venda do condomínio: nenhum log com nome, CPF ou valor", () => {
  const c = cenario();
  c.gerarFinal(); c.acao("assinaturaEnviar"); c.acao("mcLancar");
  const todos = c.g.logs.join("\n");
  for (const s of ["Compradora", "Beltrano", "529.982", "52998224725", "305", "RESERVA", "Reserva"]) assert.ok(!todos.includes(s), "log vazou: " + s);
});
