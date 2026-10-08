/* gerarContrato / contratoEstado (GerarContrato.gs) com Notion, DocumentApp, DriveApp e Drive falsos.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, driveFalso, notionFalso, assinar, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const CV = createRequire(import.meta.url)("../ContratoVenda.js");
const DIA = 86400000;
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + DIA });
const PAGE = PAGE_ID_PADRAO, OBRA = "fedcba9876543210fedcba9876543210";

const tit = (s) => ({ title: [{ type: "text", plain_text: s, text: { content: s } }] });
const sel = (s) => ({ select: s === null ? null : { name: s } });
const num = (n) => ({ number: n });
const dat = (s) => ({ date: { start: s } });
const rel = (id) => ({ relation: [{ id }] });
const rt = texto;

const PROPS = {
  NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO,
  DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr", DB_DOCUMENTOS: "db-doc",
  MODELO_PRONTO_ID: "modelo-pronto", MODELO_CONSTRUCAO_ID: "modelo-obra", PASTA_PROVISORIA_ID: "pasta-prov",
};

/* Colunas da base VENDAS: dossiê + venda + as 20 do contrato (tipos vindos do módulo). */
function colunasVenda(sem = []) {
  const c = Object.assign({}, COLUNAS_REAIS, {
    " VALOR NA MÃO ": "number", "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": "number", " COMISSÃO ": "number",
    "DATA DA VENDA": "date", CORRETOR: { tipo: "select", opcoes: ["Corretor Teste"] },
    SETOR: { tipo: "select", opcoes: ["Setor Teste"] }, "OBRA-AUTO": "relation", CASA: "rich_text",
  });
  for (const [nome, tipo] of Object.entries(CV.TIPOS))
    c[nome] = tipo === "select" ? { tipo, opcoes: ["PIX", "TRANSFERÊNCIA", "DEPÓSITO", "COMPRADOR", "VENDEDOR"] } : tipo;
  for (const s of sem) delete c[s];
  return c;
}

const MODELO_OBRA = [
  "Contrato de {{LOTEAMENTO}} em {{MUNICIPIO_UF}}",
  "{{#SE_VENDEDOR_PJ}}", "PJ: {{VENDEDOR_NOME}} representada por {{REPRESENTANTE_NOME}}", "{{/SE_VENDEDOR_PJ}}",
  "{{#SE_VENDEDOR_PF}}", "PF: {{VENDEDOR_NOME}}, {{VENDEDOR_PROFISSAO}}", "{{/SE_VENDEDOR_PF}}",
  "{{#SE_CASAL}}", "Só casal", "{{/SE_CASAL}}",
  "Compradores: {{COMPRADORES}}",
  "Confrontações: {{CONFRONTACOES}}",
  "{{#SE_INTERMEDIARIA}}", "Intermediária {{INTERMEDIARIA_VALOR}} em {{INTERMEDIARIA_VENCIMENTO}}", "{{/SE_INTERMEDIARIA}}",
  "{{#SEM_INTERMEDIARIA}}", "Não há intermediária.", "{{/SEM_INTERMEDIARIA}}",
  "Valor: {{VALOR_TOTAL}} ({{VALOR_TOTAL_EXTENSO}})",
  "Banco: {{BANCO}} – Agência: {{AGENCIA}} – Operação: {{OPERACAO}} – Conta {{CONTA}} – PIX: {{PIX}} - Titularidade da VENDEDORA",
  "{{CIDADE_DATA}}",
  "{{#SE_COMISSAO_VENDEDOR}}", "Comissão paga pelo vendedor {{COMISSAO_RESPONSAVEL}}", "{{/SE_COMISSAO_VENDEDOR}}",
];
const MODELO_PRONTO = ["MODELO PRONTO", ...MODELO_OBRA];

const VENDA = {
  "ENDEREÇO": tit("RESIDENCIAL TESTE QD 07 LT 12"), CASA: rt("3"),
  "CLIENTES ": rt("Fulano de Teste"), "CPF ": rt("000.000.001-91"),
  "COMPRADOR 1 - DOCUMENTO": rt("RG 1234567 SSP/GO"), "COMPRADOR 1 - NACIONALIDADE": rt("brasileiro"),
  "COMPRADOR 1 - ESTADO CIVIL": rt("solteiro"), "COMPRADOR 1 - PROFISSÃO": rt("analista"),
  "COMPRADOR 1 - ENDEREÇO": rt("Rua das Palmeiras, 10, Setor Teste"),
  "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(300000), " COMISSÃO ": num(9000), " VALOR NA MÃO ": num(291000),
  CORRETOR: sel("Corretor Teste"), SETOR: sel("Setor Teste"), "OBRA-AUTO": rel(OBRA),
  "CONTRATO - ALVARÁ Nº": rt("AL-77"), "CONTRATO - ALVARÁ DATA": dat("2026-03-10"),
  "CONTRATO - MATRÍCULA INDIVIDUAL": rt("M-9001"), "CONTRATO - CRI DA MATRÍCULA": rt("1º CRI de Teste"),
  "CONTRATO - ÁREA DO LOTE (M²)": num(250), "CONTRATO - CONFRONTAÇÕES": rt("Norte: lote 11; Sul: lote 13"),
  "CONTRATO - SINAL VALOR": num(10000), "CONTRATO - SINAL DATA": dat("2026-10-01"),
  "CONTRATO - ENTRADA VALOR": num(20000), "CONTRATO - ENTRADA VENCIMENTO": dat("2026-10-15"),
  "CONTRATO - FORMA DE PAGAMENTO": sel("PIX"), "CONTRATO - COMISSÃO FORMA": sel("PIX"),
  "CONTRATO - COMISSÃO VENCIMENTO": rt("na assinatura do financiamento"), "CONTRATO - COMISSÃO PAGA POR": sel("COMPRADOR"),
  "DATA DA ENTREGA": dat("2027-06-30"),
};
const OBRA_PG = {
  "PROPRIETARIO DOCUMENTO": rt("Construtora Teste Ltda"), "CPF/CNPJ ": sel("00.000.000/0001-00"),
  "OBRA FINALIZADA?": sel("NÃO"), "CIDADE ": rt("Cidade Teste"), "DATA HABITE-SE": dat("2026-08-01"),
};
const VENDEDOR = {
  NOME: tit("Construtora Teste Ltda"), TIPO: sel("PJ"), "CPF/CNPJ": rt("00.000.000/0001-00"), "ENDEREÇO / SEDE": rt("Av. Teste, 100"),
  "REPRESENTANTE NOME": rt("Beltrano Representante"), "REPRESENTANTE CPF": rt("000.000.002-72"),
  "REPRESENTANTE RG": rt("RG 7654321 SSP/GO"), "REPRESENTANTE NACIONALIDADE": rt("brasileiro"), "REPRESENTANTE ESTADO CIVIL": rt("casado"),
  BANCO: rt("Banco Teste"), "AGÊNCIA": rt("0001"), "OPERAÇÃO": rt("013"), CONTA: rt("12345-6"), PIX: rt("pix@teste.example"),
};
const LOTEAMENTO = {
  SETOR: tit("Setor Teste"), "DENOMINAÇÃO": rt("Residencial Teste"), "MUNICÍPIO/UF": rt("Cidade Teste/GO"),
  "MATRÍCULA DO LOTEAMENTO": rt("M-100"), "CARTÓRIO": rt("Cartório Teste"),
  "PRAZO POSSE (DIAS)": num(30), "PRAZO CHAVES (DIAS ÚTEIS)": rt("60"),
};
const CORRETOR = { NOME: tit("Corretor Teste"), CRECI: rt("CRECI 123"), "CPF/CNPJ": rt("000.000.003-53") };

