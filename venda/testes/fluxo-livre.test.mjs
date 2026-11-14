import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");

/* casa de 305 mil com o fluxo padrão do simulador (números inventados) */
const gavetas = {
  assinatura: "2026-10-30", entrega: "2028-12-30", valorVenda: 305000,
  sinalAto: 1000, sinal30: 3000, data30: "2026-11-30", sinal60: 3000, data60: "2026-12-30", sinal90: 3000, data90: "2027-01-30",
  pre1N: 12, pre1Valor: 860, pre1Data: "2026-11-10", pre2N: 12, pre2Valor: 330, pre2Data: "2027-11-10",   /* 07/11: 24 parcelas nov/2026–out/2028 */
  balao1Valor: 10000, balao1Data: "2027-12-10", balao2Valor: 7000, balao2Data: "2028-06-10",
  posN: 0, posValor: 0, credito: 248720, fgts: 15000, subsidio: 0
};

test("fluxo padrão vira lista e fecha com o valor da casa", () => {
  const f = F.doPadrao(gavetas);
  assert.equal(f.valor, 305000);
  assert.equal(f.entrega, "2028-12-30");
  assert.deepEqual(f.linhas.map((l) => l.t), ["sinal", "sinal", "sinal", "sinal", "pre", "pre", "balao", "balao", "fin", "fgts"]);
  const r = F.validar(f);
  assert.equal(r.diferenca, 0);
  assert.deepEqual(r.erros, []);
  assert.equal(r.ok, true);
});

test("excedente do valor para entrada entra como Entrada à vista na assinatura", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { credito: 247720 }), 1000);
  const e = f.linhas.find((l) => l.t === "entrada");
  assert.deepEqual([e.v, e.d], [1000, "2026-10-30"]);
  assert.equal(F.validar(f).ok, true);
});

test("um balão a mais não salva até a conta fechar; diferença diz quanto sobra", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 });
  const r = F.validar(f);
  assert.equal(r.ok, false);
  assert.equal(r.diferenca, -10000);
  assert.match(r.erros[0], /^Sobram R\$ 10\.000,00/);
});

test("Redistribuir joga a diferença na linha e os centavos na última parcela", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 });
  const k = f.linhas.findIndex((l) => l.t === "pre");          // 12 × 860 = 10.320 → tem de virar 320
  const r = F.redistribuir(f, k);
  const l = r.linhas[k];
  assert.equal(l.v, 26.66);
  assert.equal(l.u, 26.74);                                      // 11 × 26,66 + 26,74 = 320,00
  assert.equal(F.validar(Object.assign({}, f, { linhas: r.linhas })).ok, true);
});

test("Redistribuir recusa quando a linha ficaria zerada", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 50000, n: 1, d: "2027-06-10", i: 1 });
  assert.match(F.redistribuir(f, 0).erro, /zerada/);
});

test("redistribuir livre: a pessoa ajusta à mão e libera quando bate ao centavo", () => {
  const f = F.doPadrao(gavetas);
  f.linhas.push({ t: "balao", v: 10000, n: 1, d: "2027-06-10", i: 1 });
  f.linhas[4] = Object.assign({}, f.linhas[4], { v: 10320 / 12 - 10000 / 12 });   // 26,666… arredonda
  assert.equal(F.validar(f).ok, false);                                            // 12 × 26,67 = 320,04: sobram 4 centavos
  assert.equal(F.validar(f).diferenca, -0.04);
  f.linhas[4].v = 26.66; f.linhas[4].u = 26.74;
  assert.equal(F.validar(f).ok, true);
});

test("data fora da entrega só avisa (quem trava é a conta)", () => {
  const f = { valor: 2000, entrega: "2028-06-30", linhas: [
    { t: "pre", v: 100, n: 10, d: "2028-01-10", i: 1 },      // última em 10/10/2028
    { t: "pos", v: 1000, n: 1, d: "2028-06-10", i: 1 }] };
  const r = F.validar(f);
  assert.equal(r.ok, true);
  assert.match(r.avisos[0], /^Linha 1: .*depois da entrega das chaves \(10\/10\/2028\)/);
  assert.match(r.avisos[1], /^Linha 2: pós-chaves/);
});

test("permuta exige os dados do bem (03/11; detalhes em permuta-bem.test.mjs); financiamento não exige data", () => {
  const f = { valor: 100000, entrega: "", linhas: [{ t: "permuta", v: 40000, n: 1, d: "2026-11-15", i: 1, x: "" }, { t: "fin", v: 60000, n: 1, d: "", i: 1 }] };
  assert.deepEqual(F.validar(f).erros, ["Linha 1: faltam os dados do bem da permuta (veículo, imóvel ou outro)"]);
  f.linhas[0].b = { tipo: "outro", descricao: "Trator agrícola de teste, ano 2015, em uso" };
  assert.equal(F.validar(f).ok, true);
});

test("valores e tipos inválidos viram erro por linha", () => {
  const r = F.validar({ valor: 100, linhas: [{ t: "carro", v: 100, n: 1, d: "2026-11-01" }, { t: "sinal", v: 0, n: 0, d: "2026-02-30" }] });
  assert.equal(r.ok, false);
  assert.match(r.porLinha[0][0], /tipo/);
  assert.equal(r.porLinha[1].length, 3);   // valor, quantidade e data
});

