/* ComissaoMC — pedido da comissão do corretor ao robô do servidor (24/11/2026). Só condomínio.
 * Arquivo do projeto PORTAL-VENDA (ao lado de MaisControleVenda.gs).
 *
 * O robô (venda/mc/comissao.py, acao "comissao" da fila) lê e escreve a coluna "MC - COMISSÃO" da linha do condomínio.
 * Aqui só se PEDE (prévia ou lançamento) e se LÊ a coluna para a tela.
 * A coluna é a memória do que já foi lançado: as linhas "LANÇADA | …", "INCERTO | …" e "INCERTO CONFERIDO | …" NUNCA
 * se apagam (o robô soma as LANÇADA como "já lançado"; apagar permitiria pagar a comissão em dobro).
 * Formato do PROCESSANDO (1ª linha): "PROCESSANDO (prévia|lançamento) — dd/MM HH:mm [t=ms]" + " [#hash]" no lançamento
 * (o hash da prévia vista; o robô confere de novo antes de gravar). */
var MC_COL_COMISSAO = "MC - COMISSÃO";
var COM_PREFIXOS_HIST = ["LANÇADA |", "INCERTO |", "INCERTO CONFERIDO |"];
var COM_RE_PARCELAS = /^\d{1,7}(?:\.\d{1,2})?@\d{4}-\d{2}-\d{2}(?:;\d{1,7}(?:\.\d{1,2})?@\d{4}-\d{2}-\d{2}){0,5}$/;
var COM_RE_ID = /^[0-9a-fA-F-]{32,36}$/;

/* Linhas do histórico que nunca se apagam. */
function comissaoHistorico_(texto) {
  return String(texto || "").split("\n").filter(function (ln) {
    for (var i = 0; i < COM_PREFIXOS_HIST.length; i++) if (ln.indexOf(COM_PREFIXOS_HIST[i]) === 0) return true;
    return false;
  });
}

/* Soma as linhas "LANÇADA | título X | R$ 8.750,00 | …" (função pura). */
function comissaoJaLancada(texto) {
  var total = 0;
  String(texto || "").split("\n").forEach(function (ln) {
    var m = /^LANÇADA \| título (\S+) \| R\$ ([\d.]+,\d{2})/.exec(ln);
    if (m) total += Number(m[2].replace(/\./g, "").replace(",", "."));
  });
  return Math.round(total * 100) / 100;
}

/* rich_text em blocos (o Notion limita cada bloco a 2000 caracteres) */
function comissaoRich_(texto) {
  var s = String(texto || ""), out = [];
  for (var i = 0; i < s.length; i += 1900) out.push({ type: "text", text: { content: s.slice(i, i + 1900) } });
  return out;
}

function comissaoLerPagina_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  var base = vendaBaseDaPagina_(pg);
  if (!base) throw new Error("PAGINA_DE_OUTRA_BASE");
  var props = pg.properties || {};
  var c = mcColunaReal_(props, MC_COL_COMISSAO), v = mcColunaReal_(props, MC_COL_VENDA);
  return { props: props, base: base, colComissao: c && c.tipo === "rich_text" ? c.nome : "", colVenda: v && v.tipo === "rich_text" ? v.nome : "" };
}

function comissaoValor_(props, nome) {
  var c = mcColunaReal_(props, nome);
  return c ? valorProp_(props[c.nome]) : null;
}

function mcComissao_(col, sess, p) {
  var aplicar = p.aplicar === true || p.aplicar === "true";
  var papel = String(sess.t || "").toUpperCase();
  if (aplicar && papel !== "ADM" && papel !== "MASTER") return { ok: false, erro: "SEM_PERMISSAO_LANCAR" };
  var parcelas = String(p.parcelas || "");
  if (!COM_RE_PARCELAS.test(parcelas)) return { ok: false, erro: "PARCELAS_INVALIDAS" };
  var fav = String(p.favorecido || "");
  if (fav && !COM_RE_ID.test(fav)) return { ok: false, erro: "FAVORECIDO_INVALIDO" };
  if (!roboUsaFila_()) return { ok: false, erro: "MC_NAO_CONFIGURADO" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "MC_PROCESSANDO" };
  try {
    var c = comissaoLerPagina_(p.pageId), agora = Date.now();
    if (c.base !== "CONDOMINIO") return { ok: false, erro: "SO_CONDOMINIO" };
    if (!c.colComissao) return { ok: false, erro: "COLUNA_FALTANDO" };
    if (!String(valorProp_(c.props[c.colVenda]) || "").trim()) return { ok: false, erro: "SEM_VENDA_ID" };
    var atual = valorProp_(c.props[c.colComissao]) || "";
    if (mcProcessandoVivo_(atual, agora)) return { ok: false, erro: "MC_PROCESSANDO" };
    var primeira = String(atual).split("\n")[0];
    if (aplicar && !/^PR[ÉE]VIA OK/i.test(primeira)) return { ok: false, erro: "MC_SEM_PREVIA" };

    var hist = comissaoHistorico_(atual);
    var assin = (/\[#([0-9a-f]{8})\]/.exec(primeira) || [])[1] || "";
    var cab = "PROCESSANDO (" + (aplicar ? "lançamento" : "prévia") + ") — " + hoje_("dd/MM HH:mm") + " [t=" + agora + "]" +
              (aplicar && assin ? " [#" + assin + "]" : "");
    var grava = function (primeiraLinha) {
      var pr = {};
      pr[c.colComissao] = { rich_text: comissaoRich_([primeiraLinha].concat(hist).join("\n")) };
      notion_("PATCH", "/pages/" + p.pageId, { properties: pr });
    };
    grava(cab);

    var f = roboFilaPor_("mc-venda", { pageId: String(p.pageId).replace(/-/g, ""), acao: "comissao", parcelas: parcelas,
                                       favorecido: fav, aplicar: aplicar });
    if (!f.ok) {
      try { grava("ERRO: não consegui pôr o pedido na fila do servidor"); } catch (e) {}
      return { ok: false, erro: "MC_DISPARO_FALHOU" };
    }
    var aviso = roboAvisoSinal_(f.sinal, Date.now());
    if (aviso) { try { grava(cab + aviso); } catch (e) {} }
    console.log("PORTAL-VENDA mcComissao " + String(p.pageId).slice(0, 8) + (aplicar ? " aplicar" : " previa") + " (fila)");
    return { ok: true, aplicar: aplicar, semSinal: !!aviso };
  } finally {
    lock.releaseLock();
  }
}

/* Leitura para a tela: o texto da coluna e os dados da venda. */
function mcComissaoEstado_(col, p) {
  var c = comissaoLerPagina_(p.pageId);
  if (c.base !== "CONDOMINIO") return { ok: false, erro: "SO_CONDOMINIO" };
  if (!c.colComissao) return { ok: false, erro: "COLUNA_FALTANDO" };
  var texto = valorProp_(c.props[c.colComissao]) || "";
  var n = comissaoValor_(c.props, " COMISSÃO ");
  return { ok: true, texto: texto, comissao: typeof n === "number" ? n : null, jaLancado: comissaoJaLancada(texto),
           corretor: comissaoValor_(c.props, "CORRETOR") || "", imobiliaria: comissaoValor_(c.props, "IMOBILIÁRIA") || "",
           vendaId: c.colVenda ? (valorProp_(c.props[c.colVenda]) || "") : "",
           processando: mcProcessandoVivo_(texto, Date.now()) };
}
