/* contrato-vendida.js — 31/10/2026 (dono): contrato do condomínio gerado e ENVIADO para assinatura (ou já
 * ASSINADO) = venda feita. Algumas vendas saíram sem o botão "Vendida" na proposta: a proposta ficou RESERVADA /
 * PAGOU PREFERÊNCIA (fora do "Vendidas" da aba Propostas) e a unidade fora do VENDIDA = SIM no mapa.
 *
 * Para cada linha do BANCO DE DADOS VENDAS CONDOMÍNIO com ASSINATURA - SITUAÇÃO = ENVIADO/ASSINADO:
 *   1) a proposta da linha (ID PROPOSTA; sem ele, unidade + CPF do proponente, ou o nome quando não há CPF) vira
 *      VENDIDA pela mesma ação do botão "Vendida" (simsPropostaStatus) — ela marca a unidade VENDIDA = SIM e só
 *      completa campos VAZIOS do banco de vendas (nunca sobrescreve);
 *   2) confere a unidade na base UNIDADES e, se ainda não estiver SIM, grava VENDIDA = SIM e STATUS INTERNO =
 *      VENDIDA (simsUnidadeUpdate, a mesma gravação da aba Simulações).
 * Só grava o que falta; uma vez por linha por sessão (de novo se deu erro). Só o Reserva dos Ipês tem propostas e
 * base UNIDADES. Usado pela Planilha Casas Condomínio (vendas.html) e pela aba Propostas (simulacoes.html).
 * Nada de dado pessoal no console além de número de unidade/proposta. */
