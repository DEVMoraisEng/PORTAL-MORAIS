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
 * não gravar depois de ativar, ASSINATURA_PENDENTE_<página> (id do envelope; apagada quando grava), e
 * ASSINATURA_REENVIO_<envelope> (hora do último "Reenviar link"; limite de 1 a cada 10 min).
 * Log só com ação, pageId abreviado, login de quem enviou, passo, código HTTP e id do envelope —
 * nunca token, nome, e-mail, CPF, URL ou o detalhe que a Clicksign devolve. */

var ASS_COL = { ENVELOPE: "ASSINATURA - ENVELOPE ID", SITUACAO: "ASSINATURA - SITUAÇÃO", ASSINADO: "CONTRATO ASSINADO" };
var ASS_TIPOS = {};
ASS_TIPOS[ASS_COL.ENVELOPE] = "rich_text";
ASS_TIPOS[ASS_COL.SITUACAO] = "rich_text";
ASS_TIPOS[ASS_COL.ASSINADO] = "files";
var CS_JSONAPI = "application/vnd.api+json";
var ASS_PENDENTE = "ASSINATURA_PENDENTE_";
/* 01/11 (correção 3): contrato ASSINADO esperando a Clicksign gerar o arquivo — hora (ms) em que começou a esperar.
   A vigia relê só estes (até 24 h) e a própria leitura que guarda o PDF apaga a Propriedade. */
var ASS_AGUARDANDO = "ASS_AGUARDANDO_";
var VIGIA_ANDAMENTO = "ASSINOU E ARMAZENOU CONTRATO";   /* coluna do Andamento marcada por assPosAssinatura_ */
var ASS_PAPEIS = "ASSINATURA_PAPEIS_";
var ASS_VIGIA_STATUS = "VIGIA_STATUS_";   /* + id do envelope = último status visto pela vigia (AssinaturaVigia.gs); apagado quando o envelope termina ou é descartado */
var ASS_REENVIO = "ASSINATURA_REENVIO_";   /* + id do envelope = hora (ms) do último reenvio do aviso */

/* 27/10/2026: o mesmo fluxo assina o CONTRATO (padrão) e o TERMO DE PRÉ-RESERVA (p.doc = "PRE_RESERVA").
 * Cada documento tem as suas 3 colunas na linha e a sua chave de pendente (ASSINATURA_PENDENTE_PR_<página>). */
function assDoc_(p) {
  if (p && p.doc === "PRE_RESERVA") {
    var C = PreReservaVenda.COL;
    return { pre: true, chave: "PR_", cols: { ENVELOPE: C.ENVELOPE, SITUACAO: C.SITUACAO, ASSINADO: C.ASSINADO },
             gerado: prArquivoGerado_, semGerado: "SEM_TERMO_GERADO" };
  }
  return { pre: false, chave: "", cols: ASS_COL, gerado: ctrArquivoGerado_, semGerado: "SEM_CONTRATO_GERADO" };
}

function assLog_(msg) { console.log("PORTAL-VENDA assinatura " + msg); }
function assProps_() { return PropertiesService.getScriptProperties(); }
function assApagarProp_(nome) { try { assProps_().deleteProperty(nome); } catch (e) { assLog_("propriedade nao apagada"); } }

