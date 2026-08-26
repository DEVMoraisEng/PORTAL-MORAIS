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
   estiver na coluna ACESSOS do LOGINS.

   TESTES: perfil de conferência. Enxerga tudo, como o ADM, e a coluna ACESSOS
   pode ficar vazia — é justamente pra dar a volta na tela inteira. O que ele
   NÃO faz é gravar: os campos abrem normalmente (a ideia é ver o que apareceria
   como editável para cada perfil), mas o Apps Script recusa toda escrita com
   MODO_TESTE. A trava de verdade é lá no servidor; aqui é só o aviso. */
const TIPOS_VEEM_TUDO = ["ADM","MASTER","TESTES"];
function tipoDe(s){ return String((s&&s.tipo)||"").toUpperCase(); }
function podeAcessar(s, chave){
  if(!s) return false;
  return TIPOS_VEEM_TUDO.indexOf(tipoDe(s))>=0 || (s.acessos||[]).indexOf(chave)>=0;
}
/* Perfil que só olha. Usado pelas telas pra mostrar a tarja de aviso e para
   dar uma mensagem clara em vez de deixar o usuário achando que salvou. */
function ehSomenteLeitura(s){ return tipoDe(s)==="TESTES"; }

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
      /* Sessão expirada NÃO pode virar "salvo": enfileirar aqui só empurra o
         problema — a fila vai bater na mesma recusa pra sempre e a pessoa
         segue achando que gravou. Melhor avisar na hora pra ela relogar. */
      if(r && r.erro==="NAO_AUTORIZADO") return { ok:false, erro:"NAO_AUTORIZADO" };
      // resposta estranha (sem ok e sem erro): cai pra fila
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

/* CAUSA DO "PREENCHI E SUMIU DE NOVO": quando a chamada ao Apps Script falha
   uma vez (tempo esgotado, oscilação, aba em segundo plano), o item vai pra
   fila e escrever() devolve ok — a pessoa vê "salvo". Só que o reenvio
   dependia do evento "online", que só dispara se o navegador tiver ficado
   OFFLINE. Estando online o tempo todo, o evento nunca vinha: a fila ficava
   parada pra sempre, o Notion nunca recebia a data e cada publicação do site
   apagava o que tinha sido digitado. Daí o ciclo de preencher de novo.
   Agora a fila é reenviada sozinha: ao abrir a página, a cada 20 s enquanto
   houver item, e toda vez que a aba volta pro primeiro plano. */
function tentarSincronizar(){ if(fila().length) sincronizar(); }
setInterval(tentarSincronizar, 20000);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) tentarSincronizar(); });
window.addEventListener("load", tentarSincronizar);

/* Tem escrita esperando envio? Enquanto tiver, nenhuma edição local pode ser
   descartada por tempo — ela ainda não chegou ao Notion, então o arquivo
   publicado vir sem ela não significa nada (ver aplicarEdicoesLocais). */
function filaPendente(){ return fila().length > 0; }

/* ---------- textos de erro amigáveis ---------- */
const ERROS_TEXTO = {
  OFFLINE_SEM_CACHE: "sem internet e sem dados salvos ainda",
  SEM_DADOS_PUBLICADOS: "os dados ainda não foram publicados — rode o workflow 'Publicar site' no GitHub",
  ERRO_API: "não consegui falar com o servidor (confira se o Apps Script está publicado)",
  TEMPO_ESGOTADO: "o servidor demorou demais pra responder — tente de novo",
  NAO_AUTORIZADO: "sessão expirada",
  /* devolvidos pelo Code.gs quando a ação existe mas o perfil não pode */
  MODO_TESTE: "modo teste — este login só visualiza, nada é gravado",
  SEM_PERMISSAO: "seu login não tem permissão para esta ação",
  APENAS_ADM: "só um ADM pode fazer isso",
  MASTER_NAO_EDITA_ENDERECO: "o perfil MASTER não edita o endereço"
};
function erroTexto(codigo){
  if(!codigo) return "erro desconhecido";
  if(ERROS_TEXTO[codigo]) return ERROS_TEXTO[codigo];
  /* o backend às vezes devolve o código com um detalhe colado
     ("APENAS_ADM: RESPONSÁVEL", "CAMPO_NAO_LIBERADO: OBRA") — sem isto a tela
     mostrava o código cru, que não diz nada pra quem está usando */
  const i=String(codigo).indexOf(":");
  if(i>0){
    const base=String(codigo).slice(0,i).trim(), det=String(codigo).slice(i+1).trim();
    if(ERROS_TEXTO[base]) return ERROS_TEXTO[base]+(det?" ("+det+")":"");
  }
  return codigo;
}

