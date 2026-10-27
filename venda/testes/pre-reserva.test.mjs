/* Termo de Pré-Reserva (27/10/2026): dados, faltas, marcadores e carimbo. Só dados inventados. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const C = req("../ContratoVenda.js");
const P = req("../PreReservaVenda.js");

function dados(c1 = {}, cond = {}) {
  return C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADORA TESTE", CPF: "529.982.247-25", ENDERECO: "CONDOMÍNIO RESERVA DOS IPÊS",
      COMPRADOR1: Object.assign({ nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO",
        endereco: "RUA TESTE, 10", email: "compradora@teste.invalid", telefone: "62 90000-0000" }, c1),
      COMPRADOR2: { nome: "" } },
    obra: {}, vendedor: null, loteamento: null, corretor: null,
    condominio: Object.assign({ nome: "CONDOMÍNIO RESERVA DOS IPÊS", unidade: "13", fluxo: {}, fiadores: [] }, cond),
    hojeISO: "2026-10-27",
  });
}
const X = { conta: "PIX CPF da compradora", valor: "3000", dataLimite: "2026-10-31", hojeISO: "2026-10-27" };

test("termo completo: sem faltas e todos os marcadores preenchidos", () => {
  const t = P.montar(dados(), X);
  assert.deepEqual(P.faltas(t), []);
  const m = P.marcadores(t);
  assert.equal(m.PRE_RESERVANTE_QUADRO, "COMPRADORA TESTE, brasileira, solteira, professora, RG nº 1234567 SSP/GO, CPF nº 529.982.247-25, " +
    "residente e domiciliado(a) à RUA TESTE, 10, e-mail compradora@teste.invalid, telefone 62 90000-0000");
  assert.equal(m.CASA_NUMERO, "13");
  assert.equal(m.CASA_TIPO, "02");
  assert.equal(m.PRE_RESERVA_VALOR, "3.000,00");
  assert.equal(m.PRE_RESERVA_VALOR_EXTENSO, "R$ 3.000,00 (três mil reais)");
  assert.equal(m.PRE_RESERVA_DATA_LIMITE, "31/10/2026");
  assert.equal(m.PRE_RESERVANTE_CONTA, "PIX CPF da compradora");
  assert.equal(m.PRE_RESERVANTE_NOME, "COMPRADORA TESTE");
  assert.equal(m.PRE_RESERVANTE_CPF, "529.982.247-25");
  assert.equal(m.CIDADE_DATA, "Goiânia, 27 de outubro de 2026");
  for (const [k, v] of Object.entries(m)) assert.ok(v !== "", k);
});

test("faltas: conta, propriedades, CPF inválido, e-mail, casa fora da tabela", () => {
  const t = P.montar(dados({ email: "" }, { nome: "CONDOMÍNIO OUTRO TESTE" }), { hojeISO: "2026-10-27", valor: "x", dataLimite: "amanhã" });
  assert.deepEqual(P.faltas(t), [
    "Pré-reservante: e-mail (coluna Email)", "Unidade: fora da tabela do condomínio (tipo da casa)",
    "Conta para devolução (preencha no cartão)", "Propriedade PRE_RESERVA_VALOR (valor da pré-reserva)",
    "Propriedade PRE_RESERVA_DATA_LIMITE (dia da assinatura do contrato)"]);
  const cpf = C.montarDadosContrato({ venda: { CLIENTES: "X TESTE", CPF: "529.982.247-24", COMPRADOR1: {}, COMPRADOR2: { nome: "" } },
    obra: {}, condominio: { nome: "RESERVA DOS IPÊS", unidade: "1", fluxo: {}, fiadores: [] } });
  assert.ok(P.faltas(P.montar(cpf, X)).includes("Pré-reservante: CPF inválido"));
});

test("valor e data aceitam os formatos que se digitam nas Propriedades", () => {
  assert.equal(P.valorDe("3.000,00"), 3000);
  assert.equal(P.valorDe("R$ 2.500,50"), 2500.5);
  assert.equal(P.valorDe(3000), 3000);
  assert.equal(P.valorDe("0"), null);
  assert.equal(P.dataIso("31/10/2026"), "2026-10-31");
  assert.equal(P.dataIso("2026-10-31"), "2026-10-31");
  assert.equal(P.dataIso("31-10-26"), "");
});

test("carimbo: muda com a conta e com o valor; não muda com a data de hoje", () => {
  const a = JSON.stringify(P.baseCarimbo(P.montar(dados(), X)));
  assert.equal(JSON.stringify(P.baseCarimbo(P.montar(dados(), { ...X, hojeISO: "2026-10-28" }))), a);
  assert.notEqual(JSON.stringify(P.baseCarimbo(P.montar(dados(), { ...X, conta: "outra conta" }))), a);
  assert.notEqual(JSON.stringify(P.baseCarimbo(P.montar(dados(), { ...X, valor: "3500" }))), a);
});

test("conta digitada: curta, longa, chaves de marcador fora", () => {
  assert.deepEqual(P.validarConta("abc"), { ok: false, erro: "CONTA_CURTA" });
  assert.deepEqual(P.validarConta("x".repeat(301)), { ok: false, erro: "CONTA_LONGA" });
  assert.deepEqual(P.validarConta("  Banco 001  {{AG}} 1234 "), { ok: true, valor: "Banco 001 AG 1234" });
});
