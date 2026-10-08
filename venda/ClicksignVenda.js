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
  var PAPEIS = { COMPRADOR: "buyer", VENDEDOR: "seller", TESTEMUNHA: "witness", CORRETOR: "real_estate_broker" };
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
    var inc = txt(props.ASSINATURA_INCLUIR_CORRETOR).toUpperCase();
    return { testemunhasSPE: spe, testemunhasPF: pf, representante: rep,
             incluirCorretor: inc === "SIM" || inc === "TRUE" || inc === "1", invalidas: invalidas };
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
    return { problemas: problemas, avisos: avisos };
  }

  function ehPJ(dados) { return !!dados.vendedor && txt(dados.vendedor.tipo).toUpperCase() === "PJ"; }
  function nomeDoPar(dados) { return ehPJ(dados) ? "ASSINATURA_TESTEMUNHAS_SPE" : "ASSINATURA_TESTEMUNHAS_PF"; }
  function testemunhas(dados, config) { return par(ehPJ(dados) ? config.testemunhasSPE : config.testemunhasPF); }

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

  /* Lista ordenada de quem assina. Cada item: { papel (rótulo legível), role, nome, email, cpf, origem }. */
  function signatarios(dados, config) {
    var l = [];
    function add(papel, role, p, origem) {
      l.push({ papel: papel, role: role, nome: txt(p && p.nome), email: email(p && p.email), cpf: txt(p && p.cpf), origem: origem });
    }
    add("Comprador 1", PAPEIS.COMPRADOR, dados.comprador1, "comprador1");
    if (dados.comprador2) add("Comprador 2", PAPEIS.COMPRADOR, dados.comprador2, "comprador2");
    var v = dados.vendedor;
    if (v) {
      if (ehPJ(dados)) add("Vendedor (representante)", PAPEIS.VENDEDOR, representante(v, config), "representante");
      else add("Vendedor", PAPEIS.VENDEDOR, { nome: v.nome, email: v.email, cpf: v.cpfCnpj }, "vendedor");
    }
    var t = testemunhas(dados, config);
    if (t) { add("Testemunha 1", PAPEIS.TESTEMUNHA, t[0], "testemunha"); add("Testemunha 2", PAPEIS.TESTEMUNHA, t[1], "testemunha"); }
    if (config.incluirCorretor && dados.corretor)
      add("Corretor", PAPEIS.CORRETOR, { nome: dados.corretor.nome, email: dados.corretor.email, cpf: dados.corretor.cpfCnpj }, "corretor");
    return l;
  }

  var ONDE_EMAIL = {
    comprador1: "coluna COMPRADOR 1 - E-MAIL",
    comprador2: "coluna COMPRADOR 2 - E-MAIL",
    vendedor: "coluna E-MAIL em VENDEDORES – CONTRATO",
    corretor: "coluna E-MAIL em CORRETORES – CONTRATO",
    testemunha: ""
  };

  /* Faltas legíveis (sem dado pessoal: só papel e o que falta). */
  function faltasAssinatura(dados, config) {
    var faltas = [];
    config = config || montarConfig({});
    if (!dados.vendedor) faltas.push("Vendedor: cadastro em VENDEDORES – CONTRATO");
    if (!testemunhas(dados, config)) faltas.push("Testemunhas: Propriedade " + nomeDoPar(dados) + " não configurada (precisa de 2)");
    if (config.incluirCorretor && !dados.corretor) faltas.push("Corretor: cadastro em CORRETORES – CONTRATO");
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

  /* ---- corpos JSON:API (v3) ---- */
  function nomeEnvelope(endereco) {
    var e = txt(endereco).replace(/[\\\/]/g, "-");
    return e ? "Contrato - " + e : "Contrato de compra e venda";
  }
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
  function corpoAtivar(envelopeId) {
    return { data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } } };
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

  var api = {
    PAPEIS: PAPEIS, SITUACOES: SITUACOES, montarConfig: montarConfig, conferirConfig: conferirConfig, signatarios: signatarios,
    faltasAssinatura: faltasAssinatura, nomeEnvelope: nomeEnvelope, nomeArquivo: nomeArquivo,
    corpoEnvelope: corpoEnvelope, corpoDocumento: corpoDocumento, corpoSignatario: corpoSignatario,
    corpoQualificacao: corpoQualificacao, corpoAutenticacao: corpoAutenticacao, corpoAtivar: corpoAtivar,
    corpoNotificacao: corpoNotificacao, interpretar: interpretar, situacao: situacao, assinaram: assinaram,
    podeEnviar: podeEnviar, linkAssinado: linkAssinado, mascararEmails: mascararEmails, FINAIS: FINAIS,
    situacaoDosSignatarios: situacaoDosSignatarios, nomeMascarado: nomeMascarado,
    minutosParaReenviar: minutosParaReenviar, REENVIO_MIN: REENVIO_MIN
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
