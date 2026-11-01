/* 31/10/2026 — decisão do dono: comprador (proponente) casado ou em união estável → o cônjuge também assina, no termo
 * de pré-reserva e no contrato, mesmo sem compor renda. Colunas da proposta: ESTADO CIVIL, CONJUGE, CPF CONJUGE,
 * EMAIL CONJUGE e REGIME. 01/11: a qualificação do cônjuge também entra no texto (COMPRADORES_QUADRO).
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const C = req("../ContratoVenda.js");
const CS = req("../ClicksignVenda.js");

const FLUXO = {
  assinatura: "2026-10-30", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 300000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-30",
  pre1N: 20, pre1Valor: 1000, pre1Data: "2026-11-10", credito: 270000, fgts: 0, subsidio: 0, prazoEntrada: 24,
};
const CONJ = { estadoCivil: "CASADO", nome: "CONJUGE TESTE DA SILVA", cpf: "52998224725", email: "Conjuge@Teste.Example" };

function dados(conjugeComprador, c2 = { nome: "" }) {
  return C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADOR TESTE", CPF: "935.411.347-80", COMPRADOR1: { email: "comprador@teste.example" }, COMPRADOR2: c2,
             VALOR_CONTRATO: 300000 },
    obra: {}, vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA" }, loteamento: {}, corretor: {},
    condominio: { nome: "CONDOMÍNIO RESERVA TESTE", unidade: "4", fluxo: FLUXO, fiadores: [], conjugeComprador },
    hojeISO: "2026-10-31",
  });
}
const conjuges = (d) => CS.signatarios(d, CS.montarConfig({})).filter((s) => /Cônjuge do comprador/.test(s.papel));

test("casado: o cônjuge do comprador assina (CPF formatado, e-mail minúsculo) e, como o comprador 1, rubrica (dono, 01/11)", () => {
  const d = dados(CONJ);
  assert.deepEqual(d.condominio.conjugeComprador, { nome: "CONJUGE TESTE DA SILVA", cpf: "529.982.247-25", email: "conjuge@teste.example", regime: "" });
  const l = conjuges(d);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].papel, l[0].role, l[0].email, l[0].origem, !!l[0].rubrica], ["Cônjuge do comprador 1", "buyer", "conjuge@teste.example", "conjugeComprador1", true]);
  const todos = CS.signatarios(d, CS.montarConfig({})).map((s) => s.papel);
  assert.equal(todos.indexOf("Cônjuge do comprador 1"), todos.indexOf("Comprador 1") + 1, "logo depois do comprador");
});

test("união estável também; solteiro, divorciado ou sem estado civil não leva ninguém", () => {
  assert.equal(conjuges(dados({ ...CONJ, estadoCivil: "UNIÃO ESTÁVEL" })).length, 1);
  for (const e of ["SOLTEIRO", "DIVORCIADO", ""]) {
    const d = dados({ ...CONJ, estadoCivil: e });
    assert.equal(d.condominio.conjugeComprador, undefined, e);
    assert.equal(conjuges(d).length, 0, e);
  }
  assert.equal(dados(undefined).condominio.conjugeComprador, undefined, "sem as colunas o carimbo não muda");
});

test("casado sem o nome do cônjuge: não inventa signatário; sem e-mail vira falta apontando a coluna", () => {
  assert.equal(conjuges(dados({ ...CONJ, nome: "" })).length, 0);
  const f = CS.faltasAssinatura(dados({ ...CONJ, email: "" }), CS.montarConfig({}));
  assert.ok(f.some((x) => /Cônjuge do comprador 1: e-mail \(coluna EMAIL CONJUGE\)/.test(x)), f.join(" | "));
});

test("cônjuge que já é o comprador 2 não assina duas vezes", () => {
  const d = dados(CONJ, { nome: "CONJUGE TESTE DA SILVA", cpf: "529.982.247-25", email: "conjuge@teste.example" });
  assert.equal(conjuges(d).length, 0);
});

/* 01/11/2026 (dono): quem decide se o cônjuge entra no TERMO é AssinaturaVenda.assEnviarTermo_ (opção PR_CONJUGE_<pageId>, testes
   em tela-venda-condominio.test.mjs); aqui, com o conjugeComprador presente, a lista de signatários o traz. */
test("com conjugeComprador presente (termo com a opção ligada): o cônjuge assina junto com o pré-reservante", () => {
  const d = dados(CONJ);
  d.comprador2 = null; d.corretor = null;
  const papeis = CS.signatarios(d, CS.montarConfig({})).map((s) => s.papel);
  assert.ok(papeis.includes("Comprador 1") && papeis.includes("Cônjuge do comprador 1"), papeis.join(", "));
});

