/* 27/11/2026: botão "Subir CRECI do corretor" no bloco do corretor da casa de rua (venda-dossie.js).
 * Dados FALSOS — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");
const cc = D.comissaoDoEstado({ corretor: "FULANO DE TAL", temCadastro: true, forma: "", colunasFaltando: [], campos: [] });

test("bloco do corretor: botão Subir CRECI do corretor, com alvo de toque de 44 px", () => {
  const h = D.htmlComissaoCorretor(cc, { rascunho: {} }, "");
  assert.match(h, /<button type="button" class="bt bt-mini" data-acao="c-creci-subir" style="min-height:44px">Subir CRECI do corretor<\/button>/);
  assert.match(D.htmlComissaoCorretor(cc, {}, " disabled"), /data-acao="c-creci-subir"[^>]* disabled>/, "perfil TESTES não sobe");
  assert.match(D.htmlComissaoCorretor(cc, { ocupadoContrato: "creci" }, ""), /data-acao="c-creci-subir"[^>]* disabled>[\s\S]*lendo o documento…/);
  /* sem corretor na venda ou com cadastro duplicado não há o que preencher */
  assert.doesNotMatch(D.htmlComissaoCorretor(D.comissaoDoEstado({ corretor: "", campos: [] }), {}, ""), /c-creci-subir/);
  assert.doesNotMatch(D.htmlComissaoCorretor(D.comissaoDoEstado({ corretor: "X", duplicado: true, campos: [] }), {}, ""), /c-creci-subir/);
});

test("mensagem curta: o que foi preenchido, o que diverge (cadastro × documento) e o que não deu para ler", () => {
  const r = { ok: true, preenchidos: ["CPF/CNPJ"], divergencias: [{ coluna: "CRECI", cadastro: "99.999-F", lido: "12.345-F" }],
    descartados: ["UF"], guardado: true, linhaNova: false };
  const l = D.resumoCreci(r);
  assert.deepEqual(l.map((x) => !!x.aviso), [false, true, true, false]);
  assert.match(l[0].texto, /^Preenchido no cadastro do corretor: CPF\/CNPJ\.$/);
  assert.match(l[1].texto, /Diverge — CRECI: cadastro "99\.999-F", documento "12\.345-F"\. Nada foi trocado/);
  assert.match(l[2].texto, /Não deu para ler com segurança: UF/);
  assert.match(l[3].texto, /Documento guardado/);
  const h = D.htmlResumoCreci(l);
  assert.match(h, /<div class="dz-aviso" data-creci-msg>Diverge/);
  assert.match(D.htmlComissaoCorretor(cc, { creci: l }, ""), /Preenchido no cadastro do corretor: CPF\/CNPJ\./);
});

test("mensagem: nada novo, cadastro criado, coluna do arquivo faltando e erros do servidor", () => {
  assert.match(D.resumoCreci({ ok: true, preenchidos: [], divergencias: [], descartados: [], guardado: true })[0].texto, /já está de acordo/);
  assert.match(D.resumoCreci({ ok: true, preenchidos: ["CRECI", "APELIDO"], linhaNova: true })[0].texto, /CRECI, APELIDO \(cadastro novo criado\)/);
  const sem = D.resumoCreci({ ok: true, preenchidos: ["CRECI"], guardado: false, aviso: "falta a coluna CRECI - DOCUMENTO", colunasFaltando: ["CPF/CNPJ"] });
  assert.ok(sem.some((x) => /não tem a coluna: CPF\/CNPJ/.test(x.texto)));
  assert.ok(sem.some((x) => /Documento não guardado: falta a coluna CRECI - DOCUMENTO em CORRETORES/.test(x.texto)));
  assert.match(D.resumoCreci({ ok: true, preenchidos: [], guardado: false, aviso: "UPLOAD_FALHOU" }).at(-1).texto, /não subiu/);
  assert.equal(D.resumoCreci({ ok: false, erro: "NAO_E_CRECI" }), null);
  assert.match(D.mensagemContrato({ ok: false, erro: "NAO_E_CRECI" }), /não parece ser o documento do CRECI/);
  assert.match(D.mensagemContrato({ ok: false, erro: "CRECI_ILEGIVEL" }), /Não consegui ler o CRECI/);
});

test("ligação: o clique chama a ação lerCreciCorretor com o arquivo, e o cache offline subiu de versão", () => {
  const fonte = readFileSync(new URL("../../venda-dossie.js", import.meta.url), "utf8");
  assert.match(fonte, /acao === "c-creci-subir"/);
  assert.match(fonte, /action: "lerCreciCorretor", pageId: pageId, arquivo: arqCr\.base64, mime: arqCr\.mime, nomeArquivo: arqCr\.nome/);
  const sw = readFileSync(new URL("../../sw.js", import.meta.url), "utf8");
  assert.match(sw, /const CACHE = "portal-morais-v441";/);
  assert.match(readFileSync(new URL("../../vendas.html", import.meta.url), "utf8"), /venda-dossie\.js\?v=105/);
});
