/* Contrato do condomínio: texto do 6.1, fiadores, faltas/avisos, escolha do modelo
 * (ContratoVenda.js) e o GerarContrato.gs lendo a linha da BANCO DE DADOS VENDAS CONDOMÍNIO
 * com Notion/Docs/Drive falsos. Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, driveFalso, notionFalso, assinar, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const C = createRequire(import.meta.url)("../ContratoVenda.js");

/* o exemplo do rascunho jurídico: sinal 1.000 + 3×3.000, 10×924,07, 12×295,49, balões 8.954,18 e
   6.267,88, crédito 244.800, FGTS 5.250, 24×705,89 = 305.000,00 */
const FLUXO = {
  assinatura: "2026-10-07", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-07", sinal60: 3000, data60: "2026-12-07", sinal90: 3000, data90: "2027-01-07",
  pre1N: 10, pre1Valor: 924.07, pre1Data: "2026-11-10", pre2N: 12, pre2Valor: 295.49, pre2Data: "2027-09-10",
  balao1Valor: 8954.18, balao1Data: "2027-12-10", balao2Valor: 6267.88, balao2Data: "2028-11-10",
  credito: 244800, fgts: 5250, subsidio: 0, posN: 24, posValor: 705.89, posData: "2029-01-10",
};

const TEXTO_61 = [
  "6.1. Preço total: R$ 305.000,00 (trezentos e cinco mil reais), a ser pago da seguinte forma:",
  "I — SINAL (arras confirmatórias, art. 417 do Código Civil), sem correção monetária:",
  "a) R$ 1.000,00 (mil reais), no ato da assinatura deste instrumento, em 07/10/2026;",
  "b) R$ 3.000,00 (três mil reais), com vencimento em 07/11/2026;",
  "c) R$ 3.000,00 (três mil reais), com vencimento em 07/12/2026;",
  "d) R$ 3.000,00 (três mil reais), com vencimento em 07/01/2027.",
  "II — PARCELAS MENSAIS DURANTE A OBRA (pré-chaves), corrigidas na forma do item 7.1, \"a\":",
  "a) 1ª etapa: 10 parcelas mensais e sucessivas de R$ 924,07 (novecentos e vinte e quatro reais e sete centavos), vencendo-se a primeira em 10/11/2026 e as demais no dia 10 dos meses subsequentes;",
  "b) 2ª etapa: 12 parcelas mensais e sucessivas de R$ 295,49 (duzentos e noventa e cinco reais e quarenta e nove centavos), vencendo-se a primeira em 10/09/2027 e as demais no dia 10 dos meses subsequentes.",
  "III — PARCELAS INTERMEDIÁRIAS (balões), corrigidas na forma do item 7.1, \"a\":",
  "a) R$ 8.954,18 (oito mil novecentos e cinquenta e quatro reais e dezoito centavos), com vencimento em 10/12/2027;",
  "b) R$ 6.267,88 (seis mil duzentos e sessenta e sete reais e oitenta e oito centavos), com vencimento em 10/11/2028, ou na data da entrega das chaves, o que ocorrer primeiro.",
  "IV — RECURSOS DE TERCEIROS, sem correção pela VENDEDORA:",
  "a) Financiamento bancário: R$ 244.800,00 (duzentos e quarenta e quatro mil e oitocentos reais), a ser pago diretamente pela instituição financeira na assinatura do contrato de financiamento, observada a Cláusula Oitava;",
  "b) Recursos do FGTS: R$ 5.250,00 (cinco mil duzentos e cinquenta reais), na data do respectivo resgate (item 13.3).",
  "Na hipótese de o financiamento, o FGTS ou o subsídio serem liberados em valor inferior ao previsto, a diferença será paga pelo COMPRADOR à vista, na data da assinatura do contrato de financiamento (item 13.4).",
  "V — PARCELAS APÓS A ENTREGA DAS CHAVES (pós-chaves), corrigidas e acrescidas de juros na forma do item 7.1, \"b\":",
  "24 parcelas mensais e sucessivas de R$ 705,89 (setecentos e cinco reais e oitenta e nove centavos), vencendo-se a primeira em 10/01/2029 (mês seguinte à entrega das chaves) e as demais no dia 10 dos meses subsequentes.",
];

test("6.1 do condomínio: o exemplo do rascunho, linha a linha; soma = 305.000,00", () => {
  assert.deepEqual(C.formaPagamentoCondominio(FLUXO).split("\n"), TEXTO_61);
  assert.equal(C.somaFluxo(FLUXO), 305000);
});

