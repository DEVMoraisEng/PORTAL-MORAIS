/*************************************************************************
 * MarketingLeads.gs · PORTAL-MORAIS — 24/11/2026
 * -----------------------------------------------------------------------
 * ANÁLISE DE MARKETING (analise-marketing.html, grupo ANÁLISES do portal).
 * Duas partes:
 *
 * 1) CAMPANHAS — dashboard das planilhas de anúncio da Meta.
 *    Planilha "LEADS RESERVA DOS IPES - CANEDO" (marketing). Cada aba a partir
 *    da 3ª que tiver as colunas ad_name e adset_name vira uma aba do dashboard
 *    (hoje: LEADS LANÇAMENTO e LEAD - RESERVA DOS IPÊS). Aba nova do marketing
 *    com o mesmo formato aparece sozinha.
 *    Classificação de cada lead (cliente / corretor / respondeu e parou /
 *    sem resposta / sem conversa), na ordem:
 *      a) aba HYPERFLOW da própria planilha de marketing (criada por este
 *         arquivo): leitura das conversas e da tela Oportunidades da
 *         HyperFlow + o que for corrigido à mão no portal;
 *      b) telefone que está na planilha ATENDIMENTOS LEADS RESERVA DOS IPES
 *         (o fluxo da HyperFlow grava ali quem terminou a qualificação como
 *         cliente) → CLIENTE;
 *      c) nada disso → "sem classificação".
 *    Qualificado/desqualificado = coluna lead_status da Meta.
 *
 * 2) REDIRECIONAMENTO — leads clientes que a HyperFlow grava na planilha
 *    ATENDIMENTOS (mesma estrutura, sem as colunas J "Informações" e L) e os
 *    leads novos da aba "Site" (esses só vão para o HUDSON).
 *    Enviar para o corretor = acrescenta a linha na planilha da imobiliária
 *    (JESSICA, LUXURY IMÓVEIS, MY BROKER CANEDO, GERLIANE), marca "SIM" na
 *    coluna "MANDOU PRA TABELA DE CORRETORES?" e registra o envio na aba
 *    ENVIOS PORTAL da planilha ATENDIMENTOS (criada por este arquivo).
 *    O retorno da imobiliária é lido da planilha dela (coluna RETORNO DA
 *    IMOBILIÁRIA SOBRE O LEAD) para o alerta de "sem retorno há X dias".
 *
 * ACESSO: "ANÁLISE DE MARKETING" na coluna ACESSOS do LOGINS (ADM, MASTER e
 * TESTES veem sempre; TESTES não grava).
 *
 * AÇÕES (roteadas pelo Melhorias.gs — linha do gancho abaixo):
 *   mkVersao        diagnóstico: versão e se as planilhas abrem
 *   mkCampanhas     abas de campanha + classificação de cada lead
 *   mkClassificar   corrige a classificação de um lead (vai para a aba HYPERFLOW)
 *   mkClassImport   ADM: grava a classificação em lote (leitura da HyperFlow)
 *   mkLeads         lista do redirecionamento (atendimentos + site) com status
 *   mkEnviar        envia um lead para a planilha da imobiliária
 *   mkHudson        confirma envio ao Hudson (um ou vários de uma vez)
 *   mkDesfazer      ADM: apaga o registro de envio (não mexe na planilha da imobiliária)
 *   mkRobo          SEM login do portal, com a chave do robô (Propriedade MK_ROBO_CHAVE):
 *                   o robô da HyperFlow do servidor (servidor/robo_hyperflow.py) pede a lista de
 *                   leads (op "leads"), grava a classificação (op "gravar") e o resultado da
 *                   rodada (op "status"). O gancho fica no Code.gs, ANTES da conferência de sessão:
 *                     if (action === "mkRobo") return out_(mkRobo_(p));
 *
 * mk2 (25/11/2026):
 *   - LEADS CLIENTES (aba da planilha de marketing) recebe sozinha cada atendimento novo da
 *     HyperFlow (acionador de 10 em 10 min — rodar mkLigarAcionador uma vez), na próxima linha
 *     livre (a coluna IMOBILIÁRIA já vem com o rodízio pré-preenchido e é mantida). Lead que já
 *     está na planilha de uma imobiliária entra com a IMOBILIÁRIA real e HUDSON TRANSPÔS = SIM.
 *     O envio pelo portal também marca IMOBILIÁRIA e HUDSON TRANSPÔS.
 *   - o envio sugere a imobiliária da linha da LEADS CLIENTES (o rodízio).
 *   - campanhas: qualquer aba (menos a 1ª, a HYPERFLOW e as conhecidas) com ad_name e adset_name;
 *     a aba HYPERFLOW vai para o fim da planilha.
 *   - mkCampanhas devolve também quem já foi enviado à imobiliária e se tem retorno (funil da
 *     análise de decisão) e a última rodada do robô.
 *
 * COMO INSTALAR (projeto PORTAL-LEITURA — o da URL padrão do portal):
 *   1) Arquivo novo "MarketingLeads" (script) com este conteúdo.
 *   2) Melhorias.gs — DENTRO de melhoriasRotear_, junto dos outros ganchos:
 *        if (typeof mkRotear_ === "function") { var rMk = mkRotear_(action, sess, p); if (rMk) return rMk; }
 *   3) A conta dona do Apps Script precisa ser EDITORA das 6 planilhas
 *      (marketing, ATENDIMENTOS e as 4 das imobiliárias).
 *   4) Salvar + Implantar > Gerenciar implantações > lápis > Nova versão.
 *      Na 1ª vez o Google pede autorização nova (Planilhas).
 *   Teste: ?acao=… não existe aqui; use o rodapé da página (mostra "Apps Script mk1").
 *   5) Notion, banco LOGINS: criar a opção "ANÁLISE DE MARKETING" na coluna
 *      ACESSOS e marcar em quem usa (Hudson, marketing).
 *************************************************************************/

var MK_VERSAO = "mk4";
var MK_ACESSO = "ANÁLISE DE MARKETING";
var MK_FUSO = "America/Sao_Paulo";

/* IDs das planilhas (não são segredo). Propriedades do script com o mesmo
   nome trocam o valor sem mexer no código. */
