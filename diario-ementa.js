/* ===== EMENTA DO CURSO REVIT — Diário do Curso (diario-curso.html) =====
 * 23/11/2026 — transcrita dos prints do curso (PDF "ARQUITETURA PRIMEIRA PARTE").
 * Ordem = a ordem em que o Morais quer que os estagiários façam.
 *
 * COMO MEXER:
 *  - Módulo novo: acrescente no FIM da parte, com um id novo (ex.: "A2-09").
 *  - Aula nova: acrescente no FIM da lista do módulo.
 *  - NUNCA troque a ordem nem apague aula do meio: o check de cada aula é
 *    gravado pelo id "<módulo>-<nº da aula>" (ex.: "A1-03-07"). Mudar a
 *    posição faz o check ir parar em outra aula. Corrigir o TEXTO pode.
 *  - Parte nova (ex.: Elétrico 2ª parte): bloco novo com id próprio ("E2").
 *  - "opcional" = módulo que o ADM pode tirar da ementa de um estagiário
 *    (todo módulo pode ser tirado; a marca é só para lembrar).
 * ======================================================================= */
window.DIARIO_EMENTA = [
 { id:"A1", nome:"Arquitetura · 1ª parte", modulos:[
  { id:"A1-01", nome:"DESAFIO REVIT - DO BÁSICO AO INTERMEDIÁRIO (BÔNUS)", opcional:true, aulas:[
    "Download dos arquivos usados no Desafio Revit",
    "Dia 1: Entendendo o template que usaremos no curso (resumo da live inaugural)",
    "Dia 2: Importação arquivo DWG | Criação de eixos | Modelagem básica de paredes e muros",
    "Dia 3: Inserção de esquadrias e peças hidrossanitárias",
    "Dia 4: Criação de pisos e lajes",
    "Dia 5: Criação de níveis | Modelagem básica de telhados | Inserção de pilares de madeira",
    "Dia 6: Planta humanizada | Carregando novas famílias | Imagem em alta resolução",
    "Dia 7 (Revit 2019/2023): Modelagem básica de terreno, calçada e rua",
    "Dia 7 (Revit 2025/2027): Modelagem básica de terreno, calçada e rua",
    "Dia 8 (Revit 2019/2023): Criação de piso externo e modelagem das plataformas de construção",
    "Dia 8 (Revit 2025/2027): Criação de piso externo e modelagem das plataformas de construção",
    "Dia 9 (Revit 2019/2023): Criação de rampas e modelagem básica do deck",
    "Dia 9 (Extra): Topografia Revit 2026 - Rampas",
    "Dia 10 (Revit 2019/2023): Modelagem básica da piscina",
    "Dia 11: Modelagem de vigas e pilares",
    "Dia 12: Criação de forro de gesso / União de paredes e estrutura",
    "Dia 13: Modelamento semiautomático do telhado da varanda a partir de vidraça inclinada",
    "Dia 14: Modelamento semiautomático da construção principal",
    "Dia 15: Personalização da planta baixa",
    "Dia 16: Documentação da planta baixa - nome dos ambientes, áreas e cotas",
    "Dia 17: Documentação de cortes - cotas, níveis e chamadas de detalhes",
    "Dia 18: Documentação de fachadas - espessura de linhas e profundidade gráfica",
    "Dia 19: Criação e documentação da planta de cobertura",
    "Dia 20: Criação e documentação da planta de implantação + tabela de áreas",
    "Dia 21: Estudo solar | Norte verdadeiro | Localização geográfica",
    "Dia 22: Criação de detalhes e ampliação de áreas molhadas/molháveis",
    "Dia 23: Montagem de pranchas do projeto executivo e detalhamento"
  ]},
  { id:"A1-02", nome:"ESTUDO PRELIMINAR - JORNADA REVIT", aulas:[
    "Download dos arquivos usados no Estudo Preliminar - Jornada Revit",
    "Live de abertura - Jornada Revit do zero ao render",
    "Jornada Revit #1 (2019/2023): Importação DWG, topografia e área gourmet",
    "Jornada Revit #1 (2025/2027): Importação DWG, topografia e área gourmet",
    "Jornada Revit #2: Pav. térreo e pav. superior",
    "Jornada Revit #3 (2019/2023): Plataformas topográficas, escadas e guarda-corpos",
    "Jornada Revit #3.1 (2025/2027): Topografia da área gourmet - Escavação",
    "Jornada Revit #3.2 (2025/2027): Topografia do pav. térreo - Aterro + tabela feita com IA",
    "Jornada Revit #3.3 (2025/2027): Cálculo do transporte de terra (com apostila)",
    "Jornada Revit #4: Telhados e inserção de famílias/componentes",
    "Jornada Revit #5: Materiais e renderização",
    "Jornada Revit #6: Tabelas e informações de projeto",
    "Jornada Revit #7: Montagem de pranchas + encerramento"
  ]},
  { id:"A1-03", nome:"MÓDULOS ESSENCIAIS - MODELAGEM NO LOCAL", aulas:[
    "Aula 01: Inserir componente x Modelar no local",
    "Aula 02: Categoria da família",
    "Aula 03: Extrusão - Planta",
    "Aula 04: Extrusão - Corte",
    "Aula 05: Mesclar",
    "Aula 06: Revolver",
    "Aula 07: Varredura",
    "Aula 08: Mescla com varredura",
    "Aula 09: Formas de vazio",
    "Aula 10: Material x Parâmetro de material"
  ]},
  { id:"A1-04", nome:"MÓDULOS ESSENCIAIS - MATERIAIS", aulas:[
    "Aula 01: Navegador de materiais",
    "Aula 02: Aba Identidade",
    "Aula 03: Aba Gráficos",
    "Aula 04: Aba Aparência",
    "Aula 05: Baixando texturas"
  ]},
  { id:"A1-05", nome:"MÓDULOS ESSENCIAIS - FUNCIONAMENTO DO TEMPLATE", aulas:[
    "Aula 01: Instalação do template",
    "Aula 02: Parâmetros compartilhados",
    "Aula 03: Organização das vistas",
    "Aula 04: Tabelas e folhas",
    "Aula 05: Criação e configuração de vistas",
    "Aula 06: Filtros de visibilidade"
  ]},
  { id:"A1-06", nome:"MÓDULOS ESSENCIAIS - PERSONALIZAÇÃO DO TEMPLATE", aulas:[
    "Aula 01: Prancha e carimbo",
    "Aula 02: Identificadores de portas e janelas",
    "Aula 03: Identificador de ambientes",
    "Aula 04: Configuração de cotas",
    "Aula 05: Simbologia de cortes e elevações"
  ]},
  { id:"A1-07", nome:"ANTEPROJETO/PREFEITURA - MÓDULO 1: ANTEPROJETO - AJUSTES PARTE I", aulas:[
    "Download dos arquivos usados no Anteprojeto/Prefeitura",
    "Aula 1.1: Anteprojeto de arquitetura - Conceitos",
    "Aula 1.2: Ajuste dos muros laterais",
    "Aula 1.3: Criação de shaft e ajuste da bancada",
    "Aula 1.4: Guarda-corpo de vidro - Externo",
    "Aula 1.5: Guarda-corpo de vidro - Interno",
    "Aula 1.6: Inserção de forros",
    "Aula 1.7: Inserção de ralos"
  ]},
  { id:"A1-08", nome:"ANTEPROJETO/PREFEITURA - MÓDULO 2: ANTEPROJETO - AJUSTES PARTE II", aulas:[
    "Aula 2.1: Ajustes do telhado",
    "Aula 2.2: Criação das platibandas e calhas",
    "Aula 2.3: Criação das platibandas e calhas - Parte II",
    "Aula 2.4: Criação do novo pergolado",
    "Aula 2.5: Ajustes finais do anteprojeto"
  ]},
  { id:"A1-09", nome:"ANTEPROJETO/PREFEITURA - MÓDULO 3: ANTEPROJETO - DOCUMENTAÇÃO", aulas:[
    "Aula 3.1: Documentação - Ajustes iniciais",
    "Aula 3.2: Documentação - Plantas I",
    "Aula 3.3: Documentação - Plantas II",
    "Aula 3.4: Documentação - Cortes",
    "Aula 3.5: Documentação - Elevações",
    "Aula 3.6: Documentação - Implantação e situação",
    "Aula 3.7: Documentação - Ajustes finais e impressão"
  ]},
  { id:"A1-10", nome:"ANTEPROJETO/PREFEITURA - MÓDULO 4 - PROJETO DE PREFEITURA - ÍNDICES URBANÍSTICOS", aulas:[
    "Aula 4.1: Informações gerais",
    "Aula 4.2: Taxa de permeabilidade",
    "Aula 4.3: Taxa de ocupação",
    "Aula 4.4: Coeficiente de aproveitamento",
    "Aula 4.5: Iluminação / Ventilação"
  ]},
  { id:"A1-11", nome:"ANTEPROJETO/PREFEITURA - MÓDULO 5: PROJETO DE PREFEITURA - PROJETO COMPLETO", aulas:[
    "Aula 5.1: Projeto completo - Plantas I",
    "Aula 5.2: Projeto completo - Plantas II",
    "Aula 5.3: Projeto completo - Cortes, detalhe e elevação",
    "Aula 5.4: Projeto completo - Implantação e situação",
    "Aula 5.5: Projeto completo - Ajustes finais e impressão"
  ]},
  { id:"A1-12", nome:"ANTEPROJETO/PREFEITURA - MÓDULO 6 - PROJETO DE PREFEITURA - PROJETO SIMPLIFICADO", aulas:[
    "Aula 6.1: Projeto simplificado - Plantas",
    "Aula 6.2: Projeto simplificado - Corte",
    "Aula 6.3: Projeto simplificado - Ajustes finais e impressão",
    "Aula 6.4: Projeto simplificado - Exportando para AutoCAD"
  ]}
 ]},
 { id:"H1", nome:"Hidrossanitário · 1ª parte", modulos:[
  { id:"H1-01", nome:"MÓDULO 2 - INICIANDO O PROJETO NO REVIT", aulas:[
    "Aula 2.1: Instalando o template básico",
    "Aula 2.2: Inserindo link Revit",
    "Aula 2.3: Monitorando itens do arquivo link",
    "Aula 2.4: Inserindo componentes no projeto"
  ]},
  { id:"H1-02", nome:"MÓDULO 3 - SISTEMA DE ÁGUA FRIA", aulas:[
    "Aula 3.1: Criação das plantas de água fria",
    "Importante assistir - Erros Dynamo",
    "Aula 3.2: Alimentação da caixa d'água",
    "Aula 3.3: Extravasor e limpeza da caixa d'água",
    "Aula 3.4: Alimentação direta - Água da rua",
    "Aula 3.5: Sistema de água fria - Pavimento superior I",
    "Aula 3.6: Sistema de água fria - Pavimento superior II",
    "Aula 3.7: Sistema de água fria - Pavimento térreo I",
    "Aula 3.8: Sistema de água fria - Pavimento térreo II",
    "Aula 3.9: Sistema de água fria - Pavimento térreo III"
  ]},
  { id:"H1-03", nome:"MÓDULO 5 - SISTEMA DE ESGOTO E VENTILAÇÃO", aulas:[
    "Aula 5.1: Criação das plantas de esgoto",
    "Aula 5.2: Sistema de esgoto - Pavimento superior I",
    "Aula 5.3: Sistema de esgoto - Pavimento superior II",
    "Aula 5.4: Sistema de esgoto - Pavimento térreo I",
    "Aula 5.5: Sistema de esgoto - Pavimento térreo II",
    "Aula 5.6: Sistema de esgoto - Pavimento térreo III",
    "Aula 5.7: Sistema de ventilação"
  ]},
  { id:"H1-04", nome:"MÓDULO 6 - SISTEMA DE ÁGUAS PLUVIAIS", aulas:[
    "Aula 6.1: Criação do sistema de água pluvial",
    "Aula 6.2: Criação das plantas de água pluvial",
    "Aula 6.3: Sistema de água pluvial I",
    "Aula 6.4: Sistema de água pluvial II",
    "Aula 6.5: Sistema de água pluvial III",
    "Aula 6.6: Criação de caixa de areia",
    "Aula 6.7: Inserção de caixas de areia"
  ]},
  { id:"H1-05", nome:"MÓDULO 8 - DOCUMENTAÇÃO", aulas:[
    "Aula 8.1: Ajuste de folhas",
    "Aula 8.2: Ajuste de vista - Planta baixa",
    "Aula 8.3: Ajuste de vista - Elevações",
    "Aula 8.4: Ajuste de vista - Isometria",
    "Aula 8.5: Criação de parâmetros compartilhados",
    "Aula 8.6: Tabelas I",
    "Aula 8.7: Tabelas II",
    "Aula 8.8: Folha de esgoto",
    "Aula 8.9: Identificadores e cotas",
    "Aula 8.10: Representação em coordenação"
  ]}
 ]},
 { id:"E1", nome:"Elétrico · 1ª parte", modulos:[
  { id:"E1-01", nome:"MÓDULO 2 - INICIANDO O PROJETO NO REVIT", aulas:[
    "Aula 2.1: Inserindo links no projeto e ajustando as coordenadas",
    "Aula 2.2: Copiando e monitorando níveis do arquivo linkado",
    "Aula 2.3: Inserindo e ajustando espaços",
    "Aula extra: Por que não copiamos e monitoramos os componentes da arquitetura?"
  ]},
  { id:"E1-02", nome:"MÓDULO 3 - PROJETO ELÉTRICO (PONTOS DE TOMADAS)", aulas:[
    "Aula 3.1: Estudando as tabelas de cálculos",
    "Aula 3.2: Inserindo medidor, quadro parcial de luz e força e quadro VDI",
    "Aula 3.3: Ajustando o parâmetro global - Escala da simbologia",
    "Aula 3.4: Inserindo tomadas - Pavimento superior - Parte I",
    "Aula 3.5: Inserindo tomadas - Pavimento superior - Parte II",
    "Aula 3.6: Inserindo tomadas - Pavimento térreo - Parte I",
    "Aula 3.7: Inserindo tomadas - Pavimento térreo - Parte II",
    "Aula 3.8: Inserindo interruptores",
    "Aula 3.9: Inserindo pontos VDI"
  ]},
  { id:"E1-03", nome:"MÓDULO 4 - PROJETO ELÉTRICO (PONTOS DE LUZ)", aulas:[
    "Aula 4.1: Inserindo pontos de luz - Pavimento superior - Parte I",
    "Aula 4.2: Inserindo pontos de luz - Pavimento superior - Parte II",
    "Aula 4.3: Inserindo pontos de luz - Pavimento superior - Parte III",
    "Aula 4.4: Inserindo pontos de luz - Pavimento térreo - Parte I",
    "Aula 4.5: Inserindo pontos de luz - Pavimento térreo - Parte II"
  ]},
  { id:"E1-04", nome:"MÓDULO 5 - PROJETO ELÉTRICO (CIRCUITOS DE TOMADAS)", aulas:[
    "Aula 5.1: Entendendo as propriedades das tomadas e circuitos",
    "Aula 5.2: Criando os circuitos de tomada - Pavimento superior",
    "Aula 5.3: Criando os circuitos de tomada - Pavimento térreo",
    "Aula 5.4: Criando os circuitos VDI",
    "Aula 5.5: Criando os circuitos reserva"
  ]},
  { id:"E1-05", nome:"MÓDULO 6 - PROJETO ELÉTRICO (CIRCUITOS DE ILUMINAÇÃO)", aulas:[
    "Aula 6.1: Entendendo as propriedades dos interruptores e circuitos",
    "Aula 6.2: Criando os circuitos de iluminação - Pavimento superior - Parte I",
    "Aula 6.3: Criando os circuitos de iluminação - Pavimento superior - Parte II",
    "Aula 6.4: Criando os circuitos de iluminação - Pavimento superior - Parte III",
    "Aula 6.5: Criando os circuitos de iluminação - Pavimento térreo - Parte I",
    "Aula 6.6: Criando os circuitos de iluminação - Pavimento térreo - Parte II"
  ]},
  { id:"E1-06", nome:"MÓDULO 7 - PROJETO ELÉTRICO (CONDUÍTES I)", aulas:[
    "Aula 7.1: Entendendo as propriedades das caixas de luz e conduítes",
    "Aula 7.2: Criando conduítes - Pavimento superior - Parte I",
    "Aula 7.3: Criando conduítes - Pavimento superior - Parte II",
    "Aula 7.4: Criando conduítes - Pavimento superior - Parte III",
    "Aula 7.5: Criando conduítes - Pavimento superior - VDI"
  ]},
  { id:"E1-07", nome:"MÓDULO 8 - PROJETO ELÉTRICO (CONDUÍTES II)", aulas:[
    "Aula 8.1: Criando conduítes - Pavimento térreo - Parte I",
    "Aula 8.2: Criando conduítes - Pavimento térreo - Parte II",
    "Aula 8.3: Criando conduítes - Pavimento térreo - Parte III",
    "Aula 8.4: Criando conduítes - Pavimento térreo - Parte IV",
    "Aula 8.5: Criando conduítes - Pavimento térreo - VDI"
  ]},
  { id:"E1-08", nome:"MÓDULO 9 - TABELAS DE QUADROS E DIAGRAMAS", aulas:[
    "Aula 9.1: Ajustes de circuitos",
    "Aula 9.2: Tabelas de painéis",
    "Aula 9.3: Tabela de medidor",
    "Aula 9.4: Diagrama unifilar - Parte I",
    "Aula 9.5: Diagrama unifilar - Parte II"
  ]},
  { id:"E1-09", nome:"MÓDULO 10 - TABELAS", aulas:[
    "Aula 10.1: Tabelas de cálculos",
    "Aula 10.2: Tabelas de informações",
    "Aula 10.3: Tabelas de quantitativo de cabos",
    "Aula 10.4: Tabelas de quantitativo de conduítes",
    "Aula 10.5: Tabela de quantitativo de disjuntores",
    "Aula 10.6: Tabelas de quantitativo de peças"
  ]},
  { id:"E1-10", nome:"MÓDULO 11 - DOCUMENTAÇÃO", aulas:[
    "Aula 11.1: Setorização de projeto",
    "Aula 11.2: Anotação - Ajuste de escala",
    "Aula 11.3: Anotação - Identificador de luminária",
    "Aula 11.4: Anotação - Identificador de fiação - Parte I",
    "Aula 11.5: Anotação - Identificador de fiação - Parte II",
    "Aula 11.6: Anotação - Identificador de conduíte",
    "Aula 11.7: Anotação - Legendas",
    "Aula 11.8: Montagem de folha e impressão"
  ]}
 ]},
 { id:"A2", nome:"Arquitetura · 2ª parte", modulos:[
  { id:"A2-01", nome:"EXECUTIVO - MÓDULO 1: INTRODUÇÃO AO PROJETO EXECUTIVO", aulas:[
    "Download dos arquivos usados na fase Executivo de Arquitetura & Interiores",
    "Aula 1.1: Introdução ao curso",
    "Aula 1.2: Executivo e detalhamento",
    "Aula 1.3: Quantitativo",
    "Aula 1.4: Projetos complementares"
  ]},
  { id:"A2-02", nome:"EXECUTIVO - MÓDULO 2: ESTRUTURA", aulas:[
    "Aula 2.1: Apresentação do projeto estrutural",
    "Aula 2.2: Vinculando a estrutura no projeto arquitetônico",
    "Aula 2.3: Ajustes arquitetura x estrutura",
    "Aula 2.4: Quantitativo de estrutura",
    "Aula extra: Configurações de exibição da estrutura"
  ]},
  { id:"A2-03", nome:"EXECUTIVO - MÓDULO 3: AJUSTE DE PAREDES", aulas:[
    "Aula 3.1: Paredes e suas configurações",
    "Aula 3.2: Trocando o núcleo das paredes",
    "Aula 3.3: Ajustando paredes - Área gourmet",
    "Aula 3.4: Ajustando paredes - Pavimento térreo",
    "Aula 3.5: Ajustando paredes - Pavimento superior",
    "Aula 3.6: Ajustando paredes - Laje cobertura",
    "Aula 3.7: Paredes especiais - Paginação",
    "Aula 3.8: Quantitativo de parede",
    "Aula extra: Configurações de exibição de paredes"
  ]},
  { id:"A2-04", nome:"EXECUTIVO - MÓDULO 4: AJUSTE DE PISOS", aulas:[
    "Aula 4.1: Pisos e suas configurações",
    "Aula 4.2: Ajustando pisos - Área gourmet",
    "Aula 4.3: Ajustando pisos - Área gourmet - Rodapé",
    "Aula 4.4: Ajustando pisos - Pavimento térreo",
    "Aula 4.5: Ajustando pisos - Pavimento superior",
    "Aula 4.6: Quantitativo de pisos",
    "Aula extra: Hierarquia de visibilidade"
  ]},
  { id:"A2-05", nome:"EXECUTIVO - MÓDULO 5: AJUSTE DE BANCADAS, NICHOS, SOLEIRAS E PEITORIS", aulas:[
    "Aula 5.1: Ajustando as bancadas",
    "Aula 5.2: Ajustando as bancadas - Pavimento térreo e superior",
    "Aula 5.3: Inserindo os nichos",
    "Aula 5.4: Inserindo soleiras",
    "Aula 5.5: Inserindo peitoris",
    "Aula 5.6: Quantitativo de pedras",
    "Aula extra: Definição de parâmetros"
  ]},
  { id:"A2-06", nome:"EXECUTIVO - MÓDULO 6: AJUSTE DE FORROS", aulas:[
    "Aula 6.1: Forros e suas configurações",
    "Aula 6.2: Ajustando forros - Área gourmet",
    "Aula 6.3: Ajustando forros - Pavimento térreo",
    "Aula 6.4: Ajustando forros - Pavimento térreo - Parte II",
    "Aula 6.5: Ajustando forros - Pavimento superior",
    "Aula 6.6: Quantitativo de forros"
  ]},
  { id:"A2-07", nome:"EXECUTIVO - MÓDULO 7: AJUSTE DE ESCADAS, GUARDA-CORPOS E CALÇADA", aulas:[
    "Aula 7.1: Escadas e suas configurações",
    "Aula 7.2: Ajuste da escada corredor lateral",
    "Aula 7.3: Ajuste da escada interna",
    "Aula 7.4: Ajuste da escada frontal e guarda-corpos",
    "Aula 7.5: Ajuste da calçada"
  ]},
  { id:"A2-08", nome:"EXECUTIVO - MÓDULO 8: AJUSTE DE TELHADOS E PERGOLADOS", aulas:[
    "Aula 8.1: Ajustando pergolados - Hall e área gourmet",
    "Aula 8.2: Vidraça inclinada x Sistema de vigas",
    "Aula 8.3: Ajustando telhados - Escada e caixa d'água",
    "Aula 8.4: Ajustando telhados - Pavimento superior",
    "Aula 8.5: Ajustando telhados - Garagem",
    "Aula 8.6: Inserindo berços e pontaletes",
    "Aula 8.7: Inserindo rufos pingadeira",
    "Aula 8.8: Inserindo rufos externos",
    "Aula 8.9: Quantitativo de telhados e pergolados - Parte I",
    "Aula 8.10: Quantitativo de telhados e pergolados - Parte II",
    "Aula extra: Configuração do parâmetro de visibilidade"
  ]}
 ]},
 { id:"H2", nome:"Hidrossanitário · 2ª parte", modulos:[
  { id:"H2-01", nome:"MÓDULO 4 - SISTEMA DE ÁGUA QUENTE", aulas:[
    "Aula 4.1: Criação do sistema de água quente - Parte I",
    "Aula 4.2: Criação do sistema de água quente - Parte II",
    "Aula 4.3: Boiler e placas solares",
    "Aula 4.4: Sistema de água quente - Pavimento superior I",
    "Aula 4.5: Sistema de água quente - Pavimento superior II",
    "Aula 4.6: Sistema de água quente - Pavimento térreo I",
    "Aula 4.7: Sistema de água quente - Pavimento térreo II"
  ]},
  { id:"H2-02", nome:"MÓDULO 7 - PISCINA E AR-CONDICIONADO", aulas:[
    "Aula 7.1: Criando e inserindo componentes da piscina",
    "Aula 7.2: Tubulação de abastecimento",
    "Aula 7.3: Tubulação de sucção e limpeza",
    "Aula 7.4: Inserindo ar-condicionado splits nos dormitórios",
    "Aula 7.5: Tubulação de drenagem I",
    "Aula 7.6: Tubulação de drenagem II"
  ]},
  { id:"H2-03", nome:"MÓDULO ESPECIAL", aulas:[
    "Fossa, filtro e sumidouro",
    "Criando o template completo"
  ]}
 ]}
];

