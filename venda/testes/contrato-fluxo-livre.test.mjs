/* 29/10 (etapa 2 do Alterar fluxo): o texto do contrato a partir da lista livre (FLUXO PERSONALIZADO).
   Das gavetas o texto continua idêntico — os testes antigos de contrato-condominio*.test.mjs cobrem. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../ContratoVenda.js");
const T = require("../ConfissaoVenda.js");

const fluxo = { assinatura: "2026-10-30", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 305000,
                balao2Data: "2028-11-10", credito: 240000, fgts: 5000 };
const livre = { valor: 305000, entrega: "2028-12-01", linhas: [
  { t: "sinal", v: 2000, n: 5, d: "2026-10-30", i: 1 },                      // sinal em 5x (10.000)
  { t: "entrada", v: 1000, n: 1, d: "2026-10-30", i: 1 },
  { t: "pre", v: 500, n: 12, d: "2026-12-10", i: 1, u: 520 },               // 11 × 500 + 520 = 6.020
  { t: "balao", v: 5000, n: 2, d: "2027-06-10", i: 6 },                     // jun/2027 e dez/2027
  { t: "balao", v: 3980, n: 1, d: "2028-11-10", i: 1 },                     // o da entrega das chaves
  { t: "pos", v: 700, n: 24, d: "2029-01-10", i: 1 },                       // 16.800
  { t: "permuta", v: 12200, n: 1, d: "2026-11-15", i: 1, x: "veículo marca/modelo/ano/placa" },
  { t: "fin", v: 240000, n: 1, d: "", i: 1 }, { t: "fgts", v: 5000, n: 1, d: "", i: 1 }] };
const co = { fluxo, livre, comissao: 13725, valorParaEntrada: 50000 };

test("grupos da lista: sinais expandidos (o 1º no ato), balões a cada 6 meses, o da entrega marcado; soma = valor da casa", () => {
  const G = C.gruposFluxo(co);
  assert.deepEqual(G.sinais.map((s) => [s.d, s.v, !!s.ato]), [["2026-10-30", 2000, true], ["2026-11-30", 2000, false], ["2026-12-30", 2000, false],
    ["2027-01-30", 2000, false], ["2027-02-28", 2000, false]]);
  assert.deepEqual(G.baloes.map((b) => [b.d, !!b.chaves]), [["2027-06-10", false], ["2027-12-10", false], ["2028-11-10", true]]);
  assert.equal(G.posN, 24);
  assert.equal(C.somaGrupos(G), 305000);
  assert.equal(C.excedenteSinal(co), 0, "no fluxo alterado o excedente é linha, não conta de novo");
});

test("6.1 do fluxo alterado: mesmos incisos; última parcela diferente; balões; inciso VI da permuta", () => {
  const t = C.formaPagamentoCondominio(fluxo, livre).split("\n");
  assert.equal(t[0], "6.1. Preço total: R$ 305.000,00 (trezentos e cinco mil reais), a ser pago da seguinte forma:");
  assert.ok(t.some((l) => l.startsWith("a) R$ 2.000,00 (dois mil reais), no ato da assinatura deste instrumento, em 30/10/2026")), t.join("\n"));
  assert.ok(t.includes("e) R$ 2.000,00 (dois mil reais), com vencimento em 28/02/2027."), t.join("\n"));
  assert.ok(t.some((l) => /^a\) 1ª etapa: 11 parcelas mensais e sucessivas de R\$ 500,00 .* e a última de R\$ 520,00 .*vencendo-se a primeira em 10\/12\/2026 e as demais no dia 10/.test(l)), t.join("\n"));
  assert.ok(t.includes("c) R$ 3.980,00 (três mil novecentos e oitenta reais), com vencimento em 10/11/2028, ou na data da entrega das chaves, o que ocorrer primeiro."), t.join("\n"));
  assert.ok(t.includes("VI — BEM DADO EM PAGAMENTO (permuta), sem correção monetária:"));
  assert.ok(t.includes("a) veículo marca/modelo/ano/placa, recebido pelo valor de R$ 12.200,00 (doze mil e duzentos reais), com entrega em 15/11/2026."), t.join("\n"));
  assert.equal(C.negritoDaLinha("VI — BEM DADO EM PAGAMENTO (permuta), sem correção monetária:"), 61);
});

test("quadro-resumo: sinal pela lista, entrada à vista e permuta antes das parcelas corrigidas; pós pela lista", () => {
  const G = C.gruposFluxo(co);
  const pre = C.textoPreChaves(G);
  assert.match(pre, /^pagamento único de R\$ 1\.000,00 .*, na assinatura deste contrato; bem dado em pagamento \(permuta\): veículo/);
  assert.match(pre, /11 parcelas mensais e sucessivas de R\$ 500,00 .* cada e a última de R\$ 520,00 .*, vencendo todo dia 10, a primeira em 10\/12\/2026/);
  assert.match(pre, /todas corrigidas pelo INCC-M/);
  assert.match(C.textoPosChaves(G), /^24 parcelas mensais e sucessivas de R\$ 700,00 .* corrigidas pelo IPCA/);
  const v = C.valoresCondominio(co);
  assert.deepEqual([v.sinal, v.financiamento, v.comissao, v.precoMudou], [10000, 245000, 14487.5, false]);
});

test("valor da casa mudado (JC/JV): comissão pela regra sobre o valor novo", () => {
  const caro = { ...co, livre: { ...livre, valor: 310000, linhas: livre.linhas.map((l) => (l.t === "permuta" ? { ...l, v: 17200 } : l)) },
                 fluxo: { ...fluxo, prazoEntrada: 48 } };
  const v = C.valoresCondominio(caro);
  assert.equal(v.precoMudou, true);
  assert.equal(v.comissao, 14725);   // 31/10: 12 pré + 24 pós = 36x, 4,75% de 310 mil
});

test("termo de confissão: pré sem a entrada à vista nem a permuta; totais pela lista", () => {
  const d = { condominio: co };
  const G = C.gruposFluxo(co);
  assert.equal(T.totalPre(G), 6020 + 13980);
  assert.equal(T.totalPos(G), 16800);
  assert.doesNotMatch(C.textoPreChaves(G, true), /pagamento único|permuta/);
  assert.deepEqual(T.quais(d), ["PRE", "POS"]);
});

test("30/10 (24x sem fiador): sem parcela depois das chaves o plano é SEM_POS; o Alterar fluxo que cria pós-chaves volta a COM_POS", () => {
  const sem = { ...co, livre: { ...livre, linhas: livre.linhas.map((l) => (l.t === "pos" ? { ...l, t: "pre", d: "2028-01-10", n: 1, v: 16800 } : l)) } };
  assert.equal(C.comPosChaves(co), true);
  assert.equal(C.comPosChaves(sem), false);
  const d = (c) => ({ vendedor: { tipo: "PJ" }, negociacao: { intermediariaValor: null }, comissao: {}, condominio: { ...c, fiadores: [{ nome: "FIADOR TESTE" }] } });
  assert.deepEqual([C.blocos(d(sem)).SEM_POS, C.blocos(d(sem)).COM_POS, C.blocos(d(sem)).TEM_FIADORES], [true, false, false]);
  assert.deepEqual([C.blocos(d(co)).SEM_POS, C.blocos(d(co)).COM_POS, C.blocos(d(co)).TEM_FIADORES], [false, true, true]);
  assert.deepEqual(T.quais({ condominio: sem }), []);
  assert.deepEqual(T.quais({ condominio: co }), ["PRE", "POS"]);
});

test("30/10 isenção da comissão (venda direta): comissão zero, imóvel = preço inteiro, blocos SEM_COMISSAO/COM_COMISSAO", () => {
  const isento = { ...co, livre: { ...livre, valor: 291275, semComissao: true } };  // só a comissão importa aqui
  const v = C.valoresCondominio(isento);
  assert.deepEqual([v.semComissao, v.comissao, v.imovel], [true, 0, 291275]);
  assert.equal(C.valoresCondominio(co).semComissao, false);
  const b = (c) => C.blocos({ vendedor: {}, negociacao: { intermediariaValor: null }, comissao: {}, condominio: { fiadores: [], ...c } });
  assert.deepEqual([b(isento).SEM_COMISSAO, b(isento).COM_COMISSAO], [true, false]);
  assert.deepEqual([b(co).SEM_COMISSAO, b(co).COM_COMISSAO], [false, true]);
});

/* 03/11/2026 (dono): a permuta com os dados do bem (FluxoLivre l.b) sai identificada no inciso VI, com as obrigações
   de praxe; o termo de confissão continua sem ela. Dados FALSOS (repositório público). */
