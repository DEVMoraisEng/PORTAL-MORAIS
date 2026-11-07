/* 07/11/2026 — o formulário do corretor (completar.html, SIMULADOR) põe o cônjuge do comprador casado como OUTRO
 * comprador da lista: o 2º comprador vai para o bloco "… COMPRADOR 1" do condomínio e o cônjuge dele para o
 * "… COMPRADOR 2" (com e-mail em EMAIL COMPRADOR 2). CONJUGE DO COMPRADOR 1 / CPF CONJUGE DO COMPRADOR 1 apontam
 * para essa pessoa, e EMAIL CONJUGE DO COMPRADOR 1 fica vazia. O contrato tem de usar o e-mail dela.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas } from "./fakes.mjs";

const CV = createRequire(import.meta.url)("../ContratoVenda.js");
const rt = (s) => ({ type: "rich_text", rich_text: [{ plain_text: s, text: { content: s } }] });
const em = (s) => ({ type: "email", email: s });
const BASE = {
  "PROPONENTE": rt("PROPONENTE TESTE"), "COMPRADOR 1": rt("SEGUNDO TESTE SOUZA"), "CPF COMPRADOR 1": rt("111.444.777-35"),
  "ESTADO CIVIL COMPRADOR 1": rt("CASADO"), "REGIME DE BENS COMPRADOR 1": rt("COMUNHAO PARCIAL DE BENS"),
  "CONJUGE DO COMPRADOR 1": rt("CONJUGE SEGUNDO SOUZA"), "CPF CONJUGE DO COMPRADOR 1": rt("529.982.247-25"),
  "COMPRADOR 2": rt("CONJUGE SEGUNDO SOUZA"), "CPF COMPRADOR 2": rt("529.982.247-25"), "EMAIL COMPRADOR 2": em("cj2@teste.example"),
};
function conj2(props) {
  const g = criarGas({ props: {} });
  return g.ctx.ctrDadosCondominio_(g.ctx.ctrPorChave_(props)).condominio.conjugeComprador2;
}

test("cônjuge do 2º que veio do formulário como 3º comprador: o e-mail sai de EMAIL COMPRADOR 2", () => {
  assert.equal(conj2(BASE).email, "cj2@teste.example");
  const d = { comprador1: { nome: "PROPONENTE TESTE" }, comprador2: { nome: "SEGUNDO TESTE SOUZA", cpf: "111.444.777-35" },
              condominio: CV.montarCondominio(Object.assign({}, { conjugeComprador2: conj2(BASE) }, { fluxo: {} })) };
  assert.equal(d.condominio.conjugeComprador2.email, "cj2@teste.example");
});

test("casa pelo nome quando o CPF do 3º não veio", () => {
  const p = { ...BASE, "CPF COMPRADOR 2": rt("") };
  assert.equal(conj2(p).email, "cj2@teste.example");
});

test("EMAIL CONJUGE DO COMPRADOR 1 preenchido vale primeiro; 3º comprador que é outra pessoa não empresta o e-mail", () => {
  assert.equal(conj2({ ...BASE, "EMAIL CONJUGE DO COMPRADOR 1": em("direto@teste.example") }).email, "direto@teste.example");
  const outro = { ...BASE, "COMPRADOR 2": rt("TERCEIRO OUTRO NOME"), "CPF COMPRADOR 2": rt("935.411.347-80") };
  assert.equal(conj2(outro).email, "");
});
