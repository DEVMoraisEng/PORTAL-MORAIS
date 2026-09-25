/*************************************************************************
 * RetaFinal.gs · PORTAL-MORAIS — 25/09/2026
 * -----------------------------------------------------------------------
 * Vai nos DOIS projetos (PORTAL-LEITURA e PORTAL-ESCRITA), ao lado do
 * Código.gs e do Melhorias.gs. Usa os utilitários do Código.gs (notion_,
 * queryAll_, titulo_, CONFIG). Nomes novos começam com "rf" para não colidir.
 *
 * ANIVERSÁRIOS
 *   1) rfPrepararLogins()  — rode UMA vez pelo menu Executar (pode repetir:
 *      não duplica nada). Junta o banco (EMP) Membros no LOGINS:
 *        • cria no LOGINS as colunas DATA DE NASCIMENTO, ANIVERSÁRIO
 *          (fórmula = próximo aniversário), CARGO e SETOR, com as mesmas
 *          opções do Membros;
 *        • casa cada membro com a linha do LOGINS pela PESSOA e copia data,
 *          cargo e setor;
 *        • membro que não tem linha no LOGINS (inclui os que não têm Pessoa
 *          no Notion) ganha uma linha nova: LOGIN = nome do membro, PESSOA em
 *          branco quando não houver, e SENHA TRAVADA — essas linhas servem só
 *          para os aniversários, ninguém entra no portal com elas (senha em
 *          branco deixaria entrar com senha vazia; o valor gravado é um
 *          "hash" que nenhuma senha produz).
 *      O log lista cada linha atualizada/criada.
 *
 *   2) ação "aniversariantes" (roteada pelo Melhorias.gs, acesso: todos os
 *      logados). Devolve só NOME, DIA, MÊS, CARGO e SETOR — nunca o ano de
 *      nascimento nem a idade. O card do painel filtra o mês corrente.
 *      Cache de 30 min (aniversário não muda toda hora).
 *
 * Depois de colar: salvar + Implantar > Gerenciar implantações > lápis >
 * Nova versão, nos dois projetos.
 *************************************************************************/

var RF_MEMBROS_DB = "23ac5ab532d3812fa63cf14a034c3323";   // (EMP) Membros
var RF_COL = { nasc: "DATA DE NASCIMENTO", aniv: "ANIVERSÁRIO", cargo: "CARGO", setor: "SETOR" };
var RF_SENHA_TRAVADA = "sha256$SEM-ACESSO-SO-ANIVERSARIO$0";
var RF_CACHE_ANIV = "rf_aniv_v1";

/* Próximo aniversário (hoje, se for hoje). Só informativo no Notion — o
   portal calcula sozinho a partir da data. */
var RF_FORMULA_ANIV =
  'lets(n, prop("DATA DE NASCIMENTO"), ' +
  'u, dateAdd(n, dateBetween(now(), n, "years"), "years"), ' +
  'if(formatDate(u, "YYYY-MM-DD") == formatDate(now(), "YYYY-MM-DD"), u, dateAdd(u, 1, "years")))';

/* ===================== 1) JUNTAR MEMBROS NO LOGINS ===================== */
function rfPrepararLogins() {
  var membrosDb = notion_("GET", "/databases/" + RF_MEMBROS_DB);
  var mp = membrosDb.properties || {};
  var opcoes = function (col) {
    var p = mp[col]; if (!p || p.type !== "select") return [];
    return (p.select.options || []).map(function (o) { return { name: o.name, color: o.color }; });
  };

  // ---- colunas novas no LOGINS (só as que faltam) ----
  var loginsDb = notion_("GET", "/databases/" + CONFIG.DB.LOGINS);
  var lp = loginsDb.properties || {};
  var novas = {};
  if (!lp[RF_COL.nasc])  novas[RF_COL.nasc]  = { date: {} };
  if (!lp[RF_COL.cargo]) novas[RF_COL.cargo] = { select: { options: opcoes("Cargo") } };
  if (!lp[RF_COL.setor]) novas[RF_COL.setor] = { select: { options: opcoes("Setor") } };
  if (Object.keys(novas).length) {
    notion_("PATCH", "/databases/" + CONFIG.DB.LOGINS, { properties: novas });
    Logger.log("Colunas criadas no LOGINS: " + Object.keys(novas).join(", "));
  }
  if (!lp[RF_COL.aniv]) {
    try {
      var f = {}; f[RF_COL.aniv] = { formula: { expression: RF_FORMULA_ANIV } };
      notion_("PATCH", "/databases/" + CONFIG.DB.LOGINS, { properties: f });
      Logger.log("Coluna ANIVERSÁRIO (fórmula) criada.");
    } catch (e) {
      Logger.log("! Não consegui criar a fórmula ANIVERSÁRIO (" + e + ") — crie à mão se quiser; o portal não depende dela.");
    }
  }

  // ---- lê os dois bancos ----
  var membros = queryAll_(RF_MEMBROS_DB, {});
  var logins = queryAll_(CONFIG.DB.LOGINS, {});
  var porPessoa = {}, porLogin = {};
  logins.forEach(function (r) {
    var pr = r.properties || {};
    ((pr["PESSOA"] && pr["PESSOA"].people) || []).forEach(function (u) {
      (porPessoa[u.id] = porPessoa[u.id] || []).push(r);
    });
    porLogin[rfNorm_(titulo_(pr["LOGIN"]))] = r;
  });

  var atualizadas = 0, criadas = 0, semData = 0;
  membros.forEach(function (m) {
    var pr = m.properties || {};
    var nome = titulo_(pr["Nome"]);
    var nasc = pr["Data de Nascimento"] && pr["Data de Nascimento"].date && pr["Data de Nascimento"].date.start;
    var cargo = pr["Cargo"] && pr["Cargo"].select && pr["Cargo"].select.name;
    var setor = pr["Setor"] && pr["Setor"].select && pr["Setor"].select.name;
    var pessoa = ((pr["Pessoa"] && pr["Pessoa"].people) || [])[0];
    if (!nome) return;
    if (!nasc) semData++;

    var props = {};
    props[RF_COL.nasc]  = { date: nasc ? { start: String(nasc).slice(0, 10) } : null };
    props[RF_COL.cargo] = { select: cargo ? { name: cargo } : null };
    props[RF_COL.setor] = { select: setor ? { name: setor } : null };

    var alvos = (pessoa && porPessoa[pessoa.id]) || [];
    if (!alvos.length && porLogin[rfNorm_(nome)]) alvos = [porLogin[rfNorm_(nome)]];   // rodada anterior já criou

    if (alvos.length) {
      alvos.forEach(function (r) {
        notion_("PATCH", "/pages/" + r.id, { properties: props });
        atualizadas++;
        Logger.log("  atualizado: " + nome + " -> LOGIN " + titulo_(r.properties["LOGIN"]));
      });
      return;
    }
    props["LOGIN"] = { title: [{ text: { content: nome } }] };
    props["SENHA"] = { rich_text: [{ text: { content: RF_SENHA_TRAVADA } }] };
    if (pessoa) props["PESSOA"] = { people: [{ id: pessoa.id }] };
    notion_("POST", "/pages", { parent: { database_id: CONFIG.DB.LOGINS }, properties: props });
    criadas++;
    Logger.log("  CRIADO (sem acesso ao portal): " + nome + (pessoa ? "" : "  [sem Pessoa no Notion]"));
  });

  try { CacheService.getScriptCache().remove(RF_CACHE_ANIV); } catch (e) {}
  Logger.log(membros.length + " membros · " + atualizadas + " linhas do LOGINS atualizadas · " +
             criadas + " criadas" + (semData ? " · " + semData + " membro(s) sem data de nascimento" : ""));
}

