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
