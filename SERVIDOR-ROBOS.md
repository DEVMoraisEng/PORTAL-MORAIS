# Robôs do portal no servidor — instalação (fila de TESTE primeiro)

Para o Claude do servidor (desktop-siitjjp). Regras de sempre: nada de senha nem login (o dono faz);
token o dono cola direto no arquivo; **nada grava no Mais Controle** nesta etapa (a fila de teste não
grava — a exceção explícita de 05/11, `_central\TESTE_PODE_GRAVAR.txt`, está no fim deste arquivo); antes de
instalar ou criar tarefa, dizer o que vai fazer e pedir o ok.

O que já foi provado aqui (27/10): o catálogo rodou pela aba do porteiro e a sessão continuou aberta.

## 1. Atualizar o clone

```powershell
cd "C:\AUTOMAÇÕES MAIS CONTROLE\_portal"
git pull
python -m pytest -q venda/mc/testes tests/test_robo_fila.py
```
Esperado: tudo passando (121 no PC do dono).

## 2. Configuração (fora do repositório)

O dono cria o arquivo `C:\AUTOMAÇÕES MAIS CONTROLE\_central\notion-teste.txt` e cola dentro o token do
Notion da BRAIN TESTE (o mesmo dos testes). Você NÃO vê nem copia esse token.

Você cria `C:\AUTOMAÇÕES MAIS CONTROLE\_central\robos-portal.json`:

```json
{"filas": [
  {"nome": "teste",
   "db_fila": "407c5ab532d381929a0ec1ff0a69f983",
   "notion_token_arquivo": "C:\\AUTOMAÇÕES MAIS CONTROLE\\_central\\notion-teste.txt",
   "pode_gravar": false,
   "vars": {"DB_VENDAS_COND": "3f1c5ab532d381d38ba0d495b1bc8123",
            "DB_CORRETORES": "3eac5ab532d3815e9107fb5e86969bca",
            "DB_DISTRATOS": "3f3c5ab532d381bc880bd35b7e8f9653",
            "NATUREZA_DEVOLUCAO_ID": "86f2fad4-29c7-4427-8a7f-bffa4caab99b"}}
]}
```
(`407c…` = base "FILA DO ROBÔ (servidor)" da BRAIN TESTE, criada em 28/10.)

## 3. Conferir

```powershell
python servidor\robo_fila.py --verificar
```
Esperado: a fila `teste` listada com "pode gravar: não" e "porteiro: logado no Mais Controle".

## 4. Uma rodada à mão

```powershell
python servidor\robo_fila.py
```
Cria a linha "SINAL DO SERVIDOR" na fila e atende o que estiver pendente (no começo, nada). Log em
`_central\logs\robos-portal-AAAA-MM-DD.log`; saúde em `_central\robos-portal-saude.json`.

## 5. Ligar a fila no portal de teste (o dono)

No Apps Script **PORTAL-VENDA-TESTE** › Propriedades do script: `DB_FILA_ROBO` = `407c5ab532d381929a0ec1ff0a69f983`.
Sem essa Propriedade o portal continua mandando para o GitHub, como antes.

## 6. Prova

O dono, no portal de TESTE, abre a unidade 20 do condomínio e clica em **Prévia no Mais Controle**.
Você roda `python servidor\robo_fila.py` (ou espera a tarefa do passo 7). Esperado: na fila, a linha vira
FEITO; na unidade, a coluna "MC - SITUAÇÃO" mostra o resultado da prévia; `--verificar` continua dizendo
que o porteiro está logado (ninguém derrubado).

## 7. Tarefa agendada (com o ok do dono)

Use o Python que já roda aqui (caminho completo, NÃO o atalho `python` da Microsoft Store) e o
`pythonw.exe` ao lado dele, para não abrir janela a cada minuto:

```powershell
$py = (Get-Command py).Source   # confira: deve resolver para ...\Python312\pythonw.exe ao lado do python.exe
schtasks /Create /TN "MoraisEng - Robo do portal (fila)" /SC MINUTE /MO 1 /F `
  /TR "\"C:\Users\<usuario>\AppData\Local\Programs\Python\Python312\pythonw.exe\" \"C:\AUTOMAÇÕES MAIS CONTROLE\_portal\servidor\robo_fila.py\""
