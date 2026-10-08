/* =======================================================================
 * alertas-docs.js · GESTÃO DE DOCUMENTOS (OBRA)
 * -----------------------------------------------------------------------
 * As regras de alerta do setor, num arquivo só.
 *
 * POR QUE ELE EXISTE (set/26): o painel inicial passou a mostrar o número de
 * pendências de cada setor. Se as regras continuassem só dentro da
 * documentos.html, a contagem do painel seria uma SEGUNDA implementação das
 * mesmas regras — e as duas iam divergir no primeiro ajuste. Aqui elas moram
 * uma vez e as duas telas leem daqui.
 *
 * Depende do getV() do app.js (leitura tolerante de propriedade), que as duas
 * páginas já carregam antes deste arquivo.
 *
 * COMO USAR:
 *     const motor = criarMotorAlertas(campos);      // campos = docs.json
 *     motor.alertasDoSetor(obras, "Júlio César")    // [{o, chave, titulo, ...}]
 *     motor.contar(obras)                           // {total, porSetor:{...}}
 *     motor.atividadesAbertas(atividades, obras)    // (05/10) lista limpa
 *     motor.setorDaAtividade(a)                     // (05/10) setor fixo por tipo
 *
 * 05/10/26 — REVISÃO DAS ATIVIDADES E ALERTAS:
 *   • atividade em aberto = coluna da obra VAZIA ou NÃO (SIM, INEXISTE ou
 *     qualquer outro valor fecha). Mesma regra do Alertas.gs e do
 *     fetch_documentos.py — antes valia a fórmula do Notion, que só aceita SIM;
 *   • uma por obra+tipo (as cópias do Notion vão em a.dups);
 *   • CERTIDÃO DO LOTE é do Departamento de Projetos;
 *   • alerta novo do Júlio: PREENCHER DATA DE EMISSÃO DAS CERTIDÕES (é a
 *     fórmula "EMISSÃO CERTIDÕES" do Notion, que o portal não tinha).
 * ===================================================================== */
