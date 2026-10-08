# PORTAL-VENDA — como implantar

## Regras

- Vale sempre o último documento enviado: um valor lido não vazio substitui
  o valor atual do campo (não só preenche campo vazio). Trocar remove os
  arquivos anteriores do espaço antes de ler o novo.

## Teste (uma vez)

1. script.google.com → Novo projeto → nome **PORTAL-VENDA-TESTE**.
2. Crie quatro arquivos (botão + › Script) e cole o conteúdo de:
   `venda/RegrasVenda.js` → arquivo **RegrasVenda**; `venda/ClaudeLeitor.js` →
   **ClaudeLeitor**; `venda/OpenAILeitor.js` → **OpenAILeitor**;
   `venda/PortalVenda.gs` → **PortalVenda** (apague o `Código.gs` vazio).
3. Configurações do projeto › Propriedades do script:
   `NOTION_TOKEN` = token da conexão "Portal TESTE"; `SESSION_SECRET` = a MESMA
   frase do PORTAL-TESTE; `DB_VENDAS` = `f53c5ab532d38325aa4a0193011aad24`;
   `PROVEDOR_IA` = `openai`; `OPENAI_API_KEY` = a chave da OpenAI;
   `MODELO_IA` (opcional — vazio usa o padrão `gpt-6-luna`).
   Documentos de comprador vão para a OpenAI (decisão do dono em 28/09/2026).
4. Implantar › Nova implantação › App da Web › Executar como **Eu** › Quem pode
   acessar **Qualquer pessoa** › Implantar › autorizar (Avançado › Acessar).
5. Teste: abrir `<URL>/exec?action=ping` → `{"ok":true,"versao":"venda-v7","papel":"VENDA"}`.
6. Mande a URL `/exec` no chat (não é segredo).

Mudou o código? Implantar › Gerenciar implantações › lápis › Nova versão › Implantar.

O isolamento do teste depende de dois lados:

- **Segredos do fork:** só `NOTION_TOKEN` de teste nas propriedades do
  projeto; nenhum `SUPABASE_*`, `ERP_*`, `MC_*` (esses são do portal
  principal, não do PORTAL-VENDA-TESTE).
- **Propriedades do PORTAL-TESTE:** nenhum `GITHUB_TOKEN` de produção; se
  um dia houver um `GITHUB_TOKEN` ali, tem que ser só do fork
  (MoraisEng-Teste/PORTAL-MORAIS).

### Checklist do teste de ponta a ponta

Nesta ordem:

1. Enviar **dois** arquivos no mesmo espaço (frente e verso) e conferir no
   Notion que os dois ficaram. Se o 2º falhar com `UPLOAD_FALHOU`, **parar
   e avisar** — a API do Notion pode recusar um segundo `{type:"file"}` no
   mesmo upload.
2. Trocar de casa no meio de uma leitura (o painel não pode confundir a
   resposta com a casa nova).
3. Duplo clique em "Enviar e ler" (não pode disparar duas leituras).
4. Cancelar o seletor de arquivo (não pode travar o botão como "lendo…").
5. Foto tirada no celular (Android, Google Fotos) — o arquivo escolhido da
   nuvem não pode ser descartado pelo fallback de foco.

Depois, os itens do Step 4 da Task 7 do plano: tipo de casa, identidade,
comprovante, aprovação, ler de novo, devolver/conferir, JSON público sem
CPF/nome, log só com tokens.

## Produção (quando o dono disser "sobe")

Roteiro completo, por quem faz e por sistema: `PRODUCAO - 2026-10-07 venda checklist.md` (fora do repositório).

1. **Projeto PORTAL-VENDA de produção — já criado (07/10)** pelo clasp, com o código desta versão e o arquivo
   `ConfigProducao` (só existe lá). No editor: selecionar `configurarProducao` › Executar › autorizar. Ela preenche as
   Propriedades que não são segredo (bases, Clicksign de produção, repositório) e cria a pasta privada dos
   pré-contratos; o registro lista o que falta colar.
2. Segredos, colados à mão: `NOTION_TOKEN`, `SESSION_SECRET` e `GITHUB_TOKEN` **copiados do PORTAL-ESCRITA**
   (o `GITHUB_TOKEN` dele já é do PORTAL-MORAIS com Contents R/W); `OPENAI_API_KEY` do PORTAL-VENDA-TESTE (o portal
   real não tem); `CLICKSIGN_TOKEN` de produção. Modelos (`MODELO_*_ID`): os mesmos Google Docs do teste.
   Colar o `GITHUB_TOKEN` por último: é ele que liga o botão do Mais Controle.
3. Desenvolvedor: bases e colunas do Notion (checklist, seção 5) e o bloco do distrato no Code.gs do
   PORTAL-ESCRITA (entrega 8). A prévia/estado do distrato saem pela ESCRITA (`app.js`).
4. GitHub de produção: variável `MC_VENDA_APLICAR` **vazia** no começo (o botão só faz a prévia); segredo
   `MC_ROBO_APARELHO` se o login do robô pedir código. Os workflows aceitam `MC_ROBO_USUARIO` como e-mail do robô.
   Apagar `MC_INDICES` no fork de teste antes de ligar na produção.
5. Versão do site: branch `producao/venda` (sem `teste/`, `URL_PORTAL_VENDA` de produção, cache novo do `sw.js`),
   revisada pelo desenvolvedor antes de entrar na `main`. Conferir numa casa: Ctrl+F5 se o bloco não aparecer.

**Desfazer:** tirar a linha do `venda-dossie.js` do `vendas.html`. As colunas podem ficar.

## Contrato (entrega 2)

Gera o contrato de compra e venda no fim do painel da casa (PDF em
`CONTRATO GERADO`). Vale para o teste e, depois do "sobe", para a produção.

1. **Arquivos novos** no projeto PORTAL-VENDA (botão + › Script), depois de
   `RegrasVenda` e antes/junto de `PortalVenda`: `venda/ContratoVenda.js` →
   arquivo **ContratoVenda**; `venda/GerarContrato.gs` → arquivo **GerarContrato**.
   O `PortalVenda.gs` também mudou (2 ações novas): colar de novo.
2. **Serviço avançado Drive API:** Serviços (+ ao lado de Serviços) › **Drive API**
   › versão v3 › Adicionar. **É obrigatória:** ela apaga a cópia provisória
   (que tem dado pessoal) de vez, sem passar pela lixeira. Sem ela o botão
   "Gerar contrato" recusa antes de criar qualquer cópia e a tela mostra
   "Ative o serviço Drive API no PORTAL-VENDA" (`DRIVE_API_DESLIGADA`).
