/* Antecipação de parcelas — a tela do cartão da venda do condomínio (aba Financeiro, 31/10/2026).
   Dados inventados (venda sintética da unidade 13). A conta é venda/Antecipacao.js; aqui se prova só o desenho e as escolhas. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const A = req("../Antecipacao.js");
globalThis.Antecipacao = A;
const D = req("../../venda-dossie.js");
const RET = JSON.parse(fs.readFileSync(new URL("./dados/antecipacao-retratos.json", import.meta.url), "utf8")).base;

const HOJE = "2026-10-21";
const VENDA = "00000000-0000-0000-0000-0000000000a1";
const ui = (x = {}) => Object.assign({ vendaId: VENDA, aberto: true, hoje: HOJE, dataPg: HOJE, modo: "B", valor: "", testes: false }, x);
const est = (x = {}) => Object.assign({ ok: true, pode: true, velho: false, processando: false, retrato: RET, lido: "2026-10-21 10:00", temFiador: true }, x);
const tudo = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const cartao = (h, m) => { const i = h.indexOf('data-an-card="' + m + '"'); const j = h.indexOf('data-an-card="', i + 5); return h.slice(i, j < 0 ? undefined : j); };
const semPos = () => { const r = structuredClone(RET); r.parcelas = r.parcelas.filter((p) => p.tipo !== "pos"); return r; };
const semBalao = () => { const r = structuredClone(RET); r.parcelas = r.parcelas.filter((p) => p.tipo !== "balao"); return r; };
const BAL = A.situacao(RET, HOJE).balaoes;

test("sem a venda lançada no Mais Controle o bloco não desenha nada", () => {
  assert.equal(D.htmlAntecipacao(null, ui({ vendaId: "" })), "");
  assert.equal(D.htmlAntecipacao(est(), ui({ vendaId: "", aberto: true })), "");
});

test("fechado: só o botão Antecipar parcelas; aberto: o botão vira Fechar", () => {
  const h = D.htmlAntecipacao(null, ui({ aberto: false }));
  assert.match(h, /data-acao="an-abrir"[^>]*>Antecipar parcelas</);
  assert.doesNotMatch(h, /an-modo|ant-valor/);
  assert.match(D.htmlAntecipacao(est(), ui()), /data-acao="an-abrir"[^>]*>Fechar a simulação</);
  assert.match(D.htmlAntecipacao(null, ui({ ocupado: "estado" })), /abrindo…/);
});

test("retrato velho: nenhum número, só a mensagem e o botão de ler de novo", () => {
  const h = D.htmlAntecipacao({ ok: true, pode: true, velho: true, lido: "2026-09-30 10:00", temFiador: true }, ui());
  assert.match(h, /data-acao="an-ler"/);
  assert.match(h, /30\/09\/2026/);
  assert.doesNotMatch(h, /\d+,\d{2}/);
  assert.doesNotMatch(h, /an-modo|ant-valor|ant-data/);
});

test("retrato bom mas de outro mês também não mostra número", () => {
  const h = D.htmlAntecipacao(est({ velho: true, lido: "2026-09-30 10:00" }), ui());
  assert.match(h, /outro mês/); assert.match(h, /an-ler/);
  assert.doesNotMatch(h, /\d+,\d{2}/); assert.doesNotMatch(h, /an-modo/);
});

test("processando: mensagem, botão de ler travado e nenhum número (mesmo com retrato do mês)", () => {
  const h = D.htmlAntecipacao(est({ processando: true }), ui());
  assert.match(h, /Lendo a venda no ERP/);
  assert.match(h, /data-acao="an-ler"[^>]*disabled/);
  assert.doesNotMatch(h, /\d+,\d{2}/); assert.doesNotMatch(h, /an-modo/);
  assert.match(D.htmlAntecipacao(est({ retrato: undefined, velho: true }), ui({ lendo: true })), /Lendo a venda no ERP/);
});

test("erro do robô sem retrato bom: mostra o motivo escapado e nenhum número", () => {
  const h = D.htmlAntecipacao({ ok: true, pode: true, velho: true, lido: "", erroRobo: "falhou <b>x</b>", temFiador: false }, ui());
  assert.match(h, /A leitura da venda no ERP falhou \(falhou &lt;b&gt;x&lt;\/b&gt;\)/);
  assert.match(h, /an-ler/); assert.doesNotMatch(h, /<b>x/); assert.doesNotMatch(h, /\d+,\d{2}/);
});

test("nunca lida: pede a primeira leitura", () => {
  const h = D.htmlAntecipacao({ ok: true, pode: true, velho: true, lido: "", temFiador: false }, ui());
  assert.match(h, /Ainda não lido do ERP/); assert.match(h, /ainda não foi lida/);
});

test("retrato bom com erro do robô: mostra o retrato e um aviso discreto", () => {
  const h = D.htmlAntecipacao(est({ erroRobo: "ERP fora do ar <i>" }), ui({ valor: "30.000,00" }));
  assert.match(h, /a última tentativa de ler de novo falhou \(ERP fora do ar &lt;i&gt;\)/);
  assert.match(h, /data-modo="B"/); assert.match(h, /37\.446,74/);
});

test("venda que não pode antecipar mostra só o motivo", () => {
  const h = D.htmlAntecipacao({ ok: true, pode: false, velho: true, lido: "", motivo: "A venda ainda não foi lançada no Mais Controle", temFiador: false }, ui());
  assert.match(h, /A venda ainda não foi lançada/); assert.doesNotMatch(h, /an-modo|an-ler/);
});

test("topo: com fiador ou sem fiador, e a nota fixa do que não dá por aqui", () => {
  const com = D.htmlAntecipacao(est({ temFiador: true }), ui());
  assert.match(com, /Com fiador: travas ligadas/);
  assert.match(D.htmlAntecipacao(est({ temFiador: false }), ui()), /Sem fiador \(24x\)/);
  assert.match(com, /Não dá por aqui: mudar data de balão, dividir balão nas mensais, esticar prazo\. Isso é renegociação e precisa de aditivo assinado por todos, inclusive os fiadores\./);
  assert.match(com, /Lido do ERP em 21\/10\/2026 10:00/);
});

test("os cinco jeitos, o campo de valor e a data de hoje com min e max", () => {
  const h = D.htmlAntecipacao(est(), ui());
  for (const m of ["A", "B", "C", "D", "E"]) assert.match(h, new RegExp('data-acao="an-modo" data-modo="' + m + '"'));
  assert.match(h, /id="ant-valor"[^>]*data-an="valor"/);
  assert.match(h, /id="ant-data"[^>]*min="2026-10-21" max="2026-10-31" value="2026-10-21"/);
});

test("todo data-acao do bloco começa com an-, e nenhum elemento usa o atributo hidden", () => {
  const h = D.htmlAntecipacao(est(), ui({ valor: "30000", tabela: true, pdf: { texto: "oi", url: "" } }));
  const acoes = [...h.matchAll(/data-acao="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(acoes.length > 8);
  for (const a of acoes) assert.match(a, /^an-/, a);
  assert.doesNotMatch(h, /\shidden[\s>=]/);
});

test("30.000,00 muda o cartão B, e é só conta local (as mesmas contas do Antecipacao.js)", () => {
  const sem = cartao(D.htmlAntecipacao(est(), ui()), "B");
  assert.match(tudo(sem), /Digite o valor para ver como fica/);
  const com = cartao(D.htmlAntecipacao(est(), ui({ valor: "30.000,00" })), "B");
  const r = A.simular(RET, { modo: "B", valor: 30000, dataPg: HOJE });
  assert.equal(r.ok, true);
  assert.match(com, /Todas as parcelas que faltam diminuem na mesma proporção/);
  assert.match(com, /Próximo pagamento: 10\/11\/2026, R\$ 65,99\. Última parcela: 10\/02\/2029, R\$ 157,64\./);
  assert.notEqual(sem, com);
  assert.match(cartao(D.htmlAntecipacao(est(), ui({ valor: "30.000,00" })), "A"), /Próximo pagamento: 10\/05\/2028, R\$ 312,35/);
});

test("valor acima do saldo e valor ilegível têm mensagem simples", () => {
  assert.match(tudo(cartao(D.htmlAntecipacao(est(), ui({ valor: "99.999,00" })), "B")), /maior do que o saldo em aberto \(R\$ 37\.446,74\)/);
  assert.match(tudo(cartao(D.htmlAntecipacao(est(), ui({ valor: "abc" })), "B")), /Valor inválido/);
});

test("D: lista os balões em aberto, texto de quitar e de pagar parte; botão de quitar inteiro", () => {
  const h = D.htmlAntecipacao(est(), ui({ modo: "D", valor: "10.055,54" }));
  const d = cartao(h, "D");
  assert.equal((d.match(/name="an-par"/g) || []).length, BAL.length);
  assert.match(d, /Balão de 10\/12\/2026 · R\$ 10\.055,54 hoje/);
  assert.match(tudo(d), /O balão de 10\/12\/2026 era R\$ 8\.954,18 no contrato\. Com a correção da obra até hoje ele está em R\$ 10\.055,54\. Pagando agora, ele para de corrigir\./);
  assert.match(d, /data-acao="an-usar" data-valor="10055.54"/);
  const parte = tudo(cartao(D.htmlAntecipacao(est(), ui({ modo: "D", valor: "5.000,00" })), "D"));
  assert.match(parte, /continua em dez\/2026 e fica em R\$ 5\.055,54 hoje \(segue corrigido daqui para frente\)/);
  const segundo = cartao(D.htmlAntecipacao(est(), ui({ modo: "D", valor: "100,00", parcelaId: BAL[1].id })), "D");
  assert.match(segundo, new RegExp('value="' + BAL[1].id + '" checked'));
});

test("E: todas ou as últimas N, com o texto pronto da spec; sem valor digitado", () => {
  const h = D.htmlAntecipacao(est(), ui({ modo: "E" }));
  assert.doesNotMatch(h, /id="ant-valor"/);
  const e = cartao(h, "E");
  assert.match(tudo(e), /Quitando as 24 parcelas depois das chaves hoje, você paga R\$ 19\.025,04 e não paga mais os juros de 1% ao mês delas\. Depois das chaves não fica nada a pagar\./);
  assert.match(e, /data-acao="an-todas" checked/);
  const n = cartao(D.htmlAntecipacao(est(), ui({ modo: "E", quantas: "3" })), "E");
  assert.match(tudo(n), /Quitando as últimas 3 parcelas depois das chaves hoje, você paga R\$ 2\.378,13/);
  assert.match(n, /data-acao="an-ultimas" checked/);
  assert.match(n, /id="ant-quantas"[^>]*value="3"/);
  assert.match(tudo(cartao(D.htmlAntecipacao(est(), ui({ modo: "E", quantas: "99" })), "E")), /quitar, de 1 a 24/);
  assert.match(tudo(cartao(D.htmlAntecipacao(est(), ui({ modo: "E", quantas: "x" })), "E")), /quitar, de 1 a 24/);
});

test("sem pós-chaves: E desabilitado com o motivo; sem balão em aberto: D desabilitado", () => {
  const h = D.htmlAntecipacao(est({ retrato: semPos() }), ui());
  assert.match(h, /data-modo="E"[^>]*disabled/);
  assert.match(h, /não tem parcelas depois das chaves/);
  const h2 = D.htmlAntecipacao(est({ retrato: semBalao() }), ui());
  assert.match(h2, /data-modo="D"[^>]*disabled/); assert.match(h2, /Não há balão em aberto/);
  assert.doesNotMatch(h2, /data-modo="B"[^>]*disabled/);
});

test("valor que não fecha ao centavo: frase simples e um botão por valor sugerido", () => {
  const r0 = A.simular(RET, { modo: "D", valor: 1334.17, dataPg: HOJE, parcelaId: BAL[0].id });
  assert.equal(r0.erro, "NAO_FECHA");   // 11% dos valores do jeito D são assim
  const d = cartao(D.htmlAntecipacao(est(), ui({ modo: "D", valor: "1.334,17" })), "D");
  assert.match(tudo(d), /Esse valor não fecha ao centavo; use R\$ 1\.334,18 ou R\$ 1\.334,16/);
  assert.match(d, /data-acao="an-usar" data-valor="1334.18"/);
  assert.match(d, /data-acao="an-usar" data-valor="1334.16"/);
  /* usar a sugestão fecha */
  const ok = D.htmlAntecipacao(est(), ui({ modo: "D", valor: "1.334,18" }));
  assert.doesNotMatch(cartao(ok, "D"), /não fecha ao centavo/);
});

