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
  DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr",
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
  "CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS": dat("2027-06-30"),
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

function cenario({ venda, obra, vendedor, loteamento, corretor, props, drive, colunas, semBases = [], rotaExtra } = {}) {
  const d = driveFalso(Object.assign({ modelos: { "modelo-obra": MODELO_OBRA, "modelo-pronto": MODELO_PRONTO } }, drive));
  const bases = { "db-vend": [mescla(VENDEDOR, vendedor)], "db-lote": [mescla(LOTEAMENTO, loteamento)], "db-corr": [mescla(CORRETOR, corretor)] };
  const cols = colunas || colunasVenda();
  const valores = Object.fromEntries(Object.entries(mescla(VENDA, venda)).filter(([k]) => k in cols));
  const n = notionFalso({ colunas: cols, valores, paginasExtras: { [OBRA]: mescla(OBRA_PG, obra) }, bases });
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
  return { g, n, d, acao, arquivos, pdfTexto, gerar: (tok) => acao("gerarContrato", tok) };
}

const ANTIGO = { files: [{ name: "antigo.pdf", type: "file", file: { url: "https://s3.falso/velho" } }] };
const DADOS_PESSOAIS = ["Fulano", "Sicrana", "Beltrano", "Construtora", "000.000", "Investidor", "pix@teste", "12345-6"];

test("sucesso: PDF em CONTRATO GERADO substitui o anterior, sem marcadores, cópia removida", () => {
  const c = cenario({ venda: { "CONTRATO GERADO": ANTIGO } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.nome, /^CONTRATO - RESIDENCIAL TESTE QD 07 LT 12 - CASA 3 - \d\d-\d\d-\d{4}\.pdf$/);
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

test("marcador sem valor sobrando: gera mesmo assim e loga aviso sem o valor", () => {
  const c = cenario({ drive: { modelos: { "modelo-obra": [...MODELO_OBRA, "{{NAO_EXISTE}}"] } } });
  assert.equal(c.gerar().ok, true);
  assert.ok(c.g.logs.some((l) => /sobrou marcador/.test(l)));
  assert.ok(!c.g.logs.some((l) => l.includes("NAO_EXISTE")));
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

test("sem o serviço Drive avançado: cópia vai para a lixeira e o log avisa", () => {
  const c = cenario({ drive: { avancado: false } });
  assert.equal(c.gerar().ok, true);
  assert.deepEqual(c.d.estado.lixeira, [c.d.estado.copias[0].id]);
  assert.deepEqual(c.d.estado.removidas, []);
  assert.ok(c.g.logs.includes("PORTAL-VENDA contrato: copia na lixeira (Drive API avançada desligada)"));
});

test("remoção da cópia que falha é logada e não derruba a geração", () => {
  const c = cenario();
  c.g.ctx.Drive.Files.remove = () => { throw new Error("sem permissão"); };
  assert.equal(c.gerar().ok, true);
  assert.ok(c.g.logs.some((l) => /copia nao apagada/.test(l)));
});

test("modelo ou pasta não configurados; cadastro não configurado", () => {
  const a = cenario({ props: { MODELO_CONSTRUCAO_ID: "" } });
  assert.equal(a.gerar().erro, "MODELO_NAO_CONFIGURADO");
  const b = cenario({ props: { MODELO_CONSTRUCAO_ID: "modelo-inexistente" } });
  assert.equal(b.gerar().erro, "MODELO_NAO_CONFIGURADO");
  const p = cenario({ props: { PASTA_PROVISORIA_ID: "" } });
  assert.equal(p.gerar().erro, "MODELO_NAO_CONFIGURADO");
  for (const x of ["DB_VENDEDORES", "DB_LOTEAMENTOS", "DB_CORRETORES"]) {
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
  assert.deepEqual(c.acao("contratoEstado"), { ok: true, gerado: false });
  const r = c.gerar();
  const e = c.acao("contratoEstado");
  assert.equal(e.ok, true);
  assert.equal(e.gerado, true);
  assert.equal(e.nome, r.nome);
  assert.match(e.url, /^https:\/\/s3\.falso\//);
  const dois = cenario({ venda: { "CONTRATO GERADO": { files: [
    { name: "a.pdf", type: "file", file: { url: "https://s3.falso/a" } }, { name: "b.pdf", type: "file", file: { url: "https://s3.falso/b" } }] } } });
  assert.deepEqual(dois.acao("contratoEstado"), { ok: true, gerado: true, nome: "b.pdf", url: "https://s3.falso/b" });
});

test("nenhum log carrega nome, CPF, Pix ou conta dos dados de teste", () => {
  const ok = cenario();
  ok.gerar();
  const falta = cenario({ venda: { "CONTRATO - ALVARÁ Nº": rt("") } });
  falta.gerar();
  const falha = cenario({ drive: { falhaAbrir: "Documento indisponível" } });
  falha.gerar();
  const semLixo = cenario({ drive: { avancado: false } });
  semLixo.gerar();
  for (const c of [ok, falta, falha, semLixo]) {
    const todos = c.g.logs.join("\n");
    for (const s of DADOS_PESSOAIS) assert.ok(!todos.includes(s), "log vazou: " + s);
  }
  assert.ok(ok.g.logs.some((l) => l.includes("01234567")));
});
