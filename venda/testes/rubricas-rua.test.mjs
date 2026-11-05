/* 05/11/2026 (dono): "ver o contrato final, identificar onde o cliente tem que assinar/vistar … e já parametrizar isso
 * para ter todas as assinaturas e vistos necessários" — para a CASA DE RUA (modelos PRONTO e EM CONSTRUÇÃO).
 * Páginas montadas à mão no formato de RubricasVenda.paginaDoPdfjs, com o texto dos modelos de rua:
 *  - ciência 6.6 (PRONTO): "CIÊNCIA EXPRESSA DO COMPRADOR:" e, abaixo, só o traço (+ nomes, CPF, COMPRADOR);
 *  - ciência 10.8: PRONTO com "Assinatura: ____" (minúsculo); CONSTRUÇÃO só com o traço;
 *  - valores: "6.1. Valor total" na coluna da direita do quadro, com o título "6. DO VALOR PAGO…" na mesma altura à esquerda;
 *  - bloco de assinaturas migrado: uma linha por pessoa (vendedor PF ou PJ/representante, comprador 1 e 2, corretor,
 *    testemunhas). Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const R = req("../RubricasVenda.js");
const CS = req("../ClicksignVenda.js");
const C = req("../ContratoVenda.js");
const A = req("../assinatura-ui.js");

const W = 595, H = 842;
const it = (str, x, y, w = str.length * 5, h = 11) => ({ str, x, y, w, h });
const pag = (numero, itens) => ({ numero, largura: W, altura: H, itens });
const px = (v) => +(v / W).toFixed(4), py = (v) => +(v / H).toFixed(4);
const TRACO_CIENCIA = "__________________________________________";

/* quadro-resumo da rua: item 6 (valores + ciência 6.6) e item 10 (ciência 10.8); corpo com a cláusula 6.1 (texto corrido) */
const ITEM6 = (com66 = true) => pag(2, [
  it("6. DO VALOR PAGO", 62, 100, 80), it("6.1. Valor total: R$ 300.000,00 (trezentos mil reais)", 183, 100, 260),
  it("EXCLUSIVAMENTE", 62, 114, 80), it("a) Sinal/arras: R$ 10.000,00, pago em 01/10/2026", 183, 114, 240),
  it("PARA AQUISIÇÃO", 62, 128, 80), it("b) Entrada: R$ 20.000,00, vencimento em 15/10/2026", 183, 128, 250),
  it("c) Parcela Intermediária: não há.", 183, 142, 160),
  it("d) Meio de pagamento: PIX", 183, 156),
  /* PRONTO: ciência 6.6 com traço; EM CONSTRUÇÃO não tem a 6.6 */
  ...(com66 ? [it("6.6. O COMPRADOR declara ciência de que o valor restituído poderá ser inferior", 183, 380, 280),
               it("CIÊNCIA EXPRESSA DO COMPRADOR:", 183, 400, 170), it(TRACO_CIENCIA, 183, 440, 210),
               it("COMPRADOR UM TESTE / COMPRADOR DOIS TESTE", 200, 455), it("CPF: 000.000.001-91 / 000.000.002-72", 205, 470), it("COMPRADOR", 260, 485)] : []),
  it("7. DA CORREÇÃO", 62, 520, 80), it("7.1. As parcelas do preço serão corrigidas pelo IGP-M.", 183, 520, 260)
]);
const ITEM10_PRONTO = pag(3, [
  it("10.8. O COMPRADOR declara ciência expressa das hipóteses de inadimplemento", 183, 200, 280),
  it("CIÊNCIA EXPRESSA DO COMPRADOR:", 183, 214, 170),
  it("Assinatura: ___________________________", 183, 228, 200)
]);
const ITEM10_CONSTRUCAO = pag(3, [
  it("10.8. O COMPRADOR declara ciência expressa das hipóteses de inadimplemento", 183, 200, 280),
  it("CIÊNCIA EXPRESSA DO COMPRADOR:", 183, 214, 170),
  it(TRACO_CIENCIA, 183, 254, 210),
  it("COMPRADOR UM TESTE", 220, 269), it("CPF: 000.000.001-91", 230, 284), it("COMPRADOR", 260, 299)
]);
const CORPO = pag(7, [it("6.1. A transferência da propriedade do IMÓVEL somente se aperfeiçoará com a escritura", 57, 80, 420),
                      /* traço solto no corpo, sem CIÊNCIA acima: não é campo */
                      it("Texto qualquer do corpo.", 57, 300), it(TRACO_CIENCIA, 57, 400, 210)]);
