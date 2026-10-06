/* ClicksignVenda.js — regras puras da assinatura (entrega 3). Sem rede.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const CS = createRequire(import.meta.url)("../ClicksignVenda.js");

const TEST_SPE = [{ nome: "Testemunha Um Spe", email: "t1.spe@teste.example", cpf: "000.000.005-15" },
                  { nome: "Testemunha Dois Spe", email: "t2.spe@teste.example", cpf: "000.000.006-04" }];
const TEST_PF = [{ nome: "Testemunha Um Pf", email: "t1.pf@teste.example", cpf: "000.000.007-87" },
                 { nome: "Testemunha Dois Pf", email: "t2.pf@teste.example", cpf: "000.000.008-68" }];
const PROPS = { ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify(TEST_SPE), ASSINATURA_TESTEMUNHAS_PF: JSON.stringify(TEST_PF) };

/* `dados` no formato de ContratoVenda.montarDadosContrato (só os campos que a assinatura usa). */
function dadosPJ(mud = {}) {
  const d = {
    comprador1: { nome: "Fulano de Teste", cpf: "000.000.001-91", email: "fulano@teste.example" },
    comprador2: null,
    vendedor: { tipo: "PJ", nome: "Construtora Teste Ltda", cpfCnpj: "00.000.000/0001-00", email: "",
                representanteNome: "Beltrano Representante", representanteCpf: "000.000.002-72", representanteEmail: "beltrano@teste.example" },
    corretor: { nome: "Corretor de Teste", cpfCnpj: "000.000.003-53", email: "corretor@teste.example" },
    imovel: { endereco: "RESIDENCIAL TESTE QD 07 LT 12" },
  };
  return Object.assign(d, mud);
}
const vendedorPF = { tipo: "PF", nome: "Investidor de Teste", cpfCnpj: "000.000.009-49", email: "investidor@teste.example",
                     representanteNome: "", representanteCpf: "", representanteEmail: "" };
const comprador2 = { nome: "Sicrana de Teste", cpf: "000.000.004-34", email: "sicrana@teste.example" };

test("config: lê as Propriedades (JSON) e o liga/desliga do corretor", () => {
  const c = CS.montarConfig(Object.assign({ ASSINATURA_INCLUIR_CORRETOR: "SIM" }, PROPS));
  assert.deepEqual(c.testemunhasSPE, TEST_SPE);
  assert.deepEqual(c.testemunhasPF, TEST_PF);
  assert.equal(c.representante, null);
  assert.equal(c.incluirCorretor, true);
  assert.deepEqual(c.invalidas, []);
  for (const v of ["sim", "true", "1"]) assert.equal(CS.montarConfig({ ASSINATURA_INCLUIR_CORRETOR: v }).incluirCorretor, true, v);
  for (const v of ["", "NÃO", "0", null]) assert.equal(CS.montarConfig({ ASSINATURA_INCLUIR_CORRETOR: v }).incluirCorretor, false, String(v));
  const ruim = CS.montarConfig({ ASSINATURA_TESTEMUNHAS_SPE: "[{nome:", ASSINATURA_REPRESENTANTE: "{x" });
  assert.equal(ruim.testemunhasSPE, null);
  assert.deepEqual(ruim.invalidas, ["ASSINATURA_TESTEMUNHAS_SPE", "ASSINATURA_REPRESENTANTE"]);
});

test("signatários, vendedor PJ: comprador, representante, par de testemunhas SPE; sem corretor por padrão", () => {
  const l = CS.signatarios(dadosPJ(), CS.montarConfig(PROPS));
  assert.deepEqual(l.map((s) => [s.papel, s.role, s.nome, s.email]), [
    ["Comprador 1", "buyer", "Fulano de Teste", "fulano@teste.example"],
    ["Vendedor (representante)", "seller", "Beltrano Representante", "beltrano@teste.example"],
    ["Testemunha 1", "witness", "Testemunha Um Spe", "t1.spe@teste.example"],
    ["Testemunha 2", "witness", "Testemunha Dois Spe", "t2.spe@teste.example"],
  ]);
  assert.equal(l[1].cpf, "000.000.002-72");
});

