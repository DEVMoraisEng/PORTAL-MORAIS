# GESTÃO DE DOCUMENTOS (OBRA) — como ligar

Setor novo do PORTAL-MORAIS, na mesma arquitetura das outras telas:
**GitHub Pages lê um JSON pronto** (rápido, abre offline) e **o Apps Script grava
no Notion** (é o único que conhece o token).

---

## 1. Arquivos

| Arquivo | O que é |
|---|---|
| `documentos.html` | a tela do setor (**novo**) |
| `demandas.html` | as demandas do mês, sem login, pelo link (**novo**) |
| `fetch_documentos.py` | publica `dist/docs.json` no build (**novo**) |
| `Code.gs` | **completo** (r36) |
| `alertas-docs.js` | regras de alerta, usadas pela tela e pelo painel inicial (**novo**) |
| `index.html` | ganhou o card "Gestão de Documentos" |
| `app.js` | ações novas na fila de ESCRITA |
| `sw.js` | cache v25 + as duas páginas novas |
| `.github/workflows/pages.yml` | step novo rodando o `fetch_documentos.py` |

O `dist/documentos.json` que já existe **não foi tocado**: ele é o resumo que
alimenta os contadores do painel inicial e a aba Estoque de Casas. O arquivo
novo é o `dist/docs.json`.

---

## 2. No Notion (uma vez)

1. Coluna **ACESSOS** do banco **LOGINS** → criar a opção **`DOCUMENTOS`**
   (maiúsculas, sem acento) e marcar quem é da equipe.
   Sem isso ninguém entra — só ADM, MASTER e TESTES, que passam sempre.
2. A base **ATIVIDADES CONTROLE DE DOCUMENTAÇÕES** precisa estar compartilhada
   com a integração (base → `...` → Conexões). A de DOCUMENTOS já está.

## 3. No Apps Script (nos DOIS projetos: LEITURA e ESCRITA)

O `Code.gs` vai **completo**: é só substituir o arquivo inteiro. Ele é a versão
r35 = o que você já tinha (r34) **mais** o setor novo.

1. **PORTAL-LEITURA**: cole o `Code.gs` como está (`var PAPEL = "LEITURA";`).
2. **PORTAL-ESCRITA**: cole o mesmo arquivo e troque **uma linha**, a de sempre:
   `var PAPEL = "ESCRITA";` (linha ~103).
3. **Implantar → Gerenciar implantações → lápis da implantação ATIVA → Nova
   versão → Implantar.** Salvar não basta. Nos dois projetos.

O que mudou no que já existia foram **duas linhas**, e elas estão comentadas no
próprio arquivo: a rota `docsDemandas` no `handle_` (ao lado da `agendaDia`,
porque é a única ação do setor que roda sem login) e o `default:` do
`executar_`, que agora pergunta ao `docsRotear_` antes de devolver
`ACAO_DESCONHECIDA`. O resto do setor é um bloco no fim do arquivo.

> **Confira uma coisa antes de colar:** eu remontei o r33/r34 a partir do
> Code.gs que você colou no chat, porque o do ZIP ainda estava no r32. Se o seu
> arquivo no ar tiver alguma alteração posterior a essa cópia, me avise que eu
> reaplico — o jeito rápido de conferir é procurar por `dispararColetaDiaria` e
> `forcarAtualizacao_` no seu arquivo atual: se estiverem lá e nada mais tiver
> mudado depois, pode colar sem medo.

## 4. Conferir (é a "automação das colunas" que você pediu)

No editor do Apps Script, selecione **`conferirDocumentos`** e Executar.
Ela **só lê**. A saída traz:

1. o nome EXATO de todas as colunas da base DOCUMENTOS, com o tipo;
2. quais são de marcação (têm SIM) — as que a baixa de atividade escreve;
3. os **TIPOs de atividade** que existem de verdade e em qual coluna cada um
   daria baixa hoje;
4. se todos os nomes que a tela procura foram encontrados.

