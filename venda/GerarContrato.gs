/* GerarContrato — gera o contrato de compra e venda da casa (entrega 2).
 * Arquivo do projeto PORTAL-VENDA (depois de RegrasVenda, ContratoVenda e PortalVenda).
 * Fluxo: lê a casa + a obra + os 3 cadastros no Notion, monta os dados
 * (ContratoVenda), confere o obrigatório, copia o modelo (Google Doc) para a
 * pasta provisória, preenche marcadores e blocos, exporta PDF, sobe o PDF para
 * CONTRATO GERADO e APAGA a cópia (finally).
 * Propriedades do script: DB_VENDEDORES, DB_LOTEAMENTOS, DB_CORRETORES,
 * MODELO_PRONTO_ID, MODELO_CONSTRUCAO_ID, PASTA_PROVISORIA_ID, CIDADE_ASSINATURA
 * (opcional). Serviços: DocumentApp, DriveApp e Drive API avançada (v3).
 * Log só com ação, pageId abreviado, tempos e contagens — nunca valores. */

function ctrTxt_(v) { return v === null || v === undefined ? "" : String(v); }
function ctrNum_(v) { return typeof v === "number" && isFinite(v) ? v : null; }
function ctrLog_(msg) { console.log("PORTAL-VENDA " + msg); }
function ctrErro_(msg, e) { console.error("PORTAL-VENDA " + msg + ": " + String((e && e.message) || e).slice(0, 120)); }

/* Valor "solto" de uma propriedade do Notion (qualquer tipo que as colunas do contrato usam). */
function ctrValor_(pr) {
  if (!pr) return null;
  switch (pr.type) {
    case "title": case "rich_text": case "number": case "select": case "email": case "phone_number": case "files":
      return valorProp_(pr);
    case "multi_select": return (pr.multi_select || []).map(function (o) { return o.name; }).join(", ");
    case "date": return pr.date ? pr.date.start : null;
    case "checkbox": return pr.checkbox ? "SIM" : "NÃO";
    case "relation": return (pr.relation || []).map(function (r) { return r.id; });
    case "formula":
      var f = pr.formula || {};
      if (f.type === "date") return f.date ? f.date.start : null;
      return f[f.type] === undefined ? null : f[f.type];
    case "rollup":
      var ro = pr.rollup || {};
      if (ro.type === "array") return (ro.array || []).map(ctrValor_).filter(function (x) { return x !== null && x !== ""; }).join(", ");
      if (ro.type === "date") return ro.date ? ro.date.start : null;
      return ro[ro.type] === undefined ? null : ro[ro.type];
    default: return null;
  }
}

/* Propriedades de uma página indexadas por RegrasVenda.chave (tolerante a acento/caixa/espaço). */
function ctrPorChave_(props) {
  var m = {};
  for (var n in props) m[RegrasVenda.chave(n)] = props[n];
  return m;
}
function ctrCampo_(porChave, nome) { return ctrValor_(porChave[RegrasVenda.chave(nome)]); }
function ctrTitulo_(props) {
  for (var n in props) if (props[n] && props[n].type === "title") return ctrTxt_(ctrValor_(props[n]));
  return "";
}

function ctrLerPaginaVenda_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  var dbEsperado = prop_("DB_VENDAS").replace(/-/g, "");
  var dbAtual = String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "");
  if (dbAtual !== dbEsperado) throw new Error("PAGINA_DE_OUTRA_BASE");
  return pg;
}

function ctrLinhasBase_(dbId, filtro) {
  var linhas = [], cursor = null, voltas = 0;
  do {
    var corpo = { page_size: 100 };
    if (filtro) corpo.filter = filtro;
    if (cursor) corpo.start_cursor = cursor;
    var r = notion_("POST", "/databases/" + dbId + "/query", corpo);
    (r.results || []).forEach(function (l) { linhas.push(l.properties || {}); });
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++voltas < 10);
  return linhas;
}
/* Casa a linha do cadastro pelo TÍTULO, com RegrasVenda.chave dos dois lados. */
function ctrAcharLinha_(linhas, nome) {
  var k = RegrasVenda.chave(nome);
  if (!k) return null;
  for (var i = 0; i < linhas.length; i++) {
    if (RegrasVenda.chave(ctrTitulo_(linhas[i])) === k) return { titulo: ctrTitulo_(linhas[i]), c: ctrPorChave_(linhas[i]) };
  }
  return null;
}

