/* RecebimentoVenda — bloco "Recebimentos" do painel da casa (entrega 14).
 * Arquivo do projeto PORTAL-VENDA (depois de PortalVenda, GerarContrato, ContratoVenda e ClicksignVenda).
 * Três itens: Sinal, Entrada e Financiamento. Para cada um a tela mostra o valor esperado (CONTRATO - SINAL VALOR,
 * CONTRATO - ENTRADA VALOR, VALOR FINANCIADO — só leitura) e quem recebeu confirma com a data e o comprovante.
 * Grava na casa (VENDAS): RECEBIMENTO - <ITEM> DATA (date), RECEBIMENTO - <ITEM> COMPROVANTE (files, o arquivo
 * vai pelo File Upload do Notion, como os documentos do dossiê) e RECEBIMENTO - <ITEM> POR (rich_text, login).
 * Depois manda um e-mail (MailApp, da conta dona do projeto) para a Propriedade RECEBIMENTO_EMAILS (endereços
 * separados por vírgula); sem ela, grava e avisa "e-mail não configurado". O e-mail não leva CPF.
 * Só casa da VENDAS (o cartão do condomínio não tem o bloco). Perfil TESTES não grava (PortalVenda).
 * Log só com ação, pageId abreviado, item e resultado — nunca valor, nome, e-mail ou data.
 * A parte pura (RecebimentoVenda) roda igual no node (testes em venda/testes). Repositório público: nenhum dado
 * real aqui nem nos testes. */
