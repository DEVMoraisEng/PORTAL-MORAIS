/* editor-blocos.js — PORTAL-MORAIS · 25/09/26
 * ---------------------------------------------------------------------------
 * Editor do CONTEÚDO de uma página do Notion dentro do portal: textos,
 * títulos, listas, checklist (to-do), citações, destaques, divisores e
 * tabelas. Usado na aba Processos (o corpo do processo) e na aba Atividades
 * (checklist e anotações abaixo dos comentários).
 *
 *   EditorBlocos.montar(elemento, pageId, { somenteLeitura, titulo })
 *
 * Como funciona:
 *  - Clica no texto e escreve. Sai do campo (ou Enter) = grava aquele bloco.
 *  - Enter no fim de um item cria o próximo do mesmo tipo (tarefa → tarefa,
 *    lista → lista); Backspace num item vazio apaga o item.
 *  - Caixinha da tarefa grava na hora.
 *  - Tabela: cada célula é um campo; sai da célula = grava a linha.
 *  - Botões no fim: + Texto, + Tarefa, + Título, + Lista, + Citação, + Divisor.
 * Gravação: ações blocoUpdate / blocoNovo / blocoExcluir (RetaFinal.gs).
 * Ao vivo: se outra pessoa mexer nesta página, o conteúdo relê sozinho
 * (só quando você não está digitando nele).
 * v2 (25/09 tarde):
 *  - Abre NA HORA com a última cópia guardada no navegador e atualiza por trás.
 *  - Aceita os dados já prontos (opts.dados — a aba Atividades traz tudo numa
 *    chamada só).
 *  - Texto com negrito/link/menção aparece FORMATADO e com os links clicáveis;
 *    para editar, ✎ (avisa que aquele trecho vira texto simples).
 *  - Subpáginas e links para páginas abrem aqui mesmo, com "← Voltar"
 *    (é assim que a aba Arquivos organiza os documentos).
 * ------------------------------------------------------------------------ */
