/* PreReserva — Termo de Pré-Reserva da unidade do condomínio (27/10/2026).
 * Arquivo do projeto PORTAL-VENDA (depois de PreReservaVenda, ContratoVenda, PortalVenda e GerarContrato).
 * Ações (PortalVenda.tratar_): preReservaEstado, salvarContaPreReserva, salvarPagamentoPreReserva (31/10), salvarConjugePreReserva (01/11), gerarTermoPreReserva, verTermoPreReserva;
 * a assinatura usa as mesmas ações do contrato com doc = "PRE_RESERVA" (AssinaturaVenda.gs).
 * Propriedades do script: MODELO_PRE_RESERVA_ID (Google Docs do termo), PASTA_PROVISORIA_ID e CIDADE_ASSINATURA (as do contrato).
 * 31/10/2026 (dono): valor e data do pagamento são da venda (colunas PRÉ-RESERVA - VALOR / DATA PAGAMENTO);
 * PRE_RESERVA_VALOR e PRE_RESERVA_DATA_LIMITE não são mais lidas. Prazo = pagamento + 7 dias corridos.
 * O termo sai direto (sem pré-termo grifado): PDF com carimbo [#hash] na coluna PRÉ-RESERVA - TERMO GERADO.
 * Log só com ação, pageId abreviado e resultado — nunca nome, CPF ou conta. */

function prCol_(pg, nome) {
  for (var n in pg.properties) if (RegrasVenda.chave(n) === RegrasVenda.chave(nome)) {
    if (pg.properties[n].type !== PreReservaVenda.TIPOS[nome]) throw new Error("TIPO_DE_COLUNA_ERRADO: " + nome);
    return n;
  }
  throw new Error("COLUNA_FALTANDO: " + nome);
}
function prTexto_(pg, nome) { return ctrTxt_(ctrValor_(pg.properties[prCol_(pg, nome)])).trim(); }
function prPagamento_(pg) {
  return { valor: PreReservaVenda.valorDe(ctrValor_(pg.properties[prCol_(pg, PreReservaVenda.COL.VALOR)])),
           data: PreReservaVenda.dataIso(ctrValor_(pg.properties[prCol_(pg, PreReservaVenda.COL.DATA_PAGAMENTO)])) };
}
function prArquivoGerado_(pg) {
  var lista = ctrValor_(pg.properties[prCol_(pg, PreReservaVenda.COL.GERADO)]) || [];
  if (!lista.length) return null;
  var f = lista[lista.length - 1];
  return { nome: ctrTxt_(f.name), url: f.type === "external" ? ((f.external || {}).url || "") : ((f.file || {}).url || "") };
}
function prCarimbo_(t, assinaturas) {
  var base = PreReservaVenda.baseCarimbo(t);
  if (assinaturas) base.assinaturas = assinaturas;   /* 01/11 (plano 23 B, correção 1): só com o modelo migrado */
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(base), Utilities.Charset.UTF_8);
  var h = "";
  for (var i = 0; i < 4; i++) h += ("0" + (b[i] & 255).toString(16)).slice(-2);
  return h;
}

/* Fontes do contrato (as mesmas da linha) + conta e Propriedades: { f, d, t, pg } ou { resp }. */
function prDados_(col, p, pid, rot) {
  if (!prop_("DB_VENDEDORES") || !prop_("DB_LOTEAMENTOS") || !prop_("DB_CORRETORES") || !prop_("DB_DOCUMENTOS")) return { resp: { ok: false, erro: "CADASTRO_NAO_CONFIGURADO" } };
  var f = ctrFontes_(col, p.pageId);
  var erro = f.condominioErro ? [f.condominioErro] : f.duplicados ? f.duplicados
    : f.obraAmbigua ? ["Vendedor: obra ambígua em DOCUMENTOS (endereço repetido)"]
    : f.obraNaoEncontrada ? ["Vendedor: obra da casa não encontrada em DOCUMENTOS (endereço)"] : null;
  if (erro) { ctrLog_(rot + " " + pid + " fontes"); return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: erro } }; }
  var d = ContratoVenda.montarDadosContrato(f.fontes);
  if (!d.condominio) return { resp: { ok: false, erro: "SO_CONDOMINIO" } };
  var pg = ctrLerPaginaVenda_(p.pageId);
  var pag = prPagamento_(pg);
  var t = PreReservaVenda.montar(d, { conta: prTexto_(pg, PreReservaVenda.COL.CONTA), valor: pag.valor,
                                      dataPagamento: pag.data, hojeISO: hoje_("yyyy-MM-dd"),
                                      cidade: prop_("CIDADE_ASSINATURA") || "Goiânia" });
  return { f: f, d: d, t: t, pg: pg };
}

