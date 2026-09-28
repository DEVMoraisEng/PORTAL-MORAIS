/* OpenAILeitor — monta o pedido à Responses API da OpenAI e interpreta a
 * resposta. Mesma interface do ClaudeLeitor.js (montarPedido/interpretarResposta),
 * mesmos ESQUEMAS. Sem rede: quem envia é o PortalVenda.gs (UrlFetchApp).
 * Roda no Apps Script (OpenAILeitor.gs) e no node (testes). */
var OpenAILeitor = (function () {
  "use strict";
  var MODELO_PADRAO = "gpt-6-luna";
  var URL = "https://api.openai.com/v1/responses";
  var IMAGENS = ["image/jpeg", "image/png", "image/webp"];
  var S = { type: "string" };

  function objeto(props) {
    return { type: "object", additionalProperties: false, required: Object.keys(props), properties: props };
  }
  var ESQUEMAS = {
    identidade: objeto({
      tipo_documento: { type: "string", enum: ["CNH", "RG", "OUTRO"] },
      nome: S, cpf: S, numero_documento: S, orgao_emissor: S, nacionalidade: S, data_nascimento: S,
      rg_numero: S, rg_orgao_uf: S
    }),
    comprovante: objeto({
      tipo_documento: { type: "string", enum: ["COMPROVANTE", "OUTRO"] },
      titular: S, endereco_completo: S, data_emissao: S
    }),
    aprovacao: objeto({
      tipo_documento: { type: "string", enum: ["APROVACAO", "OUTRO"] },
      nome_proponente: S, cpf_proponente: S, valor_financiado: S, valor_fgts: S, valor_subsidio: S
    })
  };
  var INSTRUCOES = {
    identidade: "Os arquivos deveriam ser a identidade (CNH ou RG, frente e verso podem vir em arquivos separados) de um comprador de imóvel. tipo_documento: CNH, RG, ou OUTRO se não for identidade. cpf só com números. numero_documento: número do RG ou o número de registro da CNH. orgao_emissor como impresso (ex.: SSP/GO, DETRAN/GO). data_nascimento em dd/mm/aaaa. nacionalidade como se escreve num contrato (ex.: brasileira). rg_numero: o número do RG (Registro Geral). Na CNH ele fica no campo 'DOC. IDENTIDADE / ÓRG. EMISSOR / UF' — pegue só o número. rg_orgao_uf: o órgão emissor e a UF do RG (ex.: SSP/GO). numero_documento continua sendo o número principal do documento (na CNH, o nº de registro).",
    comprovante: "Os arquivos deveriam ser um comprovante de endereço (conta de água, luz, telefone, internet ou similar). tipo_documento: COMPROVANTE, ou OUTRO se não for. titular: o nome impresso como titular. endereco_completo: logradouro, número, quadra e lote se houver, complemento, bairro, cidade/UF e CEP, numa linha só. data_emissao: a data de emissão (ou, na falta, o vencimento) em dd/mm/aaaa.",
    aprovacao: "Os arquivos deveriam ser a aprovação de financiamento habitacional da Caixa (tela ou documento). tipo_documento: APROVACAO, ou OUTRO se não for. cpf_proponente só com números. Valores em reais como impressos (ex.: 180.000,00)."
  };
  var REGRA = " Responda só com o que está escrito nos arquivos. Campo ilegível ou ausente: string vazia. Não invente nem complete.";

  function montarPedido(tipo, arquivos, chaveApi, modelo) {
    if (!ESQUEMAS[tipo]) throw new Error("TIPO_DESCONHECIDO: " + tipo);
    if (!arquivos || !arquivos.length) return { erro: "SEM_ARQUIVO" };
    var blocos = [], numeroPdf = 0;
    for (var i = 0; i < arquivos.length; i++) {
      var a = arquivos[i], mime = String(a.mime || "").toLowerCase();
      if (mime === "application/pdf") {
        numeroPdf++;
        blocos.push({ type: "input_file", filename: "documento-" + numeroPdf + ".pdf", file_data: "data:application/pdf;base64," + a.base64 });
      } else if (IMAGENS.indexOf(mime) >= 0) {
        blocos.push({ type: "input_image", image_url: "data:" + mime + ";base64," + a.base64, detail: "high" });
      } else return { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" };
    }
    blocos.push({ type: "input_text", text: INSTRUCOES[tipo] + REGRA });
    return {
      url: URL,
      headers: { "Authorization": "Bearer " + chaveApi },
      corpo: {
        model: modelo || MODELO_PADRAO,
        max_output_tokens: 16000,
        input: [{ role: "user", content: blocos }],
        text: { format: { type: "json_schema", name: "leitura_" + tipo, schema: ESQUEMAS[tipo], strict: true } }
      }
    };
  }

  function interpretarResposta(status, texto) {
    var j;
    try { j = JSON.parse(texto); } catch (e) { j = null; }
    if (status >= 400) {
      if (!j) return { ok: false, erro: "API_HTTP_" + status };
      var erroApi = j.error || {};
      var codigo = erroApi.code || erroApi.type || ("HTTP_" + status);
      return { ok: false, erro: "API_" + String(codigo).toUpperCase() };
    }
    if (!j) return { ok: false, erro: "RESPOSTA_ILEGIVEL" };
    if (j.status === "incomplete") return { ok: false, erro: "LEITURA_INCOMPLETA" };
    var saida = j.output || [], i2, k2;
    for (i2 = 0; i2 < saida.length; i2++) {
      var conteudoR = saida[i2].content || [];
      for (k2 = 0; k2 < conteudoR.length; k2++) {
        if (conteudoR[k2].type === "refusal") return { ok: false, erro: "LEITURA_RECUSADA" };
      }
    }
    var txt = "";
    for (i2 = 0; i2 < saida.length; i2++) {
      var conteudoT = saida[i2].content || [];
      for (k2 = 0; k2 < conteudoT.length; k2++) {
        if (conteudoT[k2].type === "output_text") txt += conteudoT[k2].text;
      }
    }
    var leitura;
    try { leitura = JSON.parse(txt); } catch (e2) { return { ok: false, erro: "RESPOSTA_ILEGIVEL" }; }
    var u = j.usage || {};
    return { ok: true, leitura: leitura, uso: { entrada: u.input_tokens || 0, saida: u.output_tokens || 0 } };
  }

  return { MODELO_PADRAO: MODELO_PADRAO, ESQUEMAS: ESQUEMAS, montarPedido: montarPedido, interpretarResposta: interpretarResposta };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OpenAILeitor;
