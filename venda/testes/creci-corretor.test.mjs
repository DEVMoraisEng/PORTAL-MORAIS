/* 27/11/2026: "Subir CRECI do corretor" — ação lerCreciCorretor (GerarContrato.gs). A IA lê o documento; o que ela leu passa
 * por regra (CPF/CNPJ com dígito verificador, CRECI só dígito/ponto/hífen/letra) e só entra em campo VAZIO da linha do corretor
 * (achada pelo título ou pelo APELIDO). Campo preenchido e diferente vira divergência. O arquivo é acrescentado em
 * "CRECI - DOCUMENTO". Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CV, tokenDe, PAGE, cenario, tit, sel, rt } from "./contrato-cenario.mjs";

const LogContratoVenda = createRequire(import.meta.url)("../LogContratoVenda.js");
const IA = { OPENAI_API_KEY: "sk-teste" };
const LIDO = { tipo_documento: "CRECI", tipo: "PF", nome: "Fulano de Tal", creci: "CRECI nº 12.345-F", cpf_cnpj: "529.982.247-25", validade: "31/12/2027", uf: "GO" };
const ESQ = { NOME: "title", CRECI: "rich_text", "CPF/CNPJ": "rich_text", APELIDO: "rich_text", "CRECI - DOCUMENTO": "files", "E-MAIL": "email" };
const JPG = Buffer.from("jpeg falso do crechi").toString("base64");
const pedido = (extra = {}) => Object.assign({ action: "lerCreciCorretor", pageId: PAGE, arquivo: JPG, mime: "image/jpeg", nomeArquivo: "creci.jpg" }, extra);

/* a linha do corretor: título completo + APELIDO "IVAN"; CRECI e CPF/CNPJ vazios, coluna de arquivos presente */
const LINHA = { NOME: tit("FULANO DE TAL"), CRECI: rt(""), "CPF/CNPJ": rt(""), APELIDO: rt("IVAN"), "CRECI - DOCUMENTO": { files: [] } };

function montar({ leitura = LIDO, linha = LINHA, linhas, venda = { CORRETOR: sel("IVAN") }, esquemas = { "db-corr": ESQ }, props = IA } = {}) {
  const conta = { n: 0 };
  const rotaExtra = (url, opt) => {
    if (!url.startsWith("https://api.openai.com/")) return null;
    conta.n++; conta.corpo = JSON.parse(opt.payload);
    return { json: { status: "completed", usage: { input_tokens: 800, output_tokens: 50 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(leitura) }] }] } };
  };
  const c = cenario({ venda, esquemas, props, rotaExtra, bases: { "db-corr": JSON.parse(JSON.stringify(linhas || [linha])) } });   /* cópia: o Notion falso grava na linha */
  const subir = (extra, tok = tokenDe()) => c.g.chamar(Object.assign({ token: tok }, pedido(extra)));
  return Object.assign(c, { conta, subir, corr: (i = 0) => c.n.bases["db-corr"][i], txt: (col, i = 0) => (c.n.bases["db-corr"][i][col].rich_text || []).map((t) => t.plain_text || t.text.content).join("") });
}

test("leitura preenche o que está vazio (CRECI e CPF/CNPJ), com o CRECI sem a palavra \"CRECI nº\"; uma chamada à IA", () => {
  const c = montar();
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.conta.n, 1);
  assert.match(JSON.stringify(c.conta.corpo), /leitura_creci/);
  assert.deepEqual(r.preenchidos, ["CRECI", "CPF/CNPJ"]);
  assert.deepEqual([r.divergencias, r.descartados], [[], []]);
  assert.equal(c.txt("CRECI"), "12.345-F");
  assert.equal(c.txt("CPF/CNPJ"), "529.982.247-25");
  assert.equal(c.n.escritas.filter((e) => e.metodo === "PATCH" && Object.keys(e.props).includes("CRECI")).length, 1);
  assert.equal(c.n.escritas.filter((e) => e.metodo === "POST").length, 0, "achou a linha pelo apelido: não cria outra");
  assert.equal(r.comissaoCorretor.corretor, "FULANO DE TAL", "devolve o estado do bloco do corretor, já com a linha achada pelo apelido");
  assert.equal(c.n.patches.length, 0, "a página da venda não é tocada");
});

