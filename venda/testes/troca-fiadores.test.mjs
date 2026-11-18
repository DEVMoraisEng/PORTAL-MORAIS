/* Troca de fiadores (18/11/2026) no servidor: estado combinado com dois envelopes, colheita por tipo, pós-assinatura só
 * na primeira vez, permissão, trava do bloco Fiadores no modo troca, cancelar os termos sem tocar no contrato e o envio
 * dos termos novos num envelope próprio. Notion e Clicksign falsos; só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { criarGas, notionFalso, assinar, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const PAGE = PAGE_ID_PADRAO, DIA = 86400000;
const tokenDe = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + DIA });
const RAIZ = "https://sandbox.clicksign.com/api/v3";
const PDF = Buffer.from("%PDF-1.4 assinado de teste", "utf8");
const NOME_C = "RESIDENCIAL TESTE CASA 3 - Fulano de Teste.pdf";
const NOME_PRE = "CONFISSÃO PRÉ-CHAVES - RESIDENCIAL TESTE - CASA 3 - 01-11-2026.pdf";
const NOME_POS = "CONFISSÃO PÓS-CHAVES - RESIDENCIAL TESTE - CASA 3 - 01-11-2026.pdf";

const COLS = Object.assign({}, COLUNAS_REAIS, {
  "ENDEREÇO": "title", "ASSINATURA - ENVELOPE ID": "rich_text", "ASSINATURA - SITUAÇÃO": "rich_text", "CONTRATO ASSINADO": "files",
  "CONTRATO GERADO": "files", "ASSINATURA TERMOS - ENVELOPE ID": "rich_text", "ASSINATURA TERMOS - SITUAÇÃO": "rich_text",
  "CONFISSÃO PRÉ-CHAVES - ASSINADA": "files", "CONFISSÃO PÓS-CHAVES - ASSINADA": "files", "HISTÓRICO DO CONTRATO": "rich_text",
  "ASSINOU E ARMAZENOU CONTRATO": { tipo: "select", opcoes: ["SIM", "NÃO"] },
});
const sig = (id, nome, email) => ({ id, type: "signers", attributes: { name: nome, email, documentation: "000.000.001-91" } });
const ev = (name, email) => ({ attributes: { name, created: "2026-11-14T10:20:30.000-03:00", data: { signer: { email } } } });

/* Clicksign falsa com vários envelopes: envs[id] = { status, docs: [{ id, filename, status }], eventos: {docId: [...]}, signers } */
function csMulti(envs, falhar = () => null) {
  const chamadas = [];
  let seq = 0;
  const ok = (data, st = 200) => ({ status: st, json: { data } });
  function rota(url, opt) {
    if (url.startsWith("https://s3.clicksign.falso/")) return { buf: PDF, mime: "application/pdf" };
    if (!url.startsWith(RAIZ + "/")) return null;
    const metodo = String(opt.method || "get").toUpperCase(), caminho = url.slice(RAIZ.length);
    const corpo = typeof opt.payload === "string" ? JSON.parse(opt.payload) : null;
    chamadas.push({ metodo, caminho, corpo });
    const f = falhar(metodo, caminho, corpo);
    if (f) return f;
    if (metodo === "POST" && caminho === "/envelopes") {
      const id = "env-novo-" + (++seq);
      envs[id] = { status: "draft", docs: [], eventos: {}, signers: [], nome: corpo.data.attributes.name };
      return ok({ id, type: "envelopes", attributes: { status: "draft" } }, 201);
    }
    const m = /^\/envelopes\/([^/]+)(.*)$/.exec(caminho);
    const e = m && envs[decodeURIComponent(m[1])], resto = m ? m[2] : "";
    if (!e) return { status: 404, json: { errors: [{ title: "Registro não encontrado" }] } };
    if (metodo === "GET" && resto === "") return ok({ id: m[1], type: "envelopes", attributes: { status: e.status } });
    if (metodo === "PATCH" && resto === "") { e.status = corpo.data.attributes.status; e.docs.forEach((d) => { if (d.status === "draft") d.status = "running"; }); return ok({ id: m[1], attributes: { status: e.status } }); }
    if (metodo === "GET" && resto === "/documents") return ok(e.docs.map((d) => ({ id: d.id, type: "documents", attributes: { filename: d.filename, status: d.status },
      links: { files: d.status === "closed" ? { signed: "https://s3.clicksign.falso/assinado-" + d.id + ".pdf" } : { original: "https://s3.clicksign.falso/o.pdf" } } })));
    if (metodo === "POST" && resto === "/documents") { const d = { id: m[1] + "-doc-" + (e.docs.length + 1), filename: corpo.data.attributes.filename, status: "draft" }; e.docs.push(d); return ok({ id: d.id }, 201); }
    const de = /^\/documents\/([^/]+)\/events$/.exec(resto);
    if (metodo === "GET" && de) return ok((e.eventos || {})[de[1]] || []);
    const dp = /^\/documents\/([^/]+)$/.exec(resto);
    if (metodo === "PATCH" && dp) { const d = e.docs.find((x) => x.id === dp[1]); if (!d || d.status !== "running") return { status: 422, json: { errors: [{ title: "não pode" }] } }; d.status = "canceled"; return ok({ id: d.id }); }
    if (metodo === "GET" && resto === "/signers") return ok(e.signers);
    if (metodo === "POST" && resto === "/signers") { const s = { id: m[1] + "-sig-" + (e.signers.length + 1), type: "signers", attributes: corpo.data.attributes }; e.signers.push(s); return ok(s, 201); }
    if (metodo === "POST" && resto === "/requirements") { if (e.status !== "draft") return { status: 403, json: { errors: [{ title: "envelope não está com status draft" }] } }; return ok({ id: "req-" + (++seq), attributes: corpo.data.attributes }, 201); }
    if (metodo === "POST" && resto === "/notifications") return ok({ id: "not" }, 201);
    if (metodo === "DELETE" && resto === "") { delete envs[m[1]]; return { status: 204, texto: "" }; }
    return { status: 404, json: { errors: [{ title: "rota falsa inexistente" }] } };
  }
  return { rota, chamadas, envs };
}

