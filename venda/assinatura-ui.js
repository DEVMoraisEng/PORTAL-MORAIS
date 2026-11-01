/* assinatura-ui.js — bloco "Assinatura" do painel da casa (entrega 3).
 * JS puro do navegador, no estilo do venda-dossie.js. Fala só com o Apps Script
 * PORTAL-VENDA (ações assinaturaEnviar, assinaturaEstado, assinaturaReenviar e assinaturaCancelar; 01/11: documentosAssinados
 * e verDocumentoAssinado). A integração no
 * vendas.html / venda-dossie.js fica com quem coordena: este arquivo só desenha
 * o bloco e executa as ações, recebendo de fora como chamar o servidor.
 * Nunca mostra e-mail: o servidor devolve só papel, nome mascarado ("Maria S."), situação e data. */
(function () {
  "use strict";

  var REENVIAVEL = ["CANCELADO", "RECUSADO", "EXPIRADO"];
  var SITUACAO = {
    ENVIADO: "Enviado — aguardando assinaturas",
    ASSINADO: "Assinado por todos",
    RECUSADO: "Recusado por um signatário — confira o motivo na Clicksign e envie de novo",
    CANCELADO: "Cancelado na Clicksign — pode enviar de novo",
    EXPIRADO: "Prazo vencido sem todas as assinaturas — pode enviar de novo",
    RASCUNHO: "Rascunho na Clicksign (não foi enviado). O envio parou no meio. Clique em Descartar rascunho e envie de novo."
  };
  var MSG = {
    NAO_AUTORIZADO: "Sua sessão expirou — entre de novo no portal.",
    SEM_PERMISSAO: "Seu login não tem acesso a Vendas.",
    SEM_PERMISSAO_TESTES: "O perfil TESTES não envia, não reenvia, não cancela nem atualiza a assinatura.",
    ASSINATURA_OCUPADA: "Há outro envio para assinatura em andamento — espere um minuto e tente de novo.",
    CONTRATO_DESATUALIZADO: "Os dados mudaram depois de gerar o contrato — gere de novo e depois envie.",
    TERMO_DESATUALIZADO: "Os dados mudaram depois de gerar o termo de pré-reserva — gere o termo de novo e depois envie.",
    CONFISSAO_DESATUALIZADA: "Os termos de confissão não são deste contrato — gere o contrato de novo (os termos saem junto) e envie.",
    SEM_RESPOSTA: "O servidor não respondeu — confira a internet e tente de novo.",
    ASSINADO_AGUARDANDO_ARQUIVO: "O arquivo assinado ainda está sendo preparado pela Clicksign — espere um instante e clique em Atualizar situação.",
    /* 01/11/2026 (revisão final, I3): o envio sem resposta pode ter dado certo (o servidor repete a Clicksign por até 180 s) */
    SEM_RESPOSTA_ENVIO: "A Clicksign está demorando. O envio pode ter dado certo — espere 1 minuto e clique em Atualizar situação antes de tentar de novo.",
    PORTAL_VENDA_NAO_CONFIGURADO: "A assinatura ainda não foi ligada neste ambiente.",
    CLICKSIGN_SEM_TOKEN: "A assinatura ainda não foi ligada neste ambiente (falta o token da Clicksign) — avise o administrador.",
    CLICKSIGN_URL_INVALIDA: "O endereço da Clicksign está errado nas configurações — avise o administrador.",
    RASCUNHO_NAO_APAGADO: "A Clicksign não apagou o rascunho — tente Descartar rascunho de novo em 1 minuto.",
    ENVELOPE_ABERTO: "Este contrato já está com a Clicksign — use Atualizar situação.",
    SEM_CONTRATO_GERADO: "Gere o contrato antes de enviar para assinatura.",
    FALTAM_DADOS: "Complete os dados abaixo e envie de novo.",
    CADASTRO_NAO_CONFIGURADO: "Os cadastros do contrato não estão configurados — avise o administrador.",
    CONTRATO_ILEGIVEL: "Não consegui abrir o PDF do contrato gerado — gere o contrato de novo.",
    DOWNLOAD_ASSINADO_FALHOU: "Não consegui baixar o PDF assinado da Clicksign — tente Atualizar situação daqui a pouco.",
    UPLOAD_FALHOU: "Não consegui guardar o PDF assinado na casa — tente Atualizar situação de novo.",
    CLICKSIGN_ENVELOPE_SEM_DOCUMENTO: "O envelope na Clicksign está sem documento — avise o desenvolvedor.",
    SEM_ENVELOPE: "Este contrato ainda não foi enviado para assinatura.",
    NINGUEM_PENDENTE: "Todos já assinaram — não há link para reenviar. Use Atualizar situação.",
    ENVELOPE_NAO_ATIVO: "O envelope não está mais aguardando assinaturas — use Atualizar situação.",
    /* entrega 14: Ver contrato assinado */
    SEM_ASSINADO: "O PDF assinado ainda não está na casa — use Atualizar situação.",
    ASSINADO_ILEGIVEL: "Não consegui abrir o PDF assinado guardado na casa — use Atualizar situação ou avise o desenvolvedor.",
    ASSINADO_GRANDE: "O PDF assinado ficou grande demais para abrir pelo portal — abra pelo Notion.",
    /* 30/10: rubricas do comprador e documentos só dele (memorial, projeto aprovado) */
    RUBRICAS_FALTANDO: "A tela está desatualizada — recarregue a página (Ctrl+F5) e envie de novo.",
    RUBRICAS_DE_OUTRO_PDF: "O contrato mudou enquanto a tela lia o PDF — envie de novo.",
    RUBRICAS_INVALIDAS: "As posições das rubricas saíram erradas — gere o contrato de novo ou avise o desenvolvedor.",
    RUBRICAS_NAO_ACHADAS: "Não achei no contrato os campos “ASSINATURA: ____” que o comprador rubrica — gere o contrato de novo ou avise o desenvolvedor.",
    RUBRICAS_SEM_LEITOR: "Não consegui abrir o leitor de PDF do navegador — confira a internet e tente de novo.",
    MEMORIAL_NAO_CONFIGURADO: "O modelo do memorial descritivo não abre — avise o administrador.",
    MEMORIAL_FALHOU: "Não consegui gerar o memorial descritivo — tente de novo ou avise o desenvolvedor.",
    PROJETO_NAO_CONFIGURADO: "O PDF do projeto aprovado não abre — avise o administrador.",
    /* 01/11/2026 (plano 23 A): depois de assinado por todos, só visualizar */
    NAO_ASSINADO: "Ainda não foi assinado por todos — use Atualizar situação.",
    DOCUMENTO_NAO_ENCONTRADO: "Esse documento não está mais no envelope — recarregue a página.",
    CONTRATO_ASSINADO: "O contrato já foi assinado por todos — nada mais muda nele. Recarregue a página.",
    TERMO_ASSINADO: "O termo de pré-reserva já foi assinado por todos — nada mais muda nele. Recarregue a página."
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function situacaoDe(estado) { return String((estado && estado.situacao) || "").toUpperCase(); }
  /* Envelope com situação vazia conta como aberto (mesma regra do servidor). */
  function podeEnviar(c) {
    var e = c.estado;
    if (!e || !c.contratoGerado || c.ocupado || c.testes) return false;
    return !e.envelope || REENVIAVEL.indexOf(situacaoDe(e)) >= 0;
  }
  /* entrega 14: todos assinaram e o PDF assinado já está na casa (CONTRATO ASSINADO) */
  function podeVerAssinado(c) { return !!(c.estado && situacaoDe(c.estado) === "ASSINADO" && c.estado.temAssinado); }
  /* Atualizar situação grava na casa: o perfil TESTES não usa (o servidor também barra). */
  function podeAtualizar(c) { return !!(c.estado && c.estado.envelope && !c.ocupado && !c.testes); }
  /* situação de um signatário: a nova (assinou/pendente/recusou) ou, de resposta antiga, pelo assinou */
  function sitSignatario(s) { return s.situacao || (s.assinou ? "assinou" : "pendente"); }
  function pendentes(e) { return ((e && e.signatarios) || []).filter(function (s) { return sitSignatario(s) === "pendente"; }).length; }
  /* Reenviar link: envelope aguardando assinaturas e alguém pendente. Não grava na casa, mas o TESTES não dispara e-mail. */
  function podeReenviar(c) {
    return !!(c.estado && c.estado.envelope && situacaoDe(c.estado) === "ENVIADO" && pendentes(c.estado) && !c.ocupado && !c.testes);
  }
  /* 29/10: cancelar o envelope que ainda aguarda assinaturas (dá para enviar de novo depois) */
  function podeCancelar(c) {
    return !!(c.estado && c.estado.envelope && situacaoDe(c.estado) === "ENVIADO" && !c.ocupado && !c.testes);
  }
  /* Descartar rascunho: o envio parou no meio e o envelope ficou em rascunho (ninguém recebeu nada) */
  function podeDescartar(c) {
    return !!(c.estado && c.estado.envelope && situacaoDe(c.estado) === "RASCUNHO" && !c.ocupado && !c.testes);
  }
  /* "2026-10-07T10:20:30.000-03:00" → "07/10/2026 10:20" (hora como a Clicksign mandou) */
  function dataCurta(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(iso || ""));
    return m ? m[3] + "/" + m[2] + "/" + m[1] + (m[4] ? " " + m[4] + ":" + m[5] : "") : "";
  }
  var ROTULO_SIG = { assinou: ["ass-ok", "✓ assinou"], recusou: ["ass-rec", "✗ recusou"], pendente: ["ass-pend", "⏳ pendente"] };

  function mensagemAssinatura(r) {
    r = r || {};
    var e = String(r.erro || "");
    if (!e) {
      if (r.aviso === "NOTIFICACAO_FALHOU")
        return "Enviado, mas o e-mail de aviso falhou — use Atualizar situação; se ninguém receber, avise o desenvolvedor.";
      if (r.aviso === "ASSINATURAS_INCOMPLETAS")
        return "A Clicksign finalizou o envelope, mas não registrou a assinatura de todos — confira o PDF assinado e avise o desenvolvedor.";
      return "";
    }
    if (e === "CLICKSIGN_FALHOU") {
      var consulta = /^consultar/.test(String(r.passo || ""));
      if (r.incerto)
        return "A Clicksign não respondeu ao ativar o envelope " + r.envelopeId + " e não deu para confirmar se ele foi enviado — use Atualizar situação daqui a pouco; não envie de novo.";
      /* rascunho que não foi apagado: barra novo envio até sumir da Clicksign */
      var sobra = r.envelopeId && r.rascunhoApagado === false
        ? " O envelope ficou como rascunho na Clicksign (nada foi enviado aos signatários). O envio parou no meio. Clique em Descartar rascunho e envie de novo." : "";
      if (!r.http) return "A Clicksign não respondeu (passo: " + r.passo + ")" +
        (consulta ? " — tente Atualizar situação daqui a pouco." : (sobra ? "." + sobra : ". Nada foi enviado aos signatários — tente de novo em alguns minutos."));
      return "A Clicksign recusou " + (consulta ? "a consulta" : "o envio") + " (passo: " + r.passo + ", código " + r.http +
        (r.detalhe ? ": " + r.detalhe : "") + ")." +
        (consulta ? " Avise o desenvolvedor." : (sobra || " Nada foi enviado aos signatários — avise o desenvolvedor."));
    }
    if (e === "GRAVACAO_FALHOU" && r.envelopeId)
      return "O envelope " + r.envelopeId + " foi enviado aos signatários, mas o portal não conseguiu anotar na casa — use Atualizar situação daqui a pouco; não envie de novo.";
    if (e === "GRAVACAO_FALHOU" && r.rascunhoApagado)
      return "Não consegui anotar o envelope na casa, então ele foi desfeito. Nada foi enviado aos signatários — tente de novo.";
    if (e === "GRAVACAO_FALHOU") return "Não consegui gravar a situação na casa — tente Atualizar situação de novo.";
    if (e.indexOf("CLICKSIGN_SEM_LINK_ASSINADO") === 0)
      return "A Clicksign diz que terminou, mas não entregou o link do PDF assinado — avise o desenvolvedor.";
    if (e.indexOf("CLICKSIGN_STATUS_DESCONHECIDO") === 0)
      return "A Clicksign devolveu uma situação que o portal não conhece — avise o desenvolvedor.";
    if (e === "REENVIO_RECENTE")
      return "O link já foi reenviado há pouco — espere " + (Number(r.minutos) || 10) + " minuto" + (Number(r.minutos) === 1 ? "" : "s") + " para reenviar de novo.";
    if (e.indexOf("COLUNA_FALTANDO: ") === 0) return "A base não tem a coluna " + e.slice(17) + " — avise o desenvolvedor.";
    if (e.indexOf("TIPO_DE_COLUNA_ERRADO: ") === 0) return "A coluna " + e.slice(23) + " está com o tipo errado no Notion — avise o desenvolvedor.";
    return MSG[e] || "Algo deu errado (" + e + ") — tente de novo.";
  }

  /* ---- 01/11/2026 (plano 23 A) ----
   * Dono: "depois do contrato assinado por todos, tem que tirar essas opções e deixar só para visualizar os documentos todos
   * assinados (inclusive o projeto)". Com ASSINADO o bloco vira "Documentos assinados": Ver e Baixar de cada documento do
   * envelope (lista da ação documentosAssinados, em c.assinados) e Atualizar situação. O arquivo baixado se chama
   * "<nome do documento> - ASSINADO.pdf". */
  function nomeArquivoAssinado(nome) {
    var n = String(nome || "").trim().replace(/\.pdf$/i, "").replace(/\s*\[#[0-9a-f]{8}\]\s*$/i, "").trim();
    n = n.replace(/^(CONTRATO|TERMO DE PRÉ-RESERVA) ASSINADO - /, "$1 - ").replace(/^ASSINADO - /, "").replace(/\s*-\s*ASSINADO$/i, "").trim();
    return (n || "documento") + " - ASSINADO.pdf";
  }
  var ROTULO_DOC = { contrato: "Contrato", termo: "Termo de confissão de dívida", memorial: "Memorial descritivo", projeto: "Projeto aprovado" };
  function assinado(c) { return !!(c && c.estado && situacaoDe(c.estado) === "ASSINADO"); }
  function precisaCarregarAssinados(c) { return assinado(c) && !Array.isArray(c.assinados) && c.ocupado !== "assinados"; }
  /* 01/11 (sandbox): a Clicksign fecha o envelope ~1 minuto antes de gerar o arquivo assinado */
  var AGUARDANDO_ARQUIVO = "Assinado por todos — o arquivo assinado fica pronto em instantes, clique em Atualizar situação.";
  function montarDocumentosAssinados(c) {
    var x = pre(c), e = c.estado, h = '<div class="grp">Documentos assinados</div>';
    h += '<div class="dz-linha"><span class="dz-rot">Situação: ' + esc(SITUACAO.ASSINADO) + "</span></div>";
    if (e && e.aguardandoArquivo && c.msg !== AGUARDANDO_ARQUIVO) h += '<div class="dz-linha">' + esc(AGUARDANDO_ARQUIVO) + "</div>";
    if (c.ocupado === "atualizar") h += '<div class="dz-linha"><b>consultando…</b></div>';
    if (c.ocupado === "baixar") h += '<div class="dz-linha"><b>abrindo o documento assinado…</b></div>';
    if (!Array.isArray(c.assinados)) h += '<div class="vazio">carregando os documentos assinados…</div>';
    else if (!c.assinados.length && !c.msg) h += '<div class="vazio">Nenhum documento no envelope.</div>';
    else if (c.assinados.length) h += '<ul class="ass-lista ass-docs">' + c.assinados.map(function (d) {
      var rot = ehTermo(c) && d.tipo === "contrato" ? "Termo de pré-reserva" : (ROTULO_DOC[d.tipo] || "Documento");
      var dis = c.ocupado ? " disabled" : "";
      return '<li><span><b>' + esc(rot) + '</b> <span class="ass-data">' + esc(d.nome) + "</span></span> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="' + x + 'doc-ver" data-doc="' + esc(d.id) + '"' + dis + ">Ver</button> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="' + x + 'doc-baixar" data-doc="' + esc(d.id) + '"' + dis + ">Baixar</button></li>";
    }).join("") + "</ul>";
    var sigs = (e && e.signatarios) || [];
    if (sigs.length) h += '<details class="dz-linha"><summary class="ass-data">Quem assinou (' + sigs.length + ")</summary><ul class=\"ass-lista\">" +
      sigs.map(function (s) {
        var d = dataCurta(s.data);
        return "<li><span>" + (s.nome ? "<b>" + esc(s.nome) + "</b> (" + esc(s.papel) + ")" : esc(s.papel)) + "</span>" +
          (d ? ' <span class="ass-data">em ' + esc(d) + "</span>" : "") + "</li>";
      }).join("") + "</ul></details>";
    h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="' + x + 'atualizar"' + (podeAtualizar(c) ? "" : " disabled") + ">Atualizar situação</button></div>";
    if (c.msg) h += '<div class="dz-msg">' + esc(c.msg) + "</div>";
    return h;
  }
  /* lista do envelope (ação documentosAssinados) → contexto novo com c.assinados (lista vazia + msg se falhar) */
  async function carregarAssinados(c, deps) {
    var r;
    try { r = await deps.chamar(comDoc(c, { action: "documentosAssinados", pageId: deps.pageId })); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok) return copia(c, { ocupado: null, assinados: [], msg: mensagemAssinatura(r) });
    return copia(c, { ocupado: null, assinados: Array.isArray(r.documentos) ? r.documentos : [] });
  }
  /* PDF assinado de um documento (ação verDocumentoAssinado): { ctx, arquivo: { nome, base64 } | null } */
  async function baixarAssinado(c, docId, deps) {
    var r;
    try { r = await deps.chamar({ action: "verDocumentoAssinado", pageId: deps.pageId, docId: String(docId || "") }); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok || typeof r.base64 !== "string" || !r.base64)
      return { ctx: copia(c, { ocupado: null, msg: mensagemAssinatura(r.ok ? { erro: "DOWNLOAD_ASSINADO_FALHOU" } : r) }), arquivo: null };
    return { ctx: copia(c, { ocupado: null, msg: "" }), arquivo: { nome: nomeArquivoAssinado(r.nome), base64: r.base64 } };
  }

  function ehTermo(c) { return !!(c && c.doc === "PRE_RESERVA"); }
  function pre(c) { return ehTermo(c) ? "p-" : "a-"; }
  function montarBlocoAssinatura(c) {
    var termo = ehTermo(c), x = pre(c);
    var h = '<div class="grp">' + (termo ? "Enviar termo de pré-reserva via Clicksign" : "Enviar contrato via Clicksign") + "</div>";
    if (c.testes) h += '<div class="dz-aviso">Perfil TESTES não envia, não reenvia, não cancela nem atualiza a assinatura.</div>';
    if (!c.estado) return h + '<div class="vazio">' + esc(c.msg || "carregando…") + "</div>";
    if (assinado(c)) return montarDocumentosAssinados(c);   /* 01/11 (plano 23 A): só visualizar */
    var e = c.estado, sit = situacaoDe(e);
    if (c.ocupado === "enviar") h += '<div class="dz-linha"><b>enviando… (até 1 minuto)</b></div>';
    if (c.ocupado === "atualizar") h += '<div class="dz-linha"><b>consultando…</b></div>';
    if (c.ocupado === "reenviar") h += '<div class="dz-linha"><b>reenviando…</b></div>';
    if (c.ocupado === "cancelar") h += '<div class="dz-linha"><b>cancelando o envelope na Clicksign…</b></div>';
    if (c.ocupado === "ver") h += '<div class="dz-linha"><b>abrindo o ' + (termo ? "termo" : "contrato") + ' assinado…</b></div>';
    if (!c.contratoGerado) h += '<div class="dz-aviso">Gere o ' + (termo ? "termo" : "contrato") + ' antes de enviar para assinatura.</div>';
    if (e.envelope) {
      h += '<div class="dz-linha"><span class="dz-rot">Situação: ' + esc(SITUACAO[sit] || sit || "sem situação gravada") + "</span></div>";
      /* 30/10 (dono): envelope cancelado ou vencido não mostra mais quem está "pendente" — ninguém vai assinar */
      var sigs = (sit === "CANCELADO" || sit === "EXPIRADO") ? [] : (e.signatarios || []);
      if (sigs.length) {
        h += '<ul class="ass-lista">' + sigs.map(function (s) {
          var st = sitSignatario(s), rot = ROTULO_SIG[st] || ROTULO_SIG.pendente, d = dataCurta(s.data);
          /* 31/10 (dono): o nome vem primeiro e o papel entre parênteses — "Julio Cesar (Representante) - e-mail" */
          return "<li><span>" + (s.nome ? "<b>" + esc(s.nome) + "</b> (" + esc(s.papel) + ")" : esc(s.papel)) + "</span>" +
            (s.email ? ' <span class="ass-data">- ' + esc(s.email) + "</span>" : "") + " " +
            '<b class="' + rot[0] + '">' + rot[1] + "</b>" + (d && st !== "pendente" ? ' <span class="ass-data">em ' + esc(d) + "</span>" : "") + "</li>";
        }).join("") + "</ul>";
      }
    }
    if (c.faltas && c.faltas.length) {
      h += '<div class="dz-aviso">Para enviar, falta:</div><ul>' +
        c.faltas.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>";
      /* 27/10: atalho para corrigir o e-mail numa aba nova, na tela do portal; sem tela, só o aviso */
      if (c.corrigir && c.corrigir.length)
        h += '<div class="dz-linha">' + c.corrigir.map(function (l) {
          if (/^vendas\.html\?[\w=&%.-]+$/.test(l.url || ""))
            return '<a class="bt ghost bt-mini" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + esc(l.rotulo) + " &#8599;</a>";
          return '<span class="ass-data">' + esc(l.rotulo) + ": no cadastro de vendedores/corretores (ainda sem tela no portal)</span>";
        }).join(" ") + ' <span class="ass-data">corrija na aba que abrir e clique em Enviar de novo</span></div>';
    }
    var rotulo = e.envelope && REENVIAVEL.indexOf(sit) >= 0 ? "Enviar de novo para assinatura" : "Enviar para assinatura";
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="' + x + 'enviar"' + (podeEnviar(c) ? "" : " disabled") + ">" + rotulo + "</button>";
    if (e.envelope) h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'atualizar"' + (podeAtualizar(c) ? "" : " disabled") + ">Atualizar situação</button>";
    if (e.envelope && situacaoDe(e) === "ENVIADO" && pendentes(e))
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'reenviar"' + (podeReenviar(c) ? "" : " disabled") + ">Reenviar link de assinatura</button>";
    if (e.envelope && situacaoDe(e) === "ENVIADO")
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'cancelar"' + (podeCancelar(c) ? "" : " disabled") + ">Cancelar envelope</button>";
    if (e.envelope && situacaoDe(e) === "RASCUNHO" && !c.testes)
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'descartar"' + (podeDescartar(c) ? "" : " disabled") + ">Descartar rascunho</button>";
    /* só leitura: o perfil TESTES também vê */
    if (podeVerAssinado(c)) h += ' <button type="button" class="bt bt-mini" data-acao="' + x + 'ver-assinado"' + (c.ocupado ? " disabled" : "") + ">Ver " + (termo ? "termo" : "contrato") + " assinado</button>";
    h += "</div>";
    if (c.msg) h += '<div class="dz-msg">' + esc(c.msg) + "</div>";
    return h;
  }

  function comDoc(c, payload) { if (ehTermo(c)) payload.doc = "PRE_RESERVA"; return payload; }
  function copia(c, mud) {
    var n = {};
    for (var k in c) n[k] = c[k];
    for (var m in mud) n[m] = mud[m];
    return n;
  }

  /* 30/10: antes de enviar o CONTRATO, a tela lê o PDF gerado (ação assinaturaPdf) e acha onde o comprador
   * rubrica (RubricasVenda + pdf.js). Devolve { ok, rubricas? } ou { ok: false, erro }. Sem PDF na resposta
   * (casa de rua, rubricas desligadas, erro, servidor antigo) volta { ok: true } sem nada: o envio segue e quem
   * decide é o servidor, que exige as rubricas no contrato do condomínio. Só barra aqui o que só a tela sabe:
   * leitor de PDF que não abriu ou PDF sem os campos. deps.rubricas: troca o leitor (testes). */
  async function prepararRubricas(deps) {
    var r;
    try { r = await deps.chamar({ action: "assinaturaPdf", pageId: deps.pageId }); }
    catch (err) { r = null; }
    if (!r || !r.ok || r.semRubricas || typeof r.base64 !== "string" || !r.base64) return { ok: true };
    var R = deps.rubricas || (typeof window !== "undefined" ? window.RubricasVenda : null), ach, pags;
    if (!R) return { ok: false, erro: "RUBRICAS_SEM_LEITOR" };
    try { pags = await R.paginasDoPdf(r.base64); ach = R.acharNoContrato(pags, r.ajuste); }
    catch (err) { return { ok: false, erro: "RUBRICAS_SEM_LEITOR" }; }
    if (!ach.campos.length) return { ok: false, erro: "RUBRICAS_NAO_ACHADAS" };
    /* 01/11 (plano 23 B): linhas de assinatura do contrato e dos termos (o servidor casa cada uma com a pessoa) */
    var rubricas = { nome: r.nome, campos: ach.campos, valores: ach.valores };
    /* correção 1 (C-1): só com as linhas ligadas no servidor (ASSINATURA_LINHAS=1 → assinaturaPdf diz linhas: true) */
    if (r.linhas !== true || typeof R.acharLinhas !== "function") return { ok: true, rubricas: rubricas };
    var linhas = [], termos = [];
    try {
      linhas = R.acharLinhas(pags, r.ajuste);
      var ts = Array.isArray(r.termos) ? r.termos : [];
      for (var i = 0; i < ts.length; i++)
        if (ts[i] && ts[i].nome && ts[i].base64) termos.push({ nome: ts[i].nome, linhas: R.acharLinhas(await R.paginasDoPdf(ts[i].base64), r.ajuste) });
    } catch (err) { return { ok: false, erro: "RUBRICAS_SEM_LEITOR" }; }
    rubricas.linhas = linhas; rubricas.termos = termos;
    return { ok: true, rubricas: rubricas };
  }

  /* Executa um clique. deps: { pageId, confirmar(texto) -> bool, chamar(payload) -> Promise<resposta>,
   * pintar(ctx) opcional — chamado com o bloco ocupado antes de ir ao servidor }.
   * Devolve o contexto novo (não muda o recebido). */
  async function executarAcaoAssinatura(acao, c, deps) {
    acao = String(acao || "").replace(/^p-/, "a-");   /* termo: mesmos cliques com prefixo p- */
    if (acao === "a-reenviar") return reenviarLink(c, deps);
    if (acao === "a-cancelar") return cancelarEnvelope(c, deps);
    if (acao === "a-descartar") return descartarRascunho(c, deps);
    var enviar = acao === "a-enviar";
    if (enviar ? !podeEnviar(c) : (acao !== "a-atualizar" || !podeAtualizar(c))) return c;
    if (enviar && !deps.confirmar("Enviar o " + (ehTermo(c) ? "termo de pré-reserva" : "contrato") + " para assinatura? Cada signatário recebe um e-mail da Clicksign para assinar.")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: enviar ? "enviar" : "atualizar", msg: "", faltas: null, corrigir: null }));
    var r, pedido = comDoc(c, { action: enviar ? "assinaturaEnviar" : "assinaturaEstado", pageId: deps.pageId });
    if (enviar && !ehTermo(c)) {
      var rb = await prepararRubricas(deps);
      if (!rb.ok) return copia(c, { ocupado: null, faltas: null, corrigir: null, msg: mensagemAssinatura(rb) });
      if (rb.rubricas) pedido.rubricas = rb.rubricas;
    }
    try {
      r = await deps.chamar(pedido);
    } catch (err) {
      r = { ok: false, erro: "SEM_RESPOSTA" };
    }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (enviar && r.erro === "SEM_RESPOSTA") r = { ok: false, erro: "SEM_RESPOSTA_ENVIO" };
    if (!r.ok) {
      var falhou = { ocupado: null, faltas: r.faltas || null, msg: mensagemAssinatura(r),
                     corrigir: (r.corrigir || []).map(function (x) {
                       return { rotulo: x.rotulo, url: typeof deps.linkCorrigir === "function" ? deps.linkCorrigir(x.quem) || "" : "" };
                     }) };
      /* o envio deixou envelope na Clicksign (rascunho não apagado, ou ativo sem anotar), ou outra aba já
       * tinha enviado: o bloco passa a mostrar envelope — Enviar trava e Atualizar situação aparece */
      if (enviar && r.erro === "ENVELOPE_ABERTO")
        falhou.estado = { situacao: r.situacao || "", envelope: true, signatarios: [] };
      else if (enviar && r.envelopeId && r.rascunhoApagado !== true)
        falhou.estado = { situacao: r.erro === "GRAVACAO_FALHOU" ? "" : "RASCUNHO", envelope: true, signatarios: [] };
      return copia(c, falhou);
    }
    var estado = { situacao: r.situacao || "", envelope: enviar ? true : !!r.envelope, signatarios: r.signatarios || [], temAssinado: !!r.temAssinado };
    if (r.aguardandoArquivo) estado.aguardandoArquivo = true;
    var msg = r.aguardandoArquivo ? AGUARDANDO_ARQUIVO
      : (mensagemAssinatura(r) || (enviar ? "Enviado — cada signatário recebe o e-mail da Clicksign." : "Situação atualizada."));
    return copia(c, { estado: estado, ocupado: null, faltas: null, corrigir: null, msg: msg });
  }

  /* Reenvia o e-mail da Clicksign a quem ainda não assinou (ação assinaturaReenviar). */
  async function reenviarLink(c, deps) {
    if (!podeReenviar(c)) return c;
    var n = pendentes(c.estado);
    if (!deps.confirmar("Reenviar o link de assinatura? " + (n === 1 ? "A pessoa que ainda não assinou recebe" : "As " + n + " pessoas que ainda não assinaram recebem") +
                        " de novo o e-mail da Clicksign.")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "reenviar", msg: "" }));
    var r;
    try { r = await deps.chamar(comDoc(c, { action: "assinaturaReenviar", pageId: deps.pageId })); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    var estado = c.estado;
    if (r.signatarios) estado = copia(c.estado, { signatarios: r.signatarios });
    if (!r.ok) return copia(c, { estado: estado, ocupado: null, msg: mensagemAssinatura(r) });
    var p = Number(r.pendentes) || 0;
    return copia(c, { estado: estado, ocupado: null,
                      msg: "Link reenviado — " + (p === 1 ? "1 pessoa que ainda não assinou recebe" : p + " pessoas que ainda não assinaram recebem") + " o e-mail de novo." });
  }

  /* 29/10: cancela o envelope na Clicksign (ação assinaturaCancelar) e mostra a situação nova (CANCELADO). */
  async function cancelarEnvelope(c, deps) {
    if (!podeCancelar(c)) return c;
    var oque = ehTermo(c) ? "termo de pré-reserva" : "contrato";
    if (!deps.confirmar("Cancelar o envelope do " + oque + " na Clicksign? Ninguém mais consegue assinar este envelope " +
                        "e as assinaturas já feitas nele deixam de valer. Depois dá para enviar de novo.")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "cancelar", msg: "" }));
    var r;
    try { r = await deps.chamar(comDoc(c, { action: "assinaturaCancelar", pageId: deps.pageId })); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok) return copia(c, { ocupado: null, msg: mensagemAssinatura(r) });
    var estado = { situacao: r.situacao || "CANCELADO", envelope: true, signatarios: r.signatarios || [], temAssinado: !!r.temAssinado };
    return copia(c, { estado: estado, ocupado: null, faltas: null, corrigir: null,
                      msg: "Envelope cancelado na Clicksign — ninguém mais recebe pedido de assinatura dele." });
  }

  /* Descartar rascunho: a mesma ação assinaturaCancelar; com envelope draft o servidor apaga e limpa as colunas.
   * Se a Clicksign não respondeu, nada foi apagado: pede para tentar de novo. */
  async function descartarRascunho(c, deps) {
    if (!podeDescartar(c)) return c;
    if (!deps.confirmar("Descartar o rascunho do " + (ehTermo(c) ? "termo de pré-reserva" : "contrato") + " na Clicksign? Nada foi enviado aos signatários; depois é só enviar de novo.")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "cancelar", msg: "" }));
    var r;
    try { r = await deps.chamar(comDoc(c, { action: "assinaturaCancelar", pageId: deps.pageId, descartar: true })); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok) {
      var semResposta = r.erro === "CLICKSIGN_FALHOU" && (!r.http || r.http >= 500);
      return copia(c, { ocupado: null, msg: semResposta ? "A Clicksign não respondeu. Tente de novo em 1 minuto." : mensagemAssinatura(r) });
    }
    if (r.descartou)
      return copia(c, { estado: { situacao: "", envelope: false, signatarios: [], temAssinado: false }, ocupado: null, faltas: null, corrigir: null,
                        msg: "Rascunho descartado — agora é só enviar de novo." });
    /* o servidor não descartou: o envelope já não era rascunho; ele só atualizou a situação e explica no aviso */
    return copia(c, { estado: { situacao: r.situacao || "", envelope: !!r.envelope, signatarios: r.signatarios || [], temAssinado: !!r.temAssinado },
                      ocupado: null, faltas: null, corrigir: null,
                      msg: [r.avisoTexto, mensagemAssinatura(r)].filter(Boolean).join(" ") || "Situação atualizada." });
  }

  var exportar = { montarBlocoAssinatura: montarBlocoAssinatura, mensagemAssinatura: mensagemAssinatura,
                   executarAcaoAssinatura: executarAcaoAssinatura, prepararRubricas: prepararRubricas, podeEnviar: podeEnviar, podeReenviar: podeReenviar, podeCancelar: podeCancelar, podeDescartar: podeDescartar,
                   podeVerAssinado: podeVerAssinado, nomeArquivoAssinado: nomeArquivoAssinado, precisaCarregarAssinados: precisaCarregarAssinados,
                   carregarAssinados: carregarAssinados, baixarAssinado: baixarAssinado, assinado: assinado };
  if (typeof module !== "undefined" && module.exports) { module.exports = exportar; return; }
  window.VendaAssinatura = exportar; /* o coordenador liga no painel (venda-dossie.js / vendas.html) */
})();
