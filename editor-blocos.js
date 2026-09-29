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
 * v5 (28/09): as imagens vêm com link assinado do Supabase (o do Notion
 * vencia em 1 h). Se uma imagem não carregar, o conteúdo é relido sozinho
 * (1x por minuto) e ela volta. Links novos a cada leitura não repintam a
 * tela à toa — a comparação ignora o link.
 * v9 (29/09): REORGANIZAR SEM ESPERAR
 *  - Arrastar: segure no ⠿ (aparece à esquerda do item) e solte onde quiser.
 *    Foto, documento e divisor dá para arrastar pegando no próprio item.
 *    Funciona com mouse e no celular (pelo ⠿).
 *  - Nada de "espere terminar a mudança anterior": a tela muda NA HORA e as
 *    mudanças vão para o Notion numa fila, uma atrás da outra (o Notion não
 *    move bloco — o servidor recria, e documento/foto sobe de novo, por isso
 *    demora). Enquanto isso dá para continuar mexendo; o item que ainda está
 *    indo fica com a faixa amarela à esquerda e aparece "Organizando no
 *    Notion (n)…" embaixo.
 *  - A fila fica guardada no navegador: fechou a página no meio, ela termina
 *    na próxima vez que alguma tela com conteúdo abrir.
 *  - Deu erro no meio: o conteúdo é relido do Notion (mostra como ficou de
 *    verdade) e avisa.
 *  - Para o topo: o servidor usa a posição "início" do Notion (v15 do
 *    RetaFinal.gs).
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
  .eb-b .eb-mv{position:absolute;top:3px;display:none;border:0;background:transparent;cursor:pointer;color:var(--text4);font-size:13px;font-weight:800;padding:2px 6px;border-radius:6px}
  .eb-b .eb-mv.up{right:52px}.eb-b .eb-mv.dn{right:28px}
  .eb-b:hover .eb-mv{display:block}.eb-b .eb-mv:hover{background:var(--bg3,#dceaef);color:var(--azul,#295778)}
  .eb{padding-left:20px}
  .eb-b .eb-arr{position:absolute;left:-19px;top:2px;display:none;cursor:grab;color:var(--text4);font-size:15px;line-height:1;padding:3px 3px;border-radius:5px;user-select:none;-webkit-user-select:none;touch-action:none}
  .eb-b:hover .eb-arr{display:block}.eb-b .eb-arr:hover{background:var(--bg3,#dceaef);color:var(--azul,#295778)}
  .eb-b.arrastavel{cursor:grab}
  .eb-b.pendente{box-shadow:inset 3px 0 0 #F0C36D}
  .eb-b.arrastando{opacity:.35}
  .eb-linha{height:3px;background:var(--verde,#2a9d5c);border-radius:2px;margin:-1px 0 -2px;pointer-events:none}
  .eb-fantasma{position:fixed;z-index:10000;pointer-events:none;background:var(--sup,#fff);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.18);padding:5px 10px;max-width:340px;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .eb-fila{font-size:11.5px;font-weight:700;color:#b7791f;margin-top:4px}.eb-fila:empty{display:none}
  body.eb-puxando,body.eb-puxando *{cursor:grabbing!important;user-select:none!important;-webkit-user-select:none!important}
  @media (hover:none){ .eb-b .eb-x,.eb-b .eb-mv,.eb-b .eb-arr{display:block} }
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
  .eb-add button:hover,.eb-anx:hover{border-color:var(--verde);color:var(--verde-esc)}
  .eb-anx{border:1.5px dashed var(--border);background:transparent;color:var(--text3);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center}
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
    if(filaAtiva(alvo)&&!st._forcar&&st.blocos) return;   // v9: a fila de mudanças está indo — ela mesma atualiza no fim
    st._forcar=false;
    if(!r||!r.ok){ if(silencioso) return;
      st.el.innerHTML=`<div class="eb-vazio">Não consegui abrir o conteúdo (${e((r&&r.erro)||"erro")}). <a href="#" onclick="return false">Tentar de novo</a></div>`;
      st.el.querySelector("a").onclick=()=>{ carregar(st,true); return false; }; return; }
    guardar(alvo,r);
    const forcar=st._imgForcar; st._imgForcar=false;
    if(silencioso&&!forcar&&semLinks(r.blocos)===semLinks(st.blocos)) return;
    if(silencioso&&st.el.contains(document.activeElement)) return;      // está digitando: não troca por baixo
    st.blocos=r.blocos||[]; if(r.titulo&&st.pilha.length) st.titulo=r.titulo;
    pintar(st);
  }
  /* compara o conteúdo sem os links (que mudam a cada leitura: são assinados) */
  function semLinks(bs){ try{ return JSON.stringify(bs||[],(k,v)=>k==="url"?undefined:v); }catch(err){ return ""; } }
  /* imagem não carregou (link vencido na cópia do navegador): relê 1x/min */
  function imgFalhou(img){
    if(img.dataset.f) return; img.dataset.f="1";
    const host=img.closest(".eb-host"), st=host&&host._eb; if(!st) return;
    if(st._imgRelido&&Date.now()-st._imgRelido<60000) return;
    st._imgRelido=Date.now(); st._imgForcar=true; carregar(st,false,true);
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
    /* v6 (28/09): ↑ ↓ para reordenar (só itens do primeiro nível) */
    const mv=b._top&&String(b.id).indexOf("tmp")!==0?`<button class="eb-mv up" data-up="${b.id}" title="Subir" type="button">↑</button><button class="eb-mv dn" data-dn="${b.id}" title="Descer" type="button">↓</button>`:"";
    const arr=b._top&&t!=="_enviando"?`<span class="eb-arr" data-arr="1" title="Arraste para mudar de lugar">⠿</span>`:"";
    const x=arr+mv+`<button class="eb-x" data-x="${b.id}" title="Apagar este item" type="button">🗑</button>`;
    if(t==="_enviando") return `<div class="eb-b"><span class="eb-ro"><span class="load"></span> ${e(b.texto)}</span></div>`;
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
    if(t==="image") return `<div class="eb-b" data-id="${b.id}">${b.url?`<a href="${e(b.url)}" target="_blank" rel="noopener" draggable="false"><img class="eb-img" src="${e(b.url)}" alt="${e(b.nome)}" loading="lazy" draggable="false" onerror="EditorBlocos.imgFalhou(this)"></a>`:`<span class="eb-ro">imagem</span>`}${x}</div>`;
    if(b.url) return `<div class="eb-b" data-id="${b.id}"><a href="${e(b.url)}" target="_blank" rel="noopener" draggable="false">📎 ${e(b.nome||b.url)}</a>${x}</div>`;
    if((t==="child_page"||t==="link_to_page")&&b.pagina) return `<div class="eb-b" data-id="${b.id}"><span class="eb-pg" data-pg="${e(b.pagina)}" data-pgt="${e(b.texto)}" title="Abrir">📄 ${e(b.texto||"subpágina")} ›</span></div>`;
    if(t==="child_database") return `<div class="eb-b" data-id="${b.id}"><span class="eb-ro">🗂 ${e(b.texto||"banco")} — abra no Notion</span></div>`;
    return `<div class="eb-b" data-id="${b.id}"><span class="eb-ro">(${e(t)} — este tipo de bloco só aparece no Notion)</span></div>`;
  }
  function lista(bs){ let n=0; return bs.map(b=>{ n=b.tipo==="numbered_list_item"?n+1:0; b._n=n; return linhaBloco(b); }).join(""); }
  const ENVIANDO={};   // pageId → anexos subindo (sobrevive a fechar/abrir a atividade)
  function pintar(st){
    const bs=(st.blocos||[]).concat(ENVIANDO[st.pageId]||[]);        // + anexos ainda subindo
    bs.forEach(b=>{ b._top=true; });
    st.el.innerHTML=navHtml(st)+`<div class="eb">${bs.length?lista(bs):`<div class="eb-vazio">Sem conteúdo ainda.</div>`}</div><div class="eb-fila" data-fila="1">${filaTexto(st.pageId)}</div>`+
      (st.ro?"":`<div class="eb-add">
        <button type="button" data-add="to_do">☑ + Tarefa</button><button type="button" data-add="paragraph">¶ + Texto</button>
        <button type="button" data-add="heading_2">H + Título</button><button type="button" data-add="bulleted_list_item">• + Lista</button>
        <button type="button" data-add="numbered_list_item">1. + Lista numerada</button><button type="button" data-add="quote">❝ + Citação</button>
        <button type="button" data-add="callout">💡 + Destaque</button><button type="button" data-add="divider">— Divisor</button>
        <label class="eb-anx" title="Foto ou documento aqui no corpo (fica junto da descrição)">📎 + Anexo<input type="file" data-anx="1" multiple hidden
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.dwg,.zip,.txt"></label></div>`);
    ligar(st);
  }
  function acha(bs,id){ for(const b of bs){ if(b.id===id) return b; if(b.filhos){ const f=acha(b.filhos,id); if(f) return f; } } return null; }
  function paiDe(bs,id,pai){ for(const b of bs){ if(b.id===id) return {lista:bs,pai}; if(b.filhos){ const f=paiDe(b.filhos,id,b); if(f) return f; } } return null; }
  function ligar(st){
    const el=st.el;
    ligarNav(st);
    el.querySelectorAll("[data-pg]").forEach(a=>a.addEventListener("click",ev=>{ ev.preventDefault(); navegar(st,a.getAttribute("data-pg"),a.getAttribute("data-pgt")); }));
    if(st.ro){ el.querySelectorAll("[contenteditable]").forEach(x=>x.removeAttribute("contenteditable")); el.querySelectorAll("input[type=checkbox]").forEach(x=>x.disabled=true); el.querySelectorAll(".eb-x,.eb-arr,.eb-mv").forEach(x=>x.remove()); return; }
    el.querySelectorAll("[data-t]").forEach(t=>{
      t._orig=t.innerText;
      t.addEventListener("blur",()=>salvarTexto(st,t));
      t.addEventListener("keydown",ev=>teclas(st,t,ev));
      t.addEventListener("paste",ev=>{ ev.preventDefault(); const tx=(ev.clipboardData||window.clipboardData).getData("text"); document.execCommand("insertText",false,tx); });
    });
    el.querySelectorAll("[data-chk]").forEach(c=>c.addEventListener("change",()=>marcar(st,c)));
    el.querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click",()=>apagar(st,b.getAttribute("data-x"))));
    el.querySelectorAll("[data-up]").forEach(b=>b.addEventListener("click",()=>mover(st,b.getAttribute("data-up"),-1)));
    el.querySelectorAll("[data-dn]").forEach(b=>b.addEventListener("click",()=>mover(st,b.getAttribute("data-dn"),1)));
    ligarArrasto(st);
    el.querySelectorAll("[data-ed]").forEach(b=>b.addEventListener("click",()=>{
      if(!confirm("Editar este trecho? A formatação dele (negrito, links) vira texto simples.")) return;
      const bl=acha(st.blocos,b.getAttribute("data-ed")); if(!bl) return; bl._plano=true; pintar(st);
      const n=st.el.querySelector(`[data-t="${bl.id}"]`); if(n) n.focus(); }));
    el.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>novo(st,b.getAttribute("data-add"),null,"",true)));
    const fa=el.querySelector("[data-anx]"); if(fa) fa.addEventListener("change",()=>anexar(st,fa));
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
  /* ---------- REORDENAR (v9, 29/09) ----------
   * O Notion não move bloco: o servidor RECRIA um bloco depois de outro (ou
   * no início) e apaga o antigo. A tela muda na hora; o servidor vai
   * recebendo as mudanças numa FILA por página, uma de cada vez.
   * Cada mudança guarda o OBJETO do bloco (não o id): quando o servidor
   * devolve o id novo do bloco recriado, as mudanças seguintes já usam ele. */
  const FILAS={}, K_FILA="eb_fila_v1";
  const pgId=pg=>String(pg).replace(/-/g,"");
  const ehTmp=b=>!b||String(b.id).indexOf("tmp")===0;
  const ARQ={image:1,file:1,pdf:1,video:1,audio:1};
  const ehArquivo=b=>!!(b&&(ARQ[b.tipo]||(b.url&&!b.editavel)));
  function filaAtiva(pg){ const f=FILAS[pgId(pg)]; return !!(f&&(f.ops.length||f.rodando)); }
  function filaTexto(pg){ const f=FILAS[pgId(pg)], n=f?f.ops.length:0; return n?`⏳ Organizando no Notion (${n})… pode continuar mexendo.`:""; }
  function hostsDe(pg){ return [...document.querySelectorAll(".eb-host")].map(h=>h._eb).filter(x=>x&&pgId(x.pageId)===pgId(pg)); }
  function atualizarFila(pg){ hostsDe(pg).forEach(x=>{ const d=x.el.querySelector("[data-fila]"); if(d) d.textContent=filaTexto(pg);
    x.el.querySelectorAll(".eb > .eb-b[data-id]").forEach(l=>{ const b=(x.blocos||[]).find(y=>y.id===l.getAttribute("data-id")); l.classList.toggle("pendente",!!(b&&b._pend)); }); }); }
  function filaGravar(){ const o={}; Object.keys(FILAS).forEach(pg=>{ const ops=FILAS[pg].ops.filter(op=>!ehTmp(op.alvo)&&(!op.depois||!ehTmp(op.depois)));
      if(ops.length) o[pg]=ops.map(op=>({a:op.alvo.id,d:op.depois?op.depois.id:null,t:op.t})); });
    try{ localStorage.setItem(K_FILA,JSON.stringify(o)); }catch(err){} }
  const dormir=ms=>new Promise(ok=>setTimeout(ok,ms));

  /* ↑ ↓ */
  function mover(st,id,dir){
    const i=st.blocos.findIndex(b=>b.id===id); if(i<0) return;
    moverPara(st,st.blocos[i],i+dir);
  }
  /* põe o bloco b na posição dest (índice na lista já sem ele) */
  function moverPara(st,b,dest){
    const arr=st.blocos, i=arr.indexOf(b);
    if(i<0||dest<0||dest>=arr.length||dest===i) return;
    if(b.filhos&&b.filhos.length){ aviso("Este item tem sub-itens e não dá para mover pelo portal (mova no Notion)."); return; }
    arr.splice(i,1); arr.splice(dest,0,b);
    /* o que recriar: normalmente o próprio bloco. Troca com o vizinho (1 casa)
       e o bloco é foto/documento: recria o vizinho (texto é instantâneo;
       arquivo teria que subir de novo). */
    let alvo=b, depois=dest>0?arr[dest-1]:null;
    if(Math.abs(dest-i)===1&&ehArquivo(b)){
      const viz=dest<i?arr[dest+1]:arr[dest-1];
      if(viz&&!ehArquivo(viz)&&!(viz.filhos&&viz.filhos.length)){
        alvo=viz; depois=dest<i?b:(i>0?arr[i-1]:null);
      }
    }
    enfileirar(st.pageId,{alvo,depois,t:Date.now()});
    pintar(st);
  }
  function enfileirar(pg,op){
    const k=pgId(pg), f=FILAS[k]=FILAS[k]||{ops:[],rodando:false};
    op.alvo._pend=(op.alvo._pend||0)+1;
    f.ops.push(op); filaGravar(); atualizarFila(pg);
    rodarFila(pg);
  }
  async function rodarFila(pg){
    const k=pgId(pg), f=FILAS[k]; if(!f||f.rodando) return;
    f.rodando=true; let ultimo=null, erro=null;
    while(f.ops.length){
      const op=f.ops[0];
      /* item recém-criado ainda sem id do Notion: espera (até 1 min) */
      for(let n=0;n<120&&(ehTmp(op.alvo)||(op.depois&&ehTmp(op.depois)));n++) await dormir(500);
      let r;
      if(ehTmp(op.alvo)||(op.depois&&ehTmp(op.depois))) r={ok:false,erro:"o item ainda não foi criado no Notion"};
      else if(op.depois&&op.depois.id===op.alvo.id) r={ok:true};
      else {
        const payload={action:"blocoMover",pageId:pg,blockId:op.alvo.id};
        if(op.depois) payload.depoisDe=op.depois.id; else payload.inicio=true;
        r=await pedir(payload,150000);
      }
      f.ops.shift(); op.alvo._pend=Math.max(0,(op.alvo._pend||1)-1);
      if(r&&r.ok){
        if(r.novoId){ const velho=op.alvo.id; op.alvo.id=r.novoId;
          f.ops.forEach(o=>{ if(o.alvo.id===velho) o.alvo.id=r.novoId; if(o.depois&&o.depois.id===velho) o.depois.id=r.novoId; }); }
        ultimo=r.conteudo||null;                        // só vale a cópia da ÚLTIMA mudança
        filaGravar(); atualizarFila(pg);
        continue;
      }
      erro=(r&&r.erro)||"sem resposta do servidor";
      f.ops.forEach(o=>{ o.alvo._pend=0; }); f.ops.length=0; filaGravar();
      break;
    }
    f.rodando=false;
    if(!f.ops.length) delete FILAS[k];
    filaGravar();
    const hosts=hostsDe(pg);
    if(erro){
      aviso(/TEM_SUBITENS/.test(erro)?"Um item tem sub-itens e não dá para mover pelo portal — voltei para como está no Notion.":
            /NAO_MOVE/.test(erro)?"Este tipo de item não dá para mover pelo portal — voltei para como está no Notion.":
            "Não terminou de organizar ("+erro+"). Voltei para como está no Notion.");
      hosts.forEach(x=>{ x._forcar=true; carregar(x,true); });
      if(!hosts.length) try{ localStorage.removeItem(CK+k); }catch(err){}
      return;
    }
    if(ultimo&&ultimo.blocos) guardar(pg,ultimo);
    hosts.forEach(x=>{
      const temTmp=(x.blocos||[]).some(b=>ehTmp(b));
      if(ultimo&&ultimo.blocos&&!temTmp&&!x.el.contains(document.activeElement)){ x.blocos=ultimo.blocos; pintar(x); }
      else { guardar(pg,{blocos:x.blocos}); atualizarFila(pg); }
    });
  }
  /* abriu qualquer tela com conteúdo: termina a fila que ficou pela metade */
  (function retomarFila(){
    let o={}; try{ o=JSON.parse(localStorage.getItem(K_FILA)||"{}")||{}; }catch(err){}
    Object.keys(o).forEach(pg=>{
      const obj={}, ref=id=>id?(obj[id]=obj[id]||{id}):null;
      (o[pg]||[]).forEach(x=>{ if(Date.now()-(x.t||0)>24*3600*1000) return;
        const f=FILAS[pg]=FILAS[pg]||{ops:[],rodando:false}; const op={alvo:ref(x.a),depois:ref(x.d),t:x.t}; op.alvo._pend=(op.alvo._pend||0)+1; f.ops.push(op); });
    });
    setTimeout(()=>Object.keys(FILAS).forEach(pg=>rodarFila(pg)),2000);
  })();

  /* ---------- ARRASTAR (v9) ----------
   * Mouse ou dedo, pelo ⠿; foto/documento/divisor também pelo próprio item.
   * Só itens do primeiro nível (os que o Notion deixa recriar no lugar). */
  function podeArrastar(b){ return b&&b.tipo!=="_enviando"&&!(b.filhos&&b.filhos.length); }
  function rolavel(el){
    for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
      const ov=getComputedStyle(p).overflowY; if(/(auto|scroll)/.test(ov)&&p.scrollHeight>p.clientHeight+2) return p; }
    return document.scrollingElement||document.documentElement;
  }
  function ligarArrasto(st){
    const raiz=st.el.querySelector(".eb"); if(!raiz) return;
    raiz.querySelectorAll(":scope > .eb-b[data-id]").forEach(linha=>{
      const b=(st.blocos||[]).find(x=>x.id===linha.getAttribute("data-id")); if(!b) return;
      if(b._pend) linha.classList.add("pendente");
      const h=linha.querySelector(":scope > .eb-arr");
      if(!podeArrastar(b)){ if(h) h.title="Tem sub-itens — mova no Notion"; if(h) h.style.opacity=".35"; return; }
      if(h) h.addEventListener("pointerdown",ev=>iniciarArrasto(st,b,linha,ev));
      if(!b.editavel&&b.tipo!=="table"&&b.tipo!=="child_page"&&b.tipo!=="link_to_page"){
        linha.classList.add("arrastavel");
        linha.addEventListener("pointerdown",ev=>{
          if(ev.pointerType==="touch"||ev.button!==0||ev.target.closest(".eb-x,.eb-mv,.eb-arr,.eb-ed")) return;
          iniciarArrasto(st,b,linha,ev,true);
        });
      }
    });
  }
  function iniciarArrasto(st,b,linha,ev,peloItem){
    if(ev.button>0) return;
    if(!peloItem) ev.preventDefault();
    const x0=ev.clientX, y0=ev.clientY, raiz=st.el.querySelector(".eb"), cont=rolavel(st.el);
    let ativo=false, fant=null, marca=null, destino=null, rolar=null, ultY=y0;
    function comecar(){
      ativo=true; document.body.classList.add("eb-puxando");
      if(document.activeElement&&st.el.contains(document.activeElement)) document.activeElement.blur();
      linha.classList.add("arrastando");
      fant=document.createElement("div"); fant.className="eb-fantasma";
      fant.textContent=(b.tipo==="image"?"🖼 ":ehArquivo(b)?"📎 ":b.tipo==="divider"?"— ":"")+(b.nome||b.texto||ROT[b.tipo]||"item");
      document.body.appendChild(fant);
      marca=document.createElement("div"); marca.className="eb-linha";
      rolar=setInterval(()=>{
        const r=cont===document.scrollingElement||cont===document.documentElement?{top:0,bottom:innerHeight}:cont.getBoundingClientRect();
        if(ultY<r.top+60) cont.scrollBy(0,-16); else if(ultY>r.bottom-60) cont.scrollBy(0,16);
      },30);
    }
    function lugar(y){
      const linhas=[...raiz.querySelectorAll(":scope > .eb-b[data-id]")];
      let idx=linhas.length;
      for(let k=0;k<linhas.length;k++){ const r=linhas[k].getBoundingClientRect(); if(y<r.top+r.height/2){ idx=k; break; } }
      destino=idx;
      if(idx<linhas.length) raiz.insertBefore(marca,linhas[idx]);
      else if(linhas.length){ let d=linhas[linhas.length-1]; while(d.nextElementSibling&&d.nextElementSibling.classList.contains("eb-filhos")) d=d.nextElementSibling; d.after(marca); }
    }
    function mv(e2){
      if(!ativo){ if(Math.hypot(e2.clientX-x0,e2.clientY-y0)<6) return; comecar(); }
      e2.preventDefault(); ultY=e2.clientY;
      fant.style.left=(e2.clientX+14)+"px"; fant.style.top=(e2.clientY+10)+"px";
      lugar(e2.clientY);
    }
    function fim(e2){
      window.removeEventListener("pointermove",mv); window.removeEventListener("pointerup",fim); window.removeEventListener("pointercancel",fim);
      if(!ativo) return;
      clearInterval(rolar); document.body.classList.remove("eb-puxando");
      if(fant) fant.remove(); if(marca) marca.remove(); linha.classList.remove("arrastando");
      /* soltou: não deixa o clique abrir a foto/o documento */
      const para=ce=>{ ce.preventDefault(); ce.stopPropagation(); };
      window.addEventListener("click",para,true); setTimeout(()=>window.removeEventListener("click",para,true),0);
      if(e2.type==="pointercancel"||destino==null) return;
      const i=st.blocos.indexOf(b); if(i<0) return;
      let dest=destino; if(dest>i) dest--;
      moverPara(st,b,dest);
    }
    window.addEventListener("pointermove",mv,{passive:false});
    window.addEventListener("pointerup",fim); window.addEventListener("pointercancel",fim);
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
  /* v5 — anexo no CORPO da página (foto/documento junto da descrição) */
  /* ---------- ANEXO NO CONTEÚDO (v8, 28/09 noite) ----------
   * Continua mesmo saindo da página:
   *   1) o arquivo sobe DIRETO para o Supabase (rápido, não passa pelo
   *      Apps Script) e fica guardado também no navegador (IndexedDB);
   *   2) a finalização (Supabase → Notion) é um pedido PEQUENO — se a página
   *      fechar, ele sai assim mesmo (keepalive); se não der, na próxima vez
   *      que qualquer tela com conteúdo abrir, ele termina sozinho;
   *   3) o servidor não duplica (mesmo opId).
   * O "📎 enviando…" fica guardado por página e aparece até terminar. */
  const K_ENV="eb_env_v1";
  function envLer(){ try{ return JSON.parse(localStorage.getItem(K_ENV)||"{}")||{}; }catch(err){ return {}; } }
  function envGravar(){ const o={}; Object.keys(ENVIANDO).forEach(pg=>{ o[pg]=ENVIANDO[pg].map(x=>({id:x.id,texto:x.texto,prontos:x.prontos||null,opId:x.opId,nomes:x.nomes,t:x.t})); });
    try{ localStorage.setItem(K_ENV,JSON.stringify(o)); }catch(err){} }
  function idb(op,id,valor){
    return new Promise((ok,err)=>{ if(!window.indexedDB) return ok(op==="get"?null:undefined);
      const rq=indexedDB.open("morais_eb",1); rq.onupgradeneeded=()=>rq.result.createObjectStore("arquivos"); rq.onerror=()=>err(rq.error);
      rq.onsuccess=()=>{ const db=rq.result, tx=db.transaction("arquivos",op==="get"?"readonly":"readwrite"), stx=tx.objectStore("arquivos");
        const r=op==="get"?stx.get(id):op==="put"?stx.put(valor,id):stx.delete(id); r.onsuccess=()=>ok(r.result); r.onerror=()=>err(r.error); tx.oncomplete=()=>db.close(); }; });
  }
  function repintarPagina(pg,conteudo){
    [...document.querySelectorAll(".eb-host")].map(h=>h._eb).filter(x=>x&&x.pageId===pg).forEach(x=>{ if(conteudo&&conteudo.blocos) x.blocos=conteudo.blocos; pintar(x); });
  }
  async function anexar(st,inp){
    const fs=[...(inp.files||[])].slice(0,5); inp.value=""; if(!fs.length) return;
    if(fs.some(f=>f.size>20*1024*1024)){ aviso("Arquivo acima de 20 MB — mande um menor."); return; }
    const pg=st.pageId, tmp={id:"tmp"+Date.now()+Math.random().toString(36).slice(2,5),tipo:"_enviando",nomes:fs.map(f=>f.name),t:Date.now(),
      texto:"📎 enviando "+fs.map(f=>f.name).join(", ")+"…",opId:Date.now()+"_"+Math.random().toString(36).slice(2)};
    (ENVIANDO[pg]=ENVIANDO[pg]||[]).push(tmp); envGravar(); pintar(st);
    try{ await idb("put",tmp.id,fs); }catch(err){}
    enviarAnexo(pg,tmp,fs);
  }
  async function enviarAnexo(pg,tmp,fs){
    if(tmp._andando) return; tmp._andando=true;
    let r=null;
    try{
      if(!tmp.prontos){
        if(!fs){ try{ fs=await idb("get",tmp.id); }catch(err){} }
        if(!fs||!fs.length) throw new Error("o arquivo não ficou guardado neste navegador — anexe de novo");
        const u=await pedir({action:"blocoAnexarUrl",pageId:pg,arquivos:fs.map(f=>({nome:f.name,mime:f.type||"",tam:f.size}))},45000);
        if(u&&/ACAO_DESCONHECIDA/.test(String(u.erro||""))){                 // servidor antigo: jeito de antes (base64)
          const ler=f=>new Promise((ok,err)=>{ const rd=new FileReader(); rd.onload=()=>ok(String(rd.result).split(",")[1]); rd.onerror=err; rd.readAsDataURL(f); });
          const arquivos=await Promise.all(fs.map(async f=>({filename:f.name,mimeType:f.type||"application/octet-stream",dataBase64:await ler(f)})));
          r=await pedir({action:"blocoAnexar",pageId:pg,arquivos,opId:tmp.opId},180000);
        } else {
          if(!(u&&u.ok&&u.envios)) throw new Error((u&&u.erro)||"sem resposta do servidor");
          const prontos=[];
          for(let i=0;i<u.envios.length;i++){
            const f=fs[i], v=u.envios[i];
            tmp.texto=`📎 enviando ${f.name} (${i+1}/${u.envios.length})…`; repintarPagina(pg);
            const rr=await fetch(v.url,{method:"PUT",headers:{"Content-Type":f.type||"application/octet-stream","x-upsert":"true"},body:f});
            if(!rr.ok) throw new Error("o arquivo "+f.name+" não subiu ("+rr.status+")");
            prontos.push({nome:v.nome,mime:v.mime||f.type||"",caminho:v.caminho});
          }
          tmp.prontos=prontos; envGravar();
        }
      }
      if(!r){ tmp.texto="📎 colocando no Notion: "+tmp.nomes.join(", ")+"…"; repintarPagina(pg);
        r=await pedir({action:"blocoAnexarDoSupa",pageId:pg,arquivos:tmp.prontos,opId:tmp.opId},120000); }
    }catch(err){ r={ok:false,erro:String((err&&err.message)||err)}; }
    tmp._andando=false;
    if(r&&r.ok){
      ENVIANDO[pg]=(ENVIANDO[pg]||[]).filter(b=>b!==tmp); if(!ENVIANDO[pg].length) delete ENVIANDO[pg]; envGravar();
      idb("delete",tmp.id).catch(()=>{});
      if(r.conteudo) guardar(pg,r.conteudo);
      repintarPagina(pg,r.conteudo); aviso("Anexo adicionado.");
    } else if(tmp.prontos){
      tmp.texto="📎 "+tmp.nomes.join(", ")+" — já subiu, termina sozinho ("+((r&&r.erro)||"sem resposta")+")"; envGravar(); repintarPagina(pg);
      setTimeout(()=>enviarAnexo(pg,tmp),20000);
    } else {
      ENVIANDO[pg]=(ENVIANDO[pg]||[]).filter(b=>b!==tmp); if(!ENVIANDO[pg].length) delete ENVIANDO[pg]; envGravar();
      idb("delete",tmp.id).catch(()=>{}); repintarPagina(pg); aviso("Não anexou: "+((r&&r.erro)||"sem resposta do servidor"));
    }
  }
  /* ao abrir qualquer tela com conteúdo: retoma o que ficou pela metade */
  (function retomar(){
    const o=envLer();
    Object.keys(o).forEach(pg=>{ (o[pg]||[]).forEach(x=>{ if(Date.now()-(x.t||0)>24*3600*1000) return;
      const tmp=Object.assign({tipo:"_enviando"},x); (ENVIANDO[pg]=ENVIANDO[pg]||[]).push(tmp); }); });
    envGravar();
    setTimeout(()=>Object.keys(ENVIANDO).forEach(pg=>ENVIANDO[pg].forEach(t=>enviarAnexo(pg,t))),1500);
  })();
  /* página fechando: o que já subiu para o Supabase é finalizado assim mesmo */
  window.addEventListener("pagehide",()=>{
    const s0=typeof sessao==="function"&&sessao(); if(!s0||!s0.token||typeof API_ESCRITA==="undefined"||!API_ESCRITA) return;
    Object.keys(ENVIANDO).forEach(pg=>ENVIANDO[pg].forEach(t=>{ if(!t.prontos) return;
      try{ fetch(API_ESCRITA,{method:"POST",keepalive:true,headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"blocoAnexarDoSupa",token:s0.token,pageId:pg,arquivos:t.prontos,opId:t.opId})}); }catch(err){} }));
  });
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
  window.EditorBlocos={montar, recarregar:(el)=>el&&el._eb&&carregar(el._eb,true), guardar, guardado, imgFalhou};
})();
