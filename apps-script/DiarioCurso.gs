/*************************************************************************
 * DiarioCurso.gs · PORTAL-MORAIS — 23/11/2026
 * -----------------------------------------------------------------------
 * DIÁRIO DO CURSO REVIT (diario-curso.html, último item de REUNIÕES).
 * Cada estagiário tem o próprio diário: relatórios com prints, a data em que
 * preencheu e o check das aulas da ementa (vira % de conclusão). O ADM (e o
 * MASTER) veem o diário de todos.
 *
 * PÁGINAS DE 15 DIAS: a 1ª começa em 24/11/2026 (dia seguinte ao pedido) e
 * cada uma dura 15 dias. No 16º dia ela TRAVA (não aceita registro novo, nem
 * edição, nem desmarcar aula marcada nela) e a seguinte já abre. Quem decide o
 * que está travado é ESTE arquivo, pelo relógio do servidor (São Paulo) — a
 * página só desenha.
 *   página 1 = 24/11 a 08/12/2026 · página 2 = 09/12 a 23/12 · página 3 = 24/12 a 07/01 ...
 *
 * DADOS: tabelas diario_* e bucket privado "diario-curso" no Supabase
 * ORÇADO/REALIZADO (supabase/diario_curso.sql). Mesmas Propriedades que a
 * Análise já usa: SUPABASE_URL e SUPABASE_SERVICE_KEY. Os prints saem por
 * link assinado (o bucket não é público).
 *
 * QUEM É ESTAGIÁRIO: quem tem "DIÁRIO DO CURSO" na coluna ACESSOS do LOGINS.
 * ADM, MASTER e TESTES veem todos (TESTES não grava nada).
 *
 * AÇÕES (roteadas pelo Melhorias.gs — ver a linha do gancho abaixo):
 *   diarioVersao   diagnóstico: versão, Supabase configurado, página de hoje
 *   diarioLer      o diário inteiro de um estagiário (o próprio; ADM escolhe)
 *   diarioEquipe   ADM/MASTER: todos os diários com contagens (visão geral)
 *   diarioEnviar   registro novo ou edição (texto + prints) — só na página aberta
 *   diarioExcluir  apaga um registro da página aberta (e os prints dele)
 *   diarioCheck    marca/desmarca uma aula da ementa
 *   diarioConfig   ADM/MASTER: módulos fora da ementa do estagiário e ativo/inativo
 *
 * COMO INSTALAR (projeto PORTAL-LEITURA):
 *   1) Rodar supabase/diario_curso.sql no SQL Editor do Supabase ORÇADO/REALIZADO.
 *   2) Arquivo novo "DiarioCurso" (script) com este conteúdo.
 *   3) Melhorias.gs — DENTRO de melhoriasRotear_, junto dos outros ganchos
 *      (o Melhorias.gs desta entrega já vem com a linha):
 *        if (typeof dcRotear_ === "function") { var rDc = dcRotear_(action, sess, p); if (rDc) return rDc; }
 *   4) Salvar + Implantar > Gerenciar implantações > lápis > Nova versão.
 *   Teste: rodapé da página mostra "Apps Script d1".
 *   5) Notion, banco LOGINS: criar a opção "DIÁRIO DO CURSO" na coluna ACESSOS
 *      e marcar nos estagiários.
 *************************************************************************/

var DC_VERSAO = "d1";
var DC_ACESSO = "DIÁRIO DO CURSO";
var DC_INICIO = "2026-11-24";       // 1º dia da página 1
var DC_DIAS = 15;                    // duração de cada página
var DC_FUSO = "America/Sao_Paulo";
var DC_BUCKET = "diario-curso";
var DC_MAX_FOTOS = 8;                // por registro
var DC_MAX_IMG_B64 = 2800000;        // ~2 MB por print (a página já comprime para JPEG)
var DC_MAX_TEXTO = 20000;
var DC_LINK_SEG = 86400;             // link assinado dos prints vale 1 dia (é refeito a cada leitura)

/* Módulos que já nascem FORA da ementa quando o diário é criado, pelo primeiro
   nome (sem acento) do login ou da pessoa. Depois de criado, vale o que o ADM
   marcar na página (Ementa do estagiário). */
