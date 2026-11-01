/* 01/11/2026 (plano 23 B, dono: "essas alterações estéticas pode fazer"): MigrarModelos.gs troca os blocos fixos de
 * assinatura por um parágrafo com o marcador. Correção 1: o TESTE e a produção usam os MESMOS modelos — o original
 * NUNCA é editado; o Aplicar faz uma CÓPIA "<nome> - assinaturas 01-11" na mesma pasta, confere que ela é igual ao
 * original, migra a cópia e diz qual Propriedade trocar. DocumentApp/DriveApp falsos: corpo e células de tabela como
 * listas de parágrafos e tabelas, no mesmo rigor do Apps Script (o último parágrafo do corpo não sai).
 * Só dados inventados — o repositório é público. */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VENDA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIPO = { PARAGRAPH: "PARAGRAPH", TABLE: "TABLE", LIST_ITEM: "LIST_ITEM" };

/* ---- documento falso: nós { tipo: "P", texto, al } e { tipo: "T", linhas: [[[nós da célula]]] } ---- */
const P = (texto, al = "LEFT") => ({ tipo: "P", texto, al });
const T = (...linhas) => ({ tipo: "T", linhas });
const textoDe = (n) => (n.tipo === "P" ? n.texto : n.linhas.map((l) => l.map((c) => c.map(textoDe).join("\n")).join("\n")).join("\n"));
const clonar = (x) => JSON.parse(JSON.stringify(x));

/* opc.copiaDiferente: a cópia sai com um parágrafo a menos; opc.copiaQuebra: a cópia lança ao inserir parágrafo */
function docFalso(modelos, opc = {}) {
  const docs = {}, estado = { copias: [], abertos: [], salvos: [] };
  for (const [id, m] of Object.entries(modelos)) docs[id] = { nome: m.nome, filhos: clonar(m.filhos), salvo: clonar(m.filhos), pasta: "pasta-" + id };
  function caixa(d, filhos, ehCorpo) {
    const el = (n) => {
      const e = {
        getType: () => (n.tipo === "P" ? TIPO.PARAGRAPH : TIPO.TABLE),
        getText: () => textoDe(n),
        asParagraph: () => e, asTable: () => e, asListItem: () => e,
        removeFromParent: () => {
          const i = filhos.indexOf(n);
          if (i < 0) throw new Error("Element not in parent");
          if (ehCorpo && i === filhos.length - 1) throw new Error("Can't remove the last paragraph in a document section");
          filhos.splice(i, 1);
        },
      };
      if (n.tipo === "P") {
        e.getAlignment = () => n.al; e.setAlignment = (a) => { n.al = a; return e; };
        e.editAsText = () => ({ setBold: (b) => { n.negrito = b; } });
      } else {
        e.getNumRows = () => n.linhas.length;
        e.getRow = (r) => ({ getNumCells: () => n.linhas[r].length, getCell: (c) => caixa(d, n.linhas[r][c], false) });
      }
      e._n = n;
      return e;
    };
    return {
      getNumChildren: () => filhos.length,
      getChild: (i) => { if (!filhos[i]) throw new Error("Child index out of bounds"); return el(filhos[i]); },
      getChildIndex: (e) => filhos.indexOf(e._n),
      insertParagraph: (i, t) => { if (d.quebra) throw new Error("Service error"); const n = P(String(t)); filhos.splice(i, 0, n); return el(n); },
      getText: () => filhos.map(textoDe).join("\n"),
    };
  }
  const pasta = (pid) => ({ getId: () => pid, getFilesByName: (nome) => {
    const l = Object.entries(docs).filter(([, x]) => x.nome === nome && x.pasta === pid).map(([id]) => id);
    return { hasNext: () => l.length > 0, next: () => ({ getId: () => l.shift() }) };
  } });
  const extras = {
    DocumentApp: {
      ElementType: TIPO, HorizontalAlignment: { CENTER: "CENTER" },
      openById: (id) => {
        if (!docs[id]) throw new Error("Document not found");
        estado.abertos.push(id);
        return { getBody: () => caixa(docs[id], docs[id].filhos, true), getName: () => docs[id].nome,
                 saveAndClose: () => { docs[id].salvo = clonar(docs[id].filhos); estado.salvos.push(id); } };
      },
    },
    DriveApp: {
      getFileById: (id) => {
        if (!docs[id]) throw new Error("File not found");
        return {
          getId: () => id, getName: () => docs[id].nome,
          getParents: () => { let ok = true; return { hasNext: () => ok, next: () => { ok = false; return pasta(docs[id].pasta); } }; },
          makeCopy: (nome, p) => {
            const nid = "copia-" + (estado.copias.length + 1), conteudo = clonar(docs[id].salvo);
            if (opc.copiaDiferente) conteudo.pop();
            docs[nid] = { nome, filhos: conteudo, salvo: clonar(conteudo), pasta: p.getId(), quebra: !!opc.copiaQuebra };
            estado.copias.push({ id: nid, de: id, nome, pasta: p.getId() });
            return { getId: () => nid };
          },
        };
      },
      getRootFolder: () => pasta("raiz"),
    },
  };
  return { docs, estado, extras };
}

