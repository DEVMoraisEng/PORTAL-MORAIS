/*************************************************************************
 * Code.gs · Morais Engenharia — Backend (API) dos sites internos
 * -----------------------------------------------------------------------
 * Guarda o token do Notion (NUNCA vai pro navegador), autentica contra o
 * banco LOGINS, emite sessão assinada (HMAC), lê dados filtrados e ESCREVE
 * no Notion (baixa de atividades, edição de vendas, upload de arquivo).
 *
 * COMO PUBLICAR:
 *   1) script.google.com -> Novo projeto -> cole este arquivo
 *   2) Extensões > Apps Script > Configurações do projeto > Propriedades do
 *      script -> adicionar:
 *        NOTION_TOKEN     -> token da integração do Notion
 *        SESSION_SECRET   -> uma frase longa e aleatória sua (se mudar, todo
 *                            mundo desloga)
 *      NUNCA colar esses dois valores direto no código — é exatamente esse
 *      tipo de coisa que vaza quando o arquivo é copiado/colado em outro
 *      lugar (chat, repositório, etc.). Fica só aqui, nas Propriedades.
 *   3) Implantar -> Nova implantação -> tipo "App da Web"
 *      - Executar como: Eu
 *      - Quem tem acesso: Qualquer pessoa
 *   4) Copie a URL que termina em /exec  (é ela que vai nos HTMLs)
 *   5) Toda vez que editar este código: Implantar -> Gerenciar implantações
 *      -> editar (lápis) -> Versão: Nova versão -> Implantar
 *      (salvar NÃO basta — tem que publicar nova versão)
 *      ATENÇÃO: use SEMPRE o lápis da implantação Ativa. Criar uma
 *      "Nova implantação" gera outra URL /exec e os sites param de achar o
 *      backend (a tela vira "Não foi possível abrir o arquivo" do Drive).
 *
 * TESTE RÁPIDO no navegador (sem login):  SUA_URL/exec?action=ping
 *************************************************************************/

/* Versão publicada. O ligacoes.html compara com o GS_ESPERADO dele e mostra
   o aviso "Apps Script atrasado" quando não bate. Era isto que faltava: o
   backend respondia ao "ping" SEM o campo versao, então a tela concluía que
   a publicação estava velha — mesmo você tendo implantado.
   r9: entrou a sincronização automática VENDAS -> PÓS OBRA (ver bloco
   "PÓS OBRA: sincronização automática", perto do bloco do GCAP).
   r10: essa sincronização foi reescrita para não regravar o que não mudou e
   para poder parar e continuar — a versão r9 estourava o limite de 6 min.
   r11: a função do acionador diário virou posObraSyncDiario (sem "_" no fim,
   senão não aparece na tela de Acionadores) + conferirPosObra() pra checar.
   r12: backend do setor PÓS OBRA (lista de obras com STATUS, página da obra,
   chamados de ATIVIDADES PÓS OBRA, calendário, botão de criar serviço).
   r13: a lista de obras passou a trazer só quem tem CLIENTE preenchido, e o
   calendário agora manda serviço, status do material e o texto da marcação —
   é o que o card do calendário e os alertas da tela precisam.
   r20 (ago/26): MELHORIAS — (1) trava de agendamento no PÓS OBRA: datas de
   serviço/retorno não podem cair em domingo nem feriado de Goiânia, e sábado
   só com senha de um ADM (ver bloco "AGENDAMENTO: sábado/feriado"); (2) ÁGIO
   sincronizado de VENDAS pro cabeçalho da obra no PÓS OBRA (ver bloco
   "PÓS OBRA: sincronização automática"). */
var VERSAO_GS = "2026-09-01 r20";

var PROPS_ = PropertiesService.getScriptProperties();
// .trim() aqui porque copiar/colar de chat ou de outra aba costuma trazer
// espaço ou quebra de linha junto — e isso sozinho já derruba a autenticação
// com um erro genérico do Notion, difícil de diagnosticar sem saber disso.
function prop_(nome) { var v = PROPS_.getProperty(nome); return v ? v.trim() : v; }

var CONFIG = {
  // Lidos das Propriedades do Script — nunca hardcoded aqui.
  NOTION_TOKEN: prop_("NOTION_TOKEN"),
  SESSION_SECRET: prop_("SESSION_SECRET"),

  SESSION_HORAS: 720,            // 30 dias — "continua logado no mesmo PC"
  HASH_SENHAS: true,             // grava a senha como hash no 1º login (some o texto puro do Notion)
  MAX_TENTATIVAS: 5,             // erros de senha antes de bloquear
  LOCK_SEGUNDOS: 900,            // tempo de bloqueio após estourar (15 min)
  NOTION_VERSION: "2022-06-28",

  // Quanto tempo o servidor confia no tipo/acessos gravados dentro do token
  // sem checar de novo no Notion. Baixo o suficiente pra permissão liberada
  // no LOGINS valer rápido, sem martelar a API do Notion a cada clique.
  ACESSO_CACHE_SEGUNDOS: 300,

  DB: {
    LOGINS:            "3bac5ab532d380d4968df15d5357f462",
    VENDAS:            "33cc5ab532d38047ae3aee8b87ac1f4d",
    ATIVIDADES_VENDAS: "33dc5ab532d380abaa00fecd5c2d88c2",
    DISPONIBILIDADES:  "33dc5ab532d38091b927d7659f98612c",
    DOCUMENTOS:        "32fc5ab532d380a0900dd7f4bfc619bd",
    METAS:             "358c5ab532d3804fbcbfebc3656b1220",
    // LIGAÇÕES DE ÁGUA E ENERGIA — uma linha por casa e concessionária.
    // É a base que alimenta o ligacoes.html.
    LIGACOES:          "313c5ab532d3801e974ced0bb656c9d5",
    // PÓS OBRA — uma linha por obra/casa, sincronizada automaticamente a
    // partir de VENDAS (ver bloco "PÓS OBRA: sincronização automática",
    // logo depois do bloco do GCAP).
    POS_OBRA:            "3c9c5ab532d380a0b78bdb2f421bc9f5",
    // ATIVIDADES PÓS OBRA — chamados de assistência técnica. Id já
    // confirmado ao vivo no Notion; a lógica de criação/leitura/edição
    // desses chamados ainda será escrita num próximo patch — por enquanto
    // este id só fica reservado aqui.
    ATIVIDADES_POS_OBRA: "3c9c5ab532d3800f8261fdab1e4ff621"
  }
};

// Falha alto e claro no boot se alguém esquecer de configurar as
// Propriedades — melhor um erro explícito no log do que um 401 silencioso
// de "Bearer undefined" lá na frente.
if (!CONFIG.NOTION_TOKEN) {
  console.error("FALTA CONFIGURAR: Propriedades do script > NOTION_TOKEN");
}
if (!CONFIG.SESSION_SECRET) {
  console.error("FALTA CONFIGURAR: Propriedades do script > SESSION_SECRET");
}

// Mapa "dar baixa": TIPO da atividade -> coluna da OBRA (VENDAS) que é escrita.
// (extraído dos rollups reais do seu Notion)
var BAIXA_MAP = {
  "CONFERIR PESQUISA":       "PREENCHEU A PESQUISA?",
  "AGENDAR VISTÓRIA":        "AGENDOU PRE VISTORIA?",
  "EMITIR RCPM":             "EMITIU RCPM?",
  "FAZER MANUAL":            "TEM MANUAL DE OBRA?",
  "VERIFICAÇÃO DE ENTREGA":  "ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?",
  "ARMAZENAGEM DE CONTRATO": "ARMAZENOU CONTRATO COMPRA E VENDA?",
  "ASSINATURA DE CONTRATO":  "ASSINOU E ARMAZENOU CONTRATO DO BANCO?",
  "CONFERIR CONFORMIDADE":   "PROCESSO CONFORME?",
  "TRANSFERÊNCIA":           "TITULARIDADES TRANSFERIDAS?",
  "VISTORIA PRÉVIA":         "CASA APTA PARA A VISTORIA",
  "GCAP":                    "PAGOU GCAP?",
  "RET":                     "PAGOU GCAP?",     // <-- CONFIRMAR (rollup do seu Notion aponta aqui)
  "REPAROS VISTORIA":        "REPAROS PRE VISTORIA REALIZADOS"
};

/* ===================== AUTORIZAÇÃO POR AÇÃO =====================
 * FALHA CORRIGIDA AQUI: até esta versão o backend só AUTENTICAVA (o token é
 * válido?) e não AUTORIZAVA (esta pessoa pode isto?). Na prática, QUALQUER
 * login válido — inclusive um usuário GERAL que só tem "RAS COMPRAS" em
 * ACESSOS — podia chamar as ações do sistema de vendas pelo DevTools e:
 *   - "obra"        -> ler CLIENTES, CPF, WhatsApp de qualquer obra
 *                      (obra_ devolve resolver_ de TODAS as propriedades,
 *                       inclusive as que o dist/ esconde de propósito)
 *   - "vendas"      -> baixar a base inteira
 *   - "updateVenda" -> escrever em qualquer campo de qualquer obra
 *   - "baixa"       -> dar baixa em atividade de qualquer setor
 *   - "upload"      -> anexar arquivo em qualquer obra
 * Esconder o botão no HTML não protege nada: a trava tem que ser no servidor.
 *
 * Ponto único de checagem, de propósito — ação nova que não entrar nesta
 * lista fica SEM proteção, então ao acrescentar uma action no roteador,
 * acrescente aqui também.
 * =================================================================== */
function temAcesso_(sess, chave) {
  if (vePorTodos_(sess)) return true;   // ADM, MASTER e TESTES enxergam tudo
  return (sess.a || []).indexOf(chave) >= 0;
}
// Ações que pertencem ao sistema de VENDAS (o vendas.html / portal).
var ACOES_VENDAS = [
  "portal", "atividades", "baixa", "vendasSchema", "vendas", "obra",
  "updateVenda", "criarVenda", "excluirVenda", "distrato",
  /* "novaOpcao" SAIU daqui de propósito: ela passou a atender também o PÓS
     OBRA (tipo de serviço e responsável). Se continuasse nesta lista, o
     handle_ exigiria acesso a VENDAS de quem só trabalha no pós obra. Quem
     confere a permissão agora é o próprio novaOpcao_, por base. */
  "upload", "setores", "documentosSchema", "documentos",
  "comentarios", "comentarioNovo", "usuarios", "titulos"
];
// Ações do sistema de LIGAÇÕES DE ÁGUA E ENERGIA (o ligacoes.html).
// Mesma regra do ACOES_VENDAS: token válido NÃO basta, a pessoa precisa ter
// "LIGAÇÕES" na coluna ACESSOS do banco LOGINS (ADM e MASTER passam sempre).
var ACOES_LIGACOES = [
  "ligacoes", "ligacao", "ligUpdate",
  // abas de acompanhamento e de contas (rodada 2)
  "ligSensiveis", "ligVendasSensiveis", "ligAtividades", "ligBaixa",
  "ligVendaUpdate",
  // anexar a NF do medidor pela própria tela (rodada 3)
  "ligAnexar",
  // lista de pessoas para o <select> de RESPONSÁVEL (rodada 4)
  "ligResponsaveis",
  // arquivar uma linha da base (só ADM — ver ligExcluir_)
  "ligExcluir",
  // criar linha nova na base de ligações pela tela — só ADM (ver ligCriar_)
  "ligCriar"
];

/* Ações do sistema de PÓS OBRA (a futura pos-obra.html). Mesma regra dos
   outros setores: token válido NÃO basta, a pessoa precisa ter "PÓS OBRA" na
   coluna ACESSOS do banco LOGINS (ADM, MASTER e TESTES passam sempre).
   ATENÇÃO: essa opção precisa ser criada na coluna ACESSOS do Notion — ver o
   bloco "PÓS OBRA: TELA DO SITE E CHAMADOS" mais abaixo. */
var ACOES_POS_OBRA = [
  "posObras", "posObra", "posObraSchema", "posObraAgenda",
  "posObraServicoNovo", "posObraAtvUpdate", "posObraUpdate", "posObraAnexar",
  "posObraRetornoExcluir",
  // gera/mostra o link da agenda do dia — só ADM (trava dentro de agendaLink_)
  "agendaLink",
  // confere login+senha de um ADM antes de tentar marcar sábado (ver
  // checarDataAgendamento_) — não grava nada, só valida
  "posObraValidarAdm"
];

/* Ações que GRAVAM (Notion, schema ou arquivo). O perfil TESTES é barrado em
   todas elas — ver o bloco no handle_. Ação nova que grave precisa entrar
   aqui, senão o modo teste escreve de verdade sem ninguém perceber. */
var ACOES_ESCRITA = [
  "baixa", "updateVenda", "criarVenda", "excluirVenda", "distrato", "novaOpcao",
  "upload", "comentarioNovo", "gerarAtividadesGcap",
  "ligUpdate", "ligAnexar", "ligBaixa", "ligVendaUpdate", "ligExcluir", "ligCriar",
  "posObraServicoNovo", "posObraAtvUpdate", "posObraUpdate", "posObraAnexar"
];

/* Ações do sistema de ANÁLISES (analise.html). Exigem "ANÁLISES" na coluna
   ACESSOS do banco LOGINS (ADM, MASTER e TESTES passam sempre). Todas só
   LEEM o Supabase — não gravam nada, então de propósito NÃO entram em
   ACOES_ESCRITA. */
var ACOES_ANALISE = [
  "analiseResumo", "analiseObras", "analiseInsumos", "analiseDetalheObra",
  // quais obras usam um insumo (clique na linha da tabela) — só leitura
  "analiseInsumoObras"
];

/* ===================== ROTEADOR ===================== */
function doGet(e)  { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  var p = {};
  try { if (e && e.postData && e.postData.contents) p = JSON.parse(e.postData.contents); } catch (_) {}
  if (e && e.parameter) for (var k in e.parameter) if (!(k in p)) p[k] = e.parameter[k];

  var action = p.action || "";
  try {
    if (action === "ping")  return out_({ ok: true, msg: "backend ok", versao: VERSAO_GS, hora: new Date().toISOString() });
    if (action === "login") return out_(login_(p));
    /* AGENDA DO DIA — a ÚNICA ação que roda sem token de login.
       Entra aqui em cima, antes do verificar_, de propósito e com escopo
       mínimo: ver o bloco "AGENDA DO DIA" mais abaixo. */
    if (action === "agendaDia") return out_(agendaDia_(p));

    var sess = verificar_(p.token);
    if (!sess) return out_({ ok: false, erro: "NAO_AUTORIZADO" });

    // AUTORIZAÇÃO: token válido não basta — a pessoa precisa ter o acesso.
    if (ACOES_VENDAS.indexOf(action) >= 0 && !temAcesso_(sess, "VENDAS")) {
      console.log("BLOQUEADO por falta de acesso VENDAS: " + sess.u + " -> " + action);
      return out_({ ok: false, erro: "SEM_PERMISSAO" });
    }
    if (ACOES_LIGACOES.indexOf(action) >= 0 && !temAcesso_(sess, "LIGAÇÕES")) {
      console.log("BLOQUEADO por falta de acesso LIGAÇÕES: " + sess.u + " -> " + action);
      return out_({ ok: false, erro: "SEM_PERMISSAO" });
    }
    if (ACOES_POS_OBRA.indexOf(action) >= 0 && !temAcesso_(sess, "PÓS OBRA")) {
      console.log("BLOQUEADO por falta de acesso PÓS OBRA: " + sess.u + " -> " + action);
      return out_({ ok: false, erro: "SEM_PERMISSAO" });
    }
    if (ACOES_ANALISE.indexOf(action) >= 0 && !temAcesso_(sess, "ANÁLISES")) {
      console.log("BLOQUEADO por falta de acesso ANÁLISES: " + sess.u + " -> " + action);
      return out_({ ok: false, erro: "SEM_PERMISSAO" });
    }

    /* TESTES: perfil de conferência. Vê tudo, mas não grava nada.
       A trava fica AQUI, no servidor, e não na tela — de propósito: a ideia do
       perfil é justamente abrir os campos e ver o que apareceria como
       editável. Os campos continuam abrindo; quem recusa a gravação é o
       backend, com um código próprio pra tela dar a mensagem certa. */
    if (ehTestes_(sess) && ACOES_ESCRITA.indexOf(action) >= 0) {
      console.log("MODO TESTE bloqueou escrita: " + sess.u + " -> " + action);
      return out_({ ok: false, erro: "MODO_TESTE" });
    }

    switch (action) {
      case "me":               return out_({ ok: true, sessao: pub_(sess) });
      case "portal":            return out_(portal_(sess));
      case "atividades":        return out_(atividades_(sess, p));
      case "baixa":             return out_(baixa_(sess, p));
      case "vendasSchema":      return out_(vendasSchema_(sess));
      case "vendas":            return out_(vendas_(sess, p));
      case "obra":              return out_(obra_(sess, p));
      case "updateVenda":       return out_(updateVenda_(sess, p));
      case "criarVenda":        return out_(criarVenda_(sess, p));
      case "excluirVenda":      return out_(excluirVenda_(sess, p));
      case "distrato":          return out_(distrato_(sess, p));
      case "novaOpcao":         return out_(novaOpcao_(sess, p));
      case "upload":            return out_(upload_(sess, p));
      case "setores":           return out_(setores_(sess));
      case "documentosSchema":  return out_(documentosSchema_(sess));
      case "documentos":        return out_(documentos_(sess, p));
      case "comentarios":       return out_(comentarios_(sess, p));
      case "comentarioNovo":    return out_(comentarioNovo_(sess, p));
      case "usuarios":          return out_(usuarios_(sess));
      case "titulos":           return out_(titulos_(sess, p));
      // LIGAÇÕES DE ÁGUA E ENERGIA (ligacoes.html)
      case "ligacoes":          return out_(ligacoes_(sess, p));
      case "ligacao":           return out_(ligacao_(sess, p));
      case "ligUpdate":         return out_(ligUpdate_(sess, p));
      case "ligExcluir":        return out_(ligExcluir_(sess, p));
      case "ligCriar":          return out_(ligCriar_(sess, p));
      case "ligAnexar":         return out_(ligAnexar_(sess, p));
      case "ligResponsaveis":   return out_(ligResponsaveis_(sess, p));
      case "ligSensiveis":      return out_(ligSensiveis_(sess, p));
      case "ligVendasSensiveis":return out_(ligVendasSensiveis_(sess, p));
      case "ligAtividades":     return out_(ligAtividades_(sess, p));
      case "ligBaixa":          return out_(ligBaixa_(sess, p));
      case "ligVendaUpdate":    return out_(ligVendaUpdate_(sess, p));
      // PÓS OBRA (pos-obra.html)
      case "posObras":          return out_(posObras_(sess, p));
      case "posObra":           return out_(posObra_(sess, p));
      case "posObraSchema":     return out_(posObraSchemaAcao_(sess));
      case "posObraAgenda":     return out_(posObraAgenda_(sess, p));
      case "posObraServicoNovo":return out_(posObraServicoNovo_(sess, p));
      case "posObraAtvUpdate":  return out_(posObraAtvUpdate_(sess, p));
      case "posObraUpdate":     return out_(posObraUpdate_(sess, p));
      case "agendaLink":        return out_(agendaLink_(sess, p));
      case "posObraRetornoExcluir": return out_(posObraRetornoExcluir_(sess, p));
      case "posObraValidarAdm": return out_(posObraValidarAdm_(sess, p));
      case "posObraAnexar":     return out_(posObraAnexar_(sess, p));
      // ANÁLISES — Orçado x Realizado (analise.html) — só leitura do Supabase
      case "analiseResumo":       return out_(analiseResumo_(sess, p));
      case "analiseObras":        return out_(analiseObras_(sess, p));
      case "analiseInsumos":      return out_(analiseInsumos_(sess, p));
      case "analiseInsumoObras": return out_(analiseInsumoObras_(sess, p));
      case "analiseDetalheObra":  return out_(analiseDetalheObra_(sess, p));
      case "gerarAtividadesGcap":
        if (!ehAdm_(sess)) return out_({ ok: false, erro: "APENAS_ADM" });
        return out_(criarAtividadesGcap_());
      default:                  return out_({ ok: false, erro: "ACAO_DESCONHECIDA: " + action });
    }
  } catch (err) {
    return out_({ ok: false, erro: String(err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Rode manualmente (menu Executar, com esta função selecionada) pra testar
// se o token está certo, sem precisar passar pelo site. Veja o resultado em
// Ver > Execuções (ou Logger.log aparece direto após rodar).
function testeToken() {
  Logger.log("NOTION_TOKEN configurado? " + (CONFIG.NOTION_TOKEN ? "sim (" + CONFIG.NOTION_TOKEN.length + " caracteres)" : "NÃO — falta configurar a Propriedade"));
  if (!CONFIG.NOTION_TOKEN) return;
  try {
    var db = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null);
    Logger.log("OK — token válido. Base VENDAS respondeu: " + (db.title && db.title[0] ? db.title[0].plain_text : db.id));
  } catch (e) {
    Logger.log("FALHOU: " + e);
  }
}

/* ===================== SESSÃO (HMAC) ===================== */
function assinar_(payloadObj) {
  var payload = Utilities.base64EncodeWebSafe(
    Utilities.newBlob(JSON.stringify(payloadObj)).getBytes());   // UTF-8 (corrige acentos)
  var sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, CONFIG.SESSION_SECRET));
  return payload + "." + sig;
}
function verificar_(token) {
  try {
    var parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    var esperado = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(parts[0], CONFIG.SESSION_SECRET));
    if (esperado !== parts[1]) return null;
    var payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString("UTF-8"));
    if (payload.exp && Date.now() > payload.exp) return null;

    // ATUALIZAÇÃO CRÍTICA: o token guarda tipo/acessos de quando a pessoa LOGOU.
    // Sessão dura 30 dias — sem isso, liberar um acesso novo no Notion (LOGINS)
    // só valeria depois que a pessoa deslogasse e logasse de novo. Aqui a gente
    // busca o tipo/acessos "frescos" do Notion (com cache curto) e sobrescreve
    // o payload antes de devolver, então a liberação passa a valer em minutos.
    var fresco = acessosFrescos_(payload.u);
    if (fresco) { payload.t = fresco.tipo; payload.a = fresco.acessos; }

    return payload;
  } catch (e) { return null; }
}
function pub_(sess) {
  return { login: sess.u, pessoa: sess.p, nome: sess.n, tipo: sess.t, acessos: sess.a || [] };
}
function ehAdm_(sess)    { return (sess.t || "").toUpperCase() === "ADM"; }
function ehMaster_(sess) { return (sess.t || "").toUpperCase() === "MASTER"; }
function ehTestes_(sess) { return (sess.t || "").toUpperCase() === "TESTES"; }
/* MASTER e TESTES enxergam o mesmo que o ADM (atividades de todo mundo, todos
   os campos, todas as abas — sem precisar preencher a coluna ACESSOS).
   O que MASTER não pode está travado caso a caso (apagar e editar ENDEREÇO);
   TESTES não grava NADA (ver ACOES_ESCRITA). */
function vePorTodos_(sess) { return ehAdm_(sess) || ehMaster_(sess) || ehTestes_(sess); }

// Busca tipo/acessos direto do banco LOGINS, com cache curto (evita martelar o
// Notion a cada clique, mas garante que uma mudança de permissão feita lá
// valha rápido — ver ACESSO_CACHE_SEGUNDOS).
function acessosFrescos_(login) {
  if (!login) return null;
  return comCache_("acessos_" + String(login).toLowerCase(), CONFIG.ACESSO_CACHE_SEGUNDOS, function () {
    try {
      var rows = queryAll_(CONFIG.DB.LOGINS, {});
      for (var i = 0; i < rows.length; i++) {
        var pr = rows[i].properties;
        var lg = titulo_(pr["LOGIN"]);
        if (lg && lg.toLowerCase() === String(login).toLowerCase()) {
          var tipo = (pr["TIPO"] && pr["TIPO"].select && pr["TIPO"].select.name) || "GERAL";
          var acessos = ((pr["ACESSOS"] && pr["ACESSOS"].multi_select) || []).map(function (o) { return o.name; });
          return { tipo: tipo, acessos: acessos };
        }
      }
    } catch (e) { /* Notion fora do ar: mantém o que já estava no token */ }
    return null;
  });
}

/* ===================== LOGIN ===================== */
function login_(p) {
  var login = String(p.login || "").trim();
  var senha = String(p.senha || "");
  if (!login) return { ok: false, erro: "INFORME_LOGIN" };

  var chaveFalha = login.toLowerCase();
  if (tentativas_(chaveFalha) >= CONFIG.MAX_TENTATIVAS) return { ok: false, erro: "BLOQUEADO" };

  var rows = queryAll_(CONFIG.DB.LOGINS, {});
  for (var i = 0; i < rows.length; i++) {
    var pr = rows[i].properties;
    var lg = titulo_(pr["LOGIN"]);
    if (lg && lg.toLowerCase() === login.toLowerCase()) {
      var armazenado = String(texto_(pr["SENHA"]));
      if (!verificaSenha_(senha, armazenado)) {
        var n = registrarFalha_(chaveFalha);
        return { ok: false, erro: "SENHA_INCORRETA", restantes: Math.max(0, CONFIG.MAX_TENTATIVAS - n) };
      }
      limparFalhas_(chaveFalha);

      // migra senha em texto puro -> hash (uma vez, silencioso)
      if (CONFIG.HASH_SENHAS && armazenado.indexOf("sha256$") !== 0) {
        try { notion_("PATCH", "/pages/" + rows[i].id, { properties: { "SENHA": { rich_text: [{ text: { content: hashSenha_(senha) } }] } } }); } catch (e) {}
      }

      var pa = (pr["PESSOA"] && pr["PESSOA"].people) || [];
      var tipo = (pr["TIPO"] && pr["TIPO"].select && pr["TIPO"].select.name) || "GERAL";
      var acessos = ((pr["ACESSOS"] && pr["ACESSOS"].multi_select) || []).map(function (o) { return o.name; });
      var exp = Date.now() + CONFIG.SESSION_HORAS * 3600 * 1000;
      var sessao = { login: login, pessoa: pa[0] ? pa[0].id : "", nome: pa[0] ? (pa[0].name || "") : "", tipo: tipo, acessos: acessos };
      var token = assinar_({ u: login, p: sessao.pessoa, n: sessao.nome, t: tipo, a: acessos, exp: exp });
      // já deixa o cache de acessos "quente" com o valor recém-lido — evita
      // uma consulta redundante ao Notion logo no primeiro clique pós-login
      try { _cache_().put("acessos_" + login.toLowerCase(), JSON.stringify({ tipo: tipo, acessos: acessos }), CONFIG.ACESSO_CACHE_SEGUNDOS); } catch (e) {}
      return { ok: true, token: token, sessao: sessao };
    }
  }
  registrarFalha_(chaveFalha);
  return { ok: false, erro: "LOGIN_NAO_ENCONTRADO" };
}

