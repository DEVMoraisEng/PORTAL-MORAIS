// Extrator HyperFlow (conversas.hyperflow.global, página "Histórico de chats") — usado pelo robo_hyperflow.py.
// Mesma lógica do relatório diário da HyperFlow (projeto PROJETOS, claude/relatorio-hyperflow/extrator.js).
// Guarda no IndexedDB "hx"/"kv" do perfil do robô: chats (cards da lista), msgs (histórico por contato), state.
// Uso: HX.run(since) — since = 'YYYY-MM-DDTHH:MM' (hora local) para ler só o que mudou; sem since lê tudo.
window.HXinit = () => {
const HX = window.HX = window.HX || {};
if (!HX.wk) {
  const src = 'onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)';
  HX.wk = new Worker(URL.createObjectURL(new Blob([src], {type: 'text/javascript'})));
  HX.pend = new Map(); HX.seq = 0;
  HX.wk.onmessage = e => { const f = HX.pend.get(e.data); HX.pend.delete(e.data); f && f(); };
}
HX.sleep = ms => new Promise(r => { const id = ++HX.seq; HX.pend.set(id, r); HX.wk.postMessage({id, ms}); });
HX.key = p => { const d = String(p).replace(/\D/g, ''); const n = d.startsWith('55') ? d.slice(2) : d; return n.slice(0, 2) + n.slice(-8); };
HX.ts = s => { const m = String(s || '').match(/(\d\d)\/(\d\d)\/(\d\d) (\d\d):(\d\d)/); return m ? `20${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : null; };
HX.nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
HX.minDate = HX.minDate || '2026-10-01';
HX.db = () => HX._db || (HX._db = new Promise((res, rej) => { const r = indexedDB.open('hx', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
HX.get = async k => { const db = await HX.db(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
HX.put = async (k, v) => { const db = await HX.db(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => rej(t.error); }); };
HX.load = async () => { HX.chats = (await HX.get('chats')) || {}; HX.msgs = (await HX.get('msgs')) || {}; HX.state = (await HX.get('state')) || {}; return {chats: Object.keys(HX.chats).length, contatos: Object.keys(HX.msgs).length, state: HX.state}; };
HX.save = async () => { await HX.put('chats', HX.chats); await HX.put('msgs', HX.msgs); await HX.put('state', HX.state); };

HX.cardEls = () => [...document.querySelectorAll('p')].filter(e => /^#\d{13}$/.test(e.textContent.trim())).map(h => {
  let c = h; while (c.parentElement && (c.parentElement.textContent.match(/#\d{13}/g) || []).length === 1) c = c.parentElement;
  return {el: c, id: h.textContent.trim().slice(1), get txt() { return this._t || (this._t = c.innerText); }};
});
HX.parseCard = (id, txt) => {
  const L = txt.split('\n').map(s => s.trim()).filter(s => s && s !== '•');
  const o = {id, status: L[1] || ''};
  const pi = L.findIndex(s => /^\+\d[\d ]+$/.test(s));
  o.phone = pi >= 0 ? L[pi].replace(/\D/g, '') : ''; o.k = HX.key(o.phone); o.name = pi >= 0 ? L[pi + 1] || '' : '';
  const qi = L.findIndex(s => s.startsWith('"'));
  o.agent = qi > 0 ? L[qi - 1] : ''; o.preview = qi >= 0 ? L[qi].replace(/^"|"$/g, '').slice(0, 120) : '';
  o.lastAt = qi >= 0 ? HX.ts(L[qi + 1]) : null;
  const ci = L.findIndex(s => s.startsWith('Criado em'));
  o.tags = qi >= 0 && ci > qi ? L.slice(qi + 2, ci) : [];
  o.created = ci >= 0 ? HX.ts(L[ci]) : null;
  const f = L.find(s => s.startsWith('Finalizado ')); o.closed = f ? HX.ts(f) : null;
  const u = L.find(s => s.startsWith('Atualizado em')); o.updated = u ? HX.ts(u) : null;
  return o;
};
HX.setPageSize = async n => {
  const cb = [...document.querySelectorAll('[role=combobox]')].find(e => /^(10|25|50|100)$/.test(e.textContent.trim()));
  if (!cb || cb.textContent.trim() === String(n)) return;
  cb.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  await HX.sleep(600);
  const op = [...document.querySelectorAll('[role=option]')].find(e => e.textContent.trim() === String(n)); op && op.click();
  await HX.sleep(3000);
};
HX.clearSearch = async () => {
  const inp = document.querySelector('input[placeholder="Buscar por"]'); if (!inp || !inp.value) return;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(inp, ''); inp.dispatchEvent(new Event('input', {bubbles: true})); inp.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true}));
  await HX.sleep(3000);
};
HX.protoText = () => { const e = [...document.querySelectorAll('span')].find(x => x.childElementCount === 0 && x.textContent.trim() === 'Protocolo:'); return e && e.parentElement ? e.parentElement.textContent : ''; };

HX.readDrawer = async () => {
  const sel = '.message-out-wrapper,.message-in-wrapper,.message-info-wrapper';
  const w = document.querySelector(sel); if (!w) return null;
  let p = w; while (p && !(p.scrollHeight > p.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
  const seen = new Map();
  const ST = /^(Read|Not viewed|Delivered|Sent|Failed|Pending|Error|Lida|Entregue|Enviada|Visualizada)$/i;
  const grab = () => document.querySelectorAll(sel).forEach(e => {
    const cls = e.className; const d = cls.includes('message-in-wrapper') ? 'I' : cls.includes('message-out-wrapper') ? 'O' : 'S';
    const L = e.innerText.split('\n').map(s => s.trim()).filter(Boolean); let ts = null, who = '', text = '';
    if (d === 'O') {
      const si = L.findIndex(x => / · \d\d\/\d\d\/\d\d \d\d:\d\d$/.test(x));
      if (si >= 0) { const m = L[si].match(/^(.*) · (\d\d\/\d\d\/\d\d \d\d:\d\d)$/); who = m[1].trim(); ts = HX.ts(m[2]); }
      text = L.filter((x, i) => i !== si && !ST.test(x)).join(' ');
    } else if (d === 'I') {
      const t0 = L[0] && /^\d\d\/\d\d\/\d\d \d\d:\d\d$/.test(L[0]) ? L[0] : null; ts = t0 ? HX.ts(t0) : null;
      let rest = t0 ? L.slice(1) : L; if (rest[0] === 'Você' && rest.length >= 3) { who = 'botao'; rest = rest.slice(-1); }
      text = rest.join(' ');
    } else { text = L.join(' '); const m = text.match(/(\d\d\/\d\d\/\d\d)\s*-\s*(\d\d:\d\d)/); ts = m ? HX.ts(m[1] + ' ' + m[2]) : null; }
    text = text.replace(/\s+/g, ' ').trim().slice(0, 110);
    const k = d + (ts || '') + text; if (!seen.has(k)) seen.set(k, [d, ts, who, text]);
  });
  if (!p) { grab(); return [...seen.values()]; }
  const oldest = () => { const f = p.querySelector(sel); const m = f && f.innerText.match(/(\d\d)\/(\d\d)\/(\d\d)/); return m ? `20${m[3]}-${m[2]}-${m[1]}` : '9999'; };
  let sh = -1, same = 0;
  for (let i = 0; i < 12 && same < 2; i++) { p.scrollTop = 0; await HX.sleep(600); if (oldest() < HX.minDate) break; if (p.scrollHeight === sh) same++; else { same = 0; sh = p.scrollHeight; } }
  let last = -1, g = 0;
  while (g++ < 150) { grab(); if (seen.size > 500) break; if (p.scrollTop + p.clientHeight >= p.scrollHeight - 2 || p.scrollTop === last) break; last = p.scrollTop; p.scrollTop += p.clientHeight * 0.85; await HX.sleep(160); }
  grab(); return [...seen.values()];
};
// 25/11: contato com mais de um atendimento abre o protocolo mais novo (≠ do cartão) — vale "o protocolo mudou".
HX.openCard = async c => {
  const antes = HX.protoText();
  const tgt = [...c.el.querySelectorAll('p,span')].find(e => e.textContent.trim().startsWith('"'));
  (tgt || c.el).scrollIntoView({block: 'center'}); (tgt || c.el).click();
  let ok = false; for (let i = 0; i < 48; i++) { await HX.sleep(250); const pt = HX.protoText(); if ((pt.includes(c.id) || (pt && pt !== antes)) && document.querySelector('.message-out-wrapper,.message-in-wrapper,.message-info-wrapper')) { ok = true; break; } }
  if (!ok) return null;
  if (!document.querySelector('.message-out-wrapper,.message-in-wrapper')) { for (let i = 0; i < 12; i++) { await HX.sleep(250); if (document.querySelector('.message-out-wrapper,.message-in-wrapper')) break; } }
  await HX.sleep(400);
  return await HX.readDrawer();
};
// Percorre a lista (mais recentes primeiro, 100 por página), guarda os cards e lê o chat mais recente de cada contato que wantFn(k, card) aprovar.
// stopBefore: para quando a página inteira for de conversas criadas e atualizadas antes dessa data.
HX.readViaList = async (wantFn, stopBefore) => {
  HX.prog.phase = 'lista+contatos'; HX.prog.done = 0; HX.prog.res = {}; HX.prog.bad = []; HX.prog.lidos = [];
  await HX.clearSearch(); await HX.setPageSize(100);
  const seenK = new Set();
  for (let pg = 1; pg <= 60; pg++) {
    HX.prog.page = pg;
    let cs = []; for (let i = 0; i < 80; i++) { cs = HX.cardEls(); if (cs.length) break; await HX.sleep(250); }
    for (const c of cs) {
      const o = HX.parseCard(c.id, c.txt); HX.chats[c.id] = o;
      if (!o.k || seenK.has(o.k)) continue; seenK.add(o.k);
      if (!wantFn(o.k, o)) continue;
      let m = null; try { m = await HX.openCard(c); } catch (e) {}
      const r = m && m.length ? 'ok' : 'fail';
      if (r === 'ok') { HX.msgs[o.k] = {at: HX.nowLocal(), id: c.id, m}; HX.prog.lidos.push(o.k); } else HX.prog.bad.push(o.k);
      HX.prog.done++; HX.prog.res[r] = (HX.prog.res[r] || 0) + 1;
      if (HX.prog.done % 15 === 0) await HX.save();
    }
    if (stopBefore && cs.length && cs.every(c => { const o = HX.chats[c.id]; return (o.created || '') < stopBefore && (o.updated || o.created || '') < stopBefore; })) break;
    const nx = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Próximo');
    if (!nx || nx.disabled) break;
    const first = cs[0] && cs[0].id; nx.click();
    for (let i = 0; i < 80; i++) { await HX.sleep(250); const c2 = HX.cardEls(); if (c2.length && c2[0].id !== first) break; }
  }
  await HX.save();
};
// conversa "de verdade": algum atendente humano, ou a última mensagem não é só modelo do robô
HX.TPL = /^(Você: )?(Olá! Tudo bem\? Aqui é da equipe comercial|Como não tivemos retorno|Olá! Tudo bem\? 😊 No momento, estamos fora|Atendimento finalizado|Opa, você ainda está por aí)/;
HX.interesting = o => o.agent !== 'Bot' || !HX.TPL.test(o.preview || '');
// Rodada: since = início do período a reler (ex.: ontem 00:00). Sem since = histórico completo.
HX.run = async (since) => {
  HX.prog = {phase: 'init', started: HX.nowLocal()};
  try {
    await HX.load(); const runStart = HX.nowLocal(); HX.state.runStart = runStart;
    await HX.readViaList((k, o) => {
      const recent = !since || (o.updated || o.created || '') >= since || (o.lastAt || '') >= since;
      const fresh = HX.msgs[k] && HX.msgs[k].at >= runStart;
      return recent && !fresh && (HX.interesting(o) || Object.values(HX.chats).some(c => c.k === k && HX.interesting(c)));
    }, since);
    HX.state.lastRun = runStart; HX.state.lastSince = since || null; await HX.save(); HX.prog.phase = 'fim';
  } catch (e) { HX.prog.err = String(e && e.stack || e); HX.prog.phase = 'erro'; }
};

// ---------- classificação dos leads (a mesma da Análise de Marketing de 24/11) ----------
// ks = chaves (DDD + 8 últimos dígitos) dos leads das campanhas. Devolve {k: {tipo, etapa, completo}} só para quem
// tem conversa lida (msgs) ou card na lista; quem não aparece na HyperFlow fica de fora (não rebaixa o que já existe).
HX.AUTO = /em breve te respondo|retornarei|responderei|assim que poss[ií]vel|hor[aá]rio de (funcionamento|atendimento)|agrade\w* (o )?seu contato|como (posso|podemos) (te )?ajudar|pela compreens[aã]o e prefer|n[aã]o estou dispon|mensagem autom[aá]tica/i;
HX.idOf = t => { const ms = [...t.matchAll(/sou\s+(cliente|corretor)/gi)]; if (ms.length) return ms[ms.length - 1][1].toLowerCase(); if (/renda familiar|^(0|4\.000|6\.000) a |acima de 10/i.test(t)) return 'cliente'; if (/corretor|creci|imobili|imóveis/i.test(t)) return 'corretor'; return null; };
HX.DONE = /corretor parceiro entra|encaminhei|para tirar todas as suas dúvidas/i;
HX.classificar = (ks) => {
  const chatK = {}; Object.values(HX.chats || {}).forEach(c => { (chatK[c.k] = chatK[c.k] || []).push(c); });
  const out = {};
  for (const k of ks) {
    if (!k || out[k]) continue;
    const M = HX.msgs[k] ? HX.msgs[k].m : [];
    if (!M.length) {
      if (chatK[k] && !chatK[k].some(o => HX.interesting(o))) out[k] = {tipo: 'SEM RESPOSTA', etapa: 'Conversa: não respondeu na HyperFlow', completo: false, lida: false};
      continue;
    }
    const real = M.filter(m => m[0] === 'I' && !HX.AUTO.test(m[3] || ''));
    let id = null; real.forEach(m => { const x = HX.idOf(m[3] || ''); if (x) id = x; });
    const done = M.some(m => m[0] === 'O' && HX.DONE.test(m[3] || ''));
    let tipo, etapa;
    if (!real.length) { tipo = 'SEM RESPOSTA'; etapa = 'Conversa: não respondeu na HyperFlow'; }
    else if (id === 'cliente') { tipo = 'CLIENTE'; etapa = 'Conversa: ' + (done ? 'concluiu a qualificação' : 'parou no meio da qualificação'); }
    else if (id === 'corretor') { tipo = 'CORRETOR'; etapa = 'Conversa: ' + (done ? 'concluiu a qualificação' : 'parou no meio da qualificação'); }
    else { tipo = 'RESPONDEU E PAROU'; etapa = 'Conversa: respondeu e não se identificou'; }
    out[k] = {tipo, etapa, completo: (tipo === 'CLIENTE' || tipo === 'CORRETOR') && done, lida: true, msgAt: HX.msgs[k].at};
  }
  return out;
};
};
HXinit(); 'ok'