/* 01/11/2026 (dono): o cônjuge do comprador só assina o TERMO se o corretor ligou a opção nesta venda. A escolha fica
   numa propriedade do script (como TESTEMUNHAS_<pageId>), sem coluna nova no Notion: PR_CONJUGE_<pageId> = "1". */
var PR_CONJUGE = "PR_CONJUGE_";
/* 01/11 (plano 23 B, correção 1): com o modelo migrado o termo escreve as testemunhas e o cônjuge — entram no carimbo */
function prAssinCarimbo_(d, pageId) {
  var a = ctrAssinCarimbo_(d, pageId);
  a.conjuge = prConjugeIncluido_(pageId);
  return a;
}
function prConjugeIncluido_(pageId) { return prop_(PR_CONJUGE + pageId) === "1"; }
/* comprador 1 casado ou em união estável com o cônjuge nomeado (as colunas ESTADO CIVIL e CONJUGE da venda) */
function prTemConjuge_(pg) {
  try {
    var v = ctrPorChave_(pg.properties);
    return !!ContratoVenda.conjugeDoComprador({ estadoCivil: ctrTxt_(ctrCampo_(v, "ESTADO CIVIL")), nome: ctrTxt_(ctrCampo_(v, "CONJUGE")) });
  } catch (e) { return false; }
}
function salvarConjugePreReserva_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  var pg = ctrLerPaginaVenda_(p.pageId);   /* só páginas da base de vendas (outra base lança PAGINA_DE_OUTRA_BASE) */
  /* com o envelope do termo aberto quem assina não muda: mesma regra das testemunhas (AssinaturaVenda.assEnvelopeAberto_) */
  if (assEnvelopeAberto_(pg, p.pageId, assDoc_({ doc: "PRE_RESERVA" })))
    return { ok: false, erro: "ENVELOPE_ABERTO", mensagem: "O termo já foi enviado para assinatura. Para mudar quem assina, cancele o envelope do termo primeiro." };
  var incluir = p.incluir === true || p.incluir === "true" || p.incluir === 1 || p.incluir === "1";
  if (incluir) PropertiesService.getScriptProperties().setProperty(PR_CONJUGE + p.pageId, "1");
  else { try { PropertiesService.getScriptProperties().deleteProperty(PR_CONJUGE + p.pageId); } catch (e) { ctrLog_("salvarConjugePreReserva " + pid + " propriedade nao apagada"); } }
  ctrLog_("salvarConjugePreReserva " + pid + (incluir ? " ligado" : " desligado") + " por " + ctrTxt_(sess && sess.u));
  return { ok: true, incluirConjuge: incluir };
}

function preReservaEstado_(col, p) {
  var pg = ctrLerPaginaVenda_(p.pageId), g = prArquivoGerado_(pg);
  var conta = prTexto_(pg, PreReservaVenda.COL.CONTA), pag = prPagamento_(pg);
  return { ok: true, conta: conta, contaCampos: PreReservaVenda.lerConta(conta), gerado: !!g, nome: g ? g.nome : "",
           valor: pag.valor, dataPagamento: pag.data, dataLimite: PreReservaVenda.prazoDe(pag.data),
           historico: prTexto_(pg, PreReservaVenda.COL.HISTORICO),
           temConjuge: prTemConjuge_(pg), incluirConjuge: prConjugeIncluido_(p.pageId) };
}

