/*************************************************************************
 * LoginsConfig.gs · PORTAL-MORAIS — 23/11/2026
 * -----------------------------------------------------------------------
 * CONFIGURAÇÕES › LOGINS E ACESSOS (logins.html). Só ADM e MASTER entram
 * (TESTES não vê nem grava). Lê e grava o banco LOGINS do Notion:
 *   LOGIN (título) · NOME (texto, nome que aparece no portal) · PESSOA ·
 *   TIPO · ACESSOS · CARGO · SETOR · DATA DE NASCIMENTO · SENHA (nunca sai daqui)
 *
 * NOME: coluna nova (criada sozinha na 1ª abertura). Quando preenchida, é o
 * nome que o portal mostra (aniversários, cabeçalho) no lugar do nome da
 * PESSOA do Notion — ex.: a conta "Construtora Morais" que a Juliana usa.
 *
 * Opção nova de ACESSOS/CARGO/SETOR: basta digitar na tela; o Notion cria a
 * opção ao gravar (é assim que se cria, por exemplo, "DIÁRIO DO CURSO").
 *
 * TRAVAS
 *  - ninguém muda o próprio TIPO (evita se trancar fora);
 *  - MASTER não cria ADM, não mexe no TIPO de um ADM e não troca senha de ADM;
 *  - LOGIN não é renomeado (diário, atividades e históricos usam o login).
 *
 * AÇÕES (roteadas pelo Melhorias.gs):
 *   loginsLista   linhas + opções das colunas + pessoas do Notion
 *   loginSalvar   cria (com senha) ou edita uma linha
 *   loginSenha    troca a senha (grava o hash, nunca o texto)
 *
 * INSTALAR (PORTAL-LEITURA): arquivo novo "LoginsConfig"; no melhoriasRotear_:
 *   if (typeof lcRotear_ === "function") { var rLc = lcRotear_(action, sess, p); if (rLc) return rLc; }
 *************************************************************************/

var LC_VERSAO = "l1";
var LC_SENHA_TRAVADA = "sha256$SEM-ACESSO-SO-ANIVERSARIO$0";

function lcRotear_(action, sess, p) {
  if (action !== "loginsLista" && action !== "loginSalvar" && action !== "loginSenha") return null;
  var t = String((sess && sess.t) || "").toUpperCase();
  if (t !== "ADM" && t !== "MASTER") return { ok: false, erro: "SEM_PERMISSAO" };
  p = p || {};
  try {
    if (action === "loginsLista") return lcLista_();
    if (action === "loginSalvar") return lcSalvar_(sess, p);
    if (action === "loginSenha") return lcSenha_(sess, p);
  } catch (e) {
    console.log("logins " + action + " (" + sess.u + "): " + e);
    return { ok: false, erro: String(e && e.message || e).slice(0, 200) };
  }
}

