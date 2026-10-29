/* ---- 29/10/2026: "Alterar fluxo" da venda do condomínio (pedido do diretor; spec 16 em CONTRATOS DE VENDA/DOCUMENTACAO) ----
 * A linha da BANCO DE DADOS VENDAS CONDOMÍNIO ganha a coluna "FLUXO PERSONALIZADO" (texto): a lista livre de
 * pagamentos (FluxoLivre.serializar). Vazia = vale o fluxo do simulador (as gavetas de sempre, que nunca são apagadas).
 * Regras do dono: qualquer pessoa com acesso a Vendas altera; só salva com a soma batendo AO CENTAVO com o valor da casa;
 * motivo obrigatório (e um segundo motivo quando o valor da casa muda). Quem, quando, motivo e o fluxo de antes ficam no
 * histórico (Propriedade FLUXO_HIST_<página>).
 * Etapa 1 (este arquivo): tela, gravação e histórico. Etapa 2: o contrato lê a lista (ContratoVenda.gruposFluxo).
 * Até a etapa 3 o robô do Mais Controle para quando a venda tem fluxo alterado. */
var FLUXO_COL = "FLUXO PERSONALIZADO", FLUXO_HIST = "FLUXO_HIST_", FLUXO_HIST_MAX = 8500;
/* dono 29/10: mudar o VALOR DA CASA só Julio Cesar e João Vitor — os logins do portal ficam na Propriedade
   FLUXO_PRECO_USUARIOS (separados por vírgula). Vazia = ninguém muda o valor da casa. */
function fluxoPodePreco_(sess) {
  var u = String((sess && sess.u) || "").trim().toLowerCase();
  return !!u && String(prop_("FLUXO_PRECO_USUARIOS") || "").toLowerCase().split(/[\s,;]+/).indexOf(u) >= 0;
}

function fluxoColunaReal_(pg) {
  var k = RegrasVenda.chave(FLUXO_COL);
  for (var n in pg.properties) if (RegrasVenda.chave(n) === k) return n;
  return null;
}
function fluxoTextoDaLinha_(pg) {
  var real = fluxoColunaReal_(pg);
  return real ? ctrTxt_(ctrValor_(pg.properties[real])).trim() : "";
}
function fluxoHist_(pageId) {
  try { var h = JSON.parse(prop_(FLUXO_HIST + ctrIdLimpo_(pageId)) || "[]"); return Array.isArray(h) ? h : []; }
  catch (e) { return []; }
}
/* O que impede alterar agora: "" | código de erro. */
function fluxoTrava_(pg) {
  var v = ctrPorChave_(pg.properties);
  if (ctrTxt_(ctrCampo_(v, "MC - VENDA ID")).trim()) return "FLUXO_VENDA_LANCADA";
  var sit = ctrTxt_(ctrCampo_(v, "ASSINATURA - SITUAÇÃO")).trim().toUpperCase();
  if (sit === "ASSINADO") return "FLUXO_CONTRATO_ASSINADO";
  var env = ctrTxt_(ctrCampo_(v, "ASSINATURA - ENVELOPE ID")).trim();
  if (!ClicksignVenda.podeEnviar(env, sit)) return "FLUXO_ASSINATURA_ABERTA";   /* envelope aberto: cancele antes */
  return "";
}

/* Leve, vai no contratoEstado (sem GET a mais): a tela só precisa saber se mostra o botão e se já foi alterado. */
function fluxoEstado_(pageId, pg) {
  var real = fluxoColunaReal_(pg), hist = fluxoHist_(pageId), ult = hist.length ? hist[hist.length - 1] : {};
  return { coluna: !!real, alterado: !!FluxoLivre.ler(fluxoTextoDaLinha_(pg)), trava: fluxoTrava_(pg),
           por: ctrTxt_(ult.por), em: ctrTxt_(ult.em), alteracoes: hist.length };
}

/* Ação "fluxoEditar": abre o editor — o fluxo atual (personalizado ou o do simulador), o da proposta, a entrega
   e o histórico (sem os fluxos antigos inteiros). */
function fluxoEditar_(col, sess, p) {
  var info = {}, pg = ctrLerPaginaVenda_(p.pageId, info);
  if (info.base !== "CONDOMINIO") return { ok: false, erro: "SO_CONDOMINIO" };
  if (!fluxoColunaReal_(pg)) return { ok: false, erro: "COLUNA_FALTANDO", coluna: FLUXO_COL };
  var padrao = fluxoPadrao_(pg), pers = FluxoLivre.ler(fluxoTextoDaLinha_(pg));
  var atual = pers ? { valor: pers.valor, entrega: padrao.entrega, linhas: pers.linhas } : padrao;
  return { ok: true, atual: atual, padrao: padrao, alterado: !!pers, trava: fluxoTrava_(pg), podePreco: fluxoPodePreco_(sess),
           historico: fluxoHist_(p.pageId).map(function (h) {
             return { por: ctrTxt_(h.por), em: ctrTxt_(h.em), motivo: ctrTxt_(h.motivo), motivoPreco: ctrTxt_(h.motivoPreco),
                      valor: h.valor, voltou: !!h.voltou };
           }) };
}
/* O fluxo do simulador como lista (com o excedente do VALOR PARA ENTRADA, como o contrato faz). */
function fluxoPadrao_(pg) {
  var cond = ctrDadosCondominio_(ctrPorChave_(pg.properties)).condominio;
  cond.valorParaEntrada = ctrValorParaEntrada_(cond.idProposta);
  return FluxoLivre.doPadrao(cond.fluxo, ContratoVenda.excedenteSinal(cond));
}

