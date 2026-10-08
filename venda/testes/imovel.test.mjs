/* Entrega 11: documentos do imóvel (matrícula, alvará, habite-se) lidos pela IA.
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, assinar, notionFalso, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";
const require = createRequire(import.meta.url);
const R = require("../RegrasVenda.js");
const CV = require("../ContratoVenda.js");
const OA = require("../OpenAILeitor.js");
const CL = require("../ClaudeLeitor.js");
const D = require("../../venda-dossie.js");

const SITUACOES = ["FALTA DOCUMENTO", "LIDO PELA IA – CONFERIR", "CONFERIDO", "DEVOLVIDO"];
/* as colunas novas como serão criadas no Notion (entrega 11) + as CONTRATO - * que já existem */
const COLUNAS_IMOVEL = {
  "IMÓVEL - MATRÍCULA": "files", "IMÓVEL - ALVARÁ": "files", "IMÓVEL - HABITE-SE": "files",
  "DOSSIÊ IMÓVEL": { tipo: "select", opcoes: SITUACOES }, "DOSSIÊ IMÓVEL - OBSERVAÇÃO": "rich_text",
  "CONTRATO - MATRÍCULA INDIVIDUAL": "rich_text", "CONTRATO - CRI DA MATRÍCULA": "rich_text",
  "CONTRATO - ÁREA DO LOTE (M²)": "number", "CONTRATO - CONFRONTAÇÕES": "rich_text",
  "CONTRATO - ALVARÁ Nº": "rich_text", "CONTRATO - ALVARÁ DATA": "date", "CONTRATO - HABITE-SE Nº": "rich_text",
  "CONTRATO - MATRÍCULA DO LOTEAMENTO": "rich_text", "CONTRATO - CARTÓRIO DO LOTEAMENTO": "rich_text",
};
const COLUNAS = Object.assign({}, COLUNAS_REAIS, COLUNAS_IMOVEL);

const PROPS = { NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste", ANTHROPIC_API_KEY: "sk-falsa", DB_VENDAS: DB_ID_PADRAO, PROVEDOR_IA: "anthropic" };
const PAGE = PAGE_ID_PADRAO;
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + 86400000 });
const PDF = Buffer.from("%PDF-1.4 certidao falsa").toString("base64");
const CASA_DE_RUA = { "TIPO DE CASA": { select: { name: "CASA DE RUA" } } };

function claudeResponde(leitura) {
  return () => ({ json: { stop_reason: "end_turn", usage: { input_tokens: 2100, output_tokens: 120 },
    content: [{ type: "text", text: JSON.stringify(leitura) }] } });
}
function montar({ valores = CASA_DE_RUA, colunas = COLUNAS, claude, s3 } = {}) {
  const n = notionFalso({ valores, colunas, s3 });
  let chamouIA = 0;
  const g = criarGas({ props: Object.assign({}, PROPS), rotas: (url, opt) => {
    if (url === "https://api.anthropic.com/v1/messages") { chamouIA++; return (claude || claudeResponde({}))(url, opt); }
    return n.rota(url, opt);
  } });
  return { n, g, ia: () => chamouIA };
}
const enviar = (g, espaco, extra = {}) => g.chamar(Object.assign({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco,
  arquivo: { nome: "doc.pdf", mime: "application/pdf", base64: PDF } }, extra));
const txt = (n, col) => (n.pagina.properties[col].rich_text[0] || { text: { content: "" } }).text.content;

const MATRICULA = { tipo_documento: "MATRICULA", matricula_numero: " 98.765 ", cartorio: "Cartório de Registro de Imóveis da 9ª Circunscrição de Cidade Teste/GO",
  area_m2: "360,50 m²", confrontacoes: "Frente: 12,00 m para a Rua Teste;\n fundo: 12,00 m com o lote 99; lados: 30,00 m",
  loteamento_denominacao: "LOTEAMENTO JARDIM DE TESTE", loteamento_matricula: "11.111", loteamento_cartorio: "CRI da 9ª Circunscrição" };