function carregar(props, modelos, opc) {
  const d = docFalso(modelos, opc), logs = [];
  const ctx = Object.assign({
    console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (n) => (n in props ? props[n] : null) }) },
  }, d.extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(VENDA, "MigrarModelos.gs"), "utf8"), ctx, { filename: "MigrarModelos.gs" });
  return Object.assign(d, { ctx, logs });
}

const textos = (filhos) => filhos.map((n) => (n.tipo === "P" ? n.texto : "[TABELA " + textoDe(n).replace(/\n/g, " | ") + "]"));

/* ---- modelos no formato visto nos PDFs/.docx do advogado (textos inventados) ---- */
const TRACO = "_______________________________________________";
const TESTEMUNHAS_TAB = () => T([[P(""), P("_______________________________"), P("TESTEMUNHA 1"), P("Nome:"), P("CPF:")],
                                 [P(""), P("_______________________________"), P("TESTEMUNHA 2"), P("Nome:"), P("CPF:")]]);
const QUADRO_GRANDE = () => T([[P("1. PARTES")], [P("VENDEDORA: SPE TESTE")]], [[P("4. PREÇO")], [P("CIÊNCIA DO COMPRADOR"), P("ASSINATURA: ____________]")]],
                              [[P("16. CONDIÇÕES")], [P("{{CONDICOES_ESPECIAIS}}")]], [[P("17. ANEXOS")], [P("Memorial")]]);
const CONDOMINIO = { nome: "MODELO CONDOMINIO TESTE", filhos: [
  P("QUADRO RESUMO"), QUADRO_GRANDE(), P(""), P("{{CIDADE_DATA}}."), P(""),
  P(TRACO, "CENTER"), P("SPE TESTE LTDA"), P("CNPJ nº 00.000.000/0001-00"), P("VENDEDORA"), P(""),
  P(TRACO), P("Nome: {{ASSINATURA_COMPRADORES_NOMES}}"), P("CPF: {{ASSINATURA_COMPRADORES_CPFS}}"), P("COMPRADOR"), P(""),
  P("{{#COM_COMISSAO}}"), P(TRACO), P("Nome: {{CORRETOR_NOME}}"), P("CPF/CNPJ: {{CORRETOR_DOC}}"), P("INTERMEDIADOR/CORRETOR"), P("{{/COM_COMISSAO}}"), P(""),
  TESTEMUNHAS_TAB(),
  P("CLÁUSULAS E CONDIÇÕES GERAIS"), P("{{#COM_POS}}"), P("1.1 texto"), P("{{/COM_POS}}"), P("20.9 Foro."), P(""),
  P("ASSINATURAS"), P("E, por estarem assim justos e contratados, assinam com 2 (duas) testemunhas."), P("{{CIDADE_DATA}}."), P(""),
  P(TRACO, "CENTER"), P("SPE TESTE LTDA."), P("CNPJ nº 00.000.000/0001-00"), P("VENDEDORA"), P(""),
  P(TRACO), P("Nome: {{ASSINATURA_COMPRADORES_NOMES}} – CPF: {{ASSINATURA_COMPRADORES_CPFS}}"), P("COMPRADOR"), P(""),
  P("{{#COM_COMISSAO}}"), P(TRACO), P("Nome: {{CORRETOR_NOME}} – CRECI: {{CORRETOR_CRECI}}"), P("INTERMEDIADOR/CORRETOR"), P("{{/COM_COMISSAO}}"),
  TESTEMUNHAS_TAB(), P("")] };
