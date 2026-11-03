/* AssinaturaVigia.gs — "quando todos assinarem" (31/10/2026, dono — etapa 3 da repaginação do cartão do condomínio).
 * Um gatilho de tempo (instalarVigiaAssinaturas: rodar UMA vez no editor do PORTAL-VENDA) relê na Clicksign, a cada
 * 15 minutos (só entre 7h e 21h, horário de São Paulo), os contratos do condomínio ainda ENVIADO — o mesmo assinaturaEstado_ do botão "Atualizar situação", que
 * já anexa o PDF assinado em CONTRATO ASSINADO e grava a situação. Quando o contrato fica ASSINADO:
 *  - marca "ASSINOU E ARMAZENOU CONTRATO" = SIM no Andamento do cartão (se a coluna existir e ainda não estiver SIM);
 *  - só com a Propriedade MC_LANCAR_AO_ASSINAR = SIM e a prévia do Mais Controle OK, pede o lançamento (mcLancar_,
 *    a mesma trava do botão). Sem a Propriedade, nada vai ao Mais Controle sozinho: a pessoa lança pelo botão.
 * 03/11/2026 (dono — o webhook da Clicksign não serve: o Apps Script responde 302 e ela trata como falha):
 *  - a cada 15 minutos (antes 30) e também os TERMOS DE PRÉ-RESERVA ENVIADO (mesmo assinaturaEstado_, doc PRE_RESERVA);
 *  - a volta curta lê o envelope E os eventos de cada documento: recusa e assinatura nova não mudam o status do
 *    envelope (continua running), então só o status não bastava. A marca guardada é status + nº de sign/refusal/deadline;
 *  - o progresso "3 de 5" vai para ASSINATURA - PROGRESSO / PRÉ-RESERVA - PROGRESSO (assGravarProgresso_);
 *  - ENVIADO que vira RECUSADO, CANCELADO ou EXPIRADO pela vigia manda UM e-mail para a Propriedade
 *    ASSINATURA_AVISO_EMAILS (endereços separados por vírgula ou ponto e vírgula). O botão Atualizar não avisa.
 * Para poupar a cota de UrlFetch: de cada envelope aberto a vigia faz o GET do envelope e o dos eventos de cada
 * documento (ids guardados junto da marca em VIGIA_STATUS_<envelope>); documentos e signatários só são lidos quando
 * algo mudou desde a última vez.
 * Nunca envia, reenvia nem cancela envelope. */
