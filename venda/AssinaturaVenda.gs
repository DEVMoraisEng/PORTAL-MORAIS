/* AssinaturaVenda — manda o contrato gerado para a Clicksign e colhe o assinado (entrega 3).
 * Arquivo do projeto PORTAL-VENDA (depois de ContratoVenda, ClicksignVenda, PortalVenda e GerarContrato).
 * Fluxo do envio (sob LockService, um envio por vez): lê a casa, confere as faltas do contrato e da
 * assinatura e o carimbo do ÚLTIMO PDF de CONTRATO GERADO, cria na Clicksign (API v3): envelope (e anota
 * na casa na hora: ENVELOPE ID + RASCUNHO) → documento → signatários → requisitos (qualificação +
 * autenticação por e-mail) → ativa → grava ENVIADO → notifica. Erro antes de ativar APAGA o rascunho
 * (DELETE) e limpa as duas colunas; se não der para apagar, a casa fica em RASCUNHO. Rotas e corpos:
 * venda/CLICKSIGN-API.md.
 * Propriedades do script: CLICKSIGN_TOKEN (obrigatória), CLICKSIGN_URL (padrão sandbox),
 * ASSINATURA_TESTEMUNHAS_SPE, ASSINATURA_TESTEMUNHAS_PF, ASSINATURA_REPRESENTANTE (opcional),
 * ASSINATURA_INCLUIR_CORRETOR (opcional). O script grava ASSINATURA_PAPEIS_<envelope> (id do
 * signatário → papel, sem dado pessoal; apagada quando a situação fica final) e, só se o Notion
 * não gravar depois de ativar, ASSINATURA_PENDENTE_<página> (id do envelope; apagada quando grava).
 * Log só com ação, pageId abreviado, login de quem enviou, passo, código HTTP e id do envelope —
 * nunca token, nome, e-mail, CPF, URL ou o detalhe que a Clicksign devolve. */

var ASS_COL = { ENVELOPE: "ASSINATURA - ENVELOPE ID", SITUACAO: "ASSINATURA - SITUAÇÃO", ASSINADO: "CONTRATO ASSINADO" };
var ASS_TIPOS = {};
ASS_TIPOS[ASS_COL.ENVELOPE] = "rich_text";
ASS_TIPOS[ASS_COL.SITUACAO] = "rich_text";
ASS_TIPOS[ASS_COL.ASSINADO] = "files";
var CS_JSONAPI = "application/vnd.api+json";
var ASS_PENDENTE = "ASSINATURA_PENDENTE_";
var ASS_PAPEIS = "ASSINATURA_PAPEIS_";

function assLog_(msg) { console.log("PORTAL-VENDA assinatura " + msg); }
function assProps_() { return PropertiesService.getScriptProperties(); }
function assApagarProp_(nome) { try { assProps_().deleteProperty(nome); } catch (e) { assLog_("propriedade nao apagada"); } }

/* Nomes reais das 3 colunas da assinatura na página (tolerante a acento/caixa/espaço). */
function assColunas_(pg) {
  var porChave = {}, faltando = [], errado = [], r = {};
  for (var n in pg.properties) porChave[RegrasVenda.chave(n)] = n;
  for (var k in ASS_COL) {
    var nome = ASS_COL[k], real = porChave[RegrasVenda.chave(nome)];
    if (!real) { faltando.push(nome); continue; }
    if (pg.properties[real].type !== ASS_TIPOS[nome]) errado.push(nome);
    r[k] = real;
  }
  if (faltando.length) throw new Error("COLUNA_FALTANDO: " + faltando.join(", "));
  if (errado.length) throw new Error("TIPO_DE_COLUNA_ERRADO: " + errado.join(", "));
  return r;
}
function assTexto_(pg, real) { return ctrTxt_(ctrValor_(pg.properties[real])).trim(); }
function assGravarTextos_(pageId, porReal) {
  var props = {};
  for (var real in porReal) props[real] = propNotion_("rich_text", porReal[real]);
  notion_("PATCH", "/pages/" + pageId, { properties: props });
}
function assColunasEnvelope_(cols, envId, sit) {
  var g = {};
  g[cols.ENVELOPE] = envId;
  g[cols.SITUACAO] = sit;
  return g;
}

