/* sw.js · Morais Engenharia — abre o site offline (cache do "shell") */
const CACHE = "morais-portal-v1";
const SHELL = ["login.html","index.html","vendas.html","app.js","logo.png","manifest.json"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);
  // Não intercepta o backend (Apps Script) — a fila/offline cuida disso
  if (url.hostname.indexOf("script.google")>=0 || url.hostname.indexOf("googleusercontent")>=0) return;
  // Só GET do mesmo domínio: cache-first, atualizando em segundo plano
  if (e.request.method!=="GET" || url.origin!==location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res=>{
        const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy)); return res;
      }).catch(()=>hit)
    )
  );
});
