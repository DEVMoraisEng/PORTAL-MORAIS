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

  function escolherModelo(obraFinalizada) {
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
    var pos = c.toUpperCase().indexOf(n2.toUpperCase());
    if (pos < 0) {
      var m = /\s+E\s+|\s*[&,\/]\s*/i.exec(c);
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

  function montarDadosContrato(f) {
    f = f || {};
    var v = f.venda || {}, o = f.obra || {};
    var c1 = v.COMPRADOR1 || {}, c2 = v.COMPRADOR2 || {};
    var temC2 = !vazio(c2.nome);
    var pagaPor = up(v.COMISSAO_PAGA_POR);
    var total = num(v.VALOR_CONTRATO), comissao = num(v.COMISSAO), naMao = num(v.VALOR_NA_MAO);
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
    return {
      modelo: escolherModelo(o.obraFinalizada),
      comprador1: {
        nome: nomeComprador1(v.CLIENTES, c2.nome), cpf: txt(v.CPF),
        nacionalidade: txt(c1.nacionalidade), estadoCivil: txt(c1.estadoCivil), profissao: txt(c1.profissao),
        documento: txt(c1.documento), endereco: txt(c1.endereco)
      },
      comprador2: temC2 ? {
        nome: txt(c2.nome), cpf: txt(c2.cpf),
        nacionalidade: txt(c2.nacionalidade), estadoCivil: txt(c2.estadoCivil), profissao: txt(c2.profissao),
        documento: txt(c2.documento), endereco: txt(c2.endereco)
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
        conta: txt(vend.conta), pix: txt(vend.pix)
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
        habiteseNumero: txt(v.HABITESE_NUMERO), habiteseData: txt(o.dataHabitese)
      },
      negociacao: {
        valorContrato: total, aquisicao: aquisicao, intermediacao: intermediacao,
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

    var l = d.loteamento;
    if (!l) faltas.push("Loteamento: cadastro em LOTEAMENTOS – CONTRATO");
    else {
      exige(!vazio(l.denominacao), "Loteamento", "denominação");
      exige(!vazio(l.municipioUf), "Loteamento", "município/UF");
      exige(!vazio(l.matricula), "Loteamento", "matrícula do loteamento");
      exige(!vazio(l.cartorio), "Loteamento", "cartório");
      if (pronto) {
        exige(!vazio(l.prazoPosseDias), "Loteamento", "prazo de posse (dias)");
        exige(!vazio(l.prazoChavesDias), "Loteamento", "prazo de entrega das chaves (dias)");
      }
    }

    var im = d.imovel;
    exige(!vazio(im.lote) && !vazio(im.quadra), "Imóvel", "lote e quadra no endereço");
    exige(!vazio(im.matriculaIndividual), "Imóvel", "matrícula individual");
    exige(!vazio(im.cri), "Imóvel", "CRI da matrícula");
    exige(im.area !== null && im.area > 0, "Imóvel", "área do lote");
    exige(!vazio(im.alvaraNumero), "Imóvel", "alvará (número)");
    exige(!vazio(im.alvaraData), "Imóvel", "alvará (data)");
    if (pronto) {
      exige(!vazio(im.habiteseNumero), "Imóvel", "habite-se (número)");
      exige(!vazio(im.habiteseData), "Imóvel", "habite-se (data)");
    }

    var n = d.negociacao, c = d.comissao;
    exige(n.valorContrato !== null && n.valorContrato > 0, "Negociação", "valor do imóvel");
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

    var k = d.corretor;
    if (!k) {
      faltas.push(vazio(d.corretorNaVenda) ? "Corretor: corretor na venda" : "Corretor: cadastro em CORRETORES – CONTRATO");
    } else {
      exige(!vazio(k.nome), "Corretor", "nome");
      exige(!vazio(k.creci), "Corretor", "CRECI");
    }
    return faltas;
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
    var interm = typeof n.intermediacao === "string" ? n.intermediacao
      : (n.intermediacao === null ? "" : "R$ " + moedaBR(n.intermediacao));
    return {
      COMPRADORES: compradores,
      VENDEDOR_NOME: txt(v.nome) || d.nomeProprietario,
      VENDEDOR_DOC: txt(v.cpfCnpj),
      VENDEDOR_ENDERECO: txt(v.endereco),
      VENDEDOR_NACIONALIDADE: ehPJ ? txt(v.representanteNacionalidade) : txt(v.nacionalidade),
      VENDEDOR_ESTADO_CIVIL: ehPJ ? txt(v.representanteEstadoCivil) : txt(v.estadoCivil),
      VENDEDOR_PROFISSAO: ehPJ ? "" : txt(v.profissao),
      VENDEDOR_RG: ehPJ ? txt(v.representanteRg) : txt(v.rg),
      REPRESENTANTE_NOME: txt(v.representanteNome),
      REPRESENTANTE_CPF: txt(v.representanteCpf),
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
  }

  function blocos(d) {
    var v = d.vendedor || {}, n = d.negociacao;
    var temInterm = n.intermediariaValor !== null && n.intermediariaValor > 0;
    return {
      SE_VENDEDOR_PJ: v.tipo === "PJ",
      SE_VENDEDOR_PF: v.tipo === "PF",
      SE_INTERMEDIARIA: temInterm,
      SEM_INTERMEDIARIA: !temInterm,
      SE_COMISSAO_VENDEDOR: d.comissao.pagaPor === "VENDEDOR"
    };
  }

  var api = {
    COL: COL, TIPOS: TIPOS, moedaBR: moedaBR, valorPorExtenso: valorPorExtenso,
    dataBR: dataBR, dataPorExtenso: dataPorExtenso, loteQuadra: loteQuadra,
    escolherModelo: escolherModelo, qualificacao: qualificacao,
    montarDadosContrato: montarDadosContrato, faltasContrato: faltasContrato,
    marcadores: marcadores, blocos: blocos
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
