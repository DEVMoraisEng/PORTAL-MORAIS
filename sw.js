/* Service worker — abre o site offline.
   dist/*.json NUNCA vai pro cache do SW: é o dado vivo, e o app.js já guarda
   a última cópia no localStorage. Cachear aqui mostraria dado velho pra sempre. */
/* A versão do CACHE precisa MUDAR sempre que esta lista mudar: o navegador
   só baixa os arquivos novos quando o nome do cache é outro. Sem trocar o
   número, quem já visitou o site continuaria com a lista antiga (e a
   ligacoes.html não abriria offline). v3 -> v4 por causa dela.
   v4 -> v5: index.html e ligacoes.html mudaram (layout de celular e correções);
   trocar o número faz o navegador rebaixar os dois na hora, em vez de deixar a
   cópia velha valendo pra quem abrir sem internet.
   v5 -> v6: app.js, ligacoes.html e vendas.html mudaram (correção do sumiço
   dos valores salvos — edições locais). Sem trocar o número, quem abrisse
   offline continuaria com o código antigo e o problema voltaria.
   v7 -> v8: ligacoes.html (as datas em 01/01/2000 voltaram a aparecer na tela)
   e vendas.html (a edição pela célula da planilha agora também fica guardada
   no navegador até o site republicar).
   v8 -> v9: ligacoes.html e index.html ganharam o tema claro/escuro, a
   ordenação por clique no cabeçalho e a correção da linha que só sumia depois
   do F5. Sem trocar o número, quem abrisse offline ficaria com a versão
   anterior.
   v9 -> v10: entrou a pos-obra.html (setor novo) e o index.html ganhou o card
   dela. Sem trocar o número, o navegador de quem já visitou continuaria sem a
   página nova na lista e ela não abriria offline.
   v10 -> v11: a pos-obra.html mudou bastante (alertas, calendário por semana,
   indicadores) e a ligacoes.html teve o aviso de versão atualizado.
   v11 -> v12: pos-obra.html (cor por responsável, horário flexível, cadastro
   de serviço/responsável, cor por serviço nos gráficos e telefone formatado),
   vendas.html e app.js (cadastro de corretor + fmtTel). Entrou também a
   casas-vendidas.html, que estava FALTANDO nesta lista desde que virou página
   própria — a vendas.html a abre num iframe, e sem internet o iframe caía no
   index.html em vez do painel.
   v12 -> v13: entrou a servicos.html (agenda do dia, sem login). Ela precisa
   estar aqui: é a tela que mais roda na rua, com sinal ruim — em cache, ela
   abre offline e mostra a última lista salva em vez de tela branca.
   v16 -> v17: DESEMPENHO (set/26). Mudaram app.js (fila de requisições,
   dedupe e o store de sessão), analise.html e pos-obra.html. ESTE número
   PRECISAVA mudar junto: o service worker entrega os arquivos do cache
   "portal-morais-v16" enquanto o nome do cache for o mesmo, e nem Ctrl+F5
   derruba isso de forma confiável. Foi por isso que a janela anônima ficou
   rápida (não tem service worker registrado) e o navegador de sempre
   continuou lento com exatamente o mesmo site publicado — ele estava
   rodando o app.js ANTIGO.
   v13 -> v14: pos-obra.html (botão do link da agenda) e ligacoes.html
   (GS_ESPERADO alinhado ao r17).
   v14 -> v15: MELHORIAS do pós obra (RETORNO, retorno que não some, chamado
   finalizado congelado, WhatsApp com data em destaque, dois avisos de
   material, arrastar no calendário, CIDADE/SETOR/TELEFONE editáveis).
   v15 -> v16: CIDADE lida de fórmula, botão de excluir retorno, cores dos
   avisos de material e endereço com setor/cidade na servicos.html.
   v17 -> v18: a pos-obra.html passou a LER do dist/pos_obra.json em vez do
   Apps Script, e a ponte local de serviço novo mudou de formato. ESTE número
   PRECISA subir junto: enquanto o nome do cache for o mesmo, o service worker
   entrega a pos-obra.html ANTIGA do cache — e nem Ctrl+F5 derruba isso de
   forma confiável. Foi exatamente o que fez a janela anônima ficar rápida e o
   navegador de sempre continuar lento na rodada passada.
   A analise.html entrou na lista agora: ela estava de fora desde que virou
   página própria, então nunca abria offline.
   v19 -> v20: entrou a marca de versão no endereço do app.js
   (app.js?v=28). Repare no ignoreSearch da linha de fallback mais abaixo: sem
   ele, o cache guardaria "./app.js" e a tela pediria "./app.js?v=28", que para
   o navegador é OUTRO endereço — offline, o arquivo não seria encontrado e a
   tela abriria sem o app.js, ou seja, quebrada. Com ignoreSearch, o que muda é
   só o ?v=, e a cópia guardada continua servindo.
   Mudaram também app.js e pos-obra.html (r28: criação não vai mais para a
   fila, conferência pelo opId, fila que drena sozinha).
   v18 -> v19: abrir uma obra passou a ler dist/pos_obra/<id>.json, o botão de
   novo serviço virou formulário (o chamado só nasce preenchido) e o anexo
   pede o link no clique. Tudo na pos-obra.html. */
