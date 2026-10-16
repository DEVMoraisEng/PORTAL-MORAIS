/* conteudo-atv.js — PORTAL-MORAIS · 16/10/26
 * ---------------------------------------------------------------------------
 * CONTEÚDO DE UMA ATIVIDADE DO NOTION (Obras, Vendas ou Documentos) dentro de
 * outra tela — hoje: a janela "atividade de outra aba" da aba Atividades.
 * Mostra o que está na página da atividade no Notion:
 *   - títulos, textos, listas, destaques, recolhíveis;
 *   - checklist (marca/desmarca e grava no Notion);
 *   - formulários: embaixo de "Resposta:" (ou de um título terminado em ":")
 *     uma caixa para escrever (grava no parágrafo logo abaixo, ou cria) e o
 *     botão Foto / Vídeo (o anexo entra logo depois da resposta; dá para tirar);
 *   - fotos, vídeos e arquivos que já estão na página.
 * Servidor (MapaObras.gs mo9): atvOutraConteudo, atvOutraCheck, obraAtvTexto,
 * obraAtvAnexo, obraAtvArquivos, obraAtvTirar — pode quem tem a aba de origem,
 * o responsável pela atividade ou ADM.
 *
 * Uso: ConteudoAtv.montar(elemento, pageId, { somenteLeitura })
 * ------------------------------------------------------------------------ */
