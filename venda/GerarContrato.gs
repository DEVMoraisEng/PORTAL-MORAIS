/* GerarContrato — gera o contrato de compra e venda da casa (entrega 2).
 * Arquivo do projeto PORTAL-VENDA (depois de RegrasVenda, ContratoVenda e PortalVenda).
 * Fluxo: lê a casa + a obra + os 3 cadastros no Notion, monta os dados
 * (ContratoVenda), confere o obrigatório, copia o modelo (Google Doc) para a
 * pasta provisória, preenche marcadores e blocos, exporta PDF e APAGA a cópia (finally).
 * Entrega 9 (pré-contrato): gerarPreContrato grava o PDF com o que o app preencheu
 * GRIFADO na pasta provisória (Propriedade PRECONTRATO_<pageId> guarda o carimbo);
 * aprovarPreContrato (o "Conferi") só gera o contrato final, sem grifo, em CONTRATO
 * GERADO se os dados ainda dão o mesmo carimbo do pré-contrato.
 * Propriedades do script: DB_VENDEDORES, DB_LOTEAMENTOS, DB_CORRETORES,
 * MODELO_PRONTO_ID, MODELO_CONSTRUCAO_ID, MODELO_CONDOMINIO_ID, PASTA_PROVISORIA_ID,
 * DB_VENDAS_COND (venda do condomínio), CIDADE_ASSINATURA (opcional).
 * Serviços: DocumentApp, DriveApp e Drive API avançada (v3).
 * Condomínio: a casa com "CONDOMÍNIO - VENDA ID" preenchido lê também a linha da
 * BANCO DE DADOS VENDAS CONDOMÍNIO (fluxo de pagamento, fiadores, unidade, corretor)
 * e usa o modelo MODELO_CONDOMINIO_ID. O vendedor vem como nas outras casas (obra em
 * DOCUMENTOS pelo ENDEREÇO da casa -> PROPRIETARIO DOCUMENTO -> VENDEDORES); o
 * empreendimento vem de LOTEAMENTOS pelo ENDEREÇO da casa (nome do condomínio), não pelo SETOR.
 * Log só com ação, pageId abreviado, tempos e contagens — nunca valores. */

function ctrTxt_(v) { return v === null || v === undefined ? "" : String(v); }
function ctrNum_(v) { return typeof v === "number" && isFinite(v) ? v : null; }
function ctrLog_(msg) { console.log("PORTAL-VENDA " + msg); }
function ctrErro_(msg, e) { console.error("PORTAL-VENDA " + msg + ": " + String((e && e.message) || e).slice(0, 120)); }

/* Valor "solto" de uma propriedade do Notion (qualquer tipo que as colunas do contrato usam). */
function ctrValor_(pr) {
  if (!pr) return null;
  switch (pr.type) {
    case "title": case "rich_text": case "number": case "select": case "email": case "phone_number": case "files":
      return valorProp_(pr);
    case "multi_select": return (pr.multi_select || []).map(function (o) { return o.name; }).join(", ");
    case "date": return pr.date ? pr.date.start : null;
    case "checkbox": return pr.checkbox ? "SIM" : "NÃO";
    case "relation": return (pr.relation || []).map(function (r) { return r.id; });
    case "formula":
      var f = pr.formula || {};
      if (f.type === "date") return f.date ? f.date.start : null;
      return f[f.type] === undefined ? null : f[f.type];
    case "rollup":
      var ro = pr.rollup || {};
      if (ro.type === "array") return (ro.array || []).map(ctrValor_).filter(function (x) { return x !== null && x !== ""; }).join(", ");
      if (ro.type === "date") return ro.date ? ro.date.start : null;
      return ro[ro.type] === undefined ? null : ro[ro.type];
    default: return null;
  }
}

/* Propriedades de uma página indexadas por RegrasVenda.chave (tolerante a acento/caixa/espaço). */
function ctrPorChave_(props) {
  var m = {};
  for (var n in props) m[RegrasVenda.chave(n)] = props[n];
  return m;
}
function ctrCampo_(porChave, nome) { return ctrValor_(porChave[RegrasVenda.chave(nome)]); }
function ctrTitulo_(props) {
  for (var n in props) if (props[n] && props[n].type === "title") return ctrTxt_(ctrValor_(props[n]));
  return "";
}

/* Página da casa na VENDAS ou, desde a entrega 7, a própria linha da BANCO DE DADOS VENDAS
 * CONDOMÍNIO (DB_VENDAS_COND) — essa vira a "página de venda virtual" do CondominioVenda:
 * mesmas colunas que a VENDAS teria, e o retorno gravado nas colunas da própria linha. */
function ctrLerPaginaVenda_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  var dbAtual = vendaBaseDaPagina_(pg);
  if (dbAtual === "VENDAS") return pg;
  if (dbAtual === "CONDOMINIO")
    return CondominioVenda.paginaVirtual(pg, pageId, ContratoVenda.TIPOS, [ContratoVenda.COL.CONTRATO_GERADO], CTR_GARANTIR_COND);
  throw new Error("PAGINA_DE_OUTRA_BASE");
}
/* "VENDAS", "CONDOMINIO" ou "" (outra base). */
function vendaBaseDaPagina_(pg) {
  var limpo = function (s) { return String(s || "").replace(/-/g, "").toLowerCase(); };
  var dbAtual = limpo(pg && pg.parent && pg.parent.database_id);
  if (dbAtual && dbAtual === limpo(prop_("DB_VENDAS"))) return "VENDAS";
  var cond = limpo(prop_("DB_VENDAS_COND"));
  if (cond && dbAtual === cond) return "CONDOMINIO";
  return "";
}

