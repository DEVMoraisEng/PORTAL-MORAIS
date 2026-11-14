/* FluxoPersonalizado — 14/11/2026 (dono): "leva essa possibilidade de personalização para a aba da proposta dentro do
 * nosso portal (somente nós podemos fazer, o corretor não)".
 *
 * Monta um fluxo de pagamento do Reserva dos Ipês SEM proposta e SEM dado de cliente: escolhe a unidade e as condições,
 * sai o fluxo padrão do simulador (fpcGerar, fluxo-calc.js) e as linhas ficam livres para ajustar pelas regras do
 * "Alterar fluxo" (venda/FluxoLivre.js: guiar, encaixarPre, validar). Nada é gravado nem enviado: a saída é o quadro para
 * imprimir/salvar em PDF ou copiar como texto. Fica só no portal (aba Propostas); o site do corretor não tem.
 *
 * Duas partes: a conta (pura, testada em venda/testes/fluxo-personalizado.test.mjs) e a tela (abrir).
 * Datas pela regra do servidor do simulador (fluxoVenda_/fxPrimeira_): sinal no ato e em 30/60/90 dias; 1ª parcela no
 * 1º mês em que o dia escolhido ainda não passou; última pré-chaves em out/2028; balão de dez/2027 e balão da entrega
 * em nov/2028; pós-chaves a partir do mês seguinte ao balão da entrega. */
