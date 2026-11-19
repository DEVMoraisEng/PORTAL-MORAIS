/* assinatura-ui.js — troca de fiadores e termos em envelope próprio (18/11/2026). Sem navegador; dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const A = createRequire(import.meta.url)("../assinatura-ui.js");

const botao = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>', "g")) || []);
const ctx = (x = {}) => Object.assign({ contratoGerado: true, estado: { situacao: "ENVIADO", envelope: true, signatarios: [] },
                                        ocupado: null, testes: false, msg: "", faltas: null, podeTrocarFiadores: true }, x);
const JA = [{ envelope: "env-c", docId: "c1", tipo: "contrato", nome: "x.pdf", assinaram: [{ papel: "Comprador 1", nome: "Fulano T.", data: "2026-11-14T10:20" }] }];

test("contrato assinado e termos pendentes: situação própria, Já assinado travado com Ver PDF (envelope certo), sem Cancelar do contrato", () => {
  const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: "ENVIADO", envelope: true, contratoAssinado: true, signatarios: [], jaAssinado: JA } }));
  assert.match(h, new RegExp(A.CONTRATO_ASSINADO_TERMOS));
  assert.match(h, /Já assinado/);
  /* uma pessoa por linha: "✓ Nome (papel) — dd/mm/aaaa hh:mm", e o botão embaixo */
  assert.match(h, /<li><b class="ass-ok">✓<\/b> Fulano T\. \(Comprador 1\) <span class="ass-data">— 14\/11\/2026 10:20<\/span><\/li>/);
  assert.ok(h.indexOf("Ver PDF assinado") > h.indexOf("Fulano T."), "botão depois da lista");
  const ver = botao(h, "a-doc-ver");
  assert.equal(ver.length, 1);
  assert.match(ver[0], /data-doc="c1"/);
  assert.match(ver[0], /data-env="env-c"/);
  assert.equal(botao(h, "a-cancelar").length, 0);
  assert.doesNotMatch(h, /@/);
});

test("Já assinado também vem do contratoEstado (sem Clicksign) enquanto a situação não chegou", () => {
  const h = A.montarBlocoAssinatura(ctx({ jaAssinado: JA }));
  assert.equal(botao(h, "a-doc-ver").length, 1);
});

test("envelope dos termos: situação, Trocar e-mail, Reenviar e Cancelar com as ações dos termos", () => {
  const termos = { envelope: true, situacao: "ENVIADO", signatarios: [{ id: "n2", papel: "Fiador 2", nome: "Fiador N.", email: "f@teste.example", situacao: "pendente" }] };
  const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: "ENVIADO", envelope: true, contratoAssinado: true, signatarios: [], termos } }));
  assert.match(h, /Termos de confissão/);
  assert.equal(botao(h, "a-t-trocar-email").length, 1);
  assert.equal(botao(h, "a-t-reenviar").length, 1);
  assert.equal(botao(h, "a-t-cancelar").length, 1);
  const t = A.montarBlocoAssinatura(ctx({ testes: true, estado: { situacao: "ENVIADO", envelope: true, signatarios: [], termos } }));
  assert.equal(botao(t, "a-t-trocar-email").length, 0);
  assert.match(botao(t, "a-t-reenviar")[0], /disabled/);
});

test("botão Trocar fiadores: só com o contrato enviado, a permissão ligada e fora do perfil TESTES", () => {
  assert.equal(botao(A.montarBlocoAssinatura(ctx()), "a-troca-abrir").length, 1);
  assert.equal(botao(A.montarBlocoAssinatura(ctx({ podeTrocarFiadores: false })), "a-troca-abrir").length, 0);
  assert.equal(botao(A.montarBlocoAssinatura(ctx({ testes: true })), "a-troca-abrir").length, 0);
  assert.equal(botao(A.montarBlocoAssinatura(ctx({ estado: { situacao: "CANCELADO", envelope: true, signatarios: [] } })), "a-troca-abrir").length, 0);
  assert.equal(botao(A.montarBlocoAssinatura(ctx({ doc: "PRE_RESERVA" })), "a-troca-abrir").length, 0);
});

