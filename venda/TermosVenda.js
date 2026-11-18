/* TermosVenda — regras puras da TROCA DE FIADORES e dos TERMOS DE CONFISSÃO em envelope próprio (18/11/2026).
 * Origem: unidade 40 do condomínio — a fiadora desistiu com o envelope em andamento e a troca foi feita à mão
 * (temp.gs de 18/11, fora do repositório). Especificação: docs/superpowers/specs/2026-11-18-troca-de-fiadores-design.md.
 * Decisões do dono (18/11/2026):
 *  - a troca vale a qualquer momento, também com o contrato ainda em assinatura (dois envelopes abertos);
 *  - a venda só conta como ASSINADA quando o contrato E os termos estão assinados por todos;
 *  - o envelope dos termos fica nas colunas ASSINATURA TERMOS - ENVELOPE ID / SITUAÇÃO (texto);
 *  - travas de data do sinal não valem ao refazer os termos (o contrato já assinado manda);
 *  - o que já foi assinado fica travado e visível (Propriedade ASS_HIST_<página>, sem e-mail nem CPF).
 * Arquivo do projeto PORTAL-VENDA (cola como TermosVenda.gs) e testado no node (venda/testes/termos-venda.test.mjs).
 * Sem rede, sem Notion, sem Drive. Repositório público: nenhum dado real. */