function lcGarantirNome_() {
  var db = notion_("GET", "/databases/" + CONFIG.DB.LOGINS);
  if (!(db.properties || {})["NOME"]) {
    notion_("PATCH", "/databases/" + CONFIG.DB.LOGINS, { properties: { "NOME": { rich_text: {} } } });
    db = notion_("GET", "/databases/" + CONFIG.DB.LOGINS);
  }
  return db;
}
function lcOpcoes_(prop) {
  if (!prop) return [];
  var o = (prop.select || prop.multi_select || {}).options || [];
  return o.map(function (x) { return x.name; });
}
function lcLinha_(r) {
  var pr = r.properties || {};
  var pes = ((pr["PESSOA"] && pr["PESSOA"].people) || [])[0];
  var senha = String(texto_(pr["SENHA"]) || "");
  return {
    id: r.id,
    login: titulo_(pr["LOGIN"]),
    nome: texto_(pr["NOME"]),
    pessoa: pes ? { id: pes.id, nome: pes.name || "" } : null,
    tipo: (pr["TIPO"] && pr["TIPO"].select && pr["TIPO"].select.name) || "",
    acessos: ((pr["ACESSOS"] && pr["ACESSOS"].multi_select) || []).map(function (o) { return o.name; }),
    cargo: (pr["CARGO"] && pr["CARGO"].select && pr["CARGO"].select.name) || "",
    setor: (pr["SETOR"] && pr["SETOR"].select && pr["SETOR"].select.name) || "",
    nasc: (pr["DATA DE NASCIMENTO"] && pr["DATA DE NASCIMENTO"].date && pr["DATA DE NASCIMENTO"].date.start) || "",
    semSenha: !senha,
    soAniversario: senha === LC_SENHA_TRAVADA
  };
}
function lcLista_() {
  var db = lcGarantirNome_(), pp = db.properties || {};
  var linhas = queryAll_(CONFIG.DB.LOGINS, {}).map(lcLinha_);
  linhas.sort(function (a, b) { return String(a.nome || (a.pessoa && a.pessoa.nome) || a.login).localeCompare(String(b.nome || (b.pessoa && b.pessoa.nome) || b.login), "pt"); });
  var pessoas = {};
  linhas.forEach(function (l) { if (l.pessoa && l.pessoa.id) pessoas[l.pessoa.id] = l.pessoa.nome; });
  try {
    var cursor = null, voltas = 0;
    do {
      var r = notion_("GET", "/users?page_size=100" + (cursor ? "&start_cursor=" + encodeURIComponent(cursor) : ""), null);
      (r.results || []).forEach(function (u) { if (u.type !== "bot" && u.id && u.name) pessoas[u.id] = u.name; });
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor && ++voltas < 10);
  } catch (e) { /* sem permissão de ler usuários: fica só com os que já estão no LOGINS */ }
  return {
    ok: true, versao: LC_VERSAO, linhas: linhas,
    opcoes: { tipo: lcOpcoes_(pp["TIPO"]), acessos: lcOpcoes_(pp["ACESSOS"]), cargo: lcOpcoes_(pp["CARGO"]), setor: lcOpcoes_(pp["SETOR"]) },
    pessoas: Object.keys(pessoas).map(function (id) { return { id: id, nome: pessoas[id] }; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt"); })
  };
}
function lcTxt_(v) { return [{ type: "text", text: { content: String(v || "").slice(0, 1900) } }]; }
function lcNomeOpcao_(v) { return String(v || "").replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 100); }
function lcLimparCaches_(login) {
  try { cacheRemover_("acessos_" + String(login || "").toLowerCase()); } catch (e) {}
  try { CacheService.getScriptCache().removeAll(["rf_aniv_v1", "rf_aniv_v2"]); } catch (e) {}
}

function lcSalvar_(sess, p) {
  var eu = String(sess.u || "").toLowerCase(), souMaster = String(sess.t).toUpperCase() === "MASTER";
  var props = {}, atual = null;
  if (p.id) {
    var pg = notion_("GET", "/pages/" + p.id);
    if (!pg || pg.parent == null || String((pg.parent.database_id || "")).replace(/-/g, "") !== CONFIG.DB.LOGINS.replace(/-/g, "")) return { ok: false, erro: "LINHA_INVALIDA" };
    atual = lcLinha_(pg);
  } else {
    var login = String(p.login || "").trim();
    if (!/^[A-Za-z0-9._@-]{2,60}$/.test(login)) return { ok: false, erro: "LOGIN_INVALIDO" };
    var ja = queryAll_(CONFIG.DB.LOGINS, {}).some(function (r) { return titulo_(r.properties["LOGIN"]).toLowerCase() === login.toLowerCase(); });
    if (ja) return { ok: false, erro: "LOGIN_JA_EXISTE" };
    if (String(p.senha || "").length < 4) return { ok: false, erro: "SENHA_CURTA" };
    props["LOGIN"] = { title: lcTxt_(login) };
    props["SENHA"] = { rich_text: lcTxt_(hashSenha_(String(p.senha))) };
  }

  if (p.tipo !== undefined) {
    var novoTipo = String(p.tipo || "").trim().toUpperCase();
    var tipoAtual = atual ? String(atual.tipo || "").toUpperCase() : "";
    if (atual && novoTipo !== tipoAtual) {
      if (atual.login.toLowerCase() === eu) return { ok: false, erro: "NAO_MUDA_PROPRIO_TIPO" };
      if (souMaster && (tipoAtual === "ADM" || novoTipo === "ADM")) return { ok: false, erro: "MASTER_NAO_MEXE_EM_ADM" };
    }
    if (!atual && souMaster && novoTipo === "ADM") return { ok: false, erro: "MASTER_NAO_MEXE_EM_ADM" };
    if (!atual || novoTipo !== tipoAtual) props["TIPO"] = novoTipo ? { select: { name: lcNomeOpcao_(novoTipo) } } : { select: null };
  }
  if (p.nome !== undefined) props["NOME"] = { rich_text: lcTxt_(String(p.nome || "").trim()) };
  if (p.acessos !== undefined) {
    var vistos = {}, lista = [];
    [].concat(p.acessos || []).forEach(function (a) { var n = lcNomeOpcao_(a); if (n && !vistos[n.toUpperCase()]) { vistos[n.toUpperCase()] = 1; lista.push({ name: n }); } });
    props["ACESSOS"] = { multi_select: lista };
  }
  if (p.cargo !== undefined) props["CARGO"] = lcNomeOpcao_(p.cargo) ? { select: { name: lcNomeOpcao_(p.cargo) } } : { select: null };
  if (p.setor !== undefined) props["SETOR"] = lcNomeOpcao_(p.setor) ? { select: { name: lcNomeOpcao_(p.setor) } } : { select: null };
  if (p.nasc !== undefined) {
    var d = String(p.nasc || "");
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, erro: "DATA_INVALIDA" };
    props["DATA DE NASCIMENTO"] = { date: d ? { start: d } : null };
  }
  if (p.pessoaId !== undefined) props["PESSOA"] = { people: p.pessoaId ? [{ id: String(p.pessoaId) }] : [] };

  var pagina;
  if (atual) pagina = notion_("PATCH", "/pages/" + atual.id, { properties: props });
  else pagina = notion_("POST", "/pages", { parent: { database_id: CONFIG.DB.LOGINS }, properties: props });
  var linha = lcLinha_(pagina);
  lcLimparCaches_(linha.login);
  console.log("logins: " + sess.u + (atual ? " editou " : " criou ") + linha.login + " — " + Object.keys(props).filter(function (k) { return k !== "SENHA"; }).join(", "));
  return { ok: true, linha: linha };
}

function lcSenha_(sess, p) {
  if (!p.id) return { ok: false, erro: "FALTA_PARAM" };
  var senha = String(p.senha || "");
  if (senha.length < 4) return { ok: false, erro: "SENHA_CURTA" };
  var pg = notion_("GET", "/pages/" + p.id);
  if (!pg || String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "") !== CONFIG.DB.LOGINS.replace(/-/g, "")) return { ok: false, erro: "LINHA_INVALIDA" };
  var l = lcLinha_(pg);
  if (String(sess.t).toUpperCase() === "MASTER" && String(l.tipo).toUpperCase() === "ADM") return { ok: false, erro: "MASTER_NAO_MEXE_EM_ADM" };
  notion_("PATCH", "/pages/" + p.id, { properties: { "SENHA": { rich_text: lcTxt_(hashSenha_(senha)) } } });
  try { limparFalhas_(l.login.toLowerCase()); } catch (e) {}
  console.log("logins: " + sess.u + " trocou a senha de " + l.login);
  return { ok: true };
}
