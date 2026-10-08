/* Entrega 14 — tela da casa, Clicksign e recebimentos: regras do contrato (comissão sem vencimento, estado civil e
 * profissão opcionais, habite-se/denominação da casa, operação da conta digitada) e o bloco Recebimentos
 * (RecebimentoVenda.gs) com Notion, Drive, MailApp e Apps Script falsos.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CV, tokenDe, PAGE, sel, num, dat, rt, colunasVenda, MODELO_OBRA, cenario } from "./contrato-cenario.mjs";

const REC = createRequire(import.meta.url)("../RecebimentoVenda.gs");
const textoPre = (c) => { const ult = c.d.estado.copias.at(-1); return c.d.estado.salvos[ult.id].pars.join("\n"); };
const chamar = (c, payload, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok, pageId: PAGE }, payload));

/* ---------------- contrato ---------------- */
const MODELO_COMISSAO = MODELO_OBRA.concat([
  "Compradores do quadro: {{COMPRADORES}}",
  "Habite-se nº {{HABITESE_NUMERO}}, de {{HABITESE_DATA}}",
  "a) Valor: R$ {{COMISSAO_VALOR}}",
  "b) Forma de Pagamento: {{COMISSAO_FORMA}}",
  "c) Vencimento: {{COMISSAO_VENCIMENTO}}",
  "d) Corretor: {{CORRETOR_NOME}}, {{CORRETOR_CRECI}}",
  "e) Responsável pelo pagamento: {{COMISSAO_RESPONSAVEL}}",
  "Fim do contrato.",
]);
const comModelo = (x = {}) => Object.assign({ drive: { modelos: { "modelo-obra": MODELO_COMISSAO } } }, x);

test("comissão sem vencimento: não é falta; a linha 'c) Vencimento' sai e Corretor/Responsável sobem uma letra", () => {
  assert.equal("CONTRATO - COMISSÃO VENCIMENTO" in CV.TIPOS, false, "a coluna deixou de ser exigida");
  const c = cenario(comModelo());
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = textoPre(c);
  assert.ok(!/Vencimento/.test(t), t);
  assert.ok(t.includes("\nc) Corretor: Corretor Teste, CRECI 123\n"), t);
  assert.ok(t.includes("\nd) Responsável pelo pagamento: Fulano de Teste\n"), t);
  assert.ok(t.includes("\nb) Forma de Pagamento: PIX\n"), t);
});

test("comissão COM vencimento (coluna antiga preenchida): a linha fica e as letras não mudam", () => {
  const c = cenario(comModelo({ colunas: Object.assign(colunasVenda(), { "CONTRATO - COMISSÃO VENCIMENTO": "rich_text" }) }));
  assert.equal(c.acao("gerarPreContrato").ok, true);
  const t = textoPre(c);
  assert.ok(t.includes("c) Vencimento: na assinatura do financiamento"), t);
  assert.ok(t.includes("d) Corretor: Corretor Teste") && t.includes("e) Responsável pelo pagamento:"), t);
});

test("plano dos parágrafos vazios (puro): parágrafo com texto além do rótulo não sai; marcador preenchido não mexe", () => {
  const P = ["a) Valor", "c) Vencimento: {{COMISSAO_VENCIMENTO}}.", "d) Corretor: X", "e) Responsável pelo pagamento: Y"];
  assert.deepEqual(CV.planoParagrafosVazios(P, { COMISSAO_VENCIMENTO: "" }).apagar, [1]);
  assert.deepEqual(CV.planoParagrafosVazios(P, { COMISSAO_VENCIMENTO: "no ato" }), { apagar: [], trocar: [] });
  assert.deepEqual(CV.planoParagrafosVazios(["c) Vencimento: {{COMISSAO_VENCIMENTO}}, conforme acordo"], { COMISSAO_VENCIMENTO: "" }),
    { apagar: [], trocar: [] });
  assert.deepEqual(CV.planoParagrafosVazios(P, {}), { apagar: [], trocar: [] }, "sem a chave nos marcadores, nada muda");
});

