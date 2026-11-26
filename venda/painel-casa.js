/* painel-casa.js — o que o painel da casa (vendas.html) mostra e em que ordem (entrega 14).
 * JS puro (navegador e node): o vendas.html chama window.PainelCasa na hora de desenhar; se este arquivo não
 * carregar, o painel fica como antes (todas as colunas, ordem antiga).
 * - ocultoNoPainel: colunas técnicas que já aparecem nos blocos (Contrato, Clicksign, Recebimentos, Mais Controle)
 *   ou que só o app usa. Continuam no Notion; só não viram campo editável/arquivo solto no painel.
 * - ordenar / grupoDoCampo: compradores, depois os dados do contrato, numa ordem lógica e com título por grupo;
 *   as colunas que não estão na lista vêm depois, na ordem de sempre.
 * Repositório público: nenhum dado real aqui. */
(function (raiz) {
  "use strict";
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }

  var OCULTOS = ["ASSINATURA - ENVELOPE ID", "ASSINATURA - SITUAÇÃO", "CONDOMÍNIO - VENDA ID", "MC - DISTRATO", "MC - SITUAÇÃO",
                 "MC - VENDA ID", "DOSSIÊ IMÓVEL - OBSERVAÇÃO", "CONTRATO GERADO", "CONTRATO ASSINADO",
                 /* a data da comissão saiu da tela e do contrato (dono, 08/10) */
                 "CONTRATO - COMISSÃO VENCIMENTO",
                 /* 05/11/2026 (dono): casa de rua — a comissão é SEMPRE paga pelo comprador (texto fixo no bloco "Pagamento da
                    comissão" da aba Contrato) e a forma sai do cadastro do corretor (chave PIX / conta), no mesmo bloco */
                 "CONTRATO - COMISSÃO PAGA POR", "CONTRATO - COMISSÃO FORMA",
                 /* 04/11/2026 (dono): o contrato tira o prazo de conclusão da DATA DA ENTREGA (decisão 08/10); esta coluna não é lida */
                 "CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS",
                 /* 04/11/2026 (dono): situação e observação do dossiê já aparecem no bloco do dossiê (etiqueta + histórico) */
                 "DOSSIÊ", "DOSSIÊ IMÓVEL", "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR",
                 /* 24/11/2026 (dono): água e energia vêm da tela Ligações (bloco só leitura + cartões do Resumo); a caixa SIM/NÃO sai */
                 "AGUA TRANSFERIDA", "ENERGIA TRANSFERIDA",
                 /* 24/11/2026 (dono): conferência semanal da transferência é da tela Ligações (ligacoes.html segue usando) */
                 "CONFERIU NA SEMANA (TRANSFERÊNCIA)", "DATA DE VERIFICAÇÃO DAS CONTAS", "DATA DE ERIFICAÇÃO DAS CONTAS",
                 "CONFERÊNCIA DA CONCLUSÃO", "DATA DA CONFERÊNCIA (TRANSFERÊNCIA)", "OBS. CONFERÊNCIA (TRANSFERÊNCIA)"];
  /* RECEBIMENTO - * (data, comprovante, quem confirmou): moram no bloco Recebimentos */
  /* + grafias do Notion que variam (comparação normalizada, começa com): conferência semanal da transferência */
  var PREFIXOS_OCULTOS = ["RECEBIMENTO - ", "CONFERIU NA SEMANA", "DATA DA CONFERENCIA (TRANSF", "OBS. CONFERENCIA (TRANSF",
                          "CONFERENCIA DA CONCLUSAO", "DATA DE VERIFICACAO DAS CONTAS", "DATA DE ERIFICACAO DAS CONTAS"];
  var OCULTOS_N = OCULTOS.map(norm), PREFIXOS_N = PREFIXOS_OCULTOS.map(norm);
  function ocultoNoPainel(nome) {
    var n = norm(nome);
    if (OCULTOS_N.indexOf(n) >= 0) return true;
    return PREFIXOS_N.some(function (p) { return n.indexOf(p) === 0; });
  }

  /* comprador 1: nome, CPF, telefone e e-mail principais ficam no resumo "Dados da Venda" (CLIENTES, CPF, Nº Whatsapp, Email) */
  function comprador(n) {
    return ["NOME", "CPF", "DOCUMENTO", "NACIONALIDADE", "ESTADO CIVIL", "PROFISSÃO", "E-MAIL", "TELEFONE", "ENDEREÇO"]
      .map(function (x) { return "COMPRADOR " + n + " - " + x; });
  }
  var GRUPOS = [
    { titulo: "Comprador 1", campos: comprador(1) },
    { titulo: "Comprador 2", campos: comprador(2) },
    { titulo: "Contrato — pagamento e comissão", campos: [
      "CONTRATO - SINAL VALOR", "CONTRATO - SINAL DATA", "CONTRATO - ENTRADA VALOR", "CONTRATO - ENTRADA VENCIMENTO",
      "CONTRATO - INTERMEDIÁRIA VALOR", "CONTRATO - INTERMEDIÁRIA VENCIMENTO", "CONTRATO - FORMA DE PAGAMENTO"] },
    { titulo: "Contrato — imóvel", campos: [
      "CONTRATO - MATRÍCULA INDIVIDUAL", "CONTRATO - CRI DA MATRÍCULA", "CONTRATO - ÁREA DO LOTE (M²)", "CONTRATO - CONFRONTAÇÕES",
      "CONTRATO - ALVARÁ Nº", "CONTRATO - ALVARÁ DATA", "CONTRATO - HABITE-SE Nº", "CONTRATO - HABITE-SE DATA",
      "CONTRATO - MATRÍCULA DO LOTEAMENTO", "CONTRATO - CARTÓRIO DO LOTEAMENTO", "CONTRATO - DENOMINAÇÃO DO LOTEAMENTO",
      "CONTRATO - CONDIÇÕES ESPECIAIS"] }
  ];
  var ARQUIVOS = ["COMPRADOR 1 - IDENTIDADE", "COMPRADOR 1 - COMPROVANTE DE ENDEREÇO", "COMPRADOR 2 - IDENTIDADE", "COMPRADOR 2 - COMPROVANTE DE ENDEREÇO"];

  var POSICAO = {}, GRUPO = {}, k = 0;
  GRUPOS.forEach(function (g) { g.campos.forEach(function (c) { var n = norm(c); POSICAO[n] = k++; GRUPO[n] = g.titulo; }); });
  /* título do grupo da coluna ("" = fora da lista) */
  function grupoDoCampo(nome) { return GRUPO[norm(nome)] || ""; }
  /* os da lista primeiro (na ordem dela), depois o resto na ordem recebida */
  function ordenarPor(nomes, posicao) {
    var dentro = [], fora = [];
    (nomes || []).forEach(function (nome, i) {
      var p = posicao[norm(nome)];
      if (p === undefined) fora.push(nome); else dentro.push({ nome: nome, p: p, i: i });
    });
    dentro.sort(function (a, b) { return a.p - b.p || a.i - b.i; });
    return dentro.map(function (x) { return x.nome; }).concat(fora);
  }
  function ordenar(nomes) { return ordenarPor(nomes, POSICAO); }
  var POS_ARQ = {};
  ARQUIVOS.forEach(function (c, i) { POS_ARQ[norm(c)] = i; });
  function ordenarArquivos(nomes) { return ordenarPor(nomes, POS_ARQ); }

  /* 04/11/2026 (dono): o painel da casa de rua em abas, igual ao cartão do condomínio — a Juliana não achava onde
   * gerar o contrato no meio de 118 campos. Só decide ONDE cada campo aparece; nada muda no Notion nem no salvar.
   *   Resumo · Documentos (dossiê + arquivos) · Compradores · Contrato (dados + gerar + Clicksign + Mais Controle)
   *   · Recebimentos · Andamento (checklist do processo, por departamento) */
  /* 09/11/2026 (dono): aba LINKS — layout, fotos e localização saíram do fim do Andamento ("cadastro da casa") */
  /* 26/11/2026 (dono, MELHORIAS ABA DE VENDAS): Andamento passa a ser a 2ª aba e o Mais Controle ganha aba própria
   * (saiu do fim da aba Contrato) */
  var ABAS = [["resumo", "Resumo"], ["andamento", "Andamento"], ["documentos", "Documentos"], ["compradores", "Compradores"],
              ["contrato", "Contrato"], ["recebimentos", "Recebimentos"], ["mc", "Mais Controle"], ["links", "Links"]];
  /* 13/11/2026 (dono): "algumas pessoas preferem ver em lista igual era antes" — o painel tem os dois jeitos. Em
   * LISTA ele volta a ser a coluna lateral à direita, com o resumo do processo parado no topo e só duas abas: tudo
   * do processo, na ordem (venda, compradores, contrato, etapas, links), e os documentos. Quem escolhe é a pessoa
   * (fica guardado no navegador dela). */
  /* 26/11/2026 (dono): "fazer tudo que citei antes na parte em lista" — a lista ganha abas próprias para o Contrato
   * (dados, gerar, Clicksign e recebimentos), o Mais Controle e os Links (com TIPO e MODELO? = casa modelo) */
  var ABAS_LISTA = [["etapas", "Todas as etapas"], ["documentos", "Documentos"], ["contrato", "Contrato"],
                    ["mc", "Mais Controle"], ["links", "Links"]];
  /* 26/11/2026 (dono): em Links também o TIPO e o MODELO? (casa modelo), para a pessoa preencher ali */
  var RE_LINKS = /^(LAYOUT|FOTOS?|LOCALIZACAO)\b|^TIPO$|^MODELO\??$/;
  function abaDoCampo(nome) {
    var n = norm(nome), g = GRUPO[n] || "";
    if (RE_LINKS.test(n)) return "links";
    if (/^COMPRADOR [12] - /.test(n)) return "compradores";
    if (g.indexOf("Contrato") === 0 || /^CONTRATO - /.test(n)) return "contrato";
    if (/^DOSSIE/.test(n)) return "documentos";
    return "andamento";
  }
  /* 13/11/2026 (dono): "perdeu a ordem dos processos" — o Andamento era separado por DEPARTAMENTO (banco, cartório,
   * entrega…), e cada departamento juntava campos de pontos diferentes do processo (RECEBEU? ia para o banco, lá em
   * cima, antes do cartório; GCAP ia para o cartório, antes da entrega). Agora são ETAPAS na MESMA ORDEM das colunas
   * da planilha de casas de rua da Secretaria de Vendas (ORDEM_PREFIXOS do vendas.html): cada etapa é um trecho
   * contínuo daquela ordem, então ler o Andamento de cima para baixo = ler a planilha da esquerda para a direita.
   * O primeiro padrão que casar leva o campo; dentro da etapa vale a ordem recebida (a da planilha). Coluna nova que
   * não casar com nenhuma etapa cai em OUTROS CAMPOS, no fim. */
  var ETAPAS = [
    ["AVALIAÇÃO E VALORES", /^AVALIACAO|^VALIDADE|^VALOR NA MAO|^COMISSAO/],
    ["CONTRATO DE COMPRA E VENDA E DOCUMENTOS AO CORRESPONDENTE", /^ARMAZENOU CONTRATO COMPRA|^EMITIU RCPM|^MANDOU TODOS OS DOC|^DATA DE ENVIO DOS DOC|^DATA DA VENDA$/],
    ["CONFORMIDADE E CONTRATO DO BANCO", /^MANDOU P\/ ?CONFORMIDADE|^PROCESSO CONFORME|^ASSINOU E ARMAZENOU CONTRATO DO BANCO|^DATA DE ASSINATURA DO CONTRATO|^VALOR DA PARCELA|^TEVE FGTS|^VALOR DO FGTS|^VALOR DA RENDA|^RENDA|^VALOR FINANCIADO|^VALOR DO SUBSIDIO|^AGENCIA/],
    ["PROTOCOLOS DE TRANSFERÊNCIA (ÁGUA E ENERGIA)", /^(TEM |DATA )?PROTOCOLO DE TRANS/],
    ["TAXA DE VISTORIA", /^RECEBEU TAXA VISTORIA/],
    ["PREFEITURA, ITBI E CARTÓRIO", /^TEM NUMERO DE CADASTRO|CADASTRO PREFEITURA|^ITBI|^DEU ENTRADA NO CARTORIO|^FICOU PRONTO O REGISTRO/],
    ["DEVOLUÇÃO E RECEBIMENTO DO BANCO", /^DEVOLVEU NO BANCO|^RECEBEU\??$/],
    ["VISTORIA E ENTREGA DA CASA", /^CASA APTA|^AGENDOU PRE.?VISTORIA|^DATA DA PRE.?VISTORIA|^TEM MANUAL|^AGUA TRANSFERIDA|^ENERGIA TRANSFERIDA|^ENTR?EGOU A CASA|^DATA DA ENTREGA|^PREENCHEU A PESQUISA|\(TRANSFERENCIA\)|VERIFICACAO DAS CONTAS|CONCLUSAO/],
    ["GCAP", /GCAP/],
    ["REPAROS E VISTORIA", /REPARO|ANEXAR AQUIVO|ANEXAR ARQUIVO|TITULARIDADES/],
    ["CADASTRO DA CASA", /^SITUACAO$|^REF$|^CIDADE|^SETOR$|^CASA$|^ENG\.? ?RESPONS|^MODELO\?|^RESERVADA|^TIPO|^DATA DA RESERVA/]
  ];
  var ETAPA_OUTROS = "OUTROS CAMPOS";
  /* título da etapa da coluna (sem o número) */
  function etapa(nome) {
    var n = norm(nome);
    for (var i = 0; i < ETAPAS.length; i++) if (ETAPAS[i][1].test(n)) return ETAPAS[i][0];
    return ETAPA_OUTROS;
  }
  /* nomes -> [{titulo:"1 · AVALIAÇÃO E VALORES", etapa, campos}] na ordem das etapas (dentro de cada uma, a ordem
   * recebida); etapa sem campo não aparece, e a numeração segue só as que aparecem */
  function porEtapa(nomes) {
    var ordem = ETAPAS.map(function (d) { return d[0]; }).concat([ETAPA_OUTROS]), caixas = {};
    ordem.forEach(function (d) { caixas[d] = []; });
    (nomes || []).forEach(function (nome) { caixas[etapa(nome)].push(nome); });
    var k = 0;
    return ordem.filter(function (d) { return caixas[d].length; })
      .map(function (d) { k++; return { titulo: k + " · " + d, etapa: d, campos: caixas[d] }; });
  }
  /* 12/11/2026 (dono): a DATA DE ASSINATURA DO CONTRATO (contrato do banco) fica no BANCO E CORRESPONDENTE, logo depois
   * do ASSINOU E ARMAZENOU CONTRATO DO BANCO? — antes caía em CONTRATO, no fim do Andamento, longe dele. */
  /* 12/11/2026 (dono): "tem que ficar na mesma lógica, um em cima do outro" — campos que andam juntos viram UM bloco da
   * grade (a pergunta em cima, a data embaixo, na mesma coluna). [pergunta, data]; o segundo sai de onde estiver. */
  /* 24/11/2026 (dono): mais pares — a DATA DA VENDA e a DATA DE ENVIO DOS DOCUMENTOS ficam sob a pergunta da etapa 2; a
   * AGÊNCIA sob "PROCESSO CONFORME?" (etapa 3); a data do GCAP (coluna nova, se existir) sob a pergunta do GCAP.
   * O primeiro item pode ser RegExp (o Notion grafa "CORESSPONDENTE"). */
  var PARES = [["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO"],
               ["ARMAZENOU CONTRATO COMPRA E VENDA?", "DATA DA VENDA"],
               [/^MANDOU TODOS OS DOCS?.*\?$/, "DATA DE ENVIO DOS DOCUMENTOS"],
               ["GEROU E ARMAZENOU GCAP?", "DATA GEROU GCAP"],
               ["PAGOU GCAP?", "DATA PAGOU GCAP"]];
  function casaPrimeiro(par, chave) { return par instanceof RegExp ? par.test(chave) : chave === norm(par); }
  /* nomes -> itens da grade: string (campo sozinho) ou [a, b] (par); só junta quando os dois existem */
  function agruparPares(nomes) {
    var lista = (nomes || []).slice(), chaves = lista.map(norm), usado = {}, out = [];
    lista.forEach(function (nome, i) {
      if (usado[i]) return;
      for (var k = 0; k < PARES.length; k++) {
        if (!casaPrimeiro(PARES[k][0], chaves[i])) continue;
        var j = chaves.indexOf(norm(PARES[k][1]));
        if (j >= 0 && !usado[j]) { usado[i] = usado[j] = true; out.push([nome, lista[j]]); return; }
      }
      usado[i] = true; out.push(nome);
    });
    return out;
  }
  /* itens da grade de uma etapa do painel: pares + campos soltos. Na etapa 2 (contrato de compra e venda) os pares vêm
   * primeiro e o EMITIU RCPM? depois (dono, 24/11). Só no painel; a ordem da planilha não muda. */
  var ETAPA_CONTRATO = "CONTRATO DE COMPRA E VENDA E DOCUMENTOS AO CORRESPONDENTE";
  /* 26/11/2026 (dono): "fica embolado o que é para preencher valores e o que é validação" — em cada etapa as
   * validações (SIM/NÃO, datas) vêm primeiro e os VALORES depois, debaixo do subtítulo { sub: "Valores" }. A etapa 1
   * já é só de valores e não ganha subtítulo. Na etapa 3 a ordem é a que o dono escreveu:
   *   MANDOU P/ CONFORMIDADE — PROCESSO CONFORME · ASSINOU — DATA (um cartão) · AGÊNCIA — TEVE FGTS · VALORES */
  var ETAPA_BANCO = "CONFORMIDADE E CONTRATO DO BANCO", ETAPA_VALORES = "AVALIAÇÃO E VALORES";
  var RE_VALOR = /^VALOR\b|^RENDA\b/;
  var ORDEM_BANCO = [/^MANDOU P\/ ?CONFORMIDADE/, /^PROCESSO CONFORME/, /^ASSINOU E ARMAZENOU CONTRATO DO BANCO/, /^AGENCIA/, /^TEVE FGTS/];
  function chaveItem(x) { return norm(Array.isArray(x) ? x[0] : x); }
  function itensDaEtapa(titulo, nomes) {
    var it = agruparPares(nomes);
    if (titulo === ETAPA_CONTRATO) it = it.filter(Array.isArray).concat(it.filter(function (x) { return !Array.isArray(x); }));
    if (titulo === ETAPA_VALORES) return it;
    var valores = it.filter(function (x) { return !Array.isArray(x) && RE_VALOR.test(chaveItem(x)); });
    var outros = it.filter(function (x) { return valores.indexOf(x) < 0; });
    if (titulo === ETAPA_BANCO) {
      var pos = function (x) { var k = chaveItem(x); for (var i = 0; i < ORDEM_BANCO.length; i++) if (ORDEM_BANCO[i].test(k)) return i; return ORDEM_BANCO.length; };
      outros = outros.map(function (x, i) { return { x: x, p: pos(x), i: i }; })
        .sort(function (a, b) { return a.p - b.p || a.i - b.i; }).map(function (o) { return o.x; });
    }
    if (!valores.length || !outros.length) return outros.concat(valores);
    return outros.concat([{ sub: "Valores" }], valores);
  }
  /* 04/11/2026 (dono): "na hora de gerar contrato, os campos que tiverem faltando, deixe editar naquele mesmo lugar".
   * Frase do faltasContrato (venda/ContratoVenda.js, casa de rua) -> colunas da VENDAS que resolvem. As colunas são as
   * que o GerarContrato.gs lê (RegrasVenda.COL, ContratoVenda.COLUNAS). Vendedor, loteamento e corretor têm o
   * formulário de cadastro do servidor (entrega 12) e não entram aqui. */
  var FALTA_COLUNAS = {
    "comprador 1: nome": ["CLIENTES"], "comprador 1: cpf": ["CPF"], "comprador 1: cpf invalido": ["CPF"],
    "comprador 1: nacionalidade": ["COMPRADOR 1 - NACIONALIDADE"], "comprador 1: endereco": ["COMPRADOR 1 - ENDEREÇO"],
    "comprador 2: nome": ["COMPRADOR 2 - NOME"], "comprador 2: cpf": ["COMPRADOR 2 - CPF"], "comprador 2: cpf invalido": ["COMPRADOR 2 - CPF"],
    "comprador 2: nacionalidade": ["COMPRADOR 2 - NACIONALIDADE"], "comprador 2: endereco": ["COMPRADOR 2 - ENDEREÇO"],
    "imovel: matricula individual": ["CONTRATO - MATRÍCULA INDIVIDUAL"], "imovel: cri da matricula": ["CONTRATO - CRI DA MATRÍCULA"],
    "imovel: area do lote": ["CONTRATO - ÁREA DO LOTE (M²)"], "imovel: alvara (numero)": ["CONTRATO - ALVARÁ Nº"],
    "imovel: alvara (data)": ["CONTRATO - ALVARÁ DATA"], "imovel: prazo previsto de conclusao das obras": ["DATA DA ENTREGA"],
    "imovel: habite-se (numero)": ["CONTRATO - HABITE-SE Nº"], "imovel: habite-se (data)": ["CONTRATO - HABITE-SE DATA"],
    "negociacao: valor do imovel": ["VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)"],
    "negociacao: sinal (valor)": ["CONTRATO - SINAL VALOR"], "negociacao: sinal (data)": ["CONTRATO - SINAL DATA"],
    "negociacao: entrada (valor)": ["CONTRATO - ENTRADA VALOR"], "negociacao: entrada (vencimento)": ["CONTRATO - ENTRADA VENCIMENTO"],
    "negociacao: intermediaria (vencimento)": ["CONTRATO - INTERMEDIÁRIA VENCIMENTO"],
    "negociacao: forma de pagamento": ["CONTRATO - FORMA DE PAGAMENTO"], "negociacao: comissao (valor)": ["COMISSÃO"],
    /* 05/11/2026: comissão (forma) e "paga por" saíram — a forma vem do cadastro do corretor e quem paga é sempre o comprador */
    "negociacao: valor na mao + comissao = valor do contrato": ["VALOR NA MÃO", "COMISSÃO", "VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)"],
    "corretor: corretor na venda": ["CORRETOR"]
  };
  function colunasDaFalta(falta) {
    var k = String(falta || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    return (FALTA_COLUNAS[k] || []).slice();
  }

  /* 05/11/2026 (dono): na aba Compradores, o grupo "Comprador 1" mostra sozinho o que foi preenchido no Resumo.
   * É a MESMA coluna do Notion nas duas abas (mesma caixa, mesmo salvar): editar numa grava a coluna e a outra
   * acompanha (vendas.html, pnEspelhar). Nada de coluna nova nem cópia. */
  var ESPELHO_COMPRADOR1 = [{ coluna: "CLIENTES", rotulo: "Nome" }, { coluna: "CPF", rotulo: "CPF" },
                            { coluna: "Nº Whatsapp", rotulo: "Nº WhatsApp" }, { coluna: "Email", rotulo: "E-mail" }];
  /* COMPRADOR 1 - E-MAIL é coluna antiga: o contrato e a Clicksign leem o e-mail do comprador 1 da coluna "Email"
   * (GerarContrato.gs: COMPRADOR1.email = cv("Email"); ClicksignVenda ONDE_EMAIL.comprador1 = "coluna Email").
   * No painel ela só aparece se tiver algo DIFERENTE do Email (para ninguém perder o que digitou ali); vazia ou
   * igual, some — senão seriam duas caixas de e-mail do mesmo comprador. O dado continua no Notion. */
  var EMAIL_ANTIGO_C1 = "COMPRADOR 1 - E-MAIL";
  function emailAntigoVisivel(antigo, email) {
    var a = String(antigo == null ? "" : antigo).trim().toLowerCase(), e = String(email == null ? "" : email).trim().toLowerCase();
    return !!a && a !== e;
  }

  /* 09/11/2026 (dono): "Resumo do processo" no topo da aba Resumo — VENDIDA · SITUAÇÃO DO PROCESSO · TRANSFERÊNCIA
   * DAS LIGAÇÕES · RECEBEU · GEROU GCAP · PAGOU GCAP · DATA DO GCAP · ENTREGUE. Cada item acha a coluna pelo nome
   * exato e, sem ela, pelo padrão (grafia do Notion varia: ENTEGOU/ENTREGOU…). VENDIDA não é coluna: o vendas.html
   * calcula (contrato assinado / tem cliente). Coluna inexistente = item some. */
  var PROCESSO = [
    { chave: "vendida", rotulo: "Vendida", calculado: true },
    { chave: "situacao", rotulo: "Situação do processo", exatos: ["SITUAÇÃO DO PROCESSO"], padrao: /^SITUACAO DO PROCESSO/ },
    { chave: "ligacoes", rotulo: "Transferência das ligações", exatos: ["TITULARIDADES TRANSFERIDAS?"], padrao: /^TITULARIDADES? TRANSFERID/ },
    { chave: "recebeu", rotulo: "Recebeu", exatos: ["RECEBEU?"], padrao: /^RECEBEU\??$/ },
    { chave: "gerou_gcap", rotulo: "Gerou GCAP", exatos: ["GEROU E ARMAZENOU GCAP?"], padrao: /^GEROU.*GCAP/ },
    { chave: "pagou_gcap", rotulo: "Pagou GCAP", exatos: ["PAGOU GCAP?"], padrao: /^PAGOU GCAP/ },
    { chave: "data_gcap", rotulo: "Data do GCAP", exatos: ["DATA DO GCAP", "DATA GCAP"] },  /* 24/11: só os nomes antigos; DATA GEROU/PAGOU GCAP viram a data dos cartões Gerou/Pagou */
    { chave: "entregue", rotulo: "Entregue", exatos: ["ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?", "ENTREGOU A CASA E PEGOU TERMO DE ENTREGA?"],
      padrao: /^ENTR?EGOU A CASA/ }
  ];
  /* nomes = colunas do schema -> [{chave, rotulo, coluna|null, calculado}] (item de coluna inexistente sai) */
  function resolverProcesso(nomes) {
    var lista = (nomes || []).map(function (x) { return { nome: x, n: norm(x) }; });
    return PROCESSO.map(function (it) {
      if (it.calculado) return { chave: it.chave, rotulo: it.rotulo, coluna: null, calculado: true };
      var col = null;
      (it.exatos || []).some(function (e) { var ne = norm(e); var a = lista.find(function (x) { return x.n === ne; }); if (a) col = a.nome; return !!a; });
      if (!col && it.padrao) { var b = lista.find(function (x) { return it.padrao.test(x.n); }); if (b) col = b.nome; }
      return col ? { chave: it.chave, rotulo: it.rotulo, coluna: col, calculado: false } : null;
    }).filter(Boolean);
  }

  /* ===== 24/11/2026 (dono): painel da casa de rua mais organizado — regras puras (vendas.html só desenha) ===== */

  /* Etapas que o painel NÃO desenha (continuam em ETAPAS: a planilha e colunasRua dependem delas). A numeração
   * "N ·" das que sobram segue sequencial. */
  var ETAPAS_FORA_DO_PAINEL = ["CADASTRO DA CASA", ETAPA_OUTROS];
  /* 26/11/2026 (dono): só no PAINEL (a planilha não muda) — a TAXA DE VISTORIA entra na etapa da prefeitura (ITBI e
   * cartório) e a VISTORIA E ENTREGA DA CASA vem antes da DEVOLUÇÃO E RECEBIMENTO DO BANCO ("troca a ordem do 7 e do 8").
   * A etapa juntada guarda a chave da prefeitura (etapa) e ganha o título novo. */
  var ETAPA_PREFEITURA = "PREFEITURA, ITBI E CARTÓRIO";
  var JUNTAR_NO_PAINEL = { "TAXA DE VISTORIA": ETAPA_PREFEITURA };
  var TITULO_NO_PAINEL = {};
  TITULO_NO_PAINEL[ETAPA_PREFEITURA] = "TAXA DE VISTORIA, PREFEITURA, ITBI E CARTÓRIO";
  var ORDEM_PAINEL = ["AVALIAÇÃO E VALORES", "CONTRATO DE COMPRA E VENDA E DOCUMENTOS AO CORRESPONDENTE", "CONFORMIDADE E CONTRATO DO BANCO",
                      "PROTOCOLOS DE TRANSFERÊNCIA (ÁGUA E ENERGIA)", ETAPA_PREFEITURA, "VISTORIA E ENTREGA DA CASA",
                      "DEVOLUÇÃO E RECEBIMENTO DO BANCO", "GCAP", "REPAROS E VISTORIA"];
  function porEtapaPainel(nomes) {
    var caixas = {};
    ORDEM_PAINEL.forEach(function (d) { caixas[d] = []; });
    (nomes || []).forEach(function (n) {
      var e = etapa(n);
      if (ETAPAS_FORA_DO_PAINEL.indexOf(e) >= 0) return;
      e = JUNTAR_NO_PAINEL[e] || e;
      (caixas[e] || (caixas[e] = [])).push(n);
    });
    var ordem = ORDEM_PAINEL.concat(Object.keys(caixas).filter(function (d) { return ORDEM_PAINEL.indexOf(d) < 0; }));
    var k = 0;
    return ordem.filter(function (d) { return caixas[d].length; })
      .map(function (d) { k++; return { titulo: k + " · " + (TITULO_NO_PAINEL[d] || d), etapa: d, campos: caixas[d] }; });
  }

  /* data "2026-11-05" (ou ISO com hora) -> "05/11/2026"; qualquer outra coisa -> "" (sem data = sem linha) */
  function formatarData(v) {
    if (v == null) return "";
    if (typeof v === "object" && v.start) v = v.start;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }
  /* hoje como AAAA-MM-DD (dia local, para gravar em coluna date) */
  function hojeIso(d) {
    d = d || new Date();
    var z = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  /* --- 1a/1b: situação do processo SEMPRE em texto --- */
  var SITUACAO_TEXTOS = { 1: "⏳ TEMPO CORRIDO MAIOR QUE 20 DIAS", 2: "⚠️ TEMPO CORRIDO MAIOR QUE 45 DIAS",
                          3: "🚨 TEMPO CORRIDO MAIOR QUE 45 DIAS E NÃO RECEBEU" };
  /* "⏳ TEMPO CORRIDO ..." -> "⏳ Tempo corrido ..." (mantém o emoji, só a primeira letra em maiúscula) */
  function textoAmigavel(t) {
    return String(t || "").trim().toLowerCase().replace(/^([^\p{L}\p{N}]*)(\p{L})/u, function (m, a, b) { return a + b.toUpperCase(); });
  }
  /* d = { fim, texto, numero, vendida } -> { texto, nivel: ok|amarelo|laranja|vermelho|neutro, concluido } */
  function situacaoProcesso(d) {
    d = d || {};
    if (norm(d.fim) === "FIM") return { texto: "Concluído", nivel: "ok", concluido: true };
    var NIVEIS = { 1: "amarelo", 2: "laranja", 3: "vermelho" };
    var t = String(d.texto == null ? "" : d.texto).trim();
    var num = Number(d.numero);
    if (t && t !== "-") {
      var nt = norm(t), nivel = /NAO RECEBEU/.test(nt) ? 3 : (/45 DIAS/.test(nt) ? 2 : (/20 DIAS/.test(nt) ? 1 : (NIVEIS[num] ? num : 0)));
      return { texto: textoAmigavel(t), nivel: NIVEIS[nivel] || "neutro", concluido: false };
    }
    if (NIVEIS[num]) return { texto: textoAmigavel(SITUACAO_TEXTOS[num]), nivel: NIVEIS[num], concluido: false };
    if (d.vendida) return { texto: "Em andamento", nivel: "neutro", concluido: false };
    return { texto: "—", nivel: "neutro", concluido: false, vazio: true };
  }
  /* colunas da situação: o texto (fórmula "SITUAÇÃO"), o número (fórmula "SITUAÇÃO DO PROCESSO") e o "FIM DO PROCESSO".
   * formulas = nomes das colunas do tipo fórmula (a "SITUAÇÃO" de texto só vale se for fórmula). */
  function resolverSituacao(nomes, formulas) {
    var f = (formulas || []).map(function (x) { return { nome: x, n: norm(x) }; });
    function acha(lista, re) { var a = lista.find(function (x) { return re.test(x.n); }); return a ? a.nome : null; }
    var todos = (nomes || []).map(function (x) { return { nome: x, n: norm(x) }; });
    return { texto: acha(f, /^SITUACAO$/), numero: acha(todos, /^SITUACAO DO PROCESSO/), fim: acha(f, /^FIM DO PROCESSO/) };
  }
  /* fórmulas que viram cartão e por isso saem da fileira de chips */
  function formulaDeCartao(nome) { return /^(SITUACAO|SITUACAO DO PROCESSO|FIM DO PROCESSO)$/.test(norm(nome)); }
  /* ordem dos cartões: Situação em PRIMEIRO enquanto o processo não terminou, ÚLTIMA quando "Concluído" */
  function ordemCartoes(chaves, concluido) {
    var resto = (chaves || []).filter(function (c) { return c !== "situacao"; });
    if (!(chaves || []).some(function (c) { return c === "situacao"; })) return resto;
    return concluido ? resto.concat(["situacao"]) : ["situacao"].concat(resto);
  }

  /* --- 1c (e 24/11): a data de cada cartão. Cada cartão casa só a SUA coluna; coluna inexistente = sem linha. --- */
  function colunaDataCartao(chave, nomes) {
    var lista = (nomes || []).map(function (x) { return { nome: x, n: norm(x) }; });
    function exato(e) { var a = lista.find(function (x) { return x.n === norm(e); }); return a ? a.nome : null; }
    function padrao(re) { var a = lista.find(function (x) { return re.test(x.n); }); return a ? a.nome : null; }
    switch (chave) {
      case "vendida": return exato("DATA DA VENDA");
      case "recebeu": return exato("RECEBIMENTO - FINANCIAMENTO DATA");
      case "entregue": return exato("DATA DA ENTREGA");
      case "gerou_gcap": return padrao(/^DATA.*GEROU.*GCAP/);
      case "pagou_gcap": return padrao(/^DATA.*PAGOU.*GCAP/);
    }
    return null;
  }
  /* GEROU/PAGOU GCAP marcado SIM -> { coluna, valor: hoje } se a coluna de data existir e estiver vazia; senão null.
   * NÃO não apaga nada; data já preenchida nunca é sobrescrita. atualDe(nome) devolve o valor atual da coluna. */
  function carimboGcap(prop, valor, nomes, atualDe, hoje) {
    if (norm(valor) !== "SIM") return null;
    var n = norm(prop), chave = /GEROU.*GCAP/.test(n) ? "gerou_gcap" : (/^PAGOU GCAP/.test(n) ? "pagou_gcap" : "");
    if (!chave) return null;
    var col = colunaDataCartao(chave, nomes);
    if (!col || formatarData(atualDe(col))) return null;
    return { coluna: col, valor: hoje || hojeIso() };
  }

  /* --- 1d: água e energia dos cartões (status vem da tela Ligações) --- */
  function tipoConcessionaria(nome) {
    var n = norm(nome);
    if (/EQUATORIAL/.test(n)) return "energia";
    if (/SANESC|SANEAGO/.test(n)) return "agua";
    return "";
  }
  function statusLigacao(status) {
    var n = norm(status);
    if (!n || n === "-") return null;
    if (/^TRANSFERID/.test(n)) return { texto: "Transferida", nivel: "ok", ordem: 3 };
    if (/^ENTREGUE.*NAO TRANSFERID/.test(n)) return { texto: "Entregue, não transferida", nivel: "alerta", ordem: 0 };
    if (/^NAO LIGAD/.test(n)) return { texto: "Não ligada", nivel: "nao", ordem: 1 };
    if (/^LIGAD/.test(n)) return { texto: "Ligada, não transferida", nivel: "alerta", ordem: 2 };
    if (/NAO TRANSFERID/.test(n)) return { texto: "Não transferida", nivel: "alerta", ordem: 0 };
    return null;
  }
  /* ligs = linhas da tela Ligações da casa ({concessionaria, uc, status}); tipo "agua"|"energia"; valorVenda = o SIM/NÃO
   * antigo da venda (AGUA/ENERGIA TRANSFERIDA). Havendo mais de uma ligação do tipo, vale a MENOS adiantada. */
  function statusAguaEnergia(ligs, tipo, valorVenda) {
    var achados = (ligs || []).filter(function (l) { return tipoConcessionaria(l && l.concessionaria) === tipo; })
      .map(function (l) { return statusLigacao(l.status); }).filter(Boolean);
    if (achados.length) {
      achados.sort(function (a, b) { return a.ordem - b.ordem; });
      return { texto: achados[0].texto, nivel: achados[0].nivel, origem: "ligacoes" };
    }
    var v = norm(valorVenda);
    if (v === "SIM") return { texto: "Transferida", nivel: "ok", origem: "venda" };
    if (v === "NAO") return { texto: "Não transferida", nivel: "nao", origem: "venda" };
    return { texto: "—", nivel: "vazio", origem: "" };
  }

  /* --- 3: protocolos de transferência (água e energia): SIM/NÃO automático conforme o anexo --- */
  /* nomes -> [{ tipo: "agua"|"energia", select, arquivo, data }] (cada um pode ser null se a coluna não existe) */
  function protocolos(nomes) {
    return ["agua", "energia"].map(function (tipo) {
      var alvo = tipo === "agua" ? "AGUA" : "ENERGIA", r = { tipo: tipo, select: null, arquivo: null, data: null };
      (nomes || []).forEach(function (nome) {
        var n = norm(nome);
        if (n.indexOf(alvo) < 0 || !/PROTOCOLO DE TRANS/.test(n)) return;
        if (/^DATA\b/.test(n)) r.data = r.data || nome;
        else if (/^TEM PROTOCOLO/.test(n)) r.select = r.select || nome;
        else if (/^PROTOCOLO DE TRANS/.test(n)) r.arquivo = r.arquivo || nome;
      });
      return r;
    });
  }
  /* d = { carregando, temArquivo, select } -> { texto, nivel: ok|nao|alerta|carregando, ver, anexar } */
  function estadoProtocolo(d) {
    d = d || {};
    if (d.carregando) return { texto: "carregando…", nivel: "carregando", ver: false, anexar: false };
    if (d.temArquivo) return { texto: "SIM · anexado", nivel: "ok", ver: true, anexar: false };
    if (norm(d.select) === "SIM") return { texto: "SIM · sem anexo", nivel: "alerta", ver: false, anexar: true };
    return { texto: "NÃO · sem anexo", nivel: "nao", ver: false, anexar: true };
  }
  /* anexo do protocolo enviado: grava hoje na coluna de data (se existir e estiver vazia) */
  function carimboProtocolo(p, atualDe, hoje) {
    if (!p || !p.data || formatarData(atualDe(p.data))) return null;
    return { coluna: p.data, valor: hoje || hojeIso() };
  }

  /* --- 26/11/2026 (dono): data de pagamento do GCAP ---
   * O Apps Script (Code.gs, criarAtividadesGcap_) cria a atividade "Pagar GCAP" com prazo no 1º dia útil (seg–sex) do
   * mês seguinte à DATA DE ASSINATURA DO CONTRATO (contrato da Caixa). A mesma conta aqui, para o painel, o Resumo e a
   * planilha mostrarem a data e o alerta. */
  function vencimentoGcap(dataAssinatura) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((dataAssinatura && dataAssinatura.start) || dataAssinatura || "").trim());
    if (!m) return "";
    var ano = Number(m[1]), mes = Number(m[2]);
    var anoS = mes === 12 ? ano + 1 : ano, mesS = mes === 12 ? 1 : mes + 1;
    var d = new Date(anoS, mesS - 1, 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return hojeIso(d);
  }
  /* d = { assinatura, pagou, dataPagou, hoje } -> null (sem contrato da Caixa) ou
   * { vence: "AAAA-MM-DD", venceBR, dias, texto, nivel: ok|vermelho|laranja|neutro, chave: pago|vencido|semana|aberto } */
  function estadoGcap(d) {
    d = d || {};
    var vence = vencimentoGcap(d.assinatura);
    if (!vence) return null;
    var venceBR = formatarData(vence), hoje = d.hoje || hojeIso();
    var dias = Math.round((Date.UTC(+vence.slice(0, 4), +vence.slice(5, 7) - 1, +vence.slice(8, 10)) -
                           Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10))) / 86400000);
    if (norm(d.pagou) === "SIM") {
      var pg = formatarData(d.dataPagou);
      return { vence: vence, venceBR: venceBR, dias: dias, chave: "pago", nivel: "ok", texto: "Pago" + (pg ? " em " + pg : "") };
    }
    if (dias < 0) return { vence: vence, venceBR: venceBR, dias: dias, chave: "vencido", nivel: "vermelho",
                           texto: "Vencido há " + (-dias) + (dias === -1 ? " dia" : " dias") };
    if (dias <= 7) return { vence: vence, venceBR: venceBR, dias: dias, chave: "semana", nivel: "laranja",
                            texto: dias === 0 ? "Vence hoje" : "Vence em " + dias + (dias === 1 ? " dia" : " dias") };
    return { vence: vence, venceBR: venceBR, dias: dias, chave: "aberto", nivel: "neutro", texto: "A pagar" };
  }

  /* --- 26/11/2026 (dono): "no agendamento de pré-vistoria deixa um alerta caso ainda não tenha o protocolo anexado" ---
   * faltam = tipos ("agua"|"energia") cujo protocolo ainda não tem anexo; agendou = valor do AGENDOU PRÉ VISTORIA?.
   * -> null (nada falta) ou { nivel: vermelho|laranja, texto } */
  function alertaPreVistoria(faltam, agendou) {
    faltam = (faltam || []).filter(function (t) { return t === "agua" || t === "energia"; });
    if (!faltam.length) return null;
    var nomes = faltam.map(function (t) { return t === "agua" ? "água" : "energia"; }).join(" e ");
    var plural = faltam.length > 1;
    if (norm(agendou) === "SIM")
      return { nivel: "vermelho", texto: "Pré-vistoria agendada sem o protocolo de transferência de " + nomes + " anexado" +
               " — anexe " + (plural ? "os protocolos" : "o protocolo") + " na etapa dos protocolos." };
    return { nivel: "laranja", texto: "Antes de agendar a pré-vistoria, anexe o protocolo de transferência de " + nomes + "." };
  }

  var api = { OCULTOS: OCULTOS, PROCESSO: PROCESSO, resolverProcesso: resolverProcesso, ESPELHO_COMPRADOR1: ESPELHO_COMPRADOR1, EMAIL_ANTIGO_C1: EMAIL_ANTIGO_C1,
              emailAntigoVisivel: emailAntigoVisivel, PREFIXOS_OCULTOS: PREFIXOS_OCULTOS, GRUPOS: GRUPOS, ocultoNoPainel: ocultoNoPainel,
              grupoDoCampo: grupoDoCampo, ordenar: ordenar, ordenarArquivos: ordenarArquivos,
              ABAS: ABAS, ABAS_LISTA: ABAS_LISTA, abaDoCampo: abaDoCampo, ETAPAS: ETAPAS, etapa: etapa, porEtapa: porEtapa,
              /* nomes antigos (antes de 13/11 eram departamentos): continuam respondendo, agora por etapa */
              departamento: etapa, porDepartamento: porEtapa, agruparPares: agruparPares, PARES: PARES,
              colunasDaFalta: colunasDaFalta,
              ETAPAS_FORA_DO_PAINEL: ETAPAS_FORA_DO_PAINEL, porEtapaPainel: porEtapaPainel, itensDaEtapa: itensDaEtapa, formatarData: formatarData,
              hojeIso: hojeIso, situacaoProcesso: situacaoProcesso, resolverSituacao: resolverSituacao, formulaDeCartao: formulaDeCartao,
              ordemCartoes: ordemCartoes, colunaDataCartao: colunaDataCartao, carimboGcap: carimboGcap, tipoConcessionaria: tipoConcessionaria,
              statusLigacao: statusLigacao, statusAguaEnergia: statusAguaEnergia, protocolos: protocolos, estadoProtocolo: estadoProtocolo,
              carimboProtocolo: carimboProtocolo, vencimentoGcap: vencimentoGcap, estadoGcap: estadoGcap,
              alertaPreVistoria: alertaPreVistoria, ORDEM_PAINEL: ORDEM_PAINEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.PainelCasa = api;
})(typeof window !== "undefined" ? window : this);
