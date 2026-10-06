/* MaisControleVenda — "Lançar no Mais Controle" (entrega 4).
 * Arquivo do projeto PORTAL-VENDA (ao lado de PortalVenda.gs).
 *
 * O ERP não fala com o Apps Script: o WAF dele exige user-agent de navegador e
 * o UrlFetchApp não deixa trocar. Então aqui só se PEDE ao GitHub que rode o
 * workflow "mc-venda" (Python, venda/mc/lancar.py), que lê a venda no Notion,
 * fala com o ERP e escreve o resultado de volta nas colunas:
 *   MC - SITUAÇÃO  (texto)  PROCESSANDO… / PRÉVIA OK — … / CRIADA … / JÁ EXISTE … / RECUSADA: …
 *   MC - VENDA ID  (texto)  id da venda no ERP
 * Propriedades: GITHUB_TOKEN (fine-grained, Contents: Read and write no repo),
 * GH_REPO_MC (ex.: "MoraisEng-Teste/PORTAL-MORAIS" — SEM padrão de propósito,
 * para o teste nunca disparar a produção por engano).
 * Gravar de verdade no ERP exige DUAS chaves: o clique em "Lançar" (aplicar)
 * E a variável MC_APLICAR=1 no repositório do GitHub. */
var MC_COL_SITUACAO = "MC - SITUAÇÃO";
var MC_COL_VENDA = "MC - VENDA ID";

function mcColunaReal_(props, nome) {
  for (var k in props) if (RegrasVenda.chave(k) === RegrasVenda.chave(nome)) return { nome: k, tipo: props[k].type };
  return null;
}

function mcLerColunas_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  var dbEsperado = prop_("DB_VENDAS").replace(/-/g, "");
  if (String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "") !== dbEsperado) throw new Error("PAGINA_DE_OUTRA_BASE");
  var props = pg.properties || {};
  var s = mcColunaReal_(props, MC_COL_SITUACAO), v = mcColunaReal_(props, MC_COL_VENDA);
  if (!s || !v || s.tipo !== "rich_text" || v.tipo !== "rich_text") throw new Error("COLUNA_FALTANDO: " + MC_COL_SITUACAO + ", " + MC_COL_VENDA + " (texto)");
  return { props: props, situacao: valorProp_(props[s.nome]) || "", vendaId: valorProp_(props[v.nome]) || "", colSituacao: s.nome };
}

function mcEstado_(col, p) {
  var c = mcLerColunas_(p.pageId);
  return { ok: true, situacao: c.situacao, vendaId: c.vendaId };
}

function mcLancar_(col, sess, p) {
  var aplicar = p.aplicar === true || p.aplicar === "true";
  var repo = prop_("GH_REPO_MC"), tk = prop_("GITHUB_TOKEN");
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !tk) return { ok: false, erro: "MC_NAO_CONFIGURADO" };
  var c = mcLerColunas_(p.pageId);
  if (c.vendaId) return { ok: false, erro: "MC_JA_LANCADA", vendaId: c.vendaId };
  if (/^PROCESSANDO/.test(c.situacao)) return { ok: false, erro: "MC_PROCESSANDO" };
  if (aplicar && !/^PR[ÉE]VIA OK/i.test(c.situacao)) return { ok: false, erro: "MC_SEM_PREVIA" };

  var props = {};
  props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: "PROCESSANDO (" + (aplicar ? "lançamento" : "prévia") + ") — " + hoje_("dd/MM HH:mm") } }] };
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });

  var r = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/dispatches", {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { Authorization: "Bearer " + tk, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    payload: JSON.stringify({ event_type: "mc-venda", client_payload: { pageId: String(p.pageId).replace(/-/g, ""), aplicar: aplicar } })
  });
  if (r.getResponseCode() !== 204) {
    props[c.colSituacao] = { rich_text: [{ type: "text", text: { content: "ERRO: o GitHub recusou o pedido (HTTP " + r.getResponseCode() + ")" } }] };
    try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); } catch (e) {}
    console.error("PORTAL-VENDA mcLancar dispatch HTTP " + r.getResponseCode());
    return { ok: false, erro: "MC_DISPARO_FALHOU" };
  }
  console.log("PORTAL-VENDA mcLancar " + String(p.pageId).slice(0, 8) + (aplicar ? " aplicar" : " previa"));
  return { ok: true, aplicar: aplicar };
}
