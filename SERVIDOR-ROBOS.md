# Robôs do portal no servidor — instalação (fila de TESTE primeiro)

Para o Claude do servidor (desktop-siitjjp). Regras de sempre: nada de senha nem login (o dono faz);
token o dono cola direto no arquivo; **nada grava no Mais Controle** nesta etapa (a fila de teste nunca
grava); antes de instalar ou criar tarefa, dizer o que vai fazer e pedir o ok.

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
