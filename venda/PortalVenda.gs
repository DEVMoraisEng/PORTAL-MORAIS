/* PORTAL-VENDA — dossiê do comprador (entrega 1).
 * Projeto do Apps Script SEPARADO do PORTAL-LEITURA/ESCRITA: um upload do
 * Code.gs do portal não apaga este, e vice-versa.
 * Arquivos do projeto: RegrasVenda.gs, ClaudeLeitor.gs, OpenAILeitor.gs, ContratoVenda.gs,
 * PortalVenda.gs, GerarContrato.gs, CondominioVenda.gs, GerarVendaCondominio.gs.
 * Propriedades do script: NOTION_TOKEN, SESSION_SECRET (os MESMOS do portal
 * daquele ambiente), DB_VENDAS, DB_VENDAS_COND (base das vendas do condomínio), PROVEDOR_IA (openai padrão | anthropic),
 * OPENAI_API_KEY (provedor openai), MODELO_IA (opcional, só openai),
 * ANTHROPIC_API_KEY (provedor anthropic, plano B).
 * Nenhum log com nome, CPF, endereço ou conteúdo de documento. */
var VERSAO_VENDA = "venda-v8";   // v8: leitura em lote, certidão mãe e data do habite-se (entrega 13); v7: campos abertos e conta de recebimento no contrato (entrega 12); v6: documentos do imóvel lidos pela IA (entrega 11); v5: pré-contrato grifado (entrega 9)
var NOTION_VERSION = "2022-06-28";
var ERROS_CONHECIDOS = /^(COLUNA_FALTANDO|TIPO_DE_COLUNA_ERRADO|BACKEND_SEM_CONFIG|PAGINA_DE_OUTRA_BASE)/;
var REGEX_PAGE_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;

function prop_(n) { return PropertiesService.getScriptProperties().getProperty(n) || ""; }

function doGet(e) { return responder_(tratar_(lerPedido_(e))); }
function doPost(e) { return responder_(tratar_(lerPedido_(e))); }

function lerPedido_(e) {
  var p = {};
  try { if (e && e.postData && e.postData.contents) p = JSON.parse(e.postData.contents); } catch (_) {}
  if (e && e.parameter) for (var k in e.parameter) if (!(k in p)) p[k] = e.parameter[k];
  return p;
}
function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tratar_(p) {
  try {
    if (p.action === "ping") return { ok: true, versao: VERSAO_VENDA, papel: "VENDA" };
    var sess = verificarToken_(p.token);
    if (!sess) return { ok: false, erro: "NAO_AUTORIZADO" };
    if (!temAcessoVendas_(sess)) return { ok: false, erro: "SEM_PERMISSAO" };
    var grava = ["tipoCasa", "lerDocumento", "anexarDocumento", "lerDocumentos", "copiarComprovante", "conferir", "devolver", "gerarContrato", "gerarPreContrato", "aprovarPreContrato", "escolherTestemunhas",
                 "salvarCamposContrato", "escolherContaRecebimento", "mcLancar", "assinaturaEnviar", "assinaturaEstado",
                 "gerarVendaCondominio", "assinaturaReenviar"].indexOf(p.action) >= 0;
    if (grava && String(sess.t || "").toUpperCase() === "TESTES") return { ok: false, erro: "SEM_PERMISSAO_TESTES" };
    if (p.action !== "ping" && !REGEX_PAGE_ID.test(String(p.pageId || ""))) return { ok: false, erro: "PAGINA_INVALIDA" };
    var col = colunas_();
    switch (p.action) {
      case "estado":       return estado_(col, p);
      case "tipoCasa":     return tipoCasa_(col, p);
      case "lerDocumento": return lerDocumento_(col, sess, p);
      case "anexarDocumento": return anexarDocumento_(col, p);
      case "lerDocumentos": return lerDocumentos_(col, sess, p);
      case "copiarComprovante": return copiarComprovante_(col, sess, p);
      case "conferir":     return mudarDossie_(col, sess, p, RegrasVenda.ESTADOS.CONFERIDO, "Conferido");
      case "devolver":
        if (!String(p.motivo || "").trim()) return { ok: false, erro: "MOTIVO_OBRIGATORIO" };
        return mudarDossie_(col, sess, p, RegrasVenda.ESTADOS.DEVOLVIDO, "Devolvido: " + String(p.motivo).trim());
      case "contratoEstado": return contratoEstado_(col, p);
      case "escolherTestemunhas": return escolherTestemunhas_(col, sess, p);
      case "salvarCamposContrato": return salvarCamposContrato_(col, sess, p);
      case "escolherContaRecebimento": return escolherContaRecebimento_(col, sess, p);
      case "gerarPreContrato": return gerarPreContrato_(col, sess, p);
      case "verPreContrato": return verPreContrato_(col, p);
      case "aprovarPreContrato":
      case "gerarContrato": return aprovarPreContrato_(col, sess, p);   /* o final só sai de um pré-contrato conferido */
      case "mcEstado":     return mcEstado_(col, p);
      case "mcLancar":     return mcLancar_(col, sess, p);
      case "assinaturaEnviar": return assinaturaEnviar_(col, sess, p);
      case "assinaturaEstado": return assinaturaEstado_(col, p);
      case "assinaturaReenviar": return assinaturaReenviar_(col, sess, p);
      case "gerarVendaCondominio": return gerarVendaCondominio_(col, sess, p);
      default: return { ok: false, erro: "ACAO_DESCONHECIDA" };
    }
  } catch (err) {
    var m = String((err && err.message) || err);
    console.error("PORTAL-VENDA " + String(p.action || "") + " falhou: " + m.slice(0, 160));
    return { ok: false, erro: ERROS_CONHECIDOS.test(m) ? m : "ERRO_INTERNO" };
  }
}

