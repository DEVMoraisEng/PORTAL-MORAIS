/* 29/10: bloco "Fluxo de pagamento" (Alterar fluxo) no dossiê — só o desenho; as regras têm teste em fluxo-livre.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.HOJE_VENDA_TESTE_ = "2026-01-01";   /* 07/11: "hoje" da tela fixo, antes das datas inventadas (trava de vencimento no passado) */
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

test("FGTS só aparece (sem campos nem botões); financiamento só o valor, até a carta (05/11); o tipo não oferece eles para linha nova", () => {
  const ed = editor(); ed.linhas.push({ t: "fgts", v: 1, n: 1, d: "", i: 1, x: "" }); ed.padrao = { ...ed.padrao, linhas: [...ed.padrao.linhas, ed.linhas[3]] };
  const h = D.htmlFluxo(fechado, { fluxoEd: ed }, "");
  const linhaFgts = h.match(/<tr data-fx-linha="3">.*?<\/tr>/s)[0];
  assert.match(linhaFgts, /FGTS.*fixo — vem da proposta/s);
  assert.doesNotMatch(linhaFgts, /não muda/);
  assert.doesNotMatch(linhaFgts, /<input|<select|data-acao/);
  const linhaFin = h.match(/<tr data-fx-linha="2">.*?<\/tr>/s)[0];
  assert.match(linhaFin, /Financiamento.*até R\$ 70\.000,00 \(carta de aprovação\)/s);
  assert.equal((linhaFin.match(/<input/g) || []).length, 1);
  assert.doesNotMatch(linhaFin, /<select|data-acao/);
  assert.doesNotMatch(h, /<option value="fin">/);
});

test("valor da casa travado para quem não está na lista do servidor: mensagem visível com os nomes e title no campo", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: editor({ quemMudaPreco: ["Ana Teste", "Bruno Teste"] }) }, "");
  assert.match(h, /data-fx="valor"[^>]*disabled[^>]*title="Só Ana Teste e Bruno Teste mudam o valor da casa"/);
  assert.match(h, /<div class="dz-msg[^"]*">Só Ana Teste e Bruno Teste mudam o valor da casa\.<\/div>/);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: editor({ quemMudaPreco: ["Ana Teste"] }) }, ""), /Só Ana Teste muda o valor da casa\./);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: editor({ quemMudaPreco: [] }) }, ""), /ninguém muda o valor da casa por aqui/i);
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: editor({ podePreco: true, quemMudaPreco: ["Ana Teste"] }) }, ""), /mudam? o valor da casa/);
  /* a mensagem de erro de permissão também não escreve nome nenhum: os nomes vêm só do servidor */
  assert.doesNotMatch(D.mensagemContrato({ erro: "FLUXO_PRECO_SEM_PERMISSAO" }), /[A-Z][a-z]+ [A-Z][a-z]+/);
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

/* ---- 03/11/2026 (dono): permuta pede os dados do bem na hora de salvar. Dados FALSOS (repositório público). ---- */
const carroUI = { tipo: "veiculo", marca: "Hyundai", modelo: "HB20", anoFab: 2019, anoModelo: 2020, cor: "prata", placa: "ABC1D23",
  renavam: "00000000000", chassi: "9BWZZZ377VT004251", km: 45000, propNome: "Fulano de Teste", propDoc: "52998224725", situacao: "quitado" };
/* a linha de pré-chaves (20 × 1.000) vira 19 × 1.000 + permuta de 1.000: a conta continua fechando */
const comPermutaUI = (b, o = {}) => {
  const ed = editor({ motivo: "cliente dá o carro", ...o });
  ed.linhas[1] = { ...ed.linhas[1], n: 19 };
  ed.linhas.push({ t: "permuta", v: 1000, n: 1, d: "2026-11-20", i: 1, x: "carro do cliente", ...(b ? { b } : {}) });
  return ed;
};

