/* ConfissaoVenda.js — termos de confissão de dívida do condomínio (28/10/2026). Só dados inventados. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const C = req("../ContratoVenda.js");
const T = req("../ConfissaoVenda.js");

const FLUXO = {
  assinatura: "2026-10-31", diaPagamento: 20, entrega: "2028-11-30", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-29",
  pre1N: 12, pre1Valor: 729.8, pre1Data: "2026-11-20", pre2N: 12, pre2Valor: 280.04, pre2Data: "2027-11-20",
  balao1Valor: 8486.06, balao1Data: "2027-12-20", balao2Valor: 5940.34, balao2Data: "2028-11-20",
  credito: 244800, fgts: 6600, subsidio: 0, posN: 24, posValor: 668.98, posData: "2028-12-20", prazoEntrada: 36,
};
const FIADORES = [{ nome: "FIADOR UM TESTE", cpf: "111.444.777-35", email: "f1@teste.invalid" },
                  { nome: "FIADOR DOIS TESTE", cpf: "246.813.579-28", email: "f2@teste.invalid" }];

function dados({ fluxo = {}, fiadores = FIADORES } = {}) {
  return C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADORA TESTE", CPF: "529.982.247-25",
      COMPRADOR1: { nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO",
                    endereco: "RUA TESTE, 10", email: "compradora@teste.invalid", telefone: "62 90000-0000" },
      COMPRADOR2: { nome: "" }, ENDERECO: "CONDOMÍNIO RESERVA DOS IPÊS", VALOR_CONTRATO: 305000, COMISSAO: 14487.5, CORRETOR: "Corretor Teste" },
    obra: { proprietario: "SPE TESTE LTDA", obraFinalizada: "NÃO" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", representanteNome: "REPRESENTANTE TESTE" },
    corretor: { nome: "Corretor Teste", creci: "40167", cpfCnpj: "246.813.579-28" },
    condominio: { nome: "CONDOMÍNIO RESERVA DOS IPÊS", unidade: "17", comissao: 14487.5, fluxo: { ...FLUXO, ...fluxo }, fiadores },
    hojeISO: "2026-10-28", meioPagamento: "",
  });
}

test("quais termos: PRÉ e PÓS com pós-chaves; nenhum na entrada em 24x — a confissão vai no 4.2.1 (dono, 30/10)", () => {
  assert.deepEqual(T.quais(dados()), ["PRE", "POS"]);
  assert.deepEqual(T.quais(dados({ fluxo: { posN: 0, posValor: 0 } })), []);
});

test("totais: pré = séries + balões; pós = parcelas", () => {
  const fl = dados().condominio.fluxo;
  assert.equal(T.totalPre(fl), 26544.48);
  assert.equal(T.totalPos(fl), 16055.52);
});

test("faltas: os dois fiadores com nome e CPF válido (dono 28/10: só nome e CPF)", () => {
  assert.deepEqual(T.faltas(dados()), []);
  assert.deepEqual(T.faltas(dados({ fiadores: [FIADORES[0]] })), ["Fiador 2 (termo de confissão): nome", "Fiador 2 (termo de confissão): CPF"]);
  assert.deepEqual(T.faltas(dados({ fiadores: [{ ...FIADORES[0], cpf: "111.444.777-36" }, FIADORES[1]] })), ["Fiador 1 (termo de confissão): CPF inválido"]);
});

test("faltas: entrada em 24x sem pós-chaves não exige fiador (30/10/2026)", () => {
  const sem = { posN: 0, posValor: 0, prazoEntrada: 24 };
  assert.equal(T.fiadorDispensado(dados({ fluxo: sem })), true);
  assert.equal(T.fiadorDispensado(dados()), false);
  assert.deepEqual(T.faltas(dados({ fluxo: sem, fiadores: [] })), []);
  // 30/10 à tarde: no 24x não há termo, então nem o fiador informado é conferido
  assert.deepEqual(T.faltas(dados({ fluxo: sem, fiadores: [{ nome: "FIADOR UM TESTE", cpf: "" }] })), []);
  assert.equal(T.faltas(dados({ fiadores: [] })).length, 4);   // com pós-chaves: os dois continuam obrigatórios
});

test("marcadores do termo PRÉ: comprador do contrato, fiadores só nome e CPF, 4.1 com o resumo do contrato e o total", () => {
  const m = T.marcadores(dados(), "PRE");
  assert.equal(m.FIADOR1_QUADRO, "FIADOR UM TESTE, CPF nº 111.444.777-35");
  assert.equal(m.FIADOR2_NOME, "FIADOR DOIS TESTE");
  assert.equal(m.DATA_CONTRATO, "31/10/2026");
  assert.equal(m.CASA_NUMERO, "17");
  assert.equal(m.TCD_TOTAL_EXTENSO.slice(0, 14), "R$ 26.544,48 (");
  assert.match(m.TCD_PARCELAS, /^12 parcelas mensais e sucessivas de R\$ 729,80 .*1 parcela intermediária de R\$ 5\.940,34/);
  assert.doesNotMatch(m.TCD_PARCELAS, /pagamento único/, "o excedente do sinal é pago na assinatura, não é parcela");
  for (const [k, v] of Object.entries(m)) assert.ok(v !== "", k);
});

test("marcadores do termo PÓS: as parcelas pós-chaves e o total", () => {
  const m = T.marcadores(dados(), "POS");
  assert.match(m.TCD_PARCELAS, /^24 parcelas mensais e sucessivas de R\$ 668,98/);
  assert.equal(m.TCD_TOTAL_EXTENSO.slice(0, 14), "R$ 16.055,52 (");
});

test("coluna do assinado pelo nome do PDF", () => {
  assert.equal(T.colunaAssinadaDoNome("CONFISSÃO PRÉ-CHAVES - CONDOMÍNIO X - CASA 17.pdf"), "CONFISSÃO PRÉ-CHAVES - ASSINADA");
  assert.equal(T.colunaAssinadaDoNome("CONFISSÃO PÓS-CHAVES - X.pdf"), "CONFISSÃO PÓS-CHAVES - ASSINADA");
  assert.equal(T.colunaAssinadaDoNome("CONTRATO - X.pdf"), "");
});
