/* MaisControleVenda — "Lançar no Mais Controle" (entrega 4).
 * Arquivo do projeto PORTAL-VENDA (ao lado de PortalVenda.gs).
 *
 * O ERP não fala com o Apps Script: o WAF dele exige user-agent de navegador e
 * o UrlFetchApp não deixa trocar. Então aqui só se PEDE ao GitHub que rode o
 * workflow "mc-venda" (Python, venda/mc/lancar.py), que lê a venda no Notion,
 * fala com o ERP e escreve o resultado de volta nas colunas:
 *   MC - SITUAÇÃO  (texto)  PROCESSANDO… / PRÉVIA OK [#hash] | … / CRIADA | venda <id> / JÁ EXISTE … / RECUSADA: …
 *                           (PRÉVIA e CRIADA em linhas: cabeçalho, depois "Cliente: …", "Parcelas: …", "Total: …";
 *                           a tela desenha cada linha como tópico; o carimbo [#hash] fica sempre na 1ª linha)
 *   MC - VENDA ID  (texto)  id da venda no ERP
 * Propriedades: GITHUB_TOKEN (fine-grained, Contents: Read and write no repo),
 * GH_REPO_MC (ex.: "MoraisEng-Teste/PORTAL-MORAIS" — SEM padrão de propósito,
 * para o teste nunca disparar a produção por engano).
 * Gravar de verdade no ERP exige DUAS chaves: o clique em "Lançar" (aplicar)
 * E a variável MC_VENDA_APLICAR=1 no repositório do GitHub. */
var MC_COL_SITUACAO = "MC - SITUAÇÃO";
var MC_COL_VENDA = "MC - VENDA ID";

function mcColunaReal_(props, nome) {
  for (var k in props) if (RegrasVenda.chave(k) === RegrasVenda.chave(nome)) return { nome: k, tipo: props[k].type };
  return null;
}

function mcLerColunas_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  /* casa da VENDAS ou, desde a entrega 7, a própria linha do condomínio (DB_VENDAS_COND):
     o robô lê a linha e grava MC - SITUAÇÃO / MC - VENDA ID nela */
  if (!vendaBaseDaPagina_(pg)) throw new Error("PAGINA_DE_OUTRA_BASE");
  var props = pg.properties || {};
  var s = mcColunaReal_(props, MC_COL_SITUACAO), v = mcColunaReal_(props, MC_COL_VENDA);
  if (!s || !v || s.tipo !== "rich_text" || v.tipo !== "rich_text") throw new Error("COLUNA_FALTANDO: " + MC_COL_SITUACAO + ", " + MC_COL_VENDA + " (texto)");
  return { props: props, situacao: valorProp_(props[s.nome]) || "", vendaId: valorProp_(props[v.nome]) || "", colSituacao: s.nome };
}

function mcEstado_(col, p) {
  var c = mcLerColunas_(p.pageId);
  return { ok: true, situacao: c.situacao, vendaId: c.vendaId };
}

/* PROCESSANDO carimba a hora ([t=ms]); passado este prazo sem resposta do robô
   (workflow cancelado, GitHub fora do ar…), vale pedir de novo. */
var MC_PRAZO_MS = 15 * 60 * 1000;
function mcProcessandoVivo_(situacao, agora) {
  if (!/^PROCESSANDO/.test(situacao || "")) return false;
  var m = /\[t=(\d+)\]/.exec(situacao);
  return !m || (agora - Number(m[1])) < MC_PRAZO_MS;
}

function mcLancar_(col, sess, p) {
  var aplicar = p.aplicar === true || p.aplicar === "true";
  var repo = prop_("GH_REPO_MC"), tk = prop_("GITHUB_TOKEN");
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !tk) return { ok: false, erro: "MC_NAO_CONFIGURADO" };
  /* trava: dois cliques ao mesmo tempo não disparam dois robôs */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "MC_PROCESSANDO" };
  try {
    var c = mcLerColunas_(p.pageId), agora = Date.now();
    if (c.vendaId) return { ok: false, erro: "MC_JA_LANCADA", vendaId: c.vendaId };
    if (mcProcessandoVivo_(c.situacao, agora)) return { ok: false, erro: "MC_PROCESSANDO" };
    if (aplicar && !/^PR[ÉE]VIA OK/i.test(c.situacao)) return { ok: false, erro: "MC_SEM_PREVIA" };

    /* o lançamento leva a assinatura da prévia vista; o robô confere de novo antes de gravar */
    var assin = (/\[#([0-9a-f]{8})\]/.exec(c.situacao) || [])[1] || "";
    var props = {};
    var texto = "PROCESSANDO (" + (aplicar ? "lançamento" : "prévia") + ") — " + hoje_("dd/MM HH:mm") + " [t=" + agora + "]" +
                (aplicar && assin ? " [#" + assin + "]" : "");
    props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: texto } }] };
    notion_("PATCH", "/pages/" + p.pageId, { properties: props });

    var code;
    try {
      code = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/dispatches", {
        method: "post", muteHttpExceptions: true, contentType: "application/json",
        headers: { Authorization: "Bearer " + tk, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        payload: JSON.stringify({ event_type: "mc-venda", client_payload: { pageId: String(p.pageId).replace(/-/g, ""), aplicar: aplicar } })
      }).getResponseCode();
    } catch (e) { code = 0; }
    if (code !== 204) {
      props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: "ERRO: não consegui acionar o robô (" + (code ? "HTTP " + code : "sem resposta do GitHub") + ")" } }] };
      try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); } catch (e) {}
      console.error("PORTAL-VENDA mcLancar dispatch " + (code || "sem resposta"));
      return { ok: false, erro: "MC_DISPARO_FALHOU" };
    }
    console.log("PORTAL-VENDA mcLancar " + String(p.pageId).slice(0, 8) + (aplicar ? " aplicar" : " previa"));
    return { ok: true, aplicar: aplicar };
  } finally {
    lock.releaseLock();
  }
}