var MK_PADRAO = {
  MK_PLANILHA_MARKETING: "1JmfYYgClX3ci2l3ImdJ4Z60ElW_qfEM6XhbGI0AYM4Y",
  MK_PLANILHA_ATENDIMENTOS: "1z0k_zDXjZdVDxoNhz5dQ_HE11dXpokPaFQ1y-uizcBc",
  MK_SITE_INICIO: "2026-11-24"      // leads da aba Site a partir deste dia entram na fila do Hudson
};
var MK_CORRETORES = [
  { nome: "JESSICA",          id: "1obZVybjRgSduGXFRYBdiCzYfFzXIwmJkcHCXr_foZBA" },
  { nome: "LUXURY IMÓVEIS",   id: "1gEmmlYljNwyTRuss2xg-aenToypfO01OAcBu72lbFjE" },
  { nome: "MY BROKER CANEDO", id: "1rEz0wZoWsTIC5PfPnuoZb3ZNkELjmMBy_cm507UlYa0" },
  { nome: "GERLIANE",         id: "1l2-evFfG4AlhjVBcGggnS7On7MwHkEu0-DGS7NUbzVw" }
];
var MK_HUDSON = "HUDSON";
var MK_ABA_HYPER = "HYPERFLOW";
var MK_ABA_ENVIOS = "ENVIOS PORTAL";
var MK_ABA_SITE = "Site";
var MK_TIPOS = ["CLIENTE", "CORRETOR", "RESPONDEU E PAROU", "SEM RESPOSTA", "SEM CONVERSA"];
var MK_HYPER_CAB = ["TELEFONE", "NOME", "TIPO", "ETAPA", "COMPLETO", "FONTE", "ATUALIZADO EM", "POR"];
var MK_ENVIOS_CAB = ["CHAVE", "ORIGEM", "NOME", "TELEFONE", "DESTINO", "ENVIADO EM", "ENVIADO POR"];
var MK_CACHE_LEADS = "mk_leads_v3";
var MK_ABA_CLIENTES = "LEADS CLIENTES";
/* nome do portal → como a LEADS CLIENTES escreve a imobiliária */
var MK_CURTO = { "JESSICA": "JESSICA", "LUXURY IMÓVEIS": "LUXURY", "MY BROKER CANEDO": "MY BROKER CANEDO", "GERLIANE": "GERLIANE" };
function mkDoCurto_(x) {
  var n = mkNorm_(x); if (!n) return "";
  for (var i = 0; i < MK_CORRETORES.length; i++) {
    var c = MK_CORRETORES[i]; var curto = mkNorm_(MK_CURTO[c.nome] || c.nome);
    if (n === mkNorm_(c.nome) || n === curto || n.indexOf(curto) === 0) return c.nome;
  }
  return "";
}

/* ===================== ROTEADOR ===================== */
function mkRotear_(action, sess, p) {
  if (String(action || "").indexOf("mk") !== 0) return null;
  p = p || {};
  if (action === "mkVersao") return mkVersao_();
  if (!sess || !sess.u) return { ok: false, erro: "NAO_AUTORIZADO" };
  if (!mkPode_(sess)) return { ok: false, erro: "SEM_PERMISSAO" };
  var grava = { mkClassificar: 1, mkClassImport: 1, mkEnviar: 1, mkHudson: 1, mkDesfazer: 1 };
  if (grava[action] && mkTipo_(sess) === "TESTES") return { ok: false, erro: "MODO_TESTE" };
  try {
    switch (action) {
      case "mkCampanhas":   return mkCampanhas_();
      case "mkClassificar": return mkClassificar_(sess, p);
      case "mkClassImport": return mkAdm_(sess) ? mkClassImport_(sess, p) : { ok: false, erro: "APENAS_ADM" };
      case "mkLeads":       return mkLeads_(!!p.forcar);
      case "mkEnviar":      return mkEnviar_(sess, p);
      case "mkHudson":      return mkHudson_(sess, p);
      case "mkDesfazer":    return mkAdm_(sess) ? mkDesfazer_(sess, p) : { ok: false, erro: "APENAS_ADM" };
    }
    return { ok: false, erro: "ACAO_DESCONHECIDA: " + action };
  } catch (e) {
    console.error("mk " + action + ": " + (e && e.stack || e));
    return { ok: false, erro: "ERRO_MK: " + (e && e.message || e) };
  }
}

/* ===================== utilidades ===================== */
function mkTipo_(sess) { return String(sess.t || "").toUpperCase(); }
function mkAdm_(sess) { var t = mkTipo_(sess); return t === "ADM" || t === "MASTER"; }
function mkNorm_(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}
function mkPode_(sess) {
  var t = mkTipo_(sess);
  if (t === "ADM" || t === "MASTER" || t === "TESTES") return true;
  var alvo = mkNorm_(MK_ACESSO);
  return (sess.a || []).some(function (a) { return mkNorm_(a) === alvo; });
}
function mkProp_(n) {
  var v = PropertiesService.getScriptProperties().getProperty(n);
  return (v && v.trim()) || MK_PADRAO[n];
}
function mkLogin_(sess) { return String(sess.n || sess.p || sess.u || ""); }
/* chave do telefone: DDD + 8 últimos dígitos (o 9º dígito some) — mesma da HyperFlow */
/* 25/11: "sem retorno", "aguardando retorno" ou vazio na RETORNO e na ATUALIZAÇÃO = a imobiliária não deu retorno */
function mkTemRetorno_(ret, atu) {
  var vazio = function (x) {
    x = mkTxt_(x).replace(/\s+/g, " ").trim();
    return !x || /^[-–.\s]*$/.test(x) || /^(cliente\s+)?(ainda\s+)?(sem retorno|aguardando retorno)(\s+do mesmo)?\.?$/i.test(x);
  };
  return !(vazio(ret) && vazio(atu));
}
function mkChaveTel_(t) {
  var d = String(t == null ? "" : t).replace(/\D/g, "");
  if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
  if (d.length < 10) return "";
  return d.slice(0, 2) + d.slice(-8);
}
function mkTelBonito_(t) {
  var d = String(t == null ? "" : t).replace(/\D/g, "");
  if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
  if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  return String(t || "");
}
function mkIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, MK_FUSO, "yyyy-MM-dd'T'HH:mm");
  var s = String(v == null ? "" : v).trim();
  var m = s.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::\d\d)?([-+]\d\d:?\d\d|Z)?/);
  if (m) {
    if (m[6]) { var d = new Date(s); if (!isNaN(d)) return Utilities.formatDate(d, MK_FUSO, "yyyy-MM-dd'T'HH:mm"); }
    return m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5];
  }
  m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})(?:\s+(\d\d):(\d\d))?/);
  if (m) return m[3] + "-" + m[2] + "-" + m[1] + "T" + (m[4] || "00") + ":" + (m[5] || "00");
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);   // "19/10" das planilhas das imobiliárias
  if (m) return Utilities.formatDate(new Date(), MK_FUSO, "yyyy") + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2) + "T00:00";
  return "";
}
function mkAgora_() { return Utilities.formatDate(new Date(), MK_FUSO, "yyyy-MM-dd'T'HH:mm"); }
function mkCol_(cab, nomes) {
  var n = cab.map(mkNorm_);
  for (var i = 0; i < nomes.length; i++) {
    var alvo = mkNorm_(nomes[i]);
    var j = n.indexOf(alvo); if (j >= 0) return j;
  }
  for (var k = 0; k < nomes.length; k++) {
    var a = mkNorm_(nomes[k]);
    for (var c = 0; c < n.length; c++) if (n[c] && n[c].indexOf(a) === 0) return c;
  }
  return -1;
}
function mkAbaOuCria_(ss, nome, cab) {
  var sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome, ss.getNumSheets());
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}
function mkValores_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  return sh.getRange(1, 1, lr, lc).getValues();
}
function mkTxt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, MK_FUSO, "dd/MM/yyyy HH:mm");
  return String(v == null ? "" : v).trim();
}