function assConfig_() {
  return ClicksignVenda.montarConfig({
    ASSINATURA_TESTEMUNHAS_SPE: prop_("ASSINATURA_TESTEMUNHAS_SPE"), ASSINATURA_TESTEMUNHAS_PF: prop_("ASSINATURA_TESTEMUNHAS_PF"),
    ASSINATURA_REPRESENTANTE: prop_("ASSINATURA_REPRESENTANTE"), ASSINATURA_INCLUIR_CORRETOR: prop_("ASSINATURA_INCLUIR_CORRETOR")
  });
}

/* ---- Clicksign ---- */
function csBase_() {
  var u = String(prop_("CLICKSIGN_URL") || "https://sandbox.clicksign.com").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\/\s]+$/.test(u) ? u + "/api/v3" : "";
}
/* Uma chamada; devolve ClicksignVenda.interpretar(...) com o código HTTP. Exceção de rede vira {ok:false, http:0}. */
function cs_(metodo, caminho, corpo) {
  var opt = { method: metodo, muteHttpExceptions: true, headers: { Authorization: prop_("CLICKSIGN_TOKEN"), Accept: CS_JSONAPI } };
  opt.contentType = CS_JSONAPI;
  if (corpo) opt.payload = JSON.stringify(corpo);
  try {
    var r = UrlFetchApp.fetch(csBase_() + caminho, opt);
    var i = ClicksignVenda.interpretar(r.getResponseCode(), r.getContentText());
    i.http = r.getResponseCode();
    return i;
  } catch (e) {
    return { ok: false, http: 0, detalhe: "sem resposta da Clicksign" };
  }
}
function assFalha_(passo, r) {
  var e = new Error("CLICKSIGN_FALHOU");
  e.passo = passo; e.http = r.http; e.detalhe = r.detalhe;
  return e;
}
/* precisaId: o passo só serve com o id do que foi criado (2xx sem corpo não basta). */
function csPasso_(passo, metodo, caminho, corpo, precisaId) {
  var r = cs_(metodo, caminho, corpo);
  if (r.ok && precisaId && !r.id) r = { ok: false, http: r.http, detalhe: "resposta sem id" };
  if (!r.ok) throw assFalha_(passo, r);
  return r;
}
/* Ativa. Sem resposta ou 5xx: consulta o envelope — running segue; draft é falha antes de ativar;
 * consulta que também falha deixa a dúvida (e.incerto: não apagar, pode ter ativado). */
function assAtivar_(base, envId) {
  var r = cs_("patch", base, ClicksignVenda.corpoAtivar(envId));
  if (r.ok) return;
  if (r.http === 0 || r.http >= 500) {
    var c = cs_("get", base);
    if (c.ok && c.status === "running") return;
    if (!(c.ok && c.status === "draft")) { var e = assFalha_("ativar", r); e.incerto = true; throw e; }
  }
  throw assFalha_("ativar", r);
}
/* Apaga o rascunho e limpa as duas colunas. true = apagou (pode enviar de novo). */
function assApagarRascunho_(base, pid, cols, pageId) {
  var d = cs_("delete", base);
  if (!d.ok) { assLog_("enviar " + pid + " rascunho nao apagado http " + d.http); return false; }
  try { assGravarTextos_(pageId, assColunasEnvelope_(cols, "", "")); }
  catch (e) { ctrErro_("assinatura enviar " + pid + " colunas do rascunho nao limpas", e); }
  return true;
}
/* 3 tentativas (a primeira + 2). */
function assGravarComRetentativa_(pageId, porReal, pid) {
  for (var i = 0; i < 3; i++) {
    try { assGravarTextos_(pageId, porReal); return true; }
    catch (e) {
      ctrErro_("assinatura " + pid + " gravacao tentativa " + (i + 1), e);
      if (i < 2) Utilities.sleep(1000);
    }
  }
  return false;
}

/* ---- enviar ---- */
function assinaturaEnviar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };
  /* um envio por vez: ler → conferir → criar → gravar não pode correr em paralelo (dois cliques, duas abas) */
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) { assLog_("enviar " + pid + " ocupado"); return { ok: false, erro: "ASSINATURA_OCUPADA" }; }
  var r;
  try { r = assEnviarTravado_(col, p, pid); }
  finally { trava.releaseLock(); }
  assLog_("enviar " + pid + " por " + String((sess && sess.u) || "?") + ": " + (r.ok ? "ok" : r.erro));
  return r;
}

