/* Recebimentos v2 — tela (venda-dossie.js, sem DOM): vários pagamentos, falta/sobra, valor esperado editável, outros,
 * contrato de financiamento, situação no Mais Controle e coluna faltando só no item (05/11/2026).
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const D = createRequire(import.meta.url)("../../venda-dossie.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fonte = fs.readFileSync(path.join(RAIZ, "venda-dossie.js"), "utf8");

const uir = (x = {}) => Object.assign({ ocupado: null, msg: "", testes: false, rascunho: {}, arquivos: {}, valores: {}, esperados: {},
                                         editando: null, novo: {}, finMsg: "" }, x);
const SINAL = { id: "SINAL", rotulo: "Sinal", esperado: 5000, editavel: true, baixaMC: true, modo: "lista", soma: 3000, falta: 2000,
                situacao: "PARCIAL", aceitaArquivo: true, comprovantes: 1, confirmado: false,
                pagamentos: [{ id: "a1b2c3d4", data: "2026-11-02", valor: 3000, por: "ana.teste", arquivo: "Sinal a1b2c3d4 - c.pdf",
                               mc: { situacao: "BAIXADO", texto: "baixado no Mais Controle em 02/11/2026 (conta do comprovante)" } },
                             { id: "e5f6a7b8", data: "2026-11-04", valor: 2500, por: "ana.teste", arquivo: "", mc: null }],
                mc: { situacao: "BAIXADO", texto: "baixado no Mais Controle (1 pagamento(s))" } };
const FGTS = { id: "FGTS", rotulo: "FGTS", esperado: null, editavel: true, modo: "", erro: "COLUNA_FALTANDO: RECEBIMENTO - FGTS PAGAMENTOS", pagamentos: [] };
const OUTRO = { id: "OUTRO:0a0b0c0d", outro: "0a0b0c0d", rotulo: "Cartório", esperado: 1200, editavel: true, modo: "lista", soma: 1500, falta: -300,
                situacao: "SOBRA", aceitaArquivo: true, pagamentos: [{ id: "11aa22bb", data: "2026-11-01", valor: 700 }, { id: "33cc44dd", data: "2026-11-03", valor: 800 }] };
const E = (x = {}) => Object.assign({ itens: [SINAL, FGTS], outros: [OUTRO], outrosColuna: true, contratoFin: { coluna: true, arquivos: 0 },
                                      vendaLancada: true, filaLigada: true, mc: { situacao: "OK", texto: "conferido com o Mais Controle", em: "2026-11-05 10:00" },
                                      emailConfigurado: true }, x);

test("vários pagamentos: falta, lista com situação do MC, baixado sem botão Tirar e campo de valor com o que falta", () => {
  const h = D.htmlRecebimentos(E(), uir());
  assert.match(h, /<span class="rec-parc">Recebido R\$\s3\.000,00 em 2 pagamentos — falta R\$\s2\.000,00<\/span>/);
  assert.match(h, /02\/11\/2026 · R\$\s3\.000,00 · por ana\.teste · com comprovante · <span class="rec-mc-p">baixado no Mais Controle em 02\/11\/2026/);
  assert.equal((h.match(/data-acao="r-remover" data-item="SINAL" data-pag="a1b2c3d4"/g) || []).length, 0, "baixado no MC não sai");
  assert.match(h, /data-acao="r-remover" data-item="SINAL" data-pag="e5f6a7b8"/);
  assert.match(h, /data-rec-valor="SINAL" value="" placeholder="2\.000,00"/);
  assert.match(h, /data-acao="r-confirmar" data-item="SINAL">Registrar outro pagamento/);
  assert.match(h, /Mais Controle: baixado no Mais Controle \(1 pagamento\(s\)\)/);
});

test("coluna faltando fica só no item; sobra aparece; outro recebimento e contrato de financiamento têm seus campos", () => {
  const h = D.htmlRecebimentos(E(), uir());
  assert.match(h, /<b>FGTS<\/b>[\s\S]*A base não tem a coluna RECEBIMENTO - FGTS PAGAMENTOS[\s\S]*este item não grava/);
  assert.doesNotMatch(h, /data-item="FGTS">Confirmar/);
  assert.match(h, /<span class="rec-sobra">Recebido R\$\s1\.500,00 — passa R\$\s300,00 do esperado<\/span>/);
  assert.match(h, /data-acao="r-confirmar" data-item="OUTRO:0a0b0c0d"/);
  assert.match(h, /data-rec-novo="rotulo"/);
  assert.match(h, /data-acao="r-novo"/);
  assert.match(h, /<b>Contrato de financiamento<\/b> — nenhum arquivo/);
  assert.match(h, /data-rec-arq="FIN"/);
  assert.match(h, /data-acao="r-fin">Ler e atualizar os valores/);
  assert.match(h, /<b>Mais Controle<\/b> — conferido no Mais Controle \(2026-11-05 10:00\)/);
  assert.match(h, /data-acao="r-mc">Conferir no Mais Controle/);
});

test("mudar valor esperado: botão, campo com o valor atual e nota do robô só para sinal/financiamento/FGTS", () => {
  let h = D.htmlRecebimentos(E(), uir());
  assert.match(h, /data-acao="r-editar" data-item="SINAL">Mudar valor/);
  h = D.htmlRecebimentos(E(), uir({ editando: "SINAL" }));
  assert.match(h, /data-rec-esp="SINAL" value="5\.000,00"/);
  assert.match(h, /data-acao="r-valor" data-item="SINAL">Salvar valor<\/button> <small class="rec-arq">o robô acerta a parcela no Mais Controle/);
  h = D.htmlRecebimentos(E(), uir({ editando: "OUTRO:0a0b0c0d", esperados: { "OUTRO:0a0b0c0d": "9,99" } }));
  assert.match(h, /data-rec-esp="OUTRO:0a0b0c0d" value="9,99"/);
  assert.doesNotMatch(h, /data-item="OUTRO:0a0b0c0d">Salvar valor<\/button> <small/);
});

test("TESTES e ocupado travam tudo; sem fila o Conferir fica desligado; venda não lançada avisa", () => {
  const t = D.htmlRecebimentos(E(), uir({ testes: true }));
  assert.ok((t.match(/<button[^>]*>/g) || []).every((b) => /disabled/.test(b)));
  const s = D.htmlRecebimentos(E({ filaLigada: false }), uir());
  assert.match(s, /data-acao="r-mc" disabled/);
  const n = D.htmlRecebimentos(E({ vendaLancada: false, mc: null }), uir());
  assert.match(n, /A venda ainda não foi lançada no Mais Controle/);
  assert.doesNotMatch(n, /data-acao="r-mc"/);
});

test("mensagens: pedido ao robô e erros novos", () => {
  assert.match(D.mensagemRec({ ok: true, mcPedido: "NA_FILA" }, "Sinal"), /confirmado\. O robô vai conferir no Mais Controle/);
  assert.match(D.mensagemRec({ ok: true, mcPedido: "SEM_VENDA" }, "Sinal"), /a baixa sai depois do lançamento/);
  assert.equal(D.mensagemRec({ ok: true }, "Sinal"), "Recebimento do Sinal confirmado.");
  assert.match(D.mensagemRec({ ok: false, erro: "JA_BAIXADO_NO_MC" }), /já foi baixado no Mais Controle/);
  assert.match(D.mensagemRec({ ok: false, erro: "VALOR_INVALIDO" }), /Informe o valor/);
  assert.equal(D.textoMC({ situacao: "RECUSADO", texto: "passa do que falta" }), "recusado: passa do que falta");
  assert.equal(D.textoMC({ situacao: "PROCESSANDO", texto: "pedido na fila" }), "robô trabalhando…: pedido na fila");
  assert.equal(D.textoMC(null), "");
});

test("ligações: as ações novas chegam aos tratadores e o acompanhamento para ao fechar", () => {
  for (const a of ["r-remover", "r-editar", "r-valor", "r-novo", "r-fin", "r-mc"])
    assert.ok(fonte.includes('if (acao === "' + a + '")'), a);
  for (const f of ["recebimentoRemover", "recebimentoValor", "recebimentoLerContratoFin", "recebimentoMC"])
    assert.ok(fonte.includes('action: "' + f + '"'), f);
  assert.match(fonte, /if \(esperaR\) clearTimeout\(esperaR\); esperaR = null;/);
});
