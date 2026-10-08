/* Entrega 13: anexar sem ler, "Ler documentos" em lote (IA em paralelo, uma escrita no Notion),
 * certidão mãe, data do habite-se e "usar o mesmo comprovante do comprador 1".
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { criarGas, assinar, notionFalso, texto, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";
const require = createRequire(import.meta.url);
const R = require("../RegrasVenda.js");
const OA = require("../OpenAILeitor.js");
const CL = require("../ClaudeLeitor.js");

const SITUACOES = ["FALTA DOCUMENTO", "LIDO PELA IA – CONFERIR", "CONFERIDO", "DEVOLVIDO"];
const COLUNAS_IMOVEL = {
  "IMÓVEL - MATRÍCULA": "files", "IMÓVEL - ALVARÁ": "files", "IMÓVEL - HABITE-SE": "files",
  "DOSSIÊ IMÓVEL": { tipo: "select", opcoes: SITUACOES }, "DOSSIÊ IMÓVEL - OBSERVAÇÃO": "rich_text",
  "CONTRATO - MATRÍCULA INDIVIDUAL": "rich_text", "CONTRATO - CRI DA MATRÍCULA": "rich_text",
  "CONTRATO - ÁREA DO LOTE (M²)": "number", "CONTRATO - CONFRONTAÇÕES": "rich_text",
  "CONTRATO - ALVARÁ Nº": "rich_text", "CONTRATO - ALVARÁ DATA": "date", "CONTRATO - HABITE-SE Nº": "rich_text",
  "CONTRATO - MATRÍCULA DO LOTEAMENTO": "rich_text", "CONTRATO - CARTÓRIO DO LOTEAMENTO": "rich_text",
};
/* as 3 colunas novas da entrega 13, como criadas na base de TESTE */
const COLUNAS_13 = { "IMÓVEL - CERTIDÃO MÃE": "files", "CONTRATO - HABITE-SE DATA": "date", "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO": "rich_text" };
const COLUNAS = Object.assign({ CASA: "rich_text" }, COLUNAS_REAIS, COLUNAS_IMOVEL, COLUNAS_13);

const PROPS = { NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste", ANTHROPIC_API_KEY: "sk-falsa", DB_VENDAS: DB_ID_PADRAO, PROVEDOR_IA: "anthropic" };
const PAGE = PAGE_ID_PADRAO;
const tokenDe = (t = "GERAL", a = ["VENDAS"]) => assinar({ u: "ana.teste", t, a, exp: Date.now() + 86400000 });
const b64 = (s) => Buffer.from(s).toString("base64");
const CASA = { "TIPO DE CASA": { select: { name: "CASA DE RUA" } }, "ENDEREÇO": { title: [{ type: "text", plain_text: "QD 01 LT 26 RUA TESTE", text: { content: "QD 01 LT 26 RUA TESTE" } }] },
               CASA: texto("Casa 1") };

const CNH1 = { tipo_documento: "CNH", nome: "ANA TESTE", cpf: "52998224725", numero_documento: "01234567890", orgao_emissor: "DETRAN/GO",
               nacionalidade: "brasileira", data_nascimento: "01/01/1990", rg_numero: "1111111", rg_orgao_uf: "SSP/GO" };
const CNH2 = Object.assign({}, CNH1, { nome: "BRUNO TESTE", cpf: "11144477735", rg_numero: "2222222" });
const COMPROVANTE = { tipo_documento: "COMPROVANTE", titular: "ANA TESTE", endereco_completo: "RUA FICTÍCIA 1, BAIRRO TESTE, CIDADE TESTE/GO",
                      data_emissao: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date()) };
const MATRICULA = { tipo_documento: "MATRICULA", matricula_numero: "98.765", cartorio: "CRI da 9ª Circunscrição de Cidade Teste/GO", area_m2: "360,50",
                    confrontacoes: "Frente 12 m para a Rua Teste", loteamento_denominacao: "", loteamento_matricula: "", loteamento_cartorio: "" };