/* ===================== SEGURANÇA (hash + tentativas + cache) ===================== */
function hashSenha_(senha, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + "|" + senha, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
  return "sha256$" + salt + "$" + hex;
}
function verificaSenha_(senha, armazenado) {
  if (armazenado && armazenado.indexOf("sha256$") === 0) {
    var p = armazenado.split("$");            // ["sha256", salt, hex]
    return hashSenha_(senha, p[1]) === armazenado;
  }
  return String(armazenado) === String(senha); // legado (texto puro)
}
// Rode manualmente (menu Executar) se quiser gerar um hash pra colar no Notion à mão:
function gerarHashSenha() { Logger.log(hashSenha_("TROQUE_PELA_SENHA_AQUI")); }

function _cache_() { return CacheService.getScriptCache(); }
function tentativas_(login) { return Number(_cache_().get("fail_" + login) || 0); }
function registrarFalha_(login) { var n = tentativas_(login) + 1; _cache_().put("fail_" + login, String(n), CONFIG.LOCK_SEGUNDOS); return n; }
function limparFalhas_(login) { _cache_().remove("fail_" + login); }

function comCache_(chave, segundos, fn) {
  var c = _cache_(), hit = c.get(chave);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var val = fn();
  try { c.put(chave, JSON.stringify(val), segundos); } catch (e) {}
  return val;
}

/* ===================== PORTAL (KPIs calculados no servidor) =====================
 * NOTA: o site (index.html) hoje calcula esses mesmos números no navegador, a
 * partir do dist/vendas.json publicado pelo fetch_vendas.py — mais rápido,
 * sem esperar o Apps Script paginar o Notion ao vivo (mesmo motivo do
 * RAS-SEMANAL ser rápido). Esta função ficou sem uso pelo front-end atual,
 * mas deixei corrigida e funcional — serve de referência/fallback se um dia
 * quiser voltar a ler ao vivo, ou pra outro consumidor da API. */
function portal_(sess) { return comCache_("kpi_portal", 600, _portalCalc_); }   // cache 10 min
function _portalCalc_() {
  var ano = Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy");

  // Venda de casas (só do ano vigente)
  var vendas = queryAll_(CONFIG.DB.VENDAS, {});
  var casas = 0, vgv = 0, mesesV = {};
  vendas.forEach(function (r) {
    var pr = r.properties;
    var dv = dt_(getTol_(pr, "DATA DA VENDA"));
    if (dv && dv.slice(0, 4) === ano) {
      casas++; mesesV[dv.slice(0, 7)] = 1;
      var v = numProp_(getTol_(pr, "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)"));
      if (v) vgv += v;
    }
  });
  var nMV = Object.keys(mesesV).length || 1;

  // Início de obras + lotes (só do ano vigente)
  var docs = queryAll_(CONFIG.DB.DOCUMENTOS, {});
  var iniciadas = 0, lotes = 0, mesesO = {};
  docs.forEach(function (r) {
    var pr = r.properties;
    var oi = sel_(getTol_(pr, "OBRA INCIADA"));
    var di = dt_(getTol_(pr, "DATA DE INÍCIO DA OBRA"));
    if ((oi === "SIM" || oi === "SIM SEM PRAZO") && di && di.slice(0, 4) === ano) {
      iniciadas++; mesesO[di.slice(0, 7)] = 1;
    }
    var dl = dt_(getTol_(pr, "DATA DE AQUISIÇÃO DO LOTE"));
    if (dl && dl.slice(0, 4) === ano) lotes++;
  });
  var nMO = Object.keys(mesesO).length || 1;

  // Meta do ano
  var metas = queryAll_(CONFIG.DB.METAS, {});
  var meta = 0;
  metas.forEach(function (r) { if (titulo_(r.properties["ANO"]) === ano) meta = numProp_(r.properties["META DE CASAS"]) || 0; });

  return {
    ok: true, ano: ano,
    vendaCasas:  { total: casas, vgv: vgv, mediaMes: casas / nMV, ticket: casas ? vgv / casas : 0, meses: nMV },
    inicioObras: { iniciadas: iniciadas, mediaMes: iniciadas / nMO, meta: meta, pct: meta ? iniciadas / meta : 0, meses: nMO },
    lotes:       { total: lotes }
  };
}
/* ===================== ATIVIDADES (setor vendas) ===================== */
function atividades_(sess, p) {
  var hoje = Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd");
  var and = [
    { property: "DATA INICIAL",       date: { on_or_before: hoje } },
    { property: "ATIVIDADE FINALIZADA", formula: { string: { contains: "NÃO" } } }
  ];
  if (!vePorTodos_(sess) && sess.p) and.push({ property: "RESPONSÁVEL", people: { contains: sess.p } });

  var rows = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {
    filter: { and: and },
    sorts: [{ property: "DATA FINAL PREVISTA", direction: "ascending" }]
  });

  var lista = rows.map(function (r) {
    var pr = r.properties;
    var rel = (pr["OBRA"] && pr["OBRA"].relation) || [];
    return {
      id: r.id,
      nome: titulo_(pr["Nome"]),
      tipo: sel_(pr["TIPO"]),
      dataInicial: dt_(pr["DATA INICIAL"]),
      dataFinal: dt_(pr["DATA FINAL PREVISTA"]),
      responsavel: pessoas_(pr["RESPONSÁVEL"]),
      obraId: rel[0] ? rel[0].id : null,
      coluna: BAIXA_MAP[sel_(pr["TIPO"])] || null
    };
  });
  return { ok: true, total: lista.length, atividades: lista };
}

function baixa_(sess, p) {
  var atvId = p.atividadeId;
  var valor = p.valor || "SIM";
  if (!atvId) return { ok: false, erro: "SEM_ATIVIDADE" };

  var atv = notion_("GET", "/pages/" + atvId, null);
  var pr = atv.properties;
  var tipo = sel_(pr["TIPO"]);
  var coluna = BAIXA_MAP[tipo];
  if (!coluna) return { ok: false, erro: "TIPO_SEM_MAPEAMENTO: " + tipo };

  var rel = (pr["OBRA"] && pr["OBRA"].relation) || [];
  if (!rel.length) return { ok: false, erro: "ATIVIDADE_SEM_OBRA" };

  var props = {}; props[coluna] = { select: { name: valor } };
  notion_("PATCH", "/pages/" + rel[0].id, { properties: props });
  return { ok: true, coluna: coluna, valor: valor };
}

/* ===================== ATIVIDADE AUTOMÁTICA: GCAP (item 8) =====================
 * Toda venda com DATA DE ASSINATURA DO CONTRATO preenchida e PAGOU GCAP?
 * ainda vazio ganha uma atividade TIPO="GCAP" pro Júlio César, com prazo no
 * 1º dia útil do mês seguinte à assinatura. A baixa dessa atividade já
 * funciona pelo mecanismo que já existia (baixa_ + BAIXA_MAP["GCAP"] =
 * "PAGOU GCAP?") — nada precisou mudar ali, só a CRIAÇÃO era manual até agora.
 *
 * DUAS COISAS QUE ASSUMI (me avisa se não for isto que você queria):
 *  1) "resolvido" = PAGOU GCAP? = SIM (ou qualquer valor que não seja
 *     NÃO/vazio, tipo INEXISTE/ÁGIO se essas opções existirem na sua
 *     coluna). NÃO é tratado como PENDENTE, igual a vazio — mesma lógica
 *     booleana do resto do sistema (ver ehSim() no vendas.html).
 *  2) "dia útil" considera só sábado/domingo, sem feriado nenhum. Se quiser
 *     feriados nacionais/municipais entrando na conta, me avisa que eu ligo
 *     numa lista (ou numa API de feriados).
 * =================================================================== */
var PESSOA_ALVO_GCAP = "Júlio César Gomes de Morais Filho";

function pad2_(n) { return (n < 10 ? "0" : "") + n; }

/* 1º dia útil do mês SEGUINTE a dataStr ("yyyy-mm-dd").
   Aritmética por número, nunca por string de Date — o mesmo cuidado que já
   existe no fetch_vendas.py contra o bug de fuso UTC-3 (comentário "Fix
   Mar/26" lá no PDF de instruções): "new Date('yyyy-mm-dd')" lê como UTC e,
   em GMT-3, pode devolver o dia anterior. Passando números pro construtor
   (ano, mêsIndex, dia), o Date usa o fuso do projeto, não UTC. */
function primeiroDiaUtilMesSeguinte_(dataStr) {
  var partes = String(dataStr).slice(0, 10).split("-");
  var ano = Number(partes[0]), mes = Number(partes[1]); // mes: 1-12
  var anoSeg = mes === 12 ? ano + 1 : ano;
  var mesSeg = mes === 12 ? 1 : mes + 1;
  var d = new Date(anoSeg, mesSeg - 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); // pula sáb/dom
  return anoSeg + "-" + pad2_(mesSeg) + "-" + pad2_(d.getDate());
}

/* Acha o ID de pessoa (propriedade "people" do Notion) a partir do nome.
   Tenta primeiro em LOGINS > PESSOA (mesma coluna que o login_ já lê);
   se não achar (ex.: Júlio não tem login próprio), procura em qualquer
   atividade que já tenha essa pessoa em RESPONSÁVEL. Fica em cache 6h —
   o ID de uma pessoa no Notion não muda. */
function acharPessoaIdPorNome_(nomeAlvo) {
  return comCache_("pessoa_id_" + normDist_(nomeAlvo), 21600, function () {
    var alvo = normDist_(nomeAlvo);
    var logins = queryAll_(CONFIG.DB.LOGINS, {});
    for (var i = 0; i < logins.length; i++) {
      var pa = (logins[i].properties["PESSOA"] && logins[i].properties["PESSOA"].people) || [];
      if (pa[0] && normDist_(pa[0].name) === alvo) return pa[0].id;
    }
    var atvs = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {});
    for (var j = 0; j < atvs.length; j++) {
      var resp = (atvs[j].properties["RESPONSÁVEL"] && atvs[j].properties["RESPONSÁVEL"].people) || [];
      for (var k = 0; k < resp.length; k++) {
        if (normDist_(resp[k].name) === alvo) return resp[k].id;
      }
    }
    return null;
  });
}

/* Ids das obras que JÁ têm atividade de GCAP.
   Antes isto era uma consulta ao Notion POR VENDA (filtro relation contains) —
   com ~220 vendas elegíveis davam ~220 consultas sequenciais, o que fazia o
   job levar minutos e, pior, competir com as requisições do site (o Apps
   Script atende poucas execuções por vez). Agora é UMA consulta: lê as
   atividades de GCAP uma vez e monta um conjunto de ids pra consultar em
   memória.
   Página arquivada não vem no queryAll_, então uma obra que passou por
   distrato e foi revendida volta a gerar atividade — que é o desejado. */
function obrasComAtividadeGcap_() {
  var set = {};
  var todas = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {});
  todas.forEach(function (a) {
    if (sel_(a.properties["TIPO"]) !== "GCAP") return;
    var rel = (a.properties["OBRA"] && a.properties["OBRA"].relation) || [];
    rel.forEach(function (o) { if (o.id) set[String(o.id).replace(/-/g, "")] = true; });
  });
  return set;
}

/* Núcleo: varre VENDAS, cria o que faltar. Não lança se uma obra falhar —
   segue para as próximas e devolve os erros juntos no resumo final. */
function criarAtividadesGcap_() {
  var pessoaId = acharPessoaIdPorNome_(PESSOA_ALVO_GCAP);
  if (!pessoaId) {
    return { ok: false, erro: "PESSOA_NAO_ENCONTRADA: " + PESSOA_ALVO_GCAP +
      " — confira se o nome bate exatamente com o people no Notion (LOGINS > PESSOA, ou RESPONSÁVEL de alguma atividade existente)." };
  }

  var vendas = queryAll_(CONFIG.DB.VENDAS, {
    filter: { property: "DATA DE ASSINATURA DO CONTRATO", date: { is_not_empty: true } }
  });
  var jaTem = obrasComAtividadeGcap_();   // uma consulta só, em vez de uma por venda

  var criadas = 0, jaExistiam = 0, semGcapPendente = 0, erros = [];
  vendas.forEach(function (v) {
    try {
      var val = resolver_(v.properties);
      // item (correção): "NÃO" é um estado ATIVO de pendência, igual ao
      // resto do sistema (ver ehSim() no vendas.html) — não é "resolvido".
      // Só conta como resolvido: SIM, ou qualquer outro valor explícito
      // diferente de NÃO/NAO/NO (ex.: INEXISTE, ÁGIO, se essas opções
      // existirem na sua coluna). Em branco também é pendente.
      var pagouGcap = normDist_(val["PAGOU GCAP?"] || "");
      var pendenteGcap = !pagouGcap || pagouGcap === "NAO" || pagouGcap === "NO";
      if (!pendenteGcap) { semGcapPendente++; return; }
      if (jaTem[String(v.id).replace(/-/g, "")]) { jaExistiam++; return; }

      var dataAssin = val["DATA DE ASSINATURA DO CONTRATO"];
      if (!dataAssin) return;
      var prazo = primeiroDiaUtilMesSeguinte_(dataAssin);
      var endereco = val["ENDEREÇO"] || "(sem endereço)";
      var casa = val["CASA"];
      var nomeAtv = "Pagar GCAP – " + endereco + (casa ? (" · Casa " + casa) : "");

      notion_("POST", "/pages", {
        parent: { database_id: CONFIG.DB.ATIVIDADES_VENDAS },
        properties: {
          "Nome":                { title: [{ text: { content: nomeAtv } }] },
          "TIPO":                { select: { name: "GCAP" } },
          "OBRA":                { relation: [{ id: v.id }] },
          "RESPONSÁVEL":         { people: [{ id: pessoaId }] },
          "DATA INICIAL":        { date: { start: dataAssin } },
          "DATA FINAL PREVISTA": { date: { start: prazo } }
        }
      });
      criadas++;
    } catch (e) {
      erros.push(v.id + ": " + e);
    }
  });

  return { ok: true, criadas: criadas, jaExistiam: jaExistiam, semGcapPendente: semGcapPendente, erros: erros };
}

// Chamada pelo trigger diário (ver criarTriggerGcap). Trigger não tem pra
// quem devolver resposta — só loga (Ver > Execuções, no editor).
function criarAtividadesGcapJob_() {
  var r = criarAtividadesGcap_();
  Logger.log("GCAP job: " + JSON.stringify(r));
}

/* Rode ESTA função manualmente UMA VEZ (menu Executar, com ela selecionada)
   pra agendar a checagem diária. Depois disso o job roda sozinho — não
   precisa rodar de novo, a não ser que apague o trigger. */
function criarTriggerGcap() {
  removerTriggerGcap(); // evita duplicar se rodar de novo por engano
  ScriptApp.newTrigger("criarAtividadesGcapJob_").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Trigger diário de GCAP criado — roda todo dia por volta das 6h (fuso do projeto).");
}
function removerTriggerGcap() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "criarAtividadesGcapJob_") ScriptApp.deleteTrigger(t);
  });
}

// Teste manual sem esperar o trigger: rode esta função no editor a qualquer
// momento pra forçar uma varredura agora e ver o resultado no Logger.
function testeGcapAgora() {
  Logger.log(JSON.stringify(criarAtividadesGcap_()));
}

/* ===================== PÓS OBRA: sincronização automática com VENDAS =====
 * Mantém uma linha em PÓS OBRA por obra, com CLIENTES, TELEFONE e DATA DE
 * ASSINATURA DO CONTRATO copiados de VENDAS (sentido único: VENDAS -> PÓS
 * OBRA).
 *
 * IMPORTANTE sobre o vínculo: a base PÓS OBRA guarda o ENDEREÇO puro na
 * coluna de título "Nome" (confirmado ao vivo — é o que o rollup "ENDEREÇO
 * BASE" da ATIVIDADES PÓS OBRA usa), SEM o sufixo " CS N". Por isso o
 * casamento aqui é por dois campos separados — ENDEREÇO (normalizado) + CASA
 * — e não por um título combinado tipo "ENDEREÇO CS 2" (esse formato
 * combinado só é usado no NOME da atividade de ATIVIDADES PÓS OBRA, não
 * aqui).
 *
 * Só GRAVA o que a venda já tiver preenchido — nunca apaga um campo do
 * PÓS OBRA porque a venda ainda está vazia ali (ex.: obra recém-criada só
 * tem ENDEREÇO; CLIENTES/DATA/TELEFONE completam sozinhos, com o tempo,
 * conforme forem preenchidos em VENDAS).
 *
 * POR QUE A PRIMEIRA VERSÃO TRAVOU (corrigido aqui, r10): ela regravava
 * TODAS as ~430 obras a cada varredura, mesmo as que já estavam idênticas,
 * e ainda relia a base PÓS OBRA inteira toda vez que criava uma linha. Isso
 * dá centenas de chamadas ao Notion em sequência e estoura o limite de 6
 * minutos do Apps Script — a execução ficava "rodando" até ser cortada.
 * Agora: o índice é lido UMA vez por varredura e mantido em memória, e a
 * gravação só acontece quando o valor realmente mudou. Além disso a
 * varredura tem orçamento de tempo e guarda onde parou, então rodar de novo
 * CONTINUA de onde estava em vez de recomeçar.
 * =================================================================== */

// Campos de VENDAS que, ao mudar via updateVenda_, disparam a sincronização
// (a criação da venda sempre sincroniza, independente desta lista).
var POS_OBRA_GATILHOS = ["ENDEREÇO", "CASA", "CLIENTES", "DATA DE ASSINATURA DO CONTRATO",
                         "Nº Whatsapp", "CIDADE", "SETOR", "ARMAZENOU CONTRATO COMPRA E VENDA?"];
function posObraEhGatilho_(prop) {
  var alvo = normDist_(prop);
  return POS_OBRA_GATILHOS.some(function (g) { return normDist_(g) === alvo; });
}

// Onde a varredura parou (índice na lista de vendas). Fica nas Propriedades
// do script, não no cache, porque precisa sobreviver entre execuções.
var POS_OBRA_PROGRESSO = "POS_OBRA_PROGRESSO";
// Quanto tempo a varredura pode trabalhar antes de guardar o lugar e sair.
// O limite duro do Apps Script é 6 min; 4 min deixa folga para terminar de
// gravar e salvar o progresso sem ser cortado no meio.
var POS_OBRA_BUDGET_MS = 4 * 60 * 1000;

// Chave de casamento: ENDEREÇO normalizado + "|" + CASA (número). Ex.:
// "ATALANTA QD 01 LT 21|2". CASA vazia vira "" (obra sem número de casa
// ainda casa com uma linha de PÓS OBRA também sem CASA preenchida).
function posObraChave_(endereco, casa) {
  var c = (casa === null || casa === undefined || casa === "") ? "" : String(casa);
  return normDist_(endereco) + "|" + c;
}

/* Índice chave -> { id, casa, clientes, data, telefone, cidade, setor, agio }
   da base PÓS OBRA. Guarda os VALORES ATUAIS junto, e não só o id: é isso
   que permite pular a gravação quando nada mudou — o que derrubou o tempo da
   varredura de centenas de escritas para quase zero, depois da primeira
   passada. */
function posObraIndiceCalc_() {
  var mapa = {};
  queryAll_(CONFIG.DB.POS_OBRA, {}).forEach(function (r) {
    var endereco = titulo_(r.properties["Nome"]);
    if (!endereco) return;
    var casa = numProp_(r.properties["CASA"]);
    var tel = getTol_(r.properties, "TELEFONE");
    mapa[posObraChave_(endereco, casa)] = {
      id: r.id,
      casa: casa,
      clientes: texto_(r.properties["CLIENTES"]),
      data: dt_(r.properties["DATA DE ASSINATURA DO CONTRATO"]),
      telefone: tel.phone_number || texto_(tel) || null,
      // MELHORIAS item 1: CIDADE e SETOR vêm de VENDAS igual aos demais
      cidade: posObraTextoLivre_(getTol_(r.properties, "CIDADE")),
      setor:  posObraTextoLivre_(getTol_(r.properties, "SETOR")),
      // MELHORIAS item 4/5 (ago/26): ÁGIO, espelhado de VENDAS (ver
      // posObraAgioAlvo_ / posObraAplicar_)
      agio:   sel_(getTol_(r.properties, "ÁGIO"))
    };
  });
  return mapa;
}
// Versão com cache curto — usada no caminho de UMA venda só (site). A
// varredura em lote NÃO usa esta: ela chama posObraIndiceCalc_ direto, uma
// vez, e mantém o resultado em memória durante todo o percurso.
function posObraIndice_() { return comCache_("pos_obra_indice", 300, posObraIndiceCalc_); }

/* CIDADE e SETOR são "Seleção" em VENDAS e podem ser texto no PÓS OBRA (ou o
   contrário). Esta função lê os dois casos, e a posObraValorPara_ grava no
   tipo certo de cada base — assim você pode mudar o tipo da coluna no Notion
   sem que a sincronia pare. */
function posObraTextoLivre_(pp) {
  if (!pp) return null;
  /* MELHORIAS item 1 — CIDADE em VENDAS é uma FÓRMULA (junta CIDADE V1 e
     CIDADE V2). sel_ lê select/status e texto_ lê rich_text; nenhum dos dois
     enxerga formula, então CIDADE voltava vazia enquanto SETOR (que é
     seleção) funcionava. Daí "trouxe o setor mas não a cidade".
     Agora lê também formula e rollup, sempre convertendo para texto. */
  var t = pp.type, v = pp[t];
  if (t === "formula" && v) {
    var fv = v[v.type];
    if (fv === null || fv === undefined) return null;
    if (v.type === "date") return fv.start || null;
    return String(fv).trim() || null;
  }
  if (t === "rollup" && v && v.type === "array") {
    var partes = (v.array || []).map(function (x) { return posObraTextoLivre_(x); })
                                .filter(function (x) { return !!x; });
    return partes.length ? partes.join(", ") : null;
  }
  if (t === "title") return titulo_(pp) || null;
  return sel_(pp) || texto_(pp) || (typeof v === "string" ? v : null) || null;
}
/* A fórmula do Notion pode devolver "⚠️ GOIÂNIA / SENADOR CANEDO" quando as
   duas cidades divergem. Isso é um AVISO para você conferir na venda, não um
   nome de cidade — gravar assim no PÓS OBRA espalharia o problema. Nestes
   casos a sincronia não grava nada e deixa a cidade vazia, que é o sinal
   correto de "resolva na venda primeiro". */
function posObraValorAmbiguo_(v) {
  if (!v) return false;
  return String(v).indexOf("⚠") >= 0 || String(v).indexOf(" / ") >= 0;
}
/* Monta o valor de gravação conforme o TIPO REAL da coluna de destino. */
function posObraValorPara_(dbId, coluna, valor) {
  var campo = posObraCampoDe_(dbId, coluna);
  if (!campo) return null;                       // coluna não existe: não grava
  if (!EDITAVEL_[campo.tipo] || campo.tipo === "title") return null;
  return buildValue_(campo.tipo, valor);
}
/* Schema enxuto (nome + tipo) de qualquer base, com cache de 30 min. */
function posObraSchemaDe_(dbId) {
  return comCache_("schema_tipos_" + dbId, 1800, function () {
    var db = notion_("GET", "/databases/" + dbId, null), props = db.properties || {}, out = [];
    for (var nome in props) out.push({ nome: nome, tipo: props[nome].type });
    return out;
  });
}
function posObraCampoDe_(dbId, coluna) {
  var lista = posObraSchemaDe_(dbId), alvo = normDist_(coluna);
  for (var i = 0; i < lista.length; i++) if (normDist_(lista[i].nome) === alvo) return lista[i];
  return null;
}

/* ÁGIO (MELHORIAS item 4/5, ago/26): lido de VENDAS."ARMAZENOU CONTRATO
   COMPRA E VENDA?" — SIM/ÁGIO/NÃO/vazio.
   Regra exata pedida:
     ARMAZENOU = "ÁGIO" -> ÁGIO do PÓS OBRA = "SIM"
     ARMAZENOU = "SIM"  -> ÁGIO do PÓS OBRA = "NÃO"
     ARMAZENOU = "NÃO" ou vazio -> não mexe (fica como já estava; pode até
       estar vazio pra sempre, é o esperado enquanto ninguém armazenou nada)
   Devolve null quando NÃO deve gravar nada (equivalente a "nada fazer" do
   pedido) — quem chama já sabe distinguir "sem alvo" de "alvo vazio". */
function posObraAgioAlvo_(armazenouContrato) {
  var v = normDist_(armazenouContrato || "");
  if (v === "AGIO") return "SIM";
  if (v === "SIM") return "NÃO";
  return null;   // NÃO ou vazio: nada a fazer
}

// O que a linha de PÓS OBRA DEVERIA ter, lido de uma página de VENDAS.
function posObraAlvo_(propsVenda) {
  var endereco = titulo_(getTol_(propsVenda, "ENDEREÇO"));
  if (!endereco) return null;
  var telProp = getTol_(propsVenda, "Nº Whatsapp");
  return {
    endereco: endereco,
    casa: numProp_(getTol_(propsVenda, "CASA")),
    clientes: texto_(getTol_(propsVenda, "CLIENTES")),
    data: dt_(getTol_(propsVenda, "DATA DE ASSINATURA DO CONTRATO")),
    telefone: telProp.phone_number || texto_(telProp) || null,
    cidade: posObraTextoLivre_(getTol_(propsVenda, "CIDADE")),
    setor:  posObraTextoLivre_(getTol_(propsVenda, "SETOR")),
    agio:   posObraAgioAlvo_(sel_(getTol_(propsVenda, "ARMAZENOU CONTRATO COMPRA E VENDA?")))
  };
}

/* Aplica UMA obra sobre o índice recebido (que é atualizado em memória).
   Devolve "criada", "atualizada" ou "sem_mudanca" — e "sem_mudanca" não
   gasta NENHUMA chamada ao Notion, que é o ponto todo da correção. */
