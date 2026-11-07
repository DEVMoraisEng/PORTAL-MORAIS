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
 *     O ZIP NÃO é montado no "Atualizar situação" (baixar ~20 MB ali atrasaria ou derrubaria a resposta): o
 *     assinaturaEstado_ só marca a Propriedade MC_ZIP_PENDENTE_<página>, e a vigia (gatilho de 30 min) monta,
 *     no máximo uma tentativa por hora, com prazo de 4 min por rodada. O botão "Enviar ZIP" monta na hora.
 *     Teto de 20 MB (envio simples do Notion): acima disso a situação diz para enviar à mão.
 * O robô é idempotente pelos NOMES (arquivo com o mesmo nome já na pasta = não sobe de novo) e escreve o
 * resultado nas linhas "Contrato: …" e "Contratos (ZIP): …" de MC - SITUAÇÃO.
 * Tudo aqui é complemento: nada derruba a situação da assinatura nem a venda (erro vira log e linha da situação). */
var MC_COL_ZIP = "CONTRATOS ASSINADOS (ZIP)";
var MC_ROTULO_CONTRATO = "Contrato";
var MC_ROTULO_ZIP = "Contratos (ZIP)";
var MC_CABECALHO_VAZIO = "ainda não lançada";   /* 1ª linha quando a situação estava vazia (a tela mostra o mesmo) */
var MC_TIPO_ANEXOS = "mc-anexos";
var MC_ZIP_TETO = 20 * 1024 * 1024;          // envio simples do /file_uploads do Notion
var MC_ZIP_PRAZO_MS = 4 * 60 * 1000;         // uma rodada da vigia tem 6 min; para antes
var MC_ZIP_PENDENTE = "MC_ZIP_PENDENTE_";    // + id da página = {desde, ultima} (ms)
var MC_ZIP_INTERVALO_MS = 3600000;           // no máximo uma tentativa por hora
var MC_ZIP_DESISTE_MS = 24 * 3600000;        // depois de 24 h sem conseguir, para e pede o botão

/* Troca (ou acrescenta) a linha "Rótulo: …" do texto de MC - SITUAÇÃO, sem mexer nas outras.
   Pura: testada no node. A 1ª linha (cabeçalho com o carimbo [#hash]) nunca é trocada; situação vazia ganha o
   cabeçalho MC_CABECALHO_VAZIO, para a próxima vez TROCAR a linha em vez de repetir. */