/* ===================== versão ===================== */
function mkVersao_() {
  var r = { ok: true, versao: MK_VERSAO, planilhas: {} };
  var lista = [["marketing", mkProp_("MK_PLANILHA_MARKETING")], ["atendimentos", mkProp_("MK_PLANILHA_ATENDIMENTOS")]]
    .concat(MK_CORRETORES.map(function (c) { return [c.nome, c.id]; }));
  lista.forEach(function (x) {
    try { r.planilhas[x[0]] = SpreadsheetApp.openById(x[1]).getName(); }
    catch (e) { r.planilhas[x[0]] = "SEM ACESSO: " + (e && e.message || e); r.ok = false; }
  });
  return r;
}

/* ===================== CLASSIFICAÇÃO (aba HYPERFLOW) ===================== */
function mkHyperMapa_(ss) {
  var sh = ss.getSheetByName(MK_ABA_HYPER), mapa = {};
  if (!sh) return mapa;
  var v = mkValores_(sh); if (v.length < 2) return mapa;
  var cab = v[0].map(String);
  var iT = mkCol_(cab, ["TELEFONE"]), iN = mkCol_(cab, ["NOME"]), iTi = mkCol_(cab, ["TIPO"]), iE = mkCol_(cab, ["ETAPA"]),
      iC = mkCol_(cab, ["COMPLETO"]), iF = mkCol_(cab, ["FONTE"]), iA = mkCol_(cab, ["ATUALIZADO EM"]), iP = mkCol_(cab, ["POR"]);
  for (var r = 1; r < v.length; r++) {
    var k = mkChaveTel_(v[r][iT]); if (!k) continue;
    mapa[k] = {
      linha: r + 1, tipo: mkNorm_(v[r][iTi]), etapa: mkTxt_(v[r][iE]), completo: mkNorm_(v[r][iC]) === "SIM",
      fonte: mkTxt_(v[r][iF]), at: mkIso_(v[r][iA]), por: iP >= 0 ? mkTxt_(v[r][iP]) : "", nome: mkTxt_(v[r][iN])
    };
  }
  return mapa;
}
function mkGravarHyper_(ss, itens, sess) {
  var sh = mkAbaOuCria_(ss, MK_ABA_HYPER, MK_HYPER_CAB);
  try { if (sh.getIndex() < ss.getNumSheets()) { var at = ss.getActiveSheet(); ss.setActiveSheet(sh); ss.moveActiveSheet(ss.getNumSheets()); if (at) ss.setActiveSheet(at); } } catch (e) {}
  var mapa = mkHyperMapa_(ss), novas = [], n = 0;
  itens.forEach(function (it) {
    var k = mkChaveTel_(it.k || it.telefone); if (!k) return;
    var tipo = mkNorm_(it.tipo);
    if (MK_TIPOS.indexOf(tipo) < 0) return;
    var linha = [k, it.nome || "", tipo, it.etapa || "", it.completo ? "SIM" : "NÃO", it.fonte || "MANUAL", it.at || mkAgora_(), sess ? mkLogin_(sess) : (it.por || "")];
    if (mapa[k]) { sh.getRange(mapa[k].linha, 1, 1, linha.length).setValues([linha]); }
    else { novas.push(linha); mapa[k] = { linha: -1 }; }
    n++;
  });
  if (novas.length) sh.getRange(sh.getLastRow() + 1, 1, novas.length, MK_HYPER_CAB.length).setValues(novas);
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).setNumberFormat("@");
  return n;
}
function mkClassificar_(sess, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
    var n = mkGravarHyper_(ss, [{ k: p.k, nome: p.nome, tipo: p.tipo, etapa: p.etapa || "Corrigido no portal", completo: !!p.completo, fonte: "MANUAL" }], sess);
    return n ? { ok: true } : { ok: false, erro: "TIPO_INVALIDO" };
  } finally { lock.releaseLock(); }
}
function mkClassImport_(sess, p) {
  var itens = p.itens || [];
  if (!itens.length) return { ok: false, erro: "SEM_ITENS" };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
    var mapa = mkHyperMapa_(ss);
    /* correção manual nunca é sobrescrita pela leitura automática */
    var filtrados = itens.filter(function (it) { var k = mkChaveTel_(it.k); return k && !(mapa[k] && mapa[k].fonte === "MANUAL"); });
    var n = mkGravarHyper_(ss, filtrados, sess);
    return { ok: true, gravados: n, ignoradosManuais: itens.length - filtrados.length };
  } finally { lock.releaseLock(); }
}

