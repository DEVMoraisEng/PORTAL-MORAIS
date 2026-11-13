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
                 "DOSSIÊ", "DOSSIÊ IMÓVEL", "DOSSIÊ - OBSERVAÇÃO DO COMPRADOR"];
  /* RECEBIMENTO - * (data, comprovante, quem confirmou): moram no bloco Recebimentos */
  var PREFIXOS_OCULTOS = ["RECEBIMENTO - "];
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
  var ABAS = [["resumo", "Resumo"], ["documentos", "Documentos"], ["compradores", "Compradores"],
              ["contrato", "Contrato"], ["recebimentos", "Recebimentos"], ["andamento", "Andamento"], ["links", "Links"]];
  /* 13/11/2026 (dono): "algumas pessoas preferem ver em lista igual era antes" — o painel tem os dois jeitos. Em
   * LISTA ele volta a ser a coluna lateral à direita, com o resumo do processo parado no topo e só duas abas: tudo
   * do processo, na ordem (venda, compradores, contrato, etapas, links), e os documentos. Quem escolhe é a pessoa
   * (fica guardado no navegador dela). */
  var ABAS_LISTA = [["etapas", "Todas as etapas"], ["documentos", "Documentos"]];
  var RE_LINKS = /^(LAYOUT|FOTOS?|LOCALIZACAO)\b/;
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
   * da planilha de casas de rua da Secretária de Vendas (ORDEM_PREFIXOS do vendas.html): cada etapa é um trecho
   * contínuo daquela ordem, então ler o Andamento de cima para baixo = ler a planilha da esquerda para a direita.
   * O primeiro padrão que casar leva o campo; dentro da etapa vale a ordem recebida (a da planilha). Coluna nova que
   * não casar com nenhuma etapa cai em OUTROS CAMPOS, no fim. */
  var ETAPAS = [
    ["AVALIAÇÃO E VALORES", /^AVALIACAO|^VALIDADE|^VALOR NA MAO|^COMISSAO/],
    ["CONTRATO DE COMPRA E VENDA E DOCUMENTOS AO CORRESPONDENTE", /^ARMAZENOU CONTRATO COMPRA|^EMITIU RCPM|^MANDOU TODOS OS DOC|^DATA DE ENVIO DOS DOC/],
    ["CONFORMIDADE E CONTRATO DO BANCO", /^MANDOU P\/ ?CONFORMIDADE|^PROCESSO CONFORME|^ASSINOU E ARMAZENOU CONTRATO DO BANCO|^DATA DE ASSINATURA DO CONTRATO|^VALOR DA PARCELA|^TEVE FGTS|^VALOR DO FGTS|^VALOR DA RENDA|^RENDA|^VALOR FINANCIADO|^VALOR DO SUBSIDIO/],
    ["PROTOCOLOS DE TRANSFERÊNCIA (ÁGUA E ENERGIA)", /^(TEM )?PROTOCOLO DE TRANS/],
    ["TAXA DE VISTORIA E AGÊNCIA", /^RECEBEU TAXA VISTORIA|^AGENCIA/],
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
  var PARES = [["ASSINOU E ARMAZENOU CONTRATO DO BANCO?", "DATA DE ASSINATURA DO CONTRATO"]];
  /* nomes -> itens da grade: string (campo sozinho) ou [a, b] (par); só junta quando os dois existem */
  function agruparPares(nomes) {
    var lista = (nomes || []).slice(), chaves = lista.map(norm), usado = {}, out = [];
    lista.forEach(function (nome, i) {
      if (usado[i]) return;
      for (var k = 0; k < PARES.length; k++) {
        if (chaves[i] !== norm(PARES[k][0])) continue;
        var j = chaves.indexOf(norm(PARES[k][1]));
        if (j >= 0 && !usado[j]) { usado[i] = usado[j] = true; out.push([nome, lista[j]]); return; }
      }
      usado[i] = true; out.push(nome);
    });
    return out;
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
    { chave: "data_gcap", rotulo: "Data do GCAP", exatos: ["DATA DO GCAP", "DATA GCAP"], padrao: /DATA.*GCAP|GCAP.*DATA/ },
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

  var api = { OCULTOS: OCULTOS, PROCESSO: PROCESSO, resolverProcesso: resolverProcesso, ESPELHO_COMPRADOR1: ESPELHO_COMPRADOR1, EMAIL_ANTIGO_C1: EMAIL_ANTIGO_C1,
              emailAntigoVisivel: emailAntigoVisivel, PREFIXOS_OCULTOS: PREFIXOS_OCULTOS, GRUPOS: GRUPOS, ocultoNoPainel: ocultoNoPainel,
              grupoDoCampo: grupoDoCampo, ordenar: ordenar, ordenarArquivos: ordenarArquivos,
              ABAS: ABAS, ABAS_LISTA: ABAS_LISTA, abaDoCampo: abaDoCampo, ETAPAS: ETAPAS, etapa: etapa, porEtapa: porEtapa,
              /* nomes antigos (antes de 13/11 eram departamentos): continuam respondendo, agora por etapa */
              departamento: etapa, porDepartamento: porEtapa, agruparPares: agruparPares, PARES: PARES,
              colunasDaFalta: colunasDaFalta };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.PainelCasa = api;
})(typeof window !== "undefined" ? window : this);
