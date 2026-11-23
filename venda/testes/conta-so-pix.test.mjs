/* 23/11/2026 (dono): conta de recebimento só com a chave Pix — sobretudo vendedor pessoa física, preenchida na
 * hora do contrato. Sem banco, agência e conta, o 6.3 sai "PIX: <chave> - Titularidade…", sem rótulos em branco.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { CV, tokenDe, PAGE, cenario } from "./contrato-cenario.mjs";

const textoPre = (c) => { const ult = c.d.estado.copias.at(-1); return c.d.estado.salvos[ult.id].pars.join("\n"); };
const chamar = (c, payload, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok, pageId: PAGE }, payload));

test("validarContaDigitada: só a chave Pix vale; banco/agência/conta vão juntos ou nenhum", () => {
  assert.deepEqual(CV.validarContaDigitada({ banco: "", agencia: "", conta: "", pix: "pix-pf@exemplo.test" }),
    { ok: true, conta: { banco: "", agencia: "", conta: "", pix: "pix-pf@exemplo.test" } });
  assert.deepEqual(CV.validarContaDigitada({ pix: "pix-pf@exemplo.test" }).ok, true);
  /* Pix com conta pela metade: continua pedindo o que falta da conta */
  assert.deepEqual(CV.validarContaDigitada({ banco: "341", agencia: "", conta: "", pix: "pix-pf@exemplo.test" }).erros,
    ["Conta — Agência: obrigatório", "Conta — Conta: obrigatório"]);
  /* nada preenchido */
  assert.deepEqual(CV.validarContaDigitada({ banco: "", agencia: "", conta: "", pix: "" }).erros,
    ["Conta — Banco: obrigatório", "Conta — Agência: obrigatório", "Conta — Conta: obrigatório"]);
  /* operação sozinha não é conta */
  assert.equal(CV.validarContaDigitada({ operacao: "013", pix: "" }).ok, false);
});

test("faltasContrato: Pix sem banco/agência/conta não é falta; sem nenhum dos dois, é", () => {
  assert.equal(typeof CV.contaSoPix, "function");
  assert.equal(CV.contaSoPix({ banco: "", agencia: "", conta: "", pix: "x" }), true);
  assert.equal(CV.contaSoPix({ banco: "1", agencia: "", conta: "", pix: "x" }), false);
  assert.equal(CV.contaSoPix({ banco: "", agencia: "", conta: "", pix: "" }), false);
});

test("conta digitada só com Pix: grava, gera o pré-contrato e o 6.3 sai só com o Pix", () => {
  const c = cenario();
  const r = chamar(c, { action: "escolherContaRecebimento", conta: { banco: "", agencia: "", conta: "", pix: "pix-pf@exemplo.test" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.conta.escolhida, { banco: "", agencia: "", conta: "", pix: "pix-pf@exemplo.test" });
  const g = c.acao("gerarPreContrato");
  assert.equal(g.ok, true, JSON.stringify(g));
  const t = textoPre(c);
  assert.ok(t.includes("PIX: pix-pf@exemplo.test - Titularidade da VENDEDORA"), t);
  const linha = t.split("\n").find((l) => l.includes("Titularidade da VENDEDORA"));
  assert.equal(linha, "PIX: pix-pf@exemplo.test - Titularidade da VENDEDORA");
  assert.ok(!/Banco:|Agência:|Conta\s|Operação:/.test(linha), linha);
  assert.equal(c.n.escritas.length + c.n.patches.length, 0, "nada no Notion");
  const logs = c.g.logs.join("\n");
  assert.ok(!logs.includes("pix-pf"), "log vazou a chave");
});

test("conta completa continua igual (banco, agência, conta e Pix)", () => {
  const c = cenario();
  assert.equal(chamar(c, { action: "escolherContaRecebimento", conta: { banco: "341", agencia: "4444", conta: "44444-4", pix: "pix-d@exemplo.test" } }).ok, true);
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.ok(textoPre(c).includes("Banco: 341 – Agência: 4444 – Conta 44444-4 – PIX: pix-d@exemplo.test - Titularidade"), textoPre(c));
});

test("tela: escolha só com Pix continua digitada (caixas abertas com a chave) e a ajuda fala do Pix", async () => {
  const { createRequire } = await import("node:module");
  const D = createRequire(import.meta.url)("../../venda-dossie.js");
  const conta = D.contaDoEstado({ opcoes: [{ id: "a1", nome: "CONTA FICTICIA A" }], escolhida: { banco: "", agencia: "", conta: "", pix: "pix-pf@exemplo.test" }, padrao: "" });
  assert.deepEqual(conta.escolhida, { banco: "", agencia: "", operacao: "", conta: "", pix: "pix-pf@exemplo.test" });
  const h = D.htmlConta(conta, {}, "");
  assert.match(h, /value="__digitar" selected/);
  assert.match(h, /value="pix-pf@exemplo\.test"/);
  assert.match(h, /basta a chave Pix/);
});
