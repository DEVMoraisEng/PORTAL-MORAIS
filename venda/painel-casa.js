/* painel-casa.js — o que o painel da casa (vendas.html) mostra e em que ordem (entrega 14).
 * JS puro (navegador e node): o vendas.html chama window.PainelCasa na hora de desenhar; se este arquivo não
 * carregar, o painel fica como antes (todas as colunas, ordem antiga).
 * - ocultoNoPainel: colunas técnicas que já aparecem nos blocos (Contrato, Clicksign, Recebimentos, Mais Controle)
 *   ou que só o app usa. Continuam no Notion; só não viram campo editável/arquivo solto no painel.
 * - ordenar / grupoDoCampo: compradores, depois os dados do contrato, numa ordem lógica e com título por grupo;
 *   as colunas que não estão na lista vêm depois, na ordem de sempre.
 * Repositório público: nenhum dado real aqui. */
(function (raiz) {
  "use strict";
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }

  var OCULTOS = ["ASSINATURA - ENVELOPE ID", "ASSINATURA - SITUAÇÃO", "CONDOMÍNIO - VENDA ID", "MC - DISTRATO", "MC - SITUAÇÃO",
                 "MC - VENDA ID", "DOSSIÊ IMÓVEL - OBSERVAÇÃO", "CONTRATO GERADO", "CONTRATO ASSINADO",
                 /* a data da comissão saiu da tela e do contrato (dono, 08/10) */
                 "CONTRATO - COMISSÃO VENCIMENTO"];
  /* RECEBIMENTO - * (data, comprovante, quem confirmou): moram no bloco Recebimentos */
  var PREFIXOS_OCULTOS = ["RECEBIMENTO - "];
  var OCULTOS_N = OCULTOS.map(norm), PREFIXOS_N = PREFIXOS_OCULTOS.map(norm);
  function ocultoNoPainel(nome) {
    var n = norm(nome);
    if (OCULTOS_N.indexOf(n) >= 0) return true;
    return PREFIXOS_N.some(function (p) { return n.indexOf(p) === 0; });
  }

  /* comprador 1: nome, CPF, telefone e e-mail principais ficam no resumo "Dados da Venda" (CLIENTES, CPF, Nº Whatsapp, Email) */
  function comprador(n) {
    return ["NOME", "CPF", "DOCUMENTO", "NACIONALIDADE", "ESTADO CIVIL", "PROFISSÃO", "E-MAIL", "TELEFONE", "ENDEREÇO"]
      .map(function (x) { return "COMPRADOR " + n + " - " + x; });
  }
  var GRUPOS = [
    { titulo: "Comprador 1", campos: comprador(1) },
    { titulo: "Comprador 2", campos: comprador(2) },
    { titulo: "Contrato — pagamento e comissão", campos: [
      "CONTRATO - SINAL VALOR", "CONTRATO - SINAL DATA", "CONTRATO - ENTRADA VALOR", "CONTRATO - ENTRADA VENCIMENTO",
      "CONTRATO - INTERMEDIÁRIA VALOR", "CONTRATO - INTERMEDIÁRIA VENCIMENTO", "CONTRATO - FORMA DE PAGAMENTO",
      "CONTRATO - COMISSÃO FORMA", "CONTRATO - COMISSÃO PAGA POR"] },
    { titulo: "Contrato — imóvel", campos: [
      "CONTRATO - MATRÍCULA INDIVIDUAL", "CONTRATO - CRI DA MATRÍCULA", "CONTRATO - ÁREA DO LOTE (M²)", "CONTRATO - CONFRONTAÇÕES",
      "CONTRATO - ALVARÁ Nº", "CONTRATO - ALVARÁ DATA", "CONTRATO - HABITE-SE Nº", "CONTRATO - HABITE-SE DATA",
      "CONTRATO - MATRÍCULA DO LOTEAMENTO", "CONTRATO - CARTÓRIO DO LOTEAMENTO", "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO",
      "CONTRATO - CONDIÇÕES ESPECIAIS"] }
  ];
  var ARQUIVOS = ["COMPRADOR 1 - IDENTIDADE", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "COMPRADOR 2 - IDENTIDADE", "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO"];

  var POSICAO = {}, GRUPO = {}, k = 0;
  GRUPOS.forEach(function (g) { g.campos.forEach(function (c) { var n = norm(c); POSICAO[n] = k++; GRUPO[n] = g.titulo; }); });
  /* título do grupo da coluna ("" = fora da lista) */
  function grupoDoCampo(nome) { return GRUPO[norm(nome)] || ""; }
  /* os da lista primeiro (na ordem dela), depois o resto na ordem recebida */
  function ordenarPor(nomes, posicao) {
    var dentro = [], fora = [];
    (nomes || []).forEach(function (nome, i) {
      var p = posicao[norm(nome)];
      if (p === undefined) fora.push(nome); else dentro.push({ nome: nome, p: p, i: i });
    });
    dentro.sort(function (a, b) { return a.p - b.p || a.i - b.i; });
    return dentro.map(function (x) { return x.nome; }).concat(fora);
  }
  function ordenar(nomes) { return ordenarPor(nomes, POSICAO); }
  var POS_ARQ = {};
  ARQUIVOS.forEach(function (c, i) { POS_ARQ[norm(c)] = i; });
  function ordenarArquivos(nomes) { return ordenarPor(nomes, POS_ARQ); }

  var api = { OCULTOS: OCULTOS, PREFIXOS_OCULTOS: PREFIXOS_OCULTOS, GRUPOS: GRUPOS, ocultoNoPainel: ocultoNoPainel,
              grupoDoCampo: grupoDoCampo, ordenar: ordenar, ordenarArquivos: ordenarArquivos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.PainelCasa = api;
})(typeof window !== "undefined" ? window : this);
