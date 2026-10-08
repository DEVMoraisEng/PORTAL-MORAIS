/* GerarVendaCondominio — botão "Gerar venda" da tela do condomínio.
 * Arquivo do projeto PORTAL-VENDA (ao lado de PortalVenda.gs; usa notion_,
 * prop_, baixarArquivo_ e anexarArquivo_ dele, e o CondominioVenda.gs).
 *
 * Lê uma linha da BANCO DE DADOS VENDAS CONDOMÍNIO (Propriedade DB_VENDAS_COND)
 * e cria a casa correspondente na VENDAS (DB_VENDAS), com os arquivos copiados.
 * A coluna "CONDOMÍNIO - VENDA ID" (texto) da VENDAS guarda o id da linha do
 * condomínio (32 hex, sem hífen): é por ela que o clique repetido não duplica a
 * casa e que o robô do Mais Controle acha o fluxo de parcelas.
 * Nenhum log com nome, CPF ou nome de arquivo. */

function condCompacto_(id) { return String(id || "").replace(/-/g, "").toLowerCase(); }

function condSchemaVendas_() {
  /* Lido direto (sem CacheService): a ação é rara (uma vez por venda) e o
     schema completo da VENDAS, com as opções dos selects, pode passar dos
     100 KB do cache. */
  var db = notion_("GET", "/databases/" + prop_("DB_VENDAS"), null), s = {};
  for (var n in db.properties) {
    var pr = db.properties[n];
    s[n] = { tipo: pr.type, opcoes: pr.type === "select" ? ((pr.select && pr.select.options) || []).map(function (o) { return o.name; }) : [] };
  }
  return s;
}
function condColReal_(schema, nome) {
  for (var k in schema) if (RegrasVenda.chave(k) === RegrasVenda.chave(nome)) return k;
  return null;
}

var COND_LIMITE_ARQUIVO = 20 * 1024 * 1024;   // envio simples do /file_uploads do Notion

function gerarVendaCondominio_(col, sess, p) {
  var dbCond = prop_("DB_VENDAS_COND"), dbVendas = prop_("DB_VENDAS");
  if (!dbCond || !dbVendas) throw new Error("BACKEND_SEM_CONFIG");
  var atualizar = p.atualizar === true || p.atualizar === "true";
  var idCond = condCompacto_(p.pageId);

  /* trava só a parte que decide e cria a casa (dois cliques não criam duas);
     a cópia dos arquivos, que demora, roda fora dela */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, erro: "GERAR_VENDA_OCUPADO" };
  var origem, schema, destino, jaExistia = false, ignoradas = [];
  try {
    origem = notion_("GET", "/pages/" + p.pageId, null);
    if (condCompacto_(origem.parent && origem.parent.database_id) !== condCompacto_(dbCond)) throw new Error("PAGINA_DE_OUTRA_BASE");
    schema = condSchemaVendas_();
    var colId = condColReal_(schema, CondominioVenda.COLUNA_ID);
    if (!colId || schema[colId].tipo !== "rich_text") throw new Error("COLUNA_FALTANDO: " + CondominioVenda.COLUNA_ID + " (texto)");

    var achados = notion_("POST", "/databases/" + dbVendas + "/query",
                          { filter: { property: colId, rich_text: { equals: idCond } }, page_size: 5 });
    var existente = (achados.results || [])[0] || null;
    if (existente && !atualizar) {
      console.log("PORTAL-VENDA gerarVendaCondominio " + idCond.slice(0, 8) + " já existia");
      return { ok: true, pageId: existente.id, url: condUrl_(existente.id), jaExistia: true,
               colunasIgnoradas: [], arquivosCopiados: [], arquivosComFalha: [], avisos: [] };
    }
    var mapa = CondominioVenda.mapear(origem.properties || {}, schema);
    mapa[CondominioVenda.COLUNA_ID] = idCond;
    var m = CondominioVenda.propriedadesNotion(mapa, schema);
    ignoradas = m.ignoradas;
    if (existente) {
      /* atualizar: regrava só os dados que o condomínio tem (nunca apaga nada) */
      jaExistia = true;
      notion_("PATCH", "/pages/" + existente.id, { properties: m.props });
      destino = existente;
    } else {
      destino = notion_("POST", "/pages", { parent: { database_id: dbVendas }, properties: m.props });
    }
  } finally {
    lock.releaseLock();
  }

  /* arquivos: um por vez, coluna por coluna; falha de um não derruba a venda.
     Ao atualizar, coluna que já tem arquivo na casa não é mexida. */
  var copiados = [], falhas = [];
  CondominioVenda.arquivosParaCopiar(origem.properties || {}, schema).forEach(function (par) {
    var colReal = condColReal_(schema, par.para);
    if (!colReal || schema[colReal].tipo !== "files") { ignoradas.push(par.para); return; }
    var ja = ((destino.properties || {})[colReal] || {}).files || [];
    if (jaExistia && ja.length) return;
    par.arquivos.forEach(function (f) {
      var nome = String(f.name || "arquivo");
      try {
        var b = baixarArquivo_(f);
        if (!b) throw new Error("DOWNLOAD_FALHOU");
        if (Math.floor(b.base64.length * 3 / 4) > COND_LIMITE_ARQUIVO) throw new Error("ARQUIVO_GRANDE");
        anexarArquivo_(destino.id, colReal, { nome: nome, mime: b.mime, base64: b.base64 }, false);
        copiados.push({ coluna: par.para, arquivo: nome });
      } catch (e) {
        var msg = String((e && e.message) || e);
        falhas.push({ coluna: par.para, arquivo: nome,
                      erro: /^(DOWNLOAD_FALHOU|ARQUIVO_GRANDE|UPLOAD_FALHOU)$/.test(msg) ? msg : "COPIA_FALHOU" });
      }
    });
  });

  console.log("PORTAL-VENDA gerarVendaCondominio " + idCond.slice(0, 8) + (jaExistia ? " atualizada" : " criada") +
              "; arquivos " + copiados.length + " copiados, " + falhas.length + " com falha; colunas ignoradas " + ignoradas.length);
  return { ok: true, pageId: destino.id, url: condUrl_(destino.id), jaExistia: jaExistia,
           colunasIgnoradas: ignoradas, arquivosCopiados: copiados, arquivosComFalha: falhas,
           avisos: CondominioVenda.avisos(origem.properties || {}) };
}

/* link relativo da tela de venda (vendas.html?abrir=<id>) — a tela do
   condomínio resolve contra o endereço do portal */
function condUrl_(pageId) { return "vendas.html?abrir=" + encodeURIComponent(String(pageId)); }
