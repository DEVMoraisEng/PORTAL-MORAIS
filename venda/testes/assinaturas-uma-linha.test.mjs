/* 01/11/2026 (plano 23 B, dono: "essas alterações estéticas pode fazer"): blocos de assinatura com UMA linha por pessoa,
 * gerados no código pelos marcadores {{ASSINATURAS_QUADRO}}, {{ASSINATURAS_FINAL}} (contrato) e {{ASSINATURAS_TERMO}}
 * (termos de confissão PRÉ/PÓS e termo de pré-reserva). Quem aparece = quem assina aquele documento (as mesmas listas do
 * envio da Clicksign). Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const C = req("../ContratoVenda.js");
const CS = req("../ClicksignVenda.js");
const R = req("../RubricasVenda.js");

const FLUXO = {
  assinatura: "2026-10-31", diaPagamento: 20, entrega: "2028-11-30", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-29",
  pre1N: 12, pre1Valor: 729.8, pre1Data: "2026-11-20", pre2N: 12, pre2Valor: 280.04, pre2Data: "2027-11-20",
  balao1Valor: 8486.06, balao1Data: "2027-12-20", balao2Valor: 5940.34, balao2Data: "2028-11-20",
  credito: 244800, fgts: 6600, subsidio: 0, posN: 24, posValor: 668.98, posData: "2028-12-20", prazoEntrada: 36,
};
const T1 = { nome: "Testemunha Um Spe", email: "t1@teste.example", cpf: "52998224725" };
const T2 = { nome: "Testemunha Dois Spe", email: "t2@teste.example", cpf: "" };
const CONFIG = CS.montarConfig({ ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify([T1, T2]) });

function dados({ conjuge = true, c2 = true, fiadores = true, conjugeFiador = true, semComissao = false } = {}) {
  const d = C.montarDadosContrato({
    venda: { CLIENTES: "COMPRADORA UM TESTE", CPF: "935.411.347-80", COMPRADOR1: { email: "c1@teste.example" },
             COMPRADOR2: c2 ? { nome: "COMPRADOR DOIS TESTE", cpf: "111.444.777-35", email: "c2@teste.example" } : { nome: "" },
             VALOR_CONTRATO: 305000, COMISSAO: 14487.5, CORRETOR: "Corretor Teste" },
    obra: {}, vendedor: { tipo: "PJ", nome: "SPE TESTE LTDA", cpfCnpj: "00.000.000/0001-91", representanteNome: "REPRESENTANTE TESTE",
                         representanteCpf: "246.813.579-28", representanteEmail: "rep@teste.example" },
    loteamento: {}, corretor: { nome: "Corretor Teste", creci: "40167", cpfCnpj: "00.000.000/0002-72", email: "corretor@teste.example" },
    condominio: { nome: "CONDOMÍNIO RESERVA TESTE", unidade: "17", comissao: 14487.5, fluxo: FLUXO,
                  fiadores: fiadores ? [{ nome: "FIADOR UM TESTE", cpf: "529.982.247-25", email: "f1@teste.example" },
                                        { nome: "FIADOR DOIS TESTE", cpf: "935.411.347-80", email: "f2@teste.example" }] : [],
                  conjugeComprador: conjuge ? { estadoCivil: "CASADA", nome: "CONJUGE UM TESTE", cpf: "52998224725", email: "cj@teste.example" } : undefined },
    hojeISO: "2026-10-31",
  });
  /* venda direta: a isenção vem da lista livre (FLUXO PERSONALIZADO); aqui só a marca que importa ao bloco */
  if (semComissao) d.condominio.livre = { semComissao: true };
  /* o cônjuge do fiador vem do ContratoVenda (quando o fiador é casado com alguém de fora); aqui posto à mão */
  if (fiadores && conjugeFiador) d.condominio.fiadores[0].conjuge = { nome: "CONJUGE FIADOR TESTE", cpf: "111.444.777-35", email: "cf@teste.example" };
  return d;
}
const TRACO = "________________________________";
const bloco = (...pessoas) => pessoas.map((p) => [TRACO, ...p]).reduce((a, p, i) => a.concat(i ? [""] : [], p), []);

