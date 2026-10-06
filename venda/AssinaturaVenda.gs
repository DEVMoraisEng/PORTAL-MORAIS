/* AssinaturaVenda — manda o contrato gerado para a Clicksign e colhe o assinado (entrega 3).
 * Arquivo do projeto PORTAL-VENDA (depois de ContratoVenda, ClicksignVenda, PortalVenda e GerarContrato).
 * Fluxo do envio: lê a casa, confere as faltas do contrato e da assinatura, baixa o ÚLTIMO PDF de
 * CONTRATO GERADO e cria na Clicksign (API v3): envelope → documento → signatários → requisitos
 * (qualificação + autenticação por e-mail) → ativa → notifica. Erro antes de ativar deixa o envelope
 * em rascunho (draft) e devolve o passo que falhou. Rotas e corpos: venda/CLICKSIGN-API.md.
 * Propriedades do script: CLICKSIGN_TOKEN (obrigatória), CLICKSIGN_URL (padrão sandbox),
 * ASSINATURA_TESTEMUNHAS_SPE, ASSINATURA_TESTEMUNHAS_PF, ASSINATURA_REPRESENTANTE (opcional),
 * ASSINATURA_INCLUIR_CORRETOR (opcional). O script grava ASSINATURA_PAPEIS_<envelope> (id do
 * signatário → papel, sem dado pessoal) para a consulta saber quem é quem.
 * Log só com ação, pageId abreviado, passo, código HTTP e id do envelope — nunca token, nome,
 * e-mail, CPF ou o detalhe que a Clicksign devolve (pode repetir dado pessoal). */

var ASS_COL = { ENVELOPE: "ASSINATURA - ENVELOPE ID", SITUACAO: "ASSINATURA - SITUAÇÃO", ASSINADO: "CONTRATO ASSINADO" };
var ASS_TIPOS = {};
ASS_TIPOS[ASS_COL.ENVELOPE] = "rich_text";
ASS_TIPOS[ASS_COL.SITUACAO] = "rich_text";
ASS_TIPOS[ASS_COL.ASSINADO] = "files";
var CS_JSONAPI = "application/vnd.api+json";

function assLog_(msg) { console.log("PORTAL-VENDA assinatura " + msg); }

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
/* Uma chamada; devolve ClicksignVenda.interpretar(...). Exceção de rede vira {ok:false, http:0}. */
function cs_(metodo, caminho, corpo) {
  var opt = { method: metodo, muteHttpExceptions: true, headers: { Authorization: prop_("CLICKSIGN_TOKEN"), Accept: CS_JSONAPI } };
  opt.contentType = CS_JSONAPI;
  if (corpo) opt.payload = JSON.stringify(corpo);
  try {
    var r = UrlFetchApp.fetch(csBase_() + caminho, opt);
    return ClicksignVenda.interpretar(r.getResponseCode(), r.getContentText());
  } catch (e) {
    return { ok: false, http: 0, detalhe: "sem resposta da Clicksign" };
  }
}
function csPasso_(passo, metodo, caminho, corpo) {
  var r = cs_(metodo, caminho, corpo);
  if (!r.ok) { var e = new Error("CLICKSIGN_FALHOU"); e.passo = passo; e.http = r.http; e.detalhe = r.detalhe; throw e; }
  return r;
}

/* ---- enviar ---- */
function assinaturaEnviar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };

  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg);
  var envAtual = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  if (!ClicksignVenda.podeEnviar(envAtual, sitAtual)) {
    assLog_("enviar " + pid + " recusado: envelope aberto");
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

  var pdf = baixarArquivo_({ name: gerado.nome, type: "file", file: { url: gerado.url } });
  if (!pdf || pdf.mime !== "application/pdf") { assLog_("enviar " + pid + " contrato gerado ilegivel"); return { ok: false, erro: "CONTRATO_ILEGIVEL" }; }

  var lista = ClicksignVenda.signatarios(d, config), envId = "", papeis = {};
  try {
    envId = csPasso_("envelope", "post", "/envelopes", ClicksignVenda.corpoEnvelope(ClicksignVenda.nomeEnvelope(f.endereco))).id;
    var base = "/envelopes/" + encodeURIComponent(envId);
    var docId = csPasso_("documento", "post", base + "/documents",
                         ClicksignVenda.corpoDocumento(ClicksignVenda.nomeArquivo(gerado.nome), pdf.base64)).id;
    var ids = lista.map(function (s) {
      var id = csPasso_("signatarios", "post", base + "/signers", ClicksignVenda.corpoSignatario(s)).id;
      papeis[id] = s.papel;
      return id;
    });
    lista.forEach(function (s, i) {
      csPasso_("requisitos", "post", base + "/requirements", ClicksignVenda.corpoQualificacao(docId, ids[i], s.role));
      csPasso_("requisitos", "post", base + "/requirements", ClicksignVenda.corpoAutenticacao(docId, ids[i]));
    });
    PropertiesService.getScriptProperties().setProperty("ASSINATURA_PAPEIS_" + envId, JSON.stringify(papeis));
    csPasso_("ativar", "patch", base, ClicksignVenda.corpoAtivar(envId));
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    assLog_("enviar " + pid + " falhou no passo " + e.passo + " http " + e.http + (envId ? " envelope " + envId + " ficou em rascunho" : ""));
    return { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe, envelopeId: envId };
  }

  var g = {};
  g[cols.ENVELOPE] = envId;
  g[cols.SITUACAO] = ClicksignVenda.SITUACOES.ENVIADO;
  try { assGravarTextos_(p.pageId, g); }
  catch (e) {
    ctrErro_("assinatura enviar " + pid + " envelope " + envId + " ativo mas nao gravado", e);
    return { ok: false, erro: "GRAVACAO_FALHOU", envelopeId: envId };
  }

  var r = { ok: true, situacao: ClicksignVenda.SITUACOES.ENVIADO,
            signatarios: lista.map(function (s) { return { papel: s.papel, assinou: false }; }) };
  var n = cs_("post", "/envelopes/" + encodeURIComponent(envId) + "/notifications", ClicksignVenda.corpoNotificacao());
  if (!n.ok) { assLog_("enviar " + pid + " envelope " + envId + " notificacao falhou http " + n.http); r.aviso = "NOTIFICACAO_FALHOU"; }
  assLog_("enviar " + pid + " ok envelope " + envId + " signatarios " + lista.length);
  return r;
}

