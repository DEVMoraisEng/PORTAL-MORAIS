# Base DISTRATOS (Notion) — esquema

Arquivo de todo distrato dado pelo portal (entrega 8, pedido do dono de 07/10/2026). Uma linha por
distrato, criada pelo Code.gs (ação `distrato`) ANTES de limpar a venda. Se a base não existir, não
estiver na Propriedade `DB_DISTRATOS` ou faltar coluna, o distrato RECUSA e não limpa nada.

Crie a base com EXATAMENTE estes nomes (maiúsculas/acentos não importam; o tipo importa):

| Coluna | Tipo no Notion | Quem preenche | Conteúdo |
|---|---|---|---|
| (título — qualquer nome, ex.: `DISTRATO`) | Título | portal | `ENDEREÇO - CASA N - dd/mm/aaaa` |
| `DATA` | Data | portal | data e hora do distrato |
| `FEITO POR` | Texto | portal | login de quem confirmou com a senha |
| `MOTIVO` | Texto | portal | motivo escrito na tela |
| `HOUVE SINAL` | Seleção | portal | `SIM` / `NÃO` |
| `DESTINO DO SINAL` | Seleção | portal | `RETIDO` / `DEVOLVIDO` / `NÃO HOUVE` |
| `VALOR A DEVOLVER` | Número | portal | só quando DEVOLVIDO: valor que a prévia mostrou |
| `DATA DA DEVOLUÇÃO` | Data | portal | só quando DEVOLVIDO: vencimento que a prévia mostrou |
| `ENDEREÇO` | Texto | portal | endereço da venda |
| `CASA` | Texto | portal | casa |
| `VENDA - PAGE ID` | Texto | portal | id da página da venda na base VENDAS (a página continua lá, limpa) |
| `MC - VENDA ID` | Texto | portal | id da venda no Mais Controle (vazio = robô não lançou) |
| `PRÉVIA ACEITA` | Texto | portal | o texto da prévia do robô que a pessoa viu e confirmou (com a assinatura `[#xxxxxxxx]`) |
| `MC - DISTRATO` | Texto | portal, depois o robô | `PROCESSANDO…` → `DISTRATO APLICADO — …` / `DISTRATO RECUSADO: …` / `DISTRATO ERRO: …` / `BLOQUEADO: …` |
| `ARQUIVOS` | Arquivos e mídia | portal | CÓPIA de todos os arquivos das colunas de arquivo da venda (nome = `COLUNA - arquivo`); links externos vão como link |

As opções das seleções o Notion cria sozinho na primeira gravação (pode criar antes, com estes nomes).

**Corpo da página**: lista com cada coluna preenchida da venda (`COLUNA: valor`) e a mesma cópia em JSON
(bloco de código). Colunas vazias não entram. Arquivos aparecem pelo nome (a cópia está em `ARQUIVOS`).

**Na base VENDAS** (e na VENDAS de teste) crie também a coluna `MC - DISTRATO` (Texto): é onde o robô
escreve a PRÉVIA do distrato. Ela é limpa junto com o resto no distrato (fica copiada no arquivo).

Permissões: a integração do Notion que o portal usa (a mesma do `NOTION_TOKEN`) e a do robô do GitHub
precisam ter acesso à base DISTRATOS (menu `•••` da base → Conexões). Ids/nomes reais NÃO entram neste
repositório (é público).