test("permuta sem os dados do bem NÃO trava o botão Salvar: a tela avisa que vai pedir os dados ao salvar", () => {
  const ed = comPermutaUI(null);
  const h = D.htmlFluxoVivo(ed, "");
  assert.doesNotMatch(botao(h, "c-fluxo-salvar"), /disabled/);
  assert.match(h, /Ao salvar, o portal pede os dados do bem da permuta/);
  assert.doesNotMatch(h, /<li>Linha 4: faltam os dados do bem/, "não vira erro vermelho");
  assert.equal(D.permutaSemBem(ed), 3);
  assert.equal(D.permutaSemBem(comPermutaUI(carroUI)), -1);
  assert.equal(D.permutaSemBem(editor()), -1, "sem permuta");
});

test("formulário do bem: abre no próprio cartão, campos do veículo, cabe no celular; Confirmar e Cancelar", () => {
  const ed = comPermutaUI(null, { bemK: 3 });
  const h = D.htmlFluxo(fechado, { fluxoEd: ed }, "");
  const painel = (h.match(/<div class="vb-fx-bem".*?<!--\/vb-fx-bem-->/s) || [""])[0];
  assert.ok(painel, "painel do bem");
  assert.match(painel, /Dados do bem da permuta — linha 4/);
  for (const c of ["tipo", "marca", "modelo", "anoFab", "anoModelo", "cor", "placa", "renavam", "chassi", "propNome", "propDoc", "situacao", "d", "obs"])
    assert.match(painel, new RegExp('data-fxb="' + c + '" data-k="3"'), c);
  assert.doesNotMatch(painel, /data-fxb="km"|Quilometragem/, "dono 03/11: sem quilometragem");
  assert.doesNotMatch(painel, /data-fxb="credor"/, "credor só com alienado");
  assert.match(painel, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,13em\),1fr\)\)/);
  assert.match(painel, /value="2026-11-20"/, "data de entrega = a data da linha");
  assert.match(botao(painel, "c-fluxo-bem-ok"), /Confirmar dados do bem/);
  assert.match(botao(painel, "c-fluxo-bem-fechar"), /Cancelar/);
  const al = D.htmlFluxo(fechado, { fluxoEd: comPermutaUI({ ...carroUI, situacao: "alienado" }, { bemK: 3 }) }, "");
  for (const c of ["credor", "saldo", "quitaPor"]) assert.match(al, new RegExp('data-fxb="' + c + '"'), c);
  assert.match(al, /value="o COMPRADOR, antes da entrega"/);
  const im = D.htmlFluxo(fechado, { fluxoEd: comPermutaUI({ tipo: "imovel" }, { bemK: 3 }) }, "");
  for (const c of ["endereco", "matricula", "cartorio", "propNome", "propDoc", "onus"]) assert.match(im, new RegExp('data-fxb="' + c + '"'), c);
  assert.doesNotMatch(im, /data-fxb="placa"/);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: comPermutaUI({ tipo: "outro" }, { bemK: 3 }) }, ""), /<textarea[^>]*data-fxb="descricao"/);
  assert.doesNotMatch(D.htmlFluxo(fechado, { fluxoEd: comPermutaUI(null) }, ""), /class="vb-fx-bem"/, "fechado sem bemK");
});

test("linha de permuta com o bem: a descrição é o resumo (sem campo de texto) e tem o botão Dados do bem", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: comPermutaUI(carroUI) }, "");
  const tr = h.match(/<tr data-fx-linha="3">.*?<\/tr>/s)[0];
  assert.match(tr, /Hyundai HB20 2019\/2020 placa ABC1D23/);
  assert.doesNotMatch(tr, /data-fx="x"/);
  assert.match(botao(tr, "c-fluxo-bem"), /Dados do bem/);
  const sem = D.htmlFluxo(fechado, { fluxoEd: comPermutaUI(null) }, "").match(/<tr data-fx-linha="3">.*?<\/tr>/s)[0];
  assert.match(botao(sem, "c-fluxo-bem"), /Dados do bem/);
});