const HABITESE = { tipo_documento: "HABITESE", numero: "HAB-2026/0042", data: "20/09/2026" };
const MAE = { tipo_documento: "CERTIDAO_MAE", loteamento_denominacao: "RESIDENCIAL EXEMPLO", matricula_mae: "55.555", cartorio: "CRI da 9ª Circunscrição",
              unidade_encontrada: "SIM", unidade_identificacao: "Casa 1, Quadra 01, Lote 26",
              unidade_confrontacoes: "Frente 6 m para a Rua Teste; fundo 6 m com a casa 2", unidade_area_privativa_m2: "70,50", unidade_area_total_m2: "120,00" };

/* IA falsa: responde pelo tipo do pedido (esquema) e, na identidade, pelo conteúdo do arquivo */
function iaPorTipo(mapa, erros = {}, classes = {}) {
  const pedidos = [];
  const rota = (url, opt) => {
    const corpo = JSON.parse(opt.payload);
    const props = Object.keys(corpo.output_config.format.schema.properties);
    const tipo = props.length === 3 && props.includes("cpf") ? "classificar" : props.includes("matricula_mae") ? "certidao_mae" : props.includes("matricula_numero") ? "matricula"
      : props.includes("endereco_completo") ? "comprovante" : props.includes("rg_numero") ? "identidade"
      : props.includes("valor_fgts") ? "aprovacao"
      : corpo.output_config.format.schema.properties.tipo_documento.enum[0] === "ALVARA" ? "alvara" : "habitese";
    const blocos = corpo.messages[0].content;
    const arquivo = Buffer.from((blocos[0].source || {}).data || "", "base64").toString();
    pedidos.push({ tipo, arquivo, texto: blocos[blocos.length - 1].text });
    if (tipo === "classificar")
      return { json: { stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 20 },
                       content: [{ type: "text", text: JSON.stringify(classes[arquivo] || { tipo_documento: "OUTRO", nome: "", cpf: "" }) }] } };
    const chave = tipo === "identidade" ? arquivo : tipo;
    if (erros[chave]) return erros[chave];
    return { json: { stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 50 },
                     content: [{ type: "text", text: JSON.stringify(mapa[chave] || {}) }] } };
  };
  return { rota, pedidos };
}
function montar({ valores = CASA, colunas = COLUNAS, ia = iaPorTipo({}), props } = {}) {
  const n = notionFalso({ valores, colunas });
  const g = criarGas({ props: props || Object.assign({}, PROPS), rotas: (url, opt) =>
    url === "https://api.anthropic.com/v1/messages" ? ia.rota(url, opt) : n.rota(url, opt) });
  return { n, g, ia };
}
const anexar = (g, espaco, conteudo, extra = {}) => g.chamar(Object.assign({ action: "anexarDocumento", token: tokenDe(), pageId: PAGE, espaco,
  arquivo: { nome: "doc.pdf", mime: "application/pdf", base64: b64(conteudo) } }, extra));
const txt = (n, col) => (n.pagina.properties[col].rich_text[0] || { text: { content: "" } }).text.content;
const iaChamadas = (g) => g.chamadas.filter((c) => c.url === "https://api.anthropic.com/v1/messages").length;

/* ---------------- regras puras ---------------- */