/* ---- sessão: MESMO algoritmo do assinar_/verificar_ do Code.gs do portal ---- */
function verificarToken_(token) {
  var partes = String(token || "").split(".");
  if (partes.length !== 2) return null;
  var seg = prop_("SESSION_SECRET");
  if (!seg) throw new Error("BACKEND_SEM_CONFIG");
  var esperado = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(partes[0], seg));
  if (esperado !== partes[1]) return null;
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString("UTF-8"));
  } catch (e) { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}
function temAcessoVendas_(sess) {
  var t = String(sess.t || "").toUpperCase();
  if (t === "ADM" || t === "MASTER" || t === "TESTES") return true;
  return (sess.a || []).indexOf("VENDAS") >= 0;
}

/* ---- Notion ---- */
function notion_(method, path, body) {
  var opt = { method: method, muteHttpExceptions: true, contentType: "application/json",
              headers: { Authorization: "Bearer " + prop_("NOTION_TOKEN"), "Notion-Version": NOTION_VERSION } };
  if (body) opt.payload = JSON.stringify(body);
  var r = UrlFetchApp.fetch("https://api.notion.com/v1" + path, opt);
  var code = r.getResponseCode(), data = {};
  try { data = JSON.parse(r.getContentText()); } catch (_) {}
  if (code >= 300) throw new Error("NOTION_" + code + ": " + String((data && data.message) || "").slice(0, 120));
  return data;
}

function colunas_() {
  /* O cache guarda só o necessário das colunas RESOLVIDAS (nome real, tipo,
     opções se select) — não o schema inteiro da base, que numa VENDAS com
     muitas colunas pode passar do limite de ~100 KB do CacheService e
     lançar, derrubando toda ação. Falha ao gravar no cache não é grave:
     só custa buscar o schema de novo na próxima chamada. */
  var cache = CacheService.getScriptCache(), k = "venda_schema_v2", txt = cache.get(k), schema;
  var R = RegrasVenda;
  if (txt) {
    schema = JSON.parse(txt);
  } else {
    var db = notion_("GET", "/databases/" + prop_("DB_VENDAS"), null);
    var completo = {};
    for (var nome in db.properties) {
      var pr = db.properties[nome];
      completo[nome] = { tipo: pr.type, opcoes: pr.type === "select" ? (pr.select.options || []).map(function (o) { return o.name; }) : [] };
    }
    var pre = R.resolverColunas(completo), preI = R.resolverColunas(completo, R.COL_IMOVEL, R.TIPOS_IMOVEL);
    var preO = R.resolverColunas(completo, R.COL_IMOVEL_OPC, R.TIPOS_IMOVEL_OPC);
    schema = {};
    [pre, preI, preO].forEach(function (x) { for (var canon in x.mapa) { var real = x.mapa[canon]; schema[real] = completo[real]; } });
    /* sem as colunas do imóvel completas não guarda no cache: criadas no Notion, a próxima chamada já vê */
    if (!preI.faltando.length && !preI.tipoErrado.length && !preO.faltando.length && !preO.tipoErrado.length) {
      try { cache.put(k, JSON.stringify(schema), 1800); } catch (e) { console.error("PORTAL-VENDA cache do schema falhou: " + String(e.message || e).slice(0, 120)); }
    }
  }
  var r = R.resolverColunas(schema);
  if (r.faltando.length) { try { cache.remove(k); } catch (e) {} throw new Error("COLUNA_FALTANDO: " + r.faltando.join(", ")); }
  if (r.tipoErrado.length) { try { cache.remove(k); } catch (e) {} throw new Error("TIPO_DE_COLUNA_ERRADO: " + r.tipoErrado.join(", ")); }
  /* documentos do imóvel (entrega 11): colunas opcionais — se faltarem, só aquela seção para */
  var ri = R.resolverColunas(schema, R.COL_IMOVEL, R.TIPOS_IMOVEL), mapa = r.mapa, imovelErro = "";
  if (ri.faltando.length) imovelErro = "COLUNA_FALTANDO: " + ri.faltando.join(", ");
  else if (ri.tipoErrado.length) imovelErro = "TIPO_DE_COLUNA_ERRADO: " + ri.tipoErrado.join(", ");
  else for (var ci in ri.mapa) mapa[ci] = ri.mapa[ci];
  /* entrega 13: certidão mãe, data do habite-se e denominação do loteamento — opcionais uma a uma */
  var ro = R.resolverColunas(schema, R.COL_IMOVEL_OPC, R.TIPOS_IMOVEL_OPC), opcFaltando = ro.faltando.concat(ro.tipoErrado);
  if (!imovelErro) for (var co in ro.mapa) if (ro.tipoErrado.indexOf(co) < 0) mapa[co] = ro.mapa[co];
  return { mapa: mapa, schema: schema, imovelErro: imovelErro, opcFaltando: opcFaltando };
}