/* ===================== CAMPANHAS ===================== */
function mkCampanhas_() {
  var ss = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
  var hyper = mkHyperMapa_(ss);
  var atend = {};
  try {
    var va = mkValores_(SpreadsheetApp.openById(mkProp_("MK_PLANILHA_ATENDIMENTOS")).getSheets()[0]);
    if (va.length) {
      var iw = mkColTelefone_(va);
      for (var r = 1; r < va.length; r++) { var k = mkChaveTel_(va[r][iw]); if (k) atend[k] = mkIso_(va[r][0]); }
    }
  } catch (e) { console.warn("mkCampanhas: ATENDIMENTOS " + e); }

  var envio = {}, envLinhas = 0, envSemTel = 0;
  MK_CORRETORES.forEach(function (c) {
    try { mkLerCorretor_(c).linhas.forEach(function (l) { envLinhas++; if (!l.k) { envSemTel++; return; } if (!envio[l.k]) envio[l.k] = { d: c.nome, r: l.tem ? 1 : 0 }; }); }
    catch (e) { console.warn("mkCampanhas: " + c.nome + " " + e); }
  });
  var abas = [];
  ss.getSheets().forEach(function (sh, idx) {
    var nome = sh.getName();
    if (idx === 0 || nome === MK_ABA_HYPER || nome === MK_ABA_SITE || nome === MK_ABA_CLIENTES) return;   // Página1 = campanha antiga
    var v = mkValores_(sh); if (v.length < 2) return;
    var cab = v[0].map(String);
    var iAd = mkCol_(cab, ["ad_name"]), iSet = mkCol_(cab, ["adset_name"]);
    if (iAd < 0 || iSet < 0) return;
    var iId = mkCol_(cab, ["id"]), iT = mkCol_(cab, ["created_time"]), iCamp = mkCol_(cab, ["campaign_name"]),
        iForm = mkCol_(cab, ["form_name"]), iSt = mkCol_(cab, ["lead_status"]), iNome = mkCol_(cab, ["nome", "full_name"]),
        iTel = mkCol_(cab, ["telefone", "phone_number"]), iMail = mkCol_(cab, ["email"]), iPlat = mkCol_(cab, ["platform"]);
    var leads = [];
    for (var r = 1; r < v.length; r++) {
      var row = v[r];
      if (!mkTxt_(row[iId]) && !mkTxt_(row[iTel])) continue;
      var k = mkChaveTel_(row[iTel]);
      var h = k ? hyper[k] : null, cls, etapa = "", fonte = "", completo = false;
      if (h) { cls = h.tipo; etapa = h.etapa; fonte = h.fonte; completo = h.completo; }
      else if (k && atend[k]) { cls = "CLIENTE"; etapa = "Gravado na planilha de atendimentos"; fonte = "ATENDIMENTOS"; completo = true; }
      else cls = "";
      var sem = function (x) { x = mkTxt_(x); return /permiss[aã]o suficiente/i.test(x) ? "(sem permissão na Meta)" : (x || "(sem nome)"); };
      leads.push({
        id: mkTxt_(row[iId]), t: mkIso_(row[iT]), ad: sem(row[iAd]), adset: sem(row[iSet]),
        camp: iCamp >= 0 ? sem(row[iCamp]) : "", form: iForm >= 0 ? mkTxt_(row[iForm]) : "",
        st: iSt >= 0 ? mkTxt_(row[iSt]) : "", nome: iNome >= 0 ? mkTxt_(row[iNome]) : "",
        tel: mkTelBonito_(row[iTel]), k: k, email: iMail >= 0 ? mkTxt_(row[iMail]) : "", plat: iPlat >= 0 ? mkTxt_(row[iPlat]) : "",
        cls: cls, etapa: etapa, fonte: fonte, completo: completo,
        atend: !!(k && atend[k]), env: k && envio[k] ? envio[k].d : "", ret: k && envio[k] ? envio[k].r : 0
      });
    }
    abas.push({ nome: nome, gid: sh.getSheetId(), leads: leads });
  });
  var ult = ""; Object.keys(hyper).forEach(function (k) { if ((hyper[k].at || "") > ult && hyper[k].fonte !== "MANUAL") ult = hyper[k].at; });
  var robo = null; try { robo = JSON.parse(PropertiesService.getScriptProperties().getProperty("MK_ROBO_ULTIMA") || "null"); } catch (e) {}
  var envTot = Object.keys(envio).length, envRet = 0; Object.keys(envio).forEach(function (k) { if (envio[k].r) envRet++; });
  return { ok: true, versao: MK_VERSAO, geradoEm: mkAgora_(), planilha: ss.getUrl(), abas: abas, hyperAtualizado: ult, robo: robo,
    envio: { clientes: envTot, comRetorno: envRet, linhas: envLinhas, semTelefone: envSemTel } };
}
function mkColTelefone_(v) {
  var cab = v[0].map(String);
  var i = mkCol_(cab, ["WhatsApp", "Telefone"]);
  if (i >= 0) return i;
  /* cabeçalho vazio: a coluna com mais telefones nas primeiras linhas */
  var melhor = -1, max = 0;
  for (var c = 0; c < cab.length; c++) {
    var n = 0; for (var r = 1; r < Math.min(v.length, 15); r++) if (/^\+?\d[\d\s().-]{9,}$/.test(String(v[r][c]).trim())) n++;
    if (n > max) { max = n; melhor = c; }
  }
  return melhor;
}

