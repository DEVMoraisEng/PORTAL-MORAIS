/* ConferenciaDocs — regras puras da CONFERÊNCIA DOS DOCUMENTOS antes do contrato do condomínio (28/10/2026).
 * A IA (OpenAI pelo leitor que já existe) lê os documentos anexados na linha da venda e o portal compara com o
 * que vai no contrato. Cada campo sai ✓ confere / ⚠ diverge (os dois valores lado a lado) / ? ilegível ou
 * faltando — no ilegível a pessoa abre o documento e confirma visualmente. Não trava o contrato: só avisa
 * (decisão do dono, 28/10). Arquivo do projeto PORTAL-VENDA (cola como ConferenciaDocs.gs) e testado no node
 * (venda/testes/conferencia.test.mjs). Sem rede. Repositório público: nenhum dado real. */
var ConferenciaDocs = (function () {
  "use strict";

  /* colunas da linha da BANCO DE DADOS VENDAS CONDOMÍNIO (documentos anexados) */
  var COL = {
    C1_ID: "DOC. PROPONENTE", C1_END: "COMPROVANTE DE ENDEREÇO", C1_CIVIL: "CERTIDÕES",
    C2_ID: "DOC. COMPRADOR 1", F1_ID: "DOC. FIADOR 1", F2_ID: "DOC. FIADOR 2"
  };
  var COLUNAS = Object.keys(COL).map(function (k) { return COL[k]; });

  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function so(v) { return txt(v).replace(/\D/g, ""); }
  function chave(v) { return R().chave(txt(v)); }

  /* O que conferir: [{ id, pessoa, coluna, tipo (esquema do leitor), campos: [{ campo, rotulo, esperado }] }].
     Só entra o que tem valor esperado; quem não existe na venda (2º comprador, fiador vazio) não entra. */
  function plano(d) {
    var out = [], c1 = d.comprador1 || {}, c2 = d.comprador2, fis = (d.condominio && d.condominio.fiadores) || [];
    function pessoa(id, rotulo, coluna, p, comRg) {
      if (!p || !txt(p.nome)) return;
      var campos = [{ campo: "nome", rotulo: "Nome", esperado: txt(p.nome) }];
      if (txt(p.cpf)) campos.push({ campo: "cpf", rotulo: "CPF", esperado: txt(p.cpf) });
      if (comRg && so(p.documento)) campos.push({ campo: "rg", rotulo: "RG", esperado: txt(p.documento) });
      out.push({ id: id, pessoa: rotulo, coluna: coluna, tipo: "identidade", documento: "RG/CNH", campos: campos });
    }
    pessoa("c1-id", "Comprador 1", COL.C1_ID, c1, true);
    if (txt(c1.endereco)) out.push({ id: "c1-end", pessoa: "Comprador 1", coluna: COL.C1_END, tipo: "comprovante", documento: "comprovante de endereço",
                                     campos: [{ campo: "endereco", rotulo: "Endereço", esperado: txt(c1.endereco) }] });
    if (txt(c1.estadoCivil)) out.push({ id: "c1-civil", pessoa: "Comprador 1", coluna: COL.C1_CIVIL, tipo: "certidao_civil", documento: "certidão",
                                        campos: [{ campo: "estado_civil", rotulo: "Estado civil", esperado: txt(c1.estadoCivil) }] });
    pessoa("c2-id", "Comprador 2", COL.C2_ID, c2, true);
    pessoa("f1-id", "Fiador 1", COL.F1_ID, fis[0], false);
    pessoa("f2-id", "Fiador 2", COL.F2_ID, fis[1], false);
    return out;
  }

  /* ---- comparações (o lido vem da IA; "" = ilegível/ausente) ---- */
  function palavras(s) { return chave(s).split(/[^A-Z0-9]+/).filter(function (w) { return w.length >= 2; }); }
  function nomeConfere(esp, lido) {
    var a = palavras(esp), b = palavras(lido);
    if (!a.length || !b.length) return false;
    if (a.join(" ") === b.join(" ")) return true;
    /* nome do meio abreviado ou omitido: primeiro e último iguais e o resto de um contido no outro */
    if (a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1]) return false;
    var menor = a.length <= b.length ? a : b, maior = menor === a ? b : a;
    return menor.every(function (w) { return maior.some(function (x) { return x === w || (w.length === 1 && x[0] === w); }); });
  }
  function enderecoConfere(esp, lido) {
    var a = palavras(esp).filter(function (w) { return w.length >= 3 || /^\d+$/.test(w); }), b = palavras(lido);
    if (!a.length || !b.length) return false;
    var achou = a.filter(function (w) { return b.indexOf(w) >= 0; }).length;
    var cepA = so(esp).match(/\d{8}/), cepB = so(lido).match(/\d{8}/);
    if (cepA && cepB && cepA[0] !== cepB[0]) return false;
    return achou / a.length >= 0.6;
  }
  var CIVIL = { CERTIDAO_NASCIMENTO: "SOLTEIR", CERTIDAO_CASAMENTO: "CASAD", AVERBACAO_DIVORCIO: "DIVORCIAD", CERTIDAO_OBITO: "VIUV" };
  function civilDoDocumento(leitura) {
    var e = chave(leitura && leitura.estado_civil);
    if (e) return e;
    return CIVIL[leitura && leitura.tipo_documento] || "";
  }
  function civilConfere(esp, lido) {
    var a = chave(esp), b = chave(lido);
    var raiz = ["SOLTEIR", "CASAD", "DIVORCIAD", "VIUV", "SEPARAD"];
    var ra = raiz.filter(function (r) { return a.indexOf(r) === 0; })[0], rb = raiz.filter(function (r) { return b.indexOf(r) === 0; })[0];
    return !!ra && ra === rb;
  }

  /* valor lido para um campo, a partir da leitura da IA (esquemas do OpenAILeitor) */
  function lidoDe(tipo, campo, leitura) {
    leitura = leitura || {};
    if (tipo === "identidade") {
      if (campo === "nome") return txt(leitura.nome);
      if (campo === "cpf") return txt(leitura.cpf);
      if (campo === "rg") return txt(leitura.rg_numero) || (leitura.tipo_documento === "RG" ? txt(leitura.numero_documento) : "");
    }
    if (tipo === "comprovante" && campo === "endereco") return txt(leitura.endereco_completo);
    if (tipo === "certidao_civil" && campo === "estado_civil") return civilDoDocumento(leitura);
    return "";
  }

  /* Uma linha do resultado: { situacao: "ok" | "diverge" | "ilegivel", esperado, lido } */
  function comparar(campo, esperado, lido) {
    if (!txt(lido)) return { situacao: "ilegivel", esperado: esperado, lido: "" };
    var ok;
    if (campo === "cpf") ok = so(esperado) === so(lido);
    else if (campo === "rg") { var a = so(esperado), b = so(lido); ok = !!a && !!b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0); }
    else if (campo === "nome") ok = nomeConfere(esperado, lido);
    else if (campo === "endereco") ok = enderecoConfere(esperado, lido);
    else if (campo === "estado_civil") ok = civilConfere(esperado, lido);
    else ok = chave(esperado) === chave(lido);
    return { situacao: ok ? "ok" : "diverge", esperado: esperado, lido: lido };
  }

  /* Junta o plano com as leituras: leituras = { id: { ok, leitura?, erro? } } -> linhas da tela */
  function resultado(itens, leituras) {
    var linhas = [];
    itens.forEach(function (it) {
      var l = leituras[it.id] || { ok: false, erro: "SEM_ARQUIVO" };
      var docErrado = l.ok && l.leitura && l.leitura.tipo_documento === "OUTRO";
      it.campos.forEach(function (c) {
        var base = { item: it.id, pessoa: it.pessoa, documento: it.documento, coluna: it.coluna, campo: c.campo, rotulo: c.rotulo };
        var cmp;
        if (!l.ok) cmp = { situacao: "ilegivel", esperado: c.esperado, lido: "", motivo: l.erro === "SEM_ARQUIVO" ? "documento não anexado" : "não deu para ler" };
        else if (docErrado) cmp = { situacao: "ilegivel", esperado: c.esperado, lido: "", motivo: "o arquivo não parece ser " + it.documento };
        else cmp = comparar(c.campo, c.esperado, lidoDe(it.tipo, c.campo, l.leitura));
        for (var k in cmp) base[k] = cmp[k];
        linhas.push(base);
      });
    });
    return linhas;
  }

  /* Resumo para o aviso do pré-contrato: "" quando está tudo conferido. */
  function resumo(linhas, confirmados) {
    confirmados = confirmados || {};
    var div = 0, pend = 0;
    (linhas || []).forEach(function (l, i) {
      if (l.situacao === "diverge" && !confirmados[i]) div++;
      if (l.situacao === "ilegivel" && !confirmados[i]) pend++;
    });
    var p = [];
    if (div) p.push(div + " divergência" + (div > 1 ? "s" : ""));
    if (pend) p.push(pend + (pend > 1 ? " itens" : " item") + " sem conferir (ilegível ou sem documento)");
    return p.join(" e ");
  }

  var api = { COL: COL, COLUNAS: COLUNAS, plano: plano, comparar: comparar, lidoDe: lidoDe, resultado: resultado, resumo: resumo,
              nomeConfere: nomeConfere, enderecoConfere: enderecoConfere, civilConfere: civilConfere };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