function valorProp_(pr) {
  if (!pr) return null;
  switch (pr.type) {
    case "title": case "rich_text":
      return (pr[pr.type] || []).map(function (t) { return t.plain_text || (t.text && t.text.content) || ""; }).join("");
    case "number": return pr.number;
    case "select": return pr.select ? pr.select.name : null;
    case "email": return pr.email;
    case "phone_number": return pr.phone_number;
    case "files": return pr.files || [];
    case "date": return pr.date ? pr.date.start : null;
    default: return null;
  }
}
/* ctx (opcional): recebe { endereco, casa } da página — a identificação da unidade para a certidão mãe */
function lerPagina_(col, pageId, ctx) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  var dbEsperado = prop_("DB_VENDAS").replace(/-/g, "");
  var dbAtual = String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "");
  if (dbAtual !== dbEsperado) throw new Error("PAGINA_DE_OUTRA_BASE");
  var atuais = {};
  for (var canon in col.mapa) atuais[canon] = valorProp_(pg.properties[col.mapa[canon]]);
  if (ctx) {
    for (var n in pg.properties) {
      var pr = pg.properties[n] || {};
      if (pr.type === "title") ctx.endereco = String(valorProp_(pr) || "");
      else if (RegrasVenda.chave(n) === "CASA") {
        var v = pr.type === "formula" ? (pr.formula || {})[(pr.formula || {}).type] : valorProp_(pr);
        ctx.casa = v === null || v === undefined || typeof v === "object" ? "" : String(v);
      }
    }
  }
  return atuais;
}
function propNotion_(tipo, valor) {
  var vazio = valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "");
  switch (tipo) {
    case "number": return { number: vazio ? null : Number(valor) };
    case "select": return { select: valor ? { name: String(valor) } : null };
    case "email": return { email: vazio ? null : String(valor) };
    case "phone_number": return { phone_number: vazio ? null : String(valor) };
    case "date": return { date: vazio ? null : { start: String(valor).slice(0, 10) } };
    default: return { rich_text: vazio ? [] : [{ type: "text", text: { content: String(valor).slice(0, 1900) } }] };
  }
}
function gravar_(col, pageId, porCanonico) {
  var props = {};
  for (var canon in porCanonico) {
    var real = col.mapa[canon], tipo = col.schema[real].tipo, v = porCanonico[canon];
    if (tipo === "select") v = RegrasVenda.resolverOpcao(col.schema[real].opcoes, v);
    props[real] = propNotion_(tipo, v);
  }
  notion_("PATCH", "/pages/" + pageId, { properties: props });
}
function hoje_(fmt) { return Utilities.formatDate(new Date(), "America/Sao_Paulo", fmt); }