test("contrato: uma linha por pessoa — vendedora, comprador 1, cônjuge, comprador 2, corretor, testemunhas (fiador não assina o contrato)", () => {
  const linhas = CS.blocoAssinaturas(dados(), CONFIG, "CONTRATO").split("\n");
  assert.deepEqual(linhas, bloco(
    ["Nome: SPE TESTE LTDA", "CNPJ: 00.000.000/0001-91", "Representante: REPRESENTANTE TESTE – CPF: 246.813.579-28", "VENDEDORA"],
    ["Nome: COMPRADORA UM TESTE", "CPF: 935.411.347-80", "COMPRADOR"],
    ["Nome: CONJUGE UM TESTE", "CPF: 529.982.247-25", "CÔNJUGE DO COMPRADOR"],
    ["Nome: COMPRADOR DOIS TESTE", "CPF: 111.444.777-35", "COMPRADOR"],
    ["Nome: Corretor Teste", "CNPJ: 00.000.000/0002-72", "INTERMEDIADOR/CORRETOR"],
    ["Nome: Testemunha Um Spe", "CPF: 529.982.247-25", "TESTEMUNHA 1"],
    ["Nome: Testemunha Dois Spe", "CPF:", "TESTEMUNHA 2"]));
});

test("contrato: venda direta (sem comissão) sai sem o corretor; testemunhas escolhidas para a venda valem; sem par configurado, Nome:/CPF: em branco", () => {
  const sem = CS.blocoAssinaturas(dados({ semComissao: true, conjuge: false, c2: false }), CONFIG, "CONTRATO");
  assert.ok(!/CORRETOR/.test(sem), sem);
  const esc = CS.montarConfig({ ASSINATURA_TESTEMUNHAS_SPE: JSON.stringify([T1, T2]),
    ASSINATURA_TESTEMUNHAS_OPCOES: JSON.stringify([{ nome: "Outra Pessoa Teste", email: "o@teste.example", cpf: "935.411.347-80" }]),
    TESTEMUNHAS_ESCOLHIDAS: JSON.stringify(["OUTRA PESSOA TESTE", "TESTEMUNHA UM SPE"]) });
  const l = CS.blocoAssinaturas(dados({ conjuge: false, c2: false }), esc, "CONTRATO").split("\n");
  assert.equal(l[l.indexOf("TESTEMUNHA 1") - 2], "Nome: Outra Pessoa Teste");
  assert.equal(l[l.indexOf("TESTEMUNHA 2") - 2], "Nome: Testemunha Um Spe");
  const vazio = CS.blocoAssinaturas(dados({ conjuge: false, c2: false }), CS.montarConfig({}), "CONTRATO").split("\n");
  assert.deepEqual(vazio.slice(-9), [TRACO, "Nome:", "CPF:", "TESTEMUNHA 1", "", TRACO, "Nome:", "CPF:", "TESTEMUNHA 2"]);
});

test("termo de confissão: credora, devedor(es), cônjuge, fiadores e cônjuge do fiador, testemunhas — sem corretor", () => {
  const linhas = CS.blocoAssinaturas(dados(), CONFIG, "TERMO").split("\n");
  const papeis = linhas.filter((x, i) => linhas[i + 1] === "" || i === linhas.length - 1);
  assert.deepEqual(papeis, ["CREDORA/VENDEDORA", "DEVEDOR/COMPRADOR", "CÔNJUGE DO COMPRADOR", "DEVEDOR/COMPRADOR", "FIADOR 1",
    "CÔNJUGE DO FIADOR 1", "FIADOR 2", "TESTEMUNHA 1", "TESTEMUNHA 2"]);
  assert.ok(linhas.includes("Nome: CONJUGE FIADOR TESTE") && linhas.includes("Nome: FIADOR DOIS TESTE"));
  assert.ok(!/CORRETOR/.test(linhas.join("\n")));
});

test("pré-reserva: vendedora, pré-reservante e testemunhas; o cônjuge só com a opção ligada; comprador 2 e corretor nunca", () => {
  const papeis = (opc) => CS.blocoAssinaturas(dados(), CONFIG, "PRE_RESERVA", opc).split("\n")
    .filter((x) => /^[A-ZÀ-Ü\/ 12-]+$/.test(x) && !/^_+$/.test(x));
  assert.deepEqual(papeis(), ["VENDEDORA", "PRÉ-RESERVANTE", "TESTEMUNHA 1", "TESTEMUNHA 2"]);
  assert.deepEqual(papeis({ incluirConjuge: true }), ["VENDEDORA", "PRÉ-RESERVANTE", "CÔNJUGE DO PRÉ-RESERVANTE", "TESTEMUNHA 1", "TESTEMUNHA 2"]);
});

test("casa de rua: rótulo VENDEDOR (o texto do modelo) e vendedor pessoa física com CPF", () => {
  const d = dados({ conjuge: false, c2: false, fiadores: false });
  delete d.condominio;
  d.vendedor = { tipo: "PF", nome: "VENDEDOR PF TESTE", cpfCnpj: "529.982.247-25", email: "v@teste.example" };
  const l = CS.blocoAssinaturas(d, CONFIG, "CONTRATO").split("\n");
  assert.deepEqual(l.slice(0, 4), [TRACO, "Nome: VENDEDOR PF TESTE", "CPF: 529.982.247-25", "VENDEDOR"]);
});