function ctrLinhasBase_(dbId, filtro) {
  var linhas = [], cursor = null, voltas = 0;
  do {
    var corpo = { page_size: 100 };
    if (filtro) corpo.filter = filtro;
    if (cursor) corpo.start_cursor = cursor;
    var r = notion_("POST", "/databases/" + dbId + "/query", corpo);
    (r.results || []).forEach(function (l) { linhas.push(l.properties || {}); });
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++voltas < 10);
  if (cursor) ctrLog_("contrato: base " + dbId + " atingiu o limite de " + linhas.length + " linhas"); /* o resto ficou sem ler */
  return linhas;
}
/* Casa a linha do cadastro pelo TÍTULO, com RegrasVenda.chave dos dois lados.
 * Devolve a linha, null (nenhuma) ou { duplicado: true } (mais de um título casa). */
function ctrAcharLinha_(linhas, nome) {
  var k = RegrasVenda.chave(nome), achada = null;
  if (!k) return null;
  for (var i = 0; i < linhas.length; i++) {
    if (RegrasVenda.chave(ctrTitulo_(linhas[i])) !== k) continue;
    if (achada) return { duplicado: true };
    achada = { titulo: ctrTitulo_(linhas[i]), c: ctrPorChave_(linhas[i]) };
  }
  return achada;
}

/* Propriedades da linha de DOCUMENTOS (a obra) da casa, null (não achou) ou { ambigua: true } (endereço repetido). */
function ctrObraProps_(rels, endereco) {
  var db = prop_("DB_DOCUMENTOS"), dbLimpo = db.replace(/-/g, "");
  if (rels && rels.length) {
    try {
      var pg = notion_("GET", "/pages/" + rels[0], null);
      if (String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "") === dbLimpo) return pg.properties || {};
    } catch (e) { ctrErro_("contrato: relacao da obra ilegivel", e); }
  }
  var k = RegrasVenda.chave(endereco);
  if (!k) return null;
  var linhas = [];
  try { linhas = ctrLinhasBase_(db, { property: "ENDEREÇO", title: { equals: endereco } }); }
  catch (e) { ctrErro_("contrato: filtro por endereco falhou", e); }
  if (!linhas.length) linhas = ctrLinhasBase_(db, null);
  var achadas = linhas.filter(function (l) { return RegrasVenda.chave(ctrTitulo_(l)) === k; });
  if (achadas.length > 1) return { ambigua: true };
  return achadas.length ? achadas[0] : null;
}

/* ---- condomínio ---- */
var CTR_REGEX_ID_COND = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;
/* Linha da BANCO DE DADOS VENDAS CONDOMÍNIO apontada pela casa: { c } (propriedades por chave) ou { erro } legível. */
function ctrLerCondominio_(idCond) {
  var db = prop_("DB_VENDAS_COND");
  if (!db) return { erro: "Condomínio: Propriedade DB_VENDAS_COND não configurada" };
  if (!CTR_REGEX_ID_COND.test(idCond)) return { erro: "Condomínio: CONDOMÍNIO - VENDA ID inválido na casa" };
  var pg;
  try { pg = notion_("GET", "/pages/" + idCond, null); }
  catch (e) {
    ctrErro_("contrato: pagina do condominio ilegivel", e);
    return { erro: "Condomínio: a linha da venda do condomínio (CONDOMÍNIO - VENDA ID) não foi encontrada" };
  }
  var pai = String((pg.parent && pg.parent.database_id) || "").replace(/-/g, "").toLowerCase();
  if (pai !== db.replace(/-/g, "").toLowerCase())
    return { erro: "Condomínio: CONDOMÍNIO - VENDA ID aponta para uma página que não é da BANCO DE DADOS VENDAS CONDOMÍNIO" };
  return { c: ctrPorChave_(pg.properties || {}) };
}
/* Fluxo, fiadores, unidade e corretor da linha do condomínio (nomes de coluna comparados normalizados). */
function ctrDadosCondominio_(c) {
  function k(nome) { return ctrCampo_(c, nome); }
  function n(nome) { return ctrNum_(k(nome)); }
  function t(nome) { var x = k(nome); return x === null || x === undefined ? "" : ctrTxt_(x).trim(); }
  function fiador(i) {
    return { nome: t("FIADOR " + i), cpf: t("CPF FIADOR " + i), rg: t("RG FIADOR " + i), nacionalidade: t("NACIONALIDADE FIADOR " + i),
             endereco: t("ENDERECO FIADOR " + i), numero: t("NUMERO FIADOR " + i), setor: t("SETOR FIADOR " + i),
             cidade: t("CIDADE FIADOR " + i), cep: t("CEP FIADOR " + i), email: t("EMAIL FIADOR " + i) };
  }
  return {
    condominio: {
      nome: t("CONDOMÍNIO"), unidade: t("UNIDADE"), areaPrivativa: n("CONTRATO - ÁREA PRIVATIVA (M²)"), fracaoIdeal: t("CONTRATO - FRAÇÃO IDEAL"),
      fluxo: {
        assinatura: t("DATA DE ASSINATURA DO CONTRATO"), diaPagamento: n("DIA PAGAMENTO PARCELAS"), entrega: t("DATA DA ENTREGA"),
        valorVenda: n("VALOR DE VENDA"), sinalAto: n("VALOR SINAL ATO"),
        sinal30: n("VALOR SINAL 30 DIAS"), data30: t("DATA SINAL 30 DIAS"),
        sinal60: n("VALOR SINAL 60 DIAS"), data60: t("DATA SINAL 60 DIAS"),
        sinal90: n("VALOR SINAL 90 DIAS"), data90: t("DATA SINAL 90 DIAS"),
        pre1N: n("Nº PARCELAS 1º PARTE PRÉ CHAVES"), pre1Valor: n("VALOR 1º PARTE PRÉ CHAVES"), pre1Data: t("DATA 1º PARTE PRÉ CHAVES"),
        pre2N: n("Nº PARCELAS 2º PARTE PRÉ CHAVES"), pre2Valor: n("VALOR 2º PARTE PRÉ CHAVES"), pre2Data: t("DATA 2º PARTE PRÉ CHAVES"),
        balao1Valor: n("VALOR 1º BALÃO"), balao1Data: t("DATA 1º BALÃO (12/27)"),
        balao2Valor: n("VALOR BALÃO ENTREGA DE CHAVES"), balao2Data: t("DATA 2º BALÃO (25º PARCELA)"),
        posN: n("Nº PARCELAS PÓS CHAVES"), posValor: n("VALOR PÓS CHAVES"), posData: t("DATA PÓS CHAVES"),
        credito: n("VALOR DO CRÉDITO"), fgts: n("VALOR DO FGTS"), subsidio: n("SUBISÍDIO")
      },
      fiadores: [fiador(1), fiador(2)]
    },
    /* o imóvel do condomínio mora na linha do condomínio; a casa só completa o que faltar */
    imovel: { MATRICULA_INDIVIDUAL: t("CONTRATO - MATRÍCULA INDIVIDUAL"), CRI: t("CONTRATO - CRI DA MATRÍCULA"),
              ALVARA_NUMERO: t("CONTRATO - ALVARÁ Nº"), ALVARA_DATA: t("CONTRATO - ALVARÁ DATA"),
              PRAZO_CONCLUSAO: t("CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS"), CONDICOES_ESPECIAIS: t("CONTRATO - CONDIÇÕES ESPECIAIS") },
    corretor: { nome: t("CORRETOR"), creci: t("CRECI"), cpfCnpj: t("CPF CORRETOR"), email: t("EMAIL CORRETOR") }
  };
}

