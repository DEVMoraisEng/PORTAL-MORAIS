/* contrato-vendida.js — 31/10/2026 (dono): contrato do condomínio gerado e ENVIADO para assinatura (ou já
 * ASSINADO) = venda feita. Algumas vendas saíram sem o botão "Vendida" na proposta: a proposta ficou RESERVADA /
 * PAGOU PREFERÊNCIA (fora do "Vendidas" da aba Propostas).
 *
 * 04/11/2026 (dono) — MAPA: "a casa quando está no banco de dados de vendas vai constar como RESERVADA no mapa até
 * que todas as assinaturas estejam concluídas; só muda para vendida quando ETAPA = CONCLUÍDA".
 *   ETAPA Concluída é a mesma conta da coluna ETAPA da Planilha Casas Condomínio (vendas.html, condEtapas): com o
 *   contrato gerado, faltam só Assinaturas e Mais Controle — então Concluída = ASSINATURA - SITUAÇÃO = ASSINADO e
 *   MC - VENDA ID preenchido (concluida(), abaixo; venda/testes/contrato-vendida.test.mjs confere as duas juntas).
 *
 * Para cada linha do BANCO DE DADOS VENDAS CONDOMÍNIO (Reserva dos Ipês, fora DISTRATO):
 *   1) PROPOSTA (só com contrato ENVIADO/ASSINADO, ou quando a tela avisa que o contrato final foi gerado): a proposta
 *      da linha (ID PROPOSTA; sem ele, unidade + CPF do proponente, ou o nome quando não há CPF) vira VENDIDA pela
 *      mesma ação do botão "Vendida" (simsPropostaStatus). Isso é o status comercial da proposta — o servidor também
 *      põe VENDIDA = SIM na unidade, e o passo 2 corrige o mapa logo depois;
 *   2) UNIDADE (base UNIDADES, coluna VENDIDA = "STATUS MAPA", a que o mapa público lê):
 *      - ETAPA Concluída → VENDIDA = SIM e STATUS INTERNO = VENDIDA;
 *      - ainda não concluída e a unidade está SIM → VENDIDA = RESERVADA e STATUS INTERNO = RESERVADA (PAGOU
 *        PREFERÊNCIA continua PAGOU PREFERÊNCIA no mapa interno). Unidade DISPONÍVEL/RESERVADA não é mexida: quem
 *        reserva é o botão Reservar da proposta.
 * Só grava o que falta; uma vez por linha e por situação (concluída ou não) por sessão — de novo se deu erro, ou com
 * o.forcar. Só o Reserva dos Ipês tem propostas e base UNIDADES. Usado pela Planilha Casas Condomínio (vendas.html)
 * e pela aba Propostas / Análise de vendas (simulacoes.html). Puro o bastante para o node (sem DOM).
 * Nada de dado pessoal no console além de número de unidade/proposta. */
