/*************************************************************************
 * EscritorioRobos.gs · PORTAL-MORAIS — 03/11/2026
 * -----------------------------------------------------------------------
 * Aba ESCRITÓRIO DE ROBÔS (escritorio-robos.html): uma mesa por robô do
 * servidor, com o horário de trabalho, o que faz e o relatório de cada
 * rodada (o mesmo do e-mail).
 *
 * Quem monta os dados é o servidor do escritório
 * (_portal\servidor\escritorio_robos.py), que sobe o arquivo
 * robos/escritorio.json para o bucket PRIVADO "analise" do Supabase
 * ORÇADO/REALIZADO. Este arquivo só devolve um LINK ASSINADO de 15 min para
 * a página baixar — a service key fica nas Propriedades do Script
 * (SUPABASE_URL / SUPABASE_SERVICE_KEY, as mesmas da Análise e das Ligações)
 * e nunca vai para o navegador.
 *
 * AÇÕES (roteadas pelo Melhorias.gs — ver a linha do gancho abaixo):
 *   escritorioBoot     link assinado do robos/escritorio.json
 *   escritorioRodar    "Rodar de novo": põe um pedido robo-rodar na FILA DO
 *                      ROBÔ (Propriedade DB_FILA_ROBO, a mesma base que o
 *                      servidor já lê a cada minuto). O servidor roda a
 *                      tarefa agendada com schtasks /Run — a MESMA rodada do
 *                      horário (relatório, e-mail e escritório). Só ADM e
 *                      MASTER; nunca o porteiro nem a fila.
 *   escritorioPdf      (e3, 04/11) link de 15 min do PDF de uma rodada (o mesmo
 *                      do e-mail), que o servidor sobe para robos/pdf/AAAA-MM/
 *   escritorioVersao   diagnóstico
 * Acesso: "ESCRITÓRIO DE ROBÔS" na coluna ACESSOS do LOGINS (ADM, MASTER e
 * TESTES veem sempre). Ver não grava nada; o Rodar de novo só cria a linha
 * do pedido na fila.
 *
 * COMO INSTALAR (projeto PORTAL-LEITURA; no PORTAL-ESCRITA é opcional):
 *   1) Arquivo novo "EscritorioRobos" (script) com este conteúdo.
 *   2) No Melhorias.gs, primeira linha DENTRO de melhoriasRotear_, junto do
 *      gancho do rfRotear_:
 *        if (typeof escRotear_ === "function") { var rEsc = escRotear_(action, sess, p); if (rEsc) return rEsc; }
 *   3) Salvar + Implantar > Gerenciar implantações > lápis > Nova versão.
 *   4) Propriedade do Script DB_FILA_ROBO = id da base FILA DO ROBÔ de
 *      PRODUÇÃO (a mesma "db_fila" da fila "producao" no robos-portal.json
 *      do servidor). Sem ela o botão Rodar de novo avisa FILA_NAO_CONFIGURADA.
 *   Teste: na página, o rodapé mostra "Apps Script e3".
 *************************************************************************/

var ESC_VERSAO = "2026-11-04 e3";
var ESC_BUCKET = "analise";
var ESC_CAMINHO = "robos/escritorio.json";
var ESC_ACESSO = "ESCRITÓRIO DE ROBÔS";

function escRotear_(action, sess, p) {
  if (action === "escritorioVersao") return { ok: true, versao: ESC_VERSAO };
  if (action !== "escritorioBoot" && action !== "escritorioRodar" && action !== "escritorioPdf") return null;
  if (!temAcesso_(sess, ESC_ACESSO)) {
    console.log("BLOQUEADO por falta de acesso " + ESC_ACESSO + ": " + sess.u + " -> " + action);
    return { ok: false, erro: "SEM_PERMISSAO" };
  }
  if (action === "escritorioRodar") return escRodar_(sess, p);
  if (action === "escritorioPdf") return escPdf_(p);
  return escBoot_();
}