**Me mande essa saída.** É com ela que eu fecho o de-para dos tipos de
atividade e corrijo qualquer nome de coluna que eu tenha escrito diferente do
seu Notion. Nada quebra enquanto isso: nome que não bate simplesmente não
mostra aquele alerta.

## 5. Publicar

Commit dos arquivos → o build roda sozinho. Se quiser na hora, use o botão
"Atualizar dados agora" (r33) ou rode o workflow pela aba Actions.

---

## O que a tela faz

**Página principal**
- os três setores (Departamento de Projetos, João Vítor, Júlio César);
- planilha geral com todas as colunas da base, menos as `-AUTO` e as de
  `ALERTA` (é exatamente o conjunto do seu print);
- filtros: setor, cidade, **situação** (em andamento / finalizadas / não
  iniciadas — as duas primeiras nunca se sobrepõem, como você pediu),
  **campo de data** (aquisição do lote, início, término, previsão, habite-se) e
  período (30 dias, ano, mês ou intervalo), além da busca;
- os **dois calendários**;
- os **indicadores**.

**Calendários** (na página principal e dentro de cada setor)
- *Início de obras*: pela `PREVISÃO DE INÍCIO DE OBRA`. Cada cartão traz
  ENDEREÇO – RESPONSÁVEL – MESTRE, **cor por responsável**, e a obra **some
  quando `OBRA INCIADA = SIM`**.
- *Habite-se*: pela `DATA HABITE-SE`, com ENDEREÇO – RESPONSÁVEL – TURNO.
- Botão **"Link das demandas do mês"** (só ADM): gera o link por pessoa, igual
  ao do pós obra, mas com o **mês inteiro** — início de obras e habite-se.
  Abre na `demandas.html`, sem login, e dá para trocar de mês no celular.
  Gerar de novo derruba o link anterior daquela pessoa na hora.

**Indicadores**
- tempo médio de obra, geral e **por setor** (média, mediana, mais rápida,
  mais lenta);
- **início de obras e lotes comprados**, mês a mês, em barras;
- **prazo de cada etapa que tem data de início e fim** na tabela: uso do solo,
  alvará, incorporação, RET, habite-se, lote → início, obra, certidões. De cada
  uma: quantas concluídas, prazo médio, mediana, quantas estão em aberto e há
  quantos dias está a mais antiga. Par novo é uma linha em `PARES_PRAZO`.

**Setores**
- *Departamento de Projetos*: atividades (responsável José Arthur ou felipe
  berçan), alertas, planilha **só com as colunas do segundo print** (o painel da
  obra também), calendários e os dois links de **Projetos para aprovação**.
- *João Vítor*: sem atividades. Alertas, planilha igual à principal e os dois
  calendários.
- *Júlio César*: atividades (responsável Júlio César), alertas, planilha e
  calendários.

**Alertas** — são **calculados na tela**, não lidos das fórmulas do Notion.
Cada um traz, na própria linha, o campo para preencher ali mesmo.

---

## Rodada de ajustes (10/09/2026, segunda leva)

**REMARCAÇÕES pode desligar o ANDAMENTO DA SOLICITAÇÃO.** Conferi o sistema
inteiro: nada mais depende dos valores `RETORNO N` / `REMARCADO N` dentro do
andamento — a tela já olha as duas colunas (REMARCAÇÕES e ANDAMENTO) e fica
com a maior. Pode apagar as opções de retorno do ANDAMENTO DA SOLICITAÇÃO com
segurança, contanto que o `preencherRemarcacoes()` já tenha rodado (e pela sua
captura de tela, rodou certo — o par bateu linha a linha).

**Link das demandas — data completa e sem a rota.** O cartão mostrava só o
número do dia; agora traz dia da semana + data completa (`quarta, 02/09/2026`).
O botão de Rota saiu.

**Fundo nas linhas do link das demandas.** Cada linha ganhou cartão próprio —
antes ficava sobre o fundo do modal e sumia num tema mais claro.

