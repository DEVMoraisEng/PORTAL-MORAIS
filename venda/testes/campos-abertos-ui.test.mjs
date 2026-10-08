/* Entrega 12 — tela do contrato: formulário dos cadastros e "Conta de recebimento" (venda-dossie.js, sem DOM).
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");
const CV = require("../ContratoVenda.js");

const uic = (x = {}) => Object.assign({ ocupadoContrato: null, faltas: null, campos: null, rascunho: {}, msg: "", testes: false }, x);
const CONTAS = { opcoes: [{ id: "a1", nome: "CONTA FICTICIA A" }, { id: "b2", nome: "CONTA <B>" }], escolhida: null, padrao: "a1" };

test("formulário: um campo por falta, agrupado; lista só com o que o formulário não cobre; botão Salvar", () => {
  const campos = CV.camposAbertos(["Vendedor: RG", "Vendedor: tipo (PJ ou PF)", "Corretor: cadastro em CORRETORES – CONTRATO", "Imóvel: CRI da matrícula", "Vendedor: banco"],
    { chaveLoteamento: "X" });
  const fr = D.faltasDaResposta({ ok: false, erro: "FALTAM_DADOS", faltas: ["…"], campos });
  assert.deepEqual(fr.faltas, ["Imóvel: CRI da matrícula"]);
  const h = D.htmlContrato({ gerado: false, etapa: "NENHUM" }, uic({ faltas: fr.faltas, campos: fr.campos, rascunho: { "vendedor|RG": "RG <1>" } }));
  assert.match(h, /<li>Imóvel: CRI da matrícula<\/li>/);
  assert.match(h, /<b>Vendedor<\/b>/);
  assert.match(h, /<b>Corretor<\/b> <small>\(novo cadastro\)<\/small>/);
  assert.match(h, /data-campo="vendedor\|RG" value="RG &lt;1&gt;"/, "rascunho volta escapado");
  assert.match(h, /<select data-campo="vendedor\|TIPO"><option value="">—<\/option><option value="PJ">PJ<\/option><option value="PF">PF<\/option><\/select>/);
  assert.match(h, /data-campo="corretor\|CRECI"/);
  assert.match(h, /data-campo="corretor\|CPF\/CNPJ"/);
  assert.match(h, /escolha ou digite em "Conta de recebimento"/);
  assert.match(h, /data-acao="c-salvar-campos">Salvar dados e gerar pré-contrato/);
  /* TESTES: tudo desabilitado */
  const t = D.htmlContrato({ gerado: false, etapa: "NENHUM" }, uic({ testes: true, campos: fr.campos, faltas: fr.faltas }));
  assert.match(t, /data-campo="vendedor\|RG" disabled/);
  assert.match(t, /data-acao="c-salvar-campos" disabled/);
  /* servidor antigo (sem campos): só a lista, como antes */
  assert.deepEqual(D.faltasDaResposta({ faltas: ["Vendedor: RG"] }), { faltas: ["Vendedor: RG"], campos: null });
  assert.doesNotMatch(D.htmlContrato({ gerado: false }, uic({ faltas: ["Vendedor: RG"] })), /c-salvar-campos/);
});

test("pedidoCampos: só os preenchidos, por grupo; nada preenchido e sem conta = null", () => {
  assert.deepEqual(D.pedidoCampos([{ chave: "vendedor|RG", valor: " RG 1 " }, { chave: "vendedor|TIPO", valor: "" }, { chave: "corretor|CRECI", valor: "C 2" }]),
    { campos: { vendedor: { RG: "RG 1" }, corretor: { CRECI: "C 2" } } });
  assert.equal(D.pedidoCampos([{ chave: "vendedor|RG", valor: "" }], null), null);
  assert.deepEqual(D.pedidoCampos([], { banco: "1", agencia: "2", conta: "3", pix: "" }), { campos: {}, conta: { banco: "1", agencia: "2", conta: "3", pix: "" } });
  assert.equal(D.contaDasEntradas({ banco: " ", agencia: "", conta: "" }), null);
});

test("conta de recebimento: lista só com títulos; padrão = conta da obra; 'Digitar outra conta' abre as caixas", () => {
  const e = { gerado: false, etapa: "NENHUM", conta: D.contaDoEstado(CONTAS) };
  const h = D.htmlContrato(e, uic());
  assert.match(h, /Conta de recebimento/);
  assert.match(h, /<option value="a1" selected>CONTA FICTICIA A \(conta da obra\)<\/option>/);
  assert.match(h, /<option value="b2">CONTA &lt;B&gt;<\/option>/);
  assert.match(h, /<option value="__digitar">Digitar outra conta<\/option>/);
  assert.doesNotMatch(h, /data-conta-campo/);
  /* sem conta da obra: "— escolha a conta —" */
  const s = D.htmlContrato({ gerado: false, conta: D.contaDoEstado(Object.assign({}, CONTAS, { padrao: "" })) }, uic());
  assert.match(s, /<option value="" selected>— escolha a conta —<\/option>/);
  /* escolhida da lista */
  const b = D.htmlContrato({ gerado: false, conta: D.contaDoEstado(Object.assign({}, CONTAS, { escolhida: { id: "b2" } })) }, uic());
  assert.match(b, /<option value="b2" selected>/);
  /* digitando agora: caixas com o rascunho, botão Salvar conta */
  const d = D.htmlContrato(e, uic({ contaDigitar: true, rascunho: { "conta|banco": "341" } }));
  assert.match(d, /<option value="__digitar" selected>/);
  assert.match(d, /data-conta-campo="banco" value="341"/);
  assert.match(d, /data-acao="c-salvar-conta"/);
  assert.match(d, /vale só para esta venda/);
  /* digitada gravada: caixas abertas com os valores dela */
  const g = D.htmlContrato({ gerado: false, conta: D.contaDoEstado(Object.assign({}, CONTAS, { escolhida: { banco: "104", agencia: "5", conta: "6-7", pix: "" } })) }, uic());
  assert.match(g, /data-conta-campo="conta" value="6-7"/);
  /* servidor antigo: sem o campo */
  assert.doesNotMatch(D.htmlContrato({ gerado: false }, uic()), /Conta de recebimento/);
  assert.match(D.htmlContrato(e, uic({ testes: true })), /<select data-conta disabled>/);
});

test("estadoContrato guarda a conta; mensagens novas", () => {
  const est = D.estadoContrato({ ok: true, gerado: false, etapa: "NENHUM", conta: CONTAS });
  assert.deepEqual(est.conta, { opcoes: CONTAS.opcoes, escolhida: null, padrao: "a1" });
  assert.equal(D.mensagemContrato({ erro: "CAMPOS_INVALIDOS", erros: ["Vendedor — RG: x", "Corretor — CRECI: y"] }), "Confira: Vendedor — RG: x; Corretor — CRECI: y.");
  assert.match(D.mensagemContrato({ erro: "VENDEDOR_SEM_CADASTRO" }), /cadastro de vendedores/);
  assert.match(D.mensagemContrato({ erro: "CONTRATO_FALHOU", salvos: ["vendedor"] }), /^Dados salvos \(vendedor\), mas: Não consegui gerar/);
});