test("campo do bem: guarda na linha, troca de tipo mantém o proprietário, a data é a da linha, resumo atualizado; confirmar diz o que falta", () => {
  const l = { t: "permuta", v: 1000, n: 1, d: "2026-11-20", i: 1, x: "" };
  D.campoBem(l, "marca", "Hyundai");
  assert.equal(l.b.tipo, "veiculo", "começa como veículo");
  D.campoBem(l, "propNome", "Fulano de Teste");
  D.campoBem(l, "d", "2026-12-01");
  assert.equal(l.d, "2026-12-01");
  D.campoBem(l, "tipo", "imovel");
  assert.deepEqual([l.b.tipo, l.b.propNome, l.b.marca], ["imovel", "Fulano de Teste", undefined]);
  D.campoBem(l, "tipo", "veiculo");
  Object.entries(carroUI).forEach(([k, v]) => D.campoBem(l, k, String(v)));
  assert.equal(l.x, "Hyundai HB20 2019/2020 placa ABC1D23");
  assert.deepEqual(D.faltasDoBem(l), []);
  D.campoBem(l, "saldo", "12.000,50");
  assert.equal(l.b.saldo, 12000.5);
  D.campoBem(l, "placa", "");
  assert.deepEqual(D.faltasDoBem(l), ["placa"]);
  D.campoBem(l, "d", "");
  assert.ok(D.faltasDoBem(l).includes("data prevista de entrega"));
});

test("valores do bem são escapados no formulário", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: comPermutaUI({ ...carroUI, marca: '"><script>x</script>' }, { bemK: 3 }) }, "");
  assert.doesNotMatch(h, /<script>/);
});

/* ---- 04/11/2026 (dono): fluxo à mão guiado pelo simulador — a linha mexida trava (🔒), as outras pré-chaves,
   balões e pós-chaves se ajustam; tudo travado = sugestão por linha + Aplicar sugestão. Números inventados. ---- */
const reguaUI = () => editor({
  valor: 199999.92, padrao: { valor: 199999.92, linhas: [] },
  linhas: [{ t: "sinal", v: 10000, n: 1, d: "2026-11-05", i: 1, x: "" }, { t: "pre", v: 860, n: 12, d: "2026-12-10", i: 1, x: "" },
           { t: "pre", v: 330, n: 12, d: "2027-12-10", i: 1, x: "" }, { t: "balao", v: 10000, n: 1, d: "2027-12-10", i: 1, x: "" },
           { t: "balao", v: 7000, n: 1, d: "2028-11-10", i: 1, x: "" }, { t: "pos", v: 788.33, n: 24, d: "2028-12-10", i: 1, x: "" },
           { t: "fin", v: 139800, n: 1, d: "", i: 1, x: "" }]
});
const linhaTr = (h, k) => h.match(new RegExp('<tr data-fx-linha="' + k + '"[^>]*>.*?</tr>', "s"))[0];

test("guiado: mexer numa pré-chaves trava a linha e o simulador ajusta as outras; a tela marca as ajustadas", () => {
  const ed = reguaUI();
  ed.linhas[1].v = 760;
  const mudou = D.guiarEditor(ed, 1);
  assert.deepEqual(mudou.slice().sort(), [2, 3, 4]);
  assert.equal(ed.travadas[1], true);
  assert.equal(F.validar({ valor: ed.valor, linhas: ed.linhas }).diferenca, 0);
  const h = D.htmlFluxo(fechado, { fluxoEd: ed }, "");
  assert.match(botao(linhaTr(h, 1), "c-fluxo-trava"), /aria-pressed="true"[^>]*>🔒/);
  assert.match(botao(linhaTr(h, 2), "c-fluxo-trava"), /aria-pressed="false"[^>]*>🔓/);
  for (const k of [2, 3, 4]) assert.match(linhaTr(h, k), /ajustado pelo simulador/);
  assert.doesNotMatch(linhaTr(h, 1), /ajustado pelo simulador/);
  assert.equal(botao(linhaTr(h, 0), "c-fluxo-trava"), "", "sinal sem cadeado");
  assert.equal(botao(linhaTr(h, 6), "c-fluxo-trava"), "", "financiamento sem cadeado");
  assert.match(D.htmlFluxoVivo(ed, ""), /Diferença: <b>R\$ 0,00 ✓/);
});

