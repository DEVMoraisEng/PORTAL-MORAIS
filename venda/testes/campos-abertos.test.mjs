/* Entrega 12 — campos abertos na tela do contrato e conta de recebimento por venda.
 * ContratoVenda (puro) + GerarContrato.gs com Notion, Drive e Apps Script falsos.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { CV, tokenDe, PAGE, tit, sel, num, rt, cenario } from "./contrato-cenario.mjs";

const CONTA_A = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", CONTA_B = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const rtT = (s) => Object.assign({ type: "rich_text" }, rt(s));
const titT = (s) => Object.assign({ type: "title" }, tit(s));
const LINHAS_CONTAS = {
  [CONTA_A]: { Conta: titT("CONTA FICTICIA A"), Banco: rtT("001"), "Agência": rtT("1111"), "Número": rtT("11111-1"), "CHAVE PIX": rtT("pix-a@exemplo.test") },
  [CONTA_B]: { Conta: titT("CONTA FICTICIA B"), Banco: rtT("237"), "Agência": rtT("2222"), "Número": rtT("22222-2"), "CHAVE PIX": rtT("") },
};
/* a base CONTAS BANCÁRIAS falsa (lista e páginas); `outraBase` = página que existe mas é de outra base */
function rotaContas(url, opt) {
  const m = String(opt.method || "get").toUpperCase();
  if (m === "POST" && url.endsWith("/databases/db-contas/query"))
    return { json: { results: Object.entries(LINHAS_CONTAS).map(([id, properties]) => ({ id, properties })), has_more: false } };
  const id = url.split("/pages/")[1];
  if (m === "GET" && LINHAS_CONTAS[id]) return { json: { id, parent: { database_id: "db-contas" }, properties: LINHAS_CONTAS[id] } };
  if (m === "GET" && id === "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3") return { json: { id, parent: { database_id: "db-outra" }, properties: {} } };
  return null;
}
const comContas = (x = {}) => Object.assign({ props: Object.assign({ DB_CONTAS_BANCARIAS: "db-contas" }, x.props || {}), rotaExtra: rotaContas }, x);
const textoPre = (c) => { const ult = c.d.estado.copias.at(-1); return c.d.estado.salvos[ult.id].pars.join("\n"); };
const chamar = (c, payload, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok, pageId: PAGE }, payload));

/* ---------------- puro ---------------- */
test("camposAbertos: faltas de vendedor PJ, corretor e loteamento viram campos; o resto fica em lista", () => {
  const f = CV.camposAbertos([
    "Comprador 1: RG", "Vendedor: representante (RG)", "Vendedor: endereço / sede", "Vendedor: banco", "Vendedor: conta",
    "Corretor: CRECI", "Loteamento: cartório", "Vendedor: cadastro em VENDEDORES – CONTRATO",
  ], { modelo: "CONSTRUCAO", chaveLoteamento: "Setor Teste" });
  assert.deepEqual(f.grupos.map((g) => [g.grupo, g.titulo, g.criar, g.campos.map((c) => c.coluna)]), [
    ["vendedor", "Vendedor", false, ["REPRESENTANTE RG", "ENDEREÇO / SEDE"]],
    ["corretor", "Corretor", false, ["CRECI"]],
    ["loteamento", "Loteamento", false, ["CARTÓRIO"]],
  ]);
  assert.equal(f.conta, true);
  assert.deepEqual(f.outras, ["Comprador 1: RG", "Vendedor: cadastro em VENDEDORES – CONTRATO"]);
});

test("camposAbertos: corretor e loteamento sem cadastro viram 'criar'; sem SETOR o loteamento não tem como criar", () => {
  const faltas = CV.faltasContrato(CV.montarDadosContrato({ venda: { CORRETOR: "Corretor Novo" }, obra: { obraFinalizada: "SIM" } }));
  const f = CV.camposAbertos(faltas, { modelo: "PRONTO", chaveLoteamento: "Setor Novo" });
  const cor = f.grupos.find((g) => g.grupo === "corretor"), lot = f.grupos.find((g) => g.grupo === "loteamento");
  assert.deepEqual([cor.criar, cor.campos.map((c) => c.coluna)], [true, ["CRECI", "CPF/CNPJ"]]);
  assert.deepEqual([lot.criar, lot.campos.map((c) => c.coluna)],
    [true, ["DENOMINAÇÃO", "MUNICÍPIO/UF", "MATRÍCULA DO LOTEAMENTO", "CARTÓRIO", "PRAZO POSSE (DIAS)", "PRAZO CHAVES (DIAS ÚTEIS)"]]);
  assert.ok(f.outras.includes("Vendedor: cadastro em VENDEDORES – CONTRATO"));
  const sem = CV.camposAbertos(faltas, { modelo: "PRONTO", chaveLoteamento: "" });
  assert.equal(sem.grupos.some((g) => g.grupo === "loteamento"), false);
  assert.ok(sem.outras.includes("Loteamento: cadastro em LOTEAMENTOS – CONTRATO"));
  /* sem corretor na venda: não há nome para criar a linha */
  const s2 = CV.camposAbertos(["Corretor: corretor na venda"], {});
  assert.deepEqual([s2.grupos.length, s2.outras], [0, ["Corretor: corretor na venda"]]);
});