(function (g) {
  "use strict";

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[ºª°]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }
  function vazio(v) { return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length); }
  /* "SIM" e nada mais. É o que a fórmula do Notion faz (format(...) == "SIM"),
     e a diferença importa: a coluna OBRA INCIADA também tem "SIM SEM PRAZO",
     que a fórmula NÃO conta como SIM. Foi por isso que o site mostrava alerta
     de DATA DE INÍCIO em obra que o Notion não acusava. */
  function ehSimEstrito(v) { return norm(v) === "SIM"; }
  /* Qualquer SIM — inclusive "SIM SEM PRAZO". Serve para "a obra já começou",
     onde as duas variantes significam a mesma coisa. */
  function ehSimAmplo(v) { var n = norm(v); return n === "SIM" || n.indexOf("SIM ") === 0; }

  function criarMotorAlertas(campos) {
    campos = campos || [];
    var cache = {};

    /* Acha a coluna pelo nome: exato primeiro, "contém" depois. É assim que a
       tela sobrevive a espaço sobrando, acento e aos typos que já existem na
       base ("OBRA INCIADA", "FOI DATA A ENTRADA NO RET?"). */
    function campo() {
      var frags = Array.prototype.slice.call(arguments), k = frags.join("|"), i, j;
      if (cache[k] !== undefined) return cache[k];
      var achado = null;
      for (i = 0; i < frags.length && !achado; i++) {
        var alvo = norm(frags[i]);
        for (j = 0; j < campos.length; j++) if (norm(campos[j].nome) === alvo) { achado = campos[j]; break; }
      }
      for (i = 0; i < frags.length && !achado; i++) {
        var alvo2 = norm(frags[i]);
        for (j = 0; j < campos.length; j++) if (norm(campos[j].nome).indexOf(alvo2) >= 0) { achado = campos[j]; break; }
      }
      cache[k] = achado;
      return achado;
    }
    function val(o) {
      var c = campo.apply(null, Array.prototype.slice.call(arguments, 1));
      if (!c) return undefined;
      var v = g.getV ? g.getV(o.valores, c.nome) : o.valores[c.nome];
      /* coluna que não é publicada no arquivo (CPF/CNPJ): o dist/ manda só
         "está preenchida ou não", e para efeito de alerta isso basta */
      if (v === undefined && o.sens && o.sens[c.nome] !== undefined) v = o.sens[c.nome];
      return v;
    }

    /* PREENCHER DADOS DE OBRA — Departamento de Projetos.
       PROPRIETÁRIO REAL saiu daqui (set/26, a pedido): a cobrança dele é do
       Júlio César, e só. */
    var DADOS_PROJETOS = [
      ["ENDEREÇO", "TÍTULO"], ["SETOR", "SETOR"], ["CIDADE", "CIDADE"],
      ["PROPRIETARIO DOCUMENTO", "PROPRIETÁRIO DOCUMENTO"],
      ["ENG. EXECUÇÃO", "ENGENHEIRO EXEC."],
      ["CPF/CNPJ", "CPF/CNPJ"],
      ["ENGENHEIRO RT", "ENGENHEIRO RT"],
      ["Nº DE CASAS", "Nº DE CASAS"],
      ["IMPLANTAÇÃO", "IMPLANTAÇÃO"]
    ];
    function faltamProjetos(o) {
      var faltas = [];
      DADOS_PROJETOS.forEach(function (par) {
        var c = campo(par[0]); if (!c) return;
        if (vazio(val(o, par[0]))) faltas.push(par[1]);
      });
      return faltas;
    }
    /* PREENCHER DADOS DE OBRA — Júlio César.
       Duas diferenças em relação à fórmula do Notion, as duas pedidas:
       PROPRIETÁRIO REAL entra na conta, e a COTA é lida como NÚMERO — 0% conta
       como preenchida, que é o que a fórmula não conseguia distinguir de
       vazio. Por isso a coluna "COTA PREENCHIDA?" não é usada. */
    function faltamJulio(o) {
      var faltas = [];
      if (vazio(val(o, "ENDEREÇO"))) faltas.push("TÍTULO");
      var cota = val(o, "COTA DA EMPRESA", "COTA EMPRESA");
      if (cota === undefined || cota === null || cota === "") faltas.push("COTA");
      if (vazio(val(o, "DATA DE AQUISIÇÃO DO LOTE", "DATA DE AQUISICAO DO LOTE"))) faltas.push("DATA DE AQUISIÇÃO");
      if (vazio(val(o, "PROPRIETARIO REAL"))) faltas.push("PROPRIETÁRIO REAL");
      return faltas;
    }

    /* Cada regra é a tradução de uma fórmula do Notion.
       "titulo" é FIXO por regra (o cabeçalho do grupo na tela) e "detalhe" é o
       que muda de obra para obra. Foi assim que os "PREENCHER: TÍTULO, SETOR,
       ..." pararam de virar um grupo por combinação de campos faltando.
       "alvos" são as colunas que a pessoa preenche ali mesmo, sem abrir a obra. */
    var REGRAS = [
      /* ---- Departamento de Projetos ---- */
      { chave: "USO_SOLO_SOL", setores: ["Departamento de Projetos"],
        titulo: "PREENCHER DATA DE SOLICITAÇÃO DO USO DO SOLO",
        quando: function (o) { return ehSimEstrito(val(o, "USO DO SOLO SOLICITADO")) && vazio(val(o, "DATA DE SOLICITAÇÃO USO DO SOLO", "DATA DE SOLICITACAO USO DO SOLO")); },
        alvos: ["DATA DE SOLICITAÇÃO USO DO SOLO"] },

      { chave: "USO_SOLO_EMI", setores: ["Departamento de Projetos"],
        titulo: "PREENCHER DATA DE EMISSÃO DO USO DO SOLO",
        quando: function (o) { return ehSimEstrito(val(o, "USO DO SOLO EMITIDO")) && vazio(val(o, "DATA DE EMISSÃO DO USO DO SOLO")); },
        alvos: ["DATA DE EMISSÃO DO USO DO SOLO"] },

      { chave: "ALVARA_ENT", setores: ["Departamento de Projetos"],
        titulo: "PREENCHER DATA DE ENTRADA DE ALVARÁ",
        quando: function (o) { return ehSimEstrito(val(o, "TAXAS ENTRADA ALVAR")) && vazio(val(o, "DATA DE ENTRADA DE ALVARA", "DATA DE ENTRADA DE ALVARÁ")); },
        alvos: ["DATA DE ENTRADA DE ALVARA"] },

      { chave: "ALVARA_EMI", setores: ["Departamento de Projetos"],
        titulo: "PREENCHER DATA DE EMISSÃO DE ALVARÁ",
        quando: function (o) { return ehSimEstrito(val(o, "PROJETO APROVADO E ALVARA", "PROJETO APROVADO E ALVARÁ")) && vazio(val(o, "DATA DE APROVAÇÃO DO PROJETO")); },
        alvos: ["DATA DE APROVAÇÃO DO PROJETO"] },

      { chave: "REF_PBI", setores: ["Departamento de Projetos"],
        titulo: "PREENCHER REFERÊNCIA PBI",
        quando: function (o) { return vazio(val(o, "REF.", "REF")); },
        alvos: ["REF."] },

      { chave: "DADOS_PROJETOS", setores: ["Departamento de Projetos"],
        titulo: "PREENCHER DADOS DA OBRA",
        detalhe: function (o) { return "Falta: " + faltamProjetos(o).join(", "); },
        quando: function (o) { return faltamProjetos(o).length > 0; },
        alvos: function (o) { return faltamProjetos(o); } },

      /* ---- João Vítor ---- */
      { chave: "MESTRE_PREV", setores: ["João Vítor"],
        titulo: "PREENCHER MESTRE OU PREVISÃO DE INÍCIO DE OBRA",
        detalhe: function (o) {
          return vazio(val(o, "MESTRE")) ? "Falta o MESTRE" : "Falta a PREVISÃO DE INÍCIO DE OBRA";
        },
        quando: function (o) {
          /* obra já iniciada não é cobrada — a previsão perdeu a função.
             Aqui vale QUALQUER SIM (inclusive "SIM SEM PRAZO"): as duas
             querem dizer que a obra começou. */
          if (ehSimAmplo(val(o, "OBRA INCIADA", "OBRA INICIADA"))) return false;
          var m = !vazio(val(o, "MESTRE"));
          var p = !vazio(val(o, "PREVISÃO DE INÍCIO DE OBRA", "PREVISAO DE INICIO DE OBRA"));
          return (m && !p) || (!m && p);
        },
        /* os DOIS campos vão na linha: dá para corrigir qualquer um dos lados
           sem abrir a obra */
        alvos: ["MESTRE", "PREVISÃO DE INÍCIO DE OBRA"] },

      { chave: "INICIO_OBRA", setores: ["João Vítor"],
        titulo: "PREENCHER DATA DE INÍCIO DE OBRA",
        /* ehSimEstrito de propósito: "SIM SEM PRAZO" não entra, igual à
           fórmula do Notion. */
        quando: function (o) { return ehSimEstrito(val(o, "OBRA INCIADA", "OBRA INICIADA")) && vazio(val(o, "DATA DE INÍCIO DA OBRA")); },
        alvos: ["DATA DE INÍCIO DA OBRA"] },

      /* ---- Júlio César ---- */
      { chave: "DADOS_JULIO", setores: ["Júlio César"],
        titulo: "PREENCHER DADOS DA OBRA (cota, lote e proprietário)",
        detalhe: function (o) { return "Falta: " + faltamJulio(o).join(", "); },
        quando: function (o) { return faltamJulio(o).length > 0; },
        alvos: function (o) { return faltamJulio(o); } },

      { chave: "INCORP_ENT", setores: ["Júlio César"],
        titulo: "PREENCHER DATA DE ENTRADA NA INCORPORAÇÃO",
        quando: function (o) { return ehSimEstrito(val(o, "FOI DADO ENTRADA NA INCORPORAÇÃO", "FOI DADO ENTRADA NA INCORPORACAO")) && vazio(val(o, "DATA DE ENTRADA NA INCORPORAÇÃO")); },
        alvos: ["DATA DE ENTRADA NA INCORPORAÇÃO"] },

      { chave: "INCORP_FIM", setores: ["Júlio César"],
        titulo: "PREENCHER DATA DE FINALIZAÇÃO DA INCORPORAÇÃO",
        quando: function (o) { return ehSimEstrito(val(o, "INCORPORAÇÃO FINALI", "INCORPORACAO FINALI")) && vazio(val(o, "DATA DE FINALIZAÇÃO DA INCORPORAÇÃO", "DATA DE FINALIZACAO DA INCORPORACAO")); },
        alvos: ["DATA DE FINALIZAÇÃO DA INCORPORAÇÃO"] },

      { chave: "RET_ENT", setores: ["Júlio César"],
        titulo: "PREENCHER DATA DE ENTRADA DO RET",
        quando: function (o) { return ehSimEstrito(val(o, "FOI DATA A ENTRADA NO RET", "FOI DADA A ENTRADA NO RET")) && vazio(val(o, "DATA DE ENTRADA DO RET")); },
        alvos: ["DATA DE ENTRADA DO RET"] },

      { chave: "RET_EMI", setores: ["Júlio César"],
        titulo: "PREENCHER DATA DE EMISSÃO DO RET",
        quando: function (o) { return ehSimEstrito(val(o, "RET ARMAZENADO")) && vazio(val(o, "DATA DE FINALIZAÇÃO DO RET", "DATA DE FINALIZACAO DO RET")); },
        alvos: ["DATA DE FINALIZAÇÃO DO RET"] },

      { chave: "CERT_EMI", setores: ["Júlio César"],
        titulo: "PREENCHER DATA DE EMISSÃO DAS CERTIDÕES",
        quando: function (o) { return ehSimEstrito(val(o, "SAIRAM AS CERTIDOES", "SAIRAM AS CERTIDÕES")) && vazio(val(o, "DATA DE EMISSÃO DAS CERTIDÕES", "DATA DE EMISSAO DAS CERTIDOES")); },
        alvos: ["DATA DE EMISSÃO DAS CERTIDÕES"] },

      { chave: "HABITE_APROV", setores: ["Júlio César"],
        titulo: "PREENCHER DATA DE APROVAÇÃO HABITE-SE",
        quando: function (o) { return ehSimEstrito(val(o, "APROVOU HABITE-SE", "APROVOU HABITE")) && vazio(val(o, "DATA DE APROVAÇÃO DO HABITE-SE", "DATA DE APROVACAO DO HABITE")); },
        alvos: ["DATA DE APROVAÇÃO DO HABITE-SE"] }
    ];

    /* rótulo que aparece no texto do alerta -> coluna que ele manda preencher */
    var ROTULO_COLUNA = {
      "TÍTULO": "ENDEREÇO", "COTA": "COTA DA EMPRESA",
      "DATA DE AQUISIÇÃO": "DATA DE AQUISIÇÃO DO LOTE",
      "PROPRIETÁRIO REAL": "PROPRIETARIO REAL",
      "PROPRIETÁRIO DOCUMENTO": "PROPRIETARIO DOCUMENTO",
      "ENGENHEIRO EXEC.": "ENG. EXECUÇÃO"
    };
    function colunaDoRotulo(r) { return campo(ROTULO_COLUNA[r] || r); }

    function linhasDoSetor(obras, setor) {
      var regras = REGRAS.filter(function (r) { return r.setores.indexOf(setor) >= 0; });
      var out = [];
      (obras || []).forEach(function (o) {
        regras.forEach(function (r) {
          var bate = false;
          try { bate = !!r.quando(o); } catch (e) { bate = false; }
          if (!bate) return;
          out.push({
            o: o, chave: r.chave, titulo: r.titulo,
            detalhe: r.detalhe ? r.detalhe(o) : "",
            alvos: typeof r.alvos === "function" ? r.alvos(o) : r.alvos
          });
        });
      });
      return out;
    }
    function setores() {
      var s = {};
      REGRAS.forEach(function (r) { r.setores.forEach(function (x) { s[x] = 1; }); });
      return Object.keys(s);
    }
    function contar(obras) {
      var porSetor = {}, total = 0;
      setores().forEach(function (st) {
        var n = linhasDoSetor(obras, st).length;
        porSetor[st] = n; total += n;
      });
      return { total: total, porSetor: porSetor };
    }

    /* ---------------- ATIVIDADES (05/10/26) ---------------- */
    var TIPO_SETOR = { "CERTIDAO DO LOTE": "Departamento de Projetos" };
    function setorDaAtividade(a) { return (a && (a.setor || TIPO_SETOR[norm(a.tipo)])) || null; }
    function ehAberto(v) {
      if (v === true) return false;
      if (Array.isArray(v)) v = v.join(", ");
      var n = norm(v);
      return !n || n === "NAO" || n === "NO" || n === "FALSE";
    }
    function hojeISO() {
      var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }
    /* Lista limpa: só o que já começou, ainda aberto na coluna da obra (lida
       do arquivo + edições feitas aqui) e uma por obra+tipo. */
    function atividadesAbertas(atividades, obras) {
      var idx = {}, hoje = hojeISO();
      (obras || []).forEach(function (o) { idx[String(o.id).replace(/-/g, "")] = o; });
      var vivas = (atividades || []).filter(function (a) {
        if (a.dataInicial && String(a.dataInicial).slice(0, 10) > hoje) return false;
        if (!a.coluna || !a.obraId) return true;
        var o = idx[String(a.obraId).replace(/-/g, "")]; if (!o) return true;
        var c = campo(a.coluna); if (!c) return true;
        var v = g.getV ? g.getV(o.valores, c.nome) : o.valores[c.nome];
        if (v === undefined && o.sens && o.sens[c.nome] !== undefined) return true;   // valor protegido: confia no servidor
        return ehAberto(v);
      });
      var grupos = {}, ordem = [];
      vivas.forEach(function (a) {
        var k = a.obraId ? String(a.obraId).replace(/-/g, "") + "|" + norm(a.tipo) : "id|" + a.id;
        if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
        grupos[k].push(a);
      });
      return ordem.map(function (k) {
        var gr = grupos[k].slice().sort(function (x, y) {
          return String(x.dataFinal || "9999").localeCompare(String(y.dataFinal || "9999"));
        });
        var dupsOrig = function (x) { if (!x._dups0) x._dups0 = (x.dups || []).slice(); return x._dups0; };
        var p = gr[0], dups = dupsOrig(p).slice();
        gr.slice(1).forEach(function (x) { dups.push(x.id); dupsOrig(x).forEach(function (d) { dups.push(d); }); });
        p.dups = dups;
        return p;
      });
    }

    return { campo: campo, val: val, regras: REGRAS, alertasDoSetor: linhasDoSetor,
             contar: contar, colunaDoRotulo: colunaDoRotulo,
             atividadesAbertas: atividadesAbertas, setorDaAtividade: setorDaAtividade, ehAberto: ehAberto,
             norm: norm, vazio: vazio, ehSimEstrito: ehSimEstrito, ehSimAmplo: ehSimAmplo };
  }

  g.criarMotorAlertas = criarMotorAlertas;
  g.normDocs = norm;
})(window);