/* ===================== REDIRECIONAMENTO ===================== */
/* planilhas das imobiliárias: acha a linha de cabeçalho (a que tem CLIENTE) */
function mkLerCorretor_(c) {
  var sh = SpreadsheetApp.openById(c.id).getSheets()[0];
  var v = mkValores_(sh), h = -1;
  for (var r = 0; r < Math.min(v.length, 10); r++) if (v[r].map(mkNorm_).indexOf("CLIENTE") >= 0) { h = r; break; }
  if (h < 0) return { sh: sh, cab: [], linhas: [], h: -1 };
  var cab = v[h].map(String);
  var ix = {
    data: mkCol_(cab, ["DATA"]), cli: mkCol_(cab, ["CLIENTE"]), tel: mkCol_(cab, ["TELEFONE", "WHATSAPP"]), mail: mkCol_(cab, ["EMAIL", "E-MAIL"]),
    obs: mkCol_(cab, ["OBSERVAÇÕES", "OBSERVACAO", "OBSERVAÇÃO"]), ret: mkCol_(cab, ["RETORNO DA IMOBILIÁRIA", "RETORNO"]), atu: mkCol_(cab, ["ATUALIZAÇÃO", "ATUALIZACAO"])
  };
  if (ix.tel < 0 && ix.cli >= 0) ix.tel = ix.cli + 1;        // planilha da Jessica: telefone sem título, logo depois do cliente
  if (ix.data < 0 && ix.cli > 0) ix.data = ix.cli - 1;       // as outras: DATA sem título na coluna A
  var linhas = [];
  for (var i = h + 1; i < v.length; i++) {
    var k = mkChaveTel_(v[i][ix.tel]);
    if (!k && !mkTxt_(v[i][ix.cli])) continue;
    var ret = ix.ret >= 0 ? mkTxt_(v[i][ix.ret]) : "", atu = ix.atu >= 0 ? mkTxt_(v[i][ix.atu]) : "";
    linhas.push({ linha: i + 1, k: k, ret: ret, atu: atu, tem: mkTemRetorno_(ret, atu) });
  }
  return { sh: sh, cab: cab, ix: ix, h: h, linhas: linhas };
}
function mkEnviosMapa_(ssA) {
  var sh = ssA.getSheetByName(MK_ABA_ENVIOS), m = {};
  if (!sh) return m;
  var v = mkValores_(sh);
  for (var r = 1; r < v.length; r++) {
    var ch = mkTxt_(v[r][0]); if (!ch) continue;
    m[ch] = { linha: r + 1, origem: mkTxt_(v[r][1]), destino: mkTxt_(v[r][4]), em: mkIso_(v[r][5]), por: mkTxt_(v[r][6]) };
  }
  return m;
}
/* linhas da planilha ATENDIMENTOS: A Data/hora · B Origem · C Nome · D Consentimento · E WhatsApp · F E-mail ·
   G Faixa de renda · H Profissão · I Preferência · J Informações (fora) · K MANDOU PRA TABELA DE CORRETORES? · L (fora) */
