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
  var AJUSTE_LINHA = { dx: 0, dy: 0 };
  /* calibração 01/11 (sandbox): a Clicksign põe o TOPO da imagem da assinatura (100×50 pt) no y pedido. Pedindo o topo
     46 pt acima da linha de base do traço, o pé da imagem fica ~4 pt abaixo da linha — a assinatura cruza a linha e não
     cobre o "Nome:" de baixo. Vale para as linhas de assinatura e para os campos "ASSINATURA: ____". Se o texto de cima
     estiver a menos de 46 pt, a imagem encosta nele: preferimos a linha (não se mexe aqui; RUBRICAS_AJUSTE ainda soma). */
  /* calibração pelos PDFs assinados da unidade 22 (01/11, pymupdf: tinta × ponto enviado). A caixa é bem maior que a tinta:
     - assinatura (manuscrita, imagem 100×50): tinta de +18 a +29 pt abaixo do ponto → ponto 27 pt acima da linha de base,
       a tinta fica em cima da linha (antes, com 46, flutuava ~20 pt acima);
     - visto (initials, texto 22 pt): tinta de +9 a +27 pt abaixo do ponto, 22–27 pt de largura → no campo "ASSINATURA:
       ____" ponto 25 pt acima da base (o pé do visto na linha); no 4.2.1, 22 pt acima da base (no meio da linha, na
       coluna cinza). (l.y + l.h = linha de base no pdf.js.) */
  var MANUSCRITO_ACIMA = 27, VISTO_CAMPO_ACIMA = 25, VISTO_VALORES_ACIMA = 22;
  function topoAcima(l, H, acima) { return (l.y + l.h - (acima === undefined ? MANUSCRITO_ACIMA : acima)) / H; }
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

  /* largura típica de cada letra (em "em", fonte serifada do contrato): maiúscula larga, espaço e pontuação estreitos */
  function pesoLetra(c) {
    if (c === "_") return 0.5;
    if (c === " " || c === " ") return 0.25;
    if (/[.,:;'!|]/.test(c)) return 0.25;
    if (/[—–]/.test(c)) return 1.0;
    if (/[-()\[\]\/]/.test(c)) return 0.33;
    if (/[A-ZÀ-ÖØ-Þ]/.test(c)) return 0.72;
    if (/[0-9]/.test(c)) return 0.5;
    if (/[mw]/.test(c)) return 0.8;
    if (/[ijlft]/.test(c)) return 0.3;
    return 0.5;
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
        /* unidade 22 (01/11): o pdf.js dá a largura do item inteiro; repartir igual por letra punha o começo dos traços de
           "ASSINATURA: ____" ~14 pt antes (em cima do "ASSINATURA:"). Agora cada letra pesa pela largura típica dela. */
        var n = i.str.length, pesos = [], soma = 0;
        for (var k = 0; k < n; k++) { var pk = pesoLetra(i.str[k]); pesos.push(pk); soma += pk; }
        var acc = 0;
        for (k = 0; k < n; k++) { txt += i.str[k]; xs.push(i.x + (soma ? (i.w || 0) * acc / soma : 0)); acc += pesos[k]; }
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
          campos.push({ page: String(pg.numero), position: [limitar(l.xs[iTraco] / W + aC.dx), limitar(topoAcima(l, H, VISTO_CAMPO_ACIMA) + aC.dy)] });
        }
        /* o primeiro "4.2.1." que está numa tabela (texto bem à direita da margem): é o quadro-resumo */
        if (!valores && ITEM_421.test(l.texto) && l.x - margem > W * 0.08) {
          valores = { page: String(pg.numero), position: [limitar((margem + 4) / W + aV.dx), limitar(topoAcima(l, H, VISTO_VALORES_ACIMA) + aV.dy)] };
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
    var r = { titulo: false, vend: false, comp: false, papel: false };
    ls.forEach(function (l) {
      if (/^\s*ASSINATURAS\s*$/i.test(l.texto)) r.titulo = true;
      trechos(l).forEach(function (t) {
        var s = l.texto.slice(t[0], t[1]).trim().toUpperCase();
        if (/^(CREDORA\/)?VENDEDORA$/.test(s)) r.vend = true;
        if (/^(DEVEDOR\/)?COMPRADOR$/.test(s)) r.comp = true;
        if (PAPEL_SOZINHO.test(s)) r.papel = true;
      });
    });
    return r;
  }
  /* Quais páginas valem: título ASSINATURAS (e a seguinte); VENDEDORA e COMPRADOR na mesma página; 01/11 (sandbox) duas
     páginas seguidas com papéis que, juntas, têm VENDEDORA e COMPRADOR (quadro-resumo que vira a página com a vendedora no
     pé); e a página com papéis logo depois de uma que vale (bloco com muitas pessoas). */
  function paginasQueValem(info) {
    var v = info.map(function (x, i) { return x.titulo || (x.vend && x.comp) || (i > 0 && info[i - 1].titulo); });
    for (var i = 0; i + 1 < info.length; i++) {
      var a = info[i], b = info[i + 1];
      if (a.papel && b.papel && (a.vend || b.vend) && (a.comp || b.comp)) { v[i] = true; v[i + 1] = true; }
    }
    for (var k = 1; k < info.length; k++) if (!v[k] && info[k].papel && v[k - 1]) v[k] = true;
    return v;
  }
  function acharLinhas(paginas, ajuste) {
    var a = (ajuste && ajuste.linha) || AJUSTE_LINHA, out = [];
    var pgs = (paginas || []).map(function (pg) { return { pg: pg, ls: linhas(pg) }; });
    var vale = paginasQueValem(pgs.map(function (x) { return paginaDeAssinatura(x.ls); }));
    pgs.forEach(function (x, ip) {
      if (!vale[ip]) return;
      var pg = x.pg, ls = x.ls, W = pg.largura, H = pg.altura;
      ls.forEach(function (l, i) {
        /* cada trecho de traços da linha é uma linha de assinatura. 01/11 (sandbox): dois traços lado a lado (TESTEMUNHA 1 |
           TESTEMUNHA 2) chegam colados no texto da linha — o vão entre eles (trechos) separa as colunas. Traço com texto
           antes ("ASSINATURA: ____") é campo de ciência, não conta */
        var re = /_{10,}/g, m, fimAnt = 0, achados = [], tr = trechos(l);
        while ((m = re.exec(l.texto))) {
          var mi = m.index, mf = m.index + m[0].length;
          tr.forEach(function (t) {
            var s0 = Math.max(mi, t[0]), s1 = Math.min(mf, t[1]);
            if (s1 - s0 >= 10) achados.push([s0, s1]);
          });
        }
        var validos = achados.filter(function (c) {
          var antes = l.texto.slice(fimAnt, c[0]);
          fimAnt = c[1];
          return !/\S/.test(antes);
        });
        validos.forEach(function (c) {
          var x0 = l.xs[c[0]], x1 = l.xs[c[1] - 1] + Math.max(1, (l.xs[c[1] - 1] - x0) / Math.max(1, c[1] - c[0] - 1));
          var tx = textoDaColuna(ls, i, x0, x1, validos.length === 1);
          /* unidade 22 (01/11): traço no pé da página e o "Nome:" no topo da seguinte — o texto vem de lá (a posição fica aqui) */
          if (!tx && !temTextoAbaixo(ls, i) && pgs[ip + 1]) tx = textoNoTopo(pgs[ip + 1].ls, x0, x1, validos.length === 1);
          out.push({ page: String(pg.numero), position: [limitar(x0 / W + (Number(a.dx) || 0)), limitar(topoAcima(l, H) + (Number(a.dy) || 0))],
                     texto: tx });
        });
      });
    });
    return out;
  }
  function temTextoAbaixo(ls, i) { for (var k = i + 1; k < ls.length; k++) if (/\S/.test(ls[k].texto)) return true; return false; }
  /* primeiras linhas da página (até 45 pt abaixo da primeira), na coluna [x0, x1] (ou inteiras); para no próximo traço */
  function textoNoTopo(ls, x0, x1, inteira) {
    var txt = [], tol = 6;
    if (!ls || !ls.length) return "";
    for (var k = 0; k < ls.length && txt.length < 4; k++) {
      var m = ls[k], col = "";
      if (m.y - ls[0].y > 45) break;
      trechos(m).forEach(function (t) {
        if (inteira || (m.xs[t[1] - 1] >= x0 - tol && m.xs[t[0]] <= x1 + tol)) col += (col ? " " : "") + m.texto.slice(t[0], t[1]);
      });
      if (!/\S/.test(col)) continue;
      if (TEM_TRACO.test(col)) break;
      txt.push(col.replace(/\s+/g, " ").trim());
    }
    return txt.join("\n");
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
     o traço entra inteiro; o bloco do lado, não); para no próximo traço ou num vão grande. 01/11 (sandbox): traço SOZINHO na
     linha (sem coluna ao lado) lê a linha de baixo inteira — o papel pode vir na mesma altura do nome, à direita */
  function textoDaColuna(ls, i, x0, x1, inteira) {
    var txt = [], ant = ls[i], tol = 6;
    for (var k = i + 1; k < ls.length && txt.length < 4; k++) {
      var m = ls[k], col = "";
      trechos(m).forEach(function (t) {
        if (inteira || (m.xs[t[1] - 1] >= x0 - tol && m.xs[t[0]] <= x1 + tol)) col += (col ? " " : "") + m.texto.slice(t[0], t[1]);
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

  /* 01/11/2026 (dono): prévia das assinaturas — desenha nas páginas, numa janela (w aberta no clique, por causa do bloqueio de
     janelas), a caixa onde a tinta de cada marca vai cair (assinatura em azul, visto em laranja), com o papel. prev:
     { pdfs: [{ doc, base64 }], caixas: [{ doc, page, papel, kind, position, tinta }], avisos }. Só navegador. */
  /* rótulo curto do visto na prévia (as caixas ficam lado a lado): C1, Cj, C2, V, T1, F1, CjF1… */
  function sigla(papel) {
    var p = String(papel || ""), m;
    if ((m = /^Comprador (\d)/.exec(p))) return "C" + m[1];
    if (/^Cônjuge do comprador/.test(p)) return "Cj";
    if ((m = /^Cônjuge do fiador (\d)/.exec(p))) return "CjF" + m[1];
    if ((m = /^Fiador (\d)/.exec(p))) return "F" + m[1];
    if ((m = /^Testemunha (\d)/.exec(p))) return "T" + m[1];
    if (/^Vendedor/.test(p)) return "V";
    if (/^Corretor/.test(p)) return "Cor";
    return p.slice(0, 3);
  }
  async function mostrarPrevia(prev, w) {
    w = w || window.open("about:blank", "_blank");
    if (!w) return;
    var d = w.document, pdfjs = await carregarPdfjs(), cores = { manuscript: "#1d4ed8", initials: "#c2410c" }, ESC = 1.4;
    d.title = "Prévia das assinaturas";
    d.body.style.cssText = "font:14px sans-serif;background:#f3f4f6;margin:16px";
    var t = d.createElement("h2"); t.textContent = "Prévia das assinaturas — azul: assinatura, laranja: visto (onde a tinta vai cair)"; d.body.appendChild(t);
    (prev.avisos || []).forEach(function (a) { var p = d.createElement("p"); p.textContent = "Atenção: " + a; p.style.color = "#b91c1c"; d.body.appendChild(p); });
    for (var i = 0; i < (prev.pdfs || []).length; i++) {
      var pd = prev.pdfs[i], cx = (prev.caixas || []).filter(function (x) { return x.doc === pd.doc; });
      if (!cx.length) continue;
      var pdf = await pdfjs.getDocument({ data: base64ParaBytes(pd.base64) }).promise;
      var nums = cx.map(function (x) { return Number(x.page); }).filter(function (n, k, a) { return a.indexOf(n) === k && n >= 1 && n <= pdf.numPages; }).sort(function (a, b) { return a - b; });
      for (var j = 0; j < nums.length; j++) {
        var pg = await pdf.getPage(nums[j]), vp = pg.getViewport({ scale: ESC }), W = pg.view[2] - pg.view[0], H = pg.view[3] - pg.view[1];
        var cv = d.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; cv.style.cssText = "display:block;background:#fff;margin:4px 0 16px;max-width:100%";
        await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        var g = cv.getContext("2d");
        cx.filter(function (x) { return Number(x.page) === nums[j]; }).forEach(function (x) {
          var px = x.position[0] * W, py = x.position[1] * H, q = x.tinta;
          g.strokeStyle = g.fillStyle = cores[x.kind] || "#111"; g.lineWidth = 2; g.font = "12px sans-serif";
          g.strokeRect((px + q[0]) * ESC, (py + q[1]) * ESC, (q[2] - q[0]) * ESC, (q[3] - q[1]) * ESC);
          g.fillText(x.kind === "initials" ? sigla(x.papel) : x.papel, (px + q[0]) * ESC, (py + q[1]) * ESC - 3);
        });
        var h = d.createElement("h3"); h.textContent = (pd.doc === "contrato" ? "Contrato" : pd.doc) + " — página " + nums[j];
        d.body.appendChild(h); d.body.appendChild(cv);
      }
      try { pdf.destroy(); } catch (e) { /* nada */ }
    }
  }

  var api = { mostrarPrevia: mostrarPrevia, acharNoContrato: acharNoContrato, acharLinhas: acharLinhas, paginaDoPdfjs: paginaDoPdfjs, linhas: linhas, paginasDoPdf: paginasDoPdf,
              PDFJS_URL: PDFJS_URL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (typeof window !== "undefined") window.RubricasVenda = api;
  return api;
})();
