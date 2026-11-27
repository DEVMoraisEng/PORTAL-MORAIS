/* 27/11/2026 (Juliana não conseguiu gerar o contrato de uma casa de rua geminada e fez à mão):
 *  - confrontações da certidão mãe vinham com as duas casas ("Casa 01: …; e Casa 02: …");
 *  - conta da obra "DÚVIDA" no Notion: o contrato caía no banco do vendedor, o Mais Controle usava outra conta;
 *  - corretor empresa saía "CPF nº <CNPJ>";
 *  - imobiliária como corretor, ou imobiliária + corretor;
 *  - depois de salvar o cadastro do corretor a tela seguia dizendo "ainda não tem cadastro".
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CV, tokenDe, PAGE, cenario, tit, sel, rt, MODELO_OBRA, CORRETOR, mescla, colunasVenda } from "./contrato-cenario.mjs";

const RV = createRequire(import.meta.url)("../RegrasVenda.js");

const DUAS = "Para um observador de costas para o Condominio e de frente para a Rua Teste, Casa 01: confrontando pelo lado " +
  "direito com a casa 02, pelo lado esquerdo com o lote 25 e fundo com o lote 17; e Casa 02: confrontando pelo lado direito " +
  "com lote 27, pelo lado esquerdo com casa 01, fundo com lote 17.";

test("recortarConfrontacoes: fica só a casa da venda, com a referência do observador", () => {
  const r1 = RV.recortarConfrontacoes(DUAS, "1");
  assert.equal(r1.recortado, true);
  assert.equal(r1.texto, "Para um observador de costas para o Condominio e de frente para a Rua Teste, Casa 01: confrontando pelo lado " +
    "direito com a casa 02, pelo lado esquerdo com o lote 25 e fundo com o lote 17.");
  const r2 = RV.recortarConfrontacoes(DUAS, "02");
  assert.equal(r2.texto, "Para um observador de costas para o Condominio e de frente para a Rua Teste, Casa 02: confrontando pelo lado " +
    "direito com lote 27, pelo lado esquerdo com casa 01, fundo com lote 17.");
});
test("recortarConfrontacoes: uma casa só (mesmo citando a vizinha) não mexe; casa que não está no texto avisa", () => {
  const uma = "Pelo lado direito com lote 27, pelo lado esquerdo com casa 01, fundo com lote 17.";
  assert.deepEqual(RV.recortarConfrontacoes(uma, "2"), { texto: uma, recortado: false, varias: false });
  const r = RV.recortarConfrontacoes(DUAS, "3");
  assert.equal(r.recortado, false); assert.equal(r.varias, true); assert.equal(r.texto, DUAS);
  /* "confontando" (digitado à mão) e "Casa 02," também contam como começo */
  const dig = "Casa 01 confontando pelo lado direito com a casa 02, fundo com o lote 17, e Casa 02, confrontando pelo lado esquerdo com casa 01";
  assert.equal(RV.recortarConfrontacoes(dig, "2").texto, "Casa 02, confrontando pelo lado esquerdo com casa 01.");
});
test("certidão mãe com as duas casas: grava só a da venda e avisa", () => {
  const atuais = { __CASA: "1", "IMÓVEL - CERTIDÃO MÃE": [{ name: "mae.pdf" }] };
  const p = RV.planejarGravacao("IMOVEL_CERTIDAO_MAE", { tipo_documento: "CERTIDAO_MAE", unidade_encontrada: "SIM",
    unidade_identificacao: "Casa 01", unidade_confrontacoes: DUAS }, atuais, "2026-11-27", "atualizar");
  const conf = p.props["CONTRATO - CONFRONTAÇÕES"];
  assert.ok(conf && /Casa 01/.test(conf) && !/Casa 02: confrontando/.test(conf), conf);
  assert.ok(p.observacoes.some((o) => /mais de uma casa/.test(o)));
});

test("contaDaObraNoMC lê a linha que o robô escreve em MC - SITUAÇÃO", () => {
  const s = "PRÉVIA OK [#abc] | VENDA CASA 01\nCliente: FULANO (novo)\nConta da obra: CONTA TESTE - SICOOB\nParcelas: 2";
  assert.equal(CV.contaDaObraNoMC(s), "CONTA TESTE - SICOOB");
  assert.equal(CV.contaDaObraNoMC("PRÉVIA OK"), "");
  assert.equal(CV.contaDaObraNoMC(null), "");
});
test("corretorPessoaTexto / ehCnpj", () => {
  assert.equal(CV.ehCnpj("11.222.333/0001-81"), true);
  assert.equal(CV.ehCnpj("000.000.003-53"), false);
  assert.equal(CV.corretorPessoaTexto({ nome: "Ciclano Corretor", creci: "CRECI 999", cpfCnpj: "000.000.003-53" }),
    ", representada por seu corretor Ciclano Corretor, CRECI nº CRECI 999, CPF nº 000.000.003-53");
  assert.equal(CV.corretorPessoaTexto(null), "");
});