function cenario({ envs, valores = {}, props = {}, falhar }) {
  const n = notionFalso({ colunas: COLS, valores: Object.assign({
    "ENDEREÇO": { title: [{ type: "text", plain_text: "RESIDENCIAL TESTE CASA 3", text: { content: "RESIDENCIAL TESTE CASA 3" } }] },
    "CONTRATO GERADO": { files: [{ name: "CONTRATO - RESIDENCIAL TESTE - CASA 3 [#abcd1234].pdf", type: "file", file: { url: "https://s3.falso/g" } }] },
  }, valores) });
  const c = csMulti(envs, falhar);
  const p = Object.assign({ NOTION_TOKEN: "ntn", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO, CLICKSIGN_TOKEN: "tk-teste" }, props);
  const g = criarGas({ props: p, rotas: (url, opt) => c.rota(url, opt) || n.rota(url, opt) });
  const pos = [];
  g.ctx.assPosAssinatura_ = (col, id) => { pos.push(id); };
  g.ctx.mcAnexosPosAssinatura_ = () => {};
  const txt = (col) => (n.pagina.properties[col].rich_text || []).map((t) => t.plain_text).join("");
  const arqs = (col) => (n.pagina.properties[col].files || []).map((f) => f.name);
  const acao = (action, extra = {}, tok = tokenDe()) => g.chamar(Object.assign({ action, token: tok, pageId: PAGE }, extra));
  return { g, n, c, p, txt, arqs, acao, pos };
}
const signersC = [sig("s1", "Fulano de Teste", "fulano@teste.example"), sig("s2", "Fiadora Antiga Teste", "fiadora@teste.example")];

