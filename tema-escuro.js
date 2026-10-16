/* tema-escuro.js — PORTAL-MORAIS · 16/10/26
 * ---------------------------------------------------------------------------
 * MODO ESCURO LEGÍVEL EM TODAS AS TELAS (portal e mapa de obras).
 *
 * O problema: cada página tem as suas cores escritas para o tema claro
 * (azul-escuro, verde-escuro, vermelho, roxo…). No tema escuro, onde ninguém
 * escreveu a regra "html[data-tema=escuro] …", o texto ficava escuro em cima
 * de fundo escuro — calendários, cartões de número, títulos de seção em faixa
 * verde, os nomes das pastas em "Projetos para aprovação" etc.
 *
 * O que este arquivo faz (só quando o tema é o ESCURO):
 *   1) algumas correções diretas de CSS para o que foi medido nas telas;
 *   2) uma conferência de contraste automática: para cada texto visível,
 *      compara a cor da letra com a cor do fundo de verdade (sobe pelos pais
 *      até achar um fundo) e, se o contraste ficar abaixo de 4,5:1, clareia
 *      (ou escurece, se o fundo for claro) a MESMA cor até ficar legível —
 *      vermelho continua vermelho, verde continua verde, só mais claro;
 *   3) repete só no que mudou na tela (listas que chegam depois, abas,
 *      janelas) e desfaz tudo ao voltar para o tema claro.
 * Carregado pelo app.js (todas as páginas que usam ele) e pelo mapa de obras.
 * ------------------------------------------------------------------------ */
