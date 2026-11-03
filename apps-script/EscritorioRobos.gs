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
 *   escritorioVersao   diagnóstico
 * Acesso: "ESCRITÓRIO DE ROBÔS" na coluna ACESSOS do LOGINS (ADM, MASTER e
 * TESTES veem sempre). Só leitura: nada grava no Notion nem no ERP.
 *
 * COMO INSTALAR (projeto PORTAL-LEITURA; no PORTAL-ESCRITA é opcional):
 *   1) Arquivo novo "EscritorioRobos" (script) com este conteúdo.
 *   2) No Melhorias.gs, primeira linha DENTRO de melhoriasRotear_, junto do
 *      gancho do rfRotear_:
 *        if (typeof escRotear_ === "function") { var rEsc = escRotear_(action, sess, p); if (rEsc) return rEsc; }
 *   3) Salvar + Implantar > Gerenciar implantações > lápis > Nova versão.
 *   Teste: na página, o rodapé mostra "Apps Script e1".
 *************************************************************************/

var ESC_VERSAO = "2026-11-03 e1";
var ESC_BUCKET = "analise";
var ESC_CAMINHO = "robos/escritorio.json";
var ESC_ACESSO = "ESCRITÓRIO DE ROBÔS";

function escRotear_(action, sess, p) {
  if (action === "escritorioVersao") return { ok: true, versao: ESC_VERSAO };
  if (action !== "escritorioBoot") return null;
  if (!temAcesso_(sess, ESC_ACESSO)) {
    console.log("BLOQUEADO por falta de acesso " + ESC_ACESSO + ": " + sess.u + " -> " + action);
    return { ok: false, erro: "SEM_PERMISSAO" };
  }
  return escBoot_();
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
