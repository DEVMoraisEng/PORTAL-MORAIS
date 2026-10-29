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