test("expandir: parcela por parcela, a cada X meses, dia 31 cai no fim do mês", () => {
  const p = F.expandir([{ t: "pre", v: 100, n: 3, d: "2027-01-31", i: 1, u: 101 }, { t: "balao", v: 500, n: 2, d: "2027-01-15", i: 6 }]);
  assert.deepEqual(p.map((x) => [x.data, x.valor, x.rotulo]), [
    ["2027-01-15", 500, "Balão 1/2"], ["2027-01-31", 100, "Pré-chaves 1/3"], ["2027-02-28", 100, "Pré-chaves 2/3"],
    ["2027-03-31", 101, "Pré-chaves 3/3"], ["2027-07-15", 500, "Balão 2/2"]]);
  assert.equal(p[1].reajuste, "INCC-M");
});

/* regras da proposta (dono 29/10) — fluxo da proposta com 24 pós-chaves */
const comPos = Object.assign({}, gavetas, { posN: 24, posValor: 700, posData: "2029-01-10", credito: 248720 - 16800 });

test("fluxo da proposta passa nas regras dela mesma", () => {
  const p = F.doPadrao(comPos);
  assert.deepEqual(F.validar(p, p).erros, []);
});

test("FGTS não muda; financiamento só baixa (05/11, dono: até a carta) — subir é recusado", () => {
  const p = F.doPadrao(comPos), f = F.normalizar(p);
  f.linhas.find((l) => l.t === "fin").v += 1200;
  f.linhas.find((l) => l.t === "pre").v -= 100;
  assert.match(F.validar(f, p).erros.join(";"), /O financiamento não pode passar do valor aprovado na carta/);
  const fg = F.normalizar(p);
  fg.linhas.find((l) => l.t === "fgts").v -= 1200;
  fg.linhas.find((l) => l.t === "pre").v += 100;
  assert.match(F.validar(fg, p).erros.join(";"), /financiamento, FGTS e subsídio não mudam/);
  const sem = F.normalizar(p);
  sem.linhas = sem.linhas.filter((l) => l.t !== "fgts");
  assert.match(F.validar(sem, p).erros.join(";"), /não mudam/);
});

test("pós-chaves: 0, 12 ou 24 parcelas (o prazo), até o teto de R$ 788,33 e sem começar antes", () => {
  const p = F.doPadrao(comPos);
  const menos = F.normalizar(p); menos.linhas.find((l) => l.t === "pos").n = 12;
  assert.doesNotMatch(F.validar(menos, p).erros.join(";"), /Pós-chaves/, "31/10: 48x → 36x pode (o prazo muda)");
  assert.match(F.validar(menos, p).avisos.join(";"), /prazo da entrada muda de 48x para 36x/);
  const torto = F.normalizar(p); torto.linhas.find((l) => l.t === "pos").n = 13;
  assert.match(F.validar(torto, p).erros.join(";"), /só 0, 12 ou 24 parcelas no total .* hoje 13/);
  const dividido = F.normalizar(p), k = dividido.linhas.findIndex((l) => l.t === "pos");
  dividido.linhas.splice(k, 1, { t: "pos", v: 700, n: 12, d: "2029-01-10", i: 1 }, { t: "pos", v: 700, n: 12, d: "2030-01-10", i: 1 });
  assert.deepEqual(F.validar(dividido, p).erros, [], "pode dividir em mais linhas se a quantidade for a mesma");
  const caro = F.normalizar(p); caro.linhas.find((l) => l.t === "pos").v = 800;
  assert.match(F.validar(caro, p).erros.join(";"), /acima do teto de R\$ 788,33/);
  const cedo = F.normalizar(p); cedo.linhas.find((l) => l.t === "pos").d = "2028-12-10";
  assert.match(F.validar(cedo, p).erros.join(";"), /não pode começar antes de 10\/01\/2029/);
  const semPos = F.doPadrao(gavetas), comNovo = F.normalizar(semPos);
  comNovo.linhas.push({ t: "pos", v: 100, n: 1, d: "2029-01-10", i: 1 });
  assert.match(F.validar(comNovo, semPos).erros.join(";"), /só 0, 12 ou 24 parcelas/);
  comNovo.linhas[comNovo.linhas.length - 1].n = 12;
  assert.match(F.validar(comNovo, semPos).avisos.join(";"), /de 24x para 36x .* passa a ter fiador/);
});

test("serializar e ler voltam o mesmo fluxo e descartam campos estranhos", () => {
  const f = F.doPadrao(gavetas);
  f.linhas[0].lixo = "<script>";
  const s = F.serializar(f);
  assert.doesNotMatch(s, /lixo/);
  assert.deepEqual(F.ler(s).linhas, F.normalizar(f).linhas);
  assert.equal(F.ler("não é json"), null);
  assert.ok(s.length < 1900 * 2);
});

/* ---- 30/10: desconto no Alterar fluxo (arquivo 17, item 1) ---- */
const fixos = (ls) => ls.filter((l) => ["sinal", "fin", "fgts", "subsidio", "permuta"].includes(l.t));

