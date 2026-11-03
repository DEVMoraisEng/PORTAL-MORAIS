/* AnexosMC — documentos assinados da venda no Mais Controle (03/11/2026). Arquivo do projeto PORTAL-VENDA.
 *
 * Dois pedidos do dono, os dois pelo robô do SERVIDOR (fila DB_FILA_ROBO, tipo "mc-anexos" → venda/mc/anexos.py),
 * que fala com o ERP só pela aba do Chrome do porteiro:
 *  1) contrato assinado no recebimento da venda: a venda pode ter sido criada ANTES de o PDF chegar no Notion
 *     ("Contrato: não anexado (coluna CONTRATO ASSINADO vazia)") e nada tentava de novo. Agora:
 *     - quando o PDF entra na linha e a venda JÁ tem MC - VENDA ID, o pedido vai sozinho para a fila;
 *     - o botão "Anexar contrato no Mais Controle" (bloco Mais Controle, ação mcAnexar) põe o mesmo pedido.
 *  2) ZIP com TODOS os documentos assinados do envelope (contrato, termos, memorial, projeto) — montado aqui
 *     (Apps Script tem a Clicksign e o Utilities.zip), guardado na coluna MC_COL_ZIP da linha do condomínio e
 *     enviado pelo robô para Obras > Orçamento > Arquivos > pasta "Contratos Venda".
 * O robô é idempotente pelos NOMES (arquivo com o mesmo nome já na pasta = não sobe de novo) e escreve o
 * resultado nas linhas "Contrato: …" e "Contratos (ZIP): …" de MC - SITUAÇÃO.
 * Tudo aqui é complemento: nada derruba a situação da assinatura nem a venda (erro vira log e linha da situação). */
var MC_COL_ZIP = "CONTRATOS ASSINADOS (ZIP)";
var MC_ROTULO_CONTRATO = "Contrato";
var MC_ROTULO_ZIP = "Contratos (ZIP)";
var MC_TIPO_ANEXOS = "mc-anexos";
var MC_NOTION_SIMPLES = 20 * 1024 * 1024;     // envio simples do /file_uploads do Notion
var MC_NOTION_PARTE = 10 * 1024 * 1024;       // multi_part: partes de 5 a 20 MB (a última pode ser menor)
var MC_ZIP_TETO = 45 * 1024 * 1024;           // abaixo dos 50 MB do UrlFetchApp (a parte maior vai num pedido só)

/* Troca (ou acrescenta) a linha "Rótulo: …" do texto de MC - SITUAÇÃO, sem mexer nas outras.
   Pura: testada no node. A 1ª linha (cabeçalho com o carimbo [#hash]) nunca é trocada. */
function mcTrocarLinha_(situacao, rotulo, texto) {
  var linhas = String(situacao || "").split(/\r?\n/), nova = rotulo + ": " + texto, achou = false;
  for (var i = 1; i < linhas.length; i++) {
    if (linhas[i].indexOf(rotulo + ":") === 0) { linhas[i] = nova; achou = true; }
  }
  if (!achou) {
    if (linhas.length === 1 && !linhas[0].trim()) return nova;
    linhas.push(nova);
  }
  return linhas.join("\n");
}

/* Grava linhas na MC - SITUAÇÃO da página (relê a situação na hora: o robô pode ter escrito). */
function mcGravarLinhas_(pageId, trocas) {
  var c = mcLerColunas_(pageId), t = c.situacao;
  trocas.forEach(function (x) { t = mcTrocarLinha_(t, x[0], x[1]); });
  var props = {};
  props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: t.slice(0, 1900) } }] };
  notion_("PATCH", "/pages/" + pageId, { properties: props });
}

/* Põe o pedido "mc-anexos" na fila do servidor. Só pela fila: o ERP é acessado pelo Chrome do porteiro. */
function mcPedirAnexos_(pageId) {
  if (!roboUsaFila_()) return { ok: false, erro: "MC_ANEXOS_SEM_FILA" };
  var f = roboFilaPor_(MC_TIPO_ANEXOS, { pageId: String(pageId).replace(/-/g, ""), aplicar: true });
  if (!f.ok) return { ok: false, erro: "MC_DISPARO_FALHOU" };
  return { ok: true, aviso: roboAvisoSinal_(f.sinal, Date.now()) };
}

/* Botões "Anexar contrato no Mais Controle" e (p.zip) "Enviar ZIP ao Mais Controle" — ação mcAnexar.
   Contrato exige venda lançada (MC - VENDA ID); ZIP exige o arquivo na coluna MC_COL_ZIP. O robô faz os dois,
   sempre sem repetir o que já está no ERP. */
