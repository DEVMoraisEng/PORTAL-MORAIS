/*************************************************************************
 * MapaObras.gs · PORTAL-MORAIS — 28/09/2026 (mo3 em 16/10/2026)
 * -----------------------------------------------------------------------
 * Vai nos TRÊS projetos (PORTAL-LEITURA, PORTAL-ESCRITA e PORTAL-ATIVIDADES),
 * IGUAL nos três. Atende o MAPA DE OBRAS (repositório OBRAS-GERAL), que usa o
 * MESMO login do portal (mesmo endereço devmoraiseng.github.io → mesma sessão).
 *
 * AÇÕES (roteadas pelo Melhorias.gs → moRotear_):
 *   mapaBoot       quem pode editar / medir / conferir + opções das colunas
 *   mapaDocUpdate  grava um dos 6 campos do quadro STATUS DA OBRA (DOCUMENTOS)
 *   medLista       medições da semana do setor (Supabase obra_medicoes)
 *   medSalvar      grava a medição de uma obra na semana
 *   mapaVendaUpdate  processo de ENTREGA de uma casa (BANCO DE DADOS VENDAS) —
 *                  mo3: com os CONTADORES da casa apta e dos reparos (ver abaixo)
 *   vistoriaDados  (mo3) cliente/CPF/telefone da casa para o formulário de vistoria
 *   vistoriaEnviar (mo3) recebe um PDF da vistoria e anexa na linha da casa
 *   vistoriaArquivos (mo3) PDFs da vistoria já anexados (links novos do Notion)
 *   obraEndValidar (mo3) ADM confirma o alerta "endereço alterado" da obra
 *   atvOutraAbrir  (mo3) abre, na aba Atividades, uma atividade de Obras/Vendas/
 *                  Documentos — quem é RESPONSÁVEL dela edita mesmo sem acesso
 *                  à aba de origem
 *   atvOutraGravar (mo3) grava o que foi mudado nessa atividade
 *
 * ===================== mo3 — VISTORIAS DE ENTREGA =====================
 * CASA APTA P/ VISTORIA (atividade VISTORIA PRÉVIA)
 *   - o contador começa na DATA EM QUE A ATIVIDADE FOI CRIADA (prazo 7 dias);
 *   - engenheiro marca SIM  → o contador TRAVA e espera a conferência;
 *   - CONFERÊNCIA DA CONCLUSÃO (só Caio + ADM):
 *        CONFERIDO OK                → sai da lista / atividade concluída
 *        NECESSITA DE INTERVENÇÕES   → casa apta volta para EXECUTANDO REPAROS
 *                                       e o contador volta a contar (somando)
 *   - OBS. CONFERÊNCIA: o que ficou pendente (texto com várias linhas).
 * REPAROS DA PRÉ-VISTORIA (atividade REPAROS VISTORIA)
 *   - o contador começa na DATA DA PRÉ-VISTORIA (prazo 15 dias);
 *   - engenheiro marca SIM → o contador trava; a casa NÃO sai da lista;
 *   - só sai quando ENTREGOU A CASA = SIM;
 *   - ENTREGOU = NÃO ENTREGUE - NOVAS OBSERVAÇÕES → reparos volta para
 *        EXECUTANDO REPAROS e começa um PERÍODO NOVO (zera e conta de novo);
 *   - ENTREGOU = NÃO ENTREGUE - FALTOU CORREÇÕES → reparos volta para
 *        EXECUTANDO REPAROS e o contador CONTINUA de onde estava.
 * O estado dos dois contadores fica na coluna CONTADOR VISTORIA (PORTAL), em
 * texto, na própria linha da casa — o mapa (e o celular sem internet) faz a
 * mesma conta a partir dela.
 *
 * COLUNAS NOVAS NO BANCO DE DADOS VENDAS (criadas sozinhas no 1º mapaBoot, ou
 * rode moPrepararVendas pelo menu Executar):
 *   CONFERÊNCIA DA CONCLUSÃO  (seleção: CONFERIDO OK / NECESSITA DE INTERVENÇÕES)
 *   OBS. CONFERÊNCIA          (texto)
 *   CONTADOR VISTORIA (PORTAL)(texto — não editar à mão)
 *   VISTORIA - RELATÓRIO COMPLETO (arquivos)
 *   VISTORIA - POR PRESTADOR      (arquivos — um PDF por prestador)
 *   + opções novas em ENTREGOU A CASA…: NÃO ENTREGUE - NOVAS OBSERVAÇÕES e
 *     NÃO ENTREGUE - FALTOU CORREÇÕES
 *
 * ================ mo3 — ENDEREÇO ALTERADO NA OBRA ================
 * O obraUpdate_ (Código.gs) chama moEnderecoMudou_ quando o título da obra
 * muda. Na hora: DOCUMENTOS, VENDAS, PÓS OBRA e LIGAÇÕES da obra recebem o
 * endereço novo (e o endereço dentro do nome das atividades de vendas e
 * documentos); se a obra já existe no Mais Controle, o nome antigo fica em
 * MC NOME ANTERIOR e o robô de obras renomeia lá. Tudo fica escrito em
 * ENDEREÇO ALTERADO da obra → aparece nos Alertas da aba Obras até o ADM
 * validar (obraEndValidar). Trocou DIRETO NO NOTION? O gatilho moVerificarNotion
 * (10 min, ESCRITA) percebe pela comparação com o último título visto e faz o mesmo.
 *
 * PROPRIEDADES (opcionais): MAPA_OBRAS_REPO (padrão "DEVMoraisEng/OBRAS-GERAL"),
 * MO_CONFERENTES (padrão "CAIO" — nomes/logins separados por vírgula que podem
 * fazer a conferência da conclusão, além do ADM).
 *************************************************************************/

var MO_VERSAO = "2026-10-16 mo6";
var MO_EVENTO = "obras_notion_update";            // TEM que bater com o types: do fetch_notion.yml
var MO_JANELA_MS = 2 * 60 * 1000;                  // no máximo 1 build a cada 2 min
var MO_CAMPOS = {
  previsao_inicio_obra: "PREVISÃO DE INÍCIO DE OBRA",
  mestre:               "MESTRE",
  obra_iniciada:        "OBRA INCIADA",             // grafia original do Notion
  data_inicio_obra:     "DATA DE INÍCIO DA OBRA",
  obra_finalizada:      "OBRA FINALIZADA?",
  data_termino_obra:    "DATA DE TÉRMINO DE OBRA"
};
var MO_MEDICAO = ["nao_realizada", "lancada_aguardando", "em_andamento", "finalizada"];
/* chave do mapa → [coluna do VENDAS, tipo, outros nomes aceitos] */
var MO_VENDA = {
  processo_conforme:    ["PROCESSO CONFORME?", "select"],
  casa_apta_vistoria:   ["CASA APTA PARA A VISTORIA", "select"],
  agendou_pre_vistoria: ["AGENDOU PRE VISTORIA?", "select", ["AGENDOU PRÉ VISTORIA?"]],
  data_pre_vistoria:    ["DATA DA PRÉ-VISTORIA", "date", ["DATA DA PRE-VISTORIA"]],
  reparos_pre_vistoria: ["REPAROS PRE VISTORIA REALIZADOS", "select"],
  /* 01/10 o nome foi corrigido no Notion (era ENTEGOU) — aceita os dois */
  entregou_casa:        ["ENTREGOU A CASA E PEGOU TERMO DE ENTREGA?", "select", ["ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"]],
  conferencia:          ["CONFERÊNCIA DA CONCLUSÃO", "select"],
  obs_conferencia:      ["OBS. CONFERÊNCIA", "rich_text"],
  contador:             ["CONTADOR VISTORIA (PORTAL)", "rich_text"],
  vist_completo:        ["VISTORIA - RELATÓRIO COMPLETO", "files"],
  vist_prestador:       ["VISTORIA - POR PRESTADOR", "files"]
};
/* colunas que a tela pode gravar pelo mapaVendaUpdate (as outras são do sistema) */
var MO_VENDA_EDITAVEIS = ["processo_conforme", "casa_apta_vistoria", "agendou_pre_vistoria", "data_pre_vistoria",
                          "reparos_pre_vistoria", "entregou_casa", "conferencia", "obs_conferencia"];
var MO_CONF_OK = "CONFERIDO OK", MO_CONF_NAO = "NECESSITA DE INTERVENÇÕES";
var MO_ENT_NOVAS = "NÃO ENTREGUE - NOVAS OBSERVAÇÕES", MO_ENT_FALTOU = "NÃO ENTREGUE - FALTOU CORREÇÕES";
var MO_EXECUTANDO = "EXECUTANDO REPAROS";
var MO_OPCOES_NOVAS = {
  conferencia:   [MO_CONF_OK, MO_CONF_NAO],
  entregou_casa: [MO_ENT_NOVAS, MO_ENT_FALTOU],
  casa_apta_vistoria: [MO_EXECUTANDO],
  reparos_pre_vistoria: [MO_EXECUTANDO]
};
var MO_PRAZO_APTA = 7, MO_PRAZO_REPAROS = 15;
var MO_TIPO_APTA = "VISTORIA PRÉVIA", MO_TIPO_REPAROS = "REPAROS VISTORIA";