/* 01/11/2026: sinal da venda (ato + 30 + 60 + 90 da própria linha, sem ler cadastros); 0 = desconhecido — fluxo
   alterado no portal (FLUXO PERSONALIZADO) ou coluna ilegível não barra o valor. */
function prSinal_(pg) {
  try {
    var v = ctrPorChave_(pg.properties);
    var pers = ctrCampo_(v, "FLUXO PERSONALIZADO");
    if (pers !== null && pers !== undefined && ctrTxt_(pers).trim()) return 0;
    function n(nome) { return ctrNum_(ctrCampo_(v, nome)); }
    return PreReservaVenda.sinalDoFluxo({ sinalAto: n("VALOR SINAL ATO"), sinal30: n("VALOR SINAL 30 DIAS"),
                                          sinal60: n("VALOR SINAL 60 DIAS"), sinal90: n("VALOR SINAL 90 DIAS") });
  } catch (e) { return 0; }
}

/* 31/10: valor e data do pagamento da venda; mudar grava uma linha no histórico com o usuário do portal. */
function salvarPagamentoPreReserva_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  var basico = PreReservaVenda.validarPagamento({ valor: p.valor, data: p.data });   /* barato: sem ler a página */
  if (!basico.ok) return { ok: false, erro: basico.erro };
  var pg = ctrLerPaginaVenda_(p.pageId);
  /* 01/11: "hoje" é o do servidor (São Paulo), nunca o do navegador */
  var v = PreReservaVenda.validarPagamento({ valor: p.valor, data: p.data, hojeISO: hoje_("yyyy-MM-dd"), sinal: prSinal_(pg) });
  if (!v.ok) return { ok: false, erro: v.erro };
  var antes = prPagamento_(pg), C = PreReservaVenda.COL;
  var historico = prTexto_(pg, C.HISTORICO);
  var linha = PreReservaVenda.linhaHistorico(antes, v, ctrTxt_(sess && sess.u), hoje_("dd/MM/yyyy HH:mm"));
  if (linha) {
    var props = {};
    props[prCol_(pg, C.VALOR)] = propNotion_("number", v.valor);
    props[prCol_(pg, C.DATA_PAGAMENTO)] = propNotion_("date", v.data);
    historico = PreReservaVenda.juntarHistorico(historico, linha);
    props[prCol_(pg, C.HISTORICO)] = propNotion_("rich_text", historico);
    notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  }
  ctrLog_("salvarPagamentoPreReserva " + pid + (linha ? " ok" : " sem mudança") + " por " + ctrTxt_(sess && sess.u));
  return { ok: true, valor: v.valor, dataPagamento: v.data, dataLimite: PreReservaVenda.prazoDe(v.data), historico: historico, mudou: !!linha };
}

function salvarContaPreReserva_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), v = PreReservaVenda.validarConta(p.conta);
  if (!v.ok) return { ok: false, erro: v.erro };
  var pg = ctrLerPaginaVenda_(p.pageId), props = {};
  props[prCol_(pg, PreReservaVenda.COL.CONTA)] = propNotion_("rich_text", v.valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  ctrLog_("salvarContaPreReserva " + pid + " por " + ctrTxt_(sess && sess.u));
  return { ok: true, conta: v.valor, contaCampos: PreReservaVenda.lerConta(v.valor) };
}