const mescla = (base, mud) => {
  const r = Object.assign({}, base);
  for (const [k, v] of Object.entries(mud || {})) { if (v === null) delete r[k]; else r[k] = v; }
  return r;
};

function cenario({ venda, obra, vendedor, loteamento, corretor, props, drive, colunas, semBases = [], rotaExtra, obraDb = "db-doc", linhasDoc, duplicar = {} } = {}) {
  const d = driveFalso(Object.assign({ modelos: { "modelo-obra": MODELO_OBRA, "modelo-pronto": MODELO_PRONTO } }, drive));
  const bases = { "db-vend": [mescla(VENDEDOR, vendedor)], "db-lote": [mescla(LOTEAMENTO, loteamento)], "db-corr": [mescla(CORRETOR, corretor)],
    "db-doc": linhasDoc || [Object.assign({ "ENDEREÇO": tit("RESIDENCIAL TESTE QD 07 LT 12") }, mescla(OBRA_PG, obra))] };
  for (const [base, mud] of Object.entries(duplicar)) bases[base].push(mescla(bases[base][0], mud === true ? {} : mud));
  const cols = colunas || colunasVenda();
  const valores = Object.fromEntries(Object.entries(mescla(VENDA, venda)).filter(([k]) => k in cols));
  const n = notionFalso({ colunas: cols, valores, paginasExtras: { [OBRA]: mescla(OBRA_PG, obra) }, paginasDb: { [OBRA]: obraDb }, bases });
  const rotas = rotaExtra ? (url, opt) => rotaExtra(url, opt) || n.rota(url, opt) : n.rota;
  const p = Object.assign({}, PROPS, props);
  for (const s of semBases) delete p[s];
  const g = criarGas({ props: p, rotas, extras: d.extras });
  const acao = (action, tok = tokenDe()) => g.chamar({ action, token: tok, pageId: PAGE });
  const arquivos = () => n.pagina.properties["CONTRATO GERADO"].files;
  const pdfTexto = () => {
    const f = arquivos().at(-1);
    return n.uploads[f.file.url.split("/").pop()].buf.toString("utf8");
  };
  /* desde a entrega 9 o contrato final só sai de um pré-contrato conferido: gerar = pré-contrato +
     "Conferi"; os registros do Drive falso são zerados entre os dois (os testes antigos olham só o final) */
  const gerar = (tok) => {
    const pre = acao("gerarPreContrato", tok);
    if (!pre.ok) return pre;
    d.zerar();
    return acao("aprovarPreContrato", tok);
  };
  return { g, n, d, p, acao, arquivos, pdfTexto, gerar };
}

const ANTIGO = { files: [{ name: "antigo.pdf", type: "file", file: { url: "https://s3.falso/velho" } }] };
const DADOS_PESSOAIS = ["Fulano", "Sicrana", "Beltrano", "Construtora", "000.000", "Investidor", "pix@teste", "12345-6"];