function moRotear_(action, sess, p) {
  switch (action) {
    case "mapaBoot":         return moBoot_(sess, p);
    case "mapaDocUpdate":    return moDocUpdate_(sess, p || {});
    case "medLista":         return moMedLista_(sess, p || {});
    case "medSalvar":        return moMedSalvar_(sess, p || {});
    case "mapaVendaUpdate":  return moVendaUpdate_(sess, p || {});
    case "vistoriaDados":    return moVistoriaDados_(sess, p || {});
    case "vistoriaEnviar":   return moVistoriaEnviar_(sess, p || {});
    case "vistoriaArquivos": return moVistoriaArquivos_(sess, p || {});
    case "obraEndValidar":   return moEndValidar_(sess, p || {});
    case "atvOutraAbrir":    return moOutraAbrir_(sess, p || {});
    case "atvOutraGravar":   return moOutraGravar_(sess, p || {});
    case "mapaRecontarApta": return moRecontarApta_(sess, p || {});
    case "mapaVersao":       return { ok: true, versao: MO_VERSAO };
    default:                 return null;
  }
}

function moPodeMedir_(sess) { return !ehTestes_(sess) && (temAcesso_(sess, "OBRAS") || temAcesso_(sess, "DOCUMENTOS")); }
function moPodeEditar_(sess) { return !ehTestes_(sess) && temAcesso_(sess, "DOCUMENTOS"); }
function moPodeVendas_(sess) { return !ehTestes_(sess) && (temAcesso_(sess, "VENDAS") || temAcesso_(sess, "OBRAS")); }
/* Conferência da conclusão: Caio (ou quem estiver em MO_CONFERENTES) + ADM */
function moPodeConferir_(sess) {
  if (!sess || ehTestes_(sess)) return false;
  if (ehAdm_(sess)) return true;
  var lista = String(prop_("MO_CONFERENTES") || "CAIO").split(",").map(function (x) { return normDist_(x); }).filter(Boolean);
  var nome = normDist_(sess.n || ""), login = normDist_(sess.u || "");
  return lista.some(function (c) { return nome.indexOf(c) === 0 || login.indexOf(c) === 0; });
}
function moHoje_() { return Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd"); }
function moDia_(s) { s = String(s || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
function moDif_(a, b) {   // dias corridos de a até b (yyyy-mm-dd)
  if (!a || !b) return 0;
  var pa = a.split("-"), pb = b.split("-");
  var da = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]), db = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
  return Math.round((db - da) / 864e5);
}

/* ---------------------------- boot ---------------------------- */
function moBoot_(sess, p) {
  try { moGarantirColunasUmaVez_(); } catch (e) { console.log("MAPA boot: colunas — " + e); }
  var opcoes = { mestre: [], obra_iniciada: [], obra_finalizada: [] };
  try {
    var s = docsSchema_();
    var ops = function (nome) {
      var alvo = normDist_(nome);
      for (var i = 0; i < s.campos.length; i++) if (normDist_(s.campos[i].nome) === alvo) return s.campos[i].opcoes || [];
      return [];
    };
    opcoes.mestre = ops(MO_CAMPOS.mestre);
    opcoes.obra_iniciada = ops(MO_CAMPOS.obra_iniciada);
    opcoes.obra_finalizada = ops(MO_CAMPOS.obra_finalizada);
  } catch (e) { console.log("MAPA boot: schema — " + e); }
  var opcoesVendas = {};
  try {
    var sv = moColunasVendas_();
    Object.keys(MO_VENDA).forEach(function (k) { var c = sv[k]; if (c && c.opcoes) opcoesVendas[k] = c.opcoes; });
  } catch (e) { console.log("MAPA boot: vendas — " + e); }
  return { ok: true, versao: MO_VERSAO, podeEditar: moPodeEditar_(sess), podeMedir: moPodeMedir_(sess),
           podeVendas: moPodeVendas_(sess), podeConferir: moPodeConferir_(sess),
           eu: sess.n || sess.u || "", opcoes: opcoes, opcoesVendas: opcoesVendas };
}

/* --------------------- quadro STATUS DA OBRA --------------------- */
function moDocUpdate_(sess, p) {
  var prop = MO_CAMPOS[p.campo];
  if (!prop) return { ok: false, erro: "CAMPO_NAO_LIBERADO_NO_MAPA: " + p.campo };
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var r = docsRotear_("docUpdate", sess, { pageId: p.pageId, prop: prop, valor: p.valor === "" ? null : p.valor });
  if (r && r.ok) { try { moAvisarGitHub_("mapa: " + p.campo); } catch (e) {} }
  return r || { ok: false, erro: "SEM_RESPOSTA" };
}

/* --------------- processo de ENTREGA (BANCO DE DADOS VENDAS) --------------- */
function moAcharColuna_(props, nomes) {
  for (var i = 0; i < nomes.length; i++) {
    var alvo = normDist_(nomes[i]);
    for (var n in props) if (normDist_(n) === alvo) return n;
  }
  return null;
}
function moColunasVendas_() {
  return comCache_("mo_colunas_vendas_v3", 1800, function () {
    var props = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null).properties || {}, out = {};
    Object.keys(MO_VENDA).forEach(function (k) {
      var achou = moAcharColuna_(props, [MO_VENDA[k][0]].concat(MO_VENDA[k][2] || []));
      if (!achou) return;
      var t = props[achou].type;
      out[k] = { nome: achou, tipo: t, opcoes: (t === "select" || t === "status") ? (props[achou][t].options || []).map(function (o) { return o.name; }) : null };
    });
    return out;
  });
}

/* Cria o que falta no BANCO DE DADOS VENDAS (colunas e opções). Nunca apaga. */
function moPrepararVendas() {
  var r = moGarantirColunas_();
  Logger.log(JSON.stringify(r));
  return r;
}
function moGarantirColunasUmaVez_() {
  var pr = PropertiesService.getScriptProperties();
  if (pr.getProperty("MO_COLS_V3") === "1") return;
  var r = moGarantirColunas_();
  if (r && r.ok) pr.setProperty("MO_COLS_V3", "1");
}
function moGarantirColunas_() {
  var db = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null), props = db.properties || {}, patch = {}, feito = [];
  var novas = {
    conferencia:     { select: { options: MO_OPCOES_NOVAS.conferencia.map(function (n) { return { name: n }; }) } },
    obs_conferencia: { rich_text: {} },
    contador:        { rich_text: {} },
    vist_completo:   { files: {} },
    vist_prestador:  { files: {} }
  };
  Object.keys(novas).forEach(function (k) {
    if (moAcharColuna_(props, [MO_VENDA[k][0]].concat(MO_VENDA[k][2] || []))) return;
    patch[MO_VENDA[k][0]] = novas[k]; feito.push("coluna " + MO_VENDA[k][0]);
  });
  ["entregou_casa", "casa_apta_vistoria", "reparos_pre_vistoria", "conferencia"].forEach(function (k) {
    var nome = moAcharColuna_(props, [MO_VENDA[k][0]].concat(MO_VENDA[k][2] || []));
    if (!nome || props[nome].type !== "select") return;
    var atuais = props[nome].select.options || [], tem = {};
    atuais.forEach(function (o) { tem[normDist_(o.name)] = 1; });
    var falta = (MO_OPCOES_NOVAS[k] || []).filter(function (n) { return !tem[normDist_(n)]; });
    if (!falta.length || atuais.length + falta.length > 100) return;
    patch[nome] = { select: { options: atuais.map(function (o) { return { id: o.id, name: o.name, color: o.color }; })
                                        .concat(falta.map(function (n) { return { name: n }; })) } };
    feito.push("opções " + falta.join(" / ") + " em " + nome);
  });
  if (Object.keys(patch).length) notion_("PATCH", "/databases/" + CONFIG.DB.VENDAS, { properties: patch });
  try { cacheRemover_("mo_colunas_vendas_v3"); } catch (e) {}
  return { ok: true, feito: feito };
}

/* ---- contadores (casa apta = "a", reparos = "r") ----
 * { a:{ini, acc, ret, trav}, r:{ini, acc, ret, trav} }
 *   ini  = início do período atual       acc = dias já somados
 *   ret  = desde quando está contando    trav = travado em (não conta) */
function moContLer_(txt) {
  try { var o = JSON.parse(String(txt || "")); if (o && typeof o === "object") return o; } catch (e) {}
  return {};
}
function moTravar_(t, dia) { if (t.ret && !t.trav) { t.acc = (t.acc || 0) + Math.max(0, moDif_(t.ret, dia)); t.trav = dia; } }
function moRetomar_(t, dia) { if (t.trav || !t.ret) { t.ret = dia; t.trav = null; } }
function moReiniciar_(t, dia) { t.ini = dia; t.acc = 0; t.ret = dia; t.trav = null; }