function mcTrocarLinha_(situacao, rotulo, texto) {
  var s = String(situacao || "");
  if (!s.trim()) s = MC_CABECALHO_VAZIO;
  var linhas = s.split(/\r?\n/), nova = rotulo + ": " + texto, achou = false;
  for (var i = 1; i < linhas.length; i++) {
    if (linhas[i].indexOf(rotulo + ":") === 0) { linhas[i] = nova; achou = true; }
  }
  if (!achou) linhas.push(nova);
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
function mcSemPedido_(r) {
  return "NÃO pedido ao robô (" + (r.erro === "MC_ANEXOS_SEM_FILA" ? "o robô do servidor não está configurado (DB_FILA_ROBO)"
                                                                   : "não consegui pôr o pedido na fila") + ") — use o botão";
}

/* Botões "Anexar contrato no Mais Controle" e (p.zip) "Enviar ZIP ao Mais Controle" — ação mcAnexar.
   Contrato exige venda lançada (MC - VENDA ID). ZIP: se a coluna ainda está vazia, monta agora (a pessoa pediu);
   depois põe o pedido. O robô faz as duas partes, sempre sem repetir o que já está no ERP. */
function mcAnexar_(col, sess, p) {
  var zip = p.zip === true || p.zip === "true";
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "MC_PROCESSANDO" };
  try {
    var c = mcLerColunas_(p.pageId), extra = [];
    if (zip) {
      var cz = cfdCol_({ properties: c.props }, MC_COL_ZIP);
      if (!cz) return { ok: false, erro: "MC_SEM_ZIP" };
      if (!(ctrValor_(c.props[cz]) || []).length) {
        var z = mcZipMontar_(p.pageId, Date.now());
        if (!z.feito) {
          try { mcGravarLinhas_(p.pageId, [[MC_ROTULO_ZIP, z.erro || "não gerado (" + (z.pular || "?") + ")"]]); } catch (e) {}
          return { ok: false, erro: "MC_SEM_ZIP" };
        }
        assApagarProp_(MC_ZIP_PENDENTE + p.pageId);
        extra.push("guardado no Notion (" + z.arquivos + " documentos), ");
      }
    } else if (!c.vendaId && c.base !== "VENDAS") return { ok: false, erro: "MC_SEM_VENDA" };   /* 05/11: casa de rua manda ao Orçamento mesmo sem venda */
    var r = mcPedirAnexos_(p.pageId);
    if (!r.ok) {
      if (extra.length) try { mcGravarLinhas_(p.pageId, [[MC_ROTULO_ZIP, extra[0] + mcSemPedido_(r)]]); } catch (e) {}
      return r;
    }
    var pedido = "pedido ao robô em " + hoje_("dd/MM HH:mm") + (r.aviso || "");
    try {
      if (zip) mcGravarLinhas_(p.pageId, [[MC_ROTULO_ZIP, (extra[0] || "") + pedido]]);
      else mcGravarLinhas_(p.pageId, mcLinhasContrato_(c.base, c.vendaId, pedido));
    }
    catch (e) { ctrErro_("mcAnexar " + String(p.pageId).slice(0, 8) + " situação", e); }
    ctrLog_("mcAnexar " + String(p.pageId).slice(0, 8) + (zip ? " zip" : "") + " (fila)");
    return { ok: true, fila: true, semSinal: !!r.aviso };
  } finally {
    lock.releaseLock();
  }
}

/* ZIP na coluna de arquivos do Notion (envio simples, o Blob vai direto: nada de getBytes no ZIP). */
function mcNotionSubir_(pageId, colReal, blob, nome, mime) {
  var fu = notion_("POST", "/file_uploads", { filename: nome, content_type: mime });
  var r = UrlFetchApp.fetch(fu.upload_url, { method: "post", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + prop_("NOTION_TOKEN"), "Notion-Version": NOTION_VERSION }, payload: { file: blob } });
  if (r.getResponseCode() >= 300) throw new Error("UPLOAD_FALHOU: HTTP " + r.getResponseCode());
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

/* Tamanho do download sem copiar o conteúdo para um array (Content-Length); sem o cabeçalho, uma cópia só. */
function mcTamanho_(r) {
  var h = (r.getAllHeaders && r.getAllHeaders()) || {};
  for (var k in h) if (String(k).toLowerCase() === "content-length" && Number(h[k]) > 0) return Number(h[k]);
  return r.getBlob().getBytes().length;
}

/* Monta e guarda o ZIP (só linha do condomínio com a coluna MC_COL_ZIP vazia). Devolve:
   { feito, arquivos } | { pular: "motivo" } (nada a fazer ou tentar depois) | { erro, definitivo? }.
   docs = documentos do envelope (contrato primeiro); nomeContrato = nome final do contrato assinado. */
