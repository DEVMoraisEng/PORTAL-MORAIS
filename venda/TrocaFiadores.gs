/* TrocaFiadores.gs — TROCA DE FIADORES e TERMOS DE CONFISSÃO em envelope próprio (18/11/2026).
 * Arquivo do projeto PORTAL-VENDA (depois de AssinaturaVenda, TermosVenda, Confissao e Conferencia). Regras puras em
 * TermosVenda.js; especificação em docs/superpowers/specs/2026-11-18-troca-de-fiadores-design.md. Origem: unidade 40 —
 * a fiadora desistiu com o envelope em andamento e a troca foi feita à mão (temp.gs de 18/11, fora do repositório).
 * Decisões do dono (18/11/2026):
 *  - a troca vale a qualquer momento, também com o contrato ainda em assinatura (dois envelopes abertos ao mesmo tempo);
 *  - quem pode: quem já pode enviar contrato para assinatura (o perfil TESTES não);
 *  - a venda só conta como ASSINADA quando contrato E termos estão assinados por todos (VGV, ASSINOU E ARMAZENOU,
 *    Mais Controle e ZIP esperam os termos);
 *  - fiador novo entra pelo bloco Fiadores com documento obrigatório e a conferência por IA de nome e CPF;
 *  - envelope dos termos nas colunas ASSINATURA TERMOS - ENVELOPE ID / SITUAÇÃO; as travas de data do sinal não valem ao
 *    refazer os termos; cada troca vira uma linha no HISTÓRICO DO CONTRATO;
 *  - o que já foi assinado por todos fica travado e visível (Propriedade ASS_HIST_<página>).
 * Ações: trocarFiadoresPrevia (só lê), trocarFiadoresGerar (gera os termos novos e devolve os PDFs para a tela ler as
 * linhas de assinatura, como no envio normal) e trocarFiadoresEnviar (rascunho completo do envelope novo → cancela os
 * termos em andamento → ativa; sob LockService, retomável pela Propriedade TROCA_TERMOS_<página>).
 * Fatos medidos (18/11, produção): cada documento fica closed quando o último assinante dele assina, mesmo com o envelope
 * running; envelope running não aceita documento nem requisito novo (403) — termos novos vão sempre num envelope novo.
 * Log só com ação, pageId abreviado, passo e código HTTP — nunca nome, e-mail, CPF ou URL. */
var TROCA_ESTADO = "TROCA_TERMOS_";   /* + página: { carimbo, hash, em, por, novoEnvelope, cancelados, ativado } */
var ASS_HIST = "ASS_HIST_";           /* + página: TermosVenda.registrar (sem e-mail nem CPF) */
var TROCA_CHAVE = "TE_";              /* ASSINATURA_PENDENTE_TE_<página>: envelope de termos ativo que o Notion não gravou */
var TROCA_MSG_SEM_ENVELOPE = "A troca de fiadores é para contrato já enviado para assinatura. Antes do envio, corrija os fiadores e gere o contrato de novo.";
var TROCA_MENSAGEM = "Termos de confissão de dívida da unidade, refeitos com os fiadores atualizados. Falta assinar só estes termos.";

function trocaLog_(m) { console.log("PORTAL-VENDA troca fiadores " + m); }
function trocaCols_(pg) { try { return assColunas_(pg, assDoc_({ doc: "TERMOS" })); } catch (e) { return null; } }
/* envelope de termos desta venda: { cols (null = base sem as colunas), envId, sit, pendente } */
function trocaEnvTermos_(pg, pageId) {
  var t = trocaCols_(pg), pend = prop_(ASS_PENDENTE + TROCA_CHAVE + pageId);
  return { cols: t, envId: pend || (t ? assTexto_(pg, t.ENVELOPE) : ""), sit: t ? assTexto_(pg, t.SITUACAO).toUpperCase() : "", pendente: pend };
}
function trocaEhTermo_(n) { return !!ConfissaoVenda.colunaAssinadaDoNome(n); }
function trocaHistLer_(pageId) { return TermosVenda.lerHist(prop_(ASS_HIST + pageId)); }
function trocaEstadoLer_(pageId) { try { return JSON.parse(prop_(TROCA_ESTADO + pageId) || "{}") || {}; } catch (e) { return {}; } }
function trocaEstadoGravar_(pageId, st) { assProps_().setProperty(TROCA_ESTADO + pageId, JSON.stringify(st)); }
function trocaCota_(e) { return /too many times|quota|cota/i.test(String((e && (e.detalhe || e.message)) || "")); }

/* Um envelope inteiro: { id, base, status, docs, eventos: { docId: [...] }, todos: [...], signers }. Lança assFalha_. */
function trocaLerEnvelope_(envId) {
  var base = "/envelopes/" + encodeURIComponent(envId);
  var env = csPasso_("consultar envelope", "get", base);
  var r = { id: envId, base: base, status: String(env.status || ""), docs: [], eventos: {}, todos: [], signers: [] };
  if (r.status === "draft") return r;
  r.docs = csPasso_("consultar documento", "get", base + "/documents").data || [];
  r.docs.sort(assOrdemDocs_);
  r.docs.forEach(function (dc) {
    var e = csPasso_("consultar eventos", "get", base + "/documents/" + encodeURIComponent(dc.id) + "/events").data || [];
    r.eventos[dc.id] = e; r.todos = r.todos.concat(e);
  });
  r.signers = csPasso_("consultar signatarios", "get", base + "/signers").data || [];
  return r;
}

/* ---- estado da assinatura do CONTRATO (AssinaturaVenda.assinaturaEstado_ chama isto para o contrato) ----
 * Lê o envelope do contrato e, se houver, o de termos. Colhe POR DOCUMENTO (contrato fechado → CONTRATO ASSINADO, mesmo
 * com o envelope running; termo fechado → a coluna ASSINADA dele; cancelado nunca), grava a situação combinada
 * (TermosVenda.situacaoCombinada) e a do envelope de termos. Pós-assinatura (Andamento, Mais Controle, ZIP) só quando a
 * situação combinada vira ASSINADO pela primeira vez. Sem envelope de termos: as mesmas chamadas de antes. */