test("6.1: linha com valor 0/vazio sai e as alíneas são reletradas; inciso vazio vira 'não há'; numeração romana fixa", () => {
  const t = C.formaPagamentoCondominio({ ...FLUXO, sinal30: 0, sinal60: null, subsidio: 1500, pre1N: 0, pre1Valor: 0, posN: null, posValor: null }).split("\n");
  assert.ok(t.includes("b) R$ 3.000,00 (três mil reais), com vencimento em 07/01/2027."), t.join("\n"));
  assert.ok(!t.some((l) => l.includes("07/11/2026") || l.includes("07/12/2026")));
  assert.ok(t.includes("a) 2ª etapa: 12 parcelas mensais e sucessivas de R$ 295,49 (duzentos e noventa e cinco reais e quarenta e nove centavos), vencendo-se a primeira em 10/09/2027 e as demais no dia 10 dos meses subsequentes."));
  assert.ok(t.includes("b) Recursos do FGTS: R$ 5.250,00 (cinco mil duzentos e cinquenta reais), na data do respectivo resgate (item 13.3);"));
  assert.ok(t.includes("c) Subsídio: R$ 1.500,00 (mil e quinhentos reais)."));
  assert.ok(t.includes("V — PARCELAS APÓS A ENTREGA DAS CHAVES (pós-chaves), corrigidas e acrescidas de juros na forma do item 7.1, \"b\": não há."));
  const semTerceiros = C.formaPagamentoCondominio({ ...FLUXO, credito: 0, fgts: 0 }).split("\n");
  assert.ok(semTerceiros.includes("IV — RECURSOS DE TERCEIROS, sem correção pela VENDEDORA: não há."));
  assert.ok(!semTerceiros.some((l) => l.startsWith("Na hipótese")), "sem recursos de terceiros, sem a frase da diferença");
  const uma = C.formaPagamentoCondominio({ ...FLUXO, posN: 1 }).split("\n").at(-1);
  assert.equal(uma, "1 parcela de R$ 705,89 (setecentos e cinco reais e oitenta e nove centavos), com vencimento em 10/01/2029 (mês seguinte à entrega das chaves).");
});

test("negrito: começo do 6.1 até o extenso, cabeçalhos dos incisos inteiros, 'FIADOR n:'; o resto não", () => {
  assert.equal(TEXTO_61[0].slice(0, C.negritoDaLinha(TEXTO_61[0])), "6.1. Preço total: R$ 305.000,00 (trezentos e cinco mil reais),");
  assert.equal(C.negritoDaLinha(TEXTO_61[1]), TEXTO_61[1].length);
  assert.equal(C.negritoDaLinha(TEXTO_61[2]), 0);
  assert.equal(C.negritoDaLinha("FIADOR 2: Fulano"), "FIADOR 2:".length);
});

const FIADOR = { nome: "FIADOR UM TESTE", cpf: "12345678909", rg: "RG 1112223 SSP/GO", nacionalidade: "brasileiro",
  endereco: "Rua das Acácias", numero: "100", setor: "Setor Teste", cidade: "Cidade Teste/GO", cep: "74000-000", email: "fiador1@teste.invalid" };

test("qualificação dos fiadores: FIADOR 1/2 na ordem dos preenchidos, CPF formatado, sem estado civil/profissão", () => {
  const q = C.qualificacaoFiadores([{ nome: "" }, FIADOR, { ...FIADOR, nome: "FIADORA DOIS TESTE", cpf: "987.654.321-00", rg: "4445556", numero: "", email: "" }]);
  assert.deepEqual(q.split("\n"), [
    "FIADOR 1: FIADOR UM TESTE, brasileiro, RG nº 1112223 SSP/GO, CPF nº 123.456.789-09, residente e domiciliado à Rua das Acácias, nº 100, Setor Teste, Cidade Teste/GO, CEP 74000-000, e-mail fiador1@teste.invalid.",
    "FIADOR 2: FIADORA DOIS TESTE, brasileiro, RG nº 4445556, CPF nº 987.654.321-00, residente e domiciliado à Rua das Acácias, Setor Teste, Cidade Teste/GO, CEP 74000-000.",
  ]);
  assert.equal(C.qualificacaoFiadores([{ nome: "" }, { nome: "  " }]), "");
});