/* v5 (16/10): a atividade VISTORIA PRÉVIA nasce quando PROCESSO CONFORME? = SIM,
   então a data dela É o início do prazo de 7 dias (nada a ver com a venda).
   Índice venda → data da atividade mais antiga, tolerante ao nome da coluna
   (TIPO/Tipo, OBRA/qualquer relação com "OBRA" ou "VENDA") e ao acento do tipo. */
function moEhTipoApta_(t) { var n = normDist_(t || ""); return n.indexOf("VISTORIA PREVIA") >= 0 || n.indexOf("VISTORIA PRE") === 0; }
function moAtvAptaIndice_() {
  var c = null; try { c = cacheGet_("mo_atv_apta_idx"); } catch (e) {}
  if (c && c.datas) return c;
  var datas = {}, tipos = {}, total = 0, erro = "", titulos = [], amostra = [];
  try {
    queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {}).forEach(function (r) {
      total++;
      var R = r.properties || {}, t = sel_(getTol_(R, "TIPO")) || "";
      var nt = normDist_(t); tipos[nt] = (tipos[nt] || 0) + 1;
      if (!moEhTipoApta_(t)) return;
      var d = moDia_(dt_(getTol_(R, "DATA INICIAL")) || r.created_time);
      var tit = "";
      for (var n in R) {
        if (!R[n]) continue;
        if (R[n].type === "title") tit = (R[n].title || []).map(function (x) { return x.plain_text || ""; }).join("");
        if (R[n].type === "relation")   /* qualquer relação: a da VENDA é a que bate com o id da casa */
          (R[n].relation || []).forEach(function (x) { var k = String(x.id).replace(/-/g, ""); if (d && (!datas[k] || d < datas[k])) datas[k] = d; });
      }
      if (d) titulos.push({ t: normDist_(tit), d: d });
      if (amostra.length < 4) amostra.push({ titulo: tit, criada: r.created_time, props: Object.keys(R).map(function (n) { var q = R[n] || {}; return n + ":" + q.type + (q.type === "relation" ? "(" + (q.relation || []).length + ")" : ""); }) });
    });
  } catch (e) { erro = String(e).slice(0, 160); console.log("MAPA índice VISTORIA PRÉVIA: " + e); }
  var out = { datas: datas, tipos: tipos, total: total, erro: erro, titulos: titulos, amostra: amostra };
  if (!erro) { try { cachePut_("mo_atv_apta_idx", out, 1800); } catch (e) {} }
  return out;
}
/* sem relação com a casa: procura pelo título da atividade (endereço + casa) */
function moAptaPorTitulo_(idx, endereco, casa) {
  var e = normDist_(endereco || ""); if (!e || !idx.titulos) return "";
  var best = "";
  idx.titulos.forEach(function (x) {
    if (x.t.indexOf(e) < 0) return;
    var m = x.t.slice(x.t.indexOf(e) + e.length).match(/\b(?:CASA|CS)\s*0*(\d+)/);
    if (m && casa != null && String(+m[1]) !== String(casa)) return;
    if (!best || x.d < best) best = x.d;
  });
  return best;
}
/* ADM: refaz o início do prazo "casa apta" pela data da atividade (onde ficou
   com a data da venda). Sem p.aplicar só mostra o que mudaria. */
function moRecontarApta_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  try { cacheRemover_("mo_atv_apta_idx"); } catch (e) {}
  var idx = moAtvAptaIndice_(), cols = moColunasVendas_();
  if (!cols.contador) return { ok: false, erro: "COLUNA_NAO_ENCONTRADA" };
  var nomes = ["contador", "processo_conforme", "entregou_casa", "conferencia"].map(function (k) { return cols[k] && cols[k].nome; }).filter(Boolean).concat(["DATA DA VENDA", "ENDEREÇO", "CASA"]);
  var ler = function (P, k) { var cc = cols[k]; var pp = cc && P[cc.nome]; return pp ? (sel_(pp) || texto_(pp) || "") : ""; };
  var linhas = alQueryColunas_(CONFIG.DB.VENDAS, nomes), hoje = moHoje_(), lista = [], mudou = 0;
  linhas.forEach(function (pg) {
    var P = pg.properties || {};
    if (normDist_(ler(P, "processo_conforme")) !== "SIM") return;
    var ent = normDist_(ler(P, "entregou_casa")); if (ent === "SIM" || ent === "AGIO" || ent === "INEXISTE") return;
    if (normDist_(ler(P, "conferencia")) === normDist_(MO_CONF_OK)) return;
    var id = String(pg.id).replace(/-/g, ""), c = null; try { c = JSON.parse(ler(P, "contador") || "null"); } catch (e) {}
    var end = moTextoProp_(P["ENDEREÇO"]) || "", ncasa = (P["CASA"] && P["CASA"].number);
    var a = (c && c.a) || null, nova = idx.datas[id] || moAptaPorTitulo_(idx, end, ncasa) || "";
    var item = { id: id, endereco: end, casa: (P["CASA"] && P["CASA"].number) || null,
                 venda: P["DATA DA VENDA"] && P["DATA DA VENDA"].date ? moDia_(P["DATA DA VENDA"].date.start) : "", ini: a && a.ini || "", atividade: nova };
    lista.push(item);
    if (!nova || !a || a.ini === nova) return;
    var antigo = a.ini;
    if (a.ret === antigo) a.ret = nova;
    if (a.trav && a.ret === nova) a.acc = Math.max(0, moDif_(nova, a.trav));
    a.ini = nova; c.a = a; c.origem = "atividade"; c.em = new Date().toISOString();
    item.mudou = true;
    if (p.aplicar) {
      var pr = {}; pr[cols.contador.nome] = moRich_(JSON.stringify(c));
      try { notion_("PATCH", "/pages/" + pg.id, { properties: pr }); mudou++; } catch (e) { item.erro = String(e).slice(0, 80); }
    }
  });
  if (mudou) { try { moAvisarGitHub_("contadores", true); } catch (e) {} }
  var tipos = Object.keys(idx.tipos).sort(function (x, y) { return idx.tipos[y] - idx.tipos[x]; }).slice(0, 25).map(function (k) { return k + " (" + idx.tipos[k] + ")"; });
  return { ok: true, aplicado: !!p.aplicar, mudou: mudou, atividades: idx.total, comData: Object.keys(idx.datas).length, erro: idx.erro, tipos: tipos, amostra: idx.amostra, casas: lista };
}

/* Data em que a atividade VISTORIA PRÉVIA desta casa foi criada (a mais antiga em aberto) */
function moAtvCriada_(vendaId, tipo) {
  try {
    var l = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, { filter: { property: "OBRA", relation: { contains: vendaId } } });
    var datas = l.filter(function (r) { var t = sel_(getTol_(r.properties || {}, "TIPO")) || ""; return tipo === MO_TIPO_APTA ? moEhTipoApta_(t) : normDist_(t) === normDist_(tipo); })
                 .map(function (r) { return moDia_(dt_(getTol_(r.properties || {}, "DATA INICIAL")) || r.created_time); })
                 .filter(Boolean).sort();
    return datas[0] || "";
  } catch (e) { console.log("MAPA atividade criada: " + e); return ""; }
}

function moVendaUpdate_(sess, p) {
  if (!moPodeVendas_(sess)) return { ok: false, erro: "SEM_PERMISSAO" };
  return moVendaAplicar_(sess, p);
}
/* Grava uma coluna da entrega e aplica as regras dos contadores. Quem chama
   já conferiu a permissão de VENDAS (ou de responsável pela atividade). */