/* v20 -> v21: app.js (contrato de retorno da criacao + conferencia do opId
   repetida) e pos-obra.html (ordem do FALHOU_SEM_CRIAR). Sem trocar esta
   versao, o navegador de quem ja abriu o portal continuaria servindo o
   app.js antigo do cache e a correcao nao chegaria em ninguem. */
/* v22 -> v23: criação otimista do serviço de pós obra. A tela desenha o
   chamado ANTES da resposta do servidor (id provisório trocado pelo real
   quando ela chega) e reconcilia por opId se a pessoa fechar no meio.
   Mudaram: pos-obra.html e app.js. */
/* v24 -> v25: entrou a GESTÃO DE DOCUMENTOS (documentos.html) e a tela de
   demandas do mês (demandas.html), e o app.js ganhou as ações do setor novo.
   Sem trocar este número, o service worker continua entregando o app.js
   ANTIGO do cache — e nem Ctrl+F5 derruba isso de forma confiável. */
/* v28 -> v29: vendas.html — PARCELA/FGTS/RENDA passaram a aparecer na planilha
   da Secretária (despublicados no fetch_vendas.py) e entrou o alerta de faixa
   (VALOR DA PARCELA / VALOR DO FGTS fora de 1.000–50.000). Também entrou a
   ORDENAÇÃO por clique no cabeçalho das tabelas (planilha e Casas Modelo).
   documentos.html: os cards de alerta e o painel da obra passaram a mostrar a
   REFERÊNCIA (colunas -AUTO), que é o que identifica a obra sem ENDEREÇO. */
/* v29 -> v30: documentos.html — corrigida a referência (-AUTO) de SETOR e
   CPF/CNPJ, que estavam pegando a coluna errada; e o campo que a pessoa acaba
   de preencher deixou de sumir da lista de alertas na hora — agora fica
   visível (confirmado ✓) até o próximo carregamento real dos dados, e os
   grupos abertos não fecham mais sozinhos a cada repintura. */
/* v30 -> v31: app.js e index.html — acesso liberado na coluna ACESSOS do
   Notion (o caso foi a "RAS OBRAS") não aparecia para quem já estava logado,
   porque a lista de acessos do navegador era a do dia do login e nunca mais
   era atualizada. Agora a resposta do "me" regrava tipo/acessos e o hub
   repinta os botões sozinho. Sem trocar este número, o service worker
   continuaria entregando o app.js ANTIGO do cache — e nem Ctrl+F5 derruba
   isso de forma confiável. */
/* v31 -> v32 (21/09/2026): a limpeza do "activate" apagava TODO cache que não
   fosse o do portal — e o "caches" é da origem inteira (devmoraiseng.github.io),
   então cada versão nova do portal apagava também a cópia offline das RAS, que
   agora têm service worker próprio. A limpeza passa a mexer só nos caches cujo
   nome começa com "portal-morais-". */
/* v32 -> v33: entrou a analise-dados.html (ANÁLISE DE DADOS, vinda do
   CONTROLES-INTERNOS) e o index.html ganhou o card dela. */
/* v33 -> v34: entrou a obras.html (aba de OBRAS). */
/* v34 -> v35 (23/09/26): pacote de melhorias — app.js (dicas nos botões,
   listas grandes, rotas de escrita das obras), obras.html, ligacoes.html,
   pos-obra.html, simulacoes.html. Sem subir este número, o navegador de quem
   já abriu o portal continua servindo as telas ANTIGAS do cache — e foi isso
   que mostrou a lista de contas vazia depois de tudo publicado. */
/* v35 -> v36 (24/09/26): app.js com a faxina dos dados guardados e
   obras.html com o acompanhamento ao vivo. */