/* ===================== 2) AÇÃO "aniversariantes" ===================== */
function rfAniversariantes_(sess, p) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(RF_CACHE_ANIV);
  if (hit && !(p && p.fresco)) return JSON.parse(hit);

  var rows = queryAll_(CONFIG.DB.LOGINS, {});
  var vistos = {}, lista = [];
  rows.forEach(function (r) {
    var pr = r.properties || {};
    var d = pr[RF_COL.nasc] && pr[RF_COL.nasc].date && pr[RF_COL.nasc].date.start;
    if (!d) return;
    var pes = ((pr["PESSOA"] && pr["PESSOA"].people) || [])[0];
    var nome = (pes && pes.name) || titulo_(pr["LOGIN"]);
    var chave = pes ? pes.id : "n:" + rfNorm_(nome);
    if (vistos[chave]) return;                 // mesma pessoa com dois logins
    vistos[chave] = 1;
    lista.push({
      id: String(chave).replace(/[^a-z0-9]/gi, "").slice(-12),
      nome: nome,
      dia: Number(String(d).slice(8, 10)),
      mes: Number(String(d).slice(5, 7)),
      cargo: (pr[RF_COL.cargo] && pr[RF_COL.cargo].select && pr[RF_COL.cargo].select.name) || "",
      setor: (pr[RF_COL.setor] && pr[RF_COL.setor].select && pr[RF_COL.setor].select.name) || ""
    });
  });
  lista.sort(function (a, b) { return a.mes - b.mes || a.dia - b.dia || (a.nome < b.nome ? -1 : 1); });
  var out = { ok: true, lista: lista, geradoEm: new Date().toISOString() };
  try { cache.put(RF_CACHE_ANIV, JSON.stringify(out), 1800); } catch (e) {}
  return out;
}

