/* AssinaturaVigia.gs — "quando todos assinarem" (31/10/2026, dono — etapa 3 da repaginação do cartão do condomínio).
 * Um gatilho de tempo (instalarVigiaAssinaturas: rodar UMA vez no editor do PORTAL-VENDA) relê na Clicksign, a cada
 * 10 minutos, os contratos do condomínio ainda ENVIADO — o mesmo assinaturaEstado_ do botão "Atualizar situação", que
 * já anexa o PDF assinado em CONTRATO ASSINADO e grava a situação. Quando o contrato fica ASSINADO:
 *  - marca "ASSINOU E ARMAZENOU CONTRATO" = SIM no Andamento do cartão (se a coluna existir e ainda não estiver SIM);
 *  - só com a Propriedade MC_LANCAR_AO_ASSINAR = SIM e a prévia do Mais Controle OK, pede o lançamento (mcLancar_,
 *    a mesma trava do botão). Sem a Propriedade, nada vai ao Mais Controle sozinho: a pessoa lança pelo botão.
 * Nunca envia, reenvia nem cancela envelope. */
var VIGIA_ANDAMENTO = "ASSINOU E ARMAZENOU CONTRATO";

function vigiaAssinaturas() {
  var db = String(prop_("DB_VENDAS_COND") || "").trim();
  if (!db) { ctrLog_("vigia sem DB_VENDAS_COND"); return; }
  var abertos = vigiaAbertos_(db), col = colunas_(), assinados = 0;
  abertos.forEach(function (pg) {
    try { if (vigiaUma_(col, pg)) assinados++; }
    catch (e) { ctrErro_("vigia " + String(pg.id).slice(0, 8), e); }
  });
  ctrLog_("vigia " + abertos.length + " envelope(s) aberto(s), " + assinados + " assinado(s) agora");
}

/* linhas do condomínio com o contrato ENVIADO (nome real da coluna pelo esquema da base: pode ter espaço sobrando) */
function vigiaAbertos_(db) {
  var sch = (notion_("GET", "/databases/" + db, null) || {}).properties || {}, nome = null;
  Object.keys(sch).forEach(function (n) { if (RegrasVenda.chave(n) === RegrasVenda.chave(ASS_COL.SITUACAO)) nome = n; });
  if (!nome || sch[nome].type !== "rich_text") return [];
  var out = [], cursor = null;
  do {
    var corpo = { filter: { property: nome, rich_text: { equals: ClicksignVenda.SITUACOES ? ClicksignVenda.SITUACOES.ENVIADO : "ENVIADO" } }, page_size: 100 };
    if (cursor) corpo.start_cursor = cursor;
    var r = notion_("POST", "/databases/" + db + "/query", corpo) || {};
    out = out.concat(r.results || []);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

function vigiaUma_(col, pg) {
  var r = assinaturaEstado_(col, { pageId: pg.id });
  if (!r || !r.ok || r.situacao !== "ASSINADO") return false;
  ctrLog_("vigia " + String(pg.id).slice(0, 8) + " contrato assinado");
  vigiaMarcarAndamento_(pg);
  if (String(prop_("MC_LANCAR_AO_ASSINAR") || "").trim().toUpperCase() === "SIM") vigiaLancarMC_(col, pg.id);
  return true;
}

function vigiaMarcarAndamento_(pg) {
  var props = pg.properties || {}, nome = null;
  Object.keys(props).forEach(function (n) { if (RegrasVenda.chave(n) === RegrasVenda.chave(VIGIA_ANDAMENTO)) nome = n; });
  if (!nome) return;
  var pr = props[nome], novo = {};
  if (pr.type === "checkbox") { if (pr.checkbox) return; novo[nome] = { checkbox: true }; }
  else if (pr.type === "select") { if (pr.select && RegrasVenda.chave(pr.select.name) === "SIM") return; novo[nome] = { select: { name: "SIM" } }; }
  else return;
  notion_("PATCH", "/pages/" + pg.id, { properties: novo });
  ctrLog_("vigia " + String(pg.id).slice(0, 8) + " Andamento: " + VIGIA_ANDAMENTO + " = SIM");
}

function vigiaLancarMC_(col, pageId) {
  var c = mcLerColunas_(pageId);
  if (c.vendaId) return;
  if (!/^PR[ÉE]VIA OK/i.test(c.situacao || "")) { ctrLog_("vigia " + String(pageId).slice(0, 8) + " MC: sem prévia OK, espera o botão"); return; }
  var r = mcLancar_(col, { u: "vigia de assinaturas", t: "ADM" }, { pageId: pageId, aplicar: true });
  ctrLog_("vigia " + String(pageId).slice(0, 8) + " MC: " + (r && r.ok ? "lançamento pedido" : "não lançou (" + (r && r.erro) + ")"));
}

/* rodar UMA vez no editor (ou de novo para reinstalar): troca o gatilho antigo, se houver */
function instalarVigiaAssinaturas() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "vigiaAssinaturas") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("vigiaAssinaturas").timeBased().everyMinutes(10).create();
  console.log("vigia de assinaturas instalado: a cada 10 minutos");
}
