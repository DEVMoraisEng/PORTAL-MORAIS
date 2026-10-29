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
const X = { conta: "PIX, chave 529.982.247-25, no banco 756 - SICOOB", valor: "3000", dataLimite: "2026-10-31", hojeISO: "2026-10-27" };

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
  assert.equal(m.PRE_RESERVANTE_CONTA, "PIX, chave 529.982.247-25, no banco 756 - SICOOB");
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

test("conta: PIX (chave + banco) ou dados bancários (banco, agência, conta, tipo)", () => {
  assert.deepEqual(P.validarConta({ forma: "PIX", chave: " 62 99999-0000 ", banco: "077 - INTER" }),
    { ok: true, valor: "PIX, chave 62 99999-0000, no banco 077 - INTER" });
  assert.deepEqual(P.validarConta({ forma: "BANCO", banco: "756 - SICOOB", agencia: "3001", conta: "12345-6", tipo: "Corrente" }),
    { ok: true, valor: "Banco 756 - SICOOB, agência 3001, conta corrente nº 12345-6" });
  assert.equal(P.validarConta({ forma: "PIX", chave: "abc", banco: "INTER" }).erro, "PIX_SEM_CHAVE");
  assert.equal(P.validarConta({ forma: "PIX", chave: "abcdef", banco: "" }).erro, "SEM_BANCO");
  assert.equal(P.validarConta({ forma: "BANCO", banco: "SICOOB", agencia: "ag 1", conta: "1", tipo: "corrente" }).erro, "AGENCIA_INVALIDA");
  assert.equal(P.validarConta({ forma: "BANCO", banco: "SICOOB", agencia: "1", conta: "", tipo: "corrente" }).erro, "CONTA_INVALIDA");
  assert.equal(P.validarConta({ forma: "BANCO", banco: "SICOOB", agencia: "1", conta: "2", tipo: "salário" }).erro, "TIPO_CONTA_INVALIDO");
  assert.equal(P.validarConta({}).erro, "FORMA_CONTA");
  assert.equal(P.validarConta("64993060877").erro, "FORMA_CONTA");      // texto livre não vale mais
  assert.equal(P.validarConta({ forma: "PIX", chave: "{{X}}chave1", banco: "B, C" }).valor, "PIX, chave Xchave1, no banco B C");
});

test("conta: a frase gravada volta para a tela; texto antigo pede para escolher de novo", () => {
  for (const o of [{ forma: "PIX", chave: "a@b.com", banco: "001 - BANCO DO BRASIL" },
                   { forma: "BANCO", banco: "104 - CAIXA", agencia: "0012", conta: "000123-4", tipo: "poupança" }])
    assert.deepEqual(P.lerConta(P.montarConta(o).valor), o);
  assert.deepEqual(P.lerConta("64993060877"), { forma: "", livre: "64993060877" });
  assert.ok(P.faltas(P.montar(dados(), { ...X, conta: "64993060877" }))
    .includes("Conta para devolução: escolha PIX ou dados bancários e salve de novo"));
});
