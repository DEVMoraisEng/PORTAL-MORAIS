/* boletos-financeiro.js — a tela da página Boletos e Financeiro (09/11/2026). Só monta HTML a partir do arquivo que o
 * servidor publica (servidor/boletos_portal.py); não fala com a rede. Roda no navegador (window.BF) e no node (testes). */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.BF = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TIPOS = { sinal: "Sinal", entrada: "Entrada", pre: "Pré-chaves", pos: "Pós-chaves", balao: "Balão", terceiros: "FGTS ou financiamento" };
  const STATUS = { AWAITING: "aguardando", DRAFT: "em processamento", ISSUED: "emitido", REGISTERED: "registrado",
                   SETTLED: "liquidado", RECEIVED: "recebido", PENDING_WRITE_OFF: "em cancelamento",
                   FAILED: "falhou", REJECTED: "rejeitado", WRITTEN_OFF: "cancelado" };
  const GRUPOS = [
    { chave: "emitidos", nome: "Emitidos", cor: "ok" },
    { chave: "a_emitir", nome: "A emitir", cor: "ma", aberto: true },
    { chave: "aguardando", nome: "Aguardando", cor: "al", aberto: true },
    { chave: "decidir", nome: "Para decidir", cor: "ru", aberto: true },
    { chave: "seguradas", nome: "Seguradas", cor: "ma", aberto: true },
    { chave: "pulados", nome: "Pulados", cor: "ne" }
  ];
  const PODE_SEGURAR = { a_emitir: 1, aguardando: 1, decidir: 1 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function brl(v) {
    const n = Number(v) || 0, s = Math.abs(n).toFixed(2).split(".");
    return (n < 0 ? "-" : "") + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + s[1];
  }
  function dataBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }
  function dataHora(txt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(txt || ""));
    return m ? m[3] + "/" + m[2] + "/" + m[1] + " às " + m[4] + ":" + m[5] : "";
  }
  /* "já tem boleto (REGISTERED)" -> "boleto registrado" */
  function motivoEmPortugues(motivo) {
    const m = /^já tem boleto \((.+)\)$/.exec(String(motivo || ""));
    if (!m) return String(motivo || "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
    return "boleto " + m[1].split(",").map(s => STATUS[s] || s).join(", ");
  }
  function mesBr(mes) {
    const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ""));
    return m ? nomes[Number(m[2]) - 1] + "/" + m[1] : "";
  }
  function horaDoNome(nome) {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(String(nome || ""));
    return m ? m[3] + "/" + m[2] + " às " + m[4] + ":" + m[5] : "";
  }

  function botao(item, chave, op) {
    if (!op.podeSegurar || !item.parcela) return "";
    const acao = chave === "seguradas" ? "soltar" : PODE_SEGURAR[chave] ? "segurar" : "";
    if (!acao) return "";
    const pendente = (op.pedidos || {})[item.parcela];
    if (pendente) return '<span class="muted">pedido enviado…</span>';
    return '<button type="button" class="bt-seg" data-acao="' + acao + '" data-parcela="' + esc(item.parcela) + '">' + (acao === "soltar" ? "Soltar" : "Segurar") + "</button>";
  }

  function tabelaGrupo(g, itens, op) {
    if (!itens.length) return '<p class="muted vazio">Nenhuma parcela.</p>';
    const linhas = itens.map(i => "<tr><td>" + esc(i.unidade) + "</td><td>" + esc(i.comprador) + "</td><td>" + esc(TIPOS[i.tipo] || i.tipo) +
      "</td><td>" + esc(dataBr(i.data)) + '</td><td class="n">' + brl(i.valor) + '</td><td class="mot">' + esc(motivoEmPortugues(i.motivo)) +
      (i.fora_do_relatorio ? ' <span class="muted">(fora da lista deste mês)</span>' : "") + "</td><td>" + botao(i, g.chave, op) + "</td></tr>").join("");
    return '<div class="rola"><table><thead><tr><th>Unid.</th><th>Comprador</th><th>Tipo</th><th>Vence</th><th class="n">Valor</th><th>Motivo</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>";
  }

  function htmlBoletos(d, op) {
    op = op || {};
    const r = d.rodada, g = d.grupos || {};
    let topo;
    if (!r) topo = '<span class="muted">O robô de boletos ainda não rodou.</span>';
    else {
      const previa = r.modo !== "emissao";
      topo = '<span class="muted">Última rodada: ' + esc(horaDoNome(r.nome)) +
        (r.saldo == null ? "" : " · " + esc(r.saldo) + " créditos") + (previa ? " · só a lista, sem emitir" : "") + (r.trava ? "" : " · sem trava") + "</span>";
    }
    const avisos = [];
    if (r && r.trava) avisos.push("Trava: " + r.trava);
    if (d.trava_seguradas) avisos.push(d.trava_seguradas);
    const blocos = GRUPOS.map(x => {
      const itens = g[x.chave] || [];
      const escolha = (op.grupos || {})[x.chave];   // o que a pessoa abriu ou fechou vale mais que o padrão
      const aberto = escolha === undefined ? !!(x.aberto && itens.length) : escolha;
      return "<details" + (aberto ? " open" : "") + ' data-grupo="' + x.chave + '"><summary><span class="pill ' + x.cor + '">' + esc(x.nome) + " " + itens.length + "</span></summary>" + tabelaGrupo(x, itens, op) + "</details>";
    }).join("");
    return '<section class="quadro"><h2>Boletos' + (r ? " de " + esc(mesBr(r.mes)) : "") + "</h2><div>" + topo + "</div>" +
      avisos.map(a => '<div class="aviso">' + esc(a) + "</div>").join("") + blocos + "</section>";
  }

  function casa(u, op) {
    const b = String(op.busca || "").trim().toLowerCase();
    if (op.soVencido && !(u.vencido > 0)) return false;
    return !b || String(u.unidade).toLowerCase() === b || String(u.comprador).toLowerCase().includes(b);
  }

  function plural(n, um, varios) { return n === 1 ? um : varios; }

  function htmlFinanceiro(d, op) {
    op = op || {};
    const f = d.financeiro || {}, t = f.totais || {}, unidades = f.unidades || [];
    const avisos = [];
    const nl = f.nao_lancadas || [], sl = f.sem_leitura || [];
    if (nl.length) avisos.push(nl.length + " " + plural(nl.length, "venda na planilha ainda não foi lançada", "vendas na planilha ainda não foram lançadas") + " no Mais Controle e não " + plural(nl.length, "entra", "entram") + " nesta conta: " + plural(nl.length, "Unidade ", "Unidades ") + nl.join(", ") + ".");
    if (sl.length) avisos.push(sl.length + " " + plural(sl.length, "venda lançada ainda não tem leitura", "vendas lançadas ainda não têm leitura") + " e não " + plural(sl.length, "entra", "entram") + " nesta conta: " + plural(sl.length, "Unidade ", "Unidades ") + sl.join(", ") + ".");
    if (f.falha_leitura) avisos.push("Não consegui ler a planilha do condomínio na última publicação. Os números abaixo são os da leitura anterior.");
    if (estaVelho(f.lido, op.agora)) avisos.push("A última leitura tem mais de 26 horas. O servidor pode estar desligado ou a tarefa do retrato parada.");
    const num = (rot, chave, cls) => '<div><span class="rotulo">' + rot + "</span><b" + (cls ? ' class="' + cls + '"' : "") + ">" + brl(t[chave]) + "</b></div>";
    const visiveis = unidades.filter(u => casa(u, op));
    const linhas = visiveis.map(u => "<tr><td>" + esc(u.unidade) + "</td><td>" + esc(u.comprador) +
      (u.erro_leitura ? ' <span class="pill al" title="A última leitura desta venda falhou">leitura de ' + esc(dataHora(u.lido) || "antes") + "</span>" : "") +
      '</td><td class="n">' + brl(u.recebido) + '</td><td class="n">' + brl(u.a_vencer) + '</td><td class="n">' +
      (u.vencido > 0 ? '<span class="pill ru">' + brl(u.vencido) + " · " + esc(u.dias_atraso) + " " + plural(u.dias_atraso, "dia", "dias") + "</span>" : "0,00") +
      '</td><td class="n">' + brl(u.caixa) + '</td><td class="n">' + brl(u.permuta) + "</td><td>" +
      (u.proxima ? esc(dataBr(u.proxima.data)) + " · " + brl(u.proxima.valor) : "—") + "</td></tr>").join("");
    return '<section class="quadro"><div class="topo"><div><h2>Financeiro do condomínio</h2><span class="muted">' +
      (f.lido ? "Lido do Mais Controle em " + esc(dataHora(f.lido)) : "Ainda sem leitura") + "</span></div>" +
      '<button type="button" id="bt-atualizar"' + (op.atualizando ? " disabled" : "") + ">" + (op.atualizando ? "Atualizando, leva alguns minutos…" : "Atualizar agora") + "</button></div>" +
      '<div class="nums">' + num("Recebido", "recebido") + num("A vencer", "a_vencer") + num("Vencido", "vencido", (t.vencido > 0 ? "vermelho" : "")) +
      num("FGTS e financ.", "caixa") + num("Permuta", "permuta") + "</div>" +
      '<p class="muted nota">A vencer é o valor de hoje: as parcelas futuras ainda recebem o INCC. Recebido inclui juros pagos nas baixas.</p>' +
      avisos.map(a => '<div class="aviso">' + esc(a) + "</div>").join("") +
      '<div class="filtros"><input id="busca" type="search" placeholder="Buscar unidade ou comprador" aria-label="Buscar unidade ou comprador" value="' + esc(op.busca || "") + '">' +
      '<label><input id="so-vencido" type="checkbox"' + (op.soVencido ? " checked" : "") + "> Só com vencido</label></div>" +
      (visiveis.length
        ? '<div class="rola"><table><thead><tr><th>Unid.</th><th>Comprador</th><th class="n">Recebido</th><th class="n">A vencer</th><th class="n">Vencido</th><th class="n">FGTS e financ.</th><th class="n">Permuta</th><th>Próxima parcela</th></tr></thead><tbody>' + linhas + "</tbody></table></div>"
        : '<p class="muted vazio">Nenhuma unidade para mostrar.</p>') + "</section>";
  }

  function estaVelho(lido, agora) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(lido || ""));
    if (!m) return false;
    const quando = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return (agora == null ? Date.now() : agora) - quando > 26 * 3600 * 1000;
  }

  return { htmlBoletos, htmlFinanceiro, brl, dataBr, esc, motivoEmPortugues, estaVelho };
});
