/* Entrega 14 — tela: Recebimentos e conta digitada (venda-dossie.js, sem DOM), ordem/ocultos do painel da casa
 * (venda/painel-casa.js) e as ligações no vendas.html. Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");
const P = require("../painel-casa.js");
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendas = fs.readFileSync(path.join(RAIZ, "vendas.html"), "utf8");

const ITENS = [
  { id: "SINAL", rotulo: "Sinal", esperado: 10000, data: "2026-10-01", comprovantes: 1, por: "ana.teste", confirmado: true },
  { id: "ENTRADA", rotulo: "Entrada", esperado: 20000.5, data: "", comprovantes: 0, por: "", confirmado: false },
  { id: "FINANCIAMENTO", rotulo: "Financiamento", esperado: null, data: "", comprovantes: 0, por: "", confirmado: false },
];
const uir = (x = {}) => Object.assign({ ocupado: null, msg: "", testes: false, rascunho: {}, arquivos: {} }, x);
const botoes = (h) => h.match(/<button[^>]*data-acao="r-confirmar"[^>]*>[^<]*/g) || [];

test("Recebimentos: valor esperado, situação, data e comprovante por item; botão por item", () => {
  const h = D.htmlRecebimentos({ itens: ITENS, emailConfigurado: true }, uir());
  assert.match(h, /<div class="grp">Recebimentos<\/div>/);
  assert.match(h, /<b>Sinal<\/b> — valor esperado: <b>R\$\s10\.000,00<\/b>/);
  assert.match(h, /<b>Entrada<\/b> — valor esperado: <b>R\$\s20\.000,50<\/b>/);
  assert.match(h, /<b>Financiamento<\/b> — valor esperado: <i>sem valor no contrato<\/i>/);
  assert.match(h, /✓ Recebido em 01\/10\/2026<\/span> por ana\.teste · 1 comprovante/);
  assert.equal((h.match(/Aguardando confirmação/g) || []).length, 2);
  assert.match(h, /<input type="date" data-rec-data="SINAL" value="2026-10-01">/);
  assert.match(h, /<input type="file" accept="image\/jpeg,image\/png,image\/webp,application\/pdf" data-rec-arq="ENTRADA">/);
  const b = botoes(h);
  assert.equal(b.length, 3);
  assert.match(b[0], /data-item="SINAL">Confirmar de novo \(corrigir\)/);
  assert.match(b[1], /data-item="ENTRADA">Confirmar recebimento/);
  assert.doesNotMatch(h, /e-mail de aviso ainda não está configurado/);
});

test("Recebimentos: rascunho e arquivo escolhido sobrevivem ao redesenho; ocupado/TESTES travam; sem e-mail avisa", () => {
  const h = D.htmlRecebimentos({ itens: ITENS, emailConfigurado: false },
    uir({ rascunho: { ENTRADA: "2026-10-03" }, arquivos: { ENTRADA: { name: "comp<1>.pdf" } }, ocupado: "ENTRADA", msg: "Salvando <x>" }));
  assert.match(h, /data-rec-data="ENTRADA" value="2026-10-03" disabled/);
  assert.match(h, /escolhido: comp&lt;1&gt;\.pdf/);
  assert.match(h, /<b>salvando…<\/b>/);
  assert.ok(botoes(h).every((x) => /disabled/.test(x)));
  assert.match(h, /e-mail de aviso ainda não está configurado/);
  assert.match(h, /Salvando &lt;x&gt;/);
  const t = D.htmlRecebimentos({ itens: ITENS, emailConfigurado: true }, uir({ testes: true }));
  assert.match(t, /Perfil TESTES só consulta/);
  assert.ok(botoes(t).every((x) => /disabled/.test(x)));
  assert.match(D.htmlRecebimentos(null, uir({ msg: "A base não tem a coluna X" })), /<div class="vazio">A base não tem a coluna X<\/div>/);
});