/* ---- ações ---- */
function estado_(col, p) {
  var a = lerPagina_(col, p.pageId), C = RegrasVenda.COL;
  var imovel = estadoImovel_(col, a);
  var arqs = RegrasVenda.contarArquivos(a);
  if (!imovel.erro) for (var k in imovel.arquivos) arqs[k] = imovel.arquivos[k];
  return { ok: true, tipoCasa: a[C.TIPO_CASA] || "", arquivos: RegrasVenda.contarArquivos(a),
           dossie: a[C.DOSSIE] || "", observacao: a[C.OBS] || "", doisCompradores: RegrasVenda.temDoisCompradores(a),
           imovel: imovel,
           /* entrega 13: espaços com arquivo anexado e ainda não lido (os dois grupos), na ordem de leitura */
           pendentes: RegrasVenda.pendentesValidos(lerPendentes_(p.pageId), arqs) };
}
/* seção "Documentos do imóvel": arquivos por espaço, estado, observação e os dados do contrato já gravados */
function estadoImovel_(col, a) {
  if (col.imovelErro) return { erro: col.imovelErro };
  var CI = RegrasVenda.COL_IMOVEL, CO = RegrasVenda.COL_IMOVEL_OPC;
  return { arquivos: RegrasVenda.contarArquivos(a, RegrasVenda.ESPACOS_IMOVEL), dossie: a[CI.DOSSIE] || "",
           observacao: a[CI.OBS] || "",
           dados: { matricula: a[CI.MATRICULA_INDIVIDUAL] || "", cri: a[CI.CRI] || "",
                    area: a[CI.AREA] === null || a[CI.AREA] === undefined ? null : a[CI.AREA],
                    confrontacoes: a[CI.CONFRONTACOES] || "", alvaraNumero: a[CI.ALVARA_NUMERO] || "",
                    alvaraData: a[CI.ALVARA_DATA] || "", habiteseNumero: a[CI.HABITESE_NUMERO] || "",
                    habiteseData: a[CO.HABITESE_DATA] || "", loteamentoDenominacao: a[CO.LOTEAMENTO_DENOMINACAO] || "",
                    loteamentoMatricula: a[CI.LOTEAMENTO_MATRICULA] || "", loteamentoCartorio: a[CI.LOTEAMENTO_CARTORIO] || "" },
           /* colunas opcionais da entrega 13 que faltam na base (sem IMÓVEL - CERTIDÃO MÃE o espaço some da tela) */
           semColunas: (col.opcFaltando || []).slice() };
}
/* colunas de estado/observação de cada dossiê: o do comprador (padrão) ou o do imóvel */
function colunasDossie_(grupo) {
  return grupo === "imovel" ? { estado: RegrasVenda.COL_IMOVEL.DOSSIE, obs: RegrasVenda.COL_IMOVEL.OBS }
                            : { estado: RegrasVenda.COL.DOSSIE, obs: RegrasVenda.COL.OBS };
}
function tipoCasa_(col, p) {
  if (RegrasVenda.TIPOS_CASA.indexOf(p.valor) < 0) return { ok: false, erro: "TIPO_DE_CASA_INVALIDO" };
  var g = {}; g[RegrasVenda.COL.TIPO_CASA] = p.valor;
  gravar_(col, p.pageId, g);
  return { ok: true };
}
function mudarDossie_(col, sess, p, estado, nota) {
  var grupo = p.grupo === "imovel" ? "imovel" : "comprador";
  if (grupo === "imovel" && col.imovelErro) return { ok: false, erro: col.imovelErro };
  var D = colunasDossie_(grupo), a = lerPagina_(col, p.pageId), g = {};
  g[D.estado] = estado;
  g[D.obs] = RegrasVenda.juntarObservacoes(a[D.obs], [nota], hoje_("dd/MM"), sess.u);
  gravar_(col, p.pageId, g);
  return { ok: true };
}

function anexarArquivo_(pageId, colReal, arq, trocar) {
  var fu = notion_("POST", "/file_uploads", { filename: arq.nome, content_type: arq.mime });
  var blob = Utilities.newBlob(Utilities.base64Decode(arq.base64), arq.mime, arq.nome);
  var r = UrlFetchApp.fetch(fu.upload_url, { method: "post", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + prop_("NOTION_TOKEN"), "Notion-Version": NOTION_VERSION }, payload: { file: blob } });
  if (r.getResponseCode() >= 300) throw new Error("UPLOAD_FALHOU");
  var lista = [];
  if (!trocar) {
    var pg = notion_("GET", "/pages/" + pageId, null);
    /* Arquivo já hospedado pelo Notion só continua na coluna se for reenviado
       como {type:"file"} — a API substitui a lista inteira (doc "Page property
       values", seção Files). Com trocar, a lista não é lida: o arquivo novo
       substitui os que estavam ali (decisão do dono, Task 9). */
    lista = ((pg.properties[colReal] || {}).files || []).map(RegrasVenda.manterArquivo);
  }
  lista.push({ type: "file_upload", name: arq.nome, file_upload: { id: fu.id } });
  var props = {}; props[colReal] = { files: lista };
  notion_("PATCH", "/pages/" + pageId, { properties: props });
}
function baixarArquivo_(f) {
  var url = f.type === "external" ? f.external.url : f.file.url;
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) return null;
  var b = r.getBlob();
  return { mime: RegrasVenda.mimeDoArquivo(f.name, b.getContentType()), base64: Utilities.base64Encode(b.getBytes()) };
}