const F = require("../FluxoLivre.js");
const carro = { tipo: "veiculo", marca: "Hyundai", modelo: "HB20", anoFab: 2019, anoModelo: 2020, cor: "prata", placa: "ABC1D23",
  renavam: "00000000000", chassi: "9BWZZZ377VT004251", km: 45000, propNome: "Fulano de Teste", propDoc: "52998224725",
  situacao: "alienado", credor: "Banco de Teste S.A.", saldo: 8000, obs: "bom estado, pneus novos" };
const comBem = (b) => F.normalizar({ ...livre, linhas: livre.linhas.map((l) => (l.t === "permuta" ? { ...l, b } : l)) });

test("03/11 permuta de veículo: inciso VI com a identificação inteira e as obrigações; quadro-resumo com o resumo", () => {
  const t = C.formaPagamentoCondominio(fluxo, comBem(carro)).split("\n");
  const i = t.indexOf("VI — BEM DADO EM PAGAMENTO (permuta), sem correção monetária:");
  assert.ok(i > 0, t.join("\n"));
  assert.equal(t[i + 1], "a) veículo marca Hyundai, modelo HB20, ano de fabricação 2019 e ano do modelo 2020, cor prata, placa ABC1D23, " +
    "RENAVAM 00000000000, chassi 9BWZZZ377VT004251, de propriedade de Fulano de Teste, CPF 529.982.247-25, " +
    "alienado fiduciariamente (financiado) a Banco de Teste S.A., com saldo devedor estimado de R$ 8.000,00 (oito mil reais), " +
    "responsável pela quitação: o COMPRADOR, antes da entrega, estado de conservação: bom estado, pneus novos, " +
    "recebido pelo valor de R$ 12.200,00 (doze mil e duzentos reais), com entrega em 15/11/2026.");
  assert.doesNotMatch(t.join("\n"), /km rodados/, "dono 03/11: sem quilometragem (o km do bem antigo é ignorado)");
  const ob = t[i + 2];
  for (const m of [/livre e desembaraçado de quaisquer ônus/, /multas/, /IPVA e licenciamento/, /até a data da efetiva entrega/, /evicção/,
    /vícios ocultos/, /ATPV-e\/CRV\) em favor da VENDEDORA ou de quem ela indicar/, /documentação e as chaves/,
    /alienação fiduciária.*quitação.*do COMPRADOR, antes da entrega/, /definitivo e não sofre correção monetária/])
    assert.match(ob, m);
  assert.equal(C.negritoDaLinha(ob), 0, "o parágrafo das obrigações não é título");
  const G = C.gruposFluxo({ ...co, livre: comBem(carro) });
  /* 04/11: o modelo do advogado não tem o 6.1 com incisos — a identificação inteira vai na alínea c) do quadro */
  assert.match(C.textoPreChaves(G), /bem dado em pagamento \(permuta\): veículo marca Hyundai, modelo HB20, .*placa ABC1D23, .*pelo valor de R\$ 12\.200,00 \(doze mil e duzentos reais\), com entrega em 15\/11\/2026, sem correção monetária;/);
  assert.doesNotMatch(C.textoPreChaves(G), /item 6\.1, VI/);
  assert.doesNotMatch(C.textoPreChaves(G, true), /permuta/, "termo de confissão sem a permuta");
});

