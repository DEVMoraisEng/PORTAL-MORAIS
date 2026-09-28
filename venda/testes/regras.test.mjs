import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../RegrasVenda.js");

test("cpfValido aceita CPF de exemplo e recusa dígito errado e repetido", () => {
  assert.equal(R.cpfValido("529.982.247-25"), true);
  assert.equal(R.cpfValido("52998224725"), true);
  assert.equal(R.cpfValido("529.982.247-24"), false);
  assert.equal(R.cpfValido("111.111.111-11"), false);
  assert.equal(R.cpfValido("123"), false);
});

test("mascararCpf e formatarCpf", () => {
  assert.equal(R.mascararCpf("529.982.247-25"), "***-25");
  assert.equal(R.mascararCpf(""), "sem CPF");
  assert.equal(R.formatarCpf("52998224725"), "529.982.247-25");
});

test("chave ignora acento, caixa, espaço sobrando e troca travessão por hífen", () => {
  assert.equal(R.chave("  Dossiê  - observação "), "DOSSIE - OBSERVACAO");
  assert.equal(R.chave("LIDO PELA IA – CONFERIR"), R.chave("lido pela ia - conferir"));
});

test("contemNome acha nome inteiro dentro de CLIENTES de casal", () => {
  assert.equal(R.contemNome("ANA TESTE E BRUNO TESTE", "bruno teste"), true);
  assert.equal(R.contemNome("ANA TESTE", "ANA"), true);
  assert.equal(R.contemNome("ANA TESTEIRA", "ANA TESTE"), false);
  assert.equal(R.contemNome("ANA TESTE", ""), false);
});

test("dataDoc e diasEntre", () => {
  assert.equal(R.dataDoc("05/08/2026"), "2026-08-05");
  assert.equal(R.dataDoc("2026-08-05T10:00"), "2026-08-05");
  assert.equal(R.dataDoc("agosto de 2026"), "");
  assert.equal(R.diasEntre("2026-06-01", "2026-09-23"), 114);
});

test("valorBR entende R$, milhar com ponto e vírgula decimal", () => {
  assert.equal(R.valorBR("R$ 180.000,00"), 180000);
  assert.equal(R.valorBR("180.000"), 180000);
  assert.equal(R.valorBR("12500,5"), 12500.5);
  assert.equal(R.valorBR("0,00"), 0);
  assert.equal(R.valorBR(""), null);
  assert.equal(R.valorBR("-"), null);
  assert.equal(R.valorBR(3500), 3500);
});

test("resolverColunas acha nomes com espaço sobrando, sem acento e hífen no lugar do travessão", () => {
  const schema = {};
  for (const canon of Object.values(R.COL)) schema[canon] = { tipo: R.TIPOS[canon] };
  delete schema["CLIENTES"]; schema["CLIENTES "] = { tipo: "rich_text" };
  delete schema["CPF"]; schema["CPF "] = { tipo: "rich_text" };
  delete schema["DOSSIÊ"]; schema["DOSSIE"] = { tipo: "select" };
  const r = R.resolverColunas(schema);
  assert.deepEqual(r.faltando, []);
  assert.deepEqual(r.tipoErrado, []);
  assert.equal(r.mapa["CLIENTES"], "CLIENTES ");
  assert.equal(r.mapa["DOSSIÊ"], "DOSSIE");
});

test("resolverColunas lista a que falta e a de tipo errado", () => {
  const schema = {};
  for (const canon of Object.values(R.COL)) schema[canon] = { tipo: R.TIPOS[canon] };
  delete schema["VALOR DO SUBSÍDIO"];
  schema["APROVAÇÃO DA CAIXA"] = { tipo: "rich_text" };
  const r = R.resolverColunas(schema);
  assert.deepEqual(r.faltando, ["VALOR DO SUBSÍDIO"]);
  assert.deepEqual(r.tipoErrado, ["APROVAÇÃO DA CAIXA"]);
});

test("resolverOpcao devolve a grafia real da opção", () => {
  assert.equal(R.resolverOpcao(["LIDO PELA IA - CONFERIR", "CONFERIDO"], "LIDO PELA IA – CONFERIR"), "LIDO PELA IA - CONFERIR");
  assert.equal(R.resolverOpcao([], "CONFERIDO"), "CONFERIDO");
});