function mcAnexar_(col, sess, p) {
  var zip = p.zip === true || p.zip === "true";
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "MC_PROCESSANDO" };
  try {
    var c = mcLerColunas_(p.pageId);
    if (zip) {
      var cz = cfdCol_({ properties: c.props }, MC_COL_ZIP);
      if (!cz || !(ctrValor_(c.props[cz]) || []).length) return { ok: false, erro: "MC_SEM_ZIP" };
    } else if (!c.vendaId) return { ok: false, erro: "MC_SEM_VENDA" };
    var r = mcPedirAnexos_(p.pageId);
    if (!r.ok) return r;
    try { mcGravarLinhas_(p.pageId, [[zip ? MC_ROTULO_ZIP : MC_ROTULO_CONTRATO, "pedido ao robô em " + hoje_("dd/MM HH:mm") + (r.aviso || "")]]); }
    catch (e) { ctrErro_("mcAnexar " + String(p.pageId).slice(0, 8) + " situação", e); }
    ctrLog_("mcAnexar " + String(p.pageId).slice(0, 8) + " (fila)");
    return { ok: true, fila: true, semSinal: !!r.aviso };
  } finally {
    lock.releaseLock();
  }
}

/* Arquivo (blob) numa coluna de arquivos do Notion, trocando o que havia. Até 20 MB: envio simples;
   acima: multi_part (partes de 10 MB; /send de cada uma e /complete). Devolve o id do file_upload. */
function mcNotionSubir_(pageId, colReal, blob, nome, mime) {
  var bytes = blob.getBytes(), total = bytes.length, cab = { Authorization: "Bearer " + prop_("NOTION_TOKEN"), "Notion-Version": NOTION_VERSION };
  var fu, partes = total > MC_NOTION_SIMPLES ? Math.ceil(total / MC_NOTION_PARTE) : 1;
  fu = partes > 1 ? notion_("POST", "/file_uploads", { mode: "multi_part", number_of_parts: partes, filename: nome, content_type: mime })
                  : notion_("POST", "/file_uploads", { filename: nome, content_type: mime });
  for (var i = 0; i < partes; i++) {
    var pedaco = partes > 1 ? bytes.slice(i * MC_NOTION_PARTE, Math.min(total, (i + 1) * MC_NOTION_PARTE)) : bytes;
    var carga = { file: Utilities.newBlob(pedaco, mime, nome) };
    if (partes > 1) carga.part_number = String(i + 1);
    var r = UrlFetchApp.fetch(fu.upload_url, { method: "post", muteHttpExceptions: true, headers: cab, payload: carga });
    if (r.getResponseCode() >= 300) throw new Error("UPLOAD_FALHOU: parte " + (i + 1) + " HTTP " + r.getResponseCode());
  }
  if (partes > 1) notion_("POST", "/file_uploads/" + fu.id + "/complete", {});
  var props = {};
  props[colReal] = { files: [{ type: "file_upload", name: nome, file_upload: { id: fu.id } }] };
  notion_("PATCH", "/pages/" + pageId, { properties: props });
  return fu.id;
}

/* Nome de cada documento assinado dentro do ZIP: o contrato com o nome final do CONTRATO ASSINADO, os demais
   "ASSINADO - <nome do envio>"; sempre .pdf e sem repetir. */
function mcNomesNoZip_(docs, nomeContrato) {
  var vistos = {};
  return docs.map(function (dc, i) {
    var n = i === 0 && nomeContrato ? nomeContrato : "ASSINADO - " + ctrTxt_((dc.attributes || {}).filename || ("documento " + (i + 1) + ".pdf"));
    n = n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!/\.pdf$/i.test(n)) n += ".pdf";
    var base = n, k = 2;
    while (vistos[n.toUpperCase()]) n = base.replace(/\.pdf$/i, " (" + (k++) + ").pdf");
    vistos[n.toUpperCase()] = true;
    return n;
  });
}

/* Monta e guarda o ZIP (só linha do condomínio com a coluna MC_COL_ZIP vazia). Devolve:
   { feito: true } | { pular: "motivo curto" } (nada a fazer agora) | { erro: "texto para a situação" }.
   docs = documentos do envelope (contrato primeiro); nomeContrato = nome final do contrato assinado. */
