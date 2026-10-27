/* Contrato do condomínio, versão do advogado de 21/10/2026 (quadro-resumo): tabela das casas, valores
 * do item 4, resumo das parcelas, comissão pela regra, qualificação com e-mail e telefone.
 * Só dados inventados de pessoas — o repositório é público. As áreas são as do memorial de
 * incorporação registrado (dado público do cartório). */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const C = req("../ContratoVenda.js");
const U = req("../UnidadesCondominio.js");

/* 305.000 = sinal 1.000 + 3×3.000 + 10×924,07 + 12×295,49 + balões 8.954,18 e 6.267,88 + crédito 244.800 + FGTS 5.250 + 24×705,89 */
const FLUXO = {
  assinatura: "2026-10-07", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-07", sinal60: 3000, data60: "2026-12-07", sinal90: 3000, data90: "2027-01-07",
  pre1N: 10, pre1Valor: 924.07, pre1Data: "2026-11-10", pre2N: 12, pre2Valor: 295.49, pre2Data: "2027-09-10",
  balao1Valor: 8954.18, balao1Data: "2027-12-10", balao2Valor: 6267.88, balao2Data: "2028-11-10",
  credito: 244800, fgts: 5250, subsidio: 0, posN: 24, posValor: 705.89, posData: "2029-01-10",
};

function fontes({ condominio = {}, venda = {}, corretor = {} } = {}) {
  return {
    venda: Object.assign({
      CLIENTES: "COMPRADORA TESTE", CPF: "529.982.247-25",
      COMPRADOR1: { nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO",
                    endereco: "RUA TESTE, 10", email: "compradora@teste.invalid", telefone: "62 90000-0000" },
      COMPRADOR2: { nome: "" }, ENDERECO: "CONDOMÍNIO RESERVA DOS IPÊS", VALOR_CONTRATO: 305000, COMISSAO: 13725, VALOR_NA_MAO: null,
      CORRETOR: "Corretor Teste", COMISSAO_PAGA_POR: "VENDEDOR",
      MATRICULA_INDIVIDUAL: "", CRI: "", ALVARA_NUMERO: "AL-1", ALVARA_DATA: "2026-01-10", PRAZO_CONCLUSAO: "2028-11-30",
    }, venda),
    obra: { proprietario: "SPE TESTE LTDA", obraFinalizada: "NÃO" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", endereco: "RUA SEDE, 1", representanteNome: "REPRESENTANTE TESTE",
      representanteCpf: "111.444.777-35", representanteRg: "7654321", representanteNacionalidade: "brasileiro", representanteEstadoCivil: "casado",
      banco: "BANCO TESTE", agencia: "0001", conta: "12345-6", pix: "00000000000191" },
    loteamento: { denominacao: "Condomínio Residencial Reserva dos Ipês", municipioUf: "Cidade Teste/GO", matricula: "M-500", cartorio: "Cartório Teste" },
    corretor: Object.assign({ nome: "Corretor Teste", creci: "40167", cpfCnpj: "246.813.579-28", endereco: "AV. DO CORRETOR, 5",
      email: "corretor@teste.invalid", telefone: "62 91111-1111" }, corretor),
    condominio: Object.assign({ nome: "CONDOMÍNIO RESERVA DOS IPÊS", unidade: "13", comissao: 13725,
      fluxo: FLUXO, fiadores: [] }, condominio),
    hojeISO: "2026-10-21", meioPagamento: "",
  };
}
const dados = (o) => C.montarDadosContrato(fontes(o));