test("desconto proporcional na entrada: sinal, financiamento e FGTS não mudam; soma fecha ao centavo", () => {
  const f = F.doPadrao(gavetas), p = F.doPadrao(gavetas);
  const r = F.aplicarDesconto(f, 1000.01, "entrada");
  assert.equal(r.erro, undefined);
  assert.equal(r.valor, 303999.99);
  assert.deepEqual(fixos(r.linhas), fixos(f.linhas));
  assert.equal(F.validar({ valor: r.valor, entrega: f.entrega, linhas: r.linhas }, p).ok, true);
  const antes = F.soma(f.linhas.filter((l) => ["pre", "balao"].includes(l.t)));
  assert.equal(Math.round((antes - F.soma(r.linhas.filter((l) => ["pre", "balao"].includes(l.t)))) * 100), 100001);
  // cada linha perde na proporção do total dela (balão de 10 mil perde mais que o de 7 mil)
  const b = r.linhas.filter((l) => l.t === "balao").map((l) => l.v);
  assert.ok(10000 - b[0] > 7000 - b[1]);
});

test("desconto dos balões primeiro: do último para o primeiro, depois as pré-chaves (também da última)", () => {
  const f = F.doPadrao(gavetas);
  let r = F.aplicarDesconto(f, 3000, "baloes");
  assert.deepEqual(r.linhas.filter((l) => l.t === "balao").map((l) => [l.d, l.v]), [["2027-12-10", 10000], ["2028-06-10", 4000]]);
  r = F.aplicarDesconto(f, 18000, "baloes");                       // os dois balões (17 mil) somem; 1.000 sai da 2ª etapa
  assert.equal(r.linhas.filter((l) => l.t === "balao").length, 0);
  const pre = r.linhas.filter((l) => l.t === "pre");
  assert.equal(F.totalLinha(pre[0]), 12 * 860, "a 1ª etapa não muda");
  assert.equal(F.totalLinha(pre[1]), 12 * 330 - 1000);
  assert.equal(F.validar({ valor: r.valor, entrega: f.entrega, linhas: r.linhas }).ok, true);
});

test("desconto das pré-chaves: proporcional nas etapas, balões intactos, centavos na última parcela", () => {
  const f = F.doPadrao(gavetas);
  const r = F.aplicarDesconto(f, 100, "pre");
  assert.deepEqual(r.linhas.filter((l) => l.t === "balao").map((l) => l.v), [10000, 7000]);
  assert.equal(F.validar({ valor: r.valor, entrega: f.entrega, linhas: r.linhas }).ok, true);
  assert.equal(r.valor, 304900);
});

test("desconto: erros claros (sem origem, zero, maior que o que existe)", () => {
  const f = F.doPadrao(gavetas);
  assert.match(F.aplicarDesconto(f, 100, "x").erro, /de onde sai/);
  assert.match(F.aplicarDesconto(f, 0, "pre").erro, /maior que zero/);
  assert.match(F.aplicarDesconto(f, 15000, "pre").erro, /passa do que existe nas pré-chaves \(R\$ 14\.280,00\)/);
});

test("valor do desconto: R$, % sobre o valor da casa e isenção = a comissão", () => {
  assert.equal(F.valorDoDesconto(305000, { modo: "rs", valor: 1500.5 }).valor, 1500.5);
  assert.equal(F.valorDoDesconto(305000, { modo: "pct", valor: 1.5 }).valor, 4575);
  assert.equal(F.valorDoDesconto(305000, { modo: "isentar", comissao: 15250 }).valor, 15250);
  assert.match(F.valorDoDesconto(305000, { modo: "isentar", comissao: 0 }).erro, /não tem comissão/);
  assert.match(F.valorDoDesconto(305000, { modo: "pct", valor: 100 }).erro, /menor que 100/);
});

test("semComissao vai e volta na serialização; ausente quando falso (o robô lê o resto igual)", () => {
  const f = { ...F.doPadrao(gavetas), semComissao: true };
  assert.equal(F.ler(F.serializar(f)).semComissao, true);
  assert.equal(JSON.parse(F.serializar(F.doPadrao(gavetas))).semComissao, undefined);
  assert.equal(F.ler(F.serializar({ ...F.doPadrao(gavetas), semComissao: "sim" })).semComissao, undefined, "só true vale");
});

/* ---- 31/10/2026 (dono): a pré-reserva paga abate o sinal ---- */
test("reserva abate o sinal: sai do ato, depois do 30, 60 e 90 dias; soma continua fechando", () => {
  assert.deepEqual(F.abaterSinal([1000, 3000, 3000, 3000], 3000), { valores: [0, 1000, 3000, 3000], abatido: 3000 });
  assert.deepEqual(F.abaterSinal([1000, 3000, 3000, 3000], 500.5), { valores: [499.5, 3000, 3000, 3000], abatido: 500.5 });
  assert.deepEqual(F.abaterSinal([1000, 3000, 3000, 3000], 12000), { valores: [0, 0, 0, 0], abatido: 10000 });
  const f = F.doPadrao(gavetas, 0, { valor: 3000, data: "2026-10-28" });
  assert.deepEqual(f.linhas.slice(0, 4).map((l) => [l.t, l.v, l.d]),
    [["prereserva", 3000, "2026-10-28"], ["sinal", 1000, "2026-11-30"], ["sinal", 3000, "2026-12-30"], ["sinal", 3000, "2027-01-30"]]);
  assert.deepEqual(F.validar(f).erros, []);
  assert.deepEqual(F.doPadrao(gavetas, 0, null).linhas.map((l) => l.t), F.doPadrao(gavetas).linhas.map((l) => l.t), "sem reserva não muda");
});

