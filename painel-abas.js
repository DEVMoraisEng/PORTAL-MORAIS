/* painel-abas.js — o painel da obra em ABAS, igual ao painel da casa da Gestão de Vendas
 * (06/11/2026, pedido do dono: "replica essa visualização de vendas para documentos,
 * ligações e pós obra").
 *
 * Não muda nada no Notion nem no jeito de salvar: depois que a página desenha o painel,
 * isto só MUDA DE LUGAR as caixas que já estão lá (os mesmos elementos, com os mesmos
 * onchange/onblur), separando-as em abas. Se este arquivo não carregar, o painel fica
 * como era (uma coluna só).
 *
 * Dois jeitos:
 *   PainelAbas.aplicar(corpo, { chave, abas:[[id, título, /regex do rótulo/], …], padrao, ordem, aba })
 *     — cada .campo vai para a 1ª aba cujo regex casa com o rótulo (sem acento, maiúsculo);
 *       nenhum casou → aba `padrao`. Caixa sem rótulo (aviso) acompanha a anterior.
 *       `aba(el, rótulo)` pode decidir antes (ex.: anexos pelo tipo); `ordem` = ordem na barra.
 *   PainelAbas.aplicar(corpo, { chave, secoes:{ seletor, titulo(el), primeira } })
 *     — cada bloco que casa com `seletor` vira uma aba; o resto fica na primeira.
 * A aba escolhida fica guardada por `chave` + `item` (id da obra/linha) enquanto a página
 * estiver aberta: o painel é redesenhado a cada gravação e não pode voltar para a primeira
 * aba sozinho; outra obra começa na primeira.
 * Repositório público: nenhum dado real aqui. */