function rfNorm_(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* Teste pelo editor: mostra o que o card vai receber. */
function rfTesteAniversariantes() {
  var r = rfAniversariantes_({}, { fresco: 1 });
  Logger.log(r.lista.length + " pessoas com data:");
  r.lista.forEach(function (x) { Logger.log("  " + ("0" + x.dia).slice(-2) + "/" + ("0" + x.mes).slice(-2) + "  " + x.nome + "  · " + x.cargo + " · " + x.setor); });
}


/*************************************************************************
 * ================  PROCESSOS, ARQUIVOS e ATIVIDADES  =================
 * (25/09/26 — reta final; v2 às 17h). Tudo passa pelo rfRotear_, chamado no
 * começo do melhoriasRotear_ (Melhorias.gs m10+). Todas as ações ficam na
 * URL de LEITURA — o cache de cada coisa mora num projeto só.
 *
 * v2 — O QUE MUDOU E POR QUÊ
 *  • "atvMinhas" levava mais de 90 s: consultar as 1.893 atividades do
 *    Notion filtrando por pessoa, a cada abertura. Agora existe um RETRATO
 *    (snapshot) das atividades abertas + concluídas nos últimos 90 dias,
 *    guardado no cache e refeito a cada 10 min por um GATILHO
 *    (rfCriarGatilhoAtividades — rode UMA vez no projeto de LEITURA). Minhas,
 *    Equipe e o sino só filtram o retrato: respondem em segundos. Toda
 *    gravação pelo portal já corrige o retrato na hora.
 *  • Idem para as atividades das outras abas (Obras, Vendas, Documentos).
 *  • "Página não permitida" nos Processos: a conferência comparava o id do
 *    banco-pai, que a API devolve diferente para bancos novos do Notion. Agora
 *    reconhece a página pelas colunas (e sobe até a página-mãe, para abrir
 *    subpáginas — o jeito como a aba Arquivos organiza os documentos).
 *  • ARQUIVOS: é um banco sim ("Documentações (1)"), com as mesmas colunas
 *    dos Processos. Como é um banco do formato novo do Notion, a leitura cai
 *    para a API nova (data sources) quando a antiga recusa.
 *  • "atvAbrir": detalhe + comentários + conteúdo numa chamada só.
 *
 * v3 (25/09 noite)
 *  • CRIAÇÕES À PROVA DE DEMORA: atvCriar, atvModeloCriar e
 *    atvComentarioNovo aceitam opId. Se a resposta se perder no caminho, a
 *    tela pergunta "criou?" (ação atvOp) em vez de dar "erro desconhecido" —
 *    e um reenvio do mesmo opId nunca cria duas vezes.
 *  • Tipo "PORTAL": atividades desse tipo, abertas, aparecem no painel inicial
 *    com o conteúdo e o checklist (ação atvPortal), até serem finalizadas.
 *  • O gatilho também deixa prontas as listas de Processos e Arquivos (antes
 *    a primeira pessoa do dia esperava a montagem e estourava o tempo).
 *  • "fresco" não refaz mais o retrato inteiro (era isso que travava a fila
 *    quando alguém criava uma atividade): as gravações já corrigem o retrato.
 *
 * SUPABASE (uma vez): supabase-atividades.sql no SQL Editor.
 *************************************************************************/

var RF_PROC_DB  = "23ac5ab532d3815395a6daabacb54188";   // Documentações de Processos
var RF_ARQ_DB   = "30bc5ab532d380c19df8f5dded8b51b8";   // Documentações (1) — página ARQUIVOS
var RF_ATV_DB   = "23ac5ab532d3810b8b29ef6624c58089";   // (EMP) Atividades
var RF_OBRA_ATV = "306c5ab532d381fb864edee432bb128d";   // ATIVIDADES DE PROJETOS (aba Obras)
var RF_DOC_ATV  = "330c5ab532d38009b6c2d5d6b77b6926";   // ATIVIDADES CONTROLE DE DOCUMENTAÇÕES
var RF_BUCKET   = "atividades";
var RF_FIM      = "Finalizado";
var RF_TIPO_PROPRIA = "ATIVIDADE PRÓPRIA";
var RF_BASES    = { proc: RF_PROC_DB, arq: RF_ARQ_DB };
var RF_SNAP     = "rf_snap_atv_v2";
var RF_SNAP_OUT = "rf_snap_outras_v2";
var RF_SNAP_MAX = 25 * 60 * 1000;     // acima disso, refaz na hora (o gatilho mantém < 10 min)

/* acesso: null = todo logado · "EQUIPE" = só ADM/MASTER(/TESTES, que só lê) */
var RF_ACOES = {
  procLista:          { acesso: null },
  procCriar:          { acesso: null, grava: true },
  procUpdate:         { acesso: null, grava: true },
  blocos:             { acesso: null },
  blocoUpdate:        { acesso: null, grava: true },
  blocoNovo:          { acesso: null, grava: true },
  blocoExcluir:       { acesso: null, grava: true },
  atvMinhas:          { acesso: null },
  atvOutras:          { acesso: null },
  atvAlertas:         { acesso: null },
  atvEquipe:          { acesso: "EQUIPE" },
  atvDetalhe:         { acesso: null },
  atvAbrir:           { acesso: null },
  atvCriar:           { acesso: null, grava: true },
  atvUpdate:          { acesso: null, grava: true },
  atvComentarios:     { acesso: null },
  atvComentarioNovo:  { acesso: null, grava: true },
  atvModelos:         { acesso: null },
  atvModeloUpdate:    { acesso: null, grava: true },
  atvModeloExcluir:   { acesso: null, grava: true },
  atvModeloCriar:     { acesso: null, grava: true },
  atvOp:              { acesso: null },
  atvPortal:          { acesso: null }
};
/* criações protegidas por opId (ver v3 no topo) */
var RF_COM_OPID = { atvCriar: 1, atvModeloCriar: 1, atvComentarioNovo: 1, procCriar: 1 };

function rfRotear_(action, sess, p) {
  var cfg = RF_ACOES[action];
  if (!cfg) return null;
  if (cfg.acesso === "EQUIPE" && !vePorTodos_(sess)) return { ok: false, erro: "SEM_PERMISSAO" };
  if (cfg.grava && ehTestes_(sess)) return { ok: false, erro: "MODO_TESTE" };
  p = p || {};
  if (action === "atvOp") {
    if (!p.opId) return { ok: false, erro: "FALTA_PARAM" };
    var ro = opIdLer_(p.opId);
    return { ok: true, achado: !!ro, resultado: ro || null, andando: !ro && opIdAndando_(p.opId) };
  }
  if (RF_COM_OPID[action] && p.opId) {
    var ja = opIdLer_(p.opId);
    if (ja) return ja;                                         // reenvio: devolve o que já foi feito
    if (opIdAndando_(p.opId)) return { ok: false, erro: "EM_ANDAMENTO" };
    opIdIniciar_(p.opId);
    var rr = rfExecutar_(action, sess, p);
    if (rr && rr.ok) opIdGravar_(p.opId, rr);
    else try { _cache_().remove(opIdChave_(p.opId) + "::and"); } catch (e) {}
    return rr;
  }
  return rfExecutar_(action, sess, p);
}
function rfExecutar_(action, sess, p) {
  try {
    switch (action) {
      case "procLista":         return rfProcLista_(sess, p);
      case "procCriar":         return rfProcCriar_(sess, p);
      case "procUpdate":        return rfProcUpdate_(sess, p);
      case "blocos":            return rfBlocos_(sess, p);
      case "blocoUpdate":       return rfBlocoUpdate_(sess, p);
      case "blocoNovo":         return rfBlocoNovo_(sess, p);
      case "blocoExcluir":      return rfBlocoExcluir_(sess, p);
      case "atvMinhas":         return rfAtvMinhas_(sess, p);
      case "atvOutras":         return rfAtvOutras_(sess, p);
      case "atvAlertas":        return rfAtvAlertas_(sess, p);
      case "atvEquipe":         return rfAtvEquipe_(sess, p);
      case "atvDetalhe":        return rfAtvDetalhe_(sess, p);
      case "atvAbrir":          return rfAtvAbrir_(sess, p);
      case "atvCriar":          return rfAtvCriar_(sess, p);
      case "atvUpdate":         return rfAtvUpdate_(sess, p);
      case "atvComentarios":    return rfAtvComentarios_(sess, p);
      case "atvComentarioNovo": return rfAtvComentarioNovo_(sess, p);
      case "atvModelos":        return rfModelos_(sess, p);
      case "atvModeloUpdate":   return rfModeloUpdate_(sess, p);
      case "atvModeloExcluir":  return rfModeloExcluir_(sess, p);
      case "atvModeloCriar":    return rfModeloGerar_(sess, p);
      case "atvPortal":         return rfAtvPortal_(sess, p);
    }
  } catch (e) {
    console.log("RF " + action + " falhou: " + e);
    return { ok: false, erro: String(e).slice(0, 300) };
  }
  return null;
}

/* ---------------------------- utilitários ---------------------------- */
function rfSH_(id) { return String(id || "").replace(/-/g, ""); }
function rfHoje_() { return Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd"); }
function rfMaisDias_(iso, n) {
  var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, "America/Sao_Paulo", "yyyy-MM-dd");
}
function rfFimDoMes_(iso) {
  var d = new Date(iso + "T12:00:00"); var f = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return Utilities.formatDate(f, "America/Sao_Paulo", "yyyy-MM-dd");
}
function rfRT_(pp) { return (pp || []).map(function (x) { return x.plain_text || ""; }).join(""); }
function rfTxt_(v) { return [{ type: "text", text: { content: String(v == null ? "" : v).slice(0, 1900) } }]; }
function rfPess_(pp) { return ((pp && pp.people) || []).map(function (u) { return { id: rfSH_(u.id), nome: u.name || "" }; }); }
function rfSel_(pp) { return pp && pp.select ? pp.select.name : (pp && pp.status ? pp.status.name : null); }
function rfDt_(pp) { return pp && pp.date && pp.date.start ? String(pp.date.start).slice(0, 10) : null; }
function rfRel_(pp) { return ((pp && pp.relation) || []).map(function (r) { return rfSH_(r.id); }); }
function rfForm_(pp) {
  if (!pp || !pp.formula) return null;
  var f = pp.formula; var v = f[f.type];
  if (f.type === "date") return v && v.start ? String(v.start).slice(0, 10) : null;
  return v == null ? null : v;
}
function rfMe_(sess) { return rfSH_(sess && sess.p); }
function rfPessoaIds_(arr) {
  return (arr || []).map(function (x) { return String(x || "").trim(); }).filter(Boolean)
    .map(function (id) { return { id: id }; });
}

/* ------------- consultas que funcionam nos bancos novos do Notion -------------
 * Banco "de formato novo" (várias fontes de dados) é recusado pela API antiga
 * (2022-06-28, a do portal). Aí a leitura vai pela API nova: acha a fonte de
 * dados do banco e consulta ela. Guarda qual caminho funcionou (6 h). */
function rfFonte_(dbId) {
  var ck = "rf_fonte_" + dbId, c = null;
  try { c = _cache_().get(ck); } catch (e) {}
  if (c) return c === "db" ? null : c;
  try { notion_("GET", "/databases/" + dbId); try { _cache_().put(ck, "db", 21600); } catch (e) {} return null; }
  catch (e) {
    var db = obraNotionV_("GET", "/databases/" + dbId, null);
    var ds = (db.data_sources || [])[0];
    if (!ds || !ds.id) throw e;
    try { _cache_().put(ck, ds.id, 21600); } catch (e2) {}
    return ds.id;
  }
}
function rfQuery_(dbId, body) {
  var ds = rfFonte_(dbId);
  if (!ds) return queryAll_(dbId, body || {});
  var out = [], cursor = null, n = 0;
  do {
    var b = {}; for (var k in (body || {})) b[k] = body[k];
    b.page_size = 100; if (cursor) b.start_cursor = cursor;
    var r = obraNotionV_("POST", "/data_sources/" + ds + "/query", b);
    out = out.concat(r.results || []);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++n < 20);
  return out;
}
function rfSchema_(dbId) {
  var ds = rfFonte_(dbId);
  if (!ds) return notion_("GET", "/databases/" + dbId).properties || {};
  return obraNotionV_("GET", "/data_sources/" + ds, null).properties || {};
}
function rfCriarPagina_(dbId, props, filhos) {
  var ds = rfFonte_(dbId);
  var corpo = { properties: props };
  if (filhos && filhos.length) corpo.children = filhos.slice(0, 90);
  if (!ds) { corpo.parent = { database_id: dbId }; return notion_("POST", "/pages", corpo); }
  corpo.parent = { type: "data_source_id", data_source_id: ds };
  return obraNotionV_("POST", "/pages", corpo);
}

/* ------------- a página pode ser lida/editada pelo portal? -------------
 * Reconhece pelas COLUNAS (não pelo id do banco-pai, que muda conforme a
 * versão da API) e sobe pelas páginas-mãe, para as subpáginas dos Arquivos. */
function rfQualPagina_(pg) {
  var P = pg.properties || {}, dbp = rfSH_((pg.parent || {}).database_id || (pg.parent || {}).data_source_id);
  if (dbp === RF_ATV_DB || (P["Atividade"] && P["Solicitante"] && P["Data Final"])) return "atv:" + rfSH_(pg.id);
  if (dbp === RF_PROC_DB || dbp === RF_ARQ_DB || (P["Categoria"] && P["Proprietário"] && P["Status"] && P["Verificação"])) return "proc";
  return null;
}
function rfConferePagina_(id) {
  var ck = "rf_pgok2_" + rfSH_(id);
  var hit = null; try { hit = _cache_().get(ck); } catch (e) {}
  if (hit) return hit;
  var atual = id;
  for (var n = 0; n < 8 && atual; n++) {
    var pg = null; try { pg = notion_("GET", "/pages/" + atual); } catch (e) {}
    var par;
    if (pg && pg.object === "page") {
      var qual = rfQualPagina_(pg);
      if (qual) { try { _cache_().put(ck, qual, 21600); } catch (e) {} return qual; }
      par = pg.parent || {};
    } else {
      var b = notion_("GET", "/blocks/" + atual);
      par = b.parent || {};
    }
    atual = par.page_id || par.block_id || null;
  }
  console.log("RF: página não reconhecida " + id);
  throw "PAGINA_NAO_PERMITIDA";
}

/* ================= PROCESSOS e ARQUIVOS (mesmo formato) ================= */
function rfBase_(p) { return p && p.base === "arq" ? "arq" : "proc"; }
function rfColunas_(sch) {
  var c = { titulo: null, cat: null, status: null, dono: null };
  Object.keys(sch).forEach(function (k) {
    var t = sch[k].type, n = rfNorm_(k);
    if (t === "title") c.titulo = k;
    if ((t === "multi_select" || t === "select") && n === "categoria") c.cat = k;
    if (t === "status" && !c.status) c.status = k;
    if (t === "people" && n.indexOf("propriet") === 0) c.dono = k;
  });
  return c;
}
function rfProcLista_(sess, p) {
  var base = rfBase_(p), db = RF_BASES[base], ck = "rf_lista_" + base + "_v2";
  if (p.fresco) cacheRemover_(ck);
  return comCache_(ck, 3600, function () {
    var sch = rfSchema_(db), c = rfColunas_(sch);
    var ops = function (col) { if (!col) return []; var t = sch[col].type; return ((sch[col][t] && sch[col][t].options) || []).map(function (o) { return o.name; }); };
    var lista = rfQuery_(db, {}).map(function (pg) {
      var P = pg.properties || {}, cv = c.cat ? P[c.cat] : null;
      var cats = cv ? (cv.multi_select ? cv.multi_select.map(function (o) { return o.name; }) : (cv.select ? [cv.select.name] : [])) : [];
      return {
        id: rfSH_(pg.id), titulo: (c.titulo && titulo_(P[c.titulo])) || "(sem título)", categorias: cats,
        status: c.status ? rfSel_(P[c.status]) : null,
        dono: c.dono ? rfPess_(P[c.dono]).map(function (u) { return u.nome; }).join(", ") : "",
        editado: pg.last_edited_time, icone: pg.icon && pg.icon.type === "emoji" ? pg.icon.emoji : ""
      };
    }).sort(function (a, b) { return a.titulo.localeCompare(b.titulo); });
    return { ok: true, base: base, categorias: ops(c.cat), catMulti: !!(c.cat && sch[c.cat].type === "multi_select"),
             status: ops(c.status), processos: lista };
  });
}
function rfProcCriar_(sess, p) {
  var base = rfBase_(p), db = RF_BASES[base];
  var t = String(p.titulo || "").trim();
  if (!t) return { ok: false, erro: "INFORME_O_TITULO" };
  var sch = rfSchema_(db), c = rfColunas_(sch), props = {};
  props[c.titulo] = { title: rfTxt_(t) };
  var cats = [].concat(p.categorias || []).filter(Boolean);
  if (c.cat && cats.length) props[c.cat] = sch[c.cat].type === "multi_select"
    ? { multi_select: cats.map(function (x) { return { name: x }; }) } : { select: { name: cats[0] } };
  if (c.status && p.status) props[c.status] = { status: { name: p.status } };
  if (c.dono && sess.p) props[c.dono] = { people: [{ id: sess.p }] };
  var pg = rfCriarPagina_(db, props);
  cacheRemover_("rf_lista_" + base + "_v2");
  return { ok: true, id: rfSH_(pg.id), pageId: rfSH_(pg.id) };
}
function rfProcUpdate_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  if (rfConferePagina_(p.pageId) !== "proc") return { ok: false, erro: "PAGINA_NAO_PERMITIDA" };
  var base = rfBase_(p), sch = rfSchema_(RF_BASES[base]), c = rfColunas_(sch), props = {};
  if (p.excluir) { notion_("PATCH", "/pages/" + p.pageId, { archived: true }); cacheRemover_("rf_lista_" + base + "_v2"); return { ok: true, excluido: true }; }
  if (p.titulo !== undefined) props[c.titulo] = { title: rfTxt_(String(p.titulo).trim() || "(sem título)") };
  if (p.categorias !== undefined && c.cat) {
    var cats = [].concat(p.categorias || []).filter(Boolean);
    props[c.cat] = sch[c.cat].type === "multi_select" ? { multi_select: cats.map(function (x) { return { name: x }; }) }
                                                     : { select: cats.length ? { name: cats[0] } : null };
  }
  if (p.status !== undefined && c.status) props[c.status] = { status: p.status ? { name: p.status } : null };
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  cacheRemover_("rf_lista_" + base + "_v2");
  return { ok: true };
}