const ALVARA = { tipo_documento: "ALVARA", numero: "ALV-2026/0001", data: "15/03/2026" };
const HABITESE = { tipo_documento: "HABITESE", numero: "HAB-2026/0042", data: "20/09/2026" };

/* ---------------- regras puras ---------------- */

test("tipos das colunas do imóvel batem com os que o contrato exige (ContratoVenda.TIPOS)", () => {
  for (const [col, tipo] of Object.entries(R.TIPOS_IMOVEL)) {
    /* as 2 do registro do loteamento são opcionais no contrato (o setor completa): não estão em ContratoVenda.TIPOS */
    if (col.startsWith("CONTRATO - ") && !/LOTEAMENTO/.test(col)) assert.equal(tipo, CV.TIPOS[col], col);
  }
  assert.equal(Object.keys(R.TIPOS_IMOVEL).filter((c) => c.startsWith("CONTRATO - ")).length, 9);
  assert.deepEqual(Object.values(COLUNAS_IMOVEL).map((t) => (typeof t === "string" ? t : t.tipo)),
    Object.keys(COLUNAS_IMOVEL).map((c) => R.TIPOS_IMOVEL[c]));
});

test("espaco(): acha os dois grupos e não aceita chave herdada", () => {
  assert.equal(R.espaco("C1_IDENTIDADE").tipo, "identidade");
  assert.equal(R.espaco("IMOVEL_MATRICULA").grupo, "imovel");
  assert.equal(R.espaco("constructor"), null);
  assert.equal(R.espaco(""), null);
});

test("areaM2 e dataValida normalizam e recusam lixo", () => {
  assert.equal(R.areaM2("360,50 m²"), 360.5);
  assert.equal(R.areaM2("360,00m2"), 360);
  assert.equal(R.areaM2("1.250,75"), 1250.75);
  assert.equal(R.areaM2("300"), 300);
  assert.equal(R.areaM2("300 metros quadrados"), 300);
  assert.equal(R.areaM2(""), null);
  assert.equal(R.areaM2("ilegível"), null);
  assert.equal(R.areaM2("0,00"), null);
  assert.equal(R.dataValida("15/03/2026"), "2026-03-15");
  assert.equal(R.dataValida("2026-03-15"), "2026-03-15");
  assert.equal(R.dataValida("31/02/2026"), "");
  assert.equal(R.dataValida("março de 2026"), "");
});

test("matrícula: preenche os campos da casa (com o registro do loteamento) e devolve o nome do loteamento só para a tela", () => {
  const p = R.planejarGravacao("IMOVEL_MATRICULA", MATRICULA, {}, "2026-10-08");
  const CI = R.COL_IMOVEL;
  assert.equal(p.props[CI.MATRICULA_INDIVIDUAL], "98.765");
  assert.match(p.props[CI.CRI], /^Cartório de Registro/);
  assert.equal(p.props[CI.AREA], 360.5);
  assert.equal(p.props[CI.CONFRONTACOES], "Frente: 12,00 m para a Rua Teste; fundo: 12,00 m com o lote 99; lados: 30,00 m");
  assert.deepEqual(p.loteamento, { denominacao: "LOTEAMENTO JARDIM DE TESTE", matricula: "11.111", cartorio: "CRI da 9ª Circunscrição" });
  assert.ok(Object.keys(p.props).every((c) => c.startsWith("CONTRATO - ")));
  assert.equal(p.props[CI.LOTEAMENTO_MATRICULA], "11.111", "registro do loteamento é da casa");
  assert.equal(p.props[CI.LOTEAMENTO_CARTORIO], "CRI da 9ª Circunscrição");
  assert.ok(!Object.values(p.props).includes("LOTEAMENTO JARDIM DE TESTE"), "o nome do loteamento é do setor");
  assert.ok(p.observacoes.some((o) => /nome do loteamento na certidão/.test(o)));
});

