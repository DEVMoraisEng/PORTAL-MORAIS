/* PORTAL-VENDA — dossiê do comprador (entrega 1).
 * Projeto do Apps Script SEPARADO do PORTAL-LEITURA/ESCRITA: um upload do
 * Code.gs do portal não apaga este, e vice-versa.
 * Arquivos do projeto: RegrasVenda.gs, ClaudeLeitor.gs, OpenAILeitor.gs, ContratoVenda.gs,
 * PortalVenda.gs, GerarContrato.gs, CondominioVenda.gs, GerarVendaCondominio.gs, RecebimentoVenda.gs (entrega 14),
 * UnidadesCondominio.gs, PreReservaVenda.gs e PreReserva.gs (27/10/2026: contrato final e termo de pré-reserva),
 * FiadoresVenda.gs (01/11/2026: bloco Fiadores da aba Contrato).
 * Propriedades do script: NOTION_TOKEN, SESSION_SECRET (os MESMOS do portal
 * daquele ambiente), DB_VENDAS, DB_VENDAS_COND (base das vendas do condomínio), PROVEDOR_IA (openai padrão | anthropic),
 * OPENAI_API_KEY (provedor openai), MODELO_IA (opcional, só openai),
 * ANTHROPIC_API_KEY (provedor anthropic, plano B).
 * Nenhum log com nome, CPF, endereço ou conteúdo de documento. */
