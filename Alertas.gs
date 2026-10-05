/*************************************************************************
 * Alertas.gs · PORTAL-MORAIS — 05/10/2026 (a1)
 * -----------------------------------------------------------------------
 * Vai nos TRÊS projetos (PORTAL-LEITURA, PORTAL-ESCRITA e PORTAL-ATIVIDADES),
 * ao lado do Código.gs, Melhorias.gs e RetaFinal.gs. Nomes começam com "al".
 *
 * POR QUE EXISTE — revisão das atividades de VENDAS e DOCUMENTOS (05/10):
 *  1) "Dei baixa na coluna da planilha e a atividade não sumiu."
 *     As atividades eram consideradas abertas pela FÓRMULA do Notion
 *     ("Atividade Feita?" / "ATIVIDADE FINALIZADA"), que só aceita SIM e às
 *     vezes não acompanha (ex.: ISSQN com SIM na obra continuava aberta).
 *     Agora quem manda é a COLUNA DA OBRA que a baixa escreve, lida ao vivo:
 *        aberta  = coluna vazia ou NÃO
 *        fechada = SIM, INEXISTE ou qualquer outro valor preenchido
 *     Sem coluna/obra para conferir, vale a fórmula como antes.
 *  2) Duplicadas: o Notion tinha cópias da mesma atividade (ex.: 9× "EMITIR
 *     CNO OU CND" na mesma obra). O portal mostra UMA por obra+tipo (a de
 *     prazo mais cedo) e devolve as outras em "dups". A baixa escreve a coluna
 *     da obra, então resolve todas de uma vez. alManutencao() arquiva as
 *     cópias no Notion (vão para a lixeira, recuperáveis por 30 dias).
 *  3) CERTIDÃO DO LOTE passou para o Departamento de Projetos (José Arthur e
 *     felipe berçan): o portal já trata assim, e alManutencao() troca o
 *     Responsável no Notion das que ainda estão com outra pessoa.
 *  4) Atividade que ainda não começou (DATA INICIAL > hoje) não aparece em
 *     lugar nenhum — antes o sino e a aba Atividades contavam.
 *
 * DEPOIS DE COLAR: salvar + Implantar > Gerenciar implantações > lápis >
 * Nova versão, nos três projetos. No PORTAL-LEITURA rode UMA vez
 * alCriarGatilhoManutencao() (agenda a limpeza diária) e, se quiser ver o
 * efeito na hora, alManutencao() pelo menu Executar (o log lista tudo).
 *************************************************************************/

var VERSAO_ALERTAS = "2026-10-05 a2";   // a2: a manutenção também arquiva cópias que ainda não começaram

/* Tipo da atividade de DOCUMENTOS que pertence a outro setor, não importa
   quem esteja no Responsável do Notion. */
var AL_TIPO_SETOR = { "CERTIDAO DO LOTE": "Departamento de Projetos" };
var AL_PROJETOS_PESSOAS = ["José Arthur", "felipe berçan"];

var AL_CH_DOCS = "al_docs_v1";
var AL_CH_VENDAS = "al_vendas_v1";
var AL_FRESCO_SEG = 120;