(function () {
  "use strict";

  var BASE = "RESERVA DOS IPES";
  var feitas = {};
  var fila = Promise.resolve();

  function norm(t) {
    return String(t === null || t === undefined ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/\s+/g, " ").trim();
  }
  function semTraco(x) { return String(x || "").replace(/-/g, "").toLowerCase(); }
  function numUn(t) { var m = /\d+/.exec(String(t === null || t === undefined ? "" : t)); return m ? Number(m[0]) : null; }
  function soDig(t) { return String(t || "").replace(/\D/g, ""); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function val(l, nome) {
    var v = (l && l.v) || {};
    if (v[nome] !== undefined) return v[nome];
    var a = norm(nome), k = Object.keys(v).filter(function (x) { return norm(x) === a; })[0];
    return k === undefined ? null : v[k];
  }
  function unidadeDa(l, titulo) { return numUn(val(l, "UNIDADE") || (titulo ? val(l, titulo) : null)); }
  function elegivel(l, titulo) {
    var cond = norm(val(l, "CONDOMÍNIO")).replace(/^CONDOMINIO\s+(RESIDENCIAL\s+)?/, "");
    return cond.indexOf(BASE) >= 0 && unidadeDa(l, titulo) !== null;
  }
  function contratoEnviado(l) {
    var s = norm(val(l, "ASSINATURA - SITUAÇÃO"));
    return s === "ENVIADO" || s === "ASSINADO";
  }

  /* listas lidas uma vez por rodada */
  async function listas(cache, chamar) {
    var r;
    if (!cache.propostas) {
      r = null; try { r = await chamar({ action: "simsPropostas" }, 90000); } catch (e) {}
      cache.propostas = (r && Array.isArray(r.propostas)) ? r.propostas : null; cache.erroP = (r && r.erro) || "sem resposta";
    }
    if (!cache.unidades) {
      r = null; try { r = await chamar({ action: "simsUnidades" }, 60000); } catch (e) {}
      cache.unidades = (r && Array.isArray(r.unidades)) ? r.unidades : null; cache.erroU = (r && r.erro) || "sem resposta";
    }
  }
  function propostaDa(l, titulo, props) {
    var idp = semTraco(val(l, "ID PROPOSTA"));
    if (idp) { var p = props.filter(function (x) { return semTraco(x.id) === idp; })[0]; if (p) return p; }
    var n = unidadeDa(l, titulo), cpf = soDig(val(l, "CPF PROPONENTE")), nome = norm(val(l, "PROPONENTE"));
    var c = props.filter(function (p) {
      var st = norm(p.status);
      if (numUn(p.unidade) !== n || st === "NEGADA" || st === "DISTRATO") return false;
      return cpf ? soDig(p.cpf) === cpf : (!!nome && norm(p.cliente) === nome);
    });
    if (c.length === 1) return c[0];
    if (c.length) return null;
    /* sem CPF/nome que bata: a dona da unidade — a única proposta dela já VENDIDA ou que pagou a preferência */
    var dona = props.filter(function (p) {
      return numUn(p.unidade) === n && (norm(p.status) === "VENDIDA" || norm(p.statusInterno) === "PAGOU PREFERENCIA");
    });
    return dona.length === 1 ? dona[0] : null;
  }

  async function marcar(l, titulo, cache, o) {
    var n = unidadeDa(l, titulo), feito = [], erros = [];
    await listas(cache, o.chamar);
    /* 1) proposta */
    if (!cache.propostas) erros.push("não consegui ler as propostas (" + esc(cache.erroP) + ")");
    else {
      var p = propostaDa(l, titulo, cache.propostas);
      if (!p) erros.push("não achei a proposta desta venda — marque <b>Vendida</b> na aba Propostas");
      else if (norm(p.status) !== "VENDIDA") {
        var r = null;
        try { r = await o.chamar({ action: "simsPropostaStatus", pageId: p.id, status: "VENDIDA" }, 240000, true); } catch (e) {}
        if (r && r.ok) {
          p.status = "VENDIDA";
          feito.push("proposta " + esc(p.proposta || "") + " marcada como <b>VENDIDA</b>");
          (cache.unidades || []).forEach(function (u) { if (numUn(u.unidade) === n) u.vendidaCru = "SIM"; });   // o Vendida já marca a unidade
        } else erros.push("a proposta não foi marcada como vendida (" + esc((r && (r.mensagem || r.erro)) || "sem resposta") + ")");
      }
    }
    /* 2) unidade */
    if (!cache.unidades) erros.push("não consegui ler a base UNIDADES (" + esc(cache.erroU) + ")");
    else {
      var us = cache.unidades.filter(function (u) { return numUn(u.unidade) === n; });
      if (us.length !== 1) erros.push((us.length ? "há mais de uma" : "não achei a") + " unidade " + n + " na base UNIDADES");
      else if (norm(us[0].vendidaCru) !== "SIM") {
        var w = null;
        try { w = await o.chamar({ action: "simsUnidadeUpdate", pageId: us[0].id, campos: { "VENDIDA": "SIM", "STATUS INTERNO": "VENDIDA" } }, 60000, true); } catch (e) {}
        if (w && w.ok) { us[0].vendidaCru = "SIM"; feito.push("unidade " + esc(us[0].unidade || n) + " marcada como <b>VENDIDA = SIM</b>"); }
        else erros.push("a unidade " + n + " não foi marcada como vendida (" + esc((w && w.erro) || "sem resposta") + ")");
      }
    }
    if (erros.length) delete feitas[semTraco(l.id)];   // tenta de novo na próxima vez
    if (feito.length || erros.length) {
      try { console.log("[contrato enviado → vendida] unidade " + n + ": " + feito.concat(erros).join("; ").replace(/<[^>]+>/g, "")); } catch (e) {}
    }
    if (o.aviso) {
      if (erros.length) o.aviso(l.id, "err", "<b>Contrato enviado, mas:</b> " + erros.join("; ") + "." + (feito.length ? " Feito: " + feito.join("; ") + "." : ""));
      else if (feito.length) o.aviso(l.id, "ok", "<b>Contrato enviado:</b> " + feito.join("; ") + ". Mapa e propostas já atualizam.");
    }
    return feito.length;
  }

  /* linhas: [{id, v:{coluna:valor}}]; ids: quais rodar (null = todas as pendentes).
   * o = { chamar(payload, ms, prioritario), aviso(id, "ok"|"err", html)?, aoTerminar(qtdGravadas)? }
   * Em série: o Apps Script atende um pedido por vez. */
  function rodar(linhas, titulo, ids, o) {
    var alvo = (linhas || []).filter(function (l) {
      if (!l || !l.id || !elegivel(l, titulo)) return false;
      if (ids) return ids.some(function (i) { return semTraco(i) === semTraco(l.id); });
      return contratoEnviado(l);
    }).filter(function (l) { return !feitas[semTraco(l.id)]; });
    alvo.forEach(function (l) { feitas[semTraco(l.id)] = true; });
    if (!alvo.length) return fila;
    var cache = {};
    fila = fila.then(async function () {
      var total = 0;
      for (var i = 0; i < alvo.length; i++) { try { total += await marcar(alvo[i], titulo, cache, o); } catch (e) { delete feitas[semTraco(alvo[i].id)]; } }
      if (total) { try { if (typeof storeInvalidar === "function") storeInvalidar("sims_propostas", "sims_unidades"); } catch (e) {} }
      if (o.aoTerminar) { try { o.aoTerminar(total); } catch (e) {} }
    });
    return fila;
  }
  function pendentes(linhas, titulo) {
    return (linhas || []).filter(function (l) { return l && l.id && elegivel(l, titulo) && contratoEnviado(l) && !feitas[semTraco(l.id)]; })
      .map(function (l) { return l.id; });
  }

  window.ContratoVendida = { rodar: rodar, pendentes: pendentes, contratoEnviado: contratoEnviado };
})();
