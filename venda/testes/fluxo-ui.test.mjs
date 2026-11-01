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
  /* 31/10/2026 (dono): uma linha só, dizendo qual fluxo vale e onde vê-lo; título sem a nota de exceção */
  assert.match(h, /Fluxo em uso: o da proposta \(simulador\)\./);
  assert.doesNotMatch(h, /exceção desta venda/);
  assert.match(botao(h, "c-fluxo-ver"), />Ver fluxo/);
  assert.doesNotMatch(botao(h, "c-fluxo-abrir"), /disabled/);
  assert.doesNotMatch(h, /dz-aviso/);
});

test("venda lançada: o botão Alterar fluxo some e a linha diz que já foi lançado; envelope aberto ou assinado: desabilitado com o motivo", () => {
  const l = D.htmlContrato(estado({ ...fechado, trava: "FLUXO_VENDA_LANCADA" }), {});
  assert.match(l, /Já lançado no Mais Controle com este fluxo; não muda mais por aqui\./);
  assert.equal(botao(l, "c-fluxo-abrir"), "");
  assert.match(botao(l, "c-fluxo-ver"), />Ver fluxo/);
  for (const [trava, txt] of [["FLUXO_ASSINATURA_ABERTA", /cancele o envelope/], ["FLUXO_CONTRATO_ASSINADO", /aditivo/]]) {
    const h = D.htmlContrato(estado({ ...fechado, trava }), {});
    assert.match(h, txt);
    assert.match(botao(h, "c-fluxo-abrir"), /disabled/);
  }
});

test("alterado: diz quem alterou; o aviso laranja só quando o fluxo mudou DEPOIS do último contrato gerado", () => {
  const alt = { ...fechado, alterado: true, por: "ana.teste", em: "2026-10-29T15:00:00Z", alteracoes: 1 };
  const h = D.htmlContrato(estado(alt), {});
  assert.match(h, /Fluxo em uso: alterado no portal por ana\.teste em /);
  assert.doesNotMatch(h, /gere o contrato de novo/, "sem contrato ainda, sem aviso");
  const depois = D.htmlContrato({ ...estado(alt), gerado: true, pre: { nome: "P.pdf", url: "u", em: "2026-10-29T14:00:00Z", conferido: true, desatualizado: false } }, {});
  assert.match(depois, /<div class="dz-aviso">Fluxo alterado depois do contrato: gere o contrato de novo\.<\/div>/);
  const regerado = D.htmlContrato({ ...estado(alt), gerado: true, pre: { nome: "P.pdf", url: "u", em: "2026-10-29T16:00:00Z", conferido: true, desatualizado: false } }, {});
  assert.doesNotMatch(regerado, /gere o contrato de novo/);
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

test("editor: valor da casa mudou mostra o campo do segundo motivo e pede ele (quem pode mudar o preço)", () => {
  const ed = editor({ valor: 95000, motivo: "desconto", podePreco: true });
  ed.linhas[1].v = 750;                                       // 20 × 750 = 15.000: fecha com 95.000
  assert.match(D.htmlFluxo(fechado, { fluxoEd: ed }, ""), /class="dz-linha vb-fx-mp" style="display:block"/);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: editor() }, ""), /class="dz-linha vb-fx-mp" style="display:none"/, "sem mudar o preço o campo fica escondido");
  assert.match(D.htmlFluxoVivo(ed, ""), /motivo da mudança no valor da casa/);
  assert.doesNotMatch(botao(D.htmlFluxoVivo({ ...ed, motivoPreco: "aprovado" }, ""), "c-fluxo-salvar"), /disabled/);
});

test("financiamento e FGTS só aparecem (sem campos nem botões); o tipo não oferece eles para linha nova", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: editor() }, "");
  const linhaFin = h.match(/<tr data-fx-linha="2">.*?<\/tr>/s)[0];
  assert.match(linhaFin, /Financiamento.*fixo — vem da proposta/s);
  assert.doesNotMatch(linhaFin, /não muda/);
  assert.doesNotMatch(linhaFin, /<input|<select|data-acao/);
  assert.doesNotMatch(h, /<option value="fin">/);
});

test("valor da casa travado para quem não está na lista do servidor: mensagem visível com os nomes e title no campo", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: editor({ quemMudaPreco: ["Ana Teste", "Bruno Teste"] }) }, "");
  assert.match(h, /data-fx="valor"[^>]*disabled[^>]*title="Só Ana Teste e Bruno Teste mudam o valor da casa"/);
  assert.match(h, /<div class="dz-msg[^"]*">Só Ana Teste e Bruno Teste mudam o valor da casa\.<\/div>/);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: editor({ quemMudaPreco: ["Ana Teste"] }) }, ""), /Só Ana Teste muda o valor da casa\./);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: editor({ quemMudaPreco: [] }) }, ""), /ninguém muda o valor da casa por aqui/i);
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: editor({ podePreco: true, quemMudaPreco: ["Ana Teste"] }) }, ""), /mudam? o valor da casa/);
  assert.doesNotMatch(require("fs").readFileSync(new URL("../../venda-dossie.js", import.meta.url), "utf8"), /Julio Cesar|João Vitor/);
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: editor({ podePreco: true }) }, "").match(/<input[^>]*data-fx="valor"[^>]*>/)[0], /disabled/);
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