test("ordem de leitura, pendentes e contexto da unidade", () => {
  assert.deepEqual(R.ordenarEspacos(["IMOVEL_HABITESE", "C2_IDENTIDADE", "X", "IMOVEL_CERTIDAO_MAE", "IMOVEL_MATRICULA", "C1_IDENTIDADE", "C2_IDENTIDADE"]),
    ["C1_IDENTIDADE", "C2_IDENTIDADE", "IMOVEL_MATRICULA", "IMOVEL_CERTIDAO_MAE", "IMOVEL_HABITESE"]);
  const p = {};
  R.marcarPendente(p, "C1_IDENTIDADE", true);
  R.marcarPendente(p, "C1_IDENTIDADE", false);
  R.marcarPendente(p, "APROVACAO", false);
  assert.deepEqual(p, { C1_IDENTIDADE: "trocar", APROVACAO: "atualizar" }, "trocar não volta a atualizar antes da leitura");
  assert.deepEqual(R.pendentesValidos(p, { C1_IDENTIDADE: 1, APROVACAO: 0 }), ["C1_IDENTIDADE"], "espaço sem arquivo não conta");
  const c = R.contextoUnidade({ endereco: ' QD 01 LT 26\n "RUA" ', casa: "Casa 1" });
  assert.match(c, /QD 01 LT 26 'RUA'/);
  assert.match(c, /casa 'Casa 1'/);
  assert.equal(R.contextoUnidade({}), "");
  assert.equal(R.espaco("IMOVEL_CERTIDAO_MAE").tipo, "certidao_mae");
});

test("certidão mãe: denominação, matrícula-mãe, cartório e as confrontações DESTA unidade", () => {
  const CI = R.COL_IMOVEL, CO = R.COL_IMOVEL_OPC;
  const p = R.planejarGravacao("IMOVEL_CERTIDAO_MAE", MAE, {}, "2026-10-08");
  assert.equal(p.props[CO.LOTEAMENTO_DENOMINACAO], "RESIDENCIAL EXEMPLO");
  assert.equal(p.props[CI.LOTEAMENTO_MATRICULA], "55.555");
  assert.equal(p.props[CI.LOTEAMENTO_CARTORIO], "CRI da 9ª Circunscrição");
  assert.equal(p.props[CI.CONFRONTACOES], "Frente 6 m para a Rua Teste; fundo 6 m com a casa 2");
  assert.equal(p.props[CI.AREA], 120, "área vazia: a da certidão mãe preenche");
  assert.ok(p.observacoes.some((o) => /privativa 70.5 m²/.test(o)));
  const comArea = R.planejarGravacao("IMOVEL_CERTIDAO_MAE", MAE, { [CI.AREA]: 250 }, "2026-10-08");
  assert.ok(!(CI.AREA in comArea.props), "a área da matrícula individual vale");
  const naoAchou = R.planejarGravacao("IMOVEL_CERTIDAO_MAE", Object.assign({}, MAE, { unidade_encontrada: "NAO", unidade_confrontacoes: "" }),
    { [CI.CONFRONTACOES]: "antigas" }, "2026-10-08", "trocar");
  assert.ok(!(CI.CONFRONTACOES in naoAchou.props), "sem a unidade, confrontações ficam");
  assert.ok(naoAchou.observacoes.some((o) => /não descreve esta unidade/.test(o)));
  assert.equal(R.planejarGravacao("IMOVEL_CERTIDAO_MAE", MATRICULA, {}, "2026-10-08").observacoes.length, 1, "matrícula individual no espaço da mãe não preenche");
});

test("com certidão mãe anexada, a matrícula não troca as confrontações já gravadas", () => {
  const CI = R.COL_IMOVEL;
  const atuais = { [CI.CONFRONTACOES]: "da mãe", [R.COL_IMOVEL_OPC.ARQ_CERTIDAO_MAE]: [{ name: "m.pdf" }] };
  const p = R.planejarGravacao("IMOVEL_MATRICULA", MATRICULA, atuais, "2026-10-08");
  assert.ok(!(CI.CONFRONTACOES in p.props));
  assert.ok(p.observacoes.some((o) => /mantidas as da certidão mãe/.test(o)));
  const sem = R.planejarGravacao("IMOVEL_MATRICULA", MATRICULA, { [CI.CONFRONTACOES]: "velhas" }, "2026-10-08");
  assert.equal(sem.props[CI.CONFRONTACOES], "Frente 12 m para a Rua Teste", "sem certidão mãe, o último documento vale");
});