/* v36 -> v37 (24/09/26): botão Recarregar em todas as telas (app.js). */
/* v37 -> v38 (24/09/26): ao vivo (app.js) e baixa otimista (obras.html). */
/* v38 -> v39 (24/09/26): conteúdo das atividades sem travar (obras.html). */
/* v39 -> v40 (24/09/26): comentários guardados e pela leitura (app.js, obras.html). */
/* v40 -> v41 (25/09/26): fila offline na baixa, links clicáveis, acesso tolerante. */
/* v41 -> v42 (25/09/26): simulações com detalhe rápido; contas insistem. */
/* v42 -> v43 (25/09/26): app.js repete sozinho quando o Google devolve
   página de erro no lugar da resposta. */
/* v43 -> v44 (25/09/26): edição salva não some no build nem ao sair;
   chips do painel na hora. */
/* v44 -> v45 (25/09/26): leitura ao vivo antiga não apaga o que acabou de ser salvo. */
/* v45 -> v46 (25/09/26): obra grava na hora (otimista) — alerta some ao preencher. */
/* v46 -> v47 (25/09/26): fogos.js — fogos no painel quando a meta é batida no mês. */
/* v47 -> v48 (25/09/26): aniversariantes do mês no painel. */
/* v48 -> v49 (25/09/26): abas Atividades e Processos, editor de conteúdo, sino de atrasadas. */
/* v49 -> v50 (25/09/26 tarde): Arquivos, pré-carregamento das Atividades, filtros. */
/* v50 -> v51 (25/09/26 noite): tipo PORTAL no painel, checklist item a item, criação protegida. */
/* v51 -> v52 (25/09/26 16h): ações novas pela ESCRITA (rf-rotas.js), criação otimista. */
/* v52 -> v53 (25/09/26 17h): Mural, checklists de verdade, tudo pré-carregado. */
/* v53 -> v54 (28/09/26): baixa no checklist do Mural, aniversários na hora,
   legenda de cores e atividades próprias no calendário, imagens do Supabase. */
/* v54 -> v55 (28/09/26 tarde): chat com envio direto ao Supabase, faixa própria,
   baixa do Mural que não volta atrás, legenda com fundo. */
/* v55 -> v56 (28/09/26): fotos do chat comprimidas, anexo arquivado no chat. */
/* v56 -> v57 (28/09/26): cópias do painel não somem (Recarregar/24 h/Sair). */
/* v57 -> v58 (28/09/26): anexo arquivado nos comentários do Notion. */
/* v58 -> v59 (28/09/26): mensagem "enviando" guardada no navegador e retomada. */
/* v59 -> v60 (28/09/26): baixa confirmada pelo Notion, sincronia de 1 min. */
/* v60 -> v61 (28/09/26): Mapa de Obras no painel, status das atividades sem embolar. */
/* v61 -> v62 (28/09/26): Mural e checklists na hora. */
/* v62 -> v63 (28/09/26 noite): @menções, reordenar conteúdo, anexo que sumia. */
/* v63 -> v64 (28/09/26 noite): mensagem e anexo "enviando" não somem ao fechar e abrir. */
/* v64 -> v65 (28/09/26 noite): envio continua ao sair da página; obra com casas vendidas/entregues. */
/* v65 -> v66 (28/09/26): index.html com o botão Conferência OC × NF em Automações.
   v67 -> v69 (29/09/26): botão aponta para o endereço que está no ar, CONFER-NCIA-COMPRAS. */
