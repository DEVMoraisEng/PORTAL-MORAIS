/* 01/11/2026 — teste real no sandbox (código da main, ASSINATURA_LINHAS=1, condomínio unidade 3, modelo ANTIGO): medido no
 * PDF assinado (pdf.js, pontos, y de cima, página de 842). Faltaram a TESTEMUNHA 2 (segunda coluna, lado a lado) na pág. 31
 * e o bloco do quadro-resumo inteiro, que virou da pág. 16 (vendedora no pé) para a 17. As coordenadas abaixo são as
 * medidas; os textos são inventados (o repositório é público). */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const R = req("../RubricasVenda.js");
const CS = req("../ClicksignVenda.js");

const W = 595, H = 842, C = 5.5;   /* largura de um caractere (11 pt) */
const it = (str, x, y) => ({ str, x, y, w: str.length * C, h: 11 });
const traco = (n, x, y) => it("_".repeat(n), x, y);
const pag = (numero, itens) => ({ numero, largura: W, altura: H, itens });

/* quem assinou no sandbox: comprador 1, vendedor (representante), testemunhas 1 e 2 — o corretor não assinava */
const LISTA = [
  { papel: "Comprador 1", role: "buyer", nome: "TESTE CTO CASO UM SILVA", origem: "comprador1", rubrica: true },
  { papel: "Vendedor (representante)", role: "seller", nome: "REPRESENTANTE SANDBOX TESTE", origem: "representante" },
  { papel: "Testemunha 1", role: "witness", nome: "Testemunha Um Teste", origem: "testemunha" },
  { papel: "Testemunha 2", role: "witness", nome: "Testemunha Dois Teste", origem: "testemunha" }];
const ZERO = { linha: { dx: 0, dy: 0 } };
/* calibração 01/11: o topo pedido fica 46 pt acima da linha de base; nos itens de 11 pt daqui: y do traço = topo + 46 − 11 */
const xy = (l) => [Math.round(l.position[0] * W), Math.round(l.position[1] * H + 27 - 11)];   /* calibração u22: 27 pt acima da base */

const PAG31 = pag(31, [
  it("ASSINATURAS", 250, 300), it("E, por estarem assim justos e contratados, assinam com 2 (duas) testemunhas.", 57, 320),
  traco(47, 168, 425), it("EMPRESA SANDBOX SPE LTDA.", 200, 440), it("CNPJ nº 00.000.000/0001-00", 200, 455), it("VENDEDORA", 250, 470),
  traco(47, 168, 514), it("Nome: TESTE CTO CASO UM SILVA – CPF: 000.000.000-00", 170, 529), it("COMPRADOR", 255, 544),
  traco(31, 92, 645), traco(31, 333, 645),
  it("TESTEMUNHA 1", 132, 660), it("TESTEMUNHA 2", 373, 660),
  it("Nome:", 92, 675), it("Nome:", 333, 675), it("CPF:", 92, 690), it("CPF:", 333, 690)]);

test("sandbox, pág. 31: as duas testemunhas lado a lado viram DUAS linhas, cada uma com o próprio rótulo", () => {
  const l = R.acharLinhas([PAG31], ZERO);
  assert.deepEqual(l.map(xy), [[168, 425], [168, 514], [92, 645], [333, 645]]);
  assert.match(l[2].texto, /^TESTEMUNHA 1\b/);
  assert.ok(!/TESTEMUNHA 2/.test(l[2].texto), l[2].texto);
  assert.match(l[3].texto, /^TESTEMUNHA 2\b/);
  const r = CS.atribuirLinhas(LISTA, l, "contrato");
  assert.deepEqual(r.map((x) => x.map((p) => Math.round(p.position[0] * W))), [[168], [168], [92], [333]]);
});

/* quadro-resumo: data e vendedora no pé da pág. 16; comprador, corretor e testemunhas no topo da 17. O nome e o papel saem
   na mesma altura (papel à direita, x≈395), fora da largura do traço. Na 16 há também a ciência "ASSINATURA: ____". */
