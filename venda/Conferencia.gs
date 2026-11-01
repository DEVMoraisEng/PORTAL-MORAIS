/* Conferencia.gs — CONFERÊNCIA DOS DOCUMENTOS antes do contrato do condomínio (28/10/2026).
 * Regras puras em ConferenciaDocs.js. A IA (leitorIA_: OpenAI ou Claude, pela PROVEDOR_IA) lê os documentos
 * anexados na linha da venda; o portal compara com os dados do contrato. O resultado fica na Propriedade
 * CONFDOC_<pageId> (JSON: { carimbo, em, por, linhas, confirmados }) — o carimbo é o do contrato: se um dado
 * mudar depois, a conferência vale de novo. Não trava o contrato: o pré-contrato só AVISA (dono, 28/10).
 * Ações: conferirDocumentos, conferenciaEstado, confirmarConferencia, verDocumentoConferencia.
 * Log só com ação, pageId abreviado e contagens — nunca nome, CPF ou endereço. */
var CONF_PROP = "CONFDOC_";
function confChave_(pageId) { return CONF_PROP + ctrIdLimpo_(pageId); }
function confLer_(pageId) {
  try { var o = JSON.parse(prop_(confChave_(pageId)) || "null"); return o && typeof o === "object" ? o : null; }
  catch (e) { return null; }
}
function confGravar_(pageId, o) { PropertiesService.getScriptProperties().setProperty(confChave_(pageId), JSON.stringify(o)); }

/* dados do contrato da linha (os mesmos do gerador): { f, d } ou { resp } */
function confDados_(col, p) {
  var f = ctrFontes_(col, p.pageId);
  if (f.condominioErro) return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: [f.condominioErro] } };
  if (f.obraAmbigua || f.duplicados || f.obraNaoEncontrada) return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: f.duplicados || ["Vendedor: obra da casa"] } };
  var d = ContratoVenda.montarDadosContrato(f.fontes);
  if (!d.condominio) return { resp: { ok: false, erro: "SO_CONDOMINIO" } };
  return { f: f, d: d };
}
function confColReal_(pg, nome) {
  for (var n in pg.properties) if (RegrasVenda.chave(n) === RegrasVenda.chave(nome) && pg.properties[n].type === "files") return n;
  return "";
}

function conferirDocumentos_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), t0 = Date.now();
  var x = confDados_(col, p);
  if (x.resp) return x.resp;
  var itens = ConferenciaDocs.plano(x.d), pg = ctrLerPaginaVenda_(p.pageId), leituras = {};
  /* 1) arquivos de cada documento (até 4: frente e verso) */
  var todos = [];
  itens.forEach(function (it) {
    var c = confColReal_(pg, it.coluna), lista = c ? (ctrValor_(pg.properties[c]) || []).slice(-4) : [];
    it.partes = [];
    if (!lista.length) { leituras[it.id] = { ok: false, erro: "SEM_ARQUIVO" }; return; }
    lista.forEach(function (f) { todos.push({ it: it, f: f }); });
  });
  var baixados = baixarVarios_(todos.map(function (y) { return y.f; }));
  todos.forEach(function (y, i) { var b = baixados[i]; if (b && RegrasVenda.conferirArquivo(b).ok) y.it.partes.push(b); });
  /* 2) a IA de todos num pedido em paralelo */
  var ia = leitorIA_(), envio = [];
  itens.forEach(function (it) {
    if (leituras[it.id]) return;
    if (!it.partes.length) { leituras[it.id] = { ok: false, erro: "ARQUIVO_NAO_LEGIVEL" }; return; }
    if (ia.erro) { leituras[it.id] = { ok: false, erro: ia.erro }; return; }
    var pedido = ia.leitor.montarPedido(it.tipo, it.partes, ia.chave, ia.modelo, "");
    if (pedido.erro) { leituras[it.id] = { ok: false, erro: pedido.erro }; return; }
    envio.push(it);
    it.req = { url: pedido.url, method: "post", contentType: "application/json", muteHttpExceptions: true,
               headers: pedido.headers, payload: JSON.stringify(pedido.corpo) };
  });
  var respostas = buscarVarios_(envio.map(function (it) { return it.req; }));
  envio.forEach(function (it, i) {
    var r = respostas[i];
    try { leituras[it.id] = r.r ? ia.leitor.interpretarResposta(r.r.getResponseCode(), r.r.getContentText()) : { ok: false, erro: "LEITURA_FALHOU" }; }
    catch (e) { leituras[it.id] = { ok: false, erro: "LEITURA_FALHOU" }; }
  });
  var linhas = ConferenciaDocs.resultado(itens, leituras);
  var o = { carimbo: ctrCarimbo_(x.d), em: new Date().toISOString(), por: ctrTxt_(sess && sess.u), linhas: linhas, confirmados: {} };
  try { confGravar_(p.pageId, o); } catch (e) { ctrErro_("conferirDocumentos " + pid + " registro", e); return { ok: false, erro: "GRAVACAO_FALHOU" }; }
  var n = { ok: 0, diverge: 0, ilegivel: 0 };
  linhas.forEach(function (l) { n[l.situacao] = (n[l.situacao] || 0) + 1; });
  ctrLog_("conferirDocumentos " + pid + " ok " + (Date.now() - t0) + "ms; confere " + n.ok + ", diverge " + n.diverge + ", ilegivel " + n.ilegivel);
  return { ok: true, linhas: linhas, confirmados: {}, em: o.em, atual: true };
}