(function(){
  if(window.ConteudoAtv) return;
  const ARQ={image:1,video:1,file:1,pdf:1,audio:1}, LISTAS={to_do:1,bulleted_list_item:1,numbered_list_item:1};
  const e=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const opId=()=>Date.now()+"_"+Math.random().toString(36).slice(2,8);
  /* direto ao servidor (não espera a fila da tela) */
  function pedir(p,ms){
    const pr=(typeof _chamarDireto==="function")?_chamarDireto(p,ms||45000):chamar(p,ms||45000,true);
    return Promise.race([pr,new Promise(ok=>setTimeout(()=>ok({ok:false,erro:"TEMPO_ESGOTADO"}),(ms||45000)+3000))]).catch(()=>({ok:false,erro:"sem conexão"}));
  }
  const errTxt=r=>{ const c=(r&&r.erro)||"erro"; try{ return (typeof erroTexto==="function"&&erroTexto(c))||c; }catch(x){ return c; } };

  const CSS=`
  .ca{font-size:13.5px;line-height:1.5}
  .ca h1,.ca h2,.ca h3{font-family:'Barlow Condensed',Inter,sans-serif;color:var(--azul-esc,#1e4b6b);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.3px}
  html[data-tema="escuro"] .ca h1,html[data-tema="escuro"] .ca h2,html[data-tema="escuro"] .ca h3{color:var(--teal,#8FDCD2)}
  .ca h1{font-size:20px}.ca h2{font-size:17px}.ca h3{font-size:15px}
  .ca p{margin:4px 0}
  .ca hr{border:0;border-top:1px solid var(--border2,#d0e4ec);margin:10px 0}
  .ca ul,.ca ol{margin:4px 0 4px 20px;padding:0}
  .ca .ca-todo{display:flex;gap:8px;align-items:flex-start;padding:4px 8px;border-radius:7px;cursor:pointer}
  .ca .ca-todo:hover{background:var(--bg3,#eef4f7)}
  .ca .ca-todo input{margin-top:3px;width:17px;height:17px;accent-color:var(--verde,#2a9d5c);flex:none}
  .ca .ca-todo.feito span{text-decoration:line-through;color:var(--text4,#8aa)}
  .ca details{border:1px solid var(--border2,#d0e4ec);border-radius:8px;background:var(--sup,#fff);margin:6px 0;padding:0 10px}
  .ca details>summary{cursor:pointer;padding:8px 0;font-weight:700}
  .ca .ca-callout{background:var(--bg3,#eef4f7);border-radius:8px;padding:8px 10px;margin:6px 0}
  .ca .ca-resp{border:1.5px solid var(--border2,#d0e4ec);border-radius:10px;background:var(--sup,#fff);padding:8px;margin:2px 0 10px}
  .ca .ca-resp:focus-within{border-color:var(--verde,#2a9d5c)}
  .ca .ca-resp textarea{width:100%;box-sizing:border-box;min-height:56px;resize:vertical;border:0;outline:none;background:transparent;color:var(--text,#1a3347);font:inherit;font-size:14px}
  .ca .ca-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}
  .ca .ca-bar label{cursor:pointer}
  .ca .ca-st{font-size:11.5px;color:var(--text3,#5a8099);font-weight:600}.ca .ca-st.er{color:var(--verm,#c0392b)}
  .ca .ca-anxs{display:flex;flex-wrap:wrap;gap:8px}.ca .ca-anxs:empty{display:none}
  .ca .ca-anx{display:inline-flex;flex-direction:column;gap:3px;max-width:100%;font-size:12px;color:var(--text3,#5a8099)}
  .ca .ca-anx img{max-width:220px;max-height:180px;border-radius:8px;border:1px solid var(--border2,#d0e4ec);object-fit:cover;display:block}
  .ca .ca-anx video{max-width:320px;max-height:220px;border-radius:8px;background:#000;display:block}
  .ca .ca-anx a{color:var(--azul,#295778);font-weight:600}
  .ca .ca-prog{font-size:12px;color:var(--text3,#5a8099);margin-bottom:6px}
  .ca .ca-vazio{color:var(--text4,#8aa);font-size:13px}`;
  function css(){ if(document.getElementById("ca-css")) return; const s=document.createElement("style"); s.id="ca-css"; s.textContent=CSS; document.head.appendChild(s); }

  function linkar(txt,links){
    let h=e(txt||"");
    (links||[]).forEach(l=>{ const t=e(l.t||""); if(t&&l.h&&/^https?:/i.test(l.h)&&h.indexOf(t)>=0) h=h.replace(t,`<a href="${e(l.h)}" target="_blank" rel="noopener">${t}</a>`); });
    return h.replace(/(^|[\s(])(https?:\/\/[^\s<"]+[^\s<".,;:!?)\]])/gi,(m,a,u)=>a+`<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  }
  function ehResposta(b,nxt){
    if(!b||LISTAS[b.tipo]) return false;
    const t=String(b.texto||"");
    if(/^\s*resposta\s*:?\s*$/i.test(t)) return true;
    return /^heading_/.test(b.tipo)&&/:\s*$/.test(t)&&!(nxt&&LISTAS[nxt.tipo]);
  }
  const ehRespPar=x=>x&&x.tipo==="paragraph"&&!/:\s*$/.test(x.texto||"");
  function anxHtml(b,respId){ return `<div class="ca-anx" data-arq="${e(b.id)}" data-tipo="${e(b.tipo)}" ${respId?`data-de="${e(respId)}"`:""}>${b.tipo==="image"?"🖼 carregando a foto…":b.tipo==="video"?"🎥 carregando o vídeo…":"📎 carregando…"}</div>`; }
  function respHtml(st,b,ans,anexos){
    return `<div class="ca-resp" data-resp="${e(b.id)}">
      <textarea data-depois="${e(b.id)}" placeholder="${st.ro?"":"Escreva a resposta aqui…"}" ${st.ro?"readonly":""}>${e(ans?ans.texto||"":"")}</textarea>
      <div class="ca-anxs" data-anxs="${e(b.id)}">${anexos.map(x=>anxHtml(x,st.ro?"":b.id)).join("")}</div>
      ${st.ro?"":`<div class="ca-bar"><label class="bt bt-mini ghost" title="Foto, vídeo ou PDF desta resposta">📷 Foto / 🎥 Vídeo<input type="file" data-anx-de="${e(b.id)}" accept="image/*,video/*,application/pdf" multiple hidden></label>
        <span class="ca-st" data-st="${e(b.id)}"></span></div>`}</div>`;
  }
  function blocosHtml(st,bs){
    let h="", lista=null; const fecha=()=>{ if(lista){ h+=`</${lista}>`; lista=null; } };
    bs=bs||[];
    for(let i=0;i<bs.length;i++){
      const b=bs[i], t=linkar(b.texto||"",b.links), filhos=b.filhos&&b.filhos.length?blocosHtml(st,b.filhos):"";
      if(b.tipo==="bulleted_list_item"||b.tipo==="numbered_list_item"){
        const tag=b.tipo==="bulleted_list_item"?"ul":"ol"; if(lista!==tag){ fecha(); h+=`<${tag}>`; lista=tag; }
        h+=`<li>${t}${filhos}</li>`; continue;
      }
      fecha();
      if(ehResposta(b,bs[i+1])){
        const tag=b.tipo==="heading_1"?"h1":b.tipo==="heading_2"?"h2":b.tipo==="heading_3"?"h3":"p";
        let j=i+1, ans=null; const anexos=[];
        if(ehRespPar(bs[j])){ ans=bs[j]; j++; }
        while(bs[j]&&ARQ[bs[j].tipo]){ anexos.push(bs[j]); j++; }
        h+=`<${tag}>${t}</${tag}>`+respHtml(st,b,ans,anexos)+filhos; i=j-1; continue;
      }
      if(b.tipo==="heading_1") h+=`<h1>${t}</h1>${filhos}`;
      else if(b.tipo==="heading_2") h+=`<h2>${t}</h2>${filhos}`;
      else if(b.tipo==="heading_3") h+=`<h3>${t}</h3>${filhos}`;
      else if(b.tipo==="to_do") h+=`<label class="ca-todo ${b.marcado?"feito":""}"><input type="checkbox" data-chk="${e(b.id)}" ${b.marcado?"checked":""} ${st.ro?"disabled":""}><span>${t||"&nbsp;"}</span></label>${filhos?`<div style="margin-left:24px">${filhos}</div>`:""}`;
      else if(b.tipo==="toggle") h+=`<details><summary>${t||"(sem título)"}</summary>${filhos}</details>`;
      else if(b.tipo==="callout"||b.tipo==="quote") h+=`<div class="ca-callout">${t}${filhos}</div>`;
      else if(b.tipo==="divider") h+=`<hr>`;
      else if(ARQ[b.tipo]) h+=anxHtml(b);
      else if(b.tipo==="child_page") h+=`<p>📄 ${t||"subpágina"} <span class="ca-vazio">(abra no Notion)</span></p>`;
      else if(t||filhos) h+=(t?`<p>${t}</p>`:"")+filhos;
    }
    fecha(); return h;
  }
  const contar=(bs,c)=>{ c=c||{t:0,f:0}; (bs||[]).forEach(b=>{ if(b.tipo==="to_do"){ c.t++; if(b.marcado) c.f++; } contar(b.filhos,c); }); return c; };
  function pintar(st){
    if(!st.blocos.length){ st.el.innerHTML=`<div class="ca"><div class="ca-vazio">A página desta atividade no Notion não tem conteúdo.</div></div>`; return; }
    const abertos=[...st.el.querySelectorAll("details")].map(d=>d.open), c=contar(st.blocos);
    st.el.innerHTML=`<div class="ca">${c.t?`<div class="ca-prog">${c.f} de ${c.t} itens do checklist marcados</div>`:""}${blocosHtml(st,st.blocos)}</div>`;
    [...st.el.querySelectorAll("details")].forEach((d,i)=>{ if(abertos[i]) d.open=true; });
    arquivos(st);
  }
  function achar(bs,id){ for(const b of bs||[]){ if(b.id===id) return b; const x=achar(b.filhos,id); if(x) return x; } return null; }
  function cadeia(st,respId){
    const ach=bs=>{ for(const b of bs||[]){ if(b.id===respId) return bs; const x=ach(b.filhos); if(x) return x; } return null; };
    const l=ach(st.blocos); if(!l) return null;
    const i=l.findIndex(b=>b.id===respId); let j=i+1, ans=null; const anexos=[];
    if(ehRespPar(l[j])){ ans=l[j]; j++; }
    while(l[j]&&ARQ[l[j].tipo]){ anexos.push(l[j]); j++; }
    return {lista:l,i,ans,anexos,ultimo:(anexos.length?anexos[anexos.length-1]:ans||l[i]).id,fimIdx:j};
  }
  function fila(st,k,fn){ st.filas=st.filas||{}; const p=(st.filas[k]||Promise.resolve()).catch(()=>{}).then(fn); st.filas[k]=p; return p; }
  function stat(st,k,txt,er){ st.el.querySelectorAll(`[data-st="${k}"]`).forEach(x=>{ x.textContent=txt; x.classList.toggle("er",!!er); }); }

  async function marcar(st,inp){
    const b=achar(st.blocos,inp.dataset.chk); if(!b) return;
    const v=inp.checked; inp.disabled=true;
    const r=await pedir({action:"atvOutraCheck",pageId:st.pageId,blockId:b.id,marcado:v},30000);
    inp.disabled=false;
    if(r&&r.ok){ b.marcado=v; inp.closest(".ca-todo").classList.toggle("feito",v);
      const pr=st.el.querySelector(".ca-prog"), c=contar(st.blocos); if(pr) pr.textContent=`${c.f} de ${c.t} itens do checklist marcados`; }
    else { inp.checked=!v; aviso("Não salvou: "+errTxt(r)); }
  }
  function salvarResp(st,ta){
    const respId=ta.dataset.depois, txt=ta.value.replace(/\s+$/,""), c=cadeia(st,respId); if(!c) return;
    if(c.ans){ if((c.ans.texto||"")===txt&&String(c.ans.id).indexOf("tmp")!==0) return; c.ans.texto=txt; }
    else { if(!txt) return; c.ans={id:"tmp"+opId(),tipo:"paragraph",texto:txt,_op:opId()}; c.lista.splice(c.i+1,0,c.ans); }
    const ans=c.ans; stat(st,respId,"salvando…");
    fila(st,respId,async()=>{
      const novo=String(ans.id).indexOf("tmp")===0;
      const pay=novo?{action:"obraAtvTexto",pageId:st.pageId,depoisDe:respId,texto:ans.texto,opId:ans._op}
                    :{action:"obraAtvTexto",pageId:st.pageId,blockId:ans.id,texto:ans.texto,opId:opId()};
      let r=null;
      for(let k=0;k<3&&!(r&&r.ok);k++){
        if(k){ stat(st,respId,"salvando… (tentando de novo)"); await new Promise(ok=>setTimeout(ok,3000*k)); }
        r=await pedir(pay,60000);
        if(r&&!r.ok&&/SEM_PERMISSAO|MODO_TESTE|FORA_DA_ATIVIDADE|NAO_E_/.test(String(r.erro||""))) break;
      }
      if(r&&r.ok){ if(novo) ans.id=r.id; delete ans._op; stat(st,respId,"✓ resposta salva"); }
      else { stat(st,respId,"⚠ não salvou: "+errTxt(r)+" — clique fora da caixa de novo para tentar",true); if(!novo) ans.texto=null; }
    });
  }
  const lerB64=f=>new Promise((ok,er)=>{ const rd=new FileReader(); rd.onload=()=>ok(String(rd.result).split(",")[1]); rd.onerror=er; rd.readAsDataURL(f); });
  function reduzir(f){
    return new Promise((ok,er)=>{ const u=URL.createObjectURL(f), im=new Image();
      im.onload=()=>{ const k=Math.min(1,1600/Math.max(im.width,im.height)), cv=document.createElement("canvas");
        cv.width=Math.round(im.width*k); cv.height=Math.round(im.height*k); cv.getContext("2d").drawImage(im,0,0,cv.width,cv.height); URL.revokeObjectURL(u);
        ok({nome:String(f.name||"foto").replace(/\.[^.]+$/,"")+".jpg",mime:"image/jpeg",dataBase64:cv.toDataURL("image/jpeg",0.82).split(",")[1]}); };
      im.onerror=()=>{ URL.revokeObjectURL(u); er(new Error("não consegui ler a foto")); }; im.src=u; });
  }
  function anexar(st,inp){
    const respId=inp.dataset.anxDe, fs=[...(inp.files||[])].slice(0,8); inp.value=""; if(!fs.length) return;
    fs.forEach(f=>{
      const foto=/^image\//.test(f.type)&&!/gif|svg/.test(f.type);
      if(!foto&&f.size>20*1024*1024){ aviso(f.name+": acima de 20 MB (limite do Notion). Grave um vídeo mais curto."); return; }
      stat(st,respId,"⏳ enviando "+f.name+"…"); const op=opId();
      fila(st,respId,async()=>{
        let arq; try{ arq=foto?await reduzir(f):{nome:f.name,mime:f.type||"application/octet-stream",dataBase64:await lerB64(f)}; }
        catch(x){ stat(st,respId,"⚠ "+f.name+": "+x.message,true); return; }
        const c=cadeia(st,respId); if(!c) return;
        if(String(c.ultimo).indexOf("tmp")===0){ stat(st,respId,"⚠ salve a resposta antes de anexar",true); return; }
        stat(st,respId,`⏳ enviando ${f.name} (${Math.max(1,Math.round(arq.dataBase64.length*0.75/1048576))} MB)…`);
        let r=null;
        for(let k=0;k<2&&!(r&&r.ok);k++){
          if(k){ stat(st,respId,"⏳ "+f.name+": tentando de novo…"); await new Promise(ok=>setTimeout(ok,4000)); }
          r=await pedir({action:"obraAtvAnexo",pageId:st.pageId,depoisDe:c.ultimo,arquivo:arq,opId:op},300000);
          if(r&&!r.ok&&/SEM_PERMISSAO|MODO_TESTE|FORA_DA_ATIVIDADE|FALTA_PARAM/.test(String(r.erro||""))) break;
        }
        if(!(r&&r.ok)){ stat(st,respId,"⚠ "+f.name+" não foi: "+errTxt(r),true); return; }
        const c2=cadeia(st,respId); c2.lista.splice(c2.fimIdx,0,{id:r.id,tipo:r.tipo,texto:""});
        const box=st.el.querySelector(`[data-anxs="${respId}"]`), c3=cadeia(st,respId);
        if(box&&c3) box.innerHTML=c3.anexos.map(x=>anxHtml(x,respId)).join("");
        arquivos(st); stat(st,respId,"✓ "+f.name+" anexado");
      });
    });
  }
  async function tirar(st,respId,id){
    if(!confirm("Tirar este anexo da resposta?")) return;
    stat(st,respId,"tirando…");
    const r=await pedir({action:"obraAtvTirar",pageId:st.pageId,blockId:id},45000);
    if(!(r&&r.ok)){ stat(st,respId,"⚠ não tirou: "+errTxt(r),true); return; }
    const c=cadeia(st,respId); if(c){ const k=c.lista.findIndex(x=>x.id===id); if(k>=0) c.lista.splice(k,1); }
    st.el.querySelectorAll(`[data-arq="${id}"]`).forEach(x=>x.remove()); stat(st,respId,"✓ anexo tirado");
  }
  const URLS={};   // o endereço do Notion vence em 1 h: guarda 50 min
  async function arquivos(st){
    const els=[...st.el.querySelectorAll("[data-arq]")]; if(!els.length) return;
    const falta=[...new Set(els.map(x=>x.dataset.arq).filter(id=>!(URLS[id]&&Date.now()-URLS[id].t<50*60000)))];
    for(let i=0;i<falta.length;i+=25){
      const r=await pedir({action:"obraAtvArquivos",pageId:st.pageId,ids:falta.slice(i,i+25)},45000);
      if(r&&r.ok) Object.keys(r.arquivos||{}).forEach(id=>{ URLS[id]=Object.assign({t:Date.now()},r.arquivos[id]); });
    }
    st.el.querySelectorAll("[data-arq]").forEach(x=>{
      const a=URLS[x.dataset.arq]; if(!a){ x.textContent="📎 arquivo (abra no Notion)"; return; }
      if(x._ok===a.url) return; x._ok=a.url;
      const tipo=a.tipo||x.dataset.tipo, tb=x.dataset.de?`<button type="button" class="bt bt-mini ghost" data-tirar="${e(x.dataset.arq)}" data-de="${e(x.dataset.de)}">🗑 tirar</button>`:"";
      x.innerHTML=(tipo==="image"?`<a href="${e(a.url)}" target="_blank" rel="noopener" title="Abrir a foto"><img src="${e(a.url)}" alt="${e(a.nome||"foto")}" loading="lazy"></a>`
        :tipo==="video"?`<video src="${e(a.url)}" controls preload="metadata" playsinline></video><a href="${e(a.url)}" target="_blank" rel="noopener">⬇ baixar o vídeo</a>`
        :`<a href="${e(a.url)}" target="_blank" rel="noopener">📎 ${e(a.nome||"arquivo")}</a>`)+tb;
    });
  }
  function aviso(t){ try{ if(typeof toast==="function") return toast(t); }catch(x){} alert(t); }
  function ligar(st){
    if(st.el._caLigado) return; st.el._caLigado=true;
    st.el.addEventListener("change",ev=>{ const s=st.el._ca; if(!s||s.ro) return;
      const t=ev.target; if(t.matches("[data-chk]")) marcar(s,t); else if(t.matches("[data-anx-de]")) anexar(s,t); });
    st.el.addEventListener("focusout",ev=>{ const s=st.el._ca; if(!s||s.ro) return; if(ev.target.matches("textarea[data-depois]")) salvarResp(s,ev.target); });
    st.el.addEventListener("click",ev=>{ const s=st.el._ca; const b=ev.target.closest("[data-tirar]"); if(s&&b&&!s.ro) tirar(s,b.dataset.de,b.dataset.tirar); });
  }
  async function montar(el,pageId,opts){
    if(!el||!pageId) return; css(); opts=opts||{};
    const st={el,pageId:String(pageId).replace(/-/g,""),ro:!!opts.somenteLeitura,blocos:[]};
    el._ca=st; ligar(st);
    el.innerHTML=`<div class="ca"><div class="ca-vazio"><span class="load"></span> Carregando o conteúdo da atividade…</div></div>`;
    const r=await pedir({action:"atvOutraConteudo",pageId:st.pageId},45000);
    if(el._ca!==st) return;
    if(!(r&&r.ok)){ el.innerHTML=`<div class="ca"><div class="ca-vazio">Não consegui carregar o conteúdo: ${e(errTxt(r))} <button type="button" class="bt bt-mini ghost" data-recarregar="1">↻ Tentar de novo</button></div></div>`;
      const b=el.querySelector("[data-recarregar]"); if(b) b.onclick=()=>montar(el,pageId,opts); return; }
    st.blocos=r.blocos||[]; pintar(st);
  }
  window.ConteudoAtv={montar};
})();
