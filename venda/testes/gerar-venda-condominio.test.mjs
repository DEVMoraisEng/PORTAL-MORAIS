/* gerarVendaCondominio (GerarVendaCondominio.gs) com Notion falso de duas bases:
 * a das vendas do condomínio (origem) e a VENDAS (destino). Dados inventados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarGas, assinar, COLUNAS_REAIS } from "./fakes.mjs";
import { P, SCHEMA_VENDAS, linhaCondominio } from "./condominio-dados.mjs";

const DIA = 86400000;
const tokenDe = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + DIA });
const DB_COND = "3f1c5ab5-32d3-81d3-8ba0-d495b1bc8123", DB_VENDAS = "db-vendas-falsa";
const COND_ID = "aaaaaaaabbbbccccddddeeeeeeeeeeee";
const COND_ID_HIFEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OUTRA_ID = "99999999999999999999999999999999";
const PROPS = { NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS, DB_VENDAS_COND: DB_COND.replace(/-/g, "") };

/* schema da VENDAS = colunas do dossiê (exigidas por todo pedido) + as do exemplo */
const COLS = Object.assign({}, COLUNAS_REAIS);
for (const [n, t] of Object.entries(SCHEMA_VENDAS)) if (!Object.keys(COLS).some((k) => k.trim() === n.trim())) COLS[n] = t;

function notionDuasBases({ linha = linhaCondominio(), colunas = COLS, s3Falha = [] } = {}) {
  const db = { properties: {} };
  for (const [nome, t] of Object.entries(colunas)) {
    const tipo = typeof t === "string" ? t : t.tipo;
    db.properties[nome] = { type: tipo, [tipo]: tipo === "select" ? { options: (t.opcoes || []).map((n) => ({ name: n })) } : {} };
  }
  const paginas = {
    [COND_ID]: { id: COND_ID_HIFEN, parent: { database_id: DB_COND }, properties: linha },
    [OUTRA_ID]: { id: OUTRA_ID, parent: { database_id: "outra-base" }, properties: linha },
  };
  const criadas = [], uploads = {}, patches = [];
  let seq = 0;
  const vazioDe = (t) => ({ [t]: ["files", "rich_text", "title"].includes(t) ? [] : null });
  function aplicar(pg, props) {
    for (const [nome, v] of Object.entries(props)) {
      const col = db.properties[nome];
      if (!col) return { status: 400, json: { message: "Could not find property" } };
      if (!(col.type in v)) return { status: 400, json: { message: "tipo errado em " + nome } };
    }
    for (const [nome, v] of Object.entries(props)) {
      const novo = JSON.parse(JSON.stringify(v));
      if (novo.files) novo.files = novo.files.map((f) => (f.file_upload ? { name: f.name, type: "file", file: { url: "https://s3.falso/" + f.file_upload.id } } : f));
      for (const k of ["rich_text", "title"]) if (novo[k]) novo[k] = novo[k].map((t) => Object.assign({ plain_text: t.text.content }, t));
      pg.properties[nome] = Object.assign({ type: db.properties[nome].type }, novo);
    }
    return { json: pg };
  }
  function rota(url, opt) {
    const m = String(opt.method || "get").toUpperCase();
    const corpo = typeof opt.payload === "string" ? JSON.parse(opt.payload) : null;
    if (url.startsWith("https://api.notion.com/v1")) {
      const u = url.slice("https://api.notion.com/v1".length);
      if (m === "GET" && u === "/databases/" + DB_VENDAS) return { json: db };
      if (m === "POST" && u === "/databases/" + DB_VENDAS + "/query") {
        const f = corpo.filter;
        if (!db.properties[f.property] || db.properties[f.property].type !== "rich_text" || !f.rich_text) return { status: 400, json: { message: "filtro inválido" } };
        const tx = (pg) => (pg.properties[f.property].rich_text || []).map((t) => t.plain_text).join("");
        return { json: { results: criadas.filter((pg) => tx(pg) === f.rich_text.equals), has_more: false } };
      }
      if (m === "POST" && u === "/pages") {
        if (corpo.parent.database_id !== DB_VENDAS) return { status: 400, json: { message: "base errada" } };
        const id = "nova-" + (++seq) + "-0000-0000-0000-000000000000";
        const pg = { id, parent: { database_id: DB_VENDAS }, properties: {} };
        for (const [nome, c] of Object.entries(db.properties)) pg.properties[nome] = Object.assign({ type: c.type }, vazioDe(c.type));
        const r = aplicar(pg, corpo.properties);
        if (r.status) return r;
        criadas.push(pg); paginas[id] = pg;
        return { json: pg };
      }
      const pid = /^\/pages\/(.+)$/.exec(u);
      if (pid && paginas[pid[1]]) {
        if (m === "GET") return { json: paginas[pid[1]] };
        if (m === "PATCH") { patches.push(corpo.properties); return aplicar(paginas[pid[1]], corpo.properties); }
      }
      if (m === "POST" && u === "/file_uploads") {
        const id = "fu-" + (++seq);
        uploads[id] = { nome: corpo.filename, mime: corpo.content_type };
        return { json: { id, upload_url: "https://upload.notion.falso/" + id } };
      }
      return { status: 404, json: { message: "rota falsa inexistente" } };
    }
    if (url.startsWith("https://upload.notion.falso/")) { uploads[url.split("/").pop()].buf = opt.payload.file._buf; return { json: {} }; }
    if (url.startsWith("https://s3.falso/")) {
      const nome = url.slice("https://s3.falso/".length);
      if (s3Falha.includes(nome)) return { status: 500, texto: "" };
      if (uploads[nome]) return { buf: uploads[nome].buf, mime: uploads[nome].mime };
      return { buf: Buffer.from("conteudo de " + nome), mime: "application/pdf" };
    }
    return null;
  }
  return { rota, criadas, uploads, patches };
}
function montar(op = {}) {
  const n = notionDuasBases(op);
  const g = criarGas({ props: Object.assign({}, PROPS, op.props || {}), rotas: n.rota });
  return { n, g };
}
const gerar = (g, extra = {}) => g.chamar(Object.assign({ action: "gerarVendaCondominio", token: tokenDe(), pageId: COND_ID }, extra));
const txt = (pg, col) => (pg.properties[col].rich_text || pg.properties[col].title || []).map((t) => t.plain_text).join("");
const nomes = (pg, col) => pg.properties[col].files.map((f) => f.name);

