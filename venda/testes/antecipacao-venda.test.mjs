/* Antecipação no portal (AntecipacaoVenda.gs). Dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { criarGas, notionFalso, assinar, texto, COLUNAS_REAIS, PAGE_ID_PADRAO } from "./fakes.mjs";

const RET = JSON.parse(fs.readFileSync(new URL("./dados/antecipacao-retratos.json", import.meta.url), "utf8")).base;
const FINANCEIRO = fs.readFileSync(new URL("../FinanceiroVenda.gs", import.meta.url), "utf8");
const DIA = 86400000, COND = "db-cond", LINHA_ID = "b".repeat(32);
const tokenDe = (t = "GERAL") => assinar({ u: "ana.teste", t, a: ["VENDAS"], exp: Date.now() + 30 * DIA });   // folga: alguns testes andam o relógio do script
const PROPS = { NOTION_TOKEN: "ntn-teste", SESSION_SECRET: "segredo-de-teste", DB_VENDAS: "db-vendas", DB_VENDAS_COND: COND,
                DB_FILA_ROBO: "db-fila", DB_ANTECIPACOES: "db-ant" };
const COLS = Object.assign({}, COLUNAS_REAIS, { "MC - SITUAÇÃO": "rich_text", "MC - VENDA ID": "rich_text", "MC - RETRATO": "rich_text",
                                              "MC - RETRATO EM": "rich_text", "FIADOR 1": "rich_text", "PDF ENVIADO": "files" });
const VALORES = (x = {}) => Object.assign({ "MC - VENDA ID": texto("0172019e-d36c-4fb7-81de-19c227cdae7a"),
                                            "MC - RETRATO": texto(JSON.stringify(RET)), "MC - RETRATO EM": texto("2026-10-21 10:00") }, x);
const SEM_RETRATO = (v) => { const { "MC - RETRATO": a, "MC - RETRATO EM": b, ...resto } = v; return resto; };
const brl = (n) => "R$ " + n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const soma = (l) => Math.round(l.reduce((s, p) => s + p.valor, 0) * 100) / 100;

/* filaStatus: 200 = a fila aceita; outro valor = a fila do Notion falha (500) */
function montar({ valores = VALORES(), dbId = COND, hoje = "2026-10-25T12:00:00Z", colunas = COLS, props = PROPS, filaStatus = 200 } = {}) {
  const n = notionFalso({ colunas, valores, dbId });
  const fila = [], ant = { linhas: [], patches: [], html: [] };
  const DataFixa = class extends Date { constructor(...a) { super(...(a.length ? a : [hoje])); } static now() { return new Date(hoje).getTime(); } };
  const g = criarGas({ props: Object.assign({}, props), extras: { Date: DataFixa }, rotas: (url, opt) => {
    const m = String(opt.method || "get").toUpperCase(), u = url.replace("https://api.notion.com/v1", "");
    const corpo = typeof opt.payload === "string" ? JSON.parse(opt.payload) : null;
    if (m === "POST" && u === "/pages" && corpo.parent.database_id === "db-fila") {
      if (filaStatus !== 200) return { status: filaStatus, json: { message: "falha" } };
      fila.push(corpo.properties); return { json: { id: "f".repeat(32) } };
    }
    if (m === "POST" && u === "/pages" && corpo.parent.database_id === "db-ant") { ant.linhas.push(corpo.properties); return { json: { id: LINHA_ID } }; }
    /* a linha da base DB_ANTECIPACOES: o anexo entra por PATCH e a tela lê o endereço do arquivo de volta */
    if (u === "/pages/" + LINHA_ID && m === "PATCH") { ant.patches.push(corpo.properties); return { json: { id: LINHA_ID } }; }
    if (u === "/pages/" + LINHA_ID && m === "GET") {
      const f = ((ant.patches[ant.patches.length - 1] || {})["PDF ENVIADO"] || {}).files || [];
      return { json: { id: LINHA_ID, properties: { "PDF ENVIADO": { type: "files", files: f.map((x) => ({ name: x.name, type: "file", file: { url: "https://s3.falso/" + x.file_upload.id } })) } } } };
    }
    if (u === "/databases/db-fila/query") return { json: { results: [] } };
    return n.rota(url, opt);
  } });
  /* Utilities.newBlob(...).getAs não existe no fake: só aqui, sem mexer nos outros testes. Guarda o HTML que virou PDF. */
  const nb = g.ctx.Utilities.newBlob;
  g.ctx.Utilities.newBlob = (x, mime, nome) => {
    const b = nb(x, mime, nome);
    if (mime === "text/html") { ant.html.push(String(x)); b.getAs = (tipo) => nb("%PDF-1.4 simulacao de teste", tipo, "x.pdf"); }
    return b;
  };
  return { g, n, fila, ant };
}
const chamar = (m, action, x = {}, perfil) => m.g.chamar(Object.assign({ action, token: tokenDe(perfil), pageId: PAGE_ID_PADRAO }, x));
const campo = (m, nome) => m.n.pagina.properties[nome].rich_text.map((t) => t.plain_text).join("");
const retratoCom = (f) => { const r = JSON.parse(JSON.stringify(RET)); f(r); return r; };

