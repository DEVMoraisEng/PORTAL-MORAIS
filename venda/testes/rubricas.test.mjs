/* 30/10: rubricas do comprador — RubricasVenda (acha no PDF), ClicksignVenda (confere e monta os requisitos) e
 * assinatura-ui (lê o PDF antes de enviar). Sem rede e sem pdf.js: as páginas são montadas à mão no formato que
 * RubricasVenda.paginaDoPdfjs produz. Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const R = req("../RubricasVenda.js");
const CS = req("../ClicksignVenda.js");
const A = req("../assinatura-ui.js");

/* A4 em pontos; margem 57; quadro-resumo com a coluna cinza até 177 e o texto a partir de 183 */
const W = 595, H = 842;
const it = (str, x, y, w, h = 11) => ({ str, x, y, w: w === undefined ? str.length * 5 : w, h });
const pag = (numero, itens) => ({ numero, largura: W, altura: H, itens });

const CONTRATO = [
  pag(1, [it("CONTRATO DE COMPRA E VENDA", 200, 60), it("1. PARTES", 60, 90)]),
  pag(3, [
    it("4.2.1. ENTRADA: parcelamento direto com a VENDEDORA.", 183, 140),
    it("CIÊNCIA EXPRESSA E ESPECÍFICA DO COMPRADOR", 183, 392),
    /* "ASSINATURA:" e os traços em itens separados, na mesma linha */
    it("ASSINATURA: ", 183, 437, 60), it("_______________________________]", 243, 437, 195),
    it("ASSINATURA: _______________________________]", 183, 556, 255)
  ]),
  pag(8, [it("LIMITES – ASSINATURA: _______________________________", 183, 377, 319)]),
  /* texto corrido (sem tabela): "4.2.1" no começo da linha não é o quadro-resumo */
  pag(18, [it("4.2.1 do Quadro Resumo, sem Termo de Confissão.", 57, 60), it("ASSINATURA", 57, 100), it("sem traços: ASSINATURA: assinada", 57, 120)])
];

test("acha cada \"ASSINATURA: ____\" (item partido ou inteiro, com texto antes) e o 4.2.1 do quadro-resumo", () => {
  const r = R.acharNoContrato(CONTRATO, { campo: { dx: 0, dy: 0 }, valores: { dx: 0, dy: 0 } });
  assert.deepEqual(r.campos.map((c) => c.page), ["3", "3", "8"]);
  /* x = começo dos traços; y = topo da linha (proporção da página) */
  assert.deepEqual(r.campos[0].position, [+(243 / W).toFixed(4), +(437 / H).toFixed(4)]);
  assert.deepEqual(r.campos[1].position, [+((183 + 12 * 255 / 44) / W).toFixed(4), +(556 / H).toFixed(4)]);
  assert.equal(r.campos[2].position[0], +((183 + 22 * 319 / 53) / W).toFixed(4));
  /* visto na coluna cinza (margem + 4 pt), na altura do 4.2.1 */
  assert.deepEqual(r.valores, { page: "3", position: [+(61 / W).toFixed(4), +(140 / H).toFixed(4)] });
  assert.deepEqual(r.avisos, []);
});

test("ajuste do servidor soma nas posições e nada sai de 0–1", () => {
  const r = R.acharNoContrato(CONTRATO, { campo: { dx: 0.01, dy: -0.01 }, valores: { dx: 0, dy: -0.5 } });
  assert.equal(r.campos[0].position[0], +(243 / W + 0.01).toFixed(4));
  assert.equal(r.campos[0].position[1], +(437 / H - 0.01).toFixed(4));
  assert.equal(r.valores.position[1], 0);
});

test("contrato sem campos e sem quadro-resumo: listas vazias e avisos", () => {
  const r = R.acharNoContrato([CONTRATO[3]], null);
  assert.deepEqual(r.campos, []);
  assert.equal(r.valores, null);
  assert.equal(r.avisos.length, 2);
});

test("paginaDoPdfjs: y do pdf.js (de baixo) vira topo da linha (de cima); item vazio some", () => {
  const p = R.paginaDoPdfjs(2, [0, 0, W, H], { items: [{ str: "ASSINATURA:", transform: [11, 0, 0, 11, 183, 400], width: 60, height: 11 }, { str: "", transform: [1, 0, 0, 1, 0, 0] }] });
  assert.deepEqual(p.itens, [{ str: "ASSINATURA:", x: 183, y: H - 400 - 11, w: 60, h: 11 }]);
});