const PAG16 = pag(16, [
  it("CIÊNCIA EXPRESSA E ESPECÍFICA DO COMPRADOR", 183, 230), it("ASSINATURA: _______________________________]", 183, 248),
  it("Goiânia, 01 de novembro de 2026.", 78, 700),
  traco(47, 78, 758), it("EMPRESA SANDBOX SPE", 78, 770), it("VENDEDORA", 396, 770)]);
const PAG17 = pag(17, [
  traco(47, 62, 66), it("Nome: TESTE CTO CASO UM SILVA", 62, 78), it("COMPRADOR", 395, 78),
  traco(47, 192, 130), it("Nome: CORRETOR SANDBOX TESTE", 192, 142), it("INTERMEDIADOR/CORRETOR", 395, 142),
  traco(31, 107, 205), traco(31, 348, 205), it("TESTEMUNHA 1", 140, 218), it("TESTEMUNHA 2", 380, 218),
  it("Nome:", 107, 230), it("Nome:", 348, 230), it("CPF:", 107, 242), it("CPF:", 348, 242),
  it("CLÁUSULAS E CONDIÇÕES GERAIS DO INSTRUMENTO PARTICULAR", 100, 300)]);

test("sandbox, quadro-resumo que vira da pág. 16 para a 17: as duas páginas contam e cada um acha a sua linha", () => {
  const l = R.acharLinhas([pag(15, [it("texto do quadro-resumo", 57, 100)]), PAG16, PAG17], ZERO);
  assert.deepEqual(l.map((x) => [x.page, ...xy(x)]), [["16", 78, 758], ["17", 62, 66], ["17", 192, 130], ["17", 107, 205], ["17", 348, 205]]);
  assert.match(l[0].texto, /VENDEDORA/, "o papel na mesma altura, à direita, entra no texto da linha");
  const r = CS.atribuirLinhas(LISTA, l, "contrato");
  assert.deepEqual(r.map((x) => x.map((p) => p.page + "@" + Math.round(p.position[0] * W))), [["17@62"], ["16@78"], ["17@107"], ["17@348"]],
    "comprador, vendedora, testemunhas 1 e 2 (o corretor não assina: a linha dele não vai para ninguém)");
});

test("sandbox: a página da vendedora sozinha (sem a 17 de comprador) continua de fora — e uma página solta com papel também", () => {
  assert.deepEqual(R.acharLinhas([PAG16], ZERO), []);
  assert.deepEqual(R.acharLinhas([PAG17], ZERO), []);
});

/* ---- correção 3 ---- */
test("correção 3 (1): o corretor assina SÓ o contrato — nem os termos de confissão (nem a linha dele no termo)", () => {
  const corretor = { papel: "Corretor", role: "real_estate_broker", nome: "Corretor Sandbox Teste", origem: "corretor" };
  const docs = [{ id: "c", tipo: "contrato" }, { id: "t", tipo: "termo" }, { id: "m", tipo: "memorial" }];
  assert.deepEqual(CS.documentosDoSignatario(corretor, docs), ["c"]);
  assert.deepEqual(CS.documentosDoSignatario(LISTA[1], docs), ["c", "t", "m"], "a vendedora: todos (dono, 01/11/2026)");
  const l = [{ page: "3", position: [0.1, 0.5], texto: "Nome: Corretor Sandbox Teste\nINTERMEDIADOR/CORRETOR" }];
  assert.deepEqual(CS.atribuirLinhas(LISTA.concat([corretor]), l, "termo")[4], []);
  assert.equal(CS.atribuirLinhas(LISTA.concat([corretor]), l, "contrato")[4].length, 1);
});

/* exemplo da revisão: vendedora PJ assina pelo representante (nome dele não está impresso); o nome do comprador está na
   coluna do lado, na mesma altura, e a linha da vendedora é a única traçada naquela altura (lê a linha de baixo inteira) */
