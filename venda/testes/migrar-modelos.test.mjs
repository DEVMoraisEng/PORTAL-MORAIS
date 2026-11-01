/* 01/11/2026 (plano 23 B, dono: "essas alterações estéticas pode fazer"): MigrarModelos.gs troca os blocos fixos de
 * assinatura dos modelos (Google Docs) por um parágrafo com o marcador. Prévia por padrão; Aplicar faz a cópia de
 * segurança antes. DocumentApp/DriveApp falsos: corpo e células de tabela como listas de parágrafos e tabelas, no mesmo
 * rigor do Apps Script (o último parágrafo do corpo não sai). Só dados inventados — o repositório é público. */
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

function docFalso(modelos) {
  const docs = {}, estado = { salvos: {}, backups: [], abertos: [] };
  for (const [id, m] of Object.entries(modelos)) docs[id] = { nome: m.nome, filhos: clonar(m.filhos), salvo: clonar(m.filhos), pasta: "pasta-" + id };
  function caixa(filhos, ehCorpo) {
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
        e.getRow = (r) => ({ getNumCells: () => n.linhas[r].length, getCell: (c) => caixa(n.linhas[r][c], false) });
      }
      e._n = n;
      return e;
    };
    return {
      getNumChildren: () => filhos.length,
      getChild: (i) => { if (!filhos[i]) throw new Error("Child index out of bounds"); return el(filhos[i]); },
      getChildIndex: (e) => filhos.indexOf(e._n),
      insertParagraph: (i, t) => { const n = P(String(t)); filhos.splice(i, 0, n); return el(n); },
      getText: () => filhos.map(textoDe).join("\n"),
    };
  }
  const extras = {
    DocumentApp: {
      ElementType: TIPO, HorizontalAlignment: { CENTER: "CENTER" },
      openById: (id) => {
        if (!docs[id]) throw new Error("Document not found");
        estado.abertos.push(id);
        return { getBody: () => caixa(docs[id].filhos, true), getName: () => docs[id].nome,
                 saveAndClose: () => { docs[id].salvo = clonar(docs[id].filhos); } };
      },
    },
    DriveApp: {
      getFileById: (id) => {
        if (!docs[id]) throw new Error("File not found");
        return {
          getId: () => id, getName: () => docs[id].nome,
          getParents: () => { let ok = true; return { hasNext: () => ok, next: () => { ok = false; return { getId: () => docs[id].pasta }; } }; },
          makeCopy: (nome, pasta) => {
            const nid = "backup-" + (estado.backups.length + 1);
            estado.backups.push({ id: nid, de: id, nome, pasta: pasta.getId(), conteudo: clonar(docs[id].salvo) });
            return { getId: () => nid };
          },
        };
      },
      getRootFolder: () => ({ getId: () => "raiz" }),
    },
  };
  return { docs, estado, extras };
}

