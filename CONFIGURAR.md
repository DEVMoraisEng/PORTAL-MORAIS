# PORTAL-MORAIS — o que configurar depois de subir estes arquivos

O site passou a ler **JSON estático** (`dist/`) em vez de chamar o Apps Script a
cada carregamento. É exatamente o que o RAS-SEMANAL faz, e é o motivo dele ser
rápido. O Apps Script continua sendo usado, mas só para **login e escrita**.

---

## 1. Configuração (só isso)

**Um único secret no GitHub** — `Settings > Secrets and variables > Actions`:

| Nome | Valor |
|---|---|
| `NOTION_TOKEN` | token da integração do Notion |

Os IDs das bases VENDAS e DOCUMENTOS já estão preenchidos no `fetch_vendas.py`
(IDs de base não são segredo — sem o token não abrem nada). Não precisa mexer
nisso.

**No Notion, compartilhar a base DOCUMENTOS com a integração** —
abrir a base > `...` > Conexões > adicionar a integração. A de VENDAS já deve
estar (o Apps Script usa), mas a de DOCUMENTOS provavelmente nunca foi. Sem isso
o Actions falha com 404.

**Rodar o workflow uma vez à mão:** `Actions > Publicar site > Run workflow`.

No log, confira: `colunas: endereço=... habite=... obra=...`. Se vier `None`,
me manda essa linha que eu ajusto a busca do nome.

## 2. Com que frequência atualiza

Três gatilhos, todos já configurados em `.github/workflows/pages.yml`:

1. **A cada 15 min** (cron) — cobre edições feitas direto no Notion.
2. **A cada push** no `main`.
3. **`repository_dispatch`** do tipo `portal_update` — para o Apps Script
   disparar logo após uma escrita.

Ou seja: uma alteração feita **pelo site** aparece no site em ~2 min (tempo do
build) se você ligar o passo 3; uma alteração feita **direto no Notion** aparece
em até 15 min.

### Ligar o passo 3 no Apps Script

Adicione ao `Code.gs` e chame `agendarBuild()` no fim de cada escrita:

```javascript
var GH_REPO  = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');  // "DEVMoraisEng/PORTAL-MORAIS"
var GH_TOKEN = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'); // PAT clássico, escopo "repo"

function agendarBuild() {
  if (!GH_REPO || !GH_TOKEN) return;
  UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/dispatches', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + GH_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({ event_type: 'portal_update' }),
    muteHttpExceptions: true
  });
}
```

`GITHUB_REPO` tem que estar no formato `dono/repositório` — só o nome não funciona.

---

## 3. O que o Apps Script ainda faz

- `login` / `me` — autenticação e sessão
- `updateVenda`, `baixa`, `upload`, `excluirVenda` — escrita
- `atividades` — lista de atividades em aberto (continua ao vivo)

Os endpoints `vendas`, `vendasSchema` e `portal` **não são mais chamados** pelo
site. Pode deixá-los no `Code.gs` sem problema.

---

## 4. Arquivos de imagem

Continuam pendentes: `img/logo.png` e `img/gestores-vendas.jpg`.
Sem eles o site funciona (aparece "MORAIS" em texto no lugar da logo).

---

## 5. Usuários e senhas

Continua manual no banco **LOGINS** do Notion:

- **Novo usuário** — nova linha (LOGIN, SENHA, TIPO `ADM` ou `GERAL`, acessos).
- **Trocar senha** — editar a célula da senha no Notion.
- Na primeira entrada o `Code.gs` troca a senha em texto puro por um hash
  automaticamente. Para redefinir, é só escrever a senha nova em texto puro que
  o processo se repete.

Não existe tela de cadastro nem "esqueci minha senha" — se quiser, é a próxima
coisa que eu monto.