test("com reserva o restante do sinal se divide livre, só nos prazos do sinal e sem baixar o sinal", () => {
  const p = F.doPadrao(gavetas, 0, { valor: 3000, data: "2026-10-28" });
  const troca = (linhas) => Object.assign({}, p, { linhas });
  const fixos = p.linhas.filter((l) => l.t !== "sinal");
  /* restante (7.000) em 2 parcelas: ato e 90 dias */
  const ok = troca([fixos[0], { t: "sinal", v: 2000, n: 1, d: "2026-10-30", i: 1, x: "" }, { t: "sinal", v: 5000, n: 1, d: "2027-01-30", i: 1, x: "" }, ...fixos.slice(1)]);
  assert.deepEqual(F.validar(ok, p).erros, []);
  /* depois de 90 dias = recusado */
  const tarde = troca([fixos[0], { t: "sinal", v: 7000, n: 1, d: "2027-02-28", i: 1, x: "" }, ...fixos.slice(1)]);
  assert.match(F.validar(tarde, p).erros.join(";"), /só nos prazos do sinal: de 30\/10\/2026 a 30\/01\/2027/);
  /* 5 parcelas = recusado */
  const muitas = troca([fixos[0], { t: "sinal", v: 1400, n: 4, d: "2026-10-30", i: 1, x: "" }, { t: "sinal", v: 1400, n: 1, d: "2026-10-30", i: 1, x: "" }, ...fixos.slice(1)]);
  assert.match(F.validar(muitas, p).erros.join(";"), /no máximo 4 parcelas/);
  /* sinal menor (passa 1.000 para a pré-chaves) = recusado */
  const pre = fixos.find((l) => l.t === "pre");
  const menor = troca([fixos[0], { t: "sinal", v: 6000, n: 1, d: "2026-10-30", i: 1, x: "" },
    ...fixos.slice(1).map((l) => l === pre ? Object.assign({}, l, { u: l.v + 1000 }) : l)]);
  assert.match(F.validar(menor, p).erros.join(";"), /não pode ficar abaixo do mínimo: R\$ 10\.000,00/);
  /* pré-reserva não muda */
  const mexeu = troca([Object.assign({}, fixos[0], { v: 2000 }), { t: "sinal", v: 8000, n: 1, d: "2026-10-30", i: 1, x: "" }, ...fixos.slice(1)]);
  assert.match(F.validar(mexeu, p).erros.join(";"), /Reserva paga, financiamento, FGTS e subsídio não mudam/);
});

test("31/10/2026 (dono): pré-chaves e balões não passam de 30/11/2028 (trava, não aviso)", () => {
  const f = F.doPadrao(gavetas);
  const k = f.linhas.findIndex((l) => l.t === "pre" && l.d === "2027-11-10");
  const tarde = Object.assign({}, f, { linhas: f.linhas.map((l, i) => i === k ? Object.assign({}, l, { d: "2028-01-10" }) : l) });
  const r = F.validar(tarde);
  assert.equal(r.ok, false);
  /* 07/11: as parcelas pré-chaves terminam em out/2028 (o limite 30/11/2028 segue para os balões) */
  assert.match(r.erros.join(";"), /pré-chaves vence em 10\/12\/2028: as parcelas terminam em outubro\/2028/);
  const balao = Object.assign({}, f, { linhas: f.linhas.map((l) => l.t === "balao" && l.d === "2028-06-10" ? Object.assign({}, l, { d: "2028-12-01" }) : l) });
  assert.match(F.validar(balao).erros.join(";"), /balão vence em 01\/12\/2028/);
  const noLimite = Object.assign({}, f, { linhas: f.linhas.map((l) => l.t === "balao" && l.d === "2028-06-10" ? Object.assign({}, l, { d: "2028-11-30" }) : l) });
  assert.deepEqual(F.validar(noLimite).erros, []);
});

/* 31/10/2026: casa 17 — cliente de 24x para 36x. Números do simulador (fpcGerar) com sinal de R$ 30.000 */
const casa24 = { valor: 96511.27 + 244800 + 8688.73, entrega: "2028-11-30", linhas: [
  { t: "sinal", v: 1000, n: 1, d: "2026-10-31", i: 1 }, { t: "sinal", v: 29000, n: 1, d: "2026-11-10", i: 1 },
  { t: "pre", v: 1828.63, n: 12, d: "2026-11-10", i: 1 }, { t: "pre", v: 701.69, n: 12, d: "2027-11-10", i: 1 },
  { t: "balao", v: 21263.19, n: 1, d: "2027-12-10", i: 1 }, { t: "balao", v: 14884.24, n: 1, d: "2028-11-10", i: 1 },
  { t: "fin", v: 244800, n: 1, d: "", i: 1 }, { t: "fgts", v: 8688.73, n: 1, d: "", i: 1 }] };

