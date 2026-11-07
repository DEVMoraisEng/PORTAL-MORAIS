/* 07/11/2026 (dono, unidade 14): "por que não trouxe aqui que tava faltando?" — a conferência pulava o campo vazio
 * no cadastro (RG do proponente) e não conferia o cônjuge (nome trocado e nascimento errado passaram).
 * Agora: vazio no cadastro e lido no documento = "falta no cadastro"; cônjuge do comprador 1 conferido pelo
 * DOC. CONJUGE (nome, CPF, RG, nascimento, nacionalidade); nacionalidade e nascimento também dos compradores.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const K = createRequire(import.meta.url)("../ConferenciaDocs.js");

const LINHA = { "DATA NASCIMENTO PROPONENTE": "1970-02-03", "RG CONJUGE": "", "DATA NASCIMENTO CONJUGE": "1971-04-05",
                "NACIONALIDADE CONJUGE": "BRASILEIRA", "DATA NASCIMENTO COMPRADOR 1": "" };
const v = (n) => LINHA[n] || "";
const D = {
  comprador1: { nome: "PROPONENTE TESTE SILVA", cpf: "529.982.247-25", documento: "", nacionalidade: "BRASILEIRA" },
  comprador2: { nome: "SEGUNDO TESTE SILVA", cpf: "111.444.777-35", documento: "RG 999 SSP GO", nacionalidade: "BRASILEIRO" },
  condominio: { fiadores: [], conjugeComprador: { nome: "CONJUGE DIARTE TESTE", cpf: "935.411.347-80" } },
};
const CNH = (o) => ({ ok: true, leitura: { tipo_documento: "CNH", nacionalidade: "BRASILEIRO", ...o } });

test("plano: cônjuge do comprador 1 entra pelo DOC. CONJUGE com nome, CPF, RG, nascimento e nacionalidade", () => {
  const p = K.plano(D, v);
  const cj = p.find((x) => x.id === "cj-id");
  assert.ok(cj, p.map((x) => x.id).join());
  assert.equal(cj.coluna, "DOC. CONJUGE");
  assert.equal(cj.pessoa, "Cônjuge do comprador 1");
  assert.deepEqual(cj.campos.map((c) => c.campo), ["nome", "cpf", "rg", "nacionalidade", "nascimento"]);
  assert.ok(K.COLUNAS.includes("DOC. CONJUGE"));
});

test("cônjuge que já é o comprador 2 não é conferido duas vezes; sem cônjuge, nada", () => {
  const casal = { ...D, condominio: { fiadores: [], conjugeComprador: { nome: "SEGUNDO TESTE SILVA", cpf: "111.444.777-35" } } };
  assert.equal(K.plano(casal, v).some((x) => x.id === "cj-id"), false);
  assert.equal(K.plano({ ...D, condominio: { fiadores: [] } }, v).some((x) => x.id === "cj-id"), false);
});

test("RG vazio no cadastro e lido na CNH: linha 'falta' com o valor do documento; vazio nos dois não aparece", () => {
  const itens = K.plano(D, v);
  const linhas = K.resultado(itens, {
    "c1-id": CNH({ nome: "PROPONENTE TESTE SILVA", cpf: "52998224725", rg_numero: "1234567 SESP GO", data_nascimento: "03/02/1970" }),
    "c2-id": CNH({ nome: "SEGUNDO TESTE SILVA", cpf: "11144477735", rg_numero: "999" }),
    "cj-id": CNH({ nome: "CONJUGE DUARTE TESTE", cpf: "93541134780", rg_numero: "7654321 SSP GO", data_nascimento: "05/04/1975" }),
  });
  const de = (item, campo) => linhas.find((l) => l.item === item && l.campo === campo);
  assert.deepEqual([de("c1-id", "rg").situacao, de("c1-id", "rg").lido], ["falta", "1234567 SESP GO"]);
  assert.equal(de("c1-id", "nascimento").situacao, "ok", "1970-02-03 = 03/02/1970");
  assert.equal(de("c2-id", "nascimento"), undefined, "vazio no cadastro e não lido: sem linha");
  assert.equal(de("cj-id", "nome").situacao, "diverge", "DIARTE × DUARTE");
  assert.equal(de("cj-id", "nascimento").situacao, "diverge", "1971 × 1975");
  assert.deepEqual([de("cj-id", "rg").situacao, de("cj-id", "rg").lido], ["falta", "7654321 SSP GO"]);
  assert.equal(de("cj-id", "cpf").situacao, "ok");
  assert.match(K.resumo(linhas, {}), /1 faltando no cadastro|2 faltando no cadastro/);
});

test("sem documento anexado, os campos vazios no cadastro não viram linha", () => {
  const linhas = K.resultado(K.plano(D, v), {});
  assert.equal(linhas.some((l) => l.campo === "rg" && l.item === "c1-id"), false);
  assert.ok(linhas.some((l) => l.item === "cj-id" && l.campo === "nome" && l.semArquivo));
});

test("nacionalidade: BR/Brasil/brasileiro(a) confere entre si; outra nacionalidade diverge", () => {
  assert.equal(K.comparar("nacionalidade", "BRASILEIRA", "BRASILEIRO").situacao, "ok");
  assert.equal(K.comparar("nacionalidade", "BR", "BRASILEIRO").situacao, "ok");
  assert.equal(K.comparar("nacionalidade", "PORTUGUESA", "BRASILEIRO").situacao, "diverge");
});

test("Corrigir aqui: cônjuge, RG vazio, nacionalidade e nascimento têm coluna", () => {
  assert.deepEqual(K.camposParaCorrigir("cj-id", "nome", true), [{ coluna: "CONJUGE", rotulo: "Nome" }]);
  assert.deepEqual(K.camposParaCorrigir("cj-id", "rg", true), [{ coluna: "RG CONJUGE", rotulo: "RG" }]);
  assert.deepEqual(K.camposParaCorrigir("cj-id", "nascimento", true), [{ coluna: "DATA NASCIMENTO CONJUGE", rotulo: "Nascimento" }]);
  assert.deepEqual(K.camposParaCorrigir("c1-id", "rg", true), [{ coluna: "RG PROPONENTE", rotulo: "RG" }]);
  assert.deepEqual(K.camposParaCorrigir("c1-id", "nacionalidade", true), [{ coluna: "NACIONALIDADE PROPONENTE", rotulo: "Nacionalidade" }]);
  assert.deepEqual(K.camposParaCorrigir("c2-id", "nascimento", true), [{ coluna: "DATA NASCIMENTO COMPRADOR 1", rotulo: "Nascimento" }]);
});

test("nascimento do cadastro aparece como 05/01/1972 na tela (era 1972-01-05)", () => {
  const cj = K.plano(D, v).find((x) => x.id === "cj-id");
  assert.equal(cj.campos.find((c) => c.campo === "nascimento").esperado, "05/04/1971");
  assert.equal(K.comparar("nascimento", "05/04/1971", "05/04/1971").situacao, "ok");
  assert.equal(K.comparar("nascimento", "05/04/1971", "05/04/1975").situacao, "diverge");
});
