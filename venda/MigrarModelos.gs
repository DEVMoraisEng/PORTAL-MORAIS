/* MigrarModelos.gs — prepara, UMA VEZ, os modelos (Google Docs) para os blocos de assinatura gerados no código
 * (01/11/2026, plano 23 B; dono: "essas alterações estéticas pode fazer"). Arquivo do projeto PORTAL-VENDA.
 * Correção 1: o PORTAL-VENDA-TESTE e a produção usam os MESMOS modelos — o original NUNCA é editado. O dono roda no
 * editor do Apps Script (sem argumentos):
 *   migrarModelosAssinaturasPrevia()  — só lê; o registro de execução diz, por modelo, cada elemento que sairia;
 *   migrarModelosAssinaturasAplicar() — para cada modelo, faz uma CÓPIA "<nome> - assinaturas 01-11" na mesma pasta,
 *     confere que a cópia é igual ao original, troca os blocos NA CÓPIA e escreve "Propriedade X: trocar <id antigo> por
 *     <id novo>". Quem decide quando cada projeto passa a usar a cópia é o dono, trocando a Propriedade.
 * Bloco = do primeiro traço "____" depois da linha {{CIDADE_DATA}} (entre as duas, só linhas vazias ou o título
 * ASSINATURAS) até o último "CPF:" da TESTEMUNHA 2 (o texto visto nos PDFs gerados). Quando o bloco não é achado sem
 * dúvida (número de blocos diferente do esperado, marcador estranho, {{#COM_COMISSAO}} cortado, sem a data antes, texto
 * corrido ou tabela que não é de assinatura dentro do bloco), nada é copiado e o motivo vai para o registro.
 * Voltar atrás: pôr de novo na Propriedade o id antigo (o original ficou como estava). */

var MIG_SUFIXO_COPIA = " - assinaturas 01-11";
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
var MIG_MAX_ELEMENTOS = 40, MIG_MAX_LINHA = 120;

function migrarModelosAssinaturasPrevia() { return migModelos_(false); }
function migrarModelosAssinaturasAplicar() { return migModelos_(true); }

function migModelos_(aplicar) {
  var props = PropertiesService.getScriptProperties(), rel = [];
  function reg(t) { rel.push(t); console.log(t); }
  reg((aplicar ? "APLICAR (só nas cópias)" : "PRÉVIA") + " — blocos de assinatura dos modelos (uma linha por pessoa)");
  MIG_MODELOS.forEach(function (m) {
    var id = String(props.getProperty(m.prop) || "").trim();
    if (!id) { reg(m.prop + ": sem a propriedade, nada a fazer"); return; }
    var r;
    try { r = migUmModelo_(id, m, aplicar); }
    catch (e) { r = "NÃO MEXI — erro: " + migErro_(e); }
    reg(m.prop + ": " + r);
  });
  return rel;
}
function migErro_(e) { return String((e && e.message) || e).slice(0, 200); }

