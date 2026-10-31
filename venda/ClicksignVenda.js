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
    return { rubricasAjuste: ajusteRubricas(ajuste), memorialPosicao: memPos, projetoPosicoes: projPos,
             semRubricas: semRub === "SIM" || semRub === "TRUE" || semRub === "1", testemunhasSPE: spe, testemunhasPF: pf, representante: rep, testemunhasOpcoes: opc,
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
  /* o que a tela recebe: só id e nome */
  function testemunhasParaTela(config) {
    var e = escolhidas(config);
    return { opcoes: opcoesTestemunhas(config).map(function (o) { return { id: o.id, nome: o.nome }; }),
             escolhidas: e ? [e[0].id, e[1].id] : [] };
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
    /* 31/10/2026 (dono): comprador casado → o cônjuge assina logo depois dele (contrato e termos; sem rubrica, sem
       memorial). Se o cônjuge já é o comprador 2 (mesmo CPF ou nome), não assina duas vezes. */
    var cj = dados.condominio && dados.condominio.conjugeComprador, c2 = dados.comprador2;
    if (cj && !(c2 && ((soDigitos(cj.cpf) && soDigitos(cj.cpf) === soDigitos(c2.cpf)) || txt(cj.nome).toUpperCase() === txt(c2.nome).toUpperCase())))
      l.push(sig("Cônjuge do comprador 1", PAPEIS.COMPRADOR, cj, "conjugeComprador1"));
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
  function corpoAutenticacao(docId, signerId) {
    return { data: { type: "requirements", attributes: { action: "provide_evidence", auth: "email" }, relationships: relacoes(docId, signerId) } };
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
  /* docs: [{ id, tipo }] → ids que este signatário assina. Fiador: só os termos; comprador (rubrica): todos;
   * os demais: o contrato e os termos (memorial e projeto são só do comprador). */
  function documentosDoSignatario(s, docs) {
    return (docs || []).filter(function (d) {
      if (s.soTermos) return d.tipo === DOC.TERMO;
      if (s.rubrica) return true;
      return d.tipo === DOC.CONTRATO || d.tipo === DOC.TERMO;
    }).map(function (d) { return d.id; });
  }

  /* Ajuste somado às posições achadas no contrato (proporção da página). A Clicksign não documenta se [x, y]
   * é o canto de cima à esquerda ou o centro da caixa: o padrão supõe o canto e sobe a assinatura para ficar
   * em cima da linha "ASSINATURA: ____". Conferir no sandbox e, se precisar, corrigir pela Propriedade
   * RUBRICAS_AJUSTE, ex.: {"campo":{"dx":0,"dy":-0.015},"valores":{"dx":0,"dy":0}}. */
  var AJUSTE_PADRAO = { campo: { dx: 0, dy: -0.01 }, valores: { dx: 0, dy: -0.004 } };
  function numOu(v, padrao) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= 0.5 ? v : padrao; }
  function ajusteRubricas(j) {
    j = j && typeof j === "object" ? j : {};
    var r = {};
    ["campo", "valores"].forEach(function (k) {
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
  function validarRubricas(r, nomeGerado) {
    if (!r || typeof r !== "object") return { ok: false, erro: "RUBRICAS_FALTANDO" };
    if (txt(r.nome) !== txt(nomeGerado)) return { ok: false, erro: "RUBRICAS_DE_OUTRO_PDF" };
    var campos = Array.isArray(r.campos) ? r.campos : [];
    if (!campos.length || campos.length > MAX_CAMPOS) return { ok: false, erro: "RUBRICAS_INVALIDAS" };
    var ok = campos.map(posicaoValida);
    if (ok.some(function (p) { return !p; })) return { ok: false, erro: "RUBRICAS_INVALIDAS" };
    var val = null;
    if (r.valores) { val = posicaoValida(r.valores); if (!val) return { ok: false, erro: "RUBRICAS_INVALIDAS" }; }
    return { ok: true, campos: ok, valores: val };
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

  /* Requisitos de rubrica de um signatário: [{ docId, kind, positions }]. Só quem tem rubrica (comprador).
   * docs: [{ id, tipo }]; rub: { campos, valores } (já validado), memorial: pos | null, projeto: [pos]. */
  function requisitosRubrica(s, docs, rub) {
    if (!s.rubrica || !rub) return [];
    var l = [];
    (docs || []).forEach(function (d) {
      if (d.tipo === DOC.CONTRATO) {
        if (rub.campos && rub.campos.length) l.push({ docId: d.id, kind: "manuscript", positions: rub.campos });
        if (rub.valores) l.push({ docId: d.id, kind: "initials", positions: [rub.valores] });
      } else if (d.tipo === DOC.MEMORIAL && rub.memorial) {
        l.push({ docId: d.id, kind: "manuscript", positions: [rub.memorial] });
      } else if (d.tipo === DOC.PROJETO && rub.projeto && rub.projeto.length) {
        l.push({ docId: d.id, kind: "initials", positions: rub.projeto });
      }
    });
    return l;
  }

  var api = {
    PAPEIS: PAPEIS, SITUACOES: SITUACOES, montarConfig: montarConfig, conferirConfig: conferirConfig, signatarios: signatarios,
    faltasAssinatura: faltasAssinatura, linksCorrigirEmail: linksCorrigirEmail, nomeEnvelope: nomeEnvelope, nomeArquivo: nomeArquivo, nomePadrao: nomePadrao,
    corpoEnvelope: corpoEnvelope, corpoDocumento: corpoDocumento, corpoSignatario: corpoSignatario,
    corpoQualificacao: corpoQualificacao, corpoAutenticacao: corpoAutenticacao, corpoAtivar: corpoAtivar, corpoCancelarDocumento: corpoCancelarDocumento, statusEfetivo: statusEfetivo,
    corpoNotificacao: corpoNotificacao, interpretar: interpretar, situacao: situacao, assinaram: assinaram,
    podeEnviar: podeEnviar, linkAssinado: linkAssinado, mascararEmails: mascararEmails, FINAIS: FINAIS,
    situacaoDosSignatarios: situacaoDosSignatarios, nomeMascarado: nomeMascarado,
    minutosParaReenviar: minutosParaReenviar, REENVIO_MIN: REENVIO_MIN,
    opcoesTestemunhas: opcoesTestemunhas, escolhidas: escolhidas, testemunhasParaTela: testemunhasParaTela,
    sigCompradores: sigCompradores, sigFiadores: sigFiadores, corpoRubrica: corpoRubrica, DOC: DOC, tipoDoDocumento: tipoDoDocumento,
    nomeDocumentoAdicional: nomeDocumentoAdicional, documentosDoSignatario: documentosDoSignatario, requisitosRubrica: requisitosRubrica,
    validarRubricas: validarRubricas, ajusteRubricas: ajusteRubricas, AJUSTE_PADRAO: AJUSTE_PADRAO, POSICOES_PROJETO: POSICOES_PROJETO,
    posicoesProjeto: posicoesProjeto, posicaoMemorial: posicaoMemorial, contarPaginasPdf: contarPaginasPdf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
