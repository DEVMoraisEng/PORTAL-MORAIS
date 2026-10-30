/* 30/10/2026 — fiador casado (Súmula 332 do STJ: fiança de casado sem o cônjuge é ineficaz).
 * Decisão do dono: em 36x/48x cada fiador tem estado civil; casado ou em união estável, o cônjuge também assina.
 * O preferido é o CASAL ser os 2 fiadores (o cônjuge é o outro fiador, reconhecido pelo CPF); de famílias
 * diferentes, nome + CPF + e-mail do cônjuge ficam em condominio.fiadores[i].conjuge para a Clicksign.
 * Em 24x (sem pós-chaves) nada disto é cobrado. Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const C = createRequire(import.meta.url)("../ContratoVenda.js");

/* 36x: sinal, pré-chaves, balões e 12 pós-chaves (valores inventados, a soma fecha com o valor de venda) */
const FLUXO = {
  assinatura: "2026-10-30", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 300000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-30",
  pre1N: 10, pre1Valor: 1000, pre1Data: "2026-11-10", pre2N: 0, pre2Valor: 0, pre2Data: "",
  balao1Valor: 0, balao1Data: "", balao2Valor: 0, balao2Data: "",
  credito: 270000, fgts: 0, subsidio: 0, posN: 10, posValor: 1000, posData: "2029-01-10", prazoEntrada: 36,
};
const SEM_POS = { pre1N: 20, posN: 0, posValor: 0, posData: "", prazoEntrada: 24 };

/* CPFs fictícios com dígito verificador válido */
const F1 = { nome: "FIADOR UM TESTE", cpf: "111.444.777-35", email: "f1@teste.example" };
const F2 = { nome: "FIADORA DOIS TESTE", cpf: "246.813.579-28", email: "f2@teste.example" };
const CONJ_FORA = { conjugeNome: "CONJUGE DE FORA TESTE", conjugeCpf: "529.982.247-25", conjugeEmail: "Conj@Teste.Example" };

function condominio(fiadores, fluxo = {}) {
  return C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADORA TESTE", CPF: "935.411.347-80", COMPRADOR1: {}, COMPRADOR2: { nome: "" }, VALOR_CONTRATO: 300000 },
    obra: {}, vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA" }, loteamento: {}, corretor: {},
    condominio: { nome: "CONDOMÍNIO RESERVA TESTE", unidade: "13", fluxo: Object.assign({}, FLUXO, fluxo), fiadores },
    hojeISO: "2026-10-30",
  }).condominio;
}
const faltas = (fiadores, fluxo) => C.faltasConjugeFiadores(condominio(fiadores, fluxo));

test("estado civil: casado e união estável (com ou sem acento) pedem o cônjuge; os outros não", () => {
  ["CASADO", "casada", "UNIAO ESTAVEL", "União Estável"].forEach((e) => assert.equal(C.fiadorCasado(e), true, e));
  ["SOLTEIRO", "DIVORCIADO", "VIUVO", "", null].forEach((e) => assert.equal(C.fiadorCasado(e), false, String(e)));
});

test("com pós-chaves (36x/48x) o estado civil de cada fiador é exigido", () => {
  assert.deepEqual(faltas([F1, F2]), ["Fiador 1: estado civil", "Fiador 2: estado civil"]);
  assert.deepEqual(faltas([{ ...F1, estadoCivil: "SOLTEIRO" }, { ...F2, estadoCivil: "DIVORCIADO" }]), []);
});

test("24x sem pós-chaves: nada de estado civil nem cônjuge, mesmo com fiador casado e sem dados do cônjuge", () => {
  assert.deepEqual(faltas([F1, { ...F2, estadoCivil: "CASADO" }], SEM_POS), []);
});