function posObraAplicar_(alvo, indice) {
  var chave = posObraChave_(alvo.endereco, alvo.casa);
  var atual = indice[chave] || null;
  var chaveAtual = chave;

  /* Linha importada sem o número da casa: adota essa linha e preenche a CASA,
     em vez de criar uma segunda linha para a mesma obra. Se o mesmo endereço
     tiver duas casas, a primeira adota a linha existente e a segunda cria a
     dela — que é o comportamento certo. */
  if (!atual && alvo.casa !== null && alvo.casa !== undefined) {
    var chaveSemCasa = posObraChave_(alvo.endereco, "");
    if (indice[chaveSemCasa]) { atual = indice[chaveSemCasa]; chaveAtual = chaveSemCasa; }
  }

  var props = {};
  if (alvo.casa !== null && alvo.casa !== undefined && (!atual || atual.casa !== alvo.casa))
    props["CASA"] = buildValue_("number", alvo.casa);
  if (alvo.clientes && (!atual || atual.clientes !== alvo.clientes))
    props["CLIENTES"] = buildValue_("rich_text", alvo.clientes);
  if (alvo.data && (!atual || atual.data !== alvo.data))
    props["DATA DE ASSINATURA DO CONTRATO"] = buildValue_("date", alvo.data);
  if (alvo.telefone && (!atual || atual.telefone !== alvo.telefone))
    props["TELEFONE"] = buildValue_("phone_number", alvo.telefone);
  /* ÁGIO: só grava quando a regra pediu um valor (posObraAgioAlvo_ != null)
     e ele é diferente do que já está lá. "ARMAZENOU = NÃO" nunca chega aqui
     com alvo.agio preenchido, então nunca mexe no campo — exatamente o "nada
     fazer" pedido. Tipo tirado do schema ao vivo (posObraValorPara_), não
     fixado em "select" — mesma regra do resto do sistema, pra não corromper
     a coluna se um dia você mudar o tipo dela no Notion. */
  if (alvo.agio && (!atual || atual.agio !== alvo.agio)) {
    var vAgio = posObraValorPara_(CONFIG.DB.POS_OBRA, "ÁGIO", alvo.agio);
    if (vAgio) props["ÁGIO"] = vAgio;
  }

  /* MELHORIAS item 1 — CIDADE e SETOR.
     Regra escolhida: VENDAS manda. Como só grava quando o valor de lá é
     diferente do daqui, o efeito prático é que uma correção feita no PÓS OBRA
     volta atrás na próxima sincronia — de propósito. O caminho para corrigir
     no PÓS OBRA é o inverso (posObraUpdate_), que escreve em VENDAS. */
  ["cidade", "setor"].forEach(function (k) {
    var col = k.toUpperCase();
    if (!alvo[k] || posObraValorAmbiguo_(alvo[k])) return;   // fórmula em conflito: não propaga
    if (atual && normDist_(atual[k]) === normDist_(alvo[k])) return;
    var v = posObraValorPara_(CONFIG.DB.POS_OBRA, col, alvo[k]);
    if (v) props[col] = v;
  });

  if (atual) {
    if (!Object.keys(props).length) return "sem_mudanca";
    notion_("PATCH", "/pages/" + atual.id, { properties: props });
    // mantém o índice em memória em dia, pra próxima obra da mesma varredura
    // já enxergar o valor novo
    if (props["CASA"]) atual.casa = alvo.casa;
    if (props["CLIENTES"]) atual.clientes = alvo.clientes;
    if (props["DATA DE ASSINATURA DO CONTRATO"]) atual.data = alvo.data;
    if (props["TELEFONE"]) atual.telefone = alvo.telefone;
    if (props["CIDADE"]) atual.cidade = alvo.cidade;
    if (props["SETOR"])  atual.setor  = alvo.setor;
    if (props["ÁGIO"])   atual.agio   = alvo.agio;
    if (chaveAtual !== chave) { delete indice[chaveAtual]; indice[chave] = atual; }
    return "atualizada";
  }

  // Ainda não existe em PÓS OBRA: cria. "Nome" (título) leva o ENDEREÇO puro
  // — é o único campo sempre preenchido, mesmo que a venda ainda não tenha
  // mais nada.
  props["Nome"] = buildValue_("title", alvo.endereco);
  var nova = notion_("POST", "/pages", { parent: { database_id: CONFIG.DB.POS_OBRA }, properties: props });
  indice[chave] = {
    id: nova.id, casa: alvo.casa, clientes: alvo.clientes,
    data: alvo.data, telefone: alvo.telefone, cidade: alvo.cidade, setor: alvo.setor,
    agio: alvo.agio || null
  };
  return "criada";
}

/* Sincroniza UMA obra. É este que criarVenda_ e updateVenda_ chamam —
   caminho rápido, uma venda só, usando o índice em cache. */
function posObraSincronizar_(propsVenda) {
  var alvo = posObraAlvo_(propsVenda);
  if (!alvo) return null;
  var indice = posObraIndice_();
  var r = posObraAplicar_(alvo, indice);
  // criou linha nova: o índice em cache ficou desatualizado para as próximas
  // chamadas (o objeto acima é uma cópia, mexer nele não volta pro cache)
  if (r === "criada") { try { _cache_().remove("pos_obra_indice"); } catch (e) {} }
  return r;
}

/* Varre VENDAS inteira e sincroniza tudo — cobre edição feita direto no
   Notion, sem passar pelo site. Chamada pelo trigger diário.

   RESUMÍVEL: trabalha por até POS_OBRA_BUDGET_MS, guarda em que ponto parou
   e sai. Rodar de novo continua dali. Quando termina a lista inteira, o
   progresso é apagado e a próxima execução recomeça do zero (que aí é
   rápido: sem nada pra mudar, não faz escrita nenhuma). */
function posObraSincronizarTudo_(opcoes) {
  opcoes = opcoes || {};
  var t0 = Date.now();
  var budget = opcoes.budgetMs || POS_OBRA_BUDGET_MS;

  var vendas = queryAll_(CONFIG.DB.VENDAS, {});
  // ordem estável — sem isso "continuar de onde parou" não significa nada
  vendas.sort(function (a, b) {
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
  });

  var indice = posObraIndiceCalc_();   // UMA leitura da base PÓS OBRA, e só

  var comeco = 0;
  if (!opcoes.doZero) {
    var salvo = Number(PROPS_.getProperty(POS_OBRA_PROGRESSO) || 0);
    if (salvo > 0 && salvo < vendas.length) comeco = salvo;
  }

  var criadas = 0, atualizadas = 0, semMudanca = 0, semEndereco = 0, erros = [];
  var i = comeco;
  for (; i < vendas.length; i++) {
    if (Date.now() - t0 > budget) break;   // guarda o lugar e sai antes do corte
    try {
      var alvo = posObraAlvo_(vendas[i].properties);
      if (!alvo) { semEndereco++; continue; }
      var r = posObraAplicar_(alvo, indice);
      if (r === "criada") criadas++;
      else if (r === "atualizada") atualizadas++;
      else semMudanca++;
    } catch (e) {
      erros.push((titulo_(getTol_(vendas[i].properties, "ENDEREÇO")) || vendas[i].id) + ": " + e);
      // erro em série é problema sistêmico (token, permissão, coluna
      // renomeada) — para e mostra, em vez de insistir 400 vezes
      if (erros.length >= 25) { i++; break; }
    }
  }

  var terminou = i >= vendas.length;
  if (terminou) { try { PROPS_.deleteProperty(POS_OBRA_PROGRESSO); } catch (e) {} }
  else { PROPS_.setProperty(POS_OBRA_PROGRESSO, String(i)); }
  try { _cache_().remove("pos_obra_indice"); } catch (e) {}

  return {
    ok: true, terminou: terminou,
    total: vendas.length, processadas: i, faltam: Math.max(0, vendas.length - i),
    criadas: criadas, atualizadas: atualizadas, semMudanca: semMudanca,
    semEndereco: semEndereco, segundos: Math.round((Date.now() - t0) / 1000),
    erros: erros
  };
}

/* ===== ACIONADOR DIÁRIO =====
 * ATENÇÃO ao nome desta função: ela NÃO termina com "_" de propósito. No
 * Apps Script, função terminada em "_" é privada — não aparece na lista de
 * funções da tela de Acionadores (o ícone do relógio). Por isso a versão
 * anterior (posObraSincronizarTudoJob_) simplesmente não estava lá pra ser
 * escolhida. É ESTA aqui que você seleciona no painel. */
function posObraSyncDiario() {
  var r = posObraSincronizarTudo_();
  Logger.log("PÓS OBRA sync diário: " + JSON.stringify(r));
  // se não terminar hoje, o progresso fica salvo e a execução de amanhã
  // continua exatamente daí, sem repetir o que já foi feito
}

/* COMO AGENDAR (recomendado — pelo painel, não pede permissão nenhuma):
 *   ícone do relógio (Acionadores) na barra da esquerda >
 *   "+ Adicionar acionador" > função "posObraSyncDiario" >
 *   origem "Baseado no tempo" > "Contador de dias" > entre 6h e 7h > Salvar.
 *
 * As duas funções abaixo fazem o mesmo por código, mas exigem uma autorização
 * extra do Apps Script que, em navegador logado em várias contas do Google,
 * costuma abrir na conta errada e falhar ("You do not have permission to call
 * ScriptApp..."). Se isso acontecer, use o painel acima e ignore estas. */
function criarTriggerPosObra() {
  removerTriggerPosObra();
  ScriptApp.newTrigger("posObraSyncDiario").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Trigger diário de sincronização PÓS OBRA criado.");
}
function removerTriggerPosObra() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    // o nome antigo entra na limpeza também, pra não sobrar acionador órfão
    // de quem já tinha criado antes desta correção
    if (f === "posObraSyncDiario" || f === "posObraSincronizarTudoJob_") ScriptApp.deleteTrigger(t);
  });
}

/* ===== CONFERÊNCIA (só lê, não grava nada) =====
 * Roda esta função pelo menu Executar quando quiser ter certeza de que o
 * TELEFONE está mesmo chegando no PÓS OBRA. Ela responde três perguntas:
 *   1) com que nome a coluna do WhatsApp existe de verdade em VENDAS;
 *   2) em quantas vendas o código consegue LER um telefone;
 *   3) em quantas linhas do PÓS OBRA o TELEFONE está preenchido.
 * Se (2) for alto e (3) for zero, o nome da coluna em VENDAS é diferente do
 * que o código procura ("Nº Whatsapp") — é só me mandar esta saída. */
function conferirPosObra() {
  var dbV = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null);
  var props = dbV.properties || {};
  var candidatos = [];
  for (var nome in props) {
    var n = normDist_(nome);
    if (n.indexOf("WHATS") >= 0 || n.indexOf("TELEFONE") >= 0 ||
        n.indexOf("CELULAR") >= 0 || n.indexOf("CONTATO") >= 0) {
      candidatos.push('"' + nome + '" (' + props[nome].type + ')');
    }
  }
  Logger.log("1) Colunas de contato que existem em VENDAS: " +
             (candidatos.length ? candidatos.join("  |  ") : "NENHUMA ENCONTRADA"));
  Logger.log("   O código procura exatamente por \"Nº Whatsapp\": " +
             (props["Nº Whatsapp"] ? "ENCONTRADA (tipo " + props["Nº Whatsapp"].type + ")" : "*** NÃO ENCONTRADA ***"));

  var vendas = queryAll_(CONFIG.DB.VENDAS, {});
  var comTel = 0, comCliente = 0, comData = 0;
  vendas.forEach(function (v) {
    var a = posObraAlvo_(v.properties);
    if (!a) return;
    if (a.telefone) comTel++;
    if (a.clientes) comCliente++;
    if (a.data) comData++;
  });
  Logger.log("2) Do que o código consegue LER nas " + vendas.length + " vendas: " +
             "telefone em " + comTel + ", clientes em " + comCliente + ", data de assinatura em " + comData + ".");

  var linhas = queryAll_(CONFIG.DB.POS_OBRA, {});
  var comTelPO = 0, comCliPO = 0, comDataPO = 0, exemplos = [];
  linhas.forEach(function (r) {
    var tel = r.properties["TELEFONE"];
    var v = tel && tel.phone_number;
    if (v) {
      comTelPO++;
      if (exemplos.length < 3) exemplos.push(titulo_(r.properties["Nome"]) + " -> " + v);
    }
    if (texto_(r.properties["CLIENTES"])) comCliPO++;
    if (dt_(r.properties["DATA DE ASSINATURA DO CONTRATO"])) comDataPO++;
  });
  Logger.log("3) Das " + linhas.length + " linhas do PÓS OBRA: " +
             "TELEFONE preenchido em " + comTelPO + ", CLIENTES em " + comCliPO + ", DATA em " + comDataPO + ".");
  if (exemplos.length) Logger.log("   Exemplos de telefone já gravado: " + exemplos.join("  |  "));
  if (comTel > 0 && comTelPO === 0) {
    Logger.log("*** ATENÇÃO: o código lê telefone nas vendas mas nada chegou no PÓS OBRA. Me manda esta saída. ***");
  }
}

/* Rode ESTA pelo menu Executar. Se ela avisar que faltou obra, é só rodar de
   novo — continua de onde parou, não recomeça. */
function testePosObraAgora() {
  var r = posObraSincronizarTudo_();
  Logger.log(JSON.stringify(r));
  Logger.log("---");
  Logger.log("Obras em VENDAS: " + r.total + " | já processadas: " + r.processadas +
             " | criadas agora: " + r.criadas + " | atualizadas: " + r.atualizadas +
             " | já estavam certas: " + r.semMudanca + " | sem endereço (ignoradas): " + r.semEndereco);
  if (r.erros.length) Logger.log("ERROS (" + r.erros.length + "): " + r.erros.join(" || "));
  if (r.terminou) {
    Logger.log("TERMINOU TUDO em " + r.segundos + "s. Não precisa rodar de novo.");
  } else {
    Logger.log("PAROU DE PROPÓSITO no limite de tempo (" + r.segundos + "s), faltam " +
               r.faltam + " obras. RODE ESTA MESMA FUNÇÃO DE NOVO — ela continua de onde parou.");
  }
}

/* Só se quiser forçar uma varredura completa do início, ignorando o
   progresso salvo (normalmente não é preciso). */
function posObraRecomecarDoZero() {
  try { PROPS_.deleteProperty(POS_OBRA_PROGRESSO); } catch (e) {}
  Logger.log("Progresso apagado. A próxima execução de testePosObraAgora() começa do início.");
}

/* ===================== BACKFILL DE ÁGIO (MELHORIAS item 4/5, ago/26) ======
 * Preenche ÁGIO no PÓS OBRA pras obras que já existiam antes desse campo
 * entrar na sincronia — rodar UMA vez, pelo menu Executar.
 * Só grava quando a regra manda gravar (posObraAgioAlvo_ != null) E o valor
 * já lá é diferente — nunca sobrescreve à toa, e "ARMAZENOU = NÃO" nunca
 * mexe em nada (comportamento igual ao da sincronia contínua).
 * Resumível, mesma trava de tempo (POS_OBRA_BUDGET_MS) das outras varreduras
 * grandes: corta em 6 min, roda de novo e continua de onde parou. */
var BACKFILL_AGIO_PROGRESSO = "BACKFILL_AGIO";
function preencherAgioAntigas() {
  var t0 = new Date().getTime();
  var de = Number(PROPS_.getProperty(BACKFILL_AGIO_PROGRESSO) || 0);

  var vendas = queryAll_(CONFIG.DB.VENDAS, {});
  var indice = posObraIndiceCalc_();
  var gravadas = 0, puladas = 0, semVenda = 0, i;

  for (i = de; i < vendas.length; i++) {
    if (new Date().getTime() - t0 > POS_OBRA_BUDGET_MS) {
      PROPS_.setProperty(BACKFILL_AGIO_PROGRESSO, String(i));
      Logger.log("PAUSADO em " + i + " de " + vendas.length +
                 ". Gravadas: " + gravadas + ", já preenchidas/puladas: " + puladas +
                 ".\n\nRode a função DE NOVO para continuar de onde parou.");
      return;
    }
    var pv = vendas[i].properties;
    var endereco = titulo_(getTol_(pv, "ENDEREÇO"));
    if (!endereco) continue;

    var atual = indice[posObraChave_(endereco, numProp_(getTol_(pv, "CASA")))];
    if (!atual) { semVenda++; continue; }

    var alvo = posObraAgioAlvo_(sel_(getTol_(pv, "ARMAZENOU CONTRATO COMPRA E VENDA?")));
    if (!alvo || atual.agio === alvo) { puladas++; continue; }

    var vAgio = posObraValorPara_(CONFIG.DB.POS_OBRA, "ÁGIO", alvo);
    if (!vAgio) { puladas++; continue; }
    notion_("PATCH", "/pages/" + atual.id, { properties: { "ÁGIO": vAgio } });
    atual.agio = alvo;
    gravadas++;
  }

  PROPS_.deleteProperty(BACKFILL_AGIO_PROGRESSO);
  posObraLimparCaches_();
  try { _cache_().remove("pos_obra_indice"); } catch (e) {}
  Logger.log("CONCLUÍDO.\nVendas percorridas: " + vendas.length +
             "\nLinhas do PÓS OBRA preenchidas com ÁGIO: " + gravadas +
             "\nJá estavam certas ou sem nada a fazer: " + puladas +
             "\nSem linha correspondente no PÓS OBRA: " + semVenda);
}
function reiniciarBackfillAgio() {
  PROPS_.deleteProperty(BACKFILL_AGIO_PROGRESSO);
  Logger.log("Progresso zerado. A próxima execução de preencherAgioAntigas() começa do início.");
}

/* ===================== PÓS OBRA: TELA DO SITE E CHAMADOS =====================
 * Tudo o que a futura pos-obra.html consome. Duas bases envolvidas:
 *   PÓS OBRA             -> uma linha por obra/casa (vem de VENDAS, ver bloco
 *                           de sincronização acima)
 *   ATIVIDADES PÓS OBRA  -> um chamado de assistência técnica por linha,
 *                           ligado à obra pela relation "PÓS OBRA"
 *
 * ACESSO: tudo aqui exige a marcação "PÓS OBRA" na coluna ACESSOS do banco
 * LOGINS (ADM, MASTER e TESTES passam sempre, como no resto do sistema). Você
 * precisa criar essa opção na coluna ACESSOS e marcar quem é da equipe de pós
 * obra — sem isso, nem você mesmo entra, a não ser sendo ADM/MASTER.
 *
 * DECISÃO DE PROJETO — por que os campos NÃO estão numa lista fixa aqui:
 * a base ATIVIDADES PÓS OBRA tem muita coluna repetida por nível de
 * remarcação (DATA REMARCAÇÃO 1..5, INFORMAÇÕES REMARCAÇÃO 1..5, FOTOS PÓS
 * REPAROS RM 1..5). Se eu fixasse os nomes no código, criar um nível novo ou
 * corrigir a grafia de uma coluna no Notion quebraria a tela calada. Então o
 * que vale é o SCHEMA AO VIVO: o site pergunta quais colunas existem
 * (posObraSchema) e o backend só aceita gravar em coluna que existe de
 * verdade e cujo tipo é gravável. Fórmula, rollup e a relation "PÓS OBRA"
 * ficam de fora automaticamente (EDITAVEL_ marca esses tipos como false), ou
 * seja, ninguém consegue religar um chamado noutra obra pela tela.
 * =================================================================== */

function semHifen_(id) { return String(id || "").replace(/-/g, ""); }

/* Schema ao vivo de ATIVIDADES PÓS OBRA. É daqui que o site monta os campos
   e é daqui que a validação de escrita tira o tipo real — nunca do que o
   navegador mandou. Cache de 30 min, igual ao vendasSchema_. */
function posObraSchema_() {
  return comCache_("pos_obra_atv_schema", 1800, function () {
    var db = notion_("GET", "/databases/" + CONFIG.DB.ATIVIDADES_POS_OBRA, null);
    var props = db.properties || {};
    var campos = [], tituloProp = "Nome";
    for (var nome in props) {
      var t = props[nome].type;
      if (t === "title") tituloProp = nome;
      var c = {
        nome: nome, tipo: t,
        // title fica de fora: o nome do chamado é "ENDEREÇO CS CASA", montado
        // na criação a partir da obra — não é pra ser digitado à mão
        editavel: (EDITAVEL_[t] === true && t !== "title")
      };
      if (t === "select" || t === "status" || t === "multi_select")
        c.opcoes = (props[nome][t].options || []).map(function (o) { return o.name; });
      campos.push(c);
    }
    // idem VENDAS: SERVIÇO/RESPONSÁVEL criados pelo site entram aqui mesmo
    // antes de existirem no schema do Notion (ver novaOpcao_)
    return { ok: true, tituloProp: tituloProp, campos: opcPendMesclar_("POS_OBRA", campos) };
  });
}
function posObraSchemaAcao_(sess) { return posObraSchema_(); }

// Acha a definição de uma coluna tolerando acento/caixa/espaço sobrando.
function posObraAtvCampo_(nome) {
  var s = posObraSchema_(), alvo = normDist_(nome);
  for (var i = 0; i < s.campos.length; i++) {
    if (normDist_(s.campos[i].nome) === alvo) return s.campos[i];
  }
  return null;
}
/* Devolve o nome EXATO da opção como está no Notion (ou null se não existe).
   Serve pra duas coisas: barrar valor inventado antes de tomar 400 da API, e
   gravar com a grafia certa mesmo que a tela mande em caixa diferente. */
function posObraOpcaoReal_(campo, valor) {
  var ops = campo.opcoes || [], alvo = normDist_(valor);
  for (var i = 0; i < ops.length; i++) if (normDist_(ops[i]) === alvo) return ops[i];
  return null;
}

function posObraLimparCaches_() {
  try {
    var c = _cache_();
    c.remove("pos_obra_lista_v3"); c.remove("pos_obra_lista_v2");
    c.remove("pos_obra_atv_por_obra_v3");
    c.remove("pos_obra_atv_por_obra");   // chave antiga
    c.remove("pos_obra_agenda_v3"); c.remove("pos_obra_agenda_v2");
    c.remove("pos_obra_lista"); c.remove("pos_obra_agenda");   // chaves antigas
  } catch (e) {}
}

/* Quantos chamados cada obra tem, e quantos ainda estão abertos. Uma consulta
   só na base de atividades, em vez de uma por obra (mesmo raciocínio do
   obrasComAtividadeGcap_).
   "Aberto" = ANDAMENTO DA SOLICITAÇÃO diferente de "SERVIÇO FINALIZADO",
   INCLUSIVE vazio: chamado recém-criado pelo botão nasce sem andamento e já
   deve contar como pós obra em andamento. */
/* ===== CAMPOS OBRIGATÓRIOS DO CHAMADO (MELHORIAS item 3, set/26) =====
 * Quais campos um chamado precisa ter preenchido para ser considerado
 * completo. Anexos ficam de fora, como você pediu.
 *
 * A comparação é por PEDAÇO do nome (normalizado), e não por nome exato, pelo
 * mesmo motivo do resto do arquivo: renomear a coluna no Notion (como já
 * aconteceu com "DATA DO SERVIÇO" -> "DATA AGENDAMENTO SERVIÇO") não pode
 * quebrar a checagem em silêncio.
 *
 * DATA DO CHAMADO fica de fora de propósito: ela é registro de abertura e o
 * chamado criado pelo botão nasce sem ela — cobrar isso acusaria todo chamado
 * novo no segundo seguinte à criação. */
var POS_OBRA_OBRIGATORIOS = [
  { chave: "SERVICO",          rotulo: "Serviço",              tipo: "multi" },
  { chave: "RESPONSAVEL",      rotulo: "Responsável",          tipo: "sel"   },
  { chave: "DATA AGENDAMENTO", rotulo: "Data de agendamento",  tipo: "data"  },
  { chave: "INFORMACOES SERVICO", rotulo: "Informações serviço", tipo: "texto" },
  { chave: "ANDAMENTO DA SOLICITACAO", rotulo: "Andamento da solicitação", tipo: "sel" },
  { chave: "STATUS MATERIAL",  rotulo: "Status material",      tipo: "sel"   }
];
/* Devolve a lista de RÓTULOS que faltam num chamado. Lista vazia = completo.
   Procura a coluna pelo pedaço do nome; se a coluna não existir na base, o
   campo é simplesmente ignorado (não vira "faltando" fantasma). */
function posObraFaltando_(props) {
  var faltas = [];
  POS_OBRA_OBRIGATORIOS.forEach(function (req) {
    var achou = false, preenchido = false;
    for (var nome in props) {
      var n = normDist_(nome);
      if (n.indexOf(req.chave) < 0) continue;
      /* "DATA AGENDAMENTO" casaria também com uma eventual coluna de
         remarcação; as de retorno têm número no fim e são opcionais. */
      if (req.chave === "DATA AGENDAMENTO" && /\d\s*$/.test(n)) continue;
      achou = true;
      var pp = props[nome];
      if (req.tipo === "multi") preenchido = ((pp.multi_select || []).length > 0);
      else if (req.tipo === "data") preenchido = !!dt_(pp);
      else if (req.tipo === "texto") preenchido = !!texto_(pp);
      else preenchido = !!sel_(pp);
      if (preenchido) break;   // achou preenchido: para de procurar variantes
    }
    if (achou && !preenchido) faltas.push(req.rotulo);
  });
  return faltas;
}

function posObraAtvPorObra_() {
  /* chave "_v3": passou a devolver "incompletos" — o cache antigo não tem
     esse campo e deixaria a tela sem os avisos até expirar sozinho. */
  return comCache_("pos_obra_atv_por_obra_v3", 120, function () {
    var mapa = {}, finalizado = normDist_("SERVIÇO FINALIZADO");
    queryAll_(CONFIG.DB.ATIVIDADES_POS_OBRA, {}).forEach(function (a) {
      var rel = (a.properties["PÓS OBRA"] && a.properties["PÓS OBRA"].relation) || [];
      var aberta = normDist_(sel_(getTol_(a.properties, "ANDAMENTO DA SOLICITAÇÃO"))) !== finalizado;
      /* Só chamado ABERTO entra na conta de incompleto. Chamado finalizado
         com campo em branco é histórico — cobrar agora não muda nada e
         encheria a tela de aviso que ninguém pode resolver. */
      var faltas = aberta ? posObraFaltando_(a.properties) : [];
      rel.forEach(function (o) {
        var k = semHifen_(o.id);
        var m = mapa[k] || (mapa[k] = { total: 0, abertas: 0, incompletos: 0 });
        m.total++;
        if (aberta) m.abertas++;
        if (faltas.length) m.incompletos++;
      });
    });
    return mapa;
  });
}

/* Schema ao vivo da base PÓS OBRA (a base da OBRA, não a dos chamados).
   Nasceu com o HORÁRIO FLEXÍVEL: a tela precisa saber se a coluna é checkbox
   ou select (e, sendo select, quais opções) para desenhar o controle certo, e
   o posObraUpdate_ precisa do TIPO REAL para gravar sem corromper a coluna. */
function posObraObraSchema_() {
  return comCache_("pos_obra_obra_schema", 1800, function () {
    var db = notion_("GET", "/databases/" + CONFIG.DB.POS_OBRA, null);
    var props = db.properties || {}, campos = [];
    for (var nome in props) {
      var t = props[nome].type;
      var c = { nome: nome, tipo: t, editavel: (EDITAVEL_[t] === true && t !== "title") };
      if (t === "select" || t === "status" || t === "multi_select")
        c.opcoes = (props[nome][t].options || []).map(function (o) { return o.name; });
      campos.push(c);
    }
    return { ok: true, campos: campos };
  });
}
function posObraObraCampo_(nome) {
  var sc = posObraObraSchema_(), alvo = normDist_(nome);
  for (var i = 0; i < sc.campos.length; i++)
    if (normDist_(sc.campos[i].nome) === alvo) return sc.campos[i];
  return null;
}

/* HORÁRIO FLEXÍVEL — pedido 3 do CORREÇÕES (ago/26).
   Coluna da base PÓS OBRA (uma por obra/cliente, não por chamado). Lê seja
   qual for o tipo que você criar no Notion: checkbox, select ou texto. Se a
   coluna ainda não existir, devolve null e a tela simplesmente não mostra
   nada — nenhuma tela quebra por causa disso. */