function mkAtendimentos_(ssA) {
  var sh = ssA.getSheets()[0];
  var v = mkValores_(sh); if (v.length < 2) return { sh: sh, itens: [] };
  var cab = v[0].map(String);
  var ix = {
    data: mkCol_(cab, ["Data/hora", "Data"]), origem: mkCol_(cab, ["Origem"]), nome: mkCol_(cab, ["Nome"]), cons: mkCol_(cab, ["Consentimento"]),
    tel: mkColTelefone_(v), mail: mkCol_(cab, ["E-mail", "Email"]), renda: mkCol_(cab, ["Faixa de renda", "Renda"]),
    prof: mkCol_(cab, ["Profissão", "Profissao"]), pref: mkCol_(cab, ["Preferência de contato", "Preferencia"]),
    mandou: mkCol_(cab, ["MANDOU PRA TABELA DE CORRETORES"])
  };
  if (ix.data < 0) ix.data = 0;
  if (ix.mandou < 0) ix.mandou = 10;                           // coluna K
  var itens = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r], k = mkChaveTel_(row[ix.tel]);
    if (!k && !mkTxt_(row[ix.nome])) continue;
    var t = mkIso_(row[ix.data]);
    itens.push({
      chave: "A:" + k + ":" + t, tipo: "corretor", linha: r + 1, t: t,
      origem: mkTxt_(row[ix.origem]) || "HyperFlow", nome: mkTxt_(row[ix.nome]), cons: ix.cons >= 0 ? mkTxt_(row[ix.cons]) : "",
      tel: mkTelBonito_(row[ix.tel]), telCru: String(row[ix.tel] || "").replace(/\D/g, ""), k: k, email: ix.mail >= 0 ? mkTxt_(row[ix.mail]) : "",
      renda: ix.renda >= 0 ? mkTxt_(row[ix.renda]) : "", prof: ix.prof >= 0 ? mkTxt_(row[ix.prof]) : "", pref: ix.pref >= 0 ? mkTxt_(row[ix.pref]) : "",
      mandou: mkTxt_(row[ix.mandou])
    });
  }
  return { sh: sh, ix: ix, itens: itens };
}
/* aba Site da planilha de marketing: Data/hora · Origem · Nome · WhatsApp · E-mail · Objetivo · Entrada · Parcela · Página */
function mkSite_(ssM) {
  var sh = ssM.getSheetByName(MK_ABA_SITE); if (!sh) return [];
  var v = mkValores_(sh); if (v.length < 2) return [];
  var cab = v[0].map(String), ini = mkProp_("MK_SITE_INICIO");
  var ix = {
    data: mkCol_(cab, ["Data/hora", "Data"]), origem: mkCol_(cab, ["Origem"]), nome: mkCol_(cab, ["Nome"]), tel: mkColTelefone_(v),
    mail: mkCol_(cab, ["E-mail", "Email"]), obj: mkCol_(cab, ["Objetivo"]), ent: mkCol_(cab, ["Entrada"]), parc: mkCol_(cab, ["Parcela"])
  };
  var itens = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r], k = mkChaveTel_(row[ix.tel]), t = mkIso_(row[ix.data]);
    if ((!k && !mkTxt_(row[ix.nome])) || !t || t.slice(0, 10) < ini) continue;
    itens.push({
      chave: "S:" + k + ":" + t, tipo: "hudson", linha: r + 1, t: t, origem: "Site · " + (mkTxt_(row[ix.origem]) || "formulário"),
      nome: mkTxt_(row[ix.nome]), tel: mkTelBonito_(row[ix.tel]), telCru: String(row[ix.tel] || "").replace(/\D/g, ""), k: k,
      email: ix.mail >= 0 ? mkTxt_(row[ix.mail]) : "", objetivo: ix.obj >= 0 ? mkTxt_(row[ix.obj]) : "",
      entrada: ix.ent >= 0 ? mkTxt_(row[ix.ent]) : "", parcela: ix.parc >= 0 ? mkTxt_(row[ix.parc]) : ""
    });
  }
  return itens;
}
function mkLeads_(forcar) {
  var cache = CacheService.getScriptCache();
  if (!forcar) { var c = cache.get(MK_CACHE_LEADS); if (c) { var o = JSON.parse(c); o.cache = true; return o; } }
  var ssA = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_ATENDIMENTOS"));
  var ssM = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
  var at = mkAtendimentos_(ssA), site = mkSite_(ssM), envios = mkEnviosMapa_(ssA);
  var lc = {}; try { lc = mkClientesMapa_(ssM).porK; } catch (e) { console.warn("mkLeads: LEADS CLIENTES " + e); }
  /* onde cada telefone está nas planilhas das imobiliárias */
  var achado = {}, erros = [];
  MK_CORRETORES.forEach(function (c) {
    try {
      mkLerCorretor_(c).linhas.forEach(function (l) { if (l.k && !achado[l.k]) achado[l.k] = { destino: c.nome, ret: l.ret, atu: l.atu, linha: l.linha, tem: l.tem }; });
    } catch (e) { erros.push(c.nome + ": " + (e && e.message || e)); }
  });
  var agora = new Date().getTime();
  var itens = at.itens.concat(site).map(function (it) {
    var e = envios[it.chave], na = it.k ? achado[it.k] : null;
    it.enviado = !!(e || (it.tipo === "corretor" && (na || /^SIM/i.test(it.mandou || ""))));
    it.destino = e ? e.destino : (na ? na.destino : "");
    it.enviadoEm = e ? e.em : "";
    it.enviadoPor = e ? e.por : "";
    it.foraDoPortal = it.enviado && !e;
    if (na && it.tipo === "corretor") { it.retorno = na.ret; it.atualizacao = na.atu; it.linhaDestino = na.linha; it.temRetorno = na.tem; }
    if (it.tipo === "corretor" && it.k && lc[it.k]) { it.sugestao = mkDoCurto_(lc[it.k].imob); it.linhaClientes = lc[it.k].linha; }
    if (it.tipo === "corretor" && it.enviado && !it.temRetorno) {
      var base = it.enviadoEm || it.t;
      var d = base ? new Date(base.replace("T", " ").replace(/-/g, "/")).getTime() : 0;
      it.semRetornoHoras = d ? Math.max(0, Math.round((agora - d) / 3600000)) : null;
    }
    return it;
  }).sort(function (a, b) { return (b.t || "").localeCompare(a.t || ""); });
  var out = {
    ok: true, versao: MK_VERSAO, geradoEm: mkAgora_(), itens: itens,
    corretores: MK_CORRETORES.map(function (c) { return { nome: c.nome, url: "https://docs.google.com/spreadsheets/d/" + c.id + "/edit" }; }),
    planilhaAtendimentos: ssA.getUrl(), planilhaMarketing: ssM.getUrl(),
    gidClientes: (function () { try { return ssM.getSheetByName(MK_ABA_CLIENTES).getSheetId(); } catch (e) { return null; } })(), erros: erros
  };
  try { var s = JSON.stringify(out); if (s.length < 95000) cache.put(MK_CACHE_LEADS, s, 60); } catch (e) {}
  return out;
}
function mkLimparCache_() { try { CacheService.getScriptCache().remove(MK_CACHE_LEADS); } catch (e) {} }
function mkRegistrar_(ssA, it, destino, sess) {
  var sh = mkAbaOuCria_(ssA, MK_ABA_ENVIOS, MK_ENVIOS_CAB);
  sh.appendRow([it.chave, it.origem, it.nome, it.tel, destino, mkAgora_().replace("T", " "), mkLogin_(sess)]);
}
function mkAcharItem_(ssA, ssM, chave) {
  var lista = chave.indexOf("S:") === 0 ? mkSite_(ssM) : mkAtendimentos_(ssA).itens;
  for (var i = 0; i < lista.length; i++) if (lista[i].chave === chave) return lista[i];
  return null;
}
function mkEnviar_(sess, p) {
  var destino = MK_CORRETORES.filter(function (c) { return c.nome === p.destino; })[0];
  if (!destino) return { ok: false, erro: "DESTINO_INVALIDO" };
  if (String(p.chave || "").indexOf("A:") !== 0) return { ok: false, erro: "SO_ATENDIMENTOS" };   // lead do site só vai para o Hudson
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ssA = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_ATENDIMENTOS"));
    var at = mkAtendimentos_(ssA);
    var it = at.itens.filter(function (x) { return x.chave === p.chave; })[0];
    if (!it) return { ok: false, erro: "LEAD_NAO_ENCONTRADO" };
    var envios = mkEnviosMapa_(ssA);
    if (envios[it.chave] && !p.reenviar) return { ok: false, erro: "JA_ENVIADO: " + envios[it.chave].destino };
    var c = mkLerCorretor_(destino);
    if (c.h < 0) return { ok: false, erro: "PLANILHA_SEM_CABECALHO: " + destino.nome };
    if (!p.reenviar && it.k && c.linhas.some(function (l) { return l.k === it.k; })) return { ok: false, erro: "JA_ESTA_NA_PLANILHA: " + destino.nome };
    var linha = []; for (var i = 0; i < c.cab.length; i++) linha.push("");
    var dt = it.t ? new Date(it.t.slice(0, 10).replace(/-/g, "/")) : new Date();
    var obs = [it.renda, it.prof, it.pref].filter(function (x) { return x; }).join(" , ");
    if (c.ix.data >= 0) linha[c.ix.data] = dt;
    if (c.ix.cli >= 0) linha[c.ix.cli] = it.nome;
    if (c.ix.tel >= 0) linha[c.ix.tel] = "'" + (it.telCru || it.tel);
    if (c.ix.mail >= 0) linha[c.ix.mail] = it.email;
    if (c.ix.obs >= 0) linha[c.ix.obs] = obs;
    /* escreve logo depois da última linha com cliente (não depois de linhas só formatadas) */
    var ultima = c.linhas.length ? c.linhas[c.linhas.length - 1].linha : c.h + 1;
    var alvo = ultima + 1;
    if (alvo > c.sh.getMaxRows()) c.sh.insertRowsAfter(c.sh.getMaxRows(), 5);
    var vazio = c.sh.getRange(alvo, 1, 1, linha.length).getValues()[0].every(function (x) { return String(x).trim() === ""; });
    if (!vazio) { c.sh.insertRowAfter(ultima); }
    c.sh.getRange(alvo, 1, 1, linha.length).setValues([linha]);
    if (c.ix.data >= 0) c.sh.getRange(alvo, c.ix.data + 1).setNumberFormat("dd/MM");
    at.sh.getRange(it.linha, at.ix.mandou + 1).setValue("SIM");
    try { mkClientesMarcar_(SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING")), it, destino.nome); } catch (e) { console.warn("mkEnviar: LEADS CLIENTES " + e); }
    if (!envios[it.chave]) mkRegistrar_(ssA, it, destino.nome, sess);
    else mkAbaOuCria_(ssA, MK_ABA_ENVIOS, MK_ENVIOS_CAB).getRange(envios[it.chave].linha, 5, 1, 3).setValues([[destino.nome, mkAgora_().replace("T", " "), mkLogin_(sess)]]);
    mkLimparCache_();
    return { ok: true, destino: destino.nome, linha: alvo };
  } finally { lock.releaseLock(); }
}
function mkHudson_(sess, p) {
  var chaves = (p.chaves || (p.chave ? [p.chave] : [])).filter(function (c) { return c; });
  if (!chaves.length) return { ok: false, erro: "SEM_ITENS" };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ssA = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_ATENDIMENTOS"));
    var ssM = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
    var envios = mkEnviosMapa_(ssA), site = mkSite_(ssM), por = {};
    site.forEach(function (s) { por[s.chave] = s; });
    var n = 0, falta = [];
    chaves.forEach(function (ch) {
      if (envios[ch]) return;
      var it = por[ch];
      if (!it) { falta.push(ch); return; }
      mkRegistrar_(ssA, it, MK_HUDSON, sess); n++;
    });
    mkLimparCache_();
    return { ok: true, confirmados: n, naoEncontrados: falta };
  } finally { lock.releaseLock(); }
}
function mkDesfazer_(sess, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ssA = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_ATENDIMENTOS"));
    var envios = mkEnviosMapa_(ssA), e = envios[p.chave];
    if (!e) return { ok: false, erro: "SEM_REGISTRO" };
    ssA.getSheetByName(MK_ABA_ENVIOS).deleteRow(e.linha);
    mkLimparCache_();
    return { ok: true, avisoPlanilha: e.destino !== MK_HUDSON ? "A linha continua na planilha " + e.destino + " — apague lá se precisar." : "" };
  } finally { lock.releaseLock(); }
}

