/* assinatura-ui.js — bloco "Assinatura" do painel da casa (entrega 3).
 * JS puro do navegador, no estilo do venda-dossie.js. Fala só com o Apps Script
 * PORTAL-VENDA (ações assinaturaEnviar e assinaturaEstado). A integração no
 * vendas.html / venda-dossie.js fica com quem coordena: este arquivo só desenha
 * o bloco e executa as duas ações, recebendo de fora como chamar o servidor.
 * Nunca mostra e-mail: o servidor devolve só papel e se assinou. */
(function () {
  "use strict";

  var REENVIAVEL = ["CANCELADO", "RECUSADO", "EXPIRADO"];
  var SITUACAO = {
    ENVIADO: "Enviado — aguardando assinaturas",
    ASSINADO: "Assinado — o PDF assinado está em CONTRATO ASSINADO",
    RECUSADO: "Recusado por um signatário — confira o motivo na Clicksign e envie de novo",
    CANCELADO: "Cancelado na Clicksign — pode enviar de novo",
    EXPIRADO: "Prazo vencido sem todas as assinaturas — pode enviar de novo",
    RASCUNHO: "Rascunho na Clicksign (não foi enviado)"
  };
  var MSG = {
    NAO_AUTORIZADO: "Sua sessão expirou — entre de novo no portal.",
    SEM_PERMISSAO: "Seu login não tem acesso a Vendas.",
    SEM_PERMISSAO_TESTES: "O perfil TESTES só consulta; não envia para assinatura.",
    SEM_RESPOSTA: "O servidor não respondeu — confira a internet e tente de novo.",
    PORTAL_VENDA_NAO_CONFIGURADO: "A assinatura ainda não foi ligada neste ambiente.",
    CLICKSIGN_SEM_TOKEN: "A assinatura ainda não foi ligada neste ambiente (falta o token da Clicksign) — avise o administrador.",
    CLICKSIGN_URL_INVALIDA: "O endereço da Clicksign está errado nas configurações — avise o administrador.",
    ENVELOPE_ABERTO: "Este contrato já está com a Clicksign — use Atualizar situação.",
    SEM_CONTRATO_GERADO: "Gere o contrato antes de enviar para assinatura.",
    FALTAM_DADOS: "Complete os dados abaixo e envie de novo.",
    CADASTRO_NAO_CONFIGURADO: "Os cadastros do contrato não estão configurados — avise o administrador.",
    CONTRATO_ILEGIVEL: "Não consegui abrir o PDF do contrato gerado — gere o contrato de novo.",
    DOWNLOAD_ASSINADO_FALHOU: "Não consegui baixar o PDF assinado da Clicksign — tente Atualizar situação daqui a pouco.",
    UPLOAD_FALHOU: "Não consegui guardar o PDF assinado na casa — tente Atualizar situação de novo.",
    CLICKSIGN_ENVELOPE_SEM_DOCUMENTO: "O envelope na Clicksign está sem documento — avise o desenvolvedor."
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function situacaoDe(estado) { return String((estado && estado.situacao) || "").toUpperCase(); }
  /* Envelope com situação vazia conta como aberto (mesma regra do servidor). */
  function podeEnviar(c) {
    var e = c.estado;
    if (!e || !c.contratoGerado || c.ocupado || c.testes) return false;
    return !e.envelope || REENVIAVEL.indexOf(situacaoDe(e)) >= 0;
  }
  function podeAtualizar(c) { return !!(c.estado && c.estado.envelope && !c.ocupado); }

  function mensagemAssinatura(r) {
    r = r || {};
    var e = String(r.erro || "");
    if (!e) return r.aviso === "NOTIFICACAO_FALHOU"
      ? "Enviado, mas o e-mail de aviso falhou — use Atualizar situação; se ninguém receber, avise o desenvolvedor." : "";
    if (e === "CLICKSIGN_FALHOU") {
      var consulta = /^consultar/.test(String(r.passo || ""));
      if (!r.http) return "A Clicksign não respondeu (passo: " + r.passo + ")" +
        (consulta ? " — tente Atualizar situação daqui a pouco." : ". Nada foi enviado aos signatários — tente de novo em alguns minutos.");
      return "A Clicksign recusou " + (consulta ? "a consulta" : "o envio") + " (passo: " + r.passo + ", código " + r.http +
        (r.detalhe ? ": " + r.detalhe : "") + ")." + (consulta ? " Avise o desenvolvedor." : " Nada foi enviado aos signatários — avise o desenvolvedor.");
    }
    if (e === "GRAVACAO_FALHOU" && r.envelopeId)
      return "O envelope " + r.envelopeId + " foi criado na Clicksign, mas o portal não conseguiu anotar na casa — não envie de novo; avise o desenvolvedor.";
    if (e === "GRAVACAO_FALHOU") return "Não consegui gravar a situação na casa — tente Atualizar situação de novo.";
    if (e.indexOf("CLICKSIGN_SEM_LINK_ASSINADO") === 0)
      return "A Clicksign diz que terminou, mas não entregou o link do PDF assinado — avise o desenvolvedor.";
    if (e.indexOf("CLICKSIGN_STATUS_DESCONHECIDO") === 0)
      return "A Clicksign devolveu uma situação que o portal não conhece — avise o desenvolvedor.";
    if (e.indexOf("COLUNA_FALTANDO: ") === 0) return "A base não tem a coluna " + e.slice(17) + " — avise o desenvolvedor.";
    if (e.indexOf("TIPO_DE_COLUNA_ERRADO: ") === 0) return "A coluna " + e.slice(23) + " está com o tipo errado no Notion — avise o desenvolvedor.";
    return MSG[e] || "Algo deu errado (" + e + ") — tente de novo.";
  }

  function montarBlocoAssinatura(c) {
    var h = '<div class="grp">Assinatura</div>';
    if (c.testes) h += '<div class="dz-aviso">Perfil TESTES só consulta.</div>';
    if (!c.estado) return h + '<div class="vazio">' + esc(c.msg || "carregando…") + "</div>";
    var e = c.estado, sit = situacaoDe(e);
    if (c.ocupado === "enviar") h += '<div class="dz-linha"><b>enviando… (até 1 minuto)</b></div>';
    if (c.ocupado === "atualizar") h += '<div class="dz-linha"><b>consultando…</b></div>';
    if (!c.contratoGerado) h += '<div class="dz-aviso">Gere o contrato antes de enviar para assinatura.</div>';
    if (e.envelope) {
      h += '<div class="dz-linha"><span class="dz-rot">Situação: ' + esc(SITUACAO[sit] || sit || "sem situação gravada") + "</span></div>";
      var sigs = e.signatarios || [];
      if (sigs.length) {
        h += "<ul>" + sigs.map(function (s) {
          return "<li><span>" + esc(s.papel) + "</span> <b>" + (s.assinou ? "assinou" : "falta assinar") + "</b></li>";
        }).join("") + "</ul>";
      }
    }
    if (c.faltas && c.faltas.length) {
      h += '<div class="dz-aviso">Para enviar, falta:</div><ul>' +
        c.faltas.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>";
    }
    var rotulo = e.envelope && REENVIAVEL.indexOf(sit) >= 0 ? "Enviar de novo para assinatura" : "Enviar para assinatura";
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="a-enviar"' + (podeEnviar(c) ? "" : " disabled") + ">" + rotulo + "</button>";
    if (e.envelope) h += ' <button type="button" class="bt ghost bt-mini" data-acao="a-atualizar"' + (podeAtualizar(c) ? "" : " disabled") + ">Atualizar situação</button>";
    h += "</div>";
    if (c.msg) h += '<div class="dz-msg">' + esc(c.msg) + "</div>";
    return h;
  }

  function copia(c, mud) {
    var n = {};
    for (var k in c) n[k] = c[k];
    for (var m in mud) n[m] = mud[m];
    return n;
  }

  /* Executa um clique. deps: { pageId, confirmar(texto) -> bool, chamar(payload) -> Promise<resposta>,
   * pintar(ctx) opcional — chamado com o bloco ocupado antes de ir ao servidor }.
   * Devolve o contexto novo (não muda o recebido). */
  async function executarAcaoAssinatura(acao, c, deps) {
    var enviar = acao === "a-enviar";
    if (enviar ? !podeEnviar(c) : (acao !== "a-atualizar" || !podeAtualizar(c))) return c;
    if (enviar && !deps.confirmar("Enviar o contrato para assinatura? Cada signatário recebe um e-mail da Clicksign para assinar.")) return c;
    if (typeof deps.pintar === "function") deps.pintar(copia(c, { ocupado: enviar ? "enviar" : "atualizar", msg: "", faltas: null }));
    var r;
    try {
      r = await deps.chamar({ action: enviar ? "assinaturaEnviar" : "assinaturaEstado", pageId: deps.pageId });
    } catch (err) {
      r = { ok: false, erro: "SEM_RESPOSTA" };
    }
    r = r || { ok: false, erro: "SEM_RESPOSTA" };
    if (!r.ok) return copia(c, { ocupado: null, faltas: r.faltas || null, msg: mensagemAssinatura(r) });
    var estado = { situacao: r.situacao || "", envelope: enviar ? true : !!r.envelope, signatarios: r.signatarios || [] };
    var msg = mensagemAssinatura(r) || (enviar ? "Enviado — cada signatário recebe o e-mail da Clicksign." : "Situação atualizada.");
    return copia(c, { estado: estado, ocupado: null, faltas: null, msg: msg });
  }

  var exportar = { montarBlocoAssinatura: montarBlocoAssinatura, mensagemAssinatura: mensagemAssinatura,
                   executarAcaoAssinatura: executarAcaoAssinatura, podeEnviar: podeEnviar };
  if (typeof module !== "undefined" && module.exports) { module.exports = exportar; return; }
  window.VendaAssinatura = exportar; /* o coordenador liga no painel (venda-dossie.js / vendas.html) */
})();
