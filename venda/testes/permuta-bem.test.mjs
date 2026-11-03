/* 03/11/2026 (dono): "quando tiver permuta, hora que salvar, pede para quem tiver preenchendo colocar as informações da
   permuta; se for automóvel, colocar os dados básicos que um contrato de permuta pede". Regras em venda/FluxoLivre.js
   (as mesmas na tela e no servidor). Dados FALSOS: o repositório é público. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../FluxoLivre.js");

export const carro = () => ({ tipo: "veiculo", marca: "Hyundai", modelo: "HB20", anoFab: 2019, anoModelo: 2020, cor: "prata",
  placa: "abc-1d23", renavam: "00000000000", chassi: "9bwzzz377vt004251", km: "45.000", propNome: "Fulano de Teste",
  propDoc: "529.982.247-25", situacao: "quitado" });
const fluxo = (b, x = "") => ({ valor: 100000, entrega: "", linhas: [
  { t: "permuta", v: 40000, n: 1, d: "2026-11-15", i: 1, x, ...(b ? { b } : {}) }, { t: "fin", v: 60000, n: 1, d: "", i: 1 }] });

test("documentos: CPF, CNPJ e RENAVAM pelo dígito; placa antiga e Mercosul; chassi de 17 sem I, O e Q", () => {
  assert.equal(F.docValido("529.982.247-25"), true);
  assert.equal(F.docValido("529.982.247-24"), false);
  assert.equal(F.docValido("111.111.111-11"), false, "todos iguais");
  assert.equal(F.docValido("11.222.333/0001-81"), true);
  assert.equal(F.docValido("11.222.333/0001-80"), false);
  assert.equal(F.renavamValido("00000000000"), true);
  assert.equal(F.renavamValido("00639884962"), true);
  assert.equal(F.renavamValido("00639884961"), false);
  assert.equal(F.renavamValido("639884962"), true, "o antigo de 9 dígitos vale com zeros à esquerda");
  assert.equal(F.renavamValido("1234"), false);
  for (const p of ["ABC1234", "ABC1D23"]) assert.equal(F.placaValida(p), true, p);
  for (const p of ["AB12345", "ABCD123", "ABC12D3"]) assert.equal(F.placaValida(p), false, p);
  assert.equal(F.chassiValido("9BWZZZ377VT004251"), true);
  assert.equal(F.chassiValido("9BWZZZ377VT00425"), false, "16");
  assert.equal(F.chassiValido("9BWZZZ377VT00425O"), false, "com O");
});

test("normalizarBem limpa: placa sem traço e maiúscula, chassi maiúsculo, documento só dígitos, km (fora desde 03/11) ignorado, campos de outro tipo somem", () => {
  const b = F.normalizarBem({ ...carro(), endereco: "não é de veículo", lixo: 1 });
  assert.equal(b.placa, "ABC1D23");
  assert.equal(b.chassi, "9BWZZZ377VT004251");
  assert.equal(b.km, undefined, "dono 03/11: sem quilometragem — o km de um bem antigo é ignorado");
  assert.equal(b.propDoc, "52998224725");
  assert.equal(b.endereco, undefined);
  assert.equal(b.lixo, undefined);
  assert.equal(F.normalizarBem(null), null);
});

test("veículo completo: valida e vira um resumo curto (vai para a descrição e o comentário do Mais Controle)", () => {
  assert.deepEqual(F.faltasBem(F.normalizarBem(carro())), []);
  assert.equal(F.resumoBem(F.normalizarBem(carro())), "Hyundai HB20 2019/2020 placa ABC1D23");
  assert.equal(F.resumoBem(F.normalizarBem({ ...carro(), anoModelo: 2019 })), "Hyundai HB20 2019 placa ABC1D23");
});

test("veículo incompleto: diz o que falta, campo por campo", () => {
  const f = F.faltasBem(F.normalizarBem({ tipo: "veiculo" }));
  for (const m of [/marca/, /modelo/, /ano de fabricação/, /ano do modelo/, /cor/, /placa/, /RENAVAM/, /chassi/, /proprietário/, /CPF ou CNPJ/, /quitado ou alienado/])
    assert.ok(f.some((x) => m.test(x)), m + " em " + f.join(" | "));
  assert.ok(!f.some((x) => /quilometragem/.test(x)), "km não é pedido");
  const ruim = F.faltasBem(F.normalizarBem({ ...carro(), renavam: "00639884961", placa: "AB12345", chassi: "123", propDoc: "529.982.247-24", anoModelo: 2022 }));
  assert.ok(ruim.some((x) => /RENAVAM inválido/.test(x)));
  assert.ok(ruim.some((x) => /placa inválida/.test(x)));
  assert.ok(ruim.some((x) => /chassi/.test(x)));
  assert.ok(ruim.some((x) => /CPF ou CNPJ do proprietário inválido/.test(x)));
  assert.ok(ruim.some((x) => /ano do modelo/.test(x)));
});

test("veículo alienado: pede o credor e o saldo; quem quita tem padrão (o COMPRADOR, antes da entrega)", () => {
  const b = F.normalizarBem({ ...carro(), situacao: "alienado" });
  assert.deepEqual(F.faltasBem(b).sort(), ["instituição credora", "saldo devedor estimado"].sort());
  assert.equal(b.quitaPor, "o COMPRADOR, antes da entrega");
  const ok = F.normalizarBem({ ...carro(), situacao: "alienado", credor: "Banco de Teste S.A.", saldo: 12000 });
  assert.deepEqual(F.faltasBem(ok), []);
});

test("imóvel e outro bem", () => {
  const im = { tipo: "imovel", endereco: "Rua de Teste, 100, Bairro Teste, Cidade Teste", matricula: "12.345", cartorio: "1º CRI de Cidade Teste",
               propNome: "Fulano de Teste", propDoc: "529.982.247-25", onus: "" };
  assert.deepEqual(F.faltasBem(F.normalizarBem(im)), []);
  assert.equal(F.normalizarBem(im).onus, "nenhum", "ônus em branco = nenhum");
  assert.match(F.resumoBem(F.normalizarBem(im)), /^imóvel matrícula 12\.345/);
  assert.ok(F.faltasBem(F.normalizarBem({ tipo: "imovel" })).length >= 4);
  assert.deepEqual(F.faltasBem(F.normalizarBem({ tipo: "outro", descricao: "curta" })), ["descrição detalhada do bem (no mínimo 20 letras)"]);
  assert.deepEqual(F.faltasBem(F.normalizarBem({ tipo: "outro", descricao: "Trator agrícola de teste, ano 2015, em uso" })), []);
  assert.deepEqual(F.faltasBem(F.normalizarBem({ tipo: "barco" })), ["escolha o tipo do bem (veículo, imóvel ou outro)"]);
});

test("validar: permuta NOVA sem os dados do bem trava, e o erro vem separado (a tela abre o formulário ao salvar)", () => {
  const r = F.validar(fluxo(null, "carro do cliente"));
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.porBem), ["0"]);
  assert.equal(r.errosBem.length, 1);
  assert.deepEqual(r.erros, r.errosBem, "o único erro é o do bem");
  assert.match(r.erros[0], /^Linha 1: faltam os dados do bem da permuta/);
});

test("validar: permuta com o bem completo passa; a descrição vira o resumo do bem", () => {
  const r = F.validar(fluxo(carro(), "texto antigo qualquer"));
  assert.equal(r.ok, true, r.erros.join(" | "));
  const n = F.normalizar(fluxo(carro(), "texto antigo qualquer"));
  assert.equal(n.linhas[0].x, "Hyundai HB20 2019/2020 placa ABC1D23");
  assert.equal(n.linhas[0].b.placa, "ABC1D23");
  assert.equal(n.linhas[1].b, undefined);
  const inc = F.validar(fluxo({ ...carro(), placa: "" }));
  assert.equal(inc.ok, false);
  assert.match(inc.erros[0], /^Linha 1: dados da permuta incompletos — placa/);
  assert.deepEqual(inc.porBem[0], ["placa"]);
});

test("validar: fluxo ANTIGO (permuta só com a descrição, já gravada) continua salvando sem mudar a linha", () => {
  const antigo = fluxo(null, "veículo marca/modelo/ano/placa");
  assert.equal(F.validar(antigo, null, antigo).ok, true);
  const mexida = fluxo(null, "outro carro");
  assert.equal(F.validar(mexida, null, antigo).ok, false, "mudou a descrição: é permuta nova");
  const semDesc = fluxo(null, "");
  assert.deepEqual(Object.keys(F.validar(semDesc, null, semDesc).porBem), ["0"], "sem descrição nenhuma: pede o bem");
});

test("bem só fica em linha de permuta; serializar e ler preservam o bem", () => {
  const f = fluxo(carro());
  f.linhas[1].b = carro();
  const s = F.serializar(f), l = F.ler(s);
  assert.equal(l.linhas[0].b.renavam, "00000000000");
  assert.equal(l.linhas[1].b, undefined);
  assert.equal(F.ler(s).linhas[0].x, "Hyundai HB20 2019/2020 placa ABC1D23");
});

/* revisão de 0f969f6 */
test("fluxo antigo: cada permuta gravada libera UMA linha igual — a cópia dela pede o bem", () => {
  const antigo = fluxo(null, "carro do cliente");
  const duas = { valor: 100000, entrega: "", linhas: [antigo.linhas[0], { ...antigo.linhas[0] }, { t: "fin", v: 20000, n: 1, d: "", i: 1 }] };
  duas.linhas[1] = { ...duas.linhas[1] };
  const r = F.validar(duas, null, antigo);
  assert.deepEqual(Object.keys(r.porBem), ["1"], r.erros.join(" | "));
  assert.equal(F.validar(antigo, null, antigo).ok, true);
});