/* ================== CONTEÚDO DA PÁGINA (editor de blocos) ==================
 * v2: devolve também a FORMATAÇÃO (negrito, link, menção a página) em "rt".
 * Bloco com formatação aparece formatado; editar pede confirmação (vira
 * texto simples). Link para subpágina / subpágina abrem dentro do portal. */
var RF_TXT = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item",
              "to_do", "toggle", "quote", "callout", "code"];
var RF_NOVOS = ["paragraph", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout", "divider"];

function rfFilhos_(id) {
  var out = [], cursor = null, n = 0;
  do {
    var r = notion_("GET", "/blocks/" + id + "/children?page_size=100" + (cursor ? "&start_cursor=" + cursor : ""));
    out = out.concat(r.results || []);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++n < 10);
  return out;
}
function rfRico_(rich) {
  var tem = false;
  var seg = (rich || []).map(function (x) {
    var a = x.annotations || {}, o = { t: x.plain_text || "" };
    if (a.bold) o.b = 1; if (a.italic) o.i = 1; if (a.underline) o.u = 1; if (a.strikethrough) o.s = 1; if (a.code) o.c = 1;
    if (x.href) o.h = x.href;
    if (x.type === "mention" && x.mention && x.mention.type === "page") o.p = rfSH_(x.mention.page.id);
    if (o.b || o.i || o.u || o.s || o.c || o.h || o.p) tem = true;
    return o;
  });
  return tem ? seg : null;
}
function rfTituloPagina_(id) {
  var ck = "rf_tit_" + rfSH_(id), c = null;
  try { c = _cache_().get(ck); } catch (e) {}
  if (c) return c;
  var t = "";
  try { var pg = notion_("GET", "/pages/" + id); t = tituloDe_(pg.properties || {}) || ""; } catch (e) { t = ""; }
  try { _cache_().put(ck, t || "(página)", 21600); } catch (e) {}
  return t || "(página)";
}
function rfBloco_(b, nivel) {
  var t = b.type, v = b[t] || {};
  var o = { id: rfSH_(b.id), tipo: t, nivel: nivel || 0 };
  if (RF_TXT.indexOf(t) >= 0) {
    o.texto = rfRT_(v.rich_text); o.editavel = true;
    var rico = rfRico_(v.rich_text); if (rico) o.rt = rico;
    if (t === "to_do") o.feito = !!v.checked;
    if (t === "callout" && v.icon && v.icon.emoji) o.icone = v.icon.emoji;
  } else if (t === "image" || t === "file" || t === "pdf" || t === "video") {
    o.url = (v.file && v.file.url) || (v.external && v.external.url) || null;
    o.nome = v.name || rfRT_(v.caption) || t;
  } else if (t === "bookmark" || t === "embed" || t === "link_preview") {
    o.url = v.url || null;
  } else if (t === "child_page") { o.texto = v.title || ""; o.pagina = rfSH_(b.id); }
  else if (t === "link_to_page") { var alvo = v.page_id || v.database_id; o.pagina = rfSH_(alvo); o.texto = v.page_id ? rfTituloPagina_(v.page_id) : "(banco)"; }
  else if (t === "child_database") { o.texto = v.title || ""; }
  if (t === "table") {
    o.linhas = rfFilhos_(b.id).map(function (row) {
      return { id: rfSH_(row.id), cel: ((row.table_row && row.table_row.cells) || []).map(rfRT_) };
    });
    o.cabecalho = !!v.has_column_header;
  } else if (b.has_children && nivel < 3 && t !== "child_page" && t !== "child_database" && t !== "synced_block") {
    o.filhos = rfFilhos_(b.id).map(function (f) { return rfBloco_(f, (nivel || 0) + 1); });
  }
  return o;
}
function rfBlocosLer_(pageId, fresco, semTitulo) {
  var ck = "rf_blocos_" + rfSH_(pageId);
  if (!fresco) { var c = cacheGet_(ck); if (c) return c; }
  var titulo = "";
  if (!semTitulo) { try { titulo = rfTituloPagina_(pageId); } catch (e) {} }
  var r = { ok: true, pageId: rfSH_(pageId), titulo: titulo, blocos: rfFilhos_(pageId).map(function (b) { return rfBloco_(b, 0); }), lidoEm: new Date().toISOString() };
  cachePut_(ck, r, 300);
  return r;
}
function rfBlocos_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  rfConferePagina_(p.pageId);
  return rfBlocosLer_(p.pageId, p.fresco);
}
function rfLimpaBlocos_(qual, pageId) {
  try { cacheRemover_("rf_portal_v1"); } catch (e) {}
  if (pageId) cacheRemover_("rf_blocos_" + rfSH_(pageId));
  if (qual && qual.indexOf("atv:") === 0) cacheRemover_("rf_blocos_" + qual.slice(4));
}