test("log e histórico sem dado pessoal: só colunas e tokens", () => {
  const c = montar();
  assert.equal(c.subir().ok, true);
  const log = c.g.logs.join("\n");
  assert.match(log, /lerCreciCorretor 01234567 ok openai tokens 800\/50; preencheu CRECI,CPF\/CNPJ/);
  assert.doesNotMatch(log, /12\.345|529\.982|FULANO|Fulano/i);
});

test("não sobrescreve campo preenchido e diferente: vira divergência (cadastro × lido); igual não vira nada", () => {
  const c = montar({ linha: Object.assign({}, LINHA, { CRECI: rt("CRECI 99.999-F") }) });
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.preenchidos, ["CPF/CNPJ"]);
  assert.deepEqual(r.divergencias, [{ coluna: "CRECI", cadastro: "CRECI 99.999-F", lido: "12.345-F" }]);
  assert.equal(c.txt("CRECI"), "CRECI 99.999-F", "o cadastro não foi tocado");
  const e = c.n.escritas.find((x) => x.metodo === "PATCH" && x.props["CPF/CNPJ"]);
  assert.deepEqual(Object.keys(e.props).filter((k) => k !== "CRECI - DOCUMENTO"), ["CPF/CNPJ"]);
  /* mesmo CRECI escrito de outro jeito (pontuação/prefixo) e mesmo CPF com ou sem máscara: nada a dizer */
  const igual = montar({ linha: Object.assign({}, LINHA, { CRECI: rt("12345f"), "CPF/CNPJ": rt("52998224725") }) });
  const ri = igual.subir();
  assert.deepEqual([ri.preenchidos, ri.divergencias], [[], []]);
});

test("CPF com dígito verificador errado é descartado e reportado; CRECI com lixo também; o resto entra", () => {
  const c = montar({ leitura: Object.assign({}, LIDO, { cpf_cnpj: "529.982.247-26", creci: "12 345 / F ?" }) });
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.descartados.sort(), ["CPF/CNPJ", "CRECI"]);
  assert.deepEqual(r.preenchidos, []);
  assert.equal(c.txt("CPF/CNPJ"), "");
  assert.equal(c.txt("CRECI"), "");
  assert.equal(r.guardado, true, "o arquivo fica guardado mesmo sem nada para preencher");
  /* CNPJ de imobiliária com dígito certo passa, formatado */
  const pj = montar({ leitura: Object.assign({}, LIDO, { tipo: "PJ", nome: "Exemplo Imoveis Ltda", cpf_cnpj: "11222333000181" }) });
  assert.equal(pj.subir().ok, true);
  assert.equal(pj.txt("CPF/CNPJ"), "11.222.333/0001-81");
});

test("sem cadastro: cria a linha com o nome lido em maiúsculas, APELIDO = o nome da venda, CRECI e CPF; arquivo na linha nova", () => {
  const c = montar({ linhas: [{ NOME: tit("OUTRO CORRETOR"), CRECI: rt("1"), "CPF/CNPJ": rt(""), APELIDO: rt("RAINER"), "CRECI - DOCUMENTO": { files: [] } }] });
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.linhaNova, true);
  const post = c.n.escritas.find((e) => e.metodo === "POST");
  assert.equal(post.props.NOME.title[0].text.content, "FULANO DE TAL");
  assert.equal(post.props.APELIDO.rich_text[0].text.content, "IVAN");
  assert.equal(post.props.CRECI.rich_text[0].text.content, "12.345-F");
  assert.equal(post.props["CPF/CNPJ"].rich_text[0].text.content, "529.982.247-25");
  assert.equal(c.n.bases["db-corr"].length, 2);
  const arq = c.corr(1)["CRECI - DOCUMENTO"].files;
  assert.equal(arq.length, 1, "o arquivo foi para a linha NOVA");
  assert.equal(r.guardado, true);
  assert.equal(c.corr(0)["CRECI - DOCUMENTO"].files.length, 0, "a outra linha não recebeu nada");
  assert.ok(r.preenchidos.includes("APELIDO"));
  /* e a venda passa a achar o corretor pelo apelido */
  assert.equal(c.acao("contratoEstado").comissaoCorretor.corretor, "FULANO DE TAL");
});