var DC_FORA_INICIAL = {
  ARTHUR: ["A1-01"]                  // 23/11/26: o Arthur não faz o Desafio Revit (bônus)
};

function dcRotear_(action, sess, p) {
  if (String(action || "").indexOf("diario") !== 0) return null;
  p = p || {};
  if (action === "diarioVersao") {
    return { ok: true, versao: DC_VERSAO, supabase: !!(dcProp_("SUPABASE_URL") && dcProp_("SUPABASE_SERVICE_KEY")), hoje: dcHoje_(), pagina: dcPaginaDe_(dcHoje_()) };
  }
  if (!sess || !sess.u) return { ok: false, erro: "NAO_AUTORIZADO" };
  var adm = dcVeTodos_(sess), est = dcEhEstagiario_(sess);
  if (!adm && !est) return { ok: false, erro: "SEM_PERMISSAO" };
  var grava = { diarioEnviar: 1, diarioExcluir: 1, diarioCheck: 1, diarioConfig: 1 };
  if (grava[action] && dcEhTestes_(sess)) return { ok: false, erro: "MODO_TESTE" };
  try {
    switch (action) {
      case "diarioLer":     return dcLer_(sess, p, adm);
      case "diarioEquipe":  return adm ? dcEquipe_() : { ok: false, erro: "SEM_PERMISSAO" };
      case "diarioEnviar":  return est ? dcSalvar_(sess, p) : { ok: false, erro: "SEM_PERMISSAO" };
      case "diarioExcluir": return est ? dcExcluir_(sess, p) : { ok: false, erro: "SEM_PERMISSAO" };
      case "diarioCheck":   return est ? dcCheck_(sess, p) : { ok: false, erro: "SEM_PERMISSAO" };
      case "diarioConfig":  return adm ? dcConfig_(sess, p) : { ok: false, erro: "SEM_PERMISSAO" };
    }
    return { ok: false, erro: "ACAO_DESCONHECIDA" };
  } catch (e) {
    console.log("diario " + action + " (" + sess.u + "): " + e);
    var m = String(e && e.message || e);
    if (m.indexOf("FALTA CONFIGURAR") >= 0) return { ok: false, erro: "SUPABASE_NAO_CONFIGURADO" };
    return { ok: false, erro: m.slice(0, 200) };
  }
}

/* ------------------------------ quem é quem ------------------------------ */
function dcNorm_(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}
function dcTipo_(sess) { return String(sess.t || "").toUpperCase(); }
function dcEhTestes_(sess) { return dcTipo_(sess) === "TESTES"; }
function dcVeTodos_(sess) { var t = dcTipo_(sess); return t === "ADM" || t === "MASTER" || t === "TESTES"; }
function dcEhEstagiario_(sess) {
  var alvo = dcNorm_(DC_ACESSO);
  return (sess.a || []).some(function (a) { return dcNorm_(a) === alvo; });
}
function dcLogin_(s) { return String(s || "").trim().toLowerCase(); }

/* ------------------------------ datas / páginas ------------------------------ */
function dcHoje_() { return Utilities.formatDate(new Date(), DC_FUSO, "yyyy-MM-dd"); }
function dcDia_(ymd) { var a = String(ymd).split("-"); return Math.floor(Date.UTC(+a[0], +a[1] - 1, +a[2]) / 86400000); }
function dcYmd_(dia) { return Utilities.formatDate(new Date(dia * 86400000), "UTC", "yyyy-MM-dd"); }
/* Antes de 24/11 conta como página 1 (dá para começar hoje, 23/11). */
function dcPaginaDe_(ymd) { return Math.max(1, Math.floor((dcDia_(ymd) - dcDia_(DC_INICIO)) / DC_DIAS) + 1); }
function dcPaginaAtual_() { return dcPaginaDe_(dcHoje_()); }
function dcFaixa_(n) {
  var ini = dcDia_(DC_INICIO) + (n - 1) * DC_DIAS;
  return { pagina: n, inicio: dcYmd_(ini), fim: dcYmd_(ini + DC_DIAS - 1) };
}