test("camposAbertos: condomínio dá título 'Condomínio'; tipo do vendedor vem como opção PJ/PF", () => {
  const f = CV.camposAbertos(["Condomínio: matrícula do empreendimento", "Vendedor: tipo (PJ ou PF)"], {});
  assert.equal(f.grupos.find((g) => g.grupo === "loteamento").titulo, "Condomínio");
  assert.deepEqual(f.grupos.find((g) => g.grupo === "vendedor").campos, [{ coluna: "TIPO", rotulo: "Tipo (PJ ou PF)", tipo: "opcao", opcoes: ["PJ", "PF"] }]);
});

test("validarCampos: lista branca, CPF/CNPJ com dígito, e-mail, dias, opção; vazio é ignorado; erro sem o valor digitado", () => {
  const ok = CV.validarCampos({
    vendedor: { "REPRESENTANTE CPF": "00000000191", "CPF/CNPJ": "11222333000181", TIPO: "pj", RG: "  ", "E-MAIL": "Fulano@Exemplo.Test" },
    corretor: { CRECI: "CRECI {{X}} 9", "CPF/CNPJ": "000.000.002-72" },
    loteamento: { "PRAZO POSSE (DIAS)": "30" },
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.erros));
  assert.deepEqual(ok.valores, {
    vendedor: { "REPRESENTANTE CPF": "000.000.001-91", "CPF/CNPJ": "11.222.333/0001-81", TIPO: "PJ", "E-MAIL": "fulano@exemplo.test" },
    corretor: { CRECI: "CRECI X 9", "CPF/CNPJ": "000.000.002-72" },
    loteamento: { "PRAZO POSSE (DIAS)": 30 },
  });
  const ruim = CV.validarCampos({
    vendedor: { "REPRESENTANTE CPF": "12345678900", "CPF/CNPJ": "11222333000180", BANCO: "001", "E-MAIL": "sem-arroba" },
    corretor: { "CPF/CNPJ": "123" }, loteamento: { "PRAZO CHAVES (DIAS ÚTEIS)": "dez" }, comprador: { X: "1" },
  });
  assert.equal(ruim.ok, false);
  assert.deepEqual(ruim.erros, [
    "Vendedor — Representante — CPF: CPF inválido", "Vendedor — CPF/CNPJ: CNPJ inválido",
    "Vendedor — BANCO: campo não permitido", "Vendedor — E-mail: e-mail inválido",
    "Corretor — CPF/CNPJ: CPF (11 dígitos) ou CNPJ (14 dígitos)",
    "Loteamento — Prazo de entrega das chaves (dias úteis): número de dias inválido", "Grupo desconhecido: comprador",
  ]);
  for (const v of ["12345678900", "11222333000180", "sem-arroba"]) assert.ok(!JSON.stringify(ruim.erros).includes(v));
  assert.deepEqual(CV.validarCampos({ vendedor: { RG: "" } }).erros, ["Nenhum campo preenchido"]);
  assert.equal(CV.validarCampos({ vendedor: { RG: { a: 1 } } }).ok, false);
  assert.equal(CV.validarCampos(null).ok, false);
});

test("validarContaDigitada: banco, agência e conta obrigatórios; Pix opcional; chaves de marcador saem", () => {
  assert.deepEqual(CV.validarContaDigitada({ banco: "756", agencia: "0001", conta: "1-0", pix: "" }),
    { ok: true, conta: { banco: "756", agencia: "0001", conta: "1-0", pix: "" } });
  assert.deepEqual(CV.validarContaDigitada({ banco: "{{756}}", agencia: "1", conta: "2" }).conta.banco, "756");
  assert.deepEqual(CV.validarContaDigitada({ banco: "", agencia: "1", conta: "" }).erros, ["Conta — Banco: obrigatório", "Conta — Conta: obrigatório"]);
  assert.equal(CV.validarContaDigitada([]).ok, false);
});

