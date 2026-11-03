/* 03/11/2026 (dono): "podia ser mais esperto e já adicionar campo para colocar o CRLV".
 * O formulário do bem da permuta (veículo) lê o CRLV pela IA e preenche só os campos vazios.
 * Aqui: as regras puras (FluxoLivre.crlvDaLeitura / preencherBemCrlv), o pedido à IA (os dois leitores)
 * e o desenho do botão no formulário. As ações do servidor têm teste em tela-venda-condominio.test.mjs.
 * Dados FALSOS (repositório público): CPF/RENAVAM/chassi de exemplo, sem pessoa nem placa reais. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");
const OpenAILeitor = require("../OpenAILeitor.js");
const ClaudeLeitor = require("../ClaudeLeitor.js");
const D = require("../../venda-dossie.js");

/* o que a IA devolve (esquema "crlv" dos leitores) */
const LIDO = {
  tipo_documento: "CRLV", marca: "HYUNDAI", modelo: "HB20 1.0M COMFORT", ano_fabricacao: "2019", ano_modelo: "2020", cor: "PRATA",
  placa: "ABC1D23", renavam: "12345678900", chassi: "9BWZZZ377VT004251",
  proprietario_nome: "FULANO DE TESTE", proprietario_doc: "529.982.247-25", alienacao_credor: ""
};

test("crlvDaLeitura: CRLV completo vira os campos do bem (sem alienação = alienacao null)", () => {
  const r = F.crlvDaLeitura(LIDO);
  assert.equal(r.ok, true);
  assert.deepEqual(r.crlv, {
    marca: "HYUNDAI", modelo: "HB20 1.0M COMFORT", anoFabricacao: 2019, anoModelo: 2020, cor: "PRATA",
    placa: "ABC1D23", renavam: "12345678900", chassi: "9BWZZZ377VT004251",
    proprietarioNome: "FULANO DE TESTE", proprietarioDoc: "52998224725", alienacao: null
  });
});

test("crlvDaLeitura: placa antiga e Mercosul, RENAVAM de 9 dígitos ganha os zeros, alienação com credor", () => {
  const r = F.crlvDaLeitura({ ...LIDO, placa: "abc-1234", renavam: "100000002", alienacao_credor: "  BANCO DE TESTE S.A. " });
  assert.equal(r.crlv.placa, "ABC1234");
  assert.equal(r.crlv.renavam, "00100000002");
  assert.deepEqual(r.crlv.alienacao, { credor: "BANCO DE TESTE S.A." });
  assert.equal(F.crlvDaLeitura({ ...LIDO, placa: "ABC 1D23" }).crlv.placa, "ABC1D23", "Mercosul com espaço");
});

test("crlvDaLeitura: valor lido que não passa na regra fica vazio (a pessoa digita) em vez de entrar errado", () => {
  const r = F.crlvDaLeitura({ ...LIDO, placa: "AB12345", renavam: "12345678901", chassi: "9BWZZZ377VT00425", proprietario_doc: "111.111.111-11",
                              ano_fabricacao: "19", ano_modelo: "dois mil e vinte" });
  assert.equal(r.ok, true);
  for (const c of ["placa", "renavam", "chassi", "proprietarioDoc"]) assert.equal(r.crlv[c], "", c);
  assert.equal(r.crlv.anoFabricacao, null);
  assert.equal(r.crlv.anoModelo, null);
  assert.equal(r.crlv.marca, "HYUNDAI", "o resto continua");
});

test("crlvDaLeitura: marca e modelo juntos (\"VW/GOL 1.0\") são separados; campos faltando viram vazio", () => {
  const r = F.crlvDaLeitura({ tipo_documento: "CRLV", marca: "", modelo: "VW/GOL 1.0", placa: "ABC1D23" });
  assert.equal(r.ok, true);
  assert.equal(r.crlv.marca, "VW");
  assert.equal(r.crlv.modelo, "GOL 1.0");
  assert.equal(r.crlv.cor, "");
  assert.equal(r.crlv.renavam, "");
  assert.equal(r.crlv.alienacao, null);
});