test("carimbo no nome do PDF: SHA-256 (8 hex) dos dados do contrato; muda quando comprador, vendedor ou valor mudam", () => {
  const carimbo = (mud) => { const r = cenario(mud).gerar(); assert.equal(r.ok, true, JSON.stringify(r)); return /\[#([0-9a-f]{8})\]\.pdf$/.exec(r.nome)[1]; };
  const base = carimbo({});
  assert.equal(carimbo({}), base, "mesmos dados, mesmo carimbo");
  assert.notEqual(carimbo({ venda: { "COMPRADOR 1 - PROFISSÃO": rt("engenheiro") } }), base, "comprador");
  assert.notEqual(carimbo({ vendedor: { "REPRESENTANTE NOME": rt("Outro Representante") } }), base, "representante");
  assert.notEqual(carimbo({ venda: { "CONTRATO - SINAL VALOR": num(12000) } }), base, "valor");
  const c = cenario();
  assert.equal(c.g.ctx.ctrCarimboDoNome_("CONTRATO - X - 01-10-2026 [#" + base + "].pdf"), base);
  assert.equal(c.g.ctx.ctrCarimboDoNome_("CONTRATO - X - 01-10-2026.pdf"), "");
});

test("sucesso: PDF em CONTRATO GERADO substitui o anterior, sem marcadores, cópia removida", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.nome, /^CONTRATO - RESIDENCIAL TESTE QD 07 LT 12 - CASA 3 - \d\d-\d\d-\d{4} \[#[0-9a-f]{8}\]\.pdf$/);
  assert.ok(r.url);
  const arqs = c.arquivos();
  assert.equal(arqs.length, 1);
  assert.equal(arqs[0].name, r.nome);
  const t = c.pdfTexto();
  assert.ok(!t.includes("{{"), t);
  assert.ok(t.includes("Contrato de Residencial Teste em Cidade Teste/GO"));
  assert.ok(t.includes("PJ: Construtora Teste Ltda representada por Beltrano Representante"));
  assert.ok(t.includes("Valor: R$ 300.000,00 (trezentos mil reais)"));
  assert.ok(!t.includes("PF:") && !t.includes("Só casal") && !t.includes("Comissão paga pelo vendedor"));
  assert.ok(t.includes("Não há intermediária.") && !t.includes("Intermediária "));
  /* cópia criada na pasta provisória, exportada e apagada de vez */
  assert.equal(c.d.estado.copias.length, 1);
  assert.equal(c.d.estado.copias[0].pasta, "pasta-prov");
  assert.match(c.d.estado.copias[0].nome, /^contrato-provisorio-01234567-\d+$/);
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
  assert.deepEqual(c.d.estado.lixeira, []);
  assert.deepEqual(c.d.docs["modelo-obra"].salvo, MODELO_OBRA);
});

test("casal: os dois qualificados, separados por '; e '", () => {
  const c = cenario({ venda: {
    "CLIENTES ": rt("Fulano de Teste e Sicrana de Teste"), "COMPRADOR 2 - NOME": rt("Sicrana de Teste"), "COMPRADOR 2 - CPF": rt("000.000.004-14"),
    "COMPRADOR 2 - DOCUMENTO": rt("RG 222 SSP/GO"), "COMPRADOR 2 - NACIONALIDADE": rt("brasileira"), "COMPRADOR 2 - ESTADO CIVIL": rt("solteira"),
    "COMPRADOR 2 - PROFISSÃO": rt("professora"), "COMPRADOR 2 - ENDEREÇO": rt("Rua das Flores, 5"),
  } });
  assert.equal(c.gerar().ok, true);
  const t = c.pdfTexto();
  assert.ok(t.includes("Compradores: Fulano de Teste, brasileiro"), t);
  assert.ok(t.includes("; e Sicrana de Teste, brasileira"), t);
});

test("vendedor PF: parágrafo PJ some e nenhum marcador de bloco sobra", () => {
  const c = cenario({
    obra: { "PROPRIETARIO DOCUMENTO": rt("Investidor Teste") },
    vendedor: { NOME: tit("Investidor Teste"), TIPO: sel("PF"), NACIONALIDADE: rt("brasileiro"), "ESTADO CIVIL": rt("casado"),
                "PROFISSÃO": rt("empresário"), RG: rt("RG 999 SSP/GO"), "REPRESENTANTE NOME": null },
  });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = c.pdfTexto();
  assert.ok(t.includes("PF: Investidor Teste, empresário"), t);
  assert.ok(!t.includes("PJ:") && !t.includes("representada"));
  assert.ok(!t.includes("{{#") && !t.includes("{{/") && !t.includes("{{"));
});

test("intermediária presente mantém o bloco; comissão do vendedor mantém o último bloco (marcador no último parágrafo)", () => {
  const c = cenario({ venda: {
    "CONTRATO - INTERMEDIÁRIA VALOR": num(20000), "CONTRATO - INTERMEDIÁRIA VENCIMENTO": dat("2027-01-10"),
    "CONTRATO - COMISSÃO PAGA POR": sel("VENDEDOR"),
  } });
  assert.equal(c.gerar().ok, true);
  const t = c.pdfTexto();
  assert.ok(t.includes("Intermediária 20.000,00 em 10/01/2027"), t);
  assert.ok(!t.includes("Não há intermediária."));
  assert.ok(t.includes("Comissão paga pelo vendedor Construtora Teste Ltda"), t);
  assert.ok(!t.includes("{{"));
});

test("bloco falso no fim do corpo: removeFromParent lança no último parágrafo e cai em setText('')", () => {
  const c = cenario();
  assert.equal(c.gerar().ok, true);
  const t = c.pdfTexto();
  assert.ok(!t.includes("Comissão paga pelo vendedor") && !t.includes("{{"));
  assert.ok(t.endsWith("\n"), JSON.stringify(t.slice(-40)));
});

test("faltas: FALTAM_DADOS com a lista e nenhuma cópia criada nem PDF gravado", () => {
  const c = cenario({ venda: { "CONTRATO - ALVARÁ Nº": rt(""), "CONTRATO - CRI DA MATRÍCULA": rt("") } });
  const r = c.gerar();
  assert.equal(r.ok, false);
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.includes("Imóvel: alvará (número)") && r.faltas.includes("Imóvel: CRI da matrícula"), JSON.stringify(r.faltas));
  assert.equal(c.d.estado.copias.length, 0);
  assert.equal(c.d.estado.abertos.length, 0);
  assert.equal(c.n.patches.length, 0);
});

test("vendedor não cadastrado vira falta legível, sem cópia", () => {
  const c = cenario({ obra: { "PROPRIETARIO DOCUMENTO": rt("Outra Empresa Teste") } });
  const r = c.gerar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.some((f) => f.startsWith("Vendedor:")), JSON.stringify(r.faltas));
  assert.equal(c.d.estado.copias.length, 0);
});

test("Review Focus 5: vendedor, setor e corretor com acento/espaço/caixa diferentes do cadastro casam", () => {
  const c = cenario({
    obra: { "PROPRIETARIO DOCUMENTO": rt("CONSTRUTORA  TÉSTE   LTDA") },
    venda: { SETOR: sel("setor  téste"), CORRETOR: sel("CORRETOR TÉSTE") },
  });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = c.pdfTexto();
  assert.ok(t.includes("PJ: Construtora Teste Ltda"), t);
  assert.ok(t.includes("Contrato de Residencial Teste"));
});

const LINHA_DOC = (endereco, prop) => ({ "ENDEREÇO": tit(endereco), ...OBRA_PG, "PROPRIETARIO DOCUMENTO": rt(prop) });

test("obra: relação para OUTRA base é ignorada; acha em DOCUMENTOS pelo endereço (acento/espaço diferentes)", () => {
  const c = cenario({
    obraDb: "db-outra", obra: { "PROPRIETARIO DOCUMENTO": rt("Empresa Errada Teste") },
    linhasDoc: [LINHA_DOC("Outro Endereço QD 1 LT 1", "Empresa Errada Teste"), LINHA_DOC("residencial  téste  QD 07 LT 12", "Construtora Teste Ltda")],
  });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().includes("PJ: Construtora Teste Ltda"));
});

