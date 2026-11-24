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

var MK_VERSAO = "mk1";
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
var MK_CACHE_LEADS = "mk_leads_v1";

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
    sh = ss.insertSheet(nome);
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
  var mapa = mkHyperMapa_(ss), novas = [], n = 0;
  itens.forEach(function (it) {
    var k = mkChaveTel_(it.k || it.telefone); if (!k) return;
    var tipo = mkNorm_(it.tipo);
    if (MK_TIPOS.indexOf(tipo) < 0) return;
    var linha = [k, it.nome || "", tipo, it.etapa || "", it.completo ? "SIM" : "NÃO", it.fonte || "MANUAL", it.at || mkAgora_(), sess ? mkLogin_(sess) : ""];
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

  var abas = [];
  ss.getSheets().forEach(function (sh, idx) {
    if (idx < 2) return;                                   // campanhas = da 3ª aba em diante
    var nome = sh.getName();
    if (nome === MK_ABA_HYPER) return;
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
        cls: cls, etapa: etapa, fonte: fonte, completo: completo
      });
    }
    abas.push({ nome: nome, gid: sh.getSheetId(), leads: leads });
  });
  return { ok: true, versao: MK_VERSAO, geradoEm: mkAgora_(), planilha: ss.getUrl(), abas: abas };
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
    linhas.push({ linha: i + 1, k: k, ret: ix.ret >= 0 ? mkTxt_(v[i][ix.ret]) : "", atu: ix.atu >= 0 ? mkTxt_(v[i][ix.atu]) : "" });
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
  /* onde cada telefone está nas planilhas das imobiliárias */
  var achado = {}, erros = [];
  MK_CORRETORES.forEach(function (c) {
    try {
      mkLerCorretor_(c).linhas.forEach(function (l) { if (l.k && !achado[l.k]) achado[l.k] = { destino: c.nome, ret: l.ret, atu: l.atu, linha: l.linha }; });
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
    if (na && it.tipo === "corretor") { it.retorno = na.ret; it.atualizacao = na.atu; it.linhaDestino = na.linha; }
    if (it.tipo === "corretor" && it.enviado && !it.retorno) {
      var base = it.enviadoEm || it.t;
      var d = base ? new Date(base.replace("T", " ").replace(/-/g, "/")).getTime() : 0;
      it.semRetornoHoras = d ? Math.max(0, Math.round((agora - d) / 3600000)) : null;
    }
    return it;
  }).sort(function (a, b) { return (b.t || "").localeCompare(a.t || ""); });
  var out = {
    ok: true, versao: MK_VERSAO, geradoEm: mkAgora_(), itens: itens,
    corretores: MK_CORRETORES.map(function (c) { return { nome: c.nome, url: "https://docs.google.com/spreadsheets/d/" + c.id + "/edit" }; }),
    planilhaAtendimentos: ssA.getUrl(), erros: erros
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
