/* atv-contadores.js · PORTAL-MORAIS — 16/11/2026 (dono, itens 5 e 6 das CORREÇÕES)
 * ---------------------------------------------------------------------------
 * Uma régua só para todas as listas de atividades do portal (Vendas,
 * Documentos, Obras, Pós Obra e Atividades):
 *   - quantidade de atividades EM ABERTO no botão "Atividades" de cada setor
 *     (atvBadge);
 *   - contador de DIAS CORRIDOS em cada atividade (atvDiasHtml): conta da DATA
 *     INICIAL da atividade; sem data inicial (ou com a data-lixo 01/01/2000 que
 *     a equipe usa como "sem data"), conta de quando a atividade foi criada.
 *     Atividade concluída para de contar na data da conclusão.
 * Sem dependência de nada: pode ser incluído em qualquer página.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";
  var LIXO = "2000-01-01";
  function iso(v) {
    if (!v) return null;
    var s = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s <= LIXO) return null;
    return s;
  }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  /* dias corridos entre o início e o fim (fim vazio = hoje). null = sem início. */
  function atvDiasCorridos(inicio, criado, fim) {
    var ini = iso(inicio) || iso(criado);
    if (!ini) return null;
    var ate = iso(fim) || hojeISO();
    var n = Math.round((new Date(ate + "T12:00:00") - new Date(ini + "T12:00:00")) / 864e5);
    return n < 0 ? 0 : n;
  }
  function br(s) { return s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : ""; }
  /* selo "⏱ 12 dias" — opc: {inicio, criado, fim, curto} */
  function atvDiasHtml(opc) {
    opc = opc || {};
    var n = atvDiasCorridos(opc.inicio, opc.criado, opc.fim);
    if (n == null) return '<span class="dias-c sem" title="Sem data inicial">⏱ —</span>';
    var desde = iso(opc.inicio) || iso(opc.criado);
    var cls = n >= 30 ? " r" : (n >= 15 ? " a" : "");
    var txt = opc.curto ? (n + "d") : (n + (n === 1 ? " dia" : " dias"));
    var tit = "Dias corridos desde " + br(desde) + (iso(opc.inicio) ? " (data inicial)" : " (criação)") + (iso(opc.fim) ? " até a conclusão em " + br(iso(opc.fim)) : "");
    return '<span class="dias-c' + cls + '" title="' + tit + '">⏱ ' + txt + "</span>";
  }
  /* número de abertas no botão — el: o botão (ou o seletor dele) */
  function atvBadge(el, n) {
    if (typeof el === "string") el = document.querySelector(el);
    if (!el) return;
    var b = el.querySelector(".nb-atv");
    if (n == null || n === "" || isNaN(n)) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("span"); b.className = "nb-atv"; el.appendChild(b); }
    b.textContent = n;
    b.title = n + " atividade(s) em aberto";
  }
  var css = document.createElement("style");
  css.textContent =
    ".dias-c{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;" +
    "background:#e7f0f3;color:#295778;white-space:nowrap}" +
    ".dias-c.a{background:#FFF3E0;color:#B45309}.dias-c.r{background:#f6dede;color:#9b2c2c}.dias-c.sem{opacity:.6}" +
    "html[data-tema=escuro] .dias-c{background:rgba(143,220,210,.14);color:#8FDCD2}" +
    "html[data-tema=escuro] .dias-c.a{background:rgba(230,126,34,.18);color:#f5b26b}" +
    "html[data-tema=escuro] .dias-c.r{background:rgba(192,57,43,.22);color:#f1948a}" +
    ".nb-atv{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:20px;" +
    "background:#295778;color:#fff;font:800 11px Inter,sans-serif;padding:0 6px;margin-left:7px;vertical-align:2px;letter-spacing:0}" +
    ".on>.nb-atv,.tab.on .nb-atv{background:#1a3347}";
  (document.head || document.documentElement).appendChild(css);
  window.atvDiasCorridos = atvDiasCorridos;
  window.atvDiasHtml = atvDiasHtml;
  window.atvBadge = atvBadge;
})();
