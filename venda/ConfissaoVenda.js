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
  function quais(d) {
    var fl = (d && d.condominio && d.condominio.fluxo) || {}, out = [];
    if (totalPre(fl) > 0) out.push("PRE");
    if (positivo(fl.posN) && positivo(fl.posValor)) out.push("POS");
    return out;
  }
  function totalPre(fl) {
    var t = 0;
    [[fl.pre1N, fl.pre1Valor], [fl.pre2N, fl.pre2Valor]].forEach(function (s) { if (positivo(s[0]) && positivo(s[1])) t += s[0] * s[1]; });
    if (positivo(fl.balao1Valor)) t += fl.balao1Valor;
    if (positivo(fl.balao2Valor)) t += fl.balao2Valor;
    return so2(t);
  }
  function totalPos(fl) { return positivo(fl.posN) && positivo(fl.posValor) ? so2(fl.posN * fl.posValor) : 0; }

  /* O que falta para gerar os termos (só nomes de campo). Os dois fiadores são obrigatórios (8.1 do termo). */
  function faltas(d) {
    if (!quais(d).length) return [];
    var f = [], fis = fiadores(d);
    [0, 1].forEach(function (i) {
      var fi = fis[i] || {}, rot = "Fiador " + (i + 1) + " (termo de confissão)";
      if (!txt(fi.nome)) f.push(rot + ": nome");
      if (!txt(fi.cpf)) f.push(rot + ": CPF");
      else if (!R().cpfValido(fi.cpf)) f.push(rot + ": CPF inválido");
    });
    return f;
  }

  function quadroFiador(fi) { return txt(fi.nome) ? txt(fi.nome) + ", CPF nº " + txt(fi.cpf) : ""; }

  /* Marcadores de um termo (tipo "PRE" ou "POS"). Do contrato vêm comprador, casa e data; o resto é do termo. */
  function marcadores(d, tipo) {
    var mc = C().marcadores(d), fl = d.condominio.fluxo, fis = fiadores(d);
    var total = tipo === "POS" ? totalPos(fl) : totalPre(fl);
    var m = {
      COMPRADORES_QUADRO: mc.COMPRADORES_QUADRO,
      CASA_NUMERO: mc.CASA_NUMERO, CASA_TIPO: mc.CASA_TIPO,
      DATA_CONTRATO: C().dataBR(fl.assinatura),
      CIDADE_DATA: mc.CIDADE_DATA,
      TCD_TOTAL_EXTENSO: C().valorExtenso(total),
      /* o mesmo resumo do contrato (4.2.1 c / e) — sem o excedente do sinal, que é pago na assinatura */
      TCD_PARCELAS: tipo === "POS" ? C().parcelasPosChaves(fl) : C().parcelasPreChaves(fl, 0),
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

  var api = { COL: COL, TIPOS: TIPOS, PREFIXO: PREFIXO, MODELO: MODELO, quais: quais, faltas: faltas,
              marcadores: marcadores, totalPre: totalPre, totalPos: totalPos, colunaAssinadaDoNome: colunaAssinadaDoNome };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