const PRONTO = [pag(1, [it("INSTRUMENTO PARTICULAR DE PROMESSA DE COMPRA E VENDA – PRONTO", 120, 60, 360)]), ITEM6(), ITEM10_PRONTO, CORPO];
const CONSTRUCAO = [pag(1, [it("INSTRUMENTO PARTICULAR – EM CONSTRUÇÃO", 150, 60, 260)]), ITEM6(false), ITEM10_CONSTRUCAO, CORPO];

test("rua PRONTO: ciência por traço (6.6) e \"Assinatura: ____\" minúsculo (10.8) viram campos; visto dos valores no 6.1", () => {
  const r = R.acharNoContrato(PRONTO, null);
  assert.deepEqual(r.campos.map((c) => c.page), ["2", "3"]);
  /* 6.6: começo do traço, ponto do visto 25 pt acima da linha de base (como o campo "ASSINATURA: ____") */
  assert.deepEqual(r.campos[0].position, [px(183), py(440 + 11 - 25)]);
  /* 10.8: o traço vem depois de "Assinatura: " — à direita do começo do item, na altura dele; um campo só */
  assert.equal(r.campos[1].position[1], py(228 + 11 - 25));
  assert.ok(r.campos[1].position[0] > px(183 + 40) && r.campos[1].position[0] < px(183 + 200), String(r.campos[1].position[0]));
  /* 6.1 na coluna da direita; à esquerda, o título "6. DO VALOR PAGO / EXCLUSIVAMENTE / PARA AQUISIÇÃO" ocupa 3 linhas: o visto
     vai na coluna da esquerda (margem + 4 pt) da primeira linha livre (a do "c)"), 22 pt acima da base */
  assert.deepEqual(r.valores, { page: "2", position: [px(57 + 4), py(142 + 11 - 22)] });
  assert.deepEqual(r.avisos, []);
});

test("rua EM CONSTRUÇÃO: só a ciência 10.8, por traço; o traço solto do corpo e a cláusula 6.1 do corpo não contam", () => {
  const r = R.acharNoContrato(CONSTRUCAO, null);
  assert.deepEqual(r.campos, [{ page: "3", position: [px(183), py(254 + 11 - 25)] }]);
  assert.equal(r.valores.page, "2");
  assert.deepEqual(r.avisos, []);
});

test("rua: 6.1 com a coluna da esquerda livre vai na altura do próprio 6.1; sem linha livre até o item 7, aviso e sem visto", () => {
  const livre = pag(2, [it("6.1. Valor total: R$ 300.000,00", 183, 100, 160), it("a) Sinal", 183, 114)]);
  assert.deepEqual(R.acharNoContrato([livre, CORPO], null).valores, { page: "2", position: [px(57 + 4), py(100 + 11 - 22)] });
  const cheio = pag(2, [it("6. DO VALOR", 62, 100, 60), it("6.1. Valor total: R$ 300.000,00", 183, 100, 160),
                        it("PAGO", 62, 114, 30), it("a) Sinal", 183, 114), it("7. DA CORREÇÃO", 62, 128, 80), it("7.1. texto", 183, 128),
                        it("MONETÁRIA", 62, 142, 60)]);
  const r = R.acharNoContrato([cheio, CORPO], null);
  assert.equal(r.valores, null);
  assert.ok(r.avisos.includes("item 6.1 do quadro-resumo sem espaço livre na coluna da esquerda"), JSON.stringify(r.avisos));
});

/* condomínio: nada muda — o 4.2.1 continua mandando (mesmo com um "6.1. Valor total" numa tabela) e "ASSINATURA: ____" não
   vira dois campos quando vem logo abaixo de "CIÊNCIA EXPRESSA" */
