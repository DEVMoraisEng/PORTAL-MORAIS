/* CondominioVenda — regras puras do "Gerar venda" do condomínio.
 * Arquivo do projeto PORTAL-VENDA (cola como CondominioVenda.gs) e testado no
 * node (venda/testes/condominio-venda.test.mjs). Sem rede, sem Notion.
 *
 * Origem: uma linha da BANCO DE DADOS VENDAS CONDOMÍNIO (a "pasta do cliente"
 * que o corretor monta). Destino: uma casa nova na VENDAS.
 * Entrada: `props` = as propriedades da página do condomínio como a API do
 * Notion devolve ({nome: {type, ...}}). `schema` = colunas da VENDAS,
 * {nome: {tipo, opcoes}} (ou {nome: "tipo"}).
 * Nomes de coluna das duas bases têm espaço sobrando ("CLIENTES ", " COMISSÃO "):
 * tudo é comparado pelo nome normalizado (RegrasVenda.chave).
 *
 * QUEM É QUEM (regra escolhida):
 * - PROPONENTE é sempre o comprador 1 da VENDAS.
 * - O bloco "… COMPRADOR 1" do condomínio (CPF, RG, e-mail, celular, DOC.,
 *   COMP. END.) só vira o comprador 2 da VENDAS quando o campo COMPRADOR 1 tem
 *   um nome DIFERENTE do PROPONENTE (`temSegundo`). Vazio ou igual ao
 *   PROPONENTE: o bloco é do próprio proponente, e serve de reserva para o que
 *   faltar nos campos "… PROPONENTE".
 * - O endereço em texto do comprador 1 vem do bloco ENDERECO/NUMERO/SETOR/
 *   CIDADE/CEP COMPRADOR 1 (o ENDEREÇO/SETOR/CIDADE soltos do condomínio são da
 *   casa, não da pessoa). Com segundo comprador, o mesmo bloco também vai para o
 *   comprador 2 (é o dono do bloco; casal costuma morar junto). A leitura do
 *   comprovante pelo dossiê substitui esse texto depois, se for diferente.
 * - Arquivos: o comprovante COMP. END. COMPRADOR 1 é de quem é dono do bloco —
 *   com segundo comprador vai para o comprador 2 e NUNCA para o 1 (não se
 *   duplica o mesmo comprovante nos dois); sem segundo, é reserva do comprador 1
 *   quando COMPROVANTE DE ENDEREÇO está vazio. Mesma lógica para DOC. COMPRADOR 1.
 * - O COMPRADOR 2 e o CONJUGE do condomínio não têm lugar na VENDAS (só cabem
 *   dois compradores): não são copiados e viram aviso. */