var POS_OBRA_FLEX_COL = "HORÁRIO FLEXÍVEL";
function posObraFlex_(pr) {
  var pp = getTol_(pr, POS_OBRA_FLEX_COL);
  if (!pp) return null;
  if (pp.type === "checkbox") return pp.checkbox ? "SIM" : null;
  return sel_(pp) || texto_(pp) || null;
}

/* ÁGIO no cabeçalho da obra (item 5, ao lado do horário flexível). Mesmo
   princípio do posObraFlex_: lê o que existir, devolve null se a coluna
   ainda não tem valor — a tela só mostra o selo quando tiver algo. */
var POS_OBRA_AGIO_COL = "ÁGIO";
function posObraAgio_(pr) {
  var pp = getTol_(pr, POS_OBRA_AGIO_COL);
  if (!pp) return null;
  return sel_(pp) || null;
}

/* Aba "Obras": a lista inteira, com o STATUS calculado aqui (não existe essa
   coluna no Notion). A tela filtra e pesquisa em cima disto. */
function posObras_(sess, p) {
  return comCache_("pos_obra_lista_v3", 120, function () {
    var atv = posObraAtvPorObra_();
    /* Só entram obras COM cliente preenchido. Obra sem cliente ainda não foi
       vendida/entregue, então não existe pós obra pra ela — e são ~165 linhas
       a menos trafegando em cada carga da tela. */
    var lista = queryAll_(CONFIG.DB.POS_OBRA, {}).filter(function (r) {
      return !!texto_(r.properties["CLIENTES"]);
    }).map(function (r) {
      var pr = r.properties;
      var endereco = titulo_(pr["Nome"]);
      var casa = numProp_(pr["CASA"]);
      var c = atv[semHifen_(r.id)] || { total: 0, abertas: 0 };
      return {
        id: r.id,
        endereco: endereco,
        casa: casa,
        titulo: endereco + (casa === null || casa === undefined ? "" : " CS " + casa),
        clientes: texto_(pr["CLIENTES"]),
        telefone: (pr["TELEFONE"] && pr["TELEFONE"].phone_number) || null,
        // a tela usa esta data pra calcular NA GARANTIA / FORA DA GARANTIA
        dataAssinatura: dt_(pr["DATA DE ASSINATURA DO CONTRATO"]),
        observacoes: texto_(pr["OBSERVAÇÕES"]),
        // pedido 3: vai no card do cliente e vira filtro na lista "Em aberto"
        horarioFlexivel: posObraFlex_(pr),
        // item 5: selo de ÁGIO no cabeçalho, ao lado do horário flexível
        agio: posObraAgio_(pr),
        // MELHORIAS item 1/2: sincronizados de VENDAS e usados para compor o
        // endereço do texto do WhatsApp (ENDEREÇO + CASA + SETOR + CIDADE)
        cidade: posObraTextoLivre_(getTol_(pr, "CIDADE")),
        setor:  posObraTextoLivre_(getTol_(pr, "SETOR")),
        servicos: c.total,
        servicosAbertos: c.abertas,
        /* item 3: quantos chamados ABERTOS desta obra estão com campo
           obrigatório em branco. A tela usa isto pro selo na lista e pro
           card de aviso do painel inicial. */
        servicosIncompletos: c.incompletos || 0,
        status: c.abertas > 0 ? "PÓS OBRA EM ANDAMENTO" : "SEM PÓS OBRA"
      };
    });
    lista.sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), "pt-BR"); });
    /* flexCampo: como desenhar o controle de HORÁRIO FLEXÍVEL na tela. Vem
       junto da lista para não custar uma segunda chamada. null = a coluna
       ainda não foi criada no Notion; a tela esconde o controle. */
    var fc = posObraObraCampo_(POS_OBRA_FLEX_COL);
    return {
      ok: true, total: lista.length, lidoEm: new Date().toISOString(), obras: lista,
      flexCampo: fc ? { nome: fc.nome, tipo: fc.tipo, opcoes: fc.opcoes || null } : null
    };
  });
}

/* Página de UMA obra: os dados dela + todos os chamados, já resolvidos.
   É com isto que a tela monta o histórico e o kanban — sem cache, porque é
   pouca coisa e precisa refletir o Notion na hora. */
function posObra_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  var pr = pg.properties || {};
  var endereco = titulo_(pr["Nome"]);
  var casa = numProp_(pr["CASA"]);

  var atividades = queryAll_(CONFIG.DB.ATIVIDADES_POS_OBRA, {
    filter: { property: "PÓS OBRA", relation: { contains: p.pageId } }
  }).map(function (a) {
    var andAtv = sel_(getTol_(a.properties, "ANDAMENTO DA SOLICITAÇÃO"));
    var fin = normDist_(andAtv) === normDist_("SERVIÇO FINALIZADO");
    return {
      id: a.id,
      nome: tituloDe_(a.properties),
      andamento: andAtv,
      /* item 3: o que falta preencher NESTE chamado. Chamado finalizado não
         é cobrado (ver posObraAtvPorObra_ pelo mesmo motivo). */
      faltando: fin ? [] : posObraFaltando_(a.properties),
      valores: resolver_(a.properties)
    };
  });

  return {
    ok: true,
    id: pg.id,
    endereco: endereco,
    casa: casa,
    titulo: endereco + (casa === null || casa === undefined ? "" : " CS " + casa),
    valores: resolver_(pr),
    horarioFlexivel: posObraFlex_(pr),
    agio: posObraAgio_(pr),
    cidade: posObraTextoLivre_(getTol_(pr, "CIDADE")),
    setor:  posObraTextoLivre_(getTol_(pr, "SETOR")),
    atividades: atividades
  };
}

/* Texto que acompanha uma coluna de data. Numa coluna de remarcação é a
   INFORMAÇÕES daquele nível; em qualquer outra é a INFORMAÇÕES SERVIÇO.
   Procura pelo PEDAÇO do nome em vez de exigir a grafia exata — os nomes das
   colunas de remarcação variam de base pra base. */
function posObraInfoDaColuna_(pr, col) {
  var n = normDist_(col);
  var nivel = (String(col).match(/(\d+)\s*$/) || [])[1];
  if (n.indexOf("REMARCA") >= 0 && nivel) {
    for (var k in pr) {
      var kn = normDist_(k);
      if (kn.indexOf("INFORMAC") >= 0 && kn.indexOf("REMARCA") >= 0 && kn.indexOf(nivel) >= 0) {
        return texto_(pr[k]);
      }
    }
  }
  return texto_(getTol_(pr, "INFORMAÇÕES SERVIÇO"));
}

/* Calendário da página principal e base dos indicadores: uma marcação por
   DATA preenchida em qualquer chamado. Varre as colunas de data pelo TIPO, e
   não por uma lista de nomes — assim, se você criar DATA REMARCAÇÃO 6 no
   Notion, ela já entra no calendário sem mexer aqui.

   Vai com serviço, responsável, status do material e o texto da própria
   coluna porque o card do calendário mostra tudo isso e precisa poder ser
   copiado pro WhatsApp sem uma segunda consulta por card. */
function posObraAgenda_(sess, p) {
  // chave "_v2": a regra do DATA DO CHAMADO mudou, o cache antigo tem de morrer
  return comCache_("pos_obra_agenda_v3", 120, function () {
    var marcacoes = [];
    queryAll_(CONFIG.DB.ATIVIDADES_POS_OBRA, {}).forEach(function (a) {
      var pr = a.properties;
      var rel = (pr["PÓS OBRA"] && pr["PÓS OBRA"].relation) || [];
      var msProp = getTol_(pr, "SERVIÇO");
      var base = {
        atividadeId: a.id,
        obraId: rel[0] ? rel[0].id : null,
        nome: tituloDe_(pr),
        andamento: sel_(getTol_(pr, "ANDAMENTO DA SOLICITAÇÃO")),
        responsavel: sel_(getTol_(pr, "RESPONSÁVEL")),
        servico: (msProp.multi_select || []).map(function (o) { return o.name; }),
        statusMaterial: sel_(getTol_(pr, "STATUS MATERIAL")),
        /* item 3: o card do calendário mostra o aviso de campo faltando sem
           precisar abrir o chamado */
        faltando: normDist_(sel_(getTol_(pr, "ANDAMENTO DA SOLICITAÇÃO"))) === normDist_("SERVIÇO FINALIZADO")
                  ? [] : posObraFaltando_(pr)
      };
      for (var col in pr) {
        if (pr[col].type !== "date") continue;
        /* Pedido 2 (CORREÇÕES, ago/26): DATA DO CHAMADO é registro de ABERTURA
           do chamado, não um compromisso. Ela enchia o calendário de cards que
           ninguém precisava ver e duplicava o dia do serviço. O histórico já
           ignorava essa coluna; a agenda passa a ignorar também.
           Fica de fora da AGENDA inteira (mês, semana e "em aberto") — o valor
           continua visível e editável no painel do chamado, como sempre. */
        if (normDist_(col).indexOf("CHAMADO") >= 0) continue;
        var d = dt_(pr[col]);
        if (!d) continue;
        marcacoes.push({
          atividadeId: base.atividadeId, obraId: base.obraId, nome: base.nome,
          andamento: base.andamento, responsavel: base.responsavel,
          servico: base.servico, statusMaterial: base.statusMaterial,
          faltando: base.faltando,
          coluna: col, data: d, info: posObraInfoDaColuna_(pr, col)
        });
      }
    });
    marcacoes.sort(function (x, y) { return x.data < y.data ? -1 : (x.data > y.data ? 1 : 0); });
    return { ok: true, total: marcacoes.length, marcacoes: marcacoes };
  });
}

/* Botão "SERVIÇO DE PÓS OBRA": cria o chamado vinculado à obra.
   Conforme combinado, nasce só com o vínculo e o nome ("ENDEREÇO CS CASA") —
   o resto (data do chamado, serviço, responsável, andamento) a pessoa
   preenche na tela. */
function posObraServicoNovo_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  var pr = pg.properties || {};
  var endereco = titulo_(pr["Nome"]);
  if (!endereco) return { ok: false, erro: "OBRA_SEM_ENDERECO" };
  var casa = numProp_(pr["CASA"]);
  var nome = endereco + (casa === null || casa === undefined ? "" : " CS " + casa);

  var props = {};
  props[posObraSchema_().tituloProp] = buildValue_("title", nome);
  props["PÓS OBRA"] = { relation: [{ id: p.pageId }] };

  var nova = notion_("POST", "/pages", {
    parent: { database_id: CONFIG.DB.ATIVIDADES_POS_OBRA }, properties: props
  });
  posObraLimparCaches_();
  console.log("PÓS OBRA: " + sess.u + " criou serviço para " + nome);
  return { ok: true, id: nova.id, nome: nome };
}

/* ===================== AGENDAMENTO: sábado/feriado (pós obra) =============
 * MELHORIAS item 2 (ago/26): datas de AGENDAMENTO (data do serviço e as
 * datas de retorno/remarcação) não podem cair:
 *   - num DOMINGO — nunca, nem ADM;
 *   - num FERIADO DE GOIÂNIA — nunca, nem ADM (lista abaixo: fixos +
 *     móveis calculados a partir da Páscoa: Carnaval, Sexta-Feira Santa e
 *     Corpus Christi);
 *   - num SÁBADO — só com login+senha de um ADM informados JUNTO da
 *     gravação (validarSenhaAdm_, sem criar sessão pra esse ADM).
 * A trava fica AQUI, no servidor — burlar a tela com F12 não adianta.
 * Só entra nessa regra o que É agendamento de visita: DATA AGENDAMENTO
 * SERVIÇO / DATA DO SERVIÇO e DATA RETORNO N / DATA REMARCAÇÃO N. DATA DO
 * CHAMADO (abertura) e qualquer outra data do sistema ficam de fora — não
 * são escolha de agenda.
 * =================================================================== */
var FERIADOS_GOIANIA_FIXOS = [
  "01-01",   // Confraternização Universal
  "04-21",   // Tiradentes
  "05-01",   // Dia do Trabalho
  "05-24",   // Nossa Senhora Auxiliadora (padroeira de Goiânia)
  "09-07",   // Independência
  "10-12",   // Nossa Senhora Aparecida
  "10-24",   // Aniversário de Goiânia
  "11-02",   // Finados
  "11-15",   // Proclamação da República
  "11-20",   // Consciência Negra
  "12-25"    // Natal
];
/* Páscoa (algoritmo de Meeus/Jones/Butcher) — base pra Carnaval, Sexta-Feira
   Santa e Corpus Christi, que mudam de data todo ano. */
function pascoa_(ano) {
  var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100,
      d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31),
      dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}
function feriadosMoveisGoiania_(ano) {
  var pas = pascoa_(ano);
  function soma(dias) { var x = new Date(pas.getTime()); x.setDate(x.getDate() + dias); return x; }
  // Carnaval (segunda e terça), Sexta-Feira Santa, Corpus Christi
  return [soma(-48), soma(-47), soma(-2), soma(60)].map(function (d) {
    return d.getFullYear() + "-" + pad2_(d.getMonth() + 1) + "-" + pad2_(d.getDate());
  });
}
function ehFeriadoGoiania_(dataStr) {
  var d = String(dataStr).slice(0, 10);
  if (FERIADOS_GOIANIA_FIXOS.indexOf(d.slice(5, 10)) >= 0) return true;
  return feriadosMoveisGoiania_(Number(d.slice(0, 4))).indexOf(d) >= 0;
}
/* 0=domingo ... 6=sábado. Por número, não por string — mesmo cuidado do
   primeiroDiaUtilMesSeguinte_ contra o bug de fuso UTC-3. */
function diaDaSemana_(dataStr) {
  var p = String(dataStr).slice(0, 10).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
}
/* Só datas de AGENDAMENTO entram nessa trava. "CHAMADO" fica de fora de
   propósito (é abertura, não visita marcada) — mesma exclusão que
   posObraAgenda_ já faz pro calendário. */
function ehDataAgendamentoPosObra_(nomeCampo) {
  var n = normDist_(nomeCampo);
  if (n.indexOf("CHAMADO") >= 0) return false;
  if (n.indexOf("DATA") < 0) return false;
  return n.indexOf("SERVICO") >= 0 || n.indexOf("RETORNO") >= 0 || n.indexOf("REMARCA") >= 0;
}
/* Valida login+senha de um ADM SEM criar sessão — só pra liberar a marcação
   de sábado. Mesmo mecanismo de tentativas/bloqueio do login_ (chave própria,
   "admval_", pra não confundir com o bloqueio do login normal da pessoa). */
function validarSenhaAdm_(login, senha) {
  var chaveFalha = "admval_" + String(login || "").toLowerCase();
  if (tentativas_(chaveFalha) >= CONFIG.MAX_TENTATIVAS) return { ok: false, erro: "BLOQUEADO" };
  if (!login) return { ok: false, erro: "INFORME_LOGIN" };

  var rows = queryAll_(CONFIG.DB.LOGINS, {});
  for (var i = 0; i < rows.length; i++) {
    var pr = rows[i].properties;
    var lg = titulo_(pr["LOGIN"]);
    if (lg && lg.toLowerCase() === String(login).toLowerCase()) {
      var tipo = (pr["TIPO"] && pr["TIPO"].select && pr["TIPO"].select.name) || "GERAL";
      if (tipo.toUpperCase() !== "ADM") { registrarFalha_(chaveFalha); return { ok: false, erro: "NAO_E_ADM" }; }
      if (!verificaSenha_(String(senha || ""), String(texto_(pr["SENHA"])))) {
        registrarFalha_(chaveFalha);
        return { ok: false, erro: "SENHA_INVALIDA" };
      }
      limparFalhas_(chaveFalha);
      return { ok: true };
    }
  }
  registrarFalha_(chaveFalha);
  return { ok: false, erro: "LOGIN_NAO_ENCONTRADO" };
}
/* Ação própria pra tela CONFERIR a senha do ADM antes de tentar salvar (dá
   pra avisar "senha errada" sem já ter mexido em nada). Mesma checagem que
   checarDataAgendamento_ faz de qualquer forma na hora de gravar — dois
   pontos de checagem de propósito: aqui é só pra dar feedback rápido na
   tela, quem VALE é sempre a checagem no momento da gravação. */
function posObraValidarAdm_(sess, p) {
  return validarSenhaAdm_(p.admLogin, p.admSenha);
}
/* Roda ANTES de gravar uma data de agendamento. Devolve null quando pode
   gravar, ou {ok:false,...} quando não pode. */
function checarDataAgendamento_(nomeCampo, valorData, p) {
  if (!ehDataAgendamentoPosObra_(nomeCampo)) return null;   // não é data de agenda
  if (!valorData) return null;                              // limpando o campo: sempre pode
  if (ehFeriadoGoiania_(valorData)) return { ok: false, erro: "FERIADO_BLOQUEADO" };
  var dw = diaDaSemana_(valorData);
  if (dw === 0) return { ok: false, erro: "DOMINGO_BLOQUEADO" };
  if (dw === 6) {
    if (!p.admLogin || !p.admSenha) return { ok: false, erro: "SABADO_PRECISA_ADM" };
    var v = validarSenhaAdm_(p.admLogin, p.admSenha);
    if (!v.ok) return v;
  }
  return null;
}

/* Edição de um campo do CHAMADO. O tipo usado é sempre o do schema ao vivo,
   nunca o que a tela mandou — se o navegador disser "rich_text" numa coluna
   que virou select, a gravação usa select e não corrompe a propriedade. */
function posObraAtvUpdate_(sess, p) {
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  var campo = posObraAtvCampo_(p.prop);
  if (!campo) return { ok: false, erro: "CAMPO_INEXISTENTE: " + p.prop };
  if (campo.tipo === "files") return { ok: false, erro: "USE_UPLOAD_PARA_ARQUIVOS" };
  if (!campo.editavel) return { ok: false, erro: "CAMPO_NAO_EDITAVEL: " + campo.nome + " (" + campo.tipo + ")" };

  var valor = p.valor;
  if ((campo.tipo === "select" || campo.tipo === "status") && valor) {
    var real = posObraOpcaoReal_(campo, valor);
    if (!real) return { ok: false, erro: "OPCAO_INEXISTENTE: " + valor };
    valor = real;
  }
  if (campo.tipo === "multi_select" && valor && valor.length) {
    var reais = [];
    for (var i = 0; i < valor.length; i++) {
      var r = posObraOpcaoReal_(campo, valor[i]);
      if (!r) return { ok: false, erro: "OPCAO_INEXISTENTE: " + valor[i] };
      reais.push(r);
    }
    valor = reais;
  }

  // AGENDAMENTO: domingo/feriado bloqueados sempre; sábado exige ADM.
  if (campo.tipo === "date") {
    var bloqueio = checarDataAgendamento_(campo.nome, valor, p);
    if (bloqueio) return bloqueio;
  }

  /* MELHORIAS item 7 — chamado FINALIZADO fica congelado.
     Depois de SERVIÇO FINALIZADO, ninguém abre retorno novo nem reescreve o
     que já foi registrado; só o ADM. A trava é AQUI, e não só na tela, porque
     tela se contorna com F12 e histórico de serviço concluído é justamente o
     que não pode ser reescrito depois.
     O próprio ANDAMENTO DA SOLICITAÇÃO continua livre: é ele que reabre o
     chamado quando alguém finalizou por engano. */
  if (!ehAdm_(sess) && normDist_(campo.nome).indexOf("ANDAMENTO DA SOLICITACAO") < 0) {
    var pgAtual = notion_("GET", "/pages/" + p.pageId, null);
    var andAtual = sel_(getTol_(pgAtual.properties, "ANDAMENTO DA SOLICITAÇÃO"));
    if (normDist_(andAtual).indexOf("FINALIZ") >= 0)
      return { ok: false, erro: "CHAMADO_FINALIZADO" };
  }

  var props = {}; props[campo.nome] = buildValue_(campo.tipo, valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  posObraLimparCaches_();
  console.log("PÓS OBRA: " + sess.u + " gravou " + campo.nome + " em " + p.pageId);
  return { ok: true, prop: campo.nome, tipo: campo.tipo };
}

/* ===================== EXCLUIR UM RETORNO (MELHORIAS item 3) ==============
 * Apaga TODOS os campos de um retorno (data, informações, andamento, fotos)
 * de uma vez, e só quando alguém pede de propósito.
 *
 * O pedido veio de um comportamento errado: mudar o ANDAMENTO de RETORNO 02
 * para RETORNO 01 fazia o retorno 02 desaparecer. Isso era a TELA deixando de
 * desenhar o bloco (corrigido na r18) — os dados nunca foram apagados. Mas o
 * ponto continua válido: apagar tem que ser um ato explícito, com botão e
 * confirmação, e não efeito colateral de mexer no andamento.
 *
 * Só ADM: é a única operação do pós obra que destrói histórico.
 * =================================================================== */
function posObraRetornoExcluir_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  var nivel = Number(p.nivel || 0);
  if (!p.pageId || !nivel) return { ok: false, erro: "FALTA_PARAM" };

  var pg = notion_("GET", "/pages/" + p.pageId, null);
  var pr = pg.properties || {}, props = {}, limpos = [];

  for (var nome in pr) {
    var n = normDist_(nome);
    // reconhece o nome antigo e o novo (REMARCAÇÃO 2 / RETORNO 02)
    var ehRet = n.indexOf("REMARCA") >= 0 || n.indexOf("RETORNO") >= 0;
    if (!ehRet) continue;
    var m = n.match(/(\d+)\s*$/);
    if (!m || Number(m[1]) !== nivel) continue;

    var t = pr[nome].type;
    if (!EDITAVEL_[t] || t === "title") continue;   // rollup/fórmula: não dá e nem precisa
    props[nome] = buildValue_(t, t === "multi_select" ? [] : null);
    limpos.push(nome);
  }

  if (!limpos.length) return { ok: false, erro: "RETORNO_INEXISTENTE" };
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  posObraLimparCaches_();
  console.log("PÓS OBRA: " + sess.u + " EXCLUIU o retorno " + nivel +
              " do chamado " + p.pageId + " — campos limpos: " + limpos.join(", "));
  return { ok: true, nivel: nivel, campos: limpos };
}

/* Edição da própria OBRA (base PÓS OBRA).
   ---- MELHORIAS itens 1 e 4 -------------------------------------------------
   TELEFONE, CIDADE e SETOR eram bloqueados aqui porque são espelho de VENDAS:
   gravar só no PÓS OBRA dava a sensação de ter funcionado e a sincronia
   seguinte trazia o valor antigo de volta. Era esse o "não consigo preencher
   o telefone" do item 4.
   Agora eles são editáveis e a gravação vai para OS DOIS LADOS: escreve no
   PÓS OBRA e ESPELHA em VENDAS. Como VENDAS é a fonte da verdade (sua
   escolha), espelhar é justamente o que impede o valor de voltar atrás.
   OBSERVAÇÕES e HORÁRIO FLEXÍVEL não existem em VENDAS: gravam só aqui.
   ÁGIO NÃO entra aqui: é espelho de VENDAS no sentido contrário (a sincronia
   automática que grava, ver posObraAplicar_) — deixar editável aqui faria a
   pessoa "corrigir" na tela e a sincronia seguinte desfazer, exatamente o
   problema que o espelho de TELEFONE/CIDADE/SETOR já resolveu ao contrário. */
var POS_OBRA_EDITAVEIS = ["OBSERVAÇÕES", "HORÁRIO FLEXÍVEL", "TELEFONE", "CIDADE", "SETOR"];
/* Coluna do PÓS OBRA -> coluna equivalente em VENDAS. */
var POS_OBRA_ESPELHO = { "TELEFONE": "Nº Whatsapp", "CIDADE": "CIDADE", "SETOR": "SETOR" };
function posObraUpdate_(sess, p) {
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  var alvo = normDist_(p.prop), liberado = false;
  for (var i = 0; i < POS_OBRA_EDITAVEIS.length; i++) {
    if (normDist_(POS_OBRA_EDITAVEIS[i]) === alvo) { liberado = true; break; }
  }
  if (!liberado) return { ok: false, erro: "CAMPO_NAO_LIBERADO: " + p.prop };

  /* CORRIGIDO: antes gravava sempre como "rich_text". Funcionava por sorte,
     porque OBSERVAÇÕES é texto — mas o HORÁRIO FLEXÍVEL pode ser checkbox ou
     select, e gravar um objeto de rich_text num checkbox corrompe a coluna.
     O tipo agora sai do schema ao vivo, nunca do que o navegador mandou —
     mesma regra que o posObraAtvUpdate_ já seguia. */
  var campo = posObraObraCampo_(p.prop);
  if (!campo) return { ok: false, erro: "CAMPO_INEXISTENTE: " + p.prop };
  if (!campo.editavel) return { ok: false, erro: "CAMPO_NAO_EDITAVEL: " + campo.nome + " (" + campo.tipo + ")" };

  var valor = p.valor;
  // select: só grava opção que existe mesmo (evita 400 e grafia divergente)
  if ((campo.tipo === "select" || campo.tipo === "status") && valor) {
    var real = null, ops = campo.opcoes || [];
    for (var j = 0; j < ops.length; j++) if (normDist_(ops[j]) === normDist_(valor)) { real = ops[j]; break; }
    if (!real) return { ok: false, erro: "OPCAO_INEXISTENTE: " + valor };
    valor = real;
  }

  var props = {}; props[campo.nome] = buildValue_(campo.tipo, valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });

  // espelho em VENDAS (itens 1 e 4) — falha aqui não desfaz a gravação acima
  var espelhado = null;
  try { espelhado = posObraEspelharEmVendas_(p.pageId, campo.nome, valor); }
  catch (e) { console.log("PÓS OBRA espelho em VENDAS falhou: " + e); }

  posObraLimparCaches_();
  console.log("PÓS OBRA: " + sess.u + " gravou " + campo.nome + " na obra " + p.pageId +
              (espelhado ? " (espelhado em VENDAS)" : ""));
  return { ok: true, prop: campo.nome, tipo: campo.tipo, espelhado: !!espelhado };
}

/* Escreve o mesmo valor na venda correspondente. O casamento é o MESMO da
   sincronia (ENDEREÇO normalizado + CASA), então não inventa um segundo
   critério que pudesse divergir do primeiro.
   Se a obra não tem venda (linha criada à mão no PÓS OBRA), não faz nada — e
   isso não é erro: o valor fica gravado só no PÓS OBRA, que é o certo. */
function posObraEspelharEmVendas_(pageId, coluna, valor) {
  var col = null, k;
  for (k in POS_OBRA_ESPELHO) if (normDist_(k) === normDist_(coluna)) { col = POS_OBRA_ESPELHO[k]; break; }
  if (!col) return null;

  var pg = notion_("GET", "/pages/" + pageId, null);
  var endereco = titulo_(pg.properties["Nome"]);
  var casa = numProp_(pg.properties["CASA"]);
  if (!endereco) return null;

  var alvoChave = posObraChave_(endereco, casa), achada = null;
  queryAll_(CONFIG.DB.VENDAS, {}).forEach(function (v) {
    if (achada) return;
    var e = titulo_(getTol_(v.properties, "ENDEREÇO"));
    if (!e) return;
    if (posObraChave_(e, numProp_(getTol_(v.properties, "CASA"))) === alvoChave) achada = v;
  });
  if (!achada) return null;

  var props = {}, vv = posObraValorPara_(CONFIG.DB.VENDAS, col, valor);
  if (!vv) return null;
  props[col] = vv;
  notion_("PATCH", "/pages/" + achada.id, { properties: props });
  try { _cache_().remove("pos_obra_indice"); } catch (e) {}
  return achada.id;
}

