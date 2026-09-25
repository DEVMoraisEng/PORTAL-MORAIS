/* atv-alertas.js — PORTAL-MORAIS · 25/09/26
 * Sino no cabeçalho (painel e Atividades) com as MINHAS atividades atrasadas
 * e as que vencem hoje — de todas as abas (Atividades, Obras, Vendas,
 * Documentos). Clicar abre a lista; clicar num item leva até ele.
 * Fonte: ação atvAlertas (RetaFinal.gs). Mostra a cópia salva na hora e
 * atualiza por trás; relê a cada 5 minutos e quando o ao vivo avisa.
 * v2: a mesma chamada traz as atividades da pessoa (comDados) e guarda no
 * navegador — a aba Atividades já abre pronta. ADM/MASTER também deixam a
 * visão da Equipe pré-carregada.
 */
(function(){
  if(typeof document==="undefined") return;
  const CSS=`
  .aa-sino{position:relative;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:20px;padding:6px 12px;
    font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;background:#c0392b;color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.25);
    animation:aa-pulso 2.2s ease-in-out infinite}
  .aa-sino.so-hoje{background:#E67E22;animation:none}
  @keyframes aa-pulso{0%,100%{box-shadow:0 0 0 2px rgba(255,255,255,.25)}50%{box-shadow:0 0 0 6px rgba(192,57,43,.35)}}
  .aa-caixa{position:fixed;z-index:9990;width:min(420px,94vw);max-height:70vh;overflow:auto;background:var(--sup,#fff);color:var(--text,#1a3347);
    border:1px solid var(--border2,#d0e4ec);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.28);display:none}
  .aa-caixa.on{display:block}
  .aa-h{font-family:'Barlow Condensed';font-weight:800;font-size:15px;letter-spacing:.4px;text-transform:uppercase;padding:11px 14px 6px;color:var(--azul-esc,#1e3f58)}
  .aa-i{display:block;padding:9px 14px;border-top:1px solid var(--border2,#d0e4ec);text-decoration:none;color:inherit}
  .aa-i:hover{background:rgba(41,87,120,.07)}
  .aa-i b{display:block;font-size:13px}
  .aa-i span{font-size:11.5px;color:var(--text3,#5a8099)}
  .aa-i .atr{color:#c0392b;font-weight:800}
  .aa-vazio{padding:12px 14px;color:var(--text4,#8aacbb);font-size:13px}
  html[data-tema="escuro"] .aa-h{color:var(--teal)}`;
  const e=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const br=iso=>iso?iso.slice(8,10)+"/"+iso.slice(5,7):"";
  let dados=null, bt=null, cx=null;

  function montar(){
    if(bt) return;
    const alvo=document.querySelector("header .user"); if(!alvo) return;
    const s=document.createElement("style"); s.textContent=CSS; document.head.appendChild(s);
    bt=document.createElement("button"); bt.type="button"; bt.className="aa-sino"; bt.style.display="none";
    bt.title="Suas atividades atrasadas e as que vencem hoje";
    alvo.insertBefore(bt, alvo.firstChild);
    cx=document.createElement("div"); cx.className="aa-caixa"; document.body.appendChild(cx);
    bt.addEventListener("click",ev=>{ ev.stopPropagation(); const r=bt.getBoundingClientRect();
      cx.style.top=(r.bottom+8)+"px"; cx.style.right=Math.max(8,innerWidth-r.right)+"px"; cx.classList.toggle("on"); });
    document.addEventListener("click",ev=>{ if(cx&&!cx.contains(ev.target)) cx.classList.remove("on"); });
  }
  function pintar(r){
    if(!r||!r.ok) return; dados=r; montar(); if(!bt) return;
    const a=r.atrasadas||[], h=r.hoje||[];
    if(!a.length&&!h.length){ bt.style.display="none"; cx.classList.remove("on"); return; }
    bt.style.display="";
    bt.classList.toggle("so-hoje",!a.length);
    bt.innerHTML=a.length?`⚠ ${a.length} atrasada${a.length>1?"s":""}${h.length?` · ${h.length} hoje`:""}`:`⏰ ${h.length} vence${h.length>1?"m":""} hoje`;
    const item=(x,atr)=>`<a class="aa-i" href="${e(x.link)}"><b>${e(x.titulo)}</b><span>${e(x.origem)} · ${atr?`<span class="atr">venceu ${br(x.fim)}</span>`:"vence hoje"}</span></a>`;
    cx.innerHTML=(a.length?`<div class="aa-h">Atrasadas (${a.length})</div>`+a.map(x=>item(x,true)).join(""):"")+
      (h.length?`<div class="aa-h">Vencem hoje (${h.length})</div>`+h.map(x=>item(x,false)).join(""):"");
  }
  async function atualizar(fresco){
    if(typeof sessao!=="function"||!sessao()) return;
    try{
      const r=await ler(Object.assign({action:"atvAlertas",comDados:true},fresco?{fresco:true}:{}),"atv_alertas");
      pintar(r);
      if(r&&r.ok&&r.minhas&&typeof cacheSet==="function"){ cacheSet("atv_minhas",r.minhas); if(r.outras) cacheSet("atv_outras",r.outras); }
    }catch(err){}
    try{
      const s=sessao(), t=String((s&&s.tipo)||"").toUpperCase();
      if(!fresco&&(t==="ADM"||t==="MASTER")&&!/atividades\.html/.test(location.pathname)){
        const c=typeof cacheGet==="function"?cacheGet("atv_equipe"):null;
        if(!c||Date.now()-c.t>10*60*1000) ler({action:"atvEquipe"},"atv_equipe").catch(()=>{});
      }
    }catch(err){}
  }
  function iniciar(){
    try{ const c=cacheGet("atv_alertas"); if(c&&c.v) pintar(c.v); }catch(err){}
    /* na própria aba Atividades a tela já pede tudo; o sino espera para não disputar a fila */
    setTimeout(()=>atualizar(false),/atividades\.html/.test(location.pathname)?20000:1200);
    setInterval(()=>atualizar(false),5*60*1000);
  }
  window.addEventListener("portal-ao-vivo",ev=>{ const d=ev.detail||{}; if(/^atv/.test(d.acao||"")) setTimeout(()=>atualizar(false),1500); });
  window.AtvAlertas={atualizar, pintar};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",iniciar); else iniciar();
})();