function moVendaAplicar_(sess, p) {
  if (!p.pageId || MO_VENDA_EDITAVEIS.indexOf(p.campo) < 0) return { ok: false, erro: "FALTA_PARAM" };
  if (p.campo === "conferencia" && !moPodeConferir_(sess)) return { ok: false, erro: "SO_CAIO_OU_ADM_CONFEREM" };
  var cols = moColunasVendas_(), c = cols[p.campo];
  if (!c) { try { moGarantirColunas_(); cols = moColunasVendas_(); c = cols[p.campo]; } catch (e) {} }
  if (!c) return { ok: false, erro: "COLUNA_NAO_ENCONTRADA: " + MO_VENDA[p.campo][0] };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  if (normDist_(String((pg.parent || {}).database_id || "").replace(/-/g, "")) !== normDist_(CONFIG.DB.VENDAS)) return { ok: false, erro: "NAO_E_VENDA" };
  var P = pg.properties || {};
  var ler = function (k) { var cc = cols[k]; if (!cc) return ""; var pp = P[cc.nome]; return pp ? (sel_(pp) || (pp.date && pp.date.start) || texto_(pp) || "") : ""; };
  var opReal = function (k, v) {
    var cc = cols[k]; if (!v || !cc || !cc.opcoes) return v;
    var real = null; cc.opcoes.forEach(function (o) { if (normDist_(o) === normDist_(v)) real = o; });
    return real;
  };
  var valor = p.valor === "" || p.valor === undefined ? null : p.valor;
  if (valor && (c.tipo === "select" || c.tipo === "status")) {
    var real = opReal(p.campo, valor);
    if (!real) {
      try { cacheRemover_("mo_colunas_vendas_v3"); moGarantirColunas_(); cols = moColunasVendas_(); real = opReal(p.campo, valor); } catch (e) {}
      if (!real) return { ok: false, erro: "OPCAO_INEXISTENTE: " + valor };
    }
    valor = real;
  }
  var dia = moDia_(p.quando) || moHoje_();
  if (dia > moHoje_()) dia = moHoje_();
  var muda = {};                       // chave → valor novo
  muda[p.campo] = valor;

  /* contadores */
  var cont = moContLer_(ler("contador"));
  var a = cont.a || {}, rr = cont.r || {};
  if (!a.ini) { a.ini = moAtvCriada_(pg.id, MO_TIPO_APTA) || moDia_(pg.created_time) || dia; a.acc = 0; a.ret = a.ini; a.trav = null;
                if (normDist_(ler("casa_apta_vistoria")) === "SIM") { a.acc = Math.max(0, moDif_(a.ini, dia)); a.trav = dia; } }
  var dpv = moDia_(ler("data_pre_vistoria"));
  if (!rr.ini && dpv) { rr.ini = dpv; rr.acc = 0; rr.ret = dpv; rr.trav = null;
                        if (normDist_(ler("reparos_pre_vistoria")) === "SIM") { rr.acc = Math.max(0, moDif_(dpv, dia)); rr.trav = dia; } }
  var V = normDist_(valor || "");
  switch (p.campo) {
    case "casa_apta_vistoria":
      if (V === "SIM") { moTravar_(a, dia); if (normDist_(ler("conferencia")) === normDist_(MO_CONF_NAO)) muda.conferencia = null; }
      else moRetomar_(a, dia);
      break;
    case "conferencia":
      if (V === normDist_(MO_CONF_NAO)) { muda.casa_apta_vistoria = opReal("casa_apta_vistoria", MO_EXECUTANDO) || MO_EXECUTANDO; moRetomar_(a, dia); }
      else if (V === normDist_(MO_CONF_OK)) moTravar_(a, dia);
      break;
    case "data_pre_vistoria":
      if (valor && (!rr.ini || (!rr.acc && !rr.trav))) { rr.ini = moDia_(valor); rr.ret = rr.ini; rr.acc = 0; rr.trav = null; }
      break;
    case "reparos_pre_vistoria":
      if (!rr.ini) moReiniciar_(rr, dia);
      if (V === "SIM") moTravar_(rr, dia); else moRetomar_(rr, dia);
      break;
    case "entregou_casa":
      if (V === normDist_(MO_ENT_NOVAS)) { muda.reparos_pre_vistoria = opReal("reparos_pre_vistoria", MO_EXECUTANDO) || MO_EXECUTANDO; moReiniciar_(rr, dia); }
      else if (V === normDist_(MO_ENT_FALTOU)) { muda.reparos_pre_vistoria = opReal("reparos_pre_vistoria", MO_EXECUTANDO) || MO_EXECUTANDO; if (!rr.ini) moReiniciar_(rr, dia); else moRetomar_(rr, dia); }
      else if (V === "SIM") { moTravar_(a, dia); moTravar_(rr, dia); }
      break;
  }
  cont = { a: a, r: rr, em: new Date().toISOString(), por: sess.n || sess.u || "" };
  if (cols.contador) muda.contador = JSON.stringify(cont);

  var props = {};
  Object.keys(muda).forEach(function (k) {
    var cc = cols[k]; if (!cc) return;
    if (cc.tipo === "rich_text") props[cc.nome] = moRich_(muda[k]);
    else props[cc.nome] = buildValue_(cc.tipo, muda[k]);
  });
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  console.log("MAPA: " + (sess.u || "?") + " gravou " + Object.keys(muda).join(", ") + " na venda " + p.pageId);
  try { cacheRemover_(AL_CH_VENDAS); } catch (e) {}
  try { if (typeof RF_SNAP_OUT !== "undefined") cacheRemover_(RF_SNAP_OUT); } catch (e) {}
  /* Pós Obra acompanha VENDAS */
  try {
    if (Object.keys(muda).some(function (k) { return cols[k] && posObraEhGatilho_(cols[k].nome); })) {
      var pgAtual = notion_("GET", "/pages/" + p.pageId, null);
      posObraSincronizar_(pgAtual.properties);
    }
  } catch (e) { console.log("PÓS OBRA sync (mapa): " + e); }
  try { moAvisarGitHub_("mapa venda: " + p.campo); } catch (e) {}
  var outVal = {}; Object.keys(muda).forEach(function (k) { if (k !== "contador") outVal[k] = muda[k]; });
  return { ok: true, valores: outVal, contador: cont };
}
function moRich_(txt) {
  txt = String(txt == null ? "" : txt);
  if (!txt) return { rich_text: [] };
  var partes = [];
  for (var i = 0; i < txt.length && partes.length < 50; i += 1900) partes.push({ text: { content: txt.slice(i, i + 1900) } });
  return { rich_text: partes };
}

/* Contadores das casas que ainda não têm (casas antigas e atividade VISTORIA
   PRÉVIA nova): grava o início = data da atividade (ou da venda, se não houver
   atividade) e a data da pré-vistoria. Roda no gatilho de 10 min (ESCRITA) e
   pode ser rodada à mão (moPreencherContadores). Só casas não entregues. */
function moPreencherContadores() { var n = moPreencherContadores_(200); Logger.log(n + " casa(s) com contador novo"); return n; }
function moPreencherContadores_(limite) {
  var cols = moColunasVendas_(); if (!cols.contador) return 0;
  var nomes = ["contador", "processo_conforme", "entregou_casa", "casa_apta_vistoria", "reparos_pre_vistoria", "data_pre_vistoria"]
              .map(function (k) { return cols[k] && cols[k].nome; }).filter(Boolean).concat(["DATA DA VENDA", "CLIENTES", "ENDEREÇO", "CASA"]);
  var linhas = alQueryColunas_(CONFIG.DB.VENDAS, nomes), hoje = moHoje_(), atv = null, n = 0;
  var ler = function (P, k) { var c = cols[k]; var pp = c && P[c.nome]; return pp ? (sel_(pp) || texto_(pp) || (pp.date && pp.date.start) || "") : ""; };
  linhas.forEach(function (pg) {
    if (n >= limite) return;
    var P = pg.properties || {};
    if (ler(P, "contador")) return;
    var ent = normDist_(ler(P, "entregou_casa"));
    if (ent === "SIM" || ent === "AGIO" || ent === "INEXISTE") return;
    if (normDist_(ler(P, "processo_conforme")) !== "SIM") return;
    if (atv === null) atv = moAtvAptaIndice_().datas;
    var id = String(pg.id).replace(/-/g, "");
    var dv = P["DATA DA VENDA"] && P["DATA DA VENDA"].date ? moDia_(P["DATA DA VENDA"].date.start) : "";
    var aT = atv[id] || moAptaPorTitulo_(moAtvAptaIndice_(), moTextoProp_(P["ENDEREÇO"]), P["CASA"] && P["CASA"].number);
    var ini = aT || dv || moDia_(pg.created_time) || hoje;
    var a = { ini: ini, acc: 0, ret: ini, trav: null }, rr = {};
    if (normDist_(ler(P, "casa_apta_vistoria")) === "SIM") { a.acc = Math.max(0, moDif_(ini, hoje)); a.trav = hoje; }
    var dpv = moDia_(ler(P, "data_pre_vistoria"));
    if (dpv) { rr = { ini: dpv, acc: 0, ret: dpv, trav: null }; if (normDist_(ler(P, "reparos_pre_vistoria")) === "SIM") { rr.acc = Math.max(0, moDif_(dpv, hoje)); rr.trav = hoje; } }
    var pr = {}; pr[cols.contador.nome] = moRich_(JSON.stringify({ a: a, r: rr, em: new Date().toISOString(), por: "sistema", origem: aT ? "atividade" : "venda" }));
    try { notion_("PATCH", "/pages/" + pg.id, { properties: pr }); n++; } catch (e) { console.log("MAPA contador " + id + ": " + e); }
  });
  if (n) { try { moAvisarGitHub_("contadores", true); } catch (e) {} }
  return n;
}