/* ---- servidor ---- */
test("validarRubricas: confere o PDF, o formato e os limites", () => {
  const ok = { nome: "CASA [#abcd1234].pdf", campos: [{ page: 3, position: [0.42345, 0.5] }], valores: { page: "3", position: [0.1, 0.16] } };
  assert.deepEqual(CS.validarRubricas(ok, "CASA [#abcd1234].pdf"),
                   { ok: true, campos: [{ page: "3", position: [0.4235, 0.5] }], valores: { page: "3", position: [0.1, 0.16] } });
  assert.equal(CS.validarRubricas(null, "x").erro, "RUBRICAS_FALTANDO");
  assert.equal(CS.validarRubricas(ok, "CASA [#ffff0000].pdf").erro, "RUBRICAS_DE_OUTRO_PDF");
  for (const ruim of [{ campos: [] }, { campos: [{ page: 0, position: [0.1, 0.1] }] }, { campos: [{ page: 1, position: [1.2, 0.1] }] },
                      { campos: [{ page: 1.5, position: [0.1, 0.1] }] }, { campos: [{ page: 1, position: [0.1] }] },
                      { campos: [{ page: 1, position: [0.1, 0.1] }], valores: { page: 1, position: ["a", 0] } }])
    assert.equal(CS.validarRubricas(Object.assign({ nome: "a.pdf" }, ruim), "a.pdf").erro, "RUBRICAS_INVALIDAS", JSON.stringify(ruim));
  const muitos = { nome: "a.pdf", campos: Array.from({ length: 31 }, () => ({ page: 1, position: [0.1, 0.1] })) };
  assert.equal(CS.validarRubricas(muitos, "a.pdf").erro, "RUBRICAS_INVALIDAS");
});

test("corpo do requisito de rubrica como a documentação v3", () => {
  assert.deepEqual(CS.corpoRubrica("doc1", "sig1", "initials", [{ page: "1", position: [0.85, 0.92] }]), {
    data: { type: "requirements", attributes: { action: "rubricate", kind: "initials", positions: [{ page: "1", position: [0.85, 0.92] }] },
            relationships: { document: { data: { type: "documents", id: "doc1" } }, signer: { data: { type: "signers", id: "sig1" } } } }
  });
});

const DADOS = {
  comprador1: { nome: "Compradora Um Teste", email: "c1@teste.example", cpf: "" },
  comprador2: { nome: "Comprador Dois Teste", email: "c2@teste.example", cpf: "" },
  vendedor: { tipo: "PF", nome: "Vendedor Teste Silva", email: "v@teste.example", cpfCnpj: "" },
  condominio: { fiadores: [{ nome: "Fiador Um Teste", email: "f1@teste.example", cpf: "" }] }
};
const TEST_PF = [{ nome: "Testemunha Um Pf", email: "t1@teste.example" }, { nome: "Testemunha Dois Pf", email: "t2@teste.example" }];

test("signatários: compradores rubricam; fiador só termos; grupos expostos para estender (ex.: cônjuge do fiador)", () => {
  const cfg = CS.montarConfig({ ASSINATURA_TESTEMUNHAS_PF: JSON.stringify(TEST_PF) });
  cfg.comFiadores = true;
  const l = CS.signatarios(DADOS, cfg);
  assert.deepEqual(l.map((s) => [s.origem, !!s.rubrica, !!s.soTermos]), [
    ["comprador1", true, false], ["comprador2", true, false], ["vendedor", false, false],
    ["testemunha", false, false], ["testemunha", false, false], ["fiador1", false, true]]);
  assert.equal(CS.sigCompradores(DADOS).length, 2);
  assert.equal(CS.sigFiadores(DADOS, cfg).length, 1);
});

const DOCS = [{ id: "c", tipo: "contrato" }, { id: "t", tipo: "termo" }, { id: "m", tipo: "memorial" }, { id: "p", tipo: "projeto" }];

