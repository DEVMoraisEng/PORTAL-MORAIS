import { test } from "node:test";
import assert from "node:assert/strict";
import { criarGas, assinar, notionFalso, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const PROPS = { NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste", ANTHROPIC_API_KEY: "sk-falsa", DB_VENDAS: DB_ID_PADRAO, PROVEDOR_IA: "anthropic" };
const PAGE = PAGE_ID_PADRAO;
const DIA = 24 * 3600 * 1000;
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + DIA });
const JPG = Buffer.from("imagem-falsa").toString("base64");
const hojeBR = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());

function claudeResponde(leitura, extra = {}) {
  return () => ({ json: Object.assign({ stop_reason: "end_turn", usage: { input_tokens: 1500, output_tokens: 80 },
    content: [{ type: "text", text: JSON.stringify(leitura) }] }, extra) });
}
function montar({ valores, s3, colunas, claude } = {}) {
  const n = notionFalso({ valores, s3, colunas });
  const g = criarGas({ props: PROPS, rotas: (url, opt) =>
    url === "https://api.anthropic.com/v1/messages" ? (claude || claudeResponde({}))(url, opt) : n.rota(url, opt) });
  return { n, g };
}
const CNH = { tipo_documento: "CNH", nome: "ANA TESTE", cpf: "52998224725", numero_documento: "01234567890",
              orgao_emissor: "DETRAN/GO", nacionalidade: "brasileira", data_nascimento: "01/01/1990" };

test("ping responde sem token", () => {
  const { g } = montar();
  assert.deepEqual(g.chamar({ action: "ping" }), { ok: true, versao: "venda-v5", papel: "VENDA" });
});

test("token inválido, sem VENDAS, e TESTES tentando gravar", () => {
  const { g } = montar();
  assert.equal(g.chamar({ action: "estado", token: "x.y", pageId: PAGE }).erro, "NAO_AUTORIZADO");
  assert.equal(g.chamar({ action: "estado", token: assinar({ u: "a", t: "GERAL", a: ["VENDAS"], exp: 1 }), pageId: PAGE }).erro, "NAO_AUTORIZADO");
  assert.equal(g.chamar({ action: "estado", token: tokenDe("GERAL", ["LIGAÇÕES"]), pageId: PAGE }).erro, "SEM_PERMISSAO");
  assert.equal(g.chamar({ action: "estado", token: tokenDe("TESTES", []), pageId: PAGE }).ok, true);
  assert.equal(g.chamar({ action: "conferir", token: tokenDe("TESTES", []), pageId: PAGE }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(g.chamar({ action: "estado", token: tokenDe("ADM", []), pageId: PAGE }).ok, true);
});

test("coluna faltando e coluna de tipo errado viram erro claro, sem gravar nada", () => {
  const sem = Object.assign({}, COLUNAS_REAIS); delete sem["VALOR DO SUBSÍDIO"];
  const a = montar({ colunas: sem });
  assert.equal(a.g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).erro, "COLUNA_FALTANDO: VALOR DO SUBSÍDIO");
  const errado = Object.assign({}, COLUNAS_REAIS, { "APROVAÇÃO DA CAIXA": "rich_text" });
  const b = montar({ colunas: errado });
  assert.equal(b.g.chamar({ action: "tipoCasa", token: tokenDe(), pageId: PAGE, valor: "CASA DE RUA" }).erro, "TIPO_DE_COLUNA_ERRADO: APROVAÇÃO DA CAIXA");
  assert.equal(b.n.patches.length, 0);
});

test("pageId fora do formato do Notion vira PAGINA_INVALIDA", () => {
  const { g } = montar();
  assert.equal(g.chamar({ action: "estado", token: tokenDe(), pageId: "pag-1" }).erro, "PAGINA_INVALIDA");
  assert.equal(g.chamar({ action: "estado", token: tokenDe(), pageId: "" }).erro, "PAGINA_INVALIDA");
  assert.equal(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).ok, true);
});

test("página de outra base (parent.database_id diferente de DB_VENDAS) vira PAGINA_DE_OUTRA_BASE", () => {
  const n = notionFalso({ dbId: "outra-base-qualquer" });
  const g = criarGas({ props: PROPS, rotas: n.rota });
  const r = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(r.erro, "PAGINA_DE_OUTRA_BASE");
});