/* Anexar arquivo (FOTOS DOS PROBLEMAS, FOTOS PÓS REPAROS RM N, FOTOS DO
   CONTRATO). O envio é o mesmo upload_ que Vendas e Ligações já usam; o que
   muda é a trava: a coluna precisa ser do tipo arquivo numa das duas bases do
   pós obra. Descobrir isso pelo schema (em vez de lista fixa) é o que faz um
   nível de remarcação novo funcionar sem mexer no código. */
function posObraAnexar_(sess, p) {
  if (!p.pageId || !p.prop || !p.dataBase64) return { ok: false, erro: "FALTA_PARAM" };
  var campo = posObraAtvCampo_(p.prop);
  var liberado = !!(campo && campo.tipo === "files");
  // a única coluna de arquivo da base PÓS OBRA (a base da obra, não do chamado)
  if (!liberado && normDist_(p.prop) === normDist_("FOTOS DO CONTRATO")) liberado = true;
  if (!liberado) return { ok: false, erro: "CAMPO_NAO_LIBERADO: " + p.prop };
  console.log("PÓS OBRA: " + sess.u + " anexou \"" + (p.filename || "") + "\" em " +
              p.prop + " / " + p.pageId);
  return upload_(sess, p);
}

/* ===================== USUÁRIOS DO NOTION (campos "people") =====================
 * Coluna do tipo "people" (ex.: ENG. RESPONSÁEL) não aceita nome: a API do
 * Notion só grava o UUID do usuário. Por isso o campo ficava travado no site
 * — não dava pra digitar "Isaac Natan" e esperar que funcionasse.
 * Esta ação devolve a lista de pessoas do workspace (id + nome), que o site
 * usa pra montar um <select>; ao escolher, o que vai pro Notion é o id.
 *
 * PRÉ-REQUISITO: a integração precisa da capacidade "Read user information"
 * (Notion > Minhas integrações > sua integração > Capacidades). Sem ela a
 * chamada volta 403 e o campo continua só leitura, sem quebrar o resto.
 * Bots (as próprias integrações) são descartados — não são pessoas.
 * =================================================================== */
function usuarios_(sess) {
  return comCache_("notion_usuarios", 3600, function () {   // 1 h: quadro de pessoas muda pouco
    try {
      var out = [], cursor = null, paginas = 0;
      do {
        var qs = "page_size=100" + (cursor ? ("&start_cursor=" + encodeURIComponent(cursor)) : "");
        var r = notion_("GET", "/users?" + qs, null);
        (r.results || []).forEach(function (u) {
          if (u.type === "bot") return;
          if (!u.id || !u.name) return;
          out.push({ id: u.id, nome: u.name });
        });
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor && ++paginas < 10);
      out.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); });
      return { ok: true, usuarios: out };
    } catch (e) {
      return { ok: false, erro: "SEM_LEITURA_DE_USUARIOS", detalhe: String(e).slice(0, 180) };
    }
  });
}

/* ===================== TÍTULO DE PÁGINAS LIGADAS (relation) =====================
 * Coluna do tipo relation devolve só o ID da página ligada — não o nome. Pra
 * traduzir, tentamos primeiro casar o id com o que já é publicado no
 * documentos.json (barato, feito no próprio site). Quando o id NÃO está lá —
 * porque a relation aponta pra outra base, ou pra um registro que o
 * fetch_vendas.py pula — só o Notion sabe o nome. É o que esta ação faz.
 *
 * Recebe uma lista de ids e devolve {id: título}. Cache de 6 h por id: o
 * título de uma obra praticamente não muda, e sem cache uma tela de alertas
 * com 12 linhas viraria 12 chamadas à API a cada abertura.
 * Id que falhar (página apagada, sem permissão) volta como null — o site
 * mostra um texto curto em vez de quebrar a tela inteira.
 * =================================================================== */
function titulos_(sess, p) {
  var ids = p.ids;
  if (typeof ids === "string") { try { ids = JSON.parse(ids); } catch (e) { ids = [ids]; } }
  if (!ids || !ids.length) return { ok: true, titulos: {} };
  if (ids.length > 60) ids = ids.slice(0, 60);   // teto: doGet do Apps Script tem limite de tempo

  var cache = _cache_(), mapa = {}, faltando = [];
  ids.forEach(function (id) {
    var hit = null;
    try { hit = cache.get("titulo_" + id); } catch (e) {}
    if (hit != null) mapa[id] = (hit === "\u0000" ? null : hit);   // \0 = "já tentei e não achei"
    else faltando.push(id);
  });

  faltando.forEach(function (id) {
    var titulo = null;
    try {
      var pg = notion_("GET", "/pages/" + id, null);
      var props = pg.properties || {};
      for (var nome in props) {
        if (props[nome].type === "title") { titulo = titulo_(props[nome]); break; }
      }
    } catch (e) { /* página apagada ou fora do alcance da integração */ }
    mapa[id] = titulo || null;
    try { cache.put("titulo_" + id, titulo || "\u0000", 21600); } catch (e) {}
  });

  return { ok: true, titulos: mapa };
}

/* ===================== VENDAS: schema, lista, obra, escrita ===================== */
function vendasSchema_(sess) { return comCache_("vendas_schema", 1800, _vendasSchemaCalc_); }  // cache 30 min
function _vendasSchemaCalc_() {
  var db = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null);
  var props = db.properties || {};
  var campos = [];
  for (var nome in props) {
    var t = props[nome].type;
    var c = { nome: nome, tipo: t, editavel: EDITAVEL_[t] === true };
    if (t === "select" || t === "status" || t === "multi_select")
      c.opcoes = (props[nome][t].options || []).map(function (o) { return o.name; });
    campos.push(c);
  }
  // opções criadas pelo site que ainda não existem no schema do Notion
  // (coluna com 100+ opções — ver novaOpcao_)
  return { ok: true, titulo: "ENDEREÇO", campos: opcPendMesclar_("VENDAS", campos) };
}
// "status" foi adicionado aqui — antes só "select" estava marcado como editável,
// então qualquer coluna do tipo Status (o tipo novo do Notion, diferente de
// Select) ficava travada mesmo sendo uma propriedade normal de escrever.
// Precisa bater com TIPOS_EDITAVEIS do fetch_vendas.py — se um dia adicionar
// um tipo aqui, adiciona lá também.
var EDITAVEL_ = {
  title: true, rich_text: true, number: true, select: true, status: true, multi_select: true,
  date: true, checkbox: true, url: true, email: true, phone_number: true, files: true,
  // people: true desde que exista de onde tirar o UUID — ver usuarios_ e o
  // <select> de pessoas no vendas.html. O buildValue_ já monta {people:[{id}]}.
  people: true, formula: false, rollup: false, relation: false, created_time: false,
  last_edited_time: false, created_by: false, last_edited_by: false, unique_id: false
};

function vendas_(sess, p) {
  var body = {};
  var and = [];
  if (p.setor) and.push({ property: "SETOR", select: { equals: p.setor } });
  if (and.length) body.filter = { and: and };

  var rows = queryAll_(CONFIG.DB.VENDAS, body);
  var lista = rows.map(function (r) { return { id: r.id, valores: resolver_(r.properties) }; });
  return { ok: true, total: lista.length, vendas: lista };
}

function obra_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  return { ok: true, id: pg.id, valores: resolver_(pg.properties) };
}

function updateVenda_(sess, p) {
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  // Arquivo tem fluxo próprio (upload_ + File Upload API do Notion) — se
  // passasse por aqui, caía no "default" do buildValue_ e gravava um objeto
  // de rich_text num campo de arquivo, corrompendo a propriedade.
  if (p.tipo === "files") return { ok: false, erro: "USE_UPLOAD_PARA_ARQUIVOS" };
  // MASTER não edita endereço. A trava tem que ser AQUI: esconder o campo no
  // navegador não impede ninguém de chamar esta action pelo DevTools.
  if (ehMaster_(sess) && String(p.prop || "").trim().toUpperCase().indexOf("ENDERE") === 0) {
    return { ok: false, erro: "MASTER_NAO_EDITA_ENDERECO" };
  }
  if (EDITAVEL_[p.tipo] !== true) return { ok: false, erro: "CAMPO_NAO_EDITAVEL: " + p.tipo };
  var props = {}; props[p.prop] = buildValue_(p.tipo, p.valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });

  if (posObraEhGatilho_(p.prop)) {
    try {
      var pgAtual = notion_("GET", "/pages/" + p.pageId, null);
      posObraSincronizar_(pgAtual.properties);
    } catch (e) { console.log("PÓS OBRA sync (updateVenda_) falhou: " + e); }
  }

  return { ok: true };
}

function criarVenda_(sess, p) {
  var lista = p.props || [];
  var props = {};
  for (var i = 0; i < lista.length; i++) {
    var it = lista[i];
    if (EDITAVEL_[it.tipo] === true && it.tipo !== "files")
      props[it.prop] = buildValue_(it.tipo, it.valor);
  }
  if (!props["ENDEREÇO"]) return { ok: false, erro: "ENDERECO_OBRIGATORIO" };
  var pg = notion_("POST", "/pages", { parent: { database_id: CONFIG.DB.VENDAS }, properties: props });

  try { posObraSincronizar_(pg.properties); } catch (e) { console.log("PÓS OBRA sync (criarVenda_) falhou: " + e); }

  return { ok: true, id: pg.id };
}

function excluirVenda_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  // "archived" foi renomeado pra "in_trash" na API do Notion; a partir da
  // versão 2026-03-11 só "in_trash" é aceito. Manda os dois — a versão em
  // uso lê o que reconhece e ignora o outro (mesma solução já usada no
  // Code.gs da RAS-SEMANAL).
  notion_("PATCH", "/pages/" + p.pageId, { in_trash: true, archived: true });
  return { ok: true };
}

/* ===================== NOVA OPÇÃO DE SELECT =====================
 * Cria uma opção nova (um corretor, um tipo de serviço, um responsável)
 * direto pelo site, em VENDAS ou em ATIVIDADES PÓS OBRA.
 *
 * ---- POR QUE ISTO FOI REESCRITO (o erro do CORRETOR) ----------------------
 * A versão anterior sempre fazia PATCH em /databases mandando o array INTEIRO
 * de opções. A API do Notion valida esse array em no máximo 100 itens, e o
 * CORRETOR já tinha 108. Resultado, em toda tentativa de cadastrar corretor:
 *
 *   400 body.properties.CORRETOR.select.options.length
 *       should be <= 100, instead was 109
 *
 * Ou seja: não era um corretor específico, era a coluna inteira travada — e
 * IMOBILIÁRIA/BANCO/CORRESPONDENTE travariam do mesmo jeito ao passar de 100.
 *
 * ---- COMO FUNCIONA AGORA -------------------------------------------------
 * Abaixo de 100 opções: continua fazendo o PATCH (a opção nasce no Notion na
 * hora e todo mundo enxerga no mesmo instante).
 *
 * A partir de 100: NÃO mexe no schema. Guarda o nome numa lista de PENDENTES
 * nas Propriedades do Script e devolve ok. O schema entregue ao navegador sai
 * daqui já com os pendentes mesclados, então o campo aparece no <select>
 * normalmente. Quando alguém grava esse valor numa página, o Notion cria a
 * opção sozinho (gravação de página não passa pelo limite de 100 — o limite é
 * do payload de schema). Na leitura seguinte o pendente já existe de verdade
 * na base e some da lista sozinho (ver opcPendMesclar_).
 *
 * Só as colunas listadas em CAMPOS_OPCAO_LIVRE podem receber opção nova. Sem
 * essa lista, o primeiro erro de digitação de qualquer usuário viraria uma
 * opção permanente em qualquer campo do banco.
 * =================================================================== */

/* Colunas liberadas, por base. A chave é o "base" que a tela manda.
   Precisa bater com o CAMPOS_OPCAO_LIVRE do vendas.html e do pos-obra.html —
   mas quem AUTORIZA de fato é aqui, o navegador só decide se mostra o botão. */
var CAMPOS_OPCAO_LIVRE = {
  VENDAS:   ["CORRETOR", "IMOBILIÁRIA", "BANCO", "CORRESPONDENTE"],
  POS_OBRA: ["SERVIÇO", "RESPONSÁVEL"]
};
/* Base -> id do banco + acesso exigido no LOGINS. Como novaOpcao serve dois
   setores agora, a checagem de permissão saiu do handle_ e mora aqui: um
   usuário só de PÓS OBRA precisa poder criar serviço sem ter acesso a VENDAS
   (e vice-versa). */
var OPCAO_BASES = {
  VENDAS:   { db: function () { return CONFIG.DB.VENDAS; },              acesso: "VENDAS",   cache: "vendas_schema" },
  POS_OBRA: { db: function () { return CONFIG.DB.ATIVIDADES_POS_OBRA; }, acesso: "PÓS OBRA", cache: "pos_obra_atv_schema" }
};
var NOTION_MAX_OPCOES = 100;   // limite do payload de PATCH /databases

/* ---- Pendentes: tudo num único Property, em JSON --------------------------
   Uma chave só (e não uma por coluna) de propósito: PropertiesService é lento
   e o mesclar_ roda a cada recálculo de schema. Uma leitura, uma escrita. */
