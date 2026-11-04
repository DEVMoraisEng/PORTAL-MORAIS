/* 04/11/2026 (dono): no mapa do Reserva a casa que está no banco de vendas fica RESERVADA até a ETAPA ficar
 * Concluída; só aí vira VENDIDA. Confere a regra (venda/contrato-vendida.js) contra a coluna ETAPA da Planilha Casas
 * Condomínio (condEtapas do vendas.html) e o que é gravado na base UNIDADES. Só dados inventados — o repositório é
 * público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const CV = createRequire(import.meta.url)("../contrato-vendida.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");
const sims = fs.readFileSync(path.join(RAIZ, "simulacoes.html"), "utf8");

/* tira do vendas.html as funções da coluna ETAPA, sem o resto da página */
function trecho(src, ini) {
  const i = src.indexOf(ini); assert.ok(i >= 0, "não achei " + ini);
  let p = src.indexOf("{", i), n = 0, j = p;
  for (; j < src.length; j++) { if (src[j] === "{") n++; else if (src[j] === "}" && --n === 0) break; }
  return src.slice(i, j + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  vendas.match(/const cdNormK=.*;/)[0],
  trecho(vendas, "function cdVal(l,nome)"), trecho(vendas, "function cdTemArq(v)"), trecho(vendas, "function cdSit(l,col)"),
  trecho(vendas, "function condUsaPreReserva(l)"), trecho(vendas, "function condEtapas(l)"),
  "this.etapaConcluida = l => condEtapas(l).atual < 0;"
].join("\n"), ctx);

const linha = (id, v) => ({ id, v: Object.assign({ "CONDOMÍNIO": "RESERVA DOS IPÊS", "UNIDADE": "15" }, v) });
const CASOS = [
  linha("a", {}),                                                                                    // só reservada
  linha("b", { "PRÉ-RESERVA - SITUAÇÃO": "ASSINADO", "STATUS INTERNO": "PAGOU PREFERÊNCIA" }),        // pagou preferência
  linha("c", { "CONTRATO GERADO": [{ name: "c.pdf" }] }),                                             // contrato gerado
  linha("d", { "ASSINATURA - SITUAÇÃO": "ENVIADO", "ASSINATURA - PROGRESSO": "2 de 5" }),            // assinando
  linha("e", { "ASSINATURA - SITUAÇÃO": "ASSINADO" }),                                                 // falta o Mais Controle
  linha("f", { "ASSINATURA - SITUAÇÃO": "RECUSADO" }),
  linha("g", { "ASSINATURA - SITUAÇÃO": "ASSINADO", "MC - VENDA ID": "12345" }),                       // Concluída
  linha("h", { "ASSINATURA - SITUAÇÃO": "assinado", "MC - VENDA ID": " 9 ", "PRÉ-RESERVA - SITUAÇÃO": "ENVIADO" })
];

test("a regra do mapa é a mesma da coluna ETAPA: vendida só com Concluída", () => {
  CASOS.forEach(l => assert.equal(CV.concluida(l), ctx.etapaConcluida(l), "linha " + l.id));
  assert.deepEqual(CASOS.map(CV.estadoMapa),
    ["reservada", "reservada", "reservada", "reservada", "reservada", "reservada", "vendida", "vendida"]);
});

test("unidade SIM com venda não concluída volta para RESERVADA (preferência continua no mapa interno)", () => {
  assert.deepEqual(CV.camposUnidade(CASOS[3], { vendidaCru: "SIM", statusInterno: "VENDIDA" }),
    { "VENDIDA": "RESERVADA", "STATUS INTERNO": "RESERVADA" });
  assert.deepEqual(CV.camposUnidade(CASOS[1], { vendidaCru: "SIM", statusInterno: "VENDIDA" }),
    { "VENDIDA": "RESERVADA", "STATUS INTERNO": "PAGOU PREFERÊNCIA" });
  assert.equal(CV.camposUnidade(CASOS[3], { vendidaCru: "RESERVADA", statusInterno: "RESERVADA" }), null);
  assert.equal(CV.camposUnidade(CASOS[0], { vendidaCru: "NAO", statusInterno: "DISPONÍVEL" }), null, "quem reserva é o botão Reservar");
});