test("tabela das casas do Reserva dos Ipês: tipo pelo memorial (casa 62 é tipo 06), áreas e fração", () => {
  assert.deepEqual(U.unidade("RESERVA DOS IPÊS", "13"), {
    numero: 13, tipo: "02", planta: "Tipo 2", areaPrivativaConstruida: 70.27, areaTotalConstruida: 71.97,
    fracaoM2: 257.79, fracaoPct: "1,613", casaModelo: false });
  assert.equal(U.unidade("CONDOMÍNIO RESERVA DOS IPÊS", "CASA 01").casaModelo, true);
  assert.equal(U.unidade("reserva dos ipes", "1").fracaoM2, 257.7);
  const tipos = { 6: "01", 7: "02", 18: "02", 19: "03", 30: "03", 31: "04", 39: "04", 40: "02", 51: "02", 52: "05", 61: "05", 62: "06" };
  for (const [n, t] of Object.entries(tipos)) assert.equal(U.unidade("RESERVA DOS IPÊS", n).tipo, t, "casa " + n);
  assert.equal(U.unidade("RESERVA DOS IPÊS", "62").fracaoM2, 257.77);
  assert.equal(U.unidade("RESERVA DOS IPÊS", "55").fracaoM2, 257.76);
  assert.equal(U.unidade("RESERVA DOS IPÊS", "35").fracaoM2, 257.7);
  assert.equal(U.unidade("RESERVA DOS IPÊS", "63"), null);
  assert.equal(U.unidade("OUTRO CONDOMÍNIO", "1"), null);
});

test("regra da comissão: sem pós-chaves 5%, 12 pós-chaves 4,75%, 24 pós-chaves 4,5%; outro número = null", () => {
  assert.equal(C.comissaoPctPelaRegra(0), 0.05);
  assert.equal(C.comissaoPctPelaRegra(null), 0.05);
  assert.equal(C.comissaoPctPelaRegra(12), 0.0475);
  assert.equal(C.comissaoPctPelaRegra(24), 0.045);
  assert.equal(C.comissaoPctPelaRegra(36), null);
});

test("condomínio completo: sem faltas; comissão do COMPRADOR DENTRO do valor de venda (dono 22/10); marcadores do quadro-resumo", () => {
  const d = dados();
  assert.equal(d.modelo, "CONDOMINIO");
  assert.deepEqual(C.faltasContrato(d), []);
  assert.deepEqual(C.avisosContrato(d), []);
  assert.equal(d.comissao.pagaPor, "COMPRADOR");
  const m = C.marcadores(d);
  assert.equal(m.COMPRADORES_QUADRO, "COMPRADORA TESTE, brasileira, solteira, professora, RG nº 1234567 SSP/GO, CPF nº 529.982.247-25, " +
    "residente e domiciliado(a) à RUA TESTE, 10, e-mail compradora@teste.invalid, telefone 62 90000-0000");
  assert.equal(m.CORRETOR_QUADRO, "Corretor Teste, CRECI nº 40167, CPF nº 246.813.579-28, residente e domiciliado(a) à AV. DO CORRETOR, 5, " +
    "e-mail corretor@teste.invalid, telefone 62 91111-1111");
  assert.equal(m.CASA_NUMERO, "13");
  assert.equal(m.CASA_TIPO, "02");
  assert.equal(m.CASA_PLANTA, "Tipo 2");
  assert.equal(m.CASA_MODELO_FRASE, "");
  assert.equal(m.AREA_PRIVATIVA_CONSTRUIDA, "70,27");
  assert.equal(m.AREA_TOTAL_CONSTRUIDA, "71,97");
  assert.equal(m.FRACAO_IDEAL_M2, "257,79");
  assert.equal(m.FRACAO_IDEAL_PCT, "1,613");
  assert.equal(m.VALOR_OPERACAO_EXTENSO, "R$ 305.000,00 (trezentos e cinco mil reais)");
  assert.equal(m.VALOR_IMOVEL_EXTENSO, "R$ 291.275,00 (duzentos e noventa e um mil duzentos e setenta e cinco reais)", "305.000 − 13.725");
  assert.equal(m.COMISSAO_EXTENSO, "R$ 13.725,00 (treze mil setecentos e vinte e cinco reais)");
  assert.equal(m.SINAL_EXTENSO, "R$ 10.000,00 (dez mil reais)", "ato + 30/60/90");
  assert.equal(m.SINAL_VENCIMENTO, "07/10/2026 (R$ 1.000,00), 07/11/2026 (R$ 3.000,00), 07/12/2026 (R$ 3.000,00) e 07/01/2027 (R$ 3.000,00)");
  assert.equal(m.ENTRADA_TOTAL, "54.950,00");
  assert.equal(m.ENTRADA_PCT, "18,02");
  assert.equal(m.ENTRADA_SALDO, "44.950,00", "entrada − sinal");
  assert.equal(m.FINANCIAMENTO_VALOR, "250.050,00");
  assert.equal(m.FINANCIAMENTO_PCT, "81,98");
  assert.equal(m.FINANCIAMENTO_FRASE, ", incluídos os recursos do FGTS e/ou subsídio, quando houver");
  assert.equal(m.COMISSAO_PCT, "4,5");
  assert.equal(m.COMISSAO_VALOR, "13.725,00");
  assert.equal(m.CORRETOR_DOC_ROTULO, "CPF nº 246.813.579-28");
  assert.equal(m.MEIO_PAGAMENTO, "sinal (item 4.1.3) por PIX; parcelas da entrada por boleto bancário");   // 27/10: sem proposta = sinal por PIX
  assert.equal(m.CIDADE_DATA, "Goiânia, 7 de outubro de 2026", "condomínio: a data da assinatura, não a de hoje");
});