/* fontes no formato do ctrFontes_ (venda + condomínio) */
function fontes({ condominio = {}, venda = {}, fiadores = [FIADOR] } = {}) {
  return {
    venda: Object.assign({
      CLIENTES: "COMPRADORA TESTE", CPF: "529.982.247-25",
      COMPRADOR1: { nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO", endereco: "RUA TESTE, 10" },
      COMPRADOR2: { nome: "" }, ENDERECO: "CONDOMÍNIO RESERVA TESTE", VALOR_CONTRATO: 305000, COMISSAO: 15250, VALOR_NA_MAO: null,
      CORRETOR: "Corretor Teste", COMISSAO_PAGA_POR: "COMPRADOR",
      MATRICULA_INDIVIDUAL: "M-13", CRI: "1º CRI de Teste", ALVARA_NUMERO: "AL-1", ALVARA_DATA: "2026-01-10", PRAZO_CONCLUSAO: "2028-12-01",
    }, venda),
    obra: { proprietario: "SPE TESTE LTDA", obraFinalizada: "NÃO" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", endereco: "RUA SEDE, 1", representanteNome: "REPRESENTANTE TESTE",
      representanteCpf: "111.444.777-35", representanteRg: "7654321", representanteNacionalidade: "brasileiro", representanteEstadoCivil: "casado",
      banco: "BANCO TESTE", agencia: "0001", conta: "12345-6", pix: "00000000000191" },
    loteamento: { denominacao: "Condomínio Reserva Teste", municipioUf: "Cidade Teste/GO", matricula: "M-500", cartorio: "Cartório Teste" },
    corretor: { nome: "Corretor Teste", creci: "40167", cpfCnpj: "246.813.579-28" },
    condominio: Object.assign({ nome: "CONDOMÍNIO RESERVA TESTE", unidade: "13", areaPrivativa: 70.5, fracaoIdeal: "0,0125", fluxo: FLUXO, fiadores }, condominio),
    hojeISO: "2026-10-07",
  };
}

test("condomínio completo: modelo CONDOMINIO, sem faltas nem avisos, comissão paga pelo vendedor fora do preço", () => {
  const d = C.montarDadosContrato(fontes());
  assert.equal(d.modelo, "CONDOMINIO");
  assert.deepEqual(C.faltasContrato(d), []);
  assert.deepEqual(C.avisosContrato(d), []);
  assert.equal(d.comissao.pagaPor, "VENDEDOR");
  assert.equal(d.negociacao.aquisicao, 305000);
  const m = C.marcadores(d), b = C.blocos(d);
  assert.equal(m.VALOR_TOTAL, "R$ 305.000,00");
  assert.equal(m.VALOR_INTERMEDIACAO, "paga pelo VENDEDOR");
  assert.equal(m.CONDOMINIO_NOME, "RESERVA TESTE");
  assert.equal(m.UNIDADE, "13");
  assert.equal(m.AREA_PRIVATIVA, "70,50");
  assert.equal(m.FRACAO_IDEAL, "0,0125");
  assert.equal(m.FORMA_PAGAMENTO_CONDOMINIO, TEXTO_61.join("\n"));
  assert.equal(m.FIADOR1_NOME, "FIADOR UM TESTE");
  assert.equal(m.FIADOR1_CPF, "123.456.789-09");
  assert.equal(m.FIADOR2_NOME, "");
  assert.deepEqual([b.TEM_FIADORES, b.TEM_FIADOR1, b.TEM_FIADOR2], [true, true, false]);
  assert.ok(C.MARCADORES_PARAGRAFOS.includes("FORMA_PAGAMENTO_CONDOMINIO") && C.MARCADORES_PARAGRAFOS.includes("FIADORES_QUALIFICACAO"));
});

test("escolherModelo: condomínio vence a obra pronta; fora do condomínio nada muda", () => {
  assert.equal(C.escolherModelo("SIM", true), "CONDOMINIO");
  assert.equal(C.escolherModelo("NÃO", true), "CONDOMINIO");
  assert.equal(C.escolherModelo("SIM"), "PRONTO");
  assert.equal(C.escolherModelo("NÃO", false), "CONSTRUCAO");
  const semCond = C.montarDadosContrato({ ...fontes(), condominio: null });
  assert.equal(semCond.modelo, "CONSTRUCAO");
  assert.equal("condominio" in semCond, false, "fora do condomínio a chave nem existe (carimbo dos PDFs antigos)");
  assert.deepEqual(C.avisosContrato(semCond), []);
});

test("condomínio não exige lote/quadra/área do lote/confrontações nem sinal/entrada/forma/comissão da casa de rua", () => {
  const faltas = C.faltasContrato(C.montarDadosContrato(fontes()));
  for (const f of faltas) assert.ok(!/lote e quadra|área do lote|Confronta|Negociação/.test(f), f);
});

test("dados do imóvel em branco NÃO travam: viram aviso e '____' no contrato (decisão do dono)", () => {
  const d = C.montarDadosContrato(fontes({ condominio: { unidade: "", areaPrivativa: null, fracaoIdeal: "" },
    venda: { MATRICULA_INDIVIDUAL: "", CRI: "", ALVARA_NUMERO: "", ALVARA_DATA: "", PRAZO_CONCLUSAO: "" } }));
  assert.deepEqual(C.faltasContrato(d), []);
  assert.deepEqual(C.avisosContrato(d), [
    "Em branco no contrato: unidade", "Em branco no contrato: área privativa", "Em branco no contrato: fração ideal",
    "Em branco no contrato: matrícula individual", "Em branco no contrato: CRI da matrícula", "Em branco no contrato: alvará (número)",
    "Em branco no contrato: alvará (data)", "Em branco no contrato: prazo previsto de conclusão das obras"]);
  const m = C.marcadores(d);
  for (const k of ["UNIDADE", "AREA_PRIVATIVA", "FRACAO_IDEAL", "MATRICULA_INDIVIDUAL", "CRI", "ALVARA_NUMERO", "ALVARA_DATA", "PRAZO_CONCLUSAO"])
    assert.equal(m[k], "____", k);
  /* fora do condomínio o branco continua vazio (e a falta continua travando) */
  const rua = C.marcadores(C.montarDadosContrato({ ...fontes({ venda: { CRI: "" } }), condominio: null }));
  assert.equal(rua.CRI, "");
});

test("faltas que travam: assinatura, dia, entrega, valor de venda, fluxo que não fecha (tolerância 0,05), datas das séries", () => {
  const f = (fl) => C.faltasContrato(C.montarDadosContrato(fontes({ condominio: { fluxo: { ...FLUXO, ...fl } } })));
  assert.deepEqual(f({ assinatura: "", diaPagamento: null, entrega: "" }), [
    "Fluxo de pagamento: data de assinatura do contrato", "Fluxo de pagamento: dia de pagamento das parcelas", "Fluxo de pagamento: data da entrega"]);
  assert.deepEqual(f({ diaPagamento: 32 }), ["Fluxo de pagamento: dia de pagamento das parcelas"]);
  assert.deepEqual(f({ valorVenda: null }), ["Fluxo de pagamento: valor de venda"]);
  assert.deepEqual(f({ valorVenda: 305000.05 }), [], "0,05 de diferença passa");
  assert.deepEqual(f({ valorVenda: 305000.06 }), ["Fluxo de pagamento: soma R$ 305.000,00 e não fecha com o valor de venda R$ 305.000,06"]);
  assert.deepEqual(f({ balao2Valor: 6267.78 }), ["Fluxo de pagamento: soma R$ 304.999,90 e não fecha com o valor de venda R$ 305.000,00"]);
  assert.deepEqual(f({ data60: "", pre2Data: "", posN: null, valorVenda: 288058.64 }), [
    "Fluxo de pagamento: sinal 60 dias (data)", "Fluxo de pagamento: 2ª parte pré-chaves (data da 1ª)", "Fluxo de pagamento: pós-chaves (nº de parcelas)"]);
});

test("comprador: CPF inválido trava no condomínio", () => {
  const faltas = C.faltasContrato(C.montarDadosContrato(fontes({ venda: { CPF: "529.982.247-24" } })));
  assert.deepEqual(faltas, ["Comprador 1: CPF inválido"]);
});

test("fiador com nome exige CPF válido, RG e endereço; CPF repetido (comprador ou entre fiadores) é só aviso", () => {
  const d = C.montarDadosContrato(fontes({ fiadores: [{ ...FIADOR, cpf: "123.456.789-00", rg: "", endereco: "" }, { nome: "FIADORA DOIS TESTE" }] }));
  assert.deepEqual(C.faltasContrato(d), ["Fiador 1: CPF inválido", "Fiador 1: RG", "Fiador 1: endereço", "Fiador 2: CPF", "Fiador 2: RG", "Fiador 2: endereço"]);
  const rep = C.montarDadosContrato(fontes({ fiadores: [{ ...FIADOR, cpf: "529.982.247-25" }, { ...FIADOR, nome: "FIADORA DOIS TESTE", cpf: "52998224725" }] }));
  assert.deepEqual(C.faltasContrato(rep), []);
  assert.deepEqual(C.avisosContrato(rep), ["Fiador 1: CPF igual ao de um comprador", "Fiador 2: CPF igual ao de um comprador", "Fiadores: os dois têm o mesmo CPF"]);
  const semFiador = C.montarDadosContrato(fontes({ fiadores: [{ nome: "" }, { nome: "" }] }));
  assert.deepEqual(C.faltasContrato(semFiador), []);
  assert.deepEqual([C.blocos(semFiador).TEM_FIADORES, C.marcadores(semFiador).FIADORES_QUALIFICACAO], [false, ""]);
});

test("empreendimento (LOTEAMENTOS) ausente no condomínio: falta que diz qual linha criar", () => {
  const faltas = C.faltasContrato(C.montarDadosContrato({ ...fontes(), loteamento: null }));
  assert.deepEqual(faltas, ["Condomínio: cadastro em LOTEAMENTOS – CONTRATO (linha com o nome do condomínio, igual ao ENDEREÇO da casa)"]);
});

/* ---------------- GerarContrato.gs com Notion/Docs/Drive falsos ---------------- */
const DIA = 86400000;
const token = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + DIA });
const PAGE = PAGE_ID_PADRAO, OBRA = "fedcba9876543210fedcba9876543210", COND = "00112233445566778899aabbccddeeff";
const tit = (s) => ({ title: [{ type: "text", plain_text: s, text: { content: s } }] });
const sel = (s) => ({ select: s === null ? null : { name: s } });
const num = (n) => ({ number: n });
const dat = (s) => ({ date: s ? { start: s } : null });
const rel = (id) => ({ relation: [{ id }] });
const rt = texto;

