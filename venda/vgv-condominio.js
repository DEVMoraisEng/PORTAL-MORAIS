/* VgvCondominio — o VGV da Planilha Casas Condomínio (vendas.html), logo abaixo da tabela das unidades.
 *
 * 03/11/2026 (dono): no VGV só é venda o processo todo concluído = contrato ASSINADO por todos
 * (ASSINATURA - SITUAÇÃO = ASSINADO). Contrato ENVIADO e ainda sem todas as assinaturas fica de fora e aparece à
 * parte como "em assinatura". Recusado, cancelado, expirado, pré-reserva e proposta não contam. A venda entra no mês
 * da DATA DE ASSINATURA DO CONTRATO (31/10/2026, dono); sem ela, vale a DATA DA VENDA. Valor = VALOR DE COMPRA E
 * VENDA NO CONTRATO (VENDIDA); sem ele, VALOR DE VENDA. Data com ano antes de 2000 (ex.: "0002", digitado errado)
 * não entra em período nenhum: conta em "sem data válida" para alguém corrigir.
 *
 * Puro (sem DOM): roda no navegador e no node (venda/testes/vgv-condominio.test.mjs). Repositório público: nada
 * real aqui. */
var VgvCondominio = (function () {
  "use strict";
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
               "novembro", "dezembro"];
  var CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function norm(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim(); }

  /* "2026-10-31", "2026-10-31T10:00", {start:"2026-10-31"} → "2026-10-31"; inválida ou ano < 2000 → "" */
  function dataIso(v) {
    if (v && typeof v === "object" && v.start) v = v.start;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? "" : v));
    if (!m || Number(m[1]) < 2000 || Number(m[2]) < 1 || Number(m[2]) > 12) return "";
    return m[1] + "-" + m[2] + "-" + m[3];
  }
  function numero(v) {
    if (v == null || v === "") return 0;
    var n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return isFinite(n) ? n : 0;
  }
  function fimMes(m) { var a = Number(m.slice(0, 4)), b = Number(m.slice(5, 7)); return m + "-" + pad(new Date(a, b, 0).getDate()); }
  function somaMes(m, n) {
    var t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
    return Math.floor(t / 12) + "-" + pad(t % 12 + 1);
  }
  function mesesEntre(a, b) { return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1; }
  function mesLongo(m) { return MESES[Number(m.slice(5, 7)) - 1] + " de " + m.slice(0, 4); }
  function mesCurto(m) { return CURTO[Number(m.slice(5, 7)) - 1] + "/" + m.slice(2, 4); }

  /* linhas do banco → itens. ler(linha, coluna) devolve o valor cru da coluna (no portal: cdVal). */
  function itens(linhas, ler) {
    return (linhas || []).map(function (l) {
      var sit = norm(ler(l, "ASSINATURA - SITUAÇÃO"));
      var valor = numero(ler(l, "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)")) || numero(ler(l, "VALOR DE VENDA"));
      var bruta = ler(l, "DATA DE ASSINATURA DO CONTRATO") || ler(l, "DATA DA VENDA");
      return {
        id: l && l.id, unidade: String(ler(l, "UNIDADE") || "").trim(), condominio: String(ler(l, "CONDOMÍNIO") || "").trim(),
        estado: sit === "ASSINADO" ? "assinado" : sit === "ENVIADO" ? "assinando" : "fora",
        data: dataIso(bruta), valor: valor
      };
    });
  }

  /* tipo: mesat | mes | tri | ano | tudo | livre. op: {hoje, mes:"AAAA-MM", tri:"AAAA-T", ano:"AAAA", de, ate} */
  function periodo(tipo, op) {
    var hoje = op.hoje, mh = hoje.slice(0, 7), p;
    if (tipo === "mesat") p = { de: mh + "-01", ate: hoje, rotulo: mesLongo(mh) + " (até hoje)" };
    else if (tipo === "mes") { var m = op.mes || mh; p = { de: m + "-01", ate: fimMes(m), rotulo: mesLongo(m) }; }
    else if (tipo === "tri") {
      var t = String(op.tri || (hoje.slice(0, 4) + "-" + Math.ceil(Number(hoje.slice(5, 7)) / 3))).split("-");
      var m0 = t[0] + "-" + pad((Number(t[1]) - 1) * 3 + 1);
      p = { de: m0 + "-01", ate: fimMes(somaMes(m0, 2)), rotulo: t[1] + "º trimestre de " + t[0] };
    }
    else if (tipo === "ano") { var a = op.ano || hoje.slice(0, 4); p = { de: a + "-01-01", ate: a + "-12-31", rotulo: a }; }
    else if (tipo === "tudo") return { de: "2000-01-01", ate: "9999-12-31", rotulo: "desde o lançamento", ant: null };
    else {
      var de = op.de || mh, ate = op.ate || mh;
      if (de > ate) { var x = de; de = ate; ate = x; }
      p = { de: de + "-01", ate: fimMes(ate), rotulo: de === ate ? mesLongo(de) : mesCurto(de) + " a " + mesCurto(ate) };
    }
    /* período anterior do mesmo tamanho; "este mês" compara com os mesmos dias do mês passado */
    if (tipo === "mesat") {
      var ma = somaMes(mh, -1), dia = Math.min(Number(hoje.slice(8, 10)), Number(fimMes(ma).slice(8, 10)));
      p.ant = { de: ma + "-01", ate: ma + "-" + pad(dia), rotulo: "mesmos dias de " + MESES[Number(ma.slice(5, 7)) - 1] };
    } else {
      var n = mesesEntre(p.de.slice(0, 7), p.ate.slice(0, 7)), a0 = somaMes(p.de.slice(0, 7), -n);
      p.ant = { de: a0 + "-01", ate: fimMes(somaMes(a0, n - 1)), rotulo: n === 1 ? mesLongo(a0) : n === 12 && tipo === "ano" ? a0.slice(0, 4) : "período anterior" };
    }
    return p;
  }

  function dentro(it, p) { return it.data && it.data >= p.de && it.data <= p.ate; }

  /* resumo do período: VGV assinado, comparação, em assinatura (fora do VGV) e a série por mês */
  function resumo(lista, p) {
    var ass = lista.filter(function (it) { return it.estado === "assinado"; });
    var no = ass.filter(function (it) { return dentro(it, p); }).sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : 0; });
    var ant = p.ant ? ass.filter(function (it) { return dentro(it, p.ant); }) : null;
    var soma = function (a) { return a.reduce(function (s, it) { return s + it.valor; }, 0); };
    var assinando = lista.filter(function (it) { return it.estado === "assinando"; });
    var datas = ass.filter(function (it) { return it.data; }).map(function (it) { return it.data.slice(0, 7); }).sort();
    var meses = [];
    if (datas.length) {
      var ini = datas[0], fim = datas[datas.length - 1];
      for (var m = ini; m <= fim; m = somaMes(m, 1)) meses.push(m);
    }
    var porMes = meses.map(function (m) {
      var d = ass.filter(function (it) { return it.data && it.data.slice(0, 7) === m; });
      return { mes: m, rotulo: mesCurto(m), vgv: soma(d), n: d.length, noPeriodo: m + "-01" <= p.ate && fimMes(m) >= p.de };
    });
    var vgv = soma(no);
    return {
      vgv: vgv, n: no.length, ticket: no.length ? vgv / no.length : 0, vendas: no,
      ant: ant ? { vgv: soma(ant), n: ant.length, rotulo: p.ant.rotulo } : null,
      acumulado: { vgv: soma(ass.filter(function (it) { return it.data && it.data <= p.ate; })), n: ass.filter(function (it) { return it.data && it.data <= p.ate; }).length },
      assinando: { n: assinando.length, vgv: soma(assinando) },
      semData: ass.filter(function (it) { return !it.data; }).length,
      porMes: porMes
    };
  }

  return { itens: itens, periodo: periodo, resumo: resumo, dataIso: dataIso, numero: numero, mesLongo: mesLongo, mesCurto: mesCurto };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VgvCondominio;