/* ---------- estado ---------- */
test("venda do condomínio lançada, retrato do mês: pode simular", () => {
  const r = chamar(montar(), "antecipacaoEstado");
  assert.equal(r.ok, true); assert.equal(r.pode, true); assert.equal(r.velho, false);
  assert.equal(r.processando, false); assert.equal(r.lido, "2026-10-21 10:00");
  assert.equal(r.retrato.venda, RET.venda); assert.equal(r.retrato.parcelas.length, RET.parcelas.length);
  assert.equal(r.erroRobo, undefined);
});

test("retrato de outubro visto em novembro é velho, e o PDF recusa", () => {
  const m = montar({ hoje: "2026-11-03T12:00:00Z" });
  assert.equal(chamar(m, "antecipacaoEstado").velho, true);
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: 30000, dataPg: "2026-11-03" }).erro, "RETRATO_VELHO");
  assert.equal(m.ant.linhas.length, 0);
});

test("o mês vale no fuso de São Paulo: 1º de novembro 01:00 UTC ainda é outubro", () => {
  assert.equal(chamar(montar({ hoje: "2026-11-01T01:00:00Z" }), "antecipacaoEstado").velho, false);
  assert.equal(chamar(montar({ hoje: "2026-11-01T03:00:00Z" }), "antecipacaoEstado").velho, true);
});

test("sem MC - VENDA ID: não pode, com motivo", () => {
  const r = chamar(montar({ valores: VALORES({ "MC - VENDA ID": texto("") }) }), "antecipacaoEstado");
  assert.equal(r.pode, false); assert.match(r.motivo, /ainda não foi lançada/);
});

test("página da VENDAS (casa de rua): não pode", () => {
  const r = chamar(montar({ dbId: "db-vendas" }), "antecipacaoEstado");
  assert.equal(r.pode, false); assert.match(r.motivo, /RESERVA DOS IPÊS/);
});

test("base sem as colunas do retrato: não pode, e o motivo diz quais faltam", () => {
  const { "MC - RETRATO": a, "MC - RETRATO EM": b, ...semRetrato } = COLS;
  const r = chamar(montar({ colunas: semRetrato, valores: SEM_RETRATO(VALORES()) }), "antecipacaoEstado");
  assert.equal(r.pode, false); assert.match(r.motivo, /MC - RETRATO/);
});

test("temFiador vem da coluna FIADOR 1", () => {
  assert.equal(chamar(montar(), "antecipacaoEstado").temFiador, false);
  assert.equal(chamar(montar({ valores: VALORES({ "FIADOR 1": texto("Fiador Inventado") }) }), "antecipacaoEstado").temFiador, true);
});

