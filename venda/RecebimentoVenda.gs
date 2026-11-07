/* RecebimentoVenda — bloco "Recebimentos" do painel da casa (entrega 14; vários pagamentos, FGTS, outros, contrato de
 * financiamento e Mais Controle em 05/11/2026, pedido do dono).
 * Arquivo do projeto PORTAL-VENDA (depois de PortalVenda, GerarContrato, ContratoVenda, ClicksignVenda e FilaRobo).
 *
 * Itens: Sinal, Entrada, Financiamento e FGTS (+ "outros" com rótulo livre). Cada item tem:
 *  - o valor esperado, EDITÁVEL na própria aba (grava a coluna de origem: CONTRATO - SINAL VALOR, CONTRATO - ENTRADA VALOR,
 *    VALOR FINANCIADO, VALOR DO FGTS — o contrato e o lançamento leem as mesmas);
 *  - a lista de pagamentos (RECEBIMENTO - <ITEM> PAGAMENTOS, texto com JSON [{id, data, valor, por, arquivo, em}]):
 *    "o sinal é 5 mil, mas manda 3 mil num dia e 2 mil no outro"; a tela mostra soma × esperado (falta/sobra);
 *  - o comprovante de cada pagamento na coluna RECEBIMENTO - <ITEM> COMPROVANTE (files), com nome "<Rótulo> <id> - <arquivo>"
 *    (é por ele que o robô acha o arquivo do pagamento).
 * Compatível com a entrega 14: sem a coluna PAGAMENTOS o item continua no jeito antigo (uma confirmação: DATA +
 * COMPROVANTE + POR). Com a lista, a DATA antiga recebe a data do 1º pagamento (o mapa de vendas lê ela) e o POR o último.
 * Coluna que falta para um item NÃO quebra o bloco: o aviso fica só no item.
 *
 * Mais Controle: com a venda lançada (MC - VENDA ID) e a fila do servidor ligada (DB_FILA_ROBO), confirmar pagamento,
 * mudar valor esperado ou ler o contrato de financiamento põe um pedido "mc-recebimento" na fila (venda/mc/recebimentos.py):
 * baixa o sinal/entrada com o comprovante e acerta as parcelas de sinal, financiamento e FGTS. O resultado volta na
 * coluna MC - RECEBIMENTOS (JSON) e a tela mostra por item. Gravar no ERP depende das travas do servidor.
 *
 * E-mail a cada pagamento (MailApp) para RECEBIMENTO_EMAILS, sem CPF. Só casa da VENDAS. Perfil TESTES não grava.
 * Log só com ação, pageId abreviado, item e resultado — nunca valor, nome, e-mail ou data.
 * A parte pura (RecebimentoVenda) roda igual no node (testes em venda/testes). Repositório público: nenhum dado real. */
