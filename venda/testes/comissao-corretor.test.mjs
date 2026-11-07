/* 05/11/2026 (dono): casa de rua — comissão SEMPRE paga pelo comprador e a forma de pagamento montada dos dados do
 * corretor (CORRETORES – CONTRATO: CHAVE PIX, BANCO, AGÊNCIA, CONTA, TITULAR DA CONTA). O condomínio não muda.
 * ContratoVenda (puro), GerarContrato.gs com Notion/Drive falsos e o bloco da tela (venda-dossie.js).
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CV as C, tokenDe, PAGE, sel, rt, cenario, MODELO_OBRA } from "./contrato-cenario.mjs";

const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");
const P = require("../painel-casa.js");
const chamar = (c, payload, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok, pageId: PAGE }, payload));

function fontes(extra = {}) {
  const base = {
    venda: { CLIENTES: "ANA TESTE", CPF: "529.982.247-25",
      COMPRADOR1: { nacionalidade: "brasileira", estadoCivil: "solteira", profissao: "professora", documento: "RG 1234567 SSP/GO", endereco: "RUA TESTE, 10" },
      COMPRADOR2: { nome: "" },
      ENDERECO: "RESIDENCIAL TESTE QD 01 LT 35", VALOR_CONTRATO: 300000, VALOR_NA_MAO: 290000, COMISSAO: 10000, CORRETOR: "CORRETOR TESTE",
      ALVARA_NUMERO: "1", ALVARA_DATA: "2025-10-23", HABITESE_NUMERO: "77", MATRICULA_INDIVIDUAL: "99", CRI: "CRI Teste", AREA: 125, CONFRONTACOES: "frente",
      SINAL_VALOR: 5000, SINAL_DATA: "2026-09-28", ENTRADA_VALOR: 20000, ENTRADA_VENCIMENTO: "2026-10-28",
      FORMA_PAGAMENTO: "PIX", COMISSAO_FORMA: "", COMISSAO_PAGA_POR: "", PRAZO_CONCLUSAO: "2027-03-01" },
    obra: { proprietario: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", obraFinalizada: "SIM", cidade: "Cidade Teste", dataHabitese: "2026-08-01" },
    vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", endereco: "RUA SEDE, 1", representanteNome: "REPRESENTANTE TESTE",
      representanteCpf: "111.444.777-35", representanteRg: "7654321", representanteNacionalidade: "brasileiro", representanteEstadoCivil: "casado",
      banco: "BANCO TESTE", agencia: "0001", conta: "12345-6", pix: "" },
    loteamento: { denominacao: "LOTEAMENTO TESTE", municipioUf: "Cidade Teste/GO", matricula: "1", cartorio: "Cartório Teste" },
    corretor: { nome: "CORRETOR TESTE", creci: "1", cpfCnpj: "111.444.777-35" },
    hojeISO: "2026-11-05",
  };
  return Object.assign(base, extra);
}
const corretorCom = (x) => fontes({ corretor: Object.assign({ nome: "CORRETOR TESTE", creci: "1", cpfCnpj: "111.444.777-35" }, x) });

/* ---- 4) quem paga: sempre o comprador na casa de rua ---- */
test("casa de rua: comissão SEMPRE paga pelo COMPRADOR — coluna vazia, VENDEDOR ou lixo não mudam", () => {
  for (const v of ["", "VENDEDOR", "comprador", "QUALQUER"]) {
    const f = fontes(); f.venda.COMISSAO_PAGA_POR = v;
    const d = C.montarDadosContrato(f), m = C.marcadores(d);
    assert.equal(d.comissao.pagaPor, "COMPRADOR", v);
    assert.equal(C.blocos(d).SE_COMISSAO_VENDEDOR, false, v);
    assert.equal(m.COMISSAO_RESPONSAVEL, "ANA TESTE", v);
    assert.equal(m.VALOR_INTERMEDIACAO, "R$ 10.000,00", v);
    assert.equal(m.VALOR_IMOVEL, "290.000,00", v);
    assert.ok(!C.faltasContrato(d).some((x) => /paga por/i.test(x)), v);
  }
});