/* Rodar pelo menu Executar: confere se a conta do script abre as 6 planilhas (e pede a autorização de Planilhas na 1ª vez). */
function mkTestarAcesso() { console.log(JSON.stringify(mkVersao_(), null, 1)); }

/* ===================== LEADS CLIENTES (mk2) ===================== */
/* A aba LEADS CLIENTES da planilha de marketing: linhas 1–4 = legenda das planilhas, linha com CLIENTE =
   cabeçalho (DATA sem título na coluna A · CLIENTE · TELEFONE · EMAIL · OBSERVAÇÕES · IMOBILIÁRIA ·
   HUDSON TRANSPÔS PRA OUTRA PLANILHA?). Abaixo dos clientes as linhas já têm a IMOBILIÁRIA do rodízio. */
function mkClientesMapa_(ssM) {
  var sh = ssM.getSheetByName(MK_ABA_CLIENTES);
  if (!sh) throw new Error("aba " + MK_ABA_CLIENTES + " não existe");
  var v = mkValores_(sh), h = -1;
  for (var r = 0; r < Math.min(v.length, 12); r++) if (v[r].map(mkNorm_).indexOf("CLIENTE") >= 0) { h = r; break; }
  if (h < 0) throw new Error("cabeçalho CLIENTE não achado na " + MK_ABA_CLIENTES);
  var cab = v[h].map(String);
  var ix = { cli: mkCol_(cab, ["CLIENTE"]), tel: mkCol_(cab, ["TELEFONE"]), mail: mkCol_(cab, ["EMAIL", "E-MAIL"]),
             obs: mkCol_(cab, ["OBSERVAÇÕES", "OBSERVACOES"]), imob: mkCol_(cab, ["IMOBILIÁRIA", "IMOBILIARIA"]),
             hud: mkCol_(cab, ["HUDSON TRANSP"]) };
  ix.data = ix.cli > 0 ? ix.cli - 1 : -1;
  var porK = {}, ultima = h + 1, linhas = [];
  for (var i = h + 1; i < v.length; i++) {
    if (!mkTxt_(v[i][ix.cli]) && !mkTxt_(v[i][ix.tel])) continue;
    ultima = i + 1;
    var k = mkChaveTel_(v[i][ix.tel]);
    linhas.push({ linha: i + 1, k: k, imob: ix.imob >= 0 ? mkTxt_(v[i][ix.imob]) : "", hud: ix.hud >= 0 ? mkTxt_(v[i][ix.hud]) : "" });
    if (k && !porK[k]) porK[k] = { linha: i + 1, imob: ix.imob >= 0 ? mkTxt_(v[i][ix.imob]) : "", hud: ix.hud >= 0 ? mkTxt_(v[i][ix.hud]) : "" };
  }
  return { sh: sh, ix: ix, h: h, porK: porK, ultima: ultima, largura: cab.length, linhas: linhas };
}
/* copia para a LEADS CLIENTES os atendimentos que ainda não estão lá (mais antigos primeiro) */
function mkSincClientes_() {
  var ssA = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_ATENDIMENTOS"));
  var ssM = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
  var m = mkClientesMapa_(ssM), at = mkAtendimentos_(ssA).itens.slice();
  at.sort(function (a, b) { return (a.t || "").localeCompare(b.t || ""); });
  var achado = {};
  MK_CORRETORES.forEach(function (c) {
    try { mkLerCorretor_(c).linhas.forEach(function (l) { if (l.k && !achado[l.k]) achado[l.k] = c.nome; }); } catch (e) {}
  });
  var envios = mkEnviosMapa_(ssA), novos = 0, linha = m.ultima;
  at.forEach(function (it) {
    if (!it.k || m.porK[it.k]) return;
    linha++;
    var dt = it.t ? new Date(it.t.slice(0, 10).replace(/-/g, "/")) : new Date();
    var obs = [it.renda, it.prof, it.pref].filter(function (x) { return x; }).join(" , ");
    var c = m.ix.cli + 1;
    if (m.ix.data >= 0) m.sh.getRange(linha, m.ix.data + 1).setValue(dt).setNumberFormat("dd/MM");
    m.sh.getRange(linha, c).setValue(it.nome);
    if (m.ix.tel >= 0) m.sh.getRange(linha, m.ix.tel + 1).setValue("'" + (it.telCru || it.tel));
    if (m.ix.mail >= 0) m.sh.getRange(linha, m.ix.mail + 1).setValue(it.email || "");
    if (m.ix.obs >= 0) m.sh.getRange(linha, m.ix.obs + 1).setValue(obs);
    var destino = (envios[it.chave] && envios[it.chave].destino !== MK_HUDSON ? envios[it.chave].destino : "") || achado[it.k] || "";
    if (destino) {
      if (m.ix.imob >= 0) m.sh.getRange(linha, m.ix.imob + 1).setValue(MK_CURTO[destino] || destino);
      if (m.ix.hud >= 0) m.sh.getRange(linha, m.ix.hud + 1).setValue("SIM");
    } else if (m.ix.hud >= 0) {
      m.sh.getRange(linha, m.ix.hud + 1).setValue(/^SIM/i.test(it.mandou || "") ? "SIM" : "NÃO");
    }
    m.porK[it.k] = { linha: linha };
    novos++;
  });
  /* mk3 (25/11): linha sem HUDSON TRANSPÔS ganha SIM (está na planilha de uma imobiliária, com o nome dela na
     IMOBILIÁRIA) ou NÃO (ainda não foi enviada) */
  var mandouK = {}; at.forEach(function (it) { if (it.k && /^SIM/i.test(it.mandou || "")) mandouK[it.k] = 1; });
  var marcados = 0;
  if (m.ix.hud >= 0) m.linhas.forEach(function (l) {
    if (l.hud) return;
    var d = l.k ? achado[l.k] : "";
    if (d) {
      if (m.ix.imob >= 0 && !l.imob) m.sh.getRange(l.linha, m.ix.imob + 1).setValue(MK_CURTO[d] || d);
      m.sh.getRange(l.linha, m.ix.hud + 1).setValue("SIM");
    } else m.sh.getRange(l.linha, m.ix.hud + 1).setValue(l.k && mandouK[l.k] ? "SIM" : "NÃO");
    marcados++;
  });
  if (novos || marcados) mkLimparCache_();
  return { ok: true, novos: novos, marcados: marcados };
}
function mkClientesMarcar_(ssM, it, destino) {
  var m = mkClientesMapa_(ssM), r = it.k ? m.porK[it.k] : null;
  if (!r) { mkSincClientes_(); m = mkClientesMapa_(ssM); r = it.k ? m.porK[it.k] : null; }
  if (!r) return;
  if (m.ix.imob >= 0) m.sh.getRange(r.linha, m.ix.imob + 1).setValue(MK_CURTO[destino] || destino);
  if (m.ix.hud >= 0) m.sh.getRange(r.linha, m.ix.hud + 1).setValue("SIM");
}
/* acionador de tempo (10 min): rodar mkLigarAcionador UMA vez pelo menu Executar */
function mkAcionadorClientes() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return;
  try { var r = mkSincClientes_(); if (r.novos) console.log("LEADS CLIENTES: " + r.novos + " novo(s)"); }
  catch (e) { console.error("mkAcionadorClientes: " + (e && e.stack || e)); }
  finally { lock.releaseLock(); }
}
function mkLigarAcionador() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "mkAcionadorClientes") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("mkAcionadorClientes").timeBased().everyMinutes(10).create();
  mkAcionadorClientes();
  console.log("acionador ligado (10 em 10 min) e primeira rodada feita");
}