function colunasVenda() {
  const c = Object.assign({}, COLUNAS_REAIS, {
    " VALOR NA MÃO ": "number", "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": "number", " COMISSÃO ": "number",
    CORRETOR: { tipo: "select", opcoes: ["Corretor Teste"] }, SETOR: { tipo: "select", opcoes: [] }, "OBRA-AUTO": "relation", CASA: "rich_text",
    "CONDOMÍNIO - VENDA ID": "rich_text",
  });
  for (const [nome, tipo] of Object.entries(C.TIPOS))
    c[nome] = tipo === "select" ? { tipo, opcoes: ["PIX", "COMPRADOR", "VENDEDOR"] } : tipo;
  return c;
}
const CASA = {
  "ENDEREÇO": tit("CONDOMÍNIO RESERVA TESTE"), CASA: rt("13"), "CONDOMÍNIO - VENDA ID": rt(COND),
  "CLIENTES ": rt("Compradora de Teste"), "CPF ": rt("529.982.247-25"),
  "COMPRADOR 1 - DOCUMENTO": rt("RG 1234567 SSP/GO"), "COMPRADOR 1 - NACIONALIDADE": rt("brasileira"),
  "COMPRADOR 1 - ESTADO CIVIL": rt("solteira"), "COMPRADOR 1 - PROFISSÃO": rt("analista"), "COMPRADOR 1 - ENDEREÇO": rt("Rua das Palmeiras, 10"),
  "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": num(305000), " COMISSÃO ": num(15250),
  CORRETOR: sel("Corretor Teste"), "OBRA-AUTO": rel(OBRA),
  /* o que a casa tem de diferente da linha do condomínio perde para ela */
  "CONTRATO - MATRÍCULA INDIVIDUAL": rt("M-DA-CASA"),
};
/* linha da BANCO DE DADOS VENDAS CONDOMÍNIO, com os nomes de coluna da base (espaços sobrando inclusive) */
const LINHA_COND = {
  UNIDADE: tit("UN 13"), "CONDOMÍNIO": sel("CONDOMÍNIO RESERVA TESTE"),
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
  "FIADOR 1": rt("Fiador Um Teste"), "CPF FIADOR 1": rt("12345678909"), "RG FIADOR 1": rt("1112223 SSP/GO"),
  "NACIONALIDADE  FIADOR 1": rt("brasileiro"), "ENDERECO FIADOR 1": rt("Rua das Acácias"), "NUMERO FIADOR 1": rt("100"),
  "SETOR FIADOR 1": rt("Setor Teste"), "CIDADE FIADOR 1": rt("Cidade Teste/GO"), "CEP FIADOR 1": rt("74000-000"),
  "EMAIL FIADOR 1": { email: "fiador1@teste.invalid" }, "FIADOR 2": rt(""),
  CORRETOR: rt("Corretor Teste"), CRECI: num(40167), "CPF CORRETOR": rt("246.813.579-28"), "EMAIL CORRETOR": { email: "corretor@teste.invalid" },
};
const OBRA_PG = { "PROPRIETARIO DOCUMENTO": rt("Construtora Teste Ltda"), "CPF/CNPJ ": sel("00.000.000/0001-00"), "OBRA FINALIZADA?": sel("SIM") };
const VENDEDOR = {
  NOME: tit("Construtora Teste Ltda"), TIPO: sel("PJ"), "CPF/CNPJ": rt("00.000.000/0001-00"), "ENDEREÇO / SEDE": rt("Av. Teste, 100"),
  "REPRESENTANTE NOME": rt("Beltrano Representante"), "REPRESENTANTE CPF": rt("111.444.777-35"),
  "REPRESENTANTE RG": rt("RG 7654321 SSP/GO"), "REPRESENTANTE NACIONALIDADE": rt("brasileiro"), "REPRESENTANTE ESTADO CIVIL": rt("casado"),
  BANCO: rt("Banco Teste"), "AGÊNCIA": rt("0001"), CONTA: rt("12345-6"), PIX: rt("pix@teste.example"),
};
const EMPREENDIMENTO = { SETOR: tit("Condomínio  Reserva Teste"), "DENOMINAÇÃO": rt("Condomínio Reserva Teste"), "MUNICÍPIO/UF": rt("Cidade Teste/GO"),
  "MATRÍCULA DO LOTEAMENTO": rt("M-500"), "CARTÓRIO": rt("Cartório Teste") };