(function(){
  if(window.__temaEscuroOk) return; window.__temaEscuroOk=true;
  const H=document.documentElement;
  const escuro=()=>H.dataset.tema==="escuro";

  /* ---------- 1) correções diretas ---------- */
  const CSS=`
  html[data-tema="escuro"] .icard .ival,html[data-tema="escuro"] .ival{color:#e7f3ff}
  html[data-tema="escuro"] .cal-mes,html[data-tema="escuro"] .cal-topo .cal-mes{color:var(--teal,#8FDCD2)}
  html[data-tema="escuro"] .cal-topo .bt.ghost,html[data-tema="escuro"] .bt.ghost{background:#1c3b4d;color:#8fd3ee}
  html[data-tema="escuro"] .proj-card{background:var(--sup,#16293a);border-color:var(--border2,#23404f)}
  html[data-tema="escuro"] .proj-card .cond{color:var(--teal,#8FDCD2)}
  html[data-tema="escuro"] .proj-card .d{color:var(--text3,#8fb3c6)}
  html[data-tema="escuro"] .cal-dia .cal-num{color:#cfe6f2}
  html[data-tema="escuro"] .flt.o,html[data-tema="escuro"] .flts .flt.o{color:#0c2d1a}
  html[data-tema="escuro"] input::placeholder,html[data-tema="escuro"] textarea::placeholder{color:#7f9cad;opacity:1}
  html[data-tema="escuro"] select option{background:#16293a;color:#e3eef4}`;
  function css(){ if(document.getElementById("tema-escuro-css")) return; const s=document.createElement("style"); s.id="tema-escuro-css"; s.textContent=CSS; (document.head||H).appendChild(s); }

  /* ---------- 2) conferência de contraste ---------- */
  const rgb=c=>{ const m=String(c||"").match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; };
  const lum=c=>{ const f=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  const contraste=(a,b)=>{ const x=lum(a), y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  function hsl(c){ let r=c.r/255,g=c.g/255,b=c.b/255; const mx=Math.max(r,g,b), mn=Math.min(r,g,b); let h=0,s=0,l=(mx+mn)/2;
    if(mx!==mn){ const d=mx-mn; s=l>.5?d/(2-mx-mn):d/(mx+mn); h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4; h/=6; } return {h,s,l}; }
  function deHsl(h,s,l){ const f=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
    let r,g,b; if(!s){ r=g=b=l; } else { const q=l<.5?l*(1+s):l+s-l*s, p=2*l-q; r=f(p,q,h+1/3); g=f(p,q,h); b=f(p,q,h-1/3); }
    return {r:Math.round(r*255),g:Math.round(g*255),b:Math.round(b*255),a:1}; }
  const MEMO=new Map();
  function ajustar(fg,bg){
    const k=fg.r+","+fg.g+","+fg.b+"|"+bg.r+","+bg.g+","+bg.b; if(MEMO.has(k)) return MEMO.get(k);
    const x=hsl(fg), claro=lum(bg)<0.35; let out=null;
    for(let i=1;i<=25;i++){ const l=claro?Math.min(1,x.l+i*0.035):Math.max(0,x.l-i*0.035), c=deHsl(x.h,Math.min(1,x.s*(claro?0.92:1)),l);
      if(contraste(c,bg)>=4.5){ out="rgb("+c.r+","+c.g+","+c.b+")"; break; } }
    /* sem cor da mesma família que resolva (ex.: branco em verde médio): deixa como está */
    MEMO.set(k,out); return out;
  }
  let BGS=new WeakMap();
  function fundo(el){
    const cad=[]; let e=el, achou=null;
    while(e&&e.nodeType===1){
      if(BGS.has(e)){ achou=BGS.get(e); break; }
      cad.push(e);
      const cs=getComputedStyle(e), c=rgb(cs.backgroundColor);
      if(c&&c.a>0.55){ achou=c; break; }
      const bi=cs.backgroundImage;
      if(bi&&bi!=="none"){ if(/gradient/.test(bi)){ const m=bi.match(/rgba?\([^)]+\)/); const g=m&&rgb(m[0]); if(g&&g.a>0.55){ achou=g; break; } } else { achou="img"; break; } }
      e=e.parentElement;
    }
    if(!achou) achou=rgb(getComputedStyle(document.body).backgroundColor)||{r:15,g:28,b:38,a:1};
    cad.forEach(x=>BGS.set(x,achou));
    return achou;
  }
  const PULA=/^(SCRIPT|STYLE|SVG|PATH|IMG|CANVAS|VIDEO|IFRAME|BR|HR|NOSCRIPT|OPTION)$/;
  function temTexto(e){ if(/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.tagName)) return true;
    for(const n of e.childNodes) if(n.nodeType===3&&n.textContent.trim()) return true; return false; }
  function conferir(e){
    if(PULA.test(e.tagName.toUpperCase())||e.closest("svg")||e.hasAttribute("data-te-pula")) return;
    if(!temTexto(e)) return;
    if(!e.getClientRects().length) return;
    if(e.hasAttribute("data-te-cor")){ const o=e.getAttribute("data-te-cor"); if(o) e.style.color=o; else e.style.removeProperty("color"); e.removeAttribute("data-te-cor"); }
    const cs=getComputedStyle(e); if(cs.visibility==="hidden"||parseFloat(cs.opacity)<0.2) return;
    const fg=rgb(cs.color); if(!fg||fg.a<0.3) return;
    const bg=fundo(e); if(!bg||bg==="img") return;
    if(contraste(fg,bg)>=4.2) return;
    const nova=ajustar(fg,bg); if(!nova) return;
    e.setAttribute("data-te-cor",e.style.color||"");
    e.style.setProperty("color",nova,"important");
  }
  /* em pedaços: tabela grande (vendas, ligações) não trava a tela */
  function passar(raiz){
    if(!escuro()||!raiz) return;
    BGS=new WeakMap();
    if(raiz.nodeType===1) try{ conferir(raiz); }catch(e){}
    const l=raiz.querySelectorAll?raiz.querySelectorAll("*"):[];
    let i=0;
    (function lote(){
      const t0=performance.now();
      for(;i<l.length;i++){ try{ conferir(l[i]); }catch(e){} if((i&63)===0&&performance.now()-t0>40){ i++; setTimeout(lote,16); return; } }
    })();
  }
  function desfazer(){ document.querySelectorAll("[data-te-cor]").forEach(e=>{ const o=e.getAttribute("data-te-cor"); if(o) e.style.color=o; else e.style.removeProperty("color"); e.removeAttribute("data-te-cor"); }); }

  /* ---------- 3) só no que mudou ---------- */
  let fila=new Set(), tm=null, tudo=false;
  function agendar(n){ if(n===document.body||n===H) tudo=true; else if(n) fila.add(n); clearTimeout(tm); tm=setTimeout(rodar,220); }
  function rodar(){
    if(!escuro()){ fila.clear(); tudo=false; return; }
    if(tudo||fila.size>60){ fila.clear(); tudo=false; passar(document.body); return; }
    const l=[...fila].filter(n=>n.isConnected); fila.clear();
    l.filter(n=>!l.some(m=>m!==n&&m.contains(n))).forEach(passar);
  }
  const ob=new MutationObserver(ms=>{
    if(!escuro()) return;
    for(const m of ms){
      if(m.type==="childList"){ m.addedNodes.forEach(n=>{ if(n.nodeType===1) agendar(n); else if(n.nodeType===3&&n.parentElement) agendar(n.parentElement); }); }
      else if(m.type==="attributes"&&m.target.nodeType===1&&m.attributeName==="class") agendar(m.target);
      else if(m.type==="characterData"&&m.target.parentElement) agendar(m.target.parentElement);
    }
  });
  new MutationObserver(()=>{ if(escuro()){ css(); agendar(document.body); } else { clearTimeout(tm); desfazer(); } })
    .observe(H,{attributes:true,attributeFilter:["data-tema"]});
  function iniciar(){
    css();
    if(document.body) ob.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class"],characterData:true});
    if(escuro()){ agendar(document.body); setTimeout(()=>agendar(document.body),1500); }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",iniciar); else iniciar();
  window.TemaEscuro={ conferir:()=>agendar(document.body) };
})();