/* Propriedades da linha de DOCUMENTOS (a obra) da casa, ou null. */
function ctrObraProps_(rels, endereco) {
  var db = prop_("DB_DOCUMENTOS"), dbLimpo = db.replace(/-/g, "");
  if (rels && rels.length) {
    try {
      var pg = notion_("GET", "/pages/" + rels[0], null);
      if (String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "") === dbLimpo) return pg.properties || {};
    } catch (e) { ctrErro_("contrato: relacao da obra ilegivel", e); }
  }
  var k = RegrasVenda.chave(endereco);
  if (!k) return null;
  var linhas = [];
  try { linhas = ctrLinhasBase_(db, { property: "ENDEREÇO", title: { equals: endereco } }); }
  catch (e) { ctrErro_("contrato: filtro por endereco falhou", e); }
  if (!linhas.length) linhas = ctrLinhasBase_(db, null);
  for (var i = 0; i < linhas.length; i++) if (RegrasVenda.chave(ctrTitulo_(linhas[i])) === k) return linhas[i];
  return null;
}

/* Colunas da VENDAS que o contrato exige além das do dossiê. */
var CTR_COLUNAS_VENDA = ["VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)", "COMISSÃO", "VALOR NA MÃO", "CORRETOR", "SETOR", "OBRA-AUTO"];