test("cria a casa na VENDAS com os dados e os arquivos", () => {
  const { g, n } = montar();
  const r = gerar(g);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.jaExistia, false);
  assert.equal(n.criadas.length, 1);
  const pg = n.criadas[0];
  assert.equal(r.pageId, pg.id);
  assert.equal(r.url, "vendas.html?abrir=" + encodeURIComponent(pg.id));
  assert.equal(txt(pg, "ENDEREÇO"), "CONDOMÍNIO RESERVA DE TESTE");
  assert.equal(txt(pg, "CLIENTES "), "ANA TESTE E BRUNO TESTE");
  assert.equal(txt(pg, "CPF "), "529.982.247-25");
  assert.equal(txt(pg, "CONDOMÍNIO - VENDA ID"), COND_ID, "id compacto, sem hífen");
  assert.equal(pg.properties["CASA"].number, 12);
  assert.equal(pg.properties["VALOR FINANCIADO"].number, 180000);
  assert.deepEqual(nomes(pg, "COMPRADOR 1 - IDENTIDADE"), ["rg-a.pdf"]);
  assert.deepEqual(nomes(pg, "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO"), ["luz-a.pdf"]);
  assert.deepEqual(nomes(pg, "COMPRADOR 2 - IDENTIDADE"), ["rg-b.pdf"]);
  assert.deepEqual(nomes(pg, "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO"), ["luz-b.pdf"]);
  assert.deepEqual(nomes(pg, "COMPROVANTE CARTÓRIO"), ["cartorio.pdf"]);
  assert.equal(r.arquivosCopiados.length, 6);
  assert.deepEqual(r.arquivosComFalha, []);
  /* o conteúdo foi reenviado (não é link para o arquivo do condomínio) */
  const up = Object.values(n.uploads).find((u) => u.nome === "rg-a.pdf");
  assert.equal(up.buf.toString(), "conteudo de rg-a.pdf");
});

test("idempotente: o segundo clique devolve a mesma casa sem criar outra nem copiar de novo", () => {
  const { g, n } = montar();
  const r1 = gerar(g);
  const subidos = Object.keys(n.uploads).length;
  const r2 = gerar(g);
  assert.equal(r2.ok, true);
  assert.equal(r2.jaExistia, true);
  assert.equal(r2.pageId, r1.pageId);
  assert.equal(n.criadas.length, 1);
  assert.equal(Object.keys(n.uploads).length, subidos);
});

