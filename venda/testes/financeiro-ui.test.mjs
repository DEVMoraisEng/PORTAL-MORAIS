/* aba Financeiro do cartão do condomínio (31/10/2026, etapa 4). Dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");

const P = (situacao, numero, extra) => Object.assign({ grupo: "Pré-chaves", numero, de: 24, vencimento: "2027-0" + Math.min(numero, 9) + "-15",
  valor: 1000, valorCorrigido: 1010, situacao, pagoEm: situacao === "paga" ? "2027-01-14" : "", diasAtraso: situacao === "atrasada" ? 12 : 0 }, extra);

test("financeiro: carregando, não lançada e sem leitura ainda", () => {
  assert.match(D.htmlFinanceiro(null, { carregando: true }), /lendo as parcelas/);
  assert.match(D.htmlFinanceiro({ lancada: false, parcelas: [] }, {}), /ainda não foi lançada no Mais Controle/);
  assert.match(D.htmlFinanceiro({ lancada: true, semLeitura: true, parcelas: [] }, {}), /leitura diária das parcelas ainda não chegou/);
});

test("financeiro: atraso em destaque, totais, filtros e situação de cada parcela", () => {
  const e = { lancada: true, lidoEm: "2027-04-27T05:30:00", parcelas: [P("paga", 1), P("atrasada", 2), P("aberta", 3)] };
  const h = D.htmlFinanceiro(e, {});
  assert.match(h, /class="cd-falta"><b>1 parcela em atraso<\/b>/);
  assert.match(h, /venceu em 15\/02\/2027 \(12 dias\)/);
  assert.match(h, /data-acao="f-filtro-atrasada"/);
  assert.match(h, /✓ paga<\/b> <span class="ass-data">em 14\/01\/2027/);
  assert.match(h, /lido do Mais Controle em 2027-04-27 05:30/);
  const so = D.htmlFinanceiro(e, { filtro: "paga" });
  assert.equal((so.match(/<tr><td data-rot="Parcela">/g) || []).length, 1);
});

test("financeiro: mais de 12 parcelas mostra 12 e o botão Mostrar todas; texto escapado", () => {
  const ps = Array.from({ length: 20 }, (_, i) => P("aberta", i + 1, i === 0 ? { grupo: "<b>x</b>" } : {}));
  const h = D.htmlFinanceiro({ lancada: true, parcelas: ps }, {});
  assert.equal((h.match(/<tr><td data-rot="Parcela">/g) || []).length, 12);
  assert.match(h, /data-acao="f-todas">Mostrar as 20 parcelas/);
  assert.match(h, /&lt;b&gt;x/);
  assert.equal((D.htmlFinanceiro({ lancada: true, parcelas: ps }, { todas: true }).match(/<tr><td data-rot="Parcela">/g) || []).length, 20);
});