/* ------------------------ formulário de vistoria ------------------------ */
function moPaginaVenda_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  if (normDist_(String((pg.parent || {}).database_id || "").replace(/-/g, "")) !== normDist_(CONFIG.DB.VENDAS)) throw "NAO_E_VENDA";
  return pg;
}
function moTextoProp_(pp) {
  if (!pp) return "";
  var t = pp.type, v = pp[t];
  if (t === "title" || t === "rich_text") return (v || []).map(function (x) { return x.plain_text || ""; }).join("");
  if (t === "select" || t === "status") return (v && v.name) || "";
  if (t === "multi_select") return (v || []).map(function (x) { return x.name; }).join(", ");
  if (t === "people") return (v || []).map(function (x) { return x.name || ""; }).join(", ");
  if (t === "phone_number" || t === "email" || t === "url") return v || "";
  if (t === "number") return v == null ? "" : String(v);
  if (t === "formula" && v) return v[v.type] == null ? "" : String(v[v.type]);
  if (t === "rollup" && v && v.type === "array") return (v.array || []).map(moTextoProp_).filter(Boolean).join(", ");
  return "";
}
function moPrimeira_(P, testes) {
  for (var i = 0; i < testes.length; i++) for (var n in P) {
    if (testes[i](normDist_(n))) { var t = moTextoProp_(P[n]); if (t) return t; }
  }
  return "";
}
function moVistoriaDados_(sess, p) {
  if (!moPodeVendas_(sess) && !moEhRespDaVenda_(sess, p.pageId)) return { ok: false, erro: "SEM_PERMISSAO" };
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var pg; try { pg = moPaginaVenda_(p.pageId); } catch (e) { return { ok: false, erro: String(e) }; }
  var P = pg.properties || {};
  var r = {
    ok: true,
    endereco: moPrimeira_(P, [function (n) { return n === "ENDERECO"; }]),
    casa: moPrimeira_(P, [function (n) { return n === "CASA"; }]),
    cliente: moPrimeira_(P, [function (n) { return n === "CLIENTES" || n === "CLIENTE"; }, function (n) { return n.indexOf("PROPONENTE") === 0 && n.indexOf("CPF") < 0; }]),
    cpf: moPrimeira_(P, [function (n) { return n === "CPF" || n === "CPF CLIENTE" || n === "CPF DO CLIENTE"; }, function (n) { return n.indexOf("CPF") === 0; }]),
    telefone: moPrimeira_(P, [function (n) { return n.indexOf("WHATSAPP") >= 0 || n.indexOf("TELEFONE") >= 0 || n.indexOf("CELULAR") >= 0; }]),
    eng: moPrimeira_(P, [function (n) { return n.indexOf("ENG. RESPONS") === 0; }]),
    cidade: moPrimeira_(P, [function (n) { return n === "CIDADE" || n === "CIDADE V1"; }])
  };
  return r;
}
/* responsável por alguma atividade aberta desta casa (Vendas) → pode usar o formulário */
function moEhRespDaVenda_(sess, vendaId) {
  try {
    var me = String(sess.p || "").replace(/-/g, ""); if (!me || !vendaId) return false;
    var id = String(vendaId).replace(/-/g, "");
    return (alVendasAbertas_(false).atividades || []).some(function (a) {
      return String(a.obraId || "").replace(/-/g, "") === id && (a.respIds || []).indexOf(me) >= 0;
    });
  } catch (e) { return false; }
}
function moVistoriaEnviar_(sess, p) {
  if (ehTestes_(sess)) return { ok: false, erro: "MODO_TESTE" };
  if (!moPodeVendas_(sess) && !moEhRespDaVenda_(sess, p.pageId)) return { ok: false, erro: "SEM_PERMISSAO" };
  if (!p.pageId || !p.dataBase64 || !p.filename) return { ok: false, erro: "FALTA_PARAM" };
  var ja = opIdLer_(p.opId); if (ja) return ja;
  var cols = moColunasVendas_();
  if (!cols.vist_completo || !cols.vist_prestador) { moGarantirColunas_(); cols = moColunasVendas_(); }
  var c = p.tipo === "prestador" ? cols.vist_prestador : cols.vist_completo;
  if (!c) return { ok: false, erro: "COLUNA_NAO_ENCONTRADA" };
  try { moPaginaVenda_(p.pageId); } catch (e) { return { ok: false, erro: String(e) }; }
  if (String(p.dataBase64).length > 26 * 1024 * 1024) return { ok: false, erro: "ARQUIVO_GRANDE_DEMAIS" };
  opIdIniciar_(p.opId);
  var r = upload_(sess, { pageId: p.pageId, prop: c.nome, filename: String(p.filename).slice(0, 180),
                          mimeType: p.mimeType || "application/pdf", dataBase64: p.dataBase64 });
  if (r && r.ok) {
    r = { ok: true, coluna: c.nome, arquivo: p.filename };
    console.log("VISTORIA: " + (sess.u || "?") + " anexou " + p.filename + " em " + p.pageId);
    try { moAvisarGitHub_("vistoria"); } catch (e) {}
  }
  opIdGravar_(p.opId, r);
  return r;
}
function moVistoriaArquivos_(sess, p) {
  if (!moPodeVendas_(sess) && !moEhRespDaVenda_(sess, p.pageId) && !temAcesso_(sess, "OBRAS")) return { ok: false, erro: "SEM_PERMISSAO" };
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var pg; try { pg = moPaginaVenda_(p.pageId); } catch (e) { return { ok: false, erro: String(e) }; }
  var cols = moColunasVendas_(), out = {};
  ["vist_completo", "vist_prestador"].forEach(function (k) {
    var c = cols[k]; var pp = c && pg.properties[c.nome];
    out[k] = ((pp && pp.files) || []).map(function (f) {
      return { nome: f.name, url: (f.file && f.file.url) || (f.external && f.external.url) || "" };
    });
  });
  return { ok: true, completo: out.vist_completo, prestador: out.vist_prestador };
}