test("matrícula sem loteamento não devolve loteamento; área ilegível não grava e avisa", () => {
  const p = R.planejarGravacao("IMOVEL_MATRICULA", Object.assign({}, MATRICULA,
    { loteamento_denominacao: "", loteamento_matricula: "", loteamento_cartorio: "", area_m2: "trezentos" }), {}, "2026-10-08");
  assert.equal(p.loteamento, undefined);
  assert.ok(!(R.COL_IMOVEL.AREA in p.props));
  assert.ok(p.observacoes.some((o) => /área lida não é um número/.test(o)));
});

test("o último documento enviado vale: valor novo substitui; trocar com campo vazio limpa", () => {
  const CI = R.COL_IMOVEL;
  const atuais = { [CI.MATRICULA_INDIVIDUAL]: "11.000", [CI.CONFRONTACOES]: "antigas", [CI.AREA]: 300 };
  const p = R.planejarGravacao("IMOVEL_MATRICULA", Object.assign({}, MATRICULA, { confrontacoes: "" }), atuais, "2026-10-08", "atualizar");
  assert.equal(p.props[CI.MATRICULA_INDIVIDUAL], "98.765");
  assert.equal(p.props[CI.AREA], 360.5);
  assert.ok(!(CI.CONFRONTACOES in p.props), "atualizar não apaga o que o documento não traz");
  const t = R.planejarGravacao("IMOVEL_MATRICULA", Object.assign({}, MATRICULA, { confrontacoes: "" }), atuais, "2026-10-08", "trocar");
  assert.equal(t.props[CI.CONFRONTACOES], "");
});

test("alvará: número e data ISO; data impossível não grava e avisa", () => {
  const CI = R.COL_IMOVEL;
  const p = R.planejarGravacao("IMOVEL_ALVARA", ALVARA, {}, "2026-10-08");
  assert.deepEqual(p.props, { [CI.ALVARA_NUMERO]: "ALV-2026/0001", [CI.ALVARA_DATA]: "2026-03-15" });
  const ruim = R.planejarGravacao("IMOVEL_ALVARA", Object.assign({}, ALVARA, { data: "31/02/2026" }), { [CI.ALVARA_DATA]: "2026-01-01" }, "2026-10-08", "trocar");
  assert.ok(!(CI.ALVARA_DATA in ruim.props));
  assert.ok(ruim.observacoes.some((o) => /data do documento/.test(o)));
});

test("habite-se: grava o número; a data só volta e vira observação (o contrato usa a DATA HABITE-SE da obra)", () => {
  const p = R.planejarGravacao("IMOVEL_HABITESE", HABITESE, {}, "2026-10-08");
  assert.deepEqual(p.props, { [R.COL_IMOVEL.HABITESE_NUMERO]: "HAB-2026/0042" });
  assert.equal(p.habiteseData, "2026-09-20");
  assert.ok(p.observacoes.some((o) => /20\/09\/2026/.test(o) && /DATA HABITE-SE/.test(o)));
});

test("documento trocado de lugar (OUTRO, ou alvará no espaço do habite-se) não preenche nada", () => {
  const p = R.planejarGravacao("IMOVEL_HABITESE", ALVARA, {}, "2026-10-08");
  assert.deepEqual(p.props, {});
  assert.match(p.observacoes[0], /não parece ser o habite-se/);
  assert.deepEqual(R.planejarGravacao("IMOVEL_MATRICULA", { tipo_documento: "OUTRO" }, {}, "2026-10-08").props, {});
});