test("atualizar: regrava os dados sem mexer em coluna de arquivo já preenchida", () => {
  const { g, n } = montar({ s3Falha: ["cartorio.pdf"] });
  gerar(g);
  const pg = n.criadas[0];
  assert.deepEqual(nomes(pg, "COMPROVANTE CARTÓRIO"), []);
  pg.properties["CLIENTES "].rich_text = [{ plain_text: "editado à mão" }];
  const subidos = Object.keys(n.uploads).length;
  const r = gerar(g, { atualizar: true });
  assert.equal(r.ok, true);
  assert.equal(r.jaExistia, true);
  assert.equal(n.criadas.length, 1);
  assert.equal(txt(pg, "CLIENTES "), "ANA TESTE E BRUNO TESTE");
  assert.deepEqual(nomes(pg, "COMPRADOR 1 - IDENTIDADE"), ["rg-a.pdf"], "não duplicou o que já estava");
  assert.equal(r.arquivosComFalha.length, 1, "o arquivo que falhou da primeira vez é tentado de novo");
  assert.equal(Object.keys(n.uploads).length, subidos);
});

test("página de outra base é recusada sem criar nada", () => {
  const { g, n } = montar();
  const r = gerar(g, { pageId: OUTRA_ID });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "PAGINA_DE_OUTRA_BASE");
  assert.equal(n.criadas.length, 0);
});

test("arquivo que falha não derruba a venda: vai para arquivosComFalha", () => {
  const { g, n } = montar({ s3Falha: ["luz-b.pdf"] });
  const r = gerar(g);
  assert.equal(r.ok, true);
  assert.equal(n.criadas.length, 1);
  assert.deepEqual(r.arquivosComFalha, [{ coluna: "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO", arquivo: "luz-b.pdf", erro: "DOWNLOAD_FALHOU" }]);
  assert.equal(r.arquivosCopiados.length, 5);
});

test("perfil TESTES não grava", () => {
  const { g, n } = montar();
  assert.equal(gerar(g, { token: tokenDe("TESTES") }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(n.criadas.length, 0);
});

test("sem DB_VENDAS_COND ou sem a coluna CONDOMÍNIO - VENDA ID: erro claro, nada criado", () => {
  let m = montar({ props: { DB_VENDAS_COND: "" } });
  assert.equal(gerar(m.g).erro, "BACKEND_SEM_CONFIG");
  const semCol = Object.assign({}, COLS); delete semCol["CONDOMÍNIO - VENDA ID"];
  m = montar({ colunas: semCol });
  assert.match(gerar(m.g).erro, /^COLUNA_FALTANDO: CONDOMÍNIO - VENDA ID/);
  assert.equal(m.n.criadas.length, 0);
});

test("coluna que a VENDAS não tem vai para colunasIgnoradas e a casa é criada", () => {
  const semAlgumas = Object.assign({}, COLS);
  delete semAlgumas["COMPRADOR 1 - E-MAIL"]; delete semAlgumas["COMPROVANTE CARTÓRIO"]; delete semAlgumas["CASA"];
  const { g, n } = montar({ colunas: semAlgumas });
  const r = gerar(g);
  assert.equal(r.ok, true);
  assert.equal(n.criadas.length, 1);
  for (const c of ["COMPRADOR 1 - E-MAIL", "CASA"]) assert.ok(r.colunasIgnoradas.includes(c), c);
  assert.ok(!r.arquivosCopiados.some((a) => a.arquivo === "cartorio.pdf"), "coluna inexistente não é copiada");
});

test("log não leva nome, CPF nem nome de arquivo", () => {
  const { g } = montar({ s3Falha: ["luz-b.pdf"] });
  gerar(g);
  const tudo = g.logs.join("\n");
  assert.doesNotMatch(tudo, /ANA|BRUNO|529|luz-b|rg-a/);
});

test("aviso do terceiro comprador chega na resposta", () => {
  const { g } = montar({ linha: linhaCondominio({ "COMPRADOR 2": P.texto("CARLA TESTE") }) });
  const r = gerar(g);
  assert.equal(r.avisos.length, 1);
});