/* ===================== ROBÔ DA HYPERFLOW (servidor) ===================== */
/* Sem login do portal: a chave fica na Propriedade MK_ROBO_CHAVE (rodar mkGerarChaveRobo uma vez
   e copiar a chave do log para o .env do servidor). */
function mkGerarChaveRobo() {
  var pr = PropertiesService.getScriptProperties();
  var k = pr.getProperty("MK_ROBO_CHAVE");
  if (!k) { k = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, ""); pr.setProperty("MK_ROBO_CHAVE", k); }
  console.log("MK_ROBO_CHAVE=" + k);
}
function mkRobo_(p) {
  p = p || {};
  var chave = PropertiesService.getScriptProperties().getProperty("MK_ROBO_CHAVE");
  if (!chave || String(p.chave || "") !== chave) return { ok: false, erro: "CHAVE_ROBO_INVALIDA" };
  try {
    var ssM = SpreadsheetApp.openById(mkProp_("MK_PLANILHA_MARKETING"));
    if (p.op === "leads") {
      var c = mkCampanhas_(), hyper = mkHyperMapa_(ssM), h = {};
      Object.keys(hyper).forEach(function (k) { h[k] = { tipo: hyper[k].tipo, etapa: hyper[k].etapa, fonte: hyper[k].fonte, at: hyper[k].at }; });
      return { ok: true, versao: MK_VERSAO, abas: c.abas.map(function (a) { return { nome: a.nome, leads: a.leads.map(function (l) { return { k: l.k, t: l.t, nome: l.nome }; }) }; }), hyper: h };
    }
    if (p.op === "gravar") {
      var lock = LockService.getScriptLock(); lock.waitLock(30000);
      try {
        var mapa = mkHyperMapa_(ssM);
        var itens = (p.itens || []).filter(function (it) { var k = mkChaveTel_(it.k); return k && !(mapa[k] && mapa[k].fonte === "MANUAL"); })
          .map(function (it) { it.por = "robô HyperFlow"; return it; });
        var n = mkGravarHyper_(ssM, itens, null);
        return { ok: true, gravados: n };
      } finally { lock.releaseLock(); }
    }
    if (p.op === "status") {
      PropertiesService.getScriptProperties().setProperty("MK_ROBO_ULTIMA", JSON.stringify({
        em: mkAgora_(), ok: !!p.ok, msg: String(p.msg || "").slice(0, 300), lidos: p.lidos || 0, gravados: p.gravados || 0 }));
      return { ok: true };
    }
    return { ok: false, erro: "OP_DESCONHECIDA" };
  } catch (e) {
    console.error("mkRobo " + p.op + ": " + (e && e.stack || e));
    return { ok: false, erro: "ERRO_MK: " + (e && e.message || e) };
  }
}
