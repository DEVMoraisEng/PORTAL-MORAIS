/* 05/11/2026: Ver e Excluir cada anexo do dossiê (verArquivoEspaco / excluirArquivoEspaco) e o seletor
 * "Compradores 1 | 2" mandando na aba Compradores do painel. Dados de teste só (repositório público). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { criarGas, assinar, notionFalso, texto, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");

const PAGE = PAGE_ID_PADRAO;
const DIA = 24 * 3600 * 1000;
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + DIA });
const arq = (nome, chave) => ({ name: nome, type: "file", file: { url: "https://s3.falso/" + chave } });

function montar(valores = {}) {
  const props = { NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: DB_ID_PADRAO, PROVEDOR_IA: "anthropic", ANTHROPIC_API_KEY: "sk-falsa" };
  const s3 = { frente: { buf: Buffer.from("frente-falsa"), mime: "image/jpeg" }, verso: { buf: Buffer.from("verso-falso"), mime: "image/jpeg" } };
  const n = notionFalso({ valores, s3 });
  const g = criarGas({ props, rotas: n.rota });
  return { n, g, props, chamar: (action, extra = {}, token = tokenDe()) => g.chamar(Object.assign({ action, token, pageId: PAGE }, extra)) };
}
const DOIS = { "COMPRADOR 1 - IDENTIDADE": { files: [arq("frente.jpg", "frente"), arq("verso.jpg", "verso")] } };

/* ---------------- servidor ---------------- */
test("estado devolve os nomes dos arquivos por espaço, sem tirar a contagem antiga", () => {
  const { chamar } = montar(DOIS);
  const r = chamar("estado");
  assert.equal(r.ok, true);
  assert.equal(r.arquivos.C1_IDENTIDADE, 2);
  assert.deepEqual(r.arquivosNomes.C1_IDENTIDADE, ["frente.jpg", "verso.jpg"]);
  assert.deepEqual(r.arquivosNomes.C1_COMPROVANTE, []);
  /* os espaços do imóvel entram quando a base tem as colunas dele (aqui o fake não tem: a seção responde o erro e não lista) */
  if (r.imovel.erro) assert.equal(r.arquivosNomes.IMOVEL_MATRICULA, undefined);
  else assert.ok(Array.isArray(r.arquivosNomes.IMOVEL_MATRICULA));
  assert.ok(!JSON.stringify(r.arquivosNomes).includes("https://"), "sem link na resposta");
});