/* ------------------------------ Supabase ------------------------------ */
function rfSupa_(method, caminho, corpo, extra) {
  var cfg = supaCfg_();
  var h = { apikey: cfg.key, Authorization: "Bearer " + cfg.key, Accept: "application/json" };
  for (var k in (extra || {})) h[k] = extra[k];
  var opt = { method: method, muteHttpExceptions: true, headers: h };
  if (corpo !== undefined && corpo !== null) { opt.contentType = "application/json"; opt.payload = JSON.stringify(corpo); }
  var r = UrlFetchApp.fetch(cfg.url + "/rest/v1/" + caminho, opt);
  var code = r.getResponseCode(), txt = r.getContentText();
  if (code >= 300) throw "SUPABASE_" + code + ": " + txt.slice(0, 200);
  return txt ? JSON.parse(txt) : null;
}
function rfSubir_(caminho, mime, b64) {
  var cfg = supaCfg_();
  var r = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/" + RF_BUCKET + "/" + caminho, {
    method: "post", muteHttpExceptions: true,
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "x-upsert": "true" },
    contentType: mime || "application/octet-stream",
    payload: Utilities.base64Decode(b64)
  });
  if (r.getResponseCode() >= 300) throw "UPLOAD_FALHOU: " + r.getContentText().slice(0, 200);
  return caminho;
}
function rfAssinar_(caminhos) {
  if (!caminhos.length) return {};
  var cfg = supaCfg_();
  var r = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/sign/" + RF_BUCKET, {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
    payload: JSON.stringify({ expiresIn: 3600, paths: caminhos })
  });
  var out = {};
  if (r.getResponseCode() >= 300) return out;
  (JSON.parse(r.getContentText()) || []).forEach(function (x) {
    var rel = x.signedURL || x.signedUrl; if (x.path && rel) out[x.path] = cfg.url + "/storage/v1" + (rel.charAt(0) === "/" ? "" : "/") + rel;
  });
  return out;
}


function rfBlocoUpdate_(sess, p) {
  if (!p.blockId) return { ok: false, erro: "FALTA_PARAM" };
  var qual = rfConferePagina_(p.blockId);
  var b = notion_("GET", "/blocks/" + p.blockId);
  var t = b.type, corpo = {};
  if (t === "table_row") {
    corpo.table_row = { cells: [].concat(p.celulas || []).map(function (c) { return rfTxt_(c); }) };
  } else if (RF_TXT.indexOf(t) >= 0) {
    var v = {};
    if (p.texto !== undefined) v.rich_text = rfTxt_(p.texto);
    if (t === "to_do" && p.feito !== undefined) v.checked = !!(p.feito === true || p.feito === "true" || p.feito === 1);
    corpo[t] = v;
  } else return { ok: false, erro: "TIPO_NAO_EDITAVEL: " + t };
  notion_("PATCH", "/blocks/" + p.blockId, corpo);
  rfLimpaBlocos_(qual, p.pageId);
  return { ok: true, pageId: p.pageId || null };
}
function rfNovoBlocoJson_(tipo, texto) {
  if (RF_NOVOS.indexOf(tipo) < 0) tipo = "paragraph";
  var o = { object: "block", type: tipo };
  if (tipo === "divider") { o.divider = {}; return o; }
  o[tipo] = { rich_text: rfTxt_(texto || "") };
  if (tipo === "to_do") o[tipo].checked = false;
  if (tipo === "callout") o[tipo].icon = { type: "emoji", emoji: "💡" };
  return o;
}
function rfBlocoNovo_(sess, p) {
  var alvo = p.paiId || p.pageId;
  if (!alvo) return { ok: false, erro: "FALTA_PARAM" };
  var qual = rfConferePagina_(alvo);
  var itens = p.itens && p.itens.length ? p.itens : [{ tipo: p.tipo, texto: p.texto }];
  var corpo = { children: itens.map(function (x) { return rfNovoBlocoJson_(x.tipo || p.tipo, x.texto); }) };
  if (p.depoisDe) corpo.after = p.depoisDe;
  var r = notion_("PATCH", "/blocks/" + alvo + "/children", corpo);
  rfLimpaBlocos_(qual, p.pageId || alvo);
  return { ok: true, pageId: p.pageId || alvo, ids: (r.results || []).map(function (b) { return rfSH_(b.id); }) };
}
function rfBlocoExcluir_(sess, p) {
  if (!p.blockId) return { ok: false, erro: "FALTA_PARAM" };
  var qual = rfConferePagina_(p.blockId);
  notion_("DELETE", "/blocks/" + p.blockId);
  rfLimpaBlocos_(qual, p.pageId);
  return { ok: true, pageId: p.pageId || null };
}



/* =============================== ATIVIDADES =============================== */
function rfAtvDe_(pg) {
  var P = pg.properties || {};
  return {
    id: rfSH_(pg.id), titulo: titulo_(P["Atividade"]) || "(sem título)",
    status: rfSel_(P["Status"]), tipo: rfSel_(P["Tipo"]), prioridade: rfSel_(P["Prioridade"]),
    ini: rfDt_(P["Data de Início"]), fim: rfDt_(P["Data Final"]), concl: rfDt_(P["Data de Conclusão"]),
    resp: rfPess_(P["Responsável"]), solic: rfPess_(P["Solicitante"]),
    obraId: (rfRel_(P["(EMP) Projeto 2.0"])[0]) || null,
    pai: (rfRel_(P["item principal"])[0]) || null, nSub: rfRel_(P["Subitem"]).length,
    prazo: rfForm_(P["Contro de Prazo"]),
    criado: String(pg.created_time || "").slice(0, 10), editado: pg.last_edited_time
  };
}

