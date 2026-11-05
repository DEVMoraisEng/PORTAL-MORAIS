/* 05/11/2026 (dono): "o cadastro do vendedor SEMPRE tem que vir preenchido automático, o único dado manual é os dados
 * bancários". ContratoVenda.comporVendedor (puro), a leitura da matrícula (RegrasVenda.planejarGravacao) e o
 * GerarContrato.gs/PortalVenda.gs com Notion, Drive e Apps Script falsos.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CV, tokenDe, PAGE, tit, sel, rt, cenario, colunasVenda } from "./contrato-cenario.mjs";
import { criarGas, notionFalso, COLUNAS_REAIS, PAGE_ID_PADRAO, DB_ID_PADRAO } from "./fakes.mjs";

const R = createRequire(import.meta.url)("../RegrasVenda.js");
const chamar = (c, payload, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok, pageId: PAGE }, payload));
const CPF_DONO = "000.000.004-34";           /* inventado, fecha o dígito */
const CNPJ_TESTE = "12.345.678/0001-95";     /* inventado, fecha o dígito */

/* ---------------- puro: comporVendedor ---------------- */
test("comporVendedor: o cadastro vale; o vazio vem da matrícula, depois da obra, depois do MC", () => {
  const r = CV.comporVendedor({
    cadastro: { nome: "Fulano Dono Teste", cpfCnpj: CPF_DONO, endereco: "", nacionalidade: "brasileiro", tipo: "PF" },
    matricula: { nome: "FULANO DONO TESTE", cpfCnpj: "00000000434", nacionalidade: "portuguesa", estadoCivil: "solteiro",
                 profissao: "empresário", rg: "5556667 SSP/GO", endereco: "" },
    obra: { proprietario: "Fulano Dono Teste", cpfCnpj: CPF_DONO },
    mc: { nome: "Fulano Dono Teste", cpfCnpj: CPF_DONO, endereco: "Rua Inventada, 1, Cidade Teste - GO", email: "dono@exemplo.test" },
  });
  const v = r.vendedor;
  assert.equal(v.nacionalidade, "brasileiro", "o cadastro nunca é trocado");
  assert.equal(v.estadoCivil, "solteiro");
  assert.equal(v.profissao, "empresário");
  assert.equal(v.endereco, "Rua Inventada, 1, Cidade Teste - GO", "sem endereço no cadastro nem na matrícula: o do MC");
  assert.equal(v.email, "dono@exemplo.test");
  assert.equal(v.tipo, "PF");
  assert.deepEqual(r.origem.endereco, "mc");
  assert.deepEqual(r.completar, { "ENDEREÇO / SEDE": "Rua Inventada, 1, Cidade Teste - GO", "ESTADO CIVIL": "solteiro",
    "PROFISSÃO": "empresário", RG: "5556667 SSP/GO", "E-MAIL": "dono@exemplo.test" });
});

test("comporVendedor: matrícula ou MC de OUTRA pessoa (CPF diferente) não entram", () => {
  const r = CV.comporVendedor({
    cadastro: null, obra: { proprietario: "Fulano Dono Teste", cpfCnpj: CPF_DONO },
    matricula: { nome: "Beltrano Antigo Dono", cpfCnpj: "000.000.002-72", estadoCivil: "casado", profissao: "médico", rg: "9" },
    mc: { nome: "Outro Cliente", cpfCnpj: "000.000.003-53", endereco: "Rua X" },
  });
  assert.deepEqual(r.descartadas.sort(), ["matricula", "mc"]);
  assert.equal(r.vendedor.nome, "Fulano Dono Teste");
  assert.equal(r.vendedor.estadoCivil, "");
  assert.equal(r.vendedor.endereco, "");
  assert.equal(r.vendedor.tipo, "PF", "11 dígitos da obra = PF");
  assert.deepEqual(r.completar, { "CPF/CNPJ": CPF_DONO, TIPO: "PF" });
});

test("comporVendedor: sem documento para comparar vale o nome; sem nada, null", () => {
  const r = CV.comporVendedor({ obra: { proprietario: "Fulano Dono Teste", cpfCnpj: "" },
    matricula: { nome: "FULANO DONO TESTE", cpfCnpj: "00000000434", estadoCivil: "solteiro" } });
  assert.equal(r.vendedor.cpfCnpj, "00000000434", "o CPF vem da matrícula");
  assert.equal(r.vendedor.tipo, "PF");
  assert.deepEqual(CV.comporVendedor({ obra: { proprietario: "", cpfCnpj: "" } }), { vendedor: null, origem: {}, descartadas: [], completar: {} });
  const outro = CV.comporVendedor({ obra: { proprietario: "Fulano Dono Teste", cpfCnpj: "" }, matricula: { nome: "Ciclano Diferente", cpfCnpj: "" } });
  assert.deepEqual(outro.descartadas, ["matricula"]);
});