/* ---- estado ---- */
function assNomeAssinado_(nomeGerado) {
  var n = String(nomeGerado || "contrato.pdf");
  return /^CONTRATO - /.test(n) ? "CONTRATO ASSINADO - " + n.slice(11) : "ASSINADO - " + n;
}
function assPapeis_(envId) {
  try { return JSON.parse(prop_("ASSINATURA_PAPEIS_" + envId) || "{}") || {}; } catch (e) { return {}; }
}

function assinaturaEstado_(col, p) {
  var pid = String(p.pageId).slice(0, 8);
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg);
  var envId = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  if (!envId) return { ok: true, situacao: "", envelope: false, signatarios: [] };
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };

  var base = "/envelopes/" + encodeURIComponent(envId), env, docs, eventos, signers, sit;
  try {
    env = csPasso_("consultar envelope", "get", base);
    docs = csPasso_("consultar documento", "get", base + "/documents").data || [];
    if (!docs.length) return { ok: false, erro: "CLICKSIGN_ENVELOPE_SEM_DOCUMENTO" };
    eventos = csPasso_("consultar eventos", "get", base + "/documents/" + encodeURIComponent(docs[0].id) + "/events").data || [];
    signers = csPasso_("consultar signatarios", "get", base + "/signers").data || [];
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    assLog_("estado " + pid + " falhou no passo " + e.passo + " http " + e.http);
    return { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe };
  }
  try { sit = ClicksignVenda.situacao(env.status, eventos); }
  catch (e) { assLog_("estado " + pid + " status desconhecido"); return { ok: false, erro: String(e.message) }; }

  var semArquivo = !(ctrValor_(pg.properties[cols.ASSINADO]) || []).length;
  if (sit === ClicksignVenda.SITUACOES.ASSINADO && (sitAtual !== sit || semArquivo)) {
    var link;
    try { link = ClicksignVenda.linkAssinado(docs[0]); }
    catch (e) { assLog_("estado " + pid + " envelope " + envId + " sem link do assinado"); return { ok: false, erro: String(e.message) }; }
    var r = UrlFetchApp.fetch(link, { muteHttpExceptions: true }); /* link pré-assinado: sem o token */
    if (r.getResponseCode() >= 300) { assLog_("estado " + pid + " download do assinado http " + r.getResponseCode()); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    var gerado = ctrArquivoGerado_(pg);
    try {
      anexarArquivo_(p.pageId, cols.ASSINADO, { nome: assNomeAssinado_(gerado && gerado.nome), mime: "application/pdf",
                                                 base64: Utilities.base64Encode(r.getBlob().getBytes()) }, true);
    } catch (e) { ctrErro_("assinatura estado " + pid + " anexo falhou", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    assLog_("estado " + pid + " envelope " + envId + " assinado anexado");
  }
  if (sit !== sitAtual) {
    var g = {}; g[cols.SITUACAO] = sit;
    try { assGravarTextos_(p.pageId, g); }
    catch (e) { ctrErro_("assinatura estado " + pid + " gravacao", e); return { ok: false, erro: "GRAVACAO_FALHOU" }; }
  }
  var papeis = assPapeis_(envId), feitos = ClicksignVenda.assinaram(signers, eventos, env.status);
  return { ok: true, situacao: sit, envelope: true, signatarios: signers.map(function (s) {
    return { papel: papeis[s.id] || "Signatário", assinou: !!feitos[s.id] };
  }) };
}
