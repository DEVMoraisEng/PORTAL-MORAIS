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
  "PRÉ-RESERVA - ENVELOPE ID": texto(""), "PRÉ-RESERVA - SITUAÇÃO": texto(""), "CONDOMÍNIO": sel("RESERVA DOS IPÊS") };

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
  const despachos = [];
  const p = Object.assign({
    NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO, DB_VENDAS_COND: DB_COND,
    DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr", DB_DOCUMENTOS: "db-doc",
    MODELO_PRONTO_ID: "modelo-pronto", MODELO_CONSTRUCAO_ID: "modelo-obra", MODELO_CONDOMINIO_ID: "modelo-cond", PASTA_PROVISORIA_ID: "pasta-prov",
    MODELO_PRE_RESERVA_ID: "modelo-pr", PRE_RESERVA_VALOR: "3000", PRE_RESERVA_DATA_LIMITE: "2026-10-31",
    CLICKSIGN_TOKEN: "token-clicksign-de-teste",
    ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify(TEST_SPE), ASSINATURA_TESTEMUNHAS_PF: JSON.stringify(TEST_PF),
    GITHUB_TOKEN: "gh-teste", GH_REPO_MC: "Org-Teste/REPO-TESTE",
  }, props);
  const g = criarGas({ props: p, extras: d.extras, rotas: (url, opt) => {
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
  const est0 = c.acao("contratoEstado"); delete est0.testemunhas; delete est0.conta; delete est0.condicoes; delete est0.fluxo;   /* testemunhas, conta de recebimento e condições especiais têm testes próprios */
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
  /* preço mudou sem mexer na comissão: a regra (21/10) também acusa */
  assert.deepEqual(r.faltas, ["Fluxo de pagamento: soma R$ 305.000,00 e não fecha com o valor de venda R$ 310.000,00",
    "Comissão: R$ 13.725,00 na venda, mas a regra (prazo da entrada de 48 meses = 4,5%) dá R$ 13.950,00"]);
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
  assert.deepEqual(c.acao("preReservaEstado"), { ok: true, conta: "", contaCampos: { forma: "", livre: "" }, gerado: false, nome: "", valor: 3000, dataLimite: "2026-10-31" });
  const sem = c.acao("gerarTermoPreReserva");
  assert.equal(sem.erro, "FALTAM_DADOS");
  assert.deepEqual(sem.faltas, ["Conta para devolução (preencha no cartão)"]);
  assert.equal(c.acao("salvarContaPreReserva", { conta: "abc" }).erro, "FORMA_CONTA");
  assert.deepEqual(c.acao("salvarContaPreReserva", { conta: { forma: "PIX", chave: "529.982.247-25", banco: "756 - SICOOB" } }),
    { ok: true, conta: "PIX, chave 529.982.247-25, no banco 756 - SICOOB", contaCampos: { forma: "PIX", chave: "529.982.247-25", banco: "756 - SICOOB" } });
  assert.equal(c.txt("PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO"), "PIX, chave 529.982.247-25, no banco 756 - SICOOB");
  const r = c.acao("gerarTermoPreReserva");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.nome, /^TERMO DE PRÉ-RESERVA - CONDOMÍNIO RESERVA DOS IPÊS - CASA 13 - .* \[#[0-9a-f]{8}\]\.pdf$/);
  const pars = c.d.estado.salvos[c.d.estado.copias[0].id].pars;
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

test("termo: conta mudada depois de gerar = CONTRATO_DESATUALIZADO; perfil TESTES não grava", () => {
  const c = cenarioPR({ linha: { "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO": texto("PIX, chave 529.982.247-25, no banco 756 - SICOOB") } });
  assert.equal(c.acao("gerarTermoPreReserva").ok, true);
  c.n.pagina.properties["PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO"] = { type: "rich_text", rich_text: [{ plain_text: "PIX, chave outra-chave, no banco 001 - BB" }] };
  assert.equal(c.acao("assinaturaEnviar", { doc: "PRE_RESERVA" }).erro, "CONTRATO_DESATUALIZADO");
  for (const action of ["gerarTermoPreReserva", "salvarContaPreReserva"])
    assert.equal(c.acao(action, { conta: "conta de teste" }, token("TESTES")).erro, "SEM_PERMISSAO_TESTES", action);
  assert.equal(c.acao("preReservaEstado", {}, token("TESTES")).ok, true);
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

test("28/10: Clicksign — contrato e termos no MESMO envelope; fiadores assinam só os termos; termos assinados nas colunas deles", () => {
  const c = cenarioCfd({ cs: { arquivos: { original: "https://s3.clicksign.falso/original.pdf", signed: "https://s3.clicksign.falso/assinado.pdf" } } });
  assert.equal(c.gerarFinal().ok, true);
  const r = c.acao("assinaturaEnviar");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.signatarios.map((s) => s.papel).slice(-2), ["Fiador 1", "Fiador 2"]);
  const docs = c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/documents");
  assert.equal(docs.length, 3);
  assert.ok(docs[1].corpo.data.attributes.filename.startsWith("CONFISSÃO PRÉ-CHAVES - ") && !/\[#/.test(docs[1].corpo.data.attributes.filename));
  const sigs = c.c.estado.signers, fiador = sigs.find((s) => s.attributes.email === "f1@teste.example");
  const reqs = c.c.chamadas.filter((x) => x.metodo === "POST" && x.caminho === "/envelopes/env-1/requirements");
  const docsDo = (id) => [...new Set(reqs.filter((q) => q.corpo.data.relationships.signer.data.id === id).map((q) => q.corpo.data.relationships.document.data.id))].sort();
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
  const c = cenarioCfd({ linha: { "EMAIL FIADOR 2": eml("") } });
  assert.equal(c.gerarFinal().ok, true);
  const r = c.acao("assinaturaEnviar");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.some((f) => /^Fiador 2: e-mail/.test(f)), r.faltas.join(" | "));
  const semModelo = cenario({ linha: COLS_CFD });
  const g = semModelo.gerarFinal();
  assert.equal(g.ok, true);
  assert.equal(g.termos, undefined);
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
  assert.ok(pre.avisos.some((a) => /^Conferência dos documentos: 1 divergência e 1 item sem conferir/.test(a)), pre.avisos.join(" | "));
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

test("29/10 fluxo: salva só com a conta fechando e com motivo; grava a lista, o histórico e trava o contrato até a etapa 2", () => {
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
  const pre1 = c.acao("gerarPreContrato");
  assert.equal(pre1.erro, "FALTAM_DADOS");
  assert.match(pre1.faltas[0], /fluxo alterado ainda não está disponível/);
  const h = c.acao("fluxoEditar");
  assert.equal(h.alterado, true);
  assert.equal(h.atual.linhas.length, 12);
  assert.deepEqual(h.historico.map((x) => [x.por, x.motivo, x.voltou]), [["ana.teste", "cliente pediu mais um balão e parcelas menores", false]]);
  assert.ok(!("antes" in h.historico[0]), "a tela não recebe os fluxos antigos inteiros");
  /* voltar ao fluxo da proposta: limpa a coluna e o contrato volta a gerar */
  assert.equal(c.acao("salvarFluxo", { voltar: true, motivo: "cliente desistiu da mudança" }).ok, true);
  assert.equal(c.txt("FLUXO PERSONALIZADO"), "");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(c.acao("salvarFluxo", { voltar: true, motivo: "de novo" }).erro, "FLUXO_JA_E_O_DA_PROPOSTA");
  assert.equal(c.acao("fluxoEditar").historico.length, 2);
});

test("29/10 fluxo: valor da casa só muda com quem está em FLUXO_PRECO_USUARIOS, e pede o segundo motivo", () => {
  const sem = cenarioFluxo();
  const b0 = sem.acao("fluxoEditar");
  assert.equal(b0.podePreco, false);
  const desconto = (atual) => ({ valor: 300000, linhas: atual.linhas.map((l) => (l.t === "balao" && l.v > 8000 ? { ...l, v: l.v - 5000 } : l)) });
  assert.equal(sem.acao("salvarFluxo", { fluxo: desconto(b0.atual), motivo: "desconto", motivoPreco: "x" }).erro, "FLUXO_PRECO_SEM_PERMISSAO");
  const c = cenarioFluxo({ props: { FLUXO_PRECO_USUARIOS: "julio.cesar, Ana.Teste" } });
  const base = c.acao("fluxoEditar").atual;
  assert.equal(c.acao("fluxoEditar").podePreco, true);
  const f = desconto(base);
  const r = c.acao("salvarFluxo", { fluxo: f, motivo: "desconto" });
  assert.equal(r.erro, "CAMPOS_INVALIDOS");
  assert.match(r.erros[0], /R\$ 305\.000,00 → R\$ 300\.000,00/);
  assert.equal(c.acao("salvarFluxo", { fluxo: f, motivo: "desconto", motivoPreco: "aprovado pelo diretor" }).ok, true);
  assert.equal(JSON.parse(c.txt("FLUXO PERSONALIZADO")).valor, 300000);
});

test("29/10 fluxo: o servidor recusa mexer no financiamento e na quantidade de pós-chaves", () => {
  const c = cenarioFluxo();
  const base = c.acao("fluxoEditar").atual;
  const fin = { valor: base.valor, linhas: base.linhas.map((l) => (l.t === "fin" ? { ...l, v: l.v - 1000 } : l.t === "sinal" && l.v === 1000 ? { ...l, v: 2000 } : l)) };
  const r1 = c.acao("salvarFluxo", { fluxo: fin, motivo: "x" });
  assert.equal(r1.erro, "CAMPOS_INVALIDOS");
  assert.match(r1.erros.join(";"), /não mudam/);
  const pos = { valor: base.valor, linhas: base.linhas.map((l) => (l.t === "pos" ? { ...l, n: 12, v: l.v * 2 } : l)) };
  assert.match(c.acao("salvarFluxo", { fluxo: pos, motivo: "x" }).erros.join(";"), /24 parcelas/);
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
