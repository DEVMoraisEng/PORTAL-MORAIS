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
 * Formatação (negrito, link) de um bloco some só se você EDITAR aquele bloco.
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

  function montar(el, pageId, opts){
    css(); opts=opts||{}; el.classList.add("eb-host");
    const st={pageId, blocos:null, ro:!!opts.somenteLeitura, el};
    el._eb=st;
    el.innerHTML=`<div class="eb-vazio"><span class="load"></span> Carregando conteúdo…</div>`;
    carregar(st,false);
    return st;
  }
  async function carregar(st, fresco){
    const r=await pedir(Object.assign({action:"blocos",pageId:st.pageId}, fresco?{fresco:true}:{}), 60000);
    if(!st.el.isConnected) return;
    if(!r||!r.ok){ st.el.innerHTML=`<div class="eb-vazio">Não consegui abrir o conteúdo (${e((r&&r.erro)||"erro")}). <a href="#" onclick="return false">Tentar de novo</a></div>`;
      st.el.querySelector("a").onclick=()=>{ carregar(st,true); return false; }; return; }
    st.blocos=r.blocos||[];
    pintar(st);
  }
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
    if(t==="child_page"||t==="child_database") return `<div class="eb-b" data-id="${b.id}"><span class="eb-ro">📄 ${e(b.texto||"subpágina")} — abra no Notion</span></div>`;
    return `<div class="eb-b" data-id="${b.id}"><span class="eb-ro">(${e(t)} — este tipo de bloco só aparece no Notion)</span></div>`;
  }
  function lista(bs){ let n=0; return bs.map(b=>{ n=b.tipo==="numbered_list_item"?n+1:0; b._n=n; return linhaBloco(b); }).join(""); }
  function pintar(st){
    const bs=st.blocos||[];
    st.el.innerHTML=`<div class="eb">${bs.length?lista(bs):`<div class="eb-vazio">Sem conteúdo ainda.</div>`}</div>`+
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
    if(st.ro){ el.querySelectorAll("[contenteditable]").forEach(x=>x.removeAttribute("contenteditable")); el.querySelectorAll("input[type=checkbox]").forEach(x=>x.disabled=true); el.querySelectorAll(".eb-x").forEach(x=>x.remove()); return; }
    el.querySelectorAll("[data-t]").forEach(t=>{
      t._orig=t.innerText;
      t.addEventListener("blur",()=>salvarTexto(st,t));
      t.addEventListener("keydown",ev=>teclas(st,t,ev));
      t.addEventListener("paste",ev=>{ ev.preventDefault(); const tx=(ev.clipboardData||window.clipboardData).getData("text"); document.execCommand("insertText",false,tx); });
    });
    el.querySelectorAll("[data-chk]").forEach(c=>c.addEventListener("change",()=>marcar(st,c)));
    el.querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click",()=>apagar(st,b.getAttribute("data-x"))));
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
  window.EditorBlocos={montar, recarregar:(el)=>el&&el._eb&&carregar(el._eb,true)};
})();
