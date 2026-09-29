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
5. Teste: abrir `<URL>/exec?action=ping` → `{"ok":true,"versao":"venda-v1","papel":"VENDA"}`.
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
   › versão v3 › Adicionar. Serve para apagar a cópia provisória de vez; sem
   ele a cópia vai só para a lixeira (o log avisa).
3. **Propriedades do script** (Configurações do projeto):
   `DB_VENDEDORES`, `DB_LOTEAMENTOS`, `DB_CORRETORES` = IDs das 3 bases de
   cadastro (VENDEDORES – CONTRATO, LOTEAMENTOS – CONTRATO, CORRETORES – CONTRATO;
   lista no arquivo 12 da DOCUMENTACAO); `MODELO_PRONTO_ID` e
   `MODELO_CONSTRUCAO_ID` = IDs dos dois modelos (Google Docs);
   `PASTA_PROVISORIA_ID` = ID de uma pasta do Drive só para as cópias
   provisórias; `CIDADE_ASSINATURA` (opcional; vazio = `Goiânia`).
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

## Plano B — Anthropic

A leitura por padrão é pela OpenAI (decisão do dono em 28/09/2026); a
integração com a Anthropic (Claude) fica guardada e pode ser religada a
qualquer momento, sem trocar código: nas propriedades do script, ponha
`PROVEDOR_IA` = `anthropic` e `ANTHROPIC_API_KEY` = a chave da Anthropic
(`OPENAI_API_KEY`/`MODELO_IA` ficam sem efeito nesse modo). A versão do
código anterior a esta troca de provedor também está marcada na tag git
`anthropic-plano-b`.