function ctrFontes_(col, pageId) {
  var C = RegrasVenda.COL, CV = ContratoVenda.COL;
  var pg = ctrLerPaginaVenda_(pageId), v = ctrPorChave_(pg.properties);
  var faltando = [];
  Object.keys(ContratoVenda.TIPOS).concat(CTR_COLUNAS_VENDA).forEach(function (nome) {
    if (!v[RegrasVenda.chave(nome)]) faltando.push(nome);
  });
  if (faltando.length) throw new Error("COLUNA_FALTANDO: " + faltando.join(", "));
  var errado = [];
  Object.keys(ContratoVenda.TIPOS).forEach(function (nome) {
    if (v[RegrasVenda.chave(nome)].type !== ContratoVenda.TIPOS[nome]) errado.push(nome);
  });
  if (errado.length) throw new Error("TIPO_DE_COLUNA_ERRADO: " + errado.join(", "));

  function dos(canon) { return ctrTxt_(ctrValor_(pg.properties[col.mapa[canon]])); }
  function cv(nome) { return ctrCampo_(v, nome); }
  function nomeReal(canon) {
    for (var n in pg.properties) if (RegrasVenda.chave(n) === RegrasVenda.chave(canon)) return n;
    return canon;
  }
  var venda = {
    CLIENTES: dos(C.CLIENTES), CPF: dos(C.CPF1), ENDERECO: ctrTitulo_(pg.properties),
    COMPRADOR1: { nacionalidade: dos(C.C1_NAC), estadoCivil: dos(C.C1_ESTCIV), profissao: dos(C.C1_PROF),
                  documento: dos(C.C1_DOC), endereco: dos(C.C1_END) },
    COMPRADOR2: { nome: dos(C.C2_NOME), cpf: dos(C.C2_CPF), nacionalidade: dos(C.C2_NAC), estadoCivil: dos(C.C2_ESTCIV),
                  profissao: dos(C.C2_PROF), documento: dos(C.C2_DOC), endereco: dos(C.C2_END) },
    ALVARA_NUMERO: cv(CV.ALVARA_NUMERO), ALVARA_DATA: cv(CV.ALVARA_DATA), HABITESE_NUMERO: cv(CV.HABITESE_NUMERO),
    MATRICULA_INDIVIDUAL: cv(CV.MATRICULA_INDIVIDUAL), CRI: cv(CV.CRI), AREA: ctrNum_(cv(CV.AREA)),
    CONFRONTACOES: cv(CV.CONFRONTACOES),
    SINAL_VALOR: ctrNum_(cv(CV.SINAL_VALOR)), SINAL_DATA: cv(CV.SINAL_DATA),
    ENTRADA_VALOR: ctrNum_(cv(CV.ENTRADA_VALOR)), ENTRADA_VENCIMENTO: cv(CV.ENTRADA_VENCIMENTO),
    INTERMEDIARIA_VALOR: ctrNum_(cv(CV.INTERMEDIARIA_VALOR)), INTERMEDIARIA_VENCIMENTO: cv(CV.INTERMEDIARIA_VENCIMENTO),
    FORMA_PAGAMENTO: cv(CV.FORMA_PAGAMENTO), COMISSAO_FORMA: cv(CV.COMISSAO_FORMA),
    COMISSAO_VENCIMENTO: cv(CV.COMISSAO_VENCIMENTO), COMISSAO_PAGA_POR: cv(CV.COMISSAO_PAGA_POR),
    PRAZO_CONCLUSAO: cv(CV.PRAZO_CONCLUSAO), CONDICOES_ESPECIAIS: cv(CV.CONDICOES_ESPECIAIS),
    VALOR_CONTRATO: ctrNum_(cv("VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)")), COMISSAO: ctrNum_(cv("COMISSÃO")),
    VALOR_NA_MAO: ctrNum_(cv("VALOR NA MÃO")), CORRETOR: ctrTxt_(cv("CORRETOR"))
  };
  var setor = ctrTxt_(cv("SETOR"));

  /* a obra: relação OBRA-AUTO se aponta para DOCUMENTOS; senão, pelo ENDEREÇO (título) */
  var props = ctrObraProps_(cv("OBRA-AUTO"), venda.ENDERECO);
  if (!props) return { obraNaoEncontrada: true };
  var op = ctrPorChave_(props);
  var obra = { obraFinalizada: ctrTxt_(ctrCampo_(op, "OBRA FINALIZADA?")), proprietario: ctrTxt_(ctrCampo_(op, "PROPRIETARIO DOCUMENTO")),
               cpfCnpj: ctrTxt_(ctrCampo_(op, "CPF/CNPJ")), dataHabitese: ctrTxt_(ctrCampo_(op, "DATA HABITE-SE")) };

  /* os três cadastros */
  var lv = ctrAcharLinha_(ctrLinhasBase_(prop_("DB_VENDEDORES")), obra.proprietario);
  var ll = ctrAcharLinha_(ctrLinhasBase_(prop_("DB_LOTEAMENTOS")), setor);
  var lc = ctrAcharLinha_(ctrLinhasBase_(prop_("DB_CORRETORES")), venda.CORRETOR);
  function t(l, nome) { return ctrTxt_(ctrCampo_(l.c, nome)); }
  var vendedor = lv ? {
    tipo: t(lv, "TIPO"), nome: lv.titulo, cpfCnpj: t(lv, "CPF/CNPJ"), endereco: t(lv, "ENDEREÇO / SEDE"),
    representanteNome: t(lv, "REPRESENTANTE NOME"), representanteCpf: t(lv, "REPRESENTANTE CPF"),
    representanteRg: t(lv, "REPRESENTANTE RG"), representanteNacionalidade: t(lv, "REPRESENTANTE NACIONALIDADE"),
    representanteEstadoCivil: t(lv, "REPRESENTANTE ESTADO CIVIL"),
    nacionalidade: t(lv, "NACIONALIDADE"), estadoCivil: t(lv, "ESTADO CIVIL"), profissao: t(lv, "PROFISSÃO"), rg: t(lv, "RG"),
    banco: t(lv, "BANCO"), agencia: t(lv, "AGÊNCIA"), operacao: t(lv, "OPERAÇÃO"), conta: t(lv, "CONTA"), pix: t(lv, "PIX")
  } : null;
  var loteamento = ll ? {
    denominacao: t(ll, "DENOMINAÇÃO"), municipioUf: t(ll, "MUNICÍPIO/UF"), matricula: t(ll, "MATRÍCULA DO LOTEAMENTO"),
    cartorio: t(ll, "CARTÓRIO"), prazoPosseDias: t(ll, "PRAZO POSSE (DIAS)"), prazoChavesDias: t(ll, "PRAZO CHAVES (DIAS ÚTEIS)")
  } : null;
  var corretor = lc ? {
    nome: lc.titulo, creci: t(lc, "CRECI"), cpfCnpj: t(lc, "CPF/CNPJ"), nacionalidade: t(lc, "NACIONALIDADE"),
    endereco: t(lc, "ENDEREÇO PROFISSIONAL"), email: t(lc, "E-MAIL")
  } : null;

  return {
    fontes: { venda: venda, obra: obra, vendedor: vendedor, loteamento: loteamento, corretor: corretor,
              hojeISO: hoje_("yyyy-MM-dd"), cidadeAssinatura: prop_("CIDADE_ASSINATURA") || "Goiânia" },
    endereco: venda.ENDERECO, casa: ctrTxt_(cv("CASA")), colGerado: nomeReal(CV.CONTRATO_GERADO)
  };
}

