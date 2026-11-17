/*************************************************************************
 * AnalistaProjetos.gs · PORTAL-MORAIS — 17/11/2026
 * -----------------------------------------------------------------------
 * Aba ANALISTA DE PROJETOS (analista-projetos.html, grupo AUTOMAÇÕES): o
 * projetista solta o PDF do projeto e a IA confere a prancha contra as
 * exigências que as prefeituras de GOIÂNIA e SENADOR CANEDO já devolveram
 * em correção. As regras, o corte da prancha em imagens e as contas ficam
 * na página; este arquivo só guarda a CHAVE DA OPENAI e faz a chamada —
 * a chave nunca vai para o navegador (o repositório é público).
 *
 * AÇÕES (roteadas pelo Melhorias.gs — ver a linha do gancho abaixo):
 *   analistaLer      lê um lote de recortes da prancha (até 6 imagens JPEG
 *                    em base64 + instrução) e devolve o JSON da leitura
 *   analistaLaudo    cruza as leituras (só texto) e devolve o JSON do laudo
 *   analistaVersao   diagnóstico: versão e se a chave está configurada
 * Acesso: "ANALISTA DE PROJETOS" na coluna ACESSOS do LOGINS (ADM, MASTER e
 * TESTES passam sempre). Não grava nada no Notion nem no Supabase.
 *
 * COMO INSTALAR (projeto PORTAL-LEITURA):
 *   1) Arquivo novo "AnalistaProjetos" (script) com este conteúdo.
 *   2) No Melhorias.gs, DENTRO de melhoriasRotear_, junto dos outros ganchos:
 *        if (typeof anaRotear_ === "function") { var rAna = anaRotear_(action, sess, p); if (rAna) return rAna; }
 *   3) Propriedades do Script:
 *        OPENAI_API_KEY    a mesma chave do AUT-CONFERENCIA-NF (obrigatória)
 *        ANALISTA_MODELO   opcional; vazio = ANA_MODELO_PADRAO
 *        ANALISTA_LIMITE   opcional; chamadas por login a cada 6 h (padrão 400)
 *   4) Salvar + Implantar > Gerenciar implantações > lápis > Nova versão.
 *   Teste: no rodapé do painel da página aparece "Apps Script a1".
 *************************************************************************/

var ANA_VERSAO = "a1";
var ANA_ACESSO = "ANALISTA DE PROJETOS";
var ANA_MODELO_PADRAO = "gpt-6-luna";            // o mesmo padrão do venda/OpenAILeitor.js
var ANA_URL = "https://api.openai.com/v1/responses";
var ANA_MAX_IMAGENS = 6;
var ANA_MAX_PROMPT = 320000;                     // caracteres
var ANA_MAX_IMG_B64 = 2800000;                   // ~2 MB por imagem

function anaRotear_(action, sess, p) {
  if (action === "analistaVersao") return { ok: true, versao: ANA_VERSAO, chave: !!prop_("OPENAI_API_KEY") };
  if (action !== "analistaLer" && action !== "analistaLaudo") return null;
  if (!temAcesso_(sess, ANA_ACESSO)) {
    console.log("BLOQUEADO por falta de acesso " + ANA_ACESSO + ": " + sess.u + " -> " + action);
    return { ok: false, erro: "SEM_PERMISSAO" };
  }
  var chave = prop_("OPENAI_API_KEY");
  if (!chave) return { ok: false, erro: "SEM_CHAVE_OPENAI" };
  if (!anaDentroDoLimite_(sess.u)) return { ok: false, erro: "LIMITE_ATINGIDO" };

  var prompt = String((p && p.prompt) || "");
  if (!prompt || prompt.length > ANA_MAX_PROMPT) return { ok: false, erro: "PEDIDO_INVALIDO: prompt" };
  var imagens = (action === "analistaLer" && p && p.imagens) || [];
  if (Object.prototype.toString.call(imagens) !== "[object Array]" || imagens.length > ANA_MAX_IMAGENS) {
    return { ok: false, erro: "PEDIDO_INVALIDO: imagens" };
  }
  var blocos = [];
  for (var i = 0; i < imagens.length; i++) {
    var b = String(imagens[i] || "");
    /* só JPEG em base64 puro (começa com /9j/): nada de URL nem de outro tipo de arquivo */
    if (b.length > ANA_MAX_IMG_B64 || b.indexOf("/9j/") !== 0 || !/^[A-Za-z0-9+\/=]+$/.test(b)) {
      return { ok: false, erro: "PEDIDO_INVALIDO: imagem " + (i + 1) };
    }
    blocos.push({ type: "input_image", image_url: "data:image/jpeg;base64," + b, detail: "high" });
  }
  blocos.push({ type: "input_text", text: prompt });

  var corpo = {
    model: prop_("ANALISTA_MODELO") || ANA_MODELO_PADRAO,
    max_output_tokens: action === "analistaLaudo" ? 32000 : 12000,
    input: [{ role: "user", content: blocos }],
    text: { format: { type: "json_object" } }
  };
  var resp;
  try {
    resp = UrlFetchApp.fetch(ANA_URL, {
      method: "post", muteHttpExceptions: true, contentType: "application/json",
      headers: { Authorization: "Bearer " + chave }, payload: JSON.stringify(corpo)
    });
  } catch (e) {
    console.log("analista: falha de rede na OpenAI — " + e);
    return { ok: false, erro: "OPENAI_OCUPADA" };
  }
  return anaInterpretar_(resp.getResponseCode(), resp.getContentText());
}