test("comporVendedor: PJ sem representante usa REPRESENTANTE_PJ_PADRAO — que nunca vai para o cadastro", () => {
  const padrao = CV.representantePadrao(JSON.stringify({ nome: "Representante Padrão Teste", cpf: "000.000.002-72", rg: "7654321 SSP/GO",
    nacionalidade: "brasileiro", estadoCivil: "casado" }));
  const r = CV.comporVendedor({ cadastro: null, obra: { proprietario: "Construtora Teste SPE Ltda", cpfCnpj: CNPJ_TESTE },
    mc: { nome: "Construtora Teste SPE Ltda", cpfCnpj: CNPJ_TESTE, endereco: "Av. Inventada, 100" }, representantePadrao: padrao });
  const v = r.vendedor;
  assert.equal(v.tipo, "PJ");
  assert.deepEqual([v.representanteNome, v.representanteCpf, v.representanteRg, v.representanteNacionalidade, v.representanteEstadoCivil],
    ["Representante Padrão Teste", "000.000.002-72", "7654321 SSP/GO", "brasileiro", "casado"]);
  assert.equal(r.origem.representanteNome, "padrao");
  assert.ok(!Object.keys(r.completar).some((k) => /REPRESENTANTE/.test(k)));
  assert.deepEqual(r.completar, { "CPF/CNPJ": CNPJ_TESTE, "ENDEREÇO / SEDE": "Av. Inventada, 100", TIPO: "PJ" });
  /* cadastro com OUTRO representante: o padrão não mistura os dados */
  const o = CV.comporVendedor({ cadastro: { nome: "X", cpfCnpj: CNPJ_TESTE, tipo: "PJ", representanteNome: "Outro Representante" },
    obra: { proprietario: "X", cpfCnpj: CNPJ_TESTE }, representantePadrao: padrao });
  assert.equal(o.vendedor.representanteRg, "");
  /* o mesmo representante com campo vazio: completa */
  const m = CV.comporVendedor({ cadastro: { nome: "X", cpfCnpj: CNPJ_TESTE, tipo: "PJ", representanteNome: "REPRESENTANTE PADRAO TESTE" },
    obra: { proprietario: "X", cpfCnpj: CNPJ_TESTE }, representantePadrao: padrao });
  assert.equal(m.vendedor.representanteRg, "7654321 SSP/GO");
  assert.equal(CV.representantePadrao("não é json"), null);
  assert.equal(CV.representantePadrao(JSON.stringify({ cpf: "1" })), null, "sem nome não vale");
});

/* ---------------- leitura da matrícula ---------------- */
const MAT = { tipo_documento: "MATRICULA", matricula_numero: "98.765", cartorio: "CRI Teste", area_m2: "250", confrontacoes: "",
  loteamento_denominacao: "", loteamento_matricula: "", loteamento_cartorio: "",
  proprietario_nome: " FULANO  DONO TESTE ", proprietario_cpf_cnpj: "00000000434", nacionalidade: "brasileiro", estado_civil: "solteiro",
  profissao: "empresário", rg: "5556667 SSP/GO", endereco: "Rua Inventada, 1, Cidade Teste/GO" };

test("matrícula: a qualificação do proprietário atual vai para as colunas VENDEDOR - …", () => {
  const p = R.planejarGravacao("IMOVEL_MATRICULA", MAT, {}, "2026-11-05");
  const C = R.COL_VENDEDOR_MAT;
  assert.equal(p.props[C.NOME], "FULANO DONO TESTE");
  assert.equal(p.props[C.CPF_CNPJ], CPF_DONO, "CPF formatado");
  assert.equal(p.props[C.ESTADO_CIVIL], "solteiro");
  assert.equal(p.props[C.RG], "5556667 SSP/GO");
  assert.equal(p.props[C.ENDERECO], "Rua Inventada, 1, Cidade Teste/GO");
  const pj = R.planejarGravacao("IMOVEL_MATRICULA", Object.assign({}, MAT, { proprietario_cpf_cnpj: "12345678000195" }), {}, "2026-11-05");
  assert.equal(pj.props[C.CPF_CNPJ], CNPJ_TESTE);
  const ruim = R.planejarGravacao("IMOVEL_MATRICULA", Object.assign({}, MAT, { proprietario_cpf_cnpj: "00000000435" }), {}, "2026-11-05");
  assert.ok(!(C.CPF_CNPJ in ruim.props));
  assert.ok(ruim.observacoes.some((o) => /CPF\/CNPJ do proprietário/.test(o) && !/00000000435/.test(o)));
});