test("signatários, vendedor PF + casal + corretor ligado: par de testemunhas PF e corretor no fim", () => {
  const l = CS.signatarios(dadosPJ({ vendedor: vendedorPF, comprador2 }),
                           CS.montarConfig(Object.assign({ ASSINATURA_INCLUIR_CORRETOR: "SIM" }, PROPS)));
  assert.deepEqual(l.map((s) => [s.papel, s.role, s.email]), [
    ["Comprador 1", "buyer", "fulano@teste.example"],
    ["Comprador 2", "buyer", "sicrana@teste.example"],
    ["Vendedor", "seller", "investidor@teste.example"],
    ["Testemunha 1", "witness", "t1.pf@teste.example"],
    ["Testemunha 2", "witness", "t2.pf@teste.example"],
    ["Corretor", "real_estate_broker", "corretor@teste.example"],
  ]);
});

test("representante da Propriedade só entra quando o cadastro não traz o e-mail e o nome dela bate com o do cadastro", () => {
  const cfg = CS.montarConfig(Object.assign({ ASSINATURA_REPRESENTANTE: JSON.stringify({ nome: "Diretora da Spe", email: "diretora@teste.example", cpf: "000.000.009-49" }) }, PROPS));
  const doCadastro = CS.signatarios(dadosPJ(), cfg).find((s) => s.role === "seller");
  assert.equal(doCadastro.email, "beltrano@teste.example");
  /* cadastro com o MESMO nome (outra grafia), sem e-mail: usa a Propriedade */
  const mesmo = dadosPJ();
  mesmo.vendedor = Object.assign({}, mesmo.vendedor, { representanteNome: "DIRETORA  DA SPÉ", representanteEmail: "" });
  const daConfig = CS.signatarios(mesmo, cfg).find((s) => s.role === "seller");
  assert.deepEqual([daConfig.nome, daConfig.email, daConfig.cpf], ["Diretora da Spe", "diretora@teste.example", "000.000.009-49"]);
  /* cadastro com OUTRO representante, sem e-mail: não troca a pessoa — falta o e-mail no cadastro */
  const outro = dadosPJ();
  outro.vendedor = Object.assign({}, outro.vendedor, { representanteEmail: "" });
  const s = CS.signatarios(outro, cfg).find((x) => x.role === "seller");
  assert.deepEqual([s.nome, s.email], ["Beltrano Representante", ""]);
  assert.deepEqual(CS.faltasAssinatura(outro, cfg), ["Vendedor: falta REPRESENTANTE E-MAIL no cadastro"]);
  /* cadastro sem nome de representante: a Propriedade também não entra */
  const semNome = dadosPJ();
  semNome.vendedor = Object.assign({}, semNome.vendedor, { representanteNome: "", representanteEmail: "" });
  assert.equal(CS.signatarios(semNome, cfg).find((x) => x.role === "seller").email, "");
});

test("faltas: nenhuma no caso completo", () => {
  assert.deepEqual(CS.faltasAssinatura(dadosPJ(), CS.montarConfig(PROPS)), []);
  assert.deepEqual(CS.faltasAssinatura(dadosPJ({ vendedor: vendedorPF, comprador2 }), CS.montarConfig(PROPS)), []);
});

