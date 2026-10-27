/* PreReservaVenda — regras puras do Termo de Pré-Reserva do condomínio (27/10/2026).
 * O termo garante a prioridade da unidade até a data da assinatura do contrato (Propriedade
 * PRE_RESERVA_DATA_LIMITE) mediante um valor fixo (PRE_RESERVA_VALOR), abatido do preço se o contrato
 * for assinado e devolvido integralmente se não for. Vem ANTES do contrato, no mesmo cartão da unidade.
 * Arquivo do projeto PORTAL-VENDA (cola como PreReservaVenda.gs) e testado no node
 * (venda/testes/pre-reserva.test.mjs). Sem rede, sem Notion, sem Drive. Repositório público: nenhum dado real. */
var PreReservaVenda = (function () {
  "use strict";

  /* colunas da linha da BANCO DE DADOS VENDAS CONDOMÍNIO */
  var COL = {
    CONTA: "PRÉ-RESERVA - CONTA PARA DEVOLUÇÃO",
    GERADO: "PRÉ-RESERVA - TERMO GERADO",
    ASSINADO: "PRÉ-RESERVA - TERMO ASSINADO",
    ENVELOPE: "PRÉ-RESERVA - ENVELOPE ID",
    SITUACAO: "PRÉ-RESERVA - SITUAÇÃO"
  };
  var TIPOS = {};
  TIPOS[COL.CONTA] = "rich_text";
  TIPOS[COL.GERADO] = "files";
  TIPOS[COL.ASSINADO] = "files";
  TIPOS[COL.ENVELOPE] = "rich_text";
  TIPOS[COL.SITUACAO] = "rich_text";

  function C() { return typeof ContratoVenda !== "undefined" ? ContratoVenda : require("./ContratoVenda.js"); }
  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function vazio(v) { return txt(v) === ""; }

  /* "3000" / "3.000,00" / 3000 -> 3000; inválido -> null */
  function valorDe(v) {
    if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
    var s = txt(v).replace(/^R\$\s*/i, "");
    if (!s) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    var n = Number(s);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  /* "2026-10-31" ou "31/10/2026" -> "2026-10-31"; inválido -> "" */
  function dataIso(v) {
    var s = txt(v), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + "-" + m[2] + "-" + m[3];
    if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) return m[3] + "-" + m[2] + "-" + m[1];
    return "";
  }

  /* d = ContratoVenda.montarDadosContrato(fontes) da linha do condomínio; x = { conta, valor, dataLimite, hojeISO, cidade } */
  function montar(d, x) {
    d = d || {}; x = x || {};
    var c1 = d.comprador1 || {}, co = d.condominio || {};
    return {
      preReservante: { nome: txt(c1.nome), cpf: txt(c1.cpf), nacionalidade: txt(c1.nacionalidade), estadoCivil: txt(c1.estadoCivil),
                       profissao: txt(c1.profissao), documento: txt(c1.documento), endereco: txt(c1.endereco),
                       email: txt(c1.email), telefone: txt(c1.telefone) },
      unidade: txt(co.unidade), tabela: co.tabela || null,
      conta: txt(x.conta), valor: valorDe(x.valor), dataLimite: dataIso(x.dataLimite),
      hojeISO: txt(x.hojeISO), cidade: txt(x.cidade) || "Goiânia"
    };
  }

  /* O que falta para gerar (só nomes de campo, nenhum dado pessoal). */
  function faltas(t) {
    var f = [], p = t.preReservante;
    function exige(ok, item) { if (!ok) f.push(item); }
    exige(!vazio(p.nome), "Pré-reservante: nome");
    if (vazio(p.cpf)) f.push("Pré-reservante: CPF");
    else if (!R().cpfValido(p.cpf)) f.push("Pré-reservante: CPF inválido");
    exige(!vazio(p.nacionalidade), "Pré-reservante: nacionalidade");
    exige(!vazio(p.documento), "Pré-reservante: RG");
    exige(!vazio(p.endereco), "Pré-reservante: endereço");
    exige(!vazio(p.email), "Pré-reservante: e-mail (coluna Email)");
    exige(!vazio(t.unidade), "Unidade");
    if (!vazio(t.unidade)) exige(!!t.tabela, "Unidade: fora da tabela do condomínio (tipo da casa)");
    if (vazio(t.conta)) f.push("Conta para devolução (preencha no cartão)");
    else if (!lerConta(t.conta).forma) f.push("Conta para devolução: escolha PIX ou dados bancários e salve de novo");
    exige(t.valor !== null, "Propriedade PRE_RESERVA_VALOR (valor da pré-reserva)");
    exige(!vazio(t.dataLimite), "Propriedade PRE_RESERVA_DATA_LIMITE (dia da assinatura do contrato)");
    return f;
  }

  function dataBR(iso) { return C().dataBR(iso); }

  function marcadores(t) {
    var p = t.preReservante, tb = t.tabela, n = /\d+/.exec(t.unidade);
    return {
      PRE_RESERVANTE_QUADRO: C().qualificacaoQuadro(p),
      PRE_RESERVANTE_NOME: p.nome,
      PRE_RESERVANTE_CPF: p.cpf,
      CASA_NUMERO: n ? (n[0].length < 2 ? "0" + n[0] : n[0]) : "",
      CASA_TIPO: tb ? tb.tipo : "",
      PRE_RESERVA_VALOR: t.valor === null ? "" : C().moedaBR(t.valor),
      PRE_RESERVA_VALOR_EXTENSO: t.valor === null ? "" : C().valorExtenso(t.valor),
      PRE_RESERVA_DATA_LIMITE: dataBR(t.dataLimite),
      PRE_RESERVANTE_CONTA: t.conta,
      CIDADE_DATA: t.cidade + ", " + C().dataPorExtenso(t.hojeISO)
    };
  }

  /* O que entra no carimbo do PDF: quem assina e o que o termo diz (fora: a data de hoje e a cidade). */
  function baseCarimbo(t) {
    return { termo: "PRE_RESERVA", preReservante: t.preReservante, unidade: t.unidade, tipo: t.tabela ? t.tabela.tipo : "",
             conta: t.conta, valor: t.valor, dataLimite: t.dataLimite };
  }

  /* 27/10 (dono): a conta deixou de ser texto livre. O cartão escolhe PIX (chave + banco) ou dados
   * bancários (banco, agência, conta e tipo); a coluna guarda a frase pronta que entra no termo
   * ("qual seja: ...") e lerConta a desmonta de volta para a tela. */
  var TIPOS_CONTA = ["corrente", "poupança", "pagamento"];
  var RE_PIX = /^PIX, chave (.+), no banco (.+)$/;
  var RE_BANCO = /^Banco (.+), agência ([0-9][0-9-]*), conta (corrente|poupança|pagamento) nº ([0-9][0-9xX-]*)$/;
  function limpa(v) { return txt(v).replace(/\{\{|\}\}/g, "").replace(/\s+/g, " ").trim(); }

  /* o = { forma: "PIX", chave, banco } | { forma: "BANCO", banco, agencia, conta, tipo } -> { ok, valor } ou { ok:false, erro } */
  function montarConta(o) {
    o = o || {};
    var forma = limpa(o.forma).toUpperCase(), banco = limpa(o.banco).replace(/,/g, " ").replace(/\s+/g, " ");
    if (forma === "PIX") {
      var chave = limpa(o.chave).replace(/,/g, "");
      if (chave.length < 5) return { ok: false, erro: "PIX_SEM_CHAVE" };
      if (chave.length > 120) return { ok: false, erro: "CONTA_LONGA" };
      if (banco.length < 2) return { ok: false, erro: "SEM_BANCO" };
      return { ok: true, valor: "PIX, chave " + chave + ", no banco " + banco.slice(0, 120) };
    }
    if (forma === "BANCO") {
      var ag = limpa(o.agencia).replace(/\s/g, ""), ct = limpa(o.conta).replace(/\s/g, ""), tipo = limpa(o.tipo).toLowerCase();
      if (banco.length < 2) return { ok: false, erro: "SEM_BANCO" };
      if (!/^[0-9][0-9-]{0,9}$/.test(ag)) return { ok: false, erro: "AGENCIA_INVALIDA" };
      if (!/^[0-9][0-9xX-]{0,19}$/.test(ct)) return { ok: false, erro: "CONTA_INVALIDA" };
      if (TIPOS_CONTA.indexOf(tipo) < 0) return { ok: false, erro: "TIPO_CONTA_INVALIDO" };
      return { ok: true, valor: "Banco " + banco.slice(0, 120) + ", agência " + ag + ", conta " + tipo + " nº " + ct };
    }
    return { ok: false, erro: "FORMA_CONTA" };
  }
  /* frase gravada -> objeto da tela; texto antigo (livre) volta como { forma: "", livre } */
  function lerConta(s) {
    s = txt(s);
    var m;
    if ((m = RE_PIX.exec(s))) return { forma: "PIX", chave: m[1], banco: m[2] };
    if ((m = RE_BANCO.exec(s))) return { forma: "BANCO", banco: m[1], agencia: m[2], tipo: m[3], conta: m[4] };
    return { forma: "", livre: s };
  }
  /* Entrada do cartão: objeto estruturado (o normal) ou a frase já montada. { ok, valor } ou { ok:false, erro } */
  function validarConta(v) {
    if (v && typeof v === "object") return montarConta(v);
    var s = limpa(v);
    if (!s) return { ok: false, erro: "FORMA_CONTA" };
    return lerConta(s).forma ? { ok: true, valor: s } : { ok: false, erro: "FORMA_CONTA" };
  }

  var api = { COL: COL, TIPOS: TIPOS, montar: montar, faltas: faltas, marcadores: marcadores, baseCarimbo: baseCarimbo,
              validarConta: validarConta, montarConta: montarConta, lerConta: lerConta, TIPOS_CONTA: TIPOS_CONTA,
              valorDe: valorDe, dataIso: dataIso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