test("correção 3 (5): leitura da linha inteira nunca dá a linha a outra pessoa — dois papéis ou vendedora com nome de comprador = ninguém", () => {
  const pg = pag(16, [
    it("Goiânia, 01 de novembro de 2026.", 78, 40),
    traco(40, 330, 88),
    traco(40, 78, 100),
    it("EMPRESA SANDBOX SPE", 78, 112), it("Nome: TESTE CTO CASO UM SILVA", 330, 112),
    it("VENDEDORA", 78, 124), it("COMPRADOR", 330, 124)]);
  const l = R.acharLinhas([pg], ZERO);
  assert.ok(l.length >= 1, JSON.stringify(l));
  const r = CS.atribuirLinhas(LISTA, l, "contrato");
  assert.deepEqual(r[0], [], "o comprador não fica com a linha da vendedora");
  assert.deepEqual(r[1], [], "dois papéis na mesma leitura: ninguém (melhor sem assinatura do que na errada)");
  /* papel VENDEDORA com o nome de um comprador: nunca vai para o comprador */
  const so = [{ page: "1", position: [0.1, 0.1], texto: "EMPRESA SANDBOX SPE Nome: TESTE CTO CASO UM SILVA\nVENDEDORA" }];
  assert.deepEqual(CS.atribuirLinhas(LISTA, so, "contrato").map((x) => x.length), [0, 0, 0, 0]);
  /* o bloco novo (um papel por linha, cônjuge incluído) continua indo para cada um */
  const cj = { papel: "Cônjuge do comprador 1", role: "buyer", nome: "CONJUGE SANDBOX TESTE", origem: "conjugeComprador1" };
  const novo = [{ page: "1", position: [0.1, 0.2], texto: "Nome: CONJUGE SANDBOX TESTE\nCPF: 1\nCÔNJUGE DO COMPRADOR" }];
  assert.equal(CS.atribuirLinhas(LISTA.concat([cj]), novo, "contrato")[4].length, 1);
});

/* ---- calibração 01/11 (sandbox, modelos migrados, 2 compradores + 2 fiadores): a imagem da assinatura (100×50 pt) saía de
   linha−34 a linha+16, cobrindo o "Nome:" de baixo; nos campos de ciência os dois compradores caíam no MESMO ponto.
   Agora: o pé da imagem 4 pt abaixo da linha (topo = linha − 46), e quem divide o mesmo ponto fica lado a lado. ---- */
const base = (str, x, linhaBase) => it(str, x, linhaBase - 11);   /* item cuja linha de base (baseline) é a medida */
const topo = (pos) => Math.round(pos.position[1] * H);
test("calibração (substituída pela u22): linha com base em 80 → ponto em 53 (27 pt acima)", () => {
  const pg = pag(18, [base("VENDEDORA", 250, 20), base("COMPRADOR", 250, 30), traco(47, 226, 69), base("Nome: EMPRESA", 226, 94), base("VENDEDORA", 226, 108)]);
  for (const aj of [undefined, CS.AJUSTE_PADRAO]) {
    const l = R.acharLinhas([pg], aj);
    assert.equal(l.length, 1);
    assert.equal(topo(l[0]), 80 - 27, JSON.stringify(aj));
    assert.equal(Math.round(l[0].position[0] * W), 226);
  }
});
test("calibração (substituída pela u22): campo de ciência com base em 416 → ponto do visto em 391 (25 pt acima)", () => {
  const pg = pag(5, [base("CIÊNCIA EXPRESSA DO COMPRADOR", 183, 380), base("ASSINATURA: _______________________________]", 183, 416)]);
  const r = R.acharNoContrato([pg], CS.AJUSTE_PADRAO);
  assert.equal(topo(r.campos[0]), 416 - 25);
});

