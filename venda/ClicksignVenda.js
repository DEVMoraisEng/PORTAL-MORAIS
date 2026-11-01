/* ClicksignVenda — regras puras da assinatura eletrônica (entrega 3).
 * Roda igual no Apps Script (arquivo ClicksignVenda.gs do projeto PORTAL-VENDA)
 * e no node (testes em venda/testes). Sem rede: monta os corpos JSON:API da
 * API v3 da Clicksign, decide quem assina e interpreta as respostas.
 * Rotas e corpos conferidos na documentação: venda/CLICKSIGN-API.md.
 * Repositório público: nenhum dado real aqui nem nos testes. */
var ClicksignVenda = (function () {
  "use strict";

  /* Qualificação ("Assinar como") de cada papel — tabela "Tipos de requisitos de
   * qualificação" da documentação. Dúvida registrada no CLICKSIGN-API.md: a
   * página de referência do endpoint lista só sign/party/contractor; se o
   * sandbox recusar estes valores, o envio para no passo "requisitos" com o
   * detalhe da Clicksign (não há troca silenciosa para outro papel). */
  var PAPEIS = { COMPRADOR: "buyer", VENDEDOR: "seller", TESTEMUNHA: "witness", CORRETOR: "real_estate_broker", FIADOR: "guarantor" };
  var SITUACOES = { ENVIADO: "ENVIADO", ASSINADO: "ASSINADO", RECUSADO: "RECUSADO", CANCELADO: "CANCELADO",
                    EXPIRADO: "EXPIRADO", RASCUNHO: "RASCUNHO" };
  var REENVIAVEL = ["CANCELADO", "RECUSADO", "EXPIRADO"];
  /* situações finais: a Propriedade ASSINATURA_PAPEIS_<envelope> não serve mais e é apagada */
  var FINAIS = ["ASSINADO", "CANCELADO", "EXPIRADO", "RECUSADO"];

  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function email(v) { return txt(v).toLowerCase(); }
  function emailValido(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function nomeValido(v) { return /\S+\s+\S+/.test(v) && !/\d/.test(v); }
  function soDigitos(s) { return txt(s).replace(/\D/g, ""); }
  function cpfValido(cpf) {
    var d = soDigitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
      if ((soma * 10) % 11 % 10 !== Number(d[t])) return false;
    }
    return true;
  }
  function cpfFormatado(cpf) {
    var d = soDigitos(cpf);
    return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
  }

  function lerJson(props, nome, invalidas) {
    var bruto = txt(props[nome]);
    if (!bruto) return null;
    try { return JSON.parse(bruto); } catch (e) { invalidas.push(nome); return null; }
  }
  function pessoa(p) { return p && typeof p === "object" ? { nome: txt(p.nome), email: email(p.email), cpf: txt(p.cpf) } : null; }
  function par(lista) {
    if (!Array.isArray(lista) || lista.length !== 2) return null;
    return lista.map(pessoa);
  }

  /* config a partir das Propriedades do script (strings). */
  function montarConfig(props) {
    props = props || {};
    var invalidas = [];
    var spe = lerJson(props, "ASSINATURA_TESTEMUNHAS_SPE", invalidas);
    var pf = lerJson(props, "ASSINATURA_TESTEMUNHAS_PF", invalidas);
    var rep = lerJson(props, "ASSINATURA_REPRESENTANTE", invalidas);
    var opc = lerJson(props, "ASSINATURA_TESTEMUNHAS_OPCOES", invalidas);
    /* escolha gravada para ESTA venda (Propriedade TESTEMUNHAS_<pageId>); ruim = volta ao par padrão */
    var esc = null;
    try { esc = JSON.parse(txt(props.TESTEMUNHAS_ESCOLHIDAS) || "null"); } catch (e) { esc = null; }
    var inc = txt(props.ASSINATURA_INCLUIR_CORRETOR).toUpperCase();
    /* 30/10: rubricas e documentos do comprador (memorial, projeto) — ajustes opcionais; JSON ruim barra o envio */
    var ajuste = lerJson(props, "RUBRICAS_AJUSTE", invalidas);
    var memPos = lerJson(props, "MEMORIAL_POSICAO", invalidas);
    var projPos = lerJson(props, "PROJETO_POSICOES", invalidas);
    var semRub = txt(props.ASSINATURA_SEM_RUBRICAS).toUpperCase();
    /* 01/11 (plano 23, correção 1): assinatura em cima da linha (B) e selfie (C) só ligam com a Propriedade = "1" exato */
    var linhasLig = txt(props.ASSINATURA_LINHAS) === "1", selfie = txt(props.CLICKSIGN_SELFIE) === "1";
    /* unidade 22 (01/11): os vistos ("initials") não apareceram nos PDFs assinados; com "1" vão como assinatura (manuscript) */
    var vistoAss = txt(props.RUBRICAS_VISTO_COMO_ASSINATURA) === "1";
    return { rubricasAjuste: ajusteRubricas(ajuste), memorialPosicao: memPos, projetoPosicoes: projPos,
             semRubricas: semRub === "SIM" || semRub === "TRUE" || semRub === "1", linhas: linhasLig,
             selfie: selfie, vistoComoAssinatura: vistoAss, testemunhasSPE: spe, testemunhasPF: pf, representante: rep, testemunhasOpcoes: opc,
             testemunhasEscolhidas: Array.isArray(esc) ? esc.map(txt) : null,
             incluirCorretor: inc === "SIM" || inc === "TRUE" || inc === "1", invalidas: invalidas };
  }

  /* Entrega 10 — testemunhas escolhidas na hora de gerar o contrato. As opções são as pessoas de
   * ASSINATURA_TESTEMUNHAS_OPCOES mais as dos dois pares padrão (SPE e PF), sem repetir e-mail.
   * O id que vai para a tela é a chave do nome (a tela só vê nomes — nunca e-mail ou CPF). */
  function opcoesTestemunhas(config) {
    var todas = [].concat(Array.isArray(config.testemunhasOpcoes) ? config.testemunhasOpcoes : [],
                          Array.isArray(config.testemunhasSPE) ? config.testemunhasSPE : [],
                          Array.isArray(config.testemunhasPF) ? config.testemunhasPF : []);
    var vistosEmail = {}, vistosId = {}, l = [];
    todas.map(pessoa).forEach(function (p) {
      if (!p || !nomeValido(p.nome) || !emailValido(p.email)) return;
      var id = chave(p.nome);
      if (!id || vistosEmail[p.email] || vistosId[id]) return;
      vistosEmail[p.email] = vistosId[id] = true;
      p.id = id;
      l.push(p);
    });
    return l;
  }
  /* as 2 pessoas escolhidas (na ordem) ou null quando a escolha não fecha com as opções de agora */
  function escolhidas(config, ids) {
    ids = ids === undefined ? config.testemunhasEscolhidas : ids;
    if (!Array.isArray(ids) || ids.length !== 2 || !ids[0] || ids[0] === ids[1]) return null;
    var ops = opcoesTestemunhas(config);
    var pr = ids.map(function (id) { return ops.filter(function (o) { return o.id === txt(id); })[0] || null; });
    return pr[0] && pr[1] ? pr : null;
  }
  /* o que a tela recebe: só id e nome. 01/11/2026 (H5): padrao = os ids do par padrão (o que vale sem escolha) — SPE,
   * ou PF, conforme o tipo do vendedor em `dados` (a mesma regra do envio); [] quando o tipo é desconhecido (sem `dados`)
   * ou o par não fecha com as opções — a tela então não chuta nomes. */
  function testemunhasParaTela(config, dados) {
    var e = escolhidas(config), ops = opcoesTestemunhas(config), padrao = [];
    var pr = dados && dados.vendedor ? par(ehPJ(dados) ? config.testemunhasSPE : config.testemunhasPF) : null;
    if (pr) {
      var ids = pr.map(function (p) { return chave(p.nome); });
      if (ids.every(function (id) { return ops.some(function (o) { return o.id === id; }); })) padrao = ids;
    }
    return { opcoes: ops.map(function (o) { return { id: o.id, nome: o.nome }; }),
             escolhidas: e ? [e[0].id, e[1].id] : [], padrao: padrao };
  }

  /* Conferência das Propriedades (conferirAssinatura, no editor): só o nome da Propriedade e a posição
   * da pessoa — nunca nome, e-mail ou CPF. problemas barram o envio; avisos não. */
  function conferirConfig(config) {
    var problemas = [], avisos = [];
    function pessoaRuim(nomeProp, rotulo, p) {
      var pre = nomeProp + ": " + (rotulo ? rotulo + " " : "");
      if (!nomeValido(p.nome)) problemas.push(pre + "sem nome e sobrenome (ou com número)");
      if (!emailValido(p.email)) problemas.push(pre + "com e-mail inválido");
      if (!cpfValido(p.cpf)) avisos.push(pre + "sem CPF válido (vai digitar o CPF na hora de assinar)");
    }
    function confPar(nomeProp, lido) {
      if ((config.invalidas || []).indexOf(nomeProp) >= 0) { problemas.push(nomeProp + ": não é um JSON válido (confira aspas, vírgulas e colchetes)"); return; }
      if (lido === null || lido === undefined) { problemas.push(nomeProp + ": não preenchida"); return; }
      var pr = par(lido);
      if (!pr) { problemas.push(nomeProp + ": precisa de exatamente 2 pessoas entre [ ]"); return; }
      pr.forEach(function (p, i) { pessoaRuim(nomeProp, "pessoa " + (i + 1), p || { nome: "", email: "", cpf: "" }); });
      if (pr[0] && pr[1] && pr[0].email && pr[0].email === pr[1].email) problemas.push(nomeProp + ": as 2 pessoas têm o mesmo e-mail");
    }
    confPar("ASSINATURA_TESTEMUNHAS_SPE", config.testemunhasSPE);
    confPar("ASSINATURA_TESTEMUNHAS_PF", config.testemunhasPF);
    if ((config.invalidas || []).indexOf("ASSINATURA_REPRESENTANTE") >= 0) problemas.push("ASSINATURA_REPRESENTANTE: não é um JSON válido (confira aspas, vírgulas e chaves)");
    else if (config.representante) pessoaRuim("ASSINATURA_REPRESENTANTE", "", pessoa(config.representante) || { nome: "", email: "", cpf: "" });
    /* opções de testemunha: opcionais; quem estiver ruim não aparece na tela */
    if ((config.invalidas || []).indexOf("ASSINATURA_TESTEMUNHAS_OPCOES") >= 0) problemas.push("ASSINATURA_TESTEMUNHAS_OPCOES: não é um JSON válido (confira aspas, vírgulas e colchetes)");
    else if (config.testemunhasOpcoes !== null && config.testemunhasOpcoes !== undefined) {
      if (!Array.isArray(config.testemunhasOpcoes)) problemas.push("ASSINATURA_TESTEMUNHAS_OPCOES: precisa ser uma lista entre [ ]");
      else config.testemunhasOpcoes.forEach(function (p, i) {
        var pp = pessoa(p) || { nome: "", email: "", cpf: "" };
        if (!nomeValido(pp.nome) || !emailValido(pp.email)) avisos.push("ASSINATURA_TESTEMUNHAS_OPCOES: pessoa " + (i + 1) + " sem nome e sobrenome ou e-mail válido (não aparece na lista)");
        else if (!cpfValido(pp.cpf)) avisos.push("ASSINATURA_TESTEMUNHAS_OPCOES: pessoa " + (i + 1) + " sem CPF válido (vai digitar o CPF na hora de assinar)");
      });
    }
    return { problemas: problemas, avisos: avisos };
  }

  function ehPJ(dados) { return !!dados.vendedor && txt(dados.vendedor.tipo).toUpperCase() === "PJ"; }
  function nomeDoPar(dados) { return ehPJ(dados) ? "ASSINATURA_TESTEMUNHAS_SPE" : "ASSINATURA_TESTEMUNHAS_PF"; }
  function testemunhas(dados, config) {
    var e = escolhidas(config);
    if (e) return e.map(function (p) { return { nome: p.nome, email: p.email, cpf: p.cpf }; });
    return par(ehPJ(dados) ? config.testemunhasSPE : config.testemunhasPF);
  }

  /* Mesma chave do RegrasVenda (acento/caixa/espaço); lida na hora porque no node este arquivo é carregado sozinho. */
  function chave(s) {
    var R = typeof RegrasVenda !== "undefined" ? RegrasVenda : (typeof require === "function" ? require("./RegrasVenda.js") : null);
    return R.chave(s);
  }
  /* O representante vem do cadastro quando ele traz nome e e-mail. A Propriedade só completa o
   * e-mail quando é a MESMA pessoa do cadastro (nome igual pela chave) — nunca troca quem assina. */
  function representante(v, config) {
    if (txt(v.representanteNome) && txt(v.representanteEmail))
      return { nome: txt(v.representanteNome), email: email(v.representanteEmail), cpf: txt(v.representanteCpf) };
    var daConfig = pessoa(config.representante);
    if (daConfig && txt(v.representanteNome) && chave(daConfig.nome) === chave(v.representanteNome)) return daConfig;
    /* sem e-mail: a falta pede o REPRESENTANTE E-MAIL no cadastro */
    return { nome: txt(v.representanteNome), email: "", cpf: txt(v.representanteCpf) };
  }

  /* Lista ordenada de quem assina. Cada item: { papel (rótulo legível), role, nome, email, cpf, origem } e,
   * conforme o papel, soTermos (assina só os termos de confissão) ou rubrica (comprador: rubrica o contrato e
   * assina o memorial e o projeto aprovado — ver documentosDoSignatario). 30/10: um grupo por função, para
   * quem precisar incluir um papel novo (ex.: cônjuge do fiador) mexer só no grupo dele. */
  function sig(papel, role, p, origem, extra) {
    var s = { papel: papel, role: role, nome: txt(p && p.nome), email: email(p && p.email), cpf: txt(p && p.cpf), origem: origem };
    for (var k in (extra || {})) s[k] = extra[k];
    return s;
  }
  function sigCompradores(dados) {
    var l = [sig("Comprador 1", PAPEIS.COMPRADOR, dados.comprador1, "comprador1", { rubrica: true })];
    /* 31/10/2026 (dono): comprador casado → o cônjuge assina logo depois dele. 01/11/2026 (dono): "cônjuge (geralmente vai
       como comprador 2) tem que assinar tudo que o comprador 1 assina" — os mesmos documentos (contrato, termos, memorial,
       projeto) e os mesmos campos de ciência e vistos dos valores, ao lado dos outros compradores (rubrica: true).
       01/11/2026 (dono): no TERMO DE PRÉ-RESERVA o cônjuge só entra se o corretor ligou a opção na venda
       (AssinaturaVenda.assEnviarTermo_ tira o conjugeComprador antes). Se o cônjuge já é o comprador 2 (mesmo CPF ou nome),
       não assina duas vezes. */
    var cj = dados.condominio && dados.condominio.conjugeComprador, c2 = dados.comprador2;
    if (cj && !(c2 && ((soDigitos(cj.cpf) && soDigitos(cj.cpf) === soDigitos(c2.cpf)) || txt(cj.nome).toUpperCase() === txt(c2.nome).toUpperCase())))
      l.push(sig("Cônjuge do comprador 1", PAPEIS.COMPRADOR, cj, "conjugeComprador1", { rubrica: true }));
    if (dados.comprador2) l.push(sig("Comprador 2", PAPEIS.COMPRADOR, dados.comprador2, "comprador2", { rubrica: true }));
    return l;
  }
  function sigVendedor(dados, config) {
    var v = dados.vendedor;
    if (!v) return [];
    if (ehPJ(dados)) return [sig("Vendedor (representante)", PAPEIS.VENDEDOR, representante(v, config), "representante")];
    return [sig("Vendedor", PAPEIS.VENDEDOR, { nome: v.nome, email: v.email, cpf: v.cpfCnpj }, "vendedor")];
  }
  function sigTestemunhas(dados, config) {
    var t = testemunhas(dados, config);
    return t ? [sig("Testemunha 1", PAPEIS.TESTEMUNHA, t[0], "testemunha"), sig("Testemunha 2", PAPEIS.TESTEMUNHA, t[1], "testemunha")] : [];
  }
  /* 30/10: venda direta (isenção da comissão no Alterar fluxo) não tem corretor no contrato nem no envelope */
  function vendaDireta(dados) { return !!(dados.condominio && dados.condominio.livre && dados.condominio.livre.semComissao); }
  function sigCorretor(dados, config) {
    if (!config.incluirCorretor || !dados.corretor || vendaDireta(dados)) return [];
    return [sig("Corretor", PAPEIS.CORRETOR, { nome: dados.corretor.nome, email: dados.corretor.email, cpf: dados.corretor.cpfCnpj }, "corretor")];
  }
  /* 28/10: termos de confissão de dívida no mesmo envelope — os dois fiadores assinam SÓ os termos.
     30/10 (Súmula 332 do STJ): fiador casado cujo cônjuge não é o outro fiador leva o cônjuge junto, também só nos
     termos (outorga conjugal); fi.conjuge vem de ContratoVenda (null quando não precisa). */
  function sigFiadores(dados, config) {
    if (!config.comFiadores || !dados.condominio) return [];
    var l = [];
    (dados.condominio.fiadores || []).slice(0, 2).forEach(function (fi, i) {
      l.push(sig("Fiador " + (i + 1), PAPEIS.FIADOR, { nome: fi.nome, email: fi.email, cpf: fi.cpf }, "fiador" + (i + 1), { soTermos: true }));
      if (fi.conjuge) l.push(sig("Cônjuge do fiador " + (i + 1), PAPEIS.FIADOR, fi.conjuge, "conjugeFiador" + (i + 1), { soTermos: true }));
    });
    return l;
  }
  function signatarios(dados, config) {
    return [].concat(sigCompradores(dados), sigVendedor(dados, config), sigTestemunhas(dados, config),
                     sigCorretor(dados, config), sigFiadores(dados, config));
  }

  /* 01/11/2026 (plano 23 B, dono: "essas alterações estéticas pode fazer"): bloco de assinaturas com UMA linha por pessoa,
   * no lugar dos blocos fixos do modelo ({{ASSINATURAS_QUADRO}}, {{ASSINATURAS_FINAL}} e {{ASSINATURAS_TERMO}}).
   * tipo: "CONTRATO" | "TERMO" (confissão PRÉ/PÓS) | "PRE_RESERVA". Só entra quem assina aquele documento, pelas mesmas
   * regras do envio: no contrato, sem fiadores (assinam só os termos) e com o corretor quando há comissão (como o antigo
   * {{#COM_COMISSAO}}); nos termos de confissão, com os fiadores e os cônjuges deles e sem corretor (não é parte do termo);
   * na pré-reserva, só o comprador 1 e o cônjuge apenas com opc.incluirConjuge (PR_CONJUGE_<pageId>).
   * Ordem: vendedora, comprador 1, cônjuge do comprador 1, comprador 2, fiador 1, cônjuge do fiador 1, fiador 2, cônjuge do
   * fiador 2, corretor, testemunha 1, testemunha 2. Cada pessoa: traço, "Nome: …", "CPF: …" (CNPJ de empresa) e o papel —
   * o nome logo abaixo do traço é o que RubricasVenda.acharLinhas lê e atribuirLinhas casa com o signatário. */
  var TRACO_ASSINATURA = "________________________________";
  function docAssinatura(doc) {
    var d = soDigitos(doc);
    if (!txt(doc)) return "CPF:";
    if (d.length === 14) return "CNPJ: " + d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
    return (d.length > 11 ? "CNPJ: " : "CPF: ") + (d.length === 11 && cpfValido(d) ? cpfFormatado(d) : txt(doc));
  }
  function pessoasDoBloco(dados, config, tipo, opc) {
    config = config || montarConfig({});
    opc = opc || {};
    var termo = tipo === "TERMO", pre = tipo === "PRE_RESERVA", memorial = tipo === "MEMORIAL", cond = !!dados.condominio, out = [];
    function add(rotulo, nome, doc, extra) { out.push({ rotulo: rotulo, nome: txt(nome), doc: txt(doc), extra: txt(extra) }); }
    /* correção 1 (I5): o nome como no {{VENDEDOR_NOME}} — cadastro ou, sem ele, o proprietário da obra */
    var v = dados.vendedor, nomeV = txt(v && v.nome) || txt(dados.nomeProprietario);
    if (nomeV) {
      var rotV = termo ? "CREDORA/VENDEDORA" : (cond ? "VENDEDORA" : "VENDEDOR"), rep = v && ehPJ(dados) ? representante(v, config) : null;
      add(rotV, nomeV, v && v.cpfCnpj, rep && rep.nome ? "Representante: " + rep.nome + (rep.cpf ? " – CPF: " + rep.cpf : "") : "");
    }
    var dc = dados;
    if (pre) {   /* pré-reserva: o comprador 1 (e o cônjuge só com a opção ligada) */
      dc = { comprador1: dados.comprador1, comprador2: null, condominio: opc.incluirConjuge ? dados.condominio : null };
    }
    var rotC = termo ? "DEVEDOR/COMPRADOR" : pre ? "PRÉ-RESERVANTE" : "COMPRADOR", rotCj = pre ? "CÔNJUGE DO PRÉ-RESERVANTE" : "CÔNJUGE DO COMPRADOR";
    sigCompradores(dc).forEach(function (s) { add(s.origem === "conjugeComprador1" ? rotCj : rotC, s.nome, s.cpf); });
    /* dono 01/11/2026: memorial com uma linha por pessoa — a vendedora e quem compra (cônjuge incluído); mais ninguém */
    if (memorial) return out;
    if (termo) sigFiadores(dados, { comFiadores: true }).forEach(function (s) {
      if (!s.nome) return;
      var n = /([12])$/.exec(s.origem)[1];
      add(/^conjuge/.test(s.origem) ? "CÔNJUGE DO FIADOR " + n : "FIADOR " + n, s.nome, s.cpf);
    });
    if (tipo === "CONTRATO" && dados.corretor && txt(dados.corretor.nome) && !vendaDireta(dados))
      add("INTERMEDIADOR/CORRETOR", dados.corretor.nome, dados.corretor.cpfCnpj);
    var t = testemunhas(dados, config) || [null, null];
    [0, 1].forEach(function (i) { add("TESTEMUNHA " + (i + 1), t[i] && t[i].nome, t[i] && t[i].cpf); });
    return out;
  }
  function blocoAssinaturas(dados, config, tipo, opc) {
    var l = [];
    pessoasDoBloco(dados, config, tipo, opc).forEach(function (p, i) {
      if (i) l.push("");
      l.push(TRACO_ASSINATURA, p.nome ? "Nome: " + p.nome : "Nome:", docAssinatura(p.doc));
      if (p.extra) l.push(p.extra);
      l.push(p.rotulo);
    });
    return l.join("\n");
  }

  var ONDE_EMAIL = {
    comprador1: "coluna Email",
    comprador2: "coluna COMPRADOR 2 - E-MAIL",
    conjugeComprador1: "coluna EMAIL CONJUGE",
    vendedor: "coluna E-MAIL em VENDEDORES – CONTRATO",
    corretor: "coluna E-MAIL em CORRETORES – CONTRATO",
    fiador1: "coluna EMAIL FIADOR 1", fiador2: "coluna EMAIL FIADOR 2",
    conjugeFiador1: "coluna EMAIL CONJUGE FIADOR 1", conjugeFiador2: "coluna EMAIL CONJUGE FIADOR 2",
    testemunha: ""
  };

  /* Faltas legíveis (sem dado pessoal: só papel e o que falta). */
  function faltasAssinatura(dados, config) {
    var faltas = [];
    config = config || montarConfig({});
    if (!dados.vendedor) faltas.push("Vendedor: cadastro em VENDEDORES – CONTRATO");
    if (!testemunhas(dados, config)) faltas.push("Testemunhas: Propriedade " + nomeDoPar(dados) + " não configurada (precisa de 2)");
    if (config.incluirCorretor && !dados.corretor && !vendaDireta(dados)) faltas.push("Corretor: cadastro em CORRETORES – CONTRATO");
    var vistos = {}, porPessoa = [];
    signatarios(dados, config).forEach(function (s) {
      var f = [];
      if (!nomeValido(s.nome)) f.push(s.papel + ": nome e sobrenome, sem números");
      if (!s.email && s.origem === "representante") f.push("Vendedor: falta REPRESENTANTE E-MAIL no cadastro");
      else if (!s.email) f.push(s.papel + ": e-mail" + (ONDE_EMAIL[s.origem] ? " (" + ONDE_EMAIL[s.origem] + ")" : ""));
      else if (!emailValido(s.email)) f.push(s.papel + ": e-mail inválido");
      else if (vistos[s.email]) f.push(s.papel + ": e-mail repetido (igual ao de " + vistos[s.email] + ")");
      else vistos[s.email] = s.papel;
      if (s.cpf && soDigitos(s.cpf).length <= 11 && !cpfValido(s.cpf)) f.push(s.papel + ": CPF inválido");
      porPessoa = porPessoa.concat(f);
    });
    return faltas.concat(porPessoa);
  }

  /* 01/11/2026 (teste e2e): o que o envio barraria por NOME ou E-MAIL de quem é do cliente (comprador, cônjuge, fiador)
   * já aparece no Gerar pré-contrato. Só estes papéis entram (testemunhas, vendedor/representante e corretor são
   * cadastro da casa); o e-mail repetido é apontado em quem é do cliente, mesmo quando a outra ponta é o vendedor.
   * Os textos começam por "Comprador", "Fiador" ou "Cônjuge" — assim o link do cliente também os mostra. */
  function doCliente(s) { return /^(Comprador|Fiador|C[ôo]njuge)/.test(s.papel); }
  /* 01/11/2026 (revisão final, I1): e-mail que falta (ou inválido) de fiador e de cônjuge também aparece no Gerar, com o
     mesmo texto do envio — a tela abre o bloco Fiadores/Cônjuge para corrigir. O comprador fica de fora (tem link próprio). */
  var EMAIL_NO_GERAR = { conjugeComprador1: 1, fiador1: 1, fiador2: 1, conjugeFiador1: 1, conjugeFiador2: 1 };
  function faltasDeNomeEEmail(dados, config) {
    config = config || montarConfig({});   /* config.comFiadores: quem chama decide (ConfissaoVenda.fiadoresAssinam), como no envio */
    var lista = signatarios(dados, config), vistos = {}, por = lista.map(function () { return []; });
    lista.forEach(function (s, i) {
      if (doCliente(s) && txt(s.nome) && !nomeValido(s.nome))
        por[i].push(s.papel + (/\d/.test(s.nome) ? ": nome sem números" : ": nome e sobrenome"));
      if (EMAIL_NO_GERAR[s.origem] && !s.email) por[i].push(s.papel + ": e-mail (" + ONDE_EMAIL[s.origem] + ")");
      else if (EMAIL_NO_GERAR[s.origem] && !emailValido(s.email)) por[i].push(s.papel + ": e-mail inválido");
      if (!s.email || !emailValido(s.email)) return;
      if (vistos[s.email] === undefined) { vistos[s.email] = i; return; }
      var ate = vistos[s.email], antes = lista[ate];
      if (doCliente(s)) por[i].push(s.papel + ": e-mail igual ao do " + antes.papel + " (cada pessoa precisa de um e-mail)");
      else if (doCliente(antes)) por[ate].push(antes.papel + ": e-mail igual ao do " + s.papel + " (cada pessoa precisa de um e-mail)");
    });
    return [].concat.apply([], por);
  }

  /* 27/10 (dono): falta de e-mail vem com o atalho para corrigir numa aba nova, na tela do PORTAL onde o
   * e-mail mora (não no Notion). Devolve [{ quem, rotulo }] — quem: comprador | vendedor | corretor; a
   * tela monta o endereço. E-mail repetido aponta as duas pontas. */
  function linksCorrigirEmail(faltas) {
    var t = (faltas || []).filter(function (f) { return /e-mail/i.test(f); }).join(" | "), l = [];
    if (/(Comprador [12]|Pré-reservante)[^|]*e-mail|igual ao de (Comprador|Pré-reservante)/.test(t)) l.push({ quem: "comprador", rotulo: "Corrigir e-mail do comprador" });
    if (/Vendedor[^|]*e-mail|igual ao de Vendedor/.test(t)) l.push({ quem: "vendedor", rotulo: "Corrigir e-mail do vendedor/representante" });
    if (/Corretor[^|]*e-mail|igual ao de Corretor/.test(t)) l.push({ quem: "corretor", rotulo: "Corrigir e-mail do corretor" });
    return l;
  }

  /* ---- corpos JSON:API (v3) ---- */
  /* Entrega 14 — padrão do dono: "OBRA - COMPRADOR". OBRA = ENDEREÇO da casa + " CASA n" (quando a casa tem
   * número e o endereço ainda não diz essa casa); COMPRADOR = nome do comprador 1. O mesmo nome vai no
   * envelope e no documento (nomeArquivo + ".pdf"). Sem comprador fica só a obra; sem nada, o nome genérico. */
  function nomePadrao(endereco, casa, comprador) {
    var limpo = function (s) { return txt(s).replace(/[\\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim(); };
    var obra = limpo(endereco), n = limpo(casa).replace(/^CASA\s*/i, "");
    if (n && !new RegExp("\\bCASA\\s*0*" + n.replace(/^0+(?=.)/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(obra))
      obra = (obra ? obra + " " : "") + "CASA " + n;
    var partes = [obra, limpo(comprador)].filter(function (x) { return x; });
    return partes.length ? partes.join(" - ").slice(0, 200) : "Contrato de compra e venda";
  }
  /* 01/11/2026 (plano 23 A, dono: "pq veio com nome de provisorio"): nome da cópia do Google Docs — o PDF exportado herda
   * esse nome como título, e a Clicksign o mantém. prefixo ("CONTRATO - ", "TERMO DE PRÉ-RESERVA - ", ...) + nome padrão. */
  function tituloDocumento(prefixo, endereco, casa, comprador) {
    var n = nomePadrao(endereco, casa, comprador);
    return (txt(prefixo).replace(/\s+$/, "") + " " + (n === "Contrato de compra e venda" ? "" : n)).replace(/\s{2,}/g, " ").trim();
  }
  /* compatível com a chamada antiga (só o endereço) */
  function nomeEnvelope(endereco, casa, comprador) { return nomePadrao(endereco, casa, comprador); }
  function nomeArquivo(nome) {
    var n = txt(nome) || "contrato";
    return /\.pdf$/i.test(n) ? n : n + ".pdf";
  }
  function corpoEnvelope(nome) {
    return { data: { type: "envelopes", attributes: {
      name: nome, locale: "pt-BR", auto_close: true, block_after_refusal: true,
      /* prazo vencido com assinatura faltando cancela (o padrão "closed" finalizaria um contrato incompleto) */
      deadline_partial_signature_action: "canceled" } } };
  }
  function corpoDocumento(filename, base64) {
    return { data: { type: "documents", attributes: { filename: filename, content_base64: "data:application/pdf;base64," + base64 } } };
  }
  function corpoSignatario(s) {
    var a = { name: s.nome, email: s.email, has_documentation: true };
    if (soDigitos(s.cpf).length === 11 && cpfValido(s.cpf)) a.documentation = cpfFormatado(s.cpf);
    a.refusable = true;
    return { data: { type: "signers", attributes: a } };
  }
  function relacoes(docId, signerId) {
    return { document: { data: { type: "documents", id: docId } }, signer: { data: { type: "signers", id: signerId } } };
  }
  function corpoQualificacao(docId, signerId, role) {
    return { data: { type: "requirements", attributes: { action: "agree", role: role }, relationships: relacoes(docId, signerId) } };
  }
  /* auth: "email" (padrão) ou um dos AUTH_SELFIE — um requisito provide_evidence por autenticação (doc "Criar requisito
   * de autenticação": cada requisito leva um valor de auth; para pedir vários, vários requisitos). */
  function corpoAutenticacao(docId, signerId, auth) {
    return { data: { type: "requirements", attributes: { action: "provide_evidence", auth: auth || "email" }, relationships: relacoes(docId, signerId) } };
  }
  /* 01/11/2026 (plano 23 C, dono: selfie "sim" para comprador, cônjuge e fiadores). Valores da lista "auth" da API v3
   * (developers.clicksign.com/reference/criar-requisito-de-autenticacao, lida em 01/11/2026): "selfie" = foto do
   * signatário pela câmera; "official_document" = foto (frente e verso) do documento oficial. A doc não traz um valor
   * único "selfie com documento" nem diz com todas as letras que somam com o token por e-mail (só proíbe combiná-los com
   * biometric/facial_biometrics/identity_biometrics) — conferir no 1º envelope do sandbox. Vendedora, corretor e
   * testemunhas continuam só com o token. Só com a Propriedade CLICKSIGN_SELFIE=1.
   * 01/11/2026 (contrato assinado mostrado pelo dono): o log da Clicksign traz UMA autenticação "Foto de face & documento"
   * (selfie_*.png) — é o requisito "selfie" sozinho; o "official_document" separado saiu.
   * 01/11/2026 (dono): selfie quando o VENDEDOR é empresa (venda PJ → PF): condomínio (SPE) sempre; casa de rua só com
   * vendedor de CNPJ. Vendedor pessoa física (PF → PF) não pede selfie. Sem os dados da venda, não liga. */
  var AUTH_SELFIE = ["selfie"];
  function vendedorEmpresa(dados) {
    if (!dados) return false;
    if (dados.condominio) return true;
    var v = dados.vendedor;
    if (!v) return false;
    if (soDigitos(v.cpfCnpj).length === 14) return true;
    return txt(v.tipo).toUpperCase() === "PJ";
  }
  var COM_SELFIE = /^(comprador[12]|conjugeComprador1|fiador[12]|conjugeFiador[12])$/;
  function autenticacoes(s, config, dados) {
    return config && config.selfie && vendedorEmpresa(dados) && COM_SELFIE.test(txt(s && s.origem)) ? ["email"].concat(AUTH_SELFIE) : ["email"];
  }
  /* 30/10: rubrica posicionada — kind "initials" (visto) ou "manuscript" (assinatura); positions [{ page: "n", position: [x, y] }]
   * em proporção da página (0–1, x da esquerda, y do topo). positions, pages e rubric_field são exclusivos. */
  function corpoRubrica(docId, signerId, kind, positions) {
    return { data: { type: "requirements", attributes: { action: "rubricate", kind: kind, positions: positions },
                     relationships: relacoes(docId, signerId) } };
  }
  function corpoAtivar(envelopeId) {
    return { data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } } };
  }
  /* 30/10: a API v3 não cancela o envelope (o PATCH do envelope só aceita draft/running — 400 na casa 15).
     Cancela-se cada DOCUMENTO em andamento: PATCH /envelopes/{id}/documents/{doc} com status canceled
     (doc "Editar Documento": só documentos running mudam de status). */
  function corpoCancelarDocumento(documentoId) {
    return { data: { id: documentoId, type: "documents", attributes: { status: "canceled" } } };
  }
  /* status efetivo do envelope: running com todos os documentos cancelados conta como canceled */
  function statusEfetivo(statusEnvelope, docs) {
    var l = docs || [];
    if (statusEnvelope === "running" && l.length &&
        l.every(function (d) { return txt(d && d.attributes && d.attributes.status) === "canceled"; })) return "canceled";
    return statusEnvelope;
  }
  function corpoNotificacao() { return { data: { type: "notifications", attributes: {} } }; }

  /* ---- respostas ---- */
  /* "fulano@dominio" → "***@dominio": o detalhe da Clicksign vai para a tela e pode repetir e-mail. */
  function mascararEmails(s) { return txt(s).replace(/[^\s@:;,<>()"']+@([^\s@:;,<>()"']+)/g, "***@$1"); }

  /* 2xx sem corpo (204) ou com corpo que não é JSON conta como sucesso SEM id: quem precisa
   * do id (envelope, documento, signatário) confere à parte (AssinaturaVenda csPasso_). */
  function interpretar(code, texto) {
    var j = null;
    try { j = JSON.parse(texto); } catch (e) { j = null; }
    if (code >= 200 && code < 300) {
      if (!j || typeof j !== "object") return { ok: true, id: "", status: "", data: null };
      var d = j.data || null;
      return { ok: true, id: d && !Array.isArray(d) ? txt(d.id) : "",
               status: d && !Array.isArray(d) && d.attributes ? txt(d.attributes.status) : "", data: d };
    }
    var e = j && Array.isArray(j.errors) && j.errors[0] ? j.errors[0] : null;
    var det = e ? [txt(e.title), txt(e.detail)].filter(function (x) { return x; }).join(": ") : "";
    return { ok: false, http: code, detalhe: mascararEmails(det).slice(0, 200) };
  }

  function nomesDosEventos(eventos) {
    return (eventos || []).map(function (e) { return txt(e && e.attributes && e.attributes.name); });
  }
  /* Situação gravada no Notion a partir do status do envelope (draft, running, canceled, closed) e dos eventos do documento. */
  function situacao(status, eventos) {
    var n = nomesDosEventos(eventos);
    switch (status) {
      case "running": return n.indexOf("refusal") >= 0 ? SITUACOES.RECUSADO : SITUACOES.ENVIADO;
      case "closed": return SITUACOES.ASSINADO;
      case "canceled":
        if (n.indexOf("refusal") >= 0) return SITUACOES.RECUSADO;
        if (n.indexOf("deadline") >= 0) return SITUACOES.EXPIRADO;
        return SITUACOES.CANCELADO;
      case "draft": return SITUACOES.RASCUNHO;
      default: throw new Error("CLICKSIGN_STATUS_DESCONHECIDO: " + txt(status).slice(0, 40));
    }
  }
  /* { signerId: assinou } — só pelos eventos "sign" (e-mail; formato documentado nos webhooks).
   * Envelope closed sem o "sign" de alguém NÃO marca essa pessoa: AssinaturaVenda avisa
   * ASSINATURAS_INCOMPLETAS (a situação continua ASSINADO, o PDF é o da Clicksign). */
  function assinaram(signers, eventos) {
    var feitos = {};
    (eventos || []).forEach(function (e) {
      var a = (e && e.attributes) || {};
      if (a.name === "sign" && a.data && a.data.signer) feitos[email(a.data.signer.email)] = true;
    });
    var r = {};
    (signers || []).forEach(function (s) {
      r[s.id] = !!feitos[email(s.attributes && s.attributes.email)];
    });
    return r;
  }
  /* { signerId: { situacao: "assinou" | "recusou" | "pendente", data } } pelos eventos "sign" e "refusal"
   * do documento (casados por e-mail, como em assinaram). data = attributes.created do evento (ISO) —
   * [SUPOSIÇÃO] registrada no CLICKSIGN-API.md; sem ela, data fica "". Recusa vale mais que assinatura. */
  function situacaoDosSignatarios(signers, eventos) {
    var porEmail = {};
    (eventos || []).forEach(function (e) {
      var a = (e && e.attributes) || {};
      if ((a.name !== "sign" && a.name !== "refusal") || !a.data || !a.data.signer) return;
      var k = email(a.data.signer.email), atual = porEmail[k];
      if (atual && atual.situacao === "recusou") return;
      porEmail[k] = { situacao: a.name === "sign" ? "assinou" : "recusou", data: txt(a.created || a.created_at || "").slice(0, 40) };
    });
    var r = {};
    (signers || []).forEach(function (s) {
      r[s.id] = porEmail[email(s.attributes && s.attributes.email)] || { situacao: "pendente", data: "" };
    });
    return r;
  }
  /* "Maria Exemplo da Silva" → "Maria S." — primeiro nome + inicial do último; nunca o nome inteiro. */
  function nomeMascarado(nome) {
    var p = txt(nome).split(/\s+/).filter(function (x) { return x; });
    if (!p.length) return "";
    var primeiro = p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase();
    return p.length > 1 ? primeiro + " " + p[p.length - 1].charAt(0).toUpperCase() + "." : primeiro;
  }
  /* Reenvio do aviso: no máximo 1 a cada REENVIO_MIN minutos por envelope. Devolve os minutos que faltam (0 = pode). */
  var REENVIO_MIN = 10;
  function minutosParaReenviar(ultimoMs, agoraMs) {
    var u = Number(ultimoMs) || 0;
    if (!u) return 0;
    var falta = u + REENVIO_MIN * 60000 - agoraMs;
    return falta > 0 ? Math.ceil(falta / 60000) : 0;
  }

  /* Envelope com situação vazia (gravação incompleta) conta como aberto: na dúvida, não manda outro. */
  function podeEnviar(envelopeId, sit) { return !txt(envelopeId) || REENVIAVEL.indexOf(txt(sit).toUpperCase()) >= 0; }

  /* Link do PDF assinado. A documentação v3 só mostra links.files.original; "signed" é suposição
   * registrada como dúvida — sem ele, falha visível com as chaves que vieram (nunca baixa o original). */
  function linkAssinado(doc) {
    var f = (doc && doc.links && doc.links.files) || {};
    if (typeof f.signed === "string" && /^https:\/\//.test(f.signed)) return f.signed;
    var chaves = Object.keys(f);
    throw new Error("CLICKSIGN_SEM_LINK_ASSINADO: " + (chaves.length ? chaves.join(", ") : "(nenhum)"));
  }

  /* ---- 30/10: rubricas do comprador e documentos só dele (memorial descritivo, projeto aprovado) ----
   * Quem acha as posições no contrato é a tela (RubricasVenda.js, pdf.js no navegador, no PDF final que vai
   * para a Clicksign); aqui só se confere o que veio e se montam os requisitos. Memorial e projeto têm layout
   * fixo: posição fixa, com ajuste opcional pelas Propriedades MEMORIAL_POSICAO e PROJETO_POSICOES. */
  var DOC = { CONTRATO: "contrato", TERMO: "termo", MEMORIAL: "memorial", PROJETO: "projeto" };
  var PREFIXO_DOC = { memorial: "MEMORIAL DESCRITIVO - ", projeto: "PROJETO APROVADO - " };
  function nomeDocumentoAdicional(tipo, nomeEnvelope) { return nomeArquivo(PREFIXO_DOC[tipo] + txt(nomeEnvelope)); }
  /* tipo do documento pelo nome do arquivo na Clicksign (ehTermo vem do ConfissaoVenda, que conhece os nomes dos termos) */
  function tipoDoDocumento(filename, ehTermo) {
    var n = txt(filename).toUpperCase();
    if (ehTermo) return DOC.TERMO;
    if (n.indexOf(PREFIXO_DOC.memorial) === 0) return DOC.MEMORIAL;
    if (n.indexOf(PREFIXO_DOC.projeto) === 0) return DOC.PROJETO;
    return DOC.CONTRATO;
  }
  /* 01/11/2026 (plano 23 A): documentos de um envelope assinado para a tela — [{ id, nome, tipo }], o contrato primeiro,
   * sem link (o PDF vem pela sessão do portal, ação verDocumentoAssinado). ehTermo(filename) vem do ConfissaoVenda. */
  function listaAssinados(docs, ehTermo) {
    var ordem = {}; ordem[DOC.CONTRATO] = 0; ordem[DOC.TERMO] = 1; ordem[DOC.MEMORIAL] = 2; ordem[DOC.PROJETO] = 3;
    return (docs || []).map(function (d, i) {
      var n = txt(d && d.attributes && d.attributes.filename);
      return { id: txt(d && d.id), nome: n, tipo: tipoDoDocumento(n, typeof ehTermo === "function" && !!ehTermo(n)), i: i };
    }).filter(function (x) { return x.id; }).sort(function (a, b) { return (ordem[a.tipo] - ordem[b.tipo]) || (a.i - b.i); })
      .map(function (x) { return { id: x.id, nome: x.nome, tipo: x.tipo }; });
  }
  /* docs: [{ id, tipo }] → ids que este signatário assina. Fiador: só os termos; comprador (rubrica): todos;
   * os demais: o contrato e os termos (memorial e projeto são só do comprador). */
  function documentosDoSignatario(s, docs) {
    return (docs || []).filter(function (d) {
      if (s.soTermos) return d.tipo === DOC.TERMO;
      if (s.origem === "corretor") return d.tipo === DOC.CONTRATO;   /* 01/11 (dono): o corretor só assina o contrato */
      /* 01/11/2026 (dono): "o comprador 1 e o 2/3 (quando tiver) têm que assinar os mesmos documentos, exatamente os mesmos,
         tem que ter a assinatura dos 2 ou 3 nos mesmos (junto com vendedor tb)" — compradores e vendedor: todos os documentos */
      if (s.rubrica || ehVendedorSig(s)) return true;
      return d.tipo === DOC.CONTRATO || d.tipo === DOC.TERMO;
    }).map(function (d) { return d.id; });
  }

  /* Ajuste somado às posições achadas no contrato (proporção da página). A Clicksign não documenta se [x, y]
   * é o canto de cima à esquerda ou o centro da caixa: o padrão supõe o canto e sobe a assinatura para ficar
   * em cima da linha "ASSINATURA: ____". Conferir no sandbox e, se precisar, corrigir pela Propriedade
   * RUBRICAS_AJUSTE, ex.: {"campo":{"dx":0,"dy":-0.015},"valores":{"dx":0,"dy":0}}. */
  /* calibração 01/11: campos e linhas já saem com o topo 46 pt acima da linha de base (RubricasVenda) — ajuste padrão 0 */
  var AJUSTE_PADRAO = { campo: { dx: 0, dy: 0 }, valores: { dx: 0, dy: 0 }, linha: { dx: 0, dy: 0 } };
  function numOu(v, padrao) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= 0.5 ? v : padrao; }
  function ajusteRubricas(j) {
    j = j && typeof j === "object" ? j : {};
    var r = {};
    ["campo", "valores", "linha"].forEach(function (k) {
      var a = j[k] && typeof j[k] === "object" ? j[k] : {};
      r[k] = { dx: numOu(a.dx, AJUSTE_PADRAO[k].dx), dy: numOu(a.dy, AJUSTE_PADRAO[k].dy) };
    });
    return r;
  }

  var MAX_CAMPOS = 30;
  function arred(v) { return Math.round(v * 10000) / 10000; }
  /* { page, position: [x, y] } conferido → { page: "n", position: [x, y] } ou null */
  function posicaoValida(p) {
    if (!p || typeof p !== "object" || !Array.isArray(p.position) || p.position.length !== 2) return null;
    var pg = Number(p.page), x = Number(p.position[0]), y = Number(p.position[1]);
    if (!(pg >= 1 && pg <= 999 && Math.floor(pg) === pg)) return null;
    if (!isFinite(x) || !isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { page: String(pg), position: [arred(x), arred(y)] };
  }
  /* O que a tela mandou junto com "Enviar": { nome (do PDF lido), campos: [pos], valores: pos | null }.
   * nomeGerado = nome do PDF que o servidor vai mandar; diferente = a tela leu outro PDF. */
  /* opc.linhas === false (ASSINATURA_LINHAS desligada): linhas e termos da tela são ignorados sem conferir */
  function validarRubricas(r, nomeGerado, opc) {
    if (!r || typeof r !== "object") return { ok: false, erro: "RUBRICAS_FALTANDO" };
    if (txt(r.nome) !== txt(nomeGerado)) return { ok: false, erro: "RUBRICAS_DE_OUTRO_PDF" };
    var campos = Array.isArray(r.campos) ? r.campos : [];
    if (!campos.length || campos.length > MAX_CAMPOS) return { ok: false, erro: "RUBRICAS_INVALIDAS" };
    var ok = campos.map(posicaoValida);
    if (ok.some(function (p) { return !p; })) return { ok: false, erro: "RUBRICAS_INVALIDAS" };
    var val = null;
    if (r.valores) { val = posicaoValida(r.valores); if (!val) return { ok: false, erro: "RUBRICAS_INVALIDAS" }; }
    /* 01/11 (plano 23 B): linhas de assinatura do contrato e de cada termo de confissão (nome do PDF na Clicksign) */
    var linhas = [], termos = {};
    if (opc && opc.linhas === false) return { ok: true, campos: ok, valores: val, linhas: linhas, termos: termos, memorial: [] };
    /* dono 01/11: linhas do memorial (uma por pessoa) lidas na tela no PDF do memorial */
    var memorial = [];
    if (r.memorial !== undefined) { memorial = linhasValidas(r.memorial && r.memorial.linhas); if (!memorial) return { ok: false, erro: "RUBRICAS_INVALIDAS" }; }
    if (r.linhas !== undefined) { linhas = linhasValidas(r.linhas); if (!linhas) return { ok: false, erro: "RUBRICAS_INVALIDAS" }; }
    if (r.termos !== undefined) {
      if (!Array.isArray(r.termos) || r.termos.length > 4) return { ok: false, erro: "RUBRICAS_INVALIDAS" };
      for (var i = 0; i < r.termos.length; i++) {
        var t = r.termos[i], lt = t && txt(t.nome) ? linhasValidas(t.linhas) : null;
        if (!lt) return { ok: false, erro: "RUBRICAS_INVALIDAS" };
        termos[txt(t.nome)] = lt;
      }
    }
    return { ok: true, campos: ok, valores: val, linhas: linhas, termos: termos, memorial: memorial };
  }
  var MAX_LINHAS = 60;
  function linhasValidas(a) {
    if (!Array.isArray(a) || a.length > MAX_LINHAS) return null;
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var p = posicaoValida(a[i]);
      if (!p || typeof a[i].texto !== "string") return null;
      out.push({ page: p.page, position: p.position, texto: a[i].texto.trim().slice(0, 300) });
    }
    return out;
  }

  /* 01/11/2026 (plano 23 B): de quem é cada linha de assinatura lida no PDF. linhas: [{ page, position, texto }];
   * tipo: DOC.CONTRATO ou DOC.TERMO. Devolve, para cada signatário da lista (mesma ordem), as posições dele.
   * 1º pelo nome: o texto da linha traz o nome de UMA pessoa que assina esse documento → é dela; duas ou mais (a linha
   * única "Nome: A / B" do modelo de hoje) → ninguém (a pessoa assina só na página da Clicksign, como antes).
   * Sem nome: pelo papel escrito — TESTEMUNHA n, FIADOR n, CORRETOR/INTERMEDIADOR, VENDEDORA/CREDORA, e COMPRADOR/DEVEDOR
   * só quando uma única pessoa assina como parte compradora. */
  /* 01/11 (dono): o corretor assina SÓ o contrato — nunca os termos de confissão (nem a pré-reserva) */
  function assinaOTipo(s, tipo) {
    if (tipo === DOC.TERMO) return s.origem !== "corretor";
    if (tipo === DOC.CONTRATO) return !s.soTermos;
    if (tipo === DOC.MEMORIAL) return !!s.rubrica || s.origem === "vendedor" || s.origem === "representante";   /* dono 01/11 */
    return false;
  }
  /* correção 3 (5): papéis escritos no texto de uma linha, já normalizados (um por pessoa). Dois papéis diferentes = a
     leitura pegou o bloco do lado: a linha não vai para ninguém (melhor sem assinatura posicionada do que na errada). */
  var RE_PAPEIS = /\b(CONJUGE DO (?:COMPRADOR|PRE-RESERVANTE|FIADOR [12])|CREDORA\/VENDEDORA|DEVEDOR\/COMPRADOR|INTERMEDIADOR\/CORRETOR|VENDEDORA?|COMPRADOR|FIADOR [12]|TESTEMUNHA [12]|PRE-RESERVANTE|CORRETOR|INTERMEDIADOR)\b/g;
  var PAPEL_NORMAL = { "CREDORA/VENDEDORA": "VENDEDOR", "VENDEDORA": "VENDEDOR", "DEVEDOR/COMPRADOR": "COMPRADOR",
                       "INTERMEDIADOR/CORRETOR": "CORRETOR", "INTERMEDIADOR": "CORRETOR" };
  function papeisNoTexto(t) {
    var vistos = [], m;
    RE_PAPEIS.lastIndex = 0;
    while ((m = RE_PAPEIS.exec(t))) {
      var p = PAPEL_NORMAL[m[1]] || m[1];
      if (vistos.indexOf(p) < 0) vistos.push(p);
    }
    return vistos;
  }
  function atribuirLinhas(lista, linhas, tipo) {
    lista = lista || [];
    var r = lista.map(function () { return []; });
    var cands = [], test = [];
    lista.forEach(function (s, i) { if (assinaOTipo(s, tipo)) cands.push(i); if (s.origem === "testemunha") test.push(i); });
    function daOrigem(re) { var l = cands.filter(function (i) { return re.test(lista[i].origem || ""); }); return l.length === 1 ? l[0] : -1; }
    (linhas || []).forEach(function (l) {
      var t = chave(l && l.texto), alvo = -1, m, papeis = papeisNoTexto(t);
      if (papeis.length > 1) return;
      var porNome = cands.filter(function (i) { var n = chave(lista[i].nome); return n.length >= 5 && t.indexOf(n) >= 0; });
      /* unidade 22 (01/11): um nome contido no outro ("JOSE SILVA" × "MARIA JOSE SILVA") — fica o mais longo */
      if (porNome.length > 1) porNome = porNome.filter(function (i) {
        var n = chave(lista[i].nome);
        return !porNome.some(function (j) { var o = chave(lista[j].nome); return j !== i && o.length > n.length && o.indexOf(n) >= 0; });
      });
      /* linha da VENDEDORA com o nome de um comprador (coluna do lado): ninguém */
      if (porNome.length === 1) alvo = papeis[0] === "VENDEDOR" && lista[porNome[0]].role !== PAPEIS.VENDEDOR ? -1 : porNome[0];
      /* correção 1 (I-3): linha de CÔNJUGE ("CÔNJUGE DO FIADOR 1", "CÔNJUGE") só pelo nome — o papel apontaria o fiador/comprador */
      else if (!porNome.length && !/CONJUGE/.test(t)) {
        if ((m = /TESTEMUNHA\s*([12])/.exec(t))) { var it = test[Number(m[1]) - 1]; alvo = it !== undefined && cands.indexOf(it) >= 0 ? it : -1; }
        else if ((m = /FIADOR\s*([12])/.exec(t))) alvo = daOrigem(new RegExp("^fiador" + m[1] + "$"));
        else if (/CORRETOR|INTERMEDIADOR/.test(t)) alvo = daOrigem(/^corretor$/);
        else if (/VENDEDOR|CREDOR/.test(t)) alvo = daOrigem(/^(vendedor|representante)$/);
        else if (/COMPRADOR|DEVEDOR/.test(t)) {
          var b = cands.filter(function (i) { return lista[i].role === PAPEIS.COMPRADOR; });
          alvo = b.length === 1 ? b[0] : -1;
        }
      }
      if (alvo >= 0) r[alvo].push({ page: l.page, position: l.position.slice() });
    });
    return r;
  }

  /* Projeto aprovado (12 páginas, 1–2 em A1 deitado, 3–11 em A2 deitado, 12 A4 sem carimbo): o visto fica no
   * espaço vazio logo abaixo de "Senador Canedo, <data>" do carimbo DEFERIMENTO. Medido no PDF de 30/10/2026
   * (canto de cima à esquerda da caixa = começo da linha da data, um pouco abaixo dela). Página 12: sem visto. */
  var POSICOES_PROJETO = [
    [1, 0.934, 0.948], [2, 0.936, 0.966], [3, 0.902, 0.953], [4, 0.893, 0.953], [5, 0.901, 0.960], [6, 0.900, 0.955],
    [7, 0.897, 0.961], [8, 0.905, 0.957], [9, 0.895, 0.963], [10, 0.782, 0.932], [11, 0.890, 0.960]
  ].map(function (a) { return { page: String(a[0]), position: [a[1], a[2]] }; });
  /* lista da Propriedade PROJETO_POSICOES (quando válida e não vazia) ou a medida acima */
  function posicoesProjeto(cfg) {
    if (Array.isArray(cfg) && cfg.length) {
      var l = cfg.map(posicaoValida);
      if (l.every(function (p) { return p; })) return l;
    }
    return POSICOES_PROJETO.map(function (p) { return { page: p.page, position: p.position.slice() }; });
  }
  /* Memorial descritivo: assinatura do comprador na linha "______" acima de "Comprador(es)", na última página.
   * cfg (Propriedade MEMORIAL_POSICAO) = { position: [x, y], pagina?: n }; sem pagina, vale a última. */
  var MEMORIAL_PADRAO = [0.53, 0.70];
  function posicaoMemorial(nPaginas, cfg) {
    cfg = cfg && typeof cfg === "object" ? cfg : {};
    var pos = Array.isArray(cfg.position) ? cfg.position : MEMORIAL_PADRAO;
    var pg = Number(cfg.pagina) || Number(nPaginas) || 0;
    return posicaoValida({ page: pg, position: pos }) || (Number(nPaginas) ? posicaoValida({ page: Number(nPaginas), position: MEMORIAL_PADRAO }) : null);
  }
  /* Número de páginas de um PDF (bytes como texto latin-1): conta os objetos /Type /Page. O PDF do Google Docs
   * não usa object streams, então a contagem é direta; 0 = não deu para contar. */
  function contarPaginasPdf(bin) {
    var m = String(bin || "").match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    return m ? m.length : 0;
  }

  /* Requisitos de rubrica de um signatário: [{ docId, kind, positions }].
   * docs: [{ id, tipo, nome? }]; rub: { campos, valores } (já validado), memorial: pos | null, projeto: [pos],
   * 01/11 (plano 23 B) linhas: [{ page, position, texto }] do contrato e termos: { nomeDoPdf: linhas }.
   * Comprador (s.rubrica): campos de ciência + a linha dele numa só "manuscript" do contrato (a Clicksign não aceita
   * duas do mesmo tipo para a mesma pessoa), visto nos valores, memorial e projeto. Os outros: só a assinatura na
   * própria linha (contrato e termos). i e lista (o signatário na lista do envelope) ligam as linhas; sem eles, como antes. */
  function ehVendedorSig(s) { return s.origem === "vendedor" || s.origem === "representante"; }
  /* calibração 01/11 (sandbox) e revisão: quem divide o MESMO ponto (campo de ciência, valores, memorial, projeto) fica
   * lado a lado, 105 pt um do outro (imagem de 100 pt). Nada é "espremido" para dentro da página (nada de cortar em 0):
   *  - contrato e memorial ("direita"): a 1ª pessoa no ponto medido, as seguintes à direita até a margem (36 pt); sem
   *    espaço, novas fileiras 52 pt — subindo (a última fica no ponto) ou, se subir passaria do topo, descendo;
   *  - projeto ("esquerda"): à ESQUERDA na mesma altura (x−105, x−210…) até 36 pt da borda; depois fileiras ABAIXO.
   *    Nunca acima — em cima está o carimbo DEFERIMENTO da prefeitura.
   * Quem não cabe (passaria da margem de baixo) fica sem posição naquela página — assina pela Clicksign — e vai aviso.
   * Tamanho da página: o lido do PDF (rub.tamanhos, tamanhosPaginasPdf); sem ele, o padrão — contrato A4, memorial Carta
   * (o modelo é 612×792), projeto págs. 1–2 A1 deitado e as demais A2 deitado. */
  var PADRAO_PAGINA = { contrato: { W: 595, H: 842 }, memorial: { W: 612, H: 792 } };
  function paginaPadrao(tipo, p) {
    /* projeto assinado da unidade 22: págs. 1–2 A0 deitado (3370×2384), as demais A1 deitado (2384×1684) */
    if (tipo === "projeto") return Number(p.page) <= 2 ? { W: 3370, H: 2384 } : { W: 2384, H: 1684 };
    return PADRAO_PAGINA[tipo] || PADRAO_PAGINA.contrato;
  }
  function tamanhoDa(rub, tipo, p) {
    var l = rub && rub.tamanhos && rub.tamanhos[tipo], t = Array.isArray(l) ? l[Number(p.page) - 1] : null;
    return t && t.W > 0 && t.H > 0 ? t : paginaPadrao(tipo, p);
  }
  var MARGEM = 36, CAIXA_L = 100, CAIXA_A = 50, PASSO_X = 105, PASSO_Y = 52;
  /* p: { page, position }; k: a vez desta pessoa (0 = no ponto medido), n: quantas dividem; null = não cabe */
  function aoLado(p, k, n, pg, modo) {
    if (!p) return null;
    var cp = { page: p.page, position: p.position.slice() };
    if (!(n > 1) || !(k >= 0)) return cp;
    var x0 = p.position[0] * pg.W, y0 = p.position[1] * pg.H, x, y, fil;
    if (modo === "esquerda") {
      var porF = Math.max(1, 1 + Math.floor((x0 - MARGEM) / PASSO_X));
      fil = Math.floor(k / porF);
      x = x0 - PASSO_X * (k % porF); y = y0 + PASSO_Y * fil;
    } else {
      var porFileira = Math.max(1, 1 + Math.floor((pg.W - MARGEM - CAIXA_L - x0) / PASSO_X));
      var fileiras = Math.ceil(n / porFileira);
      fil = Math.floor(k / porFileira);
      x = x0 + PASSO_X * (k % porFileira);
      var sobe = y0 - PASSO_Y * (fileiras - 1) >= 0 && y0 >= 46;
      y = sobe ? y0 - PASSO_Y * (fileiras - 1 - fil) : y0 + PASSO_Y * fil;
    }
    if (y < 0 || x < 0 || x + CAIXA_L > pg.W || (fil > 0 && y + CAIXA_A > pg.H - MARGEM)) return null;
    return { page: p.page, position: [arred(x / pg.W), arred(y / pg.H)] };
  }
  /* Tamanho de cada página do PDF (bytes como texto latin-1), na ordem das páginas: [{ W, H }] (deitada com /Rotate 90/270
     troca W e H) ou null quando não dá para ler sem dúvida (objetos comprimidos, árvore quebrada). */
  function tamanhosPaginasPdf(bin) {
    var t = String(bin || ""), objs = {}, re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g, m;
    while ((m = re.exec(t))) objs[m[1]] = m[2];
    var raiz = null;
    for (var id in objs) { var c = /\/Type\s*\/Catalog[\s\S]*?\/Pages\s+(\d+)\s+0\s+R/.exec(objs[id]); if (c) { raiz = c[1]; break; } }
    if (!raiz || /\/ObjStm/.test(t)) return null;
    function caixa(corpo) {
      var mb = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(corpo);
      return mb ? { W: +mb[3] - +mb[1], H: +mb[4] - +mb[2] } : null;
    }
    function rot(corpo, herdada) { var r = /\/Rotate\s+(-?\d+)/.exec(corpo); return r ? Number(r[1]) : herdada; }
    var out = [], ok = true, vistos = {};
    (function andar(id, herdada, rotH) {
      if (!ok) return;
      var corpo = objs[id];
      if (corpo === undefined || vistos[id]) { ok = false; return; }
      vistos[id] = true;
      var cx = caixa(corpo) || herdada, r = rot(corpo, rotH);
      if (/\/Type\s*\/Pages\b/.test(corpo)) {
        var k = /\/Kids\s*\[([^\]]*)\]/.exec(corpo);
        if (!k) { ok = false; return; }
        k[1].replace(/(\d+)\s+0\s+R/g, function (_, f) { andar(f, cx, r); return ""; });
      } else if (/\/Type\s*\/Page(?![a-zA-Z])/.test(corpo)) {
        if (!cx || !(cx.W > 0) || !(cx.H > 0)) { ok = false; return; }
        var deitada = Math.abs(r || 0) % 180 === 90;
        out.push(deitada ? { W: cx.H, H: cx.W } : { W: cx.W, H: cx.H });
      } else ok = false;
    })(raiz, null, 0);
    return ok && out.length ? out : null;
  }
  /* 01/11 (revisão): o memorial tem a linha da VENDEDORA à esquerda (modelo: margem 540 + recuo 878 twips em página Carta
     = 0,116) e a dos compradores à direita (0,53, medida). O vendedor assina na dele; propriedade MEMORIAL_POSICAO.vendedor muda. */
  /* ---- vistos (initials) — regras do dono (01/11/2026) e calibração da unidade 22 ----
     Tinta do visto: de +9 a +27 pt abaixo do ponto, até 27 pt de largura a partir do x. Fila compacta: passo 32 pt (tinta +
     folga), fila de baixo a +22 pt; nunca para cima. Campo de ciência: a partir do começo dos traços, até a margem direita;
     4.2.1: na coluna cinza (até 110 pt do começo). Projeto: dentro do quadro DEFERIMENTO — mesmo tamanho em A0 e A1:
     de (L−496, A−241) a (L−28, A−29) pt —, do ponto medido para a ESQUERDA, depois a fila de baixo; ponto fora do quadro
     é trazido para dentro. Quem não cabe fica sem posição (assina pela Clicksign) e vai aviso. */
  var VISTO_PASSO = 32, VISTO_L = 27, VISTO_FILA = 22, VISTO_TOPO = 9, VISTO_PE = 27, COLUNA_VALORES = 110;
  function vistoEmFila(p, k, n, pg, tipo) {
    if (!p) return null;
    var x0 = p.position[0] * pg.W, y0 = p.position[1] * pg.H;
    var limite = tipo === "valores" ? x0 + COLUNA_VALORES : pg.W - MARGEM;
    var porFila = Math.max(1, 1 + Math.floor((limite - x0 - VISTO_L) / VISTO_PASSO)), kk = k > 0 ? k : 0;
    var x = x0 + VISTO_PASSO * (kk % porFila), y = y0 + VISTO_FILA * Math.floor(kk / porFila);
    if (y + VISTO_PE > pg.H - MARGEM) return null;
    return { page: p.page, position: [arred(x / pg.W), arred(y / pg.H)] };
  }
  function vistoNaCaixa(p, k, n, pg) {
    if (!p) return null;
    var bx0 = pg.W - 496 + 4, bx1 = pg.W - 28 - 4, by0 = pg.H - 241 + 2, by1 = pg.H - 29 - 2;
    var xs = Math.max(bx0, Math.min(bx1 - VISTO_L, p.position[0] * pg.W));
    /* sem espaço para todos à esquerda (ponto perto da borda do quadro): o começo anda para a direita, dentro do quadro */
    if (n > 1 && xs - VISTO_PASSO * (n - 1) < bx0) xs = Math.min(bx1 - VISTO_L, bx0 + VISTO_PASSO * (n - 1));
    var ys = Math.max(by0 - VISTO_TOPO, Math.min(by1 - VISTO_PE, p.position[1] * pg.H));
    var porFila = Math.max(1, 1 + Math.floor((xs - bx0) / VISTO_PASSO)), kk = k > 0 ? k : 0;
    var x = xs - VISTO_PASSO * (kk % porFila), y = ys + VISTO_FILA * Math.floor(kk / porFila);
    if (y + VISTO_PE > by1) return null;
    return { page: p.page, position: [arred(x / pg.W), arred(y / pg.H)] };
  }
  var MEMORIAL_VENDEDOR_X = 0.116;
  /* posição do vendedor no memorial: a da Propriedade (MEMORIAL_POSICAO.vendedor = [x, y]) ou x 0,116 na altura dos compradores */
  function posicaoMemorialVendedor(mem, cfg) {
    if (!mem) return null;
    var v = cfg && typeof cfg === "object" && Array.isArray(cfg.vendedor) ? posicaoValida({ page: Number(mem.page), position: cfg.vendedor }) : null;
    return v || { page: mem.page, position: [MEMORIAL_VENDEDOR_X, mem.position[1]] };
  }
  function requisitosRubrica(s, docs, rub, i, lista, avisos) {
    if (!rub) return [];
    var comLinhas = Array.isArray(lista) && typeof i === "number", l = [];
    /* quem divide os pontos: campos e valores — os compradores (rubrica, cônjuge incluído); memorial — os compradores (o
       vendedor tem a linha dele); projeto — compradores e vendedor */
    var grupoC = comLinhas ? lista.filter(function (x) { return x.rubrica; }) : [s];
    var grupoD = comLinhas ? grupoC.concat(lista.filter(ehVendedorSig)) : [s];
    var kC = grupoC.indexOf(s), nC = grupoC.length, kD = grupoD.indexOf(s), nD = grupoD.length;
    function avisar(doc, p) { if (Array.isArray(avisos)) avisos.push(s.papel + ": sem lugar para a assinatura posicionada no " + doc + ", pág. " + p.page); }
    function posicoes(lista0, k, n, tipo, modo) {
      var out = [];
      (lista0 || []).forEach(function (p) {
        var q = aoLado(p, k, n, tamanhoDa(rub, tipo, p), modo);
        if (q) out.push(q); else avisar(tipo, p);
      });
      return out;
    }
    (docs || []).forEach(function (d) {
      if (d.tipo === DOC.CONTRATO) {
        /* dono 01/11/2026: assinatura (manuscrita) só na linha da própria pessoa; no meio do texto — campos de ciência e
           o 4.2.1 — só VISTOS dos compradores, numa fila compacta; um requisito de visto por pessoa com todas as posições */
        var lin = comLinhas && rub.linhas && rub.linhas.length ? atribuirLinhas(lista, rub.linhas, DOC.CONTRATO)[i] : [];
        if (lin.length) l.push({ docId: d.id, kind: "manuscript", positions: lin });
        var vis = [];
        if (s.rubrica) {
          (rub.campos || []).forEach(function (p) { var q = vistoEmFila(p, kC, nC, tamanhoDa(rub, "contrato", p), "campo"); if (q) vis.push(q); else avisar("contrato", p); });
          if (rub.valores) { var q = vistoEmFila(rub.valores, kC, nC, tamanhoDa(rub, "contrato", rub.valores), "valores"); if (q) vis.push(q); else avisar("contrato", rub.valores); }
        }
        if (vis.length) l.push({ docId: d.id, kind: "initials", positions: vis });
      } else if (d.tipo === DOC.TERMO) {
        var lt = comLinhas && rub.termos && d.nome && rub.termos[d.nome] ? atribuirLinhas(lista, rub.termos[d.nome], DOC.TERMO)[i] : [];
        if (lt.length) l.push({ docId: d.id, kind: "manuscript", positions: lt });
      } else if (d.tipo === DOC.MEMORIAL && Array.isArray(rub.memorialLinhas) && (s.rubrica || ehVendedorSig(s))) {
        /* dono 01/11/2026: memorial migrado — cada pessoa na PRÓPRIA linha, lida no PDF (sem linhas lidas: sem posição) */
        var lmem = comLinhas && rub.memorialLinhas.length ? atribuirLinhas(lista, rub.memorialLinhas, DOC.MEMORIAL)[i] : [];
        if (lmem.length) l.push({ docId: d.id, kind: "manuscript", positions: lmem });
      } else if (d.tipo === DOC.MEMORIAL && rub.memorial && (s.rubrica || ehVendedorSig(s))) {
        var pm = ehVendedorSig(s)
          ? [rub.memorialVendedor ? { page: rub.memorialVendedor.page, position: rub.memorialVendedor.position.slice() }
                                  : { page: rub.memorial.page, position: [MEMORIAL_VENDEDOR_X, rub.memorial.position[1]] }]
          : posicoes([rub.memorial], kC, nC, "memorial");
        if (pm.length) l.push({ docId: d.id, kind: "manuscript", positions: pm });
      } else if (d.tipo === DOC.PROJETO && (s.rubrica || ehVendedorSig(s)) && rub.projeto && rub.projeto.length) {
        var pp = [];
        rub.projeto.forEach(function (p) { var q = vistoNaCaixa(p, kD, nD, tamanhoDa(rub, "projeto", p)); if (q) pp.push(q); else avisar("projeto", p); });
        if (pp.length) l.push({ docId: d.id, kind: "initials", positions: pp });
      }
    });
    return l;
  }

  var api = {
    PAPEIS: PAPEIS, SITUACOES: SITUACOES, montarConfig: montarConfig, conferirConfig: conferirConfig, signatarios: signatarios,
    faltasAssinatura: faltasAssinatura, faltasDeNomeEEmail: faltasDeNomeEEmail, linksCorrigirEmail: linksCorrigirEmail, nomeEnvelope: nomeEnvelope, nomeArquivo: nomeArquivo, nomePadrao: nomePadrao, tituloDocumento: tituloDocumento, listaAssinados: listaAssinados,
    corpoEnvelope: corpoEnvelope, corpoDocumento: corpoDocumento, corpoSignatario: corpoSignatario,
    corpoQualificacao: corpoQualificacao, corpoAutenticacao: corpoAutenticacao, autenticacoes: autenticacoes, AUTH_SELFIE: AUTH_SELFIE, corpoAtivar: corpoAtivar, corpoCancelarDocumento: corpoCancelarDocumento, statusEfetivo: statusEfetivo,
    corpoNotificacao: corpoNotificacao, interpretar: interpretar, situacao: situacao, assinaram: assinaram,
    podeEnviar: podeEnviar, linkAssinado: linkAssinado, mascararEmails: mascararEmails, FINAIS: FINAIS,
    situacaoDosSignatarios: situacaoDosSignatarios, nomeMascarado: nomeMascarado,
    minutosParaReenviar: minutosParaReenviar, REENVIO_MIN: REENVIO_MIN,
    opcoesTestemunhas: opcoesTestemunhas, escolhidas: escolhidas, testemunhasParaTela: testemunhasParaTela,
    sigCompradores: sigCompradores, sigFiadores: sigFiadores, pessoasDoBloco: pessoasDoBloco, blocoAssinaturas: blocoAssinaturas, testemunhasDaVenda: testemunhas, corpoRubrica: corpoRubrica, DOC: DOC, tipoDoDocumento: tipoDoDocumento,
    nomeDocumentoAdicional: nomeDocumentoAdicional, documentosDoSignatario: documentosDoSignatario, requisitosRubrica: requisitosRubrica, atribuirLinhas: atribuirLinhas,
    validarRubricas: validarRubricas, ajusteRubricas: ajusteRubricas, AJUSTE_PADRAO: AJUSTE_PADRAO, POSICOES_PROJETO: POSICOES_PROJETO,
    posicoesProjeto: posicoesProjeto, posicaoMemorial: posicaoMemorial, contarPaginasPdf: contarPaginasPdf, tamanhosPaginasPdf: tamanhosPaginasPdf, posicaoMemorialVendedor: posicaoMemorialVendedor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
