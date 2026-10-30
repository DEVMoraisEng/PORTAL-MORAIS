/* 30/10/2026 (pedido do dono): histórico do contrato — quem fez o quê e quando, na coluna HISTÓRICO DO CONTRATO
 * da linha da venda (VENDAS ou VENDAS CONDOMÍNIO). Regras e formato em LogContratoVenda.js.
 * Chamado pelo tratar_ (PortalVenda.gs) depois de toda ação que grava e deu certo. Falha aqui nunca derruba a
 * ação: só vai para o log do Apps Script. Base sem a coluna = nada é gravado (aviso no log). */
var LOG_CONTRATO_COL = "HISTÓRICO DO CONTRATO";

function logContratoColunaReal_(pg) {
  var k = RegrasVenda.chave(LOG_CONTRATO_COL);
  for (var n in pg.properties) if (RegrasVenda.chave(n) === k) return n;
  return null;
}
function logContratoQuando_() {
  return Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm");
}
function logContrato_(sess, p, r) {
  try {
    var nova = LogContratoVenda.linha(p.action, p, r, (sess && (sess.u || sess.n)) || "", logContratoQuando_());
    if (!nova) return;
    var pg = notion_("GET", "/pages/" + p.pageId, null), real = logContratoColunaReal_(pg);
    if (!real) { console.warn("PORTAL-VENDA log do contrato: base sem a coluna " + LOG_CONTRATO_COL); return; }
    var texto = LogContratoVenda.juntar(ctrTxt_(ctrValor_(pg.properties[real])), nova), props = {};
    props[real] = { rich_text: fluxoPedacos_(texto) };
    notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  } catch (e) { ctrErro_("log do contrato " + String(p.action || ""), e); }
}
/* para a tela: as linhas do histórico (a mais nova primeiro); null = base sem a coluna (a tela não mostra o bloco) */
function logContratoLer_(pg) {
  var real = pg && logContratoColunaReal_(pg);
  return real ? LogContratoVenda.ler(ctrTxt_(ctrValor_(pg.properties[real]))) : null;
}
