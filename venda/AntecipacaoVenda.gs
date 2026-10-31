/* Antecipação (spec v2, 31/10/2026): estado, pedir o retrato ao robô e gerar o PDF para o cliente.
   1ª metade: nada é gravado no ERP. A conta é Antecipacao.js (carregado ANTES deste arquivo), refeita aqui antes do PDF:
   o servidor nunca confia em número calculado pela tela.

   Colunas na linha da VENDAS CONDOMÍNIO (o robô escreve; o portal só lê, e só mexe em MC - RETRATO EM ao pedir leitura):
     MC - RETRATO     JSON do retrato (ou "ERRO: motivo" só quando nunca houve retrato bom). O retrato bom nunca é apagado.
     MC - RETRATO EM  "aaaa-mm-dd hh:mm" da última leitura boa, opcionalmente seguido de
                      " | ERRO aaaa-mm-dd hh:mm: motivo" ou " | PROCESSANDO [t=ms]".
   lido = os 16 primeiros caracteres de MC - RETRATO EM; velho = o mês de lido ≠ o mês de hoje (America/Sao_Paulo).
   Base DB_ANTECIPACOES (Propriedade do script): uma linha por PDF gerado, Situação "Simulada". */
var ANT_OBRA = "CONDOMÍNIO RESERVA DOS IPÊS";
var ANT_COL_RETRATO = "MC - RETRATO";
var ANT_COL_EM = "MC - RETRATO EM";
var ANT_COL_PDF = "PDF ENVIADO";
var ANT_JEITOS = { A: "Pagar as próximas", B: "Diminuir todas", C: "Terminar antes", D: "Quitar uma parcela", E: "Quitar as pós-chaves" };
var ANT_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/* ---------- leitura da linha ---------- */
function antCampo_(props, nome) {
  var c = mcColunaReal_(props, nome);
  if (!c) return "";
  var v = valorProp_(props[c.nome]);
  if (Array.isArray(v)) return v.length ? "sim" : "";
  return v == null ? "" : String(v);
}

/* A linha crua: base, id da venda no ERP, fiador e os dois textos do retrato. Nunca lança por coluna faltando. */
function antLer_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null), props = pg.properties || {};
  var cr = mcColunaReal_(props, ANT_COL_RETRATO), ce = mcColunaReal_(props, ANT_COL_EM);
  return { pg: pg, props: props, base: vendaBaseDaPagina_(pg),
           vendaId: antCampo_(props, MC_COL_VENDA).trim(), temFiador: !!antCampo_(props, "FIADOR 1").trim(),
           colEm: ce ? ce.nome : "", temColunas: !!(cr && ce && cr.tipo === "rich_text" && ce.tipo === "rich_text"),
           txt: antCampo_(props, ANT_COL_RETRATO), em: antCampo_(props, ANT_COL_EM) };
}

