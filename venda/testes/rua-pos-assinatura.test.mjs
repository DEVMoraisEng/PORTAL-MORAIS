/* 05/11/2026 (dono, CASA DE RUA): contrato assinado por todos → Orçamento da obra e venda lançada sem clique.
 * assinaturaEstado_ → assPosAssinatura_ → mcAutoIniciar_ (prévia pela fila) → vigia (mcAutoPendentes_) → lançamento.
 * Notion, Clicksign, fila e e-mail falsos; só dados inventados (o repositório é público). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarGas, notionFalso, clicksignFalso, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const PAGE = PAGE_ID_PADRAO, FILA = "f".repeat(32);
const VIGIA_SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "AssinaturaVigia.gs"), "utf8");
const ESQ_FILA = { [FILA]: { PEDIDO: "title", TIPO: "select", PAYLOAD: "rich_text", "SITUAÇÃO": "select", "PEDIDO EM": "date" } };
const tit = (s) => ({ title: [{ type: "text", plain_text: s, text: { content: s } }] });
const num = (n) => ({ number: n });
const COLS = Object.assign({}, COLUNAS_REAIS, {
  CASA: "number", "MC - SITUAÇÃO": "rich_text", "MC - VENDA ID": "rich_text",
  "ASSINATURA - ENVELOPE ID": "rich_text", "ASSINATURA - SITUAÇÃO": "rich_text", "CONTRATO ASSINADO": "files", "CONTRATO GERADO": "files",
});
const GERADO = { files: [{ name: "CONTRATO - RUA DAS TESTES QD 01 LT 02 - 01-11-2026 [#0a1b2c3d].pdf", type: "file", file: { url: "https://s3.falso/gerado" } }] };
const CASA = { "ENDEREÇO": tit("RUA DAS TESTES QD 01 LT 02"), CASA: num(3), "CLIENTES ": texto("Fulana de Teste"),
               "ASSINATURA - ENVELOPE ID": texto("env-1"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO"), "CONTRATO GERADO": GERADO };

/* hora de São Paulo fixa (12h) — a vigia só roda das 7h às 21h */
const FIX = Date.UTC(2026, 10, 5, 15, 0, 0);
class Fixo extends Date { constructor(...a) { if (a.length) super(...a); else super(FIX + Fixo.mais); } static now() { return FIX + Fixo.mais; } }
Fixo.mais = 0;

function cenario({ props = {}, valores = {}, colunas = COLS } = {}) {
  Fixo.mais = 0;
  const n = notionFalso({ colunas, valores: Object.assign({}, CASA, valores), bases: { [FILA]: [] }, esquemas: ESQ_FILA });
  const c = clicksignFalso({ status: "closed", arquivos: { signed: "https://s3.clicksign.falso/assinado.pdf" } });
  const p = Object.assign({ NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO,
                            CLICKSIGN_TOKEN: "token-clicksign-de-teste", DB_FILA_ROBO: FILA, MC_LANCAR_AO_ASSINAR: "SIM",
                            ASSINATURA_AVISO_EMAILS: "equipe@teste.example" }, props);
  const mails = [];
  const g = criarGas({ props: p, rotas: (url, opt) => c.rota(url, opt) || n.rota(url, opt),
                       extras: { Date: Fixo, MailApp: { getRemainingDailyQuota: () => 10, sendEmail: (m) => mails.push(m) } } });
  vm.runInContext(VIGIA_SRC, g.ctx, { filename: "AssinaturaVigia.gs" });
  /* a consulta à base é do Notion de verdade; aqui a vigia recebe a casa direto */
  g.ctx.__rua = [];
  vm.runInContext("vigiaAbertos_ = function () { return []; }; vigiaAbertosRua_ = function () { return __rua; };", g.ctx);
  const fila = () => n.escritas.filter((e) => e.metodo === "POST" && e.base === FILA)
    .map((e) => Object.assign({ tipo: e.props.TIPO.select.name }, JSON.parse(e.props.PAYLOAD.rich_text[0].text.content)));
  const sit = () => (n.pagina.properties["MC - SITUAÇÃO"].rich_text || []).map((t) => t.plain_text).join("");
  const robo = (s, vendaId) => {   /* o que o robô do servidor escreveria na casa */
    n.pagina.properties["MC - SITUAÇÃO"] = Object.assign({ type: "rich_text" }, texto(s));
    if (vendaId) n.pagina.properties["MC - VENDA ID"] = Object.assign({ type: "rich_text" }, texto(vendaId));
  };
  const estado = () => g.ctx.assinaturaEstado_(g.ctx.colunas_(), { pageId: PAGE });
  const vigia = () => { g.ctx.__rua = n.pagina.properties["ASSINATURA - SITUAÇÃO"].rich_text.map((t) => t.plain_text).join("") === "ENVIADO"
    ? [{ id: PAGE, properties: n.pagina.properties }] : []; g.ctx.vigiaAssinaturas(); };
  return { g, n, c, p, mails, fila, sit, robo, estado, vigia };
}
const PREVIA = "PRÉVIA OK [#0a1b2c3d] | CASA 03\nCliente: FULANA DE TESTE (novo, será criado)\nTotal: R$ 1,00";

