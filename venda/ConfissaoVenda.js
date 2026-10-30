/* ConfissaoVenda — regras puras dos TERMOS DE CONFISSÃO DE DÍVIDA do condomínio (28/10/2026).
 * Dois termos do advogado, anexos do contrato: parcelas da ENTRADA antes das chaves (PRÉ) e depois (PÓS).
 * Gerados junto com o contrato FINAL e assinados no MESMO envelope da Clicksign; os fiadores assinam só
 * os termos. Decisões do dono com a diretoria (28/10): dos fiadores, só nome e CPF (e o e-mail para a
 * assinatura); o item 4.1 usa o mesmo resumo do contrato (séries, balões e data da 1ª) com o total; sem
 * parcelas pós-chaves (entrada em 24x) o termo PÓS não é gerado.
 * Arquivo do projeto PORTAL-VENDA (cola como ConfissaoVenda.gs) e testado no node
 * (venda/testes/confissao.test.mjs). Sem rede, sem Notion, sem Drive. Repositório público: nenhum dado real. */
var ConfissaoVenda = (function () {
  "use strict";

  /* colunas da linha da BANCO DE DADOS VENDAS CONDOMÍNIO (arquivos) */
  var COL = {
    PRE_GERADO: "CONFISSÃO PRÉ-CHAVES - GERADA", PRE_ASSINADO: "CONFISSÃO PRÉ-CHAVES - ASSINADA",
    POS_GERADO: "CONFISSÃO PÓS-CHAVES - GERADA", POS_ASSINADO: "CONFISSÃO PÓS-CHAVES - ASSINADA"
  };
  var TIPOS = {};
  Object.keys(COL).forEach(function (k) { TIPOS[COL[k]] = "files"; });
  /* nome do PDF: o prefixo diz qual termo é (é por ele que a assinatura acha a coluna do assinado) */
  var PREFIXO = { PRE: "CONFISSÃO PRÉ-CHAVES - ", POS: "CONFISSÃO PÓS-CHAVES - " };
  var MODELO = { PRE: "MODELO_CONFISSAO_PRE_ID", POS: "MODELO_CONFISSAO_POS_ID" };

  function C() { return typeof ContratoVenda !== "undefined" ? ContratoVenda : require("./ContratoVenda.js"); }
  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function positivo(v) { return typeof v === "number" && isFinite(v) && v > 0; }
  function so2(n) { return Math.round(n * 100) / 100; }

  function fiadores(d) { return (d && d.condominio && d.condominio.fiadores) || []; }

  /* Quais termos esta venda tem: PRÉ quando há parcelas antes das chaves; PÓS quando há pós-chaves. */
  /* 29/10: dos grupos do contrato (gavetas do simulador ou fluxo alterado no portal) */
  function grupos(d) { return C().gruposFluxo((d && d.condominio) || {}); }
  /* aceita os grupos ou o fluxo das gavetas (os testes antigos passam o fluxo) */
  function comoGrupos(x) { return x && Array.isArray(x.pre) ? x : C().gruposFluxo({ fluxo: x || {} }, 0); }
  function quais(d) {
    var G = grupos(d), out = [];
    if (totalPre(G) > 0) out.push("PRE");
    if (totalPos(G) > 0) out.push("POS");
    return out;
  }
  function serieTotal(s) { return s.u ? s.v * (s.n - 1) + s.u : s.v * s.n; }
  function totalPre(G) {
    G = comoGrupos(G);
    var t = 0;
    G.pre.forEach(function (s) { t += serieTotal(s); });
    G.baloes.forEach(function (b) { t += b.v; });
    return so2(t);
  }
  function totalPos(G) { G = comoGrupos(G); return so2(G.pos.reduce(function (t, s) { return t + serieTotal(s); }, 0)); }

  /* 30/10/2026 (dono): entrada em 24x, sem parcelas pós-chaves = fiador NÃO é necessário. */
  function fiadorDispensado(d) { return quais(d).indexOf("POS") < 0; }

  /* O que falta para gerar os termos (só nomes de campo). Os dois fiadores são obrigatórios (8.1 do termo),
     menos em 24x sem pós-chaves (30/10/2026): aí só se confere o fiador que tiver sido informado. */
  function faltas(d) {
    if (!quais(d).length) return [];
    var f = [], fis = fiadores(d), disp = fiadorDispensado(d);
    [0, 1].forEach(function (i) {
      var fi = fis[i] || {}, rot = "Fiador " + (i + 1) + " (termo de confissão)";
      if (disp && !txt(fi.nome) && !txt(fi.cpf)) return;
      if (!txt(fi.nome)) f.push(rot + ": nome");
      if (!txt(fi.cpf)) f.push(rot + ": CPF");
      else if (!R().cpfValido(fi.cpf)) f.push(rot + ": CPF inválido");
    });
    return f;
  }

  function quadroFiador(fi) { return txt(fi.nome) ? txt(fi.nome) + ", CPF nº " + txt(fi.cpf) : ""; }

  /* Marcadores de um termo (tipo "PRE" ou "POS"). Do contrato vêm comprador, casa e data; o resto é do termo. */
  function marcadores(d, tipo) {
    var mc = C().marcadores(d), fl = d.condominio.fluxo, fis = fiadores(d), G = grupos(d);
    var total = tipo === "POS" ? totalPos(G) : totalPre(G);
    var m = {
      COMPRADORES_QUADRO: mc.COMPRADORES_QUADRO,
      CASA_NUMERO: mc.CASA_NUMERO, CASA_TIPO: mc.CASA_TIPO,
      DATA_CONTRATO: C().dataBR(fl.assinatura),
      CIDADE_DATA: mc.CIDADE_DATA,
      TCD_TOTAL_EXTENSO: C().valorExtenso(total),
      /* o mesmo resumo do contrato (4.2.1 c / e) — sem o excedente do sinal, que é pago na assinatura */
      TCD_PARCELAS: tipo === "POS" ? C().textoPosChaves(G) : C().textoPreChaves(G, true),
      ASSINATURA_COMPRADORES_NOMES: mc.ASSINATURA_COMPRADORES_NOMES,
      ASSINATURA_COMPRADORES_CPFS: mc.ASSINATURA_COMPRADORES_CPFS
    };
    [0, 1].forEach(function (i) {
      var fi = fis[i] || {}, n = i + 1;
      m["FIADOR" + n + "_QUADRO"] = quadroFiador(fi);
      m["FIADOR" + n + "_NOME"] = txt(fi.nome);
      m["FIADOR" + n + "_CPF"] = txt(fi.cpf);
    });
    return m;
  }

  /* Coluna do assinado a partir do nome do PDF (o envelope leva o nome do gerado). "" = não é termo. */
  function colunaAssinadaDoNome(nome) {
    var n = txt(nome);
    if (n.indexOf(PREFIXO.PRE) === 0) return COL.PRE_ASSINADO;
    if (n.indexOf(PREFIXO.POS) === 0) return COL.POS_ASSINADO;
    return "";
  }

  var api = { COL: COL, TIPOS: TIPOS, PREFIXO: PREFIXO, MODELO: MODELO, quais: quais, faltas: faltas, fiadorDispensado: fiadorDispensado,
              marcadores: marcadores, totalPre: totalPre, totalPos: totalPos, colunaAssinadaDoNome: colunaAssinadaDoNome };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