function mcZipContratos_(pageId, pgCru, docs, nomeContrato, inicio) {
  var col = cfdCol_(pgCru, MC_COL_ZIP);
  if (!col) return { pular: "sem coluna", fim: true };
  if ((ctrValor_(pgCru.properties[col]) || []).length) return { pular: "já tem", fim: true };
  var rua = vendaBaseDaPagina_(pgCru) === "VENDAS";   /* 05/11: casa de rua tem o nome dela (mcNomeZipRua_) */
  var nomeZip = rua ? mcNomeZipRua_(pgCru.properties) : CondominioVenda.nomeZipContratos(pgCru.properties);
  if (!nomeZip) return { erro: rua ? "não gerado (a casa não tem ENDEREÇO ou número em CASA)" : "não gerado (a UNIDADE da linha não tem número)", definitivo: true };
  var links = [];
  for (var i = 0; i < docs.length; i++) {
    try { links.push(ClicksignVenda.linkAssinado(docs[i])); }
    catch (e) { return { pular: "arquivo assinado ainda sendo preparado" }; }
  }
  var nomes = mcNomesNoZip_(docs, nomeContrato), blobs = [], soma = 0, teto = Math.round(MC_ZIP_TETO / 1048576);
  for (var j = 0; j < links.length; j++) {
    if (Date.now() - inicio > MC_ZIP_PRAZO_MS) return { erro: "não gerado (tempo esgotado) — tento de novo em 1 hora" };
    var r;
    try { r = UrlFetchApp.fetch(links[j], { muteHttpExceptions: true }); } catch (e) { return { erro: "não gerado (download da Clicksign sem resposta) — tento de novo em 1 hora" }; }
    if (r.getResponseCode() >= 300) return { erro: "não gerado (download da Clicksign HTTP " + r.getResponseCode() + ") — tento de novo em 1 hora" };
    soma += mcTamanho_(r) + 1024;   /* PDF quase não comprime: o ZIP fica do tamanho da soma (+ cabeçalhos) */
    if (soma > MC_ZIP_TETO) return { erro: "ZIP grande (mais de " + teto + " MB): envie à mão para a pasta Contratos Venda", definitivo: true };
    blobs.push(r.getBlob().setName(nomes[j]));
  }
  var zip = Utilities.zip(blobs, nomeZip);
  try { mcNotionSubir_(pageId, col, zip, nomeZip, "application/zip"); }
  catch (e) { ctrErro_("zip " + String(pageId).slice(0, 8) + " notion", e); return { erro: "não guardado no Notion (" + String(e.message || e).slice(0, 80) + ") — tento de novo em 1 hora" }; }
  return { feito: true, nome: nomeZip, arquivos: blobs.length };
}

/* Lê a linha e o envelope do contrato e monta o ZIP (vigia ou botão). */
function mcZipMontar_(pageId, inicio) {
  var pgCru = notion_("GET", "/pages/" + pageId, null);
  if (!pgCru || !vendaBaseDaPagina_(pgCru)) return { pular: "outra base", fim: true };   /* 05/11: condomínio e casa de rua */
  var doc = assDoc_({}), pg = ctrLerPaginaVenda_(pageId), cols = assColunas_(pg, doc);
  if (assTexto_(pg, cols.SITUACAO).toUpperCase() !== ClicksignVenda.SITUACOES.ASSINADO) return { pular: "contrato não assinado", fim: true };
  var envId = assTexto_(pg, cols.ENVELOPE);
  if (!envId || !prop_("CLICKSIGN_TOKEN") || !csBase_()) return { pular: "sem envelope ou Clicksign", fim: true };
  var docs;
  try { docs = csPasso_("consultar documento", "get", "/envelopes/" + encodeURIComponent(envId) + "/documents").data || []; }
  catch (e) { return { erro: "não gerado (Clicksign não respondeu) — tento de novo em 1 hora" }; }
  if (!docs.length) return { pular: "envelope sem documento", fim: true };
  docs.sort(assOrdemDocs_);
  var gz = doc.gerado(pg);
  return mcZipContratos_(pageId, pgCru, docs, assNomeAssinado_(gz && gz.nome), inicio);
}

/* Vigia: monta os ZIPs pendentes (MC_ZIP_PENDENTE_<página>), uma tentativa por hora cada, até 24 h. A Propriedade
   fica com definitivo:true quando não adianta tentar sozinho (assim o Atualizar não marca de novo); o botão apaga. */
