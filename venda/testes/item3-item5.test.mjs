/* 19/11/2026 (dono): endereço completo no item 3 a), rótulo COMPRADOR/COMPRADORES, forma fixa da comissão,
   "f) A corretagem" sobe para e) quando o vencimento some */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../ContratoVenda.js");

function fontes() {
  return {
    venda: { CLIENTES: "ANA TESTE", CPF: "529.982.247-25",
      COMPRADOR1: { nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO", endereco: "RUA TESTE, 10, GOIÂNIA/GO" },
      COMPRADOR2: { nome: "", cpf: "", nacionalidade: "", estadoCivil: "", profissao: "", documento: "", endereco: "" },
      ENDERECO: "RUA TESTE QD 18 LT 08-11 B2", VALOR_CONTRATO: 300000, VALOR_NA_MAO: 290000, COMISSAO: 10000, DATA_VENDA: "2026-09-28", CORRETOR: "teste",
      ALVARA_NUMERO: "1.238", ALVARA_DATA: "2025-10-23", HABITESE_NUMERO: "77", MATRICULA_INDIVIDUAL: "99.999", CRI: "Senador Canedo", AREA: 125, CONFRONTACOES: "frente para a rua teste",
      SINAL_VALOR: 5000, SINAL_DATA: "2026-09-28", ENTRADA_VALOR: 20000, ENTRADA_VENCIMENTO: "2026-10-28",
      FORMA_PAGAMENTO: "PIX", COMISSAO_PAGA_POR: "COMPRADOR", PRAZO_CONCLUSAO: "2027-03-01", CONDICOES_ESPECIAIS: "" },
    obra: { proprietario: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", obraFinalizada: "SIM", cidade: "Senador Canedo", dataHabitese: "2026-08-01" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", endereco: "RUA SEDE, 1", representanteNome: "REPRESENTANTE TESTE", representanteCpf: "111.444.777-35", representanteRg: "7654321", representanteNacionalidade: "brasileiro", representanteEstadoCivil: "casado",
      nacionalidade: "", estadoCivil: "", profissao: "", rg: "", banco: "BANCO TESTE", agencia: "0001", operacao: "", conta: "12345-6", pix: "00000000000191" },
    loteamento: { denominacao: "LOTEAMENTO TESTE", municipioUf: "Senador Canedo/GO", matricula: "64.613", cartorio: "Senador Canedo", prazoPosseDias: "30", prazoChavesDias: "10" },
    corretor: { nome: "teste", creci: "40.167", cpfCnpj: "111.444.777-35", nacionalidade: "brasileira", endereco: "RUA CORRETOR, 5", email: "corretor@teste.invalid" },
    hojeISO: "2026-09-29", cidadeAssinatura: "Goiânia",
  };
}

test("casa de rua: endereço completo no {{ENDERECO_IMOVEL}} e as confrontações sem o endereço na frente", () => {
  const m = C.marcadores(C.montarDadosContrato(fontes()));
  assert.equal(m.ENDERECO_IMOVEL, "RUA TESTE QD 18 LT 08-11 B2, Senador Canedo/GO");
  assert.equal(m.CONFRONTACOES, "frente para a rua teste");
});

test("rótulo do item 1: COMPRADOR com um só, COMPRADORES com casal", () => {
  assert.equal(C.marcadores(C.montarDadosContrato(fontes())).COMPRADOR_ROTULO, "COMPRADOR");
  const f = fontes();
  f.venda.COMPRADOR2 = { nome: "BRUNO TESTE", cpf: "111.444.777-35", nacionalidade: "brasileiro", estadoCivil: "casado", profissao: "motorista", documento: "RG 999 SSP/GO", endereco: "RUA TESTE, 10, GOIÂNIA/GO" };
  assert.equal(C.marcadores(C.montarDadosContrato(f)).COMPRADOR_ROTULO, "COMPRADORES");
});

test("comissão: forma fixa na casa de rua mesmo sem cadastro", () => {
  assert.equal(C.marcadores(C.montarDadosContrato(fontes())).COMISSAO_FORMA, "PIX ou depósito bancário");
});

test("vencimento vazio: d) Corretor → c), e) Responsável → d), f) A corretagem → e)", () => {
  const textos = ["a) Valor: R$ 1,00", "b) Forma de Pagamento: PIX ou depósito bancário", "c) Vencimento: {{COMISSAO_VENCIMENTO}}",
    "d) Corretor: X", "e) Responsável pelo pagamento: Y", "f) A corretagem não integra o preço do imóvel."];
  const plano = C.planoParagrafosVazios(textos, { COMISSAO_VENCIMENTO: "" });
  assert.deepEqual(plano.apagar, [2]);
  assert.deepEqual(plano.trocar.map((t) => t.texto), ["c) Corretor: X", "d) Responsável pelo pagamento: Y", "e) A corretagem não integra o preço do imóvel."]);
});

test("Cassimiro (19/11/2026): entrada zerada some, intermediária = 294.500 − 5.000 = 289.500 com extenso, valores com extenso", () => {
  const f = fontes();
  Object.assign(f.venda, { VALOR_CONTRATO: 310000, VALOR_NA_MAO: 294500, COMISSAO: 15500, SINAL_VALOR: 5000, ENTRADA_VALOR: 0,
    INTERMEDIARIA_VALOR: 296000, INTERMEDIARIA_VENCIMENTO: "2026-12-21" });
  const d = C.montarDadosContrato(f), m = C.marcadores(d);
  assert.deepEqual(C.faltasContrato(d), []);
  assert.equal(m.ENTRADA_VALOR, "");
  assert.equal(m.INTERMEDIARIA_VALOR, "289.500,00 (duzentos e oitenta e nove mil e quinhentos reais)");
  assert.equal(m.SINAL_VALOR, "5.000,00 (cinco mil reais)");
  assert.equal(m.VALOR_IMOVEL, "294.500,00 (duzentos e noventa e quatro mil e quinhentos reais)");
  assert.equal(m.VALOR_INTERMEDIACAO, "R$ 15.500,00 (quinze mil e quinhentos reais)");
  assert.equal(m.VALOR_TOTAL, "R$ 310.000,00 (trezentos e dez mil reais)");
  assert.ok(C.avisosContrato(d).some((x) => x.indexOf("296.000,00") >= 0 && x.indexOf("289.500,00") >= 0));
  const entrada = "b) Entrada: R$ {{ENTRADA_VALOR}}, vencimento em {{ENTRADA_VENCIMENTO}}, ou na data de assinatura de contrato junto à instituição financeira, em caso de financiamento bancário, ocorrendo o vencimento na data que vier primeiro.";
  const plano = C.planoParagrafosVazios(["a) Sinal/arras: x", entrada, "c) Parcela Intermediária: R$ y", "d) Meio de pagamento: PIX"], m);
  assert.deepEqual(plano.apagar, [1]);
  assert.deepEqual(plano.trocar.map((t) => t.texto), ["b) Parcela Intermediária: R$ y", "c) Meio de pagamento: PIX"]);
});

test("item 3 a): endereço + bairro (SETOR) + município, sem repetir o que o título já tem", () => {
  const f = fontes();
  f.venda.SETOR = "SETOR TESTE";
  assert.equal(C.marcadores(C.montarDadosContrato(f)).ENDERECO_IMOVEL, "RUA TESTE QD 18 LT 08-11 B2, SETOR TESTE, Senador Canedo/GO");
  const g = fontes();
  g.venda.ENDERECO = "RUA TESTE QD 18 LT 08-11 B2 SETOR TESTE"; g.venda.SETOR = "Setor Teste";
  assert.equal(C.marcadores(C.montarDadosContrato(g)).ENDERECO_IMOVEL, "RUA TESTE QD 18 LT 08-11 B2 SETOR TESTE, Senador Canedo/GO");
  const h = fontes();
  assert.equal(C.marcadores(C.montarDadosContrato(h)).ENDERECO_IMOVEL, "RUA TESTE QD 18 LT 08-11 B2, Senador Canedo/GO");
});
