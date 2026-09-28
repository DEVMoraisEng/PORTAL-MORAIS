import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");

const base = { tipoCasa: "CASA DE RUA", arquivos: { C1_IDENTIDADE: 1, C1_COMPROVANTE: 0, C2_IDENTIDADE: 0, C2_COMPROVANTE: 0, APROVACAO: 0 },
               dossie: "FALTA DOCUMENTO", observacao: "", doisCompradores: false };
const ui = (x = {}) => Object.assign({ dois: false, ocupado: null, msg: "" }, x);

test("sem tipo de casa: aviso e botões de envio desabilitados", () => {
  const h = D.html(Object.assign({}, base, { tipoCasa: "" }), ui());
  assert.match(h, /Escolha o tipo de casa/);
  const enviar = h.match(/<button[^>]*data-acao="enviar"[^>]*>/g);
  assert.equal(enviar.length, 3);
  assert.ok(enviar.every((b) => b.includes("disabled")));
});

test("com tipo de casa: marca a escolha, mostra só comprador 1 e a Caixa", () => {
  const h = D.html(base, ui());
  assert.match(h, /data-valor="CASA DE RUA"[^>]*class="[^"]*on/);
  assert.doesNotMatch(h, /data-espaco="C2_IDENTIDADE"/);
  assert.match(h, /data-espaco="APROVACAO"/);
  assert.match(h, /1 arquivo/);
});

test("dois compradores mostra os espaços do comprador 2", () => {
  assert.match(D.html(base, ui({ dois: true })), /data-espaco="C2_COMPROVANTE"/);
});

test("lendo: o espaço ocupado avisa e todos os botões ficam desabilitados", () => {
  const h = D.html(base, ui({ ocupado: "C1_IDENTIDADE" }));
  assert.match(h, /lendo/);
  const botoes = h.match(/<button[^>]*data-acao="(enviar|reler|conferir|devolver)"[^>]*>/g);
  assert.ok(botoes.every((b) => b.includes("disabled")));
});

test("Ler de novo só habilita com arquivo no espaço", () => {
  const h = D.html(base, ui());
  assert.doesNotMatch(h.match(/<button[^>]*data-acao="reler"[^>]*data-espaco="C1_IDENTIDADE"[^>]*>/)[0], /disabled/);
  assert.match(h.match(/<button[^>]*data-acao="reler"[^>]*data-espaco="C1_COMPROVANTE"[^>]*>/)[0], /disabled/);
});

test("botão Trocar aparece com arquivo e fica desabilitado sem arquivo no espaço", () => {
  const h = D.html(base, ui());
  assert.match(h, /data-acao="trocar"[^>]*data-espaco="C1_IDENTIDADE"[^>]*>Trocar/);
  assert.doesNotMatch(h.match(/<button[^>]*data-acao="trocar"[^>]*data-espaco="C1_IDENTIDADE"[^>]*>/)[0], /disabled/);
  assert.match(h.match(/<button[^>]*data-acao="trocar"[^>]*data-espaco="C1_COMPROVANTE"[^>]*>/)[0], /disabled/);
});

test("contagem de arquivos vinda do servidor é convertida em número (não vira HTML)", () => {
  const h = D.html(Object.assign({}, base, { arquivos: Object.assign({}, base.arquivos, { C1_IDENTIDADE: "<b>2</b>" }) }), ui());
  assert.doesNotMatch(h, /<b>2<\/b>/);
  assert.match(h, /nenhum arquivo/);
});

