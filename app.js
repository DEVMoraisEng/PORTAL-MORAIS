/* app.js · Morais Engenharia — camada comum (sessão + offline + sync) */

const API   = "https://script.google.com/macros/s/AKfycbwvMnVHZd7y5k-GP8_Dg9zkWyD2fqqH8UI4gaXsQ0iJnm9QNSsyyUhODFMyMW6BfAk/exec";
const LOGIN = "login.html";
const KEY   = "morais_sessao";
const FILA  = "morais_fila";
/* v2: o formato dos dados mudou (dist/*.json em vez do endpoint do Apps
   Script). Trocar o prefixo descarta o cache antigo em vez de pintar a tela
   com campos que não existem mais — era o "undefined trim." do dashboard. */
const CPRE  = "morais_cache_v2_";

/* ---------- sessão ---------- */
function sessao(){ try{ return JSON.parse(localStorage.getItem(KEY)||sessionStorage.getItem(KEY)||"null"); }catch(e){ return null; } }
function sair(){ localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); location.href = LOGIN; }
function exigirSessao(){ const s=sessao(); if(!s||!s.token){ location.href=LOGIN; } return s; }
/* MASTER vê TODOS os sistemas do hub (Vendas etc.), como o ADM — é um perfil
   de diretor. O que ele não pode é MEXER: não edita endereço nem dá baixa em
   atividade (ver ehMaster no vendas.html). GERAL continua limitado ao que
   estiver na coluna ACESSOS do LOGINS. */
function podeAcessar(s, chave){
  if(!s) return false;
  const t=String(s.tipo||"").toUpperCase();
  return t==="ADM" || t==="MASTER" || (s.acessos||[]).indexOf(chave)>=0;
}

/* ---------- cache de dados (para leitura offline) ---------- */
function cacheSet(k,v){ try{ localStorage.setItem(CPRE+k, JSON.stringify({t:Date.now(), v:v})); }catch(e){} }
function cacheGet(k){ try{ return JSON.parse(localStorage.getItem(CPRE+k)); }catch(e){ return null; } }

/* ---------- fila offline (escritas pendentes) ---------- */
function fila(){ try{ return JSON.parse(localStorage.getItem(FILA)||"[]"); }catch(e){ return []; } }
function filaSet(a){ try{ localStorage.setItem(FILA, JSON.stringify(a)); }catch(e){ return false; } return true; }
function enfileirar(item){ const a=fila(); a.push(item); const ok=filaSet(a); atualizarBadge(); return ok; }

/* ---------- LEITURA ESTÁTICA (dist/*.json publicado pelo GitHub Actions) ----------
   É o caminho rápido: arquivo pronto, sem esperar o Apps Script paginar o Notion.
   Só as ESCRITAS continuam indo pro Apps Script. */
