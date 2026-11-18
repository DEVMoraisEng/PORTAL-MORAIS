/* TermosVenda (18/11/2026): situação combinada contrato + termos, colheita por tipo, travas do sinal, quem assina os
 * termos novos, prévia da troca e registro do que foi assinado. Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const T = req("../TermosVenda.js");
const CS = req("../ClicksignVenda.js");
const CF = req("../ConfissaoVenda.js");
const ehTermo = (n) => !!CF.colunaAssinadaDoNome(n);

const doc = (id, filename, status) => ({ id, attributes: { filename, status } });
const CONTRATO = (s) => doc("c", "RESIDENCIAL TESTE CASA 3 - Fulano de Teste.pdf", s);
const MEMORIAL = (s) => doc("m", "MEMORIAL DESCRITIVO - RESIDENCIAL TESTE CASA 3 - Fulano de Teste.pdf", s);
const PRE = (id, s) => doc(id, "CONFISSÃO PRÉ-CHAVES - RESIDENCIAL TESTE - CASA 3.pdf", s);
const POS = (id, s) => doc(id, "CONFISSÃO PÓS-CHAVES - RESIDENCIAL TESTE - CASA 3.pdf", s);
const ev = (name, email, created) => ({ attributes: { name, created, data: { signer: { email } } } });
const env = (status, docs, eventos = {}) => ({ status, docs, eventos });

test("situação combinada: um envelope só, como hoje", () => {
  const S = CS.SITUACOES;
  const c = (st, docs, evs) => T.situacaoCombinada(env(st, docs, evs), null, ehTermo);
  assert.deepEqual(c("running", [CONTRATO("running"), PRE("t1", "running")]), { situacao: S.ENVIADO, contratoAssinado: false, termos: "" });
  assert.deepEqual(c("closed", [CONTRATO("closed"), PRE("t1", "closed")]), { situacao: S.ASSINADO, contratoAssinado: false, termos: "" });
  assert.equal(c("running", [CONTRATO("running")], { c: [ev("refusal", "a@x.example")] }).situacao, S.RECUSADO);
  assert.equal(c("canceled", [CONTRATO("canceled")], { c: [ev("deadline", "a@x.example")] }).situacao, S.EXPIRADO);
  assert.equal(c("running", [CONTRATO("canceled"), PRE("t1", "canceled")]).situacao, S.CANCELADO);
  assert.equal(c("draft", [CONTRATO("draft")]).situacao, S.RASCUNHO);
  /* sem termos na venda (24x): contrato fechado basta */
  assert.equal(c("running", [CONTRATO("closed"), MEMORIAL("closed")]).situacao, S.ASSINADO);
  /* resposta sem status do documento: segue o do envelope */
  assert.equal(c("closed", [{ id: "c", attributes: { filename: "x.pdf" } }]).situacao, S.ASSINADO);
});

test("situação combinada: contrato fechado e termos em andamento no mesmo envelope = ENVIADO + contratoAssinado", () => {
  const r = T.situacaoCombinada(env("running", [CONTRATO("closed"), MEMORIAL("closed"), PRE("t1", "running"), POS("t2", "closed")]), null, ehTermo);
  assert.deepEqual(r, { situacao: "ENVIADO", contratoAssinado: true, termos: "" });
});

test("situação combinada: termo cancelado sem envelope de termos não conta como assinado", () => {
  const r = T.situacaoCombinada(env("running", [CONTRATO("closed"), PRE("t1", "canceled")]), null, ehTermo);
  assert.equal(r.situacao, "ENVIADO");
  assert.equal(r.contratoAssinado, true);
});