const C1 = { papel: "Comprador 1", role: "buyer", nome: "COMPRADOR UM TESTE", origem: "comprador1", rubrica: true };
const C2 = { papel: "Comprador 2", role: "buyer", nome: "COMPRADOR DOIS TESTE", origem: "comprador2", rubrica: true };
const VEND = { papel: "Vendedor (representante)", role: "seller", nome: "REPRESENTANTE TESTE", origem: "representante" };
const CJ = { papel: "Cônjuge do comprador 1", role: "buyer", nome: "CONJUGE TESTE", origem: "conjugeComprador1", rubrica: true };
const FI = { papel: "Fiador 1", role: "guarantor", nome: "FIADOR TESTE", origem: "fiador1", soTermos: true };
const TE = { papel: "Testemunha 1", role: "witness", nome: "TESTEMUNHA TESTE", origem: "testemunha" };
const CO = { papel: "Corretor", role: "real_estate_broker", nome: "CORRETOR TESTE", origem: "corretor" };
const DOCS = [{ id: "c", tipo: "contrato" }, { id: "t", tipo: "termo", nome: "T.pdf" }, { id: "m", tipo: "memorial" }, { id: "p", tipo: "projeto" }];
const LISTA2 = [C1, CJ, C2, VEND, TE, CO, FI];
const pt = (p, Wp = W) => Math.round(p.position[0] * Wp);

test("dono 01/11: compradores e vendedor assinam EXATAMENTE os mesmos documentos (contrato, termos, memorial, projeto); os outros não mudam", () => {
  const de = (s) => CS.documentosDoSignatario(s, DOCS);
  assert.deepEqual(de(C1), ["c", "t", "m", "p"]);
  assert.deepEqual(de(C2), de(C1));
  assert.deepEqual(de(VEND), de(C1));
  assert.deepEqual(de(CJ), de(C1), "cônjuge: tudo que o comprador 1 assina (dono, 01/11/2026)");
  assert.deepEqual(de(TE), ["c", "t"]);
  assert.deepEqual(de(CO), ["c"]);
  assert.deepEqual(de(FI), ["t"]);
});

test("dono 01/11: campo perto da margem direita — os vistos que não cabem vão para a fila de BAIXO (+22 pt), nunca para cima", () => {
  const rub = { campos: [{ page: "5", position: [520 / W, 370 / H] }], valores: null, memorial: null, projeto: [], linhas: [], termos: {} };
  const ps = [C1, CJ, C2].map((s) => CS.requisitosRubrica(s, DOCS, rub, LISTA2.indexOf(s), LISTA2)[0].positions[0]);
  assert.deepEqual(ps.map((p) => [Math.round(p.position[0] * W), topo(p)]), [[520, 370], [520, 392], [520, 414]]);
});

test("calibração: memorial e projeto — compradores e vendedor em pontos diferentes (nada empilhado)", () => {
  const rub = { campos: [], valores: null, memorial: { page: "13", position: [0.53, 0.7] }, projeto: CS.posicoesProjeto(), linhas: [], termos: {} };
  const todos = [C1, CJ, C2, VEND].map((s) => CS.requisitosRubrica(s, DOCS, rub, LISTA2.indexOf(s), LISTA2));
  const mem = todos.map((l) => l.find((r) => r.docId === "m").positions[0]);
  assert.equal(new Set(mem.map((p) => p.position.join(","))).size, 4, JSON.stringify(mem));
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const dx = Math.abs(mem[a].position[0] - mem[b].position[0]) * W, dy = Math.abs(mem[a].position[1] - mem[b].position[1]) * H;
    assert.ok(dx >= 100 || dy >= 50, "memorial " + a + "×" + b + " sobrepõe");
  }
  const proj = todos.map((l) => l.find((r) => r.docId === "p").positions);
  assert.equal(proj[0].length, 11);
  for (let i = 0; i < 11; i++) assert.equal(new Set(proj.map((ps) => ps[i].position.join(","))).size, 4, "projeto pág. " + (i + 1));
  /* testemunha, corretor e fiador não entram no memorial/projeto */
  for (const s of [TE, CO, FI]) assert.ok(!CS.requisitosRubrica(s, DOCS, rub, LISTA2.indexOf(s), LISTA2).some((r) => r.docId === "m" || r.docId === "p"), s.papel);
});