test("obra: relação vazia -> acha pelo endereço; a relação para DOCUMENTOS (hífens à parte) é usada direto", () => {
  const vazia = cenario({ venda: { "OBRA-AUTO": { relation: [] } } });
  assert.equal(vazia.gerar().ok, true);
  const direta = cenario({ props: { DB_DOCUMENTOS: "db-d-oc".replace(/-/g, "-") }, obraDb: "dbdoc", linhasDoc: [] });
  /* DB_DOCUMENTOS "db-d-oc" == parent "dbdoc" sem hífens */
  assert.equal(direta.gerar().ok, true);
});

test("obra não encontrada: falta específica, nenhuma cópia no Drive", () => {
  const c = cenario({ venda: { "OBRA-AUTO": { relation: [] } }, linhasDoc: [LINHA_DOC("Outro Endereço QD 1 LT 1", "Fulano")] });
  const r = c.gerar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Vendedor: obra da casa não encontrada em DOCUMENTOS (endereço)"]);
  assert.equal(c.d.estado.copias.length, 0);
});

test("modelo PRONTO quando a obra está finalizada, com prazos do loteamento (texto ou número)", () => {
  const c = cenario({
    obra: { "OBRA FINALIZADA?": sel("SIM") },
    venda: { "CONTRATO - HABITE-SE Nº": rt("HB-5") },
  });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().startsWith("MODELO PRONTO"));
  const semPrazo = cenario({ obra: { "OBRA FINALIZADA?": sel("SIM") }, venda: { "CONTRATO - HABITE-SE Nº": rt("HB-5") },
                             loteamento: { "PRAZO POSSE (DIAS)": null } });
  assert.ok(semPrazo.gerar().faltas.includes("Loteamento: prazo de posse (dias)"));
});

test("valor com $ e \\ entra literal (a substituição do Docs interpreta os dois)", () => {
  const c = cenario({ venda: { "CONTRATO - CONFRONTAÇÕES": rt("lote $1 e \\ fim $") } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().includes("Confrontações: lote $1 e \\ fim $"), c.pdfTexto());
});

function semExportar(c, r, nomes) {
  assert.equal(r.ok, false);
  assert.equal(r.erro, "MODELO_COM_MARCADOR_SOBRANDO");
  assert.deepEqual(r.marcadores, nomes);
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
  assert.deepEqual(c.d.estado.exportados, []);
  assert.equal(c.arquivos()[0].name, "antigo.pdf");
  assert.equal(c.n.patches.length, 0);
}
test("marcador desconhecido sobrando: não anexa, devolve só os nomes, cópia removida", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { modelos: { "modelo-obra": [...MODELO_OBRA, "{{NAO_EXISTE}}"] } } });
  semExportar(c, c.gerar(), ["NAO_EXISTE"]);
  assert.ok(c.g.logs.some((l) => l.includes("NAO_EXISTE")));
});

test("bloco sem fechamento: MODELO_COM_MARCADOR_SOBRANDO, PDF anterior intacto", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { modelos: { "modelo-obra": [...MODELO_OBRA, "{{#SE_OUTRO}}", "texto"] } } });
  semExportar(c, c.gerar(), ["SE_OUTRO"]);
});

test("fechamento solto {{/X}}: MODELO_COM_MARCADOR_SOBRANDO", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { modelos: { "modelo-obra": [...MODELO_OBRA, "{{/SE_SOLTO}}"] } } });
  semExportar(c, c.gerar(), ["SE_SOLTO"]);
});

test("chaves no valor digitado são removidas: não viram marcador nem injetam outra chave", () => {
  const c = cenario({ venda: { "CONTRATO - CONDIÇÕES ESPECIAIS": rt("ver {{LOTE}} e }} solto") },
                     drive: { modelos: { "modelo-obra": [...MODELO_OBRA, "Condições: {{CONDICOES_ESPECIAIS}}"] } } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = c.pdfTexto();
  assert.ok(t.includes("Condições: ver LOTE e  solto"), t);
  assert.ok(!t.includes("{{") && !t.includes("}}"));
});

test("Review Focus 4: Docs falha no meio -> CONTRATO_FALHOU, cópia removida, PDF anterior intacto", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { falhaAbrir: "Documento indisponível" } });
  const r = c.gerar();
  assert.equal(r.ok, false);
  assert.equal(r.erro, "CONTRATO_FALHOU");
  assert.equal(c.d.estado.copias.length, 1);
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
  assert.equal(c.arquivos().length, 1);
  assert.equal(c.arquivos()[0].name, "antigo.pdf");
  assert.equal(c.n.patches.length, 0);
});

test("Review Focus 4: Notion falha no upload -> CONTRATO_FALHOU, cópia removida, PDF anterior intacto", () => {
  const c = cenario({
    venda: { "CONTRATO GERADO": ANTIGO },
    rotaExtra: (url, opt) => (url.endsWith("/file_uploads") ? { status: 500, json: { message: "falha de teste" } } : null),
  });
  const r = c.gerar();
  assert.equal(r.erro, "CONTRATO_FALHOU");
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
  assert.equal(c.arquivos()[0].name, "antigo.pdf");
  assert.equal(c.n.patches.length, 0);
});

test("I-1: sem o serviço Drive avançado: DRIVE_API_DESLIGADA e nenhuma cópia criada", () => {
  const c = cenario({ drive: { avancado: false } });
  const r = c.gerar();
  assert.deepEqual(r, { ok: false, erro: "DRIVE_API_DESLIGADA" });
  assert.equal(c.d.estado.copias.length, 0);
  assert.deepEqual(c.d.estado.lixeira, []);
  assert.equal(c.d.estado.abertos.length, 0);
  assert.equal(c.n.patches.length, 0);
});

test("I-1: Drive.Files sem remove também conta como desligado", () => {
  const c = cenario();
  c.g.ctx.Drive = {};
  assert.equal(c.gerar().erro, "DRIVE_API_DESLIGADA");
  assert.equal(c.d.estado.copias.length, 0);
});

test("I-1: a remoção passa supportsAllDrives: true", () => {
  const c = cenario();
  assert.equal(c.gerar().ok, true);
  assert.equal(JSON.stringify(c.d.estado.opcoesRemocao), '[{"supportsAllDrives":true}]');
});

