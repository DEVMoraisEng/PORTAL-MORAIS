/* 27/11/2026: coluna APELIDO em CORRETORES – CONTRATO. Na VENDAS o CORRETOR e a IMOBILIÁRIA são apelidos curtos
 * ("IVAN", "IVAN IMÓVEIS"); o título da linha do cadastro é o nome completo / razão social que vai no contrato.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { CV, tokenDe, PAGE, cenario, tit, sel, rt, MODELO_OBRA, CORRETOR, mescla, colunasVenda } from "./contrato-cenario.mjs";

const MODELO_CORRETOR = [...MODELO_OBRA, "c) Corretor: {{CORRETOR_NOME}}, CRECI nº {{CORRETOR_CRECI}}, CPF nº {{CORRETOR_DOC}}"];
const drive = { modelos: { "modelo-obra": MODELO_CORRETOR, "modelo-pronto": ["MODELO PRONTO", ...MODELO_CORRETOR] } };
const textoPre = (c) => { const ult = c.d.estado.copias.at(-1); return c.d.estado.salvos[ult.id].pars.join("\n"); };
const linhaCorretor = (c) => textoPre(c).split("\n").find((l) => /^c\) Corretor:/.test(l));
const estado = (c) => c.acao("contratoEstado").comissaoCorretor;

const FULANO = { NOME: tit("FULANO DE TAL"), CRECI: rt("CRECI 12.345-F"), "CPF/CNPJ": rt("111.444.777-35"),
  "E-MAIL": { email: "fulano@exemplo.com" }, APELIDO: rt("Ivan; IVAN NETO") };
const EXEMPLO = { NOME: tit("EXEMPLO IMOVEIS LTDA"), CRECI: rt("CRECI-J 77"), "CPF/CNPJ": rt("11.222.333/0001-81"),
  "E-MAIL": { email: "imob@exemplo.com" }, APELIDO: rt("IVAN IMÓVEIS, Exemplo") };
const venda = (extra = {}) => Object.assign({ CORRETOR: sel("IVAN") }, extra);

test("apelidos(): itens separados por vírgula ou ponto e vírgula, comparados pela chave (acento e caixa não importam)", () => {
  assert.deepEqual(CV.apelidos("Ivan; IVAN IMÓVEIS, ivan  imoveis ,, "), ["IVAN", "IVAN IMOVEIS", "IVAN IMOVEIS"]);
  assert.deepEqual(CV.apelidos(""), []);
  assert.deepEqual(CV.apelidos(null), []);
});

test("apelido acha o corretor: a venda diz IVAN, o contrato imprime o nome completo do cadastro", () => {
  const c = cenario({ drive, venda: venda(), corretor: FULANO });
  const e = estado(c);
  assert.equal(e.corretor, "FULANO DE TAL");
  assert.equal(e.temCadastro, true);
  assert.ok(!e.duplicado);
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(linhaCorretor(c), "c) Corretor: FULANO DE TAL, CRECI nº CRECI 12.345-F, CPF nº 111.444.777-35");
});

test("o item do apelido é comparado inteiro: \"IVAN\" não casa com a linha que só tem \"IVAN NETO\"", () => {
  const c = cenario({ drive, venda: venda(), corretor: Object.assign({}, FULANO, { APELIDO: rt("IVAN NETO") }) });
  const e = estado(c);
  assert.equal(e.temCadastro, false);
  assert.equal(e.corretor, "IVAN");
});

test("título exato ganha do apelido: outra linha com o mesmo nome em APELIDO não atrapalha", () => {
  const c = cenario({ drive, venda: { CORRETOR: sel("Corretor Teste") },
    duplicar: { "db-corr": { NOME: tit("FULANO DE TAL"), APELIDO: rt("Corretor Teste") } } });
  const e = estado(c);
  assert.ok(!e.duplicado, JSON.stringify(e));
  assert.equal(e.corretor, "Corretor Teste", "a linha do título igual, não a do apelido");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.match(linhaCorretor(c), /^c\) Corretor: Corretor Teste, CRECI nº CRECI 123,/);
});

test("apelido em duas linhas = cadastro duplicado, como título repetido", () => {
  const c = cenario({ drive, venda: venda(), corretor: FULANO,
    duplicar: { "db-corr": { NOME: tit("BELTRANO DE TAL") } } });   /* a cópia leva o mesmo APELIDO */
  assert.equal(estado(c).duplicado, true);
  const r = c.acao("gerarPreContrato");
  assert.equal(r.ok, false);
  assert.ok(JSON.stringify(r).includes("Corretor: cadastro duplicado"), JSON.stringify(r).slice(0, 300));
});