function leitorIA_() {
  var provedor = String(prop_("PROVEDOR_IA") || "openai").toLowerCase();
  if (provedor === "openai") {
    var chaveOpenai = prop_("OPENAI_API_KEY");
    if (!chaveOpenai) return { erro: "CHAVE_IA_FALTANDO" };
    return { nome: "openai", leitor: OpenAILeitor, chave: chaveOpenai, modelo: prop_("MODELO_IA") };
  }
  if (provedor === "anthropic") {
    var chaveAnthropic = prop_("ANTHROPIC_API_KEY");
    if (!chaveAnthropic) return { erro: "CHAVE_IA_FALTANDO" };
    return { nome: "anthropic", leitor: ClaudeLeitor, chave: chaveAnthropic, modelo: "" };
  }
  return { erro: "PROVEDOR_IA_INVALIDO" };
}

/* ---- entrega 13: anexar sem ler, leitura em lote ----
 * Quem ainda não foi lido: Propriedade do script "venda_pend_<pageId>" = {"ESPAÇO": "trocar"|"atualizar"}.
 * Marcada ao anexar pelo portal, apagada (por espaço) quando a leitura daquele espaço grava no Notion.
 * Só existe enquanto há anexo sem leitura (some depois), então não acumula na cota das Propriedades.
 * Arquivo posto direto no Notion não vira "novo": para ele, "Ler de novo". */
function chavePendentes_(pageId) { return "venda_pend_" + String(pageId || "").replace(/-/g, "").toLowerCase(); }
function lerPendentes_(pageId) {
  try { var o = JSON.parse(prop_(chavePendentes_(pageId)) || "{}"); return o && typeof o === "object" ? o : {}; }
  catch (e) { return {}; }
}
function mudarPendentes_(pageId, fn) {
  var trava = null;
  try { trava = LockService.getScriptLock(); if (!trava.tryLock(10000)) trava = null; } catch (e) { trava = null; }
  try {
    var pend = lerPendentes_(pageId);
    fn(pend);
    var sp = PropertiesService.getScriptProperties(), k = chavePendentes_(pageId);
    if (Object.keys(pend).length) sp.setProperty(k, JSON.stringify(pend)); else sp.deleteProperty(k);
    return pend;
  } catch (e) {
    console.error("PORTAL-VENDA pendentes falhou: " + String(e.message || e).slice(0, 120));
    return null;
  } finally { if (trava) trava.releaseLock(); }
}

/* UrlFetchApp.fetchAll com plano B: se o lote inteiro lançar (rede, tempo), pede um a um — um pedido
   ruim não derruba os outros. Devolve [{ r: HTTPResponse } | { erro }] na ordem dos pedidos. */
function buscarVarios_(pedidos) {
  if (!pedidos.length) return [];
  try {
    return UrlFetchApp.fetchAll(pedidos).map(function (r) { return { r: r }; });
  } catch (e) {
    return pedidos.map(function (q) {
      var o = {};
      for (var k in q) if (k !== "url") o[k] = q[k];
      try { return { r: UrlFetchApp.fetch(q.url, o) }; } catch (e2) { return { erro: String(e2.message || e2) }; }
    });
  }
}
/* baixa os arquivos (lista de arquivos do Notion) em paralelo → [{nome, mime, base64} | null (HTTP) | false (rede)] */
function baixarVarios_(arquivos) {
  var res = buscarVarios_(arquivos.map(function (f) {
    return { url: f.type === "external" ? f.external.url : f.file.url, muteHttpExceptions: true };
  }));
  return res.map(function (x, i) {
    if (!x.r) return false;
    if (x.r.getResponseCode() >= 300) return null;
    var b = x.r.getBlob();
    return { nome: arquivos[i].name, mime: RegrasVenda.mimeDoArquivo(arquivos[i].name, b.getContentType()),
             base64: Utilities.base64Encode(b.getBytes()) };
  });
}

/* Lê os espaços pedidos de UMA página: baixa os arquivos de todos em paralelo, chama a IA de todos em
 * paralelo (fetchAll) e grava tudo numa escrita só no Notion. pedidos = [{ espaco, modo }].
 * Devolve { ok, erro?, resultados: [{espaco, ok, erro?, preenchidos, observacoes}], gravados, ... }. */