var VERSAO_VENDA = "venda-v28";   // v28: contrato final sem o amarelo do texto fixo do modelo (05/11/2026); v27: casa de rua com comissão vazia não dá mais "valor de aquisição inválido" (05/11/2026); v26: comprovante sem conferir o titular, área do lote só da matrícula do imóvel (05/11/2026); v25: casa de rua — Ver/Excluir arquivo do dossiê (verArquivoEspaco, excluirArquivoEspaco), pagamento da comissão pelo cadastro do corretor, contrato gerado reserva 48 h (CONTRATO - GERADO EM) (05/11/2026); v24: financiamento pode baixar no Alterar fluxo até a carta de aprovação (05/11/2026); v23: contrato do condomínio revisto pelo advogado (04/11/2026) — entrada = parte do imóvel + comissão (ENTRADA_IMOVEL, ENTRADA_COMISSAO), percentuais sobre o preço do imóvel fechando 100%, nacionalidade BRASILEIRO/BRASILEIRA, permuta identificada no 4.2.1 c) com as obrigações no bloco COM_PERMUTA; v22: Trocar e-mail de quem ainda não assinou sem cancelar o envelope (assinaturaTrocarEmail; o envio guarda os requisitos de cada signatário em ASSINATURA_REQS_<envelope>_<signatário>) e mensagem do envelope "Segue o contrato da unidade…" (default_message; CLICKSIGN_MENSAGEM_CONTRATO/_TERMO trocam o texto) (03/11/2026); v21: vigia a cada 15 min com os eventos (progresso, termo de pré-reserva, e-mail na recusa/cancelamento/expiração) e pré-reserva dispensada quando o contrato é gerado direto (PRE_RESERVA_DISPENSADA) (03/11/2026); v20: AnexosMC.gs — contrato assinado numa venda já lançada e ZIP de todos os assinados vão ao Mais Controle pelo robô do servidor (mc-anexos), ação mcAnexar (03/11/2026); v19: envelope do contrato aberto trava as ações do contrato (ENVELOPE_ABERTO com mensagem, trava central em assTravaAssinado_) e o envio recusa CONTRATO_DESATUALIZADO com fluxo/condições gravados depois do contrato final (03/11/2026); v18: CRLV — observações do veículo (sem reserva de domínio = quitado), CPF/CNPJ e RENAVAM sem perder zero, permuta conta no sinal mínimo (03/11/2026); v17: lerCrlv — CRLV da permuta lido pela IA no formulário do bem, arquivo na coluna PERMUTA - CRLV (03/11/2026); v16: plano 23 — contrato/termo assinado só para ver (documentosAssinados, verDocumentoAssinado, trava CONTRATO_ASSINADO/TERMO_ASSINADO), assinatura na linha (ASSINATURA_LINHAS=1) e selfie (CLICKSIGN_SELFIE=1) (01/11/2026); v15: antecipacaoTexto, a antecipação copia a mensagem em vez de gerar PDF (31/10/2026); v14: FGTS e Financiamento separados na aba Financeiro (31/10/2026); v13: faltasCliente no contratoEstado (31/10/2026); v12: aba Financeiro, financeiroEstado (31/10/2026); v11: vigia de assinaturas (AssinaturaVigia.gs, 31/10/2026); v10: Corrigir aqui na conferência (31/10/2026); v9: contrato final do condomínio, termo de pré-reserva e etapas da venda (27/10/2026); v8: leitura em lote, certidão mãe e data do habite-se (entrega 13); v7: campos abertos e conta de recebimento no contrato (entrega 12); v6: documentos do imóvel lidos pela IA (entrega 11); v5: pré-contrato grifado (entrega 9)
var NOTION_VERSION = "2022-06-28";
var ERROS_CONHECIDOS = /^(COLUNA_FALTANDO|TIPO_DE_COLUNA_ERRADO|BACKEND_SEM_CONFIG|PAGINA_DE_OUTRA_BASE|PRECONTRATO_REFAZER|NOTION_OCUPADO|CONTRATO_EM_ASSINATURA)/;
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
    var grava = ["tipoCasa", "lerDocumento", "anexarDocumento", "soltarDocumento", "lerDocumentos", "copiarComprovante", "conferir", "devolver", "gerarContrato", "gerarPreContrato", "aprovarPreContrato", "escolherTestemunhas",
                 "salvarCamposContrato", "escolherContaRecebimento", "mcLancar", "mcAnexar" /* 03/11: AnexosMC.gs */, "assinaturaEnviar", "assinaturaEstado",
                 "gerarVendaCondominio", "assinaturaReenviar", "assinaturaCancelar" /* 29/10 */, "assinaturaTrocarEmail" /* 03/11 */, "salvarCondicoesEspeciais" /* 29/10 */, "redigirCondicoesEspeciais", "salvarFluxo" /* 29/10 */, "lerCrlv" /* 03/11: CRLV da permuta */, "salvarContaPreReserva", "salvarPagamentoPreReserva" /* 31/10 */, "salvarConjugePreReserva" /* 01/11 */, "gerarTermoPreReserva",
                 "conferirDocumentos", "confirmarConferencia" /* 28/10 */, "corrigirConferencia" /* 31/10 */, "salvarFiadores", "conjugeEhFiador2" /* 01/11: bloco Fiadores */,
                 "recebimentoConfirmar" /* entrega 14 */, "antecipacaoLer", "antecipacaoPdf" /* 31/10: AntecipacaoVenda.gs */,
                 "excluirArquivoEspaco" /* 05/11: Excluir um anexo do dossiê */].indexOf(p.action) >= 0;
    if (grava && String(sess.t || "").toUpperCase() === "TESTES") return { ok: false, erro: "SEM_PERMISSAO_TESTES" };
    if (p.action !== "ping" && !REGEX_PAGE_ID.test(String(p.pageId || ""))) return { ok: false, erro: "PAGINA_INVALIDA" };
    var col = colunas_();
    var trava = assTravaAssinado_(p);   /* 01/11 (plano 23 A): envelope ASSINADO = nada do que se assinou muda */
    if (trava) { ctrPaginaEmprestada_ = null; return trava; }
    var r;
    try { r = executar_(col, sess, p); } finally { ctrPaginaEmprestada_ = null; }
    if (grava && r && r.ok === true) logContrato_(sess, p, r);   /* 30/10: histórico do contrato (LogContrato.gs) */
    return r;
  } catch (err) {
    var m = String((err && err.message) || err);
    console.error("PORTAL-VENDA " + String(p.action || "") + " falhou: " + m.slice(0, 160));
    return { ok: false, erro: /^NOTION_OCUPADO/.test(m) ? "NOTION_OCUPADO" : ERROS_CONHECIDOS.test(m) ? m : "ERRO_INTERNO" };
  }
}

