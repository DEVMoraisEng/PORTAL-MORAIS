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
const X = { conta: "PIX, chave 529.982.247-25, no banco 756 - SICOOB", valor: "3000", dataPagamento: "2026-10-24", hojeISO: "2026-10-27" };

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
  const t = P.montar(dados({ email: "" }, { nome: "CONDOMÍNIO OUTRO TESTE" }), { hojeISO: "2026-10-27", valor: "x", dataPagamento: "amanhã" });
  assert.deepEqual(P.faltas(t), [
    "Pré-reservante: e-mail (coluna Email)", "Unidade: fora da tabela do condomínio (tipo da casa)",
    "Conta para devolução (preencha no cartão)", "Valor da pré-reserva (preencha no cartão)",
    "Data do pagamento da pré-reserva (preencha no cartão)"]);
  const cpf = C.montarDadosContrato({ venda: { CLIENTES: "X TESTE", CPF: "529.982.247-24", COMPRADOR1: {}, COMPRADOR2: { nome: "" } },
    obra: {}, condominio: { nome: "RESERVA DOS IPÊS", unidade: "1", fluxo: {}, fiadores: [] } });
  assert.ok(P.faltas(P.montar(cpf, X)).includes("Pré-reservante: CPF inválido"));
});

test("01/11: validarPagamento barra data futura (hoje vem do servidor) e valor acima do sinal; sinal desconhecido não barra", () => {
  const ok = (o) => P.validarPagamento({ hojeISO: "2026-11-01", sinal: 10000, ...o });
  assert.equal(ok({ valor: 1000, data: "2027-01-10" }).erro, "PR_DATA_FUTURA");
  assert.equal(ok({ valor: 1000, data: "2026-11-02" }).erro, "PR_DATA_FUTURA");
  assert.equal(ok({ valor: 1000, data: "2026-11-01" }).ok, true, "hoje vale");
  assert.equal(ok({ valor: 50000, data: "2026-10-30" }).erro, "PR_VALOR_MAIOR_QUE_SINAL");
  assert.equal(ok({ valor: 10000, data: "2026-10-30" }).ok, true, "igual ao sinal vale");
  for (const sinal of [0, null, undefined, ""]) assert.equal(ok({ valor: 50000, data: "2026-10-30", sinal }).ok, true, "sinal " + sinal);
  assert.equal(ok({ valor: 0, data: "2026-10-30" }).erro, "PR_VALOR_INVALIDO");
  assert.equal(ok({ valor: 1000, data: "amanhã" }).erro, "PR_DATA_INVALIDA");
  assert.equal(P.validarPagamento({ valor: 1000, data: "2030-01-01" }).ok, true, "sem hojeISO (chamada antiga) não barra data");
  assert.equal(P.sinalDoFluxo({ sinalAto: 1000, sinal30: 3000, sinal60: null, sinal90: 3000 }), 7000);
  assert.equal(P.sinalDoFluxo({}), 0);
});

test("01/11: faltas repete a checagem: data futura e valor acima do sinal (só com sinal conhecido)", () => {
  const com = (fluxo, x) => P.faltas(P.montar(dados({}, { fluxo }), { ...X, hojeISO: "2026-11-01", ...x }));
  assert.deepEqual(com({ sinalAto: 5000, sinal30: 5000 }, {}), []);
  assert.deepEqual(com({ sinalAto: 5000, sinal30: 5000 }, { dataPagamento: "2027-01-10" }), ["Data do pagamento da pré-reserva: não pode ser depois de hoje"]);
  assert.deepEqual(com({ sinalAto: 5000, sinal30: 5000 }, { valor: "50000" }), ["Valor da pré-reserva: maior que o sinal da venda (R$ 10.000,00)"]);
  assert.deepEqual(com({}, { valor: "50000" }), [], "sem sinal conhecido não barra");
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

test("31/10: prazo = pagamento + 7 dias corridos (vira mês e ano)", () => {
  assert.equal(P.PRAZO_DIAS, 7);
  assert.equal(P.prazoDe("2026-10-24"), "2026-10-31");
  assert.equal(P.prazoDe("28/11/2026"), "2026-12-05");
  assert.equal(P.prazoDe("2026-12-27"), "2027-01-03");
  assert.equal(P.prazoDe(""), "");
  const m = P.marcadores(P.montar(dados(), X));
  assert.equal(m.PRE_RESERVA_DATA_PAGAMENTO, "24/10/2026");
});

test("31/10: validarPagamento e histórico (só muda o que mudou; corta as linhas mais antigas)", () => {
  assert.deepEqual(P.validarPagamento({ valor: "3.000,00", data: "02/11/2026" }), { ok: true, valor: 3000, data: "2026-11-02" });
  assert.equal(P.validarPagamento({ valor: "", data: "2026-11-02" }).erro, "PR_VALOR_INVALIDO");
  assert.equal(P.validarPagamento({ valor: 2000000, data: "2026-11-02" }).erro, "PR_VALOR_INVALIDO");
  assert.equal(P.validarPagamento({ valor: 1000, data: "amanhã" }).erro, "PR_DATA_INVALIDA");
  assert.equal(P.linhaHistorico({ valor: 1000, data: "2026-11-02" }, { valor: 1000, data: "2026-11-02" }, "ana", "x"), "");
  assert.equal(P.linhaHistorico({ valor: 1000, data: "2026-11-02" }, { valor: 1000, data: "2026-11-04" }, "ana", "31/10/2026 10:00"),
    "31/10/2026 10:00 ana: pagamento 02/11/2026 → 04/11/2026");
  const muitas = Array.from({ length: 80 }, (_, i) => "linha " + i + " " + "x".repeat(30)).join("\n");
  const j = P.juntarHistorico(muitas, "nova");
  assert.ok(j.length <= 1900);
  assert.ok(j.endsWith("\nnova"));
  assert.ok(!j.startsWith("linha 0 "));
});
