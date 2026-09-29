import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../ContratoVenda.js");

test("moedaBR e valorPorExtenso", () => {
  assert.equal(C.moedaBR(300000), "300.000,00");
  assert.equal(C.moedaBR(1234.5), "1.234,50");
  const casos = [
    [0, "zero reais"], [1, "um real"], [1.5, "um real e cinquenta centavos"], [21, "vinte e um reais"],
    [100, "cem reais"], [101, "cento e um reais"], [1000, "mil reais"], [1100, "mil e cem reais"],
    [1250, "mil duzentos e cinquenta reais"], [245000, "duzentos e quarenta e cinco mil reais"],
    [300000, "trezentos mil reais"], [1000000, "um milhão de reais"], [2500000, "dois milhões e quinhentos mil reais"],
    [1250300, "um milhão duzentos e cinquenta mil e trezentos reais"],
    [180000.35, "cento e oitenta mil reais e trinta e cinco centavos"], [0.01, "um centavo"],
  ];
  for (const [n, t] of casos) assert.equal(C.valorPorExtenso(n), t, String(n));
});

test("datas", () => {
  assert.equal(C.dataBR("2026-09-29"), "29/09/2026");
  assert.equal(C.dataPorExtenso("2026-09-29"), "29 de setembro de 2026");
  assert.equal(C.dataPorExtenso("2026-01-01"), "1º de janeiro de 2026");
  assert.equal(C.dataBR(null), "");
});

test("loteQuadra e escolherModelo", () => {
  assert.deepEqual(C.loteQuadra("APOLO LYKEIOS QD 01 LT 35"), { lote: "35", quadra: "01" });
  assert.deepEqual(C.loteQuadra("RR 17 QD. 02-A LT 26"), { lote: "26", quadra: "02-A" });
  assert.equal(C.loteQuadra("RUA SEM NUMERO"), null);
  assert.equal(C.escolherModelo("SIM"), "PRONTO");
  assert.equal(C.escolherModelo("sim "), "PRONTO");
  assert.equal(C.escolherModelo("NÃO"), "CONSTRUCAO");
  assert.equal(C.escolherModelo(null), "CONSTRUCAO");
});