/* Resposta da Responses API -> { ok, json } ou { ok:false, erro } com os
   mesmos códigos que a Conferência OC × NF mostra na tela. */
function anaInterpretar_(status, texto) {
  var j;
  try { j = JSON.parse(texto); } catch (e) { j = null; }
  if (status >= 400) {
    var er = (j && j.error) || {}, cod = String(er.code || er.type || "").toLowerCase();
    console.log("analista: OpenAI HTTP " + status + " " + cod + " — " + String(er.message || "").slice(0, 300));
    if (status === 401 || cod === "invalid_api_key") return { ok: false, erro: "CHAVE_OPENAI_INVALIDA" };
    if (cod === "insufficient_quota") return { ok: false, erro: "OPENAI_SEM_CREDITO" };
    if (cod === "model_not_found") return { ok: false, erro: "MODELO_INVALIDO" };
    if (status === 429 || status >= 500) return { ok: false, erro: "OPENAI_OCUPADA" };
    if (cod === "context_length_exceeded" || status === 413) return { ok: false, erro: "RESPOSTA_CORTADA" };
    return { ok: false, erro: "API_" + (cod || ("HTTP_" + status)).toUpperCase() };
  }
  if (!j) return { ok: false, erro: "RESPOSTA_ILEGIVEL" };
  if (j.status === "incomplete") return { ok: false, erro: "RESPOSTA_CORTADA" };
  var saida = j.output || [], txt = "", a, b;
  for (a = 0; a < saida.length; a++) {
    var c = saida[a].content || [];
    for (b = 0; b < c.length; b++) {
      if (c[b].type === "refusal") return { ok: false, erro: "LEITURA_RECUSADA" };
      if (c[b].type === "output_text") txt += c[b].text;
    }
  }
  var valor;
  try { valor = JSON.parse(txt); }
  catch (e2) {
    /* tolera uma cerca ```json ... ``` ou frase antes/depois do objeto */
    var ini = txt.indexOf("{"), fim = txt.lastIndexOf("}");
    try { valor = JSON.parse(txt.slice(ini, fim + 1)); } catch (e3) { return { ok: false, erro: "RESPOSTA_ILEGIVEL" }; }
  }
  var u = j.usage || {};
  return { ok: true, json: valor, uso: { entrada: u.input_tokens || 0, saida: u.output_tokens || 0 } };
}

/* Teto de chamadas por login a cada 6 h (um projeto na profundidade Padrão
   gasta 5 a 8 chamadas). Protege o crédito da OpenAI de um laço na página. */
function anaDentroDoLimite_(login) {
  var limite = parseInt(prop_("ANALISTA_LIMITE") || "400", 10) || 400;
  var cache = CacheService.getScriptCache(), k = "ana_uso_" + String(login || "").toLowerCase();
  var n = parseInt(cache.get(k) || "0", 10) || 0;
  if (n >= limite) return false;
  cache.put(k, String(n + 1), 21600);
  return true;
}