test("faltas legíveis: sem e-mail, e-mail inválido, nome sem sobrenome ou com número, CPF inválido", () => {
  const d = dadosPJ({ comprador2: { nome: "Sicrana", cpf: "000.000.004-14", email: "sicrana@" } });
  d.comprador1 = Object.assign({}, d.comprador1, { email: "" });
  d.vendedor = Object.assign({}, d.vendedor, { representanteNome: "Beltrano 2" });
  const f = CS.faltasAssinatura(d, CS.montarConfig(PROPS));
  assert.deepEqual(f, [
    "Comprador 1: e-mail (coluna COMPRADOR 1 - E-MAIL)",
    "Comprador 2: nome e sobrenome, sem números",
    "Comprador 2: e-mail inválido",
    "Comprador 2: CPF inválido",
    "Vendedor (representante): nome e sobrenome, sem números",
  ]);
  for (const x of f) assert.ok(!/fulano|sicrana|beltrano/i.test(x), "falta com dado pessoal: " + x);
});

test("faltas: vendedor ausente, PF sem e-mail, PJ sem representante e sem Propriedade", () => {
  const cfg = CS.montarConfig(PROPS);
  assert.deepEqual(CS.faltasAssinatura(dadosPJ({ vendedor: null }), cfg), ["Vendedor: cadastro em VENDEDORES – CONTRATO"]);
  assert.deepEqual(CS.faltasAssinatura(dadosPJ({ vendedor: Object.assign({}, vendedorPF, { email: "" }) }), cfg),
                   ["Vendedor: e-mail (coluna E-MAIL em VENDEDORES – CONTRATO)"]);
  const pj = dadosPJ();
  pj.vendedor = Object.assign({}, pj.vendedor, { representanteEmail: "" });
  assert.deepEqual(CS.faltasAssinatura(pj, cfg),
                   ["Vendedor: falta REPRESENTANTE E-MAIL no cadastro"]);
});

test("faltas: testemunhas não configuradas, inválidas ou só uma; par certo pelo tipo do vendedor", () => {
  assert.deepEqual(CS.faltasAssinatura(dadosPJ(), CS.montarConfig({ ASSINATURA_TESTEMUNHAS_PF: PROPS.ASSINATURA_TESTEMUNHAS_PF })),
                   ["Testemunhas: Propriedade ASSINATURA_TESTEMUNHAS_SPE não configurada (precisa de 2)"]);
  assert.deepEqual(CS.faltasAssinatura(dadosPJ({ vendedor: vendedorPF }), CS.montarConfig({ ASSINATURA_TESTEMUNHAS_PF: "nada" })),
                   ["Testemunhas: Propriedade ASSINATURA_TESTEMUNHAS_PF não configurada (precisa de 2)"]);
  assert.deepEqual(CS.faltasAssinatura(dadosPJ(), CS.montarConfig({ ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify([TEST_SPE[0]]) })),
                   ["Testemunhas: Propriedade ASSINATURA_TESTEMUNHAS_SPE não configurada (precisa de 2)"]);
  const ruim = [TEST_SPE[0], { nome: "Testemunha Dois Spe", email: "sem-arroba", cpf: "000.000.006-04" }];
  assert.deepEqual(CS.faltasAssinatura(dadosPJ(), CS.montarConfig({ ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify(ruim) })),
                   ["Testemunha 2: e-mail inválido"]);
});

test("faltas: corretor ligado sem cadastro ou sem e-mail; e-mail repetido entre signatários", () => {
  const cfg = CS.montarConfig(Object.assign({ ASSINATURA_INCLUIR_CORRETOR: "SIM" }, PROPS));
  assert.deepEqual(CS.faltasAssinatura(dadosPJ({ corretor: null }), cfg), ["Corretor: cadastro em CORRETORES – CONTRATO"]);
  assert.deepEqual(CS.faltasAssinatura(dadosPJ({ corretor: { nome: "Corretor de Teste", cpfCnpj: "", email: "" } }), cfg),
                   ["Corretor: e-mail (coluna E-MAIL em CORRETORES – CONTRATO)"]);
  const casal = dadosPJ({ comprador2: Object.assign({}, comprador2, { email: "FULANO@teste.example " }) });
  assert.deepEqual(CS.faltasAssinatura(casal, CS.montarConfig(PROPS)), ["Comprador 2: e-mail repetido (igual ao de Comprador 1)"]);
});