/* ====================== ENDEREÇO ALTERADO NA OBRA ====================== */
var MO_COL_END_ALT = "ENDEREÇO ALTERADO", MO_COL_MC_ANT = "MC NOME ANTERIOR";
function moColunasObra_() {
  var db = notion_("GET", "/databases/" + OBRAS_DB_PORTAL, null), props = db.properties || {}, patch = {};
  if (!moAcharColuna_(props, [MO_COL_END_ALT])) patch[MO_COL_END_ALT] = { rich_text: {} };
  if (!moAcharColuna_(props, [MO_COL_MC_ANT])) patch[MO_COL_MC_ANT] = { rich_text: {} };
  if (Object.keys(patch).length) { notion_("PATCH", "/databases/" + OBRAS_DB_PORTAL, { properties: patch }); props = notion_("GET", "/databases/" + OBRAS_DB_PORTAL, null).properties || {}; }
  return { alt: moAcharColuna_(props, [MO_COL_END_ALT]), ant: moAcharColuna_(props, [MO_COL_MC_ANT]), mc: moAcharColuna_(props, ["MAIS CONTROLE"]) };
}
function moTitulo_(P) { for (var n in P) if (P[n] && P[n].type === "title") return { col: n, txt: titulo_(P[n]) }; return { col: null, txt: "" }; }
/* troca o endereço velho pelo novo dentro de um texto (sem ligar para caixa/acento) */
function moTrocarEnd_(txt, antigo, novo) {
  txt = String(txt || ""); if (!antigo) return txt;
  var esc = String(antigo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return txt.replace(new RegExp(esc, "i"), novo);
}
function moEnderecoMudou_(sess, obraId, antigo, novo) {
  var t0 = Date.now(), res = { documentos: 0, vendas: 0, posObra: 0, ligacoes: 0, atividades: 0, mc: "", erros: [] };
  if (!antigo || !novo || normDist_(antigo) === normDist_(novo)) return res;
  var nA = normDist_(antigo);
  var semHifen = String(obraId).replace(/-/g, "");
  var mexeTitulo = function (pg, novoTit) {
    var t = moTitulo_(pg.properties || {}); if (!t.col) return false;
    var pt = {}; pt[t.col] = { title: [{ text: { content: novoTit } }] };
    notion_("PATCH", "/pages/" + pg.id, { properties: pt }); return true;
  };
  var porRelOuTitulo = function (dbId, relCol) {
    var vistos = {}, l = [];
    try { queryAll_(dbId, { filter: { property: relCol, relation: { contains: obraId } } }).forEach(function (pg) { vistos[pg.id] = 1; l.push(pg); }); }
    catch (e) { res.erros.push(relCol + ": " + String(e).slice(0, 80)); }
    try {
      var tcol = moTitulo_(notion_("GET", "/databases/" + dbId, null).properties || {}).col;
      if (tcol) queryAll_(dbId, { filter: { property: tcol, title: { equals: antigo } } }).forEach(function (pg) { if (!vistos[pg.id]) { vistos[pg.id] = 1; l.push(pg); } });
    } catch (e) {}
    return l;
  };
  /* 1) DOCUMENTOS e VENDAS */
  var docs = porRelOuTitulo(CONFIG.DB.DOCUMENTOS, "OBRA-AUTO"), vendas = porRelOuTitulo(CONFIG.DB.VENDAS, "OBRA-AUTO");
  docs.forEach(function (pg) { try { if (normDist_(moTitulo_(pg.properties).txt) !== normDist_(novo) && mexeTitulo(pg, novo)) res.documentos++; } catch (e) { res.erros.push("doc: " + String(e).slice(0, 80)); } });
  var chavesPos = [];
  vendas.forEach(function (pg) {
    try {
      var tt = moTitulo_(pg.properties).txt;
      if (normDist_(tt) !== normDist_(novo) && mexeTitulo(pg, novo)) res.vendas++;
    } catch (e) { res.erros.push("venda: " + String(e).slice(0, 80)); }
  });
  /* 2) PÓS OBRA — o vínculo com VENDAS é ENDEREÇO + CASA: muda o "Nome" junto,
        senão a sincronia criaria uma linha nova */
  try {
    queryAll_(CONFIG.DB.POS_OBRA, { filter: { property: "Nome", title: { equals: antigo } } }).forEach(function (pg) {
      try { if (mexeTitulo(pg, novo)) res.posObra++; } catch (e) { res.erros.push("pós obra: " + String(e).slice(0, 80)); }
    });
    try { cacheRemover_("pos_obra_indice"); } catch (e) {}
  } catch (e) { res.erros.push("pós obra: " + String(e).slice(0, 80)); }
  /* 3) LIGAÇÕES ("<obra> CS N" / "<obra> Única") */
  try {
    var sL = notion_("GET", "/databases/" + CONFIG.DB.LIGACOES, null).properties || {};
    var colVinc = obraColReal_(sL, "Vínculo Obra");
    var ligs = colVinc ? queryAll_(CONFIG.DB.LIGACOES, { filter: { property: colVinc, relation: { contains: obraId } } }) : [];
    ligs.forEach(function (pg) {
      var tt = moTitulo_(pg.properties).txt;
      if (normDist_(tt).indexOf(nA) !== 0) return;
      try { if (mexeTitulo(pg, moTrocarEnd_(tt, antigo, novo))) res.ligacoes++; } catch (e) { res.erros.push("ligação: " + String(e).slice(0, 80)); }
    });
    ["lig_indice_obra", "ligacoes_vivo", "lig_sens", "lig_sens_vendas"].forEach(function (c) { try { cacheRemover_(c); } catch (e) {} });
  } catch (e) { res.erros.push("ligações: " + String(e).slice(0, 80)); }
  /* 4) endereço dentro do NOME das atividades de vendas e documentos */
  var trocarNome = function (dbId, rel) {
    rel.forEach(function (id) {
      if (Date.now() - t0 > 240000) return;
      try {
        queryAll_(dbId, { filter: { property: "OBRA", relation: { contains: id } } }).forEach(function (pg) {
          var t = moTitulo_(pg.properties || {});
          if (!t.col || normDist_(t.txt).indexOf(nA) < 0) return;
          var pt = {}; pt[t.col] = { title: [{ text: { content: moTrocarEnd_(t.txt, antigo, novo) } }] };
          notion_("PATCH", "/pages/" + pg.id, { properties: pt }); res.atividades++;
        });
      } catch (e) {}
    });
  };
  trocarNome(CONFIG.DB.ATIVIDADES_VENDAS, vendas.map(function (x) { return x.id; }));
  if (typeof DB_ATIVIDADES_DOCS !== "undefined") trocarNome(DB_ATIVIDADES_DOCS, docs.map(function (x) { return x.id; }));
  /* 5) obra: alerta + nome anterior para o robô do Mais Controle */
  try {
    var co = moColunasObra_(), obra = notion_("GET", "/pages/" + obraId, null), OP = obra.properties || {};
    var mc = co.mc ? (sel_(OP[co.mc]) || "") : "";
    var jaAnt = co.ant ? texto_(OP[co.ant]) : "";
    var noMc = normDist_(mc) === "CRIADA";
    res.mc = noMc ? "aguardando o robô renomear no Mais Controle" : (mc ? "obra ainda não está no Mais Controle (" + mc + ")" : "sem Mais Controle");
    var quando = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm");
    var txt = "DE " + antigo + " PARA " + novo + " · por " + (sess.n || sess.u || "?") + " em " + quando +
              " · DOCUMENTOS " + res.documentos + " · VENDAS " + res.vendas + " · PÓS OBRA " + res.posObra +
              " · LIGAÇÕES " + res.ligacoes + " · ATIVIDADES " + res.atividades + " · MAIS CONTROLE: " + res.mc +
              (res.erros.length ? " · ERROS: " + res.erros.join(" | ") : "");
    var anterior = co.alt ? texto_(OP[co.alt]) : "";
    var props = {};
    if (co.alt) props[co.alt] = moRich_((anterior ? anterior + "\n" : "") + txt);
    if (co.ant && noMc && !jaAnt) props[co.ant] = moRich_(antigo);    // o nome que ESTÁ no MC (o mais antigo)
    if (Object.keys(props).length) notion_("PATCH", "/pages/" + obraId, { properties: props });
    if (noMc) { try { dispararRobosMc(); } catch (e) { res.erros.push("robô MC: " + String(e).slice(0, 60)); } }
  } catch (e) { res.erros.push("obra: " + String(e).slice(0, 100)); }
  [AL_CH_VENDAS, AL_CH_DOCS, "docs_atividades_v1"].forEach(function (k) { try { cacheRemover_(k); } catch (e) {} });
  try { if (typeof RF_SNAP_OUT !== "undefined") cacheRemover_(RF_SNAP_OUT); } catch (e) {}
  try { avisarGitHub_("endereço alterado"); } catch (e) {}
  try { moAvisarGitHub_("endereço alterado", true); } catch (e) {}
  moSnapUm_(obraId, novo);
  console.log("OBRAS: endereço " + antigo + " -> " + novo + " · " + JSON.stringify(res) + " · " + (Date.now() - t0) + " ms");
  return res;
}
/* Endereço trocado DIRETO NO NOTION (na base de obras): o gatilho de 10 min
   (moVerificarNotion, só no ESCRITA) compara o título de cada obra editada com
   o último que viu e, se mudou, faz a mesma propagação do portal. Na primeira
   rodada só fotografa (não gera alerta do que mudou antes). */
var MO_END_SNAP = "MO_END_SNAP_", MO_END_PEDACO = 90;
function moSnapLer_() {
  var pr = PropertiesService.getScriptProperties(), out = {}, n = Number(pr.getProperty(MO_END_SNAP + "N") || 0);
  for (var i = 0; i < n; i++) { try { var o = JSON.parse(pr.getProperty(MO_END_SNAP + i) || "{}"); for (var k in o) out[k] = o[k]; } catch (e) {} }
  return { mapa: out, tem: n > 0 };
}
function moSnapGravar_(mapa) {
  var pr = PropertiesService.getScriptProperties(), ks = Object.keys(mapa), n = 0;
  for (var i = 0; i < ks.length; i += MO_END_PEDACO) {
    var o = {}; ks.slice(i, i + MO_END_PEDACO).forEach(function (k) { o[k] = mapa[k]; });
    pr.setProperty(MO_END_SNAP + n, JSON.stringify(o)); n++;
  }
  var antes = Number(pr.getProperty(MO_END_SNAP + "N") || 0);
  for (var j = n; j < antes; j++) pr.deleteProperty(MO_END_SNAP + j);
  pr.setProperty(MO_END_SNAP + "N", String(n));
}
function moSnapUm_(obraId, titulo) {
  try { var s = moSnapLer_(); if (!s.tem) return; s.mapa[String(obraId).replace(/-/g, "")] = titulo; moSnapGravar_(s.mapa); } catch (e) {}
}
function moConferirEnderecos() {
  var pr = PropertiesService.getScriptProperties();
  var s = moSnapLer_(), ult = pr.getProperty("MO_END_ULT") || "", agora = new Date();
  var filtro = (s.tem && ult) ? { filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: ult } } } : {};
  var linhas = queryAll_(OBRAS_DB_PORTAL, filtro), n = 0;
  linhas.forEach(function (pg) {
    var id = String(pg.id).replace(/-/g, ""), tit = moTitulo_(pg.properties || {}).txt;
    if (!tit) return;
    var antes = s.mapa[id];
    if (s.tem && antes && normDist_(antes) !== normDist_(tit)) {
      try { moEnderecoMudou_({ n: "Notion (alterado direto na base de obras)", u: "notion" }, pg.id, antes, tit); n++; }
      catch (e) { console.log("OBRAS endereço (Notion) " + id + ": " + e); }
    }
    s.mapa[id] = tit;
  });
  moSnapGravar_(s.mapa);
  pr.setProperty("MO_END_ULT", new Date(agora.getTime() - 3 * 60000).toISOString());
  if (n) console.log("OBRAS: " + n + " endereço(s) alterado(s) direto no Notion — propagados");
  return n;
}
function moEndValidar_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var co = moColunasObra_(); if (!co.alt) return { ok: false, erro: "COLUNA_NAO_ENCONTRADA" };
  var pr = {}; pr[co.alt] = { rich_text: [] };
  notion_("PATCH", "/pages/" + p.pageId, { properties: pr });
  try { avisarGitHub_("endereço validado"); } catch (e) {}
  return { ok: true };
}

/* ============ ATIVIDADES DAS OUTRAS ABAS, EDITADAS NA ABA ATIVIDADES ============ */
/* só o retrato que JÁ está pronto (refazer aqui custava ~15 s por clique) */
function moOutraItem_(id) {
  var alvo = String(id || "").replace(/-/g, "");
  var s = (typeof RF_SNAP_OUT !== "undefined") ? cacheGet_(RF_SNAP_OUT) : null;
  for (var i = 0; i < ((s && s.itens) || []).length; i++) if (s.itens[i].id === alvo) return s.itens[i];
  return null;
}
/* responsável direto na página da atividade (quando o retrato não tem o item) */
function moRespDaPagina_(P, me) {
  for (var n in P) if (P[n] && P[n].type === "people" && normDist_(n).indexOf("RESPONS") >= 0)
    if ((P[n].people || []).some(function (u) { return String(u.id).replace(/-/g, "") === me; })) return true;
  return false;
}
function moOutraPode_(sess, item, origem, P) {
  if (vePorTodos_(sess) && !ehTestes_(sess)) return true;
  var me = String(sess.p || "").replace(/-/g, "");
  if (item && me && (item.resp || []).indexOf(me) >= 0) return true;
  if (!item && P && me && moRespDaPagina_(P, me)) return true;
  var aba = { Vendas: "VENDAS", Documentos: "DOCUMENTOS", Obras: "OBRAS" }[origem || (item && item.origem)];
  return !!(aba && temAcesso_(sess, aba) && !ehTestes_(sess));
}
function moDataProp_(P, nomes) { var n = moAcharColuna_(P, nomes); return n && P[n] && P[n].type === "date" ? n : null; }

function moOutraAbrir_(sess, p) {
  var item = moOutraItem_(p.id);
  var origem = (item && item.origem) || p.origem;
  if (!origem) return { ok: false, erro: "ATIVIDADE_NAO_ENCONTRADA" };
  var atv = notion_("GET", "/pages/" + p.id, null), P = atv.properties || {};
  if (!moOutraPode_(sess, item, origem, P)) return { ok: false, erro: "SEM_PERMISSAO" };
  var out = { ok: true, id: String(atv.id).replace(/-/g, ""), origem: origem, titulo: tituloDe_(P), campos: [],
              link: (item && item.link) || ({ Vendas: "vendas.html", Documentos: "documentos.html", Obras: "obras.html" }[origem] || ""), podeAba: temAcesso_(sess, { Vendas: "VENDAS", Documentos: "DOCUMENTOS", Obras: "OBRAS" }[origem]),
              podeConferir: moPodeConferir_(sess) };
  if (origem === "Obras") {
    var sch = obraAtvSchema_();
    var st = obraColReal_(sch, "Status"), dc = obraColReal_(sch, "Data De Conclusão da Atividade"), df = obraColReal_(sch, "Data Final Prevista");
    out.tipo = sel_(getTol_(P, "Tipo")) || "";
    if (st) out.campos.push({ k: "status", label: "Status", tipo: sch[st].type, valor: sel_(P[st]) || "",
                              opcoes: ((sch[st][sch[st].type] || {}).options || []).map(function (o) { return o.name; }) });
    if (df) out.campos.push({ k: "fim", label: "Data final prevista", tipo: "date", valor: dt_(P[df]) || "" });
    if (dc) out.campos.push({ k: "conclusao", label: "Data de conclusão", tipo: "date", valor: dt_(P[dc]) || "" });
    return out;
  }
  var tipo = sel_(getTol_(P, "TIPO")) || "";
  out.tipo = tipo;
  var rel = []; for (var nm in P) if (P[nm].type === "relation" && normDist_(nm).indexOf("OBRA") >= 0) rel = P[nm].relation || [];
  out.obraId = rel[0] ? String(rel[0].id).replace(/-/g, "") : null;
  var dfn = moDataProp_(P, ["DATA FINAL PREVISTA", "DATA FINAL"]);
  if (origem === "Vendas") {
    var venda = rel[0] ? notion_("GET", "/pages/" + rel[0].id, null) : null, VP = venda ? venda.properties || {} : {};
    out.endereco = venda ? (moTitulo_(VP).txt + (moTextoProp_(getTol_(VP, "CASA")) ? " · Casa " + moTextoProp_(getTol_(VP, "CASA")) : "")) : "";
    var cols = moColunasVendas_();
    var lerV = function (k) { var c = cols[k]; return c && VP[c.nome] ? (sel_(VP[c.nome]) || texto_(VP[c.nome]) || (VP[c.nome].date && VP[c.nome].date.start) || "") : ""; };
    var addV = function (k, label, so) {
      var c = cols[k]; if (!c) return;
      out.campos.push({ k: "v:" + k, label: label, tipo: c.tipo, valor: lerV(k), opcoes: c.opcoes || null, soLeitura: !!so });
    };
    var nT = normDist_(tipo);
    if (nT === normDist_(MO_TIPO_APTA)) {
      addV("casa_apta_vistoria", "Casa apta p/ vistoria");
      addV("conferencia", "Conferência da conclusão", !moPodeConferir_(sess));
      addV("obs_conferencia", "Observações", !moPodeConferir_(sess) && !moPodeVendas_(sess));
      out.vistoria = true;
    } else if (nT === normDist_(MO_TIPO_REPAROS)) {
      addV("data_pre_vistoria", "Data da pré-vistoria", true);
      addV("reparos_pre_vistoria", "Reparos da pré-vistoria");
      addV("entregou_casa", "Entregou a casa?");
      out.vistoria = true;
    } else {
      var coluna = alColunaVendas_(tipo);
      if (coluna) {
        var props = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null).properties || {};
        var real = moAcharColuna_(props, [coluna, coluna.replace("ENTREGOU", "ENTEGOU")]);
        if (real) out.campos.push({ k: "baixa", label: real, tipo: props[real].type, valor: VP[real] ? (sel_(VP[real]) || "") : "",
                                    opcoes: props[real].type === "select" ? (props[real].select.options || []).map(function (o) { return o.name; }) : null });
      }
    }
    out.vendaId = venda ? String(venda.id).replace(/-/g, "") : null;
  } else if (origem === "Documentos") {
    var colD = docsColunaDaBaixa_(tipo, docsColunasSim_()), campo = colD ? docsCampo_(colD) : null;
    var doc = rel[0] ? notion_("GET", "/pages/" + rel[0].id, null) : null, DP = doc ? doc.properties || {} : {};
    out.endereco = doc ? moTitulo_(DP).txt : "";
    if (campo) out.campos.push({ k: "baixa", label: campo.nome, tipo: campo.tipo, valor: DP[campo.nome] ? (sel_(DP[campo.nome]) || "") : "", opcoes: campo.opcoes || null });
  }
  if (dfn) out.campos.push({ k: "fim", label: "Data final prevista", tipo: "date", valor: dt_(P[dfn]) || "" });
  return out;
}