function lerEspacos_(col, sess, pageId, pedidos) {
  var R = RegrasVenda, ctx = {}, a;
  try { a = lerPagina_(col, pageId, ctx); }
  catch (e) {
    if (/^PAGINA_DE_OUTRA_BASE/.test(String(e.message || e))) throw e;
    console.error("PORTAL-VENDA leitura falhou: " + String(e.message || e).slice(0, 120));
    return { ok: false, erro: "LEITURA_FALHOU", resultados: [] };
  }
  var itens = R.ordenarEspacos(pedidos.map(function (x) { return x.espaco; })).map(function (id) {
    var modo = "atualizar";
    pedidos.forEach(function (x) { if (x.espaco === id && x.modo === "trocar") modo = "trocar"; });
    var esp = R.espaco(id), it = { espaco: id, esp: esp, modo: modo, arquivos: [], partes: [] };
    if (esp.grupo === "imovel" && col.imovelErro) it.erro = col.imovelErro;
    else if (!col.mapa[esp.coluna]) it.erro = "COLUNA_FALTANDO: " + esp.coluna;
    else {
      it.arquivos = (a[esp.coluna] || []).slice(-4);
      if (!it.arquivos.length) it.erro = "SEM_ARQUIVO";
    }
    return it;
  });

  /* 1) downloads de todos os espaços num fetchAll só */
  var todos = [];
  itens.forEach(function (it) { if (!it.erro) it.arquivos.forEach(function (f) { todos.push({ it: it, f: f }); }); });
  var baixados = baixarVarios_(todos.map(function (x) { return x.f; }));
  todos.forEach(function (x, i) {
    var b = baixados[i];
    if (b === false) x.it.falhaRede = true;
    else if (b && R.conferirArquivo(b).ok) x.it.partes.push(b);
  });
  itens.forEach(function (it) { if (!it.erro && !it.partes.length) it.erro = it.falhaRede ? "LEITURA_FALHOU" : "ARQUIVO_NAO_LEGIVEL"; });

  /* 2) IA de todos os espaços num fetchAll só (OpenAI ou Claude, pela PROVEDOR_IA) */
  var ia = leitorIA_(), envio = [];
  itens.forEach(function (it) {
    if (it.erro) return;
    if (ia.erro) { it.erro = ia.erro; return; }
    var contexto = it.esp.tipo === "certidao_mae" ? R.contextoUnidade(ctx) : "";
    var pedido = ia.leitor.montarPedido(it.esp.tipo, it.partes, ia.chave, ia.modelo, contexto);
    if (pedido.erro) { it.erro = pedido.erro; return; }
    envio.push(it);
    it.req = { url: pedido.url, method: "post", contentType: "application/json", muteHttpExceptions: true,
               headers: pedido.headers, payload: JSON.stringify(pedido.corpo) };
  });
  var respostas = buscarVarios_(envio.map(function (it) { return it.req; }));
  envio.forEach(function (it, i) {
    var x = respostas[i], res;
    try { res = x.r ? ia.leitor.interpretarResposta(x.r.getResponseCode(), x.r.getContentText()) : { ok: false, erro: "LEITURA_FALHOU" }; }
    catch (e) { res = { ok: false, erro: "LEITURA_FALHOU" }; }
    if (!res.ok) { it.erro = res.erro; return; }
    it.leitura = res.leitura;
    console.log("PORTAL-VENDA leitura " + ia.nome + " " + it.espaco + " tokens " + res.uso.entrada + "/" + res.uso.saida);
  });

  /* 3) planos na ORDEM_LEITURA, cada um vendo o que os anteriores preencheram; uma escrita só */
  var hoje = hoje_("yyyy-MM-dd"), depois = {}, g = {}, obsPor = { comprador: [], imovel: [] }, grupos = {};
  var extra = {};
  for (var k in a) depois[k] = a[k];
  itens.forEach(function (it) {
    if (it.erro) return;
    var plano = R.planejarGravacao(it.espaco, it.leitura, depois, hoje, it.modo), grupo = it.esp.grupo === "imovel" ? "imovel" : "comprador";
    var obs = plano.observacoes.slice(), preenchidos = [];
    for (var c in plano.props) {
      if (!col.mapa[c]) {   // coluna opcional que a base não tem: não grava, avisa
        obs.push(it.esp.rotulo + ": a coluna " + c + " não existe na base — o valor lido não foi gravado");
        continue;
      }
      g[c] = plano.props[c]; depois[c] = plano.props[c];
      if (plano.preenchidos.indexOf(c) >= 0) preenchidos.push(c);
    }
    obsPor[grupo] = obsPor[grupo].concat(obs);
    grupos[grupo] = true;
    if (plano.loteamento) extra.loteamento = plano.loteamento;
    if (plano.habiteseData) extra.habiteseData = plano.habiteseData;
    it.ok = true; it.preenchidos = preenchidos; it.observacoes = obs;
  });
  var est = {};
  if (grupos.comprador) {
    est.comprador = R.estadoAposLeitura(R.contarArquivos(depois), R.temDoisCompradores(depois));
    g[R.COL.DOSSIE] = est.comprador.estado;
    if (obsPor.comprador.length) g[R.COL.OBS] = R.juntarObservacoes(a[R.COL.OBS], obsPor.comprador, hoje_("dd/MM"), sess.u);
  }
  if (grupos.imovel) {
    est.imovel = R.estadoImovelAposLeitura(R.contarArquivos(depois, R.ESPACOS_IMOVEL));
    g[R.COL_IMOVEL.DOSSIE] = est.imovel.estado;
    if (obsPor.imovel.length) g[R.COL_IMOVEL.OBS] = R.juntarObservacoes(a[R.COL_IMOVEL.OBS], obsPor.imovel, hoje_("dd/MM"), sess.u);
  }
  var lidos = itens.filter(function (it) { return it.ok; });
  if (lidos.length) {
    try { gravar_(col, pageId, g); }
    catch (e) {
      console.error("PORTAL-VENDA gravação falhou: " + String(e.message || e).slice(0, 120));
      lidos.forEach(function (it) { it.ok = false; it.erro = "GRAVACAO_FALHOU"; });
      lidos = [];
    }
  }
  if (lidos.length) mudarPendentes_(pageId, function (pend) { lidos.forEach(function (it) { delete pend[it.espaco]; }); });

  var gravados = {};
  if (lidos.length) for (var c3 in g) gravados[c3] = g[c3];
  var resp = { ok: lidos.length > 0, pageId: pageId, gravados: gravados,
               resultados: itens.map(function (it) {
                 return it.ok ? { espaco: it.espaco, ok: true, preenchidos: it.preenchidos, observacoes: it.observacoes }
                              : { espaco: it.espaco, ok: false, erro: it.erro };
               }) };
  if (!resp.ok) resp.erro = itens.length === 1 ? itens[0].erro : "NENHUM_LIDO";
  if (est.comprador) { resp.dossie = est.comprador.estado; resp.faltam = est.comprador.faltam; }
  if (est.imovel) resp.imovel = { dossie: est.imovel.estado, faltam: est.imovel.faltam };
  if (extra.loteamento) resp.loteamento = extra.loteamento;
  if (extra.habiteseData) resp.habiteseData = extra.habiteseData;
  return resp;
}

