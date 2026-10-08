import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../ClaudeLeitor.js");

test("montarPedido: imagem e PDF viram blocos base64, com esquema, esforço baixo e fallback", () => {
  const p = L.montarPedido("identidade", [{ mime: "image/jpeg", base64: "AAA" }, { mime: "application/pdf", base64: "BBB" }], "chave-x");
  assert.equal(p.url, "https://api.anthropic.com/v1/messages");
  assert.equal(p.headers["x-api-key"], "chave-x");
  assert.equal(p.headers["anthropic-version"], "2023-06-01");
  assert.equal(p.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(p.corpo.model, "claude-opus-5");
  assert.equal(p.corpo.max_tokens, 16000);
  assert.equal(p.corpo.fallbacks, "default");
  assert.equal(p.corpo.output_config.effort, "low");
  assert.equal(p.corpo.output_config.format.type, "json_schema");
  assert.deepEqual(p.corpo.output_config.format.schema, L.ESQUEMAS.identidade);
  const c = p.corpo.messages[0].content;
  assert.deepEqual(c[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } });
  assert.deepEqual(c[1], { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBB" } });
  assert.equal(c[2].type, "text");
});

test("esquemas são estritos: todo campo obrigatório e nada além", () => {
  for (const nome of ["identidade", "comprovante", "aprovacao"]) {
    const s = L.ESQUEMAS[nome];
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(s.required.slice().sort(), Object.keys(s.properties).sort());
  }
});

test("montarPedido recusa tipo de arquivo que o Claude não lê e lista vazia", () => {
  assert.deepEqual(L.montarPedido("identidade", [{ mime: "image/heic", base64: "A" }], "k"), { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" });
  assert.deepEqual(L.montarPedido("identidade", [], "k"), { erro: "SEM_ARQUIVO" });
  assert.throws(() => L.montarPedido("outro", [{ mime: "image/png", base64: "A" }], "k"), /TIPO_DESCONHECIDO/);
});

test("interpretarResposta lê o JSON do bloco de texto e ignora blocos de pensamento", () => {
  const corpo = JSON.stringify({
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{\"tipo_documento\":\"CNH\",\"nome\":\"ANA TESTE\"}" }],
    usage: { input_tokens: 1500, output_tokens: 90 }
  });
  assert.deepEqual(L.interpretarResposta(200, corpo),
    { ok: true, leitura: { tipo_documento: "CNH", nome: "ANA TESTE" }, uso: { entrada: 1500, saida: 90 } });
});

test("interpretarResposta: recusa, corte, erro da API e lixo", () => {
  assert.deepEqual(L.interpretarResposta(200, JSON.stringify({ stop_reason: "refusal", content: [] })), { ok: false, erro: "LEITURA_RECUSADA" });
  assert.deepEqual(L.interpretarResposta(200, JSON.stringify({ stop_reason: "max_tokens", content: [] })), { ok: false, erro: "LEITURA_INCOMPLETA" });
  assert.deepEqual(L.interpretarResposta(429, JSON.stringify({ type: "error", error: { type: "rate_limit_error" } })), { ok: false, erro: "API_RATE_LIMIT_ERROR" });
  assert.deepEqual(L.interpretarResposta(500, "<html>"), { ok: false, erro: "API_HTTP_500" });
  assert.deepEqual(L.interpretarResposta(200, JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "não é json" }] })), { ok: false, erro: "RESPOSTA_ILEGIVEL" });
});