function assEstadoContrato_(col, p) {
  var pid = String(p.pageId).slice(0, 8), S = ClicksignVenda.SITUACOES, doc = assDoc_({});
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, doc);
  var envId = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  var pendente = prop_(ASS_PENDENTE + doc.chave + p.pageId);
  if (pendente) envId = pendente;
  if (!envId) return { ok: true, situacao: "", envelope: false, signatarios: [] };
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };
  var T = trocaEnvTermos_(pg, p.pageId);

  function gravar(sit) {
    if (sit === sitAtual && !pendente) return true;
    var g = pendente ? assColunasEnvelope_(cols, envId, sit) : {};
    g[cols.SITUACAO] = sit;
    try { assGravarTextos_(p.pageId, g); }
    catch (e) { ctrErro_("assinatura estado " + pid + " gravacao", e); return false; }
    if (pendente) assApagarProp_(ASS_PENDENTE + doc.chave + p.pageId);
    return true;
  }
  function gravarTermos(sit) {
    if (!T.cols || (sit === T.sit && !T.pendente)) return true;
    var g = T.pendente ? assColunasEnvelope_(T.cols, T.envId, sit) : {};
    g[T.cols.SITUACAO] = sit;
    try { assGravarTextos_(p.pageId, g); }
    catch (e) { ctrErro_("assinatura estado " + pid + " gravacao dos termos", e); return false; }
    if (T.pendente) assApagarProp_(ASS_PENDENTE + TROCA_CHAVE + p.pageId);
    return true;
  }

  var C, Tt = null;
  try { C = trocaLerEnvelope_(envId); }
  catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    /* rascunho apagado na Clicksign (à mão): a casa volta a "sem envelope" */
    if (e.passo === "consultar envelope" && e.http === 404 && !pendente && sitAtual.toUpperCase() === S.RASCUNHO) {
      try { assGravarTextos_(p.pageId, assColunasEnvelope_(cols, "", "")); }
      catch (e2) { ctrErro_("assinatura estado " + pid + " limpeza do rascunho", e2); return { ok: false, erro: "GRAVACAO_FALHOU" }; }
      assApagarPapeis_(envId);
      assLog_("estado " + pid + " rascunho " + envId + " nao existe mais: colunas limpas");
      return { ok: true, situacao: "", envelope: false, signatarios: [] };
    }
    assLog_("estado " + pid + " falhou no passo " + e.passo + " http " + e.http);
    return { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe };
  }
  if (C.status === "draft") {
    if (!gravar(S.RASCUNHO)) return { ok: false, erro: "GRAVACAO_FALHOU" };
    return { ok: true, situacao: S.RASCUNHO, envelope: true, signatarios: [] };
  }
  if (!C.docs.length) return { ok: false, erro: "CLICKSIGN_ENVELOPE_SEM_DOCUMENTO" };
  if (T.envId) {
    try { Tt = trocaLerEnvelope_(T.envId); }
    catch (e) {
      if (e.message !== "CLICKSIGN_FALHOU") throw e;
      assLog_("estado " + pid + " termos falhou no passo " + e.passo + " http " + e.http);
      return { ok: false, erro: "CLICKSIGN_FALHOU", passo: "termos: " + e.passo, http: e.http, detalhe: e.detalhe };
    }
  }
  var comb, sitC, sitT = "";
  try {
    comb = TermosVenda.situacaoCombinada(C, Tt, trocaEhTermo_);
    sitC = TermosVenda.situacaoDoEnvelope(C);
    if (Tt) sitT = TermosVenda.situacaoDoEnvelope(Tt);
  } catch (e) { assLog_("estado " + pid + " status desconhecido"); return { ok: false, erro: String(e.message) }; }
  var sit = comb.situacao;
  if (sit !== S.ENVIADO) assApagarProp_(ASS_VIGIA_STATUS + envId);   /* terminou: a vigia não precisa mais do status */
  if (Tt && sitT !== S.ENVIADO) assApagarProp_(ASS_VIGIA_STATUS + Tt.id);

  /* colheita por documento; o que já entrou fica marcado no registro (não entra de novo) */
  var hist0 = trocaHistLer_(p.pageId), jaColhido = TermosVenda.colhidos(hist0), colhidosAgora = [];
  var semArquivo = !(ctrValor_(pg.properties[cols.ASSINADO]) || []).length;
  var aguardando = false, anexouContrato = false, D = ClicksignVenda.DOC;
  function semLink(e) { return String((e && e.message) || "").indexOf("CLICKSIGN_SEM_LINK_ASSINADO") === 0; }
  var alvos = TermosVenda.paraColher(C.docs, trocaEhTermo_, C.status).map(function (x) { x.env = C; return x; });
  if (Tt) alvos = alvos.concat(TermosVenda.paraColher(Tt.docs, trocaEhTermo_, Tt.status).map(function (x) { x.env = Tt; return x; }));
  for (var k = 0; k < alvos.length; k++) {
    var a = alvos[k], dc = a.doc, colN = "", nome = "";
    if (jaColhido[dc.id]) continue;
    if (a.tipo === D.CONTRATO) {
      if (a.env !== C || !(semArquivo || (sit === S.ASSINADO && sitAtual.toUpperCase() !== S.ASSINADO))) continue;
      var gerado = doc.gerado(pg);
      colN = cols.ASSINADO; nome = assNomeAssinado_(gerado && gerado.nome);
    } else {
      colN = cfdCol_(pg, cfdDoNome_(dc));
      if (!colN) continue;
      /* termo do envelope do contrato: só com a coluna vazia e sem envelope de termos (os de lá substituem estes) */
      if (a.env === C && (Tt || (ctrValor_(pg.properties[colN]) || []).length)) continue;
      nome = "ASSINADO - " + ctrTxt_((dc.attributes || {}).filename || "termo.pdf");
    }
    var link, r;
    try { link = ClicksignVenda.linkAssinado(dc); }
    catch (e) {
      if (!semLink(e)) { assLog_("estado " + pid + " envelope " + a.env.id + " sem link do assinado"); return { ok: false, erro: String(e.message) }; }
      assLog_("estado " + pid + " envelope " + a.env.id + " " + a.tipo + " assinado, arquivo ainda sendo preparado");
      aguardando = true; continue;
    }
    try { r = UrlFetchApp.fetch(link, { muteHttpExceptions: true }); }   /* link pré-assinado: sem o token */
    catch (e) { assLog_("estado " + pid + " download do assinado sem resposta"); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    if (r.getResponseCode() >= 300) { assLog_("estado " + pid + " download do assinado http " + r.getResponseCode()); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    try { anexarArquivo_(p.pageId, colN, { nome: nome, mime: "application/pdf", base64: Utilities.base64Encode(r.getBlob().getBytes()) }, true); }
    catch (e) { ctrErro_("assinatura estado " + pid + " anexo falhou", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    colhidosAgora.push({ env: a.env.id, doc: dc.id });
    if (a.tipo === D.CONTRATO) { anexouContrato = true; semArquivo = false; }
    assLog_("estado " + pid + " envelope " + a.env.id + " " + a.tipo + " assinado anexado");
  }

  var tinhaAguardando = !!prop_(ASS_AGUARDANDO + p.pageId);
  if (!gravar(sit)) return { ok: false, erro: "GRAVACAO_FALHOU" };
  if (Tt && !gravarTermos(sitT)) return { ok: false, erro: "GRAVACAO_FALHOU" };
  if (sit === S.ASSINADO) {
    if (aguardando) { if (!tinhaAguardando) assProps_().setProperty(ASS_AGUARDANDO + p.pageId, String(Date.now())); }
    else if (tinhaAguardando) assApagarProp_(ASS_AGUARDANDO + p.pageId);
  }
  /* 18/11/2026 (dono): Andamento, Mais Controle e ZIP só quando a venda fica ASSINADA (contrato E termos) pela 1ª vez */
  var primeira = sit === S.ASSINADO && !aguardando && (sitAtual.toUpperCase() !== S.ASSINADO || tinhaAguardando || anexouContrato);
  if (primeira) assPosAssinatura_(col, p.pageId);
  if (sit === S.ASSINADO && !aguardando) {
    var colZip = cfdCol_(pg, MC_COL_ZIP), zipFalta = !!colZip && !(ctrValor_(pg.properties[colZip]) || []).length;
    if (primeira || (zipFalta && !prop_(MC_ZIP_PENDENTE + p.pageId))) {
      try { mcAnexosPosAssinatura_(p.pageId, !!primeira, zipFalta); }
      catch (e) { ctrErro_("assinatura estado " + pid + " anexos MC", e); }
    }
  }

  /* lista para a tela e registro do que foi assinado — antes de apagar os papéis do envelope que terminou */
  var feitosC = ClicksignVenda.assinaram(C.signers, C.todos), lista = assListaSignatarios_(C.id, C.signers, C.todos);
  var listaT = Tt ? assListaSignatarios_(Tt.id, Tt.signers, Tt.todos) : null;
  var h = TermosVenda.registrar(hist0, C.id, "contrato", C.docs, C.eventos, C.signers, assPapeis_(C.id), trocaEhTermo_);
  if (Tt) h = TermosVenda.registrar(h, Tt.id, "termos", Tt.docs, Tt.eventos, Tt.signers, assPapeis_(Tt.id), trocaEhTermo_);
  colhidosAgora.forEach(function (x) { h = TermosVenda.marcarColhido(h, x.env, x.doc); });
  trocaHistGuardar_(p.pageId, h, hist0, sit, !!Tt);
  var todosSig = C.signers.concat(Tt ? Tt.signers : []), feitos = {};
  var fT = Tt ? ClicksignVenda.assinaram(Tt.signers, Tt.todos) : {};
  Object.keys(feitosC).forEach(function (x) { feitos[x] = feitosC[x]; });
  Object.keys(fT).forEach(function (x) { feitos[x] = fT[x]; });
  assGravarProgresso_(pg, p.pageId, doc, todosSig, feitos);
  if (ClicksignVenda.FINAIS.indexOf(sitC) >= 0) { assApagarPapeis_(C.id); assApagarProp_(ASS_REENVIO + C.id); }
  if (Tt && ClicksignVenda.FINAIS.indexOf(sitT) >= 0) { assApagarPapeis_(Tt.id); assApagarProp_(ASS_REENVIO + Tt.id); }

  var resp = { ok: true, situacao: sit, envelope: true, signatarios: lista, temAssinado: !semArquivo };
  if (comb.contratoAssinado) resp.contratoAssinado = true;
  if (Tt) resp.termos = { envelope: true, situacao: sitT, signatarios: listaT };
  var ja = TermosVenda.jaAssinado(h);
  if (ja.length && sit !== S.ASSINADO) resp.jaAssinado = ja;
  if (aguardando) resp.aguardandoArquivo = true;
  /* closed sem o "sign" de alguém: não inventa assinatura; o PDF é o que a Clicksign entregou */
  if (C.status === "closed" && C.signers.some(function (s) { return !feitosC[s.id]; })) {
    assLog_("estado " + pid + " envelope " + envId + " assinaturas incompletas");
    resp.aviso = "ASSINATURAS_INCOMPLETAS";
  }
  return resp;
}
/* O registro só fica guardado enquanto serve: venda com envelope de termos, ou com algum documento já fechado e a venda
 * ainda não ASSINADA (o "Já assinado" da tela). Assinada sem troca, a Propriedade sai (a tela usa Documentos assinados). */
function trocaHistGuardar_(pageId, h, antes, sit, comTermos) {
  var algum = TermosVenda.jaAssinado(h).length > 0;
  try {
    if (!comTermos && (sit === ClicksignVenda.SITUACOES.ASSINADO || !algum)) {
      if (prop_(ASS_HIST + pageId)) assApagarProp_(ASS_HIST + pageId);
      return;
    }
    var j = JSON.stringify(h);
    if (j !== JSON.stringify(antes)) assProps_().setProperty(ASS_HIST + pageId, j);
  } catch (e) { assLog_("historico " + String(pageId).slice(0, 8) + " nao gravado"); }
}

/* Documentos dos envelopes do contrato e de termos para Documentos assinados / Ver PDF assinado (contrato):
 * { docs } ou { resp }. Com a venda ASSINADA: todos os não cancelados; antes disso, só os já fechados (18/11: "Ver PDF
 * assinado" de um documento fechado com o envelope ainda running). p.envelope (opcional) tem de ser um dos dois. */
function trocaEnvelopesAssinados_(p, pg, cols, envId) {
  var assinado = assTexto_(pg, cols.SITUACAO).toUpperCase() === ClicksignVenda.SITUACOES.ASSINADO, T = trocaEnvTermos_(pg, p.pageId);
  if (!envId) return { resp: { ok: false, erro: "NAO_ASSINADO" } };
  if (!prop_("CLICKSIGN_TOKEN")) return { resp: { ok: false, erro: "CLICKSIGN_SEM_TOKEN" } };
  if (!csBase_()) return { resp: { ok: false, erro: "CLICKSIGN_URL_INVALIDA" } };
  var ids = [envId].concat(T.envId ? [T.envId] : []), docs = [];
  if (p.envelope && ids.indexOf(String(p.envelope)) < 0) return { resp: { ok: false, erro: "DOCUMENTO_NAO_ENCONTRADO" } };
  try {
    ids.forEach(function (id) {
      if (p.envelope && String(p.envelope) !== id) return;
      (csPasso_("consultar documento", "get", "/envelopes/" + encodeURIComponent(id) + "/documents").data || []).forEach(function (dc) {
        var st = String((dc.attributes || {}).status || "");
        if (st === "canceled") return;
        if (!assinado && st !== "closed") return;
        docs.push(dc);
      });
    });
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    return { resp: { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe } };
  }
  if (!assinado && !docs.length) return { resp: { ok: false, erro: "NAO_ASSINADO" } };
  return { docs: docs };
}

/* Trava do modo "Trocar fiadores" (assTravaAssinado_): com o envelope aberto, o bloco Fiadores grava só os campos dos
 * fiadores; venda ASSINADA continua travada. null = segue a trava de sempre (envelope fechado não precisa do modo). */
function trocaTravaModo_(p) {
  var a = String(p.action || "");
  if (a === "salvarFiadores") {
    var ks = Object.keys((p.valores && typeof p.valores === "object") ? p.valores : {});
    var fora = ks.filter(function (k) { return !/FIADOR [12]$/i.test(String(k).trim()); });
    if (fora.length) return { ok: false, erro: "COLUNA_NAO_PERMITIDA", coluna: String(fora[0]).slice(0, 60) };
  }
  var pg;
  try { pg = ctrLerPaginaVenda_(p.pageId); } catch (e) { return null; }
  try {
    var cols = assColunas_(pg, assDoc_({}));
    if (assTexto_(pg, cols.SITUACAO).toUpperCase() === ClicksignVenda.SITUACOES.ASSINADO) return { ok: false, erro: "CONTRATO_ASSINADO" };
  } catch (e) { return null; }
  assLog_(a + " " + String(p.pageId).slice(0, 8) + " no modo trocar fiadores");
  return "LIVRE";
}

/* ---- prévia, gerar e enviar ---- */
function trocaComFiltro_(fn) {
  var orig = ContratoVenda.faltasContrato, ign = [];
  ContratoVenda.faltasContrato = function (dd) { var r = TermosVenda.filtrarTravasData(orig(dd)); ign = ign.concat(r.ignoradas); return r.faltas; };
  try { var r = fn(), visto = {}; return { r: r, ignoradas: ign.filter(function (f) { if (visto[f]) return false; visto[f] = true; return true; }) }; }
  finally { ContratoVenda.faltasContrato = orig; }
}
function trocaPermissao_(sess) {
  if (String((sess && sess.t) || "").toUpperCase() === "TESTES") return { ok: false, erro: "SEM_PERMISSAO_TESTES" };
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };
  return null;
}
/* Tudo o que a troca confere (prévia, gerar e enviar): { x } ou { resp }. Lê a venda, os dados (sem as travas do sinal) e,
 * na Clicksign, os documentos e signatários do envelope onde estão os termos de agora (2 chamadas). */
function trocaConferir_(col, p, pid) {
  var S = ClicksignVenda.SITUACOES, info = {};
  var pg = ctrLerPaginaVenda_(p.pageId, info);
  if (info.base !== "CONDOMINIO") return { resp: { ok: false, erro: "SO_CONDOMINIO" } };
  var cols = assColunas_(pg, assDoc_({}));
  var sitC = assTexto_(pg, cols.SITUACAO).toUpperCase(), envC = prop_(ASS_PENDENTE + p.pageId) || assTexto_(pg, cols.ENVELOPE);
  if (sitC === S.ASSINADO) return { resp: { ok: false, erro: "CONTRATO_ASSINADO" } };
  if (!envC || sitC !== S.ENVIADO) return { resp: { ok: false, erro: "TROCA_SEM_ENVELOPE", mensagem: TROCA_MSG_SEM_ENVELOPE } };
  var T = trocaEnvTermos_(pg, p.pageId);
  if (!T.cols) return { resp: { ok: false, erro: "COLUNA_FALTANDO: " + TermosVenda.COL.ENVELOPE + ", " + TermosVenda.COL.SITUACAO } };
  if (!cfdLigado_()) return { resp: { ok: false, erro: "SEM_TERMOS" } };
  var dd = trocaComFiltro_(function () { return ctrDadosAtuais_(col, p, pid, "trocarFiadores"); }), x = dd.r;
  if (x.resp && !(x.resp.erro === "FALTAM_DADOS" && x.d)) return { resp: x.resp };
  var d = x.d, config = assConfig_(p.pageId);
  config.comFiadores = ConfissaoVenda.fiadoresAssinam(d, true);
  var tipos = ConfissaoVenda.quais(d), faltas = [], visto = {};
  ((x.resp && x.resp.faltas) || []).concat(config.invalidas.map(function (n) { return "Propriedade " + n + ": JSON inválido"; }),
    ClicksignVenda.faltasAssinatura(d, config)).forEach(function (f) { if (!visto[f]) { visto[f] = true; faltas.push(f); } });
  var envAntigo = T.envId || envC, ant;
  try {
    ant = { docs: csPasso_("consultar documento", "get", "/envelopes/" + encodeURIComponent(envAntigo) + "/documents").data || [],
            signers: csPasso_("consultar signatarios", "get", "/envelopes/" + encodeURIComponent(envAntigo) + "/signers").data || [] };
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    trocaLog_(pid + " consulta falhou no passo " + e.passo + " http " + e.http);
    return { resp: { ok: false, erro: trocaCota_(e) ? "COTA_GOOGLE_ESGOTADA" : "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe } };
  }
  var papeis = assPapeis_(envAntigo), assinantes = Object.keys(papeis).length ? ant.signers.map(function (s) {
    var at = s.attributes || {};
    return { papel: papeis[s.id] || "", nome: at.name, cpf: at.documentation };
  }) : null;
  var alterados = TermosVenda.fiadoresAlterados((d.condominio && d.condominio.fiadores) || [], assinantes);
  var docsF = {};
  [1, 2].forEach(function (n) { var c = confColReal_(pg, ConferenciaDocs.COL["F" + n + "_ID"]); docsF[n] = c ? (ctrValor_(pg.properties[c]) || []).length : 0; });
  var o = confLer_(p.pageId), carimbo = ctrCarimbo_(d), mudou = false;
  try { mudou = !!o && ConferenciaDocs.anexosMudaram(o, confContagem_(pg)); } catch (e) { mudou = false; }
  var v = TermosVenda.conferirTroca({ termos: tipos, faltas: faltas, alterados: alterados, docs: docsF, conferencia: o, carimbo: carimbo, anexosMudaram: mudou });
  var cancelar = ant.docs.filter(function (dc) { return cfdDoNome_(dc) && String((dc.attributes || {}).status || "") === "running"; });
  var lista = TermosVenda.signatariosTermos(ClicksignVenda.signatarios(d, config));
  return { x: { pg: pg, d: d, f: x.f, config: config, tipos: tipos, alterados: alterados, v: v, cancelar: cancelar, envAntigo: envAntigo,
                antigoEhTermos: !!T.envId, T: T, lista: lista, carimbo: carimbo, ignoradas: dd.ignoradas } };
}

/* trocarFiadoresPrevia (só lê): o que a tela mostra antes de gerar — o que falta, o que será cancelado e quem assina. */
function trocarFiadoresPrevia_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), perm = trocaPermissao_(sess);
  if (perm) return perm;
  var c = trocaConferir_(col, p, pid);
  if (c.resp) { trocaLog_(pid + " previa: " + c.resp.erro); return c.resp; }
  var x = c.x, b = null;
  try { b = fiaEstado_(x.pg, [], { troca: true }); } catch (e) { ctrErro_("troca previa " + pid + " fiadores", e); }
  trocaLog_(pid + " previa: " + (x.v.ok ? "liberada" : x.v.erro) + ", cancela " + x.cancelar.length + ", assinam " + x.lista.length);
  var r = { ok: true, liberado: x.v.ok, problemas: x.v.problemas, alterados: x.alterados, termos: x.tipos, carimbo: x.carimbo,
            cancelar: x.cancelar.map(function (dc) { return { nome: cfdNomeNaClicksign_(ctrTxt_((dc.attributes || {}).filename)) }; }),
            envelopeAntigo: x.antigoEhTermos ? "termos" : "contrato", assinam: TermosVenda.pessoas(x.lista), datasIgnoradas: x.ignoradas.length };
  if (!x.v.ok) r.bloqueio = x.v.erro;
  if (b) r.fiadores = b;
  return r;
}

/* trocarFiadoresGerar: confere de novo, gera os termos novos (mesmo gerador, sem as travas do sinal) e devolve os PDFs
 * para a tela ler as linhas de assinatura (RubricasVenda). O carimbo da prévia vai na Propriedade TROCA_TERMOS_<página>. */
function trocarFiadoresGerar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), rot = "trocarFiadoresGerar", perm = trocaPermissao_(sess);
  if (perm) return perm;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) return { ok: false, erro: "ASSINATURA_OCUPADA" };
  var r;
  try {
    var c = trocaConferir_(col, p, pid);
    if (c.resp) r = c.resp;
    else if (!c.x.v.ok) r = { ok: false, erro: c.x.v.erro, problemas: c.x.v.problemas };
    else if (p.carimbo && String(p.carimbo) !== c.x.carimbo) r = { ok: false, erro: "TROCA_DESATUALIZADA" };
    else {
      /* rascunho de um envio que não terminou: sai antes de gerar outros termos (o envelope antigo segue como está) */
      var st0 = trocaEstadoLer_(p.pageId);
      if (st0.novoEnvelope && !st0.ativado && !trocaApagarRascunho_(st0.novoEnvelope, pid)) r = { ok: false, erro: "TROCA_RASCUNHO_PENDENTE" };
      else {
        var pp = trocaComFiltro_(function () { return ctrPreparar_(col, p, pid, rot); }), prep = pp.r;
        if (prep.resp) r = prep.resp;
        else {
          var tc = cfdGerarTermos_(prep, p, pid, rot);
          if (tc.resp) r = tc.resp;
          else {
            trocaEstadoGravar_(p.pageId, { carimbo: c.x.carimbo, hash: prep.hash, em: new Date().toISOString(), por: ctrTxt_(sess && sess.u), tipos: c.x.tipos });
            r = { ok: true, carimbo: c.x.carimbo, termos: tc.pdfs || [], linhas: !!c.x.config.linhas, semRubricas: !!c.x.config.semRubricas,
                  ajuste: c.x.config.rubricasAjuste, nomes: (tc.pdfs || []).map(function (x) { return x.nome; }) };
          }
        }
      }
    }
  } finally { trava.releaseLock(); }
  trocaLog_(pid + " gerar por " + ctrTxt_(sess && sess.u) + ": " + (r.ok ? "ok termos " + r.termos.length : r.erro));
  return r;
}