/* ---------- RETRATO das atividades (refeito pelo gatilho a cada 10 min) ---------- */
function rfSnapConstruir_() {
  var desde = rfMaisDias_(rfHoje_(), -90);
  var rows = rfQuery_(RF_ATV_DB, { filter: { or: [
    { property: "Status", status: { does_not_equal: RF_FIM } },
    { property: "Data de Conclusão", date: { on_or_after: desde } } ] } });
  var snap = { t: Date.now(), atividades: rows.map(rfAtvDe_) };
  cachePut_(RF_SNAP, snap, 21600);
  return snap;
}
function rfSnap_() {
  var s = cacheGet_(RF_SNAP);
  if (s && s.t && (Date.now() - s.t) < RF_SNAP_MAX) return s;
  var lock = LockService.getScriptLock();
  var pegou = false; try { pegou = lock.tryLock(25000); } catch (e) {}
  try {
    s = cacheGet_(RF_SNAP);                                  // outro pedido pode ter acabado de refazer
    if (s && s.t && (Date.now() - s.t) < RF_SNAP_MAX) return s;
    return rfSnapConstruir_();
  } finally { if (pegou) try { lock.releaseLock(); } catch (e) {} }
}
/* gravação pelo portal: corrige o retrato na hora (sem esperar o gatilho) */
function rfSnapPatch_(a) {
  try { cacheRemover_("rf_portal_v1"); } catch (e) {}
  var s = cacheGet_(RF_SNAP); if (!s || !a) return;
  var i = -1; for (var k = 0; k < s.atividades.length; k++) if (s.atividades[k].id === a.id) { i = k; break; }
  if (i >= 0) s.atividades[i] = a; else s.atividades.push(a);
  cachePut_(RF_SNAP, s, 21600);
}

/* atividades das OUTRAS abas, de todo mundo, agrupadas por pessoa */
function rfSnapOutrasConstruir_() {
  var itens = [], avisos = [];
  try {
    rfQuery_(RF_OBRA_ATV, {}).forEach(function (pg) {
      var P = pg.properties || {}, st = rfSel_(P["Status"]) || "";
      if (/finaliz|conclu|cancel/i.test(st) || rfDt_(P["Data De Conclusão da Atividade"])) return;
      itens.push({ origem: "Obras", link: "obras.html", id: rfSH_(pg.id), titulo: tituloDe_(P), status: st, tipo: rfSel_(P["Tipo"]),
                   fim: rfDt_(P["Data Final Prevista"]), obraId: (rfRel_(P["(EMP) Projeto 2.0"])[0]) || null,
                   resp: rfPess_(P["Responsável"]).map(function (u) { return u.id; }) });
    });
  } catch (e) { avisos.push("Obras: " + String(e).slice(0, 80)); }
  try {
    rfQuery_(CONFIG.DB.ATIVIDADES_VENDAS, { filter: { property: "ATIVIDADE FINALIZADA", formula: { string: { contains: "NÃO" } } } }).forEach(function (pg) {
      var P = pg.properties || {};
      itens.push({ origem: "Vendas", link: "vendas.html", id: rfSH_(pg.id), titulo: titulo_(P["Nome"]), status: "Em aberto",
                   tipo: sel_(P["TIPO"]), fim: rfDt_(P["DATA FINAL PREVISTA"]), ini: rfDt_(P["DATA INICIAL"]),
                   obraId: (rfRel_(P["OBRA"])[0]) || null, resp: rfPess_(P["RESPONSÁVEL"]).map(function (u) { return u.id; }) });
    });
  } catch (e) { avisos.push("Vendas: " + String(e).slice(0, 80)); }
  try {
    var sch = rfSchema_(RF_DOC_ATV), colResp = null, colIni = null, colFim = null, colTipo = null;
    Object.keys(sch).forEach(function (k) {
      var n = rfNorm_(k).toUpperCase(), t = sch[k].type;
      if (t === "people" && n.indexOf("RESPONS") >= 0 && !colResp) colResp = k;
      if (t === "date" && n.indexOf("INICIAL") >= 0) colIni = k;
      if (t === "date" && n.indexOf("FINAL") >= 0 && !colFim) colFim = k;
      if (n === "TIPO") colTipo = k;
    });
    rfQuery_(RF_DOC_ATV, {}).forEach(function (pg) {
      var P = pg.properties || {};
      if (typeof docsAtvFeita_ === "function" && docsAtvFeita_(P)) return;
      itens.push({ origem: "Documentos", link: "documentos.html", id: rfSH_(pg.id), titulo: tituloDe_(P), status: "Em aberto",
                   tipo: colTipo ? rfSel_(P[colTipo]) : null, fim: colFim ? rfDt_(P[colFim]) : null, ini: colIni ? rfDt_(P[colIni]) : null,
                   resp: colResp ? rfPess_(P[colResp]).map(function (u) { return u.id; }) : [] });
    });
  } catch (e) { avisos.push("Documentos: " + String(e).slice(0, 80)); }
  var snap = { t: Date.now(), itens: itens, avisos: avisos };
  cachePut_(RF_SNAP_OUT, snap, 21600);
  return snap;
}
function rfSnapOutras_() {
  var s = cacheGet_(RF_SNAP_OUT);
  if (s && s.t && (Date.now() - s.t) < RF_SNAP_MAX) return s;
  return rfSnapOutrasConstruir_();
}

/* GATILHO — rode rfCriarGatilhoAtividades() UMA vez no projeto de LEITURA.
   A cada 10 min (das 6h às 21h) refaz os dois retratos; fora desse horário
   não gasta cota — o primeiro acesso do dia refaz na hora. */
function rfAquecerAtividades() {
  var h = Number(Utilities.formatDate(new Date(), "America/Sao_Paulo", "H"));
  if (h < 6 || h > 21) return;
  var t0 = Date.now();
  rfSnapConstruir_();
  rfSnapOutrasConstruir_();
  ["proc", "arq"].forEach(function (b) {
    var ck = "rf_lista_" + b + "_v2", env = cacheGet_(ck);
    if (!env || !env.t || Date.now() - env.t > 20 * 60 * 1000) {
      try { cacheRemover_(ck); rfProcLista_({}, { base: b }); } catch (e) { console.log("RF lista " + b + ": " + e); }
    }
  });
  try { cacheRemover_("rf_portal_v1"); rfAtvPortal_({}, {}); } catch (e) {}
  console.log("RF aquecimento: " + (Date.now() - t0) + " ms");
}
function rfCriarGatilhoAtividades() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "rfAquecerAtividades") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("rfAquecerAtividades").timeBased().everyMinutes(10).create();
  rfSnapConstruir_(); rfSnapOutrasConstruir_();
  ["proc", "arq"].forEach(function (b) { try { cacheRemover_("rf_lista_" + b + "_v2"); rfProcLista_({}, { base: b }); } catch (e) { Logger.log("lista " + b + ": " + e); } });
  var s = cacheGet_(RF_SNAP), o = cacheGet_(RF_SNAP_OUT);
  Logger.log("Gatilho criado. Retrato: " + ((s && s.atividades.length) || 0) + " atividades · outras abas: " + ((o && o.itens.length) || 0) +
             ((o && o.avisos && o.avisos.length) ? " · avisos: " + o.avisos.join(" | ") : ""));
}

function rfLimpaPessoas_(ids) { /* v2: o retrato é corrigido por rfSnapPatch_ — nada a limpar por pessoa */ }

function rfAtvOpcoes_() {
  return comCache_("rf_atv_opcoes_v1", 3600, function () {
    var pr = rfSchema_(RF_ATV_DB);
    var ops = function (c, t) { return ((pr[c] && pr[c][t] && pr[c][t].options) || []).map(function (o) { return o.name; }); };
    var tipos = ops("Tipo", "select");
    if (tipos.indexOf("PORTAL") < 0) tipos.unshift("PORTAL");      // v3: tipo que aparece no painel
    return { status: ops("Status", "status"), tipo: tipos, prioridade: ops("Prioridade", "select") };
  });
}
/* pessoas que podem receber atividade: quem tem PESSOA no LOGINS */
function rfPessoas_() {
  return comCache_("rf_pessoas_v1", 1800, function () {
    var vistos = {}, out = [];
    queryAll_(CONFIG.DB.LOGINS, {}).forEach(function (r) {
      ((r.properties["PESSOA"] && r.properties["PESSOA"].people) || []).forEach(function (u) {
        var id = rfSH_(u.id); if (vistos[id] || !u.name) return; vistos[id] = 1;
        out.push({ id: id, nome: u.name });
      });
    });
    out.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    return out;
  });
}