function conferenciaEstado_(col, p) {
  var o = confLer_(p.pageId);
  if (!o) return { ok: true, feito: false };
  var atual = true;
  try { var x = confDados_(col, p); atual = !x.resp && ctrCarimbo_(x.d) === o.carimbo; } catch (e) { atual = false; }
  return { ok: true, feito: true, linhas: o.linhas || [], confirmados: o.confirmados || {}, em: o.em || "", por: o.por || "", atual: atual };
}

/* "Conferi, está certo": a pessoa abriu o documento e confirmou visualmente (ilegível ou divergência aceita). */
function confirmarConferencia_(col, sess, p) {
  var o = confLer_(p.pageId), i = Number(p.indice);
  if (!o) return { ok: false, erro: "CONFERENCIA_NAO_FEITA" };
  if (!(i >= 0 && i < (o.linhas || []).length)) return { ok: false, erro: "ITEM_INVALIDO" };
  o.confirmados = o.confirmados || {};
  o.confirmados[i] = { por: ctrTxt_(sess && sess.u), em: new Date().toISOString() };
  try { confGravar_(p.pageId, o); } catch (e) { return { ok: false, erro: "GRAVACAO_FALHOU" }; }
  ctrLog_("confirmarConferencia " + String(p.pageId).slice(0, 8) + " item " + i);
  return { ok: true, confirmados: o.confirmados };
}

/* O documento de uma linha, pela sessão do portal (o link do arquivo não vai para a tela). Só as colunas
   da conferência. Devolve o ÚLTIMO arquivo e quantos há (frente e verso podem ser dois). */
function verDocumentoConferencia_(col, p) {
  if (ConferenciaDocs.COLUNAS.indexOf(String(p.coluna || "")) < 0) return { ok: false, erro: "COLUNA_INVALIDA" };
  var pg = ctrLerPaginaVenda_(p.pageId), c = confColReal_(pg, p.coluna);
  var lista = c ? (ctrValor_(pg.properties[c]) || []) : [];
  if (!lista.length) return { ok: false, erro: "SEM_ARQUIVO" };
  var k = Math.max(0, Math.min(lista.length - 1, Number(p.n) || 0)), b = null;
  try { b = baixarArquivo_(lista[k]); } catch (e) { b = null; }
  if (!b) return { ok: false, erro: "ARQUIVO_NAO_LEGIVEL" };
  return { ok: true, nome: ctrTxt_(lista[k].name), mime: b.mime, base64: b.base64, n: k, total: lista.length };
}

