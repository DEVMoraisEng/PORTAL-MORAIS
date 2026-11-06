/* MaisControleVenda — "Lançar no Mais Controle" (entrega 4).
 * Arquivo do projeto PORTAL-VENDA (ao lado de PortalVenda.gs).
 *
 * O ERP não fala com o Apps Script: o WAF dele exige user-agent de navegador e
 * o UrlFetchApp não deixa trocar. Então aqui só se PEDE ao GitHub que rode o
 * workflow "mc-venda" (Python, venda/mc/lancar.py), que lê a venda no Notion,
 * fala com o ERP e escreve o resultado de volta nas colunas:
 *   MC - SITUAÇÃO  (texto)  PROCESSANDO… / PRÉVIA OK [#hash] | … / CRIADA | venda <id> / JÁ EXISTE … / RECUSADA: …
 *                           (PRÉVIA e CRIADA em linhas: cabeçalho, depois "Cliente: …", "Parcelas: …", "Total: …";
 *                           a tela desenha cada linha como tópico; o carimbo [#hash] fica sempre na 1ª linha)
 *   MC - VENDA ID  (texto)  id da venda no ERP
 * Propriedades: GITHUB_TOKEN (fine-grained, Contents: Read and write no repo),
 * GH_REPO_MC (ex.: "MoraisEng-Teste/PORTAL-MORAIS" — SEM padrão de propósito,
 * para o teste nunca disparar a produção por engano).
 * Gravar de verdade no ERP exige DUAS chaves: o clique em "Lançar" (aplicar)
 * E a variável MC_VENDA_APLICAR=1 no repositório do GitHub. */
var MC_COL_SITUACAO = "MC - SITUAÇÃO";
var MC_COL_VENDA = "MC - VENDA ID";

function mcColunaReal_(props, nome) {
  for (var k in props) if (RegrasVenda.chave(k) === RegrasVenda.chave(nome)) return { nome: k, tipo: props[k].type };
  return null;
}

function mcLerColunas_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  /* casa da VENDAS ou, desde a entrega 7, a própria linha do condomínio (DB_VENDAS_COND):
     o robô lê a linha e grava MC - SITUAÇÃO / MC - VENDA ID nela */
  if (!vendaBaseDaPagina_(pg)) throw new Error("PAGINA_DE_OUTRA_BASE");
  var props = pg.properties || {};
  var s = mcColunaReal_(props, MC_COL_SITUACAO), v = mcColunaReal_(props, MC_COL_VENDA);
  if (!s || !v || s.tipo !== "rich_text" || v.tipo !== "rich_text") throw new Error("COLUNA_FALTANDO: " + MC_COL_SITUACAO + ", " + MC_COL_VENDA + " (texto)");
  return { props: props, situacao: valorProp_(props[s.nome]) || "", vendaId: valorProp_(props[v.nome]) || "", colSituacao: s.nome,
           base: vendaBaseDaPagina_(pg) };   /* 05/11: "VENDAS" (casa de rua) ou "CONDOMINIO" */
}

function mcEstado_(col, p) {
  var c = mcLerColunas_(p.pageId);
  return { ok: true, situacao: c.situacao, vendaId: c.vendaId };
}

/* PROCESSANDO carimba a hora ([t=ms]); passado este prazo sem resposta do robô
   (workflow cancelado, GitHub fora do ar…), vale pedir de novo. */
var MC_PRAZO_MS = 15 * 60 * 1000;
function mcProcessandoVivo_(situacao, agora) {
  if (!/^PROCESSANDO/.test(situacao || "")) return false;
  var m = /\[t=(\d+)\]/.exec(situacao);
  return !m || (agora - Number(m[1])) < MC_PRAZO_MS;
}