/* ---- Docs ---- */
function ctrApagarParagrafo_(p) {
  try { p.removeFromParent(); } catch (e) { p.setText(""); } /* último parágrafo do corpo não sai */
}
function aplicarBlocos_(body, blocos) {
  var pars = body.getParagraphs();
  for (var i = 0; i < pars.length; i++) {
    var m = /^\{\{#([A-Z0-9_]+)\}\}$/.exec(String(pars[i].getText()).trim());
    if (!m) continue;
    var fim = -1, alvo = "{{/" + m[1] + "}}";
    for (var j = i + 1; j < pars.length; j++) {
      if (String(pars[j].getText()).trim() === alvo) { fim = j; break; }
    }
    if (fim < 0) { ctrLog_("contrato: bloco sem fechamento (" + m[1] + ")"); continue; }
    var manter = !!blocos && blocos[m[1]] === true; /* chave desconhecida conta como falsa */
    for (var k = i; k <= fim; k++) if (k === i || k === fim || !manter) ctrApagarParagrafo_(pars[k]);
    if (!manter) i = fim; /* o miolo já saiu; um bloco aninhado dentro dele não conta */
  }
}
function aplicarMarcadores_(body, marcadores) {
  for (var chave in marcadores) {
    /* chaves duplas no valor digitado não podem virar marcador falso nem injetar outra chave */
    var valor = ctrTxt_(marcadores[chave]).replace(/\{\{|\}\}/g, "").replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
    body.replaceText("\\{\\{" + chave + "\\}\\}", valor);
  }
}
/* Nomes (só nomes) dos marcadores que sobraram no corpo; [] se está limpo. */
function ctrMarcadoresSobrando_(body) {
  var t = String(body.getText());
  if (t.indexOf("{{") < 0 && t.indexOf("}}") < 0) return [];
  var nomes = [], re = /\{\{[#\/]?([A-Za-z0-9_]+)\}\}/g, m;
  while ((m = re.exec(t)) !== null) if (nomes.indexOf(m[1]) < 0) nomes.push(m[1]);
  return nomes.length ? nomes : ["{{ }}"];
}
function apagarCopia_(id) {
  try {
    if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.remove) Drive.Files.remove(id);
    else {
      DriveApp.getFileById(id).setTrashed(true);
      console.log("PORTAL-VENDA contrato: copia na lixeira (Drive API avançada desligada)");
    }
  } catch (e) {
    ctrErro_("contrato: copia nao apagada", e);
    try { DriveApp.getFileById(id).setTrashed(true); } catch (_) {}
  }
}

/* ---- ações ---- */
function ctrArquivoGerado_(pg) {
  var v = ctrPorChave_(pg.properties), pr = v[RegrasVenda.chave(ContratoVenda.COL.CONTRATO_GERADO)];
  if (!pr) throw new Error("COLUNA_FALTANDO: " + ContratoVenda.COL.CONTRATO_GERADO);
  var lista = ctrValor_(pr) || [];
  if (!lista.length) return null;
  var f = lista[lista.length - 1];
  return { nome: ctrTxt_(f.name), url: f.type === "external" ? ((f.external || {}).url || "") : ((f.file || {}).url || "") };
}
function contratoEstado_(col, p) {
  var a = ctrArquivoGerado_(ctrLerPaginaVenda_(p.pageId));
  return a ? { ok: true, gerado: true, nome: a.nome, url: a.url } : { ok: true, gerado: false };
}

function gerarContrato_(col, sess, p) {
  var t0 = Date.now(), pid = String(p.pageId).slice(0, 8);
  if (!prop_("DB_VENDEDORES") || !prop_("DB_LOTEAMENTOS") || !prop_("DB_CORRETORES") || !prop_("DB_DOCUMENTOS")) return { ok: false, erro: "CADASTRO_NAO_CONFIGURADO" };

  var f = ctrFontes_(col, p.pageId);
  if (f.obraNaoEncontrada) {
    ctrLog_("gerarContrato " + pid + " obra nao encontrada");
    return { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra da casa não encontrada em DOCUMENTOS (endereço)"] };
  }
  var d = ContratoVenda.montarDadosContrato(f.fontes);
  var faltas = ContratoVenda.faltasContrato(d);
  if (faltas.length) {
    ctrLog_("gerarContrato " + pid + " faltas " + faltas.length);
    return { ok: false, erro: "FALTAM_DADOS", faltas: faltas };
  }

  var modeloId = prop_(d.modelo === "PRONTO" ? "MODELO_PRONTO_ID" : "MODELO_CONSTRUCAO_ID"), pastaId = prop_("PASTA_PROVISORIA_ID");
  if (!modeloId || !pastaId) return { ok: false, erro: "MODELO_NAO_CONFIGURADO" };
  var modelo, pasta, marcadores, blocos;
  try { modelo = DriveApp.getFileById(modeloId); pasta = DriveApp.getFolderById(pastaId); }
  catch (e) { ctrErro_("gerarContrato " + pid + " modelo inacessivel", e); return { ok: false, erro: "MODELO_NAO_CONFIGURADO" }; }
  try { marcadores = ContratoVenda.marcadores(d); blocos = ContratoVenda.blocos(d); }
  catch (e) { ctrErro_("gerarContrato " + pid + " montagem falhou", e); return { ok: false, erro: "CONTRATO_FALHOU" }; }

  var endereco = String(f.endereco).replace(/[\\\/:*?"<>|]/g, "-");
  var nomePdf = "CONTRATO - " + endereco + (f.casa ? " - CASA " + f.casa : "") + " - " + hoje_("dd-MM-yyyy") + ".pdf";
  var colGerado = f.colGerado;

  var copia = null;
  try {
    copia = modelo.makeCopy("contrato-provisorio-" + pid + "-" + Date.now(), pasta);
    var doc = DocumentApp.openById(copia.getId());
    aplicarBlocos_(doc.getBody(), blocos);
    aplicarMarcadores_(doc.getBody(), marcadores);
    var sobrando = ctrMarcadoresSobrando_(doc.getBody());
    if (sobrando.length) {
      ctrLog_("gerarContrato " + pid + " marcador sobrando: " + sobrando.join(", "));
      doc.saveAndClose();
      return { ok: false, erro: "MODELO_COM_MARCADOR_SOBRANDO", marcadores: sobrando }; /* o finally apaga a cópia */
    }
    doc.saveAndClose();
    var pdf = DriveApp.getFileById(copia.getId()).getAs("application/pdf");
    anexarArquivo_(p.pageId, colGerado, { nome: nomePdf, mime: "application/pdf", base64: Utilities.base64Encode(pdf.getBytes()) }, true);
  } catch (e) {
    ctrErro_("gerarContrato " + pid + " falhou", e);
    return { ok: false, erro: "CONTRATO_FALHOU" };
  } finally {
    if (copia) apagarCopia_(copia.getId());
  }

  var url = "";
  try { var a = ctrArquivoGerado_(ctrLerPaginaVenda_(p.pageId)); if (a) url = a.url; } catch (e) { ctrErro_("gerarContrato " + pid + " url", e); }
  ctrLog_("gerarContrato " + pid + " ok " + (Date.now() - t0) + "ms");
  return { ok: true, nome: nomePdf, url: url };
}