/* PDF de uma rodada: só caminhos robos/pdf/AAAA-MM/AAAA-MM-DD_HHMM_<robô>_ok|FALHOU.pdf */
function escPdf_(p) {
  var caminho = String((p && p.caminho) || "");
  if (!/^robos\/pdf\/\d{4}-\d\d\/\d{4}-\d\d-\d\d_\d{4}_[0-9a-z-]{1,40}_(ok|FALHOU)\.pdf$/.test(caminho)) return { ok: false, erro: "PDF_INVALIDO" };
  var url = escAssinar_(caminho, 900);
  return url ? { ok: true, url: url } : { ok: false, erro: "PDF_NAO_ACHADO" };
}

function escAssinar_(caminho, segundos) {
  var cfg = supaCfg_();
  var resp = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/sign/" + ESC_BUCKET + "/" + caminho, {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
    payload: JSON.stringify({ expiresIn: segundos })
  });
  if (resp.getResponseCode() >= 300) return "";
  var j = JSON.parse(resp.getContentText() || "{}"), rel = j.signedURL || j.signedUrl || "";
  if (!rel) return "";
  return /^https?:/.test(rel) ? rel : cfg.url + "/storage/v1" + (rel.charAt(0) === "/" ? "" : "/") + rel;
}

/* Nome de tarefa que o servidor aceita (o robo_fila.py confere de novo, do lado de lá). */
function escTarefaValida_(nome) {
  nome = String(nome || "");
  return /^MoraisEng - [0-9A-Za-zÀ-ÿ ()._-]{2,80}$/.test(nome) && !/porteiro|\(fila\)/i.test(nome);
}

function escRodar_(sess, p) {
  var tipo = String(sess.t || "").toUpperCase();
  if (tipo !== "ADM" && tipo !== "MASTER") return { ok: false, erro: "APENAS_ADM" };
  var tarefa = String((p && p.tarefa) || "");
  if (!escTarefaValida_(tarefa)) return { ok: false, erro: "TAREFA_INVALIDA" };
  /* dois cliques seguidos não viram dois pedidos */
  var cache = CacheService.getScriptCache(), chave = "esc_rodar_" + tarefa.replace(/[^0-9A-Za-z]+/g, "_");
  if (cache.get(chave)) return { ok: true, repetido: true };
  var db = String(prop_("DB_FILA_ROBO") || "").trim();
  if (!db) return { ok: false, erro: "FILA_NAO_CONFIGURADA" };
  var agora = new Date().toISOString(), payload = JSON.stringify({ tarefa: tarefa, quem: sess.u || "" });
  var props = {};
  props["PEDIDO"] = { title: [{ type: "text", text: { content: "robo-rodar " + tarefa.replace(/^MoraisEng - /, "") } }] };
  props["TIPO"] = { select: { name: "robo-rodar" } };
  props["PAYLOAD"] = { rich_text: [{ type: "text", text: { content: payload.slice(0, 2000) } }] };
  props["SITUAÇÃO"] = { select: { name: "PENDENTE" } };
  props["PEDIDO EM"] = { date: { start: agora } };
  try {
    notion_("POST", "/pages", { parent: { database_id: db }, properties: props });
  } catch (e) {
    console.error("ESCRITÓRIO: não consegui pôr o pedido na fila — " + String(e).slice(0, 200));
    return { ok: false, erro: "FILA_FALHOU" };
  }
  cache.put(chave, "1", 120);
  console.log("ESCRITÓRIO: " + (sess.u || "?") + " pediu Rodar de novo: " + tarefa);
  return { ok: true, pedido: agora };
}

function escBoot_() {
  var cfg = supaCfg_();
  var resp = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/sign/" + ESC_BUCKET + "/" + ESC_CAMINHO, {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
    payload: JSON.stringify({ expiresIn: 900 })
  });
  var code = resp.getResponseCode();
  if (code === 400 || code === 404) {
    return { ok: true, url: null, versao: ESC_VERSAO,
             aviso: "O servidor ainda não publicou o escritório (robos/escritorio.json)." };
  }
  if (code >= 300) return { ok: false, erro: "Supabase HTTP " + code + ": " + resp.getContentText().slice(0, 200) };
  var j = JSON.parse(resp.getContentText() || "{}");
  var rel = j.signedURL || j.signedUrl || "";
  if (!rel) return { ok: false, erro: "Supabase não devolveu o link assinado" };
  return { ok: true, versao: ESC_VERSAO,
           url: /^https?:/.test(rel) ? rel : cfg.url + "/storage/v1" + (rel.charAt(0) === "/" ? "" : "/") + rel };
}