test("I-1: remoção que lança cai para a lixeira, loga sem dado pessoal e não derruba a geração", () => {
  const c = cenario();
  c.g.ctx.Drive.Files.remove = () => { throw new Error("sem permissão"); };
  assert.equal(c.gerar().ok, true);
  assert.ok(c.g.logs.some((l) => /copia nao apagada/.test(l)));
  assert.deepEqual(c.d.estado.lixeira, [c.d.estado.copias[0].id]);
  assert.ok(c.g.logs.includes("PORTAL-VENDA contrato: copia foi para a lixeira"));
});

test("I-2: endereço repetido em DOCUMENTOS (sem relação) -> falta de obra ambígua, sem cópia", () => {
  const c = cenario({
    venda: { "OBRA-AUTO": { relation: [] } },
    linhasDoc: [LINHA_DOC("RESIDENCIAL TESTE QD 07 LT 12", "Construtora Teste Ltda"), LINHA_DOC("RESIDENCIAL TESTE QD 07 LT 12", "Outra Empresa Teste")],
  });
  const r = c.gerar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Vendedor: obra ambígua em DOCUMENTOS (endereço repetido)"]);
  assert.equal(c.d.estado.copias.length, 0);
});

test("I-2: cadastro duplicado (vendedor, loteamento, corretor) vira falta, sem cópia", () => {
  const casos = [["db-vend", "Vendedor: cadastro duplicado em VENDEDORES – CONTRATO"],
                 ["db-lote", "Loteamento: cadastro duplicado em LOTEAMENTOS – CONTRATO"],
                 ["db-corr", "Corretor: cadastro duplicado em CORRETORES – CONTRATO"]];
  for (const [base, falta] of casos) {
    const c = cenario({ duplicar: { [base]: true } });
    const r = c.gerar();
    assert.equal(r.erro, "FALTAM_DADOS", base);
    assert.deepEqual(r.faltas, [falta], base);
    assert.equal(c.d.estado.copias.length, 0, base);
  }
});

test("I-2: cadastro duplicado por acento/caixa diferentes também conta", () => {
  const c = cenario({ duplicar: { "db-vend": { NOME: tit("CONSTRUTORA  TÉSTE LTDA") } } });
  assert.deepEqual(c.gerar().faltas, ["Vendedor: cadastro duplicado em VENDEDORES – CONTRATO"]);
});

test("M-2: marcador sobrando só no cabeçalho ou só no rodapé também barra; a cópia é removida", () => {
  for (const [cab, nome] of [[{ header: "Cabeçalho {{SOBRA_CAB}}" }, "SOBRA_CAB"], [{ footer: "Rodapé {{SOBRA_ROD}}" }, "SOBRA_ROD"]]) {
    const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { cabecalhos: { "modelo-obra": cab } } });
    const r = c.gerar();
    assert.equal(r.erro, "MODELO_COM_MARCADOR_SOBRANDO");
    assert.deepEqual(r.marcadores, [nome]);
    assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
    assert.deepEqual(c.d.estado.exportados, []);
    assert.equal(c.n.patches.length, 0);
  }
});

test("M-2: marcador válido em cabeçalho e rodapé é preenchido; documento sem cabeçalho (null) segue normal", () => {
  const c = cenario({ drive: { cabecalhos: { "modelo-obra": { header: "Loteamento {{LOTEAMENTO}} $", footer: "{{MUNICIPIO_UF}}" } } } });
  assert.equal(c.gerar().ok, true);
  const salvo = c.d.estado.salvos[c.d.estado.copias[0].id];
  assert.equal(salvo.cab.header, "Loteamento Residencial Teste $");
  assert.equal(salvo.cab.footer, "Cidade Teste/GO");
  assert.equal(cenario().gerar().ok, true);
});

test("M-3: base que continua com mais páginas depois de 1000 linhas é avisada no log", () => {
  const linha = (i) => ({ id: "l" + i, properties: { NOME: { type: "title", title: [{ type: "text", plain_text: "Corretor " + i }] } } });
  const c = cenario({ rotaExtra: (url) => (url.endsWith("/databases/db-corr/query")
    ? { json: { results: Array.from({ length: 100 }, (_, i) => linha(i)), has_more: true, next_cursor: "c" } } : null) });
  c.gerar();
  assert.ok(c.g.logs.includes("PORTAL-VENDA contrato: base db-corr atingiu o limite de 1000 linhas"), c.g.logs.join(" | "));
  const curta = cenario();
  curta.gerar();
  assert.ok(!curta.g.logs.some((l) => l.includes("limite de 1000")));
});

test("modelo ou pasta não configurados; cadastro não configurado", () => {
  const a = cenario({ props: { MODELO_CONSTRUCAO_ID: "" } });
  assert.equal(a.gerar().erro, "MODELO_NAO_CONFIGURADO");
  const b = cenario({ props: { MODELO_CONSTRUCAO_ID: "modelo-inexistente" } });
  assert.equal(b.gerar().erro, "MODELO_NAO_CONFIGURADO");
  const p = cenario({ props: { PASTA_PROVISORIA_ID: "" } });
  assert.equal(p.gerar().erro, "MODELO_NAO_CONFIGURADO");
  for (const x of ["DB_VENDEDORES", "DB_LOTEAMENTOS", "DB_CORRETORES", "DB_DOCUMENTOS"]) {
    const c = cenario({ semBases: [x] });
    assert.equal(c.gerar().erro, "CADASTRO_NAO_CONFIGURADO", x);
    assert.equal(c.d.estado.copias.length, 0);
  }
  for (const c of [a, b, p]) assert.equal(c.d.estado.copias.length, 0);
});