const LOTEAMENTO_DO_SETOR = { SETOR: tit("Setor Teste"), "DENOMINAÇÃO": rt("Loteamento Errado"), "MUNICÍPIO/UF": rt("X/GO"),
  "MATRÍCULA DO LOTEAMENTO": rt("M-1"), "CARTÓRIO": rt("Cartório X") };

const MODELO_COND = [
  "CONTRATO — CONDOMÍNIO {{CONDOMINIO_NOME}}",
  "VENDEDOR: {{VENDEDOR_NOME}} — empreendimento {{MUNICIPIO_UF}}, matrícula {{MATRICULA_LOTEAMENTO}}",
  "COMPRADOR: {{COMPRADORES}}",
  "{{#TEM_FIADORES}}", "1-A. FIADORES E PRINCIPAIS PAGADORES", "{{FIADORES_QUALIFICACAO}}", "{{/TEM_FIADORES}}",
  "a) Unidade autônoma nº {{UNIDADE}}, área privativa {{AREA_PRIVATIVA}} m², fração ideal {{FRACAO_IDEAL}}",
  "b) Matrícula {{MATRICULA_INDIVIDUAL}}, CRI de {{CRI}}; alvará {{ALVARA_NUMERO}} de {{ALVARA_DATA}}; conclusão {{PRAZO_CONCLUSAO}}",
  "Valor: {{VALOR_TOTAL}}; intermediação {{VALOR_INTERMEDIACAO}}",
  "{{FORMA_PAGAMENTO_CONDOMINIO}}",
  "6.1-A. Os valores das parcelas são nominais.",
  "Corretor {{CORRETOR_NOME}}, CRECI {{CORRETOR_CRECI}}, CPF {{CORRETOR_DOC}}",
  "{{#TEM_FIADOR1}}", "{{FIADOR1_NOME}} — CPF {{FIADOR1_CPF}} — FIADOR", "{{/TEM_FIADOR1}}",
  "{{#TEM_FIADOR2}}", "{{FIADOR2_NOME}} — CPF {{FIADOR2_CPF}} — FIADOR", "{{/TEM_FIADOR2}}",
  "TESTEMUNHAS",
];

