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
   abre offline e mostra a última lista salva em vez de tela branca.
   v16 -> v17: DESEMPENHO (set/26). Mudaram app.js (fila de requisições,
   dedupe e o store de sessão), analise.html e pos-obra.html. ESTE número
   PRECISAVA mudar junto: o service worker entrega os arquivos do cache
   "portal-morais-v16" enquanto o nome do cache for o mesmo, e nem Ctrl+F5
   derruba isso de forma confiável. Foi por isso que a janela anônima ficou
   rápida (não tem service worker registrado) e o navegador de sempre
   continuou lento com exatamente o mesmo site publicado — ele estava
   rodando o app.js ANTIGO.
   v13 -> v14: pos-obra.html (botão do link da agenda) e ligacoes.html
   (GS_ESPERADO alinhado ao r17).
   v14 -> v15: MELHORIAS do pós obra (RETORNO, retorno que não some, chamado
   finalizado congelado, WhatsApp com data em destaque, dois avisos de
   material, arrastar no calendário, CIDADE/SETOR/TELEFONE editáveis).
   v15 -> v16: CIDADE lida de fórmula, botão de excluir retorno, cores dos
   avisos de material e endereço com setor/cidade na servicos.html.
   v17 -> v18: a pos-obra.html passou a LER do dist/pos_obra.json em vez do
   Apps Script, e a ponte local de serviço novo mudou de formato. ESTE número
   PRECISA subir junto: enquanto o nome do cache for o mesmo, o service worker
   entrega a pos-obra.html ANTIGA do cache — e nem Ctrl+F5 derruba isso de
   forma confiável. Foi exatamente o que fez a janela anônima ficar rápida e o
   navegador de sempre continuar lento na rodada passada.
   A analise.html entrou na lista agora: ela estava de fora desde que virou
   página própria, então nunca abria offline.
   v19 -> v20: entrou a marca de versão no endereço do app.js
   (app.js?v=28). Repare no ignoreSearch da linha de fallback mais abaixo: sem
   ele, o cache guardaria "./app.js" e a tela pediria "./app.js?v=28", que para
   o navegador é OUTRO endereço — offline, o arquivo não seria encontrado e a
   tela abriria sem o app.js, ou seja, quebrada. Com ignoreSearch, o que muda é
   só o ?v=, e a cópia guardada continua servindo.
   Mudaram também app.js e pos-obra.html (r28: criação não vai mais para a
   fila, conferência pelo opId, fila que drena sozinha).
   v18 -> v19: abrir uma obra passou a ler dist/pos_obra/<id>.json, o botão de
   novo serviço virou formulário (o chamado só nasce preenchido) e o anexo
   pede o link no clique. Tudo na pos-obra.html. */
/* v20 -> v21: app.js (contrato de retorno da criacao + conferencia do opId
   repetida) e pos-obra.html (ordem do FALHOU_SEM_CRIAR). Sem trocar esta
   versao, o navegador de quem ja abriu o portal continuaria servindo o
   app.js antigo do cache e a correcao nao chegaria em ninguem. */
/* v22 -> v23: criação otimista do serviço de pós obra. A tela desenha o
   chamado ANTES da resposta do servidor (id provisório trocado pelo real
   quando ela chega) e reconcilia por opId se a pessoa fechar no meio.
   Mudaram: pos-obra.html e app.js. */
const CACHE = "portal-morais-v24";  // r34: botão da RAS Obras
const ARQUIVOS = ["./","./index.html","./login.html","./vendas.html","./ligacoes.html",
                  "./pos-obra.html","./casas-vendidas.html","./servicos.html",
                  "./analise.html","./app.js","./manifest.json"];

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
              .catch(()=>caches.match(req, {ignoreSearch:true}).then(r=>r||caches.match("./index.html")))
  );
});