test("leitores: esquema da certidão mãe igual nos dois provedores e o contexto da unidade vai no pedido", () => {
  assert.deepEqual(OA.ESQUEMAS.certidao_mae, CL.ESQUEMAS.certidao_mae);
  const arq = [{ mime: "application/pdf", base64: b64("x") }];
  const o = OA.montarPedido("certidao_mae", arq, "k", "", "A casa desta venda: casa 'Casa 1'.");
  assert.match(JSON.stringify(o.corpo.input), /Casa 1/);
  const c = CL.montarPedido("certidao_mae", arq, "k", "", "A casa desta venda: casa 'Casa 1'.");
  assert.match(c.corpo.messages[0].content[1].text, /Casa 1/);
  assert.doesNotMatch(CL.montarPedido("habitese", arq, "k").corpo.messages[0].content[1].text, /undefined/);
});

/* ---------------- servidor ---------------- */

test("anexar não chama a IA, marca o espaço como novo e o estado mostra os pendentes", () => {
  const { g, n } = montar();
  const r = anexar(g, "C1_IDENTIDADE", "cnh1");
  assert.equal(r.ok, true);
  assert.deepEqual(r.pendentes, ["C1_IDENTIDADE"]);
  assert.equal(iaChamadas(g), 0);
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 1);
  anexar(g, "IMOVEL_MATRICULA", "mat");
  const e = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.deepEqual(e.pendentes, ["C1_IDENTIDADE", "IMOVEL_MATRICULA"]);
  assert.deepEqual(e.imovel.semColunas, []);
});

test("Ler documentos: IA de todos os espaços num fetchAll, uma escrita só no Notion, pendentes zerados", () => {
  const ia = iaPorTipo({ cnh1: CNH1, cnh2: CNH2, comprovante: COMPROVANTE, matricula: MATRICULA, habitese: HABITESE, certidao_mae: MAE });
  const { g, n } = montar({ ia });
  for (const [esp, c] of [["C1_IDENTIDADE", "cnh1"], ["C2_IDENTIDADE", "cnh2"], ["C1_COMPROVANTE", "luz"],
                          ["IMOVEL_MATRICULA", "mat"], ["IMOVEL_CERTIDAO_MAE", "mae"], ["IMOVEL_HABITESE", "hab"]]) assert.equal(anexar(g, esp, c).ok, true);
  const patchesAntes = n.patches.length, lotesAntes = g.ctx.UrlFetchApp.lotes || 0;
  const r = g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.pageId, PAGE);
  assert.equal(n.patches.length - patchesAntes, 1, "uma escrita só");
  assert.equal((g.ctx.UrlFetchApp.lotes || 0) - lotesAntes, 2, "um fetchAll para os downloads e um para a IA");
  assert.equal(iaChamadas(g), 6);
  assert.deepEqual(r.resultados.map((x) => x.espaco), ["C1_IDENTIDADE", "C2_IDENTIDADE", "C1_COMPROVANTE", "IMOVEL_MATRICULA", "IMOVEL_CERTIDAO_MAE", "IMOVEL_HABITESE"]);
  assert.ok(r.resultados.every((x) => x.ok));
  assert.equal(txt(n, "CLIENTES "), "ANA TESTE E BRUNO TESTE", "comprador 1 antes do 2");
  assert.equal(txt(n, "COMPRADOR 2 - NOME"), "BRUNO TESTE");
  assert.equal(txt(n, "COMPRADOR 1 - ENDEREÇO"), COMPROVANTE.endereco_completo);
  assert.equal(txt(n, "CONTRATO - MATRÍCULA INDIVIDUAL"), "98.765");
  assert.equal(txt(n, "CONTRATO - CONFRONTAÇÕES"), MAE.unidade_confrontacoes, "certidão mãe lida depois da matrícula: a dela vale");
  assert.equal(txt(n, "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO"), "RESIDENCIAL EXEMPLO");
  assert.equal(n.pagina.properties["CONTRATO - HABITE-SE DATA"].date.start, "2026-09-20");
  assert.equal(n.pagina.properties["CONTRATO - ÁREA DO LOTE (M²)"].number, 360.5, "a área da matrícula vale");
  assert.equal(n.pagina.properties["DOSSIÊ IMÓVEL"].select.name, "FALTA DOCUMENTO", "ainda falta o alvará");
  assert.equal(r.imovel.dossie, "FALTA DOCUMENTO");
  assert.equal(r.gravados["CONTRATO - HABITE-SE DATA"], "2026-09-20");
  assert.equal(r.loteamento.denominacao, "RESIDENCIAL EXEMPLO");
  const mae = ia.pedidos.find((p) => p.tipo === "certidao_mae");
  assert.match(mae.texto, /QD 01 LT 26 RUA TESTE/);
  assert.match(mae.texto, /Casa 1/);
  assert.deepEqual(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).pendentes, []);
  assert.equal(g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE }).erro, "NADA_NOVO");
  const logs = g.logs.join("\n");
  assert.doesNotMatch(logs, /ANA TESTE|BRUNO|529|111444|RUA FICT|QD 01/);
});