const CONDOMINIO = [
  pag(1, [it("CONTRATO DE COMPRA E VENDA", 200, 60), it("1. PARTES", 60, 90)]),
  pag(3, [it("4.2.1. ENTRADA: parcelamento direto com a VENDEDORA.", 183, 140),
          it("CIÊNCIA EXPRESSA E ESPECÍFICA DO COMPRADOR", 183, 392),
          it("ASSINATURA: ", 183, 437, 60), it("_______________________________]", 243, 437, 195),
          it("ASSINATURA: _______________________________]", 183, 556, 255)]),
  pag(5, [it("6.1. Valor total da obra: R$ 1,00", 183, 100, 160)]),
  pag(18, [it("4.2.1 do Quadro Resumo, sem Termo de Confissão.", 57, 60)])
];
test("condomínio não muda: 4.2.1 manda nos valores e a ciência com \"ASSINATURA:\" é um campo só", () => {
  const r = R.acharNoContrato(CONDOMINIO, null);
  assert.deepEqual(r.campos.map((c) => [c.page, c.position[1]]), [["3", py(437 + 11 - 25)], ["3", py(556 + 11 - 25)]]);
  assert.deepEqual(r.valores, { page: "3", position: [px(61), py(140 + 11 - 22)] });
  assert.deepEqual(r.avisos, []);
  /* sem 4.2.1 e sem 6.1: o aviso de sempre */
  assert.deepEqual(R.acharNoContrato([CONDOMINIO[3]], null).avisos, ["nenhum campo \"ASSINATURA: ____\" achado no contrato", "item 4.2.1 do quadro-resumo não achado"]);
});

/* ---- uma linha por pessoa no bloco migrado da rua ---- */
const T1 = { nome: "Testemunha Um Spe", email: "t1@teste.example", cpf: "52998224725" };
const T2 = { nome: "Testemunha Dois Spe", email: "t2@teste.example", cpf: "" };
const CONFIG = Object.assign(CS.montarConfig({ ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify([T1, T2]), ASSINATURA_TESTEMUNHAS_PF: JSON.stringify([T1, T2]) }),
                             { incluirCorretor: true });
function dadosRua({ pf = false, c2 = true } = {}) {
  const d = C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADORA UM TESTE", CPF: "935.411.347-80", COMPRADOR1: { email: "c1@teste.example" },
             COMPRADOR2: c2 ? { nome: "COMPRADOR DOIS TESTE", cpf: "111.444.777-35", email: "c2@teste.example" } : { nome: "" },
             VALOR_CONTRATO: 300000, COMISSAO: 9000, CORRETOR: "Corretor Teste" },
    obra: {}, vendedor: pf ? { tipo: "PF", nome: "VENDEDOR PF TESTE", cpfCnpj: "529.982.247-25", email: "v@teste.example" }
                           : { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", representanteNome: "REPRESENTANTE TESTE",
                               representanteCpf: "246.813.579-28", representanteEmail: "rep@teste.example" },
    loteamento: {}, corretor: { nome: "Corretor Teste", creci: "40167", cpfCnpj: "00.000.000/0002-72", email: "corretor@teste.example" },
    hojeISO: "2026-11-05",
  });
  assert.ok(!d.condominio, "casa de rua");
  return d;
}
/* as linhas do bloco, uma por linha do PDF (centralizadas), a partir de y0; quebra de página em `quebra` linhas */
function paginas(linhas, { quebra = 999, primeira = 9, antes = [] } = {}) {
  const pgs = [], novo = (n) => ({ numero: n, largura: W, altura: H, itens: [] });
  let atual = novo(primeira), y = 60, n = 0;
  for (const a of antes) { atual.itens.push(it(a, 57, y)); y += 15; }
  for (const l of linhas) {
    if (n++ === quebra) { pgs.push(atual); atual = novo(atual.numero + 1); y = 60; }
    if (l) atual.itens.push(it(l, 297 - (l.length * 5) / 2, y, l.length * 5));
    y += 15;
  }
  pgs.push(atual);
  return pgs;
}
const porPessoa = (lista, linhas) => { const r = CS.atribuirLinhas(lista, linhas, CS.DOC.CONTRATO); return lista.map((s, i) => [s.papel, r[i].length]); };

test("rua migrada, vendedor PJ: rótulo VENDEDOR vale; representante, comprador 1, comprador 2, corretor e testemunhas — cada um na sua linha", () => {
  const d = dadosRua(), lista = CS.signatarios(d, CONFIG);
  const bloco = CS.blocoAssinaturas(d, CONFIG, "CONTRATO").split("\n");
  assert.deepEqual(bloco.filter((x) => /^[A-Z\/ 12]+$/.test(x)), ["VENDEDOR", "COMPRADOR", "COMPRADOR", "INTERMEDIADOR/CORRETOR", "TESTEMUNHA 1", "TESTEMUNHA 2"]);
  /* sem título ASSINATURAS (a rua não tem): a página vale por VENDEDOR + COMPRADOR */
  const l = R.acharLinhas(paginas(bloco));
  assert.equal(l.length, 6);
  assert.deepEqual(porPessoa(lista, l), [["Comprador 1", 1], ["Comprador 2", 1], ["Vendedor (representante)", 1],
                                         ["Testemunha 1", 1], ["Testemunha 2", 1], ["Corretor", 1]]);
  /* quadro-resumo que vira a página: a continuação (corretor e testemunhas) também é lida */
  const q = R.acharLinhas(paginas(bloco, { quebra: 14 }));
  assert.deepEqual(q.map((x) => x.page), ["9", "9", "9", "10", "10", "10"]);
  assert.ok(porPessoa(lista, q).every(([, n]) => n === 1), JSON.stringify(porPessoa(lista, q)));
});

