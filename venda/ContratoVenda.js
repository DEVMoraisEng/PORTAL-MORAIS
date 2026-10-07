/* ContratoVenda — regras puras do contrato de compra e venda (entrega 2).
 * Roda igual no Apps Script (arquivo ContratoVenda.gs do projeto PORTAL-VENDA)
 * e no node (testes em venda/testes). Sem rede, sem Notion, sem Drive.
 * Repositório público: nenhum dado real aqui nem nos testes. */
var ContratoVenda = (function () {
  "use strict";

  var COL = {
    ALVARA_NUMERO: "CONTRATO - ALVARÁ Nº",
    ALVARA_DATA: "CONTRATO - ALVARÁ DATA",
    HABITESE_NUMERO: "CONTRATO - HABITE-SE Nº",
    MATRICULA_INDIVIDUAL: "CONTRATO - MATRÍCULA INDIVIDUAL",
    CRI: "CONTRATO - CRI DA MATRÍCULA",
    AREA: "CONTRATO - ÁREA DO LOTE (M²)",
    CONFRONTACOES: "CONTRATO - CONFRONTAÇÕES",
    SINAL_VALOR: "CONTRATO - SINAL VALOR",
    SINAL_DATA: "CONTRATO - SINAL DATA",
    ENTRADA_VALOR: "CONTRATO - ENTRADA VALOR",
    ENTRADA_VENCIMENTO: "CONTRATO - ENTRADA VENCIMENTO",
    INTERMEDIARIA_VALOR: "CONTRATO - INTERMEDIÁRIA VALOR",
    INTERMEDIARIA_VENCIMENTO: "CONTRATO - INTERMEDIÁRIA VENCIMENTO",
    FORMA_PAGAMENTO: "CONTRATO - FORMA DE PAGAMENTO",
    COMISSAO_FORMA: "CONTRATO - COMISSÃO FORMA",
    COMISSAO_VENCIMENTO: "CONTRATO - COMISSÃO VENCIMENTO",
    COMISSAO_PAGA_POR: "CONTRATO - COMISSÃO PAGA POR",
    PRAZO_CONCLUSAO: "CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS",
    CONDICOES_ESPECIAIS: "CONTRATO - CONDIÇÕES ESPECIAIS",
    CONTRATO_GERADO: "CONTRATO GERADO"
  };

  var TIPOS = {};
  TIPOS[COL.ALVARA_NUMERO] = "rich_text";
  TIPOS[COL.ALVARA_DATA] = "date";
  TIPOS[COL.HABITESE_NUMERO] = "rich_text";
  TIPOS[COL.MATRICULA_INDIVIDUAL] = "rich_text";
  TIPOS[COL.CRI] = "rich_text";
  TIPOS[COL.AREA] = "number";
  TIPOS[COL.CONFRONTACOES] = "rich_text";
  TIPOS[COL.SINAL_VALOR] = "number";
  TIPOS[COL.SINAL_DATA] = "date";
  TIPOS[COL.ENTRADA_VALOR] = "number";
  TIPOS[COL.ENTRADA_VENCIMENTO] = "date";
  TIPOS[COL.INTERMEDIARIA_VALOR] = "number";
  TIPOS[COL.INTERMEDIARIA_VENCIMENTO] = "date";
  TIPOS[COL.FORMA_PAGAMENTO] = "select";
  TIPOS[COL.COMISSAO_FORMA] = "select";
  TIPOS[COL.COMISSAO_VENCIMENTO] = "rich_text";
  TIPOS[COL.COMISSAO_PAGA_POR] = "select";
  TIPOS[COL.PRAZO_CONCLUSAO] = "date";
  TIPOS[COL.CONDICOES_ESPECIAIS] = "rich_text";
  TIPOS[COL.CONTRATO_GERADO] = "files";

  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
    "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
    "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  var DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  var CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
    "setecentos", "oitocentos", "novecentos"];

  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function up(v) { return txt(v).toUpperCase(); }
  function vazio(v) { return txt(v) === ""; }

  function moedaBR(n) {
    var c = Math.round(Math.abs(Number(n) || 0) * 100);
    var reais = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = String(c % 100);
    if (cent.length < 2) cent = "0" + cent;
    return (Number(n) < 0 ? "-" : "") + reais + "," + cent;
  }

  function ate999(n) {
    if (n === 100) return "cem";
    var partes = [];
    var c = Math.floor(n / 100), r = n % 100;
    if (c) partes.push(CENTENAS[c]);
    if (r) {
      if (r < 20) partes.push(UNIDADES[r]);
      else {
        var d = Math.floor(r / 10), u = r % 10;
        partes.push(u ? DEZENAS[d] + " e " + UNIDADES[u] : DEZENAS[d]);
      }
    }
    return partes.join(" e ");
  }

  function inteiroPorExtenso(n) {
    var milhoes = Math.floor(n / 1000000), mil = Math.floor((n % 1000000) / 1000), un = n % 1000;
    var grupos = [];
    if (milhoes) grupos.push({ v: milhoes, t: milhoes === 1 ? "um milhão" : ate999(milhoes) + " milhões" });
    if (mil) grupos.push({ v: mil, t: mil === 1 ? "mil" : ate999(mil) + " mil" });
    if (un) grupos.push({ v: un, t: ate999(un) });
    var s = "";
    for (var i = 0; i < grupos.length; i++) {
      if (i === 0) s = grupos[i].t;
      else {
        var ultimo = i === grupos.length - 1;
        var v = grupos[i].v;
        s += (ultimo && (v < 100 || v % 100 === 0) ? " e " : " ") + grupos[i].t;
      }
    }
    return s;
  }

  function valorPorExtenso(n) {
    var c = Math.round(Math.abs(Number(n) || 0) * 100);
    var reais = Math.floor(c / 100), cent = c % 100;
    if (reais >= 1000000000) throw new Error("VALOR_FORA_DO_LIMITE");
    var partes = [];
    if (reais > 0) {
      var t = inteiroPorExtenso(reais);
      if (reais % 1000000 === 0) t += " de";
      t += reais === 1 ? " real" : " reais";
      partes.push(t);
    }
    if (cent > 0) partes.push(ate999(cent) + (cent === 1 ? " centavo" : " centavos"));
    if (!partes.length) return "zero reais";
    return partes.join(" e ");
  }

  function dataParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
    return m ? { a: m[1], m: Number(m[2]), d: Number(m[3]) } : null;
  }
  function dataBR(iso) {
    var p = dataParts(iso);
    if (!p) return "";
    return (p.d < 10 ? "0" : "") + p.d + "/" + (p.m < 10 ? "0" : "") + p.m + "/" + p.a;
  }
  function dataPorExtenso(iso) {
    var p = dataParts(iso);
    if (!p || p.m < 1 || p.m > 12) return "";
    return (p.d === 1 ? "1º" : String(p.d)) + " de " + MESES[p.m - 1] + " de " + p.a;
  }

  function loteQuadra(endereco) {
    var s = txt(endereco);
    var q = /\bQD\.?\s*([0-9A-Z-]+)/i.exec(s);
    var l = /\bLT\.?\s*([0-9A-Z-]+)/i.exec(s);
    if (!q || !l) return null;
    var quadra = q[1].replace(/^-+|-+$/g, ""), lote = l[1].replace(/^-+|-+$/g, "");
    if (!quadra || !lote) return null;
    return { lote: lote, quadra: quadra };
  }

  /* Venda do condomínio (casa com "CONDOMÍNIO - VENDA ID") tem modelo próprio, esteja a obra pronta ou não. */
  function escolherModelo(obraFinalizada, condominio) {
    if (condominio) return "CONDOMINIO";
    return up(obraFinalizada) === "SIM" ? "PRONTO" : "CONSTRUCAO";
  }

  function documentoComRotulo(doc) {
    var d = txt(doc);
    if (!d) return "";
    var m = /^(RG|CNH)(?![A-Za-z]):?\s*(?:n[ºo°]\.?\s*)?(.*)$/i.exec(d);
    if (m) return m[1].toUpperCase() + " nº " + m[2];
    return d;
  }

  function qualificacao(c) {
    c = c || {};
    var partes = [txt(c.nome), txt(c.nacionalidade), txt(c.estadoCivil), txt(c.profissao),
      documentoComRotulo(c.documento), txt(c.cpf) ? "CPF nº " + txt(c.cpf) : "",
      txt(c.endereco) ? "residente e domiciliado à " + txt(c.endereco) : ""];
    return partes.filter(function (p) { return p !== ""; }).join(", ");
  }

  function nomeComprador1(clientes, nome2) {
    var c = txt(clientes), n2 = txt(nome2);
    if (!n2) return c;
    /* o nome do 2º só vale como fronteira de palavra (depois de espaço ou separador), nunca no meio de outro nome */
    var pos = -1, cu = c.toUpperCase(), nu = n2.toUpperCase(), from = 0, i;
    while ((i = cu.indexOf(nu, from)) >= 0) {
      if (i > 0 && /[\s&,\/]/.test(cu.charAt(i - 1))) { pos = i; break; }
      from = i + 1;
    }
    if (pos < 0) {
      var m = /\s+E\s+|\s*[&,\/]\s*/i.exec(c); /* o PRIMEIRO " E ", como no dossiê */
      pos = m ? m.index : -1;
    }
    if (pos < 0) return c;
    return c.slice(0, pos).replace(/(?:\s+[Ee]\s*|[\s,\/&]+)+$/, "").trim();
  }

  function formaPorExtenso(v) {
    var u = up(v);
    if (u === "PIX") return "PIX";
    if (u === "TRANSFERÊNCIA" || u === "TRANSFERENCIA") return "transferência";
    if (u === "DEPÓSITO" || u === "DEPOSITO") return "depósito";
    return txt(v);
  }

  /* ---- condomínio ---- */
  function R() { return typeof RegrasVenda !== "undefined" ? RegrasVenda : require("./RegrasVenda.js"); }
  function so2(n) { return Math.round(n * 100) / 100; }
  function positivo(n) { return typeof n === "number" && isFinite(n) && n > 0; }
  function inteiro(n) { var x = num(n); return x === null ? null : Math.round(x); }
  function valorExtenso(n) { return "R$ " + moedaBR(n) + " (" + valorPorExtenso(n) + ")"; }

  /* Fluxo de pagamento da linha da BANCO DE DADOS VENDAS CONDOMÍNIO, já normalizado. */
  function fluxoCondominio(x) {
    x = x || {};
    return {
      assinatura: txt(x.assinatura), diaPagamento: inteiro(x.diaPagamento), entrega: txt(x.entrega),
      valorVenda: num(x.valorVenda),
      sinalAto: num(x.sinalAto),
      sinal30: num(x.sinal30), data30: txt(x.data30),
      sinal60: num(x.sinal60), data60: txt(x.data60),
      sinal90: num(x.sinal90), data90: txt(x.data90),
      pre1N: inteiro(x.pre1N), pre1Valor: num(x.pre1Valor), pre1Data: txt(x.pre1Data),
      pre2N: inteiro(x.pre2N), pre2Valor: num(x.pre2Valor), pre2Data: txt(x.pre2Data),
      balao1Valor: num(x.balao1Valor), balao1Data: txt(x.balao1Data),
      balao2Valor: num(x.balao2Valor), balao2Data: txt(x.balao2Data),
      posN: inteiro(x.posN), posValor: num(x.posValor), posData: txt(x.posData),
      credito: num(x.credito), fgts: num(x.fgts), subsidio: num(x.subsidio)
    };
  }

  /* Quanto o fluxo soma (séries = nº de parcelas × valor). */
  function somaFluxo(fl) {
    function serie(n, v) { return positivo(n) && positivo(v) ? n * v : 0; }
    function val(v) { return positivo(v) ? v : 0; }
    return so2(val(fl.sinalAto) + val(fl.sinal30) + val(fl.sinal60) + val(fl.sinal90) +
      serie(fl.pre1N, fl.pre1Valor) + serie(fl.pre2N, fl.pre2Valor) +
      val(fl.balao1Valor) + val(fl.balao2Valor) +
      val(fl.credito) + val(fl.fgts) + val(fl.subsidio) + serie(fl.posN, fl.posValor));
  }

  /* "N parcelas mensais e sucessivas de R$ X (…), vencendo-se a primeira em dd/mm/aaaa e as demais no dia D dos meses subsequentes" */
  function serieMensal(n, valor, dataIso, dia, depoisDaData) {
    if (n === 1) return "1 parcela de " + valorExtenso(valor) + ", com vencimento em " + dataBR(dataIso) + (depoisDaData || "");
    return n + " parcelas mensais e sucessivas de " + valorExtenso(valor) + ", vencendo-se a primeira em " +
      dataBR(dataIso) + (depoisDaData || "") + " e as demais no dia " + (dia === null ? "" : dia) + " dos meses subsequentes";
  }

  /* Texto do item 6.1 do contrato do condomínio (uma linha por parágrafo, separadas por "\n").
   * Incisos I a V com numeração FIXA (o 6.1-A e o 7.1 citam os incisos pelo número): linha de
   * valor 0/vazio sai, as alíneas que sobram são reletradas; inciso sem nenhuma linha vira "não há". */
  function formaPagamentoCondominio(fluxo) {
    var fl = fluxoCondominio(fluxo);
    var linhas = [];
    linhas.push("6.1. Preço total: " + (fl.valorVenda === null ? "R$ " : valorExtenso(fl.valorVenda)) + ", a ser pago da seguinte forma:");
    var LETRAS = "abcdefghij";
    function inciso(titulo, itens, comLetra, depois) {
      if (!itens.length) { linhas.push(titulo + ": não há."); return; }
      linhas.push(titulo + ":");
      itens.forEach(function (t, i) {
        var fim = i === itens.length - 1 ? "." : ";";
        linhas.push((comLetra ? LETRAS.charAt(i) + ") " : "") + t + fim);
      });
      if (depois) linhas.push(depois);
    }
    var sinal = [];
    if (positivo(fl.sinalAto)) sinal.push(valorExtenso(fl.sinalAto) + ", no ato da assinatura deste instrumento, em " + dataBR(fl.assinatura));
    [[fl.sinal30, fl.data30], [fl.sinal60, fl.data60], [fl.sinal90, fl.data90]].forEach(function (p) {
      if (positivo(p[0])) sinal.push(valorExtenso(p[0]) + ", com vencimento em " + dataBR(p[1]));
    });
    inciso("I — SINAL (arras confirmatórias, art. 417 do Código Civil), sem correção monetária", sinal, true);

    var pre = [];
    if (positivo(fl.pre1N) && positivo(fl.pre1Valor)) pre.push("1ª etapa: " + serieMensal(fl.pre1N, fl.pre1Valor, fl.pre1Data, fl.diaPagamento));
    if (positivo(fl.pre2N) && positivo(fl.pre2Valor)) pre.push("2ª etapa: " + serieMensal(fl.pre2N, fl.pre2Valor, fl.pre2Data, fl.diaPagamento));
    inciso("II — PARCELAS MENSAIS DURANTE A OBRA (pré-chaves), corrigidas na forma do item 7.1, \"a\"", pre, true);

    var baloes = [];
    if (positivo(fl.balao1Valor)) baloes.push(valorExtenso(fl.balao1Valor) + ", com vencimento em " + dataBR(fl.balao1Data));
    if (positivo(fl.balao2Valor)) baloes.push(valorExtenso(fl.balao2Valor) + ", com vencimento em " + dataBR(fl.balao2Data) +
      ", ou na data da entrega das chaves, o que ocorrer primeiro");
    inciso("III — PARCELAS INTERMEDIÁRIAS (balões), corrigidas na forma do item 7.1, \"a\"", baloes, true);

    var terceiros = [];
    if (positivo(fl.credito)) terceiros.push("Financiamento bancário: " + valorExtenso(fl.credito) +
      ", a ser pago diretamente pela instituição financeira na assinatura do contrato de financiamento, observada a Cláusula Oitava");
    if (positivo(fl.fgts)) terceiros.push("Recursos do FGTS: " + valorExtenso(fl.fgts) + ", na data do respectivo resgate (item 13.3)");
    if (positivo(fl.subsidio)) terceiros.push("Subsídio: " + valorExtenso(fl.subsidio));
    inciso("IV — RECURSOS DE TERCEIROS, sem correção pela VENDEDORA", terceiros, true,
      "Na hipótese de o financiamento, o FGTS ou o subsídio serem liberados em valor inferior ao previsto, a diferença será paga pelo COMPRADOR à vista, na data da assinatura do contrato de financiamento (item 13.4).");

    var pos = [];
    if (positivo(fl.posN) && positivo(fl.posValor))
      pos.push(serieMensal(fl.posN, fl.posValor, fl.posData, fl.diaPagamento, " (mês seguinte à entrega das chaves)"));
    inciso("V — PARCELAS APÓS A ENTREGA DAS CHAVES (pós-chaves), corrigidas e acrescidas de juros na forma do item 7.1, \"b\"", pos, false);
    return linhas.join("\n");
  }

  /* Quantos caracteres do começo da linha do 6.1 / dos fiadores vão em negrito (0 = nenhum). */
  function negritoDaLinha(linha) {
    var t = txt(linha), m;
    if (/^(?:I|II|III|IV|V) — /.test(t)) return t.length;
    if ((m = /^6\.1\. Preço total: [^)]*\),?/.exec(t))) return m[0].length;
    if ((m = /^FIADOR \d:/.exec(t))) return m[0].length;
    return 0;
  }

  function fiadorNormal(x) {
    x = x || {};
    return {
      nome: txt(x.nome), cpf: R().cpfValido(x.cpf) ? R().formatarCpf(x.cpf) : txt(x.cpf), rg: txt(x.rg),
      nacionalidade: txt(x.nacionalidade), endereco: txt(x.endereco), numero: txt(x.numero),
      setor: txt(x.setor), cidade: txt(x.cidade), cep: txt(x.cep), email: txt(x.email)
    };
  }
  /* Só os fiadores com nome, na ordem (o 1º preenchido é o FIADOR 1). */
  function fiadoresPreenchidos(lista) {
    return (lista || []).map(fiadorNormal).filter(function (fi) { return fi.nome !== ""; });
  }
  function enderecoFiador(fi) {
    var partes = [];
    if (fi.endereco) partes.push(fi.endereco);
    if (fi.numero) partes.push("nº " + fi.numero.replace(/^n[ºo°]\.?\s*/i, ""));
    if (fi.setor) partes.push(fi.setor);
    if (fi.cidade) partes.push(fi.cidade);
    if (fi.cep) partes.push("CEP " + fi.cep.replace(/^CEP:?\s*/i, ""));
    return partes.join(", ");
  }
  function rgFiador(rg) {
    var r = txt(rg).replace(/^RG(?![A-Za-z]):?\s*(?:n[ºo°]\.?\s*)?/i, "");
    return r ? "RG nº " + r : "";
  }
  /* "FIADOR 1: nome, nacionalidade, RG nº …, CPF nº …, residente e domiciliado à …, e-mail …." (estado civil e profissão não existem na base: ficam de fora) */
  function qualificacaoFiadores(lista) {
    return fiadoresPreenchidos(lista).map(function (fi, i) {
      var end = enderecoFiador(fi);
      var partes = [fi.nome, fi.nacionalidade, rgFiador(fi.rg), fi.cpf ? "CPF nº " + fi.cpf : "",
        end ? "residente e domiciliado à " + end : "", fi.email ? "e-mail " + fi.email : ""];
      return "FIADOR " + (i + 1) + ": " + partes.filter(function (p) { return p !== ""; }).join(", ") + ".";
    }).join("\n");
  }

  function montarCondominio(c) {
    var areaPriv = num(c.areaPrivativa);
    return {
      nome: txt(c.nome).replace(/^CONDOM[IÍ]NIO\s+/i, ""), unidade: txt(c.unidade),
      areaPrivativa: areaPriv, fracaoIdeal: txt(c.fracaoIdeal),
      fluxo: fluxoCondominio(c.fluxo),
      fiadores: fiadoresPreenchidos(c.fiadores)
    };
  }

  function montarDadosContrato(f) {
    f = f || {};
    var v = f.venda || {}, o = f.obra || {};
    var c1 = v.COMPRADOR1 || {}, c2 = v.COMPRADOR2 || {};
    var temC2 = !vazio(c2.nome);
    var cond = f.condominio ? montarCondominio(f.condominio) : null;
    /* condomínio: a comissão é paga pela incorporadora (vendedor) e não entra no preço do comprador */
    var pagaPor = cond ? "VENDEDOR" : up(v.COMISSAO_PAGA_POR);
    var total = cond && cond.fluxo.valorVenda !== null ? cond.fluxo.valorVenda : num(v.VALOR_CONTRATO);
    var comissao = num(v.COMISSAO), naMao = num(v.VALOR_NA_MAO);
    var aquisicao, intermediacao;
    if (pagaPor === "VENDEDOR") {
      aquisicao = total;
      intermediacao = "paga pelo VENDEDOR";
    } else {
      aquisicao = naMao !== null && naMao > 0 ? naMao
        : (total !== null && comissao !== null ? total - comissao : null);
      intermediacao = comissao;
    }
    var vend = f.vendedor || null;
    var lq = loteQuadra(v.ENDERECO);
    var dados = {
      modelo: escolherModelo(o.obraFinalizada, !!cond),
      comprador1: {
        nome: nomeComprador1(v.CLIENTES, c2.nome), cpf: txt(v.CPF),
        nacionalidade: txt(c1.nacionalidade), estadoCivil: txt(c1.estadoCivil), profissao: txt(c1.profissao),
        documento: txt(c1.documento), endereco: txt(c1.endereco), email: txt(c1.email)
      },
      comprador2: temC2 ? {
        nome: txt(c2.nome), cpf: txt(c2.cpf),
        nacionalidade: txt(c2.nacionalidade), estadoCivil: txt(c2.estadoCivil), profissao: txt(c2.profissao),
        documento: txt(c2.documento), endereco: txt(c2.endereco), email: txt(c2.email)
      } : null,
      vendedor: vend ? {
        tipo: up(vend.tipo), nome: txt(vend.nome) || txt(o.proprietario), cpfCnpj: txt(vend.cpfCnpj) || txt(o.cpfCnpj),
        endereco: txt(vend.endereco),
        representanteNome: txt(vend.representanteNome), representanteCpf: txt(vend.representanteCpf),
        representanteRg: txt(vend.representanteRg), representanteNacionalidade: txt(vend.representanteNacionalidade),
        representanteEstadoCivil: txt(vend.representanteEstadoCivil),
        nacionalidade: txt(vend.nacionalidade), estadoCivil: txt(vend.estadoCivil),
        profissao: txt(vend.profissao), rg: txt(vend.rg),
        banco: txt(vend.banco), agencia: txt(vend.agencia), operacao: txt(vend.operacao),
        conta: txt(vend.conta), pix: txt(vend.pix),
        /* e-mails: só a assinatura (ClicksignVenda) usa; o contrato não exige */
        email: txt(vend.email), representanteEmail: txt(vend.representanteEmail)
      } : null,
      nomeProprietario: txt(o.proprietario),
      loteamento: f.loteamento ? {
        denominacao: txt(f.loteamento.denominacao), municipioUf: txt(f.loteamento.municipioUf),
        matricula: txt(f.loteamento.matricula), cartorio: txt(f.loteamento.cartorio),
        prazoPosseDias: txt(f.loteamento.prazoPosseDias), prazoChavesDias: txt(f.loteamento.prazoChavesDias)
      } : null,
      imovel: {
        endereco: txt(v.ENDERECO), lote: lq ? lq.lote : "", quadra: lq ? lq.quadra : "",
        area: num(v.AREA), confrontacoes: txt(v.CONFRONTACOES),
        matriculaIndividual: txt(v.MATRICULA_INDIVIDUAL), cri: txt(v.CRI),
        alvaraNumero: txt(v.ALVARA_NUMERO), alvaraData: txt(v.ALVARA_DATA),
        habiteseNumero: txt(v.HABITESE_NUMERO), habiteseData: txt(o.dataHabitese),
        prazoConclusao: txt(v.PRAZO_CONCLUSAO), condicoesEspeciais: txt(v.CONDICOES_ESPECIAIS)
      },
      negociacao: {
        valorContrato: total, valorNaMao: naMao, aquisicao: aquisicao, intermediacao: intermediacao,
        sinalValor: num(v.SINAL_VALOR), sinalData: txt(v.SINAL_DATA),
        entradaValor: num(v.ENTRADA_VALOR), entradaVencimento: txt(v.ENTRADA_VENCIMENTO),
        intermediariaValor: num(v.INTERMEDIARIA_VALOR), intermediariaVencimento: txt(v.INTERMEDIARIA_VENCIMENTO),
        formaPagamento: txt(v.FORMA_PAGAMENTO)
      },
      comissao: {
        valor: comissao, forma: txt(v.COMISSAO_FORMA), vencimento: txt(v.COMISSAO_VENCIMENTO), pagaPor: pagaPor
      },
      corretor: f.corretor ? {
        nome: txt(f.corretor.nome), creci: txt(f.corretor.creci), cpfCnpj: txt(f.corretor.cpfCnpj),
        nacionalidade: txt(f.corretor.nacionalidade), endereco: txt(f.corretor.endereco), email: txt(f.corretor.email)
      } : null,
      corretorNaVenda: txt(v.CORRETOR),
      hojeISO: txt(f.hojeISO),
      cidadeAssinatura: txt(f.cidadeAssinatura) || "Goiânia"
    };
    /* só existe no condomínio: o carimbo dos contratos que não são do condomínio não muda */
    if (cond) dados.condominio = cond;
    return dados;
  }

  function faltasContrato(d) {
    var faltas = [];
    function exige(cond, grupo, item) { if (!cond) faltas.push(grupo + ": " + item); }
    function comprador(c, grupo) {
      exige(!vazio(c.nome), grupo, "nome");
      exige(!vazio(c.nacionalidade), grupo, "nacionalidade");
      exige(!vazio(c.estadoCivil), grupo, "estado civil");
      exige(!vazio(c.profissao), grupo, "profissão");
      exige(!vazio(c.documento), grupo, "RG");
      exige(!vazio(c.cpf), grupo, "CPF");
      exige(!vazio(c.endereco), grupo, "endereço");
    }
    var pronto = d.modelo === "PRONTO";

    comprador(d.comprador1, "Comprador 1");
    if (d.comprador2) comprador(d.comprador2, "Comprador 2");

    var v = d.vendedor;
    if (!v) faltas.push("Vendedor: cadastro em VENDEDORES – CONTRATO");
    else {
      exige(!vazio(v.nome), "Vendedor", "nome");
      exige(!vazio(v.cpfCnpj), "Vendedor", "CPF/CNPJ");
      exige(v.tipo === "PJ" || v.tipo === "PF", "Vendedor", "tipo (PJ ou PF)");
      exige(!vazio(v.endereco), "Vendedor", v.tipo === "PF" ? "endereço" : "endereço / sede");
      if (v.tipo === "PJ") {
        exige(!vazio(v.representanteNome), "Vendedor", "representante (nome)");
        exige(!vazio(v.representanteCpf), "Vendedor", "representante (CPF)");
        exige(!vazio(v.representanteRg), "Vendedor", "representante (RG)");
        exige(!vazio(v.representanteNacionalidade), "Vendedor", "representante (nacionalidade)");
        exige(!vazio(v.representanteEstadoCivil), "Vendedor", "representante (estado civil)");
      } else if (v.tipo === "PF") {
        exige(!vazio(v.nacionalidade), "Vendedor", "nacionalidade");
        exige(!vazio(v.estadoCivil), "Vendedor", "estado civil");
        exige(!vazio(v.profissao), "Vendedor", "profissão");
        exige(!vazio(v.rg), "Vendedor", "RG");
      }
      exige(!vazio(v.banco), "Vendedor", "banco");
      exige(!vazio(v.agencia), "Vendedor", "agência");
      exige(!vazio(v.conta), "Vendedor", "conta");
      exige(!vazio(v.pix), "Vendedor", "Pix");
    }

    var l = d.loteamento, gl = d.condominio ? "Condomínio" : "Loteamento";
    if (!l) faltas.push(d.condominio ? "Condomínio: cadastro em LOTEAMENTOS – CONTRATO (linha com o nome do condomínio, igual ao ENDEREÇO da casa)"
                                     : "Loteamento: cadastro em LOTEAMENTOS – CONTRATO");
    else {
      exige(!vazio(l.denominacao), gl, "denominação");
      exige(!vazio(l.municipioUf), gl, "município/UF");
      exige(!vazio(l.matricula), gl, d.condominio ? "matrícula do empreendimento" : "matrícula do loteamento");
      exige(!vazio(l.cartorio), gl, "cartório");
      if (pronto) {
        exige(!vazio(l.prazoPosseDias), "Loteamento", "prazo de posse (dias)");
        exige(!vazio(l.prazoChavesDias), "Loteamento", "prazo de entrega das chaves (dias)");
      }
    }

    if (d.condominio) faltasCondominio(d, faltas);
    else faltasCasaDeRua(d, faltas, pronto);

    var k = d.corretor;
    if (!k) {
      faltas.push(vazio(d.corretorNaVenda) ? "Corretor: corretor na venda" : "Corretor: cadastro em CORRETORES – CONTRATO");
    } else {
      exige(!vazio(k.nome), "Corretor", "nome");
      exige(!vazio(k.creci), "Corretor", "CRECI");
      exige(!vazio(k.cpfCnpj), "Corretor", "CPF/CNPJ");
    }
    return faltas;
  }

  /* Condomínio (decisão do dono 07/10): os dados do imóvel (unidade, fração, área, matrícula, CRI,
     alvará, prazo) PODEM ficar em branco — saem "____" no contrato e viram aviso (avisosContrato).
     Bloqueiam: assinatura, dia de pagamento, entrega, fluxo que não fecha com o VALOR DE VENDA,
     comprador sem nome ou sem CPF válido, fiador com nome sem CPF válido/RG/endereço. */
  function faltasCondominio(d, faltas) {
    function exige(cond, grupo, item) { if (!cond) faltas.push(grupo + ": " + item); }
    var co = d.condominio, fl = co.fluxo;
    [[d.comprador1, "Comprador 1"], [d.comprador2, "Comprador 2"]].forEach(function (p) {
      if (p[0] && !vazio(p[0].cpf) && !R().cpfValido(p[0].cpf)) faltas.push(p[1] + ": CPF inválido");
    });

    var g = "Fluxo de pagamento";
    exige(!vazio(fl.assinatura), g, "data de assinatura do contrato");
    exige(fl.diaPagamento !== null && fl.diaPagamento >= 1 && fl.diaPagamento <= 31, g, "dia de pagamento das parcelas");
    exige(!vazio(fl.entrega), g, "data da entrega");
    exige(positivo(fl.valorVenda), g, "valor de venda");
    function comData(valor, data, nome) { if (positivo(valor)) exige(!vazio(data), g, nome + " (data)"); }
    function serie(n, valor, data, nome) {
      if (!positivo(n) && !positivo(valor)) return;
      exige(positivo(n), g, nome + " (nº de parcelas)");
      exige(positivo(valor), g, nome + " (valor)");
      exige(!vazio(data), g, nome + " (data da 1ª)");
    }
    comData(fl.sinal30, fl.data30, "sinal 30 dias");
    comData(fl.sinal60, fl.data60, "sinal 60 dias");
    comData(fl.sinal90, fl.data90, "sinal 90 dias");
    serie(fl.pre1N, fl.pre1Valor, fl.pre1Data, "1ª parte pré-chaves");
    serie(fl.pre2N, fl.pre2Valor, fl.pre2Data, "2ª parte pré-chaves");
    comData(fl.balao1Valor, fl.balao1Data, "1º balão");
    comData(fl.balao2Valor, fl.balao2Data, "balão da entrega das chaves");
    serie(fl.posN, fl.posValor, fl.posData, "pós-chaves");
    if (positivo(fl.valorVenda)) {
      var soma = somaFluxo(fl);
      if (Math.abs(soma - fl.valorVenda) > 0.05)
        faltas.push(g + ": soma R$ " + moedaBR(soma) + " e não fecha com o valor de venda R$ " + moedaBR(fl.valorVenda));
    }

    co.fiadores.forEach(function (fi, i) {
      var gf = "Fiador " + (i + 1);
      if (vazio(fi.cpf)) faltas.push(gf + ": CPF");
      else if (!R().cpfValido(fi.cpf)) faltas.push(gf + ": CPF inválido");
      exige(!vazio(fi.rg), gf, "RG");
      exige(!vazio(fi.endereco), gf, "endereço");
    });
  }

  /* Avisos (não impedem gerar): campos que saem em branco ("____") no contrato do condomínio e
     fiador com CPF repetido. Só nomes de campo — nenhum dado pessoal. [] fora do condomínio. */
  function avisosContrato(d) {
    var co = d && d.condominio;
    if (!co) return [];
    var a = [], im = d.imovel;
    function branco(ok, item) { if (!ok) a.push("Em branco no contrato: " + item); }
    branco(!vazio(co.unidade), "unidade");
    branco(positivo(co.areaPrivativa), "área privativa");
    branco(!vazio(co.fracaoIdeal), "fração ideal");
    branco(!vazio(im.matriculaIndividual), "matrícula individual");
    branco(!vazio(im.cri), "CRI da matrícula");
    branco(!vazio(im.alvaraNumero), "alvará (número)");
    branco(!vazio(im.alvaraData), "alvará (data)");
    branco(!vazio(im.prazoConclusao), "prazo previsto de conclusão das obras");
    var so = function (x) { return txt(x).replace(/\D/g, ""); };
    var cpfsCompradores = [d.comprador1 && d.comprador1.cpf, d.comprador2 && d.comprador2.cpf]
      .map(so).filter(function (x) { return x !== ""; });
    var vistos = {};
    co.fiadores.forEach(function (fi, i) {
      var cpf = so(fi.cpf);
      if (!cpf) return;
      if (cpfsCompradores.indexOf(cpf) >= 0) a.push("Fiador " + (i + 1) + ": CPF igual ao de um comprador");
      if (vistos[cpf]) a.push("Fiadores: os dois têm o mesmo CPF");
      vistos[cpf] = true;
    });
    return a;
  }

  function faltasCasaDeRua(d, faltas, pronto) {
    function exige(cond, grupo, item) { if (!cond) faltas.push(grupo + ": " + item); }
    var im = d.imovel;
    exige(!vazio(im.lote) && !vazio(im.quadra), "Imóvel", "lote e quadra no endereço");
    exige(!vazio(im.matriculaIndividual), "Imóvel", "matrícula individual");
    exige(!vazio(im.cri), "Imóvel", "CRI da matrícula");
    exige(im.area !== null && im.area > 0, "Imóvel", "área do lote");
    exige(!vazio(im.alvaraNumero), "Imóvel", "alvará (número)");
    exige(!vazio(im.alvaraData), "Imóvel", "alvará (data)");
    if (!pronto) exige(!vazio(im.prazoConclusao), "Imóvel", "prazo previsto de conclusão das obras");
    if (pronto) {
      exige(!vazio(im.habiteseNumero), "Imóvel", "habite-se (número)");
      exige(!vazio(im.habiteseData), "Imóvel", "habite-se (data)");
    }

    var n = d.negociacao, c = d.comissao;
    exige(n.valorContrato !== null && n.valorContrato > 0, "Negociação", "valor do imóvel");
    if (n.valorContrato !== null && n.valorContrato > 0) {
      exige(n.aquisicao !== null && n.aquisicao > 0, "Negociação", "valor de aquisição inválido");
      /* com a comissão paga pelo comprador, o valor na mão entra no contrato: tem de fechar com o total */
      if (d.comissao.pagaPor !== "VENDEDOR" && n.valorNaMao !== null && n.valorNaMao > 0 && c.valor !== null &&
          Math.abs(n.valorNaMao + c.valor - n.valorContrato) > 0.01) {
        faltas.push("Negociação: valor na mão + comissão ≠ valor do contrato");
      }
    }
    exige(n.sinalValor !== null && n.sinalValor > 0, "Negociação", "sinal (valor)");
    exige(!vazio(n.sinalData), "Negociação", "sinal (data)");
    exige(n.entradaValor !== null && n.entradaValor > 0, "Negociação", "entrada (valor)");
    exige(!vazio(n.entradaVencimento), "Negociação", "entrada (vencimento)");
    if (n.intermediariaValor !== null && n.intermediariaValor > 0) {
      exige(!vazio(n.intermediariaVencimento), "Negociação", "intermediária (vencimento)");
    }
    exige(!vazio(n.formaPagamento), "Negociação", "forma de pagamento");
    exige(c.valor !== null && c.valor > 0, "Negociação", "comissão (valor)");
    exige(!vazio(c.forma), "Negociação", "comissão (forma)");
    exige(!vazio(c.vencimento), "Negociação", "comissão (vencimento)");
    exige(c.pagaPor === "COMPRADOR" || c.pagaPor === "VENDEDOR", "Negociação", "comissão paga por");
  }

  function moedaOuVazio(n) { return n === null || n === undefined ? "" : moedaBR(n); }

  function areaTxt(a) {
    if (a === null || a === undefined) return "";
    return Math.floor(a) === a ? String(a) : moedaBR(a).replace(/\./g, "");
  }

  function marcadores(d) {
    var c1 = d.comprador1, c2 = d.comprador2, v = d.vendedor || {}, l = d.loteamento || {};
    var im = d.imovel, n = d.negociacao, c = d.comissao, k = d.corretor || {};
    var ehPJ = v.tipo === "PJ";
    var compradores = qualificacao(c1) + (c2 ? "; e " + qualificacao(c2) : "");
    var nomes = c2 ? c1.nome + " e " + c2.nome : c1.nome;
    var pagaVend = c.pagaPor === "VENDEDOR";
    var ehPF = v.tipo === "PF";
    var interm = typeof n.intermediacao === "string" ? n.intermediacao
      : (n.intermediacao === null ? "" : "R$ " + moedaBR(n.intermediacao));
    var co = d.condominio || null, fis = co ? co.fiadores : [];
    var m = {
      /* condomínio (vazios fora dele; o modelo de casa de rua não usa) */
      CONDOMINIO_NOME: co ? co.nome : "",
      UNIDADE: co ? co.unidade : "",
      AREA_PRIVATIVA: co ? areaTxt(co.areaPrivativa) : "",
      FRACAO_IDEAL: co ? co.fracaoIdeal : "",
      FORMA_PAGAMENTO_CONDOMINIO: co ? formaPagamentoCondominio(co.fluxo) : "",
      FIADORES_QUALIFICACAO: qualificacaoFiadores(fis),
      FIADOR1_NOME: fis[0] ? fis[0].nome : "",
      FIADOR1_CPF: fis[0] ? fis[0].cpf : "",
      FIADOR2_NOME: fis[1] ? fis[1].nome : "",
      FIADOR2_CPF: fis[1] ? fis[1].cpf : "",
      COMPRADORES: compradores,
      VENDEDOR_NOME: txt(v.nome) || d.nomeProprietario,
      VENDEDOR_DOC: txt(v.cpfCnpj),
      VENDEDOR_ENDERECO: txt(v.endereco),
      VENDEDOR_NACIONALIDADE: ehPJ ? txt(v.representanteNacionalidade) : txt(v.nacionalidade),
      VENDEDOR_ESTADO_CIVIL: ehPJ ? txt(v.representanteEstadoCivil) : txt(v.estadoCivil),
      VENDEDOR_PROFISSAO: ehPJ ? "" : txt(v.profissao),
      VENDEDOR_RG: ehPJ ? txt(v.representanteRg) : txt(v.rg),
      VENDEDOR_DOC_ROTULO: ehPJ ? "CNPJ sob o número " + txt(v.cpfCnpj) : (ehPF ? "CPF nº " + txt(v.cpfCnpj) : txt(v.cpfCnpj)),
      REPRESENTANTE_NOME: ehPF ? (txt(v.nome) || d.nomeProprietario) : txt(v.representanteNome),
      REPRESENTANTE_CPF: ehPF ? txt(v.cpfCnpj) : txt(v.representanteCpf),
      PRAZO_CONCLUSAO: dataBR(im.prazoConclusao),
      CONDICOES_ESPECIAIS: im.condicoesEspeciais || "Não há.",
      ASSINATURA_COMPRADORES_NOMES: c2 ? c1.nome + " / " + c2.nome : c1.nome,
      ASSINATURA_COMPRADORES_CPFS: c2 ? c1.cpf + " / " + c2.cpf : c1.cpf,
      CORRETOR_DOC: txt(k.cpfCnpj),
      LOTEAMENTO: txt(l.denominacao),
      MUNICIPIO_UF: txt(l.municipioUf),
      ALVARA_NUMERO: im.alvaraNumero,
      ALVARA_DATA: dataBR(im.alvaraData),
      HABITESE_NUMERO: im.habiteseNumero,
      HABITESE_DATA: dataBR(im.habiteseData),
      MATRICULA_LOTEAMENTO: txt(l.matricula),
      CARTORIO_LOTEAMENTO: txt(l.cartorio),
      LOTE: im.lote,
      QUADRA: im.quadra,
      AREA: areaTxt(im.area),
      CONFRONTACOES: im.confrontacoes,
      MATRICULA_INDIVIDUAL: im.matriculaIndividual,
      CRI: im.cri,
      VALOR_IMOVEL: moedaOuVazio(n.aquisicao),
      VALOR_INTERMEDIACAO: interm,
      VALOR_TOTAL: n.valorContrato === null ? "" : "R$ " + moedaBR(n.valorContrato),
      VALOR_TOTAL_NUM: moedaOuVazio(n.valorContrato),
      VALOR_TOTAL_EXTENSO: n.valorContrato === null ? "" : valorPorExtenso(n.valorContrato),
      COMISSAO_VALOR: moedaOuVazio(c.valor),
      COMISSAO_FORMA: formaPorExtenso(c.forma),
      COMISSAO_VENCIMENTO: c.vencimento,
      COMISSAO_RESPONSAVEL: pagaVend ? (txt(v.nome) || d.nomeProprietario) : nomes,
      CORRETOR_NOME: txt(k.nome),
      CORRETOR_CRECI: txt(k.creci),
      SINAL_VALOR: moedaOuVazio(n.sinalValor),
      SINAL_DATA: dataBR(n.sinalData),
      ENTRADA_VALOR: moedaOuVazio(n.entradaValor),
      ENTRADA_VENCIMENTO: dataBR(n.entradaVencimento),
      INTERMEDIARIA_VALOR: moedaOuVazio(n.intermediariaValor),
      INTERMEDIARIA_VENCIMENTO: dataBR(n.intermediariaVencimento),
      FORMA_PAGAMENTO: formaPorExtenso(n.formaPagamento),
      BANCO: txt(v.banco),
      AGENCIA: txt(v.agencia),
      OPERACAO: txt(v.operacao),
      CONTA: txt(v.conta),
      PIX: txt(v.pix),
      PRAZO_POSSE_DIAS: txt(l.prazoPosseDias),
      PRAZO_CHAVES_DIAS: txt(l.prazoChavesDias),
      CIDADE_DATA: d.cidadeAssinatura + ", " + dataPorExtenso(d.hojeISO)
    };
    /* condomínio: dado do imóvel em branco não trava (decisão do dono) — sai um traço para preencher à mão */
    if (co) CAMPOS_EM_BRANCO.forEach(function (k) { if (vazio(m[k])) m[k] = EM_BRANCO; });
    return m;
  }
  var EM_BRANCO = "____";
  var CAMPOS_EM_BRANCO = ["UNIDADE", "AREA_PRIVATIVA", "FRACAO_IDEAL", "MATRICULA_INDIVIDUAL", "CRI",
    "ALVARA_NUMERO", "ALVARA_DATA", "PRAZO_CONCLUSAO"];

  function blocos(d) {
    var v = d.vendedor || {}, n = d.negociacao, fis = d.condominio ? d.condominio.fiadores : [];
    var temInterm = n.intermediariaValor !== null && n.intermediariaValor > 0;
    return {
      SE_VENDEDOR_PJ: v.tipo === "PJ",
      SE_VENDEDOR_PF: v.tipo === "PF",
      SE_INTERMEDIARIA: temInterm,
      SEM_INTERMEDIARIA: !temInterm,
      SE_COMISSAO_VENDEDOR: d.comissao.pagaPor === "VENDEDOR",
      TEM_FIADORES: fis.length > 0,
      TEM_FIADOR1: fis.length > 0,
      TEM_FIADOR2: fis.length > 1
    };
  }

  var api = {
    COL: COL, TIPOS: TIPOS, moedaBR: moedaBR, valorPorExtenso: valorPorExtenso,
    dataBR: dataBR, dataPorExtenso: dataPorExtenso, loteQuadra: loteQuadra,
    escolherModelo: escolherModelo, qualificacao: qualificacao,
    montarDadosContrato: montarDadosContrato, faltasContrato: faltasContrato,
    marcadores: marcadores, blocos: blocos, avisosContrato: avisosContrato,
    formaPagamentoCondominio: formaPagamentoCondominio, qualificacaoFiadores: qualificacaoFiadores,
    somaFluxo: function (fl) { return somaFluxo(fluxoCondominio(fl)); }, negritoDaLinha: negritoDaLinha,
    /* marcadores cujo valor tem várias linhas: no Docs, o parágrafo que só tem o marcador vira um parágrafo por linha */
    MARCADORES_PARAGRAFOS: ["FORMA_PAGAMENTO_CONDOMINIO", "FIADORES_QUALIFICACAO"]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
