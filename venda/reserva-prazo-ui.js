/* 12/11/2026 — ADIAR / REABRIR A RESERVA E A FAIXA "CAI AMANHÃ" (Reserva dos Ipês)
 * Spec: SPEC - 2026-11-12 adiar reserva e aviso de vespera.html (aprovada pelo dono em 12/11).
 *
 * Usado em dois lugares:
 *   - simulacoes.html: faixa no topo da aba Propostas; botões Adiar (proposta RESERVADA) e Reabrir (reserva que caiu
 *     há até 7 dias) no cartão da proposta;
 *   - vendas.html: faixa no topo da Planilha Casas Condomínio.
 * Ações do portal (PORTAL-LEITURA r96v → SIMULADOR r97s): simsReservasVencendo (lê; diz também se a pessoa pode
 * adiar), simsReservaAdiar e simsReservaReabrir (gravam). Quem pode adiar/reabrir é conferido no servidor; a tela só
 * esconde o botão. Depende de chamar() do app.js. Sem dado pessoal no console. */
(function(raiz){
  "use strict";
  const MAX_DIAS = 30, REABRIR_DIAS = 7;
  const ERROS = {
    SEM_PERMISSAO_ADIAR: "Só a diretoria pode adiar ou reabrir reserva.",
    NAO_ESTA_RESERVADA: "A proposta não está mais RESERVADA. Atualize a lista.",
    CONTRATO_GERADO: "O contrato já foi gerado: a reserva não cai mais.",
    SEM_VENDA: "A reserva não tem venda no banco de vendas do condomínio.",
    NAO_CAIU: "Esta reserva não caiu: não há o que reabrir.",
    PRAZO_REABRIR: "A reserva caiu há mais de " + REABRIR_DIAS + " dias: faça uma nova reserva.",
    UNIDADE_NOVA_OCUPADA: "A unidade escolhida não está livre. Escolha outra.",
    MODO_TESTE: "Seu login é de testes: ele vê, mas não grava.",
    OCUPADO: "Outra gravação de reserva está em andamento. Tente de novo em instantes.",
    ACAO_DESCONHECIDA: "O Apps Script do portal ainda não tem esta versão (r96v)."
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  function msgErro(r){
    if(!r) return "Sem resposta do servidor. Tente de novo.";
    const cod = String(r.erro || "").split(":")[0];
    return r.mensagem || ERROS[cod] || r.erro || "Não deu certo.";
  }

  /* ---- datas (São Paulo, UTC-3) ---- */
  function hojeIso(agora){
    const d = new Date((agora == null ? Date.now() : agora) - 3 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  function somaDias(iso, n){
    const p = String(iso).split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n, 12));
    return d.toISOString().slice(0, 10);
  }
  function br(iso){ const p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; }
  function isoDoVence(venceIso){ return venceIso ? hojeIso(new Date(venceIso).getTime()) : ""; }
  /* sugestão: vencimento atual + 5, nunca antes de amanhã nem depois de hoje + 30 */
  function sugestao(venceIso, agora){
    const hoje = hojeIso(agora), min = somaDias(hoje, 1), max = somaDias(hoje, MAX_DIAS);
    let s = somaDias(isoDoVence(venceIso) || hoje, 5);
    if(s < min) s = min; if(s > max) s = max;
    return s;
  }
  /* texto da faixa: "cai amanhã (13/11, às 23:59)" */
  function quandoTexto(item){
    const v = new Date(item.vence), hora = v.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo"});
    const dia = br(isoDoVence(item.vence)).slice(0, 5);
    if(item.quando === "venceu") return "venceu (" + dia + ", às " + hora + ") e cai na próxima passada do robô";
    if(item.quando === "hoje") return "cai hoje, às " + hora;
    if(item.quando === "amanha") return "cai amanhã (" + dia + ", às " + hora + ")";
    return "cai em " + dia + ", às " + hora;
  }
  function frase(item){
    return "A reserva da <b>unidade " + esc(item.unidade) + "</b> do cliente <b>" + esc(item.cliente || "sem nome") +
      "</b> e corretor <b>" + esc(item.corretor || "sem corretor") + "</b> " + esc(quandoTexto(item)) + ".";
  }

  /* ---- a proposta caiu há até 7 dias? (para o botão Reabrir) ---- */
  function caiuRecente(p, agora){
    const d = (p && p.dados) || {}, c = d.reservaCaiu;
    if(!c || norm(p.status) !== "NEGADA") return false;
    const t = new Date(c.em).getTime();
    return !isNaN(t) && ((agora == null ? Date.now() : agora) - t) <= REABRIR_DIAS * 24 * 3600000;
  }

  function estilo(){
    if(document.getElementById("rp-estilo")) return;
    const st = document.createElement("style"); st.id = "rp-estilo";
    st.textContent = `
.rp-faixas{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.rp-faixa{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#FBE9E7;color:#5E1E16;border-left:5px solid #C0392B;
  border-radius:7px;padding:9px 12px;font-size:13.5px;line-height:1.45;min-width:0}
.rp-faixa span{flex:1 1 260px;min-width:0;overflow-wrap:anywhere}
.rp-bt{font:600 13px inherit;padding:7px 12px;border-radius:7px;border:1px solid #C0392B;background:#fff;color:#A02C20;cursor:pointer;white-space:nowrap}
.rp-bt.pri{background:#C0392B;color:#fff}
.rp-bt.az{border-color:var(--azul,#1F4E79);color:var(--azul,#1F4E79)}
.rp-bt:disabled{opacity:.55;cursor:default}
.rp-bt:focus-visible,.rp-campo:focus-visible{outline:2px solid var(--azul,#1F4E79);outline-offset:2px}
.rp-fundo{position:fixed;inset:0;z-index:9000;background:rgba(15,25,35,.55);display:flex;align-items:flex-start;justify-content:center;padding:16px 12px;overflow:auto}
.rp-caixa{background:var(--bg,#fff);color:var(--text,#1d2733);border:1px solid var(--border,#d6dde4);border-radius:10px;width:100%;max-width:440px;
  box-shadow:0 12px 40px rgba(0,0,0,.25);padding:18px;margin-top:6vh;min-width:0}
.rp-caixa h3{margin:0 0 4px;font-size:17px;color:var(--azul,#1F4E79)}
.rp-sub{font-size:12.5px;color:var(--text3,#5b6672);margin-bottom:10px;overflow-wrap:anywhere}
.rp-lbl{display:block;font-size:12px;color:var(--text3,#5b6672);margin:10px 0 3px}
.rp-campo{width:100%;box-sizing:border-box;font:14px inherit;padding:8px 10px;border:1px solid var(--border,#cfd6dd);border-radius:7px;background:var(--bg,#fff);color:inherit}
textarea.rp-campo{min-height:70px;resize:vertical}
.rp-bts{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.rp-msg{font-size:13px;padding:9px 11px;border-radius:7px;margin-top:10px;overflow-wrap:anywhere}
.rp-msg.ok{background:#E6F4EC;color:#1E5E3C}.rp-msg.err{background:#FBE9E7;color:#8E2B20}.rp-msg.av{background:#FFF4D6;color:#6A4A00}
.rp-hist{font-size:12px;color:var(--text3,#5b6672);margin-top:8px}
.rp-hist li{margin:2px 0}
`;
    document.head.appendChild(st);
  }

  /* ---- estado: a lista do que vence e se esta pessoa pode adiar ---- */
  const estado = {pode:false, reservas:[], lidoEm:0, alvos:[]};
  async function ler(forcar){
    let r = null;
    try{ r = await chamar({action:"simsReservasVencendo", forcar:!!forcar}, 60000, false); }catch(e){ r = null; }
    if(r && r.ok){ estado.pode = !!r.podeAdiar; estado.reservas = r.reservas || []; estado.lidoEm = Date.now(); }
    raiz.__rpPodeAdiar = estado.pode;
    return r;
  }
  function pintar(el){
    if(!el) return;
    if(!estado.reservas.length){ el.innerHTML = ""; el.style.display = "none"; return; }
    el.style.display = "";
    el.className = "rp-faixas";
    el.innerHTML = estado.reservas.map((it, i) =>
      '<div class="rp-faixa" role="alert"><span>⚠ ' + frase(it) + '</span>' +
      (estado.pode ? '<button type="button" class="rp-bt" data-rp-i="' + i + '">Adiar</button>' : '') + '</div>').join("");
    el.querySelectorAll("[data-rp-i]").forEach(b => b.onclick = () => {
      const it = estado.reservas[+b.dataset.rpI];
      adiar(it.pageId, {unidade:it.unidade, cliente:it.cliente, vence:it.vence});
    });
  }
  /* monta a faixa num elemento e relê de 5 em 5 minutos */
  async function faixa(elId){
    estilo();
    if(estado.alvos.indexOf(elId) < 0) estado.alvos.push(elId);
    await ler(false);
    estado.alvos.forEach(id => pintar(document.getElementById(id)));
    if(!estado.timer) estado.timer = setInterval(async () => {
      if(document.hidden) return;
      await ler(false); estado.alvos.forEach(id => pintar(document.getElementById(id)));
    }, 5 * 60000);
  }
  async function reler(){ await ler(true); estado.alvos.forEach(id => pintar(document.getElementById(id))); }

  /* ---- janela ---- */
  function janela(html){
    estilo();
    const f = document.createElement("div"); f.className = "rp-fundo"; f.setAttribute("role", "dialog"); f.setAttribute("aria-modal", "true");
    f.innerHTML = '<div class="rp-caixa">' + html + '</div>';
    const fechar = () => { f.remove(); document.removeEventListener("keydown", tecla); };
    const tecla = e => { if(e.key === "Escape") fechar(); };
    f.addEventListener("click", e => { if(e.target === f) fechar(); });
    document.body.appendChild(f); document.addEventListener("keydown", tecla);
    return {f, fechar, q: s => f.querySelector(s)};
  }
  function camposHtml(dataSug, ajuda){
    const hoje = hojeIso();
    return '<label class="rp-lbl" for="rp-data">Nova data limite (a reserva cai no fim do dia)</label>' +
      '<input class="rp-campo" type="date" id="rp-data" value="' + dataSug + '" min="' + somaDias(hoje, 1) + '" max="' + somaDias(hoje, MAX_DIAS) + '">' +
      '<div class="rp-sub" style="margin:4px 0 0">' + esc(ajuda) + '</div>' +
      '<label class="rp-lbl" for="rp-motivo">Motivo (obrigatório)</label>' +
      '<textarea class="rp-campo" id="rp-motivo" maxlength="500" placeholder="Ex.: cliente aguardando liberação do FGTS"></textarea>';
  }
  function validar(j){
    const data = j.q("#rp-data").value, motivo = j.q("#rp-motivo").value.trim(), hoje = hojeIso();
    if(!data) return "Escolha a nova data limite.";
    if(data <= hoje) return "A nova data limite precisa ser depois de hoje.";
    if(data > somaDias(hoje, MAX_DIAS)) return "No máximo " + MAX_DIAS + " dias (até " + br(somaDias(hoje, MAX_DIAS)) + ").";
    if(motivo.length < 3) return "Escreva o motivo.";
    return "";
  }
  function msg(j, tipo, html){ const m = j.q("#rp-msg"); m.className = "rp-msg " + tipo; m.innerHTML = html; m.style.display = ""; }

  function adiar(pageId, info, aoTerminar){
    info = info || {};
    const venceBr = info.vence ? br(isoDoVence(info.vence)) : "";
    const hist = ((info.adiamentos || []).slice(-3).reverse()).map(a => '<li>' + esc(br(a.de)) + ' → ' + esc(br(a.para)) + ' · ' + esc(a.por) + ': ' + esc(a.motivo) + '</li>').join("");
    const j = janela('<h3>Adiar a reserva da unidade ' + esc(info.unidade || "") + '</h3>' +
      '<div class="rp-sub">' + (info.cliente ? 'Cliente ' + esc(info.cliente) + '. ' : '') + (venceBr ? 'Hoje a reserva cai em <b>' + esc(venceBr) + '</b>.' : '') + '</div>' +
      camposHtml(sugestao(info.vence), "Até " + MAX_DIAS + " dias a partir de hoje. O corretor recebe um e-mail com o prazo novo.") +
      (hist ? '<ul class="rp-hist"><b>Adiamentos anteriores</b>' + hist + '</ul>' : '') +
      '<div id="rp-msg" class="rp-msg" style="display:none"></div>' +
      '<div class="rp-bts"><button type="button" class="rp-bt pri" id="rp-ok">Adiar</button><button type="button" class="rp-bt az" id="rp-cancelar">Cancelar</button></div>');
    j.q("#rp-cancelar").onclick = j.fechar;
    setTimeout(() => { try{ j.q("#rp-motivo").focus(); }catch(e){} }, 50);
    j.q("#rp-ok").onclick = async () => {
      const erro = validar(j); if(erro){ msg(j, "err", esc(erro)); return; }
      const bt = j.q("#rp-ok"); bt.disabled = true; bt.textContent = "Gravando…";
      let r = null;
      try{ r = await chamar({action:"simsReservaAdiar", pageId:pageId, data:j.q("#rp-data").value, motivo:j.q("#rp-motivo").value.trim()}, 120000, true); }catch(e){ r = null; }
      if(!r || !r.ok){ bt.disabled = false; bt.textContent = "Adiar"; msg(j, "err", esc(msgErro(r))); return; }
      msg(j, "ok", 'Reserva da unidade ' + esc(r.unidade) + ' adiada: agora cai em <b>' + esc(br(r.vence)) + '</b>, às 23:59.' +
        (r.email && r.email.ok ? ' O corretor foi avisado por e-mail.' : ' <b>O e-mail ao corretor não saiu</b> — avise por telefone.'));
      bt.style.display = "none"; j.q("#rp-cancelar").textContent = "Fechar";
      reler(); if(typeof aoTerminar === "function") try{ aoTerminar(r); }catch(e){}
    };
  }

  /* unidades livres para trocar: a lista da tela (UNS da simulacoes.html) ou simsUnidades */
  async function livres(){
    let lista = (raiz.UNS && raiz.UNS.length) ? raiz.UNS : null;
    if(!lista){ try{ const r = await chamar({action:"simsUnidades"}, 60000, false); lista = (r && r.unidades) || []; }catch(e){ lista = []; } }
    return lista.filter(u => u.disponivel && !u.reservado && !u.vendido)
      .map(u => String(u.unidade)).sort((a, b) => a.localeCompare(b, "pt-BR", {numeric:true}));
  }
  function reabrir(pageId, info, aoTerminar){
    info = info || {};
    const caiu = info.caiu || {};
    const j = janela('<h3>Reabrir a reserva da unidade ' + esc(info.unidade || "") + '</h3>' +
      '<div class="rp-sub">' + (info.cliente ? 'Cliente ' + esc(info.cliente) + '. ' : '') +
        (caiu.em ? 'A reserva caiu em ' + esc(new Date(caiu.em).toLocaleString("pt-BR", {timeZone:"America/Sao_Paulo"})) + '. ' : '') +
        'A venda volta com os documentos, a unidade volta a RESERVADA e o registro do distrato vai para a lixeira.</div>' +
      camposHtml(somaDias(hojeIso(), 5), "Até " + MAX_DIAS + " dias a partir de hoje. O corretor recebe um e-mail.") +
      '<div id="rp-troca" style="display:none"><label class="rp-lbl" for="rp-un">Trocar para a unidade</label><select class="rp-campo" id="rp-un"></select></div>' +
      '<div id="rp-msg" class="rp-msg" style="display:none"></div>' +
      '<div class="rp-bts"><button type="button" class="rp-bt pri" id="rp-ok">Reabrir</button><button type="button" class="rp-bt az" id="rp-cancelar">Cancelar</button></div>');
    j.q("#rp-cancelar").onclick = j.fechar;
    let trocando = false;
    j.q("#rp-ok").onclick = async () => {
      const erro = validar(j); if(erro){ msg(j, "err", esc(erro)); return; }
      const unidadeNova = trocando ? j.q("#rp-un").value : "";
      if(trocando && !unidadeNova){ msg(j, "err", "Escolha a unidade nova."); return; }
      const bt = j.q("#rp-ok"); bt.disabled = true; bt.textContent = "Gravando…";
      let r = null;
      try{ r = await chamar({action:"simsReservaReabrir", pageId:pageId, data:j.q("#rp-data").value, motivo:j.q("#rp-motivo").value.trim(), unidadeNova:unidadeNova}, 150000, true); }catch(e){ r = null; }
      bt.disabled = false; bt.textContent = trocando ? "Reabrir na unidade escolhida" : "Reabrir";
      if(r && !r.ok && r.erro === "UNIDADE_OCUPADA"){
        const ls = await livres();
        msg(j, "av", '⚠ A <b>unidade ' + esc(r.unidade) + '</b> está <b>' + esc(r.estado) + '</b> — já está com outra pessoa. ' +
          (ls.length ? 'Escolha outra unidade abaixo para reabrir a reserva nela.' : 'Não há unidade livre para trocar agora.'));
        if(ls.length){
          trocando = true; j.q("#rp-troca").style.display = "";
          j.q("#rp-un").innerHTML = '<option value="">Escolha…</option>' + ls.map(u => '<option value="' + esc(u) + '">Unidade ' + esc(u) + '</option>').join("");
          bt.textContent = "Reabrir na unidade escolhida";
        } else bt.style.display = "none";
        return;
      }
      if(!r || !r.ok){ msg(j, "err", esc(msgErro(r))); return; }
      msg(j, "ok", 'Reserva reaberta na <b>unidade ' + esc(r.unidade) + '</b>' + (r.unidadeAntes ? ' (era a ' + esc(r.unidadeAntes) + ')' : '') +
        ' até <b>' + esc(br(r.vence)) + '</b>, às 23:59.' + (r.unidadeAntes ? ' O valor da unidade nova foi para a proposta: confira o fluxo em <b>Atualizar venda pela proposta</b>.' : '') +
        (r.email && r.email.ok ? ' O corretor foi avisado por e-mail.' : ' <b>O e-mail ao corretor não saiu</b> — avise por telefone.'));
      bt.style.display = "none"; j.q("#rp-cancelar").textContent = "Fechar"; j.q("#rp-troca").style.display = "none";
      reler(); if(typeof aoTerminar === "function") try{ aoTerminar(r); }catch(e){}
    };
  }

  /* botões do cartão da proposta (simulacoes.html): só para quem pode; o servidor confere de novo */
  function botoesProposta(p){
    if(!raiz.__rpPodeAdiar || !p) return "";
    const st = norm(p.status), d = p.dados || {};
    const arg = esc(JSON.stringify({unidade:p.unidade, cliente:p.cliente, vence:(d.reserva || {}).vence || "", adiamentos:(d.reserva || {}).adiamentos || [], caiu:d.reservaCaiu || null}));
    if(st === "RESERVADA")
      return '<div style="margin-top:8px"><button type="button" class="bt" style="background:#C0392B;color:#fff" data-rp-info="' + arg + '" onclick="ReservaPrazoUI.adiar(\'' + esc(p.id) + '\',JSON.parse(this.dataset.rpInfo),window.__rpAoTerminar)">⏳ Adiar reserva</button></div>';
    if(caiuRecente(p))
      return '<div style="margin-top:8px"><button type="button" class="bt" style="background:#1D7A45;color:#fff" data-rp-info="' + arg + '" onclick="ReservaPrazoUI.reabrir(\'' + esc(p.id) + '\',JSON.parse(this.dataset.rpInfo),window.__rpAoTerminar)">↺ Reabrir reserva que caiu</button></div>';
    return "";
  }

  raiz.ReservaPrazoUI = {faixa, reler, adiar, reabrir, botoesProposta,
    _t: {hojeIso, somaDias, br, sugestao, quandoTexto, frase, caiuRecente, msgErro, estado, pintar}};
})(typeof window !== "undefined" ? window : globalThis);
