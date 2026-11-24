/* 24/11/2026 — painel da casa de rua mais organizado (8 ajustes). Só nomes de coluna e dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../painel-casa.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
const ligacoes = fs.readFileSync(path.join(RAIZ, "ligacoes.html"), "utf8");

/* ---------- 1a: situação do processo em texto ---------- */
test("1a: situação do processo sempre em texto (FIM > texto da fórmula SITUAÇÃO > número 1/2/3 > Em andamento > —)", () => {
  assert.deepEqual(P.situacaoProcesso({ fim: "FIM", texto: "🚨 TEMPO CORRIDO MAIOR QUE 45 DIAS E NÃO RECEBEU", numero: 3 }),
    { texto: "Concluído", nivel: "ok", concluido: true }, "FIM ganha de tudo");
  const a = P.situacaoProcesso({ fim: "-", texto: "🚨 TEMPO CORRIDO MAIOR QUE 45 DIAS E NÃO RECEBEU", numero: 3 });
  assert.equal(a.texto, "🚨 Tempo corrido maior que 45 dias e não recebeu");
  assert.equal(a.nivel, "vermelho");
  assert.equal(P.situacaoProcesso({ texto: "⚠️ TEMPO CORRIDO MAIOR QUE 45 DIAS" }).nivel, "laranja");
  assert.equal(P.situacaoProcesso({ texto: "⏳ TEMPO CORRIDO MAIOR QUE 20 DIAS" }).nivel, "amarelo");
  assert.equal(P.situacaoProcesso({ texto: "⏳ TEMPO CORRIDO MAIOR QUE 20 DIAS" }).texto, "⏳ Tempo corrido maior que 20 dias");
  /* sem o texto: o número 1/2/3 traduz pela tabela fixa (número ou texto "2") */
  assert.equal(P.situacaoProcesso({ texto: "-", numero: 1 }).texto, "⏳ Tempo corrido maior que 20 dias");
  assert.equal(P.situacaoProcesso({ texto: null, numero: "2" }).texto, "⚠️ Tempo corrido maior que 45 dias");
  assert.equal(P.situacaoProcesso({ numero: 3 }).texto, "🚨 Tempo corrido maior que 45 dias e não recebeu");
  assert.equal(P.situacaoProcesso({ numero: 3 }).nivel, "vermelho");
  /* sem nada: vendida = Em andamento; não vendida = — */
  assert.equal(P.situacaoProcesso({ numero: "", texto: "-", vendida: true }).texto, "Em andamento");
  assert.equal(P.situacaoProcesso({ numero: null, vendida: false }).texto, "—");
  for (const d of [{}, { numero: 1 }, { texto: "x", vendida: true }, { fim: "FIM" }]) assert.doesNotMatch(P.situacaoProcesso(d).texto, /^\d+$/, "nunca número");
});

test("1a: resolverSituacao acha as 3 colunas; a SITUAÇÃO de texto só vale se for fórmula", () => {
  const nomes = ["SITUAÇÃO", "SITUAÇÃO DO PROCESSO", "FIM DO PROCESSO", "CIDADE"];
  assert.deepEqual(P.resolverSituacao(nomes, ["SITUAÇÃO", "FIM DO PROCESSO", "CIDADE"]),
    { texto: "SITUAÇÃO", numero: "SITUAÇÃO DO PROCESSO", fim: "FIM DO PROCESSO" });
  assert.equal(P.resolverSituacao(nomes, ["FIM DO PROCESSO"]).texto, null, "SITUAÇÃO que não é fórmula não é o texto da situação");
});

/* ---------- 1b: ordem ---------- */
test("1b: cartão Situação em primeiro enquanto não terminou; último quando Concluído", () => {
  const ch = ["vendida", "situacao", "ligacoes", "agua", "energia", "recebeu", "entregue"];
  assert.deepEqual(P.ordemCartoes(ch, false), ["situacao", "vendida", "ligacoes", "agua", "energia", "recebeu", "entregue"]);
  assert.deepEqual(P.ordemCartoes(ch, true), ["vendida", "ligacoes", "agua", "energia", "recebeu", "entregue", "situacao"]);
  assert.deepEqual(P.ordemCartoes(["vendida"], true), ["vendida"], "sem cartão de situação, não inventa");
});