/* Nomes reais das 3 colunas da assinatura na página (tolerante a acento/caixa/espaço). */
function assColunas_(pg, doc) {
  var porChave = {}, faltando = [], errado = [], r = {}, cols = (doc || assDoc_()).cols;
  for (var n in pg.properties) porChave[RegrasVenda.chave(n)] = n;
  for (var k in cols) {
    var nome = cols[k], real = porChave[RegrasVenda.chave(nome)];
    if (!real) { faltando.push(nome); continue; }
    if (pg.properties[real].type !== (k === "ASSINADO" ? "files" : "rich_text")) errado.push(nome);
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

/* pageId (opcional): traz a escolha de testemunhas gravada para essa venda (TESTEMUNHAS_<pageId>) */
var ASS_TESTEMUNHAS = "TESTEMUNHAS_";
function assConfig_(pageId) {
  return ClicksignVenda.montarConfig({
    ASSINATURA_TESTEMUNHAS_SPE: prop_("ASSINATURA_TESTEMUNHAS_SPE"), ASSINATURA_TESTEMUNHAS_PF: prop_("ASSINATURA_TESTEMUNHAS_PF"),
    ASSINATURA_TESTEMUNHAS_OPCOES: prop_("ASSINATURA_TESTEMUNHAS_OPCOES"),
    TESTEMUNHAS_ESCOLHIDAS: pageId ? prop_(ASS_TESTEMUNHAS + pageId) : "",
    ASSINATURA_REPRESENTANTE: prop_("ASSINATURA_REPRESENTANTE"), ASSINATURA_INCLUIR_CORRETOR: prop_("ASSINATURA_INCLUIR_CORRETOR"),
    /* 30/10: rubricas e documentos do comprador */
    RUBRICAS_AJUSTE: prop_("RUBRICAS_AJUSTE"), MEMORIAL_POSICAO: prop_("MEMORIAL_POSICAO"), PROJETO_POSICOES: prop_("PROJETO_POSICOES"),
    ASSINATURA_SEM_RUBRICAS: prop_("ASSINATURA_SEM_RUBRICAS"), ASSINATURA_LINHAS: prop_("ASSINATURA_LINHAS"),
    RUBRICAS_VISTO_COMO_ASSINATURA: prop_("RUBRICAS_VISTO_COMO_ASSINATURA"),   /* unidade 22 (01/11) */
    CLICKSIGN_SELFIE: prop_("CLICKSIGN_SELFIE")   /* 01/11 (plano 23 C) */
  });
}

/* Envelope já aberto (ou envio em andamento) do contrato (doc omitido) ou do termo (doc = assDoc_({doc:"PRE_RESERVA"})):
 * a partir daí quem assina não muda mais. Usado por escolherTestemunhas_ e salvarConjugePreReserva_. */
function assEnvelopeAberto_(pg, pageId, doc) {
  doc = doc || assDoc_();
  var cols = assColunas_(pg, doc);
  return !!prop_(ASS_PENDENTE + doc.chave + pageId) ||
    !ClicksignVenda.podeEnviar(assTexto_(pg, cols.ENVELOPE), assTexto_(pg, cols.SITUACAO));
}

/* Entrega 10: grava as 2 testemunhas desta venda (ids da lista da tela). ids vazio = volta ao par padrão.
 * Com a assinatura já enviada (envelope aberto) não muda mais. */
function escolherTestemunhas_(col, sess, p) {
  var pg = ctrLerPaginaVenda_(p.pageId);
  if (assEnvelopeAberto_(pg, p.pageId)) return { ok: false, erro: "ENVELOPE_ABERTO" };
  var ids = Array.isArray(p.ids) ? p.ids.map(function (x) { return String(x || "").trim(); }) : [];
  if (!ids.length || (!ids[0] && !ids[1])) {
    assApagarProp_(ASS_TESTEMUNHAS + p.pageId);
    return { ok: true, testemunhas: ClicksignVenda.testemunhasParaTela(assConfig_(p.pageId)) };
  }
  if (!ClicksignVenda.escolhidas(assConfig_(), ids)) return { ok: false, erro: "TESTEMUNHAS_INVALIDAS" };
  assProps_().setProperty(ASS_TESTEMUNHAS + p.pageId, JSON.stringify(ids));
  assLog_("testemunhas " + String(p.pageId).slice(0, 8) + " escolhidas");
  return { ok: true, testemunhas: ClicksignVenda.testemunhasParaTela(assConfig_(p.pageId)) };
}

/* ---- Clicksign ---- */
function csBase_() {
  var u = String(prop_("CLICKSIGN_URL") || "https://sandbox.clicksign.com").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\/\s]+$/.test(u) ? u + "/api/v3" : "";
}
/* 429 (limite): repete em qualquer método. 503 (não processou): repete só em GET/PATCH/DELETE; POST nunca,
 * para não duplicar documento/signatário. Outros códigos e exceção de rede não repetem.
 * Limites: 6 tentativas por chamada; tempo decorrido (relógio) + próxima espera <= 180 s; e o mesmo teto
 * de 180 s somado numa execução (o Apps Script morre aos 6 min; csGastoTotal_ é zerado em assinaturaEnviar_). */
var CS_ESPERA_MAX_MS = 180000;
var CS_PAUSA_REQ_MS = 250;
var CS_TENTATIVAS_MAX = 6;
var csGastoTotal_ = 0;
function csRetryAfterMs_(r) {
  try {
    var h = (typeof r.getAllHeaders === "function") ? r.getAllHeaders() : null;
    if (!h) return 0;
    for (var k in h) {
      if (String(k).toLowerCase() !== "retry-after") continue;
      var t = String(h[k]).trim();
      if (!/^\d+(\.\d+)?$/.test(t)) return 0;
      var n = Number(t);
      return n > 0 ? Math.round(n * 1000) : 0;
    }
  } catch (e) { /* sem cabeçalho legível: espera crescente */ }
  return 0;
}
/* Uma chamada; devolve ClicksignVenda.interpretar(...) com o código HTTP. Exceção de rede vira {ok:false, http:0}. */
function cs_(metodo, caminho, corpo) {
  var opt = { method: metodo, muteHttpExceptions: true, headers: { Authorization: prop_("CLICKSIGN_TOKEN"), Accept: CS_JSONAPI } };
  opt.contentType = CS_JSONAPI;
  if (corpo) opt.payload = JSON.stringify(corpo);
  var idempotente = /^(get|patch|delete)$/i.test(String(metodo));
  var inicio = Date.now(), tentativa = 0;
  while (true) {
    var r;
    try {
      r = UrlFetchApp.fetch(csBase_() + caminho, opt);
    } catch (e) {
      return { ok: false, http: 0, detalhe: "sem resposta da Clicksign" };
    }
    tentativa++;
    var code = r.getResponseCode();
    if ((code === 429 || (code === 503 && idempotente)) && tentativa < CS_TENTATIVAS_MAX) {
      var espera = Math.max(csRetryAfterMs_(r), Math.min(2000 * Math.pow(2, tentativa - 1), 60000));
      if ((Date.now() - inicio) + espera <= CS_ESPERA_MAX_MS && csGastoTotal_ + espera <= CS_ESPERA_MAX_MS) {
        Utilities.sleep(espera); csGastoTotal_ += espera;
        continue;
      }
    }
    var i = ClicksignVenda.interpretar(code, r.getContentText());
    i.http = code;
    return i;
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
/* Ativa. Se o PATCH não for ok: consulta o envelope — running segue; draft é falha antes de ativar;
 * consulta que também falha deixa a dúvida (e.incerto: não apagar, pode ter ativado). */
function assAtivar_(base, envId) {
  var r = cs_("patch", base, ClicksignVenda.corpoAtivar(envId));
  if (r.ok) return;
  /* qualquer falha do PATCH final (inclusive 4xx depois de um 503 repetido) pode vir de um envelope que ativou:
   * consulta; running = ok; draft = falha comum; sem confirmar = incerto (nunca apaga) */
  var c = cs_("get", base);
  if (c.ok && c.status === "running") return;
  if (!(c.ok && c.status === "draft")) { var e = assFalha_("ativar", r); e.incerto = true; throw e; }
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
  csGastoTotal_ = 0;
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
  var doc = assDoc_(p);
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, doc);
  var envAtual = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  /* envelope ativo que o Notion não gravou: a chave pendente vale mais que as colunas */
  var pendente = prop_(ASS_PENDENTE + doc.chave + p.pageId);
  if (pendente || !ClicksignVenda.podeEnviar(envAtual, sitAtual)) {
    assLog_("enviar " + pid + " recusado: envelope aberto" + (pendente ? " (pendente " + pendente + ")" : ""));
    return { ok: false, erro: "ENVELOPE_ABERTO", situacao: sitAtual };
  }
  var gerado = doc.gerado(pg);
  if (!gerado || !gerado.url) return { ok: false, erro: doc.semGerado };
  if (!prop_("DB_VENDEDORES") || !prop_("DB_LOTEAMENTOS") || !prop_("DB_CORRETORES") || !prop_("DB_DOCUMENTOS")) return { ok: false, erro: "CADASTRO_NAO_CONFIGURADO" };

  if (doc.pre) return assEnviarTermo_(col, p, pid, cols, doc, gerado);
  /* mesmos dados do contrato (GerarContrato): o que foi gerado é o que se confere */
  var f = ctrFontes_(col, p.pageId);
  if (f.condominioErro) return { ok: false, erro: "FALTAM_DADOS", faltas: [f.condominioErro] };
  if (f.obraAmbigua) return { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra ambígua em DOCUMENTOS (endereço repetido)"] };
  if (f.duplicados) return { ok: false, erro: "FALTAM_DADOS", faltas: f.duplicados };
  if (f.obraNaoEncontrada) return { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra da casa não encontrada em DOCUMENTOS (endereço)"] };
  var d = ContratoVenda.montarDadosContrato(f.fontes), config = assConfig_(p.pageId);
  /* 28/10: com os termos de confissão ligados, eles vão no MESMO envelope e os fiadores assinam só eles */
  var fiadoresAssinam = ConfissaoVenda.fiadoresAssinam(d, cfdLigado_());
  var termos = fiadoresAssinam ? ConfissaoVenda.quais(d) : [];
  if (fiadoresAssinam) config.comFiadores = true;
  var faltas = config.invalidas.map(function (n) { return "Propriedade " + n + ": JSON inválido"; })
    .concat(ContratoVenda.faltasContrato(d), termos.length ? ConfissaoVenda.faltas(d) : [], ClicksignVenda.faltasAssinatura(d, config));
  if (faltas.length) {
    assLog_("enviar " + pid + " faltas " + faltas.length);
    return { ok: false, erro: "FALTAM_DADOS", faltas: faltas, corrigir: assCorrigir_(faltas) };
  }
  /* o PDF tem de ser destes dados: carimbo no nome (GerarContrato) igual ao recalculado agora */
  var carimbo = ctrCarimboDoNome_(gerado.nome);
  if (!ctrCarimboConfere_(carimbo, d, p.pageId)) {   /* 01/11 (plano 23 B): modelo migrado leva as testemunhas no carimbo */
    assLog_("enviar " + pid + (carimbo ? " carimbo diferente" : " pdf sem carimbo"));
    return { ok: false, erro: "CONTRATO_DESATUALIZADO" };
  }

  /* os termos têm de ter saído junto com ESTE contrato (mesmo carimbo no nome) */
  var extras = [];
  for (var i = 0; i < termos.length; i++) {
    var tg = cfdGerado_(pg, termos[i]);
    if (!tg || ctrCarimboDoNome_(tg.nome) !== carimbo) {
      assLog_("enviar " + pid + " termo de confissao " + termos[i] + (tg ? " de outro carimbo" : " nao gerado"));
      return { ok: false, erro: "CONFISSAO_DESATUALIZADA" };
    }
    extras.push(tg);
  }
  var nomeCs = ClicksignVenda.nomePadrao(f.endereco, f.casa, d.comprador1 && d.comprador1.nome);

  /* 30/10: rubricas do comprador — as posições vêm da tela (RubricasVenda, lidas NESTE PDF) e são conferidas aqui.
     Só no contrato do condomínio (os modelos de casa de rua não têm os campos "ASSINATURA: ____"). */
  var rub = null;
  if (d.condominio && !config.semRubricas) {
    var vr = ClicksignVenda.validarRubricas(p.rubricas, gerado.nome, { linhas: config.linhas });
    if (!vr.ok) { assLog_("enviar " + pid + " rubricas: " + vr.erro); return { ok: false, erro: vr.erro }; }
    rub = { campos: vr.campos, valores: vr.valores, memorial: null, projeto: [], tamanhos: {}, avisos: assAvisosDaTela_(p.rubricas),
            /* 01/11 (plano 23 B): assinatura em cima da linha de cada pessoa — só com ASSINATURA_LINHAS=1 (correção 1) */
            linhas: config.linhas ? vr.linhas : [], termos: config.linhas ? vr.termos : {} };
  }
  /* memorial descritivo e projeto aprovado do condomínio (só do comprador), ligados pelas Propriedades */
  var ad = d.condominio ? assDocsDoComprador_(d, pid, nomeCs) : { docs: [] };
  if (ad.resp) return ad.resp;
  if (rub) ad.docs.forEach(function (x) {
    if (x.tipo === ClicksignVenda.DOC.MEMORIAL) {
      rub.memorial = ClicksignVenda.posicaoMemorial(x.paginas, config.memorialPosicao);
      rub.memorialVendedor = ClicksignVenda.posicaoMemorialVendedor(rub.memorial, config.memorialPosicao);
      /* dono 01/11/2026: memorial migrado — uma linha por pessoa, lida na tela (o ponto antigo não serve mais) */
      if (x.migrado) rub.memorialLinhas = config.linhas ? (vr.memorial || []) : [];
    }
    if (x.tipo === ClicksignVenda.DOC.PROJETO) rub.projeto = ClicksignVenda.posicoesProjeto(config.projetoPosicoes);
    /* revisão 01/11: tamanho real das páginas (MediaBox) — sem ele, o padrão (memorial Carta, projeto A1/A2) */
    if (x.tamanhos) rub.tamanhos[x.tipo] = x.tamanhos;
  });
  return assCriarEnvelope_(p, pid, cols, doc, gerado, ClicksignVenda.signatarios(d, config), nomeCs, extras, ad.docs, rub, d);
}

/* 30/10: PDF do contrato gerado para a tela achar as rubricas (RubricasVenda + pdf.js). Só leitura. O link do
 * arquivo não vai para a tela (vai o conteúdo, como em verContratoAssinado). ajuste = RUBRICAS_AJUSTE. */
function assinaturaPdf_(col, p) {
  var pid = String(p.pageId).slice(0, 8);
  var config = assConfig_(p.pageId);
  if (config.semRubricas) return { ok: true, semRubricas: true };
  /* casa de rua não rubrica; dado com problema: o envio é que diz qual (mesma leitura do assinaturaEnviar) */
  var f = ctrFontes_(col, p.pageId);
  if (!f.fontes || f.condominioErro || f.obraAmbigua || f.duplicados || f.obraNaoEncontrada ||
      !ContratoVenda.montarDadosContrato(f.fontes).condominio) return { ok: true, semRubricas: true };
  var pg = ctrLerPaginaVenda_(p.pageId), gerado = assDoc_({}).gerado(pg);
  if (!gerado || !gerado.url) return { ok: false, erro: "SEM_CONTRATO_GERADO" };
  var b = null;
  try { b = baixarArquivo_({ name: gerado.nome, type: "file", file: { url: gerado.url } }); } catch (e) { b = null; }
  if (!b || b.mime !== "application/pdf") { assLog_("pdf rubricas " + pid + " ilegivel"); return { ok: false, erro: "CONTRATO_ILEGIVEL" }; }
  if (b.base64.length * 3 / 4 > ASS_MAX_BYTES) return { ok: false, erro: "CONTRATO_ILEGIVEL" };
  var r = { ok: true, nome: gerado.nome, base64: b.base64, ajuste: config.rubricasAjuste };
  /* 01/11 (plano 23 B): os termos de confissão do envelope também, para a tela achar as linhas de assinatura deles.
     nome = o do documento na Clicksign (sem o carimbo). Termo que falta ou não abre fica de fora (o envio é que barra). */
  r.linhas = !!config.linhas;   /* correção 1 (C-1): desligadas, a tela nem procura as linhas */
  if (config.linhas) {
    var d = ContratoVenda.montarDadosContrato(f.fontes);
    var tipos = ConfissaoVenda.fiadoresAssinam(d, cfdLigado_()) ? ConfissaoVenda.quais(d) : [];
    r.termos = [];
    tipos.forEach(function (tipo) {
      var tg = cfdGerado_(pg, tipo), bt = null;
      if (!tg || !tg.url) return;
      try { bt = baixarArquivo_({ name: tg.nome, type: "file", file: { url: tg.url } }); } catch (e) { bt = null; }
      if (!bt || bt.mime !== "application/pdf" || bt.base64.length * 3 / 4 > ASS_MAX_BYTES) return;
      r.termos.push({ nome: cfdNomeNaClicksign_(tg.nome), base64: bt.base64 });
    });
  }
  /* dono 01/11/2026: memorial migrado (uma linha por pessoa) — o PDF vai para a tela achar as linhas, como os termos */
  var memId = String(prop_("MODELO_MEMORIAL_ID") || "").trim();
  if (config.linhas && memId && ctrLerModelo_(memId).migrado) {
    var dm = ContratoVenda.montarDadosContrato(f.fontes);
    var gm = assGerarMemorial_(dm, pid, ClicksignVenda.nomePadrao(f.endereco, f.casa, dm.comprador1 && dm.comprador1.nome), memId);
    if (gm.doc && gm.doc.base64.length * 3 / 4 <= ASS_MAX_BYTES) r.memorial = { nome: gm.doc.nome, base64: gm.doc.base64 };
    else assLog_("pdf rubricas " + pid + " memorial nao gerado");
  }
  assLog_("pdf rubricas " + pid + " ok" + (r.termos ? " termos " + r.termos.length : "") + (r.memorial ? " memorial" : ""));
  return r;
}

/* 30/10: documentos que só o comprador assina, no mesmo envelope do contrato: { docs: [{ tipo, nome, base64,
 * paginas }] } ou { resp }. Memorial: gerado agora do Google Doc MODELO_MEMORIAL_ID (marcadores
 * {{ASSINATURA_COMPRADORES_NOMES}} e {{ASSINATURA_COMPRADORES_CPFS}}), cópia apagada sempre. Projeto: o PDF
 * fixo PROJETO_APROVADO_ID. Propriedade vazia = documento desligado. */
function assLatin1_(bytes) { return Utilities.newBlob(bytes).getDataAsString("ISO-8859-1"); }
/* Memorial gerado agora do Google Doc MODELO_MEMORIAL_ID: { doc } ou { resp }. Modelo migrado (dono, 01/11/2026) tem
   {{ASSINATURAS_MEMORIAL}}: uma linha por pessoa (vendedora e quem compra) — doc.migrado diz isso ao envio. */
function assGerarMemorial_(d, pid, nomeCs, memId) {
  if (typeof Drive === "undefined" || !Drive || !Drive.Files || !Drive.Files.remove) return { resp: { ok: false, erro: "DRIVE_API_DESLIGADA" } };
  var modelo, pasta;
  try { modelo = DriveApp.getFileById(memId); pasta = DriveApp.getFolderById(prop_("PASTA_PROVISORIA_ID")); }
  catch (e) { ctrErro_("assinatura memorial " + pid + " modelo inacessivel", e); return { resp: { ok: false, erro: "MEMORIAL_NAO_CONFIGURADO" } }; }
  var mc = ContratoVenda.marcadores(d), migrado = ctrLerModelo_(memId).migrado;
  var marc = { ASSINATURA_COMPRADORES_NOMES: mc.MEMORIAL_ASSINATURA_NOMES, ASSINATURA_COMPRADORES_CPFS: mc.MEMORIAL_ASSINATURA_CPFS };
  try { marc.ASSINATURAS_MEMORIAL = ClicksignVenda.blocoAssinaturas(d, assConfig_(), "MEMORIAL"); }
  catch (e) { ctrErro_("assinatura memorial " + pid + " bloco de assinaturas", e); }   /* modelo antigo segue; o migrado para no marcador sobrando */
  var g = ctrGerarPdf_({ modelo: modelo, pasta: pasta, blocos: {}, titulo: "MEMORIAL DESCRITIVO - " + nomeCs, marcadores: marc },
                       pid, "assinatura memorial", false);
  if (g.resp) return { resp: g.resp.erro === "CONTRATO_FALHOU" ? { ok: false, erro: "MEMORIAL_FALHOU" } : g.resp };
  var bytes = g.pdf.getBytes();
  var lat = assLatin1_(bytes), tm = null;
  try { tm = ClicksignVenda.tamanhosPaginasPdf(lat); } catch (e) { tm = null; }
  return { doc: { tipo: ClicksignVenda.DOC.MEMORIAL, nome: ClicksignVenda.nomeDocumentoAdicional("memorial", nomeCs), base64: Utilities.base64Encode(bytes),
                  paginas: ClicksignVenda.contarPaginasPdf(lat), tamanhos: tm, migrado: migrado } };
}
function assDocsDoComprador_(d, pid, nomeCs) {
  var docs = [], memId = String(prop_("MODELO_MEMORIAL_ID") || "").trim(), projId = String(prop_("PROJETO_APROVADO_ID") || "").trim();
  if (memId) {
    var gm = assGerarMemorial_(d, pid, nomeCs, memId);
    if (gm.resp) return gm;
    docs.push(gm.doc);
  }
  if (projId) {
    var blob;
    try { blob = DriveApp.getFileById(projId).getBlob(); }
    catch (e) { ctrErro_("assinatura projeto " + pid + " inacessivel", e); return { resp: { ok: false, erro: "PROJETO_NAO_CONFIGURADO" } }; }
    if (blob.getContentType() !== "application/pdf") return { resp: { ok: false, erro: "PROJETO_NAO_CONFIGURADO" } };
    var bp = blob.getBytes(), tp = null;
    try { tp = ClicksignVenda.tamanhosPaginasPdf(assLatin1_(bp)); } catch (e) { tp = null; }
    docs.push({ tipo: ClicksignVenda.DOC.PROJETO, nome: ClicksignVenda.nomeDocumentoAdicional("projeto", nomeCs), base64: Utilities.base64Encode(bp), paginas: 0, tamanhos: tp });
  }
  return { docs: docs };
}

/* nome do termo na Clicksign: o do PDF gerado sem o carimbo " [#xxxxxxxx]" */
function cfdNomeNaClicksign_(nome) { return String(nome || "").replace(/ \[#[0-9a-f]{8}\](\.pdf)$/i, "$1"); }
/* 28/10: termos de confissão de dívida (ConfissaoVenda) — ligados quando o modelo do termo PRÉ existe. */
function cfdLigado_() { return !!String(prop_("MODELO_CONFISSAO_PRE_ID") || "").trim(); }
/* nome real da coluna do termo na linha ("" quando a base ainda não tem) */
function cfdCol_(pg, nome) {
  if (!nome) return "";
  for (var n in pg.properties) if (RegrasVenda.chave(n) === RegrasVenda.chave(nome) && pg.properties[n].type === "files") return n;
  return "";
}
/* último PDF gerado do termo ("PRE" | "POS"): { nome, url } ou null */
function cfdGerado_(pg, tipo) {
  var c = cfdCol_(pg, tipo === "POS" ? ConfissaoVenda.COL.POS_GERADO : ConfissaoVenda.COL.PRE_GERADO);
  var lista = c ? (ctrValor_(pg.properties[c]) || []) : [];
  if (!lista.length) return null;
  var a = lista[lista.length - 1];
  return { nome: ctrTxt_(a.name), url: a.type === "external" ? ((a.external || {}).url || "") : ((a.file || {}).url || "") };
}

/* Termo de pré-reserva: assinam o pré-reservante (comprador 1), a vendedora e as 2 testemunhas — sem
 * comprador 2 nem corretor. 01/11/2026 (dono): "na pré-reserva não precisa do cônjuge, pode deixar a opção de incluir,
 * mas a pré-reserva a gente gosta de ser rápido e simples, só pra segurar a unidade" — o cônjuge só assina o termo se o
 * corretor ligou "Incluir o cônjuge na pré-reserva" nesta venda (PR_CONJUGE_<pageId>, PreReserva.gs); desligado, ele
 * não entra no envelope nem tem o e-mail cobrado. Isto muda só o termo: no contrato o cônjuge continua assinando
 * (decisão de 31/10). Faltas do termo + da assinatura; o carimbo do PDF tem de bater com o de agora. */
function assEnviarTermo_(col, p, pid, cols, doc, gerado) {
  var x = prDados_(col, p, pid, "assinatura termo");
  if (x.resp) return x.resp;
  var dAss = {}, k;
  for (k in x.d) dAss[k] = x.d[k];
  dAss.comprador2 = null; dAss.corretor = null;
  if (dAss.condominio && dAss.condominio.conjugeComprador && !prConjugeIncluido_(p.pageId)) {
    var cond = {};
    for (k in dAss.condominio) if (k !== "conjugeComprador") cond[k] = dAss.condominio[k];
    dAss.condominio = cond;
  }
  var config = assConfig_(p.pageId), cfg = {};
  for (k in config) cfg[k] = config[k];
  cfg.incluirCorretor = false;
  var faltas = config.invalidas.map(function (n) { return "Propriedade " + n + ": JSON inválido"; })
    .concat(PreReservaVenda.faltas(x.t), ClicksignVenda.faltasAssinatura(dAss, cfg));
  if (faltas.length) {
    assLog_("enviar termo " + pid + " faltas " + faltas.length);
    return { ok: false, erro: "FALTAM_DADOS", faltas: faltas, corrigir: assCorrigir_(faltas) };
  }
  var carimbo = ctrCarimboDoNome_(gerado.nome);
  if (!carimbo || (carimbo !== prCarimbo_(x.t) && carimbo !== prCarimbo_(x.t, prAssinCarimbo_(x.d, p.pageId)))) { assLog_("enviar termo " + pid + " carimbo diferente"); return { ok: false, erro: "TERMO_DESATUALIZADO" }; }
  var nomeCs = "PRÉ-RESERVA - " + ClicksignVenda.nomePadrao(x.f.endereco, x.f.casa, dAss.comprador1 && dAss.comprador1.nome);
  return assCriarEnvelope_(p, pid, cols, doc, gerado, ClicksignVenda.signatarios(dAss, cfg), nomeCs, null, null, null, dAss);
}

/* 30/10: o contrato primeiro; termos, memorial e projeto depois. */
function assOrdemDocs_(a, b) {
  function k(dc) { return ClicksignVenda.tipoDoDocumento((dc && dc.attributes && dc.attributes.filename) || "", !!cfdDoNome_(dc)) === ClicksignVenda.DOC.CONTRATO ? 0 : 1; }
  return k(a) - k(b);
}
/* Documento da Clicksign que é termo de confissão: a coluna do ASSINADO dele ("" = não é termo). */
function cfdDoNome_(dc) { return ConfissaoVenda.colunaAssinadaDoNome((dc && dc.attributes && dc.attributes.filename) || ""); }

/* Atalhos "Corrigir e-mail" (a tela abre a página do portal numa aba nova). */
function assCorrigir_(faltas) { return ClicksignVenda.linksCorrigirEmail(faltas); }

/* Cria envelope → documento → signatários → requisitos → ativa → grava → notifica (contrato e termo). */
/* unidade 22 (01/11): avisos do leitor da tela (RubricasVenda: "item 4.2.1 do quadro-resumo não achado" etc.) — só textos
   curtos, sem dado pessoal; no máximo 5 */
function assAvisosDaTela_(rb) {
  var l = rb && Array.isArray(rb.avisos) ? rb.avisos : [];
  return l.filter(function (a) { return typeof a === "string" && /^[\w\s.,:"()çãõáéíóúâêôà-]{1,120}$/i.test(a) && !/@|\d{3}\.\d{3}/.test(a); }).slice(0, 5);
}
/* RUBRICAS_VISTO_COMO_ASSINATURA=1: os vistos ("initials") vão como assinatura ("manuscript"), somados ao requisito manuscript do
   mesmo documento — a Clicksign não aceita dois do mesmo tipo para a mesma pessoa no mesmo documento */
function assJuntarVistos_(reqs, ligado) {
  if (!ligado) return reqs;
  var out = [], por = {};
  reqs.forEach(function (r) {
    var kind = r.kind === "initials" ? "manuscript" : r.kind, k = r.docId + "|" + kind;
    if (por[k]) { por[k].positions = por[k].positions.concat(r.positions); return; }
    por[k] = { docId: r.docId, kind: kind, positions: r.positions.slice() };
    out.push(por[k]);
  });
  return out;
}
/* dados: os da venda (ContratoVenda) — a selfie depende de o vendedor ser empresa (ClicksignVenda.autenticacoes) */
function assCriarEnvelope_(p, pid, cols, doc, gerado, lista, nomeCs, extras, adicionais, rub, dados) {
  var cfgAuth = assConfig_(p.pageId);   /* 01/11 (plano 23 C): CLICKSIGN_SELFIE — vale para o contrato e o termo, rua e condomínio */
  /* unidade 22 (01/11): avisos que voltam no resultado do envio (o da tela, rubrica guardada diferente, sem posição) */
  var avisos = (rub && rub.avisos || []).map(function (a) { assLog_("enviar " + pid + " tela: " + a); return "tela: " + a; });
  var S = ClicksignVenda.SITUACOES;
  var pdf = null;
  try { pdf = baixarArquivo_({ name: gerado.nome, type: "file", file: { url: gerado.url } }); }
  catch (e) { assLog_("enviar " + pid + " contrato gerado sem resposta"); pdf = null; }
  if (!pdf || pdf.mime !== "application/pdf") { assLog_("enviar " + pid + " contrato gerado ilegivel"); return { ok: false, erro: "CONTRATO_ILEGIVEL" }; }
  if (rub) { try { rub.tamanhos = rub.tamanhos || {}; rub.tamanhos.contrato = ClicksignVenda.tamanhosPaginasPdf(assLatin1_(Utilities.base64Decode(pdf.base64))); } catch (e) { /* fica o A4 */ } }
  /* 28/10: termos de confissão (mesmo envelope); na Clicksign o documento leva o nome do PDF gerado, sem o carimbo */
  var pdfsExtras = [];
  for (var x = 0; x < (extras || []).length; x++) {
    var bx = null;
    try { bx = baixarArquivo_({ name: extras[x].nome, type: "file", file: { url: extras[x].url } }); } catch (e) { bx = null; }
    if (!bx || bx.mime !== "application/pdf") { assLog_("enviar " + pid + " termo de confissao ilegivel"); return { ok: false, erro: "CONTRATO_ILEGIVEL" }; }
    pdfsExtras.push({ nome: cfdNomeNaClicksign_(extras[x].nome), base64: bx.base64 });
  }

  var envId = "", base = "", papeis = {};
  /* entrega 14: envelope e documento com o nome padrão "OBRA - COMPRADOR" (termo: "PRÉ-RESERVA - OBRA - COMPRADOR") */
  try {
    envId = csPasso_("envelope", "post", "/envelopes", ClicksignVenda.corpoEnvelope(nomeCs), true).id;
    base = "/envelopes/" + encodeURIComponent(envId);
    /* anota já: qualquer leitura seguinte vê envelope aberto (RASCUNHO conta como aberto) */
    try { assGravarTextos_(p.pageId, assColunasEnvelope_(cols, envId, S.RASCUNHO)); }
    catch (e) { ctrErro_("assinatura enviar " + pid + " rascunho nao anotado", e); throw new Error("RASCUNHO_NAO_GRAVADO"); }
    var docId = csPasso_("documento", "post", base + "/documents",
                         ClicksignVenda.corpoDocumento(ClicksignVenda.nomeArquivo(nomeCs), pdf.base64), true).id;
    var D = ClicksignVenda.DOC, docs = [{ id: docId, tipo: D.CONTRATO }];
    pdfsExtras.forEach(function (e) {
      docs.push({ id: csPasso_("documento", "post", base + "/documents", ClicksignVenda.corpoDocumento(e.nome, e.base64), true).id, tipo: D.TERMO, nome: e.nome });
    });
    /* 30/10: memorial e projeto aprovado (só do comprador) */
    (adicionais || []).forEach(function (e) {
      docs.push({ id: csPasso_("documento", "post", base + "/documents", ClicksignVenda.corpoDocumento(e.nome, e.base64), true).id, tipo: e.tipo });
    });
    var ids = lista.map(function (s) {
      var id = csPasso_("signatarios", "post", base + "/signers", ClicksignVenda.corpoSignatario(s), true).id;
      papeis[id] = s.papel;
      return id;
    });
    lista.forEach(function (s, i) {
      /* fiador: só os termos; comprador e vendedor: tudo (dono, 01/11/2026); corretor: só o contrato; os demais: o contrato e os
         termos (ClicksignVenda.documentosDoSignatario) */
      ClicksignVenda.documentosDoSignatario(s, docs).forEach(function (dId) {
        csPasso_("requisitos", "post", base + "/requirements", ClicksignVenda.corpoQualificacao(dId, ids[i], s.role));
        Utilities.sleep(CS_PAUSA_REQ_MS);
        ClicksignVenda.autenticacoes(s, cfgAuth, dados).forEach(function (auth) {
          csPasso_("requisitos", "post", base + "/requirements", ClicksignVenda.corpoAutenticacao(dId, ids[i], auth));
          Utilities.sleep(CS_PAUSA_REQ_MS);
        });
      });
      /* 30/10: rubricas posicionadas do comprador (campos de ciência, coluna de valores, memorial, projeto);
         01/11 (plano 23 B): e a assinatura de cada pessoa em cima da própria linha (contrato e termos) */
      var semLugar = [];
      assJuntarVistos_(ClicksignVenda.requisitosRubrica(s, docs, rub, i, lista, semLugar), cfgAuth.vistoComoAssinatura).forEach(function (r) {
        var rr = csPasso_("rubricas", "post", base + "/requirements", ClicksignVenda.corpoRubrica(r.docId, ids[i], r.kind, r.positions));
        /* unidade 22 (01/11): os vistos não apareceram nos PDFs assinados — o registro diz o que a Clicksign guardou (sem dado
           pessoal: tipo, documento, quantas posições) e diferença vira aviso no resultado do envio */
        var at = (rr.data && rr.data.attributes) || {}, n = r.positions.length, g = Array.isArray(at.positions) ? at.positions.length : 0;
        assLog_("enviar " + pid + " " + s.papel + " rubrica " + r.kind + " " + r.docId + ": " + n + (n === 1 ? " posição pedida" : " posições pedidas") +
                " → guardada kind=" + (at.kind || "?") + ", " + g + (g <= 1 ? " posição" : " posições"));
        /* só compara o que a resposta trouxe: sem kind/positions na resposta, fica só o registro (não é divergência) */
        if ((at.kind !== undefined && at.kind !== r.kind) || (Array.isArray(at.positions) && g !== n)) avisos.push("RUBRICA_DIVERGENTE: " + s.papel + " — " + r.kind + " no documento " + r.docId + " (pedidas " + n + ", guardadas " + g + ")");
        Utilities.sleep(CS_PAUSA_REQ_MS);
      });
      /* revisão 01/11: quem não coube no ponto (margem de baixo) assina só pela página da Clicksign — fica registrado (sem nome) */
      semLugar.forEach(function (a) { assLog_("enviar " + pid + " " + a); avisos.push("SEM_POSICAO: " + a); });   /* só o papel, sem nome */
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
    assProps_().setProperty(ASS_PENDENTE + doc.chave + p.pageId, envId);
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
            signatarios: lista.map(function (s) {
              return { papel: s.papel, nome: ClicksignVenda.nomeMascarado(s.nome), email: String(s.email || ""), assinou: false, situacao: "pendente", data: "" };
            }) };
  if (!n.ok) r.aviso = "NOTIFICACAO_FALHOU";
  if (avisos.length) r.avisos = avisos;
  assLog_("enviar " + pid + " ok envelope " + envId + " signatarios " + lista.length + (avisos.length ? " avisos " + avisos.length : ""));
  return r;
}

/* ---- estado ---- */
function assNomeAssinado_(nomeGerado) {
  var n = String(nomeGerado || "contrato.pdf").replace(/ \[#[0-9a-f]{8}\](\.pdf)$/i, "$1");
  if (/^TERMO DE PRÉ-RESERVA - /.test(n)) return "TERMO DE PRÉ-RESERVA ASSINADO - " + n.slice(23);
  return /^CONTRATO - /.test(n) ? "CONTRATO ASSINADO - " + n.slice(11) : "ASSINADO - " + n;
}
function assPapeis_(envId) {
  try { return JSON.parse(prop_(ASS_PAPEIS + envId) || "{}") || {}; } catch (e) { return {}; }
}
/* Lista para a tela: papel (da Propriedade ASSINATURA_PAPEIS_<envelope>), nome mascarado ("Maria S."),
 * situação (assinou / pendente / recusou) e data do evento. Nunca e-mail nem CPF. */
function assListaSignatarios_(envId, signers, eventos) {
  var papeis = assPapeis_(envId), sits = ClicksignVenda.situacaoDosSignatarios(signers, eventos);
  return (signers || []).map(function (s) {
    var st = sits[s.id] || { situacao: "pendente", data: "" };
    /* 27/10 (dono): a tela mostra para qual e-mail a Clicksign mandou (a equipe confere se está certo) */
    return { papel: papeis[s.id] || "Signatário", nome: ClicksignVenda.nomeMascarado(s.attributes && s.attributes.name),
             email: String((s.attributes && s.attributes.email) || ""),
             assinou: st.situacao === "assinou", situacao: st.situacao, data: st.data };
  });
}

function assinaturaEstado_(col, p) {
  var pid = String(p.pageId).slice(0, 8), S = ClicksignVenda.SITUACOES, doc = assDoc_(p);
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, doc);
  var envId = assTexto_(pg, cols.ENVELOPE), sitAtual = assTexto_(pg, cols.SITUACAO);
  /* envelope ativo que o envio não conseguiu gravar: usa o id guardado e grava agora */
  var pendente = prop_(ASS_PENDENTE + doc.chave + p.pageId);
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
    if (pendente) assApagarProp_(ASS_PENDENTE + doc.chave + p.pageId);
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
    /* 28/10: com os termos de confissão o envelope tem vários documentos: o principal é o contrato (nem termo,
       nem memorial/projeto — 30/10), e os eventos de todos contam (o fiador só assina os termos) */
    docs.sort(assOrdemDocs_);
    eventos = [];
    docs.forEach(function (dc) {
      eventos = eventos.concat(csPasso_("consultar eventos", "get", base + "/documents/" + encodeURIComponent(dc.id) + "/events").data || []);
    });
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
  try { sit = ClicksignVenda.situacao(ClicksignVenda.statusEfetivo(env.status, docs), eventos); }
  catch (e) { assLog_("estado " + pid + " status desconhecido"); return { ok: false, erro: String(e.message) }; }
  if (sit !== S.ENVIADO) assApagarProp_(ASS_VIGIA_STATUS + envId);   /* terminou (assinado/cancelado/...): a vigia não precisa mais do status */

  var semArquivo = !(ctrValor_(pg.properties[cols.ASSINADO]) || []).length;
  /* 01/11/2026 (teste no sandbox): a Clicksign fecha o envelope ~1 minuto antes de gerar o arquivo "signed". Sem o link
     ainda, não é erro: a situação é ASSINADO com aguardandoArquivo; o PDF entra no próximo Atualizar (ou na vigia). */
  var aguardando = false;
  function semLink(e) { return String((e && e.message) || "").indexOf("CLICKSIGN_SEM_LINK_ASSINADO") === 0; }
  var termosAssinar = docs.slice(1).map(function (dc) { return { doc: dc, col: cfdCol_(pg, cfdDoNome_(dc)) }; })
    .filter(function (y) { return y.col && !(ctrValor_(pg.properties[y.col]) || []).length; });
  if (sit === S.ASSINADO && termosAssinar.length) {
    for (var k = 0; k < termosAssinar.length; k++) {
      var tl, tr;
      try { tl = ClicksignVenda.linkAssinado(termosAssinar[k].doc); }
      catch (e) { if (!semLink(e)) throw e; aguardando = true; continue; }
      try { tr = UrlFetchApp.fetch(tl, { muteHttpExceptions: true }); }
      catch (e) { assLog_("estado " + pid + " termo assinado sem link/resposta"); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
      if (tr.getResponseCode() >= 300) { assLog_("estado " + pid + " termo assinado http " + tr.getResponseCode()); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
      try {
        anexarArquivo_(p.pageId, termosAssinar[k].col, { nome: "ASSINADO - " + ctrTxt_((termosAssinar[k].doc.attributes || {}).filename || "termo.pdf"),
                                                         mime: "application/pdf", base64: Utilities.base64Encode(tr.getBlob().getBytes()) }, true);
      } catch (e) { ctrErro_("assinatura estado " + pid + " anexo do termo falhou", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    }
    assLog_("estado " + pid + " envelope " + envId + " termos assinados anexados " + termosAssinar.length);
  }
  var link = null;
  if (sit === S.ASSINADO && (sitAtual !== sit || semArquivo)) {
    try { link = ClicksignVenda.linkAssinado(docs[0]); }
    catch (e) {
      if (!semLink(e)) { assLog_("estado " + pid + " envelope " + envId + " sem link do assinado"); return { ok: false, erro: String(e.message) }; }
      assLog_("estado " + pid + " envelope " + envId + " assinado, arquivo ainda sendo preparado");
      aguardando = true;
    }
  }
  if (link) {
    var r;
    try { r = UrlFetchApp.fetch(link, { muteHttpExceptions: true }); } /* link pré-assinado: sem o token */
    catch (e) { assLog_("estado " + pid + " download do assinado sem resposta"); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    if (r.getResponseCode() >= 300) { assLog_("estado " + pid + " download do assinado http " + r.getResponseCode()); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
    var gerado = doc.gerado(pg);
    try {
      anexarArquivo_(p.pageId, cols.ASSINADO, { nome: assNomeAssinado_(gerado && gerado.nome), mime: "application/pdf",
                                                 base64: Utilities.base64Encode(r.getBlob().getBytes()) }, true);
    } catch (e) { ctrErro_("assinatura estado " + pid + " anexo falhou", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    assLog_("estado " + pid + " envelope " + envId + " assinado anexado");
    semArquivo = false;
    var anexouContrato = true;
  }
  if (!gravar(sit)) return { ok: false, erro: "GRAVACAO_FALHOU" };
  if (sit === S.ASSINADO && !doc.pre) {
    if (aguardando) { if (!prop_(ASS_AGUARDANDO + p.pageId)) assProps_().setProperty(ASS_AGUARDANDO + p.pageId, String(Date.now())); }
    else if (prop_(ASS_AGUARDANDO + p.pageId)) assApagarProp_(ASS_AGUARDANDO + p.pageId);
  }
  /* correção 3 (4): o PDF do contrato acabou de entrar (pelo botão ou pela vigia) — Andamento e Mais Controle, uma vez */
  if (anexouContrato && !doc.pre) assPosAssinatura_(col, p.pageId);

  var feitos = ClicksignVenda.assinaram(signers, eventos);
  var lista = assListaSignatarios_(envId, signers, eventos);
  if (ClicksignVenda.FINAIS.indexOf(sit) >= 0) { assApagarProp_(ASS_PAPEIS + envId); assApagarProp_(ASS_REENVIO + envId); }
  var resp = { ok: true, situacao: sit, envelope: true, signatarios: lista, temAssinado: !semArquivo };
  if (aguardando) resp.aguardandoArquivo = true;
  /* closed sem o "sign" de alguém: não inventa assinatura; o PDF é o que a Clicksign entregou */
  if (env.status === "closed" && signers.some(function (s) { return !feitos[s.id]; })) {
    assLog_("estado " + pid + " envelope " + envId + " assinaturas incompletas");
    resp.aviso = "ASSINATURAS_INCOMPLETAS";
  }
  return resp;
}

/* 01/11 (correção 3, item 4): o que acontece quando o PDF assinado do contrato do condomínio entra na casa — pelo
 * "Atualizar situação" ou pela vigia (os dois passam por assinaturaEstado_, que chama isto só na hora em que anexa):
 *  - marca "ASSINOU E ARMAZENOU CONTRATO" = SIM no Andamento (se a coluna existir e ainda não estiver SIM);
 *  - só com a Propriedade MC_LANCAR_AO_ASSINAR = SIM e a prévia do Mais Controle OK, pede o lançamento (mcLancar_, com
 *    a trava e o vendaId que impedem lançar duas vezes). Erro aqui nunca derruba a situação já gravada. */
function assPosAssinatura_(col, pageId) {
  var id8 = String(pageId).slice(0, 8), pg;
  try { pg = notion_("GET", "/pages/" + pageId, null); } catch (e) { ctrErro_("pos-assinatura " + id8 + " leitura", e); return; }
  if (!pg || vendaBaseDaPagina_(pg) !== "CONDOMINIO") return;
  try { vigiaMarcarAndamento_(pg); } catch (e) { ctrErro_("pos-assinatura " + id8 + " andamento", e); }
  if (String(prop_("MC_LANCAR_AO_ASSINAR") || "").trim().toUpperCase() === "SIM") {
    try { vigiaLancarMC_(col, pageId); } catch (e) { ctrErro_("pos-assinatura " + id8 + " mais controle", e); }
  }
}
function vigiaMarcarAndamento_(pg) {
  var props = pg.properties || {}, nome = null;
  Object.keys(props).forEach(function (n) { if (RegrasVenda.chave(n) === RegrasVenda.chave(VIGIA_ANDAMENTO)) nome = n; });
  if (!nome) return;
  var pr = props[nome], novo = {};
  if (pr.type === "checkbox") { if (pr.checkbox) return; novo[nome] = { checkbox: true }; }
  else if (pr.type === "select") { if (pr.select && RegrasVenda.chave(pr.select.name) === "SIM") return; novo[nome] = { select: { name: "SIM" } }; }
  else return;
  notion_("PATCH", "/pages/" + pg.id, { properties: novo });
  ctrLog_("vigia " + String(pg.id).slice(0, 8) + " Andamento: " + VIGIA_ANDAMENTO + " = SIM");
}

function vigiaLancarMC_(col, pageId) {
  var c = mcLerColunas_(pageId);
  if (c.vendaId) return;
  if (!/^PR[ÉE]VIA OK/i.test(c.situacao || "")) { ctrLog_("vigia " + String(pageId).slice(0, 8) + " MC: sem prévia OK, espera o botão"); return; }
  var r = mcLancar_(col, { u: "vigia de assinaturas", t: "ADM" }, { pageId: pageId, aplicar: true });
  ctrLog_("vigia " + String(pageId).slice(0, 8) + " MC: " + (r && r.ok ? "lançamento pedido" : "não lançou (" + (r && r.erro) + ")"));
}


/* ---- reenviar o aviso de assinatura aos pendentes ----
 * Só com envelope ativo (running, sem recusa) e com alguém pendente. Um por vez (LockService) e no máximo
 * 1 reenvio a cada ClicksignVenda.REENVIO_MIN minutos por envelope (Propriedade ASSINATURA_REENVIO_<envelope>
 * = hora do último; apagada quando a situação fica final). Rota: POST /envelopes/{id}/notifications
 * (a mesma do envio; a Clicksign avisa quem ainda não assinou — ver CLICKSIGN-API.md). Não grava na casa. */
function assinaturaReenviar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) { assLog_("reenviar " + pid + " ocupado"); return { ok: false, erro: "ASSINATURA_OCUPADA" }; }
  var r;
  try { r = assReenviarTravado_(p, pid); }
  finally { trava.releaseLock(); }
  assLog_("reenviar " + pid + " por " + String((sess && sess.u) || "?") + ": " + (r.ok ? "ok pendentes " + r.pendentes : r.erro));
  return r;
}

function assReenviarTravado_(p, pid) {
  var S = ClicksignVenda.SITUACOES;
  var doc = assDoc_(p), pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, doc);
  var envId = prop_(ASS_PENDENTE + doc.chave + p.pageId) || assTexto_(pg, cols.ENVELOPE);
  if (!envId) return { ok: false, erro: "SEM_ENVELOPE" };
  var agora = Date.now(), falta = ClicksignVenda.minutosParaReenviar(prop_(ASS_REENVIO + envId), agora);
  if (falta) return { ok: false, erro: "REENVIO_RECENTE", minutos: falta };
  var base = "/envelopes/" + encodeURIComponent(envId), env, docs, eventos, signers, sit;
  try {
    env = csPasso_("consultar envelope", "get", base);
    if (env.status !== "running") {
      sit = env.status === "draft" ? S.RASCUNHO : (env.status === "closed" ? S.ASSINADO : S.CANCELADO);
      return { ok: false, erro: "ENVELOPE_NAO_ATIVO", situacao: sit };
    }
    docs = csPasso_("consultar documento", "get", base + "/documents").data || [];
    if (!docs.length) return { ok: false, erro: "CLICKSIGN_ENVELOPE_SEM_DOCUMENTO" };
    /* 28/10: com os termos de confissão o envelope tem vários documentos: o principal é o contrato (nem termo,
       nem memorial/projeto — 30/10), e os eventos de todos contam (o fiador só assina os termos) */
    docs.sort(assOrdemDocs_);
    eventos = [];
    docs.forEach(function (dc) {
      eventos = eventos.concat(csPasso_("consultar eventos", "get", base + "/documents/" + encodeURIComponent(dc.id) + "/events").data || []);
    });
    signers = csPasso_("consultar signatarios", "get", base + "/signers").data || [];
    sit = ClicksignVenda.situacao(env.status, eventos);
    if (sit !== S.ENVIADO) return { ok: false, erro: "ENVELOPE_NAO_ATIVO", situacao: sit };
    var lista = assListaSignatarios_(envId, signers, eventos);
    var pendentes = lista.filter(function (s) { return s.situacao === "pendente"; }).length;
    if (!pendentes) return { ok: false, erro: "NINGUEM_PENDENTE", signatarios: lista };
    csPasso_("reenviar", "post", base + "/notifications", ClicksignVenda.corpoNotificacao());
  } catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    assLog_("reenviar " + pid + " falhou no passo " + e.passo + " http " + e.http);
    return { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe };
  }
  assProps_().setProperty(ASS_REENVIO + envId, String(agora));
  return { ok: true, situacao: sit, envelope: true, pendentes: pendentes, signatarios: lista };
}

/* ---- 29/10/2026: cancelar o envelope (pedido do dono) ----
 * Só com envelope ativo (running). PATCH /envelopes/{id} com status "canceled" (ninguém mais assina; a
 * Clicksign avisa os signatários) e depois o "Atualizar situação" de sempre grava CANCELADO na casa e limpa as
 * Propriedades do envelope — daí o Enviar de novo fica liberado. Um por vez (LockService). */
function assinaturaCancelar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), S = ClicksignVenda.SITUACOES;
  if (!prop_("CLICKSIGN_TOKEN")) return { ok: false, erro: "CLICKSIGN_SEM_TOKEN" };
  if (!csBase_()) return { ok: false, erro: "CLICKSIGN_URL_INVALIDA" };
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) { assLog_("cancelar " + pid + " ocupado"); return { ok: false, erro: "ASSINATURA_OCUPADA" }; }
  var r = null, soAtualizar = false;
  try {
    var doc = assDoc_(p), pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, doc);
    var pendente = prop_(ASS_PENDENTE + doc.chave + p.pageId);
    var envId = pendente || assTexto_(pg, cols.ENVELOPE);
    if (!envId) r = { ok: false, erro: "SEM_ENVELOPE" };
    else {
      var base = "/envelopes/" + encodeURIComponent(envId);
      try {
        var env = csPasso_("consultar envelope", "get", base);
        var draft = env.status === "draft";
        if (draft) {
          /* Descartar rascunho: o envio parou no meio e o envelope nunca foi ativado — só draft é apagado */
          if (assApagarRascunho_(base, pid, cols, p.pageId)) {
            assApagarProp_(ASS_PAPEIS + envId);
            assApagarProp_(ASS_VIGIA_STATUS + envId);
            r = { ok: true, descartou: true, situacao: "", envelope: false, signatarios: [] };
          } else r = { ok: false, erro: "RASCUNHO_NAO_APAGADO" };
        } else if (p.descartar === true) {
          /* Descartar rascunho NUNCA cancela: se o envelope já não é rascunho (a ativação pode ter passado e os
             signatários já têm o e-mail), só atualiza a situação gravada, como o Atualizar situação */
          soAtualizar = true;
        }
        var docsEnv = (!draft && !soAtualizar && env.status === "running") ? (csPasso_("consultar documento", "get", base + "/documents").data || []) : [];
        var st = ClicksignVenda.statusEfetivo(env.status, docsEnv);
        if (draft || soAtualizar) { /* já tratado acima */ }
        else if (st !== "running")
          r = { ok: false, erro: "ENVELOPE_NAO_ATIVO", situacao: st === "draft" ? S.RASCUNHO : (st === "closed" ? S.ASSINADO : S.CANCELADO) };
        else docsEnv.forEach(function (dc) {
          if (dc && dc.attributes && dc.attributes.status === "running")
            csPasso_("cancelar", "patch", base + "/documents/" + encodeURIComponent(dc.id), ClicksignVenda.corpoCancelarDocumento(dc.id));
        });
      } catch (e) {
        if (e.message !== "CLICKSIGN_FALHOU") throw e;
        /* rascunho que já não existe na Clicksign (apagado à mão): a casa volta a "sem envelope", como no Atualizar situação */
        if (e.passo === "consultar envelope" && e.http === 404 && !pendente && assTexto_(pg, cols.SITUACAO).toUpperCase() === S.RASCUNHO) {
          try {
            assGravarTextos_(p.pageId, assColunasEnvelope_(cols, "", ""));
            assApagarProp_(ASS_PAPEIS + envId);
            assApagarProp_(ASS_VIGIA_STATUS + envId);
            r = { ok: true, descartou: true, situacao: "", envelope: false, signatarios: [] };
          } catch (e2) { ctrErro_("assinatura cancelar " + pid + " limpeza do rascunho", e2); r = { ok: false, erro: "GRAVACAO_FALHOU" }; }
        } else r = { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe };
      }
    }
  } finally { trava.releaseLock(); }
  assLog_("cancelar " + pid + " por " + String((sess && sess.u) || "?") + ": " + (r ? (r.erro || "ok") : "ok"));
  if (r) return r;
  var est = assinaturaEstado_(col, p);   /* grava CANCELADO e limpa as Propriedades do envelope */
  if (soAtualizar) {
    if (!est || !est.ok) return est;
    est.descartou = false;
    /* campo próprio (01/11): `aviso` é só código (NOTIFICACAO_FALHOU, ASSINATURAS_INCOMPLETAS) e continua como veio */
    est.avisoTexto = "O contrato já tinha sido enviado aos signatários. Nada foi descartado — a situação foi atualizada.";
    return est;
  }
  est.cancelou = true;
  return est;
}

/* ---- entrega 14: "Ver contrato assinado" ----
 * O PDF vem pelo próprio PORTAL-VENDA (sessão de quem está logado no portal, com acesso a Vendas), como o
 * "Visualizar pré-contrato": o servidor baixa o último arquivo de CONTRATO ASSINADO do Notion e devolve em base64.
 * A tela nunca recebe o link do arquivo (link do S3 do Notion vale por 1 hora para QUALQUER um que o tenha).
 * Só leitura — nada é gravado. Log só com pageId abreviado e o resultado. */
var ASS_MAX_BYTES = 15 * 1024 * 1024;
function verContratoAssinado_(col, p) {
  var pid = String(p.pageId).slice(0, 8);
  var pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, assDoc_(p));
  var lista = ctrValor_(pg.properties[cols.ASSINADO]) || [];
  if (!lista.length) return { ok: false, erro: "SEM_ASSINADO" };
  var f = lista[lista.length - 1], b = null;
  try { b = baixarArquivo_(f); } catch (e) { b = null; }
  if (!b || b.mime !== "application/pdf") { assLog_("ver assinado " + pid + " ilegivel"); return { ok: false, erro: "ASSINADO_ILEGIVEL" }; }
  if (b.base64.length * 3 / 4 > ASS_MAX_BYTES) return { ok: false, erro: "ASSINADO_GRANDE" };
  assLog_("ver assinado " + pid + " ok");
  return { ok: true, nome: ctrTxt_(f.name) || "contrato-assinado.pdf", base64: b.base64 };
}

/* ---- 01/11/2026 (plano 23 A): depois de assinado por todos, só visualizar ----
 * Dono: "depois do contrato assinado por todos, tem que tirar essas opções e deixar só para visualizar os documentos
 * todos assinados (inclusive o projeto)". documentosAssinados lista os documentos do envelope (contrato, termos de
 * confissão, memorial, projeto) e verDocumentoAssinado entrega o PDF assinado de um deles — baixado da Clicksign pelo
 * link "signed" (o mesmo de assinaturaEstado), em base64 pela sessão do portal. Só com a situação ASSINADO gravada na
 * casa. Só leitura (o perfil TESTES vê). Log só com pageId abreviado e o resultado. */
function assEnvelopeAssinado_(p) {
  var doc = assDoc_(p), pg = ctrLerPaginaVenda_(p.pageId), cols = assColunas_(pg, doc);
  var envId = prop_(ASS_PENDENTE + doc.chave + p.pageId) || assTexto_(pg, cols.ENVELOPE);
  if (!envId || assTexto_(pg, cols.SITUACAO).toUpperCase() !== ClicksignVenda.SITUACOES.ASSINADO) return { resp: { ok: false, erro: "NAO_ASSINADO" } };
  if (!prop_("CLICKSIGN_TOKEN")) return { resp: { ok: false, erro: "CLICKSIGN_SEM_TOKEN" } };
  if (!csBase_()) return { resp: { ok: false, erro: "CLICKSIGN_URL_INVALIDA" } };
  var base = "/envelopes/" + encodeURIComponent(envId), docs;
  try { docs = csPasso_("consultar documento", "get", base + "/documents").data || []; }
  catch (e) {
    if (e.message !== "CLICKSIGN_FALHOU") throw e;
    return { resp: { ok: false, erro: "CLICKSIGN_FALHOU", passo: e.passo, http: e.http, detalhe: e.detalhe } };
  }
  return { docs: docs };
}
function documentosAssinados_(col, p) {
  var pid = String(p.pageId).slice(0, 8), x = assEnvelopeAssinado_(p);
  if (x.resp) { assLog_("assinados " + pid + ": " + x.resp.erro); return x.resp; }
  var l = ClicksignVenda.listaAssinados(x.docs, function (n) { return !!ConfissaoVenda.colunaAssinadaDoNome(n); });
  assLog_("assinados " + pid + " ok " + l.length);
  return { ok: true, documentos: l };
}
function verDocumentoAssinado_(col, p) {
  var pid = String(p.pageId).slice(0, 8), x = assEnvelopeAssinado_(p);
  if (x.resp) return x.resp;
  var dc = x.docs.filter(function (d) { return d && String(d.id) === String(p.docId || ""); })[0];
  if (!dc) return { ok: false, erro: "DOCUMENTO_NAO_ENCONTRADO" };
  var link, r;
  try { link = ClicksignVenda.linkAssinado(dc); }
  catch (e) {
    assLog_("ver doc assinado " + pid + " sem link");
    /* 01/11 (sandbox): logo depois da última assinatura o "signed" ainda não existe — pedir para esperar, não é defeito */
    if (String(e.message).indexOf("CLICKSIGN_SEM_LINK_ASSINADO") === 0) return { ok: false, erro: "ASSINADO_AGUARDANDO_ARQUIVO" };
    return { ok: false, erro: String(e.message) };
  }
  try { r = UrlFetchApp.fetch(link, { muteHttpExceptions: true }); }   /* link pré-assinado: sem o token */
  catch (e) { return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
  if (r.getResponseCode() >= 300) { assLog_("ver doc assinado " + pid + " http " + r.getResponseCode()); return { ok: false, erro: "DOWNLOAD_ASSINADO_FALHOU" }; }
  var bytes = r.getBlob().getBytes();
  if (bytes.length > ASS_MAX_BYTES) return { ok: false, erro: "ASSINADO_GRANDE" };
  assLog_("ver doc assinado " + pid + " ok");
  return { ok: true, nome: ctrTxt_((dc.attributes || {}).filename) || "documento.pdf", base64: Utilities.base64Encode(bytes) };
}

/* Trava do servidor (plano 23 A): com o envelope ASSINADO nada do que se assinou muda, mesmo que uma tela antiga mande.
 * Contrato: CONTRATO_ASSINADO; termo de pré-reserva: TERMO_ASSINADO. Lê só as colunas da situação; base sem as colunas
 * (ou página ilegível) não trava aqui — a própria ação responde. */
var ASS_TRAVA_CONTRATO = ["gerarPreContrato", "aprovarPreContrato", "gerarContrato", "escolherTestemunhas", "salvarCamposContrato", "escolherContaRecebimento",
                          "salvarCondicoesEspeciais", "redigirCondicoesEspeciais", "salvarFiadores", "conjugeEhFiador2"];
/* salvarFluxo fica de fora: já recusa com FLUXO_CONTRATO_ASSINADO ("mudar o fluxo agora exige aditivo") */
var ASS_TRAVA_TERMO = ["gerarTermoPreReserva", "salvarContaPreReserva", "salvarConjugePreReserva"];
var ASS_TRAVA_ENVELOPE = ["assinaturaEnviar", "assinaturaReenviar", "assinaturaCancelar"];
function assTravaAssinado_(p) {
  var a = String(p.action || ""), termo;
  if (ASS_TRAVA_CONTRATO.indexOf(a) >= 0) termo = false;
  else if (ASS_TRAVA_TERMO.indexOf(a) >= 0) termo = true;
  else if (ASS_TRAVA_ENVELOPE.indexOf(a) >= 0) termo = p.doc === "PRE_RESERVA";
  else return null;
  /* sem token a ação de envelope responde CLICKSIGN_SEM_TOKEN sem ler nada — a trava também não lê */
  if (ASS_TRAVA_ENVELOPE.indexOf(a) >= 0 && !prop_("CLICKSIGN_TOKEN")) return null;
  var pg, info = {};
  try { pg = ctrLerPaginaVenda_(p.pageId, info); } catch (e) { return null; }
  /* correção 1 (I-1): Enviar/Reenviar/Cancelar têm a trava própria (LockService) e relêem a casa DENTRO dela — a leitura
     daqui não serve para eles (outro envio pode terminar enquanto este espera). Só as ações sem trava própria reaproveitam. */
  if (ASS_TRAVA_ENVELOPE.indexOf(a) < 0) ctrPaginaEmprestada_ = { id: p.pageId, pg: pg, base: info.base };
  function assinado(dc) {
    try { return assTexto_(pg, assColunas_(pg, dc).SITUACAO).toUpperCase() === ClicksignVenda.SITUACOES.ASSINADO; }
    catch (e) { return false; }   /* base sem as colunas: não trava aqui, a ação responde */
  }
  var erro = "";
  if (assinado(assDoc_(termo ? { doc: "PRE_RESERVA" } : {}))) erro = termo ? "TERMO_ASSINADO" : "CONTRATO_ASSINADO";
  /* correção 1 (M-7): contrato assinado também trava o que a tela esconde da pré-reserva (o pagamento segue aberto) */
  else if (ASS_TRAVA_TERMO.indexOf(a) >= 0 && assinado(assDoc_({}))) erro = "CONTRATO_ASSINADO";
  if (!erro) return null;
  assLog_(a + " " + String(p.pageId).slice(0, 8) + " recusado: " + erro);
  return { ok: false, erro: erro };
}

/* Conferência para rodar UMA vez no editor (selecionar conferirAssinatura › Executar › ver o Registro de
 * execução): diz se o token e a URL funcionam (GET de 1 envelope, só o código HTTP) e se o JSON das
 * testemunhas está certo. Nunca mostra o token, nome, e-mail ou CPF. Não grava nada. */
function conferirAssinatura() {
  var linhas = [], ok = true;
  function falha(t) { ok = false; linhas.push("ERRO  " + t); }
  var token = String(prop_("CLICKSIGN_TOKEN")).trim(), base = csBase_();
  if (!token) falha("CLICKSIGN_TOKEN não está nas Propriedades do script.");
  else if (/^bearer\s/i.test(token)) falha("CLICKSIGN_TOKEN: cole só o código, sem a palavra Bearer.");
  if (!base) falha("CLICKSIGN_URL inválida: use https://sandbox.clicksign.com (teste) ou https://app.clicksign.com (produção).");
  else if (base.indexOf("https://sandbox.clicksign.com/") === 0) linhas.push("ok    Ambiente: sandbox (teste).");
  else if (base.indexOf("https://app.clicksign.com/") === 0) linhas.push("AVISO Ambiente: PRODUÇÃO — os e-mails vão de verdade para as pessoas.");
  else linhas.push("AVISO Ambiente: endereço fora do padrão da Clicksign.");
  if (ok) {
    var r = cs_("get", "/envelopes?page%5Bsize%5D=1");
    var disse = " A Clicksign disse: " + (r.detalhe || "(sem detalhe)");
    if (r.ok) linhas.push("ok    Clicksign aceitou o token (http " + r.http + ").");
    else if (r.http === 401) falha("Clicksign recusou o token (http 401): token errado, de outro ambiente (sandbox × produção) ou revogado." + disse);
    else if (r.http === 403) falha("Clicksign reconheceu o token mas negou o acesso (http 403): confira o e-mail salvo na tela da API e a confirmação do cadastro." + disse);
    else if (r.http === 0) falha("Clicksign não respondeu (http 0). Tente de novo daqui a pouco.");
    else falha("Clicksign respondeu http " + r.http + "." + disse);
  }
  var conf = ClicksignVenda.conferirConfig(assConfig_());
  conf.problemas.forEach(falha);
  conf.avisos.forEach(function (a) { linhas.push("AVISO " + a); });
  if (!conf.problemas.length) linhas.push("ok    Pares de testemunhas SPE e PF preenchidos.");
  linhas.push("ok    Lista de escolha na tela: " + ClicksignVenda.opcoesTestemunhas(assConfig_()).length + " pessoa(s).");
  linhas.push(ok ? "PRONTO: pode testar o botão Enviar para assinatura." : "AINDA NÃO: corrija os ERROS acima e rode de novo.");
  linhas.forEach(function (l) { console.log(l); });
  return { ok: ok, linhas: linhas };
}
