/* 27/11/2026 (dono): sinal da intermediação — parte da comissão paga ao corretor na assinatura (ex.: sinal de 10 mil =
   5 mil de arras ao vendedor + 5 mil adiantados ao corretor). Sai na linha "c) Vencimento:" do item 5. */
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


test("sem sinal da intermediação: o vencimento da comissão fica como estava (vazio some do contrato)", () => {
  const d = C.montarDadosContrato(fontes());
  assert.deepEqual(C.faltasContrato(d), []);
  assert.equal(C.marcadores(d).COMISSAO_VENCIMENTO, "");
});

test("sinal da intermediação de 5 mil numa comissão de 10 mil: valor na assinatura e saldo no financiamento", () => {
  const f = fontes(); f.venda.SINAL_INTERMEDIACAO = 5000;
  const d = C.montarDadosContrato(f);
  assert.deepEqual(C.faltasContrato(d), []);
  assert.equal(C.marcadores(d).COMISSAO_VENCIMENTO,
    "R$ 5.000,00 (cinco mil reais) na assinatura deste contrato, a título de sinal da intermediação, e o saldo de " +
    "R$ 5.000,00 (cinco mil reais) na data de assinatura do contrato de financiamento por parte do COMPRADOR junto à instituição financeira");
  /* o resto do item 5 e o sinal do vendedor (item 6) não mudam */
  const m = C.marcadores(d);
  assert.equal(m.COMISSAO_VALOR, "10.000,00");
  assert.equal(m.SINAL_VALOR, "5.000,00 (cinco mil reais)");
});

test("sinal da intermediação igual à comissão: tudo na assinatura, sem saldo", () => {
  const f = fontes(); f.venda.SINAL_INTERMEDIACAO = 10000;
  const d = C.montarDadosContrato(f);
  assert.deepEqual(C.faltasContrato(d), []);
  assert.equal(C.marcadores(d).COMISSAO_VENCIMENTO, "R$ 10.000,00 (dez mil reais) na assinatura deste contrato");
});

test("sinal da intermediação maior que a comissão vira falta", () => {
  const f = fontes(); f.venda.SINAL_INTERMEDIACAO = 12000;
  assert.ok(C.faltasContrato(C.montarDadosContrato(f)).includes("Negociação: sinal da intermediação maior que a comissão"));
});

test("sinal da intermediação com comissão paga pelo vendedor vira falta", () => {
  const f = fontes(); f.venda.SINAL_INTERMEDIACAO = 5000; f.venda["CONTRATO - COMISSÃO PAGA POR"] = "VENDEDOR";
  assert.ok(C.faltasContrato(C.montarDadosContrato(f)).includes("Negociação: sinal da intermediação só vale com a comissão paga pelo comprador"));
});

test("sinal da intermediação sem comissão vira falta", () => {
  const f = fontes(); f.venda.SINAL_INTERMEDIACAO = 5000; f.venda.COMISSAO = null; f.venda.VALOR_NA_MAO = 300000;
  assert.ok(C.faltasContrato(C.montarDadosContrato(f)).includes("Negociação: sinal da intermediação sem valor de comissão"));
});