test("corpos JSON:API exatamente como a documentação v3", () => {
  assert.deepEqual(CS.corpoEnvelope("Contrato - RESIDENCIAL TESTE QD 07 LT 12"), { data: { type: "envelopes", attributes: {
    name: "Contrato - RESIDENCIAL TESTE QD 07 LT 12", locale: "pt-BR", auto_close: true, block_after_refusal: true,
    deadline_partial_signature_action: "canceled" } } });
  assert.deepEqual(CS.corpoDocumento("contrato.pdf", "QUJD"),
                   { data: { type: "documents", attributes: { filename: "contrato.pdf", content_base64: "data:application/pdf;base64,QUJD" } } });
  const s = CS.signatarios(dadosPJ(), CS.montarConfig(PROPS))[0];
  assert.deepEqual(CS.corpoSignatario(s), { data: { type: "signers", attributes: {
    name: "Fulano de Teste", email: "fulano@teste.example", has_documentation: true, documentation: "000.000.001-91", refusable: true } } });
  const rel = { document: { data: { type: "documents", id: "doc-1" } }, signer: { data: { type: "signers", id: "sig-1" } } };
  assert.deepEqual(CS.corpoQualificacao("doc-1", "sig-1", "buyer"),
                   { data: { type: "requirements", attributes: { action: "agree", role: "buyer" }, relationships: rel } });
  assert.deepEqual(CS.corpoAutenticacao("doc-1", "sig-1"),
                   { data: { type: "requirements", attributes: { action: "provide_evidence", auth: "email" }, relationships: rel } });
  assert.deepEqual(CS.corpoAtivar("env-1"), { data: { id: "env-1", type: "envelopes", attributes: { status: "running" } } });
  assert.deepEqual(CS.corpoNotificacao(), { data: { type: "notifications", attributes: {} } });
});

test("nome do envelope e do arquivo: só o endereço, sem barra; e-mail vai em minúsculas e sem espaço", () => {
  assert.equal(CS.nomeEnvelope("RESIDENCIAL/TESTE QD 07"), "Contrato - RESIDENCIAL-TESTE QD 07");
  assert.equal(CS.nomeEnvelope(""), "Contrato de compra e venda");
  assert.equal(CS.nomeArquivo("CONTRATO - X.pdf"), "CONTRATO - X.pdf");
  assert.equal(CS.nomeArquivo("contrato"), "contrato.pdf");
  const s = CS.signatarios(dadosPJ({ comprador1: { nome: "Fulano de Teste", cpf: "", email: " Fulano@Teste.EXAMPLE " } }), CS.montarConfig(PROPS))[0];
  assert.equal(s.email, "fulano@teste.example");
  assert.deepEqual(CS.corpoSignatario(s).data.attributes, { name: "Fulano de Teste", email: "fulano@teste.example", has_documentation: true, refusable: true });
});

test("interpretar: sucesso com id e status; erro JSON:API com status e detalhe curto", () => {
  assert.deepEqual(CS.interpretar(201, JSON.stringify({ data: { id: "env-1", type: "envelopes", attributes: { status: "draft" } } })),
                   { ok: true, id: "env-1", status: "draft", data: { id: "env-1", type: "envelopes", attributes: { status: "draft" } } });
  const e = CS.interpretar(422, JSON.stringify({ errors: [{ title: "Erro de validação", detail: "Nome deve ter sobrenome", code: "422", status: "422" }] }));
  assert.deepEqual(e, { ok: false, http: 422, detalhe: "Erro de validação: Nome deve ter sobrenome" });
  assert.deepEqual(CS.interpretar(500, "<html>"), { ok: false, http: 500, detalhe: "" });
  assert.ok(CS.interpretar(400, JSON.stringify({ errors: [{ detail: "x".repeat(500) }] })).detalhe.length <= 200);
});