test("estado do imóvel: matrícula e alvará obrigatórios; habite-se não segura", () => {
  assert.deepEqual(R.estadoImovelAposLeitura({ IMOVEL_MATRICULA: 1, IMOVEL_ALVARA: 0, IMOVEL_HABITESE: 0 }),
    { estado: "FALTA DOCUMENTO", faltam: ["IMOVEL_ALVARA"] });
  assert.deepEqual(R.estadoImovelAposLeitura({ IMOVEL_MATRICULA: 1, IMOVEL_ALVARA: 2, IMOVEL_HABITESE: 0 }),
    { estado: "LIDO PELA IA – CONFERIR", faltam: [] });
});

/* ---------------- leitores (OpenAI e Claude) ---------------- */

test("esquemas novos: iguais nos dois provedores, estritos e com o pedido montado", () => {
  for (const nome of ["matricula", "alvara", "habitese"]) {
    assert.deepEqual(OA.ESQUEMAS[nome], CL.ESQUEMAS[nome]);
    const s = OA.ESQUEMAS[nome];
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(s.required.slice().sort(), Object.keys(s.properties).sort());
    const po = OA.montarPedido(nome, [{ mime: "application/pdf", base64: "B" }], "k");
    assert.equal(po.corpo.text.format.name, "leitura_" + nome);
    const pc = CL.montarPedido(nome, [{ mime: "application/pdf", base64: "B" }], "k");
    assert.deepEqual(pc.corpo.output_config.format.schema, s);
  }
  assert.deepEqual(Object.keys(OA.ESQUEMAS.matricula.properties).sort(),
    ["area_m2", "cartorio", "confrontacoes", "loteamento_cartorio", "loteamento_denominacao", "loteamento_matricula", "matricula_numero", "tipo_documento"]);
});

/* ---------------- PortalVenda.gs ---------------- */

test("estado traz a seção do imóvel (arquivos, situação, dados) quando as colunas existem", () => {
  const { g } = montar({ valores: Object.assign({}, CASA_DE_RUA, {
    "IMÓVEL - MATRÍCULA": { files: [{ name: "m.pdf", type: "file", file: { url: "https://s3.falso/m" } }] },
    "DOSSIÊ IMÓVEL": { select: { name: "FALTA DOCUMENTO" } },
    "CONTRATO - ÁREA DO LOTE (M²)": { number: 250 },
    "CONTRATO - ALVARÁ DATA": { date: { start: "2026-03-15" } },
    "CONTRATO - MATRÍCULA INDIVIDUAL": texto("12.345"),
  }) });
  const r = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.imovel.arquivos, { IMOVEL_MATRICULA: 1, IMOVEL_ALVARA: 0, IMOVEL_HABITESE: 0 });
  assert.equal(r.imovel.dossie, "FALTA DOCUMENTO");
  assert.equal(r.imovel.dados.area, 250);
  assert.equal(r.imovel.dados.alvaraData, "2026-03-15");
  assert.equal(r.imovel.dados.matricula, "12.345");
});

test("sem as colunas novas: o dossiê do comprador segue; só a seção do imóvel avisa", () => {
  const { g, n, ia } = montar({ colunas: COLUNAS_REAIS });
  const r = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.match(r.imovel.erro, /^COLUNA_FALTANDO: IMÓVEL - MATRÍCULA/);
  const l = enviar(g, "IMOVEL_MATRICULA");
  assert.equal(l.ok, false);
  assert.match(l.erro, /^COLUNA_FALTANDO/);
  assert.equal(Object.keys(n.uploads).length, 0, "nada sobe sem as colunas");
  assert.equal(ia(), 0);
  assert.match(g.chamar({ action: "conferir", grupo: "imovel", token: tokenDe(), pageId: PAGE }).erro, /^COLUNA_FALTANDO/);
  assert.equal(n.patches.length, 0);
});

test("coluna do imóvel com tipo errado vira TIPO_DE_COLUNA_ERRADO só na seção", () => {
  const { g } = montar({ colunas: Object.assign({}, COLUNAS, { "CONTRATO - ALVARÁ DATA": "rich_text" }) });
  const r = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.equal(r.imovel.erro, "TIPO_DE_COLUNA_ERRADO: CONTRATO - ALVARÁ DATA");
});

