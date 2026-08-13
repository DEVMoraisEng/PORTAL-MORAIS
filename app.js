/* app.js · Morais Engenharia — camada comum (sessão + offline + sync) */

const API   = "https://script.google.com/macros/s/AKfycbwvMnVHZd7y5k-GP8_Dg9zkWyD2fqqH8UI4gaXsQ0iJnm9QNSsyyUhODFMyMW6BfAk/exec";
const LOGIN = "login.html";
const KEY   = "morais_sessao";
const FILA  = "morais_fila";
const CPRE  = "morais_cache_";

/* ---------- sessão ---------- */
function sessao(){ try{ return JSON.parse(localStorage.getItem(KEY)||sessionStorage.getItem(KEY)||"null"); }catch(e){ return null; } }
function sair(){ localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); location.href = LOGIN; }
function exigirSessao(){ const s=sessao(); if(!s||!s.token){ location.href=LOGIN; } return s; }
function podeAcessar(s, chave){ return s && (s.tipo==="ADM" || (s.acessos||[]).indexOf(chave)>=0); }

/* ---------- cache de dados (para leitura offline) ---------- */
function cacheSet(k,v){ try{ localStorage.setItem(CPRE+k, JSON.stringify({t:Date.now(), v:v})); }catch(e){} }
function cacheGet(k){ try{ return JSON.parse(localStorage.getItem(CPRE+k)); }catch(e){ return null; } }

/* ---------- fila offline (escritas pendentes) ---------- */
function fila(){ try{ return JSON.parse(localStorage.getItem(FILA)||"[]"); }catch(e){ return []; } }
function filaSet(a){ try{ localStorage.setItem(FILA, JSON.stringify(a)); }catch(e){ return false; } return true; }
function enfileirar(item){ const a=fila(); a.push(item); const ok=filaSet(a); atualizarBadge(); return ok; }

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
      if(r && r.ok) return { ok:true, enviado:true };
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

/* ---------- service worker (abre offline) ---------- */
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }
