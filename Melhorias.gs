/*************************************************************************
 * Melhorias.gs · Morais Engenharia — pacote de 23/09/2026
 * -----------------------------------------------------------------------
 * Vai nos DOIS projetos (PORTAL-LEITURA e PORTAL-ESCRITA), ao lado do
 * Código.gs. Tudo o que é novo mora aqui; o Código.gs só ganha três linhas
 * (ver o arquivo LEIA-ME que veio junto).
 *
 * SUBSTITUI o ContasBancarias.gs do MD das contas: se você já criou aquele
 * arquivo, APAGUE-O, e tire também as duas linhas que o MD mandou colar no
 * Código.gs (o case "contasBancarias" e o bloco "rConta"). As funções têm os
 * mesmos nomes — deixar os dois faz um sobrescrever o outro.
 *
 * AÇÕES NOVAS (todas passam pelo melhoriasRotear_, que confere acesso,
 * trava o perfil TESTES e pede a republicação do site quando grava):
 *   contasBancarias        lista de contas do banco CONTAS BANCÁRIAS
 *   obraConta              troca a conta bancária de uma obra
 *   obraLiberar            "Liberar obra p/ processo interno" (fica na LEITURA,
 *                          onde o ObrasSync cria a Compatibilização na hora)
 *   obraVivo               a obra e as atividades dela lidas do Notion AGORA
 *   obraAtvConteudoLote    checklist de várias atividades de uma vez
 *   obraComentarios        comentários de uma obra ou atividade
 *   obraComentarioNovo     comentário novo (com imagem/arquivo opcional)
 *   ligArquivo             link do anexo das ligações (espelho no Supabase)
 *   investidores           cadastro de investidores, sem dado sensível
 *   investidoresSensiveis  CPF/CNPJ e afins, só quando pedido
 *   investidorUpdate       edição do cadastro (só ADM e MASTER)
 *   melhoriasVersao        diagnóstico
 *   aniversariantes        (m9, 25/09/26) aniversários do LOGINS — só dia/mês,
 *                          sem ano; a função mora no RetaFinal.gs
 *   proc* / bloco* / atv*  (m10/m11) Processos, Arquivos, editor de conteúdo e
 *                          Atividades (m11: retrato + gatilho, atvAbrir) —
 *                          roteados pelo rfRotear_ do RetaFinal.gs
 *************************************************************************/

var VERSAO_MELHORIAS = "2026-09-25 m12";

var MEL_ACOES = {
  contasBancarias:       { acesso: "OBRAS" },
  contasTodas:           { acesso: "OBRAS" },
  contaAparece:          { acesso: "OBRAS", grava: true },
  obraConta:             { acesso: "OBRAS", grava: true, publica: true },
  obraLiberar:           { acesso: "OBRAS", grava: true, publica: true },
  obraVivo:              { acesso: "OBRAS" },
  obraAtvConteudoLote:   { acesso: "OBRAS" },
  obraComentarios:       { acesso: "OBRAS" },
  obraComentarioNovo:    { acesso: "OBRAS", grava: true },
  ligArquivo:            { acesso: "LIGAÇÕES" },
  investidores:          { acesso: "OBRAS" },
  investidoresSensiveis: { acesso: "OBRAS" },
  investidorUpdate:      { acesso: "OBRAS", grava: true },
  melhoriasVersao:       { acesso: null },
  aniversariantes:       { acesso: null },   // m9 — todo mundo logado vê (combinado)
  aoVivoConfig:          { acesso: null },
  /* m8 — versões rápidas das ações das Simulações (o acesso quem confere é o
     próprio simsRotear_, chamado por dentro) */
  simsDetalheRapido:     { acesso: null },
  simsLinkRapido:        { acesso: null, grava: true }
};

function melhoriasRotear_(action, sess, p) {
  /* m10 — ações da reta final (Processos, Atividades) moram no RetaFinal.gs */
  if (typeof rfRotear_ === "function") { var rRf = rfRotear_(action, sess, p); if (rRf) return rRf; }
  var cfg = MEL_ACOES[action];
  if (!cfg) return null;
  if (cfg.acesso && !temAcesso_(sess, cfg.acesso)) {
    console.log("BLOQUEADO por falta de acesso " + cfg.acesso + ": " + sess.u + " -> " + action);
    return { ok: false, erro: "SEM_PERMISSAO" };
  }
  if (cfg.grava && ehTestes_(sess)) return { ok: false, erro: "MODO_TESTE" };

  var r;
  switch (action) {
    case "contasBancarias":       r = contasBancarias_(sess, p); break;
    case "contasTodas":           r = contasTodas_(sess, p); break;
    case "contaAparece":          r = contaAparece_(sess, p); break;
    case "obraConta":             r = obraConta_(sess, p); break;
    case "obraLiberar":           r = obraUpdate_(sess, p); break;
    case "obraVivo":              r = obraVivo_(sess, p); break;
    case "obraAtvConteudoLote":   r = obraAtvConteudoLote_(sess, p); break;
    case "obraComentarios":       r = obraComentarios_(sess, p); break;
    case "obraComentarioNovo":    r = obraComentarioNovo_(sess, p); break;
    case "ligArquivo":            r = ligArquivo_(sess, p); break;
    case "investidores":          r = investidores_(sess, p); break;
    case "investidoresSensiveis": r = investidoresSensiveis_(sess, p); break;
    case "investidorUpdate":      r = investidorUpdate_(sess, p); break;
    case "aoVivoConfig":          r = aoVivoConfig_(sess, p); break;
    case "aniversariantes":       r = (typeof rfAniversariantes_ === "function") ? rfAniversariantes_(sess, p)
                                        : { ok: false, erro: "RetaFinal.gs ausente nesta versão publicada" }; break;
    case "simsDetalheRapido":     r = melSimsSemConversa_("simsPropostaDetalhe", sess, p); break;
    case "simsLinkRapido":        r = melSimsSemConversa_("simsPropostaLink", sess, p); break;
    case "melhoriasVersao":       r = { ok: true, versao: VERSAO_MELHORIAS, codigo: VERSAO_GS,
                                        papel: String(PAPEL).toUpperCase(),
                                        simulacoes: typeof simsRotear_ === "function",
                                        obrasSync: typeof obrGarantirCompat_ === "function",
                                        retaFinal: typeof rfAniversariantes_ === "function" }; break;
    default: return null;
  }
  if (cfg.publica && r && r.ok) { try { avisarGitHub_(action); } catch (e) {} }
  /* o aviso AO VIVO é feito pelo handle_ do Código.gs, para toda resposta ok */
  return r;
}

/* ---------- utilitários locais (nomes com "mel" para não colidir) ---------- */
function melSemHifen_(id) { return String(id || "").replace(/-/g, ""); }
function melTexto_(pp) {
  if (!pp) return null;
  var t = pp.type, v = pp[t];
  if (t === "title" || t === "rich_text") return (v || []).map(function (x) { return x.plain_text || ""; }).join("") || null;
  if (t === "select" || t === "status") return (v && v.name) || null;
  if (t === "multi_select") return (v || []).map(function (x) { return x.name; }).join(", ") || null;
  if (t === "people") return (v || []).map(function (x) { return x.name || ""; }).join(", ") || null;
  if (t === "date") return (v && v.start) ? String(v.start).slice(0, 10) : null;
  if (t === "number") return v;
  if (t === "checkbox") return v ? "Sim" : null;
  if (t === "formula") {
    if (!v) return null;
    var fv = v[v.type];
    if (v.type === "date") return fv && fv.start ? String(fv.start).slice(0, 10) : null;
    return fv === undefined ? null : fv;
  }
  if (t === "rollup") {
    if (v && v.type === "array") {
      var partes = (v.array || []).map(melTexto_).filter(function (x) { return x !== null && x !== ""; });
      return partes.length ? partes.join(", ") : null;
    }
    return v ? v[v.type] : null;
  }
  if (t === "url" || t === "email" || t === "phone_number") return v || null;
  return null;
}
function melIds_(pp) {
  var t = pp && pp.type;
  if (t === "people" || t === "relation") return (pp[t] || []).map(function (x) { return x.id; }).filter(Boolean);
  return [];
}
function melPega_(props, nome) {
  var alvo = normDist_(nome);
  for (var k in (props || {})) if (normDist_(k) === alvo) return props[k];
  return null;
}
function melPai_(pg) { return melSemHifen_((pg.parent || {}).database_id); }

/* =======================================================================
 * CONTAS BANCÁRIAS — m2 (23/09/26)
 * O banco CONTAS BANCÁRIAS (criado à mão no Notion, id abaixo) é mantido pelo
 * robo_mc_contas.py com as contas do Mais Controle. Na (EMP) Projeto 2.0 a
 * coluna CONTA é uma SELEÇÃO cujas opções são os nomes dessas contas (coluna
 * "Nome na obra"), mais PESSOA FÍSICA, CRIAR CONTA e DÚVIDA. É o mesmo nome
 * que o robô escolhe na lista do Mais Controle ao criar a obra.
 * ===================================================================== */
var CONTAS_DB_FIXO = "3e4c5ab532d380afbd3bf9f7af31d2a7";
var CONTAS_COL_OBRA = "CONTA";
var CONTA_PF = "PESSOA FÍSICA", CONTA_CRIAR = "CRIAR CONTA", CONTA_DUVIDA = "DÚVIDA";

function contasBancoId_() {
  return PropertiesService.getScriptProperties().getProperty("DB_CONTAS_BANCARIAS") || CONTAS_DB_FIXO;
}
function contaOpcaoDe_(nome) {   // mesma regra do nome_opcao do robô
  return String(nome || "").replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
function contasLista_() {
  return comCache_("contas_bancarias_v2", 300, function () {
    var pags = queryAll_(contasBancoId_(), { filter: { property: "Aparece", checkbox: { equals: true } } });
    var lista = [];
    pags.forEach(function (pg) {
      var pr = pg.properties || {}, titulo = "", situacao = "", opcao = "";
      for (var n in pr) {
        if (pr[n].type === "title") titulo = melTexto_(pr[n]) || "";
        if (normDist_(n) === normDist_("Situação no ERP")) situacao = melTexto_(pr[n]) || "";
        if (normDist_(n) === normDist_("Nome na obra")) opcao = melTexto_(pr[n]) || "";
      }
      if (!titulo) return;
      if (normDist_(situacao) === normDist_("Sumiu do ERP")) return;
      lista.push({ id: pg.id, nome: titulo.trim(), opcao: opcao || contaOpcaoDe_(titulo) });
    });
    lista.sort(function (a, b) { return a.opcao.localeCompare(b.opcao, "pt-BR"); });
    return lista;
  });
}
function contasBancarias_(sess, p) { return { ok: true, contas: contasLista_() }; }

/* m3 — aba "Contas bancárias" da tela de obras: TODAS as contas do banco
   (aparecendo ou não), com Conta, Aparece e Situação. Sem cache: é a tela
   onde se liga/desliga o Aparece e precisa mostrar o Notion na hora. */
function contasTodas_(sess, p) {
  var lista = queryAll_(contasBancoId_(), {}).map(function (pg) {
    var pr = pg.properties || {}, conta = "", aparece = false, situacao = "";
    for (var n in pr) {
      if (pr[n].type === "title") conta = melTexto_(pr[n]) || "";
      if (normDist_(n) === normDist_("Aparece")) aparece = !!pr[n].checkbox;
      if (normDist_(n) === normDist_("Situação no ERP")) situacao = melTexto_(pr[n]) || "";
    }
    return { id: pg.id, conta: conta, aparece: aparece, situacao: situacao };
  }).filter(function (c) { return c.conta; });
  lista.sort(function (a, b) { return a.conta.localeCompare(b.conta, "pt-BR"); });
  return { ok: true, contas: lista, podeEditar: ehAdm_(sess) || ehMaster_(sess) };
}
function contaAparece_(sess, p) {
  if (!ehAdm_(sess) && !ehMaster_(sess)) return { ok: false, erro: "APENAS_ADM_MASTER" };
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  if (melPai_(pg) !== melSemHifen_(contasBancoId_())) return { ok: false, erro: "NAO_E_CONTA" };
  var col = null;
  for (var n in (pg.properties || {})) if (normDist_(n) === normDist_("Aparece")) col = n;
  if (!col) return { ok: false, erro: "CAMPO_INEXISTENTE: Aparece" };
  var props = {}; props[col] = { checkbox: p.aparece === true || p.aparece === "true" };
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  cacheRemover_("contas_bancarias_v2");
  console.log("CONTAS: " + sess.u + " marcou Aparece=" + props[col].checkbox + " em " + p.pageId);
  return { ok: true, aparece: props[col].checkbox };
}

/* Coluna CONTA das obras, e se ela já é seleção. Enquanto o robô não tiver
   convertido a fórmula antiga, a conta simplesmente não é gravada (a obra
   nasce do mesmo jeito). */
function contasColObra_() {
  var sch = obraSchema_(), col = obraColReal_(sch, CONTAS_COL_OBRA);
  if (col && sch[col].type === "select") return { col: col, def: sch[col] };
  sch = notion_("GET", "/databases/" + OBRAS_DB_PORTAL, null).properties || {};
  col = obraColReal_(sch, CONTAS_COL_OBRA);
  if (col && sch[col].type === "select") { cacheRemover_("obras_schema_v1"); return { col: col, def: sch[col] }; }
  return null;
}
/* Nome da opção válida para a conta pedida, ou null. Aceita o nome da conta,
   PESSOA FÍSICA e CRIAR CONTA (DÚVIDA só o robô põe). "SEM" = pessoa física. */
function contaValida_(valor) {
  var v = String(valor || "").trim();
  if (!v || v === "SEM") return CONTA_PF;
  if (normDist_(v) === normDist_(CONTA_PF)) return CONTA_PF;
  if (normDist_(v) === normDist_(CONTA_CRIAR)) return CONTA_CRIAR;
  var achada = null;
  contasLista_().forEach(function (c) { if (normDist_(c.opcao) === normDist_(v) || melSemHifen_(c.id) === melSemHifen_(v)) achada = c.opcao; });
  return achada;
}
/* Chamada pelo obraNova_ (via melhoriasObraNova_). {col, v} | {} | {erro} */
function contaBancariaDaObra_(p) {
  var pedido = (p && (p.conta || p.contaId)) || "";
  var col = contasColObra_();
  if (!col) return {};                             // coluna ainda é a fórmula antiga
  var opc = contaValida_(pedido);
  if (!opc) return { erro: "CONTA_BANCARIA_INVALIDA" };
  return { col: col.col, v: { select: { name: opc } } };
}
function obraConta_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  if (melPai_(pg) !== OBRAS_DB_PORTAL) return { ok: false, erro: "NAO_E_OBRA" };
  var col = contasColObra_();
  if (!col) return { ok: false, erro: "CONTA_AINDA_E_FORMULA: rode o Robô de contas bancárias com Gravar de verdade" };
  var opc = contaValida_(p.conta || p.contaId);
  if (!opc) return { ok: false, erro: "CONTA_BANCARIA_INVALIDA" };
  var props = {}; props[col.col] = { select: { name: opc } };
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  console.log("OBRAS: " + sess.u + " trocou a conta bancária de " + p.pageId);
  return { ok: true, conta: opc };
}

/* =======================================================================
 * OBRA NOVA — chamada de dentro do obraNova_ do Código.gs (ver LEIA-ME).
 * 1) grava a conta bancária escolhida;
 * 2) os quatro Sim/Não nascem "Não" (Liberar já vinha; entram Projeto
 *    Finalizado, Orçamento Finalizado e Projeto Aprovado).
 * ===================================================================== */
var OBRA_NASCE_NAO = ["Projeto Finalizado", "Orçamento Finalizado", "Projeto Aprovado",
                      "Liberar Obra Para Processo Interno"];
function melhoriasObraNova_(sch, p, props) {
  var rc = contaBancariaDaObra_(p);
  if (rc.erro) return rc;
  if (rc.col) props[rc.col] = rc.v;
  OBRA_NASCE_NAO.forEach(function (nome) {
    var col = obraColReal_(sch, nome);
    if (!col || props[col]) return;
    var def = sch[col];
    if (def.type !== "select" && def.type !== "status") return;
    var nao = obraOpcaoReal_(def, "Não");
    if (nao) props[col] = buildValue_(def.type, nao);
  });
  return {};
}

/* =======================================================================
 * OBRA AO VIVO (itens 2 e 3)
 * A tela lê o dist/obras.json, que só muda no próximo build. Depois de
 * gravar, ela pede aqui a obra e as atividades dela direto do Notion — é
 * assim que a "Armazenar projetos" criada pela automação do Notion aparece
 * na hora, e o CONTROLE DE PRAZO (fórmula) já vem recalculado.
 * Mesmo formato do fetch_obras.py, sem nada sensível.
 * ===================================================================== */
function obraVivo_(sess, p) {
  var id = p.obraId || p.pageId;
  if (!id) return { ok: false, erro: "FALTA_PARAM" };
  var pg = notion_("GET", "/pages/" + id, null);
  if (melPai_(pg) !== OBRAS_DB_PORTAL) return { ok: false, erro: "NAO_E_OBRA" };
  var pr = pg.properties || {}, sch = obraSchema_();
  var colCota = obraColReal_(sch, "COTA DA EMPRESA (%)");
  var cota = melTexto_(melPega_(pr, "COTA DA EMPRESA (%)"));
  if (typeof cota === "number" && colCota && sch[colCota].number && sch[colCota].number.format === "percent")
    cota = Math.round(cota * 100 * 10000) / 10000;
  var resp = melPega_(pr, "Responsável Pela Obra"), rt = melPega_(pr, "ENGENHEIRO RT");
  var conta = melPega_(pr, CONTAS_COL_OBRA);
  var obra = {
    id: pg.id, titulo: melTexto_(melPega_(pr, "Projeto")) || tituloDe_(pr),
    setor: melTexto_(melPega_(pr, "SETOR")), cidade: melTexto_(melPega_(pr, "Cidade")),
    proprietario: melTexto_(melPega_(pr, "Proprietário")),
    proprietario_real: melTexto_(melPega_(pr, "Proprietário Real")),
    resp: melTexto_(resp), resp_ids: melIds_(resp), rt: melTexto_(rt), rt_ids: melIds_(rt),
    status: melTexto_(melPega_(pr, "Status")),
    liberar: melTexto_(melPega_(pr, "Liberar Obra Para Processo Interno")),
    projeto_finalizado: melTexto_(melPega_(pr, "Projeto Finalizado")),
    orcamento_finalizado: melTexto_(melPega_(pr, "Orçamento Finalizado")),
    projeto_aprovado: melTexto_(melPega_(pr, "Projeto Aprovado")),
    data_inicial: melTexto_(melPega_(pr, "Data Inicial")),
    data_prevista: melTexto_(melPega_(pr, "Data Prevista P/ Término")),
    data_conclusao: melTexto_(melPega_(pr, "Data de Conclusão do Processo")),
    controle_prazo: melTexto_(melPega_(pr, "CONTROLE DE PRAZO")),
    n_casas: melTexto_(melPega_(pr, "Nº DE CASAS")), cota: cota,
    data_lote: melTexto_(melPega_(pr, "DATA DE AQUISIÇÃO DO LOTE")),
    implantacao: melTexto_(melPega_(pr, "IMPLANTAÇÃO")),
    area_lote: melTexto_(melPega_(pr, "ÁREA DO LOTE")),
    area_averbada: melTexto_(melPega_(pr, "ÁREA CONSTRUÍDA AVERBADA")),
    area_habite: melTexto_(melPega_(pr, "ÁREA PÓS HABITE-SE")),
    estudo_layout: melTexto_(melPega_(pr, "PRECISA DE ESTUDO DE LAYOUT")),
    mais_controle: melTexto_(melPega_(pr, "MAIS CONTROLE")),
    conta: conta && conta.type === "select" ? melTexto_(conta) : null,
    conta_alerta: (function () {
      if (!conta || conta.type !== "select") return null;
      var v = normDist_(melTexto_(conta) || "");
      if (!v) return "VAZIA";
      return v === normDist_(CONTA_CRIAR) ? CONTA_CRIAR : (v === normDist_(CONTA_DUVIDA) ? CONTA_DUVIDA : null);
    })()
  };
  var atvs = queryAll_(OBRA_ATIV_DB, { filter: { property: "(EMP) Projeto 2.0", relation: { contains: pg.id } } })
    .map(function (a) {
      var ap = a.properties || {}, r = melPega_(ap, "Responsável");
      return {
        id: a.id, titulo: melTexto_(melPega_(ap, "Atividade")) || tituloDe_(ap),
        tipo: melTexto_(melPega_(ap, "Tipo")), status: melTexto_(melPega_(ap, "Status")),
        resp: ((r && r.people) || []).map(function (u) { return u.name; }).filter(Boolean),
        data_criacao: melTexto_(melPega_(ap, "Data de criação")),
        data_inicio: melTexto_(melPega_(ap, "Data De Início")),
        data_final: melTexto_(melPega_(ap, "Data Final Prevista")),
        data_conclusao: melTexto_(melPega_(ap, "Data De Conclusão da Atividade")),
        controle_prazo: melTexto_(melPega_(ap, "CONTROLE DE PRAZO")),
        obra_id: pg.id
      };
    });
  return { ok: true, lidoEm: new Date().toISOString(), obra: obra, atividades: atvs };
}

/* =======================================================================
 * CHECKLIST DE VÁRIAS ATIVIDADES DE UMA VEZ (extra 2 — "demora para abrir")
 * A tela pede isto ao abrir a obra, em segundo plano: quando a pessoa clica
 * numa atividade, o conteúdo já está no navegador. Uma execução só, com
 * todas as árvores descendo em paralelo (fetchAll), em vez de uma execução
 * por atividade na fila.
 * ===================================================================== */
var MEL_CONT_SEG = 10800;   // m5: 3 h (o aquecimento renova; marcar item do checklist apaga na hora)
function obraAtvConteudoLote_(sess, p) {
  var ids = p.ids;
  if (typeof ids === "string") { try { ids = JSON.parse(ids); } catch (e) { ids = String(ids).split(","); } }
  ids = (ids || []).map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 25);
  if (!ids.length) return { ok: true, conteudos: {} };

  var out = {}, faltam = [];
  ids.forEach(function (id) {
    var c = p.fresco ? null : cacheGet_("atv_cont_" + melSemHifen_(id));
    if (c) out[id] = c; else faltam.push(id);
  });
  if (!faltam.length) return { ok: true, conteudos: out, comentarios: melComsEmCache_(ids) };

  var tok = tokenNotion_(), hdr = { Authorization: "Bearer " + tok, "Notion-Version": CONFIG.NOTION_VERSION };
  /* só página que é mesmo ATIVIDADE DE PROJETOS (senão qualquer id do
     workspace teria o conteúdo lido por aqui) */
  var pags = UrlFetchApp.fetchAll(faltam.map(function (id) {
    return { url: "https://api.notion.com/v1/pages/" + id, method: "get", muteHttpExceptions: true, headers: hdr };
  }));
  var validos = [];
  pags.forEach(function (r, i) {
    if (r.getResponseCode() >= 300) return;
    try { if (melPai_(JSON.parse(r.getContentText())) === OBRA_ATIV_DB) validos.push(faltam[i]); } catch (e) {}
  });
  var arv = melArvores_(validos, hdr);
  validos.forEach(function (id) {
    out[id] = arv[id];
    melGuardarConteudo_(id, arv[id]);
  });
  return { ok: true, conteudos: out, comentarios: melComsEmCache_(ids) };
}
function melArvores_(ids, hdr, lento) {
  function texto(rt) { return (rt || []).map(function (x) { return x.plain_text || ""; }).join(""); }
  var raizes = {}, fila = [], total = {}, voltas = 0;
  ids.forEach(function (id) { raizes[id] = { filhos: [] }; total[id] = 0; fila.push({ id: id, destino: raizes[id], nivel: 1, raiz: id }); });
  while (fila.length && voltas++ < 80) {
    /* m8: 5 páginas por vez (3 no aquecimento, com pausa) — 10 de uma vez
       estourava o limite de pedidos do Notion */
    var lote = fila.splice(0, lento ? 3 : 5), atrasou = false;
    var resps = UrlFetchApp.fetchAll(lote.map(function (x) {
      return { url: "https://api.notion.com/v1/blocks/" + x.id + "/children?page_size=100" + (x.cursor ? "&start_cursor=" + x.cursor : ""),
               method: "get", muteHttpExceptions: true, headers: hdr };
    }));
    resps.forEach(function (r, i) {
      var x = lote[i], code = r.getResponseCode();
      if (code === 429 || code >= 500) { fila.push(x); atrasou = true; if (code === 429) MEL_429 = true; return; }
      if (code >= 300) return;
      var j = JSON.parse(r.getContentText());
      (j.results || []).forEach(function (b) {
        if (total[x.raiz]++ > 500) return;
        var t = b.type, d = b[t] || {};
        var item = { id: b.id, tipo: t, texto: texto(d.rich_text) };
        /* m7: texto com link no Notion ("clique aqui" -> endereço) vira link na tela */
        var lk = (d.rich_text || []).filter(function (x) { return x.href; })
                   .map(function (x) { return { t: x.plain_text || "", h: x.href }; });
        if (lk.length) item.links = lk;
        if (t === "to_do") item.marcado = !!d.checked;
        if (t === "child_page") item.texto = d.title || "";
        if (t === "image" || t === "file" || t === "pdf") {
          item.url = (d.file && d.file.url) || (d.external && d.external.url) || null;
          item.texto = texto(d.caption) || d.name || "";
        }
        x.destino.filhos.push(item);
        if (b.has_children && x.nivel < 4 && t !== "child_page" && t !== "child_database") {
          item.filhos = [];
          fila.push({ id: b.id, destino: item, nivel: x.nivel + 1, raiz: x.raiz });
        }
      });
      if (j.has_more) fila.push({ id: x.id, destino: x.destino, nivel: x.nivel, raiz: x.raiz, cursor: j.next_cursor });
    });
    if (atrasou) Utilities.sleep(1200);
    else if (lento) Utilities.sleep(400);          // m8: aquecimento sem pressa
  }
  var out = {};
  ids.forEach(function (id) { out[id] = raizes[id].filhos; });
  return out;
}

/* =======================================================================
 * COMENTÁRIOS E IMAGENS EM OBRAS E ATIVIDADES (extra 1)
 * São os comentários nativos do Notion (os mesmos que aparecem lá na
 * página). O nome de quem escreveu vai no começo do texto, porque pela API
 * todo comentário sai como a integração.
 * PRÉ-REQUISITO: a integração precisa de "Read comments" e "Insert
 * comments" (Notion > Integrações > Capacidades) — o comentarios_ das
 * Vendas já exige o mesmo.
 * ===================================================================== */
function melPaginaComentavel_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null), pai = melPai_(pg);
  if (pai !== OBRAS_DB_PORTAL && pai !== OBRA_ATIV_DB) throw "PAGINA_NAO_PERMITIDA";
  return pg;
}
/* m6 (24/09/26) — COMENTÁRIOS RÁPIDOS. Antes: a cada abertura, 1 ida ao
   Notion para conferir a página + 1 (ou mais) para ler os comentários, sem
   cache nenhum. Agora:
     - a conferência "é obra/atividade?" fica 6 h guardada por página;
     - os comentários ficam no cache (frescos por 30 min; comentário novo
       feito pelo portal apaga a cópia na hora);
     - o aquecimento (aquecerConteudos_) já deixa prontos os comentários das
       atividades abertas, junto com o checklist;
     - o pré-carregamento em lote devolve os comentários que já estão no
       cache, então a atividade abre com eles na tela. */
var MEL_COMS_FRESCO = 1800;
function melConfereComentavel_(pageId) {
  var ck = "pgok_" + melSemHifen_(pageId);
  try { if (_cache_().get(ck)) return; } catch (e) {}
  melPaginaComentavel_(pageId);
  try { _cache_().put(ck, "1", 21600); } catch (e) {}
}
function melComsChave_(id) { return "coms_" + melSemHifen_(id); }
function obraComentarios_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  try { melConfereComentavel_(p.pageId); } catch (e) { return { ok: false, erro: String(e) }; }
  if (p.fresco) cacheRemover_(melComsChave_(p.pageId));
  return comCache_(melComsChave_(p.pageId), MEL_COMS_FRESCO, function () { return melLerComentarios_(p.pageId); });
}
function melLerComentarios_(pageId) {
  var todos = [], cursor = null, voltas = 0;
  do {
    var r = obraNotionV_("GET", "/comments?block_id=" + encodeURIComponent(pageId) + "&page_size=100" +
                         (cursor ? "&start_cursor=" + encodeURIComponent(cursor) : ""), null);
    todos = todos.concat(r.results || []);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++voltas < 10);
  return melComentariosDe_(todos);
}
function melComentariosDe_(todos) {
  var lista = todos.map(function (c) {
    var txt = (c.rich_text || []).map(function (t) { return t.plain_text || ""; }).join("");
    var m = txt.match(/^\[([^\]]{1,80})\]\s*/);
    return {
      id: c.id, discussionId: c.discussion_id, criadoEm: c.created_time,
      autor: m ? m[1] : "Notion", texto: m ? txt.slice(m[0].length) : txt,
      anexos: (c.attachments || []).map(function (a) {
        return { categoria: a.category || "", url: (a.file && a.file.url) || null, nome: a.name || "" };
      })
    };
  }).sort(function (a, b) { return String(a.criadoEm).localeCompare(String(b.criadoEm)); });
  return { ok: true, comentarios: lista, lidoEm: new Date().toISOString() };
}
function melSubirArquivo_(filename, mime, b64) {
  var fu = notion_("POST", "/file_uploads", { filename: filename, content_type: mime });
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, filename);
  var r = UrlFetchApp.fetch(fu.upload_url, {
    method: "post", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + tokenNotion_(), "Notion-Version": CONFIG.NOTION_VERSION },
    payload: { file: blob }
  });
  if (r.getResponseCode() >= 300) throw "UPLOAD_FALHOU: " + r.getContentText().slice(0, 200);
  return fu.id;
}
function obraComentarioNovo_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "FALTA_PARAM" };
  var texto = String(p.texto || "").trim().slice(0, 1800);
  var arq = p.arquivo || null;
  if (!texto && !arq) return { ok: false, erro: "COMENTARIO_VAZIO" };
  try { melConfereComentavel_(p.pageId); } catch (e) { return { ok: false, erro: String(e) }; }

  var autor = sess.n || sess.u || "Portal";
  var fuId = null, ehImg = false;
  if (arq && arq.dataBase64) {
    var mime = arq.mimeType || "application/octet-stream";
    ehImg = mime.indexOf("image/") === 0;
    fuId = melSubirArquivo_(arq.filename || "arquivo", mime, arq.dataBase64);
  }
  var conteudo = "[" + autor + "] " + (texto || (ehImg ? "(imagem)" : "(arquivo)"));

  /* mesma discussão da página, para parecer um chat contínuo */
  var disc = null;
  try {
    var ex = obraNotionV_("GET", "/comments?block_id=" + encodeURIComponent(p.pageId) + "&page_size=1", null);
    disc = (ex.results && ex.results[0] && ex.results[0].discussion_id) || null;
  } catch (e) {}
  var corpo = disc ? { discussion_id: disc } : { parent: { page_id: p.pageId } };
  corpo.rich_text = [{ text: { content: conteudo } }];
  var noCorpo = false;
  if (fuId) corpo.attachments = [{ file_upload_id: fuId }];
  var c;
  try { c = obraNotionV_("POST", "/comments", corpo); }
  catch (e) {
    if (!fuId) throw e;
    /* plano B: se o Notion recusar anexo em comentário, o arquivo vai para o
       corpo da página e o comentário avisa que ele está lá */
    notion_("PATCH", "/blocks/" + p.pageId + "/children", { children: [
      ehImg ? { type: "image", image: { type: "file_upload", file_upload: { id: fuId } } }
            : { type: "file",  file:  { type: "file_upload", file_upload: { id: fuId }, name: (arq.filename || "arquivo") } }
    ] });
    delete corpo.attachments;
    corpo.rich_text = [{ text: { content: conteudo + " — anexo no corpo da página" } }];
    c = obraNotionV_("POST", "/comments", corpo);
    noCorpo = true;
  }
  cacheRemover_("atv_cont_" + melSemHifen_(p.pageId));
  cacheRemover_(melComsChave_(p.pageId));          // m6: a próxima leitura já traz o novo
  console.log("OBRAS: " + sess.u + " comentou em " + p.pageId + (fuId ? " (com anexo)" : ""));
  return { ok: true, id: c.id, anexoNoCorpo: noCorpo };
}

/* =======================================================================
 * ANEXOS DAS LIGAÇÕES (ABA LIGAÇÕES item 1 — PDF que levava 2 min)
 * O build do GitHub (espelhar_anexos.py) copia os arquivos das ligações para
 * o bucket PRIVADO "anexos" do Supabase. Aqui só se assina o link (uma
 * chamada rápida, sem passar pelo Notion). Se o arquivo ainda não foi
 * espelhado (anexado há pouco), cai no Notion como antes.
 * ===================================================================== */
var ANEXOS_BUCKET = "anexos";
function melSlug_(s) { return normDist_(s).replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function ligArquivo_(sess, p) {
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  var esperado = Math.max(1, Number(p.n || 1));
  var pasta = "lig/" + melSemHifen_(p.pageId) + "/" + melSlug_(p.prop);
  try {
    var cfg = supaCfg_(), h = { apikey: cfg.key, Authorization: "Bearer " + cfg.key };
    var l = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/list/" + ANEXOS_BUCKET, {
      method: "post", muteHttpExceptions: true, contentType: "application/json", headers: h,
      payload: JSON.stringify({ prefix: pasta, limit: 100, offset: 0 })
    });
    if (l.getResponseCode() < 300) {
      var itens = (JSON.parse(l.getContentText()) || []).filter(function (x) { return x && x.name && x.id; });
      if (itens.length >= esperado) {
        var s = UrlFetchApp.fetch(cfg.url + "/storage/v1/object/sign/" + ANEXOS_BUCKET, {
          method: "post", muteHttpExceptions: true, contentType: "application/json", headers: h,
          payload: JSON.stringify({ expiresIn: 900, paths: itens.map(function (x) { return pasta + "/" + x.name; }) })
        });
        if (s.getResponseCode() < 300) {
          var ass = JSON.parse(s.getContentText()) || [];
          var arqs = ass.filter(function (a) { return a.signedURL || a.signedUrl; }).map(function (a) {
            var rel = a.signedURL || a.signedUrl, nome = String(a.path || "").split("/").pop();
            return { name: nome.replace(/^[0-9a-f]{10}__/, ""),
                     url: cfg.url + "/storage/v1" + (rel.charAt(0) === "/" ? "" : "/") + rel };
          });
          if (arqs.length) return { ok: true, origem: "espelho", arquivos: arqs };
        }
      }
    }
  } catch (e) { console.log("ligArquivo: espelho indisponível — " + e); }

  /* plano B: direto do Notion (só página da base de ligações) */
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  if (melPai_(pg) !== melSemHifen_(CONFIG.DB.LIGACOES)) return { ok: false, erro: "NAO_E_LIGACAO" };
  var pp = melPega_(pg.properties || {}, p.prop);
  var lista = ((pp && pp.files) || []).map(function (f) {
    return { name: f.name, url: f.type === "external" ? (f.external && f.external.url) : (f.file && f.file.url) };
  }).filter(function (x) { return x.url; });
  return { ok: true, origem: "notion", arquivos: lista };
}

/* =======================================================================
 * CADASTROS INVESTIDORES (itens 11 e 12)
 * Base PROPRIETÁRIOS (PROPRIETARIOS_PAI). Colunas lidas do schema ao vivo;
 * as sensíveis (CPF/CNPJ, nascimento, conta, PIX…) NÃO vão na lista — só
 * quando alguém clica em "Carregar CPFs", e isso fica no log.
 * Editar: só ADM e MASTER.
 * ===================================================================== */
var INV_DB = "3e2c5ab532d38055a241db35f74e7bbc";
var INV_SENS_FRAG = ["CPF", "CNPJ", "RG", "IDENTIDADE", "NASCIMENTO", "CONTA", "AGENCIA", "PIX",
                     "TELEFONE", "CELULAR", "WHATSAPP", "EMAIL", "E-MAIL", "RENDA", "ENDERECO"];
function invSensivel_(nome) {
  var n = normDist_(nome);
  return INV_SENS_FRAG.some(function (f) { return n.indexOf(normDist_(f)) >= 0; });
}
function invSchema_() {
  return comCache_("inv_schema_v1", 1800, function () {
    var props = notion_("GET", "/databases/" + INV_DB, null).properties || {}, out = [];
    for (var nome in props) {
      var t = props[nome].type;
      var c = { nome: nome, tipo: t, sensivel: invSensivel_(nome),
                editavel: EDITAVEL_[t] === true && t !== "files" && t !== "people" };
      if (t === "select" || t === "status" || t === "multi_select")
        c.opcoes = ((props[nome][t] || {}).options || []).map(function (o) { return o.name; });
      out.push(c);
    }
    return out;
  });
}
function investidores_(sess, p) {
  var colunas = invSchema_();
  var linhas = comCache_("inv_lista_v1", 300, function () {
    return queryAll_(INV_DB, {}).map(function (pg) {
      var v = {}, pr = pg.properties || {};
      colunas.forEach(function (c) { if (!c.sensivel) v[c.nome] = melTexto_(pr[c.nome]); });
      return { id: pg.id, v: v };
    });
  });
  /* m3: edição desligada a pedido — a aba é só consulta */
  return { ok: true, colunas: colunas, linhas: linhas, podeEditar: false };
}
function investidoresSensiveis_(sess, p) {
  var colunas = invSchema_().filter(function (c) { return c.sensivel; }), mapa = {};
  queryAll_(INV_DB, {}).forEach(function (pg) {
    var v = {}, pr = pg.properties || {};
    colunas.forEach(function (c) { v[c.nome] = melTexto_(pr[c.nome]); });
    mapa[pg.id] = v;
  });
  console.log("INVESTIDORES: " + sess.u + " carregou os dados sensíveis do cadastro");
  return { ok: true, valores: mapa };
}
function investidorUpdate_(sess, p) {
  return { ok: false, erro: "EDICAO_DESABILITADA" };   // m3: aba só de consulta
  if (!ehAdm_(sess) && !ehMaster_(sess)) return { ok: false, erro: "APENAS_ADM_MASTER" };
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  var campo = null;
  invSchema_().forEach(function (c) { if (normDist_(c.nome) === normDist_(p.prop)) campo = c; });
  if (!campo) return { ok: false, erro: "CAMPO_INEXISTENTE: " + p.prop };
  if (!campo.editavel) return { ok: false, erro: "CAMPO_NAO_EDITAVEL: " + campo.nome };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  if (melPai_(pg) !== INV_DB) return { ok: false, erro: "NAO_E_INVESTIDOR" };

  var valor = p.valor;
  if ((campo.tipo === "select" || campo.tipo === "status") && valor) {
    var real = null;
    (campo.opcoes || []).forEach(function (o) { if (normDist_(o) === normDist_(valor)) real = o; });
    if (!real) return { ok: false, erro: "OPCAO_INEXISTENTE: " + valor };
    valor = real;
  }
  if (campo.tipo === "multi_select") valor = String(valor || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  if (campo.tipo === "date" && valor && !/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) return { ok: false, erro: "DATA_INVALIDA" };
  if (campo.tipo === "number" && valor !== "" && valor !== null && isNaN(Number(String(valor).replace(",", "."))))
    return { ok: false, erro: "NUMERO_INVALIDO" };
  if (campo.tipo === "number" && valor !== "" && valor !== null) valor = Number(String(valor).replace(",", "."));
  if (campo.tipo === "checkbox") valor = valor === true || normDist_(valor) === "SIM";

  var props = {}; props[campo.nome] = buildValue_(campo.tipo, valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  cacheRemover_("inv_lista_v1");
  console.log("INVESTIDORES: " + sess.u + " gravou " + (campo.sensivel ? "(campo sensível) " : "") + campo.nome + " em " + p.pageId);
  return { ok: true, prop: campo.nome };
}

/* =======================================================================
 * DIAGNÓSTICO DAS SIMULAÇÕES — rode pelo menu Executar, no PORTAL-LEITURA.
 * Chama o simsLista por dentro (sem precisar de login), e diz se o problema
 * está no código ou na publicação.
 * ===================================================================== */
function diagnosticoSimulacoes() {
  Logger.log("Código.gs: " + VERSAO_GS + " | papel: " + PAPEL + " | Melhorias: " + VERSAO_MELHORIAS);
  if (typeof simsRotear_ !== "function") {
    Logger.log("*** simsRotear_ NÃO existe neste projeto: o arquivo das simulações não está aqui (ou tem erro de sintaxe).");
    return;
  }
  var t0 = Date.now(), r;
  try { r = simsRotear_("simsLista", { u: "diagnostico", n: "diagnostico", t: "ADM", a: [], p: "" }, { fresco: true, forcar: true }); }
  catch (e) { Logger.log("*** simsLista QUEBROU: " + e + (e && e.stack ? "\n" + e.stack : "")); return; }
  Logger.log("simsLista respondeu em " + Math.round((Date.now() - t0) / 1000) + "s: ok=" + (r && r.ok) +
             " erro=" + (r && r.erro) + " | simulações=" + (r && r.simulacoes ? r.simulacoes.length : "-") +
             " | lidoEm=" + (r && r.lidoEm));
  if (r && r.simulacoes && r.simulacoes.length) {
    var ult = r.simulacoes.slice().sort(function (a, b) {
      return String(b.criadoEm || b.data || "").localeCompare(String(a.criadoEm || a.data || ""));
    })[0];
    Logger.log("Mais recente que o código enxerga: " + JSON.stringify(ult).slice(0, 300));
  }
  Logger.log("Se aqui aparece a simulação de hoje e a tela não, a IMPLANTAÇÃO está velha: " +
             "Implantar > Gerenciar implantações > lápis > Versão: Nova versão > Implantar.");
}


/* =======================================================================
 * AO VIVO — m4 (24/09/26)
 * -----------------------------------------------------------------------
 * Uma pessoa grava; as outras telas abertas ficam sabendo em ~1 s e se
 * atualizam sozinhas. Como: depois de TODA gravação que deu certo, o handle_
 * chama avisarAoVivo_, que manda uma mensagem pelo Realtime do Supabase
 * (canal "portal", evento "mudou"). As telas assinam esse canal com a chave
 * PÚBLICA (anon) do Supabase e, ao receber, releem só o que mudou.
 *
 * O QUE VAI NA MENSAGEM: tela, ação, ids (obra/atividade/página) e o nome de
 * quem gravou. NENHUM dado da obra, do cliente ou valores — quem recebe vai
 * buscar o dado pelo caminho normal, com login.
 *
 * CONFIGURAR (uma vez, nos DOIS projetos): Propriedades do script >
 *   SUPABASE_ANON_KEY = a chave "anon public" do projeto (Supabase >
 *   Project Settings > API). SUPABASE_URL já existe. Sem a anon, o portal
 *   segue funcionando igual, só sem o ao vivo.
 * ===================================================================== */
function aoVivoConfig_(sess, p) {
  var url = prop_("SUPABASE_URL"), anon = prop_("SUPABASE_ANON_KEY");
  if (!url || !anon) return { ok: false, erro: "AO_VIVO_NAO_CONFIGURADO" };
  return { ok: true, url: url.replace(/\/+$/, ""), anon: anon, canal: "portal" };
}
var AO_VIVO_GRAVA_ = /(Update|Nova|Novo|Criar|Excluir|Anexar|Baixa|Check|Acao|Status|Conta|Aparece|Liberar|Ligacoes|Refazer|Setup|Distrato|distrato|baixa|upload|criarVenda|excluirVenda|updateVenda|novaOpcao|comentarioNovo|ComentarioNovo)/;
var AO_VIVO_NAO_ = ["aoVivoConfig", "melhoriasVersao", "forcarAtualizacao", "agendaLink", "docAgendaLink", "opStatus"];
function aoVivoTela_(action) {
  if (/^atv|^bloco/.test(action)) return "atividades";   // m10
  if (/^proc/.test(action)) return "processos";
  if (/^obra|^conta|^investidor/.test(action)) return "obras";
  if (/^lig/.test(action)) return "ligacoes";
  if (/^posObra/.test(action)) return "pos-obra";
  if (/^doc/.test(action)) return "documentos";
  if (/^sims/.test(action)) return "simulacoes";
  return "vendas";
}
function avisarAoVivo_(action, sess, p, res) {
  if (AO_VIVO_NAO_.indexOf(action) >= 0 || !AO_VIVO_GRAVA_.test(action)) return;
  var url = prop_("SUPABASE_URL"), key = prop_("SUPABASE_SERVICE_KEY");
  if (!url || !key || !prop_("SUPABASE_ANON_KEY")) return;
  p = p || {}; res = res || {};
  var payload = {
    tela: aoVivoTela_(action), acao: action,
    id: p.pageId || p.atividadeId || res.id || null,
    obraId: p.obraId || res.obraId || null,
    quem: (sess && (sess.n || sess.u)) || "",
    em: Date.now()
  };
  UrlFetchApp.fetch(url.replace(/\/+$/, "") + "/realtime/v1/api/broadcast", {
    method: "post", muteHttpExceptions: true, contentType: "application/json",
    headers: { apikey: key, Authorization: "Bearer " + key },
    payload: JSON.stringify({ messages: [{ topic: "portal", event: "mudou", payload: payload }] })
  });
}
/* Rode pelo menu Executar para testar o ao vivo sem gravar nada no Notion:
   com uma tela de obras aberta, ela deve mostrar "Atualizado por TESTE". */
function testeAoVivo() {
  Logger.log(JSON.stringify(aoVivoConfig_(null, {})));
  avisarAoVivo_("obraAtvUpdate", { n: "TESTE" }, { pageId: "teste", obraId: "teste" }, { ok: true });
  Logger.log("Mensagem enviada. Veja se a tela aberta reagiu.");
}


/* =======================================================================
 * CONTEÚDO DAS ATIVIDADES PRONTO NO CACHE — m5 (24/09/26)
 * -----------------------------------------------------------------------
 * Abrir uma atividade precisava descer a página inteira no Notion (títulos,
 * checklist, blocos recolhíveis) na hora do clique: 3 a 10 s, e às vezes
 * mais que o navegador espera. Agora o aquecerCaches (acionador de 10 min
 * do PORTAL-LEITURA, que já existe) chama aquecerConteudos_: pega as
 * atividades NÃO finalizadas, e deixa o conteúdo delas no cache por 3 h —
 * primeiro as que ainda não têm, depois as mais antigas. Cada rodada
 * trabalha no máximo 90 s; em poucas rodadas todas as abertas estão prontas
 * e o clique vira uma leitura de cache (~1 s).
 * Marcar/desmarcar um item do checklist continua apagando a cópia daquela
 * atividade na hora (obraAtvCheck_), e a próxima rodada refaz.
 * ===================================================================== */
function melGuardarConteudo_(id, blocos) {
  var k = melSemHifen_(id);
  cachePut_("atv_cont_" + k, blocos, MEL_CONT_SEG);
  try { _cache_().put("atv_cont_t_" + k, String(Date.now()), MEL_CONT_SEG); } catch (e) {}
}
function aquecerConteudos_(orcamentoMs) {
  var t0 = Date.now(), orc = orcamentoMs || 90000;
  var sch = obraAtvSchema_(), col = obraColReal_(sch, "Status");
  var filtro = {};
  if (col) { filtro = { filter: { property: col } }; filtro.filter[sch[col].type] = { does_not_equal: "Finalizado" }; }
  var abertas = queryAll_(OBRA_ATIV_DB, filtro).map(function (p) { return melSemHifen_(p.id); });
  var c = _cache_(), idade = {}, ks = abertas.map(function (id) { return "atv_cont_t_" + id; });
  var lidos = {};
  for (var i = 0; i < ks.length; i += 100) {
    var parte = c.getAll(ks.slice(i, i + 100)) || {};
    for (var k in parte) lidos[k] = parte[k];
  }
  abertas.forEach(function (id) { idade[id] = Number(lidos["atv_cont_t_" + id] || 0); });
  var UMA_HORA = 3600 * 1000, agora = Date.now();
  var fila = abertas.filter(function (id) { return agora - idade[id] > UMA_HORA; })
                    .sort(function (a, b) { return idade[a] - idade[b]; });   // sem cópia (0) primeiro
  var hdr = { Authorization: "Bearer " + tokenNotion_(), "Notion-Version": CONFIG.NOTION_VERSION };
  /* m8 — COM FREIO. O Notion aceita ~3 pedidos por segundo por integração, e
     o portal, os robôs e o build usam a MESMA integração. A versão m5/m6
     descia 8 páginas por vez sem pausa: estourava esse limite e TODO o resto
     (documentos das simulações, contas, comentários) passava a levar 429 e a
     demorar. Agora: no máximo 12 atividades por rodada, 3 por vez, com pausa,
     e para na hora se o Notion reclamar. O aquecimento completo leva mais
     rodadas — e o portal continua respondendo enquanto isso. */
  var feitas = 0, LIMITE = Math.min(12, fila.length);
  MEL_429 = false;
  for (var j = 0; j < LIMITE; j += 3) {
    if (Date.now() - t0 > orc || MEL_429) break;
    var lote = fila.slice(j, Math.min(j + 3, LIMITE)), arv = melArvores_(lote, hdr, true);
    if (MEL_429) break;
    lote.forEach(function (id) { melGuardarConteudo_(id, arv[id] || []); feitas++; });
    Utilities.sleep(1200);
    melAquecerComentarios_(lote);
    Utilities.sleep(1200);
  }
  return { abertas: abertas.length, renovadas: feitas, faltam: Math.max(0, fila.length - feitas),
           segundos: Math.round((Date.now() - t0) / 1000), limiteNotion: MEL_429 };
}
/* Rode pelo menu Executar para encher o cache agora, sem esperar o acionador. */
function aquecerConteudosAtividades() { Logger.log(JSON.stringify(aquecerConteudos_(300000))); }
var MEL_429 = false;   // o Notion pediu para ir devagar (429) nesta execução


/* m6 — comentários já guardados no cache, para os ids pedidos (não busca
   nada no Notion: só devolve o que já está pronto). */
function melComsEmCache_(ids) {
  var out = {};
  (ids || []).forEach(function (id) {
    var env = cacheGet_(melComsChave_(id));
    if (env && env.v && env.v.ok) out[id] = env.v.comentarios || [];
  });
  return out;
}
/* m6 — lê os comentários de várias páginas de uma vez (em paralelo) e grava
   no cache no mesmo formato do comCache_. Usado pelo aquecimento. */
function melAquecerComentarios_(ids) {
  if (!ids || !ids.length) return;
  var hdr = { Authorization: "Bearer " + tokenNotion_(), "Notion-Version": "2025-09-03" };
  var resps = UrlFetchApp.fetchAll(ids.map(function (id) {
    return { url: "https://api.notion.com/v1/comments?page_size=100&block_id=" + encodeURIComponent(id),
             method: "get", muteHttpExceptions: true, headers: hdr };
  }));
  resps.forEach(function (r, i) {
    if (r.getResponseCode() >= 300) return;
    try {
      var j = JSON.parse(r.getContentText());
      if (j.has_more) return;                               // muitos comentários: fica para a leitura normal
      cachePut_(melComsChave_(ids[i]), { t: Date.now(), v: melComentariosDe_(j.results || []) }, CACHE_LONGO);
      try { _cache_().put("pgok_" + melSemHifen_(ids[i]), "1", 21600); } catch (e) {}
    } catch (e) {}
  });
}


/* =======================================================================
 * SIMULAÇÕES MAIS RÁPIDAS — m8 (25/09/26)
 * -----------------------------------------------------------------------
 * O detalhe da proposta e o "Gerar link" demoravam porque os dois leem a
 * CONVERSA DE E-MAIL da proposta (Gmail + o Apps Script do simulador), que é
 * de longe a parte mais lenta — e o link nem mostra a conversa.
 * As versões "rápidas" rodam a MESMA ação do Simulacoes.gs, só que com a
 * leitura da conversa desligada naquela execução. A tela mostra os
 * documentos na hora e pede a conversa completa depois, em segundo plano.
 * Se o Simulacoes.gs mudar e a função da conversa tiver outro nome, a versão
 * rápida vira a normal (mais lenta, mas certa).
 * ===================================================================== */
function melSimsSemConversa_(acao, sess, p) {
  if (typeof simsRotear_ !== "function") return { ok: false, erro: "ACAO_DESCONHECIDA: Simulacoes.gs ausente" };
  var tinha = (typeof simsHistoricoEmail_ === "function"), orig = tinha ? simsHistoricoEmail_ : null;
  if (tinha) simsHistoricoEmail_ = function () { return { mensagens: [], motivo: "ADIADO" }; };
  try { return simsRotear_(acao, sess, p); }
  finally { if (tinha) simsHistoricoEmail_ = orig; }
}