/* ------------------------------ Supabase ------------------------------ */
function dcProp_(n) { var v = PropertiesService.getScriptProperties().getProperty(n); return v ? v.trim() : v; }
function dcCfg_() {
  var url = dcProp_("SUPABASE_URL"), key = dcProp_("SUPABASE_SERVICE_KEY");
  if (!url || !key) throw new Error("FALTA CONFIGURAR: SUPABASE_URL / SUPABASE_SERVICE_KEY");
  return { url: url.replace(/\/+$/, ""), key: key };
}
function dcRest_(method, caminho, corpo, prefer) {
  var cfg = dcCfg_();
  var h = { apikey: cfg.key, Authorization: "Bearer " + cfg.key, Accept: "application/json" };
  if (prefer) h.Prefer = prefer;
  var opt = { method: method, muteHttpExceptions: true, headers: h };
  if (corpo !== undefined && corpo !== null) { opt.contentType = "application/json"; opt.payload = JSON.stringify(corpo); }
  var r = UrlFetchApp.fetch(cfg.url + "/rest/v1/" + caminho, opt);
  var code = r.getResponseCode(), txt = r.getContentText();
  if (code >= 300) throw new Error("SUPABASE_" + code + ": " + txt.slice(0, 200));
  return txt ? JSON.parse(txt) : null;
}
function dcQ_(v) { return encodeURIComponent(String(v)); }
function dcSubir_(caminho, b64) {
  var cfg = dcCfg_();
  var r = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/" + DC_BUCKET + "/" + caminho, {
    method: "post", muteHttpExceptions: true,
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "x-upsert": "false" },
    contentType: "image/jpeg", payload: Utilities.base64Decode(b64)
  });
  if (r.getResponseCode() >= 300) throw new Error("UPLOAD_FALHOU: " + r.getContentText().slice(0, 200));
  return caminho;
}
function dcApagarFotos_(caminhos) {
  if (!caminhos || !caminhos.length) return;
  var cfg;
  try { cfg = dcCfg_(); } catch (e) { return; }
  /* um DELETE por print, sem corpo (o DELETE com lista no corpo depende de o
     UrlFetchApp mandar payload em DELETE — não vale a pena arriscar) */
  caminhos.forEach(function (c) {
    try {
      var r = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/" + DC_BUCKET + "/" + c, {
        method: "delete", muteHttpExceptions: true,
        headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }
      });
      if (r.getResponseCode() >= 300 && r.getResponseCode() !== 404) console.log("diario: não apagou " + c + " — " + r.getContentText().slice(0, 150));
    } catch (e) { console.log("diario: não apagou " + c + " — " + e); }
  });
}
function dcAssinar_(caminhos) {
  var out = {};
  if (!caminhos.length) return out;
  var cfg = dcCfg_();
  for (var i = 0; i < caminhos.length; i += 200) {
    var r = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/sign/" + DC_BUCKET, {
      method: "post", muteHttpExceptions: true, contentType: "application/json",
      headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
      payload: JSON.stringify({ expiresIn: DC_LINK_SEG, paths: caminhos.slice(i, i + 200) })
    });
    if (r.getResponseCode() >= 300) { console.log("diario: assinatura falhou " + r.getContentText().slice(0, 200)); continue; }
    (JSON.parse(r.getContentText()) || []).forEach(function (x) {
      var rel = x.signedURL || x.signedUrl;
      if (x.path && rel) out[x.path] = cfg.url + "/storage/v1" + (rel.charAt(0) === "/" ? "" : "/") + rel;
    });
  }
  return out;
}