/* casa de rua: o bloco do quadro fica DENTRO da última célula da tabela do quadro-resumo; o final, no corpo */
const PRONTO = { nome: "MODELO PRONTO TESTE", filhos: [
  P("CONTRATO"),
  T([[P("1. PARTES")], [P("{{#SE_VENDEDOR_PJ}}"), P("VENDEDOR: {{VENDEDOR_NOME}}"), P("{{/SE_VENDEDOR_PJ}}")]], [[P("6. VALOR")], [P("6.1 {{VALOR_TOTAL}}")]],
    [[P("13. FINANCIAMENTO")], [P("13.1 texto")]],
    [[P("{{CIDADE_DATA}}."), P(""), P("_____________________________________"), P("{{VENDEDOR_NOME}}"), P("{{VENDEDOR_DOC_ROTULO}}"), P("VENDEDOR"), P(""),
      P("_____________________________________"), P("Nome: {{ASSINATURA_COMPRADORES_NOMES}}"), P("CPF: {{ASSINATURA_COMPRADORES_CPFS}}"), P("COMPRADOR"),
      P("TESTEMUNHAS:"), P("1.  Nome:                                     2. Nome:"), P("      CPF:                                              CPF:")]]),
  P("CLÁUSULA PRIMEIRA"), P("13.1 Foro."), P(""), P("{{CIDADE_DATA}}."), P(""),
  P("______________________________________", "CENTER"), P("{{VENDEDOR_NOME}}"), P("{{VENDEDOR_DOC_ROTULO}}"), P("VENDEDOR"), P(""),
  P("     ____________________________________"), P("Nome: {{ASSINATURA_COMPRADORES_NOMES}}"), P("CPF: {{ASSINATURA_COMPRADORES_CPFS}}"), P("COMPRADOR"), P(""),
  P("_____________________________________"), P("Nome: {{CORRETOR_NOME}}"), P("CPF: {{CORRETOR_DOC}}"), P("INTERMEDIADOR"), P(""),
  P("TESTEMUNHAS:"), P("1.  Nome:                                     2. Nome:"), P("      CPF:                                              CPF:"), P("")] };
const TERMO = (n) => ({ nome: "MODELO CONFISSAO " + n + " TESTE", filhos: [
  P("TERMO DE CONFISSÃO"), P("FIADOR 1: {{FIADOR1_QUADRO}};"), P("11.1 Integra o contrato."), P(""), P("{{CIDADE_DATA}}."), P("ASSINATURAS"), P(""), P(""),
  T([[P("____________________________________________"), P("CREDORA/VENDEDORA"), P("SPE TESTE LTDA."), P("CNPJ nº 00.000.000/0001-00")],
     [P("____________________________________________"), P("DEVEDOR/COMPRADOR"), P("{{ASSINATURA_COMPRADORES_NOMES}}"), P("CPF nº {{ASSINATURA_COMPRADORES_CPFS}}")]],
    [[P("____________________________________________"), P("FIADOR 1"), P("{{FIADOR1_NOME}}"), P("CPF nº {{FIADOR1_CPF}}")],
     [P("____________________________________________"), P("FIADOR 2"), P("{{FIADOR2_NOME}}"), P("CPF nº {{FIADOR2_CPF}}")]]),
  P(""), P("Testemunhas:"), P("1. Nome:                                                 2. Nome:"), P("    CPF:                                                         CPF:"), P(""), P("")] });
const PRE_RESERVA = { nome: "MODELO PRE-RESERVA TESTE", filhos: [
  P("TERMO DE PRÉ-RESERVA"), P("Por estarem de acordo, firmam este Termo na presença de 2 (duas) testemunhas."), P(""), P("{{CIDADE_DATA}}."), P(""),
  T([[P("______________________________"), P("SPE TESTE LTDA."), P("VENDEDORA")], [P("______________________________"), P("PRÉ-RESERVANTE"), P("{{PRE_RESERVANTE_NOME}} – CPF {{PRE_RESERVANTE_CPF}}")]],
    [[P("______________________________"), P("TESTEMUNHA 1"), P("Nome: ______________________"), P("CPF: ______________________")],
     [P("______________________________"), P("TESTEMUNHA 2"), P("Nome: ______________________"), P("CPF: ______________________")]]),
  P("")] };
const PROPS = { MODELO_CONDOMINIO_ID: "m-cond", MODELO_PRONTO_ID: "m-pronto", MODELO_CONSTRUCAO_ID: "", MODELO_CONFISSAO_PRE_ID: "m-pre",
                MODELO_CONFISSAO_POS_ID: "m-pos", MODELO_PRE_RESERVA_ID: "m-pr" };