schtasks /Run /TN "MoraisEng - Robo do portal (fila)"
schtasks /Query /TN "MoraisEng - Robo do portal (fila)" /V /FO LIST | findstr /i "Last Result Status"
```
Esperado: `Last Result: 0` e a linha SINAL com a hora de agora. Mesma conta e "só com o usuário
conectado" da tarefa da água e energia (o Chrome do porteiro vive na sessão do usuário).

## 8. Devolver ao dono

Resumo curto: testes; `--verificar`; se a prévia da unidade 20 passou pela fila; resultado da tarefa
(`Last Result`); qualquer erro com a mensagem exata. Produção (fila de produção, índices das 9h e os
robôs MC antigos) vem depois, com outro passo a passo.

---

# PRODUÇÃO (30/10/2026) — "Lançar no Mais Controle" pelo servidor

Por quê: na produção o robô rodava no GitHub e o Mais Controle passou a pedir código de verificação
("aparelho não confiável": falta o segredo MC_ROBO_APARELHO). Pelo servidor ele usa a aba do porteiro,
já logada — sem login, sem código. Decisão do dono em 29/10.

Ordem: 1–4 o dono faz no PC dele; 5–9 o Claude do servidor faz, pedindo o ok antes de gravar ou agendar.

## 1. (dono) Mesclar o PR do robô do servidor
GitHub › DEVMoraisEng/PORTAL-MORAIS › PR "Robôs da venda pelo servidor" › Merge pull request › Confirm merge.
Sem a Propriedade DB_FILA_ROBO nada muda no portal (continua indo para o GitHub).

## 2. (dono) Publicar o PORTAL-VENDA de produção
```
py -I "C:\AUTOMAÇÕES MAIS CONTROLE\ferramentas\contrato\publicar_venda_producao.py"
```
Ele mostra "código: main da produção …", a lista (FilaRobo novo, MaisControleVenda mudado) e pede SOBE.

## 3. (dono) Criar a fila de produção no Notion
```
py -I "C:\AUTOMAÇÕES MAIS CONTROLE\_worktrees\portal-robos-servidor\servidor\criar_base_fila.py" 23ac5ab532d38191b316e262b8b59e8e "C:\AUTOMAÇÕES MAIS CONTROLE\_chaves\notion-producao-leitura.txt"
```
Sai "base criada: <id>". Guarde o id (vai nos passos 4 e 7).
(23ac… = página-mãe das bases CORRETORES e DISTRATOS da produção.)

## 4. (dono) Ligar a fila no PORTAL-VENDA de produção
Apps Script PORTAL-VENDA (produção) › Configurações › Propriedades do script › `DB_FILA_ROBO` = o id do passo 3.
A partir daqui, "Ver prévia" e "Lançar no Mais Controle" vão para a fila do servidor.

## 5. (servidor) Atualizar o clone e testar
```powershell
cd "C:\AUTOMAÇÕES MAIS CONTROLE\_portal"
git pull https://github.com/DEVMoraisEng/PORTAL-MORAIS.git main
python -m pytest -q venda/mc/testes tests/test_robo_fila.py
```

## 6. (dono, no servidor) Token da produção
Criar `C:\AUTOMAÇÕES MAIS CONTROLE\_central\notion-producao.txt` e colar dentro o token do Notion de produção
(o mesmo do arquivo `_chaves\notion-producao-leitura.txt` do PC). O Claude não vê nem copia.

## 7. (servidor) Acrescentar a fila "producao" no `_central\robos-portal.json`
Ao lado da fila "teste", com `pode_gravar: true`:
```json
{"nome": "producao",
 "db_fila": "<id do passo 3>",
 "notion_token_arquivo": "C:\AUTOMAÇÕES MAIS CONTROLE\_central\notion-producao.txt",
 "pode_gravar": true,
 "vars": {"DB_VENDAS_COND": "bfdc5ab532d3833983fc0130cffb8bac",
          "DB_CORRETORES": "<igual à variável DB_CORRETORES do GitHub de produção>",
          "DB_DISTRATOS": "<igual à variável DB_DISTRATOS do GitHub de produção>",
          "NATUREZA_DEVOLUCAO_ID": "86f2fad4-29c7-4427-8a7f-bffa4caab99b"}}
```
DB_CORRETORES e DB_DISTRATOS: o dono confere em GitHub › PORTAL-MORAIS › Settings › Secrets and variables ›
Actions › Variables (prováveis: CORRETORES 3f3c5ab532d38126836ed8b816ef2c57, DISTRATOS 3f3c5ab532d38100b62fdcfc2e380b3c).

## 8. (dono, no servidor) Chave de gravar
Gravar no ERP exige as duas chaves: o clique em "Lançar" (aplicar) E o arquivo
`C:\AUTOMAÇÕES MAIS CONTROLE\_central\VENDA_APLICAR.txt` (pode ser vazio). Sem ele, só prévia.
Só crie quando a prévia do passo 9 estiver certa.

## 9. (servidor) Conferir e provar
```powershell
python servidor\robo_fila.py --verificar
```
Esperado: filas "teste" e "producao", porteiro logado. Depois: o dono clica "Ver prévia" numa venda real
(casa 31 de teste do dono); `python servidor\robo_fila.py` (ou a tarefa do passo 7 da parte de teste, que já
roda a cada minuto e atende todas as filas). Na fila a linha vira FEITO e o cartão mostra a prévia. Com a
prévia certa, o dono cria o VENDA_APLICAR.txt e clica "Lançar no Mais Controle".

Plano B: apagar a Propriedade DB_FILA_ROBO volta tudo para o GitHub (que hoje esbarra no código de aparelho).

---

# ROBÔS QUE RODAVAM NO GITHUB (30/10/2026) — contas, bases, medições e índices pelo porteiro

Por quê: no GitHub cada robô faz login no Mais Controle — derruba quem estiver no ERP com o mesmo usuário e
esbarra no código de verificação (Bases falhou em 28/10). Os Índices falham todo dia desde 21/10 porque o Banco
Central responde 502 para os endereços do GitHub (do Brasil responde normal). No servidor, os mesmos scripts
entram pela aba do porteiro (`MC_VIA=porteiro`): `robo_mc_comum.abrir/login` viram "aba nova no Chrome do porteiro,
sem login"; o robô de contas pega o acesso da aba. A Auditoria Financeira NÃO muda: usa a API de exportação
(Senha da API), que não abre sessão.

## 1. (servidor) Atualizar o clone e testar
```powershell
cd "C:\AUTOMAÇÕES MAIS CONTROLE\_portal"
git pull https://github.com/DEVMoraisEng/PORTAL-MORAIS.git main
python -m pytest -q tests venda/mc/testes
```
Esperado: tudo passando, menos 6 testes antigos de `tests/test_robo_mc_obras.py` que já falhavam antes.

## 2. (dono) Token do GitHub só para as Medições
O robô de Medições publica `dist/mc_medicoes/contratos.json` (o Mapa de Obras lê do site). No GitHub da conta
DEVMoraisEng: Settings › Developer settings › Fine-grained tokens › Generate: repositório **só PORTAL-MORAIS**,
permissão **Contents: Read and write**, validade 1 ano. Salve no servidor em
`C:\AUTOMAÇÕES MAIS CONTROLE\_chaves\github-portal.txt`. O Claude não abre esse arquivo.

## 3. (servidor) Chave "robos" no `_central\robos-portal.json`
Ao lado de "filas":
```json
"robos": {"notion_token_arquivo": "C:\AUTOMAÇÕES MAIS CONTROLE\_chaves\notion-producao-leitura.txt",
          "github_token_arquivo": "C:\AUTOMAÇÕES MAIS CONTROLE\_chaves\github-portal.txt",
          "vars": {"CONTAS_DB_ID": "3e4c5ab532d380afbd3bf9f7af31d2a7", "MC_CRED": "robo",
                   "DB_VENDAS_COND": "<id da VENDAS CONDOMÍNIO>"}}