/* ---------- 1c: datas dos cartões ---------- */
test("1c: cada cartão casa só a SUA coluna de data; coluna inexistente = sem linha; formato dd/mm/aaaa", () => {
  const nomes = ["DATA DA VENDA", "RECEBIMENTO - FINANCIAMENTO DATA", "DATA DA ENTREGA", "DATA GEROU GCAP", "DATA PAGOU GCAP", "DATA DO GCAP"];
  assert.equal(P.colunaDataCartao("vendida", nomes), "DATA DA VENDA");
  assert.equal(P.colunaDataCartao("recebeu", nomes), "RECEBIMENTO - FINANCIAMENTO DATA");
  assert.equal(P.colunaDataCartao("entregue", nomes), "DATA DA ENTREGA");
  assert.equal(P.colunaDataCartao("gerou_gcap", nomes), "DATA GEROU GCAP");
  assert.equal(P.colunaDataCartao("pagou_gcap", nomes), "DATA PAGOU GCAP", "não pega a do outro cartão");
  assert.equal(P.colunaDataCartao("gerou_gcap", ["DATA DO GCAP", "DATA PAGOU GCAP"]), null, "sem a sua coluna não mostra nada");
  assert.equal(P.colunaDataCartao("gerou_gcap", ["GEROU E ARMAZENOU GCAP?"]), null, "hoje não existe: nada inventado");
  assert.equal(P.colunaDataCartao("situacao", nomes), null);
  assert.equal(P.formatarData("2026-11-05"), "05/11/2026");
  assert.equal(P.formatarData("2026-11-05T10:00:00.000-03:00"), "05/11/2026");
  assert.equal(P.formatarData({ start: "2026-01-09" }), "09/01/2026");
  for (const v of ["", null, undefined, "—", "abc"]) assert.equal(P.formatarData(v), "", "sem data = sem linha");
});

test("c (GCAP): o cartão antigo 'Data do GCAP' só casa os nomes exatos antigos (não duplica as colunas novas)", () => {
  const r = P.resolverProcesso(["GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?", "DATA GEROU GCAP", "DATA PAGOU GCAP"]);
  assert.deepEqual(r.map(x => x.chave), ["vendida", "gerou_gcap", "pagou_gcap"]);
  assert.equal(P.resolverProcesso(["DATA DO GCAP"]).find(x => x.chave === "data_gcap").coluna, "DATA DO GCAP");
  assert.equal(P.resolverProcesso(["DATA GCAP"]).find(x => x.chave === "data_gcap").coluna, "DATA GCAP");
});

test("a (GCAP): marcar SIM carimba hoje só se a coluna existir e estiver vazia; NÃO não apaga; nunca sobrescreve", () => {
  const nomes = ["GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?", "DATA GEROU GCAP", "DATA PAGOU GCAP"];
  const vazio = () => "", hoje = "2026-11-24";
  assert.deepEqual(P.carimboGcap("GEROU E ARMAZENOU GCAP?", "SIM", nomes, vazio, hoje), { coluna: "DATA GEROU GCAP", valor: hoje });
  assert.deepEqual(P.carimboGcap("PAGOU GCAP?", "SIM", nomes, vazio, hoje), { coluna: "DATA PAGOU GCAP", valor: hoje });
  assert.equal(P.carimboGcap("PAGOU GCAP?", "NÃO", nomes, vazio, hoje), null, "NÃO não grava (nem apaga)");
  assert.equal(P.carimboGcap("PAGOU GCAP?", "SIM", nomes, n => (n === "DATA PAGOU GCAP" ? "2026-10-01" : ""), hoje), null, "data preenchida não é sobrescrita");
  assert.equal(P.carimboGcap("PAGOU GCAP?", "SIM", ["PAGOU GCAP?"], vazio, hoje), null, "sem a coluna de data (produção hoje) não faz nada");
  assert.equal(P.carimboGcap("ITBI PAGO", "SIM", nomes, vazio, hoje), null, "outra coluna não carimba");
  assert.match(P.hojeIso(new Date(2026, 0, 5)), /^2026-01-05$/);
});