/* aviso do pré-contrato do condomínio ("" = nada a avisar) */
function confAviso_(pageId, hash) {
  var o = confLer_(pageId);
  if (!o) return "Conferência dos documentos: não foi feita";
  if (o.carimbo !== hash) return "Conferência dos documentos: os dados mudaram depois dela — confira de novo";
  var r = ConferenciaDocs.resumo(o.linhas, o.confirmados);
  return r ? "Conferência dos documentos: " + r : "";
}

/* 31/10/2026 (dono): "Corrigir aqui" na conferência — abre o campo da linha do condomínio que alimenta o
   campo conferido (ConferenciaDocs.camposParaCorrigir) e grava ali mesmo. Só a linha do condomínio; só as
   colunas que a regra devolve para aquele item/campo (a tela não escolhe coluna). */
function confAlvos_(p) {
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  if (vendaBaseDaPagina_(pg) !== "CONDOMINIO") return { erro: "SO_CONDOMINIO" };
  var props = pg.properties || {}, real = {};
  Object.keys(props).forEach(function (n) { real[RegrasVenda.chave(n)] = n; });
  function v(nome) { var n = real[RegrasVenda.chave(nome)]; return n ? ctrTxt_(ctrValor_(props[n])).trim() : ""; }
  var alvos = ConferenciaDocs.camposParaCorrigir(String(p.item || ""), String(p.campo || ""), CondominioVenda.temSegundo(props), v);
  if (!alvos.length) return { erro: "NAO_CORRIGE_AQUI" };
  var faltam = alvos.filter(function (a) { return !real[RegrasVenda.chave(a.coluna)]; }).map(function (a) { return a.coluna; });
  if (faltam.length) return { erro: "COLUNA_FALTANDO", faltas: faltam };
  return { pg: pg, alvos: alvos.map(function (a) {
    var n = real[RegrasVenda.chave(a.coluna)];
    return { coluna: n, rotulo: a.rotulo, tipo: props[n].type, valor: v(n), opcoes: a.opcoes || null };
  }) };
}
function corrigirConferenciaCampos_(col, p) {
  var a = confAlvos_(p);
  if (a.erro) return { ok: false, erro: a.erro, faltas: a.faltas };
  var opcoes = {};
  if (a.alvos.some(function (x) { return x.tipo === "select"; })) {
    var db = notion_("GET", "/databases/" + a.pg.parent.database_id, null), sch = (db && db.properties) || {};
    a.alvos.forEach(function (x) {
      if (x.tipo === "select" && sch[x.coluna]) opcoes[x.coluna] = ((sch[x.coluna].select || {}).options || []).map(function (o) { return o.name; });
    });
  }
  /* select da base: as opções dela; coluna de texto com lista da regra (estado civil): a lista da regra */
  return { ok: true, campos: a.alvos.map(function (x) { return { coluna: x.coluna, rotulo: x.rotulo, valor: x.valor, opcoes: opcoes[x.coluna] || x.opcoes || null }; }) };
}
function corrigirConferencia_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), a = confAlvos_(p);
  if (a.erro) return { ok: false, erro: a.erro, faltas: a.faltas };
  var valores = p.valores || {}, props = {}, mudou = [];
  for (var i = 0; i < a.alvos.length; i++) {
    var x = a.alvos[i];
    if (!Object.prototype.hasOwnProperty.call(valores, x.coluna)) continue;
    var nv = ctrTxt_(valores[x.coluna]).trim().slice(0, 300);
    if (p.campo === "cpf" && nv) {
      if (!RegrasVenda.cpfValido(nv)) return { ok: false, erro: "CPF_INVALIDO" };
      nv = RegrasVenda.formatarCpf(nv);
    }
    if (nv === x.valor) continue;
    props[x.coluna] = confPropNotion_(x.tipo, nv);
    mudou.push(x.coluna);
  }
  if (mudou.length) notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  ctrLog_("corrigirConferencia " + pid + " " + p.item + "/" + p.campo + " " + (mudou.join(", ") || "sem mudança") + " por " + ctrTxt_(sess && sess.u));
  return { ok: true, mudou: mudou };
}