function assEnviarTravado_(col, p, pid) {
  var S = ClicksignVenda.SITUACOES;
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg);
  var envAtual = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  /* envelope ativo que o Notion não gravou: a chave pendente vale mais que as colunas */
  var pendente = prop_(ASS_PENDENTE + p.pageId);
  if (pendente || !ClicksignVenda.podeEnviar(envAtual, sitAtual)) {
    assLog_("enviar " + pid + " recusado: envelope aberto" + (pendente ? " (pendente " + pendente + ")" : ""));
    return { ok: false, erro: "ENVELOPE_ABERTO", situacao: sitAtual };
  }
  var gerado = ctrArquivoGerado_(pg);
  if (!gerado || !gerado.url) return { ok: false, erro: "SEM_CONTRATO_GERADO" };
  if (!prop_("DB_VENDEDORES") || !prop_("DB_LOTEAMENTOS") || !prop_("DB_CORRETORES") || !prop_("DB_DOCUMENTOS")) return { ok: false, erro: "CADASTRO_NAO_CONFIGURADO" };

  /* mesmos dados do contrato (GerarContrato): o que foi gerado é o que se confere */
  var f = ctrFontes_(col, p.pageId);
  if (f.obraAmbigua) return { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra ambígua em DOCUMENTOS (endereço repetido)"] };
  if (f.duplicados) return { ok: false, erro: "FALTAM_DADOS", faltas: f.duplicados };
  if (f.obraNaoEncontrada) return { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra da casa não encontrada em DOCUMENTOS (endereço)"] };
  var d = ContratoVenda.montarDadosContrato(f.fontes), config = assConfig_();
  var faltas = config.invalidas.map(function (n) { return "Propriedade " + n + ": JSON inválido"; })
    .concat(ContratoVenda.faltasContrato(d), ClicksignVenda.faltasAssinatura(d, config));
  if (faltas.length) {
    assLog_("enviar " + pid + " faltas " + faltas.length);
    return { ok: false, erro: "FALTAM_DADOS", faltas: faltas };
  }
  /* o PDF tem de ser destes dados: carimbo no nome (GerarContrato) igual ao recalculado agora */
  var carimbo = ctrCarimboDoNome_(gerado.nome);
  if (!carimbo || carimbo !== ctrCarimbo_(d)) {
    assLog_("enviar " + pid + (carimbo ? " carimbo diferente" : " pdf sem carimbo"));
    return { ok: false, erro: "CONTRATO_DESATUALIZADO" };
  }

  var pdf = null;
  try { pdf = baixarArquivo_({ name: gerado.nome, type: "file", file: { url: gerado.url } }); }
  catch (e) { assLog_("enviar " + pid + " contrato gerado sem resposta"); pdf = null; }
  if (!pdf || pdf.mime !== "application/pdf") { assLog_("enviar " + pid + " contrato gerado ilegivel"); return { ok: false, erro: "CONTRATO_ILEGIVEL" }; }

  var lista = ClicksignVenda.signatarios(d, config), envId = "", base = "", papeis = {};
  try {
    envId = csPasso_("envelope", "post", "/envelopes", ClicksignVenda.corpoEnvelope(ClicksignVenda.nomeEnvelope(f.endereco)), true).id;
    base = "/envelopes/" + encodeURIComponent(envId);
    /* anota já: qualquer leitura seguinte vê envelope aberto (RASCUNHO conta como aberto) */
    try { assGravarTextos_(p.pageId, assColunasEnvelope_(cols, envId, S.RASCUNHO)); }
    catch (e) { ctrErro_("assinatura enviar " + pid + " rascunho nao anotado", e); throw new Error("RASCUNHO_NAO_GRAVADO"); }
    var docId = csPasso_("documento", "post", base + "/documents",
                         ClicksignVenda.corpoDocumento(ClicksignVenda.nomeArquivo(gerado.nome), pdf.base64), true).id;
    var ids = lista.map(function (s) {
      var id = csPasso_("signatarios", "post", base + "/signers", ClicksignVenda.corpoSignatario(s), true).id;
      papeis[id] = s.papel;
      return id;
    });
    lista.forEach(function (s, i) {
      csPasso_("requisitos", "post", base + "/requirements", ClicksignVenda.corpoQualificacao(docId, ids[i], s.role));
      csPasso_("requisitos", "post", base + "/requirements", ClicksignVenda.corpoAutenticacao(docId, ids[i]));
    });
    assProps_().setProperty(ASS_PAPEIS + envId, JSON.stringify(papeis));
    assAtivar_(base, envId);
  } catch (e) {
    if (e.incerto) {
      /* pode ter ativado: não apaga nada; a casa fica em RASCUNHO e o Atualizar situação esclarece */
      assLog_("enviar " + pid + " ativar sem confirmacao http " + e.http + " envelope " + envId + " ficou em rascunho");
      return { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe, envelopeId: envId,
               rascunhoApagado: false, incerto: true };
    }
    var apagado = envId ? assApagarRascunho_(base, pid, cols, p.pageId) : false;
    if (envId) assApagarProp_(ASS_PAPEIS + envId);
    if (e.message === "RASCUNHO_NAO_GRAVADO") return { ok: false, erro: "GRAVACAO_FALHOU", rascunhoApagado: apagado };
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    assLog_("enviar " + pid + " falhou no passo " + e.passo + " http " + e.http +
            (envId ? " envelope " + envId + (apagado ? " rascunho apagado" : " ficou em rascunho") : ""));
    var falhou = { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe, envelopeId: envId };
    if (envId) falhou.rascunhoApagado = apagado;
    return falhou;
  }

  /* ativo: daqui em diante nada se desfaz */
  var gravou = assGravarComRetentativa_(p.pageId, assColunasEnvelope_(cols, envId, S.ENVIADO), pid);
  if (!gravou) {
    assProps_().setProperty(ASS_PENDENTE + p.pageId, envId);
    assLog_("enviar " + pid + " envelope " + envId + " ativo mas nao gravado: pendente guardado");
  }
  var n = cs_("post", base + "/notifications", ClicksignVenda.corpoNotificacao());
  if (!n.ok) assLog_("enviar " + pid + " envelope " + envId + " notificacao falhou http " + n.http);
  if (!gravou) {
    var rg = { ok: false, erro: "GRAVACAO_FALHOU", envelopeId: envId };
    if (!n.ok) rg.aviso = "NOTIFICACAO_FALHOU";
    return rg;
  }
  var r = { ok: true, situacao: S.ENVIADO,
            signatarios: lista.map(function (s) { return { papel: s.papel, assinou: false }; }) };
  if (!n.ok) r.aviso = "NOTIFICACAO_FALHOU";
  assLog_("enviar " + pid + " ok envelope " + envId + " signatarios " + lista.length);
  return r;
}

/* ---- estado ---- */
function assNomeAssinado_(nomeGerado) {
  var n = String(nomeGerado || "contrato.pdf").replace(/ \[#[0-9a-f]{8}\](\.pdf)$/i, "$1");
  return /^CONTRATO - /.test(n) ? "CONTRATO ASSINADO - " + n.slice(11) : "ASSINADO - " + n;
}
function assPapeis_(envId) {
  try { return JSON.parse(prop_(ASS_PAPEIS + envId) || "{}") || {}; } catch (e) { return {}; }
}

function assinaturaEstado_(col, p) {
  var pid = String(p.pageId).slice(0, 8), S = ClicksignVenda.SITUACOES;
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg);
  var envId = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  /* envelope ativo que o envio não conseguiu gravar: usa o id guardado e grava agora */
  var pendente = prop_(ASS_PENDENTE + p.pageId);
  if (pendente) envId = pendente;
  if (!envId) return { ok: true, situacao: "", envelope: false, signatarios: [] };
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };

  function gravar(sit) {
    if (sit === sitAtual && !pendente) return true;
    var g = pendente ? assColunasEnvelope_(cols, envId, sit) : {};
    g[cols.SITUACAO] = sit;
    try { assGravarTextos_(p.pageId, g); }
    catch (e) { ctrErro_("assinatura estado " + pid + " gravacao", e); return false; }
    if (pendente) assApagarProp_(ASS_PENDENTE + p.pageId);
    return true;
  }

  var base = "/envelopes/" + encodeURIComponent(envId), env, docs, eventos, signers, sit;
  try {
    env = csPasso_("consultar envelope", "get", base);
    if (env.status === "draft") {
      /* rascunho (envio que falhou e não apagou): não tem o que colher */
      if (!gravar(S.RASCUNHO)) return { ok: false, erro: "GRAVACAO_FALHOU" };
      return { ok: true, situacao: S.RASCUNHO, envelope: true, signatarios: [] };
    }
    docs = csPasso_("consultar documento", "get", base + "/documents").data || [];
    if (!docs.length) return { ok: false, erro: "CLICKSIGN_ENVELOPE_SEM_DOCUMENTO" };
    eventos = csPasso_("consultar eventos", "get", base + "/documents/" + encodeURIComponent(docs[0].id) + "/events").data || [];
    signers = csPasso_("consultar signatarios", "get", base + "/signers").data || [];
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    /* rascunho apagado na Clicksign (à mão): a casa volta a "sem envelope" */
    if (e.passo === "consultar envelope" && e.http === 404 && !pendente && sitAtual.toUpperCase() === S.RASCUNHO) {
      try { assGravarTextos_(p.pageId, assColunasEnvelope_(cols, "", "")); }
      catch (e2) { ctrErro_("assinatura estado " + pid + " limpeza do rascunho", e2); return { ok: false, erro: "GRAVACAO_FALHOU" }; }
      assApagarProp_(ASS_PAPEIS + envId);
      assLog_("estado " + pid + " rascunho " + envId + " nao existe mais: colunas limpas");
      return { ok: true, situacao: "", envelope: false, signatarios: [] };
    }
    assLog_("estado " + pid + " falhou no passo " + e.passo + " http " + e.http);
    return { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe };
  }
  try { sit = ClicksignVenda.situacao(env.status, eventos); }
  catch (e) { assLog_("estado " + pid + " status desconhecido"); return { ok: false, erro: String(e.message) }; }

  var semArquivo = !(ctrValor_(pg.properties[cols.ASSINADO]) || []).length;
  if (sit === S.ASSINADO && (sitAtual !== sit || semArquivo)) {
    var link;
    try { link = ClicksignVenda.linkAssinado(docs[0]); }
    catch (e) { assLog_("estado " + pid + " envelope " + envId + " sem link do assinado"); return { ok: false, erro: String(e.message) }; }
    var r;
    try { r = UrlFetchApp.fetch(link, { muteHttpExceptions: true }); } /* link pré-assinado: sem o token */
    catch (e) { assLog_("estado " + pid + " download do assinado sem resposta"); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    if (r.getResponseCode() >= 300) { assLog_("estado " + pid + " download do assinado http " + r.getResponseCode()); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    var gerado = ctrArquivoGerado_(pg);
    try {
      anexarArquivo_(p.pageId, cols.ASSINADO, { nome: assNomeAssinado_(gerado && gerado.nome), mime: "application/pdf",
                                                 base64: Utilities.base64Encode(r.getBlob().getBytes()) }, true);
    } catch (e) { ctrErro_("assinatura estado " + pid + " anexo falhou", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    assLog_("estado " + pid + " envelope " + envId + " assinado anexado");
  }
  if (!gravar(sit)) return { ok: false, erro: "GRAVACAO_FALHOU" };

  var papeis = assPapeis_(envId), feitos = ClicksignVenda.assinaram(signers, eventos);
  if (ClicksignVenda.FINAIS.indexOf(sit) >= 0) assApagarProp_(ASS_PAPEIS + envId);
  var resp = { ok: true, situacao: sit, envelope: true, signatarios: signers.map(function (s) {
    return { papel: papeis[s.id] || "Signatário", assinou: !!feitos[s.id] };
  }) };
  /* closed sem o "sign" de alguém: não inventa assinatura; o PDF é o que a Clicksign entregou */
  if (env.status === "closed" && signers.some(function (s) { return !feitos[s.id]; })) {
    assLog_("estado " + pid + " envelope " + envId + " assinaturas incompletas");
    resp.aviso = "ASSINATURAS_INCOMPLETAS";
  }
  return resp;
}