test("situação combinada: todas as combinações com envelope de termos", () => {
  const S = CS.SITUACOES;
  const velhos = [PRE("v1", "canceled"), POS("v2", "canceled")];
  const casos = [
    /* contrato em assinatura (os dois envelopes abertos) */
    [env("running", [CONTRATO("running"), MEMORIAL("closed")].concat(velhos)), env("running", [PRE("n1", "running"), POS("n2", "running")]), S.ENVIADO, false, S.ENVIADO],
    [env("running", [CONTRATO("running")].concat(velhos)), env("closed", [PRE("n1", "closed"), POS("n2", "closed")]), S.ENVIADO, false, S.ASSINADO],
    /* contrato fechado, termos faltando */
    [env("closed", [CONTRATO("closed"), MEMORIAL("closed")].concat(velhos)), env("running", [PRE("n1", "closed"), POS("n2", "running")]), S.ENVIADO, true, S.ENVIADO],
    /* tudo fechado */
    [env("closed", [CONTRATO("closed"), MEMORIAL("closed")].concat(velhos)), env("closed", [PRE("n1", "closed"), POS("n2", "closed")]), S.ASSINADO, false, S.ASSINADO],
    /* envelope de termos cancelado/recusado/expirado: a venda segue sem os termos (ENVIADO) e a coluna dos termos diz o porquê */
    [env("closed", [CONTRATO("closed")].concat(velhos)), env("running", [PRE("n1", "canceled"), POS("n2", "canceled")]), S.ENVIADO, true, S.CANCELADO],
    [env("closed", [CONTRATO("closed")].concat(velhos)), env("canceled", [PRE("n1", "canceled")], { n1: [ev("refusal", "f@x.example")] }), S.ENVIADO, true, S.RECUSADO],
    [env("closed", [CONTRATO("closed")].concat(velhos)), env("canceled", [PRE("n1", "canceled")], { n1: [ev("deadline", "f@x.example")] }), S.ENVIADO, true, S.EXPIRADO],
    /* envelope do contrato cancelado/recusado/expirado segue como hoje */
    [env("canceled", [CONTRATO("canceled")].concat(velhos)), env("running", [PRE("n1", "running")]), S.CANCELADO, false, S.ENVIADO],
    [env("canceled", [CONTRATO("canceled")], { c: [ev("deadline", "a@x.example")] }), env("running", [PRE("n1", "running")]), S.EXPIRADO, false, S.ENVIADO],
    [env("running", [CONTRATO("running")], { c: [ev("refusal", "a@x.example")] }), env("running", [PRE("n1", "running")]), S.RECUSADO, false, S.ENVIADO],
    /* recusa do fiador antigo num termo antigo (cancelado) não derruba o contrato quando há envelope de termos */
    [env("running", [CONTRATO("running"), PRE("v1", "canceled")], { v1: [ev("refusal", "fiador.velho@x.example")] }), env("running", [PRE("n1", "running")]), S.ENVIADO, false, S.ENVIADO],
    /* rascunho do envelope de termos ainda não conta como termos assinados */
    [env("closed", [CONTRATO("closed")].concat(velhos)), env("draft", [PRE("n1", "draft")]), S.ENVIADO, true, S.RASCUNHO],
  ];
  casos.forEach(([c, t, sit, ca, st], i) => {
    const r = T.situacaoCombinada(c, t, ehTermo);
    assert.deepEqual(r, { situacao: sit, contratoAssinado: ca, termos: st }, "caso " + i);
  });
});

test("colheita por tipo: contrato fora de docs[0], termo cancelado e em andamento não colhem", () => {
  const docs = [PRE("t1", "closed"), MEMORIAL("closed"), POS("t2", "canceled"), CONTRATO("closed"), PRE("t3", "running")];
  const l = T.paraColher(docs, ehTermo, "running");
  assert.deepEqual(l.map((x) => [x.doc.id, x.tipo]), [["t1", "termo"], ["c", "contrato"]]);
  /* envelope só de termos: nenhum vira "contrato" */
  const so = T.paraColher([PRE("n1", "closed"), POS("n2", "closed")], ehTermo, "closed");
  assert.deepEqual(so.map((x) => x.tipo), ["termo", "termo"]);
});

