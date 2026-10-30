/* 30/10/2026 (pedido do dono): tudo o que se faz no contrato de uma venda fica gravado, com quem fez e quando,
 * na coluna HISTÓRICO DO CONTRATO da linha da venda — "se alguém fizer besteira, a gente sabe quem foi".
 * Funções puras (testes em venda/testes/log-contrato.test.mjs); quem grava é o LogContrato.gs.
 * Uma linha por ação, a mais nova em cima: "30/10/2026 19:21 — login — o que fez: detalhe". */
var LogContratoVenda = (function () {
  var MAX = 40000;   /* ~21 pedaços de 1.900 caracteres no Notion; passando disso caem as linhas mais antigas */
  var DETALHE_MAX = 300;

  function txt(v) { return v === null || v === undefined ? "" : String(v); }
  function curto(v, n) {
    var s = txt(v).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function preReserva(p) { return txt(p && p.doc).toUpperCase() === "PRE_RESERVA"; }
  function doc(p) { return preReserva(p) ? "o termo de pré-reserva" : "o contrato"; }
  function docDe(p) { return preReserva(p) ? "do termo de pré-reserva" : "do contrato"; }

  /* ação -> function (p, r) { return "o que fez" }. Só ações que GRAVAM alguma coisa na venda;
     leituras (estado, ver PDF, consultar situação) não entram. */
  var ACOES = {
    salvarFluxo: function (p) {
      if (p && p.voltar) return "voltou o fluxo de pagamento ao da proposta" + (txt(p.motivo).trim() ? ": " + curto(p.motivo, DETALHE_MAX) : "");
      var s = "alterou o fluxo de pagamento: " + curto(p && p.motivo, DETALHE_MAX);
      if (txt(p && p.motivoPreco).trim()) s += " | valor da casa: " + curto(p.motivoPreco, DETALHE_MAX);
      return s;
    },
    salvarCondicoesEspeciais: function (p) {
      var t = curto(p && p.texto, DETALHE_MAX);
      return t ? "condições especiais (item 16): " + t : "apagou as condições especiais (item 16)";
    },
    gerarPreContrato: function () { return "gerou o pré-contrato"; },
    aprovarPreContrato: function () { return "gerou o contrato final"; },
    gerarContrato: function () { return "gerou o contrato final"; },
    assinaturaEnviar: function (p) { return "enviou " + doc(p) + " para assinatura na Clicksign"; },
    assinaturaReenviar: function (p) { return "reenviou o link de assinatura " + docDe(p); },
    assinaturaCancelar: function (p) { return "cancelou o envelope " + docDe(p) + " na Clicksign"; },
    escolherTestemunhas: function () { return "escolheu as testemunhas"; },
    salvarCamposContrato: function (p) {
      var c = (p && p.campos) || {}, nomes = [];
      for (var g in c) {
        if (c[g] && typeof c[g] === "object" && !Array.isArray(c[g])) for (var k in c[g]) nomes.push(k);
        else nomes.push(g);
      }
      var s = "preencheu campos do contrato" + (nomes.length ? ": " + curto(nomes.join(", "), DETALHE_MAX) : "");
      return p && p.conta !== undefined && p.conta !== null ? s + (nomes.length ? " e a conta de recebimento" : " (conta de recebimento)") : s;
    },
    escolherContaRecebimento: function () { return "escolheu a conta de recebimento"; },
    mcLancar: function () { return "lançou a venda no Mais Controle"; },
    gerarVendaCondominio: function () { return "gerou a venda do condomínio"; },
    salvarContaPreReserva: function () { return "gravou a conta de devolução da pré-reserva"; },
    gerarTermoPreReserva: function () { return "gerou o termo de pré-reserva"; },
    conferirDocumentos: function () { return "pediu a conferência dos documentos pela IA"; },
    confirmarConferencia: function () { return "confirmou um item da conferência dos documentos"; },
    conferir: function () { return "marcou o dossiê como conferido"; },
    devolver: function (p) { return "devolveu o dossiê: " + curto(p && p.motivo, DETALHE_MAX); },
    tipoCasa: function (p) { return "mudou o tipo da casa" + (txt(p && p.valor).trim() ? " para " + curto(p.valor, 40) : ""); },
    anexarDocumento: function () { return "anexou um documento"; },
    soltarDocumento: function () { return "tirou um documento"; },
    recebimentoConfirmar: function () { return "confirmou um recebimento"; }
  };

  /* linha do log, ou "" quando a ação não entra no histórico ou não deu certo */
  function linha(acao, p, r, quem, quando) {
    var f = ACOES[acao];
    if (!f || !r || r.ok !== true) return "";
    var o = txt(f(p || {}, r)).replace(/\s+/g, " ").trim();
    if (!o) return "";
    return txt(quando).trim() + " — " + (curto(quem, 80) || "?") + " — " + o;
  }
  /* põe a linha nova em cima; se passar do limite, caem as mais antigas (linhas inteiras) */
  function juntar(texto, nova) {
    var l = ler(texto);
    if (txt(nova).trim()) l.unshift(txt(nova).trim());
    var s = l.join("\n");
    while (s.length > MAX && l.length > 1) { l.pop(); s = l.join("\n"); }
    return s.slice(0, MAX);
  }
  function ler(texto) {
    return txt(texto).split("\n").map(function (x) { return x.trim(); }).filter(function (x) { return x !== ""; });
  }

  var api = { ACOES: ACOES, MAX: MAX, linha: linha, juntar: juntar, ler: ler };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