/* ---- revisão do 43166e2 ---- */
const MEM = { page: "13", position: [0.53, 0.7] };
const LETTER = { W: 612, H: 792 }, A2 = { W: 1684, H: 1191 };
const naoSobrepoe = (ps, pg) => { for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
  const dx = Math.abs(ps[a].position[0] - ps[b].position[0]) * pg.W, dy = Math.abs(ps[a].position[1] - ps[b].position[1]) * pg.H;
  assert.ok(dx >= 100 || dy >= 50, "sobrepõe: " + JSON.stringify([ps[a], ps[b]]));
} };

test("revisão A: memorial — o vendedor assina na PRÓPRIA linha (coluna da Vendedora do modelo, x≈0,116), os compradores na deles", () => {
  const rub = { campos: [], valores: null, memorial: MEM, projeto: [], linhas: [], termos: {} };
  const mem = (s) => CS.requisitosRubrica(s, DOCS, rub, LISTA2.indexOf(s), LISTA2).find((r) => r.docId === "m").positions[0];
  assert.deepEqual(mem(VEND), { page: "13", position: [0.116, 0.7] });
  assert.deepEqual(mem(C2), MEM, "a última fileira (comprador 2) no ponto medido; comprador 1 e cônjuge 52 pt acima");
  naoSobrepoe([C1, CJ, C2, VEND].map(mem), LETTER);
  /* Propriedade MEMORIAL_POSICAO.vendedor muda a linha do vendedor */
  const r2 = Object.assign({}, rub, { memorialVendedor: { page: "13", position: [0.2, 0.71] } });
  assert.deepEqual(CS.requisitosRubrica(VEND, DOCS, r2, 3, LISTA2).find((r) => r.docId === "m").positions[0], { page: "13", position: [0.2, 0.71] });
});

test("revisão B (com as regras do dono): fila de baixo que passaria da margem de baixo = sem posição e aviso", () => {
  const avisos = [], rub = { campos: [{ page: "5", position: [520 / W, 760 / H] }], valores: null, memorial: null, projeto: [], linhas: [], termos: {} };
  const r1 = CS.requisitosRubrica(C1, DOCS, rub, 0, LISTA2, avisos), r2 = CS.requisitosRubrica(CJ, DOCS, rub, 1, LISTA2, avisos);
  assert.equal(topo(r1[0].positions[0]), 760, "o 1º no ponto");
  assert.deepEqual(r2, []);
  assert.match(avisos.join(" | "), /Cônjuge do comprador 1: sem lugar para a assinatura posicionada no contrato, pág\. 5/);
});

test("revisão D (com as regras do dono): projeto — ponto perto da borda esquerda do quadro: a fila começa mais à direita, dentro dele", () => {
  const P = { page: "5", position: [0.80, 0.95] }, rub = { campos: [], valores: null, memorial: null, projeto: [P], linhas: [], termos: {} };
  const xs = [C1, CJ, C2, VEND].map((s) => CS.requisitosRubrica(s, DOCS, rub, LISTA2.indexOf(s), LISTA2).find((r) => r.docId === "p").positions[0].position[0] * 2384);
  assert.deepEqual(xs.map(Math.round), [1988, 1956, 1924, 1892]);
});