test("sem cadastro pelo apelido mas o nome lido é o título de uma linha existente: usa ela e acrescenta o apelido (sem título repetido)", () => {
  const c = montar({ linha: Object.assign({}, LINHA, { APELIDO: rt("") }) });
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.linhaNova, false);
  assert.equal(c.n.bases["db-corr"].length, 1);
  assert.equal(c.txt("APELIDO"), "IVAN");
  assert.deepEqual(r.preenchidos, ["CRECI", "CPF/CNPJ", "APELIDO"]);
  /* já tendo outros apelidos, o novo entra depois deles */
  const c2 = montar({ linha: Object.assign({}, LINHA, { APELIDO: rt("IVAN NETO") }) });
  c2.subir();
  assert.equal(c2.txt("APELIDO"), "IVAN NETO; IVAN");
});

test("o arquivo é ACRESCENTADO na coluna CRECI - DOCUMENTO: anexos antigos ficam", () => {
  const antigo = { name: "antigo.pdf", type: "file", file: { url: "https://s3.falso/antigo" } };
  const c = montar({ linha: Object.assign({}, LINHA, { "CRECI - DOCUMENTO": { files: [antigo] } }) });
  assert.equal(c.subir().ok, true);
  const arqs = c.corr()["CRECI - DOCUMENTO"].files;
  assert.equal(arqs.length, 2);
  assert.equal(arqs[0].name, "antigo.pdf");
  assert.match(arqs[1].name, /^CRECI\.jpg$/);
  const up = Object.values(c.n.uploads).find((u) => u.nome === "CRECI.jpg");
  assert.equal(up.buf.toString("base64"), JPG, "os bytes subiram inteiros");
  /* PDF */
  const p = montar();
  assert.equal(p.subir({ mime: "application/pdf" }).ok, true);
  assert.equal(p.corr()["CRECI - DOCUMENTO"].files[0].name, "CRECI.pdf");
});

test("base sem a coluna CRECI - DOCUMENTO: lê e preenche, avisa que falta a coluna e não quebra", () => {
  const { "CRECI - DOCUMENTO": _, ...semArquivos } = LINHA;
  const c = montar({ linha: semArquivos });
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.preenchidos, ["CRECI", "CPF/CNPJ"]);
  assert.equal(r.guardado, false);
  assert.equal(r.aviso, "falta a coluna CRECI - DOCUMENTO");
  assert.equal(c.txt("CRECI"), "12.345-F");
  assert.equal(Object.keys(c.n.uploads).length, 0);
});

test("base sem a coluna CRECI: a coluna entra em colunasFaltando, o resto segue", () => {
  const { CRECI: _, ...semCreci } = LINHA;
  const c = montar({ linha: semCreci });
  const r = c.subir();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.colunasFaltando, ["CRECI"]);
  assert.deepEqual(r.preenchidos, ["CPF/CNPJ"]);
});

test("guardas: sem arquivo, tipo errado, grande demais, TESTES, outro documento, ilegível, duplicado, sem chave da IA, sem corretor", () => {
  const c = montar();
  assert.equal(c.subir({ arquivo: "" }).erro, "SEM_ARQUIVO");
  assert.equal(c.subir({ mime: "text/plain" }).erro, "TIPO_DE_ARQUIVO_NAO_SUPORTADO");
  assert.equal(c.subir({ arquivo: Buffer.alloc(5 * 1024 * 1024 + 10).toString("base64") }).erro, "ARQUIVO_GRANDE");
  assert.deepEqual(c.subir({}, tokenDe("TESTES")), { ok: false, erro: "SEM_PERMISSAO_TESTES" });
  assert.equal(c.conta.n, 0, "nenhuma chamada à IA nas recusas");
  /* também aceita o arquivo como objeto { nome, mime, base64 }, como o lerCrlv */
  assert.equal(c.subir({ arquivo: { nome: "c.png", mime: "image/png", base64: JPG } }).ok, true);
  assert.equal(montar({ leitura: Object.assign({}, LIDO, { tipo_documento: "OUTRO" }) }).subir().erro, "NAO_E_CRECI");
  assert.equal(montar({ leitura: { tipo_documento: "CRECI", nome: "", creci: "", cpf_cnpj: "" } }).subir().erro, "CRECI_ILEGIVEL");
  const dup = montar({ linhas: [LINHA, Object.assign({}, LINHA, { NOME: tit("BELTRANO DE TAL") })] });
  const rd = dup.subir();
  assert.equal(rd.erro, "FALTAM_DADOS");
  assert.equal(dup.conta.n, 0, "duplicado recusa ANTES de gastar a IA");
  assert.equal(montar({ props: {} }).subir().erro, "CHAVE_IA_FALTANDO");
  assert.equal(montar({ venda: { CORRETOR: sel(null) } }).subir().erro, "CORRETOR_NA_VENDA_FALTANDO");
  assert.equal(montar().subir({ pageId: "zz" }).erro, "PAGINA_INVALIDA");
});

