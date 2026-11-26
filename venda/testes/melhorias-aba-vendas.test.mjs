/* 26/11/2026 — MELHORIAS ABA DE VENDAS (PDF do dono): painel da casa de rua. Só nomes de coluna, nenhum dado. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../painel-casa.js");
const D = require("../../venda-dossie.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");

test("1: Andamento é a 2ª aba; Mais Controle tem aba própria nos dois modos", () => {
  assert.equal(P.ABAS[1][0], "andamento");
  assert.ok(P.ABAS.some(a => a[0] === "mc") && P.ABAS_LISTA.some(a => a[0] === "mc"));
  assert.match(vendas, /#painel\[data-aba="contrato"\] #contrato-wrap>\.vb-mc,#painel\[data-aba="mc"\] #contrato-wrap>:not\(\.vb-mc\)/);
});

test("5/7: TIPO e MODELO? vão para Links (com a casa modelo de visita); o resto não muda", () => {
  assert.equal(P.abaDoCampo("TIPO"), "links");
  assert.equal(P.abaDoCampo("MODELO?"), "links");
  assert.equal(P.abaDoCampo("LAYOUT"), "links");
  assert.equal(P.abaDoCampo("TIPO DE CASA"), "andamento", "só a coluna TIPO exata");
  assert.match(vendas, /blocoTitulado\(rel,"Tipo e casa modelo","","","",pnCasaModeloHtml\(V,pageId\)\)/);
});

test("6: etapa 3 na ordem do dono — validações, ASSINOU+DATA num cartão, AGÊNCIA/TEVE FGTS e os VALORES depois", () => {
  const it = P.itensDaEtapa("CONFORMIDADE E CONTRATO DO BANCO", ["MANDOU P/ CONFORMIDADE?", "PROCESSO CONFORME?", "ASSINOU E ARMAZENOU CONTRATO DO BANCO?",
    "DATA DE ASSINATURA DO CONTRATO", "VALOR DA PARCELA", "TEVE FGTS?", "VALOR DO FGTS", "AGÊNCIA", "VALOR FINANCIADO"]);
  assert.deepEqual(it, ["MANDOU P/ CONFORMIDADE?", "PROCESSO CONFORME?", ["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO"],
    "AGÊNCIA", "TEVE FGTS?", { sub: "Valores" }, "VALOR DA PARCELA", "VALOR DO FGTS", "VALOR FINANCIADO"]);
  assert.deepEqual(P.itensDaEtapa("AVALIAÇÃO E VALORES", ["AVALIAÇÃO", "VALIDADE", "VALOR NA MÃO"]), ["AVALIAÇÃO", "VALIDADE", "VALOR NA MÃO"], "etapa 1 sem subtítulo");
  assert.deepEqual(P.itensDaEtapa("GCAP", ["PAGOU GCAP?"]), ["PAGOU GCAP?"], "sem valores, sem subtítulo");
  assert.match(vendas, /\.pn-grade>\.pn-par\{grid-column:1\/-1;/, "o par vira cartão na largura toda");
  assert.match(vendas, /it\.sub\)\?`<div class="pn-sub">/);
});

test("prefeitura com a taxa de vistoria; vistoria antes da devolução (só no painel)", () => {
  const g = P.porEtapaPainel(["RECEBEU TAXA VISTORIA?", "TEM NUMERO DE CADASTRO?", "Nº DE CADASTRO PREFEITURA", "DEVOLVEU NO BANCO?", "RECEBEU?",
    "CASA APTA PARA A VISTORIA", "GEROU E ARMAZENOU GCAP?"]);
  assert.deepEqual(g.map(x => x.titulo), ["1 · TAXA DE VISTORIA, PREFEITURA, ITBI E CARTÓRIO", "2 · VISTORIA E ENTREGA DA CASA",
    "3 · DEVOLUÇÃO E RECEBIMENTO DO BANCO", "4 · GCAP"]);
  assert.deepEqual(g[0].campos, ["RECEBEU TAXA VISTORIA?", "TEM NUMERO DE CADASTRO?", "Nº DE CADASTRO PREFEITURA"]);
  assert.equal(g[1].etapa, "VISTORIA E ENTREGA DA CASA", "a chave da etapa não muda (ligações e alerta dependem dela)");
  assert.equal(P.etapa("RECEBEU TAXA VISTORIA?"), "TAXA DE VISTORIA", "a função pura (planilha) não muda");
});

test("alerta da pré-vistoria sem protocolo anexado", () => {
  assert.equal(P.alertaPreVistoria([], "SIM"), null);
  assert.equal(P.alertaPreVistoria(["agua", "energia"], "SIM").nivel, "vermelho");
  assert.match(P.alertaPreVistoria(["agua", "energia"], "SIM").texto, /água e energia/);
  assert.equal(P.alertaPreVistoria(["energia"], "NÃO").nivel, "laranja");
  assert.match(vendas, /alertaEtapa=e=>e===ETAPA_ENTREGA\?pnAlertaPreVistoriaHtml/);
});

test("GCAP: vence no 1º dia útil do mês seguinte à assinatura da Caixa (mesma conta do Code.gs)", () => {
  assert.equal(P.vencimentoGcap("2026-10-15"), "2026-11-02", "01/11/2026 é domingo");
  assert.equal(P.vencimentoGcap("2026-12-03"), "2027-01-01");
  assert.equal(P.vencimentoGcap(""), "");
  assert.equal(P.estadoGcap({ assinatura: "" }), null);
  assert.equal(P.estadoGcap({ assinatura: "2026-10-15", hoje: "2026-11-26" }).chave, "vencido");
  assert.equal(P.estadoGcap({ assinatura: "2026-10-15", hoje: "2026-10-28" }).chave, "semana");
  assert.equal(P.estadoGcap({ assinatura: "2026-10-15", hoje: "2026-10-16" }).chave, "aberto");
  const pg = P.estadoGcap({ assinatura: "2026-10-15", pagou: "SIM", dataPagou: "2026-10-30", hoje: "2026-11-26" });
  assert.equal(pg.chave, "pago"); assert.equal(pg.texto, "Pago em 30/10/2026");
  const gs = fs.readFileSync(path.join(RAIZ, "Code.gs"), "utf8");
  assert.match(gs, /var prazo = primeiroDiaUtilMesSeguinte_\(dataAssin\);/, "se o Apps Script mudar a régua, mude aqui também");
});

test("GCAP no Resumo, na etapa e na planilha (alerta + filtro)", () => {
  assert.match(vendas, /card\("vence_gcap","Pagar GCAP até"/);
  assert.match(vendas, /data-gcap="\$\{gc\?gc\.chave:""\}"/);
  assert.match(vendas, /data-v="gcap-vencido"/);
  assert.match(vendas, /if\(ok && gcapFiltro\.length\) ok = gcapCasa\(tr\.dataset\.gcap\|\|""\);/);
});

test("busca de campo no painel", () => {
  assert.match(vendas, /<input type="search" id="pn-busca-q"[^>]*oninput="pnBuscar\(this\.value\)"/);
  for (const f of ["function pnBuscar(", "function pnIrBusca(", "function pnAbaDoElemento("]) assert.ok(vendas.includes(f), f);
  assert.match(vendas, /@media \(max-width:600px\)\{ \.pn-grade>\.pn-par\{grid-template-columns:1fr\} \.pn-busca input\{font-size:16px;min-height:44px\} \}/);
});

test("2/3/4: Documentos, Contrato (casa de rua) e Recebimentos em cartões", () => {
  const e = { tipoCasa: "CASA PRONTA", arquivos: {}, dossie: "", observacao: "",
    imovel: { arquivos: {}, dossie: "", dados: {}, observacao: "", semColunas: [] } };
  const h = D.html(e, { dois: false });
  for (const t of ["Tipo de casa", "Compradores", "Enviar e ler documentos", "Documentos do comprador", "Documentos do imóvel"])
    assert.ok(h.includes('<div class="dz-card-t">' + t + "</div>"), t);
  const ct = { gerado: false, conta: { opcoes: [{ id: "c1", nome: "CONTA" }], padrao: "", escolhida: null },
    testemunhas: { opcoes: [{ id: "a", nome: "A" }, { id: "b", nome: "B" }], escolhidas: [], padrao: [] } };
  const rua = D.htmlContrato(ct, { cartoes: true, rascunho: {} });
  assert.match(rua, /dz-card-t">Gerar o contrato</); assert.match(rua, /dz-card-t">Conta de recebimento</); assert.match(rua, /dz-card-t">Testemunhas da assinatura</);
  assert.doesNotMatch(D.htmlContrato(ct, { rascunho: {} }), /dz-card/, "condomínio continua sem cartões");
  const r = D.htmlRecebimentos({ itens: [{ id: "SINAL", rotulo: "Sinal", modo: "lista", pagamentos: [], confirmado: true, data: "2026-11-01" }] }, {});
  assert.match(r, /class="dz-card rec-card rec-card-ok" data-rec-item="SINAL"/);
});
