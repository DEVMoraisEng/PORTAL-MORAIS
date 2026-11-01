/* 01/11/2026 (teste e2e) — bloco "Fiadores" (e cônjuge do comprador) na aba Contrato do cartão do condomínio:
 * regras puras (venda/FiadoresVenda.js) e tela (venda-dossie.js, sem DOM). O servidor está em corrigir-servidor.test.mjs
 * e o caminho inteiro em tela-venda-condominio.test.mjs. Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const F = require("../FiadoresVenda.js");
const D = require("../../venda-dossie.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const COLS_FIADOR = (n) => ["FIADOR " + n, "CPF FIADOR " + n, "EMAIL FIADOR " + n, "ESTADO CIVIL FIADOR " + n,
  "CONJUGE FIADOR " + n, "CPF CONJUGE FIADOR " + n, "EMAIL CONJUGE FIADOR " + n];

test("(a) 36x sem fiador: precisa, 2 fiadores com os 7 campos vazios; título Fiadores", () => {
  const b = F.camposFiadores({}, [], 36);
  assert.equal(b.precisa, true);
  assert.equal(b.mostrar, true);
  assert.equal(b.titulo, "Fiadores");
  assert.deepEqual(b.fiadores.map((f) => f.n), [1, 2]);
  assert.deepEqual(b.fiadores[0].campos.map((c) => c.coluna), COLS_FIADOR(1));
  assert.deepEqual(b.fiadores[1].campos.map((c) => c.coluna), COLS_FIADOR(2));
  assert.ok(b.fiadores.every((f) => f.campos.every((c) => c.valor === "")));
  assert.deepEqual(b.fiadores[0].campos[3].opcoes, ["SOLTEIRO", "CASADO", "DIVORCIADO", "VIUVO", "UNIAO ESTAVEL"]);
  assert.equal(b.conjuge, null);
});

test("(b) 24x: não precisa de fiador (nem com fiador vazio); falta de fiador vinda do gerador abre mesmo em 24x", () => {
  const b = F.camposFiadores({}, [], 24);
  assert.equal(b.precisa, false);
  assert.equal(b.mostrar, false);
  assert.deepEqual(b.fiadores, []);
  const alt = F.camposFiadores({ "FIADOR 1": "FIADOR TESTE" }, ["Fiador 1: CPF"], 24);   /* 24x alterado com pós-chaves */
  assert.equal(alt.precisa, true);
  assert.equal(alt.fiadores[0].campos[0].valor, "FIADOR TESTE");
  assert.deepEqual(alt.faltas, ["Fiador 1: CPF"]);
});

test("36x com os dois fiadores completos e sem falta: o bloco fica fechado", () => {
  const linha = { "FIADOR 1": "FIADOR TESTE", "CPF FIADOR 1": "111.444.777-35", "FIADOR 2": "FIADORA TESTE", "CPF FIADOR 2": "529.982.247-25" };
  assert.equal(F.camposFiadores(linha, [], 36).mostrar, false);
});

test("cônjuge do comprador: só com a falta; título muda; REGIME DE BENS quando a base não tem REGIME", () => {
  const so = F.camposFiadores({ "CONJUGE": "CONJUGE TESTE" }, ["Cônjuge do comprador 1: CPF"], 24);
  assert.equal(so.precisa, false);
  assert.equal(so.mostrar, true);
  assert.equal(so.titulo, "Cônjuge do comprador");
  assert.deepEqual(so.conjuge.campos.map((c) => c.coluna), ["CONJUGE", "CPF CONJUGE", "EMAIL CONJUGE", "REGIME"]);
  assert.equal(so.conjuge.campos[0].valor, "CONJUGE TESTE");
  assert.ok(so.conjuge.campos[3].opcoes.includes("COMUNHÃO PARCIAL DE BENS"));
  const rb = F.camposFiadores({ "REGIME DE BENS": "" }, ["Cônjuge do comprador 1: regime de bens"], 24);
  assert.equal(rb.conjuge.campos[3].coluna, "REGIME DE BENS");
  const os2 = F.camposFiadores({}, ["Cônjuge do comprador 1: nome", "Fiador 2: CPF"], 36);
  assert.equal(os2.titulo, "Fiadores e cônjuge");
  assert.deepEqual(os2.faltas, ["Fiador 2: CPF", "Cônjuge do comprador 1: nome"]);
});

