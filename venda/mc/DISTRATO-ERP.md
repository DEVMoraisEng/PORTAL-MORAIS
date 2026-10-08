# Distrato no Mais Controle — rotas do ERP

Lido em 07/10/2026 no código do site do ERP (bundle `main.js` baixado em 06/10, só leitura) e no exemplo
de venda já baixado na fase 0 (só a FORMA dos campos, nenhum dado copiado). Nada foi chamado no ERP para
escrever este arquivo. Base de tudo: `https://legacy-api.maiscontroleerp.com.br/maiscontrole/services`
(a `MAIN_API_URL` do site; o `erp.py` chama de `LEGACY`).

[CERTO] = visto no código do site ou já usado pelo robô/app. [SUPOSIÇÃO] = conclusão sem prova ao vivo.

## 1. Ler a venda

`GET /sales/{id}` — **[CERTO]**: o robô já usa (`erp.py`, anexo do contrato) e a tela de edição da venda
reajustável carrega por `SaleService.get(id)` (estado `base.editReadjustmentSale`). `GET /readjustment-sales/{id}`
dá 405.

Campos usados (vistos no exemplo): `id`, `description`, `readjustmentEnabled`, `work` (`id`, `name`,
`defaultWhoPays`), `customer.id`, `tradeReceivable` (`grossValue`, `value`, `taxWithhold`,
`numberOfInstallments`, `installments`).

## 2. Quais parcelas foram recebidas

Pelos campos de cada parcela em `tradeReceivable.installments` — **[CERTO]** (vistos no exemplo):
`received` (bool), `receipts` (lista; cada um com `value`, `interestValue`, `discountValue`),
`sumOfReceivedValues`, `pendingValue`.