function mcLancar_(col, sess, p) {
  var aplicar = p.aplicar === true || p.aplicar === "true";
  var repo = prop_("GH_REPO_MC"), tk = prop_("GITHUB_TOKEN"), fila = roboUsaFila_();   /* 27/10: fila do servidor */
  if (!fila && (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !tk)) return { ok: false, erro: "MC_NAO_CONFIGURADO" };
  /* trava: dois cliques ao mesmo tempo não disparam dois robôs */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "MC_PROCESSANDO" };
  try {
    var c = mcLerColunas_(p.pageId), agora = Date.now();
    if (c.vendaId) return { ok: false, erro: "MC_JA_LANCADA", vendaId: c.vendaId };
    if (mcProcessandoVivo_(c.situacao, agora)) return { ok: false, erro: "MC_PROCESSANDO" };
    if (aplicar && !/^PR[ÉE]VIA OK/i.test(c.situacao)) return { ok: false, erro: "MC_SEM_PREVIA" };

    /* o lançamento leva a assinatura da prévia vista; o robô confere de novo antes de gravar */
    var assin = (/\[#([0-9a-f]{8})\]/.exec(c.situacao) || [])[1] || "";
    var props = {};
    var texto = "PROCESSANDO (" + (aplicar ? "lançamento" : "prévia") + ") — " + hoje_("dd/MM HH:mm") + " [t=" + agora + "]" +
                (aplicar && assin ? " [#" + assin + "]" : "");
    props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: texto } }] };
    notion_("PATCH", "/pages/" + p.pageId, { properties: props });

    if (fila) {
      /* o robô do servidor pega em até 1 min; sem sinal dele, a situação já diz que o pedido espera */
      var f = roboFilaPor_("mc-venda", { pageId: String(p.pageId).replace(/-/g, ""), aplicar: aplicar });
      if (!f.ok) {
        props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: "ERRO: não consegui pôr o pedido na fila do servidor" } }] };
        try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); } catch (e) {}
        return { ok: false, erro: "MC_DISPARO_FALHOU" };
      }
      var aviso = roboAvisoSinal_(f.sinal, Date.now());
      if (aviso) {
        props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: texto + aviso } }] };
        try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); } catch (e) {}
      }
      console.log("PORTAL-VENDA mcLancar " + String(p.pageId).slice(0, 8) + (aplicar ? " aplicar" : " previa") + " (fila)");
      return { ok: true, aplicar: aplicar, fila: true, semSinal: !!aviso };
    }

    var code;
    try {
      code = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/dispatches", {
        method: "post", muteHttpExceptions: true, contentType: "application/json",
        headers: { Authorization: "Bearer " + tk, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        payload: JSON.stringify({ event_type: "mc-venda", client_payload: { pageId: String(p.pageId).replace(/-/g, ""), aplicar: aplicar } })
      }).getResponseCode();
    } catch (e) { code = 0; }
    if (code !== 204) {
      props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: "ERRO: não consegui acionar o robô (" + (code ? "HTTP " + code : "sem resposta do GitHub") + ")" } }] };
      try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); } catch (e) {}
      console.error("PORTAL-VENDA mcLancar dispatch " + (code || "sem resposta"));
      return { ok: false, erro: "MC_DISPARO_FALHOU" };
    }
    console.log("PORTAL-VENDA mcLancar " + String(p.pageId).slice(0, 8) + (aplicar ? " aplicar" : " previa"));
    return { ok: true, aplicar: aplicar };
  } finally {
    lock.releaseLock();
  }
}

/* ---- 05/11/2026 (dono, CASA DE RUA): "o contrato assinado por todos tem que ter a venda criada automaticamente no
 * Mais Controle, sem ninguém clicar em Ver prévia e Lançar". Só com a Propriedade MC_LANCAR_AO_ASSINAR = SIM.
 * Quando o PDF assinado entra na casa da VENDAS (assPosAssinatura_, pelo botão Atualizar ou pela vigia),
 * mcAutoIniciar_ pede a PRÉVIA (o mesmo mcLancar_ do botão, pela fila) e guarda MC_AUTO_<página> = {desde, fase}.
 * A cada volta da vigia (AssinaturaVigia.gs), mcAutoPendentes_ relê a casa:
 *  - MC - VENDA ID preenchido → terminou; pede o mc-anexos de novo (contrato no recebimento e no Orçamento: o robô
 *    não repete o que já está lá e devolve as linhas "Contrato…" que o lançamento reescreveu);
 *  - PROCESSANDO → espera (o pedido está na fila; o servidor pode estar desligado);
 *  - PRÉVIA OK na fase "previa" → pede o LANÇAMENTO (mcLancar_ aplicar: leva o carimbo [#hash] da prévia, que o robô
 *    confere antes de gravar);
 *  - qualquer outra coisa (RECUSADA, ERRO, JÁ EXISTE, BLOQUEADO, JÁ LANÇADA…) → PARA: linha "Lançamento automático:"
 *    na situação e UM e-mail para ASSINATURA_AVISO_EMAILS. Nunca tenta de novo sozinho (sem laço): a pessoa corrige
 *    e segue pelos botões Ver prévia / Lançar;
 *  - 24 h sem terminar → para do mesmo jeito.
 * As travas de gravar são as do botão: o robô só grava com aplicar + "pode_gravar" da fila + _central\VENDA_APLICAR.txt
 * (fila "teste": também _central\TESTE_PODE_GRAVAR.txt). O condomínio segue com vigiaLancarMC_ (espera a prévia do botão). */