test("quem assina cada documento: memorial e projeto só o comprador; fiador só os termos", () => {
  assert.deepEqual(CS.documentosDoSignatario({ rubrica: true }, DOCS), ["c", "t", "m", "p"]);
  assert.deepEqual(CS.documentosDoSignatario({ soTermos: true }, DOCS), ["t"]);
  assert.deepEqual(CS.documentosDoSignatario({ origem: "testemunha" }, DOCS), ["c", "t"]);
});

test("requisitos de rubrica: contrato (assinatura nos campos + visto nos valores), memorial, projeto; só do comprador", () => {
  const rub = { campos: [{ page: "3", position: [0.4, 0.5] }], valores: { page: "3", position: [0.1, 0.16] },
                memorial: { page: "13", position: [0.53, 0.7] }, projeto: CS.posicoesProjeto(null) };
  assert.deepEqual(CS.requisitosRubrica({ rubrica: true }, DOCS, rub), [
    { docId: "c", kind: "manuscript", positions: rub.campos },
    { docId: "c", kind: "initials", positions: [rub.valores] },
    { docId: "m", kind: "manuscript", positions: [rub.memorial] },
    { docId: "p", kind: "initials", positions: rub.projeto }]);
  assert.deepEqual(CS.requisitosRubrica({ origem: "vendedor" }, DOCS, rub), []);
  assert.deepEqual(CS.requisitosRubrica({ rubrica: true }, DOCS, null), []);
  /* termo de pré-reserva / rubricas desligadas: só o contrato, sem rubrica */
  assert.deepEqual(CS.requisitosRubrica({ rubrica: true }, [DOCS[0]], { campos: [], valores: null }), []);
});

