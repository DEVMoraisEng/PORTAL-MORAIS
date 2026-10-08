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
  /* ordem em que as leituras de um lote são aplicadas: a identidade do comprador 1 antes da do 2
     (o CLIENTES junta os dois nomes) e a certidão mãe depois da matrícula (ver confrontações) */
  var ORDEM_LEITURA = ["C1_IDENTIDADE", "C2_IDENTIDADE", "C1_COMPROVANTE", "C2_COMPROVANTE", "APROVACAO",
                       "IMOVEL_MATRICULA", "IMOVEL_CERTIDAO_MAE", "IMOVEL_ALVARA", "IMOVEL_HABITESE"];
  function ordenarEspacos(ids) {
    return (ids || []).filter(function (id, i, l) { return !!espaco(id) && l.indexOf(id) === i; })
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
  function isoParaBR(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(iso)); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
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
                    matricula: ["MATRICULA"], alvara: ["ALVARA"], habitese: ["HABITESE"], certidao_mae: ["CERTIDAO_MAE"] };

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
      var dono = esp.comprador === 2 ? atuais[COL.C2_NOME] : atuais[COL.CLIENTES];
      if (!vazio(leitura.titular) && !vazio(dono) && !contemNome(dono, leitura.titular))
        obs("o comprovante está em nome de outra pessoa — conferir (se for de parente, pedir a declaração)");
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
      /* registro do loteamento (matrícula e cartório) é da casa; o nome oficial do loteamento é do setor: só volta para a tela */
      var lot = { denominacao: limpar(leitura.loteamento_denominacao), matricula: limpar(leitura.loteamento_matricula),
                  cartorio: limpar(leitura.loteamento_cartorio) };
      propor(CI.LOTEAMENTO_MATRICULA, lot.matricula, "texto");
      propor(CI.LOTEAMENTO_CARTORIO, lot.cartorio, "texto");
      if (lot.denominacao || lot.matricula || lot.cartorio) plano.loteamento = lot;
      if (lot.denominacao)
        obs("nome do loteamento na certidão: " + lot.denominacao + " (fica no cadastro do setor; conferir se é o mesmo)");
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
      /* área: a da matrícula individual vale; a da certidão mãe só preenche o campo vazio */
      var aPriv = areaM2(leitura.unidade_area_privativa_m2), aTot = areaM2(leitura.unidade_area_total_m2);
      if (achou && (aPriv || aTot)) {
        if (vazio(atuais[CM.AREA]) && aTot) gravar(CM.AREA, aTot);
        obs("áreas da unidade na certidão mãe: " + (aPriv ? "privativa " + aPriv + " m²" : "") + (aPriv && aTot ? ", " : "") +
          (aTot ? "total " + aTot + " m²" : "") + " — conferir com CONTRATO - ÁREA DO LOTE (M²)");
      }
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

  return {
    COL: COL, TIPOS: TIPOS, ESPACOS: ESPACOS, ESTADOS: ESTADOS, TIPOS_CASA: TIPOS_CASA,
    TIPOS_CASA_TELA: TIPOS_CASA_TELA, tipoCasaPrecisaDaObra: tipoCasaPrecisaDaObra, tipoPelaObra: tipoPelaObra,
    COL_IMOVEL: COL_IMOVEL, TIPOS_IMOVEL: TIPOS_IMOVEL, ESPACOS_IMOVEL: ESPACOS_IMOVEL, espaco: espaco,
    COL_IMOVEL_OPC: COL_IMOVEL_OPC, TIPOS_IMOVEL_OPC: TIPOS_IMOVEL_OPC, ORDEM_LEITURA: ORDEM_LEITURA,
    ordenarEspacos: ordenarEspacos, marcarPendente: marcarPendente, pendentesValidos: pendentesValidos,
    contextoUnidade: contextoUnidade, mesmaPessoa: mesmaPessoa, tokensNome: tokensNome, decidirEspaco: decidirEspaco, espacoDaPessoa: espacoDaPessoa,
    estadoImovelAposLeitura: estadoImovelAposLeitura, dataValida: dataValida, areaM2: areaM2, isoParaBR: isoParaBR,
    chave: chave, soDigitos: soDigitos, cpfValido: cpfValido, mascararCpf: mascararCpf,
    formatarCpf: formatarCpf, contemNome: contemNome, dataDoc: dataDoc, diasEntre: diasEntre,
    valorBR: valorBR, vazio: vazio, iguais: iguais, resolverColunas: resolverColunas,
    resolverOpcao: resolverOpcao, manterArquivo: manterArquivo, mimeDoArquivo: mimeDoArquivo,
    conferirArquivo: conferirArquivo, juntarObservacoes: juntarObservacoes,
    temDoisCompradores: temDoisCompradores, contarArquivos: contarArquivos,
    estadoAposLeitura: estadoAposLeitura, planejarGravacao: planejarGravacao
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = RegrasVenda;