/* ---- 5) forma da comissão montada do cadastro do corretor ---- */
test("formaComissaoCorretor: só PIX, só conta, os dois, nada; titular ou o nome do corretor", () => {
  assert.equal(C.formaComissaoCorretor({ nome: "CORRETOR TESTE", pix: "chave-teste@exemplo.test" }),
    "PIX, chave chave-teste@exemplo.test, em nome de CORRETOR TESTE");
  assert.equal(C.formaComissaoCorretor({ nome: "CORRETOR TESTE", banco: "Banco Inventado", agencia: "0001", conta: "99999-9", titular: "IMOBILIARIA TESTE LTDA" }),
    "transferência para Banco Inventado, agência 0001, conta 99999-9, em nome de IMOBILIARIA TESTE LTDA");
  assert.equal(C.formaComissaoCorretor({ nome: "CORRETOR TESTE", pix: "000-chave", banco: "Banco Inventado", agencia: "0001", conta: "1-1" }),
    "PIX, chave 000-chave, ou transferência para Banco Inventado, agência 0001, conta 1-1, em nome de CORRETOR TESTE");
  assert.equal(C.formaComissaoCorretor({ nome: "CORRETOR TESTE", titular: "SÓ TITULAR" }), "", "titular sozinho não é forma de pagamento");
  assert.equal(C.formaComissaoCorretor({ nome: "CORRETOR TESTE" }), "");
  assert.equal(C.formaComissaoCorretor(null), "");
  /* banco sem agência: as partes que existem */
  assert.equal(C.formaComissaoCorretor({ banco: "Banco Inventado", conta: "2-2" }), "transferência para Banco Inventado, conta 2-2");
});

test("{{COMISSAO_FORMA}} na casa de rua: dados do corretor valem; sem eles, a coluna antiga (legado); sem nada, vazio", () => {
  const pix = C.marcadores(C.montarDadosContrato(corretorCom({ pix: "chave-teste" })));
  assert.equal(pix.COMISSAO_FORMA, "PIX, chave chave-teste, em nome de CORRETOR TESTE");
  const conta = C.marcadores(C.montarDadosContrato(corretorCom({ banco: "Banco Inventado", agencia: "1", conta: "2", titular: "TITULAR TESTE" })));
  assert.equal(conta.COMISSAO_FORMA, "transferência para Banco Inventado, agência 1, conta 2, em nome de TITULAR TESTE");
  /* o cadastro do corretor vale antes da coluna antiga */
  const f = corretorCom({ pix: "chave-teste" }); f.venda.COMISSAO_FORMA = "TRANSFERÊNCIA";
  assert.equal(C.marcadores(C.montarDadosContrato(f)).COMISSAO_FORMA, "PIX, chave chave-teste, em nome de CORRETOR TESTE");
  /* legado: corretor sem dados e a coluna antiga preenchida */
  const g = fontes(); g.venda.COMISSAO_FORMA = "TRANSFERÊNCIA";
  assert.equal(C.marcadores(C.montarDadosContrato(g)).COMISSAO_FORMA, "transferência");
  /* nada: vazio, e não vira falta (a comissão é opcional na casa de rua) */
  const d = C.montarDadosContrato(fontes());
  assert.equal(C.marcadores(d).COMISSAO_FORMA, "");
  assert.deepEqual(C.faltasContrato(d), []);
  /* sem cadastro do corretor: a forma antiga e a falta de sempre do cadastro */
  const h = fontes({ corretor: null }); h.venda.COMISSAO_FORMA = "PIX";
  const dh = C.montarDadosContrato(h);
  assert.equal(C.marcadores(dh).COMISSAO_FORMA, "PIX");
  assert.ok(C.faltasContrato(dh).includes("Corretor: cadastro em CORRETORES – CONTRATO"));
});

test("dados de pagamento do corretor nunca viram falta do contrato nem campo obrigatório", () => {
  const d = C.montarDadosContrato(corretorCom({ pix: "", banco: "", agencia: "", conta: "", titular: "" }));
  assert.deepEqual(C.faltasContrato(d), []);
  const ab = C.camposAbertos(["Corretor: cadastro em CORRETORES – CONTRATO", "Corretor: CRECI"], {});
  assert.deepEqual(ab.grupos[0].campos.map((c) => c.coluna), ["CRECI", "CPF/CNPJ"]);
});

