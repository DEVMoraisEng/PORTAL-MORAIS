/* 03/11/2026 (dono): "podia ser mais esperto e já adicionar campo para colocar o CRLV".
 * O formulário do bem da permuta (veículo) lê o CRLV pela IA e preenche só os campos vazios.
 * Aqui: as regras puras (FluxoLivre.crlvDaLeitura / preencherBemCrlv), o pedido à IA (os dois leitores)
 * e o desenho do botão no formulário. As ações do servidor têm teste em tela-venda-condominio.test.mjs.
 * Dados FALSOS (repositório público): CPF/CNPJ/RENAVAM/chassi de exemplo, sem pessoa nem veículo reais. */
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
  proprietario_nome: "FULANO DE TESTE", proprietario_doc: "529.982.247-25", observacoes: "SEM RESERVA DE DOMINIO"
};

test("crlvDaLeitura: CRLV completo vira os campos do bem, tudo como texto; \"SEM RESERVA DE DOMINIO\" = quitado", () => {
  const r = F.crlvDaLeitura(LIDO);
  assert.equal(r.ok, true);
  assert.deepEqual(r.crlv, {
    marca: "HYUNDAI", modelo: "HB20 1.0M COMFORT", anoFabricacao: "2019", anoModelo: "2020", cor: "PRATA",
    placa: "ABC1D23", renavam: "12345678900", chassi: "9BWZZZ377VT004251",
    proprietarioNome: "FULANO DE TESTE", proprietarioDoc: "52998224725", observacoes: "SEM RESERVA DE DOMINIO", situacao: "quitado"
  });
});

test("crlvDaLeitura: observações — só \"sem reserva de domínio\" (acento, caixa e espaço à parte) vira quitado; qualquer outra coisa não", () => {
  for (const o of ["sem reserva de domínio", "  Sem  Reserva de Domínio. ", "*** SEM RESERVA DE DOMINIO ***", "SEM RESERVA DE DOMÍNIO"])
    assert.equal(F.crlvDaLeitura({ ...LIDO, observacoes: o }).crlv.situacao, "quitado", o);
  for (const o of ["", "ALIENACAO FIDUCIARIA BANCO DE TESTE S.A.", "SEM RESERVA DE DOMINIO / RESTRICAO JUDICIAL", "GRAVAME", "RESERVA DE DOMINIO",
                   "COM RESERVA DE DOMINIO"])
    assert.equal(F.crlvDaLeitura({ ...LIDO, observacoes: o }).crlv.situacao, "", o);
});

test("crlvDaLeitura: placa antiga e Mercosul, RENAVAM de 9 dígitos ganha os zeros", () => {
  const r = F.crlvDaLeitura({ ...LIDO, placa: "abc-1234", renavam: "100000002" });
  assert.equal(r.crlv.placa, "ABC1234");
  assert.equal(r.crlv.renavam, "00100000002");
  assert.equal(F.crlvDaLeitura({ ...LIDO, placa: "ABC 1D23" }).crlv.placa, "ABC1D23", "Mercosul com espaço");
});

test("crlvDaLeitura: nenhum dígito se perde — zero à esquerda em RENAVAM, CPF e CNPJ, como texto ou como número", () => {
  /* RENAVAM que começa com 0: texto fica igual; número (a IA tirou o zero) volta com o zero, porque o dígito confere */
  assert.equal(F.crlvDaLeitura({ ...LIDO, renavam: "01000000009" }).crlv.renavam, "01000000009");
  assert.equal(F.crlvDaLeitura({ ...LIDO, renavam: 1000000009 }).crlv.renavam, "01000000009");
  assert.equal(F.crlvDaLeitura({ ...LIDO, renavam: 12345678900 }).crlv.renavam, "12345678900");
  assert.equal(F.crlvDaLeitura({ ...LIDO, renavam: 1234567890 }).crlv.renavam, "", "número curto cujo dígito não confere fica vazio");
  /* CPF que começa com 0 */
  assert.equal(F.crlvDaLeitura({ ...LIDO, proprietario_doc: "001.234.567-97" }).crlv.proprietarioDoc, "00123456797");
  assert.equal(F.crlvDaLeitura({ ...LIDO, proprietario_doc: 123456797 }).crlv.proprietarioDoc, "00123456797");
  assert.equal(F.crlvDaLeitura({ ...LIDO, proprietario_doc: "123456797" }).crlv.proprietarioDoc, "", "texto curto não é completado (pode ser dígito lido a menos)");
  /* CNPJ com zeros à esquerda */
  assert.equal(F.crlvDaLeitura({ ...LIDO, proprietario_doc: "00.123.456/7817-01" }).crlv.proprietarioDoc, "00123456781701");
  assert.equal(F.crlvDaLeitura({ ...LIDO, proprietario_doc: 123456781701 }).crlv.proprietarioDoc, "00123456781701");
  /* ano como número */
  const n = F.crlvDaLeitura({ ...LIDO, ano_fabricacao: 2019, ano_modelo: 2020 }).crlv;
  assert.deepEqual([n.anoFabricacao, n.anoModelo], ["2019", "2020"]);
  /* e no formulário o texto é o mesmo (normalizarBem não corta o zero) */
  const b = F.normalizarBem(F.preencherBemCrlv(null, F.crlvDaLeitura({ ...LIDO, renavam: 1000000009, proprietario_doc: 123456797 }).crlv).b);
  assert.equal(b.renavam, "01000000009");
  assert.equal(b.propDoc, "00123456797");
  assert.deepEqual(F.faltasBem(b), []);
});