test("Recebimentos: mensagens de sucesso, avisos de e-mail e erros", () => {
  assert.equal(D.mensagemRec({ ok: true, emails: 2 }, "Sinal"), "Recebimento do Sinal confirmado — e-mail de aviso enviado.");
  assert.match(D.mensagemRec({ ok: true, aviso: "EMAIL_NAO_CONFIGURADO" }, "Sinal"), /não está configurado \(RECEBIMENTO_EMAILS\)/);
  assert.match(D.mensagemRec({ ok: true, aviso: "EMAIL_FALHOU" }, "Entrada"), /^Recebimento do Entrada confirmado, mas o e-mail de aviso não saiu/);
  assert.match(D.mensagemRec({ ok: false, erro: "COMPROVANTE_OBRIGATORIO" }), /Escolha o comprovante/);
  assert.match(D.mensagemRec({ ok: false, erro: "COLUNA_FALTANDO: RECEBIMENTO - SINAL DATA" }), /A base não tem a coluna RECEBIMENTO - SINAL DATA/);
  assert.match(D.mensagemRec({ ok: false, erro: "ACAO_DESCONHECIDA" }), /ainda não foram ligados/);
});

test("conta digitada: caixa 'Operação (opcional)' entre agência e conta; só vai no pedido quando preenchida", () => {
  const conta = D.contaDoEstado({ opcoes: [], escolhida: { banco: "104", agencia: "5", operacao: "013", conta: "6-7", pix: "" }, padrao: "" });
  const h = D.htmlContrato({ gerado: false, conta }, { rascunho: {}, testes: false });
  assert.match(h, /Agência <input[^>]*data-conta-campo="agencia"[^>]*><\/label> <label class="dz-campo">Operação \(opcional\) <input[^>]*data-conta-campo="operacao" value="013"/);
  assert.deepEqual(D.contaDasEntradas({ banco: "1", agencia: "2", operacao: " ", conta: "3" }), { banco: "1", agencia: "2", conta: "3", pix: "" });
  assert.deepEqual(D.contaDasEntradas({ banco: "1", agencia: "2", operacao: "013", conta: "3" }), { banco: "1", agencia: "2", conta: "3", pix: "", operacao: "013" });
});

test("painel da casa: colunas técnicas ocultas (com acento/caixa/espaço diferentes); o resto aparece", () => {
  for (const n of ["ASSINATURA - ENVELOPE ID", "assinatura - situacao", "CONDOMÍNIO - VENDA ID", "MC - DISTRATO", "MC - SITUAÇÃO ",
                   "MC - VENDA ID", "DOSSIÊ IMÓVEL - OBSERVAÇÃO", "CONTRATO GERADO", "CONTRATO ASSINADO", "CONTRATO - COMISSÃO VENCIMENTO",
                   "RECEBIMENTO - SINAL COMPROVANTE", "RECEBIMENTO - FINANCIAMENTO POR"])
    assert.equal(P.ocultoNoPainel(n), true, n);
  for (const n of ["CONTRATO - COMISSÃO FORMA", "DOSSIÊ IMÓVEL", "COMPRADOR 1 - DOCUMENTO", "RECEBEU?", "CONTRATO - SINAL VALOR"])
    assert.equal(P.ocultoNoPainel(n), false, n);
});