test("base SEM a coluna APELIDO: igual a antes (título igual acha; apelido solto não)", () => {
  const sem = cenario({ drive });                                    /* CORRETOR Teste, linha sem APELIDO */
  assert.equal(estado(sem).corretor, "Corretor Teste");
  assert.equal(estado(sem).temCadastro, true);
  const outro = cenario({ drive, venda: venda() });                  /* IVAN não é título de ninguém */
  assert.equal(estado(outro).temCadastro, false);
  assert.equal(estado(outro).corretor, "IVAN");
  /* APELIDO vazio também não casa nada */
  const vazio = cenario({ drive, venda: venda(), corretor: Object.assign({}, FULANO, { APELIDO: rt("") }) });
  assert.equal(estado(vazio).temCadastro, false);
});

/* ---- imobiliária pelo apelido ---- */
function cenarioImob(modo, linhas = [mescla(CORRETOR, {}), EXEMPLO]) {
  const colunas = Object.assign(colunasVenda(), { "IMOBILIÁRIA": { tipo: "select", opcoes: ["IVAN IMÓVEIS"] } });
  const c = cenario({ drive, colunas, venda: { CORRETOR: sel("Corretor Teste"), "IMOBILIÁRIA": sel("IVAN IMÓVEIS") }, bases: { "db-corr": linhas } });
  if (modo) {
    const r = c.g.chamar({ action: "escolherCorretorContrato", token: tokenDe(), pageId: PAGE, modo });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  return c;
}
test("imobiliária pelo apelido: \"IVAN IMÓVEIS\" acha a razão social (título não começa por esse nome)", () => {
  const c = cenarioImob("IMOBILIARIA");
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.equal(linhaCorretor(c), "c) Corretor: EXEMPLO IMOVEIS LTDA, CRECI nº CRECI-J 77, CNPJ nº 11.222.333/0001-81");
  assert.equal(estado(c).corretor, "EXEMPLO IMOVEIS LTDA");
});
test("imobiliária pelo apelido vale antes da regra \"único título que começa pelo nome\"", () => {
  const outra = { NOME: tit("IVAN IMÓVEIS E CONSTRUÇÕES SA"), CRECI: rt("1"), "CPF/CNPJ": rt("") };
  const c = cenarioImob("IMOBILIARIA", [mescla(CORRETOR, {}), EXEMPLO, outra]);
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.match(linhaCorretor(c), /^c\) Corretor: EXEMPLO IMOVEIS LTDA,/);
});
test("sem apelido a regra antiga continua: único título que começa pelo nome", () => {
  const semApelido = Object.assign({}, EXEMPLO, { NOME: tit("IVAN IMÓVEIS LTDA"), APELIDO: rt("") });
  const c = cenarioImob("IMOBILIARIA", [mescla(CORRETOR, {}), semApelido]);
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.match(linhaCorretor(c), /^c\) Corretor: IVAN IMÓVEIS LTDA,/);
});
test("imobiliária + corretor, os dois por apelido: a pessoa também acha a linha dela", () => {
  const c = cenarioImob("AMBOS", [mescla(CORRETOR, { NOME: tit("FULANO DE TAL"), APELIDO: rt("Corretor Teste") }), EXEMPLO]);
  assert.equal(c.acao("gerarPreContrato").ok, true);
  assert.match(linhaCorretor(c), /^c\) Corretor: EXEMPLO IMOVEIS LTDA,.*representada por seu corretor FULANO DE TAL, CRECI nº CRECI 123, CPF nº 000\.000\.003-53$/);
});
