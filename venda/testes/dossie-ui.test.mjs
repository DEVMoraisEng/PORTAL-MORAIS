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

/* ---------- bloco Contrato ---------- */
const uic = (x = {}) => Object.assign({ ocupadoContrato: null, faltas: null, msg: "", testes: false }, x);
const botao = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>')) || [null])[0];

test("contrato: sem estado ainda mostra carregando", () => {
  const h = D.htmlContrato(null, uic());
  assert.match(h, /Contrato/);
  assert.match(h, /carregando/);
  assert.equal(botao(h, "c-gerar"), null);
});

test("contrato: nunca gerado mostra Gerar contrato habilitado e nada de Visualizar", () => {
  const h = D.htmlContrato({ gerado: false }, uic());
  assert.match(h, /Gerar contrato/);
  assert.doesNotMatch(botao(h, "c-gerar"), /disabled/);
  assert.equal(botao(h, "c-ver"), null);
});

test("contrato: gerando avisa e desabilita todos os botões", () => {
  const h = D.htmlContrato({ gerado: true, nome: "Contrato.pdf" }, uic({ ocupadoContrato: "gerar" }));
  assert.match(h, /gerando… \(até 1 minuto\)/);
  assert.match(botao(h, "c-gerar"), /disabled/);
  assert.match(botao(h, "c-ver"), /disabled/);
});

test("contrato: faltas viram lista escapada com o título", () => {
  const h = D.htmlContrato({ gerado: false }, uic({ faltas: ["Negociação: sinal (valor)", "<img src=x onerror=alert(1)>"] }));
  assert.match(h, /Para gerar o contrato, falta:/);
  assert.match(h, /<ul>[\s\S]*<li>Negociação: sinal \(valor\)<\/li>/);
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

test("contrato: gerado mostra o nome (escapado), Visualizar e Gerar de novo", () => {
  const h = D.htmlContrato({ gerado: true, nome: "<b>C</b>.pdf" }, uic());
  assert.match(h, /Contrato gerado: &lt;b&gt;C&lt;\/b&gt;\.pdf/);
  assert.doesNotMatch(botao(h, "c-ver"), /disabled/);
  assert.match(h, /Gerar de novo/);
  assert.doesNotMatch(botao(h, "c-gerar"), /disabled/);
});

test("contrato: perfil TESTES vê o bloco com botões desabilitados", () => {
  for (const est of [{ gerado: false }, { gerado: true, nome: "x.pdf" }]) {
    const h = D.htmlContrato(est, uic({ testes: true }));
    assert.match(h, /Perfil TESTES/);
    assert.match(botao(h, "c-gerar"), /disabled/);
    const ver = botao(h, "c-ver");
    if (ver) assert.match(ver, /disabled/);
  }
});

test("contrato: mensagem da tela é escapada", () => {
  assert.match(D.htmlContrato({ gerado: false }, uic({ msg: "<i>x</i>" })), /&lt;i&gt;x/);
});

test("mensagemContrato: cada erro em português", () => {
  const m = (erro) => D.mensagemContrato({ ok: false, erro });
  assert.equal(m("MODELO_NAO_CONFIGURADO"), "O modelo do contrato não está configurado neste ambiente.");
  assert.equal(m("CADASTRO_NAO_CONFIGURADO"), "Os cadastros do contrato não estão configurados neste ambiente.");
  assert.equal(m("CONTRATO_FALHOU"), "Não consegui gerar o contrato — tente de novo.");
  assert.equal(m("MODELO_COM_MARCADOR_SOBRANDO"), "O modelo do contrato tem um campo sem preenchimento — avise o suporte.");
  assert.equal(m("DRIVE_API_DESLIGADA"), "Ative o serviço Drive API no PORTAL-VENDA (veja COMO-IMPLANTAR).");
  assert.equal(m("SEM_PERMISSAO_TESTES"), "O perfil TESTES só consulta; não grava.");
  assert.equal(m("NAO_AUTORIZADO"), "Sua sessão expirou — entre de novo no portal.");
  assert.match(m("SEM_RESPOSTA"), /não respondeu/);
  assert.match(m("COLUNA_FALTANDO: X"), /coluna X/);
  assert.match(m("TIPO_DE_COLUNA_ERRADO: Y"), /coluna Y/);
  assert.match(m("OUTRO"), /OUTRO/);
});

test("mensagemContrato: nunca mostra os nomes dos marcadores", () => {
  const t = D.mensagemContrato({ ok: false, erro: "MODELO_COM_MARCADOR_SOBRANDO", marcadores: ["SEGREDO_X"] });
  assert.doesNotMatch(t, /SEGREDO_X/);
});

test("contrato: link de reserva só aparece com https, escapado, e com o aviso", () => {
  const est = { gerado: true, nome: "x.pdf" };
  const com = D.htmlContrato(est, uic({ link: "https://exemplo.test/a?b=1&c=\"2\"" }));
  assert.match(com, /O navegador bloqueou a janela — clique em Abrir contrato\./);
  assert.match(com, /<a href="https:\/\/exemplo\.test\/a\?b=1&amp;c=&quot;2&quot;" target="_blank" rel="noopener">Abrir contrato<\/a>/);
  assert.doesNotMatch(D.htmlContrato(est, uic()), /Abrir contrato/);
  assert.doesNotMatch(D.htmlContrato(est, uic({ link: "javascript:alert(1)" })), /Abrir contrato/);
  assert.doesNotMatch(D.htmlContrato(est, uic({ link: "http://inseguro.test" })), /Abrir contrato/);
});