test("revisão C: tamanho real das páginas lido do PDF (MediaBox, árvore /Kids, /Rotate); sem dá para ler = padrão", () => {
  const pdf = ["%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [4 0 R 3 0 R] /Count 2 /MediaBox [0 0 612 792] >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 1191 1684] /Rotate 90 >> endobj",
    "4 0 obj << /Type /Page /Parent 2 0 R >> endobj", "%%EOF"].join("\n");
  assert.deepEqual(CS.tamanhosPaginasPdf(pdf), [{ W: 612, H: 792 }, { W: 1684, H: 1191 }], "na ordem dos /Kids; a 2ª deitada");
  assert.equal(CS.tamanhosPaginasPdf("%PDF-1.5\n1 0 obj << /Type /ObjStm >> endobj"), null);
  assert.equal(CS.tamanhosPaginasPdf(""), null);
  /* com o tamanho lido, o deslocamento usa a página de verdade (aqui o projeto inteiro em A4 retrato) */
  const P = { page: "1", position: [0.9, 0.95] };
  const rub = { campos: [], valores: null, memorial: null, projeto: [P], linhas: [], termos: {}, tamanhos: { projeto: [{ W: 595, H: 842 }] } };
  const p = CS.requisitosRubrica(CJ, DOCS, rub, 1, LISTA2).find((r) => r.docId === "p").positions[0];
  assert.ok(Math.abs(p.position[0] * 595 - (0.9 * 595 - 32)) < 1, String(p.position[0] * 595));   /* passo do visto: 32 pt */
});

/* ---- envelope da unidade 22 (sandbox, 01/11) ---- */
test("unidade 22 (1): nome contido no outro — 'COMPRADOR VINTE E DOIS TESTE' × 'OUTRO COMPRADOR VINTE E DOIS TESTE': cada um com a sua linha", () => {
  const a = { papel: "Comprador 1", role: "buyer", nome: "COMPRADOR VINTE E DOIS TESTE", origem: "comprador1", rubrica: true };
  const b = { papel: "Comprador 2", role: "buyer", nome: "OUTRO COMPRADOR VINTE E DOIS TESTE", origem: "comprador2", rubrica: true };
  const linhas = [{ page: "1", position: [0.1, 0.1], texto: "Nome: COMPRADOR VINTE E DOIS TESTE\nCPF: 1\nCOMPRADOR" },
                  { page: "1", position: [0.1, 0.2], texto: "Nome: OUTRO COMPRADOR VINTE E DOIS TESTE\nCPF: 2\nCOMPRADOR" }];
  for (const tipo of ["contrato", "termo"]) {
    const r = CS.atribuirLinhas([a, b, VEND], linhas, tipo);
    assert.deepEqual(r.map((x) => x.map((p) => p.position[1])), [[0.1], [0.2], []], tipo);
  }
  /* caso da vida: "JOSE SILVA" × "MARIA JOSE SILVA" */
  const j = { papel: "Comprador 1", role: "buyer", nome: "JOSE SILVA", origem: "comprador1", rubrica: true };
  const m = { papel: "Cônjuge do comprador 1", role: "buyer", nome: "MARIA JOSE SILVA", origem: "conjugeComprador1", rubrica: true };
  const lj = [{ page: "2", position: [0.1, 0.3], texto: "Nome: MARIA JOSE SILVA\nCÔNJUGE DO COMPRADOR" }, { page: "2", position: [0.1, 0.4], texto: "Nome: JOSE SILVA\nCOMPRADOR" }];
  assert.deepEqual(CS.atribuirLinhas([j, m], lj, "contrato").map((x) => x.map((p) => p.position[1])), [[0.4], [0.3]]);
  /* linha antiga com os dois nomes (nenhum contido no outro): ninguém, como antes */
  assert.deepEqual(CS.atribuirLinhas([j, b], [{ page: "1", position: [0.1, 0.1], texto: "Nome: JOSE SILVA / OUTRO COMPRADOR VINTE E DOIS TESTE" }], "contrato"), [[], []]);
});