test("um espaço com erro da IA não segura os outros e continua novo", () => {
  const ia = iaPorTipo({ cnh1: CNH1, matricula: MATRICULA }, { cnh1: { status: 529, json: { type: "error", error: { type: "overloaded_error" } } } });
  const { g, n } = montar({ ia });
  anexar(g, "C1_IDENTIDADE", "cnh1"); anexar(g, "IMOVEL_MATRICULA", "mat");
  const r = g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.resultados.map((x) => [x.espaco, x.ok, x.erro]), [["C1_IDENTIDADE", false, "API_OVERLOADED_ERROR"], ["IMOVEL_MATRICULA", true, undefined]]);
  assert.equal(txt(n, "CONTRATO - MATRÍCULA INDIVIDUAL"), "98.765");
  assert.equal(r.dossie, undefined, "dossiê do comprador não mexido");
  assert.equal(n.pagina.properties["DOSSIÊ"].select, null);
  assert.deepEqual(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).pendentes, ["C1_IDENTIDADE"]);
});

test("fetchAll que lança: plano B pede um a um e o que falhou na rede não derruba o resto", () => {
  const ia = iaPorTipo({ matricula: MATRICULA, habitese: HABITESE }, { habitese: { lancar: "Timeout" } });
  const { g, n } = montar({ ia });
  anexar(g, "IMOVEL_MATRICULA", "mat"); anexar(g, "IMOVEL_HABITESE", "hab");
  const r = g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.resultados.map((x) => [x.espaco, x.ok, x.erro]), [["IMOVEL_MATRICULA", true, undefined], ["IMOVEL_HABITESE", false, "LEITURA_FALHOU"]]);
  assert.equal(txt(n, "CONTRATO - MATRÍCULA INDIVIDUAL"), "98.765");
});

test("falha ao gravar no Notion: nada lido, tudo continua novo", () => {
  const ia = iaPorTipo({ matricula: MATRICULA });
  const n = notionFalso({ valores: CASA, colunas: COLUNAS });
  let quebrar = false;
  const g = criarGas({ props: Object.assign({}, PROPS), rotas: (url, opt) => {
    if (url === "https://api.anthropic.com/v1/messages") return ia.rota(url, opt);
    if (quebrar && String(opt.method).toUpperCase() === "PATCH") return { status: 500, json: { message: "erro" } };
    return n.rota(url, opt);
  } });
  anexar(g, "IMOVEL_MATRICULA", "mat");
  quebrar = true;
  const r = g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, false);
  assert.equal(r.resultados[0].erro, "GRAVACAO_FALHOU");
  quebrar = false;
  assert.deepEqual(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).pendentes, ["IMOVEL_MATRICULA"]);
});