function mcZipPendentes_() {
  var props = PropertiesService.getScriptProperties(), inicio = Date.now(), agora = Date.now();
  var chaves = (props.getKeys ? props.getKeys() : []).filter(function (k) { return k.indexOf(MC_ZIP_PENDENTE) === 0; });
  chaves.forEach(function (k) {
    if (Date.now() - inicio > MC_ZIP_PRAZO_MS) return;
    var pageId = k.slice(MC_ZIP_PENDENTE.length), id8 = pageId.slice(0, 8), st;
    try { st = JSON.parse(props.getProperty(k) || "{}") || {}; } catch (e) { st = {}; }
    if (st.definitivo) return;   /* grande demais / sem número / 24 h: só o botão Enviar ZIP tenta de novo */
    if (st.ultima && agora - st.ultima < MC_ZIP_INTERVALO_MS) return;
    if (st.desde && agora - st.desde > MC_ZIP_DESISTE_MS) {
      props.setProperty(k, JSON.stringify({ desde: st.desde, ultima: agora, definitivo: true }));
      try { mcGravarLinhas_(pageId, [[MC_ROTULO_ZIP, "não gerado em 24 h — use o botão Enviar ZIP"]]); } catch (e) {}
      ctrLog_("zip " + id8 + " desistiu depois de 24 h");
      return;
    }
    var z;
    try { z = mcZipMontar_(pageId, inicio); } catch (e) { z = { erro: "não gerado (" + String(e.message || e).slice(0, 60) + ") — tento de novo em 1 hora" }; }
    var trocas = [];
    if (z.feito) {
      assApagarProp_(k);
      var r = mcPedirAnexos_(pageId);
      trocas.push([MC_ROTULO_ZIP, "guardado no Notion (" + z.arquivos + " documentos), " +
                   (r.ok ? "envio pedido ao robô em " + hoje_("dd/MM HH:mm") + (r.aviso || "") : mcSemPedido_(r))]);
      ctrLog_("zip " + id8 + " guardado (" + z.arquivos + " documentos)");
    } else if (z.fim) {
      assApagarProp_(k);
    } else {
      props.setProperty(k, JSON.stringify({ desde: st.desde || agora, ultima: agora, definitivo: !!z.definitivo }));
      if (z.erro) { trocas.push([MC_ROTULO_ZIP, z.erro]); ctrLog_("zip " + id8 + ": " + z.erro.split(" (")[0]); }
    }
    if (trocas.length) { try { mcGravarLinhas_(pageId, trocas); } catch (e) { ctrErro_("zip " + id8 + " situação", e); } }
  });
}

/* Chamada pelo assinaturaEstado_ quando o envelope do contrato do condomínio está ASSINADO e nenhum arquivo falta.
   Rápida: (1) contrato que acabou de entrar numa venda já lançada → pede o anexo; (2) coluna do ZIP vazia → só marca
   o ZIP como pendente para a vigia (uma vez; a situação diz quando). Nunca baixa nada, nunca lança. */
function mcAnexosPosAssinatura_(pageId, anexouContrato, zipFalta) {
  var id8 = String(pageId).slice(0, 8), trocas = [];
  if (zipFalta && !prop_(MC_ZIP_PENDENTE + pageId)) {
    PropertiesService.getScriptProperties().setProperty(MC_ZIP_PENDENTE + pageId, JSON.stringify({ desde: Date.now(), ultima: 0 }));
    trocas.push([MC_ROTULO_ZIP, "será montado com todos os assinados em até 30 minutos"]);
  }
  if (anexouContrato) {
    var pg, vendaId = "", base = "";
    try { pg = notion_("GET", "/pages/" + pageId, null); } catch (e) { ctrErro_("anexos " + id8 + " leitura", e); pg = null; }
    base = pg ? vendaBaseDaPagina_(pg) : "";
    if (base === "CONDOMINIO" || base === "VENDAS") {
      try { vendaId = mcLerColunas_(pageId).vendaId; } catch (e) { vendaId = ""; }
      /* condomínio: só com venda lançada (o ZIP vai ao Orçamento). 05/11, casa de rua: SEMPRE — o contrato vai para o
         Orçamento da obra da casa mesmo antes da venda; com venda lançada, também para o recebimento */
      if (vendaId || base === "VENDAS") {
        var r = mcPedirAnexos_(pageId);
        trocas = trocas.concat(mcLinhasContrato_(base, vendaId, r.ok ? "pedido ao robô em " + hoje_("dd/MM HH:mm") + (r.aviso || "") : mcSemPedido_(r)));
      }
    }
  }
  if (trocas.length) {
    try { mcGravarLinhas_(pageId, trocas); } catch (e) { ctrErro_("anexos " + id8 + " situação", e); }
  }
}