test("interpretar: 2xx sem corpo (204) ou com corpo que não é JSON é sucesso, sem id", () => {
  assert.deepEqual(CS.interpretar(204, ""), { ok: true, id: "", status: "", data: null });
  assert.deepEqual(CS.interpretar(200, "não é json"), { ok: true, id: "", status: "", data: null });
  assert.deepEqual(CS.interpretar(202, "null"), { ok: true, id: "", status: "", data: null });
});

test("interpretar: e-mail no detalhe do erro vira ***@domínio (a tela nunca mostra e-mail)", () => {
  const e = CS.interpretar(422, JSON.stringify({ errors: [{ title: "Erro", detail: "Fulano.Teste@exemplo.example já é signatário; outro: a_b@x.example" }] }));
  assert.equal(e.detalhe, "Erro: ***@exemplo.example já é signatário; outro: ***@x.example");
  assert.equal(CS.mascararEmails("sem e-mail aqui"), "sem e-mail aqui");
});

const ev = (name, email) => ({ type: "events", attributes: { name, data: email ? { signer: { email } } : {} } });

test("situação: running → ENVIADO; closed → ASSINADO; canceled → CANCELADO, RECUSADO ou EXPIRADO pelos eventos", () => {
  assert.equal(CS.situacao("running", []), "ENVIADO");
  assert.equal(CS.situacao("running", [ev("refusal", "a@teste.example")]), "RECUSADO");
  assert.equal(CS.situacao("closed", []), "ASSINADO");
  assert.equal(CS.situacao("canceled", []), "CANCELADO");
  assert.equal(CS.situacao("canceled", [ev("refusal", "a@teste.example")]), "RECUSADO");
  assert.equal(CS.situacao("canceled", [ev("deadline")]), "EXPIRADO");
  assert.equal(CS.situacao("draft", []), "RASCUNHO");
  assert.throws(() => CS.situacao("outra_coisa", []), /CLICKSIGN_STATUS_DESCONHECIDO: outra_coisa/);
});

test("quem assinou: só pelos eventos sign (e-mail, sem caixa) — envelope fechado não marca ninguém sozinho", () => {
  const signers = [{ id: "s1", attributes: { email: "a@teste.example" } }, { id: "s2", attributes: { email: "b@teste.example" } }];
  assert.deepEqual(CS.assinaram(signers, [ev("sign", "A@teste.example"), ev("upload")]), { s1: true, s2: false });
  assert.deepEqual(CS.assinaram(signers, [], "closed"), { s1: false, s2: false });
  assert.deepEqual(CS.assinaram(signers, [ev("sign", "a@teste.example"), ev("sign", "b@teste.example")], "closed"), { s1: true, s2: true });
});

test("pode enviar: sem envelope, ou com envelope cancelado/recusado/expirado; envelope sem situação conta como aberto", () => {
  for (const s of ["", "ENVIADO", "qualquer"]) assert.equal(CS.podeEnviar("", s), true, "sem envelope " + s);
  for (const s of ["CANCELADO", "RECUSADO", "EXPIRADO", " cancelado "]) assert.equal(CS.podeEnviar("env-1", s), true, s);
  for (const s of ["", "ENVIADO", "ASSINADO", "RASCUNHO", "qualquer"]) assert.equal(CS.podeEnviar("env-1", s), false, s);
});

test("arquivo assinado: só links.files.signed; sem ele, erro visível com as chaves que vieram", () => {
  const doc = { id: "d1", links: { files: { original: "https://s3.falso/o", signed: "https://s3.falso/s" } } };
  assert.equal(CS.linkAssinado(doc), "https://s3.falso/s");
  assert.throws(() => CS.linkAssinado({ id: "d1", links: { files: { original: "https://s3.falso/o" } } }),
                /CLICKSIGN_SEM_LINK_ASSINADO: original/);
  assert.throws(() => CS.linkAssinado({ id: "d1" }), /CLICKSIGN_SEM_LINK_ASSINADO: \(nenhum\)/);
});
