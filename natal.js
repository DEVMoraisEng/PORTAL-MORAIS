/* natal.js — PORTAL-MORAIS · tema de Natal (pedido do Morais em 23/11/2026).
 * ---------------------------------------------------------------------------
 * Entra sozinho de 23/11 a 06/01 e some sozinho depois — não precisa tirar.
 *   · neve caindo por alguns segundos toda vez que a pessoa entra numa página;
 *   · pisca-pisca pendurado embaixo do cabeçalho e Papai Noel ao lado do título;
 *   · gorrinho no canto de cada cartão (KPIs, cartões das telas e botões do menu).
 *
 * Tudo é desenhado aqui (canvas, SVG e CSS): sem imagem externa nem biblioteca.
 * Nada disto recebe clique (pointer-events:none) nem ocupa espaço no layout —
 * os enfeites são absolutos, então não mexem na largura das telas no celular.
 * Quem pede "reduzir movimento" no sistema fica só com os enfeites parados.
 *
 * Para testar fora da época:  localStorage.setItem("morais_natal","on")
 * Para desligar neste navegador: localStorage.setItem("morais_natal","off")
 * ------------------------------------------------------------------------ */
(function(){
  "use strict";

  function ativo(){
    try{
      var f = localStorage.getItem("morais_natal");
      if(f === "on") return true;
      if(f === "off") return false;
    }catch(e){}
    var d = new Date(), m = d.getMonth() + 1, dia = d.getDate();
    return (m === 11 && dia >= 23) || m === 12 || (m === 1 && dia <= 6);
  }
  if(!ativo()) return;

  var PARADO = false;
  try{ PARADO = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }catch(e){}

  var CARTOES = ".kpi,.card,.kpi-card,.kpi-ext-card,.icard,.graf-card,.graf-card-full,.roi-card,.rank-card," +
                ".comp-card,.proj-card,.scard,.mcard,.kcard,.nav-btn";
  var GORRO = '<svg viewBox="0 0 30 26" width="30" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
              '<path d="M4 20 C6 9 13 3 22 4 C26 5 28 9 27 14 C25 10 22 9 20 10 C23 13 24 17 24 20 Z" fill="#d62828"/>' +
              '<path d="M9 17 C11 11 15 7 20 6" fill="none" stroke="#f25c5c" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>' +
              '<rect x="2" y="18" width="24" height="6.5" rx="3.2" fill="#ffffff" stroke="#d8e2ea" stroke-width=".6"/>' +
              '<circle cx="27" cy="15" r="3.2" fill="#ffffff" stroke="#d8e2ea" stroke-width=".6"/></svg>';

  /* ── estilo ─────────────────────────────────────────────── */
  function estilo(){
    if(document.getElementById("natal-css")) return;
    var s = document.createElement("style");
    s.id = "natal-css";
    s.textContent =
      ".natal-rel{position:relative}" +
      ".natal-gorro{position:absolute;top:-12px;left:-9px;width:30px;height:26px;transform:rotate(-16deg);" +
        "pointer-events:none;z-index:3;line-height:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}" +
      ".natal-gorro.dentro{top:1px;left:1px;width:22px;height:19px;transform:rotate(-10deg)}" +
      ".natal-gorro svg{width:100%;height:100%;display:block}" +
      ".natal-luzes{position:absolute;left:0;right:0;top:100%;height:18px;margin-top:-5px;pointer-events:none;" +
        "z-index:4;overflow:hidden}" +
      ".natal-luzes::before{content:'';position:absolute;left:0;right:0;top:1px;height:2px;background:#16382a;opacity:.85}" +
      ".natal-luzes i{position:absolute;top:2px;width:8px;height:11px;border-radius:50% 50% 50% 50%/40% 40% 60% 60%;" +
        "background:var(--c);box-shadow:0 0 7px 1px var(--c);animation:natal-pisca 1.8s ease-in-out infinite}" +
      ".natal-luzes i::before{content:'';position:absolute;left:2px;top:-2px;width:4px;height:3px;background:#16382a;border-radius:1px}" +
      ".natal-luzes.parado i{animation:none}" +
      "@keyframes natal-pisca{0%,100%{opacity:1;filter:brightness(1.15)}50%{opacity:.28;filter:brightness(.7)}}" +
      ".natal-noel{display:inline-block;margin-left:8px;font-size:1.15em;line-height:1;vertical-align:-2px;" +
        "pointer-events:none;animation:natal-noel 3.2s ease-in-out infinite;transform-origin:50% 90%}" +
      ".natal-noel.solto{position:absolute;right:10px;bottom:8px;margin:0;font-size:24px;z-index:4}" +
      ".natal-noel.parado{animation:none}" +
      "@keyframes natal-noel{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}" +
      /* celular: o Papai Noel sai da linha do título (senão quebra o cabeçalho) e fica sentado no pisca-pisca */
      "@media(max-width:600px){.natal-noel{position:absolute;right:12px;bottom:-9px;margin:0;font-size:22px;z-index:5}}" +
      "#natal-neve{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:99990;" +
        "transition:opacity 2.2s ease}";
    document.head.appendChild(s);
  }

  /* ── cabeçalho: pisca-pisca + Papai Noel ────────────────── */
  var CORES = ["#ff4d4d", "#ffd23f", "#3ddc84", "#4db8ff", "#ff8fd6"];
  function luzes(h){
    var faixa = h.querySelector(":scope > .natal-luzes");
    if(!faixa){
      faixa = document.createElement("div");
      faixa.className = "natal-luzes" + (PARADO ? " parado" : "");
      faixa.setAttribute("aria-hidden", "true");
      h.appendChild(faixa);
    }
    var larg = h.clientWidth || window.innerWidth, passo = larg < 500 ? 22 : 28;
    var n = Math.max(6, Math.floor(larg / passo));
    if(faixa.childElementCount === n) return;
    var html = "";
    for(var i = 0; i < n; i++){
      html += '<i style="left:' + Math.round(passo / 2 + i * passo - 4) + 'px;--c:' + CORES[i % CORES.length] +
              ';animation-delay:' + ((i % CORES.length) * 0.36).toFixed(2) + 's"></i>';
    }
    faixa.innerHTML = html;
  }
  function noel(h){
    if(h.querySelector(".natal-noel")) return;
    var sp = document.createElement("span");
    sp.className = "natal-noel" + (PARADO ? " parado" : "");
    sp.setAttribute("aria-hidden", "true");
    sp.title = "Feliz Natal!";
    sp.textContent = "🎅";                      /* 🎅 */
    var tit = h.querySelector(".htitle, h1, .pt-title, .titulo, .title, .hd-title");
    if(tit) tit.appendChild(sp);
    else { sp.className += " solto"; h.appendChild(sp); }
  }
  function cabecalho(){
    var h = document.querySelector("header");
    if(!h) return;
    try{
      if(getComputedStyle(h).position === "static") h.classList.add("natal-rel");
      luzes(h);
      noel(h);
    }catch(e){}
  }

  /* ── gorrinho nos cartões ───────────────────────────────── */
  function gorros(){
    var lista;
    try{ lista = document.querySelectorAll(CARTOES); }catch(e){ return; }
    var feitos = 0;
    for(var i = 0; i < lista.length && feitos < 400; i++){
      var c = lista[i];
      if(c.querySelector(":scope > .natal-gorro")) continue;
      if(c.closest(".natal-sem-gorro")) continue;
      if(c.offsetWidth && c.offsetWidth < 70) continue;        /* cartão minúsculo: o gorro tamparia tudo */
      var cs;
      try{ cs = getComputedStyle(c); }catch(e){ continue; }
      if(cs.display === "inline" || cs.display === "contents" || cs.display === "none") continue;
      var g = document.createElement("i");
      g.className = "natal-gorro";
      g.setAttribute("aria-hidden", "true");
      /* cartão que corta o que passa da borda: o gorro vai para dentro do canto */
      if(cs.overflowX !== "visible" || cs.overflowY !== "visible") g.className += " dentro";
      g.innerHTML = GORRO;
      if(cs.position === "static") c.classList.add("natal-rel");
      c.insertBefore(g, c.firstChild);
      feitos++;
    }
  }

  /* ── neve ao entrar ─────────────────────────────────────── */
  function neve(){
    if(PARADO || document.getElementById("natal-neve")) return;
    var cv = document.createElement("canvas");
    cv.id = "natal-neve";
    cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function medir(){
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    medir();
    window.addEventListener("resize", medir);
    var n = W < 600 ? 45 : 110, flocos = [];
    function novo(topo){
      return { x: Math.random() * W, y: topo ? -10 - Math.random() * H * 0.6 : Math.random() * H,
               r: 1.2 + Math.random() * 2.6, v: 0.6 + Math.random() * 1.5,
               b: Math.random() * 6.28, bv: 0.01 + Math.random() * 0.025, a: 0.55 + Math.random() * 0.45 };
    }
    for(var i = 0; i < n; i++) flocos.push(novo(true));
    var inicio = performance.now(), DURA = 14000, parar = false;
    function quadro(t){
      var passou = t - inicio;
      ctx.clearRect(0, 0, W, H);
      var vivos = 0;
      for(var i = 0; i < flocos.length; i++){
        var f = flocos[i];
        f.y += f.v; f.b += f.bv; f.x += Math.sin(f.b) * 0.7;
        if(f.y > H + 8){
          if(passou < DURA){ flocos[i] = f = novo(true); f.y = -8; }
          else continue;
        }
        vivos++;
        ctx.globalAlpha = f.a;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.2832);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(120,170,210,.9)";
        ctx.shadowBlur = 4;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if(passou > DURA && !parar){ parar = true; cv.style.opacity = "0"; }
      if(vivos && passou < DURA + 9000 && !(parar && passou > DURA + 2400)) requestAnimationFrame(quadro);
      else { window.removeEventListener("resize", medir); if(cv.parentNode) cv.parentNode.removeChild(cv); }
    }
    requestAnimationFrame(quadro);
  }

  /* ── liga tudo ──────────────────────────────────────────── */
  var espera = null;
  function enfeitar(){
    espera = null;
    cabecalho();
    gorros();
  }
  function agendar(){ if(espera === null) espera = setTimeout(enfeitar, 350); }
  function iniciar(){
    estilo();
    enfeitar();
    neve();
    /* as telas repintam os cartões quando os dados chegam: repõe os enfeites */
    try{
      new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true });
    }catch(e){}
    window.addEventListener("resize", agendar);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
