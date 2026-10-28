/* ConferenciaDocs.js — conferência dos documentos antes do contrato do condomínio (28/10/2026). Dados inventados. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const K = createRequire(import.meta.url)("../ConferenciaDocs.js");

const D = {
  comprador1: { nome: "MARIA DE SOUZA TESTE", cpf: "529.982.247-25", documento: "RG 1234567 SSP/GO",
                endereco: "Rua das Palmeiras, 10 - Setor do Cliente - Cidade Teste/GO - CEP 74000-000", estadoCivil: "solteira" },
  comprador2: null,
  condominio: { fiadores: [{ nome: "FIADOR UM TESTE", cpf: "111.444.777-35" }, { nome: "", cpf: "" }] },
};

test("plano: comprador 1 (identidade, endereço, certidão) e só os fiadores que existem", () => {
  const p = K.plano(D);
  assert.deepEqual(p.map((x) => x.id), ["c1-id", "c1-end", "c1-civil", "f1-id"]);
  assert.deepEqual(p[0].campos.map((c) => c.campo), ["nome", "cpf", "rg"]);
  assert.deepEqual(p[3].campos.map((c) => c.campo), ["nome", "cpf"], "fiador: só nome e CPF");
  assert.equal(p[0].coluna, "DOC. PROPONENTE");
});

test("comparações: CPF por dígitos, nome com o do meio abreviado, endereço por palavras e CEP, estado civil pela certidão", () => {
  assert.equal(K.comparar("cpf", "529.982.247-25", "52998224725").situacao, "ok");
  assert.equal(K.comparar("cpf", "529.982.247-25", "52998224724").situacao, "diverge");
  assert.equal(K.comparar("nome", "MARIA DE SOUZA TESTE", "Maria de Souza Teste").situacao, "ok");
  assert.equal(K.comparar("nome", "MARIA DE SOUZA TESTE", "MARIA S. TESTE").situacao, "ok");
  assert.equal(K.comparar("nome", "MARIA DE SOUZA TESTE", "JOANA DE SOUZA TESTE").situacao, "diverge");
  assert.equal(K.comparar("rg", "RG 1234567 SSP/GO", "1234567").situacao, "ok");
  const end = "Rua das Palmeiras, 10 - Setor do Cliente - Cidade Teste/GO - CEP 74000-000";
  assert.equal(K.comparar("endereco", end, "R DAS PALMEIRAS 10 SETOR DO CLIENTE CIDADE TESTE GO 74000000").situacao, "ok");
  assert.equal(K.comparar("endereco", end, "Avenida Outra 99, Bairro Novo, Outra Cidade 75000-000").situacao, "diverge");
  assert.equal(K.comparar("estado_civil", "solteira", "SOLTEIRO").situacao, "ok");
  assert.equal(K.comparar("estado_civil", "solteira", "CASADO").situacao, "diverge");
  assert.equal(K.comparar("nome", "X TESTE", "").situacao, "ilegivel");
});

test("resultado: leitura OK, documento errado, sem arquivo; resumo conta divergência e pendente (confirmado não conta)", () => {
  const itens = K.plano(D);
  const leituras = {
    "c1-id": { ok: true, leitura: { tipo_documento: "CNH", nome: "MARIA DE SOUZA TESTE", cpf: "52998224725", rg_numero: "1234567", numero_documento: "" } },
    "c1-end": { ok: true, leitura: { tipo_documento: "OUTRO", endereco_completo: "" } },
    "c1-civil": { ok: true, leitura: { tipo_documento: "CERTIDAO_CASAMENTO", estado_civil: "", nome: "", regime_bens: "" } },
  };
  const l = K.resultado(itens, leituras);
  const sit = Object.fromEntries(l.map((x) => [x.item + ":" + x.campo, x.situacao]));
  assert.deepEqual(sit, { "c1-id:nome": "ok", "c1-id:cpf": "ok", "c1-id:rg": "ok", "c1-end:endereco": "ilegivel",
                          "c1-civil:estado_civil": "diverge", "f1-id:nome": "ilegivel", "f1-id:cpf": "ilegivel" });
  assert.equal(l.find((x) => x.item === "c1-end").motivo, "o arquivo não parece ser comprovante de endereço");
  assert.equal(l.find((x) => x.item === "f1-id").motivo, "documento não anexado");
  assert.equal(K.resumo(l, {}), "1 divergência e 3 itens sem conferir (ilegível ou sem documento)");
  const confirmados = {}; l.forEach((x, i) => { if (x.situacao !== "ok") confirmados[i] = { por: "ana" }; });
  assert.equal(K.resumo(l, confirmados), "");
});
