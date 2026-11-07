/* Recebimentos v2 (05/11/2026, pedido do dono): vários pagamentos por item, valor esperado editável, FGTS e "outros",
 * contrato de financiamento lido pela IA e o pedido ao robô do Mais Controle (fila do servidor).
 * Notion, Apps Script, MailApp e OpenAI falsos. Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tokenDe, PAGE, num, rt, colunasVenda, cenario } from "./contrato-cenario.mjs";

const REC = createRequire(import.meta.url)("../RecebimentoVenda.gs");
const R = createRequire(import.meta.url)("../RegrasVenda.js");
const PDF = { nome: "comprovante.pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.4 comprovante de teste").toString("base64") };
const FILA = "db-fila";
const COLS_FILA = { PEDIDO: "title", TIPO: "select", PAYLOAD: "rich_text", "SITUAÇÃO": "select", "PEDIDO EM": "date" };

function cen({ venda = {}, props = {}, semNovas = false, ia } = {}) {
  const enviados = [];
  const MailApp = { sendEmail: (o) => enviados.push(o), getRemainingDailyQuota: () => 99 };
  const colunas = Object.assign(colunasVenda(), REC.colunasNecessarias(), semNovas ? {} : REC.colunasNovas(),
                                { "MC - VENDA ID": "rich_text", CASA: "rich_text" });
  const c = cenario({ colunas, venda: Object.assign({ "VALOR FINANCIADO": num(150000) }, venda), props: Object.assign({ DB_FILA_ROBO: FILA }, props),
                      bases: { [FILA]: [] }, esquemas: { [FILA]: COLS_FILA },
                      rotaExtra: (url, opt) => (ia && url.startsWith("https://api.openai.com/") ? ia(url, opt) : null) });
  Object.assign(c.g.ctx, { MailApp });
  const chamar = (payload, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok, pageId: PAGE }, payload));
  const lista = (item) => JSON.parse((c.n.pagina.properties["RECEBIMENTO - " + item + " PAGAMENTOS"].rich_text || []).map((t) => t.plain_text).join("") || "[]");
  const txt = (col) => (c.n.pagina.properties[col].rich_text || []).map((t) => t.plain_text).join("");
  return Object.assign(c, { enviados, chamar, lista, txt, fila: () => c.n.bases[FILA] });
}
const openai = (leitura) => () => ({ json: { status: "completed", usage: { input_tokens: 10, output_tokens: 5 },
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(leitura) }] }] } });

test("puro: valor aceita 3.000,50 e número; resumo diz falta e sobra; lista estragada é ignorada", () => {
  assert.equal(REC.valor("3.000,50"), 3000.5);
  assert.equal(REC.valor(2000), 2000);
  assert.equal(REC.valor("0"), null);
  assert.equal(REC.valor("0", true), 0);
  assert.equal(REC.valor("abc"), null);
  assert.deepEqual(REC.resumo(5000, [{ valor: 3000 }]), { soma: 3000, falta: 2000, situacao: "PARCIAL" });
  assert.deepEqual(REC.resumo(5000, [{ valor: 3000 }, { valor: 2000 }]), { soma: 5000, falta: 0, situacao: "RECEBIDO" });
  assert.equal(REC.resumo(5000, [{ valor: 6000 }]).situacao, "SOBRA");
  assert.equal(REC.resumo(5000, []).situacao, "AGUARDANDO");
  assert.deepEqual(REC.lerLista('[{"id":"a1b2c3d4","data":"2026-11-02","valor":3000},{"id":"x","data":"2026-11-02","valor":1}]').map((p) => p.id), ["a1b2c3d4"]);
  assert.deepEqual(REC.lerLista("não é json"), []);
  assert.equal(REC.nomeArquivo("Sinal", "a1b2c3d4", "meu/comp.PDF"), "Sinal a1b2c3d4 - meu_comp.PDF");
  assert.equal(REC.outroId("OUTRO:a1b2c3d4"), "a1b2c3d4");
  assert.equal(REC.outroId("OUTRO:<x>"), "");
  assert.equal(REC.textoLongo("x".repeat(4000)).length, 3);
});

test("sinal 3 mil + 2 mil: dois pagamentos com comprovante próprio, DATA = 1º, soma bate e o robô vai para a fila", () => {
  const c = cen({ venda: { "MC - VENDA ID": rt("11111111-2222-3333-4444-555555555555"), "CONTRATO - SINAL VALOR": num(5000) },
                  props: { RECEBIMENTO_EMAILS: "financeiro@exemplo.test" } });
  let r = c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-02", valor: "3.000,00", arquivo: PDF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mcPedido, "NA_FILA_SEM_SINAL");
  let s = r.itens.find((x) => x.id === "SINAL");
  assert.deepEqual([s.modo, s.soma, s.falta, s.situacao], ["lista", 3000, 2000, "PARCIAL"]);
  const l1 = c.lista("SINAL");
  assert.equal(l1.length, 1);
  assert.equal(c.n.pagina.properties["RECEBIMENTO - SINAL COMPROVANTE"].files[0].name, "Sinal " + l1[0].id + " - comprovante.pdf");
  assert.equal(l1[0].arquivo, "Sinal " + l1[0].id + " - comprovante.pdf");
  assert.match(c.enviados[0].body, /Valor deste pagamento: R\$ 3\.000,00/);
  assert.match(c.enviados[0].body, /Total recebido até agora: R\$ 3\.000,00/);
  /* pedido na fila: só pageId e aplicar; MC - RECEBIMENTOS em PROCESSANDO */
  const f = c.fila();
  assert.equal(f.length, 1);
  assert.equal(f[0].TIPO.select.name, "mc-recebimento");
  assert.deepEqual(JSON.parse(f[0].PAYLOAD.rich_text[0].text.content), { pageId: PAGE, aplicar: true });
  assert.equal(JSON.parse(c.txt("MC - RECEBIMENTOS")).situacao, "PROCESSANDO");

  r = c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-04" });   /* sem valor: o que falta */
  assert.equal(r.ok, true, JSON.stringify(r));
  s = r.itens.find((x) => x.id === "SINAL");
  assert.deepEqual([s.soma, s.falta, s.situacao, s.confirmado, s.pagamentos.length], [5000, 0, "RECEBIDO", true, 2]);
  assert.deepEqual(c.lista("SINAL").map((p) => [p.data, p.valor]), [["2026-11-02", 3000], ["2026-11-04", 2000]]);
  assert.equal(c.n.pagina.properties["RECEBIMENTO - SINAL DATA"].date.start, "2026-11-02", "DATA antiga = 1º pagamento");
  assert.equal(c.fila().length, 2);
  r = c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-04" });
  assert.deepEqual(r, { ok: false, erro: "VALOR_INVALIDO" }, "nada falta: tem de dizer o valor");
  const logs = c.g.logs.join("\n");
  for (const x of ["3000", "3.000", "2026-11-02", "financeiro@"]) assert.ok(!logs.includes(x), "log vazou: " + x);
});

