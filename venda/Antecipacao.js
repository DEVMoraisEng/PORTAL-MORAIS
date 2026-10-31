/* Antecipação de parcelas do condomínio (spec v2, 31/10/2026). Puro: sem rede, sem Notion.
   A mesma conta roda no navegador (tela do portal) e nos testes. O robô confere de novo antes de gravar (2ª metade). */
var Antecipacao = (function () {
  var CONTA = { pre: 1, balao: 1, pos: 1 };
  var LIMITE_EXTRA = 0.05;   // ajuste de centavo: parcela que o cliente não escolheu cai no máximo 5 centavos
  function c(x) { return Math.round((Number(x) + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function valorDe(raw, f) { return c(raw * f); }
  function elegivel(p, dataPg) { return !!CONTA[p.tipo] && !p.pago && !p.parcial && p.data >= dataPg; }
  /* Ordem estável: data, depois tipo, depois id; 0 só quando é a mesma parcela. */
  function ordem(a, b) {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    if (a.tipo !== b.tipo) return a.tipo < b.tipo ? -1 : 1;
    var ia = String(a.id), ib = String(b.id);
    return ia === ib ? 0 : (ia < ib ? -1 : 1);
  }

  function lerValor(t) {
    var s = String(t == null ? "" : t).trim().replace(/^R\$\s*/, "");
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return null;
    var n = /,/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : (/^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number(s));
    return n > 0 ? c(n) : null;
  }

  function situacao(r, dataPg) {
    var el = [], venc = [];
    (r.parcelas || []).forEach(function (p) {
      if (!CONTA[p.tipo] || p.pago || p.parcial) return;
      if (p.data < dataPg) venc.push({ id: p.id, data: p.data, valor: p.valor });
      else el.push(p);
    });
    var bal = el.filter(function (p) { return p.tipo === "balao"; }).map(function (p) { return { id: p.id, data: p.data, valor: p.valor, raw: p.raw }; });
    var pos = el.filter(function (p) { return p.tipo === "pos"; });
    return { saldo: c(el.reduce(function (s, p) { return s + p.valor; }, 0)), elegiveis: el, vencidas: venc,
             temPos: pos.length > 0, posAbertas: pos.length, balaoes: bal };
  }

  function base(r, dataPg) {
    var ids = {};
    situacao(r, dataPg).elegiveis.forEach(function (p) { ids[p.id] = true; });
    return (r.parcelas || []).map(function (p) {
      return { id: p.id, data: p.data, tipo: p.tipo, raw: p.raw, rawAntes: p.raw, valor: p.valor, valorAntes: p.valor,
               fator: p.fator, acao: "igual", conta: !!ids[p.id] };
    });
  }

  /* Ajusta o valor de contrato até a soma corrigida bater ao centavo. Com fator > 1, mexer 0,01 no valor de contrato
     pode pular 2 centavos no corrigido; por isso entram "extras" (parcelas vizinhas que só podem DIMINUIR, trava 3,
     e no máximo LIMITE_EXTRA de valor corrigido). `alvo` = soma corrigida desejada de mudadas + extras. */
  function fechar(mudadas, alvo, extras) {
    var todas = mudadas.concat(extras || []).filter(function (p) { return p.acao !== "quita"; });
    if (!todas.length) return Math.abs(alvo) < 0.005;
    var piso = todas.map(function (p, i) { return i < mudadas.length ? -Infinity : c(p.valorAntes - LIMITE_EXTRA); });
    var pode = function (i, novo) {
      var p = todas[i];
      return novo >= 0.01 && novo <= p.rawAntes && valorDe(novo, p.fator) >= piso[i] - 0.0001;
    };
    var inicio = todas.map(function (p) { return { raw: p.raw, valor: p.valor, acao: p.acao }; });
    for (var volta = 0; volta < 40 * todas.length; volta++) {   // 1º: só passos que aproximam
      var dif = c(alvo - somaV(todas));
      if (Math.abs(dif) < 0.005) return true;
      var melhor = null;
      todas.forEach(function (p, i) {
        [0.01, -0.01].forEach(function (passo) {
          var novo = c(p.raw + passo);
          if (!pode(i, novo)) return;
          var nd = Math.abs(c(dif - (valorDe(novo, p.fator) - p.valor)));
          if (nd < Math.abs(dif) - 0.004 && (!melhor || nd < melhor.nd)) melhor = { p: p, novo: novo, nd: nd };
        });
      });
      if (!melhor) break;
      melhor.p.raw = melhor.novo; melhor.p.valor = valorDe(melhor.novo, melhor.p.fator);
      melhor.p.acao = melhor.p.raw === melhor.p.rawAntes ? "igual" : "reduz";
    }
    todas.forEach(function (p, i) { p.raw = inicio[i].raw; p.valor = inicio[i].valor; p.acao = inicio[i].acao; });
    return grade(todas.slice(0, 4), pode, c(alvo - somaV(todas.slice(4))));   // 2º: grade em volta do ponto de partida
  }

  /* Plano B do ajuste: procura em grade ±5 centavos no valor de contrato de até 4 parcelas (no máximo 11^4 contas). */
  function grade(ps, pode, alvo) {
    var base = ps.map(function (p) { return p.raw; }), achou = null;
    (function tenta(i, soma) {
      if (achou) return;
      if (i === ps.length) { if (Math.abs(c(alvo - soma)) < 0.005) achou = ps.map(function (p) { return p.raw; }); return; }
      var p = ps[i];
      for (var d = -5; d <= 5 && !achou; d++) {
        var novo = c(base[i] + d / 100);
        if (!pode(i, novo)) continue;
        p.raw = novo; tenta(i + 1, soma + valorDe(novo, p.fator));
      }
      if (!achou) p.raw = base[i];
    })(0, 0);
    ps.forEach(function (p, i) {
      p.raw = achou ? achou[i] : base[i]; p.valor = valorDe(p.raw, p.fator);
      p.acao = p.raw === p.rawAntes ? "igual" : "reduz";
    });
    return !!achou;
  }

  /* Até 3 parcelas que ficam iguais, vizinhas da divisa, para o ajuste de centavo (desempate estável). */
  function vizinhas(lista, p) {
    var t = Date.parse(p.data);
    return lista.filter(function (x) { return x !== p && x.acao === "igual"; })
      .sort(function (a, b) { return (Math.abs(Date.parse(a.data) - t) - Math.abs(Date.parse(b.data) - t)) || ordem(a, b); })
      .slice(0, 3);
  }
  function somaV(l) { return c(l.reduce(function (s, p) { return s + p.valor; }, 0)); }

  function reduzir(p, novoValor) {
    if (novoValor <= 0.004) { p.acao = "quita"; p.raw = 0; p.valor = 0; return; }
    p.acao = "reduz"; p.raw = c(novoValor / p.fator); p.valor = valorDe(p.raw, p.fator);
  }

  /* A (próximas) e C (de trás): a data manda; no empate, tipo e id em ordem crescente nos dois sentidos. */
  function emOrdem(lista, valor, desc) {
    var ord = lista.slice().sort(function (a, b) { return desc && a.data !== b.data ? (a.data < b.data ? 1 : -1) : ordem(a, b); });
    var resto = valor, divisa = null;
    for (var i = 0; i < ord.length && resto > 0.004; i++) {
      var p = ord[i];
      if (resto >= p.valor - 0.004) { resto = c(resto - p.valor); reduzir(p, 0); }
      else { var alvo = c(p.valorAntes - resto); reduzir(p, alvo); divisa = { p: p, alvo: alvo }; resto = 0; }
    }
    if (!divisa) return true;
    var ex = vizinhas(lista, divisa.p);
    return fechar([divisa.p], c(divisa.alvo + somaV(ex)), ex);
  }

  function simular(r, o) {
    o = o || {};
    var dataPg = o.dataPg;
    if (typeof dataPg !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dataPg)) return { ok: false, erro: "DATA_INVALIDA" };
    if (!/^[ABCDE]$/.test(String(o.modo))) return { ok: false, erro: "MODO_INVALIDO" };
    var sit = situacao(r, dataPg);
    if (sit.elegiveis.some(function (p) { return valorDe(p.raw, p.fator) !== p.valor; })) return { ok: false, erro: "RETRATO_INCOERENTE" };
    // `conta` em ordem canônica: o resultado não pode depender da ordem em que o ERP mandou as parcelas
    var depois = base(r, dataPg), conta = depois.filter(function (p) { return p.conta; }).sort(ordem);
    var saldo = sit.saldo, valor = null;
    if (o.modo !== "E") {
      valor = typeof o.valor === "number" || typeof o.valor === "string" ? Number(o.valor) : NaN;
      // mais de 2 casas = sobra de verdade (≥ 0,001), não ruído de ponto flutuante como 0.1 + 0.2
      if (!Number.isFinite(valor) || !(valor > 0) || Math.abs(c(valor) - valor) > 1e-7) return { ok: false, erro: "VALOR_INVALIDO" };
      valor = c(valor);
      if (valor > saldo + 0.004) return { ok: false, erro: "VALOR_ACIMA_DO_SALDO" };
    }
    var fechou = true;
    if (o.modo === "A" || o.modo === "C") fechou = emOrdem(conta, valor, o.modo === "C");
    else if (o.modo === "B") {
      var k = (saldo - valor) / saldo, alvoB = c(saldo - valor);
      conta.forEach(function (p) { reduzir(p, c(p.valorAntes * k)); });
      fechou = fechar(conta.filter(function (p) { return p.acao === "reduz"; }), alvoB);
    } else if (o.modo === "D") {
      var alvoP = conta.filter(function (p) { return p.id === o.parcelaId; })[0];
      if (!alvoP) return { ok: false, erro: "PARCELA_INVALIDA" };
      if (valor > alvoP.valorAntes + 0.004) return { ok: false, erro: "VALOR_ACIMA_DO_SALDO" };
      // só a parcela escolhida muda, e cai exatamente o valor pago; senão NAO_FECHA com sugestão
      var resto = c(alvoP.valorAntes - valor); reduzir(alvoP, resto);
      fechou = alvoP.acao === "quita" || fechar([alvoP], resto, []);
    } else {   // E
      var pos = conta.filter(function (p) { return p.tipo === "pos"; }).sort(ordem);
      if (!pos.length) return { ok: false, erro: "SEM_POS_CHAVES" };
      var n = pos.length;
      if (o.quantas != null) {
        if (typeof o.quantas !== "number" || !Number.isInteger(o.quantas) || o.quantas < 1 || o.quantas > pos.length)
          return { ok: false, erro: "QUANTAS_INVALIDA" };
        n = o.quantas;
      }
      var sai = pos.slice(pos.length - n);
      valor = c(sai.reduce(function (s, p) { return s + p.valor; }, 0));
      sai.forEach(function (p) { reduzir(p, 0); });
    }
    if (!fechou) {   /* raro: nenhum valor de contrato dá o corrigido exato. Sugere o valor vizinho que fecha. */
      var sug = [];
      if (!o.semSugestao) [0.01, -0.01, 0.02, -0.02, 0.03, -0.03].forEach(function (d) {
        var o2 = {}; for (var q in o) o2[q] = o[q]; o2.valor = c(valor + d); o2.semSugestao = true;
        if (sug.length < 2 && o2.valor > 0 && simular(r, o2).ok) sug.push(o2.valor);
      });
      return { ok: false, erro: "NAO_FECHA", sugestoes: sug };
    }
    var ids = {};
    depois.forEach(function (p) { if (p.conta) ids[p.id] = true; delete p.conta; });
    var res = { ok: true, modo: o.modo, valor: valor, dataPg: dataPg, depois: depois };
    res.travas = travas(r, res);
    if (res.travas.length) return { ok: false, erro: "TRAVA", travas: res.travas };
    // resumo: só o que estava em aberto antes (nunca uma parcela já paga, parcial ou vencida)
    var abertas = depois.filter(function (p) { return ids[p.id] && p.acao !== "quita"; }).sort(ordem);
    res.resumo = { proximo: abertas.length ? { data: abertas[0].data, valor: abertas[0].valor } : null,
                   ultimo: abertas.length ? { data: abertas[abertas.length - 1].data, valor: abertas[abertas.length - 1].valor } : null };
    return res;
  }

  /* As 5 travas da spec. Recebe o retrato de antes e o resultado; devolve os motivos (vazio = ok).
     1 = conjunto de parcelas (nova, sumiu, repetida); 2 = data; 3 = valor (subiu, fator, coerência, ação, fora da conta);
     4 = tipo; 5 = saldo (valor da antecipação, data, soma ao centavo). */
  function travas(r, res) {
    var antes = {}, vistos = {}, out = [];
    var parcelas = (r && r.parcelas) || [];
    parcelas.forEach(function (p) { antes[p.id] = p; });
    if (!res || !Array.isArray(res.depois)) return ["1 · resultado sem lista de parcelas"];
    var dataPg = res.dataPg, valorOk = typeof res.valor === "number" && Number.isFinite(res.valor) && res.valor > 0;
    if (typeof dataPg !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dataPg)) out.push("5 · data do pagamento inválida: " + dataPg);
    if (!valorOk) out.push("5 · valor da antecipação inválido: " + res.valor);
    var saldoAntes = situacao(r, dataPg).saldo, saldoDepois = 0;
    res.depois.forEach(function (p) {
      var a = antes[p.id];
      if (!a) { out.push("1 · parcela nova " + p.data); return; }
      if (vistos[p.id]) { out.push("1 · parcela repetida " + a.data); return; }
      vistos[p.id] = true;
      if (p.data !== a.data) out.push("2 · data mudou " + a.data + " → " + p.data);
      if (p.raw > a.raw + 0.004 || p.valor > a.valor + 0.004) out.push("3 · valor subiu " + p.data);
      if (p.tipo !== a.tipo) out.push("4 · " + a.tipo + " virou " + p.tipo + " " + p.data);
      if (p.fator !== a.fator) out.push("3 · fator mudou " + a.data);
      var coerente = p.acao === "quita" ? (p.raw === 0 && p.valor === 0)
        : p.acao === "igual" ? (p.raw === a.raw && p.valor === a.valor)
        : p.acao === "reduz" ? (p.raw > 0 && p.raw < a.raw && p.valor === valorDe(p.raw, a.fator))
        : false;
      if (!coerente) out.push("3 · ação '" + p.acao + "' não bate com valor de contrato × fator " + a.data);
      var eleg = elegivel(a, dataPg);
      if (!eleg && (p.acao !== "igual" || p.raw !== a.raw || p.valor !== a.valor))
        out.push("3 · parcela fora da conta (paga, parcial, vencida ou " + a.tipo + ") mudou " + a.data);
      if (eleg && p.acao !== "quita") saldoDepois += p.valor;
    });
    parcelas.forEach(function (p) { if (!vistos[p.id]) out.push("1 · parcela sumiu " + p.data); });
    if (valorOk && Math.abs(c(saldoAntes - res.valor - saldoDepois)) >= 0.005)
      out.push("5 · saldo não fecha: " + saldoAntes.toFixed(2) + " ≠ " + res.valor.toFixed(2) + " + " + c(saldoDepois).toFixed(2));
    return out;
  }

  return { lerValor: lerValor, situacao: situacao, simular: simular, travas: travas };
})();
if (typeof module !== "undefined") module.exports = Antecipacao;