test("contrato fechado e termos em andamento no mesmo envelope: ENVIADO + contrato colhido pelo tipo (fora de docs[0]); sem pós-assinatura", () => {
  const envs = { "env-c": { status: "running", signers: signersC, eventos: { c1: [ev("sign", "fulano@teste.example")] },
    docs: [{ id: "t1", filename: NOME_PRE, status: "running" }, { id: "t2", filename: NOME_POS, status: "running" }, { id: "c1", filename: NOME_C, status: "closed" }] } };
  const x = cenario({ envs, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO") } });
  x.p["ASSINATURA_PAPEIS_env-c"] = JSON.stringify({ s1: "Comprador 1", s2: "Fiador 2" });
  const r = x.acao("assinaturaEstado");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ENVIADO");
  assert.equal(r.contratoAssinado, true);
  assert.equal(x.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.equal(x.arqs("CONTRATO ASSINADO").length, 1, "contrato colhido mesmo com o envelope running");
  assert.equal(x.arqs("CONFISSÃO PRÉ-CHAVES - ASSINADA").length, 0);
  assert.deepEqual(x.pos, [], "pós-assinatura espera os termos");
  const hist = JSON.parse(x.p["ASS_HIST_" + PAGE]);
  assert.ok(!JSON.stringify(hist).includes("@") && !/\d{3}\.\d{3}\.\d{3}/.test(JSON.stringify(hist)), "ASS_HIST sem e-mail nem CPF");
  assert.deepEqual(r.jaAssinado.map((d) => [d.docId, d.tipo]), [["c1", "contrato"]]);
  assert.equal(r.jaAssinado[0].assinaram[0].papel, "Comprador 1");
  /* de novo: o contrato não é colhido outra vez */
  const r2 = x.acao("assinaturaEstado");
  assert.equal(r2.ok, true);
  assert.equal(x.arqs("CONTRATO ASSINADO").length, 1);
  assert.ok(!x.g.logs.some((l) => /@|000\.000/.test(l)), "log sem e-mail nem CPF");
});

test("com envelope de termos: termo cancelado não é colhido; ASSINADO só quando os termos novos fecham; pós-assinatura uma vez", () => {
  const envs = {
    "env-c": { status: "running", signers: signersC, eventos: {},
      docs: [{ id: "c1", filename: NOME_C, status: "closed" }, { id: "t1", filename: NOME_PRE, status: "canceled" }, { id: "t2", filename: NOME_POS, status: "canceled" }] },
    "env-t": { status: "running", signers: [sig("n1", "Fulano de Teste", "fulano@teste.example"), sig("n2", "Fiador Novo Teste", "novo@teste.example")], eventos: {},
      docs: [{ id: "n-pre", filename: NOME_PRE, status: "running" }, { id: "n-pos", filename: NOME_POS, status: "running" }] },
  };
  const x = cenario({ envs, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO"),
                                       "ASSINATURA TERMOS - ENVELOPE ID": texto("env-t"), "ASSINATURA TERMOS - SITUAÇÃO": texto("ENVIADO") } });
  let r = x.acao("assinaturaEstado");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.situacao, "ENVIADO");
  assert.equal(r.contratoAssinado, true);
  assert.equal(r.termos.situacao, "ENVIADO");
  assert.equal(x.arqs("CONTRATO ASSINADO").length, 1);
  assert.equal(x.arqs("CONFISSÃO PRÉ-CHAVES - ASSINADA").length, 0, "termo cancelado nunca é colhido");
  assert.ok(!x.c.chamadas.some((q) => /assinado-t[12]/.test(q.caminho)));
  /* os termos novos fecham */
  envs["env-t"].docs.forEach((d) => { d.status = "closed"; });
  envs["env-t"].status = "closed";
  r = x.acao("assinaturaEstado");
  assert.equal(r.situacao, "ASSINADO", JSON.stringify(r));
  assert.equal(x.txt("ASSINATURA - SITUAÇÃO"), "ASSINADO");
  assert.equal(x.txt("ASSINATURA TERMOS - SITUAÇÃO"), "ASSINADO");
  assert.deepEqual(x.arqs("CONFISSÃO PRÉ-CHAVES - ASSINADA"), ["ASSINADO - " + NOME_PRE]);
  assert.deepEqual(x.arqs("CONFISSÃO PÓS-CHAVES - ASSINADA"), ["ASSINADO - " + NOME_POS]);
  assert.deepEqual(x.pos, [PAGE], "pós-assinatura na primeira vez");
  x.acao("assinaturaEstado");
  assert.deepEqual(x.pos, [PAGE], "não repete");
});

test("sem envelope de termos e sem troca: as mesmas leituras de antes (nenhuma chamada a mais)", () => {
  const envs = { "env-c": { status: "running", signers: signersC, eventos: {}, docs: [{ id: "c1", filename: NOME_C, status: "running" }] } };
  const x = cenario({ envs, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO") } });
  const r = x.acao("assinaturaEstado");
  assert.equal(r.situacao, "ENVIADO");
  assert.deepEqual(x.c.chamadas.map((q) => q.metodo + " " + q.caminho),
    ["GET /envelopes/env-c", "GET /envelopes/env-c/documents", "GET /envelopes/env-c/documents/c1/events", "GET /envelopes/env-c/signers"]);
  assert.equal(x.p["ASS_HIST_" + PAGE], undefined, "nada fechado: sem registro");
});

test("permissão: o perfil TESTES não faz a prévia, não gera nem envia", () => {
  const x = cenario({ envs: {} });
  for (const a of ["trocarFiadoresPrevia", "trocarFiadoresGerar", "trocarFiadoresEnviar"])
    assert.deepEqual(x.acao(a, {}, tokenDe("TESTES")), { ok: false, erro: "SEM_PERMISSAO_TESTES" }, a);
  assert.equal(x.c.chamadas.length, 0);
});

test("prévia: só no condomínio", () => {
  const x = cenario({ envs: {}, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO") } });
  assert.deepEqual(x.acao("trocarFiadoresPrevia"), { ok: false, erro: "SO_CONDOMINIO" });
});

test("modo Trocar fiadores: o bloco Fiadores grava com o envelope aberto, só campos de fiador; fora do modo, a trava de sempre", () => {
  const x = cenario({ envs: {}, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO") } });
  const val = { "FIADOR 2": "Fiador Novo Teste", "CPF FIADOR 2": "000.000.005-15" };
  assert.equal(x.acao("salvarFiadores", { valores: val }).erro, "ENVELOPE_ABERTO");
  /* passou da trava: a ação responde por ela (a página do teste não é do condomínio) */
  assert.equal(x.acao("salvarFiadores", { valores: val, modoTroca: true }).erro, "SO_CONDOMINIO");
  assert.equal(x.acao("salvarFiadores", { valores: { CONJUGE: "Outra Pessoa" }, modoTroca: true }).erro, "COLUNA_NAO_PERMITIDA");
  const y = cenario({ envs: {}, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ASSINADO") } });
  assert.equal(y.acao("salvarFiadores", { valores: val, modoTroca: true }).erro, "CONTRATO_ASSINADO");
});

test("Cancelar com doc TERMOS cancela só o envelope de termos; o do contrato fica como está", () => {
  const envs = {
    "env-c": { status: "running", signers: signersC, eventos: {}, docs: [{ id: "c1", filename: NOME_C, status: "running" }, { id: "t1", filename: NOME_PRE, status: "canceled" }] },
    "env-t": { status: "running", signers: [], eventos: {}, docs: [{ id: "n-pre", filename: NOME_PRE, status: "running" }] },
  };
  const x = cenario({ envs, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO"),
                                       "ASSINATURA TERMOS - ENVELOPE ID": texto("env-t"), "ASSINATURA TERMOS - SITUAÇÃO": texto("ENVIADO") } });
  const r = x.acao("assinaturaCancelar", { doc: "TERMOS" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const patches = x.c.chamadas.filter((q) => q.metodo === "PATCH").map((q) => q.caminho);
  assert.deepEqual(patches, ["/envelopes/env-t/documents/n-pre"]);
  assert.equal(envs["env-c"].docs[0].status, "running");
  assert.equal(x.txt("ASSINATURA TERMOS - SITUAÇÃO"), "CANCELADO");
  assert.equal(x.txt("ASSINATURA - SITUAÇÃO"), "ENVIADO");
  assert.ok(/dos termos de confissão/.test(x.txt("HISTÓRICO DO CONTRATO")), x.txt("HISTÓRICO DO CONTRATO"));
});

/* preparo comum dos testes do envio: a conferência (trocaConferir_) e os termos gerados ficam falsos — o que se testa é a
   ordem rascunho → cancelar → ativar e o que acontece em cada falha */
const LISTA = [
  { papel: "Comprador 1", role: "buyer", nome: "Fulano de Teste", email: "fulano@teste.example", cpf: "000.000.001-91", origem: "comprador1", rubrica: true },
  { papel: "Vendedor (representante)", role: "seller", nome: "Representante Teste", email: "rep@teste.example", cpf: "000.000.002-72", origem: "representante" },
  { papel: "Fiador 2", role: "guarantor", nome: "Fiador Novo Teste", email: "novo@teste.example", cpf: "000.000.005-15", origem: "fiador2", soTermos: true },
];
function envioFalso(falhar) {
  const envs = { "env-c": { status: "running", signers: signersC, eventos: {},
    docs: [{ id: "c1", filename: NOME_C, status: "closed" }, { id: "t1", filename: NOME_PRE, status: "running" }, { id: "t2", filename: NOME_POS, status: "running" }] } };
  const x = cenario({ envs, falhar, valores: { "ASSINATURA - ENVELOPE ID": texto("env-c"), "ASSINATURA - SITUAÇÃO": texto("ENVIADO") } });
  x.p["TROCA_TERMOS_" + PAGE] = JSON.stringify({ carimbo: "c0ffee00", hash: "abcd1234" });
  const ctx = x.g.ctx;
  ctx.trocaConferir_ = () => {
    const pg = ctx.ctrLerPaginaVenda_(PAGE);
    return { x: { pg, d: { vendedor: { tipo: "PJ" }, condominio: {}, comprador1: { nome: "Fulano de Teste" } }, f: { endereco: "RESIDENCIAL TESTE", casa: "3" },
      config: ctx.assConfig_(PAGE), tipos: ["PRE", "POS"], alterados: [2], v: { ok: true, problemas: [] },
      /* como a conferência de verdade: só os termos ainda em andamento */
      cancelar: envs["env-c"].docs.filter((d) => d.id !== "c1" && d.status === "running").map((d) => ({ id: d.id, attributes: { filename: d.filename, status: d.status } })),
      envAntigo: "env-c", antigoEhTermos: false, T: ctx.trocaEnvTermos_(pg, PAGE), lista: ctx.TermosVenda.signatariosTermos(LISTA), carimbo: "c0ffee00", ignoradas: [] } };
  };
  ctx.cfdGerado_ = (pg, tipo) => ({ nome: (tipo === "PRE" ? NOME_PRE : NOME_POS).replace(/\.pdf$/, " [#abcd1234].pdf"), url: "https://s3.falso/t-" + tipo });
  ctx.baixarArquivo_ = () => ({ mime: "application/pdf", base64: PDF.toString("base64") });
  const prazo = new Date(Date.now() + 10 * DIA).toISOString().slice(0, 10);
  const st = () => JSON.parse(x.p["TROCA_TERMOS_" + PAGE]);
  const cham = () => x.c.chamadas.map((q) => q.metodo + " " + q.caminho);
  return { x, envs, prazo, st, cham, enviar: () => x.acao("trocarFiadoresEnviar", { prazo }) };
}

test("envio dos termos novos: rascunho completo → cancela os termos antigos → ativa; colunas, papéis e histórico", () => {
  const e = envioFalso();
  const r = e.enviar();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cancelados, 2);
  const cham = e.cham(), novo = r.envelopeId;
  const iNovo = cham.indexOf("POST /envelopes"), iUltimoReq = cham.lastIndexOf("POST /envelopes/" + novo + "/requirements");
  const iCancel = cham.indexOf("PATCH /envelopes/env-c/documents/t1"), iAtivar = cham.indexOf("PATCH /envelopes/" + novo);
  assert.ok(iNovo >= 0 && iUltimoReq > iNovo && iCancel > iUltimoReq && iAtivar > iCancel, "ordem: " + cham.join(" | "));
  assert.ok(!cham.includes("PATCH /envelopes/env-c/documents/c1"), "o contrato fechado não é tocado");
  assert.equal(e.envs[novo].status, "running");
  assert.deepEqual(e.envs[novo].docs.map((d) => d.filename), [NOME_PRE, NOME_POS], "o documento leva o nome sem o carimbo");
  assert.ok(/^TERMOS - /.test(e.envs[novo].nome));
  assert.equal(e.envs[novo].signers.length, 3);
  assert.equal(e.x.txt("ASSINATURA TERMOS - ENVELOPE ID"), novo);
  assert.equal(e.x.txt("ASSINATURA TERMOS - SITUAÇÃO"), "ENVIADO");
  assert.equal(e.x.txt("ASSINATURA - ENVELOPE ID"), "env-c", "o envelope do contrato continua na venda");
  assert.equal(e.st().ativado, true);
  assert.ok(e.x.p["ASSINATURA_PAPEIS_" + novo], "papéis guardados: o Trocar e-mail funciona no envelope dos termos");
  assert.ok(/trocou os fiadores: 2 termos antigos cancelados, termos novos no envelope /.test(e.x.txt("HISTÓRICO DO CONTRATO")), e.x.txt("HISTÓRICO DO CONTRATO"));
  assert.ok(!JSON.stringify(e.st()).includes("@"), "TROCA_TERMOS_ sem e-mail");
  /* de novo: não refaz nada */
  const antes = e.x.c.chamadas.length;
  const r2 = e.enviar();
  assert.equal(r2.jaFeito, true);
  assert.equal(e.x.c.chamadas.length, antes);
  assert.ok(!e.x.g.logs.some((l) => /@|000\.000|Fulano/.test(l)), "log sem dado pessoal");
});

test("falha 1 — criação do rascunho: apaga o rascunho e não cancela nada", () => {
  const e = envioFalso((m, c) => (m === "POST" && /\/signers$/.test(c) ? { status: 422, json: { errors: [{ title: "e-mail inválido" }] } } : null));
  const r = e.enviar();
  assert.equal(r.ok, false);
  assert.equal(r.erro, "CLICKSIGN_FALHOU");
  assert.equal(r.rascunhoApagado, true);
  assert.ok(!e.cham().some((c) => /^PATCH \/envelopes\/env-c\/documents/.test(c)), "nenhum termo antigo cancelado");
  assert.deepEqual(e.envs["env-c"].docs.map((d) => d.status), ["closed", "running", "running"]);
  assert.ok(!Object.keys(e.envs).some((k) => /^env-novo/.test(k)), "rascunho apagado na Clicksign");
  assert.equal(e.x.txt("ASSINATURA TERMOS - ENVELOPE ID"), "");
  const st = e.st();
  assert.ok(!st.ativado && !st.novoEnvelope && !st.cancelados);
});

test("falha 2 — cancelamento depois do rascunho pronto: para sem ativar; o Enviar continua de onde parou", () => {
  let falhaT2 = true;
  const e = envioFalso((m, c) => (falhaT2 && m === "PATCH" && c === "/envelopes/env-c/documents/t2" ? { status: 500, json: { errors: [{ title: "erro" }] } } : null));
  const r = e.enviar();
  assert.equal(r.ok, false);
  assert.equal(r.retomavel, true);
  assert.ok(r.mensagem && /continua de onde parou/.test(r.mensagem));
  const novo = e.st().novoEnvelope;
  assert.ok(novo && e.st().rascunhoPronto && !e.st().ativado);
  assert.equal(e.envs[novo].status, "draft", "não ativou");
  assert.deepEqual(e.envs["env-c"].docs.map((d) => d.status), ["closed", "canceled", "running"]);
  assert.equal(e.x.txt("ASSINATURA TERMOS - ENVELOPE ID"), "", "a venda ainda não aponta para o envelope novo");
  /* retoma: sem envelope novo, cancela o que faltou e ativa */
  falhaT2 = false;
  const antes = e.cham().filter((c) => c === "POST /envelopes").length;
  const r2 = e.enviar();
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.envelopeId, novo);
  assert.equal(e.cham().filter((c) => c === "POST /envelopes").length, antes, "não criou outro envelope");
  assert.equal(r2.cancelados, 2);
  assert.equal(e.envs[novo].status, "running");
  assert.equal(e.x.txt("ASSINATURA TERMOS - ENVELOPE ID"), novo);
  assert.equal(r2.termos.signatarios.length, 3);
});

test("falha 3 — ativação: os termos antigos já cancelados, o rascunho fica e o Enviar ativa depois", () => {
  let falhaAtivar = true;
  const e = envioFalso((m, c, corpo) => (falhaAtivar && m === "PATCH" && /^\/envelopes\/env-novo-\d+$/.test(c) && corpo.data.attributes.status === "running"
    ? { status: 422, json: { errors: [{ title: "não ativou" }] } } : null));
  const r = e.enviar();
  assert.equal(r.ok, false);
  assert.equal(r.retomavel, true);
  const novo = e.st().novoEnvelope;
  assert.equal(e.envs[novo].status, "draft");
  assert.deepEqual(e.envs["env-c"].docs.map((d) => d.status), ["closed", "canceled", "canceled"]);
  assert.equal(e.st().cancelados, 2);
  falhaAtivar = false;
  const r2 = e.enviar();
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.envelopeId, novo);
  assert.equal(r2.cancelados, 2, "não cancela de novo");
  assert.equal(e.envs[novo].status, "running");
  assert.equal(e.x.txt("ASSINATURA TERMOS - SITUAÇÃO"), "ENVIADO");
});