/* ---------- 1d: água e energia ---------- */
test("1d: status de ligação em texto; tipo pela concessionária", () => {
  assert.equal(P.tipoConcessionaria("EQUATORIAL"), "energia");
  assert.equal(P.tipoConcessionaria("SANESC"), "agua");
  assert.equal(P.tipoConcessionaria("SANEAGO"), "agua");
  assert.equal(P.tipoConcessionaria("OUTRA"), "");
  assert.deepEqual(["TRANSFERIDO", "LIGADO", "NÃO LIGADO", "ENTREGUE NÃO TRANSFERIDO"].map(s => { const r = P.statusLigacao(s); return [r.texto, r.nivel]; }),
    [["Transferida", "ok"], ["Ligada, não transferida", "neutro"], ["Não ligada", "nao"], ["Entregue, não transferida", "alerta"]]);
  assert.equal(P.statusLigacao(""), null);
});
test("1d: Água/Energia vêm da tela Ligações; sem linha, cai no SIM/NÃO da venda", () => {
  const ligs = [{ concessionaria: "EQUATORIAL", status: "TRANSFERIDO" }, { concessionaria: "SANESC", status: "ENTREGUE NÃO TRANSFERIDO" }];
  assert.deepEqual(P.statusAguaEnergia(ligs, "energia", "NÃO"), { texto: "Transferida", nivel: "ok", origem: "ligacoes" }, "a ligação manda, não o valor antigo");
  assert.equal(P.statusAguaEnergia(ligs, "agua", "SIM").texto, "Entregue, não transferida");
  assert.equal(P.statusAguaEnergia([{ concessionaria: "EQUATORIAL", status: "LIGADO" }], "agua", "SIM").texto, "Transferida", "sem ligação de água: valor da venda");
  assert.equal(P.statusAguaEnergia([], "agua", "SIM").nivel, "ok");
  assert.equal(P.statusAguaEnergia([], "agua", "NÃO").texto, "Não transferida");
  assert.equal(P.statusAguaEnergia([], "energia", "").texto, "—");
  assert.equal(P.statusAguaEnergia(null, "energia", null).texto, "—");
  const duas = [{ concessionaria: "EQUATORIAL", status: "TRANSFERIDO" }, { concessionaria: "EQUATORIAL", status: "NÃO LIGADO" }];
  assert.equal(P.statusAguaEnergia(duas, "energia", "").texto, "Não ligada", "com duas UCs vale a menos adiantada");
});

/* ---------- 1d/1e/2/3/4/6: vendas.html ---------- */
test("1d/1e: chips antigos de água/energia saem; fórmulas do cartão saem da fileira; chips sobem para logo abaixo dos cartões", () => {
  assert.doesNotMatch(vendas, /\[\["AGUA TRANSFERIDA","ÁGUA"\],\["ENERGIA TRANSFERIDA","ENERGIA"\]\]/);
  assert.match(vendas, /formulaDeCartao/);
  const iProc = vendas.indexOf("sec.resumo+=pnResumoProcesso(V,pageId,sensPendente);");
  const iChips = vendas.indexOf('if(chips.length) sec.resumo+=`<div class="chips">');
  const iDados = vendas.indexOf("sec.resumo+='<div class=\"grp\">Dados da Venda</div>");
  assert.ok(iProc > 0 && iChips > iProc && iDados > iChips, "cartões, depois os chips, depois os Dados da venda");
  assert.deepEqual(["SITUAÇÃO", "SITUAÇÃO DO PROCESSO", "FIM DO PROCESSO", "CIDADE", "PRAZO ATÉ A ENTREGA"].filter(n => !P.formulaDeCartao(n)), ["CIDADE", "PRAZO ATÉ A ENTREGA"]);
});