(function (w) {
  "use strict";
  var ESCOLHIDA = {};
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }
  function estilo() {
    if (document.getElementById("pa-css")) return;
    var st = document.createElement("style"); st.id = "pa-css";
    st.textContent =
      ".pa-barra{position:sticky;top:0;z-index:5;margin:-4px -2px 12px;padding:8px 2px 10px;background:var(--sup,var(--bg2,#fff));border-bottom:1px solid var(--border2,rgba(0,0,0,.08))}" +
      ".pa-tabs{display:flex;flex-wrap:wrap;justify-content:center;gap:4px;padding:4px;border:2px solid var(--verde-btn,#4CD964);border-radius:12px;background:rgba(76,217,100,.06)}" +
      ".pa-tab{padding:7px 12px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#5a7080);" +
      "cursor:pointer;border-radius:8px;border:2px solid transparent;background:none;transition:all .15s;white-space:nowrap}" +
      ".pa-tab:hover{background:rgba(76,217,100,.15);border-color:rgba(76,217,100,.4)}" +
      ".pa-tab.on{background:var(--verde-btn,#4CD964);color:#1a3347;border-color:var(--verde-btn,#4CD964);box-shadow:0 3px 10px rgba(76,217,100,.35)}" +
      ".pa-tab .n{font-weight:700;opacity:.65;margin-left:3px}" +
      ".pa-sec[hidden]{display:none!important}" +
      "@media (max-width:600px){.pa-tab{padding:7px 8px;font-size:11.5px;letter-spacing:.03em}}";
    document.head.appendChild(st);
  }
  function rotulo(el) {
    var l = el.querySelector(":scope>label") || el.querySelector("label");
    return l ? l.textContent : "";
  }
  function montar(corpo, chave, grupos, ref, item) {
    var cheios = grupos.filter(function (g) { return g.els.length; });
    if (cheios.length < 2) return false;            // uma aba só: fica como estava
    estilo();
    /* marca onde começavam as caixas ANTES de mexer nelas: avisos de cima (ex.: "falta preencher")
       continuam em cima das abas */
    var marca = document.createComment("pa");
    corpo.insertBefore(marca, ref && ref.parentNode === corpo ? ref : corpo.firstChild);
    /* a aba escolhida vale para o MESMO item (o painel é redesenhado a cada gravação);
       abrir outra obra/linha começa na primeira aba */
    var guard = ESCOLHIDA[chave], atual = guard && guard.item === item ? guard.aba : null;
    if (!cheios.some(function (g) { return g.id === atual; })) atual = cheios[0].id;
    var barra = document.createElement("div"); barra.className = "pa-barra";
    var tabs = document.createElement("div"); tabs.className = "pa-tabs"; tabs.setAttribute("role", "tablist");
    barra.appendChild(tabs);
    var secs = [];
    cheios.forEach(function (g) {
      var b = document.createElement("button"); b.type = "button"; b.className = "pa-tab" + (g.id === atual ? " on" : "");
      b.setAttribute("role", "tab"); b.setAttribute("data-pa", g.id); b.textContent = g.titulo;
      tabs.appendChild(b);
      var s = document.createElement("div"); s.className = "pa-sec"; s.setAttribute("data-pa", g.id);
      if (g.id !== atual) s.hidden = true;
      g.els.forEach(function (e) { s.appendChild(e); });
      secs.push(s);
    });
    tabs.addEventListener("click", function (ev) {
      var b = ev.target.closest(".pa-tab"); if (!b) return;
      var id = b.getAttribute("data-pa"); ESCOLHIDA[chave] = { item: item, aba: id };
      tabs.querySelectorAll(".pa-tab").forEach(function (x) { x.classList.toggle("on", x === b); });
      secs.forEach(function (s) { s.hidden = s.getAttribute("data-pa") !== id; });
      try { corpo.scrollTop = 0; } catch (e) {}
    });
    corpo.insertBefore(barra, marca);
    secs.forEach(function (s) { corpo.insertBefore(s, marca); });
    marca.remove();
    return true;
  }
  function aplicar(corpo, op) {
    if (!corpo || !op) return false;
    if (corpo.querySelector(":scope>.pa-barra")) return false;
    var chave = op.chave || "painel", item = op.item == null ? "" : String(op.item);
    try {
      if (op.secoes) {
        var sel = op.secoes.seletor, filhos = Array.prototype.slice.call(corpo.children);
        var ref0 = filhos.filter(function (e) { return e.matches(sel) || e.matches(".campo") || e.querySelector(".campo"); })[0] || null;
        var g0 = { id: "s0", titulo: op.secoes.primeira || "Geral", els: [] }, gs = [g0];
        filhos.forEach(function (e, i) {
          if (e.matches(sel)) gs.push({ id: "s" + gs.length, titulo: (op.secoes.titulo ? op.secoes.titulo(e) : "") || ("Parte " + gs.length), els: [e] });
          else if (!ref0 || e === ref0 || (ref0.compareDocumentPosition(e) & 4)) g0.els.push(e);   // depois do 1º campo
        });
        return montar(corpo, chave, gs, ref0, item);
      }
      var abas = (op.abas || []).map(function (a) { return { id: a[0], titulo: a[1], re: a[2], els: [] }; });
      var padrao = abas.filter(function (a) { return a.id === op.padrao; })[0] || abas[abas.length - 1];
      var campos = Array.prototype.slice.call(corpo.querySelectorAll(".campo"));
      var ultima = null;
      campos.forEach(function (c) {
        if (c.parentElement && c.parentElement.closest(".campo")) return;     // caixa dentro de outra caixa: vai junto
        var r = norm(rotulo(c)), alvo = null;
        if (op.aba) { var id = op.aba(c, r); if (id) alvo = abas.filter(function (a) { return a.id === id; })[0] || null; }
        if (alvo) {}
        else if (!r) alvo = ultima || padrao;
        else for (var i = 0; i < abas.length && !alvo; i++) if (abas[i].re && abas[i].re.test(r)) alvo = abas[i];
        alvo = alvo || padrao; alvo.els.push(c); ultima = alvo;
      });
      /* ordem das abas na barra (op.ordem) é independente da ordem das regras */
      if (op.ordem) abas.sort(function (a, b) { var x = op.ordem.indexOf(a.id), y = op.ordem.indexOf(b.id); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
      var filhos0 = Array.prototype.slice.call(corpo.children);
      var ref1 = filhos0.filter(function (e) { return e.matches(".campo") || e.querySelector(".campo"); })[0] || null;
      var antes = filhos0.filter(function (e) { return !e.classList.contains("campo") && e.querySelector(".campo"); });
      if (!montar(corpo, chave, abas, ref1, item)) return false;
      /* blocos que tinham caixas e ficaram vazios (título "Dados da obra" sem as caixas) saem;
         o resto (aviso, botão de arquivar) fica embaixo das abas, visível em todas */
      antes.forEach(function (e) {
        if (!e.parentNode || e.classList.contains("pa-sec") || e.classList.contains("pa-barra")) return;
        if (!e.querySelector(".campo,button,input,select,textarea,a,img")) e.remove();
      });
      return true;
    } catch (e) { try { console.warn("painel-abas:", e); } catch (x) {} return false; }
  }
  w.PainelAbas = { aplicar: aplicar, norm: norm };
})(window);