var FluxoPersonalizado = (function () {
  function FL() { return typeof FluxoLivre !== "undefined" ? FluxoLivre : require("./FluxoLivre.js"); }
  function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  function c(v) { return Math.round((Number(v) || 0) * 100); }
  function pad(n) { return ("0" + n).slice(-2); }
  function iso(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function parse(s) { var t = String(s || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return t ? { y: +t[1], m: +t[2], d: +t[3] } : null; }
  function diasNoMes(y, m) { return new Date(y, m, 0).getDate(); }
  function addMes(ym, n) { var t = ym.y * 12 + (ym.m - 1) + n; return { y: Math.floor(t / 12), m: t % 12 + 1 }; }
  function noDia(ym, dia) { return iso(ym.y, ym.m, Math.min(Math.max(1, dia), diasNoMes(ym.y, ym.m))); }
  function somaDias(s, n) { var p = parse(s), d = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function primeiroPossivel(ref, dia) { return noDia(ref, dia) > iso(ref.y, ref.m, ref.d) ? { y: ref.y, m: ref.m } : addMes(ref, 1); }
  /* os dois meses em que a 1ª parcela pode cair (o 1º que pode e o seguinte), nunca antes de nov/2026 */
  function opcoesPrimeira(assinatura, hoje, dia) {
    var ref = parse(hoje > assinatura ? hoje : assinatura), e = primeiroPossivel(ref, dia);
    if (e.y * 12 + e.m < 2026 * 12 + 11) e = { y: 2026, m: 11 };
    return [e, addMes(e, 1)];
  }
  function brl(v) { var s = r2(v).toFixed(2).split("."); return "R$ " + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + s[1]; }
  function total(l) { var n = l.n | 0; if (n <= 0) return 0; return c(l.v) * (n - 1) + c(n > 1 && l.u > 0 ? l.u : l.v); }
  function soma(L) { return L.reduce(function (s, l) { return s + total(l); }, 0); }
  function qtdX(q) { var m = String(q || "").match(/^(\d+)\s*X$/i); return m ? Number(m[1]) : 1; }

  /* cnd = {preco, aval, fin, fgts, sub, sinal (valor para o sinal; 0 = mínimo), nSinal 1..4, prazo 24|36|48,
            assinatura 'AAAA-MM-DD', dia 1..31, primeira 'AAAA-MM' (opcional), diluir [%, %]}
     calc = a função fpcGerar do simulador (no navegador, a global)
     -> {padrao: {valor, entrega, assinatura, hoje, linhas}, g, ini, opcoes, entrada, teto} ou {erro, finMax} */
  function gerar(cnd, hoje, calc) {
    calc = calc || (typeof fpcGerar === "function" ? fpcGerar : null);
    if (!calc) return { erro: "A conta do simulador não carregou — tente de novo" };
    var dia = Math.round(Number(cnd.dia) || 0);
    if (dia < 1 || dia > 31) return { erro: "Dia de pagamento das parcelas: de 1 a 31" };
    if (!parse(cnd.assinatura)) return { erro: "Falta a data de assinatura" };
    if (cnd.assinatura < hoje) return { erro: "A data de assinatura não pode ser anterior a hoje" };
    var preco = r2(cnd.preco), aval = r2(cnd.aval), teto = r2(aval * 0.8);
    if (!(preco > 0)) return { erro: "Falta o valor de venda" };
    var fin = Math.max(0, r2(cnd.fin)), fgts = Math.max(0, r2(cnd.fgts)), sub = Math.max(0, r2(cnd.sub));
    if (aval > 0 && fin > teto + 0.004) return { erro: "O financiamento não passa de 80% da avaliação: " + brl(teto), finMax: teto };
    var B0 = r2(preco - fin - fgts - sub);
    if (B0 < 10000 - 0.004) {
      var fm = r2(preco - fgts - sub - 10000);
      return { erro: "Financiamento + FGTS + subsídio deixam " + brl(B0) + " de entrada, e o sinal mínimo é R$ 10.000,00. " +
                     (fm > 0 ? "Baixe o financiamento para no máximo " + brl(fm) + "." : "Baixe o FGTS ou o subsídio."), finMax: fm > 0 ? fm : 0 };
    }
    var ops = opcoesPrimeira(cnd.assinatura, hoje, dia), ini = ops[0];
    var m = String(cnd.primeira || "").match(/^(\d{4})-(\d{2})/);
    if (m) { var p = { y: +m[1], m: +m[2] }; if (p.y * 12 + p.m >= ini.y * 12 + ini.m) ini = p; }
    var g = calc({ preco: preco, financiado: fin, fgts: fgts, subsidio: sub, informado: r2(cnd.sinal), nSinal: cnd.nSinal,
                   prazoEntrada: cnd.prazo, ano: ini.y, mes: ini.m, diluir: cnd.diluir });
    if (g.erroPrazo) return { erro: g.erroPrazo };
    var dB1 = noDia({ y: 2027, m: 12 }, dia), dB2 = noDia(addMes(ini, g.n1 + 12), dia);
    var L = [];
    g.fluxo.forEach(function (x) {
      var q = String(x[0]), v = r2(x[1]), grupo = x[3], n = qtdX(q), md;
      if (!(v > 0)) return;
      if (grupo === "sinal") { md = q.match(/^(\d+)\s*dias/); L.push({ t: "sinal", v: v, n: 1, d: md ? somaDias(cnd.assinatura, +md[1]) : cnd.assinatura, i: 1, x: "" }); }
      else if (grupo === "obra") {
        if (/meses 1 a/i.test(x[2])) L.push({ t: "pre", v: v, n: n, d: noDia(ini, dia), i: 1, x: "" });
        else L.push({ t: "pre", v: v, n: n, d: noDia(addMes(ini, g.n1), dia), i: 1, x: "" });
      }
      else if (grupo === "balao") {
        /* balão de centavos (sobra da diluição de 100%) não vira linha: o centavo fecha na última pré-chaves (dono, 03/11) */
        if (v < 1) return;
        var ent = /chaves/i.test(q);
        L.push({ t: "balao", v: v, n: 1, d: ent ? dB2 : dB1, i: 1, x: ent ? "Entrega das chaves" : "" });
      }
      else if (grupo === "pos") L.push({ t: "pos", v: v, n: n, d: noDia(addMes(parse(dB2), 1), dia), i: 1, x: "" });
    });
    if (fin > 0) L.push({ t: "fin", v: fin, n: 1, d: "", i: 1, x: "" });
    if (fgts > 0) L.push({ t: "fgts", v: fgts, n: 1, d: "", i: 1, x: "" });
    if (sub > 0) L.push({ t: "subsidio", v: sub, n: 1, d: "", i: 1, x: "" });
    var dif = c(preco) - soma(L);
    if (dif) {
      var k = -1, j;
      for (j = L.length - 1; j >= 0; j--) if (L[j].t === "pre") { k = j; break; }
      if (k < 0) for (j = L.length - 1; j >= 0; j--) if (L[j].t === "balao") { k = j; break; }
      if (k < 0 || Math.abs(dif) > 100) return { erro: "A conta do fluxo padrão não fechou (diferença de " + brl(dif / 100) + ") — confira os valores" };
      if (L[k].n > 1) L[k].u = (c(L[k].v) + dif) / 100; else L[k].v = (c(L[k].v) + dif) / 100;
    }
    return { padrao: { valor: preco, entrega: dB2, assinatura: cnd.assinatura, hoje: hoje, linhas: L },
             g: g, ini: ini, opcoes: ops, entrada: B0, teto: teto };
  }
  /* vencimento da última parcela da linha (coluna "Última"); "" em linha de uma parcela ou sem data */
  function ultimaData(l) {
    var n = l ? parseInt(l.n, 10) || 0 : 0;
    return n > 1 && parse(l.d) ? FL().maisMeses(l.d, (n - 1) * (parseInt(l.i, 10) || 1)) : "";
  }
  /* travas de partida: o pós-chaves começa travado — criar um balão ou baixar uma parcela mexe nas pré-chaves e nos
     balões, não na parcela pós-chaves (quem quiser que ela entre no ajuste solta o cadeado) */
  function travasIniciais(linhas) {
    var t = {};
    (linhas || []).forEach(function (l, k) { if (l.t === "pos") t[k] = true; });
    return t;
  }
  /* texto para colar (WhatsApp) e os dados do quadro: só linhas, sem nada do cliente */
  function resumo(fluxo, rotuloUn, hojeBR) {
    var F = FL(), T = F.TIPOS, L = F.ordenar(fluxo.linhas);
    var proprias = L.filter(function (l) { return !T[l.t].terceiro; }), terceiros = L.filter(function (l) { return T[l.t].terceiro; });
    var pago = F.soma(proprias);
    function quando(l) { return l.n > 1 ? "de " + F.dataBR(l.d) + " a " + F.dataBR(ultimaData(l)) : F.dataBR(l.d); }
    function quanto(l) { return l.n > 1 ? l.n + " × " + brl(l.v) + (l.u ? " (última " + brl(l.u) + ")" : "") : brl(l.v); }
    var t = ["*Reserva do Ipês — " + rotuloUn + "*", "Valor do imóvel: " + brl(fluxo.valor)];
    terceiros.forEach(function (l) { t.push(T[l.t].nome + ": " + brl(F.totalLinha(l))); });
    t.push("Entrada (direto à incorporadora): " + brl(pago), "");
    proprias.forEach(function (l) { t.push("• " + T[l.t].nome + (l.x ? " (" + l.x + ")" : "") + ": " + quanto(l) + " — " + quando(l)); });
    t.push("", "Estimativa de " + hojeBR + ". Financiamento sujeito à aprovação da CAIXA. Pré-chaves e balões pelo INCC-M; pós-chaves pelo IPCA + 1% a.m.");
    return { proprias: proprias, terceiros: terceiros, pago: pago, quando: quando, quanto: quanto, texto: t.join("\n") };
  }

  /* ------------------------------------------------------------------ tela ------------------------------------------------------------------ */
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var EDITAVEIS = ["sinal", "entrada", "pre", "balao", "pos"];
  var LEGAL = ["Valores de referência (estimativa), sem validade de proposta nem de reserva: a unidade só é reservada com proposta aceita pela incorporadora.",
    "Financiamento não garantido: sujeito à análise e aprovação de crédito pela CAIXA e à avaliação do imóvel. Se o crédito aprovado for menor, a entrada e o fluxo mudam. O uso do FGTS depende das regras e da liberação pela CAIXA.",
    "Parcelas pré-chaves e balões corrigidos pelo INCC-M; parcelas pós-chaves corrigidas pelo IPCA + 1% ao mês. As datas podem mudar conforme a data de assinatura do contrato."];
  var CSS = ".fxp-tab{border-collapse:collapse;width:100%;font-size:13px}.fxp-tab th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--text3);padding:6px;border-bottom:1px solid var(--border)}" +
    ".fxp-tab td{padding:5px 6px;border-bottom:1px solid var(--border2);vertical-align:middle}.fxp-tab input,.fxp-tab select{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--sup);color:inherit}" +
    ".fxp-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.fxp-v{width:8.5em;text-align:right}.fxp-q{width:4.5em}.fxp-x{width:9em}.fxp-min{font-size:11px;color:var(--text3);white-space:nowrap}" +
    ".fxp-fixo td{color:var(--text3);background:var(--bg3)}.fxp-ic{border:1px solid transparent;background:none;cursor:pointer;font-size:15px;padding:3px 6px;border-radius:6px;color:inherit}.fxp-ic:hover{background:var(--bg3)}.fxp-ic.on{border-color:var(--border)}" +
    ".fxp-mudou td{animation:fxp-pisca 1.5s ease-out}@keyframes fxp-pisca{0%{background:rgba(236,195,43,.45)}100%{background:transparent}}.fxp-erro td:first-child{box-shadow:inset 4px 0 0 var(--vermelho)}" +
    ".fxp-chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}.fxp-chip{border:1px solid var(--border);border-radius:8px;padding:6px 11px;font-size:11.5px;color:var(--text3);background:var(--sup)}.fxp-chip b{display:block;font-size:14.5px;color:inherit;font-variant-numeric:tabular-nums}" +
    ".fxp-chip.bom{border-color:#9dd3b4}.fxp-chip.ruim{border-color:#e2a493}.fxp-barra{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 8px;align-items:center}.fxp-rol{overflow-x:auto}.fxp-sub{font-weight:800;font-size:13px;margin:16px 0 6px}" +
    ".fxp-lista{margin:4px 0 0;padding-left:18px}.fxp-folha{border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--sup);margin-top:8px}";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }
  function num(s) {
    s = String(s == null ? "" : s).replace(/[R$\s]/g, "");
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    var v = Number(s); return isFinite(v) ? r2(v) : 0;
  }
  function din(v) { return r2(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function hojeIso() { var d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

  /* el = onde desenhar; cfg = {unidades: [{unidade, tipo, valorVenda, avaliacao, estado}], inicial: {unidade, fin, fgts, sub,
     sinal, nSinal, prazo, primeira, diluir}, origem: texto (ex.: "a partir da proposta PRO…"), logo: URL, aoFechar: fn} */
  function abrir(el, cfg) {
    cfg = cfg || {};
    var F = FL(), UN = (cfg.unidades || []).slice().sort(function (a, b) { return (parseInt(a.unidade, 10) || 0) - (parseInt(b.unidade, 10) || 0); });
    var ini0 = cfg.inicial || {};
    var sel = null, res = null, fluxo = null, travas = {}, editado = false, mudou = [], msgGuia = "", texto = "";
    if (typeof document !== "undefined" && !document.getElementById("fxp-css")) {
      var st = document.createElement("style"); st.id = "fxp-css"; st.textContent = CSS; document.head.appendChild(st);
    }
    function $(s) { return el.querySelector(s); }
    function opUn() {
      return '<option value="">— escolha a unidade —</option>' + UN.map(function (u) {
        return '<option value="' + esc(u.unidade) + '">Unidade ' + esc(u.unidade) + " · Tipo " + esc(u.tipo || "—") + " · " + brl(u.valorVenda) +
               (u.estado && u.estado !== "disponivel" ? " · " + esc(String(u.estado).toUpperCase()) : "") + "</option>";
      }).join("");
    }
    function opDil() { return [0, 25, 50, 75, 100].map(function (p) { return '<option value="' + p + '">' + (p ? p + "%" : "não diluir") + "</option>"; }).join(""); }
    el.innerHTML = '<div class="alt-box"><div class="alt-tit">Fluxo personalizado — sem proposta e sem dados do cliente</div>' +
      '<div class="alt-aj" style="margin-bottom:10px">Só no portal (o corretor não tem). Nada é gravado nem enviado: sai um quadro para imprimir ou copiar.' +
      (cfg.origem ? " <b>" + esc(cfg.origem) + "</b>" : "") + "</div>" +
      '<div class="alt-grade">' +
      '<div class="fcampo"><label>Unidade</label><select data-f="un">' + opUn() + "</select></div>" +
      '<div class="fcampo"><label>Valor de venda (R$)</label><input data-f="preco" inputmode="decimal"><span class="alt-aj" data-h="preco"></span></div>' +
      '<div class="fcampo"><label>Financiamento (R$)</label><input data-f="fin" inputmode="decimal"><span class="alt-aj" data-h="fin"></span></div>' +
      '<div class="fcampo"><label>FGTS (R$)</label><input data-f="fgts" inputmode="decimal" placeholder="0,00"></div>' +
      '<div class="fcampo"><label>Subsídio (R$)</label><input data-f="sub" inputmode="decimal" placeholder="0,00"></div>' +
      '<div class="fcampo"><label>Valor para o sinal (R$)</label><input data-f="sinal" inputmode="decimal" placeholder="mínimo"><span class="alt-aj" data-h="sinal"></span></div>' +
      '<div class="fcampo"><label>Sinal em</label><select data-f="ns"><option value="1">1x — à vista, no ato</option><option value="2">2x — ato + 30 dias</option><option value="3">3x — ato + 30/60 dias</option><option value="4" selected>4x — ato + 30/60/90 dias</option></select></div>' +
      '<div class="fcampo"><label>Entrada em</label><select data-f="prazo"><option value="48" selected>48 meses (24 pós-chaves)</option><option value="36">36 meses (12 pós-chaves)</option><option value="24">24 meses (sem pós-chaves)</option></select></div>' +
      '<div class="fcampo"><label>Data de assinatura</label><input data-f="ass" type="date"></div>' +
      '<div class="fcampo"><label>Dia das parcelas</label><input data-f="dia" type="number" min="1" max="31" value="10"></div>' +
      '<div class="fcampo"><label>1ª parcela pré-chaves</label><select data-f="pri"></select></div>' +
      '<div class="fcampo"><label>Diluir balão de dez/2027</label><select data-f="d1">' + opDil() + "</select></div>" +
      '<div class="fcampo"><label>Diluir balão da entrega</label><select data-f="d2">' + opDil() + "</select></div>" +
      "</div>" +
      '<div class="fxp-chips" data-z="chips"></div><div data-z="msgCond" style="margin-top:10px"></div>' +
      '<div data-z="editor" style="display:none">' +
      '<div class="fxp-sub">Fluxo — mexa em qualquer valor: a linha fica travada 🔒 e as outras se ajustam pela régua do simulador</div>' +
      '<div class="fxp-barra"><button type="button" class="bt ghost" data-b="add">＋ Linha</button><button type="button" class="bt ghost" data-b="enc" title="Arruma as pré-chaves mês a mês, sem mês repetido nem vazio">Encaixar as pré-chaves</button>' +
      '<button type="button" class="bt ghost" data-b="solta">Destravar tudo</button><button type="button" class="bt ghost" data-b="padrao">Voltar ao fluxo padrão</button></div>' +
      '<div class="fxp-rol"><table class="fxp-tab"><thead><tr><th></th><th>Tipo</th><th>Valor de cada (R$)</th><th>Qtde</th><th>1ª data</th><th>Última</th><th style="text-align:right">Total</th><th>Descrição</th><th></th></tr></thead><tbody data-z="linhas"></tbody></table></div>' +
      '<div class="fxp-chips" data-z="somas"></div><div data-z="msgFluxo" style="margin-top:10px"></div>' +
      '<div class="fxp-barra"><button type="button" class="bt verde" data-b="pdf">🖨 Imprimir / salvar em PDF</button><button type="button" class="bt az" data-b="copiar">Copiar como texto</button><span class="alt-aj" data-z="msgSaida"></span></div>' +
      '<div class="fxp-folha" data-z="folha"></div></div>' +
      '<div class="fxp-barra"><button type="button" class="bt ghost" data-b="fechar">Fechar</button></div></div>';
    function f(n) { return $('[data-f="' + n + '"]'); }
    function z(n) { return $('[data-z="' + n + '"]'); }
    function aviso(cls, html) { return '<div class="sim-aviso ' + cls + '" style="margin:0 0 8px">' + html + "</div>"; }

    function opcoesPri() {
      var ass = f("ass").value, dia = Math.round(Number(f("dia").value) || 0), s = f("pri"), antes = s.value, hoje = hojeIso();
      if (!parse(ass) || dia < 1 || dia > 31) { s.innerHTML = ""; return; }
      s.innerHTML = opcoesPrimeira(ass < hoje ? hoje : ass, hoje, dia).map(function (o) {
        var n = Math.max(0, (2028 * 12 + 10) - (o.y * 12 + o.m) + 1);
        return '<option value="' + o.y + "-" + pad(o.m) + '">' + MESES[o.m - 1] + "/" + o.y + " — " + n + " parcelas</option>";
      }).join("");
      if (antes && Array.prototype.some.call(s.options, function (o) { return o.value === antes; })) s.value = antes;
    }
    function condicoes() {
      return { preco: num(f("preco").value), aval: sel ? Number(sel.avaliacao) || 0 : 0, fin: num(f("fin").value), fgts: num(f("fgts").value), sub: num(f("sub").value),
               sinal: num(f("sinal").value), nSinal: Number(f("ns").value), prazo: Number(f("prazo").value), assinatura: f("ass").value,
               dia: Number(f("dia").value), primeira: f("pri").value, diluir: [Number(f("d1").value), Number(f("d2").value)] };
    }
    function escolher(n, mantem) {
      var u = UN.filter(function (x) { return String(x.unidade) === String(n); })[0];
      if (!u) { sel = null; z("editor").style.display = "none"; z("chips").innerHTML = ""; z("msgCond").innerHTML = ""; return; }
      sel = u;
      f("preco").value = din(u.valorVenda);
      if (!mantem) {
        f("fin").value = din(Math.min(r2(Number(u.avaliacao) * 0.8), Math.max(0, Number(u.valorVenda) - 10000)));
        f("sinal").value = "";
      }
      recalcular(true);
    }
    function recalcular(forcar) {
      if (!sel) return;
      if (editado && !forcar && !confirm("Mudar as condições refaz o fluxo padrão e apaga os ajustes feitos nas linhas. Refazer?")) return;
      var cnd = condicoes(), teto = r2(cnd.aval * 0.8);
      $('[data-h="preco"]').textContent = r2(cnd.preco) !== r2(sel.valorVenda) ? "tabela: " + brl(sel.valorVenda) : "valor de tabela";
      $('[data-h="fin"]').textContent = "até 80% da avaliação: " + brl(teto);
      res = gerar(cnd, hojeIso());
      if (res.erro) {
        z("msgCond").innerHTML = aviso("err", esc(res.erro) + (res.finMax ? ' <button type="button" class="bt ghost" data-b="finmax">Usar ' + brl(res.finMax) + "</button>" : ""));
        z("chips").innerHTML = ""; z("editor").style.display = "none"; fluxo = null; return;
      }
      var g = res.g;
      z("msgCond").innerHTML = "";
      $('[data-h="sinal"]').textContent = "mínimo desta casa: " + brl(g.sinalMinimo) +
        (cnd.sinal && cnd.sinal < g.sinalMinimo ? " — abaixo do mínimo, vale o mínimo" : (cnd.sinal > res.entrada ? " — acima da entrada, vale a entrada" : ""));
      z("chips").innerHTML = '<div class="fxp-chip">Entrada do cliente<b>' + brl(res.entrada) + '</b></div><div class="fxp-chip">Sinal<b>' + brl(g.sinaisTotal) +
        '</b></div><div class="fxp-chip">Restante da entrada<b>' + brl(res.entrada - g.sinaisTotal) + '</b></div><div class="fxp-chip">Financiamento<b>' + brl(cnd.fin) + "</b></div>" +
        (cnd.fgts + cnd.sub > 0 ? '<div class="fxp-chip">FGTS + subsídio<b>' + brl(cnd.fgts + cnd.sub) + "</b></div>" : "");
      fluxo = JSON.parse(JSON.stringify(res.padrao)); travas = travasIniciais(fluxo.linhas); editado = false; mudou = []; msgGuia = "";
      z("editor").style.display = ""; desenhar();
    }
    function desenhar() {
      var v = F.validar(fluxo, res.padrao), tb = [];
      fluxo.linhas.forEach(function (l, k) {
        var tp = F.TIPOS[l.t] || { nome: l.t }, tot = F.totalLinha(l), cls = [];
        if (mudou.indexOf(k) >= 0) cls.push("fxp-mudou");
        if (v.porLinha[k]) cls.push("fxp-erro");
        if (tp.fixo) {
          tb.push('<tr class="fxp-fixo"><td></td><td>' + esc(tp.nome) + '</td><td class="fxp-n">' + din(l.v) + '</td><td></td><td colspan="2" class="fxp-min">não é pago à incorporadora — muda nas condições</td><td class="fxp-n">' + brl(tot) + "</td><td></td><td></td></tr>");
          return;
        }
        var guiavel = l.t === "pre" || l.t === "balao" || l.t === "pos", ult = ultimaData(l);
        tb.push('<tr class="' + cls.join(" ") + '" data-k="' + k + '"><td>' +
          (guiavel ? '<button type="button" class="fxp-ic' + (travas[k] ? " on" : "") + '" data-a="trava" aria-label="' + (travas[k] ? "Soltar a linha" : "Travar a linha") + '" title="' +
            (travas[k] ? "Travada: não muda no ajuste automático. Clique para soltar." : "Solta: se ajusta sozinha. Clique para travar.") + '">' + (travas[k] ? "🔒" : "🔓") + "</button>" : "") + "</td>" +
          '<td><select data-c="t">' + EDITAVEIS.map(function (t) { return '<option value="' + t + '"' + (t === l.t ? " selected" : "") + ">" + esc(F.TIPOS[t].nome) + "</option>"; }).join("") + "</select></td>" +
          '<td><input class="fxp-v" data-c="v" inputmode="decimal" value="' + din(l.v) + '">' + (l.u ? '<div class="fxp-min">última: ' + din(l.u) + "</div>" : "") + "</td>" +
          '<td><input class="fxp-q" data-c="n" type="number" min="1" max="60" value="' + l.n + '">' + (l.t === "pre" ? '<div class="fxp-min">cabem ' + F.cabemPre(fluxo, k) + "</div>" : "") + "</td>" +
          '<td><input data-c="d" type="date" value="' + esc(l.d) + '"></td>' +
          '<td style="white-space:nowrap">' + (ult ? F.dataBR(ult) : "—") + "</td>" +
          '<td class="fxp-n"><b>' + brl(tot) + "</b></td>" +
          '<td><input class="fxp-x" data-c="x" maxlength="120" value="' + esc(l.x) + '" placeholder="' + esc(tp.reajuste || "opcional") + '"></td>' +
          '<td style="white-space:nowrap"><button type="button" class="fxp-ic" data-a="absorver" title="Esta linha absorve a diferença inteira" aria-label="Esta linha absorve a diferença">↻</button>' +
          '<button type="button" class="fxp-ic" data-a="tirar" title="Tirar a linha" aria-label="Tirar a linha">✕</button></td></tr>');
      });
      z("linhas").innerHTML = tb.join("");
      var pago = F.soma(fluxo.linhas.filter(function (l) { return !(F.TIPOS[l.t] || {}).terceiro; }));
      z("somas").innerHTML = '<div class="fxp-chip">Valor da casa<b>' + brl(fluxo.valor) + '</b></div><div class="fxp-chip">Soma das linhas<b>' + brl(F.soma(fluxo.linhas)) +
        '</b></div><div class="fxp-chip">Pago à incorporadora<b>' + brl(pago) + '</b></div><div class="fxp-chip ' + (v.diferenca ? "ruim" : "bom") + '">' +
        (v.diferenca > 0 ? "Faltam" : v.diferenca < 0 ? "Sobram" : "Diferença") + "<b>" + brl(Math.abs(v.diferenca)) + "</b></div>";
      var h = "";
      if (msgGuia) h += aviso("err", esc(msgGuia));
      if (!v.ok) h += aviso("err", "<b>Enquanto isto não fechar, o fluxo não é liberado:</b><ul class=\"fxp-lista\">" + v.erros.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>");
      else h += aviso("ok", "O fluxo fecha ao centavo com o valor da casa e respeita as regras do simulador.");
      if (v.avisos.length) h += aviso("ok", '<ul class="fxp-lista">' + v.avisos.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>");
      z("msgFluxo").innerHTML = h;
      mudou = [];
      saida(v);
    }
    function rotuloUn() { return "Unidade " + sel.unidade + " · Tipo " + (sel.tipo || "—"); }
    function folhaHtml() {
      var T = F.TIPOS, r = resumo(fluxo, rotuloUn(), F.dataBR(hojeIso())), h = "";
      h += '<div class="fxp-sub" style="margin-top:0">Como se chega ao valor</div><table class="fxp-tab"><tbody><tr><td>Valor do imóvel</td><td class="fxp-n"><b>' + brl(fluxo.valor) + "</b></td></tr>";
      r.terceiros.forEach(function (l) { h += "<tr><td>" + esc(T[l.t].nome) + (l.t === "fin" ? " (CAIXA)" : "") + '</td><td class="fxp-n">− ' + brl(F.totalLinha(l)) + "</td></tr>"; });
      h += '<tr><td><b>Pago direto à incorporadora (entrada)</b></td><td class="fxp-n"><b>' + brl(r.pago) + "</b></td></tr></tbody></table>";
      h += '<div class="fxp-sub">Fluxo da entrada</div><table class="fxp-tab"><thead><tr><th>Etapa</th><th>Parcelas</th><th>Vencimento</th><th>Reajuste</th><th style="text-align:right">Total</th></tr></thead><tbody>';
      r.proprias.forEach(function (l) {
        h += "<tr><td>" + esc(T[l.t].nome) + (l.x ? " — " + esc(l.x) : "") + "</td><td>" + r.quanto(l) + "</td><td>" + r.quando(l) + "</td><td>" + (T[l.t].reajuste || "—") + '</td><td class="fxp-n">' + brl(F.totalLinha(l)) + "</td></tr>";
      });
      h += '<tr><td colspan="4"><b>Total da entrada</b></td><td class="fxp-n"><b>' + brl(r.pago) + "</b></td></tr></tbody></table>";
      var ex = F.expandir(r.proprias), porMes = {}, ordem = [];
      ex.forEach(function (p) { var m = p.data.slice(0, 7); if (!porMes[m]) { porMes[m] = []; ordem.push(m); } porMes[m].push(p); });
      h += '<div class="fxp-sub">Mês a mês (' + ordem.length + ' meses)</div><table class="fxp-tab"><thead><tr><th>Mês</th><th>O que vence</th><th style="text-align:right">Total do mês</th></tr></thead><tbody>';
      ordem.forEach(function (m) {
        var ps = porMes[m], tot = ps.reduce(function (s, p) { return s + c(p.valor); }, 0) / 100;
        h += '<tr><td style="white-space:nowrap">' + m.slice(5) + "/" + m.slice(0, 4) + "</td><td>" + ps.map(function (p) { return esc(p.rotulo) + " " + brl(p.valor) + " (dia " + p.data.slice(8) + ")"; }).join(" · ") + '</td><td class="fxp-n">' + brl(tot) + "</td></tr>";
      });
      h += "</tbody></table>" + LEGAL.map(function (t) { return '<p class="fxp-min" style="white-space:normal;margin:8px 0 0">' + t + "</p>"; }).join("");
      texto = r.texto;
      return h;
    }
    function saida(v) {
      $('[data-b="pdf"]').disabled = $('[data-b="copiar"]').disabled = !v.ok;
      z("msgSaida").textContent = v.ok ? "" : "Feche a conta do fluxo para liberar.";
      if (!v.ok) { z("folha").innerHTML = '<span class="alt-aj">O fluxo ainda não fecha — veja as pendências acima.</span>'; texto = ""; return; }
      z("folha").innerHTML = folhaHtml();
    }
    function imprimir() {
      var w = window.open("", "_blank");
      if (!w) { z("msgSaida").textContent = "O navegador bloqueou a janela de impressão — libere os pop-ups do portal."; return; }
      var css = "body{font-family:'Segoe UI',Arial,sans-serif;color:#2A2118;margin:24px}h1{font-size:18px;color:#7A4A16;margin:0}p.sub{font-size:12.5px;color:#6B5A45;margin:2px 0 0}" +
        ".cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #EFB700;padding-bottom:12px;margin-bottom:6px}.cab img{height:54px}" +
        ".fxp-tab{border-collapse:collapse;width:100%;font-size:12px}.fxp-tab th{text-align:left;font-size:10.5px;text-transform:uppercase;color:#6B5A45;padding:5px 6px;border-bottom:1px solid #E7DCC7}" +
        ".fxp-tab td{padding:4px 6px;border-bottom:1px solid #F1E9D8;vertical-align:top}.fxp-n{text-align:right;white-space:nowrap}.fxp-sub{font-weight:800;font-size:12.5px;color:#7A4A16;text-transform:uppercase;margin:16px 0 6px}" +
        ".fxp-min{font-size:10.5px;color:#6B5A45}tr{break-inside:avoid}";
      w.document.write("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>Reserva do Ipês — " + esc(rotuloUn()) + "</title><style>" + css + "</style></head><body>" +
        '<div class="cab">' + (cfg.logo ? '<img src="' + esc(cfg.logo) + '" alt="">' : "") + "<div><h1>Reserva do Ipês — Fluxo de pagamento</h1><p class=\"sub\">" + esc(rotuloUn()) + " · gerado em " + F.dataBR(hojeIso()) + "</p></div></div>" +
        z("folha").innerHTML + "</body></html>");
      w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) { /* a pessoa imprime pela janela */ } }, 500);
    }
    function guiar() {
      msgGuia = "";
      var r = F.guiar(fluxo, travas, res.padrao);
      if (r.erro) { msgGuia = r.erro; return; }
      fluxo.linhas = r.linhas; mudou = r.mudou || [];
    }
    function encaixar(k) { var r = F.encaixarPre(fluxo, k == null ? null : k); if (r && r.linhas) fluxo.linhas = r.linhas; }
    function renumerar(fn) { var nt = {}; Object.keys(travas).forEach(function (j) { var n = fn(Number(j)); if (n !== null) nt[n] = true; }); travas = nt; }

    el.addEventListener("change", function (e) {
      var a = e.target, cf = a.getAttribute("data-f"), cc = a.getAttribute("data-c");
      if (cf) {
        if (cf === "un") {
          if (editado && !confirm("Trocar de unidade apaga os ajustes feitos no fluxo. Trocar?")) { a.value = sel ? String(sel.unidade) : ""; return; }
          editado = false; escolher(a.value); return;
        }
        if (cf === "ass" || cf === "dia") opcoesPri();
        if (/^(preco|fin|fgts|sub|sinal)$/.test(cf)) { var vv = num(a.value); a.value = vv ? din(vv) : ""; }
        recalcular(false); return;
      }
      if (!cc || !fluxo) return;
      var tr = a.closest("tr[data-k]"); if (!tr) return;
      var k = Number(tr.getAttribute("data-k")), l = fluxo.linhas[k];
      if (cc === "v") { l.v = num(a.value); delete l.u; if (l.t !== "sinal" && l.t !== "entrada") travas[k] = true; }
      else if (cc === "n") { l.n = Math.max(1, Math.round(Number(a.value) || 1)); delete l.u; if (l.t !== "sinal" && l.t !== "entrada") travas[k] = true; if (l.t === "pre") encaixar(k); }
      else if (cc === "d") { l.d = a.value; if (l.t === "pre") encaixar(k); }
      else if (cc === "t") { l.t = a.value; delete travas[k]; }
      else if (cc === "x") l.x = a.value;
      editado = true;
      if (cc !== "x") guiar();
      desenhar();
    });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || !el.contains(b)) return;
      var bb = b.getAttribute("data-b"), a = b.getAttribute("data-a");
      if (bb === "fechar") { if (!editado || confirm("Fechar apaga o fluxo montado (nada foi gravado). Fechar?")) { el.innerHTML = ""; if (cfg.aoFechar) cfg.aoFechar(); } return; }
      if (bb === "finmax") { f("fin").value = din(res.finMax); recalcular(true); return; }
      if (!fluxo) return;
      if (bb === "pdf") { imprimir(); return; }
      if (bb === "copiar") {
        var fim = function (ok) { z("msgSaida").textContent = ok ? "Texto copiado." : "Não consegui copiar — selecione o quadro e copie à mão."; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(function () { fim(true); }, function () { fim(false); }); else fim(false);
        return;
      }
      if (bb === "padrao") { if (!editado || confirm("Voltar ao fluxo padrão apaga os ajustes. Voltar?")) recalcular(true); return; }
      if (bb === "solta") { travas = {}; guiar(); desenhar(); return; }
      if (bb === "enc") { encaixar(null); guiar(); editado = true; desenhar(); return; }
      if (bb === "add") {
        /* linha nova: balão no 1º mês sem balão, valor em branco para digitar; nasce travada para o ajuste não mexer nela */
        var pre = fluxo.linhas.filter(function (l) { return l.t === "pre" && l.d; })[0], d = pre ? F.maisMeses(pre.d, 6) : (fluxo.assinatura || "");
        var ocup = {}; fluxo.linhas.forEach(function (l) { if (l.t === "balao" && l.d) ocup[l.d.slice(0, 7)] = 1; });
        var gd = 0; while (d && ocup[d.slice(0, 7)] && gd++ < 30) d = F.maisMeses(d, 1);
        var pos = -1; fluxo.linhas.forEach(function (l, j) { if (pos < 0 && (l.t === "pos" || (F.TIPOS[l.t] || {}).fixo)) pos = j; });
        if (pos < 0) pos = fluxo.linhas.length;
        renumerar(function (j) { return j >= pos ? j + 1 : j; }); travas[pos] = true;
        fluxo.linhas.splice(pos, 0, { t: "balao", v: 0, n: 1, d: d, i: 1, x: "" });
        editado = true; msgGuia = "Linha nova: digite o valor. As outras linhas se ajustam sozinhas."; desenhar();
        var inp = el.querySelector('tr[data-k="' + pos + '"] input[data-c="v"]'); if (inp) { inp.focus(); inp.select(); }
        return;
      }
      var tr = b.closest("tr[data-k]"); if (!a || !tr) return;
      var k = Number(tr.getAttribute("data-k"));
      if (a === "trava") { if (travas[k]) delete travas[k]; else travas[k] = true; guiar(); }
      else if (a === "absorver") { var r = F.redistribuir(fluxo, k); if (r.erro) msgGuia = r.erro; else { fluxo.linhas = r.linhas; mudou = [k]; msgGuia = ""; } }
      else if (a === "tirar") { fluxo.linhas.splice(k, 1); renumerar(function (j) { return j < k ? j : j > k ? j - 1 : null; }); guiar(); }
      editado = true; desenhar();
    });

    f("ass").value = hojeIso(); f("ass").min = hojeIso();
    if (ini0.nSinal) f("ns").value = String(ini0.nSinal);
    if (ini0.prazo) f("prazo").value = String(ini0.prazo);
    if (ini0.diluir) { f("d1").value = String(ini0.diluir[0] || 0); f("d2").value = String(ini0.diluir[1] || 0); }
    opcoesPri();
    if (ini0.primeira) f("pri").value = String(ini0.primeira).slice(0, 7);
    if (ini0.unidade != null && ini0.unidade !== "") {
      f("un").value = String(ini0.unidade);
      if (ini0.fin) f("fin").value = din(ini0.fin);
      if (ini0.fgts) f("fgts").value = din(ini0.fgts);
      if (ini0.sub) f("sub").value = din(ini0.sub);
      if (ini0.sinal) f("sinal").value = din(ini0.sinal);
      escolher(ini0.unidade, !!ini0.fin);
    }
  }

  return { gerar: gerar, opcoesPrimeira: opcoesPrimeira, ultimaData: ultimaData, travasIniciais: travasIniciais, resumo: resumo, abrir: abrir, brl: brl };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FluxoPersonalizado;