```

### Robô `retratos` (31/10/2026, antecipação e aba Financeiro)
Lê, no Mais Controle, cada venda da base BANCO DE DADOS VENDAS CONDOMÍNIO que já tem "MC - VENDA ID" e grava o
"retrato" (parcelas, valores, fatores, pagas) em "MC - RETRATO" e a hora em "MC - RETRATO EM". **Só lê o ERP**
(nunca grava nele; `ROBOS_APLICAR.txt` não muda nada aqui). Se a leitura falha e já existe um retrato bom, ele é
mantido e só "MC - RETRATO EM" ganha `<hora do último bom> | ERRO <agora>: <motivo>`. Se nunca houve retrato bom, "MC - RETRATO"
fica com `ERRO: <motivo>` e "MC - RETRATO EM" com ` | ERRO <agora>: <motivo>` (sem hora de leitura na frente). Log: "retratos: N ok, M erro".
**Premissa do fuso:** a hora gravada é a hora local do servidor (`datetime.now()`), e o portal compara o mês dela com o mês de hoje
em America/Sao_Paulo. O servidor precisa estar no fuso de Brasília/Goiânia (UTC-3); em outro fuso a leitura da virada do mês
(e a das 05:00) cairia no mês errado e a tela pediria "Ler de novo" sem necessidade.
Script: `robo_mc_retratos.py` (chama `python -m venda.mc.retrato --todas`). Tarefa agendada: todo dia às
08:00, `python servidor\robo_fila.py --robo retratos`. **A chave "robos" de `robos-portal.json` precisa de
`DB_VENDAS_COND` em "vars"** (id da base de vendas do condomínio), senão o robô sai com código 2 e avisa o motivo.
A fila também precisa de `DB_VENDAS_COND` em "vars" para o retrato depois do Lançar: depois de gravar uma venda
(lançar ou distrato com `--aplicar`, código 0), o robô da fila roda `venda.mc.retrato --todas` com o mesmo ambiente. Sem a chave o retrato
sai com código 2 (só vai para o log) e o pedido continua FEITO. Prévia, bloqueado e `mc-retrato` não disparam essa leitura.

## 4. (servidor) Rodada de prova, SEM gravar
Sem o arquivo `_central\ROBOS_APLICAR.txt` os robôs só simulam (como o GitHub sem APLICAR).
**Exceção: `--robo retratos` GRAVA no Notion** (as colunas "MC - RETRATO" e "MC - RETRATO EM" das vendas do condomínio), com ou sem
`ROBOS_APLICAR.txt`; ele só não grava no ERP (nunca grava). Rode esse com a certeza de que pode mexer nessas duas colunas:
```powershell
python servidor\robo_fila.py --robo bases
python servidor\robo_fila.py --robo contas
python servidor\robo_fila.py --robo medicoes
python servidor\robo_fila.py --robo retratos
python servidor\robo_fila.py --indices
python servidor\robo_fila.py --verificar
```
Cada um escreve no log de hoje (`_central\logs\robos-portal-AAAA-MM-DD.log`) a linha "código 0" e o fim da saída.
O `--verificar` no fim tem que continuar dizendo "porteiro: logado" (ninguém derrubado).

## 5. (dono) Ligar a gravação
Com a prova certa: criar `_central\ROBOS_APLICAR.txt` (vazio) — é o mesmo "APLICAR" que o GitHub usava.
Índices gravam com `_central\INDICES_APLICAR.txt` (também do dono).

## 6. (servidor, com o ok do dono) Tarefas agendadas
Mesmo Python (`pythonw.exe`, caminho completo), mesma conta e "só com o usuário conectado" da tarefa da fila:
| Tarefa | Quando | Comando |
|---|---|---|
| MoraisEng - Robo contas | todo dia 06:23 | `robo_fila.py --robo contas` |
| MoraisEng - Robo bases | todo dia 07:17 | `robo_fila.py --robo bases` |
| MoraisEng - Robo medicoes | seg a sáb, 07:20 a 19:20 de 2 em 2 h | `robo_fila.py --robo medicoes` |
| MoraisEng - Robo retratos | todo dia 08:00 | `robo_fila.py --robo retratos` |
| MoraisEng - Robo indices | todo dia 09:00 | `robo_fila.py --indices` |
Rodar cada uma uma vez (`schtasks /Run`) e mostrar o `Last Result`.

## 7. (dono, depois de 1 dia certo no servidor) Desligar o horário no GitHub
No GitHub, Actions › cada workflow (Robôs Mais Controle, Robô MC - Bases no Notion, Robô MC - Medições, Índices
de reajuste) › "…" › **Disable workflow**. O botão de rodar à mão volta quando reabilitar (plano B).

---

# ANEXOS DOS PAGAMENTOS (03/11/2026) — 📎 na Auditoria Financeira

O robô `robo_mc_anexos.py` lê, pela aba do porteiro, os arquivos dos pagamentos que a Auditoria Financeira
mostra com alerta (últimos 90 dias): os do **lançamento** (boleto, NF, recibo) e os da **baixa/pagamento**
(comprovante). **Só lê o Mais Controle — não grava nada no ERP.** Os links vão para a chave `anexos` do
`auditoria.json` (bucket privado `analise` do Supabase ORÇADO/REALIZADO); a tela mostra o 📎 na linha.

Ordem: 1 o dono faz; 2–6 o Claude do servidor faz, pedindo o ok antes de agendar.

## 1. (dono, no servidor) Chave do Supabase
Criar `C:\AUTOMAÇÕES MAIS CONTROLE\_central\supabase-analise.txt` e colar dentro a **service key** do projeto
ORÇADO/REALIZADO (a mesma do secret `SUPABASE_SERVICE_KEY` do GitHub). O Claude não vê nem copia.

## 2. (servidor) Atualizar o clone e testar
```powershell
cd "C:\AUTOMAÇÕES MAIS CONTROLE\_portal"
git pull https://github.com/DEVMoraisEng/PORTAL-MORAIS.git main
python -m pytest -q tests/test_robo_mc_anexos.py tests/test_robo_fila.py
```

## 3. (servidor) Configuração — chave `robos` do `_central\robos-portal.json`
Acrescentar (sem apagar o que já existe):
```json
"supabase_key_arquivo": "C:\\AUTOMAÇÕES MAIS CONTROLE\\_central\\supabase-analise.txt",
```
e, dentro de `"vars"`: `"SUPABASE_URL": "https://mgxjmqanrpomvqkzulbe.supabase.co"`.

## 4. (servidor) Descoberta — só formato, não grava nada
```powershell
$env:DESCOBRIR="1"; python servidor\robo_fila.py --robo anexos; Remove-Item Env:DESCOBRIR
```
Devolver ao dono a saída inteira (só tem chaves, contagens e a validade do link — nenhum nome ou valor).
O esperado (desde 82f5519 o nº do lançamento é traduzido para o UUID pela lista
`/payable-installments/paginated-result`): `campo com o nº do lançamento: <caminho>` (não "NÃO ACHADO"),
`lançamentos do escopo achados` > 0, em cada lançamento `tradePayable: uuid · baixas: N · arquivos: N`,
`get-url: link ok`, e a última linha `OK: N lançamento(s) lido(s) na descoberta.` Desde a 2ª descoberta (03/11, tarde) a
lista exige centro de custo: o robô copia os parâmetros do pedido que a própria tela do porteiro fez
(linha `pedido da lista feito pela tela do porteiro: {…}` — só nomes e a forma dos valores) e mostra cada forma
tentada (`forma '…': N página(s), N do escopo`). Se falhar, a última linha é
`FALHOU: … — <causa>` e o bloco "erros por rota (todos)" mostra o erro de cada rota; o código de saída é 1.

## 5. (servidor) Primeira rodada de verdade
```powershell
python servidor\robo_fila.py --robo anexos
```
A última linha do log diz quantos lançamentos foram lidos, quantos têm arquivo e quantos foram copiados.
A primeira rodada pode levar até ~20 min (até 700 lançamentos); as seguintes só leem os pagamentos recentes
e renovam os links.

## 6. (servidor, com o ok do dono) Tarefa agendada — todo dia 05:20 e 12:20
Depois do robô da auditoria da madrugada (GitHub, 04:23). Mesma conta e "só com o usuário conectado".
```powershell
schtasks /Create /TN "MoraisEng - Anexos da auditoria" /SC DAILY /ST 05:20 /F `
  /TR "\"C:\Users\<usuario>\AppData\Local\Programs\Python\Python312\pythonw.exe\" \"C:\AUTOMAÇÕES MAIS CONTROLE\_portal\servidor\robo_fila.py\" --robo anexos"
schtasks /Create /TN "MoraisEng - Anexos da auditoria (tarde)" /SC DAILY /ST 12:20 /F `
  /TR "\"C:\Users\<usuario>\AppData\Local\Programs\Python\Python312\pythonw.exe\" \"C:\AUTOMAÇÕES MAIS CONTROLE\_portal\servidor\robo_fila.py\" --robo anexos"
