/* FluxoLivre — "Alterar fluxo" da venda do condomínio (pedido do diretor, 29/10/2026).
 *
 * O simulador grava o fluxo em "gavetas" fixas (sinal ato/30/60/90, pré-chaves em 2 partes, 2 balões, pós-chaves,
 * FGTS, financiamento). Para exceções na mesa, a venda pode ter um FLUXO PERSONALIZADO: uma lista livre de linhas
 * { t: tipo, v: valor de cada, n: quantidade, d: 1ª data ISO, i: a cada quantos meses, x: descrição, u: última diferente }.
 * O TIPO decide o reajuste e o inciso do contrato; o resto é livre. Regra do dono: enquanto a soma não bater com o
 * valor da casa AO CENTAVO, não salva. Contrato e Mais Controle leem a mesma lista (etapas 2 e 3).
 *
 * Puro (sem Notion, sem DOM): roda no Apps Script, no navegador (venda-dossie.js) e no node (testes). */
var FluxoLivre = (function () {
  var TIPOS = {
    sinal:    { nome: "Sinal",          inciso: 1, reajuste: "",               terceiro: false },
    entrada:  { nome: "Entrada à vista", inciso: 2, reajuste: "",              terceiro: false },
    pre:      { nome: "Pré-chaves",     inciso: 2, reajuste: "INCC-M",         terceiro: false },
    balao:    { nome: "Balão",          inciso: 3, reajuste: "INCC-M",         terceiro: false },
    /* fixo (dono 29/10): financiamento, FGTS e subsídio só aparecem — não mudam no Alterar fluxo */
    fin:      { nome: "Financiamento",  inciso: 4, reajuste: "",               terceiro: true, fixo: true },
    fgts:     { nome: "FGTS",           inciso: 4, reajuste: "",               terceiro: true, fixo: true },
    subsidio: { nome: "Subsídio",       inciso: 4, reajuste: "",               terceiro: true, fixo: true },
    pos:      { nome: "Pós-chaves",     inciso: 5, reajuste: "IPCA + 1% a.m.", terceiro: false },
    permuta:  { nome: "Permuta",        inciso: 6, reajuste: "",               terceiro: false }
  };
  var ORDEM = ["sinal", "entrada", "pre", "balao", "pos", "permuta", "fin", "fgts", "subsidio"];
  var MAX_LINHAS = 40, MAX_N = 600, MAX_INTERVALO = 24, MAX_DESC = 120, MAX_MOTIVO = 300;
  /* pós-chaves (regras do simulador, proposta.html): só 0, 12 ou 24 parcelas — é o prazo da entrada (24, 36 ou 48
     meses), e a comissão do corretor sai dele; a parcela base é 24 × R$ 788,33 e nunca sobe acima disso. */
  var POS_TETO = 788.33;
  var RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
  var LIMITE_PRE_CHAVES = "2028-11-30";   /* 31/10/2026 (dono): fim das pré-chaves e balões do Reserva dos Ipês */

  function c(v) { return Math.round((Number(v) || 0) * 100); }
  function positivo(v) { return typeof v === "number" && isFinite(v) && v > 0; }
  function isoValida(s) {
    if (!RE_ISO.test(String(s || ""))) return false;
    var p = s.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  /* iso + meses, no mesmo dia (dia 29/30/31 num mês curto cai no último dia, como o simulador) */
  function maisMeses(iso, meses) {
    var p = String(iso).split("-").map(Number), t = p[0] * 12 + (p[1] - 1) + meses;
    var a = Math.floor(t / 12), m = t % 12, ult = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    return a + "-" + ("0" + (m + 1)).slice(-2) + "-" + ("0" + Math.min(p[2], ult)).slice(-2);
  }
  function dataBR(iso) { var p = String(iso || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; }
  function moeda(v) {
    var s = (Math.abs(c(v)) / 100).toFixed(2).split("."), i = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (c(v) < 0 ? "-" : "") + "R$ " + i + "," + s[1];
  }

  /* total de uma linha em centavos: (n-1) × v + última (u, se houver; senão v) */
  function totalLinhaC(l) {
    var n = l.n | 0;
    if (n <= 0) return 0;
    var u = (n > 1 && positivo(l.u)) ? l.u : l.v;
    return c(l.v) * (n - 1) + c(u);
  }
  function somaC(linhas) { return (linhas || []).reduce(function (s, l) { return s + totalLinhaC(l); }, 0); }

  /* Dado de fora (tela ou Notion) → { valor, entrega, linhas } limpo; campos estranhos somem. */
  function normalizar(o) {
    o = o || {};
    var linhas = (Array.isArray(o.linhas) ? o.linhas : []).slice(0, MAX_LINHAS + 1).map(function (l) {
      l = l || {};
      var x = { t: String(l.t || ""), v: Math.round((Number(l.v) || 0) * 100) / 100, n: parseInt(l.n, 10) || 0,
                d: String(l.d || "").slice(0, 10), i: parseInt(l.i, 10) || 1, x: String(l.x || "").replace(/\s+/g, " ").trim() };
      var u = Math.round((Number(l.u) || 0) * 100) / 100;
      if (u > 0 && x.n > 1) x.u = u;
      return x;
    });
    var out = { valor: Math.round((Number(o.valor) || 0) * 100) / 100, entrega: String(o.entrega || "").slice(0, 10), linhas: linhas };
    if (o.semComissao === true) out.semComissao = true;   /* 30/10: desconto "isentar a comissão" = venda direta */
    return out;
  }

  /* { ok, diferenca, erros: [texto], porLinha: { índice: [texto] }, avisos: [texto] } — diferenca = valor − soma
     (positivo = falta). Regra do dono: só a CONTA trava (e linha sem valor/data/tipo); data fora da entrega é AVISO. */
  function validar(f, padrao) {
    f = normalizar(f);
    var erros = [], porLinha = {}, avisos = [];
    function erroLinha(k, msg) { (porLinha[k] = porLinha[k] || []).push(msg); erros.push("Linha " + (k + 1) + ": " + msg); }
    if (!positivo(f.valor)) erros.push("Falta o valor da casa");
    if (!f.linhas.length) erros.push("O fluxo não tem nenhuma linha");
    if (f.linhas.length > MAX_LINHAS) erros.push("No máximo " + MAX_LINHAS + " linhas");
    var entrega = isoValida(f.entrega) ? f.entrega : "";
    f.linhas.slice(0, MAX_LINHAS).forEach(function (l, k) {
      var tp = TIPOS[l.t];
      if (!tp) { erroLinha(k, "tipo inválido"); return; }
      if (!positivo(l.v)) erroLinha(k, "valor tem de ser maior que zero");
      if (l.n < 1 || l.n > MAX_N) erroLinha(k, "quantidade de 1 a " + MAX_N);
      if (l.i < 1 || l.i > MAX_INTERVALO) erroLinha(k, "intervalo de 1 a " + MAX_INTERVALO + " meses");
      if (l.x.length > MAX_DESC) erroLinha(k, "descrição com até " + MAX_DESC + " caracteres");
      if (l.t === "permuta" && !l.x) erroLinha(k, "descreva o bem da permuta");
      if (!isoValida(l.d)) { if (!tp.terceiro) erroLinha(k, "falta a 1ª data"); return; }
      var ultima = maisMeses(l.d, (Math.max(1, l.n) - 1) * l.i);
      /* 31/10/2026 (dono): pré-chaves e balões terminam SEMPRE até 30/11/2028 — passar disso trava */
      if ((l.t === "pre" || l.t === "balao") && ultima > LIMITE_PRE_CHAVES)
        erroLinha(k, tp.nome.toLowerCase() + " vence em " + dataBR(ultima) + ": pré-chaves e balões terminam até " + dataBR(LIMITE_PRE_CHAVES));
      if (entrega && (l.t === "pre" || l.t === "balao") && ultima > entrega)
        avisos.push("Linha " + (k + 1) + ": " + tp.nome.toLowerCase() + " vence depois da entrega das chaves (" + dataBR(ultima) + ")");
      if (entrega && l.t === "pos" && l.d <= entrega) avisos.push("Linha " + (k + 1) + ": pós-chaves vence antes da entrega das chaves");
    });
    /* regras que dependem da proposta (dono 29/10): financiamento/FGTS/subsídio iguais aos da proposta; pós-chaves com
       a MESMA quantidade (o prazo e a comissão não mudam), parcela até o teto e sem começar antes da proposta */
    if (padrao) {
      padrao = normalizar(padrao);
      var fixos = function (ls) {
        return ls.filter(function (l) { return TIPOS[l.t] && TIPOS[l.t].fixo; })
          .map(function (l) { return l.t + ":" + totalLinhaC(l); }).sort().join("|");
      };
      if (fixos(f.linhas) !== fixos(padrao.linhas)) erros.push("Financiamento, FGTS e subsídio não mudam — ficam como na proposta");
      var qtd = function (ls) { return ls.reduce(function (s, l) { return s + (l.t === "pos" ? Math.max(0, l.n) : 0); }, 0); };
      var qP = qtd(padrao.linhas), q = qtd(f.linhas);
      if (q !== qP) erros.push(qP ? "Pós-chaves: tem de continuar com " + qP + " parcelas (o prazo da proposta; a comissão sai dele)"
                                  : "Esta venda não tem pós-chaves (prazo da proposta de 24 meses)");
      var tetoPos = POS_TETO, iniPos = "";
      padrao.linhas.forEach(function (l) {
        if (l.t !== "pos") return;
        tetoPos = Math.max(tetoPos, l.v, l.u || 0);
        if (isoValida(l.d) && (!iniPos || l.d < iniPos)) iniPos = l.d;
      });
      f.linhas.slice(0, MAX_LINHAS).forEach(function (l, k) {
        if (l.t !== "pos") return;
        if (c(l.v) > c(tetoPos) || c(l.u || 0) > c(tetoPos)) erroLinha(k, "parcela pós-chaves acima do teto de " + moeda(tetoPos));
        if (iniPos && isoValida(l.d) && l.d < iniPos) erroLinha(k, "pós-chaves não pode começar antes de " + dataBR(iniPos));
      });
    }
    var dif = c(f.valor) - somaC(f.linhas);
    if (dif !== 0) erros.unshift((dif > 0 ? "Faltam " : "Sobram ") + moeda(Math.abs(dif) / 100) + " para fechar com o valor da casa");
    return { ok: !erros.length, diferenca: dif / 100, erros: erros, porLinha: porLinha, avisos: avisos };
  }

  /* Atalho "Redistribuir": a linha k absorve a diferença inteira; os centavos que sobram vão na última parcela dela.
     { linhas } ou { erro }. */
  function redistribuir(f, k) {
    f = normalizar(f);
    var l = f.linhas[k];
    if (!l) return { erro: "Linha inexistente" };
    var alvo = c(f.valor) - (somaC(f.linhas) - totalLinhaC(l));
    if (alvo < Math.max(1, l.n)) return { erro: "Essa linha ficaria zerada ou negativa — ajuste outra linha" };
    var linhas = f.linhas.slice();
    linhas[k] = comTotal(l, alvo);
    return { linhas: linhas };
  }

  /* ---- 30/10: desconto no "Alterar fluxo" (decisões do dono, arquivo 17 item 1) ----
   * Quem dá o desconto (FLUXO_PRECO_USUARIOS) escolhe de onde ele sai:
   *   "entrada": proporcional nas linhas da entrada (Entrada à vista, pré-chaves, balões e pós-chaves);
   *   "baloes":  dos balões primeiro, do último para o primeiro; o que sobrar sai das pré-chaves (também da última);
   *   "pre":     proporcional nas pré-chaves.
   * Sinal, financiamento, FGTS, subsídio e permuta não mudam. O valor da casa cai o mesmo tanto, então a soma continua
   * batendo ao centavo. Uma linha que o desconto zera inteira sai da lista (um balão que some, por exemplo).
   * { valor, linhas } ou { erro }. */
  var DESCONTO_DE = { entrada: ["entrada", "pre", "balao", "pos"], baloes: ["balao", "pre"], pre: ["pre"] };
  /* a linha com outro total (centavos): a cada parcela igual, o resto vai na última (como o Redistribuir) */
  function comTotal(l, alvo) {
    var n = Math.max(1, l.n), cada = Math.floor(alvo / n), resto = alvo - cada * n;
    var nova = { t: l.t, v: cada / 100, n: n, d: l.d, i: l.i, x: l.x };
    if (resto && n > 1) nova.u = (cada + resto) / 100;
    else if (resto) nova.v = (cada + resto) / 100;
    return nova;
  }
  function aplicarDesconto(f, valorDesconto, de) {
    f = normalizar(f);
    var D = c(valorDesconto), tipos = DESCONTO_DE[de];
    if (!tipos) return { erro: "Escolha de onde sai o desconto" };
    if (D <= 0) return { erro: "Informe o desconto (maior que zero)" };
    if (D >= c(f.valor)) return { erro: "O desconto não pode ser maior que o valor da casa" };
    var alvos = [];
    f.linhas.forEach(function (l, k) { if (tipos.indexOf(l.t) >= 0 && totalLinhaC(l) > 0) alvos.push(k); });
    var cabe = alvos.reduce(function (s, k) { return s + totalLinhaC(f.linhas[k]); }, 0);
    var nomes = { entrada: "nas parcelas da entrada", baloes: "nos balões e nas pré-chaves", pre: "nas pré-chaves" }[de];
    if (D > cabe) return { erro: "O desconto (" + moeda(D / 100) + ") passa do que existe " + nomes + " (" + moeda(cabe / 100) + ")" };
    var corte = {};                                   /* índice da linha → centavos que saem dela */
    if (de === "baloes") {
      /* do último para o primeiro: balões por data (mais tarde primeiro), depois as pré-chaves também de trás para frente */
      var ult = function (k) { var l = f.linhas[k]; return isoValida(l.d) ? maisMeses(l.d, (Math.max(1, l.n) - 1) * l.i) : ""; };
      var ordem = alvos.slice().sort(function (a, b) {
        var ta = f.linhas[a].t === "balao" ? 0 : 1, tb = f.linhas[b].t === "balao" ? 0 : 1;
        return ta - tb || ult(b).localeCompare(ult(a)) || b - a;
      });
      var falta = D;
      ordem.forEach(function (k) { var s = Math.min(falta, totalLinhaC(f.linhas[k])); if (s) corte[k] = s; falta -= s; });
    } else {
      /* proporcional ao total de cada linha; os centavos do arredondamento saem da maior */
      var dado = 0, maior = alvos[0];
      alvos.forEach(function (k) {
        var t = totalLinhaC(f.linhas[k]);
        if (t > totalLinhaC(f.linhas[maior])) maior = k;
        corte[k] = Math.floor(D * t / cabe); dado += corte[k];
      });
      corte[maior] += D - dado;
    }
    var linhas = [];
    f.linhas.forEach(function (l, k) {
      if (!corte[k]) { linhas.push(l); return; }
      var alvo = totalLinhaC(l) - corte[k];
      if (alvo <= 0) return;                          /* zerou: a linha sai */
      if (alvo < Math.max(1, l.n)) { linhas.push({ t: l.t, v: alvo / 100, n: 1, d: l.d, i: l.i, x: l.x }); return; }
      linhas.push(comTotal(l, alvo));
    });
    return { valor: (c(f.valor) - D) / 100, linhas: linhas };
  }
  /* quanto é o desconto em R$: { modo: "rs" | "pct" | "isentar", valor (R$ ou %), comissao (R$, para isentar) } sobre o
     valor da casa. { valor } ou { erro }. */
  function valorDoDesconto(valorCasa, o) {
    o = o || {};
    if (o.modo === "isentar") {
      if (!positivo(o.comissao)) return { erro: "Esta venda não tem comissão para isentar" };
      return { valor: c(o.comissao) / 100 };
    }
    var n = Number(o.valor) || 0;
    if (!(n > 0)) return { erro: "Informe o desconto (maior que zero)" };
    if (o.modo === "pct") {
      if (n >= 100) return { erro: "Percentual de desconto tem de ser menor que 100%" };
      return { valor: Math.round(c(valorCasa) * n / 100) / 100 };
    }
    if (o.modo === "rs") return { valor: c(n) / 100 };
    return { erro: "Escolha R$, % ou isentar a comissão" };
  }

  /* Gavetas do simulador (fluxo como o GerarContrato lê) → lista. excedente = parte do VALOR PARA ENTRADA da
     proposta que passa do sinal (paga na assinatura, sem correção — ContratoVenda.parcelasPreChaves). */
  function doPadrao(fl, excedente) {
    fl = fl || {};
    var L = [], ass = isoValida(fl.assinatura) ? fl.assinatura : "";
    function um(t, v, d) { if (positivo(v)) L.push({ t: t, v: v, n: 1, d: isoValida(d) ? d : "", i: 1, x: "" }); }
    function serie(t, n, v, d) { if (positivo(n) && positivo(v)) L.push({ t: t, v: v, n: n | 0, d: isoValida(d) ? d : "", i: 1, x: "" }); }
    um("sinal", fl.sinalAto, ass);
    um("sinal", fl.sinal30, fl.data30);
    um("sinal", fl.sinal60, fl.data60);
    um("sinal", fl.sinal90, fl.data90);
    um("entrada", excedente, ass);
    serie("pre", fl.pre1N, fl.pre1Valor, fl.pre1Data);
    serie("pre", fl.pre2N, fl.pre2Valor, fl.pre2Data);
    um("balao", fl.balao1Valor, fl.balao1Data);
    um("balao", fl.balao2Valor, fl.balao2Data);
    serie("pos", fl.posN, fl.posValor, fl.posData);
    um("fin", fl.credito, "");
    um("fgts", fl.fgts, "");
    um("subsidio", fl.subsidio, "");
    return { valor: positivo(fl.valorVenda) ? fl.valorVenda : 0, entrega: isoValida(fl.entrega) ? fl.entrega : "", linhas: L };
  }

  /* Cada parcela, em ordem de vencimento: [{ tipo, rotulo, valor, data, reajuste, descricao }] (prévia e robô). */
  function expandir(linhas) {
    var out = [];
    (linhas || []).forEach(function (l) {
      var tp = TIPOS[l.t], n = l.n | 0;
      if (!tp || n <= 0) return;
      for (var j = 0; j < n; j++) {
        var v = (j === n - 1 && n > 1 && positivo(l.u)) ? l.u : l.v;
        out.push({ tipo: l.t, rotulo: n > 1 ? tp.nome + " " + (j + 1) + "/" + n : tp.nome, valor: v,
                   data: isoValida(l.d) ? maisMeses(l.d, j * (l.i || 1)) : "", reajuste: tp.reajuste, descricao: l.x || "" });
      }
    });
    return out.sort(function (a, b) { return (a.data || "9999").localeCompare(b.data || "9999"); });
  }

  /* Texto curto e estável para gravar no Notion (e comparar): só valor, entrega e linhas, chaves curtas. */
  function serializar(f) {
    f = normalizar(f);
    var o = { v: 1, valor: f.valor, entrega: f.entrega, linhas: f.linhas };
    if (f.semComissao) o.semComissao = true;
    return JSON.stringify(o);
  }
  function ler(s) {
    if (!s || typeof s !== "string") return null;
    try { var o = JSON.parse(s); return o && Array.isArray(o.linhas) ? normalizar(o) : null; } catch (e) { return null; }
  }
  /* ordem de exibição sugerida (a tela mantém a ordem da pessoa; isto é para "Voltar ao fluxo da proposta") */
  function ordenar(linhas) {
    return (linhas || []).slice().sort(function (a, b) {
      var x = ORDEM.indexOf(a.t) - ORDEM.indexOf(b.t);
      return x || String(a.d || "").localeCompare(String(b.d || ""));
    });
  }

  return { TIPOS: TIPOS, ORDEM: ORDEM, MAX_LINHAS: MAX_LINHAS, MAX_MOTIVO: MAX_MOTIVO, POS_TETO: POS_TETO, LIMITE_PRE_CHAVES: LIMITE_PRE_CHAVES,
           normalizar: normalizar, validar: validar, redistribuir: redistribuir, aplicarDesconto: aplicarDesconto, valorDoDesconto: valorDoDesconto, doPadrao: doPadrao, expandir: expandir,
           serializar: serializar, ler: ler, ordenar: ordenar, totalLinha: function (l) { return totalLinhaC(normalizar({ linhas: [l] }).linhas[0] || {}) / 100; },
           soma: function (linhas) { return somaC(normalizar({ linhas: linhas }).linhas) / 100; }, maisMeses: maisMeses, moeda: moeda, dataBR: dataBR };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FluxoLivre;
