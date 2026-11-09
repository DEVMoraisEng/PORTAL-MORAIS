/* boletos-financeiro.js — a tela da página Boletos e Financeiro (09/11/2026). Só monta HTML a partir do arquivo que o
 * servidor publica (servidor/boletos_portal.py); não fala com a rede. Roda no navegador (window.BF) e no node (testes). */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.BF = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TIPOS = { sinal: "Sinal", entrada: "Entrada", pre: "Pré-chaves", pos: "Pós-chaves", balao: "Balão", terceiros: "FGTS ou financiamento" };
  const SUBS = { fgts: "FGTS", financiamento: "Financiamento" };
  const STATUS = { AWAITING: "aguardando", DRAFT: "em processamento", ISSUED: "emitido", REGISTERED: "registrado",
                   SETTLED: "liquidado", RECEIVED: "recebido", PENDING_WRITE_OFF: "em cancelamento",
                   FAILED: "falhou", REJECTED: "rejeitado", WRITTEN_OFF: "cancelado" };
  const GRUPOS = [
    { chave: "decidir", nome: "Para decidir", cor: "ru" },
    { chave: "a_emitir", nome: "A emitir", cor: "ma" },
    { chave: "aguardando", nome: "Aguardando", cor: "al" },
    { chave: "proximo_mes", nome: "Próximo mês", cor: "ma" },
    { chave: "seguradas", nome: "Seguradas", cor: "ma" },
    { chave: "emitidos", nome: "Emitidos", cor: "ok" },
    { chave: "pulados", nome: "Pulados", cor: "ne" }
  ];
  const PODE_SEGURAR = { a_emitir: 1, aguardando: 1, decidir: 1, proximo_mes: 1 };
  /* Cada motivo de "Para decidir" vira um bloco com o que fazer e quem resolve */
  const DECIDIR = [
    { casa: /^venceu em/, titulo: "Venceu sem boleto", fazer: "Falar com o comprador. Se for cobrar por boleto, emitir na tela do Mais Controle com a data combinada.", quem: "Financeiro" },
    { casa: /^cadastro do comprador/, titulo: "Cadastro do comprador incompleto", fazer: "Completar CPF, CEP, endereço, número, bairro ou cidade na venda do Mais Controle. O robô emite na rodada seguinte.", quem: "Vendas" },
    { casa: /^índice do mês/, titulo: "Índice do mês não lançado", fazer: "Conferir o robô de índices. Quando o índice entrar, o boleto sai na rodada seguinte.", quem: "Financeiro" },
    { casa: /^(emissão sem confirmação|SEM_CONFIRMACAO|RECUSADO)/, titulo: "Emissão sem confirmação ou recusada", fazer: "Conferir no Mais Controle se o boleto nasceu. O robô não pede de novo.", quem: "Financeiro" },
    { casa: /^boleto anterior/, titulo: "Boleto anterior cancelado ou com falha", fazer: "Conferir no Mais Controle e emitir por lá, se ainda for o caso.", quem: "Financeiro" }
  ];
  const BLOCOS = {
    a_emitir: { titulo: "A emitir", fazer: "Nada: o robô emite na próxima rodada, nos dias úteis às 10:00. Se esta parcela não deve sair, segure agora.", quem: "Robô de boletos" },
    aguardando: { titulo: "Aguardando a data", fazer: "Nada: o robô emite na data do motivo. Para adiantar, emita na tela do Mais Controle.", quem: "Robô de boletos" },
    proximo_mes: { titulo: "Próximo mês", fazer: "Confira antes da virada: estas parcelas saem na primeira rodada do mês. Se alguma não deve sair, segure agora.", quem: "Financeiro" },
    seguradas: { titulo: "Seguradas", fazer: "O robô não emite estas parcelas até alguém clicar em Soltar.", quem: "ADM ou MASTER" },
    emitidos: { titulo: "Boletos emitidos", fazer: "Nada a fazer. O Mais Controle avisa o comprador.", quem: "" },
    pulados: { titulo: "Pulados", fazer: "Nada a fazer: estas parcelas não têm boleto, pelo motivo de cada linha.", quem: "" }
  };
  const COLUNAS = [
    { chave: "recebido", nome: "Recebido", fazer: "Já baixado no Mais Controle.", quem: "" },
    { chave: "a_vencer", nome: "A vencer", fazer: "Acompanhar: o boleto sai no mês do vencimento. O valor ainda recebe o INCC.", quem: "Robô de boletos" },
    { chave: "vencido", nome: "Vencido", fazer: "Cobrar o comprador. Se já pagou, dar a baixa no Mais Controle.", quem: "Financeiro", cor: "vermelho" },
    { chave: "caixa", nome: "FGTS e financ.", fazer: "Vem da Caixa, sem boleto. Dar a baixa quando o crédito entrar.", quem: "Financeiro" },
    { chave: "permuta", nome: "Permuta", fazer: "O carro paga, sem boleto. Dar a baixa quando a permuta for concluída.", quem: "Financeiro" }
  ];

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
  /* "já tem boleto (REGISTERED)" -> "boleto registrado"; datas AAAA-MM-DD viram DD/MM/AAAA */
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
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function acha(texto, busca) {
    const b = String(busca || "").trim().toLowerCase();
    return !b || String(texto).toLowerCase().includes(b);
  }
  function casaUnidade(i, busca) {
    const b = String(busca || "").trim().toLowerCase();
    return !b || String(i.unidade).toLowerCase() === b || acha(i.comprador, b);
  }
  function cabecalho(titulo, n, fazer, quem, extra) {
    return '<div class="bloco-cab"><h3>' + esc(titulo) + " <small>" + n + "</small>" + (extra ? ' <span class="soma">' + extra + "</span>" : "") + "</h3>" +
      (quem ? '<span class="quem">Quem resolve: ' + esc(quem) + "</span>" : "") + "</div>" + (fazer ? '<p class="fazer">' + esc(fazer) + "</p>" : "");
  }

  function botao(item, chave, op) {
    if (!op.podeSegurar || !item.parcela) return "";
    const acao = chave === "seguradas" ? "soltar" : PODE_SEGURAR[chave] ? "segurar" : "";
    if (!acao) return "";
    if ((op.pedidos || {})[item.parcela]) return '<span class="muted">pedido enviado…</span>';
    return '<button type="button" class="bt-seg" data-acao="' + acao + '" data-parcela="' + esc(item.parcela) + '">' + (acao === "soltar" ? "Soltar" : "Segurar") + "</button>";
  }

  function blocosDe(chave, itens) {
    if (chave !== "decidir") return [Object.assign({ itens }, BLOCOS[chave])];
    const por = new Map();
    itens.forEach(i => {
      const d = DECIDIR.find(x => x.casa.test(String(i.motivo || ""))) || { titulo: "Outros casos", fazer: "Ler o motivo de cada linha e decidir no Mais Controle.", quem: "Financeiro" };
      if (!por.has(d.titulo)) por.set(d.titulo, Object.assign({ itens: [] }, d));
      por.get(d.titulo).itens.push(i);
    });
    return [...por.values()];
  }

  function htmlBoletos(d, op) {
    op = op || {};
    const r = d.rodada, g = d.grupos || {};
    let topo;
    if (!r) topo = "O robô de boletos ainda não rodou.";
    else {
      topo = "Última rodada: " + esc(horaDoNome(r.nome)) + (r.saldo == null ? "" : " · " + esc(r.saldo) + " créditos") +
        (r.modo !== "emissao" ? " · só a lista, sem emitir" : "") + (r.trava ? "" : " · sem trava");
    }
    const avisos = [];
    if (r && r.trava) avisos.push("Trava: " + r.trava);
    if (r && r.proximo_falhou) avisos.push("Não consegui montar a lista do próximo mês nesta rodada. O robô tenta de novo na próxima.");
    if (d.trava_seguradas) avisos.push(d.trava_seguradas);
    (d.recusas || []).forEach(x => avisos.push("Não consegui atender o pedido da " + (x.unidade ? "Unidade " + x.unidade : "parcela") + " em " + x.em + ": " + x.motivo));
    const filtro = op.grupo || "todas", busca = op.buscaBoletos || "";
    const visiveis = {};
    GRUPOS.forEach(x => { visiveis[x.chave] = (g[x.chave] || []).filter(i => casaUnidade(i, busca)); });
    const total = GRUPOS.reduce((a, x) => a + visiveis[x.chave].length, 0);
    const chip = (ch, nome, n, cor) => '<button type="button" class="chip' + (filtro === ch ? " ativo" : "") + (cor ? " " + cor : "") + '" data-grupo="' + ch + '">' + esc(nome) + " <b>" + n + "</b></button>";
    const chips = chip("todas", "Todas", total) + GRUPOS.filter(x => x.chave !== "proximo_mes" || (g.proximo_mes || []).length).map(x => chip(x.chave, x.chave === "proximo_mes" && r && r.proximo_mes ? mesBr(r.proximo_mes) : x.nome, visiveis[x.chave].length, x.cor)).join("");
    const blocos = GRUPOS.filter(x => filtro === "todas" || filtro === x.chave).map(x => blocosDe(x.chave, visiveis[x.chave]).filter(b => b.itens.length).map(b =>
      '<div class="bloco ' + x.cor + '">' + cabecalho(x.chave === "proximo_mes" && r && r.proximo_mes ? "Próximo mês: " + mesBr(r.proximo_mes) : b.titulo, b.itens.length, b.fazer, b.quem) +
      '<div class="rola"><table><thead><tr><th>Unid.</th><th>Comprador</th><th>Tipo</th><th>Vence</th><th class="n">Valor</th><th>Motivo</th><th></th></tr></thead><tbody>' +
      b.itens.map(i => "<tr><td>" + esc(i.unidade) + "</td><td>" + esc(i.comprador) + "</td><td>" + esc(TIPOS[i.tipo] || i.tipo) + "</td><td>" + esc(dataBr(i.data)) +
        '</td><td class="n">' + brl(i.valor) + '</td><td class="mot">' + esc(motivoEmPortugues(i.motivo)) +
        (i.fora_do_relatorio ? ' <span class="muted">(fora da lista deste mês)</span>' : "") + "</td><td>" + botao(i, x.chave, op) + "</td></tr>").join("") +
      "</tbody></table></div></div>").join("")).join("");
    return '<section class="quadro"><h2>Boletos' + (r ? " de " + esc(mesBr(r.mes)) : "") + '</h2><div class="muted">' + topo + "</div>" +
      avisos.map(a => '<div class="aviso">' + esc(a) + "</div>").join("") +
      '<div class="filtros">' + chips + '<input id="busca-boletos" type="search" placeholder="Buscar unidade ou comprador" aria-label="Buscar nos boletos, por unidade ou comprador" value="' + esc(busca) + '"></div>' +
      (blocos || '<p class="muted vazio">Nenhuma parcela para mostrar.</p>') + "</section>";
  }

  function tituloDaLinha(t) { return SUBS[t.sub] || TIPOS[t.tipo] || t.tipo || ""; }

  /* Os títulos que formam o número clicado, um bloco por unidade */
  function htmlTitulos(titulos, coluna, busca) {
    const c = COLUNAS.find(x => x.chave === coluna);
    const lista = titulos.filter(t => t.coluna === coluna && casaUnidade(t, busca));
    const soma = lista.reduce((a, t) => a + Math.round((Number(t.valor) || 0) * 100), 0) / 100;
    const por = new Map();
    lista.forEach(t => { if (!por.has(t.unidade)) por.set(t.unidade, []); por.get(t.unidade).push(t); });
    const recebido = coluna === "recebido", vencido = coluna === "vencido", cor = vencido ? "ru" : recebido ? "ok" : "ma";
    const blocos = [...por.entries()].map(([u, ts]) => {
      const s = ts.reduce((a, t) => a + Math.round((Number(t.valor) || 0) * 100), 0) / 100;
      return '<div class="bloco ' + cor + '">' + cabecalho("Unidade " + u + " · " + ts[0].comprador, ts.length, "", "", "R$ " + brl(s)) +
        '<div class="rola"><table><thead><tr><th>Tipo</th><th>Vence</th>' + (recebido ? "<th>Recebido em</th>" : "") + (vencido ? "<th>Atraso</th>" : "") + '<th class="n">Valor</th></tr></thead><tbody>' +
        ts.map(t => "<tr><td>" + esc(tituloDaLinha(t)) + "</td><td>" + esc(dataBr(t.data)) + "</td>" + (recebido ? "<td>" + (esc(dataBr(t.pago_em)) || "em parte") + "</td>" : "") +
          (vencido ? "<td>" + esc(t.dias_atraso) + " " + plural(t.dias_atraso, "dia", "dias") + "</td>" : "") + '<td class="n">' + brl(t.valor) + "</td></tr>").join("") + "</tbody></table></div></div>";
    }).join("");
    return '<div class="selecao">' + cabecalho(c.nome + ": títulos", lista.length, c.fazer, c.quem, "R$ " + brl(soma)) + "</div>" + (blocos || '<p class="muted vazio">Nenhum título para mostrar.</p>');
  }

  function htmlFinanceiro(d, op) {
    op = op || {};
    const f = d.financeiro || {}, t = f.totais || {}, unidades = f.unidades || [], titulos = f.titulos || [];
    const avisos = [];
    const nl = f.nao_lancadas || [], sl = f.sem_leitura || [];
    if (nl.length) avisos.push(nl.length + " " + plural(nl.length, "venda na planilha ainda não foi lançada", "vendas na planilha ainda não foram lançadas") + " no Mais Controle e não " + plural(nl.length, "entra", "entram") + " nesta conta: " + plural(nl.length, "Unidade ", "Unidades ") + nl.join(", ") + ".");
    if (sl.length) avisos.push(sl.length + " " + plural(sl.length, "venda lançada ainda não tem leitura", "vendas lançadas ainda não têm leitura") + " e não " + plural(sl.length, "entra", "entram") + " nesta conta: " + plural(sl.length, "Unidade ", "Unidades ") + sl.join(", ") + ".");
    if (f.falha_leitura) avisos.push("Não consegui ler a planilha do condomínio na última publicação. Os números abaixo são os da leitura anterior.");
    if (estaVelho(f.lido, op.agora)) avisos.push("A última leitura tem mais de 26 horas. O servidor pode estar desligado ou a tarefa do retrato parada.");
    const coluna = COLUNAS.some(c => c.chave === op.coluna) ? op.coluna : "";
    const qtd = ch => titulos.filter(x => x.coluna === ch).length;
    const nums = COLUNAS.map(c => '<button type="button" class="num' + (coluna === c.chave ? " ativo" : "") + '" data-coluna="' + c.chave + '" aria-pressed="' + (coluna === c.chave) + '"><span class="rotulo">' + esc(c.nome) + "</span><b" +
      (c.cor && t[c.chave] > 0 ? ' class="' + c.cor + '"' : "") + ">" + brl(t[c.chave]) + '</b><span class="n-tit">' + qtd(c.chave) + " " + plural(qtd(c.chave), "título", "títulos") + "</span></button>").join("");
    const busca = op.busca || "";
    let corpo;
    if (coluna) corpo = htmlTitulos(titulos, coluna, busca) + '<button type="button" id="ver-unidades">← Ver por unidade</button>';
    else {
      const visiveis = unidades.filter(u => casaUnidade(u, busca) && (!op.soVencido || u.vencido > 0));
      const linhas = visiveis.map(u => "<tr><td>" + esc(u.unidade) + "</td><td>" + esc(u.comprador) +
        (u.erro_leitura ? ' <span class="pill al" title="A última leitura desta venda falhou">leitura de ' + esc(dataHora(u.lido) || "antes") + "</span>" : "") +
        '</td><td class="n">' + brl(u.recebido) + '</td><td class="n">' + brl(u.a_vencer) + '</td><td class="n">' +
        (u.vencido > 0 ? '<span class="pill ru">' + brl(u.vencido) + " · " + esc(u.dias_atraso) + " " + plural(u.dias_atraso, "dia", "dias") + "</span>" : "0,00") +
        '</td><td class="n">' + brl(u.caixa) + '</td><td class="n">' + brl(u.permuta) + "</td><td>" +
        (u.proxima ? esc(dataBr(u.proxima.data)) + " · " + brl(u.proxima.valor) : "—") + "</td></tr>").join("");
      corpo = visiveis.length
        ? '<div class="rola"><table><thead><tr><th>Unid.</th><th>Comprador</th><th class="n">Recebido</th><th class="n">A vencer</th><th class="n">Vencido</th><th class="n">FGTS e financ.</th><th class="n">Permuta</th><th>Próxima parcela</th></tr></thead><tbody>' + linhas + "</tbody></table></div>"
        : '<p class="muted vazio">Nenhuma unidade para mostrar.</p>';
    }
    return '<section class="quadro"><div class="topo"><div><h2>Financeiro do condomínio</h2><span class="muted">' +
      (f.lido ? "Lido do Mais Controle em " + esc(dataHora(f.lido)) : "Ainda sem leitura") + "</span></div>" +
      '<button type="button" id="bt-atualizar"' + (op.atualizando ? " disabled" : "") + ">" + (op.atualizando ? "Atualizando, leva alguns minutos…" : "Atualizar agora") + "</button></div>" +
      '<div class="nums">' + nums + "</div>" +
      '<p class="muted nota">Clique num número para ver os títulos dele. A vencer é o valor de hoje: as parcelas futuras ainda recebem o INCC.</p>' +
      avisos.map(a => '<div class="aviso">' + esc(a) + "</div>").join("") +
      '<div class="filtros"><input id="busca" type="search" placeholder="Buscar unidade ou comprador" aria-label="Buscar no financeiro, por unidade ou comprador" value="' + esc(busca) + '">' +
      (coluna ? "" : '<label><input id="so-vencido" type="checkbox"' + (op.soVencido ? " checked" : "") + "> Só com vencido</label>") + "</div>" + corpo + "</section>";
  }

  function estaVelho(lido, agora) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(lido || ""));
    if (!m) return false;
    const quando = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return (agora == null ? Date.now() : agora) - quando > 26 * 3600 * 1000;
  }

  return { htmlBoletos, htmlFinanceiro, brl, dataBr, esc, motivoEmPortugues, estaVelho };
});
