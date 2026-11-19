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
    TERMO_DESATUALIZADO: "Os dados mudaram depois de gerar o termo de reserva — gere o termo de novo e depois envie.",
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
    PRAZO_INVALIDO: "A data limite para assinar tem de ficar entre amanhã e 89 dias à frente.",
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
    TERMO_ASSINADO: "O termo de reserva já foi assinado por todos — nada mais muda nele. Recarregue a página.",
    /* 03/11: Trocar e-mail (sem cancelar o envelope) */
    EMAIL_INVALIDO: "Esse e-mail não parece válido — confira e tente de novo.",
    EMAIL_IGUAL: "Esse já é o e-mail desta pessoa na Clicksign.",
    EMAIL_REPETIDO: "Esse e-mail já é de outra pessoa do envelope — cada pessoa precisa de um e-mail.",
    SIGNATARIO_NAO_ACHADO: "Essa pessoa não está mais no envelope — clique em Atualizar situação.",
    SIGNATARIO_JA_ASSINOU: "Essa pessoa já assinou — o e-mail dela não muda mais.",
    TROCA_SEM_REQUISITOS: "Este envelope não tem guardado o que a troca precisa (foi enviado antes desta versão) — para corrigir, cancele o envelope e envie de novo.",
    TROCA_INCOMPLETA: "A troca parou no meio e não deu para desfazer: a Clicksign ficou com o e-mail antigo e o novo. Cancele o envelope e envie de novo.",
    /* 18/11/2026: troca de fiadores (termos num envelope próprio) */
    TROCA_SEM_ENVELOPE: "A troca de fiadores é para contrato já enviado para assinatura. Antes do envio, corrija os fiadores e gere o contrato de novo.",
    TROCA_DESATUALIZADA: "Os dados mudaram depois da prévia ou dos termos gerados — clique em Atualizar prévia e gere os termos de novo.",
    TROCA_SEM_TERMOS_GERADOS: "Gere os termos novos antes de enviar.",
    TROCA_RASCUNHO_PENDENTE: "O envio anterior dos termos parou em rascunho na Clicksign — descarte o rascunho dos termos e tente de novo.",
    SEM_TERMOS: "Esta venda não tem termos de confissão (só existem com parcelas depois das chaves).",
    SO_CONDOMINIO: "A troca de fiadores é só para vendas do condomínio.",
    COTA_GOOGLE_ESGOTADA: "A cota diária do Google acabou — nada mais foi feito. Tente de novo amanhã (o que já foi feito fica guardado).",
    COLUNA_NAO_PERMITIDA: "No modo Trocar fiadores só os campos dos fiadores podem mudar.",
    FIADOR_SEM_DOCUMENTO: "Anexe o documento do fiador novo antes de gerar os termos.",
    CONFERENCIA_FALTANDO: "Faça a conferência dos documentos (IA) depois de anexar o documento do fiador.",
    CONFERENCIA_DESATUALIZADA: "A conferência dos documentos é de antes da troca — confira de novo.",
    CONFERENCIA_DIVERGENTE: "A conferência achou divergência no nome ou no CPF do fiador novo — corrija antes de gerar os termos.",
    CONFERENCIA_PENDENTE: "A conferência do fiador novo tem item ilegível ou faltando — confira antes de gerar os termos.",
    NADA_MUDOU: "Nenhum fiador mudou — corrija o fiador no bloco Fiadores e salve."
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
    if (c.desatualizado && !ehTermo(c)) return false;   /* 03/11: fluxo/condições depois do contrato — gerar de novo antes */
    return !e.envelope || REENVIAVEL.indexOf(situacaoDe(e)) >= 0;
  }
  /* 03/11/2026 (dono): envelope do contrato ABERTO — rascunho, enviado ou aguardando (situação vazia). A aba Contrato fica
   * só leitura (venda-dossie.js htmlContratoLeitura); cancelado/recusado/expirado destrava; assinado tem a tela própria. */
  function envelopeAberto(c) {
    var e = c && c.estado, s = situacaoDe(e);
    return !!(e && e.envelope && REENVIAVEL.indexOf(s) < 0 && s !== "ASSINADO");
  }
  /* 03/11/2026 (dono): contrato gerado direto (PDF ou envelope do contrato) e termo nunca enviado = pré-reserva dispensada.
   * Termo ENVIADO ou ASSINADO continua valendo. Termo ainda carregando (estado null): não decide. Mesma regra do servidor
   * (PreReservaVenda.dispensada). */
  function preReservaDispensada(cA, cP) {
    if (!cA || !cP || !cP.estado) return false;
    var temContrato = !!cA.contratoGerado || !!(cA.estado && cA.estado.envelope), s = situacaoDe(cP.estado);
    return temContrato && s !== "ENVIADO" && s !== "ASSINADO";
  }
  var MSG_DESATUALIZADO = "O fluxo ou as condições especiais mudaram depois do contrato. Gere o contrato de novo antes de enviar.";
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
  /* 03/11/2026 (dono): data limite para assinar — padrão 30 dias (o que a Clicksign já fazia), de amanhã até 89 dias
   * (mesma faixa do servidor, ClicksignVenda.prazoAssinatura). Datas "AAAA-MM-DD" no dia local do navegador. */
  function isoDia(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function maisDias(agora, n) { var d = new Date(agora.getTime()); d.setDate(d.getDate() + n); return isoDia(d); }
  function limitesPrazo(agora) { return { min: maisDias(agora, 1), padrao: maisDias(agora, 30), max: maisDias(agora, 89) }; }
  function dataBr(iso) { return dataCurta(iso); }
  var ROTULO_SIG = { assinou: ["ass-ok", "✓ assinou"], recusou: ["ass-rec", "✗ recusou"], pendente: ["ass-pend", "⏳ pendente"] };

  function mensagemAssinatura(r) {
    r = r || {};
    var e = String(r.erro || "");
    /* 03/11: a trava do servidor já manda o texto (envelope aberto; contrato desatualizado pelo fluxo/condições) */
    if ((e === "CONTRATO_DESATUALIZADO" || e === "ENVELOPE_ABERTO") && typeof r.mensagem === "string" && r.mensagem) return r.mensagem;
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
    n = n.replace(/^(CONTRATO|TERMO DE (?:PRÉ-)?RESERVA) ASSINADO - /, "$1 - ").replace(/^ASSINADO - /, "").replace(/\s*-\s*ASSINADO$/i, "").trim();
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
      var rot = ehTermo(c) && d.tipo === "contrato" ? "Termo de reserva" : (ROTULO_DOC[d.tipo] || "Documento");
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
  async function baixarAssinado(c, docId, deps, envelope) {
    var r, ped = comDoc(c, { action: "verDocumentoAssinado", pageId: deps.pageId, docId: String(docId || "") });
    if (envelope) ped.envelope = String(envelope);   /* 18/11: "Já assinado" — documento fechado num envelope ainda aberto */
    try { r = await deps.chamar(ped);   /* 07/11: sem o doc do termo o servidor conferia o contrato e dava NAO_ASSINADO */ }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok || typeof r.base64 !== "string" || !r.base64)
      return { ctx: copia(c, { ocupado: null, msg: mensagemAssinatura(r.ok ? { erro: "DOWNLOAD_ASSINADO_FALHOU" } : r) }), arquivo: null };
    return { ctx: copia(c, { ocupado: null, msg: "" }), arquivo: { nome: nomeArquivoAssinado(r.nome), base64: r.base64 } };
  }

  /* ---- 18/11/2026 (dono): troca de fiadores e termos de confissão em envelope próprio ----
   * "A venda só conta como ASSINADA quando contrato e termos estiverem assinados por todos"; "o que já foi assinado por
   * todos fica travado e visível: quem assinou, quando, e botão para ver o PDF assinado". O "Já assinado" vem do servidor
   * (estado.jaAssinado / c.jaAssinado, Propriedade ASS_HIST — sem chamar a Clicksign). */
  var CONTRATO_ASSINADO_TERMOS = "Contrato assinado — termos de confissão em assinatura";
  function jaAssinadoDe(c) {
    var l = (c && c.estado && c.estado.jaAssinado) || (c && c.jaAssinado) || [];
    return Array.isArray(l) ? l : [];
  }
  function htmlJaAssinado(c) {
    var l = jaAssinadoDe(c), x = pre(c);
    if (!l.length) return "";
    /* coordenação 18/11: por documento, uma pessoa por linha ("✓ Nome (papel) — dd/mm/aaaa hh:mm") e o botão embaixo */
    return '<div class="dz-linha"><b>Já assinado</b> <span class="ass-data">(travado — nada mais muda nestes documentos)</span></div>' +
      l.map(function (d) {
        var pessoas = (d.assinaram || []).map(function (s) {
          var dt = dataCurta(s.data);
          return '<li><b class="ass-ok">✓</b> ' + esc(s.nome ? s.nome + " (" + s.papel + ")" : s.papel) + (dt ? ' <span class="ass-data">— ' + esc(dt) + "</span>" : "") + "</li>";
        }).join("");
        return '<div class="ass-ja"><div class="dz-linha"><b>' + esc(ROTULO_DOC[d.tipo] || "Documento") + "</b></div>" +
          (pessoas ? '<ul class="ass-lista ass-ja-pessoas">' + pessoas + "</ul>" : "") +
          '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="' + x + 'doc-ver" data-doc="' + esc(d.docId) + '" data-env="' + esc(d.envelope) + '"' +
          (c.ocupado ? " disabled" : "") + ">Ver PDF assinado</button></div></div>";
      }).join("");
  }
  /* envelope próprio dos termos (depois de uma troca): situação, quem falta e os botões do envelope certo (doc TERMOS) */
  function termosDe(c) { return (c && c.estado && c.estado.termos) || null; }
  function htmlTermosEnvelope(c) {
    var t = termosDe(c);
    if (!t || !t.envelope) return "";
    var sit = situacaoDe(t), ocup = !!c.ocupado || !!c.testes;
    var h = '<div class="dz-linha"><b>Termos de confissão</b> <span class="ass-data">(envelope próprio)</span> — ' + esc(SITUACAO[sit] || sit || "sem situação gravada") + "</div>";
    var sigs = (sit === "CANCELADO" || sit === "EXPIRADO") ? [] : (t.signatarios || []);
    if (sigs.length) h += '<ul class="ass-lista">' + sigs.map(function (s) {
      var st = sitSignatario(s), rot = ROTULO_SIG[st] || ROTULO_SIG.pendente, d = dataCurta(s.data);
      return "<li><span>" + (s.nome ? "<b>" + esc(s.nome) + "</b> (" + esc(s.papel) + ")" : esc(s.papel)) + "</span>" +
        (s.email ? ' <span class="ass-data">- ' + esc(s.email) + "</span>" : "") + " " + '<b class="' + rot[0] + '">' + rot[1] + "</b>" +
        (d && st !== "pendente" ? ' <span class="ass-data">em ' + esc(d) + "</span>" : "") +
        (st === "pendente" && s.id && sit === "ENVIADO" && !c.testes
          ? ' <button type="button" class="bt ghost bt-mini" data-acao="a-t-trocar-email" data-sig="' + esc(s.id) + '"' + (c.ocupado ? " disabled" : "") + ">Trocar e-mail</button>" : "") + "</li>";
    }).join("") + "</ul>";
    var pend = sigs.filter(function (s) { return sitSignatario(s) === "pendente"; }).length;
    if (sit === "ENVIADO") {
      h += '<div class="dz-linha">';
      if (pend) h += '<button type="button" class="bt ghost bt-mini" data-acao="a-t-reenviar"' + (ocup ? " disabled" : "") + ">Reenviar link dos termos</button> ";
      h += '<button type="button" class="bt ghost bt-mini" data-acao="a-t-cancelar"' + (ocup ? " disabled" : "") + ">Cancelar envelope dos termos</button></div>";
    }
    if (sit === "RASCUNHO" && !c.testes)
      h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="a-t-descartar"' + (ocup ? " disabled" : "") + ">Descartar rascunho dos termos</button></div>";
    return h;
  }
  /* Trocar fiadores: quem já pode enviar o contrato (o TESTES não), com o contrato enviado e não assinado por todos */
  function podeTrocarFiadores(c) {
    return !!(c && c.podeTrocarFiadores && c.estado && c.estado.envelope && situacaoDe(c.estado) === "ENVIADO" && !c.ocupado && !c.testes);
  }
  function htmlTroca(c) {
    var t = c.troca, pv = t.previa || {}, ocup = !!c.ocupado;
    var h = '<div class="dz-fia-bloco ass-troca"><div class="dz-linha dz-grupo"><b>Trocar fiadores</b></div>';
    if (c.ocupado === "troca") h += '<div class="dz-linha"><b>' + esc(t.passo || "consultando…") + "</b></div>";
    h += '<div class="dz-linha dz-nota">1) Corrija o fiador abaixo e salve. 2) Anexe o documento dele (DOC. FIADOR) e rode a Conferência dos documentos. ' +
      "3) Gere os termos novos e confira. 4) Envie: os termos antigos em andamento são cancelados e os novos vão num envelope próprio (o contrato não muda).</div>";
    h += '<div class="ass-troca-fia"></div>';
    if (pv.problemas && pv.problemas.length) h += '<div class="dz-aviso">Antes de gerar os termos novos:</div><ul>' + pv.problemas.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
    /* 18/11 (dono): "o contrato já gerado manda" — as travas de data contra hoje/assinatura não valem ao refazer os termos */
    var ign = Number(pv.datasIgnoradas || pv.sinalIgnorado) || 0;
    if (ign) h += '<div class="dz-linha dz-nota">Travas de data ignoradas (o contrato já gerado manda): ' + ign + (ign === 1 ? " aviso" : " avisos") + ".</div>";
    if (pv.cancelar) h += '<div class="dz-linha"><span class="dz-rot">Será cancelado (envelope ' + (pv.envelopeAntigo === "termos" ? "dos termos" : "do contrato") + "): " +
      (pv.cancelar.length ? esc(pv.cancelar.map(function (x) { return x.nome; }).join("; ")) : "nenhum termo em andamento") + "</span></div>";
    if (pv.assinam && pv.assinam.length) h += '<div class="dz-linha"><span class="dz-rot">Recebem os termos novos: ' +
      esc(pv.assinam.map(function (s) { return s.nome ? s.nome + " (" + s.papel + ")" : s.papel; }).join("; ")) + "</span></div>";
    h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="a-troca-previa"' + (ocup ? " disabled" : "") + ">Atualizar prévia</button> " +
      '<button type="button" class="bt bt-mini" data-acao="a-troca-gerar"' + (ocup || !pv.liberado ? " disabled" : "") + ">Gerar termos novos</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="a-troca-sair"' + (ocup ? " disabled" : "") + ">Sair da troca</button></div>";
    if (t.termos && t.termos.length) {
      var lim = limitesPrazo(c.agora || new Date()), valor = c.prazo && c.prazo >= lim.min && c.prazo <= lim.max ? c.prazo : lim.padrao;
      h += '<div class="dz-linha"><span class="dz-rot">Termos novos gerados:</span> ' + t.termos.map(function (x, i) {
        return '<button type="button" class="bt ghost bt-mini" data-acao="a-troca-ver" data-n="' + i + '"' + (ocup ? " disabled" : "") + ">Ver " + esc(x.nome) + "</button>";
      }).join(" ") + "</div>";
      h += '<div class="dz-linha"><label class="ass-data">Assinar até <input type="date" data-prazo="a-" value="' + esc(valor) + '" min="' + lim.min + '" max="' + lim.max + '"' +
        (ocup ? " disabled" : "") + "></label> " +
        '<button type="button" class="bt bt-mini" data-acao="a-troca-enviar"' + (ocup ? " disabled" : "") + ">Enviar termos novos para assinatura</button></div>";
    }
    return h + "</div>";
  }
  /* PDFs dos termos novos (base64, da ação trocarFiadoresGerar) → linhas de assinatura (RubricasVenda, como no envio normal) */
  async function lerLinhasTermos(r, deps) {
    if (r.linhas !== true || r.semRubricas) return { ok: true, rubricas: null };
    var R = deps.rubricas || (typeof window !== "undefined" ? window.RubricasVenda : null);
    if (!R || typeof R.acharLinhas !== "function") return { ok: false, erro: "RUBRICAS_SEM_LEITOR" };
    var termos = [];
    try {
      for (var i = 0; i < (r.termos || []).length; i++)
        termos.push({ nome: r.termos[i].nome, linhas: R.acharLinhas(await R.paginasDoPdf(r.termos[i].base64), r.ajuste) });
    } catch (err) { return { ok: false, erro: "RUBRICAS_SEM_LEITOR" }; }
    return { ok: true, rubricas: { termos: termos } };
  }
  function mensagemTroca(r) {
    r = r || {};
    if (r.problemas && r.problemas.length) return r.problemas.join(" ");
    if (r.mensagem) return r.mensagem;
    return mensagemAssinatura(r);
  }
  async function chamarSeguro(deps, payload) {
    var r;
    try { r = await deps.chamar(payload); } catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    return r || { ok: false, erro: "SEM_RESPOSTA" };
  }
  async function acaoTroca(acao, c, deps) {
    function ocupar(passo) { if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "troca", msg: "", troca: copia(c.troca || {}, { passo: passo }) })); }
    if (acao === "a-troca-sair") return copia(c, { troca: null, msg: "" });
    if (acao === "a-troca-abrir" || acao === "a-troca-previa") {
      if (acao === "a-troca-abrir" && !podeTrocarFiadores(c)) return c;
      if (c.testes) return c;
      c = copia(c, { troca: c.troca || {} });
      ocupar("conferindo a troca…");
      var r = await chamarSeguro(deps, { action: "trocarFiadoresPrevia", pageId: deps.pageId });
      if (!r.ok) return copia(c, { ocupado: null, troca: acao === "a-troca-abrir" ? null : c.troca, msg: mensagemTroca(r) });
      return copia(c, { ocupado: null, msg: "", troca: { previa: r, termos: null, rubricas: null } });
    }
    if (!c.troca) return c;
    if (acao === "a-troca-ver") {
      var t = (c.troca.termos || [])[Number(deps.n) || 0];
      if (t && typeof deps.abrirPdf === "function") deps.abrirPdf(t.nome, t.base64);
      return c;
    }
    if (acao === "a-troca-gerar") {
      if (!c.troca.previa || !c.troca.previa.liberado) return c;
      if (!deps.confirmar("Gerar os termos de confissão novos com os fiadores de agora? O contrato não muda; nada vai para a Clicksign ainda.")) return c;
      ocupar("gerando os termos novos… (até 1 minuto)");
      var g = await chamarSeguro(deps, { action: "trocarFiadoresGerar", pageId: deps.pageId, carimbo: c.troca.previa.carimbo });
      if (!g.ok) return copia(c, { ocupado: null, msg: mensagemTroca(g) });
      var lt = await lerLinhasTermos(g, deps);
      if (!lt.ok) return copia(c, { ocupado: null, msg: mensagemAssinatura(lt) });
      return copia(c, { ocupado: null, troca: copia(c.troca, { termos: g.termos || [], rubricas: lt.rubricas, passo: "" }),
                        msg: "Termos novos gerados — abra e confira antes de enviar." });
    }
    if (acao === "a-troca-enviar") {
      if (!c.troca.termos || !c.troca.termos.length) return c;
      var lim = limitesPrazo(c.agora || new Date());
      var prazo = (typeof deps.lerPrazo === "function" && deps.lerPrazo()) || c.prazo || lim.padrao;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo) || prazo < lim.min || prazo > lim.max)
        return copia(c, { prazo: prazo, msg: "Escolha a data limite para assinar entre " + dataBr(lim.min) + " e " + dataBr(lim.max) + "." });
      var pv = c.troca.previa || {};
      var texto = "Enviar os termos novos para assinatura até " + dataBr(prazo) + "? Será cancelado: " +
        ((pv.cancelar || []).map(function (x) { return x.nome; }).join("; ") || "nenhum termo em andamento") +
        ". Recebem os termos novos: " + (pv.assinam || []).map(function (s) { return s.nome ? s.nome + " (" + s.papel + ")" : s.papel; }).join("; ") +
        ". O contrato não muda e quem já assinou o contrato não assina de novo.";
      if (!deps.confirmar(texto)) return c;
      c = copia(c, { prazo: prazo });
      ocupar("cancelando os termos antigos e enviando os novos… (até 2 minutos)");
      var pedido = { action: "trocarFiadoresEnviar", pageId: deps.pageId, prazo: prazo };
      if (c.troca.rubricas) pedido.rubricas = c.troca.rubricas;
      var e = await chamarSeguro(deps, pedido);
      if (!e.ok) return copia(c, { ocupado: null, msg: mensagemTroca(e.erro === "SEM_RESPOSTA" ? { erro: "SEM_RESPOSTA_ENVIO" } : e) });
      var est = copia(c.estado || {}, { termos: e.termos || { envelope: true, situacao: "ENVIADO", signatarios: [] } });
      return copia(c, { ocupado: null, troca: null, estado: est, recarregar: true,
                        msg: "Termos novos enviados — cada pessoa recebe o e-mail da Clicksign." + (e.aviso === "NOTIFICACAO_FALHOU" ? " O aviso por e-mail falhou: use Reenviar link dos termos." : "") +
                             (Array.isArray(e.avisos) && e.avisos.length ? " Atenção: " + e.avisos.join("; ") + "." : "") });
    }
    return c;
  }
  /* botões do envelope de termos: as mesmas ações do contrato, com doc TERMOS e o estado do envelope dos termos */
  async function acaoTermos(acao, c, deps) {
    var t = termosDe(c);
    if (!t) return c;
    var ct = copia(c, { doc: "TERMOS", estado: t });
    var base = acao.replace(/^a-t-/, "a-"), n;
    /* o bloco ocupado mostra o contrato (não o estado dos termos) enquanto a ação roda */
    var d2 = copia(deps, { pintar: function (x) { if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: x.ocupado, msg: x.msg })); } });
    if (base === "a-reenviar") n = await reenviarLink(ct, d2);
    else if (base === "a-trocar-email") n = await trocarEmail(ct, d2);
    else if (base === "a-cancelar" || base === "a-descartar") {
      if (!deps.confirmar(base === "a-cancelar" ? "Cancelar o envelope dos termos de confissão na Clicksign? O contrato não muda; ninguém mais assina estes termos."
                                                 : "Descartar o rascunho dos termos na Clicksign? Nada foi enviado aos signatários.")) return c;
      if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "cancelar", msg: "" }));
      var r = await chamarSeguro(deps, { action: "assinaturaCancelar", pageId: deps.pageId, doc: "TERMOS", descartar: base === "a-descartar" ? true : undefined });
      if (!r.ok) return copia(c, { ocupado: null, msg: mensagemAssinatura(r) });
      return copia(c, { ocupado: null, recarregar: true, msg: base === "a-cancelar" ? "Envelope dos termos cancelado na Clicksign." : "Rascunho dos termos descartado." });
    } else return c;
    return copia(c, { estado: copia(c.estado, { termos: n.estado }), ocupado: null, msg: n.msg });
  }

  function ehTermo(c) { return !!(c && c.doc === "PRE_RESERVA"); }
  function pre(c) { return ehTermo(c) ? "p-" : "a-"; }
  function montarBlocoAssinatura(c) {
    var termo = ehTermo(c), x = pre(c);
    var h = '<div class="grp">' + (termo ? "Enviar termo de reserva via Clicksign" : "Enviar contrato via Clicksign") + "</div>";
    if (c.testes) h += '<div class="dz-aviso">Perfil TESTES não envia, não reenvia, não cancela nem atualiza a assinatura.</div>';
    if (!c.estado) return h + '<div class="vazio">' + esc(c.msg || "carregando…") + "</div>";
    if (assinado(c)) return montarDocumentosAssinados(c);   /* 01/11 (plano 23 A): só visualizar */
    var e = c.estado, sit = situacaoDe(e);
    if (c.troca && !termo) return h + htmlTroca(c) + (c.msg ? '<div class="dz-msg">' + esc(c.msg) + "</div>" : "");   /* 18/11: modo Trocar fiadores */
    if (c.ocupado === "enviar") h += '<div class="dz-linha"><b>enviando… (até 1 minuto)</b></div>';
    if (c.ocupado === "atualizar") h += '<div class="dz-linha"><b>consultando…</b></div>';
    if (c.ocupado === "reenviar") h += '<div class="dz-linha"><b>reenviando…</b></div>';
    if (c.ocupado === "cancelar") h += '<div class="dz-linha"><b>cancelando o envelope na Clicksign…</b></div>';
    if (c.ocupado === "trocar-email") h += '<div class="dz-linha"><b>trocando o e-mail na Clicksign…</b></div>';
    if (c.ocupado === "ver") h += '<div class="dz-linha"><b>abrindo o ' + (termo ? "termo" : "contrato") + ' assinado…</b></div>';
    if (!c.contratoGerado) h += '<div class="dz-aviso">Gere o ' + (termo ? "termo" : "contrato") + ' antes de enviar para assinatura.</div>';
    else if (c.desatualizado && !termo && !envelopeAberto(c)) h += '<div class="dz-aviso">' + esc(MSG_DESATUALIZADO) + "</div>";
    if (e.envelope) {
      h += '<div class="dz-linha"><span class="dz-rot">Situação: ' + esc(e.contratoAssinado && sit === "ENVIADO" ? CONTRATO_ASSINADO_TERMOS : (SITUACAO[sit] || sit || "sem situação gravada")) + "</span></div>";
      if (!termo) h += htmlJaAssinado(c);   /* 18/11 (dono): o que já foi assinado por todos, travado e visível */
      /* 30/10 (dono): envelope cancelado ou vencido não mostra mais quem está "pendente" — ninguém vai assinar */
      var sigs = (sit === "CANCELADO" || sit === "EXPIRADO") ? [] : (e.signatarios || []);
      if (sigs.length) {
        h += '<ul class="ass-lista">' + sigs.map(function (s) {
          var st = sitSignatario(s), rot = ROTULO_SIG[st] || ROTULO_SIG.pendente, d = dataCurta(s.data);
          /* 31/10 (dono): o nome vem primeiro e o papel entre parênteses — "Julio Cesar (Representante) - e-mail" */
          return "<li><span>" + (s.nome ? "<b>" + esc(s.nome) + "</b> (" + esc(s.papel) + ")" : esc(s.papel)) + "</span>" +
            (s.email ? ' <span class="ass-data">- ' + esc(s.email) + "</span>" : "") + " " +
            '<b class="' + rot[0] + '">' + rot[1] + "</b>" + (d && st !== "pendente" ? ' <span class="ass-data">em ' + esc(d) + "</span>" : "") +
            /* 03/11 (dono): e-mail errado se corrige aqui, sem cancelar o envelope */
            (st === "pendente" && s.id && sit === "ENVIADO" && !c.testes && !e.contratoAssinado
              ? ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'trocar-email" data-sig="' + esc(s.id) + '"' + (c.ocupado ? " disabled" : "") + ">Trocar e-mail</button>" : "") + "</li>";
        }).join("") + "</ul>";
      }
      if (!termo) h += htmlTermosEnvelope(c);   /* 18/11: envelope próprio dos termos (depois de uma troca) */
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
    h += '<div class="dz-linha">';
    /* 03/11 (dono): data limite para assinar, escolhida na hora de enviar (só aparece quando dá para enviar de novo) */
    if (!e.envelope || REENVIAVEL.indexOf(sit) >= 0) {
      var lim = limitesPrazo(c.agora || new Date()), valor = c.prazo && c.prazo >= lim.min && c.prazo <= lim.max ? c.prazo : lim.padrao;
      h += '<label class="ass-data">Assinar até <input type="date" data-prazo="' + x + '" value="' + esc(valor) +
           '" min="' + lim.min + '" max="' + lim.max + '"' + (podeEnviar(c) ? "" : " disabled") + "></label> ";
    }
    h += '<button type="button" class="bt bt-mini" data-acao="' + x + 'enviar"' + (podeEnviar(c) ? "" : " disabled") + ">" + rotulo + "</button>";
    /* 03/11 (dono): botão "Prévia das assinaturas" retirado — "se tudo tiver certo por trás, eu não preciso dela"; a ação
       a-previa e o servidor (assinaturaPrevia) ficam para a prévia em imagem (venda/ferramentas/previa_assinaturas.py) */
    if (e.envelope) h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'atualizar"' + (podeAtualizar(c) ? "" : " disabled") + ">Atualizar situação</button>";
    if (e.envelope && situacaoDe(e) === "ENVIADO" && pendentes(e))
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'reenviar"' + (podeReenviar(c) ? "" : " disabled") + ">Reenviar link de assinatura</button>";
    if (e.envelope && situacaoDe(e) === "ENVIADO" && !e.contratoAssinado)
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'cancelar"' + (podeCancelar(c) ? "" : " disabled") + ">Cancelar envelope</button>";
    if (!termo && c.podeTrocarFiadores && e.envelope && sit === "ENVIADO" && !c.testes)
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="a-troca-abrir"' + (podeTrocarFiadores(c) ? "" : " disabled") + ">Trocar fiadores</button>";
    if (e.envelope && situacaoDe(e) === "RASCUNHO" && !c.testes)
      h += ' <button type="button" class="bt ghost bt-mini" data-acao="' + x + 'descartar"' + (podeDescartar(c) ? "" : " disabled") + ">Descartar rascunho</button>";
    /* só leitura: o perfil TESTES também vê */
    if (podeVerAssinado(c)) h += ' <button type="button" class="bt bt-mini" data-acao="' + x + 'ver-assinado"' + (c.ocupado ? " disabled" : "") + ">Ver " + (termo ? "termo" : "contrato") + " assinado</button>";
    h += "</div>";
    if (c.msg) h += '<div class="dz-msg">' + esc(c.msg) + "</div>";
    return h;
  }

  function comDoc(c, payload) { if (ehTermo(c)) payload.doc = "PRE_RESERVA"; else if (c && c.doc === "TERMOS") payload.doc = "TERMOS"; return payload; }
  function copia(c, mud) {
    var n = {};
    for (var k in c) n[k] = c[k];
    for (var m in mud) n[m] = mud[m];
    return n;
  }

  /* 30/10: antes de enviar o CONTRATO, a tela lê o PDF gerado (ação assinaturaPdf) e acha onde o comprador
   * rubrica (RubricasVenda + pdf.js). Devolve { ok, rubricas? } ou { ok: false, erro }. Sem PDF na resposta
   * (rubricas desligadas, erro, servidor antigo) volta { ok: true } sem nada: o envio segue e quem
   * decide é o servidor, que exige as rubricas no contrato do condomínio. Só barra aqui o que só a tela sabe:
   * leitor de PDF que não abriu ou PDF sem os campos (05/11: na casa de rua — r.rua — PDF sem campo não barra).
   * deps.rubricas: troca o leitor (testes). */
  async function prepararRubricas(deps) {
    var r;
    try { r = await deps.chamar({ action: "assinaturaPdf", pageId: deps.pageId }); }
    catch (err) { r = null; }
    if (!r || !r.ok || r.semRubricas || typeof r.base64 !== "string" || !r.base64) return { ok: true };
    var R = deps.rubricas || (typeof window !== "undefined" ? window.RubricasVenda : null), ach, pags;
    if (!R) return { ok: false, erro: "RUBRICAS_SEM_LEITOR" };
    try { pags = await R.paginasDoPdf(r.base64); ach = R.acharNoContrato(pags, r.ajuste); }
    catch (err) { return { ok: false, erro: "RUBRICAS_SEM_LEITOR" }; }
    /* 05/11/2026 (casa de rua, r.rua): sem campo de ciência não barra — vai a leitura com o aviso e o servidor aceita */
    if (!ach.campos.length && r.rua !== true) return { ok: false, erro: "RUBRICAS_NAO_ACHADAS" };
    var pdfs = [{ doc: "contrato", base64: r.base64 }];   /* 01/11 (dono): a prévia desenha as marcas nestes PDFs */
    /* 01/11 (plano 23 B): linhas de assinatura do contrato e dos termos (o servidor casa cada uma com a pessoa) */
    var rubricas = { nome: r.nome, campos: ach.campos, valores: ach.valores };
    /* unidade 22 (01/11): o aviso do leitor (ex.: "item 4.2.1 do quadro-resumo não achado" = sem visto nos valores) vai junto */
    if (Array.isArray(ach.avisos) && ach.avisos.length) rubricas.avisos = ach.avisos.slice(0, 5);
    /* correção 1 (C-1): só com as linhas ligadas no servidor (ASSINATURA_LINHAS=1 → assinaturaPdf diz linhas: true) */
    if (r.linhas !== true || typeof R.acharLinhas !== "function") return { ok: true, rubricas: rubricas, pdfs: pdfs };
    var linhas = [], termos = [];
    try {
      linhas = R.acharLinhas(pags, r.ajuste);
      var ts = Array.isArray(r.termos) ? r.termos : [];
      for (var i = 0; i < ts.length; i++)
        if (ts[i] && ts[i].nome && ts[i].base64) {
          termos.push({ nome: ts[i].nome, linhas: R.acharLinhas(await R.paginasDoPdf(ts[i].base64), r.ajuste) });
          pdfs.push({ doc: ts[i].nome, base64: ts[i].base64 });
        }
      /* dono 01/11/2026: memorial com uma linha por pessoa — as linhas dele também */
      if (r.memorial && r.memorial.base64) {
        var pm = await R.paginasDoPdf(r.memorial.base64);
        rubricas.memorial = { linhas: R.acharLinhas(pm, r.ajuste) };
        rubricas.memorialPaginas = pm.length;
        pdfs.push({ doc: "memorial", base64: r.memorial.base64 });
      }
    } catch (err) { return { ok: false, erro: "RUBRICAS_SEM_LEITOR" }; }
    rubricas.linhas = linhas; rubricas.termos = termos;
    return { ok: true, rubricas: rubricas, pdfs: pdfs };
  }

  /* Executa um clique. deps: { pageId, confirmar(texto) -> bool, chamar(payload) -> Promise<resposta>,
   * pintar(ctx) opcional — chamado com o bloco ocupado antes de ir ao servidor }.
   * Devolve o contexto novo (não muda o recebido). */
  async function executarAcaoAssinatura(acao, c, deps) {
    acao = String(acao || "").replace(/^p-/, "a-");   /* termo: mesmos cliques com prefixo p- */
    if (/^a-troca-/.test(acao)) return acaoTroca(acao, c, deps);   /* 18/11: Trocar fiadores */
    if (/^a-t-/.test(acao)) return acaoTermos(acao, c, deps);       /* 18/11: envelope próprio dos termos */
    if (acao === "a-reenviar") return reenviarLink(c, deps);
    if (acao === "a-previa") return previaAssinaturas(c, deps);
    if (acao === "a-cancelar") return cancelarEnvelope(c, deps);
    if (acao === "a-trocar-email") return trocarEmail(c, deps);
    if (acao === "a-descartar") return descartarRascunho(c, deps);
    var enviar = acao === "a-enviar";
    if (enviar ? !podeEnviar(c) : (acao !== "a-atualizar" || !podeAtualizar(c))) return c;
    var prazo = "";
    if (enviar) {
      var lim = limitesPrazo(c.agora || new Date());
      prazo = (typeof deps.lerPrazo === "function" && deps.lerPrazo()) || c.prazo || lim.padrao;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo) || prazo < lim.min || prazo > lim.max)
        return copia(c, { prazo: prazo, msg: "Escolha a data limite para assinar entre " + dataBr(lim.min) + " e " + dataBr(lim.max) + "." });
      c = copia(c, { prazo: prazo });
    }
    if (enviar && !deps.confirmar("Enviar o " + (ehTermo(c) ? "termo de reserva" : "contrato") + " para assinatura até " + dataBr(prazo) +
                                  "? Cada signatário recebe um e-mail da Clicksign para assinar; depois dessa data o envelope é cancelado.")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: enviar ? "enviar" : "atualizar", msg: "", faltas: null, corrigir: null }));
    var r, pedido = comDoc(c, { action: enviar ? "assinaturaEnviar" : "assinaturaEstado", pageId: deps.pageId });
    if (enviar) pedido.prazo = prazo;
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
    /* 18/11: contrato assinado com os termos pendentes, envelope dos termos e o "Já assinado" */
    if (r.contratoAssinado) estado.contratoAssinado = true;
    if (r.termos) estado.termos = r.termos;
    if (Array.isArray(r.jaAssinado)) estado.jaAssinado = r.jaAssinado;
    var msg = r.aguardandoArquivo ? AGUARDANDO_ARQUIVO
      : (mensagemAssinatura(r) || (enviar ? "Enviado — cada signatário recebe o e-mail da Clicksign." : "Situação atualizada."));
    /* unidade 22 (01/11): avisos do envio (rubrica que a Clicksign guardou diferente, pessoa sem posição, aviso do leitor) */
    if (enviar && Array.isArray(r.avisos) && r.avisos.length) msg += " Atenção: " + r.avisos.join("; ") + ".";
    return copia(c, { estado: estado, ocupado: null, faltas: null, corrigir: null, msg: msg });
  }

  /* ---- 01/11/2026 (dono): prévia das assinaturas — onde a TINTA de cada marca vai cair, antes de enviar ----
   * Calibração pelos PDFs assinados da unidade 22 (pt, a partir do ponto mandado): assinatura (imagem 100×50) +2…+99 de
   * largura e +18…+29 de altura; visto (iniciais 22 pt) +0…+27 e +9…+27. */
  var TINTA = { manuscript: [2, 18, 99, 29], initials: [0, 9, 27, 27] };
  function caixasDaPrevia(marcas) {
    return (marcas || []).map(function (m) {
      return { doc: m.doc, page: String(m.page), papel: m.papel, kind: m.kind, position: m.position.slice(), tinta: (TINTA[m.kind] || TINTA.manuscript).slice() };
    });
  }
  async function previaAssinaturas(c, deps) {
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "previa", msg: "" }));
    var rb = await prepararRubricas(deps);
    if (!rb.ok) return copia(c, { ocupado: null, msg: mensagemAssinatura(rb) });
    if (!rb.rubricas) return copia(c, { ocupado: null, msg: "Este contrato não tem assinatura posicionada (rubricas desligadas ou PDF não lido)." });
    var r;
    try { r = await deps.chamar({ action: "assinaturaPrevia", pageId: deps.pageId, rubricas: rb.rubricas }); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok) return copia(c, { ocupado: null, msg: mensagemAssinatura(r) });
    var caixas = caixasDaPrevia(r.marcas), docs = {};
    caixas.forEach(function (x) { docs[x.doc] = true; });
    if (typeof deps.mostrarPrevia === "function") await deps.mostrarPrevia({ pdfs: rb.pdfs || [], caixas: caixas, avisos: r.avisos || [] });
    var msg = "Prévia aberta: " + caixas.length + " marca(s) em " + Object.keys(docs).length + " documento(s)" +
      (docs.projeto ? " (o projeto não abre aqui — peça a prévia em imagem)" : "") + "." +
      (Array.isArray(r.avisos) && r.avisos.length ? " Atenção: " + r.avisos.join("; ") + "." : "");
    return copia(c, { ocupado: null, msg: msg });
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

  /* 03/11 (dono): troca o e-mail de quem ainda não assinou, sem cancelar o envelope (ação assinaturaTrocarEmail). deps.alvo
   * = id do signatário (data-sig do botão); deps.perguntar = window.prompt. A Clicksign manda o link para o e-mail novo e o
   * antigo deixa de valer. O cadastro da venda não muda — a mensagem lembra de corrigir lá também. */
  function podeTrocarEmail(c) {
    return !!(c.estado && c.estado.envelope && situacaoDe(c.estado) === "ENVIADO" && !c.ocupado && !c.testes);
  }
  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  async function trocarEmail(c, deps) {
    if (!podeTrocarEmail(c) || typeof deps.perguntar !== "function") return c;
    var s = ((c.estado && c.estado.signatarios) || []).filter(function (x) { return x.id && x.id === deps.alvo; })[0];
    if (!s || sitSignatario(s) !== "pendente") return c;
    var quem = (s.nome ? s.nome + " (" + s.papel + ")" : s.papel);
    var novo = deps.perguntar("E-mail certo de " + quem + ":", s.email || "");
    if (novo === null || novo === undefined) return c;
    novo = String(novo).trim().toLowerCase();
    if (!EMAIL_OK.test(novo)) return copia(c, { msg: MSG.EMAIL_INVALIDO });
    if (novo === String(s.email || "").toLowerCase()) return copia(c, { msg: MSG.EMAIL_IGUAL });
    if (!deps.confirmar("Trocar o e-mail de " + quem + " para " + novo + "? A Clicksign manda o link de assinatura para o e-mail novo e o antigo deixa de valer. O envelope continua o mesmo (quem já assinou não assina de novo).")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: "trocar-email", msg: "" }));
    var r;
    try { r = await deps.chamar(comDoc(c, { action: "assinaturaTrocarEmail", pageId: deps.pageId, signerId: s.id, email: novo })); }
    catch (err) { r = { ok: false, erro: "SEM_RESPOSTA" }; }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    var estado = c.estado;
    if (r.signatarios) estado = copia(c.estado, { signatarios: r.signatarios });
    if (!r.ok) return copia(c, { estado: estado, ocupado: null, msg: mensagemAssinatura(r) });
    return copia(c, { estado: estado, ocupado: null,
                      msg: "E-mail trocado — a Clicksign mandou o link para " + novo + "." +
                           (r.aviso === "NOTIFICACAO_FALHOU" ? " O aviso não saiu: use Reenviar link de assinatura." : "") +
                           " Corrija também o e-mail no cadastro da venda, para o Mais Controle e os próximos documentos." });
  }

  /* 29/10: cancela o envelope na Clicksign (ação assinaturaCancelar) e mostra a situação nova (CANCELADO). */
  async function cancelarEnvelope(c, deps) {
    if (!podeCancelar(c)) return c;
    var oque = ehTermo(c) ? "termo de reserva" : "contrato";
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
    if (!deps.confirmar("Descartar o rascunho do " + (ehTermo(c) ? "termo de reserva" : "contrato") + " na Clicksign? Nada foi enviado aos signatários; depois é só enviar de novo.")) return c;
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
                   executarAcaoAssinatura: executarAcaoAssinatura, limitesPrazo: limitesPrazo, prepararRubricas: prepararRubricas, caixasDaPrevia: caixasDaPrevia, TINTA: TINTA, podeEnviar: podeEnviar, podeReenviar: podeReenviar, podeCancelar: podeCancelar, podeDescartar: podeDescartar, podeTrocarEmail: podeTrocarEmail,
                   podeVerAssinado: podeVerAssinado, nomeArquivoAssinado: nomeArquivoAssinado, precisaCarregarAssinados: precisaCarregarAssinados,
                   carregarAssinados: carregarAssinados, baixarAssinado: baixarAssinado, assinado: assinado,
                   envelopeAberto: envelopeAberto, MSG_DESATUALIZADO: MSG_DESATUALIZADO, preReservaDispensada: preReservaDispensada,
                   /* 18/11/2026: troca de fiadores */
                   podeTrocarFiadores: podeTrocarFiadores, htmlJaAssinado: htmlJaAssinado, htmlTermosEnvelope: htmlTermosEnvelope, htmlTroca: htmlTroca,
                   lerLinhasTermos: lerLinhasTermos, CONTRATO_ASSINADO_TERMOS: CONTRATO_ASSINADO_TERMOS };
  if (typeof module !== "undefined" && module.exports) { module.exports = exportar; return; }
  window.VendaAssinatura = exportar; /* o coordenador liga no painel (venda-dossie.js / vendas.html) */
})();
