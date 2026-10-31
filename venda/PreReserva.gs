/* PreReserva — Termo de Pré-Reserva da unidade do condomínio (27/10/2026).
 * Arquivo do projeto PORTAL-VENDA (depois de PreReservaVenda, ContratoVenda, PortalVenda e GerarContrato).
 * Ações (PortalVenda.tratar_): preReservaEstado, salvarContaPreReserva, salvarPagamentoPreReserva (31/10), gerarTermoPreReserva, verTermoPreReserva;
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
function prCarimbo_(t) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(PreReservaVenda.baseCarimbo(t)), Utilities.Charset.UTF_8);
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

function preReservaEstado_(col, p) {
  var pg = ctrLerPaginaVenda_(p.pageId), g = prArquivoGerado_(pg);
  var conta = prTexto_(pg, PreReservaVenda.COL.CONTA), pag = prPagamento_(pg);
  return { ok: true, conta: conta, contaCampos: PreReservaVenda.lerConta(conta), gerado: !!g, nome: g ? g.nome : "",
           valor: pag.valor, dataPagamento: pag.data, dataLimite: PreReservaVenda.prazoDe(pag.data),
           historico: prTexto_(pg, PreReservaVenda.COL.HISTORICO) };
}

/* 31/10: valor e data do pagamento da venda; mudar grava uma linha no histórico com o usuário do portal. */
function salvarPagamentoPreReserva_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), v = PreReservaVenda.validarPagamento({ valor: p.valor, data: p.data });
  if (!v.ok) return { ok: false, erro: v.erro };
  var pg = ctrLerPaginaVenda_(p.pageId), antes = prPagamento_(pg), C = PreReservaVenda.COL;
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
  var hash = prCarimbo_(x.t);
  var g = ctrGerarPdf_({ modelo: modelo, pasta: pasta, marcadores: PreReservaVenda.marcadores(x.t), blocos: {} }, pid, rot, false);
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