/* ------------------------------ leitura ------------------------------ */
function dcEstagiario_(login) {
  var r = dcRest_("get", "diario_estagiarios?select=*&login=eq." + dcQ_(login));
  return r && r[0] ? r[0] : null;
}
/* Diário nasce na 1ª abertura do próprio estagiário. */
function dcGarantir_(sess) {
  var login = dcLogin_(sess.u), e = dcEstagiario_(login);
  if (e) return e;
  var nome = String(sess.n || sess.p || sess.u || "").trim();
  var fora = [];
  [nome, login].forEach(function (s) {
    var prim = dcNorm_(s).split(/[ ._-]/)[0];
    if (prim && DC_FORA_INICIAL[prim]) fora = DC_FORA_INICIAL[prim].slice();
  });
  var novo = dcRest_("post", "diario_estagiarios?on_conflict=login",
    [{ login: login, nome: nome, fora: fora, ativo: true }], "resolution=ignore-duplicates,return=representation");
  return (novo && novo[0]) || dcEstagiario_(login);
}
function dcLer_(sess, p, adm) {
  var proprio = dcLogin_(sess.u);
  var alvo = (adm && p.login) ? dcLogin_(p.login) : proprio;
  var est;
  if (alvo === proprio && dcEhEstagiario_(sess)) est = dcGarantir_(sess);
  else est = dcEstagiario_(alvo);
  if (!est) return { ok: false, erro: adm ? "DIARIO_NAO_ENCONTRADO" : "SEM_PERMISSAO" };

  var regs = dcRest_("get", "diario_registros?select=id,pagina,texto,fotos,criado_em,editado_em&login=eq." + dcQ_(alvo) + "&order=criado_em.desc") || [];
  var checks = dcRest_("get", "diario_checks?select=item,feito_em,pagina&login=eq." + dcQ_(alvo)) || [];
  var caminhos = [];
  regs.forEach(function (r) { (r.fotos || []).forEach(function (f) { caminhos.push(f); }); });
  var links = dcAssinar_(caminhos);
  regs.forEach(function (r) { r.fotos = (r.fotos || []).map(function (f) { return { p: f, url: links[f] || "" }; }); });

  var atual = dcPaginaAtual_();
  return {
    ok: true, versao: DC_VERSAO, hoje: dcHoje_(), inicio: DC_INICIO, dias: DC_DIAS,
    paginaAtual: dcFaixa_(atual),
    estagiario: { login: est.login, nome: est.nome, fora: est.fora || [], ativo: est.ativo !== false },
    registros: regs, checks: checks,
    podeEditar: alvo === proprio && dcEhEstagiario_(sess) && !dcEhTestes_(sess)
  };
}
function dcEquipe_() {
  var ests = dcRest_("get", "diario_estagiarios?select=*&order=nome.asc") || [];
  var checks = dcRest_("get", "diario_checks?select=login,item,pagina,feito_em") || [];
  var regs = dcRest_("get", "diario_registros?select=login,pagina,criado_em") || [];
  return { ok: true, versao: DC_VERSAO, hoje: dcHoje_(), paginaAtual: dcFaixa_(dcPaginaAtual_()), estagiarios: ests, checks: checks, registros: regs };
}