var VIGIA_STATUS = "VIGIA_STATUS_";
var VIGIA_AGUARDA_MAX_MS = 24 * 3600000;
var VIGIA_HORA_INICIO = 7, VIGIA_HORA_FIM = 21;   /* roda das 7h às 20h59 (São Paulo) */
var VIGIA_MINUTOS = 15;
var VIGIA_AVISA = ["RECUSADO", "CANCELADO", "EXPIRADO"];

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
  /* 03/11: termos de pré-reserva ainda ENVIADO */
  var termos = [];
  try { termos = vigiaAbertosTermo_(db); } catch (e) { ctrErro_("vigia termos", e); }
  termos.forEach(function (pg) {
    try { vigiaUma_(col, pg, { doc: "PRE_RESERVA" }); }
    catch (e) { ctrErro_("vigia termo " + String(pg.id).slice(0, 8), e); }
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
  ctrLog_("vigia " + abertos.length + " contrato(s) e " + termos.length + " termo(s) aberto(s), " + assinados + " assinado(s) agora");
  /* 03/11 (AnexosMC.gs): ZIP dos assinados é montado aqui, fora do "Atualizar situação" (no máximo 1 tentativa/hora) */
  try { if (typeof mcZipPendentes_ === "function") mcZipPendentes_(); }
  catch (e) { ctrErro_("vigia zip dos assinados", e); }
}

/* linhas do condomínio com o contrato ENVIADO (nome real da coluna pelo esquema da base: pode ter espaço sobrando) */
function vigiaAbertos_(db) { return vigiaAbertosPor_(db, ASS_COL.SITUACAO); }
/* 03/11: linhas com o termo de pré-reserva ENVIADO */
function vigiaAbertosTermo_(db) { return vigiaAbertosPor_(db, PreReservaVenda.COL.SITUACAO); }
function vigiaAbertosPor_(db, coluna) {
  var sch = (notion_("GET", "/databases/" + db, null) || {}).properties || {}, nome = null;
  Object.keys(sch).forEach(function (n) { if (RegrasVenda.chave(n) === RegrasVenda.chave(coluna)) nome = n; });
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

/* Marca da volta curta: "status|s<sign>|r<refusal>|d<deadline>" + "#" + ids dos documentos (guardados para não pedir
 * a lista de novo). null = alguma leitura falhou (segue o caminho completo e não guarda nada). */
function vigiaMarca_(base, status, guardado) {
  var docs = String(guardado || "").split("#")[1];
  docs = docs ? docs.split(",").filter(function (x) { return x; }) : [];
  if (!docs.length) {
    var d = cs_("get", base + "/documents");
    if (!d || !d.ok || !Array.isArray(d.data) || !d.data.length) return null;
    docs = d.data.map(function (x) { return String(x.id); });
  }
  var n = { sign: 0, refusal: 0, deadline: 0 };
  for (var i = 0; i < docs.length; i++) {
    var e = cs_("get", base + "/documents/" + encodeURIComponent(docs[i]) + "/events");
    if (!e || !e.ok) return null;
    (e.data || []).forEach(function (ev) {
      var nome = String((ev && ev.attributes && ev.attributes.name) || "");
      if (nome in n) n[nome]++;
    });
  }
  return status + "|s" + n.sign + "|r" + n.refusal + "|d" + n.deadline + "#" + docs.join(",");
}

function vigiaUma_(col, pg, opc) {
  var doc = assDoc_(opc || {}), envId = "", sitAntes = "", marca = null;
  try { var cols = assColunas_(pg, doc); envId = assTexto_(pg, cols.ENVELOPE); sitAntes = assTexto_(pg, cols.SITUACAO).toUpperCase(); }
  catch (e) { envId = ""; }
  if (envId) {
    /* volta curta: envelope + eventos; nada mudou desde a última leitura = nada a fazer */
    var base = "/envelopes/" + encodeURIComponent(envId), guardado = String(prop_(VIGIA_STATUS + envId) || "");
    var g = cs_("get", base), visto = g && g.ok ? String(g.status || "") : "";
    if (visto && guardado.split("|")[0] === visto) {
      marca = vigiaMarca_(base, visto, guardado);
      if (marca && marca === guardado) return false;
    } else if (visto) marca = vigiaMarca_(base, visto, "");
  }
  var r = assinaturaEstado_(col, { pageId: pg.id, doc: opc && opc.doc });
  if (envId && marca && r && r.ok) {
    if (r.situacao === "ENVIADO") assProps_().setProperty(VIGIA_STATUS + envId, marca);
    else assApagarProp_(VIGIA_STATUS + envId);   /* final (assinado/cancelado...) ou limpo: não guarda lixo */
  }
  if (r && r.ok && sitAntes === "ENVIADO" && VIGIA_AVISA.indexOf(r.situacao) >= 0) {
    try { vigiaAvisar_(pg, doc, r.situacao); } catch (e) { ctrErro_("vigia aviso " + String(pg.id).slice(0, 8), e); }
  }
  if (doc.pre) return false;
  if (!r || !r.ok || r.situacao !== "ASSINADO") return false;
  if (r.aguardandoArquivo && !r.temAssinado) return false;   /* o PDF assinado ainda não entrou: a próxima volta da vigia conclui */
  /* Andamento e Mais Controle: assPosAssinatura_, chamado pelo assinaturaEstado_ na hora em que o PDF entra */
  ctrLog_("vigia " + String(pg.id).slice(0, 8) + " contrato assinado");
  return true;
}

/* 03/11: e-mail para a equipe quando a vigia vê o envelope recusado, cancelado ou expirado. Sem a Propriedade, só o log. */
function vigiaAvisar_(pg, doc, situacao) {
  /* Propriedade; sem ela, ASSINATURA_AVISO_EMAILS_PADRAO de um arquivo que só existe no Apps Script (AvisosConfig.gs,
     fora do repositório público: os endereços não entram no GitHub) */
  var cfg = prop_("ASSINATURA_AVISO_EMAILS") || (typeof ASSINATURA_AVISO_EMAILS_PADRAO !== "undefined" ? ASSINATURA_AVISO_EMAILS_PADRAO : "");
  var dest = String(cfg || "").split(/[,;\s]+/).filter(function (x) { return /@/.test(x); });
  var id8 = String(pg.id).slice(0, 8);
  if (!dest.length) { ctrLog_("vigia " + id8 + " " + situacao + " sem ASSINATURA_AVISO_EMAILS: ninguém avisado"); return; }
  if (MailApp.getRemainingDailyQuota() < 1) { ctrLog_("vigia " + id8 + " " + situacao + " sem cota de e-mail hoje"); return; }
  var unidade = "";
  for (var n in pg.properties) if (pg.properties[n].type === "title") unidade = ctrTxt_(ctrValor_(pg.properties[n])).trim();
  var oque = doc.pre ? "Termo de pré-reserva" : "Contrato", sit = situacao.toLowerCase();
  MailApp.sendEmail({
    to: dest.join(","),
    subject: "[Portal de Vendas] " + oque + " " + sit + " na Clicksign — " + (unidade || "unidade sem nome"),
    body: oque + " da unidade " + (unidade || "(sem nome)") + " ficou " + situacao + " na Clicksign.\n\n" +
          "Abra o card da unidade no portal (Atualizar situação) para ver quem assinou, quem recusou e o motivo; " +
          "se for o caso, corrija e envie de novo.\n\nAviso automático da vigia de assinaturas."
  });
  ctrLog_("vigia " + id8 + " " + situacao + ": aviso enviado a " + dest.length + " endereço(s)");
}

/* rodar UMA vez no editor (ou de novo para reinstalar): troca o gatilho antigo, se houver */
function instalarVigiaAssinaturas() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "vigiaAssinaturas") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("vigiaAssinaturas").timeBased().everyMinutes(VIGIA_MINUTOS).create();
  console.log("vigia de assinaturas instalado: a cada " + VIGIA_MINUTOS + " minutos, das 7h às 21h");
}
