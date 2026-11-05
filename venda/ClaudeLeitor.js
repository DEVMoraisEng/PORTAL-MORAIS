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
    }),
    /* documentos do imóvel (entrega 11) */
    matricula: objeto({
      tipo_documento: { type: "string", enum: ["MATRICULA", "OUTRO"] },
      matricula_numero: S, cartorio: S, area_m2: S, confrontacoes: S,
      loteamento_denominacao: S, loteamento_matricula: S, loteamento_cartorio: S,
      /* 05/11/2026 (dono): qualificação do proprietário ATUAL — o vendedor do contrato da casa de rua */
      proprietario_nome: S, proprietario_cpf_cnpj: S, nacionalidade: S, estado_civil: S, profissao: S, rg: S, endereco: S
    }),
    alvara: objeto({
      tipo_documento: { type: "string", enum: ["ALVARA", "OUTRO"] },
      numero: S, data: S
    }),
    habitese: objeto({
      tipo_documento: { type: "string", enum: ["HABITESE", "OUTRO"] },
      numero: S, data: S
    }),
    /* entrega 13: certidão da matrícula-mãe do condomínio/loteamento + a descrição DESTA unidade */
    certidao_mae: objeto({
      tipo_documento: { type: "string", enum: ["CERTIDAO_MAE", "OUTRO"] },
      loteamento_denominacao: S, matricula_mae: S, cartorio: S,
      unidade_encontrada: { type: "string", enum: ["SIM", "NAO"] },
      unidade_identificacao: S, unidade_confrontacoes: S, unidade_area_privativa_m2: S, unidade_area_total_m2: S
    }),
    /* entrega 13: "soltar todos os documentos" — só diz o que é o arquivo (e de quem, se for pessoal) */
    /* 28/10: conferência dos documentos — a certidão diz o estado civil */
    certidao_civil: objeto({
      tipo_documento: { type: "string", enum: ["CERTIDAO_NASCIMENTO", "CERTIDAO_CASAMENTO", "AVERBACAO_DIVORCIO", "CERTIDAO_OBITO", "OUTRO"] },
      nome: S, estado_civil: S, regime_bens: S
    }),
    /* 03/11/2026: CRLV do veículo da permuta (formulário do bem no Alterar fluxo; FluxoLivre.crlvDaLeitura) */
    crlv: objeto({
      tipo_documento: { type: "string", enum: ["CRLV", "OUTRO"] },
      marca: S, modelo: S, ano_fabricacao: S, ano_modelo: S, cor: S, placa: S, renavam: S, chassi: S,
      proprietario_nome: S, proprietario_doc: S, observacoes: S
    }),
    classificar: objeto({
      tipo_documento: { type: "string", enum: ["IDENTIDADE", "COMPROVANTE", "APROVACAO", "MATRICULA", "CERTIDAO_MAE", "ALVARA", "HABITESE", "OUTRO"] },
      nome: S, cpf: S
    })
  };
  var INSTRUCOES = {
    identidade: "Os arquivos deveriam ser a identidade (CNH ou RG, frente e verso podem vir em arquivos separados) de um comprador de imóvel. tipo_documento: CNH, RG, ou OUTRO se não for identidade. cpf só com números. numero_documento: número do RG ou o número de registro da CNH. orgao_emissor como impresso (ex.: SSP/GO, DETRAN/GO). data_nascimento em dd/mm/aaaa. nacionalidade como se escreve num contrato (ex.: brasileira). rg_numero: o número do RG (Registro Geral). Na CNH ele fica no campo 'DOC. IDENTIDADE / ÓRG. EMISSOR / UF' — pegue só o número. rg_orgao_uf: o órgão emissor e a UF do RG (ex.: SSP/GO). numero_documento continua sendo o número principal do documento (na CNH, o nº de registro).",
    comprovante: "Os arquivos deveriam ser um comprovante de endereço (conta de água, luz, telefone, internet ou similar). tipo_documento: COMPROVANTE, ou OUTRO se não for. titular: o nome impresso como titular. endereco_completo: logradouro, número, quadra e lote se houver, complemento, bairro, cidade/UF e CEP, numa linha só. data_emissao: a data de emissão (ou, na falta, o vencimento) em dd/mm/aaaa.",
    aprovacao: "Os arquivos deveriam ser a aprovação de financiamento habitacional da Caixa (tela ou documento). tipo_documento: APROVACAO, ou OUTRO se não for. cpf_proponente só com números. Valores em reais como impressos (ex.: 180.000,00).",
    matricula: "Os arquivos deveriam ser a certidão de matrícula (inteiro teor) de um lote ou casa, emitida pelo cartório de registro de imóveis. tipo_documento: MATRICULA, ou OUTRO se não for. matricula_numero: só o número da matrícula individual do imóvel (ex.: 12.345), sem a palavra matrícula. cartorio: a serventia como impressa no cabeçalho (ex.: Cartório de Registro de Imóveis da 1ª Circunscrição de Cidade/UF). area_m2: a área total do lote em metros quadrados, só o número como impresso (ex.: 360,00). confrontacoes: as medidas e confrontações do lote numa linha só, como descritas (frente, fundo, lados). loteamento_denominacao, loteamento_matricula e loteamento_cartorio: quando a casa for unidade de um condomínio (ex.: Condomínio Residencial Exemplo SPE X), o nome desse CONDOMÍNIO como impresso, o número da matrícula-mãe do condomínio e o cartório onde ele foi registrado; se não for condomínio, o nome do loteamento, a matrícula (ou registro) do loteamento e o cartório; se a certidão não citar, string vazia. proprietario_nome, proprietario_cpf_cnpj, nacionalidade, estado_civil, profissao, rg e endereco: a qualificação do proprietário ATUAL do imóvel — quem adquiriu no ÚLTIMO registro de transmissão (R-n de compra e venda, doação, permuta, dação, arrematação, adjudicação ou integralização de capital); sem nenhum registro de transmissão, o proprietário da abertura da matrícula. Averbação não muda o proprietário. Mais de um proprietário atual: os dados do primeiro citado e, em proprietario_nome, todos os nomes separados por ' e '. proprietario_nome: o nome (ou a razão social) como impresso. proprietario_cpf_cnpj: o CPF ou CNPJ desse proprietário só com números, com todos os dígitos. nacionalidade, estado_civil e profissao como impressos na qualificação (ex.: brasileiro, solteiro, empresário). rg: o número da identidade com o órgão emissor, como impresso (ex.: 1234567 SSP/GO). endereco: a residência (pessoa) ou a sede (empresa) do proprietário como impressa, numa linha só. Empresa: nacionalidade, estado_civil, profissao e rg vazios.",
    alvara: "Os arquivos deveriam ser o alvará de construção (licença para construir) emitido pela prefeitura. tipo_documento: ALVARA, ou OUTRO se não for (habite-se não é alvará). numero: o número do alvará como impresso. data: a data de emissão do alvará em dd/mm/aaaa.",
    habitese: "Os arquivos deveriam ser o habite-se (certidão de conclusão de obra / carta de habite-se) emitido pela prefeitura. tipo_documento: HABITESE, ou OUTRO se não for (alvará de construção não é habite-se). numero: o número do habite-se como impresso. data: a data de emissão do habite-se em dd/mm/aaaa.",
    certidao_mae: "Os arquivos deveriam ser a certidão da matrícula-mãe (inteiro teor) de um condomínio ou loteamento, com a instituição/especificação das unidades, emitida pelo cartório de registro de imóveis. tipo_documento: CERTIDAO_MAE, ou OUTRO se não for (a matrícula individual de uma só casa não é certidão mãe). loteamento_denominacao: o nome do condomínio ou loteamento como impresso (ex.: Residencial Exemplo). matricula_mae: só o número da matrícula-mãe, sem a palavra matrícula. cartorio: a serventia como impressa no cabeçalho. unidade_encontrada: SIM se a certidão descreve a unidade indicada abaixo, NAO se não descreve ou se não houver unidade indicada. unidade_identificacao: como a certidão identifica essa unidade (ex.: Casa 1, Quadra 01, Lote 26). unidade_confrontacoes: as medidas e confrontações DESSA unidade numa linha só, como descritas (frente, fundo, lados). unidade_area_privativa_m2 e unidade_area_total_m2: as áreas dessa unidade em metros quadrados, só o número como impresso (ex.: 70,50). Campos unidade_* vazios se unidade_encontrada for NAO.",
    certidao_civil: "Os arquivos deveriam ser a certidão de estado civil de um comprador de imóvel (nascimento, casamento, casamento com averbação de divórcio, ou óbito do cônjuge). tipo_documento: CERTIDAO_NASCIMENTO, CERTIDAO_CASAMENTO, AVERBACAO_DIVORCIO (casamento com divórcio averbado), CERTIDAO_OBITO, ou OUTRO se não for certidão. nome: o nome do registrado (na de casamento, os dois cônjuges separados por ' e '). estado_civil: SOLTEIRO, CASADO, DIVORCIADO ou VIUVO, conforme a certidão e as averbações. regime_bens: o regime de bens como impresso, se for casamento; senão string vazia.",
    crlv: "O arquivo deveria ser o CRLV (Certificado de Registro e Licenciamento de Veículo, impresso ou CRLV-e digital, foto ou PDF) de um veículo dado como parte do pagamento de um imóvel. tipo_documento: CRLV, ou OUTRO se não for CRLV (CNH, nota fiscal, recibo de compra e venda/ATPV-e e boleto não são CRLV). marca e modelo: o CRLV imprime MARCA/MODELO/VERSÃO num campo só (ex.: FABRICANTE/MODELO 1.0); marca é o que vem antes da barra e modelo o resto, como impresso. ano_fabricacao e ano_modelo: só os 4 dígitos de cada um. cor: a cor predominante como impressa. placa: como impressa (padrão antigo ABC1234 ou Mercosul ABC1D23). renavam: o código RENAVAM só com números, com TODOS os dígitos impressos, inclusive zeros à esquerda. chassi: os 17 caracteres do chassi. proprietario_nome: o nome do proprietário. proprietario_doc: o CPF ou CNPJ do proprietário, só com números, com TODOS os dígitos, inclusive zeros à esquerda. observacoes: o texto do campo OBSERVAÇÕES DO VEÍCULO exatamente como impresso (ex.: SEM RESERVA DE DOMINIO, ou alienação fiduciária, restrição, gravame, nome do credor); vazio se o campo estiver em branco. Todos os campos são texto, nunca número.",
    classificar: "Diga que documento é este arquivo, de uma venda de imóvel. tipo_documento: IDENTIDADE (CNH, RG ou outra identidade de pessoa, frente ou verso), COMPROVANTE (conta de água, luz, telefone, internet ou outro comprovante de endereço), APROVACAO (aprovação de financiamento habitacional da Caixa), MATRICULA (certidão de matrícula de UM lote ou casa), CERTIDAO_MAE (certidão da matrícula-mãe de um condomínio ou loteamento, com várias unidades), ALVARA (alvará de construção), HABITESE (habite-se / certidão de conclusão de obra) ou OUTRO. nome: na IDENTIDADE o nome da pessoa; no COMPROVANTE o nome do titular; na APROVACAO o nome do proponente; nos outros, string vazia. cpf: o CPF dessa pessoa só com números, se aparecer; senão string vazia."
  };
  var REGRA = " Responda só com o que está escrito nos arquivos. Campo ilegível ou ausente: string vazia. Não invente nem complete.";

  function montarPedido(tipo, arquivos, chaveApi, modelo, contexto) {   /* modelo: só a OpenAI usa (mesma ordem de argumentos) */
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
    blocos.push({ type: "text", text: INSTRUCOES[tipo] + (contexto ? " " + String(contexto) : "") + REGRA });
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