test("mudar o prazo refaz pré-chaves, balões e pós-chaves igual ao simulador", () => {
  assert.equal(F.prazoDasLinhas(casa24.linhas), 24);
  const r36 = F.mudarPrazo(casa24, 36);
  const resumo = (ls) => ls.map((l) => [l.t, l.v, l.n, l.d]);
  assert.deepEqual(resumo(r36.linhas), [
    ["sinal", 1000, 1, "2026-10-31"], ["sinal", 29000, 1, "2026-11-10"],
    ["pre", 1568.55, 12, "2026-11-10"], ["pre", 601.88, 12, "2027-11-10"],
    ["balao", 18238.9, 1, "2027-12-10"], ["balao", 12767.25, 1, "2028-11-10"], ["pos", 788.33, 12, "2028-12-10"],
    ["fin", 244800, 1, ""], ["fgts", 8688.73, 1, ""]]);
  const f36 = Object.assign({}, casa24, { linhas: r36.linhas });
  assert.equal(F.validar(f36).diferenca, 0);
  assert.equal(F.prazoDasLinhas(r36.linhas), 36);
  /* volta para 24x e chega aos mesmos valores da proposta */
  assert.deepEqual(resumo(F.mudarPrazo(f36, 24).linhas), resumo(F.normalizar(casa24).linhas));
  const r48 = F.mudarPrazo(casa24, 48);
  assert.equal(F.validar(Object.assign({}, casa24, { linhas: r48.linhas })).diferenca, 0);
  assert.deepEqual(r48.linhas.filter((l) => l.t === "pos").map((l) => [l.v, l.n]), [[788.33, 24]]);
  assert.match(F.mudarPrazo(casa24, 30).erro, /24, 36 ou 48/);
});

test("Distribuir espalha a diferença nas pré-chaves e balões e fecha ao centavo", () => {
  const f = F.normalizar(casa24);
  f.linhas[1].v = 25000;                                   // sinal menor: faltam R$ 4.000
  assert.equal(F.validar(f).diferenca, 4000);
  const r = F.distribuir(f);
  assert.equal(F.validar(Object.assign({}, f, { linhas: r.linhas })).diferenca, 0);
  assert.deepEqual(r.linhas.slice(0, 2).map((l) => l.v), [1000, 25000], "sinais não mudam");
  assert.ok(r.linhas[2].v > 1828.63 && r.linhas[4].v > 21263.19);
  const sobra = F.normalizar(casa24); sobra.linhas[1].v = 33000;   // sobram 4.000
  const r2 = F.distribuir(sobra);
  assert.equal(F.validar(Object.assign({}, sobra, { linhas: r2.linhas })).diferenca, 0);
  const so = { valor: 1000, linhas: [{ t: "sinal", v: 500, n: 1, d: "2026-10-31", i: 1 }] };
  assert.match(F.distribuir(so).erro, /Não há pré-chaves/);
});

/* 31/10/2026 (teste de tela na unidade 61): 36x → 24x → 36x mudava a 1ª pós-chaves (de 15/01/2029 para 15/12/2028,
   o mês da entrega) porque a data saía das linhas de agora. Agora sai da proposta (ou do mês seguinte à entrega):
   qualquer ordem de cliques, qualquer número de vezes, dá o mesmo fluxo. */
test("prazo em qualquer ordem dá sempre o mesmo fluxo (36→24→36, 48→36, 36→48→24→36), com proposta 24x e 36x", () => {
  const resumo = (ls) => ls.map((l) => [l.t, l.v, l.n, l.d]);
  const seq = (f, padrao, ps) => ps.reduce((a, p) => ({ ...a, linhas: F.mudarPrazo(a, p, padrao).linhas }), f);
  /* proposta 24x (sem pós-chaves) — a casa 17 */
  const p24 = F.normalizar(casa24);
  for (const ps of [[36, 24, 36], [48, 36], [36, 48, 24, 36], [36, 36, 36]]) {
    const fim = seq(p24, p24, ps);
    assert.deepEqual(resumo(fim.linhas), resumo(F.mudarPrazo(p24, ps[ps.length - 1], p24).linhas), ps.join("→"));
  }
  assert.deepEqual(resumo(seq(p24, p24, [36, 48, 24]).linhas), resumo(p24.linhas), "voltar a 24x devolve a proposta");
  /* proposta 36x, entrega 15/12/2028, dia 15 — a unidade 61: a 1ª pós fica em 15/01/2029, sempre */
  const base61 = { valor: casa24.valor, entrega: "2028-12-15", linhas: casa24.linhas.map((l) => (l.d ? { ...l, d: l.d.slice(0, 8) + "15" } : l)) };
  const p36 = { ...base61, linhas: F.mudarPrazo(base61, 36, null).linhas };
  assert.equal(p36.linhas.find((l) => l.t === "pos").d, "2029-01-15");
  for (const ps of [[36, 24, 36], [48, 36], [36, 48, 24, 36]]) {
    const fim = seq(p36, p36, ps);
    assert.deepEqual(resumo(fim.linhas), resumo(ps[ps.length - 1] === 36 ? p36.linhas : F.mudarPrazo(p36, ps[ps.length - 1], p36).linhas), ps.join("→"));
    if (ps[ps.length - 1] !== 24) assert.equal(fim.linhas.find((l) => l.t === "pos").d, "2029-01-15", ps.join("→"));
    assert.deepEqual(F.validar(fim, p36).erros, [], ps.join("→") + ": " + F.validar(fim, p36).erros.join(" | "));
  }
});