test("espacosDoTexto: só espaços do imóvel, sem repetir, na ordem de leitura", () => {
  assert.deepEqual(R.espacosDoTexto("IMOVEL_ALVARA, IMOVEL_MATRICULA;IMOVEL_ALVARA C1_IDENTIDADE constructor"), ["IMOVEL_MATRICULA", "IMOVEL_ALVARA"]);
  assert.deepEqual(R.espacosDoTexto(""), []);
});

/* ---------------- GerarContrato.gs ---------------- */
const COLS_VEND = Object.fromEntries(Object.values(R.COL_VENDEDOR_MAT).concat(Object.values(R.COL_VENDEDOR_MC)).map((c) => [c, "rich_text"]));
const ESQ_VEND = { NOME: "title", "CPF/CNPJ": "rich_text", "ENDEREÇO / SEDE": "rich_text", NACIONALIDADE: "rich_text", "ESTADO CIVIL": "rich_text",
  "PROFISSÃO": "rich_text", RG: "rich_text", "E-MAIL": "email", BANCO: "rich_text", "AGÊNCIA": "rich_text", CONTA: "rich_text" };
const LIDO_DA_MATRICULA = {
  "VENDEDOR - NOME": rt("FULANO DONO TESTE"), "VENDEDOR - CPF/CNPJ": rt(CPF_DONO), "VENDEDOR - NACIONALIDADE": rt("brasileiro"),
  "VENDEDOR - ESTADO CIVIL": rt("solteiro"), "VENDEDOR - PROFISSÃO": rt("empresário"), "VENDEDOR - RG": rt("5556667 SSP/GO"),
  "VENDEDOR - ENDEREÇO": rt("Rua Inventada, 1, Cidade Teste/GO"),
};
const OBRA_PF = { "PROPRIETARIO DOCUMENTO": rt("Fulano Dono Teste"), "CPF/CNPJ ": sel(CPF_DONO) };

test("casa de rua sem cadastro do vendedor: a matrícula qualifica o PF, a linha é criada e só falta o banco", () => {
  const c = cenario({ colunas: Object.assign(colunasVenda(), COLS_VEND), venda: LIDO_DA_MATRICULA, obra: OBRA_PF, esquemas: { "db-vend": ESQ_VEND } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.erro, "FALTAM_DADOS");
  assert.deepEqual(r.faltas.filter((f) => /^Vendedor/.test(f)).sort(), ["Vendedor: agência", "Vendedor: banco", "Vendedor: conta"]);
  assert.equal(r.campos.conta, true, "o banco é o único dado manual (Conta de recebimento)");
  assert.ok(!r.campos.grupos.some((g) => g.grupo === "vendedor"));
  /* a linha nova do cadastro: título = PROPRIETARIO DOCUMENTO e a qualificação lida (nunca banco) */
  assert.equal(c.n.escritas.length, 1);
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base], ["POST", "db-vend"]);
  assert.equal(e.props.NOME.title[0].text.content, "Fulano Dono Teste");
  assert.deepEqual(Object.keys(e.props).sort(), ["CPF/CNPJ", "ENDEREÇO / SEDE", "ESTADO CIVIL", "NACIONALIDADE", "NOME", "PROFISSÃO", "RG"]);
  /* nada vazou no log */
  const logs = c.g.logs.join("\n");
  for (const s of ["Fulano", "5556667", "Inventada", "004-34"]) assert.ok(!logs.includes(s), "log vazou: " + s);
  /* com a conta digitada, o pré-contrato sai com o vendedor PF qualificado */
  const r2 = chamar(c, { action: "salvarCamposContrato", conta: { banco: "001", agencia: "1111", conta: "11111-1" } });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ult = c.d.estado.copias.at(-1), texto = c.d.estado.salvos[ult.id].pars.join("\n");
  assert.ok(texto.includes("PF: Fulano Dono Teste, empresário"), texto);
  assert.equal(c.n.escritas.length, 1, "a 2ª geração não regrava (a linha já tem tudo)");
});