/* roda o pnResumoProcesso do vendas.html com um painel inventado */
function resumo({ schema, valores, ligs = [], vendida = true }) {
  const i = vendas.indexOf("function pnResumoProcesso("), f = vendas.indexOf("\nfunction renderPainel(", i);
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const SCHEMA = schema.map(c => ({ tipo: "text", ...c }));
  const g = new Function("window", "SCHEMA", "DADOS", "campoPorNome", "getV", "normNome", "nomeExcluido", "esc", "vendidaDe", "ligacoesDaObra", "painelListaBranca",
    vendas.slice(i, f) + "\nreturn pnResumoProcesso;");
  const fn = g({ PainelCasa: P }, SCHEMA, { hub: [{ id: "p1", valores }], set: [] }, n => SCHEMA.find(c => norm(c.nome) === norm(n)) || null,
    (V, n) => V[n], norm, () => false, s => String(s == null ? "" : s), () => vendida, () => ligs, () => false);
  return fn(valores, "p1", false);
}
const SC = [{ nome: "SITUAÇÃO", tipo: "formula" }, { nome: "SITUAÇÃO DO PROCESSO", tipo: "formula" }, { nome: "FIM DO PROCESSO", tipo: "formula" },
  { nome: "DATA DA VENDA", tipo: "date" }, { nome: "RECEBEU?", tipo: "select" }, { nome: "DATA DA ENTREGA", tipo: "date" },
  { nome: "ENTREGOU A CASA E PEGOU TERMO DE ENTREGA?", tipo: "select" }, { nome: "AGUA TRANSFERIDA", tipo: "select" }, { nome: "ENERGIA TRANSFERIDA", tipo: "select" }];
const rotulos = h => [...h.matchAll(/<div class="proc-rot">([^<]*)<\/div>/g)].map(m => m[1]);

