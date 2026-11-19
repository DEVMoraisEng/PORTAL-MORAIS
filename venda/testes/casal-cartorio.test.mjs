/* 19/11/2026 (dono): "independente do grau e número" só com casal; cartório sem o prefixo repetido */
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
      ENDERECO: "APOLO LYKEIOS QD 01 LT 35", VALOR_CONTRATO: 300000, VALOR_NA_MAO: 290000, COMISSAO: 10000, DATA_VENDA: "2026-09-28", CORRETOR: "teste",
      ALVARA_NUMERO: "1.238", ALVARA_DATA: "2025-10-23", HABITESE_NUMERO: "77", MATRICULA_INDIVIDUAL: "99.999", CRI: "Senador Canedo", AREA: 125, CONFRONTACOES: "frente para a rua teste",
      SINAL_VALOR: 5000, SINAL_DATA: "2026-09-28", ENTRADA_VALOR: 20000, ENTRADA_VENCIMENTO: "2026-10-28",
      FORMA_PAGAMENTO: "PIX", COMISSAO_FORMA: "PIX", COMISSAO_VENCIMENTO: "na assinatura", COMISSAO_PAGA_POR: "COMPRADOR", PRAZO_CONCLUSAO: "2027-03-01", CONDICOES_ESPECIAIS: "" },
    obra: { proprietario: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", obraFinalizada: "SIM", cidade: "Senador Canedo", dataHabitese: "2026-08-01" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", endereco: "RUA SEDE, 1", representanteNome: "REPRESENTANTE TESTE", representanteCpf: "111.444.777-35", representanteRg: "7654321", representanteNacionalidade: "brasileiro", representanteEstadoCivil: "casado",
      nacionalidade: "", estadoCivil: "", profissao: "", rg: "", banco: "BANCO TESTE", agencia: "0001", operacao: "", conta: "12345-6", pix: "00000000000191" },
    loteamento: { denominacao: "LOTEAMENTO TESTE", municipioUf: "Senador Canedo/GO", matricula: "64.613", cartorio: "Senador Canedo", prazoPosseDias: "30", prazoChavesDias: "10" },
    corretor: { nome: "teste", creci: "40.167", cpfCnpj: "111.444.777-35", nacionalidade: "brasileira", endereco: "RUA CORRETOR, 5", email: "corretor@teste.invalid" },
    hojeISO: "2026-09-29", cidadeAssinatura: "Goiânia",
  };
}

test("QUALIFICADOR_CASAL: vazio sem 2º comprador, com o texto quando é casal", () => {
  assert.equal(C.marcadores(C.montarDadosContrato(fontes())).QUALIFICADOR_CASAL, "");
  const f = fontes();
  f.venda.COMPRADOR2 = { nome: "BRUNO TESTE", cpf: "111.444.777-35", nacionalidade: "brasileiro", estadoCivil: "casado", profissao: "motorista", documento: "RG 999 SSP/GO", endereco: "RUA TESTE, 10, GOIÂNIA/GO" };
  const d = C.montarDadosContrato(f);
  assert.equal(C.marcadores(d).QUALIFICADOR_CASAL, " independente do grau e número");
  assert.equal(C.blocos(d).SE_CASAL, true);
});

test("CARTORIO_LOTEAMENTO corta o prefixo em letra comum e deixa o nome em maiúsculas", () => {
  const cart = (v) => { const f = fontes(); f.loteamento.cartorio = v; return C.marcadores(C.montarDadosContrato(f)).CARTORIO_LOTEAMENTO; };
  assert.equal(cart("Cartório de Registro de Imóveis de REGISTRO DE IMÓVEIS DA 1ª CIRCUNSCRIÇÃO DE GOIÂNIA"),
    "REGISTRO DE IMÓVEIS DA 1ª CIRCUNSCRIÇÃO DE GOIÂNIA");
  assert.equal(cart("Cartorio de registro de imoveis da  SENADOR CANEDO"), "SENADOR CANEDO");
  /* todo em caixa alta: é o nome oficial, fica inteiro */
  assert.equal(cart("CARTÓRIO DE REGISTRO DE IMÓVEIS DA 1ª CIRCUNSCRIÇÃO"), "CARTÓRIO DE REGISTRO DE IMÓVEIS DA 1ª CIRCUNSCRIÇÃO");
  /* resto em letra comum: não é o caso do dono, não mexe */
  assert.equal(cart("Cartório de Registro de Imóveis de Senador Canedo"), "Cartório de Registro de Imóveis de Senador Canedo");
  assert.equal(cart("Senador Canedo"), "Senador Canedo");
  assert.equal(cart(""), "");
});