var RecebimentoVenda = (function () {
  "use strict";
  var ITENS = [
    { id: "SINAL", rotulo: "Sinal", esperado: "CONTRATO - SINAL VALOR", baixaMC: true },
    { id: "ENTRADA", rotulo: "Entrada", esperado: "CONTRATO - ENTRADA VALOR", baixaMC: true },
    { id: "FINANCIAMENTO", rotulo: "Financiamento", esperado: "VALOR FINANCIADO", baixaMC: false },
    { id: "FGTS", rotulo: "FGTS", esperado: "VALOR DO FGTS", baixaMC: false }
  ];
  /* os três itens da entrega 14 (as 9 colunas antigas) */
  var ANTIGOS = ["SINAL", "ENTRADA", "FINANCIAMENTO"];
  var TIPOS = { data: "date", comprovante: "files", por: "rich_text", pagamentos: "rich_text" };
  var COL = { OUTROS: "RECEBIMENTO - OUTROS", OUTROS_COMPROVANTE: "RECEBIMENTO - OUTROS COMPROVANTE",
              MC: "MC - RECEBIMENTOS", CONTRATO_FIN: "CONTRATO DE FINANCIAMENTO", VENDA_ID: "MC - VENDA ID" };
  var RE_ID = /^[0-9a-z]{4,24}$/;

  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function item(id) {
    for (var i = 0; i < ITENS.length; i++) if (ITENS[i].id === txt(id).toUpperCase()) return ITENS[i];
    return null;
  }
  /* "OUTRO:<id>" -> "<id>" (o item com rótulo livre); senão "" */
  function outroId(id) { var m = /^OUTRO:([0-9a-z]{4,24})$/.exec(txt(id)); return m ? m[1] : ""; }
  function colunas(id) {
    return { data: "RECEBIMENTO - " + id + " DATA", comprovante: "RECEBIMENTO - " + id + " COMPROVANTE",
             por: "RECEBIMENTO - " + id + " POR", pagamentos: "RECEBIMENTO - " + id + " PAGAMENTOS" };
  }
  /* { nome da coluna: tipo } das 9 colunas da entrega 14 */
  function colunasNecessarias() {
    var r = {};
    ANTIGOS.forEach(function (id) { var c = colunas(id); ["data", "comprovante", "por"].forEach(function (k) { r[c[k]] = TIPOS[k]; }); });
    return r;
  }
  /* { nome: tipo } das colunas de 05/11/2026 (o script venda/ferramentas/criar_colunas_recebimentos.py cria) */
  function colunasNovas() {
    var r = {};
    ITENS.forEach(function (it) { r[colunas(it.id).pagamentos] = "rich_text"; });
    r[colunas("FGTS").comprovante] = "files";
    r[COL.OUTROS] = "rich_text"; r[COL.OUTROS_COMPROVANTE] = "files"; r[COL.MC] = "rich_text"; r[COL.CONTRATO_FIN] = "files";
    return r;
  }
  /* "aaaa-mm-dd" que existe no calendário, de 2000 em diante e não depois de hoje */
  function dataValida(iso, hojeISO) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(iso));
    if (!m) return false;
    var a = Number(m[1]), me = Number(m[2]), d = Number(m[3]);
    if (a < 2000 || me < 1 || me > 12 || d < 1) return false;
    var dias = [31, (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][me - 1];
    if (d > dias) return false;
    return !hojeISO || txt(iso) <= txt(hojeISO);
  }
  /* número ou "3.000,50" / "3000.5" -> número com 2 casas; null se não for número. minimo: 0 (aceita zero) ou >0 */
  function valor(v, aceitaZero) {
    var n;
    if (typeof v === "number") n = v;
    else {
      var t = txt(v).replace(/[^\d,.\-]/g, "");
      if (!t) return null;
      if (t.indexOf(",") >= 0) t = t.replace(/\./g, "").replace(",", ".");
      else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
      n = Number(t);
    }
    if (!isFinite(n) || n < 0 || n > 100000000) return null;
    n = Math.round(n * 100) / 100;
    return n > 0 || (aceitaZero && n === 0) ? n : null;
  }
  /* lista de pagamentos gravada (JSON) -> só as linhas válidas, na ordem da data */
  function lerLista(texto) {
    var j;
    try { j = JSON.parse(txt(texto) || "[]"); } catch (e) { return []; }
    if (!Array.isArray(j)) return [];
    return j.filter(function (x) {
      return x && RE_ID.test(txt(x.id)) && dataValida(x.data) && valor(x.valor) !== null;
    }).map(function (x) {
      return { id: txt(x.id), data: txt(x.data), valor: valor(x.valor), por: txt(x.por).slice(0, 80),
               arquivo: txt(x.arquivo).slice(0, 200), em: txt(x.em).slice(0, 30) };
    }).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : (a.id < b.id ? -1 : 1); });
  }
  function soma(lista) {
    return Math.round((lista || []).reduce(function (s, p) { return s + (typeof p.valor === "number" ? p.valor : 0); }, 0) * 100) / 100;
  }
  /* esperado (número|null) × pagamentos -> { soma, falta, situacao: AGUARDANDO | PARCIAL | RECEBIDO | SOBRA } */
  function resumo(esperado, lista) {
    lista = lista || [];
    var s = soma(lista), antigo = lista.some(function (p) { return p.antigo; });
    var r = { soma: s, falta: null, situacao: "AGUARDANDO" };
    if (!lista.length) { r.falta = typeof esperado === "number" ? esperado : null; return r; }
    if (antigo || typeof esperado !== "number") { r.situacao = "RECEBIDO"; r.falta = 0; return r; }
    r.falta = Math.round((esperado - s) * 100) / 100;
    r.situacao = Math.abs(r.falta) < 0.005 ? "RECEBIDO" : r.falta > 0 ? "PARCIAL" : "SOBRA";
    if (r.situacao === "RECEBIDO") r.falta = 0;
    return r;
  }
  /* RECEBIMENTO - OUTROS (JSON) -> [{ id, rotulo, esperado, pagamentos }] */
  function lerOutros(texto) {
    var j;
    try { j = JSON.parse(txt(texto) || "[]"); } catch (e) { return []; }
    if (!Array.isArray(j)) return [];
    return j.filter(function (x) { return x && RE_ID.test(txt(x.id)) && rotuloValido(x.rotulo); }).map(function (x) {
      return { id: txt(x.id), rotulo: rotuloValido(x.rotulo), esperado: valor(x.esperado, true),
               pagamentos: lerLista(JSON.stringify(x.pagamentos || [])) };
    });
  }
  function rotuloValido(s) { var t = txt(s).replace(/\s+/g, " ").replace(/[<>"]/g, ""); return t.length >= 2 && t.length <= 40 ? t : ""; }
  /* MC - RECEBIMENTOS (JSON do robô) -> objeto, ou null */
  function lerMC(texto) {
    var t = txt(texto);
    if (!t || t.charAt(0) !== "{") return null;
    try { var j = JSON.parse(t); return j && typeof j === "object" ? j : null; } catch (e) { return null; }
  }
  /* id curto de pagamento/outro (8 letras hex) */
  function idNovo(aleatorio) {
    var s = "";
    for (var i = 0; i < 8; i++) s += "0123456789abcdef".charAt(Math.floor((aleatorio || Math.random)() * 16));
    return s;
  }
  /* nome do comprovante no Notion: "<Rótulo> <id> - <arquivo>" (o robô acha o arquivo do pagamento por ele) */
  function nomeArquivo(rotulo, pid, nome) {
    var n = txt(nome).replace(/[\\/:*?"<>|]+/g, "_") || "comprovante";
    var ext = (/\.[a-z0-9]{2,5}$/i.exec(n) || [""])[0];
    var corpo = (rotulo + " " + pid + " - " + n.slice(0, n.length - ext.length)).slice(0, 120);
    return corpo + ext;
  }
  /* texto grande numa coluna rich_text, em pedaços de 1900 */
  function textoLongo(s) {
    var t = String(s || ""), out = [];
    for (var i = 0; i < t.length; i += 1900) out.push({ type: "text", text: { content: t.slice(i, i + 1900) } });
    return out;
  }
  /* Propriedade RECEBIMENTO_EMAILS -> lista de e-mails válidos, sem repetir (vírgula, ponto e vírgula ou espaço) */
  function destinatarios(prop) {
    var vistos = {}, l = [];
    txt(prop).split(/[,;\s]+/).forEach(function (e) {
      e = txt(e).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || vistos[e]) return;
      vistos[e] = true; l.push(e);
    });
    return l;
  }
  function moedaBR(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    var c = Math.round(Math.abs(n) * 100), r = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = String(c % 100); if (cent.length < 2) cent = "0" + cent;
    return (n < 0 ? "-" : "") + "R$ " + r + "," + cent;
  }
  function dataBR(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso)); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function umaLinha(s) { return txt(s).replace(/[\r\n]+/g, " ").replace(/\s+/g, " "); }
  /* "Recebido: SINAL — OBRA — COMPRADOR" (sem obra ou comprador, a parte sai) */
  function assunto(id, obra, comprador) {
    return ["Recebido: " + txt(id).toUpperCase(), umaLinha(obra), umaLinha(comprador)].filter(function (x) { return x; }).join(" — ").slice(0, 250);
  }
  /* corpo em texto simples; x = { id, rotulo?, obra, comprador, esperado (número|null), data (iso), por, link,
     valor? (deste pagamento), soma? (total recebido) } — sem CPF */
  function corpo(x) {
    var it = item(x.id) || { rotulo: txt(x.rotulo) || txt(x.id), id: txt(x.id) };
    var linhas = ["Recebimento confirmado no portal de vendas.", "",
      "Item: " + it.rotulo,
      "Obra: " + (umaLinha(x.obra) || "—"),
      "Comprador: " + (umaLinha(x.comprador) || "—"),
      "Valor esperado (contrato): " + (moedaBR(x.esperado) || "não informado")];
    if (typeof x.valor === "number") linhas.push("Valor deste pagamento: " + moedaBR(x.valor));
    if (typeof x.soma === "number") linhas.push("Total recebido até agora: " + moedaBR(x.soma));
    linhas.push("Data do recebimento: " + (dataBR(x.data) || "—"),
      "Confirmado por: " + (umaLinha(x.por) || "—"),
      "Comprovante: " + (x.comprovante === false ? "não anexado" : "anexado na casa (coluna " + (x.colComprovante || colunas(it.id).comprovante) + ")"));
    if (/^https:\/\//.test(txt(x.link))) linhas.push("Faturamento no Mais Controle: " + txt(x.link));
    return linhas.join("\n");
  }
  var api = { ITENS: ITENS, ANTIGOS: ANTIGOS, TIPOS: TIPOS, COL: COL, item: item, outroId: outroId, colunas: colunas,
              colunasNecessarias: colunasNecessarias, colunasNovas: colunasNovas, dataValida: dataValida, valor: valor,
              lerLista: lerLista, soma: soma, resumo: resumo, lerOutros: lerOutros, rotuloValido: rotuloValido, lerMC: lerMC,
              idNovo: idNovo, nomeArquivo: nomeArquivo, textoLongo: textoLongo,
              destinatarios: destinatarios, assunto: assunto, corpo: corpo, moedaBR: moedaBR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();

/* ---- servidor (Apps Script) ---- */
function recLog_(msg) { console.log("PORTAL-VENDA recebimento " + msg); }

/* Página da casa (só VENDAS): { pg, c (por chave) } ou { erro } */
function recPagina_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  if (vendaBaseDaPagina_(pg) !== "VENDAS") return { erro: "SO_CASA" };
  return { pg: pg, c: ctrPorChave_(pg.properties) };
}
/* coluna pelo nome (tolerante a acento/caixa): { nome } ou { erro: "COLUNA_FALTANDO: X" | "TIPO_DE_COLUNA_ERRADO: X" } */
function recCol_(pg, nome, tipo) {
  var k = RegrasVenda.chave(nome);
  for (var n in pg.properties) if (RegrasVenda.chave(n) === k)
    return (pg.properties[n] || {}).type === tipo ? { nome: n } : { erro: "TIPO_DE_COLUNA_ERRADO: " + nome };
  return { erro: "COLUNA_FALTANDO: " + nome };
}
function recArquivos_(pg, nomeReal) { return nomeReal ? (ctrValor_(pg.properties[nomeReal]) || []) : []; }

/* resultado do robô (MC - RECEBIMENTOS) */
function recMC_(x) {
  var c = recCol_(x.pg, RecebimentoVenda.COL.MC, "rich_text");
  return c.nome ? RecebimentoVenda.lerMC(ctrTxt_(ctrValor_(x.pg.properties[c.nome]))) : null;
}
/* um dos quatro itens fixos, como a tela e as gravações precisam */
function recItem_(x, it, mc) {
  var c = RecebimentoVenda.colunas(it.id), pr = x.pg.properties;
  var cPag = recCol_(x.pg, c.pagamentos, "rich_text"), cData = recCol_(x.pg, c.data, "date");
  var cComp = recCol_(x.pg, c.comprovante, "files"), cPor = recCol_(x.pg, c.por, "rich_text");
  var cEsp = recCol_(x.pg, it.esperado, "number");
  var esperado = ctrNum_(ctrCampo_(x.c, it.esperado));
  var modo = cPag.nome ? "lista" : (cData.nome ? "antigo" : "");
  var data = cData.nome ? String(ctrValor_(pr[cData.nome]) || "").slice(0, 10) : "";
  var por = cPor.nome ? ctrTxt_(ctrValor_(pr[cPor.nome])).trim() : "";
  var arqs = recArquivos_(x.pg, cComp.nome);
  var lista = modo === "lista" ? RecebimentoVenda.lerLista(ctrTxt_(ctrValor_(pr[cPag.nome]))) : [];
  if (!lista.length && data)   /* confirmação do jeito antigo: um pagamento do valor esperado */
    lista = [{ id: "antigo", data: data, valor: esperado, por: por, arquivo: arqs.length ? String(arqs[arqs.length - 1].name || "") : "", antigo: true }];
  var mcItem = mc && mc.itens ? mc.itens[it.id] || null : null;
  lista.forEach(function (p) { p.mc = mcItem && mcItem.pagamentos ? mcItem.pagamentos[p.id] || null : null; });
  var rs = RecebimentoVenda.resumo(esperado, lista);
  var r = { id: it.id, rotulo: it.rotulo, esperado: esperado, editavel: !!cEsp.nome, baixaMC: it.baixaMC, modo: modo,
            pagamentos: lista, soma: rs.soma, falta: rs.falta, situacao: rs.situacao,
            data: lista.length ? lista[lista.length - 1].data : "", por: lista.length ? (lista[lista.length - 1].por || por) : "",
            comprovantes: arqs.length, aceitaArquivo: !!cComp.nome, confirmado: rs.situacao === "RECEBIDO" || rs.situacao === "SOBRA",
            mc: mcItem };
  if (!modo) r.erro = cPag.erro;
  else if (cPag.erro && /^TIPO/.test(cPag.erro)) r.erro = cPag.erro;
  else if (!cComp.nome) r.aviso = cComp.erro;
  if (!cEsp.nome) r.avisoValor = cEsp.erro;
  /* nomes reais (só para gravar; a tela não recebe) */
  Object.defineProperty(r, "_cols", { value: { pagamentos: cPag.nome, data: cData.nome, comprovante: cComp.nome, por: cPor.nome, esperado: cEsp.nome } });
  return r;
}
function recOutros_(x, mc) {
  var c = recCol_(x.pg, RecebimentoVenda.COL.OUTROS, "rich_text"), cc = recCol_(x.pg, RecebimentoVenda.COL.OUTROS_COMPROVANTE, "files");
  var lista = c.nome ? RecebimentoVenda.lerOutros(ctrTxt_(ctrValor_(x.pg.properties[c.nome]))) : [];
  var itens = lista.map(function (o) {
    var id = "OUTRO:" + o.id, mcItem = mc && mc.itens ? mc.itens[id] || null : null;
    var rs = RecebimentoVenda.resumo(o.esperado, o.pagamentos);
    return { id: id, outro: o.id, rotulo: o.rotulo, esperado: o.esperado, editavel: !!c.nome, baixaMC: false, modo: "lista",
             pagamentos: o.pagamentos, soma: rs.soma, falta: rs.falta, situacao: rs.situacao,
             data: o.pagamentos.length ? o.pagamentos[o.pagamentos.length - 1].data : "",
             por: o.pagamentos.length ? o.pagamentos[o.pagamentos.length - 1].por : "", comprovantes: 0,
             aceitaArquivo: !!cc.nome, confirmado: rs.situacao === "RECEBIDO" || rs.situacao === "SOBRA", mc: mcItem };
  });
  return { coluna: c.nome || "", colComprovante: cc.nome || "", erro: c.erro || "", lista: lista, itens: itens };
}
function recTudo_(x) {
  var mc = recMC_(x), cf = recCol_(x.pg, RecebimentoVenda.COL.CONTRATO_FIN, "files");
  return { mc: mc, itens: RecebimentoVenda.ITENS.map(function (it) { return recItem_(x, it, mc); }), outros: recOutros_(x, mc),
           contratoFin: { coluna: !!cf.nome, arquivos: recArquivos_(x.pg, cf.nome).length, erro: cf.erro || "" },
           vendaLancada: !!ctrTxt_(ctrCampo_(x.c, RecebimentoVenda.COL.VENDA_ID)).trim() };
}
/* o que a tela recebe */
function recResposta_(t) {
  var mc = t.mc ? { situacao: String(t.mc.situacao || ""), texto: String(t.mc.texto || "").slice(0, 400), em: String(t.mc.em || ""),
                    avisos: (t.mc.avisos || []).slice(0, 5) } : null;
  return { itens: t.itens, outros: t.outros.itens, outrosColuna: !!t.outros.coluna, contratoFin: t.contratoFin,
           vendaLancada: t.vendaLancada, filaLigada: roboUsaFila_(), mc: mc };
}
function recebimentoEstado_(col, p) {
  var x = recPagina_(p.pageId);
  if (x.erro) return { ok: false, erro: x.erro };
  var r = recResposta_(recTudo_(x));
  r.ok = true;
  r.emailConfigurado = RecebimentoVenda.destinatarios(prop_("RECEBIMENTO_EMAILS")).length > 0;
  return r;
}

/* Pedido ao robô do servidor (venda/mc/recebimentos.py). Só com venda lançada e fila ligada; nunca derruba a gravação
   do portal. Devolve "NA_FILA" | "NA_FILA_SEM_SINAL" | "SEM_VENDA" | "FILA_NAO_CONFIGURADA" | "FILA_FALHOU". */
function recFilaMC_(x, pageId) {
  if (!ctrTxt_(ctrCampo_(x.c, RecebimentoVenda.COL.VENDA_ID)).trim()) return "SEM_VENDA";
  if (!roboUsaFila_()) return "FILA_NAO_CONFIGURADA";
  var c = recCol_(x.pg, RecebimentoVenda.COL.MC, "rich_text");
  if (c.nome) {
    /* PROCESSANDO na frente; os itens da rodada anterior ficam (o robô usa para não baixar duas vezes) */
    var ant = recMC_(x) || {};
    var novo = { v: 1, situacao: "PROCESSANDO", texto: "pedido na fila do servidor — " + hoje_("dd/MM HH:mm"), em: ant.em || "",
                 t: Date.now(), itens: ant.itens || {} };
    var props = {}; props[c.nome] = { rich_text: RecebimentoVenda.textoLongo(JSON.stringify(novo)) };
    try { notion_("PATCH", "/pages/" + pageId, { properties: props }); } catch (e) { ctrErro_("recebimento fila anotar", e); }
  }
  var f = roboFilaPor_("mc-recebimento", { pageId: String(pageId).replace(/-/g, ""), aplicar: true });
  if (!f.ok) return "FILA_FALHOU";
  return roboAvisoSinal_(f.sinal, Date.now()) ? "NA_FILA_SEM_SINAL" : "NA_FILA";
}

/* o item pedido (fixo ou "OUTRO:<id>") dentro de recTudo_ */
function recAchar_(t, id) {
  var o = RecebimentoVenda.outroId(id);
  if (o) { for (var i = 0; i < t.outros.itens.length; i++) if (t.outros.itens[i].outro === o) return t.outros.itens[i]; return null; }
  for (var j = 0; j < t.itens.length; j++) if (t.itens[j].id === String(id || "").toUpperCase()) return t.itens[j];
  return null;
}
function recAlvoValido_(id) { return !!(RecebimentoVenda.item(id) || RecebimentoVenda.outroId(id)); }
function recTravado_(fn) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) return { ok: false, erro: "RECEBIMENTO_OCUPADO" };
  try { return fn(); } finally { trava.releaseLock(); }
}
/* os pagamentos do item como se gravam; a confirmação antiga (entrega 14) vira o pagamento "antigo" do valor esperado
   (o robô usa o mesmo id), e sem valor esperado ela não entra */
function recListaGravavel_(it) {
  return it.pagamentos.filter(function (q) { return !q.antigo || typeof q.valor === "number"; }).map(function (q) {
    return { id: q.id, data: q.data, valor: q.valor, por: q.por || "", arquivo: q.arquivo || "", em: q.em || "" }; });
}
/* grava a lista de pagamentos do item (fixo: a coluna dele; outro: a lista inteira de OUTROS) */
function recGravarLista_(pageId, t, it, lista) {
  var props = {};
  if (it.outro) {
    var outros = t.outros.lista.map(function (o) { return o.id === it.outro ? { id: o.id, rotulo: o.rotulo, esperado: o.esperado, pagamentos: lista } : o; });
    props[t.outros.coluna] = { rich_text: RecebimentoVenda.textoLongo(JSON.stringify(outros)) };
  } else {
    var cs = it._cols;
    props[cs.pagamentos] = { rich_text: RecebimentoVenda.textoLongo(JSON.stringify(lista.map(function (p) {
      return { id: p.id, data: p.data, valor: p.valor, por: p.por || "", arquivo: p.arquivo || "", em: p.em || "" };
    }))) };
    /* compatível com quem lê a coluna antiga (mapa de vendas): DATA = 1º pagamento; POR = quem registrou o último */
    if (cs.data) props[cs.data] = propNotion_("date", lista.length ? lista[0].data : "");
    if (cs.por && lista.length) props[cs.por] = propNotion_("rich_text", lista[lista.length - 1].por || "");
  }
  notion_("PATCH", "/pages/" + pageId, { properties: props });
}

/* p = { item: SINAL|ENTRADA|FINANCIAMENTO|FGTS|OUTRO:<id>, data: "aaaa-mm-dd", valor?, arquivo?: {nome, mime, base64},
         pagamento?: id (corrigir um pagamento já registrado) }.
   Comprovante opcional (dono, 08/10). Sem valor: o que falta do esperado. */
function recebimentoConfirmar_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  if (!recAlvoValido_(p.item)) return { ok: false, erro: "ITEM_INVALIDO" };
  if (!RecebimentoVenda.dataValida(p.data, hoje_("yyyy-MM-dd"))) return { ok: false, erro: "DATA_INVALIDA" };
  if (p.valor !== undefined && p.valor !== null && p.valor !== "" && RecebimentoVenda.valor(p.valor) === null) return { ok: false, erro: "VALOR_INVALIDO" };
  if (p.arquivo) {
    var chk = RegrasVenda.conferirArquivo(p.arquivo);
    if (!chk.ok) return { ok: false, erro: chk.erro };
  }
  var r = recTravado_(function () { return recConfirmarTravado_(p, sess, pid); });
  recLog_("confirmar " + pid + " " + (RecebimentoVenda.outroId(p.item) ? "OUTRO" : String(p.item).toUpperCase()) + " por " +
          String((sess && sess.u) || "?") + ": " + (r.ok ? "ok" + (r.aviso ? " " + r.aviso : "") + (r.mcPedido ? " mc " + r.mcPedido : "") : r.erro));
  return r;
}
function recConfirmarTravado_(p, sess, pid) {
  var x = recPagina_(p.pageId);
  if (x.erro) return { ok: false, erro: x.erro };
  var t = recTudo_(x), it = recAchar_(t, p.item);
  if (!it) return { ok: false, erro: "ITEM_INVALIDO" };
  if (it.erro) return { ok: false, erro: it.erro };
  var colComp = it.outro ? t.outros.colComprovante : it._cols.comprovante;
  if (p.arquivo && !colComp) return { ok: false, erro: it.outro ? "COLUNA_FALTANDO: " + RecebimentoVenda.COL.OUTROS_COMPROVANTE : it.aviso };
  var por = ctrTxt_(sess && sess.u).trim(), guardado = false, valorPag = null, somaDepois = null;
  var jaTemComprovante = recArquivos_(x.pg, colComp).length > 0;

  if (it.modo === "antigo") {
    /* entrega 14, sem a coluna PAGAMENTOS: uma confirmação (data + comprovante + login) */
    if (p.arquivo) {
      try { anexarArquivo_(p.pageId, colComp, p.arquivo, false); guardado = true; }
      catch (e) { ctrErro_("recebimento " + pid + " upload", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    }
    var props = {};
    props[it._cols.data] = propNotion_("date", p.data);
    if (it._cols.por) props[it._cols.por] = propNotion_("rich_text", por);
    try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); }
    catch (e) { ctrErro_("recebimento " + pid + " gravacao", e); return { ok: false, erro: "GRAVACAO_FALHOU", arquivoGuardado: guardado }; }
  } else {
    var lista = recListaGravavel_(it);
    var alvo = null;
    if (p.pagamento) {
      for (var i = 0; i < lista.length; i++) if (lista[i].id === String(p.pagamento)) alvo = lista[i];
      if (!alvo) return { ok: false, erro: "PAGAMENTO_NAO_ENCONTRADO" };
      var st = (it.mc && it.mc.pagamentos && it.mc.pagamentos[alvo.id]) || {};
      if (st.situacao === "BAIXADO") return { ok: false, erro: "JA_BAIXADO_NO_MC" };
    }
    valorPag = RecebimentoVenda.valor(p.valor);
    if (valorPag === null) valorPag = alvo ? alvo.valor : (typeof it.falta === "number" && it.falta > 0 ? it.falta : null);
    if (valorPag === null) return { ok: false, erro: "VALOR_INVALIDO" };
    if (!alvo) {
      alvo = { id: RecebimentoVenda.idNovo(), data: p.data, valor: valorPag, por: por, arquivo: "", em: new Date().toISOString() };
      lista.push(alvo);
    }
    alvo.data = p.data; alvo.valor = valorPag; alvo.por = por;
    if (p.arquivo) {
      var nome = RecebimentoVenda.nomeArquivo(it.rotulo, alvo.id, p.arquivo.nome);
      try { anexarArquivo_(p.pageId, colComp, { nome: nome, mime: p.arquivo.mime, base64: p.arquivo.base64 }, false); guardado = true; alvo.arquivo = nome; }
      catch (e) { ctrErro_("recebimento " + pid + " upload", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    }
    lista.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : (a.id < b.id ? -1 : 1); });
    try { recGravarLista_(p.pageId, t, it, lista); }
    catch (e) { ctrErro_("recebimento " + pid + " gravacao", e); return { ok: false, erro: "GRAVACAO_FALHOU", arquivoGuardado: guardado }; }
    somaDepois = RecebimentoVenda.soma(lista);
  }

  var resp = { ok: true };
  var dest = RecebimentoVenda.destinatarios(prop_("RECEBIMENTO_EMAILS"));
  if (!dest.length) resp.aviso = "EMAIL_NAO_CONFIGURADO";
  else {
    var obra = ClicksignVenda.nomePadrao(ctrTitulo_(x.pg.properties), ctrTxt_(ctrCampo_(x.c, "CASA")), "");
    var comprador = ContratoVenda.nomeComprador1(ctrTxt_(ctrCampo_(x.c, RegrasVenda.COL.CLIENTES)), ctrTxt_(ctrCampo_(x.c, RegrasVenda.COL.C2_NOME)));
    /* o comprovante vai anexado no e-mail (dono, 08/10): o enviado agora ou, sem ele, o último já guardado na casa */
    var anexos = [];
    try {
      if (p.arquivo && p.arquivo.base64) anexos.push(Utilities.newBlob(Utilities.base64Decode(p.arquivo.base64), p.arquivo.mime, p.arquivo.nome));
      else if (jaTemComprovante && it.modo === "antigo") {
        var fs = recArquivos_(x.pg, colComp), b = baixarArquivo_(fs[fs.length - 1]);
        if (b && b.base64) anexos.push(Utilities.newBlob(Utilities.base64Decode(b.base64), b.mime, (fs[fs.length - 1] || {}).name || "comprovante"));
      }
    } catch (eAnx) { ctrErro_("recebimento " + pid + " anexo do e-mail", eAnx); }
    var vid = ctrTxt_(ctrCampo_(x.c, RecebimentoVenda.COL.VENDA_ID)).trim();
    try {
      MailApp.sendEmail({ to: dest.join(","), subject: RecebimentoVenda.assunto(it.outro ? it.rotulo : it.id, obra, comprador), attachments: anexos,
                          body: RecebimentoVenda.corpo({ id: it.outro ? "" : it.id, rotulo: it.rotulo, obra: obra, comprador: comprador,
                                                         esperado: it.esperado, data: p.data, por: por,
                                                         valor: valorPag === null ? undefined : valorPag, soma: somaDepois === null ? undefined : somaDepois,
                                                         colComprovante: it.outro ? RecebimentoVenda.COL.OUTROS_COMPROVANTE : undefined,
                                                         comprovante: !!(p.arquivo || (it.modo === "antigo" && jaTemComprovante)),
                                                         /* link do faturamento no Mais Controle (dono, 08/10); sem venda lançada, sem link */
                                                         link: vid ? "https://acessar.maiscontroleerp.com.br/#/readjustment-sale/edit/" + encodeURIComponent(vid) : "" }) });
      resp.emails = dest.length;
    } catch (e) { ctrErro_("recebimento " + pid + " e-mail", e); resp.aviso = "EMAIL_FALHOU"; }
  }
  /* 05/11: sinal/entrada pagos -> o robô dá baixa no Mais Controle */
  if (it.baixaMC) {
    try { resp.mcPedido = recFilaMC_(recPagina_(p.pageId), p.pageId); } catch (e) { ctrErro_("recebimento " + pid + " fila", e); resp.mcPedido = "FILA_FALHOU"; }
  }
  try { var t2 = recResposta_(recTudo_(recPagina_(p.pageId))); resp.itens = t2.itens; resp.outros = t2.outros; resp.mc = t2.mc; }
  catch (e) { ctrErro_("recebimento " + pid + " releitura", e); }
  return resp;
}

/* p = { item, pagamento } — tira um pagamento registrado por engano. Baixado no Mais Controle não sai daqui. */
function recebimentoRemover_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  if (!recAlvoValido_(p.item)) return { ok: false, erro: "ITEM_INVALIDO" };
  var r = recTravado_(function () {
    var x = recPagina_(p.pageId);
    if (x.erro) return { ok: false, erro: x.erro };
    var t = recTudo_(x), it = recAchar_(t, p.item);
    if (!it) return { ok: false, erro: "ITEM_INVALIDO" };
    if (it.erro || it.modo !== "lista") return { ok: false, erro: it.erro || "SO_COM_LISTA" };
    var st = (it.mc && it.mc.pagamentos && it.mc.pagamentos[String(p.pagamento)]) || {};
    if (st.situacao === "BAIXADO") return { ok: false, erro: "JA_BAIXADO_NO_MC" };
    var lista = recListaGravavel_(it);
    var resto = lista.filter(function (q) { return q.id !== String(p.pagamento); });
    if (resto.length === lista.length) return { ok: false, erro: "PAGAMENTO_NAO_ENCONTRADO" };
    try { recGravarLista_(p.pageId, t, it, resto); }
    catch (e) { ctrErro_("recebimento " + pid + " remover", e); return { ok: false, erro: "GRAVACAO_FALHOU" }; }
    var t2 = recResposta_(recTudo_(recPagina_(p.pageId)));
    return { ok: true, itens: t2.itens, outros: t2.outros, mc: t2.mc };
  });
  recLog_("remover " + pid + ": " + (r.ok ? "ok" : r.erro));
  return r;
}

