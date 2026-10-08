/* assinatura-ui.js — bloco "Assinatura" do painel da casa (entrega 3). Sem navegador. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const A = createRequire(import.meta.url)("../assinatura-ui.js");

const botao = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>', "g")) || []);
const ctx = (x = {}) => Object.assign({ contratoGerado: true, estado: { situacao: "", envelope: false, signatarios: [] },
                                        ocupado: null, testes: false, msg: "", faltas: null }, x);
const ENVIADO = { situacao: "ENVIADO", envelope: true, signatarios: [{ papel: "Comprador 1", assinou: true }, { papel: "Testemunha 1", assinou: false }] };

test("sem envelope e com contrato gerado: Enviar habilitado com confirmação; sem Atualizar", () => {
  const h = A.montarBlocoAssinatura(ctx());
  const b = botao(h, "a-enviar");
  assert.equal(b.length, 1);
  assert.doesNotMatch(b[0], /disabled/);
  assert.match(h, />Enviar para assinatura</);
  assert.equal(botao(h, "a-atualizar").length, 0);
});

test("sem contrato gerado: Enviar desabilitado e aviso para gerar antes", () => {
  const h = A.montarBlocoAssinatura(ctx({ contratoGerado: false }));
  assert.match(botao(h, "a-enviar")[0], /disabled/);
  assert.match(h, /Gere o contrato antes/);
});

test("envelope aberto: Enviar desabilitado, situação, quem assinou e Atualizar situação", () => {
  const h = A.montarBlocoAssinatura(ctx({ estado: ENVIADO }));
  assert.match(botao(h, "a-enviar")[0], /disabled/);
  assert.doesNotMatch(botao(h, "a-atualizar")[0], /disabled/);
  assert.match(h, />Atualizar situação</);
  assert.match(h, /Enviado — aguardando assinaturas/);
  assert.match(h, /Comprador 1[^<]*<\/span>\s*<b class="ass-ok">✓ assinou<\/b>/);
  assert.match(h, /Testemunha 1[^<]*<\/span>\s*<b class="ass-pend">pendente<\/b>/);
});

test("lista nova: nome mascarado, ✓ com data, recusou, pendente; Reenviar link só com pendente e ENVIADO", () => {
  const sigs = [{ papel: "Comprador 1", nome: "Maria S.", assinou: true, situacao: "assinou", data: "2026-10-07T10:20:30.000-03:00" },
                { papel: "Vendedor", nome: "Joao P.", assinou: false, situacao: "recusou", data: "2026-10-07T11:05:00Z" },
                { papel: "Testemunha 1", nome: "Ana C.", assinou: false, situacao: "pendente", data: "" }];
  const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: "ENVIADO", envelope: true, signatarios: sigs } }));
  assert.match(h, /<li><span>Comprador 1 \(Maria S\.\)<\/span> <b class="ass-ok">✓ assinou<\/b> <span class="ass-data">em 07\/10\/2026 10:20<\/span><\/li>/);
  assert.match(h, /Vendedor \(Joao P\.\)<\/span> <b class="ass-rec">✗ recusou<\/b> <span class="ass-data">em 07\/10\/2026 11:05/);
  assert.match(h, /Testemunha 1 \(Ana C\.\)<\/span> <b class="ass-pend">pendente<\/b><\/li>/);
  assert.doesNotMatch(botao(h, "a-reenviar")[0], /disabled/);
  assert.match(h, />Reenviar link de assinatura</);
  const todos = A.montarBlocoAssinatura(ctx({ estado: { situacao: "ENVIADO", envelope: true, signatarios: [sigs[0]] } }));
  assert.equal(botao(todos, "a-reenviar").length, 0);
  const assinado = A.montarBlocoAssinatura(ctx({ estado: { situacao: "ASSINADO", envelope: true, signatarios: [sigs[2]] } }));
  assert.equal(botao(assinado, "a-reenviar").length, 0);
  const t = A.montarBlocoAssinatura(ctx({ testes: true, estado: { situacao: "ENVIADO", envelope: true, signatarios: sigs } }));
  assert.match(botao(t, "a-reenviar")[0], /disabled/);
});

test("Reenviar: confirma, chama assinaturaReenviar e mostra quantos recebem; erro de limite vira mensagem", async () => {
  const pend = { papel: "Testemunha 1", assinou: false, situacao: "pendente", data: "" };
  const c0 = ctx({ estado: { situacao: "ENVIADO", envelope: true, signatarios: [pend, Object.assign({}, pend, { papel: "Testemunha 2" })] } });
  const chamadas = [];
  let perguntou = "";
  const nao = await A.executarAcaoAssinatura("a-reenviar", c0, { pageId: "p", confirmar: () => false, chamar: async (x) => { chamadas.push(x); return {}; } });
  assert.equal(nao, c0);
  assert.equal(chamadas.length, 0);
  const ok = await A.executarAcaoAssinatura("a-reenviar", c0, { pageId: "p", confirmar: (t) => { perguntou = t; return true; },
    chamar: async (x) => { chamadas.push(x); return { ok: true, situacao: "ENVIADO", pendentes: 2, signatarios: c0.estado.signatarios }; } });
  assert.match(perguntou, /As 2 pessoas que ainda não assinaram/);
  assert.deepEqual(chamadas, [{ action: "assinaturaReenviar", pageId: "p" }]);
  assert.match(ok.msg, /Link reenviado — 2 pessoas/);
  assert.equal(ok.ocupado, null);
  const lim = await A.executarAcaoAssinatura("a-reenviar", c0, { pageId: "p", confirmar: () => true,
    chamar: async () => ({ ok: false, erro: "REENVIO_RECENTE", minutos: 7 }) });
  assert.match(lim.msg, /espere 7 minutos/);
  assert.equal(lim.estado, c0.estado);
});

test("assinado: mostra Assinado e Enviar continua desabilitado", () => {
  const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: "ASSINADO", envelope: true, signatarios: [] } }));
  assert.match(h, /Assinado — o PDF assinado está em CONTRATO ASSINADO/);
  assert.match(botao(h, "a-enviar")[0], /disabled/);
});

test("cancelado, recusado ou expirado: deixa enviar de novo", () => {
  for (const s of ["CANCELADO", "RECUSADO", "EXPIRADO"]) {
    const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: s, envelope: true, signatarios: [] } }));
    assert.doesNotMatch(botao(h, "a-enviar")[0], /disabled/, s);
    assert.match(h, />Enviar de novo para assinatura</, s);
  }
});

test("envelope com situação vazia conta como aberto (não deixa mandar outro)", () => {
  const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: "", envelope: true, signatarios: [] } }));
  assert.match(botao(h, "a-enviar")[0], /disabled/);
});

test("rascunho que ficou na Clicksign: Enviar desabilitado e orienta apagar lá e usar Atualizar situação", () => {
  const h = A.montarBlocoAssinatura(ctx({ estado: { situacao: "RASCUNHO", envelope: true, signatarios: [] } }));
  assert.match(botao(h, "a-enviar")[0], /disabled/);
  assert.doesNotMatch(botao(h, "a-atualizar")[0], /disabled/);
  assert.match(h, /Rascunho na Clicksign \(não foi enviado\) — apague o rascunho na Clicksign e use Atualizar situação/);
});

test("ocupado ou perfil TESTES: botões desabilitados; TESTES também não atualiza (Atualizar grava na casa)", () => {
  const ocup = A.montarBlocoAssinatura(ctx({ estado: ENVIADO, ocupado: "atualizar" }));
  assert.match(botao(ocup, "a-atualizar")[0], /disabled/);
  assert.match(ocup, /consultando/);
  const env = A.montarBlocoAssinatura(ctx({ ocupado: "enviar" }));
  assert.match(botao(env, "a-enviar")[0], /disabled/);
  assert.match(env, /enviando/);
  const t = A.montarBlocoAssinatura(ctx({ testes: true }));
  assert.match(botao(t, "a-enviar")[0], /disabled/);
  assert.match(t, /Perfil TESTES não envia, não reenvia nem atualiza a assinatura/);
  const t2 = A.montarBlocoAssinatura(ctx({ testes: true, estado: ENVIADO }));
  assert.match(botao(t2, "a-atualizar")[0], /disabled/);
});

test("faltas, mensagem, papel e situação são escapados", () => {
  const h = A.montarBlocoAssinatura(ctx({ faltas: ["<b>x</b>"], msg: "<i>m</i>",
    estado: { situacao: "<s>", envelope: true, signatarios: [{ papel: "<img src=x>", assinou: false }] } }));
  assert.doesNotMatch(h, /<b>x<\/b>|<i>m<\/i>|<img|<s>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(h, /Para enviar, falta:/);
});

test("sem estado: carregando ou a mensagem", () => {
  assert.match(A.montarBlocoAssinatura(ctx({ estado: null })), /carregando/);
  assert.match(A.montarBlocoAssinatura(ctx({ estado: null, msg: "Falhou" })), /Falhou/);
});

test("mensagens amigáveis por código", () => {
  const m = A.mensagemAssinatura;
  assert.match(m({ erro: "CLICKSIGN_SEM_TOKEN" }), /ainda não foi ligada/);
  assert.match(m({ erro: "ENVELOPE_ABERTO", situacao: "ENVIADO" }), /já está com a Clicksign/);
  assert.match(m({ erro: "SEM_CONTRATO_GERADO" }), /Gere o contrato/);
  assert.match(m({ erro: "FALTAM_DADOS", faltas: ["a"] }), /Complete os dados/);
  assert.equal(m({ erro: "CLICKSIGN_FALHOU", passo: "requisitos", http: 422, detalhe: "role inválido" }),
               "A Clicksign recusou o envio (passo: requisitos, código 422: role inválido). Nada foi enviado aos signatários — avise o desenvolvedor.");
  assert.match(m({ erro: "CLICKSIGN_FALHOU", passo: "envelope", http: 0, detalhe: "" }), /não respondeu/);
  assert.match(m({ erro: "GRAVACAO_FALHOU", envelopeId: "env-1" }), /env-1.*Atualizar situação.*não envie de novo/);
  assert.match(m({ erro: "GRAVACAO_FALHOU", rascunhoApagado: true }), /Nada foi enviado.*tente de novo/);
  assert.match(m({ erro: "ASSINATURA_OCUPADA" }), /outro envio.*em andamento/);
  assert.match(m({ erro: "CONTRATO_DESATUALIZADO" }), /Os dados mudaram depois de gerar o contrato — gere de novo/);
  assert.match(m({ erro: "CLICKSIGN_FALHOU", passo: "documento", http: 422, rascunhoApagado: true }), /Nada foi enviado aos signatários/);
  assert.match(m({ erro: "CLICKSIGN_FALHOU", passo: "documento", http: 422, envelopeId: "env-1", rascunhoApagado: false }),
               /apague o rascunho na Clicksign e use Atualizar situação/);
  assert.match(m({ erro: "CLICKSIGN_FALHOU", passo: "ativar", http: 0, envelopeId: "env-1", rascunhoApagado: false, incerto: true }),
               /não deu para confirmar.*Atualizar situação.*não envie de novo/);
  assert.match(m({ ok: true, aviso: "ASSINATURAS_INCOMPLETAS" }), /não registrou a assinatura de todos/);
  assert.match(m({ erro: "CLICKSIGN_SEM_LINK_ASSINADO: original" }), /PDF assinado/);
  assert.match(m({ erro: "CLICKSIGN_STATUS_DESCONHECIDO: paused" }), /situação que o portal não conhece/);
  assert.match(m({ erro: "COLUNA_FALTANDO: CONTRATO ASSINADO" }), /coluna CONTRATO ASSINADO/);
  assert.match(m({ erro: "SEM_PERMISSAO_TESTES" }), /TESTES não envia, não reenvia nem atualiza/);
  assert.match(m({ erro: "XYZ" }), /Algo deu errado \(XYZ\)/);
  assert.match(m({ ok: true, aviso: "NOTIFICACAO_FALHOU" }), /e-mail de aviso falhou/);
});

test("Enviar: sem confirmação não chama o servidor", async () => {
  const chamadas = [];
  const novo = await A.executarAcaoAssinatura("a-enviar", ctx(), { pageId: "p1", confirmar: () => false, chamar: async (x) => { chamadas.push(x); return { ok: true }; } });
  assert.equal(chamadas.length, 0);
  assert.equal(novo.estado.envelope, false);
});

test("Enviar confirmado: chama assinaturaEnviar uma vez e mostra a situação nova", async () => {
  const chamadas = [], perguntas = [];
  const novo = await A.executarAcaoAssinatura("a-enviar", ctx(), {
    pageId: "p1", confirmar: (t) => { perguntas.push(t); return true; },
    chamar: async (x) => { chamadas.push(x); return { ok: true, situacao: "ENVIADO", signatarios: [{ papel: "Comprador 1", assinou: false }] }; } });
  assert.deepEqual(chamadas, [{ action: "assinaturaEnviar", pageId: "p1" }]);
  assert.match(perguntas[0], /Enviar o contrato para assinatura\?/);
  assert.deepEqual(novo.estado, { situacao: "ENVIADO", envelope: true, signatarios: [{ papel: "Comprador 1", assinou: false }] });
  assert.equal(novo.ocupado, null);
  assert.match(novo.msg, /Enviado/);
});

test("Enviar com faltas: guarda a lista e a mensagem; estado não muda", async () => {
  const novo = await A.executarAcaoAssinatura("a-enviar", ctx(), { pageId: "p1", confirmar: () => true,
    chamar: async () => ({ ok: false, erro: "FALTAM_DADOS", faltas: ["Comprador 1: e-mail"] }) });
  assert.deepEqual(novo.faltas, ["Comprador 1: e-mail"]);
  assert.equal(novo.estado.envelope, false);
  assert.match(novo.msg, /Complete os dados/);
});

test("Enviar que deixou envelope na Clicksign (rascunho não apagado ou não anotado): o bloco passa a mostrar envelope e Atualizar", async () => {
  const rasc = await A.executarAcaoAssinatura("a-enviar", ctx(), { pageId: "p1", confirmar: () => true,
    chamar: async () => ({ ok: false, erro: "CLICKSIGN_FALHOU", passo: "documento", http: 500, envelopeId: "env-1", rascunhoApagado: false }) });
  assert.deepEqual(rasc.estado, { situacao: "RASCUNHO", envelope: true, signatarios: [] });
  const h = A.montarBlocoAssinatura(rasc);
  assert.match(botao(h, "a-enviar")[0], /disabled/);
  assert.doesNotMatch(botao(h, "a-atualizar")[0], /disabled/);
  const grav = await A.executarAcaoAssinatura("a-enviar", ctx(), { pageId: "p1", confirmar: () => true,
    chamar: async () => ({ ok: false, erro: "GRAVACAO_FALHOU", envelopeId: "env-1" }) });
  assert.deepEqual(grav.estado, { situacao: "", envelope: true, signatarios: [] });
  /* apagado: continua sem envelope (pode enviar de novo) */
  const apag = await A.executarAcaoAssinatura("a-enviar", ctx(), { pageId: "p1", confirmar: () => true,
    chamar: async () => ({ ok: false, erro: "CLICKSIGN_FALHOU", passo: "documento", http: 500, envelopeId: "env-1", rascunhoApagado: true }) });
  assert.equal(apag.estado.envelope, false);
  /* ENVELOPE_ABERTO (outra aba enviou): mostra o envelope com a situação que o servidor leu */
  const aberto = await A.executarAcaoAssinatura("a-enviar", ctx(), { pageId: "p1", confirmar: () => true,
    chamar: async () => ({ ok: false, erro: "ENVELOPE_ABERTO", situacao: "ENVIADO" }) });
  assert.deepEqual(aberto.estado, { situacao: "ENVIADO", envelope: true, signatarios: [] });
});