/* Lê os dois textos: { lido, processando, erroRobo, retrato (obj ou null) }. */
function antInterpretar_(a, agora) {
  var em = String(a.em || ""), txt = String(a.txt || "").trim();
  var o = { lido: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(em) ? em.slice(0, 16) : "", processando: false, erroRobo: "", retrato: null };
  var t = /PROCESSANDO \[t=(\d+)\]/.exec(em);
  o.processando = !!t && (agora - Number(t[1])) < MC_PRAZO_MS;
  var e = /\|\s*ERRO([\s\S]*)$/.exec(em);
  if (e) o.erroRobo = e[1].trim();
  if (/^ERRO/.test(txt)) { if (!o.erroRobo) o.erroRobo = txt.replace(/^ERRO:?\s*/, "").trim(); }
  else if (/^\{/.test(txt)) {
    try { o.retrato = JSON.parse(txt); } catch (err) { o.erroRobo = o.erroRobo || "RETRATO_ILEGIVEL"; }
    if (o.retrato && !Array.isArray(o.retrato.parcelas)) { o.retrato = null; o.erroRobo = o.erroRobo || "RETRATO_ILEGIVEL"; }
  }
  return o;
}

function antEstadoDe_(a, agora) {
  var base = { ok: true, temFiador: a.temFiador };
  /* pode:false leva os mesmos campos de estado, para a tela nunca receber undefined */
  var nao = { pode: false, velho: true, processando: false, lido: "" };
  if (a.base !== "CONDOMINIO") return Object.assign(base, nao, { motivo: "Só venda do " + ANT_OBRA });
  if (!a.vendaId) return Object.assign(base, nao, { motivo: "A venda ainda não foi lançada no Mais Controle" });
  if (!a.temColunas) return Object.assign(base, nao, { motivo: "Faltam as colunas " + ANT_COL_RETRATO + " e " + ANT_COL_EM + " (texto) na base das vendas do condomínio" });
  var i = antInterpretar_(a, agora);
  base.pode = true; base.lido = i.lido; base.processando = i.processando;
  base.velho = !i.retrato || !i.lido || i.lido.slice(0, 7) !== hoje_("yyyy-MM");
  if (i.retrato) base.retrato = i.retrato;
  if (i.erroRobo) base.erroRobo = i.erroRobo;
  return base;
}

function antecipacaoEstado_(col, p) {
  return antEstadoDe_(antLer_(p.pageId), Date.now());
}

/* ---------- pedir leitura ao robô ---------- */
function antTexto_(s) { return s ? [{ type: "text", text: { content: s } }] : []; }

function antecipacaoLer_(col, sess, p) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "RETRATO_PROCESSANDO" };
  try {
    var a = antLer_(p.pageId), agora = Date.now(), e = antEstadoDe_(a, agora);
    if (!e.pode) return { ok: false, erro: "NAO_PODE", motivo: e.motivo };
    if (!roboUsaFila_()) return { ok: false, erro: "FILA_NAO_CONFIGURADA" };
    if (e.processando) return { ok: false, erro: "RETRATO_PROCESSANDO" };
    /* PROCESSANDO vai SÓ na coluna da hora, depois da última leitura boa; o retrato bom fica onde está */
    var antigo = antInterpretar_(a, agora).lido, props = {};
    props[a.colEm] = { rich_text: antTexto_((antigo ? antigo + " | " : "") + "PROCESSANDO [t=" + agora + "]") };
    notion_("PATCH", "/pages/" + p.pageId, { properties: props });
    var f = roboFilaPor_("mc-retrato", { pageId: String(p.pageId).replace(/-/g, "") });
    if (!f.ok) {   // o pedido não entrou na fila: devolve a coluna como estava
      props[a.colEm] = { rich_text: antTexto_(a.em) };
      try { notion_("PATCH", "/pages/" + p.pageId, { properties: props }); } catch (err) {}
      return { ok: false, erro: f.erro };
    }
    var aviso = roboAvisoSinal_(f.sinal, Date.now());
    console.log("PORTAL-VENDA antecipacaoLer " + String(p.pageId).slice(0, 8) + " (fila)");
    return { ok: true, fila: true, semSinal: !!aviso };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- formatos ---------- */
function antArred_(x) { return Math.round((Number(x) + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
function antBRL_(n) {
  var s = antArred_(n).toFixed(2).split(".");
  return "R$ " + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + s[1];
}
function antNum_(n) { return antBRL_(n).slice(3); }
function antDataBR_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? m[3] + "/" + m[2] + "/" + m[1] : "";   // data fora do formato nunca vai para o PDF nem para o texto
}
function antMesAno_(iso) {
  var m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
  return m && ANT_MESES[Number(m[2]) - 1] ? ANT_MESES[Number(m[2]) - 1] + "/" + m[1] : "";
}
function antEsc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/* último dia do mês de hoje, "aaaa-mm-dd" (fuso de São Paulo) */
function antFimDoMes_() {
  var h = hoje_("yyyy-MM-dd").split("-"), y = Number(h[0]), m = Number(h[1]);
  var d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return h[0] + "-" + h[1] + "-" + (d < 10 ? "0" : "") + d;
}
function antDiasEntre_(deIso, ateIso) {
  var a = String(deIso).split("-"), b = String(ateIso).split("-");
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}
function antSoma_(l, campo) { return antArred_(l.reduce(function (s, x) { return s + x[campo]; }, 0)); }
function antUnidade_(props) {
  for (var k in props) if (props[k] && props[k].type === "title") return String(valorProp_(props[k]) || "").trim();
  return "";
}

/* ---------- PDF ---------- */
function antAlvoDe_(res, parcelaId) {
  return (res.depois || []).filter(function (x) { return x.id === parcelaId; })[0] || null;
}

/* decisão 5 do dono: a simulação vale até o fim do mês OU até sair o novo índice de correção, o que vier primeiro */
function antValidade_() { return "válida até " + antDataBR_(antFimDoMes_()) + " ou até a publicação do novo índice, o que vier primeiro"; }

/* soma das parcelas vencidas que ficam fora da conta (0 quando não há) */
function antVencidas_(sit) { return antSoma_((sit && sit.vencidas) || [], "valor"); }

/* O que mudou, em palavras para o cliente: { frases: [...], contrato: {contrato, correcao, hoje} ou null } */
function antExplicar_(e, res, parcelaId, sit) {
  var quitadas = res.depois.filter(function (x) { return x.acao === "quita"; });
  var frases = [], contrato = null;
  if (res.modo === "A") frases.push("As parcelas são pagas na ordem do vencimento, começando pela mais próxima. As do fim do fluxo ficam como estão.");
  else if (res.modo === "B") frases.push("Todas as parcelas que faltam diminuem na mesma proporção. As datas continuam as mesmas.");
  else if (res.modo === "C") frases.push("As parcelas são pagas de trás para frente. As do começo ficam como estão e o pagamento termina antes.");
  else if (res.modo === "D") {
    var alvo = antAlvoDe_(res, parcelaId);
    var nome = alvo && alvo.tipo === "balao" ? "balão" : "parcela";
    if (alvo && alvo.acao === "quita") frases.push("Quitação do " + nome + " de " + antDataBR_(alvo.data) + ". Pagando agora, ele para de corrigir.");
    else if (alvo) frases.push("Pagamento de parte do " + nome + " de " + antDataBR_(alvo.data) + ". Ele continua na mesma data e fica em " + antBRL_(alvo.valor) + " hoje (segue corrigido daqui para frente).");
  } else if (res.modo === "E") {
    var n = quitadas.length, todas = n === sit.posAbertas;
    frases.push((todas ? "Quitação das " + n + " parcelas depois das chaves" : "Quitação das últimas " + n + " parcelas depois das chaves") +
                ". Cada uma sai pelo valor de hoje e você não paga os juros dos meses que faltam." +
                (todas ? " Depois das chaves não fica nada a pagar." : " As primeiras continuam nas datas de sempre."));
  }
  if ((res.modo === "D" || res.modo === "E") && quitadas.length) {
    var raw = antSoma_(quitadas, "rawAntes"), hoje = antSoma_(quitadas, "valorAntes");
    contrato = { contrato: raw, correcao: antArred_(hoje - raw), hoje: hoje };
  }
  return { frases: frases, contrato: contrato, quitadas: quitadas };
}

function antHtmlCliente_(e, res, unidade, parcelaId, sit) {
  var ex = antExplicar_(e, res, parcelaId, sit), saldo = sit.saldo, resta = antArred_(saldo - res.valor);
  var r = res.resumo || {};
  /* o saldo é só o que a conta alcança: parcela vencida fica fora dela e o cliente precisa saber disso */
  var linhas = [["Saldo que pode ser antecipado (corrigido)", antBRL_(saldo)], ["Valor da antecipação", antBRL_(res.valor)], ["Fica a pagar depois", antBRL_(resta)]];
  var fora = antVencidas_(sit);
  if (fora) linhas.push(["Fora desta conta: parcelas vencidas", antBRL_(fora)]);
  var h = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Simulação de antecipação</title><style>" +
          "body{font-family:Arial,Helvetica,sans-serif;color:#1f2d1f;margin:36px 44px;font-size:13px;line-height:1.5}" +
          "h1{font-size:20px;margin:0 0 4px;color:#2e5a2e}h2{font-size:14px;margin:22px 0 6px;color:#2e5a2e}" +
          ".sub{color:#555;margin:0 0 18px}table{width:100%;border-collapse:collapse}td{padding:7px 8px;border-bottom:1px solid #ddd}" +
          "td.v{text-align:right;font-weight:bold;white-space:nowrap}.dest td{background:#eef5ee;font-size:15px}" +
          ".rodape{margin-top:28px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px}</style></head><body>" +
          "<h1>RESERVA DOS IPÊS · Simulação de antecipação</h1>" +
          "<p class=\"sub\">" + (unidade ? "Unidade: <b>" + antEsc_(unidade) + "</b> · " : "") + "Emitida em " + antEsc_(antDataBR_(hoje_("yyyy-MM-dd"))) +
          " · " + antEsc_(antValidade_()) + "</p><table>";
  linhas.forEach(function (l, i) { h += "<tr" + (i === 1 ? " class=\"dest\"" : "") + "><td>" + antEsc_(l[0]) + "</td><td class=\"v\">" + antEsc_(l[1]) + "</td></tr>"; });
  h += "<tr><td>Pagamento em</td><td class=\"v\">" + antEsc_(antDataBR_(res.dataPg)) + "</td></tr></table>";
  h += "<h2>Jeito escolhido: " + antEsc_(ANT_JEITOS[res.modo] || res.modo) + "</h2>";
  ex.frases.forEach(function (f) { h += "<p>" + antEsc_(f) + "</p>"; });
  if (ex.contrato) {
    h += "<table><tr><td>Valor no contrato</td><td class=\"v\">" + antBRL_(ex.contrato.contrato) + "</td></tr>" +
         "<tr><td>Correção até hoje</td><td class=\"v\">+ " + antBRL_(ex.contrato.correcao) + "</td></tr>" +
         "<tr class=\"dest\"><td>Para quitar hoje</td><td class=\"v\">" + antBRL_(ex.contrato.hoje) + "</td></tr></table>";
  }
  h += "<h2>Como fica o pagamento</h2><table>";
  if (r.proximo) h += "<tr><td>Próximo pagamento</td><td class=\"v\">" + antEsc_(antDataBR_(r.proximo.data)) + " · " + antBRL_(r.proximo.valor) + "</td></tr>";
  if (r.ultimo) h += "<tr><td>Última parcela</td><td class=\"v\">" + antEsc_(antDataBR_(r.ultimo.data)) + " · " + antBRL_(r.ultimo.valor) + "</td></tr>";
  if (!r.proximo) h += "<tr><td colspan=\"2\">Nenhuma parcela fica a pagar nessas condições.</td></tr>";
  h += "</table><p class=\"rodape\">Valores de hoje; simulação " + antEsc_(antValidade_()) + ". As parcelas que ficam continuam corrigidas conforme o item 7.1 do contrato.</p></body></html>";
  return h;
}

/* Texto pronto para WhatsApp: 3 a 5 linhas */
function antTextoWhatsApp_(e, res, parcelaId, sit) {
  var ex = antExplicar_(e, res, parcelaId, sit), r = res.resumo || {}, l = [];
  l.push("Simulação de antecipação, pagamento em " + antDataBR_(res.dataPg) + ": " + antBRL_(res.valor) + ".");
  if (res.modo === "D") {
    var alvo = antAlvoDe_(res, parcelaId), nome = alvo && alvo.tipo === "balao" ? "balão" : "parcela";
    if (alvo && alvo.acao === "quita")
      l.push("O " + nome + " de " + antDataBR_(alvo.data) + " era " + antBRL_(alvo.rawAntes) + " no contrato. Com a correção da obra até hoje ele está em " +
             antBRL_(alvo.valorAntes) + ". Pagando agora, ele para de corrigir.");
    else if (alvo)
      l.push("Pagando " + antBRL_(res.valor) + ", o " + nome + " de " + antDataBR_(alvo.data) + " continua em " + antMesAno_(alvo.data) +
             " e fica em " + antBRL_(alvo.valor) + " hoje (segue corrigido daqui para frente).");
  } else if (res.modo === "E") {
    var n = ex.quitadas.length, todas = n === sit.posAbertas;
    l.push("Quitando " + (todas ? "as " + n + " parcelas" : (n === 1 ? "a última parcela" : "as últimas " + n + " parcelas")) + " depois das chaves hoje, você paga " +
           antBRL_(res.valor) + " e não paga mais os juros de 1% ao mês " + (n === 1 ? "dela" : "delas") + ". " +
           (todas ? "Depois das chaves não fica nada a pagar." : "As primeiras continuam nas datas de sempre."));
  } else {
    l.push(ex.frases[0]);
  }
  if (res.modo !== "E") {
    if (r.proximo) l.push("Próximo pagamento: " + antDataBR_(r.proximo.data) + ", " + antBRL_(r.proximo.valor) + (r.ultimo ? ". Última parcela: " + antDataBR_(r.ultimo.data) + ", " + antBRL_(r.ultimo.valor) + "." : "."));
    else l.push("Não fica nenhuma parcela a pagar.");
  }
  var fora = antVencidas_(sit);
  if (fora) l.push("Fora desta conta: parcelas vencidas " + antBRL_(fora) + ".");
  l.push("Valores de hoje; simulação " + antValidade_() + ".");
  return l.join("\n");
}

/* a linha da base DB_ANTECIPACOES: o que o robô da 2ª metade vai reler para efetivar */
function antPropsLinha_(p, sess, res, unidade, e, sit) {
  var sim = { modo: res.modo, valor: res.valor, dataPg: res.dataPg, parcelaId: p.parcelaId || null, quantas: res.quantas == null ? null : res.quantas,
              retratoLido: e.lido, saldo: sit.saldo, resumo: res.resumo,
              mudadas: res.depois.filter(function (x) { return x.acao !== "igual"; }).map(function (x) {
                return [x.id, x.data, x.tipo, x.acao, x.rawAntes, x.raw, x.valorAntes, x.valor]; }) };
  var props = {};
  props["UNIDADE"] = { title: [{ type: "text", text: { content: unidade || "Unidade" } }] };
  props["VENDA"] = { relation: [{ id: p.pageId }] };
  props["DATA"] = { date: { start: res.dataPg } };
  props["VALOR"] = { number: res.valor };
  props["JEITO"] = { select: { name: res.modo } };
  props["SIMULAÇÃO"] = { rich_text: fluxoPedacos_(JSON.stringify(sim)) };
  props["SITUAÇÃO"] = { select: { name: "Simulada" } };
  props["RESPONSÁVEL"] = { rich_text: antTexto_(String((sess && (sess.u || sess.n)) || "")) };
  return props;
}

function antecipacaoPdf_(col, sess, p) {
  var a = antLer_(p.pageId), e = antEstadoDe_(a, Date.now());
  if (!e.pode) return { ok: false, erro: "NAO_PODE", motivo: e.motivo };
  if (!e.retrato) return { ok: false, erro: "SEM_RETRATO" };
  if (e.velho) return { ok: false, erro: "RETRATO_VELHO" };
  var dbAnt = String(prop_("DB_ANTECIPACOES") || "").trim();
  if (!dbAnt) return { ok: false, erro: "BASE_ANTECIPACOES_NAO_CONFIGURADA" };

  /* tudo vem da tela como texto solto: o servidor converte e refaz a conta (nunca confia em número calculado lá) */
  var valor = typeof p.valor === "number" ? p.valor : (p.valor == null ? NaN : (Antecipacao.lerValor(p.valor) || NaN));
  var quantas = p.quantas == null || p.quantas === "" ? null : Number(p.quantas);
  var dataPg = String(p.dataPg || "").slice(0, 10), parcelaId = p.parcelaId == null ? undefined : String(p.parcelaId);
  /* o fator é o de hoje e o PDF diz "valores de hoje, válida até o fim do mês ou até o novo índice": data de outro mês ou já passada não vale.
     Data fora do formato fica para a conta (DATA_INVALIDA). */
  if (/^\d{4}-\d{2}-\d{2}$/.test(dataPg) && (dataPg.slice(0, 7) !== hoje_("yyyy-MM") || dataPg < hoje_("yyyy-MM-dd")))
    return { ok: false, erro: "DATA_FORA_DO_MES" };
  var res = Antecipacao.simular(e.retrato, { modo: String(p.modo || ""), valor: valor, dataPg: dataPg, parcelaId: parcelaId, quantas: quantas });
  if (!res.ok) {
    var rec = { ok: false, erro: res.erro };
    if (res.sugestoes) rec.sugestoes = res.sugestoes;
    if (res.travas) rec.travas = res.travas;
    return rec;
  }
  res.quantas = quantas;
  var sit = Antecipacao.situacao(e.retrato, res.dataPg), unidade = antUnidade_(a.props);
  var html = antHtmlCliente_(e, res, unidade, parcelaId, sit);
  var pdf = Utilities.newBlob(html, "text/html", "simulacao.html").getAs("application/pdf");
  var nome = "Simulação de antecipação " + hoje_("yyyy-MM-dd") + ".pdf";

  var linha;
  try {
    linha = notion_("POST", "/pages", { parent: { database_id: dbAnt }, properties: antPropsLinha_({ pageId: p.pageId, parcelaId: parcelaId }, sess, res, unidade, e, sit) });
  } catch (err) {
    console.error("PORTAL-VENDA antecipacaoPdf registro falhou: " + String((err && err.message) || err).slice(0, 120));
    return { ok: false, erro: "REGISTRO_FALHOU" };
  }
  try {
    anexarArquivo_(linha.id, ANT_COL_PDF, { nome: nome, mime: "application/pdf", base64: Utilities.base64Encode(pdf.getBytes()) }, true);
  } catch (err2) {
    console.error("PORTAL-VENDA antecipacaoPdf anexo falhou: " + String((err2 && err2.message) || err2).slice(0, 120));
    try { notion_("PATCH", "/pages/" + linha.id, { properties: { "SITUAÇÃO": { select: { name: "Erro" } } } }); } catch (err4) {}   // melhor esforço
    return { ok: false, erro: "ANEXO_FALHOU", linhaId: linha.id };
  }
  /* o Notion hospeda o arquivo com endereço temporário (cerca de 1 hora): a tela abre na hora */
  var pdfUrl = "";
  try {
    var f = ((notion_("GET", "/pages/" + linha.id, null).properties || {})[ANT_COL_PDF] || {}).files || [];
    if (f.length) pdfUrl = f[0].type === "external" ? f[0].external.url : (f[0].file || {}).url || "";
  } catch (err3) {}
  console.log("PORTAL-VENDA antecipacaoPdf " + String(p.pageId).slice(0, 8) + " jeito " + res.modo);
  return { ok: true, linhaId: linha.id, pdfUrl: pdfUrl, texto: antTextoWhatsApp_(e, res, parcelaId, sit) };
}

/* ---------- aba Financeiro (FinanceiroVenda.gs) ---------- */
var ANT_GRUPOS = { sinal: "Sinal", entrada: "Entrada", pre: "Pré-chaves", balao: "Balão", pos: "Pós-chaves", terceiros: "FGTS/Financiamento" };
var ANT_ORDEM_GRUPOS = ["Sinal", "Entrada", "Pré-chaves", "Balão", "Pós-chaves", "FGTS/Financiamento", "Outros"];

function antParcelasFinanceiro_(parcelas, hoje) {
  var grupos = {};
  parcelas.forEach(function (p) { var g = ANT_GRUPOS[p.tipo] || "Outros"; (grupos[g] = grupos[g] || []).push(p); });
  var out = [];
  ANT_ORDEM_GRUPOS.forEach(function (g) {
    var l = (grupos[g] || []).slice().sort(function (x, y) {
      return x.data !== y.data ? (x.data < y.data ? -1 : 1) : (String(x.id) < String(y.id) ? -1 : 1);
    });
    l.forEach(function (p, i) {
      var paga = !!p.pago && !p.parcial, atrasada = !paga && p.data < hoje;   // paga em parte ainda deve o resto
      out.push({ grupo: g, numero: i + 1, de: l.length, vencimento: p.data, valor: p.raw, valorCorrigido: p.valor,
                 situacao: paga ? "paga" : (atrasada ? "atrasada" : "aberta"), pagoEm: paga ? (p.pagoEm || "") : "",
                 diasAtraso: atrasada ? antDiasEntre_(p.data, hoje) : 0 });
    });
  });
  return out;
}

/* Leitura única das parcelas do ERP para a aba Financeiro e para a antecipação. Nunca lança.
   Sem retrato bom (nunca lido, erro, processando, venda de outra base, coluna faltando) devolve parcelas: null e
   retrato: null — é assim que FinanceiroVenda.gs decide dizer "sem leitura" em vez de mostrar uma lista vazia. */
function antecipacaoRetrato_(pageId) {
  var vazio = { lidoEm: "", retrato: null, parcelas: null };
  try {
    var a = antLer_(pageId);
    if (a.base !== "CONDOMINIO" || !a.temColunas) return vazio;
    var i = antInterpretar_(a, Date.now());
    if (!i.retrato) { vazio.lidoEm = i.lido; return vazio; }
    return { lidoEm: i.lido, retrato: i.retrato, parcelas: antParcelasFinanceiro_(i.retrato.parcelas, hoje_("yyyy-MM-dd")) };
  } catch (err) {
    console.error("PORTAL-VENDA antecipacaoRetrato falhou: " + String((err && err.message) || err).slice(0, 120));
    return vazio;
  }
}