**Calendários: só engenheiros, e com visualização por semana.** O filtro e o
link das demandas já listavam só engenheiros desde a rodada anterior; agora o
**seletor do calendário** também — o mestre continua no cartão e na legenda,
só não entra como opção de filtro. E entrou o alternador **Mês / Semana** no
topo dos dois calendários: no modo semana, a grade mostra só os 7 dias da
semana corrente, e as setas `‹ ›` andam semana a semana em vez de mês a mês.

**RAS OBRAS**: o nome do acesso é `RAS OBRAS` — com espaço, sem acento extra,
maiúsculas — criado como opção da coluna ACESSOS no LOGINS. Já estava certo no
`index.html`; se algum usuário não vê o card, confira se a opção foi marcada
para ele lá.

### Pendente — depende da página de OBRAS

Você pediu que a `PREVISÃO DE INÍCIO DE OBRA` da base DOCUMENTOS seja
preenchida a partir da `Previsão de início` da base **OBRAS**. **Essa base
ainda não está configurada no sistema** — é a página de OBRAS que você disse
que ia me passar os detalhes depois, e o `Code.gs` não tem o id dela em
`CONFIG.DB`. Assim que você mandar o id do banco e o nome exato da coluna, eu
faço a sincronia — no mesmo padrão da que já existe entre VENDAS e PÓS OBRA
(grava só quando o valor de origem estiver preenchido e for diferente do que
já está lá, e roda tanto na hora — quando alguém edita pelo site — quanto numa
varredura diária, pra cobrir edição feita direto no Notion).

---

## Rodada de correções (10/09/2026)

**O link das demandas não funcionava — e o do pós obra também não.**
A chave do link é gravada numa Propriedade do script, e Propriedade é **por
projeto**. O `docAgendaLink` estava roteado para a implantação de **ESCRITA**,
enquanto a `demandas.html` (que abre sem login) lê pela de **LEITURA**. O link
nascia válido e a tela respondia "Este link não vale mais". Os dois — o novo e o
`agendaLink` do pós obra, que tinha o mesmo defeito desde o r32 — voltaram para
a leitura. **Depois de publicar, gere os links de novo**: os antigos ficaram na
Propriedade do projeto errado.

**Atividades do Júlio César não apareciam.** No Notion ele é "Júlio César Gomes
de Morais **Filho**" e a comparação era exata. Agora casa por pedaço do nome. A
lista também passou a respeitar `DATA INICIAL <= hoje`, igual à visão do Notion.

**Alertas a mais e a menos no João Vítor.** A causa era uma só: eu tratava
"SIM SEM PRAZO" como "SIM". A fórmula do Notion usa `== "SIM"` exato. Agora:
- `PREENCHER DATA DE INÍCIO DE OBRA` só conta `SIM` exato (some o excesso);
- `PREENCHER MESTRE OU PREVISÃO` ignora obra iniciada em **qualquer** variante
  de SIM, e a linha traz **os dois campos** (mestre e previsão) para preencher.

**Alertas de "PREENCHER: …" não se separam mais.** O agrupamento passou a ser
pela regra, não pelo texto: um grupo só, e o que falta em cada obra aparece na
linha. Vale para o Departamento de Projetos e para o Júlio César.

**Outros ajustes desta rodada**
- `PROPRIETÁRIO REAL` saiu do alerta do Departamento de Projetos (é cobrança do
  Júlio César, e só).
- Departamento de Projetos ficou **sem calendários**; **Júlio César** ganhou a
  aba **Projetos p/ aprovação**.
- Obra **sem endereço** aparece marcada em vermelho na planilha e no alerta —
  antes era um "(sem endereço)" discreto que ninguém achava.
- **Link das demandas do mês**: só os **engenheiros responsáveis** (coluna
  `ENG. EXECUÇÃO`). Os mestres continuam no filtro e na legenda do calendário.