function gerarTermoPreReserva_(col, sess, p) {
  var t0 = Date.now(), pid = String(p.pageId).slice(0, 8), rot = "gerarTermoPreReserva";
  var x = prDados_(col, p, pid, rot);
  if (x.resp) return x.resp;
  var faltas = PreReservaVenda.faltas(x.t);
  if (faltas.length) { ctrLog_(rot + " " + pid + " faltas " + faltas.length); return { ok: false, erro: "FALTAM_DADOS", faltas: faltas }; }
  if (typeof Drive === "undefined" || !Drive || !Drive.Files || !Drive.Files.remove) return { ok: false, erro: "DRIVE_API_DESLIGADA" };
  var modeloId = prop_("MODELO_PRE_RESERVA_ID"), pastaId = prop_("PASTA_PROVISORIA_ID"), modelo, pasta;
  if (!modeloId || !pastaId) return { ok: false, erro: "MODELO_NAO_CONFIGURADO" };
  try { modelo = DriveApp.getFileById(modeloId); pasta = DriveApp.getFolderById(pastaId); }
  catch (e) { ctrErro_(rot + " " + pid + " modelo inacessivel", e); return { ok: false, erro: "MODELO_NAO_CONFIGURADO" }; }
  var hash = prCarimbo_(x.t, ctrLerModelo_(modeloId).migrado ? prAssinCarimbo_(x.d, p.pageId) : null);
  var marc = PreReservaVenda.marcadores(x.t);
  /* 01/11 (plano 23 B): bloco de assinaturas do termo (modelo migrado); o cônjuge só com a opção da venda ligada.
     Erro aqui não derruba o modelo antigo; no migrado o marcador sobra e o termo não sai. */
  try { marc.ASSINATURAS_TERMO = ClicksignVenda.blocoAssinaturas(x.d, assConfig_(p.pageId), "PRE_RESERVA", { incluirConjuge: prConjugeIncluido_(p.pageId) }); }
  catch (e) { ctrErro_(rot + " " + pid + " bloco de assinaturas", e); }
  var g = ctrGerarPdf_({ modelo: modelo, pasta: pasta, marcadores: marc, blocos: {},
                         titulo: ClicksignVenda.tituloDocumento("TERMO DE PRÉ-RESERVA - ", x.f.endereco, x.f.casa, x.d.comprador1 && x.d.comprador1.nome) }, pid, rot, false);
  if (g.resp) return g.resp;
  var endereco = String(x.f.endereco).replace(/[\\\/:*?"<>|]/g, "-");
  var nome = "TERMO DE PRÉ-RESERVA - " + endereco + (x.f.casa ? " - CASA " + x.f.casa : "") + " - " + hoje_("dd-MM-yyyy") + " [#" + hash + "].pdf";
  try {
    anexarArquivo_(p.pageId, prCol_(x.pg, PreReservaVenda.COL.GERADO), { nome: nome, mime: "application/pdf", base64: Utilities.base64Encode(g.pdf.getBytes()) }, true);
  } catch (e) { ctrErro_(rot + " " + pid + " anexo", e); return { ok: false, erro: "CONTRATO_FALHOU" }; }
  ctrLog_(rot + " " + pid + " ok " + (Date.now() - t0) + "ms");
  return { ok: true, nome: nome };
}

/* PDF do termo gerado pela sessão do portal (como o pré-contrato): o link do arquivo não vai para a tela. */
function verTermoPreReserva_(col, p) {
  var pg = ctrLerPaginaVenda_(p.pageId), lista = ctrValor_(pg.properties[prCol_(pg, PreReservaVenda.COL.GERADO)]) || [];
  if (!lista.length) return { ok: false, erro: "SEM_TERMO_GERADO" };
  var f = lista[lista.length - 1], b = null;
  try { b = baixarArquivo_(f); } catch (e) { b = null; }
  if (!b || b.mime !== "application/pdf") return { ok: false, erro: "CONTRATO_ILEGIVEL" };
  if (b.base64.length * 3 / 4 > PRE_MAX_BYTES) return { ok: false, erro: "PRECONTRATO_GRANDE" };
  return { ok: true, nome: ctrTxt_(f.name) || "termo-pre-reserva.pdf", base64: b.base64 };
}