test("financiamento não vai para a fila; sem MC - VENDA ID, o pedido não sai", () => {
  const c = cen({ venda: { "MC - VENDA ID": rt("11111111-2222-3333-4444-555555555555") } });
  const r = c.chamar({ action: "recebimentoConfirmar", item: "FINANCIAMENTO", data: "2026-11-02", valor: 150000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mcPedido, undefined);
  assert.equal(c.fila().length, 0);
  const s = cen();
  assert.equal(s.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-02", valor: 10 }).mcPedido, "SEM_VENDA");
  assert.equal(s.fila().length, 0);
});

test("corrigir e tirar pagamento; baixado no Mais Controle não muda nem sai", () => {
  const c = cen({ venda: { "CONTRATO - SINAL VALOR": num(5000) } });
  c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-02", valor: 3000 });
  c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-03", valor: 1000 });
  const [a, b] = c.lista("SINAL").map((p) => p.id);
  let r = c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-03", valor: 2000, pagamento: b });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(c.lista("SINAL").map((p) => p.valor), [3000, 2000]);
  /* o robô disse que o 1º está baixado no MC */
  c.n.pagina.properties["MC - RECEBIMENTOS"] = { type: "rich_text", rich_text: [{ plain_text: JSON.stringify({ v: 1, situacao: "OK",
    itens: { SINAL: { situacao: "BAIXADO", pagamentos: { [a]: { situacao: "BAIXADO", recibos: ["r1"] } } } } }) }] };
  assert.deepEqual(c.chamar({ action: "recebimentoRemover", item: "SINAL", pagamento: a }), { ok: false, erro: "JA_BAIXADO_NO_MC" });
  assert.deepEqual(c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-02", valor: 1, pagamento: a }), { ok: false, erro: "JA_BAIXADO_NO_MC" });
  r = c.chamar({ action: "recebimentoRemover", item: "SINAL", pagamento: b });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(c.lista("SINAL").map((p) => p.id), [a]);
  assert.equal(r.itens[0].pagamentos[0].mc.situacao, "BAIXADO", "a tela recebe a situação do MC por pagamento");
  assert.deepEqual(c.chamar({ action: "recebimentoRemover", item: "SINAL", pagamento: "zzzz9999" }), { ok: false, erro: "PAGAMENTO_NAO_ENCONTRADO" });
});

test("valor esperado editado na aba grava a coluna de origem; sinal/FGTS chamam o robô, entrada não", () => {
  const c = cen({ venda: { "MC - VENDA ID": rt("11111111-2222-3333-4444-555555555555") } });
  let r = c.chamar({ action: "recebimentoValor", item: "SINAL", valor: "6.000,00" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.n.pagina.properties["CONTRATO - SINAL VALOR"].number, 6000);
  assert.ok(/^NA_FILA/.test(r.mcPedido));
  r = c.chamar({ action: "recebimentoValor", item: "FGTS", valor: 20000 });
  assert.equal(c.n.pagina.properties["VALOR DO FGTS"].number, 20000);
  assert.equal(r.itens.find((x) => x.id === "FGTS").esperado, 20000);
  r = c.chamar({ action: "recebimentoValor", item: "ENTRADA", valor: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.mcPedido, undefined);
  assert.equal(c.n.pagina.properties["CONTRATO - ENTRADA VALOR"].number, 0);
  assert.equal(c.fila().length, 2);
  assert.deepEqual(c.chamar({ action: "recebimentoValor", item: "SINAL", valor: "x" }), { ok: false, erro: "VALOR_INVALIDO" });
});

test("outro recebimento com rótulo: cria, recebe pagamento e corrige; rótulo vazio recusa", () => {
  const c = cen();
  assert.deepEqual(c.chamar({ action: "recebimentoValor", item: "OUTRO", rotulo: " ", valor: 100 }), { ok: false, erro: "ROTULO_INVALIDO" });
  let r = c.chamar({ action: "recebimentoValor", item: "OUTRO", rotulo: "Parcela do cartório", valor: "1.200,00" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.outros.length, 1);
  const id = r.outros[0].id;
  assert.match(id, /^OUTRO:[0-9a-f]{8}$/);
  r = c.chamar({ action: "recebimentoConfirmar", item: id, data: "2026-11-02", valor: 700, arquivo: PDF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.outros[0].soma, r.outros[0].falta, r.outros[0].situacao], [700, 500, "PARCIAL"]);
  assert.match(c.n.pagina.properties["RECEBIMENTO - OUTROS COMPROVANTE"].files[0].name, /^Parcela do cartório [0-9a-f]{8} - comprovante\.pdf$/);
  r = c.chamar({ action: "recebimentoValor", item: id, rotulo: "Cartório", valor: 700 });
  assert.deepEqual([r.outros[0].rotulo, r.outros[0].situacao], ["Cartório", "RECEBIDO"]);
  assert.equal(c.fila().length, 0, "outros não vão para o Mais Controle");
});

test("confirmação antiga (entrega 14) vira o pagamento 'antigo' quando a lista começa", () => {
  const c = cen({ venda: { "CONTRATO - SINAL VALOR": num(5000), "RECEBIMENTO - SINAL DATA": { date: { start: "2026-10-01" } } } });
  let r = c.chamar({ action: "recebimentoEstado" });
  const s = r.itens[0];
  assert.deepEqual([s.situacao, s.pagamentos[0].id, s.pagamentos[0].valor], ["RECEBIDO", "antigo", 5000]);
  /* o pagamento antigo vale o esperado de quando a lista começa (a entrega 14 não guardava valor) */
  r = c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-11-02", valor: 1000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(c.lista("SINAL").map((p) => [p.id === "antigo" ? "antigo" : "novo", p.valor]), [["antigo", 5000], ["novo", 1000]]);
  assert.equal(r.itens[0].situacao, "SOBRA");
});

test("sem as colunas novas: o jeito da entrega 14 continua (uma confirmação por item)", () => {
  const c = cen({ semNovas: true });
  const r = c.chamar({ action: "recebimentoConfirmar", item: "SINAL", data: "2026-10-01", valor: 10 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.n.pagina.properties["RECEBIMENTO - SINAL DATA"].date.start, "2026-10-01");
  assert.equal(r.itens[0].modo, "antigo");
  assert.match(r.itens[3].erro, /FGTS PAGAMENTOS/);
});

test("contrato de financiamento: guarda, lê pela IA, troca financiado e FGTS, mantém o subsídio e chama o robô", () => {
  const leitura = { tipo_documento: "CONTRATO_FINANCIAMENTO", valor_financiado: "140.000,00", valor_fgts: "18.500,00", valor_subsidio: "",
                    data_assinatura: "03/11/2026", banco: "Banco Teste", agencia: "0001", numero_contrato: "CT-123" };
  const c = cen({ venda: { "MC - VENDA ID": rt("11111111-2222-3333-4444-555555555555"), "VALOR DO SUBSÍDIO": num(5000) },
                  props: { OPENAI_API_KEY: "sk-falsa" }, ia: openai(leitura) });
  const r = c.chamar({ action: "recebimentoLerContratoFin", arquivo: PDF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.preenchidos.sort(), ["VALOR DO FGTS", "VALOR FINANCIADO"]);
  assert.equal(c.n.pagina.properties["VALOR FINANCIADO"].number, 140000);
  assert.equal(c.n.pagina.properties["VALOR DO FGTS"].number, 18500);
  assert.equal(c.n.pagina.properties["VALOR DO SUBSÍDIO"].number, 5000);
  assert.ok(r.observacoes.some((o) => /subsídio/.test(o) && /mantido/.test(o)), JSON.stringify(r.observacoes));
  assert.deepEqual(r.contratoFin, { data_assinatura: "2026-11-03", banco: "Banco Teste", agencia: "0001", numero_contrato: "CT-123" });
  assert.equal(c.n.pagina.properties["CONTRATO DE FINANCIAMENTO"].files.length, 1);
  assert.ok(/^NA_FILA/.test(r.mcPedido));
  assert.equal(c.fila().length, 1);
  /* outro documento: nada muda */
  const d = cen({ props: { OPENAI_API_KEY: "sk-falsa" }, ia: openai(Object.assign({}, leitura, { tipo_documento: "OUTRO" })) });
  const r2 = d.chamar({ action: "recebimentoLerContratoFin", arquivo: PDF });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.preenchidos, []);
  assert.equal(d.n.pagina.properties["VALOR FINANCIADO"].number, 150000);
  assert.match(r2.observacoes[0], /não parece ser o contrato de financiamento/);
});

test("planejarGravacao FIN_CONTRATO (puro): leitura vazia não apaga; financiado ilegível não troca", () => {
  const atuais = { "VALOR FINANCIADO": 150000, "VALOR DO FGTS": 20000, "VALOR DO SUBSÍDIO": null };
  const p = R.planejarGravacao("FIN_CONTRATO", { tipo_documento: "CONTRATO_FINANCIAMENTO", valor_financiado: "", valor_fgts: "", valor_subsidio: "3.000,00" }, atuais, "2026-11-05");
  assert.deepEqual(p.props, { "VALOR DO SUBSÍDIO": 3000 });
  assert.ok(p.observacoes.some((o) => /não consegui ler o valor do financiamento/.test(o)));
  assert.ok(p.observacoes.some((o) => /FGTS mantido \(R\$ 20\.000,00\)/.test(o)));
  assert.equal(R.espaco("FIN_CONTRATO").coluna, "CONTRATO DE FINANCIAMENTO");
  assert.equal(R.ordenarEspacos(["FIN_CONTRATO"]).length, 0, "fora da leitura em lote do dossiê");
});

test("Conferir no Mais Controle e perfil TESTES", () => {
  const c = cen({ venda: { "MC - VENDA ID": rt("11111111-2222-3333-4444-555555555555") } });
  for (const action of ["recebimentoRemover", "recebimentoValor", "recebimentoLerContratoFin", "recebimentoMC"])
    assert.deepEqual(c.chamar({ action, item: "SINAL", valor: 1 }, tokenDe("TESTES")), { ok: false, erro: "SEM_PERMISSAO_TESTES" }, action);
  const r = c.chamar({ action: "recebimentoMC" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.fila().length, 1);
  assert.deepEqual(cen().chamar({ action: "recebimentoMC" }), { ok: false, erro: "MC_SEM_VENDA" });
  assert.deepEqual(cen({ props: { DB_FILA_ROBO: "" }, venda: { "MC - VENDA ID": rt("x") } }).chamar({ action: "recebimentoMC" }),
    { ok: false, erro: "FILA_NAO_CONFIGURADA" });
});
