/* MigrarModelos.gs — troca, UMA VEZ, os blocos fixos de assinatura dos modelos (Google Docs) por um parágrafo com o
 * marcador do bloco gerado no código (01/11/2026, plano 23 B; dono: "essas alterações estéticas pode fazer").
 * Arquivo do projeto PORTAL-VENDA. O dono roda no editor do Apps Script (sem argumentos):
 *   migrarModelosAssinaturasPrevia()  — só lê e escreve no registro de execução o que trocaria (padrão seguro);
 *   migrarModelosAssinaturasAplicar() — para cada modelo: PRIMEIRO uma cópia de segurança na mesma pasta
 *     ("<nome> - BACKUP antes assinaturas 01-11"; o id vai para o registro), DEPOIS a troca.
 * Bloco = do primeiro traço "____" depois da linha {{CIDADE_DATA}} até o último "CPF:" da TESTEMUNHA 2 (o texto visto
 * nos PDFs gerados). Tudo o mais do modelo (texto jurídico, data, títulos) fica como está. Quando o bloco não é achado
 * sem dúvida (número de blocos diferente do esperado, marcador estranho no meio, {{#COM_COMISSAO}} cortado, sem a data
 * antes), o modelo NÃO é tocado e o motivo vai para o registro. Modelo já migrado (tem {{ASSINATURAS_...}}) é pulado.
 * Desfazer: abrir a cópia de segurança e pôr o id dela na Propriedade do modelo (ou copiar o texto de volta). */

var MIG_SUFIXO_BACKUP = " - BACKUP antes assinaturas 01-11";
/* Propriedade do modelo → marcadores, na ordem em que os blocos aparecem no documento */
var MIG_MODELOS = [
  { prop: "MODELO_CONDOMINIO_ID", marcadores: ["ASSINATURAS_QUADRO", "ASSINATURAS_FINAL"] },
  { prop: "MODELO_PRONTO_ID", marcadores: ["ASSINATURAS_QUADRO", "ASSINATURAS_FINAL"] },
  { prop: "MODELO_CONSTRUCAO_ID", marcadores: ["ASSINATURAS_QUADRO", "ASSINATURAS_FINAL"] },
  { prop: "MODELO_CONFISSAO_PRE_ID", marcadores: ["ASSINATURAS_TERMO"] },
  { prop: "MODELO_CONFISSAO_POS_ID", marcadores: ["ASSINATURAS_TERMO"] },
  { prop: "MODELO_PRE_RESERVA_ID", marcadores: ["ASSINATURAS_TERMO"] }
];
/* marcadores que podem estar dentro de um bloco antigo (todo o resto barra a troca) */
var MIG_PERMITIDOS = ["VENDEDOR_NOME", "VENDEDOR_DOC", "VENDEDOR_DOC_ROTULO", "REPRESENTANTE_NOME", "REPRESENTANTE_CPF",
  "ASSINATURA_COMPRADORES_NOMES", "ASSINATURA_COMPRADORES_CPFS", "CORRETOR_NOME", "CORRETOR_DOC", "CORRETOR_CRECI",
  "FIADOR1_NOME", "FIADOR1_CPF", "FIADOR2_NOME", "FIADOR2_CPF", "PRE_RESERVANTE_NOME", "PRE_RESERVANTE_CPF", "COM_COMISSAO"];
var MIG_MAX_ELEMENTOS = 40;

function migrarModelosAssinaturasPrevia() { return migModelos_(false); }
function migrarModelosAssinaturasAplicar() { return migModelos_(true); }

function migModelos_(aplicar) {
  var props = PropertiesService.getScriptProperties(), rel = [];
  function reg(t) { rel.push(t); console.log(t); }
  reg((aplicar ? "APLICAR" : "PRÉVIA") + " — blocos de assinatura dos modelos (uma linha por pessoa)");
  MIG_MODELOS.forEach(function (m) {
    var id = String(props.getProperty(m.prop) || "").trim();
    if (!id) { reg(m.prop + ": sem a propriedade, nada a fazer"); return; }
    var r;
    try { r = migUmModelo_(id, m.marcadores, aplicar); }
    catch (e) { r = "NÃO MEXI — erro: " + String((e && e.message) || e).slice(0, 200); }
    reg(m.prop + ": " + r);
  });
  return rel;
}