/* 03/11/2026 (dono): "nesse caso o carro entra como sinal/entrada" — a permuta conta no mínimo do sinal. Dados FALSOS. */
test("permuta conta no sinal mínimo junto com o sinal e a reserva; permuta menor que o necessário continua recusada", () => {
  const p = F.doPadrao(Object.assign({}, gavetas, { sinalAto: 3280.41, balao1Valor: 7719.59 }), 0, { valor: 1000, data: "2026-10-28" });
  const troca = (linhas) => Object.assign({}, p, { linhas });
  const fixos = p.linhas.filter((l) => l.t !== "sinal");
  const carro = { tipo: "veiculo", marca: "Marca Teste", modelo: "Modelo Teste", anoFab: 2019, anoModelo: 2020, cor: "prata", placa: "ABC1D23",
    renavam: "00100000002", chassi: "9BWZZZ377VT004251", propNome: "Fulano de Teste", propDoc: "52998224725", situacao: "quitado" };
  const permuta = (v) => ({ t: "permuta", v, n: 1, d: "2026-11-20", i: 1, x: "", b: carro });
  /* proposta: sinal 12.280,41 com a pré-reserva de 1.000; o cliente dá um carro de 11.280,41 e não paga mais sinal */
  assert.equal(p.linhas.filter((l) => l.t === "sinal" || l.t === "prereserva").reduce((s, l) => s + Math.round(l.v * 100) * l.n, 0), 1228041);
  assert.deepEqual(F.validar(troca([...fixos, permuta(11280.41)]), p).erros, []);
  /* 08/11 (dono): o limite é o mínimo da casa (10.000), não o sinal da proposta. Carro de 8.000 + reserva de 1.000 = 9.000: recusado */
  const pre = fixos.find((l) => l.t === "pre");
  const menor = troca([...fixos.map((l) => l === pre ? Object.assign({}, l, { u: l.v + 3280.41 }) : l), permuta(8000)]);
  assert.match(F.validar(menor, p).erros.join(";"), /O sinal \(com a reserva e a permuta\) não pode ficar abaixo do mínimo: R\$ 10\.000,00/);
});

/* 07/11/2026 (dono): "a data de vencimento não pode ser uma data passada" — pré-chaves, balão e pós-chaves vencem
   depois da assinatura, no Alterar fluxo (FluxoVenda.gs) e na geração do contrato (ContratoVenda) */
test("pré-chaves com a 1ª parcela antes da assinatura não salva", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-25" }));
  const k = f.linhas.findIndex((l) => l.t === "pre");
  f.linhas[k].d = "2026-11-10";
  const r = F.validar(f);
  assert.equal(r.ok, false);
  assert.ok(r.porLinha[k].some((m) => /tem de vencer depois da assinatura \(25\/11\/2026\)/.test(m)), JSON.stringify(r.porLinha));
});

test("vencer no próprio dia da assinatura também não pode; um dia depois pode", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-10" }));
  const k = f.linhas.findIndex((l) => l.t === "pre");
  f.linhas[k].d = "2026-11-10";
  assert.equal(F.validar(f).ok, false);
  f.linhas[k].d = "2026-11-11";
  assert.ok(!(F.validar(f).porLinha[k] || []).some((m) => /depois da assinatura/.test(m)));
});

test("a assinatura da proposta (padrão) vale quando a tela não manda a dela", () => {
  const padrao = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-25" }));
  const f = F.normalizar({ valor: padrao.valor, entrega: padrao.entrega, linhas: padrao.linhas.map((l) => Object.assign({}, l)) });
  const k = f.linhas.findIndex((l) => l.t === "balao");
  f.linhas[k].d = "2026-11-20";
  assert.ok(F.validar(f, padrao).erros.some((e) => /balão vence em 20\/11\/2026: tem de vencer depois da assinatura/.test(e)));
});

test("o fluxo padrão de quem assina em novembro continua salvando", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-07", pre1Data: "2026-11-10", pre2Data: "2027-11-10" }));
  assert.deepEqual(F.validar(f).erros, []);
});

/* 07/11/2026 (dono, 2º pedido): "em todos os locais, sempre que a data do vencimento for anterior à data atual, trava e
   calcula o fluxo certo" — referência = a maior entre a assinatura e hoje; Corrigir datas leva para o 1º mês que pode */
test("com hoje depois da assinatura, pré-chaves vencendo até hoje trava e manda usar Corrigir datas", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-02" }));
  f.hoje = "2026-11-12";
  const k = f.linhas.findIndex((l) => l.t === "pre");
  f.linhas[k].d = "2026-11-10";
  const r = F.validar(f);
  assert.ok(r.porLinha[k].some((m) => /tem de vencer depois de hoje \(12\/11\/2026\) — use Corrigir datas/.test(m)), JSON.stringify(r.porLinha));
});

test("sinal vencendo antes de hoje trava (atualizar a assinatura); sem hoje, nada muda", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-10-30" }));
  assert.equal(F.validar(f).ok, true);
  f.hoje = "2026-12-01";
  assert.ok(F.validar(f).erros.some((e) => /sinal vence em 30\/11\/2026, antes de hoje/.test(e)));
});