test("estado civil e profissão vazios: não são falta e a qualificação sai sem ', ,'", () => {
  const c = cenario(comModelo({ venda: { "COMPRADOR 1 - ESTADO CIVIL": rt(""), "COMPRADOR 1 - PROFISSÃO": rt("") } }));
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  const linha = textoPre(c).split("\n").find((l) => l.startsWith("Compradores do quadro:"));
  assert.equal(linha, "Compradores do quadro: Fulano de Teste, brasileiro, RG nº 1234567 SSP/GO, CPF nº 000.000.001-91, " +
                      "residente e domiciliado à Rua das Palmeiras, 10, Setor Teste");
});

test("habite-se e denominação: a coluna da casa vale antes da obra e do setor; coluna ausente = como antes", () => {
  const antes = cenario(comModelo());
  assert.equal(antes.acao("gerarPreContrato").ok, true);
  const ta = textoPre(antes);
  assert.ok(ta.includes("de 01/08/2026") && ta.includes("Contrato de Residencial Teste em"), ta);

  const cols = Object.assign(colunasVenda(), { "CONTRATO - HABITE-SE DATA": "date", "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO": "rich_text" });
  const vazio = cenario(comModelo({ colunas: cols }));
  assert.equal(vazio.acao("gerarPreContrato").ok, true);
  assert.ok(textoPre(vazio).includes("de 01/08/2026"), "colunas vazias: vale a obra");

  const c = cenario(comModelo({ colunas: cols, venda: { "CONTRATO - HABITE-SE DATA": dat("2026-09-15"),
                                                        "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO": rt("Loteamento Inventado") } }));
  assert.equal(c.acao("gerarPreContrato").ok, true);
  const t = textoPre(c);
  assert.ok(t.includes("\nHabite-se nº , de 15/09/2026\n"), t);
  assert.ok(t.includes("Contrato de Loteamento Inventado em Cidade Teste/GO"), t);
});