test("etapa Concluída grava VENDIDA = SIM", () => {
  assert.deepEqual(CV.camposUnidade(CASOS[6], { vendidaCru: "RESERVADA", statusInterno: "RESERVADA" }),
    { "VENDIDA": "SIM", "STATUS INTERNO": "VENDIDA" });
  assert.equal(CV.camposUnidade(CASOS[6], { vendidaCru: "SIM", statusInterno: "VENDIDA" }), null);
});

test("distrato e outro condomínio ficam fora", () => {
  assert.equal(CV.elegivel(linha("x", { "STATUS INTERNO": "DISTRATO" })), false);
  assert.equal(CV.elegivel(linha("y", { "CONDOMÍNIO": "RESERVA DOS JACARANDÁS" })), false);
  assert.equal(CV.elegivel(linha("z", { "CONDOMÍNIO": "" })), true);
});

test("varredura: só chama o servidor para o que muda e não toca a proposta sem contrato enviado", async () => {
  const pedidos = [];
  const UN = [{ id: "u15", unidade: "15", vendidaCru: "SIM", statusInterno: "VENDIDA" },
              { id: "u16", unidade: "16", vendidaCru: "RESERVADA", statusInterno: "RESERVADA" },
              { id: "u17", unidade: "17", vendidaCru: "RESERVADA", statusInterno: "RESERVADA" }];
  const chamar = async (p) => {
    pedidos.push(p.action + (p.pageId ? ":" + p.pageId : ""));
    if (p.action === "simsUnidades") return { ok: true, unidades: UN };
    if (p.action === "simsPropostas") return { ok: true, propostas: [{ id: "p17", unidade: "17", status: "VENDIDA" }] };
    return { ok: true };
  };
  const L = [
    linha("v15", { "UNIDADE": "15", "CONTRATO GERADO": [{ name: "c.pdf" }] }),
    linha("v16", { "UNIDADE": "16" }),
    linha("v17", { "UNIDADE": "17", "ID PROPOSTA": "p17", "ASSINATURA - SITUAÇÃO": "ASSINADO", "MC - VENDA ID": "77" })
  ];
  await CV.rodar(L, "UNIDADE", null, { chamar });
  assert.deepEqual(pedidos, ["simsUnidades", "simsUnidadeUpdate:u15", "simsPropostas", "simsUnidadeUpdate:u17"]);
  assert.equal(UN[0].vendidaCru, "RESERVADA");
  assert.equal(UN[2].vendidaCru, "SIM");
});

test("as telas usam a regra nova", () => {
  assert.match(sims, /venda\/contrato-vendida\.js\?v=4/);
  assert.match(vendas, /venda\/contrato-vendida\.js\?v=4/);
  assert.match(sims, /ContratoVendida\.concluida\(l\)/, "Análise de vendas pinta vendida só com a etapa Concluída");
  assert.doesNotMatch(sims, /if\(ass==="ENVIADO" \|\| ass==="ASSINADO"\) estado="vendida"/);
});

test("o mapa não depende de abrir a Planilha Casas Condomínio", () => {
  assert.match(vendas, /setTimeout\(condVarrerSilencioso, 15000\)/, "Gestão de Vendas confere ao abrir");
  assert.match(vendas, /setInterval\(\(\)=>\{ if\(document\.visibilityState==="visible"\) condVarrerSilencioso\(\); \}, CD_VARRER_MS\)/);
  assert.match(sims, /Date\.now\(\)-PROP_VARREU_EM < 15\*60\*1000/, "Simulações confere de novo a cada 15 min");
});