test("travas de data ao refazer os termos: todas as de data contra hoje/assinatura saem; o resto continua", () => {
  const datas = [
    "Fluxo de pagamento (alterado): Linha 1: sinal vence em 14/11/2026, antes de hoje — atualize a data de assinatura",
    "Fluxo de pagamento (alterado): Linha 2: sinal vence em 21/11/2026: o sinal é ato + 30 + 60 + 90 dias, sem pular prazo — esta parcela vence em 14/12/2026 — use Corrigir datas",
    "Fluxo de pagamento: sinal vence em 14/11/2026, antes de hoje — atualize a data de assinatura",
    "Fluxo de pagamento (alterado): Linha 3: pré-chaves vence em 10/11/2026, antes de hoje — atualize a data de assinatura",
    "Fluxo de pagamento (alterado): Linha 4: pós-chaves vence em 10/11/2026: tem de vencer depois da assinatura (14/11/2026) — use Corrigir datas",
    "Fluxo de pagamento: a data de assinatura (14/11/2026) já passou — atualize na Planilha Casas e o fluxo é refeito",
    "Fluxo de pagamento: balão vence em 10/11/2026 — tem de vencer depois de hoje (18/11/2026); atualize a data de assinatura ou o dia de pagamento na Planilha Casas e o fluxo é refeito",
  ];
  const outras = [
    "Fluxo de pagamento (alterado): Sobram R$ 1.000,00 para fechar com o valor da casa",
    "Fluxo de pagamento (alterado): Linha 2: pré-chaves vence em 10/12/2028: pré-chaves e balões terminam até 30/11/2028",
    "Fluxo de pagamento: pré-chaves vence em 10/12/2028 — pré-chaves e balões terminam até 30/11/2028 (refaça o fluxo na Planilha Casas)",
    "Fluxo de pagamento (alterado): Linha 1: quantidade de 1 a 120",
    "Fluxo de pagamento (alterado): Pós-chaves: só 0, 12 ou 24 parcelas no total (prazo de 24, 36 ou 48 meses) — hoje 5",
    "Fiador 2 (termo de confissão): CPF",
    "Fiador 2: e-mail",
    "Comprador: sinal vence em 14/11/2026, antes de hoje",
  ];
  const r = T.filtrarTravasData(datas.concat(outras));
  assert.deepEqual(r.ignoradas, datas);
  assert.deepEqual(r.faltas, outras);
  assert.equal(T.filtrarTravasSinal, T.filtrarTravasData, "nome antigo continua valendo");
});

test("fluxo de 2027 com as primeiras pré-chaves já vencidas: as datas não barram, a soma que não fecha barra", () => {
  const F = req("../FluxoLivre.js");
  const fluxo = { valor: 100000, entrega: "2028-11-30", assinatura: "2027-01-10", hoje: "2027-03-20", linhas: [
    { t: "sinal", v: 5000, n: 2, d: "2027-01-10", i: 1 }, { t: "pre", v: 1000, n: 20, d: "2027-02-10", i: 1 },
    { t: "balao", v: 5000, n: 1, d: "2027-02-20", i: 1 }, { t: "fin", v: 60000, n: 1, d: "", i: 1 },
    { t: "pos", v: 500, n: 12, d: "2028-12-10", i: 1 }] };
  const faltas = F.validar(fluxo).erros.map((e) => "Fluxo de pagamento (alterado): " + e);
  assert.ok(faltas.some((f) => /pré-chaves vence em 10\/02\/2027: tem de vencer depois de hoje/.test(f)), faltas.join(" | "));
  const r = T.filtrarTravasData(faltas);
  assert.ok(r.ignoradas.length >= 3, r.ignoradas.join(" | "));
  assert.deepEqual(r.faltas, ["Fluxo de pagamento (alterado): Sobram R$ 1.000,00 para fechar com o valor da casa"]);
  /* acertando a soma, o fluxo antigo passa inteiro */
  const ok = JSON.parse(JSON.stringify(fluxo));
  ok.linhas[3].v = 59000;
  assert.deepEqual(T.filtrarTravasData(F.validar(ok).erros.map((e) => "Fluxo de pagamento (alterado): " + e)).faltas, []);
});