test("conta digitada com operação: entra no contrato; sem operação o '– Operação:' some", () => {
  const c = cenario();
  let r = chamar(c, { action: "escolherContaRecebimento", conta: { banco: "104", agencia: "5555", operacao: "013", conta: "55555-5" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.conta.escolhida, { banco: "104", agencia: "5555", conta: "55555-5", pix: "", operacao: "013" });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.ok(textoPre(c).includes("Banco: 104 – Agência: 5555 – Operação: 013 – Conta 55555-5 - Titularidade"), textoPre(c));
  r = chamar(c, { action: "escolherContaRecebimento", conta: { banco: "104", agencia: "5555", operacao: "  ", conta: "55555-5" } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conta.escolhida, { banco: "104", agencia: "5555", conta: "55555-5", pix: "" });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.ok(textoPre(c).includes("Banco: 104 – Agência: 5555 – Conta 55555-5 - Titularidade"), textoPre(c));
});

/* ---------------- recebimentos (puro) ---------------- */
test("RecebimentoVenda puro: colunas, datas, destinatários, assunto e corpo sem CPF", () => {
  assert.deepEqual(REC.colunas("SINAL"), { data: "RECEBIMENTO - SINAL DATA", comprovante: "RECEBIMENTO - SINAL COMPROVANTE", por: "RECEBIMENTO - SINAL POR" });
  assert.equal(Object.keys(REC.colunasNecessarias()).length, 9);
  assert.equal(REC.item("entrada").esperado, "CONTRATO - ENTRADA VALOR");
  assert.equal(REC.item("FINANCIAMENTO").esperado, "VALOR FINANCIADO");
  assert.equal(REC.item("PARCELA"), null);
  assert.equal(REC.dataValida("2026-10-05", "2026-10-08"), true);
  assert.equal(REC.dataValida("2026-10-08", "2026-10-08"), true);
  assert.equal(REC.dataValida("2026-10-09", "2026-10-08"), false, "data no futuro");
  assert.equal(REC.dataValida("2026-02-30", "2026-10-08"), false);
  assert.equal(REC.dataValida("05/10/2026", "2026-10-08"), false);
  assert.equal(REC.dataValida("1999-12-31", "2026-10-08"), false);
  assert.deepEqual(REC.destinatarios(" A@exemplo.test, b@exemplo.test;a@exemplo.test  nao-email "), ["a@exemplo.test", "b@exemplo.test"]);
  assert.deepEqual(REC.destinatarios(""), []);
  assert.equal(REC.assunto("sinal", "OBRA TESTE CASA 3", "Fulano de Teste"), "Recebido: SINAL — OBRA TESTE CASA 3 — Fulano de Teste");
  assert.equal(REC.assunto("ENTRADA", "", ""), "Recebido: ENTRADA");
  const b = REC.corpo({ id: "SINAL", obra: "OBRA TESTE", comprador: "Fulano de Teste", esperado: 10000, data: "2026-10-05", por: "ana.teste",
                        link: "https://www.notion.so/abc" });
  assert.ok(b.includes("Valor esperado (contrato): R$ 10.000,00") && b.includes("Data do recebimento: 05/10/2026") &&
            b.includes("Confirmado por: ana.teste") && b.includes("Notion: https://www.notion.so/abc"), b);
  assert.ok(REC.corpo({ id: "ENTRADA", esperado: null }).includes("não informado"));
});

/* ---------------- recebimentos (servidor) ---------------- */
const COLS_REC = Object.fromEntries(Object.entries(REC.colunasNecessarias()));
const PDF = { nome: "comprovante.pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.4 comprovante de teste").toString("base64") };
function cenarioRec({ props = {}, venda = {}, colunas, mail = "ok" } = {}) {
  const enviados = [];
  const MailApp = { sendEmail: (o) => { if (mail === "falha") throw new Error("Service invoked too many times"); enviados.push(o); },
                    getRemainingDailyQuota: () => 99 };
  const c = cenario({ colunas: colunas || Object.assign(colunasVenda(), COLS_REC, { "VALOR FINANCIADO": "number", CASA: "rich_text" }),
                      venda: Object.assign({ "VALOR FINANCIADO": num(150000) }, venda), props });
  Object.assign(c.g.ctx, { MailApp });
  return Object.assign(c, { enviados });
}
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("recebimentoEstado: três itens com o valor esperado; nada confirmado", () => {
  const c = cenarioRec();
  const r = chamar(c, { action: "recebimentoEstado" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.itens.map((x) => [x.id, x.esperado, x.confirmado, x.comprovantes]),
    [["SINAL", 10000, false, 0], ["ENTRADA", 20000, false, 0], ["FINANCIAMENTO", 150000, false, 0]]);
  assert.equal(r.emailConfigurado, false);
  /* TESTES consulta */
  assert.equal(chamar(c, { action: "recebimentoEstado" }, tokenDe("TESTES")).ok, true);
});

test("recebimento: colunas faltando viram COLUNA_FALTANDO legível", () => {
  const c = cenarioRec({ colunas: colunasVenda() });
  const r = chamar(c, { action: "recebimentoEstado" });
  assert.equal(r.ok, false);
  assert.match(r.erro, /^COLUNA_FALTANDO: RECEBIMENTO - SINAL DATA, /);
});

test("confirmar: grava data, comprovante e login; e-mail com assunto padrão, sem CPF; TESTES não grava", () => {
  const c = cenarioRec({ props: { RECEBIMENTO_EMAILS: "financeiro@exemplo.test, diretoria@exemplo.test" } });
  assert.deepEqual(chamar(c, { action: "recebimentoConfirmar", item: "SINAL", data: hoje(), arquivo: PDF }, tokenDe("TESTES")),
    { ok: false, erro: "SEM_PERMISSAO_TESTES" });
  const r = chamar(c, { action: "recebimentoConfirmar", item: "SINAL", data: "2026-10-01", arquivo: PDF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.aviso, undefined);
  assert.equal(r.emails, 2);
  const pr = c.n.pagina.properties;
  assert.equal(pr["RECEBIMENTO - SINAL DATA"].date.start, "2026-10-01");
  assert.equal(pr["RECEBIMENTO - SINAL POR"].rich_text[0].plain_text, "ana.teste");
  assert.equal(pr["RECEBIMENTO - SINAL COMPROVANTE"].files.length, 1);
  assert.equal(c.enviados.length, 1);
  const m = c.enviados[0];
  assert.equal(m.to, "financeiro@exemplo.test,diretoria@exemplo.test");
  assert.equal(m.subject, "Recebido: SINAL — RESIDENCIAL TESTE QD 07 LT 12 CASA 3 — Fulano de Teste");
  assert.ok(m.body.includes("R$ 10.000,00") && m.body.includes("01/10/2026") && m.body.includes("https://www.notion.so/" + PAGE), m.body);
  assert.ok(!m.body.includes("000.000.001-91") && !m.subject.includes("000.000"), "e-mail com CPF");
  const s = r.itens.find((x) => x.id === "SINAL");
  assert.deepEqual([s.confirmado, s.data, s.por, s.comprovantes], [true, "2026-10-01", "ana.teste", 1]);
  const logs = c.g.logs.join("\n");
  for (const x of ["financeiro@", "Fulano", "2026-10-01", "10.000"]) assert.ok(!logs.includes(x), "log vazou: " + x);
});

test("confirmar: sem comprovante na 1ª vez é recusado; de novo, só a data, vale; data/itens inválidos", () => {
  const c = cenarioRec();
  assert.deepEqual(chamar(c, { action: "recebimentoConfirmar", item: "ENTRADA", data: "2026-10-01" }), { ok: false, erro: "COMPROVANTE_OBRIGATORIO" });
  assert.deepEqual(chamar(c, { action: "recebimentoConfirmar", item: "PARCELA", data: "2026-10-01", arquivo: PDF }), { ok: false, erro: "ITEM_INVALIDO" });
  assert.deepEqual(chamar(c, { action: "recebimentoConfirmar", item: "ENTRADA", data: "2999-01-01", arquivo: PDF }), { ok: false, erro: "DATA_INVALIDA" });
  assert.deepEqual(chamar(c, { action: "recebimentoConfirmar", item: "ENTRADA", data: "2026-10-01",
                               arquivo: { nome: "x.heic", mime: "image/heic", base64: "AAAA" } }), { ok: false, erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" });
  assert.equal(c.n.patches.length, 0, "nada gravado");
  let r = chamar(c, { action: "recebimentoConfirmar", item: "ENTRADA", data: "2026-10-01", arquivo: PDF });
  assert.equal(r.ok, true);
  assert.equal(r.aviso, "EMAIL_NAO_CONFIGURADO", "sem a Propriedade: grava e avisa");
  r = chamar(c, { action: "recebimentoConfirmar", item: "ENTRADA", data: "2026-10-02" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.n.pagina.properties["RECEBIMENTO - ENTRADA DATA"].date.start, "2026-10-02");
  assert.equal(c.n.pagina.properties["RECEBIMENTO - ENTRADA COMPROVANTE"].files.length, 1);
});

test("confirmar: e-mail que falha não desfaz o recebimento (aviso EMAIL_FALHOU)", () => {
  const c = cenarioRec({ props: { RECEBIMENTO_EMAILS: "financeiro@exemplo.test" }, mail: "falha" });
  const r = chamar(c, { action: "recebimentoConfirmar", item: "FINANCIAMENTO", data: "2026-10-01", arquivo: PDF });
  assert.equal(r.ok, true);
  assert.equal(r.aviso, "EMAIL_FALHOU");
  assert.equal(c.n.pagina.properties["RECEBIMENTO - FINANCIAMENTO DATA"].date.start, "2026-10-01");
});

test("autorizarEmailRecebimento: só cota e quantidade, sem enviar nada", () => {
  const c = cenarioRec({ props: { RECEBIMENTO_EMAILS: "a@exemplo.test" } });
  assert.deepEqual(JSON.parse(JSON.stringify(c.g.ctx.autorizarEmailRecebimento())), { cota: 99, destinatarios: 1 });
  assert.equal(c.enviados.length, 0);
  assert.ok(!c.g.logs.join("\n").includes("a@exemplo"));
});

/* ---------------- TIPO DE CASA escolhe o modelo (ajuste do dono, 08/10) ---------------- */
const comTipo = (tipo, finalizada, x = {}) => Object.assign({
  venda: Object.assign({ "TIPO DE CASA": sel(tipo), "CONTRATO - HABITE-SE Nº": rt("HB-1") }, x.venda || {}),
  obra: { "OBRA FINALIZADA?": sel(finalizada) } }, x.resto || {});
const modeloUsado = (c) => (textoPre(c).startsWith("MODELO PRONTO") ? "PRONTO" : "CONSTRUCAO");

test("TIPO DE CASA = CASA PRONTA: modelo PRONTO mesmo com a obra não finalizada — só avisa", () => {
  const c = cenario(comTipo("CASA PRONTA", "NÃO"));
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(modeloUsado(c), "PRONTO");
  assert.deepEqual(r.avisos, ["Tipo de casa: CASA PRONTA, mas a obra está marcada como não finalizada na DOCUMENTOS (OBRA FINALIZADA?)"]);
});

test("TIPO DE CASA = CASA EM CONSTRUÇÃO: modelo CONSTRUÇÃO mesmo com a obra finalizada — só avisa", () => {
  const c = cenario(comTipo("CASA EM CONSTRUÇÃO", "SIM"));
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(modeloUsado(c), "CONSTRUCAO");
  assert.deepEqual(r.avisos, ["Tipo de casa: CASA EM CONSTRUÇÃO, mas a obra está marcada como finalizada na DOCUMENTOS (OBRA FINALIZADA?)"]);
  /* tipo e obra de acordo: sem aviso */
  const ok = cenario(comTipo("CASA EM CONSTRUÇÃO", "NÃO")).acao("gerarPreContrato");
  assert.equal(ok.ok, true); assert.equal(ok.avisos, undefined);
});

test("TIPO DE CASA vazio ou CASA DE RUA (casas antigas): vale o OBRA FINALIZADA? da obra, sem aviso", () => {
  for (const [tipo, fin, esperado] of [["CASA DE RUA", "SIM", "PRONTO"], ["CASA DE RUA", "NÃO", "CONSTRUCAO"], [null, "SIM", "PRONTO"], [null, "NÃO", "CONSTRUCAO"]]) {
    const c = cenario(comTipo(tipo, fin));
    const r = c.acao("gerarPreContrato");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(modeloUsado(c), esperado, tipo + "/" + fin);
    assert.equal(r.avisos, undefined);
  }
  assert.equal(CV.escolherModelo("SIM", true, "CASA EM CONSTRUÇÃO"), "CONDOMINIO", "condomínio continua com o modelo próprio");
});

test("TIPO DE CASA entra no carimbo: mudar o tipo deixa o pré-contrato desatualizado; CASA DE RUA = vazio", () => {
  const carimbo = (tipo) => { const r = cenario(comTipo(tipo, "NÃO")).acao("gerarPreContrato"); assert.equal(r.ok, true); return /\[#([0-9a-f]{8})\]/.exec(r.nome)[1]; };
  assert.equal(carimbo("CASA DE RUA"), carimbo(null), "casa antiga: carimbo de antes");
  assert.notEqual(carimbo("CASA EM CONSTRUÇÃO"), carimbo(null), "mesmo modelo, mas a escolha conta");
  const c = cenario(comTipo(null, "NÃO"));
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(c.acao("contratoEstado").pre.desatualizado, false);
  c.n.pagina.properties["TIPO DE CASA"] = { type: "select", select: { name: "CASA EM CONSTRUÇÃO" } };
  assert.equal(c.acao("contratoEstado").pre.desatualizado, true);
});