var CondominioVenda = (function () {
  "use strict";

  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }

  var COLUNA_ID = "CONDOMÍNIO - VENDA ID";
  var TIPOS_COPIAVEIS = ["rich_text", "number", "date", "select", "email", "phone_number", "url"];
  var PREFIXOS_FORA = ["MC - ", "ASSINATURA - ", "DOSSIE", "SITUACAO"];
  var LIMITE_TEXTO = 1900;

  function chave(s) { return R().chave(s); }
  function vazio(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) return !v.start;
    return R().vazio(v);
  }

  /* valor simples de uma propriedade do Notion: texto, número, {start,end}, lista de arquivos */
  function valor(pr) {
    if (!pr) return null;
    switch (pr.type) {
      case "title": case "rich_text":
        return (pr[pr.type] || []).map(function (t) { return t.plain_text || (t.text && t.text.content) || ""; }).join("").trim();
      case "number": return typeof pr.number === "number" ? pr.number : null;
      case "select": return pr.select ? pr.select.name : null;
      case "email": return pr.email || null;
      case "phone_number": return pr.phone_number || null;
      case "url": return pr.url || null;
      case "date": return pr.date && pr.date.start ? { start: pr.date.start, end: pr.date.end || null } : null;
      case "files": return pr.files || [];
      default: return null;
    }
  }

  /* leitor por nome normalizado */
  function leitor(props) {
    var porChave = {};
    Object.keys(props || {}).forEach(function (n) { porChave[chave(n)] = n; });
    function real(nome) { return porChave[chave(nome)]; }
    function v(nome) { var r = real(nome); return r ? valor(props[r]) : null; }
    function primeiro() {
      for (var i = 0; i < arguments.length; i++) { var x = v(arguments[i]); if (!vazio(x)) return x; }
      return null;
    }
    return { real: real, v: v, primeiro: primeiro };
  }

  function normSchema(schema) {
    var s = {};
    Object.keys(schema || {}).forEach(function (n) {
      var x = schema[n];
      s[n] = typeof x === "string" ? { tipo: x, opcoes: [] } : { tipo: x.tipo, opcoes: x.opcoes || [] };
    });
    return s;
  }
  function realNoSchema(schema, nome) {
    var k = chave(nome), ns = Object.keys(schema || {});
    for (var i = 0; i < ns.length; i++) if (chave(ns[i]) === k) return ns[i];
    return null;
  }
  function foraDaCopia(nome) {
    var k = chave(nome);
    if (k === chave(COLUNA_ID)) return true;
    for (var i = 0; i < PREFIXOS_FORA.length; i++) if (k.indexOf(PREFIXOS_FORA[i]) === 0) return true;
    return false;
  }

  function temSegundo(props) {
    var L = leitor(props), c1 = L.v("COMPRADOR 1");
    return !vazio(c1) && chave(c1) !== chave(L.v("PROPONENTE"));
  }
  function juntar(partes, sep) {
    return partes.filter(function (x) { return !vazio(x); }).map(function (x) { return String(x).trim(); }).join(sep);
  }
  function enderecoBloco1(L) {
    var rua = juntar([L.v("ENDERECO COMPRADOR 1"), L.v("NUMERO COMPRADOR 1")], ", ");
    var cep = L.v("CEP COMPRADOR 1");
    return juntar([rua, L.v("SETOR COMPRADOR 1"), L.v("CIDADE COMPRADOR 1"), vazio(cep) ? "" : "CEP " + String(cep).trim()], " - ");
  }
  function numeroDaCasa(unidade) {
    var m = /\d+/.exec(String(unidade || ""));
    return m ? Number(m[0]) : null;
  }
  function formatarCpfSeValido(cpf) {
    return R().cpfValido(cpf) ? R().formatarCpf(cpf) : cpf;
  }

  /* {coluna da VENDAS: valor}. Só entra o que tem valor (nunca apaga nada no destino). */
  function mapear(props, schemaVendas) {
    var L = leitor(props), seg = temSegundo(props), out = {}, usadas = {};
    function por(col, v) {
      if (vazio(v)) return;
      out[col] = v; usadas[chave(col)] = true;
    }
    var cond = L.v("CONDOMÍNIO");
    if (!vazio(cond)) por("ENDEREÇO", chave(cond).indexOf("CONDOMINIO") === 0 ? String(cond).trim() : "CONDOMÍNIO " + String(cond).trim());
    por("CASA", numeroDaCasa(L.v("UNIDADE")));

    /* comprador 1 = PROPONENTE (com o bloco COMPRADOR 1 de reserva quando ele é o próprio proponente) */
    var res = function (doProp, doBloco) { return seg ? L.primeiro(doProp) : L.primeiro(doProp, doBloco); };
    var prop = L.v("PROPONENTE"), nomeC2 = seg ? String(L.v("COMPRADOR 1")).trim() : "";
    por("CLIENTES", vazio(prop) ? (seg ? "" : L.v("COMPRADOR 1")) : String(prop).trim() + (nomeC2 ? " E " + nomeC2 : ""));
    var cpf1 = res("CPF PROPONENTE", "CPF COMPRADOR 1");
    por("CPF", vazio(cpf1) ? null : formatarCpfSeValido(cpf1));
    var email1 = res("Email", "EMAIL COMPRADOR 1");
    por("Email", email1);
    por("COMPRADOR 1 - E-MAIL", email1);
    por("Nº Whatsapp", res("Nº Whatsapp", "CELULAR COMPRADOR 1"));
    por("COMPRADOR 1 - ESTADO CIVIL", L.v("ESTADO CIVIL"));
    por("COMPRADOR 1 - PROFISSÃO", res("PROFISSÃO PROPONENTE", "PROFISSÃO COMPRADOR 1"));
    por("COMPRADOR 1 - NACIONALIDADE", res("NACIONALIDADE PROPONENTE", "NACIONALIDADE COMPRADOR 1"));
    por("COMPRADOR 1 - ENDEREÇO", enderecoBloco1(L));
    var rg1 = res("RG PROPONENTE", "RG COMPRADOR 1");
    por("COMPRADOR 1 - DOCUMENTO", vazio(rg1) ? null : (/^\s*RG\b/i.test(rg1) ? rg1 : "RG " + String(rg1).trim()));

    /* comprador 2 = COMPRADOR 1 do condomínio, quando é outra pessoa */
    if (seg) {
      por("COMPRADOR 2 - NOME", nomeC2);
      var cpf2 = L.v("CPF COMPRADOR 1");
      por("COMPRADOR 2 - CPF", vazio(cpf2) ? null : formatarCpfSeValido(cpf2));
      por("COMPRADOR 2 - E-MAIL", L.v("EMAIL COMPRADOR 1"));
      por("COMPRADOR 2 - TELEFONE", L.v("CELULAR COMPRADOR 1"));
      por("COMPRADOR 2 - PROFISSÃO", L.v("PROFISSÃO COMPRADOR 1"));
      por("COMPRADOR 2 - NACIONALIDADE", L.v("NACIONALIDADE COMPRADOR 1"));
      por("COMPRADOR 2 - ENDEREÇO", enderecoBloco1(L));
      var rg2 = L.v("RG COMPRADOR 1");
      por("COMPRADOR 2 - DOCUMENTO", vazio(rg2) ? null : (/^\s*RG\b/i.test(rg2) ? rg2 : "RG " + String(rg2).trim()));
    }

    /* venda */
    por("DATA DA VENDA", L.v("DATA DA VENDA"));
    por("DATA DE ASSINATURA DO CONTRATO", L.v("DATA DE ASSINATURA DO CONTRATO"));
    por("VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)", L.v("VALOR DE VENDA"));
    por("VALOR FINANCIADO", L.v("VALOR DO CRÉDITO"));
    por("VALOR DO SUBSÍDIO", L.v("SUBISÍDIO"));
    por("VALOR DO FGTS", L.v("VALOR DO FGTS"));
    /* texto no condomínio, select na VENDAS: vira a opção de mesmo nome (ou uma nova) */
    por("CORRETOR", L.v("CORRETOR"));
    por("IMOBILIÁRIA", L.v("IMOBILIÁRIA"));
    /* o que veio do bloco COMPRADOR 1 não pode ser recopiado por "mesmo nome" */
    usadas[chave(COLUNA_ID)] = true;

    /* demais colunas de mesmo nome e mesmo tipo nas duas bases */
    var sch = normSchema(schemaVendas);
    Object.keys(props || {}).forEach(function (n) {
      var pr = props[n];
      if (!pr || TIPOS_COPIAVEIS.indexOf(pr.type) < 0 || foraDaCopia(n) || usadas[chave(n)]) return;
      var destino = realNoSchema(sch, n);
      if (!destino || sch[destino].tipo !== pr.type || foraDaCopia(destino)) return;
      por(destino, valor(pr));
    });
    return out;
  }

  /* avisos para a tela (sem nome nem documento de ninguém) */
  function avisos(props) {
    var L = leitor(props), a = [];
    if (!vazio(L.v("COMPRADOR 2")))
      a.push("A venda do condomínio tem um COMPRADOR 2 — a VENDAS só tem lugar para dois compradores; os dados dele não foram copiados.");
    if (!vazio(L.v("CONJUGE")) && chave(L.v("CONJUGE")) !== chave(L.v("COMPRADOR 1")))
      a.push("A venda do condomínio tem CÔNJUGE preenchido — se ele também compra, complete o comprador 2 na casa.");
    if (vazio(L.v("PROPONENTE"))) a.push("O PROPONENTE está vazio no condomínio — confira os compradores na casa.");
    return a;
  }

  /* pares de colunas de arquivos: {de (coluna do condomínio), para (coluna da VENDAS), arquivos} */
  function arquivosParaCopiar(props, schemaVendas) {
    var L = leitor(props), seg = temSegundo(props), out = [], destinos = {};
    function par(para) {
      var cands = Array.prototype.slice.call(arguments, 1);
      if (destinos[chave(para)]) return;
      for (var i = 0; i < cands.length; i++) {
        var real = L.real(cands[i]), fs = real ? valor(props[real]) : null;
        if (real && props[real].type === "files" && fs && fs.length) {
          out.push({ de: real, para: para, arquivos: fs });
          destinos[chave(para)] = true;
          return;
        }
      }
    }
    if (seg) {
      par("COMPRADOR 1 - IDENTIDADE", "DOC. PROPONENTE");
      par("COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "COMPROVANTE DE ENDEREÇO");
      par("COMPRADOR 2 - IDENTIDADE", "DOC. COMPRADOR 1");
      par("COMPRADOR 2 - COMPROVANTE DE ENDEREÇO", "COMP. END. COMPRADOR 1");
    } else {
      par("COMPRADOR 1 - IDENTIDADE", "DOC. PROPONENTE", "DOC. COMPRADOR 1");
      par("COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "COMPROVANTE DE ENDEREÇO", "COMP. END. COMPRADOR 1");
    }
    var sch = normSchema(schemaVendas);
    Object.keys(props || {}).forEach(function (n) {
      var pr = props[n];
      if (!pr || pr.type !== "files" || foraDaCopia(n)) return;
      var destino = realNoSchema(sch, n);
      if (!destino || sch[destino].tipo !== "files" || foraDaCopia(destino)) return;
      par(destino, n);
    });
    return out;
  }

  /* {coluna: valor} → propriedades do Notion pelo tipo real de cada coluna da VENDAS.
     Coluna que não existe (ou de tipo que não dá para gravar) vai para `ignoradas`. */
  function textoDe(v) {
    if (v && typeof v === "object" && v.start) return v.start;
    return String(v).slice(0, LIMITE_TEXTO);
  }
  function propriedadesNotion(mapa, schemaVendas) {
    var sch = normSchema(schemaVendas), props = {}, ignoradas = [];
    Object.keys(mapa || {}).forEach(function (col) {
      var v = mapa[col], real = realNoSchema(sch, col);
      if (vazio(v)) return;
      if (!real) { ignoradas.push(col); return; }
      var tipo = sch[real].tipo, p = null;
      switch (tipo) {
        case "title": p = { title: [{ type: "text", text: { content: textoDe(v) } }] }; break;
        case "rich_text": p = { rich_text: [{ type: "text", text: { content: textoDe(v) } }] }; break;
        case "number":
          var n = typeof v === "number" ? v : R().valorBR(textoDe(v));
          if (n !== null && isFinite(n)) p = { number: n };
          break;
        case "select":
          /* opção existente (sem diferença de acento/caixa) ou uma nova; o Notion não aceita vírgula no nome */
          var op = R().resolverOpcao(sch[real].opcoes, textoDe(v).replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 100));
          if (op) p = { select: { name: op } };
          break;
        case "date":
          var ini = typeof v === "object" ? v.start : R().dataDoc(v);
          if (ini) p = { date: { start: ini, end: (typeof v === "object" && v.end) || null } };
          break;
        case "email": p = { email: textoDe(v) }; break;
        case "phone_number": p = { phone_number: textoDe(v) }; break;
        case "url": p = { url: textoDe(v) }; break;
      }
      if (p) props[real] = p; else ignoradas.push(col);
    });
    return { props: props, ignoradas: ignoradas };
  }

  return {
    COLUNA_ID: COLUNA_ID, valor: valor, temSegundo: temSegundo, mapear: mapear, avisos: avisos,
    arquivosParaCopiar: arquivosParaCopiar, propriedadesNotion: propriedadesNotion, numeroDaCasa: numeroDaCasa
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = CondominioVenda;