function rfMinhasDe_(me) {
  var desde = rfMaisDias_(rfHoje_(), -30), s = rfSnap_();
  var eh = function (l) { return (l || []).some(function (u) { return u.id === me; }); };
  var l = s.atividades.filter(function (a) {
    if (!(eh(a.resp) || eh(a.solic))) return false;
    return a.status !== RF_FIM || (a.concl && a.concl >= desde);
  });
  l.sort(function (a, b) { return String(a.fim || "9999").localeCompare(String(b.fim || "9999")); });
  return { atividades: l, t: s.t };
}
function rfAtvMinhas_(sess, p) {
  var me = rfMe_(sess);
  if (!me) return { ok: true, atividades: [], pessoas: rfPessoas_(), opcoes: rfAtvOpcoes_(), aviso: "SEU_LOGIN_SEM_PESSOA" };
  var m = rfMinhasDe_(me);
  return { ok: true, me: me, atividades: m.atividades, pessoas: rfPessoas_(), opcoes: rfAtvOpcoes_(),
           lidoEm: new Date(m.t).toISOString() };
}
function rfOutrasDe_(me) {
  var s = rfSnapOutras_();
  return { itens: s.itens.filter(function (x) { return (x.resp || []).indexOf(me) >= 0; }), avisos: s.avisos || [] };
}
function rfAtvOutras_(sess, p) {
  var me = rfMe_(sess);
  if (!me) return { ok: true, itens: [] };
  var o = rfOutrasDe_(me);
  return { ok: true, itens: o.itens, avisos: o.avisos };
}

/* Sino do cabeçalho. v2: devolve junto "minhas" e "outras" — o painel já
   deixa a aba Atividades pré-carregada no navegador. */
function rfAtvAlertas_(sess, p) {
  var me = rfMe_(sess), hoje = rfHoje_(), atras = [], hojeL = [];
  if (!me) return { ok: true, atrasadas: [], hoje: [] };
  var m = rfMinhasDe_(me), o = rfOutrasDe_(me);
  m.atividades.forEach(function (a) {
    if (a.status === RF_FIM || !a.fim) return;
    if (!a.resp.some(function (u) { return u.id === me; })) return;
    var x = { id: a.id, titulo: a.titulo, fim: a.fim, origem: "Atividades", link: "atividades.html#" + a.id };
    if (a.fim < hoje) atras.push(x); else if (a.fim === hoje) hojeL.push(x);
  });
  o.itens.forEach(function (a) {
    if (!a.fim) return;
    var x = { id: a.id, titulo: a.titulo, fim: a.fim, origem: a.origem, link: a.link };
    if (a.fim < hoje) atras.push(x); else if (a.fim === hoje) hojeL.push(x);
  });
  atras.sort(function (a, b) { return a.fim < b.fim ? -1 : 1; });
  var out = { ok: true, atrasadas: atras, hoje: hojeL };
  if (p.comDados) {
    out.minhas = { ok: true, me: me, atividades: m.atividades, pessoas: rfPessoas_(), opcoes: rfAtvOpcoes_(), lidoEm: new Date(m.t).toISOString() };
    out.outras = { ok: true, itens: o.itens, avisos: o.avisos };
  }
  return out;
}

/* Visão da equipe (ADM/MASTER): o retrato inteiro */
function rfAtvEquipe_(sess, p) {
  var s = rfSnap_();
  return { ok: true, atividades: s.atividades, lidoEm: new Date(s.t).toISOString() };
}

/* Tipo PORTAL: abertas, com o conteúdo (checklist etc.), para o painel inicial.
   Todo mundo logado vê. Cache de 1 min; gravações nelas limpam na hora. */
function rfAtvPortal_(sess, p) {
  if (p && p.fresco) cacheRemover_("rf_portal_v1");
  var r = comCache_("rf_portal_v1", 60, function () {
    var l = rfSnap_().atividades.filter(function (a) { return rfNorm_(a.tipo) === "portal" && a.status !== RF_FIM; });
    l.sort(function (a, b) { return String(a.fim || "9999").localeCompare(String(b.fim || "9999")); });
    return { ok: true, atividades: l.slice(0, 12).map(function (a) {
      var c = null; try { c = rfBlocosLer_(a.id, false, true); } catch (e) {}
      return { atividade: a, conteudo: c };
    }) };
  });
  var out = { ok: true, atividades: [] };
  (r.atividades || []).forEach(function (x) { out.atividades.push({ atividade: x.atividade, conteudo: x.conteudo, podeEditar: sess && sess.u ? rfPodeMexer_(sess, x.atividade) : false }); });
  return out;
}

function rfPodeMexer_(sess, a) {
  if (vePorTodos_(sess)) return true;
  var me = rfMe_(sess);
  return !!me && (a.resp.concat(a.solic)).some(function (u) { return u.id === me; });
}
function rfAtvPagina_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId);
  var q = rfQualPagina_(pg);
  if (!q || q.indexOf("atv:") !== 0) throw "NAO_E_ATIVIDADE";
  return pg;
}
function rfAtvDetalhe_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var a = rfAtvDe_(rfAtvPagina_(p.pageId));
  rfSnapPatch_(a);
  return { ok: true, atividade: a, podeEditar: rfPodeMexer_(sess, a) };
}
/* abrir a atividade: tudo numa chamada só (detalhe + comentários + conteúdo) */
function rfAtvAbrir_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var id = rfSH_(p.pageId), a = null;
  var s = cacheGet_(RF_SNAP);
  if (s) for (var i = 0; i < s.atividades.length; i++) if (s.atividades[i].id === id) { a = s.atividades[i]; break; }
  if (!a) { a = rfAtvDe_(rfAtvPagina_(id)); rfSnapPatch_(a); }
  try { _cache_().put("rf_pgok2_" + id, "atv:" + id, 21600); } catch (e) {}
  var out = { ok: true, pageId: id, atividade: a, podeEditar: rfPodeMexer_(sess, a) };
  try { out.comentarios = rfAtvComentarios_(sess, { pageId: id }).comentarios; } catch (e) { out.erroComentarios = String(e).slice(0, 160); }
  try { out.conteudo = rfBlocosLer_(id, !!p.fresco, true); } catch (e) { out.erroConteudo = String(e).slice(0, 160); }
  return out;
}
function rfAtvCriar_(sess, p) {
  var t = String(p.titulo || "").trim();
  if (!t) return { ok: false, erro: "INFORME_O_TITULO" };
  var resp = [].concat(p.resp || []).filter(Boolean);
  if (!resp.length && sess.p) resp = [sess.p];
  var props = {
    "Atividade": { title: rfTxt_(t) },
    "Status": { status: { name: p.status || "Não começou" } },
    "Responsável": { people: rfPessoaIds_(resp) }
  };
  if (sess.p) props["Solicitante"] = { people: [{ id: sess.p }] };
  if (p.tipo) props["Tipo"] = { select: { name: p.tipo } };
  if (p.prioridade) props["Prioridade"] = { select: { name: p.prioridade } };
  if (p.ini) props["Data de Início"] = { date: { start: p.ini } };
  if (p.fim) props["Data Final"] = { date: { start: p.fim } };
  if (p.obraId) props["(EMP) Projeto 2.0"] = { relation: [{ id: p.obraId }] };
  var filhos = [];
  if (p.descricao) filhos.push(rfNovoBlocoJson_("paragraph", p.descricao));
  [].concat(p.itens || []).filter(function (x) { return String(x || "").trim(); })
    .forEach(function (x) { filhos.push(rfNovoBlocoJson_("to_do", x)); });
  var pg = rfCriarPagina_(RF_ATV_DB, props, filhos);
  var a = rfAtvDe_(pg);
  rfSnapPatch_(a);
  return { ok: true, id: a.id, pageId: a.id, atividade: a };
}
function rfAtvUpdate_(sess, p) {
  if (!p.pageId || !p.campo) return { ok: false, erro: "FALTA_PARAM" };
  var a = rfAtvDe_(rfAtvPagina_(p.pageId));
  if (!rfPodeMexer_(sess, a)) return { ok: false, erro: "SEM_PERMISSAO" };
  var v = p.valor, props = {};
  switch (p.campo) {
    case "titulo":     props["Atividade"] = { title: rfTxt_(String(v || "").trim() || "(sem título)") }; break;
    case "status":
      props["Status"] = { status: v ? { name: v } : null };
      if (v === RF_FIM && !a.concl) props["Data de Conclusão"] = { date: { start: rfHoje_() } };
      if (v !== RF_FIM && a.concl) props["Data de Conclusão"] = { date: null };
      break;
    case "tipo":       props["Tipo"] = { select: v ? { name: v } : null }; break;
    case "prioridade": props["Prioridade"] = { select: v ? { name: v } : null }; break;
    case "ini":        props["Data de Início"] = { date: v ? { start: v } : null }; break;
    case "fim":        props["Data Final"] = { date: v ? { start: v } : null }; break;
    case "concl":      props["Data de Conclusão"] = { date: v ? { start: v } : null }; break;
    case "resp":       props["Responsável"] = { people: rfPessoaIds_([].concat(v || [])) }; break;
    case "obra":       props["(EMP) Projeto 2.0"] = { relation: v ? [{ id: v }] : [] }; break;
    default: return { ok: false, erro: "CAMPO_DESCONHECIDO" };
  }
  var b = rfAtvDe_(notion_("PATCH", "/pages/" + p.pageId, { properties: props }));
  rfSnapPatch_(b);
  return { ok: true, pageId: b.id, atividade: b };
}

