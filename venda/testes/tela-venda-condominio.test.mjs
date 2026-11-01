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
const CS = req("../ClicksignVenda.js");

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
  "CELULAR CORRETOR": { phone_number: "62 91111-1111" },
  " COMISSÃO ": num(13725),   // 4,5% de 305.000 (24 pós-chaves), a regra do contrato de 21/10
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

/* termo de pré-reserva (27/10/2026): modelo de teste com todos os marcadores do termo */
const MODELO_PR = [
  "TERMO — PRÉ-RESERVANTE: {{PRE_RESERVANTE_QUADRO}}",
  "Casa {{CASA_NUMERO}} Tipo {{CASA_TIPO}} até {{PRE_RESERVA_DATA_LIMITE}} por {{PRE_RESERVA_VALOR_EXTENSO}} ({{PRE_RESERVA_VALOR}})",
  "Devolução: {{PRE_RESERVANTE_CONTA}}",
  "{{CIDADE_DATA}}",
  "{{PRE_RESERVANTE_NOME}} — CPF {{PRE_RESERVANTE_CPF}}",
];
const COLS_PR = { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto(""), "PRÉ-RESERVA - TERMO GERADO": { files: [] }, "PRÉ-RESERVA - TERMO ASSINADO": { files: [] },
  "PRÉ-RESERVA - ENVELOPE ID": texto(""), "PRÉ-RESERVA - SITUAÇÃO": texto(""), "CONDOMÍNIO": sel("RESERVA DOS IPÊS"),
  /* 31/10: valor e data do pagamento são da venda; prazo = pagamento + 7 dias (24/10 -> 31/10) */
  "PRÉ-RESERVA - VALOR": num(3000), "PRÉ-RESERVA - DATA PAGAMENTO": { date: { start: "2026-10-24" } }, "PRÉ-RESERVA - HISTÓRICO": texto("") };