test("RENAVAM com mais de 11 dígitos é inválido (não corta calado)", () => {
  assert.equal(F.renavamValido("000000000000"), false);
  assert.equal(F.renavamValido("006398849620"), false);
  const b = F.normalizarBem({ ...carro(), renavam: "000000000001" });
  assert.ok(F.faltasBem(b).some((x) => /RENAVAM inválido/.test(x)), F.faltasBem(b).join(" | "));
});

test("placa e chassi: a validação exportada limpa igual ao normalizarBem e não corta o excesso", () => {
  assert.equal(F.placaValida("abc-1d23"), true);
  assert.equal(F.placaValida("ABC12345"), false, "8 caracteres");
  assert.ok(F.faltasBem(F.normalizarBem({ ...carro(), placa: "ABC12345" })).some((x) => /placa inválida/.test(x)));
  assert.equal(F.chassiValido("9bwzzz377vt004251"), true);
  assert.equal(F.chassiValido("9BW ZZZ377-VT004251"), true);
  assert.equal(F.chassiValido("9BWZZZ377VT0042511"), false, "18 caracteres");
  assert.ok(F.faltasBem(F.normalizarBem({ ...carro(), chassi: "9BWZZZ377VT0042511" })).some((x) => /chassi com 17/.test(x)));
});

test("semDadosDoBem: tira o bem das linhas (fica o resumo) — é o que vai para o histórico", () => {
  const f = F.normalizar(fluxo(carro()));
  const s = F.semDadosDoBem(f);
  assert.equal(s.linhas[0].b, undefined);
  assert.equal(s.linhas[0].x, "Hyundai HB20 2019/2020 placa ABC1D23");
  assert.ok(f.linhas[0].b, "não mexe no original");
  assert.doesNotMatch(F.serializar(s), /52998224725|9BWZZZ377VT004251|00000000000/);
});