test("o erro do robô não apaga o retrato bom: a tela recebe os dois", () => {
  const m = montar({ valores: VALORES({ "MC - RETRATO EM": texto("2026-10-21 10:00 | ERRO 2026-10-25 08:00: ERP fora do ar") }) });
  const r = chamar(m, "antecipacaoEstado");
  assert.equal(r.lido, "2026-10-21 10:00"); assert.equal(r.velho, false); assert.equal(r.processando, false);
  assert.equal(r.retrato.venda, RET.venda);
  assert.equal(r.erroRobo.trim(), "2026-10-25 08:00: ERP fora do ar");
});

test("nunca houve retrato bom: 'ERRO: motivo' na coluna do retrato vira erroRobo e retrato velho", () => {
  const r = chamar(montar({ valores: VALORES({ "MC - RETRATO": texto("ERRO: venda de outra obra"), "MC - RETRATO EM": texto("") }) }), "antecipacaoEstado");
  assert.equal(r.pode, true); assert.equal(r.retrato, undefined); assert.equal(r.velho, true);
  assert.equal(r.lido, ""); assert.equal(r.erroRobo, "venda de outra obra");
});

test("retrato ilegível (JSON quebrado) não derruba o estado", () => {
  const r = chamar(montar({ valores: VALORES({ "MC - RETRATO": texto('{"v":1,"parcelas":[') }) }), "antecipacaoEstado");
  assert.equal(r.ok, true); assert.equal(r.retrato, undefined); assert.equal(r.velho, true); assert.ok(r.erroRobo);
});

test("PROCESSANDO há menos de 15 min vale; passado o prazo, o robô é dado como parado", () => {
  const t = (min) => new Date("2026-10-25T12:00:00Z").getTime() - min * 60000;
  const em = (min) => texto("2026-10-21 10:00 | PROCESSANDO [t=" + t(min) + "]");
  assert.equal(chamar(montar({ valores: VALORES({ "MC - RETRATO EM": em(5) }) }), "antecipacaoEstado").processando, true);
  const velho = chamar(montar({ valores: VALORES({ "MC - RETRATO EM": em(20) }) }), "antecipacaoEstado");
  assert.equal(velho.processando, false); assert.equal(velho.lido, "2026-10-21 10:00");
});

/* ---------- ler de novo ---------- */
test("ler de novo põe o pedido na fila e marca PROCESSANDO só na coluna da hora; o retrato bom fica", () => {
  const m = montar();
  assert.equal(chamar(m, "antecipacaoLer").ok, true);
  assert.equal(m.fila.length, 1);
  assert.equal(m.fila[0]["TIPO"].select.name, "mc-retrato");
  assert.equal(JSON.parse(m.fila[0]["PAYLOAD"].rich_text[0].text.content).pageId, PAGE_ID_PADRAO);
  assert.match(campo(m, "MC - RETRATO EM"), /^2026-10-21 10:00 \| PROCESSANDO \[t=\d+\]$/);
  assert.equal(JSON.parse(campo(m, "MC - RETRATO")).venda, RET.venda);
  const e = chamar(m, "antecipacaoEstado");
  assert.equal(e.processando, true); assert.equal(e.lido, "2026-10-21 10:00"); assert.equal(e.retrato.venda, RET.venda);
});

test("ler de novo sem leitura anterior: PROCESSANDO sozinho, sem o separador solto", () => {
  const m = montar({ valores: VALORES({ "MC - RETRATO": texto(""), "MC - RETRATO EM": texto("") }) });
  assert.equal(chamar(m, "antecipacaoLer").ok, true);
  assert.match(campo(m, "MC - RETRATO EM"), /^PROCESSANDO \[t=\d+\]$/);
  assert.equal(campo(m, "MC - RETRATO"), "");
});

