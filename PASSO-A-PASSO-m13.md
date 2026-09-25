# Passo a passo — correções m13 (25/09, 16h)

## O que estava travando tudo

Entrei no seu Chrome e medi: o servidor de **LEITURA** do Apps Script levava **44 segundos** para responder até o ping (e devolvia página de erro do Google). O de **ESCRITA** respondia em **2 segundos**.

Por isso Processos e Arquivos ficavam carregando para sempre, o checklist pronto ficava "salvando…", a atividade demorava a criar e a atividade PORTAL não aparecia. Tudo isso agora sai pelo servidor de **ESCRITA**, e o servidor de LEITURA fica só com o que já era dele.

Siga na ordem.

---

## Etapa 1 — Apps Script (nos DOIS projetos)

Em **PORTAL-LEITURA** e em **PORTAL-ESCRITA**:

1. **`RetaFinal.gs`** → apague tudo e cole o novo (`AppsScript-PORTAL/RetaFinal.gs`).
2. **`Melhorias.gs`** → apague tudo e cole o novo (versão **m13**).
3. **Salvar** → **Implantar → Gerenciar implantações → lápis → Nova versão → Implantar**.

✅ **Conferir:** o ping da **escrita** mostra `"melhorias":"2026-09-25 m13"`:
<https://script.google.com/macros/s/AKfycbyoEOQfmuuN_jG817TeDK_aVMv6BiD6WFv61ZkgulUQBgYfxxyYPttzv1AMH2PcmZ31Jw/exec?action=ping>

(O ping da leitura pode continuar lento por alguns minutos até as execuções travadas acabarem. Isso é esperado.)

---

## Etapa 2 — Trocar o gatilho de lugar

O gatilho estava no projeto de LEITURA e ajudava a entupi-lo. Ele passa para o de ESCRITA.

1. No **PORTAL-LEITURA**: escolha a função **`rfRemoverGatilhoAtividades`** → **Executar**.
   ✅ O log diz `1 gatilho(s) rfAquecerAtividades removido(s)`.
2. No **PORTAL-ESCRITA**: escolha **`rfCriarGatilhoAtividades`** → **Executar** (aceite a autorização se pedir). Leva 1–2 minutos.
   ✅ O log termina com `Gatilho criado. Retrato: … atividades · outras abas: …`, e em **⏰ Acionadores** do ESCRITA aparece **`rfAquecerAtividades`**.

> A linha `lista arq: Notion 400 …` no log continua até você conectar a SITES MORAIS ao banco dos Arquivos (Etapa 4).

---

## Etapa 3 — GitHub (repositório PORTAL-MORAIS)

Suba na **raiz**, substituindo:

| Arquivo | O que mudou |
|---|---|
| `rf-rotas.js` | **Novo.** Faz as telas novas usarem o servidor de ESCRITA |
| `index.html` | Carrega o `rf-rotas.js` |
| `atividades.html` | Responsáveis corrigidos (caixinha ao lado do nome, busca funcionando) · criação na hora · campo **Comentário** na criação · checklist pronto gera sem esperar |
| `processos.html` | Usa o servidor de ESCRITA · mensagem clara quando falta conexão no Notion |
| `arquivos.html` | O mesmo dos Processos |
| `sw.js` | Versão **v52** |
| `atv-alertas.js` | Igual ao da rodada m12. Suba se ainda não subiu |
| `editor-blocos.js` | Igual ao da rodada m12. Suba se ainda não subiu |

Espere o **Publicar site** ficar verde em Actions e dê **🔄 Recarregar** uma vez no painel.

---

## Etapa 4 — Arquivos (só você consegue fazer, no Notion)

O banco dos Arquivos ainda não está conectado à integração.

1. Abra <https://app.notion.com/p/30bc5ab532d380c19df8f5dded8b51b8>.
2. Clique em **•••** (canto superior direito) → **Conexões** → adicione **SITES MORAIS**.
3. Se a SITES MORAIS **já estiver** lá, a tabela puxa os dados de outro banco. Nesse caso, abra o banco de origem pelo menu **•••** e conecte nele também.

Sem isso, a aba Arquivos mostra: *"a integração SITES MORAIS ainda não tem acesso a este banco"*.

---

## Etapa 5 — Testes (seus 7 itens)

1. **Gerar checklist:** "+ Novo checklist pronto" → Salvar → **▶ Gerar** logo em seguida. Se ainda estiver salvando, ele espera e gera sozinho. O checklist aparece na hora em "Para mim" com uma rodinha e vira o de verdade quando o Notion termina.
2. **Responsáveis:** a caixinha fica à esquerda do nome. Digite "isaac" na busca e só ele aparece.
3. **Criar demora:** ao clicar **Criar atividade**, o formulário fecha **na hora** e a atividade aparece na lista como "criando…". Se o Notion recusar, aparece uma faixa vermelha com o motivo e o botão **Tentar de novo** (nada do que você digitou se perde).
4. **Comentário na criação:** campo **Comentário** no formulário. Ele vira o primeiro comentário da atividade, junto com os anexos.
5. **Atividade PORTAL:** abra o painel. A atividade de tipo PORTAL aparece no bloco **📌 Portal**. Se ela foi criada antes desta rodada, espere o gatilho (até 10 min) ou abra/edite a atividade uma vez.
6. **Processos:** abrem normalmente. Da 2ª vez em diante abrem na hora, com a cópia guardada.
7. **Arquivos:** abrem depois da Etapa 4.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Ping da escrita não mostra m13 | Refazer a Etapa 1 no **PORTAL-ESCRITA** (tem que ser **Nova versão**) |
| Processos ainda "carregando" | Conferir se o `rf-rotas.js` subiu e dar 🔄 Recarregar |
| Faixa vermelha "Não criou…" | Me mande o print com o motivo |
| Outras telas (Obras, Vendas…) lentas | É o servidor de LEITURA se recuperando. Melhora em alguns minutos depois da Etapa 2 |