/* trocarFiadoresEnviar (ordem do dono, 18/11/2026):
 *  1) os termos da linha são os gerados nesta troca (carimbo da prévia);
 *  2) envelope novo como RASCUNHO completo (documentos, signatários, requisitos, assinaturas na linha) — anotado em
 *     TROCA_TERMOS_<página>; se falhar, o rascunho é apagado e nada é cancelado;
 *  3) só então cancela os termos em andamento do envelope antigo — se falhar, para sem ativar (o Enviar continua daqui);
 *  4) por último ativa o envelope novo, grava ASSINATURA TERMOS - ENVELOPE ID / SITUAÇÃO = ENVIADO e notifica;
 *  5) linha no histórico (LogContratoVenda, pelo tratar_). */
function trocarFiadoresEnviar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), perm = trocaPermissao_(sess);
  if (perm) return perm;
  csGastoTotal_ = 0;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) { trocaLog_(pid + " enviar ocupado"); return { ok: false, erro: "ASSINATURA_OCUPADA" }; }
  var r;
  try { r = trocaEnviarTravado_(col, sess, p, pid); }
  catch (e) {
    if (!trocaCota_(e)) throw e;
    r = { ok: false, erro: "COTA_GOOGLE_ESGOTADA" };
  } finally { trava.releaseLock(); }
  trocaLog_(pid + " enviar por " + ctrTxt_(sess && sess.u) + ": " + (r.ok ? "ok envelope " + r.envelopeId : r.erro + (r.passo ? " no passo " + r.passo + " http " + r.http : "")));
  return r;
}
var TROCA_MSG_RETOMAR = "Os termos novos estão prontos em rascunho na Clicksign e nada foi ativado. Clique em Enviar termos novos de novo daqui a pouco: o envio continua de onde parou.";
/* apaga o rascunho de uma troca que não terminou (true = apagou ou já não existia) */
function trocaApagarRascunho_(envId, pid) {
  if (!envId) return true;
  var d = cs_("delete", "/envelopes/" + encodeURIComponent(envId));
  if (d.ok || d.http === 404) { assApagarPapeis_(envId); return true; }
  trocaLog_(pid + " rascunho " + envId + " nao apagado http " + d.http);
  return false;
}
function trocaEnviarTravado_(col, sess, p, pid) {
  var S = ClicksignVenda.SITUACOES, st = trocaEstadoLer_(p.pageId);
  if (!st.carimbo || !st.hash) return { ok: false, erro: "TROCA_SEM_TERMOS_GERADOS" };
  if (st.ativado && st.novoEnvelope) return { ok: true, jaFeito: true, envelopeId: st.novoEnvelope, situacao: S.ENVIADO, cancelados: st.cancelados || 0 };
  if (!ClicksignVenda.prazoAssinatura(p.prazo, new Date()).ok) return { ok: false, erro: "PRAZO_INVALIDO" };
  var c = trocaConferir_(col, p, pid);
  if (c.resp) return c.resp;
  var x = c.x;
  if (!x.v.ok) return { ok: false, erro: x.v.erro, problemas: x.v.problemas };
  if (x.carimbo !== st.carimbo) return { ok: false, erro: "TROCA_DESATUALIZADA" };
  /* 1) os termos da linha são os gerados nesta troca (carimbo no nome) */
  var pdfs = [];
  for (var i = 0; i < x.tipos.length; i++) {
    var g = cfdGerado_(x.pg, x.tipos[i]), b = null;
    if (!g || ctrCarimboDoNome_(g.nome) !== st.hash) return { ok: false, erro: "TROCA_DESATUALIZADA" };
    try { b = baixarArquivo_({ name: g.nome, type: "file", file: { url: g.url } }); } catch (e) { b = null; }
    if (!b || b.mime !== "application/pdf") return { ok: false, erro: "CONTRATO_ILEGIVEL" };
    pdfs.push({ nome: cfdNomeNaClicksign_(g.nome), base64: b.base64 });
  }
  /* assinaturas posicionadas: as linhas que a tela leu nos PDFs novos (obrigatórias com ASSINATURA_LINHAS=1) */
  var rub = null, cfg = x.config;
  if (cfg.linhas && !cfg.semRubricas) {
    var rt = p.rubricas && Array.isArray(p.rubricas.termos) ? p.rubricas.termos : null;
    if (!rt) return { ok: false, erro: "RUBRICAS_FALTANDO" };
    var vr = ClicksignVenda.validarRubricas({ nome: "TERMOS", campos: [], termos: rt }, "TERMOS", { camposOpcionais: true });
    if (!vr.ok) return { ok: false, erro: vr.erro };
    if (pdfs.some(function (e) { return !vr.termos[e.nome]; })) return { ok: false, erro: "RUBRICAS_DE_OUTRO_PDF" };
    rub = { campos: [], valores: null, linhas: [], termos: vr.termos, memorial: null, projeto: [], tamanhos: {}, avisos: assAvisosDaTela_(p.rubricas) };
  }
  /* 2) rascunho completo do envelope novo — ou o de uma tentativa anterior, se ficou pronto e ainda existe */
  var jaAtivo = false;
  if (st.novoEnvelope && st.rascunhoPronto) {
    var ge = cs_("get", "/envelopes/" + encodeURIComponent(st.novoEnvelope));
    if (ge.ok && (ge.status === "draft" || ge.status === "running")) jaAtivo = ge.status === "running";
    else if (ge.http === 404) { st.novoEnvelope = ""; st.rascunhoPronto = false; trocaEstadoGravar_(p.pageId, st); }
    else return { ok: false, erro: trocaCota_(ge) ? "COTA_GOOGLE_ESGOTADA" : "CLICKSIGN_FALHOU", passo: "consultar rascunho", http: ge.http, detalhe: ge.detalhe, mensagem: TROCA_MSG_RETOMAR };
  } else if (st.novoEnvelope) {
    /* rascunho que parou no meio numa tentativa anterior: sai antes de fazer outro */
    if (!trocaApagarRascunho_(st.novoEnvelope, pid)) return { ok: false, erro: "TROCA_RASCUNHO_PENDENTE" };
    st.novoEnvelope = ""; trocaEstadoGravar_(p.pageId, st);
  }
  if (!st.novoEnvelope) {
    var nomeCs = "TERMOS - " + ClicksignVenda.nomePadrao(x.f.endereco, x.f.casa, x.d.comprador1 && x.d.comprador1.nome);
    var mensagem = String(prop_("CLICKSIGN_MENSAGEM_TERMOS") || "").trim() || TROCA_MENSAGEM;
    var cr = trocaCriarRascunho_(p, pid, pdfs, x.lista, x.d, rub, nomeCs, mensagem, st);
    if (!cr.ok) return cr;
  }
  var envId = st.novoEnvelope, base = "/envelopes/" + encodeURIComponent(envId);
  /* 3) cancela os termos em andamento do envelope antigo; falhou = para sem ativar */
  var baseAnt = "/envelopes/" + encodeURIComponent(x.envAntigo), n = 0;
  try {
    x.cancelar.forEach(function (dc) {
      csPasso_("cancelar termo", "patch", baseAnt + "/documents/" + encodeURIComponent(dc.id), ClicksignVenda.corpoCancelarDocumento(dc.id));
      n++;
      var at = {}; for (var k in (dc.attributes || {})) at[k] = dc.attributes[k];
      at.status = "canceled"; dc.attributes = at;
    });
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    st.cancelados = (st.cancelados || 0) + n; trocaEstadoGravar_(p.pageId, st);
    return { ok: false, erro: trocaCota_(e) ? "COTA_GOOGLE_ESGOTADA" : "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe,
             envelopeId: envId, retomavel: true, mensagem: TROCA_MSG_RETOMAR };
  }
  st.cancelados = (st.cancelados || 0) + n; trocaEstadoGravar_(p.pageId, st);
  /* 4) ativa o envelope novo e grava as colunas */
  if (!jaAtivo) {
    try { assAtivar_(base, envId); }
    catch (e) {
      if (e.message !== "CLICKSIGN_FALHOU") throw e;
      trocaLog_(pid + " ativar falhou http " + e.http + " envelope " + envId + (e.incerto ? " sem confirmacao" : " ficou em rascunho"));
      return { ok: false, erro: trocaCota_(e) ? "COTA_GOOGLE_ESGOTADA" : "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe,
               envelopeId: envId, retomavel: true, incerto: !!e.incerto, mensagem: TROCA_MSG_RETOMAR };
    }
  }
  st.ativado = true; trocaEstadoGravar_(p.pageId, st);
  var gravou = assGravarComRetentativa_(p.pageId, assColunasEnvelope_(x.T.cols, envId, S.ENVIADO), pid);
  if (!gravou) assProps_().setProperty(ASS_PENDENTE + TROCA_CHAVE + p.pageId, envId);
  var nt = cs_("post", base + "/notifications", ClicksignVenda.corpoNotificacao());
  if (!nt.ok) trocaLog_(pid + " envelope " + envId + " notificacao falhou http " + nt.http);
  /* o envelope de termos anterior não serve mais; o registro guarda os termos cancelados */
  if (x.antigoEhTermos) { assApagarPapeis_(x.envAntigo); assApagarProp_(ASS_VIGIA_STATUS + x.envAntigo); assApagarProp_(ASS_REENVIO + x.envAntigo); }
  try {
    var h0 = trocaHistLer_(p.pageId);
    if (x.cancelar.length) trocaHistGuardar_(p.pageId, TermosVenda.registrar(h0, x.envAntigo, x.antigoEhTermos ? "termos" : "contrato",
                                                                            trocaDocsComStatus_(h0, x.envAntigo, x.cancelar), {}, [], {}, trocaEhTermo_), h0, S.ENVIADO, true);
  } catch (e) { ctrErro_("troca " + pid + " registro", e); }
  var r = { ok: true, envelopeId: envId, situacao: S.ENVIADO, cancelados: st.cancelados,
            termos: { envelope: true, situacao: S.ENVIADO, signatarios: (st.sigs || []).map(function (s) {
              return { id: s.id, papel: s.papel, nome: s.nome, email: "", assinou: false, situacao: "pendente", data: "" };
            }) } };
  if (!gravou) r.aviso = "GRAVACAO_FALHOU";
  else if (!nt.ok) r.aviso = "NOTIFICACAO_FALHOU";
  if (st.avisos && st.avisos.length) r.avisos = st.avisos;
  return r;
}
/* documentos do envelope antigo para o registro: os já registrados (com quem assinou) + os cancelados agora */
function trocaDocsComStatus_(h, envId, cancelados) {
  var e = (h.envelopes || []).filter(function (y) { return y.id === envId; })[0], out = [], visto = {};
  cancelados.forEach(function (dc) { visto[dc.id] = true; out.push(dc); });
  ((e && e.docs) || []).forEach(function (d) { if (!visto[d.id]) out.push({ id: d.id, attributes: { filename: d.nome, status: d.status } }); });
  return out;
}

