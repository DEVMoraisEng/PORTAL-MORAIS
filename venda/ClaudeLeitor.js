/* ClaudeLeitor — monta o pedido à Messages API da Anthropic e interpreta a
 * resposta. Sem rede: quem envia é o PortalVenda.gs (UrlFetchApp). O Apps
 * Script não tem SDK oficial, por isso o formato HTTP documentado.
 * Roda no Apps Script (ClaudeLeitor.gs) e no node (testes). */
var ClaudeLeitor = (function () {
  "use strict";
  var MODELO = "claude-opus-5";
  var URL = "https://api.anthropic.com/v1/messages";
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

  function montarPedido(tipo, arquivos, chaveApi) {
    if (!ESQUEMAS[tipo]) throw new Error("TIPO_DESCONHECIDO: " + tipo);
    if (!arquivos || !arquivos.length) return { erro: "SEM_ARQUIVO" };
    var blocos = [];
    for (var i = 0; i < arquivos.length; i++) {
      var a = arquivos[i], mime = String(a.mime || "").toLowerCase();
      if (mime === "application/pdf")
        blocos.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } });
      else if (IMAGENS.indexOf(mime) >= 0)
        blocos.push({ type: "image", source: { type: "base64", media_type: mime, data: a.base64 } });
      else return { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" };
    }
    blocos.push({ type: "text", text: INSTRUCOES[tipo] + REGRA });
    return {
      url: URL,
      headers: { "x-api-key": chaveApi, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
      corpo: {
        model: MODELO, max_tokens: 16000, fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMAS[tipo] } },
        messages: [{ role: "user", content: blocos }]
      }
    };
  }

  function interpretarResposta(status, texto) {
    var j;
    try { j = JSON.parse(texto); } catch (e) { j = null; }
    if (status >= 400) {
      var tipo = (j && j.error && j.error.type) ? String(j.error.type).toUpperCase() : "HTTP_" + status;
      return { ok: false, erro: "API_" + tipo };
    }
    if (!j) return { ok: false, erro: "RESPOSTA_ILEGIVEL" };
    if (j.stop_reason === "refusal") return { ok: false, erro: "LEITURA_RECUSADA" };
    if (j.stop_reason === "max_tokens") return { ok: false, erro: "LEITURA_INCOMPLETA" };
    var txt = (j.content || []).filter(function (b) { return b.type === "text"; })
      .map(function (b) { return b.text; }).join("");
    var leitura;
    try { leitura = JSON.parse(txt); } catch (e) { return { ok: false, erro: "RESPOSTA_ILEGIVEL" }; }
    var u = j.usage || {};
    return { ok: true, leitura: leitura, uso: { entrada: u.input_tokens || 0, saida: u.output_tokens || 0 } };
  }

  return { MODELO: MODELO, ESQUEMAS: ESQUEMAS, montarPedido: montarPedido, interpretarResposta: interpretarResposta };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ClaudeLeitor;