const MODELO_COND = [
  "CONTRATO — CONDOMÍNIO {{CONDOMINIO_NOME}} — UNIDADE {{UNIDADE}}",
  "COMPRADOR: {{COMPRADORES}}",
  "Valor: {{VALOR_TOTAL}}; intermediação {{VALOR_INTERMEDIACAO}}",
  "{{FORMA_PAGAMENTO_CONDOMINIO}}",
  "QUADRO: {{COMPRADORES_QUADRO}} | {{CORRETOR_QUADRO}} | {{COMISSAO_PCT}}% | {{MEIO_PAGAMENTO}} | casa {{CASA_NUMERO}}",
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

function cenario({ linha = {}, sem = [], dbPagina = DB_COND, props = {}, gh = 204, docEnd = "CONDOMÍNIO RESERVA TESTE", modeloCond = MODELO_COND, modelosExtra = {}, cs = {}, s3 = {}, ia = null } = {}) {
  const valores = Object.assign({}, LINHA, linha);
  for (const s of sem) delete valores[s];
  const n = notionFalso({ colunas: colunasDe(valores), valores, pageId: COND, dbId: dbPagina, s3,
    bases: { "db-vend": [VENDEDOR], "db-lote": [EMPREENDIMENTO], "db-corr": [],
             "db-doc": [Object.assign({ "ENDEREÇO": tit(docEnd) }, OBRA_PG)] } });
  const d = driveFalso({ modelos: Object.assign({ "modelo-cond": modeloCond, "modelo-obra": ["OBRA"], "modelo-pronto": ["PRONTO"], "modelo-pr": MODELO_PR }, modelosExtra) });
  const c = clicksignFalso(cs);
  const despachos = [], falha = { fn: null };
  const p = Object.assign({
    NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO, DB_VENDAS_COND: DB_COND,
    DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr", DB_DOCUMENTOS: "db-doc",
    MODELO_PRONTO_ID: "modelo-pronto", MODELO_CONSTRUCAO_ID: "modelo-obra", MODELO_CONDOMINIO_ID: "modelo-cond", PASTA_PROVISORIA_ID: "pasta-prov",
    MODELO_PRE_RESERVA_ID: "modelo-pr",
    CLICKSIGN_TOKEN: "token-clicksign-de-teste",
    ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify(TEST_SPE), ASSINATURA_TESTEMUNHAS_PF: JSON.stringify(TEST_PF),
    GITHUB_TOKEN: "gh-teste", GH_REPO_MC: "Org-Teste/REPO-TESTE",
  }, props);
  const g = criarGas({ props: p, extras: d.extras, rotas: (url, opt) => {
    if (falha.fn) { const f = falha.fn(url, opt); if (f) return f; }   /* 01/11: simula Notion 429 etc. */
    if (url.startsWith("https://api.github.com/")) { despachos.push(JSON.parse(opt.payload)); return { status: gh, texto: "" }; }
    if (ia && url.startsWith("https://api.openai.com/")) return ia(url, opt);
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
  return { g, n, d, c, despachos, acao, txt, gerarFinal, falha };
}

/* 30/10: o que a tela manda junto com "Enviar" no contrato do condomínio (posições lidas no PDF pela RubricasVenda) */
const RUB_CAMPOS = [{ page: "3", position: [0.4234, 0.4833] }, { page: "4", position: [0.4234, 0.8534] }];
const RUB_VALORES = { page: "3", position: [0.1019, 0.1545] };
function rub(c, mud = {}) {
  const arqs = c.n.pagina.properties["CONTRATO GERADO"].files;
  return { rubricas: Object.assign({ nome: arqs[arqs.length - 1].name, campos: RUB_CAMPOS, valores: RUB_VALORES }, mud) };
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
  const est0 = c.acao("contratoEstado"); delete est0.testemunhas; delete est0.conta; delete est0.condicoes; delete est0.fluxo;   /* testemunhas, conta de recebimento e condições especiais têm testes próprios */
  /* 31/10/2026: faltas do cliente (só compradores/cônjuges/fiadores) — a linha de teste está completa */
  assert.ok(Array.isArray(est0.faltasCliente) && est0.faltasCliente.every((t) => /^(Comprador|Fiador|C[ôo]njuge)/i.test(t)), JSON.stringify(est0.faltasCliente));
  delete est0.faltasCliente;
  assert.deepEqual(est0, { ok: true, gerado: false, etapa: "NENHUM", pre: null });
  const r = c.gerarFinal();
  assert.equal(r.ok, true, JSON.stringify(r));
  /* a linha é lida uma vez para montar o contrato e outra para o link do PDF — sem o GET extra
     que a casa da VENDAS faz para chegar à linha do condomínio; 30/10: + 1 do histórico do contrato */
  const gets = c.g.chamadas.filter((x) => x.url === "https://api.notion.com/v1/pages/" + COND && x.opt.method === "GET");
  assert.equal(gets.length, 3);
  assert.match(r.nome, /^CONTRATO - CONDOMÍNIO RESERVA TESTE - CASA 13 - .* \[#[0-9a-f]{8}\]\.pdf$/);
  const pars = c.d.estado.salvos[c.d.estado.copias[0].id].pars;
  assert.equal(pars[0], "CONTRATO — CONDOMÍNIO RESERVA TESTE — UNIDADE 13");
  assert.ok(pars[1].includes("Compradora de Teste") && pars[1].includes("529.982.247-25"), pars[1]);
  assert.equal(pars[2], "Valor: R$ 305.000,00; intermediação R$ 13.725,00");   // 21/10: comprador paga, 4,5% (24 pós-chaves)
  assert.ok(pars.some((l) => l.startsWith("6.1. Preço total: R$ 305.000,00")));
  /* quadro-resumo (21/10): e-mail e telefone do comprador e do corretor, % da comissão pela regra, meio de pagamento padrão */
  const q = pars.find((l) => l.startsWith("QUADRO: "));
  assert.ok(q.includes("CPF nº 529.982.247-25, residente e domiciliado(a) à ") && q.includes(", e-mail compradora@teste.example, telefone 62 90000-0000 | "), q);
  assert.ok(q.includes("| Corretor Teste, CRECI nº 40167, CPF nº 246.813.579-28, e-mail corretor@teste.example, telefone 62 91111-1111 | 4,5% | sinal (item 4.1.3) por PIX; parcelas da entrada por boleto bancário | casa 13"), q);
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
  /* 31/10: a comissão sai do fluxo sozinha — só a soma acusa */
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
  const r = c.acao("assinaturaEnviar", rub(c));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ENVIADO");
  assert.ok(r.signatarios.some((s) => s.papel === "Comprador 1"));
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "env-1");
  assert.equal(c.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.ok(!JSON.stringify({ ...r, signatarios: r.signatarios.map(({ email, ...s }) => s) }).includes("@"), "e-mail fora do campo email");
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

/* ---------------- 27/10/2026: Termo de Pré-Reserva ---------------- */
const cenarioPR = (o = {}) => cenario({ docEnd: "CONDOMÍNIO RESERVA DOS IPÊS", ...o, linha: { ...COLS_PR, ...(o.linha || {}) } });

test("termo: estado, falta a conta, salva a conta, gera o PDF com o carimbo na coluna própria", () => {
  const c = cenarioPR();
  assert.deepEqual(c.acao("preReservaEstado"), { ok: true, conta: "", contaCampos: { forma: "", livre: "" }, gerado: false, nome: "", valor: 3000, dataPagamento: "2026-10-24", dataLimite: "2026-10-31", historico: "" });
  /* 01/11 (dono): a conta é opcional — o termo sai com ela em branco */
  const sem = c.acao("gerarTermoPreReserva");
  assert.equal(sem.ok, true, JSON.stringify(sem));
  assert.equal(c.d.estado.salvos[c.d.estado.copias[0].id].pars[2], "Devolução: ", "marcador vazio, sem undefined");
  assert.equal(c.acao("salvarContaPreReserva", { conta: "abc" }).erro, "FORMA_CONTA");
  assert.deepEqual(c.acao("salvarContaPreReserva", { conta: { forma: "PIX", chave: "529.982.247-25", banco: "756 - SICOOB" } }),
    { ok: true, conta: "PIX, chave 529.982.247-25, no banco 756 - SICOOB", contaCampos: { forma: "PIX", chave: "529.982.247-25", banco: "756 - SICOOB" } });
  assert.equal(c.txt("PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO"), "PIX, chave 529.982.247-25, no banco 756 - SICOOB");
  const r = c.acao("gerarTermoPreReserva");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.nome, /^TERMO DE PRÉ-RESERVA - CONDOMÍNIO RESERVA DOS IPÊS - CASA 13 - .* \[#[0-9a-f]{8}\]\.pdf$/);
  const pars = c.d.estado.salvos[c.d.estado.copias[c.d.estado.copias.length - 1].id].pars;
  assert.ok(pars[0].includes("Compradora de Teste") && pars[0].includes("CPF nº 529.982.247-25") && pars[0].includes("telefone 62 90000-0000"), pars[0]);
  assert.equal(pars[1], "Casa 13 Tipo 02 até 31/10/2026 por R$ 3.000,00 (três mil reais) (3.000,00)");
  assert.equal(pars[2], "Devolução: PIX, chave 529.982.247-25, no banco 756 - SICOOB");
  assert.equal(c.n.pagina.properties["PRÉ-RESERVA - TERMO GERADO"].files[0].name, r.nome);
  assert.equal(c.n.pagina.properties["CONTRATO GERADO"].files.length, 0, "o termo não mexe no contrato");
  const e = c.acao("preReservaEstado");
  assert.equal(e.gerado, true);
  assert.equal(e.nome, r.nome);
  const v = c.acao("verTermoPreReserva");
  assert.equal(v.ok, true);
});

test("termo na Clicksign: envia com doc PRE_RESERVA (pré-reservante, vendedora, testemunhas), colunas do termo; contrato intocado", () => {
  const c = cenarioPR({ linha: { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto("PIX, chave 529.982.247-25, no banco 756 - SICOOB") } });
  assert.equal(c.acao("assinaturaEnviar", { doc: "PRE_RESERVA" }).erro, "SEM_TERMO_GERADO");
  assert.equal(c.acao("gerarTermoPreReserva").ok, true);
  const r = c.acao("assinaturaEnviar", { doc: "PRE_RESERVA" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.signatarios.map((s) => s.papel), ["Comprador 1", "Vendedor (representante)", "Testemunha 1", "Testemunha 2"]);
  assert.equal(c.txt("PRÉ-RESERVA - ENVELOPE ID"), "env-1");
  assert.equal(c.txt("PRÉ-RESERVA - SITUAÇÃO"), "ENVIADO");
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "", "o envelope do contrato não muda");
  const est = c.acao("assinaturaEstado", { doc: "PRE_RESERVA" });
  assert.equal(est.ok, true);
  assert.equal(est.envelope, true);
  assert.deepEqual(c.acao("assinaturaEstado"), { ok: true, situacao: "", envelope: false, signatarios: [] });
});

/* 01/11/2026 (revisão final, I2): o termo de pré-reserva só imprime o pré-reservante — assinam ele, a vendedora e as 2
   testemunhas. O cônjuge do comprador casado assina o CONTRATO (Tarefa 3), não o termo: fora do envelope do termo e sem
   falta de e-mail dele no envio do termo. */
const CASADO_PR = { "ESTADO CIVIL": rt("CASADO"), CONJUGE: rt("Conjuge Teste da Silva"), "CPF CONJUGE": rt("935.411.347-80"),
  "EMAIL CONJUGE": eml("conjuge@teste.example"), REGIME: rt("COMUNHÃO PARCIAL DE BENS") };
test("I2: pré-reservante casado — o cônjuge não entra no envelope do termo (nem a falta do e-mail dele); no contrato entra", () => {
  const conta = { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto("PIX, chave 529.982.247-25, no banco 756 - SICOOB") };
  const c = cenarioPR({ linha: { ...conta, ...CASADO_PR } });
  assert.equal(c.acao("gerarTermoPreReserva").ok, true);
  const r = c.acao("assinaturaEnviar", { doc: "PRE_RESERVA" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.signatarios.map((s) => s.papel), ["Comprador 1", "Vendedor (representante)", "Testemunha 1", "Testemunha 2"]);
  assert.ok(!c.c.estado.signers.some((s) => s.attributes.email === "conjuge@teste.example"), "o cônjuge não recebe o termo");
  /* sem o e-mail do cônjuge o termo sai do mesmo jeito */
  const sem = cenarioPR({ linha: { ...conta, ...CASADO_PR, "EMAIL CONJUGE": eml(null) } });
  assert.equal(sem.acao("gerarTermoPreReserva").ok, true);
  const r2 = sem.acao("assinaturaEnviar", { doc: "PRE_RESERVA" });
  assert.equal(r2.ok, true, JSON.stringify(r2.faltas || r2));
  /* o contrato da mesma venda continua com o cônjuge logo depois do comprador */
  const k = cenario({ linha: CASADO_PR });
  const g = k.gerarFinal();
  assert.equal(g.ok, true, JSON.stringify(g.faltas || g));
  const e = k.acao("assinaturaEnviar", rub(k));
  assert.equal(e.ok, true, JSON.stringify(e.faltas || e));
  const papeis = e.signatarios.map((s) => s.papel);
  assert.equal(papeis.indexOf("Cônjuge do comprador 1"), papeis.indexOf("Comprador 1") + 1, papeis.join(", "));
});

test("termo: conta mudada depois de gerar = TERMO_DESATUALIZADO; perfil TESTES não grava", () => {
  const c = cenarioPR({ linha: { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto("PIX, chave 529.982.247-25, no banco 756 - SICOOB") } });
  assert.equal(c.acao("gerarTermoPreReserva").ok, true);
  c.n.pagina.properties["PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO"] = { type: "rich_text", rich_text: [{ plain_text: "PIX, chave outra-chave, no banco 001 - BB" }] };
  assert.equal(c.acao("assinaturaEnviar", { doc: "PRE_RESERVA" }).erro, "TERMO_DESATUALIZADO");
  for (const action of ["gerarTermoPreReserva", "salvarContaPreReserva", "salvarPagamentoPreReserva"])
    assert.equal(c.acao(action, { conta: "conta de teste" }, token("TESTES")).erro, "SEM_PERMISSAO_TESTES", action);
  assert.equal(c.acao("preReservaEstado", {}, token("TESTES")).ok, true);
});

test("31/10: valor e data por venda — salvar grava o histórico com o usuário; o termo usa o prazo de 7 dias", () => {
  const c = cenarioPR({ linha: { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto("PIX, chave 529.982.247-25, no banco 756 - SICOOB"),
                                 "PRÉ-RESERVA - VALOR": num(null), "PRÉ-RESERVA - DATA PAGAMENTO": { date: null } } });
  const e0 = c.acao("preReservaEstado");
  assert.equal(e0.valor, null);
  assert.equal(e0.dataLimite, "");
  assert.deepEqual(c.acao("gerarTermoPreReserva").faltas,
    ["Valor da pré-reserva (preencha no cartão)", "Data do pagamento da pré-reserva (preencha no cartão)"]);
  assert.equal(c.acao("salvarPagamentoPreReserva", { valor: 0, data: "2026-10-26" }).erro, "PR_VALOR_INVALIDO");
  assert.equal(c.acao("salvarPagamentoPreReserva", { valor: 2500, data: "" }).erro, "PR_DATA_INVALIDA");
  /* 01/11: hoje vem do servidor (São Paulo); sinal da linha = ato + 30 + 60 + 90 */
  assert.equal(c.acao("salvarPagamentoPreReserva", { valor: 2500, data: "2099-01-10" }).erro, "PR_DATA_FUTURA");
  assert.equal(c.acao("salvarPagamentoPreReserva", { valor: 50000, data: "2026-10-26" }).erro, "PR_VALOR_MAIOR_QUE_SINAL");
  const r = c.acao("salvarPagamentoPreReserva", { valor: 2500, data: "2026-10-26" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.dataLimite, "2026-11-02");
  assert.equal(c.n.pagina.properties["PRÉ-RESERVA - VALOR"].number, 2500);
  assert.equal(c.n.pagina.properties["PRÉ-RESERVA - DATA PAGAMENTO"].date.start, "2026-10-26");
  assert.match(c.txt("PRÉ-RESERVA - HISTÓRICO"), /^\d{2}\/\d{2}\/\d{4} \S+ ana\.teste: valor — → R\$ 2\.500,00; pagamento — → 26\/10\/2026$/);
  const r2 = c.acao("salvarPagamentoPreReserva", { valor: 2500, data: "2026-10-27" });
  assert.equal(r2.mudou, true);
  const linhas = c.txt("PRÉ-RESERVA - HISTÓRICO").split("\n");
  assert.equal(linhas.length, 2);
  assert.match(linhas[1], /ana\.teste: pagamento 26\/10\/2026 → 27\/10\/2026$/);
  assert.equal(c.acao("salvarPagamentoPreReserva", { valor: "2.500,00", data: "27/10/2026" }).mudou, false, "igual não grava histórico");
  assert.equal(c.txt("PRÉ-RESERVA - HISTÓRICO").split("\n").length, 2);
  assert.equal(c.acao("gerarTermoPreReserva").ok, true);
  const pars = c.d.estado.salvos[c.d.estado.copias[0].id].pars;
  assert.equal(pars[1], "Casa 13 Tipo 02 até 03/11/2026 por R$ 2.500,00 (dois mil e quinhentos reais) (2.500,00)");
  assert.ok(c.g.logs.some((l) => l.includes("salvarPagamentoPreReserva") && l.includes("ana.teste")));
});

test("termo: coluna faltando e logs sem dado pessoal", () => {
  const c = cenarioPR({ sem: ["PRÉ-RESERVA - TERMO GERADO"] });
  assert.equal(c.acao("preReservaEstado").erro, "COLUNA_FALTANDO: PRÉ-RESERVA - TERMO GERADO");
  const d = cenarioPR({ linha: { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto("PIX, chave 529.982.247-25, no banco 756 - SICOOB") } });
  d.acao("gerarTermoPreReserva"); d.acao("assinaturaEnviar", { doc: "PRE_RESERVA" });
  const todos = d.g.logs.join(" | ");
  for (const s of ["Compradora", "529.982", "PIX CPF", "3.000"]) assert.ok(!todos.includes(s), "log vazou: " + s);
});

test("27/10: condomínio tem conta fixa (texto do item 4.5 do modelo); escolher conta é recusado", () => {
  const c = cenario({ modeloCond: MODELO_COND.concat(["4.5. Dados bancários da VENDEDORA para pagamento das parcelas da ENTRADA: Banco Teste, conta 1-1."]) });
  const e = c.acao("contratoEstado");
  assert.equal(e.ok, true);
  assert.deepEqual(e.conta, { fixa: "Dados bancários da VENDEDORA para pagamento das parcelas da ENTRADA: Banco Teste, conta 1-1." });
  assert.equal(c.acao("escolherContaRecebimento", { conta: { contaId: "x" } }).erro, "CONTA_FIXA_CONDOMINIO");
});

test("28/10: condomínio sem linha na DOCUMENTOS usa a vendedora da Propriedade CONDOMINIO_VENDEDOR; sem ela, falta legível", () => {
  const sem = cenario({ docEnd: "OUTRA OBRA QUALQUER" });
  const r0 = sem.gerarFinal();
  assert.equal(r0.ok, false);
  assert.ok(JSON.stringify(r0).includes("obra da casa não encontrada"), JSON.stringify(r0));
  const c = cenario({ docEnd: "OUTRA OBRA QUALQUER", props: { CONDOMINIO_VENDEDOR: "Construtora Teste Ltda" } });
  const r = c.gerarFinal();
  assert.equal(r.ok, true, JSON.stringify(r));
});

/* ---- 28/10/2026: termos de confissão de dívida (Confissao.gs) ---- */
const COLS_CFD = {
  "FIADOR 1": rt("Fiador Um Teste"), "CPF FIADOR 1": rt("111.444.777-35"), "EMAIL FIADOR 1": eml("f1@teste.example"),
  "FIADOR 2": rt("Fiador Dois Teste"), "CPF FIADOR 2": rt("246.813.579-28"), "EMAIL FIADOR 2": eml("f2@teste.example"),
  "ESTADO CIVIL FIADOR 1": rt("SOLTEIRO"), "ESTADO CIVIL FIADOR 2": rt("VIUVO"),   /* 30/10: exigido com pós-chaves */
  "CONFISSÃO PRÉ-CHAVES - GERADA": { files: [] }, "CONFISSÃO PRÉ-CHAVES - ASSINADA": { files: [] },
  "CONFISSÃO PÓS-CHAVES - GERADA": { files: [] }, "CONFISSÃO PÓS-CHAVES - ASSINADA": { files: [] },
};
const MODELOS_CFD = {
  "modelo-cfd-pre": ["TERMO PRÉ casa {{CASA_NUMERO}} de {{DATA_CONTRATO}}: {{TCD_TOTAL_EXTENSO}} — {{TCD_PARCELAS}}", "{{FIADOR1_QUADRO}} | {{FIADOR2_QUADRO}}"],
  "modelo-cfd-pos": ["TERMO PÓS {{TCD_TOTAL_EXTENSO}} — {{TCD_PARCELAS}}", "{{FIADOR1_NOME}} {{FIADOR2_CPF}}"],
};
const cenarioCfd = (o = {}) => cenario({ ...o, linha: { ...COLS_CFD, ...(o.linha || {}) }, modelosExtra: MODELOS_CFD,
  props: { MODELO_CONFISSAO_PRE_ID: "modelo-cfd-pre", MODELO_CONFISSAO_POS_ID: "modelo-cfd-pos", ...(o.props || {}) } });

test("28/10: contrato final gera os dois termos com o mesmo carimbo, nas colunas próprias", () => {
  const c = cenarioCfd();
  const r = c.gerarFinal();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.termos.length, 2);
  const pre = c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files, pos = c.n.pagina.properties["CONFISSÃO PÓS-CHAVES - GERADA"].files;
  assert.equal(pre.length, 1); assert.equal(pos.length, 1);
  const hash = /\[#([0-9a-f]{8})\]\.pdf$/.exec(r.nome)[1];
  assert.ok(pre[0].name.startsWith("CONFISSÃO PRÉ-CHAVES - ") && pre[0].name.endsWith("[#" + hash + "].pdf"), pre[0].name);
  assert.ok(pos[0].name.startsWith("CONFISSÃO PÓS-CHAVES - ") && pos[0].name.endsWith("[#" + hash + "].pdf"), pos[0].name);
  const e = c.acao("contratoEstado");
  assert.deepEqual(e.confissao.map((x) => x.tipo), ["PRE", "POS"]);
  assert.equal(c.acao("verConfissao", { tipo: "POS" }).ok, true);
});

/* 01/11: termos de confissão sempre do contrato atual (investigação E) */
const velho = (pref, carimbo = "aaaaaaaa") => ({ files: [{ name: pref + "CONDOMÍNIO RESERVA TESTE - CASA 13 [#" + carimbo + "].pdf", type: "file", file: { url: "https://s3.falso/velho-" + carimbo } }] });
const SEM_POS = { "Nº PARCELAS PÓS CHAVES": num(0), "VALOR PÓS CHAVES": num(0), "DATA  PÓS CHAVES ": dat(null), "VALOR 2º PARTE PRÉ CHAVES": num(1707.27),
                  "ESTADO CIVIL FIADOR 1": rt(""), "ESTADO CIVIL FIADOR 2": rt("") };   /* 24x: a soma fecha e o fiador é dispensado */
const SO_POS = { "Nº PARCELAS 1º PARTE PRÉ CHAVES": num(0), "VALOR 1º PARTE PRÉ CHAVES": num(0), "Nº PARCELAS 2º PARTE PRÉ CHAVES": num(0), "VALOR 2º PARTE PRÉ CHAVES": num(0),
                 "VALOR 1º BALÃO": num(0), "VALOR BALÃO ENTREGA DE CHAVES": num(0), "VALOR PÓS CHAVES": num(1872.92), "VALOR DO FGTS": num(5249.92) };   /* sem pré-chaves: só o termo PÓS */
const antigos = { "CONFISSÃO PRÉ-CHAVES - GERADA": velho("CONFISSÃO PRÉ-CHAVES - "), "CONFISSÃO PÓS-CHAVES - GERADA": velho("CONFISSÃO PÓS-CHAVES - ") };

test("01/11: venda que voltou de 36x para 24x — os termos antigos saem das colunas GERADA depois de gerar o contrato", () => {
  const c = cenarioCfd({ linha: { ...SEM_POS, ...antigos } });
  const r = c.gerarFinal();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files.length, 0);
  assert.equal(c.n.pagina.properties["CONFISSÃO PÓS-CHAVES - GERADA"].files.length, 0);
  assert.deepEqual(c.acao("contratoEstado").confissao, []);
});

test("01/11: venda que passou a ter só o termo PÓS — o PRÉ antigo sai e o PÓS é o novo", () => {
  const c = cenarioCfd({ linha: { ...SO_POS, ...antigos } });
  const r = c.gerarFinal();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files.length, 0);
  const pos = c.n.pagina.properties["CONFISSÃO PÓS-CHAVES - GERADA"].files;
  assert.equal(pos.length, 1);
  assert.ok(pos[0].name.endsWith("[#" + /\[#([0-9a-f]{8})\]\.pdf$/.exec(r.nome)[1] + "].pdf"), pos[0].name);
  assert.deepEqual(c.acao("contratoEstado").confissao.map((x) => x.tipo), ["POS"]);
});

/* limpeza dos termos antigos chamada direto (a ação "Conferi" já recusa envelope com signatários — ver CONTRATO_EM_ASSINATURA):
 * a geração dos termos tem de dar certo (nomes, sem resp) e mesmo assim o termo antigo fica. */
function gerarTermosDireto(c) {
  const ctx = c.g.ctx, p = { pageId: COND };
  const prep = ctx.ctrPreparar_(ctx.colunas_(), p, "00112233", "teste");
  assert.ok(!prep.resp, JSON.stringify(prep.resp));
  const tc = ctx.cfdGerarTermos_(prep, p, "00112233", "teste");
  assert.ok(!tc.resp, JSON.stringify(tc.resp));
  return tc;
}
test("01/11: com o envelope na mão dos signatários (ENVIADO ou qualquer situação não final) nada é limpo", () => {
  for (const sit of ["ENVIADO", "RASCUNHO", "ASSINADO"]) {
    const c = cenarioCfd({ linha: { ...SEM_POS, ...antigos, "ASSINATURA - ENVELOPE ID": rt("env-x"), "ASSINATURA - SITUAÇÃO": rt(sit) } });
    const tc = gerarTermosDireto(c);
    assert.equal(tc.nomes.length, 0, sit);   /* 24x: nenhum termo novo — a geração deu certo e não limpou */
    assert.equal(c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files.length, 1, sit);
    assert.equal(c.n.pagina.properties["CONFISSÃO PÓS-CHAVES - GERADA"].files.length, 1, sit);
  }
  /* envelope cancelado já não está com ninguém: pode limpar */
  const c = cenarioCfd({ linha: { ...SEM_POS, ...antigos, "ASSINATURA - ENVELOPE ID": rt("env-x"), "ASSINATURA - SITUAÇÃO": rt("CANCELADO") } });
  assert.equal(c.gerarFinal().ok, true);
  assert.equal(c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files.length, 0);
  /* envio pendente (envelope ativado, Notion ainda sem gravar) também segura */
  const p = cenarioCfd({ linha: { ...SEM_POS, ...antigos } });
  p.g.ctx.PropertiesService.getScriptProperties().setProperty("ASSINATURA_PENDENTE_" + COND, "env-y");
  const tp = gerarTermosDireto(p);
  assert.equal(tp.nomes.length, 0);
  assert.equal(p.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files.length, 1);
});

test("01/11: falha ao limpar o termo antigo não derruba o Conferi (só vai para o console, sem dado pessoal)", () => {
  const c = cenarioCfd({ linha: { ...SEM_POS, ...antigos } });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  c.falha.fn = (url, opt) => (String(opt.method).toUpperCase() === "PATCH" && /"files":\[\]/.test(String(opt.payload || ""))
    ? { status: 500, json: { message: "falha ao limpar" } } : null);
  const r = c.acao("aprovarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  const log = c.g.logs.join("\n");
  assert.match(log, /limpeza do termo antigo falhou/);
  assert.doesNotMatch(log, /Compradora de Teste|Fiador Um Teste|111\.444|529\.982|compradora@/);
});

/* 01/11: "Conferi" com o envelope na mão dos signatários não troca contrato nem termos */
test("01/11: Conferi com envelope ENVIADO/RASCUNHO/ASSINADO ou envio pendente: CONTRATO_EM_ASSINATURA, nada gerado", () => {
  for (const sit of ["ENVIADO", "RASCUNHO", "ASSINADO", "pendente"]) {
    const linha = { ...antigos, "CONTRATO GERADO": velho("CONTRATO - ", "bbbbbbbb"), "ASSINATURA - ENVELOPE ID": rt("env-x"), "ASSINATURA - SITUAÇÃO": rt(sit === "pendente" ? "" : sit) };
    const c = cenarioCfd({ linha });
    c.acao("gerarPreContrato");
    if (sit === "pendente") c.g.ctx.PropertiesService.getScriptProperties().setProperty("ASSINATURA_PENDENTE_" + COND, "env-y");
    d_zerar(c);
    const r = c.acao("aprovarPreContrato");
    assert.deepEqual({ ok: r.ok, erro: r.erro }, { ok: false, erro: "CONTRATO_EM_ASSINATURA" }, sit);
    assert.equal(c.d.estado.copias.length, 0, sit + ": nada copiado no Drive");
    assert.equal(c.n.patches.length, 0, sit + ": nada gravado no Notion");
    assert.match(c.n.pagina.properties["CONTRATO GERADO"].files[0].name, /bbbbbbbb/, sit);
    assert.equal(c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - GERADA"].files.length, 1, sit);
    assert.equal(c.acao("gerarContrato").erro, "CONTRATO_EM_ASSINATURA", sit + " (ação antiga)");
  }
  /* envelope cancelado já não está com ninguém: o Conferi segue */
  const c = cenarioCfd({ linha: { "ASSINATURA - ENVELOPE ID": rt("env-x"), "ASSINATURA - SITUAÇÃO": rt("CANCELADO") } });
  assert.equal(c.gerarFinal().ok, true);
});
function d_zerar(c) { c.d.zerar(); c.g.chamadas.length = 0; c.n.patches.length = 0; }

/* 01/11: erros do Conferi viram mensagem com o que fazer (investigação F) */
const DADOS_NO_LOG = /Compradora de Teste|Fiador (Um|Dois) Teste|111\.444|246\.813|529\.982|compradora@|f1@teste/;
test("01/11: termo que lança exceção no Conferi: PRECONTRATO_REFAZER (não ERRO_INTERNO), nada trocado, console sem dado pessoal", () => {
  const c = cenarioCfd();
  assert.equal(c.acao("gerarPreContrato").ok, true);
  c.g.ctx.ConfissaoVenda.marcadores = () => { throw new Error("falha de teste"); };
  const r = c.acao("aprovarPreContrato");
  assert.deepEqual({ ok: r.ok, erro: r.erro }, { ok: false, erro: "PRECONTRATO_REFAZER" });
  assert.equal(c.n.pagina.properties["CONTRATO GERADO"].files.length, 0, "contrato final não saiu");
  const log = c.g.logs.filter((l) => l.includes("aprovarPreContrato falhou:"));
  assert.equal(log.length, 1, c.g.logs.join("\n"));
  assert.match(log[0], /^PORTAL-VENDA aprovarPreContrato falhou: 00112233 falha de teste$/);
  assert.doesNotMatch(c.g.logs.join("\n"), DADOS_NO_LOG);
});

test("01/11: Notion 429 no Conferi: NOTION_OCUPADO", () => {
  const c = cenarioCfd();
  assert.equal(c.acao("gerarPreContrato").ok, true);
  c.falha.fn = (url) => (url.startsWith("https://api.notion.com/") ? { status: 429, json: { message: "rate_limited" } } : null);
  const r = c.acao("aprovarPreContrato");
  assert.deepEqual({ ok: r.ok, erro: r.erro }, { ok: false, erro: "NOTION_OCUPADO" });
  c.falha.fn = null;
  assert.equal(c.acao("aprovarPreContrato").ok, true, "passada a fila, o mesmo clique funciona");
});

test("01/11: a tela só lista o termo com o mesmo carimbo do contrato gerado", () => {
  const c = cenarioCfd({ linha: {
    "CONTRATO GERADO": velho("CONTRATO - ", "11111111"),
    "CONFISSÃO PRÉ-CHAVES - GERADA": velho("CONFISSÃO PRÉ-CHAVES - ", "22222222"),
    "CONFISSÃO PÓS-CHAVES - GERADA": velho("CONFISSÃO PÓS-CHAVES - ", "11111111") } });
  assert.deepEqual(c.acao("contratoEstado").confissao.map((x) => x.tipo), ["POS"]);
});

test("28/10: CPF do fiador em coluna de NÚMERO perde o zero da frente — o contrato completa os 11 dígitos", () => {
  const c = cenarioCfd({ linha: { "CPF FIADOR 1": num(1234567890) } });   /* 012.345.678-90 (fictício) */
  const r = c.acao("gerarPreContrato");
  assert.notEqual(r.erro, "FALTAM_DADOS", JSON.stringify(r.faltas));
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("28/10: sem os fiadores, o contrato com os termos ligados não sai (falta nome e CPF)", () => {
  const c = cenarioCfd({ linha: { "FIADOR 2": rt(""), "CPF FIADOR 2": rt("") } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.includes("Fiador 2 (termo de confissão): nome"), r.faltas.join(" | "));
});

test("30/10: fiador casado — o GerarContrato lê ESTADO CIVIL / CONJUGE / CPF / EMAIL CONJUGE FIADOR n e exige o casal", () => {
  /* 31/10: casado com alguém de fora não passa — o outro fiador tem de ser o cônjuge */
  const c = cenarioCfd({ linha: { "ESTADO CIVIL FIADOR 1": rt("CASADO"), "CONJUGE FIADOR 1": rt("Conjuge Um Teste"),
    "CPF CONJUGE FIADOR 1": rt("529.982.247-25") } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas.filter((f) => /cônjuge/.test(f)), ["Fiador 1: casado — o outro fiador tem de ser o cônjuge (CPF do cônjuge igual ao do outro fiador)"]);
  /* o casal como os 2 fiadores (o preferido): o cônjuge é o outro fiador, nada a mais */
  const casal = cenarioCfd({ linha: { "ESTADO CIVIL FIADOR 1": rt("CASADO"), "ESTADO CIVIL FIADOR 2": rt("CASADO"),
    "CPF CONJUGE FIADOR 1": rt("24681357928"), "CPF CONJUGE FIADOR 2": num(11144477735) } });
  const r2 = casal.acao("gerarPreContrato");
  assert.equal(r2.ok, true, JSON.stringify(r2));
});

test("01/11: bloco Fiadores — o contratoEstado traz o bloco com o aviso do #74; 'o cônjuge é o Fiador 2' destrava o pré-contrato", () => {
  const c = cenarioCfd({ linha: { "ESTADO CIVIL FIADOR 1": rt("CASADO"), "CONJUGE FIADOR 1": rt("Fiadora Dois Teste"),
    "CPF CONJUGE FIADOR 1": rt("246.813.579-28"), "EMAIL CONJUGE FIADOR 1": eml("f2@teste.example"),
    "FIADOR 2": rt(""), "CPF FIADOR 2": rt(""), "EMAIL FIADOR 2": eml(null),
    "CONJUGE FIADOR 2": rt(""), "CPF CONJUGE FIADOR 2": rt(""), "EMAIL CONJUGE FIADOR 2": eml(null) } });
  const e = c.acao("contratoEstado");
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.equal(e.fiadores.titulo, "Fiadores");
  assert.ok(e.fiadores.faltas.includes("Fiador 2 (termo de confissão): nome"), e.fiadores.faltas.join(" | "));
  assert.equal(e.fiadores.botaoConjuge, true);
  assert.equal(e.fiadores.fiadores[0].campos[0].valor, "Fiador Um Teste");
  const r = c.acao("conjugeEhFiador2");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.txt("FIADOR 2"), "Fiadora Dois Teste");
  const pre = c.acao("gerarPreContrato");
  assert.equal(pre.ok, true, JSON.stringify(pre.faltas || pre));
  assert.equal(c.acao("contratoEstado").fiadores, undefined, "sem falta, o bloco some");
});

test("28/10: Clicksign — contrato e termos no MESMO envelope; fiadores assinam só os termos; termos assinados nas colunas deles", () => {
  const c = cenarioCfd({ cs: { arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.equal(c.gerarFinal().ok, true);
  const r = c.acao("assinaturaEnviar", rub(c));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.signatarios.map((s) => s.papel).slice(-2), ["Fiador 1", "Fiador 2"]);
  const docs = c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/documents");
  assert.equal(docs.length, 3);
  assert.ok(docs[1].corpo.data.attributes.filename.startsWith("CONFISSÃO PRÉ-CHAVES - ") && !/\[#/.test(docs[1].corpo.data.attributes.filename));
  const sigs = c.c.estado.signers, fiador = sigs.find((s) => s.attributes.email === "f1@teste.example");
  const reqs = c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/requirements");
  const docsDo = (id) => [...new Set(reqs.filter((q) => q.corpo.data.relationships.signer.data.id === id).map((q) => q.corpo.data.relationships.document.data.id))].sort();
  /* 30/10: rubricas só do comprador e só no contrato (os termos não têm campos de ciência) */
  const rubricam = reqs.filter((q) => q.corpo.data.attributes.action === "rubricate");
  assert.deepEqual(rubricam.map((q) => [q.corpo.data.relationships.document.data.id, q.corpo.data.attributes.kind]), [["doc-1", "manuscript"], ["doc-1", "initials"]]);
  assert.deepEqual(docsDo(fiador.id), ["doc-2", "doc-3"], "fiador: só os termos");
  const comprador = sigs.find((s) => s.attributes.email === "compradora@teste.example");
  assert.deepEqual(docsDo(comprador.id), ["doc-1", "doc-2", "doc-3"]);
  const papelFiador = reqs.find((q) => q.corpo.data.relationships.signer.data.id === fiador.id && q.corpo.data.attributes.role);
  assert.equal(papelFiador.corpo.data.attributes.role, "guarantor");
  /* tudo assinado: o contrato e os dois termos assinados vão para as colunas */
  c.c.estado.status = "closed";
  const e = c.acao("assinaturaEstado");
  assert.equal(e.situacao, "ASSINADO", JSON.stringify(e));
  assert.equal(c.n.pagina.properties["CONTRATO ASSINADO"].files.length, 1);
  assert.equal(c.n.pagina.properties["CONFISSÃO PRÉ-CHAVES - ASSINADA"].files.length, 1);
  assert.equal(c.n.pagina.properties["CONFISSÃO PÓS-CHAVES - ASSINADA"].files.length, 1);
});

test("28/10: termos de outro carimbo (dado mudou e só o contrato foi refeito) = CONFISSAO_DESATUALIZADA", () => {
  const c = cenarioCfd();
  assert.equal(c.gerarFinal().ok, true);
  c.n.pagina.properties["CONFISSÃO PÓS-CHAVES - GERADA"].files[0].name = "CONFISSÃO PÓS-CHAVES - X [#00000000].pdf";
  assert.equal(c.acao("assinaturaEnviar").erro, "CONFISSAO_DESATUALIZADA");
});

test("28/10: sem fiador com e-mail a assinatura não sai; sem os modelos dos termos tudo segue como antes", () => {
  /* 01/11 (revisão final, I1): a falta aparece já no Gerar pré-contrato, e o bloco da tela tem a caixa do e-mail */
  const c = cenarioCfd({ linha: { "EMAIL FIADOR 2": eml("") } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.includes("Fiador 2: e-mail (coluna EMAIL FIADOR 2)"), r.faltas.join(" | "));
  const e = c.acao("contratoEstado");
  assert.ok(e.fiadores.faltas.includes("Fiador 2: e-mail (coluna EMAIL FIADOR 2)"), JSON.stringify(e.fiadores));
  assert.ok(e.fiadores.fiadores[1].campos.some((x) => x.coluna === "EMAIL FIADOR 2" && x.tipo === "email"));
  assert.equal(c.acao("salvarFiadores", { valores: { "EMAIL FIADOR 2": "f2@teste.example" } }).ok, true);
  assert.equal(c.acao("contratoEstado").fiadores, undefined, "salvo o e-mail, a falta some");
  assert.equal(c.gerarFinal().ok, true);
  const semModelo = cenario({ linha: COLS_CFD });
  const g = semModelo.gerarFinal();
  assert.equal(g.ok, true);
  assert.equal(g.termos, undefined);
});

/* 01/11/2026 (revisão final, I1): contrato FINAL (gerado antes) e o e-mail some depois — o envio barra, e a aba Contrato
   abre o bloco só com o e-mail que falta; salvar tira a falta. Cônjuge do comprador sem e-mail barra o Gerar. */
test("I1: contrato final sem o e-mail do fiador — o contratoEstado traz o bloco só com o e-mail; salvar limpa a falta", () => {
  const c = cenarioCfd();
  assert.equal(c.gerarFinal().ok, true);
  c.n.pagina.properties["EMAIL FIADOR 2"] = { type: "email", email: null };
  assert.ok(c.acao("assinaturaEnviar", rub(c)).faltas.includes("Fiador 2: e-mail (coluna EMAIL FIADOR 2)"));
  const e = c.acao("contratoEstado");
  assert.equal(e.etapa, "FINAL");
  assert.deepEqual(e.fiadores.faltas, ["Fiador 2: e-mail (coluna EMAIL FIADOR 2)"]);
  /* só a caixa do e-mail (a base de teste não tem EMAIL CONJUGE FIADOR 2 — sai do bloco) */
  assert.deepEqual(e.fiadores.fiadores.map((f) => [f.n, f.campos.map((x) => x.coluna)]), [[2, ["EMAIL FIADOR 2"]]]);
  const s = c.acao("salvarFiadores", { valores: { "EMAIL FIADOR 2": "F2@teste.example" } });
  assert.deepEqual(s, { ok: true, gravou: ["EMAIL FIADOR 2"] });
  assert.equal(c.acao("contratoEstado").fiadores, undefined, "a falta some e o bloco fecha");
  /* com tudo certo, o contrato final não ganha bloco */
  const ok = cenarioCfd();
  assert.equal(ok.gerarFinal().ok, true);
  assert.equal(ok.acao("contratoEstado").fiadores, undefined);
});

test("I1: comprador casado sem o e-mail do cônjuge — falta no Gerar e o bloco do cônjuge com a caixa do e-mail", () => {
  const c = cenario({ linha: { "ESTADO CIVIL": rt("CASADO"), CONJUGE: rt("Conjuge Teste da Silva"), "CPF CONJUGE": rt("935.411.347-80"),
    "EMAIL CONJUGE": eml(null), REGIME: rt("COMUNHÃO PARCIAL DE BENS") } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.includes("Cônjuge do comprador 1: e-mail (coluna EMAIL CONJUGE)"), r.faltas.join(" | "));
  const e = c.acao("contratoEstado");
  assert.ok(e.fiadores.conjuge.campos.some((x) => x.coluna === "EMAIL CONJUGE" && x.tipo === "email"), JSON.stringify(e.fiadores));
  assert.equal(c.acao("salvarFiadores", { valores: { "EMAIL CONJUGE": "conjuge@teste.example" } }).ok, true);
  assert.equal(c.acao("contratoEstado").fiadores, undefined);
  assert.equal(c.acao("gerarPreContrato").ok, true);
});

/* ---- 28/10/2026: conferência dos documentos pela IA (Conferencia.gs) ---- */
test("28/10: conferir documentos — lê pela IA, compara, guarda; ilegível confirmado; o pré-contrato só avisa", () => {
  const PDF = { buf: Buffer.from("%PDF-1.4 documento de teste", "utf8"), mime: "application/pdf" };
  const leituras = {
    leitura_identidade: { tipo_documento: "CNH", nome: "COMPRADORA DE TESTE", cpf: "52998224725", numero_documento: "", orgao_emissor: "",
                          nacionalidade: "", data_nascimento: "", rg_numero: "1234567", rg_orgao_uf: "" },
    leitura_comprovante: { tipo_documento: "COMPROVANTE", titular: "", endereco_completo: "Avenida Diferente 999, Outro Bairro, Outra Cidade 75999-000", data_emissao: "" },
  };
  const pedidos = [];
  const ia = (url, opt) => {
    const corpo = JSON.parse(opt.payload), nome = corpo.text.format.name;
    pedidos.push(nome);
    return { json: { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(leituras[nome]) }] }], usage: {} } };
  };
  const arq = (id) => ({ files: [{ name: id + ".pdf", type: "file", file: { url: "https://s3.falso/" + id } }] });
  const c = cenario({ props: { OPENAI_API_KEY: "sk-teste" }, ia, s3: { cnh: PDF, luz: PDF },
                      linha: { "DOC. PROPONENTE": arq("cnh"), "COMPROVANTE DE ENDEREÇO": arq("luz"), "CERTIDÕES": { files: [] } } });
  assert.deepEqual(c.acao("conferenciaEstado"), { ok: true, feito: false });
  const r = c.acao("conferirDocumentos");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(pedidos.sort(), ["leitura_comprovante", "leitura_identidade"]);
  const sit = Object.fromEntries(r.linhas.map((l) => [l.item + ":" + l.campo, l.situacao]));
  assert.equal(sit["c1-id:nome"], "ok");
  assert.equal(sit["c1-id:cpf"], "ok");
  assert.equal(sit["c1-end:endereco"], "diverge");
  assert.equal(sit["c1-civil:estado_civil"], "ilegivel", "certidão não anexada");
  /* o pré-contrato sai, com o aviso */
  const pre = c.acao("gerarPreContrato");
  assert.equal(pre.ok, true, JSON.stringify(pre));
  assert.ok(pre.avisos.some((a) => /^Conferência dos documentos: 1 divergência e 1 item não anexado/.test(a)), pre.avisos.join(" | "));
  /* abrir o documento e confirmar visualmente */
  const doc = c.acao("verDocumentoConferencia", { coluna: "DOC. PROPONENTE" });
  assert.equal(doc.ok, true); assert.equal(doc.total, 1);
  assert.equal(c.acao("verDocumentoConferencia", { coluna: "CPF PROPONENTE" }).erro, "COLUNA_INVALIDA");
  r.linhas.forEach((l, i) => { if (l.situacao !== "ok") assert.equal(c.acao("confirmarConferencia", { indice: i }).ok, true); });
  const e = c.acao("conferenciaEstado");
  assert.equal(e.feito, true); assert.equal(e.atual, true);
  const pre2 = c.acao("gerarPreContrato");
  assert.ok(!(pre2.avisos || []).some((a) => /^Conferência/.test(a)), "tudo conferido: sem aviso");
  /* dado mudou: a conferência fica velha */
  c.n.pagina.properties["DIA PAGAMENTO PARCELAS"] = { type: "number", number: 15 };
  assert.equal(c.acao("conferenciaEstado").atual, false);
});

/* ---- 29/10: condições especiais desta venda (item 16 do quadro-resumo) ---- */
test("29/10 condições especiais: grava na coluna, guarda quem e quando, avisa no pré-contrato e desatualiza o pré gerado antes", () => {
  const c = cenario({ linha: { "CONTRATO - CONDIÇÕES ESPECIAIS": rt("") } });
  assert.equal(c.acao("contratoEstado").condicoes.texto, "");
  const pre0 = c.acao("gerarPreContrato");
  assert.equal(pre0.ok, true, JSON.stringify(pre0));
  assert.ok(!(pre0.avisos || []).some((a) => /Condições especiais/.test(a)), JSON.stringify(pre0.avisos));
  const r = c.acao("salvarCondicoesEspeciais", { texto: "Na cláusula 9.2, onde se lê 30 dias,\nleia-se 45 dias." });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.txt("CONTRATO - CONDIÇÕES ESPECIAIS"), "Na cláusula 9.2, onde se lê 30 dias,\nleia-se 45 dias.");
  const e = c.acao("contratoEstado");
  assert.match(e.condicoes.texto, /leia-se 45 dias/);
  assert.equal(e.condicoes.por, "ana.teste");
  assert.ok(e.pre.desatualizado, "o pré-contrato de antes devia ficar desatualizado");
  const pre1 = c.acao("gerarPreContrato");
  assert.ok(pre1.avisos.some((a) => /Condições especiais: este contrato tem texto próprio no item 16/.test(a)), JSON.stringify(pre1.avisos));
  assert.equal(c.acao("salvarCondicoesEspeciais", { texto: "x".repeat(1901) }).erro, "CAMPOS_INVALIDOS");
});

test("29/10 Redigir com IA: manda o pedido e o texto do modelo à OpenAI, devolve a redação SEM gravar e avisa cláusula inexistente", () => {
  let corpo = null;
  const ia = (url, opt) => {
    corpo = JSON.parse(opt.payload);
    const resp = { redacao: "Na cláusula 99.9, onde se lê 30 dias, leia-se 45 dias.", clausulas_citadas: ["99.9"], observacao: "Prazo trocado." };
    return { json: { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(resp) }] }], usage: { input_tokens: 10, output_tokens: 5 } } };
  };
  const c = cenario({ props: { OPENAI_API_KEY: "sk-teste" }, ia, linha: { "CONTRATO - CONDIÇÕES ESPECIAIS": rt("") } });
  const patches = c.n.patches.length;
  const r = c.acao("redigirCondicoesEspeciais", { pedido: "cliente quer 45 dias em vez de 30", atual: "" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.redacao, /leia-se 45 dias/);
  assert.deepEqual(r.inexistentes, ["99.9"]);
  assert.equal(corpo.text.format.name, "condicoes_especiais");
  assert.match(corpo.input[0].content[0].text, /PEDIDO: cliente quer 45 dias/);
  assert.match(corpo.input[0].content[0].text, /CONTRATO MODELO:\n.*CONDOMÍNIO/s);
  assert.equal(c.n.patches.length, patches, "redigir não pode gravar na venda");
  assert.equal(c.acao("redigirCondicoesEspeciais", { pedido: "" }).erro, "CAMPOS_INVALIDOS");
  const semChave = cenario({ linha: { "CONTRATO - CONDIÇÕES ESPECIAIS": rt("") } });
  assert.equal(semChave.acao("redigirCondicoesEspeciais", { pedido: "x" }).erro, "CHAVE_IA_FALTANDO");
});

/* ---- 29/10: Alterar fluxo (etapa 1 — tela, gravação e histórico; o contrato ainda não lê a lista) ---- */
const cenarioFluxo = (o = {}) => cenario({ ...o, linha: { "FLUXO PERSONALIZADO": rt(""), ...(o.linha || {}) } });
const FluxoLivre = req("../FluxoLivre.js");
/* mais um balão de 10 mil e as pós-chaves menores (Redistribuir: centavos na última) */
const comBalao = (f) => {
  const g = { valor: f.valor, linhas: [...f.linhas, { t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1, x: "" }] };
  return { valor: f.valor, linhas: FluxoLivre.redistribuir(g, g.linhas.findIndex((l) => l.t === "pos")).linhas };
};

test("29/10 fluxo: contratoEstado diz se pode alterar; fluxoEditar traz o fluxo da proposta como lista que fecha", () => {
  const c = cenarioFluxo();
  assert.deepEqual(c.acao("contratoEstado").fluxo, { coluna: true, alterado: false, trava: "", por: "", em: "", alteracoes: 0 });
  const e = c.acao("fluxoEditar");
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.equal(e.atual.valor, 305000);
  assert.equal(e.atual.entrega, "2028-12-01");
  assert.deepEqual(e.atual.linhas.map((l) => l.t), ["sinal", "sinal", "sinal", "sinal", "pre", "pre", "balao", "balao", "pos", "fin", "fgts"]);
  assert.equal(e.atual.linhas.reduce((s, l) => s + Math.round(l.v * 100) * l.n, 0), 30500000);
  assert.equal(cenario().acao("fluxoEditar").erro, "COLUNA_FALTANDO");
});

test("29/10 fluxo: salva só com a conta fechando e com motivo; grava a lista e o histórico; o contrato sai com o fluxo alterado", () => {
  const c = cenarioFluxo();
  const pre0 = c.acao("gerarPreContrato");
  assert.equal(pre0.ok, true, JSON.stringify(pre0));
  const base = c.acao("fluxoEditar").atual;
  const solto = { valor: base.valor, linhas: [...base.linhas, { t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 }] };
  const r1 = c.acao("salvarFluxo", { fluxo: solto, motivo: "mais um balão" });
  assert.equal(r1.erro, "CAMPOS_INVALIDOS");
  assert.match(r1.erros[0], /^Sobram R\$ 10\.000,00/);
  assert.equal(c.acao("salvarFluxo", { fluxo: comBalao(base), motivo: "  " }).erro, "CAMPOS_INVALIDOS");
  const ok = c.acao("salvarFluxo", { fluxo: comBalao(base), motivo: "cliente pediu mais um balão e parcelas menores" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.fluxo.alterado, true);
  const gravado = JSON.parse(c.txt("FLUXO PERSONALIZADO"));
  assert.equal(gravado.linhas.length, 12);
  assert.equal(gravado.entrega, "2028-12-01", "a entrega é a da linha, não a da tela");
  const est = c.acao("contratoEstado");
  assert.deepEqual([est.fluxo.alterado, est.fluxo.por, est.fluxo.alteracoes], [true, "ana.teste", 1]);
  assert.equal(est.pre.desatualizado, true, "pré-contrato de antes fica desatualizado");
  /* etapa 2: o pré-contrato sai com o balão novo no 6.1 e as pós-chaves menores */
  c.d.zerar();
  const pre1 = c.acao("gerarPreContrato");
  assert.equal(pre1.ok, true, JSON.stringify(pre1));
  const pars = c.d.estado.salvos[c.d.estado.copias.at(-1).id].pars;
  const i61 = pars.findIndex((l) => l.startsWith("6.1. Preço total: R$ 305.000,00"));
  const t61 = pars.slice(i61, i61 + 30).join(" | ");
  assert.match(t61, /a\) R\$ 10\.000,00 \(dez mil reais\), com vencimento em 10\/06\/2027;/);
  assert.match(t61, /23 parcelas mensais e sucessivas de R\$ 289,22 .* e a última de R\$ 289,30/);
  assert.notEqual(pre1.nome, pre0.nome, "carimbo novo: o fluxo mudou");
  const h = c.acao("fluxoEditar");
  assert.equal(h.alterado, true);
  assert.equal(h.atual.linhas.length, 12);
  assert.deepEqual(h.historico.map((x) => [x.por, x.motivo, x.voltou]), [["ana.teste", "cliente pediu mais um balão e parcelas menores", false]]);
  assert.ok(!("antes" in h.historico[0]), "a tela não recebe os fluxos antigos inteiros");
  /* voltar ao fluxo da proposta: limpa a coluna e o contrato volta a gerar */
  assert.equal(c.acao("salvarFluxo", { voltar: true, motivo: "cliente desistiu da mudança" }).ok, true);
  assert.equal(c.txt("FLUXO PERSONALIZADO"), "");
  c.d.zerar();
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(c.acao("salvarFluxo", { voltar: true, motivo: "de novo" }).erro, "FLUXO_JA_E_O_DA_PROPOSTA");
  assert.equal(c.acao("fluxoEditar").historico.length, 2);
});

test("29/10 fluxo: valor da casa só muda com quem está em FLUXO_PRECO_USUARIOS, e pede o segundo motivo", () => {
  const sem = cenarioFluxo();
  const b0 = sem.acao("fluxoEditar");
  assert.equal(b0.podePreco, false);
  assert.deepEqual(b0.quemMudaPreco, []);
  const desconto = (atual) => ({ valor: 300000, linhas: atual.linhas.map((l) => (l.t === "balao" && l.v > 8000 ? { ...l, v: l.v - 5000 } : l)) });
  assert.equal(sem.acao("salvarFluxo", { fluxo: desconto(b0.atual), motivo: "desconto", motivoPreco: "x" }).erro, "FLUXO_PRECO_SEM_PERMISSAO");
  const c = cenarioFluxo({ props: { FLUXO_PRECO_USUARIOS: "beto.teste, Ana.Teste" } });
  const base = c.acao("fluxoEditar").atual;
  assert.equal(c.acao("fluxoEditar").podePreco, true);
  assert.deepEqual(c.acao("fluxoEditar").quemMudaPreco, ["Beto Teste", "Ana Teste"]);
  const f = desconto(base);
  const r = c.acao("salvarFluxo", { fluxo: f, motivo: "desconto" });
  assert.equal(r.erro, "CAMPOS_INVALIDOS");
  assert.match(r.erros[0], /R\$ 305\.000,00 → R\$ 300\.000,00/);
  assert.equal(c.acao("salvarFluxo", { fluxo: f, motivo: "desconto", motivoPreco: "aprovado pelo diretor" }).ok, true);
  assert.equal(JSON.parse(c.txt("FLUXO PERSONALIZADO")).valor, 300000);
});

test("29/10 fluxo: o servidor recusa mexer no financiamento; pós-chaves só 0, 12 ou 24 (31/10: o prazo pode mudar)", () => {
  const c = cenarioFluxo();
  const base = c.acao("fluxoEditar").atual;
  const fin = { valor: base.valor, linhas: base.linhas.map((l) => (l.t === "fin" ? { ...l, v: l.v - 1000 } : l.t === "sinal" && l.v === 1000 ? { ...l, v: 2000 } : l)) };
  const r1 = c.acao("salvarFluxo", { fluxo: fin, motivo: "x" });
  assert.equal(r1.erro, "CAMPOS_INVALIDOS");
  assert.match(r1.erros.join(";"), /não mudam/);
  const pos = { valor: base.valor, linhas: base.linhas.map((l) => (l.t === "pos" ? { ...l, n: 13, v: l.v * 24 / 13 } : l)) };
  assert.match(c.acao("salvarFluxo", { fluxo: pos, motivo: "x" }).erros.join(";"), /só 0, 12 ou 24 parcelas/);
  const r36 = FluxoLivre.mudarPrazo(base, 36);
  assert.equal(c.acao("salvarFluxo", { fluxo: { valor: base.valor, linhas: r36.linhas }, motivo: "cliente foi para 36x" }).ok, true);
});

test("29/10 fluxo: venda lançada no MC, envelope aberto ou contrato assinado não deixam alterar; envelope cancelado deixa", () => {
  const f = (c) => comBalao(c.acao("fluxoEditar").atual);
  const lancada = cenarioFluxo({ linha: { "MC - VENDA ID": rt("12345") } });
  assert.equal(lancada.acao("contratoEstado").fluxo.trava, "FLUXO_VENDA_LANCADA");
  assert.equal(lancada.acao("salvarFluxo", { fluxo: f(lancada), motivo: "x" }).erro, "FLUXO_VENDA_LANCADA");
  const aberta = cenarioFluxo({ linha: { "ASSINATURA - ENVELOPE ID": rt("env-1"), "ASSINATURA - SITUAÇÃO": rt("ENVIADO") } });
  assert.equal(aberta.acao("salvarFluxo", { fluxo: f(aberta), motivo: "x" }).erro, "FLUXO_ASSINATURA_ABERTA");
  const assinada = cenarioFluxo({ linha: { "ASSINATURA - ENVELOPE ID": rt("env-1"), "ASSINATURA - SITUAÇÃO": rt("ASSINADO") } });
  assert.equal(assinada.acao("salvarFluxo", { fluxo: f(assinada), motivo: "x" }).erro, "FLUXO_CONTRATO_ASSINADO");
  const cancelada = cenarioFluxo({ linha: { "ASSINATURA - ENVELOPE ID": rt("env-1"), "ASSINATURA - SITUAÇÃO": rt("CANCELADO") } });
  assert.equal(cancelada.acao("salvarFluxo", { fluxo: f(cancelada), motivo: "x" }).ok, true);
  const testes = cenarioFluxo();
  assert.equal(testes.acao("salvarFluxo", { fluxo: f(testes), motivo: "x" }, token("TESTES")).erro, "SEM_PERMISSAO_TESTES");
});

/* ---- 30/10: rubricas do comprador, memorial descritivo e projeto aprovado no envelope do condomínio ---- */
const MODELO_MEMORIAL = ["MEMORIAL DESCRITIVO", "/Type /Page", "/Type /Page", "/Type /Page",
                         "______________________", "{{ASSINATURA_COMPRADORES_NOMES}}", "CPF {{ASSINATURA_COMPRADORES_CPFS}}", "Comprador(es)"];
const reqsDe = (c) => c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/requirements").map((x) => x.corpo.data);
const docsPostados = (c) => c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/documents").map((x) => x.corpo.data.attributes);

test("30/10: contrato do condomínio sem as rubricas da tela não vai para a Clicksign; PDF de outro carimbo também não", () => {
  const c = cenario();
  assert.equal(c.gerarFinal().ok, true);
  assert.deepEqual(c.acao("assinaturaEnviar"), { ok: false, erro: "RUBRICAS_FALTANDO" });
  assert.equal(c.acao("assinaturaEnviar", rub(c, { nome: "OUTRO [#00000000].pdf" })).erro, "RUBRICAS_DE_OUTRO_PDF");
  assert.equal(c.acao("assinaturaEnviar", rub(c, { campos: [{ page: "3", position: [1.5, 0.2] }] })).erro, "RUBRICAS_INVALIDAS");
  assert.equal(c.c.chamadas.length, 0, "nada na Clicksign");
  assert.equal(c.txt("ASSINATURA - ENVELOPE ID"), "");
});

test("30/10: rubricas do comprador no contrato — assinatura nos campos de ciência, visto na coluna de valores; os outros não rubricam", () => {
  const c = cenario();
  assert.equal(c.gerarFinal().ok, true);
  const r = c.acao("assinaturaEnviar", rub(c));
  assert.equal(r.ok, true, JSON.stringify(r));
  const rq = reqsDe(c).filter((q) => q.attributes.action === "rubricate");
  const comprador = c.c.estado.signers.find((s) => s.attributes.email === "compradora@teste.example");
  assert.deepEqual(rq, [
    { type: "requirements", attributes: { action: "rubricate", kind: "manuscript", positions: RUB_CAMPOS },
      relationships: { document: { data: { type: "documents", id: "doc-1" } }, signer: { data: { type: "signers", id: comprador.id } } } },
    { type: "requirements", attributes: { action: "rubricate", kind: "initials", positions: [RUB_VALORES] },
      relationships: { document: { data: { type: "documents", id: "doc-1" } }, signer: { data: { type: "signers", id: comprador.id } } } }]);
  assert.equal(docsPostados(c).length, 1, "sem as Propriedades: nem memorial nem projeto");
});

test("30/10: ASSINATURA_SEM_RUBRICAS=SIM desliga (envia como antes, sem rubricas) e a tela nem recebe o PDF", () => {
  const c = cenario({ props: { ASSINATURA_SEM_RUBRICAS: "SIM" } });
  assert.equal(c.gerarFinal().ok, true);
  assert.deepEqual(c.acao("assinaturaPdf"), { ok: true, semRubricas: true });
  assert.equal(c.acao("assinaturaEnviar").ok, true);
  assert.equal(reqsDe(c).filter((q) => q.attributes.action === "rubricate").length, 0);
});

test("30/10: assinaturaPdf entrega à tela o PDF gerado (conteúdo, nunca o link), o nome com o carimbo e o ajuste", () => {
  const c = cenario();
  assert.equal(c.acao("assinaturaPdf").erro, "SEM_CONTRATO_GERADO");
  assert.equal(c.gerarFinal().ok, true);
  const r = c.acao("assinaturaPdf");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.nome, rub(c).rubricas.nome);
  assert.match(r.nome, /\[#[0-9a-f]{8}\]\.pdf$/);
  assert.ok(Buffer.from(r.base64, "base64").length > 10);
  assert.deepEqual(r.ajuste, CS.AJUSTE_PADRAO);
  assert.ok(!JSON.stringify(r).includes("https://"), "sem link do arquivo");
  assert.equal(c.c.chamadas.length, 0);
  /* perfil TESTES pode ler (não grava nada); ajuste pela Propriedade */
  assert.equal(c.acao("assinaturaPdf", {}, token("TESTES")).ok, true);
  const c2 = cenario({ props: { RUBRICAS_AJUSTE: '{"campo":{"dx":0,"dy":-0.02}}' } });
  c2.gerarFinal();
  assert.deepEqual(c2.acao("assinaturaPdf").ajuste.campo, { dx: 0, dy: -0.02 });
});

test("30/10: memorial e projeto aprovado no mesmo envelope, assinados só pelo comprador, com as posições fixas", () => {
  const c = cenario({ modelosExtra: { "modelo-memorial": MODELO_MEMORIAL }, cs: { arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } },
                      props: { MODELO_MEMORIAL_ID: "modelo-memorial", PROJETO_APROVADO_ID: "proj-1" } });
  c.d.soltos["proj-1"] = { nome: "projeto.pdf", url: "https://drive.falso/proj-1", buf: Buffer.from("%PDF-1.7 projeto aprovado de teste") };
  assert.equal(c.gerarFinal().ok, true);
  c.d.zerar();
  const r = c.acao("assinaturaEnviar", rub(c));
  assert.equal(r.ok, true, JSON.stringify(r));
  const docs = docsPostados(c);
  assert.equal(docs.length, 3);
  assert.match(docs[1].filename, /^MEMORIAL DESCRITIVO - .+\.pdf$/);
  assert.match(docs[2].filename, /^PROJETO APROVADO - .+\.pdf$/);
  const memorial = Buffer.from(docs[1].content_base64.split(",")[1], "base64").toString("utf8");
  assert.ok(memorial.includes("Compradora de Teste") && memorial.includes("529.982.247-25") && !memorial.includes("{{"), memorial);
  assert.equal(Buffer.from(docs[2].content_base64.split(",")[1], "base64").toString("utf8"), "%PDF-1.7 projeto aprovado de teste");
  /* a cópia do memorial (com dado pessoal) foi apagada */
  assert.equal(c.d.estado.copias.length, 1);
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
  const sigs = c.c.estado.signers, rq = reqsDe(c);
  const docsDo = (id) => [...new Set(rq.filter((q) => q.relationships.signer.data.id === id).map((q) => q.relationships.document.data.id))].sort();
  const comprador = sigs.find((s) => s.attributes.email === "compradora@teste.example");
  assert.deepEqual(docsDo(comprador.id), ["doc-1", "doc-2", "doc-3"]);
  for (const s of sigs.filter((x) => x !== comprador)) assert.deepEqual(docsDo(s.id), ["doc-1"], s.attributes.email);
  const rubr = rq.filter((q) => q.attributes.action === "rubricate").map((q) => [q.relationships.document.data.id, q.attributes.kind, q.attributes.positions]);
  assert.deepEqual(rubr.slice(2), [
    ["doc-2", "manuscript", [{ page: "3", position: [0.53, 0.7] }]],   /* última página do memorial (3 aqui) */
    ["doc-3", "initials", CS.POSICOES_PROJETO]]);
  /* tudo assinado: só o contrato vai para CONTRATO ASSINADO (o principal continua sendo o contrato) */
  c.c.estado.status = "closed";
  const e = c.acao("assinaturaEstado");
  assert.equal(e.situacao, "ASSINADO", JSON.stringify(e));
  assert.equal(c.n.pagina.properties["CONTRATO ASSINADO"].files.length, 1);
  assert.doesNotMatch(c.n.pagina.properties["CONTRATO ASSINADO"].files[0].name, /MEMORIAL|PROJETO/);
});

test("30/10: memorial ou projeto que não abrem barram o envio antes de criar o envelope", () => {
  const sem = cenario({ props: { MODELO_MEMORIAL_ID: "nao-existe" } });
  sem.gerarFinal();
  assert.equal(sem.acao("assinaturaEnviar", rub(sem)).erro, "MEMORIAL_NAO_CONFIGURADO");
  const proj = cenario({ props: { PROJETO_APROVADO_ID: "nao-existe" } });
  proj.gerarFinal();
  assert.equal(proj.acao("assinaturaEnviar", rub(proj)).erro, "PROJETO_NAO_CONFIGURADO");
  const sobra = cenario({ modelosExtra: { "modelo-memorial": ["{{OUTRO}}"] }, props: { MODELO_MEMORIAL_ID: "modelo-memorial" } });
  sobra.gerarFinal();
  assert.equal(sobra.acao("assinaturaEnviar", rub(sobra)).erro, "MODELO_COM_MARCADOR_SOBRANDO");
  for (const x of [sem, proj, sobra]) assert.equal(x.c.chamadas.length, 0);
});

/* ---- 30/10: desconto no Alterar fluxo (arquivo 17, item 1) ---- */
test("30/10 desconto: fluxoEditar traz a comissão só para quem muda o preço; R$ dos balões salva e o contrato recalcula", () => {
  assert.equal(cenarioFluxo().acao("fluxoEditar").desconto, null, "quem não muda o valor da casa não vê desconto");
  const c = cenarioFluxo({ props: { FLUXO_PRECO_USUARIOS: "ana.teste" } });
  const e = c.acao("fluxoEditar");
  assert.equal(e.desconto.isencaoLiberada, false);
  assert.ok(e.desconto.comissao.valor > 0, JSON.stringify(e.desconto));
  const r = FluxoLivre.aplicarDesconto(e.atual, 5000, "baloes");
  const ok = c.acao("salvarFluxo", { fluxo: r, motivo: "desconto à vista", motivoPreco: "aprovado", desconto: "R$ 5.000,00 dos balões" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const g = JSON.parse(c.txt("FLUXO PERSONALIZADO"));
  assert.equal(g.valor, 300000);
  assert.equal(g.semComissao, undefined);
  assert.equal(c.acao("fluxoEditar").historico.at(-1).desconto, "R$ 5.000,00 dos balões");
  const pre = c.acao("gerarPreContrato");
  assert.equal(pre.ok, true, JSON.stringify(pre));
});

test("30/10 isenção da comissão: travada até FLUXO_ISENCAO_LIBERADA; liberada, salva semComissao e o contrato só sai com o bloco no modelo", () => {
  const c = cenarioFluxo({ props: { FLUXO_PRECO_USUARIOS: "ana.teste" } });
  const e = c.acao("fluxoEditar");
  const com = e.desconto.comissao.valor;
  const r = FluxoLivre.aplicarDesconto(e.atual, com, "entrada");
  const isento = { ...r, semComissao: true };
  const p = { fluxo: isento, motivo: "venda direta a fornecedor", motivoPreco: "isenção da comissão" };
  assert.equal(c.acao("salvarFluxo", p).erro, "FLUXO_ISENCAO_AGUARDANDO_MODELO");
  assert.equal(c.txt("FLUXO PERSONALIZADO"), "", "nada gravado");
  const sem = cenarioFluxo({ props: { FLUXO_ISENCAO_LIBERADA: "1" } });
  assert.equal(sem.acao("salvarFluxo", p).erro, "FLUXO_PRECO_SEM_PERMISSAO", "isenção só para quem muda o preço");
  const lib = cenarioFluxo({ props: { FLUXO_PRECO_USUARIOS: "ana.teste", FLUXO_ISENCAO_LIBERADA: "1" } });
  const ok = lib.acao("salvarFluxo", p);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(JSON.parse(lib.txt("FLUXO PERSONALIZADO")).semComissao, true);
  assert.equal(lib.acao("fluxoEditar").atual.semComissao, true);
  assert.equal(lib.acao("fluxoEditar").desconto.comissao.valor, 0);
  /* o modelo de hoje não tem {{#SEM_COMISSAO}}: o contrato não sai com a comissão errada */
  assert.equal(lib.acao("gerarPreContrato").erro, "MODELO_SEM_BLOCO_SEM_COMISSAO");
});

test("30/10 histórico do contrato: ação que grava deixa linha com quem fez; contratoEstado devolve", () => {
  const c = cenario({ linha: { "HISTÓRICO DO CONTRATO": rt(""), "CONTRATO - CONDIÇÕES ESPECIAIS": rt("") } });
  const r = c.acao("salvarCondicoesEspeciais", { texto: "Na cláusula 9.2, onde se lê 30 dias, leia-se 45 dias." });
  assert.equal(r.ok, true, JSON.stringify(r));
  const h = c.acao("contratoEstado").historico;
  assert.equal(h.length, 1);
  assert.match(h[0], /^\S+ \S+ — .+ — condições especiais \(item 16\): Na cláusula 9\.2/);
});

/* 31/10/2026 (dono): o quadro "Link para completar" do Resumo só aparece com falta obrigatória do cliente — o estado do
   contrato traz as mesmas faltas do gerador, só as dos compradores, cônjuges e fiadores */
test("31/10: contratoEstado traz faltasCliente (fiador sem nome/CPF) e nada interno (vendedor, fluxo)", () => {
  const sem = cenarioCfd({ linha: { "FIADOR 2": rt(""), "CPF FIADOR 2": rt("") } }).acao("contratoEstado");
  assert.ok(sem.faltasCliente.length > 0, JSON.stringify(sem.faltasCliente));
  assert.ok(sem.faltasCliente.every((t) => /^Fiador 2/.test(t)), JSON.stringify(sem.faltasCliente));
  const completo = cenarioCfd().acao("contratoEstado");
  assert.deepEqual(completo.faltasCliente, []);
});

/* ---- 01/11 H7: Andamento salva em segundo plano (vendas.html, condAndSalvar) ---- */
import fsH7 from "node:fs";
import pathH7 from "node:path";
import { fileURLToPath as fuH7 } from "node:url";
function montarAndamento() {
  const raiz = pathH7.join(pathH7.dirname(fuH7(import.meta.url)), "..", "..");
  const src = fsH7.readFileSync(pathH7.join(raiz, "vendas.html"), "utf8");
  const ini = src.indexOf("const CD_AND_CEL=");
  const fim = src.indexOf("/* 02/10 (item 20)", ini);
  assert.ok(ini > 0 && fim > ini, "condAndSalvar não encontrada");
  const corpo = src.slice(ini, fim);
  const els = {};
  /* el(): campo (ou status, id terminado em -st) da venda "L1" por padrão; o atributo data-and-* leva a chave id|coluna */
  const PROPS = ["ITBI PAGO", "ENTREGOU"];
  const el = (id, value, venda = "L1") => {
    const m = /^cd-and-(\d+)(-st)?$/.exec(id);
    const attr = m[2] ? "data-and-st" : "data-and-key";
    const attrs = { [attr]: venda + "|" + PROPS[Number(m[1])] };
    return (els[id] = { id, value, style: {}, textContent: "", attrs, getAttribute: (a) => (a in attrs ? attrs[a] : null) });
  };
  const estado = { renders: 0, chamadas: [], pend: [] };
  const COND = { colunas: [{ nome: "ITBI PAGO", tipo: "select" }, { nome: "ENTREGOU", tipo: "checkbox" }],
    linhas: [{ id: "L1", v: { "ITBI PAGO": "NÃO", ENTREGOU: false } }] };
  const chamar = (p) => new Promise((res) => { estado.chamadas.push(p); estado.pend.push(res); });
  const f = new Function("document", "chamar", "COND", "condRender", "cdVal", "window",
    corpo + "; return condAndSalvar;")(
    { getElementById: (i) => els[i] || null,
      querySelectorAll: (sel) => Object.values(els).filter((e) => e.attrs && sel.slice(1, -1) in e.attrs) }, chamar, COND, () => { estado.renders++; },
    (l, n) => (l && l.v && n in l.v ? l.v[n] : null),
    { addEventListener: (ev, fn) => { if (ev === "beforeunload") estado.antesDeSair = fn; } });
  return { f, els, el, estado, COND };
}
const espera = () => new Promise((r) => setImmediate(r));

test("H7: ao mudar o SIM/NÃO a célula e o estado local já mostram o valor novo, antes da resposta; sucesso não redesenha", async () => {
  const { f, el, estado, COND } = montarAndamento();
  const c = el("cd-and-0", "SIM"); const st = el("cd-and-0-st", "");
  const p = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
  assert.equal(COND.linhas[0].v["ITBI PAGO"], "SIM", "estado local já novo");
  assert.equal(c.value, "SIM");
  assert.match(st.textContent, /salvando/);
  assert.equal(estado.chamadas.length, 1);
  estado.pend[0]({ ok: true, linha: { id: "L1", v: { "ITBI PAGO": "SIM", OUTRA: "x" } } });
  await p;
  assert.equal(estado.renders, 0, "não redesenha o cartão inteiro");
  assert.match(st.textContent, /salvo/);
  assert.equal(COND.linhas[0].v.OUTRA, "x", "campos recalculados pelo servidor entram no estado local");
});

test("H7: com erro, volta só aquela célula ao valor antigo e avisa 'Não salvou: <motivo>' (mensagem, erro, sem conexão)", async () => {
  for (const [resp, motivo] of [[{ ok: false, mensagem: "Faltou a data", erro: "X" }, "Faltou a data"], [{ ok: false, erro: "NOTION_429" }, "NOTION_429"], [null, "sem conexão"]]) {
    const { f, el, estado, COND } = montarAndamento();
    const c = el("cd-and-0", "SIM"); const st = el("cd-and-0-st", ""); const outra = el("cd-and-1", "SIM");
    const p = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
    estado.pend[0](resp); await p;
    assert.equal(c.value, "NÃO", "voltou o valor antigo");
    assert.equal(COND.linhas[0].v["ITBI PAGO"], "NÃO");
    assert.equal(outra.value, "SIM", "outra célula intocada");
    assert.equal(st.textContent, "Não salvou: " + motivo);
    assert.equal(estado.renders, 0);
  }
});

test("H7: um envio por célula: A->B voando, B->C só sai depois que B volta; vale o último", async () => {
  const { f, el, estado, COND } = montarAndamento();
  const c = el("cd-and-0", "SIM"); const st = el("cd-and-0-st", "");
  const p1 = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
  c.value = "NÃO";
  const p2 = f("L1", "ITBI PAGO", "NÃO", "cd-and-0-st");
  c.value = "TALVEZ";
  const p3 = f("L1", "ITBI PAGO", "TALVEZ", "cd-and-0-st");
  assert.equal(estado.chamadas.length, 1, "só um envio no ar");
  assert.equal(COND.linhas[0].v["ITBI PAGO"], "TALVEZ");
  estado.pend[0]({ ok: true, linha: { id: "L1", v: { "ITBI PAGO": "SIM" } } });
  await espera();
  assert.equal(estado.chamadas.length, 2, "agora vai o mais novo (os intermediários se juntam)");
  assert.equal(estado.chamadas[1].valor, "TALVEZ");
  assert.match(st.textContent, /salvando/);
  estado.pend[1]({ ok: true, linha: { id: "L1", v: { "ITBI PAGO": "TALVEZ" } } });
  await Promise.all([p1, p2, p3]);
  assert.equal(COND.linhas[0].v["ITBI PAGO"], "TALVEZ");
  assert.equal(c.value, "TALVEZ");
  assert.match(st.textContent, /salvo/);
});

test("H7: A->B voando e B->C: se B falha, segue com C sem desfazer; se C falha, volta ao último confirmado (B)", async () => {
  const { f, el, estado, COND } = montarAndamento();
  const c = el("cd-and-0", "SIM"); const st = el("cd-and-0-st", "");
  const p = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
  c.value = "TALVEZ"; f("L1", "ITBI PAGO", "TALVEZ", "cd-and-0-st");
  estado.pend[0]({ ok: false, erro: "falhou" });
  await espera();
  assert.equal(c.value, "TALVEZ", "B falhou mas há C esperando: nada desfeito");
  assert.equal(estado.chamadas.length, 2);
  estado.pend[1]({ ok: false, mensagem: "Sem permissão" });
  await p;
  assert.equal(c.value, "NÃO", "voltou ao último confirmado (o original)");
  assert.equal(COND.linhas[0].v["ITBI PAGO"], "NÃO");
  assert.equal(st.textContent, "Não salvou: Sem permissão");
});

test("H7: B confirmado e C falha: a célula volta a B, não a A", async () => {
  const { f, el, estado, COND } = montarAndamento();
  const c = el("cd-and-0", "SIM"); const st = el("cd-and-0-st", "");
  const p = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
  c.value = "TALVEZ"; f("L1", "ITBI PAGO", "TALVEZ", "cd-and-0-st");
  estado.pend[0]({ ok: true, linha: { id: "L1", v: { "ITBI PAGO": "SIM" } } });
  await espera();
  estado.pend[1]({ ok: false, erro: "NOTION_429" });
  await p;
  assert.equal(c.value, "SIM");
  assert.equal(COND.linhas[0].v["ITBI PAGO"], "SIM");
  assert.equal(st.textContent, "Não salvou: NOTION_429");
});

test("H7: células diferentes salvam em paralelo; erro de uma não mexe na outra", async () => {
  const { f, el, estado, COND } = montarAndamento();
  el("cd-and-0", "SIM"); el("cd-and-0-st", "");
  const c2 = el("cd-and-1", "SIM"); const st2 = el("cd-and-1-st", "");
  const p1 = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
  const q = f("L1", "ENTREGOU", "SIM", "cd-and-1-st");
  assert.equal(estado.chamadas.length, 2, "paralelo");
  estado.pend[0]({ ok: true, linha: { id: "L1", v: { "ITBI PAGO": "SIM" } } }); await p1;
  estado.pend[1]({ ok: false, mensagem: "Sem permissão" }); await q;
  assert.equal(c2.value, "NÃO");
  assert.equal(COND.linhas[0].v.ENTREGOU, false);
  assert.equal(COND.linhas[0].v["ITBI PAGO"], "SIM");
  assert.equal(st2.textContent, "Não salvou: Sem permissão");
});

test("H7: beforeunload só avisa enquanto há envio pendente", async () => {
  const { f, el, estado } = montarAndamento();
  el("cd-and-0", "SIM"); el("cd-and-0-st", "");
  assert.equal(typeof estado.antesDeSair, "function", "handler registrado");
  const ev0 = { preventDefault() { this.parado = true; } };
  estado.antesDeSair(ev0);
  assert.ok(!ev0.parado && !ev0.returnValue, "sem pendência não pergunta");
  const p = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
  const ev1 = { preventDefault() { this.parado = true; } };
  estado.antesDeSair(ev1);
  assert.ok(ev1.parado);
  assert.equal(ev1.returnValue, "Ainda está salvando. Sair mesmo assim?");
  estado.pend[0]({ ok: true }); await p;
  const ev2 = { preventDefault() { this.parado = true; } };
  estado.antesDeSair(ev2);
  assert.ok(!ev2.parado && !ev2.returnValue, "depois de salvar, não pergunta");
});

test("H7: troca de cartão com envio no ar: resposta (ok ou erro) não toca o campo da outra venda; ao reabrir o estado é o certo", async () => {
  for (const ok of [true, false]) {
    const { f, el, els, estado, COND } = montarAndamento();
    COND.linhas.push({ id: "L2", v: { "ITBI PAGO": "TALVEZ", ENTREGOU: true } });
    el("cd-and-0", "SIM"); el("cd-and-0-st", "");
    const p = f("L1", "ITBI PAGO", "SIM", "cd-and-0-st");
    /* o usuário abre a venda L2: os mesmos ids posicionais agora são dela */
    delete els["cd-and-0"]; delete els["cd-and-0-st"];
    const c2 = el("cd-and-0", "TALVEZ", "L2"); const st2 = el("cd-and-0-st", "", "L2");
    estado.pend[0](ok ? { ok: true, linha: { id: "L1", v: { "ITBI PAGO": "SIM" } } } : { ok: false, erro: "falhou" });
    await p;
    assert.equal(c2.value, "TALVEZ", "campo da outra venda intocado");
    assert.equal(st2.textContent, "", "status da outra venda intocado");
    assert.equal(COND.linhas[1].v["ITBI PAGO"], "TALVEZ");
    assert.equal(COND.linhas[0].v["ITBI PAGO"], ok ? "SIM" : "NÃO", "estado local da L1 certo para quando reabrir");
  }
});

test("H7: o texto de status quebra palavra longa (375 px)", () => {
  const raiz = pathH7.join(pathH7.dirname(fuH7(import.meta.url)), "..", "..");
  const src = fsH7.readFileSync(pathH7.join(raiz, "vendas.html"), "utf8");
  assert.match(src, /\.cd-and \.st\{[^}]*overflow-wrap:anywhere/);
});