test("quem assina os termos novos: sem corretor, com cônjuge de fiador", () => {
  const dados = {
    comprador1: { nome: "Comprador Um Teste", email: "c1@teste.example", cpf: "000.000.001-91" },
    vendedor: { tipo: "PJ", nome: "Construtora Teste", cpfCnpj: "00.000.000/0001-00" },
    corretor: { nome: "Corretor Teste", email: "corretor@teste.example", cpfCnpj: "000.000.003-53" },
    condominio: { fiadores: [
      { nome: "Fiador Novo Teste", email: "f1@teste.example", cpf: "000.000.004-34", conjuge: { nome: "Conjuge Fiador Teste", email: "cf1@teste.example", cpf: "000.000.009-49" } },
      { nome: "Fiador Dois Teste", email: "f2@teste.example", cpf: "000.000.005-15" }] },
  };
  const config = CS.montarConfig({
    ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify([{ nome: "Testemunha Um", email: "t1@teste.example", cpf: "000.000.006-04" }, { nome: "Testemunha Dois", email: "t2@teste.example", cpf: "000.000.007-87" }]),
    ASSINATURA_TESTEMUNHAS_PF: "", ASSINATURA_REPRESENTANTE: JSON.stringify({ nome: "Representante Teste", email: "rep@teste.example", cpf: "000.000.008-68" }),
    ASSINATURA_INCLUIR_CORRETOR: "1",
  });
  config.comFiadores = true;
  const todos = CS.signatarios(dados, config);
  assert.ok(todos.some((s) => s.origem === "corretor"), "o envio do contrato teria o corretor");
  const l = T.signatariosTermos(todos);
  assert.ok(!l.some((s) => s.origem === "corretor"));
  assert.deepEqual(l.map((s) => s.papel), ["Comprador 1", "Vendedor (representante)", "Testemunha 1", "Testemunha 2",
                                          "Fiador 1", "Cônjuge do fiador 1", "Fiador 2"]);
  /* cada um assina só os termos do envelope novo */
  const docs = [{ id: "n1", tipo: CS.DOC.TERMO, nome: "a" }, { id: "n2", tipo: CS.DOC.TERMO, nome: "b" }];
  l.forEach((s) => assert.deepEqual(CS.documentosDoSignatario(s, docs), ["n1", "n2"], s.papel));
  const p = T.pessoas(l);
  assert.ok(!JSON.stringify(p).includes("@") && !/\d{3}\.\d{3}/.test(JSON.stringify(p)));
  assert.equal(p[4].nome, "Fiador T.");
});

test("fiadores alterados: pelo CPF de quem assina hoje; sem a lista, todos", () => {
  const atuais = [{ nome: "Fiador Um Teste", cpf: "000.000.004-34" }, { nome: "Fiador Novo Teste", cpf: "000.000.005-15" }];
  assert.deepEqual(T.fiadoresAlterados(atuais, [{ papel: "Fiador 1", cpf: "00000000434" }, { papel: "Fiador 2", cpf: "000.000.009-49" }]), [2]);
  assert.deepEqual(T.fiadoresAlterados(atuais, [{ papel: "Fiador 1", cpf: "00000000434" }]), [2]);
  assert.deepEqual(T.fiadoresAlterados(atuais, null), [1, 2]);
  assert.deepEqual(T.fiadoresAlterados([{ nome: "Fiador Um Teste", cpf: "000.000.004-34" }, { nome: "" }], [{ papel: "Fiador 1", cpf: "000.000.004-34" }]), []);
  assert.deepEqual(T.fiadoresAlterados([{ nome: "Fulano Novo", cpf: "" }], [{ papel: "Fiador 1", nome: "Fulano Velho", cpf: "" }]), [1]);
});