test("1: cartões do Resumo — situação primeiro com texto, datas embaixo, Água e Energia das ligações", () => {
  const h = resumo({ schema: SC, ligs: [{ concessionaria: "EQUATORIAL", status: "TRANSFERIDO" }],
    valores: { "SITUAÇÃO": "⚠️ TEMPO CORRIDO MAIOR QUE 45 DIAS", "SITUAÇÃO DO PROCESSO": 2, "FIM DO PROCESSO": "-", "DATA DA VENDA": "2026-10-02",
      "RECEBEU?": "NÃO", "DATA DA ENTREGA": "", "AGUA TRANSFERIDA": "SIM", "ENERGIA TRANSFERIDA": "NÃO" } });
  const r = rotulos(h);
  assert.equal(r[0], "Situação do processo", "primeiro enquanto não terminou");
  assert.ok(r.includes("Água") && r.includes("Energia") && r.includes("Vendida"));
  assert.match(h, /Situação do processo<\/div><div class="proc-val">⚠️ Tempo corrido maior que 45 dias<\/div>/);
  assert.match(h, /proc-it laranja larga/);
  assert.match(h, /Vendida<\/div><div class="proc-val">SIM<\/div><div class="proc-dt">02\/10\/2026<\/div>/, "data da venda embaixo");
  assert.doesNotMatch(h, /Entregue<\/div><div class="proc-val">[^<]*<\/div><div class="proc-dt">/, "sem data = sem linha (nada de —)");
  assert.match(h, /Energia<\/div><div class="proc-val">Transferida<\/div>/, "energia pela tela Ligações (mesmo com NÃO na venda)");
  assert.match(h, /Água<\/div><div class="proc-val">Transferida<\/div>/, "água sem ligação: cai no SIM da venda");
  assert.doesNotMatch(h, /proc-val">2</, "nunca o número");
});
test("1b: processo concluído manda a Situação para o último cartão (verde)", () => {
  const h = resumo({ schema: SC, valores: { "SITUAÇÃO": "-", "SITUAÇÃO DO PROCESSO": "", "FIM DO PROCESSO": "FIM" } });
  const r = rotulos(h);
  assert.equal(r[r.length - 1], "Situação do processo");
  assert.match(h, /proc-it sim larga[^>]*><div class="proc-rot">Situação do processo<\/div><div class="proc-val">Concluído/);
});
test("1d: Água/Energia sem ligação e sem valor na venda mostram —", () => {
  const h = resumo({ schema: SC, valores: {} });
  assert.match(h, /Água<\/div><div class="proc-val">—<\/div>/);
});

test("2: DATA DA VENDA também no Andamento (etapa 2), em par; editar numa atualiza a outra", () => {
  assert.equal(P.etapa("DATA DA VENDA"), "CONTRATO DE COMPRA E VENDA E DOCUMENTOS AO CORRESPONDENTE");
  const nomes = ["ARMAZENOU CONTRATO COMPRA E VENDA?", "EMITIU RCPM?", "MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?", "DATA DE ENVIO DOS DOCUMENTOS", "DATA DA VENDA"];
  assert.deepEqual(P.agruparPares(nomes), [["ARMAZENOU CONTRATO COMPRA E VENDA?", "DATA DA VENDA"], "EMITIU RCPM?",
    ["MANDOU TODOS OS DOCS. P/ CORESSPONDENTE?", "DATA DE ENVIO DOS DOCUMENTOS"]]);
  assert.deepEqual(P.agruparPares(nomes.map(n => n.replace("CORESSPONDENTE", "CORRESPONDENTE")))[2], ["MANDOU TODOS OS DOCS. P/ CORRESPONDENTE?", "DATA DE ENVIO DOS DOCUMENTOS"], "grafia certa também");
  /* na etapa, EMITIU RCPM? fica depois dos pares */
  assert.deepEqual(P.itensDaEtapa(P.ETAPAS[1][0], nomes).map(x => Array.isArray(x) ? x[0].slice(0, 5) : x), ["ARMAZ", "MANDO", "EMITIU RCPM?"]);
  assert.deepEqual(P.agruparPares(["EMITIU RCPM?", "ARMAZENOU CONTRATO COMPRA E VENDA?"]), ["EMITIU RCPM?", "ARMAZENOU CONTRATO COMPRA E VENDA?"], "sem a data, fica sozinho");
  assert.match(vendas, /porAba\.andamento\.push\(cdv\.nome\)/);
  assert.match(vendas, /ehEsp=normNome\(nome\)==="DATA DA VENDA"/, "espelho: a outra caixa acompanha a edição");
  assert.match(vendas, /pnMarcarEspelho\(h,n\) : h/);
  assert.match(vendas, /RESUMO\.map\(n=>/, "o campo continua no Resumo/Dados da venda");
});

test("3: protocolos — indicador automático conforme o anexo", () => {
  const nomes = ["TEM PROTOCOLO DE TRANS. ÁGUA", "TEM PROTOCOLO DE TRANS. ENERGIA", " PROTOCOLO DE TRANS. ÁGUA", " PROTOCOLO DE TRANS. ENERGIA",
    "DATA PROTOCOLO DE TRANS. ÁGUA", "DATA PROTOCOLO DE TRANS. ENERGIA"];
  const [ag, en] = P.protocolos(nomes);
  assert.deepEqual(ag, { tipo: "agua", select: "TEM PROTOCOLO DE TRANS. ÁGUA", arquivo: " PROTOCOLO DE TRANS. ÁGUA", data: "DATA PROTOCOLO DE TRANS. ÁGUA" });
  assert.equal(en.arquivo, " PROTOCOLO DE TRANS. ENERGIA", "o nome do arquivo mantém o espaço inicial");
  assert.equal(P.protocolos(nomes.slice(0, 4))[0].data, null, "sem coluna de data (produção hoje) não inventa");
  assert.deepEqual(P.estadoProtocolo({ temArquivo: true, select: "NÃO" }), { texto: "SIM · anexado", nivel: "ok", ver: true, anexar: false });
  assert.deepEqual(P.estadoProtocolo({ temArquivo: false, select: "NÃO" }), { texto: "NÃO · sem anexo", nivel: "nao", ver: false, anexar: true });
  assert.deepEqual(P.estadoProtocolo({ temArquivo: false, select: null }), { texto: "NÃO · sem anexo", nivel: "nao", ver: false, anexar: true });
  assert.deepEqual(P.estadoProtocolo({ temArquivo: false, select: "SIM" }), { texto: "SIM · sem anexo", nivel: "alerta", ver: false, anexar: true }, "legado");
  assert.equal(P.estadoProtocolo({ carregando: true, temArquivo: false, select: "NÃO" }).texto, "carregando…", "antes dos dados protegidos chegarem");
  assert.equal(P.estadoProtocolo({ carregando: true }).anexar, false);
  /* a data do protocolo some da etapa quando vira parte do indicador, e vai para a etapa 4 quando solta */
  assert.equal(P.etapa("DATA PROTOCOLO DE TRANS. ÁGUA"), "PROTOCOLOS DE TRANSFERÊNCIA (ÁGUA E ENERGIA)");
  assert.deepEqual(P.carimboProtocolo(ag, () => "", "2026-11-24"), { coluna: "DATA PROTOCOLO DE TRANS. ÁGUA", valor: "2026-11-24" });
  assert.equal(P.carimboProtocolo(ag, () => "2026-10-01", "2026-11-24"), null, "não sobrescreve");
  assert.equal(P.carimboProtocolo(P.protocolos(nomes.slice(0, 4))[0], () => "", "2026-11-24"), null, "sem coluna de data");
  /* fiação no vendas.html */
  assert.match(vendas, /function pnProtocoloHtml\(/);
  assert.match(vendas, /pnEnviarProtocolo\(\$\{jsArg\(pageId\)\},\$\{jsArg\(ca\.nome\)\},\$\{jsArg\(cs\.nome\)\},this\)/, "usa o nome exato da coluna de arquivo");
  assert.match(vendas, /await editar\(pageId,selectNome,cs\?cs\.tipo:"select","SIM"\)/, "grava SIM no select depois do envio");
  assert.match(vendas, /return !!\(r\.ok&&!r\.enfileirado\)/, "enviarArquivo avisa se subiu");
  assert.match(vendas, /pn-proto-data/, "data editável embaixo do indicador");
});

test("4: AGUA/ENERGIA TRANSFERIDA saem do painel; ligações para todos os setores dentro da etapa de vistoria e entrega", () => {
  assert.equal(P.ocultoNoPainel("AGUA TRANSFERIDA"), true);
  assert.equal(P.ocultoNoPainel("ENERGIA TRANSFERIDA "), true);
  assert.match(vendas, /function pnLigacoesHtml\(/);
  assert.doesNotMatch(vendas, /if\(SETOR_ATUAL==="Secretaria de Vendas"\)\{\s*const ligs=ligacoesDaObra/, "o bloco não é mais só da Secretaria");
  assert.match(vendas, /nenhuma ligação cadastrada para esta casa/);
  assert.match(vendas, /Água e energia <span>\(vem da tela Ligações\)<\/span>/);
  assert.match(vendas, /g\.etapa===ETAPA_ENTREGA\?ligsHtml:""/);
});

test("5: campos de conferência da transferência ficam fora do painel (a tela Ligações segue usando)", () => {
  for (const n of ["CONFERIU NA SEMANA (TRANSFERÊNCIA)", "DATA DE VERIFICAÇÃO DAS CONTAS", "DATA DE ERIFICAÇÃO DAS CONTAS", "CONFERÊNCIA DA CONCLUSÃO",
    "DATA DA CONFERÊNCIA (TRANSFERÊNCIA)", "OBS. CONFERÊNCIA (TRANSFERÊNCIA)", "conferiu na semana (transferencia) "]) assert.equal(P.ocultoNoPainel(n), true, n);
  for (const n of ["ENTREGOU A CASA E PEGOU TERMO DE ENTREGA?", "DATA DA ENTREGA", "CASA APTA PARA A VISTORIA"]) assert.equal(P.ocultoNoPainel(n), false, n);
  assert.match(ligacoes, /CONF_PAPEIS = \{ SEM: \["CONFERIU NA SEMANA"/, "ligacoes.html não foi tocada por causa disso");
});

test("6: o painel não desenha CADASTRO DA CASA nem OUTROS CAMPOS; a função pura e a planilha seguem com elas", () => {
  const nomes = ["AVALIAÇÃO", "ITBI PAGO", "REF", "CIDADE", "SETOR", "COLUNA NOVA QUALQUER", "AGUA TRANSFERIDA", "HISTÓRICO QUALQUER"];
  const tudo = P.porEtapa(nomes).map(x => x.etapa);
  assert.ok(tudo.includes("CADASTRO DA CASA") && tudo.includes("OUTROS CAMPOS"), "a função pura continua agrupando");
  const painel = P.porEtapaPainel(nomes);
  assert.deepEqual(painel.map(x => x.titulo), ["1 · AVALIAÇÃO E VALORES", "2 · PREFEITURA, ITBI E CARTÓRIO", "3 · VISTORIA E ENTREGA DA CASA"], "numeração sequencial");
  assert.ok(!painel.some(x => P.ETAPAS_FORA_DO_PAINEL.includes(x.etapa)));
  assert.ok(P.ETAPAS.some(e => e[0] === "CADASTRO DA CASA"), "ETAPAS não perdeu a etapa (colunasRua depende)");
  assert.match(vendas, /porEtapaPainel/);
});

test("7: AGÊNCIA na etapa 3, empilhada sob PROCESSO CONFORME?; etapa 5 = TAXA DE VISTORIA", () => {
  assert.equal(P.etapa("AGÊNCIA"), "CONFORMIDADE E CONTRATO DO BANCO");
  assert.equal(P.etapa("RECEBEU TAXA VISTORIA?"), "TAXA DE VISTORIA");
  assert.ok(!P.ETAPAS.some(e => e[0] === "TAXA DE VISTORIA E AGÊNCIA"));
  const g = P.porEtapa(["MANDOU P/ CONFORMIDADE?", "PROCESSO CONFORME?", "ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO", "VALOR DA PARCELA", "TEVE FGTS?", "AGÊNCIA"]);
  assert.equal(g.length, 1);
  const it = P.itensDaEtapa(g[0].etapa, g[0].campos);
  assert.deepEqual(it, ["MANDOU P/ CONFORMIDADE?", ["PROCESSO CONFORME?", "AGÊNCIA"], ["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO"], "VALOR DA PARCELA", "TEVE FGTS?"]);
  assert.deepEqual(P.agruparPares(["PROCESSO CONFORME?"]), ["PROCESSO CONFORME?"], "sem a agência, fica sozinho");
});

test("GCAP: a data (coluna nova) fica em par sob a pergunta, na etapa GCAP; sem a coluna nada muda", () => {
  assert.equal(P.etapa("DATA GEROU GCAP"), "GCAP");
  assert.deepEqual(P.agruparPares(["GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?", "DATA GEROU GCAP", "DATA PAGOU GCAP"]),
    [["GEROU E ARMAZENOU GCAP?", "DATA GEROU GCAP"], ["PAGOU GCAP?", "DATA PAGOU GCAP"]]);
  assert.deepEqual(P.agruparPares(["GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?"]), ["GEROU E ARMAZENOU GCAP?", "PAGOU GCAP?"]);
  assert.match(vendas, /pnCarimbarGcap\(pageId,prop,valor\)/);
  assert.match(vendas, /if\(r\.ok&&\(tipo==="select"\|\|tipo==="status"\)\) pnCarimbarGcap/, "editar() carimba");
  assert.match(vendas, /if\(r\.ok\) pnCarimbarGcap\(pageId,prop,valor\);\n\}/, "o botão SIM/NÃO também");
});

test("8: ligacoes.html mostra DATA DA ASSINATURA CONTRATO CAIXA só como rótulo de tela (grade, filtros, colunas e PDF usam tituloColuna)", () => {
  assert.match(ligacoes, /RENOMEADAS_TELA\[normN\(V\.DT_ASSIN\)\] = "DATA DA ASSINATURA CONTRATO CAIXA";/);
  assert.match(ligacoes, /DT_ASSIN:\s+"DATA DE ASSINATURA DO CONTRATO"/, "a coluna do Notion não muda");
  assert.match(ligacoes, /\$\{esc\(tituloColuna\(c\)\)\}\$\{seta\(c\)\}/, "cabeçalho da grade");
  assert.match(ligacoes, /pdfQuebrar\(tituloColuna\(c\)/, "cabeçalho do PDF");
  assert.match(ligacoes, /esc\(tituloColuna\(c\)\)\}<\/label>/, "lista de colunas");
});

test("celular: cartões e linhas novas quebram dentro do cartão, sem estourar a largura", () => {
  assert.match(vendas, /\.proc-val\{[^}]*white-space:normal;overflow-wrap:anywhere;min-width:0\}/);
  assert.match(vendas, /\.proc-it\{[^}]*min-width:0\}/);
  assert.match(vendas, /\.proc-it\.larga\{grid-column:span 2\}/);
  assert.match(vendas, /@media \(max-width:600px\)\{ \.proc\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\} \}/);
  assert.match(vendas, /\.pn-proto-ver,\.pn-proto-anexar\{[^}]*min-height:44px/);
  assert.match(vendas, /\.pn-proto-linha\{display:flex;flex-wrap:wrap/);
  assert.match(vendas, /\.lig\{flex-wrap:wrap\}/);
  assert.match(vendas, /painel-casa\.js\?v=11/);
});