test("estado conta arquivos por espaço e diz se há dois compradores", () => {
  const { g } = montar({ valores: {
    "TIPO DE CASA": { select: { name: "CASA DE RUA" } },
    "COMPRADOR 1 - IDENTIDADE": { files: [{ name: "f.jpg", type: "file", file: { url: "https://s3.falso/a" } }] },
    "COMPRADOR 2 - NOME": texto("BRUNO TESTE"),
    "DOSSIÊ": { select: { name: "FALTA DOCUMENTO" } },
  } });
  const r = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(r.tipoCasa, "CASA DE RUA");
  assert.equal(r.arquivos.C1_IDENTIDADE, 1);
  assert.equal(r.arquivos.APROVACAO, 0);
  assert.equal(r.doisCompradores, true);
  assert.equal(r.dossie, "FALTA DOCUMENTO");
});

test("schema grande no Notion (300 colunas extras) não derruba estado_ — cache guarda só o resolvido", () => {
  const colunasGrandes = Object.assign({}, COLUNAS_REAIS);
  const sufixoComprido = "X".repeat(400);
  for (let i = 0; i < 300; i++) {
    colunasGrandes["COLUNA EXTRA DE TESTE NUMERO " + i + " " + sufixoComprido] = "rich_text";
  }
  const { g } = montar({ colunas: colunasGrandes });
  const r = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
});

test("tipoCasa grava a opção e recusa valor fora da lista", () => {
  const { g, n } = montar();
  assert.equal(g.chamar({ action: "tipoCasa", token: tokenDe(), pageId: PAGE, valor: "CASA DE CONDOMÍNIO" }).ok, true);
  assert.deepEqual(n.pagina.properties["TIPO DE CASA"].select, { name: "CASA DE CONDOMÍNIO" });
  assert.equal(g.chamar({ action: "tipoCasa", token: tokenDe(), pageId: PAGE, valor: "SOBRADO" }).erro, "TIPO_DE_CASA_INVALIDO");
});

test("conferir e devolver mudam o DOSSIÊ; devolver exige motivo e anota com data e login", () => {
  const { g, n } = montar();
  assert.equal(g.chamar({ action: "devolver", token: tokenDe(), pageId: PAGE, motivo: " " }).erro, "MOTIVO_OBRIGATORIO");
  assert.equal(g.chamar({ action: "devolver", token: tokenDe(), pageId: PAGE, motivo: "CNH ilegível" }).ok, true);
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "DEVOLVIDO");
  const obs = n.pagina.properties["DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"].rich_text[0].text.content;
  assert.match(obs, /ana\.teste\] Devolvido: CNH ilegível$/);
  assert.equal(g.chamar({ action: "conferir", token: tokenDe(), pageId: PAGE }).ok, true);
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "CONFERIDO");
});

test("lerDocumento com arquivo: sobe, lê, grava só o vazio e marca FALTA enquanto falta comprovante", () => {
  const { g, n } = montar({ claude: claudeResponde(CNH) });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.faltam, ["C1_COMPROVANTE"]);
  assert.equal(r.dossie, "FALTA DOCUMENTO");
  assert.equal(n.pagina.properties["CLIENTES "].rich_text[0].text.content, "ANA TESTE");
  assert.equal(n.pagina.properties["CPF "].rich_text[0].text.content, "529.982.247-25");
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 1);
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "FALTA DOCUMENTO");
  assert.equal(n.uploads["fu-1"].buf.toString(), "imagem-falsa");
});

test("RG em dois arquivos: um já no Notion e um novo vão juntos na mesma leitura, e o antigo é mantido", () => {
  const s3 = { frente: { buf: Buffer.from("frente"), mime: "image/png" } };
  let pedido = null;
  const { g, n } = montar({
    valores: { "COMPRADOR 1 - IDENTIDADE": { files: [{ name: "frente.png", type: "file", file: { url: "https://s3.falso/frente" } }] } },
    s3, claude: (url, opt) => { pedido = JSON.parse(opt.payload); return claudeResponde(Object.assign({}, CNH, { tipo_documento: "RG" }))(); },
  });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "verso.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(r.ok, true);
  const imagens = pedido.messages[0].content.filter((b) => b.type === "image");
  assert.equal(imagens.length, 2);
  assert.deepEqual(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.map((f) => f.name), ["frente.png", "verso.jpg"]);
});

