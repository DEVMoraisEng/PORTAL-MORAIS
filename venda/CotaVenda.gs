/* COTA GOOGLE — contador diário de UrlFetch deste projeto (PORTAL-VENDA, 01/11/2026).
 * Todos os Apps Script da conta dividem a MESMA cota (~20.000 UrlFetch/dia no
 * Gmail comum). Cópia do contador do portal (RetaFinal.js v19, rfUfConta_),
 * com outro prefixo para não colidir com nada deste projeto.
 *
 * LIGAR: rode cvContadorLigar (grava a Propriedade RF_CONTADOR=1).
 * VER:   rode cvCotaHoje — total do dia DESTE projeto, por hora e quem mais gasta.
 * PLANILHA: com a Propriedade COTA_PLANILHA_ID, no máximo a cada 15 min
 *   (doGet/doPost do PortalVenda.gs, a cada pedido da tela) grava o total do dia numa linha da aba "COTA GOOGLE"
 *   (DIA | PROJETO | CHAMADAS | ATUALIZADO). O nome da linha é PORTAL-VENDA ou a
 *   Propriedade COTA_PROJETO (nos projetos de TESTE, use outro nome). Sem
 *   COTA_PLANILHA_ID nada acontece. SpreadsheetApp não gasta UrlFetch.
 *   Quem soma, avisa por e-mail (70%) e pausa os aquecimentos (85%) é o
 *   PORTAL-LEITURA; este projeto não pausa nada.
 * Depois de subir: rode cvCotaAutorizar UMA vez no editor (libera a planilha).
 *
 * Como conta: troca UrlFetchApp.fetch/fetchAll por uma versão que anota e chama
 * a original. Se o Apps Script não deixar trocar, nada muda. A contagem fica no
 * cache (cópia nas Propriedades) e é aproximada: conta um pouco a menos, nunca a
 * mais. O dia vira à meia-noite de São Paulo; a cota do Google não (é janela móvel).
 */