test("prévia da troca: documento faltando, conferência divergente, desatualizada e tudo certo", () => {
  const linhasOk = [{ item: "f2-id", campo: "nome", rotulo: "Nome", situacao: "ok" }, { item: "f2-id", campo: "cpf", rotulo: "CPF", situacao: "ok" }];
  const base = { termos: ["PRE", "POS"], faltas: [], alterados: [2], docs: { 1: 1, 2: 1 }, carimbo: "abcd1234",
                 conferencia: { carimbo: "abcd1234", linhas: linhasOk, confirmados: {} }, anexosMudaram: false };
  assert.deepEqual(T.conferirTroca(base), { ok: true, problemas: [] });
  const com = (m) => T.conferirTroca(Object.assign({}, base, m));
  assert.equal(com({ docs: { 1: 1, 2: 0 } }).erro, "FIADOR_SEM_DOCUMENTO");
  assert.equal(com({ conferencia: null }).erro, "CONFERENCIA_FALTANDO");
  assert.equal(com({ conferencia: Object.assign({}, base.conferencia, { carimbo: "00000000" }) }).erro, "CONFERENCIA_DESATUALIZADA");
  assert.equal(com({ anexosMudaram: true }).erro, "CONFERENCIA_DESATUALIZADA");
  const div = [linhasOk[0], Object.assign({}, linhasOk[1], { situacao: "diverge" })];
  assert.equal(com({ conferencia: { carimbo: "abcd1234", linhas: div, confirmados: {} } }).erro, "CONFERENCIA_DIVERGENTE");
  /* divergência não se aceita com "Conferi"; ilegível conferido à mão vale */
  assert.equal(com({ conferencia: { carimbo: "abcd1234", linhas: div, confirmados: { 1: { por: "x" } } } }).erro, "CONFERENCIA_DIVERGENTE");
  const ileg = [linhasOk[0], Object.assign({}, linhasOk[1], { situacao: "ilegivel" })];
  assert.equal(com({ conferencia: { carimbo: "abcd1234", linhas: ileg, confirmados: {} } }).erro, "CONFERENCIA_PENDENTE");
  assert.equal(com({ conferencia: { carimbo: "abcd1234", linhas: ileg, confirmados: { 1: { por: "x" } } } }).ok, true);
  /* divergência no fiador que NÃO mudou não barra */
  const outro = linhasOk.concat([{ item: "f1-id", campo: "cpf", rotulo: "CPF", situacao: "diverge" }]);
  assert.equal(com({ conferencia: { carimbo: "abcd1234", linhas: outro, confirmados: {} } }).ok, true);
  assert.equal(com({ alterados: [] }).erro, "NADA_MUDOU");
  assert.equal(com({ termos: [] }).erro, "SEM_TERMOS");
  assert.equal(com({ faltas: ["Fiador 2 (termo de confissão): CPF"] }).erro, "FALTAM_DADOS");
  assert.ok(com({ docs: {} }).problemas[0].includes("DOC. FIADOR 2"));
});

test("registro ASS_HIST: quem assinou cada documento, sem e-mail nem CPF, e o bloco Já assinado", () => {
  const signers = [
    { id: "s1", attributes: { name: "Comprador Um Teste", email: "c1@teste.example", documentation: "000.000.001-91" } },
    { id: "s2", attributes: { name: "Fiador Antigo Teste", email: "f@teste.example", documentation: "000.000.004-34" } }];
  const papeis = { s1: "Comprador 1", s2: "Fiador 1" };
  const docs = [CONTRATO("closed"), PRE("t1", "canceled")];
  const eventos = { c: [ev("sign", "c1@teste.example", "2026-11-14T10:20:30.000-03:00"), ev("sign", "c1@teste.example", "2026-11-14T10:21:00.000-03:00")],
                    t1: [ev("sign", "c1@teste.example", "2026-11-14T10:22:00.000-03:00")] };
  let h = T.registrar(T.lerHist(""), "env-contrato", "contrato", docs, eventos, signers, papeis, ehTermo);
  const json = JSON.stringify(h);
  assert.ok(!json.includes("@"), "sem e-mail");
  assert.ok(!/\d{3}\.\d{3}\.\d{3}/.test(json), "sem CPF");
  assert.ok(!json.includes("Comprador Um Teste"), "nome só mascarado");
  assert.deepEqual(h.envelopes[0].docs[0].assinaram, [{ papel: "Comprador 1", nome: "Comprador T.", data: "2026-11-14T10:20" }]);
  /* papéis já apagados (envelope final): o que estava registrado não se perde */
  h = T.registrar(h, "env-contrato", "contrato", docs, eventos, signers, {}, ehTermo);
  assert.equal(h.envelopes[0].docs[0].assinaram[0].papel, "Comprador 1");
  h = T.registrar(h, "env-termos", "termos", [PRE("n1", "closed"), POS("n2", "running")], { n1: [ev("sign", "c1@teste.example", "2026-11-18T09:00:00Z")] }, signers, papeis, ehTermo);
  const ja = T.jaAssinado(h);
  assert.deepEqual(ja.map((x) => [x.envelope, x.docId, x.tipo]), [["env-contrato", "c", "contrato"], ["env-termos", "n1", "termo"]]);
  assert.equal(T.lerHist("{lixo").envelopes.length, 0);
  /* no máximo 4 envelopes */
  for (let i = 0; i < 6; i++) h = T.registrar(h, "e" + i, "termos", [], {}, [], {}, ehTermo);
  assert.equal(h.envelopes.length, T.HIST_MAX_ENV);
});