- **De-para dos tipos fechado**: `PROJETO APROVADO` → `PROJETO APROVADO E
  ALVARA EMITIDO E ARMAZENADO?` e `SCPO E VISTORIA` → `EMITIU DOCUMENTOS DE
  VISTORIA E SCPO?`. "Uso Do Solo" e "Habite-se" saíram do mapa (não existem
  como atividade). Sobrou uma dúvida pequena: na sua fórmula, `AGENDOU
  HABITE-SE` é validado pelo rollup do SCPO — deixei na coluna `AGENDOU
  HABITE-SE?`, que parece o certo. Se a baixa marcar o campo errado, é uma
  linha para trocar.

### Painel inicial: pendências em todos os setores

Os quatro cards agora mostram número. O que cada um conta:

| Setor | Número |
|---|---|
| Gestão de Vendas | atividades em aberto (como já era) |
| Ligações | linhas com alerta de **atraso** (mesmo recorte da tela do setor) |
| Pós Obra | chamados em aberto |
| Gestão de Documentos | atividades em aberto **+** alertas |

Tudo lido do `dist/`, sem custar execução do Apps Script. Para o setor de
documentos as regras de alerta saíram para um arquivo próprio,
**`alertas-docs.js`**, usado pela tela e pelo painel — assim os dois números
nunca divergem. Esse arquivo é **novo e precisa ir no commit**.

### Pós Obra: coluna REMARCAÇÕES

O campo aparece **logo abaixo de ANDAMENTO DA SOLICITAÇÃO** no painel do
chamado. E, **antes de apagar os `RETORNO 1..5` do andamento**, rode no Apps
Script, nesta ordem:

1. `conferirRemarcacoes()` — só lê e imprime o que faria, com amostra e
   distribuição por nível;
2. `preencherRemarcacoes()` — grava (só onde está diferente; pode repetir);
3. aí sim apague os `RETORNO N` da coluna ANDAMENTO DA SOLICITAÇÃO.

O nível de cada chamado sai, nessa ordem: da **maior coluna de retorno com
conteúdo** (o fato registrado), e só se não houver nenhuma, do `RETORNO N` que
ainda estiver escrito no andamento — que é a informação prestes a sumir.

**Os blocos de retorno passaram a ser liberados pelo REMARCAÇÕES.** Isso não
era automático: quem abria o bloco vazio do RETORNO N era o ANDAMENTO DA
SOLICITAÇÃO, e sem esse ajuste, no dia em que você apagasse os `RETORNO 1..5`
de lá, nenhum bloco novo apareceria mais. Agora a tela olha **as duas colunas e
fica com a maior** — então funciona antes, durante e depois da migração:
enquanto o andamento ainda tiver os retornos antigos, os chamados de antes
continuam abrindo o bloco certo; depois que você apagar, quem manda é o
REMARCAÇÕES sozinho. Trocar o valor redesenha o painel na hora.

O que já tem conteúdo preenchido **nunca some**, independentemente das duas
colunas — essa regra é de antes (item 6 das melhorias de agosto) e continua
valendo.

---

## Respostas suas, já aplicadas (10/09/2026)

- **Responsável = `ENG. EXECUÇÃO`**, sem o "ou ENGENHEIRO RT" que eu tinha
  posto de reserva. O MESTRE continua num campo próprio, ao lado.
- **`PREENCHER DATA DE EMISSÃO DO RET`** confirmado: `RET ARMAZENADO = SIM`
  com a `DATA DE FINALIZAÇÃO DO RET` vazia.
- **CPF/CNPJ** segue fora do arquivo público.
- **Validação das atividades**: a fórmula que você mandou virou a regra. A tela
  e o build passaram a olhar o **sinal** dela (🟢 resolvida / 🔴 em aberto) em
  vez de uma coluna de nome fixo — se o nome da fórmula mudar no Notion, nada
  quebra. Em branco conta como **em aberto**, nunca o contrário.