test("projeto aprovado: visto nas páginas 1–11 (12 sem carimbo); Propriedade válida substitui, ruim é ignorada", () => {
  const p = CS.posicoesProjeto(null);
  assert.deepEqual(p.map((x) => x.page), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  assert.ok(p.every((x) => x.position[0] > 0.75 && x.position[1] > 0.9 && x.position[1] < 0.98));
  assert.deepEqual(CS.posicoesProjeto([{ page: 1, position: [0.5, 0.5] }]), [{ page: "1", position: [0.5, 0.5] }]);
  assert.equal(CS.posicoesProjeto([{ page: 1, position: [2, 0.5] }]).length, 11);
  p[0].position[0] = 0;   /* cópia: não estraga a tabela */
  assert.notEqual(CS.POSICOES_PROJETO[0].position[0], 0);
});

test("memorial: última página pela contagem do PDF; Propriedade muda posição e página", () => {
  assert.deepEqual(CS.posicaoMemorial(13, null), { page: "13", position: [0.53, 0.7] });
  assert.deepEqual(CS.posicaoMemorial(13, { position: [0.5, 0.75] }), { page: "13", position: [0.5, 0.75] });
  assert.deepEqual(CS.posicaoMemorial(0, { position: [0.5, 0.75], pagina: 12 }), { page: "12", position: [0.5, 0.75] });
  assert.equal(CS.posicaoMemorial(0, null), null);
  assert.equal(CS.contarPaginasPdf("%PDF<</Type /Pages /Kids[]>> <</Type/Page>> <</Type /Page /Parent 1 0 R>>"), 2);
  assert.equal(CS.contarPaginasPdf(""), 0);
});

test("tipo do documento pelo nome na Clicksign; config lê ajustes e o desligamento", () => {
  assert.equal(CS.tipoDoDocumento(CS.nomeDocumentoAdicional("memorial", "RUA A CASA 1 - FULANO")), "memorial");
  assert.equal(CS.tipoDoDocumento(CS.nomeDocumentoAdicional("projeto", "RUA A CASA 1 - FULANO")), "projeto");
  assert.equal(CS.tipoDoDocumento("RUA A CASA 1 - FULANO.pdf"), "contrato");
  assert.equal(CS.tipoDoDocumento("qualquer.pdf", true), "termo");
  const c = CS.montarConfig({ RUBRICAS_AJUSTE: '{"campo":{"dy":-0.02},"valores":{"dx":9}}', ASSINATURA_SEM_RUBRICAS: "sim" });
  assert.deepEqual(c.rubricasAjuste, { campo: { dx: 0, dy: -0.02 }, valores: CS.AJUSTE_PADRAO.valores });
  assert.equal(c.semRubricas, true);
  assert.deepEqual(CS.montarConfig({ MEMORIAL_POSICAO: "{ruim" }).invalidas, ["MEMORIAL_POSICAO"]);
  assert.equal(CS.montarConfig({}).semRubricas, false);
});

/* ---- tela ---- */
const ctx = (x = {}) => Object.assign({ contratoGerado: true, estado: { situacao: "", envelope: false, signatarios: [] }, ocupado: null, testes: false, msg: "" }, x);
function deps(respostas, leitor) {
  const chamadas = [];
  return { chamadas, pageId: "pg1", confirmar: () => true, rubricas: leitor,
           chamar: async (p) => { chamadas.push(p); return respostas[p.action]; } };
}
const LEITOR = { paginasDoPdf: async (b64) => { assert.equal(b64, "QUJD"); return CONTRATO; }, acharNoContrato: R.acharNoContrato };

test("tela: antes de enviar o contrato lê o PDF e manda as rubricas junto", async () => {
  const d = deps({ assinaturaPdf: { ok: true, nome: "C [#abcd1234].pdf", base64: "QUJD", ajuste: CS.AJUSTE_PADRAO },
                   assinaturaEnviar: { ok: true, situacao: "ENVIADO", signatarios: [] } }, LEITOR);
  const c = await A.executarAcaoAssinatura("a-enviar", ctx(), d);
  assert.deepEqual(d.chamadas.map((x) => x.action), ["assinaturaPdf", "assinaturaEnviar"]);
  const rb = d.chamadas[1].rubricas;
  assert.equal(rb.nome, "C [#abcd1234].pdf");
  assert.equal(rb.campos.length, 3);
  assert.equal(rb.valores.page, "3");
  assert.equal(c.estado.situacao, "ENVIADO");
});

test("tela: termo de pré-reserva e rubricas desligadas não mandam rubricas", async () => {
  const d1 = deps({ assinaturaEnviar: { ok: true, situacao: "ENVIADO" } }, LEITOR);
  await A.executarAcaoAssinatura("p-enviar", ctx({ doc: "PRE_RESERVA" }), d1);
  assert.deepEqual(d1.chamadas.map((x) => [x.action, x.doc, x.rubricas]), [["assinaturaEnviar", "PRE_RESERVA", undefined]]);
  const d2 = deps({ assinaturaPdf: { ok: true, semRubricas: true }, assinaturaEnviar: { ok: true, situacao: "ENVIADO" } }, LEITOR);
  await A.executarAcaoAssinatura("a-enviar", ctx(), d2);
  assert.deepEqual(d2.chamadas.map((x) => x.action), ["assinaturaPdf", "assinaturaEnviar"]);
  assert.equal(d2.chamadas[1].rubricas, undefined);
});

test("tela: sem campos no PDF ou leitor quebrado não envia e explica", async () => {
  const vazio = { paginasDoPdf: async () => [CONTRATO[3]], acharNoContrato: R.acharNoContrato };
  const d = deps({ assinaturaPdf: { ok: true, nome: "a.pdf", base64: "QUJD" } }, vazio);
  const c = await A.executarAcaoAssinatura("a-enviar", ctx(), d);
  assert.deepEqual(d.chamadas.map((x) => x.action), ["assinaturaPdf"]);
  assert.match(c.msg, /ASSINATURA: ____/);
  const quebrado = { paginasDoPdf: async () => { throw new Error("sem rede"); }, acharNoContrato: R.acharNoContrato };
  const c2 = await A.executarAcaoAssinatura("a-enviar", ctx(), deps({ assinaturaPdf: { ok: true, nome: "a.pdf", base64: "x" } }, quebrado));
  assert.match(c2.msg, /leitor de PDF/);
  /* resposta sem PDF (erro, casa de rua, servidor antigo): envia sem rubricas e o servidor decide */
  const d3 = deps({ assinaturaPdf: { ok: false, erro: "ACAO_DESCONHECIDA" }, assinaturaEnviar: { ok: false, erro: "RUBRICAS_FALTANDO" } }, LEITOR);
  const c3 = await A.executarAcaoAssinatura("a-enviar", ctx(), d3);
  assert.deepEqual(d3.chamadas.map((x) => [x.action, x.rubricas]), [["assinaturaPdf", undefined], ["assinaturaEnviar", undefined]]);
  assert.match(c3.msg, /recarregue a página/);
});