var MC_AUTO = "MC_AUTO_";                    // + id da página = {desde, fase: "previa" | "lancar"}
var MC_AUTO_DESISTE_MS = 24 * 3600000;
var MC_ROTULO_AUTO = "Lançamento automático";
var MC_SESS_AUTO = { u: "vigia de assinaturas", t: "ADM" };

function mcAutoLigado_() { return String(prop_("MC_LANCAR_AO_ASSINAR") || "").trim().toUpperCase() === "SIM"; }

/* Começo (assPosAssinatura_, casa da VENDAS, PDF assinado acabou de entrar). Devolve o que fez (para o teste e o log). */
function mcAutoIniciar_(col, pageId) {
  var id8 = String(pageId).slice(0, 8), chave = MC_AUTO + pageId;
  if (prop_(chave)) return "em andamento";
  var c = mcLerColunas_(pageId);
  if (c.vendaId) { ctrLog_("auto MC " + id8 + ": já lançada, nada a fazer"); return "ja lancada"; }
  var previaOk = /^PR[ÉE]VIA OK/i.test(c.situacao || "");   /* alguém já viu a prévia: vai direto ao lançamento */
  var r = mcLancar_(col, MC_SESS_AUTO, { pageId: pageId, aplicar: previaOk }) || {};
  if (r.ok || r.erro === "MC_PROCESSANDO") {   /* processando: um pedido do botão já está na fila; a vigia segue dele */
    assProps_().setProperty(chave, JSON.stringify({ desde: Date.now(), fase: previaOk && r.ok ? "lancar" : "previa" }));
    ctrLog_("auto MC " + id8 + ": " + (r.ok ? (previaOk ? "lançamento" : "prévia") + " pedido" : "esperando o pedido que já estava na fila"));
    return r.ok ? (previaOk ? "lancamento pedido" : "previa pedida") : "esperando";
  }
  if (r.erro === "MC_JA_LANCADA") return "ja lancada";
  mcAutoParar_(pageId, "não consegui pedir a prévia ao robô (" + (r.erro || "?") + ")");
  return "parou";
}

/* Vigia: um passo de cada casa pendente. */
function mcAutoPendentes_() {
  var props = PropertiesService.getScriptProperties(), agora = Date.now();
  (props.getKeys ? props.getKeys() : []).filter(function (k) { return k.indexOf(MC_AUTO) === 0; }).forEach(function (k) {
    var pageId = k.slice(MC_AUTO.length), st;
    try { st = JSON.parse(props.getProperty(k) || "{}") || {}; } catch (e) { st = {}; }
    try { mcAutoPasso_(pageId, st, agora); }
    catch (e) {
      ctrErro_("auto MC " + pageId.slice(0, 8), e);
      if (!st.desde || agora - st.desde > MC_AUTO_DESISTE_MS) assApagarProp_(k);   /* não fica lendo para sempre */
    }
  });
}