/* ------------------------------------------------------------------ */
function alHoje_() { return Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd"); }
function alSH_(id) { return String(id || "").replace(/-/g, ""); }

/* Valor de uma propriedade do Notion como texto, para decidir aberta/fechada. */
function alTexto_(p) {
  if (!p || !p.type) return "";
  switch (p.type) {
    case "select": return p.select ? p.select.name : "";
    case "status": return p.status ? p.status.name : "";
    case "checkbox": return p.checkbox ? "SIM" : "";
    case "rich_text": return texto_(p);
    case "title": return titulo_(p);
    case "multi_select": return (p.multi_select || []).map(function (x) { return x.name; }).join(", ");
    case "files": return (p.files || []).length ? "SIM" : "";
    case "date": return p.date && p.date.start ? p.date.start : "";
    case "number": return p.number == null ? "" : String(p.number);
    case "formula": var f = p.formula || {}; var v = f[f.type]; return v == null ? "" : String(v);
    default: return "";
  }
}
/* A regra única: vazio ou NÃO = ainda por fazer. */
function alAberto_(txt) {
  var n = normDist_(txt || "");
  return !n || n === "NAO" || n === "NO";
}
/* Propriedade pelo nome, tolerando acento, caixa e espaço sobrando. */
function alProp_(props, nome) {
  if (!props || !nome) return null;
  if (props[nome]) return props[nome];
  var alvo = normDist_(nome);
  for (var k in props) if (normDist_(k) === alvo) return props[k];
  return null;
}

/* Lê uma base inteira trazendo SÓ as colunas pedidas (filter_properties) —
   VENDAS tem centenas de linhas e dezenas de colunas; trazer tudo seria lento.
   Se o Notion recusar o parâmetro, cai na leitura completa. */
function alQueryColunas_(dbId, nomes) {
  try {
    var db = notion_("GET", "/databases/" + dbId, null), props = db.properties || {}, ids = [];
    nomes.forEach(function (n) {
      var p = alProp_(props, n);
      if (p && p.id && ids.indexOf(p.id) < 0) ids.push(p.id);
    });
    if (!ids.length) return queryAll_(dbId, {});
    var qs = "?" + ids.map(function (i) { return "filter_properties=" + encodeURIComponent(i); }).join("&");
    var out = [], cursor = null, n = 0;
    do {
      var b = { page_size: 100 }; if (cursor) b.start_cursor = cursor;
      var r = notion_("POST", "/databases/" + dbId + "/query" + qs, b);
      out = out.concat(r.results || []);
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor && ++n < 30);
    return out;
  } catch (e) {
    console.log("alQueryColunas_ (" + dbId + "): " + e + " — lendo completo");
    return queryAll_(dbId, {});
  }
}

/* Mantém UMA por obra+tipo (a de prazo mais cedo); as outras vão em dups. */
function alDeduplicar_(lista) {
  var grupos = {}, ordem = [];
  lista.forEach(function (a) {
    var k = a.obraId ? (alSH_(a.obraId) + "|" + normDist_(a.tipo || "")) : ("id|" + a.id);
    if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
    grupos[k].push(a);
  });
  var out = [];
  ordem.forEach(function (k) {
    var g = grupos[k];
    g.sort(function (x, y) {
      var c = String(x.dataFinal || "9999").localeCompare(String(y.dataFinal || "9999"));
      return c || String(x.criado || "").localeCompare(String(y.criado || ""));
    });
    var principal = g[0];
    principal.dups = g.slice(1).map(function (x) { return x.id; });
    out.push(principal);
  });
  return out;
}

/* Ids (Notion) das pessoas do Departamento de Projetos. */
function alPessoasProjetos_() {
  return comCache_("al_pess_proj_v1", 21600, function () {
    var achados = {};
    try {
      queryAll_(DB_ATIVIDADES_DOCS, {}).forEach(function (a) {
        var pr = a.properties || {};
        for (var k in pr) {
          if (pr[k].type !== "people") continue;
          (pr[k].people || []).forEach(function (u) {
            AL_PROJETOS_PESSOAS.forEach(function (nome) {
              if (u.name && normDist_(u.name).indexOf(normDist_(nome)) === 0) achados[nome] = { id: u.id, nome: u.name };
            });
          });
        }
      });
    } catch (e) {}
    AL_PROJETOS_PESSOAS.forEach(function (nome) {
      if (achados[nome]) return;
      try { var id = acharPessoaIdPorNome_(nome); if (id) achados[nome] = { id: id, nome: nome }; } catch (e) {}
    });
    return AL_PROJETOS_PESSOAS.map(function (n) { return achados[n]; }).filter(Boolean);
  });
}

/* ========================== DOCUMENTOS ========================== */
function alDocsAbertas_(fresco) {
  if (fresco) cacheRemover_(AL_CH_DOCS);
  return comCache_(AL_CH_DOCS, AL_FRESCO_SEG, alDocsAbertasCalc_);
}
function alDocsAbertasCalc_(opc) {
  var futuras = !!(opc && opc.futuras);
  var hoje = alHoje_(), colunasSim = docsColunasSim_();
  var rows = queryAll_(DB_ATIVIDADES_DOCS, {});

  /* colunas da obra que as baixas desses tipos escrevem */
  var colPorTipo = {}, cols = [];
  rows.forEach(function (r) {
    var t = sel_(getTol_(r.properties || {}, "TIPO"));
    if (t && colPorTipo[t] === undefined) {
      colPorTipo[t] = docsColunaDaBaixa_(t, colunasSim);
      if (colPorTipo[t] && cols.indexOf(colPorTipo[t]) < 0) cols.push(colPorTipo[t]);
    }
  });
  var obras = {};
  if (cols.length) alQueryColunas_(CONFIG.DB.DOCUMENTOS, cols).forEach(function (o) { obras[alSH_(o.id)] = o.properties || {}; });

  var proj = alPessoasProjetos_(), lista = [], fechadasPelaObra = 0;
  rows.forEach(function (r) {
    var pr = r.properties || {}, rel = [], resp = [], respIds = [];
    for (var nome in pr) {
      if (pr[nome].type === "relation" && normDist_(nome).indexOf("OBRA") >= 0) rel = (pr[nome].relation || []);
      if (pr[nome].type === "people" && normDist_(nome).indexOf("RESPONS") >= 0) {
        resp = pessoas_(pr[nome]);
        respIds = (pr[nome].people || []).map(function (u) { return alSH_(u.id); });
      }
    }
    var di = dt_(getTol_(pr, "DATA INICIAL"));
    if (!futuras && di && di.slice(0, 10) > hoje) return;             // ainda não começou

    var tipo = sel_(getTol_(pr, "TIPO")), coluna = colPorTipo[tipo] || null;
    var obraId = rel[0] ? rel[0].id : null, op = obraId ? obras[alSH_(obraId)] : null;
    if (coluna && op) {
      var pc = alProp_(op, coluna);
      if (pc) { if (!alAberto_(alTexto_(pc))) { fechadasPelaObra++; return; } }
      else if (docsAtvFeita_(pr)) return;
    } else if (docsAtvFeita_(pr)) return;

    var setor = AL_TIPO_SETOR[normDist_(tipo || "")] || null;
    if (setor === "Departamento de Projetos" && proj.length) {
      resp = proj.map(function (x) { return x.nome; });
      respIds = proj.map(function (x) { return alSH_(x.id); });
    }
    lista.push({
      id: r.id, nome: tituloDe_(pr), tipo: tipo, responsavel: resp, respIds: respIds, setor: setor,
      obraId: obraId, dataInicial: di,
      dataFinal: dt_(getTol_(pr, "DATA FINAL PREVISTA")) || dt_(getTol_(pr, "DATA FINAL")),
      coluna: coluna, criado: r.created_time || ""
    });
  });
  var antes = lista.length;
  lista = alDeduplicar_(lista);
  lista.sort(function (a, b) { return String(a.dataFinal || "9999").localeCompare(String(b.dataFinal || "9999")); });
  return { ok: true, total: lista.length, duplicadas: antes - lista.length, fechadasPelaObra: fechadasPelaObra,
           lidoEm: new Date().toISOString(), atividades: lista };
}

/* ============================ VENDAS ============================ */
/* BAIXA_MAP (Código.gs) com busca tolerante a acento/caixa. */
function alColunaVendas_(tipo) {
  if (!tipo) return null;
  if (BAIXA_MAP[tipo]) return BAIXA_MAP[tipo];
  var alvo = normDist_(tipo);
  for (var k in BAIXA_MAP) if (normDist_(k) === alvo) return BAIXA_MAP[k];
  return null;
}
function alVendasAbertas_(fresco) {
  if (fresco) cacheRemover_(AL_CH_VENDAS);
  return comCache_(AL_CH_VENDAS, AL_FRESCO_SEG, alVendasAbertasCalc_);
}
function alVendasAbertasCalc_(opc) {
  var futuras = !!(opc && opc.futuras);
  var hoje = alHoje_();
  var rows = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {
    filter: { property: "ATIVIDADE FINALIZADA", formula: { string: { contains: "NÃO" } } }
  });
  var cols = [];
  rows.forEach(function (r) {
    var c = alColunaVendas_(sel_((r.properties || {})["TIPO"]));
    if (c && cols.indexOf(c) < 0) cols.push(c);
  });
  var obras = {};
  if (cols.length) alQueryColunas_(CONFIG.DB.VENDAS, cols).forEach(function (o) { obras[alSH_(o.id)] = o.properties || {}; });

  var lista = [], fechadasPelaObra = 0;
  rows.forEach(function (r) {
    var pr = r.properties || {};
    var di = dt_(pr["DATA INICIAL"]);
    if (!futuras && di && di.slice(0, 10) > hoje) return;
    var tipo = sel_(pr["TIPO"]), coluna = alColunaVendas_(tipo);
    var rel = (pr["OBRA"] && pr["OBRA"].relation) || [];
    var obraId = rel[0] ? rel[0].id : null, op = obraId ? obras[alSH_(obraId)] : null;
    if (coluna && op) {
      var pc = alProp_(op, coluna);
      if (pc && !alAberto_(alTexto_(pc))) { fechadasPelaObra++; return; }
    }
    var pp = pr["RESPONSÁVEL"] || alProp_(pr, "RESPONSÁVEL");
    lista.push({
      id: r.id, nome: titulo_(pr["Nome"]), tipo: tipo,
      dataInicial: di, dataFinal: dt_(pr["DATA FINAL PREVISTA"]),
      responsavel: pessoas_(pp), respIds: ((pp && pp.people) || []).map(function (u) { return alSH_(u.id); }),
      obraId: obraId, coluna: coluna, criado: r.created_time || ""
    });
  });
  var antes = lista.length;
  lista = alDeduplicar_(lista);
  lista.sort(function (a, b) { return String(a.dataFinal || "9999").localeCompare(String(b.dataFinal || "9999")); });
  return { ok: true, total: lista.length, duplicadas: antes - lista.length, fechadasPelaObra: fechadasPelaObra,
           lidoEm: new Date().toISOString(), atividades: lista };
}