test("#74: fiador casado sem o par — aviso claro; botão 'o cônjuge é o Fiador 2' só com o cônjuge do fiador 1 salvo", () => {
  const falta = "Fiador 1: casado — o outro fiador tem de ser o cônjuge (CPF do cônjuge igual ao do outro fiador)";
  const sem = F.camposFiadores({ "ESTADO CIVIL FIADOR 1": "CASADO" }, [falta], 36);
  assert.match(sem.aviso, /cônjuge dele tem de ser o outro fiador/);
  assert.equal(sem.botaoConjuge, false);
  const com = F.camposFiadores({ "ESTADO CIVIL FIADOR 1": "CASADO", "CONJUGE FIADOR 1": "CONJUGE TESTE", "CPF CONJUGE FIADOR 1": "529.982.247-25" }, [falta], 36);
  assert.equal(com.botaoConjuge, true);
  const solteiro = F.camposFiadores({ "ESTADO CIVIL FIADOR 1": "SOLTEIRO", "CONJUGE FIADOR 1": "X", "CPF CONJUGE FIADOR 1": "529.982.247-25" }, [], 36);
  assert.equal(solteiro.botaoConjuge, false);
});

test("validarValores: lista fechada, CPF formatado, CPF/e-mail inválido recusa tudo", () => {
  assert.deepEqual(F.validarValores({ "FIADOR 1": " FIADOR TESTE ", "CPF FIADOR 1": "11144477735", "EMAIL FIADOR 1": "Fiador@Teste.Example" }),
    { ok: true, valores: { "FIADOR 1": "FIADOR TESTE", "CPF FIADOR 1": "111.444.777-35", "EMAIL FIADOR 1": "fiador@teste.example" } });
  assert.deepEqual(F.validarValores({ "FIADOR 1": "X", "MC - VENDA ID": "invasor" }), { ok: false, erro: "COLUNA_NAO_PERMITIDA", coluna: "MC - VENDA ID" });
  assert.equal(F.validarValores({ "FIADOR 3": "X" }).erro, "COLUNA_NAO_PERMITIDA");
  assert.equal(F.validarValores({ "CPF FIADOR 2": "111.444.777-00" }).erro, "CPF_INVALIDO");
  assert.equal(F.validarValores({ "EMAIL CONJUGE": "sem-arroba" }).erro, "EMAIL_INVALIDO");
  assert.deepEqual(F.validarValores({ "CPF FIADOR 2": "" }), { ok: true, valores: { "CPF FIADOR 2": "" } }, "vazio apaga");
  assert.equal(F.validarValores({}).erro, "NADA_PARA_GRAVAR");
  /* as colunas do cônjuge do comprador que o contrato lê (GerarContrato.gs) */
  for (const c of ["CONJUGE", "CPF CONJUGE", "EMAIL CONJUGE", "REGIME", "REGIME DE BENS"]) assert.ok(F.permitida(c), c);
  assert.equal(F.permitida("ESTADO CIVIL"), "", "o estado civil do comprador é da conferência, não deste bloco");
  assert.equal(F.PERMITIDAS.length, 19);
});