test("casa de rua assinada: PDF entra, prévia pedida sozinha e o contrato vai ao Orçamento (sem venda ainda)", () => {
  const c = cenario();
  const r = c.estado();
  assert.equal(r.situacao, "ASSINADO", JSON.stringify(r));
  assert.equal(c.n.pagina.properties["CONTRATO ASSINADO"].files.length, 1);
  assert.deepEqual(c.fila(), [{ tipo: "mc-venda", pageId: PAGE, aplicar: false }, { tipo: "mc-anexos", pageId: PAGE, aplicar: true }]);
  assert.match(c.sit(), /^PROCESSANDO \(prévia\)/);
  assert.match(c.sit(), /\nContrato no Orçamento: pedido ao robô em /);
  assert.doesNotMatch(c.sit(), /\nContrato: /, "sem venda não há recebimento");
  assert.deepEqual(JSON.parse(c.p["MC_AUTO_" + PAGE]).fase, "previa");
  /* Atualizar de novo: nada novo (o PDF já está lá) */
  c.estado();
  assert.equal(c.fila().length, 2);
});

test("vigia: prévia OK vira pedido de lançamento; venda lançada encerra e pede os anexos de novo", () => {
  const c = cenario();
  c.estado();
  c.vigia();   /* robô ainda não respondeu: PROCESSANDO = espera */
  assert.equal(c.fila().length, 2);
  c.robo(PREVIA);
  c.vigia();
  assert.deepEqual(c.fila()[2], { tipo: "mc-venda", pageId: PAGE, aplicar: true });
  assert.match(c.sit(), /^PROCESSANDO \(lançamento\) — .* \[#0a1b2c3d\]( — o servidor ainda não deu sinal.*)?$/, "leva o carimbo da prévia vista");
  assert.equal(JSON.parse(c.p["MC_AUTO_" + PAGE]).fase, "lancar");
  c.vigia();   /* lançamento na fila: espera */
  assert.equal(c.fila().length, 3);
  c.robo("CRIADA | venda venda-erp-1\nContrato: anexado no recebimento", "venda-erp-1");
  c.vigia();
  assert.equal(c.p["MC_AUTO_" + PAGE], undefined, "terminou");
  assert.deepEqual(c.fila()[3], { tipo: "mc-anexos", pageId: PAGE, aplicar: true });
  assert.match(c.sit(), /\nContrato: pedido ao robô em .*\nContrato no Orçamento: pedido ao robô em /);
  c.vigia();
  assert.equal(c.fila().length, 4, "nada mais depois de lançada");
  assert.equal(c.mails.length, 0);
});

test("idempotente: venda já lançada (MC - VENDA ID) não pede prévia nem lançamento; só o contrato vai ao recebimento/Orçamento", () => {
  const c = cenario({ valores: { "MC - VENDA ID": texto("venda-antiga"), "MC - SITUAÇÃO": texto("CRIADA | venda venda-antiga") } });
  assert.equal(c.estado().situacao, "ASSINADO");
  assert.deepEqual(c.fila(), [{ tipo: "mc-anexos", pageId: PAGE, aplicar: true }]);
  assert.equal(c.p["MC_AUTO_" + PAGE], undefined);
  assert.match(c.sit(), /^CRIADA \| venda venda-antiga\nContrato: pedido ao robô em .*\nContrato no Orçamento: pedido ao robô em /);
});

test("prévia com erro: para, avisa na situação e por UM e-mail, e não pede de novo (sem laço)", () => {
  const c = cenario();
  c.estado();
  c.robo("RECUSADA: Obra 'RUA DAS TESTES QD 01 LT 02' não encontrada no Mais Controle");
  c.vigia();
  assert.equal(c.p["MC_AUTO_" + PAGE], undefined);
  assert.match(c.sit(), /\nLançamento automático: parou em .* — o robô respondeu "RECUSADA: Obra .*não encontrada no Mais Controle"\. Confira e siga pelos botões Ver prévia e Lançar$/);
  assert.equal(c.mails.length, 1);
  assert.equal(c.mails[0].to, "equipe@teste.example");
  assert.match(c.mails[0].subject, /Venda não lançada sozinha no Mais Controle — RUA DAS TESTES QD 01 LT 02 — casa 3/);
  for (let i = 0; i < 3; i++) c.vigia();
  assert.equal(c.fila().length, 2, "nenhum pedido novo");
  assert.equal(c.mails.length, 1, "um e-mail só");
  assert.ok(!c.g.logs.some((l) => /Fulana|FULANA|RUA DAS TESTES/.test(l)), "log sem nome nem endereço");
});

test("lançamento BLOQUEADO (fila sem chave de gravar) também para com aviso, sem repetir", () => {
  const c = cenario();
  c.estado();
  c.robo(PREVIA);
  c.vigia();
  c.robo("BLOQUEADO: gravar no Mais Controle está desligado neste ambiente (MC_VENDA_APLICAR) — " + PREVIA);
  c.vigia();
  assert.equal(c.p["MC_AUTO_" + PAGE], undefined);
  assert.match(c.sit(), /Lançamento automático: parou .*BLOQUEADO/);
  assert.equal(c.fila().filter((f) => f.tipo === "mc-venda").length, 2);
  assert.equal(c.mails.length, 1);
});

test("robô sem resposta: espera até 24 h e então para com aviso", () => {
  const c = cenario();
  c.estado();
  Fixo.mais = 23 * 3600000;
  c.vigia();
  assert.ok(c.p["MC_AUTO_" + PAGE], "23 h: ainda espera");
  Fixo.mais = 25 * 3600000;
  c.vigia();
  assert.equal(c.p["MC_AUTO_" + PAGE], undefined);
  assert.match(c.sit(), /parou .*o robô não respondeu em 24 horas/);
  assert.equal(c.mails.length, 1);
});

test("sem MC_LANCAR_AO_ASSINAR = SIM nada vai ao lançamento; o contrato vai ao Orçamento do mesmo jeito", () => {
  const c = cenario({ props: { MC_LANCAR_AO_ASSINAR: "" } });
  assert.equal(c.estado().situacao, "ASSINADO");
  assert.deepEqual(c.fila(), [{ tipo: "mc-anexos", pageId: PAGE, aplicar: true }]);
  assert.equal(c.p["MC_AUTO_" + PAGE], undefined);
  c.vigia();
  assert.equal(c.fila().length, 1);
});

test("alguém já tinha visto a prévia: o automático pede direto o lançamento", () => {
  const c = cenario({ valores: { "MC - SITUAÇÃO": texto(PREVIA) } });
  c.estado();
  assert.deepEqual(c.fila()[0], { tipo: "mc-venda", pageId: PAGE, aplicar: true });
  assert.equal(JSON.parse(c.p["MC_AUTO_" + PAGE]).fase, "lancar");
});

test("a vigia lê os contratos ENVIADO da base VENDAS (casa de rua) e os do condomínio, sem repetir", () => {
  const c = cenario();
  c.vigia();   /* a casa estava ENVIADO; a Clicksign diz closed → ASSINADO pela vigia */
  assert.equal(c.n.pagina.properties["ASSINATURA - SITUAÇÃO"].rich_text[0].plain_text, "ASSINADO");
  assert.equal(c.fila()[0].tipo, "mc-venda");
  /* sem DB_VENDAS nem DB_VENDAS_COND: não roda */
  const s = cenario({ props: { DB_VENDAS: "" } });
  s.g.ctx.vigiaAssinaturas();
  assert.ok(s.g.logs.some((l) => /vigia sem DB_VENDAS_COND nem DB_VENDAS/.test(l)));
});

test("nome do ZIP da casa de rua: CONTRATOS <ENDEREÇO> CASA 0N - compradores (sem repetir, sem caractere proibido)", () => {
  const z = cenario().g.ctx.mcNomeZipRua_;
  const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.assign({ type: Object.keys(v)[0] }, v)]));
  assert.equal(z(P({ "ENDEREÇO": tit("Rua das Testes Qd 01 Lt 02"), CASA: num(3), "CLIENTES ": texto("Fulana de Teste E Beltrano de Teste"),
                     "COMPRADOR 2 - NOME": texto("Beltrano: de Teste") })), "CONTRATOS RUA DAS TESTES QD 01 LT 02 CASA 03 - FULANA DE TESTE e BELTRANO DE TESTE.zip");
  assert.equal(z(P({ "ENDEREÇO": tit("RUA X"), CASA: texto("casa 12"), "CLIENTES ": texto("Ana"), "COMPRADOR 2 - NOME": texto("ana") })), "CONTRATOS RUA X CASA 12 - ANA.zip");
  assert.equal(z(P({ "ENDEREÇO": tit("RUA X"), CASA: texto("1 e 2") })), null, "duas casas: não adivinha");
  assert.equal(z(P({ "ENDEREÇO": tit(""), CASA: num(1) })), null);
});

