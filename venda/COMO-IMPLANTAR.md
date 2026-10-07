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
5. Teste: abrir `<URL>/exec?action=ping` → `{"ok":true,"versao":"venda-v2","papel":"VENDA"}`.
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

1. Desenvolvedor cria as 24 colunas na VENDAS de produção (arquivo 10 da DOCUMENTACAO).
2. Projeto **PORTAL-VENDA** igual ao de teste, com `NOTION_TOKEN` e `SESSION_SECRET`
   **iguais aos do PORTAL-ESCRITA**, `DB_VENDAS` = `33cc5ab532d38047ae3aee8b87ac1f4d`,
   `PROVEDOR_IA` = `openai`, `OPENAI_API_KEY` = a chave da OpenAI e `MODELO_IA`
   opcional. Implantar e testar o `ping`.
3. Subir `venda-dossie.js` com a URL `/exec` de produção na constante `URL_PORTAL_VENDA`.
4. No `vendas.html` de produção, depois da linha do `app.js`, acrescentar
   `<script src="venda-dossie.js?v=1"></script>`.
5. Conferir numa casa: o bloco aparece; tipo de casa grava; um documento lê.
   Se o bloco não aparecer: Ctrl+F5 (o `sw.js` guarda páginas em cache).

**Desfazer:** tirar a linha do `vendas.html`. As colunas podem ficar.

**Não sobe para produção:** a pasta `teste/` e o commit do apontador.

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
     `COMPRADOR 1 - E-MAIL` (e-mail; o do comprador 2 já existe).
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
   Robôs MC) e `NOTION_TOKEN` (já existe). **Variável** `MC_APLICAR`: deixe **vazia** enquanto
   testa (tudo vira prévia, e o pedido de lançar aparece como "BLOQUEADO"); `1` libera gravar.
4. Primeiro lançamento real: uma casa escolhida pelo dono, com ele acompanhando no ERP.

**Atenção — só existe UM Mais Controle.** O fork de TESTE fala com o mesmo ERP da
produção. No fork, `MC_APLICAR` **nunca** é `1`: lá o botão serve só para a prévia
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

## Plano B — Anthropic

A leitura por padrão é pela OpenAI (decisão do dono em 28/09/2026); a
integração com a Anthropic (Claude) fica guardada e pode ser religada a
qualquer momento, sem trocar código: nas propriedades do script, ponha
`PROVEDOR_IA` = `anthropic` e `ANTHROPIC_API_KEY` = a chave da Anthropic
(`OPENAI_API_KEY`/`MODELO_IA` ficam sem efeito nesse modo). A versão do
código anterior a esta troca de provedor também está marcada na tag git
`anthropic-plano-b`.