test("ler de novo repetido enquanto processa não põe outro pedido; vencido o prazo, põe", () => {
  const m = montar();
  assert.equal(chamar(m, "antecipacaoLer").ok, true);
  const r = chamar(m, "antecipacaoLer");
  assert.equal(r.ok, false); assert.equal(r.erro, "RETRATO_PROCESSANDO");
  assert.equal(m.fila.length, 1);
  const velho = montar({ valores: VALORES({ "MC - RETRATO EM": texto("2026-10-21 10:00 | PROCESSANDO [t=" + (new Date("2026-10-25T12:00:00Z").getTime() - 20 * 60000) + "]") }) });
  assert.equal(chamar(velho, "antecipacaoLer").ok, true); assert.equal(velho.fila.length, 1);
});

test("ler de novo sem fila configurada: erro claro e nada gravado", () => {
  const semFila = Object.assign({}, PROPS); delete semFila.DB_FILA_ROBO;
  const m = montar({ props: semFila });
  const r = chamar(m, "antecipacaoLer");
  assert.equal(r.ok, false); assert.equal(r.erro, "FILA_NAO_CONFIGURADA");
  assert.equal(campo(m, "MC - RETRATO EM"), "2026-10-21 10:00");
});

test("fila fora do ar: devolve a hora da leitura boa e avisa", () => {
  const m = montar({ filaStatus: 500 });
  const r = chamar(m, "antecipacaoLer");
  assert.equal(r.ok, false); assert.equal(r.erro, "FILA_FALHOU");
  assert.equal(campo(m, "MC - RETRATO EM"), "2026-10-21 10:00");
  assert.equal(JSON.parse(campo(m, "MC - RETRATO")).venda, RET.venda);
});

test("venda que não pode antecipar não vai para a fila", () => {
  const m = montar({ dbId: "db-vendas" });
  const r = chamar(m, "antecipacaoLer");
  assert.equal(r.ok, false); assert.equal(r.erro, "NAO_PODE"); assert.equal(m.fila.length, 0);
});

/* ---------- PDF ---------- */
test("PDF refaz a conta no servidor: no jeito E o valor da tela é ignorado", () => {
  const m = montar();
  const r = chamar(m, "antecipacaoPdf", { modo: "E", valor: 1, dataPg: "2026-10-21" });
  assert.equal(r.ok, true);
  const pos = RET.parcelas.filter((p) => p.tipo === "pos" && !p.pago && p.data >= "2026-10-21");
  const total = soma(pos);
  assert.ok(r.texto.includes(brl(total).slice(3)), r.texto);   // "19.025,04" sem o "R$ "
  assert.equal(m.ant.linhas.length, 1);
  const linha = m.ant.linhas[0];
  assert.equal(linha["VALOR"].number, total);
  assert.equal(linha["JEITO"].select.name, "E");
  assert.equal(linha["SITUAÇÃO"].select.name, "Simulada");
  assert.equal(linha["DATA"].date.start, "2026-10-21");
  assert.equal(linha["VENDA"].relation[0].id, PAGE_ID_PADRAO);
  assert.equal(linha["RESPONSÁVEL"].rich_text[0].text.content, "ana.teste");
  assert.ok(JSON.parse(linha["SIMULAÇÃO"].rich_text.map((t) => t.text.content).join("")).modo === "E");
});