O robô usa a MESMA regra do site: o botão "Remover" da venda recusa quando `hasAnyReceipt()` — alguma
parcela com recebimento de `value`, `interestValue` ou `discountValue` maior que zero ("Existem parcelas com
recebimentos. Para remover esta venda você precisa estornar todos os recebimentos.") — **[CERTO]**.

- recebida = `hasAnyReceipt` OU `received` OU `sumOfReceivedValues > 0`;
- recebida EM PARTE = tem recebimento, `received=false` e `pendingValue > 0` → o robô RECUSA (não decide
  o que fica dela) — **[SUPOSIÇÃO]** sobre o significado de `pendingValue` (nome e exemplo batem).

`GET /receipt-installments` (lista paginada por data, `dateField=REFERENCE_DATE`, usada no lançamento)
também traz `received`, `receipts`, `sumOfReceivedValues` e `saleId` por parcela — **[CERTO]** (arquivo de
exemplo `rec_pagos.json`). O distrato não precisa dela: a venda inteira já vem no item 1.
Não achei filtro `type=PAID` nessa rota no código do site (o "PAID" do bundle é de relatório de contas a
pagar) — **[SUPOSIÇÃO]**: não usar.

## 3. Alterar a venda (deixar só as parcelas recebidas)

`PUT /readjustment-sales/{id}` com o OBJETO INTEIRO da venda — **[CERTO]**: `ReadjustmentSaleService.update =
Restangular.one("readjustment-sales", e.id).customPUT(e)`, e o `save()` da tela manda `e.sale` inteiro
(o mesmo que veio do `GET /sales/{id}`, com `interestRateAccumulateStrategy` preenchido).

Remover parcela na tela = tirar do array: `removeInstallment(i) → tradeReceivable.installments.splice(i, 1)`
e salvar — **[CERTO]** (código da tela). Então o robô manda o objeto com `installments` só das recebidas.

Ajustes que o robô faz junto — **[SUPOSIÇÃO]** (a tela pinta o total de vermelho quando a soma das
parcelas não bate com o valor; não sei se o servidor recalcula sozinho):
- `tradeReceivable.numberOfInstallments` = quantidade mantida;
- `tradeReceivable.grossValue` = soma do `plannedValue` mantido; `value` = isso − `taxWithhold`;
- `description` ganha `" (Distrato)"` (uma vez só).

Conferência: o robô RELÊ a venda e falha alto se as parcelas ou a descrição não ficaram como a prévia.

## 4. Excluir a venda

`DELETE /sales/{id}` — **[CERTO quanto à rota do site, SUPOSIÇÃO quanto ao verbo HTTP exato]**: na lista
e na tela da venda, quando `readjustmentEnabled` é verdadeiro o site chama `SaleService.remove(id)`, que é
`CrudEntityService(..., "sales", serviceUrl)` (um `$resource` do Angular: `remove` = `DELETE {url}/sales/{id}`).
A definição do `CrudEntityService` não está no bundle baixado (vem de outro script), daí a ressalva.
Uma resposta 200 com `exception` é tratada pelo site como falha — o robô também.

Venda NÃO reajustável usa outra rota (`DELETE https://prod-erp-api.maiscontroleerp.com.br/financial/sales/{id}`,
`removeErp`) — o robô RECUSA essas (só mexe na venda reajustável, que é a que ele cria).

Conferência: depois do DELETE o robô tenta `GET /sales/{id}`; se ainda abrir, falha alto.

Não existe rota de "distrato" no ERP (procurei `distrat`, `DISTRACT`, `cancel-sale`: nada).

## 5. Conta a pagar da devolução (sinal DEVOLVIDO)

`POST /trade-payables?userApprovesSaleCreation=true` — **[CERTO]**: é o `TradePayableService.insert` do
site (`customPOST(t.tradePayable, "", t.requestParams)`) e é a rota que o app já usa em produção para
lançar conta a pagar (guias e aportes). Releitura: `GET /trade-payables/{id}` — **[CERTO]** (mesmo uso).

Corpo: o mesmo formato das guias do app (conta A PAGAR, `markedAsPaid: false`), com:
- `participant` = o cliente da venda (`customer.id`) — **[SUPOSIÇÃO]** que o ERP aceita um cadastro de
  CLIENTE como favorecido de conta a pagar (o site tem "lançamento de Cliente com Reembolso" ligado à
  venda, o que sugere que sim; se recusar, a prévia/resultado diz e o resto do distrato segue);
- `costCentreType: "WORK"` + `costCentreDetails` = a obra da venda, 100% — [CERTO] (formato das guias);
- `account` = conta padrão da obra (`GET /works/{id}` → `defaultAccount`, como no lançamento) — [CERTO];
- `paymentCondition` = a de `type` `IN_CASH` em `GET /payment-conditions/all` — [CERTO] (app);
- `category` = variável `NATUREZA_DEVOLUCAO_ID` (o dono informa). Sem ela a prévia AVISA e a conta a
  pagar NÃO é lançada (o resto do distrato segue);
- `paymentMethod` = variável opcional `FORMA_PAGAMENTO_DEVOLUCAO_ID`; sem ela o campo não vai —
  **[SUPOSIÇÃO]** que o ERP aceita sem forma de pagamento;
- `whoPays` = `work.defaultWhoPays` ou `"CLIENT"` (o valor das guias) — [SUPOSIÇÃO] para a devolução;
- valor = o informado na tela (padrão: total recebido; nunca acima dele); vencimento = data da tela
  (padrão: hoje + 30); descrição `DEVOLUÇÃO DE SINAL (Distrato) - <descrição da venda>`.

Falha na conta a pagar NUNCA desfaz a venda já alterada: o texto do resultado diz "NÃO lançada — lance à mão".

## Travas do robô (venda/mc/distrato.py)

- sem `MC - VENDA ID` → recusa; venda não reajustável → recusa; parcela recebida em parte → recusa;
- tela diz "não recebido" mas o ERP tem recebimento → recusa (nunca exclui venda com recebimento);
- tela diz "recebido" mas o ERP não tem → recusa (dar baixa antes);
- aplicar só a partir de página da base `DB_DISTRATOS`, com as respostas iguais às do arquivo e a
  assinatura `[#xxxxxxxx]` da prévia aceita igual à recalculada na hora (a venda mudou → recusa);
- gravar exige `aplicar` no pedido E `MC_VENDA_APLICAR=1` no repositório (no fork de teste: BLOQUEADO);
- já aplicado → não regrava.