var OPC_PEND_KEY = "OPCOES_PENDENTES";
function opcPendChave_(base, prop) { return base + "::" + normDist_(prop); }
function opcPendTudo_() {
  try { return JSON.parse(PROPS_.getProperty(OPC_PEND_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function opcPendSalvar_(obj) {
  try { PROPS_.setProperty(OPC_PEND_KEY, JSON.stringify(obj)); } catch (e) {}
}

/* Mescla os pendentes nas opções lidas do Notion e, de quebra, faz a limpeza:
   pendente que já virou opção de verdade na base sai da lista. É por isso que
   a lista não cresce para sempre — ela se esvazia sozinha conforme as opções
   são usadas. Recebe e devolve o mesmo array de campos do schema. */
function opcPendMesclar_(base, campos) {
  var todos = opcPendTudo_(), mudou = false;
  for (var i = 0; i < campos.length; i++) {
    var c = campos[i];
    if (!c.opcoes) continue;
    var chave = opcPendChave_(base, c.nome);
    var pend = todos[chave];
    if (!pend || !pend.length) continue;

    var reais = {}, j;
    for (j = 0; j < c.opcoes.length; j++) reais[normDist_(c.opcoes[j])] = 1;

    var restam = [];
    for (j = 0; j < pend.length; j++) if (!reais[normDist_(pend[j])]) restam.push(pend[j]);

    if (restam.length !== pend.length) mudou = true;         // algum já materializou
    if (restam.length) { todos[chave] = restam; c.opcoes = c.opcoes.concat(restam); }
    else { delete todos[chave]; }
  }
  if (mudou) opcPendSalvar_(todos);
  return campos;
}

function novaOpcao_(sess, p) {
  var base = String(p.base || "VENDAS").toUpperCase();
  var cfg = OPCAO_BASES[base], permitidos = CAMPOS_OPCAO_LIVRE[base];
  if (!cfg || !permitidos) return { ok: false, erro: "BASE_DESCONHECIDA: " + base };
  if (!temAcesso_(sess, cfg.acesso)) {
    console.log("BLOQUEADO novaOpcao (" + base + "): " + sess.u);
    return { ok: false, erro: "SEM_PERMISSAO" };
  }

  var prop = String(p.prop || "").trim();
  var nome = String(p.valor || "").trim();
  if (!prop || !nome) return { ok: false, erro: "FALTA_PARAM" };
  if (nome.length > 60) return { ok: false, erro: "NOME_MUITO_LONGO" };
  // vírgula quebra a API de select do Notion
  if (nome.indexOf(",") >= 0) return { ok: false, erro: "SEM_VIRGULA" };

  var alvo = normDist_(prop);
  var liberado = permitidos.some(function (c) { return normDist_(c) === alvo; });
  if (!liberado) return { ok: false, erro: "CAMPO_NAO_LIBERADO: " + prop };

  var dbId = cfg.db();
  var db = notion_("GET", "/databases/" + dbId, null);
  /* Acha a coluna pelo nome NORMALIZADO. A versão anterior indexava direto
     (db.properties[prop]) e quebrava sozinha em coluna com espaço sobrando —
     "SERVIÇO " existe assim em base real. */
  var todas = db.properties || {}, propReal = null, def = null;
  for (var k in todas) if (normDist_(k) === alvo) { propReal = k; def = todas[k]; break; }
  if (!def) return { ok: false, erro: "CAMPO_INEXISTENTE: " + prop };

  var t = def.type;
  // status é fechado: o Notion não deixa criar opção por API, nem por página
  if (t === "status") return { ok: false, erro: "STATUS_NAO_ACEITA_NOVA_OPCAO" };
  if (t !== "select" && t !== "multi_select")
    return { ok: false, erro: "TIPO_NAO_SUPORTA_OPCAO: " + t };

  var opts = (def[t] && def[t].options) || [];
  for (var i = 0; i < opts.length; i++) {
    // já existe (ignorando acento/caixa): devolve o nome real, sem duplicar
    if (normDist_(opts[i].name) === normDist_(nome))
      return { ok: true, nome: opts[i].name, prop: propReal, jaExistia: true };
  }

  var todosPend = opcPendTudo_(), chave = opcPendChave_(base, propReal);
  var pend = todosPend[chave] || [];
  for (i = 0; i < pend.length; i++) {
    if (normDist_(pend[i]) === normDist_(nome))
      return { ok: true, nome: pend[i], prop: propReal, jaExistia: true, pendente: true };
  }

  // --- caminho normal: cabe no schema ---
  if (opts.length < NOTION_MAX_OPCOES) {
    var novas = opts.map(function (o) { return { name: o.name }; });
    novas.push({ name: nome });
    var props = {}; props[propReal] = {}; props[propReal][t] = { options: novas };
    notion_("PATCH", "/databases/" + dbId, { properties: props });
    opcLimparCacheSchema_(base);
    console.log("NOVA OPÇÃO (" + base + ") por " + sess.u + ": " + propReal + " = " + nome);
    return { ok: true, nome: nome, prop: propReal };
  }

  // --- coluna lotada: vira pendente e materializa na primeira gravação ---
  pend.push(nome);
  todosPend[chave] = pend;
  opcPendSalvar_(todosPend);
  opcLimparCacheSchema_(base);
  console.log("NOVA OPÇÃO PENDENTE (" + base + ") por " + sess.u + ": " + propReal +
              " = " + nome + " — a coluna já tem " + opts.length +
              " opções, acima do limite de schema do Notion (" + NOTION_MAX_OPCOES + ").");
  return { ok: true, nome: nome, prop: propReal, pendente: true };
}

/* Sem isto a opção nova só apareceria para os outros usuários depois dos
   30 min de cache do schema. */
function opcLimparCacheSchema_(base) {
  try { _cache_().remove((OPCAO_BASES[base] || {}).cache || ""); } catch (e) {}
  if (base === "POS_OBRA") { try { posObraLimparCaches_(); } catch (e) {} }
}

/* Diagnóstico das opções pendentes — só LÊ. Rode pelo menu Executar. */
function conferirOpcoesPendentes() {
  var todos = opcPendTudo_(), n = 0;
  for (var k in todos) { n++; Logger.log(k + "  ->  " + todos[k].join(" | ")); }
  if (!n) Logger.log("Nenhuma opção pendente. (Normal: elas somem sozinhas depois de usadas.)");
}

/* ===================== AGENDA DO DIA (SEM LOGIN) =====================
 * A tela servicos.html, feita para o Jorcineide abrir no celular sem digitar
 * usuário e senha. É a única rota do backend que dispensa token.
 *
 * ---- POR QUE ISTO É ACEITÁVEL, E ATÉ ONDE VAI --------------------------
 * Sem login não existe "quem é você", então a proteção passa a ser o QUANTO
 * a rota consegue entregar. Foi estreitada em cinco eixos:
 *
 *  1. CHAVE  — o link carrega uma chave aleatória de 32 caracteres. Sem ela,
 *              ou com ela errada, a resposta é CHAVE_INVALIDA e nada vaza.
 *  2. PESSOA — a chave JÁ DIZ de quem é a agenda. Não existe parâmetro de
 *              responsável: trocar o nome na URL não muda nada. Uma chave só
 *              enxerga uma pessoa.
 *  3. JANELA — só hoje e amanhã. Ontem e a semana que vem não saem por aqui.
 *  4. CAMPOS — devolve só o necessário para a visita (endereço, cliente,
 *              telefone, hora, serviços, observação). Nada de CPF, valores,
 *              contrato, banco ou qualquer campo de vendas.
 *  5. LEITURA— não existe gravação nenhuma nesta rota.
 *
 * Risco que SOBRA e que você precisa conhecer: quem receber o link (print no
 * grupo, celular emprestado, WhatsApp encaminhado) vê nome e telefone dos
 * clientes daqueles dois dias. Se isso acontecer, rode
 * revogarChaveAgenda("JORCINEIDE (PÓS OBRA)") e gere outra — o link antigo
 * morre na hora.
 *
 * ---- COMO CRIAR O LINK ----------------------------------------------------
 * No editor do Apps Script, escolha a função criarChaveAgenda e Executar.
 * Ela imprime o link pronto no registro de execução. Copie e mande para ele.
 * =================================================================== */
var AGENDA_DIA_KEY = "AGENDA_DIA_CHAVES";   // JSON: { chave: "NOME DO RESPONSÁVEL" }
var AGENDA_DIA_TZ  = "America/Sao_Paulo";

function agendaChaves_() {
  try { return JSON.parse(PROPS_.getProperty(AGENDA_DIA_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function agendaDiaISO_(dias) {
  var d = new Date();
  if (dias) d.setDate(d.getDate() + dias);
  // fuso fixo: o servidor do Apps Script não roda no horário de Brasília
  return Utilities.formatDate(d, AGENDA_DIA_TZ, "yyyy-MM-dd");
}

/* Andamento DAQUELE evento (não o do chamado inteiro): serviço concluído some
   da lista, remarcação 2 concluída não esconde a remarcação 3. Mesma regra do
   andamentoDoEvento() da tela de pós obra. */
function agendaAndamentoDaColuna_(pr, col, geral) {
  var n = normDist_(col), nivel = (String(col).match(/(\d+)\s*$/) || [])[1], k, kn;
  if (n.indexOf("REMARCA") >= 0 && nivel) {
    for (k in pr) {
      kn = normDist_(k);
      if (kn.indexOf("ANDAMENTO") >= 0 && kn.indexOf("REMARCA") >= 0 && kn.indexOf(nivel) >= 0)
        return sel_(pr[k]);
    }
    return null;
  }
  if (n.indexOf("DATA") === 0 && n.indexOf("SERVICO") >= 0) {
    for (k in pr) {
      kn = normDist_(k);
      if (kn.indexOf("ANDAMENTO") >= 0 && kn.indexOf("SERVICO") >= 0 && kn.indexOf("REMARCA") < 0)
        return sel_(pr[k]);
    }
    return null;
  }
  return geral || null;
}
function agendaFinalizado_(v) {
  var n = normDist_(v);
  return !!n && (n.indexOf("FINALIZ") >= 0 || n.indexOf("FEITO") >= 0 || n.indexOf("CONCLU") >= 0);
}

function agendaDia_(p) {
  var chave = String(p.chave || "").trim();
  var alvo = agendaChaves_()[chave];
  // mensagem genérica de propósito: não confirma se a chave existe
  if (!chave || !alvo) return { ok: false, erro: "CHAVE_INVALIDA" };

  var hoje = agendaDiaISO_(0), amanha = agendaDiaISO_(1), alvoN = normDist_(alvo);

  /* Cache curto por pessoa. 120s segura o caso real: ele abre, fecha e
     reabre o link várias vezes seguidas no celular. */
  return comCache_("agenda_dia_" + normDist_(alvo).replace(/\W/g, "_"), 120, function () {
    var obras = {};
    posObras_(null, {}).obras.forEach(function (o) { obras[String(o.id).replace(/-/g, "")] = o; });

    var itens = [];
    queryAll_(CONFIG.DB.ATIVIDADES_POS_OBRA, {}).forEach(function (a) {
      var pr = a.properties;
      var resp = sel_(getTol_(pr, "RESPONSÁVEL"));
      if (normDist_(resp) !== alvoN) return;                 // não é dele: fora

      var geral = sel_(getTol_(pr, "ANDAMENTO DA SOLICITAÇÃO"));
      var rel = (pr["PÓS OBRA"] && pr["PÓS OBRA"].relation) || [];
      var obra = rel[0] ? obras[String(rel[0].id).replace(/-/g, "")] : null;
      var servicos = ((getTol_(pr, "SERVIÇO").multi_select) || []).map(function (o) { return o.name; });

      for (var col in pr) {
        if (pr[col].type !== "date") continue;
        var n = normDist_(col);
        // só compromisso de visita: serviço e remarcações
        if (!((n.indexOf("DATA") === 0 && n.indexOf("SERVICO") >= 0) || n.indexOf("REMARCA") >= 0)) continue;
        var d = dt_(pr[col]);
        if (!d) continue;
        var dia = String(d).slice(0, 10);
        if (dia !== hoje && dia !== amanha) continue;         // janela de 2 dias
        if (agendaFinalizado_(agendaAndamentoDaColuna_(pr, col, geral))) continue;

        itens.push({
          dia: dia,
          data: d,
          endereco: tituloDe_(pr),
          // item 2: a tela do responsável monta ENDEREÇO · SETOR · CIDADE
          setor: obra ? (obra.setor || "") : "",
          cidade: obra ? (obra.cidade || "") : "",
          cliente: obra ? (obra.clientes || "") : "",
          telefone: obra ? (obra.telefone || "") : "",
          responsavel: resp,
          servicos: servicos,
          info: posObraInfoDaColuna_(pr, col),
          remarcacao: n.indexOf("REMARCA") >= 0
        });
      }
    });
    itens.sort(function (x, y) { return x.data < y.data ? -1 : (x.data > y.data ? 1 : 0); });
    return { ok: true, responsavel: alvo, hoje: hoje, amanha: amanha,
             total: itens.length, itens: itens, lidoEm: new Date().toISOString() };
  });
}

/* Gera (ou devolve) a chave de um responsável PELA TELA, sem abrir o Apps
   Script. É o caminho normal do dia a dia; as funções de menu abaixo ficam
   como plano B.
   Só ADM: quem pode criar o link decide quem enxerga dado de cliente sem
   login — não é decisão para dar a todo mundo que tem acesso a PÓS OBRA.
   Devolve só a CHAVE; a tela monta a URL a partir do próprio endereço, então
   trocar o domínio do site não exige mexer aqui. */
function agendaLink_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  var nome = String(p.resp || "").trim();
  if (!nome) return { ok: false, erro: "FALTA_PARAM" };

  var todas = agendaChaves_(), k, atual = null;
  for (k in todas) if (normDist_(todas[k]) === normDist_(nome)) { atual = k; break; }

  // regerar: derruba a chave antiga na hora (link vazado, celular perdido)
  if (p.regerar && atual) { delete todas[atual]; atual = null; }
  if (atual) return { ok: true, nome: nome, chave: atual, novo: false };

  var alfabeto = "abcdefghijkmnopqrstuvwxyz23456789";   // sem l/1/0/o: confundem
  var chave = "";
  for (var i = 0; i < 32; i++) chave += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  todas[chave] = nome;
  PROPS_.setProperty(AGENDA_DIA_KEY, JSON.stringify(todas));
  console.log("AGENDA DIA: " + sess.u + " gerou link para " + nome + (p.regerar ? " (regerado)" : ""));
  return { ok: true, nome: nome, chave: chave, novo: true, regerado: !!p.regerar };
}

/* ===================== BACKFILL DE CIDADE E SETOR (item 1) ================
 * Preenche CIDADE e SETOR no PÓS OBRA para as obras que já existiam antes
 * desses campos entrarem na sincronia. Rodar UMA vez, pelo menu Executar.
 *
 * Só preenche o que estiver VAZIO no PÓS OBRA — nunca sobrescreve um valor já
 * digitado. Assim, rodar duas vezes por engano não estraga nada.
 *
 * Ela guarda onde parou e reaproveita a mesma trava de tempo da varredura
 * grande: se o Apps Script cortar em 6 min, é só rodar de novo que ela
 * continua de onde ficou. Quando terminar, avisa "CONCLUÍDO" no registro.
 * =================================================================== */
var BACKFILL_CS_PROGRESSO = "BACKFILL_CIDADE_SETOR";

function preencherCidadeSetorAntigas() {
  var t0 = new Date().getTime();
  var de = Number(PROPS_.getProperty(BACKFILL_CS_PROGRESSO) || 0);

  var vendas = queryAll_(CONFIG.DB.VENDAS, {});
  var indice = posObraIndiceCalc_();
  var gravadas = 0, puladas = 0, semVenda = 0, i;

  for (i = de; i < vendas.length; i++) {
    if (new Date().getTime() - t0 > POS_OBRA_BUDGET_MS) {
      PROPS_.setProperty(BACKFILL_CS_PROGRESSO, String(i));
      Logger.log("PAUSADO em " + i + " de " + vendas.length +
                 ". Gravadas: " + gravadas + ", já preenchidas: " + puladas +
                 ".\n\nRode a função DE NOVO para continuar de onde parou.");
      return;
    }
    var pv = vendas[i].properties;
    var endereco = titulo_(getTol_(pv, "ENDEREÇO"));
    if (!endereco) continue;

    var atual = indice[posObraChave_(endereco, numProp_(getTol_(pv, "CASA")))];
    if (!atual) { semVenda++; continue; }        // sem linha em PÓS OBRA ainda

    var props = {};
    [["CIDADE", "cidade"], ["SETOR", "setor"]].forEach(function (par) {
      var col = par[0], k = par[1];
      if (atual[k]) return;                       // já preenchido: não toca
      var v = posObraTextoLivre_(getTol_(pv, col));
      if (!v || posObraValorAmbiguo_(v)) return;   // deixa vazio p/ você conferir
      var vv = posObraValorPara_(CONFIG.DB.POS_OBRA, col, v);
      if (vv) { props[col] = vv; atual[k] = v; }
    });

    if (Object.keys(props).length) {
      notion_("PATCH", "/pages/" + atual.id, { properties: props });
      gravadas++;
    } else puladas++;
  }

  PROPS_.deleteProperty(BACKFILL_CS_PROGRESSO);
  posObraLimparCaches_();
  try { _cache_().remove("pos_obra_indice"); } catch (e) {}
  Logger.log("CONCLUÍDO.\nVendas percorridas: " + vendas.length +
             "\nLinhas do PÓS OBRA preenchidas: " + gravadas +
             "\nJá tinham CIDADE/SETOR (ou VENDAS estava vazia): " + puladas +
             "\nSem linha correspondente no PÓS OBRA: " + semVenda);
}
/* Zera o progresso, para reprocessar do começo. */
function reiniciarBackfillCidadeSetor() {
  PROPS_.deleteProperty(BACKFILL_CS_PROGRESSO);
  Logger.log("Progresso zerado. A próxima execução começa da primeira venda.");
}

/* ---- ADMINISTRAÇÃO DAS CHAVES (plano B: rodar pelo menu Executar) ------- */

/* Gera o link do Jorcineide. Para outra pessoa, troque o nome — ele precisa
   bater com o RESPONSÁVEL do Notion (acento e caixa não importam). */
function criarChaveAgenda() {
  var nome = "JORCINEIDE (PÓS OBRA)";
  var alfabeto = "abcdefghijkmnopqrstuvwxyz23456789";   // sem l/1/0/o: é digitado errado
  var chave = "";
  for (var i = 0; i < 32; i++) chave += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));

  var todas = agendaChaves_();
  // uma chave por pessoa: gerar de novo revoga a anterior automaticamente
  for (var k in todas) if (normDist_(todas[k]) === normDist_(nome)) delete todas[k];
  todas[chave] = nome;
  PROPS_.setProperty(AGENDA_DIA_KEY, JSON.stringify(todas));

  Logger.log("Chave criada para " + nome + "\n\nMande este link:\n" +
             "https://devmoraiseng.github.io/PORTAL-MORAIS/servicos.html?k=" + chave +
             "\n\nQualquer link antigo desta pessoa acabou de parar de funcionar.");
}
function revogarChaveAgenda(nome) {
  var todas = agendaChaves_(), n = 0;
  for (var k in todas) if (!nome || normDist_(todas[k]) === normDist_(nome)) { delete todas[k]; n++; }
  PROPS_.setProperty(AGENDA_DIA_KEY, JSON.stringify(todas));
  Logger.log(n + " chave(s) revogada(s). Os links correspondentes pararam de funcionar.");
}
function listarChavesAgenda() {
  var todas = agendaChaves_(), n = 0;
  // mostra só o começo da chave: o registro de execução fica gravado no projeto
  for (var k in todas) { n++; Logger.log(todas[k] + "  ->  " + k.slice(0, 6) + "…(" + k.length + " caracteres)"); }
  if (!n) Logger.log("Nenhuma chave criada. Rode criarChaveAgenda().");
}

/* ===================== DISTRATO =====================
 * Desistência do cliente no meio do processo: limpa os dados da venda,
 * devolve os selecionáveis para NÃO e manda as atividades da obra pra
 * lixeira. Sobrevivem só os dados da obra em si (ver DISTRATO_MANTIDOS).
 *
 * A validação da senha e a lista do que fica moram AQUI, no servidor, de
 * propósito: no navegador qualquer pessoa abriria o DevTools e mudaria.
 *
 * ANTES DE USAR NUMA OBRA REAL rode testeDistratoSimulado() (no fim deste
 * arquivo). Ele não altera nada — só lista o que aconteceria. Distrato não
 * tem desfazer pelo site.
 * =================================================================== */

/* Quem pode dar distrato, por LOGIN (sem diferenciar maiúsculas, igual ao login_).
   Lista vazia = qualquer ADM ou quem tem "VENDAS" em ACESSOS.
   Isto barra OUTROS usuários, mas não quem souber a senha da Juliana — essa
   pessoa entra como ela de qualquer forma.
   PARA TESTAR: ponha o seu login aqui também, ex.: ["Juliana", "Felipe"]. */
var LOGINS_DISTRATO = ["Juliana"];

/* Colunas de VENDAS que SOBREVIVEM ao distrato.
   Comparação por nome EXATO (ignorando acento, caixa e espaço sobrando).
   Não uso "começa com" de propósito: "CASA" pegaria também
   "CASA APTA PARA A VISTORIA", que precisa voltar pra NÃO.
   Por isso as variantes estão escritas uma a uma — inclusive o typo
   "ENG. RESPONSÁEL", que é como a coluna está na base. */
var DISTRATO_MANTIDOS = [
  "ENDEREÇO",
  "CASA",
  "TIPO",
  "MODELO?", "MODELO",
  "REF",
  "SETOR",
  "CIDADE",
  "ENG. RESPONSÁVEL", "ENG. RESPONSÁEL",
  "SITUAÇÃO", "SITUAÇÃO DO PROCESSO",
  "AVALIAÇÃO", "VALOR NA MÃO"
];

/* Estes casam por PEDAÇO do nome, não exato. Motivo: são as colunas de
   COMISSÃO e os links de LOCALIZAÇÃO / LAYOUT / FOTOS (item 1 do pedido da
   aba VENDAS), e a grafia exata delas na base pode ser "LINK LOCALIZAÇÃO",
   "FOTOS DA CASA" etc. Com comparação exata, um nome ligeiramente diferente
   falharia CALADO e o distrato apagaria o campo de novo — que é justo o bug
   que este item conserta.
   CONFIRA com testeDistratoSimulado(): se algum campo que DEVE ser limpo
   estiver caindo aqui por causa do pedaço, me avisa que eu troco por nome
   exato. */
/* COMISSÃO SAIU desta lista (pedido novo): ela deve ser APAGADA no distrato.
   Na rodada anterior ela estava sendo preservada, a pedido — foi revertido. */
var DISTRATO_MANTIDOS_FRAG = ["LOCALIZA", "LAYOUT", "FOTO"];

function normDist_(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

/* Coluna com dado pessoal, que não deve ser copiada para o log de execução.
   Mesma ideia (e mesmos fragmentos) do CAMPOS_SENSIVEIS_PADRAO do
   fetch_vendas.py — se acrescentar um lá, acrescente aqui também. */
var LOG_SENSIVEL_FRAG = [
  "CLIENTE", "COMPRADOR", "CPF", "CNPJ", "RG", "IDENTIDADE",
  "TELEFONE", "CELULAR", "WHATSAPP", "CONTATO", "E-MAIL", "EMAIL",
  "PARCELA", "FGTS", "AGENCIA", "CONTA CORRENTE", "PIX",
  "NASCIMENTO", "ESTADO CIVIL", "PROFISSAO", "RENDA"
];
function logSensivel_(nome) {
  var n = normDist_(nome);
  for (var i = 0; i < LOG_SENSIVEL_FRAG.length; i++) {
    if (n.indexOf(normDist_(LOG_SENSIVEL_FRAG[i])) >= 0) return true;
  }
  return false;
}

function distratoMantido_(nome) {
  var n = normDist_(nome);
  for (var i = 0; i < DISTRATO_MANTIDOS.length; i++) {
    if (normDist_(DISTRATO_MANTIDOS[i]) === n) return true;
  }
  for (var j = 0; j < DISTRATO_MANTIDOS_FRAG.length; j++) {
    if (n.indexOf(DISTRATO_MANTIDOS_FRAG[j]) >= 0) return true;
  }
  return false;
}

/* Opção equivalente a "NÃO" no schema da coluna (select ou status).
   Se a coluna não tiver essa opção, devolve null e o campo é esvaziado —
   melhor que mandar um nome inexistente e tomar 400 do Notion. */
function distratoOpcaoNao_(schemaProp) {
  var t = schemaProp && schemaProp.type;
  if (t !== "select" && t !== "status") return null;
  var ops = (schemaProp[t] && schemaProp[t].options) || [];
  for (var i = 0; i < ops.length; i++) {
    var n = normDist_(ops[i].name);
    if (n === "NAO" || n === "NO") return ops[i].name;
  }
  return null;
}

/* Valor "zerado" por tipo. Usa o buildValue_ que já existe, menos nos casos
   que ele não cobre (files) ou cobre diferente (select/status viram NÃO). */
function distratoZerar_(tipo, opcaoNao) {
  if (EDITAVEL_[tipo] !== true) return null;          // formula, rollup, relation...
  if (tipo === "files") return { files: [] };
  if (tipo === "select" || tipo === "status") return buildValue_(tipo, opcaoNao || "");
  if (tipo === "multi_select") return { multi_select: [] };
  if (tipo === "people") return null;
  return buildValue_(tipo, tipo === "checkbox" ? false : "");
}

/* Valor "cru" equivalente ao zerado — o que a tela deve passar a mostrar.
   Espelha o distratoZerar_, mas no formato do resolver_ (que é o que o site
   consome), em vez do formato de escrita da API do Notion. */
function distratoValorCru_(tipo, opcaoNao) {
  if (tipo === "files" || tipo === "multi_select") return [];
  if (tipo === "select" || tipo === "status") return opcaoNao || null;
  if (tipo === "checkbox") return false;
  if (tipo === "number" || tipo === "date" || tipo === "url" ||
      tipo === "email" || tipo === "phone_number") return null;
  return "";
}

/* Monta o plano do distrato: o que limpar e o que manter.
   Separado da execução justamente pra permitir o modo simulação. */
function distratoPlano_(pageId) {
  var pg = notion_("GET", "/pages/" + pageId, null);
  var db = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null);
  var schema = db.properties || {};

  var props = {}, limpar = [], manter = [], ignorar = [], zerados = {};
  for (var nome in (pg.properties || {})) {
    if (distratoMantido_(nome)) { manter.push(nome); continue; }
    var tipo = pg.properties[nome].type;
    var opcaoNao = distratoOpcaoNao_(schema[nome]);
    var z = distratoZerar_(tipo, opcaoNao);
    if (!z) { ignorar.push(nome + " (" + tipo + ")"); continue; }
    props[nome] = z;
    limpar.push(nome);
    /* O valor "cru" que a coluna passa a ter, no mesmo formato que o site usa
       para exibir. Serve para a tela mostrar o resultado do distrato NA HORA,
       sem esperar a próxima publicação do dist/vendas.json (que só sai no
       próximo build). Sem isto, quem dava distrato via a obra intacta na
       planilha e achava que não tinha funcionado. */
    zerados[nome] = distratoValorCru_(tipo, opcaoNao);
  }
  return { pagina: pg, props: props, limpar: limpar, manter: manter,
           ignorar: ignorar, zerados: zerados };
}

function distrato_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };

  // MASTER não apaga nada do banco — distrato limpa a obra e arquiva atividades
  if (ehMaster_(sess)) return { ok: false, erro: "SEM_PERMISSAO" };
  // TESTES também não (já barrado no handle_ por ACOES_ESCRITA; fica aqui
  // como segunda camada, caso alguém chame a função direto do editor)
  if (ehTestes_(sess)) return { ok: false, erro: "MODO_TESTE" };

  // 1) permissão por tipo/acesso — mesma lógica do resto do backend
  var acessos = sess.a || [];
  if (!ehAdm_(sess) && acessos.indexOf("VENDAS") < 0) return { ok: false, erro: "SEM_PERMISSAO" };

  // 2) trava opcional por login
  if (LOGINS_DISTRATO.length) {
    var eu = String(sess.u || "").toLowerCase();
    var liberado = false;
    for (var j = 0; j < LOGINS_DISTRATO.length; j++) {
      if (String(LOGINS_DISTRATO[j]).toLowerCase() === eu) { liberado = true; break; }
    }
    if (!liberado) return { ok: false, erro: "SEM_PERMISSAO" };
  }

  // 3) senha do próprio usuário logado. Isto NÃO é autorização — é
  //    reautenticação: vale contra tela logada deixada aberta, não contra
  //    quem sabe a senha. Reaproveita o verificaSenha_, que já entende o
  //    formato sha256$salt$hex e o legado em texto puro.
  var chaveFalha = "dist_" + String(sess.u || "").toLowerCase();
  if (tentativas_(chaveFalha) >= CONFIG.MAX_TENTATIVAS) return { ok: false, erro: "BLOQUEADO" };

  var achou = false;
  var rows = queryAll_(CONFIG.DB.LOGINS, {});
  for (var i = 0; i < rows.length; i++) {
    var lg = titulo_(rows[i].properties["LOGIN"]);
    if (lg && lg.toLowerCase() === String(sess.u || "").toLowerCase()) {
      achou = true;
      if (!verificaSenha_(String(p.senha || ""), String(texto_(rows[i].properties["SENHA"])))) {
        registrarFalha_(chaveFalha);
        return { ok: false, erro: "SENHA_INVALIDA" };
      }
      break;
    }
  }
  if (!achou) return { ok: false, erro: "SEM_PERMISSAO" };
  limparFalhas_(chaveFalha);

  // 4) plano + fotografia do estado atual ANTES de mexer. Sem isto o distrato
  //    é irreversível de verdade; com isto dá pra reconstruir a obra pelo log
  //    (menu lateral > Execuções).
  //    CORREÇÃO DE PRIVACIDADE: antes isto gravava resolver_() INTEIRO no log,
  //    ou seja, nome do cliente, CPF, telefone e e-mail iam parar no histórico
  //    de execuções do Apps Script — que fica guardado e é visível a quem
  //    tiver acesso ao projeto. Agora as colunas sensíveis entram como
  //    "(preenchido)": continua dando pra saber O QUE tinha valor (que é o que
  //    serve pra reconstruir), sem copiar o dado pessoal pro log.
  var plano = distratoPlano_(p.pageId);
  var antes = resolver_(plano.pagina.properties);
  var antesLog = {};
  for (var nomeCol in antes) {
    antesLog[nomeCol] = logSensivel_(nomeCol) ? (antes[nomeCol] ? "(preenchido)" : null) : antes[nomeCol];
  }
  console.log("DISTRATO por " + sess.u + " em " + p.pageId +
              " | endereço: " + (antes["ENDEREÇO"] || "?") +
              " | ANTES: " + JSON.stringify(antesLog));

  // 5) limpa
  if (plano.limpar.length) {
    notion_("PATCH", "/pages/" + p.pageId, { properties: plano.props });
  }

  // 6) manda as atividades desta obra pra lixeira.
  //    A relação chama "OBRA" no banco ATIVIDADES_VENDAS (a mesma usada em
  //    atividades_ e baixa_). "in_trash" + "archived" pelo mesmo motivo do
  //    excluirVenda_: a API renomeou o campo e as duas versões coexistem.
  var apagadas = 0;
  var atvs = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {
    filter: { property: "OBRA", relation: { contains: p.pageId } }
  });
  atvs.forEach(function (a) {
    notion_("PATCH", "/pages/" + a.id, { in_trash: true, archived: true });
    apagadas++;
  });

  // 7) os KPIs em cache ficariam velhos por até 10 min contando uma venda
  //    que não existe mais
  try { _cache_().remove("kpi_portal"); } catch (e) {}

  return {
    ok: true,
    camposLimpos: plano.limpar.length,
    atividadesApagadas: apagadas,
    mantidos: plano.manter,
    limpos: plano.limpar,
    /* {coluna: valorNovo} — a tela grava isto como edição local e repinta na
       hora (ver confirmarDistrato no vendas.html). */
    zerados: plano.zerados
  };
}

/* Teste sem risco: cole o id de uma obra, selecione esta função no editor e
 * clique em Executar. NÃO altera nada — só escreve no log o que aconteceria.
 * O id sai da URL da página no Notion (os 32 caracteres depois do "-"). */
function testeDistratoSimulado() {
  var PAGE_ID = "COLE_AQUI_O_ID_DA_OBRA";

  if (PAGE_ID.indexOf("COLE_AQUI") === 0) { Logger.log("Preencha o PAGE_ID primeiro."); return; }
  var plano = distratoPlano_(PAGE_ID);
  Logger.log("MANTIDOS (" + plano.manter.length + "): " + plano.manter.join(" | "));
  Logger.log("SERIAM LIMPOS (" + plano.limpar.length + "): " + plano.limpar.join(" | "));
  Logger.log("IGNORADOS por não serem editáveis (" + plano.ignorar.length + "): " + plano.ignorar.join(" | "));

  var atvs = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {
    filter: { property: "OBRA", relation: { contains: PAGE_ID } }
  });
  Logger.log("ATIVIDADES que iriam pra lixeira: " + atvs.length);

  Logger.log("Confira se algum nome em SERIAM LIMPOS deveria estar em MANTIDOS " +
             "— se sim, acrescente o nome exato na lista DISTRATO_MANTIDOS.");
}

/* ===================== UPLOAD DE ARQUIVO (Notion File Upload API) ===================== */
function upload_(sess, p) {
  var pageId = p.pageId, prop = p.prop, filename = p.filename || "arquivo";
  var mime = p.mimeType || "application/octet-stream", b64 = p.dataBase64;
  if (!pageId || !prop || !b64) return { ok: false, erro: "FALTA_PARAM" };

  // 1) inicia o upload
  var fu = notion_("POST", "/file_uploads", { filename: filename, content_type: mime });
  var uploadUrl = fu.upload_url, fuId = fu.id;

  // 2) envia os bytes (multipart) para a upload_url
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, filename);
  var r = UrlFetchApp.fetch(uploadUrl, {
    method: "post", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + CONFIG.NOTION_TOKEN, "Notion-Version": CONFIG.NOTION_VERSION },
    payload: { file: blob }
  });
  if (r.getResponseCode() >= 300)
    return { ok: false, erro: "UPLOAD_FALHOU: " + r.getContentText().slice(0, 250) };

  // 3) anexa ao campo files (mantém os arquivos que já existiam)
  var pg = notion_("GET", "/pages/" + pageId, null);
  var atuais = ((pg.properties[prop] && pg.properties[prop].files) || []).map(function (f) {
    if (f.type === "external") return { type: "external", name: f.name, external: f.external };
    return { type: "file_upload", name: f.name, file_upload: { id: (f.file_upload && f.file_upload.id) } };
  }).filter(function (f) { return f.external || (f.file_upload && f.file_upload.id); });
  atuais.push({ type: "file_upload", name: filename, file_upload: { id: fuId } });

  var props = {}; props[prop] = { files: atuais };
  notion_("PATCH", "/pages/" + pageId, { properties: props });
  return { ok: true };
}

/* Anexar arquivo pelo site de LIGAÇÕES.
 * O envio em si é o mesmo upload_() que o sistema de Vendas já usa (API de
 * File Upload do Notion, em três passos). O que muda aqui é a TRAVA: só as
 * colunas desta lista podem receber arquivo por esta ação — sem isso, quem
 * soubesse chamar a URL poderia despejar arquivo em qualquer coluna de
 * qualquer página do workspace. */
var LIG_ANEXAVEIS = ["NF MEDIDOR"];
function ligAnexar_(sess, p) {
  if (!p.pageId || !p.prop || !p.dataBase64) return { ok: false, erro: "FALTA_PARAM" };
  var alvo = normDist_(p.prop), liberado = false;
  for (var i = 0; i < LIG_ANEXAVEIS.length; i++) {
    if (normDist_(LIG_ANEXAVEIS[i]) === alvo) { liberado = true; break; }
  }
  if (!liberado) return { ok: false, erro: "CAMPO_NAO_LIBERADO: " + p.prop };
  console.log("LIGAÇÕES: " + sess.u + " anexou \"" + (p.filename || "") + "\" em " +
              p.prop + " / " + p.pageId);
  return upload_(sess, p);
}

/* Pessoas que podem entrar no RESPONSÁVEL das ligações.
 * O site precisa do ID do usuário para gravar (coluna do tipo Pessoa não
 * aceita nome em texto). Duas fontes, somadas:
 *   1) /v1/users — a lista do workspace. Depende da permissão "ler informações
 *      de usuário" na integração; em muitos workspaces ela vem vazia, e tudo
 *      bem: a fonte 2 cobre.
 *   2) quem JÁ está preenchido como responsável em alguma linha da base —
 *      dali sai nome e id juntos. Ou seja: para alguém novo aparecer na lista,
 *      basta colocá-lo como responsável de uma linha, uma vez, pelo Notion.
 * Cache de 1 hora: quadro de gente muda pouco. */
function ligResponsaveis_(sess, p) {
  return comCache_("lig_responsaveis", 3600, function () {
    var porId = {};

    try {
      var cursor = null, voltas = 0;
      do {
        var qs = "page_size=100" + (cursor ? ("&start_cursor=" + encodeURIComponent(cursor)) : "");
        var r = notion_("GET", "/users?" + qs, null);
        (r.results || []).forEach(function (u) {
          if (u.type === "bot" || !u.id || !u.name) return;
          porId[u.id] = u.name;
        });
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor && ++voltas < 10);
    } catch (e) { /* sem permissão de ler usuários: segue para a fonte 2 */ }

    try {
      var linhas = queryAll_(CONFIG.DB.LIGACOES, {});
      linhas.forEach(function (pg) {
        var props = pg.properties || {};
        for (var nome in props) {
          var prop = props[nome];
          if (!prop || prop.type !== "people") continue;
          (prop.people || []).forEach(function (u) {
            if (u.id && u.name && !porId[u.id]) porId[u.id] = u.name;
          });
        }
      });
    } catch (e) { /* base fora do ar: devolve o que tiver */ }

    var lista = [];
    for (var id in porId) lista.push({ id: id, nome: porId[id] });
    lista.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); });
    return { ok: true, responsaveis: lista };
  });
}

/* ===================== COMENTÁRIOS (item 3) =====================
 * Lê e escreve nos comentários nativos do Notion (a mesma caixa de
 * discussão que aparece no topo da página, no Notion de verdade) — pra
 * quem abre a obra pelo site conseguir ver e participar sem precisar abrir
 * o Notion.
 *
 * PRÉ-REQUISITO NO NOTION (uma vez só, fora daqui):
 *   Notion > Configurações > Minhas integrações > [sua integração] >
 *   Capacidades > marcar "Read comments" e "Insert comments". Sem isso a
 *   API devolve 403 mesmo com o token certo.
 *
 * ATRIBUIÇÃO: comentário criado por uma integração aparece no Notion como
 * sendo da própria integração (não dá pra "logar como" o usuário real via
 * API pública). Por isso todo comentário que sai daqui carrega o nome de
 * quem escreveu no começo do texto ("[Fulano] mensagem") — funciona tanto
 * pra quem olha pelo site quanto por quem abre a página direto no Notion.
 *
 * THREAD ÚNICA: a primeira pessoa a comentar cria uma discussão nova; os
 * comentários seguintes da MESMA obra entram nessa mesma discussão (via
 * discussion_id), pra parecer um chat contínuo em vez de vários tópicos
 * soltos.
 * =================================================================== */
function comentarios_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  var out = [], cursor = null, paginas = 0;
  do {
    var qs = "block_id=" + encodeURIComponent(p.pageId) + "&page_size=100" +
      (cursor ? ("&start_cursor=" + encodeURIComponent(cursor)) : "");
    var r = notion_("GET", "/comments?" + qs, null);
    out = out.concat(r.results || []);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++paginas < 20);

  var lista = out.map(function (c) {
    return {
      id: c.id,
      discussionId: c.discussion_id,
      texto: (c.rich_text || []).map(function (t) { return t.plain_text || ""; }).join(""),
      criadoEm: c.created_time,
      autorId: c.created_by && c.created_by.id
    };
  }).sort(function (a, b) { return new Date(a.criadoEm) - new Date(b.criadoEm); });

  return { ok: true, total: lista.length, comentarios: lista };
}