test("resumo das parcelas antes das chaves: sem os sinais (vão no 4.1.3), séries por dia de vencimento, balões; INCC-M no fim", () => {
  assert.equal(C.marcadores(dados()).PARCELAS_PRE_CHAVES,
    "10 parcelas mensais e sucessivas de R$ 924,07 (novecentos e vinte e quatro reais e sete centavos) cada, vencendo todo dia 10, a primeira em 10/11/2026; " +
    "12 parcelas mensais e sucessivas de R$ 295,49 (duzentos e noventa e cinco reais e quarenta e nove centavos) cada, vencendo todo dia 10, a primeira em 10/09/2027; " +
    "1 parcela intermediária de R$ 8.954,18 (oito mil novecentos e cinquenta e quatro reais e dezoito centavos), com vencimento em 10/12/2027; e " +
    "1 parcela intermediária de R$ 6.267,88 (seis mil duzentos e sessenta e sete reais e oitenta e oito centavos), com vencimento em 10/11/2028 " +
    "ou na data da entrega das chaves, o que ocorrer primeiro; todas corrigidas pelo INCC-M, nos termos do item 6.1.");
  const so1 = C.marcadores(dados({ condominio: { fluxo: { ...FLUXO, pre2N: 0, pre2Valor: 0, balao1Valor: 0, balao2Valor: 0,
    valorVenda: 305000 - 12 * 295.49 - 8954.18 - 6267.88 } } })).PARCELAS_PRE_CHAVES;
  assert.equal(so1, "10 parcelas mensais e sucessivas de R$ 924,07 (novecentos e vinte e quatro reais e sete centavos) cada, vencendo todo dia 10, " +
    "a primeira em 10/11/2026; todas corrigidas pelo INCC-M, nos termos do item 6.1.");
  /* só o sinal no ato: o vencimento é a data da assinatura, sem lista */
  const soAto = C.marcadores(dados({ condominio: { fluxo: { ...FLUXO, sinal30: 0, sinal60: 0, sinal90: 0, pre1Valor: 924.07 + 900 } } }));
  assert.equal(soAto.SINAL_VENCIMENTO, "07/10/2026");
  assert.equal(soAto.SINAL_EXTENSO, "R$ 1.000,00 (mil reais)");
  const nada = { pre1N: 0, pre1Valor: 0, pre2N: 0, pre2Valor: 0, balao1Valor: 0, balao2Valor: 0 };
  assert.equal(C.marcadores(dados({ condominio: { fluxo: { ...FLUXO, ...nada } } })).PARCELAS_PRE_CHAVES, "não há.");
});