/* ---- 30/10: ícone ↻ e desconto (arquivo 17, itens 1 e 2) ---- */
test("↻ fica na coluna entre Tipo e Valor de cada, por linha; o botão Redistribuir saiu da última coluna", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: editor() }, "");
  assert.match(h, /<th>Tipo<\/th><th>↻<\/th><th>Valor de cada \(R\$\)<\/th>/);
  const linhaPre = h.match(/<tr data-fx-linha="1">.*?<\/tr>/s)[0];
  assert.match(linhaPre, /<\/select>.*?<\/td><td><button[^>]*data-acao="c-fluxo-red"[^>]*>↻<\/button><\/td><td><input[^>]*data-fx="v"/s);
  assert.doesNotMatch(h, />Redistribuir<\/button>/);
  const linhaFin = h.match(/<tr data-fx-linha="2">.*?<\/tr>/s)[0];
  assert.equal((linhaFin.match(/<td/g) || []).length, (linhaPre.match(/<td/g) || []).length, "linha fixa com o mesmo nº de colunas");
});

const dsc = (o = {}) => ({ comissao: { valor: 5000, pct: 0.05 }, isencaoLiberada: false, ...o });
test("desconto: só aparece para quem muda o valor da casa; R$, % ou isentar; três origens", () => {
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: editor() }, ""), /Aplicar desconto/);
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: editor({ desconto: dsc() }) }, ""), /Aplicar desconto/, "sem podePreco nada");
  const h = D.htmlFluxo(fechado, { fluxoEd: editor({ podePreco: true, desconto: dsc() }) }, "");
  assert.match(h, /Aplicar desconto/);
  assert.match(h, /<option value="rs" selected>em R\$<\/option><option value="pct">em %<\/option><option value="isentar">isentar a comissão \(aguardando o contrato\)<\/option>/);
  assert.match(h, /proporcional na entrada.*dos balões primeiro \(do último para o primeiro\), depois as pré-chaves.*das parcelas pré-chaves/s);
  assert.match(h, /Sinal, financiamento e FGTS não mudam/);
});

test("isentar sem o contrato pronto: mensagem clara na barra; liberada mostra a comissão que vira desconto", () => {
  const trav = D.htmlFluxoDesconto(editor({ podePreco: true, desconto: dsc(), dsc: { modo: "isentar" } }), "");
  assert.match(trav, /ainda não está liberado: o contrato do advogado não tem o texto/);
  assert.doesNotMatch(trav, /data-fx="dvalor"/);
  const lib = D.htmlFluxoDesconto(editor({ podePreco: true, desconto: dsc({ isencaoLiberada: true }), dsc: { modo: "isentar" } }), "");
  assert.doesNotMatch(lib, /ainda não está liberado/);
  assert.match(lib, /desconto = a comissão de hoje \(R\$ 5\.000,00\); venda direta/);
});

test("placar: com desconto mostra a comissão pela regra sobre o valor novo; isento diz sem comissão", () => {
  const ed = editor({ podePreco: true, desconto: dsc(), valor: 95000, motivo: "x", motivoPreco: "y" });
  ed.linhas[1].v = 750;
  assert.match(D.htmlFluxoVivo(ed, ""), /Comissão pela regra: <b>R\$ 4\.750,00/);
  assert.match(D.htmlFluxoVivo({ ...ed, semComissao: true }, ""), /sem comissão \(venda direta\)/);
});

test("31/10: prazo da entrada no topo do editor — 24x, 36x e 48x, o atual marcado", () => {
  const h = D.htmlContrato(estado(fechado), { fluxoEd: editor() });
  for (const p of [24, 36, 48]) assert.match(h, new RegExp('data-acao="c-fluxo-prazo"[^>]*data-p="' + p + '"'));
  assert.match(h, /data-p="24"[^>]*aria-pressed="true"/, "sem pós-chaves = 24x");
  assert.match(h, /refaz pré-chaves, balões e pós-chaves pela conta do simulador/);
});

test("31/10: placar com diferença oferece Distribuir; fechado não oferece", () => {
  const ed = editor();
  ed.linhas[0].v = 9000;                                   // sinal menor: faltam R$ 1.000
  const h = D.htmlFluxoVivo(ed, "");
  assert.match(h, /Faltam: <b>R\$ 1\.000,00/);
  assert.match(botao(h, "c-fluxo-dist"), /Distribuir/);
  assert.equal(botao(D.htmlFluxoVivo(editor(), ""), "c-fluxo-dist"), "");
});

test("31/10: prazo diferente da proposta mostra o prazo novo e a comissão pela regra", () => {
  const ed = editor();
  ed.linhas.splice(2, 0, { t: "pos", v: 0, n: 12, d: "2029-01-10", i: 1, x: "" });
  const h = D.htmlFluxoVivo(ed, "");
  assert.match(h, /Prazo: <b>36x<\/b> \(proposta 24x\) · comissão pela regra: <b>4,75% = R\$ 4\.750,00<\/b>/);
});