3. **Propriedades do script** (Configurações do projeto):
   `DB_VENDEDORES`, `DB_LOTEAMENTOS`, `DB_CORRETORES` = IDs das 3 bases de
   cadastro (VENDEDORES – CONTRATO, LOTEAMENTOS – CONTRATO, CORRETORES – CONTRATO;
   lista no arquivo 12 da DOCUMENTACAO); `MODELO_PRONTO_ID` e
   `MODELO_CONSTRUCAO_ID` = IDs dos dois modelos (Google Docs);
   `PASTA_PROVISORIA_ID` = ID de uma pasta do Drive só para as cópias
   provisórias; `CIDADE_ASSINATURA` (opcional; vazio = `Goiânia`);
   `DB_DOCUMENTOS` = ID da BASE DE DADOS DOCUMENTOS (a obra da casa é achada
   pela relação OBRA-AUTO quando ela aponta para essa base e, senão, pelo
   **endereço**: título da linha em DOCUMENTOS = título da casa, sem
   distinção de acento/caixa/espaço). Teste: `a74c5ab532d38374a4170155196788f9`;
   produção: `32fc5ab532d380a0900dd7f4bfc619bd`.
4. **Modelos no Drive:** os modelos prontos (com `{{MARCADORES}}`) ficam em
   `CONTRATOS DE VENDA/modelos-portal/` — **nunca no repositório**. Ao subir
   para o Drive, escolher **converter para Google Docs** (ou abrir o `.docx`
   pelo Google Docs e **Arquivo › Salvar como Google Docs**). O ID é o trecho
   da URL entre `/d/` e `/edit`
   (`https://docs.google.com/document/d/`**ID**`/edit`). As linhas de bloco
   (`{{#SE_VENDEDOR_PJ}}`, `{{/SE_VENDEDOR_PJ}}` etc.) e os marcadores têm que
   ficar no **corpo** do documento, nunca no cabeçalho ou no rodapé (o código
   só lê o corpo).
5. **Nova autorização:** como entraram DocumentApp, DriveApp e Drive API, a
   implantação pede autorização de novo. Implantar › Gerenciar implantações ›
   lápis › Nova versão › Implantar, e autorizar (Avançado › Acessar).
6. **Colunas e cadastros:** na VENDAS as 20 colunas `CONTRATO - …` e as 3 bases
   de cadastro (nomes e tipos exatos no arquivo 12). No teste o script
   `ferramentas/contrato/criar_estrutura_teste.py` faz tudo (fora do repo).

Teste: abrir a casa de teste, preencher/conferir os campos, **Gerar contrato**;
faltando dado, o botão lista o que falta e não gera nada.

## Assinatura (entrega 3)

Botão "Enviar para assinatura" no painel da casa: manda o ÚLTIMO PDF de
`CONTRATO GERADO` para a Clicksign (API v3) e, com "Atualizar situação",
colhe o PDF assinado em `CONTRATO ASSINADO`. Rotas e corpos usados, com o
link de cada página da documentação e as dúvidas em aberto:
`venda/CLICKSIGN-API.md`. **Testar primeiro no sandbox** (é o padrão).

