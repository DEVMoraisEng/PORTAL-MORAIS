/* RegrasVenda — regras puras do dossiê do comprador (entrega 1).
 * Roda igual no Apps Script (arquivo RegrasVenda.gs do projeto PORTAL-VENDA)
 * e no node (testes em venda/testes). Sem rede, sem Notion, sem Claude.
 * Repositório público: nenhum dado real aqui nem nos testes. */
var RegrasVenda = (function () {
  "use strict";

  var COL = {
    TIPO_CASA: "TIPO DE CASA",
    C1_IDENT: "COMPRADOR 1 - IDENTIDADE",
    C1_COMPROV: "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO",
    C2_IDENT: "COMPRADOR 2 - IDENTIDADE",
    C2_COMPROV: "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO",
    APROVACAO: "APROVAÇÃO DA CAIXA",
    CLIENTES: "CLIENTES",
    CPF1: "CPF",
    C1_DOC: "COMPRADOR 1 - DOCUMENTO",
    C1_NAC: "COMPRADOR 1 - NACIONALIDADE",
    C1_ESTCIV: "COMPRADOR 1 - ESTADO CIVIL",
    C1_PROF: "COMPRADOR 1 - PROFISSÃO",
    C1_END: "COMPRADOR 1 - ENDEREÇO",
    C2_NOME: "COMPRADOR 2 - NOME",
    C2_CPF: "COMPRADOR 2 - CPF",
    C2_DOC: "COMPRADOR 2 - DOCUMENTO",
    C2_NAC: "COMPRADOR 2 - NACIONALIDADE",
    C2_ESTCIV: "COMPRADOR 2 - ESTADO CIVIL",
    C2_PROF: "COMPRADOR 2 - PROFISSÃO",
    C2_END: "COMPRADOR 2 - ENDEREÇO",
    C2_EMAIL: "COMPRADOR 2 - E-MAIL",
    C2_TEL: "COMPRADOR 2 - TELEFONE",
    FINANCIADO: "VALOR FINANCIADO",
    FGTS: "VALOR DO FGTS",
    SUBSIDIO: "VALOR DO SUBSÍDIO",
    DOSSIE: "DOSSIÊ",
    OBS: "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"
  };

  var TIPOS = {};
  Object.keys(COL).forEach(function (k) { TIPOS[COL[k]] = "rich_text"; });
  [COL.C1_IDENT, COL.C1_COMPROV, COL.C2_IDENT, COL.C2_COMPROV, COL.APROVACAO]
    .forEach(function (c) { TIPOS[c] = "files"; });
  [COL.TIPO_CASA, COL.DOSSIE].forEach(function (c) { TIPOS[c] = "select"; });
  [COL.FINANCIADO, COL.FGTS, COL.SUBSIDIO].forEach(function (c) { TIPOS[c] = "number"; });
  TIPOS[COL.C2_EMAIL] = "email";
  TIPOS[COL.C2_TEL] = "phone_number";

  var ESPACOS = {
    C1_IDENTIDADE:  { coluna: COL.C1_IDENT,   tipo: "identidade",  comprador: 1, rotulo: "Identidade do comprador 1", esperado: "uma identidade (CNH ou RG)" },
    C1_COMPROVANTE: { coluna: COL.C1_COMPROV, tipo: "comprovante", comprador: 1, rotulo: "Comprovante do comprador 1", esperado: "um comprovante de endereço" },
    C2_IDENTIDADE:  { coluna: COL.C2_IDENT,   tipo: "identidade",  comprador: 2, rotulo: "Identidade do comprador 2", esperado: "uma identidade (CNH ou RG)" },
    C2_COMPROVANTE: { coluna: COL.C2_COMPROV, tipo: "comprovante", comprador: 2, rotulo: "Comprovante do comprador 2", esperado: "um comprovante de endereço" },
    APROVACAO:      { coluna: COL.APROVACAO,  tipo: "aprovacao",   comprador: 0, rotulo: "Aprovação da Caixa",        esperado: "a aprovação da Caixa" }
  };

  /* Documentos do imóvel (entrega 11): matrícula, alvará e habite-se da casa. Colunas
     opcionais — se faltarem na base, só a seção "Documentos do imóvel" fica parada;
     o dossiê do comprador segue igual. As CONTRATO - * são as que o contrato já lê. */
  var COL_IMOVEL = {
    ARQ_MATRICULA: "IMÓVEL - MATRÍCULA",
    ARQ_ALVARA: "IMÓVEL - ALVARÁ",
    ARQ_HABITESE: "IMÓVEL - HABITE-SE",
    DOSSIE: "DOSSIÊ IMÓVEL",
    OBS: "DOSSIÊ IMÓVEL - OBSERVAÇÃO",
    MATRICULA_INDIVIDUAL: "CONTRATO - MATRÍCULA INDIVIDUAL",
    CRI: "CONTRATO - CRI DA MATRÍCULA",
    AREA: "CONTRATO - ÁREA DO LOTE (M²)",
    CONFRONTACOES: "CONTRATO - CONFRONTAÇÕES",
    ALVARA_NUMERO: "CONTRATO - ALVARÁ Nº",
    ALVARA_DATA: "CONTRATO - ALVARÁ DATA",
    HABITESE_NUMERO: "CONTRATO - HABITE-SE Nº",
    /* nos contratos de 2026 o registro do loteamento é de cada condominiozinho (2–3 casas): mora na casa */
    LOTEAMENTO_MATRICULA: "CONTRATO - MATRÍCULA DO LOTEAMENTO",
    LOTEAMENTO_CARTORIO: "CONTRATO - CARTÓRIO DO LOTEAMENTO"
  };
  /* entrega 13: colunas novas OPCIONAIS — se faltarem, a seção do imóvel segue igual à da entrega 11
     (sem o espaço da certidão mãe; a data do habite-se fica só na observação) */
  var COL_IMOVEL_OPC = {
    ARQ_CERTIDAO_MAE: "IMÓVEL - CERTIDÃO MÃE",
    HABITESE_DATA: "CONTRATO - HABITE-SE DATA",
    LOTEAMENTO_DENOMINACAO: "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO"
  };
  var TIPOS_IMOVEL_OPC = {};
  TIPOS_IMOVEL_OPC[COL_IMOVEL_OPC.ARQ_CERTIDAO_MAE] = "files";
  TIPOS_IMOVEL_OPC[COL_IMOVEL_OPC.HABITESE_DATA] = "date";
  TIPOS_IMOVEL_OPC[COL_IMOVEL_OPC.LOTEAMENTO_DENOMINACAO] = "rich_text";
  /* 05/11/2026 (dono: "o cadastro do vendedor SEMPRE tem que vir preenchido automático"): a qualificação do
     proprietário ATUAL lida da matrícula da casa. Colunas OPCIONAIS da VENDAS, uma a uma (sem elas a leitura da
     matrícula segue igual); o contrato (GerarContrato.ctrFontes_) completa o vendedor com elas. */
  var COL_VENDEDOR_MAT = {
    NOME: "VENDEDOR - NOME", CPF_CNPJ: "VENDEDOR - CPF/CNPJ", NACIONALIDADE: "VENDEDOR - NACIONALIDADE",
    ESTADO_CIVIL: "VENDEDOR - ESTADO CIVIL", PROFISSAO: "VENDEDOR - PROFISSÃO", RG: "VENDEDOR - RG",
    ENDERECO: "VENDEDOR - ENDEREÇO"
  };
  var TIPOS_VENDEDOR_MAT = {};
  Object.keys(COL_VENDEDOR_MAT).forEach(function (k) { TIPOS_VENDEDOR_MAT[COL_VENDEDOR_MAT[k]] = "rich_text"; });
  /* o proprietário da obra no Mais Controle (cliente da obra), copiado pelo robô diário dos documentos do Orçamento
     (robo_mc_documentos.py). Também opcionais; o contrato usa só para completar o que faltar. */
  var COL_VENDEDOR_MC = {
    NOME: "VENDEDOR MC - NOME", CPF_CNPJ: "VENDEDOR MC - CPF/CNPJ", ENDERECO: "VENDEDOR MC - ENDEREÇO",
    EMAIL: "VENDEDOR MC - E-MAIL"
  };
  /* robô diário dos documentos do Orçamento do MC: o que ele anexou e ninguém leu ainda (ids de espaço separados por
     vírgula; o portal passa para os "novos para ler" e limpa) e os arquivos do MC já vistos (JSON, para não repetir) */
  var COL_MC_DOCS = { NOVOS: "DOSSIÊ IMÓVEL - NOVOS DO MAIS CONTROLE", VISTOS: "MC - DOCUMENTOS DO ORÇAMENTO" };
  /* "IMOVEL_MATRICULA, IMOVEL_ALVARA" -> os ids de espaço do imóvel que valem, sem repetir, na ordem de leitura */
  function espacosDoTexto(s) {
    return ordenarEspacos(texto(s).split(/[,;\s]+/).filter(function (id) {
      return Object.prototype.hasOwnProperty.call(ESPACOS_IMOVEL, id);
    }));
  }
  var TIPOS_IMOVEL = {};
  Object.keys(COL_IMOVEL).forEach(function (k) { TIPOS_IMOVEL[COL_IMOVEL[k]] = "rich_text"; });
  [COL_IMOVEL.ARQ_MATRICULA, COL_IMOVEL.ARQ_ALVARA, COL_IMOVEL.ARQ_HABITESE]
    .forEach(function (c) { TIPOS_IMOVEL[c] = "files"; });
  TIPOS_IMOVEL[COL_IMOVEL.DOSSIE] = "select";
  TIPOS_IMOVEL[COL_IMOVEL.AREA] = "number";
  TIPOS_IMOVEL[COL_IMOVEL.ALVARA_DATA] = "date";

  var ESPACOS_IMOVEL = {
    IMOVEL_MATRICULA: { coluna: COL_IMOVEL.ARQ_MATRICULA, tipo: "matricula", grupo: "imovel", rotulo: "Matrícula do imóvel", esperado: "a certidão de matrícula do imóvel" },
    IMOVEL_ALVARA:    { coluna: COL_IMOVEL.ARQ_ALVARA,    tipo: "alvara",    grupo: "imovel", rotulo: "Alvará de construção", esperado: "o alvará de construção" },
    IMOVEL_HABITESE:  { coluna: COL_IMOVEL.ARQ_HABITESE,  tipo: "habitese",  grupo: "imovel", rotulo: "Habite-se",            esperado: "o habite-se" },
    /* entrega 13: certidão da matrícula-mãe do condomínio/loteamento (opcional) */
    IMOVEL_CERTIDAO_MAE: { coluna: COL_IMOVEL_OPC.ARQ_CERTIDAO_MAE, tipo: "certidao_mae", grupo: "imovel", rotulo: "Certidão mãe",
                           esperado: "a certidão da matrícula-mãe do condomínio ou loteamento" }
  };
  /* 05/11/2026: contrato de financiamento, anexado na aba Recebimentos da casa de rua (RecebimentoVenda.gs). Fora do
     dossiê (não entra em ESTADOS, ORDEM_LEITURA nem na leitura em lote): a leitura grava VALOR FINANCIADO, VALOR DO FGTS e
     VALOR DO SUBSÍDIO e o robô dos recebimentos acerta as parcelas no Mais Controle. */
  var COL_RECEB = { CONTRATO_FIN: "CONTRATO DE FINANCIAMENTO" };
  var ESPACOS_RECEB = {
    FIN_CONTRATO: { coluna: COL_RECEB.CONTRATO_FIN, tipo: "contrato_financiamento", grupo: "recebimento",
                    rotulo: "Contrato de financiamento", esperado: "o contrato de financiamento do banco" }
  };
  /* ordem em que as leituras de um lote são aplicadas: a identidade do comprador 1 antes da do 2
     (o CLIENTES junta os dois nomes) e a certidão mãe depois da matrícula (ver confrontações) */
  var ORDEM_LEITURA = ["C1_IDENTIDADE", "C2_IDENTIDADE", "C1_COMPROVANTE", "C2_COMPROVANTE", "APROVACAO",
                       "IMOVEL_MATRICULA", "IMOVEL_CERTIDAO_MAE", "IMOVEL_ALVARA", "IMOVEL_HABITESE"];
  function ordenarEspacos(ids) {
    return (ids || []).filter(function (id, i, l) { return !!espaco(id) && ORDEM_LEITURA.indexOf(id) >= 0 && l.indexOf(id) === i; })
      .sort(function (x, y) { return ORDEM_LEITURA.indexOf(x) - ORDEM_LEITURA.indexOf(y); });
  }
  /* espaços com arquivo anexado e ainda não lido: { espaço: "trocar" | "atualizar" }.
     "trocar" (o arquivo novo substituiu os anteriores) não volta a "atualizar" até a leitura. */
  function marcarPendente(pend, id, trocar) {
    pend[id] = trocar || pend[id] === "trocar" ? "trocar" : "atualizar";
    return pend;
  }
  /* os pendentes que ainda têm arquivo (alguém pode ter apagado no Notion), na ordem de leitura */
  function pendentesValidos(pend, arquivos) {
    return ordenarEspacos(Object.keys(pend || {})).filter(function (id) { return Number((arquivos || {})[id]) > 0; });
  }
  /* ---- "soltar todos os documentos": de que espaço é cada arquivo (entrega 13) ---- */
  var CLASSE_ESPACO = { APROVACAO: "APROVACAO", MATRICULA: "IMOVEL_MATRICULA", CERTIDAO_MAE: "IMOVEL_CERTIDAO_MAE",
                        ALVARA: "IMOVEL_ALVARA", HABITESE: "IMOVEL_HABITESE" };
  var PALAVRAS_FRACAS = ["DE", "DA", "DO", "DAS", "DOS", "E"];
  function tokensNome(s) {
    return chave(s).replace(/[^A-Z ]/g, " ").split(" ").filter(function (t) { return t.length > 1 && PALAVRAS_FRACAS.indexOf(t) < 0; });
  }
  /* mesmo primeiro nome e, se os dois têm sobrenome, ao menos um sobrenome em comum */
  function mesmaPessoa(a, b) {
    var x = tokensNome(a), y = tokensNome(b);
    if (!x.length || !y.length || x[0] !== y[0]) return false;
    var curto = x.length <= y.length ? x : y, longo = curto === x ? y : x;
    if (curto.length === 1) return true;
    return curto.slice(1).some(function (t) { return longo.indexOf(t, 1) >= 0; });
  }
  /* classificação da IA ({tipo_documento, nome, cpf}) + página → o que fazer com o arquivo:
     - documento do imóvel ou aprovação da Caixa: { espaco, tipo } — vai direto para o espaço;
     - identidade ou comprovante (documento de PESSOA): { espaco: null, tipo, pessoa: true, sugestao: "C1"|"C2"|"" } —
       regra do dono: a tela SEMPRE pergunta quem é o comprador 1 e o 2; a sugestão (CPF, depois nome, contra
       CPF / CLIENTES / COMPRADOR 2 - NOME) só vem pré-selecionada. Comprovante de quem não é nenhum dos dois
       (parente): sem sugestão;
     - outra coisa: { espaco: null, tipo: "OUTRO", motivo: "NAO_RECONHECIDO" } — a tela pergunta "isto é: …". */
  function decidirEspaco(leitura, atuais) {
    leitura = leitura || {}; atuais = atuais || {};
    var tipo = chave(leitura.tipo_documento);
    if (Object.prototype.hasOwnProperty.call(CLASSE_ESPACO, tipo)) return { espaco: CLASSE_ESPACO[tipo], tipo: tipo };
    if (tipo !== "IDENTIDADE" && tipo !== "COMPROVANTE") return { espaco: null, tipo: "OUTRO", motivo: "NAO_RECONHECIDO" };
    var cli = texto(atuais[COL.CLIENTES]).trim(), posE = cli.indexOf(" E ");
    var n1 = posE >= 0 ? cli.slice(0, posE) : cli;
    var n2 = texto(atuais[COL.C2_NOME]).trim() || (posE >= 0 ? cli.slice(posE + 3) : "");
    var c1 = soDigitos(atuais[COL.CPF1]), c2 = soDigitos(atuais[COL.C2_CPF]), cpf = soDigitos(leitura.cpf);
    var e1 = false, e2 = false;
    if (cpf.length === 11) { e1 = cpf === c1; e2 = cpf === c2; }
    if (!e1 && !e2 && !vazio(leitura.nome)) { e1 = mesmaPessoa(leitura.nome, n1); e2 = mesmaPessoa(leitura.nome, n2); }
    var sugestao = e1 && !e2 ? "C1" : e2 && !e1 ? "C2" : "";
    /* identidade sem nome nem CPF lidos (ex.: frente do RG só com a foto) numa venda de um comprador só */
    if (!sugestao && tipo === "COMPROVANTE") sugestao = "C1";   /* 05/11 (dono): no comprovante o nome não importa */
    if (!sugestao && tipo === "IDENTIDADE" && vazio(leitura.nome) && soDigitos(leitura.cpf).length !== 11 && !n2 && !c2 && posE < 0) sugestao = "C1";
    return { espaco: null, tipo: tipo, pessoa: true, sugestao: sugestao, motivo: "CONFIRMAR_COMPRADOR" };
  }
  /* pessoa escolhida na tela ("C1" | "C2") + tipo do documento → espaço */
  function espacoDaPessoa(quem, tipo) {
    if (quem !== "C1" && quem !== "C2") return null;
    var t = chave(tipo);
    return t === "IDENTIDADE" ? quem + "_IDENTIDADE" : t === "COMPROVANTE" ? quem + "_COMPROVANTE" : null;
  }

  /* identificação da casa para a IA achar ESTA unidade na certidão mãe (texto curto, numa linha) */
  function contextoUnidade(ctx) {
    ctx = ctx || {};
    var end = limpar(ctx.endereco).replace(/"/g, "'").slice(0, 200);
    var casa = limpar(ctx.casa).replace(/"/g, "'").slice(0, 80);
    if (!end && !casa) return "";
    return "A casa desta venda: endereço '" + end + "'" + (casa ? ", casa '" + casa + "'" : "") +
      ". Procure na certidão a descrição DESTA unidade (casa, quadra e lote) e use só ela nos campos unidade_*.";
  }
  /* o espaço pelo id, nos dois grupos (só chaves próprias: "constructor" não é espaço) */
  function espaco(id) {
    var k = String(id || "");
    if (Object.prototype.hasOwnProperty.call(ESPACOS, k)) return ESPACOS[k];
    if (Object.prototype.hasOwnProperty.call(ESPACOS_IMOVEL, k)) return ESPACOS_IMOVEL[k];
    if (Object.prototype.hasOwnProperty.call(ESPACOS_RECEB, k)) return ESPACOS_RECEB[k];
    return null;
  }

  var ESTADOS = { FALTA: "FALTA DOCUMENTO", LIDO: "LIDO PELA IA – CONFERIR", CONFERIDO: "CONFERIDO", DEVOLVIDO: "DEVOLVIDO" };
  /* entrega 13 (pedido do dono): na casa de rua a escolha é CASA PRONTA × CASA EM CONSTRUÇÃO (o contrato escolhe
     o modelo por ela). "CASA DE CONDOMÍNIO" segue só nas páginas virtuais do condomínio e "CASA DE RUA" é o valor
     antigo — os dois continuam aceitos e, para o dossiê do comprador, valem igual (qualquer tipo libera). */
  var TIPOS_CASA_TELA = ["CASA PRONTA", "CASA EM CONSTRUÇÃO"];
  var TIPOS_CASA = TIPOS_CASA_TELA.concat(["CASA DE RUA", "CASA DE CONDOMÍNIO"]);
  /* sem tipo ou com o antigo CASA DE RUA, a tela usa o tipo da obra (DOCUMENTOS "OBRA FINALIZADA?") */
  function tipoCasaPrecisaDaObra(atual) { var k = chave(atual); return !k || k === "CASA DE RUA"; }
  function tipoPelaObra(obraFinalizada) { return chave(obraFinalizada) === "SIM" ? "CASA PRONTA" : "CASA EM CONSTRUÇÃO"; }

  var ACEITOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  var POR_EXTENSAO = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  var LIMITE_IMAGEM = 5 * 1024 * 1024, LIMITE_PDF = 10 * 1024 * 1024;

  function texto(s) { return s === null || s === undefined ? "" : String(s); }
  function chave(s) {
    return texto(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[–—]/g, "-").toUpperCase().replace(/\s+/g, " ").trim();
  }
  function soDigitos(s) { return texto(s).replace(/\D/g, ""); }
  function cpfValido(cpf) {
    var d = soDigitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
      if ((soma * 10) % 11 % 10 !== Number(d[t])) return false;
    }
    return true;
  }
  /* 28/10: coluna de NÚMERO no Notion perde o zero da frente (035… vira 35…) — só dígitos e curto = completa 11 */
  function cpfDoNotion(v) {
    var s = texto(v).trim(), d = soDigitos(s);
    if (d && d.length < 11 && /^[0-9]+$/.test(s)) d = ("00000000000" + d).slice(-11);
    else return s;
    return d;
  }
  function cnpjValido(cnpj) {
    var d = soDigitos(cnpj);
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    function dv(n) {
      var pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], s = 0;
      for (var i = 0; i < n; i++) s += Number(d[i]) * pesos[i];
      var r = s % 11;
      return r < 2 ? 0 : 11 - r;
    }
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  function formatarCnpj(cnpj) {
    var d = soDigitos(cnpj);
    return d.length === 14 ? d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12) : d;
  }
  function mascararCpf(cpf) { var d = soDigitos(cpf); return d ? "***-" + d.slice(-2) : "sem CPF"; }
  function formatarCpf(cpf) {
    var d = soDigitos(cpf);
    return d.length === 11 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9) : d;
  }
  function contemNome(textoMaior, nome) {
    var b = chave(nome);
    return !!b && (" " + chave(textoMaior) + " ").indexOf(" " + b + " ") >= 0;
  }
  function dataDoc(s) {
    var t = texto(s).trim(), m;
    if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t))) return m[3] + "-" + m[2] + "-" + m[1];
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return m[1] + "-" + m[2] + "-" + m[3];
    return "";
  }
  function diasEntre(isoA, isoB) {
    return Math.round((Date.parse(isoB + "T00:00:00Z") - Date.parse(isoA + "T00:00:00Z")) / 86400000);
  }
  function valorBR(s) {
    if (typeof s === "number") return isFinite(s) ? s : null;
    var t = texto(s).replace(/[^\d,.\-]/g, "");
    if (!t) return null;
    if (t.indexOf(",") >= 0) t = t.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    var n = Number(t);
    return isFinite(n) ? n : null;
  }
  function vazio(v) {
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
  }
  function iguais(a, b, modo) {
    if (modo === "number") return Number(a) === Number(b);
    if (modo === "cpf") return soDigitos(a) === soDigitos(b);
    return chave(a) === chave(b);
  }
  /* cols/tipos: o conjunto a resolver (padrão: as colunas do dossiê do comprador) */
  function resolverColunas(schema, cols, tipos) {
    cols = cols || COL; tipos = tipos || TIPOS;
    var porChave = {};
    Object.keys(schema).forEach(function (n) { porChave[chave(n)] = n; });
    var mapa = {}, faltando = [], tipoErrado = [];
    Object.keys(cols).forEach(function (k) {
      var canon = cols[k], real = porChave[chave(canon)];
      if (!real) { faltando.push(canon); return; }
      mapa[canon] = real;
      if (schema[real].tipo !== tipos[canon]) tipoErrado.push(canon);
    });
    return { mapa: mapa, faltando: faltando, tipoErrado: tipoErrado };
  }
  function resolverOpcao(opcoes, desejada) {
    var k = chave(desejada);
    for (var i = 0; i < (opcoes || []).length; i++) if (chave(opcoes[i]) === k) return opcoes[i];
    return desejada;
  }
  function manterArquivo(f) {
    if (f.type === "external") return { type: "external", name: f.name, external: { url: f.external.url } };
    return { type: "file", name: f.name, file: { url: f.file.url } };
  }
  function mimeDoArquivo(nome, ct) {
    var c = texto(ct).split(";")[0].trim().toLowerCase();
    if (ACEITOS.indexOf(c) >= 0) return c;
    var ext = texto(nome).split(".").pop().toLowerCase();
    return POR_EXTENSAO[ext] || c || "application/octet-stream";
  }
  function tamanhoBase64(b64) {
    var s = texto(b64), pad = s.slice(-2) === "==" ? 2 : (s.slice(-1) === "=" ? 1 : 0);
    return Math.floor(s.length * 3 / 4) - pad;
  }
  function conferirArquivo(a) {
    if (!a || !a.base64) return { ok: false, erro: "SEM_ARQUIVO" };
    if (ACEITOS.indexOf(a.mime) < 0) return { ok: false, erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" };
    var lim = a.mime === "application/pdf" ? LIMITE_PDF : LIMITE_IMAGEM;
    if (tamanhoBase64(a.base64) > lim) return { ok: false, erro: "ARQUIVO_GRANDE" };
    return { ok: true };
  }
  function juntarObservacoes(atual, novas, dataCurta, login) {
    var linhas = (novas || []).map(function (t) { return "[" + dataCurta + " " + (login || "") + "] " + t; });
    var tudo = (vazio(atual) ? "" : texto(atual) + "\n") + linhas.join("\n");
    return tudo.length > 1900 ? "…" + tudo.slice(-1899) : tudo;
  }
  function temDoisCompradores(atuais) {
    return !vazio(atuais[COL.C2_NOME]) || !vazio(atuais[COL.C2_IDENT]) || !vazio(atuais[COL.C2_COMPROV]);
  }
  function contarArquivos(atuais, espacos) {
    espacos = espacos || ESPACOS;
    var r = {};
    Object.keys(espacos).forEach(function (id) { r[id] = (atuais[espacos[id].coluna] || []).length; });
    return r;
  }
  function faltamDe(obrig, arquivos) {
    var faltam = obrig.filter(function (id) { return !(arquivos[id] > 0); });
    return { estado: faltam.length ? ESTADOS.FALTA : ESTADOS.LIDO, faltam: faltam };
  }
  function estadoAposLeitura(arquivos, dois) {
    return faltamDe(["C1_IDENTIDADE", "C1_COMPROVANTE"].concat(dois ? ["C2_IDENTIDADE", "C2_COMPROVANTE"] : []), arquivos);
  }
  /* imóvel: matrícula e alvará sempre; o habite-se só existe com a obra pronta (o contrato
     só o exige nesse caso), então não segura o estado */
  function estadoImovelAposLeitura(arquivos) {
    return faltamDe(["IMOVEL_MATRICULA", "IMOVEL_ALVARA"], arquivos);
  }

  /* data dd/mm/aaaa ou aaaa-mm-dd → ISO, só se a data existe no calendário */
  function dataValida(s) {
    var iso = dataDoc(s);
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : "";
  }
  /* "R$ 1.234,56" (só para as observações; vazio/não número: "—") */
  function moeda(n) {
    n = Number(n);
    if (!isFinite(n)) return "—";
    var c = Math.round(Math.abs(n) * 100), r = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = String(c % 100); if (cent.length < 2) cent = "0" + cent;
    return (n < 0 ? "-" : "") + "R$ " + r + "," + cent;
  }
  function isoParaBR(iso) { var m =/^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(iso)); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  /* área em m² como impressa ("360,00 m²", "1.250,50", "360") → número > 0, ou null */
  function areaM2(s) {
    if (typeof s === "number") return isFinite(s) && s > 0 ? s : null;
    var t = texto(s).replace(/m\s*[²2]/gi, " ").replace(/metros?\s+quadrados?/gi, " ").trim();
    if (!/\d/.test(t)) return null;
    var n = valorBR(t);
    return n !== null && n > 0 && n < 10000000 ? Math.round(n * 100) / 100 : null;
  }
  function limpar(s) { return texto(s).replace(/\s+/g, " ").trim(); }

  var TIPOS_DOC = { identidade: ["CNH", "RG"], comprovante: ["COMPROVANTE"], aprovacao: ["APROVACAO"],
                    matricula: ["MATRICULA"], alvara: ["ALVARA"], habitese: ["HABITESE"], certidao_mae: ["CERTIDAO_MAE"],
                    contrato_financiamento: ["CONTRATO_FINANCIAMENTO"] };

  function planejarGravacao(espacoId, leitura, atuais, hojeISO, modo) {
    var esp = espaco(espacoId);
    if (!esp) throw new Error("ESPACO_DESCONHECIDO: " + espacoId);
    leitura = leitura || {};
    atuais = atuais || {};
    modo = modo === "trocar" ? "trocar" : "atualizar";
    var plano = { props: {}, observacoes: [], preenchidos: [] };
    function obs(t) { plano.observacoes.push(esp.rotulo + ": " + t); }
    function gravar(col, valor) { plano.props[col] = valor; plano.preenchidos.push(col); }
    function propor(col, valor, modoComp) {
      var atual = atuais[col];
      if (!vazio(valor)) {
        if (vazio(atual)) { gravar(col, valor); return; }
        if (iguais(atual, valor, modoComp)) return;
        gravar(col, valor);
        obs("o campo " + col + " foi atualizado pelo documento mais recente" +
          (modoComp === "cpf" ? " (antes " + mascararCpf(atual) + ", agora " + mascararCpf(valor) + ")" : ""));
        return;
      }
      if (modo === "trocar" && !vazio(atual)) gravar(col, "");
    }

    var tipoLido = texto(leitura.tipo_documento).toUpperCase().trim();
    if (TIPOS_DOC[esp.tipo].indexOf(tipoLido) < 0) {
      obs("o arquivo não parece ser " + esp.esperado + " — nada foi preenchido");
      return plano;
    }

    if (esp.tipo === "identidade") {
      var nome = texto(leitura.nome).trim();
      var cpf = soDigitos(leitura.cpf);
      if (cpf && !cpfValido(cpf)) {
        obs("o CPF lido (" + mascararCpf(cpf) + ") não fecha o dígito verificador — não foi gravado, conferir");
        cpf = "";
      }
      var rgNumero = texto(leitura.rg_numero).trim();
      var rgOrgaoUf = texto(leitura.rg_orgao_uf).trim();
      var numero = texto(leitura.numero_documento).trim();
      var orgaoEmissor = texto(leitura.orgao_emissor).trim();
      var doc = "";
      if (rgNumero) {
        doc = "RG " + rgNumero + (rgOrgaoUf ? " " + rgOrgaoUf : "");
      } else if (numero) {
        doc = tipoLido + " " + numero + (orgaoEmissor ? " " + orgaoEmissor : "");
        obs("RG não encontrado no documento — gravado o número do " + tipoLido);
      }
      var cli = atuais[COL.CLIENTES];
      if (esp.comprador === 1) {
        if (nome) {
          var depoisE = null;
          if (!vazio(cli)) {
            var posE = cli.indexOf(" E ");
            if (posE >= 0) depoisE = cli.slice(posE + 3);
          }
          var novoCli = nome + (depoisE !== null ? " E " + depoisE
            : (vazio(atuais[COL.C2_NOME]) ? "" : " E " + texto(atuais[COL.C2_NOME]).trim()));
          if (!iguais(cli, novoCli, "texto")) gravar(COL.CLIENTES, novoCli);
        } else if (modo === "trocar" && !vazio(cli)) {
          var posE2 = cli.indexOf(" E ");
          gravar(COL.CLIENTES, posE2 >= 0 ? cli.slice(posE2 + 3) : "");
        }
        propor(COL.CPF1, cpf ? formatarCpf(cpf) : "", "cpf");
        propor(COL.C1_DOC, doc, "texto");
        propor(COL.C1_NAC, leitura.nacionalidade, "texto");
      } else {
        propor(COL.C2_NOME, nome, "texto");
        if (nome) {
          if (!vazio(cli)) {
            var posB = cli.indexOf(" E ");
            var novoCliB = posB >= 0 ? cli.slice(0, posB + 3) + nome : texto(cli).trim() + " E " + nome;
            if (!iguais(cli, novoCliB, "texto")) gravar(COL.CLIENTES, novoCliB);
          }
        } else if (modo === "trocar" && !vazio(cli)) {
          var posC = cli.indexOf(" E ");
          if (posC >= 0) gravar(COL.CLIENTES, cli.slice(0, posC));
        }
        propor(COL.C2_CPF, cpf ? formatarCpf(cpf) : "", "cpf");
        propor(COL.C2_DOC, doc, "texto");
        propor(COL.C2_NAC, leitura.nacionalidade, "texto");
      }
    } else if (esp.tipo === "comprovante") {
      propor(esp.comprador === 2 ? COL.C2_END : COL.C1_END, leitura.endereco_completo, "texto");
      /* 05/11/2026 (dono): no comprovante vale só o endereço; o nome do titular não é conferido */
      var d = dataDoc(leitura.data_emissao);
      if (!d) obs("não consegui ler a data do comprovante — conferir se tem menos de 90 dias");
      else {
        var dias = diasEntre(d, hojeISO);
        if (dias > 90) obs("o comprovante tem " + dias + " dias (mais de 90) — pedir um mais recente");
      }
    } else if (esp.tipo === "matricula") {
      var CI = COL_IMOVEL;
      propor(CI.MATRICULA_INDIVIDUAL, limpar(leitura.matricula_numero), "texto");
      propor(CI.CRI, limpar(leitura.cartorio), "texto");
      var area = areaM2(leitura.area_m2);
      if (!vazio(leitura.area_m2) && area === null) obs("a área lida não é um número válido — não foi gravada, conferir");
      else propor(CI.AREA, area, "number");
      var conf = limpar(leitura.confrontacoes);
      if (conf.length > 1900) obs("as confrontações passam do tamanho do campo — conferir o fim do texto");
      /* entrega 13: com certidão mãe anexada, as confrontações da unidade vêm dela (regra do dono);
         a matrícula só preenche se o campo estiver vazio */
      var temMae = (atuais[COL_IMOVEL_OPC.ARQ_CERTIDAO_MAE] || []).length > 0;
      if (temMae && !vazio(atuais[CI.CONFRONTACOES])) {
        if (conf && !iguais(conf, atuais[CI.CONFRONTACOES], "texto"))
          obs("as confrontações da matrícula são diferentes das gravadas — mantidas as da certidão mãe, conferir");
      } else propor(CI.CONFRONTACOES, conf, "texto");
      /* 05/11/2026 (dono): nome, matrícula-mãe e cartório do condomínio/loteamento são da CASA e vão para o contrato —
         não existe mais cadastro do setor para isso (um setor tem vários condomínios). Com certidão mãe anexada, a leitura
         dela vale por cima (documento mais recente). */
      var lot = { denominacao: limpar(leitura.loteamento_denominacao), matricula: limpar(leitura.loteamento_matricula),
                  cartorio: limpar(leitura.loteamento_cartorio) };
      propor(COL_IMOVEL_OPC.LOTEAMENTO_DENOMINACAO, lot.denominacao, "texto");
      propor(CI.LOTEAMENTO_MATRICULA, lot.matricula, "texto");
      propor(CI.LOTEAMENTO_CARTORIO, lot.cartorio, "texto");
      if (lot.denominacao || lot.matricula || lot.cartorio) plano.loteamento = lot;
      /* 05/11/2026 (dono): qualificação do proprietário ATUAL (último registro de transmissão) — vira o vendedor do
         contrato quando o cadastro não tem. CPF/CNPJ que não fecha o dígito não é gravado. */
      var CVM = COL_VENDEDOR_MAT, docDono = soDigitos(leitura.proprietario_cpf_cnpj), docFmt = "";
      if (docDono) {
        if (docDono.length === 11 && cpfValido(docDono)) docFmt = formatarCpf(docDono);
        else if (docDono.length === 14 && cnpjValido(docDono)) docFmt = formatarCnpj(docDono);
        else obs("o CPF/CNPJ do proprietário lido (" + mascararCpf(docDono) + ") não fecha o dígito verificador — não foi gravado, conferir");
      }
      propor(CVM.NOME, limpar(leitura.proprietario_nome), "texto");
      propor(CVM.CPF_CNPJ, docFmt, "cpf");
      propor(CVM.NACIONALIDADE, limpar(leitura.nacionalidade), "texto");
      propor(CVM.ESTADO_CIVIL, limpar(leitura.estado_civil), "texto");
      propor(CVM.PROFISSAO, limpar(leitura.profissao), "texto");
      propor(CVM.RG, limpar(leitura.rg), "texto");
      propor(CVM.ENDERECO, limpar(leitura.endereco), "texto");
    } else if (esp.tipo === "alvara" || esp.tipo === "habitese") {
      var ehAlvara = esp.tipo === "alvara";
      propor(ehAlvara ? COL_IMOVEL.ALVARA_NUMERO : COL_IMOVEL.HABITESE_NUMERO, limpar(leitura.numero), "texto");
      var dataLida = dataValida(leitura.data);
      if (!vazio(leitura.data) && !dataLida) obs("não consegui ler a data do documento — conferir");
      else if (ehAlvara) propor(COL_IMOVEL.ALVARA_DATA, dataLida, "texto");
      else if (dataLida) {
        /* entrega 13: a data vai para CONTRATO - HABITE-SE DATA (o contrato prefere esta à DATA HABITE-SE
           da obra). Sem a coluna na base, o servidor descarta o campo e a data fica só nesta observação. */
        plano.habiteseData = dataLida;
        propor(COL_IMOVEL_OPC.HABITESE_DATA, dataLida, "texto");
        obs("data do habite-se no documento: " + isoParaBR(dataLida) +
          " — gravada em CONTRATO - HABITE-SE DATA (o contrato usa esta; a DATA HABITE-SE da obra fica de reserva)");
      }
    } else if (esp.tipo === "certidao_mae") {
      var CM = COL_IMOVEL, CO = COL_IMOVEL_OPC;
      var mae = { denominacao: limpar(leitura.loteamento_denominacao), matricula: limpar(leitura.matricula_mae),
                  cartorio: limpar(leitura.cartorio) };
      propor(CO.LOTEAMENTO_DENOMINACAO, mae.denominacao, "texto");
      propor(CM.LOTEAMENTO_MATRICULA, mae.matricula, "texto");
      propor(CM.LOTEAMENTO_CARTORIO, mae.cartorio, "texto");
      if (mae.denominacao || mae.matricula || mae.cartorio) plano.loteamento = mae;
      /* confrontações: só quando a certidão descreve ESTA unidade (identificada pelo ENDEREÇO/CASA da venda) */
      var achou = chave(leitura.unidade_encontrada) === "SIM";
      var confU = limpar(leitura.unidade_confrontacoes);
      if (achou && confU) {
        if (confU.length > 1900) obs("as confrontações passam do tamanho do campo — conferir o fim do texto");
        propor(CM.CONFRONTACOES, confU, "texto");
      } else {
        obs("a certidão não descreve esta unidade" + (limpar(leitura.unidade_identificacao) ? " (achei: " + limpar(leitura.unidade_identificacao) + ")" : "") +
          " — confrontações não gravadas, conferir");
      }
      /* 05/11/2026 (dono): a área do lote vem SÓ da matrícula do imóvel — a certidão mãe não grava nem comenta área */
    } else if (esp.tipo === "contrato_financiamento") {
      /* 05/11/2026 (dono): o contrato do banco é o valor que vale — TROCA o financiado; FGTS e subsídio só quando o
         contrato mostra (campo vazio na leitura não apaga o que existe: pode ser leitura que falhou) */
      var fin = valorBR(leitura.valor_financiado);
      if (fin === null || fin <= 0) obs("não consegui ler o valor do financiamento — VALOR FINANCIADO não mudou, conferir");
      else if (!iguais(atuais[COL.FINANCIADO], fin, "number")) {
        gravar(COL.FINANCIADO, fin);
        obs("VALOR FINANCIADO trocado pelo do contrato (" + moeda(fin) + (vazio(atuais[COL.FINANCIADO]) ? "" : "; antes " + moeda(atuais[COL.FINANCIADO])) + ")");
      }
      [[COL.FGTS, leitura.valor_fgts, "FGTS"], [COL.SUBSIDIO, leitura.valor_subsidio, "subsídio"]].forEach(function (x) {
        var v = valorBR(x[1]);
        if (vazio(x[1]) || v === null) {
          if (!vazio(atuais[x[0]])) obs("o contrato não mostra " + x[2] + " — " + x[0] + " mantido (" + moeda(atuais[x[0]]) + "); se não houver, zere na aba Recebimentos");
          return;
        }
        if (v < 0) { obs("o valor de " + x[2] + " lido não é válido — não foi gravado, conferir"); return; }
        if (!iguais(atuais[x[0]], v, "number")) {
          gravar(x[0], v);
          obs(x[0] + " trocado pelo do contrato (" + moeda(v) + (vazio(atuais[x[0]]) ? "" : "; antes " + moeda(atuais[x[0]])) + ")");
        }
      });
      plano.contratoFin = { data_assinatura: dataValida(leitura.data_assinatura) || "", banco: limpar(leitura.banco),
                            agencia: limpar(leitura.agencia), numero_contrato: limpar(leitura.numero_contrato) };
    } else {
      propor(COL.FINANCIADO, valorBR(leitura.valor_financiado), "number");
      propor(COL.FGTS, valorBR(leitura.valor_fgts), "number");
      propor(COL.SUBSIDIO, valorBR(leitura.valor_subsidio), "number");
      var cpfP = soDigitos(leitura.cpf_proponente);
      var cpfs = [soDigitos(atuais[COL.CPF1]), soDigitos(atuais[COL.C2_CPF])].filter(function (x) { return x; });
      if (cpfP && cpfs.length && cpfs.indexOf(cpfP) < 0)
        obs("o CPF do proponente (" + mascararCpf(cpfP) + ") não é o de nenhum comprador — conferir");
    }
    return plano;
  }

  /* 05/11/2026 (dono), só casa de rua: gerar o contrato final reserva a casa por 48 h para todos assinarem.
     geradoEm = CONTRATO - GERADO EM (ISO com hora); situacao = ASSINATURA - SITUAÇÃO.
     Devolve null sem data (venda antiga: a régua de sempre vale) ou
     { estado: "VENDIDA" | "RESERVADA" | "LIBERADA", geradoEm, ate } (ate = geradoEm + 48 h, ISO).
     A mesma régua está no fetch_vendas.py (reserva_contrato) e no vendas.html (reservaContratoDe). */
  var RESERVA_CONTRATO_HORAS = 48;
  function reservaContrato(geradoEm, situacao, agoraMs) {
    var g = String(geradoEm || "").trim();
    var t = g ? Date.parse(g) : NaN;
    if (!g || isNaN(t)) return null;
    var ate = new Date(t + RESERVA_CONTRATO_HORAS * 3600 * 1000).toISOString();
    var agora = typeof agoraMs === "number" ? agoraMs : Date.now();
    var estado = chave(situacao) === "ASSINADO" ? "VENDIDA" : (agora < t + RESERVA_CONTRATO_HORAS * 3600 * 1000 ? "RESERVADA" : "LIBERADA");
    return { estado: estado, geradoEm: g, ate: ate };
  }

  return {
    RESERVA_CONTRATO_HORAS: RESERVA_CONTRATO_HORAS, reservaContrato: reservaContrato,
    COL: COL, TIPOS: TIPOS, ESPACOS: ESPACOS, ESTADOS: ESTADOS, TIPOS_CASA: TIPOS_CASA,
    TIPOS_CASA_TELA: TIPOS_CASA_TELA, tipoCasaPrecisaDaObra: tipoCasaPrecisaDaObra, tipoPelaObra: tipoPelaObra,
    COL_IMOVEL: COL_IMOVEL, TIPOS_IMOVEL: TIPOS_IMOVEL, ESPACOS_IMOVEL: ESPACOS_IMOVEL, espaco: espaco,
    COL_RECEB: COL_RECEB, ESPACOS_RECEB: ESPACOS_RECEB,
    COL_IMOVEL_OPC: COL_IMOVEL_OPC, TIPOS_IMOVEL_OPC: TIPOS_IMOVEL_OPC, ORDEM_LEITURA: ORDEM_LEITURA,
    COL_VENDEDOR_MAT: COL_VENDEDOR_MAT, TIPOS_VENDEDOR_MAT: TIPOS_VENDEDOR_MAT, COL_VENDEDOR_MC: COL_VENDEDOR_MC,
    COL_MC_DOCS: COL_MC_DOCS, espacosDoTexto: espacosDoTexto, cnpjValido: cnpjValido, formatarCnpj: formatarCnpj,
    ordenarEspacos: ordenarEspacos, marcarPendente: marcarPendente, pendentesValidos: pendentesValidos,
    contextoUnidade: contextoUnidade, mesmaPessoa: mesmaPessoa, tokensNome: tokensNome, decidirEspaco: decidirEspaco, espacoDaPessoa: espacoDaPessoa,
    estadoImovelAposLeitura: estadoImovelAposLeitura, dataValida: dataValida, areaM2: areaM2, isoParaBR: isoParaBR,
    chave: chave, soDigitos: soDigitos, cpfValido: cpfValido, cpfDoNotion: cpfDoNotion, mascararCpf: mascararCpf,
    formatarCpf: formatarCpf, contemNome: contemNome, dataDoc: dataDoc, diasEntre: diasEntre,
    valorBR: valorBR, vazio: vazio, iguais: iguais, resolverColunas: resolverColunas,
    resolverOpcao: resolverOpcao, manterArquivo: manterArquivo, mimeDoArquivo: mimeDoArquivo,
    conferirArquivo: conferirArquivo, juntarObservacoes: juntarObservacoes,
    temDoisCompradores: temDoisCompradores, contarArquivos: contarArquivos,
    estadoAposLeitura: estadoAposLeitura, planejarGravacao: planejarGravacao
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = RegrasVenda;