test("Ler de novo usa o modo trocar pendente e limpa o pendente; Enviar e ler (antigo) segue funcionando", () => {
  const ia = iaPorTipo({ matricula: Object.assign({}, MATRICULA, { confrontacoes: "" }) });
  const { g, n } = montar({ ia, valores: Object.assign({}, CASA, { "CONTRATO - CONFRONTAÇÕES": texto("antigas") }) });
  anexar(g, "IMOVEL_MATRICULA", "mat", { trocar: true });
  const r = g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE, espaco: "IMOVEL_MATRICULA" });
  assert.equal(r.ok, true);
  assert.equal(r.pageId, PAGE);
  assert.equal(txt(n, "CONTRATO - CONFRONTAÇÕES"), "", "trocar: o que o documento novo não traz é limpo");
  assert.deepEqual(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).pendentes, []);
});

test("sem as colunas da entrega 13: anexar na certidão mãe avisa, a data do habite-se fica só na observação", () => {
  const sem = Object.assign({}, COLUNAS); for (const c of Object.keys(COLUNAS_13)) delete sem[c];
  const ia = iaPorTipo({ habitese: HABITESE });
  const { g, n } = montar({ colunas: sem, ia });
  const e = g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE });
  assert.equal(e.ok, true);
  assert.equal(e.imovel.erro, undefined);
  assert.deepEqual(e.imovel.semColunas.sort(), Object.keys(COLUNAS_13).sort());
  assert.equal(anexar(g, "IMOVEL_CERTIDAO_MAE", "mae").erro, "COLUNA_FALTANDO: IMÓVEL - CERTIDÃO MÃE");
  anexar(g, "IMOVEL_HABITESE", "hab");
  const r = g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.equal(txt(n, "CONTRATO - HABITE-SE Nº"), "HAB-2026/0042");
  assert.match(txt(n, "DOSSIÊ IMÓVEL - OBSERVAÇÃO"), /20\/09\/2026/);
  assert.match(txt(n, "DOSSIÊ IMÓVEL - OBSERVAÇÃO"), /não existe na base/);
});

test("TESTES não anexa, não lê em lote e não copia comprovante", () => {
  const { g, n } = montar();
  for (const action of ["anexarDocumento", "lerDocumentos", "copiarComprovante"])
    assert.equal(g.chamar({ action, token: tokenDe("TESTES", []), pageId: PAGE, espaco: "C1_IDENTIDADE" }).erro, "SEM_PERMISSAO_TESTES");
  assert.equal(n.patches.length, 0);
});

