/* venda-dossie.js — bloco "Dossiê do comprador" no painel da casa.
 * Carregado pelo vendas.html (uma linha, depois do app.js). Fala só com o
 * Apps Script PORTAL-VENDA; não chama nenhuma função de escrita do portal.
 * Se o painel do vendas.html mudar de estrutura, o bloco não aparece e o
 * resto do portal segue igual. */
(function () {
  "use strict";
  var URL_PORTAL_VENDA = "https://script.google.com/macros/s/AKfycbxmdaPwqDXkfkuUbIU1MW8Ga5-J7mQRxbF_Xju-C1Zsa5kvuFgctg-dbx214f8qHfDWQA/exec";   // URL /exec do PORTAL-VENDA deste ambiente (Task 7 e subida)

  var DOCS = [
    { id: "C1_IDENTIDADE",  rotulo: "Comprador 1 — identidade (CNH ou RG)", comprador: 1 },
    { id: "C1_COMPROVANTE", rotulo: "Comprador 1 — comprovante de endereço", comprador: 1 },
    { id: "C2_IDENTIDADE",  rotulo: "Comprador 2 — identidade (CNH ou RG)", comprador: 2 },
    { id: "C2_COMPROVANTE", rotulo: "Comprador 2 — comprovante de endereço", comprador: 2 },
    { id: "APROVACAO",      rotulo: "Aprovação da Caixa", comprador: 0 }
  ];
  /* entrega 13: casa de rua escolhe pronta × em construção (CASA DE CONDOMÍNIO só nas páginas do condomínio;
     CASA DE RUA é o valor antigo — ainda libera os documentos, mas nenhum botão fica marcado) */
  var TIPOS_CASA = ["CASA PRONTA", "CASA EM CONSTRUÇÃO"];
  var MSG = {
    NAO_AUTORIZADO: "Sua sessão expirou — entre de novo no portal.",
    SEM_PERMISSAO: "Seu login não tem acesso a Vendas.",
    SEM_PERMISSAO_TESTES: "O perfil TESTES só consulta; não grava.",
    UPLOAD_FALHOU: "Não consegui guardar o arquivo — tente de novo.",
    TROCAR_SEM_ARQUIVO: "Escolha o arquivo novo para trocar.",
    TIPO_DE_ARQUIVO_NAO_SUPORTADO: "Formato não suportado — envie foto em JPG ou PNG, ou PDF. (Foto de iPhone em HEIC: tire um print ou exporte como JPG.)",
    ARQUIVO_GRANDE: "Arquivo grande demais (PDF até 10 MB).",
    SEM_ARQUIVO: "Esse espaço ainda não tem arquivo.",
    ARQUIVO_NAO_LEGIVEL: "Não consegui abrir os arquivos desse espaço — envie de novo em JPG, PNG ou PDF.",
    MOTIVO_OBRIGATORIO: "Escreva o motivo da devolução.",
    SEM_RESPOSTA: "O servidor não respondeu — confira a internet e tente de novo.",
    PORTAL_VENDA_NAO_CONFIGURADO: "O dossiê ainda não foi ligado neste ambiente.",
    NADA_NOVO: "Não há documento novo para ler — para ler de novo um que já foi lido, use Ler de novo na linha dele.",
    NENHUM_LIDO: "Nenhum documento foi lido — veja o motivo de cada um abaixo.",
    SEM_COMPROVANTE_1: "O comprador 1 ainda não tem comprovante de endereço.",
    COMPROVANTE_1_NAO_LIDO: "Leia o comprovante do comprador 1 antes (o endereço dele ainda está vazio).",
    GRAVACAO_FALHOU: "Não consegui gravar no Notion — tente de novo.",
    LEITURA_FALHOU: "Não consegui ler agora — tente de novo.",
    /* 29/10: condições especiais e "Redigir com IA" */
    COLUNA_FALTANDO: "Falta a coluna CONTRATO - CONDIÇÕES ESPECIAIS na base de vendas — avise o administrador.",
    CHAVE_IA_FALTANDO: "A IA ainda não foi ligada neste ambiente (falta a chave da OpenAI).",
    IA_SO_OPENAI: "O Redigir com IA só funciona com a OpenAI ligada.",
    MODELO_NAO_CONFIGURADO: "O modelo do contrato do condomínio não está configurado.",
    MODELO_ILEGIVEL: "Não consegui abrir o modelo do contrato para a IA ler.",
    LEITURA_RECUSADA: "A IA não quis redigir esse pedido — reescreva com mais detalhe."
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function mensagemDeErro(erro, arquivoGuardado, foiLerDocumento) {
    var e = String(erro || "");
    if (arquivoGuardado) return "Arquivo guardado; a leitura falhou — use Ler de novo.";
    if (e === "SEM_RESPOSTA" && foiLerDocumento)
      return "O servidor demorou a responder — o arquivo pode ter sido guardado. Use Ler de novo antes de enviar outra vez.";
    if (e.indexOf("COLUNA_FALTANDO: ") === 0) return "A base não tem a coluna " + e.slice(17) + " — avise o desenvolvedor.";
    if (e.indexOf("TIPO_DE_COLUNA_ERRADO: ") === 0) return "A coluna " + e.slice(23) + " está com o tipo errado no Notion — avise o desenvolvedor.";
    return MSG[e] || "Algo deu errado (" + e + ") — tente de novo.";
  }
  function resumo(r) {
    var n = (r.preenchidos || []).length, o = (r.observacoes || []).length;
    var s = n ? "Lido: " + n + (n === 1 ? " campo preenchido" : " campos preenchidos") : "Lido: nenhum campo novo";
    if (o) s += "; " + o + (o === 1 ? " observação" : " observações") + " (veja abaixo)";
    s += r.dossie === "FALTA DOCUMENTO" ? "; ainda falta documento." : "; confira os dados e marque Conferido.";
    return s;
  }
  function escala(w, h, max) {
    var m = Math.max(w, h);
    if (m <= max) return { w: w, h: h };
    return { w: Math.round(w * max / m), h: Math.round(h * max / m) };
  }
  function tipoAceito(mime) {
    if (mime === "application/pdf") return "pdf";
    if (["image/jpeg", "image/png", "image/webp"].indexOf(mime) >= 0) return "imagem";
    return "";
  }
  /* true só para o placeholder que abrirObra põe em #pn-body enquanto carrega:
   * um único filho, classe "vazio", com o spinner .load dentro. Qualquer outra
   * coisa com .load (o spinner dos comentários, por exemplo) não conta. */
  function painelCarregando(qtdFilhos, classesPrimeiroFilho, primeiroTemLoad) {
    return qtdFilhos === 1 && classesPrimeiroFilho === "vazio" && !!primeiroTemLoad;
  }

  function html(e, ui) {
    var travado = !e.tipoCasa, ocupado = !!ui.ocupado, testes = !!ui.testes;
    var dis = function (cond) { return cond ? " disabled" : ""; };
    var h = '<div class="grp">Dossiê do comprador</div>';
    if (testes) h += '<div class="dz-aviso">Perfil TESTES só consulta.</div>';
    h += '<div class="dz-linha"><span class="dz-rot">Tipo de casa</span>' + TIPOS_CASA.map(function (t) {
      return '<button type="button" data-acao="tipo" data-valor="' + esc(t) + '" class="bt ghost bt-mini' +
        (e.tipoCasa === t ? " on" : "") + '"' + dis(ocupado || testes) + ">" + esc(t) + "</button>";
    }).join(" ") + (e.tipoCasaPelaObra ? " <small>(pela obra — pode trocar)</small>"
      : e.tipoCasa && TIPOS_CASA.indexOf(e.tipoCasa) < 0 ? " <small>(hoje: " + esc(e.tipoCasa) + " — escolha pronta ou em construção)</small>" : "") + "</div>";
    if (travado) h += '<div class="dz-aviso">Escolha o tipo de casa para liberar os documentos.</div>';
    h += '<div class="dz-linha"><span class="dz-rot">Compradores</span>' + ["1", "2"].map(function (n) {
      return '<button type="button" data-acao="dois" data-valor="' + n + '" class="bt ghost bt-mini' +
        ((ui.dois ? "2" : "1") === n ? " on" : "") + '">' + n + "</button>";
    }).join(" ") + "</div>";
    h += htmlSoltar(e, ui);
    h += htmlLerTodos(e, ui, "topo");
    DOCS.forEach(function (d) {
      if (d.comprador === 2 && !ui.dois) return;
      var n = Number((e.arquivos && e.arquivos[d.id]) || 0) || 0, extra = "";
      /* entrega 13: o comprador 2 costuma morar com o 1 — repete só o comprovante (a identidade é pessoal) */
      if (d.id === "C2_COMPROVANTE") {
        var n1 = Number((e.arquivos && e.arquivos.C1_COMPROVANTE) || 0) || 0;
        extra = ' <button type="button" class="bt ghost bt-mini" data-acao="copiar-comprovante"' + dis(travado || ocupado || testes || !n1) +
          ">Usar o mesmo do comprador 1</button>";
      }
      h += linhaDoc(d, n, e, ui, travado, extra);
    });
    h += '<div class="dz-linha"><span class="dz-rot">Dossiê: <b>' + esc(e.dossie || "—") + "</b></span>" +
      '<button type="button" class="bt bt-mini" data-acao="conferir"' + dis(travado || ocupado || testes) + ">Marcar conferido</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="devolver"' + dis(travado || ocupado || testes) + ">Devolver</button></div>";
    if (e.observacao) h += "<pre>" + esc(e.observacao) + "</pre>";
    if (ui.msg && (ui.msgGrupo || "comprador") === "comprador") h += '<div class="dz-msg">' + esc(ui.msg) + "</div>";
    return h + htmlImovel(e, ui);
  }

  /* ---- entrega 13: anexar sem ler + "Ler documentos" (uma leitura para todos os novos da casa) ---- */
  function pendentesDe(e) { return (e && Array.isArray(e.pendentes)) ? e.pendentes : []; }
  /* uma linha de documento: Anexar (soma arquivos: frente e verso), Trocar (substitui), Ler de novo (só este) */
  function linhaDoc(d, n, e, ui, travado, extra) {
    var ocupado = !!ui.ocupado, testes = !!ui.testes;
    var dis = function (cond) { return cond ? " disabled" : ""; };
    var novo = n > 0 && pendentesDe(e).indexOf(d.id) >= 0;
    return '<div class="dz-linha"><span class="dz-rot">' + esc(d.rotulo) + ' <small>' +
      (n ? n + (n === 1 ? " arquivo" : " arquivos") : "nenhum arquivo") + "</small>" +
      (novo ? ' <small class="dz-novo">novo, não lido</small>' : "") +
      (ui.ocupado === d.id ? " <b>" + esc(ui.ocupadoTexto || "lendo…") + "</b>" : "") + "</span>" +
      '<button type="button" class="bt bt-mini" data-acao="anexar" data-espaco="' + d.id + '"' + dis(travado || ocupado || testes) + ">Anexar</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="trocar" data-espaco="' + d.id + '"' + dis(travado || ocupado || testes || !n) + ">Trocar</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="reler" data-espaco="' + d.id + '"' + dis(travado || ocupado || testes || !n) + ">Ler de novo</button>" +
      (extra || "") + "</div>";
  }
  /* botão único da casa: lê comprador e imóvel juntos (uma chamada, uma escrita). Aparece no topo do
     dossiê e no fim dos documentos do imóvel; a mensagem sai junto do botão clicado (onde). */
  function htmlLerTodos(e, ui, onde) {
    var travado = !e.tipoCasa, ocupado = !!ui.ocupado, testes = !!ui.testes, n = pendentesDe(e).length;
    var h = '<div class="dz-linha dz-lote"><span class="dz-rot">' + (ui.ocupado === "lote" ? "<b>lendo " + n + (n === 1 ? " documento" : " documentos") + "… (até 3 minutos)</b>"
      : n ? n + (n === 1 ? " documento novo para ler" : " documentos novos para ler") : "Nenhum documento novo") + "</span>" +
      '<button type="button" class="bt bt-mini" data-acao="ler-todos" data-onde="' + esc(onde) + '"' + ((travado || ocupado || testes || !n) ? " disabled" : "") + ">Ler documentos" +
      (n ? " (" + n + (n === 1 ? " novo" : " novos") + ")" : "") + "</button></div>";
    if (ui.msgGrupo === "lote-" + onde) h += htmlMsgLote(ui);
    return h;
  }
  var ROTULOS = {};
  [{ id: "C1_IDENTIDADE", r: "Identidade do comprador 1" }, { id: "C1_COMPROVANTE", r: "Comprovante do comprador 1" },
   { id: "C2_IDENTIDADE", r: "Identidade do comprador 2" }, { id: "C2_COMPROVANTE", r: "Comprovante do comprador 2" },
   { id: "APROVACAO", r: "Aprovação da Caixa" }, { id: "IMOVEL_MATRICULA", r: "Matrícula" }, { id: "IMOVEL_CERTIDAO_MAE", r: "Certidão mãe" },
   { id: "IMOVEL_ALVARA", r: "Alvará" }, { id: "IMOVEL_HABITESE", r: "Habite-se" }].forEach(function (x) { ROTULOS[x.id] = x.r; });
  /* resultado do lerDocumentos → [{ok, texto}] por espaço */
  function resultadosLote(r) {
    return ((r && r.resultados) || []).map(function (x) {
      var rot = ROTULOS[x.espaco] || x.espaco;
      if (!x.ok) {
        var e = String(x.erro || ""), m = /^(COLUNA_FALTANDO|TIPO_DE_COLUNA_ERRADO)/.test(e) ? mensagemDeErro(e)
          : (MSG[e] || "a leitura falhou (" + e + ").") + " Continua como novo: clique em Ler documentos de novo ou em Ler de novo.";
        return { ok: false, texto: rot + ": não lido — " + m };
      }
      var n = (x.preenchidos || []).length, o = (x.observacoes || []).length;
      return { ok: true, texto: rot + ": " + (n ? n + (n === 1 ? " campo preenchido" : " campos preenchidos") : "nenhum campo novo") +
        (o ? "; " + o + (o === 1 ? " observação" : " observações") : "") };
    });
  }
  function htmlMsgLote(ui) {
    var h = ui.msg ? '<div class="dz-msg">' + esc(ui.msg) + "</div>" : "";
    if (ui.resultados && ui.resultados.length)
      h += '<ul class="dz-res">' + ui.resultados.map(function (x) {
        return '<li class="' + (x.ok ? "dz-ok" : "dz-erro") + '">' + esc(x.texto) + "</li>";
      }).join("") + "</ul>";
    return h;
  }
  /* ---- entrega 13: "Soltar todos os documentos" ----
   * s = { arquivos: [{ id, nome, estado, tipo, espaco, pessoa: {nome, chave}, sugestao, escolha, resultado }], pessoas: { chave: escolha } }
   * estado: "classificando" | "guardado" (imóvel/aprovação, foi direto) | "pessoa" (espera Confirmar compradores)
   *         | "desconhecido" (espera "isto é: …") | "erro" | "ignorado" | "anexado"
   * Documento de pessoa nunca é guardado sem a confirmação (regra do dono). */
  var TIPO_ROTULO = { IDENTIDADE: "identidade", COMPROVANTE: "comprovante de endereço", APROVACAO: "aprovação da Caixa",
                      MATRICULA: "matrícula", CERTIDAO_MAE: "certidão mãe", ALVARA: "alvará", HABITESE: "habite-se", OUTRO: "não reconhecido" };
  function chavePessoa(a) { return (a.pessoa && a.pessoa.chave) || "arq:" + a.id; }
  function pessoasDoEnvio(s) {
    var lista = [], vistas = {};
    ((s && s.arquivos) || []).forEach(function (a) {
      if (a.estado !== "pessoa") return;
      var k = chavePessoa(a);
      if (!vistas[k]) {
        vistas[k] = { chave: k, nome: (a.pessoa && a.pessoa.nome) || "", tipos: [], arquivos: [], sugestao: a.sugestao || "" };
        lista.push(vistas[k]);
      }
      var p = vistas[k];
      if (p.tipos.indexOf(a.tipo) < 0) p.tipos.push(a.tipo);
      p.arquivos.push(a.nome);
      if (!p.sugestao && a.sugestao) p.sugestao = a.sugestao;
    });
    lista.forEach(function (p) {
      var esc = s.pessoas && s.pessoas[p.chave];
      p.escolha = esc !== undefined ? esc : p.sugestao;
    });
    return lista;
  }
  function espacoDaPessoa(quem, tipo) {
    if (quem !== "C1" && quem !== "C2") return null;
    return tipo === "IDENTIDADE" ? quem + "_IDENTIDADE" : tipo === "COMPROVANTE" ? quem + "_COMPROVANTE" : null;
  }
  /* o que falta escolher (ou está contraditório) antes de Confirmar compradores; "" = pode confirmar */
  function conferirEscolhas(s) {
    var pessoas = pessoasDoEnvio(s), uso = {};
    for (var i = 0; i < pessoas.length; i++) {
      var p = pessoas[i];
      if (!p.escolha) return "Escolha quem é " + (p.nome || "a pessoa do arquivo " + p.arquivos[0]) + ".";
      if (p.escolha !== "NAO" && p.tipos.indexOf("IDENTIDADE") >= 0 && p.nome) {
        if (uso[p.escolha] && uso[p.escolha] !== p.chave)
          return "Duas pessoas como " + (p.escolha === "C1" ? "Comprador 1" : "Comprador 2") + " — confira.";
        uso[p.escolha] = p.chave;
      }
    }
    var semDestino = ((s && s.arquivos) || []).filter(function (a) { return a.estado === "desconhecido" && !a.escolha; });
    if (semDestino.length) return "Diga o que é o arquivo " + semDestino[0].nome + " (ou Ignorar).";
    return "";
  }
  /* depois de confirmar: [{ id, espaco }] dos arquivos a guardar (pessoa → espaço do comprador; desconhecido → o escolhido) */
  function destinosDoEnvio(s) {
    var escolhaDe = {};
    pessoasDoEnvio(s).forEach(function (p) { escolhaDe[p.chave] = p.escolha; });
    var r = [];
    ((s && s.arquivos) || []).forEach(function (a) {
      var esp = a.estado === "pessoa" ? espacoDaPessoa(escolhaDe[chavePessoa(a)], a.tipo)
        : a.estado === "desconhecido" && a.escolha && a.escolha !== "IGNORAR" ? a.escolha : null;
      if (esp) r.push({ id: a.id, espaco: esp });
    });
    return r;
  }
  function opcoesEspacos(e) {
    var im = e && e.imovel, sem = (im && Array.isArray(im.semColunas)) ? im.semColunas : [];
    var lista = DOCS.map(function (d) { return [d.id, d.rotulo]; });
    if (im && !im.erro) DOCS_IMOVEL.forEach(function (d) { if (!(d.coluna && sem.indexOf(d.coluna) >= 0)) lista.push([d.id, d.rotulo]); });
    return lista;
  }
  function htmlSoltar(e, ui) {
    var travado = !e.tipoCasa, ocupado = !!ui.ocupado, testes = !!ui.testes, s = ui.soltar;
    var dis = (travado || ocupado || testes) ? " disabled" : "";
    var h = '<div class="dz-soltar' + (dis ? " dz-off" : "") + '" data-soltar>' +
      "<b>Soltar todos os documentos aqui</b> <small>(arraste os arquivos da casa de uma vez: RG/CNH, comprovantes, aprovação da Caixa, matrícula, certidão mãe, alvará, habite-se — o sistema identifica cada um)</small> " +
      '<button type="button" class="bt bt-mini" data-acao="soltar-escolher"' + dis + ">Escolher vários arquivos</button></div>";
    if (!s || !s.arquivos || !s.arquivos.length) return h;
    h += '<ul class="dz-res dz-soltos">' + s.arquivos.map(function (a) {
      var t = a.estado === "classificando" ? "identificando…" : a.estado === "erro" ? "não consegui identificar (" + (a.erro || "erro") + ")"
        : (TIPO_ROTULO[a.tipo] || a.tipo || "") +
          (a.estado === "pessoa" ? " de " + ((a.pessoa && a.pessoa.nome) || "nome não lido") + " — confirme o comprador abaixo"
           : a.estado === "desconhecido" ? " — diga o que é abaixo" : a.estado === "ignorado" ? " — ignorado"
           : a.espaco ? " → guardado em " + (ROTULOS[a.espaco] || a.espaco) : "");
      return '<li class="' + (a.estado === "erro" ? "dz-erro" : "") + '">' + esc(a.nome) + " → " + esc(t) +
        (a.resultado ? " → " + esc(a.resultado) : "") + "</li>";
    }).join("") + "</ul>";
    var pessoas = pessoasDoEnvio(s), desconhecidos = s.arquivos.filter(function (a) { return a.estado === "desconhecido"; });
    if (pessoas.length || desconhecidos.length) {
      var d2 = (ocupado || testes) ? " disabled" : "";
      if (pessoas.length) {
        h += '<div class="dz-aviso">Encontrei documentos de: ' + esc(pessoas.map(function (p) { return p.nome || "(sem nome legível)"; }).join(", ")) +
          ". Diga quem é o Comprador 1 e o Comprador 2 — nada de pessoa é gravado antes de confirmar.</div>";
        pessoas.forEach(function (p) {
          h += '<div class="dz-linha"><span class="dz-rot">' + esc(p.nome || "Sem nome legível (" + p.arquivos.join(", ") + ")") +
            " <small>(" + esc(p.tipos.map(function (t) { return TIPO_ROTULO[t] || t; }).join(", ")) + ")</small></span>" +
            '<select data-pessoa="' + esc(p.chave) + '"' + d2 + ">" +
            [["", "— escolha —"], ["C1", "Comprador 1"], ["C2", "Comprador 2"], ["NAO", "Não é comprador (ignorar)"]].map(function (o) {
              return '<option value="' + o[0] + '"' + (p.escolha === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
            }).join("") + "</select></div>";
        });
      }
      desconhecidos.forEach(function (a) {
        h += '<div class="dz-linha"><span class="dz-rot">' + esc(a.nome) + " <small>isto é:</small></span>" +
          '<select data-arquivo="' + esc(a.id) + '"' + d2 + '><option value="">— escolha —</option>' +
          opcoesEspacos(e).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (a.escolha === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
          '<option value="IGNORAR"' + (a.escolha === "IGNORAR" ? " selected" : "") + ">Ignorar este arquivo</option></select></div>";
      });
      var falta = conferirEscolhas(s);
      h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="soltar-confirmar"' + ((ocupado || testes || falta) ? " disabled" : "") +
        ">Confirmar compradores e ler</button> " + (falta ? "<small>" + esc(falta) + "</small>" : "") + "</div>";
    }
    return h;
  }
  /* resultado do lerDocumentos → texto por espaço (para a lista por arquivo) */
  function resultadoPorEspaco(r) {
    var m = {};
    ((r && r.resultados) || []).forEach(function (x) {
      var n = (x.preenchidos || []).length;
      m[x.espaco] = x.ok ? (n ? n + (n === 1 ? " campo preenchido" : " campos preenchidos") : "lido, nenhum campo novo")
                         : "não lido (" + (MSG[x.erro] || x.erro) + ")";
    });
    return m;
  }
  function resumoLote(r) {
    var res = (r && r.resultados) || [], ok = res.filter(function (x) { return x.ok; }).length;
    var s = ok === res.length ? "Lidos " + ok + (ok === 1 ? " documento." : " documentos.") : "Lidos " + ok + " de " + res.length + " documentos.";
    return s + " Confira os dados e marque Conferido.";
  }

  /* entrega 11: "Documentos do imóvel" — matrícula, alvará e habite-se lidos pela IA, que
   * preenchem as colunas CONTRATO - * da casa. Mesmas ações do dossiê do comprador
   * (lerDocumento com o espaço IMOVEL_*, conferir/devolver com grupo "imovel"). Casa de
   * condomínio: o imóvel do contrato vem da linha do condomínio, então a seção só avisa. */
  var DOCS_IMOVEL = [
    { id: "IMOVEL_MATRICULA", rotulo: "Matrícula (certidão do cartório)" },
    { id: "IMOVEL_ALVARA",    rotulo: "Alvará de construção" },
    { id: "IMOVEL_HABITESE",  rotulo: "Habite-se" },
    /* entrega 13: certidão da matrícula-mãe do condomínio/loteamento (opcional; some se a coluna não existe) */
    { id: "IMOVEL_CERTIDAO_MAE", rotulo: "Certidão mãe (matrícula-mãe do condomínio/loteamento)", coluna: "IMÓVEL - CERTIDÃO MÃE" }
  ];
  function isoBR(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(s || ""); }
  function areaBR(n) {
    if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "";
    return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m²";
  }
  /* os dados do contrato já gravados na casa (só os preenchidos) */
  function dadosImovel(d) {
    if (!d) return [];
    var alv = [d.alvaraNumero ? "nº " + d.alvaraNumero : "", d.alvaraData ? "de " + isoBR(d.alvaraData) : ""].filter(Boolean).join(" ");
    return [["Matrícula", d.matricula], ["CRI", d.cri], ["Área do lote", areaBR(d.area)], ["Confrontações", d.confrontacoes],
            ["Alvará", alv],
            ["Habite-se", [d.habiteseNumero ? "nº " + d.habiteseNumero : "", d.habiteseData ? "de " + isoBR(d.habiteseData) : ""].filter(Boolean).join(" ")],
            ["Condomínio/loteamento", d.loteamentoDenominacao],
            ["Matrícula-mãe", [d.loteamentoMatricula, d.loteamentoCartorio].filter(Boolean).join(" — ")]]
      .filter(function (x) { return x[1]; });
  }
  function htmlLoteamento(l) {
    if (!l) return "";
    var itens = [["Denominação", l.denominacao], ["Matrícula do loteamento", l.matricula], ["Cartório", l.cartorio]]
      .filter(function (x) { return x[1]; });
    if (!itens.length) return "";
    return '<div class="dz-aviso">Dados do loteamento encontrados (matrícula e cartório ficam gravados na casa; o nome fica na casa quando vem da certidão mãe — se veio só da matrícula, preencher uma vez no cadastro do setor, em LOTEAMENTOS – CONTRATO):</div><ul>' +
      itens.map(function (x) { return "<li>" + esc(x[0]) + ": " + esc(x[1]) + "</li>"; }).join("") + "</ul>";
  }
  function htmlImovel(e, ui) {
    var im = e && e.imovel;
    if (!im) return "";   // servidor antigo, sem a seção
    var h = '<div class="grp">Documentos do imóvel</div>';
    if (e.tipoCasa === "CASA DE CONDOMÍNIO")
      return h + '<div class="dz-aviso">Casa de condomínio: os dados do imóvel do contrato vêm da linha do condomínio (VENDAS CONDOMÍNIO).</div>';
    if (im.erro) return h + '<div class="dz-aviso">' + esc(mensagemDeErro(im.erro)) + "</div>";
    var travado = !e.tipoCasa, ocupado = !!ui.ocupado, testes = !!ui.testes;
    var dis = function (cond) { return cond ? " disabled" : ""; };
    if (travado) h += '<div class="dz-aviso">Escolha o tipo de casa para liberar os documentos.</div>';
    var semColunas = Array.isArray(im.semColunas) ? im.semColunas : [];
    DOCS_IMOVEL.forEach(function (d) {
      if (d.coluna && semColunas.indexOf(d.coluna) >= 0) return;
      var n = Number((im.arquivos && im.arquivos[d.id]) || 0) || 0;
      h += linhaDoc(d, n, e, ui, travado, "");
    });
    var dados = dadosImovel(im.dados);
    if (dados.length) h += "<ul>" + dados.map(function (x) { return "<li>" + esc(x[0]) + ": " + esc(x[1]) + "</li>"; }).join("") + "</ul>";
    h += '<div class="dz-linha"><span class="dz-rot">Dossiê do imóvel: <b>' + esc(im.dossie || "—") + "</b></span>" +
      '<button type="button" class="bt bt-mini" data-acao="conferir" data-grupo="imovel"' + dis(travado || ocupado || testes) + ">Marcar conferido</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="devolver" data-grupo="imovel"' + dis(travado || ocupado || testes) + ">Devolver</button></div>";
    if (im.observacao) h += "<pre>" + esc(im.observacao) + "</pre>";
    h += htmlLoteamento(ui.loteamento);
    if (ui.msg && ui.msgGrupo === "imovel") h += '<div class="dz-msg">' + esc(ui.msg) + "</div>";
    return h + htmlLerTodos(e, ui, "imovel");
  }
  /* entrega 13: depois de gravar no Notion, o painel da casa (vendas.html) recarrega os campos ao ouvir
     window "venda:dados-gravados" com detail { pageId, gravados? } (gravados: { coluna: valor } quando há) */
  var EVENTO_GRAVADO = "venda:dados-gravados";
  function detalheGravado(pageId, r) {
    var d = { pageId: pageId };
    if (r && r.gravados && typeof r.gravados === "object" && Object.keys(r.gravados).length) d.gravados = r.gravados;
    return d;
  }
  /* 31/10 (dono): salvar ou voltar o fluxo avisa a tela com a coluna FLUXO PERSONALIZADO como ficou gravada — o cartão
     do condomínio redesenha o quadro do pro soluto sem reler a base. Mesma conta do servidor (FluxoLivre.serializar). */
  function detalheFluxoGravado(pageId, ed, voltar) {
    var f = { valor: ed.valor, entrega: ed.entrega, linhas: ed.linhas };
    if (ed.semComissao) f.semComissao = true;
    return { pageId: pageId, gravados: { "FLUXO PERSONALIZADO": voltar ? "" : FL().serializar(f) } };
  }
  /* espaço IMOVEL_* = seção do imóvel (a mensagem aparece lá) */
  function grupoDoEspaco(id) { return /^IMOVEL_/.test(String(id || "")) ? "imovel" : "comprador"; }

  var MSG_CONTRATO = {
    MODELO_NAO_CONFIGURADO: "O modelo do contrato não está configurado neste ambiente.",
    TESTEMUNHAS_INVALIDAS: "Essas testemunhas não estão mais na lista — recarregue e escolha de novo.",
    ENVELOPE_ABERTO: "A assinatura já foi enviada — as testemunhas não mudam mais.",
    CADASTRO_NAO_CONFIGURADO: "Os cadastros do contrato não estão configurados neste ambiente.",
    DRIVE_API_DESLIGADA: "Ative o serviço Drive API no PORTAL-VENDA (veja COMO-IMPLANTAR).",
    CONTRATO_FALHOU: "Não consegui gerar o contrato — tente de novo.",
    MODELO_COM_MARCADOR_SOBRANDO: "O modelo do contrato tem um campo sem preenchimento — avise o suporte.",
    FALTAM_DADOS: "Faltam dados para gerar o contrato.",
    PRECONTRATO_FALTANDO: "Gere o pré-contrato e confira antes de gerar o contrato.",
    PRECONTRATO_GRANDE: "O pré-contrato ficou grande demais para abrir pelo portal — avise o desenvolvedor.",
    PRECONTRATO_DESATUALIZADO: "Os dados mudaram depois do pré-contrato — gere o pré-contrato de novo e confira.",
    CAMPOS_INVALIDOS: "Confira os campos.",
    VENDEDOR_SEM_CADASTRO: "O dono da obra não está no cadastro de vendedores — o cadastro do vendedor é feito no Notion, não pelo portal.",
    CORRETOR_NA_VENDA_FALTANDO: "A venda não tem corretor preenchido — preencha o CORRETOR na venda.",
    LOTEAMENTO_SEM_SETOR: "A venda não tem SETOR preenchido — sem ele não dá para criar o cadastro do loteamento.",
    CONTA_INVALIDA: "Essa conta não está mais na lista — recarregue e escolha de novo.",
    GRAVACAO_FALHOU: "Não consegui gravar no cadastro — tente de novo.",
    /* 29/10: Alterar fluxo */
    FLUXO_VENDA_LANCADA: "A venda já foi lançada no Mais Controle — o fluxo não muda mais por aqui.",
    FLUXO_CONTRATO_ASSINADO: "O contrato já foi assinado — mudar o fluxo agora exige aditivo.",
    FLUXO_ASSINATURA_ABERTA: "O contrato está na Clicksign esperando assinatura — cancele o envelope antes de alterar o fluxo.",
    FLUXO_JA_E_O_DA_PROPOSTA: "O fluxo desta venda já é o da proposta.",
    /* 30/10: desconto "isentar a comissão" (venda direta) */
    FLUXO_ISENCAO_AGUARDANDO_MODELO: "Isentar a comissão ainda não está liberado: o contrato do advogado não tem o texto de venda sem corretor. Use desconto em R$ ou %.",
    MODELO_SEM_BLOCO_SEM_COMISSAO: "Esta venda é sem comissão (venda direta), mas o modelo do contrato ainda não tem esse texto — o contrato não foi gerado. Avise o desenvolvedor.",
    FLUXO_PRECO_SEM_PERMISSAO: "Só Julio Cesar ou João Vitor podem mudar o valor da casa."
  };
  /* Nunca inclui nomes de marcador do modelo (resposta.marcadores): esses vão só para o console.
     CAMPOS_INVALIDOS: os motivos (só nomes de campo) vão junto. */
  function mensagemContrato(r) {
    var e = String((r && r.erro) || "");
    if (e === "CAMPOS_INVALIDOS" && r && Array.isArray(r.erros) && r.erros.length) return "Confira: " + r.erros.join("; ") + ".";
    var m = MSG_CONTRATO[e] || mensagemDeErro(e);
    if (r && Array.isArray(r.salvos) && r.salvos.length && e !== "FALTAM_DADOS") m = "Dados salvos (" + r.salvos.join(", ") + "), mas: " + m;
    return m;
  }
  /* "NENHUM" | "PRE" | "FINAL" (resposta antiga, sem etapa: pelo gerado) */
  function etapaContrato(e) {
    if (!e) return "NENHUM";
    if (e.etapa === "PRE" || e.etapa === "FINAL" || e.etapa === "NENHUM") return e.etapa;
    return e.gerado ? "FINAL" : "NENHUM";
  }
  /* resposta do contratoEstado → estado do bloco */
  function estadoContrato(r) {
    var p = r && r.pre;
    var o = { gerado: !!(r && r.gerado), nome: (r && r.nome) || "", url: (r && r.url) || "", etapa: etapaContrato(r),
             pre: p ? { nome: p.nome || "", url: p.url || "", em: p.em || "", conferido: !!p.conferido, desatualizado: !!p.desatualizado } : null,
           };
    var t = testemunhasDoEstado(r && r.testemunhas);
    if (t) o.testemunhas = t;
    var c = contaDoEstado(r && r.conta);
    if (c) o.conta = c;
    /* 28/10: termos de confissão de dívida gerados com o contrato (condomínio) */
    if (r && Array.isArray(r.confissao)) o.confissao = r.confissao.map(function (x) { return { tipo: x.tipo === "POS" ? "POS" : "PRE", nome: String(x.nome || "") }; });
    /* 29/10: Alterar fluxo (FluxoVenda.gs) */
    if (r && r.fluxo && typeof r.fluxo === "object") o.fluxo = fluxoDoEstado(r.fluxo);
    /* 31/10/2026: o que falta de obrigatório que o cliente/corretor completa pelo link (null = o servidor não disse) */
    if (r && Array.isArray(r.faltasCliente)) o.faltasCliente = r.faltasCliente.map(String);
    /* 29/10: condições especiais desta venda (item 16 do quadro-resumo do condomínio) */
    if (r && r.condicoes && typeof r.condicoes === "object")
      o.condicoes = { coluna: !!r.condicoes.coluna, texto: String(r.condicoes.texto || ""), por: String(r.condicoes.por || ""),
                      em: String(r.condicoes.em || ""), max: Number(r.condicoes.max) || 1900 };
    return o;
  }
  /* entrega 12: "Conta de recebimento" — lista (id e título), a escolha desta venda e a conta da obra */
  function contaDoEstado(c) {
    if (c && c.fixa) return { fixa: String(c.fixa) };   /* 28/10: condomínio — conta fixa do item 4.5 (antes sumia aqui) */
    if (!c || !Array.isArray(c.opcoes)) return null;
    var esc = c.escolhida, escolhida = null;
    if (esc && esc.id) escolhida = { id: String(esc.id) };
    else if (esc && (esc.banco || esc.conta))
      escolhida = { banco: String(esc.banco || ""), agencia: String(esc.agencia || ""), operacao: String(esc.operacao || ""),
                    conta: String(esc.conta || ""), pix: String(esc.pix || "") };
    return { opcoes: c.opcoes.map(function (o) { return { id: String(o.id || ""), nome: String(o.nome || "") }; }),
             escolhida: escolhida, padrao: String(c.padrao || "") };
  }
  var CONTA_DIGITAR = "__digitar";
  /* entrega 14: Operação (opcional) — vazia, o "– Operação:" sai do contrato */
  var CAMPOS_CONTA = [["banco", "Banco"], ["agencia", "Agência"], ["operacao", "Operação (opcional)"], ["conta", "Conta"], ["pix", "Chave PIX (opcional)"]];
  /* modo "Digitar outra conta": escolhido agora na tela (u.contaDigitar) ou a escolha gravada é digitada */
  function contaDigitando(conta, u) {
    if (u && typeof u.contaDigitar === "boolean") return u.contaDigitar;
    return !!(conta && conta.escolhida && !conta.escolhida.id);
  }
  function htmlConta(conta, u, dis) {
    if (!conta) return "";   // servidor antigo
    /* 27/10 (dono): condomínio tem conta fixa (item 4.5 do contrato) — só mostra, não deixa trocar */
    /* 31/10/2026 (dono: o cartão só com o que a pessoa usa): a conta fixa do condomínio não aparece mais na tela —
       o contrato continua levando a conta no item 4.5, o gerador não muda */
    if (conta.fixa) return "";
    u = u || {};
    var rasc = u.rascunho || {}, digitar = contaDigitando(conta, u), esc = conta.escolhida || {};
    var ids = conta.opcoes.map(function (o) { return o.id; });
    var atual = digitar ? CONTA_DIGITAR : (esc.id || (ids.indexOf(conta.padrao) >= 0 ? conta.padrao : ""));
    var h = '<div class="dz-linha"><span class="dz-rot">Conta de recebimento (vai no contrato):</span><select data-conta' + dis + ">";
    if (!atual) h += '<option value="" selected>' + (conta.padrao ? "Conta da obra (padrão)" : "— escolha a conta —") + "</option>";
    h += conta.opcoes.map(function (o) {
      return '<option value="' + esc_(o.id) + '"' + (o.id === atual ? " selected" : "") + ">" + esc_(o.nome) +
        (o.id === conta.padrao ? " (conta da obra)" : "") + "</option>";
    }).join("");
    h += '<option value="' + CONTA_DIGITAR + '"' + (digitar ? " selected" : "") + ">Digitar outra conta</option></select></div>";
    if (digitar) {
      h += '<div class="dz-linha dz-conta">' + CAMPOS_CONTA.map(function (x) {
        var k = "conta|" + x[0], v = k in rasc ? rasc[k] : (esc.id ? "" : (esc[x[0]] || ""));
        return '<label class="dz-campo">' + esc_(x[1]) + ' <input type="text" maxlength="120" data-conta-campo="' + x[0] + '" value="' + esc_(v) + '"' + dis + "></label>";
      }).join(" ") + ' <button type="button" class="bt bt-mini" data-acao="c-salvar-conta"' + dis + ">Salvar conta</button></div>";
      h += '<div class="dz-msg dz-nota">A conta digitada vale só para esta venda (não muda o cadastro).</div>';
    }
    return h;
  }
  function esc_(s) { return esc(s); }
  /* entrega 12: formulário com os campos que faltam nos cadastros (vendedor, corretor, loteamento) */
  var SUB_GRUPO = { vendedor: "cadastro do dono da obra", corretor: "cadastro do corretor", loteamento: "cadastro do setor" };
  function htmlCampos(campos, u, dis) {
    if (!campos || (!(campos.grupos || []).length && !campos.conta)) return "";
    var rasc = (u && u.rascunho) || {}, h = '<div class="dz-aviso">Faltam dados do cadastro — preencha aqui (fica salvo no cadastro do Notion):</div>';
    (campos.grupos || []).forEach(function (g) {
      h += '<div class="dz-linha dz-grupo"><b>' + esc(g.titulo) + "</b> <small>(" +
        esc(g.criar ? "novo cadastro" : (SUB_GRUPO[g.grupo] || "cadastro")) + ")</small></div>";
      (g.campos || []).forEach(function (c) {
        var k = g.grupo + "|" + c.coluna, v = rasc[k] || "", attr = ' data-campo="' + esc(k) + '"' + dis;
        var inp;
        if (c.tipo === "opcao") {
          inp = "<select" + attr + '><option value="">—</option>' + (c.opcoes || []).map(function (o) {
            return '<option value="' + esc(o) + '"' + (o === v ? " selected" : "") + ">" + esc(o) + "</option>";
          }).join("") + "</select>";
        } else {
          var tipo = c.tipo === "email" ? "email" : c.tipo === "inteiro" ? "number" : "text";
          inp = '<input type="' + tipo + '"' + (tipo === "number" ? ' min="1" step="1"' : ' maxlength="300"') + attr + ' value="' + esc(v) + '">';
        }
        h += '<div class="dz-linha"><label class="dz-rot">' + esc(c.rotulo) + "</label>" + inp + "</div>";
      });
    });
    if (campos.conta) h += '<div class="dz-aviso">Banco, agência e conta: escolha ou digite em "Conta de recebimento", abaixo.</div>';
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="c-salvar-campos"' + dis + ">Salvar dados e gerar pré-contrato</button></div>";
    return h;
  }
  /* entradas da tela [{chave: "grupo|COLUNA", valor}] + conta digitada (ou null) -> pedido do salvarCamposContrato */
  function pedidoCampos(entradas, contaDigitada) {
    var campos = {}, n = 0;
    (entradas || []).forEach(function (x) {
      var i = String(x.chave || "").indexOf("|"), v = String(x.valor === null || x.valor === undefined ? "" : x.valor).trim();
      if (i <= 0 || !v) return;
      var g = x.chave.slice(0, i), col = x.chave.slice(i + 1);
      if (!campos[g]) campos[g] = {};
      campos[g][col] = v; n++;
    });
    var p = { campos: campos };
    if (contaDigitada) p.conta = contaDigitada;
    return n || contaDigitada ? p : null;
  }
  /* resposta FALTAM_DADOS -> { faltas (as que o formulário não cobre), campos (ou null: servidor antigo) } */
  function faltasDaResposta(r) {
    var c = r && r.campos;
    if (c && Array.isArray(c.grupos)) return { faltas: Array.isArray(c.outras) ? c.outras : [], campos: c };
    return { faltas: (r && r.faltas) || [], campos: null };
  }
  /* conta digitada nas caixas: null se as três obrigatórias estão vazias */
  function contaDasEntradas(v) {
    v = v || {};
    var c = { banco: String(v.banco || "").trim(), agencia: String(v.agencia || "").trim(), conta: String(v.conta || "").trim(), pix: String(v.pix || "").trim() };
    var op = String(v.operacao || "").trim();
    if (op) c.operacao = op;   // entrega 14: só vai quando foi digitada
    return c.banco || c.agencia || c.conta || c.pix ? c : null;
  }
  function testemunhasDoEstado(t) {
    if (!t || !Array.isArray(t.opcoes)) return null;
    return { opcoes: t.opcoes.map(function (o) { return { id: String(o.id || ""), nome: String(o.nome || "") }; }),
             escolhidas: Array.isArray(t.escolhidas) ? t.escolhidas.map(String) : [] };
  }
  /* entrega 10: duas listas "Testemunha 1/2"; vazio = o par padrão das Propriedades (SPE ou PF) */
  function htmlTestemunhas(t, dis) {
    if (!t || t.opcoes.length < 2) return "";
    function sel(n) {
      var atual = t.escolhidas[n] || "";
      return '<select data-testemunha="' + n + '"' + dis + '><option value="">— padrão —</option>' +
        t.opcoes.map(function (o) {
          return '<option value="' + esc(o.id) + '"' + (o.id === atual ? " selected" : "") + ">" + esc(o.nome) + "</option>";
        }).join("") + "</select>";
    }
    return '<div class="dz-linha"><span class="dz-rot">Testemunhas da assinatura:</span>' + sel(0) + " " + sel(1) + "</div>";
  }
  /* a Assinatura só vale para o contrato FINAL (não para o que está sendo conferido) */
  function contratoFinal(e) { return !!(e && e.gerado && etapaContrato(e) === "FINAL"); }
  function htmlContrato(e, u) {
    var ocupado = !!u.ocupadoContrato, testes = !!u.testes;
    var dis = (ocupado || testes) ? " disabled" : "";
    var h = '<div class="grp">Contrato</div>';
    if (testes) h += '<div class="dz-aviso">Perfil TESTES só consulta.</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    if (u.ocupadoContrato === "pre") h += '<div class="dz-linha"><b>gerando o pré-contrato… (até 1 minuto)</b></div>';
    if (u.ocupadoContrato === "aprovar") h += '<div class="dz-linha"><b>gerando o contrato… (até 1 minuto)</b></div>';
    if (u.ocupadoContrato === "salvar") h += '<div class="dz-linha"><b>salvando os dados e gerando o pré-contrato… (até 1 minuto)</b></div>';
    /* entrega 12: o que o formulário cobre sai da lista (u.faltas = só as outras) */
    if (u.faltas && u.faltas.length) {
      h += '<div class="dz-aviso">Para gerar o contrato, falta:</div><ul>' +
        u.faltas.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>";
    }
    h += htmlCampos(u.campos, u, dis);
    /* entrega 9: (a) nada → Gerar pré-contrato; (b) pré-contrato a conferir → Visualizar pré-contrato,
       "Conferi…" e Gerar pré-contrato de novo; (c) contrato final → Visualizar / Gerar de novo (volta ao pré-contrato) */
    var etapa = etapaContrato(e);
    if (etapa === "PRE") {
      var pre = e.pre || {}, velho = !!pre.desatualizado;
      h += '<div class="dz-linha"><span class="dz-rot">Pré-contrato: ' + esc(pre.nome || "") + "</span>" +
        '<button type="button" class="bt bt-mini" data-acao="c-ver-pre"' + (ocupado ? " disabled" : "") + ">Visualizar pré-contrato</button></div>";
      h += '<div class="dz-msg">Confira no pré-contrato o que está grifado: amarelo = preenchido pelo app; vermelho = ficou em branco.</div>';
      if (velho) h += '<div class="dz-aviso">Os dados mudaram depois deste pré-contrato — gere o pré-contrato de novo.</div>';
      h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="c-aprovar"' + ((ocupado || testes || velho) ? " disabled" : "") +
        ">Conferi, está tudo certo — gerar contrato</button> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="c-pre"' + dis + ">Gerar pré-contrato de novo</button></div>";
      if (e.gerado) h += '<div class="dz-msg">Contrato anterior: ' + esc(e.nome) + " (será substituído ao conferir).</div>";
    } else if (etapa === "FINAL") {
      h += '<div class="dz-linha"><span class="dz-rot">Contrato gerado<span class="dz-arq-nome">: ' + esc(e.nome) + "</span></span>" +
        '<button type="button" class="bt bt-mini" data-acao="c-ver"' + dis + ">Visualizar</button> " +
        '<button type="button" class="bt ghost bt-mini" data-acao="c-pre"' + dis + ">Gerar de novo</button></div>";
      (e.confissao || []).forEach(function (x) {
        h += '<div class="dz-linha"><span class="dz-rot">Termo de confissão ' + (x.tipo === "POS" ? "pós-chaves" : "pré-chaves") + ": " + esc(x.nome) + "</span>" +
          '<button type="button" class="bt ghost bt-mini" data-acao="c-ver-cfd-' + (x.tipo === "POS" ? "pos" : "pre") + '"' + dis + ">Visualizar</button></div>";
      });
    } else {
      h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="c-pre"' + dis + ">Gerar pré-contrato</button></div>";
    }
    h += htmlConta(e.conta, u, dis);
    h += htmlTestemunhas(e.testemunhas, dis);
    h += htmlFluxo(e.fluxo, u, dis, e);
    h += htmlCondicoes(e.condicoes, u, dis);
    h += htmlHistorico(e.historico);
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    if (u.link && /^https:\/\//.test(u.link)) {
      h += '<div class="dz-msg">O navegador bloqueou a janela — clique em Abrir contrato. ' +
        '<a href="' + esc(u.link) + '" target="_blank" rel="noopener">Abrir contrato</a></div>';
    }
    return h;
  }

  /* 30/10 (dono): histórico do contrato — quem fez o quê e quando (coluna HISTÓRICO DO CONTRATO; só leitura).
     Fechado por padrão; a mais nova em cima. */
  function htmlHistorico(l) {
    if (!Array.isArray(l)) return "";   /* base sem a coluna HISTÓRICO DO CONTRATO */
    var h = '<details class="dz-hist"><summary><b>Histórico do contrato</b> <span class="dz-nota">(' +
      (l.length ? l.length + (l.length === 1 ? " registro" : " registros") : "nada registrado ainda") + " — quem fez o quê e quando)</span></summary>";
    if (l.length) h += '<ul class="dz-hist-lista">' + l.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    return h + "</details>";
  }

  /* 29/10: "Condições especiais desta venda" (item 16). O texto vai para o contrato só desta casa; vazio = "Não há.".
     "Redigir com IA" só sugere: põe a redação na caixa, e a pessoa lê e clica em Salvar. */
  function htmlCondicoes(c, u, dis) {
    if (!c) return "";
    var rasc = u.condRasc !== undefined && u.condRasc !== null ? u.condRasc : c.texto;
    var h = '<div class="dz-grupo"><b>Condições especiais desta venda</b> <span class="dz-nota">(item 16 do quadro-resumo — só este contrato; vazio sai "Não há.")</span></div>';
    if (!c.coluna) return h + '<div class="dz-aviso">Falta a coluna CONTRATO - CONDIÇÕES ESPECIAIS na base de vendas.</div>';
    if (u.ocupadoContrato === "condesp-ia") h += '<div class="dz-linha"><b>a IA está redigindo… (até 1 minuto)</b></div>';
    if (u.ocupadoContrato === "condesp") h += '<div class="dz-linha"><b>salvando…</b></div>';
    h += '<div class="dz-linha"><input type="text" class="vb-condesp-pedido" maxlength="1000" style="width:100%;box-sizing:border-box" ' +
      'placeholder="O que mudar, em português comum (ex.: cliente quer 45 dias em vez de 30 para a vistoria)" value="' + esc(u.condPedido || "") + '"' + dis + '>' +
      '<div style="margin-top:6px"><button type="button" class="bt ghost bt-mini" data-acao="c-condesp-ia"' + dis + '>Redigir com IA</button></div></div>';
    if (u.condIA) h += '<div class="dz-msg">' + esc(u.condIA) + "</div>";
    h += '<div class="dz-linha"><textarea class="vb-condesp" rows="4" maxlength="' + c.max + '" style="width:100%;box-sizing:border-box;font:inherit"' + dis +
      ' placeholder="Ex.: Na cláusula 9.2, onde se lê 30 dias, leia-se 45 dias.">' + esc(rasc) + "</textarea>" +
      '<div style="margin-top:6px"><button type="button" class="bt bt-mini" data-acao="c-condesp-salvar"' + dis + ">Salvar condições especiais</button>" +
      (c.por ? ' <span class="ass-data">última gravação: ' + esc(c.por) + (c.em ? " em " + esc(dataHoraBR(c.em)) : "") + "</span>" : "") + "</div></div>";
    if (c.texto) h += '<div class="dz-aviso">Este contrato tem condições especiais — confira o item 16 no pré-contrato antes de aprovar.</div>';
    return h;
  }
  /* ---- 29/10: "Alterar fluxo" — exceção na mesa (pedido do diretor). Lista livre de pagamentos; o tipo decide o
     reajuste. Regra do dono: qualquer redistribuição vale, mas só salva com a soma batendo AO CENTAVO com o valor
     da casa. As regras moram em venda/FluxoLivre.js (as mesmas do servidor). ---- */
  function FL() { return typeof FluxoLivre !== "undefined" ? FluxoLivre : require("./venda/FluxoLivre.js"); }
  function fluxoDoEstado(f) {
    return { coluna: !!f.coluna, alterado: !!f.alterado, trava: String(f.trava || ""), por: String(f.por || ""),
             em: String(f.em || ""), alteracoes: Number(f.alteracoes) || 0 };
  }
  var TRAVA_FLUXO = { FLUXO_VENDA_LANCADA: 1, FLUXO_CONTRATO_ASSINADO: 1, FLUXO_ASSINATURA_ABERTA: 1 };
  /* fluxo alterado DEPOIS do último (pré-)contrato gerado: o PDF não tem o fluxo de agora. Sem contrato ainda, sem aviso. */
  function fluxoDepoisDoContrato(f, ec) {
    if (!f || !f.alterado || !f.em || !ec) return false;
    var pre = ec.pre || null;
    if (!ec.gerado && !pre) return false;
    var em = pre && pre.em ? String(pre.em) : "";
    return !em || em < String(f.em);
  }
  function numBR(v) { return (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function lerNumBR(s) {
    s = String(s || "").replace(/[^\d,.-]/g, "");
    if (s.indexOf(",") >= 0 || /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");   /* "10.000" = dez mil */
    var n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
  /* editor aberto: u.fluxoEd = { valor, valorOriginal, entrega, linhas, padrao, historico, alterado, motivo, motivoPreco } */
  function htmlFluxo(f, u, dis, ec) {
    if (!f) return "";
    var h = '<div class="dz-grupo"><b>Fluxo de pagamento</b></div>';
    if (!f.coluna) return h + '<div class="dz-aviso">Falta a coluna FLUXO PERSONALIZADO na base de vendas do condomínio.</div>';
    var ed = u.fluxoEd;
    if (u.ocupadoContrato === "fluxo") h += '<div class="dz-linha"><b>carregando o fluxo…</b></div>';
    if (u.ocupadoContrato === "fluxo-salvar") h += '<div class="dz-linha"><b>salvando o fluxo…</b></div>';
    if (!ed) {
      /* 31/10/2026 (dono: "com qual fluxo? confuso"): UMA linha dizendo qual fluxo vale e onde vê-lo */
      var lancada = f.trava === "FLUXO_VENDA_LANCADA";
      h += '<div class="dz-linha"><span class="dz-rot">Fluxo em uso: ' + (f.alterado
        ? "alterado no portal" + (f.por ? " por " + esc(f.por) : "") + (f.em ? " em " + esc(dataHoraBR(f.em)) : "") + "."
        : "o da proposta (simulador).") + (lancada ? " Já lançado no Mais Controle com este fluxo; não muda mais por aqui." : "") + "</span>" +
        '<button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-ver">Ver fluxo</button>' +
        (lancada ? "" : ' <button type="button" class="bt bt-mini" data-acao="c-fluxo-abrir"' + (dis || (f.trava ? " disabled" : "")) + ">Alterar fluxo</button>") + "</div>";
      if (f.trava && TRAVA_FLUXO[f.trava] && !lancada) h += '<div class="dz-msg">' + esc(MSG_CONTRATO[f.trava]) + "</div>";
      if (fluxoDepoisDoContrato(f, ec)) h += '<div class="dz-aviso">Fluxo alterado depois do contrato: gere o contrato de novo.</div>';
      return h;
    }
    /* financiamento, FGTS e subsídio (fixo) só aparecem; o valor da casa só para quem pode (Julio Cesar e João Vitor) */
    var F = FL(), ops = F.ORDEM.filter(function (t) { return !F.TIPOS[t].fixo; }).map(function (t) { return [t, F.TIPOS[t].nome]; });
    h += '<div class="dz-linha vb-fx"><label class="dz-campo">Valor da casa (R$) <input type="text" inputmode="decimal" data-fx="valor" value="' + esc(numBR(ed.valor)) + '"' +
      (dis || (ed.podePreco ? "" : " disabled")) + ' style="width:9em;text-align:right"></label>' +
      (ed.podePreco ? "" : ' <span class="dz-nota">só Julio Cesar ou João Vitor mudam o valor da casa</span>') +
      (ed.entrega ? ' <span class="dz-nota">entrega das chaves: ' + esc(F.dataBR(ed.entrega)) + "</span>" : "") + "</div>";
    h += htmlFluxoDesconto(ed, dis);
    /* 31/10/2026 (dono): trocar o prazo da entrada na mesa (cliente de 24x para 36x) — a tela refaz os valores */
    var prazoAgora = F.prazoDasLinhas(ed.linhas);
    h += '<div class="dz-linha vb-fx-prazo"><b>Prazo da entrada:</b> ' + [24, 36, 48].map(function (p) {
      return '<button type="button" class="bt bt-mini' + (p === prazoAgora ? "" : " ghost") + '" data-acao="c-fluxo-prazo" data-p="' + p + '" aria-pressed="' +
        (p === prazoAgora) + '"' + dis + ">" + p + "x</button>";
    }).join(" ") + ' <span class="dz-nota">refaz pré-chaves, balões e pós-chaves pela conta do simulador; sinal, financiamento e FGTS ficam</span></div>';
    h += '<div class="vb-fx-tab" style="overflow-x:auto"><table class="tbl-fx" style="border-collapse:collapse;width:100%;font-size:.9em">' +
      "<thead><tr><th>Tipo</th><th>↻</th><th>Valor de cada (R$)</th><th>Qtde</th><th>1ª data</th><th>A cada (meses)</th><th>Descrição</th><th>Total</th><th></th></tr></thead><tbody>";
    ed.linhas.forEach(function (l, k) {
      var tp = F.TIPOS[l.t] || { reajuste: "" };
      if (tp.fixo) {
        h += '<tr data-fx-linha="' + k + '"><td><b>' + esc(tp.nome) + '</b><div class="dz-nota">' + (l.t === "prereserva" ? "já recebida — abate o sinal" : "não muda (da proposta)") + '</div></td><td></td>' +
          '<td style="text-align:right">' + esc(numBR(l.v)) + "</td><td>" + esc(l.n) + "</td><td>" + esc(l.d ? F.dataBR(l.d) : "—") + "</td><td></td><td></td>" +
          '<td class="vb-fx-tot" data-k="' + k + '" style="white-space:nowrap;text-align:right">' + esc(F.moeda(F.totalLinha(l))) + "</td><td></td></tr>";
        return;
      }
      h += '<tr data-fx-linha="' + k + '"><td><select data-fx="t" data-k="' + k + '"' + dis + ">" +
        ops.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === l.t ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
        '</select><div class="dz-nota">' + (tp.reajuste ? "reajuste " + esc(tp.reajuste) : "sem correção") + "</div></td>" +
        /* 30/10 (arquivo 17, item 2): o Redistribuir virou ícone, entre o tipo e o valor */
        '<td><button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-red" data-k="' + k + '"' + dis +
        ' title="Redistribuir: joga a diferença inteira nesta linha" aria-label="Redistribuir a diferença nesta linha">↻</button></td>' +
        '<td><input type="text" inputmode="decimal" data-fx="v" data-k="' + k + '" value="' + esc(numBR(l.v)) + '"' + dis + ' style="width:7.5em;text-align:right">' +
        (l.u && l.n > 1 ? '<div class="dz-nota">última: ' + esc(numBR(l.u)) + "</div>" : "") + "</td>" +
        '<td><input type="number" min="1" data-fx="n" data-k="' + k + '" value="' + esc(l.n) + '"' + dis + ' style="width:4.5em"></td>' +
        '<td><input type="date" data-fx="d" data-k="' + k + '" value="' + esc(l.d) + '"' + dis + "></td>" +
        '<td><input type="number" min="1" max="24" data-fx="i" data-k="' + k + '" value="' + esc(l.i || 1) + '"' + dis + ' style="width:4em"></td>' +
        '<td><input type="text" maxlength="120" data-fx="x" data-k="' + k + '" value="' + esc(l.x || "") + '"' + dis +
        ' placeholder="' + (l.t === "permuta" ? "veículo marca/modelo/ano/placa" : "opcional") + '" style="min-width:10em"></td>' +
        '<td class="vb-fx-tot" data-k="' + k + '" style="white-space:nowrap;text-align:right">' + esc(F.moeda(F.totalLinha(l))) + "</td>" +
        '<td style="white-space:nowrap">' +
        '<button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-del" data-k="' + k + '"' + dis + ' aria-label="Apagar linha">✕</button></td></tr>';
    });
    h += "</tbody></table></div>";
    h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-add"' + dis + ">+ linha</button> " +
      '<button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-padrao"' + dis + ">Recomeçar do fluxo da proposta</button></div>";
    h += '<div class="vb-fx-viva">' + htmlFluxoVivo(ed, dis) + "</div>";
    var mudouPreco = Math.round(ed.valor * 100) !== Math.round(ed.valorOriginal * 100);
    h += '<div class="dz-linha"><label class="dz-campo" style="display:block">Motivo da alteração (obrigatório) <input type="text" maxlength="300" data-fx="motivo" value="' + esc(ed.motivo || "") + '"' + dis +
      ' placeholder="ex.: cliente pediu mais um balão e parcelas menores" style="width:100%;box-sizing:border-box"></label></div>';
    h += '<div class="dz-linha vb-fx-mp" style="display:' + (mudouPreco ? "block" : "none") + '"><label class="dz-campo" style="display:block">Motivo da mudança no valor da casa (obrigatório) ' +
      '<input type="text" maxlength="300" data-fx="motivoPreco" value="' + esc(ed.motivoPreco || "") + '"' + dis + ' style="width:100%;box-sizing:border-box"></label></div>';
    h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-fechar"' + dis + ">Fechar sem salvar</button>" +
      (ed.alterado ? ' <button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-voltar"' + dis + ">Voltar ao fluxo da proposta</button>" : "") + "</div>";
    if (ed.historico && ed.historico.length) {
      h += '<details class="dz-linha"><summary>Alterações do fluxo (' + ed.historico.length + ")</summary><ul>" +
        ed.historico.slice().reverse().map(function (x) {
          return "<li>" + esc(dataHoraBR(x.em) || "") + " — " + esc(x.por || "?") + ": " + esc(x.voltou ? "voltou ao fluxo da proposta. " : "") + esc(x.motivo || "") +
            (x.motivoPreco ? " (valor da casa: " + esc(x.motivoPreco) + ")" : "") + (x.desconto ? " — desconto: " + esc(x.desconto) : "") + "</li>";
        }).join("") + "</ul></details>";
    }
    return h;
  }
  /* 30/10 (arquivo 17, item 1): desconto — só quem muda o valor da casa (ed.desconto vem do servidor só para eles).
     ed.dsc = { modo: rs | pct | isentar, valor (texto digitado), de: entrada | baloes | pre } */
  var DSC_DE = [["entrada", "proporcional na entrada"], ["baloes", "dos balões primeiro (do último para o primeiro), depois as pré-chaves"],
                ["pre", "das parcelas pré-chaves"]];
  function htmlFluxoDesconto(ed, dis) {
    if (!ed.podePreco || !ed.desconto) return "";
    var F = FL(), d = ed.dsc || {}, modo = d.modo || "rs", lib = !!ed.desconto.isencaoLiberada, com = ed.desconto.comissao || {};
    var h = '<div class="dz-linha vb-fx-dsc" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;padding:6px 8px;border:1px dashed rgba(127,127,127,.5);border-radius:6px">' +
      '<b style="align-self:center">Desconto</b><label class="dz-campo">Como <select data-fx="dmodo" style="width:auto;max-width:100%"' + dis + ">" +
      [["rs", "em R$"], ["pct", "em %"], ["isentar", "isentar a comissão" + (lib ? "" : " (aguardando o contrato)")]].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === modo ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>";
    if (modo !== "isentar")
      h += '<label class="dz-campo">' + (modo === "pct" ? "Percentual (%)" : "Valor (R$)") + ' <input type="text" inputmode="decimal" data-fx="dvalor" value="' +
        esc(d.valor || "") + '"' + dis + ' style="width:7em;text-align:right"></label>';
    else h += '<span class="dz-nota" style="align-self:center">desconto = a comissão de hoje (' + esc(F.moeda(com.valor || 0)) + "); venda direta, sem corretor</span>";
    h += '<label class="dz-campo">De onde sai <select data-fx="dde" style="width:auto;max-width:100%"' + dis + ">" +
      DSC_DE.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === (d.de || "entrada") ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
      '</select></label><button type="button" class="bt bt-mini" data-acao="c-fluxo-desconto"' + dis + ">Aplicar desconto</button>";
    if (modo === "isentar" && !lib) h += '<div class="dz-msg" style="flex-basis:100%">' + esc(MSG_CONTRATO.FLUXO_ISENCAO_AGUARDANDO_MODELO) + "</div>";
    h += '<div class="dz-nota" style="flex-basis:100%">Sinal, financiamento e FGTS não mudam. ' +
      (ed.semComissao ? "<b>Venda direta: sem comissão.</b>" : "Em R$ ou %, a comissão é recalculada pela regra do prazo sobre o valor novo.") + "</div>";
    return h + "</div>";
  }
  /* o desconto da tela em R$: { valor } ou { erro } */
  function descontoDaTela(ed) {
    var d = ed.dsc || {};
    return FL().valorDoDesconto(ed.valor, { modo: d.modo || "rs", valor: lerNumBR(d.valor), comissao: ((ed.desconto || {}).comissao || {}).valor });
  }
  /* placar + o que falta + Salvar: redesenhado a cada tecla sem mexer na tabela (não perde o foco) */
  function htmlFluxoVivo(ed, dis) {
    var F = FL(), r = F.validar({ valor: ed.valor, entrega: ed.entrega, linhas: ed.linhas }, ed.padrao), soma = F.soma(ed.linhas), dif = r.diferenca;
    var mudouPreco = Math.round(ed.valor * 100) !== Math.round(ed.valorOriginal * 100);
    var motivoOk = !!String(ed.motivo || "").trim() && (!mudouPreco || !!String(ed.motivoPreco || "").trim());
    var bate = Math.round(dif * 100) === 0, ok = r.ok && motivoOk;
    var h = '<div class="vb-fx-placar" style="display:flex;flex-wrap:wrap;gap:4px 18px;margin:6px 0;padding:6px 10px;border-radius:6px;' +
      (bate ? "background:rgba(29,107,67,.14)" : "background:rgba(163,39,31,.14)") + '">' +
      "<span>Valor da casa: <b>" + esc(F.moeda(ed.valor)) + "</b></span><span>Soma do fluxo: <b>" + esc(F.moeda(soma)) + "</b></span>" +
      "<span>" + (bate ? "Diferença: <b>R$ 0,00 ✓</b>" : (dif > 0 ? "Faltam" : "Sobram") + ": <b>" + esc(F.moeda(Math.abs(dif))) + "</b>") + "</span>" +
      /* 30/10: a comissão que vai sair (sem comissão na isenção; pela regra do prazo sobre o valor novo no desconto) */
      (ed.semComissao ? "<span>Comissão: <b>sem comissão (venda direta)</b></span>"
        : mudouPreco && ed.desconto && ed.desconto.comissao && ed.desconto.comissao.pct
          ? "<span>Comissão pela regra: <b>" + esc(F.moeda(Math.round(ed.valor * ed.desconto.comissao.pct * 100) / 100)) + "</b></span>" : "") +
      htmlPrazoPlacar(ed) + "</div>";
    /* 31/10: sugestão para fechar a conta sem fazer na mão */
    if (!bate) h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="c-fluxo-dist"' + dis +
      ' title="Espalha a diferença nas pré-chaves e balões, proporcional ao total de cada">Distribuir ' + esc(F.moeda(Math.abs(dif))) +
      " nas pré-chaves e balões</button></div>";
    var faltas = r.erros.filter(function (x) { return !/^(Faltam|Sobram) /.test(x); });
    if (!motivoOk) faltas.push("Falta o motivo" + (mudouPreco ? " (e o motivo da mudança no valor da casa)" : ""));
    if (faltas.length) h += '<ul class="dz-msg">' + faltas.slice(0, 6).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if (r.avisos.length) h += '<div class="dz-aviso">' + r.avisos.map(esc).join("; ") + ".</div>";
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="c-fluxo-salvar"' + ((dis || !ok) ? " disabled" : "") + ">" +
      (bate ? "Salvar fluxo" : (dif > 0 ? "Faltam " : "Sobram ") + esc(F.moeda(Math.abs(dif)))) + "</button></div>";
    return h;
  }
  /* 31/10: prazo diferente da proposta — o prazo novo e a comissão pela regra (5% / 4,75% / 4,5%) */
  var PCT_PRAZO = { 24: 0.05, 36: 0.0475, 48: 0.045 };
  function htmlPrazoPlacar(ed) {
    var F = FL(), p = F.prazoDasLinhas(ed.linhas), pp = ed.padrao ? F.prazoDasLinhas(ed.padrao.linhas || []) : null;
    if (p === null || pp === null || p === pp || ed.semComissao) return "";
    return "<span>Prazo: <b>" + p + "x</b> (proposta " + pp + "x) · comissão pela regra: <b>" + String(PCT_PRAZO[p] * 100).replace(".", ",") + "% = " +
      esc(F.moeda(Math.round(ed.valor * PCT_PRAZO[p] * 100) / 100)) + "</b></span>";
  }
  function dataHoraBR(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return m[3] + "/" + m[2] + " " + m[4] + ":" + m[5]; }
  }

  var MSG_MC = {
    MC_NAO_CONFIGURADO: "O lançamento no Mais Controle não está configurado neste ambiente.",
    MC_JA_LANCADA: "Esta venda já foi lançada no Mais Controle.",
    MC_PROCESSANDO: "O robô ainda está processando — aguarde e clique em Atualizar.",
    MC_SEM_PREVIA: "Veja a prévia primeiro: o lançamento só é liberado com PRÉVIA OK.",
    MC_DISPARO_FALHOU: "Não consegui acionar o robô do Mais Controle — tente de novo."
  };
  function mensagemMC(r) {
    var e = String((r && r.erro) || "");
    return MSG_MC[e] || mensagemDeErro(e);
  }
  var MC_URL_VENDA = "https://acessar.maiscontroleerp.com.br/#/readjustment-sale/edit/";
  /* Situação do robô em {titulo, itens:[{texto, sub}]}. Texto novo (venda/mc/lancar.py): uma linha por
   * tópico, a 1ª é o cabeçalho e "- " marca o detalhe das parcelas. Texto antigo, numa linha só
   * ("CRIADA no Mais Controle (venda X) — a; b"), vira cabeçalho + tópicos separados por "; ".
   * Os carimbos internos [t=…] e [#…] não aparecem. */
  function topicosMC(situacao) {
    var s = String(situacao || "").replace(/\s*\[t=\d+\]/g, "").replace(/\s*\[#[0-9a-f]{8}\]/g, "").trim();
    var linhas = s.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    if (linhas.length > 1) {
      return { titulo: linhas[0], itens: linhas.slice(1).map(function (l) {
        return /^- /.test(l) ? { texto: l.slice(2), sub: true } : { texto: l, sub: false };
      }) };
    }
    var m = /^((?:BLOQUEADO:.*?— )?(?:PR[ÉE]VIA OK|CRIADA|J[ÁA] LAN[ÇC]ADA)[^—]*?) — (.+)$/.exec(s);
    if (m) return { titulo: m[1], itens: m[2].split(/;\s*/).filter(function (x) { return x; }).map(function (x) { return { texto: x, sub: false }; }) };
    return { titulo: s, itens: [] };
  }
  /* e = {situacao, vendaId}; u = {ocupado, msg, testes} */
  function htmlMC(e, u) {
    /* PROCESSANDO com mais de 15 min (carimbo [t=ms]) = o robô não respondeu: libera pedir de novo */
    var tProc = e && /\[t=(\d+)\]/.exec(e.situacao || "");
    var testes = !!u.testes, processando = !!(e && /^PROCESSANDO/.test(e.situacao || "") &&
      !(tProc && (u.agora || Date.now()) - Number(tProc[1]) > 15 * 60 * 1000));
    var ocupado = !!u.ocupado || processando;
    var h = '<div class="grp">Mais Controle</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    var sit = (e.situacao || "ainda não lançada").replace(/\s*\[t=\d+\]/, "");
    var tp = topicosMC(sit);
    /* o id da venda já aparece na linha de baixo (e no link): não repete entre parênteses (pedido do dono, 08/10) */
    var tituloMC = String(tp.titulo || "").replace(/\s*\(venda [0-9a-f-]{8,}\)/i, "");
    h += '<div class="dz-linha"><span class="dz-rot">Situação: <b>' + esc(tituloMC) + "</b></span></div>";
    if (tp.itens.length) {
      h += '<ul class="mc-topicos">' + tp.itens.map(function (it) {
        return "<li" + (it.sub ? ' class="mc-sub"' : "") + ">" + esc(it.texto) + "</li>";
      }).join("") + "</ul>";
    }
    if (e.vendaId) {
      h += '<div class="dz-linha"><span class="dz-rot">Venda no Mais Controle: ' + esc(e.vendaId) + "</span>" +
        '<a class="mc-abrir" href="' + esc(MC_URL_VENDA + encodeURIComponent(String(e.vendaId).trim())) +
        '" target="_blank" rel="noopener noreferrer">Abrir no Mais Controle</a></div>';
    }
    if (processando) h += '<div class="dz-linha"><b>o robô está trabalhando… (1 a 3 minutos)</b></div>';
    var liberaLancar = /^PR[ÉE]VIA OK/i.test(sit) && !e.vendaId;
    var d = function (x) { return (x || testes) ? " disabled" : ""; };
    h += '<div class="dz-linha">';
    if (!e.vendaId) h += '<button type="button" class="bt ghost bt-mini" data-acao="mc-previa"' + d(ocupado) + ">Ver prévia</button> ";
    if (!e.vendaId) h += '<button type="button" class="bt bt-mini" data-acao="mc-lancar"' + d(ocupado || !liberaLancar) + ">Lançar no Mais Controle</button> ";
    h += '<button type="button" class="bt ghost bt-mini" data-acao="mc-atualizar"' + (u.ocupado ? " disabled" : "") + ">Atualizar</button></div>";
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    return h;
  }

  /* ---- entrega 14: bloco "Recebimentos" (Sinal, Entrada, Financiamento) ----
   * e = { itens: [{ id, rotulo, esperado, data, comprovantes, por, confirmado }], emailConfigurado } (recebimentoEstado);
   * u = { ocupado: id|null, msg, testes, rascunho: { id: data digitada }, arquivos: { id: File escolhido } }. */
  var MSG_REC = {
    COMPROVANTE_OBRIGATORIO: "Escolha o comprovante (foto ou PDF) antes de confirmar.",
    DATA_INVALIDA: "Data do recebimento inválida (não pode ser depois de hoje).",
    ITEM_INVALIDO: "Item de recebimento desconhecido — recarregue a página.",
    SO_CASA: "Recebimentos só existem na casa da VENDAS.",
    RECEBIMENTO_OCUPADO: "Outro recebimento está sendo salvo — tente de novo em instantes.",
    SEM_PERMISSAO_TESTES: "O perfil TESTES só consulta; não confirma recebimento.",
    ACAO_DESCONHECIDA: "Os recebimentos ainda não foram ligados neste ambiente (falta atualizar o PORTAL-VENDA)."
  };
  function dataRec(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function moedaRec(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /* rotulo = o item confirmado (mensagem de sucesso) */
  function mensagemRec(r, rotulo) {
    r = r || {};
    var e = String(r.erro || "");
    if (!e) {
      var feito = "Recebimento" + (rotulo ? " do " + rotulo : "") + " confirmado";
      if (r.aviso === "EMAIL_NAO_CONFIGURADO") return feito + ", mas o e-mail de aviso não está configurado (RECEBIMENTO_EMAILS) — avise o administrador.";
      if (r.aviso === "EMAIL_FALHOU") return feito + ", mas o e-mail de aviso não saiu — avise o administrador.";
      return feito + (r.emails ? " — e-mail de aviso enviado." : ".");
    }
    if (e === "GRAVACAO_FALHOU" && r.arquivoGuardado) return "O comprovante foi guardado, mas a data não — confirme de novo.";
    return MSG_REC[e] || mensagemDeErro(e);
  }
  function htmlRecebimentos(e, u) {
    u = u || {};
    var testes = !!u.testes, ocupado = !!u.ocupado;
    var h = '<div class="grp">Recebimentos</div>';
    if (testes) h += '<div class="dz-aviso">Perfil TESTES só consulta.</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    var dis = (ocupado || testes) ? " disabled" : "", rasc = u.rascunho || {}, arqs = u.arquivos || {};
    (e.itens || []).forEach(function (it) {
      var id = esc(it.id), esperado = moedaRec(it.esperado);
      h += '<div class="dz-linha rec-item"><span class="dz-rot"><b>' + esc(it.rotulo) + "</b> — valor esperado: " +
        (esperado ? "<b>" + esc(esperado) + "</b>" : "<i>sem valor no contrato</i>") + "</span></div>";
      h += '<div class="dz-linha"><span class="dz-rot">' + (it.confirmado
        ? '<span class="rec-ok">✓ Recebido em ' + esc(dataRec(it.data)) + "</span>" + (it.por ? " por " + esc(it.por) : "") +
          " · " + (it.comprovantes ? it.comprovantes + (it.comprovantes === 1 ? " comprovante" : " comprovantes") : "sem comprovante")
        : '<span class="rec-pend">Aguardando confirmação</span>') + "</span></div>";
      var data = it.id in rasc ? rasc[it.id] : (it.data || "");
      var escolhido = arqs[it.id] && arqs[it.id].name ? ' <small class="rec-arq">escolhido: ' + esc(arqs[it.id].name) + "</small>" : "";
      h += '<div class="dz-linha"><label class="dz-campo">Data do recebimento <input type="date" data-rec-data="' + id + '" value="' + esc(data) + '"' + dis + "></label> " +
        '<label class="dz-campo">Comprovante <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-rec-arq="' + id + '"' + dis + "></label>" + escolhido + " " +
        '<button type="button" class="bt bt-mini" data-acao="r-confirmar" data-item="' + id + '"' + dis + ">" +
        (it.confirmado ? "Confirmar de novo (corrigir)" : "Confirmar recebimento") + "</button>" +
        (u.ocupado === it.id ? " <b>salvando…</b>" : "") + "</div>";
    });
    if (e.emailConfigurado === false) h += '<div class="dz-msg dz-nota">O e-mail de aviso ainda não está configurado: o recebimento grava, mas ninguém é avisado.</div>';
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    return h;
  }

  var exportar = { URL_PORTAL_VENDA: URL_PORTAL_VENDA, DOCS: DOCS, html: html, mensagemDeErro: mensagemDeErro,
                   htmlRecebimentos: htmlRecebimentos, mensagemRec: mensagemRec,
                   htmlConferencia: htmlConferencia, htmlCorrigir: htmlCorrigir, htmlFinanceiro: htmlFinanceiro,
                   htmlAntecipacao: htmlAntecipacao, htmlAntResultado: htmlAntResultado, mensagemAnt: mensagemAnt, antCalcular: antCalcular,
                   DOCS_IMOVEL: DOCS_IMOVEL, htmlImovel: htmlImovel, dadosImovel: dadosImovel, htmlLoteamento: htmlLoteamento,
                   grupoDoEspaco: grupoDoEspaco,
                   linhaDoc: linhaDoc, htmlLerTodos: htmlLerTodos, resultadosLote: resultadosLote, resumoLote: resumoLote,
                   detalheGravado: detalheGravado, EVENTO_GRAVADO: EVENTO_GRAVADO,
                   htmlSoltar: htmlSoltar, pessoasDoEnvio: pessoasDoEnvio, conferirEscolhas: conferirEscolhas,
                   destinosDoEnvio: destinosDoEnvio, resultadoPorEspaco: resultadoPorEspaco,
                   resumo: resumo, escala: escala, tipoAceito: tipoAceito, painelCarregando: painelCarregando,
                   htmlContrato: htmlContrato, etapaContrato: etapaContrato, estadoContrato: estadoContrato, mensagemContrato: mensagemContrato, htmlMC: htmlMC, mensagemMC: mensagemMC,
                   topicosMC: topicosMC, MC_URL_VENDA: MC_URL_VENDA, htmlTestemunhas: htmlTestemunhas,
                   htmlCampos: htmlCampos, htmlConta: htmlConta, htmlFluxo: htmlFluxo, htmlFluxoVivo: htmlFluxoVivo, htmlFluxoDesconto: htmlFluxoDesconto, lerNumBR: lerNumBR, contaDoEstado: contaDoEstado, pedidoCampos: pedidoCampos,
                   contaDasEntradas: contaDasEntradas, faltasDaResposta: faltasDaResposta, detalheFluxoGravado: detalheFluxoGravado };
  if (typeof module !== "undefined" && module.exports) { module.exports = exportar; return; }

  /* ---------------- navegador ---------------- */
  /* Painel da casa (vendas.html): mesmas margens das outras seções — título .grp com margem de 22px e
   * conteúdo como o .campo (padding 0 22px). No cartão do condomínio (.cd-cardbox) os blocos não têm
   * esse recuo. Os blocos de contrato/assinatura/Mais Controle moram em .vb-blocos (.vb-ass / .vb-mc). */
  var NO_PAINEL = ["#dossie-wrap", "#pn-body .vb-blocos", "#pn-body .vb-ass", "#pn-body .vb-rec", "#pn-body .vb-mc"];
  function emCada(sufixo) { return NO_PAINEL.map(function (b) { return b + sufixo; }).join(","); }
  var CSS = "#dossie-wrap .dz-linha,.vb-blocos .dz-linha{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}" +
    "#dossie-wrap .dz-rot,.vb-blocos .dz-rot{flex:1 1 200px}#dossie-wrap .on{outline:2px solid #4cd964}" +
    "#dossie-wrap .dz-aviso,.vb-blocos .dz-aviso{color:#E67E22;margin:6px 0}" +
    "#dossie-wrap .dz-msg,.vb-blocos .dz-msg{margin-top:8px;font-weight:600}" +
    "#dossie-wrap pre,.vb-blocos pre{white-space:pre-wrap;font:inherit;margin:4px 0}" +
    ".vb-blocos ul{margin:4px 0 4px 18px}.vb-blocos ul li{margin:2px 0}" +
    /* entrega 13: espaço anexado e ainda não lido; resultado da leitura em lote */
    "#dossie-wrap .dz-novo{color:#B45309;font-weight:700}#dossie-wrap .dz-lote{margin-top:10px}" +
    "#dossie-wrap .dz-res li.dz-erro{color:#C0392B}" +
    "#dossie-wrap .dz-soltar{margin:8px 22px;padding:14px;border:2px dashed var(--border,#b8c4cb);border-radius:10px;text-align:center}" +
    "#dossie-wrap .dz-soltar.dz-off{opacity:.6}#dossie-wrap select{max-width:100%}" +
    /* entrega 12: formulário dos cadastros e conta de recebimento */
    ".vb-blocos input[type=text],.vb-blocos input[type=email],.vb-blocos input[type=number],.vb-blocos select{padding:6px 8px;" +
    "border:1px solid var(--border,#d6dee3);border-radius:6px;font:inherit;max-width:100%;box-sizing:border-box}" +
    ".vb-blocos .dz-linha>input{flex:1 1 220px}.vb-blocos .dz-campo{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap}" +
    ".vb-blocos .dz-grupo{margin-top:12px}.vb-blocos .dz-nota{font-weight:400;color:var(--text3,#555)}" +
    emCada(">.dz-linha") + "{margin:6px 22px}" + emCada(">.dz-aviso") + "{margin:6px 22px}" +
    emCada(">.dz-msg") + "{margin:8px 22px 0}" + emCada(">pre") + "{margin:4px 22px}" +
    emCada(">ul") + "{margin:4px 22px;padding-left:18px}" +
    ".vb-mc .mc-sub{list-style:circle;margin-left:14px;color:var(--text3,#555)}" +
    /* 28/10 (dono): assinou em verde, pendente em amarelo com ⏳ — também na assinatura do termo de pré-reserva */
    ".vb-ass .ass-ok,.vb-pr-ass .ass-ok{color:#1E8E4E;font-weight:700}.vb-ass .ass-pend,.vb-pr-ass .ass-pend{color:#B7791F;font-weight:700}" +
    ".vb-ass .ass-rec,.vb-pr-ass .ass-rec{color:#C0392B;font-weight:700}.vb-ass .ass-data,.vb-pr-ass .ass-data{color:var(--text3,#555);font-size:12px}" +
    ".vb-mc a.mc-abrir{color:var(--azul,#1d4f63);font-weight:700}" +
    /* entrega 14: Recebimentos */
    ".vb-rec .rec-ok{color:var(--verde,#2a9d5c);font-weight:700}.vb-rec .rec-pend{color:#B45309;font-weight:700}" +
    ".vb-rec .rec-item{margin-top:12px}.vb-rec .rec-arq{color:var(--text3,#555)}" +
    ".vb-blocos input[type=date]{padding:6px 8px;border:1px solid var(--border,#d6dee3);border-radius:6px;font:inherit}" +
    /* no cartão do condomínio os títulos não têm o recuo do painel da casa */
    ".cd-cardbox .vb-blocos .grp{margin:14px 0 8px}.cd-cardbox .vb-blocos .vazio{padding:10px}" +
    /* ...e os botões seguem os do próprio cartão (.cd-bt / .cd-bt.pri do vendas.html), não os do painel */
    ".cd-cardbox .vb-blocos .bt{border:1.5px solid var(--verde-btn,#4cd964);background:var(--verde-btn,#4cd964);color:#1a3347;" +
    "border-radius:8px;padding:8px 12px;font-size:13px}" +
    ".cd-cardbox .vb-blocos .bt.ghost{border-color:var(--border,#d6dee3);background:var(--sup,#fff);color:var(--azul,#295778)}" +
    ".cd-cardbox .vb-blocos .bt.ghost:hover{background:var(--bg3,#eef3f5)}" +
    /* 31/10/2026: linha valor / data / Salvar da pré-reserva alinhada pela base; no celular, na largura toda */
    /* 31/10/2026 (dono, ~1100 px): a conferência cabe no cartão — colunas fixas, texto quebra, botões quebram na célula */
    ".vb-blocos .vb-conf table.dz-tab{table-layout:fixed;width:100%}" +
    ".vb-blocos .vb-conf table.dz-tab th,.vb-blocos .vb-conf table.dz-tab td{white-space:normal;overflow-wrap:anywhere;vertical-align:top;padding:6px;line-height:1.35}" +
    ".vb-blocos .vb-conf table.dz-tab th:nth-child(1){width:20%}.vb-blocos .vb-conf table.dz-tab th:nth-child(2){width:12%}" +
    ".vb-blocos .vb-conf table.dz-tab th:nth-child(3),.vb-blocos .vb-conf table.dz-tab th:nth-child(4){width:20%}" +
    ".vb-blocos .vb-conf table.dz-tab th:nth-child(5){width:28%}" +
    ".vb-blocos .vb-conf table.dz-tab td>div{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}" +
    ".vb-blocos .vb-conf table.dz-tab td>div.ass-data{display:block}" +
    ".vb-blocos .vb-conf table.dz-tab .bt{white-space:normal;max-width:100%;margin:0}" +
    ".vb-blocos .vb-conf>div[style*=\"overflow-x\"]{overflow-x:visible!important}" +
    ".vb-blocos .dz-pr-pag{align-items:flex-end;gap:12px}" +
    ".vb-blocos .dz-pr-pag label{display:flex;flex-direction:column;gap:3px;flex:0 0 auto;margin:0}" +
    ".vb-blocos .dz-pr-pag label span{font-size:11.5px;font-weight:700;color:var(--text3,#5a8099)}" +
    ".vb-blocos .dz-pr-pag input{height:36px;box-sizing:border-box;padding:6px 9px;border:1.5px solid var(--border,#d6dee3);border-radius:7px;font:inherit;margin:0}" +
    ".vb-blocos .dz-pr-pag .bt{height:36px;margin:0}" +
    "@media (max-width:600px){.vb-blocos .dz-pr-pag{flex-direction:column;align-items:stretch}" +
    ".vb-blocos .dz-pr-pag label,.vb-blocos .dz-pr-pag input,.vb-blocos .dz-pr-pag .bt{width:100%!important}}";
  var estado = null, ui = { dois: false, ocupado: null, msg: "", testes: false }, paginaDoBloco = null;

  function obraAberta() { try { return OBRA_ABERTA; } catch (e) { return null; } }
  function mesmaCasa(pageId) { return obraAberta() === pageId && paginaDoBloco === pageId; }
  function perfilTestes() {
    var s = (typeof sessao === "function") ? sessao() : null;
    return !!(s && String(s.tipo || "").toUpperCase() === "TESTES");
  }
  function wrap() { return document.getElementById("dossie-wrap"); }
  function pintar() {
    var w = wrap(); if (!w) return;
    w.innerHTML = estado ? html(estado, ui)
      : '<div class="grp">Dossiê do comprador</div><div class="vazio">' + esc(ui.msg || "carregando…") + "</div>";
  }
  async function chamarVenda(payload, ms) {
    if (!/^https:\/\/script\.google\.com\//.test(URL_PORTAL_VENDA)) return { ok: false, erro: "PORTAL_VENDA_NAO_CONFIGURADO" };
    var s = (typeof sessao === "function") ? sessao() : null;
    payload.token = s && s.token;
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, ms || 45000);
    try {
      var r = await fetch(URL_PORTAL_VENDA, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                                             body: JSON.stringify(payload), signal: ctrl.signal });
      return await r.json();
    } catch (e) { return { ok: false, erro: "SEM_RESPOSTA" }; }
    finally { clearTimeout(t); }
  }
  async function carregarEstado(pageId) {
    var r = await chamarVenda({ action: "estado", pageId: pageId });
    if (!mesmaCasa(pageId)) return;
    if (r.ok) {
      estado = r; if (r.doisCompradores) ui.dois = true;
      if (r.tipoCasaPelaObra) avisarGravado(pageId, { ok: true, gravados: { "TIPO DE CASA": r.tipoCasa } });   // gravado pela obra ao abrir
    }
    else ui.msg = mensagemDeErro(r.erro);
    pintar();
  }
  function lerArquivoBase64(blob) {
    return new Promise(function (ok, falha) {
      var fr = new FileReader();
      fr.onload = function () { ok(String(fr.result).split(",")[1]); };
      fr.onerror = falha;
      fr.readAsDataURL(blob);
    });
  }
  async function prepararArquivo(file) {
    var tipo = tipoAceito(file.type);
    if (!tipo) return { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" };
    if (tipo === "pdf") {
      if (file.size > 10 * 1024 * 1024) return { erro: "ARQUIVO_GRANDE" };
      return { nome: file.name, mime: "application/pdf", base64: await lerArquivoBase64(file) };
    }
    var url = URL.createObjectURL(file);
    try {
      var img = await new Promise(function (ok, falha) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = falha; i.src = url; });
      var d = escala(img.naturalWidth, img.naturalHeight, 1600);
      var cv = document.createElement("canvas"); cv.width = d.w; cv.height = d.h;
      cv.getContext("2d").drawImage(img, 0, 0, d.w, d.h);
      var jpg = await new Promise(function (ok) { cv.toBlob(ok, "image/jpeg", 0.85); });
      return { nome: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", base64: await lerArquivoBase64(jpg) };
    } catch (e) { return { erro: "TIPO_DE_ARQUIVO_NAO_SUPORTADO" }; }
    finally { URL.revokeObjectURL(url); }
  }
  /* multiplo: devolve a lista de arquivos escolhidos (Anexar: frente e verso de uma vez) */
  function escolherArquivo(multiplo) {
    return new Promise(function (ok) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp,application/pdf";
      if (multiplo) inp.multiple = true;
      var resolvido = false;
      function resolver(f) {
        if (resolvido) return;
        resolvido = true;
        window.removeEventListener("focus", aoFocar);
        ok(f);
      }
      function aoFocar() {
        window.removeEventListener("focus", aoFocar);
        /* Navegador sem o evento "cancel" no <input type=file>: se ao voltar
         * o foco pra janela nenhum arquivo foi escolhido, foi cancelamento —
         * mas dá uma folga pro "change" (que também dispara perto do foco)
         * resolver primeiro quando um arquivo FOI escolhido. */
        setTimeout(function () {
          if (!resolvido && !(inp.files && inp.files.length)) resolver(null);
        }, 500);
      }
      inp.onchange = function () { resolver(multiplo ? Array.prototype.slice.call(inp.files || []) : inp.files && inp.files[0]); };
      inp.addEventListener("cancel", function () { resolver(null); });
      /* Com "cancel" nativo, o cancelamento já chega por esse evento — a
       * folga de 500 ms do fallback "focus" pode descartar um arquivo
       * escolhido da nuvem no Android, cujo "change" chega depois disso. */
      if (!("oncancel" in inp)) window.addEventListener("focus", aoFocar);
      inp.click();
    });
  }
  function avisarGravado(pageId, r) {
    try { window.dispatchEvent(new CustomEvent(EVENTO_GRAVADO, { detail: detalheGravado(pageId, r) })); }
    catch (e) { /* navegador sem CustomEvent: o painel só atualiza ao reabrir a casa */ }
  }
  async function depoisDeGravar(pageId, r, texto, foiLerDocumento, grupo) {
    /* entrega 13: avisa o painel mesmo se a casa já saiu da tela (ele decide se recarrega) */
    if (r && r.ok) avisarGravado(pageId, r);
    if (!mesmaCasa(pageId)) return;
    ui.ocupado = null; ui.ocupadoTexto = "";
    if (!/^lote-/.test(grupo || "")) ui.resultados = null;
    ui.msgGrupo = grupo || "comprador";
    ui.msg = r.ok ? texto : mensagemDeErro(r.erro, r.arquivoGuardado, foiLerDocumento);
    if (r.ok && r.loteamento) ui.loteamento = r.loteamento;
    await carregarEstado(pageId);
    if (mesmaCasa(pageId) && typeof abrirObra === "function") abrirObra(pageId);
  }
  async function aoClicar(ev) {
    var b = ev.target.closest("[data-acao]"); if (!b || b.disabled) return;
    var pageId = obraAberta(), acao = b.getAttribute("data-acao"), r;
    if (!pageId) return;
    if (acao === "dois") { ui.dois = b.getAttribute("data-valor") === "2"; pintar(); return; }
    if (ui.ocupado) return;
    if (acao === "tipo") {
      ui.ocupado = "tipo"; pintar();
      r = await chamarVenda({ action: "tipoCasa", pageId: pageId, valor: b.getAttribute("data-valor") });
      return depoisDeGravar(pageId, r, "Tipo de casa gravado.");
    }
    if (acao === "soltar-escolher") {
      var lista = await escolherArquivo(true);
      if (lista && lista.length && mesmaCasa(pageId)) return soltarArquivos(pageId, lista);
      return;
    }
    if (acao === "soltar-confirmar") return confirmarSoltos(pageId);
    if (acao === "anexar" || acao === "trocar") return anexarNoEspaco(pageId, b.getAttribute("data-espaco"), acao === "trocar");
    if (acao === "reler") {
      var espaco = b.getAttribute("data-espaco"), grupoEsp = grupoDoEspaco(espaco);
      ui.ocupado = espaco; ui.ocupadoTexto = "lendo…"; ui.msg = ""; ui.msgGrupo = grupoEsp; ui.resultados = null;
      if (grupoEsp === "imovel") ui.loteamento = null;
      pintar();
      r = await chamarVenda({ action: "lerDocumento", pageId: pageId, espaco: espaco }, 150000);
      return depoisDeGravar(pageId, r, r.ok ? resumo(r) : "", true, grupoEsp);
    }
    if (acao === "ler-todos") {
      var onde = b.getAttribute("data-onde") === "imovel" ? "imovel" : "topo";
      ui.ocupado = "lote"; ui.msg = ""; ui.msgGrupo = "lote-" + onde; ui.resultados = null; ui.loteamento = null;
      pintar();
      r = await chamarVenda({ action: "lerDocumentos", pageId: pageId }, 330000);
      if (mesmaCasa(pageId)) {
        ui.resultados = resultadosLote(r);
        if (r.loteamento) ui.loteamento = r.loteamento;
      }
      return depoisDeGravar(pageId, r, r.ok ? resumoLote(r) : "", false, "lote-" + onde);
    }
    if (acao === "copiar-comprovante") {
      if (!window.confirm("Usar o mesmo comprovante de endereço do comprador 1 para o comprador 2? O endereço do comprador 1 é copiado e o arquivo dele vai para o espaço do comprador 2 (substitui o que estiver lá).")) return;
      ui.ocupado = "C2_COMPROVANTE"; ui.ocupadoTexto = "copiando…"; ui.msg = ""; ui.msgGrupo = "comprador"; pintar();
      r = await chamarVenda({ action: "copiarComprovante", pageId: pageId }, 150000);
      return depoisDeGravar(pageId, r, "Comprovante e endereço do comprador 1 copiados para o comprador 2 — confira.", false, "comprador");
    }
    var grupo = b.getAttribute("data-grupo") === "imovel" ? "imovel" : "comprador";
    var nomeDossie = grupo === "imovel" ? "Dossiê do imóvel" : "Dossiê";
    if (acao === "conferir") {
      ui.ocupado = "conferir"; pintar();
      r = await chamarVenda({ action: "conferir", pageId: pageId, grupo: grupo });
      return depoisDeGravar(pageId, r, nomeDossie + " marcado como conferido.", false, grupo);
    }
    if (acao === "devolver") {
      var motivo = window.prompt("Motivo da devolução (o que falta ou está errado):");
      if (!motivo || !motivo.trim()) return;
      ui.ocupado = "devolver"; pintar();
      r = await chamarVenda({ action: "devolver", pageId: pageId, motivo: motivo, grupo: grupo });
      return depoisDeGravar(pageId, r, nomeDossie + " devolvido.", false, grupo);
    }
  }
  /* ---- "Soltar todos os documentos": identifica cada arquivo (3 de cada vez), guarda o que é do imóvel,
   * pergunta quem é quem para os documentos de pessoa e, confirmado, guarda e lê tudo numa leitura só ---- */
  var seqSolto = 0, prontosSoltos = {};   // base64 dos arquivos que esperam confirmação (só na memória da tela)
  async function soltarArquivos(pageId, files) {
    if (!files || !files.length || ui.ocupado || ui.testes || !estado || !estado.tipoCasa) return;
    ui.soltar = { arquivos: [], pessoas: {} }; prontosSoltos = {};
    ui.ocupado = "soltar"; ui.msg = ""; ui.msgGrupo = "comprador"; ui.resultados = null;
    var lista = Array.prototype.slice.call(files).map(function (f) {
      var a = { id: "s" + (++seqSolto), nome: f.name, estado: "classificando" };
      ui.soltar.arquivos.push(a);
      return { a: a, f: f };
    });
    pintar();
    var fila = lista.slice();
    async function trabalhar() {
      while (fila.length) {
        var x = fila.shift(), a = x.a;
        var arq = await prepararArquivo(x.f);
        if (arq.erro) { a.estado = "erro"; a.erro = mensagemDeErro(arq.erro); }
        else {
          var r = await chamarVenda({ action: "soltarDocumento", pageId: pageId, arquivo: arq }, 120000);
          if (!r.ok) { a.estado = "erro"; a.erro = mensagemDeErro(r.erro); }
          else {
            a.tipo = r.tipo; a.espaco = r.espaco || null;
            if (r.guardado) a.estado = "guardado";
            else if (r.pessoa) { a.estado = "pessoa"; a.pessoa = r.pessoa; a.sugestao = r.sugestao || ""; prontosSoltos[a.id] = arq; }
            else { a.estado = "desconhecido"; prontosSoltos[a.id] = arq; }
          }
        }
        if (mesmaCasa(pageId)) pintar();
      }
    }
    await Promise.all([trabalhar(), trabalhar(), trabalhar()]);
    if (!mesmaCasa(pageId)) return;
    var guardou = ui.soltar.arquivos.some(function (a) { return a.estado === "guardado"; });
    if (guardou) avisarGravado(pageId, { ok: true });
    var espera = ui.soltar.arquivos.some(function (a) { return a.estado === "pessoa" || a.estado === "desconhecido"; });
    ui.ocupado = null;
    if (espera) {
      ui.msg = "Confira abaixo quem é cada comprador" + (guardou ? " (os documentos do imóvel já foram guardados)" : "") + " e clique em Confirmar compradores e ler.";
      await carregarEstado(pageId);
      return;
    }
    if (guardou) return lerDoEnvio(pageId);
    ui.msg = "Nenhum arquivo foi guardado."; pintar();
  }
  async function confirmarSoltos(pageId) {
    var s = ui.soltar;
    if (!s || conferirEscolhas(s)) return;
    ui.ocupado = "soltar"; ui.msg = ""; pintar();
    var destinos = destinosDoEnvio(s), porId = {};
    s.arquivos.forEach(function (a) { porId[a.id] = a; });
    pessoasDoEnvio(s).forEach(function (p) {
      if (p.escolha === "NAO") s.arquivos.forEach(function (a) { if (a.estado === "pessoa" && chavePessoa(a) === p.chave) a.estado = "ignorado"; });
      if (p.escolha === "C2") ui.dois = true;
    });
    s.arquivos.forEach(function (a) { if (a.estado === "desconhecido" && a.escolha === "IGNORAR") a.estado = "ignorado"; });
    for (var i = 0; i < destinos.length; i++) {
      var a = porId[destinos[i].id];
      var r = await chamarVenda({ action: "anexarDocumento", pageId: pageId, espaco: destinos[i].espaco, arquivo: prontosSoltos[a.id] }, 120000);
      if (r.ok) { a.estado = "guardado"; a.espaco = destinos[i].espaco; delete prontosSoltos[a.id]; }
      else { a.estado = "erro"; a.erro = mensagemDeErro(r.erro); }
      if (mesmaCasa(pageId)) pintar();
    }
    if (!mesmaCasa(pageId)) return;
    ui.ocupado = null;
    return lerDoEnvio(pageId);
  }
  /* lê os espaços novos (o mesmo "Ler documentos") e escreve o resultado em cada arquivo do envio */
  async function lerDoEnvio(pageId) {
    ui.ocupado = "lote"; pintar();
    var r = await chamarVenda({ action: "lerDocumentos", pageId: pageId }, 330000);
    if (mesmaCasa(pageId) && ui.soltar) {
      var por = resultadoPorEspaco(r);
      ui.soltar.arquivos.forEach(function (a) { if (a.estado === "guardado" && a.espaco && por[a.espaco]) a.resultado = por[a.espaco]; });
      if (r.loteamento) ui.loteamento = r.loteamento;
    }
    return depoisDeGravar(pageId, r, r.ok ? resumoLote(r) : "", false, "comprador");
  }
  function aoEscolherSolto(ev) {
    var t = ev.target, s = ui.soltar;
    if (!s || !t || !t.getAttribute) return;
    if (t.hasAttribute("data-pessoa")) s.pessoas[t.getAttribute("data-pessoa")] = t.value;
    else if (t.hasAttribute("data-arquivo")) s.arquivos.forEach(function (a) { if (a.id === t.getAttribute("data-arquivo")) a.escolha = t.value; });
    else return;
    pintar();
  }
  /* Anexar (soma) ou Trocar (o 1º arquivo substitui os do espaço, os outros somam): só guarda, não lê */
  async function anexarNoEspaco(pageId, espaco, trocar) {
    if (trocar && !window.confirm("Trocar o documento? Os arquivos atuais deste espaço serão removidos. A leitura acontece em Ler documentos.")) return;
    var grupoEsp = grupoDoEspaco(espaco);
    ui.ocupado = espaco; ui.ocupadoTexto = "escolha o arquivo…"; ui.msg = ""; ui.msgGrupo = grupoEsp; ui.resultados = null; pintar();
    var lista = await escolherArquivo(true);
    if (!lista || !lista.length) { if (mesmaCasa(pageId)) { ui.ocupado = null; pintar(); } return; }
    var r = { ok: false, erro: "SEM_ARQUIVO" }, feitos = 0;
    for (var i = 0; i < lista.length; i++) {
      if (mesmaCasa(pageId)) { ui.ocupadoTexto = "anexando " + (i + 1) + " de " + lista.length + "…"; pintar(); }
      var arq = await prepararArquivo(lista[i]);
      if (arq.erro) { r = { ok: false, erro: arq.erro }; break; }
      r = await chamarVenda({ action: "anexarDocumento", pageId: pageId, espaco: espaco, arquivo: arq, trocar: trocar && i === 0 }, 120000);
      if (!r.ok) break;
      feitos++;
    }
    var texto = feitos === 1 ? "Arquivo anexado — clique em Ler documentos quando terminar de anexar." :
      feitos + " arquivos anexados — clique em Ler documentos quando terminar de anexar.";
    if (feitos && !r.ok) {
      return depoisDeGravar(pageId, { ok: true }, feitos + " de " + lista.length + " anexados; o seguinte falhou: " + mensagemDeErro(r.erro), false, grupoEsp);
    }
    return depoisDeGravar(pageId, r, texto, false, grupoEsp);
  }
  /* ---- blocos Contrato / Assinatura / Mais Controle ----
   * Um conjunto por página: a casa da VENDAS no painel (#pn-body) ou, desde a entrega 7, a
   * linha do condomínio no cartão da "Planilha Casas Condomínio" (window.VendaBlocos.montar).
   * Cada conjunto guarda o próprio estado; `ativo(conjunto)` diz se ele ainda é o da tela —
   * resposta de um conjunto que saiu da tela é descartada. Ao abrir, os três estados são
   * pedidos em paralelo, uma vez só: redesenhar a tela (anexar de novo) não pede outra vez. */
  function novoUiC() { return { ocupadoContrato: null, faltas: null, campos: null, rascunho: {}, msg: "", testes: perfilTestes() }; }
  function novoUiM() { return { ocupado: null, msg: "", testes: perfilTestes() }; }
  /* ---- 27/10/2026: Termo de Pré-Reserva (só no condomínio, antes do contrato) ----
   * e = { conta, gerado, nome, valor, dataLimite } (preReservaEstado); u = { msg, faltas, ocupado, testes }.
   * Comandos: pr-salvar-conta (grava a conta para devolução na linha), pr-gerar, pr-ver (PDF pelo portal). */
  function brl(n) { return typeof n === "number" ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
  function dataBRpr(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  /* lista para a busca do banco (código COMPE - nome); dá para digitar um que não esteja aqui */
  var BANCOS_BR = ["001 - BANCO DO BRASIL", "104 - CAIXA ECONÔMICA FEDERAL", "237 - BRADESCO", "341 - ITAÚ UNIBANCO", "033 - SANTANDER",
    "756 - SICOOB", "748 - SICREDI", "077 - BANCO INTER", "260 - NUBANK", "336 - C6 BANK", "290 - PAGBANK", "323 - MERCADO PAGO",
    "380 - PICPAY", "212 - BANCO ORIGINAL", "208 - BTG PACTUAL", "655 - BANCO BV", "422 - SAFRA", "070 - BRB", "041 - BANRISUL",
    "004 - BANCO DO NORDESTE", "003 - BANCO DA AMAZÔNIA", "021 - BANESTES", "136 - UNICRED", "085 - AILOS", "623 - BANCO PAN",
    "102 - XP INVESTIMENTOS", "348 - BANCO XP", "197 - STONE", "403 - CORA", "364 - EFÍ", "461 - ASAAS", "389 - MERCANTIL DO BRASIL",
    "707 - DAYCOVAL", "318 - BANCO BMG", "246 - ABC BRASIL", "634 - TRIBANCO", "121 - AGIBANK", "735 - NEON", "637 - SOFISA"];
  var TIPOS_CONTA_PR = ["corrente", "poupança", "pagamento"];
  /* campos da tela a partir do estado (o servidor manda contaCampos já desmontado) */
  function contaDaTela(e) {
    var o = (e && e.contaCampos) || {}, c = {};
    ["forma", "chave", "banco", "agencia", "conta", "tipo", "livre"].forEach(function (k) { c[k] = o[k] || ""; });
    return c;
  }
  /* ---- 28/10/2026: Conferência dos documentos (Conferencia.gs) ----
   * e = { feito, linhas, confirmados, em, por, atual } (conferenciaEstado); u = { ocupado, msg, testes }.
   * Comandos: d-conferir, d-abrir-<i> (o documento pelo portal), d-ok-<i> ("Conferi, está certo"). */
  /* 31/10/2026 (dono, etapa 4): aba Financeiro do cartão do condomínio — as parcelas da venda lidas do Mais Controle
   * (financeiroEstado no PORTAL-VENDA) para o coordenador comercial ver o que está pago, a vencer e em atraso.
   * e = { lancada, lidoEm, semLeitura, parcelas: [{ grupo, numero, de, vencimento, valor, valorCorrigido, situacao
   * ("paga" | "aberta" | "atrasada"), pagoEm, diasAtraso }] }; u = { filtro, todas, msg, carregando }. */
  function htmlFinanceiro(e, u) {
    u = u || {};
    var h = '<div class="grp">Financeiro · parcelas no Mais Controle</div>';
    if (u.carregando || !e) return h + '<div class="vazio">' + esc(u.msg || "lendo as parcelas…") + "</div>";
    if (!e.lancada) return h + '<div class="vazio">A venda ainda não foi lançada no Mais Controle — as parcelas aparecem aqui depois do lançamento (aba Contrato).</div>';
    if (e.semLeitura || !(e.parcelas || []).length)
      return h + '<div class="vazio">Venda lançada no Mais Controle. A leitura diária das parcelas ainda não chegou para esta venda.</div>';
    function brl(v) { return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function dt(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : esc(s || "—"); }
    var P = e.parcelas;
    function soma(k) { return P.filter(function (x) { return x.situacao === k; }).reduce(function (a, x) { return a + Number(x.valorCorrigido || x.valor || 0); }, 0); }
    function qt(k) { return P.filter(function (x) { return x.situacao === k; }).length; }
    var atr = P.filter(function (x) { return x.situacao === "atrasada"; });
    if (atr.length) h += '<div class="cd-falta"><b>' + atr.length + (atr.length > 1 ? " parcelas em atraso" : " parcela em atraso") + "</b> — a mais antiga: " +
      esc(atr[0].grupo) + " " + atr[0].numero + "/" + atr[0].de + ", venceu em " + dt(atr[0].vencimento) + " (" + Number(atr[0].diasAtraso || 0) + " dias).</div>";
    h += '<div class="cd-kpis" style="margin-top:10px">' +
      '<div class="cd-kpi"><small>Pago</small><b>' + brl(soma("paga")) + "</b><span>" + qt("paga") + " parcelas</span></div>" +
      '<div class="cd-kpi"><small>Em atraso</small><b>' + brl(soma("atrasada")) + "</b><span>" + qt("atrasada") + " parcelas</span></div>" +
      '<div class="cd-kpi"><small>A vencer (corrigido)</small><b>' + brl(soma("aberta")) + "</b><span>" + qt("aberta") + " parcelas</span></div></div>";
    var f = u.filtro || "todas", FILTROS = [["todas", "Todas"], ["atrasada", "Em atraso"], ["aberta", "A vencer"], ["paga", "Pagas"]];
    h += '<div class="dz-linha">' + FILTROS.map(function (x) {
      return '<button type="button" class="bt bt-mini' + (x[0] === f ? "" : " ghost") + '" data-acao="f-filtro-' + x[0] + '">' + x[1] + "</button>";
    }).join(" ") + ' <span class="ass-data">lido do Mais Controle em ' + esc(String(e.lidoEm || "").replace("T", " ").slice(0, 16)) + "</span></div>";
    var lista = P.filter(function (x) { return f === "todas" || x.situacao === f; });
    var corte = !u.todas && f === "todas" && lista.length > 12 ? 12 : lista.length;
    var SIT = { paga: '<b class="ass-ok">✓ paga</b>', aberta: '<span class="ass-data">a vencer</span>', atrasada: '<b class="ass-rec">⚠ em atraso</b>' };
    h += '<div style="overflow-x:auto"><table class="cd-fl"><thead><tr><th>Parcela</th><th>Vencimento</th><th style="text-align:right">Valor</th><th style="text-align:right">Corrigido</th><th>Situação</th></tr></thead><tbody>' +
      lista.slice(0, corte).map(function (x) {
        /* data-rot: no celular (vendas.html, < 600 px) cada parcela vira um bloco com o nome de cada campo */
        return '<tr><td data-rot="Parcela">' + esc(x.grupo) + " " + x.numero + "/" + x.de + '</td><td data-rot="Vencimento">' + dt(x.vencimento) +
          '</td><td class="r" data-rot="Valor">' + brl(x.valor) + '</td><td class="r" data-rot="Corrigido">' + brl(x.valorCorrigido || x.valor) +
          '</td><td data-rot="Situação">' + (SIT[x.situacao] || esc(x.situacao)) + (x.situacao === "paga" && x.pagoEm ? ' <span class="ass-data">em ' + dt(x.pagoEm) + "</span>" : "") +
          (x.situacao === "atrasada" ? ' <span class="ass-data">' + Number(x.diasAtraso || 0) + " dias</span>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    if (corte < lista.length) h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="f-todas">Mostrar as ' + lista.length + " parcelas</button></div>";
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    return h;
  }
  /* ---- 31/10/2026: Antecipação de parcelas (spec v2, etapa "simular") — aba Financeiro do cartão do condomínio ----
   * e = resposta do antecipacaoEstado ({ pode, motivo, retrato, lido, velho, processando, erroRobo, temFiador });
   * u = { vendaId, aberto, modo, valor, dataPg, hoje, parcelaId, quantas, tabela, ocupado, lendo, msg, pdf, testes }.
   * A conta roda AQUI, no navegador (venda/Antecipacao.js, a mesma do servidor): digitar valor, data ou jeito não chama o
   * servidor. O servidor refaz a conta antes de gerar o PDF. Comandos (data-acao): an-abrir, an-ler, an-modo, an-usar,
   * an-todas, an-ultimas, an-tabela, an-pdf, an-copiar. Campos (data-an): valor, data, parcela, quantas. */
  function ANT() { return typeof Antecipacao !== "undefined" ? Antecipacao : require("./venda/Antecipacao.js"); }
  function antR(n) { return "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function antNumBR(n) { return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function antData(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function antDiaMes(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] : ""; }
  function antMesAno(iso) {
    var M = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"], m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
    return m && M[Number(m[2]) - 1] ? M[Number(m[2]) - 1] + "/" + m[1] : "";
  }
  function antLido(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ""));
    return m ? m[3] + "/" + m[2] + "/" + m[1] + " " + m[4] : antData(s);
  }
  /* hoje em São Paulo, "aaaa-mm-dd" */
  function antHojeSP() {
    var s = "";
    try { s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { s = ""; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  /* último dia do mês de `hoje`, "aaaa-mm-dd" */
  function antFimDoMes(hoje) {
    var m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(hoje || ""));
    if (!m) return "";
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return m[1] + "-" + m[2] + "-" + (d < 10 ? "0" : "") + d;
  }
  function novoUiA() {
    var h = antHojeSP();
    return { vendaId: "", aberto: false, modo: "B", valor: "", hoje: h, dataPg: h, parcelaId: "", quantas: "", tabela: false,
             ocupado: null, lendo: false, msg: "", pdf: null, testes: perfilTestes() };
  }
  /* campos que faltam viram o padrão (hoje, jeito B); data vazia continua vazia (a tela avisa) */
  function antNorm(u) {
    var o = {}, k;
    for (k in (u || {})) o[k] = u[k];
    o.hoje = o.hoje || antHojeSP();
    o.dataPg = o.dataPg == null ? o.hoje : o.dataPg;
    o.modo = /^[ABCDE]$/.test(String(o.modo)) ? o.modo : "B";
    o.valor = o.valor == null ? "" : o.valor;
    o.quantas = o.quantas == null ? "" : String(o.quantas);
    return o;
  }
  /* "as últimas N": vazio = todas; texto → inteiro de 1 até o máximo, senão erro */
  function antQuantas(t, max) {
    var s = String(t == null ? "" : t).trim();
    if (!s) return { n: null };
    if (!/^\d{1,3}$/.test(s)) return { erro: true };
    var n = Number(s);
    return n >= 1 && n <= max ? { n: n } : { erro: true };
  }
  /* Os cinco jeitos para o valor, a data e as escolhas da tela. Tudo local: nenhuma chamada ao servidor. */
  function antCalcular(retrato, u) {
    var A = ANT(), d = u.dataPg, fim = antFimDoMes(u.hoje);
    var o = { erroData: "", sit: null, res: {}, parcelaId: "", quantas: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) || d < u.hoje || d > fim) {
      o.erroData = "Escolha a data do pagamento: de hoje (" + antData(u.hoje) + ") até o fim do mês (" + antData(fim) + ").";
      return o;
    }
    var sit, valor, bal;
    try { sit = A.situacao(retrato, d); valor = A.lerValor(u.valor); } catch (e) { o.erroData = "O retrato da venda não está legível. Clique em Ler de novo do ERP."; return o; }
    o.sit = sit; bal = sit.balaoes;
    o.parcelaId = bal.some(function (x) { return x.id === u.parcelaId; }) ? u.parcelaId : (bal.length ? bal[0].id : "");
    var q = antQuantas(u.quantas, sit.posAbertas);
    o.quantas = q.n == null ? null : q.n;
    ["A", "B", "C", "D", "E"].forEach(function (m) {
      var r;
      if (m === "D" && !bal.length) r = { ok: false, erro: "SEM_BALAO" };
      else if (m === "E" && !sit.temPos) r = { ok: false, erro: "SEM_POS_CHAVES" };
      else if (m === "E" && q.erro) r = { ok: false, erro: "QUANTAS_INVALIDA" };
      else if (m !== "E" && valor == null) r = { ok: false, erro: String(u.valor || "").trim() ? "VALOR_INVALIDO" : "SEM_VALOR" };
      else {
        try { r = A.simular(retrato, { modo: m, valor: valor, dataPg: d, parcelaId: m === "D" ? o.parcelaId : undefined, quantas: m === "E" ? o.quantas : null }); }
        catch (e2) { r = { ok: false, erro: "RETRATO_INCOERENTE" }; }
      }
      o.res[m] = r;
    });
    return o;
  }
  function antErroCartao(m, r, c) {
    var e = r.erro;
    if (e === "SEM_VALOR") return "Digite o valor para ver como fica.";
    if (e === "VALOR_INVALIDO") return "Valor inválido. Digite assim: 30.000,00.";
    if (e === "VALOR_ACIMA_DO_SALDO") return m === "D" ? "O valor é maior do que o balão escolhido." : "O valor é maior do que o saldo em aberto (" + antR(c.sit.saldo) + ").";
    if (e === "SEM_BALAO") return "Não há balão em aberto depois dessa data.";
    if (e === "SEM_POS_CHAVES") return "Esta venda não tem parcelas depois das chaves em aberto.";
    if (e === "QUANTAS_INVALIDA") return "Digite quantas parcelas quitar, de 1 a " + c.sit.posAbertas + ".";
    if (e === "NAO_FECHA") {
      var s = (r.sugestoes || []).map(function (v) {
        return '<button type="button" class="bt bt-mini" data-acao="an-usar" data-valor="' + Number(v).toFixed(2) + '">Usar ' + antR(v) + "</button>";
      }).join(" ");
      return s ? "Esse valor não fecha ao centavo nas parcelas que ficam. Use " + (r.sugestoes || []).map(antR).join(" ou ") + ". " + s
               : "Esse valor não fecha ao centavo nas parcelas que ficam. Mude um pouco o valor.";
    }
    if (e === "TRAVA") return "Esse jeito não passa nas travas do fiador: " + esc((r.travas || []).join("; ")) + ".";
    if (e === "RETRATO_INCOERENTE") return "O retrato lido do ERP não fecha na conta. Clique em Ler de novo do ERP.";
    return "Não consegui calcular esse jeito. Clique em Ler de novo do ERP e tente de novo.";
  }
  /* a frase "para o cliente" de cada cartão */
  function antFrase(m, r, c) {
    if (!r.ok) return antErroCartao(m, r, c);
    var rs = r.resumo || {}, sit = c.sit;
    var fim = rs.proximo ? "Próximo pagamento: " + antData(rs.proximo.data) + ", " + antR(rs.proximo.valor) +
      (rs.ultimo ? ". Última parcela: " + antData(rs.ultimo.data) + ", " + antR(rs.ultimo.valor) + "." : ".") : "Não fica nenhuma parcela a pagar.";
    if (m === "A") return "Paga as próximas parcelas, na ordem do vencimento. " + fim;
    if (m === "B") return "Todas as parcelas que faltam diminuem na mesma proporção, nas mesmas datas. " + fim;
    if (m === "C") return "Paga de trás para frente: o pagamento termina antes. " + fim;
    if (m === "D") {
      var al = r.depois.filter(function (x) { return x.id === c.parcelaId; })[0];
      if (!al) return fim;
      if (al.acao === "quita")
        return "O balão de " + antData(al.data) + " era " + antR(al.rawAntes) + " no contrato. Com a correção da obra até hoje ele está em " +
               antR(al.valorAntes) + ". Pagando agora, ele para de corrigir.";
      return "Pagando " + antR(r.valor) + ", o balão de " + antData(al.data) + " continua em " + antMesAno(al.data) + " e fica em " +
             antR(al.valor) + " hoje (segue corrigido daqui para frente).";
    }
    var n = r.depois.filter(function (x) { return x.acao === "quita"; }).length, todas = n === sit.posAbertas;
    return "Quitando " + (todas ? "as " + n + " parcelas" : (n === 1 ? "a última parcela" : "as últimas " + n + " parcelas")) +
           " depois das chaves hoje, você paga " + antR(r.valor) + " e não paga mais os juros de 1% ao mês " + (n === 1 ? "dela" : "delas") + ". " +
           (todas ? "Depois das chaves não fica nada a pagar." : "As primeiras continuam nas datas de sempre.");
  }
  /* o que só aparece no cartão escolhido: o balão (D) e quantas pós-chaves (E) */
  function antControles(m, c, u) {
    /* o .cd-and do vendas.html põe input{width:100%} e label em maiúsculas: rádios e rótulos voltam ao normal */
    var h = "", ROT = "display:inline;text-transform:none;font-size:inherit;font-weight:400;margin-right:12px";
    if (m === "D") {
      h += '<div class="dz-linha"><b>Qual balão?</b></div>' + c.sit.balaoes.map(function (b) {
        return '<div class="dz-linha"><label style="' + ROT + '"><input type="radio" style="width:auto" name="an-par" data-an="parcela" value="' + esc(b.id) + '"' +
          (b.id === c.parcelaId ? " checked" : "") + "> Balão de " + antData(b.data) + " · " + antR(b.valor) + " hoje</label></div>";
      }).join("");
      var al = c.sit.balaoes.filter(function (b) { return b.id === c.parcelaId; })[0];
      if (al) h += '<div class="dz-linha"><button type="button" class="bt bt-mini ghost" data-acao="an-usar" data-valor="' + Number(al.valor).toFixed(2) +
        '">Quitar o balão inteiro (' + antR(al.valor) + ")</button></div>";
    }
    if (m === "E") {
      var todas = !String(u.quantas).trim();
      h += '<div class="dz-linha"><label style="' + ROT + '"><input type="radio" style="width:auto" name="an-e" data-acao="an-todas"' + (todas ? " checked" : "") +
        "> Todas as " + c.sit.posAbertas + " parcelas depois das chaves</label></div>" +
        '<div class="dz-linha"><label style="' + ROT + '"><input type="radio" style="width:auto" name="an-e" data-acao="an-ultimas"' + (todas ? "" : " checked") + "> Só as últimas</label> " +
        '<input type="text" id="ant-quantas" data-an="quantas" inputmode="numeric" maxlength="3" size="3" style="max-width:70px" value="' + esc(u.quantas) + '"> parcelas</div>';
    }
    return h;
  }
  function antCartao(m, c, u) {
    var NOME = { A: "Pagar as próximas", B: "Diminuir todas", C: "Terminar antes", D: "Quitar um balão", E: "Quitar as pós-chaves" };
    var DESC = { A: "Quita na ordem do vencimento. As do fim ficam iguais.", B: "Todas as que faltam caem na mesma proporção. Datas iguais.",
                 C: "Quita de trás para frente. As do começo ficam iguais.", D: "O cliente escolhe o balão e paga tudo ou parte dele.",
                 E: "Paga todas as pós-chaves de uma vez, ou só as últimas." };
    var r = c.res[m], sel = u.modo === m, off = r.erro === "SEM_BALAO" || r.erro === "SEM_POS_CHAVES";
    var h = '<div class="cd-and an-card" data-an-card="' + m + '"' + (sel ? ' style="border-width:3px"' : "") + ">" +
      '<div class="dz-linha"><button type="button" class="bt bt-mini' + (sel ? "" : " ghost") + '" data-acao="an-modo" data-modo="' + m + '"' + (off ? " disabled" : "") + ">" +
      (sel ? "✓ " : "") + m + " · " + NOME[m] + "</button></div>" +
      '<div class="dz-nota">' + DESC[m] + "</div>";
    if (sel && !off) h += antControles(m, c, u);
    return h + '<div class="an-frase" style="margin-top:6px">' + antFrase(m, r, c) + "</div></div>";
  }
  /* parcela por parcela (só o que muda). "ajuste de centavo": parcela que o cliente não escolheu e que caiu até 5 centavos
   * só para a soma fechar ao centavo (a divisa de A e C é a escolhida; B e D só têm parcelas escolhidas) */
  function antTabela(r, c) {
    var TIPO = { pre: "Pré-chaves", balao: "Balão", pos: "Pós-chaves" };
    var ids = {}, reduz = r.depois.filter(function (x) { return x.acao === "reduz"; });
    c.sit.elegiveis.forEach(function (x) { ids[x.id] = true; });
    function queda(x) { return x.valorAntes - x.valor; }
    /* A e C: a parcela escolhida (a divisa) cai o que sobra; as outras "reduz" de até 5 centavos são só o ajuste da soma */
    function ajuste(x) {
      return (r.modo === "A" || r.modo === "C") && queda(x) <= 0.05 + 1e-9 &&
        reduz.some(function (o) { return o !== x && queda(o) > queda(x) + 1e-9; });
    }
    var linhas = r.depois.filter(function (x) { return x.acao !== "igual"; }).sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? -1 : 1;
      return a.tipo !== b.tipo ? (a.tipo < b.tipo ? -1 : 1) : (String(a.id) < String(b.id) ? -1 : 1);
    });
    var iguais = Object.keys(ids).length - linhas.filter(function (x) { return ids[x.id]; }).length;
    var h = '<div style="overflow-x:auto"><table class="cd-fl"><thead><tr><th>Vencimento</th><th>Parcela</th><th style="text-align:right">Antes</th>' +
      '<th style="text-align:right">Depois</th><th>O que muda</th></tr></thead><tbody>';
    linhas.forEach(function (x) {
      var obs = x.acao === "quita" ? "paga agora" : (ajuste(x) ? "ajuste de centavo" : "diminui");
      h += "<tr><td>" + antData(x.data) + "</td><td>" + (TIPO[x.tipo] || esc(x.tipo)) + '</td><td class="r">' + antR(x.valorAntes) + '</td><td class="r">' +
        (x.acao === "quita" ? "quitada" : antR(x.valor)) + "</td><td>" + obs + "</td></tr>";
    });
    return h + "</tbody></table></div>" +
      '<div class="dz-linha dz-nota">' + (iguais === 1 ? "1 parcela continua como está." : iguais + " parcelas continuam como estão.") + "</div>";
  }
  function antMsg(u) { return u.msg ? '<div class="dz-msg">' + esc(u.msg) + "</div>" : ""; }
  /* a parte que muda ao digitar (tudo menos os campos de valor e data) */
  function htmlAntResultado(e, u0) {
    var u = antNorm(u0), c = antCalcular(e.retrato, u), h = "";
    if (c.erroData) return '<div class="dz-aviso">' + esc(c.erroData) + "</div>" + antMsg(u);
    h += '<div class="dz-linha"><span>Saldo corrigido em aberto: <b>' + antR(c.sit.saldo) + "</b> em " + c.sit.elegiveis.length + " parcelas</span></div>";
    var v = c.sit.vencidas;
    if (v.length) {
      var tot = v.reduce(function (s, x) { return s + Number(x.valor || 0); }, 0), velha = v.map(function (x) { return x.data; }).sort()[0];
      h += '<div class="cd-falta">' + (v.length === 1
        ? "Há parcela vencida de " + antR(tot) + " (" + antDiaMes(velha) + "). Ela fica fora da antecipação; cobre primeiro."
        : "Há " + v.length + " parcelas vencidas, somando " + antR(tot) + " (a mais antiga de " + antDiaMes(velha) + "). Elas ficam fora da antecipação; cobre primeiro.") + "</div>";
    }
    ["A", "B", "C", "D", "E"].forEach(function (m) { h += antCartao(m, c, u); });
    var sel = c.res[u.modo], ok = !!(sel && sel.ok);
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini ghost" data-acao="an-tabela"' + (ok ? "" : " disabled") + ">" +
      (u.tabela ? "Esconder a tabela" : "Ver parcela por parcela") + "</button> " +
      '<button type="button" class="bt bt-mini" data-acao="an-pdf"' + (ok && !u.testes && !u.ocupado ? "" : " disabled") + ">Gerar PDF para o cliente</button>" +
      (u.ocupado === "pdf" ? " <b>gerando o PDF…</b>" : "") + "</div>";
    if (ok && u.tabela) h += antTabela(sel, c);
    if (u.pdf) {
      h += '<div class="dz-linha"><span><b>PDF gerado.</b> Texto pronto para o WhatsApp:</span></div>' +
        '<div class="dz-linha"><textarea id="ant-texto" readonly rows="6" style="width:100%;box-sizing:border-box;font:inherit">' + esc(u.pdf.texto) + "</textarea></div>" +
        '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="an-copiar">Copiar texto</button>' +
        (/^https:\/\//.test(u.pdf.url || "") ? ' <a href="' + esc(u.pdf.url) + '" target="_blank" rel="noopener noreferrer">Abrir o PDF</a>' : "") + "</div>";
    }
    return h + antMsg(u);
  }
  function htmlAntPainel(e, u0) {
    var u = antNorm(u0), h = "";
    if (!e) {
      return '<div class="vazio">' + esc(u.msg || "abrindo a simulação…") + "</div>" +
        (u.msg && u.ocupado !== "estado" ? '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="an-abrir" data-tentar="1">Tentar de novo</button></div>' : "");
    }
    h += '<div class="dz-linha"><b>' + (e.temFiador ? "Com fiador: travas ligadas" : "Sem fiador (24x): travas ligadas") + "</b></div>" +
      '<div class="dz-linha dz-nota">Não dá por aqui: mudar data de balão, dividir balão nas mensais, esticar prazo. ' +
      "Isso é renegociação e precisa de aditivo assinado por todos, inclusive os fiadores.</div>";
    if (!e.pode) return h + '<div class="dz-aviso">' + esc(e.motivo || "Esta venda ainda não pode antecipar.") + "</div>";
    var bom = !!(e.retrato && !e.velho && !e.processando);
    h += '<div class="dz-linha"><span class="dz-rot">' + (e.lido ? "Lido do ERP em " + antLido(e.lido) : "Ainda não lido do ERP") + "</span>" +
      '<button type="button" class="bt bt-mini ghost" data-acao="an-ler"' + (u.lendo || e.processando || u.testes ? " disabled" : "") + ">Ler de novo do ERP</button></div>";
    if (!bom) {
      var t;
      if (e.processando || u.lendo) t = "Lendo a venda no ERP… leva cerca de 1 minuto. A tela confere sozinha a cada 10 segundos.";
      else if (e.erroRobo && !e.retrato) t = "A leitura da venda no ERP falhou (" + e.erroRobo + "). Clique em Ler de novo do ERP.";
      else if (e.lido) t = "A última leitura é de " + antData(e.lido) + ", de outro mês. Clique em Ler de novo do ERP (cerca de 1 minuto) para simular com os valores de hoje.";
      else t = "A venda ainda não foi lida do ERP neste mês. Clique em Ler de novo do ERP (cerca de 1 minuto).";
      h += '<div class="dz-aviso">' + esc(t) + "</div>";
      if (e.retrato && e.erroRobo && !e.processando && !u.lendo) h += '<div class="dz-linha dz-nota">A última tentativa de ler de novo falhou: ' + esc(e.erroRobo) + "</div>";
      return h + antMsg(u);
    }
    if (e.erroRobo) h += '<div class="dz-linha dz-nota">Aviso: a última tentativa de ler de novo falhou (' + esc(e.erroRobo) + "). Os valores abaixo são da leitura de " + esc(antLido(e.lido)) + ".</div>";
    h += '<div class="cd-and"><div class="grid">' +
      (u.modo !== "E" ? '<div><label for="ant-valor">Valor a antecipar (R$)</label><input type="text" id="ant-valor" data-an="valor" inputmode="decimal" autocomplete="off" placeholder="30.000,00" value="' + esc(u.valor) + '"></div>' : "") +
      '<div><label for="ant-data">Data do pagamento</label><input type="date" id="ant-data" data-an="data" min="' + esc(u.hoje) + '" max="' + esc(antFimDoMes(u.hoje)) + '" value="' + esc(u.dataPg) + '"></div>' +
      "</div></div>";
    return h + '<div class="an-res">' + htmlAntResultado(e, u) + "</div>";
  }
  /* o bloco da aba Financeiro: sem vendaId (venda não lançada no Mais Controle) não desenha nada */
  function htmlAntecipacao(e, u) {
    u = u || {};
    if (!u.vendaId) return "";
    /* 31/10: o portal no ar ainda não tem as ações da antecipação (ACAO_DESCONHECIDA): só o aviso, nenhum botão */
    if (u.semBackend) return '<div class="grp">Antecipação de parcelas</div><div class="dz-aviso">' + esc(antSemBackendMsg()) + "</div>";
    var h = '<div class="grp">Antecipação de parcelas</div><div class="dz-linha"><button type="button" class="bt bt-mini' + (u.aberto ? " ghost" : "") + '" data-acao="an-abrir"' +
      (u.ocupado === "estado" ? " disabled" : "") + ">" + (u.aberto ? "Fechar a simulação" : "Antecipar parcelas") + "</button>" +
      (u.ocupado === "estado" ? " <b>abrindo…</b>" : "") + "</div>";
    return u.aberto ? h + htmlAntPainel(e, u) : h;
  }
  function antSemBackendMsg() { return "A antecipação ainda não está ligada neste portal."; }
  function antSemBackend(r) { return !!(r && r.ok === false && /ACAO_DESCONHECIDA/.test(String(r.erro || ""))); }
  function mensagemAnt(r) {
    if (antSemBackend(r)) return antSemBackendMsg();
    var M = { RETRATO_VELHO: "A leitura da venda é de outro mês. Clique em Ler de novo do ERP.",
              DATA_FORA_DO_MES: "A data do pagamento tem de ficar entre hoje e o fim deste mês.",
              NAO_FECHA: "Esse valor não fecha ao centavo nas parcelas que ficam. Mude o valor e tente de novo.",
              QUANTAS_INVALIDA: "Digite quantas parcelas quitar: um número inteiro, de 1 até o total em aberto.",
              VALOR_ACIMA_DO_SALDO: "O valor é maior do que pode ser antecipado nesse jeito.",
              VALOR_INVALIDO: "Valor inválido. Digite assim: 30.000,00.",
              PARCELA_INVALIDA: "Essa parcela não está em aberto. Escolha o balão de novo.",
              SEM_POS_CHAVES: "Esta venda não tem parcelas depois das chaves em aberto.",
              DATA_INVALIDA: "Data do pagamento inválida. Escolha uma data de hoje até o fim do mês.",
              MODO_INVALIDO: "Jeito de antecipar inválido. Escolha um dos cinco jeitos.",
              RETRATO_PROCESSANDO: "A leitura da venda já está em andamento.",
              SEM_RETRATO: "A venda ainda não foi lida do ERP. Clique em Ler de novo do ERP.",
              FILA_NAO_CONFIGURADA: "A fila de leitura do robô ainda não está ligada neste ambiente — avise o desenvolvedor.",
              BASE_ANTECIPACOES_NAO_CONFIGURADA: "A base ANTECIPAÇÕES ainda não está ligada neste ambiente — avise o desenvolvedor.",
              REGISTRO_FALHOU: "Não consegui registrar a simulação no Notion — tente de novo.",
              ANEXO_FALHOU: "Não consegui guardar o PDF — tente de novo.",
              TRAVA: "Esse jeito não passa nas travas do fiador.",
              RETRATO_INCOERENTE: "O retrato lido do ERP não fecha na conta. Clique em Ler de novo do ERP." };
    var e = String((r && r.erro) || "");
    if (e === "NAO_PODE") return String((r && r.motivo) || "Esta venda ainda não pode antecipar.");
    return M[e] || mensagemContrato(r);
  }
  /* 31/10/2026 (dono): "Corrigir aqui" — o campo da venda que alimenta a linha, aberto na própria conferência.
   * c = { i, carregando, erro, campos: [{ coluna, rotulo, valor, opcoes }] } (corrigirConferenciaCampos). */
  function htmlCorrigir(l, c, dis) {
    if (c.carregando) return '<div class="dz-linha"><b>abrindo o campo…</b></div>';
    if (c.erro) return '<div class="dz-aviso">' + esc(c.erro) + '</div><div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="d-corr-cancelar">Fechar</button></div>';
    var h = (c.campos || []).map(function (x) {
      var attr = ' data-corr-col="' + esc(x.coluna) + '"' + dis, inp;
      if (x.opcoes && x.opcoes.length) {
        /* o valor de hoje fica na lista mesmo fora das opções (não some ao abrir) */
        var ops = x.valor && x.opcoes.indexOf(x.valor) < 0 ? [x.valor].concat(x.opcoes) : x.opcoes;
        inp = "<select" + attr + '><option value="">—</option>' + ops.map(function (o) {
          return '<option value="' + esc(o) + '"' + (o === x.valor ? " selected" : "") + ">" + esc(o) + "</option>";
        }).join("") + "</select>";
      } else inp = '<input type="text" maxlength="300" style="flex:1 1 240px"' + attr + ' value="' + esc(x.valor || "") + '">';
      return '<div class="dz-linha"><label class="dz-rot" style="flex:0 0 90px">' + esc(x.rotulo) + "</label>" + inp + "</div>";
    }).join("");
    var cols = (c.campos || []).map(function (x) { return x.coluna; }).join(", ");
    h += '<div class="dz-aviso">Grava em ' + esc(cols) + " na venda. Depois, gere o contrato de novo; se ele já foi para a Clicksign, cancele o envelope e envie de novo.</div>";
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="d-corr-salvar"' + dis + ">Salvar correção</button> " +
      ((c.campos || []).length === 1 && l.lido && !(c.campos[0].opcoes && c.campos[0].opcoes.length)
        ? '<button type="button" class="bt ghost bt-mini" data-acao="d-corr-usar"' + dis + ">Usar o do documento</button> " : "") +
      '<button type="button" class="bt ghost bt-mini" data-acao="d-corr-cancelar">Cancelar</button></div>';
    return h;
  }
  function htmlConferencia(e, u) {
    /* dentro da função: o node (testes) não roda as atribuições desta parte do arquivo */
    var SIT_CONF = { ok: ["ass-ok", "✓ confere"], diverge: ["ass-recusou", "⚠ diverge"], ilegivel: ["ass-pend", "? ilegível"] };
    u = u || {};
    var h = '<div class="grp">Conferência dos documentos</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    var trava = u.testes || !!u.ocupado, dis = trava ? " disabled" : "";
    if (u.ocupado === "conferir") h += '<div class="dz-linha"><b>lendo os documentos pela IA… (até 1 minuto)</b></div>';
    if (!e.feito) {
      h += '<div class="dz-linha">Ainda não conferido.</div>';   /* 31/10/2026 (dono): sem texto explicativo */
    } else {
      var dq = new Date(e.em || ""), quando = isNaN(dq) ? "" : dq.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });   /* hora local, não UTC */
      h += '<div class="dz-linha"><span class="dz-rot">Conferido em ' + esc(quando) + (e.por ? " por " + esc(e.por) : "") + "</span></div>";
      if (!e.atual) h += '<div class="dz-aviso">Os dados mudaram depois desta conferência — confira de novo.</div>';
      h += '<div style="overflow-x:auto"><table class="dz-tab" style="width:100%;border-collapse:collapse;font-size:13px">' +
        "<tr><th>Pessoa · documento</th><th>Campo</th><th>No contrato</th><th>No documento</th><th>Situação</th></tr>" +
        (e.linhas || []).map(function (l, i) {
          var s = SIT_CONF[l.situacao] || SIT_CONF.ilegivel, conf = (e.confirmados || {})[i];
          var acao = "";
          if (l.situacao !== "ok") {
            acao = conf ? '<div class="ass-data">conferido' + (conf.por ? " por " + esc(conf.por) : "") + "</div>"
              : '<div><button type="button" class="bt bt-mini" data-acao="d-corr-' + i + '"' + dis + ">Corrigir aqui</button> " +
                '<button type="button" class="bt ghost bt-mini" data-acao="d-abrir-' + i + '"' + dis + ">Abrir documento</button> " +
                '<button type="button" class="bt bt-mini" data-acao="d-ok-' + i + '"' + dis + ">Conferi, está certo</button></div>";
          }
          /* data-rot: no celular (vendas.html, < 600 px) cada linha vira um bloco com o nome de cada campo */
          return '<tr><td data-rot="Pessoa · documento">' + esc(l.pessoa) + " · " + esc(l.documento) + '</td><td data-rot="Campo">' + esc(l.rotulo) +
            '</td><td data-rot="No contrato">' + esc(l.esperado) +
            '</td><td data-rot="No documento">' + (l.lido ? esc(l.lido) : '<span class="ass-data">' + esc(l.motivo || "não lido") + "</span>") +
            '</td><td data-rot="Situação"><b class="' + s[0] + '">' + s[1] + "</b>" + acao + "</td></tr>" +
            (u.corr && u.corr.i === i ? '<tr class="dz-corr"><td colspan="5">' + htmlCorrigir(l, u.corr, dis) + "</td></tr>" : "");
        }).join("") + "</table></div>";
    }
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="d-conferir"' + dis + ">" +
      (e.feito ? "Conferir de novo" : "Conferir documentos") + "</button></div>";
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    return h;
  }
  function htmlPreReserva(e, u) {
    u = u || {};
    var h = '<div class="grp">Termo de pré-reserva</div>';
    if (!e) return h + '<div class="vazio">' + esc(u.msg || "carregando…") + "</div>";
    var trava = u.testes || !!u.ocupado, dis = trava ? " disabled" : "";
    /* 31/10 (dono): valor e data do pagamento de cada venda; prazo para decidir = pagamento + 7 dias corridos */
    var pg = u.pagDigitado || { valor: brl(e.valor), data: e.dataPagamento || "" };
    /* 31/10/2026 (dono): valor, data e botão numa linha só, campos na mesma altura e o botão pela base (.dz-pr-pag, CSS
       abaixo — vale no cartão do condomínio e na janela da pré-reserva das Propostas); no celular empilha */
    h += '<div class="dz-linha dz-pr-pag">' +
      '<label><span>Valor da pré-reserva (R$)</span>' +
      '<input type="text" data-pr-p="valor" inputmode="decimal" maxlength="15" style="width:130px" placeholder="0,00" value="' + esc(pg.valor || "") + '"' + dis + "></label>" +
      '<label><span>Data do pagamento</span>' +
      '<input type="date" data-pr-p="data" value="' + esc(pg.data || "") + '"' + dis + "></label>" +
      '<button type="button" class="bt ghost bt-mini" data-acao="pr-salvar-pag"' + dis + ">Salvar valor e data</button></div>";
    h += '<div class="dz-linha"><span class="dz-rot">' + (e.dataLimite ? "Prazo para decidir a compra: " + esc(dataBRpr(e.dataLimite)) + " (pagamento + 7 dias corridos)"
      : "Informe a data do pagamento para calcular o prazo (pagamento + 7 dias corridos).") + "</span></div>";
    if (u.ocupado === "pag") h += '<div class="dz-linha"><b>salvando valor e data…</b></div>';
    if (e.historico) h += '<details class="dz-linha"><summary class="dz-rot">Histórico de alterações</summary><pre style="white-space:pre-wrap;margin:4px 0">' + esc(e.historico) + "</pre></details>";
    /* 27/10 (dono): PIX (chave + banco) ou dados bancários (banco com busca, agência, conta e tipo) */
    var c = u.contaDigitada || contaDaTela(e), sel = function (v) { return c.forma === v ? " selected" : ""; };
    var caixa = function (rot, inner) {
      return '<label style="display:inline-block;margin:4px 12px 4px 0;vertical-align:top"><span class="dz-rot" style="display:block">' + rot + "</span>" + inner + "</label>";
    };
    var campo = function (rot, k, ph, extra) {
      return caixa(rot, '<input type="text" data-pr-c="' + k + '" value="' + esc(c[k] || "") + '" placeholder="' + ph + '"' + (extra || "") + dis + ">");
    };
    var banco = campo("Banco", "banco", "digite para buscar", ' list="pr-bancos" maxlength="120" style="min-width:260px"');
    h += '<div class="dz-linha"><label class="dz-rot" style="display:block">Conta do pré-reservante para devolução</label>' +
      '<select data-pr-c="forma"' + dis + '><option value="">Escolha…</option><option value="PIX"' + sel("PIX") + ">PIX</option>" +
      '<option value="BANCO"' + sel("BANCO") + ">Dados bancários</option></select></div>";
    if (c.livre) h += '<div class="dz-aviso">Conta salva no formato antigo ("' + esc(c.livre) + '"): escolha PIX ou dados bancários e salve de novo.</div>';
    if (c.forma === "PIX")
      h += '<div class="dz-linha">' + campo("Chave PIX", "chave", "CPF, e-mail, celular ou chave aleatória", ' maxlength="120" style="min-width:260px"') + banco + "</div>";
    if (c.forma === "BANCO")
      h += '<div class="dz-linha">' + banco +
        campo("Agência", "agencia", "0000", ' maxlength="10" inputmode="numeric" style="width:90px"') +
        campo("Conta (com dígito)", "conta", "00000-0", ' maxlength="20" style="width:130px"') +
        caixa("Tipo de conta", '<select data-pr-c="tipo"' + dis + '><option value="">Escolha…</option>' +
          TIPOS_CONTA_PR.map(function (x) { return '<option value="' + x + '"' + (c.tipo === x ? " selected" : "") + ">" + x.charAt(0).toUpperCase() + x.slice(1) + "</option>"; }).join("") +
          "</select>") + "</div>";
    if (c.forma) h += '<div class="dz-linha"><button type="button" class="bt ghost bt-mini" data-acao="pr-salvar-conta"' + dis + ">Salvar conta</button></div>";
    h += '<datalist id="pr-bancos">' + BANCOS_BR.map(function (b) { return '<option value="' + esc(b) + '">'; }).join("") + "</datalist>";
    if (u.ocupado === "gerar") h += '<div class="dz-linha"><b>gerando o termo… (até 1 minuto)</b></div>';
    if (u.ocupado === "ver") h += '<div class="dz-linha"><b>abrindo o termo…</b></div>';
    if (u.ocupado === "conta") h += '<div class="dz-linha"><b>salvando a conta…</b></div>';
    if (e.gerado) h += '<div class="dz-linha">Termo gerado</div>';   /* 31/10/2026 (dono): sem o nome do arquivo, como no contrato */
    if (u.faltas && u.faltas.length)
      h += '<div class="dz-aviso">Para gerar o termo, falta:</div><ul>' + u.faltas.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>";
    h += '<div class="dz-linha"><button type="button" class="bt bt-mini" data-acao="pr-gerar"' + (trava ? " disabled" : "") + ">" +
      (e.gerado ? "Gerar termo de novo" : "Gerar termo de pré-reserva") + "</button>";
    if (e.gerado) h += ' <button type="button" class="bt ghost bt-mini" data-acao="pr-ver"' + (u.ocupado ? " disabled" : "") + ">Visualizar termo</button>";
    h += "</div>";
    if (u.msg) h += '<div class="dz-msg">' + esc(u.msg) + "</div>";
    return h;
  }
  function mensagemPR(r) {
    var e = (r && r.erro) || "";
    var M = { FORMA_CONTA: "Escolha PIX ou dados bancários.", PIX_SEM_CHAVE: "Digite a chave PIX completa.", SEM_BANCO: "Informe o banco.",
              AGENCIA_INVALIDA: "Agência: só números (e hífen, se tiver dígito).", CONTA_INVALIDA: "Conta: números com o dígito (ex.: 12345-6).",
              TIPO_CONTA_INVALIDO: "Escolha o tipo de conta.", CONTA_LONGA: "A chave ou o banco ficou longo demais.",
              MODELO_NAO_CONFIGURADO: "O modelo do termo (MODELO_PRE_RESERVA_ID) não está configurado — avise o desenvolvedor.",
              SEM_TERMO_GERADO: "Ainda não há termo gerado.", SO_CONDOMINIO: "O termo de pré-reserva é só do condomínio.",
              PR_VALOR_INVALIDO: "Valor da pré-reserva inválido.", PR_DATA_INVALIDA: "Informe a data do pagamento.",
              SEM_PERMISSAO_TESTES: "Perfil TESTES não gera nem grava.", SEM_RESPOSTA: "O servidor não respondeu — tente de novo." };
    if (e.indexOf("COLUNA_FALTANDO: ") === 0) return "A base não tem a coluna " + e.slice(17) + " — avise o desenvolvedor.";
    return M[e] || (e ? mensagemContrato(r) : "");
  }

  function novoCtxA() { return { estado: null, ocupado: null, msg: "", faltas: null, testes: perfilTestes() }; }

  function novoUiR() { return { ocupado: null, msg: "", testes: perfilTestes(), rascunho: {}, arquivos: {} }; }
  /* um PDF em base64 (vindo pela sessão do portal) vira um endereço blob: local para a janela aberta no clique */
  function urlDoPdf(base64) {
    var bin = atob(base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }
  /* entrega 14: avisa o painel da casa (vendas.html) que a casa mudou no Notion — ele recarrega os campos */
  function avisarDadosGravados(pageId) {
    try { window.dispatchEvent(new CustomEvent("venda:dados-gravados", { detail: { pageId: pageId } })); } catch (e) {}
  }
  /* 31/10/2026 (dono): contrato enviado para assinatura (ou já assinado) = unidade vendida. Avisa a página
   * (vendas.html marca VENDIDA = SIM na base UNIDADES do condomínio). Vale ao abrir o cartão também: pega as
   * vendas que saíram sem o botão Vendida na proposta. */
  function avisarContratoEnviado(pageId, estado) {
    var s = String((estado && estado.situacao) || "").toUpperCase();
    if (s !== "ENVIADO" && s !== "ASSINADO") return;
    try { window.dispatchEvent(new CustomEvent("venda:contrato-enviado", { detail: { pageId: pageId, situacao: s } })); } catch (e) {}
  }

  /* opts.recebimentos: o bloco Recebimentos (só a casa da VENDAS; o cartão do condomínio não tem) */
  function criarBlocosVenda(pageId, ativo, opts) {
    var eu = { pageId: pageId }, comRec = !!(opts && opts.recebimentos);
    var raiz = null, seqC = 0, carregandoC = false, estadoC = null, uiC = novoUiC();
    var estadoM = null, uiM = novoUiM(), esperaM = null, ctxA = novoCtxA();
    var estadoR = null, uiR = novoUiR();
    var estadoF = null, uiF = { filtro: "todas", todas: false, msg: "", carregando: false };   /* 31/10: aba Financeiro */
    var estadoA = null, uiA = novoUiA(), esperaA = null;   /* 31/10: Antecipação de parcelas (aba Financeiro) */
    /* 27/10/2026: termo de pré-reserva (condomínio) */
    /* 28/10: soPR = só os blocos da pré-reserva (a janela do "Pagou preferência" na tela de propostas) */
    var soPR = !!(opts && opts.soPreReserva);
    var estadoD = null, uiD = { ocupado: null, msg: "", testes: perfilTestes() };   /* 28/10: conferência dos documentos */
    var comPR = soPR || !!(opts && opts.preReserva), estadoP = null, uiP = { msg: "", faltas: null, ocupado: null, testes: perfilTestes() };
    var ctxP = novoCtxA(); ctxP.doc = "PRE_RESERVA";
    function vivo() { return !!ativo(eu); }
    function dentro(sel) { return raiz ? raiz.querySelector(sel) : null; }

    /* Assinatura (Clicksign): o desenho e as ações moram em venda/assinatura-ui.js
     * (window.VendaAssinatura, carregado por iniciar()); aqui só o estado e a ligação. */
    function htmlAss() {
      if (!window.VendaAssinatura) return '<div class="grp">Enviar contrato via Clicksign</div><div class="vazio">carregando…</div>';
      ctxA.contratoGerado = contratoFinal(estadoC);
      return window.VendaAssinatura.montarBlocoAssinatura(ctxA);
    }
    /* entrega 12: o que já foi digitado no formulário e nas caixas da conta sobrevive ao redesenho */
    function guardarRascunho() {
      if (!raiz || !raiz.querySelectorAll) return;
      raiz.querySelectorAll("[data-campo]").forEach(function (x) { uiC.rascunho[x.getAttribute("data-campo")] = x.value; });
      raiz.querySelectorAll("[data-conta-campo]").forEach(function (x) { uiC.rascunho["conta|" + x.getAttribute("data-conta-campo")] = x.value; });
    }
    function contaDigitadaNaTela() {
      if (!raiz) return null;
      var v = {};
      raiz.querySelectorAll("[data-conta-campo]").forEach(function (x) { v[x.getAttribute("data-conta-campo")] = x.value; });
      return contaDasEntradas(v);
    }
    function limparRascunhoConta() { Object.keys(uiC.rascunho).forEach(function (k) { if (/^conta\|/.test(k)) delete uiC.rascunho[k]; }); }
    function pintar() {
      if (!raiz) return;
      guardarRascunho();
      guardarRascunhoR();
      if (soPR) { raiz.innerHTML = '<div class="vb-pr">' + htmlPreReserva(estadoP, uiP) + '</div><div class="vb-pr-ass">' + htmlAssPR() + "</div>"; return; }
      raiz.innerHTML = (comPR ? '<div class="vb-pr">' + htmlPreReserva(estadoP, uiP) + '</div><div class="vb-pr-ass">' + htmlAssPR() + "</div>" +
                                 '<div class="vb-conf">' + htmlConferencia(estadoD, uiD) + "</div>" : "") +
        /* 31/10/2026: no cartão do condomínio o contrato ganha a própria caixa (.vb-ct) para ir à aba Contrato;
         * no painel da casa (sem pré-reserva) continua solto, com as margens do painel */
        (comPR ? '<div class="vb-ct">' + htmlContrato(estadoC, uiC) + "</div>" : htmlContrato(estadoC, uiC)) +
        '<div class="vb-ass">' + htmlAss() + "</div>" +
        (comRec ? '<div class="vb-rec">' + htmlRecebimentos(estadoR, uiR) + "</div>" : "") +
        '<div class="vb-mc">' + htmlMC(estadoM, uiM) + "</div>" +
        (comPR ? '<div class="vb-fin">' + htmlFinanceiro(estadoF, uiF) + '</div><div class="vb-antec">' + htmlAnt() + "</div>" : "");   /* 31/10: aba Financeiro (só condomínio) */
    }
    function pintarF() { var w = dentro(".vb-fin"); if (w) w.innerHTML = htmlFinanceiro(estadoF, uiF); }
    /* lida só quando a aba Financeiro abre (VendaBlocos.aba) — não pesa a abertura do cartão */
    async function carregarF() {
      if (uiF.carregando) return;
      uiF.carregando = true; uiF.msg = ""; pintarF();
      var r = await chamarVenda({ action: "financeiroEstado", pageId: pageId }, 90000);
      if (!vivo()) return;
      if (r.ok) { estadoF = r; uiF.carregando = false; pintarF(); return; }
      uiF.msg = mensagemContrato(r); pintarF(); uiF.carregando = false;
    }
    /* ---- 31/10/2026: Antecipação de parcelas. O bloco só aparece com a venda lançada no Mais Controle (vendaId). ---- */
    function htmlAnt() { uiA.vendaId = (estadoM && estadoM.vendaId) || ""; return htmlAntecipacao(estadoA, uiA); }
    function pintarAnt() { var w = dentro(".vb-antec"); if (w) w.innerHTML = htmlAnt(); }
    /* digitar só refaz a parte de baixo (cartões e tabela), nunca os campos de valor e data: o foco não se perde */
    function pintarAntRes() {
      var w = dentro(".vb-antec .an-res");
      if (!w || !estadoA || !estadoA.retrato) { pintarAnt(); return; }
      var foco = document.activeElement, chave = foco && w.contains(foco) && foco.getAttribute ? foco.getAttribute("data-an") : "";
      var ini = chave && typeof foco.selectionStart === "number" ? foco.selectionStart : null;
      w.innerHTML = htmlAntResultado(estadoA, uiA);
      if (chave) {
        var novo = w.querySelector('[data-an="' + chave + '"]');
        if (novo) { novo.focus(); if (ini != null) { try { novo.setSelectionRange(ini, ini); } catch (e) {} } }
      }
    }
    async function carregarAnt() {
      var r = await chamarVenda({ action: "antecipacaoEstado", pageId: pageId }, 60000);
      if (!vivo()) return null;
      if (uiA.ocupado === "estado") uiA.ocupado = null;   /* o polling não pode reabilitar o botão no meio do PDF */
      if (r.ok) { estadoA = r; uiA.msg = ""; } else { uiA.msg = mensagemAnt(r); if (antSemBackend(r)) uiA.semBackend = true; }
      pintarAnt();
      return r;
    }
    /* o estado voltou com a leitura em andamento (pedida por outra pessoa ou antes): passa a conferir sozinho */
    function iniciarAcompanhamentoAnt() {
      if (uiA.acompanhando) return;
      uiA.acompanhando = true; uiA.lendo = true; acompanharAnt(18);
    }
    async function conferirAnt() {
      var r = await carregarAnt();
      if (r && r.ok && r.processando) { pintarAnt(); iniciarAcompanhamentoAnt(); }
      return r;
    }
    /* depois de pedir a leitura: confere o estado a cada 10 s, até 18 vezes (como o Mais Controle) */
    function acompanharAnt(voltas) {
      if (esperaA) clearTimeout(esperaA);
      esperaA = setTimeout(async function () {
        esperaA = null;
        if (!vivo()) return;
        var r = await carregarAnt();
        if (!vivo()) return;
        if (voltas > 1 && (!r || !r.ok || r.processando)) { acompanharAnt(voltas - 1); return; }
        uiA.lendo = false; uiA.acompanhando = false;
        if (r && r.ok && r.processando) uiA.msg = "A leitura está demorando. Confira de novo em alguns minutos.";
        pintarAnt();
      }, 10000);
    }
    async function gerarPdfAnt() {
      if (uiA.ocupado || !estadoA || !estadoA.retrato) return;
      var u = antNorm(uiA), c = antCalcular(estadoA.retrato, u), r0 = c.res[u.modo];
      if (!r0 || !r0.ok) return;
      var p = { action: "antecipacaoPdf", pageId: pageId, modo: u.modo, dataPg: u.dataPg };
      if (u.modo !== "E") p.valor = r0.valor;
      if (u.modo === "D") p.parcelaId = c.parcelaId;
      if (u.modo === "E") p.quantas = c.quantas;
      /* a janela abre AGORA, dentro do clique (senão o navegador bloqueia); o endereço do PDF vale cerca de 1 hora */
      var w = window.open("about:blank", "_blank");
      uiA.ocupado = "pdf"; uiA.msg = ""; uiA.pdf = null; pintarAntRes();
      var r = await chamarVenda(p, 120000);
      if (!vivo()) { if (w) { try { w.close(); } catch (e) {} } return; }
      uiA.ocupado = null;
      if (r.ok) {
        var https = /^https:\/\//.test(r.pdfUrl || "");
        uiA.pdf = { texto: String(r.texto || ""), url: https ? r.pdfUrl : "" };   /* o link fica, mesmo com a janela aberta */
        if (https) {
          if (w) { try { w.opener = null; } catch (e2) {} w.location.href = r.pdfUrl; }
        } else {
          if (w) { try { w.close(); } catch (e3) {} }
          uiA.msg = "O PDF foi guardado, mas o endereço dele não veio. Gere de novo em instantes.";
        }
      } else {
        if (w) { try { w.close(); } catch (e4) {} }
        uiA.msg = mensagemAnt(r);
      }
      pintarAnt();
    }
    async function copiarAnt() {
      var t = uiA.pdf && uiA.pdf.texto;
      if (!t) return;
      var ok = false;
      try { await navigator.clipboard.writeText(t); ok = true; }
      catch (e) { try { var ta = dentro("#ant-texto"); if (ta) { ta.select(); ok = document.execCommand("copy"); } } catch (e2) {} }
      uiA.msg = ok ? "Texto copiado." : "Não consegui copiar — selecione o texto e copie.";
      pintarAntRes();
    }
    async function aoClicarAnt(b, acao) {
      var mudou = function () { uiA.pdf = null; uiA.msg = ""; };
      if (acao === "an-abrir") {
        if (uiA.aberto && !b.hasAttribute("data-tentar")) { uiA.aberto = false; pintarAnt(); return; }
        uiA.aberto = true; uiA.msg = ""; uiA.hoje = antHojeSP();
        if (!uiA.dataPg || uiA.dataPg < uiA.hoje) uiA.dataPg = uiA.hoje;
        uiA.ocupado = "estado"; pintarAnt();
        await conferirAnt();
        return;
      }
      if (acao === "an-ler") {
        if (uiA.lendo || uiA.testes) return;
        uiA.lendo = true; uiA.msg = ""; pintarAnt();
        var r = await chamarVenda({ action: "antecipacaoLer", pageId: pageId }, 60000);
        if (!vivo()) return;
        if (r.ok || r.erro === "RETRATO_PROCESSANDO") { if (estadoA) estadoA.processando = true; pintarAnt(); iniciarAcompanhamentoAnt(); return; }
        uiA.lendo = false; uiA.msg = mensagemAnt(r); pintarAnt();
        return;
      }
      if (acao === "an-modo") {
        var m = b.getAttribute("data-modo");
        if (/^[ABCDE]$/.test(String(m))) { uiA.modo = m; mudou(); pintarAnt(); }
        return;
      }
      if (acao === "an-usar") {
        var v = Number(b.getAttribute("data-valor"));
        if (isFinite(v) && v > 0) { uiA.valor = antNumBR(v); mudou(); pintarAnt(); }
        return;
      }
      if (acao === "an-todas") { uiA.quantas = ""; mudou(); pintarAntRes(); return; }
      if (acao === "an-ultimas") { if (!String(uiA.quantas).trim()) uiA.quantas = "1"; mudou(); pintarAntRes(); return; }
      if (acao === "an-tabela") { uiA.tabela = !uiA.tabela; pintarAntRes(); return; }
      if (acao === "an-pdf") return gerarPdfAnt();
      if (acao === "an-copiar") return copiarAnt();
    }
    /* o que se digita (valor, data, balão escolhido, quantas) recalcula aqui mesmo, sem chamar o servidor */
    function aoDigitarAnt(el) {
      var k = el.getAttribute("data-an");
      if (k === "valor") uiA.valor = el.value;
      else if (k === "data") uiA.dataPg = el.value;
      else if (k === "quantas") uiA.quantas = el.value;
      else if (k === "parcela") uiA.parcelaId = el.value;
      else return;
      uiA.pdf = null; uiA.msg = "";
      pintarAntRes();
    }
    function aoClicarFin(acao) {
      var m = /^f-filtro-(\w+)$/.exec(acao);
      if (m) { uiF.filtro = m[1]; uiF.todas = false; pintarF(); return; }
      if (acao === "f-todas") { uiF.todas = true; pintarF(); }
    }
    /* entrega 14: Recebimentos — a data digitada sobrevive ao redesenho; o arquivo escolhido fica em uiR.arquivos */
    function guardarRascunhoR() {
      if (!raiz || !raiz.querySelectorAll) return;
      raiz.querySelectorAll("[data-rec-data]").forEach(function (x) { uiR.rascunho[x.getAttribute("data-rec-data")] = x.value; });
    }
    function pintarR() { var w = dentro(".vb-rec"); if (w) { guardarRascunhoR(); w.innerHTML = htmlRecebimentos(estadoR, uiR); } }
    async function carregarRec() {
      var r = await chamarVenda({ action: "recebimentoEstado", pageId: pageId });
      if (!vivo()) return;
      if (r.ok) { estadoR = { itens: r.itens || [], emailConfigurado: !!r.emailConfigurado }; uiR.msg = ""; }
      else uiR.msg = mensagemRec(r);
      pintarR();
    }
    async function confirmarRec(b) {
      if (uiR.ocupado || !estadoR) return;
      var id = b.getAttribute("data-item"), it = (estadoR.itens || []).filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      guardarRascunhoR();
      var data = String(uiR.rascunho[id] || "").trim(), f = uiR.arquivos[id] || null;
      if (!data) { uiR.msg = "Informe a data do recebimento do " + it.rotulo + "."; pintarR(); return; }
      if (!window.confirm("Confirmar o recebimento do " + it.rotulo + " em " + dataRec(data) + "?" +
                          (estadoR.emailConfigurado ? " Um e-mail de aviso será enviado." : ""))) return;
      uiR.ocupado = id; uiR.msg = ""; pintarR();
      var payload = { action: "recebimentoConfirmar", pageId: pageId, item: id, data: data };
      if (f) {
        var arq = await prepararArquivo(f);
        if (arq.erro) { if (vivo()) { uiR.ocupado = null; uiR.msg = mensagemDeErro(arq.erro); pintarR(); } return; }
        payload.arquivo = arq;
      }
      var r = await chamarVenda(payload, 150000);
      if (!vivo()) return;
      uiR.ocupado = null;
      if (r.ok) {
        if (r.itens) estadoR.itens = r.itens;
        delete uiR.arquivos[id]; delete uiR.rascunho[id];
        uiR.msg = mensagemRec(r, it.rotulo);
      } else uiR.msg = mensagemRec(r);
      pintarR();
      if (r.ok) avisarDadosGravados(pageId);
      else if (r.erro === "SEM_RESPOSTA") carregarRec();   // o servidor pode ter gravado mesmo assim
    }
    /* entrega 14: "Ver contrato assinado" — o PDF vem pela sessão do portal, como o pré-contrato */
    async function verAssinado() {
      if (ctxA.ocupado) return;
      var w = window.open("about:blank", "_blank");
      ctxA.ocupado = "ver"; ctxA.msg = ""; pintarA();
      var r = await chamarVenda({ action: "verContratoAssinado", pageId: pageId }, 90000);
      if (!vivo()) { if (w) { try { w.close(); } catch (e) {} } return; }
      ctxA.ocupado = null;
      if (r.ok && r.base64) {
        if (w) { try { w.opener = null; } catch (e) {} w.location.href = urlDoPdf(r.base64); }
        else ctxA.msg = "O navegador bloqueou a janela — libere pop-ups para o portal e clique de novo.";
      } else {
        if (w) { try { w.close(); } catch (e) {} }
        ctxA.msg = window.VendaAssinatura ? window.VendaAssinatura.mensagemAssinatura(r) : mensagemDeErro(r.erro);
      }
      pintarA();
    }
    function pintarA() { var w = dentro(".vb-ass"); if (w) w.innerHTML = htmlAss(); }
    /* termo de pré-reserva */
    function htmlAssPR() {
      if (!window.VendaAssinatura) return '<div class="grp">Enviar termo de pré-reserva via Clicksign</div><div class="vazio">carregando…</div>';
      ctxP.contratoGerado = !!(estadoP && estadoP.gerado);
      return window.VendaAssinatura.montarBlocoAssinatura(ctxP);
    }
    /* 27/10 (dono): "Corrigir e-mail" abre a tela do PORTAL numa aba nova. Comprador: a célula Email da
       Planilha Casas Condomínio (condomínio) ou o painel da casa (rua). Vendedor e corretor ainda não têm tela. */
    function linkCorrigir(quem) {
      if (quem !== "comprador") return "";
      return "vendas.html?" + (comPR ? "cond=" + encodeURIComponent(pageId) + "&editar=Email" : "abrir=" + encodeURIComponent(pageId));
    }
    function guardarContaPR() {
      var w = dentro(".vb-pr"); if (!w || !w.querySelector("[data-pr-c]")) return;
      var c = uiP.contaDigitada || contaDaTela(estadoP);
      Array.prototype.forEach.call(w.querySelectorAll("[data-pr-c]"), function (x) { c[x.getAttribute("data-pr-c")] = x.value; });
      uiP.contaDigitada = c;
      guardarPagPR();
    }
    function guardarPagPR() {
      var w = dentro(".vb-pr"); if (!w || !w.querySelector("[data-pr-p]")) return;
      var g = {};
      Array.prototype.forEach.call(w.querySelectorAll("[data-pr-p]"), function (x) { g[x.getAttribute("data-pr-p")] = x.value; });
      uiP.pagDigitado = g;
    }
    function pintarP() {
      var w = dentro(".vb-pr"); if (w) { guardarContaPR(); w.innerHTML = htmlPreReserva(estadoP, uiP); }
      var a = dentro(".vb-pr-ass"); if (a) a.innerHTML = htmlAssPR();
    }
    function pintarD() { var w = dentro(".vb-conf"); if (w) w.innerHTML = htmlConferencia(estadoD, uiD); }
    async function carregarConf() {
      var r = await chamarVenda({ action: "conferenciaEstado", pageId: pageId }, 90000);
      if (!vivo()) return;
      if (r.ok) { estadoD = r; uiD.msg = ""; } else uiD.msg = mensagemContrato(r);
      pintarD();
    }
    async function aoClicarConf(acao) {
      if (uiD.ocupado) return;
      if (acao === "d-conferir") {
        uiD.ocupado = "conferir"; uiD.msg = ""; pintarD();
        var r = await chamarVenda({ action: "conferirDocumentos", pageId: pageId }, 150000);
        if (!vivo()) return;
        uiD.ocupado = null;
        if (r.ok) { estadoD = { feito: true, linhas: r.linhas, confirmados: r.confirmados || {}, em: r.em, por: "", atual: true }; }
        else uiD.msg = r.erro === "FALTAM_DADOS" ? "Faltam dados: " + (r.faltas || []).join("; ") : mensagemContrato(r);
        pintarD();
        return;
      }
      if (/^d-corr-/.test(acao)) return aoCorrigir(acao);
      var m = /^d-(abrir|ok)-(\d+)$/.exec(acao), i = m ? Number(m[2]) : -1, l = estadoD && estadoD.linhas && estadoD.linhas[i];
      if (!l) return;
      if (m[1] === "abrir") {
        var w = window.open("about:blank", "_blank");
        uiD.ocupado = "abrir"; pintarD();
        var rv = await chamarVenda({ action: "verDocumentoConferencia", pageId: pageId, coluna: l.coluna }, 90000);
        if (!vivo()) { if (w) { try { w.close(); } catch (e) {} } return; }
        uiD.ocupado = null;
        if (rv.ok && rv.base64) {
          var bin = atob(rv.base64), bytes = new Uint8Array(bin.length);
          for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          var url = URL.createObjectURL(new Blob([bytes], { type: rv.mime || "application/pdf" }));
          if (w) { try { w.opener = null; } catch (e) {} w.location.href = url; }
          else uiD.msg = "O navegador bloqueou a janela — libere pop-ups para o portal e clique de novo.";
          if (rv.total > 1) uiD.msg = "Este documento tem " + rv.total + " arquivos; abriu o último (o Notion mostra todos).";
        } else {
          if (w) { try { w.close(); } catch (e) {} }
          uiD.msg = rv.erro === "SEM_ARQUIVO" ? "Não há arquivo anexado para este documento." : mensagemContrato(rv);
        }
        pintarD();
        return;
      }
      if (!window.confirm("Você abriu o documento e confere que está certo (" + l.pessoa + " · " + l.rotulo + ")?")) return;
      uiD.ocupado = "ok"; pintarD();
      var ro = await chamarVenda({ action: "confirmarConferencia", pageId: pageId, indice: i });
      if (!vivo()) return;
      uiD.ocupado = null;
      if (ro.ok) estadoD.confirmados = ro.confirmados; else uiD.msg = mensagemContrato(ro);
      pintarD();
    }
    /* 31/10/2026: Corrigir aqui — abre (lê as colunas da venda), usa o valor lido, salva ou cancela */
    async function aoCorrigir(acao) {
      var c = uiD.corr, l;
      if (acao === "d-corr-cancelar") { uiD.corr = null; pintarD(); return; }
      if (acao === "d-corr-usar") {
        l = c && estadoD.linhas[c.i];
        var inp = dentro(".vb-conf [data-corr-col]");
        if (l && inp) { inp.value = l.lido; inp.focus(); }
        return;
      }
      if (acao === "d-corr-salvar") {
        if (!c || !c.campos) return;
        l = estadoD.linhas[c.i]; var valores = {};
        raiz.querySelectorAll(".vb-conf [data-corr-col]").forEach(function (x) { valores[x.getAttribute("data-corr-col")] = x.value; });
        c.campos.forEach(function (x) { if (x.coluna in valores) x.valor = valores[x.coluna]; });
        uiD.ocupado = "corrigir"; pintarD();
        var rs = await chamarVenda({ action: "corrigirConferencia", pageId: pageId, item: l.item, campo: l.campo, valores: valores });
        if (!vivo()) return;
        uiD.ocupado = null;
        if (!rs.ok) { uiD.msg = rs.erro === "CPF_INVALIDO" ? "CPF inválido — confira os números." : mensagemContrato(rs); pintarD(); return; }
        uiD.corr = null;
        uiD.msg = rs.mudou && rs.mudou.length ? "Corrigido (" + rs.mudou.join(", ") + "). Gere o contrato de novo para sair com o dado certo." : "Nada mudou.";
        if (rs.mudou && rs.mudou.length) {
          try { window.dispatchEvent(new CustomEvent("venda:dados-gravados", { detail: { pageId: pageId } })); } catch (e) {}
          await carregarConf();
        } else pintarD();
        return;
      }
      var m = /^d-corr-(\d+)$/.exec(acao), i = m ? Number(m[1]) : -1;
      l = estadoD && estadoD.linhas && estadoD.linhas[i];
      if (!l) return;
      uiD.corr = { i: i, carregando: true }; pintarD();
      var r = await chamarVenda({ action: "corrigirConferenciaCampos", pageId: pageId, item: l.item, campo: l.campo });
      if (!vivo() || !uiD.corr || uiD.corr.i !== i) return;
      if (r.ok) uiD.corr = { i: i, campos: r.campos };
      else uiD.corr = { i: i, erro: r.erro === "NAO_CORRIGE_AQUI" ? "Este campo não se corrige aqui — use o link para completar a venda." :
                                    r.erro === "COLUNA_FALTANDO" ? "A venda não tem a coluna " + (r.faltas || []).join(", ") + "." : mensagemContrato(r) };
      pintarD();
    }
    async function carregarPR() {
      var r = await chamarVenda({ action: "preReservaEstado", pageId: pageId });
      if (!vivo()) return;
      if (r.ok) { estadoP = { conta: r.conta || "", contaCampos: r.contaCampos || null, gerado: !!r.gerado, nome: r.nome || "", valor: r.valor,
                              dataPagamento: r.dataPagamento || "", dataLimite: r.dataLimite || "", historico: r.historico || "" }; uiP.msg = ""; }
      else uiP.msg = mensagemPR(r);
      pintarP();
    }
    async function carregarAssPR() {
      var r = await chamarVenda({ action: "assinaturaEstado", pageId: pageId, doc: "PRE_RESERVA" }, 90000);
      if (!vivo()) return;
      if (r.ok) { ctxP.estado = { situacao: r.situacao || "", envelope: !!r.envelope, signatarios: r.signatarios || [], temAssinado: !!r.temAssinado }; ctxP.msg = ""; }
      else ctxP.msg = window.VendaAssinatura ? window.VendaAssinatura.mensagemAssinatura(r) : "";
      pintarP();
    }
    function abrirPdf(w, r, uiAlvo, msgErro) {
      if (r.ok && r.base64) {
        var bin = atob(r.base64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (w) { try { w.opener = null; } catch (e) {} w.location.href = url; }
        else uiAlvo.msg = "O navegador bloqueou a janela — libere pop-ups para o portal e clique de novo.";
      } else {
        if (w) { try { w.close(); } catch (e) {} }
        uiAlvo.msg = msgErro(r);
      }
    }
    async function aoClicarPR(acao) {
      if (uiP.ocupado || !estadoP) return;
      if (acao === "pr-ver") {
        var w = window.open("about:blank", "_blank");
        uiP.ocupado = "ver"; uiP.msg = ""; pintarP();
        var rv = await chamarVenda({ action: "verTermoPreReserva", pageId: pageId }, 90000);
        if (!vivo()) { if (w) { try { w.close(); } catch (e) {} } return; }
        uiP.ocupado = null; abrirPdf(w, rv, uiP, mensagemPR); pintarP();
        return;
      }
      if (acao === "pr-salvar-pag") {
        guardarPagPR();
        var pd = uiP.pagDigitado || {};
        uiP.ocupado = "pag"; uiP.msg = ""; pintarP();
        var rp = await chamarVenda({ action: "salvarPagamentoPreReserva", pageId: pageId, valor: lerNumBR(pd.valor), data: pd.data || "" });
        if (!vivo()) return;
        uiP.ocupado = null;
        if (rp.ok) {
          estadoP.valor = rp.valor; estadoP.dataPagamento = rp.dataPagamento; estadoP.dataLimite = rp.dataLimite; estadoP.historico = rp.historico || "";
          uiP.pagDigitado = undefined;
          uiP.msg = !rp.mudou ? "Nada mudou." : "Valor e data salvos." + (estadoP.gerado ? " Gere o termo de novo para valer." : "");
        } else uiP.msg = mensagemPR(rp);
        pintarP();
        return;
      }
      if (acao === "pr-salvar-conta") {
        guardarContaPR();
        uiP.ocupado = "conta"; uiP.msg = ""; pintarP();
        var cs = uiP.contaDigitada || contaDaTela(estadoP), envio = { forma: cs.forma, banco: cs.banco };
        if (cs.forma === "PIX") envio.chave = cs.chave; else { envio.agencia = cs.agencia; envio.conta = cs.conta; envio.tipo = cs.tipo; }
        var rc = await chamarVenda({ action: "salvarContaPreReserva", pageId: pageId, conta: envio });
        if (!vivo()) return;
        uiP.ocupado = null;
        if (rc.ok) {
          estadoP.conta = rc.conta; estadoP.contaCampos = rc.contaCampos || null; uiP.contaDigitada = undefined;
          uiP.msg = "Conta salva: " + rc.conta + (estadoP.gerado ? " — gere o termo de novo para valer." : "");
        }
        else uiP.msg = mensagemPR(rc);
        pintarP();
        return;
      }
      if (acao === "pr-gerar") {
        if (estadoP.gerado && !window.confirm("Gerar o termo de novo? O termo anterior fica no histórico da coluna; envie o novo para assinatura.")) return;
        uiP.ocupado = "gerar"; uiP.msg = ""; uiP.faltas = null; pintarP();
        var rg = await chamarVenda({ action: "gerarTermoPreReserva", pageId: pageId }, 150000);
        if (!vivo()) return;
        uiP.ocupado = null;
        if (rg.ok) { estadoP.gerado = true; estadoP.nome = rg.nome || ""; uiP.msg = "Termo gerado — confira em Visualizar termo e envie para assinatura."; }
        else if (rg.erro === "FALTAM_DADOS") uiP.faltas = rg.faltas || [];
        else uiP.msg = mensagemPR(rg);
        pintarP();
        if (!rg.ok && rg.erro === "SEM_RESPOSTA") carregarPR();
      }
    }
    async function aoClicarAssPR(acao) {
      if (!window.VendaAssinatura || ctxP.ocupado) return;
      ctxP.contratoGerado = !!(estadoP && estadoP.gerado);
      var novo = await window.VendaAssinatura.executarAcaoAssinatura(acao, ctxP, {
        pageId: pageId,
        confirmar: function (t) { return window.confirm(t); },
        chamar: function (p) { return chamarVenda(p, 150000); },
        pintar: function (c) { ctxP = c; pintarP(); },
        linkCorrigir: linkCorrigir
      });
      if (!vivo()) return;
      ctxP = novo; pintarP();
    }
    async function verAssinadoPR() {
      if (ctxP.ocupado) return;
      var w = window.open("about:blank", "_blank");
      ctxP.ocupado = "ver"; ctxP.msg = ""; pintarP();
      var r = await chamarVenda({ action: "verContratoAssinado", pageId: pageId, doc: "PRE_RESERVA" }, 90000);
      if (!vivo()) { if (w) { try { w.close(); } catch (e) {} } return; }
      ctxP.ocupado = null;
      abrirPdf(w, r, ctxP, function (x) { return window.VendaAssinatura ? window.VendaAssinatura.mensagemAssinatura(x) : mensagemDeErro(x.erro); });
      pintarP();
    }
    function pintarM() {
      var w = dentro(".vb-mc"); if (w) w.innerHTML = htmlMC(estadoM, uiM);
      if (comPR && !soPR && uiA.vendaId !== ((estadoM && estadoM.vendaId) || "")) pintarAnt();   /* a venda foi lançada: o botão Antecipar aparece */
    }

    async function carregarAss() {
      var r = await chamarVenda({ action: "assinaturaEstado", pageId: pageId }, 90000);
      if (!vivo()) return;
      if (r.ok) { ctxA.estado = { situacao: r.situacao || "", envelope: !!r.envelope, signatarios: r.signatarios || [], temAssinado: !!r.temAssinado }; ctxA.msg = ""; }
      else ctxA.msg = window.VendaAssinatura ? window.VendaAssinatura.mensagemAssinatura(r) : "";
      pintarA();
      if (r.ok) avisarContratoEnviado(pageId, ctxA.estado);
    }
    async function aoClicarAss(acao) {
      if (!window.VendaAssinatura || ctxA.ocupado) return;
      ctxA.contratoGerado = contratoFinal(estadoC);
      var novo = await window.VendaAssinatura.executarAcaoAssinatura(acao, ctxA, {
        pageId: pageId,
        confirmar: function (t) { return window.confirm(t); },
        chamar: function (p) { return chamarVenda(p, 150000); },
        pintar: function (c) { ctxA = c; pintarA(); },
        linkCorrigir: linkCorrigir
      });
      if (!vivo()) return;
      ctxA = novo; pintarA();
      avisarContratoEnviado(pageId, ctxA.estado);
    }

    /* Mais Controle */
    async function carregarMC() {
      var r = await chamarVenda({ action: "mcEstado", pageId: pageId });
      if (!vivo()) return null;
      if (r.ok) { estadoM = { situacao: r.situacao || "", vendaId: r.vendaId || "" }; }
      else uiM.msg = mensagemMC(r);
      pintarM();
      return r;
    }
    function acompanharMC(voltas) {
      if (esperaM) clearTimeout(esperaM);
      esperaM = setTimeout(async function () {
        esperaM = null;
        if (!vivo()) return;
        var r = await carregarMC();
        if (r && r.ok && /^PROCESSANDO/.test(r.situacao || "") && voltas > 1) acompanharMC(voltas - 1);
      }, 10000);
    }
    async function aoClicarMC(acao) {
      if (uiM.ocupado) return;
      if (acao === "mc-atualizar") { uiM.msg = ""; await carregarMC(); return; }
      var aplicar = acao === "mc-lancar";
      if (aplicar && !window.confirm("Lançar esta venda no Mais Controle? Será criado o cliente (se não existir) e a venda com as parcelas da prévia.")) return;
      uiM.ocupado = acao; uiM.msg = ""; pintarM();
      var r = await chamarVenda({ action: "mcLancar", pageId: pageId, aplicar: aplicar });
      if (!vivo()) return;
      uiM.ocupado = null;
      uiM.msg = r.ok ? (aplicar ? "Lançamento pedido ao robô." : "Prévia pedida ao robô.") : mensagemMC(r);
      await carregarMC();
      if (r.ok) acompanharMC(24);
    }

    /* Contrato. seqC: sobe a cada ação; resposta com seq diferente do capturado é descartada.
     * carregandoC evita pedidos paralelos quando o bloco é recriado enquanto o estado carrega. */
    async function carregarContrato() {
      if (carregandoC) return;
      carregandoC = true;
      var seq = ++seqC;
      var r = await chamarVenda({ action: "contratoEstado", pageId: pageId });
      carregandoC = false;
      if (seq !== seqC || !vivo()) return;
      if (r.ok) { estadoC = estadoContrato(r); uiC.msg = ""; }
      else uiC.msg = mensagemContrato(r);
      pintar();
      /* 31/10/2026: o cartão do condomínio mostra o quadro do link só quando falta algo (vendas.html escuta) */
      if (r.ok) try { window.dispatchEvent(new CustomEvent("venda:faltas-cliente", { detail: { pageId: pageId, faltas: estadoC.faltasCliente || null } })); } catch (e) {}
    }
    async function aoClicar(ev) {
      var b = ev.target.closest("[data-acao]"); if (!b || b.disabled || !vivo()) return;
      var acao = b.getAttribute("data-acao"), r, seq;
      if (/^mc-/.test(acao)) return aoClicarMC(acao);
      if (/^pr-/.test(acao)) return aoClicarPR(acao);
      if (acao === "c-fluxo-ver") {
        /* 31/10/2026: abre o Quadro do pro soluto do cartão (aba Contrato) */
        var box = raiz && raiz.closest ? raiz.closest(".cd-cardbox") : null, dd = box && box.querySelector("details.cd-dobra");
        if (dd) { dd.open = true; dd.scrollIntoView({ behavior: "smooth", block: "start" }); }
        return;
      }
      if (/^f-/.test(acao)) return aoClicarFin(acao);
      if (/^an-/.test(acao)) return aoClicarAnt(b, acao);
      if (/^d-/.test(acao)) return aoClicarConf(acao);
      if (acao === "p-ver-assinado") return verAssinadoPR();
      if (/^p-/.test(acao)) return aoClicarAssPR(acao);
      if (acao === "a-ver-assinado") return verAssinado();
      if (/^a-/.test(acao)) return aoClicarAss(acao);
      if (acao === "r-confirmar") return confirmarRec(b);
      if (uiC.ocupadoContrato) return;
      if (acao === "c-ver") {
        /* abre a janela AGORA, dentro do clique (antes de qualquer await), senão o
         * navegador a bloqueia; depois só troca o endereço. Sem "noopener" aqui
         * (devolveria null): o opener é zerado à mão. */
        var w = window.open("about:blank", "_blank");
        uiC.ocupadoContrato = "ver"; uiC.msg = ""; uiC.link = null; pintar();
        seq = ++seqC;
        r = await chamarVenda({ action: "contratoEstado", pageId: pageId });
        if (seq !== seqC || !vivo()) { if (w) { try { w.close(); } catch (e) {} } return; }
        uiC.ocupadoContrato = null;
        if (r.ok) estadoC = estadoContrato(r);
        if (r.ok && r.gerado && /^https:\/\//.test(r.url || "")) {
          if (w) { try { w.opener = null; } catch (e) {} w.location.href = r.url; }
          else uiC.link = r.url;
        } else {
          if (w) { try { w.close(); } catch (e) {} }
          uiC.msg = r.ok ? "Ainda não há contrato gerado." : mensagemContrato(r);
        }
        pintar();
        return;
      }
      if (acao === "c-ver-cfd-pre" || acao === "c-ver-cfd-pos") {
        /* 28/10: termo de confissão — o PDF vem pelo portal, como o pré-contrato */
        var wc = window.open("about:blank", "_blank");
        uiC.ocupadoContrato = "ver"; uiC.msg = ""; pintar();
        seq = ++seqC;
        r = await chamarVenda({ action: "verConfissao", pageId: pageId, tipo: acao === "c-ver-cfd-pos" ? "POS" : "PRE" }, 90000);
        if (seq !== seqC || !vivo()) { if (wc) { try { wc.close(); } catch (e) {} } return; }
        uiC.ocupadoContrato = null;
        if (r.ok && r.base64) {
          var binC = atob(r.base64), bytesC = new Uint8Array(binC.length);
          for (var j = 0; j < binC.length; j++) bytesC[j] = binC.charCodeAt(j);
          var urlC = URL.createObjectURL(new Blob([bytesC], { type: "application/pdf" }));
          if (wc) { try { wc.opener = null; } catch (e) {} wc.location.href = urlC; }
          else uiC.msg = "O navegador bloqueou a janela — libere pop-ups para o portal e clique de novo.";
        } else {
          if (wc) { try { wc.close(); } catch (e) {} }
          uiC.msg = mensagemContrato(r);
        }
        pintar();
        return;
      }
      if (acao === "c-ver-pre") {
        /* o PDF vem pelo portal (sessão de quem está logado), não por link do Drive. A janela abre
         * já, dentro do clique, senão o navegador bloqueia; depois recebe o PDF. */
        var wp = window.open("about:blank", "_blank");
        uiC.ocupadoContrato = "ver"; uiC.msg = ""; pintar();
        seq = ++seqC;
        r = await chamarVenda({ action: "verPreContrato", pageId: pageId }, 90000);
        if (seq !== seqC || !vivo()) { if (wp) { try { wp.close(); } catch (e) {} } return; }
        uiC.ocupadoContrato = null;
        if (r.ok && r.base64) {
          var bin = atob(r.base64), bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var urlPdf = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          if (wp) { try { wp.opener = null; } catch (e) {} wp.location.href = urlPdf; }
          else uiC.msg = "O navegador bloqueou a janela — libere pop-ups para o portal e clique de novo.";
        } else {
          if (wp) { try { wp.close(); } catch (e) {} }
          uiC.msg = mensagemContrato(r);
        }
        pintar();
        return;
      }
      if (acao === "c-pre" || acao === "c-aprovar") {
        var aprovar = acao === "c-aprovar";
        if (!aprovar && etapaContrato(estadoC) === "FINAL" &&
            !window.confirm("Gerar de novo? Primeiro sai um pré-contrato para conferir; o contrato atual só é substituído quando você conferir.")) return;
        if (aprovar && !window.confirm("Você conferiu o pré-contrato e está tudo certo? O contrato final será gerado (sem grifos).")) return;
        uiC.ocupadoContrato = aprovar ? "aprovar" : "pre"; uiC.msg = ""; uiC.faltas = null; uiC.campos = null; uiC.link = null; pintar();
        seq = ++seqC;
        r = await chamarVenda({ action: aprovar ? "aprovarPreContrato" : "gerarPreContrato", pageId: pageId }, 150000);
        if (seq !== seqC || !vivo()) return;
        return tratarGeracao(r, aprovar);
      }
      if (acao === "c-salvar-campos") {
        /* entrega 12: grava no cadastro o que foi digitado (e a conta digitada, se houver) e gera o pré-contrato */
        guardarRascunho();
        var entradas = [];
        raiz.querySelectorAll("[data-campo]").forEach(function (x) { entradas.push({ chave: x.getAttribute("data-campo"), valor: x.value }); });
        var contaTela = contaDigitando(estadoC && estadoC.conta, uiC) ? contaDigitadaNaTela() : null;
        var pedido = pedidoCampos(entradas, contaTela);
        if (!pedido) { uiC.msg = "Preencha ao menos um campo."; pintar(); return; }
        uiC.ocupadoContrato = "salvar"; uiC.msg = ""; uiC.link = null; pintar();
        seq = ++seqC;
        r = await chamarVenda({ action: "salvarCamposContrato", pageId: pageId, campos: pedido.campos, conta: pedido.conta }, 150000);
        if (seq !== seqC || !vivo()) return;
        if (r.conta && estadoC) { estadoC.conta = contaDoEstado(r.conta); uiC.contaDigitar = undefined; limparRascunhoConta(); }
        if (r.ok) uiC.rascunho = {};
        return tratarGeracao(r, false);
      }
      if (acao === "c-condesp-ia" || acao === "c-condesp-salvar") return aoClicarCondEsp(acao);
      if (/^c-fluxo-/.test(acao)) return aoClicarFluxo(acao, b);
      if (acao === "c-salvar-conta") {
        var conta = contaDigitadaNaTela();
        if (!conta) { uiC.msg = "Digite banco, agência e conta."; pintar(); return; }
        return salvarConta(conta);
      }
    }
    /* 29/10: condições especiais — Redigir com IA (só sugere) e Salvar (grava na venda) */
    async function aoClicarCondEsp(acao) {
      var caixa = dentro(".vb-condesp"), ped = dentro(".vb-condesp-pedido");
      if (caixa) uiC.condRasc = caixa.value;
      if (ped) uiC.condPedido = ped.value;
      var c = estadoC && estadoC.condicoes;
      if (!c) return;
      if (acao === "c-condesp-ia") {
        if (!String(uiC.condPedido || "").trim()) { uiC.condIA = "Escreva primeiro o que quer mudar."; pintar(); return; }
        uiC.ocupadoContrato = "condesp-ia"; uiC.condIA = ""; pintar();
        var r = await chamarVenda({ action: "redigirCondicoesEspeciais", pageId: pageId, pedido: uiC.condPedido, atual: uiC.condRasc || "" }, 120000);
        if (!vivo()) return;
        uiC.ocupadoContrato = null;
        if (r.ok) {
          if (r.redacao) uiC.condRasc = r.redacao;
          uiC.condIA = (r.redacao ? "Sugestão da IA colocada na caixa abaixo — leia, ajuste se precisar e clique em Salvar. " : "A IA não redigiu: ") +
            (r.observacao || "") + (r.inexistentes && r.inexistentes.length ? " Atenção: a IA citou cláusula que não está no modelo (" + r.inexistentes.join(", ") + ") — corrija antes de salvar." : "");
        } else uiC.condIA = mensagemContrato(r);
        pintar();
        return;
      }
      var texto = String(uiC.condRasc || "");
      if (texto.trim() === c.texto.trim()) { uiC.msg = "Nada mudou nas condições especiais."; pintar(); return; }
      if (!window.confirm(texto.trim() ? "Salvar estas condições especiais no contrato desta venda? O pré-contrato precisa ser gerado de novo." :
                                         "Apagar as condições especiais desta venda? O contrato volta a sair com \"Não há.\".")) return;
      uiC.ocupadoContrato = "condesp"; pintar();
      var rs = await chamarVenda({ action: "salvarCondicoesEspeciais", pageId: pageId, texto: texto });
      if (!vivo()) return;
      uiC.ocupadoContrato = null;
      if (rs.ok) {
        estadoC.condicoes = { coluna: true, texto: rs.condicoes.texto, por: rs.condicoes.por, em: rs.condicoes.em, max: rs.condicoes.max || c.max };
        uiC.condRasc = null; uiC.condIA = ""; uiC.condPedido = "";
        if (estadoC.pre) estadoC.pre.desatualizado = true;
        uiC.msg = "Condições especiais salvas — gere o pré-contrato de novo.";
      } else uiC.msg = mensagemContrato(rs);
      pintar();
    }
    /* 29/10: Alterar fluxo — abrir (lê do servidor), editar na tela, salvar ou voltar ao fluxo da proposta */
    function copiaLinhas(ls) { return (ls || []).map(function (l) { var x = { t: l.t, v: l.v, n: l.n, d: l.d, i: l.i || 1, x: l.x || "" }; if (l.u) x.u = l.u; return x; }); }
    /* 30/10: o desconto sai das linhas escolhidas e o valor da casa cai o mesmo tanto (a soma continua fechando) */
    function aplicarDescontoTela(ed) {
      var dsc = ed.dsc || {}, isentar = dsc.modo === "isentar";
      if (isentar && !(ed.desconto && ed.desconto.isencaoLiberada)) { uiC.msg = MSG_CONTRATO.FLUXO_ISENCAO_AGUARDANDO_MODELO; return; }
      if (isentar && ed.semComissao) { uiC.msg = "A comissão desta venda já foi isentada."; return; }
      var vd = descontoDaTela(ed);
      var ap = vd.erro ? vd : FL().aplicarDesconto({ valor: ed.valor, entrega: ed.entrega, linhas: ed.linhas }, vd.valor, dsc.de || "entrada");
      if (ap.erro) { uiC.msg = ap.erro; return; }
      ed.linhas = ap.linhas; ed.valor = ap.valor;
      if (isentar) ed.semComissao = true;
      var de = { entrada: "proporcional na entrada", baloes: "dos balões", pre: "das pré-chaves" }[dsc.de || "entrada"];
      var resumo = (isentar ? "isenção da comissão, " : dsc.modo === "pct" ? String(lerNumBR(dsc.valor)).replace(".", ",") + "% = " : "") + FL().moeda(vd.valor) + " " + de;
      ed.descontos = (ed.descontos || []).concat([resumo]);
      if (!String(ed.motivoPreco || "").trim()) ed.motivoPreco = "Desconto: " + resumo;
      ed.dsc = { modo: "rs", valor: "", de: dsc.de || "entrada" };
      uiC.msg = "Desconto aplicado: " + resumo + ". Confira as linhas e salve.";
    }
    async function aoClicarFluxo(acao, b) {
      var ed = uiC.fluxoEd, k = Number(b.getAttribute("data-k"));
      if (acao === "c-fluxo-abrir") {
        uiC.ocupadoContrato = "fluxo"; uiC.msg = ""; pintar();
        var r = await chamarVenda({ action: "fluxoEditar", pageId: pageId });
        if (!vivo()) return;
        uiC.ocupadoContrato = null;
        if (r.ok) uiC.fluxoEd = { valor: r.atual.valor, valorOriginal: r.padrao.valor, entrega: r.atual.entrega || r.padrao.entrega,
                                  linhas: copiaLinhas(r.atual.linhas), padrao: r.padrao, historico: r.historico || [], alterado: !!r.alterado,
                                  podePreco: !!r.podePreco, desconto: r.desconto || null, semComissao: !!r.atual.semComissao,
                                  dsc: { modo: "rs", valor: "", de: "entrada" }, descontos: [],
                                  motivo: "", motivoPreco: "" };
        else uiC.msg = mensagemContrato(r);
        pintar();
        return;
      }
      if (!ed) return;
      if (acao === "c-fluxo-fechar") { uiC.fluxoEd = null; pintar(); return; }
      if (acao === "c-fluxo-add") { ed.linhas.push({ t: "balao", v: 0, n: 1, d: "", i: 1, x: "" }); pintar(); return; }
      if (acao === "c-fluxo-del") { if (!(FL().TIPOS[(ed.linhas[k] || {}).t] || {}).fixo) ed.linhas.splice(k, 1); pintar(); return; }
      if (acao === "c-fluxo-padrao") { ed.linhas = copiaLinhas(ed.padrao.linhas); ed.valor = ed.padrao.valor; ed.semComissao = false; ed.descontos = []; pintar(); return; }
      if (acao === "c-fluxo-desconto") { aplicarDescontoTela(ed); pintar(); return; }
      if (acao === "c-fluxo-prazo") {
        var pz = Number(b.getAttribute("data-p")), mp = FL().mudarPrazo({ valor: ed.valor, entrega: ed.entrega, linhas: ed.linhas }, pz, ed.padrao);   /* a data dos pós-chaves vem da proposta */
        if (mp.erro) uiC.msg = mp.erro;
        else {
          ed.linhas = mp.linhas;
          if (!String(ed.motivo || "").trim()) ed.motivo = "Cliente mudou o prazo da entrada para " + pz + "x";
          uiC.msg = "Fluxo refeito para " + pz + "x — confira as datas e salve.";
        }
        pintar();
        return;
      }
      if (acao === "c-fluxo-dist") {
        var ds = FL().distribuir({ valor: ed.valor, entrega: ed.entrega, linhas: ed.linhas });
        if (ds.erro) uiC.msg = ds.erro; else { ed.linhas = ds.linhas; uiC.msg = ""; }
        pintar();
        return;
      }
      if (acao === "c-fluxo-red") {
        if ((FL().TIPOS[(ed.linhas[k] || {}).t] || {}).fixo) return;
        var rd = FL().redistribuir({ valor: ed.valor, entrega: ed.entrega, linhas: ed.linhas }, k);
        if (rd.erro) uiC.msg = rd.erro; else { ed.linhas = rd.linhas; uiC.msg = ""; }
        pintar();
        return;
      }
      var voltar = acao === "c-fluxo-voltar";
      if (acao !== "c-fluxo-salvar" && !voltar) return;
      if (!String(ed.motivo || "").trim()) { uiC.msg = "Escreva o motivo da alteração."; pintar(); return; }
      if (!window.confirm(voltar ? "Voltar ao fluxo da proposta (simulador)? A alteração fica guardada no histórico."
                                 : "Salvar este fluxo? O pré-contrato precisa ser gerado de novo e fica registrado quem alterou e o motivo.")) return;
      uiC.ocupadoContrato = "fluxo-salvar"; pintar();
      var rs = await chamarVenda(voltar ? { action: "salvarFluxo", pageId: pageId, voltar: true, motivo: ed.motivo }
        : { action: "salvarFluxo", pageId: pageId, fluxo: ed.semComissao ? { valor: ed.valor, linhas: ed.linhas, semComissao: true } : { valor: ed.valor, linhas: ed.linhas },
            motivo: ed.motivo, motivoPreco: ed.motivoPreco || "", desconto: (ed.descontos || []).join("; ") });
      if (!vivo()) return;
      uiC.ocupadoContrato = null;
      if (rs.ok) {
        estadoC.fluxo = fluxoDoEstado(rs.fluxo || {});
        uiC.fluxoEd = null;
        if (estadoC.pre) estadoC.pre.desatualizado = true;
        uiC.msg = voltar ? "Fluxo da proposta restaurado — gere o pré-contrato de novo." : "Fluxo salvo.";
        try { window.dispatchEvent(new CustomEvent(EVENTO_GRAVADO, { detail: detalheFluxoGravado(pageId, ed, voltar) })); }
        catch (e) { /* sem CustomEvent: o quadro do cartão só atualiza ao reabrir a unidade */ }
      } else uiC.msg = mensagemContrato(rs);
      pintar();
    }
    /* digitando no editor: guarda no estado e redesenha só o total da linha e o placar (não perde o foco) */
    function aoDigitarFluxo(alvo) {
      var ed = uiC.fluxoEd, campo = alvo.getAttribute("data-fx");
      if (!ed || !campo) return;
      if (campo === "valor") ed.valor = lerNumBR(alvo.value);
      else if (campo === "motivo" || campo === "motivoPreco") ed[campo] = alvo.value;
      else if (campo === "dmodo" || campo === "dvalor" || campo === "dde") { ed.dsc = ed.dsc || {}; ed.dsc[{ dmodo: "modo", dvalor: "valor", dde: "de" }[campo]] = alvo.value; return; }
      else {
        var l = ed.linhas[Number(alvo.getAttribute("data-k"))];
        if (!l) return;
        if (campo === "v") { l.v = lerNumBR(alvo.value); delete l.u; }
        else if (campo === "n") { l.n = parseInt(alvo.value, 10) || 0; delete l.u; }
        else if (campo === "i") l.i = parseInt(alvo.value, 10) || 1;
        else if (campo === "d") l.d = alvo.value;
        else if (campo === "x") l.x = alvo.value;
        else if (campo === "t") l.t = alvo.value;
        var tot = raiz.querySelector('.vb-fx-tot[data-k="' + alvo.getAttribute("data-k") + '"]');
        if (tot) tot.textContent = FL().moeda(FL().totalLinha(l));
      }
      var viva = dentro(".vb-fx-viva"), mp = dentro(".vb-fx-mp");
      if (viva) viva.innerHTML = htmlFluxoVivo(ed, "");
      if (mp) mp.style.display = Math.round(ed.valor * 100) === Math.round(ed.valorOriginal * 100) ? "none" : "block";
    }
    /* resposta de gerarPreContrato / aprovarPreContrato / salvarCamposContrato */
    function tratarGeracao(r, aprovar) {
      uiC.ocupadoContrato = null;
      if (r.ok) {
        var antes = estadoC || {};
        estadoC = aprovar
          ? { gerado: true, nome: r.nome || "", url: r.url || "", etapa: "FINAL", pre: antes.pre ? Object.assign({}, antes.pre, { conferido: true }) : null }
          : { gerado: !!antes.gerado, nome: antes.nome || "", url: antes.url || "", etapa: "PRE",
              pre: { nome: r.nome || "", url: r.url || "", em: "", conferido: false, desatualizado: false } };
        estadoC.testemunhas = antes.testemunhas || null;
        if (antes.conta) estadoC.conta = antes.conta;
        if (antes.fluxo) estadoC.fluxo = antes.fluxo;              /* 29/10: os blocos do fluxo e das condições */
        if (antes.condicoes) estadoC.condicoes = antes.condicoes;  /* especiais não somem depois de gerar */
        uiC.faltas = null; uiC.campos = null;
        var feito = aprovar ? "Contrato gerado." : "Pré-contrato gerado — abra, confira o que está grifado e clique em Conferi.";
        /* condomínio: campos que saíram em branco ("____") não travam, mas avisam */
        uiC.msg = r.avisos && r.avisos.length ? feito + " Atenção: " + r.avisos.join("; ") + "." : feito;
      } else if (r.erro === "PRECONTRATO_DESATUALIZADO" || r.erro === "PRECONTRATO_FALTANDO") {
        /* a etapa mudou no servidor: trava o "Conferi" (desatualizado) ou volta ao começo (faltando) */
        if (estadoC && r.erro === "PRECONTRATO_DESATUALIZADO" && estadoC.pre) estadoC.pre.desatualizado = true;
        if (estadoC && r.erro === "PRECONTRATO_FALTANDO") { estadoC.pre = null; estadoC.etapa = estadoC.gerado ? "FINAL" : "NENHUM"; }
        uiC.msg = mensagemContrato(r);
      } else if (r.erro === "FALTAM_DADOS" && r.faltas && r.faltas.length) {
        var fr = faltasDaResposta(r);
        uiC.faltas = fr.faltas; uiC.campos = fr.campos;
        if (r.salvos && r.salvos.length) uiC.msg = "Dados salvos. Ainda falta o que está abaixo.";
      } else {
        if (r.erro === "MODELO_COM_MARCADOR_SOBRANDO" && typeof console !== "undefined") console.warn("contrato: marcadores sobrando", r.marcadores);
        uiC.msg = mensagemContrato(r);
      }
      pintar();
      /* sem resposta: o servidor pode ter gerado mesmo assim — olha de novo */
      if (!r.ok && r.erro === "SEM_RESPOSTA") carregarContrato();
    }

    /* entrega 12: "Conta de recebimento" — escolha da lista grava na hora; "Digitar outra conta" abre as caixas */
    async function aoEscolherConta(valor) {
      if (!raiz || uiC.ocupadoContrato || !vivo()) return;
      if (valor === CONTA_DIGITAR) { uiC.contaDigitar = true; pintar(); return; }
      return salvarConta(valor ? { id: valor } : {});
    }
    async function salvarConta(conta) {
      uiC.ocupadoContrato = "conta"; uiC.msg = ""; pintar();
      var seq = ++seqC;
      var r = await chamarVenda({ action: "escolherContaRecebimento", pageId: pageId, conta: conta });
      if (seq !== seqC || !vivo()) return;
      uiC.ocupadoContrato = null;
      if (r.ok) {
        if (estadoC) {
          estadoC.conta = contaDoEstado(r.conta);
          if (r.desatualizado && estadoC.pre && etapaContrato(estadoC) === "PRE") estadoC.pre.desatualizado = true;
        }
        uiC.contaDigitar = undefined; limparRascunhoConta();
        uiC.msg = "Conta de recebimento salva." + (r.desatualizado ? " Gere o pré-contrato de novo." : "");
      } else uiC.msg = mensagemContrato(r);
      pintar();
    }

    /* entrega 10: grava quando as duas listas fecham (duas pessoas diferentes) ou as duas voltam ao padrão */
    async function aoEscolherTestemunha() {
      if (!raiz || uiC.ocupadoContrato || !vivo()) return;
      var s = raiz.querySelectorAll("select[data-testemunha]");
      if (s.length !== 2) return;
      var ids = [s[0].value, s[1].value];
      if (!!ids[0] !== !!ids[1]) { uiC.msg = "Escolha as duas testemunhas (ou deixe as duas no padrão)."; pintarMsgTestemunha(); return; }
      if (ids[0] && ids[0] === ids[1]) { uiC.msg = "Escolha duas pessoas diferentes."; pintarMsgTestemunha(); return; }
      uiC.ocupadoContrato = "testemunhas"; uiC.msg = ""; pintar();
      var seq = ++seqC;
      var r = await chamarVenda({ action: "escolherTestemunhas", pageId: pageId, ids: ids[0] ? ids : [] });
      if (seq !== seqC || !vivo()) return;
      uiC.ocupadoContrato = null;
      if (r.ok) { if (estadoC) estadoC.testemunhas = testemunhasDoEstado(r.testemunhas); uiC.msg = "Testemunhas salvas."; }
      else uiC.msg = mensagemContrato(r);
      pintar();
    }
    /* mensagem sem repintar as listas (não desfaz a 1ª escolha enquanto falta a 2ª) */
    function pintarMsgTestemunha() {
      var m = raiz && raiz.querySelector(".dz-msg-test");
      if (!m) {
        var s = raiz && raiz.querySelector("select[data-testemunha]");
        if (!s) return;
        m = document.createElement("div"); m.className = "dz-msg dz-msg-test";
        s.parentNode.parentNode.insertBefore(m, s.parentNode.nextSibling);
      }
      m.textContent = uiC.msg; uiC.msg = "";
    }

    /* Põe os blocos em `el` (o conteúdo dele é trocado). Só pede ao servidor o que ainda não tem. */
    eu.anexar = function (el) {
      /* o painel foi redesenhado (ex.: recarregou os campos da casa): guarda o que estava digitado no bloco antigo */
      if (raiz && raiz !== el) { guardarRascunho(); guardarRascunhoR(); if (comPR) guardarContaPR(); }
      raiz = el;
      if (el.classList) el.classList.add("vb-blocos");
      if (!el.__vbLigado) {
        el.__vbLigado = true;
        el.addEventListener("click", function (ev) { if (raiz === el) aoClicar(ev); });
        /* 29/10: o que se digita nas condições especiais sobrevive a um redesenho do bloco */
        el.addEventListener("input", function (ev) {
          if (raiz !== el || !ev.target.classList) return;
          if (ev.target.hasAttribute("data-an")) { aoDigitarAnt(ev.target); return; }
          if (ev.target.hasAttribute("data-fx")) { aoDigitarFluxo(ev.target); return; }
          if (ev.target.classList.contains("vb-condesp")) uiC.condRasc = ev.target.value;
          else if (ev.target.classList.contains("vb-condesp-pedido")) uiC.condPedido = ev.target.value;
        });
        el.addEventListener("change", function (ev) {
          if (raiz !== el) return;
          if (ev.target.getAttribute("data-pr-c") === "forma") { guardarContaPR(); pintarP(); return; }
          var fx = ev.target.getAttribute("data-fx");
          if (fx === "t" || fx === "dmodo") { aoDigitarFluxo(ev.target); if (uiC.fluxoEd) pintar(); return; }   /* o tipo muda o reajuste mostrado; o modo do desconto, os campos */
          if (fx === "dde") { aoDigitarFluxo(ev.target); return; }
          if (fx === "v" || fx === "valor") {
            /* sai formatado ao sair do campo — sem repintar: repintar no blur engoliria o clique num botão */
            aoDigitarFluxo(ev.target);
            ev.target.value = numBR(lerNumBR(ev.target.value));
            return;
          }
          if (ev.target.hasAttribute("data-testemunha")) aoEscolherTestemunha();
          else if (ev.target.hasAttribute("data-conta")) aoEscolherConta(ev.target.value);
          else if (ev.target.hasAttribute("data-rec-arq")) {
            var fl = ev.target.files && ev.target.files[0], k = ev.target.getAttribute("data-rec-arq");
            if (fl) uiR.arquivos[k] = fl; else delete uiR.arquivos[k];
          }
        });
      }
      pintar();
      if (soPR) {
        if (!estadoP) carregarPR();
        if (!ctxP.estado) carregarAssPR();
        return;
      }
      if (!estadoC) carregarContrato();
      if (comPR && !estadoD) carregarConf();
      if (!estadoM) carregarMC();
      if (!ctxA.estado) carregarAss();
      if (comRec && !estadoR) carregarRec();
      if (comPR && !estadoP) carregarPR();
      if (comPR && !ctxP.estado) carregarAssPR();
    };
    eu.raiz = function () { return raiz; };
    eu.pintarAssinatura = function () { pintarA(); if (comPR) { var a = dentro(".vb-pr-ass"); if (a) a.innerHTML = htmlAssPR(); } };
    eu.parar = function () { if (esperaM) clearTimeout(esperaM); esperaM = null; if (esperaA) clearTimeout(esperaA); esperaA = null; uiA.acompanhando = false; };
    /* 31/10: o Financeiro lê as parcelas só ao abrir; o Antecipar confere a data e, se a simulação já estava aberta, o estado */
    eu.abrirAba = function (aba) {
      if (aba !== "financeiro" || !comPR || soPR) return;
      if (!estadoF) carregarF();
      uiA.hoje = antHojeSP(); if (!uiA.dataPg || uiA.dataPg < uiA.hoje) uiA.dataPg = uiA.hoje;
      if (uiA.aberto && !uiA.acompanhando && uiA.ocupado !== "estado" && (!estadoA || estadoA.processando)) { uiA.ocupado = "estado"; conferirAnt(); }
      pintarAnt();
    };
    return eu;
  }

  /* casa da VENDAS: o bloco é sempre o ÚLTIMO filho de #pn-body. Sem laço de observer: o
   * MutationObserver só reage a childList de #pn-body, e aqui só mexemos quando o bloco
   * falta ou não está por último; depois de anexar/mover ele está por último, então a
   * chamada disparada pela própria mutação não faz nada. */
  var blocosCasa = null;
  function garantirContrato(body, id) {
    if (!blocosCasa || blocosCasa.pageId !== id) {
      if (blocosCasa) blocosCasa.parar();
      blocosCasa = criarBlocosVenda(id, function (b) { return blocosCasa === b && obraAberta() === id; }, { recebimentos: true });
    }
    var w = blocosCasa.raiz();
    if (w && w.parentNode === body) { if (body.lastElementChild !== w) body.appendChild(w); return; }
    var velho = document.getElementById("contrato-wrap");   // de outra casa que ficou no painel
    if (velho && velho.parentNode) velho.parentNode.removeChild(velho);
    w = document.createElement("div"); w.id = "contrato-wrap";
    body.appendChild(w);
    blocosCasa.anexar(w);
  }

  /* linha do condomínio (entrega 7): o cartão da unidade em vendas.html chama
   *   VendaBlocos.montar(elemento, pageIdDaLinha)   depois de desenhar o cartão (e a cada redesenho)
   *   VendaBlocos.soltar()                          ao fechar o cartão                              */
  var blocosCond = null;
  var REGEX_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;
  function montarCondominio(el, pageId) {
    if (!el || !REGEX_ID.test(String(pageId || ""))) return;
    if (!blocosCond || blocosCond.pageId !== pageId) {
      if (blocosCond) blocosCond.parar();
      blocosCond = criarBlocosVenda(pageId, function (b) {
        var r = b.raiz();
        return blocosCond === b && !!r && r.isConnected !== false;
      }, { preReserva: true });   /* 27/10/2026: o termo de pré-reserva vem antes do contrato */
    }
    blocosCond.anexar(el);
  }
  function soltarCondominio() { if (blocosCond) blocosCond.parar(); blocosCond = null; }
  /* 28/10/2026: só o termo de pré-reserva (conta de devolução, gerar, ver, Clicksign) — a tela de propostas
   *   VendaBlocos.montarPreReserva(elemento, pageIdDaLinhaDaVenda)  depois do "Pagou preferência"           */
  var blocosPR = null;
  function montarPreReserva(el, pageId) {
    if (!el || !REGEX_ID.test(String(pageId || ""))) return;
    if (!blocosPR || blocosPR.pageId !== pageId) {
      if (blocosPR) blocosPR.parar();
      blocosPR = criarBlocosVenda(pageId, function (b) {
        var r = b.raiz();
        return blocosPR === b && !!r && r.isConnected !== false;
      }, { soPreReserva: true });
    }
    blocosPR.anexar(el);
  }
  function soltarPreReserva() { if (blocosPR) blocosPR.parar(); blocosPR = null; }
  /* 31/10/2026: o cartão avisa a aba aberta — o Financeiro só lê quando abre */
  function abaCondominio(aba) { if (blocosCond) blocosCond.abrirAba(aba); }
  window.VendaBlocos = { montar: montarCondominio, soltar: soltarCondominio, montarPreReserva: montarPreReserva, soltarPreReserva: soltarPreReserva, aba: abaCondominio };

  function garantirBloco(body) {
    var id = obraAberta();
    if (!id) {
      /* painel fechado: zera para a mesma casa recarregar o estado ao reabrir */
      if (paginaDoBloco !== null) { paginaDoBloco = null; estado = null; ui = { dois: false, ocupado: null, msg: "", testes: false }; }
      if (blocosCasa) { blocosCasa.parar(); blocosCasa = null; }
      return;
    }
    if (painelCarregando(body.children.length, body.firstElementChild ? body.firstElementChild.className : "",
        !!(body.firstElementChild && body.firstElementChild.querySelector(".load")))) return;
    if (!wrap()) {
      if (paginaDoBloco !== id) { paginaDoBloco = id; estado = null; ui = { dois: false, ocupado: null, msg: "", testes: perfilTestes() }; }
      var w = document.createElement("div"); w.id = "dossie-wrap";
      w.addEventListener("click", aoClicar);
      /* entrega 13: soltar vários arquivos na área "Soltar todos os documentos aqui" */
      w.addEventListener("change", aoEscolherSolto);
      w.addEventListener("dragover", function (ev) {
        if (ev.target.closest && ev.target.closest("[data-soltar]")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; }
      });
      w.addEventListener("drop", function (ev) {
        var zona = ev.target.closest && ev.target.closest("[data-soltar]");
        if (!zona) return;
        ev.preventDefault();
        var id = obraAberta();
        if (id && ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) soltarArquivos(id, ev.dataTransfer.files);
      });
      body.insertBefore(w, body.firstChild);
      pintar();
      if (!estado) carregarEstado(id);
    }
    garantirContrato(body, id);
  }
  function iniciar() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    /* o bloco de assinatura mora em arquivo próprio; vendas.html continua com uma linha só.
       Carrega mesmo sem o painel da casa: o cartão do condomínio também usa. */
    /* 30/10: leitor das rubricas do comprador (pdf.js só carrega na hora de enviar) */
    var sr = document.createElement("script"); sr.src = "venda/RubricasVenda.js?v=1"; document.head.appendChild(sr);
    var sa = document.createElement("script"); sa.src = "venda/assinatura-ui.js?v=13";
    sa.onload = function () { [blocosCasa, blocosCond, blocosPR].forEach(function (b) { if (b) b.pintarAssinatura(); }); };
    document.head.appendChild(sa);
    var body = document.getElementById("pn-body"); if (!body) return;
    new MutationObserver(function () { garantirBloco(body); }).observe(body, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