/* ---------------- servidor: formulário ---------------- */
const VEND_SEM_RG = { "REPRESENTANTE RG": rt(""), "ENDEREÇO / SEDE": rt("") };

test("FALTAM_DADOS traz o formulário (só nomes de campo, nenhum valor de ninguém)", () => {
  const c = cenario({ vendedor: VEND_SEM_RG });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.campos.grupos.map((g) => [g.grupo, g.campos.map((x) => x.coluna)]), [["vendedor", ["ENDEREÇO / SEDE", "REPRESENTANTE RG"]]]);
  const json = JSON.stringify(r);
  for (const s of ["Construtora", "000.000", "Beltrano", "pix@teste", "12345-6", "Corretor Teste"]) assert.ok(!json.includes(s), "vazou: " + s);
});

test("salvarCamposContrato: grava SÓ as colunas enviadas na linha do vendedor da obra e gera o pré-contrato com elas", () => {
  const c = cenario({ vendedor: VEND_SEM_RG });
  const r = chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { "REPRESENTANTE RG": "RG 5550001 SSP/GO", "ENDEREÇO / SEDE": "Av. Inventada, 1" } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.salvos, ["vendedor"]);
  assert.match(r.nome, /^PRÉ-CONTRATO - /);
  assert.equal(c.n.escritas.length, 1);
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base, e.linha], ["PATCH", "db-vend", 0]);
  assert.deepEqual(Object.keys(e.props).sort(), ["ENDEREÇO / SEDE", "REPRESENTANTE RG"]);
  assert.equal(e.props["REPRESENTANTE RG"].rich_text[0].text.content, "RG 5550001 SSP/GO");
  assert.equal(c.n.patches.length, 0, "a página da venda não é tocada");
  /* o pré-contrato saiu e a Propriedade do pré-contrato existe */
  assert.ok(c.p["PRECONTRATO_" + PAGE]);
  const logs = c.g.logs.join("\n");
  for (const s of ["5550001", "Inventada"]) assert.ok(!logs.includes(s), "log vazou: " + s);
});

test("salvarCamposContrato: corretor sem cadastro — cria a linha em CORRETORES com o nome da venda no título", () => {
  const c = cenario({ venda: { CORRETOR: sel("Corretor Novo Teste") }, esquemas: { "db-corr": { NOME: "title", CRECI: "rich_text", "CPF/CNPJ": "rich_text", "E-MAIL": "email" } } });
  const r0 = c.acao("gerarPreContrato");
  assert.deepEqual(r0.campos.grupos.map((g) => [g.grupo, g.criar]), [["corretor", true]]);
  const r = chamar(c, { action: "salvarCamposContrato", campos: { corretor: { CRECI: "CRECI 999", "CPF/CNPJ": "00000000272" } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base], ["POST", "db-corr"]);
  assert.equal(e.props.NOME.title[0].text.content, "Corretor Novo Teste");
  assert.equal(e.props["CPF/CNPJ"].rich_text[0].text.content, "000.000.002-72");
  assert.equal(c.n.bases["db-corr"].length, 2);
});

test("salvarCamposContrato: loteamento sem cadastro — cria na 1ª base com o SETOR na coluna SETOR (ou no título)", () => {
  /* base como a DISPONIBILIDADES POR SETOR: título OBSERVAÇÃO, coluna SETOR */
  const c = cenario({ venda: { SETOR: sel("Setor Novo") }, props: { DB_LOTEAMENTOS: "db-lote,db-emp" }, bases: { "db-emp": [] },
    esquemas: { "db-lote": { "OBSERVAÇÃO": "title", SETOR: "rich_text", "DENOMINAÇÃO": "rich_text", "MUNICÍPIO/UF": "rich_text", "MATRÍCULA DO LOTEAMENTO": "rich_text", "CARTÓRIO": "rich_text" } } });
  const campos = { loteamento: { "DENOMINAÇÃO": "Residencial Novo", "MUNICÍPIO/UF": "Cidade Teste/GO", "MATRÍCULA DO LOTEAMENTO": "M-1", "CARTÓRIO": "Cartório Novo" } };
  const r = chamar(c, { action: "salvarCamposContrato", campos });
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base], ["POST", "db-lote"]);
  assert.equal(e.props.SETOR.rich_text[0].text.content, "Setor Novo");
  assert.equal(e.props["OBSERVAÇÃO"], undefined);
  assert.ok(textoPre(c).includes("Contrato de Residencial Novo em Cidade Teste/GO"), textoPre(c));
  /* base sem coluna SETOR: o setor vai no título */
  const t = cenario({ venda: { SETOR: sel("Setor Outro") },
    esquemas: { "db-lote": { NOME: "title", "DENOMINAÇÃO": "rich_text", "MUNICÍPIO/UF": "rich_text", "MATRÍCULA DO LOTEAMENTO": "rich_text", "CARTÓRIO": "rich_text" } } });
  assert.equal(chamar(t, { action: "salvarCamposContrato", campos }).ok, true);
  assert.equal(t.n.escritas[0].props.NOME.title[0].text.content, "Setor Outro");
});

