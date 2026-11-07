/* 05/11/2026 (dono): "alguns preferem reduzir o valor a financiar (nunca pode ser maior que o valor da carta de
 * aprovação)". No Alterar fluxo a linha do financiamento aceita valor MENOR que o da proposta (VALOR DO CRÉDITO = carta);
 * FGTS, subsídio e pré-reserva continuam fixos. A diferença vai para pré-chaves/balões/pós-chaves soltos (guiar).
 * Contrato, Mais Controle (mc/condominio.py, teste em venda/mc/testes) e cartão leem a linha do fluxo. Números inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");
const C = require("../ContratoVenda.js");
const CV = require("../CondominioVenda.js");
const D = require("../../venda-dossie.js");
import { P, SCHEMA_VENDAS, linhaCondominio } from "./condominio-dados.mjs";

/* casa de 220.000 aprovada em 160.000 na carta */
const padrao = { valor: 220000, entrega: "2028-11-30", linhas: [
  { t: "sinal", v: 10000, n: 1, d: "2026-11-05", i: 1, x: "" },
  { t: "pre", v: 860, n: 12, d: "2026-11-10", i: 1, x: "" },
  { t: "pre", v: 330, n: 12, d: "2027-11-10", i: 1, x: "" },
  { t: "balao", v: 10000, n: 1, d: "2027-12-10", i: 1, x: "" },
  { t: "balao", v: 25720, n: 1, d: "2028-11-10", i: 1, x: "" },
  { t: "fin", v: 160000, n: 1, d: "", i: 1, x: "" }
] };
const copia = (o) => JSON.parse(JSON.stringify(o));
const comFin = (v, ajuste = 0) => {
  const f = copia(padrao);
  f.linhas[5].v = v;
  f.linhas[4].v += ajuste;                       // o balão da entrega cobre a diferença
  return f;
};

test("régua do teste fecha e o teto é o da proposta", () => {
  assert.deepEqual(F.validar(padrao, padrao).erros, []);
  assert.equal(F.tetoFinanciamento(padrao), 160000);
  assert.equal(F.tetoFinanciamento({ linhas: [] }), 0);
});

test("financiamento menor que a carta (150.000) com a diferença nas parcelas: salva", () => {
  const f = comFin(150000, 10000);
  assert.deepEqual(F.validar(f, padrao).erros, []);
});

test("financiamento acima da carta (170.000): recusado com o valor aprovado; zero também", () => {
  const r = F.validar(comFin(170000, -10000), padrao);
  assert.ok(r.erros.includes("O financiamento não pode passar do valor aprovado na carta: R$ 160.000,00"), r.erros.join("; "));
  assert.ok(r.porLinha[5] && r.porLinha[5].length, "o erro aparece na linha do financiamento");
  assert.ok(F.validar(comFin(0, 160000), padrao).erros.some((e) => /financiamento|maior que zero/i.test(e)));
});

test("financiamento não sai do fluxo nem ganha outra linha; FGTS/subsídio/pré-reserva continuam fixos", () => {
  const sem = copia(padrao); sem.linhas.splice(5, 1); sem.linhas[4].v += 160000;
  assert.ok(F.validar(sem, padrao).erros.length);
  const duas = comFin(80000); duas.linhas.push({ t: "fin", v: 80000, n: 1, d: "", i: 1, x: "" });
  assert.ok(F.validar(duas, padrao).erros.length, "duas linhas de financiamento");
  const p2 = copia(padrao); p2.linhas.push({ t: "fgts", v: 5000, n: 1, d: "", i: 1, x: "" }); p2.linhas[5].v = 155000;
  const fg = copia(p2); fg.linhas[6].v = 4000; fg.linhas[4].v += 1000;
  assert.match(F.validar(fg, p2).erros.join(";"), /Pré-reserva paga, financiamento, FGTS e subsídio não mudam|FGTS/);
});

test("guiar trata o financiamento como fixo: reduzir 10.000 sobe pré-chaves e balões pela régua; o financiamento fica", () => {
  const f = comFin(150000);                       // faltam 10.000
  const r = F.guiar(f, []);
  assert.ok(r.linhas, r.erro);
  assert.equal(r.linhas[5].v, 150000);
  assert.ok(!r.mudou.includes(5));
  assert.equal(F.validar({ ...f, linhas: r.linhas }, padrao).ok, true);
});

test("contrato: com a linha de 150.000 o financiamento bancário sai 150.000 (não o VALOR DO CRÉDITO de 160.000)", () => {
  const livre = comFin(150000, 10000);
  const fluxo = { assinatura: "2026-11-05", diaPagamento: 10, entrega: "2028-11-30", valorVenda: 220000, balao2Data: "2028-11-10", credito: 160000, fgts: 0 };
  const co = { fluxo, livre, comissao: 11000, valorParaEntrada: 60000 };
  assert.equal(C.valoresCondominio(co).financiamento, 150000);
  assert.match(C.formaPagamentoCondominio(fluxo, livre), /Financiamento bancário: R\$ 150\.000,00/);
  assert.doesNotMatch(C.formaPagamentoCondominio(fluxo, livre), /160\.000,00/);
});

test("Gerar venda (VENDAS): VALOR FINANCIADO sai da linha do fluxo alterado; sem fluxo alterado, da coluna", () => {
  const livre = comFin(150000, 10000);
  const com = CV.mapear(linhaCondominio({ "FLUXO PERSONALIZADO": P.texto(F.serializar(livre)) }), SCHEMA_VENDAS);
  assert.equal(com["VALOR FINANCIADO"], 150000);
  assert.equal(CV.mapear(linhaCondominio(), SCHEMA_VENDAS)["VALOR FINANCIADO"], 180000);
});

/* ---- tela ---- */
const fechado = { coluna: true, alterado: false, trava: "", por: "", em: "", alteracoes: 0 };
const ed = () => ({ valor: 220000, valorOriginal: 220000, entrega: "2028-11-30", linhas: copia(padrao.linhas), padrao: copia(padrao),
                    historico: [], alterado: false, motivo: "cliente financia menos", motivoPreco: "" });

test("tela: a linha do financiamento tem campo de valor e a nota da carta; sem quantidade, data, ↻ nem ✕", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: ed() }, "");
  const tr = h.match(/<tr data-fx-linha="5"[^>]*>.*?<\/tr>/s)[0];
  assert.match(tr, /<input[^>]*data-fx="v"[^>]*data-k="5"[^>]*value="160\.000,00"/);
  assert.match(tr, /até R\$ 160\.000,00 \(carta de aprovação\)/);
  assert.doesNotMatch(tr, /data-fx="n"|data-fx="d"|c-fluxo-red|c-fluxo-del|c-fluxo-trava/);
});

test("tela: baixar o financiamento chama o simulador; o financiamento não trava e não muda; acima da carta mostra o erro", () => {
  const e = ed();
  e.linhas[5].v = 150000;
  assert.equal(D.fxMexeu(e, 5, "v"), true, "pede a conta");
  assert.ok(!(e.travadas || {})[5], "o financiamento não é linha do simulador");
  D.guiarEditor(e, null);
  assert.equal(e.linhas[5].v, 150000);
  assert.equal(F.validar({ valor: e.valor, linhas: e.linhas }, e.padrao).ok, true);
  const alto = ed(); alto.linhas[5].v = 170000; D.guiarEditor(alto, null);
  assert.match(D.htmlFluxoVivo(alto, ""), /O financiamento não pode passar do valor aprovado na carta: R\$ 160\.000,00/);
});