/* Um modelo: devolve a frase do registro. O original só é lido. */
function migUmModelo_(id, m, aplicar) {
  var marcadores = m.marcadores, body = DocumentApp.openById(id).getBody(), texto = String(body.getText());
  var tem = marcadores.filter(function (k) { return texto.indexOf("{{" + k + "}}") >= 0; });
  if (tem.length === marcadores.length) return "já migrado (tem " + migLista_(tem) + "), nada a fazer";
  if (tem.length) return "PARCIAL, não mexi — tem " + migLista_(tem) + ", falta " +
    migLista_(marcadores.filter(function (k) { return tem.indexOf(k) < 0; })) + " (confira o modelo à mão)";
  var bl = migBlocosConferidos_(body, marcadores.length);
  if (typeof bl === "string") return "NÃO MEXI — " + bl;
  var desc = bl.map(function (b, i) { return migDescrever_(b, i, marcadores[i]); }).join("\n");
  if (!aplicar) return "PRÉVIA — trocaria " + bl.length + " bloco(s):\n" + desc;

  var arq = DriveApp.getFileById(id), pais = arq.getParents();
  var pasta = pais.hasNext() ? pais.next() : DriveApp.getRootFolder(), nome = arq.getName() + MIG_SUFIXO_COPIA;
  var ja = pasta.getFilesByName(nome);
  if (ja.hasNext()) {
    var jaId = ja.next().getId();
    return "a cópia \"" + nome + "\" já existe (" + jaId + "), nada a fazer — Propriedade " + m.prop + ": trocar " + id + " por " + jaId;
  }
  var copia = arq.makeCopy(nome, pasta), cid = copia.getId(), blC;
  try {
    var docC = DocumentApp.openById(cid), bodyC = docC.getBody();
    if (String(bodyC.getText()) !== texto) throw new Error("a cópia não ficou igual ao original");
    blC = migBlocosConferidos_(bodyC, marcadores.length);
    if (typeof blC === "string") throw new Error(blC);
    /* de trás para a frente: trocar um bloco não muda a posição dos anteriores no mesmo lugar */
    for (var i = blC.length - 1; i >= 0; i--) migTrocar_(blC[i], "{{" + marcadores[i] + "}}");
    docC.saveAndClose();
  } catch (e) {
    return "ERRO NA CÓPIA " + cid + " — apague a cópia (" + migErro_(e) + "); o original não foi mexido";
  }
  return "cópia migrada (" + blC.length + " bloco(s)) — Propriedade " + m.prop + ": trocar " + id + " por " + cid + "\n" + desc;
}
function migLista_(l) { return l.map(function (k) { return "{{" + k + "}}"; }).join(", "); }
/* blocos achados e conferidos, ou a frase do problema */
function migBlocosConferidos_(body, esperados) {
  var achou = migAcharBlocos_(body);
  if (achou.problema) return achou.problema;
  if (achou.blocos.length !== esperados) return "achei " + achou.blocos.length + " bloco(s) de assinatura, esperava " + esperados;
  return achou.blocos;
}
/* Prévia: o bloco, o vendedor escrito nele e CADA elemento que sairia (até 80 caracteres) */
function migDescrever_(b, i, marcador) {
  var linhas = [], els = b.els.slice(b.ini, b.fim + 1);
  els.forEach(function (e) { migLinhasDe_(e.texto).forEach(function (l) { linhas.push(l); }); });
  var vend = "(não achei)";
  for (var k = 0; k < linhas.length; k++) {
    if (!/CNPJ|VENDEDOR_DOC/.test(linhas[k])) continue;
    for (var j = k - 1; j >= 0; j--) if (!/^_+$/.test(linhas[j]) && !/^(CREDORA\/)?VENDEDORA?$/.test(linhas[j])) { vend = linhas[j] + " — " + linhas[k]; break; }
    break;
  }
  if (vend === "(não achei)")   /* sem linha de CNPJ (pré-reserva): o nome logo acima do papel VENDEDORA */
    for (var v = 1; v < linhas.length; v++) if (/^(CREDORA\/)?VENDEDORA?$/.test(linhas[v]) && !/^_+$/.test(linhas[v - 1])) { vend = linhas[v - 1]; break; }
  var out =["  [" + (i + 1) + "] {{" + marcador + "}} no lugar de " + els.length + " elemento(s); vendedor no bloco antigo: " + vend];
  els.forEach(function (e) {
    var t = e.tabela ? "[tabela] " + migLinhasDe_(e.texto).join(" | ") : (String(e.texto).trim() || "(vazio)");
    out.push("    - " + (t.length > 80 ? t.slice(0, 80) + "…" : t));
  });
  return out.join("\n");
}
function migLinhasDe_(t) { return String(t).split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); }).filter(function (l) { return l; }); }
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
    /* entre a data e o começo do bloco só linhas vazias (ou o título ASSINATURAS dos termos) */
    for (var q = ancora + 1; q < ini; q++)
      if (!els[q].paragrafo || !/^(ASSINATURAS)?$/i.test(els[q].texto.trim()))
        return { problema: "texto entre {{CIDADE_DATA}} e o bloco de assinatura: \"" + migResumo_(els[q].texto || els[q].outro || "tabela") + "\"" };
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
  for (var q = ini; q <= fim; q++) {
    if (els[q].outro) return "elemento do tipo " + els[q].outro + " dentro do bloco de assinatura";
    if (els[q].tabela && !els[q].assinatura) return "tabela que não é de assinatura dentro do bloco";
    var ls = migLinhasDe_(els[q].texto);
    for (var l = 0; l < ls.length; l++)
      if (ls[l].length > MIG_MAX_LINHA || /[a-zà-ÿ]\.$/.test(ls[l])) return "texto corrido dentro do bloco: \"" + migResumo_(ls[l]) + "\"";
  }
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