```
Ajustes opcionais em `"vars"`: `ANEXOS_DIAS` (90), `ANEXOS_ESCOPO` (`alertas` ou `todos`),
`ANEXOS_MAX_ITENS` (700 por rodada), `ANEXOS_MAX_MB` (250 MB copiados por rodada — só quando o link do MC
for curto e o arquivo precisar ser copiado para o Supabase).

---

# FILA DE TESTE GRAVANDO DE VERDADE (05/11/2026) — 1º teste da casa de rua assinada

O dono aprovou: o primeiro processo inteiro da casa de rua (assinou → contrato no Orçamento → prévia → venda
lançada sozinha) roda pelo portal de TESTE gravando de verdade no Mais Controle; ele exclui depois. Deu certo, sobe
para produção. Detalhe do processo: `venda/COMO-IMPLANTAR.md`, "Casa de rua: contrato assinado vai ao Orçamento".

## A terceira chave: `_central\TESTE_PODE_GRAVAR.txt`
A fila "teste" grava no ERP **só** com as três ao mesmo tempo:
1. `"pode_gravar": true` na fila "teste" do `_central\robos-portal.json`;
2. o arquivo `C:\AUTOMAÇÕES MAIS CONTROLE\_central\VENDA_APLICAR.txt` (o mesmo da produção);
3. o arquivo `C:\AUTOMAÇÕES MAIS CONTROLE\_central\TESTE_PODE_GRAVAR.txt` (pode ser vazio) — só o dono cria e apaga.
Sem o 3º, nada muda: a fila de teste faz prévia e o lançamento volta "BLOQUEADO". A produção não depende dele. O
"Rodar de novo" do Escritório continua recusado na fila de teste. O `--verificar` mostra "pode gravar: SIM" e um
"ATENÇÃO" enquanto o arquivo existir.

## Passo a passo do 1º teste ao vivo
1. (servidor) `git pull` no clone `_portal` e `python -m pytest -q venda/mc/testes tests` (as falhas antigas de
   `test_robo_mc_obras.py` e o `test_na_vez_espera…`, que pede `fcntl`, já falhavam antes).
2. (servidor) fila "teste" no `robos-portal.json`: `"pode_gravar": true` e, em `"vars"`, `DB_CORRETORES` da BRAIN
   TESTE (e `DB_VENDAS_COND` do teste, como já está).
3. (dono, no servidor) criar `_central\VENDA_APLICAR.txt` (se ainda não existe) e `_central\TESTE_PODE_GRAVAR.txt`.
4. (servidor) `python servidor\robo_fila.py --verificar` → fila teste "pode gravar: SIM" + "ATENÇÃO".
5. (dono, no Mais Controle) a obra da casa de teste com o nome IGUAL ao ENDEREÇO da casa, com conta padrão, e no
   Orçamento dela, Arquivos, a pasta **Contratos Venda**.
6. (dono, PORTAL-VENDA de teste) colar os 4 arquivos .gs do COMO-IMPLANTAR, Propriedades `MC_LANCAR_AO_ASSINAR` = SIM,
   `DB_FILA_ROBO` (fila de teste), `DB_VENDAS`, `ASSINATURA_AVISO_EMAILS`; publicar a mesma implantação.
7. Enviar o contrato de uma casa de rua de teste para a Clicksign (sandbox) e assinar com todos.
8. Esperar a vigia (15 min, 7h–21h) ou clicar Atualizar situação: a situação mostra `PROCESSANDO (prévia)` e
   `Contrato no Orçamento: pedido ao robô`; em ~1 min a prévia e `Contrato no Orçamento: enviado …`; na volta seguinte
   da vigia, `PROCESSANDO (lançamento)` e depois `CRIADA | venda …` com `Contrato: anexado no recebimento`.
9. Conferir no Mais Controle: venda da casa, contrato no recebimento e na pasta Contratos Venda do Orçamento.
10. (dono) **apagar `_central\TESTE_PODE_GRAVAR.txt`** e excluir no ERP a venda e o cliente de teste.
Parou no meio? A situação tem a linha `Lançamento automático: parou …` e chega um e-mail; nada é repetido sozinho.

## Depois, produção
PORTAL-VENDA de produção: os mesmos 4 .gs e `MC_LANCAR_AO_ASSINAR` = SIM (atenção: a mesma Propriedade já liga o
lançamento do condomínio com prévia OK). Servidor: nada a mais (a fila "producao" já tem `pode_gravar` e o
VENDA_APLICAR.txt).
# DOCUMENTOS DO ORÇAMENTO (05/11/2026) — matrícula, certidão mãe, alvará e habite-se no dossiê do imóvel

Pedido do dono (05/11/2026): em Obras › Orçamento do Mais Controle há matrículas, certidões etc. anexadas; um vigia
no servidor, todo dia cedo, busca lá e anexa sozinho no dossiê do imóvel da casa de rua quando aparecer.
Robô `documentos` = `robo_mc_documentos.py` (lógica em `venda/mc/documentos_obra.py`). Só LÊ o ERP, só pelo porteiro.

O que faz, para cada casa de rua da VENDAS com `CLIENTES` preenchido, sem `ASSINATURA - SITUAÇÃO` = ASSINADO e fora
do condomínio: acha a obra do MC pelo nome = ENDEREÇO; lê as pastas do Orçamento (`GET /folder?id=<obra>&origin=PLANNING`);
classifica cada arquivo pelo nome do arquivo (sem pista nele, pelo da pasta); baixa pelo link do MC
(`GET /file/{id}/get-url`) e sobe ao Notion no espaço do imóvel; marca "novo, não lido" e escreve na observação.
Nome que aponta para dois documentos ("alvará e habite-se") fica **pendente** no relatório (ninguém anexa no chute).
Na **primeira** olhada de cada casa, espaço que já tem documento não recebe (só anota o arquivo como visto); dali em
diante todo arquivo novo do MC entra. Nunca apaga nem troca arquivo. PDF até 10 MB e imagem até 5 MB (o que a IA lê).

## 1. (dono) Colunas novas na VENDAS (teste e produção) — todas **texto**
- `DOSSIÊ IMÓVEL - NOVOS DO MAIS CONTROLE` — o robô escreve os espaços anexados; o portal passa para os "novos" e limpa;
- `MC - DOCUMENTOS DO ORÇAMENTO` — ids dos arquivos do MC já vistos (JSON). **Sem ela o robô não anexa** (anexaria de
  novo todo dia) — o relatório mostra `sem_coluna_vistos`;
- `VENDEDOR MC - NOME`, `VENDEDOR MC - CPF/CNPJ`, `VENDEDOR MC - ENDEREÇO`, `VENDEDOR MC - E-MAIL` — o proprietário da
  obra no MC (o contrato usa só para completar o vendedor; ver venda/COMO-IMPLANTAR.md "Vendedor automático");
- as colunas de arquivo do imóvel já existem (`IMÓVEL - MATRÍCULA`, `IMÓVEL - CERTIDÃO MÃE`, `IMÓVEL - ALVARÁ`,
  `IMÓVEL - HABITE-SE`, `DOSSIÊ IMÓVEL - OBSERVAÇÃO`).
E colar o `PortalVenda`/`RegrasVenda` novos no PORTAL-VENDA (é ele que transforma a coluna de novos em "novo, não lido").

## 2. (servidor) Atualizar o clone e testar
```powershell
cd "C:\AUTOMAÇÕES MAIS CONTROLE\_portal"; git pull
python -m pytest venda\mc\testes\test_documentos_obra.py -q
```

## 3. (servidor) Configuração — chave `robos` do `_central\robos-portal.json`
Em `"vars"`: `"DB_VENDAS": "<id da BANCO DE DADOS VENDAS>"` (o da produção; para provar no teste, o da VENDAS TESTE
com o token do teste). O token do Notion é o `notion_token_arquivo` que os outros robôs já usam.

## 4. (servidor) Rodada de prova, SEM gravar
Sem `_central\ROBOS_APLICAR.txt` o robô só simula:
```powershell
python servidor\robo_fila.py --robo documentos
Get-Content "C:\AUTOMAÇÕES MAIS CONTROLE\_central\logs\saida-documentos.txt"
```
Esperado: `casas de rua com venda aberta: N · obra achada no MC: M`, `arquivos a anexar: …` e a última linha
`OK: documentos do orçamento — … (SIMULAÇÃO: …)`. `pendência: <8 letras> sem_obra` = casa sem obra com o mesmo nome no
MC; `obra_ambigua` = duas obras com o mesmo nome; `… nome ambíguo` = conferir o nome do arquivo no Orçamento.

## 5. (dono) Ligar a gravação
O mesmo `_central\ROBOS_APLICAR.txt` dos outros robôs (se já existe, a próxima rodada já grava).

## 6. (servidor, com o ok do dono) Tarefa agendada — todo dia 05:50
Mesma conta e "só com o usuário conectado" (o porteiro precisa do Chrome aberto). Um robô de cada vez no MC: se outro
estiver lá, este espera a vez (`robo-mc-vez.trava`).
```powershell
schtasks /Create /TN "MoraisEng - Documentos do Orçamento" /SC DAILY /ST 05:50 /F `
  /TR "\"C:\Users\<usuario>\AppData\Local\Programs\Python\Python312\pythonw.exe\" \"C:\AUTOMAÇÕES MAIS CONTROLE\_portal\servidor\robo_fila.py\" --robo documentos"
```
O Escritório de Robôs mostra a mesa "Documentos do Orçamento"; o Coordenador o põe por último na fila (`ORDEM`).