/* ---------- utilidades ---------- */
const brl = n => (Number(n)||0).toLocaleString("pt-BR",{ style:"currency", currency:"BRL", maximumFractionDigits:0 });
const num = n => (Number(n)||0).toLocaleString("pt-BR");
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
/* ---------- DINHEIRO EM REAIS (máscara ao digitar) ----------
   O bug: o campo era <input type="number"> e a pessoa digitava "350000"
   esperando R$ 350.000,00. Quando o valor era colado ou digitado com ponto
   ("350.000"), o navegador lia o ponto como separador DECIMAL e gravava 350
   no Notion — daí o "R$ 350,00".
   Solução: campo de TEXTO com máscara visível. Regra combinada:
     - o ponto de milhar entra sozinho enquanto digita;
     - centavos só se a pessoa escrever a vírgula: 350000,25 -> R$ 350.000,25.
   O que vai pro Notion é sempre número puro (moedaParse). */
const MOEDA_FRAG = ["VALOR","VGV","COMISS","AVALIA","PRECO","PREÇO","CUSTO",
                    "ENTRADA","SUBSIDIO","SUBSÍDIO","FGTS","SALDO","TOTAL",
                    "PARCELA","FINANCIAMENT","RECURSO","TAXA","GCAP","ITBI","MULTA"];
/* Coluna de dinheiro? Só faz sentido para colunas numéricas — uma coluna de
   texto chamada "OBS. VALOR" não deve virar campo de moeda. */
function ehColunaMoeda(nome, tipo){
  if(tipo && tipo!=="number") return false;
  const n=String(nome||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  return MOEDA_FRAG.some(f=>n.indexOf(f.normalize("NFD").replace(/[\u0300-\u036f]/g,""))>=0);
}
/* Número -> "R$ 350.000,00" (para mostrar). Vazio continua vazio: forçar
   "R$ 0,00" num campo em branco faria a pessoa gravar zero sem querer. */
function moedaFormatar(v){
  if(v===null||v===undefined||v==="") return "";
  const n=Number(v); if(isNaN(n)) return "";
  return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2});
}
/* Texto digitado -> número. Aceita o que a pessoa escrever: "350000",
   "350.000", "R$ 350.000,25", "350000,25". A VÍRGULA é o decimal; ponto é
   sempre milhar (é assim que se escreve dinheiro em português). */
function moedaParse(txt){
  if(txt===null||txt===undefined) return null;
  let s=String(txt).replace(/[^\d,.-]/g,"").trim();
  if(!s) return null;
  const neg = s.indexOf("-")===0;
  s=s.replace(/-/g,"");
  const iv=s.lastIndexOf(",");
  if(iv>=0){ s=s.slice(0,iv).replace(/[.,]/g,"")+"."+s.slice(iv+1).replace(/[^\d]/g,""); }
  else{ s=s.replace(/\./g,""); }
  const n=parseFloat(s);
  if(isNaN(n)) return null;
  return neg?-n:n;
}
/* Máscara enquanto digita: põe o ponto de milhar na parte inteira e deixa a
   vírgula (e o que vier depois dela) como a pessoa escreveu — sem isso, o
   cursor pularia e não daria pra digitar os centavos. */
function moedaMascara(txt){
  let s=String(txt==null?"":txt).replace(/[^\d,]/g,"");
  if(!s) return "";
  const iv=s.indexOf(",");
  let inteiro = iv<0 ? s : s.slice(0,iv);
  let dec     = iv<0 ? null : s.slice(iv+1).replace(/,/g,"").slice(0,2);
  inteiro=inteiro.replace(/^0+(?=\d)/,"");
  const milhar=inteiro.replace(/\B(?=(\d{3})+(?!\d))/g,".");
  return "R$ "+(milhar||"0")+(dec===null?"":","+dec);
}
/* Liga a máscara num <input> já criado. Devolve o próprio input. */
function ligarMascaraMoeda(el){
  if(!el||el.dataset.moeda==="1") return el;
  el.dataset.moeda="1";
  el.setAttribute("inputmode","decimal");
  el.addEventListener("input",()=>{
    const fim = el.selectionStart===el.value.length;
    el.value=moedaMascara(el.value);
    if(fim){ try{ el.setSelectionRange(el.value.length,el.value.length); }catch(e){} }
  });
  el.addEventListener("blur",()=>{
    const n=moedaParse(el.value);
    el.value = n===null?"":moedaFormatar(n);
  });
  return el;
}