test("comprador 2 com o mesmo comprovante: copia endereço e arquivos do comprador 1, sem IA", () => {
  const ia = iaPorTipo({ comprovante: COMPROVANTE });
  const { g, n } = montar({ ia, valores: Object.assign({}, CASA, { "COMPRADOR 2 - NOME": texto("BRUNO TESTE") }) });
  assert.equal(g.chamar({ action: "copiarComprovante", token: tokenDe(), pageId: PAGE }).erro, "SEM_COMPROVANTE_1");
  anexar(g, "C1_COMPROVANTE", "luz");
  assert.equal(g.chamar({ action: "copiarComprovante", token: tokenDe(), pageId: PAGE }).erro, "COMPROVANTE_1_NAO_LIDO");
  g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  anexar(g, "C2_COMPROVANTE", "outro");
  const antes = iaChamadas(g);
  const r = g.chamar({ action: "copiarComprovante", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(iaChamadas(g), antes, "sem nova leitura");
  assert.equal(txt(n, "COMPRADOR 2 - ENDEREÇO"), COMPROVANTE.endereco_completo);
  const c2 = n.pagina.properties["COMPRADOR 2 - COMPROVANTE DE ENDEREÇO"].files;
  assert.equal(c2.length, 1, "substitui o que estava no espaço do comprador 2");
  const id = c2[0].file.url.split("/").pop();
  assert.equal(n.uploads[id].buf.toString(), "luz");
  assert.match(txt(n, "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"), /o mesmo do comprador 1/);
  assert.deepEqual(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).pendentes, [], "o comprovante 2 anexado antes deixa de ser novo");
  assert.equal(r.gravados["COMPRADOR 2 - ENDEREÇO"], COMPROVANTE.endereco_completo);
});

/* ---------------- soltar todos os documentos ---------------- */

const soltar = (g, conteudo, nome = "arquivo.pdf") => g.chamar({ action: "soltarDocumento", token: tokenDe(), pageId: PAGE,
  arquivo: { nome, mime: "application/pdf", base64: b64(conteudo) } });
const CLASSES = {
  rgAna: { tipo_documento: "IDENTIDADE", nome: "ANA TESTE", cpf: "52998224725" },
  rgBruno: { tipo_documento: "IDENTIDADE", nome: "Bruno da Silva Teste", cpf: "" },
  alvara: { tipo_documento: "ALVARA", nome: "", cpf: "" },
  foto: { tipo_documento: "OUTRO", nome: "", cpf: "" },
  frente: { tipo_documento: "IDENTIDADE", nome: "", cpf: "" },
  luzAna: { tipo_documento: "COMPROVANTE", nome: "ANA TESTE", cpf: "" },
  luzMae: { tipo_documento: "COMPROVANTE", nome: "MARIA PARENTE", cpf: "" },
};

test("decidirEspaco: imóvel vai direto; documento de pessoa só SUGERE o comprador (a tela confirma)", () => {
  const venda = { [R.COL.CLIENTES]: "ANA TESTE E BRUNO SILVA TESTE", [R.COL.CPF1]: "529.982.247-25" };
  assert.deepEqual(R.decidirEspaco(CLASSES.alvara, venda), { espaco: "IMOVEL_ALVARA", tipo: "ALVARA" });
  assert.equal(R.decidirEspaco({ tipo_documento: "CERTIDAO_MAE" }, venda).espaco, "IMOVEL_CERTIDAO_MAE");
  assert.equal(R.decidirEspaco({ tipo_documento: "APROVACAO" }, venda).espaco, "APROVACAO");
  assert.equal(R.decidirEspaco(CLASSES.foto, venda).motivo, "NAO_RECONHECIDO");
  const ana = R.decidirEspaco({ tipo_documento: "IDENTIDADE", nome: "OUTRO NOME", cpf: "52998224725" }, venda);
  assert.deepEqual([ana.espaco, ana.pessoa, ana.sugestao], [null, true, "C1"], "CPF ganha do nome; nunca guarda sozinho");
  assert.equal(R.decidirEspaco(CLASSES.rgBruno, venda).sugestao, "C2");
  assert.equal(R.decidirEspaco(CLASSES.luzAna, venda).sugestao, "C1", "comprovante: o comprador do nome do titular");
  assert.equal(R.decidirEspaco(CLASSES.luzMae, venda).sugestao, "", "titular que não é comprador: sem sugestão");
  assert.equal(R.decidirEspaco(CLASSES.frente, venda).sugestao, "");
  assert.equal(R.decidirEspaco(CLASSES.frente, { [R.COL.CLIENTES]: "ANA TESTE" }).sugestao, "C1", "frente sem nome, um comprador só");
  assert.equal(R.decidirEspaco(CLASSES.rgAna, {}).sugestao, "", "venda sem nomes: sem sugestão");
  assert.equal(R.espacoDaPessoa("C2", "COMPROVANTE"), "C2_COMPROVANTE");
  assert.equal(R.espacoDaPessoa("NENHUM", "IDENTIDADE"), null);
  assert.ok(R.mesmaPessoa("Bruno da Silva Teste", "BRUNO TESTE"));
  assert.ok(!R.mesmaPessoa("BRUNO TESTE", "ANA TESTE"));
});

test("soltar todos: dois RGs, um alvará e um desconhecido — só o alvará é guardado; os RGs esperam a confirmação", () => {
  const ia = iaPorTipo({ rgAna: CNH1, rgBruno: CNH2, alvara: { tipo_documento: "ALVARA", numero: "ALV-1", data: "15/03/2026" }, comprovante: COMPROVANTE }, {}, CLASSES);
  const { g, n } = montar({ ia, valores: Object.assign({}, CASA, { "CLIENTES ": texto("ANA TESTE E BRUNO TESTE") }) });
  const r1 = soltar(g, "rgAna", "rg-ana.pdf"), r2 = soltar(g, "rgBruno"), r3 = soltar(g, "alvara"), r4 = soltar(g, "foto");
  assert.deepEqual([r1.espaco, r2.espaco, r3.espaco, r4.espaco], [null, null, "IMOVEL_ALVARA", null]);
  assert.deepEqual([r1.sugestao, r2.sugestao], ["C1", "C2"]);
  assert.deepEqual([r1.pessoa.nome, r2.pessoa.nome], ["ANA TESTE", "Bruno da Silva Teste"], "o nome lido volta para a tela perguntar");
  assert.ok(r1.pessoa.chave && r1.pessoa.chave !== r2.pessoa.chave);
  assert.doesNotMatch(JSON.stringify(r1), /52998224725/, "CPF não volta");
  assert.equal(r4.motivo, "NAO_RECONHECIDO");
  assert.equal(n.pagina.properties["COMPRADOR 1 - IDENTIDADE"].files.length, 0, "nada de pessoa guardado antes de confirmar");
  assert.equal(n.pagina.properties["COMPRADOR 2 - IDENTIDADE"].files.length, 0);
  assert.equal(n.pagina.properties["IMÓVEL - ALVARÁ"].files.length, 1);
  assert.deepEqual(g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE }).pendentes, ["IMOVEL_ALVARA"]);
  /* "Confirmar compradores": a tela guarda cada arquivo no espaço escolhido (anexar) — aqui o dono trocou a ordem */
  assert.equal(anexar(g, "C2_IDENTIDADE", "rgAna").ok, true);
  assert.equal(anexar(g, "C1_IDENTIDADE", "rgBruno").ok, true);
  assert.equal(anexar(g, "C1_COMPROVANTE", "foto").ok, true, "o desconhecido: 'isto é: comprovante do comprador 1'");
  ia.pedidos.length = 0;
  const r = g.chamar({ action: "lerDocumentos", token: tokenDe(), pageId: PAGE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.resultados.map((x) => x.espaco), ["C1_IDENTIDADE", "C2_IDENTIDADE", "C1_COMPROVANTE", "IMOVEL_ALVARA"]);
  assert.equal(ia.pedidos.filter((p) => p.tipo === "classificar").length, 0, "a leitura do lote não classifica de novo");
  assert.equal(txt(n, "COMPRADOR 2 - NOME"), "ANA TESTE", "vale a escolha da pessoa na tela");
  assert.equal(txt(n, "CONTRATO - ALVARÁ Nº"), "ALV-1");
  const logs = g.logs.join(" | ");
  assert.doesNotMatch(logs, /ANA|BRUNO|Bruno|529982/);
  assert.match(logs, /classificar anthropic tokens 900.20/);
  assert.equal(g.ctx.PropertiesService.getScriptProperties().getProperty("venda_pend_" + PAGE), null, "nada sobra nas Propriedades");
});

test("soltar: TESTES não grava; certidão mãe sem a coluna não é guardada", () => {
  const ia = iaPorTipo({}, {}, { mae: { tipo_documento: "CERTIDAO_MAE", nome: "", cpf: "" } });
  const sem = Object.assign({}, COLUNAS); delete sem["IMÓVEL - CERTIDÃO MÃE"];
  const { g, n } = montar({ ia, colunas: sem });
  assert.equal(g.chamar({ action: "soltarDocumento", token: tokenDe("TESTES", []), pageId: PAGE,
    arquivo: { nome: "a.pdf", mime: "application/pdf", base64: b64("mae") } }).erro, "SEM_PERMISSAO_TESTES");
  const r = soltar(g, "mae");
  assert.equal(r.espaco, null);
  assert.equal(r.motivo, "SEM_COLUNA");
  assert.equal(Object.keys(n.uploads).length, 0);
});