test("matrícula ponta a ponta: sobe, lê, grava as CONTRATO - *, marca o DOSSIÊ IMÓVEL e não mexe no dossiê do comprador", () => {
  const { g, n } = montar({ claude: claudeResponde(MATRICULA) });
  const r = enviar(g, "IMOVEL_MATRICULA");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.grupo, "imovel");
  assert.equal(r.dossie, "FALTA DOCUMENTO");
  assert.deepEqual(r.faltam, ["IMOVEL_ALVARA"]);
  assert.equal(r.loteamento.denominacao, "LOTEAMENTO JARDIM DE TESTE");
  assert.equal(txt(n, "CONTRATO - MATRÍCULA INDIVIDUAL"), "98.765");
  assert.equal(n.pagina.properties["CONTRATO - ÁREA DO LOTE (M²)"].number, 360.5);
  assert.equal(n.pagina.properties["IMÓVEL - MATRÍCULA"].files.length, 1);
  assert.equal(n.pagina.properties["DOSSIÊ IMÓVEL"].select.name, "FALTA DOCUMENTO");
  assert.match(txt(n, "DOSSIÊ IMÓVEL - OBSERVAÇÃO"), /nome do loteamento na certidão/);
  assert.equal(n.pagina.properties["DOSSIÊ"].select, null, "o DOSSIÊ do comprador fica como estava");
  assert.deepEqual(n.pagina.properties["DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"].rich_text, []);
});

test("alvará grava a data como date do Notion; com matrícula e alvará, LIDO PELA IA – CONFERIR", () => {
  const { g, n } = montar({ claude: claudeResponde(ALVARA), valores: Object.assign({}, CASA_DE_RUA, {
    "IMÓVEL - MATRÍCULA": { files: [{ name: "m.pdf", type: "file", file: { url: "https://s3.falso/m" } }] } }) });
  const r = enviar(g, "IMOVEL_ALVARA");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.dossie, "LIDO PELA IA – CONFERIR");
  assert.deepEqual(n.pagina.properties["CONTRATO - ALVARÁ DATA"].date, { start: "2026-03-15" });
  assert.equal(txt(n, "CONTRATO - ALVARÁ Nº"), "ALV-2026/0001");
  const e = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(e.imovel.dados.alvaraData, "2026-03-15");
});

test("habite-se: número gravado, data só na resposta e na observação (nenhuma coluna de data inventada)", () => {
  const { g, n } = montar({ claude: claudeResponde(HABITESE) });
  const r = enviar(g, "IMOVEL_HABITESE");
  assert.equal(r.ok, true);
  assert.equal(r.habiteseData, "2026-09-20");
  assert.equal(txt(n, "CONTRATO - HABITE-SE Nº"), "HAB-2026/0042");
  assert.match(txt(n, "DOSSIÊ IMÓVEL - OBSERVAÇÃO"), /20\/09\/2026/);
});