test("os três marcadores viram parágrafos e o rótulo de cada pessoa sai em negrito", () => {
  for (const m of ["ASSINATURAS_QUADRO", "ASSINATURAS_FINAL", "ASSINATURAS_TERMO"]) assert.ok(C.MARCADORES_PARAGRAFOS.includes(m), m);
  for (const r of ["VENDEDORA", "VENDEDOR", "COMPRADOR", "CÔNJUGE DO COMPRADOR", "CREDORA/VENDEDORA", "DEVEDOR/COMPRADOR", "FIADOR 2",
                   "CÔNJUGE DO FIADOR 1", "INTERMEDIADOR/CORRETOR", "TESTEMUNHA 1", "PRÉ-RESERVANTE", "CÔNJUGE DO PRÉ-RESERVANTE"])
    assert.equal(C.negritoDaLinha(r), r.length, r);
  for (const x of ["Nome: COMPRADOR", "CPF: 1", TRACO, "COMPRADORA"]) assert.equal(C.negritoDaLinha(x), 0, x);
});

/* ---- compatível com RubricasVenda.acharLinhas + ClicksignVenda.atribuirLinhas: cada pessoa acha a própria linha ---- */
const W = 595, H = 842;
const it = (str, x, y, w = str.length * 5, h = 11) => ({ str, x, y, w, h });
/* as linhas do bloco, uma por linha do PDF (centralizadas), a partir de y0; quebra de página em `quebra` linhas */
function paginas(linhas, { titulo = null, quebra = 999, primeira = 18 } = {}) {
  const pgs = [], pg = (n) => ({ numero: n, largura: W, altura: H, itens: [] });
  let atual = pg(primeira), y = 60, n = 0;
  if (titulo) { atual.itens.push(it(titulo, 250, y)); y += 30; }
  for (const l of linhas) {
    if (n++ === quebra) { pgs.push(atual); atual = pg(atual.numero + 1); y = 60; }
    if (l) atual.itens.push(it(l, 297 - (l.length * 5) / 2, y, l.length * 5));
    y += 15;
  }
  pgs.push(atual);
  return pgs;
}
function cadaUmNaSua(lista, linhas, tipo, quem) {
  const r = CS.atribuirLinhas(lista, linhas, tipo);
  lista.forEach((s, i) => assert.equal(r[i].length, quem(s) ? 1 : 0, s.papel + " → " + r[i].length + " linha(s)"));
}

test("acharLinhas + atribuirLinhas: no contrato (quadro e final) e no termo, cada signatário fica com a própria linha", () => {
  const d = dados(), cfg = Object.assign({}, CONFIG, { incluirCorretor: true, comFiadores: true });
  const lista = CS.signatarios(d, cfg);
  const ct = CS.blocoAssinaturas(d, cfg, "CONTRATO").split("\n");
  const fim = R.acharLinhas(paginas(ct, { titulo: "ASSINATURAS" }));
  assert.equal(fim.length, 7);
  cadaUmNaSua(lista, fim, "contrato", (s) => !s.soTermos);
  const termo = R.acharLinhas(paginas(CS.blocoAssinaturas(d, cfg, "TERMO").split("\n"), { titulo: "ASSINATURAS" }));
  cadaUmNaSua(lista, termo, "termo", (s) => s.origem !== "corretor");
});

test("quadro-resumo que vira a página: a continuação (só rótulos de assinatura) também é lida", () => {
  const d = dados(), cfg = Object.assign({}, CONFIG, { incluirCorretor: true });
  const ct = CS.blocoAssinaturas(d, cfg, "CONTRATO").split("\n");
  /* sem título ASSINATURAS: vale pela VENDEDORA e COMPRADOR da 1ª página; a 2ª só tem corretor e testemunhas */
  const l = R.acharLinhas(paginas(ct, { quebra: 20 }));
  assert.deepEqual(l.map((x) => x.page), ["18", "18", "18", "18", "19", "19", "19"]);
  cadaUmNaSua(CS.signatarios(d, cfg), l, "contrato", (s) => !s.soTermos);
  /* página solta depois de uma página que não é de assinatura continua de fora */
  const solta = [{ numero: 4, largura: W, altura: H, itens: [it("texto", 57, 60)] },
                 { numero: 5, largura: W, altura: H, itens: [it(TRACO, 57, 60, 160), it("TESTEMUNHA 1", 57, 75)] }];
  assert.deepEqual(R.acharLinhas(solta), []);
});