test("observação é escapada", () => {
  const h = D.html(Object.assign({}, base, { observacao: "<img src=x onerror=alert(1)>" }), ui());
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

test("mensagens de erro em português, com o caso do arquivo guardado", () => {
  assert.equal(D.mensagemDeErro("LEITURA_FALHOU", true), "Arquivo guardado; a leitura falhou — use Ler de novo.");
  assert.equal(D.mensagemDeErro("NAO_AUTORIZADO"), "Sua sessão expirou — entre de novo no portal.");
  assert.equal(D.mensagemDeErro("TIPO_DE_ARQUIVO_NAO_SUPORTADO"), "Formato não suportado — envie foto em JPG ou PNG, ou PDF. (Foto de iPhone em HEIC: tire um print ou exporte como JPG.)");
  assert.equal(D.mensagemDeErro("COLUNA_FALTANDO: VALOR DO SUBSÍDIO"), "A base não tem a coluna VALOR DO SUBSÍDIO — avise o desenvolvedor.");
  assert.equal(D.mensagemDeErro("XPTO"), "Algo deu errado (XPTO) — tente de novo.");
  assert.equal(D.mensagemDeErro("TROCAR_SEM_ARQUIVO"), "Escolha o arquivo novo para trocar.");
});

test("SEM_RESPOSTA muda de mensagem quando a ação era lerDocumento (o arquivo pode ter sido guardado)", () => {
  assert.equal(D.mensagemDeErro("SEM_RESPOSTA"), "O servidor não respondeu — confira a internet e tente de novo.");
  assert.equal(D.mensagemDeErro("SEM_RESPOSTA", false, true),
    "O servidor demorou a responder — o arquivo pode ter sido guardado. Use Ler de novo antes de enviar outra vez.");
  assert.equal(D.mensagemDeErro("NAO_AUTORIZADO", false, true), "Sua sessão expirou — entre de novo no portal.");
});

test("resumo da leitura", () => {
  assert.equal(D.resumo({ preenchidos: ["A", "B"], observacoes: ["x"], dossie: "FALTA DOCUMENTO" }),
    "Lido: 2 campos preenchidos; 1 observação (veja abaixo); ainda falta documento.");
  assert.equal(D.resumo({ preenchidos: [], observacoes: [], dossie: "LIDO PELA IA – CONFERIR" }),
    "Lido: nenhum campo novo; confira os dados e marque Conferido.");
});

test("escala reduz o lado maior a 1600 e não amplia foto pequena", () => {
  assert.deepEqual(D.escala(4000, 3000, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(D.escala(3000, 4000, 1600), { w: 1200, h: 1600 });
  assert.deepEqual(D.escala(800, 600, 1600), { w: 800, h: 600 });
});

test("perfil TESTES desabilita os botões que gravam e avisa que só consulta", () => {
  const h = D.html(base, ui({ testes: true }));
  assert.match(h, /Perfil TESTES só consulta/);
  const gravam = h.match(/<button[^>]*data-acao="(tipo|enviar|reler|conferir|devolver)"[^>]*>/g);
  assert.ok(gravam.every((b) => b.includes("disabled")));
});

test("sem perfil TESTES, os botões seguem habilitados normalmente", () => {
  const h = D.html(base, ui());
  assert.doesNotMatch(h, /Perfil TESTES só consulta/);
  const enviar = h.match(/<button[^>]*data-acao="enviar"[^>]*>/g);
  assert.ok(enviar.some((b) => !b.includes("disabled")));
});

test("tipoAceito separa imagem, PDF e o resto (HEIC fica de fora)", () => {
  assert.equal(D.tipoAceito("image/jpeg"), "imagem");
  assert.equal(D.tipoAceito("application/pdf"), "pdf");
  assert.equal(D.tipoAceito("image/heic"), "");
  assert.equal(D.tipoAceito(""), "");
});

test("painelCarregando: só é true no placeholder do abrirObra (1 filho .vazio com .load)", () => {
  assert.equal(D.painelCarregando(1, "vazio", true), true);
});

test("painelCarregando: false quando o painel já foi renderizado, mesmo com um spinner .load em outro lugar (comentários)", () => {
  assert.equal(D.painelCarregando(12, "grp", false), false);
});

test("painelCarregando: false com 1 filho sem .load", () => {
  assert.equal(D.painelCarregando(1, "vazio", false), false);
});

test("painelCarregando: false com 0 filhos", () => {
  assert.equal(D.painelCarregando(0, "", false), false);
});
