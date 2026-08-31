/* Service worker — abre o site offline.
   dist/*.json NUNCA vai pro cache do SW: é o dado vivo, e o app.js já guarda
   a última cópia no localStorage. Cachear aqui mostraria dado velho pra sempre. */
/* A versão do CACHE precisa MUDAR sempre que esta lista mudar: o navegador
   só baixa os arquivos novos quando o nome do cache é outro. Sem trocar o
   número, quem já visitou o site continuaria com a lista antiga (e a
   ligacoes.html não abriria offline). v3 -> v4 por causa dela.
   v4 -> v5: index.html e ligacoes.html mudaram (layout de celular e correções);
   trocar o número faz o navegador rebaixar os dois na hora, em vez de deixar a
   cópia velha valendo pra quem abrir sem internet.
   v5 -> v6: app.js, ligacoes.html e vendas.html mudaram (correção do sumiço
   dos valores salvos — edições locais). Sem trocar o número, quem abrisse
   offline continuaria com o código antigo e o problema voltaria.
   v7 -> v8: ligacoes.html (as datas em 01/01/2000 voltaram a aparecer na tela)
   e vendas.html (a edição pela célula da planilha agora também fica guardada
   no navegador até o site republicar).
   v8 -> v9: ligacoes.html e index.html ganharam o tema claro/escuro, a
   ordenação por clique no cabeçalho e a correção da linha que só sumia depois
   do F5. Sem trocar o número, quem abrisse offline ficaria com a versão
   anterior.
   v9 -> v10: entrou a pos-obra.html (setor novo) e o index.html ganhou o card
   dela. Sem trocar o número, o navegador de quem já visitou continuaria sem a
   página nova na lista e ela não abriria offline.
   v10 -> v11: a pos-obra.html mudou bastante (alertas, calendário por semana,
   indicadores) e a ligacoes.html teve o aviso de versão atualizado.
   v11 -> v12: pos-obra.html (cor por responsável, horário flexível, cadastro
   de serviço/responsável, cor por serviço nos gráficos e telefone formatado),
   vendas.html e app.js (cadastro de corretor + fmtTel). Entrou também a
   casas-vendidas.html, que estava FALTANDO nesta lista desde que virou página
   própria — a vendas.html a abre num iframe, e sem internet o iframe caía no
   index.html em vez do painel.
   v12 -> v13: entrou a servicos.html (agenda do dia, sem login). Ela precisa
   estar aqui: é a tela que mais roda na rua, com sinal ruim — em cache, ela
   abre offline e mostra a última lista salva em vez de tela branca. */
const CACHE = "portal-morais-v13";
const ARQUIVOS = ["./","./index.html","./login.html","./vendas.html","./ligacoes.html",
                  "./pos-obra.html","./casas-vendidas.html","./servicos.html",
                  "./app.js","./manifest.json"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ARQUIVOS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const req=e.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;          // Apps Script, fontes: passa direto
  if(url.pathname.includes("/dist/")) return;            // dado vivo: sempre da rede
  // resto: rede primeiro, cache como rede de segurança
  e.respondWith(
    fetch(req).then(r=>{ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(req,cp)); return r; })
              .catch(()=>caches.match(req).then(r=>r||caches.match("./index.html")))
  );
});