test("salvarCamposContrato: vendedor sem cadastro não é criado; nada é gravado", () => {
  const c = cenario({ obra: { "PROPRIETARIO DOCUMENTO": rt("Outra Empresa Teste") } });
  assert.equal(c.acao("gerarPreContrato").campos.grupos.some((g) => g.grupo === "vendedor"), false);
  assert.deepEqual(chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { RG: "RG 1" } } }), { ok: false, erro: "VENDEDOR_SEM_CADASTRO" });
  assert.equal(c.n.escritas.length, 0);
});

test("salvarCamposContrato: campo fora da lista, CPF errado ou coluna inexistente — CAMPOS_INVALIDOS e nada gravado", () => {
  const c = cenario({ vendedor: VEND_SEM_RG });
  const r1 = chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { "REPRESENTANTE RG": "RG 1", CONTA: "999" } } });
  assert.deepEqual(r1, { ok: false, erro: "CAMPOS_INVALIDOS", erros: ["Vendedor — CONTA: campo não permitido"] });
  const r2 = chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { "REPRESENTANTE CPF": "11111111111" } } });
  assert.deepEqual(r2.erros, ["Vendedor — Representante — CPF: CPF inválido"]);
  /* PROFISSÃO é da lista branca, mas a linha (e a base) do vendedor não têm a coluna */
  const r3 = chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { "REPRESENTANTE RG": "RG 1", "PROFISSÃO": "engenheiro" } } });
  assert.deepEqual(r3, { ok: false, erro: "CAMPOS_INVALIDOS", erros: ["Vendedor — Profissão: a base não tem essa coluna"] });
  assert.deepEqual(chamar(c, { action: "salvarCamposContrato", campos: {} }).erros, ["Nenhum campo preenchido"]);
  assert.equal(c.n.escritas.length, 0);
  assert.equal(c.d.estado.copias.length, 0);
});

test("perfil TESTES não grava campos nem escolhe conta", () => {
  const c = cenario(comContas({ vendedor: VEND_SEM_RG }));
  const tok = tokenDe("TESTES", []);
  assert.deepEqual(chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { "REPRESENTANTE RG": "RG 1" } } }, tok), { ok: false, erro: "SEM_PERMISSAO_TESTES" });
  assert.deepEqual(chamar(c, { action: "escolherContaRecebimento", conta: { id: CONTA_A } }, tok), { ok: false, erro: "SEM_PERMISSAO_TESTES" });
  assert.equal(c.n.escritas.length, 0);
  assert.equal(c.p["CONTA_RECEB_" + PAGE], undefined);
});