var CV_UF_ = { ligado: false, ativo: false };
(function () {
  try { CV_UF_.ligado = PropertiesService.getScriptProperties().getProperty("RF_CONTADOR") === "1"; } catch (e) { return; }
  if (!CV_UF_.ligado) return;
  try {
    var orig = UrlFetchApp.fetch, origAll = UrlFetchApp.fetchAll;
    var chama = function (f, args) {
      try { return f.apply(UrlFetchApp, args); }
      catch (e) { if (e instanceof TypeError && /invoc|this|receiver/i.test(String(e))) return f.apply(null, args); throw e; }
    };
    var novo = function () { cvUfConta_(arguments[0], 1); return chama(orig, arguments); };
    UrlFetchApp.fetch = novo;
    CV_UF_.ativo = (UrlFetchApp.fetch === novo);
    if (CV_UF_.ativo && origAll) {
      UrlFetchApp.fetchAll = function () { var l = arguments[0] || []; cvUfConta_(l[0] && (l[0].url || l[0]), l.length || 1); return chama(origAll, arguments); };
    }
  } catch (e) { CV_UF_.ativo = false; }
})();
var CV_UF_AJUDANTES = /^(notion|supa|fetch|chama|novo|req|http|cvUf|UrlFetch)/i;
function cvUfDia_() { return Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyyMMdd"); }
function cvUfConta_(url, n) {
  try {
    var host = String(url || "").replace(/^https?:\/\//, "").split("/")[0];
    var serv = /notion/.test(host) ? "Notion" : /supabase/.test(host) ? "Supabase" : /github/.test(host) ? "GitHub" : (host.slice(0, 30) || "?");
    var nomes = String(new Error().stack || "").split("\n").map(function (l) { var m = l.match(/at ([\w$.]+) \(/); return m ? m[1] : null; }).filter(Boolean);
    var entrada = nomes.length ? nomes[nomes.length - 1] : "?";
    var origem = "?";
    for (var i = 0; i < nomes.length; i++) if (!CV_UF_AJUDANTES.test(nomes[i])) { origem = nomes[i]; break; }
    var chave = (entrada === origem ? origem : entrada + " › " + origem) + " · " + serv;
    var c = CacheService.getScriptCache(), k = "cv_uf_" + cvUfDia_(), d = null;
    try { d = JSON.parse(c.get(k) || "null"); } catch (e) {}
    d = d || { total: 0, h: {}, k: {} };
    var hh = Utilities.formatDate(new Date(), "America/Sao_Paulo", "HH");
    d.total += n; d.h[hh] = (d.h[hh] || 0) + n; d.k[chave] = (d.k[chave] || 0) + n;
    var ks = Object.keys(d.k);
    if (ks.length > 250) { ks.sort(function (a, b) { return d.k[a] - d.k[b]; }).slice(0, ks.length - 250).forEach(function (x) { d.k["(outras)"] = (d.k["(outras)"] || 0) + d.k[x]; delete d.k[x]; }); }
    c.put(k, JSON.stringify(d), 21600);
  } catch (e) {}
}
/* cópia do dia nas Propriedades (o cache pode sumir) */
function cvUfGuardar_() {
  if (!CV_UF_.ligado) return;
  try {
    var dia = cvUfDia_(), d = JSON.parse(CacheService.getScriptCache().get("cv_uf_" + dia) || "null"); if (!d) return;
    var top = {}; Object.keys(d.k).sort(function (a, b) { return d.k[b] - d.k[a]; }).slice(0, 40).forEach(function (x) { top[x] = d.k[x]; });
    var pr = PropertiesService.getScriptProperties(), s = JSON.stringify({ total: d.total, h: d.h, k: top, em: new Date().toISOString() });
    if (s.length < 8500) pr.setProperty("CV_UF_" + dia, s);
    var limite = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), "America/Sao_Paulo", "yyyyMMdd");
    Object.keys(pr.getProperties()).forEach(function (p) { if (/^CV_UF_\d{8}$/.test(p) && p.slice(-8) < limite) pr.deleteProperty(p); });
  } catch (e) {}
}
function cvCotaTotalHoje_() {
  var dia = cvUfDia_(), t = 0;
  try { var d = JSON.parse(CacheService.getScriptCache().get("cv_uf_" + dia) || "null"); if (d && d.total > t) t = d.total; } catch (e) {}
  try { var c = JSON.parse(PropertiesService.getScriptProperties().getProperty("CV_UF_" + dia) || "null"); if (c && c.total > t) t = c.total; } catch (e) {}
  return t;
}
function cvCotaHoje(dia) {
  dia = dia || cvUfDia_();
  var d = null; try { d = JSON.parse(CacheService.getScriptCache().get("cv_uf_" + dia) || "null"); } catch (e) {}
  var copia = null; try { copia = JSON.parse(PropertiesService.getScriptProperties().getProperty("CV_UF_" + dia) || "null"); } catch (e) {}
  if (!d || (copia && copia.total > d.total)) d = copia;
  var l = ["Projeto " + cvCotaProjeto_() + " · dia " + dia.slice(6, 8) + "/" + dia.slice(4, 6)];
  l.push("Contador: " + (CV_UF_.ligado ? (CV_UF_.ativo ? "LIGADO e funcionando" : "ligado, mas o Apps Script NÃO deixou trocar o UrlFetch (não conta)") : "DESLIGADO — rode cvContadorLigar"));
  if (!d) { l.push("Nenhuma chamada anotada hoje neste projeto."); Logger.log(l.join("\n")); return; }
  l.push("TOTAL deste projeto hoje: " + d.total + " chamadas (a soma de todos os projetos está na planilha COTA GOOGLE; limite da conta ~20.000/dia)");
  l.push("Por hora: " + Object.keys(d.h).sort().map(function (h) { return h + "h=" + d.h[h]; }).join("  "));
  l.push("Quem mais gasta:");
  Object.keys(d.k).sort(function (a, b) { return d.k[b] - d.k[a]; }).slice(0, 25).forEach(function (x) { l.push("  " + d.k[x] + "  " + x); });
  Logger.log(l.join("\n"));
}
function cvContadorLigar()    { PropertiesService.getScriptProperties().setProperty("RF_CONTADOR", "1"); Logger.log("Contador LIGADO neste projeto (vale a partir da próxima execução). Veja com cvCotaHoje."); }
function cvContadorDesligar() { PropertiesService.getScriptProperties().deleteProperty("RF_CONTADOR");   Logger.log("Contador DESLIGADO neste projeto."); }

/* ---------- planilha COTA GOOGLE ---------- */
var CV_COTA_ABA = "COTA GOOGLE", CV_COTA_CADA_MS = 15 * 60000;
function cvCotaProp_(n) { try { return String(PropertiesService.getScriptProperties().getProperty(n) || "").trim(); } catch (e) { return ""; } }
function cvCotaProjeto_() { return cvCotaProp_("COTA_PROJETO") || "PORTAL-VENDA"; }
function cvCotaAba_(id) {
  var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(CV_COTA_ABA) || ss.insertSheet(CV_COTA_ABA);
  if (sh.getLastRow() === 0) {
    try { sh.getRange("A:A").setNumberFormat("@"); } catch (e) {}
    sh.appendRow(["DIA", "PROJETO", "CHAMADAS", "ATUALIZADO"]);
  }
  return sh;
}
function cvCotaDiaCel_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") return Utilities.formatDate(v, "America/Sao_Paulo", "yyyy-MM-dd");
  return String(v == null ? "" : v).trim();
}
/* grava (ou atualiza) a linha deste projeto no dia; no máximo a cada 15 min; nunca dá erro */
function cvCotaCiclo_(forcar) {
  try {
    if (!CV_UF_.ligado) return false;
    var id = cvCotaProp_("COTA_PLANILHA_ID"); if (!id) return false;
    var c = CacheService.getScriptCache(), ult = Number(c.get("cv_cota_ciclo") || 0);
    if (!forcar && ult && Date.now() - ult < CV_COTA_CADA_MS) return false;
    c.put("cv_cota_ciclo", String(Date.now()), 3600);
    cvUfGuardar_();
    var sh = cvCotaAba_(id), dia = Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd");
    var projeto = cvCotaProjeto_(), total = cvCotaTotalHoje_(), agora = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM HH:mm");
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (cvCotaDiaCel_(v[i][0]) === dia && String(v[i][1]) === projeto) { sh.getRange(i + 1, 3, 1, 2).setValues([[total, agora]]); return true; }
    }
    sh.appendRow([dia, projeto, total, agora]);
    return true;
  } catch (e) { console.log("Cota: planilha COTA GOOGLE — " + e); return false; }
}
/* Rodar UMA vez no editor depois de subir: o Apps Script só pede a permissão de
   planilha quando uma função que usa SpreadsheetApp roda no editor. */
function cvCotaAutorizar() {
  var id = cvCotaProp_("COTA_PLANILHA_ID");
  if (!id) { Logger.log("Falta a Propriedade COTA_PLANILHA_ID (id da planilha COTA GOOGLE)."); return; }
  cvCotaAba_(id);
  Logger.log("Planilha OK. Contador deste projeto: " + (CV_UF_.ligado ? "ligado" : "DESLIGADO — rode cvContadorLigar") +
             ". Nome da linha: " + cvCotaProjeto_() + ".");
}