test("resumo das parcelas depois das chaves; sem pós-chaves 'não há.' e comissão de 5%", () => {
  assert.equal(C.marcadores(dados()).PARCELAS_POS_CHAVES,
    "24 parcelas mensais e sucessivas de R$ 705,89 (setecentos e cinco reais e oitenta e nove centavos) cada, vencendo todo dia 10, " +
    "a primeira em 10/01/2029, corrigidas pelo IPCA/IBGE, acrescido de juros remuneratórios de 1% (um por cento) ao mês, nos termos do item 6.1.");
  const semPos = dados({ condominio: { comissao: 15250,
    fluxo: { ...FLUXO, posN: 0, posValor: 0, posData: "", pre1Valor: 924.07 + 24 * 705.89 / 10 } } });
  const m = C.marcadores(semPos);
  assert.equal(m.PARCELAS_POS_CHAVES, "não há.");
  assert.equal(m.COMISSAO_PCT, "5");
  assert.equal(m.COMISSAO_VALOR, "15.250,00");
});

test("uma parcela só: frase no singular", () => {
  const m = C.marcadores(dados({ condominio: { fluxo: { ...FLUXO, pre1N: 1, pre1Valor: 9240.7 } } }));
  assert.ok(m.PARCELAS_PRE_CHAVES.includes("1 parcela de R$ 9.240,70 (nove mil duzentos e quarenta reais e setenta centavos), com vencimento em 10/11/2026;"), m.PARCELAS_PRE_CHAVES);
});

test("Casa 01: frase da Casa Modelo; sem FGTS/subsídio a frase do financiamento some", () => {
  const m = C.marcadores(dados({ condominio: { unidade: "01", fluxo: { ...FLUXO, fgts: 0, credito: 250050 } } }));
  assert.equal(m.CASA_NUMERO, "01");
  assert.equal(m.CASA_TIPO, "01");
  assert.equal(m.CASA_MODELO_FRASE, " Unidade correspondente à “Casa Modelo” (Casa 01), sujeita às condições específicas previstas neste instrumento.");
  assert.equal(m.FRACAO_IDEAL_M2, "257,70");
  assert.equal(m.FINANCIAMENTO_FRASE, "");
});

test("comissão: vazia na linha sai pela regra; diferente da regra trava; nº de pós-chaves fora da tabela trava", () => {
  const vazia = dados({ condominio: { comissao: null } });
  assert.deepEqual(C.faltasContrato(vazia), []);
  assert.equal(C.marcadores(vazia).COMISSAO_VALOR, "13.725,00");
  assert.deepEqual(C.faltasContrato(dados({ condominio: { comissao: 15250 } })),
    ["Comissão: R$ 15.250,00 na venda, mas a regra (24 parcelas pós-chaves = 4,5%) dá R$ 13.725,00"]);
  assert.deepEqual(C.faltasContrato(dados({ condominio: { comissao: 13725.04 } })), [], "até 5 centavos passa");
  const fora = dados({ condominio: { fluxo: { ...FLUXO, posN: 6, posValor: 705.89 * 4 } } });
  assert.deepEqual(C.faltasContrato(fora), ["Comissão: 6 parcelas pós-chaves não estão na tabela (0, 12 ou 24)"]);
});

test("casa fora da tabela: tipo e áreas em branco viram aviso, não travam", () => {
  const d = dados({ condominio: { nome: "CONDOMÍNIO OUTRO TESTE" } });
  assert.deepEqual(C.faltasContrato(d), []);
  assert.ok(C.avisosContrato(d).includes("Em branco no contrato: tipo e áreas da casa (casa fora da tabela do condomínio)"));
  const m = C.marcadores(d);
  for (const k of ["CASA_TIPO", "CASA_PLANTA", "AREA_PRIVATIVA_CONSTRUIDA", "AREA_TOTAL_CONSTRUIDA", "FRACAO_IDEAL_M2", "FRACAO_IDEAL_PCT"])
    assert.equal(m[k], "____", k);
});