test("casa de rua com a coluna do ZIP: a vigia monta o ZIP com o nome da casa e pede o envio", () => {
  const cols = Object.assign({}, COLS, { "CONTRATOS ASSINADOS (ZIP)": "files" });
  const c = cenario({ colunas: cols, props: { MC_LANCAR_AO_ASSINAR: "" } });
  assert.equal(c.estado().situacao, "ASSINADO");
  assert.ok(c.p["MC_ZIP_PENDENTE_" + PAGE], "ZIP pendente para a vigia");
  c.g.ctx.mcZipPendentes_();
  assert.deepEqual(c.n.pagina.properties["CONTRATOS ASSINADOS (ZIP)"].files.map((f) => f.name), ["CONTRATOS RUA DAS TESTES QD 01 LT 02 CASA 03 - FULANA DE TESTE.zip"]);
  assert.equal(c.fila().filter((f) => f.tipo === "mc-anexos").length, 2);
  assert.match(c.sit(), /\nContratos \(ZIP\): guardado no Notion \(1 documentos\), envio pedido ao robô/);
});

test("botão Anexar contrato na casa de rua funciona sem venda lançada (Orçamento)", () => {
  const c = cenario();
  const r = c.g.ctx.mcAnexar_(null, { u: "ana.teste", t: "ADM" }, { pageId: PAGE });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(c.fila(), [{ tipo: "mc-anexos", pageId: PAGE, aplicar: true }]);
  assert.match(c.sit(), /\nContrato no Orçamento: pedido ao robô em /);
});