test("PDF vai anexado na linha da base e a tela recebe o endereço do arquivo", () => {
  const m = montar();
  const r = chamar(m, "antecipacaoPdf", { modo: "B", valor: 30000, dataPg: "2026-10-21" });
  assert.equal(r.ok, true);
  const anexo = m.ant.patches.map((p) => p["PDF ENVIADO"]).filter(Boolean);
  assert.equal(anexo.length, 1);
  assert.equal(anexo[0].files.length, 1);
  assert.match(anexo[0].files[0].name, /\.pdf$/);
  const up = m.n.uploads[anexo[0].files[0].file_upload.id];
  assert.equal(up.mime, "application/pdf");
  assert.equal(up.buf.toString("utf8"), "%PDF-1.4 simulacao de teste");
  assert.match(r.pdfUrl, /^https:\/\//);
});

test("o PDF do cliente não leva comissão, id do ERP nem nome de corretor, e traz as datas do mês", () => {
  const m = montar({ valores: VALORES({ "ENDEREÇO": { title: [{ type: "text", plain_text: "Unidade 13", text: { content: "Unidade 13" } }] } }) });
  chamar(m, "antecipacaoPdf", { modo: "B", valor: 30000, dataPg: "2026-10-21" });
  const html = m.ant.html[0];
  assert.match(html, /RESERVA DOS IPÊS/); assert.match(html, /Simulação de antecipação/);
  assert.match(html, /Unidade 13/);
  assert.match(html, /25\/10\/2026/);   // emissão
  assert.match(html, /31\/10\/2026/);   // válida até o fim do mês
  assert.match(html, /item 7\.1 do contrato/);
  assert.match(html, /R\$ 30\.000,00/);
  assert.doesNotMatch(html, /comiss|corretor|0172019e|ana\.teste|00000000-0000/i);
});

test("jeito D: quitar a parcela inteira explica valor do contrato + correção; texto de WhatsApp pronto", () => {
  const m = montar();
  const balao = RET.parcelas.find((p) => p.tipo === "balao" && !p.pago);
  const r = chamar(m, "antecipacaoPdf", { modo: "D", valor: balao.valor, parcelaId: balao.id, dataPg: "2026-10-21" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const corr = Math.round((balao.valor - balao.raw) * 100) / 100;
  for (const t of [m.ant.html[0], r.texto]) {
    assert.ok(t.includes(brl(balao.raw).slice(3)), "contrato " + brl(balao.raw));
    assert.ok(t.includes(brl(balao.valor).slice(3)), "hoje " + brl(balao.valor));
  }
  assert.ok(m.ant.html[0].includes(brl(corr).slice(3)), "correção");
  assert.match(r.texto, /balão/); assert.match(r.texto, /para de corrigir/);
});

test("jeito D com parcela inexistente e valor acima do saldo: o erro volta, nada é criado", () => {
  const m = montar();
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "D", valor: 100, parcelaId: "nao-existe", dataPg: "2026-10-21" }).erro, "PARCELA_INVALIDA");
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: 99999999, dataPg: "2026-10-21" }).erro, "VALOR_ACIMA_DO_SALDO");
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: 30000, dataPg: "21/10/2026" }).erro, "DATA_INVALIDA");
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "Z", valor: 30000, dataPg: "2026-10-21" }).erro, "MODO_INVALIDO");
  assert.equal(m.ant.linhas.length, 0); assert.equal(m.ant.html.length, 0);
});

test("valor digitado como texto brasileiro vale; 'quantas' chega como número inteiro ou erro", () => {
  const m = montar();
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: "30.000,00", dataPg: "2026-10-21" }).ok, true);
  assert.equal(m.ant.linhas[0]["VALOR"].number, 30000);
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: "abc", dataPg: "2026-10-21" }).erro, "VALOR_INVALIDO");
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "E", dataPg: "2026-10-21", quantas: "2" }).ok, true);
  const dois = RET.parcelas.filter((p) => p.tipo === "pos" && !p.pago && p.data >= "2026-10-21").slice(-2);
  assert.equal(m.ant.linhas[1]["VALOR"].number, soma(dois));
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "E", dataPg: "2026-10-21", quantas: 1.5 }).erro, "QUANTAS_INVALIDA");
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "E", dataPg: "2026-10-21", quantas: 999 }).erro, "QUANTAS_INVALIDA");
  assert.equal(m.ant.linhas.length, 2);
});