test("conjugeComoFiador2: copia o cônjuge para o Fiador 2 e espelha o Fiador 1 como cônjuge dele", () => {
  const linha = { "FIADOR 1": "FIADOR TESTE", "CPF FIADOR 1": "11144477735", "EMAIL FIADOR 1": "f1@teste.example", "ESTADO CIVIL FIADOR 1": "CASADO",
                  "CONJUGE FIADOR 1": "FIADORA TESTE", "CPF CONJUGE FIADOR 1": "529.982.247-25", "EMAIL CONJUGE FIADOR 1": "F2@teste.example" };
  assert.deepEqual(F.conjugeComoFiador2(linha).valores, {
    "FIADOR 2": "FIADORA TESTE", "CPF FIADOR 2": "529.982.247-25", "EMAIL FIADOR 2": "f2@teste.example", "ESTADO CIVIL FIADOR 2": "CASADO",
    "CONJUGE FIADOR 2": "FIADOR TESTE", "CPF CONJUGE FIADOR 2": "111.444.777-35", "EMAIL CONJUGE FIADOR 2": "f1@teste.example",
    "CPF CONJUGE FIADOR 1": "529.982.247-25" });
  assert.equal(F.conjugeComoFiador2({ ...linha, "ESTADO CIVIL FIADOR 1": "SOLTEIRO" }).erro, "FIADOR_1_NAO_CASADO");
  assert.equal(F.conjugeComoFiador2({ ...linha, "CPF CONJUGE FIADOR 1": "" }).erro, "CONJUGE_FIADOR_1_INCOMPLETO");
  assert.equal(F.conjugeComoFiador2({ ...linha, "FIADOR 1": "" }).erro, "FIADOR_1_INCOMPLETO");
});

/* ---- tela ---- */
const uic = (x = {}) => Object.assign({ ocupadoContrato: null, faltas: null, campos: null, rascunho: {}, msg: "", testes: false }, x);
const estado = (fiadores) => D.estadoContrato({ ok: true, gerado: false, etapa: "NENHUM", fiadores });

test("(h) tela: o bloco aparece na aba Contrato com rótulos data-rot, lista de estado civil e Salvar", () => {
  const b = F.camposFiadores({ "FIADOR 1": "FIADOR <TESTE>" }, ["Fiador 1: CPF"], 36);
  const e = estado(b);
  assert.equal(e.fiadores.titulo, "Fiadores");
  const h = D.htmlContrato(e, uic());
  assert.match(h, /<div class="dz-linha dz-grupo"><b>Fiadores<\/b><\/div>/);
  assert.match(h, /<b>Fiador 1<\/b>/);
  assert.match(h, /<b>Fiador 2<\/b>/);
  assert.match(h, /<label data-rot="CPF"><span>CPF<\/span><input type="text"[^>]*data-fia-col="CPF FIADOR 1"/);
  assert.match(h, /data-fia-col="FIADOR 1" value="FIADOR &lt;TESTE&gt;"/, "valor escapado");
  assert.match(h, /<input type="email"[^>]*data-fia-col="EMAIL FIADOR 1"/);
  assert.match(h, /<select data-fia-col="ESTADO CIVIL FIADOR 1"><option value="">—<\/option><option value="SOLTEIRO">SOLTEIRO<\/option>/);
  assert.match(h, /<li>Fiador 1: CPF<\/li>/, "a falta aparece dentro do bloco");
  assert.match(h, /data-acao="c-fia-salvar">Salvar fiadores<\/button>/);
  assert.doesNotMatch(h, /c-fia-conjuge/);
  /* 375 px: nada de largura fixa dentro do bloco */
  const bloco = h.slice(h.indexOf("dz-fia-bloco"));
  assert.doesNotMatch(bloco, /min-width|width:\s*\d{3}px/);
});

test("tela: a falta coberta pelo bloco sai da lista geral; TESTES desabilita; sem bloco quando não precisa", () => {
  const e = estado(F.camposFiadores({}, ["Fiador 1: CPF"], 36));
  const h = D.htmlContrato(e, uic({ faltas: ["Fiador 1: CPF", "Imóvel: CRI da matrícula"] }));
  assert.equal((h.match(/<li>Fiador 1: CPF<\/li>/g) || []).length, 1);
  assert.match(h, /<li>Imóvel: CRI da matrícula<\/li>/);
  const t = D.htmlContrato(e, uic({ testes: true }));
  assert.match(t, /data-fia-col="FIADOR 1" value="" disabled/);
  assert.match(t, /data-acao="c-fia-salvar" disabled/);
  assert.doesNotMatch(D.htmlContrato(estado(F.camposFiadores({}, [], 24)), uic()), /dz-fia/);
  assert.doesNotMatch(D.htmlContrato(D.estadoContrato({ ok: true, gerado: false }), uic()), /dz-fia/, "servidor antigo");
  /* o rascunho digitado volta ao repintar */
  assert.match(D.htmlContrato(e, uic({ rascunho: { "fia|CPF FIADOR 1": "111" } })), /data-fia-col="CPF FIADOR 1" value="111"/);
});