test("cadastro com campo preenchido nunca é sobrescrito; só o vazio é completado", () => {
  const c = cenario({ colunas: Object.assign(colunasVenda(), COLS_VEND), venda: LIDO_DA_MATRICULA, obra: OBRA_PF,
    vendedor: { NOME: tit("Fulano Dono Teste"), TIPO: sel("PF"), "CPF/CNPJ": rt(CPF_DONO), "ENDEREÇO / SEDE": rt("Endereço do Cadastro"),
                NACIONALIDADE: rt("brasileira naturalizada"), "ESTADO CIVIL": rt(""), "PROFISSÃO": rt(""), RG: rt(""),
                "REPRESENTANTE NOME": null, "REPRESENTANTE CPF": null, "REPRESENTANTE RG": null, "REPRESENTANTE NACIONALIDADE": null,
                "REPRESENTANTE ESTADO CIVIL": null } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.n.escritas.length, 1);
  const e = c.n.escritas[0];
  assert.deepEqual([e.metodo, e.base, e.linha], ["PATCH", "db-vend", 0]);
  assert.deepEqual(Object.keys(e.props).sort(), ["ESTADO CIVIL", "PROFISSÃO", "RG"]);
  const ult = c.d.estado.copias.at(-1), texto = c.d.estado.salvos[ult.id].pars.join("\n");
  assert.ok(texto.includes("PF: Fulano Dono Teste, empresário"), texto);
});

test("PJ sem representante no cadastro: REPRESENTANTE_PJ_PADRAO fecha o contrato; o padrão não vai para a linha", () => {
  const padrao = JSON.stringify({ nome: "Representante Padrão Teste", cpf: "000.000.002-72", rg: "7654321 SSP/GO", nacionalidade: "brasileiro", estadoCivil: "casado" });
  const semRep = { "REPRESENTANTE NOME": rt(""), "REPRESENTANTE CPF": rt(""), "REPRESENTANTE RG": rt(""), "REPRESENTANTE NACIONALIDADE": rt(""), "REPRESENTANTE ESTADO CIVIL": rt("") };
  const sem = cenario({ vendedor: semRep });
  assert.ok(sem.acao("gerarPreContrato").faltas.includes("Vendedor: representante (nome)"));
  const c = cenario({ vendedor: semRep, props: { REPRESENTANTE_PJ_PADRAO: padrao } });
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, true, JSON.stringify(r));
  const ult = c.d.estado.copias.at(-1), texto = c.d.estado.salvos[ult.id].pars.join("\n");
  assert.ok(texto.includes("PJ: Construtora Teste Ltda representada por Representante Padrão Teste"), texto);
  assert.equal(c.n.escritas.length, 0, "nada a completar no cadastro");
});

test("matrícula de OUTRA pessoa (venda antiga do lote) não vira vendedor", () => {
  const outro = Object.assign({}, LIDO_DA_MATRICULA, { "VENDEDOR - CPF/CNPJ": rt("000.000.003-53"), "VENDEDOR - NOME": rt("Antigo Dono Teste") });
  const c = cenario({ colunas: Object.assign(colunasVenda(), COLS_VEND), venda: outro, obra: OBRA_PF, esquemas: { "db-vend": ESQ_VEND } });
  const r = c.acao("gerarPreContrato");
  for (const f of ["Vendedor: estado civil", "Vendedor: profissão", "Vendedor: RG"]) assert.ok(r.faltas.includes(f), f);
  assert.ok(c.g.logs.some((l) => /matricula de outra pessoa/.test(l)));
  /* a linha nova leva só o que é da obra */
  assert.deepEqual(Object.keys(c.n.escritas[0].props).sort(), ["CPF/CNPJ", "NOME"]);
});