test("trocar: o anexo substitui a lista da coluna (só o novo fica), sem reenviar os antigos", () => {
  const s3 = { frente: { buf: Buffer.from("frente"), mime: "image/png" } };
  const { g, n } = montar({
    valores: { "COMPRADOR 1 - IDENTIDADE": { files: [{ name: "frente.png", type: "file", file: { url: "https://s3.falso/frente" } }] } },
    s3, claude: claudeResponde(Object.assign({}, CNH, { tipo_documento: "RG" })),
  });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE", trocar: true,
                       arquivo: { nome: "novo.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(r.ok, true);
  assert.deepEqual(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.map((f) => f.name), ["novo.jpg"]);
});

test("trocar sem arquivo devolve TROCAR_SEM_ARQUIVO sem chamar o Claude nem subir nada", () => {
  const { g, n } = montar({ claude: () => { throw new Error("não devia chamar"); } });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE", trocar: true });
  assert.deepEqual(r, { ok: false, erro: "TROCAR_SEM_ARQUIVO" });
  assert.equal(Object.keys(n.uploads).length, 0);
});

test("trocar com campo ausente no documento novo limpa o campo no Notion ({rich_text: []})", () => {
  const { g, n } = montar({
    valores: { "CLIENTES ": texto("ANA TESTE"), "CPF ": texto("529.982.247-25"),
      "COMPRADOR 1 - IDENTIDADE": { files: [{ name: "velho.jpg", type: "file", file: { url: "https://s3.falso/velho" } }] } },
    s3: { velho: { buf: Buffer.from("velho"), mime: "image/jpeg" } },
    claude: claudeResponde({ tipo_documento: "CNH", nome: "", cpf: "", numero_documento: "", orgao_emissor: "",
      nacionalidade: "", data_nascimento: "", rg_numero: "", rg_orgao_uf: "" }),
  });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE", trocar: true,
                       arquivo: { nome: "novo.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(r.ok, true);
  assert.deepEqual(n.pagina.properties["CPF "].rich_text, []);
});

test("leitura falha depois de subir: arquivo fica, DOSSIÊ não muda, arquivoGuardado true", () => {
  const { g, n } = montar({ valores: { "DOSSIÊ": { select: { name: "CONFERIDO" } } },
    claude: () => ({ status: 529, json: { type: "error", error: { type: "overloaded_error" } } }) });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "APROVACAO",
                       arquivo: { nome: "caixa.pdf", mime: "application/pdf", base64: JPG } });
  assert.deepEqual(r, { ok: false, erro: "API_OVERLOADED_ERROR", arquivoGuardado: true });
  assert.equal(n.pagina.properties["APROVAÇÃO DA CAIXA"].files.length, 1);
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "CONFERIDO");
});

test("Claude sem resposta (exceção na rede) vira LEITURA_FALHOU", () => {
  const { g } = montar({ claude: () => ({ lancar: "Timeout" }) });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.deepEqual(r, { ok: false, erro: "LEITURA_FALHOU", arquivoGuardado: true });
});

test("gravação final falha depois da leitura: GRAVACAO_FALHOU, arquivo já guardado", () => {
  const n = notionFalso();
  let patchN = 0;
  const g = criarGas({ props: PROPS, rotas: (url, opt) => {
    if (url === "https://api.anthropic.com/v1/messages") return claudeResponde(CNH)();
    if (url === "https://api.notion.com/v1/pages/" + PAGE && String(opt.method || "").toUpperCase() === "PATCH") {
      patchN++;
      if (patchN === 2) return { lancar: "Notion indisponível" };
    }
    return n.rota(url, opt);
  } });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.deepEqual(r, { ok: false, erro: "GRAVACAO_FALHOU", arquivoGuardado: true });
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 1);
});

test("Ler de novo sem arquivo no espaço devolve SEM_ARQUIVO sem chamar o Claude", () => {
  const { g } = montar({ claude: () => { throw new Error("não devia chamar"); } });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE" });
  assert.deepEqual(r, { ok: false, erro: "SEM_ARQUIVO", arquivoGuardado: false });
});

test("arquivo em formato não aceito é recusado antes de subir", () => {
  const { g, n } = montar();
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "foto.heic", mime: "image/heic", base64: JPG } });
  assert.equal(r.erro, "TIPO_DE_ARQUIVO_NAO_SUPORTADO");
  assert.equal(Object.keys(n.uploads).length, 0);
});

test("com todos os documentos, marca LIDO PELA IA e anota observações com data e login", () => {
  const recente = hojeBR();
  const { g, n } = montar({
    valores: { "CLIENTES ": texto("ANA TESTE"),
      "COMPRADOR 1 - IDENTIDADE": { files: [{ name: "c.jpg", type: "file", file: { url: "https://s3.falso/c" } }] } },
    s3: { c: { buf: Buffer.from("c"), mime: "image/jpeg" } },
    claude: claudeResponde({ tipo_documento: "COMPROVANTE", titular: "OUTRA PESSOA", endereco_completo: "RUA TESTE, 1", data_emissao: recente }),
  });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_COMPROVANTE",
                       arquivo: { nome: "conta.pdf", mime: "application/pdf", base64: JPG } });
  assert.equal(r.dossie, "LIDO PELA IA – CONFERIR");
  assert.equal(r.observacoes.length, 1);
  const obs = n.pagina.properties["DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"].rich_text[0].text.content;
  assert.match(obs, /ana\.teste\] Comprovante do comprador 1: o comprovante está em nome de outra pessoa/);
});

