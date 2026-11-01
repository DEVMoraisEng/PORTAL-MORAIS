/* ContratoVenda — regras puras do contrato de compra e venda (entrega 2).
 * Roda igual no Apps Script (arquivo ContratoVenda.gs do projeto PORTAL-VENDA)
 * e no node (testes em venda/testes). Sem rede, sem Notion, sem Drive.
 * Repositório público: nenhum dado real aqui nem nos testes. */
var ContratoVenda = (function () {
  "use strict";

  var COL = {
    ALVARA_NUMERO: "CONTRATO - ALVARÁ Nº",
    ALVARA_DATA: "CONTRATO - ALVARÁ DATA",
    HABITESE_NUMERO: "CONTRATO - HABITE-SE Nº",
    MATRICULA_INDIVIDUAL: "CONTRATO - MATRÍCULA INDIVIDUAL",
    CRI: "CONTRATO - CRI DA MATRÍCULA",
    AREA: "CONTRATO - ÁREA DO LOTE (M²)",
    CONFRONTACOES: "CONTRATO - CONFRONTAÇÕES",
    SINAL_VALOR: "CONTRATO - SINAL VALOR",
    SINAL_DATA: "CONTRATO - SINAL DATA",
    ENTRADA_VALOR: "CONTRATO - ENTRADA VALOR",
    ENTRADA_VENCIMENTO: "CONTRATO - ENTRADA VENCIMENTO",
    INTERMEDIARIA_VALOR: "CONTRATO - INTERMEDIÁRIA VALOR",
    INTERMEDIARIA_VENCIMENTO: "CONTRATO - INTERMEDIÁRIA VENCIMENTO",
    FORMA_PAGAMENTO: "CONTRATO - FORMA DE PAGAMENTO",
    COMISSAO_FORMA: "CONTRATO - COMISSÃO FORMA",
    COMISSAO_VENCIMENTO: "CONTRATO - COMISSÃO VENCIMENTO",
    COMISSAO_PAGA_POR: "CONTRATO - COMISSÃO PAGA POR",
    PRAZO_CONCLUSAO: "DATA DA ENTREGA",   // decisão do dono 08/10: a VENDAS já tem a data
    /* entrega 14: escritas pela leitura dos documentos do imóvel; opcionais (lidas com cv()) e, quando
       preenchidas, valem antes da DATA HABITE-SE da obra e da DENOMINAÇÃO do cadastro do setor */
    HABITESE_DATA: "CONTRATO - HABITE-SE DATA",
    DENOMINACAO_LOTEAMENTO: "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO",
    CONDICOES_ESPECIAIS: "CONTRATO - CONDIÇÕES ESPECIAIS",
    CONTRATO_GERADO: "CONTRATO GERADO"
  };

  var TIPOS = {};
  TIPOS[COL.ALVARA_NUMERO] = "rich_text";
  TIPOS[COL.ALVARA_DATA] = "date";
  TIPOS[COL.HABITESE_NUMERO] = "rich_text";
  TIPOS[COL.MATRICULA_INDIVIDUAL] = "rich_text";
  TIPOS[COL.CRI] = "rich_text";
  TIPOS[COL.AREA] = "number";
  TIPOS[COL.CONFRONTACOES] = "rich_text";
  TIPOS[COL.SINAL_VALOR] = "number";
  TIPOS[COL.SINAL_DATA] = "date";
  TIPOS[COL.ENTRADA_VALOR] = "number";
  TIPOS[COL.ENTRADA_VENCIMENTO] = "date";
  TIPOS[COL.INTERMEDIARIA_VALOR] = "number";
  TIPOS[COL.INTERMEDIARIA_VENCIMENTO] = "date";
  TIPOS[COL.FORMA_PAGAMENTO] = "select";
  TIPOS[COL.COMISSAO_FORMA] = "select";
  /* COMISSAO_VENCIMENTO saiu dos TIPOS (entrega 14): deixou de ser exigida e é lida com cv() — a coluna
     pode faltar na base */
  TIPOS[COL.COMISSAO_PAGA_POR] = "select";
  TIPOS[COL.PRAZO_CONCLUSAO] = "date";
  TIPOS[COL.CONDICOES_ESPECIAIS] = "rich_text";
  TIPOS[COL.CONTRATO_GERADO] = "files";

  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
    "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
    "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  var DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  var CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
    "setecentos", "oitocentos", "novecentos"];

  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function up(v) { return txt(v).toUpperCase(); }
  function vazio(v) { return txt(v) === ""; }

  function moedaBR(n) {
    var c = Math.round(Math.abs(Number(n) || 0) * 100);
    var reais = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = String(c % 100);
    if (cent.length < 2) cent = "0" + cent;
    return (Number(n) < 0 ? "-" : "") + reais + "," + cent;
  }

  function ate999(n) {
    if (n === 100) return "cem";
    var partes = [];
    var c = Math.floor(n / 100), r = n % 100;
    if (c) partes.push(CENTENAS[c]);
    if (r) {
      if (r < 20) partes.push(UNIDADES[r]);
      else {
        var d = Math.floor(r / 10), u = r % 10;
        partes.push(u ? DEZENAS[d] + " e " + UNIDADES[u] : DEZENAS[d]);
      }
    }
    return partes.join(" e ");
  }

  function inteiroPorExtenso(n) {
    var milhoes = Math.floor(n / 1000000), mil = Math.floor((n % 1000000) / 1000), un = n % 1000;
    var grupos = [];
    if (milhoes) grupos.push({ v: milhoes, t: milhoes === 1 ? "um milhão" : ate999(milhoes) + " milhões" });
    if (mil) grupos.push({ v: mil, t: mil === 1 ? "mil" : ate999(mil) + " mil" });
    if (un) grupos.push({ v: un, t: ate999(un) });
    var s = "";
    for (var i = 0; i < grupos.length; i++) {
      if (i === 0) s = grupos[i].t;
      else {
        var ultimo = i === grupos.length - 1;
        var v = grupos[i].v;
        s += (ultimo && (v < 100 || v % 100 === 0) ? " e " : " ") + grupos[i].t;
      }
    }
    return s;
  }

  function valorPorExtenso(n) {
    var c = Math.round(Math.abs(Number(n) || 0) * 100);
    var reais = Math.floor(c / 100), cent = c % 100;
    if (reais >= 1000000000) throw new Error("VALOR_FORA_DO_LIMITE");
    var partes = [];
    if (reais > 0) {
      var t = inteiroPorExtenso(reais);
      if (reais % 1000000 === 0) t += " de";
      t += reais === 1 ? " real" : " reais";
      partes.push(t);
    }
    if (cent > 0) partes.push(ate999(cent) + (cent === 1 ? " centavo" : " centavos"));
    if (!partes.length) return "zero reais";
    return partes.join(" e ");
  }

  function dataParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
    return m ? { a: m[1], m: Number(m[2]), d: Number(m[3]) } : null;
  }
  function dataBR(iso) {
    var p = dataParts(iso);
    if (!p) return "";
    return (p.d < 10 ? "0" : "") + p.d + "/" + (p.m < 10 ? "0" : "") + p.m + "/" + p.a;
  }
  function dataPorExtenso(iso) {
    var p = dataParts(iso);
    if (!p || p.m < 1 || p.m > 12) return "";
    return (p.d === 1 ? "1º" : String(p.d)) + " de " + MESES[p.m - 1] + " de " + p.a;
  }

  function loteQuadra(endereco) {
    var s = txt(endereco);
    var q = /\bQD\.?\s*([0-9A-Z-]+)/i.exec(s);
    var l = /\bLT\.?\s*([0-9A-Z-]+)/i.exec(s);
    if (!q || !l) return null;
    var quadra = q[1].replace(/^-+|-+$/g, ""), lote = l[1].replace(/^-+|-+$/g, "");
    if (!quadra || !lote) return null;
    return { lote: lote, quadra: quadra };
  }

  /* Venda do condomínio (casa com "CONDOMÍNIO - VENDA ID") tem modelo próprio, esteja a obra pronta ou não.
     Entrega 14 (dono, 08/10): o TIPO DE CASA da casa de rua decide — "CASA PRONTA" -> PRONTO, "CASA EM CONSTRUÇÃO" ->
     CONSTRUCAO; vazio ou o antigo "CASA DE RUA" -> pelo "OBRA FINALIZADA?" da obra (DOCUMENTOS), como antes. */
  function semAcento(v) { return up(v).normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function tipoDoModelo(tipoCasa) {
    var t = semAcento(tipoCasa);
    if (t === "CASA PRONTA") return "PRONTO";
    if (t === "CASA EM CONSTRUCAO") return "CONSTRUCAO";
    return "";
  }
  function escolherModelo(obraFinalizada, condominio, tipoCasa) {
    if (condominio) return "CONDOMINIO";
    var pelaCasa = tipoDoModelo(tipoCasa);
    if (pelaCasa) return pelaCasa;
    return up(obraFinalizada) === "SIM" ? "PRONTO" : "CONSTRUCAO";
  }

  /* 31/10/2026: "0", "-", "S/N", "NÃO TEM"… no lugar do número (identidade nova sem RG) = sem documento */
  function semNumero(n) {
    var t = txt(n).toUpperCase().replace(/[.\s]/g, "");
    return t === "" || /^[0\-_]+$/.test(t) || /^(S\/?N|SEM(RG)?|N[AÃ]O(TEM|POSSUI)?|NT|NA|N\/?A)$/.test(t);
  }
  function documentoComRotulo(doc) {
    var d = txt(doc);
    if (!d) return "";
    var m = /^(RG|CNH)(?![A-Za-z]):?\s*(?:n[ºo°]\.?\s*)?(.*)$/i.exec(d);
    if (m) return semNumero(m[2]) ? "" : m[1].toUpperCase() + " nº " + m[2];
    return semNumero(d) ? "" : d;
  }

  function qualificacao(c) {
    c = c || {};
    var partes = [txt(c.nome), txt(c.nacionalidade), txt(c.estadoCivil), txt(c.profissao),
      documentoComRotulo(c.documento), txt(c.cpf) ? "CPF nº " + txt(c.cpf) : "",
      txt(c.endereco) ? "residente e domiciliado à " + txt(c.endereco) : ""];
    return partes.filter(function (p) { return p !== ""; }).join(", ");
  }

  function nomeComprador1(clientes, nome2) {
    var c = txt(clientes), n2 = txt(nome2);
    if (!n2) return c;
    /* o nome do 2º só vale como fronteira de palavra (depois de espaço ou separador), nunca no meio de outro nome */
    var pos = -1, cu = c.toUpperCase(), nu = n2.toUpperCase(), from = 0, i;
    while ((i = cu.indexOf(nu, from)) >= 0) {
      if (i > 0 && /[\s&,\/]/.test(cu.charAt(i - 1))) { pos = i; break; }
      from = i + 1;
    }
    if (pos < 0) {
      var m = /\s+E\s+|\s*[&,\/]\s*/i.exec(c); /* o PRIMEIRO " E ", como no dossiê */
      pos = m ? m.index : -1;
    }
    if (pos < 0) return c;
    return c.slice(0, pos).replace(/(?:\s+[Ee]\s*|[\s,\/&]+)+$/, "").trim();
  }

  function formaPorExtenso(v) {
    var u = up(v);
    if (u === "PIX") return "PIX";
    if (u === "TRANSFERÊNCIA" || u === "TRANSFERENCIA") return "transferência";
    if (u === "DEPÓSITO" || u === "DEPOSITO") return "depósito";
    return txt(v);
  }

  /* ---- condomínio ---- */
  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function so2(n) { return Math.round(n * 100) / 100; }
  function positivo(n) { return typeof n === "number" && isFinite(n) && n > 0; }
  function inteiro(n) { var x = num(n); return x === null ? null : Math.round(x); }
  function valorExtenso(n) { return "R$ " + moedaBR(n) + " (" + valorPorExtenso(n) + ")"; }

  /* Fluxo de pagamento da linha da BANCO DE DADOS VENDAS CONDOMÍNIO, já normalizado. */
  function fluxoCondominio(x) {
    x = x || {};
    return {
      assinatura: txt(x.assinatura), diaPagamento: inteiro(x.diaPagamento), entrega: txt(x.entrega),
      valorVenda: num(x.valorVenda),
      sinalAto: num(x.sinalAto),
      sinal30: num(x.sinal30), data30: txt(x.data30),
      sinal60: num(x.sinal60), data60: txt(x.data60),
      sinal90: num(x.sinal90), data90: txt(x.data90),
      pre1N: inteiro(x.pre1N), pre1Valor: num(x.pre1Valor), pre1Data: txt(x.pre1Data),
      pre2N: inteiro(x.pre2N), pre2Valor: num(x.pre2Valor), pre2Data: txt(x.pre2Data),
      balao1Valor: num(x.balao1Valor), balao1Data: txt(x.balao1Data),
      balao2Valor: num(x.balao2Valor), balao2Data: txt(x.balao2Data),
      posN: inteiro(x.posN), posValor: num(x.posValor), posData: txt(x.posData),
      prazoEntrada: inteiro(x.prazoEntrada),
      credito: num(x.credito), fgts: num(x.fgts), subsidio: num(x.subsidio)
    };
  }

  /* Quanto o fluxo soma (séries = nº de parcelas × valor). */
  function somaFluxo(fl) {
    function serie(n, v) { return positivo(n) && positivo(v) ? n * v : 0; }
    function val(v) { return positivo(v) ? v : 0; }
    return so2(val(fl.sinalAto) + val(fl.sinal30) + val(fl.sinal60) + val(fl.sinal90) +
      serie(fl.pre1N, fl.pre1Valor) + serie(fl.pre2N, fl.pre2Valor) +
      val(fl.balao1Valor) + val(fl.balao2Valor) +
      val(fl.credito) + val(fl.fgts) + val(fl.subsidio) + serie(fl.posN, fl.posValor));
  }

  /* "N parcelas mensais e sucessivas de R$ X (…), vencendo-se a primeira em dd/mm/aaaa e as demais no dia D dos meses subsequentes" */
  function serieMensal(n, valor, dataIso, dia, depoisDaData) {
    if (n === 1) return "1 parcela de " + valorExtenso(valor) + ", com vencimento em " + dataBR(dataIso) + (depoisDaData || "");
    return n + " parcelas mensais e sucessivas de " + valorExtenso(valor) + ", vencendo-se a primeira em " +
      dataBR(dataIso) + (depoisDaData || "") + " e as demais no dia " + (dia === null ? "" : dia) + " dos meses subsequentes";
  }

  /* Texto do item 6.1 do contrato do condomínio (uma linha por parágrafo, separadas por "\n").
   * Incisos I a V com numeração FIXA (o 6.1-A e o 7.1 citam os incisos pelo número): linha de
   * valor 0/vazio sai, as alíneas que sobram são reletradas; inciso sem nenhuma linha vira "não há". */
  /* ---- 29/10/2026 (etapa 2 do "Alterar fluxo"): o fluxo em GRUPOS — das gavetas do simulador ou da lista livre
   * (FLUXO PERSONALIZADO, venda/FluxoLivre.js). O texto do contrato sai dos grupos; das gavetas sai IDÊNTICO ao de antes.
   * { valor, assinatura, sinais: [{v,d,ato}], avista: [{v,d,proposta}], pre: [{n,v,u,d,i,dia}], baloes: [{v,d,chaves}],
   *   pos: [{n,v,u,d,i,dia}], permutas: [{v,d,x}], credito, fgts, subsidio, posN, livre } ---- */
  function FLV() { return typeof FluxoLivre !== "undefined" ? FluxoLivre : require("./FluxoLivre.js"); }
  function diaDe(iso) { var m = /^\d{4}-\d{2}-(\d{2})/.exec(txt(iso)); return m ? Number(m[1]) : null; }
  function porData(a, b) { return txt(a.d).localeCompare(txt(b.d)); }
  /* 31/10/2026 (dono): pré-reserva paga = valor da venda + data do pagamento (ou termo assinado, das vendas de antes;
     aí a data é a da assinatura). Ela é a 1ª parcela do sinal, já recebida. c = dados do condomínio (GerarContrato). */
  function preReservaPaga(c) {
    var p = c && c.preReserva;
    if (!p || !positivo(num(p.valor))) return null;
    var d = txt(p.dataPagamento).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = "";
    if (!d && !p.assinado) return null;
    return { valor: num(p.valor), data: d };
  }
  function gruposFluxo(co, excedente) {
    var fl = co.fluxo || {}, livre = co.livre || null;
    function val(v) { return positivo(v) ? v : 0; }
    var G = { valor: fl.valorVenda, assinatura: fl.assinatura, sinais: [], avista: [], pre: [], baloes: [], pos: [], permutas: [],
              credito: val(fl.credito), fgts: val(fl.fgts), subsidio: val(fl.subsidio), posN: 0, livre: !!livre };
    if (!livre) {
      var sv = [fl.sinalAto, fl.sinal30, fl.sinal60, fl.sinal90];
      if (co.preReserva) {
        var ab = FLV().abaterSinal(sv, co.preReserva.valor);
        sv = ab.valores;
        if (ab.abatido > 0) G.sinais.push({ v: ab.abatido, d: co.preReserva.data || fl.assinatura, pr: true });
      }
      [[sv[0], fl.assinatura, true], [sv[1], fl.data30], [sv[2], fl.data60], [sv[3], fl.data90]].forEach(function (p) {
        if (positivo(p[0])) G.sinais.push({ v: p[0], d: p[1], ato: !!p[2] });
      });
      var exc = excedente === undefined ? excedenteSinal(co) : excedente;
      if (positivo(exc)) G.avista.push({ v: exc, d: fl.assinatura, proposta: true });
      [[fl.pre1N, fl.pre1Valor, fl.pre1Data, 1], [fl.pre2N, fl.pre2Valor, fl.pre2Data, 2]].forEach(function (s) {
        if (positivo(s[0]) && positivo(s[1])) G.pre.push({ n: s[0], v: s[1], u: null, d: s[2], i: 1, dia: fl.diaPagamento, etapa: s[3] });
      });
      if (positivo(fl.balao1Valor)) G.baloes.push({ v: fl.balao1Valor, d: fl.balao1Data });
      if (positivo(fl.balao2Valor)) G.baloes.push({ v: fl.balao2Valor, d: fl.balao2Data, chaves: true });
      if (positivo(fl.posN) && positivo(fl.posValor)) G.pos.push({ n: fl.posN, v: fl.posValor, u: null, d: fl.posData, i: 1, dia: fl.diaPagamento });
      G.posN = positivo(fl.posN) && positivo(fl.posValor) ? fl.posN : 0;
      return G;
    }
    var F = FLV();
    G.valor = livre.valor; G.credito = 0; G.fgts = 0; G.subsidio = 0;
    (livre.linhas || []).forEach(function (l) {
      var n = l.n | 0, i = l.i || 1;
      if (n <= 0 || !positivo(l.v)) return;
      function cada(f) { for (var j = 0; j < n; j++) f(j === n - 1 && n > 1 && positivo(l.u) ? l.u : l.v, l.d ? F.maisMeses(l.d, j * i) : ""); }
      if (l.t === "sinal") cada(function (v, d) { G.sinais.push({ v: v, d: d }); });
      else if (l.t === "prereserva") cada(function (v, d) { G.sinais.push({ v: v, d: d, pr: true }); });
      else if (l.t === "entrada") cada(function (v, d) { G.avista.push({ v: v, d: d }); });
      else if (l.t === "balao") cada(function (v, d) { G.baloes.push({ v: v, d: d, chaves: !!d && d === fl.balao2Data }); });
      else if (l.t === "permuta") cada(function (v, d) { G.permutas.push({ v: v, d: d, x: l.x || "" }); });
      else if (l.t === "pre" || l.t === "pos") {
        G[l.t].push({ n: n, v: l.v, u: n > 1 && positivo(l.u) ? l.u : null, d: l.d, i: i, dia: diaDe(l.d) });
        if (l.t === "pos") G.posN += n;
      }
      else if (l.t === "fin") G.credito = so2(G.credito + F.totalLinha(l));
      else if (l.t === "fgts") G.fgts = so2(G.fgts + F.totalLinha(l));
      else if (l.t === "subsidio") G.subsidio = so2(G.subsidio + F.totalLinha(l));
    });
    ["sinais", "avista", "pre", "baloes", "pos", "permutas"].forEach(function (k) { G[k].sort(porData); });
    var sAto = G.sinais.filter(function (s) { return !s.pr; })[0];
    if (sAto && sAto.d === fl.assinatura) sAto.ato = true;
    return G;
  }
  /* série do 6.1 ("N parcelas mensais e sucessivas de …, vencendo-se a primeira em … e as demais no dia D …");
     a lista livre pode ter última parcela diferente e intervalo de mais de um mês */
  function serie61(s, depois) {
    if (s.i === 1 && !s.u) return serieMensal(s.n, s.v, s.d, s.dia, depois);
    var per = s.i === 1 ? "mensais e sucessivas" : "a cada " + s.i + " meses";
    return (s.u ? (s.n - 1) + " parcelas " + per + " de " + valorExtenso(s.v) + " e a última de " + valorExtenso(s.u)
                : s.n + " parcelas " + per + " de " + valorExtenso(s.v)) +
      ", vencendo-se a primeira em " + dataBR(s.d) + (depois || "") + (s.i === 1 ? " e as demais no dia " + (s.dia === null ? "" : s.dia) + " dos meses subsequentes" : "");
  }
  /* série do quadro-resumo (4.2.1): "N parcelas mensais e sucessivas de … cada, vencendo todo dia D, a primeira em …" */
  function serieQuadro(s) {
    if (s.i === 1 && !s.u) return mensais(s.n, s.v, s.d, s.dia);
    var per = s.i === 1 ? "mensais e sucessivas" : "a cada " + s.i + " meses";
    return (s.u ? (s.n - 1) + " parcelas " + per + " de " + valorExtenso(s.v) + " cada e a última de " + valorExtenso(s.u)
                : s.n + " parcelas " + per + " de " + valorExtenso(s.v) + " cada") +
      (s.i === 1 ? ", vencendo todo dia " + (s.dia === null ? "" : s.dia) : "") + ", a primeira em " + dataBR(s.d);
  }
  function somaGrupos(G) {
    var t = 0;
    function s(x) { return x.n ? (x.u ? x.v * (x.n - 1) + x.u : x.v * x.n) : x.v; }
    ["sinais", "avista", "pre", "baloes", "pos", "permutas"].forEach(function (k) { G[k].forEach(function (x) { t += s(x); }); });
    return so2(t + G.credito + G.fgts + G.subsidio);
  }

  /* 6.1: das gavetas (fluxo) ou da lista livre (29/10: livre = FluxoLivre.ler(FLUXO PERSONALIZADO)) */
  function formaPagamentoCondominio(fluxo, livre, preReserva) {
    var G = gruposFluxo({ fluxo: fluxoCondominio(fluxo), livre: livre || null, preReserva: preReserva || null }, 0);
    var linhas = [];
    linhas.push("6.1. Preço total: " + (G.valor === null ? "R$ " : valorExtenso(G.valor)) + ", a ser pago da seguinte forma:");
    var LETRAS = "abcdefghij";
    function inciso(titulo, itens, comLetra, depois) {
      if (!itens.length) { linhas.push(titulo + ": não há."); return; }
      linhas.push(titulo + ":");
      itens.forEach(function (t, i) {
        var fim = i === itens.length - 1 ? "." : ";";
        linhas.push((comLetra ? LETRAS.charAt(i) + ") " : "") + t + fim);
      });
      if (depois) linhas.push(depois);
    }
    var sinal = G.sinais.map(function (s) {
      if (s.pr) return valorExtenso(s.v) + ", já pago em " + dataBR(s.d) + " a título de pré-reserva (Termo de Pré-Reserva)";
      return valorExtenso(s.v) + (s.ato ? ", no ato da assinatura deste instrumento, em " + dataBR(G.assinatura) : ", com vencimento em " + dataBR(s.d));
    });
    inciso("I — SINAL (arras confirmatórias, art. 417 do Código Civil), sem correção monetária", sinal, true);

    var pre = G.pre.map(function (s, i) { return (s.etapa || i + 1) + "ª etapa: " + serie61(s); });
    inciso("II — PARCELAS MENSAIS DURANTE A OBRA (pré-chaves), corrigidas na forma do item 7.1, \"a\"", pre, true);

    var baloes = G.baloes.map(function (b) {
      return valorExtenso(b.v) + ", com vencimento em " + dataBR(b.d) + (b.chaves ? ", ou na data da entrega das chaves, o que ocorrer primeiro" : "");
    });
    inciso("III — PARCELAS INTERMEDIÁRIAS (balões), corrigidas na forma do item 7.1, \"a\"", baloes, true);

    var terceiros = [];
    if (positivo(G.credito)) terceiros.push("Financiamento bancário: " + valorExtenso(G.credito) +
      ", a ser pago diretamente pela instituição financeira na assinatura do contrato de financiamento, observada a Cláusula Oitava");
    if (positivo(G.fgts)) terceiros.push("Recursos do FGTS: " + valorExtenso(G.fgts) + ", na data do respectivo resgate (item 13.3)");
    if (positivo(G.subsidio)) terceiros.push("Subsídio: " + valorExtenso(G.subsidio));
    inciso("IV — RECURSOS DE TERCEIROS, sem correção pela VENDEDORA", terceiros, true,
      "Na hipótese de o financiamento, o FGTS ou o subsídio serem liberados em valor inferior ao previsto, a diferença será paga pelo COMPRADOR à vista, na data da assinatura do contrato de financiamento (item 13.4).");

    var pos = G.pos.map(function (s, i) { return serie61(s, i === 0 ? " (mês seguinte à entrega das chaves)" : ""); });
    inciso("V — PARCELAS APÓS A ENTREGA DAS CHAVES (pós-chaves), corrigidas e acrescidas de juros na forma do item 7.1, \"b\"", pos, pos.length > 1);
    /* 29/10: permuta (só existe no fluxo alterado) — redação a validar com o advogado */
    if (G.permutas.length)
      inciso("VI — BEM DADO EM PAGAMENTO (permuta), sem correção monetária", G.permutas.map(function (p) {
        return (txt(p.x) || "bem descrito em instrumento próprio") + ", recebido pelo valor de " + valorExtenso(p.v) + ", com entrega em " + dataBR(p.d);
      }), true);
    return linhas.join("\n");
  }

  /* ---- contrato do condomínio do advogado (21/10/2026): quadro-resumo ----
   * O fluxo da venda continua o do simulador (sinais, duas partes, balões, pós-chaves); o item 4.2.1
   * o resume por grupos (decisão do dono 21/10: "24 parcelas mensais, todo dia XX, a primeira em …").
   * A comissão é do COMPRADOR e está dentro do VALOR DE VENDA (dono 22/10): operação = venda; imóvel = venda − comissão. */
  function U() { return typeof UnidadesCondominio !== "undefined" ? UnidadesCondominio : require("./UnidadesCondominio.js"); }
  /* item 5 b) — regra do dono (28/10): a comissão sai do PRAZO DA ENTRADA escolhido na proposta, como no simulador:
     24x = 5%, 36x = 4,75%, 48x = 4,5%. O simulador grava o prazo com um mês a menos por mês passado de nov/2026
     (24/36/48 → 23/35/47…), por isso vale a faixa. Sem PRAZO ENTRADA (venda antiga), o prazo sai das parcelas
     pós-chaves pela tabela do simulador (0 → 24x, 12 → 36x, 24 → 48x). */
  var PRAZO_POR_POS = { 0: 24, 12: 36, 24: 48 };
  function prazoOpcao(prazo, posN) {
    var p = positivo(prazo) ? prazo : null;
    if (p === null) { var n = positivo(posN) ? posN : 0; return Object.prototype.hasOwnProperty.call(PRAZO_POR_POS, n) ? PRAZO_POR_POS[n] : null; }
    return p <= 24 ? 24 : p <= 36 ? 36 : p <= 48 ? 48 : null;
  }
  var COMISSAO_POR_PRAZO = { 24: 0.05, 36: 0.0475, 48: 0.045 };
  function comissaoPctPelaRegra(prazo, posN) {
    var op = prazoOpcao(prazo, posN);
    return op === null ? null : COMISSAO_POR_PRAZO[op];
  }
  /* 31/10/2026 (dono): a comissão sai do FLUXO, sozinha — sem parcela pós-chaves = 24x (5%); com pós-chaves, o total
     de parcelas da entrada (pré + pós) até 36 = 36x (4,75%), acima = 48x (4,5%). Vale também depois do Alterar fluxo;
     o PRAZO ENTRADA e a COMISSÃO gravados na venda não mandam mais. */
  function planoDoFluxo(G) {
    if (!(G.posN > 0)) return 24;
    var total = G.posN + G.pre.reduce(function (s, x) { return s + (x.n || 0); }, 0);
    return total <= 36 ? 36 : 48;
  }
  /* 0,045 -> "4,5"; 0,05 -> "5" */
  function pctBR(frac) { return String(Number((frac * 100).toFixed(4))).replace(".", ","); }
  function pct2(parte, todo) { return positivo(todo) ? (parte / todo * 100).toFixed(2).replace(".", ",") : ""; }

  function valoresCondominio(co) {
    var fl = co.fluxo, G = gruposFluxo(co), preco = positivo(G.valor) ? G.valor : null;
    var financiamento = so2(G.credito + G.fgts + G.subsidio);
    var plano = planoDoFluxo(G), pctRegra = COMISSAO_POR_PRAZO[plano];
    /* 29/10: valor da casa mudado no Alterar fluxo (só JC/JV) — a comissão sai da regra sobre o valor novo */
    var precoMudou = !!co.livre && preco !== null && Math.round(preco * 100) !== Math.round((fl.valorVenda || 0) * 100);
    var comissao = preco !== null ? so2(preco * pctRegra) : null;
    /* 30/10: desconto "isentar a comissão" (venda direta, sem corretor) — comissão zero; imóvel = o preço inteiro */
    var semComissao = !!(co.livre && co.livre.semComissao);
    if (semComissao) comissao = 0;
    /* dono 22/10: a comissão está DENTRO do VALOR DE VENDA (305 mil a 5% = 15.250 do corretor); o cliente paga à
       Morais e a Morais repassa ao corretor depois que o sinal inteiro é pago. Operação = VALOR DE VENDA;
       imóvel = venda − comissão. Sinal = ato + 30/60/90; entrada (4.2.1 a) = tudo que não é CAIXA/FGTS/subsídio,
       sinal incluído (como o texto do advogado: o saldo da entrada é a entrada menos o sinal). */
    var sinal = so2(G.sinais.reduce(function (s, x) { return s + x.v; }, 0));
    var entrada = preco === null ? null : so2(preco - financiamento);
    return {
      preco: preco, financiamento: financiamento, temFgtsSubsidio: G.fgts + G.subsidio > 0,
      plano: plano, pctRegra: pctRegra, comissao: comissao, operacao: preco, precoMudou: precoMudou, semComissao: semComissao,
      imovel: preco !== null && comissao !== null ? so2(preco - comissao) : null,
      sinal: sinal, entrada: entrada, saldoEntrada: entrada === null ? null : so2(entrada - sinal)
    };
  }

  /* 4.2.1 g) (dono 27/10): sinal por PIX ou abatido (o VALOR PARA ENTRADA da proposta cobre o sinal na ordem
     ato → 30 → 60 → 90, como no simulador); parcelas da entrada por boleto bancário. */
  /* 28/10 (teste no portal oficial): o VALOR PARA ENTRADA ("valor para o sinal") da proposta paga o sinal e o que
     PASSA dele abate a entrada (simulador: "só o excedente abate"). Esse excedente não está em coluna nenhuma do
     fluxo — sem ele a soma não fechava (11 mil para o sinal, sinal de 10 mil: faltava R$ 1.000). */
  function excedenteSinal(co) {
    if (co.livre) return 0;   /* 29/10: no fluxo alterado o excedente já é uma linha (Entrada à vista) */
    var fl = co.fluxo || {}, s = 0;
    [fl.sinalAto, fl.sinal30, fl.sinal60, fl.sinal90].forEach(function (v) { if (positivo(v)) s += v; });
    var vpe = positivo(co.valorParaEntrada) ? co.valorParaEntrada : 0;
    return so2(Math.max(0, vpe - s));
  }
  function meioPagamentoCondominio(co) {
    /* 31/10: a pré-reserva já foi paga — o meio de pagamento é só do restante do sinal */
    var s = so2(gruposFluxo(co).sinais.reduce(function (t, x) { return t + (x.pr ? 0 : x.v); }, 0));
    var ab = so2(Math.min(s, positivo(co.valorParaEntrada) ? co.valorParaEntrada : 0)), pix = so2(s - ab);
    /* dono 27/10: mesmo quitado com o valor para entrada, continua sendo sinal (retido em caso de desistência) */
    var nat = ", mantida sua natureza de sinal e princípio de pagamento";
    var sinal = !(s > 0) ? "" : pix <= 0.005 ? "sinal (item 4.1.3) quitado com o valor para entrada informado na proposta" + nat
      : ab <= 0.005 ? "sinal (item 4.1.3) por PIX"
      : "sinal (item 4.1.3): " + valorExtenso(ab) + " quitados com o valor para entrada informado na proposta" + nat + ", e " + valorExtenso(pix) + " por PIX";
    return (sinal ? sinal + "; " : "") + "parcelas da entrada por boleto bancário";
  }
  function mensais(n, valor, dataIso, dia) {
    if (n === 1) return "1 parcela de " + valorExtenso(valor) + ", com vencimento em " + dataBR(dataIso);
    return n + " parcelas mensais e sucessivas de " + valorExtenso(valor) + " cada, vencendo todo dia " +
      (dia === null ? "" : dia) + ", a primeira em " + dataBR(dataIso);
  }
  function emLista(itens) {
    return itens.length < 2 ? itens.join("") : itens.slice(0, -1).join("; ") + "; e " + itens[itens.length - 1];
  }
  /* 4.1.3: vencimentos do sinal (ato + 30/60/90). Só o ato: a data; mais de um: "dd/mm/aaaa (R$ x), … e …" */
  function vencimentosSinal(G) {
    var ps = G.sinais.map(function (s) { return [s.v, s.ato ? G.assinatura : s.d, s.pr]; });
    if (ps.length < 2) return ps.length ? dataBR(ps[0][1]) : dataBR(G.assinatura);
    var t = ps.map(function (p) { return dataBR(p[1]) + " (R$ " + moedaBR(p[0]) + (p[2] ? ", já paga a título de pré-reserva — Termo de Pré-Reserva" : "") + ")"; });
    return t.slice(0, -1).join(", ") + " e " + t[t.length - 1];
  }
  /* 4.2.1 c): a entrada começa depois do sinal — 1ª e 2ª parte e balões (os sinais ficam no 4.1.3) */
  function parcelasPreChaves(fl, excedente) { return textoPreChaves(gruposFluxo({ fluxo: fl }, excedente || 0)); }
  /* semAvista: o termo de confissão de dívida não leva o que é pago na assinatura nem a permuta */
  function textoPreChaves(G, semAvista) {
    var itens = [], total = 0;
    /* o excedente do valor para entrada é pago na assinatura e abate o saldo da entrada (não é corrigido) */
    var exc = semAvista ? [] : G.avista.map(function (a) {
      return "pagamento único de " + valorExtenso(a.v) + (a.proposta ? ", na assinatura deste contrato (parte do valor para entrada informado na proposta que excede o sinal)"
        : a.d && a.d === G.assinatura ? ", na assinatura deste contrato" : ", com vencimento em " + dataBR(a.d)) ;
    });
    var perm = semAvista ? [] : G.permutas.map(function (p) {
      return "bem dado em pagamento (permuta): " + (txt(p.x) || "bem descrito em instrumento próprio") + ", pelo valor de " + valorExtenso(p.v) + ", com entrega em " + dataBR(p.d);
    });
    G.pre.forEach(function (s) { itens.push(serieQuadro(s)); total += s.n; });
    G.baloes.forEach(function (b) {
      itens.push("1 parcela intermediária de " + valorExtenso(b.v) + ", com vencimento em " + dataBR(b.d) + (b.chaves ? " ou na data da entrega das chaves, o que ocorrer primeiro" : ""));
      total++;
    });
    var antes = exc.concat(perm), ini = antes.length ? antes.join("; ") : "";
    if (!itens.length) return ini ? ini + "." : "não há.";
    return (ini ? ini + "; " : "") + emLista(itens) + "; " + (total > 1 ? "todas corrigidas" : "corrigida") + " pelo INCC-M, nos termos do item 6.1.";
  }
  /* 4.2.1 e) */
  function parcelasPosChaves(fl) { return textoPosChaves(gruposFluxo({ fluxo: fl }, 0)); }
  function textoPosChaves(G) {
    if (!G.pos.length) return "não há.";
    return emLista(G.pos.map(serieQuadro)) + ", " + (G.posN === 1 ? "corrigida" : "corrigidas") +
      " pelo IPCA/IBGE, acrescido de juros remuneratórios de 1% (um por cento) ao mês, nos termos do item 6.1.";
  }

  function contato(c) {
    return [txt(c.email) ? "e-mail " + txt(c.email) : "", txt(c.telefone) ? "telefone " + txt(c.telefone) : ""];
  }
  function semVazios(partes) { return partes.filter(function (p) { return p !== ""; }).join(", "); }
  /* item 1 do quadro: "[Nome], [nacionalidade], [estado civil], [profissão], RG nº, CPF nº, residente …, e-mail, telefone" */
  function qualificacaoQuadro(c, conj) {
    c = c || {};
    return semVazios([txt(c.nome), txt(c.nacionalidade), conj ? fraseConjuge(conj) : txt(c.estadoCivil), txt(c.profissao), documentoComRotulo(c.documento),
      txt(c.cpf) ? "CPF nº " + txt(c.cpf) : "", txt(c.endereco) ? "residente e domiciliado(a) à " + txt(c.endereco) : ""].concat(contato(c)));
  }
  function docRotulo(doc) {
    var d = txt(doc);
    if (!d) return "";
    return (d.replace(/\D/g, "").length === 14 ? "CNPJ nº " : "CPF nº ") + d;
  }
  /* "[Nome], CRECI nº, CPF/CNPJ nº, residente …, e-mail, telefone" */
  function qualificacaoCorretor(k) {
    k = k || {};
    return semVazios([txt(k.nome), txt(k.creci) ? "CRECI nº " + txt(k.creci) : "", docRotulo(k.cpfCnpj),
      txt(k.endereco) ? "residente e domiciliado(a) à " + txt(k.endereco) : ""].concat(contato(k)));
  }
  var FRASE_CASA_MODELO = " Unidade correspondente à “Casa Modelo” (Casa 01), sujeita às condições específicas previstas neste instrumento.";
  var MEIO_PAGAMENTO_PADRAO = "boleto bancário ou PIX";

  /* Quantos caracteres do começo da linha do 6.1 / dos fiadores vão em negrito (0 = nenhum). */
  function negritoDaLinha(linha) {
    var t = txt(linha), m;
    if (/^(?:I|II|III|IV|V) — /.test(t)) return t.length;
    if (/^VI — /.test(t)) return t.length;
    if ((m = /^6\.1\. Preço total: [^)]*\),?/.exec(t))) return m[0].length;
    if ((m = /^FIADOR \d:/.exec(t))) return m[0].length;
    return 0;
  }

  function fiadorNormal(x) {
    x = x || {};
    return {
      nome: txt(x.nome), cpf: R().cpfValido(x.cpf) ? R().formatarCpf(x.cpf) : txt(x.cpf), rg: txt(x.rg),
      nacionalidade: txt(x.nacionalidade), endereco: txt(x.endereco), numero: txt(x.numero),
      setor: txt(x.setor), cidade: txt(x.cidade), cep: txt(x.cep), email: txt(x.email),
      /* 30/10/2026 (dono, Súmula 332 do STJ): estado civil e cônjuge do fiador */
      estadoCivil: txt(x.estadoCivil).toUpperCase(),
      conjugeLido: { nome: txt(x.conjugeNome), cpf: R().cpfValido(x.conjugeCpf) ? R().formatarCpf(x.conjugeCpf) : txt(x.conjugeCpf),
                     email: txt(x.conjugeEmail).toLowerCase() }
    };
  }
  /* Só os fiadores com nome, na ordem (o 1º preenchido é o FIADOR 1). */
  function fiadoresPreenchidos(lista) {
    return ligarConjugesFiadores((lista || []).map(fiadorNormal).filter(function (fi) { return fi.nome !== ""; }));
  }
  /* 30/10/2026 (dono, Súmula 332 do STJ: fiança de casado sem o cônjuge é ineficaz) — casado ou em união estável,
     o cônjuge do fiador também assina. 31/10/2026: só como o OUTRO FIADOR — o CPF do cônjuge é o do outro fiador
     (conjugeEhOutroFiador). Fiador casado com o cônjuge de fora não passa (faltasConjugeFiadores); fi.conjuge é sempre null. */
  function fiadorCasado(estadoCivil) {
    return /CASAD|UNI[AÃ]O/.test(txt(estadoCivil).toUpperCase());
  }
  function semAcento(v) { return txt(v).normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function soDigitos(v) { return txt(v).replace(/\D/g, ""); }
  /* cônjuge do comprador 1 (colunas ESTADO CIVIL, CONJUGE, CPF CONJUGE, EMAIL CONJUGE e REGIME da proposta):
     {nome, cpf, email, regime} ou null. regime em minúsculas ("comunhão parcial de bens"); uniao:true só na união estável. */
  function conjugeDoComprador(x) {
    x = x || {};
    if (!fiadorCasado(x.estadoCivil) || !txt(x.nome)) return null;
    var out = { nome: txt(x.nome), cpf: R().cpfValido(x.cpf) ? R().formatarCpf(x.cpf) : txt(x.cpf), email: txt(x.email).toLowerCase(),
                regime: txt(x.regime).toLowerCase() };
    if (!/CASAD/.test(txt(x.estadoCivil).toUpperCase())) out.uniao = true;
    return out;
  }
  /* 01/11/2026 (dono): o cônjuge do comprador 1 entra qualificado DENTRO do COMPRADORES_QUADRO (sem marcador novo no
     .docx) no lugar do estado civil. Já sendo o comprador 2 (mesmo CPF ou nome), não se repete. */
  function conjugeEhComprador2(cj, c2) {
    return !!(cj && c2 && ((soDigitos(cj.cpf) !== "" && soDigitos(cj.cpf) === soDigitos(c2.cpf)) ||
                           txt(cj.nome).toUpperCase() === txt(c2.nome).toUpperCase()));
  }
  function conjugeExtra(d) {
    var cj = d && d.condominio && d.condominio.conjugeComprador;
    return cj && !conjugeEhComprador2(cj, d.comprador2) ? cj : null;
  }
  function fraseConjuge(cj) {
    var doc = txt(cj.cpf) ? ", CPF nº " + txt(cj.cpf) : "";
    if (cj.uniao) return "convivente em união estável com " + txt(cj.nome) + doc;
    return "casado(a) " + (txt(cj.regime) ? "sob o regime de " + txt(cj.regime) + " " : "") + "com " + txt(cj.nome) + doc;
  }
  function ligarConjugesFiadores(fis) {
    fis.forEach(function (fi, i) {
      var lido = fi.conjugeLido, outro = fis[1 - i];
      delete fi.conjugeLido;
      fi.conjugeEhOutroFiador = !!(outro && fiadorCasado(fi.estadoCivil) && soDigitos(lido.cpf) !== "" &&
                                   soDigitos(lido.cpf) === soDigitos(outro.cpf));
      /* 31/10/2026 (dono): fiador casado só com o casal como os 2 fiadores — ninguém assina à parte */
      fi.conjuge = null;
    });
    return fis;
  }
  /* Com parcela depois das chaves há fiador (36x/48x ou 24x alterado). Mesma regra do comPosChaves do branch do
     24x (venda/24x-sem-fiador); quando os dois estiverem no main, este vira um apelido dele. */
  function posChavesFiador(co) {
    return !!co && gruposFluxo(co).pos.some(function (s) { return s.n > 0 && positivo(s.v); });
  }
  /* Faltas do estado civil / cônjuge dos fiadores — só com pós-chaves (em 24x não há fiador). Só nomes de campo. */
  function faltasConjugeFiadores(co) {
    var f = [];
    if (!posChavesFiador(co)) return f;
    (co.fiadores || []).forEach(function (fi, i) {
      var gf = "Fiador " + (i + 1);
      if (vazio(fi.estadoCivil)) { f.push(gf + ": estado civil"); return; }
      /* 31/10/2026 (dono): casado ou em união estável, o outro fiador tem de ser o cônjuge (o casal é fiador).
         Assinando como fiador, o cônjuge também dá a outorga (CC 1.647, III; Súmula 332 do STJ). */
      if (fiadorCasado(fi.estadoCivil) && !fi.conjugeEhOutroFiador)
        f.push(gf + ": casado — o outro fiador tem de ser o cônjuge (CPF do cônjuge igual ao do outro fiador)");
    });
    return f;
  }
  function enderecoFiador(fi) {
    var partes = [];
    if (fi.endereco) partes.push(fi.endereco);
    if (fi.numero) partes.push("nº " + fi.numero.replace(/^n[ºo°]\.?\s*/i, ""));
    if (fi.setor) partes.push(fi.setor);
    if (fi.cidade) partes.push(fi.cidade);
    if (fi.cep) partes.push("CEP " + fi.cep.replace(/^CEP:?\s*/i, ""));
    return partes.join(", ");
  }
  function rgFiador(rg) {
    var r = txt(rg).replace(/^RG(?![A-Za-z]):?\s*(?:n[ºo°]\.?\s*)?/i, "");
    return r && !semNumero(r) ? "RG nº " + r : "";
  }
  /* "FIADOR 1: nome, nacionalidade, RG nº …, CPF nº …, residente e domiciliado à …, e-mail …." (estado civil e profissão não existem na base: ficam de fora) */
  function qualificacaoFiadores(lista) {
    return fiadoresPreenchidos(lista).map(function (fi, i) {
      var end = enderecoFiador(fi);
      var partes = [fi.nome, fi.nacionalidade, rgFiador(fi.rg), fi.cpf ? "CPF nº " + fi.cpf : "",
        end ? "residente e domiciliado à " + end : "", fi.email ? "e-mail " + fi.email : ""];
      return "FIADOR " + (i + 1) + ": " + partes.filter(function (p) { return p !== ""; }).join(", ") + ".";
    }).join("\n");
  }

  function montarCondominio(c) {
    var areaPriv = num(c.areaPrivativa);
    var out = {
      nome: txt(c.nome).replace(/^CONDOM[IÍ]NIO\s+/i, ""), unidade: txt(c.unidade),
      areaPrivativa: areaPriv, fracaoIdeal: txt(c.fracaoIdeal),
      fluxo: fluxoCondominio(c.fluxo),
      fiadores: fiadoresPreenchidos(c.fiadores),
      /* quadro-resumo (21/10): casa pela tabela do memorial; comissão da linha (vazia = pela regra) */
      tabela: U().unidade(c.nome, c.unidade),
      comissao: num(c.comissao),
      preReserva: preReservaPaga(c),
      valorParaEntrada: num(c.valorParaEntrada)
    };
    /* 29/10: fluxo alterado no portal (só quando existe: o carimbo das vendas sem alteração não muda) */
    var livre = txt(c.fluxoPersonalizado) ? FLV().ler(txt(c.fluxoPersonalizado)) : null;
    if (livre) out.livre = livre;
    /* 31/10/2026 (dono): comprador casado ou em união estável → o cônjuge assina o termo e o contrato, mesmo sem compor
       renda. Só quando existe (o carimbo das vendas de solteiros não muda). */
    var cj = conjugeDoComprador(c.conjugeComprador);
    if (cj) out.conjugeComprador = cj;
    else if (c.conjugeComprador && fiadorCasado(c.conjugeComprador.estadoCivil)) out.conjugeCompradorSemNome = true;
    return out;
  }

  function montarDadosContrato(f) {
    f = f || {};
    var v = f.venda || {}, o = f.obra || {};
    var c1 = v.COMPRADOR1 || {}, c2 = v.COMPRADOR2 || {};
    var temC2 = !vazio(c2.nome);
    var cond = f.condominio ? montarCondominio(f.condominio) : null;
    /* condomínio (contrato do advogado, 21/10/2026): a comissão é paga pelo COMPRADOR, por fora do preço
       do imóvel (valor da operação = VALOR DE VENDA + comissão). Antes (07/10) era paga pela incorporadora. */
    var pagaPor = cond ? "COMPRADOR" : up(v.COMISSAO_PAGA_POR);
    var total = cond && cond.fluxo.valorVenda !== null ? cond.fluxo.valorVenda : num(v.VALOR_CONTRATO);
    var comissao = num(v.COMISSAO), naMao = num(v.VALOR_NA_MAO);
    var aquisicao, intermediacao;
    if (cond) {
      comissao = valoresCondominio(cond).comissao;
      aquisicao = total !== null && comissao !== null ? so2(total - comissao) : total;   /* comissão dentro do preço (22/10) */
      intermediacao = comissao;
    } else if (pagaPor === "VENDEDOR") {
      aquisicao = total;
      intermediacao = "paga pelo VENDEDOR";
    } else {
      aquisicao = naMao !== null && naMao > 0 ? naMao
        : (total !== null && comissao !== null ? total - comissao : null);
      intermediacao = comissao;
    }
    var vend = f.vendedor || null;
    var lq = loteQuadra(v.ENDERECO);
    var dados = {
      modelo: escolherModelo(o.obraFinalizada, !!cond, v.TIPO_CASA),
      comprador1: {
        nome: nomeComprador1(v.CLIENTES, c2.nome), cpf: txt(v.CPF),
        nacionalidade: txt(c1.nacionalidade), estadoCivil: txt(c1.estadoCivil), profissao: txt(c1.profissao),
        documento: txt(c1.documento), endereco: txt(c1.endereco), email: txt(c1.email)
      },
      comprador2: temC2 ? {
        nome: txt(c2.nome), cpf: txt(c2.cpf),
        nacionalidade: txt(c2.nacionalidade), estadoCivil: txt(c2.estadoCivil), profissao: txt(c2.profissao),
        documento: txt(c2.documento), endereco: txt(c2.endereco), email: txt(c2.email)
      } : null,
      vendedor: vend ? {
        tipo: up(vend.tipo), nome: txt(vend.nome) || txt(o.proprietario), cpfCnpj: txt(vend.cpfCnpj) || txt(o.cpfCnpj),
        endereco: txt(vend.endereco),
        representanteNome: txt(vend.representanteNome), representanteCpf: txt(vend.representanteCpf),
        representanteRg: txt(vend.representanteRg), representanteNacionalidade: txt(vend.representanteNacionalidade),
        representanteEstadoCivil: txt(vend.representanteEstadoCivil),
        nacionalidade: txt(vend.nacionalidade), estadoCivil: txt(vend.estadoCivil),
        profissao: txt(vend.profissao), rg: txt(vend.rg),
        banco: txt(vend.banco), agencia: txt(vend.agencia), operacao: txt(vend.operacao),
        conta: txt(vend.conta), pix: txt(vend.pix),
        /* e-mails: só a assinatura (ClicksignVenda) usa; o contrato não exige */
        email: txt(vend.email), representanteEmail: txt(vend.representanteEmail)
      } : null,
      nomeProprietario: txt(o.proprietario),
      loteamento: f.loteamento ? {
        denominacao: txt(v.DENOMINACAO_LOTEAMENTO) || txt(f.loteamento.denominacao), municipioUf: txt(f.loteamento.municipioUf),
        matricula: txt(f.loteamento.matricula), cartorio: txt(f.loteamento.cartorio),
        prazoPosseDias: txt(f.loteamento.prazoPosseDias), prazoChavesDias: txt(f.loteamento.prazoChavesDias)
      } : null,
      imovel: {
        endereco: txt(v.ENDERECO), lote: lq ? lq.lote : "", quadra: lq ? lq.quadra : "",
        area: num(v.AREA), confrontacoes: txt(v.CONFRONTACOES),
        matriculaIndividual: txt(v.MATRICULA_INDIVIDUAL), cri: txt(v.CRI),
        alvaraNumero: txt(v.ALVARA_NUMERO), alvaraData: txt(v.ALVARA_DATA),
        habiteseNumero: txt(v.HABITESE_NUMERO), habiteseData: txt(v.HABITESE_DATA) || txt(o.dataHabitese),
        prazoConclusao: txt(v.PRAZO_CONCLUSAO), condicoesEspeciais: txt(v.CONDICOES_ESPECIAIS)
      },
      negociacao: {
        valorContrato: total, valorNaMao: naMao, aquisicao: aquisicao, intermediacao: intermediacao,
        sinalValor: num(v.SINAL_VALOR), sinalData: txt(v.SINAL_DATA),
        entradaValor: num(v.ENTRADA_VALOR), entradaVencimento: txt(v.ENTRADA_VENCIMENTO),
        intermediariaValor: num(v.INTERMEDIARIA_VALOR), intermediariaVencimento: txt(v.INTERMEDIARIA_VENCIMENTO),
        formaPagamento: txt(v.FORMA_PAGAMENTO)
      },
      comissao: {
        valor: comissao, forma: txt(v.COMISSAO_FORMA), vencimento: txt(v.COMISSAO_VENCIMENTO), pagaPor: pagaPor
      },
      corretor: f.corretor ? {
        nome: txt(f.corretor.nome), creci: txt(f.corretor.creci), cpfCnpj: txt(f.corretor.cpfCnpj),
        nacionalidade: txt(f.corretor.nacionalidade), endereco: txt(f.corretor.endereco), email: txt(f.corretor.email)
      } : null,
      corretorNaVenda: txt(v.CORRETOR),
      hojeISO: txt(f.hojeISO),
      cidadeAssinatura: txt(f.cidadeAssinatura) || "Goiânia"
    };
    /* só existe no condomínio: o carimbo dos contratos que não são do condomínio não muda */
    if (cond) {
      dados.condominio = cond;
      /* quadro-resumo: telefone dos compradores e do corretor, meio de pagamento da entrada */
      dados.comprador1.telefone = txt(c1.telefone);
      if (dados.comprador2) dados.comprador2.telefone = txt(c2.telefone);
      if (dados.corretor) dados.corretor.telefone = txt(f.corretor.telefone);
      dados.meioPagamento = txt(f.meioPagamento) || meioPagamentoCondominio(cond);
    }
    /* entrega 14: tipo escolhido na casa (só os valores novos; entra no carimbo) e o que a obra diz (só para o aviso) */
    if (!cond && tipoDoModelo(v.TIPO_CASA)) {
      dados.tipoCasa = tipoDoModelo(v.TIPO_CASA);
      dados.obraFinalizadaDoc = up(o.obraFinalizada);
    }
    return dados;
  }

  function faltasContrato(d) {
    var faltas = [];
    function exige(cond, grupo, item) { if (!cond) faltas.push(grupo + ": " + item); }
    /* entrega 14 (dono, 08/10): estado civil e profissão do comprador são opcionais — vazios, saem
       da qualificação sem deixar ", ," (qualificacao só junta as partes preenchidas) */
    function comprador(c, grupo) {
      exige(!vazio(c.nome), grupo, "nome");
      exige(!vazio(c.nacionalidade), grupo, "nacionalidade");
      /* 31/10/2026 (dono): RG do comprador é opcional — a identidade nova não tem RG; vazio, sai da qualificação */
      exige(!vazio(c.cpf), grupo, "CPF");
      exige(!vazio(c.endereco), grupo, "endereço");
    }
    var pronto = d.modelo === "PRONTO";

    comprador(d.comprador1, "Comprador 1");
    if (d.comprador2) comprador(d.comprador2, "Comprador 2");
    /* 01/11/2026 (dono): comprador casado ou em união estável — o cônjuge entra qualificado no contrato */
    var cjc = conjugeExtra(d);
    if (cjc) {
      exige(!vazio(cjc.cpf), "Cônjuge do comprador 1", "CPF");
      if (!cjc.uniao) exige(!vazio(cjc.regime), "Cônjuge do comprador 1", "regime de bens");
    } else if (d.condominio && d.condominio.conjugeCompradorSemNome && !(d.comprador2 && fiadorCasado(semAcento(d.comprador2.estadoCivil))))
      faltas.push("Cônjuge do comprador 1: nome");

    var v = d.vendedor;
    if (!v) faltas.push("Vendedor: cadastro em VENDEDORES – CONTRATO");
    else {
      exige(!vazio(v.nome), "Vendedor", "nome");
      exige(!vazio(v.cpfCnpj), "Vendedor", "CPF/CNPJ");
      exige(v.tipo === "PJ" || v.tipo === "PF", "Vendedor", "tipo (PJ ou PF)");
      exige(!vazio(v.endereco), "Vendedor", v.tipo === "PF" ? "endereço" : "endereço / sede");
      if (v.tipo === "PJ") {
        exige(!vazio(v.representanteNome), "Vendedor", "representante (nome)");
        exige(!vazio(v.representanteCpf), "Vendedor", "representante (CPF)");
        exige(!vazio(v.representanteRg), "Vendedor", "representante (RG)");
        exige(!vazio(v.representanteNacionalidade), "Vendedor", "representante (nacionalidade)");
        exige(!vazio(v.representanteEstadoCivil), "Vendedor", "representante (estado civil)");
      } else if (v.tipo === "PF") {
        exige(!vazio(v.nacionalidade), "Vendedor", "nacionalidade");
        exige(!vazio(v.estadoCivil), "Vendedor", "estado civil");
        exige(!vazio(v.profissao), "Vendedor", "profissão");
        exige(!vazio(v.rg), "Vendedor", "RG");
      }
      /* condomínio (contrato de 21/10): a conta da vendedora já vem escrita no texto (item 4.5) */
      if (!d.condominio) {
        exige(!vazio(v.banco), "Vendedor", "banco");
        exige(!vazio(v.agencia), "Vendedor", "agência");
        exige(!vazio(v.conta), "Vendedor", "conta");
      }
      /* Pix é opcional (08/10/2026): a conta da obra pode não ter chave; aí o trecho "– PIX:" sai do contrato
         (TRECHOS_SE_VAZIO) e ficam só banco, agência e conta. Com chave, saem os dois: dados bancários E Pix. */
    }

    /* condomínio (contrato de 21/10): empreendimento, matrícula e cartório já vêm escritos no texto —
       o cadastro em LOTEAMENTOS não é mais exigido */
    var l = d.loteamento;
    if (d.condominio) { /* nada a exigir */ }
    else if (!l) faltas.push("Loteamento: cadastro em LOTEAMENTOS – CONTRATO");
    else {
      exige(!vazio(l.denominacao), "Loteamento", "denominação");
      exige(!vazio(l.municipioUf), "Loteamento", "município/UF");
      exige(!vazio(l.matricula), "Loteamento", "matrícula do loteamento");
      exige(!vazio(l.cartorio), "Loteamento", "cartório");
      if (pronto) {
        exige(!vazio(l.prazoPosseDias), "Loteamento", "prazo de posse (dias)");
        exige(!vazio(l.prazoChavesDias), "Loteamento", "prazo de entrega das chaves (dias)");
      }
    }

    if (d.condominio) faltasCondominio(d, faltas);
    else faltasCasaDeRua(d, faltas, pronto);

    var k = d.corretor;
    if (d.condominio && d.condominio.livre && d.condominio.livre.semComissao) { /* 30/10: venda direta, sem corretor */ }
    else if (!k) {
      faltas.push(vazio(d.corretorNaVenda) ? "Corretor: corretor na venda" : "Corretor: cadastro em CORRETORES – CONTRATO");
    } else {
      exige(!vazio(k.nome), "Corretor", "nome");
      exige(!vazio(k.creci), "Corretor", "CRECI");
      exige(!vazio(k.cpfCnpj), "Corretor", "CPF/CNPJ");
    }
    return faltas;
  }

  /* Condomínio (decisão do dono 07/10): os dados do imóvel (unidade, fração, área, matrícula, CRI,
     alvará, prazo) PODEM ficar em branco — saem "____" no contrato e viram aviso (avisosContrato).
     Bloqueiam: assinatura, dia de pagamento, entrega, fluxo que não fecha com o VALOR DE VENDA,
     comprador sem nome ou sem CPF válido, fiador com nome sem CPF válido/RG/endereço. */
  function faltasCondominio(d, faltas) {
    function exige(cond, grupo, item) { if (!cond) faltas.push(grupo + ": " + item); }
    var co = d.condominio, fl = co.fluxo;
    [[d.comprador1, "Comprador 1"], [d.comprador2, "Comprador 2"]].forEach(function (p) {
      if (p[0] && !vazio(p[0].cpf) && !R().cpfValido(p[0].cpf)) faltas.push(p[1] + ": CPF inválido");
    });

    var g = "Fluxo de pagamento";
    exige(!vazio(fl.assinatura), g, "data de assinatura do contrato");
    exige(fl.diaPagamento !== null && fl.diaPagamento >= 5 && fl.diaPagamento <= 31, g, "dia de pagamento (de 5 a 31)");
    exige(!vazio(fl.entrega), g, "data da entrega");
    exige(positivo(fl.valorVenda), g, "valor de venda");
    function comData(valor, data, nome) { if (positivo(valor)) exige(!vazio(data), g, nome + " (data)"); }
    function serie(n, valor, data, nome) {
      if (!positivo(n) && !positivo(valor)) return;
      exige(positivo(n), g, nome + " (nº de parcelas)");
      exige(positivo(valor), g, nome + " (valor)");
      exige(!vazio(data), g, nome + " (data da 1ª)");
    }
    if (co.livre) {
      /* 29/10: fluxo alterado no portal — as regras da lista (a soma fecha com o valor da casa da própria lista) */
      FLV().validar({ valor: co.livre.valor, entrega: fl.entrega, linhas: co.livre.linhas }).erros.forEach(function (e) { faltas.push(g + " (alterado): " + e); });
    } else {
    if (co.preReserva && FLV().abaterSinal([fl.sinalAto, fl.sinal30, fl.sinal60, fl.sinal90], co.preReserva.valor).abatido < co.preReserva.valor)
      faltas.push(g + ": a pré-reserva paga (R$ " + moedaBR(co.preReserva.valor) + ") passa do sinal — confira o valor da pré-reserva");
    comData(fl.sinal30, fl.data30, "sinal 30 dias");
    comData(fl.sinal60, fl.data60, "sinal 60 dias");
    comData(fl.sinal90, fl.data90, "sinal 90 dias");
    serie(fl.pre1N, fl.pre1Valor, fl.pre1Data, "1ª parte pré-chaves");
    serie(fl.pre2N, fl.pre2Valor, fl.pre2Data, "2ª parte pré-chaves");
    comData(fl.balao1Valor, fl.balao1Data, "1º balão");
    comData(fl.balao2Valor, fl.balao2Data, "balão da entrega das chaves");
    serie(fl.posN, fl.posValor, fl.posData, "pós-chaves");
    /* 31/10/2026 (dono): pré-chaves e balões do simulador também não passam de 30/11/2028 */
    FLV().doPadrao(fl, 0).linhas.forEach(function (l) {
      if ((l.t !== "pre" && l.t !== "balao") || !l.d) return;
      var ult = FLV().maisMeses(l.d, (Math.max(1, l.n) - 1) * (l.i || 1));
      if (ult > FLV().LIMITE_PRE_CHAVES)
        faltas.push(g + ": " + FLV().TIPOS[l.t].nome.toLowerCase() + " vence em " + FLV().dataBR(ult) + " — pré-chaves e balões terminam até 30/11/2028 (refaça o fluxo na Planilha Casas)");
    });
    }
    if (positivo(fl.valorVenda) && !co.livre) {
      var soma = so2(somaFluxo(fl) + excedenteSinal(co));
      if (Math.abs(soma - fl.valorVenda) > 0.05)
        faltas.push(g + ": soma R$ " + moedaBR(soma) + " e não fecha com o valor de venda R$ " + moedaBR(fl.valorVenda));
    }

    /* comissão (item 5): sai do fluxo sozinha (planoDoFluxo, 31/10) — não trava mais o contrato */

    /* 30/10 (dono, parecer do 24x): sem parcela depois das chaves não há fiador — os dados de fiador nem são lidos */
    if (comPosChaves(co)) co.fiadores.forEach(function (fi, i) {
      var gf = "Fiador " + (i + 1);
      if (vazio(fi.cpf)) faltas.push(gf + ": CPF");
      else if (!R().cpfValido(fi.cpf)) faltas.push(gf + ": CPF inválido");
      /* 28/10 (dono com a diretoria): dos fiadores só nome e CPF (e o e-mail para assinar os termos de
         confissão) — o contrato final só os cita; RG e endereço deixaram de ser exigidos */
    });

    faltasConjugeFiadores(co).forEach(function (x) { faltas.push(x); });   /* 30/10: fiador casado (Súmula 332) */
  }

  /* Avisos (não impedem gerar): campos que saem em branco ("____") no contrato do condomínio e
     fiador com CPF repetido. Só nomes de campo — nenhum dado pessoal. [] fora do condomínio. */
  function avisosContrato(d) {
    var co = d && d.condominio;
    if (!co) return avisoTipoCasa(d);
    var a = [], im = d.imovel;
    function branco(ok, item) { if (!ok) a.push("Em branco no contrato: " + item); }
    branco(!vazio(co.unidade), "unidade");
    /* tipo, planta, áreas e fração vêm da tabela do memorial (UnidadesCondominio), não mais da linha */
    branco(!vazio(co.unidade) ? !!co.tabela : true, "tipo e áreas da casa (casa fora da tabela do condomínio)");
    /* matrícula, CRI, alvará e prazo de conclusão já vêm escritos no texto do contrato de 21/10: sem aviso */
    var so = function (x) { return txt(x).replace(/\D/g, ""); };
    var cpfsCompradores = [d.comprador1 && d.comprador1.cpf, d.comprador2 && d.comprador2.cpf]
      .map(so).filter(function (x) { return x !== ""; });
    var vistos = {};
    co.fiadores.forEach(function (fi, i) {
      var cpf = so(fi.cpf);
      if (!cpf) return;
      if (cpfsCompradores.indexOf(cpf) >= 0) a.push("Fiador " + (i + 1) + ": CPF igual ao de um comprador");
      if (vistos[cpf]) a.push("Fiadores: os dois têm o mesmo CPF");
      vistos[cpf] = true;
    });
    return a;
  }

  /* TIPO DE CASA diferente do "OBRA FINALIZADA?" da obra: não trava, só avisa (obra sem a marcação: nada) */
  function avisoTipoCasa(d) {
    if (!d || !d.tipoCasa) return [];
    var f = d.obraFinalizadaDoc;
    if (d.tipoCasa === "PRONTO" && (f === "NÃO" || f === "NAO"))
      return ["Tipo de casa: CASA PRONTA, mas a obra está marcada como não finalizada na DOCUMENTOS (OBRA FINALIZADA?)"];
    if (d.tipoCasa === "CONSTRUCAO" && f === "SIM")
      return ["Tipo de casa: CASA EM CONSTRUÇÃO, mas a obra está marcada como finalizada na DOCUMENTOS (OBRA FINALIZADA?)"];
    return [];
  }

  function faltasCasaDeRua(d, faltas, pronto) {
    function exige(cond, grupo, item) { if (!cond) faltas.push(grupo + ": " + item); }
    var im = d.imovel;
    exige(!vazio(im.lote) && !vazio(im.quadra), "Imóvel", "lote e quadra no endereço");
    exige(!vazio(im.matriculaIndividual), "Imóvel", "matrícula individual");
    exige(!vazio(im.cri), "Imóvel", "CRI da matrícula");
    exige(im.area !== null && im.area > 0, "Imóvel", "área do lote");
    exige(!vazio(im.alvaraNumero), "Imóvel", "alvará (número)");
    exige(!vazio(im.alvaraData), "Imóvel", "alvará (data)");
    if (!pronto) exige(!vazio(im.prazoConclusao), "Imóvel", "prazo previsto de conclusão das obras");
    if (pronto) {
      exige(!vazio(im.habiteseNumero), "Imóvel", "habite-se (número)");
      exige(!vazio(im.habiteseData), "Imóvel", "habite-se (data)");
    }

    var n = d.negociacao, c = d.comissao;
    exige(n.valorContrato !== null && n.valorContrato > 0, "Negociação", "valor do imóvel");
    if (n.valorContrato !== null && n.valorContrato > 0) {
      exige(n.aquisicao !== null && n.aquisicao > 0, "Negociação", "valor de aquisição inválido");
      /* com a comissão paga pelo comprador, o valor na mão entra no contrato: tem de fechar com o total */
      if (d.comissao.pagaPor !== "VENDEDOR" && n.valorNaMao !== null && n.valorNaMao > 0 && c.valor !== null &&
          Math.abs(n.valorNaMao + c.valor - n.valorContrato) > 0.01) {
        faltas.push("Negociação: valor na mão + comissão ≠ valor do contrato");
      }
    }
    exige(n.sinalValor !== null && n.sinalValor > 0, "Negociação", "sinal (valor)");
    exige(!vazio(n.sinalData), "Negociação", "sinal (data)");
    exige(n.entradaValor !== null && n.entradaValor > 0, "Negociação", "entrada (valor)");
    exige(!vazio(n.entradaVencimento), "Negociação", "entrada (vencimento)");
    if (n.intermediariaValor !== null && n.intermediariaValor > 0) {
      exige(!vazio(n.intermediariaVencimento), "Negociação", "intermediária (vencimento)");
    }
    exige(!vazio(n.formaPagamento), "Negociação", "forma de pagamento");
    exige(c.valor !== null && c.valor > 0, "Negociação", "comissão (valor)");
    exige(!vazio(c.forma), "Negociação", "comissão (forma)");
    /* comissão (vencimento) deixou de ser exigida (dono, 08/10): vazia, a linha "c) Vencimento:" sai do
       contrato e as letras seguintes sobem (PARAGRAFOS_SE_VAZIO) */
    exige(c.pagaPor === "COMPRADOR" || c.pagaPor === "VENDEDOR", "Negociação", "comissão paga por");
  }

  function moedaOuVazio(n) { return n === null || n === undefined ? "" : moedaBR(n); }

  function areaTxt(a) {
    if (a === null || a === undefined) return "";
    return Math.floor(a) === a ? String(a) : moedaBR(a).replace(/\./g, "");
  }

  function marcadores(d) {
    var c1 = d.comprador1, c2 = d.comprador2, cjq = conjugeExtra(d), v = d.vendedor || {}, l = d.loteamento || {};
    var im = d.imovel, n = d.negociacao, c = d.comissao, k = d.corretor || {};
    var ehPJ = v.tipo === "PJ";
    var compradores = qualificacao(c1) + (c2 ? "; e " + qualificacao(c2) : "");
    var nomes = c2 ? c1.nome + " e " + c2.nome : c1.nome;
    var pagaVend = c.pagaPor === "VENDEDOR";
    var ehPF = v.tipo === "PF";
    var interm = typeof n.intermediacao === "string" ? n.intermediacao
      : (n.intermediacao === null ? "" : "R$ " + moedaBR(n.intermediacao));
    var co = d.condominio || null, fis = co ? co.fiadores : [];
    var m = {
      /* condomínio (vazios fora dele; o modelo de casa de rua não usa) */
      CONDOMINIO_NOME: co ? co.nome : "",
      UNIDADE: co ? co.unidade : "",
      AREA_PRIVATIVA: co ? (co.tabela ? moedaBR(co.tabela.areaPrivativaConstruida) : areaTxt(co.areaPrivativa)) : "",
      FRACAO_IDEAL: co ? (co.tabela ? moedaBR(co.tabela.fracaoM2) + " m² (" + co.tabela.fracaoPct + "%)" : co.fracaoIdeal) : "",
      FORMA_PAGAMENTO_CONDOMINIO: co ? formaPagamentoCondominio(co.fluxo, co.livre, co.preReserva) : "",
      FIADORES_QUALIFICACAO: qualificacaoFiadores(fis),
      FIADOR1_NOME: fis[0] ? fis[0].nome : "",
      FIADOR1_CPF: fis[0] ? fis[0].cpf : "",
      FIADOR2_NOME: fis[1] ? fis[1].nome : "",
      FIADOR2_CPF: fis[1] ? fis[1].cpf : "",
      COMPRADORES: compradores,
      VENDEDOR_NOME: txt(v.nome) || d.nomeProprietario,
      VENDEDOR_DOC: txt(v.cpfCnpj),
      VENDEDOR_ENDERECO: txt(v.endereco),
      VENDEDOR_NACIONALIDADE: ehPJ ? txt(v.representanteNacionalidade) : txt(v.nacionalidade),
      VENDEDOR_ESTADO_CIVIL: ehPJ ? txt(v.representanteEstadoCivil) : txt(v.estadoCivil),
      VENDEDOR_PROFISSAO: ehPJ ? "" : txt(v.profissao),
      VENDEDOR_RG: ehPJ ? txt(v.representanteRg) : txt(v.rg),
      VENDEDOR_DOC_ROTULO: ehPJ ? "CNPJ sob o número " + txt(v.cpfCnpj) : (ehPF ? "CPF nº " + txt(v.cpfCnpj) : txt(v.cpfCnpj)),
      REPRESENTANTE_NOME: ehPF ? (txt(v.nome) || d.nomeProprietario) : txt(v.representanteNome),
      REPRESENTANTE_CPF: ehPF ? txt(v.cpfCnpj) : txt(v.representanteCpf),
      PRAZO_CONCLUSAO: dataBR(im.prazoConclusao),
      /* 29/10: uma linha só (o Google Docs não troca marcador por texto com quebra de linha) */
      CONDICOES_ESPECIAIS: txt(im.condicoesEspeciais).replace(/\s*\n+\s*/g, " ").trim() || "Não há.",
      ASSINATURA_COMPRADORES_NOMES: [c1.nome].concat(cjq ? [cjq.nome] : [], c2 ? [c2.nome] : []).join(" / "),
      ASSINATURA_COMPRADORES_CPFS: [c1.cpf].concat(cjq ? [cjq.cpf] : [], c2 ? [c2.cpf] : []).join(" / "),
      /* o memorial só tem compradores (o cônjuge não o assina) — AssinaturaVenda.assDocsDoComprador_ */
      MEMORIAL_ASSINATURA_NOMES: c2 ? c1.nome + " / " + c2.nome : c1.nome,
      MEMORIAL_ASSINATURA_CPFS: c2 ? c1.cpf + " / " + c2.cpf : c1.cpf,
      CORRETOR_DOC: txt(k.cpfCnpj),
      LOTEAMENTO: txt(l.denominacao),
      MUNICIPIO_UF: txt(l.municipioUf),
      ALVARA_NUMERO: im.alvaraNumero,
      ALVARA_DATA: dataBR(im.alvaraData),
      HABITESE_NUMERO: im.habiteseNumero,
      HABITESE_DATA: dataBR(im.habiteseData),
      MATRICULA_LOTEAMENTO: txt(l.matricula),
      CARTORIO_LOTEAMENTO: txt(l.cartorio),
      LOTE: im.lote,
      QUADRA: im.quadra,
      AREA: areaTxt(im.area),
      CONFRONTACOES: im.confrontacoes,
      MATRICULA_INDIVIDUAL: im.matriculaIndividual,
      CRI: im.cri,
      VALOR_IMOVEL: moedaOuVazio(n.aquisicao),
      VALOR_INTERMEDIACAO: interm,
      VALOR_TOTAL: n.valorContrato === null ? "" : "R$ " + moedaBR(n.valorContrato),
      VALOR_TOTAL_NUM: moedaOuVazio(n.valorContrato),
      VALOR_TOTAL_EXTENSO: n.valorContrato === null ? "" : valorPorExtenso(n.valorContrato),
      COMISSAO_VALOR: moedaOuVazio(c.valor),
      COMISSAO_FORMA: formaPorExtenso(c.forma),
      COMISSAO_VENCIMENTO: c.vencimento,
      COMISSAO_RESPONSAVEL: pagaVend ? (txt(v.nome) || d.nomeProprietario) : nomes,
      CORRETOR_NOME: txt(k.nome),
      CORRETOR_CRECI: txt(k.creci),
      SINAL_VALOR: moedaOuVazio(n.sinalValor),
      SINAL_DATA: dataBR(n.sinalData),
      ENTRADA_VALOR: moedaOuVazio(n.entradaValor),
      ENTRADA_VENCIMENTO: dataBR(n.entradaVencimento),
      INTERMEDIARIA_VALOR: moedaOuVazio(n.intermediariaValor),
      INTERMEDIARIA_VENCIMENTO: dataBR(n.intermediariaVencimento),
      FORMA_PAGAMENTO: formaPorExtenso(n.formaPagamento),
      BANCO: txt(v.banco),
      AGENCIA: txt(v.agencia),
      OPERACAO: txt(v.operacao),
      CONTA: txt(v.conta),
      PIX: txt(v.pix),
      PRAZO_POSSE_DIAS: txt(l.prazoPosseDias),
      PRAZO_CHAVES_DIAS: txt(l.prazoChavesDias),
      /* condomínio: a data é a da assinatura do contrato (sem ela, hoje) */
      CIDADE_DATA: d.cidadeAssinatura + ", " + dataPorExtenso(co && co.fluxo.assinatura ? co.fluxo.assinatura : d.hojeISO)
    };
    Object.assign(m, marcadoresQuadro(d));
    /* condomínio: dado do imóvel em branco não trava (decisão do dono) — sai um traço para preencher à mão */
    if (co) CAMPOS_EM_BRANCO.forEach(function (k) { if (vazio(m[k])) m[k] = EM_BRANCO; });
    return m;
  }
  var EM_BRANCO = "____";
  var CAMPOS_EM_BRANCO = ["UNIDADE", "AREA_PRIVATIVA", "FRACAO_IDEAL", "MATRICULA_INDIVIDUAL", "CRI",
    "ALVARA_NUMERO", "ALVARA_DATA", "PRAZO_CONCLUSAO", "CASA_NUMERO", "CASA_TIPO", "CASA_PLANTA",
    "AREA_PRIVATIVA_CONSTRUIDA", "AREA_TOTAL_CONSTRUIDA", "FRACAO_IDEAL_M2", "FRACAO_IDEAL_PCT"];

  /* Marcadores do contrato do condomínio do advogado (21/10/2026). Fora do condomínio, todos vazios. */
  var CHAVES_QUADRO = ["COMPRADORES_QUADRO", "CORRETOR_QUADRO", "CORRETOR_DOC_ROTULO", "CASA_NUMERO", "CASA_TIPO", "CASA_PLANTA",
    "CASA_MODELO_FRASE", "AREA_PRIVATIVA_CONSTRUIDA", "AREA_TOTAL_CONSTRUIDA", "FRACAO_IDEAL_M2", "FRACAO_IDEAL_PCT",
    "VALOR_OPERACAO_EXTENSO", "VALOR_IMOVEL_EXTENSO", "COMISSAO_EXTENSO", "SINAL_EXTENSO", "SINAL_VENCIMENTO",
    "ENTRADA_TOTAL", "ENTRADA_PCT", "ENTRADA_SALDO", "PARCELAS_PRE_CHAVES", "PARCELAS_POS_CHAVES", "MEIO_PAGAMENTO",
    "FINANCIAMENTO_VALOR", "FINANCIAMENTO_PCT", "FINANCIAMENTO_FRASE", "COMISSAO_PCT"];
  function marcadoresQuadro(d) {
    var co = d.condominio, m = {};
    if (!co) { CHAVES_QUADRO.forEach(function (k) { m[k] = ""; }); return m; }
    var G = gruposFluxo(co), va = valoresCondominio(co), tb = co.tabela, k = d.corretor || {};
    function ext(n) { return n === null ? "" : valorExtenso(n); }
    var num2 = /\d+/.exec(co.unidade);
    m.COMPRADORES_QUADRO = qualificacaoQuadro(d.comprador1, conjugeExtra(d)) + (d.comprador2 ? "; e " + qualificacaoQuadro(d.comprador2) : "");
    m.CORRETOR_QUADRO = qualificacaoCorretor(k);
    m.CORRETOR_DOC_ROTULO = docRotulo(k.cpfCnpj);
    m.CASA_NUMERO = num2 ? (num2[0].length < 2 ? "0" + num2[0] : num2[0]) : "";
    m.CASA_TIPO = tb ? tb.tipo : "";
    m.CASA_PLANTA = tb ? tb.planta : "";
    m.CASA_MODELO_FRASE = tb && tb.casaModelo ? FRASE_CASA_MODELO : "";
    m.AREA_PRIVATIVA_CONSTRUIDA = tb ? moedaBR(tb.areaPrivativaConstruida) : "";
    m.AREA_TOTAL_CONSTRUIDA = tb ? moedaBR(tb.areaTotalConstruida) : "";
    m.FRACAO_IDEAL_M2 = tb ? moedaBR(tb.fracaoM2) : "";
    m.FRACAO_IDEAL_PCT = tb ? tb.fracaoPct : "";
    m.VALOR_OPERACAO_EXTENSO = ext(va.operacao);
    m.VALOR_IMOVEL_EXTENSO = ext(va.imovel);
    m.COMISSAO_EXTENSO = va.semComissao ? "" : ext(va.comissao);
    m.SINAL_EXTENSO = positivo(va.sinal) ? valorExtenso(va.sinal) : "";
    /* 31/10: a pré-reserva paga é a 1ª parcela da lista (vencimentosSinal), já abatida do sinal */
    m.SINAL_VENCIMENTO = vencimentosSinal(G);
    m.ENTRADA_TOTAL = moedaOuVazio(va.entrada);
    m.ENTRADA_PCT = va.entrada === null ? "" : pct2(va.entrada, va.preco);
    m.ENTRADA_SALDO = moedaOuVazio(va.saldoEntrada);
    m.PARCELAS_PRE_CHAVES = textoPreChaves(G);
    m.PARCELAS_POS_CHAVES = textoPosChaves(G);
    m.MEIO_PAGAMENTO = d.meioPagamento || MEIO_PAGAMENTO_PADRAO;
    m.FINANCIAMENTO_VALOR = moedaBR(va.financiamento);
    m.FINANCIAMENTO_PCT = pct2(va.financiamento, va.preco);
    m.FINANCIAMENTO_FRASE = va.temFgtsSubsidio ? ", incluídos os recursos do FGTS e/ou subsídio, quando houver" : "";
    m.COMISSAO_PCT = va.pctRegra === null || va.semComissao ? "" : pctBR(va.pctRegra);
    return m;
  }

  /* 30/10 (dono, parecer do 24x): o plano é "com pós-chaves" quando o fluxo (gavetas ou Alterar fluxo) tem parcela depois das
     chaves — 36x/48x, ou um 24x alterado. Só com pós-chaves há fiador e Termos de Confissão; sem, a confissão vai no 4.2.1. */
  function comPosChaves(co) {
    return !!co && gruposFluxo(co).pos.some(function (s) { return s.n > 0 && positivo(s.v); });
  }

  function blocos(d) {
    var v = d.vendedor || {}, n = d.negociacao, pos = d.condominio ? comPosChaves(d.condominio) : false;
    var fis = pos ? d.condominio.fiadores : [];
    var temInterm = n.intermediariaValor !== null && n.intermediariaValor > 0;
    /* 30/10: venda direta (Alterar fluxo → isentar a comissão). O modelo do advogado ainda NÃO tem estes blocos; a
       geração recusa a venda sem comissão enquanto o modelo não tiver {{#SEM_COMISSAO}} (GerarContrato.ctrGerarPdf_).
       No modelo: o texto de hoje do 4.1.2 e do item 5 dentro de {{#COM_COMISSAO}}…{{/COM_COMISSAO}}; o novo dentro de
       {{#SEM_COMISSAO}}…{{/SEM_COMISSAO}} ("Comissão de corretagem: não há (venda direta)" e "Não há intermediação de
       corretor nesta venda"). Fora do condomínio COM_COMISSAO é sempre verdadeiro (nada muda nos outros modelos). */
    var semCom = !!(d.condominio && d.condominio.livre && d.condominio.livre.semComissao);
    var b = {
      SEM_COMISSAO: semCom,
      COM_COMISSAO: !semCom,
      SE_VENDEDOR_PJ: v.tipo === "PJ",
      SE_VENDEDOR_PF: v.tipo === "PF",
      SE_INTERMEDIARIA: temInterm,
      SEM_INTERMEDIARIA: !temInterm,
      SE_COMISSAO_VENDEDOR: d.comissao.pagaPor === "VENDEDOR",
      TEM_FIADORES: fis.length > 0,
      TEM_FIADOR1: fis.length > 0,
      TEM_FIADOR2: fis.length > 1
    };
    if (d.condominio) { b.COM_POS = pos; b.SEM_POS = !pos; }
    return b;
  }

  /* ---- entrega 12: campos abertos na tela do contrato ----
   * Quando falta dado do vendedor, do corretor ou do loteamento, a tela mostra um formulário só com
   * esses campos; o que é digitado vai para a linha do cadastro. A lista branca de cada grupo são os
   * nomes EXATOS das colunas que o contrato lê (GerarContrato.ctrFontes_). Os dados bancários do
   * vendedor ficam de fora de propósito: a conta de depósito é escolhida por venda ("Conta de
   * recebimento"), não gravada no cadastro do dono.
   * tipo: texto | cpf | cpfcnpj | email | inteiro | opcao (com opcoes). */
  var CAMPOS_CADASTRO = {
    vendedor: [
      { coluna: "CPF/CNPJ", rotulo: "CPF/CNPJ", tipo: "cpfcnpj" },
      { coluna: "TIPO", rotulo: "Tipo (PJ ou PF)", tipo: "opcao", opcoes: ["PJ", "PF"] },
      { coluna: "ENDEREÇO / SEDE", rotulo: "Endereço / sede", tipo: "texto" },
      { coluna: "REPRESENTANTE NOME", rotulo: "Representante — nome", tipo: "texto" },
      { coluna: "REPRESENTANTE CPF", rotulo: "Representante — CPF", tipo: "cpf" },
      { coluna: "REPRESENTANTE RG", rotulo: "Representante — RG", tipo: "texto" },
      { coluna: "REPRESENTANTE NACIONALIDADE", rotulo: "Representante — nacionalidade", tipo: "texto" },
      { coluna: "REPRESENTANTE ESTADO CIVIL", rotulo: "Representante — estado civil", tipo: "texto" },
      { coluna: "REPRESENTANTE E-MAIL", rotulo: "Representante — e-mail", tipo: "email" },
      { coluna: "NACIONALIDADE", rotulo: "Nacionalidade", tipo: "texto" },
      { coluna: "ESTADO CIVIL", rotulo: "Estado civil", tipo: "texto" },
      { coluna: "PROFISSÃO", rotulo: "Profissão", tipo: "texto" },
      { coluna: "RG", rotulo: "RG", tipo: "texto" },
      { coluna: "E-MAIL", rotulo: "E-mail", tipo: "email" }
    ],
    corretor: [
      { coluna: "CRECI", rotulo: "CRECI", tipo: "texto" },
      { coluna: "CPF/CNPJ", rotulo: "CPF/CNPJ", tipo: "cpfcnpj" },
      { coluna: "NACIONALIDADE", rotulo: "Nacionalidade", tipo: "texto" },
      { coluna: "ENDEREÇO PROFISSIONAL", rotulo: "Endereço profissional", tipo: "texto" },
      { coluna: "E-MAIL", rotulo: "E-mail", tipo: "email" }
    ],
    loteamento: [
      { coluna: "DENOMINAÇÃO", rotulo: "Denominação", tipo: "texto" },
      { coluna: "MUNICÍPIO/UF", rotulo: "Município/UF", tipo: "texto" },
      { coluna: "MATRÍCULA DO LOTEAMENTO", rotulo: "Matrícula", tipo: "texto" },
      { coluna: "CARTÓRIO", rotulo: "Cartório", tipo: "texto" },
      { coluna: "PRAZO POSSE (DIAS)", rotulo: "Prazo de posse (dias)", tipo: "inteiro" },
      { coluna: "PRAZO CHAVES (DIAS ÚTEIS)", rotulo: "Prazo de entrega das chaves (dias úteis)", tipo: "inteiro" }
    ]
  };
  var GRUPOS_CADASTRO = ["vendedor", "corretor", "loteamento"];
  function campoDe(grupo, coluna) {
    var lista = CAMPOS_CADASTRO[grupo] || [];
    for (var i = 0; i < lista.length; i++) if (lista[i].coluna === coluna) return lista[i];
    return null;
  }
  /* falta (texto do faltasContrato, sem o grupo) -> colunas do formulário */
  var FALTA_VENDEDOR = {
    "CPF/CNPJ": ["CPF/CNPJ"], "tipo (PJ ou PF)": ["TIPO"], "endereço / sede": ["ENDEREÇO / SEDE"], "endereço": ["ENDEREÇO / SEDE"],
    "representante (nome)": ["REPRESENTANTE NOME"], "representante (CPF)": ["REPRESENTANTE CPF"],
    "representante (RG)": ["REPRESENTANTE RG"], "representante (nacionalidade)": ["REPRESENTANTE NACIONALIDADE"],
    "representante (estado civil)": ["REPRESENTANTE ESTADO CIVIL"],
    "nacionalidade": ["NACIONALIDADE"], "estado civil": ["ESTADO CIVIL"], "profissão": ["PROFISSÃO"], "RG": ["RG"]
  };
  var FALTA_CONTA = { "banco": 1, "agência": 1, "conta": 1 };
  var FALTA_CORRETOR = { "CRECI": ["CRECI"], "CPF/CNPJ": ["CPF/CNPJ"], "cadastro em CORRETORES – CONTRATO": ["CRECI", "CPF/CNPJ"] };
  var FALTA_LOTEAMENTO = {
    "denominação": ["DENOMINAÇÃO"], "município/UF": ["MUNICÍPIO/UF"], "matrícula do loteamento": ["MATRÍCULA DO LOTEAMENTO"],
    "matrícula do empreendimento": ["MATRÍCULA DO LOTEAMENTO"], "cartório": ["CARTÓRIO"],
    "prazo de posse (dias)": ["PRAZO POSSE (DIAS)"], "prazo de entrega das chaves (dias)": ["PRAZO CHAVES (DIAS ÚTEIS)"]
  };

  /* Formulário da tela a partir das faltas: { grupos: [{grupo, titulo, criar, campos:[{coluna, rotulo, tipo, opcoes?}]}],
   * conta: true quando falta banco/agência/conta (resolve na "Conta de recebimento"), outras: faltas que o formulário
   * não cobre (continuam em lista). opts: { modelo, chaveLoteamento (SETOR ou nome do condomínio) }.
   * Só nomes de campo — nenhum valor de ninguém. */
  function camposAbertos(faltas, opts) {
    opts = opts || {};
    var por = { vendedor: [], corretor: [], loteamento: [] }, criar = { corretor: false, loteamento: false };
    var outras = [], conta = false, tituloLot = "Loteamento";
    function poe(grupo, colunas) {
      colunas.forEach(function (c) { if (por[grupo].indexOf(c) < 0) por[grupo].push(c); });
    }
    (faltas || []).forEach(function (f) {
      var s = txt(f), i = s.indexOf(": "), g = i > 0 ? s.slice(0, i) : "", item = i > 0 ? s.slice(i + 2) : s;
      if (g === "Vendedor" && FALTA_VENDEDOR[item]) return poe("vendedor", FALTA_VENDEDOR[item]);
      if (g === "Vendedor" && FALTA_CONTA[item]) { conta = true; return; }
      if (g === "Conta de recebimento") { conta = true; outras.push(s); return; }
      if (g === "Corretor" && FALTA_CORRETOR[item]) {
        if (/^cadastro/.test(item)) criar.corretor = true;
        return poe("corretor", FALTA_CORRETOR[item]);
      }
      if (g === "Loteamento" || g === "Condomínio") {
        if (/^cadastro em LOTEAMENTOS/.test(item)) {
          if (!txt(opts.chaveLoteamento)) { outras.push(s); return; }   // sem SETOR (ou nome) não há linha para criar
          criar.loteamento = true;
          if (g === "Condomínio") tituloLot = "Condomínio";
          poe("loteamento", ["DENOMINAÇÃO", "MUNICÍPIO/UF", "MATRÍCULA DO LOTEAMENTO", "CARTÓRIO"]);
          if (opts.modelo === "PRONTO") poe("loteamento", ["PRAZO POSSE (DIAS)", "PRAZO CHAVES (DIAS ÚTEIS)"]);
          return;
        }
        if (FALTA_LOTEAMENTO[item]) {
          if (g === "Condomínio") tituloLot = "Condomínio";
          return poe("loteamento", FALTA_LOTEAMENTO[item]);
        }
      }
      outras.push(s);
    });
    var TITULOS = { vendedor: "Vendedor", corretor: "Corretor", loteamento: tituloLot };
    var grupos = [];
    GRUPOS_CADASTRO.forEach(function (g) {
      if (!por[g].length) return;
      grupos.push({ grupo: g, titulo: TITULOS[g], criar: !!criar[g], campos: por[g].map(function (c) {
        var d = campoDe(g, c), o = { coluna: d.coluna, rotulo: d.rotulo, tipo: d.tipo };
        if (d.opcoes) o.opcoes = d.opcoes.slice();
        return o;
      }) });
    });
    return { grupos: grupos, conta: conta, outras: outras };
  }

  function cnpjValido(v) {
    var d = txt(v).replace(/\D/g, "");
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    function dv(n) {
      var pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], s = 0;
      for (var i = 0; i < n; i++) s += Number(d[i]) * pesos[i];
      var r = s % 11;
      return r < 2 ? 0 : 11 - r;
    }
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  function formatarCnpj(v) {
    var d = txt(v).replace(/\D/g, "");
    return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
  }
  function emailValido(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(v)); }
  var NOMES_GRUPO = { vendedor: "Vendedor", corretor: "Corretor", loteamento: "Loteamento" };

  /* Confere o que veio da tela: { ok, valores: {grupo: {coluna: valor normalizado}}, erros: ["Grupo — rótulo: motivo"] }.
   * Coluna fora da lista branca, grupo desconhecido ou valor não texto = erro. Valor vazio é ignorado (não apaga nada).
   * Os erros têm só o nome do campo, nunca o valor digitado. */
  function validarCampos(campos) {
    var valores = {}, erros = [], total = 0;
    if (!campos || typeof campos !== "object" || Array.isArray(campos)) return { ok: false, valores: {}, erros: ["Nenhum campo enviado"], total: 0 };
    Object.keys(campos).forEach(function (g) {
      var grupo = campos[g];
      if (GRUPOS_CADASTRO.indexOf(g) < 0) { erros.push("Grupo desconhecido: " + String(g).slice(0, 40)); return; }
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) { erros.push(NOMES_GRUPO[g] + ": formato inválido"); return; }
      Object.keys(grupo).forEach(function (coluna) {
        var def = campoDe(g, coluna), nome = NOMES_GRUPO[g] + " — " + (def ? def.rotulo : String(coluna).slice(0, 40));
        if (!def) { erros.push(nome + ": campo não permitido"); return; }
        var bruto = grupo[coluna];
        if (bruto !== null && bruto !== undefined && typeof bruto !== "string" && typeof bruto !== "number") { erros.push(nome + ": formato inválido"); return; }
        var v = txt(bruto).replace(/\{\{|\}\}/g, "").replace(/\s+/g, " ").trim();
        if (!v) return;
        if (v.length > 300) { erros.push(nome + ": texto longo demais"); return; }
        var d = v.replace(/\D/g, "");
        if (def.tipo === "cpf") {
          if (!R().cpfValido(v)) { erros.push(nome + ": CPF inválido"); return; }
          v = R().formatarCpf(v);
        } else if (def.tipo === "cpfcnpj") {
          if (d.length === 11) { if (!R().cpfValido(v)) { erros.push(nome + ": CPF inválido"); return; } v = R().formatarCpf(v); }
          else if (d.length === 14) { if (!cnpjValido(v)) { erros.push(nome + ": CNPJ inválido"); return; } v = formatarCnpj(v); }
          else { erros.push(nome + ": CPF (11 dígitos) ou CNPJ (14 dígitos)"); return; }
        } else if (def.tipo === "email") {
          if (!emailValido(v)) { erros.push(nome + ": e-mail inválido"); return; }
          v = v.toLowerCase();
        } else if (def.tipo === "inteiro") {
          if (!/^\d{1,4}$/.test(v) || Number(v) < 1) { erros.push(nome + ": número de dias inválido"); return; }
          v = Number(v);
        } else if (def.tipo === "opcao") {
          var op = null;
          def.opcoes.forEach(function (o) { if (o.toUpperCase() === v.toUpperCase()) op = o; });
          if (!op) { erros.push(nome + ": escolha " + def.opcoes.join(" ou ")); return; }
          v = op;
        }
        if (!valores[g]) valores[g] = {};
        valores[g][coluna] = v;
        total++;
      });
    });
    if (!erros.length && !total) erros.push("Nenhum campo preenchido");
    return { ok: !erros.length, valores: valores, erros: erros, total: total };
  }

  /* Conta de recebimento digitada (por venda; não vai para o Notion). { ok, conta: {banco, agencia, conta, pix[, operacao]} }
     ou { ok:false, erros }. Operação (entrega 14) é opcional: vazia, nem entra no JSON (as escolhas antigas não mudam)
     e o "– Operação:" sai do contrato (TRECHOS_SE_VAZIO). */
  function validarContaDigitada(c) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, erros: ["Conta: formato inválido"] };
    var o = {}, erros = [];
    [["banco", "Banco", true], ["agencia", "Agência", true], ["operacao", "Operação", false], ["conta", "Conta", true], ["pix", "Chave PIX", false]].forEach(function (x) {
      var b = c[x[0]];
      if (b !== null && b !== undefined && typeof b !== "string" && typeof b !== "number") { erros.push("Conta — " + x[1] + ": formato inválido"); return; }
      var v = txt(b).replace(/\{\{|\}\}/g, "").replace(/\s+/g, " ").trim();
      if (x[2] && !v) erros.push("Conta — " + x[1] + ": obrigatório");
      else if (v.length > 120) erros.push("Conta — " + x[1] + ": texto longo demais");
      if (x[0] !== "operacao" || v) o[x[0]] = v;
    });
    return erros.length ? { ok: false, erros: erros } : { ok: true, conta: o };
  }

  /* ---- entrega 14: parágrafo que some quando o marcador está vazio ----
   * PARAGRAFOS_SE_VAZIO[chave] = { so: regex do parágrafo que é SÓ rótulo + marcador, reletrar: [[regex do começo de
   * um parágrafo seguinte, começo novo]] }. Vazio o marcador, o parágrafo inteiro sai (nada de "c) Vencimento:" em
   * branco) e as alíneas seguintes da mesma lista sobem uma letra. Parágrafo com mais texto além do rótulo não
   * casa com `so`: fica, e o marcador sai vazio como sempre. Regex em sintaxe JS (o GerarContrato lê o texto). */
  var PARAGRAFOS_SE_VAZIO = {
    COMISSAO_VENCIMENTO: {
      so: "^\\s*c\\)\\s*Vencimento:?\\s*\\{\\{COMISSAO_VENCIMENTO\\}\\}\\s*[.;]?\\s*$",
      reletrar: [["^(\\s*)d\\)(\\s*Corretor:)", "$1c)$2"], ["^(\\s*)e\\)(\\s*Responsável pelo pagamento:)", "$1d)$2"]]
    }
  };
  /* Plano sobre os textos dos parágrafos (na ordem do documento): { apagar: [índices], trocar: [{ i, texto }] }.
     Só mexe quando o marcador está vazio e o parágrafo "só rótulo" existe; as trocas valem só para os
     parágrafos DEPOIS dele, até 12 parágrafos adiante (a mesma lista de alíneas). */
  function planoParagrafosVazios(textos, marcadores) {
    var plano = { apagar: [], trocar: [] };
    textos = textos || []; marcadores = marcadores || {};
    Object.keys(PARAGRAFOS_SE_VAZIO).forEach(function (chave) {
      if (!(chave in marcadores) || txt(marcadores[chave])) return;
      var regra = PARAGRAFOS_SE_VAZIO[chave], so = new RegExp(regra.so);
      for (var i = 0; i < textos.length; i++) {
        if (!so.test(String(textos[i]))) continue;
        plano.apagar.push(i);
        (regra.reletrar || []).forEach(function (r) {
          var re = new RegExp(r[0]);
          for (var j = i + 1; j < textos.length && j <= i + 12; j++) {
            if (!re.test(String(textos[j]))) continue;
            plano.trocar.push({ i: j, de: r[0], para: r[1], texto: String(textos[j]).replace(re, r[1]) });
            break;
          }
        });
      }
    });
    return plano;
  }

  var api = {
    PARAGRAFOS_SE_VAZIO: PARAGRAFOS_SE_VAZIO, planoParagrafosVazios: planoParagrafosVazios,
    CAMPOS_CADASTRO: CAMPOS_CADASTRO, camposAbertos: camposAbertos, validarCampos: validarCampos,
    validarContaDigitada: validarContaDigitada, cnpjValido: cnpjValido,
    COL: COL, TIPOS: TIPOS, moedaBR: moedaBR, valorPorExtenso: valorPorExtenso,
    dataBR: dataBR, dataPorExtenso: dataPorExtenso, loteQuadra: loteQuadra,
    escolherModelo: escolherModelo, qualificacao: qualificacao, nomeComprador1: nomeComprador1,
    montarDadosContrato: montarDadosContrato, faltasContrato: faltasContrato, montarCondominio: montarCondominio,
    marcadores: marcadores, blocos: blocos, comPosChaves: comPosChaves, avisosContrato: avisosContrato,
    formaPagamentoCondominio: formaPagamentoCondominio, qualificacaoFiadores: qualificacaoFiadores,
    fiadorCasado: fiadorCasado, faltasConjugeFiadores: faltasConjugeFiadores,   /* 30/10: fiador casado (Súmula 332) */
    comissaoPctPelaRegra: comissaoPctPelaRegra, qualificacaoQuadro: qualificacaoQuadro, valorExtenso: valorExtenso, meioPagamentoCondominio: meioPagamentoCondominio, excedenteSinal: excedenteSinal, preReservaPaga: preReservaPaga,
    somaFluxo: function (fl) { return somaFluxo(fluxoCondominio(fl)); }, negritoDaLinha: negritoDaLinha,
    parcelasPreChaves: parcelasPreChaves, parcelasPosChaves: parcelasPosChaves,
    gruposFluxo: gruposFluxo, valoresCondominio: valoresCondominio, textoPreChaves: textoPreChaves, textoPosChaves: textoPosChaves, somaGrupos: somaGrupos,   /* 29/10: Alterar fluxo */   /* 28/10: termos de confissão */
    /* o traço do campo em branco (o pré-contrato grifa em vermelho claro) */
    EM_BRANCO: EM_BRANCO,
    /* marcadores cujo valor tem várias linhas: no Docs, o parágrafo que só tem o marcador vira um parágrafo por linha */
    MARCADORES_PARAGRAFOS: ["FORMA_PAGAMENTO_CONDOMINIO", "FIADORES_QUALIFICACAO"],
    /* marcador VAZIO cujo rótulo sai junto: no modelo a linha é
       "Banco: {{BANCO}} – Agência: {{AGENCIA}} – Operação: {{OPERACAO}} – Conta {{CONTA}} – PIX: {{PIX}} - Titularidade…";
       sem Pix (ou sem operação, que a conta da obra não tem) o "– PIX: " / "– Operação: " some, em vez de ficar em branco.
       Valor = regex (sintaxe do findText do Docs) do rótulo que vem ANTES do marcador. */
    TRECHOS_SE_VAZIO: { PIX: "\\s*[–-]\\s*PIX:\\s*", OPERACAO: "\\s*[–-]\\s*Operação:\\s*" }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
