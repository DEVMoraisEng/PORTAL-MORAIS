/* Entrega 13 (tela): "Soltar todos os documentos", "Ler documentos", Anexar sem ler e o evento
 * venda:dados-gravados. Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../../venda-dossie.js");

const base = { tipoCasa: "CASA PRONTA", arquivos: { C1_IDENTIDADE: 1, C1_COMPROVANTE: 1, C2_IDENTIDADE: 0, C2_COMPROVANTE: 0, APROVACAO: 0 },
               dossie: "", observacao: "", doisCompradores: true, pendentes: ["C1_IDENTIDADE", "IMOVEL_ALVARA"],
               imovel: { arquivos: { IMOVEL_MATRICULA: 0, IMOVEL_ALVARA: 1, IMOVEL_HABITESE: 0, IMOVEL_CERTIDAO_MAE: 0 }, dossie: "", observacao: "",
                         dados: {}, semColunas: [] } };
const ui = (x = {}) => Object.assign({ dois: true, ocupado: null, msg: "" }, x);
const botao = (h, acao, extra = "") => (h.match(new RegExp('<button[^>]*data-acao="' + acao + '"' + extra + '[^>]*>')) || [null])[0];

/* um envio com dois RGs (um de cada comprador), um comprovante de parente, um alvará e um desconhecido */
const envio = () => ({ pessoas: {}, arquivos: [
  { id: "s1", nome: "rg-a.pdf", estado: "pessoa", tipo: "IDENTIDADE", pessoa: { nome: "ANA TESTE", chave: "kA" }, sugestao: "C1" },
  { id: "s2", nome: "rg-b.pdf", estado: "pessoa", tipo: "IDENTIDADE", pessoa: { nome: "BRUNO TESTE", chave: "kB" }, sugestao: "C2" },
  { id: "s3", nome: "luz.pdf", estado: "pessoa", tipo: "COMPROVANTE", pessoa: { nome: "MARIA PARENTE", chave: "kM" }, sugestao: "" },
  { id: "s4", nome: "alvara.pdf", estado: "guardado", tipo: "ALVARA", espaco: "IMOVEL_ALVARA" },
  { id: "s5", nome: "foto.jpg", estado: "desconhecido", tipo: "OUTRO" },
] });

test("anexar sem ler: cada espaço tem Anexar/Trocar/Ler de novo e marca o que é novo", () => {
  const h = D.html(base, ui());
  assert.match(h, /data-acao="anexar" data-espaco="C1_IDENTIDADE"/);
  assert.doesNotMatch(h, /data-acao="enviar"/, "o Enviar e ler saiu da tela");
  assert.match(h, /identidade \(CNH ou RG\) <small>1 arquivo<\/small> <small class="dz-novo">novo, não lido/);
  assert.equal((h.match(/data-acao="ler-todos"/g) || []).length, 2, "no topo e no fim do imóvel");
  assert.match(botao(h, "ler-todos"), /data-onde="topo"/);
  assert.match(h, />Ler documentos \(2 novos\)</);
  assert.doesNotMatch(botao(h, "ler-todos"), /disabled/);
  const nada = D.html(Object.assign({}, base, { pendentes: [] }), ui());
  assert.match(botao(nada, "ler-todos"), /disabled/);
  assert.match(D.html(base, ui({ testes: true })).match(/<button[^>]*data-acao="ler-todos"[^>]*>/)[0], /disabled/);
});

test("comprador 2: 'Usar o mesmo do comprador 1' só com comprovante do 1", () => {
  assert.doesNotMatch(botao(D.html(base, ui()), "copiar-comprovante"), /disabled/);
  const sem = D.html(Object.assign({}, base, { arquivos: Object.assign({}, base.arquivos, { C1_COMPROVANTE: 0 }) }), ui());
  assert.match(botao(sem, "copiar-comprovante"), /disabled/);
  assert.equal(botao(D.html(base, ui({ dois: false })), "copiar-comprovante"), null);
});

test("certidão mãe aparece com a coluna e some sem ela; dados mostram data do habite-se e o registro do loteamento", () => {
  assert.match(D.html(base, ui()), /data-espaco="IMOVEL_CERTIDAO_MAE"/);
  const sem = Object.assign({}, base, { imovel: Object.assign({}, base.imovel, { semColunas: ["IMÓVEL - CERTIDÃO MÃE"] }) });
  assert.doesNotMatch(D.html(sem, ui()), /IMOVEL_CERTIDAO_MAE/);
  const dados = D.dadosImovel({ habiteseNumero: "H-1", habiteseData: "2026-09-20", loteamentoDenominacao: "RESIDENCIAL EXEMPLO", loteamentoMatricula: "55.555" });
  assert.deepEqual(dados, [["Habite-se", "nº H-1 de 20/09/2026"], ["Condomínio/loteamento", "RESIDENCIAL EXEMPLO"], ["Matrícula-mãe", "55.555"]]);
});

