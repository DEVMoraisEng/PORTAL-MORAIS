/* 07/11/2026 — dono: "o comprador 2 é casado? se for, os dados do cônjuge também". No condomínio o 2º comprador é o
 * bloco "… COMPRADOR 1" da linha (ESTADO CIVIL COMPRADOR 1, CONJUGE DO COMPRADOR 1, CPF CONJUGE DO COMPRADOR 1,
 * REGIME DE BENS COMPRADOR 1, EMAIL CONJUGE DO COMPRADOR 1). Antes o estado civil dele não ia para o contrato e o
 * cônjuge dele não era lido por nada. Regra do dono (01/11): o cônjuge assina tudo que o comprador assina.
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
globalThis.RegrasVenda = req("../RegrasVenda.js");
globalThis.FluxoLivre = req("../FluxoLivre.js");
const C = req("../ContratoVenda.js");
const CS = req("../ClicksignVenda.js");
const CV = req("../CondominioVenda.js");

const FLUXO = {
  assinatura: "2026-10-30", diaPagamento: 10, entrega: "2028-12-01", valorVenda: 300000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-30",
  pre1N: 20, pre1Valor: 1000, pre1Data: "2026-11-10", credito: 270000, fgts: 0, subsidio: 0, prazoEntrada: 24,
};
const C2 = { nome: "SEGUNDO TESTE SOUZA", cpf: "111.444.777-35", estadoCivil: "CASADO", nacionalidade: "BRASILEIRO",
             email: "segundo@teste.example", endereco: "RUA TESTE, 1" };
const CJ2 = { estadoCivil: "CASADO", nome: "CONJUGE SEGUNDO SOUZA", cpf: "52998224725", email: "Cj2@Teste.Example",
              regime: "COMUNHAO PARCIAL DE BENS" };

function dados(c2, conjugeComprador2, conjugeComprador) {
  return C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADOR TESTE E " + (c2 ? c2.nome : ""), CPF: "935.411.347-80",
             COMPRADOR1: { email: "comprador@teste.example", nacionalidade: "BRASILEIRO", endereco: "RUA TESTE, 1" },
             COMPRADOR2: c2 || { nome: "" }, VALOR_CONTRATO: 300000 },
    obra: {}, vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA" }, loteamento: {}, corretor: {},
    condominio: { nome: "CONDOMÍNIO RESERVA TESTE", unidade: "4", fluxo: FLUXO, fiadores: [], conjugeComprador, conjugeComprador2 },
    hojeISO: "2026-11-07",
  });
}
const papeis = (d) => CS.signatarios(d, CS.montarConfig({})).map((s) => s.papel);

test("estado civil do 2º comprador vem do ESTADO CIVIL COMPRADOR 1 do condomínio", () => {
  const props = {
    PROPONENTE: { type: "rich_text", rich_text: [{ plain_text: "COMPRADOR TESTE" }] },
    "COMPRADOR 1": { type: "rich_text", rich_text: [{ plain_text: "SEGUNDO TESTE SOUZA" }] },
    "ESTADO CIVIL COMPRADOR 1": { type: "rich_text", rich_text: [{ plain_text: "SOLTEIRO" }] },
    "ESTADO CIVIL": { type: "rich_text", rich_text: [{ plain_text: "CASADO" }] },
  };
  const m = CV.mapear(props, {});
  assert.equal(m["COMPRADOR 2 - ESTADO CIVIL"], "SOLTEIRO");
  assert.equal(m["COMPRADOR 1 - ESTADO CIVIL"], "CASADO");
});

test("sem 2º comprador o ESTADO CIVIL COMPRADOR 1 não vira comprador 2", () => {
  const props = {
    PROPONENTE: { type: "rich_text", rich_text: [{ plain_text: "COMPRADOR TESTE" }] },
    "ESTADO CIVIL COMPRADOR 1": { type: "rich_text", rich_text: [{ plain_text: "SOLTEIRO" }] },
  };
  assert.equal(CV.mapear(props, {})["COMPRADOR 2 - ESTADO CIVIL"], undefined);
});

test("2º comprador solteiro: sai 'SOLTEIRO' na qualificação e ninguém a mais assina", () => {
  const d = dados({ ...C2, estadoCivil: "SOLTEIRO" }, { ...CJ2, estadoCivil: "SOLTEIRO" });
  const q = C.marcadores(d).COMPRADORES_QUADRO;
  assert.match(q, /SEGUNDO TESTE SOUZA, BRASILEIRO, SOLTEIRO/);
  assert.equal(d.condominio.conjugeComprador2, undefined, "carimbo não muda");
  assert.deepEqual(papeis(d).filter((p) => /Cônjuge/.test(p)), []);
});

test("2º comprador casado: cônjuge qualificado no quadro e assina logo depois dele, com rubrica", () => {
  const d = dados(C2, CJ2);
  assert.deepEqual(d.condominio.conjugeComprador2,
    { nome: "CONJUGE SEGUNDO SOUZA", cpf: "529.982.247-25", email: "cj2@teste.example", regime: "comunhao parcial de bens" });
  const m = C.marcadores(d), q = m.COMPRADORES_QUADRO;
  assert.match(m.ASSINATURA_COMPRADORES_NOMES, /SEGUNDO TESTE SOUZA \/ CONJUGE SEGUNDO SOUZA$/);
  assert.match(q, /; e SEGUNDO TESTE SOUZA, BRASILEIRO, casado\(a\) sob o regime de comunhao parcial de bens com CONJUGE SEGUNDO SOUZA, CPF nº 529\.982\.247-25/);
  const l = CS.signatarios(d, CS.montarConfig({}));
  const i = l.findIndex((s) => s.papel === "Comprador 2");
  assert.deepEqual([l[i + 1].papel, l[i + 1].origem, l[i + 1].email, !!l[i + 1].rubrica],
    ["Cônjuge do comprador 2", "conjugeComprador2", "cj2@teste.example", true]);
  assert.deepEqual(C.faltasContrato(d).filter((f) => /Cônjuge/.test(f)), []);
});

test("2º comprador casado sem nome do cônjuge: falta no contrato", () => {
  const f = C.faltasContrato(dados(C2, { ...CJ2, nome: "", cpf: "" }));
  assert.ok(f.includes("Cônjuge do comprador 2: nome"), f.join(" | "));
});

test("2º comprador casado com o proponente: não pede cônjuge nem assina duas vezes", () => {
  const casal = { estadoCivil: "CASADO", nome: "SEGUNDO TESTE SOUZA", cpf: "111.444.777-35", email: "segundo@teste.example" };
  for (const cj2 of [{ estadoCivil: "CASADO", nome: "", cpf: "" }, { estadoCivil: "CASADO", nome: "COMPRADOR TESTE", cpf: "935.411.347-80" }]) {
    const d = dados(C2, cj2, casal);
    assert.deepEqual(C.faltasContrato(d).filter((f) => /Cônjuge/.test(f)), [], JSON.stringify(cj2));
    assert.deepEqual(papeis(d).filter((p) => /Cônjuge/.test(p)), [], JSON.stringify(cj2));
  }
});

test("cônjuge do 2º sem e-mail: o envio aponta a coluna; termo de reserva não leva ninguém do 2º", () => {
  const d = dados(C2, { ...CJ2, email: "" });
  const f = CS.faltasAssinatura(d, CS.montarConfig({}));
  assert.ok(f.some((x) => /Cônjuge do comprador 2: e-mail \(coluna EMAIL CONJUGE DO COMPRADOR 1\)/.test(x)), f.join(" | "));
  /* o termo de reserva zera o comprador2 (assEnviarTermo_): sem ele, o cônjuge do 2º também não entra */
  assert.deepEqual(papeis({ ...d, comprador2: null }).filter((p) => /comprador 2/i.test(p)), []);
});