var RecebimentoVenda = (function () {
  "use strict";
  var ITENS = [
    { id: "SINAL", rotulo: "Sinal", esperado: "CONTRATO - SINAL VALOR" },
    { id: "ENTRADA", rotulo: "Entrada", esperado: "CONTRATO - ENTRADA VALOR" },
    { id: "FINANCIAMENTO", rotulo: "Financiamento", esperado: "VALOR FINANCIADO" }
  ];
  var TIPOS = { data: "date", comprovante: "files", por: "rich_text" };

  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function item(id) {
    for (var i = 0; i < ITENS.length; i++) if (ITENS[i].id === txt(id).toUpperCase()) return ITENS[i];
    return null;
  }
  function colunas(id) {
    return { data: "RECEBIMENTO - " + id + " DATA", comprovante: "RECEBIMENTO - " + id + " COMPROVANTE", por: "RECEBIMENTO - " + id + " POR" };
  }
  /* { nome da coluna: tipo } das 9 colunas novas */
  function colunasNecessarias() {
    var r = {};
    ITENS.forEach(function (it) { var c = colunas(it.id); for (var k in c) r[c[k]] = TIPOS[k]; });
    return r;
  }
  /* "aaaa-mm-dd" que existe no calendário, de 2000 em diante e não depois de hoje */
  function dataValida(iso, hojeISO) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(iso));
    if (!m) return false;
    var a = Number(m[1]), me = Number(m[2]), d = Number(m[3]);
    if (a < 2000 || me < 1 || me > 12 || d < 1) return false;
    var dias = [31, (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][me - 1];
    if (d > dias) return false;
    return !hojeISO || txt(iso) <= txt(hojeISO);
  }
  /* Propriedade RECEBIMENTO_EMAILS -> lista de e-mails válidos, sem repetir (vírgula, ponto e vírgula ou espaço) */
  function destinatarios(prop) {
    var vistos = {}, l = [];
    txt(prop).split(/[,;\s]+/).forEach(function (e) {
      e = txt(e).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || vistos[e]) return;
      vistos[e] = true; l.push(e);
    });
    return l;
  }
  function moedaBR(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    var c = Math.round(Math.abs(n) * 100), r = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = String(c % 100); if (cent.length < 2) cent = "0" + cent;
    return (n < 0 ? "-" : "") + "R$ " + r + "," + cent;
  }
  function dataBR(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso)); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function umaLinha(s) { return txt(s).replace(/[\r\n]+/g, " ").replace(/\s+/g, " "); }
  /* "Recebido: SINAL — OBRA — COMPRADOR" (sem obra ou comprador, a parte sai) */
  function assunto(id, obra, comprador) {
    return ["Recebido: " + txt(id).toUpperCase(), umaLinha(obra), umaLinha(comprador)].filter(function (x) { return x; }).join(" — ").slice(0, 250);
  }
  /* corpo em texto simples; x = { id, obra, comprador, esperado (número|null), data (iso), por, link } — sem CPF */
  function corpo(x) {
    var it = item(x.id) || { rotulo: txt(x.id), id: txt(x.id) };
    var linhas = ["Recebimento confirmado no portal de vendas.", "",
      "Item: " + it.rotulo,
      "Obra: " + (umaLinha(x.obra) || "—"),
      "Comprador: " + (umaLinha(x.comprador) || "—"),
      "Valor esperado (contrato): " + (moedaBR(x.esperado) || "não informado"),
      "Data do recebimento: " + (dataBR(x.data) || "—"),
      "Confirmado por: " + (umaLinha(x.por) || "—"),
      "Comprovante: " + (x.comprovante === false ? "não anexado" : "anexado na casa (coluna " + colunas(it.id).comprovante + ")")];
    if (/^https:\/\//.test(txt(x.link))) linhas.push("Faturamento no Mais Controle: " + txt(x.link));
    return linhas.join("\n");
  }
  var api = { ITENS: ITENS, TIPOS: TIPOS, item: item, colunas: colunas, colunasNecessarias: colunasNecessarias,
              dataValida: dataValida, destinatarios: destinatarios, assunto: assunto, corpo: corpo, moedaBR: moedaBR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();

/* ---- servidor (Apps Script) ---- */
function recLog_(msg) { console.log("PORTAL-VENDA recebimento " + msg); }

/* Página da casa (só VENDAS) e o nome real de cada coluna nova: { pg, c (por chave), real: {nome: real} } ou { erro } */
function recPagina_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  if (vendaBaseDaPagina_(pg) !== "VENDAS") return { erro: "SO_CASA" };
  var porChave = {}, faltando = [], errado = [], real = {};
  for (var n in pg.properties) porChave[RegrasVenda.chave(n)] = n;
  var precisa = RecebimentoVenda.colunasNecessarias();
  for (var nome in precisa) {
    var r = porChave[RegrasVenda.chave(nome)];
    if (!r) { faltando.push(nome); continue; }
    if (pg.properties[r].type !== precisa[nome]) errado.push(nome);
    real[nome] = r;
  }
  if (faltando.length) return { erro: "COLUNA_FALTANDO: " + faltando.join(", ") };
  if (errado.length) return { erro: "TIPO_DE_COLUNA_ERRADO: " + errado.join(", ") };
  return { pg: pg, c: ctrPorChave_(pg.properties), real: real };
}
/* Os três itens para a tela: { id, rotulo, esperado, data, comprovantes (quantos), por, confirmado } */
function recItens_(x) {
  return RecebimentoVenda.ITENS.map(function (it) {
    var c = RecebimentoVenda.colunas(it.id), pr = x.pg.properties;
    var data = ctrValor_(pr[x.real[c.data]]) || "";
    return { id: it.id, rotulo: it.rotulo, esperado: ctrNum_(ctrCampo_(x.c, it.esperado)), data: String(data).slice(0, 10),
             comprovantes: (ctrValor_(pr[x.real[c.comprovante]]) || []).length,
             por: ctrTxt_(ctrValor_(pr[x.real[c.por]])).trim(), confirmado: !!data };
  });
}
function recebimentoEstado_(col, p) {
  var x = recPagina_(p.pageId);
  if (x.erro) return { ok: false, erro: x.erro };
  return { ok: true, itens: recItens_(x), emailConfigurado: RecebimentoVenda.destinatarios(prop_("RECEBIMENTO_EMAILS")).length > 0 };
}

/* p = { item: SINAL|ENTRADA|FINANCIAMENTO, data: "aaaa-mm-dd", arquivo?: {nome, mime, base64} }.
   Comprovante opcional (dono, 08/10); confirmar de novo corrige a data ou junta outro arquivo. */
function recebimentoConfirmar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), it = RecebimentoVenda.item(p.item);
  if (!it) return { ok: false, erro: "ITEM_INVALIDO" };
  if (!RecebimentoVenda.dataValida(p.data, hoje_("yyyy-MM-dd"))) return { ok: false, erro: "DATA_INVALIDA" };
  if (p.arquivo) {
    var chk = RegrasVenda.conferirArquivo(p.arquivo);
    if (!chk.ok) return { ok: false, erro: chk.erro };
  }
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) return { ok: false, erro: "RECEBIMENTO_OCUPADO" };
  var r;
  try { r = recConfirmarTravado_(p, sess, it, pid); }
  finally { trava.releaseLock(); }
  recLog_("confirmar " + pid + " " + it.id + " por " + String((sess && sess.u) || "?") + ": " + (r.ok ? "ok" + (r.aviso ? " " + r.aviso : "") : r.erro));
  return r;
}
function recConfirmarTravado_(p, sess, it, pid) {
  var x = recPagina_(p.pageId);
  if (x.erro) return { ok: false, erro: x.erro };
  var c = RecebimentoVenda.colunas(it.id);
  /* comprovante é opcional (decisão do dono, 08/10): a confirmação vale só com a data */
  var jaTemComprovante = (ctrValor_(x.pg.properties[x.real[c.comprovante]]) || []).length > 0;
  var guardado = false;
  if (p.arquivo) {
    try { anexarArquivo_(p.pageId, x.real[c.comprovante], p.arquivo, false); guardado = true; }
    catch (e) { ctrErro_("recebimento " + pid + " upload", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
  }
  var por = ctrTxt_(sess && sess.u).trim(), props = {};
  props[x.real[c.data]] = propNotion_("date", p.data);
  props[x.real[c.por]] = propNotion_("rich_text", por);
  try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); }
  catch (e) { ctrErro_("recebimento " + pid + " gravacao", e); return { ok: false, erro: "GRAVACAO_FALHOU", arquivoGuardado: guardado }; }

  var resp = { ok: true };
  var dest = RecebimentoVenda.destinatarios(prop_("RECEBIMENTO_EMAILS"));
  if (!dest.length) resp.aviso = "EMAIL_NAO_CONFIGURADO";
  else {
    var obra = ClicksignVenda.nomePadrao(ctrTitulo_(x.pg.properties), ctrTxt_(ctrCampo_(x.c, "CASA")), "");
    var comprador = ContratoVenda.nomeComprador1(ctrTxt_(ctrCampo_(x.c, RegrasVenda.COL.CLIENTES)), ctrTxt_(ctrCampo_(x.c, RegrasVenda.COL.C2_NOME)));
    /* o comprovante vai anexado no e-mail (dono, 08/10): o enviado agora ou, sem ele, o último já guardado na casa */
    var anexos = [];
    try {
      if (p.arquivo && p.arquivo.base64) anexos.push(Utilities.newBlob(Utilities.base64Decode(p.arquivo.base64), p.arquivo.mime, p.arquivo.nome));
      else if (jaTemComprovante) {
        var fs = ctrValor_(x.pg.properties[x.real[c.comprovante]]) || [], b = baixarArquivo_(fs[fs.length - 1]);
        if (b && b.base64) anexos.push(Utilities.newBlob(Utilities.base64Decode(b.base64), b.mime, (fs[fs.length - 1] || {}).name || "comprovante"));
      }
    } catch (eAnx) { ctrErro_("recebimento " + pid + " anexo do e-mail", eAnx); }
    try {
      MailApp.sendEmail({ to: dest.join(","), subject: RecebimentoVenda.assunto(it.id, obra, comprador), attachments: anexos,
                          body: RecebimentoVenda.corpo({ id: it.id, obra: obra, comprador: comprador,
                                                         esperado: ctrNum_(ctrCampo_(x.c, it.esperado)), data: p.data, por: por,
                                                         comprovante: !!(p.arquivo || jaTemComprovante),
                                                         /* link do faturamento no Mais Controle (dono, 08/10); sem venda lançada, sem link */
                                                         link: ctrTxt_(ctrCampo_(x.c, "MC - VENDA ID")) ?
                                                           "https://acessar.maiscontroleerp.com.br/#/readjustment-sale/edit/" +
                                                           encodeURIComponent(ctrTxt_(ctrCampo_(x.c, "MC - VENDA ID")).trim()) : "" }) });
      resp.emails = dest.length;
    } catch (e) { ctrErro_("recebimento " + pid + " e-mail", e); resp.aviso = "EMAIL_FALHOU"; }
  }
  try { resp.itens = recItens_(recPagina_(p.pageId)); } catch (e) { ctrErro_("recebimento " + pid + " releitura", e); }
  return resp;
}

/* Rodar UMA vez no editor de cada projeto PORTAL-VENDA (selecionar autorizarEmailRecebimento › Executar ›
   autorizar): o Apps Script só pede a permissão de enviar e-mail (MailApp) quando uma função que usa o MailApp
   roda no editor. Não envia nada; mostra no registro a cota do dia e quantos destinatários a Propriedade tem. */
function autorizarEmailRecebimento() {
  var cota = MailApp.getRemainingDailyQuota();
  var n = RecebimentoVenda.destinatarios(prop_("RECEBIMENTO_EMAILS")).length;
  console.log("ok    MailApp autorizado — cota de e-mails hoje: " + cota);
  console.log(n ? "ok    RECEBIMENTO_EMAILS: " + n + " destinatário(s)." : "AVISO RECEBIMENTO_EMAILS vazia: o recebimento grava, mas não manda e-mail.");
  return { cota: cota, destinatarios: n };
}