var TermosVenda = (function () {
  "use strict";

  /* colunas novas da BANCO DE DADOS VENDAS CONDOMÍNIO (texto) — só existem depois de uma troca */
  var COL = { ENVELOPE: "ASSINATURA TERMOS - ENVELOPE ID", SITUACAO: "ASSINATURA TERMOS - SITUAÇÃO" };
  var TIPOS = {};
  TIPOS[COL.ENVELOPE] = "rich_text";
  TIPOS[COL.SITUACAO] = "rich_text";

  function CS() { return typeof ClicksignVenda !== "undefined" ? ClicksignVenda : require("./ClicksignVenda.js"); }
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function so(v) { return txt(v).replace(/\D/g, ""); }
  function nomeDe(d) { return txt(d && d.attributes && d.attributes.filename); }
  function statusDe(d) { return txt(d && d.attributes && d.attributes.status); }
  function cancelado(d) { return statusDe(d) === "canceled"; }
  /* documento fechado: o status dele; resposta sem status (Clicksign antiga) segue o do envelope */
  function fechado(d, envStatus) { var s = statusDe(d); return s ? s === "closed" : txt(envStatus) === "closed"; }
  function termoFn(ehTermo) { return typeof ehTermo === "function" ? ehTermo : function () { return false; }; }
  function eventosDe(env, docs) {
    var ev = (env && env.eventos) || {}, out = [];
    (docs || []).forEach(function (d) { out = out.concat(ev[txt(d && d.id)] || []); });
    return out;
  }
  /* situação de UM envelope, pela mesma tabela de hoje (ClicksignVenda.situacao + statusEfetivo) */
  function situacaoDoEnvelope(env) {
    if (!env) return "";
    var docs = env.docs || [];
    return CS().situacao(CS().statusEfetivo(txt(env.status), docs), eventosDe(env, docs));
  }

  /* 18/11/2026 (dono): "a venda só conta como ASSINADA quando contrato e termos estiverem assinados por todos".
   * contrato / termos: { status (do envelope), docs: [documentos da Clicksign], eventos: { docId: [eventos] } };
   * termos = null quando não houve troca. ehTermo(filename) vem do ConfissaoVenda (prefixo do termo).
   *  - documentos do contrato (contrato, memorial, projeto) = os não cancelados do envelope do contrato;
   *  - termos = os não cancelados do envelope de termos, se houver; senão os do envelope do contrato;
   *  - ASSINADO só com todos esses fechados; RECUSADO/EXPIRADO/CANCELADO do envelope do contrato seguem como hoje;
   *    enquanto faltar algo = ENVIADO (contratoAssinado: true quando só faltam os termos);
   *  - termos esperados = o envelope do contrato teve termo (mesmo cancelado) ou existe envelope de termos — termo
   *    cancelado sem substituto não conta como "assinado".
   * Devolve { situacao, contratoAssinado, termos (situação do envelope de termos, "" sem ele) }. */
  function situacaoCombinada(contrato, termos, ehTermo) {
    var S = CS().SITUACOES, eh = termoFn(ehTermo);
    contrato = contrato || { status: "", docs: [] };
    function ehT(d) { return !!eh(nomeDe(d)); }
    var todos = contrato.docs || [];
    var docsContrato = todos.filter(function (d) { return !ehT(d) && !cancelado(d); });
    var termosNoContrato = todos.filter(ehT);
    var comEnvTermos = !!termos;
    var docsTermos = comEnvTermos ? (termos.docs || []).filter(function (d) { return ehT(d) && !cancelado(d); })
                                  : termosNoContrato.filter(function (d) { return !cancelado(d); });
    var esperados = comEnvTermos || termosNoContrato.length > 0;
    var sitTermos = comEnvTermos ? situacaoDoEnvelope(termos) : "";
    var contratoFechado = docsContrato.length > 0 && docsContrato.every(function (d) { return fechado(d, contrato.status); });
    if (!contratoFechado) {
      /* como hoje; com envelope de termos, os termos antigos (cancelados) do envelope do contrato não contam */
      var base = comEnvTermos ? todos.filter(function (d) { return !ehT(d); }) : todos;
      var sit = CS().situacao(CS().statusEfetivo(txt(contrato.status), base), eventosDe(contrato, base));
      return { situacao: sit, contratoAssinado: false, termos: sitTermos };
    }
    var termosOk = !esperados || (docsTermos.length > 0 && docsTermos.every(function (d) { return fechado(d, comEnvTermos ? termos.status : contrato.status); }));
    if (termosOk) return { situacao: S.ASSINADO, contratoAssinado: false, termos: sitTermos };
    return { situacao: S.ENVIADO, contratoAssinado: true, termos: sitTermos };
  }

  /* Colheita POR DOCUMENTO (18/11/2026): contrato fechado → CONTRATO ASSINADO, mesmo com o envelope em andamento; termo
   * fechado → a coluna ASSINADA dele; cancelado nunca. O contrato é achado pelo tipo (ClicksignVenda.tipoDoDocumento),
   * nunca pela posição na lista. Memorial e projeto não têm coluna (vão no ZIP). → [{ doc, tipo }] */
  function paraColher(docs, ehTermo, envStatus) {
    var eh = termoFn(ehTermo), D = CS().DOC;
    return (docs || []).filter(function (d) { return d && !cancelado(d) && fechado(d, envStatus); })
      .map(function (d) { return { doc: d, tipo: CS().tipoDoDocumento(nomeDe(d), !!eh(nomeDe(d))) }; })
      .filter(function (x) { return x.tipo === D.CONTRATO || x.tipo === D.TERMO; });
  }

  /* 18/11/2026 (dono): ao refazer os termos de um contrato já gerado, "o contrato já gerado manda" — nenhuma trava de
   * DATA contra hoje ou contra a assinatura vale (do fluxo alterado no portal e do fluxo padrão da proposta):
   *   "sinal vence em …, antes de hoje" (07/11), "o sinal é ato + 30 + 60 + 90 dias, sem pular prazo" (14/11),
   *   "a data de assinatura (…) já passou", "<pré-chaves|balão|pós-chaves> vence em …: tem de vencer depois …" (livre) e
   *   "… vence em … — tem de vencer depois …" (padrão).
   * Continua barrando o que não é data contra hoje: soma que não fecha, quantidade de parcelas, valores, o limite de
   * 30/11/2028 (e outubro/2028 das pré-chaves), fiadores, e-mails. → { faltas, ignoradas } */
  var RE_DATAS = new RegExp("^Fluxo de pagamento(?: \\(alterado\\))?: (?:" +
    "(?:Linha \\d+: )?[^:]{1,40}? vence em \\d{2}/\\d{2}/\\d{4}(?:, antes de hoje\\b|: tem de vencer depois\\b| — tem de vencer depois\\b|: o sinal é ato \\+ 30 \\+ 60 \\+ 90 dias, sem pular prazo\\b)" +
    "|a data de assinatura \\(\\d{2}/\\d{2}/\\d{4}\\) já passou\\b)");
  function filtrarTravasData(faltas) {
    var out = [], ign = [];
    (faltas || []).forEach(function (f) { (RE_DATAS.test(txt(f)) ? ign : out).push(f); });
    return { faltas: out, ignoradas: ign };
  }

  /* Quem assina os termos novos: a lista do envio (ClicksignVenda.signatarios com os fiadores ligados) sem o corretor —
   * compradores (e cônjuges), vendedora, testemunhas, fiadores (e cônjuges). */
  function signatariosTermos(lista) {
    return (lista || []).filter(function (s) { return s && s.origem !== "corretor"; });
  }
  /* para a tela e o log: só papel e nome mascarado */
  function pessoas(lista) {
    return (lista || []).map(function (s) { return { papel: txt(s.papel), nome: CS().nomeMascarado(s.nome) }; });
  }

  /* Fiadores trocados: o de hoje (d.condominio.fiadores) comparado com quem assina como "Fiador n" no envelope dos termos
   * de agora (assinantes: [{ papel, nome, cpf }] — da Clicksign, só para comparar; null = não deu para saber → todos).
   * Fiador vazio hoje não entra. → [1] | [2] | [1, 2] | [] */
  function fiadoresAlterados(atuais, assinantes) {
    var out = [];
    (atuais || []).slice(0, 2).forEach(function (fi, i) {
      if (!fi || !txt(fi.nome)) return;
      var n = i + 1;
      if (!Array.isArray(assinantes)) { out.push(n); return; }
      var a = assinantes.filter(function (x) { return x && txt(x.papel) === "Fiador " + n; })[0];
      if (!a) { out.push(n); return; }
      var mesmo = so(fi.cpf) && so(a.cpf) ? so(fi.cpf) === so(a.cpf) : txt(fi.nome).toUpperCase() === txt(a.nome).toUpperCase();
      if (!mesmo) out.push(n);
    });
    return out;
  }

  /* Prévia da troca (só regras): x = { termos: ["PRE","POS"], faltas: [...], alterados: [n], docs: { n: arquivos em
   * DOC. FIADOR n }, conferencia: { carimbo, linhas, confirmados } | null (CONFDOC_<página>), carimbo (dos dados de agora),
   * anexosMudaram }. Decisão do dono (18/11): fiador novo só com documento anexado e a conferência por IA de nome e CPF
   * sem divergência nele. Divergência não se aceita com "Conferi"; ilegível conferido à mão vale.
   * → { ok, erro?, problemas: [texto] } (erro = o primeiro motivo, em código) */
  var SITUACAO_RUIM = { diverge: 1, ilegivel: 1, falta: 1 };
  function conferirTroca(x) {
    x = x || {};
    var p = [], erro = "";
    function falha(cod, t) { if (!erro) erro = cod; p.push(t); }
    if (!(x.termos || []).length) falha("SEM_TERMOS", "Esta venda não tem termos de confissão (só existem com parcelas depois das chaves).");
    (x.faltas || []).forEach(function (f) { falha("FALTAM_DADOS", txt(f)); });
    var alt = x.alterados || [];
    if ((x.termos || []).length && !alt.length) falha("NADA_MUDOU", "Nenhum fiador mudou — corrija o fiador no bloco Fiadores e salve antes de gerar os termos novos.");
    var o = x.conferencia, atual = !!(o && o.carimbo && o.carimbo === x.carimbo && !x.anexosMudaram);
    alt.forEach(function (n) {
      if (!(Number((x.docs || {})[n]) > 0)) { falha("FIADOR_SEM_DOCUMENTO", "Fiador " + n + ": anexe o documento (DOC. FIADOR " + n + ")."); return; }
      if (!o) { falha("CONFERENCIA_FALTANDO", "Fiador " + n + ": faça a conferência dos documentos (IA) depois de anexar."); return; }
      if (!atual) { falha("CONFERENCIA_DESATUALIZADA", "Fiador " + n + ": a conferência dos documentos é de antes da troca — confira de novo."); return; }
      var linhas = (o.linhas || []).map(function (l, i) { return { l: l, i: i }; }).filter(function (y) { return y.l && y.l.item === "f" + n + "-id"; });
      if (!linhas.length) { falha("CONFERENCIA_FALTANDO", "Fiador " + n + ": a conferência não leu o documento dele — confira de novo."); return; }
      linhas.forEach(function (y) {
        var conf = !!(o.confirmados && o.confirmados[y.i]);
        if (y.l.situacao === "diverge") falha("CONFERENCIA_DIVERGENTE", "Fiador " + n + ": " + txt(y.l.rotulo || y.l.campo) + " do documento não confere com o cadastro.");
        else if (SITUACAO_RUIM[y.l.situacao] && !conf) falha("CONFERENCIA_PENDENTE", "Fiador " + n + ": " + txt(y.l.rotulo || y.l.campo) + " " + (y.l.situacao === "falta" ? "falta no cadastro" : "não deu para ler") + " — confira.");
      });
    });
    return erro ? { ok: false, erro: erro, problemas: p } : { ok: true, problemas: [] };
  }

  /* ---- registro do que foi assinado (Propriedade ASS_HIST_<página>) ----
   * { v: 1, envelopes: [{ id, papel: "contrato" | "termos", docs: [{ id, tipo, nome, status, assinaram: [{ papel, nome, data }] }] }] }
   * Sem e-mail nem CPF: o papel, o nome mascarado ("Maria S.") e a data. Gravado quando um documento fecha ou na troca;
   * a tela lê daqui (bloco "Já assinado") sem chamar a Clicksign. No máximo 4 envelopes (os mais novos). */
  var HIST_MAX_ENV = 4;
  function lerHist(json) {
    try { var h = JSON.parse(json || "null"); if (h && Array.isArray(h.envelopes)) return h; } catch (e) { /* vazio */ }
    return { v: 1, envelopes: [] };
  }
  /* quem assinou cada documento: eventos "sign" do documento, casados com o signatário pelo e-mail (como ClicksignVenda.assinaram) */
  function assinaturasDoDoc(eventos, signers, papeis) {
    var porEmail = {};
    (signers || []).forEach(function (s) { var e = txt(s && s.attributes && s.attributes.email).toLowerCase(); if (e) porEmail[e] = s; });
    var out = [], vistos = {};
    (eventos || []).forEach(function (ev) {
      var a = (ev && ev.attributes) || {};
      if (a.name !== "sign" || !a.data || !a.data.signer) return;
      var s = porEmail[txt(a.data.signer.email).toLowerCase()];
      var chave = s ? txt(s.id) : txt(a.data.signer.email).toLowerCase();
      if (!chave || vistos[chave]) return;
      vistos[chave] = true;
      out.push({ papel: txt((papeis || {})[s && s.id]) || "Signatário",
                 nome: CS().nomeMascarado((s && s.attributes && s.attributes.name) || a.data.signer.name || ""),
                 data: txt(a.created || a.created_at).slice(0, 16) });
    });
    return out;
  }
  /* hist + leitura de um envelope → hist novo (não muda o recebido). O que já estava registrado de um documento
     (papéis de quem assinou) não se perde quando a Propriedade de papéis do envelope já foi apagada. */
  function registrar(hist, envId, papelEnv, docs, eventosPorDoc, signers, papeis, ehTermo) {
    var h = JSON.parse(JSON.stringify(hist && Array.isArray(hist.envelopes) ? hist : { v: 1, envelopes: [] }));
    var id = txt(envId);
    if (!id) return h;
    var eh = termoFn(ehTermo), velho = null;
    h.envelopes = h.envelopes.filter(function (e) { if (e.id === id) { velho = e; return false; } return true; });
    var antes = {};
    ((velho && velho.docs) || []).forEach(function (d) { antes[d.id] = d; });
    var novo = { id: id, papel: papelEnv === "termos" ? "termos" : "contrato", docs: (docs || []).map(function (d) {
      var did = txt(d && d.id), n = nomeDe(d), a = assinaturasDoDoc((eventosPorDoc || {})[did], signers, papeis), v = antes[did];
      if (v && Array.isArray(v.assinaram)) {
        var porNome = {};
        v.assinaram.forEach(function (x) { porNome[x.nome + "|" + x.data] = x.papel; });
        a.forEach(function (x) { if (x.papel === "Signatário" && porNome[x.nome + "|" + x.data]) x.papel = porNome[x.nome + "|" + x.data]; });
        if (a.length < v.assinaram.length) a = v.assinaram;   /* leitura parcial não apaga o que já se viu */
      }
      return { id: did, tipo: CS().tipoDoDocumento(n, !!eh(n)), nome: n.slice(0, 120), status: statusDe(d) || (v && v.status) || "", assinaram: a };
    }).filter(function (d) { return d.id; }) };
    novo.colhidos = ((velho && velho.colhidos) || []).slice();
    h.envelopes.push(novo);
    while (h.envelopes.length > HIST_MAX_ENV) h.envelopes.shift();
    h.v = 1;
    return h;
  }
  /* documento já colhido para a linha da venda (CONTRATO ASSINADO ou a coluna ASSINADA do termo): não colhe de novo */
  function marcarColhido(hist, envId, docId) {
    var h = JSON.parse(JSON.stringify(hist && Array.isArray(hist.envelopes) ? hist : { v: 1, envelopes: [] }));
    var e = h.envelopes.filter(function (x) { return x.id === txt(envId); })[0];
    if (!e) { e = { id: txt(envId), papel: "contrato", docs: [], colhidos: [] }; h.envelopes.push(e); }
    e.colhidos = e.colhidos || [];
    if (e.colhidos.indexOf(txt(docId)) < 0) e.colhidos.push(txt(docId));
    return h;
  }
  function colhidos(hist) {
    var o = {};
    ((hist && hist.envelopes) || []).forEach(function (e) { (e.colhidos || []).forEach(function (id) { o[id] = true; }); });
    return o;
  }
  /* bloco "Já assinado" da tela: os documentos fechados, o contrato primeiro → [{ envelope, docId, tipo, nome, assinaram }] */
  function jaAssinado(hist) {
    var ordem = { contrato: 0, termo: 1, memorial: 2, projeto: 3 }, out = [];
    ((hist && hist.envelopes) || []).forEach(function (e, ie) {
      (e.docs || []).forEach(function (d, id) {
        if (d.status === "closed") out.push({ envelope: e.id, docId: d.id, tipo: d.tipo, nome: d.nome, assinaram: (d.assinaram || []).slice(), k: ie * 100 + id });
      });
    });
    return out.sort(function (a, b) { return ((a.tipo in ordem ? ordem[a.tipo] : 9) - (b.tipo in ordem ? ordem[b.tipo] : 9)) || (a.k - b.k); })
      .map(function (x) { return { envelope: x.envelope, docId: x.docId, tipo: x.tipo, nome: x.nome, assinaram: x.assinaram }; });
  }

  var api = { COL: COL, TIPOS: TIPOS, situacaoCombinada: situacaoCombinada, situacaoDoEnvelope: situacaoDoEnvelope, paraColher: paraColher,
              filtrarTravasData: filtrarTravasData, filtrarTravasSinal: filtrarTravasData, RE_DATAS: RE_DATAS, signatariosTermos: signatariosTermos, pessoas: pessoas,
              fiadoresAlterados: fiadoresAlterados, conferirTroca: conferirTroca,
              lerHist: lerHist, registrar: registrar, marcarColhido: marcarColhido, colhidos: colhidos, jaAssinado: jaAssinado, assinaturasDoDoc: assinaturasDoDoc, HIST_MAX_ENV: HIST_MAX_ENV };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