function comentarioNovo_(sess, p) {
  if (!p.pageId || !p.texto) return { ok: false, erro: "FALTA_PARAM" };
  var texto = String(p.texto).slice(0, 1900); // Notion limita o tamanho de cada rich_text
  var autor = sess.n || sess.u || "Portal";
  var conteudo = "[" + autor + "] " + texto;

  var body;
  if (p.discussionId) {
    body = { discussion_id: p.discussionId, rich_text: [{ text: { content: conteudo } }] };
  } else {
    // procura uma discussão já existente na página, pra continuar a MESMA
    // conversa em vez de abrir um tópico novo a cada comentário
    var existentes = notion_("GET", "/comments?block_id=" + encodeURIComponent(p.pageId) + "&page_size=1", null);
    var disc = (existentes.results && existentes.results[0] && existentes.results[0].discussion_id) || null;
    body = disc
      ? { discussion_id: disc, rich_text: [{ text: { content: conteudo } }] }
      : { parent: { page_id: p.pageId }, rich_text: [{ text: { content: conteudo } }] };
  }
  var c = notion_("POST", "/comments", body);
  return { ok: true, id: c.id, discussionId: c.discussion_id };
}

/* ===================== SETORES (para navegação do site de vendas) =====================
 * NOTA: o front-end atual (vendas.html) tem os setores fixos em JS
 * (SETORES_AREA), não chama esta ação. Deixei corrigida e disponível — se
 * quiser que os cards de setor venham do Notion (base DISPONIBILIDADES) em
 * vez de fixos no código, é só o front-end passar a chamar "setores" no boot. */
function setores_(sess) {
  var rows = queryAll_(CONFIG.DB.DISPONIBILIDADES, {});
  var lista = rows.map(function (r) {
    var pr = r.properties;
    return { setor: sel_(pr["SETOR"]), link: url_(pr["LINK"]), cidade: sel_(pr["CIDADE"]) };
  }).filter(function (x) { return x.setor; });
  return { ok: true, setores: lista };
}

/* ===================== DOCUMENTOS (obra iniciada / habite-se p/ contadores) =====
 * NOTA: hoje quem publica esses dados pro site é o fetch_vendas.py (GitHub
 * Actions), direto do Notion, sem passar por aqui — mesmo motivo do "portal_"
 * acima. Deixei corrigida e disponível como fallback/outro consumidor. */
function documentosSchema_(sess) { return comCache_("documentos_schema", 1800, _documentosSchemaCalc_); } // 30 min
function _documentosSchemaCalc_() {
  var db = notion_("GET", "/databases/" + CONFIG.DB.DOCUMENTOS, null);
  var props = db.properties || {};
  var campos = [];
  for (var nome in props) {
    var t = props[nome].type;
    var c = { nome: nome, tipo: t };
    if (t === "select" || t === "status" || t === "multi_select")
      c.opcoes = (props[nome][t].options || []).map(function (o) { return o.name; });
    campos.push(c);
  }
  return { ok: true, campos: campos };
}
function documentos_(sess, p) {
  return comCache_("documentos_dados", 300, function () {  // 5 min — obra/habite-se muda pouco no dia a dia
    var rows = queryAll_(CONFIG.DB.DOCUMENTOS, {});
    var lista = rows.map(function (r) { return { id: r.id, valores: resolver_(r.properties) }; });
    return { ok: true, total: lista.length, documentos: lista };
  });
}

/* ===================== LIGAÇÕES DE ÁGUA E ENERGIA =====================
 * A LEITURA normal do site NÃO passa por aqui: o ligacoes.html lê o
 * dist/ligacoes.json publicado pelo fetch_vendas.py, que é muito mais
 * rápido (arquivo pronto, sem paginar o Notion ao vivo) e funciona offline.
 *
 * O que mora aqui é o que o arquivo estático não pode fazer:
 *   - "ligacao"   -> devolver as colunas SENSÍVEIS (CPF/CNPJ, nascimento) de
 *                    UMA linha. Elas ficam fora do dist/ de propósito: o
 *                    GitHub Pages serve aquele arquivo pra qualquer um que
 *                    saiba a URL, sem login. Aqui a sessão é conferida.
 *   - "ligUpdate" -> escrever no Notion.
 *   - "ligExcluir"-> arquivar uma linha (só ADM).
 *   - "ligacoes"  -> leitura ao vivo da base inteira. O site não usa hoje;
 *                    fica como reserva (e pra conferir dado na mão).
 *
 * A trava de acesso está no handle_ (ACOES_LIGACOES + "LIGAÇÕES").
 * =================================================================== */

/* Só estas colunas podem ser escritas pelo site. A mesma lista existe no
 * ligacoes.html — mas é ESTA que vale: esconder o campo no navegador não
 * impede ninguém de chamar a ação pelo DevTools.
 * Fórmula e rollup não entram: quem calcula é o Notion.
 * Nomes conferidos com o inspecionar_ligacoes.py — repare em
 * "Data de Ligação", que é a única em caixa mista. */
var LIG_EDITAVEIS = [
  "OBRA", "CONCESSIONÁRIA", "SISTEMA", "STATUS",
  "LIBERADO PARA SOLICITAÇÃO", "DATA DE LIBERAÇÃO",
  "FEZ A SOLICITAÇÃO?", "DATA DE SOLICITAÇÃO",
  // renomeadas no Notion em 24/08/2026 (a aprovação só existe na SANESC).
  // Os nomes antigos ficam na lista de propósito: se alguma base ainda
  // estiver com o nome velho, a escrita continua funcionando.
  "SOLICITAÇÃO SANESC APROVADA?", "DATA DA APROVAÇÃO SANESC",
  "SOLICITAÇÃO APROVADA?", "DATA DA APROVAÇÃO DA LIGAÇÃO",
  "Data de Ligação",
  "UC", "UC PREENCHIDA", "DATA DE PREENCHIMENTO UC",
  "VENCIMENTO", "LINK DE ACOMPANHAMENTO",
  "OBS. LIGAÇÕES", "OBS. CONTAS",
  // atribuição de responsável pela tela (rodada 4). É coluna do tipo Pessoa:
  // o site manda o ID do usuário, não o nome — ver ligResponsaveis_.
  "RESPONSÁVEL"
];
function ligEditavel_(nome) {
  var alvo = normDist_(nome);   // sem acento, sem caixa, sem espaço sobrando
  for (var i = 0; i < LIG_EDITAVEIS.length; i++) {
    if (normDist_(LIG_EDITAVEIS[i]) === alvo) return true;
  }
  return false;
}

/* Item 4 do pedido: OBRA (o endereço da linha), CONCESSIONÁRIA e RESPONSÁVEL
   mudam a IDENTIDADE da linha — trocar qualquer uma delas por engano faz a
   baixa cruzada de transferência casar com a casa errada. Só ADM.
   Observação: RESPONSÁVEL continua na LIG_EDITAVEIS, então o ADM grava
   normalmente; o que muda é que os demais perfis passam a receber
   APENAS_ADM em vez de gravar. */
var LIG_SO_ADM = ["OBRA", "CONCESSIONÁRIA", "RESPONSÁVEL"];
function ligSoAdm_(nome) {
  var alvo = normDist_(nome);
  for (var i = 0; i < LIG_SO_ADM.length; i++) {
    if (normDist_(LIG_SO_ADM[i]) === alvo) return true;
  }
  return false;
}

/* Item 5: arquivar a linha. ARQUIVAR, não apagar — no Notion dá pra
   restaurar pela lixeira em até 30 dias. O título vai pro log justamente pra
   você conseguir achar o que foi arquivado sem caçar na lixeira inteira. */
/* MELHORIAS item 6 (set/26): criar uma linha nova na base de LIGAÇÕES pela
 * própria tela, sem abrir o Notion.
 *
 * Só ADM, pelo mesmo motivo do ligExcluir_: uma linha a mais (ou com a obra
 * escrita diferente) desalinha a baixa cruzada de transferência e a liberação
 * automática do esgoto, que casam por TÍTULO EXATO da obra. Criar errado é
 * tão ruim quanto apagar errado.
 *
 * Nasce com o mínimo: OBRA (título) + CONCESSIONÁRIA + SISTEMA e STATUS
 * quando vierem. O resto a pessoa preenche na planilha, como em qualquer
 * outra linha. A CONCESSIONÁRIA é validada contra o schema ao vivo — sem
 * isso, um erro de digitação criaria uma opção nova no Notion e a linha
 * ficaria invisível pros índices (que comparam por nome normalizado).
 *
 * DUPLICATA: recusa se já existir linha com a MESMA obra e a MESMA
 * concessionária. É exatamente o par que o ligIndicePorObra_ usa pra casar,
 * então duas linhas iguais fariam a baixa cruzada escrever em ambas.
 */
function ligCriar_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  var obra = String(p.obra || "").trim();
  var conc = String(p.conc || "").trim();
  if (!obra || !conc) return { ok: false, erro: "FALTA_PARAM" };

  var db = notion_("GET", "/databases/" + CONFIG.DB.LIGACOES, null);
  var props = db.properties || {};

  // nome real da coluna de título (a base usa "OBRA", mas não fixo isso aqui)
  var colTitulo = null;
  for (var nome in props) if (props[nome].type === "title") { colTitulo = nome; break; }
  if (!colTitulo) return { ok: false, erro: "BASE_SEM_TITULO" };

  // CONCESSIONÁRIA precisa ser uma opção que existe de verdade
  var defConc = null, colConc = null;
  for (nome in props) if (normDist_(nome) === normDist_("CONCESSIONÁRIA")) { colConc = nome; defConc = props[nome]; break; }
  if (!defConc) return { ok: false, erro: "CAMPO_INEXISTENTE: CONCESSIONÁRIA" };
  var tConc = defConc.type;
  var opsConc = (defConc[tConc] && defConc[tConc].options) || [], concReal = null;
  for (var i = 0; i < opsConc.length; i++) {
    if (normDist_(opsConc[i].name) === normDist_(conc)) { concReal = opsConc[i].name; break; }
  }
  if (!concReal) return { ok: false, erro: "OPCAO_INEXISTENTE: " + conc };

  // já existe essa obra nessa concessionária?
  var jaTem = (ligIndicePorObra_()[normDist_(obra)] || []).some(function (l) {
    return l.conc === normDist_(concReal);
  });
  if (jaTem) return { ok: false, erro: "JA_EXISTE" };

  var novo = {};
  novo[colTitulo] = buildValue_("title", obra);
  novo[colConc] = buildValue_(tConc, concReal);

  // SISTEMA e STATUS são opcionais: só entram se vierem e se existirem mesmo
  [["SISTEMA", p.sistema], ["STATUS", p.status]].forEach(function (par) {
    var alvo = par[0], valor = String(par[1] || "").trim();
    if (!valor) return;
    for (var k in props) {
      if (normDist_(k) !== normDist_(alvo)) continue;
      var t = props[k].type;
      var ops = (props[k][t] && props[k][t].options) || [];
      for (var j = 0; j < ops.length; j++) {
        if (normDist_(ops[j].name) === normDist_(valor)) { novo[k] = buildValue_(t, ops[j].name); return; }
      }
    }
  });

  var pg = notion_("POST", "/pages", {
    parent: { database_id: CONFIG.DB.LIGACOES }, properties: novo
  });
  // os índices guardam a base antiga; sem limpar, a linha nova só apareceria
  // depois dos 5 min de cache — e a checagem de duplicata acima erraria
  try {
    _cache_().remove("lig_indice_obra");
    _cache_().remove("ligacoes_vivo");
    _cache_().remove("lig_sens");
  } catch (e) {}
  console.log("LIGAÇÕES: " + sess.u + " CRIOU linha " + obra + " (" + concReal + ") -> " + pg.id);
  return { ok: true, id: pg.id, obra: obra, conc: concReal };
}