test("histórico do contrato: diz que subiu o CRECI e quais colunas, sem nome, número ou CPF", () => {
  const c = montar({ linha: Object.assign({}, LINHA, { CRECI: rt("CRECI 99.999-F") }) });
  const r = c.subir();
  const l = LogContratoVenda.linha("lerCreciCorretor", pedido(), r, "ana.teste", "27/11/2026 10:00");
  assert.equal(l, "27/11/2026 10:00 — ana.teste — subiu o CRECI do corretor: preencheu CPF/CNPJ (diverge: CRECI)");
  assert.doesNotMatch(l, /99\.999|12\.345|529\.982/);
  assert.equal(LogContratoVenda.linha("lerCreciCorretor", pedido(), { ok: false, erro: "NAO_E_CRECI" }, "ana.teste", "x"), "");
});

/* ---- regras puras (ContratoVenda) ---- */
test("creciDaLeitura: confere CPF/CNPJ pelo dígito, limpa o prefixo do CRECI, descarta o que não passa e não vaza valor", () => {
  const ok = CV.creciDaLeitura(LIDO);
  assert.deepEqual([ok.ok, ok.tipo, ok.nome, ok.creci, ok.cpfCnpj, ok.uf], [true, "PF", "FULANO DE TAL", "12.345-F", "529.982.247-25", "GO"]);
  const ruim = CV.creciDaLeitura({ tipo_documento: "CRECI", nome: "Fulano de Tal", creci: "12345-F", cpf_cnpj: "111.111.111-11", uf: "XX" });
  assert.deepEqual(ruim.descartados, ["CPF/CNPJ", "UF"]);
  assert.equal(ruim.cpfCnpj, ""); assert.equal(ruim.creci, "12345-F");
  assert.equal(CV.creciDaLeitura({ tipo_documento: "CRECI", creci: "sem número" }).erro, "CRECI_ILEGIVEL");
  assert.equal(CV.creciDaLeitura({ tipo_documento: "OUTRO", nome: "X Y Z" }).erro, "NAO_E_CRECI");
  assert.equal(CV.creciDaLeitura({ tipo_documento: "CRECI", nome: "{{X}} Fulano", creci: "1" }).nome, "X FULANO", "chaves do modelo caem");
});
test("planoCreci: vazio preenche, igual (pontuação à parte) não faz nada, diferente é divergência", () => {
  const lido = { creci: "12.345-F", cpfCnpj: "529.982.247-25" };
  assert.deepEqual(CV.planoCreci(lido, {}), { preencher: { CRECI: "12.345-F", "CPF/CNPJ": "529.982.247-25" }, divergencias: [] });
  assert.deepEqual(CV.planoCreci(lido, { CRECI: "12345f", "CPF/CNPJ": "52998224725" }), { preencher: {}, divergencias: [] });
  assert.deepEqual(CV.planoCreci(lido, { CRECI: "1", "CPF/CNPJ": "" }),
    { preencher: { "CPF/CNPJ": "529.982.247-25" }, divergencias: [{ coluna: "CRECI", cadastro: "1", lido: "12.345-F" }] });
  assert.deepEqual(CV.planoCreci({ creci: "", cpfCnpj: "" }, { CRECI: "1" }), { preencher: {}, divergencias: [] });
});
