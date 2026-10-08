# Passo a passo — correções m12 (25/09, noite)

Só as correções da sua última lista. Siga na ordem; cada etapa tem um **✅ Conferir**.

---

## Etapa 1 — Apps Script (nos DOIS projetos)

Faça igual no **PORTAL-LEITURA** e no **PORTAL-ESCRITA**:

1. Arquivo **`RetaFinal.gs`** → apague tudo e cole o **`AppsScript-PORTAL/RetaFinal.gs`** novo.
2. Arquivo **`Melhorias.gs`** → apague tudo e cole o **`AppsScript-PORTAL/Melhorias.gs`** novo (versão **m12**).
3. **Salvar** (💾).
4. **Implantar → Gerenciar implantações → lápis ✏️ → Versão: Nova versão → Implantar.**

✅ **Conferir:** os dois pings mostram `"melhorias":"2026-09-25 m12"`.

- Leitura: <https://script.google.com/macros/s/AKfycbwvMnVHZd7y5k-GP8_Dg9zkWyD2fqqH8UI4gaXsQ0iJnm9QNSsyyUhODFMyMW6BfAk/exec?action=ping>
- Escrita: <https://script.google.com/macros/s/AKfycbyoEOQfmuuN_jG817TeDK_aVMv6BiD6WFv61ZkgulUQBgYfxxyYPttzv1AMH2PcmZ31Jw/exec?action=ping>

---

## Etapa 2 — Gatilho (só no PORTAL-LEITURA)

É ele que deixa **tudo pré-carregado** no servidor: atividades, equipe, outras abas **e agora também as listas de Processos e Arquivos** (era por isso que os Processos estouravam o tempo).

1. No **PORTAL-LEITURA**, escolha a função **`rfCriarGatilhoAtividades`**.
2. **Executar** (se pedir autorização, aceite). Leva 1–2 minutos.

> Pode rodar mesmo que já tenha rodado antes: ele apaga o gatilho velho e cria o novo.

✅ **Conferir:** o log termina com `Gatilho criado. Retrato: … atividades · outras abas: …` e em **⏰ Acionadores** existe **`rfAquecerAtividades`** a cada 10 minutos.

---

## Etapa 3 — GitHub (repositório PORTAL-MORAIS)

Suba na **raiz**, substituindo:

| Arquivo | O que mudou |
|---|---|
| `index.html` | Bloco **📌 Portal** no painel · Processos e Arquivos pré-carregados |
| `atividades.html` | Checklist item a item · checklist avulso · novo tipo · responsáveis em todo formulário · anexos ao criar · criação à prova de demora · página sem "cortar seco" |
| `processos.html` | Barra de categorias não corta · some categoria zerada · abre com a cópia guardada |
| `arquivos.html` | As mesmas correções dos Processos |
| `atv-alertas.js` | Sino não disputa a fila na aba Atividades |
| `editor-blocos.js` | Mesmo da rodada anterior — suba só se ainda não subiu |
| `sw.js` | Versão **v51** |

Espere o **Publicar site (GitHub Pages)** ficar verde em **Actions** e dê **🔄 Recarregar** uma vez no painel.

---

## Etapa 4 — Testes (o que cada item da sua lista virou)

**Atividades** — <https://devmoraiseng.github.io/PORTAL-MORAIS/atividades.html>

- [ ] **Página cortando seco** → agora tem respiro no fim da página.
- [ ] **Checklist item a item** → em "+ Nova atividade", "Checklist": escreva um item e aperte **Enter** → aparece a próxima linha. Colar uma lista inteira também separa sozinho. **×** tira o item.
- [ ] **Checklist avulso** → em "Para mim", botão **☑ Checklist avulso** → nome, data e itens → cria na hora em "Para mim".
- [ ] **Checklist pronto aparece na hora** → "+ Novo checklist pronto" → Salvar → ele já aparece na coluna da direita (mostra "salvando…" por alguns segundos).
- [ ] **Erro ao gerar** → **▶ Gerar** agora espera o servidor e confere se criou; se der erro, a mensagem diz o motivo de verdade (não mais "erro desconhecido").
- [ ] **Novos tipos** → no Tipo (formulário ou atividade aberta), última opção **＋ Novo tipo…** → digite o nome.
- [ ] **Escolher responsáveis** → aparece em **todos** os formulários, com busca. Em "Atividade para mim" você já vem marcado e pode marcar mais gente.
- [ ] **Anexar ao criar** → campo **Anexos** no formulário; os arquivos entram como o primeiro comentário da atividade.
- [ ] **Histórico demorando** → abrir a atividade não fica mais girando para sempre: se o servidor não responder, aparece o motivo e **Tentar de novo**. (Com o gatilho da Etapa 2 ativo, abre bem mais rápido.)
- [ ] **Novas atividades aparecem na hora** → crie uma para outra pessoa: na tela dela (Atividades e sino) aparece sozinha em poucos segundos.

**Processos** — <https://devmoraiseng.github.io/PORTAL-MORAIS/processos.html> · **Arquivos** — <https://devmoraiseng.github.io/PORTAL-MORAIS/arquivos.html>

- [ ] **Sempre carregando** → depois da primeira vez abre na hora (cópia guardada); o painel já deixa as duas listas prontas.
- [ ] **Só categorias com itens** → as zeradas não aparecem mais na barra.
- [ ] **Barra cortada** → as categorias quebram em linhas, nada fica escondido.

**Tipo PORTAL** — painel <https://devmoraiseng.github.io/PORTAL-MORAIS/index.html>

- [ ] Crie uma atividade com **Tipo = PORTAL** (já aparece na lista de tipos), com texto e checklist.
- [ ] No painel aparece o bloco **📌 Portal** (acima dos aniversariantes) com o conteúdo e o checklist dela.
- [ ] Responsável/solicitante (e ADM/MASTER) marcam o checklist ali mesmo; os demais só leem.
- [ ] Ao **Finalizar** a atividade, ela some do painel.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Ping ainda mostra m11 | Refazer a Etapa 1 naquele projeto (tem que ser **Nova versão**) |
| Processos/Arquivos ainda estouram o tempo | Conferir a Etapa 2 (gatilho) e esperar 10 minutos |
| "Não criou: …" com um motivo | Me mande o print com a mensagem |
| Bloco Portal não aparece | Conferir se a atividade é do tipo **PORTAL** e não está **Finalizado** |
