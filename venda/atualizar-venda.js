/* 07/11/2026 — ATUALIZAR VENDA PELA PROPOSTA (r97o do SIMULADOR)
 * Spec: https://claude.ai/artifact/5JekcYLXbeNJ5WRq76pGA4
 *
 * A linha do BANCO DE DADOS VENDAS CONDOMÍNIO nasce no Reservar e depois só
 * recebe campo vazio. Esta janela mostra o que a proposta tem diferente da
 * venda, campo a campo, e grava só o que ficar marcado. Usada em dois lugares:
 *   - simulacoes.html: cartão da proposta reservada (Decisão);
 *   - vendas.html: Planilha Casas Condomínio, aba Resumo do cartão da unidade.
 * Ações do portal: simsVendaComparar (só lê) e simsVendaAplicar (grava; o
 * servidor refaz a comparação e recusa se algo mudou — carimbo).
 * Só antes do contrato gerado; nunca apaga; colunas de controle ficam fora
 * (tudo isso é regra do servidor, a tela só mostra). Depende de chamar() do app.js. */
(function(){
  "use strict";
  const ERROS = {
    CONTRATO_JA_GERADO: "O contrato já foi gerado. Daqui em diante a mudança é por distrato ou aditivo.",
    SEM_VENDA: "Esta proposta ainda não tem venda no banco de vendas do condomínio.",
    VENDA_DE_OUTRA_PROPOSTA: "A venda desta unidade é de outra proposta.",
    PROPOSTA_ENCERRADA: "Proposta negada ou distratada: a venda não é atualizada.",
    VENDA_MUDOU: "A venda ou a proposta mudou depois que a lista foi aberta. A lista foi refeita: confira de novo.",
    MODO_TESTE: "Seu login é de testes: ele vê, mas não grava.",
    SEM_PERMISSAO: "Seu login não tem o acesso de Vendas.",
    ACAO_DESCONHECIDA: "O Apps Script do portal ainda não tem esta versão (r97o)."
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function msgErro(r){
    if(!r) return "Sem resposta do servidor. Tente de novo.";
    const cod = String(r.erro || "").split(":")[0];
    return ERROS[cod] || r.mensagem || r.erro || "Não deu certo.";
  }
  function estilo(){
    if(document.getElementById("av-estilo")) return;
    const st = document.createElement("style"); st.id = "av-estilo";
    st.textContent = `
.av-fundo{position:fixed;inset:0;z-index:9000;background:rgba(15,25,35,.55);display:flex;align-items:flex-start;justify-content:center;
  padding:max(16px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));overflow:auto}
.av-caixa{background:var(--bg,#fff);color:var(--text,#1d2733);border:1px solid var(--border,#d6dde4);border-radius:10px;width:100%;max-width:760px;
  box-shadow:0 12px 40px rgba(0,0,0,.25);padding:18px 18px 16px;margin-top:4vh;min-width:0}
.av-caixa h3{margin:0 0 4px;font-size:17px;color:var(--azul,#1F4E79)}
.av-sub{font-size:12.5px;color:var(--text3,#5b6672);margin-bottom:12px}
.av-tab{width:100%;border-collapse:collapse;font-size:13.5px}
.av-tab th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3,#5b6672);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border,#d6dde4)}
.av-tab td{padding:8px;border-bottom:1px solid var(--border,#e3e8ed);vertical-align:top;overflow-wrap:anywhere}
.av-tab td.av-ck{width:28px}
.av-tab input{width:17px;height:17px;accent-color:var(--azul,#1F4E79)}
.av-antes{color:#B03A2E}.av-depois{color:#1E7A4C;font-weight:600}
.av-tab tr.av-des .av-depois{color:var(--text3,#5b6672);font-weight:400;text-decoration:line-through}
.av-tab tr.av-des .av-antes{color:var(--text,#1d2733)}
.av-vazio{font-style:italic;color:var(--text3,#5b6672)}
.av-bts{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center}
.av-bt{font:600 13.5px inherit;padding:9px 14px;border-radius:7px;border:1px solid var(--border,#cfd6dd);background:var(--bg2,#f4f6f8);color:var(--text,#1d2733);cursor:pointer}
.av-bt.pri{background:var(--azul,#1F4E79);border-color:var(--azul,#1F4E79);color:#fff}
.av-bt:disabled{opacity:.55;cursor:default}
.av-bt:focus-visible,.av-tab input:focus-visible{outline:2px solid var(--azul,#1F4E79);outline-offset:2px}
.av-msg{font-size:13px;padding:9px 11px;border-radius:7px;margin-top:10px}
.av-msg.ok{background:#E6F4EC;color:#1E5E3C}.av-msg.err{background:#FBE9E7;color:#8E2B20}.av-msg.inf{background:var(--bg2,#f1f4f7);color:var(--text,#1d2733)}
.av-aviso{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;margin-top:8px}
.av-aviso b{color:#8A5A00}
@media (max-width:600px){
  .av-tab thead{display:none}
  .av-tab tr{display:grid;grid-template-columns:28px 1fr;gap:2px 8px;padding:8px 0;border-bottom:1px solid var(--border,#e3e8ed)}
  .av-tab td{border:0;padding:2px 0}
  .av-tab td.av-ck{grid-row:span 3}
  .av-tab td[data-r]::before{content:attr(data-r) ": ";font-size:11px;color:var(--text3,#5b6672);text-transform:uppercase}
  .av-caixa{padding:14px}
}`;
    document.head.appendChild(st);
  }
  function fechar(){ const f = document.getElementById("av-fundo"); if(f) f.remove(); document.removeEventListener("keydown", tecla); }
  function tecla(e){ if(e.key === "Escape") fechar(); }

  async function abrir(pageId, opcoes){
    opcoes = opcoes || {};
    estilo(); fechar();
    const f = document.createElement("div"); f.id = "av-fundo"; f.className = "av-fundo";
    f.innerHTML = '<div class="av-caixa" role="dialog" aria-modal="true" aria-labelledby="av-tit"><h3 id="av-tit">Atualizar venda pela proposta</h3>' +
      '<div class="av-sub">Nada é gravado até você clicar em Aplicar.</div><div id="av-corpo"><div class="av-msg inf"><span class="load"></span> Comparando a proposta com a venda…</div></div></div>';
    f.addEventListener("click", e => { if(e.target === f) fechar(); });
    document.body.appendChild(f); document.addEventListener("keydown", tecla);
    await carregar(pageId, opcoes, null);
  }

  async function carregar(pageId, opcoes, avisoAntes){
    const corpo = document.getElementById("av-corpo"); if(!corpo) return;
    let r = null;
    try{ r = await chamar({action:"simsVendaComparar", pageId:pageId}, 90000, true); }catch(e){ r = null; }
    if(!document.getElementById("av-corpo")) return;
    if(!r || !r.ok){
      corpo.innerHTML = '<div class="av-msg err">' + esc(msgErro(r)) + '</div><div class="av-bts"><button type="button" class="av-bt" id="av-fechar">Fechar</button></div>';
      document.getElementById("av-fechar").onclick = fechar; return;
    }
    const sub = document.querySelector("#av-fundo .av-sub");
    if(sub) sub.textContent = "Proposta " + (r.proposta || "") + " · Unidade " + (r.unidade || "") + " · nada é gravado até você clicar em Aplicar.";
    const ds = r.diferencas || [];
    if(!ds.length){
      corpo.innerHTML = (avisoAntes ? '<div class="av-msg inf">' + esc(avisoAntes) + '</div>' : '') +
        '<div class="av-msg ok">A venda já está igual à proposta. Nada a atualizar.</div><div class="av-bts"><button type="button" class="av-bt" id="av-fechar">Fechar</button></div>';
      document.getElementById("av-fechar").onclick = fechar; return;
    }
    corpo.innerHTML = (avisoAntes ? '<div class="av-msg inf">' + esc(avisoAntes) + '</div>' : '') +
      '<p style="margin:0 0 8px;font-size:13.5px"><b>' + ds.length + (ds.length === 1 ? " campo diferente" : " campos diferentes") + '</b> entre a proposta e a venda. Desmarque o que deve ficar como está na venda.</p>' +
      '<div style="overflow-x:auto"><table class="av-tab"><thead><tr><th></th><th>Campo</th><th>Na venda hoje</th><th>Na proposta</th></tr></thead><tbody>' +
      ds.map((d, i) => '<tr data-i="' + i + '"><td class="av-ck"><input type="checkbox" id="av-c' + i + '" checked aria-label="Aplicar ' + esc(d.coluna) + '"></td>' +
        '<td><label for="av-c' + i + '"><b>' + esc(d.coluna) + '</b></label></td>' +
        '<td data-r="Na venda" class="av-antes">' + (d.naVenda ? esc(d.naVenda) : '<span class="av-vazio">vazio</span>') + '</td>' +
        '<td data-r="Na proposta" class="av-depois">' + esc(d.naProposta) + '</td></tr>').join("") +
      '</tbody></table></div>' +
      '<div class="av-bts"><button type="button" class="av-bt pri" id="av-aplicar"></button><button type="button" class="av-bt" id="av-cancelar">Cancelar</button></div><div id="av-res"></div>';
    const bt = document.getElementById("av-aplicar");
    const marcadas = () => ds.filter((d, i) => document.getElementById("av-c" + i).checked).map(d => d.coluna);
    const conta = () => {
      const n = marcadas().length;
      bt.textContent = n ? "Aplicar " + n + (n === 1 ? " mudança" : " mudanças") : "Nada marcado";
      bt.disabled = !n;
      corpo.querySelectorAll("tr[data-i]").forEach(tr => tr.classList.toggle("av-des", !document.getElementById("av-c" + tr.dataset.i).checked));
    };
    ds.forEach((d, i) => document.getElementById("av-c" + i).addEventListener("change", conta));
    conta();
    document.getElementById("av-cancelar").onclick = fechar;
    bt.onclick = async () => {
      const cols = marcadas(); if(!cols.length) return;
      bt.disabled = true; document.getElementById("av-cancelar").disabled = true;
      const res = document.getElementById("av-res");
      res.innerHTML = '<div class="av-msg inf"><span class="load"></span> Gravando na venda…</div>';
      let a = null;
      try{ a = await chamar({action:"simsVendaAplicar", pageId:pageId, colunas:cols, carimbo:r.carimbo}, 120000, true); }catch(e){ a = null; }
      if(a && a.ok){
        corpo.innerHTML = '<div class="av-msg ok"><b>Venda atualizada.</b> ' + (a.aplicados || []).length + ' campo(s) gravado(s): ' +
          esc((a.aplicados || []).join(", ")) + '. O e-mail de registro foi para a caixa de vendas.</div><div class="av-bts"><button type="button" class="av-bt pri" id="av-fechar">Fechar</button></div>';
        document.getElementById("av-fechar").onclick = fechar;
        try{ if(typeof opcoes.aoAplicar === "function") opcoes.aoAplicar(a); }catch(e){}
        return;
      }
      if(a && String(a.erro || "") === "VENDA_MUDOU"){ corpo.innerHTML = '<div class="av-msg inf"><span class="load"></span> Refazendo a lista…</div>'; return carregar(pageId, opcoes, ERROS.VENDA_MUDOU); }
      res.innerHTML = '<div class="av-msg err">' + esc(msgErro(a)) + '</div>';
      bt.disabled = false; document.getElementById("av-cancelar").disabled = false;
    };
    bt.focus();
  }

  /* aviso discreto ao lado do botão: compara em segundo plano e diz se a venda está diferente */
  async function aviso(elId, pageId){
    const el = document.getElementById(elId); if(!el) return;
    let r = null;
    try{ r = await chamar({action:"simsVendaComparar", pageId:pageId}, 90000, false); }catch(e){ r = null; }
    const alvo = document.getElementById(elId); if(!alvo) return;
    if(r && r.ok){
      const n = (r.diferencas || []).length;
      alvo.innerHTML = n ? '<b>A venda está diferente da proposta em ' + n + (n === 1 ? ' campo.' : ' campos.') + '</b>' : 'A venda está igual à proposta.';
    } else if(r && /CONTRATO_JA_GERADO|SEM_VENDA|VENDA_DE_OUTRA|PROPOSTA_ENCERRADA/.test(String(r.erro || ""))){
      const bt = alvo.parentNode && alvo.parentNode.querySelector("[data-av-bt]");
      if(bt) bt.disabled = true;
      alvo.textContent = msgErro(r);
    } else alvo.textContent = "";
  }

  /* HTML do botão + aviso (o mesmo nas duas telas) */
  function botaoHtml(pageId, sufixo, classe){
    estilo();
    const id = "av-aviso-" + (sufixo || "x");
    return '<div class="av-aviso"><button type="button" class="' + esc(classe || "bt") + '" data-av-bt data-pid="' + esc(pageId) + '" onclick="AtualizarVendaUI.abrir(this.dataset.pid,{aoAplicar:window.__avAoAplicar})">↻ Atualizar venda pela proposta</button>' +
      '<span id="' + id + '" style="color:var(--text3,#5b6672)"></span></div>';
  }
  window.AtualizarVendaUI = {abrir: abrir, aviso: aviso, botaoHtml: botaoHtml, _msgErro: msgErro};
})();