1. **Arquivos novos** no projeto PORTAL-VENDA (botão + › Script):
   `venda/ClicksignVenda.js` → arquivo **ClicksignVenda**;
   `venda/AssinaturaVenda.gs` → arquivo **AssinaturaVenda**. Mudaram e têm de
   ser colados de novo: `PortalVenda.gs` (2 ações; as duas barradas para o
   perfil TESTES, porque "Atualizar situação" também grava na casa),
   `GerarContrato.gs` (carimbo no nome do PDF) e `ContratoVenda.js` (passam a
   levar os e-mails). Depois: Implantar › Gerenciar implantações › lápis ›
   Nova versão › Implantar.
   **Contrato gerado antes desta versão não é enviado:** o nome do PDF agora
   leva um carimbo dos dados (`… [#abcd1234].pdf`) e o envio recusa PDF sem
   carimbo ou com carimbo de dados antigos ("Os dados mudaram depois de gerar o
   contrato — gere de novo"). Basta clicar **Gerar contrato** de novo.
2. **Colunas novas no Notion:**
   - VENDAS: `ASSINATURA - ENVELOPE ID` (texto), `ASSINATURA - SITUAÇÃO`
     (texto: o portal grava RASCUNHO, ENVIADO, ASSINADO, RECUSADO, CANCELADO
     ou EXPIRADO — não editar à mão), `CONTRATO ASSINADO` (arquivos e mídia) e
     `Email` (já existe na produção: é o e-mail do comprador 1).
   - VENDEDORES – CONTRATO: `E-MAIL` (vendedor pessoa física) e
     `REPRESENTANTE E-MAIL` (quem assina pela empresa).
   - CORRETORES – CONTRATO: `E-MAIL` já existe (só é usado se o corretor
     assinar).
3. **Propriedades do script** (Configurações do projeto):
   - `CLICKSIGN_TOKEN` — obrigatória. Sem ela o botão responde "a
     assinatura ainda não foi ligada" e não chama nada.
   - `CLICKSIGN_URL` — opcional; padrão `https://sandbox.clicksign.com`.
     Na produção, depois do teste: `https://app.clicksign.com` (e o token
     da conta de produção — o do sandbox não vale lá).
   - `ASSINATURA_TESTEMUNHAS_SPE` e `ASSINATURA_TESTEMUNHAS_PF` — as duas
     testemunhas de cada caso, em JSON:
     `[{"nome":"Nome Sobrenome","email":"a@empresa.com","cpf":"000.000.000-00"},{...}]`.
     Vendedor PJ (SPE) usa o par SPE; vendedor PF usa o par PF.
   - `ASSINATURA_REPRESENTANTE` — opcional, JSON `{"nome":…,"email":…,"cpf":…}`:
     só completa o e-mail de quem assina pela empresa quando o cadastro do
     vendedor traz `REPRESENTANTE NOME` sem `REPRESENTANTE E-MAIL` **e o nome
     é o mesmo** (acento, caixa e espaço não contam). Nome diferente ou vazio
     no cadastro: o envio lista "Vendedor: falta REPRESENTANTE E-MAIL no
     cadastro" — o portal nunca troca a pessoa que assina.
   - `ASSINATURA_INCLUIR_CORRETOR` — `SIM` para o corretor também assinar
     (padrão: não assina).
   - `ASSINATURA_PAPEIS_<envelope>` — o próprio script cria uma por envio
     (qual signatário é comprador, testemunha…; sem dado pessoal) e apaga
     sozinho quando a situação fica final (ASSINADO, CANCELADO, EXPIRADO,
     RECUSADO) ou o envio falha. Não apagar à mão enquanto estiver em andamento.
   - `ASSINATURA_PENDENTE_<página>` — só aparece se a Clicksign ativou o
     envelope e o Notion não gravou nem na 3ª tentativa. Barra novo envio da
     casa; o "Atualizar situação" grava e apaga a chave. Não apagar à mão.
4. **Token da Clicksign:** só o **administrador da conta Clicksign** gera.
   Sandbox: criar a conta em `https://sandbox.clicksign.com/signup`; nas duas
   contas o caminho é Configurações › API › Gerar Access Token › descrição ›
   Gerar, e na mesma tela associar o e-mail à API (Salvar e-mail). Quem gerar
   **cola direto nas Propriedades do script** — nunca no chat, em e-mail, em
   planilha ou no repositório. O token vai no cabeçalho sem "Bearer".
   **Conferir antes do primeiro envio:** no editor, escolher a função
   `conferirAssinatura` na lista ao lado de "Executar" › Executar › olhar o
   "Registro de execução". Ela diz o ambiente (sandbox/produção), se a
   Clicksign aceitou o token (só o código HTTP) e o que falta no JSON das
   testemunhas — sem mostrar token, nome, e-mail ou CPF, e sem gravar nada.
   Termina em "PRONTO" ou "AINDA NÃO".
5. **Teste no sandbox:** casa de teste com contrato gerado, e-mails de teste
   que a equipe consiga abrir. Enviar para assinatura › conferir os e-mails ›
   assinar com todos › Atualizar situação › o PDF assinado aparece em
   `CONTRATO ASSINADO` e a situação vira ASSINADO. Testar também: recusar
   (situação RECUSADO e o botão volta a enviar) e cancelar o envelope na
   Clicksign (CANCELADO). Forçar uma falha antes de ativar (ex.: e-mail de
   testemunha inválido na Propriedade só no sandbox): o rascunho tem de sumir
   da Clicksign e a casa voltar a "Enviar". As dúvidas do `CLICKSIGN-API.md`
   se resolvem neste teste — o código para com erro visível em cada uma
   delas, nunca chuta.

Quem assina, na ordem: comprador 1, comprador 2 (se houver), vendedor PF ou
o representante da empresa, as duas testemunhas e, se ligado, o corretor.
Faltando e-mail, nome com sobrenome ou testemunha configurada, o botão lista
o que falta e não manda nada. Envelope em andamento, assinado ou em
RASCUNHO barra novo envio; cancelado, recusado ou expirado deixam enviar de
novo. Um envio por vez no projeto todo: se outra pessoa estiver enviando, o
botão responde "Há outro envio para assinatura em andamento". Se o envio
falhar antes de ativar, o portal apaga o rascunho na Clicksign e a casa volta
a "Enviar"; se não conseguir apagar, a situação fica "Rascunho na Clicksign" —
apagar o rascunho lá e clicar **Atualizar situação** libera a casa.

## Mais Controle (entrega 4)

Botão **Ver prévia / Lançar no Mais Controle** no fim do painel, abaixo do
Contrato. O Apps Script não fala com o ERP (o WAF exige user-agent de navegador
e o UrlFetchApp não deixa trocar): ele pede ao GitHub que rode o workflow
`mc-venda.yml`, que roda `python -m venda.mc.lancar` e escreve o resultado nas
colunas da venda. O que o robô faz:

1. lê a venda; recusa se faltar CPF válido, data da venda, casa ou valores, ou se a soma das
   parcelas (Sinal, Entrada, Intermediária, FGTS, Financiamento = financiado + subsídio)
   não bater com o que a SPE recebe;
2. acha a **obra** pelo nome (= ENDEREÇO) e usa a **conta da obra**;
3. procura **venda da mesma casa já lançada** (em qualquer grafia antiga) — se achar, **não cria** e anota o id;
4. acha o **cliente pelo CPF** (cria só se não existir);
5. na prévia, só escreve o resumo em `MC - SITUAÇÃO`; no lançamento, cria cliente (se faltar) e a venda
   (`VENDA CASA 0N - NOME`, Parcelado, juros compostos) e grava `MC - VENDA ID`.

Implantar:

1. **Colunas na VENDAS** (texto): `MC - SITUAÇÃO`, `MC - VENDA ID`. No teste o script
   `ferramentas/contrato/criar_colunas_mc_teste.py` cria (fora do repo).
2. **PORTAL-VENDA:** arquivo novo **MaisControleVenda** (`venda/MaisControleVenda.gs`) e o
   `PortalVenda` atualizado. Propriedades: `GITHUB_TOKEN` (token fine-grained do repositório,
   permissão *Contents: Read and write*) e `GH_REPO_MC` (teste: `MoraisEng-Teste/PORTAL-MORAIS`;
   produção: `DEVMoraisEng/PORTAL-MORAIS`). Nova versão.
3. **GitHub do repositório** › Settings › Secrets and variables › Actions:
   segredos `MC_ROBO_EMAIL` e `MC_ROBO_SENHA` (o usuário robô do Mais Controle — os mesmos dos
   Robôs MC) e `NOTION_TOKEN` (já existe). **Variável** `MC_VENDA_APLICAR`: deixe **vazia** enquanto
   testa (tudo vira prévia, e o pedido de lançar aparece como "BLOQUEADO"); `1` libera gravar.
4. Primeiro lançamento real: uma casa escolhida pelo dono, com ele acompanhando no ERP.

**Atenção — só existe UM Mais Controle.** O fork de TESTE fala com o mesmo ERP da
produção. No fork, `MC_VENDA_APLICAR` **nunca** é `1`: lá o botão serve só para a prévia
(que só lê). Gravar de verdade é sempre pelo repositório de produção.

Travas do robô: só grava o que foi visto na prévia (assinatura `[#…]` dos valores e
do CPF; mudou algo, recusa e pede nova prévia); não cria se já existe venda da mesma
casa (e não preenche o id, que pode ser de venda antiga); recusa se houver venda da
obra sem a casa na descrição; uma situação PROCESSANDO com mais de 15 minutos libera
pedir de novo; qualquer falha do workflow escreve ERRO na situação.

O log do Actions é público: o robô só imprime situação e motivos, nunca CPF, nome ou valores
por pessoa.

## Gerar venda do condomínio (entrega 5)

Botão **Gerar venda** em cada linha da tela do condomínio (a que lista a
BANCO DE DADOS VENDAS CONDOMÍNIO, a "pasta do cliente" do corretor). Ele cria
a casa na VENDAS com os dados e os documentos da pasta e abre a tela de venda
nessa casa (`vendas.html?abrir=<id>`). Clicar de novo não duplica: devolve a
mesma casa. O ping passa a responder `"versao":"venda-v2"`.

O que vai para onde (regra completa no topo de `venda/CondominioVenda.js`):

- `ENDEREÇO` = `CONDOMÍNIO <nome do condomínio>`; `CASA` = número da `UNIDADE`.
- Comprador 1 = `PROPONENTE` (CPF, RG, profissão, nacionalidade, estado civil,
  `Email`, `Nº Whatsapp`); endereço em texto = bloco `ENDERECO/NUMERO/SETOR/
  CIDADE/CEP COMPRADOR 1`.
- Comprador 2 = `COMPRADOR 1` do condomínio **só quando é outra pessoa** (nome
  preenchido e diferente do proponente). Se o `COMPRADOR 1` estiver vazio ou for
  o próprio proponente, o bloco "… COMPRADOR 1" completa o que faltar do
  proponente e a casa fica com um comprador só.
- Arquivos: `DOC. PROPONENTE` → identidade do comprador 1; `COMPROVANTE DE
  ENDEREÇO` → comprovante do comprador 1; `DOC. COMPRADOR 1` e `COMP. END.
  COMPRADOR 1` → comprador 2 (ou reserva do comprador 1, quando não há segundo
  comprador); e as colunas de arquivo de mesmo nome nas duas bases
  (`COMPROVANTE CARTÓRIO`, protocolos, vistoria). O arquivo é baixado e
  reenviado (não é link). Arquivo que falhar não derruba a venda: a tela lista
  quais faltaram, para anexar pelo Dossiê do comprador. Chamada com
  `atualizar: true` (opção do botão) regrava os dados a partir do condomínio e
  tenta de novo só as colunas de arquivo ainda vazias na casa.
- Valores: `VALOR DE VENDA` → `VALOR DE COMPRA E VENDA NO CONTRATO (VENDIDA)`,
  `VALOR DO CRÉDITO` → `VALOR FINANCIADO`, `SUBISÍDIO` → `VALOR DO SUBSÍDIO`,
  e todas as colunas de mesmo nome e mesmo tipo (datas, comissão, CONTRATO - …).
  `CORRETOR` e `IMOBILIÁRIA` (texto no condomínio) viram a opção de mesmo nome
  do select da VENDAS — ou uma opção nova, se não existir.
- `COMPRADOR 2` e `CONJUGE` do condomínio não têm lugar na VENDAS (dois
  compradores no máximo): não são copiados e a tela avisa.
- Nunca copia `MC - …`, `ASSINATURA - …`, `DOSSIÊ…`, `SITUAÇÃO`, fórmulas.

Implantar:

1. **Coluna nova na VENDAS** (teste e produção): `CONDOMÍNIO - VENDA ID`,
   tipo **texto**. Guarda o id da linha do condomínio (32 caracteres, sem
   hífen); é por ela que o clique repetido acha a casa e que o robô do Mais
   Controle lê o fluxo de parcelas do condomínio. Não editar à mão.
2. **PORTAL-VENDA:** arquivos novos `venda/CondominioVenda.js` → arquivo
   **CondominioVenda** e `venda/GerarVendaCondominio.gs` → arquivo
   **GerarVendaCondominio**; colar de novo o `PortalVenda`. Propriedade nova
   `DB_VENDAS_COND` = id da BANCO DE DADOS VENDAS CONDOMÍNIO (teste:
   `3f1c5ab532d381d38ba0d495b1bc8123`). A conexão do Notion (`NOTION_TOKEN`)
   tem de estar compartilhada com essa base. Nova versão e conferir o ping.
3. **Tela do condomínio** (não está neste repositório): copiar
   `venda/gerar-venda-condominio.js` para o lado da página, carregar depois do
   `app.js` e criar o botão em cada linha. O desenvolvedor cola, no ponto em que
   a linha é desenhada (`linha` = o elemento da linha; `v.id` = id da página do
   Notion daquela linha):

   ```html
   <script src="gerar-venda-condominio.js?v=1"></script>
   <script>
     const URL_PORTAL_VENDA = "https://script.google.com/macros/s/…/exec"; // a mesma do venda-dossie.js
     const URL_VENDAS = "https://<endereço do portal>/vendas.html";        // tela de venda do portal
     function botaoGerarVenda(v) {
       return GerarVendaCondominio.botao({ pageId: v.id, urlPortalVenda: URL_PORTAL_VENDA, urlVendas: URL_VENDAS });
     }
     // ao montar cada linha:  linha.appendChild(botaoGerarVenda(v));
   </script>
   ```

   O token é o da sessão do portal (`sessao()` do `app.js` ou a chave
   `morais_sessao`); o login precisa de acesso a Vendas e o perfil TESTES não
   gera. Se a tela não tiver `app.js`, passe `token:` nas opções do botão.
   `avisar: (texto, ok) => …` troca o `alert` pela mensagem da própria tela.
4. Teste: numa pasta de teste com dois compradores e documentos, **Gerar
   venda** → a tela de venda abre na casa nova; conferir dados e arquivos; clicar
   de novo → "já tinha sido gerada", sem casa duplicada.

**Tempo:** a cópia dos arquivos roda no próprio clique; pasta com muitos
documentos grandes pode passar do limite de 6 minutos do Apps Script. Nesse
caso a casa já existe: clicar de novo só abre a casa; o que faltou se anexa
pelo Dossiê do comprador (ou com um botão configurado com `atualizar: true`).

## Contrato do condomínio (entrega 6)

O botão **Gerar contrato** da casa reconhece a venda do condomínio pela coluna
`CONDOMÍNIO - VENDA ID` (preenchida pelo **Gerar venda**). Nessa casa ele lê
também a linha da BANCO DE DADOS VENDAS CONDOMÍNIO e usa um **modelo próprio**
(`MODELO_CONDOMINIO_ID`), com: art. 35-A da Lei 4.591/64 no quadro-resumo,
item 1-A dos fiadores, item 3 com unidade/área privativa/fração ideal, item 6.1
montado a partir do fluxo de pagamento (sinal, pré-chaves, balões, recursos de
terceiros, pós-chaves), 6.1-A a 6.1-D, 7.1 com INCC-M até as chaves e IPCA + 1%
a.m. depois, Cláusula Nona-A da fiança e assinatura dos fiadores. O ping passa a
responder `"versao":"venda-v3"`.

De onde vem cada coisa:

- Fluxo, fiadores, unidade, área privativa, fração ideal, matrícula, CRI,
  alvará, prazo de conclusão e corretor (`CORRETOR`, `CRECI`, `CPF CORRETOR`,
  `EMAIL CORRETOR`): da **linha do condomínio** (vale sobre o que estiver na casa).
- Compradores: da casa (como nas outras).
- Vendedor: como nas outras casas — obra em DOCUMENTOS pelo `ENDEREÇO` da casa
  (`CONDOMÍNIO <nome>`) → `PROPRIETARIO DOCUMENTO` → VENDEDORES – CONTRATO.
- Empreendimento (município/UF, matrícula, cartório): linha de **LOTEAMENTOS –
  CONTRATO cujo título é o `ENDEREÇO` da casa** (`CONDOMÍNIO <nome>`), não o SETOR.
- Comissão: paga pela incorporadora (vendedor); não entra no preço do comprador.

O que trava (lista "Faltam dados"): data de assinatura, dia de pagamento, data da
entrega, valor de venda, fluxo que não soma o VALOR DE VENDA (tolerância de
R$ 0,05), data/nº de parcelas de uma série preenchida, comprador sem nome ou com
CPF inválido, fiador com nome sem CPF válido/RG/endereço, vendedor/empreendimento/
corretor sem cadastro. O que **não** trava (decisão do dono): dados do imóvel em
branco (saem `____` no contrato) e fiador com CPF repetido — a tela mostra
"Contrato gerado. Atenção: …" com a lista.

Implantar:

1. **Modelo:** `CONTRATOS DE VENDA/modelos-portal/MODELO CONDOMINIO - portal.docx`
   (fora do repositório) → subir na **mesma pasta dos outros modelos** do Drive
   convertendo para Google Docs. O `{{FORMA_PAGAMENTO_CONDOMINIO}}` e o
   `{{FIADORES_QUALIFICACAO}}` têm de ficar **sozinhos no parágrafo** (o gerador
   troca esse parágrafo por um parágrafo por linha).
2. **Propriedade** `MODELO_CONDOMINIO_ID` = ID desse Google Doc. `DB_VENDAS_COND`
   já existe (entrega 5).
3. **PORTAL-VENDA:** colar de novo `ContratoVenda`, `GerarContrato`,
   `AssinaturaVenda` e `PortalVenda`; nova versão; conferir o ping (`venda-v3`).
4. **Cadastros:** linha em LOTEAMENTOS – CONTRATO com título `CONDOMÍNIO <nome>`;
   linha em DOCUMENTOS com o mesmo título e `PROPRIETARIO DOCUMENTO` = nome do
   vendedor exatamente como em VENDEDORES – CONTRATO; coluna `CPF CORRETOR`
   (texto) na BANCO DE DADOS VENDAS CONDOMÍNIO.
5. Teste: casa gerada pelo **Gerar venda** → **Gerar contrato** → conferir o
   6.1 contra a linha do condomínio e os fiadores.

**Ainda não faz:** os fiadores não entram como signatários na Clicksign (o
envio para assinatura manda só compradores, vendedor, testemunhas e corretor).

## Tela de venda do condomínio (entrega 7)

Decisão do dono (07/10/2026): no condomínio, o **cartão da unidade** na "Planilha
Casas Condomínio" (vendas.html, `condAbrir`) passa a ser a tela de venda. Depois do
"ANDAMENTO DO PROCESSO" aparece o quadro **TELA DE VENDA** com os mesmos blocos da
casa de rua — **Contrato** (Gerar contrato / Visualizar / Gerar de novo),
**Assinatura** (Enviar para assinatura / Atualizar situação) e **Mais Controle**
(Ver prévia / Lançar / Atualizar) — para a **própria linha** da BANCO DE DADOS
VENDAS CONDOMÍNIO. O **Gerar venda** (cópia para a VENDAS) deixa de ser usado no
cartão. O ping passa a responder `"versao":"venda-v4"`.

Como funciona: o PORTAL-VENDA aceita, nas ações `contratoEstado`, `gerarContrato`,
`assinaturaEnviar`, `assinaturaEstado`, `mcEstado` e `mcLancar`, uma página da base
`DB_VENDAS_COND` além da VENDAS. Ele monta uma "página de venda virtual"
(`CondominioVenda.paginaVirtual`: endereço `CONDOMÍNIO <nome>`, casa = UNIDADE,
compradores, valores, corretor, comissão paga pelo vendedor) e trata a própria
linha como `CONDOMÍNIO - VENDA ID` — o contrato sai do modelo único
`MODELO_CONDOMINIO_ID` com o fluxo e os fiadores dela, como na entrega 6. O que a
ação devolve é gravado em colunas da linha (lista e tipos em
[`COLUNAS-CONDOMINIO.md`](COLUNAS-CONDOMINIO.md)). Página de outra base continua
recusada (`PAGINA_DE_OUTRA_BASE`). O robô do Mais Controle (`venda/mc`) lê a linha
direto (comprador = PROPONENTE, total = VALOR DE VENDA, financiado = VALOR DO
CRÉDITO, FGTS, SUBISÍDIO, corretor, imobiliária, data da venda, fluxo) e grava
`MC - SITUAÇÃO` / `MC - VENDA ID` nela; a casa da VENDAS com `CONDOMÍNIO - VENDA ID`
continua funcionando como antes.

Desempenho: ao abrir o cartão, os três estados (contrato, assinatura, Mais
Controle) são pedidos **em paralelo e uma vez só**; o cartão se redesenha a cada
gravação do andamento e os blocos reaproveitam o que já foi lido.

Implantar:

1. **Notion:** criar na BANCO DE DADOS VENDAS CONDOMÍNIO as 6 colunas de
   [`COLUNAS-CONDOMINIO.md`](COLUNAS-CONDOMINIO.md) (`CONTRATO GERADO` e
   `CONTRATO ASSINADO` = Arquivos e mídia; `ASSINATURA - ENVELOPE ID`,
   `ASSINATURA - SITUAÇÃO`, `MC - SITUAÇÃO`, `MC - VENDA ID` = Texto). A
   integração do Notion do PORTAL-VENDA já tem acesso à base (entrega 5).
2. **PORTAL-VENDA:** colar de novo `CondominioVenda` (de `venda/CondominioVenda.js`),
   `GerarContrato`, `MaisControleVenda` e `PortalVenda`; nova versão; conferir o
   ping (`venda-v4`). Propriedades: nada novo (`DB_VENDAS_COND` e
   `MODELO_CONDOMINIO_ID` já existem).
3. **Robô do Mais Controle:** nada a configurar — o workflow `mc-venda` já recebe
   `DB_VENDAS_COND` (variável do repositório); vale o código da `main`.
4. **Portal (site):** publicar `venda-dossie.js` com a `URL_PORTAL_VENDA` deste
   ambiente preenchida (como nas entregas anteriores). Ele passa a expor
   `window.VendaBlocos` (`montar(elemento, pageId)` e `soltar()`) e carrega o
   `venda/assinatura-ui.js` mesmo sem o painel da casa.
5. **vendas.html** (quem mantém a produção cola estas 4 mudanças pequenas):
   - trocar `<script src="venda-dossie.js?v=1"></script>` por `?v=2`;
   - em `condFechar()`, logo depois de `COND_ABERTA=null;`:
     `if(window.VendaBlocos) VendaBlocos.soltar();`
   - em `condAbrir(id)`, na montagem do cartão, entre `condAndamentoHtml(l)+` e
     `condLinkVendaHtml(l)+`: `condTelaVendaHtml()+`
   - no fim de `condAbrir(id)`, depois de `document.getElementById("cd-card").style.display="block";`:
     `if(window.VendaBlocos) VendaBlocos.montar(document.getElementById("cd-venda"),id);`
     e, logo depois da função, a nova função:
     ```js
     function condTelaVendaHtml(){
       if(!window.VendaBlocos) return "";
       return '<div class="cd-and"><h4>TELA DE VENDA <span style="font-weight:400;color:var(--text3)">· contrato, assinatura e Mais Controle desta unidade</span></h4><div id="cd-venda"></div></div>';
     }
     ```
   - trocar o número do cache do `sw.js` como de costume (vendas.html mudou).
6. **Teste** (no ambiente de teste): abrir uma unidade com o fluxo completo →
   Gerar contrato → conferir o PDF em `CONTRATO GERADO` da linha → Enviar para
   assinatura (sandbox) → Ver prévia do Mais Controle (com `MC_VENDA_APLICAR` desligado).

Cuidado: uma unidade que **já** virou casa na VENDAS pelo Gerar venda pode ser
tocada pelos dois caminhos. O Mais Controle se protege (o robô recusa venda
repetida da mesma unidade — "JÁ EXISTE"), mas contrato e envelope da Clicksign
seriam dois. Para essas unidades, terminar pela casa da VENDAS; as novas, pelo
cartão.

## Distrato (entrega 8)

Pedido do dono (07/10/2026): o botão **DISTRATO** da tela de venda passa a
(a) ARQUIVAR a venda numa base própria antes de limpar e (b) acertar a venda
no Mais Controle — única exceção à regra "a automação nunca altera/exclui
venda do ERP", e só por aqui, com prévia e senha.

**Regra no Mais Controle:** houve recebimento (retido ou devolvido) → na
venda ficam só as parcelas recebidas e a descrição ganha ` (Distrato)`;
DEVOLVIDO → também lança a CONTA A PAGAR da devolução (valor e data da tela;
padrão: o recebido, hoje + 30); nada recebido → a venda é EXCLUÍDA. Rotas e
o que é certo/suposição: `venda/mc/DISTRATO-ERP.md`.

**Onde está o código:**
- backend: Code.gs do portal (projeto PORTAL-TESTE primeiro) — ações
  `distratoPrevia`, `distratoEstado` e a `distrato` reescrita (bloco
  "DISTRATO — ARQUIVO E MAIS CONTROLE"). O Code.gs não mora neste
  repositório: a versão de teste está na pasta local do dono (`portal-gs-vivo/teste/code.gs.txt`);
- tela: `vendas.html` (modal do distrato) — mudança mínima neste branch, para
  o desenvolvedor incorporar;
- robô: `venda/mc/distrato.py`, acionado pelo mesmo workflow `mc-venda.yml`
  com `acao=distrato`, `recebeu=sim|nao`, `destino=retido|devolvido`,
  `valor`, `data`.

### O diálogo novo da tela

1. Pergunta **"Houve sinal/pagamento recebido?"** (Sim/Não).
2. Se Sim: **"O valor recebido será RETIDO ou DEVOLVIDO?"**. Se DEVOLVIDO:
   **valor a devolver** (vazio = todo o recebido) e **data prevista** (vazio = hoje + 30).
3. **Motivo** (obrigatório).
4. Botão **"Ver o que acontece no Mais Controle"**: o portal aciona o robô
   em PRÉVIA (nada é gravado) e a tela mostra, em 1–3 minutos, o texto que
   ele escreveu na coluna `MC - DISTRATO` da venda: parcelas mantidas e
   removidas, a descrição nova, a conta a pagar da devolução — ou "EXCLUIR a
   venda" — ou a RECUSA com o motivo. Venda sem `MC - VENDA ID`: a tela diz
   que nada será feito no ERP.
5. Só com a prévia OK o botão **Confirmar distrato** libera; pede a **senha**.
   Mudou qualquer resposta depois da prévia → precisa de prévia nova.
6. Ao confirmar, o Apps Script: confere a senha e que a prévia é destas
   respostas → ARQUIVA na base DISTRATOS (copiando os arquivos) → aciona o
   robô em APLICAR a partir do arquivo → limpa a venda e apaga as atividades
   (como antes). Falhou o arquivo ou o acionamento → **nada é limpo**.
7. O resultado do ERP aparece na base DISTRATOS, coluna `MC - DISTRATO`.

### O que o dono cria / cola / configura (teste primeiro)

1. Notion: base **DISTRATOS** com as colunas de `venda/DISTRATOS-ESQUEMA.md`;
   coluna **`MC - DISTRATO`** (Texto) na base VENDAS (de teste e, depois, de
   produção). Dar acesso às integrações (portal e robô) à base nova.
2. Apps Script (PORTAL-TESTE): colar o `code.gs.txt` de teste atualizado;
   Propriedade **`DB_DISTRATOS`** = id da base DISTRATOS de teste. O
   `GITHUB_TOKEN` já existe (o do aviso de build) e precisa poder disparar
   `repository_dispatch` no repositório onde mora o `mc-venda.yml`
   (Contents: Read and write). Opcional: `GH_REPO_MC` (sem ela vale o
   `GH_REPO` do arquivo). Nova versão da implantação.
3. GitHub (fork de teste) → Settings → Variables: **`DB_DISTRATOS`** (id da
   base, obrigatória para o APLICAR), **`NATUREZA_DEVOLUCAO_ID`** (id da
   categoria do título a pagar da devolução no Mais Controle; sem ela a
   devolução só é avisada) e, opcional, **`FORMA_PAGAMENTO_DEVOLUCAO_ID`**.
   `MC_VENDA_APLICAR` continua NUNCA 1 no fork de teste (o aplicar volta "BLOQUEADO").
4. Teste: venda de teste com `MC - VENDA ID` → prévia (Não / Sim-Retido /
   Sim-Devolvido) → confirmar → conferir a linha na base DISTRATOS (dados,
   arquivos copiados, `MC - DISTRATO` = BLOQUEADO com a prévia) e a venda
   limpa. Também: sem `DB_DISTRATOS` o distrato recusa e não limpa.
5. Produção (quando o dono disser "sobe"): o desenvolvedor leva o bloco para
   o Code.gs de produção e o modal para o `vendas.html`; Propriedade
   `DB_DISTRATOS` de produção; variáveis no repositório de produção;
   `MC_VENDA_APLICAR=1` lá já existe.

**Riscos conhecidos:** rotas de exclusão/alteração e o favorecido-cliente na
conta a pagar não foram provados ao vivo (ver DISTRATO-ERP.md); a devolução
é lançada só como conta a pagar (não paga nada); se o robô falhar DEPOIS da
limpeza, a venda do portal já está limpa e o resultado/erro fica na base
DISTRATOS para alguém resolver no ERP à mão; a cópia de arquivos aumenta o
tempo do distrato (arquivo acima de 20 MB recusa).

## Pré-contrato (entrega 9)

Pedido do dono (07/10/2026): antes do contrato de verdade sai um **pré-contrato**
para conferir. É o mesmo documento do contrato, mas com **tudo o que o app
preencheu grifado em amarelo** (`#FFF59D`) — cada valor que trocou um marcador
`{{X}}` (corpo, cabeçalho e rodapé, vários no mesmo parágrafo inclusive) e cada
linha gerada (o 6.1 do condomínio e a qualificação dos fiadores). Campo que saiu
em branco (`____`) fica grifado em **vermelho claro** (`#FFCDD2`). O ping passa a
responder `"versao":"venda-v5"`.

Fluxo na tela (casa de rua e cartão do condomínio, o mesmo código):

1. **Sem pré-contrato** → botão **Gerar pré-contrato**.
2. **Pré-contrato gerado** → link **Visualizar pré-contrato** (abre o PDF em nova
   aba), botão **Conferi, está tudo certo — gerar contrato** e **Gerar
   pré-contrato de novo**. Se os dados mudaram depois do pré-contrato, aparece o
   aviso e o "Conferi" fica travado até gerar de novo.
3. **Contrato final gerado** → como antes: **Visualizar** / **Gerar de novo** — o
   "Gerar de novo" volta ao passo 2 (sai um pré-contrato novo; o contrato atual
   só é trocado quando alguém conferir).

A **Assinatura** só libera com o contrato FINAL (no passo 2 o "Enviar para
assinatura" fica travado).

Como funciona (PORTAL-VENDA):

- `gerarPreContrato`: monta os dados como o contrato, copia o modelo, preenche
  com grifo, exporta o PDF `PRÉ-CONTRATO - … [#carimbo].pdf` para a **pasta
  provisória** (`PASTA_PROVISORIA_ID`) e **não** grava em `CONTRATO GERADO`. A
  cópia de trabalho do Docs é apagada como sempre; o PDF do pré-contrato
  anterior da mesma página é apagado. Guarda na Propriedade
  `PRECONTRATO_<pageId>` o carimbo dos dados, o link do PDF, a data e quem gerou.
- `aprovarPreContrato` (o "Conferi"): só gera o contrato FINAL (sem grifo, em
  `CONTRATO GERADO`, mesmo carimbo no nome) se existe pré-contrato e os dados de
  agora dão o **mesmo carimbo**. Senão: `PRECONTRATO_DESATUALIZADO` (os dados
  mudaram — gere o pré-contrato de novo) ou `PRECONTRATO_FALTANDO`. Registra na
  mesma Propriedade quem conferiu e quando (nada disso vai para o log).
- A ação antiga `gerarContrato` agora faz o mesmo que `aprovarPreContrato` — não
  existe mais gerar o contrato final direto.
- `contratoEstado` devolve também `etapa` (`NENHUM` / `PRE` / `FINAL`) e `pre`
  (`nome`, `url`, `em`, `conferido` e, na etapa PRE, `desatualizado`). Na etapa PRE
  ele recalcula o carimbo (lê os cadastros), por isso demora um pouco mais.
- No contrato final o fundo de cada valor é **apagado** — o realce amarelo que o
  modelo antigo tinha nos marcadores some.

Implantar:

1. **PORTAL-VENDA:** colar de novo `ContratoVenda` (de `venda/ContratoVenda.js`),
   `GerarContrato` e `PortalVenda`; nova versão; conferir o ping (`venda-v5`).
   Propriedades: nada novo (as `PRECONTRATO_<pageId>` são criadas sozinhas).
2. **Portal (site):** publicar `venda-dossie.js` com a `URL_PORTAL_VENDA` deste
   ambiente preenchida.
3. **Pasta provisória:** não compartilhe. O "Visualizar pré-contrato" entrega o
   PDF pelo próprio portal (`verPreContrato`) a quem está logado; a pasta fica
   privada da conta dona e o PDF nunca tem link público.
4. **Teste:** numa casa de teste, Gerar pré-contrato → abrir o PDF e ver os grifos
   (amarelo e, no condomínio com campo vazio, vermelho) → mudar um valor no Notion
   → o "Conferi" trava → Gerar pré-contrato de novo → Conferi → o contrato em
   `CONTRATO GERADO` sai sem grifo nenhum → Enviar para assinatura libera.

**Ainda não faz:** o carimbo cobre os dados, não o texto do modelo — trocar o
modelo do Docs depois do pré-contrato não trava o "Conferi". O último PDF de
pré-contrato de cada casa fica na pasta provisória (só o anterior é apagado).

## Documentos do imóvel (entrega 11)

No painel da casa, abaixo do dossiê do comprador, a seção **Documentos do
imóvel** tem três espaços: **Matrícula** (certidão de matrícula / inteiro teor
do cartório), **Alvará de construção** e **Habite-se**. Mesmo fluxo do dossiê do
comprador: Enviar e ler / Ler de novo / Trocar → a IA (OpenAI padrão, Claude
plano B — as mesmas Propriedades) lê → preenche as colunas do contrato da casa →
**DOSSIÊ IMÓVEL** fica `LIDO PELA IA – CONFERIR` → alguém confere (Marcar
conferido / Devolver, que aqui mexem só no dossiê do imóvel). Vale "o último
documento enviado vale": valor lido substitui o atual; Trocar remove os arquivos
anteriores do espaço. O ping passa a responder `"versao":"venda-v6"`.

O que a IA lê de cada documento:

| Documento | Campos lidos | Onde grava |
|---|---|---|
| Matrícula | nº da matrícula individual, cartório (CRI), área total (m², número), confrontações | `CONTRATO - MATRÍCULA INDIVIDUAL`, `CONTRATO - CRI DA MATRÍCULA`, `CONTRATO - ÁREA DO LOTE (M²)`, `CONTRATO - CONFRONTAÇÕES` |
| Matrícula | loteamento (denominação, matrícula do loteamento, cartório), se a certidão citar | **não grava na casa**: aparece na tela e na observação como "dados do loteamento encontrados — preencher uma vez no cadastro do setor (LOTEAMENTOS – CONTRATO)" |
| Alvará | número e data | `CONTRATO - ALVARÁ Nº`, `CONTRATO - ALVARÁ DATA` |
| Habite-se | número e data | `CONTRATO - HABITE-SE Nº`; a **data não grava**: o contrato usa a `DATA HABITE-SE` da obra (DOCUMENTOS) — a data lida vai para a observação para conferir |

Validação: datas viram ISO e só se existirem no calendário (31/02 não grava e
avisa); a área tem de ser número > 0 (`360,50 m²` → 360,5); textos sem espaços
sobrando. Documento trocado de lugar (alvará no espaço do habite-se, outra coisa
qualquer) não preenche nada e avisa. O estado fica `FALTA DOCUMENTO` até ter
matrícula **e** alvará; o habite-se não segura (só existe com a obra pronta, e o
contrato só o exige nesse caso). Os logs continuam só com espaço e tokens.

**Casa de condomínio:** a seção só avisa que os dados do imóvel vêm da linha do
condomínio (VENDAS CONDOMÍNIO). O cartão do condomínio (`.cd-cardbox`) não tem
dossiê, então lá não muda nada.

**Colunas são opcionais para o resto do app:** se faltarem na VENDAS, o dossiê
do comprador, contrato, assinatura e Mais Controle seguem; só a seção do imóvel
mostra "A base não tem a coluna … — avise o desenvolvedor".

### O que criar na VENDAS de produção (nomes exatos)

| Coluna | Tipo |
|---|---|
| `IMÓVEL - MATRÍCULA` | Arquivos e mídia (files) |
| `IMÓVEL - ALVARÁ` | Arquivos e mídia (files) |
| `IMÓVEL - HABITE-SE` | Arquivos e mídia (files) |
| `DOSSIÊ IMÓVEL` | Seleção (select) com `FALTA DOCUMENTO`, `LIDO PELA IA – CONFERIR`, `CONFERIDO`, `DEVOLVIDO` (o travessão é o mesmo do DOSSIÊ) |
| `DOSSIÊ IMÓVEL - OBSERVAÇÃO` | Texto (rich_text) |

As sete `CONTRATO - *` do imóvel são as da entrega 2 (mesmos nomes e tipos;
`CONTRATO - ÁREA DO LOTE (M²)` número, `CONTRATO - ALVARÁ DATA` data, as outras
texto) — na produção elas já estão na lista de colunas a criar do contrato
(`ferramentas/contrato/previa-producao.json`, junto com as 5 novas). Nenhuma
Propriedade nova no Apps Script.

Implantar:

1. **Notion (produção):** criar as 5 colunas acima (já criadas na base de TESTE).
2. **PORTAL-VENDA:** colar de novo `RegrasVenda`, `OpenAILeitor`, `ClaudeLeitor` e
   `PortalVenda`; nova versão; ping `venda-v6`.
3. **Portal (site):** publicar `venda-dossie.js` com a `URL_PORTAL_VENDA` do
   ambiente.
4. **Code.gs do portal (ESCRITA):** o `DISTRATO_MANTIDOS` passa a manter
   `TIPO DE CASA`, as sete `CONTRATO - *` do imóvel, as três `IMÓVEL - *`,
   `DOSSIÊ IMÓVEL` e `DOSSIÊ IMÓVEL - OBSERVAÇÃO` (são dados da casa, não do
   comprador: sobrevivem ao distrato).
5. **Teste:** numa casa de rua de teste, enviar uma matrícula (PDF) → conferir os
   4 campos e o aviso do loteamento → enviar o alvará → estado `LIDO PELA IA –
   CONFERIR` → Marcar conferido → gerar o pré-contrato e ver matrícula, CRI, área,
   confrontações e alvará grifados.

**Ainda não faz:** não grava o loteamento no cadastro do setor (só mostra); não
confere se a matrícula é da mesma quadra/lote do endereço; certidão com mais de
4 arquivos no espaço só tem os 4 últimos lidos.

## Entrega 12 — campos abertos na tela do contrato

Quando falta dado do **vendedor**, do **corretor** ou do **loteamento**, o bloco
Contrato deixa de mostrar só a lista: mostra um formulário com exatamente os
campos que faltam, por grupo (Vendedor — com o representante quando é PJ —,
Corretor, Loteamento/Condomínio), e o botão **Salvar dados e gerar
pré-contrato**. As outras faltas (comprador, imóvel, negociação) continuam em
lista. A tela só recebe o NOME dos campos — nunca CPF, e-mail ou outro dado
de ninguém.

O que é digitado vai para a linha do cadastro:

| Grupo | Linha | Se não existe |
|---|---|---|
| Vendedor | a de `DB_VENDEDORES` do PROPRIETARIO DOCUMENTO da obra | **não cria** (o cadastro do dono é oficial): fica o erro |
| Corretor | a de `DB_CORRETORES` com o nome do CORRETOR da venda | cria (título = nome do corretor da venda) |
| Loteamento | a de `DB_LOTEAMENTOS` do SETOR da casa (condomínio: a do nome do condomínio) | cria na **1ª** base de `DB_LOTEAMENTOS`; o SETOR vai na coluna `SETOR` se a base tiver, senão no título |

- Grava **só** as colunas enviadas (preencher ou trocar), e só colunas que
  existem na linha/base, nos tipos texto, número, e-mail, seleção ou telefone.
  Coluna que a base não tem volta como erro, sem gravar nada.
- Lista branca (`ContratoVenda.CAMPOS_CADASTRO`) = os nomes exatos que o
  contrato lê. Vendedor: `CPF/CNPJ`, `TIPO`, `ENDEREÇO / SEDE`,
  `REPRESENTANTE NOME|CPF|RG|NACIONALIDADE|ESTADO CIVIL|E-MAIL`,
  `NACIONALIDADE`, `ESTADO CIVIL`, `PROFISSÃO`, `RG`, `E-MAIL`. Corretor:
  `CRECI`, `CPF/CNPJ`, `NACIONALIDADE`, `ENDEREÇO PROFISSIONAL`, `E-MAIL`.
  Loteamento: `DENOMINAÇÃO`, `MUNICÍPIO/UF`, `MATRÍCULA DO LOTEAMENTO`,
  `CARTÓRIO`, `PRAZO POSSE (DIAS)`, `PRAZO CHAVES (DIAS ÚTEIS)`. Os dados
  bancários do vendedor ficam **fora** de propósito: a conta vai pela "Conta
  de recebimento" (abaixo), por venda.
- Confere CPF e CNPJ pelo dígito, e-mail, prazos (número inteiro de dias) e
  PJ/PF; tira `{{ }}`; recusa nome de campo fora da lista.
- Depois de gravar, gera o pré-contrato como o botão de sempre (o que foi
  digitado sai grifado em amarelo como todo campo preenchido pelo app). Se
  ainda faltar algo, o formulário volta só com o que falta.
- Perfil TESTES não grava.

### Conta de recebimento (por venda)

No bloco Contrato, o campo **Conta de recebimento** lista as contas da CONTAS
BANCÁRIAS (só o título), já na conta da obra quando a obra tem uma, e tem a
opção **Digitar outra conta** (Banco, Agência, Conta, Chave PIX opcional).

- A escolha vale **só para esta venda**: Propriedade do script
  `CONTA_RECEB_<pageId>` = `{"contaId": "…"}` ou
  `{"banco","agencia","conta","pix"}`. A conta digitada **não** é gravada no
  Notion (decisão: é coisa daquela venda; cadastro de conta continua no
  Notion/robô de contas).
- Ordem: conta escolhida/digitada → conta da obra → conta do cadastro do
  vendedor. Conta escolhida que sumiu da base vira falta ("escolha de novo"),
  nunca troca sozinha por outra.
- O contrato sempre leva banco, agência e conta; o PIX só quando existe.
- A conta entra no carimbo: trocar a conta depois do pré-contrato deixa o
  pré-contrato **desatualizado** (gere de novo antes do "Conferi").

### Implantar

1. **Notion TESTE:** a base `CONTAS BANCÁRIAS` do teste já existia (criada
   pelo robô de contas em 06/10, sem linhas); ganhou a coluna `CHAVE PIX`
   (texto) e 2 contas inventadas (CONTA TESTE ALFA e BETA). Id:
   `3f1c5ab532d3812caaedf6c9a383aace`. **Produção:** nenhuma coluna nova
   (`DB_CONTAS_BANCARIAS` já existe).
2. **PORTAL-VENDA:** colar de novo `ContratoVenda`, `GerarContrato` e
   `PortalVenda`; nova versão; ping `venda-v7`. No **PORTAL-VENDA-TESTE**,
   Propriedade nova `DB_CONTAS_BANCARIAS` = `3f1c5ab532d3812caaedf6c9a383aace`
   (sem ela a lista fica vazia e só aparece "Digitar outra conta").
3. **Portal (site):** publicar `venda-dossie.js` e `vendas.html` (o
   `venda-dossie.js?v=3` força o navegador a pegar o arquivo novo).
4. **Teste:** numa casa de teste com o corretor sem cadastro → Gerar
   pré-contrato → o formulário pede CRECI e CPF/CNPJ do corretor → preencher →
   Salvar dados e gerar pré-contrato → conferir a linha nova em CORRETORES e o
   pré-contrato. Trocar a Conta de recebimento → aviso de pré-contrato
   desatualizado → gerar de novo e ver banco/agência/conta no texto.

## Plano B — Anthropic

A leitura por padrão é pela OpenAI (decisão do dono em 28/09/2026); a
integração com a Anthropic (Claude) fica guardada e pode ser religada a
qualquer momento, sem trocar código: nas propriedades do script, ponha
`PROVEDOR_IA` = `anthropic` e `ANTHROPIC_API_KEY` = a chave da Anthropic
(`OPENAI_API_KEY`/`MODELO_IA` ficam sem efeito nesse modo). A versão do
código anterior a esta troca de provedor também está marcada na tag git
`anthropic-plano-b`.