test("PDF sem retrato ou sem a base de registro: erro claro", () => {
  assert.equal(chamar(montar({ valores: VALORES({ "MC - RETRATO": texto(""), "MC - RETRATO EM": texto("") }) }), "antecipacaoPdf",
                      { modo: "B", valor: 1000, dataPg: "2026-10-21" }).erro, "SEM_RETRATO");
  const semBase = Object.assign({}, PROPS); delete semBase.DB_ANTECIPACOES;
  const m = montar({ props: semBase });
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: 1000, dataPg: "2026-10-21" }).erro, "BASE_ANTECIPACOES_NAO_CONFIGURADA");
  assert.equal(m.ant.html.length, 0);
});

test("falha ao registrar a linha: devolve REGISTRO_FALHOU, sem PDF solto", () => {
  const m = montar({ props: Object.assign({}, PROPS, { DB_ANTECIPACOES: "db-que-quebra" }) });
  const r = chamar(m, "antecipacaoPdf", { modo: "B", valor: 1000, dataPg: "2026-10-21" });
  assert.equal(r.ok, false); assert.equal(r.erro, "REGISTRO_FALHOU");
});

test("perfil TESTES não pede leitura nem PDF", () => {
  const m = montar();
  assert.equal(chamar(m, "antecipacaoLer", {}, "TESTES").erro, "SEM_PERMISSAO_TESTES");
  assert.equal(chamar(m, "antecipacaoPdf", { modo: "B", valor: 30000, dataPg: "2026-10-21" }, "TESTES").erro, "SEM_PERMISSAO_TESTES");
  assert.equal(m.fila.length, 0); assert.equal(m.ant.linhas.length, 0);
  assert.equal(chamar(m, "antecipacaoEstado", {}, "TESTES").ok, true);   // só lê
});

/* ---------- antecipacaoRetrato_ (aba Financeiro) ---------- */
test("antecipacaoRetrato_: grupos, numeração, situação e dias de atraso", () => {
  const m = montar({ valores: VALORES({ "MC - RETRATO": texto(JSON.stringify(retratoCom((r) => {
    const abertas = r.parcelas.filter((p) => p.tipo === "pre" && !p.pago).sort((a, b) => (a.data < b.data ? -1 : 1));
    abertas[0].data = "2026-10-20";                           // aberta e vencida há 5 dias (hoje = 25/10)
    abertas[1].parcial = true; abertas[1].data = "2026-10-01"; // parcial vencida: continua atrasada
    abertas[2].data = "2026-10-25";                           // vence hoje: ainda aberta
  }))) }) });
  const r = JSON.parse(JSON.stringify(m.g.ctx.antecipacaoRetrato_(PAGE_ID_PADRAO)));   // objeto do vm → mesmo protótipo
  assert.equal(r.lidoEm, "2026-10-21 10:00");
  assert.equal(r.parcelas.length, RET.parcelas.length);
  const porGrupo = {};
  r.parcelas.forEach((p) => { porGrupo[p.grupo] = (porGrupo[p.grupo] || 0) + 1; });
  assert.deepEqual(porGrupo, { "Sinal": 4, "Pré-chaves": 24, "FGTS/Financiamento": 2, "Balão": 2, "Pós-chaves": 24 });
  const pos = r.parcelas.filter((p) => p.grupo === "Pós-chaves");
  assert.deepEqual(pos.map((p) => p.numero), Array.from({ length: 24 }, (_, i) => i + 1));
  assert.ok(pos.every((p) => p.de === 24));
  assert.ok(pos.every((p, i) => i === 0 || pos[i - 1].vencimento <= p.vencimento));
  const paga = r.parcelas.find((p) => p.grupo === "Sinal" && p.numero === 1);
  assert.deepEqual([paga.situacao, paga.pagoEm, paga.diasAtraso, paga.vencimento, paga.valor, paga.valorCorrigido],
                   ["paga", "2025-02-10", 0, "2025-02-10", 1000, 1000]);
  const pre = r.parcelas.filter((p) => p.grupo === "Pré-chaves" && p.situacao !== "paga");
  const atrasadas = pre.filter((p) => p.situacao === "atrasada").sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
  assert.deepEqual(atrasadas.map((p) => [p.vencimento, p.diasAtraso, p.pagoEm]), [["2026-10-01", 24, ""], ["2026-10-20", 5, ""]]);
  const hoje = pre.find((p) => p.vencimento === "2026-10-25");
  assert.deepEqual([hoje.situacao, hoje.diasAtraso], ["aberta", 0]);
  /* valor = raw do contrato; valorCorrigido = valor de hoje (com o fator) */
  const corrigida = r.parcelas.find((p) => p.grupo === "Pós-chaves" && p.situacao === "aberta");
  const orig = RET.parcelas.find((p) => p.tipo === "pos" && !p.pago && p.data === corrigida.vencimento);
  assert.deepEqual([corrigida.valor, corrigida.valorCorrigido], [orig.raw, orig.valor]);
  assert.deepEqual(r.retrato, retratoCom((x) => {
    const abertas = x.parcelas.filter((p) => p.tipo === "pre" && !p.pago).sort((a, b) => (a.data < b.data ? -1 : 1));
    abertas[0].data = "2026-10-20"; abertas[1].parcial = true; abertas[1].data = "2026-10-01"; abertas[2].data = "2026-10-25";
  }));
});