/* p = { item, valor } — valor esperado editado na aba (grava a coluna de origem). Com item "OUTRO" (sem id) e rotulo:
   cria um item de recebimento novo; "OUTRO:<id>" + rotulo/valor: corrige. Sinal/financiamento/FGTS mudados -> robô. */
function recebimentoValor_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8), novoOutro = String(p.item || "").toUpperCase() === "OUTRO";
  if (!novoOutro && !recAlvoValido_(p.item)) return { ok: false, erro: "ITEM_INVALIDO" };
  var v = RecebimentoVenda.valor(p.valor, true);
  if (v === null && !(novoOutro || RecebimentoVenda.outroId(p.item)) ) return { ok: false, erro: "VALOR_INVALIDO" };
  var r = recTravado_(function () {
    var x = recPagina_(p.pageId);
    if (x.erro) return { ok: false, erro: x.erro };
    var t = recTudo_(x), props = {}, it = null;
    if (novoOutro || RecebimentoVenda.outroId(p.item)) {
      if (!t.outros.coluna) return { ok: false, erro: t.outros.erro || "COLUNA_FALTANDO: " + RecebimentoVenda.COL.OUTROS };
      var rot = RecebimentoVenda.rotuloValido(p.rotulo);
      var lista = t.outros.lista.slice();
      if (novoOutro) {
        if (!rot) return { ok: false, erro: "ROTULO_INVALIDO" };
        if (lista.length >= 10) return { ok: false, erro: "OUTROS_DEMAIS" };
        lista.push({ id: RecebimentoVenda.idNovo(), rotulo: rot, esperado: v, pagamentos: [] });
      } else {
        it = recAchar_(t, p.item);
        if (!it) return { ok: false, erro: "ITEM_INVALIDO" };
        lista = lista.map(function (o) { return o.id === it.outro ? { id: o.id, rotulo: rot || o.rotulo, esperado: v, pagamentos: o.pagamentos } : o; });
      }
      props[t.outros.coluna] = { rich_text: RecebimentoVenda.textoLongo(JSON.stringify(lista)) };
    } else {
      it = recAchar_(t, p.item);
      if (!it.editavel) return { ok: false, erro: it.avisoValor || "COLUNA_FALTANDO: " + RecebimentoVenda.item(it.id).esperado };
      props[it._cols.esperado] = propNotion_("number", v);
    }
    try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); }
    catch (e) { ctrErro_("recebimento " + pid + " valor", e); return { ok: false, erro: "GRAVACAO_FALHOU" }; }
    var resp = { ok: true };
    if (it && !it.outro && it.id !== "ENTRADA") {
      try { resp.mcPedido = recFilaMC_(recPagina_(p.pageId), p.pageId); } catch (e) { resp.mcPedido = "FILA_FALHOU"; }
    }
    var t2 = recResposta_(recTudo_(recPagina_(p.pageId)));
    resp.itens = t2.itens; resp.outros = t2.outros; resp.mc = t2.mc;
    return resp;
  });
  recLog_("valor " + pid + " " + (novoOutro || RecebimentoVenda.outroId(p.item) ? "OUTRO" : String(p.item).toUpperCase()) + ": " +
          (r.ok ? "ok" + (r.mcPedido ? " mc " + r.mcPedido : "") : r.erro));
  return r;
}

/* p = { arquivo?: {nome, mime, base64} } — contrato de financiamento: guarda (se veio), lê pela IA e TROCA VALOR FINANCIADO,
   VALOR DO FGTS e VALOR DO SUBSÍDIO pelo que o contrato diz (RegrasVenda.planejarGravacao "FIN_CONTRATO"). Depois o robô
   acerta as parcelas no Mais Controle. Sem arquivo: lê o último já guardado. */
function recebimentoLerContratoFin_(col, sess, p) {
  var pid = String(p.pageId).slice(0, 8);
  if (p.arquivo) {
    var chk = RegrasVenda.conferirArquivo(p.arquivo);
    if (!chk.ok) return { ok: false, erro: chk.erro };
  }
  var r = recTravado_(function () { return recLerContratoFinTravado_(p, pid); });
  recLog_("contrato de financiamento " + pid + ": " + (r.ok ? "ok " + (r.preenchidos || []).length + " campo(s)" + (r.mcPedido ? " mc " + r.mcPedido : "") : r.erro));
  return r;
}
function recLerContratoFinTravado_(p, pid) {
  var R = RegrasVenda, x = recPagina_(p.pageId);
  if (x.erro) return { ok: false, erro: x.erro };
  var cf = recCol_(x.pg, RecebimentoVenda.COL.CONTRATO_FIN, "files");
  if (!cf.nome) return { ok: false, erro: cf.erro };
  var parte = null, guardado = false;
  if (p.arquivo) {
    var ext = (/\.[a-z0-9]{2,5}$/i.exec(String(p.arquivo.nome || "")) || [".pdf"])[0];
    try { anexarArquivo_(p.pageId, cf.nome, { nome: "Contrato de financiamento " + hoje_("yyyy-MM-dd") + ext, mime: p.arquivo.mime, base64: p.arquivo.base64 }, false); guardado = true; }
    catch (e) { ctrErro_("contrato fin " + pid + " upload", e); return { ok: false, erro: "UPLOAD_FALHOU" }; }
    parte = { mime: p.arquivo.mime, base64: p.arquivo.base64 };
  } else {
    var fs = recArquivos_(x.pg, cf.nome);
    if (!fs.length) return { ok: false, erro: "SEM_ARQUIVO" };
    parte = baixarArquivo_(fs[fs.length - 1]);
    if (!parte || !R.conferirArquivo(parte).ok) return { ok: false, erro: "ARQUIVO_NAO_LEGIVEL" };
  }
  var ia = leitorIA_();
  if (ia.erro) return { ok: false, erro: ia.erro, arquivoGuardado: guardado };
  var pedido = ia.leitor.montarPedido("contrato_financiamento", [parte], ia.chave, ia.modelo, "");
  if (pedido.erro) return { ok: false, erro: pedido.erro, arquivoGuardado: guardado };
  var res;
  try {
    var resp = UrlFetchApp.fetch(pedido.url, { method: "post", contentType: "application/json", muteHttpExceptions: true,
                                               headers: pedido.headers, payload: JSON.stringify(pedido.corpo) });
    res = ia.leitor.interpretarResposta(resp.getResponseCode(), resp.getContentText());
  } catch (e) { res = { ok: false, erro: "LEITURA_FALHOU" }; }
  if (!res.ok) return { ok: false, erro: res.erro, arquivoGuardado: guardado };
  var C = R.COL, atuais = {}, reais = {};
  [C.FINANCIADO, C.FGTS, C.SUBSIDIO].forEach(function (nome) {
    var c = recCol_(x.pg, nome, "number");
    if (c.nome) { reais[nome] = c.nome; atuais[nome] = ctrNum_(ctrValor_(x.pg.properties[c.nome])); }
  });
  var plano = R.planejarGravacao("FIN_CONTRATO", res.leitura, atuais, hoje_("yyyy-MM-dd"), "atualizar");
  var props = {}, gravados = [], obs = plano.observacoes.slice();
  for (var nome in plano.props) {
    if (!reais[nome]) { obs.push("a base não tem a coluna " + nome + " (número) — não gravado"); continue; }
    props[reais[nome]] = propNotion_("number", plano.props[nome]);
    gravados.push(nome);
  }
  if (gravados.length) {
    try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); }
    catch (e) { ctrErro_("contrato fin " + pid + " gravacao", e); return { ok: false, erro: "GRAVACAO_FALHOU", arquivoGuardado: guardado }; }
  }
  var out = { ok: true, preenchidos: gravados, observacoes: obs, contratoFin: plano.contratoFin || null, arquivoGuardado: guardado,
              tipoLido: String(res.leitura && res.leitura.tipo_documento || "") };
  if (gravados.length) {
    try { out.mcPedido = recFilaMC_(recPagina_(p.pageId), p.pageId); } catch (e) { out.mcPedido = "FILA_FALHOU"; }
  }
  var t2 = recResposta_(recTudo_(recPagina_(p.pageId)));
  out.itens = t2.itens; out.outros = t2.outros; out.mc = t2.mc; out.contratoFinEstado = t2.contratoFin;
  return out;
}

/* "Conferir no Mais Controle": põe o pedido na fila de novo (sem mudar nada no portal) */
function recebimentoMC_(col, sess, p) {
  var x = recPagina_(p.pageId);
  if (x.erro) return { ok: false, erro: x.erro };
  var m = recFilaMC_(x, p.pageId);
  recLog_("mc " + String(p.pageId).slice(0, 8) + ": " + m);
  if (m === "SEM_VENDA") return { ok: false, erro: "MC_SEM_VENDA" };
  if (m === "FILA_NAO_CONFIGURADA") return { ok: false, erro: "FILA_NAO_CONFIGURADA" };
  if (m === "FILA_FALHOU") return { ok: false, erro: "MC_DISPARO_FALHOU" };
  var t2 = recResposta_(recTudo_(recPagina_(p.pageId)));
  return { ok: true, mcPedido: m, itens: t2.itens, outros: t2.outros, mc: t2.mc };
}

/* Rodar UMA vez no editor de cada projeto PORTAL-VENDA (selecionar autorizarEmailRecebimento › Executar ›
   autorizar): o Apps Script só pede a permissão de enviar e-mail (MailApp) quando uma função que usa o MailApp
   roda no editor. Não envia nada; mostra no registro a cota do dia e quantos destinatários a Propriedade tem. */
function autorizarEmailRecebimento() {
  var cota = MailApp.getRemainingDailyQuota();
  var n = RecebimentoVenda.destinatarios(prop_("RECEBIMENTO_EMAILS")).length;
  console.log("ok    MailApp autorizado — cota de e-mails hoje: " + cota);
  console.log(n ? "ok    RECEBIMENTO_EMAILS: " + n + " destinatário(s)." : "AVISO RECEBIMENTO_EMAILS vazia: o recebimento grava, mas não manda e-mail.");
  return { cota: cota, destinatarios: n };
}