test("painel da casa: comprador 1, comprador 2, pagamento/comissão e imóvel na ordem pedida; desconhecidas no fim", () => {
  const embaralhado = ["AVALIAÇÃO", "CONTRATO - CONDIÇÕES ESPECIAIS", "COMPRADOR 2 - ENDEREÇO", "CONTRATO - ALVARÁ DATA", "COMPRADOR 1 - E-MAIL",
    "CONTRATO - COMISSÃO PAGA POR", "COMPRADOR 2 - NOME", "CONTRATO - SINAL DATA", "COMPRADOR 1 - DOCUMENTO", "CONTRATO - SINAL VALOR",
    "CONTRATO - HABITE-SE DATA", "CONTRATO - ALVARÁ Nº", "COMPRADOR 2 - CPF", "COMPRADOR 1 - ESTADO CIVIL", "TIPO", "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO",
    "COMPRADOR 1 - NACIONALIDADE", "CONTRATO - ENTRADA VALOR", "CONTRATO - MATRÍCULA INDIVIDUAL", "CONTRATO - FORMA DE PAGAMENTO"];
  assert.deepEqual(P.ordenar(embaralhado), [
    "COMPRADOR 1 - DOCUMENTO", "COMPRADOR 1 - NACIONALIDADE", "COMPRADOR 1 - ESTADO CIVIL", "COMPRADOR 1 - E-MAIL",
    "COMPRADOR 2 - NOME", "COMPRADOR 2 - CPF", "COMPRADOR 2 - ENDEREÇO",
    "CONTRATO - SINAL VALOR", "CONTRATO - SINAL DATA", "CONTRATO - ENTRADA VALOR", "CONTRATO - FORMA DE PAGAMENTO", "CONTRATO - COMISSÃO PAGA POR",
    "CONTRATO - MATRÍCULA INDIVIDUAL", "CONTRATO - ALVARÁ Nº", "CONTRATO - ALVARÁ DATA", "CONTRATO - HABITE-SE DATA",
    "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO", "CONTRATO - CONDIÇÕES ESPECIAIS",
    "AVALIAÇÃO", "TIPO"]);
  assert.equal(P.grupoDoCampo("comprador 2 - profissao"), "Comprador 2");
  assert.equal(P.grupoDoCampo("CONTRATO - CRI DA MATRÍCULA"), "Contrato — imóvel");
  assert.equal(P.grupoDoCampo("AVALIAÇÃO"), "");
  assert.deepEqual(P.ordenarArquivos(["APROVAÇÃO DA CAIXA", "COMPRADOR 2 - IDENTIDADE", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "COMPRADOR 1 - IDENTIDADE"]),
    ["COMPRADOR 1 - IDENTIDADE", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "COMPRADOR 2 - IDENTIDADE", "APROVAÇÃO DA CAIXA"]);
});

test("vendas.html: carrega painel-casa.js antes do venda-dossie.js, esconde no painel, agrupa e recarrega no evento", () => {
  const iP = vendas.indexOf('src="venda/painel-casa.js'), iD = vendas.indexOf('src="venda-dossie.js');
  assert.ok(iP > 0 && iD > iP);
  assert.match(vendas, /if\(ondeEstou==="painel" && ocultoNoPainelCasa\(nome\)\) return true;/);
  assert.match(vendas, /window\.PainelCasa\.ordenar\(ord\)/);
  assert.match(vendas, /const grupo=grupoNoPainelCasa\(nome\)\|\|"Preenchimento";/);
  assert.match(vendas, /window\.addEventListener\("venda:dados-gravados", ev=>\{/);
  const rec = vendas.slice(vendas.indexOf("async function recarregarCamposCasa(pageId){"), vendas.indexOf("function cabecalhoObra(V){"));
  assert.match(rec, /ler\(\{action:"obra",pageId:pageId\}\)/, "busca a casa sem chave de cache");
  assert.match(rec, /renderPainel\(V,pageId,false\)/);
  assert.doesNotMatch(rec, /classList\.remove\("on"\)/, "não fecha o painel");
  const dossie = fs.readFileSync(path.join(RAIZ, "venda-dossie.js"), "utf8");
  assert.match(dossie, /new CustomEvent\("venda:dados-gravados", \{ detail: \{ pageId: pageId \} \}\)/);
  assert.match(dossie, /criarBlocosVenda\(id, function \(b\) \{ return blocosCasa === b && obraAberta\(\) === id; \}, \{ recebimentos: true \}\)/);
});
