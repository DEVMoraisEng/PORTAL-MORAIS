/* Cenário do contrato (Notion, Drive e Apps Script falsos) compartilhado pelos testes do GerarContrato.
 * Só dados inventados — o repositório é público. */
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

function cenario({ venda, obra, vendedor, loteamento, corretor, props, drive, colunas, semBases = [], rotaExtra, obraDb = "db-doc", linhasDoc, duplicar = {}, esquemas = {}, bases: basesExtra = {} } = {}) {
  const d = driveFalso(Object.assign({ modelos: { "modelo-obra": MODELO_OBRA, "modelo-pronto": MODELO_PRONTO } }, drive));
  const bases = { "db-vend": [mescla(VENDEDOR, vendedor)], "db-lote": [mescla(LOTEAMENTO, loteamento)], "db-corr": [mescla(CORRETOR, corretor)],
    "db-doc": linhasDoc || [Object.assign({ "ENDEREÇO": tit("RESIDENCIAL TESTE QD 07 LT 12") }, mescla(OBRA_PG, obra))] };
  for (const [base, mud] of Object.entries(duplicar)) bases[base].push(mescla(bases[base][0], mud === true ? {} : mud));
  Object.assign(bases, basesExtra);
  const cols = colunas || colunasVenda();
  const valores = Object.fromEntries(Object.entries(mescla(VENDA, venda)).filter(([k]) => k in cols));
  const n = notionFalso({ colunas: cols, valores, paginasExtras: { [OBRA]: mescla(OBRA_PG, obra) }, paginasDb: { [OBRA]: obraDb }, bases, esquemas });
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

export { CV, DIA, tokenDe, PAGE, OBRA, tit, sel, num, dat, rel, rt, PROPS, colunasVenda, MODELO_OBRA, MODELO_PRONTO,
         VENDA, OBRA_PG, VENDEDOR, LOTEAMENTO, CORRETOR, mescla, cenario };