test("rua migrada, vendedor PF e um comprador só", () => {
  const d = dadosRua({ pf: true, c2: false }), lista = CS.signatarios(d, CONFIG);
  const l = R.acharLinhas(paginas(CS.blocoAssinaturas(d, CONFIG, "CONTRATO").split("\n")));
  assert.deepEqual(porPessoa(lista, l), [["Comprador 1", 1], ["Vendedor", 1], ["Testemunha 1", 1], ["Testemunha 2", 1], ["Corretor", 1]]);
});

test("rua com o bloco antigo (sem migrar): compradores numa linha só não vão para ninguém; testemunhas sem traço ficam sem linha", () => {
  const d = dadosRua(), lista = CS.signatarios(d, CONFIG);
  const antigo = ["______________________________________", "SPE TESTE LTDA", "CNPJ: 00.000.000/0001-91", "VENDEDOR", "",
                  "____________________________________", "Nome: COMPRADORA UM TESTE / COMPRADOR DOIS TESTE", "CPF: 935.411.347-80 / 111.444.777-35", "COMPRADOR", "",
                  "_____________________________________", "Nome: Corretor Teste", "CPF: 00.000.000/0002-72", "INTERMEDIADOR", "",
                  "TESTEMUNHAS:", "1.  Nome:                                     2. Nome:", "CPF:                    CPF:"];
  const l = R.acharLinhas(paginas(antigo));
  assert.equal(l.length, 3);
  /* o vendedor PJ do bloco antigo não traz o nome do representante: vai pelo papel VENDEDOR */
  assert.deepEqual(porPessoa(lista, l), [["Comprador 1", 0], ["Comprador 2", 0], ["Vendedor (representante)", 1],
                                         ["Testemunha 1", 0], ["Testemunha 2", 0], ["Corretor", 1]]);
});

test("rua: o traço da ciência 6.6 (com COMPRADOR embaixo) nunca vira linha de assinatura, nem na página do bloco", () => {
  const d = dadosRua({ c2: false });
  const bloco = CS.blocoAssinaturas(d, CONFIG, "CONTRATO").split("\n");
  const ciencia = ["CIÊNCIA EXPRESSA DO COMPRADOR:", "", "", TRACO_CIENCIA, "COMPRADORA UM TESTE", "CPF: 935.411.347-80", "COMPRADOR", ""];
  const pgs = paginas(ciencia.concat(bloco));
  const l = R.acharLinhas(pgs);
  assert.equal(l.length, 5, JSON.stringify(l.map((x) => x.texto)));
  assert.ok(!l.some((x) => x.position[1] === py(60 + 3 * 15 + 11 - 27)), "a linha da ciência entrou");
  /* e é campo de visto */
  assert.deepEqual(R.acharNoContrato(pgs, null).campos.map((c) => c.position[1]), [py(60 + 3 * 15 + 11 - 25)]);
  /* duas páginas seguidas: a da ciência (só COMPRADOR) e a do bloco — a da ciência também não dá linha */
  const duas = paginas(ciencia.concat(bloco), { quebra: ciencia.length });
  assert.equal(R.acharLinhas(duas).length, 5);
});

/* ---- servidor (ClicksignVenda) ---- */
test("validarRubricas: a rua (camposOpcionais) aceita a leitura sem campo; o condomínio continua barrando", () => {
  const sem = { nome: "C [#abcd1234].pdf", campos: [], valores: null };
  assert.equal(CS.validarRubricas(sem, "C [#abcd1234].pdf").erro, "RUBRICAS_INVALIDAS");
  assert.equal(CS.validarRubricas(sem, "C [#abcd1234].pdf", { linhas: true }).erro, "RUBRICAS_INVALIDAS");
  const ok = CS.validarRubricas(sem, "C [#abcd1234].pdf", { linhas: true, camposOpcionais: true });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.campos, []);
  /* o resto da conferência continua: outro PDF, posição fora da página, muitos campos */
  assert.equal(CS.validarRubricas(sem, "OUTRO [#00000000].pdf", { camposOpcionais: true }).erro, "RUBRICAS_DE_OUTRO_PDF");
  assert.equal(CS.validarRubricas({ nome: "a.pdf", campos: [{ page: 1, position: [1.5, 0.1] }] }, "a.pdf", { camposOpcionais: true }).erro, "RUBRICAS_INVALIDAS");
});

