/* Confissao.gs — TERMOS DE CONFISSÃO DE DÍVIDA do condomínio no Apps Script PORTAL-VENDA (28/10/2026).
 * Regras puras em ConfissaoVenda.js. Gerados junto com o contrato FINAL ("Conferi"), com o MESMO carimbo
 * no nome do PDF — é por ele que a assinatura sabe que os termos são deste contrato. Ligados quando a
 * Propriedade MODELO_CONFISSAO_PRE_ID existe (MODELO_CONFISSAO_POS_ID só é exigida com parcelas pós-chaves).
 * Ações: verConfissao (PDF do termo pela sessão do portal). Log só com ação, pageId abreviado e resultado. */

/* Gera e anexa os termos desta venda: { nomes } ou { resp } (resposta de erro pronta). */
function cfdGerarTermos_(prep, p, pid, rot) {
  var tipos = ConfissaoVenda.quais(prep.d), nomes = [];
  if (!tipos.length) return { nomes: nomes };
  var pg = ctrLerPaginaVenda_(p.pageId);
  for (var i = 0; i < tipos.length; i++) {
    var tipo = tipos[i], modeloId = prop_(ConfissaoVenda.MODELO[tipo]), modelo;
    if (!modeloId) { ctrLog_(rot + " " + pid + " sem modelo do termo " + tipo); return { resp: { ok: false, erro: "MODELO_NAO_CONFIGURADO" } }; }
    try { modelo = DriveApp.getFileById(modeloId); }
    catch (e) { ctrErro_(rot + " " + pid + " modelo do termo " + tipo, e); return { resp: { ok: false, erro: "MODELO_NAO_CONFIGURADO" } }; }
    var nomeCol = tipo === "POS" ? ConfissaoVenda.COL.POS_GERADO : ConfissaoVenda.COL.PRE_GERADO, col = cfdCol_(pg, nomeCol);
    if (!col) return { resp: { ok: false, erro: "COLUNA_FALTANDO: " + nomeCol } };
    var g = ctrGerarPdf_({ modelo: modelo, pasta: prep.pasta, marcadores: ConfissaoVenda.marcadores(prep.d, tipo), blocos: {} },
                         pid, rot + " termo " + tipo, false);
    if (g.resp) return g;
    var nome = ConfissaoVenda.PREFIXO[tipo] + prep.resto;
    try {
      anexarArquivo_(p.pageId, col, { nome: nome, mime: "application/pdf", base64: Utilities.base64Encode(g.pdf.getBytes()) }, true);
    } catch (e) { ctrErro_(rot + " " + pid + " anexo do termo " + tipo, e); return { resp: { ok: false, erro: "CONTRATO_FALHOU" } }; }
    nomes.push(nome);
  }
  ctrLog_(rot + " " + pid + " termos de confissao " + nomes.length);
  return { nomes: nomes };
}

/* Termos gerados nesta linha (para a tela): [{ tipo, nome }]. */
function cfdEstado_(pg) {
  if (!cfdLigado_()) return null;
  var out = [];
  ["PRE", "POS"].forEach(function (tipo) { var g = cfdGerado_(pg, tipo); if (g) out.push({ tipo: tipo, nome: g.nome }); });
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
