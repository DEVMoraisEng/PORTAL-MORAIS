/* RubricasVenda — acha no PDF FINAL do contrato onde o comprador rubrica (30/10/2026).
 * Roda no navegador (bloco Assinatura, antes de "Enviar") e no node (testes). O contrato muda de tamanho a
 * cada venda, então a posição não pode ser fixa: o pdf.js lê o texto do PDF que vai para a Clicksign e daqui
 * saem as posições, em proporção da página (0–1, x da esquerda, y do topo), como pede o requisito "rubricate":
 *  - campos: cada linha "ASSINATURA: ____" (quadros de CIÊNCIA EXPRESSA) → assinatura no começo dos traços;
 *  - valores: um visto na coluna cinza da esquerda do quadro-resumo, na altura do item "4.2.1.".
 * O servidor (ClicksignVenda.validarRubricas) confere tudo de novo antes de mandar.
 * Repositório público: nenhum dado real aqui nem nos testes. */
var RubricasVenda = (function () {
  "use strict";

  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  var CAMPO = /ASSINATURA\s*:\s*_{3,}/gi;
  var ITEM_421 = /^\s*4\.2\.1\.?(\s|$)/;

  function limitar(v) { return Math.max(0, Math.min(1, Math.round(v * 10000) / 10000)); }

  /* Texto de uma página do pdf.js → { numero, largura, altura, itens: [{ str, x, y (topo, de cima), w, h }] } */
  function paginaDoPdfjs(numero, view, conteudo) {
    var x0 = view[0], y0 = view[1], W = view[2] - view[0], H = view[3] - view[1];
    var itens = [];
    (conteudo.items || []).forEach(function (it) {
      if (!it || typeof it.str !== "string" || !it.str.length) return;
      var t = it.transform || [1, 0, 0, 1, 0, 0];
      var h = it.height || Math.sqrt(t[2] * t[2] + t[3] * t[3]) || 10;
      itens.push({ str: it.str, x: t[4] - x0, y: H - (t[5] - y0) - h, w: it.width || 0, h: h });
    });
    return { numero: numero, largura: W, altura: H, itens: itens };
  }

  /* Junta os itens em linhas (mesma base, tolerância de meia altura) e guarda o x de cada caractere. */
  function linhas(pagina) {
    var its = pagina.itens.filter(function (i) { return i.str.length; }).slice()
      .sort(function (a, b) { return (a.y + a.h) - (b.y + b.h) || a.x - b.x; });
    var out = [];
    its.forEach(function (i) {
      var base = i.y + i.h, l = out[out.length - 1];
      if (!l || Math.abs(base - l.base) > Math.max(2, Math.min(i.h, l.h) * 0.5)) { l = { base: base, y: i.y, h: i.h, partes: [] }; out.push(l); }
      l.partes.push(i);
      l.y = Math.min(l.y, i.y); l.h = Math.max(l.h, i.h);
    });
    out.forEach(function (l) {
      l.partes.sort(function (a, b) { return a.x - b.x; });
      var txt = "", xs = [];
      l.partes.forEach(function (i) {
        var n = i.str.length, passo = n ? (i.w || 0) / n : 0;
        for (var k = 0; k < n; k++) { txt += i.str[k]; xs.push(i.x + passo * k); }
      });
      l.texto = txt; l.xs = xs; l.x = xs.length ? xs[0] : 0;
      delete l.partes;
    });
    return out;
  }

  /* paginas: [{ numero, largura, altura, itens }]; ajuste: { campo: {dx,dy}, valores: {dx,dy} } (do servidor).
   * Devolve { campos: [{ page, position }], valores: { page, position } | null, avisos: [] }. */
  function acharNoContrato(paginas, ajuste) {
    ajuste = ajuste || {};
    var aC = ajuste.campo || { dx: 0, dy: 0 }, aV = ajuste.valores || { dx: 0, dy: 0 };
    var campos = [], valores = null, avisos = [], margem = Infinity, porPagina = [];
    (paginas || []).forEach(function (pg) {
      var ls = linhas(pg);
      porPagina.push({ pg: pg, ls: ls });
      pg.itens.forEach(function (i) { if (/\S/.test(i.str)) margem = Math.min(margem, i.x); });
    });
    porPagina.forEach(function (x) {
      var pg = x.pg, W = pg.largura, H = pg.altura;
      x.ls.forEach(function (l) {
        CAMPO.lastIndex = 0;
        var m;
        while ((m = CAMPO.exec(l.texto))) {
          var iTraco = l.texto.indexOf("_", m.index);
          campos.push({ page: String(pg.numero), position: [limitar(l.xs[iTraco] / W + aC.dx), limitar(l.y / H + aC.dy)] });
        }
        /* o primeiro "4.2.1." que está numa tabela (texto bem à direita da margem): é o quadro-resumo */
        if (!valores && ITEM_421.test(l.texto) && l.x - margem > W * 0.08) {
          valores = { page: String(pg.numero), position: [limitar((margem + 4) / W + aV.dx), limitar(l.y / H + aV.dy)] };
        }
      });
    });
    if (!campos.length) avisos.push("nenhum campo \"ASSINATURA: ____\" achado no contrato");
    if (!valores) avisos.push("item 4.2.1 do quadro-resumo não achado");
    return { campos: campos, valores: valores, avisos: avisos };
  }

  /* ---- navegador: pdf.js da cdnjs, carregado só na hora de enviar ---- */
  var pdfjsPromessa = null;
  function carregarPdfjs() {
    if (!pdfjsPromessa) {
      pdfjsPromessa = import(PDFJS_URL).then(function (m) {
        m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return m;
      });
      pdfjsPromessa.catch(function () { pdfjsPromessa = null; });   /* falhou: tenta de novo no próximo clique */
    }
    return pdfjsPromessa;
  }
  function base64ParaBytes(b64) {
    var bin = atob(String(b64 || "")), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  /* PDF (base64) → páginas no formato de acharNoContrato. lib: o módulo do pdf.js (testes passam o do node). */
  async function paginasDoPdf(dados, lib) {
    var pdfjs = lib || await carregarPdfjs();
    var doc = await pdfjs.getDocument({ data: typeof dados === "string" ? base64ParaBytes(dados) : dados }).promise;
    var out = [];
    try {
      for (var n = 1; n <= doc.numPages; n++) {
        var pg = await doc.getPage(n);
        out.push(paginaDoPdfjs(n, pg.view, await pg.getTextContent()));
      }
    } finally { try { doc.destroy(); } catch (e) { /* nada */ } }
    return out;
  }

  var api = { acharNoContrato: acharNoContrato, paginaDoPdfjs: paginaDoPdfjs, linhas: linhas, paginasDoPdf: paginasDoPdf,
              PDFJS_URL: PDFJS_URL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (typeof window !== "undefined") window.RubricasVenda = api;
  return api;
})();