/* ---- 05/11/2026 (dono, CASA DE RUA): "toda vez que o contrato for finalizado (assinado por todos) ele tem que ir pro
 * orçamento (dentro do Mais Controle)". A casa da VENDAS manda o PDF do CONTRATO ASSINADO para Obras > Orçamento >
 * Arquivos > "Contratos Venda" da OBRA DA CASA (no Mais Controle a obra é a de nome = ENDEREÇO, como no lançamento) e,
 * com venda lançada, também para o recebimento. O pedido sai sozinho quando o PDF entra (mcAnexosPosAssinatura_) e de
 * novo quando o lançamento automático termina (mcAutoPasso_); o robô (venda/mc/anexos.py) não repete o que já está lá.
 * Se a base VENDAS ganhar a coluna CONTRATOS ASSINADOS (ZIP), o ZIP de todos os assinados vai junto, com o nome do
 * padrão dos contratos das outras obras ("CONTRATO <obra> CASA 0N - NOME.pdf"): "CONTRATOS <ENDEREÇO> CASA 0N - A e B.zip". */
var MC_ROTULO_ORCAMENTO = "Contrato no Orçamento";

/* Linhas da situação para um pedido de contrato: casa de rua = Orçamento (+ recebimento com venda); condomínio = recebimento. */
function mcLinhasContrato_(base, vendaId, texto) {
  if (base !== "VENDAS") return [[MC_ROTULO_CONTRATO, texto]];
  return vendaId ? [[MC_ROTULO_CONTRATO, texto], [MC_ROTULO_ORCAMENTO, texto]] : [[MC_ROTULO_ORCAMENTO, texto]];
}

/* Nome do ZIP da casa de rua (pura: testada no node). Sem ENDEREÇO ou sem UM número em CASA: null. */
function mcNomeZipRua_(props) {
  var porChave = {}, endereco = "";
  for (var n in props) {
    porChave[RegrasVenda.chave(n)] = props[n];
    if (props[n] && props[n].type === "title") endereco = ctrTxt_(ctrValor_(props[n]));
  }
  function v(nome) { var x = ctrValor_(porChave[RegrasVenda.chave(nome)]); return x === null || x === undefined ? "" : String(x); }
  var limpo = function (s) { return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase(); };
  endereco = limpo(endereco);
  var casaBruta = v("CASA"), grupos = casaBruta.match(/\d+/g) || [];
  if (!endereco || grupos.length !== 1) return null;
  var casa = Number(grupos[0]), nomes = [], vistos = {};
  /* 1º nome de CLIENTES pela mesma regra do robô (regras.dados_da_pagina: " E " maiúsculo, &, vírgula ou barra) */
  [v("CLIENTES").split(/\s+E\s+|\s*[&,\/]\s*/)[0], v("COMPRADOR 2 - NOME")].forEach(function (x) {
    var nome = limpo(x), k = RegrasVenda.chave(nome);
    if (!nome || vistos[k]) return;
    vistos[k] = true;
    nomes.push(nome);
  });
  var base = "CONTRATOS " + endereco + " CASA " + (casa < 10 ? "0" : "") + casa + (nomes.length ? " - " + nomes.join(" e ") : "");
  if (base.length > 150) base = base.slice(0, 150).trim();
  return base + ".zip";
}

/* Pede o mc-anexos de uma casa de rua e escreve as linhas (lançamento automático terminou). */
function mcAnexosRua_(pageId, vendaId) {
  var r = mcPedirAnexos_(pageId);
  try { mcGravarLinhas_(pageId, mcLinhasContrato_("VENDAS", vendaId, r.ok ? "pedido ao robô em " + hoje_("dd/MM HH:mm") + (r.aviso || "") : mcSemPedido_(r))); }
  catch (e) { ctrErro_("anexos " + String(pageId).slice(0, 8) + " situação", e); }
  return r;
}