# RECEBIMENTOS DA CASA DE RUA (05/11/2026) — baixa do sinal e parcelas de financiamento/FGTS

Pedido "mc-recebimento" (aba Recebimentos do painel da casa) → `venda/mc/recebimentos.py`. Dá baixa de cada pagamento
do sinal/entrada registrado no portal (com o comprovante na pasta de arquivos da venda) e acerta as parcelas de sinal,
financiamento e FGTS quando o valor mudou (guarda a venda inteira antes em `_central\backups-vendas\`, relê e confere;
se não bater, grava de volta e avisa). Rotas que gravam e o que conferir ao vivo: comentário em `venda/mc/erp.py`.

Trava PRÓPRIA (vale também na fila "teste" — o dono pediu o 1º processo inteiro no teste gravando de verdade):
`"pode_gravar_recebimento": true` na fila do `_central\robos-portal.json` **e** o arquivo
`C:\AUTOMAÇÕES MAIS CONTROLE\_central\RECEBIMENTO_APLICAR.txt` (só o dono cria). Sem os dois, só prévia (o texto
diz o que faria). O `VENDA_APLICAR.txt` não entra nesta conta.

## 1. (dono) Colunas no Notion de TESTE
`py -3.14 venda/ferramentas/criar_colunas_recebimentos.py <id da VENDAS de teste> <arquivo do token>` (só mostra) e depois
com `--criar`. Publicar o PORTAL-VENDA de teste com RecebimentoVenda.gs, RegrasVenda.js, OpenAILeitor.js, ClaudeLeitor.js,
PortalVenda.gs e LogContratoVenda.js.

## 2. (servidor) Prévia
Atualizar o clone e rodar `python -m pytest -q venda/mc/testes tests/test_robo_fila.py`. Numa casa de TESTE já lançada
(MC - VENDA ID), registrar no portal o sinal em dois pagamentos (ex.: 3 mil + 2 mil, um com comprovante em PDF).
Sem a trava, a coluna MC - RECEBIMENTOS mostra "prévia: baixaria …" e qual conta usaria.

## 3. (dono) Ligar a gravação só no teste
`"pode_gravar_recebimento": true` na fila "teste" + criar o `RECEBIMENTO_APLICAR.txt`. Clicar "Conferir no Mais Controle".

## 4. Conferir na venda de teste do Mais Controle (centavo por centavo)
- duas baixas parciais na parcela do sinal (valor e data do portal), parcela "em aberto" depois da 1ª e quitada depois da 2ª;
- conta: a do comprovante quando o PDF tem agência e conta de uma conta do Mais Controle; senão a padrão da venda;
- comprovante na pasta "Arquivos" da venda com o nome `COMPROVANTE SINAL <data> <id>.pdf`;
- mudar o valor do FGTS na aba (ou ler um contrato de financiamento de teste): parcela de FGTS criada/alterada, total da
  venda igual à soma das parcelas, backup em `_central\backups-vendas\`;
- pedir "Conferir" de novo: nada é baixado duas vezes.
Se algo divergir, anotar o CORPO da resposta do ERP (log do servidor) e corrigir a rota em `erp.py` antes da produção.

## 5. (dono) Produção
Só depois do teste certo: colunas na VENDAS de produção, publicar o PORTAL-VENDA de produção e ligar a trava na fila "producao".

---

# BOLETOS DO MÊS (06/11/2026) — Reserva dos Ipês pela Cobrança Fácil

O robô `robo_mc_boletos.py` lê as parcelas a receber do mês vigente, fica só com as vendas do CONDOMÍNIO RESERVA DOS IPÊS
e emite o boleto de cada parcela que a regra manda emitir (1 crédito da Cobrança Fácil por boleto). Entra na fila do servidor
como os outros robôs: `ROBOS["boletos"]` em `servidor/robo_fila.py`, um de cada vez no Mais Controle (`na_vez`).

Comando (à mão, na pasta do clone):
```powershell
python servidor\robo_fila.py --robo boletos
```
Por baixo ele roda `robo_mc_boletos.py --emitir`, e só emite com o interruptor do item 3 e só no mês de hoje.
**Prévia (só ver a lista):** rode o mesmo comando enquanto `_central\BOLETOS_APLICAR.txt` NÃO existe; o robô então só
monta o relatório, esperando a vez no Mais Controle como os outros. Não rode `robo_mc_boletos.py` direto.

## 1. (servidor) Atualizar o clone e testar
Como na seção dos robôs que rodavam no GitHub: `git pull` no clone e `python -m pytest -q tests venda/mc/testes`.
No servidor (Windows) a suíte já mostra 7 falhas antigas que não são dos boletos (1 em `tests/test_robo_fila.py`, 6 em
`tests/test_robo_mc_obras.py`); "7 failed" com o resto passando está certo.
Não precisa de chave nova em `robos-portal.json`; o porteiro (Chrome logado no Mais Controle) é o mesmo dos outros robôs.

## 2. (servidor, com o ok do dono) Tarefa agendada — dias úteis às 10:00
Mesmo Python, mesma conta e "só com o usuário conectado" das outras tarefas. No Windows PowerShell 5.1 o `schtasks /TR`
com aspas internas (`\"`) quebra ("Argumento/opção inválido"); use os comandos do próprio PowerShell (assim foi criada em 07/11/2026):
```powershell
$a = New-ScheduledTaskAction -Execute "C:\Users\<usuario>\AppData\Local\Programs\Python\Python312\pythonw.exe" -Argument '"C:\AUTOMAÇÕES MAIS CONTROLE\_portal\servidor\robo_fila.py" --robo boletos' -WorkingDirectory "C:\AUTOMAÇÕES MAIS CONTROLE\_portal"
$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 10:00
Register-ScheduledTask -TaskName "MoraisEng - Boletos do mes" -Action $a -Trigger $t -Force
(Get-ScheduledTask -TaskName "MoraisEng - Boletos do mes").Actions | Format-List Execute, Arguments, WorkingDirectory
```
O Escritório dos Robôs mostra a mesa "Boletos do mes" como as outras (pelo relatório de rodada), e o botão "Rodar de novo"
(ADM e MASTER) dispara a mesma tarefa fora do horário, por exemplo depois de corrigir um cadastro. Se a rodada agendada e a
manual coincidirem, a segunda espera a primeira (`robo-mc-vez.trava`) e, ao rodar, relê as parcelas: as que já têm boleto
são puladas. Boleto que ficou SEM_CONFIRMACAO numa rodada não é pedido de novo nas rodadas seguintes do mês: o robô o
segura em "decidir" ("emissão sem confirmação em <data>: conferir no Mais Controle antes de emitir"). Confira no Mais
Controle; se o boleto não existir mesmo, emita pela tela.

## 3. Ligar e desligar a emissão (o dono)
- **Ligar:** criar o arquivo `_central\BOLETOS_APLICAR.txt` (vazio). Pelo Bloco de Notas, salvar com o tipo
  "Todos os arquivos", para não virar `BOLETOS_APLICAR.txt.txt`.
- **Desligar:** apagar o arquivo. Vale na hora, até no meio de uma rodada (é conferido antes de cada boleto).
- Sem o arquivo a rodada só monta o relatório (prévia), mesmo agendada.

## 4. Relatório e primeiro boleto
- Relatório de cada rodada: `_central\boletos\AAAA-MM-DD_HHMMSS.json` e `.html`, fora do repositório (leva nome e valor).
  O log público só tem contagens e 8 letras de id.
- Primeiro boleto, com cuidado: criar o arquivo do item 3 e rodar uma vez com só uma parcela, pelo id dela:
```powershell
$env:BOLETOS_SO = "<id da parcela>"
python servidor\robo_fila.py --robo boletos
Remove-Item Env:BOLETOS_SO
```
  Conferir no relatório e no Mais Controle (boleto "Em processamento" e depois "Boleto emitido") antes de deixar a tarefa rodar solta.
- Códigos de saída: 0 tudo certo · 1 houve recusado ou sem confirmação · 2 trava (saldo, teto, interruptor desligado no
  meio ou mês que não é o de hoje) · 3 ERP fora. Na saída do robô vem, antes das contagens, `trava: <motivo>` quando uma
  trava parou a emissão e `índice faltando: <lista>` quando faltou índice (sem nome nem valor).

## 5. Regras (resumo)
- Só o CONDOMÍNIO RESERVA DOS IPÊS e só o mês vigente (o INCC do mês só está corrigido para ele).
- Emite: sinal de 30/60/90 dias, entrada, pré-chaves, pós-chaves e balões (intermediária e balão de entrega de chaves).
- Nunca emite: ato (1º sinal, sempre por Pix), financiamento, FGTS e permuta. Tipo desconhecido vai para "decidir".
- Novembro/2026: o boleto só sai a partir de 5 dias corridos antes do vencimento. De dezembro/2026 em diante, o mês inteiro.
- Parcela do mês já vencida e sem boleto não emite: só avisa no relatório ("decidir").
- Confere as tabelas INCC-M e IPCA do mês. Se faltar índice, só pré-chaves, pós-chaves e balões vão para "decidir"
  (o motivo diz qual índice falta); sinal e entrada saem normalmente e o código continua 0. Ver o relatório.
- Antes de emitir qualquer um, confere se o saldo de créditos cobre a lista toda. Se não cobrir, não emite nada
  (código 2, `trava: saldo ...`); o motivo completo fica no relatório.
- Teto de 62 boletos por rodada; acima disso não emite nada e pede para olhar.

# PÁGINA BOLETOS E FINANCEIRO (09/11/2026)

Página `boletos-financeiro.html` do portal: boletos do mês e financeiro por unidade do Reserva dos Ipês. O servidor monta o
arquivo (`servidor/boletos_portal.py`) e sobe para `robos/boletos-financeiro.json` no bucket privado `analise`, depois da rodada
de boletos, da leitura dos retratos e de cada Segurar ou Soltar. O link sai do `apps-script/BoletosFinanceiro.gs`, que confere o
acesso `BOLETOS E FINANCEIRO` da coluna ACESSOS.

- **Parcelas seguradas:** `_central\boletos\seguradas.json`. O robô de boletos não emite parcela que esteja nele e confere o
  arquivo antes de cada boleto. Arquivo ilegível = o robô não emite nada e mostra a trava. Para soltar sem o portal, apague a parcela
  do arquivo deixando o JSON válido.
- **Último financeiro bom:** `_central\financeiro-condominio.json`, usado quando o Notion falha.
- **Pedidos:** Segurar e Soltar entram na FILA DO ROBÔ com o tipo `boleto-segurar`; Atualizar agora usa o `robo-rodar` da tarefa
  `MoraisEng - Robo retratos`. A fila de teste não segura boleto.