test("verArquivoEspaco devolve o arquivo n em base64 (sem link); índice fora da lista = ARQUIVO_MUDOU; TESTES pode ver", () => {
  const { chamar } = montar(DOIS);
  const r = chamar("verArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 1 }, tokenDe("TESTES", []));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Buffer.from(r.base64, "base64").toString(), "verso-falso");
  assert.equal(r.nome, "verso.jpg"); assert.equal(r.n, 1); assert.equal(r.total, 2);
  assert.ok(!JSON.stringify(r).includes("https://"));
  assert.equal(chamar("verArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 5 }).erro, "ARQUIVO_MUDOU");
  assert.equal(chamar("verArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 0, nome: "outro.jpg" }).erro, "ARQUIVO_MUDOU");
  assert.equal(chamar("verArquivoEspaco", { espaco: "C1_COMPROVANTE", n: 0 }).erro, "SEM_ARQUIVO");
  assert.equal(chamar("verArquivoEspaco", { espaco: "QUALQUER", n: 0 }).erro, "ESPACO_DESCONHECIDO");
});

test("excluirArquivoEspaco tira só o arquivo n (os outros ficam), anota na observação e não mexe nos dados lidos", () => {
  const { chamar, n } = montar(Object.assign({}, DOIS, { "CLIENTES ": texto("ANA TESTE"), "DOSSIÊ": { select: { name: "CONFERIDO" } } }));
  const r = chamar("excluirArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 0, nome: "frente.jpg" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.total, 1);
  assert.equal(n.patches.length, 1, "uma escrita só");
  assert.deepEqual(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.map((f) => f.name), ["verso.jpg"]);
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files[0].type, "file", "o que fica é reenviado como file");
  assert.equal(n.pagina.properties["CLIENTES "].rich_text[0].plain_text, "ANA TESTE", "dado lido pela IA fica");
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "CONFERIDO", "espaço não ficou vazio: o dossiê fica");
  assert.match(n.pagina.properties["DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"].rich_text[0].text.content, /frente\.jpg excluído pelo portal/);
});

test("excluirArquivoEspaco com o nome diferente do arquivo n (a lista mudou) = ARQUIVO_MUDOU e nada é gravado", () => {
  const { chamar, n } = montar(DOIS);
  assert.equal(chamar("excluirArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 0, nome: "verso.jpg" }).erro, "ARQUIVO_MUDOU");
  assert.equal(chamar("excluirArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 0 }).erro, "ARQUIVO_MUDOU", "sem nome não exclui");
  assert.equal(chamar("excluirArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 2, nome: "verso.jpg" }).erro, "ARQUIVO_MUDOU");
  assert.equal(n.patches.length, 0);
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 2);
});

test("excluir o último arquivo: o espaço sai dos novos para ler e o dossiê conferido volta (FALTA DOCUMENTO se era obrigatório)", () => {
  const { chamar, n, props } = montar({ "COMPRADOR 1 - IDENTIDADE": { files: [arq("frente.jpg", "frente")] },
                                        "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO": { files: [arq("verso.jpg", "verso")] },
                                        "APROVAÇÃO DA CAIXA": { files: [arq("frente.jpg", "frente")] },
                                        "DOSSIÊ": { select: { name: "CONFERIDO" } } });
  const chave = "venda_pend_" + PAGE.replace(/-/g, "").toLowerCase();
  props[chave] = JSON.stringify({ C1_IDENTIDADE: "atualizar", APROVACAO: "atualizar" });
  const r = chamar("excluirArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 0, nome: "frente.jpg" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.total, 0);
  assert.equal(r.dossie, "FALTA DOCUMENTO");
  assert.deepEqual(r.pendentes, ["APROVACAO"]);
  assert.deepEqual(JSON.parse(props[chave]), { APROVACAO: "atualizar" });
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "FALTA DOCUMENTO");
  /* a aprovação não é obrigatória: tirá-la de um dossiê conferido volta a "a conferir" */
  const b = montar({ "COMPRADOR 1 - IDENTIDADE": { files: [arq("frente.jpg", "frente")] },
                     "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO": { files: [arq("verso.jpg", "verso")] },
                     "APROVAÇÃO DA CAIXA": { files: [arq("frente.jpg", "frente")] },
                     "DOSSIÊ": { select: { name: "CONFERIDO" } } });
  const r2 = b.chamar("excluirArquivoEspaco", { espaco: "APROVACAO", n: 0, nome: "frente.jpg" });
  assert.equal(r2.dossie, "LIDO PELA IA – CONFERIR");
  assert.equal(b.n.pagina.properties["DOSSIÊ"].select.name, "LIDO PELA IA – CONFERIR");
});

test("excluir com o dossiê DEVOLVIDO ou FALTA não muda a situação", () => {
  const { chamar, n } = montar({ "APROVAÇÃO DA CAIXA": { files: [arq("frente.jpg", "frente")] }, "DOSSIÊ": { select: { name: "DEVOLVIDO" } } });
  const r = chamar("excluirArquivoEspaco", { espaco: "APROVACAO", n: 0, nome: "frente.jpg" });
  assert.equal(r.ok, true); assert.equal(r.dossie, undefined);
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "DEVOLVIDO");
});

test("excluirArquivoEspaco: perfil TESTES não grava nada", () => {
  const { chamar, n } = montar(DOIS);
  assert.equal(chamar("excluirArquivoEspaco", { espaco: "C1_IDENTIDADE", n: 0, nome: "frente.jpg" }, tokenDe("TESTES", [])).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(n.patches.length, 0);
});

/* ---------------- tela: lista dos arquivos, Ver e Excluir com confirmação na linha ---------------- */
const DOC = D.DOCS[0];
const E = { tipoCasa: "CASA PRONTA", arquivos: { C1_IDENTIDADE: 2 }, arquivosNomes: { C1_IDENTIDADE: ["frente.jpg", "verso <b>.jpg"] }, pendentes: [] };

test("linhaDoc: o contador vira botão que abre a lista; fechada, a lista não aparece", () => {
  const h = D.linhaDoc(DOC, 2, E, { listas: {} }, false, "");
  assert.match(h, /data-acao="arquivos" data-espaco="C1_IDENTIDADE" aria-expanded="false"[^>]*>2 arquivos/);
  assert.doesNotMatch(h, /<ul class="dz-arqs">/);
  assert.match(h, /data-acao="trocar"/);
});

test("linhaDoc aberta: cada arquivo com Ver e Excluir (nome escapado)", () => {
  const h = D.linhaDoc(DOC, 2, E, { listas: { C1_IDENTIDADE: true } }, false, "");
  assert.match(h, /aria-expanded="true"/);
  assert.match(h, /<ul class="dz-arqs">/);
  assert.equal((h.match(/data-acao="ver-arq"/g) || []).length, 2);
  assert.equal((h.match(/data-acao="excluir-arq"/g) || []).length, 2);
  assert.match(h, /data-acao="ver-arq" data-espaco="C1_IDENTIDADE" data-n="1"/);
  assert.match(h, /verso &lt;b&gt;\.jpg/);
  assert.doesNotMatch(h, /Sim, excluir/);
});

test("linhaDoc: Excluir pede confirmação na própria linha (Sim, excluir / Cancelar), só no arquivo escolhido", () => {
  const h = D.linhaDoc(DOC, 2, E, { listas: { C1_IDENTIDADE: true }, excluir: { espaco: "C1_IDENTIDADE", n: 1 } }, false, "");
  assert.equal((h.match(/Sim, excluir/g) || []).length, 1);
  assert.match(h, /data-acao="excluir-sim" data-espaco="C1_IDENTIDADE" data-n="1"/);
  assert.match(h, /data-acao="excluir-nao"/);
  assert.equal((h.match(/data-acao="excluir-arq"/g) || []).length, 1, "o outro arquivo segue com Excluir");
});

test("linhaDoc: perfil TESTES vê (Ver ligado) mas não exclui; casa travada também não", () => {
  const h = D.linhaDoc(DOC, 2, E, { listas: { C1_IDENTIDADE: true }, testes: true }, false, "");
  assert.match(h, /data-acao="ver-arq"[^>]*data-n="0">Ver/);
  assert.match(h, /data-acao="excluir-arq"[^>]*disabled/);
  const t = D.linhaDoc(DOC, 2, E, { listas: { C1_IDENTIDADE: true } }, true, "");
  assert.match(t, /data-acao="excluir-arq"[^>]*disabled/);
});

test("linhaDoc: servidor antigo (sem arquivosNomes) mantém o contador em texto", () => {
  const h = D.linhaDoc(DOC, 2, { tipoCasa: "CASA PRONTA", arquivos: { C1_IDENTIDADE: 2 }, pendentes: [] }, {}, false, "");
  assert.doesNotMatch(h, /data-acao="arquivos"/);
  assert.match(h, /2 arquivos/);
});

test("mensagens novas da exclusão", () => {
  assert.match(D.mensagemDeErro("ARQUIVO_MUDOU"), /mudou/);
  assert.match(D.mensagemDeErro("CONTRATO_ASSINADO"), /assinado/);
  assert.doesNotMatch(D.mensagemDeErro("ESPACO_DESCONHECIDO"), /Algo deu errado/);
});

/* ---------------- seletor Compradores 1 | 2 ---------------- */
test("compradores: aviso quando o seletor está em 1 e o comprador 2 tem dados gravados", () => {
  const AVISO = "O comprador 2 tem dados gravados e vai sair no contrato. Apague os dados dele para tirá-lo.";
  const e = { tipoCasa: "CASA PRONTA", arquivos: {}, pendentes: [], comprador2ComDados: true };
  assert.ok(D.html(e, { dois: false }).includes(AVISO));
  assert.ok(!D.html(e, { dois: true }).includes(AVISO));
  assert.ok(!D.html(Object.assign({}, e, { comprador2ComDados: false }), { dois: false }).includes(AVISO));
  /* servidor antigo: doisCompradores também conta */
  assert.ok(D.html({ tipoCasa: "CASA PRONTA", arquivos: {}, pendentes: [], doisCompradores: true }, { dois: false }).includes(AVISO));
});

test("compradores: detalhe do evento dossie:compradores (1, 2 ou 0 = ainda não sabe)", () => {
  assert.equal(D.EVENTO_COMPRADORES, "dossie:compradores");
  assert.deepEqual(D.detalheCompradores("p1", { dois: true }), { pageId: "p1", n: 2 });
  assert.deepEqual(D.detalheCompradores("p1", { dois: false }), { pageId: "p1", n: 1 });
  assert.deepEqual(D.detalheCompradores("p1", null), { pageId: "p1", n: 0 });
});

test("vendas.html: aba Compradores marca o grupo do comprador 2, esconde por atributo no #painel e ouve o evento", () => {
  const h = fs.readFileSync(new URL("../../vendas.html", import.meta.url), "utf8");
  assert.match(h, /#painel\[data-compradores="1"\] #pn-body \[data-comprador2\]\{display:none\}/);
  assert.match(h, /addEventListener\("dossie:compradores"/);
  assert.match(h, /data-comprador2/);
  /* o cartão do condomínio não é tocado: a regra só vale dentro de #painel */
  assert.doesNotMatch(h, /cd-cardbox[^{]*data-compradores/);
});