/* Colunas da VENDAS que o contrato exige além das do dossiê. */
var CTR_COLUNAS_VENDA = ["VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)", "COMISSÃO", "VALOR NA MÃO", "CORRETOR", "SETOR", "OBRA-AUTO"];
/* as mesmas, na página virtual do condomínio: entram vazias quando a linha não tem (o condomínio
   não usa SETOR nem OBRA-AUTO; o valor e o corretor vêm de VALOR DE VENDA e CORRETOR da linha) */
var CTR_GARANTIR_COND = { "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)": "number", "COMISSÃO": "number", "VALOR NA MÃO": "number",
                          "CORRETOR": "rich_text", "SETOR": "rich_text", "OBRA-AUTO": "relation" };

function ctrFontes_(col, pageId) {
  var C = RegrasVenda.COL, CV = ContratoVenda.COL;
  var pg = ctrLerPaginaVenda_(pageId), v = ctrPorChave_(pg.properties);
  var faltando = [];
  Object.keys(ContratoVenda.TIPOS).concat(CTR_COLUNAS_VENDA).forEach(function (nome) {
    if (!v[RegrasVenda.chave(nome)]) faltando.push(nome);
  });
  if (faltando.length) throw new Error("COLUNA_FALTANDO: " + faltando.join(", "));
  var errado = [];
  Object.keys(ContratoVenda.TIPOS).forEach(function (nome) {
    if (v[RegrasVenda.chave(nome)].type !== ContratoVenda.TIPOS[nome]) errado.push(nome);
  });
  if (errado.length) throw new Error("TIPO_DE_COLUNA_ERRADO: " + errado.join(", "));

  /* pelo nome normalizado: na página virtual do condomínio os nomes não têm o espaço sobrando da VENDAS */
  function dos(canon) { return ctrTxt_(ctrValor_(v[RegrasVenda.chave(col.mapa[canon])])); }
  function cv(nome) { return ctrCampo_(v, nome); }
  function nomeReal(canon) {
    for (var n in pg.properties) if (RegrasVenda.chave(n) === RegrasVenda.chave(canon)) return n;
    return canon;
  }
  var venda = {
    CLIENTES: dos(C.CLIENTES), CPF: dos(C.CPF1), ENDERECO: ctrTitulo_(pg.properties),
    COMPRADOR1: { nacionalidade: dos(C.C1_NAC), estadoCivil: dos(C.C1_ESTCIV), profissao: dos(C.C1_PROF),
                  documento: dos(C.C1_DOC), endereco: dos(C.C1_END), email: ctrTxt_(cv("COMPRADOR 1 - E-MAIL")) },
    COMPRADOR2: { nome: dos(C.C2_NOME), cpf: dos(C.C2_CPF), nacionalidade: dos(C.C2_NAC), estadoCivil: dos(C.C2_ESTCIV),
                  profissao: dos(C.C2_PROF), documento: dos(C.C2_DOC), endereco: dos(C.C2_END), email: dos(C.C2_EMAIL) },
    ALVARA_NUMERO: cv(CV.ALVARA_NUMERO), ALVARA_DATA: cv(CV.ALVARA_DATA), HABITESE_NUMERO: cv(CV.HABITESE_NUMERO),
    MATRICULA_INDIVIDUAL: cv(CV.MATRICULA_INDIVIDUAL), CRI: cv(CV.CRI), AREA: ctrNum_(cv(CV.AREA)),
    CONFRONTACOES: cv(CV.CONFRONTACOES),
    SINAL_VALOR: ctrNum_(cv(CV.SINAL_VALOR)), SINAL_DATA: cv(CV.SINAL_DATA),
    ENTRADA_VALOR: ctrNum_(cv(CV.ENTRADA_VALOR)), ENTRADA_VENCIMENTO: cv(CV.ENTRADA_VENCIMENTO),
    INTERMEDIARIA_VALOR: ctrNum_(cv(CV.INTERMEDIARIA_VALOR)), INTERMEDIARIA_VENCIMENTO: cv(CV.INTERMEDIARIA_VENCIMENTO),
    FORMA_PAGAMENTO: cv(CV.FORMA_PAGAMENTO), COMISSAO_FORMA: cv(CV.COMISSAO_FORMA),
    COMISSAO_VENCIMENTO: cv(CV.COMISSAO_VENCIMENTO), COMISSAO_PAGA_POR: cv(CV.COMISSAO_PAGA_POR),
    PRAZO_CONCLUSAO: cv(CV.PRAZO_CONCLUSAO), CONDICOES_ESPECIAIS: cv(CV.CONDICOES_ESPECIAIS),
    VALOR_CONTRATO: ctrNum_(cv("VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)")), COMISSAO: ctrNum_(cv("COMISSÃO")),
    VALOR_NA_MAO: ctrNum_(cv("VALOR NA MÃO")), CORRETOR: ctrTxt_(cv("CORRETOR"))
  };
  var setor = ctrTxt_(cv("SETOR"));

  /* venda do condomínio: a casa aponta para a linha da BANCO DE DADOS VENDAS CONDOMÍNIO */
  var idCond = ctrTxt_(cv(CondominioVenda.COLUNA_ID)).trim(), cond = null;
  if (idCond) {
    /* tela de venda do condomínio: a página já é a linha do condomínio (não lê de novo) */
    var lido = pg.propsCondominio ? { c: ctrPorChave_(pg.propsCondominio) } : ctrLerCondominio_(idCond);
    if (lido.erro) return { condominioErro: lido.erro };
    cond = ctrDadosCondominio_(lido.c);
    for (var campo in cond.imovel) if (cond.imovel[campo]) venda[campo] = cond.imovel[campo];
  }

  /* a obra: relação OBRA-AUTO se aponta para DOCUMENTOS; senão, pelo ENDEREÇO (título) */
  var props = ctrObraProps_(cv("OBRA-AUTO"), venda.ENDERECO);
  if (!props) return { obraNaoEncontrada: true };
  if (props.ambigua === true) return { obraAmbigua: true };
  var op = ctrPorChave_(props);
  var obra = { obraFinalizada: ctrTxt_(ctrCampo_(op, "OBRA FINALIZADA?")), proprietario: ctrTxt_(ctrCampo_(op, "PROPRIETARIO DOCUMENTO")),
               cpfCnpj: ctrTxt_(ctrCampo_(op, "CPF/CNPJ")), dataHabitese: ctrTxt_(ctrCampo_(op, "DATA HABITE-SE")) };

  /* os três cadastros */
  var lv = ctrAcharLinha_(ctrLinhasBase_(prop_("DB_VENDEDORES")), obra.proprietario);
  /* condomínio: o empreendimento é a linha de LOTEAMENTOS com o nome do condomínio (= ENDEREÇO da casa) */
  var ll = ctrAcharLinha_(ctrLinhasBase_(prop_("DB_LOTEAMENTOS")), cond ? venda.ENDERECO : setor);
  var lc = ctrAcharLinha_(ctrLinhasBase_(prop_("DB_CORRETORES")), venda.CORRETOR);
  var duplicados = [];
  if (lv && lv.duplicado) duplicados.push("Vendedor: cadastro duplicado em VENDEDORES – CONTRATO");
  if (ll && ll.duplicado) duplicados.push("Loteamento: cadastro duplicado em LOTEAMENTOS – CONTRATO");
  if (lc && lc.duplicado) duplicados.push("Corretor: cadastro duplicado em CORRETORES – CONTRATO");
  if (duplicados.length) return { duplicados: duplicados };
  function t(l, nome) { return ctrTxt_(ctrCampo_(l.c, nome)); }
  var vendedor = lv ? {
    tipo: t(lv, "TIPO"), nome: lv.titulo, cpfCnpj: t(lv, "CPF/CNPJ"), endereco: t(lv, "ENDEREÇO / SEDE"),
    representanteNome: t(lv, "REPRESENTANTE NOME"), representanteCpf: t(lv, "REPRESENTANTE CPF"),
    representanteRg: t(lv, "REPRESENTANTE RG"), representanteNacionalidade: t(lv, "REPRESENTANTE NACIONALIDADE"),
    representanteEstadoCivil: t(lv, "REPRESENTANTE ESTADO CIVIL"),
    nacionalidade: t(lv, "NACIONALIDADE"), estadoCivil: t(lv, "ESTADO CIVIL"), profissao: t(lv, "PROFISSÃO"), rg: t(lv, "RG"),
    banco: t(lv, "BANCO"), agencia: t(lv, "AGÊNCIA"), operacao: t(lv, "OPERAÇÃO"), conta: t(lv, "CONTA"), pix: t(lv, "PIX"),
    email: t(lv, "E-MAIL"), representanteEmail: t(lv, "REPRESENTANTE E-MAIL") /* só a assinatura usa */
  } : null;
  var loteamento = ll ? {
    denominacao: t(ll, "DENOMINAÇÃO"), municipioUf: t(ll, "MUNICÍPIO/UF"), matricula: t(ll, "MATRÍCULA DO LOTEAMENTO"),
    cartorio: t(ll, "CARTÓRIO"), prazoPosseDias: t(ll, "PRAZO POSSE (DIAS)"), prazoChavesDias: t(ll, "PRAZO CHAVES (DIAS ÚTEIS)")
  } : null;
  var corretor = lc ? {
    nome: lc.titulo, creci: t(lc, "CRECI"), cpfCnpj: t(lc, "CPF/CNPJ"), nacionalidade: t(lc, "NACIONALIDADE"),
    endereco: t(lc, "ENDEREÇO PROFISSIONAL"), email: t(lc, "E-MAIL")
  } : null;
  /* condomínio: o corretor da linha do condomínio vale; CORRETORES – CONTRATO só completa o que faltar */
  if (cond && cond.corretor.nome) {
    var kc = cond.corretor, base = corretor || {};
    corretor = { nome: kc.nome, creci: kc.creci || base.creci || "", cpfCnpj: kc.cpfCnpj || base.cpfCnpj || "",
                 nacionalidade: base.nacionalidade || "", endereco: base.endereco || "", email: kc.email || base.email || "" };
  }

  return {
    fontes: { venda: venda, obra: obra, vendedor: vendedor, loteamento: loteamento, corretor: corretor,
              condominio: cond ? cond.condominio : null,
              hojeISO: hoje_("yyyy-MM-dd"), cidadeAssinatura: prop_("CIDADE_ASSINATURA") || "Goiânia" },
    endereco: venda.ENDERECO, casa: ctrTxt_(cv("CASA")), colGerado: nomeReal(CV.CONTRATO_GERADO)
  };
}

