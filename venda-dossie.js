/* venda-dossie.js — bloco "Dossiê do comprador" no painel da casa.
 * Carregado pelo vendas.html (uma linha, depois do app.js). Fala só com o
 * Apps Script PORTAL-VENDA; não chama nenhuma função de escrita do portal.
 * Se o painel do vendas.html mudar de estrutura, o bloco não aparece e o
 * resto do portal segue igual. */
(function () {
  "use strict";
  var URL_PORTAL_VENDA = "";   // URL /exec do PORTAL-VENDA deste ambiente (Task 7 e subida)

  var DOCS = [
    { id: "C1_IDENTIDADE",  rotulo: "Comprador 1 — identidade (CNH ou RG)", comprador: 1 },
    { id: "C1_COMPROVANTE", rotulo: "Comprador 1 — comprovante de endereço", comprador: 1 },
    { id: "C2_IDENTIDADE",  rotulo: "Comprador 2 — identidade (CNH ou RG)", comprador: 2 },
    { id: "C2_COMPROVANTE", rotulo: "Comprador 2 — comprovante de endereço", comprador: 2 },
    { id: "APROVACAO",      rotulo: "Aprovação da Caixa", comprador: 0 }
  ];
  var TIPOS_CASA = ["CASA DE RUA", "CASA DE CONDOMÍNIO"];
  var MSG = {
    NAO_AUTORIZADO: "Sua sessão expirou — entre de novo no portal.",
    SEM_PERMISSAO: "Seu login não tem acesso a Vendas.",
    SEM_PERMISSAO_TESTES: "O perfil TESTES só consulta; não grava.",
    UPLOAD_FALHOU: "Não consegui guardar o arquivo — tente de novo.",
    TROCAR_SEM_ARQUIVO: "Escolha o arquivo novo para trocar.",
    TIPO_DE_ARQUIVO_NAO_SUPORTADO: "Formato não suportado — envie foto em JPG ou PNG, ou PDF. (Foto de iPhone em HEIC: tire um print ou exporte como JPG.)",
    ARQUIVO_GRANDE: "Arquivo grande demais (PDF até 10 MB).",
    SEM_ARQUIVO: "Esse espaço ainda não tem arquivo.",
    ARQUIVO_NAO_LEGIVEL: "Não consegui abrir os arquivos desse espaço — envie de novo em JPG, PNG ou PDF.",
    MOTIVO_OBRIGATORIO: "Escreva o motivo da devolução.",
    SEM_RESPOSTA: "O servidor não respondeu — confira a internet e tente de novo.",
    PORTAL_VENDA_NAO_CONFIGURADO: "O dossiê ainda não foi ligado neste ambiente."
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function mensagemDeErro(erro, arquivoGuardado, foiLerDocumento) {
    var e = String(erro || "");
    if (arquivoGuardado) return "Arquivo guardado; a leitura falhou — use Ler de novo.";
    if (e === "SEM_RESPOSTA" && foiLerDocumento)
      return "O servidor demorou a responder — o arquivo pode ter sido guardado. Use Ler de novo antes de enviar outra vez.";
    if (e.indexOf("COLUNA_FALTANDO: ") === 0) return "A base não tem a coluna " + e.slice(17) + " — avise o desenvolvedor.";
    if (e.indexOf("TIPO_DE_COLUNA_ERRADO: ") === 0) return "A coluna " + e.slice(23) + " está com o tipo errado no Notion — avise o desenvolvedor.";
    return MSG[e] || "Algo deu errado (" + e + ") — tente de novo.";
  }
  function resumo(r) {
    var n = (r.preenchidos || []).length, o = (r.observacoes || []).length;
    var s = n ? "Lido: " + n + (n === 1 ? " campo preenchido" : " campos preenchidos") : "Lido: nenhum campo novo";
    if (o) s += "; " + o + (o === 1 ? " observação" : " observações") + " (veja abaixo)";
    s += r.dossie === "FALTA DOCUMENTO" ? "; ainda falta documento." : "; confira os dados e marque Conferido.";
    return s;
  }
  function escala(w, h, max) {
    var m = Math.max(w, h);
    if (m <= max) return { w: w, h: h };
    return { w: Math.round(w * max / m), h: Math.round(h * max / m) };
  }
  function tipoAceito(mime) {
    if (mime === "application/pdf") return "pdf";
    if (["image/jpeg", "image/png", "image/webp"].indexOf(mime) >= 0) return "imagem";
    return "";
  }
  /* true só para o placeholder que abrirObra põe em #pn-body enquanto carrega:
   * um único filho, classe "vazio", com o spinner .load dentro. Qualquer outra
   * coisa com .load (o spinner dos comentários, por exemplo) não conta. */
  function painelCarregando(qtdFilhos, classesPrimeiroFilho, primeiroTemLoad) {
    return qtdFilhos === 1 && classesPrimeiroFilho === "vazio" && !!primeiroTemLoad;
  }

  function html(e, ui) {
    var travado = !e.tipoCasa, ocupado = !!ui.ocupado, testes = !!ui.testes;
    var dis = function (cond) { return cond ? " disabled" : ""; };
    var h = '<div class="grp">Dossiê do comprador</div>';
    if (testes) h += '<div class="dz-aviso">Perfil TESTES só consulta.</div>';
    h += '<div class="dz-linha"><span class="dz-rot">Tipo de casa</span>' + TIPOS_CASA.map(function (t) {
      return '<button type="button" data-acao="tipo" data-valor="' + esc(t) + '" class="bt ghost bt-mini' +
        (e.tipoCasa === t ? " on" : "") + '"' + dis(ocupado || testes) + ">" + esc(t) + "</button>";
    }).join(" ") + "</div>";
    if (travado) h += '<div class="dz-aviso">Escolha o tipo de casa para liberar os documentos.</div>';
    h += '<div class="dz-linha"><span class="dz-rot">Compradores</span>' + ["1", "2"].map(function (n) {
      return '<button type="button" data-acao="dois" data-valor="' + n + '" class="bt ghost bt-mini' +
        ((ui.dois ? "2" : "1") === n ? " on" : "") + '">' + n + "</button>";
    }).join(" ") + "</div>";
    DOCS.forEach(function (d) {
      if (d.comprador === 2 && !ui.dois) return;
      var n = Number((e.arquivos && e.arquivos[d.id]) || 0) || 0;
      h += '<div class="dz-linha"><span class="dz-rot">' + esc(d.rotulo) + ' <small>' +
        (n ? n + (n === 1 ? " arquivo" : " arquivos") : "nenhum arquivo") + "</small>" +
        (ui.ocupado === d.id ? " <b>lendo…</b>" : "") + "</span>" +
        '<button type="button" class="bt bt-mini" data-acao="enviar" data-espaco="' + d.id + '"' + dis(travado || ocupado || testes) + ">Enviar e ler</button> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="reler" data-espaco="' + d.id + '"' + dis(travado || ocupado || testes || !n) + ">Ler de novo</button> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="trocar" data-espaco="' + d.id + '"' + dis(travado || ocupado || testes || !n) + ">Trocar</button></div>";
    });
    h += '<div class="dz-linha"><span class="dz-rot">Dossiê: <b>' + esc(e.dossie || "—") + "</b></span>" +
      '<button type="button" class="bt bt-mini" data-acao="conferir"' + dis(travado || ocupado || testes) + ">Marcar conferido</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="devolver"' + dis(travado || ocupado || testes) + ">Devolver</button></div>";
    if (e.observacao) h += "<pre>" + esc(e.observacao) + "</pre>";
    if (ui.msg) h += '<div class="dz-msg">' + esc(ui.msg) + "</div>";
    return h;
  }

  var MSG_CONTRATO = {
    MODELO_NAO_CONFIGURADO: "O modelo do contrato não está configurado neste ambiente.",
    CADASTRO_NAO_CONFIGURADO: "Os cadastros do contrato não estão configurados neste ambiente.",
    DRIVE_API_DESLIGADA: "Ative o serviço Drive API no PORTAL-VENDA (veja COMO-IMPLANTAR).",
    CONTRATO_FALHOU: "Não consegui gerar o contrato — tente de novo.",
    MODELO_COM_MARCADOR_SOBRANDO: "O modelo do contrato tem um campo sem preenchimento — avise o suporte.",
    FALTAM_DADOS: "Faltam dados para gerar o contrato."
  };
  /* Nunca inclui nomes de marcador do modelo (resposta.marcadores): esses vão só para o console. */
  function mensagemContrato(r) {
    var e = String((r && r.erro) || "");
    return MSG_CONTRATO[e] || mensagemDeErro(e);
  }
  function htmlContrato(e, u) {
    var ocupado = !!u.ocupadoContrato, testes = !!u.testes;
    var dis = (ocupado || testes) ? " disabled" : "";
    var h = '<div class="grp">Contrato</div>';
    if (testes) h += '<div class="dz-aviso">Perfil TESTES só consulta.</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    if (u.ocupadoContrato === "gerar") h += '<div class="dz-linha"><b>gerando… (até 1 minuto)</b></div>';
    if (u.faltas && u.faltas.length) {
      h += '<div class="dz-aviso">Para gerar o contrato, falta:</div><ul>' +
        u.faltas.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>";
    }
    if (e.gerado) {
      h += '<div class="dz-linha"><span class="dz-rot">Contrato gerado: ' + esc(e.nome) + "</span>" +
        '<button type="button" class="bt bt-mini" data-acao="c-ver"' + dis + ">Visualizar</button> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="c-gerar"' + dis + ">Gerar de novo</button></div>";
    } else {
      h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="c-gerar"' + dis + ">Gerar contrato</button></div>";
    }
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    if (u.link && /^https:\/\//.test(u.link)) {
      h += '<div class="dz-msg">O navegador bloqueou a janela — clique em Abrir contrato. ' +
        '<a href="' + esc(u.link) + '" target="_blank" rel="noopener">Abrir contrato</a></div>';
    }
    return h;
  }

  var MSG_MC = {
    MC_NAO_CONFIGURADO: "O lançamento no Mais Controle não está configurado neste ambiente.",
    MC_JA_LANCADA: "Esta venda já foi lançada no Mais Controle.",
    MC_PROCESSANDO: "O robô ainda está processando — aguarde e clique em Atualizar.",
    MC_SEM_PREVIA: "Veja a prévia primeiro: o lançamento só é liberado com PRÉVIA OK.",
    MC_DISPARO_FALHOU: "Não consegui acionar o robô do Mais Controle — tente de novo."
  };
  function mensagemMC(r) {
    var e = String((r && r.erro) || "");
    return MSG_MC[e] || mensagemDeErro(e);
  }
  /* e = {situacao, vendaId}; u = {ocupado, msg, testes} */
  function htmlMC(e, u) {
    /* PROCESSANDO com mais de 15 min (carimbo [t=ms]) = o robô não respondeu: libera pedir de novo */
    var tProc = e && /\[t=(\d+)\]/.exec(e.situacao || "");
    var testes = !!u.testes, processando = !!(e && /^PROCESSANDO/.test(e.situacao || "") &&
      !(tProc && (u.agora || Date.now()) - Number(tProc[1]) > 15 * 60 * 1000));
    var ocupado = !!u.ocupado || processando;
    var h = '<div class="grp">Mais Controle</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    var sit = (e.situacao || "ainda não lançada").replace(/\s*\[t=\d+\]/, "");
    h += '<div class="dz-linha"><span class="dz-rot">Situação: <b>' + esc(sit) + "</b></span></div>";
    if (e.vendaId) h += '<div class="dz-linha"><span class="dz-rot">Venda no Mais Controle: ' + esc(e.vendaId) + "</span></div>";
    if (processando) h += '<div class="dz-linha"><b>o robô está trabalhando… (1 a 3 minutos)</b></div>';
    var liberaLancar = /^PR[ÉE]VIA OK/i.test(sit) && !e.vendaId;
    var d = function (x) { return (x || testes) ? " disabled" : ""; };
    h += '<div class="dz-linha">';
    if (!e.vendaId) h += '<button type="button" class="bt ghost bt-mini" data-acao="mc-previa"' + d(ocupado) + ">Ver prévia</button> ";
    if (!e.vendaId) h += '<button type="button" class="bt bt-mini" data-acao="mc-lancar"' + d(ocupado || !liberaLancar) + ">Lançar no Mais Controle</button> ";
    h += '<button type="button" class="bt ghost bt-mini" data-acao="mc-atualizar"' + (u.ocupado ? " disabled" : "") + ">Atualizar</button></div>";
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    return h;
  }

  var exportar = { URL_PORTAL_VENDA: URL_PORTAL_VENDA, DOCS: DOCS, html: html, mensagemDeErro: mensagemDeErro,
                   resumo: resumo, escala: escala, tipoAceito: tipoAceito, painelCarregando: painelCarregando,
                   htmlContrato: htmlContrato, mensagemContrato: mensagemContrato, htmlMC: htmlMC, mensagemMC: mensagemMC };
  if (typeof module !== "undefined" && module.exports) { module.exports = exportar; return; }

  /* ---------------- navegador ---------------- */
  var CSS = "#dossie-wrap{margin-bottom:14px}#dossie-wrap .dz-linha{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}" +
    "#dossie-wrap .dz-rot{flex:1 1 200px}#dossie-wrap .on{outline:2px solid #4cd964}#dossie-wrap .dz-aviso{color:#E67E22;margin:6px 0}" +
    "#dossie-wrap .dz-msg{margin-top:8px;font-weight:600}#dossie-wrap pre{white-space:pre-wrap;font:inherit;margin:4px 0}" +
    "#contrato-wrap{margin-top:14px}#contrato-wrap .dz-linha{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}" +
    "#contrato-wrap .dz-rot{flex:1 1 200px}#contrato-wrap .dz-aviso{color:#E67E22;margin:6px 0}" +
    "#contrato-wrap .dz-msg{margin-top:8px;font-weight:600}#contrato-wrap ul{margin:4px 0 4px 18px}";
  var estado = null, ui = { dois: false, ocupado: null, msg: "", testes: false }, paginaDoBloco = null;

  function obraAberta() { try { return OBRA_ABERTA; } catch (e) { return null; } }
  function mesmaCasa(pageId) { return obraAberta() === pageId && paginaDoBloco === pageId; }
  function perfilTestes() {
    var s = (typeof sessao === "function") ? sessao() : null;
    return !!(s && String(s.tipo || "").toUpperCase() === "TESTES");
  }
  function wrap() { return document.getElementById("dossie-wrap"); }
  function pintar() {
    var w = wrap(); if (!w) return;
    w.innerHTML = estado ? html(estado, ui)
      : '<div class="grp">Dossiê do comprador</div><div class="vazio">' + esc(ui.msg || "carregando…") + "</div>";
  }
  async function chamarVenda(payload, ms) {
    if (!/^https:\/\/script\.google\.com\//.test(URL_PORTAL_VENDA)) return { ok: false, erro: "PORTAL_VENDA_NAO_CONFIGURADO" };
    var s = (typeof sessao === "function") ? sessao() : null;
    payload.token = s && s.token;
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, ms || 45000);
    try {
      var r = await fetch(URL_PORTAL_VENDA, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                                             body: JSON.stringify(payload), signal: ctrl.signal });
      return await r.json();
    } catch (e) { return { ok: false, erro: "SEM_RESPOSTA" }; }
    finally { clearTimeout(t); }
  }
  async function carregarEstado(pageId) {
    var r = await chamarVenda({ action: "estado", pageId: pageId });
    if (!mesmaCasa(pageId)) return;
    if (r.ok) { estado = r; if (r.doisCompradores) ui.dois = true; }
    else ui.msg = mensagemDeErro(r.erro);
    pintar();
  }
  function lerArquivoBase64(blob) {
    return new Promise(function (ok, falha) {
      var fr = new FileReader();
      fr.onload = function () { ok(String(fr.result).split(",")[1]); };
      fr.onerror = falha;
      fr.readAsDataURL(blob);
    });
  }
  async function prepararArquivo(file) {
    var tipo = tipoAceito(file.type);
    if (!tipo) return { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" };
    if (tipo === "pdf") {
      if (file.size > 10 * 1024 * 1024) return { erro: "ARQUIVO_GRANDE" };
      return { nome: file.name, mime: "application/pdf", base64: await lerArquivoBase64(file) };
    }
    var url = URL.createObjectURL(file);
    try {
      var img = await new Promise(function (ok, falha) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = falha; i.src = url; });
      var d = escala(img.naturalWidth, img.naturalHeight, 1600);
      var cv = document.createElement("canvas"); cv.width = d.w; cv.height = d.h;
      cv.getContext("2d").drawImage(img, 0, 0, d.w, d.h);
      var jpg = await new Promise(function (ok) { cv.toBlob(ok, "image/jpeg", 0.85); });
      return { nome: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", base64: await lerArquivoBase64(jpg) };
    } catch (e) { return { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" }; }
    finally { URL.revokeObjectURL(url); }
  }
  function escolherArquivo() {
    return new Promise(function (ok) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp,application/pdf";
      var resolvido = false;
      function resolver(f) {
        if (resolvido) return;
        resolvido = true;
        window.removeEventListener("focus", aoFocar);
        ok(f);
      }
      function aoFocar() {
        window.removeEventListener("focus", aoFocar);
        /* Navegador sem o evento "cancel" no <input type=file>: se ao voltar
         * o foco pra janela nenhum arquivo foi escolhido, foi cancelamento —
         * mas dá uma folga pro "change" (que também dispara perto do foco)
         * resolver primeiro quando um arquivo FOI escolhido. */
        setTimeout(function () {
          if (!resolvido && !(inp.files && inp.files.length)) resolver(null);
        }, 500);
      }
      inp.onchange = function () { resolver(inp.files && inp.files[0]); };
      inp.addEventListener("cancel", function () { resolver(null); });
      /* Com "cancel" nativo, o cancelamento já chega por esse evento — a
       * folga de 500 ms do fallback "focus" pode descartar um arquivo
       * escolhido da nuvem no Android, cujo "change" chega depois disso. */
      if (!("oncancel" in inp)) window.addEventListener("focus", aoFocar);
      inp.click();
    });
  }
  async function depoisDeGravar(pageId, r, texto, foiLerDocumento) {
    if (!mesmaCasa(pageId)) return;
    ui.ocupado = null;
    ui.msg = r.ok ? texto : mensagemDeErro(r.erro, r.arquivoGuardado, foiLerDocumento);
    await carregarEstado(pageId);
    if (mesmaCasa(pageId) && typeof abrirObra === "function") abrirObra(pageId);
  }
  async function aoClicar(ev) {
    var b = ev.target.closest("[data-acao]"); if (!b || b.disabled) return;
    var pageId = obraAberta(), acao = b.getAttribute("data-acao"), r;
    if (!pageId) return;
    if (acao === "dois") { ui.dois = b.getAttribute("data-valor") === "2"; pintar(); return; }
    if (ui.ocupado) return;
    if (acao === "tipo") {
      ui.ocupado = "tipo"; pintar();
      r = await chamarVenda({ action: "tipoCasa", pageId: pageId, valor: b.getAttribute("data-valor") });
      return depoisDeGravar(pageId, r, "Tipo de casa gravado.");
    }
    if (acao === "enviar" || acao === "reler" || acao === "trocar") {
      if (acao === "trocar" && !window.confirm("Trocar o documento? O arquivo atual será removido e os campos deste documento serão lidos de novo.")) return;
      var espaco = b.getAttribute("data-espaco"), payload = { action: "lerDocumento", pageId: pageId, espaco: espaco };
      if (acao === "trocar") payload.trocar = true;
      ui.ocupado = espaco; ui.msg = ""; pintar();
      if (acao === "enviar" || acao === "trocar") {
        var f = await escolherArquivo();
        if (!f) { if (mesmaCasa(pageId)) { ui.ocupado = null; pintar(); } return; }
        var arq = await prepararArquivo(f);
        if (arq.erro) {
          if (mesmaCasa(pageId)) { ui.ocupado = null; ui.msg = mensagemDeErro(arq.erro); pintar(); }
          return;
        }
        payload.arquivo = arq;
      }
      r = await chamarVenda(payload, 150000);
      return depoisDeGravar(pageId, r, r.ok ? resumo(r) : "", true);
    }
    if (acao === "conferir") {
      ui.ocupado = "conferir"; pintar();
      r = await chamarVenda({ action: "conferir", pageId: pageId });
      return depoisDeGravar(pageId, r, "Dossiê marcado como conferido.");
    }
    if (acao === "devolver") {
      var motivo = window.prompt("Motivo da devolução (o que falta ou está errado):");
      if (!motivo || !motivo.trim()) return;
      ui.ocupado = "devolver"; pintar();
      r = await chamarVenda({ action: "devolver", pageId: pageId, motivo: motivo });
      return depoisDeGravar(pageId, r, "Dossiê devolvido.");
    }
  }
  /* ---- bloco Contrato: estado próprio, separado do dossiê ---- */
  var seqC = 0, carregandoC = null, estadoC = null, uiC = { ocupadoContrato: null, faltas: null, msg: "", testes: false }, paginaDoContrato = null;
  function novoUiC() { return { ocupadoContrato: null, faltas: null, msg: "", testes: perfilTestes() }; }
  function mesmaCasaContrato(pageId) { return obraAberta() === pageId && paginaDoContrato === pageId; }
  function wrapC() { return document.getElementById("contrato-wrap"); }
  function pintarC() {
    var w = wrapC(); if (!w) return;
    w.innerHTML = htmlContrato(estadoC, uiC) + '<div id="ass-wrap">' + htmlAss() + "</div>" +
      '<div id="mc-wrap">' + htmlMC(estadoM, uiM) + "</div>";
  }
  /* ---- Assinatura (Clicksign): o desenho e as ações moram em venda/assinatura-ui.js
   * (window.VendaAssinatura, carregado por iniciar()); aqui só o estado e a ligação. */
  var ctxA = { estado: null, ocupado: null, msg: "", faltas: null, testes: false };
  function novoCtxA() { return { estado: null, ocupado: null, msg: "", faltas: null, testes: perfilTestes() }; }
  function htmlAss() {
    if (!window.VendaAssinatura) return '<div class="grp">Assinatura</div><div class="vazio">carregando…</div>';
    ctxA.contratoGerado = !!(estadoC && estadoC.gerado);
    return window.VendaAssinatura.montarBlocoAssinatura(ctxA);
  }
  function pintarA() { var w = document.getElementById("ass-wrap"); if (w) w.innerHTML = htmlAss(); }
  async function carregarAss(pageId) {
    var r = await chamarVenda({ action: "assinaturaEstado", pageId: pageId }, 90000);
    if (!mesmaCasaContrato(pageId)) return;
    if (r.ok) { ctxA.estado = { situacao: r.situacao || "", envelope: !!r.envelope, signatarios: r.signatarios || [] }; ctxA.msg = ""; }
    else ctxA.msg = window.VendaAssinatura ? window.VendaAssinatura.mensagemAssinatura(r) : "";
    pintarA();
  }
  async function aoClicarAss(acao, pageId) {
    if (!window.VendaAssinatura || ctxA.ocupado) return;
    ctxA.contratoGerado = !!(estadoC && estadoC.gerado);
    var novo = await window.VendaAssinatura.executarAcaoAssinatura(acao, ctxA, {
      pageId: pageId,
      confirmar: function (t) { return window.confirm(t); },
      chamar: function (p) { return chamarVenda(p, 150000); },
      pintar: function (c) { ctxA = c; pintarA(); }
    });
    if (!mesmaCasaContrato(pageId)) return;
    ctxA = novo; pintarA();
  }
  /* ---- Mais Controle: mora dentro do contrato-wrap (que precisa ser o último
   * filho de #pn-body); usa o mesmo seqC para descartar resposta de outra casa. */
  var estadoM = null, uiM = { ocupado: null, msg: "", testes: false }, esperaM = null;
  function novoUiM() { return { ocupado: null, msg: "", testes: perfilTestes() }; }
  function pintarM() {
    var w = document.getElementById("mc-wrap"); if (!w) return;
    w.innerHTML = htmlMC(estadoM, uiM);
  }
  async function carregarMC(pageId, seq) {
    var r = await chamarVenda({ action: "mcEstado", pageId: pageId });
    /* só a casa importa aqui: o seqC sobe a cada clique do Contrato e mataria o acompanhamento */
    if (!mesmaCasaContrato(pageId)) return null;
    if (r.ok) { estadoM = { situacao: r.situacao || "", vendaId: r.vendaId || "" }; }
    else uiM.msg = mensagemMC(r);
    pintarM();
    return r;
  }
  function acompanharMC(pageId, seq, voltas) {
    if (esperaM) clearTimeout(esperaM);
    esperaM = setTimeout(async function () {
      esperaM = null;
      var r = await carregarMC(pageId, seq);
      if (r && r.ok && /^PROCESSANDO/.test(r.situacao || "") && voltas > 1) acompanharMC(pageId, seq, voltas - 1);
    }, 10000);
  }
  async function aoClicarMC(acao, pageId) {
    if (uiM.ocupado) return;
    var seq = seqC;
    if (acao === "mc-atualizar") { uiM.msg = ""; await carregarMC(pageId, seq); return; }
    var aplicar = acao === "mc-lancar";
    if (aplicar && !window.confirm("Lançar esta venda no Mais Controle? Será criado o cliente (se não existir) e a venda com as parcelas da prévia.")) return;
    uiM.ocupado = acao; uiM.msg = ""; pintarM();
    var r = await chamarVenda({ action: "mcLancar", pageId: pageId, aplicar: aplicar });
    if (!mesmaCasaContrato(pageId)) return;
    uiM.ocupado = null;
    uiM.msg = r.ok ? (aplicar ? "Lançamento pedido ao robô." : "Prévia pedida ao robô.") : mensagemMC(r);
    await carregarMC(pageId, seq);
    if (r.ok) acompanharMC(pageId, seq, 24);
  }
  /* seqC: contador de pedidos; sobe a cada troca de casa e a cada ação. Resposta
   * com seq diferente do capturado é descartada (caso A→B→A, em que mesmaCasaContrato
   * sozinho enganaria). carregandoC evita pedidos paralelos quando o bloco é recriado
   * enquanto o estado ainda carrega. */
  async function carregarContrato(pageId) {
    if (carregandoC === pageId) return;
    carregandoC = pageId;
    var seq = ++seqC;
    var r = await chamarVenda({ action: "contratoEstado", pageId: pageId });
    if (carregandoC === pageId) carregandoC = null;
    if (seq !== seqC || !mesmaCasaContrato(pageId)) return;
    if (r.ok) { estadoC = { gerado: !!r.gerado, nome: r.nome || "", url: r.url || "" }; uiC.msg = ""; }
    else uiC.msg = mensagemContrato(r);
    pintarC();
  }
  async function aoClicarContrato(ev) {
    var b = ev.target.closest("[data-acao]"); if (!b || b.disabled) return;
    var pageId = obraAberta(), acao = b.getAttribute("data-acao"), r, seq;
    if (pageId && paginaDoContrato === pageId && /^mc-/.test(acao)) return aoClicarMC(acao, pageId);
    if (pageId && paginaDoContrato === pageId && /^a-/.test(acao)) return aoClicarAss(acao, pageId);
    if (!pageId || uiC.ocupadoContrato || paginaDoContrato !== pageId) return;
    if (acao === "c-ver") {
      /* abre a janela AGORA, dentro do clique (antes de qualquer await), senão o
       * navegador a bloqueia; depois só troca o endereço. Sem "noopener" aqui
       * (devolveria null): o opener é zerado à mão. */
      var w = window.open("about:blank", "_blank");
      uiC.ocupadoContrato = "ver"; uiC.msg = ""; uiC.link = null; pintarC();
      seq = ++seqC;
      r = await chamarVenda({ action: "contratoEstado", pageId: pageId });
      if (seq !== seqC || !mesmaCasaContrato(pageId)) { if (w) { try { w.close(); } catch (e) {} } return; }
      uiC.ocupadoContrato = null;
      if (r.ok && r.gerado && /^https:\/\//.test(r.url || "")) {
        estadoC = { gerado: true, nome: r.nome || "", url: r.url };
        if (w) { try { w.opener = null; } catch (e) {} w.location.href = r.url; }
        else uiC.link = r.url;
      } else {
        if (w) { try { w.close(); } catch (e) {} }
        uiC.msg = r.ok ? "Ainda não há contrato gerado." : mensagemContrato(r);
      }
      pintarC();
      return;
    }
    if (acao === "c-gerar") {
      if (estadoC && estadoC.gerado && !window.confirm("Gerar de novo? O contrato atual será substituído.")) return;
      uiC.ocupadoContrato = "gerar"; uiC.msg = ""; uiC.faltas = null; uiC.link = null; pintarC();
      seq = ++seqC;
      r = await chamarVenda({ action: "gerarContrato", pageId: pageId }, 150000);
      if (seq !== seqC || !mesmaCasaContrato(pageId)) return;
      uiC.ocupadoContrato = null;
      if (r.ok) {
        estadoC = { gerado: true, nome: r.nome || "", url: r.url || "" };
        /* condomínio: campos que saíram em branco ("____") no contrato não travam, mas avisam */
        uiC.msg = r.avisos && r.avisos.length ? "Contrato gerado. Atenção: " + r.avisos.join("; ") + "." : "Contrato gerado.";
      } else if (r.erro === "FALTAM_DADOS" && r.faltas && r.faltas.length) {
        uiC.faltas = r.faltas;
      } else {
        if (r.erro === "MODELO_COM_MARCADOR_SOBRANDO" && typeof console !== "undefined") console.warn("contrato: marcadores sobrando", r.marcadores);
        uiC.msg = mensagemContrato(r);
      }
      pintarC();
      /* sem resposta: o servidor pode ter gerado mesmo assim — olha de novo */
      if (!r.ok && r.erro === "SEM_RESPOSTA") carregarContrato(pageId);
    }
  }
  /* Contrato é sempre o ÚLTIMO filho de #pn-body. Sem laço de observer: o
   * MutationObserver só reage a childList de #pn-body, e aqui só mexemos quando
   * o bloco falta ou não está por último; depois de anexar/mover ele está
   * por último, então a chamada disparada pela própria mutação não faz nada. */
  function garantirContrato(body, id) {
    var w = wrapC();
    if (w) { if (body.lastElementChild !== w) body.appendChild(w); return; }
    if (paginaDoContrato !== id) { paginaDoContrato = id; seqC++; estadoC = null; uiC = novoUiC(); estadoM = null; uiM = novoUiM(); ctxA = novoCtxA(); }
    w = document.createElement("div"); w.id = "contrato-wrap";
    w.addEventListener("click", aoClicarContrato);
    body.appendChild(w);
    pintarC();
    if (!estadoC) carregarContrato(id);
    if (!estadoM) carregarMC(id, seqC);
    if (!ctxA.estado) carregarAss(id);
  }
  function garantirBloco(body) {
    var id = obraAberta();
    if (!id) {
      /* painel fechado: zera para a mesma casa recarregar o estado ao reabrir */
      if (paginaDoBloco !== null) { paginaDoBloco = null; estado = null; ui = { dois: false, ocupado: null, msg: "", testes: false }; }
      if (paginaDoContrato !== null) { paginaDoContrato = null; seqC++; estadoC = null; uiC = novoUiC(); estadoM = null; uiM = novoUiM(); ctxA = novoCtxA(); }
      return;
    }
    if (painelCarregando(body.children.length, body.firstElementChild ? body.firstElementChild.className : "",
        !!(body.firstElementChild && body.firstElementChild.querySelector(".load")))) return;
    if (!wrap()) {
      if (paginaDoBloco !== id) { paginaDoBloco = id; estado = null; ui = { dois: false, ocupado: null, msg: "", testes: perfilTestes() }; }
      var w = document.createElement("div"); w.id = "dossie-wrap";
      w.addEventListener("click", aoClicar);
      body.insertBefore(w, body.firstChild);
      pintar();
      if (!estado) carregarEstado(id);
    }
    garantirContrato(body, id);
  }
  function iniciar() {
    var body = document.getElementById("pn-body"); if (!body) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    /* o bloco de assinatura mora em arquivo próprio; vendas.html continua com uma linha só */
    var sa = document.createElement("script"); sa.src = "venda/assinatura-ui.js?v=1";
    sa.onload = function () { pintarA(); };
    document.head.appendChild(sa);
    new MutationObserver(function () { garantirBloco(body); }).observe(body, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
