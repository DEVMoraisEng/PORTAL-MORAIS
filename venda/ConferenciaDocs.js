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
    C2_ID: "DOC. COMPRADOR 1", F1_ID: "DOC. FIADOR 1", F2_ID: "DOC. FIADOR 2",
    CJ_ID: "DOC. CONJUGE"   /* 07/11/2026 (dono): o cônjuge do comprador 1 também é conferido */
  };
  var COLUNAS = Object.keys(COL).map(function (k) { return COL[k]; });

  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function so(v) { return txt(v).replace(/\D/g, ""); }
  function chave(v) { return R().chave(txt(v)); }

  /* O que conferir: [{ id, pessoa, coluna, tipo (esquema do leitor), campos: [{ campo, rotulo, esperado, opcional? }] }].
     Quem não existe na venda (2º comprador, fiador vazio) não entra. 07/11/2026 (dono, unidade 14): campo VAZIO no
     cadastro também entra (opcional) — lido no documento, vira "falta no cadastro"; vazio nos dois, não aparece.
     v(nome) = valor da coluna da linha do condomínio (nascimento e dados do cônjuge, que o contrato não carrega). */
  function plano(d, v) {
    v = v || function () { return ""; };
    var out = [], c1 = d.comprador1 || {}, c2 = d.comprador2, fis = (d.condominio && d.condominio.fiadores) || [];
    /* extra: nacionalidade e nascimento só se conferem quando o documento traz o valor (sem linha "ilegível") */
    function campo(campos, id, rotulo, esperado, extra) {
      var e = txt(esperado), c = e ? { campo: id, rotulo: rotulo, esperado: e } : { campo: id, rotulo: rotulo, esperado: "", opcional: true };
      if (extra) c.extra = true;
      campos.push(c);
    }
    function pessoa(id, rotulo, coluna, p, extra) {
      if (!p || !txt(p.nome)) return;
      var campos = [{ campo: "nome", rotulo: "Nome", esperado: txt(p.nome) }];
      campo(campos, "cpf", "CPF", p.cpf);
      if (extra) {
        campo(campos, "rg", "RG", so(p.documento) ? p.documento : "");
        campo(campos, "nacionalidade", "Nacionalidade", p.nacionalidade, true);
        campo(campos, "nascimento", "Nascimento", dataBR(extra.nascimento), true);   /* 07/11/2026 (dono): 05/01/1976, não 1976-01-05 */
      }
      out.push({ id: id, pessoa: rotulo, coluna: coluna, tipo: "identidade", documento: "RG/CNH", campos: campos });
    }
    pessoa("c1-id", "Comprador 1", COL.C1_ID, c1, { nascimento: v("DATA NASCIMENTO PROPONENTE") });
    if (txt(c1.endereco)) out.push({ id: "c1-end", pessoa: "Comprador 1", coluna: COL.C1_END, tipo: "comprovante", documento: "comprovante de endereço",
                                     campos: [{ campo: "endereco", rotulo: "Endereço", esperado: txt(c1.endereco) }] });
    if (txt(c1.estadoCivil)) out.push({ id: "c1-civil", pessoa: "Comprador 1", coluna: COL.C1_CIVIL, tipo: "certidao_civil", documento: "certidão",
                                        campos: [{ campo: "estado_civil", rotulo: "Estado civil", esperado: txt(c1.estadoCivil) }] });
    pessoa("c2-id", "Comprador 2", COL.C2_ID, c2, { nascimento: v("DATA NASCIMENTO COMPRADOR 1") });
    /* 07/11/2026 (dono): cônjuge do comprador 1 — salvo quando ele já é o comprador 2 (mesmo CPF ou nome) */
    var cj = d.condominio && d.condominio.conjugeComprador;
    var ehC2 = cj && c2 && ((so(cj.cpf) && so(cj.cpf) === so(c2.cpf)) || chave(cj.nome) === chave(c2.nome));
    if (cj && txt(cj.nome) && !ehC2)
      pessoa("cj-id", "Cônjuge do comprador 1", COL.CJ_ID,
             { nome: cj.nome, cpf: cj.cpf, documento: v("RG CONJUGE"), nacionalidade: v("NACIONALIDADE CONJUGE") },
             { nascimento: v("DATA NASCIMENTO CONJUGE") });
    pessoa("f1-id", "Fiador 1", COL.F1_ID, fis[0], false);
    pessoa("f2-id", "Fiador 2", COL.F2_ID, fis[1], false);
    return out;
  }

  /* 31/10/2026 (dono): "Corrigir aqui" na conferência — em que coluna(s) da linha do condomínio mora o campo
   * conferido, pela mesma regra do CondominioVenda.mapear (PROPONENTE é o comprador 1; o bloco "… COMPRADOR 1"
   * é o comprador 2 quando é outra pessoa, ou a reserva do proponente). `seg` = CondominioVenda.temSegundo;
   * `v(nome)` = valor atual da coluna. Devolve [{ coluna, rotulo }] (o endereço são cinco colunas) ou [] quando
   * o campo não se corrige aqui. */
  var OPCOES_CIVIL = ["SOLTEIRO", "CASADO", "DIVORCIADO", "VIUVO", "UNIAO ESTAVEL"];   /* completar-venda.html */
  var END_PROPONENTE = [["ENDEREÇO", "Rua"], ["NÚMERO", "Número"], ["SETOR", "Setor"], ["CIDADE", "Cidade"], ["CEP", "CEP"]];
  var END_BLOCO1 = [["ENDERECO COMPRADOR 1", "Rua"], ["NUMERO COMPRADOR 1", "Número"], ["SETOR COMPRADOR 1", "Setor"],
                    ["CIDADE COMPRADOR 1", "Cidade"], ["CEP COMPRADOR 1", "CEP"]];
  function camposParaCorrigir(item, campo, seg, v) {
    v = v || function () { return ""; };
    function um(coluna, rotulo) { return [{ coluna: coluna, rotulo: rotulo }]; }
    /* comprador 1: o campo do proponente, ou o do bloco "… COMPRADOR 1" quando é ele que está preenchido (reserva) */
    function doC1(doProp, doBloco, rotulo) {
      if (seg || txt(v(doProp)) || !txt(v(doBloco))) return um(doProp, rotulo);
      return um(doBloco, rotulo);
    }
    var f = /^f([12])-id$/.exec(item);
    if (item === "c1-id") {
      if (campo === "nome") return doC1("PROPONENTE", "COMPRADOR 1", "Nome");
      if (campo === "cpf") return doC1("CPF PROPONENTE", "CPF COMPRADOR 1", "CPF");
      if (campo === "rg") return doC1("RG PROPONENTE", "RG COMPRADOR 1", "RG");
      if (campo === "nacionalidade") return doC1("NACIONALIDADE PROPONENTE", "NACIONALIDADE COMPRADOR 1", "Nacionalidade");
      if (campo === "nascimento") return doC1("DATA NASCIMENTO PROPONENTE", "DATA NASCIMENTO COMPRADOR 1", "Nascimento");
    } else if (item === "cj-id") {
      if (campo === "nome") return um("CONJUGE", "Nome");
      if (campo === "cpf") return um("CPF CONJUGE", "CPF");
      if (campo === "rg") return um("RG CONJUGE", "RG");
      if (campo === "nacionalidade") return um("NACIONALIDADE CONJUGE", "Nacionalidade");
      if (campo === "nascimento") return um("DATA NASCIMENTO CONJUGE", "Nascimento");
    } else if (item === "c1-end" && campo === "endereco") {
      var temProp = END_PROPONENTE.some(function (x) { return txt(v(x[0])); });
      var lista = seg || temProp || !END_BLOCO1.some(function (x) { return txt(v(x[0])); }) ? END_PROPONENTE : END_BLOCO1;
      return lista.map(function (x) { return { coluna: x[0], rotulo: x[1] }; });
    } else if (item === "c1-civil" && campo === "estado_civil") {
      /* a coluna é texto: as mesmas opções que o "completar venda" grava (teste de tela de 31/10 abriu texto livre) */
      return [{ coluna: "ESTADO CIVIL", rotulo: "Estado civil", opcoes: OPCOES_CIVIL.slice() }];
    } else if (item === "c2-id" && seg) {
      if (campo === "nome") return um("COMPRADOR 1", "Nome");
      if (campo === "cpf") return um("CPF COMPRADOR 1", "CPF");
      if (campo === "rg") return um("RG COMPRADOR 1", "RG");
      if (campo === "nacionalidade") return um("NACIONALIDADE COMPRADOR 1", "Nacionalidade");
      if (campo === "nascimento") return um("DATA NASCIMENTO COMPRADOR 1", "Nascimento");
    } else if (f) {
      if (campo === "nome") return um("FIADOR " + f[1], "Nome");
      if (campo === "cpf") return um("CPF FIADOR " + f[1], "CPF");
    }
    return [];
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
      if (campo === "nacionalidade") return txt(leitura.nacionalidade);
      if (campo === "nascimento") return txt(leitura.data_nascimento);
    }
    if (tipo === "comprovante" && campo === "endereco") return txt(leitura.endereco_completo);
    if (tipo === "certidao_civil" && campo === "estado_civil") return civilDoDocumento(leitura);
    return "";
  }

  /* 07/11/2026: a CNH escreve "BRASILEIRO" para todos — BR/Brasil/brasileiro(a) conferem entre si (o gênero não se
     confere pelo documento); outra nacionalidade, pela palavra. */
  function nacionalidadeConfere(esp, lido) {
    var a = chave(esp), b = chave(lido), br = function (x) { return /^(BR|BRASIL)/.test(x); };
    return br(a) || br(b) ? br(a) && br(b) : a === b;
  }
  /* "1970-02-03" → "03/02/1970" (o que a tela mostra); outra coisa, como veio */
  function dataBR(s) { var d = dataISO(s); return d ? d.slice(6, 8) + "/" + d.slice(4, 6) + "/" + d.slice(0, 4) : txt(s); }
  /* "1970-02-03", "03/02/1970" ou "03021970" → "19700203"; outra coisa → "" */
  function dataISO(s) {
    var t = txt(s), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return m[1] + m[2] + m[3];
    if ((m = /^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/.exec(t))) return m[3] + m[2] + m[1];
    if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) return m[3] + m[2] + m[1];
    return "";
  }
  /* Uma linha do resultado: { situacao: "ok" | "diverge" | "ilegivel" | "falta", esperado, lido }
     "falta" (07/11/2026): vazio no cadastro e lido no documento — o "Corrigir aqui" oferece o valor do documento. */
  function comparar(campo, esperado, lido) {
    if (!txt(lido)) return { situacao: "ilegivel", esperado: esperado, lido: "" };
    var ok;
    if (campo === "cpf") ok = so(esperado) === so(lido);
    else if (campo === "rg") { var a = so(esperado), b = so(lido); ok = !!a && !!b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0); }
    else if (campo === "nome") ok = nomeConfere(esperado, lido);
    else if (campo === "endereco") ok = enderecoConfere(esperado, lido);
    else if (campo === "estado_civil") ok = civilConfere(esperado, lido);
    else if (campo === "nacionalidade") ok = nacionalidadeConfere(esperado, lido);
    else if (campo === "nascimento") ok = !!dataISO(esperado) && dataISO(esperado) === dataISO(lido);
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
        if (c.opcional) {   /* vazio no cadastro: só aparece se o documento trouxer o valor */
          var lidoOp = l.ok && !docErrado ? txt(lidoDe(it.tipo, c.campo, l.leitura)) : "";
          if (!lidoOp) return;
          base.situacao = "falta"; base.esperado = ""; base.lido = lidoOp;
          linhas.push(base);
          return;
        }
        if (!l.ok && c.extra) return;   /* sem documento: a linha do nome já diz "não anexado" */
        if (!l.ok) {
          /* 01/11/2026 (H2): sem arquivo não é "ilegível" — semArquivo deixa a tela e o resumo dizerem "não anexado" */
          cmp = { situacao: "ilegivel", esperado: c.esperado, lido: "", motivo: l.erro === "SEM_ARQUIVO" ? "documento não anexado" : "não deu para ler" };
          if (l.erro === "SEM_ARQUIVO") cmp.semArquivo = true;
        }
        else if (c.extra && !txt(lidoDe(it.tipo, c.campo, l.leitura))) return;   /* o documento não traz: não confere */
        else if (docErrado) cmp = { situacao: "ilegivel", esperado: c.esperado, lido: "", motivo: "o arquivo não parece ser " + it.documento };
        else cmp = comparar(c.campo, c.esperado, lidoDe(it.tipo, c.campo, l.leitura));
        for (var k in cmp) base[k] = cmp[k];
        linhas.push(base);
      });
    });
    return linhas;
  }

  /* linhas guardadas antes do semArquivo existir só têm o motivo escrito */
  function naoAnexado(l) { return !!(l && (l.semArquivo || l.motivo === "documento não anexado")); }

  /* 03/11/2026 (dono): a conferência rodou antes de a fila copiar os documentos da proposta para a venda e ficou
     "não anexado" com os arquivos já na linha. A conferência guarda quantos arquivos havia em cada coluna;
     se a conta de agora for outra, ela ficou velha. `contar(coluna)` = quantos arquivos a coluna tem agora. */
  function contagemArquivos(contar) {
    var o = {};
    COLUNAS.forEach(function (c) { o[c] = Number(contar(c)) || 0; });
    return o;
  }
  function anexosMudaram(o, agora) {
    if (!o || !agora) return false;
    if (o.arquivos) return COLUNAS.some(function (c) { return (o.arquivos[c] || 0) !== (agora[c] || 0); });
    /* conferência guardada antes da contagem: só o que estava "não anexado" e agora tem arquivo */
    return (o.linhas || []).some(function (l) { return naoAnexado(l) && (agora[l.coluna] || 0) > 0; });
  }

  /* Resumo para o aviso do pré-contrato: "" quando está tudo conferido. */
  function resumo(linhas, confirmados) {
    confirmados = confirmados || {};
    var div = 0, pend = 0, sem = 0, falta = 0;
    (linhas || []).forEach(function (l, i) {
      if (l.situacao === "diverge" && !confirmados[i]) div++;
      if (l.situacao === "falta" && !confirmados[i]) falta++;
      if (l.situacao === "ilegivel" && !confirmados[i]) { if (naoAnexado(l)) sem++; else pend++; }
    });
    var p = [];
    if (div) p.push(div + " divergência" + (div > 1 ? "s" : ""));
    if (pend) p.push(pend + (pend > 1 ? " itens ilegíveis" : " item ilegível"));
    if (sem) p.push(sem + (sem > 1 ? " itens não anexados" : " item não anexado"));
    if (falta) p.push(falta + " faltando no cadastro");
    return p.length > 1 ? p.slice(0, -1).join(", ") + " e " + p[p.length - 1] : p.join("");
  }

  var api = { COL: COL, COLUNAS: COLUNAS, plano: plano, comparar: comparar, lidoDe: lidoDe, resultado: resultado, resumo: resumo,
              nomeConfere: nomeConfere, enderecoConfere: enderecoConfere, civilConfere: civilConfere, dataISO: dataISO,
              camposParaCorrigir: camposParaCorrigir, contagemArquivos: contagemArquivos, anexosMudaram: anexosMudaram };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