test("unidade 22 (2): traço no pé da página e o 'Nome:' no topo da seguinte — o texto vem da próxima página, a posição fica na do traço", () => {
  const H2 = 792, pg = (n, itens) => ({ numero: n, largura: 612, altura: H2, itens });
  const p3 = pg(3, [it("ASSINATURAS", 250, 60), traco(32, 200, 640), it("Nome: COMPRADOR VINTE E DOIS TESTE", 200, 652), it("COMPRADOR", 250, 680),
                    traco(32, 200, 718)]);
  const p4 = pg(4, [it("Nome: CONJUGE VINTE E DOIS TESTE", 200, 40), it("CPF: 000.000.000-00", 200, 54), it("CÔNJUGE DO COMPRADOR", 230, 68),
                    traco(32, 200, 120), it("Nome: TESTEMUNHA UM", 200, 132), it("TESTEMUNHA 1", 240, 146)]);
  const l = R.acharLinhas([p3, p4], ZERO);
  const fim = l.find((x) => x.page === "3" && Math.round(x.position[1] * H2 + 27 - 11) === 718);
  assert.ok(fim, JSON.stringify(l));
  assert.equal(fim.texto, "Nome: CONJUGE VINTE E DOIS TESTE\nCPF: 000.000.000-00\nCÔNJUGE DO COMPRADOR");
  const cj = { papel: "Cônjuge do comprador 1", role: "buyer", nome: "CONJUGE VINTE E DOIS TESTE", origem: "conjugeComprador1", rubrica: true };
  assert.equal(CS.atribuirLinhas([cj], [fim], "termo")[0].length, 1);
});

/* ---- calibração pelos PDFs assinados da unidade 22 (pymupdf: tinta de cada marca × ponto enviado) ----
   manuscrita (imagem 100×50): tinta de +18 a +29 pt abaixo do ponto, de +2 a +99 pt à direita;
   visto (texto "OvertheRainbow" 22 pt): tinta de +9 a +27 pt abaixo do ponto, 22–27 pt de largura a partir do x.
   Regras do dono (01/11): no meio do texto (ciência e 4.2.1) só VISTOS dos compradores, numa fila compacta, nunca para
   cima; projeto: vistos compactos DENTRO do quadro DEFERIMENTO, para a esquerda e depois abaixo. */
test("calibração u22: linha de assinatura — ponto 27 pt acima da linha de base (tinta da manuscrita em cima da linha)", () => {
  const pg = pag(18, [base("VENDEDORA", 250, 20), base("COMPRADOR", 250, 30), traco(47, 226, 223), base("Nome: EMPRESA", 226, 248), base("VENDEDORA", 226, 262)]);
  const l = R.acharLinhas([pg], CS.AJUSTE_PADRAO);
  assert.equal(topo(l[0]), 234 - 27);
});
test("calibração u22: campo de ciência → ponto do visto 25 pt acima da base; 4.2.1 → 22 pt acima da base, na coluna cinza", () => {
  const p9 = pag(9, [base("LIMITES — ASSINATURA: _______________________________", 182.7, 356.4)]);
  const r = R.acharNoContrato([p9], CS.AJUSTE_PADRAO);
  assert.equal(topo(r.campos[0]), Math.round(356.4 - 25));
  const p3 = pag(3, [base("texto da margem", 57, 100), base("4.2.1. ENTRADA: parcelamento direto com a VENDEDORA.", 182.7, 341.5)]);
  const v = R.acharNoContrato([p3], CS.AJUSTE_PADRAO).valores;
  assert.equal(topo(v), Math.round(341.5 - 22));
  assert.equal(Math.round(v.position[0] * W), 61);
});