test("manterArquivo reenvia arquivo do Notion como type file e externo como external", () => {
  assert.deepEqual(R.manterArquivo({ name: "a.pdf", type: "file", file: { url: "https://s3/x", expiry_time: "t" } }),
    { type: "file", name: "a.pdf", file: { url: "https://s3/x" } });
  assert.deepEqual(R.manterArquivo({ name: "b", type: "external", external: { url: "https://e" } }),
    { type: "external", name: "b", external: { url: "https://e" } });
});

test("mimeDoArquivo e conferirArquivo", () => {
  assert.equal(R.mimeDoArquivo("x.JPG", "binary/octet-stream"), "image/jpeg");
  assert.equal(R.mimeDoArquivo("x", "application/pdf; charset=x"), "application/pdf");
  assert.deepEqual(R.conferirArquivo({ mime: "image/heic", base64: "AAAA" }), { ok: false, erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" });
  const seisMega = "A".repeat(Math.ceil(6 * 1024 * 1024 * 4 / 3));
  assert.deepEqual(R.conferirArquivo({ mime: "image/jpeg", base64: seisMega }), { ok: false, erro: "ARQUIVO_GRANDE" });
  assert.deepEqual(R.conferirArquivo({ mime: "application/pdf", base64: seisMega }), { ok: true });
  assert.deepEqual(R.conferirArquivo(null), { ok: false, erro: "SEM_ARQUIVO" });
});

test("juntarObservacoes acrescenta com data e login e corta em 1900 caracteres", () => {
  assert.equal(R.juntarObservacoes("", ["x"], "23/09", "ana"), "[23/09 ana] x");
  assert.equal(R.juntarObservacoes("antes", ["x", "y"], "23/09", "ana"), "antes\n[23/09 ana] x\n[23/09 ana] y");
  const longo = R.juntarObservacoes("z".repeat(3000), ["fim"], "23/09", "ana");
  assert.equal(longo.length, 1900);
  assert.ok(longo.endsWith("[23/09 ana] fim"));
});

test("temDoisCompradores, contarArquivos e estadoAposLeitura", () => {
  const um = { [R.COL.C1_IDENT]: [{}], [R.COL.C1_COMPROV]: [{}] };
  assert.equal(R.temDoisCompradores(um), false);
  const arq1 = R.contarArquivos(um);
  assert.equal(arq1.C1_IDENTIDADE, 1);
  assert.equal(arq1.APROVACAO, 0);
  assert.deepEqual(R.estadoAposLeitura(arq1, false), { estado: "LIDO PELA IA – CONFERIR", faltam: [] });
  const dois = Object.assign({}, um, { [R.COL.C2_NOME]: "BRUNO TESTE" });
  assert.equal(R.temDoisCompradores(dois), true);
  assert.deepEqual(R.estadoAposLeitura(R.contarArquivos(dois), true),
    { estado: "FALTA DOCUMENTO", faltam: ["C2_IDENTIDADE", "C2_COMPROVANTE"] });
});

const C = R.COL;
const HOJE = "2026-09-23";
const CNH = { tipo_documento: "CNH", nome: "ANA TESTE", cpf: "52998224725", numero_documento: "01234567890",
              orgao_emissor: "DETRAN/GO", nacionalidade: "brasileira", data_nascimento: "01/01/1990",
              rg_numero: "0987654321", rg_orgao_uf: "SSP/GO" };
const DOC_CNH_RG = "RG " + CNH.rg_numero + " " + CNH.rg_orgao_uf;

test("identidade do comprador 1 preenche CLIENTES, CPF, documento (RG) e nacionalidade vazios", () => {
  const p = R.planejarGravacao("C1_IDENTIDADE", CNH, {}, HOJE);
  assert.deepEqual(p.props, {
    [C.CLIENTES]: "ANA TESTE", [C.CPF1]: "529.982.247-25",
    [C.C1_DOC]: DOC_CNH_RG, [C.C1_NAC]: "brasileira"
  });
  assert.deepEqual(p.observacoes, []);
});

test("segunda leitura do mesmo documento não sobrescreve nem gera observação", () => {
  const atuais = { [C.CLIENTES]: "Ana  Teste", [C.CPF1]: "529.982.247-25", [C.C1_DOC]: DOC_CNH_RG, [C.C1_NAC]: "Brasileira" };
  const p = R.planejarGravacao("C1_IDENTIDADE", CNH, atuais, HOJE);
  assert.deepEqual(p.props, {});
  assert.deepEqual(p.observacoes, []);
});

test("CPF diferente do que já está no campo grava o novo (último documento vale) e anota os dois mascarados", () => {
  const p = R.planejarGravacao("C1_IDENTIDADE", CNH, { [C.CPF1]: "111.444.777-35" }, HOJE);
  assert.equal(p.props[C.CPF1], "529.982.247-25");
  assert.equal(p.observacoes.length, 1);
  assert.match(p.observacoes[0], /CPF .*antes \*\*\*-35, agora \*\*\*-25/);
  assert.doesNotMatch(p.observacoes[0], /529|111/);
});

test("'trocar' limpa os campos que o documento novo não trouxer", () => {
  const leituraVazia = { tipo_documento: "CNH", nome: "", cpf: "", numero_documento: "", orgao_emissor: "",
                          nacionalidade: "", data_nascimento: "", rg_numero: "", rg_orgao_uf: "" };
  const atuais = { [C.CLIENTES]: "ANA TESTE E BRUNO TESTE", [C.CPF1]: "529.982.247-25", [C.C1_DOC]: DOC_CNH_RG, [C.C1_NAC]: "brasileira" };
  const p = R.planejarGravacao("C1_IDENTIDADE", leituraVazia, atuais, HOJE, "trocar");
  assert.deepEqual(p.props, { [C.CLIENTES]: "BRUNO TESTE", [C.CPF1]: "", [C.C1_DOC]: "", [C.C1_NAC]: "" });
  assert.deepEqual(p.observacoes, []);
});

test("'atualizar' (padrão) mantém os campos que o documento novo não trouxer", () => {
  const leituraVazia = { tipo_documento: "CNH", nome: "", cpf: "", numero_documento: "", orgao_emissor: "",
                          nacionalidade: "", data_nascimento: "", rg_numero: "", rg_orgao_uf: "" };
  const atuais = { [C.CLIENTES]: "ANA TESTE", [C.CPF1]: "529.982.247-25", [C.C1_DOC]: DOC_CNH_RG, [C.C1_NAC]: "brasileira" };
  const p = R.planejarGravacao("C1_IDENTIDADE", leituraVazia, atuais, HOJE);
  assert.deepEqual(p.props, {});
  assert.deepEqual(p.observacoes, []);
});

test("CLIENTES casal: comprador 1 novo troca só a parte antes de \" E \"; comprador 2 novo troca só a parte depois", () => {
  const leitura1 = Object.assign({}, CNH, { nome: "CARLA NOVA" });
  const p1 = R.planejarGravacao("C1_IDENTIDADE", leitura1, { [C.CLIENTES]: "ANA TESTE E BRUNO TESTE" }, HOJE);
  assert.equal(p1.props[C.CLIENTES], "CARLA NOVA E BRUNO TESTE");

  const leitura2 = Object.assign({}, CNH, { nome: "DANIEL NOVO" });
  const p2 = R.planejarGravacao("C2_IDENTIDADE", leitura2, { [C.CLIENTES]: "ANA TESTE E BRUNO TESTE" }, HOJE);
  assert.equal(p2.props[C.C2_NOME], "DANIEL NOVO");
  assert.equal(p2.props[C.CLIENTES], "ANA TESTE E DANIEL NOVO");
});

test("DOCUMENTO: CNH com rg_numero grava RG; sem rg_numero cai no número da CNH e observa", () => {
  const p1 = R.planejarGravacao("C1_IDENTIDADE", CNH, {}, HOJE);
  assert.equal(p1.props[C.C1_DOC], DOC_CNH_RG);
  assert.deepEqual(p1.observacoes, []);

  const semRg = Object.assign({}, CNH, { rg_numero: "", rg_orgao_uf: "" });
  const p2 = R.planejarGravacao("C1_IDENTIDADE", semRg, {}, HOJE);
  assert.equal(p2.props[C.C1_DOC], "CNH 01234567890 DETRAN/GO");
  assert.equal(p2.observacoes.length, 1);
  assert.match(p2.observacoes[0], /RG não encontrado no documento — gravado o número do CNH/);
});

test("CPF lido com dígito errado não é gravado e vira observação", () => {
  const p = R.planejarGravacao("C1_IDENTIDADE", Object.assign({}, CNH, { cpf: "52998224724" }), {}, HOJE);
  assert.equal(p.props[C.CPF1], undefined);
  assert.match(p.observacoes[0], /não fecha o dígito/);
});

test("arquivo de outro tipo no espaço não preenche nada", () => {
  const p = R.planejarGravacao("C1_COMPROVANTE", Object.assign({}, CNH), {}, HOJE);
  assert.deepEqual(p.props, {});
  assert.match(p.observacoes[0], /não parece ser um comprovante de endereço/);
});

test("comprador 2: grava COMPRADOR 2 e completa CLIENTES de um nome só", () => {
  const leitura = Object.assign({}, CNH, { nome: "BRUNO TESTE", cpf: "11144477735" });
  const p = R.planejarGravacao("C2_IDENTIDADE", leitura, { [C.CLIENTES]: "ANA TESTE" }, HOJE);
  assert.equal(p.props[C.C2_NOME], "BRUNO TESTE");
  assert.equal(p.props[C.C2_CPF], "111.444.777-35");
  assert.equal(p.props[C.CLIENTES], "ANA TESTE E BRUNO TESTE");
});

test("comprador 1 lido depois do 2 grava CLIENTES com os dois nomes", () => {
  const p = R.planejarGravacao("C1_IDENTIDADE", CNH, { [C.C2_NOME]: "BRUNO TESTE" }, HOJE);
  assert.equal(p.props[C.CLIENTES], "ANA TESTE E BRUNO TESTE");
});

test("comprovante: endereço vazio é preenchido; velho e de outra pessoa viram observação", () => {
  const leitura = { tipo_documento: "COMPROVANTE", titular: "CARLOS OUTRO", endereco_completo: "RUA TESTE, 10, CENTRO, GOIÂNIA/GO, 74000-000", data_emissao: "01/05/2026" };
  const p = R.planejarGravacao("C1_COMPROVANTE", leitura, { [C.CLIENTES]: "ANA TESTE" }, HOJE);
  assert.equal(p.props[C.C1_END], "RUA TESTE, 10, CENTRO, GOIÂNIA/GO, 74000-000");
  assert.equal(p.observacoes.length, 2);
  assert.match(p.observacoes[0], /outra pessoa/);
  assert.match(p.observacoes[1], /145 dias/);
});

test("comprovante sem data legível vira observação", () => {
  const p = R.planejarGravacao("C1_COMPROVANTE", { tipo_documento: "COMPROVANTE", titular: "", endereco_completo: "", data_emissao: "" }, {}, HOJE);
  assert.match(p.observacoes[0], /não consegui ler a data/);
});

test("aprovação da Caixa grava valores e aponta CPF de proponente estranho", () => {
  const leitura = { tipo_documento: "APROVACAO", nome_proponente: "X", cpf_proponente: "11144477735", valor_financiado: "180.000,00", valor_fgts: "R$ 12.000,00", valor_subsidio: "" };
  const p = R.planejarGravacao("APROVACAO", leitura, { [C.CPF1]: "529.982.247-25" }, HOJE);
  assert.deepEqual(p.props, { [C.FINANCIADO]: 180000, [C.FGTS]: 12000 });
  assert.match(p.observacoes[0], /\*\*\*-35/);
});

test("aprovação com o mesmo valor já gravado não gera observação", () => {
  const leitura = { tipo_documento: "APROVACAO", nome_proponente: "", cpf_proponente: "", valor_financiado: "180000", valor_fgts: "", valor_subsidio: "" };
  const p = R.planejarGravacao("APROVACAO", leitura, { [C.FINANCIADO]: 180000 }, HOJE);
  assert.deepEqual(p.props, {});
  assert.deepEqual(p.observacoes, []);
});