function mcZipContratos_(pageId, pgCru, docs, nomeContrato) {
  var col = cfdCol_(pgCru, MC_COL_ZIP);
  if (!col) return { pular: "sem coluna" };
  if ((ctrValor_(pgCru.properties[col]) || []).length) return { pular: "já tem" };
  var nomeZip = CondominioVenda.nomeZipContratos(pgCru.properties);
  if (!nomeZip) return { erro: "não gerado (a UNIDADE da linha não tem número)" };
  var links = [];
  for (var i = 0; i < docs.length; i++) {
    try { links.push(ClicksignVenda.linkAssinado(docs[i])); }
    catch (e) { return { pular: "arquivo assinado ainda sendo preparado" }; }   /* o próximo Atualizar tenta */
  }
  var nomes = mcNomesNoZip_(docs, nomeContrato), blobs = [], soma = 0;
  for (var j = 0; j < links.length; j++) {
    var r;
    try { r = UrlFetchApp.fetch(links[j], { muteHttpExceptions: true }); } catch (e) { return { erro: "não gerado (download da Clicksign sem resposta) — tente Atualizar de novo" }; }
    if (r.getResponseCode() >= 300) return { erro: "não gerado (download da Clicksign HTTP " + r.getResponseCode() + ") — tente Atualizar de novo" };
    var b = r.getBlob();
    soma += b.getBytes().length;
    if (soma > MC_ZIP_TETO) return { erro: "não gerado (os documentos passam de " + Math.round(MC_ZIP_TETO / 1048576) + " MB) — envie à mão para a pasta Contratos Venda" };
    blobs.push(b.setName(nomes[j]));
  }
  var zip = Utilities.zip(blobs, nomeZip);
  if (zip.getBytes().length > MC_ZIP_TETO) return { erro: "não gerado (ZIP acima de " + Math.round(MC_ZIP_TETO / 1048576) + " MB) — envie à mão para a pasta Contratos Venda" };
  try { mcNotionSubir_(pageId, col, zip, nomeZip, "application/zip"); }
  catch (e) { ctrErro_("zip " + String(pageId).slice(0, 8) + " notion", e); return { erro: "não guardado no Notion (" + String(e.message || e).slice(0, 80) + ")" }; }
  return { feito: true, nome: nomeZip, arquivos: blobs.length };
}

/* Chamada pelo assinaturaEstado_ quando o envelope do contrato do condomínio está ASSINADO e nenhum arquivo
   falta: (1) contrato que acabou de entrar numa venda já lançada → pede o anexo; (2) ZIP que ainda não existe →
   monta, guarda e pede o envio. Um pedido só na fila para os dois. Nunca lança. */
function mcAnexosPosAssinatura_(pageId, docs, nomeContrato, anexouContrato) {
  var id8 = String(pageId).slice(0, 8), pg;
  try { pg = notion_("GET", "/pages/" + pageId, null); } catch (e) { ctrErro_("anexos " + id8 + " leitura", e); return; }
  if (!pg || vendaBaseDaPagina_(pg) !== "CONDOMINIO") return;
  var vendaId = "";
  try { vendaId = mcLerColunas_(pageId).vendaId; } catch (e) { return; }   /* sem as colunas MC: nada a pedir */
  var trocas = [], pedir = false;
  if (anexouContrato && vendaId) { pedir = true; trocas.push([MC_ROTULO_CONTRATO, "pedido ao robô em " + hoje_("dd/MM HH:mm")]); }
  var z = mcZipContratos_(pageId, pg, docs, nomeContrato);
  if (z.feito) {
    pedir = true;
    trocas.push([MC_ROTULO_ZIP, "guardado no Notion (" + z.arquivos + " documentos), envio pedido ao robô em " + hoje_("dd/MM HH:mm")]);
    ctrLog_("anexos " + id8 + " zip guardado (" + z.arquivos + " documentos)");
  } else if (z.erro) {
    trocas.push([MC_ROTULO_ZIP, z.erro]);
    ctrLog_("anexos " + id8 + " zip: " + z.erro.split(" (")[0]);
  }
  if (pedir) {
    var r = mcPedirAnexos_(pageId);
    if (!r.ok) {
      var msg = r.erro === "MC_ANEXOS_SEM_FILA" ? "o robô do servidor não está configurado (DB_FILA_ROBO)" : "não consegui pôr o pedido na fila";
      trocas = trocas.map(function (t) { return [t[0], t[1].replace(/pedido ao robô em .*$/, "NÃO pedido ao robô (" + msg + ") — use o botão")]; });
    } else if (r.aviso) {
      trocas = trocas.map(function (t) { return [t[0], t[1] + r.aviso]; });
    }
  }
  if (trocas.length) {
    try { mcGravarLinhas_(pageId, trocas); } catch (e) { ctrErro_("anexos " + id8 + " situação", e); }
  }
}