(function(){
  const ROT={paragraph:"Texto",heading_1:"Título",heading_2:"Título",heading_3:"Subtítulo",bulleted_list_item:"Lista",
    numbered_list_item:"Lista numerada",to_do:"Tarefa",toggle:"Recolhível",quote:"Citação",callout:"Destaque",code:"Código"};
  const CONTINUA={to_do:"to_do",bulleted_list_item:"bulleted_list_item",numbered_list_item:"numbered_list_item"};
  const ESTILO=`
  .eb{display:flex;flex-direction:column;gap:2px}
  .eb-b{position:relative;display:flex;align-items:flex-start;gap:8px;padding:3px 30px 3px 4px;border-radius:7px}
  .eb-b:hover{background:rgba(41,87,120,.06)}
  .eb-b .eb-x{position:absolute;right:4px;top:3px;display:none;border:0;background:transparent;cursor:pointer;color:var(--text4);font-size:13px;padding:2px 5px;border-radius:6px}
  .eb-b:hover .eb-x{display:block}.eb-b .eb-x:hover{background:#fde8e6;color:var(--verm)}
  .eb-t{flex:1;min-width:0;outline:none;white-space:pre-wrap;word-break:break-word;min-height:21px;padding:1px 3px;border-radius:5px}
  .eb-t:focus{background:var(--sup);box-shadow:0 0 0 2px rgba(42,157,92,.35)}
  .eb-t:empty:before{content:attr(data-ph);color:var(--text4)}
  .eb-b.h1 .eb-t,.eb-b.h2 .eb-t{font-family:'Barlow Condensed';font-weight:800;font-size:20px;color:var(--azul-esc);letter-spacing:.3px}
  .eb-b.h3 .eb-t{font-weight:800;font-size:15px;color:var(--azul-esc)}
  .eb-b.quote .eb-t{border-left:3px solid var(--border);padding-left:10px;color:var(--text3)}
  .eb-b.callout{background:#f3f8fa;border:1px solid var(--border2)}
  .eb-b.code .eb-t{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;background:#f1f5f7}
  .eb-b.feito .eb-t{text-decoration:line-through;color:var(--text4)}
  .eb-mk{flex:none;width:18px;text-align:center;color:var(--text3);padding-top:1px}
  .eb-b input[type=checkbox]{width:17px;height:17px;margin:2px 0 0;accent-color:var(--verde);cursor:pointer;flex:none}
  .eb-div{border:0;border-top:1px solid var(--border);margin:8px 0;flex:1}
  .eb-filhos{margin-left:22px}
  .eb-ro{color:var(--text4);font-size:12px;font-style:italic}
  .eb-img{max-width:100%;max-height:340px;border-radius:8px;border:1px solid var(--border2)}
  .eb-tab{overflow-x:auto;flex:1}
  .eb-tab table{border-collapse:collapse;min-width:100%}
  .eb-tab td{border:1px solid var(--border2);padding:0;min-width:110px;vertical-align:top}
  .eb-tab tr.cab td{background:var(--bg3);font-weight:700}
  .eb-tab td div{outline:none;padding:6px 8px;min-height:30px;white-space:pre-wrap}
  .eb-tab td div:focus{background:var(--sup);box-shadow:inset 0 0 0 2px rgba(42,157,92,.35)}
  .eb-add{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .eb-add button{border:1.5px dashed var(--border);background:transparent;color:var(--text3);border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
  .eb-add button:hover{border-color:var(--verde);color:var(--verde-esc)}
  .eb-vazio{color:var(--text4);font-size:13px;padding:6px 4px}
  .eb-rico{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;padding:1px 3px}
  .eb-rico a{color:var(--azul);text-decoration:underline}
  .eb-rico code{background:#eef3f5;border-radius:4px;padding:0 4px;font-size:12.5px}
  .eb-ed{position:absolute;right:26px;top:3px;display:none;border:0;background:transparent;cursor:pointer;color:var(--text4);font-size:12px;padding:2px 5px;border-radius:6px}
  .eb-b:hover .eb-ed{display:block}.eb-ed:hover{background:#e7f0f3;color:var(--azul)}
  .eb-pg{display:inline-flex;align-items:center;gap:7px;font-weight:700;color:var(--azul);cursor:pointer;padding:3px 6px;border-radius:7px}
  .eb-pg:hover{background:#e7f0f3}
  .eb-nav{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12.5px;color:var(--text3)}
  .eb-nav button{border:1.5px solid var(--border);background:var(--sup);border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;font-weight:800;color:var(--azul);cursor:pointer}
  .eb-nav b{color:var(--azul-esc)}
  .eb-att{font-size:11px;color:var(--text4);margin-left:6px}
  .eb-salvando{box-shadow:0 0 0 2px #F0C36D!important}
  .eb-erro{box-shadow:0 0 0 2px var(--verm)!important}
  html[data-tema="escuro"] .eb-b.callout{background:var(--bg3)}
  html[data-tema="escuro"] .eb-b.code .eb-t{background:var(--bg3)}
  html[data-tema="escuro"] .eb-b.h1 .eb-t,html[data-tema="escuro"] .eb-b.h2 .eb-t,html[data-tema="escuro"] .eb-b.h3 .eb-t{color:var(--teal)}`;
  function css(){ if(document.getElementById("eb-css")) return; const s=document.createElement("style"); s.id="eb-css"; s.textContent=ESTILO; document.head.appendChild(s); }
  const e=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function aviso(t){ if(typeof toast==="function") toast(t); else console.log(t); }

  async function pedir(payload, espera){
    try{ return await chamar(payload, espera||45000, true); }catch(err){ return {ok:false,erro:"sem conexão"}; }
  }

  const CK="eb_v2_";
  function guardar(pageId,r){ try{ const k=CK+String(pageId).replace(/-/g,""); localStorage.setItem(k,JSON.stringify({t:Date.now(),r}));
      const idx=JSON.parse(localStorage.getItem(CK+"idx")||"[]").filter(x=>x!==k); idx.push(k);
      while(idx.length>60){ localStorage.removeItem(idx.shift()); } localStorage.setItem(CK+"idx",JSON.stringify(idx)); }catch(err){} }
  function guardado(pageId){ try{ const c=JSON.parse(localStorage.getItem(CK+String(pageId).replace(/-/g,""))||"null"); return c&&c.r; }catch(err){ return null; } }
  function montar(el, pageId, opts){
    css(); opts=opts||{}; el.classList.add("eb-host");
    const st={pageId, raiz:pageId, pilha:[], blocos:null, ro:!!opts.somenteLeitura, el, titulo:opts.titulo||""};
    el._eb=st;
    if(opts.dados&&opts.dados.blocos){ st.blocos=opts.dados.blocos; guardar(pageId,opts.dados); pintar(st); return st; }
    const c=guardado(pageId);
    if(c&&c.blocos){ st.blocos=c.blocos; pintar(st); carregar(st,false,true); }
    else { el.innerHTML=`<div class="eb-vazio"><span class="load"></span> Carregando conteúdo…</div>`; carregar(st,false); }
    return st;
  }
  async function carregar(st, fresco, silencioso){
    const alvo=st.pageId;
    const r=await pedir(Object.assign({action:"blocos",pageId:alvo}, fresco?{fresco:true}:{}), 60000);
    if(!st.el.isConnected||st.pageId!==alvo) return;
    if(!r||!r.ok){ if(silencioso) return;
      st.el.innerHTML=`<div class="eb-vazio">Não consegui abrir o conteúdo (${e((r&&r.erro)||"erro")}). <a href="#" onclick="return false">Tentar de novo</a></div>`;
      st.el.querySelector("a").onclick=()=>{ carregar(st,true); return false; }; return; }
    guardar(alvo,r);
    if(silencioso&&JSON.stringify(r.blocos)===JSON.stringify(st.blocos)) return;
    if(silencioso&&st.el.contains(document.activeElement)) return;      // está digitando: não troca por baixo
    st.blocos=r.blocos||[]; if(r.titulo&&st.pilha.length) st.titulo=r.titulo;
    pintar(st);
  }
  /* subpágina / link para página: abre aqui mesmo, com Voltar */
  function navegar(st, pageId, titulo){
    st.pilha.push({pageId:st.pageId, blocos:st.blocos, titulo:st.titulo});
    st.pageId=pageId; st.titulo=titulo||""; st.blocos=null;
    const c=guardado(pageId);
    if(c&&c.blocos){ st.blocos=c.blocos; pintar(st); carregar(st,false,true); }
    else { st.el.innerHTML=navHtml(st)+`<div class="eb-vazio"><span class="load"></span> Abrindo…</div>`; ligarNav(st); carregar(st,false); }
  }
  function voltar(st){ const a=st.pilha.pop(); if(!a) return; st.pageId=a.pageId; st.blocos=a.blocos; st.titulo=a.titulo; pintar(st); }
  function navHtml(st){ return st.pilha.length?`<div class="eb-nav"><button type="button" data-voltar="1">← Voltar</button><span>📄 <b>${e(st.titulo||"Subpágina")}</b></span></div>`:""; }
  function ligarNav(st){ const b=st.el.querySelector("[data-voltar]"); if(b) b.addEventListener("click",()=>voltar(st)); }
  function rico(rt){
    return rt.map(x=>{ let h=e(x.t);
      if(x.c) h=`<code>${h}</code>`; if(x.b) h=`<b>${h}</b>`; if(x.i) h=`<i>${h}</i>`; if(x.u) h=`<u>${h}</u>`; if(x.s) h=`<s>${h}</s>`;
      if(x.p) h=`<a href="#" data-pg="${e(x.p)}" data-pgt="${e(x.t)}">${h}</a>`;
      else if(x.h) h=`<a href="${e(x.h)}" target="_blank" rel="noopener">${h}</a>`;
      return h; }).join(""); }
  function linhaBloco(b){
    const t=b.tipo, cls={heading_1:"h1",heading_2:"h2",heading_3:"h3",quote:"quote",callout:"callout",code:"code"}[t]||"";
    const x=`<button class="eb-x" data-x="${b.id}" title="Apagar este item" type="button">🗑</button>`;
    if(t==="divider") return `<div class="eb-b" data-id="${b.id}"><hr class="eb-div">${x}</div>`;
    if(b.editavel){
      let mk="";
      if(t==="to_do") mk=`<input type="checkbox" data-chk="${b.id}" ${b.feito?"checked":""} title="Marcar como feito">`;
      else if(t==="bulleted_list_item") mk=`<span class="eb-mk">•</span>`;
      else if(t==="numbered_list_item") mk=`<span class="eb-mk">${b._n||1}.</span>`;
      else if(t==="callout") mk=`<span class="eb-mk">${e(b.icone||"💡")}</span>`;
      else if(t==="toggle") mk=`<span class="eb-mk">▸</span>`;
      const filhos=(b.filhos&&b.filhos.length)?`<div class="eb-filhos">${lista(b.filhos)}</div>`:"";
      if(b.rt&&!b._plano){
        return `<div class="eb-b ${cls} ${t==="to_do"&&b.feito?"feito":""}" data-id="${b.id}">${mk}
          <div class="eb-rico">${rico(b.rt)}</div><button class="eb-ed" type="button" data-ed="${b.id}" title="Editar este trecho (a formatação dele vira texto simples)">✎</button>${x}</div>${filhos}`;
      }
      return `<div class="eb-b ${cls} ${t==="to_do"&&b.feito?"feito":""}" data-id="${b.id}">${mk}
        <div class="eb-t" contenteditable="true" spellcheck="true" data-t="${b.id}" data-tipo="${t}" data-ph="${e(ROT[t]||"Texto")}…">${e(b.texto)}</div>${x}</div>${filhos}`;
    }
    if(t==="table"){
      const rows=(b.linhas||[]).map((r,i)=>`<tr class="${b.cabecalho&&i===0?"cab":""}" data-row="${r.id}">${r.cel.map((c,j)=>
        `<td><div contenteditable="true" data-cel="${r.id}" data-j="${j}">${e(c)}</div></td>`).join("")}</tr>`).join("");
      return `<div class="eb-b" data-id="${b.id}"><div class="eb-tab"><table>${rows}</table></div></div>`;
    }
    if(t==="image") return `<div class="eb-b" data-id="${b.id}">${b.url?`<a href="${e(b.url)}" target="_blank" rel="noopener"><img class="eb-img" src="${e(b.url)}" alt="${e(b.nome)}"></a>`:`<span class="eb-ro">imagem</span>`}${x}</div>`;
    if(b.url) return `<div class="eb-b" data-id="${b.id}"><a href="${e(b.url)}" target="_blank" rel="noopener">📎 ${e(b.nome||b.url)}</a>${x}</div>`;
    if((t==="child_page"||t==="link_to_page")&&b.pagina) return `<div class="eb-b" data-id="${b.id}"><span class="eb-pg" data-pg="${e(b.pagina)}" data-pgt="${e(b.texto)}" title="Abrir">📄 ${e(b.texto||"subpágina")} ›</span></div>`;
    if(t==="child_database") return `<div class="eb-b" data-id="${b.id}"><span class="eb-ro">🗂 ${e(b.texto||"banco")} — abra no Notion</span></div>`;
    return `<div class="eb-b" data-id="${b.id}"><span class="eb-ro">(${e(t)} — este tipo de bloco só aparece no Notion)</span></div>`;
  }
  function lista(bs){ let n=0; return bs.map(b=>{ n=b.tipo==="numbered_list_item"?n+1:0; b._n=n; return linhaBloco(b); }).join(""); }
  function pintar(st){
    const bs=st.blocos||[];
    st.el.innerHTML=navHtml(st)+`<div class="eb">${bs.length?lista(bs):`<div class="eb-vazio">Sem conteúdo ainda.</div>`}</div>`+
      (st.ro?"":`<div class="eb-add">
        <button type="button" data-add="to_do">☑ + Tarefa</button><button type="button" data-add="paragraph">¶ + Texto</button>
        <button type="button" data-add="heading_2">H + Título</button><button type="button" data-add="bulleted_list_item">• + Lista</button>
        <button type="button" data-add="numbered_list_item">1. + Lista numerada</button><button type="button" data-add="quote">❝ + Citação</button>
        <button type="button" data-add="callout">💡 + Destaque</button><button type="button" data-add="divider">— Divisor</button></div>`);
    ligar(st);
  }
  function acha(bs,id){ for(const b of bs){ if(b.id===id) return b; if(b.filhos){ const f=acha(b.filhos,id); if(f) return f; } } return null; }
  function paiDe(bs,id,pai){ for(const b of bs){ if(b.id===id) return {lista:bs,pai}; if(b.filhos){ const f=paiDe(b.filhos,id,b); if(f) return f; } } return null; }
  function ligar(st){
    const el=st.el;
    ligarNav(st);
    el.querySelectorAll("[data-pg]").forEach(a=>a.addEventListener("click",ev=>{ ev.preventDefault(); navegar(st,a.getAttribute("data-pg"),a.getAttribute("data-pgt")); }));
    if(st.ro){ el.querySelectorAll("[contenteditable]").forEach(x=>x.removeAttribute("contenteditable")); el.querySelectorAll("input[type=checkbox]").forEach(x=>x.disabled=true); el.querySelectorAll(".eb-x").forEach(x=>x.remove()); return; }
    el.querySelectorAll("[data-t]").forEach(t=>{
      t._orig=t.innerText;
      t.addEventListener("blur",()=>salvarTexto(st,t));
      t.addEventListener("keydown",ev=>teclas(st,t,ev));
      t.addEventListener("paste",ev=>{ ev.preventDefault(); const tx=(ev.clipboardData||window.clipboardData).getData("text"); document.execCommand("insertText",false,tx); });
    });
    el.querySelectorAll("[data-chk]").forEach(c=>c.addEventListener("change",()=>marcar(st,c)));
    el.querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click",()=>apagar(st,b.getAttribute("data-x"))));
    el.querySelectorAll("[data-ed]").forEach(b=>b.addEventListener("click",()=>{
      if(!confirm("Editar este trecho? A formatação dele (negrito, links) vira texto simples.")) return;
      const bl=acha(st.blocos,b.getAttribute("data-ed")); if(!bl) return; bl._plano=true; pintar(st);
      const n=st.el.querySelector(`[data-t="${bl.id}"]`); if(n) n.focus(); }));
    el.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>novo(st,b.getAttribute("data-add"),null,"",true)));
    el.querySelectorAll("[data-cel]").forEach(c=>{ c._orig=c.innerText; c.addEventListener("blur",()=>salvarLinha(st,c));
      c.addEventListener("keydown",ev=>{ if(ev.key==="Enter"&&!ev.shiftKey){ ev.preventDefault(); c.blur(); } }); });
  }
  async function salvarTexto(st,t){
    const id=t.getAttribute("data-t"), txt=t.innerText.replace(/\n$/,"");
    if(txt===t._orig) return;
    const b=acha(st.blocos,id); if(b) b.texto=txt;
    t._orig=txt; t.classList.add("eb-salvando");
    const r=await (typeof escrever==="function"?escrever({action:"blocoUpdate",blockId:id,pageId:st.pageId,texto:txt},"Conteúdo"):pedir({action:"blocoUpdate",blockId:id,pageId:st.pageId,texto:txt}));
    t.classList.remove("eb-salvando");
    if(!r||!r.ok){ t.classList.add("eb-erro"); aviso("Não salvou este trecho: "+((r&&r.erro)||"erro")); }
    else { if(b){ delete b.rt; } guardar(st.pageId,{blocos:st.blocos}); }
  }
  async function salvarLinha(st,c){
    if(c.innerText===c._orig) return;
    c._orig=c.innerText;
    const rid=c.getAttribute("data-cel");
    const cels=[...st.el.querySelectorAll(`[data-cel="${rid}"]`)].sort((a,b)=>a.getAttribute("data-j")-b.getAttribute("data-j")).map(x=>x.innerText.replace(/\n$/,""));
    c.classList.add("eb-salvando");
    const r=await pedir({action:"blocoUpdate",blockId:rid,pageId:st.pageId,celulas:cels});
    c.classList.remove("eb-salvando");
    if(!r||!r.ok){ c.classList.add("eb-erro"); aviso("Não salvou a linha da tabela: "+((r&&r.erro)||"erro")); }
  }
  async function marcar(st,c){
    const id=c.getAttribute("data-chk"), b=acha(st.blocos,id);
    if(b) b.feito=c.checked;
    const linha=c.closest(".eb-b"); if(linha) linha.classList.toggle("feito",c.checked);
    const r=await (typeof escrever==="function"?escrever({action:"blocoUpdate",blockId:id,pageId:st.pageId,feito:c.checked},"Checklist"):pedir({action:"blocoUpdate",blockId:id,pageId:st.pageId,feito:c.checked}));
    if(!r||!r.ok){ c.checked=!c.checked; if(b) b.feito=c.checked; if(linha) linha.classList.toggle("feito",c.checked); aviso("Não salvou: "+((r&&r.erro)||"erro")); }
    guardar(st.pageId,{blocos:st.blocos});
    if(typeof st.aoMudar==="function") st.aoMudar();
    const ev=new CustomEvent("eb-checklist",{detail:{pageId:st.pageId,blocos:st.blocos}}); window.dispatchEvent(ev);
  }
  function teclas(st,t,ev){
    const tipo=t.getAttribute("data-tipo");
    if(ev.key==="Enter"&&!ev.shiftKey){
      ev.preventDefault();
      const id=t.getAttribute("data-t");
      t.blur();
      novo(st, CONTINUA[tipo]||"paragraph", id, "", true);
    }else if(ev.key==="Backspace"&&!t.innerText.trim()){
      ev.preventDefault(); apagar(st,t.getAttribute("data-t"),true);
    }
  }
  async function novo(st,tipo,depoisDe,texto,focar){
    const temp={id:"tmp"+Date.now(),tipo,texto:texto||"",editavel:tipo!=="divider",feito:false};
    const onde=depoisDe?paiDe(st.blocos,depoisDe):null;
    const arr=onde?onde.lista:st.blocos;
    const idx=depoisDe?arr.findIndex(b=>b.id===depoisDe)+1:arr.length;
    arr.splice(idx,0,temp); pintar(st);
    const payload={action:"blocoNovo",pageId:st.pageId,tipo,texto:texto||""};
    if(onde&&onde.pai) payload.paiId=onde.pai.id;
    if(depoisDe) payload.depoisDe=depoisDe;
    const r=await pedir(payload);
    if(!r||!r.ok||!r.ids||!r.ids[0]){ arr.splice(arr.indexOf(temp),1); pintar(st); aviso("Não criou o item: "+((r&&r.erro)||"erro")); return; }
    temp.id=r.ids[0]; pintar(st);
    if(focar){ const n=st.el.querySelector(`[data-t="${temp.id}"]`); if(n) n.focus(); }
  }
  async function apagar(st,id,focarAnterior){
    const onde=paiDe(st.blocos,id); if(!onde) return;
    const i=onde.lista.findIndex(b=>b.id===id), b=onde.lista[i];
    if(!focarAnterior && b && b.texto && !confirm("Apagar este item?")) return;
    onde.lista.splice(i,1); pintar(st);
    if(focarAnterior&&i>0){ const ant=st.el.querySelector(`[data-t="${onde.lista[i-1].id}"]`); if(ant){ ant.focus(); document.getSelection().selectAllChildren(ant); document.getSelection().collapseToEnd(); } }
    if(String(id).indexOf("tmp")===0) return;
    const r=await pedir({action:"blocoExcluir",blockId:id,pageId:st.pageId});
    if(!r||!r.ok){ onde.lista.splice(i,0,b); pintar(st); aviso("Não apagou: "+((r&&r.erro)||"erro")); }
  }
  /* ao vivo: outra pessoa mexeu nesta página → relê (se eu não estiver digitando nela) */
  window.addEventListener("portal-ao-vivo",ev=>{
    const d=ev.detail||{}; if(!/^bloco/.test(d.acao||"")) return;
    const me=((typeof sessao==="function"&&sessao())||{}).nome||"";
    if(d.quem&&me&&d.quem===me) return;
    document.querySelectorAll(".eb-host").forEach(h=>{
      const st=h._eb; if(!st) return;
      const sid=String(st.pageId).replace(/-/g,""), did=String(d.id||"").replace(/-/g,"");
      if(did&&did!==sid) return;
      if(h.contains(document.activeElement)) return;
      carregar(st,true);
    });
  });
  window.EditorBlocos={montar, recarregar:(el)=>el&&el._eb&&carregar(el._eb,true), guardar, guardado};
})();