test("o CASAL como os 2 fiadores (o preferido): o cônjuge é o outro fiador, ninguém a mais assina", () => {
  const co = condominio([
    { ...F1, estadoCivil: "CASADO", conjugeNome: F2.nome, conjugeCpf: "24681357928", conjugeEmail: F2.email },
    { ...F2, estadoCivil: "CASADO", conjugeNome: F1.nome, conjugeCpf: F1.cpf, conjugeEmail: F1.email },
  ]);
  assert.deepEqual(co.fiadores.map((f) => [f.conjugeEhOutroFiador, f.conjuge]), [[true, null], [true, null]]);
  assert.deepEqual(C.faltasConjugeFiadores(co), []);
});

test("famílias diferentes: o cônjuge do casado fica pronto para a Clicksign (CPF formatado, e-mail minúsculo)", () => {
  const co = condominio([{ ...F1, estadoCivil: "UNIAO ESTAVEL", ...CONJ_FORA }, { ...F2, estadoCivil: "SOLTEIRO" }]);
  assert.deepEqual(co.fiadores[0].conjuge, { nome: "CONJUGE DE FORA TESTE", cpf: "529.982.247-25", email: "conj@teste.example" });
  assert.equal(co.fiadores[0].conjugeEhOutroFiador, false);
  assert.equal(co.fiadores[1].conjuge, null);
  assert.deepEqual(C.faltasConjugeFiadores(co), []);
});

test("casado sem os dados do cônjuge (e sem o casal como fiadores): nome, CPF e e-mail entram nas faltas", () => {
  assert.deepEqual(faltas([{ ...F1, estadoCivil: "CASADO" }, { ...F2, estadoCivil: "SOLTEIRO" }]), [
    "Fiador 1: nome do cônjuge (ou o cônjuge como o outro fiador)", "Fiador 1: CPF do cônjuge", "Fiador 1: e-mail do cônjuge (para assinar)"]);
});

test("cônjuge com CPF inválido, igual ao do próprio fiador ou e-mail torto não passa", () => {
  const base = { ...F1, estadoCivil: "CASADO", ...CONJ_FORA };
  const so = (x) => faltas([x, { ...F2, estadoCivil: "SOLTEIRO" }]);
  assert.deepEqual(so({ ...base, conjugeCpf: "529.982.247-00" }), ["Fiador 1: CPF do cônjuge inválido"]);
  assert.deepEqual(so({ ...base, conjugeCpf: F1.cpf }), ["Fiador 1: CPF do cônjuge igual ao do fiador"]);
  assert.deepEqual(so({ ...base, conjugeEmail: "conj-sem-arroba" }), ["Fiador 1: e-mail do cônjuge inválido"]);
});

test("o cônjuge informado com o CPF de um terceiro não é confundido com o outro fiador", () => {
  const co = condominio([{ ...F1, estadoCivil: "CASADO", ...CONJ_FORA }, { ...F2, estadoCivil: "CASADO", conjugeNome: "OUTRO CONJUGE TESTE",
    conjugeCpf: "935.411.347-80", conjugeEmail: "outro@teste.example" }]);
  assert.deepEqual(co.fiadores.map((f) => f.conjugeEhOutroFiador), [false, false]);
  assert.deepEqual(co.fiadores.map((f) => f.conjuge.cpf), ["529.982.247-25", "935.411.347-80"]);
});

test("as faltas novas chegam ao faltasContrato (o contrato não sai sem o cônjuge)", () => {
  const d = C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADORA TESTE", CPF: "935.411.347-80", COMPRADOR1: {}, COMPRADOR2: { nome: "" }, VALOR_CONTRATO: 300000 },
    obra: {}, vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA" }, loteamento: {}, corretor: {},
    condominio: { nome: "CONDOMÍNIO RESERVA TESTE", unidade: "13", fluxo: FLUXO, fiadores: [{ ...F1, estadoCivil: "CASADO" }] },
    hojeISO: "2026-10-30",
  });
  assert.ok(C.faltasContrato(d).includes("Fiador 1: CPF do cônjuge"), C.faltasContrato(d).join(" | "));
});