function moOutraGravar_(sess, p) {
  if (ehTestes_(sess)) return { ok: false, erro: "MODO_TESTE" };
  var item = moOutraItem_(p.id), origem = (item && item.origem) || p.origem;
  if (!origem) return { ok: false, erro: "ATIVIDADE_NAO_ENCONTRADA" };
  var atvP = null;
  if (!item && !vePorTodos_(sess)) { try { atvP = notion_("GET", "/pages/" + p.id, null).properties || {}; } catch (e) {} }
  if (!moOutraPode_(sess, item, origem, atvP)) return { ok: false, erro: "SEM_PERMISSAO" };
  var k = String(p.k || ""), valor = p.valor === "" ? null : p.valor, r;
  if (origem === "Obras") {
    var mapa = { status: "Status", fim: "Data Final Prevista", conclusao: "Data De Conclusão da Atividade" };
    if (!mapa[k]) return { ok: false, erro: "CAMPO_NAO_LIBERADO" };
    r = obraAtvUpdate_(sess, { pageId: p.id, prop: mapa[k], valor: valor, conclusaoSeVazia: true });
  } else if (k === "fim") {
    var atv = notion_("GET", "/pages/" + p.id, null), dfn = moDataProp_(atv.properties || {}, ["DATA FINAL PREVISTA", "DATA FINAL"]);
    if (!dfn) return { ok: false, erro: "CAMPO_INEXISTENTE" };
    var pr = {}; pr[dfn] = buildValue_("date", valor);
    notion_("PATCH", "/pages/" + p.id, { properties: pr });
    r = { ok: true };
  } else if (k.indexOf("v:") === 0 && origem === "Vendas") {
    if (!p.vendaId) return { ok: false, erro: "FALTA_PARAM" };
    r = moVendaAplicar_(sess, { pageId: p.vendaId, campo: k.slice(2), valor: valor, quando: p.quando });
  } else if (k === "baixa" && origem === "Vendas") {
    r = baixa_(sess, { atividadeId: p.id, valor: valor || "SIM" });
  } else if (k === "baixa" && origem === "Documentos") {
    r = docBaixa_(sess, { atividadeId: p.id, valor: valor || "SIM" });
  } else return { ok: false, erro: "CAMPO_NAO_LIBERADO" };
  if (!r || !r.ok) return r || { ok: false, erro: "SEM_RESPOSTA" };
  /* a atividade fechou? (sem refazer a lista inteira — o gatilho refaz depois) */
  try { cacheRemover_(origem === "Vendas" ? AL_CH_VENDAS : AL_CH_DOCS); } catch (e) {}
  var fechou = false;
  try {
    if (origem === "Obras") fechou = (k === "status" && /finaliz|conclu|cancel/i.test(String(valor || ""))) || (k === "conclusao" && !!valor);
    else if (k === "baixa") fechou = !alAberto_(valor || "SIM");
    else if (k.indexOf("v:") === 0) {
      var at = notion_("GET", "/pages/" + p.id, null), tipo = sel_(getTol_(at.properties || {}, "TIPO")) || "";
      var vp = notion_("GET", "/pages/" + p.vendaId, null).properties || {};
      var regra = alVendaFechada_(tipo, vp);
      if (regra !== null) fechou = regra;
      else { var col = alColunaVendas_(tipo), pc = col ? alProp_(vp, col) : null; fechou = !!(pc && !alAberto_(alTexto_(pc))); }
    }
  } catch (e) { console.log("ATIVIDADES fechou? " + e); }
  try {
    var sn = cacheGet_(RF_SNAP_OUT), alvo = String(p.id).replace(/-/g, "");
    if (sn && sn.itens) {
      if (fechou) sn.itens = sn.itens.filter(function (x) { return x.id !== alvo; });
      else if (k === "fim") sn.itens.forEach(function (x) { if (x.id === alvo) x.fim = valor; });
      cachePut_(RF_SNAP_OUT, sn, 21600);
    }
  } catch (e) {}
  if (origem !== "Obras") { try { avisarGitHub_("atividade " + origem); } catch (e) {} }
  r.fechada = fechou;
  console.log("ATIVIDADES: " + (sess.u || "?") + " editou (" + origem + ") " + p.id + " · " + k + " = " + valor + (fechou ? " · concluída" : ""));
  return r;
}

/* ------------------------ medições da semana ------------------------ */
function moTerca_() {
  var hoje = new Date(Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd") + "T12:00:00");
  var volta = (hoje.getDay() - 2 + 7) % 7;             // 2 = terça
  hoje.setDate(hoje.getDate() - volta);
  return Utilities.formatDate(hoje, "America/Sao_Paulo", "yyyy-MM-dd");
}
function moSupa_(method, caminho, corpo, extra) {
  var cfg = supaCfg_();
  var h = { apikey: cfg.key, Authorization: "Bearer " + cfg.key, Accept: "application/json" };
  for (var k in (extra || {})) h[k] = extra[k];
  var opt = { method: method, muteHttpExceptions: true, headers: h };
  if (corpo !== undefined && corpo !== null) { opt.contentType = "application/json"; opt.payload = JSON.stringify(corpo); }
  var r = UrlFetchApp.fetch(cfg.url + "/rest/v1/" + caminho, opt);
  var code = r.getResponseCode(), txt = r.getContentText();
  if (code >= 300) throw "SUPABASE_" + code + ": " + txt.slice(0, 200);
  return txt ? JSON.parse(txt) : null;
}
function moMedLista_(sess, p) {
  var semana = moTerca_(), setor = String(p.setor || "").trim();
  if (!setor) return { ok: false, erro: "FALTA_SETOR" };
  var l = moSupa_("get", "obra_medicoes?semana=eq." + semana + "&setor=eq." + encodeURIComponent(setor) + "&select=ref,status,por,atualizado_em") || [];
  var itens = {};
  l.forEach(function (x) { itens[String(x.ref).toUpperCase()] = { status: x.status, por: x.por || "", em: x.atualizado_em }; });
  return { ok: true, semana: semana, itens: itens, podeMedir: moPodeMedir_(sess) };
}
function moMedSalvar_(sess, p) {
  if (!moPodeMedir_(sess)) return { ok: false, erro: "SEM_PERMISSAO" };
  var ref = String(p.ref || "").trim().toUpperCase(), setor = String(p.setor || "").trim();
  if (!ref || !setor) return { ok: false, erro: "FALTA_PARAM" };
  if (MO_MEDICAO.indexOf(p.status) < 0) return { ok: false, erro: "STATUS_INVALIDO" };
  var semana = moTerca_();
  moSupa_("post", "obra_medicoes?on_conflict=semana,ref", {
    semana: semana, ref: ref, setor: setor, endereco: String(p.endereco || "").slice(0, 200),
    status: p.status, por: sess.n || sess.u || "", atualizado_em: new Date().toISOString()
  }, { Prefer: "resolution=merge-duplicates,return=minimal" });
  return { ok: true, semana: semana };
}

/* --------------------------- GitHub --------------------------- */
function moAvisarGitHub_(motivo, forcar) {
  var tk = prop_("GITHUB_TOKEN");
  if (!tk) return { ok: false, motivo: "SEM_GITHUB_TOKEN" };
  var pr = PropertiesService.getScriptProperties();
  var ult = Number(pr.getProperty("MO_GH_ULT") || 0);
  if (!forcar && Date.now() - ult < MO_JANELA_MS) { pr.setProperty("MO_GH_PENDENTE", "1"); return { ok: true, pulou: true }; }
  var repo = prop_("MAPA_OBRAS_REPO") || "DEVMoraisEng/OBRAS-GERAL";
  var r = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/dispatches", {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { Authorization: "Bearer " + tk, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    payload: JSON.stringify({ event_type: MO_EVENTO, client_payload: { motivo: String(motivo || ""), em: new Date().toISOString() } })
  });
  var ok = r.getResponseCode() < 300;
  if (ok) { pr.setProperty("MO_GH_ULT", String(Date.now())); pr.deleteProperty("MO_GH_PENDENTE"); }
  else console.log("MAPA GitHub " + r.getResponseCode() + ": " + r.getContentText().slice(0, 200));
  return { ok: ok, codigo: r.getResponseCode() };
}

/* ------------- gatilho: mudou no Notion → republica o mapa ------------- */
function moUltimaEdicao_(dbId) {
  try {
    var r = notion_("POST", "/databases/" + dbId + "/query", { page_size: 1, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] });
    return ((r.results || [])[0] || {}).last_edited_time || "";
  } catch (e) { console.log("MAPA última edição " + dbId + ": " + String(e).slice(0, 120)); return ""; }
}
function moVerificarNotion() {
  if (typeof ehPapelLeitura_ === "function" && ehPapelLeitura_()) return;   // só no ESCRITA
  var h = Number(Utilities.formatDate(new Date(), "America/Sao_Paulo", "H"));
  if (h < 6 || h > 22) return;
  var pr = PropertiesService.getScriptProperties();
  var ult = pr.getProperty("MO_ULT_EDIT") || "";
  var docs = moUltimaEdicao_(CONFIG.DB.DOCUMENTOS), vend = moUltimaEdicao_(CONFIG.DB.VENDAS);
  var maior = [docs, vend].sort().pop() || "";
  try { moConferirEnderecos(); } catch (e) { console.log("MAPA endereços: " + String(e).slice(0, 160)); }   // mo3
  try { moPreencherContadores_(40); } catch (e) { console.log("MAPA contadores: " + String(e).slice(0, 160)); }   // mo3
  if ((maior && maior > ult) || pr.getProperty("MO_GH_PENDENTE")) {
    var r = moAvisarGitHub_("notion " + maior, true);
    if (r.ok) pr.setProperty("MO_ULT_EDIT", maior || ult);
    console.log("MAPA: mudou no Notion (" + maior + ") → build " + JSON.stringify(r));
  }
}
function moCriarGatilho() {
  moRemoverGatilho();
  ScriptApp.newTrigger("moVerificarNotion").timeBased().everyMinutes(10).create();
  Logger.log("Gatilho moVerificarNotion criado (a cada 10 min, das 6h às 22h).");
  moVerificarNotion();
}
function moRemoverGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "moVerificarNotion") ScriptApp.deleteTrigger(t); });
}
/* teste pelo editor: dispara um build do mapa agora */
function moTesteGitHub() { Logger.log(JSON.stringify(moAvisarGitHub_("teste manual", true))); }