test("antecipacaoRetrato_: sem retrato, com erro, processando, de outra base ou sem coluna → nunca lança, sem parcelas", () => {
  const { "MC - RETRATO": a, "MC - RETRATO EM": b, ...semRetrato } = COLS;
  const casos = [
    montar({ valores: VALORES({ "MC - RETRATO": texto(""), "MC - RETRATO EM": texto("") }) }),
    montar({ valores: VALORES({ "MC - RETRATO": texto("ERRO: algo"), "MC - RETRATO EM": texto("2026-10-21 10:00") }) }),
    montar({ valores: VALORES({ "MC - RETRATO": texto("PROCESSANDO [t=1]"), "MC - RETRATO EM": texto("2026-10-21 10:00") }) }),
    montar({ valores: VALORES({ "MC - RETRATO": texto("{quebrado") }) }),
    montar({ dbId: "db-vendas" }),
    montar({ colunas: semRetrato, valores: SEM_RETRATO(VALORES()) }),
  ];
  casos.forEach((m, i) => {
    const r = m.g.ctx.antecipacaoRetrato_(PAGE_ID_PADRAO);
    assert.equal(r.retrato, null, "caso " + i);
    assert.ok(!r.parcelas, "caso " + i);   // a aba Financeiro lê "sem parcelas" como semLeitura
    assert.equal(typeof r.lidoEm, "string");
  });
  assert.equal(casos[1].g.ctx.antecipacaoRetrato_(PAGE_ID_PADRAO).lidoEm, "2026-10-21 10:00");
  assert.equal(casos[0].g.ctx.antecipacaoRetrato_(PAGE_ID_PADRAO).lidoEm, "");
  assert.equal(casos[0].g.ctx.antecipacaoRetrato_("pagina-que-nao-existe").retrato, null);
});

test("aba Financeiro: financeiroEstado devolve as parcelas do retrato, e 'sem leitura' quando não há", () => {
  let m = montar();
  vm.runInContext(FINANCEIRO, m.g.ctx);
  const r = chamar(m, "financeiroEstado");
  assert.equal(r.lancada, true); assert.equal(r.lidoEm, "2026-10-21 10:00"); assert.equal(r.parcelas.length, 56);
  assert.equal(r.semLeitura, undefined);
  m = montar({ valores: VALORES({ "MC - RETRATO": texto(""), "MC - RETRATO EM": texto("") }) });
  vm.runInContext(FINANCEIRO, m.g.ctx);
  const v = chamar(m, "financeiroEstado");
  assert.equal(v.lancada, true); assert.equal(v.semLeitura, true); assert.deepEqual(v.parcelas, []);
});
