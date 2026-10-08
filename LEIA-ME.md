# Pacote r66 — documentos na proposta, VENDIDA e completar venda

Cada pasta vai para um destino. Só estão os arquivos que mudaram (completos).

| Pasta | O que fazer |
|---|---|
| `1_GITHUB_SIMULADOR-RESERVA-DO-IP-S` | Subir `proposta.html` (alterado) e `completar-venda.html` (novo) na raiz do repositório |
| `2_GITHUB_PORTAL-MORAIS` | Subir `simulacoes.html` e `sw.js` (cache v77) na raiz do repositório |
| `3_APPS_SCRIPT_SIMULADOR` | Colar `Code.gs` no Apps Script do SIMULADOR (o da URL AKfycbzwUIA…) e publicar **Nova versão** |
| `4_APPS_SCRIPT_PORTAL` | Colar `Simulacoes.gs` nos DOIS projetos (PORTAL-LEITURA e PORTAL-ESCRITA) e publicar **Nova versão** em cada um |

## Ordem
1. Apps Script do simulador (`Code.gs`) → nova versão.
2. Apps Script do portal (`Simulacoes.gs`, nos dois projetos) → nova versão.
3. GitHub dos dois repositórios.
4. No Notion, abra o **BANCO DE DADOS VENDAS CONDOMÍNIO** → `...` → Conexões → adicione a integração que o Apps Script usa (sem isso o script não enxerga o banco).
5. No editor do Apps Script do simulador, rode uma vez `prepararBancoVendas` — cria as colunas de documentos e de controle que faltam. (Se você esquecer, elas são criadas sozinhas na primeira venda.)
6. Rode o setup das propostas no portal (botão que já existe) para criar `DATA VENDIDA`, `PRAZO ENTRADA`, `COMISSAO %`, `COMISSAO R$`, `DOC. CRECI`, `TOKEN VENDA`. (Também são criadas sozinhas no primeiro envio de proposta.)

## Propriedades do script (Apps Script do simulador)
- `LEITOR_DOC` = `claude` ou `openai` (vazio = leitor desligado; as telas pedem preenchimento manual)
- `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` conforme o motor escolhido
- Opcionais: `LEITOR_MODELO`, `LEITOR_LIMITE_HORA` (padrão 200), `DB_VENDAS_COND` (padrão: o banco do seu link)
- O portal continua usando `SIM_SEGREDO` = `WORKER_SEGREDO` e `SIM_EXEC_URL` (já existem).

## Links de teste
- Versão do simulador (deve mostrar `2026-09-29 r66`):
  https://script.google.com/macros/s/AKfycbzwUIApU5nKXi1vG3cEs_V2DWCdkLDwY_vo0zBxO59ZBLbEihIxuOqbHdNLm-8pVVwVJQ/exec?acao=versao
- Colunas das bases (para conferir o que foi criado):
  https://script.google.com/macros/s/AKfycbzwUIApU5nKXi1vG3cEs_V2DWCdkLDwY_vo0zBxO59ZBLbEihIxuOqbHdNLm-8pVVwVJQ/exec?acao=esquema
- Proposta: https://devmoraiseng.github.io/SIMULADOR-RESERVA-DO-IP-S/proposta.html
- Completar venda: sai do portal (botão "Link para completar as informações da venda" dentro da proposta)
- Portal, aba Simulações/Propostas: https://devmoraiseng.github.io/PORTAL-MORAIS/simulacoes.html

## O que mudou
**Proposta (passo 1):** o proponente e o cônjuge (se casado/união estável) podem anexar CNH **ou** RG + CPF (um campo para cada). O documento é lido e preenche só os campos vazios; se não ler, aparece "preencha manualmente". Opcional, não trava nada. No passo 4 o item aparece com ✓ "Anexado na página 1".
**Proposta (passo 2):** escolha obrigatória do prazo da entrada (24/36/48 meses → comissão 5,00% / 4,75% / 4,50%). Grava `PRAZO ENTRADA`, `COMISSAO %` e `COMISSAO R$` (o servidor refaz a conta pelo preço).
**Proposta (passo 4 → 5):** anexo do CRECI do corretor; a leitura preenche corretor, CRECI e imobiliária no passo 5.
**Portal:** botão **Vendida** → proposta VENDIDA, coluna VENDIDA da unidade = SIM, linha criada/atualizada no BANCO DE DADOS VENDAS CONDOMÍNIO e cópia dos documentos da proposta. Novo botão **Link para completar as informações da venda** (copiar ou enviar por e-mail na conversa da proposta).
**Link de completar venda:** mostra o que já está no banco, pede o que falta (dados de proponente, cônjuge, compradores, fiadores, contato, endereço, data de pagamento das parcelas), lê o comprovante de endereço para preencher CEP/endereço/número/setor/cidade e recebe os documentos.

## Regras que adotei (confira)
- O banco de vendas **nunca é sobrescrito**: ao marcar VENDIDA de novo, só entram os campos que estão vazios.
- `VALOR NA MÃO` = valor de venda − comissão. `PERCENTUAL COMISSÃO` grava 0,045 se a coluna for formato porcentagem, ou 4,5 se for número simples.
- Valores do fluxo gravados **por parcela** (ex.: 12 × R$ 860 → `VALOR 1º PARTE PRÉ CHAVES` = 860). `DATA 1º BALÃO` = 20/12/2027.
- `COMPRADOR 1/2` = 2º comprador informado na proposta (tipo COMPRADOR); proponente e cônjuge têm campos próprios.
- Datas dos sinais, `DATA DE ASSINATURA DO CONTRATO`, `DATA DA ENTREGA` e o "entregou a casa" ficam com a Morais (não são preenchidos por código).
- Documentos de renda da proposta vão para `COMPROVANTES DE RENDA`; `DOC. PARTICIPANTES` vai para `DOC. COMPRADOR 1`.
- Colunas novas no banco de vendas: `ID PROPOSTA`, `PROPOSTA`, `CORRETOR`, `CRECI`, `IMOBILIÁRIA`, `EMAIL CORRETOR`, `PRAZO ENTRADA`, `DATA DA VENDA`, `STATUS DO CADASTRO`, `PENDÊNCIAS` e as colunas de arquivo `DOC. PROPONENTE`, `DOC. CONJUGE`, `DOC. COMPRADOR 1/2`, `DOC. FIADOR 1/2`, `COMPROVANTE DE ENDEREÇO`, `CERTIDÕES`, `COMPROVANTES DE RENDA`, `DOC. CRECI`, `PROPOSTA (PDF)`, `CONTRATO`, `OUTROS ANEXOS`.

## Antes de ligar a leitura
Os documentos vão para o motor escolhido (Claude ou OpenAI) só para leitura. O texto do aviso da tela já diz isso; se quiser, ajuste o aceite jurídico da proposta.