const CAMPO9 = { page: "9", position: [313.3 / 596, 331.4 / 842] }, VALORES3 = { page: "3", position: [60.7 / 596, 319.5 / 842] };
const RUB_U22 = { campos: [CAMPO9], valores: VALORES3, memorial: null, projeto: [], linhas: [], termos: {}, tamanhos: { contrato: Array(41).fill({ W: 596, H: 842 }) } };
const reqDe = (s, rub = RUB_U22, l = LISTA2) => CS.requisitosRubrica(s, DOCS, rub, l.indexOf(s), l);
test("dono 01/11: no contrato, ciência e 4.2.1 viram VISTOS (initials) dos compradores — um requisito por pessoa com todas as posições", () => {
  const r = reqDe(C1);
  assert.deepEqual(r.map((x) => x.docId + ":" + x.kind), ["c:initials"], "manuscrita só na linha da própria pessoa");
  assert.deepEqual(r[0].positions.map((p) => p.page), ["9", "3"]);
  assert.deepEqual(reqDe(VEND).filter((x) => x.docId === "c"), [], "vendedor não tem visto no meio do texto");
});
test("dono 01/11: vistos lado a lado numa fila compacta (passo 32 pt), mesma altura, nunca para cima", () => {
  const x = (s, i) => Math.round(reqDe(s)[0].positions[i].position[0] * 596 * 10) / 10;
  const y = (s, i) => Math.round(reqDe(s)[0].positions[i].position[1] * 842 * 10) / 10;
  assert.deepEqual([C1, CJ, C2].map((s) => x(s, 0)), [313.3, 345.3, 377.3]);
  assert.deepEqual([C1, CJ, C2].map((s) => y(s, 0)), [331.4, 331.4, 331.4]);
  assert.deepEqual([C1, CJ, C2].map((s) => x(s, 1)), [60.7, 92.7, 124.7], "4.2.1 na coluna cinza");
  /* quarto comprador: não cabe na coluna cinza (até 110 pt do começo) — vai para a fila de BAIXO */
  const C3 = { papel: "Comprador 3", role: "buyer", nome: "TERCEIRO TESTE", origem: "comprador3", rubrica: true };
  const L4 = [C1, CJ, C2, C3, VEND];
  const v4 = CS.requisitosRubrica(C3, DOCS, RUB_U22, 3, L4)[0].positions[1];
  assert.deepEqual([Math.round(v4.position[0] * 596 * 10) / 10, Math.round(v4.position[1] * 842 * 10) / 10], [60.7, 341.5]);
});

test("dono 01/11: projeto — vistos compactos DENTRO do quadro DEFERIMENTO (A0 e A1), para a esquerda; ponto fora do quadro entra nele", () => {
  const caixa = (W, H) => [W - 496, H - 241, W - 28, H - 29];
  const proj = [{ page: "1", position: [0.934, 0.948] }, { page: "10", position: [0.782, 0.932] }];
  const rub = { campos: [], valores: null, memorial: null, projeto: proj, linhas: [], termos: {} };
  const todos = [C1, CJ, C2, VEND].map((s) => reqDe(s, rub).find((r) => r.docId === "p"));
  assert.ok(todos.every((r) => r.kind === "initials" && r.positions.length === 2));
  for (const [i, W, H] of [[0, 3370, 2384], [1, 2384, 1684]]) {
    const [bx0, by0, bx1, by1] = caixa(W, H);
    const xs = todos.map((r) => r.positions[i].position[0] * W), ys = todos.map((r) => r.positions[i].position[1] * H);
    xs.forEach((x, k) => {
      /* proporções com 4 casas: até 0,5 pt de arredondamento */
      assert.ok(x >= bx0 + 4 - 0.5 && x + 27 <= bx1 - 4 + 0.5, "pág " + proj[i].page + " x " + x);
      assert.ok(ys[k] + 9 >= by0 - 0.5 && ys[k] + 27 <= by1 - 2 + 0.5, "pág " + proj[i].page + " y " + ys[k]);
      if (k) assert.ok(Math.abs(xs[k - 1] - x - 32) < 0.5, "passo 32 para a esquerda");
    });
    assert.ok(ys.every((v) => Math.abs(v - ys[0]) < 0.5), "mesma altura");
  }
});