/* "Anexar" / "Trocar" sem ler: guarda o arquivo no espaço e marca o espaço como não lido */
function anexarDocumento_(col, p) {
  var esp = RegrasVenda.espaco(p.espaco);
  if (!esp) return { ok: false, erro: "ESPACO_DESCONHECIDO" };
  if (esp.grupo === "imovel" && col.imovelErro) return { ok: false, erro: col.imovelErro };
  if (!col.mapa[esp.coluna]) return { ok: false, erro: "COLUNA_FALTANDO: " + esp.coluna };
  var chk = RegrasVenda.conferirArquivo(p.arquivo);
  if (!chk.ok) return { ok: false, erro: chk.erro };
  lerPagina_(col, p.pageId);   // só aceita página da VENDAS deste ambiente
  try { anexarArquivo_(p.pageId, col.mapa[esp.coluna], p.arquivo, !!p.trocar); }
  catch (e) { console.error("PORTAL-VENDA upload falhou: " + String(e.message || e).slice(0, 120)); return { ok: false, erro: "UPLOAD_FALHOU" }; }
  var pend = mudarPendentes_(p.pageId, function (x) { RegrasVenda.marcarPendente(x, p.espaco, !!p.trocar); });
  return { ok: true, pageId: p.pageId, espaco: p.espaco, pendentes: pend ? RegrasVenda.ordenarEspacos(Object.keys(pend)) : null };
}

/* "Ler documentos": lê numa chamada todos os espaços anexados e ainda não lidos (os dois grupos).
 * p.espacos (opcional): limita a esses espaços. */
function lerDocumentos_(col, sess, p) {
  var pend = lerPendentes_(p.pageId);
  var ids = RegrasVenda.ordenarEspacos(Object.keys(pend));
  if (Array.isArray(p.espacos)) ids = ids.filter(function (id) { return p.espacos.indexOf(id) >= 0; });
  if (!ids.length) return { ok: false, erro: "NADA_NOVO", resultados: [] };
  return lerEspacos_(col, sess, p.pageId, ids.map(function (id) { return { espaco: id, modo: pend[id] }; }));
}

