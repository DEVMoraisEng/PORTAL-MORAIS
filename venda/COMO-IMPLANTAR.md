# PORTAL-VENDA — como implantar

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

## Plano B — Anthropic

A leitura por padrão é pela OpenAI (decisão do dono em 28/09/2026); a
integração com a Anthropic (Claude) fica guardada e pode ser religada a
qualquer momento, sem trocar código: nas propriedades do script, ponha
`PROVEDOR_IA` = `anthropic` e `ANTHROPIC_API_KEY` = a chave da Anthropic
(`OPENAI_API_KEY`/`MODELO_IA` ficam sem efeito nesse modo). A versão do
código anterior a esta troca de provedor também está marcada na tag git
`anthropic-plano-b`.