test("dois compradores: qualificação dos dois no quadro, CNPJ do corretor com rótulo próprio, meio de pagamento da Propriedade", () => {
  const f = fontes({ venda: { CLIENTES: "COMPRADORA TESTE E COMPRADOR DOIS TESTE",
    COMPRADOR2: { nome: "COMPRADOR DOIS TESTE", cpf: "111.444.777-35", nacionalidade: "brasileiro", documento: "RG 7654321",
                  endereco: "RUA DOIS, 2", email: "dois@teste.invalid", telefone: "" } },
    corretor: { cpfCnpj: "11.222.333/0001-81", endereco: "", telefone: "" } });
  f.meioPagamento = "boleto bancário";
  const m = C.marcadores(C.montarDadosContrato(f));
  assert.ok(m.COMPRADORES_QUADRO.endsWith("; e COMPRADOR DOIS TESTE, brasileiro, RG nº 7654321, CPF nº 111.444.777-35, " +
    "residente e domiciliado(a) à RUA DOIS, 2, e-mail dois@teste.invalid"), m.COMPRADORES_QUADRO);
  assert.equal(m.CORRETOR_QUADRO, "Corretor Teste, CRECI nº 40167, CNPJ nº 11.222.333/0001-81, e-mail corretor@teste.invalid");
  assert.equal(m.CORRETOR_DOC_ROTULO, "CNPJ nº 11.222.333/0001-81");
  assert.equal(m.MEIO_PAGAMENTO, "boleto bancário");
});

test("fora do condomínio os marcadores novos saem vazios e o carimbo dos contratos de rua não muda", () => {
  const rua = C.montarDadosContrato({ ...fontes(), condominio: null });
  const m = C.marcadores(rua);
  for (const k of ["COMPRADORES_QUADRO", "CASA_TIPO", "PARCELAS_PRE_CHAVES", "ENTRADA_TOTAL", "COMISSAO_PCT"]) assert.equal(m[k], "", k);
  assert.equal("telefone" in rua.comprador1, false, "telefone só entra nos dados do condomínio");
});

test("pré-reserva assinada (27/10): o valor já pago é abatido do sinal no 4.1.3; sem termo assinado, nada muda", () => {
  const m = C.marcadores(dados({ condominio: { preReserva: { assinado: true, valor: 3000 } } }));
  assert.equal(m.SINAL_VENCIMENTO, "07/10/2026 (R$ 1.000,00), 07/11/2026 (R$ 3.000,00), 07/12/2026 (R$ 3.000,00) e 07/01/2027 (R$ 3.000,00), " +
    "sendo R$ 3.000,00 (três mil reais) já pagos a título de pré-reserva (Termo de Pré-Reserva), abatidos do sinal");
  assert.equal(C.marcadores(dados({ condominio: { preReserva: { assinado: false, valor: 3000 } } })).SINAL_VENCIMENTO,
    "07/10/2026 (R$ 1.000,00), 07/11/2026 (R$ 3.000,00), 07/12/2026 (R$ 3.000,00) e 07/01/2027 (R$ 3.000,00)");
});

test("27/10 (dono): meio de pagamento — sinal por PIX ou abatido pelo valor para entrada da proposta; parcelas por boleto", () => {
  const co = (vpe) => ({ fluxo: { sinalAto: 1000, sinal30: 3000, sinal60: 3000, sinal90: 3000 }, valorParaEntrada: vpe });
  assert.equal(C.meioPagamentoCondominio(co(null)), "sinal (item 4.1.3) por PIX; parcelas da entrada por boleto bancário");
  assert.equal(C.meioPagamentoCondominio(co(20000)), "sinal (item 4.1.3) abatido do valor para entrada informado na proposta; parcelas da entrada por boleto bancário");
  assert.equal(C.meioPagamentoCondominio(co(4000)),
    "sinal (item 4.1.3): R$ 4.000,00 (quatro mil reais) abatidos do valor para entrada informado na proposta e R$ 6.000,00 (seis mil reais) por PIX; parcelas da entrada por boleto bancário");
  assert.equal(C.meioPagamentoCondominio({ fluxo: {} }), "parcelas da entrada por boleto bancário");
});