/* ------------------------------ gravação ------------------------------ */
function dcSlug_(login) { return String(login).toLowerCase().replace(/[^a-z0-9._-]/g, "_"); }
function dcRegistroDoDono_(sess, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw new Error("PEDIDO_INVALIDO: id");
  var r = dcRest_("get", "diario_registros?select=*&id=eq." + dcQ_(id));
  if (!r || !r[0]) throw new Error("REGISTRO_NAO_ENCONTRADO");
  if (r[0].login !== dcLogin_(sess.u)) throw new Error("SEM_PERMISSAO");
  return r[0];
}
function dcSalvar_(sess, p) {
  var login = dcLogin_(sess.u), atual = dcPaginaAtual_();
  dcGarantir_(sess);
  var texto = String(p.texto || "").replace(/\r\n/g, "\n").trim();
  if (texto.length > DC_MAX_TEXTO) return { ok: false, erro: "TEXTO_GRANDE_DEMAIS" };
  var novas = p.novas || [];
  if (Object.prototype.toString.call(novas) !== "[object Array]") return { ok: false, erro: "PEDIDO_INVALIDO: novas" };
  for (var i = 0; i < novas.length; i++) {
    var b = String(novas[i] || "");
    if (b.length > DC_MAX_IMG_B64 || b.indexOf("/9j/") !== 0 || !/^[A-Za-z0-9+\/=]+$/.test(b)) return { ok: false, erro: "PEDIDO_INVALIDO: print " + (i + 1) };
  }

  var antigo = null, manter = [];
  if (p.id) {
    antigo = dcRegistroDoDono_(sess, p.id);
    if (antigo.pagina !== atual) return { ok: false, erro: "PAGINA_TRAVADA" };
    var tinha = antigo.fotos || [];
    manter = (p.fotos || []).filter(function (f) { return tinha.indexOf(f) >= 0; });
  }
  if (manter.length + novas.length > DC_MAX_FOTOS) return { ok: false, erro: "PRINTS_DEMAIS" };
  if (!texto && !manter.length && !novas.length) return { ok: false, erro: "REGISTRO_VAZIO" };

  var subidas = [];
  try {
    novas.forEach(function (b64) { subidas.push(dcSubir_(dcSlug_(login) + "/p" + atual + "/" + Utilities.getUuid() + ".jpg", b64)); });
  } catch (e) { dcApagarFotos_(subidas); throw e; }
  var fotos = manter.concat(subidas), salvo;
  if (antigo) {
    salvo = dcRest_("patch", "diario_registros?id=eq." + dcQ_(antigo.id),
      { texto: texto, fotos: fotos, editado_em: new Date().toISOString() }, "return=representation");
    dcApagarFotos_((antigo.fotos || []).filter(function (f) { return fotos.indexOf(f) < 0; }));
  } else {
    salvo = dcRest_("post", "diario_registros", [{ login: login, pagina: atual, texto: texto, fotos: fotos }], "return=representation");
  }
  var r = salvo && salvo[0];
  if (!r) return { ok: false, erro: "NAO_SALVOU" };
  var links = dcAssinar_(r.fotos || []);
  r.fotos = (r.fotos || []).map(function (f) { return { p: f, url: links[f] || "" }; });
  return { ok: true, registro: r };
}
function dcExcluir_(sess, p) {
  var r = dcRegistroDoDono_(sess, p.id);
  if (r.pagina !== dcPaginaAtual_()) return { ok: false, erro: "PAGINA_TRAVADA" };
  dcRest_("delete", "diario_registros?id=eq." + dcQ_(r.id));
  dcApagarFotos_(r.fotos || []);
  return { ok: true, id: r.id };
}
function dcCheck_(sess, p) {
  var login = dcLogin_(sess.u), item = String(p.item || "");
  if (!/^[A-Z]\d-\d{2}-\d{2}$/.test(item)) return { ok: false, erro: "PEDIDO_INVALIDO: item" };
  var atual = dcPaginaAtual_();
  dcGarantir_(sess);
  var ja = dcRest_("get", "diario_checks?select=*&login=eq." + dcQ_(login) + "&item=eq." + dcQ_(item));
  ja = ja && ja[0];
  if (p.feito === true || p.feito === "true" || p.feito === 1) {
    if (ja) return { ok: true, check: ja };                 // já marcada: mantém a data original
    var n = dcRest_("post", "diario_checks?on_conflict=login,item", [{ login: login, item: item, pagina: atual }], "resolution=ignore-duplicates,return=representation");
    return { ok: true, check: (n && n[0]) || { item: item, pagina: atual, feito_em: new Date().toISOString() } };
  }
  if (!ja) return { ok: true, check: null };
  if (ja.pagina !== atual) return { ok: false, erro: "PAGINA_TRAVADA" };
  dcRest_("delete", "diario_checks?login=eq." + dcQ_(login) + "&item=eq." + dcQ_(item));
  return { ok: true, check: null };
}
function dcConfig_(sess, p) {
  var login = dcLogin_(p.login);
  if (!login || !dcEstagiario_(login)) return { ok: false, erro: "DIARIO_NAO_ENCONTRADO" };
  var mud = {};
  if (p.fora !== undefined) {
    var fora = [].concat(p.fora || []).map(String).filter(function (m) { return /^[A-Z]\d-\d{2}$/.test(m); });
    mud.fora = fora;
  }
  if (p.ativo !== undefined) mud.ativo = !!(p.ativo === true || p.ativo === "true");
  if (!Object.keys(mud).length) return { ok: false, erro: "FALTA_PARAM" };
  var r = dcRest_("patch", "diario_estagiarios?login=eq." + dcQ_(login), mud, "return=representation");
  console.log("diario: " + sess.u + " mudou a configuração de " + login + " — " + JSON.stringify(mud));
  return { ok: true, estagiario: r && r[0] };
}

/* Teste no editor (não grava nada): Executar > dcTesteDatas */
function dcTesteDatas() {
  Logger.log("hoje " + dcHoje_() + " → página " + dcPaginaAtual_() + " " + JSON.stringify(dcFaixa_(dcPaginaAtual_())));
  ["2026-11-23", "2026-11-24", "2026-12-08", "2026-12-09", "2026-12-23", "2026-12-24"].forEach(function (d) {
    Logger.log(d + " → página " + dcPaginaDe_(d));
  });
}
