import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../OpenAILeitor.js");

test("montarPedido: imagem vira input_image (data URL) e PDF vira input_file (documento-N.pdf), com esquema estrito", () => {
  const p = L.montarPedido("identidade", [{ mime: "image/jpeg", base64: "AAA" }, { mime: "application/pdf", base64: "BBB" }], "chave-x");
  assert.equal(p.url, "https://api.openai.com/v1/responses");
  assert.equal(p.headers["Authorization"], "Bearer chave-x");
  assert.equal(p.corpo.model, "gpt-6-luna");
  assert.equal(p.corpo.max_output_tokens, 16000);
  const c = p.corpo.input[0].content;
  assert.deepEqual(c[0], { type: "input_image", image_url: "data:image/jpeg;base64,AAA", detail: "high" });
  assert.deepEqual(c[1], { type: "input_file", filename: "documento-1.pdf", file_data: "data:application/pdf;base64,BBB" });
  assert.equal(c[2].type, "input_text");
  assert.equal(p.corpo.text.format.type, "json_schema");
  assert.equal(p.corpo.text.format.name, "leitura_identidade");
  assert.equal(p.corpo.text.format.strict, true);
  assert.deepEqual(p.corpo.text.format.schema, L.ESQUEMAS.identidade);
});

test("modelo padrão é gpt-6-luna; modelo passado é usado no corpo", () => {
  const p1 = L.montarPedido("identidade", [{ mime: "image/png", base64: "A" }], "k");
  assert.equal(p1.corpo.model, "gpt-6-luna");
  const p2 = L.montarPedido("identidade", [{ mime: "image/png", base64: "A" }], "k", "gpt-outro");
  assert.equal(p2.corpo.model, "gpt-outro");
});

test("esquemas são estritos: todo campo obrigatório e nada além (os mesmos do ClaudeLeitor)", () => {
  const C = require("../ClaudeLeitor.js");
  for (const nome of ["identidade", "comprovante", "aprovacao"]) {
    assert.deepEqual(L.ESQUEMAS[nome], C.ESQUEMAS[nome]);
  }
});

test("montarPedido recusa tipo de arquivo não suportado e lista vazia; tipo desconhecido lança", () => {
  assert.deepEqual(L.montarPedido("identidade", [{ mime: "image/heic", base64: "A" }], "k"), { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" });
  assert.deepEqual(L.montarPedido("identidade", [], "k"), { erro: "SEM_ARQUIVO" });
  assert.throws(() => L.montarPedido("outro", [{ mime: "image/png", base64: "A" }], "k"), /TIPO_DESCONHECIDO/);
});

function resposta({ status = "completed", output = [], usage } = {}) {
  return JSON.stringify(Object.assign({ status }, usage ? { usage } : {}, { output }));
}
function msg(texto) { return { type: "message", content: [{ type: "output_text", text: texto }] }; }

test("interpretarResposta lê o JSON do output_text e ignora item de reasoning antes da mensagem", () => {
  const corpo = resposta({
    output: [{ type: "reasoning", content: [] }, msg("{\"tipo_documento\":\"CNH\",\"nome\":\"ANA TESTE\"}")],
    usage: { input_tokens: 1500, output_tokens: 90 },
  });
  assert.deepEqual(L.interpretarResposta(200, corpo),
    { ok: true, leitura: { tipo_documento: "CNH", nome: "ANA TESTE" }, uso: { entrada: 1500, saida: 90 } });
});

test("interpretarResposta: refusal", () => {
  const corpo = resposta({ output: [{ type: "message", content: [{ type: "refusal", refusal: "não posso ajudar" }] }] });
  assert.deepEqual(L.interpretarResposta(200, corpo), { ok: false, erro: "LEITURA_RECUSADA" });
});

test("interpretarResposta: incomplete (max_output_tokens e outro motivo)", () => {
  const a = resposta({ status: "incomplete", output: [] });
  const b = JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
  const c = JSON.stringify({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] });
  assert.deepEqual(L.interpretarResposta(200, a), { ok: false, erro: "LEITURA_INCOMPLETA" });
  assert.deepEqual(L.interpretarResposta(200, b), { ok: false, erro: "LEITURA_INCOMPLETA" });
  assert.deepEqual(L.interpretarResposta(200, c), { ok: false, erro: "LEITURA_INCOMPLETA" });
});

test("interpretarResposta: erro 429 insufficient_quota (code) e 401 sem code (usa type), HTML 500 e texto não-JSON", () => {
  assert.deepEqual(L.interpretarResposta(429, JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota_error" } })),
    { ok: false, erro: "API_INSUFFICIENT_QUOTA" });
  assert.deepEqual(L.interpretarResposta(401, JSON.stringify({ error: { code: "", type: "invalid_api_key" } })),
    { ok: false, erro: "API_INVALID_API_KEY" });
  assert.deepEqual(L.interpretarResposta(500, "<html>erro</html>"), { ok: false, erro: "API_HTTP_500" });
  assert.deepEqual(L.interpretarResposta(200, resposta({ output: [msg("não é json")] })), { ok: false, erro: "RESPOSTA_ILEGIVEL" });
});