/* ---------------- servidor: conta de recebimento ---------------- */
test("contratoEstado lista as contas (só id e título) e escolherContaRecebimento grava por venda; o contrato usa a escolhida", () => {
  const c = cenario(comContas());
  const e0 = c.acao("contratoEstado").conta;
  assert.deepEqual(e0, { opcoes: [{ id: CONTA_A, nome: "CONTA FICTICIA A" }, { id: CONTA_B, nome: "CONTA FICTICIA B" }], escolhida: null, padrao: "" });
  const r = chamar(c, { action: "escolherContaRecebimento", conta: { id: CONTA_B } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.conta.escolhida, { id: CONTA_B });
  assert.deepEqual(JSON.parse(c.p["CONTA_RECEB_" + PAGE]), { contaId: CONTA_B });
  assert.equal(c.n.escritas.length + c.n.patches.length, 0, "nada no Notion");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  const t = textoPre(c);
  assert.ok(t.includes("Banco: 237 – Agência: 2222 – Conta 22222-2 - Titularidade"), t);
  assert.ok(!t.includes("Banco Teste") && !t.includes("PIX"), t);
});

test("conta digitada: vale só para esta venda (Propriedade), não vai para o Notion; Pix sai quando existe", () => {
  const c = cenario();
  const r = chamar(c, { action: "escolherContaRecebimento", conta: { banco: "341", agencia: "4444", conta: "44444-4", pix: "pix-d@exemplo.test" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.conta.escolhida, { banco: "341", agencia: "4444", conta: "44444-4", pix: "pix-d@exemplo.test" });
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.ok(textoPre(c).includes("Banco: 341 – Agência: 4444 – Conta 44444-4 – PIX: pix-d@exemplo.test - Titularidade"), textoPre(c));
  assert.equal(c.n.escritas.length + c.n.patches.length, 0);
  const logs = c.g.logs.join("\n");
  for (const s of ["4444", "pix-d"]) assert.ok(!logs.includes(s), "log vazou: " + s);
  /* faltando campo obrigatório */
  assert.deepEqual(chamar(c, { action: "escolherContaRecebimento", conta: { banco: "341", agencia: "", conta: "1" } }),
    { ok: false, erro: "CAMPOS_INVALIDOS", erros: ["Conta — Agência: obrigatório"] });
  /* {} volta ao padrão (a conta do vendedor, neste cenário) */
  assert.equal(chamar(c, { action: "escolherContaRecebimento", conta: {} }).ok, true);
  assert.equal(c.p["CONTA_RECEB_" + PAGE], undefined);
});

test("conta da lista: id de outra base ou sem DB_CONTAS_BANCARIAS -> CONTA_INVALIDA", () => {
  const c = cenario(comContas());
  assert.deepEqual(chamar(c, { action: "escolherContaRecebimento", conta: { id: "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3" } }), { ok: false, erro: "CONTA_INVALIDA" });
  assert.deepEqual(chamar(c, { action: "escolherContaRecebimento", conta: { id: "nao-e-id" } }), { ok: false, erro: "CONTA_INVALIDA" });
  const sem = cenario({ rotaExtra: rotaContas });
  assert.deepEqual(chamar(sem, { action: "escolherContaRecebimento", conta: { id: CONTA_A } }), { ok: false, erro: "CONTA_INVALIDA" });
});

test("trocar a conta depois do pré-contrato deixa o pré-contrato desatualizado (carimbo)", () => {
  const c = cenario(comContas());
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(c.acao("contratoEstado").pre.desatualizado, false);
  const r = chamar(c, { action: "escolherContaRecebimento", conta: { id: CONTA_A } });
  assert.equal(r.desatualizado, true);
  assert.equal(c.acao("contratoEstado").pre.desatualizado, true);
  assert.deepEqual(c.acao("aprovarPreContrato"), { ok: false, erro: "PRECONTRATO_DESATUALIZADO" });
});

test("conta escolhida que sumiu vira falta (nunca troca sozinha por outra conta)", () => {
  const c = cenario(comContas());
  c.p["CONTA_RECEB_" + PAGE] = JSON.stringify({ contaId: "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4" });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.ok(r.faltas.some((f) => /^Conta de recebimento:/.test(f)), JSON.stringify(r.faltas));
  assert.equal(r.campos.conta, true);
});

test("a conta da obra aparece como padrão; salvar campos junto com a conta digitada grava os dois e gera", () => {
  const OBRA_CONTA = { CONTA: { relation: [{ id: CONTA_A }] } };
  const c = cenario(comContas({ obraDb: "db-obras", obra: OBRA_CONTA, vendedor: VEND_SEM_RG }));
  assert.equal(c.acao("contratoEstado").conta.padrao, CONTA_A);
  const r = chamar(c, { action: "salvarCamposContrato", campos: { vendedor: { "REPRESENTANTE RG": "RG 1", "ENDEREÇO / SEDE": "Av. 1" } },
                        conta: { banco: "104", agencia: "5555", conta: "55555-5", pix: "" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.salvos, ["vendedor", "conta"]);
  assert.deepEqual(r.conta.escolhida, { banco: "104", agencia: "5555", conta: "55555-5", pix: "" });
  assert.ok(textoPre(c).includes("Banco: 104 – Agência: 5555 – Conta 55555-5 - Titularidade"), textoPre(c));
});