function carregar(props, modelos) {
  const d = docFalso(modelos), logs = [];
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

test("prévia: diz o que trocaria em cada modelo e não mexe em nada nem faz cópia", () => {
  const g = carregar(PROPS, MODELOS());
  const rel = g.ctx.migrarModelosAssinaturasPrevia();
  for (const id of Object.keys(MODELOS())) assert.deepEqual(g.docs[id].filhos, MODELOS()[id].filhos, id + " intacto");
  assert.equal(g.estado.backups.length, 0);
  const txt = rel.join("\n");
  assert.match(txt, /MODELO_CONDOMINIO_ID: PRÉVIA — trocaria 2 bloco\(s\)/);
  assert.match(txt, /\{\{ASSINATURAS_QUADRO\}\}/);
  assert.match(txt, /\{\{ASSINATURAS_FINAL\}\}/);
  assert.match(txt, /MODELO_CONSTRUCAO_ID: sem a propriedade/);
  assert.match(txt, /MODELO_PRE_RESERVA_ID: PRÉVIA — trocaria 1 bloco\(s\)/);
  assert.ok(g.logs.join("\n").includes("MODELO_PRONTO_ID: PRÉVIA"), "também vai para o registro de execução");
});

test("aplicar: cópia de segurança na mesma pasta ANTES; cada bloco vira um parágrafo centralizado com o marcador; o resto fica", () => {
  const g = carregar(PROPS, MODELOS());
  const rel = g.ctx.migrarModelosAssinaturasAplicar();
  assert.deepEqual(g.estado.backups.map((b) => [b.de, b.nome, b.pasta]), [
    ["m-cond", "MODELO CONDOMINIO TESTE - BACKUP antes assinaturas 01-11", "pasta-m-cond"],
    ["m-pronto", "MODELO PRONTO TESTE - BACKUP antes assinaturas 01-11", "pasta-m-pronto"],
    ["m-pre", "MODELO CONFISSAO PRE TESTE - BACKUP antes assinaturas 01-11", "pasta-m-pre"],
    ["m-pos", "MODELO CONFISSAO POS TESTE - BACKUP antes assinaturas 01-11", "pasta-m-pos"],
    ["m-pr", "MODELO PRE-RESERVA TESTE - BACKUP antes assinaturas 01-11", "pasta-m-pr"]]);
  assert.deepEqual(g.estado.backups[0].conteudo, CONDOMINIO.filhos, "a cópia é do modelo antes da troca");
  assert.match(rel.join("\n"), /MODELO_CONDOMINIO_ID: trocado 2 bloco\(s\); cópia de segurança backup-1/);

  const cond = g.docs["m-cond"].salvo;
  assert.deepEqual(textos(cond), [
    "QUADRO RESUMO", textos([QUADRO_GRANDE()])[0], "", "{{CIDADE_DATA}}.", "", "{{ASSINATURAS_QUADRO}}",
    "CLÁUSULAS E CONDIÇÕES GERAIS", "{{#COM_POS}}", "1.1 texto", "{{/COM_POS}}", "20.9 Foro.", "",
    "ASSINATURAS", "E, por estarem assim justos e contratados, assinam com 2 (duas) testemunhas.", "{{CIDADE_DATA}}.", "", "{{ASSINATURAS_FINAL}}", ""]);
  assert.equal(cond[5].al, "CENTER");
  assert.equal(cond[16].al, "CENTER");

  const pr = g.docs["m-pronto"].salvo;
  /* o bloco terminava no último parágrafo da célula: fica um vazio depois (o Docs não apaga o último parágrafo) */
  assert.deepEqual(pr[1].linhas[3][0].map((n) => n.texto), ["{{CIDADE_DATA}}.", "", "{{ASSINATURAS_QUADRO}}", ""], "bloco dentro da célula");
  assert.deepEqual(textos(pr.slice(2)), ["CLÁUSULA PRIMEIRA", "13.1 Foro.", "", "{{CIDADE_DATA}}.", "", "{{ASSINATURAS_FINAL}}", ""]);

  for (const id of ["m-pre", "m-pos"])
    assert.deepEqual(textos(g.docs[id].salvo), ["TERMO DE CONFISSÃO", "FIADOR 1: {{FIADOR1_QUADRO}};", "11.1 Integra o contrato.", "",
      "{{CIDADE_DATA}}.", "ASSINATURAS", "", "", "{{ASSINATURAS_TERMO}}", "", ""], id);
  assert.deepEqual(textos(g.docs["m-pr"].salvo).slice(3), ["{{CIDADE_DATA}}.", "", "{{ASSINATURAS_TERMO}}", ""]);
  assert.equal(g.docs["m-pr"].salvo[5].al, "CENTER", "começo em tabela: centralizado");
});

test("rodar de novo: modelo já migrado não é tocado (nem nova cópia)", () => {
  const g = carregar(PROPS, MODELOS());
  g.ctx.migrarModelosAssinaturasAplicar();
  const antes = g.estado.backups.length;
  const rel = g.ctx.migrarModelosAssinaturasAplicar();
  assert.equal(g.estado.backups.length, antes);
  assert.match(rel.join("\n"), /MODELO_CONDOMINIO_ID: já migrado/);
});

test("bloco que não dá para achar sem dúvida: o modelo fica intocado e o motivo vai para o registro", () => {
  const casos = {
    "marcador estranho no meio": (f) => { f.splice(f.findIndex((n) => n.texto === "VENDEDORA"), 0, P("{{OUTRO_MARCADOR}}")); },
    "só um bloco no contrato": (f) => { f.splice(f.findIndex((n) => n.texto === "ASSINATURAS")); f.push(P("")); },
    "sem a data antes do bloco": (f) => { f.forEach((n) => { if (n.texto === "{{CIDADE_DATA}}.") n.texto = "Goiânia."; }); },
    "COM_COMISSAO cortado": (f) => { f.splice(f.findIndex((n) => n.texto === "{{/COM_COMISSAO}}"), 1); },
  };
  for (const [nome, estraga] of Object.entries(casos)) {
    const m = clonar(CONDOMINIO);
    estraga(m.filhos);
    const g = carregar({ MODELO_CONDOMINIO_ID: "m-cond" }, { "m-cond": m });
    const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
    assert.deepEqual(g.docs["m-cond"].salvo, m.filhos, nome + ": intacto");
    assert.equal(g.estado.backups.length, 0, nome + ": sem cópia");
    assert.match(rel, /MODELO_CONDOMINIO_ID: NÃO MEXI — /, nome + ": " + rel);
  }
  /* modelo que não abre: registra e segue para os outros */
  const g = carregar({ MODELO_CONDOMINIO_ID: "nao-existe", MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": PRE_RESERVA });
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  assert.match(rel, /MODELO_CONDOMINIO_ID: NÃO MEXI — erro: Document not found/);
  assert.match(rel, /MODELO_PRE_RESERVA_ID: trocado 1 bloco/);
});

test("bloco que termina no último parágrafo do documento (o Docs não deixa apagar o último): troca mesmo assim, sem erro", () => {
  const pronto = clonar(PRONTO);
  pronto.filhos.pop();   /* sem o parágrafo vazio do fim: "CPF: … CPF:" é o último */
  const termo = clonar(TERMO("PRE"));
  termo.filhos.splice(-2);   /* termina na linha dos CPFs */
  const g = carregar({ MODELO_PRONTO_ID: "m-pronto", MODELO_CONFISSAO_PRE_ID: "m-pre" }, { "m-pronto": pronto, "m-pre": termo });
  const rel = g.ctx.migrarModelosAssinaturasAplicar().join("\n");
  assert.match(rel, /MODELO_PRONTO_ID: trocado 2 bloco/, rel);
  assert.match(rel, /MODELO_CONFISSAO_PRE_ID: trocado 1 bloco/, rel);
  assert.deepEqual(textos(g.docs["m-pronto"].salvo).slice(-3), ["", "{{ASSINATURAS_FINAL}}", ""]);
  assert.deepEqual(textos(g.docs["m-pre"].salvo).slice(-2), ["{{ASSINATURAS_TERMO}}", ""]);
});

test("pré-reserva: o papel vale com qualquer grafia do É (PRÉ-RESERVANTE / PRE-RESERVANTE)", () => {
  const pr = clonar(PRE_RESERVA);
  pr.filhos[5].linhas[0][1][1].texto = "PRE-RESERVANTE";
  const g = carregar({ MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": pr });
  assert.match(g.ctx.migrarModelosAssinaturasPrevia().join("\n"), /MODELO_PRE_RESERVA_ID: PRÉVIA — trocaria 1 bloco/);
  const so = clonar(PRE_RESERVA);
  so.filhos[5].linhas[0][1][1].texto = "PR\uFFFD-RESERVANTE";
  const g2 = carregar({ MODELO_PRE_RESERVA_ID: "m-pr" }, { "m-pr": so });
  assert.match(g2.ctx.migrarModelosAssinaturasPrevia().join("\n"), /trocaria 1 bloco/);
});