/* ---- Docs ---- */
function ctrApagarParagrafo_(p) {
  try { p.removeFromParent(); } catch (e) { p.setText(""); } /* último parágrafo do corpo não sai */
}
function aplicarBlocos_(body, blocos) {
  var pars = body.getParagraphs();
  for (var i = 0; i < pars.length; i++) {
    var m = /^\{\{#([A-Z0-9_]+)\}\}$/.exec(String(pars[i].getText()).trim());
    if (!m) continue;
    var fim = -1, alvo = "{{/" + m[1] + "}}";
    for (var j = i + 1; j < pars.length; j++) {
      if (String(pars[j].getText()).trim() === alvo) { fim = j; break; }
    }
    if (fim < 0) { ctrLog_("contrato: bloco sem fechamento (" + m[1] + ")"); continue; }
    var manter = !!blocos && blocos[m[1]] === true; /* chave desconhecida conta como falsa */
    for (var k = i; k <= fim; k++) if (k === i || k === fim || !manter) ctrApagarParagrafo_(pars[k]);
    if (!manter) i = fim; /* o miolo já saiu; um bloco aninhado dentro dele não conta */
  }
}
/* chaves duplas no valor digitado não podem virar marcador falso nem injetar outra chave.
   O substituto do replaceText do Docs entra LITERAL (provado no contrato da casa 13, 07/10/2026:
   o escape "\\$" saiu impresso como "R\\$ 305.000,00") — então nada de escapar $ ou barra. */
function ctrValorSeguro_(v) {
  return ctrTxt_(v).replace(/\{\{|\}\}/g, "");
}
/* Pré-contrato (entrega 9): o que o app preencheu sai grifado em amarelo; o que saiu em branco
   ("____"), em vermelho claro. No contrato final o fundo do valor é apagado (null) — o modelo antigo
   tinha os marcadores realçados em amarelo e o valor herdaria esse realce. */
var CTR_GRIFO = "#FFF59D", CTR_GRIFO_BRANCO = "#FFCDD2";
function ctrGrifar_(txt, ini, valor, grifar) {
  if (!valor.length || ini < 0) return;
  txt.setBackgroundColor(ini, ini + valor.length - 1, grifar ? CTR_GRIFO : null);
  if (!grifar) return;
  var branco = ContratoVenda.EM_BRANCO || "____";
  for (var k = valor.indexOf(branco); k >= 0; k = valor.indexOf(branco, k + branco.length))
    txt.setBackgroundColor(ini + k, ini + k + branco.length - 1, CTR_GRIFO_BRANCO);
}
/* Cada marcador é localizado com findText e trocado no lugar (insere o valor, apaga o marcador):
   o valor entra LITERAL (nada de escapar $ ou barra) e dá para grifar exatamente o trecho inserido.
   Vários marcadores no mesmo parágrafo e cabeçalho/rodapé (sec = corpo, cabeçalho ou rodapé) funcionam igual. */
function aplicarMarcadores_(sec, marcadores, grifar) {
  var paragrafos = ContratoVenda.MARCADORES_PARAGRAFOS || [];
  for (var chave in marcadores) {
    var v = ctrTxt_(marcadores[chave]);
    if (paragrafos.indexOf(chave) >= 0) v = v.replace(/\n/g, " "); /* fora de parágrafo próprio: uma linha só */
    v = ctrValorSeguro_(v); /* sem chaves: o valor nunca recria o marcador, e o laço termina */
    var padrao = "\\{\\{" + chave + "\\}\\}", r, voltas = 0;
    while ((r = sec.findText(padrao)) && voltas++ < 2000) {
      var t = r.getElement().asText(), ini = r.getStartOffset(), fim = r.getEndOffsetInclusive();
      if (v.length) {
        t.insertText(ini, v);                          /* insere antes e apaga depois: o elemento nunca fica vazio */
        t.deleteText(ini + v.length, fim + v.length);
        ctrGrifar_(t, ini, v, !!grifar);
      } else {
        t.deleteText(ini, fim);
      }
    }
  }
}
/* Marcador de várias linhas (ContratoVenda.MARCADORES_PARAGRAFOS) sozinho num parágrafo: vira um
   parágrafo por linha, cópias do parágrafo do modelo (mesma formatação), com o começo da linha em
   negrito quando ContratoVenda.negritoDaLinha pede (cabeçalho dos incisos do 6.1, "FIADOR n:").
   No pré-contrato cada linha gerada sai grifada. */
function ctrExpandirParagrafos_(body, marcadores, grifar) {
  var nomes = ContratoVenda.MARCADORES_PARAGRAFOS || [];
  var pars = body.getParagraphs();
  for (var i = 0; i < pars.length; i++) {
    var m = /^\{\{([A-Z0-9_]+)\}\}$/.exec(String(pars[i].getText()).trim());
    if (!m || nomes.indexOf(m[1]) < 0) continue;
    var re = "\\{\\{" + m[1] + "\\}\\}";
    var linhas = ctrTxt_(marcadores[m[1]]).split("\n");
    var p = pars[i], pai = p.getParent(), pos = pai.getChildIndex(p), molde = p.copy();
    ctrLinhaGerada_(p, re, ctrValorSeguro_(linhas[0]), grifar);
    for (var j = 1; j < linhas.length; j++)
      ctrLinhaGerada_(pai.insertParagraph(pos + j, molde.copy()), re, ctrValorSeguro_(linhas[j]), grifar);
  }
}
function ctrLinhaGerada_(p, re, linha, grifar) {
  var antes = String(p.getText()).search(new RegExp(re));
  p.replaceText(re, linha);
  ctrNegrito_(p, linha);
  if (linha.length && antes >= 0) ctrGrifar_(p.editAsText(), antes, linha, !!grifar);
}
function ctrNegrito_(p, linha) {
  var n = Math.min(ContratoVenda.negritoDaLinha(linha), ctrTxt_(p.getText()).length);
  if (n > 0) p.editAsText().setBold(0, n - 1, true);
}
/* Nomes (só nomes) dos marcadores que sobraram no texto; [] se está limpo. */
function ctrMarcadoresNoTexto_(t) {
  t = String(t);
  if (t.indexOf("{{") < 0 && t.indexOf("}}") < 0) return [];
  var nomes = [], re = /\{\{[#\/]?([A-Za-z0-9_]+)\}\}/g, m;
  while ((m = re.exec(t)) !== null) if (nomes.indexOf(m[1]) < 0) nomes.push(m[1]);
  return nomes.length ? nomes : ["{{ }}"];
}
/* Corpo, cabeçalho e rodapé (os dois últimos podem não existir). */
function ctrSecoes_(doc) {
  var s = [doc.getBody()];
  [doc.getHeader(), doc.getFooter()].forEach(function (x) { if (x) s.push(x); });
  return s;
}
function ctrMarcadoresSobrando_(doc) {
  var nomes = [];
  ctrSecoes_(doc).forEach(function (sec) {
    ctrMarcadoresNoTexto_(sec.getText()).forEach(function (n) { if (nomes.indexOf(n) < 0) nomes.push(n); });
  });
  return nomes;
}
function apagarCopia_(id) {
  try {
    Drive.Files.remove(id, { supportsAllDrives: true });
  } catch (e) {
    ctrErro_("contrato: copia nao apagada", e);
    try {
      DriveApp.getFileById(id).setTrashed(true);
      ctrLog_("contrato: copia foi para a lixeira");
    } catch (_) {}
  }
}

/* ---- carimbo dos dados ----
 * 8 hex do SHA-256 do que define o conteúdo e quem assina (compradores, vendedor e representante,
 * corretor, loteamento, imóvel, valores). Vai no nome do PDF ("… [#abcd1234].pdf"); o envio para
 * assinatura recalcula e recusa (CONTRATO_DESATUALIZADO) se os dados mudaram depois de gerar.
 * Fica fora o que muda sozinho (data de hoje, cidade da assinatura). */
function ctrCarimbo_(d) {
  var base = { modelo: d.modelo, comprador1: d.comprador1, comprador2: d.comprador2, vendedor: d.vendedor,
               nomeProprietario: d.nomeProprietario, corretor: d.corretor, corretorNaVenda: d.corretorNaVenda,
               loteamento: d.loteamento, imovel: d.imovel, negociacao: d.negociacao, comissao: d.comissao };
  if (d.condominio) base.condominio = d.condominio; /* fluxo, fiadores, unidade (só no condomínio: os carimbos antigos não mudam) */
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(base), Utilities.Charset.UTF_8);
  var h = "";
  for (var i = 0; i < 4; i++) h += ("0" + (b[i] & 255).toString(16)).slice(-2);
  return h;
}
/* Carimbo do nome do PDF; "" quando não tem (PDF gerado antes do carimbo existir). */
function ctrCarimboDoNome_(nome) {
  var m = /\[#([0-9a-f]{8})\]\.pdf$/i.exec(String(nome || ""));
  return m ? m[1].toLowerCase() : "";
}

/* ---- ações ---- */
function ctrArquivoGerado_(pg) {
  var v = ctrPorChave_(pg.properties), pr = v[RegrasVenda.chave(ContratoVenda.COL.CONTRATO_GERADO)];
  if (!pr) throw new Error("COLUNA_FALTANDO: " + ContratoVenda.COL.CONTRATO_GERADO);
  var lista = ctrValor_(pr) || [];
  if (!lista.length) return null;
  var f = lista[lista.length - 1];
  return { nome: ctrTxt_(f.name), url: f.type === "external" ? ((f.external || {}).url || "") : ((f.file || {}).url || "") };
}
/* ---- pré-contrato (entrega 9) ----
 * Propriedade PRECONTRATO_<pageId> (JSON): { hash, nome, url, arquivoId, em, por, conferidoEm, conferidoPor }.
 * hash = o mesmo carimbo do nome do PDF (ctrCarimbo_). Fica só nas Propriedades do script — nunca no log. */
function ctrChavePre_(pageId) { return "PRECONTRATO_" + String(pageId || "").replace(/-/g, "").toLowerCase(); }
function ctrLerPre_(pageId) {
  var s = prop_(ctrChavePre_(pageId));
  if (!s) return null;
  try { var o = JSON.parse(s); return o && o.hash ? o : null; } catch (e) { return null; }
}
function ctrGravarPre_(pageId, o) {
  PropertiesService.getScriptProperties().setProperty(ctrChavePre_(pageId), JSON.stringify(o));
}

function contratoEstado_(col, p) {
  var a = ctrArquivoGerado_(ctrLerPaginaVenda_(p.pageId)), pre = ctrLerPre_(p.pageId);
  /* PRE: há pré-contrato ainda não conferido (mesmo que exista um contrato final antigo) */
  var etapa = pre && !pre.conferidoEm ? "PRE" : a ? "FINAL" : "NENHUM";
  var r = { ok: true, gerado: !!a, etapa: etapa, pre: null };
  if (a) { r.nome = a.nome; r.url = a.url; }
  if (pre) {
    r.pre = { nome: ctrTxt_(pre.nome), url: ctrTxt_(pre.url), em: ctrTxt_(pre.em), conferido: !!pre.conferidoEm };
    if (etapa === "PRE") r.pre.desatualizado = ctrPreDesatualizado_(col, p, pre);
  }
  return r;
}
/* true quando os dados de agora não dão o mesmo carimbo do pré-contrato (ou nem fecham mais). */
function ctrPreDesatualizado_(col, p, pre) {
  try {
    var x = ctrDadosAtuais_(col, p, String(p.pageId).slice(0, 8), "contratoEstado");
    return x.resp ? true : ctrCarimbo_(x.d) !== pre.hash;
  } catch (e) {
    ctrErro_("contratoEstado " + String(p.pageId).slice(0, 8) + " carimbo", e);
    return true;
  }
}

/* Lê as fontes e monta os dados: { f, d } ou { resp } (a resposta de erro pronta). */
function ctrDadosAtuais_(col, p, pid, rot) {
  if (!prop_("DB_VENDEDORES") || !prop_("DB_LOTEAMENTOS") || !prop_("DB_CORRETORES") || !prop_("DB_DOCUMENTOS")) return { resp: { ok: false, erro: "CADASTRO_NAO_CONFIGURADO" } };
  var f = ctrFontes_(col, p.pageId);
  if (f.obraAmbigua) {
    ctrLog_(rot + " " + pid + " obra ambigua");
    return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra ambígua em DOCUMENTOS (endereço repetido)"] } };
  }
  if (f.duplicados) {
    ctrLog_(rot + " " + pid + " cadastro duplicado " + f.duplicados.length);
    return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: f.duplicados } };
  }
  if (f.condominioErro) {
    ctrLog_(rot + " " + pid + " condominio ilegivel");
    return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: [f.condominioErro] } };
  }
  if (f.obraNaoEncontrada) {
    ctrLog_(rot + " " + pid + " obra nao encontrada");
    return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: ["Vendedor: obra da casa não encontrada em DOCUMENTOS (endereço)"] } };
  }
  var d = ContratoVenda.montarDadosContrato(f.fontes);
  var faltas = ContratoVenda.faltasContrato(d);
  if (faltas.length) {
    ctrLog_(rot + " " + pid + " faltas " + faltas.length);
    return { resp: { ok: false, erro: "FALTAM_DADOS", faltas: faltas } };
  }
  return { f: f, d: d };
}

