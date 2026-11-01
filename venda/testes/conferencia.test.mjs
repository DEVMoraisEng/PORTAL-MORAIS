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
  assert.equal(K.resumo(l, {}), "1 divergência, 1 item ilegível e 2 itens não anexados");
  assert.deepEqual(l.filter((x) => x.item === "f1-id").map((x) => x.semArquivo), [true, true]);
  assert.ok(!l.find((x) => x.item === "c1-end").semArquivo);
  assert.equal(K.resumo(l.filter((x) => x.item === "f1-id"), {}), "2 itens não anexados");
  assert.equal(K.resumo(l.filter((x) => x.item === "c1-end"), {}), "1 item ilegível");
  const confirmados = {}; l.forEach((x, i) => { if (x.situacao !== "ok") confirmados[i] = { por: "ana" }; });
  assert.equal(K.resumo(l, confirmados), "");
});

/* 31/10/2026: "Corrigir aqui" — a coluna da linha do condomínio de cada campo conferido */
test("camposParaCorrigir: comprador 1 é o PROPONENTE; o bloco COMPRADOR 1 só quando é ele que está preenchido", () => {
  const v = (m) => (n) => m[n] || "";
  assert.deepEqual(K.camposParaCorrigir("c1-id", "nome", false, v({ PROPONENTE: "Fulana Teste" })), [{ coluna: "PROPONENTE", rotulo: "Nome" }]);
  assert.deepEqual(K.camposParaCorrigir("c1-id", "cpf", false, v({ "CPF COMPRADOR 1": "11144477735" })), [{ coluna: "CPF COMPRADOR 1", rotulo: "CPF" }]);
  assert.deepEqual(K.camposParaCorrigir("c1-id", "cpf", true, v({ "CPF COMPRADOR 1": "11144477735" })), [{ coluna: "CPF PROPONENTE", rotulo: "CPF" }]);
  assert.deepEqual(K.camposParaCorrigir("c1-id", "rg", false, v({})), [{ coluna: "RG PROPONENTE", rotulo: "RG" }]);
  assert.deepEqual(K.camposParaCorrigir("c1-civil", "estado_civil", false, v({})),
    [{ coluna: "ESTADO CIVIL", rotulo: "Estado civil", opcoes: ["SOLTEIRO", "CASADO", "DIVORCIADO", "VIUVO", "UNIAO ESTAVEL"] }]);
});
test("camposParaCorrigir: endereço são cinco colunas; comprador 2 e fiadores; o resto não se corrige aqui", () => {
  const v = (m) => (n) => m[n] || "";
  const end = K.camposParaCorrigir("c1-end", "endereco", false, v({ "ENDEREÇO": "Rua Teste" }));
  assert.deepEqual(end.map((x) => x.coluna), ["ENDEREÇO", "NÚMERO", "SETOR", "CIDADE", "CEP"]);
  const bloco = K.camposParaCorrigir("c1-end", "endereco", false, v({ "ENDERECO COMPRADOR 1": "Rua Teste" }));
  assert.equal(bloco[0].coluna, "ENDERECO COMPRADOR 1");
  assert.equal(K.camposParaCorrigir("c1-end", "endereco", true, v({ "ENDERECO COMPRADOR 1": "Rua Teste" }))[0].coluna, "ENDEREÇO");
  assert.deepEqual(K.camposParaCorrigir("c2-id", "nome", true, v({})), [{ coluna: "COMPRADOR 1", rotulo: "Nome" }]);
  assert.deepEqual(K.camposParaCorrigir("c2-id", "nome", false, v({})), []);
  assert.deepEqual(K.camposParaCorrigir("f2-id", "cpf", false, v({})), [{ coluna: "CPF FIADOR 2", rotulo: "CPF" }]);
  assert.deepEqual(K.camposParaCorrigir("f1-id", "rg", false, v({})), []);
  assert.deepEqual(K.camposParaCorrigir("xx", "nome", false, v({})), []);
});