test("Corrigir datas: mesmo dia, 1º mês que pode, e pré-chaves que estouraria 30/11/2028 perde parcela sem mudar o total", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-25", pre1Data: "2026-11-10", pre2Data: "2027-11-10" }));
  const antes = F.soma(f.linhas);
  const cd = F.corrigirDatas(f);
  const pre = cd.linhas.filter((l) => l.t === "pre");
  assert.equal(pre[0].d, "2026-12-10");
  assert.equal(pre[1].d, "2027-11-10");                     /* esta já podia: não mexe */
  assert.deepEqual(cd.mudou, [cd.linhas.indexOf(pre[0])]);
  assert.equal(F.soma(cd.linhas), antes);
  const g = Object.assign({}, gavetas, { assinatura: "2026-11-25", pre1N: 24, pre1Valor: 500, pre1Data: "2026-11-10", pre2N: 0, pre2Valor: 0, pre2Data: "" });
  const f2 = F.doPadrao(g), t0 = F.soma(f2.linhas), c2 = F.corrigirDatas(f2);
  const p2 = c2.linhas.find((l) => l.t === "pre");
  assert.equal(p2.d, "2026-12-10");
  assert.equal(p2.n, 23);                                    /* 07/11: parcelas até out/2028 — de dez/2026 cabem 23 */
  const f3 = F.doPadrao(Object.assign({}, g, { pre1N: 25 })), t3 = F.soma(f3.linhas), c3 = F.corrigirDatas(f3);
  const p3 = c3.linhas.find((l) => l.t === "pre");
  assert.equal(p3.n, 23);
  assert.equal(F.soma(c3.linhas), t3);
  assert.ok(t0 > 0);
});

test("Corrigir datas resolve o erro do validar (o fluxo certo salva)", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-02", pre1Data: "2026-11-05", pre2Data: "2027-11-05" }));
  f.hoje = "2026-11-07";
  assert.ok(F.validar(f).erros.some((e) => /use Corrigir datas/.test(e)));
  const cd = F.corrigirDatas(f);
  assert.ok(!F.validar(Object.assign({}, f, { linhas: cd.linhas })).erros.some((e) => /use Corrigir datas/.test(e)));
  assert.equal(cd.linhas.find((l) => l.t === "pre").d, "2026-12-05");
});

/* 07/11/2026 (dono): "as pré-chaves tem que finalizar até 30/11/2028, então não posso ter mais parcelas do que meses;
   se eu tenho 2 pré-chaves de 12, não pode deixar eu aumentar um pré-chave para 13" */
const doze = () => F.doPadrao(gavetas);   /* 12 de nov/2026 + 12 de nov/2027 = nov/2026 a out/2028 */
const pres = (f) => f.linhas.map((l, k) => [l, k]).filter(([l]) => l.t === "pre");

test("2 pré-chaves de 12: a 1ª para 13 trava (duas parcelas em nov/2027)", () => {
  const f = doze(), [[, k0]] = pres(f);
  f.linhas[k0].n = 13;
  const r = F.validar(f);
  assert.ok(r.erros.some((e) => /já tem parcela pré-chaves em 11\/2027 \(linha \d+\) — uma por mês/.test(e)), JSON.stringify(r.erros));
});

test("2 pré-chaves de 12: a 2ª para 13 trava (parcela em nov/2028, mês do balão da entrega)", () => {
  const f = doze(), k1 = pres(f)[1][1];
  f.linhas[k1].n = 13;
  assert.ok(F.validar(f).erros.some((e) => /pré-chaves vence em 10\/11\/2028: as parcelas terminam em outubro\/2028 .* cabem 12/.test(e)));
});

test("pré-chaves só mensais; mês sem parcela trava; dois balões no mesmo mês travam", () => {
  const f = doze(), [[, k0], [, k1]] = pres(f);
  const r1 = F.validar(Object.assign({}, f, { linhas: f.linhas.map((l, i) => i === k0 ? Object.assign({}, l, { i: 2 }) : l) }));
  assert.ok(r1.erros.some((e) => /pré-chaves só mensais/.test(e)));
  const r2 = F.validar(Object.assign({}, f, { linhas: f.linhas.map((l, i) => i === k1 ? Object.assign({}, l, { d: "2027-12-10", n: 11 }) : l) }));
  assert.ok(r2.erros.some((a) => /pré-chaves sem parcela em 11\/2027/.test(a)), JSON.stringify(r2.erros));
  const b = f.linhas.filter((l) => l.t === "balao");
  const f3 = Object.assign({}, f, { linhas: f.linhas.concat([{ t: "balao", v: 1, n: 1, d: b[0].d, i: 1, x: "" }]) });
  assert.ok(F.validar(f3).erros.some((e) => /já tem balão em 12\/2027/.test(e)));
});

test("cabemPre: quantas parcelas cabem até a próxima parte ou outubro/2028", () => {
  const f = doze(), [[, k0], [, k1]] = pres(f);
  assert.equal(F.cabemPre(f, k0), 12);
  assert.equal(F.cabemPre(f, k1), 12);
  const so = Object.assign({}, f, { linhas: f.linhas.filter((l, i) => i !== k1) });
  assert.equal(F.cabemPre(so, so.linhas.findIndex((l) => l.t === "pre")), 24);
});

test("encaixarPre com a 1ª parte mexida (13): a 2ª anda um mês, fica com 11 e o total dela não muda", () => {
  const f = doze(), [[, k0], [l1, k1]] = pres(f), tot1 = F.totalLinha(l1);
  f.linhas[k0].n = 13;
  const en = F.encaixarPre(f, k0), p2 = en.linhas[k1];
  assert.deepEqual([p2.d, p2.n], ["2027-12-10", 11]);
  assert.equal(F.totalLinha(p2), tot1);
  assert.deepEqual(en.mudou, [k1]);
  assert.ok(!F.validar(Object.assign({}, f, { linhas: en.linhas })).erros.some((e) => /uma por mês|outubro\/2028/.test(e)));
});