/* Um modelo: devolve a frase do registro. */
function migUmModelo_(id, marcadores, aplicar) {
  var doc = DocumentApp.openById(id), body = doc.getBody();
  if (/\{\{ASSINATURAS_[A-Z]+\}\}/.test(String(body.getText()))) return "já migrado (tem {{ASSINATURAS_...}}), nada a fazer";
  var achou = migAcharBlocos_(body);
  if (achou.problema) return "NÃO MEXI — " + achou.problema;
  var bl = achou.blocos;
  if (bl.length !== marcadores.length)
    return "NÃO MEXI — achei " + bl.length + " bloco(s) de assinatura, esperava " + marcadores.length;
  var desc = bl.map(function (b, i) {
    return "[" + (i + 1) + "] {{" + marcadores[i] + "}} no lugar de " + (b.fim - b.ini + 1) + " elemento(s), de \"" +
      migResumo_(b.els[b.ini].texto) + "\" até \"" + migResumo_(b.els[b.fim].texto) + "\"";
  }).join("; ");
  if (!aplicar) return "PRÉVIA — trocaria " + bl.length + " bloco(s): " + desc;
  /* cópia de segurança ANTES de qualquer mudança (o documento ainda não foi alterado) */
  var arq = DriveApp.getFileById(id), pais = arq.getParents();
  var pasta = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  var copia = arq.makeCopy(arq.getName() + MIG_SUFIXO_BACKUP, pasta);
  /* de trás para a frente: trocar um bloco não muda a posição dos anteriores no mesmo lugar */
  for (var i = bl.length - 1; i >= 0; i--) migTrocar_(bl[i], "{{" + marcadores[i] + "}}");
  doc.saveAndClose();
  return "trocado " + bl.length + " bloco(s); cópia de segurança " + copia.getId() + " — " + desc;
}
function migResumo_(t) { t = String(t).replace(/\s+/g, " ").trim(); return t.length > 40 ? t.slice(0, 40) + "…" : t; }

/* ---- leitura: elementos de um "lugar" (corpo ou célula de tabela) ---- */
var MIG_TRACO = /^_{10,}$/;
function migElementos_(caixa) {
  var T = DocumentApp.ElementType, out = [];
  for (var i = 0; i < caixa.getNumChildren(); i++) {
    /* getChild devolve um Element genérico: o tipo concreto (asParagraph/asListItem/asTable) tem getText e removeFromParent */
    var cru = caixa.getChild(i), tipo = cru.getType();
    if (tipo === T.TABLE) {
      var tb = cru.asTable();
      out.push({ el: tb, tabela: tb, texto: String(tb.getText()), assinatura: migTabelaDeAssinatura_(tb) });
    } else if (tipo === T.PARAGRAPH || tipo === T.LIST_ITEM) {
      var p = tipo === T.PARAGRAPH ? cru.asParagraph() : cru.asListItem();
      out.push({ el: p, texto: String(p.getText()), paragrafo: true, ehParagrafo: tipo === T.PARAGRAPH });
    } else {
      out.push({ el: cru, texto: "", outro: String(tipo) });   /* sumário etc.: não pode estar dentro de um bloco */
    }
  }
  return out;
}
/* tabela pequena (até 3 linhas) com alguma célula começando por traço = pedaço do bloco (lado a lado); a do quadro-resumo não */
function migTabelaDeAssinatura_(tb) {
  if (tb.getNumRows() > 3) return false;
  for (var r = 0; r < tb.getNumRows(); r++) {
    var linha = tb.getRow(r);
    for (var c = 0; c < linha.getNumCells(); c++) {
      var t = String(linha.getCell(c).getText()).replace(/^\s+/, "");
      if (/^_{10,}/.test(t)) return true;
    }
  }
  return false;
}
function migComecaBloco_(e) { return e.tabela ? e.assinatura : (e.paragrafo && MIG_TRACO.test(e.texto.trim())); }
var MIG_TESTEMUNHA2 = /TESTEMUNHA\s*2|\b2\.\s*Nome:/i;

