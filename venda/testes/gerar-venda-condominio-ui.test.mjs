/* Botão "Gerar venda" da tela do condomínio (venda/gerar-venda-condominio.js). Dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const G = createRequire(import.meta.url)("../gerar-venda-condominio.js");

const URL_PV = "https://script.google.com/macros/s/teste/exec";
const fetchQueResponde = (resp, guardar) => async (url, opt) => {
  if (guardar) guardar.push({ url, opt, corpo: JSON.parse(opt.body) });
  return { json: async () => resp };
};

test("chama o PORTAL-VENDA em text/plain com token e abre a casa", async () => {
  const pedidos = [];
  const r = await G.gerar({ pageId: "abc", urlPortalVenda: URL_PV, token: "tk-teste", urlVendas: "https://portal.exemplo.test/vendas.html" },
    fetchQueResponde({ ok: true, pageId: "id-novo", jaExistia: false, arquivosCopiados: [{}, {}], arquivosComFalha: [], colunasIgnoradas: [] }, pedidos));
  assert.equal(r.ok, true);
  assert.equal(r.ir, "https://portal.exemplo.test/vendas.html?abrir=id-novo");
  assert.match(r.texto, /^Venda gerada\. 2 arquivos copiados\.$/);
  assert.equal(pedidos[0].url, URL_PV);
  assert.equal(pedidos[0].opt.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(pedidos[0].corpo, { action: "gerarVendaCondominio", pageId: "abc", atualizar: false, token: "tk-teste" });
});

test("já existia, falhas e colunas ignoradas aparecem no resumo", () => {
  const t = G.resumo({ ok: true, jaExistia: true, arquivosCopiados: [],
    arquivosComFalha: [{ coluna: "COMPRADOR 1 - IDENTIDADE", arquivo: "doc.pdf" }], colunasIgnoradas: ["CASA"], avisos: ["aviso x"] });
  assert.match(t, /já tinha sido gerada/);
  assert.match(t, /doc\.pdf \(COMPRADOR 1 - IDENTIDADE\)/);
  assert.match(t, /colunas: CASA/);
  assert.match(t, /aviso x/);
});

test("erros viram português claro; sem URL configurada nem chama", async () => {
  assert.match(G.mensagemDeErro("PAGINA_DE_OUTRA_BASE"), /não é da base de vendas do condomínio/);
  assert.match(G.mensagemDeErro("COLUNA_FALTANDO: CONDOMÍNIO - VENDA ID (texto)"), /não tem a coluna CONDOMÍNIO - VENDA ID/);
  assert.match(G.mensagemDeErro("SEM_PERMISSAO_TESTES"), /TESTES/);
  assert.match(G.mensagemDeErro("XYZ"), /XYZ/);
  let chamou = false;
  const r = await G.gerar({ pageId: "abc", urlPortalVenda: "" }, async () => { chamou = true; });
  assert.equal(r.ok, false);
  assert.equal(chamou, false);
  assert.match(r.texto, /não foi ligado/);
});

test("rede caída: avisa para conferir antes de clicar de novo", async () => {
  const r = await G.gerar({ pageId: "abc", urlPortalVenda: URL_PV, token: "t" }, async () => { throw new Error("rede"); });
  assert.equal(r.ok, false);
  assert.match(r.texto, /confira na tela de vendas/);
});

test("destino respeita URL que já tem parâmetro", () => {
  assert.equal(G.destino({ pageId: "x" }, "vendas.html?v=2"), "vendas.html?v=2&abrir=x");
  assert.equal(G.destino({ pageId: "x" }), "vendas.html?abrir=x");
});