test("crlvDaLeitura: lixo, outro documento ou nada legível = erro, nunca exceção", () => {
  assert.deepEqual(F.crlvDaLeitura({ ...LIDO, tipo_documento: "OUTRO" }), { ok: false, erro: "NAO_E_CRLV" });
  for (const lixo of [null, undefined, "texto", 42, [], { tipo_documento: "CRLV" }, { tipo_documento: "CRLV", placa: "???", marca: "   " }])
    assert.deepEqual(F.crlvDaLeitura(lixo), { ok: false, erro: lixo && lixo.tipo_documento === "CRLV" ? "CRLV_ILEGIVEL" : "NAO_E_CRLV" }, JSON.stringify(lixo));
  /* objetos e números no lugar de texto não quebram */
  const r = F.crlvDaLeitura({ tipo_documento: "CRLV", marca: { x: 1 }, modelo: 123, placa: "ABC1D23", alienacao_credor: ["x"] });
  assert.equal(r.ok, true);
  assert.equal(r.crlv.marca, "");
  assert.equal(r.crlv.alienacao, null);
  assert.ok(F.crlvDaLeitura({ ...LIDO, marca: "X".repeat(500) }).crlv.marca.length <= 40, "tamanho máximo do formulário");
});

test("preencherBemCrlv: só preenche o que está vazio; o que a pessoa digitou fica, e o diferente é avisado", () => {
  const crlv = F.crlvDaLeitura(LIDO).crlv;
  const b = { tipo: "veiculo", marca: "Hyundai", placa: "XYZ9A99", cor: "", anoFab: "" };
  const r = F.preencherBemCrlv(b, crlv);
  assert.equal(r.b.marca, "Hyundai", "não troca o digitado");
  assert.equal(r.b.placa, "XYZ9A99", "não troca o digitado");
  assert.equal(r.b.cor, "PRATA");
  assert.equal(r.b.anoFab, "2019");
  assert.equal(r.b.renavam, "12345678900");
  assert.equal(r.b.propDoc, "52998224725");
  assert.deepEqual(r.preenchidos, ["modelo", "anoFab", "anoModelo", "cor", "renavam", "chassi", "propNome", "propDoc"]);
  assert.deepEqual(r.diferentes, ["placa"], "marca igual sem diferença de maiúsculas não é diferente");
  assert.equal(b.cor, "", "não mexe no objeto de entrada");
  /* tudo vazio: preenche tudo; alienação marca a situação e o credor */
  const a = F.preencherBemCrlv(null, F.crlvDaLeitura({ ...LIDO, alienacao_credor: "BANCO DE TESTE" }).crlv);
  assert.equal(a.b.tipo, "veiculo");
  assert.equal(a.b.situacao, "alienado");
  assert.equal(a.b.credor, "BANCO DE TESTE");
  assert.ok(a.preenchidos.includes("situacao") && a.preenchidos.includes("credor"));
  assert.deepEqual(F.faltasBem(F.normalizarBem(a.b)), ["saldo devedor estimado"], "o saldo a pessoa informa");
  /* sem alienação no CRLV: a situação continua para a pessoa escolher */
  const q = F.preencherBemCrlv({ tipo: "veiculo" }, crlv);
  assert.equal(q.b.situacao, undefined);
  assert.deepEqual(F.faltasBem(F.normalizarBem(q.b)), ["situação: quitado ou alienado/financiado"]);
  /* situação já escolhida não muda */
  const s = F.preencherBemCrlv({ tipo: "veiculo", situacao: "quitado" }, F.crlvDaLeitura({ ...LIDO, alienacao_credor: "BANCO DE TESTE" }).crlv);
  assert.equal(s.b.situacao, "quitado");
  assert.ok(s.diferentes.includes("situacao"));
  /* campo vazio no CRLV não apaga nem é "diferente" */
  const v = F.preencherBemCrlv({ tipo: "veiculo", cor: "azul" }, { ...crlv, cor: "" });
  assert.equal(v.b.cor, "azul");
  assert.ok(!v.diferentes.includes("cor"));
});

test("leitores: o tipo crlv existe nos dois provedores e o pedido aceita foto e PDF", () => {
  for (const L of [OpenAILeitor, ClaudeLeitor]) {
    const esq = L.ESQUEMAS.crlv;
    assert.ok(esq, "esquema crlv");
    assert.deepEqual(esq.properties.tipo_documento.enum, ["CRLV", "OUTRO"]);
    for (const c of ["marca", "modelo", "ano_fabricacao", "ano_modelo", "cor", "placa", "renavam", "chassi", "proprietario_nome", "proprietario_doc", "alienacao_credor"])
      assert.ok(esq.required.includes(c), c);
    const foto = L.montarPedido("crlv", [{ mime: "image/jpeg", base64: "AAAA" }], "chave-teste", "", "");
    assert.ok(foto.corpo, "pedido com foto");
    assert.match(JSON.stringify(foto.corpo), /CRLV/);
    assert.ok(L.montarPedido("crlv", [{ mime: "application/pdf", base64: "AAAA" }], "chave-teste", "", "").corpo, "pedido com PDF");
    assert.equal(L.montarPedido("crlv", [{ mime: "text/plain", base64: "AAAA" }], "chave-teste", "", "").erro, "TIPO_DE_ARQUIVO_NAO_SUPORTADO");
  }
});