test("trocar a matrícula: o arquivo novo substitui os anteriores do espaço e os valores novos valem", () => {
  const { g, n } = montar({ claude: claudeResponde(MATRICULA), valores: Object.assign({}, CASA_DE_RUA, {
    "IMÓVEL - MATRÍCULA": { files: [{ name: "velha.pdf", type: "file", file: { url: "https://s3.falso/velha" } }] },
    "CONTRATO - MATRÍCULA INDIVIDUAL": texto("10.000"), "CONTRATO - CONFRONTAÇÕES": texto("antigas") }) });
  const r = enviar(g, "IMOVEL_MATRICULA", { trocar: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const arq = n.pagina.properties["IMÓVEL - MATRÍCULA"].files;
  assert.equal(arq.length, 1);
  assert.equal(arq[0].name, "doc.pdf");
  assert.equal(txt(n, "CONTRATO - MATRÍCULA INDIVIDUAL"), "98.765");
  assert.match(r.observacoes.join("\n"), /CONTRATO - MATRÍCULA INDIVIDUAL foi atualizado/);
});

test("conferir e devolver do imóvel mudam o DOSSIÊ IMÓVEL e anotam na observação do imóvel", () => {
  const { g, n } = montar();
  assert.equal(g.chamar({ action: "devolver", grupo: "imovel", token: tokenDe(), pageId: PAGE, motivo: " " }).erro, "MOTIVO_OBRIGATORIO");
  assert.equal(g.chamar({ action: "devolver", grupo: "imovel", token: tokenDe(), pageId: PAGE, motivo: "matrícula vencida" }).ok, true);
  assert.equal(n.pagina.properties["DOSSIÊ IMÓVEL"].select.name, "DEVOLVIDO");
  assert.match(txt(n, "DOSSIÊ IMÓVEL - OBSERVAÇÃO"), /ana\.teste\] Devolvido: matrícula vencida$/);
  assert.equal(n.pagina.properties["DOSSIÊ"].select, null);
  assert.equal(g.chamar({ action: "conferir", grupo: "imovel", token: tokenDe(), pageId: PAGE }).ok, true);
  assert.equal(n.pagina.properties["DOSSIÊ IMÓVEL"].select.name, "CONFERIDO");
  /* sem grupo continua sendo o do comprador */
  assert.equal(g.chamar({ action: "conferir", token: tokenDe(), pageId: PAGE }).ok, true);
  assert.equal(n.pagina.properties["DOSSIÊ"].select.name, "CONFERIDO");
});

test("perfil TESTES não lê nem confere documento do imóvel", () => {
  const { g, n, ia } = montar({ claude: claudeResponde(MATRICULA) });
  const t = tokenDe("TESTES", []);
  assert.equal(g.chamar({ action: "lerDocumento", token: t, pageId: PAGE, espaco: "IMOVEL_MATRICULA",
    arquivo: { nome: "doc.pdf", mime: "application/pdf", base64: PDF } }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(g.chamar({ action: "conferir", grupo: "imovel", token: t, pageId: PAGE }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(g.chamar({ action: "devolver", grupo: "imovel", token: t, pageId: PAGE, motivo: "x" }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(n.patches.length, 0);
  assert.equal(ia(), 0);
});

test("nenhum log leva conteúdo do documento (números, cartório, confrontações, loteamento)", () => {
  const { g } = montar({ claude: claudeResponde(MATRICULA) });
  enviar(g, "IMOVEL_MATRICULA");
  const tudo = g.logs.join("\n");
  assert.match(tudo, /leitura anthropic IMOVEL_MATRICULA tokens 2100\/120/);
  for (const proibido of ["98.765", "Cartório", "Frente", "JARDIM", "11.111", "360"]) assert.ok(!tudo.includes(proibido), proibido);
});

test("espaço inexistente (inclusive chave herdada) é recusado", () => {
  const { g } = montar();
  assert.equal(enviar(g, "constructor").erro, "ESPACO_DESCONHECIDO");
  assert.equal(enviar(g, "IMOVEL_XYZ").erro, "ESPACO_DESCONHECIDO");
});

/* ---------------- tela (venda-dossie.js) ---------------- */

const base = { tipoCasa: "CASA DE RUA", arquivos: { C1_IDENTIDADE: 0, C1_COMPROVANTE: 0, C2_IDENTIDADE: 0, C2_COMPROVANTE: 0, APROVACAO: 0 },
               dossie: "", observacao: "", doisCompradores: false,
               imovel: { arquivos: { IMOVEL_MATRICULA: 1, IMOVEL_ALVARA: 0, IMOVEL_HABITESE: 0 }, dossie: "FALTA DOCUMENTO", observacao: "",
                         dados: { matricula: "98.765", cri: "", area: 360.5, confrontacoes: "", alvaraNumero: "A-1", alvaraData: "2026-03-15", habiteseNumero: "" } } };
const ui = (x = {}) => Object.assign({ dois: false, ocupado: null, msg: "" }, x);

test("tela: seção Documentos do imóvel com os três espaços, dados gravados e conferir/devolver do imóvel", () => {
  const h = D.html(base, ui());
  assert.match(h, /Documentos do imóvel/);
  for (const id of ["IMOVEL_MATRICULA", "IMOVEL_ALVARA", "IMOVEL_HABITESE"]) assert.match(h, new RegExp('data-acao="enviar" data-espaco="' + id + '"'));
  assert.match(h, /Matrícula: 98\.765/);
  assert.match(h, /Área do lote: 360,50 m²/);
  assert.match(h, /Alvará: nº A-1 de 15\/03\/2026/);
  assert.doesNotMatch(h, /CRI:/);
  assert.match(h, /data-acao="conferir" data-grupo="imovel"/);
  assert.match(h, /Dossiê do imóvel: <b>FALTA DOCUMENTO/);
  assert.doesNotMatch(h.match(/<button[^>]*data-acao="reler"[^>]*data-espaco="IMOVEL_MATRICULA"[^>]*>/)[0], /disabled/);
  assert.match(h.match(/<button[^>]*data-acao="reler"[^>]*data-espaco="IMOVEL_ALVARA"[^>]*>/)[0], /disabled/);
});

test("tela: casa de condomínio só avisa (o imóvel vem da linha do condomínio); sem tipo trava; TESTES desabilita", () => {
  const cond = D.html(Object.assign({}, base, { tipoCasa: "CASA DE CONDOMÍNIO" }), ui());
  assert.match(cond, /vêm da linha do condomínio/);
  assert.doesNotMatch(cond, /IMOVEL_MATRICULA/);
  const semTipo = D.htmlImovel(Object.assign({}, base, { tipoCasa: "" }), ui());
  assert.ok(semTipo.match(/<button[^>]*>/g).every((b) => b.includes("disabled")));
  const testes = D.htmlImovel(base, ui({ testes: true }));
  assert.ok(testes.match(/<button[^>]*>/g).every((b) => b.includes("disabled")));
});

test("tela: servidor antigo (sem imovel) não mostra a seção; coluna faltando vira aviso", () => {
  assert.equal(D.htmlImovel(Object.assign({}, base, { imovel: undefined }), ui()), "");
  const h = D.htmlImovel(Object.assign({}, base, { imovel: { erro: "COLUNA_FALTANDO: IMÓVEL - ALVARÁ" } }), ui());
  assert.match(h, /A base não tem a coluna IMÓVEL - ALVARÁ — avise o desenvolvedor/);
});

test("tela: loteamento encontrado aparece para preencher no setor, escapado; mensagem do imóvel fica na seção dele", () => {
  const h = D.html(base, ui({ loteamento: { denominacao: "<b>JARDIM</b>", matricula: "11.111", cartorio: "" }, msg: "Lido: 4 campos", msgGrupo: "imovel" }));
  assert.match(h, /preencher uma vez no cadastro do setor/);
  assert.match(h, /&lt;b&gt;JARDIM/);
  assert.doesNotMatch(h, /Cartório:/);
  const iImovel = h.indexOf("Documentos do imóvel"), iMsg = h.indexOf("Lido: 4 campos");
  assert.ok(iMsg > iImovel, "a mensagem aparece na seção do imóvel");
  assert.equal(D.grupoDoEspaco("IMOVEL_ALVARA"), "imovel");
  assert.equal(D.grupoDoEspaco("C1_IDENTIDADE"), "comprador");
});

test("tela: observação e dados do imóvel são escapados", () => {
  const e = Object.assign({}, base, { imovel: Object.assign({}, base.imovel, { observacao: "<img src=x>", dados: { matricula: "<script>" } }) });
  const h = D.htmlImovel(e, ui());
  assert.doesNotMatch(h, /<img|<script/);
});
