/* QuadroFluxo — o quadro "FLUXO DE PAGAMENTO PRO SOLUTO" do cartão da unidade (vendas.html › Planilha Casas Condomínio).
 *
 * 31/10/2026 (dono): quando a venda tem o fluxo alterado no portal (FLUXO PERSONALIZADO, venda/FluxoLivre.js), o quadro
 * mostra ESSA lista — a mesma que o contrato e o robô do Mais Controle usam —, e não as gavetas do simulador (que o
 * Alterar fluxo nunca apaga). Financiamento, FGTS e subsídio não entram no pro soluto: vão para "Como se chega".
 *
 * Puro (sem DOM): roda no navegador (depois do FluxoLivre.js) e no node (testes). Repositório público: nada real aqui. */
var QuadroFluxo = (function () {
  function FL() { return typeof FluxoLivre !== "undefined" ? FluxoLivre : require("./FluxoLivre.js"); }
  var GRUPOS = [["sinal", "SINAL"], ["entrada", "ENTRADA À VISTA"], ["pre", "PARCELAS PRÉ-CHAVES"], ["balao", "BALÕES"],
                ["pos", "PÓS-CHAVES"], ["permuta", "PERMUTA"]];
  var TERCEIROS = { fin: "credito", fgts: "fgts", subsidio: "subsidio" };

  /* "10/11/2026" ou "10/11/2026 a 10/10/2027" (+ "a cada N meses" quando não é mensal) */
  function quando(l) {
    var F = FL();
    if (!l.d) return "—";
    if (l.n <= 1) return F.dataBR(l.d);
    return F.dataBR(l.d) + " a " + F.dataBR(F.maisMeses(l.d, (l.n - 1) * (l.i || 1))) + (l.i > 1 ? " (a cada " + l.i + " meses)" : "");
  }

  /* texto da coluna FLUXO PERSONALIZADO → null (vazia ou ilegível: vale o fluxo do simulador) ou
     { alterado, valor, L: [{ grupo } | { rot, qtd, val, ult, sub, quando }], total, credito, fgts, subsidio, posN, semComissao }
     — L no mesmo formato do condFluxo do vendas.html; ult = valor da última parcela quando ela é diferente;
     posN = nº de parcelas pós-chaves (o prazo da entrada, de onde sai a comissão). */
  function doTexto(texto) {
    var F = FL(), f = F.ler(typeof texto === "string" ? texto : "");
    if (!f) return null;
    var out = { alterado: true, valor: f.valor, L: [], total: 0, credito: 0, fgts: 0, subsidio: 0, posN: 0, semComissao: !!f.semComissao };
    var totalC = 0, terc = { credito: 0, fgts: 0, subsidio: 0 };
    f.linhas.forEach(function (l) {
      if (TERCEIROS[l.t]) terc[TERCEIROS[l.t]] += Math.round(F.totalLinha(l) * 100);
      if (l.t === "pos") out.posN += Math.max(0, l.n);
    });
    var ordem = F.ordenar(f.linhas);
    GRUPOS.forEach(function (g) {
      var ls = ordem.filter(function (l) { return l.t === g[0] && l.n > 0; });
      if (!ls.length) return;
      out.L.push({ grupo: g[1] });
      ls.forEach(function (l, k) {
        var subC = Math.round(F.totalLinha(l) * 100);
        totalC += subC;
        out.L.push({ rot: F.TIPOS[l.t].nome + (ls.length > 1 ? " " + (k + 1) : "") + (l.x ? " — " + l.x : ""),
                     qtd: l.n, val: l.v, ult: l.n > 1 && l.u ? l.u : null, sub: subC / 100, quando: quando(l) });
      });
    });
    out.total = totalC / 100;
    out.credito = terc.credito / 100; out.fgts = terc.fgts / 100; out.subsidio = terc.subsidio / 100;
    return out;
  }

  return { doTexto: doTexto, quando: quando };
})();
if (typeof module !== "undefined" && module.exports) module.exports = QuadroFluxo;
