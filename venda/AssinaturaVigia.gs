/* AssinaturaVigia.gs — "quando todos assinarem" (31/10/2026, dono — etapa 3 da repaginação do cartão do condomínio).
 * Um gatilho de tempo (instalarVigiaAssinaturas: rodar UMA vez no editor do PORTAL-VENDA) relê na Clicksign, a cada
 * 30 minutos (só entre 7h e 21h, horário de São Paulo), os contratos do condomínio ainda ENVIADO — o mesmo assinaturaEstado_ do botão "Atualizar situação", que
 * já anexa o PDF assinado em CONTRATO ASSINADO e grava a situação. Quando o contrato fica ASSINADO:
 *  - marca "ASSINOU E ARMAZENOU CONTRATO" = SIM no Andamento do cartão (se a coluna existir e ainda não estiver SIM);
 *  - só com a Propriedade MC_LANCAR_AO_ASSINAR = SIM e a prévia do Mais Controle OK, pede o lançamento (mcLancar_,
 *    a mesma trava do botão). Sem a Propriedade, nada vai ao Mais Controle sozinho: a pessoa lança pelo botão.
 * Para poupar a cota de UrlFetch: de cada envelope aberto a vigia só faz o GET do envelope; documentos, eventos e
 * signatários só são lidos quando o status mudou desde a última vez (guardado em VIGIA_STATUS_<envelope>).
 * Nunca envia, reenvia nem cancela envelope. */
var VIGIA_STATUS = "VIGIA_STATUS_";
var VIGIA_AGUARDA_MAX_MS = 24 * 3600000;
var VIGIA_HORA_INICIO = 7, VIGIA_HORA_FIM = 21;   /* roda das 7h às 20h59 (São Paulo) */

function vigiaNoHorario_() {
  var h = Number(Utilities.formatDate(new Date(), "America/Sao_Paulo", "H"));
  return h >= VIGIA_HORA_INICIO && h < VIGIA_HORA_FIM;
}

function vigiaAssinaturas() {
  if (!vigiaNoHorario_()) return;   /* antes de qualquer chamada de rede */
  var db = String(prop_("DB_VENDAS_COND") || "").trim();
  if (!db) { ctrLog_("vigia sem DB_VENDAS_COND"); return; }
  var abertos = vigiaAbertos_(db), col = colunas_(), assinados = 0, vistos = {};
  abertos.forEach(function (pg) {
    vistos[pg.id] = true;
    try { if (vigiaUma_(col, pg)) assinados++; }
    catch (e) { ctrErro_("vigia " + String(pg.id).slice(0, 8), e); }
  });
  /* 01/11 (correção 3): ASSINADO esperando o arquivo da Clicksign (ASS_AGUARDANDO_<pageId>) — só estes, por até 24 h.
     Linha antiga ASSINADO sem arquivo nunca é tocada. */
  var props = assProps_(), chaves = props.getKeys ? props.getKeys() : [];
  chaves.filter(function (k) { return k.indexOf(ASS_AGUARDANDO) === 0; }).forEach(function (k) {
    var id = k.slice(ASS_AGUARDANDO.length), desde = Number(props.getProperty(k)) || 0;
    if (!desde || Date.now() - desde > VIGIA_AGUARDA_MAX_MS) {
      assApagarProp_(k);
      ctrLog_("vigia " + id.slice(0, 8) + " desistiu: o arquivo assinado não veio em 24 h — use Atualizar situação");
      return;
    }
    if (vistos[id]) return;
    try { if (vigiaUma_(col, ctrLerPaginaVenda_(id))) assinados++; }
    catch (e) { ctrErro_("vigia " + id.slice(0, 8) + " aguardando arquivo", e); }
  });
  ctrLog_("vigia " + abertos.length + " envelope(s) aberto(s), " + assinados + " assinado(s) agora");
}

/* linhas do condomínio com o contrato ENVIADO (nome real da coluna pelo esquema da base: pode ter espaço sobrando) */
function vigiaAbertos_(db) {
  var sch = (notion_("GET", "/databases/" + db, null) || {}).properties || {}, nome = null;
  Object.keys(sch).forEach(function (n) { if (RegrasVenda.chave(n) === RegrasVenda.chave(ASS_COL.SITUACAO)) nome = n; });
  if (!nome || sch[nome].type !== "rich_text") return [];
  var filtro = { property: nome, rich_text: { equals: ClicksignVenda.SITUACOES ? ClicksignVenda.SITUACOES.ENVIADO : "ENVIADO" } };
  var out = [], cursor = null;
  do {
    var corpo = { filter: filtro, page_size: 100 };
    if (cursor) corpo.start_cursor = cursor;
    var r = notion_("POST", "/databases/" + db + "/query", corpo) || {};
    out = out.concat(r.results || []);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

function vigiaUma_(col, pg) {
  /* só o GET do envelope; se o status é o mesmo da última leitura, nada mais a fazer (1 chamada por envelope) */
  var envId = "", visto = "";
  try { envId = assTexto_(pg, assColunas_(pg).ENVELOPE); } catch (e) { envId = ""; }
  if (envId) {
    var g = cs_("get", "/envelopes/" + encodeURIComponent(envId));
    visto = g && g.ok ? String(g.status || "") : "";
    if (visto && visto === String(prop_(VIGIA_STATUS + envId) || "")) return false;
  }
  var r = assinaturaEstado_(col, { pageId: pg.id });
  if (envId && visto && r && r.ok) {
    if (r.situacao === "ENVIADO") assProps_().setProperty(VIGIA_STATUS + envId, visto);
    else assApagarProp_(VIGIA_STATUS + envId);   /* final (assinado/cancelado...) ou limpo: não guarda lixo */
  }
  if (!r || !r.ok || r.situacao !== "ASSINADO") return false;
  if (r.aguardandoArquivo && !r.temAssinado) return false;   /* o PDF assinado ainda não entrou: a próxima volta da vigia conclui */
  /* Andamento e Mais Controle: assPosAssinatura_, chamado pelo assinaturaEstado_ na hora em que o PDF entra */
  ctrLog_("vigia " + String(pg.id).slice(0, 8) + " contrato assinado");
  return true;
}

/* rodar UMA vez no editor (ou de novo para reinstalar): troca o gatilho antigo, se houver */
function instalarVigiaAssinaturas() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "vigiaAssinaturas") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("vigiaAssinaturas").timeBased().everyMinutes(30).create();
  console.log("vigia de assinaturas instalado: a cada 30 minutos, das 7h às 21h");
}