test("encaixarPre sem linha fixa: a parte que invade a próxima encurta; a última não passa de outubro/2028", () => {
  const f = doze(), [[l0, k0], [, k1]] = pres(f), tot0 = F.totalLinha(l0);
  f.linhas[k0].n = 13; f.linhas[k1].n = 13;
  const en = F.encaixarPre(f, null);
  assert.equal(en.linhas[k0].n, 12);
  assert.equal(F.totalLinha(en.linhas[k0]), tot0 + 860);   /* 13 × 860 repartidos em 12 */
  assert.equal(en.linhas[k1].n, 12);
});

test("Corrigir datas com a 1ª parte empurrada: ela encurta para não cair no mês da 2ª", () => {
  const f = F.doPadrao(Object.assign({}, gavetas, { assinatura: "2026-11-25" }));
  const cd = F.corrigirDatas(f), p = cd.linhas.filter((l) => l.t === "pre");
  assert.deepEqual([p[0].d, p[0].n, p[1].d, p[1].n], ["2026-12-10", 11, "2027-11-10", 12]);
  assert.equal(F.soma(cd.linhas), F.soma(f.linhas));
  assert.ok(!F.validar(Object.assign({}, f, { linhas: cd.linhas })).erros.some((e) => /uma por mês/.test(e)));
});

/* 08/11/2026 (dono): "o sinal sempre tem que ser >= que o mínimo" */
const casa = (valor, fin, sinal, n = 12) => {
  const pre = valor - fin - sinal - 17000;
  return { valor, entrega: "2028-11-30", linhas: [{ t: "sinal", v: sinal, n: 1, d: "2026-11-30", i: 1, x: "" },
    { t: "pre", v: Math.round(pre / n * 100) / 100, n, d: "2026-12-15", i: 1, x: "" },
    { t: "balao", v: 10000, n: 1, d: "2027-12-15", i: 1, x: "" }, { t: "balao", v: 7000, n: 1, d: "2028-11-15", i: 1, x: "" },
    { t: "fin", v: fin, n: 1, d: "", i: 1, x: "" }] };
};
const erroMinimo = (r) => r.erros.filter((e) => /abaixo do mínimo/.test(e));

test("sinal mínimo: sem reserva paga também trava abaixo do mínimo da casa", () => {
  const proposta = casa(305000, 244800, 10000);
  const baixo = casa(305000, 244800, 9000);
  assert.ok(F.sinalMinimoCasa(proposta) === 10000);
  assert.match(erroMinimo(F.validar(baixo, proposta)).join(";"), /mínimo: R\$ 10\.000,00/);
  assert.deepEqual(erroMinimo(F.validar(proposta, proposta)), []);
});

test("sinal mínimo: casa trocada por uma mais barata — vale o mínimo da casa de agora, não o sinal da proposta", () => {
  const propostaDaCara = casa(305000, 244800, 20000);
  assert.deepEqual(erroMinimo(F.validar(casa(305000, 244800, 10000), propostaDaCara)), []);
});

test("sinal mínimo: a proposta com sinal baixo não libera ficar abaixo do mínimo da casa", () => {
  const f = casa(380000, 244800, 10000);
  const minimo = F.sinalMinimoCasa(f);
  assert.ok(minimo > 10000, String(minimo));
  assert.equal(erroMinimo(F.validar(f, f)).length, 1);
});

test("sinal mínimo: reduzir o financiamento não sobe o mínimo (a diferença vai nas parcelas)", () => {
  const proposta = casa(305000, 244800, 10000);
  assert.deepEqual(erroMinimo(F.validar(casa(305000, 200000, 10000, 12), proposta)), []);
});

/* 14/11/2026 (dono): "tá autorizado fazer com a entrada de 10.000,00" — exceção por venda: a coluna SINAL MÍNIMO
   AUTORIZADO da venda (padrao.sinalMinimo) troca o mínimo calculado da casa. Sem ela, nada muda. Dados FALSOS. */
test("sinal mínimo autorizado na venda vale no lugar do mínimo da casa; sem autorização a trava continua", () => {
  const proposta = casa(380000, 244800, 20000);
  const f = casa(380000, 244800, 12000);
  assert.ok(F.sinalMinimoCasa(f, proposta) > 12000);
  assert.equal(erroMinimo(F.validar(f, proposta)).length, 1);
  const autorizada = { ...proposta, sinalMinimo: 10000 };
  assert.equal(F.sinalMinimoCasa(f, autorizada), 10000);
  assert.deepEqual(erroMinimo(F.validar(f, autorizada)), []);
  /* abaixo do autorizado continua recusado, e a autorização não vai para o texto gravado */
  assert.match(erroMinimo(F.validar(casa(380000, 244800, 9000), autorizada)).join(";"), /mínimo: R\$ 10\.000,00/);
  assert.ok(!/sinalMinimo/.test(F.serializar({ ...f, sinalMinimo: 10000 })));
  /* Trazer reserva e sinal da proposta não sobe o sinal acima do autorizado */
  const al = F.alinharComProposta(f, autorizada);
  assert.ok(!al.erro, al.erro);
  assert.equal(al.linhas.filter((l) => l.t === "sinal").reduce((s, l) => s + l.v * l.n, 0), 12000);
});