const MODELOS = () => ({ "m-cond": CONDOMINIO, "m-pronto": PRONTO, "m-pre": TERMO("PRE"), "m-pos": TERMO("POS"), "m-pr": PRE_RESERVA });

const intactos = (g, modelos) => { for (const [id, m] of Object.entries(modelos)) { assert.deepEqual(g.docs[id].filhos, m.filhos, id + " intacto"); assert.deepEqual(g.docs[id].salvo, m.filhos, id + " salvo intacto"); } };

test("prévia: lista cada elemento que sairia e o vendedor do bloco antigo; não mexe em nada nem copia", () => {
  const g = carregar(PROPS, MODELOS());
  const rel = g.ctx.migrarModelosAssinaturasPrevia();
  intactos(g, MODELOS());
  assert.equal(g.estado.copias.length, 0);
  const txt = rel.join("\n");
  assert.match(txt, /MODELO_CONDOMINIO_ID: PRÉVIA — trocaria 2 bloco\(s\)/);
  assert.match(txt, /\{\{ASSINATURAS_QUADRO\}\} no lugar de 18 elemento\(s\)/);
  assert.match(txt, /\{\{ASSINATURAS_FINAL\}\}/);
  /* cada elemento que sairia, um por linha (até 80 caracteres) */
  const cond = txt.slice(txt.indexOf("MODELO_CONDOMINIO_ID"), txt.indexOf("MODELO_PRONTO_ID"));
  assert.equal((cond.match(/\n {4}- /g) || []).length, 18 + 15, cond);
  assert.match(cond, /\n {4}- Nome: \{\{ASSINATURA_COMPRADORES_NOMES\}\}\n/);
  assert.match(cond, /\n {4}- \[tabela\] _+ \| TESTEMUNHA 1/);
  assert.match(cond, /vendedor no bloco antigo: SPE TESTE LTDA — CNPJ nº 00\.000\.000\/0001-00/);
  const pronto = txt.slice(txt.indexOf("MODELO_PRONTO_ID"), txt.indexOf("MODELO_CONSTRUCAO_ID"));
  assert.match(pronto, /vendedor no bloco antigo: \{\{VENDEDOR_NOME\}\} — \{\{VENDEDOR_DOC_ROTULO\}\}/);
  assert.ok(pronto.split("\n").every((l) => l.length <= 400), "linhas curtas");
  assert.match(txt, /MODELO_CONSTRUCAO_ID: sem a propriedade/);
  assert.match(txt, /MODELO_PRE_RESERVA_ID: PRÉVIA — trocaria 1 bloco\(s\)/);
  assert.ok(g.logs.join("\n").includes("MODELO_PRONTO_ID: PRÉVIA"), "também vai para o registro de execução");
});

