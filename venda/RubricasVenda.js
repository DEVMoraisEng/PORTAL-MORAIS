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
  /* 01/11 (plano 23 B): linha de assinatura = traços sozinhos na linha; o texto logo abaixo diz de quem é */
  var TEM_TRACO = /_{3,}/;
  var AJUSTE_LINHA = { dx: 0, dy: -0.03 };
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

  /* 01/11/2026 (plano 23 B, dono: "a assinatura ficou embaixo da linha de assinatura, não em cima"): cada linha de
   * assinatura dos blocos (quadro-resumo, final do contrato, página de assinaturas dos termos) → { page, position, texto }.
   * position = começo dos traços, subido pelo ajuste.linha (padrão 3% da página) para a assinatura ficar EM CIMA da linha;
   * texto = até 4 linhas logo abaixo (nome, CPF, papel), até o próximo traço ou um vão grande. Quem casa o texto com a
   * pessoa é o servidor (ClicksignVenda.atribuirLinhas). */
  /* correção 1 (M-3): só páginas de assinatura — a que tem o título ASSINATURAS (e a seguinte, se o bloco virar a página)
     ou a do quadro-resumo, com os rótulos VENDEDORA e COMPRADOR sozinhos num trecho. Traço solto em outra página não conta. */
  /* 01/11 (plano 23 B, uma linha por pessoa): papel sozinho num trecho — a página logo depois de uma página de
     assinatura que só traz estes rótulos é a continuação do bloco (o quadro-resumo com 11 pessoas vira a página) */
  var PAPEL_SOZINHO = /^((CREDORA\/)?VENDEDORA?|(DEVEDOR\/)?COMPRADOR|PRÉ-RESERVANTE|CÔNJUGE DO .+|FIADOR [12]|INTERMEDIADOR\/CORRETOR|TESTEMUNHA [12])$/;
  function paginaDeAssinatura(ls) {
    var titulo = false, vend = false, comp = false, papel = false;
    ls.forEach(function (l) {
      if (/^\s*ASSINATURAS\s*$/i.test(l.texto)) titulo = true;
      trechos(l).forEach(function (t) {
        var s = l.texto.slice(t[0], t[1]).trim().toUpperCase();
        if (/^(CREDORA\/)?VENDEDORA$/.test(s)) vend = true;
        if (/^(DEVEDOR\/)?COMPRADOR$/.test(s)) comp = true;
        if (PAPEL_SOZINHO.test(s)) papel = true;
      });
    });
    return titulo ? 2 : (vend && comp ? 1 : (papel ? -1 : 0));
  }
  function acharLinhas(paginas, ajuste) {
    var a = (ajuste && ajuste.linha) || AJUSTE_LINHA, out = [], antTitulo = false, antVale = false;
    (paginas || []).forEach(function (pg) {
      var ls = linhas(pg), W = pg.largura, H = pg.altura, tipo = paginaDeAssinatura(ls), vale = tipo > 0 || antTitulo || (tipo === -1 && antVale);
      antTitulo = tipo === 2;
      antVale = vale;
      if (!vale) return;
      ls.forEach(function (l, i) {
        /* cada trecho de traços da linha é uma linha de assinatura (blocos lado a lado no PDF: VENDEDORA | COMPRADOR,
           TESTEMUNHA 1 | TESTEMUNHA 2); traço com texto antes ("ASSINATURA: ____") é campo de ciência, não conta */
        var re = /_{10,}/g, m, fimAnt = 0;
        while ((m = re.exec(l.texto))) {
          var antes = l.texto.slice(fimAnt, m.index);
          fimAnt = m.index + m[0].length;
          if (/\S/.test(antes)) continue;
          var x0 = l.xs[m.index], x1 = l.xs[fimAnt - 1] + Math.max(1, (l.xs[fimAnt - 1] - x0) / Math.max(1, m[0].length - 1));
          out.push({ page: String(pg.numero), position: [limitar(x0 / W + (Number(a.dx) || 0)), limitar(l.y / H + (Number(a.dy) || 0))],
                     texto: textoDaColuna(ls, i, x0, x1) });
        }
      });
    });
    return out;
  }
  /* trechos de texto de uma linha separados por vão grande (blocos lado a lado): [[início, fim)] */
  function trechos(l) {
    var d = [];
    for (var c = 1; c < l.xs.length; c++) if (l.xs[c] > l.xs[c - 1]) d.push(l.xs[c] - l.xs[c - 1]);
    d.sort(function (a, b) { return a - b; });
    var vao = Math.max(15, 3 * (d.length ? d[Math.floor(d.length / 2)] : 5)), out = [], ini = 0;
    for (var k = 1; k <= l.texto.length; k++)
      if (k === l.texto.length || l.xs[k] - l.xs[k - 1] > vao) { out.push([ini, k]); ini = k; }
    return out;
  }
  /* até 4 linhas logo abaixo da linha i, só os trechos que encostam na coluna [x0, x1] (nome centralizado mais largo que
     o traço entra inteiro; o bloco do lado, não); para no próximo traço ou num vão grande */
  function textoDaColuna(ls, i, x0, x1) {
    var txt = [], ant = ls[i], tol = 6;
    for (var k = i + 1; k < ls.length && txt.length < 4; k++) {
      var m = ls[k], col = "";
      trechos(m).forEach(function (t) {
        if (m.xs[t[1] - 1] >= x0 - tol && m.xs[t[0]] <= x1 + tol) col += (col ? " " : "") + m.texto.slice(t[0], t[1]);
      });
      if (!/\S/.test(col)) continue;
      if (TEM_TRACO.test(col)) break;
      if (m.y - (ant.y + ant.h) > Math.max(ant.h, m.h) * 2.5) break;
      txt.push(col.replace(/\s+/g, " ").trim());
      ant = m;
    }
    return txt.join("\n");
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

  var api = { acharNoContrato: acharNoContrato, acharLinhas: acharLinhas, paginaDoPdfjs: paginaDoPdfjs, linhas: linhas, paginasDoPdf: paginasDoPdf,
              PDFJS_URL: PDFJS_URL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (typeof window !== "undefined") window.RubricasVenda = api;
  return api;
})();