/* ---- ponta a ponta no GerarContrato (Notion/Drive falsos) ---- */
const MODELO_CORRETOR = [...MODELO_OBRA, "c) Corretor: {{CORRETOR_NOME}}, CRECI nº {{CORRETOR_CRECI}}, CPF nº {{CORRETOR_DOC}}"];
const drive = { modelos: { "modelo-obra": MODELO_CORRETOR, "modelo-pronto": ["MODELO PRONTO", ...MODELO_CORRETOR] } };
const textoPre = (c) => { const ult = c.d.estado.copias.at(-1); return c.d.estado.salvos[ult.id].pars.join("\n"); };
const linhaCorretor = (c) => textoPre(c).split("\n").find((l) => /^c\) Corretor:/.test(l));

test("corretor empresa: o contrato diz CNPJ nº, não CPF nº", () => {
  const c = cenario({ drive, corretor: { "CPF/CNPJ": rt("11.222.333/0001-81") } });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(linhaCorretor(c), "c) Corretor: Corretor Teste, CRECI nº CRECI 123, CNPJ nº 11.222.333/0001-81");
});
test("corretor pessoa: continua CPF nº", () => {
  const c = cenario({ drive });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(linhaCorretor(c), "c) Corretor: Corretor Teste, CRECI nº CRECI 123, CPF nº 000.000.003-53");
});

const IMOB = { NOME: tit("Imobiliaria Teste Ltda"), CRECI: rt("CRECI-J 77"), "CPF/CNPJ": rt("11.222.333/0001-81"),
  "E-MAIL": { email: "imob.teste@teste.example" } };
function cenarioImob(modo) {
  const colunas = Object.assign(colunasVenda(), { "IMOBILIÁRIA": { tipo: "select", opcoes: ["Imobiliaria Teste"] } });
  const c = cenario({ drive, colunas, venda: { "IMOBILIÁRIA": sel("Imobiliaria Teste") },
    bases: { "db-corr": [mescla(CORRETOR, {}), IMOB] } });
  if (modo) {
    const r = c.g.chamar({ action: "escolherCorretorContrato", token: tokenDe(), pageId: PAGE, modo });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.intermediador.modo, modo);
  }
  return c;
}
test("imobiliária como corretor: o nome curto da venda acha a razão social no cadastro", () => {
  const c = cenarioImob("IMOBILIARIA");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(linhaCorretor(c), "c) Corretor: Imobiliaria Teste Ltda, CRECI nº CRECI-J 77, CNPJ nº 11.222.333/0001-81");
});
test("imobiliária + corretor: a imobiliária é a parte e o corretor vai junto", () => {
  const c = cenarioImob("AMBOS");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(linhaCorretor(c), "c) Corretor: Imobiliaria Teste Ltda, CRECI nº CRECI-J 77, CNPJ nº 11.222.333/0001-81, " +
    "representada por seu corretor Corretor Teste, CRECI nº CRECI 123, CPF nº 000.000.003-53");
});
test("voltar para o corretor apaga a escolha; venda sem imobiliária não aceita IMOBILIARIA", () => {
  const c = cenarioImob("IMOBILIARIA");
  const r = c.g.chamar({ action: "escolherCorretorContrato", token: tokenDe(), pageId: PAGE, modo: "CORRETOR" });
  assert.equal(r.ok, true); assert.equal(r.intermediador.modo, "CORRETOR");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.match(linhaCorretor(c), /^c\) Corretor: Corretor Teste,/);
  const sem = cenario({ drive });
  const x = sem.g.chamar({ action: "escolherCorretorContrato", token: tokenDe(), pageId: PAGE, modo: "IMOBILIARIA" });
  assert.equal(x.ok, false);
});
test("contratoEstado da casa de rua traz o intermediador", () => {
  const c = cenarioImob();
  const r = c.acao("contratoEstado");
  assert.equal(r.ok, true);
  assert.deepEqual({ modo: r.intermediador.modo, imob: r.intermediador.imobiliaria }, { modo: "CORRETOR", imob: "Imobiliaria Teste" });
});
test("salvar o cadastro do corretor devolve o bloco da comissão já com o cadastro", () => {
  const c = cenario({ drive, corretor: { CRECI: rt("") } });
  const r = c.g.chamar({ action: "salvarCamposContrato", token: tokenDe(), pageId: PAGE,
    campos: { corretor: { CRECI: "CRECI 555" } } });
  assert.ok(r.comissaoCorretor, JSON.stringify(r).slice(0, 300));
  assert.equal(r.comissaoCorretor.temCadastro, true);
});