function executar_(col, sess, p) {
    switch (p.action) {
      case "estado":       return estado_(col, p, sess);
      case "tipoCasa":     return tipoCasa_(col, p);
      case "lerDocumento": return lerDocumento_(col, sess, p);
      case "anexarDocumento": return anexarDocumento_(col, p);
      case "soltarDocumento": return soltarDocumento_(col, p);
      case "verArquivoEspaco": return verArquivoEspaco_(col, p);              /* 05/11: Ver um anexo do dossiê (só leitura) */
      case "excluirArquivoEspaco": return excluirArquivoEspaco_(col, sess, p); /* 05/11: Excluir um anexo do dossiê */
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
      case "mcAnexar":     return mcAnexar_(col, sess, p);   /* 03/11: contrato/ZIP de novo ao Mais Controle */
      case "assinaturaEnviar": return assinaturaEnviar_(col, sess, p);
      case "assinaturaEstado": return assinaturaEstado_(col, p);
      case "assinaturaPrevia": return assinaturaPrevia_(col, p);   /* 01/11 (dono): prévia das assinaturas, só leitura */
      case "assinaturaPdf": return assinaturaPdf_(col, p);   /* 30/10: PDF do contrato para a tela achar as rubricas */
      case "assinaturaReenviar": return assinaturaReenviar_(col, sess, p);
      case "assinaturaCancelar": return assinaturaCancelar_(col, sess, p);   /* 29/10: botão Cancelar envelope */
      case "assinaturaTrocarEmail": return assinaturaTrocarEmail_(col, sess, p);   /* 03/11: e-mail errado sem cancelar o envelope */
      case "salvarCondicoesEspeciais": return salvarCondicoesEspeciais_(col, sess, p);   /* 29/10: item 16 do quadro-resumo */
      case "redigirCondicoesEspeciais": return redigirCondicoesEspeciais_(col, sess, p);   /* 29/10: só sugere, não grava */
      case "fluxoEditar":  return fluxoEditar_(col, sess, p);              /* 29/10: Alterar fluxo (FluxoVenda.gs) */
      case "salvarFluxo":  return salvarFluxo_(col, sess, p);
      case "lerCrlv":      return lerCrlv_(col, sess, p);                 /* 03/11: CRLV da permuta lido pela IA (FluxoVenda.gs) */
      case "gerarVendaCondominio": return gerarVendaCondominio_(col, sess, p);
      /* entrega 14: contrato assinado pelo portal e recebimentos (RecebimentoVenda.gs) */
      case "verContratoAssinado": return verContratoAssinado_(col, p);
      case "documentosAssinados": return documentosAssinados_(col, p);       /* 01/11 (plano 23 A): só leitura */
      case "verDocumentoAssinado": return verDocumentoAssinado_(col, p);
      /* 27/10/2026: Termo de Pré-Reserva (PreReserva.gs); a assinatura usa as ações acima com doc = "PRE_RESERVA" */
      case "preReservaEstado": return preReservaEstado_(col, p);
      case "salvarContaPreReserva": return salvarContaPreReserva_(col, sess, p);
      case "salvarPagamentoPreReserva": return salvarPagamentoPreReserva_(col, sess, p);
      case "salvarConjugePreReserva": return salvarConjugePreReserva_(col, sess, p);   /* 01/11: opção de incluir o cônjuge no termo */
      case "gerarTermoPreReserva": return gerarTermoPreReserva_(col, sess, p);
      case "verTermoPreReserva": return verTermoPreReserva_(col, p);
      /* 28/10: termos de confissão de dívida (Confissao.gs) */
      case "verConfissao": return verConfissao_(col, p);
      /* 28/10: conferência dos documentos pela IA (Conferencia.gs) */
      case "conferirDocumentos": return conferirDocumentos_(col, sess, p);
      case "conferenciaEstado": return conferenciaEstado_(col, p);
      case "confirmarConferencia": return confirmarConferencia_(col, sess, p);
      case "verDocumentoConferencia": return verDocumentoConferencia_(col, p);
      case "corrigirConferenciaCampos": return corrigirConferenciaCampos_(col, p);   /* 31/10: Corrigir aqui */
      case "corrigirConferencia": return corrigirConferencia_(col, sess, p);
      /* 01/11: bloco Fiadores (e cônjuge do comprador) na aba Contrato — Conferencia.gs + FiadoresVenda.js */
      case "salvarFiadores": return salvarFiadores_(col, sess, p);
      case "conjugeEhFiador2": return conjugeEhFiador2_(col, sess, p);
      case "financeiroEstado": return financeiroEstado_(col, p);   /* 31/10: aba Financeiro (FinanceiroVenda.gs), só leitura */
      /* 31/10: antecipação de parcelas (AntecipacaoVenda.gs): estado, pedir o retrato ao robô e PDF para o cliente */
      case "antecipacaoEstado": return antecipacaoEstado_(col, p);
      case "antecipacaoLer":    return antecipacaoLer_(col, sess, p);
      case "antecipacaoTexto":  return antecipacaoTexto_(col, sess, p);   /* 31/10: só o texto do WhatsApp, não grava (fora da lista grava) */
      case "antecipacaoPdf":    return antecipacaoPdf_(col, sess, p);
      case "recebimentoEstado": return recebimentoEstado_(col, p);
      case "recebimentoConfirmar": return recebimentoConfirmar_(col, sess, p);
      default: return { ok: false, erro: "ACAO_DESCONHECIDA" };
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
  if (code === 429) throw new Error("NOTION_OCUPADO: tente de novo em 1 minuto");   /* 01/11: fila do Notion cheia — a tela diz para esperar */
  if (code >= 300) throw new Error("NOTION_" + code + ": " + String((data && data.message) || "").slice(0, 120));
  return data;
}

function colunas_() {
  /* O cache guarda só o necessário das colunas RESOLVIDAS (nome real, tipo,
     opções se select) — não o schema inteiro da base, que numa VENDAS com
     muitas colunas pode passar do limite de ~100 KB do CacheService e
     lançar, derrubando toda ação. Falha ao gravar no cache não é grave:
     só custa buscar o schema de novo na próxima chamada. */
  var cache = CacheService.getScriptCache(), k = "venda_schema_v4", txt = cache.get(k), schema;
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
    /* 05/11/2026: qualificação do proprietário lida da matrícula — opcionais; faltar não impede o cache */
    var preV = R.resolverColunas(completo, R.COL_VENDEDOR_MAT, R.TIPOS_VENDEDOR_MAT);
    schema = {};
    [pre, preI, preO, preV].forEach(function (x) { for (var canon in x.mapa) { var real = x.mapa[canon]; schema[real] = completo[real]; } });
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
  var rv = R.resolverColunas(schema, R.COL_VENDEDOR_MAT, R.TIPOS_VENDEDOR_MAT);
  if (!imovelErro) for (var cv in rv.mapa) if (rv.tipoErrado.indexOf(cv) < 0) mapa[cv] = rv.mapa[cv];
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
      else if (RegrasVenda.chave(n) === "OBRA-AUTO" && pr.type === "relation") ctx.obraRel = (pr.relation || []).map(function (x) { return x.id; });
      /* 05/11/2026: espaços que o robô diário dos documentos do Orçamento do MC anexou (estado_ passa para os pendentes) */
      else if (RegrasVenda.chave(n) === RegrasVenda.chave(RegrasVenda.COL_MC_DOCS.NOVOS) && pr.type === "rich_text") {
        ctx.novosMC = String(valorProp_(pr) || ""); ctx.novosMCcol = n;
      }
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
/* entrega 13: tipo da casa pela obra (DOCUMENTOS "OBRA FINALIZADA?" = SIM → CASA PRONTA; senão CASA EM CONSTRUÇÃO).
   Usa a busca da obra do contrato (ctrObraProps_, GerarContrato.gs: relação OBRA-AUTO ou ENDEREÇO). "" = obra não achada.
   Guarda 10 min no cache (estado é chamado a cada abertura da casa). */
function tipoCasaPelaObra_(pageId, ctx) {
  if (typeof ctrObraProps_ !== "function" || typeof ctrPorChave_ !== "function") return "";
  if (!prop_("DB_DOCUMENTOS") && !(ctx.obraRel && ctx.obraRel.length)) return "";
  var cache = CacheService.getScriptCache(), k = "venda_tipo_obra_" + String(pageId).replace(/-/g, "");
  var c = cache.get(k);
  if (c !== null && c !== undefined) return c;
  var tipo = "";
  try {
    var props = ctrObraProps_(ctx.obraRel || [], ctx.endereco || "", null);
    if (props && props.ambigua !== true) tipo = RegrasVenda.tipoPelaObra(ctrCampo_(ctrPorChave_(props), "OBRA FINALIZADA?"));
  } catch (e) { console.error("PORTAL-VENDA tipo pela obra falhou: " + String(e.message || e).slice(0, 120)); }
  try { cache.put(k, tipo, 600); } catch (e2) {}
  return tipo;
}
function estado_(col, p, sess) {
  var ctx = {}, a = lerPagina_(col, p.pageId, ctx), C = RegrasVenda.COL, tipoAuto = false;
  /* sem tipo, ou com o antigo CASA DE RUA: grava o tipo da obra (quem não é TESTES); a pessoa pode trocar */
  if (RegrasVenda.tipoCasaPrecisaDaObra(a[C.TIPO_CASA])) {
    var sugerido = tipoCasaPelaObra_(p.pageId, ctx);
    if (sugerido && String((sess && sess.t) || "").toUpperCase() !== "TESTES") {
      try { var g = {}; g[C.TIPO_CASA] = sugerido; gravar_(col, p.pageId, g); a[C.TIPO_CASA] = sugerido; tipoAuto = true; }
      catch (e) { console.error("PORTAL-VENDA tipo pela obra não gravou: " + String(e.message || e).slice(0, 120)); }
    }
  }
  var imovel = estadoImovel_(col, a);
  var pendAgora = lerPendentes_(p.pageId);
  /* 05/11/2026 (dono): o que o robô do servidor anexou do Mais Controle (Obras > Orçamento) entra como "novo, não lido" */
  var novosMC = ctx.novosMCcol ? RegrasVenda.espacosDoTexto(ctx.novosMC) : [];
  if (ctx.novosMCcol && String(ctx.novosMC || "").trim()) {
    novosMC.forEach(function (id) { RegrasVenda.marcarPendente(pendAgora, id, false); });
    if (String((sess && sess.t) || "").toUpperCase() !== "TESTES") importarNovosMC_(p.pageId, ctx.novosMCcol, novosMC);
  }
  var arqs = RegrasVenda.contarArquivos(a);
  if (!imovel.erro) for (var k in imovel.arquivos) arqs[k] = imovel.arquivos[k];
  /* 05/11: nomes dos arquivos de cada espaço (comprador e imóvel), na ordem da coluna — a tela lista e oferece Ver/Excluir.
     arquivos (só a contagem) segue igual para a tela antiga. */
  var nomes = nomesArquivos_(a, RegrasVenda.ESPACOS);
  if (!imovel.erro) { var ni = nomesArquivos_(a, RegrasVenda.ESPACOS_IMOVEL); for (var kn in ni) nomes[kn] = ni[kn]; }
  return { ok: true, tipoCasa: a[C.TIPO_CASA] || "", tipoCasaPelaObra: tipoAuto, arquivos: RegrasVenda.contarArquivos(a),
           arquivosNomes: nomes, comprador2ComDados: comprador2ComDados_(a),
           dossie: a[C.DOSSIE] || "", observacao: a[C.OBS] || "", doisCompradores: RegrasVenda.temDoisCompradores(a),
           imovel: imovel,
           /* entrega 13: espaços com arquivo anexado e ainda não lido (os dois grupos), na ordem de leitura */
           pendentes: RegrasVenda.pendentesValidos(pendAgora, arqs) };
}
/* Passa os espaços da coluna DOSSIÊ IMÓVEL - NOVOS DO MAIS CONTROLE para os pendentes (Propriedade venda_pend_) e
   esvazia a coluna. Só limpa depois de gravar os pendentes; falha aqui nunca derruba o estado (fica para a próxima). */
function importarNovosMC_(pageId, colReal, ids) {
  var pend = ids.length ? mudarPendentes_(pageId, function (x) { ids.forEach(function (id) { RegrasVenda.marcarPendente(x, id, false); }); }) : {};
  if (!pend) return;
  try { var pr = {}; pr[colReal] = { rich_text: [] }; notion_("PATCH", "/pages/" + pageId, { properties: pr }); }
  catch (e) { console.error("PORTAL-VENDA novos do MC não limpou: " + String(e.message || e).slice(0, 120)); }
}
function nomesArquivos_(a, espacos) {
  var r = {};
  Object.keys(espacos).forEach(function (id) {
    r[id] = (a[espacos[id].coluna] || []).map(function (f) { return String((f && f.name) || "arquivo"); });
  });
  return r;
}
/* 05/11: algum campo COMPRADOR 2 - * preenchido (texto ou arquivo) — com o seletor do dossiê em 1, a tela avisa que ele
   ainda sai no contrato. Nada é apagado sozinho. */
function comprador2ComDados_(a) {
  return Object.keys(a).some(function (k) { return /^COMPRADOR 2 - /.test(RegrasVenda.chave(k)) && !RegrasVenda.vazio(a[k]); });
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
/* 01/11: esvazia uma coluna de arquivos (anexarArquivo_ só acrescenta ou troca) */
function limparArquivos_(pageId, colReal) {
  var props = {}; props[colReal] = { files: [] };
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
    var obs = plano.observacoes.slice(), preenchidos = [], semVend = [];
    for (var c in plano.props) {
      if (!col.mapa[c]) {   // coluna opcional que a base não tem: não grava, avisa
        if (R.TIPOS_VENDEDOR_MAT[c]) { semVend.push(c); continue; }   // 05/11: um aviso só para a qualificação do proprietário
        obs.push(it.esp.rotulo + ": a coluna " + c + " não existe na base — o valor lido não foi gravado");
        continue;
      }
      g[c] = plano.props[c]; depois[c] = plano.props[c];
      if (plano.preenchidos.indexOf(c) >= 0) preenchidos.push(c);
    }
    if (semVend.length) obs.push(it.esp.rotulo + ": a qualificação do proprietário não foi gravada — faltam na base as colunas " + semVend.join(", "));
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

/* 05/11/2026: Ver e Excluir um anexo do dossiê (lista "N arquivos" da linha do documento).
 * p.n = posição do arquivo na coluna (0 = o primeiro), como veio em arquivosNomes do estado.
 * Ver só lê (o link do Notion não vai para a tela: o arquivo volta em base64, como o verDocumentoConferencia). */
function arquivoDoEspaco_(col, p) {
  var esp = RegrasVenda.espaco(p.espaco);
  if (!esp) return { erro: "ESPACO_DESCONHECIDO" };
  if (esp.grupo === "imovel" && col.imovelErro) return { erro: col.imovelErro };
  if (!col.mapa[esp.coluna]) return { erro: "COLUNA_FALTANDO: " + esp.coluna };
  var a = lerPagina_(col, p.pageId), lista = a[esp.coluna] || [];
  if (!lista.length) return { erro: "SEM_ARQUIVO" };
  var n = Number(p.n);
  if (!(n >= 0 && n < lista.length && Math.floor(n) === n)) return { erro: "ARQUIVO_MUDOU" };
  return { esp: esp, a: a, lista: lista, n: n };
}
function verArquivoEspaco_(col, p) {
  var x = arquivoDoEspaco_(col, p);
  if (x.erro) return { ok: false, erro: x.erro };
  if (p.nome !== undefined && p.nome !== null && String(p.nome) !== String(x.lista[x.n].name || "")) return { ok: false, erro: "ARQUIVO_MUDOU" };
  var b = null;
  try { b = baixarArquivo_(x.lista[x.n]); } catch (e) { b = null; }
  if (!b) return { ok: false, erro: "ARQUIVO_NAO_LEGIVEL" };
  return { ok: true, nome: String(x.lista[x.n].name || "arquivo"), mime: b.mime, base64: b.base64, n: x.n, total: x.lista.length };
}
/* Tira só o arquivo n da coluna do espaço (a API do Notion troca a lista inteira: os outros são reenviados como
 * {type:"file"}). p.nome tem de bater com o nome do arquivo n — se a lista mudou (outra pessoa anexou ou excluiu),
 * ARQUIVO_MUDOU e nada é apagado. Espaço vazio depois: sai dos "novos para ler" e o dossiê conferido (ou lido)
 * volta a ser conferido — a FALTA DOCUMENTO se faltar um obrigatório, senão LIDO PELA IA – CONFERIR.
 * Os dados que a IA já leu desse documento ficam (decisão do dono). Uma escrita só no Notion. */
function excluirArquivoEspaco_(col, sess, p) {
  var R = RegrasVenda, x = arquivoDoEspaco_(col, p);
  if (x.erro) return { ok: false, erro: x.erro };
  var alvo = x.lista[x.n];
  if (!String(p.nome || "") || String(p.nome) !== String(alvo.name || "")) return { ok: false, erro: "ARQUIVO_MUDOU" };
  var resto = x.lista.filter(function (_, i) { return i !== x.n; });
  var props = {};
  props[col.mapa[x.esp.coluna]] = { files: resto.map(R.manterArquivo) };
  var grupo = x.esp.grupo === "imovel" ? "imovel" : "comprador", D = colunasDossie_(grupo), depois = {}, g = {};
  for (var k in x.a) depois[k] = x.a[k];
  depois[x.esp.coluna] = resto;
  var est = null, atual = String(x.a[D.estado] || "");
  if (!resto.length && (atual === R.ESTADOS.CONFERIDO || atual === R.ESTADOS.LIDO)) {
    est = grupo === "imovel" ? R.estadoImovelAposLeitura(R.contarArquivos(depois, R.ESPACOS_IMOVEL))
                             : R.estadoAposLeitura(R.contarArquivos(depois), R.temDoisCompradores(depois));
    if (est.estado !== atual) g[D.estado] = est.estado;
  }
  g[D.obs] = R.juntarObservacoes(x.a[D.obs], [x.esp.rotulo + ": arquivo " + String(alvo.name || "") + " excluído pelo portal" +
    (g[D.estado] ? " — dossiê voltou a " + g[D.estado] : "")], hoje_("dd/MM"), sess.u);
  for (var canon in g) {
    var real = col.mapa[canon], tipo = col.schema[real].tipo, v = g[canon];
    if (tipo === "select") v = R.resolverOpcao(col.schema[real].opcoes, v);
    props[real] = propNotion_(tipo, v);
  }
  try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); }
  catch (e) {
    if (/^NOTION_OCUPADO/.test(String(e.message || e))) throw e;
    console.error("PORTAL-VENDA exclusão de arquivo falhou: " + String(e.message || e).slice(0, 120));
    return { ok: false, erro: "GRAVACAO_FALHOU" };
  }
  var pend = null;
  if (!resto.length) pend = mudarPendentes_(p.pageId, function (o) { delete o[p.espaco]; });
  var r = { ok: true, pageId: p.pageId, espaco: p.espaco, total: resto.length, grupo: grupo };
  if (g[D.estado]) r.dossie = g[D.estado];
  if (pend) r.pendentes = R.ordenarEspacos(Object.keys(pend));
  return r;
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

/* "Soltar todos os documentos" (entrega 13): um arquivo por chamada (a tela manda vários em paralelo).
 * 1) a IA só CLASSIFICA o arquivo (que documento é e, se de pessoa, nome/CPF) — pedido curto, saída mínima;
 * 2) RegrasVenda.decidirEspaco: documento do imóvel / aprovação da Caixa → guarda no espaço e marca como novo;
 *    identidade / comprovante (de PESSOA) → NÃO guarda: devolve o nome lido e a sugestão de comprador; a tela
 *    pergunta "quem é o comprador 1 e o 2" e só depois de "Confirmar compradores" guarda (anexarDocumento);
 *    não reconhecido → não guarda; a tela pergunta "isto é: …".
 * A leitura de verdade é a do "Ler documentos" (instruções de cada espaço, arquivos do espaço juntos).
 * O nome lido volta só para a tela de quem enviou; nada de nome/CPF em log nem nas Propriedades.
 * pessoa.chave: hash curto do nome (ou do CPF, sem nome) para a tela juntar os arquivos da mesma pessoa. */
function hashCurto_(pageId, s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(pageId) + "|" + s, Utilities.Charset.UTF_8)).slice(0, 16);
}
function soltarDocumento_(col, p) {
  var R = RegrasVenda;
  var chk = R.conferirArquivo(p.arquivo);
  if (!chk.ok) return { ok: false, erro: chk.erro };
  var a = lerPagina_(col, p.pageId);   // só página da VENDAS deste ambiente
  var ia = leitorIA_();
  if (ia.erro) return { ok: false, erro: ia.erro };
  var pedido = ia.leitor.montarPedido("classificar", [p.arquivo], ia.chave, ia.modelo, "");
  if (pedido.erro) return { ok: false, erro: pedido.erro };
  var res;
  try {
    var r = UrlFetchApp.fetch(pedido.url, { method: "post", contentType: "application/json", muteHttpExceptions: true,
                                           headers: pedido.headers, payload: JSON.stringify(pedido.corpo) });
    res = ia.leitor.interpretarResposta(r.getResponseCode(), r.getContentText());
  } catch (e) { res = { ok: false, erro: "LEITURA_FALHOU" }; }
  if (!res.ok) return { ok: false, erro: res.erro };
  console.log("PORTAL-VENDA classificar " + ia.nome + " tokens " + res.uso.entrada + "/" + res.uso.saida);

  var d = R.decidirEspaco(res.leitura, a);
  if (d.pessoa) {
    var nome = String(res.leitura.nome || "").replace(/\s+/g, " ").trim().slice(0, 120);
    var toks = R.tokensNome(nome), cpf = R.soDigitos(res.leitura.cpf);
    var base = toks.length ? "nome:" + toks.join(" ") : cpf.length === 11 ? "cpf:" + cpf : "";
    return { ok: true, pageId: p.pageId, espaco: null, tipo: d.tipo, motivo: d.motivo, sugestao: d.sugestao,
             pessoa: { nome: nome, chave: base ? hashCurto_(p.pageId, base) : "" } };
  }
  var esp = d.espaco ? R.espaco(d.espaco) : null;
  if (esp && ((esp.grupo === "imovel" && col.imovelErro) || !col.mapa[esp.coluna])) { esp = null; d = { espaco: null, tipo: d.tipo, motivo: "SEM_COLUNA" }; }
  if (!esp) return { ok: true, pageId: p.pageId, espaco: null, tipo: d.tipo, motivo: d.motivo };
  try { anexarArquivo_(p.pageId, col.mapa[esp.coluna], p.arquivo, false); }
  catch (e) {
    console.error("PORTAL-VENDA upload falhou: " + String(e.message || e).slice(0, 120));
    return { ok: false, erro: "UPLOAD_FALHOU" };
  }
  mudarPendentes_(p.pageId, function (x) { R.marcarPendente(x, d.espaco, false); });
  return { ok: true, pageId: p.pageId, espaco: d.espaco, tipo: d.tipo, guardado: true };
}