test("aplicar: o ORIGINAL não muda; cópia '<nome> - assinaturas 01-11' na mesma pasta é migrada e o registro diz qual Propriedade trocar", () => {
  const g = carregar(PROPS, MODELOS());
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  intactos(g, MODELOS());
  assert.deepEqual(g.estado.copias.map((b) => [b.de, b.nome, b.pasta]), [
    ["m-cond", "MODELO CONDOMINIO TESTE - assinaturas 01-11", "pasta-m-cond"],
    ["m-pronto", "MODELO PRONTO TESTE - assinaturas 01-11", "pasta-m-pronto"],
    ["m-pre", "MODELO CONFISSAO PRE TESTE - assinaturas 01-11", "pasta-m-pre"],
    ["m-pos", "MODELO CONFISSAO POS TESTE - assinaturas 01-11", "pasta-m-pos"],
    ["m-pr", "MODELO PRE-RESERVA TESTE - assinaturas 01-11", "pasta-m-pr"]]);
  assert.match(rel, /MODELO_CONDOMINIO_ID: cópia migrada \(2 bloco\(s\)\) — Propriedade MODELO_CONDOMINIO_ID: trocar m-cond por copia-1/);
  assert.match(rel, /MODELO_PRE_RESERVA_ID: cópia migrada \(1 bloco\(s\)\) — Propriedade MODELO_PRE_RESERVA_ID: trocar m-pr por copia-5/);
  assert.ok(!g.estado.salvos.some((id) => !/^copia-/.test(id)), "só as cópias são salvas");

  const cond = g.docs["copia-1"].salvo;
  assert.deepEqual(textos(cond), [
    "QUADRO RESUMO", textos([QUADRO_GRANDE()])[0], "", "{{CIDADE_DATA}}.", "", "{{ASSINATURAS_QUADRO}}",
    "CLÁUSULAS E CONDIÇÕES GERAIS", "{{#COM_POS}}", "1.1 texto", "{{/COM_POS}}", "20.9 Foro.", "",
    "ASSINATURAS", "E, por estarem assim justos e contratados, assinam com 2 (duas) testemunhas.", "{{CIDADE_DATA}}.", "", "{{ASSINATURAS_FINAL}}", ""]);
  assert.equal(cond[5].al, "CENTER");
  assert.equal(cond[16].al, "CENTER");

  const pr = g.docs["copia-2"].salvo;
  /* o bloco terminava no último parágrafo da célula: fica um vazio depois (o Docs não apaga o último parágrafo) */
  assert.deepEqual(pr[1].linhas[3][0].map((n) => n.texto), ["{{CIDADE_DATA}}.", "", "{{ASSINATURAS_QUADRO}}", ""], "bloco dentro da célula");
  assert.deepEqual(textos(pr.slice(2)), ["CLÁUSULA PRIMEIRA", "13.1 Foro.", "", "{{CIDADE_DATA}}.", "", "{{ASSINATURAS_FINAL}}", ""]);
  for (const id of ["copia-3", "copia-4"])
    assert.deepEqual(textos(g.docs[id].salvo), ["TERMO DE CONFISSÃO", "FIADOR 1: {{FIADOR1_QUADRO}};", "11.1 Integra o contrato.", "",
      "{{CIDADE_DATA}}.", "ASSINATURAS", "", "", "{{ASSINATURAS_TERMO}}", "", ""], id);
  assert.deepEqual(textos(g.docs["copia-5"].salvo).slice(3), ["{{CIDADE_DATA}}.", "", "{{ASSINATURAS_TERMO}}", ""]);
  assert.equal(g.docs["copia-5"].salvo[5].al, "CENTER", "começo em tabela: centralizado");
});

test("rodar de novo: a cópia já existe — não faz outra e repete qual Propriedade trocar", () => {
  const g = carregar(PROPS, MODELOS());
  g.ctx.migrarModelosAssinaturasAplicar();
  const antes = g.estado.copias.length;
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  assert.equal(g.estado.copias.length, antes);
  assert.match(rel, /MODELO_CONDOMINIO_ID: a cópia "MODELO CONDOMINIO TESTE - assinaturas 01-11" já existe \(copia-1\), nada a fazer — Propriedade MODELO_CONDOMINIO_ID: trocar m-cond por copia-1/);
});

test("modelo que já tem os marcadores: todos = já migrado; só parte = PARCIAL, não mexi", () => {
  const todos = { nome: "X", filhos: [P("{{CIDADE_DATA}}"), P("{{ASSINATURAS_QUADRO}}"), P("meio"), P("{{ASSINATURAS_FINAL}}"), P("")] };
  const parte = { nome: "Y", filhos: [P("{{CIDADE_DATA}}"), P("{{ASSINATURAS_QUADRO}}"), P("")] };
  const g = carregar({ MODELO_CONDOMINIO_ID: "a", MODELO_PRONTO_ID: "b" }, { a: todos, b: parte });
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  assert.match(rel, /MODELO_CONDOMINIO_ID: já migrado/);
  assert.match(rel, /MODELO_PRONTO_ID: PARCIAL, não mexi — tem \{\{ASSINATURAS_QUADRO\}\}, falta \{\{ASSINATURAS_FINAL\}\}/);
  assert.equal(g.estado.copias.length, 0);
});

