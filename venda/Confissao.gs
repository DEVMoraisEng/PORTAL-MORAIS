/* Confissao.gs — TERMOS DE CONFISSÃO DE DÍVIDA do condomínio no Apps Script PORTAL-VENDA (28/10/2026).
 * Regras puras em ConfissaoVenda.js. Gerados junto com o contrato FINAL ("Conferi"), com o MESMO carimbo
 * no nome do PDF — é por ele que a assinatura sabe que os termos são deste contrato. Ligados quando a
 * Propriedade MODELO_CONFISSAO_PRE_ID existe (MODELO_CONFISSAO_POS_ID só é exigida com parcelas pós-chaves).
 * Ações: verConfissao (PDF do termo pela sessão do portal). Log só com ação, pageId abreviado e resultado. */

/* Gera e anexa os termos desta venda: { nomes } ou { resp } (resposta de erro pronta). */
function cfdGerarTermos_(prep, p, pid, rot) {
  var tipos = ConfissaoVenda.quais(prep.d), nomes = [];
  var pg = ctrLerPaginaVenda_(p.pageId);
  if (!tipos.length) { cfdLimparForaDe_(pg, p.pageId, tipos, pid, rot); return { nomes: nomes }; }
  for (var i = 0; i < tipos.length; i++) {
    var tipo = tipos[i], modeloId = prop_(ConfissaoVenda.MODELO[tipo]), modelo;
    if (!modeloId) { ctrLog_(rot + " " + pid + " sem modelo do termo " + tipo); return { resp: { ok: false, erro: "MODELO_NAO_CONFIGURADO" } }; }
    try { modelo = DriveApp.getFileById(modeloId); }
    catch (e) { ctrErro_(rot + " " + pid + " modelo do termo " + tipo, e); return { resp: { ok: false, erro: "MODELO_NAO_CONFIGURADO" } }; }
    var nomeCol = tipo === "POS" ? ConfissaoVenda.COL.POS_GERADO : ConfissaoVenda.COL.PRE_GERADO, col = cfdCol_(pg, nomeCol);
    if (!col) return { resp: { ok: false, erro: "COLUNA_FALTANDO: " + nomeCol } };
    var marc = ConfissaoVenda.marcadores(prep.d, tipo);
    /* 01/11 (plano 23 B): bloco de assinaturas do termo (modelo migrado), com os fiadores e os cônjuges deles */
    try { marc.ASSINATURAS_TERMO = ClicksignVenda.blocoAssinaturas(prep.d, assConfig_(p.pageId), "TERMO"); }
    catch (e) { ctrErro_(rot + " " + pid + " bloco de assinaturas do termo " + tipo, e); }   /* modelo antigo segue; o migrado para no marcador sobrando */
    var g = ctrGerarPdf_({ modelo: modelo, pasta: prep.pasta, marcadores: marc, blocos: {},
                           titulo: ClicksignVenda.tituloDocumento(ConfissaoVenda.PREFIXO[tipo], prep.f.endereco, prep.f.casa, prep.d.comprador1 && prep.d.comprador1.nome) },
                         pid, rot + " termo " + tipo, false);
    if (g.resp) return g;
    var nome = ConfissaoVenda.PREFIXO[tipo] + prep.resto;
    try {
      anexarArquivo_(p.pageId, col, { nome: nome, mime: "application/pdf", base64: Utilities.base64Encode(g.pdf.getBytes()) }, true);
    } catch (e) { ctrErro_(rot + " " + pid + " anexo do termo " + tipo, e); return { resp: { ok: false, erro: "CONTRATO_FALHOU" } }; }
    nomes.push(nome);
  }
  cfdLimparForaDe_(pg, p.pageId, tipos, pid, rot);   /* 01/11: só depois de gerar os novos — se falharem, nada muda */
  ctrLog_(rot + " " + pid + " termos de confissao " + nomes.length);
  return { nomes: nomes };
}

/* 01/11: envelope com os signatários (ou prestes a ir): situação não final, ou envio pendente. Nesse caso os termos
 * da coluna são os que estão sendo assinados — nada é limpo. Colunas da assinatura ausentes = sem envelope. */
function cfdEnvelopeComSignatarios_(pg, pageId) {
  if (prop_(ASS_PENDENTE + pageId)) return true;
  var cols;
  try { cols = assColunas_(pg); } catch (e) { return false; }
  return !ClicksignVenda.podeEnviar(assTexto_(pg, cols.ENVELOPE), assTexto_(pg, cols.SITUACAO));
}

/* 01/11: esvazia as colunas GERADA dos termos que este contrato não tem (voltou para 24x, ou 48x→36x sem PRÉ). */
function cfdLimparForaDe_(pg, pageId, tipos, pid, rot) {
  if (cfdEnvelopeComSignatarios_(pg, pageId)) return;
  ["PRE", "POS"].forEach(function (tipo) {
    if (tipos.indexOf(tipo) >= 0) return;
    var col = cfdCol_(pg, tipo === "POS" ? ConfissaoVenda.COL.POS_GERADO : ConfissaoVenda.COL.PRE_GERADO);
    if (!col || !(ctrValor_(pg.properties[col]) || []).length) return;
    /* 01/11: limpar é arrumação — se falhar, o "Conferi" não pode abortar com os termos novos já anexados */
    try { limparArquivos_(pageId, col); }
    catch (e) { ctrErro_(rot + " " + pid + " limpeza do termo antigo falhou", e); return; }
    ctrLog_(rot + " " + pid + " termo " + tipo + " antigo removido");
  });
}

/* Termos gerados nesta linha (para a tela): [{ tipo, nome }]. */
function cfdEstado_(pg) {
  if (!cfdLigado_()) return null;
  var out = [], contrato = ctrArquivoGerado_(pg), carimbo = contrato ? ctrCarimboDoNome_(contrato.nome) : "";
  if (!carimbo) return out;
  /* 01/11: só o termo do contrato atual (mesmo carimbo); o de um fluxo antigo não aparece */
  ["PRE", "POS"].forEach(function (tipo) { var g = cfdGerado_(pg, tipo); if (g && ctrCarimboDoNome_(g.nome) === carimbo) out.push({ tipo: tipo, nome: g.nome }); });
  return out;
}

/* PDF de um termo pela sessão do portal (o link do arquivo não vai para a tela). p.tipo = "PRE" | "POS". */
function verConfissao_(col, p) {
  var tipo = p.tipo === "POS" ? "POS" : "PRE";
  var pg = ctrLerPaginaVenda_(p.pageId), g = cfdGerado_(pg, tipo);
  if (!g) return { ok: false, erro: "SEM_TERMO_GERADO" };
  var b = null;
  try { b = baixarArquivo_({ name: g.nome, type: "file", file: { url: g.url } }); } catch (e) { b = null; }
  if (!b || b.mime !== "application/pdf") return { ok: false, erro: "CONTRATO_ILEGIVEL" };
  return { ok: true, nome: g.nome, base64: b.base64 };
}