test("cadastro do corretor: os 5 campos novos (texto) na lista branca; validarCampos aceita e não exige", () => {
  const cols = C.CAMPOS_CADASTRO.corretor.map((c) => c.coluna);
  for (const n of ["CHAVE PIX", "BANCO", "AGÊNCIA", "CONTA", "TITULAR DA CONTA"]) assert.ok(cols.includes(n), n);
  assert.ok(cols.includes("CRECI") && cols.includes("E-MAIL"), "os antigos continuam");
  assert.ok(C.CAMPOS_CADASTRO.corretor.filter((c) => C.CAMPOS_PAGAMENTO_CORRETOR.some((p) => p.coluna === c.coluna)).every((c) => c.tipo === "texto"));
  const v = C.validarCampos({ corretor: { "CHAVE PIX": " chave  {{X}} teste ", "AGÊNCIA": "0001" } });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.valores.corretor, { "CHAVE PIX": "chave X teste", "AGÊNCIA": "0001" });
  assert.equal(C.validarCampos({ corretor: { "CHAVE PIX": "" } }).ok, false, "nada preenchido");
});

test("estadoComissaoCorretor: valores da linha, coluna que a base não tem, sem cadastro e o legado", () => {
  const e = C.estadoComissaoCorretor("CORRETOR TESTE", { "CHAVE PIX": "chave-teste", BANCO: "", "AGÊNCIA": "", CONTA: "", "TITULAR DA CONTA": "" },
    ["NOME", "CRECI", "CHAVE PIX", "Banco", "AGENCIA", "CONTA"], "");
  assert.equal(e.pagaPor, "COMPRADOR");
  assert.equal(e.forma, "PIX, chave chave-teste, em nome de CORRETOR TESTE");
  assert.deepEqual(e.colunasFaltando, ["TITULAR DA CONTA"], "acento e caixa não importam");
  assert.equal(e.campos.find((c) => c.coluna === "CHAVE PIX").valor, "chave-teste");
  const s = C.estadoComissaoCorretor("CORRETOR NOVO", null, null, "DEPÓSITO");
  assert.deepEqual([s.temCadastro, s.forma, s.formaLegada, s.colunasFaltando], [false, "depósito", true, []]);
});

test("condomínio NÃO muda: forma da coluna da linha, pagaPor COMPRADOR, mesmo com chave PIX no cadastro do corretor", () => {
  const FLUXO = { assinatura: "2026-10-07", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 305000, sinalAto: 1000,
    credito: 244800, fgts: 5250, subsidio: 0 };
  const f = corretorCom({ pix: "chave-teste", banco: "Banco Inventado", conta: "1" });
  f.condominio = { fluxo: FLUXO }; f.venda.COMISSAO_FORMA = "PIX"; f.venda.COMISSAO_PAGA_POR = "VENDEDOR";
  const d = C.montarDadosContrato(f);
  assert.equal(d.comissao.forma, "PIX");
  assert.equal(d.comissao.pagaPor, "COMPRADOR");
  assert.equal(C.marcadores(d).COMISSAO_FORMA, "PIX");
});

/* ---- tela ---- */
test("painel da casa: COMISSÃO FORMA e PAGA POR saem do painel e não viram caixa de falta", () => {
  assert.equal(P.ocultoNoPainel("CONTRATO - COMISSÃO FORMA"), true);
  assert.equal(P.ocultoNoPainel("CONTRATO - COMISSÃO PAGA POR"), true);
  assert.equal(P.grupoDoCampo("CONTRATO - COMISSÃO FORMA"), "");
  assert.deepEqual(P.colunasDaFalta("Negociação: comissão (forma)"), []);
  assert.deepEqual(P.colunasDaFalta("Negociação: comissão (valor)"), ["COMISSÃO"], "o valor continua");
});

