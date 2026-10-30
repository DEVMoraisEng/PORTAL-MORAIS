# Morais Royale no servidor da empresa (aba Entretenimento)

Para o Claude do servidor (desktop-siitjjp) ou para o dono. Regras de sempre: nada de senha nem login
(o dono faz); antes de instalar ou criar tarefa, dizer o que vai fazer e pedir o ok.

O que vai rodar: `MoraisRoyale.exe` (servidor do jogo, Node empacotado, sem instalar nada). Ele fica
ouvindo na porta **7777**, e o **Tailscale Funnel** publica essa porta num endereço `https://` fixo,
que funciona no Wi-Fi do escritório e no celular fora (4G). A aba **Entretenimento** do portal abre o
jogo já logado com a sessão do portal.

## 1. Pasta do jogo

Criar `C:\MORAIS-ROYALE\` e copiar para dentro o `MoraisRoyale.exe` (vem no `MoraisRoyale.zip` que o
dono recebeu do Claude). As contas, níveis e skins vão ficar em
`C:\MORAIS-ROYALE\morais-royale-contas.json` (criado sozinho; é o arquivo para backup).

## 2. Configuração

Criar `C:\MORAIS-ROYALE\morais-royale-config.json`:

```json
{
  "porta": 7777,
  "abrir_navegador": false,
  "so_portal": true,
  "portal_api": "https://script.google.com/macros/s/AKfycbwvMnVHZd7y5k-GP8_Dg9zkWyD2fqqH8UI4gaXsQ0iJnm9QNSsyyUhODFMyMW6BfAk/exec",
  "endereco_publico": ""
}
```

- `so_portal: true` → só entra quem tem login no portal (banco LOGINS). Não existe conta avulsa.
- `portal_api` → implantação PORTAL-LEITURA. O jogo confere a sessão do portal perguntando a ela (o
  servidor precisa de internet). Opcional: o dono pode acrescentar `"portal_segredo": "<SESSION_SECRET>"`
  (Propriedades do script) para o jogo conferir a sessão sem ir à internet — o Claude não vê nem copia
  esse valor.
- `endereco_publico` → preencher no passo 4.

## 3. Firewall (rede do escritório)

```powershell
New-NetFirewallRule -DisplayName "Morais Royale 7777" -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow -Profile Private,Domain
```

## 4. Tailscale Funnel (acesso de fora, https)

O Tailscale já está no servidor (máquina "servidor", conta moraisengdev). No PowerShell como
administrador:

```powershell
tailscale funnel --bg 7777
tailscale funnel status
```

Na primeira vez o Tailscale mostra um link para **liberar o Funnel** no painel (login.tailscale.com) —
quem libera é o dono, logado na conta. O `status` mostra o endereço, algo como
`https://servidor.tailXXXX.ts.net`. Esse endereço:

1. vai no `endereco_publico` do `morais-royale-config.json`;
2. vai na constante `JOGO_URL` no começo do script do `entretenimento.html` deste repositório
   (commit "Entretenimento: endereço do jogo"). Sem isso a aba mostra "Servidor do jogo ainda não
   configurado" e o botão Jogar fica travado.

## 5. Ligar sozinho quando o servidor reinicia

```powershell
schtasks /Create /TN "Morais Royale" /TR "\"C:\MORAIS-ROYALE\MoraisRoyale.exe\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "Morais Royale"
```

(O `tailscale funnel --bg` já fica gravado e volta sozinho com o serviço do Tailscale.)

## 6. Conferir

- No servidor: `http://localhost:7777/status` → `{"ok":true,"jogando":0,...}`
- No celular, fora do Wi-Fi: `https://servidor.tailXXXX.ts.net/status` → o mesmo JSON.
- No portal: Entretenimento › bolinha verde "Servidor no ar" › **Jogar agora** abre o jogo já logado.

## Atualizar o jogo depois

Parar a tarefa, trocar o `MoraisRoyale.exe` na pasta (o `morais-royale-contas.json` e o config ficam),
ligar de novo:

```powershell
schtasks /End /TN "Morais Royale"
# copiar o exe novo por cima
schtasks /Run /TN "Morais Royale"
```