/* "Enviar e ler" (com arquivo) e "Ler de novo" (sem): um espaço só, mesma leitura do lote */
function lerDocumento_(col, sess, p) {
  var esp = RegrasVenda.espaco(p.espaco);
  if (!esp) return { ok: false, erro: "ESPACO_DESCONHECIDO" };
  if (esp.grupo === "imovel" && col.imovelErro) return { ok: false, erro: col.imovelErro, arquivoGuardado: false };
  if (!col.mapa[esp.coluna]) return { ok: false, erro: "COLUNA_FALTANDO: " + esp.coluna, arquivoGuardado: false };
  if (p.trocar && !p.arquivo) return { ok: false, erro: "TROCAR_SEM_ARQUIVO" };
  var guardado = false;
  if (p.arquivo) {
    var chk = RegrasVenda.conferirArquivo(p.arquivo);
    if (!chk.ok) return { ok: false, erro: chk.erro, arquivoGuardado: false };
    try { anexarArquivo_(p.pageId, col.mapa[esp.coluna], p.arquivo, !!p.trocar); guardado = true; }
    catch (e) { console.error("PORTAL-VENDA upload falhou: " + String(e.message || e).slice(0, 120)); return { ok: false, erro: "UPLOAD_FALHOU", arquivoGuardado: false }; }
    /* se a leitura falhar, o espaço fica como "novo, não lido" para o Ler documentos */
    mudarPendentes_(p.pageId, function (x) { RegrasVenda.marcarPendente(x, p.espaco, !!p.trocar); });
  }
  var modo = p.trocar || lerPendentes_(p.pageId)[p.espaco] === "trocar" ? "trocar" : "atualizar";
  var r = lerEspacos_(col, sess, p.pageId, [{ espaco: p.espaco, modo: modo }]);
  var um = r.resultados[0];
  if (!r.ok) return { ok: false, erro: (um && um.erro) || r.erro, arquivoGuardado: guardado };
  var est = esp.grupo === "imovel" ? r.imovel : { dossie: r.dossie, faltam: r.faltam };
  var resp = { ok: true, pageId: p.pageId, preenchidos: um.preenchidos, observacoes: um.observacoes,
               dossie: est.dossie, faltam: est.faltam, gravados: r.gravados };
  if (esp.grupo === "imovel") {
    resp.grupo = "imovel";
    if (r.loteamento) resp.loteamento = r.loteamento;      // registro do loteamento gravado na casa
    if (r.habiteseData) resp.habiteseData = r.habiteseData; // também em CONTRATO - HABITE-SE DATA (se a coluna existe)
  }
  return resp;
}

/* Comprador 2 com o mesmo endereço: copia o ENDEREÇO do comprador 1 e os arquivos do comprovante dele
 * para o espaço do comprador 2 (baixa e sobe de novo: o Notion não aceita apontar o mesmo arquivo em
 * outra coluna). Sem nova leitura da IA. A identidade não se repete: é pessoal. */
function copiarComprovante_(col, sess, p) {
  var R = RegrasVenda, C = R.COL, a = lerPagina_(col, p.pageId);
  var arqs = (a[C.C1_COMPROV] || []).slice(-4);
  if (!arqs.length) return { ok: false, erro: "SEM_COMPROVANTE_1" };
  if (R.vazio(a[C.C1_END])) return { ok: false, erro: "COMPROVANTE_1_NAO_LIDO" };
  var baixados = baixarVarios_(arqs);
  if (baixados.some(function (b) { return !b || !R.conferirArquivo(b).ok; })) return { ok: false, erro: "ARQUIVO_NAO_LEGIVEL" };
  try {
    baixados.forEach(function (b, i) {
      anexarArquivo_(p.pageId, col.mapa[C.C2_COMPROV], { nome: b.nome || "comprovante", mime: b.mime, base64: b.base64 }, i === 0);
    });
  } catch (e) {
    console.error("PORTAL-VENDA cópia do comprovante falhou: " + String(e.message || e).slice(0, 120));
    return { ok: false, erro: "UPLOAD_FALHOU" };
  }
  var depois = {}, g = {};
  for (var k in a) depois[k] = a[k];
  depois[C.C2_COMPROV] = arqs;   // só a contagem importa para o estado
  g[C.C2_END] = a[C.C1_END]; depois[C.C2_END] = a[C.C1_END];
  var est = R.estadoAposLeitura(R.contarArquivos(depois), R.temDoisCompradores(depois));
  g[C.DOSSIE] = est.estado;
  g[C.OBS] = R.juntarObservacoes(a[C.OBS], [R.ESPACOS.C2_COMPROVANTE.rotulo +
    ": o mesmo do comprador 1 (endereço copiado, sem nova leitura) — conferir; se o comprovante não estiver no nome de um dos dois, pedir a declaração"],
    hoje_("dd/MM"), sess.u);
  try { gravar_(col, p.pageId, g); }
  catch (e) {
    console.error("PORTAL-VENDA gravação falhou: " + String(e.message || e).slice(0, 120));
    return { ok: false, erro: "GRAVACAO_FALHOU" };
  }
  mudarPendentes_(p.pageId, function (x) { delete x.C2_COMPROVANTE; });
  var gravados = {}; gravados[C.C2_END] = g[C.C2_END];
  return { ok: true, pageId: p.pageId, dossie: est.estado, faltam: est.faltam, preenchidos: [C.C2_END], gravados: gravados };
}
