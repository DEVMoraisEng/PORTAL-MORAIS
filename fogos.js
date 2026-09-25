/* fogos.js — PORTAL-MORAIS · fogos de artifício por cima de um cartão.
 * ---------------------------------------------------------------------------
 * Usado no painel quando uma META é batida (só no mês em que ela foi batida)
 * e, na próxima entrega, no dia do ANIVERSÁRIO de alguém.
 *
 * soltarFogos(el, chave, opts)
 *   el     -> o cartão de onde os fogos saem (os estouros ficam em volta dele)
 *   chave  -> identifica o motivo ("vendas-ano-2026-09"...). Os fogos saem
 *             UMA VEZ POR DIA por pessoa para cada chave — abrir o painel de
 *             novo no mesmo dia não repete (combinado em 25/09/26).
 *   opts   -> { forcar:true } ignora o "uma vez por dia" (botão de rever);
 *             { duracao:ms } padrão 4500.
 *
 * É um <canvas> fixo sobre a TELA (não dentro do cartão): o painel repinta os
 * cartões quando o portal.json chega, e um canvas dentro do cartão morreria
 * no meio da animação. Não bloqueia clique (pointer-events:none). Quem pede
 * "reduzir movimento" no sistema não vê a animação — só o selo no cartão.
 * Sem bibliotecas, sem GIF externo (o CSP das páginas publicadas bloquearia).
 * ------------------------------------------------------------------------ */
(function(){
  const CORES = ["#f6c945","#ff6b6b","#4fd1c5","#7ab8ff","#b794f4","#68d391","#ffa94d","#ffffff"];

  function hojeISO(){
    const d=new Date();
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  function quem(){
    try{ const s=(typeof sessao==="function")?sessao():null; return (s&&s.login)||"anon"; }catch(e){ return "anon"; }
  }
  function jaSoltouHoje(chave){
    try{ return localStorage.getItem("fogos:"+quem()+":"+chave)===hojeISO(); }catch(e){ return false; }
  }
  function marcarHoje(chave){
    try{ localStorage.setItem("fogos:"+quem()+":"+chave, hojeISO()); }catch(e){}
  }
  function reduzMovimento(){
    try{ return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){ return false; }
  }

  let canvas=null, ctx=null, particulas=[], foguetes=[], rodando=false, fimEm=0;

  function prepararCanvas(){
    if(canvas) return;
    canvas=document.createElement("canvas");
    canvas.setAttribute("aria-hidden","true");
    canvas.style.cssText="position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
    document.body.appendChild(canvas);
    ctx=canvas.getContext("2d");
    redimensionar();
    window.addEventListener("resize", redimensionar);
  }
  function redimensionar(){
    if(!canvas) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function desmontar(){
    if(!canvas) return;
    window.removeEventListener("resize", redimensionar);
    canvas.remove(); canvas=null; ctx=null; particulas=[]; foguetes=[]; rodando=false;
  }

  function estourar(x,y){
    const cor=CORES[Math.floor(Math.random()*CORES.length)];
    const cor2=CORES[Math.floor(Math.random()*CORES.length)];
    const n=46+Math.floor(Math.random()*24);
    for(let i=0;i<n;i++){
      const ang=(Math.PI*2*i)/n + Math.random()*.2;
      const vel=2.2+Math.random()*3.4;
      particulas.push({x,y,vx:Math.cos(ang)*vel,vy:Math.sin(ang)*vel,vida:1,
        decai:.012+Math.random()*.012,cor:Math.random()<.7?cor:cor2,r:1.6+Math.random()*1.6});
    }
  }
  function lancar(rect){
    // sai de baixo do cartão e estoura em volta dele
    const alvoX=rect.left+Math.random()*rect.width;
    const alvoY=Math.max(30, rect.top-20+Math.random()*(rect.height*.6));
    const x0=alvoX+(Math.random()-.5)*80, y0=Math.min(innerHeight, rect.bottom+140);
    foguetes.push({x:x0,y:y0,tx:alvoX,ty:alvoY,t:0});
  }
  function quadro(){
    if(!ctx){ rodando=false; return; }
    ctx.clearRect(0,0,innerWidth,innerHeight);
    foguetes=foguetes.filter(f=>{
      f.t+=.045;
      const x=f.x+(f.tx-f.x)*f.t, y=f.y+(f.ty-f.y)*f.t;
      ctx.fillStyle="rgba(255,240,200,.95)";
      ctx.beginPath(); ctx.arc(x,y,2.2,0,Math.PI*2); ctx.fill();
      if(f.t>=1){ estourar(f.tx,f.ty); return false; }
      return true;
    });
    particulas=particulas.filter(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=.045; p.vx*=.985; p.vy*=.985; p.vida-=p.decai;
      if(p.vida<=0) return false;
      ctx.globalAlpha=Math.max(0,p.vida);
      ctx.fillStyle=p.cor;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      return true;
    });
    ctx.globalAlpha=1;
    if(performance.now()<fimEm || particulas.length || foguetes.length){ requestAnimationFrame(quadro); }
    else desmontar();
  }

  window.soltarFogos=function(el, chave, opts){
    opts=opts||{};
    if(!el) return false;
    if(!opts.forcar && chave && jaSoltouHoje(chave)) return false;
    if(chave) marcarHoje(chave);
    if(reduzMovimento()) return false;
    prepararCanvas();
    const dur=opts.duracao||4500;
    fimEm=Math.max(fimEm, performance.now()+dur);
    // a posição do cartão é relida a cada lançamento: se o painel repintar
    // ou a tela rolar, os fogos continuam saindo de onde o cartão está
    const seletor=opts.seletor||null;
    const rectAtual=()=>{ const alvo=(seletor&&document.querySelector(seletor))||el; return alvo.getBoundingClientRect(); };
    const total=Math.max(4, Math.round(dur/420));
    for(let i=0;i<total;i++){
      setTimeout(()=>{ if(canvas){ const r=rectAtual(); if(r.width) lancar(r); } }, i*380+Math.random()*200);
    }
    if(!rodando){ rodando=true; requestAnimationFrame(quadro); }
    return true;
  };
})();
