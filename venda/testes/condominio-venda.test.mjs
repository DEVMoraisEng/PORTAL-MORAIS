/* CondominioVenda (regras puras do "Gerar venda" do condomínio).
 * Só dados inventados — o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { P, SCHEMA_VENDAS, linhaCondominio } from "./condominio-dados.mjs";
const C = createRequire(import.meta.url)("../CondominioVenda.js");

test("mapear: proponente, segundo comprador e valores da venda", () => {
  const m = C.mapear(linhaCondominio(), SCHEMA_VENDAS);
  assert.equal(m["ENDEREÇO"], "CONDOMÍNIO RESERVA DE TESTE");
  assert.equal(m["CASA"], 12);
  assert.equal(m["CLIENTES"], "ANA TESTE E BRUNO TESTE");
  assert.equal(m["CPF"], "529.982.247-25");
  assert.equal(m["Email"], "ana@exemplo.test");
  assert.equal(m["COMPRADOR 1 - E-MAIL"], "ana@exemplo.test");
  assert.equal(m["Nº Whatsapp"], "62 90000-0000");
  assert.equal(m["COMPRADOR 1 - ESTADO CIVIL"], "CASADA");
  assert.equal(m["COMPRADOR 1 - PROFISSÃO"], "ANALISTA", "PROFISSÃO PROPONENTE tem espaço sobrando no nome");
  assert.equal(m["COMPRADOR 1 - DOCUMENTO"], "RG 1234567 SSP/GO");
  assert.equal(m["COMPRADOR 1 - ENDEREÇO"], "RUA DO CLIENTE, 20 - SETOR DO CLIENTE - CIDADE DO CLIENTE", "endereço do proponente = ENDEREÇO/NÚMERO/SETOR/CIDADE da pasta");
  assert.equal(m["TIPO DE CASA"], "CASA DE CONDOMÍNIO");
  assert.equal(m["COMPRADOR 2 - NOME"], "BRUNO TESTE");
  assert.equal(m["COMPRADOR 2 - CPF"], "111.444.777-35");
  assert.equal(m["COMPRADOR 2 - E-MAIL"], "bruno@exemplo.test");
  assert.equal(m["COMPRADOR 2 - TELEFONE"], "62 91111-1111");
  assert.equal(m["COMPRADOR 2 - DOCUMENTO"], "RG 7654321");
  assert.equal(m["COMPRADOR 2 - ENDEREÇO"], "RUA DE TESTE, 10 - SETOR TESTE - CIDADE TESTE - CEP 74000-000", "o bloco … COMPRADOR 1 é do 2º comprador");
  assert.deepEqual(m["DATA DA VENDA"], { start: "2026-09-01", end: null });
  assert.equal(m["VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)"], 250000);
  assert.equal(m["VALOR FINANCIADO"], 180000);
  assert.equal(m["VALOR DO SUBSÍDIO"], 20000);
  assert.equal(m["VALOR DO FGTS"], 10000);
});

test("mapear: CONDOMÍNIO que já começa com CONDOMÍNIO não duplica; unidade com texto vira número", () => {
  const m = C.mapear(linhaCondominio({ "CONDOMÍNIO": P.sel("Condominio Reserva de Teste"), "UNIDADE": P.titulo("CASA 07") }), SCHEMA_VENDAS);
  assert.equal(m["ENDEREÇO"], "Condominio Reserva de Teste");
  assert.equal(m["CASA"], 7);
});

test("mapear: sem COMPRADOR 1 (ou igual ao proponente) — um comprador só, bloco COMPRADOR 1 vira reserva", () => {
  const semC1 = linhaCondominio({ "COMPRADOR 1": P.texto(""), "CPF PROPONENTE": P.texto(""), "Email": P.email(null) });
  let m = C.mapear(semC1, SCHEMA_VENDAS);
  assert.equal(m["CLIENTES"], "ANA TESTE");
  assert.equal(m["COMPRADOR 2 - NOME"], undefined);
  assert.equal(m["COMPRADOR 2 - CPF"], undefined);
  assert.equal(m["CPF"], "111.444.777-35", "CPF PROPONENTE vazio: usa o do bloco COMPRADOR 1");
  assert.equal(m["Email"], "bruno@exemplo.test");
  m = C.mapear(linhaCondominio({ "COMPRADOR 1": P.texto("ana  teste") }), SCHEMA_VENDAS);
  assert.equal(m["CLIENTES"], "ANA TESTE");
  assert.equal(m["COMPRADOR 2 - NOME"], undefined);
});

test("mapear: com segundo comprador o bloco COMPRADOR 1 nunca completa o proponente", () => {
  const m = C.mapear(linhaCondominio({ "CPF PROPONENTE": P.texto("") }), SCHEMA_VENDAS);
  assert.equal(m["CPF"], undefined);
  assert.equal(m["COMPRADOR 2 - CPF"], "111.444.777-35");
});

test("mapear: mesmo nome copia só com o mesmo tipo e fora das colunas do portal", () => {
  const m = C.mapear(linhaCondominio(), SCHEMA_VENDAS);
  assert.equal(m[" COMISSÃO "], 5000, "nome com espaço sobrando nas duas bases");
  assert.equal(m["CONTRATO - CONDIÇÕES ESPECIAIS"], "sem condições");
  assert.equal(m["TEM MANUAL DE OBRA?"], "SIM");
  assert.equal(m["LOCALIZAÇÃO"], "https://mapa.exemplo.test/x");
  for (const fora of ["SETOR", "CIDADE", "MC - SITUAÇÃO", "ASSINATURA - SITUAÇÃO", "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR", "SITUAÇÃO", "CONTRATO"])
    assert.equal(m[fora], undefined, fora);
  assert.equal(m["ENDEREÇO"], "CONDOMÍNIO RESERVA DE TESTE", "o ENDEREÇO (texto) do condomínio não vira o título");
  assert.equal(m["CORRETOR"], "corretor teste");
});

test("propriedadesNotion: tipo de cada coluna, select resolvido, coluna inexistente ignorada", () => {
  const m = C.mapear(linhaCondominio(), SCHEMA_VENDAS);
  m["COLUNA QUE NÃO EXISTE"] = "x";
  const r = C.propriedadesNotion(m, SCHEMA_VENDAS);
  assert.deepEqual(r.props["ENDEREÇO"], { title: [{ type: "text", text: { content: "CONDOMÍNIO RESERVA DE TESTE" } }] });
  assert.deepEqual(r.props["CLIENTES "], { rich_text: [{ type: "text", text: { content: "ANA TESTE E BRUNO TESTE" } }] });
  assert.deepEqual(r.props["CASA"], { number: 12 });
  assert.deepEqual(r.props["DATA DA VENDA"], { date: { start: "2026-09-01", end: null } });
  assert.deepEqual(r.props["CORRETOR"], { select: { name: "CORRETOR TESTE" } }, "opção existente, sem diferença de caixa");
  assert.deepEqual(r.props["IMOBILIÁRIA"], { select: { name: "IMOBILIARIA TESTE" } }, "sem vírgula (o Notion recusa)");
  assert.deepEqual(r.props["Nº Whatsapp"], { phone_number: "62 90000-0000" });
  assert.deepEqual(r.ignoradas.filter((c) => c !== "TIPO DE CASA"), ["COLUNA QUE NÃO EXISTE"]);
});

test("arquivosParaCopiar: com segundo comprador cada comprovante vai para o seu dono", () => {
  const pares = C.arquivosParaCopiar(linhaCondominio(), SCHEMA_VENDAS).map((p) => [p.de, p.para, p.arquivos.map((a) => a.name).join()]);
  assert.deepEqual(pares, [
    ["DOC. PROPONENTE", "COMPRADOR 1 - IDENTIDADE", "rg-a.pdf"],
    ["COMPROVANTE DE ENDEREÇO", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "luz-a.pdf"],
    ["DOC. COMPRADOR 1", "COMPRADOR 2 - IDENTIDADE", "rg-b.pdf"],
    ["COMP. END. COMPRADOR 1", "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO", "luz-b.pdf"],
    ["COMPROVANTE CARTÓRIO", "COMPROVANTE CARTÓRIO", "cartorio.pdf"],
    [" PROTOCOLO DE TRANS. ÁGUA", " PROTOCOLO DE TRANS. ÁGUA", "agua.pdf"],
  ]);
});

test("arquivosParaCopiar: sem segundo comprador o bloco COMPRADOR 1 é reserva do comprador 1", () => {
  const linha = linhaCondominio({ "COMPRADOR 1": P.texto(""), "DOC. PROPONENTE": P.arqs(), "COMPROVANTE DE ENDEREÇO": P.arqs() });
  const pares = C.arquivosParaCopiar(linha, SCHEMA_VENDAS).map((p) => [p.de, p.para]);
  assert.deepEqual(pares.slice(0, 2), [["DOC. COMPRADOR 1", "COMPRADOR 1 - IDENTIDADE"], ["COMP. END. COMPRADOR 1", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO"]]);
  assert.equal(pares.some((p) => /^COMPRADOR 2/.test(p[1])), false);
});

test("avisos: terceiro comprador e cônjuge, sem nome de ninguém", () => {
  const a = C.avisos(linhaCondominio({ "COMPRADOR 2": P.texto("CARLA TESTE"), "CONJUGE": P.texto("DIEGO TESTE") }));
  assert.equal(a.length, 2);
  assert.equal(a.some((x) => /CARLA|DIEGO/.test(x)), false);
  assert.deepEqual(C.avisos(linhaCondominio()), []);
});
