/* boletos-analise.js — análise financeira do condomínio na aba Boletos e Financeiro (11/11/2026).
 * Só faz contas e monta HTML a partir de financeiro.parcelas, que o servidor publica (servidor/boletos_portal.py,
 * venda/mc/financeiro_condominio.py). Não fala com a rede. Roda no navegador (window.BA) e no node (testes).
 * Dinheiro em centavos inteiros por dentro; reais com duas casas na saída. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.BA = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const CATEGORIAS = [
    { cat: "sinal", nome: "Sinal" }, { cat: "entrada", nome: "Entrada" }, { cat: "pre", nome: "Pré-chaves" },
    { cat: "pos", nome: "Pós-chaves" }, { cat: "balao", nome: "Balão" }, { cat: "caixa", nome: "FGTS e financiamento" },
    { cat: "permuta", nome: "Permuta" }, { cat: "outro", nome: "Outro" }
  ];
  const NOME_CAT = Object.fromEntries(CATEGORIAS.map(c => [c.cat, c.nome]));
  const FORA_DO_COMPRADOR = { caixa: 1, permuta: 1 };   // não entram em vencido, inadimplência nem recebido × previsto
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  const c = v => Math.round((Number(v) || 0) * 100);
  const r = cent => Math.round(cent) / 100;
  const mes = iso => String(iso || "").slice(0, 7);
  function mesMais(m, n) {
    const y = +m.slice(0, 4), k = +m.slice(5, 7) - 1 + n;
    const ano = y + Math.floor(k / 12), mm = ((k % 12) + 12) % 12 + 1;
    return ano + "-" + String(mm).padStart(2, "0");
  }
  function mesesEntre(a, b) {
    const out = [];
    for (let m = a; m <= b && out.length < 600; m = mesMais(m, 1)) out.push(m);
    return out;
  }
  function fimDoMes(m) { return mesMais(m, 1) + "-00"; }   // "AAAA-MM-00" do mês seguinte: maior que qualquer dia de m
  function dias(de, ate) { return Math.round((Date.parse(ate + "T00:00:00Z") - Date.parse(de + "T00:00:00Z")) / 86400000); }
  function num(v, casas) { return (Number(v) || 0).toFixed(casas).replace(".", ","); }
  function mesBr(m) { return /^\d{4}-\d{2}$/.test(m || "") ? MESES[+m.slice(5) - 1] + "/" + m.slice(0, 4) : ""; }

  function categoria(p) {
    if (p.m) return "permuta";
    if (p.t === "terceiros") return "caixa";
    return NOME_CAT[p.t] && p.t !== "caixa" && p.t !== "permuta" ? p.t : "outro";
  }
  function situacao(p, hoje) {
    if (c(p.a) <= 0) return "pago";
    return p.d < hoje ? "vencido" : "avencer";
  }
  function temAnalise(fin) { return !!(fin && Array.isArray(fin.parcelas)); }
  function hojeDe(fin) { return String((fin && fin.hoje) || new Date().toISOString().slice(0, 10)).slice(0, 10); }

  /* Parcelas e recebimentos que passam no filtro. Período no vencimento da parcela; no recebimento, na data dele.
   * semPeriodo=true ignora de/até (janela própria de um indicador, inadimplência histórica). */
  function filtrar(fin, f, semPeriodo) {
    f = f || {};
    const hoje = hojeDe(fin), de = semPeriodo ? "" : f.de || "", ate = semPeriodo ? "" : f.ate || "";
    const base = ((fin && fin.parcelas) || []).filter(p =>
      (!f.tipo || categoria(p) === f.tipo) && (!f.unidade || p.u === f.unidade) && (!f.situacao || situacao(p, hoje) === f.situacao));
    const noPeriodo = m => (!de || m >= de) && (!ate || m <= ate);
    const recebimentos = [];
    base.forEach(p => (p.r || []).forEach(x => {
      const data = String((x && x[0]) || ""), cent = c(x && x[1]);
      if (cent <= 0) return;
      if ((de || ate) && !(data && noPeriodo(mes(data)))) return;
      recebimentos.push({ p, data, c: cent });
    }));
    return { parcelas: base.filter(p => noPeriodo(mes(p.d))), recebimentos, hoje };
  }

  /* Os cinco números, as unidades e os títulos, no mesmo formato do servidor (financeiro_condominio.montar). */
  function resumo(fin, f) {
    const s = filtrar(fin, f), hoje = s.hoje, ativo = filtroAtivo(f);
    const recPorParcela = new Map();
    s.recebimentos.forEach(x => recPorParcela.set(x.p, (recPorParcela.get(x.p) || 0) + x.c));
    const naSelecao = new Set(s.parcelas);
    const todas = ((fin && fin.parcelas) || []).filter(p => naSelecao.has(p) || recPorParcela.has(p));
    const zero = () => ({ recebido: 0, a_vencer: 0, vencido: 0, caixa: 0, permuta: 0 });
    const tot = zero(), porU = new Map(), titulos = [];
    const nomes = new Map(((fin && fin.unidades) || []).map(u => [u.unidade, u]));
    todas.forEach(p => {
      if (!porU.has(p.u)) porU.set(p.u, { n: zero(), antiga: "", proxima: null });
      const u = porU.get(p.u), comprador = (nomes.get(p.u) || {}).comprador || "";
      const rec = recPorParcela.get(p) || 0;
      if (rec > 0) {
        tot.recebido += rec; u.n.recebido += rec;
        titulos.push({ coluna: "recebido", tipo: p.t, sub: p.s, data: p.d, valor: r(rec), pago_em: p.q || "", dias_atraso: 0, unidade: p.u, comprador });
      }
      const ab = c(p.a);
      if (ab <= 0 || !naSelecao.has(p)) return;
      let col;
      if (p.m) col = "permuta";
      else if (p.t === "terceiros") col = "caixa";
      else if (p.d < hoje) { col = "vencido"; u.antiga = u.antiga && u.antiga < p.d ? u.antiga : p.d; }
      else { col = "a_vencer"; if (!u.proxima || p.d < u.proxima.data) u.proxima = { data: p.d, valor: r(ab) }; }
      tot[col] += ab; u.n[col] += ab;
      titulos.push({ coluna: col, tipo: p.t, sub: p.s, data: p.d, valor: r(ab), pago_em: "", dias_atraso: col === "vencido" ? dias(p.d, hoje) : 0, unidade: p.u, comprador });
    });
    const ordem = new Map(((fin && fin.unidades) || []).map((u, i) => [u.unidade, i]));
    const unidades = ((fin && fin.unidades) || []).filter(u => porU.has(u.unidade) || !ativo).map(u => {
      const x = porU.get(u.unidade) || { n: zero(), antiga: "", proxima: null };
      return Object.assign({}, u, Object.fromEntries(Object.entries(x.n).map(([k, v]) => [k, r(v)])),
        { dias_atraso: x.antiga ? dias(x.antiga, hoje) : 0, proxima: x.proxima });
    });
    titulos.sort((a, b) => (ordem.get(a.unidade) - ordem.get(b.unidade)) || (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    return { totais: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r(v)])), unidades, titulos };
  }
  function filtroAtivo(f) { f = f || {}; return !!(f.de || f.ate || f.tipo || f.unidade || f.situacao); }

  function indiceIncc(fin) {
    const serie = ((((fin || {}).indices || {}).tabelas || {})["INCC-M"]) || {};
    const meses = Object.keys(serie).filter(m => /^\d{4}-\d{2}$/.test(m) && isFinite(Number(serie[m]))).sort();
    if (!meses.length) return { chave: "incc", rotulo: "INCC-M em 12 meses", valor: "—", sub: "índices ainda não lidos" };
    const ult = meses.slice(-12), acum = ult.reduce((a, m) => a * (1 + Number(serie[m]) / 100), 1) - 1;
    const ultimo = meses[meses.length - 1];
    return { chave: "incc", rotulo: "INCC-M em 12 meses", valor: num(acum * 100, 2) + "%",
             sub: (ult.length < 12 ? ult.length + " meses lidos, " : "") + "até " + mesBr(ultimo) + " · último: " + num(serie[ultimo], 2) + "%" };
  }

  function indicadores(fin, f) {
    const s = filtrar(fin, f), hoje = s.hoje, P = s.parcelas;
    const soma = (lista, g) => lista.reduce((a, p) => a + g(p), 0);
    const carteira = soma(P, p => c(p.v)), recebido = s.recebimentos.reduce((a, x) => a + x.c, 0);
    const doComprador = P.filter(p => !FORA_DO_COMPRADOR[categoria(p)]);
    const venceu = doComprador.filter(p => p.d < hoje);
    const vencido = soma(venceu, p => Math.max(0, c(p.a))), baseVenc = soma(venceu, p => c(p.v));
    const limite = mesMais(mes(hoje), 11);
    const doze = soma(filtrar(fin, f, true).parcelas.filter(p => categoria(p) !== "permuta" && p.d >= hoje && mes(p.d) <= limite), p => Math.max(0, c(p.a)));
    const comOriginal = P.filter(p => c(p.o) > 0), correcao = soma(comOriginal, p => c(p.v) - c(p.o)), original = soma(comOriginal, p => c(p.o));
    const quitadas = P.filter(p => p.q && c(p.a) <= 0), emDia = quitadas.filter(p => p.q <= p.d);
    const atrasadas = quitadas.filter(p => p.q > p.d), atraso = atrasadas.length ? soma(atrasadas, p => dias(p.d, p.q)) / atrasadas.length : 0;
    const unidades = new Set(P.map(p => p.u)).size;
    const pct = (a, b) => (b ? num(a / b * 100, 1) : "0,0") + "%";
    return [
      { chave: "carteira", rotulo: "Carteira contratada", valor: r(carteira), sub: P.length + (P.length === 1 ? " parcela de " : " parcelas de ") + unidades + (unidades === 1 ? " unidade" : " unidades") },
      { chave: "recebido", rotulo: "Recebido", valor: r(recebido), sub: pct(recebido, carteira) + " da carteira, juros incluídos" },
      { chave: "vencido", rotulo: "Vencido", valor: r(vencido), sub: "Inadimplência " + pct(vencido, baseVenc) + " do que já venceu", alerta: vencido > 0 },
      { chave: "doze", rotulo: "A receber em 12 meses", valor: r(doze), sub: "Do comprador e da Caixa, sem permuta. Não depende do período" },
      { chave: "correcao", rotulo: "Correção monetária", valor: r(correcao), sub: (correcao >= 0 ? "+" : "") + (original ? num(correcao / original * 100, 2) : "0,00") + "% sobre o valor original" },
      { chave: "pontualidade", rotulo: "Pontualidade", valor: quitadas.length ? Math.round(emDia.length / quitadas.length * 100) + "%" : "—", sub: "das parcelas quitadas até o vencimento" },
      { chave: "atraso", rotulo: "Atraso médio", valor: atrasadas.length ? Math.round(atraso) + (Math.round(atraso) === 1 ? " dia" : " dias") : "—", sub: "entre as parcelas quitadas com atraso" },
      indiceIncc(fin)
    ];
  }

  function series(fin, f) {
    f = f || {};
    const s = filtrar(fin, f), hoje = s.hoje, mesHoje = mes(hoje);
    let meses;
    if (f.de || f.ate) {
      const todos = s.parcelas.map(p => mes(p.d)).concat(s.recebimentos.filter(x => x.data).map(x => mes(x.data))).sort();
      meses = mesesEntre(f.de || todos[0] || mesHoje, f.ate || todos[todos.length - 1] || mesHoje);
    } else {
      const todos = s.parcelas.map(p => mes(p.d)).concat(s.recebimentos.filter(x => x.data).map(x => mes(x.data))).filter(Boolean).sort();
      meses = todos.length ? mesesEntre(todos[0], todos[todos.length - 1]) : [];
    }
    const recebido = {}, previsto = {}, correcao = {}, indiceUsado = {}, inadimplencia = {};
    const serie = ((((fin || {}).indices || {}).tabelas || {})["INCC-M"]) || {};
    const cr = {}, cp = {}, cc = {};
    s.recebimentos.forEach(x => { if (x.data && !FORA_DO_COMPRADOR[categoria(x.p)]) cr[mes(x.data)] = (cr[mes(x.data)] || 0) + x.c; });
    s.parcelas.forEach(p => {
      const m = mes(p.d);
      if (!FORA_DO_COMPRADOR[categoria(p)]) cp[m] = (cp[m] || 0) + (m <= mesHoje ? c(p.v) : Math.max(0, c(p.a)));
      if (c(p.o) > 0) cc[m] = (cc[m] || 0) + c(p.v) - c(p.o);
    });
    /* Saldo devido no fim de M = saldo de hoje + o que entrou depois de M. Recebimento sem data conta como já recebido. */
    const historico = filtrar(fin, f, true).parcelas.filter(p => !FORA_DO_COMPRADOR[categoria(p)]);
    meses.forEach(m => {
      recebido[m] = r(cr[m] || 0); previsto[m] = r(cp[m] || 0); correcao[m] = r(cc[m] || 0);
      const ref = mesMais(m, -2);
      indiceUsado[m] = ref in serie && isFinite(Number(serie[ref])) ? { mes: ref, valor: Number(serie[ref]) } : null;
      if (m >= mesHoje) return;
      const fim = fimDoMes(m);
      inadimplencia[m] = r(historico.filter(p => p.d < fim).reduce((a, p) =>
        a + Math.max(0, c(p.a) + (p.r || []).reduce((b, x) => b + (x && x[0] && String(x[0]) > fim ? c(x[1]) : 0), 0)), 0));
    });
    const pt = {};
    s.parcelas.forEach(p => { const k = categoria(p), ab = Math.max(0, c(p.a)); if (ab > 0) pt[k] = (pt[k] || 0) + ab; });
    const porTipo = Object.entries(pt).sort((a, b) => b[1] - a[1]).map(([cat, v]) => ({ cat, nome: NOME_CAT[cat], valor: r(v) }));
    return { meses, mesHoje, recebido, previsto, correcao, indiceUsado, inadimplencia, porTipo };
  }

  function atalho(nome, hoje) {
    const m = mes(hoje), ano = m.slice(0, 4);
    if (nome === "mes") return { de: m, ate: m };
    if (nome === "3m") return { de: m, ate: mesMais(m, 2) };
    if (nome === "ano") return { de: ano + "-01", ate: ano + "-12" };
    return { de: "", ate: "" };
  }

  return { CATEGORIAS, categoria, situacao, temAnalise, filtrar, resumo, indicadores, series, atalho, filtroAtivo, mesBr, mesMais };
});