/* ======================= MANUTENÇÃO NO NOTION =======================
 * 1) Arquiva cópias duplicadas (mesma obra + mesmo tipo + mesmo nome, todas
 *    em aberto) — fica a mais antiga. Vão para a lixeira do Notion.
 * 2) CERTIDÃO DO LOTE em aberto: Responsável = José Arthur + felipe berçan.
 * Roda só no PORTAL-LEITURA (o gatilho é criado lá). */
function alManutencao() {
  var log = { arquivadas: [], certidao: 0, erros: [] };
  [["DOCUMENTOS", alDocsAbertasCalc_], ["VENDAS", alVendasAbertasCalc_]].forEach(function (par) {
    try {
      var r = par[1]({ futuras: true });
      r.atividades.forEach(function (a) {
        if (!a.dups || !a.dups.length) return;
        a.dups.forEach(function (id) {
          try {
            var pg = notion_("GET", "/pages/" + id, null);
            if (normDist_(tituloDe_(pg.properties || {})) !== normDist_(a.nome)) return;   // nome diferente: não é cópia
            notion_("PATCH", "/pages/" + id, { archived: true });
            log.arquivadas.push(par[0] + ": " + a.nome + " (" + alSH_(id).slice(0, 8) + ")");
          } catch (e) { log.erros.push(id + ": " + e); }
        });
      });
    } catch (e) { log.erros.push(par[0] + ": " + e); }
  });
  try {
    var proj = alPessoasProjetos_();
    if (proj.length === AL_PROJETOS_PESSOAS.length) {
      var alvoIds = proj.map(function (x) { return alSH_(x.id); }).sort().join(",");
      queryAll_(DB_ATIVIDADES_DOCS, {}).forEach(function (r) {
        var pr = r.properties || {};
        if (normDist_(sel_(getTol_(pr, "TIPO")) || "") !== "CERTIDAO DO LOTE") return;
        if (docsAtvFeita_(pr)) return;
        var colResp = null;
        for (var k in pr) if (pr[k].type === "people" && normDist_(k).indexOf("RESPONS") >= 0) { colResp = k; break; }
        if (!colResp) return;
        var atuais = (pr[colResp].people || []).map(function (u) { return alSH_(u.id); }).sort().join(",");
        if (atuais === alvoIds) return;
        var props = {}; props[colResp] = { people: proj.map(function (x) { return { id: x.id }; }) };
        try { notion_("PATCH", "/pages/" + r.id, { properties: props }); log.certidao++; }
        catch (e) { log.erros.push("certidão " + r.id + ": " + e); }
      });
    } else log.erros.push("Não achei no Notion: " + AL_PROJETOS_PESSOAS.join(" / ") + " (achei " + proj.length + ")");
  } catch (e) { log.erros.push("certidão: " + e); }
  try { cacheRemover_(AL_CH_DOCS); cacheRemover_(AL_CH_VENDAS); cacheRemover_("docs_atividades_v1"); } catch (e) {}
  Logger.log("MANUTENÇÃO: " + log.arquivadas.length + " cópia(s) arquivada(s), " + log.certidao +
             " certidão(ões) passada(s) para Projetos, " + log.erros.length + " erro(s).");
  log.arquivadas.forEach(function (x) { Logger.log("   arquivada: " + x); });
  log.erros.forEach(function (x) { Logger.log("   ERRO: " + x); });
  return log;
}
function alManutencaoJob_() {
  if (!ehPapelLeitura_()) return;
  alManutencao();
}
function alCriarGatilhoManutencao() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "alManutencaoJob_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("alManutencaoJob_").timeBased().everyDays(1).atHour(7).create();
  Logger.log("Gatilho diário da manutenção das atividades criado (~7h).");
}

/* Diagnóstico: rode pelo menu e confira os números no log. */
function alConferir() {
  var d = alDocsAbertasCalc_(), v = alVendasAbertasCalc_();
  Logger.log("DOCUMENTOS: " + d.total + " em aberto · " + d.duplicadas + " duplicada(s) escondida(s) · " +
             d.fechadasPelaObra + " fechada(s) pela coluna da obra");
  Logger.log("VENDAS: " + v.total + " em aberto · " + v.duplicadas + " duplicada(s) escondida(s) · " +
             v.fechadasPelaObra + " fechada(s) pela coluna da obra");
  var t = {};
  d.atividades.forEach(function (a) { var k = "DOC " + a.tipo; t[k] = (t[k] || 0) + 1; });
  v.atividades.forEach(function (a) { var k = "VND " + a.tipo + (a.coluna ? "" : " (SEM COLUNA)"); t[k] = (t[k] || 0) + 1; });
  Object.keys(t).sort().forEach(function (k) { Logger.log("   " + ("    " + t[k]).slice(-4) + "  " + k); });
}