/* Tudo o que vem antes de mexer no Drive: dados, faltas, Drive API, modelo, pasta, marcadores. */
function ctrPreparar_(col, p, pid, rot) {
  var x = ctrDadosAtuais_(col, p, pid, rot);
  if (x.resp) return x;
  var f = x.f, d = x.d;
  if (typeof Drive === "undefined" || !Drive || !Drive.Files || !Drive.Files.remove) {
    ctrLog_(rot + " " + pid + " Drive API desligada");
    return { resp: { ok: false, erro: "DRIVE_API_DESLIGADA" } }; /* sem ela a cópia com dado pessoal ficaria na lixeira */
  }
  var modeloId = prop_(d.modelo === "CONDOMINIO" ? "MODELO_CONDOMINIO_ID" : d.modelo === "PRONTO" ? "MODELO_PRONTO_ID" : "MODELO_CONSTRUCAO_ID"), pastaId = prop_("PASTA_PROVISORIA_ID");
  if (!modeloId || !pastaId) return { resp: { ok: false, erro: "MODELO_NAO_CONFIGURADO" } };
  var modelo, pasta, marcadores, blocos;
  try { modelo = DriveApp.getFileById(modeloId); pasta = DriveApp.getFolderById(pastaId); }
  catch (e) { ctrErro_(rot + " " + pid + " modelo inacessivel", e); return { resp: { ok: false, erro: "MODELO_NAO_CONFIGURADO" } }; }
  try { marcadores = ContratoVenda.marcadores(d); blocos = ContratoVenda.blocos(d); }
  catch (e) { ctrErro_(rot + " " + pid + " montagem falhou", e); return { resp: { ok: false, erro: "CONTRATO_FALHOU" } }; }
  var hash = ctrCarimbo_(d);
  var endereco = String(f.endereco).replace(/[\\\/:*?"<>|]/g, "-");
  var resto = endereco + (f.casa ? " - CASA " + f.casa : "") + " - " + hoje_("dd-MM-yyyy") + " [#" + hash + "].pdf";
  return { f: f, d: d, modelo: modelo, pasta: pasta, marcadores: marcadores, blocos: blocos, hash: hash, resto: resto };
}

/* Copia o modelo, preenche (grifar = pré-contrato), confere e exporta o PDF: { pdf } ou { resp }.
   A cópia com dado pessoal é apagada sempre (finally). */
function ctrGerarPdf_(prep, pid, rot, grifar) {
  var copia = null;
  try {
    copia = prep.modelo.makeCopy("contrato-provisorio-" + pid + "-" + Date.now(), prep.pasta);
    var doc = DocumentApp.openById(copia.getId());
    aplicarBlocos_(doc.getBody(), prep.blocos);
    ctrExpandirParagrafos_(doc.getBody(), prep.marcadores, grifar);
    ctrSecoes_(doc).forEach(function (sec) { aplicarMarcadores_(sec, prep.marcadores, grifar); });
    var sobrando = ctrMarcadoresSobrando_(doc);
    if (sobrando.length) {
      ctrLog_(rot + " " + pid + " marcador sobrando: " + sobrando.join(", "));
      doc.saveAndClose();
      return { resp: { ok: false, erro: "MODELO_COM_MARCADOR_SOBRANDO", marcadores: sobrando } };
    }
    doc.saveAndClose();
    return { pdf: DriveApp.getFileById(copia.getId()).getAs("application/pdf") };
  } catch (e) {
    ctrErro_(rot + " " + pid + " falhou", e);
    return { resp: { ok: false, erro: "CONTRATO_FALHOU" } };
  } finally {
    if (copia) apagarCopia_(copia.getId());
  }
}

/* Pré-contrato: o mesmo documento, com o que o app preencheu grifado. PDF na pasta provisória
   (PASTA_PROVISORIA_ID), NÃO em CONTRATO GERADO. O pré-contrato anterior desta página é apagado. */
function gerarPreContrato_(col, sess, p) {
  var t0 = Date.now(), pid = String(p.pageId).slice(0, 8), rot = "gerarPreContrato";
  var prep = ctrPreparar_(col, p, pid, rot);
  if (prep.resp) return prep.resp;
  var g = ctrGerarPdf_(prep, pid, rot, true);
  if (g.resp) return g.resp;
  var nome = "PRÉ-CONTRATO - " + prep.resto, arq;
  try { arq = prep.pasta.createFile(g.pdf.setName(nome)); }
  catch (e) { ctrErro_(rot + " " + pid + " pdf na pasta", e); return { ok: false, erro: "CONTRATO_FALHOU" }; }
  var antigo = ctrLerPre_(p.pageId), url = ctrTxt_(arq.getUrl());
  ctrGravarPre_(p.pageId, { hash: prep.hash, nome: nome, url: url, arquivoId: arq.getId(), em: new Date().toISOString(),
                            por: ctrTxt_(sess && sess.u) });
  if (antigo && antigo.arquivoId && antigo.arquivoId !== arq.getId()) apagarCopia_(antigo.arquivoId);
  var avisos = ContratoVenda.avisosContrato(prep.d);
  ctrLog_(rot + " " + pid + " ok " + (Date.now() - t0) + "ms" + (avisos.length ? "; em branco " + avisos.length : ""));
  return avisos.length ? { ok: true, nome: nome, url: url, avisos: avisos } : { ok: true, nome: nome, url: url };
}

/* "Conferi, está tudo certo — gerar contrato": só gera o contrato FINAL (sem grifos, em CONTRATO
   GERADO) se há pré-contrato e os dados de agora dão o MESMO carimbo dele. A ação antiga
   "gerarContrato" cai aqui também: não existe mais gerar o final direto. */
function aprovarPreContrato_(col, sess, p) {
  var t0 = Date.now(), pid = String(p.pageId).slice(0, 8), rot = "aprovarPreContrato";
  /* primeiro os dados (coluna, base, faltas valem como no pré-contrato), depois o pré-contrato */
  var prep = ctrPreparar_(col, p, pid, rot);
  if (prep.resp) return prep.resp;
  var pre = ctrLerPre_(p.pageId);
  if (!pre) { ctrLog_(rot + " " + pid + " sem pre-contrato"); return { ok: false, erro: "PRECONTRATO_FALTANDO" }; }
  if (prep.hash !== pre.hash) {
    ctrLog_(rot + " " + pid + " dados mudaram depois do pre-contrato");
    return { ok: false, erro: "PRECONTRATO_DESATUALIZADO" };
  }
  var g = ctrGerarPdf_(prep, pid, rot, false);
  if (g.resp) return g.resp;
  var nomePdf = "CONTRATO - " + prep.resto;
  try {
    anexarArquivo_(p.pageId, prep.f.colGerado, { nome: nomePdf, mime: "application/pdf", base64: Utilities.base64Encode(g.pdf.getBytes()) }, true);
  } catch (e) {
    ctrErro_(rot + " " + pid + " falhou", e);
    return { ok: false, erro: "CONTRATO_FALHOU" };
  }
  pre.conferidoEm = new Date().toISOString();
  pre.conferidoPor = ctrTxt_(sess && sess.u);
  try { ctrGravarPre_(p.pageId, pre); } catch (e) { ctrErro_(rot + " " + pid + " registro da conferencia", e); }

  var url = "";
  try { var a = ctrArquivoGerado_(ctrLerPaginaVenda_(p.pageId)); if (a) url = a.url; } catch (e) { ctrErro_(rot + " " + pid + " url", e); }
  var avisos = ContratoVenda.avisosContrato(prep.d);
  ctrLog_(rot + " " + pid + " ok " + (Date.now() - t0) + "ms" + (avisos.length ? "; em branco " + avisos.length : ""));
  return avisos.length ? { ok: true, nome: nomePdf, url: url, avisos: avisos } : { ok: true, nome: nomePdf, url: url };
}
