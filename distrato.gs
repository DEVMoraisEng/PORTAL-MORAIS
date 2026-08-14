/**
 * DISTRATO — cole este bloco no fim do seu Code.gs e registre a action no
 * roteador do doPost (ex.: case "distrato": return json_(distrato_(p));).
 *
 * POR QUE ISTO MORA NO SERVIDOR
 * A senha e a lista de campos preservados NÃO podem ser decididas no navegador:
 * qualquer pessoa abre o DevTools e muda. O site só manda { pageId, senha } e
 * confia na resposta. Aqui é onde a regra vale.
 *
 * ANTES DE USAR, confira os três nomes marcados com >>> AJUSTE <<<:
 * o nome do banco de LOGIN, o da coluna de senha e o da relação que liga a
 * atividade à obra. Eles não aparecem no que eu recebi.
 */

// >>> AJUSTE <<< id do banco de LOGIN (o do print: LOGIN/PESSOA/SENHA/TIPO/ACESSOS)
var DB_LOGIN     = PropertiesService.getScriptProperties().getProperty("DB_LOGIN");
// >>> AJUSTE <<< id do banco de ATIVIDADES
var DB_ATIVIDADES = PropertiesService.getScriptProperties().getProperty("DB_ATIVIDADES");
// >>> AJUSTE <<< nome EXATO da coluna de relação Atividade -> Obra
var REL_OBRA = "OBRA";

/* Único lugar que decide o que sobrevive ao distrato.
   Comparação sem acento/caixa e tolerando espaço sobrando (a base tem "CPF "). */
var CAMPOS_MANTIDOS = [
  "ENDEREÇO", "CASA", "TIPO", "MODELO?", "REF",
  "SETOR", "CIDADE", "ENG. RESPONSÁVEL", "SITUAÇÃO"
];

function normProp_(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

function mantido_(nome) {
  var n = normProp_(nome);
  return CAMPOS_MANTIDOS.some(function (m) {
    var mn = normProp_(m);
    // prefixo tolerante: "SITUAÇÃO" mantém "SITUAÇÃO DO PROCESSO";
    // "ENG. RESPONSÁVEL" mantém o typo "ENG. RESPONSÁEL" da base
    return n === mn || n.indexOf(mn) === 0 || mn.indexOf(n) === 0;
  });
}

/** Valor "zerado" conforme o tipo. Select/status voltam para NÃO quando essa
 *  opção existe; se não existir, ficam vazios em vez de dar erro no Notion. */
function valorZerado_(prop, opcoesNao) {
  switch (prop.type) {
    case "title":        return { title: [] };
    case "rich_text":    return { rich_text: [] };
    case "number":       return { number: null };
    case "date":         return { date: null };
    case "checkbox":     return { checkbox: false };
    case "url":          return { url: null };
    case "email":        return { email: null };
    case "phone_number": return { phone_number: null };
    case "files":        return { files: [] };
    case "multi_select": return { multi_select: [] };
    case "people":       return { people: [] };
    case "relation":     return { relation: [] };
    case "select":       return { select: opcoesNao ? { name: opcoesNao } : null };
    case "status":       return { status: opcoesNao ? { name: opcoesNao } : null };
    default:             return null; // formula, rollup, created_time... não editáveis
  }
}

/** Acha a opção equivalente a "NÃO" no schema da coluna (aceita NAO, Não, No). */
function opcaoNao_(schemaProp) {
  var t = schemaProp && schemaProp.type;
  if (t !== "select" && t !== "status") return null;
  var ops = (schemaProp[t] && schemaProp[t].options) || [];
  for (var i = 0; i < ops.length; i++) {
    var n = normProp_(ops[i].name);
    if (n === "NAO" || n === "NO" || n === "NÃO") return ops[i].name;
  }
  return null;
}

/** Confere login + senha no banco de LOGIN e devolve o registro do usuário. */
function validarSenha_(login, senha) {
  var r = notionFetch_("POST", "/databases/" + DB_LOGIN + "/query", {
    filter: { property: "LOGIN", title: { equals: String(login) } },
    page_size: 2
  });
  var res = (r && r.results) || [];
  if (res.length !== 1) return null;         // login ausente ou duplicado: recusa
  var props = res[0].properties || {};
  // >>> AJUSTE <<< se a coluna SENHA não for rich_text, troque a leitura abaixo
  var arr = (props["SENHA"] && props["SENHA"].rich_text) || [];
  var guardada = arr.map(function (x) { return x.plain_text; }).join("");
  if (!guardada) return null;
  // comparação de tempo constante: evita descobrir a senha medindo o tempo de resposta
  if (guardada.length !== String(senha).length) return null;
  var dif = 0;
  for (var i = 0; i < guardada.length; i++) dif |= guardada.charCodeAt(i) ^ String(senha).charCodeAt(i);
  if (dif !== 0) return null;
  return res[0];
}

function distrato_(p) {
  // 1) sessão válida (mesma checagem das outras actions)
  var sess = verificarToken_(p.token);
  if (!sess) return { ok: false, erro: "NAO_AUTORIZADO" };

  // 2) permissão: ADM ou quem tem VENDAS em ACESSOS
  var acessos = sess.acessos || [];
  if (sess.tipo !== "ADM" && acessos.indexOf("VENDAS") < 0) {
    return { ok: false, erro: "SEM_PERMISSAO" };
  }

  // 3) senha, de novo — protege tela logada e deixada aberta
  if (!validarSenha_(sess.login, p.senha)) return { ok: false, erro: "SENHA_INVALIDA" };

  if (!p.pageId) return { ok: false, erro: "SEM_PAGEID" };

  // 4) fotografia do estado atual ANTES de limpar. Sem isto o distrato é
  //    irreversível de verdade; com isto dá pra reconstruir a obra pelo log.
  var pagina = notionFetch_("GET", "/pages/" + p.pageId);
  var schema = notionFetch_("GET", "/databases/" + DB_VENDAS);
  var antes = {};
  Object.keys(pagina.properties || {}).forEach(function (nome) {
    antes[nome] = pagina.properties[nome];
  });
  Logger.log("DISTRATO por " + sess.login + " em " + p.pageId + " :: " + JSON.stringify(antes));

  // 5) limpa tudo que não está na lista de mantidos
  var novos = {};
  Object.keys(pagina.properties || {}).forEach(function (nome) {
    if (mantido_(nome)) return;
    var prop = pagina.properties[nome];
    var sch = (schema.properties || {})[nome];
    var z = valorZerado_(prop, opcaoNao_(sch));
    if (z) novos[nome] = z;
  });
  if (Object.keys(novos).length) {
    notionFetch_("PATCH", "/pages/" + p.pageId, { properties: novos });
  }

  // 6) arquiva as atividades ligadas a esta obra
  var apagadas = 0;
  if (DB_ATIVIDADES) {
    var q = notionFetch_("POST", "/databases/" + DB_ATIVIDADES + "/query", {
      filter: { property: REL_OBRA, relation: { contains: p.pageId } },
      page_size: 100
    });
    ((q && q.results) || []).forEach(function (a) {
      notionFetch_("PATCH", "/pages/" + a.id, { archived: true });
      apagadas++;
    });
  }

  return { ok: true, camposLimpos: Object.keys(novos).length, atividadesApagadas: apagadas };
}