function cenario({ casa = {}, linha = {}, props = {}, condDb = "db-cond", loteamentos } = {}) {
  const d = driveFalso({ modelos: { "modelo-cond": MODELO_COND, "modelo-obra": ["OBRA {{LOTE}}"], "modelo-pronto": ["PRONTO {{LOTE}}"] } });
  const mescla = (base, mud) => { const r = { ...base }; for (const [k, v] of Object.entries(mud)) { if (v === null) delete r[k]; else r[k] = v; } return r; };
  const cols = colunasVenda();
  const valores = Object.fromEntries(Object.entries(mescla(CASA, casa)).filter(([k]) => k in cols));
  const n = notionFalso({
    colunas: cols, valores,
    paginasExtras: { [OBRA]: OBRA_PG, [COND]: mescla(LINHA_COND, linha) }, paginasDb: { [OBRA]: "db-doc", [COND]: condDb },
    bases: { "db-vend": [VENDEDOR], "db-lote": loteamentos || [LOTEAMENTO_DO_SETOR, EMPREENDIMENTO], "db-corr": [],
             "db-doc": [Object.assign({ "ENDEREÇO": tit("CONDOMÍNIO RESERVA TESTE") }, OBRA_PG)] },
  });
  const p = Object.assign({
    NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO, DB_VENDAS_COND: "db-cond",
    DB_VENDEDORES: "db-vend", DB_LOTEAMENTOS: "db-lote", DB_CORRETORES: "db-corr", DB_DOCUMENTOS: "db-doc",
    MODELO_PRONTO_ID: "modelo-pronto", MODELO_CONSTRUCAO_ID: "modelo-obra", MODELO_CONDOMINIO_ID: "modelo-cond", PASTA_PROVISORIA_ID: "pasta-prov",
  }, props);
  for (const [k, v] of Object.entries(props)) if (v === null) delete p[k];
  const g = criarGas({ props: p, rotas: n.rota, extras: d.extras });
  const gerar = () => g.chamar({ action: "gerarContrato", token: token(), pageId: PAGE });
  const salvo = () => d.estado.salvos[d.estado.copias[0].id];
  return { g, n, d, gerar, salvo };
}