/* ------------- COMENTÁRIOS (100% portal, Supabase) + antigos do Notion ------------- */
function rfAtvComentarios_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  if (String(rfConferePagina_(p.pageId)).indexOf("atv:") !== 0) return { ok: false, erro: "NAO_E_ATIVIDADE" };
  var id = rfSH_(p.pageId);
  var novos = rfSupa_("get", "atv_comentarios?atividade_id=eq." + id + "&order=criado_em.asc&select=*") || [];
  var caminhos = [];
  novos.forEach(function (c) { (c.anexos || []).forEach(function (x) { if (x.caminho) caminhos.push(x.caminho); }); });
  var urls = rfAssinar_(caminhos);
  var lista = novos.map(function (c) {
    return { id: "s" + c.id, autor: c.autor, pessoa: c.autor_pessoa || "", texto: c.texto || "", criadoEm: c.criado_em,
             anexos: (c.anexos || []).map(function (x) { return { nome: x.nome, mime: x.mime, url: urls[x.caminho] || null }; }) };
  });
  /* antigos do Notion: só leitura, cache longo (não mudam mais) */
  var antigos = cacheGet_("rf_ncom_" + id);
  if (!antigos) {
    antigos = [];
    try {
      var r = melLerComentarios_(p.pageId);
      antigos = (r.comentarios || []).map(function (c) {
        return { id: "n" + c.id, autor: c.autor, texto: c.texto, criadoEm: c.criadoEm, notion: true,
                 anexos: (c.anexos || []).map(function (x) { return { nome: x.nome || x.categoria, url: x.url }; }) };
      });
    } catch (e) {}
    cachePut_("rf_ncom_" + id, antigos, 1800);
  }
  var tudo = antigos.concat(lista).sort(function (a, b) { return String(a.criadoEm).localeCompare(String(b.criadoEm)); });
  return { ok: true, comentarios: tudo, lidoEm: new Date().toISOString() };
}
function rfAtvComentarioNovo_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  if (String(rfConferePagina_(p.pageId)).indexOf("atv:") !== 0) return { ok: false, erro: "NAO_E_ATIVIDADE" };
  var texto = String(p.texto || "").trim().slice(0, 4000);
  var arqs = [].concat(p.arquivos || (p.arquivo ? [p.arquivo] : [])).filter(function (x) { return x && x.dataBase64; });
  if (!texto && !arqs.length) return { ok: false, erro: "COMENTARIO_VAZIO" };
  var id = rfSH_(p.pageId);
  var anexos = arqs.slice(0, 5).map(function (a, i) {
    var nome = String(a.filename || "arquivo").replace(/[^\w.\-() ]+/g, "_").slice(0, 90);
    var caminho = id + "/" + Date.now() + "_" + i + "_" + nome.replace(/\s+/g, "_");
    rfSubir_(caminho, a.mimeType, a.dataBase64);
    return { nome: nome, mime: a.mimeType || "", caminho: caminho };
  });
  var linha = rfSupa_("post", "atv_comentarios", {
    atividade_id: id, autor: sess.n || sess.u || "Portal", autor_login: sess.u || "", autor_pessoa: rfMe_(sess),
    texto: texto, anexos: anexos
  }, { Prefer: "return=representation" });
  return { ok: true, pageId: id, id: linha && linha[0] ? "s" + linha[0].id : null };
}

/* ------------------------- CHECKLISTS PRONTOS ------------------------- */
function rfModelos_(sess, p) {
  var me = rfMe_(sess) || ("login:" + (sess.u || ""));
  var l = rfSupa_("get", "atv_modelos?dono=eq." + encodeURIComponent(me) + "&order=nome.asc&select=*") || [];
  return { ok: true, modelos: l.map(function (m) { return { id: m.id, nome: m.nome, frequencia: m.frequencia, itens: m.itens || [] }; }) };
}
function rfModeloUpdate_(sess, p) {
  var me = rfMe_(sess) || ("login:" + (sess.u || ""));
  var nome = String(p.nome || "").trim();
  if (!nome) return { ok: false, erro: "INFORME_O_NOME" };
  var itens = [].concat(p.itens || []).map(function (x) { return String(x || "").trim(); }).filter(Boolean).slice(0, 80);
  var dados = { dono: me, nome: nome, frequencia: p.frequencia || "diário", itens: itens, atualizado_em: new Date().toISOString() };
  var r;
  if (p.id) r = rfSupa_("patch", "atv_modelos?id=eq." + Number(p.id) + "&dono=eq." + encodeURIComponent(me), dados, { Prefer: "return=representation" });
  else r = rfSupa_("post", "atv_modelos", dados, { Prefer: "return=representation" });
  return { ok: true, id: r && r[0] ? r[0].id : p.id };
}
function rfModeloExcluir_(sess, p) {
  var me = rfMe_(sess) || ("login:" + (sess.u || ""));
  rfSupa_("delete", "atv_modelos?id=eq." + Number(p.id) + "&dono=eq." + encodeURIComponent(me));
  return { ok: true };
}
/* "Gerar" = cria uma atividade NOVA, zerada, a partir do modelo */
function rfModeloGerar_(sess, p) {
  var me = rfMe_(sess) || ("login:" + (sess.u || ""));
  var l = rfSupa_("get", "atv_modelos?id=eq." + Number(p.id) + "&dono=eq." + encodeURIComponent(me) + "&select=*") || [];
  if (!l.length) return { ok: false, erro: "MODELO_NAO_ENCONTRADO" };
  var m = l[0], hoje = rfHoje_();
  var f = rfNorm_(m.frequencia), fim = hoje;
  if (f.indexOf("seman") === 0) fim = rfMaisDias_(hoje, 6);
  else if (f.indexOf("mens") === 0) fim = rfFimDoMes_(hoje);
  var rotulo = f.indexOf("mens") === 0 ? Utilities.formatDate(new Date(), "America/Sao_Paulo", "MM/yyyy")
             : Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM");
  return rfAtvCriar_(sess, {
    titulo: "✅ " + m.nome + " · " + rotulo, tipo: RF_TIPO_PROPRIA, prioridade: "Média",
    ini: hoje, fim: fim, resp: sess.p ? [sess.p] : [], itens: m.itens || []
  });
}