test("requisitos da rua: compradores vistam as ciências e o 6.1 lado a lado e assinam na própria linha; vendedor, corretor e testemunhas só a linha", () => {
  const d = dadosRua(), lista = CS.signatarios(d, CONFIG);
  const ach = R.acharNoContrato(PRONTO, null);
  const linhas = R.acharLinhas(paginas(CS.blocoAssinaturas(d, CONFIG, "CONTRATO").split("\n")));
  const rub = { campos: ach.campos, valores: ach.valores, linhas, termos: {}, tamanhos: {} };
  const docs = [{ id: "c", tipo: CS.DOC.CONTRATO }];
  const reqs = lista.map((s, i) => CS.requisitosRubrica(s, docs, rub, i, lista, []).map((r) => [r.kind, r.positions.length]));
  assert.deepEqual(reqs, [
    [["manuscript", 1], ["initials", 3]],   /* comprador 1: linha + 2 ciências + valores */
    [["manuscript", 1], ["initials", 3]],   /* comprador 2 */
    [["manuscript", 1]], [["manuscript", 1]], [["manuscript", 1]], [["manuscript", 1]]]);
  /* comprador 2 fica à direita do comprador 1 no mesmo campo (fila compacta) */
  const v1 = CS.requisitosRubrica(lista[0], docs, rub, 0, lista, [])[1].positions[0], v2 = CS.requisitosRubrica(lista[1], docs, rub, 1, lista, [])[1].positions[0];
  assert.equal(v1.position[1], v2.position[1]);
  assert.ok(v2.position[0] > v1.position[0]);
});

/* ---- tela ---- */
const ctx = (x = {}) => Object.assign({ contratoGerado: true, estado: { situacao: "", envelope: false, signatarios: [] }, ocupado: null, testes: false, msg: "" }, x);
function deps(respostas, leitor) {
  const chamadas = [];
  return { chamadas, pageId: "pg1", confirmar: () => true, rubricas: leitor,
           chamar: async (p) => { chamadas.push(p); return respostas[p.action]; } };
}
test("tela: casa de rua (rua: true) lê o PDF e manda as posições; sem campo achado não barra (vai com o aviso)", async () => {
  const leitor = { paginasDoPdf: async () => PRONTO, acharNoContrato: R.acharNoContrato, acharLinhas: R.acharLinhas };
  const d = deps({ assinaturaPdf: { ok: true, rua: true, nome: "C [#abcd1234].pdf", base64: "QUJD", ajuste: CS.AJUSTE_PADRAO, linhas: true },
                   assinaturaEnviar: { ok: true, situacao: "ENVIADO", signatarios: [] } }, leitor);
  await A.executarAcaoAssinatura("a-enviar", ctx(), d);
  const rb = d.chamadas[1].rubricas;
  assert.equal(rb.campos.length, 2);
  assert.equal(rb.valores.page, "2");
  assert.ok(Array.isArray(rb.linhas));
  /* contrato de rua sem campo de ciência: segue com o aviso */
  const vazio = { paginasDoPdf: async () => [CORPO], acharNoContrato: R.acharNoContrato };
  const d2 = deps({ assinaturaPdf: { ok: true, rua: true, nome: "a.pdf", base64: "QUJD" }, assinaturaEnviar: { ok: true, situacao: "ENVIADO", signatarios: [] } }, vazio);
  await A.executarAcaoAssinatura("a-enviar", ctx(), d2);
  assert.deepEqual(d2.chamadas.map((x) => x.action), ["assinaturaPdf", "assinaturaEnviar"]);
  assert.deepEqual(d2.chamadas[1].rubricas.campos, []);
  assert.ok(d2.chamadas[1].rubricas.avisos.some((a) => /nenhum campo/.test(a)));
  /* condomínio (sem rua): o mesmo PDF sem campo continua barrado na tela */
  const d3 = deps({ assinaturaPdf: { ok: true, nome: "a.pdf", base64: "QUJD" } }, vazio);
  const c3 = await A.executarAcaoAssinatura("a-enviar", ctx(), d3);
  assert.deepEqual(d3.chamadas.map((x) => x.action), ["assinaturaPdf"]);
  assert.match(c3.msg, /ASSINATURA: ____/);
});