test("03/11 permuta quitada, imóvel e outro: texto de cada tipo; fluxo antigo (só descrição) sai igual e sem o parágrafo novo", () => {
  const q = C.formaPagamentoCondominio(fluxo, comBem({ ...carro, situacao: "quitado", obs: "" })).split("\n");
  assert.ok(q.some((l) => /CPF 529\.982\.247-25, quitado e sem alienação, recebido pelo valor/.test(l)), q.join("\n"));
  const im = { tipo: "imovel", endereco: "Rua de Teste, 100, Bairro Teste, Cidade Teste", matricula: "12.345", cartorio: "1º CRI de Cidade Teste",
               propNome: "Fulano de Teste", propDoc: "11222333000181", onus: "" };
  const ti = C.formaPagamentoCondominio(fluxo, comBem(im)).split("\n");
  assert.ok(ti.includes("a) imóvel situado em Rua de Teste, 100, Bairro Teste, Cidade Teste, matrícula nº 12.345 do 1º CRI de Cidade Teste, " +
    "de propriedade de Fulano de Teste, CNPJ 11.222.333/0001-81, ônus: nenhum, recebido pelo valor de R$ 12.200,00 (doze mil e duzentos reais), com entrega em 15/11/2026."), ti.join("\n"));
  assert.ok(ti.some((l) => /escritura pública.*IPTU|IPTU.*escritura pública/.test(l)), ti.join("\n"));
  const to = C.formaPagamentoCondominio(fluxo, comBem({ tipo: "outro", descricao: "Trator agrícola de teste, ano 2015, em uso" })).split("\n");
  assert.ok(to.includes("a) Trator agrícola de teste, ano 2015, em uso, recebido pelo valor de R$ 12.200,00 (doze mil e duzentos reais), com entrega em 15/11/2026."), to.join("\n"));
  const velho = C.formaPagamentoCondominio(fluxo, livre).split("\n");
  assert.equal(velho.at(-1), "a) veículo marca/modelo/ano/placa, recebido pelo valor de R$ 12.200,00 (doze mil e duzentos reais), com entrega em 15/11/2026.");
});

test("04/11: quadro-resumo do modelo do advogado — permuta com dados do bem liga {{#COM_PERMUTA}} e traz as obrigações", () => {
  const b = (c) => C.blocos({ vendedor: {}, negociacao: { intermediariaValor: null }, comissao: {}, condominio: { fiadores: [], ...c } });
  assert.equal(b({ ...co, livre: comBem(carro) }).COM_PERMUTA, true);
  assert.equal(b(co).COM_PERMUTA, false, "permuta antiga, só com a descrição: sem o parágrafo novo");
  assert.equal(b({ ...co, livre: F.normalizar({ ...livre, linhas: livre.linhas.filter((l) => l.t !== "permuta") }) }).COM_PERMUTA, false);
  const ob = C.obrigacoesPermuta(C.gruposFluxo({ ...co, livre: comBem(carro) }).permutas);
  assert.match(ob, /^Quanto ao bem dado em pagamento, o COMPRADOR se obriga/);
});