test("GerarContrato: casa do condomínio usa MODELO_CONDOMINIO_ID, lê fluxo/fiador/unidade da linha do condomínio e expande o 6.1 em parágrafos", () => {
  const c = cenario();
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.avisos, undefined);
  const pars = c.salvo().pars;
  assert.ok(!pars.join("\n").includes("{{"), pars.join("\n"));
  assert.equal(pars[0], "CONTRATO — CONDOMÍNIO RESERVA TESTE");
  assert.equal(pars[1], "VENDEDOR: Construtora Teste Ltda — empreendimento Cidade Teste/GO, matrícula M-500", "empreendimento pelo nome do condomínio, não pelo SETOR");
  assert.ok(pars.includes("FIADOR 1: Fiador Um Teste, brasileiro, RG nº 1112223 SSP/GO, CPF nº 123.456.789-09, residente e domiciliado à Rua das Acácias, nº 100, Setor Teste, Cidade Teste/GO, CEP 74000-000, e-mail fiador1@teste.invalid."));
  assert.ok(pars.includes("a) Unidade autônoma nº UN 13, área privativa 70,50 m², fração ideal 0,0125"));
  assert.ok(pars.includes("b) Matrícula M-13, CRI de 1º CRI de Teste; alvará AL-1 de 10/01/2026; conclusão 01/12/2028"), "a linha do condomínio vence a casa");
  assert.ok(pars.includes("Valor: R$ 305.000,00; intermediação paga pelo VENDEDOR"));
  const i = pars.indexOf(TEXTO_61[0]);
  assert.ok(i > 0, "6.1 sozinho no parágrafo");
  assert.deepEqual(pars.slice(i, i + TEXTO_61.length), TEXTO_61, "uma linha por parágrafo, na ordem");
  assert.equal(pars[i + TEXTO_61.length], "6.1-A. Os valores das parcelas são nominais.");
  assert.ok(pars.includes("Corretor Corretor Teste, CRECI 40167, CPF 246.813.579-28"), "corretor da linha do condomínio");
  assert.ok(pars.includes("Fiador Um Teste — CPF 123.456.789-09 — FIADOR"));
  assert.ok(!pars.some((l) => l.includes("FIADOR2") || l.endsWith("— CPF  — FIADOR")), "sem fiador 2, o bloco some");
  /* negrito: começo do 6.1, os 5 cabeçalhos de inciso e o "FIADOR 1:" */
  const neg = c.salvo().negritos.map((x) => x.texto.slice(x.negrito[0][0], x.negrito[0][1] + 1));
  assert.deepEqual(neg, ["FIADOR 1:", "6.1. Preço total: R$ 305.000,00 (trezentos e cinco mil reais),",
    TEXTO_61[1], TEXTO_61[6], TEXTO_61[9], TEXTO_61[12], TEXTO_61[16]]);
  assert.match(r.nome, /^CONTRATO - CONDOMÍNIO RESERVA TESTE - CASA 13 - /);
  assert.deepEqual(c.d.estado.removidas, [c.d.estado.copias[0].id]);
});