function ligExcluir_(sess, p) {
  if (!ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM" };
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  var pg = notion_("GET", "/pages/" + p.pageId, null), titulo = "";
  for (var nome in (pg.properties || {})) {
    if (pg.properties[nome].type === "title") { titulo = titulo_(pg.properties[nome]); break; }
  }
  notion_("PATCH", "/pages/" + p.pageId, { in_trash: true, archived: true });
  console.log("LIGAÇÕES: " + sess.u + " ARQUIVOU " + p.pageId + " (" + titulo + ")");
  try {
    _cache_().remove("lig_indice_obra");
    _cache_().remove("ligacoes_vivo");
    _cache_().remove("lig_sens");
  } catch (e) {}
  return { ok: true, obra: titulo };
}

/* Leitura ao vivo da base inteira (cache de 5 min pra não martelar a API).
   Devolve TUDO, inclusive o que é sensível — por isso só chega aqui quem
   passou pela trava de acesso do handle_. */
function ligacoes_(sess, p) {
  return comCache_("ligacoes_vivo", 300, function () {
    var rows = queryAll_(CONFIG.DB.LIGACOES, {});
    var lista = rows.map(function (r) {
      return { id: r.id, valores: resolver_(r.properties) };
    });
    /* lidoEm = quando estes dados saíram do Notion DE VERDADE (fica dentro do
       cache, então uma resposta servida do cache carrega a hora original, não
       a hora do pedido). A tela usa isso pra decidir se uma edição local ainda
       vale: edição feita ANTES desta leitura já está no Notion, e o que veio
       de lá manda. Sem esta hora, a tela só descartava a edição local quando
       o valor batia — e quem alterasse a coluna direto no Notion, para um
       terceiro valor, ficava com a tela presa no valor antigo. */
    return { ok: true, total: lista.length, lidoEm: new Date().toISOString(), ligacoes: lista };
  });
}

/* Uma linha só, sem cache — é o que o botão "Ver dados sensíveis" chama.
   Sem cache de propósito: é pouca coisa e precisa refletir o Notion na hora.
   OBSERVAÇÃO: o resolver_() devolve a string "(rollup)" para colunas do tipo
   rollup, então "CPF/CNPJ V2" aparece assim em vez do número. "CPF/CNPJ"
   (que é fórmula, e já junta V1 e V2) vem certo, que é o que interessa na
   tela. Mexer no resolver_ mudaria o comportamento de todo o resto. */
function ligacao_(sess, p) {
  if (!p.pageId) return { ok: false, erro: "SEM_PAGINA" };
  var pg = notion_("GET", "/pages/" + p.pageId, null);
  console.log("LIGAÇÕES: " + sess.u + " abriu dados sensíveis de " + p.pageId);
  return { ok: true, id: pg.id, valores: resolver_(pg.properties) };
}

/* Escrita. Quatro travas, nesta ordem: coluna na lista branca, coluna
   restrita a ADM, tipo editável e (para select/status) valor que existe
   mesmo no schema — senão o Notion devolve 400 e o site só mostraria "erro"
   sem explicar o motivo. */
function ligUpdate_(sess, p) {
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  if (!ligEditavel_(p.prop)) return { ok: false, erro: "CAMPO_NAO_LIBERADO: " + p.prop };
  if (ligSoAdm_(p.prop) && !ehAdm_(sess)) return { ok: false, erro: "APENAS_ADM: " + p.prop };
  if (EDITAVEL_[p.tipo] !== true) return { ok: false, erro: "CAMPO_NAO_EDITAVEL: " + p.tipo };

  if ((p.tipo === "select" || p.tipo === "status") && p.valor) {
    var db = notion_("GET", "/databases/" + CONFIG.DB.LIGACOES, null);
    var def = (db.properties || {})[p.prop];
    var ops = (def && def[p.tipo] && def[p.tipo].options) || [];
    var existe = false;
    for (var i = 0; i < ops.length; i++) {
      if (normDist_(ops[i].name) === normDist_(p.valor)) { existe = true; break; }
    }
    if (!existe) return { ok: false, erro: "OPCAO_INEXISTENTE: " + p.valor };
  }

  var props = {};
  props[p.prop] = buildValue_(p.tipo, p.valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  console.log("LIGAÇÕES: " + sess.u + " gravou " + p.prop + " em " + p.pageId);

  /* Água da SANEAGO ligada -> libera a linha de esgoto da mesma casa.
     Roda depois da gravação (e relendo a página) porque as duas condições
     podem ter sido preenchidas em ordens diferentes: às vezes a data vem
     primeiro, às vezes o status. Relendo, tanto faz qual foi a última.
     Um erro aqui NÃO derruba a gravação principal — ela já aconteceu. */
  var esgoto = null;
  var alvo = normDist_(p.prop);
  if (alvo === "STATUS" || alvo.indexOf("DATA DE LIGACAO") >= 0) {
    try { esgoto = ligLiberarEsgoto_(sess, p.pageId); }
    catch (e) { esgoto = { ok: false, motivo: String(e).slice(0, 140) }; }
  }
  return { ok: true, esgoto: esgoto };
}

/* ===================== LIGAÇÕES: dados protegidos e atividades ==========
 * (rodada 2 — abas de acompanhamento e de controle de contas)
 *
 * As telas novas mostram CPF/CNPJ, data de nascimento, nome do cliente e
 * WhatsApp. Nada disso é publicado no dist/ (o GitHub Pages serve aquele
 * arquivo pra qualquer um que saiba a URL, SEM LOGIN). Então o site pede aqui,
 * onde a sessão é conferida, e guarda o resultado só na memória da aba.
 *
 * As duas ações devolvem a base inteira de uma vez, em vez de uma consulta por
 * linha: com ~700 linhas, uma consulta por linha estouraria o tempo do Apps
 * Script e ainda deixaria a tela travada.
 * =================================================================== */

/* Colunas protegidas de cada base — precisa bater com o CAMPOS_SENSIVEIS do
   fetch_vendas.py, que é quem decide o que FICA DE FORA do arquivo público.
   Se você acrescentar uma coluna sensível lá, acrescente aqui também, senão
   a tela mostra ••• pra sempre. */
var LIG_COLS_PROTEGIDAS = ["CPF/CNPJ", "CPF/CNPJ V1", "CPF/CNPJ V2", "DATA DE NASCIMENTO"];
var VENDAS_COLS_PROTEGIDAS = ["CLIENTES", "Nº Whatsapp", "CPF"];

function soProtegidas_(props, lista) {
  var todos = resolver_(props), out = {};
  for (var nome in todos) {
    for (var i = 0; i < lista.length; i++) {
      if (normDist_(nome) === normDist_(lista[i])) { out[nome] = todos[nome]; break; }
    }
  }
  return out;
}

function ligSensiveis_(sess, p) {
  console.log("LIGAÇÕES: " + sess.u + " carregou os dados protegidos das ligações");
  return comCache_("lig_sens", 300, function () {
    var rows = queryAll_(CONFIG.DB.LIGACOES, {});
    var mapa = {};
    rows.forEach(function (r) { mapa[r.id] = soProtegidas_(r.properties, LIG_COLS_PROTEGIDAS); });
    return { ok: true, total: rows.length, valores: mapa };
  });
}

function ligVendasSensiveis_(sess, p) {
  console.log("LIGAÇÕES: " + sess.u + " carregou cliente/WhatsApp das vendas");
  return comCache_("lig_sens_vendas", 300, function () {
    var rows = queryAll_(CONFIG.DB.VENDAS, {});
    var mapa = {};
    rows.forEach(function (r) { mapa[r.id] = soProtegidas_(r.properties, VENDAS_COLS_PROTEGIDAS); });
    return { ok: true, total: rows.length, valores: mapa };
  });
}

/* Atividades de TRANSFERÊNCIA ainda abertas, da pessoa responsável por elas.
   O filtro fica AQUI e não na tela: assim quem tem só o acesso LIGAÇÕES não
   consegue usar esta ação pra listar as atividades de outro setor. */
var LIG_ATIVIDADE_TIPO = "TRANSFERÊNCIA";
var LIG_ATIVIDADE_PESSOA = "Ana Paula";   // como está na coluna RESPONSÁVEL

function ligAtividades_(sess, p) {
  return comCache_("lig_atividades", 120, function () {
    var rows = queryAll_(CONFIG.DB.ATIVIDADES_VENDAS, {
      filter: { and: [
        { property: "ATIVIDADE FINALIZADA", formula: { string: { contains: "NÃO" } } }
      ]},
      sorts: [{ property: "DATA FINAL PREVISTA", direction: "ascending" }]
    });
    var lista = [];
    rows.forEach(function (r) {
      var pr = r.properties;
      if (normDist_(sel_(pr["TIPO"])) !== normDist_(LIG_ATIVIDADE_TIPO)) return;
      var resp = pessoas_(pr["RESPONSÁVEL"]);
      var daPessoa = false;
      for (var i = 0; i < resp.length; i++) {
        if (normDist_(resp[i]) === normDist_(LIG_ATIVIDADE_PESSOA)) { daPessoa = true; break; }
      }
      if (!daPessoa) return;
      var rel = (pr["OBRA"] && pr["OBRA"].relation) || [];
      lista.push({
        id: r.id,
        nome: titulo_(pr["Nome"]),
        dataInicial: dt_(pr["DATA INICIAL"]),
        dataFinal: dt_(pr["DATA FINAL PREVISTA"]),
        obraId: rel[0] ? rel[0].id : null
      });
    });
    return { ok: true, total: lista.length, atividades: lista };
  });
}

/* Baixa a partir da aba de ligações. É o mesmo mecanismo do baixa_ do setor
   de vendas (escreve a coluna da OBRA que corresponde ao TIPO), mas restrito
   a TRANSFERÊNCIA — este acesso não pode dar baixa em atividade de outro
   setor só porque descobriu o id dela. */
function ligBaixa_(sess, p) {
  if (!p.atividadeId) return { ok: false, erro: "SEM_ATIVIDADE" };
  var atv = notion_("GET", "/pages/" + p.atividadeId, null);
  var pr = atv.properties;
  var tipo = sel_(pr["TIPO"]);
  if (normDist_(tipo) !== normDist_(LIG_ATIVIDADE_TIPO)) {
    return { ok: false, erro: "TIPO_NAO_PERMITIDO: " + tipo };
  }
  var coluna = BAIXA_MAP[tipo];
  if (!coluna) return { ok: false, erro: "TIPO_SEM_MAPEAMENTO: " + tipo };
  var rel = (pr["OBRA"] && pr["OBRA"].relation) || [];
  if (!rel.length) return { ok: false, erro: "ATIVIDADE_SEM_OBRA" };

  var props = {}; props[coluna] = { select: { name: p.valor || "SIM" } };
  notion_("PATCH", "/pages/" + rel[0].id, { properties: props });
  // a lista fica 2 min em cache; sem limpar, a atividade baixada voltaria a
  // aparecer pra quem abrisse a aba logo depois
  try { _cache_().remove("lig_atividades"); } catch (e) {}
  console.log("LIGAÇÕES: " + sess.u + " deu baixa em " + p.atividadeId + " -> " + coluna);
  return { ok: true, coluna: coluna };
}

/* Escrita na base de VENDAS a partir da aba "Casas vendidas e não
 * transferidas". Lista branca CURTA de propósito: quem tem só o acesso
 * LIGAÇÕES pode marcar o que é do mundo das ligações (protocolo, transferência
 * de titularidade) e nada mais. Endereço, data do contrato e dados do cliente
 * NÃO entram — esses são do sistema de Vendas, e deixá-los aqui daria a este
 * acesso um caminho para reescrever a venda inteira.
 */
var LIG_VENDAS_EDITAVEIS = [
  "TEM PROTOCOLO DE TRANS. ÁGUA",
  "TEM PROTOCOLO DE TRANS. ENERGIA",
  "ENERGIA TRANSFERIDA",
  "AGUA TRANSFERIDA",
  "TITULARIDADES TRANSFERIDAS?"
];
function ligVendaEditavel_(nome) {
  var alvo = normDist_(nome);
  // A data de verificação das contas é preenchida por quem confere a conta,
  // então entra na lista. Comparação por PEDAÇO do nome de propósito: no
  // Notion ela está escrita "DATA DE ERIFICAÇÃO DAS CONTAS" (sem o V) e pode
  // ser corrigida a qualquer momento — as duas grafias casam aqui.
  if (alvo.indexOf("ERIFICA") >= 0 && alvo.indexOf("CONTA") >= 0) return true;
  for (var i = 0; i < LIG_VENDAS_EDITAVEIS.length; i++) {
    if (normDist_(LIG_VENDAS_EDITAVEIS[i]) === alvo) return true;
  }
  return false;
}

/* ---------- baixa cruzada: transferiu -> a LIGAÇÃO vira TRANSFERIDO ----------
 * Marcar ENERGIA TRANSFERIDA = SIM numa venda tem que refletir na linha de
 * ligação da EQUATORIAL daquela casa; ÁGUA TRANSFERIDA = SIM reflete na linha
 * da SANESC ou da SANEAGO. São bases diferentes, ligadas só pelo endereço.
 *
 * O casamento é pelo título da obra, montado como ENDEREÇO + " CS " + CASA —
 * o mesmo formato que a base de ligações usa ("TB 19 QD 51 LT 19 CS 2").
 * A comparação é EXATA (sem acento/caixa/espaço sobrando). De propósito: se
 * eu aceitasse casar só pelo endereço, uma venda da CS 1 daria baixa também
 * na CS 2 — baixa errada é pior do que baixa não dada. Quando não casa, a
 * ação avisa em vez de escrever em alguém.
 */
var LIG_CONC_ENERGIA = ["EQUATORIAL"];
var LIG_CONC_AGUA    = ["SANESC", "SANEAGO"];

/* Índice título-da-obra -> linhas de ligação. Cache curto: é uma varredura da
   base inteira, e a alternativa (consultar por obra a cada baixa) seria uma
   consulta por clique. */
function ligIndicePorObra_() {
  return comCache_("lig_indice_obra", 300, function () {
    var mapa = {};
    queryAll_(CONFIG.DB.LIGACOES, {}).forEach(function (r) {
      var titulo = "";
      for (var nome in r.properties) {
        if (r.properties[nome].type === "title") { titulo = titulo_(r.properties[nome]); break; }
      }
      if (!titulo) return;
      var chave = normDist_(titulo);
      var cc = sel_(getTol_(r.properties, "CONCESSIONÁRIA"));
      var ss = sel_(getTol_(r.properties, "SISTEMA"));
      (mapa[chave] = mapa[chave] || []).push({
        id: r.id,
        conc: normDist_(cc),
        status: normDist_(sel_(getTol_(r.properties, "STATUS"))),
        // usados pela liberação automática do esgoto (ver ligLiberarEsgoto_)
        esgoto: ligEhEsgoto_(cc, ss),
        liberado: normDist_(sel_(getTol_(r.properties, "LIBERADO PARA SOLICITAÇÃO")))
      });
    });
    return mapa;
  });
}

/* Título da obra a partir de uma página de VENDAS: ENDEREÇO + " CS " + CASA. */
function ligTituloDaVenda_(props) {
  var end = "";
  for (var nome in props) {
    if (props[nome].type === "title") { end = titulo_(props[nome]); break; }
  }
  var casa = numProp_(getTol_(props, "CASA"));
  if (casa === null || casa === undefined || casa === "") return end;
  return end + " CS " + casa;
}

function ligBaixaTransferencia_(sess, pageIdVenda, prop) {
  var alvo = normDist_(prop);
  var concs;
  if (alvo.indexOf("ENERGIA") >= 0) concs = LIG_CONC_ENERGIA;
  else if (alvo.indexOf("AGUA") >= 0) concs = LIG_CONC_AGUA;
  else return null;

  var pg = notion_("GET", "/pages/" + pageIdVenda, null);
  var titulo = ligTituloDaVenda_(pg.properties || {});
  if (!titulo) return { ok: false, motivo: "VENDA_SEM_ENDERECO" };

  var linhas = ligIndicePorObra_()[normDist_(titulo)] || [];
  var alvos = linhas.filter(function (l) {
    for (var i = 0; i < concs.length; i++) if (normDist_(concs[i]) === l.conc) return true;
    return false;
  });
  if (!alvos.length) {
    console.log("BAIXA CRUZADA sem correspondente: " + titulo + " (" + concs.join("/") + ")");
    return { ok: false, motivo: "SEM_LIGACAO_CORRESPONDENTE", obra: titulo };
  }

  var mudadas = 0;
  alvos.forEach(function (l) {
    if (l.status === "TRANSFERIDO") return;         // já está lá: não reescreve
    notion_("PATCH", "/pages/" + l.id, { properties: { "STATUS": { select: { name: "TRANSFERIDO" } } } });
    mudadas++;
    console.log("BAIXA CRUZADA por " + sess.u + ": " + titulo + " (" + l.conc + ") -> TRANSFERIDO");
  });
  // o índice guarda o status antigo; sem limpar, uma segunda baixa na mesma
  // obra acharia "NÃO LIGADO" de novo e reescreveria à toa
  if (mudadas) { try { _cache_().remove("lig_indice_obra"); } catch (e) {} }
  return { ok: true, obra: titulo, ligacoes: alvos.length, mudadas: mudadas };
}

/* ---------- SANEAGO ligou a água -> libera a linha de ESGOTO ----------
 * Regra do negócio: a ligação de esgoto da SANEAGO só pode ser solicitada
 * DEPOIS que a água daquela casa foi ligada. Então, quando a linha de água da
 * SANEAGO fica com STATUS = LIGADO **e** Data de Ligação preenchida, a linha
 * de esgoto da MESMA casa recebe automaticamente:
 *      LIBERADO PARA SOLICITAÇÃO = SIM
 *      DATA DE LIBERAÇÃO         = a Data de Ligação da água
 *
 * O casamento é pelo título da obra (ENDEREÇO + " CS " + CASA), igual à baixa
 * cruzada de transferência. Comparação EXATA: liberar a casa errada é pior do
 * que não liberar.
 *
 * COMO A LINHA DE ESGOTO É RECONHECIDA (confirmado por você):
 * é uma opção da própria coluna CONCESSIONÁRIA — o valor "SANEAGO ESGOTO".
 * A comparação ignora acento, caixa e espaço sobrando, então "Saneago Esgoto"
 * ou "SANEAGO  ESGOTO" também casam. Mantive um segundo caminho (SISTEMA
 * contendo "ESGOTO") só como rede de segurança, caso alguma linha antiga
 * esteja cadastrada do jeito velho.
 *
 * A linha de ÁGUA é a da SANEAGO que NÃO é de esgoto — ou seja,
 * CONCESSIONÁRIA = "SANEAGO" limpo. Isto importa: "SANEAGO ESGOTO" também
 * contém a palavra SANEAGO, e sem essa distinção a linha de esgoto tentaria
 * liberar a si mesma. */
function ligEhEsgoto_(conc, sistema) {
  var c = normDist_(conc), si = normDist_(sistema);
  if (c.indexOf("SANEAGO") >= 0 && c.indexOf("ESGOTO") >= 0) return true;   // "SANEAGO ESGOTO"
  if (c === "SANEAGO" && si.indexOf("ESGOTO") >= 0) return true;            // rede de segurança
  return false;
}

function ligLiberarEsgoto_(sess, pageIdAgua) {
  var pg = notion_("GET", "/pages/" + pageIdAgua, null);
  var props = pg.properties || {};

  // só a linha de ÁGUA da SANEAGO dispara
  var conc = sel_(getTol_(props, "CONCESSIONÁRIA"));
  var sist = sel_(getTol_(props, "SISTEMA"));
  if (normDist_(conc).indexOf("SANEAGO") < 0) return null;
  if (ligEhEsgoto_(conc, sist)) return null;

  // as DUAS condições têm que estar prontas
  var status = normDist_(sel_(getTol_(props, "STATUS")));
  var dataLig = dt_(getTol_(props, "Data de Ligação"));
  if (status !== "LIGADO" || !dataLig) {
    return { ok: false, motivo: "AGUA_AINDA_NAO_LIGADA" };
  }

  var titulo = "";
  for (var nome in props) {
    if (props[nome].type === "title") { titulo = titulo_(props[nome]); break; }
  }
  if (!titulo) return { ok: false, motivo: "LINHA_SEM_TITULO" };

  var linhas = ligIndicePorObra_()[normDist_(titulo)] || [];
  var esgoto = linhas.filter(function (l) { return l.esgoto; });
  if (!esgoto.length) {
    console.log("ESGOTO: sem linha de esgoto para " + titulo);
    return { ok: false, motivo: "SEM_LINHA_DE_ESGOTO", obra: titulo };
  }

  var mudadas = 0;
  esgoto.forEach(function (l) {
    if (l.liberado === "SIM") return;            // já liberada: não reescreve
    notion_("PATCH", "/pages/" + l.id, { properties: {
      "LIBERADO PARA SOLICITAÇÃO": { select: { name: "SIM" } },
      "DATA DE LIBERAÇÃO":         { date: { start: dataLig } }
    }});
    mudadas++;
    console.log("ESGOTO liberado por " + sess.u + ": " + titulo + " (data " + dataLig + ")");
  });
  if (mudadas) { try { _cache_().remove("lig_indice_obra"); _cache_().remove("ligacoes_vivo"); } catch (e) {} }
  return { ok: true, obra: titulo, linhas: esgoto.length, mudadas: mudadas, data: dataLig };
}

function ligVendaUpdate_(sess, p) {
  if (!p.pageId || !p.prop) return { ok: false, erro: "FALTA_PARAM" };
  if (!ligVendaEditavel_(p.prop)) return { ok: false, erro: "CAMPO_NAO_LIBERADO: " + p.prop };
  if (EDITAVEL_[p.tipo] !== true) return { ok: false, erro: "CAMPO_NAO_EDITAVEL: " + p.tipo };

  // valor de select tem que existir no schema, senão o Notion devolve 400 e a
  // tela só mostraria "erro" sem dizer o motivo
  if ((p.tipo === "select" || p.tipo === "status") && p.valor) {
    var db = notion_("GET", "/databases/" + CONFIG.DB.VENDAS, null);
    var def = (db.properties || {})[p.prop];
    var ops = (def && def[p.tipo] && def[p.tipo].options) || [];
    var existe = false;
    for (var i = 0; i < ops.length; i++) {
      if (normDist_(ops[i].name) === normDist_(p.valor)) { existe = true; break; }
    }
    if (!existe) return { ok: false, erro: "OPCAO_INEXISTENTE: " + p.valor };
  }

  var props = {};
  props[p.prop] = buildValue_(p.tipo, p.valor);
  notion_("PATCH", "/pages/" + p.pageId, { properties: props });
  console.log("LIGAÇÕES/VENDAS: " + sess.u + " gravou " + p.prop + " em " + p.pageId);

  // transferiu água/energia -> a linha de ligação da concessionária certa
  // passa a TRANSFERIDO (ver ligBaixaTransferencia_)
  var cruzada = null;
  if (normDist_(p.valor) === "SIM") {
    try { cruzada = ligBaixaTransferencia_(sess, p.pageId, p.prop); }
    catch (e) { cruzada = { ok: false, motivo: String(e).slice(0, 120) }; }
  }
  return { ok: true, cruzada: cruzada };
}

/* ===================== NOTION: fetch + helpers ===================== */
function notion_(method, path, body) {
  if (!CONFIG.NOTION_TOKEN) {
    throw "NOTION_TOKEN_NAO_CONFIGURADO: adicione a propriedade NOTION_TOKEN em " +
      "Extensões > Apps Script > Configurações do projeto > Propriedades do script.";
  }
  var opt = {
    method: method, muteHttpExceptions: true, contentType: "application/json",
    headers: { Authorization: "Bearer " + CONFIG.NOTION_TOKEN, "Notion-Version": CONFIG.NOTION_VERSION }
  };
  if (body) opt.payload = JSON.stringify(body);
  var r = UrlFetchApp.fetch("https://api.notion.com/v1" + path, opt);
  var code = r.getResponseCode(), data = {};
  try { data = JSON.parse(r.getContentText()); } catch (_) {}
  if (code >= 300) throw "Notion " + code + ": " + ((data && data.message) || r.getContentText()).toString().slice(0, 250);
  return data;
}

function queryAll_(dbId, body) {
  var out = [], cursor = null, paginas = 0;
  do {
    var b = {}; for (var k in body) b[k] = body[k];
    b.page_size = 100; if (cursor) b.start_cursor = cursor;
    var res = notion_("POST", "/databases/" + dbId + "/query", b);
    out = out.concat(res.results || []);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && ++paginas < 20);
  return out;
}

// ---- leitura de propriedades ----
function getTol_(props, nome) {   // acha a coluna tolerando espaços/caixa (ex.: "OBRA INCIADA ")
  if (props[nome] !== undefined) return props[nome];
  var alvo = nome.trim().toUpperCase();
  for (var k in props) if (k.trim().toUpperCase() === alvo) return props[k];
  return {};
}
function numProp_(p) { return (p && typeof p.number === "number") ? p.number : null; }
function titulo_(p) { return p && p.title ? p.title.map(function (c) { return c.plain_text; }).join("") : ""; }
function texto_(p)  { return p && p.rich_text ? p.rich_text.map(function (c) { return c.plain_text; }).join("") : ""; }
function sel_(p)    { return p && p.select ? p.select.name : (p && p.status ? p.status.name : null); }
function dt_(p)     { return p && p.date ? p.date.start : null; }
function url_(p)    { return p ? (p.url || null) : null; }
function pessoas_(p){ return p && p.people ? p.people.map(function (u) { return u.name || u.id; }) : []; }
// título de uma página sem saber o nome da coluna de título (varia por base:
// "Nome" em umas, "ENDEREÇO" em VENDAS, "OBRA" nas ligações)
function tituloDe_(props) {
  for (var nome in (props || {})) {
    if (props[nome].type === "title") return titulo_(props[nome]);
  }
  return "";
}

function resolver_(props) {
  var o = {};
  for (var nome in props) {
    var p = props[nome], t = p.type, v = p[t];
    switch (t) {
      case "title":        o[nome] = titulo_(p); break;
      case "rich_text":    o[nome] = texto_(p); break;
      case "select":
      case "status":       o[nome] = sel_(p); break;
      case "multi_select": o[nome] = (v || []).map(function (x) { return x.name; }); break;
      case "number":       o[nome] = v; break;
      case "date":         o[nome] = v ? v.start : null; break;
      case "checkbox":     o[nome] = v; break;
      case "url":
      case "email":
      case "phone_number": o[nome] = v; break;
      case "people":       o[nome] = (v || []).map(function (x) { return x.name || x.id; }); break;
      case "formula":      o[nome] = v ? v[v.type] : null; break;
      case "files":        o[nome] = (v || []).map(function (f) {
                             return { name: f.name, url: f.type === "external" ? f.external.url : (f.file ? f.file.url : null) };
                           }); break;
      case "rollup":       o[nome] = "(rollup)"; break;
      default:             o[nome] = null;
    }
  }
  return o;
}

// ---- montar valor para escrever ----
function buildValue_(tipo, valor) {
  switch (tipo) {
    case "title":     return { title: [{ text: { content: String(valor == null ? "" : valor) } }] };
    case "rich_text": return { rich_text: valor ? [{ text: { content: String(valor) } }] : [] };
    case "number":    return { number: (valor === "" || valor == null) ? null : Number(valor) };
    case "select":    return { select: valor ? { name: String(valor) } : null };
    case "status":    return { status: valor ? { name: String(valor) } : null };
    case "multi_select": return { multi_select: (valor || []).map(function (n) { return { name: n }; }) };
    case "date":      return { date: valor ? { start: valor } : null };
    case "checkbox":  return { checkbox: !!valor };
    case "url":       return { url: valor || null };
    case "email":     return { email: valor || null };
    case "phone_number": return { phone_number: valor || null };
    case "people":    return { people: (valor || []).map(function (id) { return { id: id }; }) };
    default:          return { rich_text: [{ text: { content: String(valor == null ? "" : valor) } }] };
  }
}
/* =====================================================================
 * r14 — ANDAMENTO POR EVENTO (Pós Obra)
 * ---------------------------------------------------------------------
 * COLE ESTE BLOCO NO FIM DO Code.gs, depois da última linha do arquivo.
 * Não precisa achar lugar certo: em JavaScript, declaração de função vale
 * no arquivo inteiro (hoisting), então uma função escrita aqui embaixo já
 * pode ser chamada por posObraAgenda_, que está lá em cima.
 *
 * ANDAMENTO DA SOLICITAÇÃO continua sendo o estado do CHAMADO INTEIRO — é
 * ele que decide se a obra está "PÓS OBRA EM ANDAMENTO". O que faltava era
 * o estado de CADA execução: sem isso, um chamado com duas remarcações
 * mandava a mesma etiqueta nas três marcações do calendário, e não dava
 * pra saber qual parte já tinha sido feita.
 *
 * Regra:
 *   DATA DO SERVIÇO      -> coluna que contenha ANDAMENTO + SERVIÇO
 *   DATA REMARCAÇÃO N    -> coluna que contenha ANDAMENTO + REMARCA + N
 *   qualquer outra data  -> ANDAMENTO DA SOLICITAÇÃO (comportamento antigo)
 *
 * A busca é por PEDAÇO do nome, igual ao posObraInfoDaColuna_, e pelo mesmo
 * motivo: fixar a grafia aqui faria criar ANDAMENTO DA REMARCAÇÃO 6 no
 * Notion quebrar a tela calado. Repare que "ANDAMENTO DA SOLICITAÇÃO",
 * depois de normalizado, NÃO contém "SERVICO" — é por isso que ela nunca é
 * confundida com "ANDAMENTO DO SERVIÇO".
 * =================================================================== */
function posObraAndamentoDaColuna_(pr, col) {
  var n = normDist_(col);
  var nivel = (String(col).match(/(\d+)\s*$/) || [])[1];
  var k, kn;

  if (n.indexOf("REMARCA") >= 0 && nivel) {
    for (k in pr) {
      kn = normDist_(k);
      if (kn.indexOf("ANDAMENTO") >= 0 && kn.indexOf("REMARCA") >= 0 &&
          kn.indexOf(nivel) >= 0) {
        return sel_(pr[k]);
      }
    }
    return null;   // a coluna daquele nível ainda não existe no Notion
  }

  if (n.indexOf("DATA") === 0 && n.indexOf("SERVICO") >= 0) {
    for (k in pr) {
      kn = normDist_(k);
      if (kn.indexOf("ANDAMENTO") >= 0 && kn.indexOf("SERVICO") >= 0 &&
          kn.indexOf("REMARCA") < 0) {
        return sel_(pr[k]);
      }
    }
    return null;
  }

  return sel_(getTol_(pr, "ANDAMENTO DA SOLICITAÇÃO"));
}

/* Conferência rápida do r14 — só LÊ, não grava nada.
 * Rode pelo menu Executar com esta função selecionada e olhe o Logger.
 * Ela responde três coisas:
 *   1) as colunas de andamento existem mesmo, e com que nome exato;
 *   2) o casamento data -> andamento está pegando a coluna certa;
 *   3) quantas marcações já saem com andamentoEvento preenchido.
 * Se a linha 2 mostrar "(null)" onde deveria ter valor, o nome da coluna no
 * Notion não bate com o esperado — me manda esta saída. */
function conferirAndamentoEvento() {
  var db = notion_("GET", "/databases/" + CONFIG.DB.ATIVIDADES_POS_OBRA, null);
  var props = db.properties || {};
  var achadas = [];
  for (var nome in props) {
    if (normDist_(nome).indexOf("ANDAMENTO") >= 0) {
      achadas.push('"' + nome + '" (' + props[nome].type + ')');
    }
  }
  Logger.log("1) Colunas de ANDAMENTO na base ATIVIDADES PÓS OBRA:");
  Logger.log("   " + (achadas.length ? achadas.join("  |  ") : "*** NENHUMA ENCONTRADA ***"));

  var linhas = queryAll_(CONFIG.DB.ATIVIDADES_POS_OBRA, {});
  var comEvento = 0, totalDatas = 0, exemplos = [];
  linhas.forEach(function (a) {
    var pr = a.properties;
    for (var col in pr) {
      if (pr[col].type !== "date" || !dt_(pr[col])) continue;
      totalDatas++;
      var and = posObraAndamentoDaColuna_(pr, col);
      if (and) comEvento++;
      if (exemplos.length < 8) {
        exemplos.push("   " + tituloDe_(pr) + "  |  " + col + "  ->  " + (and || "(null)"));
      }
    }
  });
  Logger.log("2) Amostra do casamento data -> andamento do evento:");
  exemplos.forEach(function (e) { Logger.log(e); });
  Logger.log("3) Das " + totalDatas + " datas preenchidas, " + comEvento +
             " já resolvem um andamento. Chamados na base: " + linhas.length + ".");
}

/* ===================================================================
 * ANÁLISES — Orçado x Realizado (proxy do Supabase)
 * -------------------------------------------------------------------
 * Tudo o que a página analise.html consome. Lê o Supabase do projeto
 * ORÇADO/REALIZADO. A service_role key NUNCA vai para o navegador: fica
 * nas Propriedades do Script (SUPABASE_URL / SUPABASE_SERVICE_KEY) e só
 * este backend a usa.
 *
 * PRÉ-REQUISITO (uma vez só): em Configurações do projeto > Propriedades
 * do script, criar:
 *     SUPABASE_URL         = https://mgxjmqanrpomvqkzulbe.supabase.co
 *     SUPABASE_SERVICE_KEY = (a service_role key — a mesma dos Secrets do
 *                             GitHub do repositório OR-ADO-REALIZADO)
 *
 * O roteador (handle_) e a lista de acesso (ACOES_ANALISE) já apontam pra
 * cá — ver os blocos correspondentes lá em cima. Acesso exigido no LOGINS:
 * a opção "ANÁLISES" na coluna ACESSOS.
 * =================================================================== */

/* Config do Supabase (lida das Propriedades do Script). */
function supaCfg_() {
  var url = prop_("SUPABASE_URL");
  var key = prop_("SUPABASE_SERVICE_KEY");
  if (!url || !key) {
    throw new Error("FALTA CONFIGURAR: Propriedades SUPABASE_URL e/ou SUPABASE_SERVICE_KEY");
  }
  return { url: url.replace(/\/+$/, ""), key: key };
}

/* Consulta genérica a uma view/tabela do Supabase via PostgREST.
 * caminho: nome da view + querystring (ex.: "vw_resumo_obra_atual?select=*").
 * Devolve o array já parseado. */
function supaGet_(caminho) {
  var cfg = supaCfg_();
  var resp = UrlFetchApp.fetch(cfg.url + "/rest/v1/" + caminho, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      "apikey": cfg.key,
      "Authorization": "Bearer " + cfg.key,
      "Accept": "application/json"
    }
  });
  var code = resp.getResponseCode();
  var texto = resp.getContentText();
  if (code >= 300) {
    throw new Error("Supabase HTTP " + code + ": " + texto.slice(0, 300));
  }
  return JSON.parse(texto);
}

/* KPIs gerais + rankings da aba principal. Uma chamada só, tudo mastigado. */
function analiseResumo_(sess, p) {
  var obras   = supaGet_("vw_resumo_obra_atual?select=*");
  var insumos = supaGet_("vw_insumo_consolidado?select=*");

  // Totais gerais
  var totOrc = 0, totReal = 0, nObras = obras.length, dataExtr = "";
  obras.forEach(function (o) {
    totOrc  += Number(o.total_orcado)    || 0;
    totReal += Number(o.total_realizado) || 0;
    if (o.data_extracao && o.data_extracao > dataExtr) dataExtr = o.data_extracao;
  });
  var difTot = totReal - totOrc;
  var difPct = totOrc ? (difTot / totOrc * 100) : 0;

  // Enriquece cada insumo com diferença % (a view já traz diferenca em R$)
  insumos.forEach(function (it) {
    var orc  = Number(it.total_orcado)    || 0;
    var real = Number(it.total_realizado) || 0;
    it.diferenca_pct = orc ? ((real - orc) / orc * 100) : null;
  });

  // Só insumos com orçado > 0 (sem base de comparação não faz sentido rankear)
  var comBase = insumos.filter(function (it) {
    return (Number(it.total_orcado) || 0) > 0;
  });

  // Maior discrepância = maior diferença % — Top 20 estouros (positivo)
  var topEstouro = comBase.slice().sort(function (a, b) {
    return (b.diferenca_pct || 0) - (a.diferenca_pct || 0);
  }).slice(0, 20);

  // Maior economia = diferença % mais negativa — Top 20
  var topEconomia = comBase.slice().sort(function (a, b) {
    return (a.diferenca_pct || 0) - (b.diferenca_pct || 0);
  }).slice(0, 20);

  // Mais exatos = |diferença %| mais perto de zero — Top 20
  var maisExatos = comBase.slice().sort(function (a, b) {
    return Math.abs(a.diferenca_pct || 0) - Math.abs(b.diferenca_pct || 0);
  }).slice(0, 20);

  // Maior impacto em R$ (independe de %): onde o dinheiro realmente foge
  var maiorImpacto = insumos.slice().sort(function (a, b) {
    return Math.abs(Number(b.diferenca) || 0) - Math.abs(Number(a.diferenca) || 0);
  }).slice(0, 20);

  return {
    ok: true,
    data_extracao: dataExtr,
    kpis: {
      obras: nObras,
      total_orcado: totOrc,
      total_realizado: totReal,
      diferenca: difTot,
      diferenca_pct: difPct,
      itens_distintos: insumos.length
    },
    top_estouro: topEstouro,
    top_economia: topEconomia,
    mais_exatos: maisExatos,
    maior_impacto: maiorImpacto
  };
}

/* Uma linha por obra — alimenta o seletor de obras e a tabela "por obra". */
function analiseObras_(sess, p) {
  var obras = supaGet_("vw_resumo_obra_atual?select=*&order=obra_nome.asc");
  return { ok: true, obras: obras };
}

/* Consolidado por insumo (todas as obras) — tabela completa filtrável. */
function analiseInsumos_(sess, p) {
  var insumos = supaGet_("vw_insumo_consolidado?select=*");
  insumos.forEach(function (it) {
    var orc  = Number(it.total_orcado)    || 0;
    var real = Number(it.total_realizado) || 0;
    it.diferenca_pct = orc ? ((real - orc) / orc * 100) : null;
  });
  return { ok: true, insumos: insumos };
}

/* Insumos de UMA obra ou de um GRUPO de obras (seleção livre no front).
 * Recebe p.obra_ids = "id1,id2,id3". Devolve as linhas cruas das obras
 * pedidas; o front soma/agrega por insumo. */
/* Quais OBRAS usam um insumo (MELHORIAS #6, set/26).
 * O consolidado (vw_insumo_consolidado) so traz o total somado — nao diz de
 * onde veio. A quebra por obra existe na vw_insumos_atual, que e a mesma
 * usada pelo detalhe da obra; aqui ela e consultada no sentido inverso:
 * filtrando por insumo em vez de por obra.
 *
 * O nome do insumo vai como filtro exato (eq). Nomes com virgula ou aspas
 * quebram a sintaxe do PostgREST se forem crus, por isso o valor vai entre
 * aspas duplas e encodado. */
function analiseInsumoObras_(sess, p) {
  var insumo = String(p.insumo || "").trim();
  if (!insumo) return { ok: false, erro: "SEM_INSUMO" };

  var campos = "obra_nome,insumo,unidade,qtd_orcada,qtd_realizada,ct_orcado,ct_realizado";

  /* CORREÇÃO (set/26): a primeira versão usava só "eq." com o nome entre
     aspas e voltava VAZIO para insumos que existem (ex.: "AREIA - Grossa").
     O motivo é que o nome no consolidado nem sempre bate caractere a
     caractere com o da vw_insumos_atual — sobra espaço, muda a caixa, ou o
     travessão é outro. Em vez de assumir, tenta três estratégias, da mais
     estrita para a mais frouxa, e para na primeira que devolver algo:
       1) eq       -> igual exato
       2) ilike    -> igual ignorando maiúscula/minúscula
       3) ilike *..* -> contém (pega espaço sobrando e sufixo)
     "estrategia" volta na resposta pra dar pra diagnosticar sem adivinhar. */
  function buscar_(filtro) {
    try { return supaGet_("vw_insumos_atual?select=" + campos + "&" + filtro + "&order=obra_nome.asc"); }
    catch (e) { return []; }
  }
  // PostgREST: aspas duplas delimitam o valor; barra invertida escapa aspas
  // de dentro do nome. "*" é o coringa do ilike (não é "%" na querystring).
  var puro = insumo.replace(/"/g, '\\"');
  var q    = encodeURIComponent('"' + puro + '"');
  var qLike= encodeURIComponent('"*' + puro + '*"');

  var linhas = buscar_("insumo=eq." + q), estrategia = "exato";
  if (!linhas.length) { linhas = buscar_("insumo=ilike." + q);     estrategia = "sem-caixa"; }
  if (!linhas.length) { linhas = buscar_("insumo=ilike." + qLike); estrategia = "contem"; }
  if (!linhas.length) estrategia = "nao-encontrado";

  return { ok: true, insumo: insumo, estrategia: estrategia,
           total: linhas.length, obras: linhas };
}

function analiseDetalheObra_(sess, p) {
  var ids = String(p.obra_ids || "").split(",").map(function (s) {
    return s.trim();
  }).filter(Boolean);

  if (!ids.length) return { ok: false, erro: "SEM_OBRAS" };

  // PostgREST: obra_id=in.("id1","id2",...) — filtra a foto atual pelas obras dadas
  var lista = ids.map(function (id) { return '"' + id + '"'; }).join(",");
  var linhas = supaGet_(
    "vw_insumos_atual?select=obra_id,obra_nome,codigo,insumo,unidade," +
    "qtd_orcada,qtd_realizada,ct_orcado,ct_realizado,cu_orcado,cu_realizado" +
    "&obra_id=in.(" + encodeURIComponent(lista) + ")"
  );
  return { ok: true, linhas: linhas, obra_ids: ids };
}