- **De-para dos tipos fechado** a partir da mesma fórmula. Os 19 tipos estão em
  `BAIXA_MAP_DOCS` (no `Code.gs` e no `fetch_documentos.py` — os dois têm que
  ficar iguais). Quatro deles a fórmula não resolve sozinha, porque consultam
  um rollup de nome próprio que não bate com nenhuma coluna da obra de forma
  óbvia. Ficaram com o meu melhor palpite, marcados com `CONFERIR`, e a tela
  mostra a coluna alvo antes do clique:

  | TIPO | coluna que a baixa vai marcar | |
  |---|---|---|
  | `Uso Do Solo` | `USO DO SOLO SOLICITADO` | é a solicitação ou a emissão? |
  | `Habite-se` | `APROVOU HABITE-SE?` | aprovou, agendou ou armazenou? |
  | `PROJETO APROVADO` | `PROJETO FEITO?` | ou é a de aprovação do projeto? |
  | `SCPO E VISTORIA` | `PAGOU BOLETOS DE VISTORIA` | é essa a coluna? |

  Os outros 15 casaram direto: certidão do lote, alvará, aprovação de projeto,
  incorporação, incorp. finalizada, RET, armazenar/anexar RET, agendou e
  armazenar habite-se, ART de acréscimo, certidões finais, ISSQN, CND+CNO e
  contrato mestre.

## Decisões que eu tomei (confirme, por favor)

1. **A COTA: sim, dá para aposentar o `COTA PREENCHIDA?`.**
   O alerta do Júlio agora lê a `COTA DA EMPRESA (%)` como **número**, então
   **0% conta como preenchida** — que é o que a fórmula do Notion não conseguia
   distinguir de vazio. E o **`PROPRIETARIO REAL` entrou na conta**, como você
   pediu. A regra passou a ser: falta TÍTULO, COTA, DATA DE AQUISIÇÃO ou
   PROPRIETÁRIO REAL. Enquanto a coluna existir no Notion ela não atrapalha —
   a tela simplesmente não a usa.

3. **Responsável dos calendários**: `ENG. EXECUÇÃO` (confirmado). No link das
   demandas, a chave casa com o **responsável OU o mestre** — assim o mesmo
   mecanismo serve para o engenheiro e para o mestre de obra.

4. **Baixa de atividade**: o de-para agora é fixo (ver acima). Tipo que não
   estiver no mapa ainda cai no casamento automático por palavras do nome; se
   nem assim casar, aparece "sem coluna" e o botão fica desligado — nunca marca
   a coluna errada em silêncio. O `conferirDocumentos` agora imprime, por tipo,
   quantas atividades já estão resolvidas pela fórmula 🟢 — é o jeito rápido de
   validar as quatro linhas com `CONFERIR`.

5. **CPF/CNPJ não vai para o arquivo publicado.** O `dist/` é servido pelo
   GitHub Pages sem login — mesma regra que já vale para CLIENTES e CPF em
   Vendas. Na planilha aparece `•••`; ao **abrir a obra**, o valor real é
   buscado pelo Apps Script, que confere quem está logado. Se você decidir que
   esse CPF/CNPJ (quase sempre o da SPE) pode ser público, troque
   `PUBLICAR_CPF = True` no `fetch_documentos.py`.

6. **Edição**: pela linha do alerta e pelo painel da obra. A planilha grande é
   de leitura — clicar no endereço abre a obra. Se quiser editar direto na
   célula, como em Vendas, é a próxima rodada.

7. **Anexos**: o painel mostra quantos arquivos a coluna tem e deixa enviar um
   novo. Abrir o arquivo continua sendo pelo Notion (o link que ele devolve
   expira em cerca de uma hora e não pode ser publicado).

8. **`forcarAtualizacao`** (o botão "Atualizar dados agora") passou a limpar
   também o cache deste setor — sem isso ele limparia tudo menos a tela nova,
   que é justamente a mais provável de receber linha criada direto no Notion.

Quando você mandar o pedido da página de **OBRAS**, eu sigo daqui.