/* 01/11/2026 (teste e2e): bloco "Fiadores" (e cônjuge do comprador) na aba Contrato do condomínio — as faltas
   "Fiador N: …" e "Cônjuge do comprador 1: …" ganham onde ser corrigidas. Regras puras em FiadoresVenda.js; grava só
   na LISTA FECHADA de colunas da linha do condomínio, com o tipo de cada propriedade (como o Corrigir aqui). */
function fiaLinha_(pg, props) {
  var real = {}, linha = {};
  Object.keys(props || {}).forEach(function (n) { real[RegrasVenda.chave(n)] = n; });
  FiadoresVenda.PERMITIDAS.forEach(function (c) {
    var n = real[RegrasVenda.chave(c)];
    if (!n) return;
    var v = ctrTxt_(ctrValor_(props[n])).trim();
    linha[c] = FiadoresVenda.tipoDa(c) === "cpf" ? RegrasVenda.cpfDoNotion(v) : v;   /* CPF em coluna de número perde o zero */
  });
  return { pg: pg, props: props || {}, real: real, linha: linha };
}
function fiaPagina_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null), base = vendaBaseDaPagina_(pg);
  if (!base) throw new Error("PAGINA_DE_OUTRA_BASE");
  if (base !== "CONDOMINIO") return { erro: "SO_CONDOMINIO" };
  return fiaLinha_(pg, pg.properties);
}
/* {nome real: [opções da base]} só das colunas select (uma leitura da base, e só quando há select) */
function fiaOpcoes_(pg, props, nomes) {
  var sel = nomes.filter(function (n) { return props[n] && props[n].type === "select"; }), out = {};
  if (!sel.length) return out;
  var db = notion_("GET", "/databases/" + pg.parent.database_id, null), sch = (db && db.properties) || {};
  sel.forEach(function (n) { if (sch[n]) out[n] = ((sch[n].select || {}).options || []).map(function (o) { return o.name; }); });
  return out;
}
/* a gravação do Corrigir aqui: title, número (só dígitos) ou o tipo da propriedade (propNotion_) */
function confPropNotion_(tipo, nv) {
  if (tipo === "title") return { title: nv ? [{ type: "text", text: { content: nv } }] : [] };
  return propNotion_(tipo, tipo === "number" ? (nv ? Number(nv.replace(/[^0-9]/g, "")) : null) : nv);
}
/* valores {coluna da lista: valor já conferido} → { ok, gravou } — nada é gravado se uma coluna faltar ou um select não casar */
function fiaGravar_(a, valores) {
  var cols = Object.keys(valores), faltam = cols.filter(function (c) { return !a.real[RegrasVenda.chave(c)]; });
  if (faltam.length) return { ok: false, erro: "COLUNA_FALTANDO", faltas: faltam };
  var reais = cols.map(function (c) { return a.real[RegrasVenda.chave(c)]; }), opcoes = fiaOpcoes_(a.pg, a.props, reais);
  var props = {}, gravou = [];
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i], n = reais[i], tipo = a.props[n].type, nv = ctrTxt_(valores[c]).trim();
    if (tipo === "select" && nv) {
      var ops = opcoes[n] || [];
      nv = RegrasVenda.resolverOpcao(ops, nv);
      if (ops.indexOf(nv) < 0) return { ok: false, erro: "OPCAO_INVALIDA", coluna: n };
    }
    if (nv === (a.linha[c] || "")) continue;
    props[n] = confPropNotion_(tipo, nv);
    gravou.push(c);
  }
  if (gravou.length) notion_("PATCH", "/pages/" + a.pg.id, { properties: props });
  return { ok: true, gravou: gravou };
}
function salvarFiadores_(col, sess, p) {
  var v = FiadoresVenda.validarValores(p.valores);
  if (!v.ok) return v.coluna ? { ok: false, erro: v.erro, coluna: v.coluna } : { ok: false, erro: v.erro };
  var a = fiaPagina_(p.pageId);
  if (a.erro) return { ok: false, erro: a.erro };
  var r = fiaGravar_(a, v.valores);
  ctrLog_("salvarFiadores " + String(p.pageId).slice(0, 8) + " " + (r.ok ? (r.gravou.join(", ") || "sem mudança") : r.erro) + " por " + ctrTxt_(sess && sess.u));
  return r;
}
/* "O cônjuge do Fiador 1 é o Fiador 2": o casal vira os dois fiadores (#74) */
function conjugeEhFiador2_(col, sess, p) {
  var a = fiaPagina_(p.pageId);
  if (a.erro) return { ok: false, erro: a.erro };
  var c = FiadoresVenda.conjugeComoFiador2(a.linha);
  if (c.erro) return { ok: false, erro: c.erro };
  var r = fiaGravar_(a, c.valores);
  ctrLog_("conjugeEhFiador2 " + String(p.pageId).slice(0, 8) + " " + (r.ok ? r.gravou.length + " colunas" : r.erro) + " por " + ctrTxt_(sess && sess.u));
  return r;
}
/* para o contratoEstado: o bloco da tela (ou null), com as opções da base nos selects e sem as colunas que a base não tem */
function fiaEstado_(pgE, faltas, opts) {
  var props = pgE.propsCondominio || pgE.properties || {}, a = fiaLinha_(pgE, props);
  var nPrazo = a.real[RegrasVenda.chave("PRAZO ENTRADA")], prazo = nPrazo ? Number(ctrValor_(props[nPrazo])) : null;
  var b = FiadoresVenda.camposFiadores(a.linha, faltas, prazo, opts);
  if (!b.mostrar) return null;
  var todos = [];
  b.fiadores.forEach(function (f) { todos = todos.concat(f.campos); });
  if (b.conjuge) todos = todos.concat(b.conjuge.campos);
  var opcoes = fiaOpcoes_(pgE, props, todos.map(function (c) { return a.real[RegrasVenda.chave(c.coluna)]; }).filter(Boolean));
  b.semColuna = [];
  function ajustar(lista) {
    return lista.filter(function (c) {
      var n = a.real[RegrasVenda.chave(c.coluna)];
      if (!n) { b.semColuna.push(c.coluna); return false; }
      if (opcoes[n]) c.opcoes = opcoes[n];
      return true;
    });
  }
  b.fiadores.forEach(function (f) { f.campos = ajustar(f.campos); });
  if (b.conjuge) b.conjuge.campos = ajustar(b.conjuge.campos);
  return b;
}
/* 01/11/2026 (revisão final, I1): contrato FINAL e o envio barraria por e-mail de fiador ou de cônjuge — o bloco abre só
   com as caixas de e-mail. Os cadastros só são relidos quando a própria linha mostra alguém sem e-mail válido. */
function fiaEstadoFinal_(col, p, pgE) {
  var props = pgE.propsCondominio || pgE.properties || {};
  if (!FiadoresVenda.emailTalvezFaltando(fiaLinha_(pgE, props).linha)) return null;
  var xf = ctrDadosAtuais_(col, p, String(p.pageId).slice(0, 8), "contratoEstado e-mail");
  var faltas = ((xf.resp && xf.resp.faltas) || []).filter(function (t) { return /^(Fiador [12]|C[ôo]njuge)[^:]*: e-mail/i.test(String(t)); });
  return faltas.length ? fiaEstado_(pgE, faltas, { soEmail: true }) : null;
}
