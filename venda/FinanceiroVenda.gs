/* FinanceiroVenda.gs — aba Financeiro do cartão do condomínio (31/10/2026, dono — etapa 4 da repaginação).
 * financeiroEstado: só leitura. Diz se a venda já foi lançada no Mais Controle e devolve as parcelas do último
 * retrato da venda lido do ERP. O retrato é o mesmo da antecipação (sessão "Adiantamento de parcelas e balões",
 * venda/Antecipacao.js + robô do servidor), relido todo dia de madrugada — enquanto ele não existir para a venda,
 * a resposta vem com semLeitura e a tela diz isso (nunca inventa parcela).
 * Resposta: { ok, lancada, vendaId, lidoEm, semLeitura, parcelas: [{ grupo, numero, de, vencimento, valor,
 *             valorCorrigido, situacao ("paga" | "aberta" | "atrasada"), pagoEm, diasAtraso }] } */
function financeiroEstado_(col, p) {
  var c = mcLerColunas_(p.pageId);
  if (!c.vendaId) return { ok: true, lancada: false, parcelas: [] };
  var retrato = typeof antecipacaoRetrato_ === "function" ? antecipacaoRetrato_(p.pageId) : null;   /* da antecipação, quando existir */
  if (!retrato || !retrato.parcelas) return { ok: true, lancada: true, vendaId: c.vendaId, semLeitura: true, parcelas: [] };
  return { ok: true, lancada: true, vendaId: c.vendaId, lidoEm: retrato.lidoEm || "", parcelas: retrato.parcelas };
}