test("tela: título 'Fiadores e cônjuge' / 'Cônjuge do comprador', regime e o botão do #74", () => {
  const ambos = D.htmlContrato(estado(F.camposFiadores({}, ["Fiador 1: CPF", "Cônjuge do comprador 1: regime de bens"], 36)), uic());
  assert.match(ambos, /<b>Fiadores e cônjuge<\/b>/);
  assert.match(ambos, /<b>Cônjuge do comprador 1<\/b>/);
  assert.match(ambos, /data-acao="c-fia-salvar">Salvar fiadores e cônjuge<\/button>/);
  const so = D.htmlContrato(estado(F.camposFiadores({ "REGIME": "REGIME ANTIGO TESTE" }, ["Cônjuge do comprador 1: CPF"], 24)), uic());
  assert.match(so, /<b>Cônjuge do comprador<\/b>/);
  assert.doesNotMatch(so, /<b>Fiador 1<\/b>/);
  assert.match(so, /<select data-fia-col="REGIME"><option value="">—<\/option><option value="REGIME ANTIGO TESTE" selected>/, "o valor de hoje fica na lista");
  assert.match(so, /data-acao="c-fia-salvar">Salvar cônjuge<\/button>/);
  const falta = "Fiador 1: casado — o outro fiador tem de ser o cônjuge (CPF do cônjuge igual ao do outro fiador)";
  const c74 = D.htmlContrato(estado(F.camposFiadores({ "ESTADO CIVIL FIADOR 1": "CASADO", "CONJUGE FIADOR 1": "CONJUGE TESTE", "CPF CONJUGE FIADOR 1": "529.982.247-25" }, [falta], 36)), uic());
  assert.match(c74, /class="dz-aviso">Fiador casado: o cônjuge dele tem de ser o outro fiador/);
  assert.match(c74, /data-acao="c-fia-conjuge">O cônjuge do Fiador 1 é o Fiador 2<\/button>/);
});

test("valoresFiadores: só o que mudou em relação ao que a base tem; nada mudou = null", () => {
  const e = estado(F.camposFiadores({ "FIADOR 1": "FIADOR TESTE" }, [], 36));
  assert.deepEqual(D.valoresFiadores([{ coluna: "FIADOR 1", valor: "FIADOR TESTE" }, { coluna: "CPF FIADOR 1", valor: " 111.444.777-35 " }], e.fiadores),
    { "CPF FIADOR 1": "111.444.777-35" });
  assert.equal(D.valoresFiadores([{ coluna: "FIADOR 1", valor: "FIADOR TESTE" }, { coluna: "CPF FIADOR 1", valor: "" }], e.fiadores), null);
  assert.deepEqual(D.valoresFiadores([{ coluna: "FIADOR 1", valor: "" }], e.fiadores), { "FIADOR 1": "" }, "apagar também é mudança");
});

test("375 px: o CSS empilha os campos do bloco no celular e eles ocupam a largura toda", () => {
  const js = fs.readFileSync(path.join(RAIZ, "venda-dossie.js"), "utf8");
  assert.match(js, /\.vb-blocos \.dz-fia\{[^}]*flex-wrap:wrap/);
  assert.match(js, /\.vb-blocos \.dz-fia label\{[^}]*min-width:0/);
  assert.match(js, /@media \(max-width:600px\)\{[^"]*\.vb-blocos \.dz-fia label[^}]*width:100%/);
});

test("mensagens do bloco em português simples", () => {
  for (const e of ["COLUNA_NAO_PERMITIDA", "CPF_INVALIDO", "EMAIL_INVALIDO", "FIADOR_1_NAO_CASADO", "FIADOR_1_INCOMPLETO", "CONJUGE_FIADOR_1_INCOMPLETO", "NADA_PARA_GRAVAR", "SO_CONDOMINIO"]) {
    const m = D.mensagemContrato({ ok: false, erro: e });
    assert.ok(m && !/[A-Z]{3,}_[A-Z]/.test(m), e + " → " + m);
  }
});
