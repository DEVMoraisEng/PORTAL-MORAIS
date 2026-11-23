/* 23/11/2026 (Gustavo): casa de rua — gerar o pré-contrato pergunta CASA PRONTA × CASA EM CONSTRUÇÃO. Sem dado real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("estado do contrato da casa de rua traz o tipo gravado; condomínio não", () => {
  const rua = D.estadoContrato({ ok: true, gerado: false, etapa: "NENHUM", casaDeRua: true, tipoCasa: "CASA EM CONSTRUÇÃO" });
  assert.equal(rua.casaDeRua, true);
  assert.equal(rua.tipoCasa, "CASA EM CONSTRUÇÃO");
  const cond = D.estadoContrato({ ok: true, gerado: false, etapa: "NENHUM" });
  assert.equal(cond.casaDeRua, undefined);
});

test("a pergunta mostra as duas opções, cada uma gera, e destaca a que vale hoje", () => {
  const h = D.htmlPerguntaTipo({ atual: "CASA EM CONSTRUÇÃO" }, "");
  assert.match(h, /pronta ou em construção/);
  assert.match(h, /Hoje a venda está como <b>CASA EM CONSTRUÇÃO<\/b>/);
  const botoes = [...h.matchAll(/<button[^>]*data-acao="c-tipo-escolher"[^>]*>/g)].map((m) => m[0]);
  assert.equal(botoes.length, 2);
  assert.ok(botoes.some((b) => /data-valor="CASA PRONTA"/.test(b) && /ghost/.test(b)), "pronta não é a atual: botão secundário");
  assert.ok(botoes.some((b) => /data-valor="CASA EM CONSTRUÇÃO"/.test(b) && !/ghost/.test(b)), "a atual fica em destaque");
  assert.match(h, /data-acao="c-tipo-cancelar"/);
});

test("sem tipo gravado, nenhuma opção vem destacada e o texto diz que falta", () => {
  const h = D.htmlPerguntaTipo({ atual: "" }, "");
  assert.match(h, /ainda não tem tipo de casa/);
  assert.equal([...h.matchAll(/class="bt bt-mini ghost" data-acao="c-tipo-escolher"/g)].length, 2);
});

test("a pergunta aparece no bloco do contrato quando pedida", () => {
  const e = D.estadoContrato({ ok: true, gerado: false, etapa: "NENHUM", casaDeRua: true, tipoCasa: "CASA PRONTA" });
  const h = D.htmlContrato(e, { perguntaTipo: { atual: "CASA PRONTA" }, rascunho: {} });
  assert.match(h, /Esta casa está pronta ou em construção\?/);
});

test("servidor manda casaDeRua e tipoCasa só no ramo da casa de rua", () => {
  const gs = fs.readFileSync(path.join(RAIZ, "venda", "GerarContrato.gs"), "utf8");
  const ini = gs.indexOf("function contratoEstado_("), fim = gs.indexOf("\nfunction ", ini + 10);
  const corpo = gs.slice(ini, fim), ramoRua = corpo.slice(corpo.indexOf("contaRecebEstado_"));
  assert.match(ramoRua, /r\.casaDeRua = true/);
  assert.match(ramoRua, /RegrasVenda\.COL\.TIPO_CASA/);
  assert.ok(corpo.indexOf("r.casaDeRua") > corpo.indexOf('info.base === "CONDOMINIO"'));
});