test("crlvDaLeitura: valor lido que não passa na regra fica vazio (a pessoa digita) em vez de entrar errado", () => {
  const r = F.crlvDaLeitura({ ...LIDO, placa: "AB12345", renavam: "12345678901", chassi: "9BWZZZ377VT00425", proprietario_doc: "111.111.111-11",
                              ano_fabricacao: "19", ano_modelo: "dois mil e vinte" });
  assert.equal(r.ok, true);
  for (const c of ["placa", "renavam", "chassi", "proprietarioDoc", "anoFabricacao", "anoModelo"]) assert.equal(r.crlv[c], "", c);
  assert.equal(r.crlv.marca, "HYUNDAI", "o resto continua");
});

test("crlvDaLeitura: marca e modelo juntos (\"VW/GOL 1.0\") são separados; campos faltando viram vazio", () => {
  const r = F.crlvDaLeitura({ tipo_documento: "CRLV", marca: "", modelo: "VW/GOL 1.0", placa: "ABC1D23" });
  assert.equal(r.ok, true);
  assert.equal(r.crlv.marca, "VW");
  assert.equal(r.crlv.modelo, "GOL 1.0");
  assert.equal(r.crlv.cor, "");
  assert.equal(r.crlv.renavam, "");
  assert.equal(r.crlv.situacao, "");
});

test("crlvDaLeitura: lixo, outro documento ou nada legível = erro, nunca exceção", () => {
  assert.deepEqual(F.crlvDaLeitura({ ...LIDO, tipo_documento: "OUTRO" }), { ok: false, erro: "NAO_E_CRLV" });
  for (const lixo of [null, undefined, "texto", 42, [], { tipo_documento: "CRLV" }, { tipo_documento: "CRLV", placa: "???", marca: "   " },
                      { tipo_documento: "CRLV", observacoes: "SEM RESERVA DE DOMINIO" }])
    assert.deepEqual(F.crlvDaLeitura(lixo), { ok: false, erro: lixo && lixo.tipo_documento === "CRLV" ? "CRLV_ILEGIVEL" : "NAO_E_CRLV" }, JSON.stringify(lixo));
  /* objetos no lugar de texto não quebram */
  const r = F.crlvDaLeitura({ tipo_documento: "CRLV", marca: { x: 1 }, modelo: 123, placa: "ABC1D23", observacoes: ["SEM RESERVA DE DOMINIO"] });
  assert.equal(r.ok, true);
  assert.equal(r.crlv.marca, "");
  assert.equal(r.crlv.situacao, "");
  assert.ok(F.crlvDaLeitura({ ...LIDO, marca: "X".repeat(500) }).crlv.marca.length <= 40, "tamanho máximo do formulário");
});

