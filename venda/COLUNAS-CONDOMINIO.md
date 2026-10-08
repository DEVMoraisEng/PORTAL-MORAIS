# Colunas da BANCO DE DADOS VENDAS CONDOMÍNIO para a tela de venda (entrega 7)

Desde a `venda-v4`, o cartão da unidade na "Planilha Casas Condomínio" (vendas.html)
gera o contrato, manda para assinatura e lança no Mais Controle **direto na linha do
condomínio** — sem criar a casa na VENDAS. O retorno de cada ação é gravado em
colunas da própria linha. O nome é comparado sem acento, caixa ou espaço sobrando.

## Colunas novas (criar na base)

| Coluna | Tipo no Notion | Quem grava | Para quê |
|---|---|---|---|
| `CONTRATO GERADO` | Arquivos e mídia | PORTAL-VENDA (Gerar contrato) | PDF do contrato gerado (o último é o que vale; o nome leva o carimbo `[#xxxxxxxx]`) |
| `CONTRATO ASSINADO` | Arquivos e mídia | PORTAL-VENDA (Atualizar situação da assinatura) | PDF assinado que a Clicksign devolve; o robô do Mais Controle anexa este no recebimento |
| `ASSINATURA - ENVELOPE ID` | Texto | PORTAL-VENDA (Enviar para assinatura) | id do envelope na Clicksign |
| `ASSINATURA - SITUAÇÃO` | Texto | PORTAL-VENDA | RASCUNHO / ENVIADO / ASSINADO / RECUSADO / CANCELADO / EXPIRADO |
| `MC - SITUAÇÃO` | Texto | PORTAL-VENDA (PROCESSANDO…) e o robô do Mais Controle | resultado da prévia/lançamento |
| `MC - VENDA ID` | Texto | robô do Mais Controle | id da venda criada no ERP (preenchida = já lançada) |

Coluna ausente (ou de outro tipo) não quebra nada em silêncio: a ação responde
`COLUNA_FALTANDO: <nome>` (ou `TIPO_DE_COLUNA_ERRADO`) e a tela mostra "A base não
tem a coluna … — avise o desenvolvedor".

## Colunas que já existem e passam a ser lidas pela tela de venda

| Coluna | Uso |
|---|---|
| `UNIDADE` (título) | número da casa (contrato e descrição "VENDA UNIDADE NN - NOME" no Mais Controle) |
| `CONDOMÍNIO` | endereço "CONDOMÍNIO <nome>": obra em DOCUMENTOS, empreendimento em LOTEAMENTOS – CONTRATO e centro de custo no Mais Controle |
| `PROPONENTE`, `CPF PROPONENTE`, `RG PROPONENTE`, `PROFISSÃO PROPONENTE`, `NACIONALIDADE PROPONENTE`, `ESTADO CIVIL`, `Email`, `Nº Whatsapp`, `ENDEREÇO`/`NÚMERO`/`SETOR`/`CIDADE`/`CEP` | comprador 1 |
| `COMPRADOR 1` e o bloco `… COMPRADOR 1` | comprador 2 do contrato, quando o nome é diferente do PROPONENTE |
| `VALOR DE VENDA`, `VALOR DO CRÉDITO`, `VALOR DO FGTS`, `SUBISÍDIO`, `DATA DA VENDA` | valores e data da venda |
| `CORRETOR`, `CRECI`, `CPF CORRETOR`, `EMAIL CORRETOR`, `CELULAR CORRETOR`, `IMOBILIÁRIA` | corretor (contrato e vendedor no Mais Controle) |
| fluxo (`DATA DE ASSINATURA DO CONTRATO`, `DIA PAGAMENTO PARCELAS`, `DATA DA ENTREGA`, sinais, pré-chaves, balões, pós-chaves) | item 6.1 do contrato e parcelas no Mais Controle |
| `FIADOR 1/2` e o bloco de cada fiador | fiadores do contrato |
| `CONTRATO - ÁREA PRIVATIVA (M²)`, `CONTRATO - FRAÇÃO IDEAL`, `CONTRATO - MATRÍCULA INDIVIDUAL`, `CONTRATO - CRI DA MATRÍCULA`, `CONTRATO - ALVARÁ Nº`, `CONTRATO - ALVARÁ DATA`, `CONTRATO - PRAZO DE CONCLUSÃO DAS OBRAS`, `CONTRATO - CONDIÇÕES ESPECIAIS` | imóvel no contrato (em branco sai `____` e vira aviso) |

A comissão do condomínio é sempre paga pelo vendedor (decisão do dono, 07/10/2026):
não precisa de `CONTRATO - COMISSÃO PAGA POR` na linha.