async function lerEstatico(arquivo, chaveCache){
  try{
    // cache-busting leve: o Pages serve com cache agressivo e seguraria dado velho
    const r=await fetch("dist/"+arquivo+"?v="+Math.floor(Date.now()/60000), {cache:"no-cache"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json();
    if(chaveCache) cacheSet(chaveCache, j);
    return Object.assign({online:true}, j);
  }catch(e){
    if(chaveCache){ const c=cacheGet(chaveCache); if(c) return Object.assign({online:false,offline:true,_ts:c.t}, c.v); }
    return { online:navigator.onLine, ok:false, erro: navigator.onLine ? "SEM_DADOS_PUBLICADOS" : "OFFLINE_SEM_CACHE" };
  }
}

/* ---------- LEITURA ESTÁTICA "instantânea" (stale-while-revalidate) ----------
   Pinta NA HORA com a última cópia salva no localStorage (0 ms, sem rede) e
   repinta sozinha quando o dist/ chegar. É isto que tira o "Carregando…".
   `pintar` é chamada 1x (só rede, primeiro acesso) ou 2x (cache e depois rede).
   Devolve a resposta da REDE, pra quem precisar esperar o dado definitivo. */
function lerEstaticoJa(arquivo, chaveCache, pintar){
  if(chaveCache && typeof pintar==="function"){
    const c=cacheGet(chaveCache);
    if(c) { try{ pintar(Object.assign({online:navigator.onLine, doCache:true, _ts:c.t}, c.v)); }catch(e){} }
  }
  return lerEstatico(arquivo, chaveCache).then(r=>{
    if(typeof pintar==="function"){ try{ pintar(r); }catch(e){} }
    return r;
  });
}

/* ---------- chamada crua ao backend (lança em erro de rede ou timeout) ---------- */
async function chamar(payload, timeoutMs){
  const s=sessao(); if(s&&s.token&&!payload.token) payload.token=s.token;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), timeoutMs||25000); // evita "Carregando…" travado pra sempre
  try{
    const r=await fetch(API,{ method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, body:JSON.stringify(payload), signal:ctrl.signal });
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* ---------- LEITURA com cache (online → salva cache; offline → usa cache) ---------- */
async function ler(payload, chaveCache){
  try{
    const r=await chamar(payload);
    if(r && r.ok && chaveCache) cacheSet(chaveCache, r);
    return Object.assign({ online:true }, r);
  }catch(e){
    if(chaveCache){ const c=cacheGet(chaveCache); if(c) return Object.assign({ online:false, offline:true, _ts:c.t }, c.v); }
    // distingue "sem internet de verdade" de "API não respondeu/erro/timeout" — ajuda a diagnosticar
    const motivo = navigator.onLine ? (e && e.name==="AbortError" ? "TEMPO_ESGOTADO" : "ERRO_API") : "OFFLINE_SEM_CACHE";
    return { online:false, ok:false, erro:motivo };
  }
}

/* ---------- ESCRITA com fila (tenta agora; senão enfileira) ---------- */
async function escrever(payload, rotulo){
  if(navigator.onLine){
    try{
      const r=await chamar(payload);
      // "resposta" leva o corpo devolvido pelo backend. Sem isto, quem chama
      // escrever() só sabe que deu certo — e algumas ações precisam do que
      // veio junto (ex.: a baixa cruzada das ligações informa qual obra foi
      // marcada como TRANSFERIDO, ou que não achou o endereço).
      if(r && r.ok) return { ok:true, enviado:true, resposta:r };
      if(r && r.erro && r.erro!=="NAO_AUTORIZADO") return { ok:false, erro:r.erro }; // rejeição lógica: não enfileira
      // NAO_AUTORIZADO ou resposta estranha: cai pra fila
    }catch(e){ /* rede caiu: enfileira */ }
  }
  const ok=enfileirar({ id:Date.now()+"_"+Math.random().toString(36).slice(2,7), payload:payload, rotulo:rotulo||payload.action, ts:Date.now() });
  if(!ok) return { ok:false, erro:"FILA_CHEIA" };
  return { ok:true, enfileirado:true };
}

/* ---------- SINCRONIZAÇÃO da fila ---------- */
let _sinc=false;
async function sincronizar(){
  if(_sinc || !navigator.onLine) return;
  _sinc=true;
  try{
    let a=fila();
    while(a.length){
      const item=a[0];
      try{
        const r=await chamar(item.payload);
        if(r && (r.ok || (r.erro && r.erro!=="NAO_AUTORIZADO"))){ a.shift(); filaSet(a); atualizarBadge(); }
        else break;              // NAO_AUTORIZADO → precisa relogar; para
      }catch(e){ break; }        // rede caiu de novo → para
    }
  } finally {
    _sinc=false; atualizarBadge();
    if(typeof window.aoSincronizar==="function") window.aoSincronizar();
  }
}

/* ---------- indicadores de status/fila (se existirem no HTML) ---------- */
function atualizarBadge(){
  const el=document.getElementById("fila-badge"); if(!el) return;
  const n=fila().length; el.textContent=n; el.style.display=n?"inline-flex":"none";
  const b=document.getElementById("btn-sync"); if(b) b.style.display=n?"inline-flex":"none";
}
function atualizarStatus(){
  const el=document.getElementById("net-status"); if(!el) return;
  const on=navigator.onLine; el.textContent=on?"online":"offline"; el.className="net "+(on?"on":"off");
}
window.addEventListener("online",  ()=>{ atualizarStatus(); sincronizar(); });
window.addEventListener("offline", atualizarStatus);

/* ---------- textos de erro amigáveis ---------- */
const ERROS_TEXTO = {
  OFFLINE_SEM_CACHE: "sem internet e sem dados salvos ainda",
  SEM_DADOS_PUBLICADOS: "os dados ainda não foram publicados — rode o workflow 'Publicar site' no GitHub",
  ERRO_API: "não consegui falar com o servidor (confira se o Apps Script está publicado)",
  TEMPO_ESGOTADO: "o servidor demorou demais pra responder — tente de novo",
  NAO_AUTORIZADO: "sessão expirada"
};
function erroTexto(codigo){ return ERROS_TEXTO[codigo] || codigo || "erro desconhecido"; }

/* ---------- utilidades ---------- */
const brl = n => (Number(n)||0).toLocaleString("pt-BR",{ style:"currency", currency:"BRL", maximumFractionDigits:0 });
const num = n => (Number(n)||0).toLocaleString("pt-BR");
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
/* lookup tolerante (nomes do Notion às vezes têm espaço no fim, ex.: "CPF ") */
function getV(obj, nome){
  if(obj[nome]!==undefined) return obj[nome];
  const alvo=nome.trim().toUpperCase();
  for(const k in obj){ if(k.trim().toUpperCase()===alvo) return obj[k]; }
  return undefined;
}
/* grava no MESMO nome de chave que já existe (não cria chave duplicada com espaço) */
function setV(obj, nome, valor){
  if(obj[nome]!==undefined){ obj[nome]=valor; return; }
  const alvo=nome.trim().toUpperCase();
  for(const k in obj){ if(k.trim().toUpperCase()===alvo){ obj[k]=valor; return; } }
  obj[nome]=valor;
}

/* ---------- EDIÇÕES LOCAIS (o que você acabou de salvar) ----------
   PROBLEMA QUE ISTO RESOLVE: as telas pintam a partir do dist/*.json, que só
   é regerado quando o workflow roda. A escrita vai pro Notion na hora, mas o
   arquivo publicado continua com o valor ANTIGO até a próxima publicação.
   As páginas atualizavam só a cópia em memória — então bastava recarregar a
   página (ou voltar pra ela pela navegação, ou a pintura da rede chegar
   depois da pintura do cache) pra o valor digitado sumir da tela e parecer
   que não tinha salvo. Era exatamente o caso das DATAS da aba de ligações,
   mas valia pra QUALQUER campo editável (UC, status, observação, responsável).

   Aqui o que foi salvo fica guardado no localStorage e é reaplicado por cima
   de toda cópia nova que chegar do dist/, até uma destas coisas acontecer:
     - o arquivo publicado já vier com aquele valor (o Notion assumiu);
     - o arquivo tiver sido publicado DEPOIS da edição e vier diferente
       (alguém mudou no Notion, ou a escrita foi recusada) — o Notion manda;
     - passar o prazo de segurança (EDITS_TTL).
   Ou seja: é uma ponte para cobrir a janela entre salvar e republicar, não
   um banco paralelo. */
const EDITS       = "morais_edits_v1";
const EDITS_TTL   = 7*24*3600*1000;   // teto de segurança: 7 dias
const EDITS_FOLGA = 3*60*1000;        // publicação só "vence" a edição 3 min depois

/* O fetch_vendas.py grava updated_at em UTC SEM o "Z" ("2026-08-25T13:04:00").
   String de data-hora sem fuso é lida pelo JS como hora LOCAL: em UTC-3 a
   publicação vinha 3 h no futuro, o que sozinho já descartaria toda edição
   feita nas últimas 3 h. Por isso o "Z" é acrescentado quando falta. */
function tsPublicacao(iso){
  if(!iso) return 0;
  const s = String(iso).trim();
  const t = Date.parse(/(Z|[+\-]\d{2}:?\d{2})$/.test(s) ? s : s+"Z");
  return isNaN(t) ? 0 : t;
}
/* Mesma correção para exibir "Atualizado em ..." na tela. */
function dataPublicacao(iso){ const t=tsPublicacao(iso); return t?new Date(t):null; }

let _EDITS=null;
function edicoes(){
  if(_EDITS) return _EDITS;
  try{ _EDITS=JSON.parse(localStorage.getItem(EDITS)||"{}"); }catch(e){ _EDITS={}; }
  return _EDITS;
}
function edicoesGravar(o){ _EDITS=o; try{ localStorage.setItem(EDITS, JSON.stringify(o)); }catch(e){} }
// outra aba do mesmo navegador salvou: joga fora a cópia em memória
window.addEventListener("storage", e => { if(e.key===EDITS) _EDITS=null; });

function chaveEdicao(base,pageId,prop){ return base+"\u0001"+pageId+"\u0001"+prop; }

/* Chamar SEMPRE com o nome REAL da coluna (o do schema), o mesmo que vai pro
   Apps Script — senão a reaplicação erra a coluna. */
function registrarEdicao(base,pageId,prop,valor){
  if(!pageId||!prop) return;
  const o=edicoes();
  o[chaveEdicao(base,pageId,prop)]={b:base,id:pageId,p:prop,v:valor,ts:Date.now()};
  edicoesGravar(o);
}
/* Servidor recusou: a edição não existe: tirar da ponte, senão a tela ficaria
   mostrando pra sempre um valor que o Notion nunca aceitou. */
function esquecerEdicao(base,pageId,prop){
  const o=edicoes(), k=chaveEdicao(base,pageId,prop);
  if(o[k]!==undefined){ delete o[k]; edicoesGravar(o); }
}
function temEdicaoLocal(base,pageId,prop){ return edicoes()[chaveEdicao(base,pageId,prop)]!==undefined; }

/* Comparação tolerante: data do Notion às vezes volta com hora
   ("2026-08-25T00:00:00.000-03:00") e vazio ora é "", ora null. */
function _valEdicao(v){
  if(v===undefined||v===null) return "";
  if(Array.isArray(v)) return v.map(x=>String(x==null?"":x)).join("|");
  if(typeof v==="number") return String(v);
  if(typeof v==="boolean") return v?"SIM":"";
  const s=String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0,10) : s.trim();
}
function iguaisEdicao(a,b){ return _valEdicao(a)===_valEdicao(b); }

/* Aplica (e faz a faxina) das edições de uma base sobre a cópia recém-chegada.
     base      -> "ligacoes" | "vendas" (a mesma string usada ao registrar)
     updatedAt -> updated_at do JSON publicado
     ler(id,prop)          -> valor publicado; undefined = a linha não está
                              nesta tela (ex.: edição de vendas numa cópia só
                              de ligações) — nesse caso não mexe nem apaga
     gravar(id,prop,valor) -> escreve o valor na linha em memória
   Devolve quantas edições continuaram valendo. */
function aplicarEdicoesLocais(base, updatedAt, ler, gravar){
  const pub=tsPublicacao(updatedAt), agora=Date.now();
  const o=edicoes(); let mudou=false, aplicadas=0;
  for(const k in o){
    const e=o[k];
    if(!e||e.b!==base) continue;
    if(agora-e.ts>EDITS_TTL){ delete o[k]; mudou=true; continue; }
    const publicado=ler(e.id,e.p);
    if(publicado===undefined) continue;                       // linha não está aqui
    if(iguaisEdicao(publicado,e.v)){ delete o[k]; mudou=true; continue; }   // já publicou
    if(pub && pub>e.ts+EDITS_FOLGA){ delete o[k]; mudou=true; continue; }   // publicou depois e veio diferente
    gravar(e.id,e.p,e.v); aplicadas++;
  }
  if(mudou) edicoesGravar(o);
  return aplicadas;
}

/* ---------- service worker (abre offline) ---------- */
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }
