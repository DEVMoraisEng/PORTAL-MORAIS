/* FilaRobo — pedidos ao robô do SERVIDOR do escritório (27/10/2026, plano "robôs no servidor").
 *
 * Por quê: os robôs que falam com o Mais Controle rodavam no GitHub e faziam login a cada execução —
 * o ERP aceita uma sessão por usuário (cada login derruba a do servidor) e o código de aparelho do
 * robô vence a cada ~30 dias. No servidor, o robô usa a aba do Chrome do porteiro, já logado.
 *
 * Como: o pedido vira uma LINHA numa base do Notion (Propriedade DB_FILA_ROBO). O servidor consulta
 * a base a cada minuto, roda o pedido e marca FEITO/ERRO. Nenhuma porta aberta, nenhum segredo novo:
 * os dois lados já falam com o Notion. A mesma base guarda a linha SINAL, que o servidor atualiza a
 * cada minuto — é por ela que a tela sabe se o servidor está vivo.
 *
 * Liga/desliga: com DB_FILA_ROBO preenchida, os pedidos vão para a fila; vazia, continuam indo para o
 * GitHub como antes (plano B). Este arquivo serve aos dois projetos (PORTAL-VENDA e o portal): só usa
 * prop_ e notion_(method, path, body), que existem nos dois. */
var FILA_ROBO = {
  TITULO: "PEDIDO", TIPO: "TIPO", PAYLOAD: "PAYLOAD", SITUACAO: "SITUAÇÃO",
  PEDIDO_EM: "PEDIDO EM", SINAL: "SINAL",
  /* o servidor dá sinal a cada minuto; passado isto sem sinal, a tela avisa */
  SINAL_VELHO_MS: 5 * 60 * 1000
};

/* Linha nova da fila (pura: testada no node). tipo: "mc-venda" | "robos-mc" | ...; payload: objeto simples. */
function roboFilaProps_(tipo, payload, agoraIso) {
  var p = {}, json = JSON.stringify(payload || {});
  var alvo = payload && payload.pageId ? " " + String(payload.pageId).replace(/-/g, "").slice(0, 8) : "";
  p[FILA_ROBO.TITULO] = { title: [{ type: "text", text: { content: tipo + alvo } }] };
  p[FILA_ROBO.TIPO] = { select: { name: tipo } };
  p[FILA_ROBO.PAYLOAD] = { rich_text: [{ type: "text", text: { content: json.slice(0, 2000) } }] };
  p[FILA_ROBO.SITUACAO] = { select: { name: "PENDENTE" } };
  p[FILA_ROBO.PEDIDO_EM] = { date: { start: agoraIso } };
  return p;
}

/* Sinal velho (ou nenhum) = servidor desligado, sem internet ou robô parado. */
function roboSinalVelho_(ultimoIso, agoraMs) {
  var t = Date.parse(String(ultimoIso || ""));
  return !(t > 0) || agoraMs - t > FILA_ROBO.SINAL_VELHO_MS;
}

function roboUsaFila_() { return !!String(prop_("DB_FILA_ROBO") || "").trim(); }

/* Põe o pedido na fila. { ok, sinal: ISO do último sinal do servidor ou "" } ou { ok:false, erro } */
function roboFilaPor_(tipo, payload) {
  var db = String(prop_("DB_FILA_ROBO") || "").trim();
  if (!db) return { ok: false, erro: "FILA_NAO_CONFIGURADA" };
  try {
    notion_("POST", "/pages", { parent: { database_id: db }, properties: roboFilaProps_(tipo, payload, new Date().toISOString()) });
  } catch (e) {
    console.error("FILA ROBO: não consegui pôr na fila — " + String(e).slice(0, 200));
    return { ok: false, erro: "FILA_FALHOU" };
  }
  return { ok: true, sinal: roboUltimoSinal_() };
}

/* Última vez que o servidor deu sinal (a linha TIPO = SINAL). "" se nunca. */
function roboUltimoSinal_() {
  var db = String(prop_("DB_FILA_ROBO") || "").trim();
  if (!db) return "";
  try {
    var r = notion_("POST", "/databases/" + db + "/query",
                    { filter: { property: FILA_ROBO.TIPO, select: { equals: FILA_ROBO.SINAL } }, page_size: 1 });
    var l = (r && r.results || [])[0];
    var d = l && l.properties && l.properties[FILA_ROBO.PEDIDO_EM];
    return (d && d.date && d.date.start) || "";
  } catch (e) { return ""; }
}

/* Texto curto para a tela: "" se o servidor está vivo; senão o aviso. */
function roboAvisoSinal_(ultimoIso, agoraMs) {
  if (!roboSinalVelho_(ultimoIso, agoraMs)) return "";
  if (!ultimoIso) return " — o servidor ainda não deu sinal (o pedido espera na fila)";
  var d = new Date(Date.parse(ultimoIso));
  return " — o servidor não dá sinal desde " + Utilities.formatDate(d, "America/Sao_Paulo", "dd/MM HH:mm") + " (o pedido espera na fila)";
}