test("guiado: o cadeado trava e destrava; destravar recalcula com a linha de volta no jogo", () => {
  const ed = reguaUI();
  D.travarLinha(ed, 3);
  assert.equal(ed.travadas[3], true);
  ed.linhas[1].v = 760;
  D.guiarEditor(ed, 1);
  assert.equal(F.totalLinha(ed.linhas[3]), 10000, "1º balão travado não mudou");
  D.travarLinha(ed, 3);
  assert.ok(!ed.travadas[3]);
  assert.equal(F.validar({ valor: ed.valor, linhas: ed.linhas }).diferenca, 0);
  D.travarLinha(ed, 0);
  assert.ok(!ed.travadas[0], "linha fixa não trava");
});

test("guiado: tudo travado com diferença mostra a sugestão em cada linha e o Aplicar sugestão, que fecha a conta", () => {
  const ed = reguaUI();
  [2, 3, 4, 5].forEach((k) => D.travarLinha(ed, k));
  ed.linhas[1].v = 760;
  assert.deepEqual(D.guiarEditor(ed, 1), []);
  assert.ok(ed.sugestao);
  const h = D.htmlFluxo(fechado, { fluxoEd: ed }, "");
  for (const k of [1, 2, 3, 4]) assert.match(linhaTr(h, k), /sugestão: R\$ [\d.]+,\d\d/);
  assert.equal(F.totalLinha(ed.linhas[3]), 10000, "travada não muda sozinha");
  const v = D.htmlFluxoVivo(ed, "");
  assert.match(botao(v, "c-fluxo-sug"), /Aplicar sugestão/);
  assert.match(v, /travad/);
  D.aplicarSugestao(ed);
  assert.equal(F.validar({ valor: ed.valor, linhas: ed.linhas }).diferenca, 0);
  assert.deepEqual(ed.travadas, {});
  assert.equal(ed.sugestao, null);
  assert.equal(botao(D.htmlFluxoVivo(ed, ""), "c-fluxo-sug"), "");
});

test("guiado: apagar uma linha desloca os cadeados; recomeçar limpa", () => {
  const ed = reguaUI();
  D.travarLinha(ed, 3); D.travarLinha(ed, 5);
  D.travasAoApagar(ed, 2);
  assert.deepEqual(ed.travadas, { 2: true, 4: true });
  D.limparGuia(ed);
  assert.deepEqual([ed.travadas, ed.ajustadas, ed.sugestao], [{}, {}, null]);
});

test("guiado: o editor explica o cadeado; o ↻ continua entre o tipo e o valor", () => {
  const h = D.htmlFluxo(fechado, { fluxoEd: reguaUI() }, "");
  assert.match(h, /trava \(🔒\)/);
  assert.match(linhaTr(h, 1), /<\/select>.*?<\/td><td><button[^>]*data-acao="c-fluxo-red"[^>]*>↻<\/button><\/td><td><input[^>]*data-fx="v"/s);
});

/* ---- 04/11 (revisão): tipo e quantidade também travam; sugestão com a última diferente; cores pelo tema ---- */
test("guiado: trocar o tipo para pré-chaves/balão/pós-chaves ou mudar a quantidade trava a linha e pede a conta", () => {
  const ed = reguaUI();
  ed.linhas.push({ t: "entrada", v: 3000, n: 1, d: "2027-06-10", i: 1, x: "" });   // 7: sobram 3.000
  ed.linhas[7].t = "balao";
  assert.equal(D.fxMexeu(ed, 7, "t"), true, "virou balão: trava e refaz");
  assert.equal(ed.travadas[7], true);
  D.guiarEditor(ed, null);
  assert.equal(F.validar({ valor: ed.valor, linhas: ed.linhas }).diferenca, 0);
  assert.equal(F.totalLinha(ed.linhas[7]), 3000);
  ed.linhas[7].t = "entrada";
  assert.equal(D.fxMexeu(ed, 7, "t"), false, "virou tipo fixo: sem conta");
  assert.ok(!ed.travadas[7], "e o cadeado sai");
  assert.equal(D.fxMexeu(ed, 2, "n"), true);
  assert.equal(ed.travadas[2], true);
  assert.equal(D.fxMexeu(ed, 3, "d"), false, "data não mexe na conta");
  assert.ok(!ed.travadas[3]);
});

