/* 29/10: bloco "Fluxo de pagamento" (Alterar fluxo) no dossiê — só o desenho; as regras têm teste em fluxo-livre.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");
const F = require("../FluxoLivre.js");

const estado = (fluxo) => ({ gerado: false, etapa: "NENHUM", pre: null, fluxo });
const fechado = { coluna: true, alterado: false, trava: "", por: "", em: "", alteracoes: 0 };
const linhas = [{ t: "sinal", v: 10000, n: 1, d: "2026-10-30", i: 1, x: "" }, { t: "pre", v: 1000, n: 20, d: "2026-12-10", i: 1, x: "" },
                { t: "fin", v: 70000, n: 1, d: "", i: 1, x: "" }];
const editor = (o = {}) => ({ valor: 100000, valorOriginal: 100000, entrega: "2028-12-01", linhas: linhas.map((l) => ({ ...l })),
                               padrao: { valor: 100000, linhas }, historico: [], alterado: false, motivo: "", motivoPreco: "", ...o });
const botao = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>[^<]*')) || [""])[0];

test("fechado: mostra o fluxo da proposta e o botão Alterar fluxo", () => {
  const h = D.htmlContrato(estado(fechado), {});
  assert.match(h, /Fluxo de pagamento/);
  assert.match(h, /Fluxo da proposta \(simulador\)/);
  assert.doesNotMatch(botao(h, "c-fluxo-abrir"), /disabled/);
});

test("venda lançada, envelope aberto ou assinado: botão desabilitado com o motivo", () => {
  for (const [trava, txt] of [["FLUXO_VENDA_LANCADA", /lançada no Mais Controle/], ["FLUXO_ASSINATURA_ABERTA", /cancele o envelope/],
                              ["FLUXO_CONTRATO_ASSINADO", /aditivo/]]) {
    const h = D.htmlContrato(estado({ ...fechado, trava }), {});
    assert.match(h, txt);
    assert.match(botao(h, "c-fluxo-abrir"), /disabled/);
  }
});

test("alterado: diz quem alterou e avisa que o contrato com fluxo alterado chega na próxima versão", () => {
  const h = D.htmlContrato(estado({ ...fechado, alterado: true, por: "ana.teste", em: "2026-10-29T15:00:00Z", alteracoes: 1 }), {});
  assert.match(h, /alterado no portal.*ana\.teste/);
  assert.match(h, /Voltar ao fluxo da proposta/);
});

test("sem a coluna no Notion: aviso e nada de botão", () => {
  const h = D.htmlContrato(estado({ ...fechado, coluna: false }), {});
  assert.match(h, /Falta a coluna FLUXO PERSONALIZADO/);
  assert.equal(botao(h, "c-fluxo-abrir"), "");
});

test("editor: tabela com os tipos; conta fechando mas sem motivo, Salvar fica desabilitado", () => {
  const h = D.htmlContrato(estado(fechado), { fluxoEd: editor() });
  assert.equal((h.match(/data-fx-linha=/g) || []).length, 3);
  assert.match(h, /<option value="permuta">Permuta<\/option>/);
  assert.match(h, /reajuste INCC-M/);
  assert.match(h, /Diferença: <b>R\$ 0,00 ✓/);
  assert.match(h, /Falta o motivo/);
  assert.match(botao(h, "c-fluxo-salvar"), /disabled/);
});

test("editor: conta sem fechar mostra Sobram no placar e no botão; com motivo e conta fechada libera", () => {
  const ed = editor({ motivo: "mais um balão" });
  ed.linhas.push({ t: "balao", v: 5000, n: 1, d: "2027-06-10", i: 1, x: "" });
  const h = D.htmlFluxoVivo(ed, "");
  assert.match(h, /Sobram: <b>R\$ 5\.000,00/);
  assert.match(botao(h, "c-fluxo-salvar"), /disabled[^>]*>Sobram R\$ 5\.000,00/);
  ed.linhas = F.redistribuir({ valor: ed.valor, linhas: ed.linhas }, 1).linhas;
  const ok = D.htmlFluxoVivo(ed, "");
  assert.doesNotMatch(botao(ok, "c-fluxo-salvar"), /disabled/);
  assert.match(botao(ok, "c-fluxo-salvar"), /Salvar fluxo/);
});

test("editor: valor da casa mudou mostra o campo do segundo motivo e pede ele", () => {
  const ed = editor({ valor: 95000, motivo: "desconto" });
  ed.linhas[2].v = 65000;
  assert.match(D.htmlFluxo(fechado, { fluxoEd: ed }, ""), /class="dz-linha vb-fx-mp">/);
  assert.match(D.htmlFluxoVivo(ed, ""), /motivo da mudança no valor da casa/);
  assert.doesNotMatch(botao(D.htmlFluxoVivo({ ...ed, motivoPreco: "aprovado" }, ""), "c-fluxo-salvar"), /disabled/);
});

test("lerNumBR entende 1.234,56 e 1234.56", () => {
  assert.equal(D.lerNumBR("1.234,56"), 1234.56);
  assert.equal(D.lerNumBR("R$ 10.000"), 10000);
  assert.equal(D.lerNumBR("26.66"), 26.66);
  assert.equal(D.lerNumBR(""), 0);
});

test("texto digitado é escapado (descrição da permuta)", () => {
  const ed = editor();
  ed.linhas.push({ t: "permuta", v: 1, n: 1, d: "2026-11-01", i: 1, x: '"><script>x</script>' });
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: ed }, ""), /<script>/);
});