/* Blocos na ordem do documento: { caixa, els, ini, fim } ou { problema }. Tabela grande (quadro-resumo) é lida por dentro. */
function migAcharBlocos_(caixa) {
  var els = migElementos_(caixa), blocos = [], depois = 0, porIndice = {};
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.tabela && !e.assinatura) continue;
    if (!MIG_TESTEMUNHA2.test(e.texto)) continue;
    /* fim: o próprio elemento quando o CPF vem depois da TESTEMUNHA 2 nele; senão a linha "CPF:" logo abaixo */
    var fim = -1, resto = e.texto.slice(e.texto.search(MIG_TESTEMUNHA2));
    if (/CPF/.test(resto)) fim = i;
    else for (var j = i + 1; j < els.length && j <= i + 2; j++) if (/CPF/.test(els[j].texto)) { fim = j; break; }
    if (fim < 0) return { problema: "não achei o \"CPF:\" da TESTEMUNHA 2 depois de \"" + migResumo_(e.texto) + "\"" };
    var ancora = -1;
    for (var k = i; k >= depois; k--) if (els[k].paragrafo && /\{\{CIDADE_DATA\}\}/.test(els[k].texto)) { ancora = k; break; }
    if (ancora < 0) return { problema: "não achei a linha {{CIDADE_DATA}} antes do bloco que termina em \"" + migResumo_(e.texto) + "\"" };
    var ini = -1;
    for (var s = ancora + 1; s <= fim; s++) if (migComecaBloco_(els[s])) { ini = s; break; }
    if (ini < 0) return { problema: "não achei o primeiro traço \"____\" do bloco depois de {{CIDADE_DATA}}" };
    var p = migConferir_(els, ini, fim);
    if (p) return { problema: p };
    porIndice[ini] = { caixa: caixa, els: els, ini: ini, fim: fim };
    depois = fim + 1;
    i = fim;
  }
  /* ordem do documento: blocos deste lugar e os de dentro das tabelas grandes */
  for (var x = 0; x < els.length; x++) {
    if (porIndice[x]) { blocos.push(porIndice[x]); x = porIndice[x].fim; continue; }
    if (!els[x].tabela || els[x].assinatura) continue;
    var tb = els[x].tabela;
    for (var r = 0; r < tb.getNumRows(); r++) {
      var linha = tb.getRow(r);
      for (var c = 0; c < linha.getNumCells(); c++) {
        var dentro = migAcharBlocos_(linha.getCell(c));
        if (dentro.problema) return dentro;
        blocos = blocos.concat(dentro.blocos);
      }
    }
  }
  return { blocos: blocos };
}

/* Confere o trecho [ini, fim]: tamanho, só marcadores de assinatura, {{#X}}/{{/X}} fechados, cara de bloco de assinatura. */
function migConferir_(els, ini, fim) {
  if (fim - ini + 1 > MIG_MAX_ELEMENTOS) return "bloco grande demais (" + (fim - ini + 1) + " elementos) — confira o modelo";
  for (var q = ini; q <= fim; q++) if (els[q].outro) return "elemento do tipo " + els[q].outro + " dentro do bloco de assinatura";
  var t = els.slice(ini, fim + 1).map(function (e) { return e.texto; }).join("\n"), re = /\{\{([#\/]?)([A-Za-z0-9_]+)\}\}/g, m, abertos = {};
  while ((m = re.exec(t)) !== null) {
    if (MIG_PERMITIDOS.indexOf(m[2]) < 0) return "marcador {{" + m[1] + m[2] + "}} dentro do bloco de assinatura";
    if (m[1] === "#") abertos[m[2]] = (abertos[m[2]] || 0) + 1;
    if (m[1] === "/") abertos[m[2]] = (abertos[m[2]] || 0) - 1;
  }
  for (var k in abertos) if (abertos[k] !== 0) return "{{#" + k + "}} e {{/" + k + "}} não fecham dentro do bloco";
  if (!/VENDEDOR|CREDORA/i.test(t) || !/COMPRADOR|RESERVANTE/i.test(t)) return "o trecho achado não tem VENDEDOR e COMPRADOR";
  return "";
}

/* Troca: um parágrafo novo com o marcador no lugar do primeiro elemento (centralizado como ele, ou centralizado se era
   tabela); depois sai o bloco antigo. Inserir antes de apagar: o lugar nunca fica sem parágrafo. */
function migTrocar_(b, marcador) {
  var caixa = b.caixa, primeiro = b.els[b.ini], pos = caixa.getChildIndex(primeiro.el);
  var novo = caixa.insertParagraph(pos, marcador);
  try { novo.setAlignment(primeiro.ehParagrafo ? primeiro.el.getAlignment() : DocumentApp.HorizontalAlignment.CENTER); }
  catch (e) { novo.setAlignment(DocumentApp.HorizontalAlignment.CENTER); }
  try { novo.editAsText().setBold(false); } catch (e) { /* sem texto para formatar */ }
  /* o Docs não deixa apagar o último parágrafo do corpo: bloco que termina no fim do documento ganha um vazio depois */
  if (caixa.getChildIndex(b.els[b.fim].el) === caixa.getNumChildren() - 1) caixa.insertParagraph(caixa.getNumChildren(), "");
  for (var i = b.fim; i >= b.ini; i--) b.els[i].el.removeFromParent();
}