test("guiado: sugestão mostra a última parcela quando ela é diferente", () => {
  const ed = reguaUI();
  ed.sugestao = { 1: 812.33 }; ed.sugestaoU = { 1: 812.4 };
  assert.match(D.htmlFluxo(fechado, { fluxoEd: ed }, "").match(/<tr data-fx-linha="1"[^>]*>.*?<\/tr>/s)[0], /sugestão: R\$ 812,33 \(última R\$ 812,40\)/);
  const r = F.guiar({ ...reguaUI(), linhas: reguaUI().linhas.map((l, k) => (k === 1 ? { ...l, v: 760 } : l)) }, [1, 2, 3, 4, 5]);
  for (const k of Object.keys(r.sugestaoU || {})) assert.ok(r.sugestaoU[k] !== r.sugestao[k]);
});

test("guiado: cores por classe (tema claro/escuro), sem cor fixa no HTML da linha", () => {
  const ed = reguaUI(); ed.linhas[1].v = 760; D.guiarEditor(ed, 1);
  const h = D.htmlFluxo(fechado, { fluxoEd: ed }, "");
  assert.doesNotMatch(h, /#1d6b43|rgba\(255,200,0/);
  assert.match(h, /<tr data-fx-linha="2" data-fx-ajustada="1">/);
  assert.match(h, /class="dz-nota vb-fx-ok"/);
});

/* 07/11/2026 (dono): vencimento no passado trava o Salvar e a tela oferece Corrigir datas */
test("editor: pré-chaves vencendo antes de hoje trava o Salvar e mostra Corrigir datas; sem isso, o botão não aparece", () => {
  const sem = D.htmlFluxoVivo(editor({ motivo: "teste" }), "");
  assert.equal(botao(sem, "c-fluxo-datas"), "");
  globalThis.HOJE_VENDA_TESTE_ = "2026-12-15";
  try {
    const h = D.htmlFluxoVivo(editor({ motivo: "teste" }), "");
    assert.match(botao(h, "c-fluxo-datas"), />Corrigir datas/);
    assert.match(botao(h, "c-fluxo-salvar"), /disabled/);
    assert.match(h, /pré-chaves vence em 10\/12\/2026: tem de vencer depois de hoje \(15\/12\/2026\)/);
  } finally { globalThis.HOJE_VENDA_TESTE_ = "2026-01-01"; }
});

/* 07/11/2026 (dono): pré-chaves mês a mês — "cabem N" no campo e o botão Encaixar quando duas partes caem no mesmo mês */
test("editor: quantidade da pré-chaves mostra quantas cabem; partes no mesmo mês travam e mostram Encaixar", () => {
  const duas = [{ t: "sinal", v: 10000, n: 1, d: "2026-10-30", i: 1, x: "" },
                { t: "pre", v: 500, n: 12, d: "2026-11-10", i: 1, x: "" }, { t: "pre", v: 500, n: 8, d: "2027-11-10", i: 1, x: "" },
                { t: "fin", v: 80000, n: 1, d: "", i: 1, x: "" }];
  const ok = D.htmlContrato(estado(fechado), { fluxoEd: editor({ linhas: duas.map((l) => ({ ...l })), padrao: { valor: 100000, linhas: duas } }) });
  assert.match(ok, /max="12" data-fx="n" data-k="1"/);
  assert.match(ok, /cabem 12/);
  const ruim = duas.map((l) => ({ ...l })); ruim[1].n = 13;
  const h = D.htmlFluxoVivo(editor({ motivo: "teste", linhas: ruim, padrao: { valor: 100000, linhas: duas } }), "");
  assert.match(botao(h, "c-fluxo-encaixar"), />Encaixar as pré-chaves/);
  assert.match(botao(h, "c-fluxo-salvar"), /disabled/);
  assert.equal(botao(D.htmlFluxoVivo(editor({ motivo: "teste", linhas: duas.map((l) => ({ ...l })), padrao: { valor: 100000, linhas: duas } }), ""), "c-fluxo-encaixar"), "");
});