test("Atualizar: chama assinaturaEstado (sem confirmação) e troca o estado", async () => {
  const chamadas = [];
  const novo = await A.executarAcaoAssinatura("a-atualizar", ctx({ estado: ENVIADO }), { pageId: "p1", confirmar: () => { throw new Error("não devia perguntar"); },
    chamar: async (x) => { chamadas.push(x); return { ok: true, situacao: "ASSINADO", envelope: true, signatarios: [] }; } });
  assert.deepEqual(chamadas, [{ action: "assinaturaEstado", pageId: "p1" }]);
  assert.equal(novo.estado.situacao, "ASSINADO");
});

test("durante a chamada, pinta o bloco ocupado (se o painel passar pintar)", async () => {
  const pintados = [];
  await A.executarAcaoAssinatura("a-atualizar", ctx({ estado: ENVIADO }), { pageId: "p1", confirmar: () => true,
    pintar: (c) => pintados.push(c.ocupado), chamar: async () => { assert.deepEqual(pintados, ["atualizar"]); return { ok: true, situacao: "ENVIADO", envelope: true }; } });
  assert.deepEqual(pintados, ["atualizar"]);
});

test("servidor sem resposta (exceção): mensagem amigável, nada quebra", async () => {
  const novo = await A.executarAcaoAssinatura("a-atualizar", ctx({ estado: ENVIADO }), { pageId: "p1", confirmar: () => true,
    chamar: async () => { throw new Error("rede"); } });
  assert.match(novo.msg, /servidor não respondeu/);
  assert.equal(novo.estado, ENVIADO);
});

test("botão desabilitado não age (ex.: Enviar com envelope aberto)", async () => {
  let chamou = false;
  const novo = await A.executarAcaoAssinatura("a-enviar", ctx({ estado: ENVIADO }), { pageId: "p1", confirmar: () => true,
    chamar: async () => { chamou = true; return { ok: true }; } });
  assert.equal(chamou, false);
  assert.equal(novo.estado, ENVIADO);
});