test("fluxo da troca: prévia → gerar (lê as linhas dos termos) → enviar com prazo e rubricas; o que será cancelado vai na confirmação", async () => {
  const pedidos = [], perguntas = [];
  const respostas = {
    trocarFiadoresPrevia: { ok: true, liberado: true, problemas: [], carimbo: "c0ffee00", cancelar: [{ nome: "CONFISSÃO PRÉ-CHAVES - X.pdf" }],
                            envelopeAntigo: "contrato", assinam: [{ papel: "Fiador 2", nome: "Fiador N." }], fiadores: { mostrar: true, fiadores: [] } },
    trocarFiadoresGerar: { ok: true, carimbo: "c0ffee00", linhas: true, ajuste: null, termos: [{ nome: "CONFISSÃO PRÉ-CHAVES - X.pdf", base64: "JVBERg==" }] },
    trocarFiadoresEnviar: { ok: true, envelopeId: "env-t", termos: { envelope: true, situacao: "ENVIADO", signatarios: [] } },
  };
  const deps = { pageId: "p", chamar: async (q) => { pedidos.push(q); return respostas[q.action]; }, confirmar: (t) => { perguntas.push(t); return true; },
                 rubricas: { paginasDoPdf: async () => [{}], acharLinhas: () => [{ page: 1, position: [0.1, 0.8], texto: "FIADOR 2" }] },
                 lerPrazo: () => "", agora: new Date() };
  let c = await A.executarAcaoAssinatura("a-troca-abrir", ctx(), deps);
  assert.equal(pedidos[0].action, "trocarFiadoresPrevia");
  let h = A.montarBlocoAssinatura(c);
  assert.match(h, /Trocar fiadores/);
  assert.match(h, /ass-troca-fia/, "lugar do bloco Fiadores editável");
  assert.match(h, /Será cancelado \(envelope do contrato\): CONFISSÃO PRÉ-CHAVES/);
  assert.doesNotMatch(botao(h, "a-troca-gerar")[0], /disabled/);
  c = await A.executarAcaoAssinatura("a-troca-gerar", c, deps);
  assert.equal(pedidos[1].carimbo, "c0ffee00");
  assert.deepEqual(c.troca.rubricas.termos[0].nome, "CONFISSÃO PRÉ-CHAVES - X.pdf");
  h = A.montarBlocoAssinatura(c);
  assert.equal(botao(h, "a-troca-enviar").length, 1);
  assert.equal(botao(h, "a-troca-ver").length, 1);
  c = await A.executarAcaoAssinatura("a-troca-enviar", c, deps);
  const env = pedidos[2];
  assert.equal(env.action, "trocarFiadoresEnviar");
  assert.match(env.prazo, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(env.rubricas.termos[0].linhas.length, 1);
  assert.match(perguntas.at(-1), /Será cancelado: CONFISSÃO PRÉ-CHAVES/);
  assert.match(perguntas.at(-1), /Fiador N\. \(Fiador 2\)/);
  assert.equal(c.troca, null);
  assert.equal(c.recarregar, true);
  assert.equal(c.estado.termos.situacao, "ENVIADO");
});

test("prévia bloqueada: problemas na tela e Gerar desabilitado", async () => {
  const deps = { pageId: "p", chamar: async () => ({ ok: true, liberado: false, bloqueio: "FIADOR_SEM_DOCUMENTO", problemas: ["Fiador 2: anexe o documento (DOC. FIADOR 2)."] }), confirmar: () => true };
  const c = await A.executarAcaoAssinatura("a-troca-abrir", ctx(), deps);
  const h = A.montarBlocoAssinatura(c);
  assert.match(h, /DOC\. FIADOR 2/);
  assert.match(botao(h, "a-troca-gerar")[0], /disabled/);
  /* gerar não chama nada com a prévia bloqueada */
  const d2 = { pageId: "p", chamar: async () => { throw new Error("não devia chamar"); }, confirmar: () => true };
  assert.equal(await A.executarAcaoAssinatura("a-troca-gerar", c, d2), c);
});

test("Reenviar link dos termos manda doc TERMOS e atualiza só o envelope dos termos", async () => {
  const termos = { envelope: true, situacao: "ENVIADO", signatarios: [{ id: "n2", papel: "Fiador 2", situacao: "pendente" }] };
  const pedidos = [];
  const deps = { pageId: "p", chamar: async (q) => { pedidos.push(q); return { ok: true, pendentes: 1, signatarios: termos.signatarios }; }, confirmar: () => true };
  const c = await A.executarAcaoAssinatura("a-t-reenviar", ctx({ estado: { situacao: "ENVIADO", envelope: true, signatarios: [{ papel: "Comprador 1", situacao: "assinou" }], termos } }), deps);
  assert.deepEqual(pedidos, [{ action: "assinaturaReenviar", pageId: "p", doc: "TERMOS" }]);
  assert.equal(c.estado.signatarios[0].papel, "Comprador 1", "o contrato fica como estava");
  assert.match(c.msg, /reenviado/);
});

test("celular: na seção da Clicksign e no bloco Fiadores, botão de 44 px e campo de 16 px (só até 600 px e só nestas seções)", async () => {
  const fs = await import("node:fs");
  const t = fs.readFileSync(new URL("../../venda-dossie.js", import.meta.url), "utf8");
  assert.ok(t.includes('"@media (max-width:600px){.vb-ass button,.dz-fia-bloco button{min-height:44px!important}"'));
  assert.ok(t.includes('".vb-ass input,.vb-ass select,.vb-ass textarea,.dz-fia-bloco input,.dz-fia-bloco select{font-size:16px!important}}"'));
});