test("preencherBemCrlv: só preenche o que está vazio; o que a pessoa digitou fica, e o diferente é avisado; CPF/CNPJ formatado", () => {
  const crlv = F.crlvDaLeitura(LIDO).crlv;
  const b = { tipo: "veiculo", marca: "Hyundai", placa: "XYZ9A99", cor: "", anoFab: "" };
  const r = F.preencherBemCrlv(b, crlv);
  assert.equal(r.b.marca, "Hyundai", "não troca o digitado");
  assert.equal(r.b.placa, "XYZ9A99", "não troca o digitado");
  assert.equal(r.b.cor, "PRATA");
  assert.equal(r.b.anoFab, "2019");
  assert.equal(r.b.renavam, "12345678900");
  assert.equal(r.b.propDoc, "529.982.247-25", "formatado no campo");
  assert.equal(r.b.situacao, "quitado");
  assert.deepEqual(r.preenchidos, ["modelo", "anoFab", "anoModelo", "cor", "renavam", "chassi", "propNome", "propDoc", "situacao"]);
  assert.deepEqual(r.diferentes, ["placa"], "marca igual sem diferença de maiúsculas não é diferente");
  assert.equal(b.cor, "", "não mexe no objeto de entrada");
  /* CNPJ formatado; o mesmo documento digitado sem pontos não é "diferente" */
  const cnpj = F.crlvDaLeitura({ ...LIDO, proprietario_doc: "00123456781701" }).crlv;
  assert.equal(F.preencherBemCrlv(null, cnpj).b.propDoc, "00.123.456/7817-01");
  assert.deepEqual(F.preencherBemCrlv({ tipo: "veiculo", propDoc: "00123456781701" }, cnpj).diferentes, []);
  /* formatado passa na validação e o contrato imprime formatado */
  const nb = F.normalizarBem(F.preencherBemCrlv(null, crlv).b);
  assert.equal(nb.propDoc, "52998224725");
  assert.deepEqual(F.faltasBem(nb), []);
  assert.equal(F.docFormatado(nb.propDoc), "529.982.247-25");
  /* qualquer outra observação: a situação fica para a pessoa; nada de alienado/credor automático */
  const al = F.preencherBemCrlv(null, F.crlvDaLeitura({ ...LIDO, observacoes: "ALIENACAO FIDUCIARIA BANCO DE TESTE" }).crlv);
  assert.equal(al.b.situacao, undefined);
  assert.equal(al.b.credor, undefined);
  assert.ok(!al.preenchidos.includes("situacao"));
  assert.deepEqual(F.faltasBem(F.normalizarBem(al.b)), ["situação: quitado ou alienado/financiado"]);
  /* situação já escolhida não muda (e o CRLV dizendo quitado é avisado) */
  const s = F.preencherBemCrlv({ tipo: "veiculo", situacao: "alienado", credor: "BANCO DE TESTE" }, crlv);
  assert.equal(s.b.situacao, "alienado");
  assert.equal(s.b.credor, "BANCO DE TESTE");
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
    for (const c of ["marca", "modelo", "ano_fabricacao", "ano_modelo", "cor", "placa", "renavam", "chassi", "proprietario_nome", "proprietario_doc", "observacoes"]) {
      assert.ok(esq.required.includes(c), c);
      assert.equal(esq.properties[c].type, "string", c + " como texto (zero à esquerda não se perde)");
    }
    assert.ok(!("alienacao_credor" in esq.properties));
    const foto = L.montarPedido("crlv", [{ mime: "image/jpeg", base64: "AAAA" }], "chave-teste", "", "");
    assert.ok(foto.corpo, "pedido com foto");
    assert.match(JSON.stringify(foto.corpo), /OBSERVAÇÕES DO VEÍCULO/);
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

test("dono 03/11: rótulos numa linha só e a grade alinha os campos pelo pé (não fica um em cima e outro embaixo)", () => {
  const ed = editor();
  ed.linhas[3].b = { tipo: "veiculo", situacao: "alienado" };
  const p = painel(ed);
  assert.match(p, /display:grid;[^"]*align-items:end/);
  const rotulos = p.match(/<label class="dz-campo"[^>]*>.*?<\/label>/gs);
  assert.ok(rotulos.length >= 14);
  for (const r of rotulos) assert.match(r, /^<label class="dz-campo"[^>]*><span class="vb-fx-rot" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"[^>]*>[^<]+<\/span>/, r.slice(0, 120));
});

test("depois da leitura: campos vindos do CRLV destacados (sem mexer no rótulo) e a mensagem diz o que não foi trocado", () => {
  const ed = editor();
  const l = ed.linhas[3];
  l.b = { tipo: "veiculo", placa: "XYZ9A99" };
  const msg = D.aplicarCrlv(ed, 3, { crlv: F.crlvDaLeitura(LIDO).crlv, guardado: true });
  assert.equal(l.b.placa, "XYZ9A99");
  assert.equal(l.b.marca, "HYUNDAI");
  assert.equal(l.b.situacao, "quitado");
  assert.equal(l.x, "HYUNDAI HB20 1.0M COMFORT 2019/2020 placa XYZ9A99", "o resumo da linha acompanha");
  assert.match(msg, /Preenchido pelo CRLV — confira/);
  assert.match(msg, /situação/);
  assert.match(msg, /placa/);
  assert.match(msg, /não troquei/);
  assert.match(msg, /CRLV guardado na venda/);
  const p = painel(ed);
  assert.match(p, /data-fxb="marca"[^>]*value="HYUNDAI"/);
  assert.match(p, /<input[^>]*data-fxb="marca"[^>]*data-crlv="1"[^>]*title="do CRLV — confira"/);
  assert.match(p, /<select[^>]*data-fxb="situacao"[^>]*data-crlv="1"/);
  assert.doesNotMatch(p, /<input[^>]*data-fxb="placa"[^>]*data-crlv/, "placa digitada não é do CRLV");
  assert.doesNotMatch(p, /\(do CRLV — confira\)/, "nada de marca no rótulo (quebrava a linha)");
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