test("parcela vencida fica de fora e a tela avisa para cobrar primeiro", () => {
  const r = structuredClone(RET);
  const p = r.parcelas.find((x) => !x.pago && x.tipo === "pre");
  p.data = "2026-10-05";
  const h = D.htmlAntecipacao(est({ retrato: r }), ui({ valor: "1.000,00" }));
  assert.match(tudo(h), /Há parcela vencida de R\$ 331,84 \(05\/10\)\. Ela fica fora da antecipação; cobre primeiro\./);
  assert.match(h, /class="cd-falta"/);
  assert.doesNotMatch(D.htmlAntecipacao(est(), ui({ valor: "1.000,00" })), /Há parcela vencida/);
});

test("data fora de hoje até o fim do mês: aviso, nenhum cartão", () => {
  for (const dataPg of ["2026-11-02", "2026-10-20", ""]) {
    const h = D.htmlAntecipacao(est(), ui({ valor: "30.000,00", dataPg }));
    assert.match(h, /de hoje \(21\/10\/2026\) até o fim do mês \(31\/10\/2026\)/, dataPg);
    assert.doesNotMatch(h, /an-modo/, dataPg);
  }
});

test("parcela por parcela: tabela que rola dentro do contêiner; centavo de ajuste só nas que o cliente não escolheu", () => {
  const h = D.htmlAntecipacao(est(), ui({ modo: "A", valor: "2.705,47", tabela: true }));
  assert.match(h, /<div style="overflow-x:auto"><table class="cd-fl">/);
  const linhas = [...h.matchAll(/<tr><td>(\d\d\/\d\d\/\d{4})<\/td><td>([^<]+)<\/td><td class="r">([^<]+)<\/td><td class="r">([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((m) => m.slice(1));
  assert.ok(linhas.length >= 3);
  const aj = linhas.filter((l) => l[4] === "ajuste de centavo");
  assert.equal(aj.length, 1);
  assert.deepEqual(aj[0].slice(0, 2), ["10/12/2026", "Pré-chaves"]);
  assert.equal(linhas.filter((l) => l[4] === "diminui").length, 1);   // a escolhida (divisa) não leva o rótulo
  assert.equal(linhas.filter((l) => l[3] === "quitada").length, linhas.filter((l) => l[4] === "paga agora").length);
  assert.match(h, /parcelas continuam como estão/);
  /* jeito B: todas foram escolhidas, nenhuma é "ajuste de centavo" */
  assert.doesNotMatch(D.htmlAntecipacao(est(), ui({ modo: "B", valor: "30.000,00", tabela: true })), /ajuste de centavo/);
  assert.match(D.htmlAntecipacao(est(), ui({ modo: "B", valor: "30.000,00", tabela: false })), /Ver parcela por parcela/);
  assert.doesNotMatch(D.htmlAntecipacao(est(), ui({ modo: "B", valor: "30.000,00", tabela: false })), /cd-fl/);
});

test("C: a divisa é a escolhida e o centavo vizinho leva o rótulo", () => {
  const h = D.htmlAntecipacao(est(), ui({ modo: "C", valor: "1.882,69", tabela: true }));
  assert.match(h, /<td>10\/11\/2028<\/td><td>Pós-chaves<\/td><td class="r">R\$ 792,71<\/td><td class="r">R\$ 792,70<\/td><td>ajuste de centavo<\/td>/);
});

test("PDF: botão só com o jeito escolhido calculado; travado em TESTES e enquanto gera", () => {
  const livre = D.htmlAntecipacao(est(), ui({ valor: "30.000,00" }));
  assert.match(livre, /data-acao="an-pdf"(?![^>]*disabled)[^>]*>Gerar PDF para o cliente/);
  assert.match(D.htmlAntecipacao(est(), ui()), /data-acao="an-pdf"[^>]*disabled/);
  assert.match(D.htmlAntecipacao(est(), ui({ valor: "30.000,00", testes: true })), /data-acao="an-pdf"[^>]*disabled/);
  assert.match(D.htmlAntecipacao(est(), ui({ valor: "30.000,00", testes: true })), /data-acao="an-ler"[^>]*disabled/);
  const gerando = D.htmlAntecipacao(est(), ui({ valor: "30.000,00", ocupado: "pdf" }));
  assert.match(gerando, /data-acao="an-pdf"[^>]*disabled/); assert.match(gerando, /gerando o PDF…/);
});

test("depois do PDF: texto do WhatsApp com Copiar; o link só aparece se o navegador bloqueou a janela", () => {
  const texto = "Simulação <b>x</b>\nlinha 2";
  const h = D.htmlAntecipacao(est(), ui({ valor: "30.000,00", pdf: { texto, url: "" } }));
  assert.match(h, /<textarea id="ant-texto" readonly[^>]*>Simulação &lt;b&gt;x&lt;\/b&gt;\nlinha 2<\/textarea>/);
  assert.match(h, /data-acao="an-copiar"/); assert.doesNotMatch(h, /Abrir o PDF/);
  const bloq = D.htmlAntecipacao(est(), ui({ valor: "30.000,00", pdf: { texto, url: "https://exemplo.invalid/p.pdf?x=1&y=2" } }));
  assert.match(bloq, /<a href="https:\/\/exemplo\.invalid\/p\.pdf\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">Abrir o PDF/);
  assert.doesNotMatch(D.htmlAntecipacao(est(), ui({ valor: "30.000,00", pdf: { texto, url: "javascript:alert(1)" } })), /Abrir o PDF/);
});

test("a parte de baixo (htmlAntResultado) não traz os campos de valor e data", () => {
  const r = D.htmlAntResultado(est(), ui({ valor: "30.000,00" }));
  assert.doesNotMatch(r, /id="ant-valor"|id="ant-data"/);
  assert.match(r, /data-modo="B"/);
});

test("mensagens dos erros do servidor", () => {
  const m = D.mensagemAnt;
  assert.match(m({ erro: "DATA_FORA_DO_MES" }), /entre hoje e o fim deste mês/);
  assert.match(m({ erro: "RETRATO_VELHO" }), /outro mês/);
  assert.match(m({ erro: "NAO_FECHA", sugestoes: [1] }), /não fecha ao centavo/);
  assert.match(m({ erro: "NAO_PODE", motivo: "Só venda do X" }), /Só venda do X/);
  assert.match(m({ erro: "RETRATO_PROCESSANDO" }), /já está em andamento/);
  assert.match(m({ erro: "SEM_RESPOSTA" }), /não respondeu/);
});