/* 01/11/2026 — cônjuge do comprador qualificado no contrato (dentro do COMPRADORES_QUADRO, sem marcador novo) */
const CASADO = { ...CONJ, regime: "COMUNHÃO PARCIAL DE BENS" };
const faltas = (d) => C.faltasContrato(d);

test("casado: o quadro traz o cônjuge qualificado (regime em minúsculas) e a assinatura traz o nome e o CPF dele", () => {
  const d = dados({ ...CASADO, nome: "CONJUGE TESTE" });
  assert.equal(d.condominio.conjugeComprador.regime, "comunhão parcial de bens");
  const m = C.marcadores(d);
  assert.match(m.COMPRADORES_QUADRO, /casado\(a\) sob o regime de comunhão parcial de bens com CONJUGE TESTE, CPF nº 529\.982\.247-25/);
  assert.match(m.ASSINATURA_COMPRADORES_NOMES, /COMPRADOR TESTE \/ CONJUGE TESTE/);
  assert.match(m.ASSINATURA_COMPRADORES_CPFS, /935\.411\.347-80 \/ 529\.982\.247-25/);
  assert.ok(!faltas(d).some((x) => /Cônjuge do comprador/.test(x)), faltas(d).join(" | "));
});

test("casado sem o nome do cônjuge: falta 'nome'; sem regime: falta 'regime de bens'", () => {
  assert.ok(faltas(dados({ ...CASADO, nome: "" })).includes("Cônjuge do comprador 1: nome"));
  assert.ok(faltas(dados({ ...CONJ })).includes("Cônjuge do comprador 1: regime de bens"));
});

test("união estável: 'convivente em união estável com …', sem regime obrigatório", () => {
  const d = dados({ ...CONJ, estadoCivil: "UNIÃO ESTÁVEL" });
  assert.match(C.marcadores(d).COMPRADORES_QUADRO, /convivente em união estável com CONJUGE TESTE DA SILVA, CPF nº 529\.982\.247-25/);
  assert.ok(!faltas(d).some((x) => /regime/.test(x)));
});

test("solteiro: o quadro e a assinatura ficam como sempre; cônjuge que é o comprador 2 não se repete", () => {
  const s = C.marcadores(dados({ ...CONJ, estadoCivil: "SOLTEIRO" }));
  assert.ok(!/casado|convivente/i.test(s.COMPRADORES_QUADRO));
  assert.equal(s.ASSINATURA_COMPRADORES_NOMES, "COMPRADOR TESTE");
  const d = dados(CASADO, { nome: "CONJUGE TESTE DA SILVA", cpf: "529.982.247-25", email: "conjuge@teste.example" });
  const m = C.marcadores(d);
  assert.equal(m.ASSINATURA_COMPRADORES_NOMES, "COMPRADOR TESTE / CONJUGE TESTE DA SILVA");
  assert.ok(!/casado\(a\)/.test(m.COMPRADORES_QUADRO));
  assert.ok(!faltas(d).some((x) => /Cônjuge do comprador/.test(x)));
});

/* fix round 1 (01/11) */
test("casado sem nome do cônjuge: o comprador 2 só desculpa se for casado/união estável", () => {
  const f = (ec) => faltas(dados({ ...CONJ, nome: "" }, { nome: "COMPRADOR DOIS TESTE", cpf: "222.333.444-05", estadoCivil: ec }));
  assert.ok(f("SOLTEIRO").includes("Cônjuge do comprador 1: nome"));
  assert.ok(!f("CASADO").includes("Cônjuge do comprador 1: nome"));
  assert.ok(!f("União Estável").includes("Cônjuge do comprador 1: nome"));
});

/* 01/11/2026 (dono): "cônjuge (geralmente vai como comprador 2) tem que assinar tudo que o comprador 1 assina" */
test("memorial: o cônjuge assina como o comprador 1 — nome e CPF dele no bloco do memorial, entre os compradores", () => {
  const m = C.marcadores(dados(CASADO));
  assert.match(m.MEMORIAL_ASSINATURA_NOMES, /^COMPRADOR TESTE \/ CONJUGE TESTE/);
  assert.match(m.MEMORIAL_ASSINATURA_CPFS, /^935\.411\.347-80 \/ 529\.982\.247-25/);
  assert.equal(m.MEMORIAL_ASSINATURA_NOMES, m.ASSINATURA_COMPRADORES_NOMES);
  const m2 = C.marcadores(dados(CASADO, { nome: "COMPRADOR DOIS TESTE", cpf: "222.333.444-05" }));
  assert.match(m2.MEMORIAL_ASSINATURA_NOMES, / \/ COMPRADOR DOIS TESTE$/);
});