/* ---------------- PortalVenda.gs: o que o robô do servidor anexou ---------------- */
/* ---------------- PortalVenda.gs: leitura da matrícula e o que o robô do servidor anexou ---------------- */
const SIT = ["FALTA DOCUMENTO", "LIDO PELA IA – CONFERIR", "CONFERIDO", "DEVOLVIDO"];
const COLS_IMOVEL = {
  "IMÓVEL - MATRÍCULA": "files", "IMÓVEL - ALVARÁ": "files", "IMÓVEL - HABITE-SE": "files",
  "DOSSIÊ IMÓVEL": { tipo: "select", opcoes: SIT }, "DOSSIÊ IMÓVEL - OBSERVAÇÃO": "rich_text",
  "CONTRATO - MATRÍCULA INDIVIDUAL": "rich_text", "CONTRATO - CRI DA MATRÍCULA": "rich_text",
  "CONTRATO - ÁREA DO LOTE (M²)": "number", "CONTRATO - CONFRONTAÇÕES": "rich_text",
  "CONTRATO - ALVARÁ Nº": "rich_text", "CONTRATO - ALVARÁ DATA": "date", "CONTRATO - HABITE-SE Nº": "rich_text",
  "CONTRATO - MATRÍCULA DO LOTEAMENTO": "rich_text", "CONTRATO - CARTÓRIO DO LOTEAMENTO": "rich_text",
};
function portal({ colunas, valores }) {
  const n = notionFalso({ colunas: Object.assign({}, COLUNAS_REAIS, COLS_IMOVEL, colunas || {}), valores: Object.assign({ "TIPO DE CASA": { select: { name: "CASA DE RUA" } } }, valores || {}) });
  const props = { NOTION_TOKEN: "ntn-falso", SESSION_SECRET: "segredo-de-teste", ANTHROPIC_API_KEY: "sk-falsa", DB_VENDAS: DB_ID_PADRAO, PROVEDOR_IA: "anthropic" };
  const g = criarGas({ props, rotas: (url, opt) => {
    if (url === "https://api.anthropic.com/v1/messages")
      return { json: { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(MAT) }] } };
    return n.rota(url, opt);
  } });
  return { n, g, props };
}
const PDF = Buffer.from("%PDF-1.4 matricula falsa").toString("base64");
const lerMatricula = (x) => x.g.chamar({ action: "lerDocumento", token: tokenDe(), pageId: PAGE_ID_PADRAO, espaco: "IMOVEL_MATRICULA",
  arquivo: { nome: "m.pdf", mime: "application/pdf", base64: PDF } });

test("ler a matrícula grava a qualificação nas colunas VENDEDOR - …; sem as colunas, um aviso só", () => {
  const com = portal({ colunas: COLS_VEND });
  const r = lerMatricula(com);
  assert.equal(r.ok, true, JSON.stringify(r));
  const txt = (c) => com.n.pagina.properties[c].rich_text.map((t) => t.text.content).join("");
  assert.equal(txt("VENDEDOR - CPF/CNPJ"), CPF_DONO);
  assert.equal(txt("VENDEDOR - PROFISSÃO"), "empresário");
  const sem = portal({});
  const r2 = lerMatricula(sem);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const avisos = r2.observacoes.filter((o) => /VENDEDOR - /.test(o));
  assert.equal(avisos.length, 1, JSON.stringify(r2.observacoes));
  assert.match(avisos[0], /qualificação do proprietário não foi gravada/);
});

test("estado: DOSSIÊ IMÓVEL - NOVOS DO MAIS CONTROLE vira 'novo, não lido' e a coluna é limpa (TESTES só vê)", () => {
  const novos = R.COL_MC_DOCS.NOVOS;
  const arq = { files: [{ name: "matricula.pdf", type: "file", file: { url: "https://s3.falso/m" } }] };
  const valores = { [novos]: rt("IMOVEL_MATRICULA, IMOVEL_ALVARA"), "IMÓVEL - MATRÍCULA": arq };
  const t = portal({ colunas: { [novos]: "rich_text" }, valores });
  const r0 = t.g.chamar({ action: "estado", token: tokenDe("TESTES", ["VENDAS"]), pageId: PAGE_ID_PADRAO });
  assert.deepEqual(r0.pendentes, ["IMOVEL_MATRICULA"], "o alvará sem arquivo não conta");
  assert.equal(t.props["venda_pend_" + PAGE_ID_PADRAO], undefined, "TESTES não grava");
  const c = portal({ colunas: { [novos]: "rich_text" }, valores });
  const r = c.g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE_ID_PADRAO });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.pendentes, ["IMOVEL_MATRICULA"]);
  assert.deepEqual(JSON.parse(c.props["venda_pend_" + PAGE_ID_PADRAO]), { IMOVEL_MATRICULA: "atualizar", IMOVEL_ALVARA: "atualizar" });
  assert.deepEqual(c.n.pagina.properties[novos].rich_text, [], "a coluna foi limpa");
  assert.deepEqual(c.g.chamar({ action: "estado", token: tokenDe(), pageId: PAGE_ID_PADRAO }).pendentes, ["IMOVEL_MATRICULA"], "continua novo até ler");
});
