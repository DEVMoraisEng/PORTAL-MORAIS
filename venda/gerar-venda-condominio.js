/* gerar-venda-condominio.js — botão "Gerar venda" para a tela do condomínio
 * (a que lista as linhas da BANCO DE DADOS VENDAS CONDOMÍNIO).
 * Fala só com o Apps Script PORTAL-VENDA (ação gerarVendaCondominio), com o
 * token da sessão do portal, e com ok abre a tela de venda na casa criada.
 * Como ligar numa tela: venda/COMO-IMPLANTAR.md, seção "Gerar venda do condomínio".
 *
 *   GerarVendaCondominio.botao({
 *     pageId: "<id da linha do condomínio>",
 *     urlPortalVenda: "https://script.google.com/macros/s/…/exec",
 *     urlVendas: "vendas.html"            // opcional; padrão: vendas.html ao lado da página
 *   })  → <button> pronto para pôr na linha
 */
(function (raiz) {
  "use strict";

  var MSG = {
    NAO_AUTORIZADO: "Sua sessão expirou — entre de novo no portal.",
    SEM_PERMISSAO: "Seu login não tem acesso a Vendas.",
    SEM_PERMISSAO_TESTES: "O perfil TESTES só consulta; não gera venda.",
    PAGINA_INVALIDA: "Esta linha não tem um identificador válido do Notion.",
    PAGINA_DE_OUTRA_BASE: "Esta linha não é da base de vendas do condomínio configurada no PORTAL-VENDA.",
    BACKEND_SEM_CONFIG: "O PORTAL-VENDA ainda não foi configurado para o condomínio (falta DB_VENDAS_COND) — avise o desenvolvedor.",
    GERAR_VENDA_OCUPADO: "Outra venda está sendo gerada agora — espere alguns segundos e clique de novo.",
    ACAO_DESCONHECIDA: "O PORTAL-VENDA está numa versão antiga (sem o Gerar venda) — avise o desenvolvedor.",
    SEM_RESPOSTA: "O servidor não respondeu — confira na tela de vendas se a casa foi criada antes de clicar de novo.",
    PORTAL_VENDA_NAO_CONFIGURADO: "O Gerar venda ainda não foi ligado neste ambiente.",
    ERRO_INTERNO: "Algo deu errado no servidor — tente de novo; se repetir, avise o desenvolvedor."
  };

  function mensagemDeErro(erro) {
    var e = String(erro || "");
    if (e.indexOf("COLUNA_FALTANDO: ") === 0) return "A base VENDAS não tem a coluna " + e.slice(17) + " — avise o desenvolvedor.";
    return MSG[e] || "Não consegui gerar a venda (" + e + ") — tente de novo.";
  }

  /* resumo do que aconteceu (sem dado pessoal; nomes de arquivo só na lista de falhas) */
  function resumo(r) {
    var partes = [r.jaExistia ? "Esta venda já tinha sido gerada — abrindo a casa." : "Venda gerada."];
    var c = (r.arquivosCopiados || []).length, f = r.arquivosComFalha || [], ig = r.colunasIgnoradas || [];
    if (c) partes.push(c + (c === 1 ? " arquivo copiado." : " arquivos copiados."));
    if (f.length) partes.push("Não consegui copiar: " + f.map(function (x) { return x.arquivo + " (" + x.coluna + ")"; }).join(", ") +
                              " — anexe esses na casa, pelo Dossiê do comprador.");
    if (ig.length) partes.push("A VENDAS não tem as colunas: " + ig.join(", ") + ".");
    (r.avisos || []).forEach(function (a) { partes.push(a); });
    return partes.join(" ");
  }

  /* endereço da tela de venda; o servidor devolve "vendas.html?abrir=<id>" */
  function destino(r, urlVendas) {
    var id = encodeURIComponent(String(r.pageId || ""));
    return (urlVendas || "vendas.html") + (String(urlVendas || "").indexOf("?") >= 0 ? "&" : "?") + "abrir=" + id;
  }

  function tokenDaSessao() {
    if (typeof raiz.sessao === "function") { var s = raiz.sessao(); return s && s.token; }
    try {
      var t = raiz.localStorage.getItem("morais_sessao") || raiz.sessionStorage.getItem("morais_sessao");
      return t ? (JSON.parse(t) || {}).token : null;
    } catch (e) { return null; }
  }

  async function chamar(urlPortalVenda, payload, ms, fetchFn) {
    if (!/^https:\/\/script\.google\.com\//.test(String(urlPortalVenda || ""))) return { ok: false, erro: "PORTAL_VENDA_NAO_CONFIGURADO" };
    var f = fetchFn || raiz.fetch;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 280000) : null;
    try {
      /* text/plain: sem preflight de CORS no Apps Script (mesmo padrão do venda-dossie.js) */
      var r = await f(urlPortalVenda, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                                         body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined });
      return await r.json();
    } catch (e) { return { ok: false, erro: "SEM_RESPOSTA" }; }
    finally { if (t) clearTimeout(t); }
  }

  /* gera e devolve {ok, texto, ir}: `ir` é o endereço a abrir (só com ok) */
  async function gerar(opts, fetchFn) {
    var r = await chamar(opts.urlPortalVenda, { action: "gerarVendaCondominio", pageId: opts.pageId,
                                                atualizar: !!opts.atualizar, token: opts.token || tokenDaSessao() }, opts.ms, fetchFn);
    if (!r || !r.ok) return { ok: false, texto: mensagemDeErro(r && r.erro) };
    return { ok: true, texto: resumo(r), ir: destino(r, opts.urlVendas), resposta: r };
  }

  function botao(opts) {
    var doc = raiz.document, b = doc.createElement("button");
    b.type = "button"; b.className = opts.classe || "bt bt-mini"; b.textContent = "Gerar venda";
    b.title = "Cria a casa na tela de Vendas com os dados e documentos desta pasta";
    var ocupado = false;
    b.addEventListener("click", async function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();   // a linha pode ter clique próprio
      if (ocupado) return;
      ocupado = true; b.disabled = true; b.textContent = "Gerando…";
      try {
        var r = await gerar(opts);
        var avisar = opts.avisar || function (t) { raiz.alert(t); };
        avisar(r.texto, r.ok);
        if (r.ok) raiz.location.href = r.ir;
      } finally {
        ocupado = false; b.disabled = false; b.textContent = "Gerar venda";
      }
    });
    return b;
  }

  var exportar = { botao: botao, gerar: gerar, chamar: chamar, mensagemDeErro: mensagemDeErro, resumo: resumo, destino: destino };
  if (typeof module !== "undefined" && module.exports) { module.exports = exportar; return; }
  raiz.GerarVendaCondominio = exportar;
})(typeof window !== "undefined" ? window : globalThis);