test("resultado do Ler documentos por documento e o evento venda:dados-gravados", () => {
  const r = { ok: true, pageId: "p", gravados: { "CONTRATO - HABITE-SE DATA": "2026-09-20" }, resultados: [
    { espaco: "C1_IDENTIDADE", ok: true, preenchidos: ["A", "B"], observacoes: [] },
    { espaco: "IMOVEL_HABITESE", ok: false, erro: "API_OVERLOADED_ERROR" }] };
  const linhas = D.resultadosLote(r);
  assert.equal(linhas[0].texto, "Identidade do comprador 1: 2 campos preenchidos");
  assert.match(linhas[1].texto, /^Habite-se: não lido — a leitura falhou \(API_OVERLOADED_ERROR\)\. Continua como novo/);
  assert.equal(D.resumoLote(r), "Lidos 1 de 2 documentos. Confira os dados e marque Conferido.");
  assert.equal(D.EVENTO_GRAVADO, "venda:dados-gravados");
  assert.deepEqual(D.detalheGravado("p", r), { pageId: "p", gravados: r.gravados });
  assert.deepEqual(D.detalheGravado("p", { ok: true }), { pageId: "p" });
  const h = D.html(base, ui({ msgGrupo: "lote-topo", msg: "Lidos 1 de 2 documentos.", resultados: linhas }));
  assert.match(h, /<li class="dz-ok">Identidade do comprador 1: 2 campos preenchidos<\/li>/);
});

test("soltar todos: área com o botão; travada sem tipo de casa e no perfil TESTES", () => {
  const h = D.htmlSoltar(base, ui());
  assert.match(h, /Soltar todos os documentos aqui/);
  assert.match(h, /data-soltar/);
  assert.doesNotMatch(botao(h, "soltar-escolher"), /disabled/);
  assert.match(botao(D.htmlSoltar(Object.assign({}, base, { tipoCasa: "" }), ui()), "soltar-escolher"), /disabled/);
  assert.match(botao(D.htmlSoltar(base, ui({ testes: true })), "soltar-escolher"), /disabled/);
  assert.match(D.html(base, ui()), /Soltar todos os documentos aqui/);
});

test("soltar todos: pergunta quem é quem (pré-selecionado pela venda) e não confirma com escolha faltando", () => {
  const s = envio();
  const pessoas = D.pessoasDoEnvio(s);
  assert.deepEqual(pessoas.map((p) => [p.nome, p.escolha]), [["ANA TESTE", "C1"], ["BRUNO TESTE", "C2"], ["MARIA PARENTE", ""]]);
  const h = D.htmlSoltar(base, ui({ soltar: s }));
  assert.match(h, /Encontrei documentos de: ANA TESTE, BRUNO TESTE, MARIA PARENTE/);
  assert.match(h, /<select data-pessoa="kA"><option value="">— escolha —<\/option><option value="C1" selected>Comprador 1/);
  assert.match(h, /alvara\.pdf → alvará → guardado em Alvará/);
  assert.match(h, /<select data-arquivo="s5">/);
  assert.match(h, /Não é comprador/);
  assert.match(D.conferirEscolhas(s), /MARIA PARENTE/);
  assert.match(botao(h, "soltar-confirmar"), /disabled/);
  s.pessoas.kM = "C1";            // comprovante da mãe da Ana: vale como comprovante do comprador 1
  assert.match(D.conferirEscolhas(s), /foto\.jpg/);
  s.arquivos[4].escolha = "IGNORAR";
  assert.equal(D.conferirEscolhas(s), "");
  assert.doesNotMatch(botao(D.htmlSoltar(base, ui({ soltar: s })), "soltar-confirmar"), /disabled/);
  assert.deepEqual(D.destinosDoEnvio(s), [{ id: "s1", espaco: "C1_IDENTIDADE" }, { id: "s2", espaco: "C2_IDENTIDADE" }, { id: "s3", espaco: "C1_COMPROVANTE" }]);
  /* o dono troca: a Ana é a compradora 2 e o Bruno o 1 */
  s.pessoas.kA = "C2"; s.pessoas.kB = "C1";
  assert.deepEqual(D.destinosDoEnvio(s).slice(0, 2), [{ id: "s1", espaco: "C2_IDENTIDADE" }, { id: "s2", espaco: "C1_IDENTIDADE" }]);
  /* duas pessoas com identidade como Comprador 1: não deixa confirmar */
  s.pessoas.kA = "C1";
  assert.match(D.conferirEscolhas(s), /Duas pessoas como Comprador 1/);
  /* "Não é comprador": os arquivos dela não são guardados; desconhecido escolhido vai para o espaço */
  s.pessoas.kA = "NAO"; s.arquivos[4].escolha = "APROVACAO";
  assert.deepEqual(D.destinosDoEnvio(s), [{ id: "s2", espaco: "C1_IDENTIDADE" }, { id: "s3", espaco: "C1_COMPROVANTE" }, { id: "s5", espaco: "APROVACAO" }]);
});

test("soltar todos: resultado por arquivo depois da leitura", () => {
  const por = D.resultadoPorEspaco({ resultados: [{ espaco: "IMOVEL_ALVARA", ok: true, preenchidos: ["X", "Y"] }, { espaco: "C1_IDENTIDADE", ok: false, erro: "SEM_ARQUIVO" }] });
  assert.equal(por.IMOVEL_ALVARA, "2 campos preenchidos");
  assert.match(por.C1_IDENTIDADE, /^não lido/);
  const s = envio(); s.arquivos[3].resultado = por.IMOVEL_ALVARA;
  assert.match(D.htmlSoltar(base, ui({ soltar: s })), /alvara\.pdf → alvará → guardado em Alvará → 2 campos preenchidos/);
});