test("download falha depois do upload: LEITURA_FALHOU, arquivo fica, DOSSIÊ inalterado", () => {
  const n = notionFalso();
  const g = criarGas({ props: PROPS, rotas: (url, opt) => {
    if (url.startsWith("https://s3.falso/")) return { lancar: "download falhou" };
    return n.rota(url, opt);
  } });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.deepEqual(r, { ok: false, erro: "LEITURA_FALHOU", arquivoGuardado: true });
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 1);
  assert.equal(n.pagina.properties["DOSSIÊ"].select, null);
});

test("nenhum log leva CPF ou nome", () => {
  const { g } = montar({ claude: claudeResponde(CNH) });
  g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
             arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  const tudo = g.logs.join("\n");
  assert.doesNotMatch(tudo, /529|ANA TESTE/);
  assert.match(tudo, /tokens 1500\/80/);
});

/* ---- provedor OpenAI (padrão) ---- */
function openaiResponde(leitura) {
  return () => ({ json: { status: "completed", usage: { input_tokens: 1500, output_tokens: 80 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(leitura) }] }] } });
}
function montarOpenai({ valores, s3, colunas, openai, props } = {}) {
  const n = notionFalso({ valores, s3, colunas });
  const g = criarGas({ props: Object.assign({ NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste",
      DB_VENDAS: DB_ID_PADRAO, OPENAI_API_KEY: "sk-openai-falsa" }, props),
    rotas: (url, opt) => url === "https://api.openai.com/v1/responses" ? (openai || openaiResponde({}))(url, opt) : n.rota(url, opt) });
  return { n, g };
}

test("caminho openai ponta a ponta: lê e grava CLIENTES e CPF", () => {
  const { g, n } = montarOpenai({ openai: openaiResponde(CNH) });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(r.ok, true);
  assert.equal(n.pagina.properties["CLIENTES "].rich_text[0].text.content, "ANA TESTE");
  assert.equal(n.pagina.properties["CPF "].rich_text[0].text.content, "529.982.247-25");
});

test("sem PROVEDOR_IA nas propriedades, usa openai (padrão)", () => {
  const { g, n } = montarOpenai({ openai: openaiResponde(CNH) });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(r.ok, true);
  assert.equal(n.pagina.properties["CLIENTES "].rich_text[0].text.content, "ANA TESTE");
});

test("MODELO_IA chega no corpo do pedido à OpenAI", () => {
  let pedido = null;
  const { g } = montarOpenai({
    props: { MODELO_IA: "gpt-modelo-especial" },
    openai: (url, opt) => { pedido = JSON.parse(opt.payload); return openaiResponde(CNH)(); },
  });
  g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
             arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.equal(pedido.model, "gpt-modelo-especial");
});

test("OPENAI_API_KEY faltando: CHAVE_IA_FALTANDO, arquivo guardado, nenhuma chamada à rede de IA", () => {
  const { g, n } = montarOpenai({ props: { OPENAI_API_KEY: "" }, openai: () => { throw new Error("não devia chamar"); } });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.deepEqual(r, { ok: false, erro: "CHAVE_IA_FALTANDO", arquivoGuardado: true });
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 1);
});

test("PROVEDOR_IA desconhecido vira PROVEDOR_IA_INVALIDO, arquivo guardado", () => {
  const { g, n } = montarOpenai({ props: { PROVEDOR_IA: "xpto" }, openai: () => { throw new Error("não devia chamar"); } });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
                       arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  assert.deepEqual(r, { ok: false, erro: "PROVEDOR_IA_INVALIDO", arquivoGuardado: true });
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 1);
});

test("log de leitura openai traz o nome do provedor e nunca a chave", () => {
  const { g } = montarOpenai({ openai: openaiResponde(CNH) });
  g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "C1_IDENTIDADE",
             arquivo: { nome: "cnh.jpg", mime: "image/jpeg", base64: JPG } });
  const tudo = g.logs.join("\n");
  assert.match(tudo, /PORTAL-VENDA leitura openai C1_IDENTIDADE tokens 1500\/80/);
  assert.doesNotMatch(tudo, /sk-openai-falsa/);
});
