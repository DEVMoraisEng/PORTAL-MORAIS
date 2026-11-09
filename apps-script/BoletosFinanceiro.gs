/*************************************************************************
 * BoletosFinanceiro.gs · PORTAL-MORAIS — 09/11/2026
 * -----------------------------------------------------------------------
 * Página boletos-financeiro.html: boletos do mês e financeiro por unidade do
 * CONDOMÍNIO RESERVA DOS IPÊS. Quem monta os dados é o servidor do escritório
 * (servidor/boletos_portal.py), que sobe robos/boletos-financeiro.json para o
 * bucket PRIVADO "analise". O arquivo leva nome e valor: só sai por link
 * assinado de 15 min, depois de conferir o acesso.
 *
 * AÇÕES (roteadas pelo Melhorias.gs):
 *   bfBoot       link assinado; diz se a pessoa pode segurar
 *   bfSegurar    Segurar/Soltar uma parcela: só ADM e MASTER. Só cria a linha
 *                boleto-segurar na FILA DO ROBÔ; o servidor confere de novo.
 *   bfAtualizar  pede a leitura das vendas (tarefa do retrato). Só lê o ERP,
 *                então vale para todos com o acesso.
 *   bfVersao     diagnóstico
 * Acesso: "BOLETOS E FINANCEIRO" na coluna ACESSOS do LOGINS.
 *
 * COMO INSTALAR (projeto PORTAL-LEITURA):
 *   1) Arquivo novo "BoletosFinanceiro" (script) com este conteúdo.
 *   2) No Melhorias.gs, a linha do gancho dentro de melhoriasRotear_:
 *        if (typeof bfRotear_ === "function") { var rBf = bfRotear_(action, sess, p); if (rBf) return rBf; }
 *   3) Implantar → Gerenciar implantações → editar → Nova versão.
 *   Usa as Propriedades que o Escritório já usa: SUPABASE_URL,
 *   SUPABASE_SERVICE_KEY e DB_FILA_ROBO.
 *************************************************************************/

var BF_VERSAO = "2026-11-09 b1";
var BF_ACESSO = "BOLETOS E FINANCEIRO";
var BF_BUCKET = "analise";
var BF_CAMINHO = "robos/boletos-financeiro.json";
var BF_TAREFA_RETRATO = "MoraisEng - Robo retratos";

function bfRotear_(action, sess, p) {
  if (action === "bfVersao") return { ok: true, versao: BF_VERSAO };
  if (action !== "bfBoot" && action !== "bfSegurar" && action !== "bfAtualizar") return null;
  if (!temAcesso_(sess, BF_ACESSO)) {
    console.log("BLOQUEADO por falta de acesso " + BF_ACESSO + ": " + sess.u + " -> " + action);
    return { ok: false, erro: "SEM_PERMISSAO" };
  }
  if (action === "bfSegurar") return bfSegurar_(sess, p);
  if (action === "bfAtualizar") return bfAtualizar_(sess);
  return bfBoot_(sess);
}

function bfPodeSegurar_(sess) {
  var tipo = String(sess.t || "").toUpperCase();
  return tipo === "ADM" || tipo === "MASTER";
}

/* Põe um pedido na FILA DO ROBÔ. O cache faz dois cliques seguidos virarem um pedido só. */
function bfPedido_(titulo, tipo, payload, chaveCache, segundos) {
  var cache = CacheService.getScriptCache();
  if (cache.get(chaveCache)) return { ok: true, repetido: true };
  var db = String(prop_("DB_FILA_ROBO") || "").trim();
  if (!db) return { ok: false, erro: "FILA_NAO_CONFIGURADA" };
  var agora = new Date().toISOString(), props = {};
  props["PEDIDO"] = { title: [{ type: "text", text: { content: titulo } }] };
  props["TIPO"] = { select: { name: tipo } };
  props["PAYLOAD"] = { rich_text: [{ type: "text", text: { content: JSON.stringify(payload).slice(0, 2000) } }] };
  props["SITUAÇÃO"] = { select: { name: "PENDENTE" } };
  props["PEDIDO EM"] = { date: { start: agora } };
  try {
    notion_("POST", "/pages", { parent: { database_id: db }, properties: props });
  } catch (e) {
    console.error("BOLETOS: não consegui pôr o pedido na fila — " + String(e).slice(0, 200));
    return { ok: false, erro: "FILA_FALHOU" };
  }
  cache.put(chaveCache, "1", segundos);
  return { ok: true, pedido: agora };
}

function bfSegurar_(sess, p) {
  if (!bfPodeSegurar_(sess)) return { ok: false, erro: "APENAS_ADM" };
  var acao = String((p && p.acao) || ""), parcela = String((p && p.parcela) || "");
  if (acao !== "segurar" && acao !== "soltar") return { ok: false, erro: "PEDIDO_INVALIDO" };
  if (!/^[0-9a-fA-F-]{32,36}$/.test(parcela)) return { ok: false, erro: "PEDIDO_INVALIDO" };
  return bfPedido_("boleto-" + acao + " " + parcela.slice(0, 8), "boleto-segurar",
                   { acao: acao, parcela: parcela, quem: sess.u || "" },
                   "bf_" + acao + "_" + parcela.replace(/-/g, ""), 30);
}

function bfAtualizar_(sess) {
  return bfPedido_("robo-rodar Robo retratos (Boletos e Financeiro)", "robo-rodar",
                   { tarefa: BF_TAREFA_RETRATO, quem: sess.u || "" }, "bf_atualizar", 120);
}

function bfBoot_(sess) {
  var cfg = supaCfg_();
  var resp = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/sign/" + BF_BUCKET + "/" + BF_CAMINHO, {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
    payload: JSON.stringify({ expiresIn: 900 })
  });
  var code = resp.getResponseCode(), pode = bfPodeSegurar_(sess);
  if (code === 400 || code === 404) {
    return { ok: true, url: null, versao: BF_VERSAO, podeSegurar: pode,
             aviso: "O servidor ainda não publicou os boletos e o financeiro." };
  }
  if (code >= 300) return { ok: false, erro: "Supabase HTTP " + code + ": " + resp.getContentText().slice(0, 200) };
  var j = JSON.parse(resp.getContentText() || "{}");
  var rel = j.signedURL || j.signedUrl || "";
  if (!rel) return { ok: false, erro: "Supabase não devolveu o link assinado" };
  return { ok: true, versao: BF_VERSAO, podeSegurar: pode,
           url: /^https?:/.test(rel) ? rel : cfg.url + "/storage/v1" + (rel.charAt(0) === "/" ? "" : "/") + rel };
}
