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
const xy = (l) => [Math.round(l.position[0] * W), Math.round(l.position[1] * H)];

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