test("perfil TESTES não gera, mas pode consultar o estado", () => {
  const c = cenario();
  assert.equal(c.gerar(tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(c.d.estado.copias.length, 0);
  assert.equal(c.acao("contratoEstado", tokenDe("TESTES", [])).ok, true);
  assert.equal(c.gerar(tokenDe("GERAL", ["LIGAÇÕES"])).erro, "SEM_PERMISSAO");
});

test("coluna nova ausente na VENDAS -> COLUNA_FALTANDO", () => {
  const c = cenario({ colunas: colunasVenda(["CONTRATO - CRI DA MATRÍCULA", "CONTRATO GERADO"]) });
  const r = c.gerar();
  assert.equal(r.ok, false);
  assert.match(r.erro, /^COLUNA_FALTANDO: /);
  assert.ok(r.erro.includes("CONTRATO - CRI DA MATRÍCULA") && r.erro.includes("CONTRATO GERADO"), r.erro);
  assert.equal(c.d.estado.copias.length, 0);
});

test("contratoEstado: sem arquivo -> gerado:false; depois de gerar -> nome e url do último", () => {
  const c = cenario();
  const est0 = c.acao("contratoEstado"); delete est0.testemunhas;   /* a lista de testemunhas tem teste próprio */
  assert.deepEqual(est0, { ok: true, gerado: false, etapa: "NENHUM", pre: null });
  const r = c.gerar();
  const e = c.acao("contratoEstado");
  assert.equal(e.ok, true);
  assert.equal(e.gerado, true);
  assert.equal(e.etapa, "FINAL");
  assert.equal(e.pre.conferido, true);
  assert.equal(e.nome, r.nome);
  assert.match(e.url, /^https:\/\/s3\.falso\//);
  const dois = cenario({ venda: { "CONTRATO GERADO": { files: [
    { name: "a.pdf", type: "file", file: { url: "https://s3.falso/a" } }, { name: "b.pdf", type: "file", file: { url: "https://s3.falso/b" } }] } } });
  assert.deepEqual(dois.acao("contratoEstado"), { ok: true, gerado: true, etapa: "FINAL", pre: null, nome: "b.pdf", url: "https://s3.falso/b" });
});

test("nenhum log carrega nome, CPF, Pix ou conta dos dados de teste", () => {
  const ok = cenario();
  ok.gerar();
  const falta = cenario({ venda: { "CONTRATO - ALVARÁ Nº": rt("") } });
  falta.gerar();
  const falha = cenario({ drive: { falhaAbrir: "Documento indisponível" } });
  falha.gerar();
  const semLixo = cenario();
  semLixo.g.ctx.Drive.Files.remove = () => { throw new Error("sem permissão"); };
  semLixo.gerar();
  for (const c of [ok, falta, falha, semLixo]) {
    const todos = c.g.logs.join("\n");
    for (const s of DADOS_PESSOAIS) assert.ok(!todos.includes(s), "log vazou: " + s);
  }
  assert.ok(ok.g.logs.some((l) => l.includes("01234567")));
});

/* ---------- pré-contrato (entrega 9) ---------- */
const AMARELO = "#FFF59D", VERMELHO = "#FFCDD2";
const MODELO_COM_CAB = { "modelo-obra": { header: "Cabeçalho {{LOTEAMENTO}}", footer: "Rodapé fixo" } };
const preDe = (c) => JSON.parse(c.p["PRECONTRATO_" + PAGE] || "null");

test("pré-contrato: valores preenchidos grifados em amarelo (vários no mesmo parágrafo e no cabeçalho), PDF na pasta provisória, CONTRATO GERADO intacto", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { realce: true, cabecalhos: MODELO_COM_CAB } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.nome, /^PRÉ-CONTRATO - RESIDENCIAL TESTE QD 07 LT 12 - CASA 3 - \d\d-\d\d-\d{4} \[#[0-9a-f]{8}\]\.pdf$/);
  assert.match(r.url, /^https:\/\/drive\.falso\//);
  /* PDF na pasta provisória com o nome do pré-contrato; nada em CONTRATO GERADO */
  assert.deepEqual(c.d.estado.naPasta.map((x) => [x.nome, x.pasta]), [[r.nome, "pasta-prov"]]);
  assert.equal(c.n.patches.length, 0);
  assert.deepEqual(c.arquivos().map((f) => f.name), ["antigo.pdf"]);
  /* a cópia de trabalho saiu */
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
  /* grifos: cada valor que trocou um marcador, no trecho exato; nada do realce velho do modelo */
  const s = c.d.estado.salvos[c.d.estado.copias[0].id];
  assert.ok(!s.pars.join("\n").includes("{{"), s.pars.join("\n"));
  assert.ok(s.grifos.every((x) => x.cor === AMARELO), JSON.stringify(s.grifos));
  const par0 = s.grifos.filter((x) => x.onde === "corpo" && x.par === 0).map((x) => x.trecho);
  assert.deepEqual(par0, ["Residencial Teste", "Cidade Teste/GO"], "dois marcadores no mesmo parágrafo, o texto do modelo entre eles sem grifo");
  assert.ok(s.grifos.some((x) => x.trecho === "R$ 300.000,00"));
  assert.ok(s.grifos.some((x) => x.trecho === "Norte: lote 11; Sul: lote 13"));
  assert.deepEqual(s.grifos.filter((x) => x.onde === "header").map((x) => x.trecho), ["Residencial Teste"]);
  assert.equal(s.cab.header, "Cabeçalho Residencial Teste");
  /* Propriedade com carimbo, link, data e quem gerou */
  const pre = preDe(c);
  assert.equal(pre.hash, /\[#([0-9a-f]{8})\]\.pdf$/.exec(r.nome)[1]);
  assert.equal(pre.url, r.url);
  assert.equal(pre.por, "ana.teste");
  assert.ok(!Number.isNaN(Date.parse(pre.em)));
  assert.equal(pre.conferidoEm, undefined);
  /* contratoEstado: etapa PRE, pré-contrato em dia; o contrato antigo continua lá */
  const e = c.acao("contratoEstado");
  assert.equal(e.etapa, "PRE");
  assert.equal(e.gerado, true);
  assert.deepEqual(e.pre, { nome: r.nome, url: r.url, em: pre.em, conferido: false, desatualizado: false });
});

test("pré-contrato: valor com $ e barra entra literal e grifado", () => {
  const c = cenario({ venda: { "CONTRATO - CONFRONTAÇÕES": rt("lote $1 e \\ fim $") } });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  const s = c.d.estado.salvos[c.d.estado.copias[0].id];
  assert.ok(s.pars.includes("Confrontações: lote $1 e \\ fim $"), s.pars.join("\n"));
  assert.ok(s.grifos.some((x) => x.trecho === "lote $1 e \\ fim $" && x.cor === AMARELO));
});

test("aprovar com os mesmos dados: contrato FINAL sem grifo nenhum (nem o realce velho do modelo) em CONTRATO GERADO; registra quem conferiu", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO }, drive: { realce: true, cabecalhos: MODELO_COM_CAB } });
  const pre = c.acao("gerarPreContrato");
  assert.equal(pre.ok, true);
  const nCopias = c.d.estado.copias.length;
  const r = c.acao("aprovarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.nome, pre.nome.replace(/^PRÉ-CONTRATO - /, "CONTRATO - "), "mesmo carimbo do pré-contrato");
  assert.deepEqual(c.arquivos().map((f) => f.name), [r.nome]);
  const s = c.d.estado.salvos[c.d.estado.copias[nCopias].id];
  assert.deepEqual(s.grifos, [], JSON.stringify(s.grifos));
  assert.ok(c.pdfTexto().includes("Contrato de Residencial Teste em Cidade Teste/GO"));
  const reg = preDe(c);
  assert.equal(reg.conferidoPor, "ana.teste");
  assert.ok(!Number.isNaN(Date.parse(reg.conferidoEm)));
  const e = c.acao("contratoEstado");
  assert.equal(e.etapa, "FINAL");
  assert.equal(e.nome, r.nome);
  assert.equal(e.pre.conferido, true);
  /* "Gerar de novo" volta ao pré-contrato: etapa PRE com o contrato antigo ainda gravado */
  assert.equal(c.acao("gerarPreContrato").ok, true);
  const e2 = c.acao("contratoEstado");
  assert.equal(e2.etapa, "PRE");
  assert.equal(e2.gerado, true);
});

test("aprovar depois de os dados mudarem: PRECONTRATO_DESATUALIZADO, nada copiado nem gravado", () => {
  const c = cenario();
  assert.equal(c.acao("gerarPreContrato").ok, true);
  c.n.pagina.properties["CONTRATO - SINAL VALOR"] = { type: "number", number: 12000 };
  assert.equal(c.acao("contratoEstado").pre.desatualizado, true);
  const copias = c.d.estado.copias.length;
  assert.deepEqual(c.acao("aprovarPreContrato"), { ok: false, erro: "PRECONTRATO_DESATUALIZADO" });
  assert.equal(c.d.estado.copias.length, copias);
  assert.equal(c.n.patches.length, 0);
  assert.equal(preDe(c).conferidoEm, undefined);
  /* novo pré-contrato com os dados novos libera; o PDF do pré-contrato anterior é apagado */
  const antigo = preDe(c).arquivoId;
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.ok(c.d.estado.removidas.includes(antigo));
  assert.notEqual(preDe(c).arquivoId, antigo);
  assert.equal(c.acao("aprovarPreContrato").ok, true);
});

test("sem pré-contrato: aprovar (e a ação antiga gerarContrato) recusam PRECONTRATO_FALTANDO sem tocar no Drive nem no Notion", () => {
  for (const action of ["aprovarPreContrato", "gerarContrato"]) {
    const c = cenario();
    assert.deepEqual(c.acao(action), { ok: false, erro: "PRECONTRATO_FALTANDO" }, action);
    assert.equal(c.d.estado.copias.length, 0);
    assert.equal(c.n.patches.length, 0);
  }
  /* faltas aparecem antes da falta do pré-contrato */
  const f = cenario({ venda: { "CONTRATO - ALVARÁ Nº": rt("") } });
  assert.equal(f.acao("aprovarPreContrato").erro, "FALTAM_DADOS");
});

test("pré-contrato com faltas: FALTAM_DADOS, nenhuma cópia, nenhuma Propriedade", () => {
  const c = cenario({ venda: { "CONTRATO - ALVARÁ Nº": rt("") } });
  assert.equal(c.acao("gerarPreContrato").erro, "FALTAM_DADOS");
  assert.equal(c.d.estado.copias.length, 0);
  assert.equal(preDe(c), null);
});

test("perfil TESTES não gera nem aprova pré-contrato", () => {
  const c = cenario();
  for (const action of ["gerarPreContrato", "aprovarPreContrato"])
    assert.equal(c.acao(action, tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES", action);
  assert.equal(c.d.estado.copias.length, 0);
});

test("pré-contrato e aprovação: nenhum log com nome, CPF, Pix, conta ou quem conferiu", () => {
  const c = cenario();
  c.acao("gerarPreContrato");
  c.acao("aprovarPreContrato");
  c.n.pagina.properties["CONTRATO - SINAL VALOR"] = { type: "number", number: 12000 };
  c.acao("aprovarPreContrato");
  const todos = c.g.logs.join("\n");
  for (const s of [...DADOS_PESSOAIS, "ana.teste"]) assert.ok(!todos.includes(s), "log vazou: " + s);
  assert.ok(c.g.logs.some((l) => l.includes("gerarPreContrato 01234567 ok")));
  assert.ok(c.g.logs.some((l) => l.includes("aprovarPreContrato 01234567 dados mudaram")));
});

test("Visualizar pré-contrato: o portal entrega o PDF (base64) a quem está logado, sem link do Drive", () => {
  const c = cenario();
  assert.equal(c.acao("verPreContrato").erro, "PRECONTRATO_FALTANDO");
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = c.acao("verPreContrato");
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.nome, r.nome);
  assert.ok(v.base64 && v.base64.length > 10, "veio o conteúdo do PDF");
});

/* ---- produção (08/10): fontes que já existem na Brain real ---- */
test("produção: vendedor da PROPRIETARIOS_PAI sem coluna TIPO — PJ/PF pelo número de dígitos do CPF/CNPJ", () => {
  const pj = cenario({ vendedor: { TIPO: null } });
  assert.equal(pj.gerar().ok, true);
  assert.ok(pj.pdfTexto().includes("PJ: Construtora Teste Ltda representada por Beltrano Representante"));
  const pf = cenario({ vendedor: { TIPO: null, "CPF/CNPJ": rt("000.000.009-49"), NACIONALIDADE: rt("brasileiro"),
                                   "ESTADO CIVIL": rt("solteiro"), "PROFISSÃO": rt("investidor"), RG: rt("RG 1 SSP/GO") } });
  const r = pf.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!pf.pdfTexto().includes("PJ: Construtora Teste Ltda"), "11 dígitos = pessoa física");
});

test("produção: loteamento achado pela coluna SETOR (título vazio, como a DISPONIBILIDADES POR SETOR) e município pela CIDADE da obra", () => {
  const c = cenario({ loteamento: { SETOR: sel("Setor Teste"), "OBSERVAÇÃO": tit(""), "MUNICÍPIO/UF": null } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().includes("Contrato de Residencial Teste em Cidade Teste/GO"), c.pdfTexto().slice(0, 300));
});

test("produção: endereço da casa sem o zero à esquerda acha a obra (\"QD 7\" = \"QD 07\")", () => {
  const c = cenario({ obraDb: "db-outra", linhasDoc: [LINHA_DOC("RESIDENCIAL TESTE QD 7 LT 12", "Construtora Teste Ltda")] });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().includes("PJ: Construtora Teste Ltda"));
});

/* 08/10/2026 — "a conta bancária vem sempre da obra": OBRA-AUTO -> (EMP) Projeto 2.0 (outra base) com a
   relação CONTA -> linha da CONTAS BANCÁRIAS. Dados inventados. */
const CONTA_ID = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const rtT = (s) => Object.assign({ type: "rich_text" }, rt(s));
function rotaConta(props) {
  return (url, opt) => (String(opt.method || "get").toUpperCase() === "GET" && url.endsWith("/pages/" + CONTA_ID)
    ? { json: { id: CONTA_ID, parent: { database_id: "db-contas" }, properties: props } } : null);
}
const CONTA_PG = {
  Conta: Object.assign({ type: "title" }, tit("CONTA FICTICIA OBRA")), Banco: rtT("756"), "Agência": rtT("9999"),
  "Número": rtT("77777-7"), "CHAVE PIX": rtT("chave-ficticia@exemplo.test"),
};

test("conta da obra: banco, agência, número E Pix da CONTAS BANCÁRIAS no contrato (operação some)", () => {
  const c = cenario({ obraDb: "db-obras", obra: { CONTA: rel(CONTA_ID) }, rotaExtra: rotaConta(CONTA_PG) });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = c.pdfTexto();
  assert.ok(t.includes("Banco: 756 – Agência: 9999 – Conta 77777-7 – PIX: chave-ficticia@exemplo.test - Titularidade da VENDEDORA"), t);
  assert.ok(!t.includes("Banco Teste") && !t.includes("12345-6") && !t.includes("pix@teste") && !t.includes("Operação"), t);
  const logs = c.g.logs.join("\n");
  for (const s of ["77777-7", "9999", "chave-ficticia"]) assert.ok(!logs.includes(s), "log vazou: " + s);
});

test("conta da obra sem chave Pix: só os dados bancários, sem 'PIX:' em branco", () => {
  const c = cenario({ obraDb: "db-obras", obra: { CONTA: rel(CONTA_ID) },
    rotaExtra: rotaConta(Object.assign({}, CONTA_PG, { "CHAVE PIX": rtT("") })) });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = c.pdfTexto();
  assert.ok(t.includes("Banco: 756 – Agência: 9999 – Conta 77777-7 - Titularidade da VENDEDORA"), t);
  assert.ok(!t.includes("PIX") && !t.includes("pix@teste"), t);
});

test("conta da obra sem banco nem número: fica a conta do cadastro do vendedor", () => {
  const vazia = Object.assign({}, CONTA_PG, { Banco: rtT(""), "Número": rtT("") });
  const c = cenario({ obraDb: "db-obras", obra: { CONTA: rel(CONTA_ID) }, rotaExtra: rotaConta(vazia) });
  assert.equal(c.gerar().ok, true);
  assert.ok(c.pdfTexto().includes("Banco: Banco Teste – Agência: 0001 – Operação: 013 – Conta 12345-6 – PIX: pix@teste.example"));
});

test("obra sem relação CONTA (teste: OBRA-AUTO em DOCUMENTOS, ou outra base sem CONTA): conta do vendedor, como antes", () => {
  for (const obraDb of ["db-doc", "db-obras"]) {
    let leuConta = false;
    const c = cenario({ obraDb, rotaExtra: (url) => { if (url.endsWith("/pages/" + CONTA_ID)) leuConta = true; return null; } });
    const r = c.gerar();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(c.pdfTexto().includes("Banco: Banco Teste – Agência: 0001 – Operação: 013 – Conta 12345-6 – PIX: pix@teste.example - Titularidade"));
    assert.equal(leuConta, false);
  }
});

test("vendedor sem Pix e sem operação: a linha do banco sai sem os rótulos vazios e o contrato não trava", () => {
  const c = cenario({ vendedor: { PIX: rt(""), "OPERAÇÃO": rt("") } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().includes("Banco: Banco Teste – Agência: 0001 – Conta 12345-6 - Titularidade da VENDEDORA"), c.pdfTexto());
});

test("a página da OBRA-AUTO é lida uma vez só", () => {
  let leituras = 0;
  const c = cenario({ obraDb: "db-obras", obra: { CONTA: rel(CONTA_ID) }, rotaExtra: (url, opt) => {
    if (url.endsWith("/pages/" + OBRA)) leituras++;
    return rotaConta(CONTA_PG)(url, opt);
  } });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(leituras, 1);
});

test("conta da obra como SELEÇÃO (produção): acha a linha da CONTAS BANCÁRIAS pelo nome (DB_CONTAS_BANCARIAS)", () => {
  const linha = { id: CONTA_ID, properties: CONTA_PG };
  const outra = { id: "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0", properties: Object.assign({}, CONTA_PG, { Conta: Object.assign({ type: "title" }, tit("OUTRA CONTA")) }) };
  const c = cenario({ obraDb: "db-obras", obra: { CONTA: { type: "select", select: { name: "conta ficticia obra" } } },
    props: { DB_CONTAS_BANCARIAS: "db-contas" },
    rotaExtra: (url, opt) => (url.endsWith("/databases/db-contas/query") ? { json: { results: [outra, linha], has_more: false } } : rotaConta(CONTA_PG)(url, opt)) });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(c.pdfTexto().includes("Banco: 756 – Agência: 9999 – Conta 77777-7 – PIX: chave-ficticia@exemplo.test"), c.pdfTexto());
  /* sem a Propriedade: fica a conta do vendedor, como antes */
  const sem = cenario({ obraDb: "db-obras", obra: { CONTA: { type: "select", select: { name: "CONTA FICTICIA OBRA" } } } });
  assert.equal(sem.gerar().ok, true);
  assert.ok(!sem.pdfTexto().includes("77777-7"));
});