function mcAutoPasso_(pageId, st, agora) {
  var chave = MC_AUTO + pageId, id8 = String(pageId).slice(0, 8);
  var c = mcLerColunas_(pageId), s = String(c.situacao || "");
  if (c.vendaId) {
    assApagarProp_(chave);
    ctrLog_("auto MC " + id8 + ": venda lançada");
    try { if (typeof mcAnexosRua_ === "function") mcAnexosRua_(pageId, c.vendaId); }
    catch (e) { ctrErro_("auto MC " + id8 + " anexos", e); }
    return "lancada";
  }
  var velho = st.desde && agora - st.desde > MC_AUTO_DESISTE_MS;
  if (/^PROCESSANDO/.test(s)) {
    if (velho) { mcAutoParar_(pageId, "o robô não respondeu em 24 horas"); return "parou"; }
    return "esperando";
  }
  if (/^PR[ÉE]VIA OK/i.test(s) && st.fase !== "lancar" && !velho) {
    var r = mcLancar_(null, MC_SESS_AUTO, { pageId: pageId, aplicar: true }) || {};
    if (r.ok) {
      assProps_().setProperty(chave, JSON.stringify({ desde: st.desde || agora, fase: "lancar" }));
      ctrLog_("auto MC " + id8 + ": prévia OK, lançamento pedido");
      return "lancamento pedido";
    }
    if (r.erro === "MC_PROCESSANDO") return "esperando";
    mcAutoParar_(pageId, "não consegui pedir o lançamento ao robô (" + (r.erro || "?") + ")");
    return "parou";
  }
  var cab = s.split(/\r?\n/)[0].replace(/\s*\[#[0-9a-f]{8}\]/, "").trim();
  mcAutoParar_(pageId, velho ? "não terminou em 24 horas" : (cab ? "o robô respondeu \"" + cab.slice(0, 160) + "\"" : "a situação ficou vazia"));
  return "parou";
}

/* Para o automático desta casa: linha na situação + um e-mail. Nunca derruba quem chamou. */
function mcAutoParar_(pageId, motivo) {
  var id8 = String(pageId).slice(0, 8);
  assApagarProp_(MC_AUTO + pageId);
  ctrLog_("auto MC " + id8 + ": parou");
  try { mcGravarLinhas_(pageId, [[MC_ROTULO_AUTO, "parou em " + hoje_("dd/MM HH:mm") + " — " + motivo + ". Confira e siga pelos botões Ver prévia e Lançar"]]); }
  catch (e) { ctrErro_("auto MC " + id8 + " situação", e); }
  try { mcAutoAvisar_(pageId, motivo); } catch (e) { ctrErro_("auto MC " + id8 + " aviso", e); }
}

function mcAutoAvisar_(pageId, motivo) {
  var cfg = prop_("ASSINATURA_AVISO_EMAILS") || (typeof ASSINATURA_AVISO_EMAILS_PADRAO !== "undefined" ? ASSINATURA_AVISO_EMAILS_PADRAO : "");
  var dest = String(cfg || "").split(/[,;\s]+/).filter(function (x) { return /@/.test(x); }), id8 = String(pageId).slice(0, 8);
  if (!dest.length) { ctrLog_("auto MC " + id8 + " sem ASSINATURA_AVISO_EMAILS: ninguém avisado"); return false; }
  if (typeof MailApp === "undefined" || MailApp.getRemainingDailyQuota() < 1) { ctrLog_("auto MC " + id8 + " sem cota de e-mail hoje"); return false; }
  var casa = "";
  try {
    var pg = notion_("GET", "/pages/" + pageId, null) || {};
    for (var n in pg.properties) if (pg.properties[n].type === "title") casa = ctrTxt_(ctrValor_(pg.properties[n])).trim();
    var pc = mcColunaReal_(pg.properties || {}, "CASA");
    if (pc && ctrValor_(pg.properties[pc.nome])) casa += " — casa " + ctrTxt_(ctrValor_(pg.properties[pc.nome]));
  } catch (e) { casa = ""; }
  MailApp.sendEmail({
    to: dest.join(","),
    subject: "[Portal de Vendas] Venda não lançada sozinha no Mais Controle — " + (casa || "casa sem nome"),
    body: "O contrato da " + (casa || "casa") + " foi assinado por todos, mas o lançamento automático no Mais Controle parou: " +
          motivo + ".\n\nAbra a casa no portal, bloco Mais Controle: confira a situação, corrija o que for preciso e use " +
          "Ver prévia e Lançar. O automático não tenta de novo sozinho.\n\nAviso automático da vigia de assinaturas."
  });
  ctrLog_("auto MC " + id8 + ": aviso enviado a " + dest.length + " endereço(s)");
  return true;
}