test("bloco Pagamento da comissão: paga por COMPRADOR fixo, caixas com o valor do cadastro, coluna faltando travada", () => {
  const cc = D.comissaoDoEstado({ corretor: "CORRETOR TESTE", temCadastro: true, forma: "PIX, chave x", colunasFaltando: ["TITULAR DA CONTA"],
    campos: [{ coluna: "CHAVE PIX", rotulo: "Chave PIX", valor: "x", existe: true }, { coluna: "TITULAR DA CONTA", rotulo: "Titular da conta", valor: "", existe: false }] });
  const h = D.htmlComissaoCorretor(cc, { rascunho: {} }, "");
  assert.match(h, /Pagamento da comissão — CORRETOR TESTE/);
  assert.match(h, /Comissão paga por: <b>COMPRADOR<\/b>/);
  assert.match(h, /No contrato: PIX, chave x/);
  assert.match(h, /não tem a coluna TITULAR DA CONTA/);
  assert.match(h, /data-com-campo="CHAVE PIX" data-com-orig="x" value="x">/);
  assert.match(h, /data-com-campo="TITULAR DA CONTA"[^>]* disabled>/);
  assert.match(h, /data-acao="c-com-salvar"/);
  assert.ok(!/data-campo=/.test(h), "não se mistura com o formulário de faltas (Salvar dados e gerar)");
  /* sem cadastro: avisa que cria; sem corretor: só o texto fixo */
  assert.match(D.htmlComissaoCorretor(D.comissaoDoEstado({ corretor: "NOVO", temCadastro: false, campos: [] }), {}, ""), /cria a linha/);
  const sem = D.htmlComissaoCorretor(D.comissaoDoEstado({ corretor: "", campos: [] }), {}, "");
  assert.match(sem, /COMPRADOR/); assert.ok(!/c-com-salvar/.test(sem));
  assert.equal(D.htmlComissaoCorretor(null, {}, ""), "");
  /* o estado do contrato leva o bloco; o perfil TESTES desabilita o salvar */
  assert.ok(D.estadoContrato({ ok: true, comissaoCorretor: { corretor: "X", campos: [] } }).comissaoCorretor);
  assert.equal(D.estadoContrato({ ok: true }).comissaoCorretor, undefined);
  assert.match(D.htmlComissaoCorretor(cc, {}, " disabled"), /data-acao="c-com-salvar" disabled/);
});

test("pedidoComissao: só o que mudou e não está vazio", () => {
  assert.deepEqual(D.pedidoComissao([{ coluna: "CHAVE PIX", orig: "a", valor: " b " }, { coluna: "BANCO", orig: "", valor: "" }, { coluna: "CONTA", orig: "1", valor: "1" }]),
    { corretor: { "CHAVE PIX": "b" } });
  assert.equal(D.pedidoComissao([{ coluna: "CONTA", orig: "1", valor: "1" }]), null);
});

/* ---- servidor (GerarContrato.gs) ---- */
const ESQ_CORR = { NOME: "title", CRECI: "rich_text", "CPF/CNPJ": "rich_text", "CHAVE PIX": "rich_text", BANCO: "rich_text", "AGÊNCIA": "rich_text", CONTA: "rich_text", "TITULAR DA CONTA": "rich_text" };

test("contratoEstado (casa de rua): bloco com o corretor, os valores do cadastro e o que vai no contrato", () => {
  const c = cenario({ corretor: { "CHAVE PIX": rt("chave-teste"), BANCO: rt(""), "AGÊNCIA": rt(""), CONTA: rt(""), "TITULAR DA CONTA": rt("") } });
  const e = c.acao("contratoEstado");
  assert.equal(e.ok, true);
  const cc = e.comissaoCorretor;
  assert.equal(cc.pagaPor, "COMPRADOR");
  assert.equal(cc.corretor, "Corretor Teste");
  assert.equal(cc.temCadastro, true);
  assert.equal(cc.forma, "PIX, chave chave-teste, em nome de Corretor Teste");
  assert.deepEqual(cc.colunasFaltando, []);
  /* base sem as colunas novas: o bloco diz quais faltam; o contrato segue (forma antiga da coluna) */
  const velho = cenario().acao("contratoEstado").comissaoCorretor;
  assert.deepEqual(velho.colunasFaltando, ["CHAVE PIX", "BANCO", "AGÊNCIA", "CONTA", "TITULAR DA CONTA"]);
  assert.deepEqual([velho.forma, velho.formaLegada], ["PIX", true]);
  const logs = c.g.logs.join("\n");
  assert.ok(!logs.includes("chave-teste"), "log vazou a chave");
});

test("gerar (casa de rua): {{COMISSAO_FORMA}} sai do cadastro do corretor e 'paga pelo vendedor' não aparece", () => {
  const modelo = [...MODELO_OBRA, "b) Forma de Pagamento: {{COMISSAO_FORMA}}", "e) Responsável pelo pagamento: {{COMISSAO_RESPONSAVEL}}"];
  const c = cenario({ drive: { modelos: { "modelo-obra": modelo, "modelo-pronto": ["MODELO PRONTO", ...modelo] } },
    venda: { "CONTRATO - COMISSÃO PAGA POR": sel("VENDEDOR") },
    corretor: { BANCO: rt("Banco Inventado"), "AGÊNCIA": rt("0001"), CONTA: rt("99999-9"), "TITULAR DA CONTA": rt("Titular Teste") } });
  const r = c.gerar();
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = c.pdfTexto();
  assert.ok(t.includes("b) Forma de Pagamento: transferência para Banco Inventado, agência 0001, conta 99999-9, em nome de Titular Teste"), t);
  assert.ok(t.includes("e) Responsável pelo pagamento: Fulano de Teste"), t);
  assert.ok(!t.includes("Comissão paga pelo vendedor"), t);
});