function fontes(extra = {}) {
  const base = {
    venda: { CLIENTES: "ANA TESTE", CPF: "529.982.247-25",
      COMPRADOR1: { nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO", endereco: "RUA TESTE, 10, GOIÂNIA/GO" },
      COMPRADOR2: { nome: "", cpf: "", nacionalidade: "", estadoCivil: "", profissao: "", documento: "", endereco: "" },
      ENDERECO: "APOLO LYKEIOS QD 01 LT 35", VALOR_CONTRATO: 300000, VALOR_NA_MAO: 290000, COMISSAO: 10000, DATA_VENDA: "2026-09-28", CORRETOR: "teste",
      ALVARA_NUMERO: "1.238", ALVARA_DATA: "2025-10-23", HABITESE_NUMERO: "77", MATRICULA_INDIVIDUAL: "99.999", CRI: "Senador Canedo", AREA: 125, CONFRONTACOES: "frente para a rua teste",
      SINAL_VALOR: 5000, SINAL_DATA: "2026-09-28", ENTRADA_VALOR: 20000, ENTRADA_VENCIMENTO: "2026-10-28", INTERMEDIARIA_VALOR: null, INTERMEDIARIA_VENCIMENTO: null,
      FORMA_PAGAMENTO: "PIX", COMISSAO_FORMA: "PIX", COMISSAO_VENCIMENTO: "na data de assinatura do contrato de financiamento", COMISSAO_PAGA_POR: "COMPRADOR", PRAZO_CONCLUSAO: "2027-03-01", CONDICOES_ESPECIAIS: "" },
    obra: { proprietario: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", obraFinalizada: "SIM", cidade: "Senador Canedo", dataHabitese: "2026-08-01" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", endereco: "RUA SEDE, 1", representanteNome: "REPRESENTANTE TESTE", representanteCpf: "111.444.777-35", representanteRg: "7654321", representanteNacionalidade: "brasileiro", representanteEstadoCivil: "casado",
      nacionalidade: "", estadoCivil: "", profissao: "", rg: "", banco: "BANCO TESTE", agencia: "0001", operacao: "", conta: "12345-6", pix: "00000000000191" },
    loteamento: { denominacao: "LOTEAMENTO TESTE", municipioUf: "Senador Canedo/GO", matricula: "64.613", cartorio: "Senador Canedo", prazoPosseDias: "30", prazoChavesDias: "10" },
    corretor: { nome: "teste", creci: "40.167", cpfCnpj: "111.444.777-35", nacionalidade: "brasileira", endereco: "RUA CORRETOR, 5", email: "corretor@teste.invalid" },
    hojeISO: "2026-09-29", cidadeAssinatura: "Goiânia",
  };
  return Object.assign(base, extra);
}

test("dados completos: nenhuma falta, modelo PRONTO, valores com comprador pagando comissão", () => {
  const d = C.montarDadosContrato(fontes());
  assert.deepEqual(C.faltasContrato(d), []);
  assert.equal(d.modelo, "PRONTO");
  const m = C.marcadores(d);
  assert.equal(m.VALOR_IMOVEL, "290.000,00");
  assert.equal(m.VALOR_INTERMEDIACAO, "R$ 10.000,00");
  assert.equal(m.VALOR_TOTAL, "R$ 300.000,00");
  assert.equal(m.VALOR_TOTAL_NUM, "300.000,00");
  assert.equal(m.VALOR_TOTAL_EXTENSO, "trezentos mil reais");
  assert.equal(m.LOTE, "35");
  assert.equal(m.QUADRA, "01");
  assert.equal(m.CIDADE_DATA, "Goiânia, 29 de setembro de 2026");
  assert.equal(m.COMPRADORES, "ANA TESTE, brasileira, solteira, professora, RG nº 1234567 SSP/GO, CPF nº 529.982.247-25, residente e domiciliado à RUA TESTE, 10, GOIÂNIA/GO");
  assert.equal(m.SINAL_DATA, "28/09/2026");
  const b = C.blocos(d);
  assert.deepEqual(b, { SE_VENDEDOR_PJ: true, SE_VENDEDOR_PF: false, SE_INTERMEDIARIA: false, SEM_INTERMEDIARIA: true, SE_COMISSAO_VENDEDOR: false });
  for (const [k, v] of Object.entries(m)) assert.equal(typeof v, "string", k);
});

test("casal: os dois no item COMPRADOR(ES)", () => {
  const f = fontes();
  f.venda.CLIENTES = "ANA TESTE E BRUNO TESTE";
  f.venda.COMPRADOR2 = { nome: "BRUNO TESTE", cpf: "111.444.777-35", nacionalidade: "brasileiro", estadoCivil: "casado", profissao: "motorista", documento: "RG 999 SSP/GO", endereco: "RUA TESTE, 10, GOIÂNIA/GO" };
  f.venda.COMPRADOR1.estadoCivil = "casada";
  const m = C.marcadores(C.montarDadosContrato(f));
  assert.match(m.COMPRADORES, /^ANA TESTE, .*; e BRUNO TESTE, brasileiro, casado, motorista, RG nº 999 SSP\/GO, CPF nº 111\.444\.777-35, /);
});

test("comprador 2 incompleto é falta", () => {
  const f = fontes();
  f.venda.COMPRADOR2 = { nome: "BRUNO TESTE", cpf: "", nacionalidade: "", estadoCivil: "", profissao: "", documento: "", endereco: "" };
  const faltas = C.faltasContrato(C.montarDadosContrato(f));
  assert.ok(faltas.includes("Comprador 2: CPF"));
  assert.ok(faltas.includes("Comprador 2: profissão"));
});

test("vendedor PF, comissão paga pelo vendedor e intermediária", () => {
  const f = fontes();
  f.vendedor = Object.assign({}, f.vendedor, { tipo: "PF", nome: "INVESTIDOR TESTE", cpfCnpj: "111.444.777-35", nacionalidade: "brasileiro", estadoCivil: "casado", profissao: "empresário", rg: "5555 SSP/GO", representanteNome: "" });
  f.venda.COMISSAO_PAGA_POR = "VENDEDOR";
  f.venda.INTERMEDIARIA_VALOR = 250000; f.venda.INTERMEDIARIA_VENCIMENTO = "2026-12-01";
  const d = C.montarDadosContrato(f);
  assert.deepEqual(C.faltasContrato(d), []);
  const m = C.marcadores(d), b = C.blocos(d);
  assert.deepEqual(b, { SE_VENDEDOR_PJ: false, SE_VENDEDOR_PF: true, SE_INTERMEDIARIA: true, SEM_INTERMEDIARIA: false, SE_COMISSAO_VENDEDOR: true });
  assert.equal(m.VALOR_IMOVEL, "300.000,00");
  assert.equal(m.VALOR_INTERMEDIACAO, "paga pelo VENDEDOR");
  assert.equal(m.VALOR_TOTAL, "R$ 300.000,00");
  assert.equal(m.COMISSAO_RESPONSAVEL, "INVESTIDOR TESTE");
  assert.equal(m.INTERMEDIARIA_VALOR, "250.000,00");
});

test("faltas agrupadas e legíveis; cadastros ausentes", () => {
  const f = fontes({ vendedor: null, loteamento: null, corretor: null });
  f.venda.SINAL_VALOR = null; f.venda.ENDERECO = "SEM QUADRA";
  const faltas = C.faltasContrato(C.montarDadosContrato(f));
  assert.ok(faltas.includes("Vendedor: cadastro em VENDEDORES – CONTRATO"));
  assert.ok(faltas.includes("Loteamento: cadastro em LOTEAMENTOS – CONTRATO"));
  assert.ok(faltas.includes("Corretor: cadastro em CORRETORES – CONTRATO"));
  assert.ok(faltas.includes("Negociação: sinal (valor)"));
  assert.ok(faltas.includes("Imóvel: lote e quadra no endereço"));
});

test("modelo em construção não exige habite-se", () => {
  const f = fontes(); f.obra.obraFinalizada = "NÃO"; f.venda.HABITESE_NUMERO = ""; f.obra.dataHabitese = null;
  const d = C.montarDadosContrato(f);
  assert.equal(d.modelo, "CONSTRUCAO");
  assert.deepEqual(C.faltasContrato(d), []);
});

test("alvará é exigido nos dois modelos", () => {
  const f = fontes(); f.obra.obraFinalizada = "NÃO"; f.venda.ALVARA_NUMERO = ""; f.venda.ALVARA_DATA = null;
  const faltas = C.faltasContrato(C.montarDadosContrato(f));
  assert.ok(faltas.includes("Imóvel: alvará (número)"));
  assert.ok(faltas.includes("Imóvel: alvará (data)"));
});

test("prazos do loteamento só no modelo PRONTO", () => {
  const f = fontes(); f.loteamento.prazoPosseDias = ""; f.loteamento.prazoChavesDias = "";
  const faltas = C.faltasContrato(C.montarDadosContrato(f));
  assert.ok(faltas.includes("Loteamento: prazo de posse (dias)"));
  assert.ok(faltas.includes("Loteamento: prazo de entrega das chaves (dias)"));
  f.obra.obraFinalizada = "NÃO";
  assert.deepEqual(C.faltasContrato(C.montarDadosContrato(f)), []);
});

test("nome do comprador 1 com separadores variados", () => {
  for (const clientes of ["ANA TESTE & BRUNO TESTE", "ANA TESTE, BRUNO TESTE", "ANA TESTE e BRUNO TESTE", "ANA TESTE / BRUNO TESTE"]) {
    const f = fontes();
    f.venda.CLIENTES = clientes;
    f.venda.COMPRADOR2 = Object.assign({}, f.venda.COMPRADOR1, { nome: "BRUNO TESTE", cpf: "111.444.777-35" });
    assert.match(C.marcadores(C.montarDadosContrato(f)).COMPRADORES, /^ANA TESTE, brasileira/, clientes);
  }
  const f = fontes();
  f.venda.CLIENTES = "ANA TESTE & B. TESTE";
  f.venda.COMPRADOR2 = Object.assign({}, f.venda.COMPRADOR1, { nome: "BRUNO TESTE", cpf: "111.444.777-35" });
  assert.match(C.marcadores(C.montarDadosContrato(f)).COMPRADORES, /^ANA TESTE, brasileira/);
});

test("rótulo do documento", () => {
  assert.equal(C.qualificacao({ documento: "RG: 123 SSP/GO" }), "RG nº 123 SSP/GO");
  assert.equal(C.qualificacao({ documento: "CNH 55" }), "CNH nº 55");
  assert.equal(C.qualificacao({ documento: "Passaporte X1" }), "Passaporte X1");
});

test("valor fora do limite lança erro", () => {
  assert.throws(() => C.valorPorExtenso(1000000000), /VALOR_FORA_DO_LIMITE/);
  assert.equal(C.valorPorExtenso(999999999), "novecentos e noventa e nove milhões novecentos e noventa e nove mil novecentos e noventa e nove reais");
});

test("construção exige prazo de conclusão; corretor exige CPF/CNPJ; condições opcionais", () => {
  const f = fontes(); f.obra.obraFinalizada = "NÃO"; f.venda.PRAZO_CONCLUSAO = null; f.corretor.cpfCnpj = "";
  const faltas = C.faltasContrato(C.montarDadosContrato(f));
  assert.ok(faltas.includes("Imóvel: prazo previsto de conclusão das obras"));
  assert.ok(faltas.includes("Corretor: CPF/CNPJ"));
  assert.ok(!faltas.some((x) => /condiç/i.test(x)));
  const g = fontes(); g.venda.PRAZO_CONCLUSAO = null;
  assert.deepEqual(C.faltasContrato(C.montarDadosContrato(g)), []);
});

test("marcadores novos: prazo, condições, assinaturas, doc do corretor e do vendedor", () => {
  let m = C.marcadores(C.montarDadosContrato(fontes()));
  assert.equal(m.PRAZO_CONCLUSAO, "01/03/2027");
  assert.equal(m.CONDICOES_ESPECIAIS, "Não há.");
  assert.equal(m.ASSINATURA_COMPRADORES_NOMES, "ANA TESTE");
  assert.equal(m.ASSINATURA_COMPRADORES_CPFS, "529.982.247-25");
  assert.equal(m.CORRETOR_DOC, "111.444.777-35");
  assert.equal(m.VENDEDOR_DOC_ROTULO, "CNPJ sob o número 00.000.000/0001-91");
  assert.equal(m.REPRESENTANTE_NOME, "REPRESENTANTE TESTE");
  assert.equal(m.REPRESENTANTE_CPF, "111.444.777-35");
  const f = fontes();
  f.venda.CONDICOES_ESPECIAIS = "condição inventada";
  f.venda.CLIENTES = "ANA TESTE E BRUNO TESTE";
  f.venda.COMPRADOR2 = { nome: "BRUNO TESTE", cpf: "222.333.444-05", nacionalidade: "brasileiro", estadoCivil: "casado", profissao: "motorista", documento: "RG 999", endereco: "RUA X" };
  f.vendedor = Object.assign({}, f.vendedor, { tipo: "PF", nome: "INVESTIDOR TESTE", cpfCnpj: "333.444.555-66" });
  m = C.marcadores(C.montarDadosContrato(f));
  assert.equal(m.CONDICOES_ESPECIAIS, "condição inventada");
  assert.equal(m.ASSINATURA_COMPRADORES_NOMES, "ANA TESTE / BRUNO TESTE");
  assert.equal(m.ASSINATURA_COMPRADORES_CPFS, "529.982.247-25 / 222.333.444-05");
  assert.equal(m.VENDEDOR_DOC_ROTULO, "CPF nº 333.444.555-66");
  assert.equal(m.REPRESENTANTE_NOME, "INVESTIDOR TESTE");
  assert.equal(m.REPRESENTANTE_CPF, "333.444.555-66");
});
