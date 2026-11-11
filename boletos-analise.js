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

  /* ------------------------------------------------------------ HTML */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function brl(v) {
    const n = Number(v) || 0, s = Math.abs(n).toFixed(2).split(".");
    return (n < 0 ? "-" : "") + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + s[1];
  }
  function curto(v) {   // rótulo do eixo: 1,2 mi / 35 mil / 900
    const n = Math.abs(Number(v) || 0);
    if (n >= 1e6) return num(v / 1e6, n % 1e6 ? 1 : 0).replace(",0", "") + " mi";
    if (n >= 1e3) return (Math.round(v / 100) / 10).toString().replace(".", ",") + " mil";
    return String(Math.round(v));
  }
  const ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function mesCurto(m) { return ABREV[+m.slice(5, 7) - 1] + "/" + m.slice(2, 4); }

  /* Eixo com 3 a 5 marcas em valores redondos; a última cobre o maior valor sem sobrar um passo inteiro. */
  function eixo(max) {
    if (!(max > 0)) return { fim: 1, passo: 1, marcas: [0, 1] };
    const bruto = max / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1, 2, 2.5, 5, 10].map(k => k * mag).find(x => x >= bruto - 1e-9);
    const n = Math.ceil(max / passo - 1e-9), fim = n * passo;
    return { fim, passo, marcas: Array.from({ length: n + 1 }, (_, i) => Math.round(i * passo * 100) / 100) };
  }

  function htmlFiltros(fin, f) {
    f = f || {};
    const hoje = hojeDe(fin), P = (fin && fin.parcelas) || [];
    const atalhoAtivo = ["mes", "3m", "ano", "tudo"].find(a => { const x = atalho(a, hoje); return x.de === (f.de || "") && x.ate === (f.ate || ""); }) || "";
    const nomesAtalho = { mes: "Este mês", "3m": "Próximos 3 meses", ano: "Este ano", tudo: "Tudo" };
    const opt = (v, txt, atual) => '<option value="' + esc(v) + '"' + (v === (atual || "") ? " selected" : "") + ">" + esc(txt) + "</option>";
    const cats = new Set(P.map(categoria)), comParcela = new Set(P.map(p => p.u));
    const unidades = ((fin && fin.unidades) || []).filter(u => comParcela.has(u.unidade));
    return '<section class="quadro" aria-label="Filtros"><div class="topo"><div><h2>Análise financeira</h2>' +
      '<span class="muted">Para a diretoria. Os filtros valem para os indicadores, os gráficos e a lista de unidades.</span></div></div>' +
      '<div class="filtros analise">' +
      '<label class="campo">De <input id="f-de" type="month" value="' + esc(f.de || "") + '"></label>' +
      '<label class="campo">Até <input id="f-ate" type="month" value="' + esc(f.ate || "") + '"></label>' +
      '<div class="campo">Atalhos <div class="atalhos">' + Object.keys(nomesAtalho).map(a =>
        '<button type="button" class="chip atalho' + (a === atalhoAtivo ? " ativo" : "") + '" data-atalho="' + a + '" aria-pressed="' + (a === atalhoAtivo) + '">' + nomesAtalho[a] + "</button>").join("") + "</div></div>" +
      '<label class="campo">Tipo <select id="f-tipo">' + opt("", "Todos", f.tipo) + CATEGORIAS.filter(x => cats.has(x.cat)).map(x => opt(x.cat, x.nome, f.tipo)).join("") + "</select></label>" +
      '<label class="campo">Unidade <select id="f-unidade">' + opt("", "Todas", f.unidade) + unidades.map(u => opt(u.unidade, u.unidade + " · " + u.comprador, f.unidade)).join("") + "</select></label>" +
      '<label class="campo">Situação <select id="f-situacao">' + opt("", "Todas", f.situacao) + opt("pago", "Pago", f.situacao) + opt("avencer", "A vencer", f.situacao) + opt("vencido", "Vencido", f.situacao) + "</select></label>" +
      '<button type="button" id="f-limpar"' + (filtroAtivo(f) ? "" : " disabled") + ">Limpar filtros</button>" +
      '</div><p class="muted nota">O período usa o mês de vencimento da parcela; no dinheiro recebido, o mês em que ele entrou.</p></section>';
  }

  function htmlIndicadores(lista) {
    return '<section class="quadro" aria-label="Indicadores"><h2>Indicadores</h2><div class="inds">' + lista.map(x =>
      '<div class="ind"><span class="rotulo">' + esc(x.rotulo) + "</span><b" + (x.alerta ? ' class="vermelho"' : "") + ">" +
      esc(typeof x.valor === "number" ? brl(x.valor) : x.valor) + '</b><span class="n-tit">' + esc(x.sub) + "</span></div>").join("") + "</div></section>";
  }

  const W = 560, ESQ = 52, TOPO = 12, BAIXO = 26, DIR = 10;
  function grade(e, h) {
    return e.marcas.map(v => { const y = TOPO + h - h * v / e.fim;
      return '<line x1="' + ESQ + '" x2="' + (W - DIR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--border2)"/>' +
        '<text x="' + (ESQ - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + curto(v) + "</text>"; }).join("");
  }
  function rotulosX(meses, x, H) {
    const cada = Math.max(1, Math.ceil(meses.length / 12));
    return meses.map((m, i) => i % cada ? "" : '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--text3)">' + mesCurto(m) + "</text>").join("");
  }
  function barra(x, y0, larg, alt, cor, dica) {
    if (!(alt > 0)) return "";
    const rr = Math.min(3, larg / 2, alt), y = y0 - alt;
    return '<path d="M' + x.toFixed(1) + "," + y0.toFixed(1) + " V" + (y + rr).toFixed(1) + " q0,-" + rr.toFixed(1) + " " + rr.toFixed(1) + ",-" + rr.toFixed(1) +
      " h" + (larg - 2 * rr).toFixed(1) + " q" + rr.toFixed(1) + ",0 " + rr.toFixed(1) + "," + rr.toFixed(1) + " V" + y0.toFixed(1) + ' Z" fill="' + cor + '" data-dica="' + esc(dica) + '"/>';
  }
  function svgBarras(meses, series, cores, nomes, dicaExtra, mesHoje, rotulo) {
    const H = 230, h = H - TOPO - BAIXO, w = W - ESQ - DIR;
    const e = eixo(Math.max(0, ...meses.map(m => Math.max(...series.map(s => s[m] || 0)))));
    const g = w / meses.length, n = series.length, bw = Math.max(2, Math.min(16, (g - 4) / n - 2));
    const centro = i => ESQ + g * i + g / 2;
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(rotulo) + '">' + grade(e, h);
    meses.forEach((m, i) => {
      const x0 = centro(i) - (bw * n + 2 * (n - 1)) / 2;
      series.forEach((sr, k) => { const v = sr[m] || 0;
        s += barra(x0 + k * (bw + 2), TOPO + h, bw, h * v / e.fim, cores[k], mesCurto(m) + " · " + nomes[k] + ": R$ " + brl(v) + (dicaExtra ? dicaExtra(m) : "")); });
    });
    const ih = meses.indexOf(mesHoje);
    if (ih >= 0) s += '<g class="hoje"><line x1="' + (ESQ + g * ih).toFixed(1) + '" x2="' + (ESQ + g * ih).toFixed(1) + '" y1="' + TOPO + '" y2="' + (TOPO + h) + '" stroke="var(--text3)" stroke-dasharray="3 3"/>' +
      '<text x="' + (ESQ + g * ih + 4).toFixed(1) + '" y="' + (TOPO + 10) + '" font-size="10" fill="var(--text3)">hoje</text></g>';
    return s + rotulosX(meses, centro, H) + "</svg>";
  }
  function svgLinha(meses, valores, cor, rotulo) {
    const H = 210, h = H - TOPO - BAIXO, w = W - ESQ - DIR - 6;
    const e = eixo(Math.max(0, ...meses.map(m => valores[m] || 0)));
    const g = meses.length > 1 ? w / (meses.length - 1) : 0, x = i => ESQ + 6 + (meses.length > 1 ? g * i : w / 2);
    const pts = meses.map((m, i) => [x(i), TOPO + h - h * (valores[m] || 0) / e.fim]);
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(rotulo) + '">' + grade(e, h);
    const caminho = pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L");
    s += '<path d="M' + caminho + " L" + pts[pts.length - 1][0].toFixed(1) + "," + (TOPO + h) + " L" + pts[0][0].toFixed(1) + "," + (TOPO + h) + ' Z" fill="' + cor + '" opacity=".12"/>';
    s += '<path d="M' + caminho + '" fill="none" stroke="' + cor + '" stroke-width="2"/>';
    const alvo = Math.max(14, g || w);
    meses.forEach((m, i) => {
      const [px, py] = pts[i];
      s += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (i === meses.length - 1 ? 5 : 4) + '" fill="' + cor + '" stroke="var(--sup)" stroke-width="2"/>' +
        '<rect x="' + (px - alvo / 2).toFixed(1) + '" y="' + TOPO + '" width="' + alvo.toFixed(1) + '" height="' + h + '" fill="transparent" data-dica="' + esc(mesCurto(m) + " · vencido e não pago: R$ " + brl(valores[m] || 0)) + '"/>';
    });
    return s + rotulosX(meses, x, H) + "</svg>";
  }
  function svgDeitadas(itens, cor) {
    const linha = 32, H = itens.length * linha + 8, ESQD = 150, max = Math.max(1, ...itens.map(i => i.valor));
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="A receber por tipo">';
    itens.forEach((it, i) => {
      const y = 6 + i * linha, bw = Math.max(2, (W - ESQD - 110) * it.valor / max), rr = 4;
      s += '<text x="' + (ESQD - 8) + '" y="' + (y + 17) + '" text-anchor="end" font-size="12" fill="var(--text)">' + esc(it.nome) + "</text>" +
        '<path d="M' + ESQD + "," + (y + 4) + " h" + (bw - rr).toFixed(1) + " q" + rr + ",0 " + rr + "," + rr + " v" + (16 - 2 * rr) + " q0," + rr + " -" + rr + "," + rr + " h-" + (bw - rr).toFixed(1) + ' Z" fill="' + cor + '" data-dica="' + esc(it.nome + ": R$ " + brl(it.valor)) + '"/>' +
        '<text x="' + (ESQD + bw + 8).toFixed(1) + '" y="' + (y + 17) + '" font-size="12" fill="var(--text3)">R$ ' + curto(it.valor) + "</text>";
    });
    return s + "</svg>";
  }
  function tabela(cab, linhas) {
    return '<details class="tab"><summary>Ver em tabela</summary><div class="rola"><table><thead><tr>' + cab.map((c, i) => "<th" + (i ? ' class="n"' : "") + ">" + esc(c) + "</th>").join("") +
      "</tr></thead><tbody>" + linhas.map(l => "<tr>" + l.map((c, i) => i ? '<td class="n">' + esc(c) + "</td>" : "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div></details>";
  }
  const VAZIO = '<p class="muted vazio">Nada para mostrar neste filtro.</p>';
  function cartao(titulo, nota, corpo) {
    return '<section class="quadro graf"><div><h3>' + esc(titulo) + '</h3><p class="muted nota">' + esc(nota) + "</p></div>" + corpo + "</section>";
  }

  function htmlGraficos(s) {
    const meses = s.meses || [], passados = meses.filter(m => m < s.mesHoje);
    const temMes = meses.some(m => (s.recebido[m] || 0) > 0 || (s.previsto[m] || 0) > 0);
    const cx = cartao("Recebido × previsto por mês", "Até o mês atual, o que entrou contra o que vencia. Depois dele, o que ainda vai entrar. FGTS, financiamento e permuta ficam fora: entram de uma vez e achatariam os outros meses.",
      temMes ? '<div class="legenda"><span><i class="s1"></i>Recebido</span><span><i class="s2"></i>Previsto</span></div><div class="g">' +
        svgBarras(meses, [s.recebido, s.previsto], ["var(--s1)", "var(--s2)"], ["Recebido", "Previsto"], null, s.mesHoje, "Recebido e previsto por mês") + "</div>" +
        tabela(["Mês", "Recebido", "Previsto"], meses.map(m => [mesCurto(m), m > s.mesHoje ? "—" : brl(s.recebido[m]), brl(s.previsto[m])])) : VAZIO);
    const temCorr = meses.some(m => (s.correcao[m] || 0) !== 0);
    const dicaIndice = m => { const x = s.indiceUsado[m]; return x ? " · INCC-M de " + mesCurto(x.mes) + ": " + num(x.valor, 2) + "%" : ""; };
    const cc = cartao("Correção por mês", "Quanto a correção monetária somou às parcelas que vencem em cada mês. Passe o mouse para ver o INCC-M usado, de dois meses antes.",
      temCorr ? '<div class="g">' + svgBarras(meses, [s.correcao], ["var(--s1)"], ["Correção"], dicaIndice, "", "Correção por mês") + "</div>" +
        tabela(["Mês", "Correção", "INCC-M usado"], meses.map(m => [mesCurto(m), brl(s.correcao[m]), s.indiceUsado[m] ? mesCurto(s.indiceUsado[m].mes) + ": " + num(s.indiceUsado[m].valor, 2) + "%" : "—"])) : VAZIO);
    const ci = cartao("Inadimplência no fim de cada mês", "Quanto estava vencido e não pago no último dia de cada mês, refeito com as baixas que o Mais Controle tem hoje.",
      passados.length ? '<div class="g">' + svgLinha(passados, s.inadimplencia, "var(--ru)", "Inadimplência no fim de cada mês") + "</div>" +
        tabela(["Mês", "Vencido e não pago"], passados.map(m => [mesCurto(m), brl(s.inadimplencia[m])])) : VAZIO);
    const ct = cartao("A receber por tipo", "Onde está o dinheiro que ainda vai entrar.",
      s.porTipo.length ? '<div class="g">' + svgDeitadas(s.porTipo, "var(--s1)") + "</div>" + tabela(["Tipo", "A receber"], s.porTipo.map(x => [x.nome, brl(x.valor)])) : VAZIO);
    return '<div class="grade">' + cx + cc + ci + ct + "</div>";
  }

  return { CATEGORIAS, categoria, situacao, temAnalise, filtrar, resumo, indicadores, series, atalho, filtroAtivo, mesBr, mesMais,
           eixo, htmlFiltros, htmlIndicadores, htmlGraficos };
});