/* Ação "salvarFluxo": p.fluxo = { valor, linhas } | p.voltar = true (volta ao fluxo do simulador); p.motivo;
   p.motivoPreco (obrigatório se o valor da casa mudou). */
function salvarFluxo_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  var motivo = String(p.motivo || "").replace(/\s+/g, " ").trim(), motivoPreco = String(p.motivoPreco || "").replace(/\s+/g, " ").trim();
  if (!motivo || motivo.length > FluxoLivre.MAX_MOTIVO) return { ok: false, erro: "CAMPOS_INVALIDOS", erros: ["Motivo da alteração (de 1 a " + FluxoLivre.MAX_MOTIVO + " caracteres)"] };
  if (motivoPreco.length > FluxoLivre.MAX_MOTIVO) return { ok: false, erro: "CAMPOS_INVALIDOS", erros: ["Motivo da mudança no valor da casa (até " + FluxoLivre.MAX_MOTIVO + " caracteres)"] };
  var info = {}, pg = ctrLerPaginaVenda_(p.pageId, info);
  if (info.base !== "CONDOMINIO") return { ok: false, erro: "SO_CONDOMINIO" };
  var real = fluxoColunaReal_(pg);
  if (!real) return { ok: false, erro: "COLUNA_FALTANDO", coluna: FLUXO_COL };
  var trava = fluxoTrava_(pg);
  if (trava) return { ok: false, erro: trava };
  var padrao = fluxoPadrao_(pg), antes = FluxoLivre.ler(fluxoTextoDaLinha_(pg));
  var texto = "", valor = padrao.valor;
  if (!p.voltar) {
    var f = FluxoLivre.normalizar(p.fluxo);
    f.entrega = padrao.entrega;                       /* a entrega das chaves é a da linha, não a da tela */
    var r = FluxoLivre.validar(f, padrao);
    if (!r.ok) return { ok: false, erro: "CAMPOS_INVALIDOS", erros: r.erros.slice(0, 6) };
    var mudouPreco = Math.round(f.valor * 100) !== Math.round(padrao.valor * 100);
    if (mudouPreco && !fluxoPodePreco_(sess)) return { ok: false, erro: "FLUXO_PRECO_SEM_PERMISSAO" };
    if (mudouPreco && !motivoPreco)
      return { ok: false, erro: "CAMPOS_INVALIDOS", erros: ["Motivo da mudança no valor da casa (" + FluxoLivre.moeda(padrao.valor) + " → " + FluxoLivre.moeda(f.valor) + ")"] };
    texto = FluxoLivre.serializar(f);
    valor = f.valor;
  } else if (!antes) {
    return { ok: false, erro: "FLUXO_JA_E_O_DA_PROPOSTA" };
  }
  var props = {};
  props[real] = { rich_text: fluxoPedacos_(texto) };
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  /* histórico: o fluxo de ANTES (vazio = o do simulador); passou do tamanho, some o mais antigo depois do 1º */
  var hist = fluxoHist_(p.pageId), item = { por: ctrTxt_(sess && sess.u), em: new Date().toISOString(), motivo: motivo, valor: valor,
                                             antes: antes ? FluxoLivre.serializar(antes) : "" };
  if (motivoPreco && !p.voltar) item.motivoPreco = motivoPreco;
  if (p.voltar) item.voltou = true;
  hist.push(item);
  while (hist.length > 2 && JSON.stringify(hist).length > FLUXO_HIST_MAX) hist.splice(1, 1);
  PropertiesService.getScriptProperties().setProperty(FLUXO_HIST + ctrIdLimpo_(p.pageId), JSON.stringify(hist));
  ctrLog_("salvarFluxo " + pid + " por " + (item.por || "?") + (p.voltar ? ": voltou ao fluxo da proposta" : ": " + FluxoLivre.ler(texto).linhas.length + " linhas"));
  return { ok: true, fluxo: fluxoEstado_(p.pageId, { properties: Object.assign({}, pg.properties, (function () {
    var o = {}; o[real] = { type: "rich_text", rich_text: props[real].rich_text.map(function (t) { return { plain_text: t.text.content }; }) }; return o; })()) }) };
}
/* rich_text do Notion: até 2000 caracteres por pedaço */
function fluxoPedacos_(s) {
  var out = [];
  for (var i = 0; i < s.length; i += 1900) out.push({ type: "text", text: { content: s.slice(i, i + 1900) } });
  return out;
}