test("GerarContrato: dado do imóvel em branco gera com '____' e devolve avisos; fiador repetido também só avisa", () => {
  const c = cenario({ casa: { "CONTRATO - MATRÍCULA INDIVIDUAL": null },
    linha: { "CONTRATO - MATRÍCULA INDIVIDUAL": rt(""), "CONTRATO - FRAÇÃO IDEAL": rt(""), "CPF FIADOR 1": rt("529.982.247-25") } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.avisos, ["Em branco no contrato: fração ideal", "Em branco no contrato: matrícula individual", "Fiador 1: CPF igual ao de um comprador"]);
  const pars = c.salvo().pars;
  assert.ok(pars.includes("a) Unidade autônoma nº UN 13, área privativa 70,50 m², fração ideal ____"), pars.join("\n"));
  assert.ok(pars.some((l) => l.startsWith("b) Matrícula ____, CRI de 1º CRI de Teste")));
});

test("GerarContrato: fluxo que não fecha trava (FALTAM_DADOS), sem cópia no Drive", () => {
  const c = cenario({ linha: { "VALOR DE VENDA": num(310000) } });
  const r = c.gerar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Fluxo de pagamento: soma R$ 305.000,00 e não fecha com o valor de venda R$ 310.000,00"]);
  assert.equal(c.d.estado.copias.length, 0);
});

test("GerarContrato: CONDOMÍNIO - VENDA ID de outra base, página inexistente ou DB_VENDAS_COND ausente = falta clara, sem cópia", () => {
  const casos = [
    [cenario({ condDb: "db-outra" }), "Condomínio: CONDOMÍNIO - VENDA ID aponta para uma página que não é da BANCO DE DADOS VENDAS CONDOMÍNIO"],
    [cenario({ casa: { "CONDOMÍNIO - VENDA ID": rt("ffffffffffffffffffffffffffffffff") } }), "Condomínio: a linha da venda do condomínio (CONDOMÍNIO - VENDA ID) não foi encontrada"],
    [cenario({ casa: { "CONDOMÍNIO - VENDA ID": rt("nao-e-id") } }), "Condomínio: CONDOMÍNIO - VENDA ID inválido na casa"],
    [cenario({ props: { DB_VENDAS_COND: null } }), "Condomínio: Propriedade DB_VENDAS_COND não configurada"],
  ];
  for (const [c, falta] of casos) {
    const r = c.gerar();
    assert.deepEqual(r, { ok: false, erro: "FALTAM_DADOS", faltas: [falta] });
    assert.equal(c.d.estado.copias.length, 0);
  }
});

test("GerarContrato: sem MODELO_CONDOMINIO_ID -> MODELO_NAO_CONFIGURADO (não cai no modelo da casa de rua)", () => {
  const c = cenario({ props: { MODELO_CONDOMINIO_ID: "" } });
  assert.equal(c.gerar().erro, "MODELO_NAO_CONFIGURADO");
  assert.equal(c.d.estado.copias.length, 0);
});

test("GerarContrato: sem a linha do empreendimento em LOTEAMENTOS, a falta diz o que criar (o SETOR não é usado)", () => {
  const r = cenario({ loteamentos: [LOTEAMENTO_DO_SETOR] }).gerar();
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas, ["Condomínio: cadastro em LOTEAMENTOS – CONTRATO (linha com o nome do condomínio, igual ao ENDEREÇO da casa)"]);
});

test("GerarContrato: carimbo do condomínio muda com o fluxo e com o fiador", () => {
  const carimbo = (linha) => /\[#([0-9a-f]{8})\]\.pdf$/.exec(cenario({ linha }).gerar().nome)[1];
  const base = carimbo({});
  assert.equal(carimbo({}), base);
  assert.notEqual(carimbo({ "DIA PAGAMENTO PARCELAS": num(15) }), base);
  assert.notEqual(carimbo({ "RG FIADOR 1": rt("9998887") }), base);
});

test("GerarContrato do condomínio: nenhum log com nome, CPF ou valor", () => {
  const c = cenario();
  c.gerar();
  cenario({ condDb: "db-outra" }).gerar();
  const todos = c.g.logs.join("\n");
  for (const s of ["Fiador", "Compradora", "529.982", "123.456", "305", "Reserva", "RESERVA"]) assert.ok(!todos.includes(s), "log vazou: " + s);
});