/* v69 -> v70 (29/09/26): atividades.html — comentários sempre atuais (relê a cada 15 s, avisa quando não atualiza, ↻). */
/* v70 -> v71 (29/09/26): editor-blocos.js v9 — arrastar para reorganizar e fila sem "espere" (atividades, processos, arquivos). */
/* v71 -> v72 (29/09/26): atividades.html — "Criar checklist com os responsáveis" na nova atividade. */
/* v72 -> v73 (29/09/26): index.html (Mural com comentários no topo) e atividades.html (atividade excluída no Notion sai do portal). */
/* v73 -> v74 (29/09/26 tarde): atividades.html + editor-blocos.js v10 (checklist se atualiza sozinho, Recarregar confere o Notion) e index.html (Mural sem item vazio). */
/* v74 -> v75 (29/09/26 noite): obras.html (botões de ligação sem embolar) e atividades.html (arrastar no calendário muda o prazo). */
/* v75 -> v76 (29/09/26 noite): obras.html — preencher direto na tabela de obras. */
/* v76 -> v77 (30/09/26): atividades.html — economia de cota (releituras mais espaçadas, pausa com a tela parada). */
/* v77 -> v78 (30/09/26): vendas.html (card do condomínio: sinais 60/90 e pós-chaves; salvar as 3 datas juntas) e simulacoes.html (documentos da venda copiados pelo servidor). */
/* v78 -> v79 (30/09/26 tarde): simulacoes.html (decisão da proposta com status em destaque, resultado sob os botões, confirmação no Notion enquanto salva) e rf-rotas.js v11 (2 pedidos por faixa; 3ª implantação opcional). */
/* v80 -> v81 (30/09/26 noite): vendas.html — dia de pagamento a partir do dia 5, bloco entrada/FGTS/subsídio no fluxo e todas as colunas da planilha do condomínio por padrão. */
/* v81 -> v82 (01/10/26): pos-obra.html (validação do ADM, obra nova para todos com endereço no padrão, data de assinatura vazia por quem tem acesso), atv-alertas.js v7 (mensagens novas e validações no sino), atividades.html e index.html. */
/* v82 -> v83 (01/10/26): analise-dados.html — ESCRITÓRIO MOURA DANTAS fora do Custo Escritório. */
/* v94 -> v95 (05/10/26): revisão das atividades — alertas-docs.js (coluna da obra, sem cópias, CERTIDÃO DO LOTE em Projetos, alerta de emissão das certidões), documentos.html, vendas.html e index.html. */
/* v95 -> v96 (05/10/26): editor-blocos.js v11 + atividades.html — PDFs e fotos com link vencido (InvalidJWT) renovam sozinhos. */
/* v96 -> v97 (05/10/26): grupos de atividades fechados por padrão (documentos.html e obras.html). */
/* v97 -> v98 (05/10/26): simulacoes.html — leituras/envios das Simulações fora da fila (Atualizar, detalhe, conversa, correspondente) e aba Servidores. */
/* v113 -> v114 (08/10/26): app.js — NAO_AUTORIZADO numa gravação não desloga mais sem conferir a sessão (deslogava no meio de várias edições nas Atividades). */
/* v116 -> v117 (15/10/26): vendas.html — filtros de prazo leem SITUAÇÃO DO PROCESSO (não ASSINATURA - SITUAÇÃO) e planilha 10x mais rápida (cache do normNome/faixa/processo completo). */
const CACHE = "portal-morais-v252";  /* 01/11 (v252: vendas — correção 1 do plano 23: assinatura na linha só com ASSINATURA_LINHAS=1 e só nas páginas de assinatura; RubricasVenda v3, assinatura-ui v19, venda-dossie v50); 01/11 (v251: vendas — envio para assinatura acha a linha de assinatura de cada pessoa no contrato e nos termos e pede a assinatura em cima dela; RubricasVenda v2, assinatura-ui v18, venda-dossie v49); 01/11 (v250: vendas — contrato/termo assinado por todos: a aba fica só com Documentos assinados (Ver e Baixar "… - ASSINADO.pdf"), o servidor recusa mudanças (CONTRATO_ASSINADO/TERMO_ASSINADO), cópia do Docs com o nome final em vez de "contrato-provisorio"; venda-dossie v48, assinatura-ui v17); 01/11 (v249: vendas — cônjuge da pré-reserva não muda com o envelope do termo aberto, a tela diz para cancelar o envelope; venda-dossie v47); 01/11 (v248: vendas — termo de pré-reserva: o cônjuge não assina por padrão, caixa opcional "Incluir o cônjuge na pré-reserva"; venda-dossie v46); 01/11 (v247: vendas — e-mail que falta de fiador e do cônjuge do comprador aparece no Gerar pré-contrato e tem caixa no contrato final; termo de pré-reserva sem o cônjuge; envio da assinatura espera 240 s e, sem resposta, manda clicar em Atualizar situação; venda-dossie v45, assinatura-ui v16); 01/11 (v246: vendas — Andamento: resposta do envio acha o campo pela própria venda, não pela posição); 01/11 (v245: vendas — testemunhas: o par padrão segue o tipo do vendedor ou diz "definido no envio"; venda-dossie v44); 01/11 (v244: vendas — Andamento: um envio por célula (o último vale), volta ao último confirmado e avisa ao sair com envio pendente); 01/11 (v243: vendas — Andamento do condomínio salva em segundo plano: a célula muda na hora, sem redesenhar o cartão; erro volta só a célula e avisa "Não salvou: motivo"); 01/11 (v242: vendas — mensagens dizem o que fazer: faltas de data agrupadas, "não anexado" na conferência, termo desatualizado, testemunhas com o padrão, quem muda o valor da casa vem do servidor; nome com número e e-mail repetido aparecem no pré-contrato; venda-dossie v43, assinatura-ui v15); 01/11 (v241: vendas — pré-reserva: conta para devolução opcional, em branco no termo; venda-dossie v42); 01/11 (v240: vendas — pré-reserva barra data futura e valor acima do sinal, dia de pagamento de 5 a 31; venda-dossie v41); 01/11 (v239: vendas — erros do "Conferi, gerar contrato" viram mensagem com o que fazer; contrato com envelope na Clicksign não é trocado; venda-dossie v40); 01/11 (v238: vendas — bloco Fiadores: depois de salvar a tela mostra o que o servidor gravou e só vai o campo mexido; a pergunta do botão diz o nome do Fiador 2 que sai; venda-dossie v39); 01/11 (v237: vendas — Descartar rascunho que só atualizou a situação avisa "Nada foi descartado" e o histórico do contrato deixa de dizer que cancelou; assinatura-ui v14, venda-dossie v38); 01/11 (v236: vendas — bloco Fiadores na aba Contrato do condomínio: fiadores e cônjuge do comprador corrigidos no próprio cartão, botão "O cônjuge do Fiador 1 é o Fiador 2"; venda-dossie v37); 01/11 (v235: cota — telas só consultam com a aba aberta e com menos frequência); 01/11 (v234: vendas — conserto: as abas do cartão do condomínio voltam a mostrar o conteúdo, a regra tinha perdido o {display:block} no #50); 31/10 (v233: vendas — antecipação de parcelas: o botão Gerar PDF virou Copiar mensagem (só o texto do WhatsApp, sem PDF nem Notion); venda-dossie v36); 31/10 (v232: vendas — aba Financeiro: "Atualizado hoje às", filtros com contagem e Em atraso em vermelho, blocos por Tipo no lugar do Mostrar as N, próxima parcela em destaque, celular com Situação e Valor Corrigido na 1ª linha; venda-dossie v35); 31/10 (v231: vendas — aba Financeiro com as colunas Situação | Parcela | Tipo | Vencimento | Valor Original | Valor Corrigido, FGTS e Financiamento "Única", data do Mais Controle em dd/mm/aaaa; venda-dossie v34); 31/10 (v230: vendas — botão Antecipar parcelas na aba Financeiro do cartão do condomínio: simula os cinco jeitos no navegador (venda/Antecipacao.js v1) e gera o PDF para o cliente; venda-dossie v33); 31/10 (v229: vendas — Alterar fluxo: 1ª pós-chaves sempre da proposta ou do mês seguinte à entrega (24/36/48 em qualquer ordem dá o mesmo fluxo); editor do fluxo cabe no computador; FluxoLivre v6, venda-dossie v32); 31/10 (v228: vendas — pré-reserva valor/data/Salvar numa linha; conferência cabe no computador; fluxo numa linha com Ver fluxo; Andamento alinhado; quadro do link só com falta obrigatória; venda-dossie v31); 31/10 (v227: vendas — Alterar fluxo: prazo da entrada 24x/36x/48x pela conta do simulador, botão Distribuir, pós-chaves 0/12/24 e placar com prazo e comissão; refaz o PR #30 sobre a main; FluxoLivre v5, venda-dossie v30); 31/10 (v226: vendas — aba Contrato sem o aviso "Quando todos assinarem…", decisão do dono); 31/10 (v225: vendas — pré-reserva só "Termo gerado" sem o nome do arquivo; conferência só "Ainda não conferido."; venda-dossie v29); 31/10 (v224: vendas — Contrato do condomínio simplificado: só "Contrato gerado" sem o nome do arquivo e sem a conta fixa na tela; venda-dossie v28); 31/10 (v223: vendas — cartão do condomínio no celular: abas 3x2, conferência e parcelas em blocos empilhados; venda-dossie v27); 31/10 (v222: vendas — estado civil do Corrigir aqui abre lista; venda-dossie v26); 31/10 (v221: vendas — aba Financeiro no cartão do condomínio: parcelas do Mais Controle, pagas/a vencer/em atraso, lidas só quando a aba abre; venda-dossie v25); 31/10 (v220: vendas — aviso na aba Contrato do que acontece quando todos assinam: PDF assinado guardado e Andamento marcado pelo vigia do PORTAL-VENDA); 31/10 (v219: vendas — Corrigir aqui na conferência dos documentos (grava na coluna da venda) e PDF do fluxo para o cliente na aba Contrato; venda-dossie v24); 31/10 (v218: vendas — cartão do condomínio em abas (Resumo, Pré-reserva, Documentos, Contrato, Andamento), datas e quadro do pro soluto na aba Contrato, Andamento agrupado por departamento, assinantes com o nome antes do papel; venda-dossie v23, assinatura-ui v13); 31/10 (v217: simulacoes — botão Transformar em proposta: abre a proposta do simulador já preenchida com a simulação); 31/10 (v216: vendas — e-mail inválido bloqueado na planilha, no cartão e no completar venda; CEP preenche o endereço no completar venda); 31/10 (v215: vendas — contrato gerado/enviado/assinado sobrepõe a pré-reserva na coluna ETAPA e no cartão); 31/10 (v214: propostas — contrato enviado → vendida aceita "Reserva do/dos Ipês" e mostra o resultado na tela; contrato-vendida v2); 31/10 (v213: propostas/vendas — contrato enviado/assinado marca também a PROPOSTA como VENDIDA; venda/contrato-vendida.js v1, varredura ao abrir Propostas e a Planilha Casas Condomínio); 31/10 (v212: vendas — contrato do condomínio enviado/assinado marca a unidade VENDIDA = SIM na base UNIDADES; venda-dossie v22); 31/10 (v211: vendas — quadro do pro soluto do cartão do condomínio segue o fluxo alterado no portal; quadro-fluxo.js v1, venda-dossie v21); 31/10 (v210: vendas — histórico do contrato no card, quem fez o quê; venda-dossie v20); 31/10 (v209: vendas — DATA DA VENDA do condomínio = data de assinatura do contrato); 30/10 (v208: vendas — envelope cancelado sem a lista de pendentes; assinatura-ui v12); 30/10 (v207: vendas — contrato 24x sem fiador, venda direta sem corretor, fiador casado com cônjuge, rubricas posicionadas, memorial e projeto no envelope; desconto e ↻ no Alterar fluxo); 30/10 (v206: entretenimento — endereço do jogo (Tailscale Funnel) no JOGO_URL); 30/10 (v205: propostas — fiador não é necessário com entrada em 24x, sem pós-chaves; termo de confissão sem fiador em 24x); 30/10 (v204: aba Entretenimento — entretenimento.html com o Morais Royale); 30/10 (v203: simulacoes — Propostas: rankings de corretores (em análise / vendidas) abaixo da tabela); 30/10 (v202: simulacoes — Propostas: cartão "Em análise · crédito" com aprovado / sem carta); 30/10 (v201: simulacoes — Propostas: filtro "Em análise" no lugar de "Recebidas" e cortes acima da tabela); 29/10 (v200: vendas — Alterar fluxo: o robô do Mais Controle lança o fluxo alterado; venda-dossie v17); 29/10 (v199: vendas — Alterar fluxo: pós-chaves com a quantidade e o teto da proposta, financiamento/FGTS só leitura, valor da casa só JC/JV, contrato sai com o fluxo alterado; venda-dossie v16, FluxoLivre v2); 29/10 (v198: vendas — botão Alterar fluxo no contrato do condomínio (lista livre, só salva com a conta fechando ao centavo, histórico); venda-dossie v15, venda/FluxoLivre.js v1); 29/10 (v197: vendas — condições especiais por venda no contrato do condomínio (item 16) com Redigir com IA; venda-dossie v14); 29/10 (v196: vendas — botão Cancelar envelope na assinatura do contrato e do termo de pré-reserva; venda-dossie v13, assinatura-ui v10); 28/10 (v195: vendas — CPF de fiador sem o zero da frente, assinou verde e pendente amarelo com ⏳, pergunta Sim/Não do termo de pré-reserva, sem textos técnicos entre parênteses; venda-dossie v12, assinatura-ui v9); 28/10 (v194: propostas — botão Termo de pré-reserva também nas propostas que já pagaram a preferência); 28/10 (v193: vendas — Planilha Casas Condomínio para Júlio César, Gestor de Vendas e acesso CONDOMÍNIO; Pagou preferência abre o termo de pré-reserva; termos de confissão de dívida no contrato do condomínio; conferência dos documentos pela IA; conta fixa visível); 28/10 (v192: análise de dados — Tempo × Custo com plano de aportes mês a mês até o último pico de gastos); 28/10 (v191: análise de dados — gráfico do VGV por casas de rua / condomínios com a lista de vendas no mês; meta de casas só das casas de rua); 28/10 (v190: análise de dados — VGV separado em casas de rua × condomínios, escritório e pós-obra a partir de mar/26, média móvel do saldo não operacional); 28/10 (v189: tabela por mês das vendas mostra os endereços ao passar o mouse — análise de dados, gestão de vendas e casas vendidas); 28/10 (v188: propostas — coluna Observações com histórico, igual às ligações); 28/10 (v187: conversa do correspondente sem os encaminhamentos internos); 28/10 (v186: aviso de e-mail novo confere também com a aba em segundo plano); 28/10 (v185: propostas — conversa do correspondente lê também a caixa de vendas); 28/10 (v184: propostas — "PREFERÊNCIA PAGA POR <cliente>" nas outras propostas da unidade); 28/10 (v183: propostas — selo do status interno só na proposta dona; nas outras "… para <cliente>"); 28/10 (v182: propostas — conversa com o correspondente numa caixa separada e aviso de e-mail novo); 28/10 (v181: propostas — colunas proposta · unidade · crédito · sinal · cliente · corretor · valor · entrada); 28/10 (v180: propostas — crédito/valores/sinal logo depois da unidade; sem carta mostra o envio ao correspondente com prazo de 24 h e alerta); 28/10 (v179: propostas — Vendida volta para a Decisão; status interno só Reservada, Pagou preferência e Distrato); 28/10 (v178: propostas — card "Sinal mínimo" e aviso de sinal fora da regra na lista); 28/10 (v177: propostas — status interno na proposta (pagou preferência cria a venda, vendida revalida, distrato), "Entrada restante"); 28/10 (v176: análise de dados — vendas do BANCO DE DADOS VENDAS CONDOMÍNIO no VGV e nas metas dos condomínios); 28/10 (v175: análise de dados — Obras num card só com casas de rua × condomínios, metas por condomínio em Configurações › 5, troca de gráfico sem travar); 28/10 (v174: vendas — contrato do condomínio novo, termo de pré-reserva, etapas no cartão, e-mail de cada signatário; venda-dossie.js v9, assinatura-ui.js v7); 28/10 (v173: auditoria — duplicidade por UC de energia/água; sem "competência distante" e "conta diferente da obra"); 27/10 (v172: análise de dados — Escritório e Pós-obra separados, divisórias nas tabelas, cor do custo total igual no gráfico, clique no mês fixa o resumo, botão Linha/Barras; v171: análise de dados — valores encolhem para caber nos cards; v170: análise de dados — valores com centavos; v169: análise de dados — Visão Geral nova com gráficos, casas de rua × condomínio, operacional e não operacional separados, resumo no Fluxo de Caixa, validação da divergência ERP × Notion; v168: texto das Configurações sobre aportes; v167: análise de dados — layout do portal com modo claro/escuro, resumo ao passar o mouse, operacional × não operacional, aportes/distribuições na exposição, situação das obras no Desempenho, Tempo × Custo e Rentabilidade); 26/10 (v166: pós obra — cliente editável pelo ✏️, grava no Pós Obra e em Vendas); 26/10 (v165: editor de blocos v13 — item novo espera o id do Notion antes de salvar texto/baixa/apagar; corrige "path.block_id should be a valid uuid, instead was tmp…"); 24/10 (v164: análise de dados — aba Configurações, aportes/distribuições fora de gasto e lucro, custo de venda, filtro condomínio/casa de rua); 23/10 (v163: auditoria — Evolução com gastos por mês, categorias e CCs que mais mudaram); 23/10 (v162: auditoria — Por Categoria e Reclassificações viram "Ver" dentro de Lançamentos; sem o selo de perfil); 23/10 (v161: orçado x realizado — itens zerados na média; v160: pós obra — ADM edita endereço e casa; v159: obras — busca pelo nome da obra no "Mesmo layout de" e a escolhida fica preenchida; v158: obras — "Mesmo layout de" no Modelo 3D do painel da obra); 22/10 (v157: obras/atividades — anexo do formulário sem endereço vira botão "abrir arquivo" e tenta de novo sozinho; v156: auditoria-financeira.html — Auditoria Financeira em Análises (FINANCEIRO/GFINANCEIRO); v155: orçado × realizado — no histórico, o modal do insumo mostra só as obras dos filtros; v154: orçado × realizado — histórico com condomínios fora/incluir/só, filtro de setor e nº de casas; pós obra — responsável novo com validação; v153: orçado x realizado — Histórico por Insumo; vendas — casas sem tipo sem as vendidas; v152: obras — Modelo 3D no painel da obra + visualizador-3d.html; v151: vendas — Júlio César com Casas Modelo e Casas Liberadas sem Tipo; v150: desempenho — fila de leitura com 4 em paralelo, fim do laço de recarga em Ligações; v149: propostas — idade no perfil dos compradores); 21/10 (v148: simulações — composição com ENTRADA RESTANTE; v147: automações (Prancha Humanizada, Conferência OC × NF) visíveis para todos; v146: ligações — legenda e avisos das abas fora da área que rola de lado; v145: ligações — conferência logo após o SIM/NÃO da etapa, OBS antigas viram histórico; observação com histórico em contas vencidas; conferência em casas vendidas; v144: simulações recebidas — quadro de observações volta a abrir (nome repetido com o da unidade); v143: ligações — conferência semanal (conferiu na semana, data roxa, observação com histórico, anexo) nas 4 abas do acompanhamento; v142: simulações — observações num quadro que abre ao clicar, colunas ajustadas; v141: simulações — contato/data/observações, print da CAIXA e fiadores nas pendências, diluição 100%, "Valor para o sinal"; v140: pós obra — alerta de validação no padrão dos alertas, com nova tentativa e cópia local; v139: simulações — diluição dos balões com prévia ao vivo antes de validar; v138: atividades — excluir comentário pelo portal (🗑); mural — comentários no fim do card; v137: fluxo de pagamento limpo, sem textos de explicação; "Valor para a entrada (cliente)"; v136: sinal abatido vale R$ 0,00 no fluxo; v135: fluxo de pagamento soma só o que o cliente ainda paga, sinal pago só como destinação, à vista ou antecipado; v134: simulações/propostas — composição do fluxo de pagamento e fluxo sinal · pré-chaves · pós-chaves num quadro só; v133: documentos — escritura do lote (assinada, ITBI, registro pago, registrada) juntas na planilha; v132: título do Pago pelo cliente com a situação do sinal; v131: texto do "Pago pelo cliente" nas três situações; v130: quadro da entrada — Fluxo 1 só o sinal pago (verde), restante do sinal no saldo devedor, conta passo a passo; v129: simulações/propostas — quadro da entrada novo: entrada total, Fluxo 1 sinal, Fluxo 2 saldo devedor; v128: ligações — número da aba contas vencidas = só vencidas; contas geral sem número; v127: ligações — STATUS ENERGIA/ÁGUA editável na aba casas vendidas; v126: ligações — casas vendidas com STATUS da ligação no lugar de ÁGUA/ENERGIA TRANSFERIDA; v125: ligações — controle de contas geral = planilha inteira; v124: vendas — TELEFONE CORRETOR; v123: conteúdo da atividade na janela de outras abas — conteudo-atv.js; v122: atividade de outra aba abre direto, com nova tentativa; v121: obras — resposta e foto/vídeo nos formulários; v120: editor de blocos — ✎ não fica mais em cima do ↓; v119: faixa própria p/ atividades de outras abas): tema-escuro.js, Atividades (outras abas editáveis), obras (endereço alterado) */ //  // limpeza só dos caches do portal (não apaga os das RAS)
const ARQUIVOS = ["./","./index.html","./login.html","./vendas.html","./ligacoes.html",
                  "./pos-obra.html","./casas-vendidas.html","./servicos.html",
                  "./analise.html","./analise-dados.html","./auditoria-financeira.html","./obras.html","./documentos.html","./demandas.html","./simulacoes.html",
                  "./atividades.html","./processos.html","./arquivos.html","./entretenimento.html",
                  "./app.js","./alertas-docs.js","./fogos.js","./editor-blocos.js","./atv-alertas.js","./rf-rotas.js","./tema-escuro.js","./conteudo-atv.js","./manifest.json"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ARQUIVOS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("portal-morais-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const req=e.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;          // Apps Script, fontes: passa direto
  if(url.pathname.includes("/dist/")) return;            // dado vivo: sempre da rede
  // resto: rede primeiro, cache como rede de segurança
  e.respondWith(
    fetch(req).then(r=>{ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(req,cp)); return r; })
              .catch(()=>caches.match(req, {ignoreSearch:true}).then(r=>r||caches.match("./index.html")))
  );
});