test("bloco que não dá para achar sem dúvida: nada é copiado nem mexido e o motivo vai para o registro", () => {
  const antesDe = (f, texto, ...novos) => f.splice(f.findIndex((n) => n.texto === texto), 0, ...novos);
  const casos = {
    "marcador estranho no meio": (f) => antesDe(f, "VENDEDORA", P("{{OUTRO_MARCADOR}}")),
    "só um bloco no contrato": (f) => { f.splice(f.findIndex((n) => n.texto === "ASSINATURAS")); f.push(P("")); },
    "sem a data antes do bloco": (f) => { f.forEach((n) => { if (n.texto === "{{CIDADE_DATA}}.") n.texto = "Goiânia."; }); },
    "COM_COMISSAO cortado": (f) => { f.splice(f.findIndex((n) => n.texto === "{{/COM_COMISSAO}}"), 1); },
    "texto entre a data e o bloco": (f) => { f.splice(f.findIndex((n) => n.texto === "{{CIDADE_DATA}}.") + 1, 0, P("Observação importante")); },
    "parágrafo longo no bloco": (f) => antesDe(f, "VENDEDORA", P("x".repeat(121))),
    "frase com ponto final no bloco": (f) => antesDe(f, "VENDEDORA", P("O comprador declara que leu o contrato.")),
    "tabela que não é de assinatura no bloco": (f) => antesDe(f, "VENDEDORA", QUADRO_GRANDE()),
  };
  for (const [nome, estraga] of Object.entries(casos)) {
    const m = clonar(CONDOMINIO);
    estraga(m.filhos);
    const g = carregar({ MODELO_CONDOMINIO_ID: "m-cond" }, { "m-cond": m });
    const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
    intactos(g, { "m-cond": m });
    assert.equal(g.estado.copias.length, 0, nome + ": sem cópia");
    assert.match(rel, /MODELO_CONDOMINIO_ID: NÃO MEXI — /, nome + ": " + rel);
  }
  /* modelo que não abre: registra e segue para os outros */
  const g = carregar({ MODELO_CONDOMINIO_ID: "nao-existe", MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": PRE_RESERVA });
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  assert.match(rel, /MODELO_CONDOMINIO_ID: NÃO MEXI — erro: Document not found/);
  assert.match(rel, /MODELO_PRE_RESERVA_ID: cópia migrada \(1 bloco/);
});

test("cópia diferente do original ou falha ao migrar a cópia: ERRO NA CÓPIA <id> — apague a cópia; o original fica intacto", () => {
  for (const opc of [{ copiaDiferente: true }, { copiaQuebra: true }]) {
    const g = carregar({ MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": PRE_RESERVA }, opc);
    const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
    intactos(g, { "m-pr": PRE_RESERVA });
    assert.match(rel, /MODELO_PRE_RESERVA_ID: ERRO NA CÓPIA copia-1 — apague a cópia/, JSON.stringify(opc) + rel);
    assert.ok(!/trocar m-pr por/.test(rel), "não manda trocar a Propriedade");
  }
});

test("bloco que termina no último parágrafo do documento (o Docs não deixa apagar o último): troca mesmo assim, sem erro", () => {
  const pronto = clonar(PRONTO);
  pronto.filhos.pop();   /* sem o parágrafo vazio do fim: "CPF: … CPF:" é o último */
  const termo = clonar(TERMO("PRE"));
  termo.filhos.splice(-2);   /* termina na linha dos CPFs */
  const g = carregar({ MODELO_PRONTO_ID: "m-pronto", MODELO_CONFISSAO_PRE_ID: "m-pre" }, { "m-pronto": pronto, "m-pre": termo });
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  assert.match(rel, /MODELO_PRONTO_ID: cópia migrada \(2 bloco/, rel);
  assert.match(rel, /MODELO_CONFISSAO_PRE_ID: cópia migrada \(1 bloco/, rel);
  assert.deepEqual(textos(g.docs["copia-1"].salvo).slice(-3), ["", "{{ASSINATURAS_FINAL}}", ""]);
  assert.deepEqual(textos(g.docs["copia-2"].salvo).slice(-2), ["{{ASSINATURAS_TERMO}}", ""]);
});

test("pré-reserva: o papel vale com qualquer grafia do É (PRÉ-RESERVANTE / PRE-RESERVANTE)", () => {
  const pr = clonar(PRE_RESERVA);
  pr.filhos[5].linhas[0][1][1].texto = "PRE-RESERVANTE";
  const g = carregar({ MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": pr });
  assert.match(g.ctx.migrarModelosAssinaturasPrevia().join("\n"), /MODELO_PRE_RESERVA_ID: PRÉVIA — trocaria 1 bloco/);
  const so = clonar(PRE_RESERVA);
  so.filhos[5].linhas[0][1][1].texto = "PR�-RESERVANTE";
  const g2 = carregar({ MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": so });
  assert.match(g2.ctx.migrarModelosAssinaturasPrevia().join("\n"), /trocaria 1 bloco/);
});
