/* 03/11/2026 (dono): telefone no contrato sempre "(DDD) xxxxx-xxxx". Números inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const C = req("../ContratoVenda.js");

test("telefone: celular e fixo no formato (DDD) xxxxx-xxxx / (DDD) xxxx-xxxx", () => {
  assert.equal(C.telefoneFormatado("62900000000"), "(62) 90000-0000");
  assert.equal(C.telefoneFormatado("62 90000-0000"), "(62) 90000-0000");
  assert.equal(C.telefoneFormatado("(62)90000-0000"), "(62) 90000-0000");
  assert.equal(C.telefoneFormatado("+55 62 90000-0000"), "(62) 90000-0000");
  assert.equal(C.telefoneFormatado("5562900000000"), "(62) 90000-0000");
  assert.equal(C.telefoneFormatado("062900000000"), "(62) 90000-0000");
  assert.equal(C.telefoneFormatado("6232000000"), "(62) 3200-0000");
});

test("telefone: o que não dá para entender sai como veio (nunca some dígito)", () => {
  assert.equal(C.telefoneFormatado("9000-0000"), "9000-0000");
  assert.equal(C.telefoneFormatado("123"), "123");
  assert.equal(C.telefoneFormatado(""), "");
  assert.equal(C.telefoneFormatado(null), "");
});