/* ---- tela: botão no formulário do veículo e o preenchimento só do vazio ---- */
const fechado = { coluna: true, alterado: false, trava: "", por: "", em: "", alteracoes: 0 };
const linhasBase = [{ t: "sinal", v: 10000, n: 1, d: "2026-10-30", i: 1, x: "" }, { t: "pre", v: 1000, n: 19, d: "2026-12-10", i: 1, x: "" },
                    { t: "fin", v: 70000, n: 1, d: "", i: 1, x: "" }, { t: "permuta", v: 1000, n: 1, d: "2026-11-20", i: 1, x: "" }];
const editor = (o = {}) => ({ valor: 100000, valorOriginal: 100000, entrega: "2028-12-01", linhas: linhasBase.map((l) => ({ ...l })),
                               padrao: { valor: 100000, linhas: linhasBase }, historico: [], alterado: false, motivo: "x", motivoPreco: "", bemK: 3, ...o });
const painel = (ed) => (D.htmlFluxo(fechado, { fluxoEd: ed }, "").match(/<div class="vb-fx-bem".*?<!--\/vb-fx-bem-->/s) || [""])[0];

test("formulário do veículo tem o botão CRLV (foto ou PDF); imóvel e outro não têm", () => {
  const p = painel(editor());
  assert.match(p, /<button[^>]*data-acao="c-fluxo-crlv"[^>]*data-k="3"[^>]*>CRLV \(foto ou PDF\)/);
  const im = editor(); im.linhas[3].b = { tipo: "imovel" };
  assert.doesNotMatch(painel(im), /c-fluxo-crlv/);
  const ou = editor(); ou.linhas[3].b = { tipo: "outro" };
  assert.doesNotMatch(painel(ou), /c-fluxo-crlv/);
  /* lendo: botão desabilitado com o aviso; travado: desabilitado */
  assert.match(painel(editor({ crlvLendo: true })), /<button[^>]*data-acao="c-fluxo-crlv"[^>]*disabled[^>]*>Lendo o CRLV…/);
  assert.match(D.htmlFluxo(fechado, { fluxoEd: editor() }, " disabled").match(/<button[^>]*data-acao="c-fluxo-crlv"[^>]*>/)[0], /disabled/);
});

test("depois da leitura: campos vindos do CRLV marcados \"do CRLV — confira\" e a mensagem diz o que não foi trocado", () => {
  const ed = editor();
  const l = ed.linhas[3];
  l.b = { tipo: "veiculo", placa: "XYZ9A99" };
  const msg = D.aplicarCrlv(ed, 3, { crlv: F.crlvDaLeitura(LIDO).crlv, guardado: true });
  assert.equal(l.b.placa, "XYZ9A99");
  assert.equal(l.b.marca, "HYUNDAI");
  assert.equal(l.x, "HYUNDAI HB20 1.0M COMFORT 2019/2020 placa XYZ9A99", "o resumo da linha acompanha");
  assert.match(msg, /Preenchido pelo CRLV — confira/);
  assert.match(msg, /placa/);
  assert.match(msg, /não troquei/);
  assert.match(msg, /CRLV guardado na venda/);
  const p = painel(ed);
  assert.match(p, /data-fxb="marca"[^>]*value="HYUNDAI"/);
  assert.match(p, /Marca <span class="dz-nota">\(do CRLV — confira\)<\/span>/);
  assert.doesNotMatch(p, /Placa <span class="dz-nota">\(do CRLV/, "placa digitada não é do CRLV");
  assert.match(p, /Preenchido pelo CRLV — confira/);
  /* sem a coluna: lido, mas não guardado — a mensagem diz */
  const ed2 = editor();
  assert.match(D.aplicarCrlv(ed2, 3, { crlv: F.crlvDaLeitura(LIDO).crlv, guardado: false, motivo: "SEM_COLUNA" }), /não foi guardado/);
  /* nada vazio para preencher */
  const ed3 = editor(); ed3.linhas[3].b = F.preencherBemCrlv(null, F.crlvDaLeitura(LIDO).crlv).b;
  assert.match(D.aplicarCrlv(ed3, 3, { crlv: F.crlvDaLeitura(LIDO).crlv, guardado: true }), /Nenhum campo vazio para preencher/);
  /* texto lido é escapado no formulário */
  const ed4 = editor();
  D.aplicarCrlv(ed4, 3, { crlv: { ...F.crlvDaLeitura(LIDO).crlv, marca: '"><script>x</script>' }, guardado: true });
  assert.doesNotMatch(painel(ed4), /<script>/);
});