/* ---------- "última atualização" (todas as páginas) ----------
   Preenche qualquer elemento com id="updated" ou classe .updated. Recebe o
   updated_at publicado no dist/*.json; quando não vier, mostra a hora local
   e avisa que é a hora da leitura, não a da publicação. */
function pintarAtualizado(updatedAt, offline, tsCache){
  const alvos=[];
  const byId=document.getElementById("updated"); if(byId) alvos.push(byId);
  document.querySelectorAll(".updated").forEach(el=>{ if(alvos.indexOf(el)<0) alvos.push(el); });
  if(!alvos.length) return;
  const d=dataPublicacao(updatedAt) || (tsCache?new Date(tsCache):null);
  let txt;
  if(offline && tsCache) txt="Sem internet — últimos dados salvos em "+new Date(tsCache).toLocaleString("pt-BR");
  else if(d)             txt="Última atualização: "+d.toLocaleString("pt-BR");
  else                   txt="Última atualização: "+new Date().toLocaleString("pt-BR")+" (hora desta consulta)";
  alvos.forEach(el=>{ el.textContent=txt; });
}

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
function edicoesGravar(o){ _EDITS=o; _EDITS_IDX=null; try{ localStorage.setItem(EDITS, JSON.stringify(o)); }catch(e){} }
// outra aba do mesmo navegador salvou: joga fora a cópia em memória
window.addEventListener("storage", e => { if(e.key===EDITS){ _EDITS=null; _EDITS_IDX=null; } });

/* Índice base+linha -> edições daquela linha. Existe por causa da LEITURA:
   getL() consulta as edições a cada célula, filtro e cálculo — varrer o mapa
   inteiro toda vez custaria caro numa tabela de centenas de linhas. */
let _EDITS_IDX=null;
function _indiceEdicoes(){
  if(_EDITS_IDX) return _EDITS_IDX;
  const o=edicoes(), idx={};
  for(const k in o){
    const e=o[k]; if(!e||!e.id) continue;
    const ch=e.b+"\u0001"+e.id;
    (idx[ch]=idx[ch]||[]).push(e);
  }
  _EDITS_IDX=idx; return idx;
}

/* Edição pendente de UMA coluna de UMA linha, ou undefined.
   `norm` é opcional: quando vem, o nome da coluna é comparado normalizado
   (sem acento/caixa/espaço sobrando). Isso é essencial porque quem GRAVA usa
   o nome do schema e quem LÊ costuma usar o nome fixo no código da tela —
   as duas grafias precisam casar. Devolve o registro inteiro (e.v é o valor)
   pra dar pra distinguir "não tem edição" de "edição com valor vazio". */
function edicaoLocal(base,pageId,prop,norm){
  if(!pageId||!prop) return undefined;
  const lista=_indiceEdicoes()[base+"\u0001"+pageId];
  if(!lista) return undefined;
  for(let i=0;i<lista.length;i++) if(lista[i].p===prop) return lista[i];
  if(typeof norm==="function"){
    const alvo=norm(prop);
    for(let i=0;i<lista.length;i++) if(norm(lista[i].p)===alvo) return lista[i];
  }
  return undefined;
}

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
    // publicou depois e veio diferente -> o Notion mandou. MENOS se ainda
    // houver escrita na fila: nesse caso o valor sequer chegou ao Notion, e
    // descartar aqui apagaria da tela um trabalho que ainda vai ser enviado.
    if(pub && pub>e.ts+EDITS_FOLGA && !filaPendente()){ delete o[k]; mudou=true; continue; }
    gravar(e.id,e.p,e.v); aplicadas++;
  }
  if(mudou) edicoesGravar(o);
  return aplicadas;
}

/* ---------- service worker (abre offline) ---------- */
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }
