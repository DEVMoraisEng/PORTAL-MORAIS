/* Bloco "Mais Controle" da tela (htmlMC). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const D = createRequire(import.meta.url)("../../venda-dossie.js");
const ui = (x = {}) => Object.assign({ ocupado: null, msg: "", testes: false }, x);
const botao = (h, acao) => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"[^>]*>')) || [null])[0];

test("sem estado: carregando", () => {
  assert.match(D.htmlMC(null, ui()), /carregando/);
});

test("nunca lançada: prévia liberada, lançar travado", () => {
  const h = D.htmlMC({ situacao: "", vendaId: "" }, ui());
  assert.match(h, /ainda não lançada/);
  assert.doesNotMatch(botao(h, "mc-previa"), /disabled/);
  assert.match(botao(h, "mc-lancar"), /disabled/);
});

test("PRÉVIA OK libera o lançar", () => {
  const h = D.htmlMC({ situacao: "PRÉVIA OK — cliente já existe", vendaId: "" }, ui());
  assert.doesNotMatch(botao(h, "mc-lancar"), /disabled/);
});

test("processando trava os dois e avisa; atualizar continua", () => {
  const h = D.htmlMC({ situacao: "PROCESSANDO (prévia) — 06/10", vendaId: "" }, ui());
  assert.match(botao(h, "mc-previa"), /disabled/);
  assert.match(botao(h, "mc-lancar"), /disabled/);
  assert.doesNotMatch(botao(h, "mc-atualizar"), /disabled/);
  assert.match(h, /robô está trabalhando/);
});

test("lançada: mostra o id e some com prévia/lançar", () => {
  const h = D.htmlMC({ situacao: "CRIADA no Mais Controle", vendaId: "v-1" }, ui());
  assert.match(h, /Venda no Mais Controle: v-1/);
  assert.equal(botao(h, "mc-previa"), null);
  assert.equal(botao(h, "mc-lancar"), null);
});

test("perfil TESTES não aciona; texto escapado", () => {
  const h = D.htmlMC({ situacao: "PRÉVIA OK <b>x</b>", vendaId: "" }, ui({ testes: true }));
  assert.match(botao(h, "mc-previa"), /disabled/);
  assert.match(h, /&lt;b&gt;x/);
});

test("mensagens por código", () => {
  assert.match(D.mensagemMC({ erro: "MC_SEM_PREVIA" }), /prévia primeiro/);
  assert.match(D.mensagemMC({ erro: "MC_NAO_CONFIGURADO" }), /não está configurado/);
});

test("PROCESSANDO vencido libera os botões e esconde o carimbo", () => {
  const agora = 2000000000000;
  const h = D.htmlMC({ situacao: "PROCESSANDO (prévia) — 06/10 01:00 [t=" + (agora - 16 * 60000) + "]", vendaId: "" }, ui({ agora }));
  assert.doesNotMatch(botao(h, "mc-previa"), /disabled/);
  assert.doesNotMatch(h, /\[t=/);
  const h2 = D.htmlMC({ situacao: "PROCESSANDO (prévia) [t=" + (agora - 60000) + "]", vendaId: "" }, ui({ agora }));
  assert.match(botao(h2, "mc-previa"), /disabled/);
});

test("CRIADA em linhas: cabeçalho + tópicos e link para abrir no Mais Controle (nova aba)", () => {
  const sit = ["CRIADA | venda v-9", "Cliente: COMPRADOR EXEMPLO (criado agora)", "Parcelas: 3 (sinal, financiamento, FGTS)",
               "Total: R$ 200.000,00", "Contrato: anexado no recebimento"].join("\n");
  const h = D.htmlMC({ situacao: sit, vendaId: "v-9" }, ui());
  assert.match(h, /Situação: <b>CRIADA \| venda v-9<\/b>/);
  assert.match(h, /<ul class="mc-topicos"><li>Cliente: COMPRADOR EXEMPLO \(criado agora\)<\/li><li>Parcelas: 3/);
  assert.match(h, /<li>Contrato: anexado no recebimento<\/li><\/ul>/);
  const a = (h.match(/<a [^>]*class="mc-abrir"[^>]*>[^<]*<\/a>/) || [""])[0];
  assert.match(a, /href="https:\/\/acessar\.maiscontroleerp\.com\.br\/#\/readjustment-sale\/edit\/v-9"/);
  assert.match(a, /target="_blank"/);
  assert.match(a, /rel="noopener noreferrer"/);
  assert.match(a, />Abrir no Mais Controle</);
});

test("sem venda id não há link; id com caractere estranho vai codificado", () => {
  assert.doesNotMatch(D.htmlMC({ situacao: "PRÉVIA OK", vendaId: "" }, ui()), /mc-abrir/);
  assert.match(D.htmlMC({ situacao: "CRIADA", vendaId: "a\"b" }, ui()), /edit\/a%22b"/);
});

test("prévia em tópicos: esconde o carimbo, detalhe das parcelas como subtópico, Lançar libera", () => {
  const sit = "PRÉVIA OK [#0a1b2c3d] | VENDA CASA 02\nCliente: COMPRADOR EXEMPLO (já existe)\nParcelas: 2 (sinal, financiamento)\n" +
              "- Sinal R$ 5000.00 em 2026-10-10\n- Financiamento R$ 195000.00 em 2026-11-09\nTotal: R$ 200.000,00";
  const h = D.htmlMC({ situacao: sit, vendaId: "" }, ui());
  assert.doesNotMatch(h, /0a1b2c3d/);
  assert.match(h, /Situação: <b>PRÉVIA OK \| VENDA CASA 02<\/b>/);
  assert.match(h, /<li class="mc-sub">Sinal R\$ 5000\.00 em 2026-10-10<\/li>/);
  assert.doesNotMatch(botao(h, "mc-lancar"), /disabled/);
});

test("texto antigo numa linha só também vira tópicos", () => {
  const t = D.topicosMC("CRIADA no Mais Controle (venda v-1); contrato anexado no recebimento — Sinal R$ 1.00 em 2026-01-01; FGTS R$ 2.00 em 2026-02-01");
  assert.equal(t.titulo, "CRIADA no Mais Controle (venda v-1); contrato anexado no recebimento");
  assert.deepEqual(t.itens.map((x) => x.texto), ["Sinal R$ 1.00 em 2026-01-01", "FGTS R$ 2.00 em 2026-02-01"]);
  assert.deepEqual(D.topicosMC("RECUSADA: falta X; falta Y"), { titulo: "RECUSADA: falta X; falta Y", itens: [] });
});

/* ---- 03/11/2026: contrato não anexado / ZIP não enviado — botão que pede de novo ao robô (ação mcAnexar) ---- */
test("venda lançada com 'Contrato: não anexado' mostra o botão Anexar contrato; anexado, não", () => {
  const sit = "CRIADA | venda v-9\nParcelas: 3\nContrato: não anexado (coluna CONTRATO ASSINADO vazia)";
  const h = D.htmlMC({ situacao: sit, vendaId: "v-9" }, ui());
  const b = botao(h, "mc-anexar");
  assert.ok(b, h);
  assert.doesNotMatch(b, /disabled/);
  assert.match(h, /data-acao="mc-anexar"[^>]*>Anexar contrato no Mais Controle</);
  assert.equal(botao(D.htmlMC({ situacao: "CRIADA | venda v-9\nContrato: anexado no recebimento", vendaId: "v-9" }, ui()), "mc-anexar"), null);
  assert.equal(botao(D.htmlMC({ situacao: "PRÉVIA OK\nContrato: não anexado", vendaId: "" }, ui()), "mc-anexar"), null, "sem venda não há onde anexar");
  assert.match(botao(D.htmlMC({ situacao: sit, vendaId: "v-9" }, ui({ testes: true })), "mc-anexar"), /disabled/);
  assert.match(botao(D.htmlMC({ situacao: sit, vendaId: "v-9" }, ui({ ocupado: "mc-anexar" })), "mc-anexar"), /disabled/);
});

test("ZIP não enviado mostra 'Enviar ZIP ao Mais Controle'; enviado ou só pedido, não", () => {
  const h = D.htmlMC({ situacao: "CRIADA | venda v-9\nContrato: anexado no recebimento\nContratos (ZIP): não enviado (a pasta Contratos Venda não existe)", vendaId: "v-9" }, ui());
  assert.match(h, /data-acao="mc-anexar-zip"[^>]*>Enviar ZIP ao Mais Controle</);
  assert.equal(botao(h, "mc-anexar"), null);
  assert.equal(botao(D.htmlMC({ situacao: "CRIADA\nContratos (ZIP): enviado para Orçamento > Arquivos > Contratos Venda", vendaId: "v-9" }, ui()), "mc-anexar-zip"), null);
  assert.equal(botao(D.htmlMC({ situacao: "CRIADA\nContratos (ZIP): guardado no Notion, envio pedido ao robô em 03/11 10:00", vendaId: "v-9" }, ui()), "mc-anexar-zip"), null);
});

test("mensagens do anexo", () => {
  assert.match(D.mensagemMC({ erro: "MC_SEM_VENDA" }), /ainda não foi lançada/);
  assert.match(D.mensagemMC({ erro: "MC_ANEXOS_SEM_FILA" }), /robô do servidor/);
  assert.match(D.mensagemMC({ erro: "MC_SEM_ZIP" }), /ZIP/);
});

test("NÃO pedido ao robô também oferece o botão; ZIP grande não (só à mão)", () => {
  assert.ok(botao(D.htmlMC({ situacao: "CRIADA | venda v-9\nContrato: NÃO pedido ao robô (x) — use o botão", vendaId: "v-9" }, ui()), "mc-anexar"));
  assert.ok(botao(D.htmlMC({ situacao: "CRIADA\nContratos (ZIP): não gerado em 24 h — use o botão Enviar ZIP", vendaId: "v-9" }, ui()), "mc-anexar-zip"));
  assert.ok(botao(D.htmlMC({ situacao: "ainda não lançada\nContratos (ZIP): guardado no Notion (2 documentos), NÃO pedido ao robô (y) — use o botão", vendaId: "" }, ui()), "mc-anexar-zip"));
  assert.equal(botao(D.htmlMC({ situacao: "CRIADA\nContratos (ZIP): ZIP grande (mais de 20 MB): envie à mão para a pasta Contratos Venda", vendaId: "v-9" }, ui()), "mc-anexar-zip"), null);
});

/* 03/11/2026 (casa 31): o robô antigo recusou o pedido e a situação ficou "pedido ao robô" — o botão some para sempre */
test("pedido ao robô parado há mais de 10 minutos libera o botão de novo (contrato e ZIP)", () => {
  const sit = "CRIADA | venda v1\nContrato: pedido ao robô em 03/11 14:22\nContratos (ZIP): pedido ao robô em 03/11 14:22";
  assert.equal(D.pedidoParado(sit, "Contrato", "2026-11-03T14:40:00"), true);
  assert.equal(D.pedidoParado(sit, "Contrato", "2026-11-03T14:28:00"), false, "6 minutos: ainda espera o robô");
  assert.equal(D.pedidoParado(sit, "Contratos (ZIP)","2026-11-03T14:40:00"), true);
  assert.equal(D.pedidoParado("Contrato: anexado no recebimento", "Contrato", "2026-11-03T14:40:00"), false);
  assert.equal(D.pedidoParado("Contrato: pedido ao robô em 31/12 23:55", "Contrato", "2027-01-01T00:20:00"), true, "virada de ano");
  const h = D.htmlMC({ situacao: "CRIADA | venda v1\nContrato: pedido ao robô em 01/01 00:00", vendaId: "v1" }, ui());
  assert.ok(botao(h, "mc-anexar"), "botão de volta");
});
