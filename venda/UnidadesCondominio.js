/* UnidadesCondominio — tipo, planta e áreas de cada casa dos condomínios, para o quadro-resumo do contrato.
 * Arquivo do projeto PORTAL-VENDA (cola como UnidadesCondominio.gs) e testado no node
 * (venda/testes/contrato-condominio-v2.test.mjs). Sem rede, sem Notion.
 *
 * São dados do memorial de incorporação REGISTRADO (público no cartório), não de pessoas: por isso
 * moram aqui e não numa base editável. Fonte do Reserva dos Ipês (21/10/2026): arquivos da obra no
 * Mais Controle — "R01 - QUADROS ABNT" (aba CAPA, resumo de áreas e frações ideais) e a cláusula 7
 * do "R02 - MEMORIAL DE INCORPORAÇÃO". O memorial separa 70,27 m² privativos + 1,70 m² de área comum
 * gourmet/guarita = 71,97 m² construídos por casa; a fração ideal é de 1,613% em todas.
 * Atenção: a base UNIDADES do simulador põe a casa 62 no tipo 5 — o memorial diz tipo 06, e vale ele. */
var UnidadesCondominio = (function () {
  "use strict";

  function chave(s) {
    return String(s === null || s === undefined ? "" : s).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/^\s*CONDOMINIO\s+(RESIDENCIAL\s+)?/, "").replace(/\s+/g, " ").trim();
  }

  /* grupos de casas: [primeira, última, tipo, fração ideal em m²] */
  var CONDOMINIOS = {
    "RESERVA DOS IPES": {
      areaPrivativaConstruida: 70.27, areaTotalConstruida: 71.97, fracaoPct: "1,613", casaModelo: 1,
      grupos: [[1, 6, "01", 257.70], [7, 18, "02", 257.79], [19, 30, "03", 257.79], [31, 39, "04", 257.70],
               [40, 51, "02", 257.79], [52, 61, "05", 257.76], [62, 62, "06", 257.77]]
    }
  };

  /* { numero, tipo, planta, areaPrivativaConstruida, areaTotalConstruida, fracaoM2, fracaoPct, casaModelo } ou null */
  function unidade(condominio, unidadeTxt) {
    var c = CONDOMINIOS[chave(condominio)];
    var m = /\d+/.exec(String(unidadeTxt === null || unidadeTxt === undefined ? "" : unidadeTxt));
    if (!c || !m) return null;
    var n = Number(m[0]);
    for (var i = 0; i < c.grupos.length; i++) {
      var g = c.grupos[i];
      if (n < g[0] || n > g[1]) continue;
      return { numero: n, tipo: g[2], planta: "Tipo " + Number(g[2]), areaPrivativaConstruida: c.areaPrivativaConstruida,
               areaTotalConstruida: c.areaTotalConstruida, fracaoM2: g[3], fracaoPct: c.fracaoPct, casaModelo: n === c.casaModelo };
    }
    return null;
  }

  return { unidade: unidade };
})();
if (typeof module !== "undefined" && module.exports) module.exports = UnidadesCondominio;