(function (raiz) {
  "use strict";

  /* o nome aparece como "Reserva dos Ipês", "RESERVA DO IPÊS", "Condomínio Reserva dos Ipês"… */
  var BASE = /RESERVA DOS? IPE/;
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
    /* vazio conta como Ipês: hoje é o único condomínio com propostas e base UNIDADES */
    if (cond && !BASE.test(cond)) return false;
    if (norm(val(l, "STATUS INTERNO")) === "DISTRATO") return false;
    return unidadeDa(l, titulo) !== null;
  }
  function contratoEnviado(l) {
    var s = norm(val(l, "ASSINATURA - SITUAÇÃO"));
    return s === "ENVIADO" || s === "ASSINADO";
  }
  /* 04/11/2026: ETAPA = Concluída (mesma régua da coluna ETAPA da Planilha Casas Condomínio) */
  function concluida(l) {
    return norm(val(l, "ASSINATURA - SITUAÇÃO")) === "ASSINADO" && !!String(val(l, "MC - VENDA ID") || "").trim();
  }
  /* como a casa aparece no mapa enquanto tem linha no banco de vendas */
  function estadoMapa(l) { return concluida(l) ? "vendida" : "reservada"; }
  function chave(l) { return semTraco(l.id) + "|" + (concluida(l) ? "C" : "R"); }

  /* listas lidas uma vez por rodada (as propostas só quando alguma linha precisa delas) */
  async function lerUnidades(cache, chamar) {
    if (cache.unidades !== undefined) return;
    var r = null; try { r = await chamar({ action: "simsUnidades" }, 60000); } catch (e) {}
    cache.unidades = (r && Array.isArray(r.unidades)) ? r.unidades : null; cache.erroU = (r && r.erro) || "sem resposta";
  }
  async function lerPropostas(cache, chamar) {
    if (cache.propostas !== undefined) return;
    var r = null; try { r = await chamar({ action: "simsPropostas" }, 90000); } catch (e) {}
    cache.propostas = (r && Array.isArray(r.propostas)) ? r.propostas : null; cache.erroP = (r && r.erro) || "sem resposta";
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

  /* o que a unidade precisa receber, ou null (já está certa / não é para mexer) */
  function camposUnidade(l, u) {
    var vend = norm(u.vendidaCru || u.vendida), si = norm(u.statusInterno);
    if (concluida(l)) {
      if (vend === "SIM" && si === "VENDIDA") return null;
      return { "VENDIDA": "SIM", "STATUS INTERNO": "VENDIDA" };
    }
    if (vend !== "SIM" && si !== "VENDIDA") return null;
    var pref = si === "PAGOU PREFERENCIA" || norm(val(l, "STATUS INTERNO")) === "PAGOU PREFERENCIA";
    return { "VENDIDA": "RESERVADA", "STATUS INTERNO": pref ? "PAGOU PREFERÊNCIA" : "RESERVADA" };
  }

  async function marcar(l, titulo, cache, o) {
    var n = unidadeDa(l, titulo), feito = [], erros = [];
    /* 1) proposta: só com contrato enviado/assinado ou com o aviso de contrato final gerado */
    if (o.proposta || contratoEnviado(l)) {
      await lerPropostas(cache, o.chamar);
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
            /* o servidor marca a unidade VENDIDA = SIM junto: o passo 2 confere de novo */
            (cache.unidades || []).forEach(function (u) { if (numUn(u.unidade) === n) { u.vendidaCru = "SIM"; u.statusInterno = "VENDIDA"; } });
          } else erros.push("a proposta não foi marcada como vendida (" + esc((r && (r.mensagem || r.erro)) || "sem resposta") + ")");
        }
      }
    }
    /* 2) unidade no mapa: RESERVADA até a ETAPA ficar Concluída */
    await lerUnidades(cache, o.chamar);
    if (!cache.unidades) erros.push("não consegui ler a base UNIDADES (" + esc(cache.erroU) + ")");
    else {
      var us = cache.unidades.filter(function (u) { return numUn(u.unidade) === n; });
      if (us.length !== 1) erros.push((us.length ? "há mais de uma" : "não achei a") + " unidade " + n + " na base UNIDADES");
      else {
        var campos = camposUnidade(l, us[0]);
        if (campos) {
          var w = null;
          try { w = await o.chamar({ action: "simsUnidadeUpdate", pageId: us[0].id, campos: campos }, 60000, true); } catch (e) {}
          if (w && w.ok) {
            us[0].vendidaCru = campos["VENDIDA"]; us[0].statusInterno = campos["STATUS INTERNO"];
            feito.push(campos["VENDIDA"] === "SIM"
              ? "unidade " + esc(us[0].unidade || n) + " <b>VENDIDA</b> no mapa (etapa concluída)"
              : "unidade " + esc(us[0].unidade || n) + " fica <b>RESERVADA</b> no mapa até a etapa ficar Concluída");
          } else erros.push("o mapa da unidade " + n + " não foi atualizado (" + esc((w && w.erro) || "sem resposta") + ")");
        }
      }
    }
    if (erros.length) delete feitas[chave(l)];   // tenta de novo na próxima vez
    if (feito.length || erros.length) {
      try { console.log("[venda → mapa] unidade " + n + ": " + feito.concat(erros).join("; ").replace(/<[^>]+>/g, "")); } catch (e) {}
    }
    if (o.aviso) {
      if (erros.length) o.aviso(l.id, "err", "<b>Venda × mapa:</b> " + erros.join("; ") + "." + (feito.length ? " Feito: " + feito.join("; ") + "." : ""));
      else if (feito.length) o.aviso(l.id, "ok", "<b>Venda × mapa:</b> " + feito.join("; ") + ". Mapa e propostas já atualizam.");
    }
    return feito.length;
  }

  /* linhas: [{id, v:{coluna:valor}}]; ids: quais rodar (null = todas as da base).
   * o = { chamar(payload, ms, prioritario), aviso(id, "ok"|"err", html)?, aoTerminar(qtdGravadas)?,
   *       proposta?: true = marcar a proposta VENDIDA mesmo sem contrato enviado (aviso de contrato final gerado),
   *       forcar?: true = ignora o "já conferido nesta sessão" }
   * Em série: o Apps Script atende um pedido por vez. */
  function rodar(linhas, titulo, ids, o) {
    o = o || {};
    var alvo = (linhas || []).filter(function (l) {
      if (!l || !l.id || !elegivel(l, titulo)) return false;
      if (ids) return ids.some(function (i) { return semTraco(i) === semTraco(l.id); });
      return true;
    }).filter(function (l) { return o.forcar || !feitas[chave(l)]; });
    alvo.forEach(function (l) { feitas[chave(l)] = true; });
    if (!alvo.length) return fila;
    var cache = {};
    fila = fila.then(async function () {
      var total = 0;
      for (var i = 0; i < alvo.length; i++) { try { total += await marcar(alvo[i], titulo, cache, o); } catch (e) { delete feitas[chave(alvo[i])]; } }
      if (total) { try { if (typeof storeInvalidar === "function") storeInvalidar("sims_propostas", "sims_unidades"); } catch (e) {} }
      if (o.aoTerminar) { try { await o.aoTerminar(total); } catch (e) {} }
    });
    return fila;
  }
  /* linhas ainda não conferidas nesta sessão (proposta e mapa) */
  function pendentes(linhas, titulo) {
    return (linhas || []).filter(function (l) { return l && l.id && elegivel(l, titulo) && !feitas[chave(l)]; })
      .map(function (l) { return l.id; });
  }

  var api = { rodar: rodar, pendentes: pendentes, contratoEnviado: contratoEnviado, concluida: concluida,
              estadoMapa: estadoMapa, camposUnidade: camposUnidade, elegivel: elegivel };
  raiz.ContratoVendida = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