test("salvar no cadastro do corretor (soSalvar): grava só as colunas de pagamento na linha, sem gerar pré-contrato", () => {
  const c = cenario({ corretor: { "CHAVE PIX": rt(""), BANCO: rt(""), "AGÊNCIA": rt(""), CONTA: rt(""), "TITULAR DA CONTA": rt("") } });
  const r = chamar(c, { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { "CHAVE PIX": "chave-nova", CONTA: "1-1" } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.salvos, ["corretor"]);
  assert.ok(r.comissaoCorretor && r.comissaoCorretor.pagaPor === "COMPRADOR");
  assert.equal(c.n.escritas.length, 1);
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base, e.linha], ["PATCH", "db-corr", 0]);
  assert.deepEqual(Object.keys(e.props).sort(), ["CHAVE PIX", "CONTA"]);
  assert.equal(e.props["CHAVE PIX"].rich_text[0].text.content, "chave-nova");
  assert.equal(c.n.patches.length, 0, "a página da venda não é tocada");
  assert.equal(c.p["PRECONTRATO_" + PAGE], undefined, "não gera pré-contrato");
  assert.equal(c.d.estado.copias.length, 0);
  assert.ok(!c.g.logs.join("\n").includes("chave-nova"), "log vazou");
});

test("salvar no cadastro do corretor: coluna que a base não tem -> COLUNA_FALTANDO com o nome; nada gravado", () => {
  const c = cenario();   /* a linha do corretor sem as colunas novas */
  const r = chamar(c, { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { "CHAVE PIX": "x", "TITULAR DA CONTA": "y" } } });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "COLUNA_FALTANDO: CHAVE PIX, TITULAR DA CONTA");
  assert.equal(c.n.escritas.length, 0);
  /* o contrato continua saindo */
  assert.equal(cenario().gerar().ok, true);
});

test("salvar no cadastro do corretor: sem linha cria com o nome da venda; outros campos/grupos e TESTES recusam", () => {
  const c = cenario({ venda: { CORRETOR: sel("Corretor Novo Teste") }, esquemas: { "db-corr": ESQ_CORR } });
  const r = chamar(c, { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { "CHAVE PIX": "chave-x" } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base], ["POST", "db-corr"]);
  assert.equal(e.props.NOME.title[0].text.content, "Corretor Novo Teste");
  assert.equal(e.props["CHAVE PIX"].rich_text[0].text.content, "chave-x");
  const k = cenario();
  assert.equal(chamar(k, { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { CRECI: "9" } } }).erro, "CAMPOS_INVALIDOS");
  assert.equal(chamar(k, { action: "salvarCamposContrato", soSalvar: true, campos: { vendedor: { RG: "1" } } }).erro, "CAMPOS_INVALIDOS");
  assert.equal(chamar(k, { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { "CHAVE PIX": "" } } }).erro, "CAMPOS_INVALIDOS");
  assert.deepEqual(chamar(k, { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { "CHAVE PIX": "x" } } }, tokenDe("TESTES")),
    { ok: false, erro: "SEM_PERMISSAO_TESTES" });
  assert.equal(chamar(cenario({ venda: { CORRETOR: sel(null) } }), { action: "salvarCamposContrato", soSalvar: true, campos: { corretor: { "CHAVE PIX": "x" } } }).erro,
    "CORRETOR_NA_VENDA_FALTANDO");
  assert.equal(k.n.escritas.length, 0);
});

/* 05/11/2026 (teste do dono na casa 2): comissão opcional — vazia, sem VALOR NA MÃO, não pode virar "valor de aquisição inválido" */
test("casa de rua: comissão e valor na mão vazios — aquisição = valor do contrato", () => {
  const f = fontes(); f.venda.COMISSAO = null; f.venda.VALOR_NA_MAO = null;
  const d = C.montarDadosContrato(f);
  assert.equal(d.negociacao.aquisicao, 300000);
  assert.ok(!C.faltasContrato(d).some((x) => /aquisição/i.test(x)), C.faltasContrato(d).join(" | "));
});
