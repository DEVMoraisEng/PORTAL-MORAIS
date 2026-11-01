/* FiadoresVenda — regras puras do bloco "Fiadores" da aba Contrato do cartão do condomínio (01/11/2026, teste e2e).
 * As faltas "Fiador N: …" e "Cônjuge do comprador 1: …" do gerador não tinham onde ser corrigidas (caíam em `outras`
 * do ContratoVenda.camposAbertos). Este módulo diz o que o bloco mostra (camposFiadores) e confere o que a tela manda
 * gravar (validarValores) contra uma LISTA FECHADA de colunas da linha do condomínio.
 * Arquivo do projeto PORTAL-VENDA (cola como FiadoresVenda.gs) e testado no node (venda/testes/fiadores-venda.test.mjs).
 * Sem rede. Repositório público: nenhum dado real. */
var FiadoresVenda = (function () {
  "use strict";

  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function chave(v) { return R().chave(txt(v)); }

  /* as mesmas opções do "Corrigir aqui" (ConferenciaDocs) e do completar-venda.html — coluna de texto */
  var OPCOES_CIVIL = ["SOLTEIRO", "CASADO", "DIVORCIADO", "VIUVO", "UNIAO ESTAVEL"];
  /* coluna de texto do regime: a lista; o contrato escreve em minúsculas ("sob o regime de comunhão parcial de bens") */
  var OPCOES_REGIME = ["COMUNHÃO PARCIAL DE BENS", "COMUNHÃO UNIVERSAL DE BENS", "SEPARAÇÃO TOTAL DE BENS", "PARTICIPAÇÃO FINAL NOS AQUESTOS"];

  /* colunas do fiador n (GerarContrato.gs ctrDadosCondominio_): [coluna, rótulo, tipo] */
  function colunasFiador(n) {
    return [["FIADOR " + n, "Nome", "texto"], ["CPF FIADOR " + n, "CPF", "cpf"], ["EMAIL FIADOR " + n, "E-mail", "email"],
            ["ESTADO CIVIL FIADOR " + n, "Estado civil", "civil"],
            ["CONJUGE FIADOR " + n, "Cônjuge — nome (se casado)", "texto"], ["CPF CONJUGE FIADOR " + n, "Cônjuge — CPF", "cpf"],
            ["EMAIL CONJUGE FIADOR " + n, "Cônjuge — e-mail", "email"]];
  }
  /* cônjuge do comprador 1 (GerarContrato.gs: conjugeComprador = CONJUGE, CPF CONJUGE, EMAIL CONJUGE, REGIME ou REGIME DE BENS) */
  var REGIMES = ["REGIME", "REGIME DE BENS"];
  function colunasConjuge(colRegime) {
    return [["CONJUGE", "Nome do cônjuge", "texto"], ["CPF CONJUGE", "CPF do cônjuge", "cpf"], ["EMAIL CONJUGE", "E-mail do cônjuge", "email"],
            [colRegime, "Regime de bens (não vale para união estável)", "regime"]];
  }
  /* LISTA FECHADA do que o bloco grava (nada mais da linha do condomínio) */
  var PERMITIDAS = [].concat(colunasFiador(1), colunasFiador(2), colunasConjuge("REGIME"), [["REGIME DE BENS", "", "regime"]])
    .map(function (x) { return x[0]; });
  function tipoDa(coluna) {
    var k = chave(coluna);
    if (/^CPF /.test(k)) return "cpf";
    if (/^EMAIL /.test(k)) return "email";
    if (/^ESTADO CIVIL /.test(k)) return "civil";
    if (k === "REGIME" || k === "REGIME DE BENS") return "regime";
    return "texto";
  }
  function permitida(coluna) {
    var k = chave(coluna);
    for (var i = 0; i < PERMITIDAS.length; i++) if (chave(PERMITIDAS[i]) === k) return PERMITIDAS[i];
    return "";
  }
  function casado(ec) { return /CASAD|UNI[AÃ]O/.test(chave(ec)); }

  function valorDe(linha, coluna) {
    var k = chave(coluna);
    for (var n in (linha || {})) if (chave(n) === k) return txt(linha[n]);
    return "";
  }
  function temColuna(linha, coluna) {
    var k = chave(coluna);
    for (var n in (linha || {})) if (chave(n) === k) return true;
    return false;
  }
  function campo(linha, x) {
    var c = { coluna: x[0], rotulo: x[1], valor: valorDe(linha, x[0]), tipo: x[2], opcoes: null };
    if (x[2] === "civil") c.opcoes = OPCOES_CIVIL.slice();
    if (x[2] === "regime") c.opcoes = OPCOES_REGIME.slice();
    return c;
  }

  /* linha: { "FIADOR 1": "…", "CPF FIADOR 1": "…", … } (só as colunas que a base tem; ausente = vazio);
     faltas: as do gerador (ContratoVenda.faltasContrato + ConfissaoVenda.faltas); prazo: PRAZO ENTRADA (24/36/48).
     → { mostrar, precisa (fiadores), titulo, fiadores: [{n, campos}], conjuge: {campos} | null, faltas, aviso, botaoConjuge } */
  /* opts.soEmail (01/11/2026, revisão final I1): contrato FINAL já gerado — o bloco só abre pelas faltas recebidas (as de
     e-mail do envio), sem a regra dos 36x, e mostra só as caixas de e-mail de quem falta (fiador n inteiro: ele e o cônjuge). */
  function camposFiadores(linha, faltas, prazo, opts) {
    linha = linha || {};
    var soEmail = !!(opts && opts.soEmail);
    var fl = (faltas || []).map(txt);
    var deFiador = fl.filter(function (f) { return /^(Fiador [12]\b|C[ôo]njuge do fiador [12])/i.test(f); });
    var deConjuge = fl.filter(function (f) { return /^C[ôo]njuge do comprador/i.test(f); });
    /* 36x/48x: os dois fiadores são obrigatórios (8.1 do termo); sem nome e CPF dos dois, o bloco abre */
    var incompletos = [1, 2].some(function (n) { return !valorDe(linha, "FIADOR " + n) || !valorDe(linha, "CPF FIADOR " + n); });
    var precisa = deFiador.length > 0 || (!soEmail && Number(prazo) > 24 && incompletos);
    var colRegime = !temColuna(linha, "REGIME") && temColuna(linha, "REGIME DE BENS") ? "REGIME DE BENS" : "REGIME";
    function filtro(l) { return soEmail ? l.filter(function (x) { return x[2] === "email"; }) : l; }
    var quais = soEmail ? [1, 2].filter(function (n) { return deFiador.some(function (f) { return new RegExp("^(Fiador " + n + "\\b|C[ôo]njuge do fiador " + n + "\\b)", "i").test(f); }); }) : [1, 2];
    var out = {
      precisa: precisa,
      fiadores: precisa ? quais.map(function (n) { return { n: n, campos: filtro(colunasFiador(n)).map(function (x) { return campo(linha, x); }) }; }) : [],
      conjuge: deConjuge.length ? { campos: filtro(colunasConjuge(colRegime)).map(function (x) { return campo(linha, x); }) } : null,
      faltas: deFiador.concat(deConjuge), aviso: "", botaoConjuge: false
    };
    out.mostrar = out.precisa || !!out.conjuge;
    out.titulo = out.precisa && out.conjuge ? "Fiadores e cônjuge" : out.precisa ? "Fiadores" : out.conjuge ? "Cônjuge do comprador" : "";
    if (precisa && !soEmail) {
      /* #74: casado, o OUTRO fiador tem de ser o cônjuge (o CPF do cônjuge do fiador = CPF do outro fiador) */
      var casadoSemPar = deFiador.some(function (f) { return /: casado/.test(f); });
      var ec1 = valorDe(linha, "ESTADO CIVIL FIADOR 1");
      out.botaoConjuge = casado(ec1) && !!valorDe(linha, "CONJUGE FIADOR 1") && !!valorDe(linha, "CPF CONJUGE FIADOR 1");
      if (casadoSemPar)
        out.aviso = "Fiador casado: o cônjuge dele tem de ser o outro fiador. Preencha o nome e o CPF do cônjuge do Fiador 1, " +
          "clique em Salvar e depois em \"O cônjuge do Fiador 1 é o Fiador 2\".";
    }
    return out;
  }

  /* 01/11/2026 (revisão final, I1): conta barata, só pela linha, antes de reler os cadastros com o contrato FINAL — alguém
     com nome e sem e-mail (ou com e-mail inválido): fiador n, cônjuge do fiador n ou cônjuge do comprador. */
  function emailTalvezFaltando(linha) {
    var pares = [["FIADOR 1", "EMAIL FIADOR 1"], ["FIADOR 2", "EMAIL FIADOR 2"], ["CONJUGE FIADOR 1", "EMAIL CONJUGE FIADOR 1"],
                 ["CONJUGE FIADOR 2", "EMAIL CONJUGE FIADOR 2"], ["CONJUGE", "EMAIL CONJUGE"]];
    return pares.some(function (p) {
      var e = valorDe(linha, p[1]);
      return !!valorDe(linha, p[0]) && (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    });
  }

  /* valores da tela {coluna: valor} → { ok, valores: {coluna da lista: valor pronto} } ou { ok:false, erro, coluna }.
     Nada é gravado se qualquer coluna estiver fora da lista ou com CPF/e-mail inválido. Vazio = apagar. */
  function validarValores(valores) {
    if (!valores || typeof valores !== "object" || Array.isArray(valores)) return { ok: false, erro: "NADA_PARA_GRAVAR" };
    var out = {}, n = 0, cols = Object.keys(valores);
    for (var i = 0; i < cols.length; i++) {
      var col = permitida(cols[i]);
      if (!col) return { ok: false, erro: "COLUNA_NAO_PERMITIDA", coluna: String(cols[i]).slice(0, 60) };
      var v = txt(valores[cols[i]]).slice(0, 300), t = tipoDa(col);
      if (v && t === "cpf") {
        if (!R().cpfValido(v)) return { ok: false, erro: "CPF_INVALIDO", coluna: col };
        v = R().formatarCpf(v);
      }
      if (v && t === "email") {
        v = v.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, erro: "EMAIL_INVALIDO", coluna: col };
      }
      out[col] = v; n++;
    }
    return n ? { ok: true, valores: out } : { ok: false, erro: "NADA_PARA_GRAVAR" };
  }

  /* "o cônjuge do Fiador 1 é o Fiador 2": de {coluna: valor} da linha, o que gravar (ou { erro }) */
  function conjugeComoFiador2(linha) {
    var v = function (c) { return valorDe(linha, c); };
    if (!casado(v("ESTADO CIVIL FIADOR 1"))) return { erro: "FIADOR_1_NAO_CASADO" };
    if (!v("FIADOR 1") || !R().cpfValido(v("CPF FIADOR 1"))) return { erro: "FIADOR_1_INCOMPLETO" };
    if (!v("CONJUGE FIADOR 1") || !R().cpfValido(v("CPF CONJUGE FIADOR 1"))) return { erro: "CONJUGE_FIADOR_1_INCOMPLETO" };
    return { valores: {
      "FIADOR 2": v("CONJUGE FIADOR 1"), "CPF FIADOR 2": R().formatarCpf(v("CPF CONJUGE FIADOR 1")), "EMAIL FIADOR 2": v("EMAIL CONJUGE FIADOR 1").toLowerCase(),
      "ESTADO CIVIL FIADOR 2": v("ESTADO CIVIL FIADOR 1"),
      "CONJUGE FIADOR 2": v("FIADOR 1"), "CPF CONJUGE FIADOR 2": R().formatarCpf(v("CPF FIADOR 1")), "EMAIL CONJUGE FIADOR 2": v("EMAIL FIADOR 1").toLowerCase(),
      /* o fiador 1 aponta para o fiador 2 (o mesmo CPF) — é o que o ContratoVenda confere (#74) */
      "CPF CONJUGE FIADOR 1": R().formatarCpf(v("CPF CONJUGE FIADOR 1"))
    } };
  }

  var api = { OPCOES_CIVIL: OPCOES_CIVIL, OPCOES_REGIME: OPCOES_REGIME, PERMITIDAS: PERMITIDAS, REGIMES: REGIMES,
              camposFiadores: camposFiadores, emailTalvezFaltando: emailTalvezFaltando, validarValores: validarValores, conjugeComoFiador2: conjugeComoFiador2,
              permitida: permitida, tipoDa: tipoDa };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