/* Rascunho completo do envelope novo: envelope → documentos (termos) → signatários → requisitos (qualificação,
 * autenticação, assinatura na linha). Não ativa e não grava na venda. Anota em TROCA_TERMOS_ o envelope logo que existe
 * e rascunhoPronto no fim (com os signatários só por papel e nome mascarado). Falhou = apaga o rascunho. */
function trocaCriarRascunho_(p, pid, pdfs, lista, d, rub, nomeCs, mensagem, st) {
  var D = ClicksignVenda.DOC, cfg = assConfig_(p.pageId);
  var envId = "", base = "", papeis = {}, ids = [], avisos = (rub && rub.avisos || []).map(function (a) { return "tela: " + a; });
  try {
    envId = csPasso_("envelope", "post", "/envelopes", ClicksignVenda.corpoEnvelope(nomeCs, mensagem, ClicksignVenda.prazoAssinatura(p.prazo, new Date()).deadline), true).id;
    base = "/envelopes/" + encodeURIComponent(envId);
    st.novoEnvelope = envId; st.rascunhoPronto = false; trocaEstadoGravar_(p.pageId, st);
    var docs = pdfs.map(function (e) {
      return { id: csPasso_("documento", "post", base + "/documents", ClicksignVenda.corpoDocumento(e.nome, e.base64), true).id, tipo: D.TERMO, nome: e.nome };
    });
    ids = lista.map(function (s) {
      var id = csPasso_("signatarios", "post", base + "/signers", ClicksignVenda.corpoSignatario(s), true).id;
      papeis[id] = s.papel;
      return id;
    });
    var reqs = ids.map(function () { return []; });
    function criarReq(passo, i, corpo) {
      var rr = csPasso_(passo, "post", base + "/requirements", corpo);
      reqs[i].push(ClicksignVenda.requisitoGuardado(rr.id, corpo));
      return rr;
    }
    lista.forEach(function (s, i) {
      ClicksignVenda.documentosDoSignatario(s, docs).forEach(function (dId) {
        criarReq("requisitos", i, ClicksignVenda.corpoQualificacao(dId, ids[i], s.role));
        Utilities.sleep(CS_PAUSA_REQ_MS);
        ClicksignVenda.autenticacoes(s, cfg, d).forEach(function (auth) {
          criarReq("requisitos", i, ClicksignVenda.corpoAutenticacao(dId, ids[i], auth));
          Utilities.sleep(CS_PAUSA_REQ_MS);
        });
      });
      var semLugar = [];
      assJuntarVistos_(ClicksignVenda.requisitosRubrica(s, docs, rub, i, lista, semLugar), cfg.vistoComoAssinatura).forEach(function (r) {
        criarReq("rubricas", i, ClicksignVenda.corpoRubrica(r.docId, ids[i], r.kind, r.positions));
        Utilities.sleep(CS_PAUSA_REQ_MS);
      });
      semLugar.forEach(function (a) { assLog_("troca enviar " + pid + " " + a); avisos.push("SEM_POSICAO: " + a); });
    });
    assProps_().setProperty(ASS_PAPEIS + envId, JSON.stringify(papeis));
    ids.forEach(function (id, i) { assGuardarReqs_(envId, id, reqs[i], pid); });
  } catch (e) {
    var apagado = trocaApagarRascunho_(envId, pid);
    if (apagado) { st.novoEnvelope = ""; st.rascunhoPronto = false; trocaEstadoGravar_(p.pageId, st); }
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    var f = { ok: false, erro: trocaCota_(e) ? "COTA_GOOGLE_ESGOTADA" : "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe, envelopeId: envId };
    if (envId) f.rascunhoApagado = apagado;
    return f;
  }
  st.rascunhoPronto = true;
  st.sigs = lista.map(function (s, i) { return { id: String(ids[i] || ""), papel: s.papel, nome: ClicksignVenda.nomeMascarado(s.nome) }; });
  st.avisos = avisos.slice(0, 10);
  trocaEstadoGravar_(p.pageId, st);
  return { ok: true, envelopeId: envId };
}

/* para o contratoEstado (só Propriedades e a linha, sem Clicksign): o "Já assinado" e o envelope de termos */
function trocaEstadoTela_(pg, pageId, base) {
  if (base !== "CONDOMINIO") return null;
  var T = trocaEnvTermos_(pg, pageId), out = { colunasTermos: !!T.cols };
  var ja = TermosVenda.jaAssinado(trocaHistLer_(pageId));
  if (ja.length) out.jaAssinado = ja;
  if (T.envId) out.termos = { envelope: true, situacao: T.sit };
  return T.cols || ja.length ? out : null;
}

/* Envio do contrato (assEnviarTravado_): com o envelope de termos ainda aberto não manda outro contrato (os termos sairiam
 * em dobro); com ele terminado, as colunas dos termos são limpas depois do envio (o envelope novo leva os termos). */
function trocaBloqueioEnvio_(pg, pageId) {
  var T = trocaEnvTermos_(pg, pageId);
  if (T.envId && !ClicksignVenda.podeEnviar(T.envId, T.sit))
    return { ok: false, erro: "ENVELOPE_ABERTO", mensagem: "Os termos de confissão estão num envelope próprio ainda aberto. Cancele o envelope dos termos antes de enviar o contrato de novo." };
  return null;
}
function trocaLimparTermos_(pg, pageId) {
  var T = trocaEnvTermos_(pg, pageId);
  if (!T.cols || !T.envId) return;
  try { assGravarTextos_(pageId, assColunasEnvelope_(T.cols, "", "")); assApagarProp_(ASS_HIST + pageId); }
  catch (e) { ctrErro_("troca limpar termos " + String(pageId).slice(0, 8), e); }
}

/* Vigia (AssinaturaVigia.vigiaUma_): a marca da volta curta do envelope de termos — "" sem envelope (nenhuma chamada). */
function trocaVigiaMarca_(pg) {
  var T = trocaEnvTermos_(pg, pg.id);
  if (!T.envId) return null;
  var base = "/envelopes/" + encodeURIComponent(T.envId), guardado = String(prop_(VIGIA_STATUS + T.envId) || "");
  var g = cs_("get", base), visto = g && g.ok ? String(g.status || "") : "", marca = null;
  if (visto) marca = vigiaMarca_(base, visto, guardado.split("|")[0] === visto ? guardado : "");
  return { envId: T.envId, sitAntes: T.sit, marca: marca, igual: !!marca && marca === guardado };
}
