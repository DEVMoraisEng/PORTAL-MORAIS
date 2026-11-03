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
    /* 31/10/2026 (dono): a pré-reserva paga é a 1ª parcela do sinal, já recebida — fixa no Alterar fluxo */
    prereserva: { nome: "Pré-reserva (paga)", inciso: 1, reajuste: "",           terceiro: false, fixo: true },
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
  var ORDEM = ["prereserva", "sinal", "entrada", "pre", "balao", "pos", "permuta", "fin", "fgts", "subsidio"];
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

  /* ---- 03/11/2026 (dono): dados do bem da PERMUTA ----
   * "quando tiver permuta, hora que salvar, pede para quem tiver preenchendo colocar as informações da permuta; se for
   * automóvel, colocar os dados básicos que um contrato de permuta pede". A linha de permuta ganha l.b (o bem):
   *   veículo: { tipo: "veiculo", marca, modelo, anoFab, anoModelo, cor, placa, renavam, chassi, propNome, propDoc,
   *              situacao: "quitado" | "alienado", credor, saldo, quitaPor, obs }
   *   imóvel:  { tipo: "imovel", endereco, matricula, cartorio, propNome, propDoc, onus }
   *   outro:   { tipo: "outro", descricao }
   * A data da entrega do bem é a 1ª data da própria linha (l.d) — a mesma do lançamento de entrada no Mais Controle.
   * l.x continua existindo e passa a ser o RESUMO do bem (gerado aqui): a tela, o quadro do pro soluto e o comentário
   * "Permuta - …" do Mais Controle (venda/mc/condominio.py) leem l.x como antes.
   * Fluxo antigo: linha de permuta SEM l.b que já estava gravada igual (valor, quantidade, data e descrição) continua
   * salvando; permuta nova ou mexida exige o bem completo (validar, 3º argumento = o fluxo gravado antes). */
  var TIPOS_BEM = { veiculo: "veículo", imovel: "imóvel", outro: "outro" };
  var QUITA_PADRAO = "o COMPRADOR, antes da entrega";
  var RE_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, RE_CHASSI = /^[A-HJ-NPR-Z0-9]{17}$/;
  function so(v, max) { return String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 120); }
  function digitos(v) { return String(v === null || v === undefined ? "" : v).replace(/\D/g, ""); }
  function todosIguais(d) { return /^(\d)\1*$/.test(d); }
  function cpfOk(d) {
    if (d.length !== 11 || todosIguais(d)) return false;
    for (var t = 9; t < 11; t++) {
      var s = 0;
      for (var i = 0; i < t; i++) s += Number(d.charAt(i)) * (t + 1 - i);
      if ((s * 10 % 11) % 10 !== Number(d.charAt(t))) return false;
    }
    return true;
  }
  function cnpjOk(d) {
    if (d.length !== 14 || todosIguais(d)) return false;
    var p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6].concat(p1);
    function dv(pesos) { var s = 0; pesos.forEach(function (p, i) { s += Number(d.charAt(i)) * p; }); var r = s % 11; return r < 2 ? 0 : 11 - r; }
    return dv(p1) === Number(d.charAt(12)) && dv(p2) === Number(d.charAt(13));
  }
  /* CPF (11) ou CNPJ (14), pelos dígitos verificadores */
  function docValido(v) { var d = digitos(v); return d.length === 11 ? cpfOk(d) : d.length === 14 ? cnpjOk(d) : false; }
  function docFormatado(v) {
    var d = digitos(v);
    if (d.length === 11) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
    if (d.length === 14) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
    return d;
  }
  /* RENAVAM: 11 dígitos (o antigo, de 9, com zeros à esquerda); dígito = (soma dos 10 primeiros × 3,2,9,8,7,6,5,4,3,2) × 10 mod 11, 10 vira 0 */
  /* mais de 11 dígitos não é cortado: fica como veio (até 20) e a validação recusa */
  function renavamNormal(v) { var d = digitos(v); return d.length === 9 || d.length === 10 ? ("00" + d).slice(-11) : d.slice(0, 20); }
  function renavamValido(v) {
    var d = renavamNormal(v);
    if (d.length !== 11) return false;
    var pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2], s = 0;
    for (var i = 0; i < 10; i++) s += Number(d.charAt(i)) * pesos[i];
    return (s * 10) % 11 % 10 === Number(d.charAt(10));
  }
  /* placa e chassi: maiúsculas, sem traço/espaço; o excesso NÃO é cortado (fica até 10/25 e a validação recusa) */
  function placaNormal(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); }
  function placaValida(v) { return RE_PLACA.test(placaNormal(v)); }
  function chassiNormal(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 25); }
  function chassiValido(v) { return RE_CHASSI.test(chassiNormal(v)); }
  function inteiro(v) { var d = digitos(v); return d ? Number(d) : null; }
  /* bem de fora (tela ou Notion) → limpo; só os campos do tipo; null se não veio nada */
  function normalizarBem(b) {
    if (!b || typeof b !== "object") return null;
    var tipo = String(b.tipo || "");
    if (!TIPOS_BEM.hasOwnProperty(tipo)) return { tipo: so(tipo, 20) };
    var o = { tipo: tipo };
    if (tipo === "veiculo") {
      o.marca = so(b.marca, 40); o.modelo = so(b.modelo, 60);
      o.anoFab = inteiro(String(b.anoFab || "").slice(0, 4)) || 0; o.anoModelo = inteiro(String(b.anoModelo || "").slice(0, 4)) || 0;
      o.cor = so(b.cor, 30); o.placa = placaNormal(b.placa); o.renavam = renavamNormal(b.renavam); o.chassi = chassiNormal(b.chassi);
      /* dono 03/11: sem quilometragem — o km de um bem gravado antes é ignorado */
      o.propNome = so(b.propNome, 120); o.propDoc = digitos(b.propDoc).slice(0, 14);
      o.situacao = b.situacao === "quitado" || b.situacao === "alienado" ? b.situacao : "";
      if (o.situacao === "alienado") {
        o.credor = so(b.credor, 120);
        o.saldo = Math.round((Number(b.saldo) || 0) * 100) / 100;
        o.quitaPor = so(b.quitaPor, 120) || QUITA_PADRAO;
      }
      o.obs = so(b.obs, 300);
    } else if (tipo === "imovel") {
      o.endereco = so(b.endereco, 300); o.matricula = so(b.matricula, 40); o.cartorio = so(b.cartorio, 120);
      o.propNome = so(b.propNome, 120); o.propDoc = digitos(b.propDoc).slice(0, 14); o.onus = so(b.onus, 300) || "nenhum";
    } else {
      o.descricao = so(b.descricao, 600);
    }
    return o;
  }
  /* o que falta ou está errado no bem (já normalizado): [texto curto] */
  function faltasBem(b) {
    if (!b || !TIPOS_BEM.hasOwnProperty(b.tipo)) return ["escolha o tipo do bem (veículo, imóvel ou outro)"];
    var f = [];
    function prop() {
      if (!b.propNome) f.push("nome do proprietário atual");
      if (!b.propDoc) f.push("CPF ou CNPJ do proprietário");
      else if (!docValido(b.propDoc)) f.push("CPF ou CNPJ do proprietário inválido");
    }
    if (b.tipo === "veiculo") {
      var hoje = new Date().getFullYear();
      if (!b.marca) f.push("marca");
      if (!b.modelo) f.push("modelo");
      if (!b.anoFab) f.push("ano de fabricação");
      else if (b.anoFab < 1950 || b.anoFab > hoje + 1) f.push("ano de fabricação inválido");
      if (!b.anoModelo) f.push("ano do modelo");
      else if (b.anoFab && (b.anoModelo < b.anoFab || b.anoModelo > b.anoFab + 1)) f.push("ano do modelo: o de fabricação ou o seguinte");
      if (!b.cor) f.push("cor");
      if (!b.placa) f.push("placa");
      else if (!RE_PLACA.test(b.placa)) f.push("placa inválida (ABC1234 ou ABC1D23)");
      if (!b.renavam) f.push("RENAVAM");
      else if (!renavamValido(b.renavam)) f.push("RENAVAM inválido (11 dígitos, confira o último)");
      if (!b.chassi) f.push("chassi");
      else if (!RE_CHASSI.test(b.chassi)) f.push("chassi com 17 letras e números, sem I, O e Q");
      prop();
      if (!b.situacao) f.push("situação: quitado ou alienado/financiado");
      if (b.situacao === "alienado") {
        if (!b.credor) f.push("instituição credora");
        if (!positivo(b.saldo)) f.push("saldo devedor estimado");
      }
    } else if (b.tipo === "imovel") {
      if (b.endereco.length < 10) f.push("endereço completo do imóvel");
      if (!b.matricula) f.push("matrícula");
      if (!b.cartorio) f.push("cartório de registro de imóveis (CRI)");
      prop();
    } else if (b.descricao.length < 20) f.push("descrição detalhada do bem (no mínimo 20 letras)");
    return f;
  }
  /* o fluxo sem os dados do bem (fica o resumo em x) — para o histórico, que não guarda CPF/RENAVAM/chassi */
  function semDadosDoBem(f) {
    f = normalizar(f);
    f.linhas = f.linhas.map(function (l) {
      if (!l.b) return l;
      var x = {}; Object.keys(l).forEach(function (k) { if (k !== "b") x[k] = l[k]; }); return x;
    });
    return f;
  }
  /* resumo curto (até MAX_DESC): "Hyundai HB20 2019/2020 placa ABC1D23" — descrição da linha e comentário do Mais Controle */
  function resumoBem(b) {
    if (!b || !TIPOS_BEM.hasOwnProperty(b.tipo)) return "";
    var s = "";
    if (b.tipo === "veiculo") {
      var ano = b.anoFab ? (b.anoModelo && b.anoModelo !== b.anoFab ? b.anoFab + "/" + b.anoModelo : String(b.anoFab)) : "";
      s = [b.marca, b.modelo, ano].filter(function (x) { return x; }).join(" ") + (b.placa ? " placa " + b.placa : "");
    } else if (b.tipo === "imovel") {
      s = b.matricula || b.endereco ? "imóvel" + (b.matricula ? " matrícula " + b.matricula : "") + (b.endereco ? " (" + b.endereco + ")" : "") : "";
    } else s = b.descricao;
    s = s.replace(/\s+/g, " ").trim();
    return s.length > MAX_DESC ? s.slice(0, MAX_DESC - 1).trim() + "…" : s;
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
      /* 03/11: o bem da permuta (só em linha de permuta); a descrição passa a ser o resumo dele */
      if (x.t === "permuta" && l.b) {
        x.b = normalizarBem(l.b);
        var rs = resumoBem(x.b);
        if (rs) x.x = rs;
      }
      return x;
    });
    var out = { valor: Math.round((Number(o.valor) || 0) * 100) / 100, entrega: String(o.entrega || "").slice(0, 10), linhas: linhas };
    if (isoValida(o.assinatura)) out.assinatura = o.assinatura;   /* 31/10: início dos prazos do sinal (não é gravado) */
    if (o.semComissao === true) out.semComissao = true;   /* 30/10: desconto "isentar a comissão" = venda direta */
    return out;
  }

  /* { ok, diferenca, erros: [texto], porLinha: { índice: [texto] }, avisos: [texto] } — diferenca = valor − soma
     (positivo = falta). Regra do dono: só a CONTA trava (e linha sem valor/data/tipo); data fora da entrega é AVISO. */
  /* anterior (03/11) = o fluxo gravado antes (FLUXO PERSONALIZADO): a permuta antiga, só com a descrição, continua
     valendo se a linha não mudou. porBem: { índice: [o que falta no bem] }; errosBem: os textos desses erros (também em
     erros) — a tela não trava o botão Salvar por eles: ao salvar, abre o formulário do bem. */
  function validar(f, padrao, anterior) {
    f = normalizar(f);
    var erros = [], porLinha = {}, avisos = [], porBem = {}, errosBem = [];
    var antigas = {};
    (anterior ? normalizar(anterior).linhas : []).forEach(function (l) {
      /* multiconjunto: cada permuta gravada libera UMA linha igual (duas cópias de uma antiga = a 2ª pede o bem) */
      if (l.t === "permuta" && !l.b && l.x) { var ch = [c(l.v), l.n, l.d, l.i, l.x].join("|"); antigas[ch] = (antigas[ch] || 0) + 1; }
    });
    function erroBem(k, faltas, msg) {
      porBem[k] = faltas;
      var t = "Linha " + (k + 1) + ": " + msg;
      erros.push(t); errosBem.push(t);
    }
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
      if (l.t === "permuta") {
        if (l.b) {
          var fb = faltasBem(l.b);
          if (fb.length) erroBem(k, fb, "dados da permuta incompletos — " + fb.slice(0, 4).join(", ") + (fb.length > 4 ? "…" : ""));
        } else if (antigas[[c(l.v), l.n, l.d, l.i, l.x].join("|")] > 0) {
          antigas[[c(l.v), l.n, l.d, l.i, l.x].join("|")]--;   /* fluxo antigo, linha igual à gravada: segue só com a descrição */
        } else erroBem(k, ["tipo do bem e os dados dele"], "faltam os dados do bem da permuta (veículo, imóvel ou outro)");
      }
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
       0, 12 ou 24 no total (o prazo pode mudar — 31/10), parcela até o teto e sem começar antes da proposta */
    if (padrao) {
      padrao = normalizar(padrao);
      var fixos = function (ls) {
        return ls.filter(function (l) { return TIPOS[l.t] && TIPOS[l.t].fixo; })
          .map(function (l) { return l.t + ":" + totalLinhaC(l); }).sort().join("|");
      };
      if (fixos(f.linhas) !== fixos(padrao.linhas)) erros.push("Pré-reserva paga, financiamento, FGTS e subsídio não mudam — ficam como na proposta");
      /* 31/10 (dono): com pré-reserva, o restante do sinal se divide livre, mas só nos prazos do sinal (ato/30/60/90,
         no máximo 4 parcelas até 3 meses da assinatura) e sem baixar o sinal da proposta (o mínimo de hoje) */
      var temPR = padrao.linhas.some(function (l) { return l.t === "prereserva"; });
      if (temPR) {
        var sinaisP = padrao.linhas.filter(function (l) { return l.t === "sinal" && isoValida(l.d); }).map(function (l) { return l.d; }).sort();
        var ass = padrao.assinatura || sinaisP[0] || "", limite = ass ? maisMeses(ass, 3) : "";
        var totSinal = function (ls) { return ls.reduce(function (s, l) { return s + (l.t === "sinal" || l.t === "prereserva" ? totalLinhaC(l) : 0); }, 0); };
        var nSinal = 0;
        f.linhas.slice(0, MAX_LINHAS).forEach(function (l, k) {
          if (l.t !== "sinal") return;
          nSinal += Math.max(0, l.n);
          var ult = isoValida(l.d) ? maisMeses(l.d, (Math.max(1, l.n) - 1) * l.i) : "";
          if (ass && isoValida(l.d) && (l.d < ass || ult > limite))
            erroLinha(k, "sinal só nos prazos do sinal: de " + dataBR(ass) + " a " + dataBR(limite) + " (ato, 30, 60 e 90 dias)");
        });
        if (nSinal > 4) erros.push("O restante do sinal vai em no máximo 4 parcelas (ato, 30, 60 e 90 dias)");
        if (totSinal(f.linhas) < totSinal(padrao.linhas))
          erros.push("O sinal (com a pré-reserva) não pode ficar abaixo do da proposta: " + moeda(totSinal(padrao.linhas) / 100));
      }
      var qtd = function (ls) { return ls.reduce(function (s, l) { return s + (l.t === "pos" ? Math.max(0, l.n) : 0); }, 0); };
      /* 31/10/2026 (dono): o prazo pode mudar no Alterar fluxo (cliente de 24x para 36x) — pós-chaves só 0, 12 ou 24
         parcelas; a comissão e o fiador seguem o prazo novo (ContratoVenda.planoDoFluxo / comPosChaves, PR #35) */
      var qP = qtd(padrao.linhas), q = qtd(f.linhas), pN = prazoDasLinhas(f.linhas), pP = prazoDasLinhas(padrao.linhas);
      if (pN === null) erros.push("Pós-chaves: só 0, 12 ou 24 parcelas no total (prazo de 24, 36 ou 48 meses) — hoje " + q);
      else if (pN !== pP && pP !== null)
        avisos.push("prazo da entrada muda de " + pP + "x para " + pN + "x — a comissão segue o prazo novo" + (!qP && q ? " e a venda passa a ter fiador" : ""));
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
    return { ok: !erros.length, diferenca: dif / 100, erros: erros, porLinha: porLinha, avisos: avisos, porBem: porBem, errosBem: errosBem };
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

  /* ---- 31/10/2026 (dono): trocar o prazo da entrada (24x/36x/48x) e sugerir valores enquanto monta ----
   * A conta é a do SIMULADOR (fpcGerar, Código.js): o fluxo padrão de R$ 60.200 (sinal 10.000; 12 × 860; 12 × 330;
   * balões 10.000 e 7.000; 24 × 788,33 de pós-chaves) é a régua. Com pós-chaves, a parte do meio (pré-chaves + balões)
   * encolhe para caber o pós; o que passa da régua aumenta só o meio (a parcela pós-chaves nunca sobe do teto).
   * Sinal, entrada à vista, permuta, financiamento, FGTS e subsídio ficam; pré-chaves, balões e pós-chaves são refeitos. */
  var PRAZOS = { 24: 0, 36: 12, 48: 24 };                       /* prazo da entrada → parcelas pós-chaves */
  var SIM_POS_UNIT = 788.3332806666667, SIM_M1 = 12 * 860, SIM_M13 = 12 * 330, SIM_B1 = 10000, SIM_B2 = 7000;
  var SIM_MEIO = SIM_B1 + SIM_B2 + SIM_M1 + SIM_M13, SIM_CHEIA = 10000 + SIM_MEIO + 24 * SIM_POS_UNIT;   /* 31.280 e 60.200 */
  /* prazo pela quantidade de pós-chaves das linhas (0/12/24 → 24/36/48); null fora disso */
  function prazoDasLinhas(linhas) {
    var n = (linhas || []).reduce(function (s, l) { return s + (l.t === "pos" ? Math.max(0, l.n | 0) : 0); }, 0);
    for (var p in PRAZOS) if (PRAZOS[p] === n) return Number(p);
    return null;
  }
  function porData(a, b) { return String(a.d || "9999").localeCompare(String(b.d || "9999")); }
  /* { linhas } ou { erro } */
  /* 1ª parcela pós-chaves (31/10/2026, teste na unidade 61: 36x → 24x → 36x mudava a data): NUNCA sai das linhas de
     agora. Se a proposta tem pós-chaves, a data da proposta; senão, o mês seguinte à entrega no dia de pagamento das
     parcelas (o da 1ª pré-chaves); e nunca antes do mês seguinte ao último balão. */
  function inicioPos(f, padrao, pres, ultBal) {
    var ini = "";
    (padrao && padrao.linhas || []).forEach(function (l) { if (l.t === "pos" && isoValida(l.d) && (!ini || l.d < ini)) ini = l.d; });
    if (ini) return ini;
    var dia = pres[0] && isoValida(pres[0].d) ? Number(pres[0].d.slice(8, 10)) : (isoValida(ultBal) ? Number(ultBal.slice(8, 10)) : 0);
    var cand = "";
    if (isoValida(f.entrega) && dia) cand = maisMeses(f.entrega.slice(0, 8) + ("0" + Math.min(dia, 28)).slice(-2), 1).slice(0, 8) + ("0" + dia).slice(-2);
    if (cand && !isoValida(cand)) cand = maisMeses(f.entrega.slice(0, 8) + "28", 1);   /* dia 29/30/31 num mês curto */
    var depoisBal = isoValida(ultBal) ? maisMeses(ultBal, 1) : "";
    if (!cand) return depoisBal;
    return depoisBal && depoisBal > cand ? depoisBal : cand;
  }
  function mudarPrazo(f, prazo, padrao) {
    f = normalizar(f);
    prazo = Number(prazo);
    if (!PRAZOS.hasOwnProperty(prazo)) return { erro: "Prazo da entrada só 24, 36 ou 48 meses" };
    var refaz = { pre: 1, balao: 1, pos: 1 }, ficam = f.linhas.filter(function (l) { return !refaz[l.t]; });
    var R = c(f.valor) - somaC(ficam);
    if (R <= 0) return { erro: "Sinal e financiamento já cobrem o valor da casa — não sobra entrada para parcelar" };
    var pres = f.linhas.filter(function (l) { return l.t === "pre"; }).sort(porData);
    var bals = f.linhas.filter(function (l) { return l.t === "balao"; }).sort(porData);
    var poss = f.linhas.filter(function (l) { return l.t === "pos"; }).sort(porData);
    var nPos = PRAZOS[prazo], basePos = nPos * SIM_POS_UNIT, baseMeio = SIM_CHEIA - 10000 - basePos, k = baseMeio / SIM_MEIO;
    var r = R / 100, g, tpos;
    if (r <= baseMeio + basePos + 0.01) { g = r / (baseMeio + basePos); tpos = basePos * g; }
    else { g = (r - basePos) / baseMeio; tpos = basePos; }
    var n1 = pres[0] && pres[0].n > 0 ? pres[0].n : 12, n2 = pres[1] && pres[1].n > 0 ? pres[1].n : 12;
    function r2(v) { return Math.round(v * 100) / 100; }
    var novas = [
      { t: "pre", v: r2(SIM_M1 * k * g / n1), n: n1, d: pres[0] ? pres[0].d : "", i: pres[0] ? pres[0].i : 1, x: pres[0] ? pres[0].x : "" },
      { t: "pre", v: r2(SIM_M13 * k * g / n2), n: n2, d: pres[1] ? pres[1].d : "", i: pres[1] ? pres[1].i : 1, x: pres[1] ? pres[1].x : "" },
      { t: "balao", v: r2(SIM_B1 * k * g), n: 1, d: bals[0] ? bals[0].d : "", i: 1, x: bals[0] ? bals[0].x : "" },
      { t: "balao", v: r2(SIM_B2 * k * g), n: 1, d: bals[1] ? bals[1].d : "", i: 1, x: bals[1] ? bals[1].x : "" }
    ];
    if (nPos) {
      var ultBal = novas[3].d || novas[2].d;
      novas.push({ t: "pos", v: r2(tpos / nPos), n: nPos, d: inicioPos(f, padrao ? normalizar(padrao) : null, pres, ultBal), i: 1, x: "" });
    }
    /* os centavos fecham no último balão, como no simulador */
    var dif = c(f.valor) - somaC(ficam.concat(novas));
    novas[3].v = (c(novas[3].v) + dif) / 100;
    if (novas[3].v <= 0) return { erro: "Não coube o fluxo de " + prazo + "x — ajuste as linhas à mão" };
    /* a ordem da tela: o que fica, na posição de antes; pré-chaves, balões e pós-chaves no lugar do primeiro refeito */
    var linhas = [], pos = -1;
    f.linhas.forEach(function (l) { if (refaz[l.t]) { if (pos < 0) pos = linhas.length; } else linhas.push(l); });
    if (pos < 0) pos = linhas.length;
    linhas.splice.apply(linhas, [pos, 0].concat(novas));
    return { linhas: linhas };
  }
  /* Sugestão "Distribuir": a diferença (falta ou sobra) vai proporcional ao total de cada pré-chaves e balão; os centavos
     no maior. Sinal, pós-chaves e o resto não mudam. { linhas } ou { erro }. */
  function distribuir(f) {
    f = normalizar(f);
    var D = c(f.valor) - somaC(f.linhas);
    if (!D) return { linhas: f.linhas };
    var alvos = [];
    f.linhas.forEach(function (l, k) { if ((l.t === "pre" || l.t === "balao") && totalLinhaC(l) > 0) alvos.push(k); });
    var base = alvos.reduce(function (s, k) { return s + totalLinhaC(f.linhas[k]); }, 0);
    if (!base) return { erro: "Não há pré-chaves nem balões para distribuir — use o ↻ de uma linha" };
    if (base + D <= 0) return { erro: "A sobra é maior que as pré-chaves e os balões juntos" };
    var add = {}, dado = 0, maior = alvos[0];
    alvos.forEach(function (k) {
      var t = totalLinhaC(f.linhas[k]);
      if (t > totalLinhaC(f.linhas[maior])) maior = k;
      add[k] = Math.trunc(D * t / base); dado += add[k];
    });
    add[maior] += D - dado;
    var linhas = f.linhas.slice(), erro = "";
    alvos.forEach(function (k) {
      var alvo = totalLinhaC(linhas[k]) + add[k];
      if (alvo < Math.max(1, linhas[k].n)) erro = "Uma linha ficaria zerada — ajuste à mão";
      else linhas[k] = comTotal(linhas[k], alvo);
    });
    return erro ? { erro: erro } : { linhas: linhas };
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
    if (l.b) nova.b = l.b;
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

  /* 31/10 (dono): a pré-reserva paga abate o sinal — sai do ato, depois do 30, 60 e 90 dias (parcela zerada some).
     valores = [ato, 30, 60, 90] → { valores, abatido }; abatido < pr = a pré-reserva passou do sinal. */
  function abaterSinal(valores, pr) {
    var falta = c(pr), out = (valores || []).map(function (v) {
      var x = positivo(v) ? c(v) : 0, s = Math.min(falta, x);
      falta -= s;
      return x - s > 0 ? (x - s) / 100 : 0;
    });
    return { valores: out, abatido: (c(pr) - falta) / 100 };
  }

  /* Gavetas do simulador (fluxo como o GerarContrato lê) → lista. excedente = parte do VALOR PARA ENTRADA da
     proposta que passa do sinal (paga na assinatura, sem correção — ContratoVenda.parcelasPreChaves).
     pr = { valor, data } da pré-reserva paga (ContratoVenda.preReservaPaga) ou null. */
  function doPadrao(fl, excedente, pr) {
    fl = fl || {};
    var L = [], ass = isoValida(fl.assinatura) ? fl.assinatura : "";
    var sv = [fl.sinalAto, fl.sinal30, fl.sinal60, fl.sinal90];
    if (pr && positivo(pr.valor)) {
      var ab = abaterSinal(sv, pr.valor);
      sv = ab.valores;
      if (ab.abatido > 0) L.push({ t: "prereserva", v: ab.abatido, n: 1, d: isoValida(pr.data) ? pr.data : ass, i: 1, x: "" });
    }
    function um(t, v, d) { if (positivo(v)) L.push({ t: t, v: v, n: 1, d: isoValida(d) ? d : "", i: 1, x: "" }); }
    function serie(t, n, v, d) { if (positivo(n) && positivo(v)) L.push({ t: t, v: v, n: n | 0, d: isoValida(d) ? d : "", i: 1, x: "" }); }
    um("sinal", sv[0], ass);
    um("sinal", sv[1], fl.data30);
    um("sinal", sv[2], fl.data60);
    um("sinal", sv[3], fl.data90);
    um("entrada", excedente, ass);
    serie("pre", fl.pre1N, fl.pre1Valor, fl.pre1Data);
    serie("pre", fl.pre2N, fl.pre2Valor, fl.pre2Data);
    um("balao", fl.balao1Valor, fl.balao1Data);
    um("balao", fl.balao2Valor, fl.balao2Data);
    serie("pos", fl.posN, fl.posValor, fl.posData);
    um("fin", fl.credito, "");
    um("fgts", fl.fgts, "");
    um("subsidio", fl.subsidio, "");
    var out = { valor: positivo(fl.valorVenda) ? fl.valorVenda : 0, entrega: isoValida(fl.entrega) ? fl.entrega : "", linhas: L };
    if (ass) out.assinatura = ass;
    return out;
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
           PRAZOS: PRAZOS, TIPOS_BEM: TIPOS_BEM, QUITA_PADRAO: QUITA_PADRAO, normalizarBem: normalizarBem, faltasBem: faltasBem, semDadosDoBem: semDadosDoBem, resumoBem: resumoBem,
           docValido: docValido, docFormatado: docFormatado, renavamValido: renavamValido, placaValida: placaValida, chassiValido: chassiValido, prazoDasLinhas: prazoDasLinhas, mudarPrazo: mudarPrazo, distribuir: distribuir,
           normalizar: normalizar, validar: validar, redistribuir: redistribuir, aplicarDesconto: aplicarDesconto, valorDoDesconto: valorDoDesconto, doPadrao: doPadrao, abaterSinal: abaterSinal, expandir: expandir,
           serializar: serializar, ler: ler, ordenar: ordenar, totalLinha: function (l) { return totalLinhaC(normalizar({ linhas: [l] }).linhas[0] || {}) / 100; },
           soma: function (linhas) { return somaC(normalizar({ linhas: linhas }).linhas) / 100; }, maisMeses: maisMeses, moeda: moeda, dataBR: dataBR };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FluxoLivre;
