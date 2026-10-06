# Clicksign API v3 — o que o PORTAL-VENDA usa

Rotas e corpos exatos que `ClicksignVenda.js` monta e `AssinaturaVenda.gs`
chama. Conferidos na documentação oficial em 06/10/2026 (páginas abaixo; cada
uma também existe em Markdown acrescentando `.md` ao endereço). Nada aqui foi
testado contra a Clicksign real: o primeiro uso é no **sandbox**
(`COMO-IMPLANTAR.md`, seção "Assinatura").

## Ambiente, autenticação e formato

- Host: sandbox `https://sandbox.clicksign.com`, produção `https://app.clicksign.com`;
  caminho `/api/v3`. Trocar de ambiente = trocar host e token.
- Cabeçalhos em toda chamada:
  - `Authorization: <access token>` — o token puro, **sem** `Bearer`;
  - `Content-Type: application/vnd.api+json` (no Apps Script vai em `contentType`);
  - `Accept: application/vnd.api+json`.
- Corpo e resposta em JSON:API (`{"data": {"type": …, "attributes": …}}`); erro vem em
  `{"errors": [{"title", "detail", "code", "status"}]}`.
- Token: Configurações › API › Gerar Access Token (só quem administra a conta).

Páginas:
- https://developers.clicksign.com/docs/ambientes-autenticacao-e-formato
- https://developers.clicksign.com/docs/access-token
- https://developers.clicksign.com/docs/mensagens-de-erro

## Envio (assinaturaEnviar)

Ordem: 1 → 2 → 3 (um por signatário) → 4 (dois por signatário) → 5 → 6.

Proteções do envio (`AssinaturaVenda.gs`):

- **Um envio por vez:** ler → conferir → criar → gravar roda sob
  `LockService.getScriptLock()` (espera até 10 s). Ocupado → erro
  `ASSINATURA_OCUPADA`, nada é chamado.
- **Contrato atualizado:** o nome do PDF gerado leva o carimbo dos dados
  (`… [#abcd1234].pdf`, 8 hex do SHA-256 de compradores, vendedor/representante,
  corretor, loteamento, imóvel e valores — `ctrCarimbo_` no `GerarContrato.gs`).
  O envio recalcula; se não bater, ou se o PDF não tem carimbo (gerado antes
  desta versão), recusa com `CONTRATO_DESATUALIZADO` ("gere de novo").
- **Envelope anotado na hora:** logo depois do passo 1 o portal grava
  `ASSINATURA - ENVELOPE ID` e `ASSINATURA - SITUAÇÃO = RASCUNHO`; RASCUNHO
  conta como envelope aberto (barra outro envio). Se nem essa gravação der
  certo, apaga o envelope recém-criado e devolve `GRAVACAO_FALHOU`.
- **Erro antes de ativar** (passos 1–5): o portal **apaga o rascunho**
  (`DELETE /api/v3/envelopes/{envelope_id}`, abaixo) e limpa as duas colunas e
  a Propriedade `ASSINATURA_PAPEIS_<envelope>` — pode enviar de novo. Se o
  DELETE falhar (log só com o código), a casa fica em RASCUNHO e a tela orienta
  "apague o rascunho na Clicksign e use Atualizar situação".
- **Resposta 2xx sem corpo** (ex.: 204) ou com corpo que não é JSON é sucesso
  nos passos que não precisam de id (ativar, notificar, apagar). Nos que
  precisam (envelope, documento, signatário), falta de id é falha
  ("resposta sem id").
- **E-mail no detalhe** do erro que vai para a tela sai como `***@domínio`.

Guia passo a passo da própria Clicksign (mesma sequência):
- https://developers.clicksign.com/recipes/criação-e-configuração-do-envelope
- https://developers.clicksign.com/docs/veja-como-funciona-na-prática

### 1. Criar envelope — `POST /api/v3/envelopes` → `data.id`

```json
{ "data": { "type": "envelopes", "attributes": {
  "name": "Contrato - <ENDEREÇO DA CASA>",
  "locale": "pt-BR",
  "auto_close": true,
  "block_after_refusal": true,
  "deadline_partial_signature_action": "canceled" } } }
```

- `auto_close: true` — finaliza sozinho depois da última assinatura.
- `block_after_refusal: true` — uma recusa pausa o processo (situação RECUSADO).
- `deadline_partial_signature_action: "canceled"` — **escolha deliberada**: o padrão
  (`closed`) finaliza o documento com as assinaturas parciais quando vence o prazo;
  um contrato de compra e venda só vale com todas. Com `canceled`, envelope
  `closed` quer dizer "todos assinaram".
- Prazo (`deadline_at`) não é mandado: padrão da Clicksign = criação + 30 dias
  (máximo 90).

Páginas:
- https://developers.clicksign.com/reference/api-criar-envelope
- https://developers.clicksign.com/reference/envelope-campos-e-regras-de-negocio
- https://developers.clicksign.com/docs/aproveitamento-de-assinaturas-parciais-em-documentos-expirados

### 2. Adicionar documento — `POST /api/v3/envelopes/{envelope_id}/documents` → `data.id`

```json
{ "data": { "type": "documents", "attributes": {
  "filename": "CONTRATO - <...>.pdf",
  "content_base64": "data:application/pdf;base64,<PDF em base64>" } } }
```

O PDF é o ÚLTIMO arquivo da coluna `CONTRATO GERADO`, baixado pela URL do Notion.

Páginas:
- https://developers.clicksign.com/reference/api-upload-documentos
- https://developers.clicksign.com/docs/documentos

### 3. Adicionar signatário — `POST /api/v3/envelopes/{envelope_id}/signers` → `data.id`

```json
{ "data": { "type": "signers", "attributes": {
  "name": "Nome Sobrenome",
  "email": "pessoa@exemplo.com",
  "has_documentation": true,
  "documentation": "000.000.000-00",
  "refusable": true } } }
```

- `documentation` (CPF formatado) só vai quando o CPF é válido; sem ele, a pessoa
  digita na hora de assinar (`has_documentation: true`).
- Regras da Clicksign para `name`: nome e sobrenome, sem números — o portal confere
  antes (`faltasAssinatura`).
- `refusable: true` — deixa o signatário recusar (para existir a situação RECUSADO).
- Todos no mesmo grupo (sem ordem de assinatura); aviso por e-mail (padrão).

Páginas:
- https://developers.clicksign.com/reference/api-criar-signatario
- https://developers.clicksign.com/reference/signatario-campos-e-regras-de-negocio

### 4. Requisitos — `POST /api/v3/envelopes/{envelope_id}/requirements` (dois por signatário)

Qualificação ("assinar como"):

```json
{ "data": { "type": "requirements",
  "attributes": { "action": "agree", "role": "buyer" },
  "relationships": {
    "document": { "data": { "type": "documents", "id": "<document_id>" } },
    "signer":   { "data": { "type": "signers",   "id": "<signer_id>" } } } } }
```

Autenticação (token por e-mail):

```json
{ "data": { "type": "requirements",
  "attributes": { "action": "provide_evidence", "auth": "email" },
  "relationships": { "document": { … }, "signer": { … } } } }
```

Papéis (`ClicksignVenda.PAPEIS`), da tabela "Tipos de requisitos de qualificação":

| Quem | `role` | Na Clicksign |
| :-- | :-- | :-- |
| Comprador 1 e 2 | `buyer` | Parte compradora |
| Vendedor PF / representante da SPE | `seller` | Parte vendedora |
| Testemunhas | `witness` | Testemunha |
| Corretor (opcional) | `real_estate_broker` | Corretor de imóveis |

Páginas:
- https://developers.clicksign.com/reference/criar-requisito-qualificacao
- https://developers.clicksign.com/reference/criar-requisito-de-autenticacao
- https://developers.clicksign.com/docs/adicionar-requisito-de-qualificacao
- https://developers.clicksign.com/docs/tipos-de-requisitos-de-autenticacao
- https://developers.clicksign.com/reference/api-requisitos

### 5. Ativar — `PATCH /api/v3/envelopes/{envelope_id}`

```json
{ "data": { "id": "<envelope_id>", "type": "envelopes", "attributes": { "status": "running" } } }
```

Status do envelope: `draft`, `running`, `canceled`, `closed`. Depois de ativar o
portal grava `ASSINATURA - SITUAÇÃO = ENVIADO` (o id já estava gravado desde o passo 1).

- **Ativar sem resposta (http 0) ou 5xx:** o portal consulta
  `GET /api/v3/envelopes/{envelope_id}`. `running` → ativou, segue (grava
  ENVIADO e notifica). `draft` → falha antes de ativar (apaga o rascunho). Se a
  consulta também falhar, **não apaga nada** (pode ter ativado): a casa fica em
  RASCUNHO, a resposta traz `incerto: true` e a tela pede "Atualizar situação
  daqui a pouco; não envie de novo".
- **Notion não grava ENVIADO:** mais 2 tentativas (1 s entre elas). Se ainda
  falhar, o portal guarda a Propriedade `ASSINATURA_PENDENTE_<pageId>` = id do
  envelope, notifica mesmo assim e devolve `GRAVACAO_FALHOU` com o id. Enquanto
  a chave existir, o envio recusa (`ENVELOPE_ABERTO`); o "Atualizar situação" usa
  esse id, grava as duas colunas e apaga a chave.

Página: https://developers.clicksign.com/reference/api-editar-envelope

### Apagar rascunho — `DELETE /api/v3/envelopes/{envelope_id}`

Sem corpo; só vale para envelope em `draft` (resposta 2xx, normalmente sem
corpo). Usado só quando o envio falha antes de ativar. A página de referência
desta rota não foi reconferida nesta revisão (feita sem acesso à rede) —
conferir no sandbox junto com as dúvidas abaixo (dúvida 7).

### 6. Notificar todos — `POST /api/v3/envelopes/{envelope_id}/notifications`

```json
{ "data": { "type": "notifications", "attributes": {} } }
```

Se falhar, o envelope já está ativo e gravado: a resposta é `ok` com
`aviso: "NOTIFICACAO_FALHOU"`. Resposta 2xx sem corpo conta como sucesso.

Quem enviou: o log registra só o login (`sess.u`) e o código do resultado
(`enviar <página> por <login>: ok | <erro>`) — nada na coluna de situação.

Páginas:
- https://developers.clicksign.com/reference/api-notificar-envelope
- https://developers.clicksign.com/reference/notificacao-campos-e-regras-de-negocio

## Consulta (assinaturaEstado)

Todas `GET`, sem corpo:

| Rota | Para quê |
| :-- | :-- |
| `/api/v3/envelopes/{envelope_id}` | `data.attributes.status` |
| `/api/v3/envelopes/{envelope_id}/documents` | `data[0].id` e `data[0].links.files` |
| `/api/v3/envelopes/{envelope_id}/documents/{document_id}/events` | eventos `sign`, `refusal`, `deadline` |
| `/api/v3/envelopes/{envelope_id}/signers` | `data[].id` e `attributes.email` |

Situação gravada (`ClicksignVenda.situacao`):

| Status do envelope | Eventos do documento | Situação |
| :-- | :-- | :-- |
| `running` | sem `refusal` | ENVIADO |
| `running` | com `refusal` | RECUSADO |
| `closed` | — | ASSINADO (baixa o PDF e anexa em `CONTRATO ASSINADO`, modo trocar) |
| `canceled` | com `refusal` | RECUSADO |
| `canceled` | com `deadline` | EXPIRADO |
| `canceled` | nenhum dos dois | CANCELADO |
| `draft` | — | RASCUNHO (só consulta o envelope; não lê documento nem signatários) |
| outro | — | erro `CLICKSIGN_STATUS_DESCONHECIDO: <status>`, nada gravado |

- Envelope em RASCUNHO que **não existe mais** (404, apagado à mão na
  Clicksign): o portal limpa as duas colunas e a casa volta a "sem envelope"
  (pode enviar). 404 em qualquer outra situação é só erro na tela.
- Com `ASSINATURA_PENDENTE_<pageId>` (ver passo 5), a consulta usa esse id,
  grava ENVELOPE ID + SITUAÇÃO e apaga a chave quando a gravação dá certo.
- `closed` sem o evento `sign` de algum signatário: a situação continua
  ASSINADO (o PDF é o que a Clicksign entregou), mas essa pessoa aparece como
  "falta assinar", o log registra "assinaturas incompletas" e a resposta traz
  `aviso: "ASSINATURAS_INCOMPLETAS"`.
- Os dois downloads (PDF do contrato no envio, PDF assinado na consulta) que
  ficam sem resposta viram `CONTRATO_ILEGIVEL` / `DOWNLOAD_ASSINADO_FALHOU`, com
  log só do código (nunca a URL).

Quem é quem: os ids dos signatários e o papel de cada um ficam na Propriedade
`ASSINATURA_PAPEIS_<envelope_id>` (gravada no envio, sem dado pessoal), porque a
listagem de requisitos da documentação não traz a ligação requisito → signatário.
Ela é apagada quando a situação fica final (ASSINADO, CANCELADO, EXPIRADO,
RECUSADO) e quando o envio falha antes de ativar; depois disso a lista mostra
"Signatário" no lugar do papel.

Páginas:
- https://developers.clicksign.com/reference/api-detalhes-do-envelope
- https://developers.clicksign.com/reference/api-listar-documentos
- https://developers.clicksign.com/reference/detalhes-do-documento
- https://developers.clicksign.com/reference/eventos-de-um-documento
- https://developers.clicksign.com/reference/api-listar-signatarios
- https://developers.clicksign.com/reference/api-listar-requisitos
- https://developers.clicksign.com/docs/eventos
- https://developers.clicksign.com/docs/evento-sign
- https://developers.clicksign.com/docs/evento-refusal
- https://developers.clicksign.com/docs/evento-document-closed

## Dúvidas em aberto (o código falha de forma visível em cada uma)

1. **Link do PDF assinado.** A documentação v3 só mostra `links.files.original`
   (URL S3 com validade de ~5 minutos) no documento; não mostra a chave do
   arquivo assinado. O código lê **apenas** `links.files.signed` e, se ela não
   vier, devolve `CLICKSIGN_SEM_LINK_ASSINADO: <chaves que vieram>` e **não**
   marca ASSINADO nem baixa o original. Conferir no sandbox qual chave aparece
   num envelope `closed` e ajustar `ClicksignVenda.linkAssinado`.
2. **Valores de `role`.** A referência do endpoint (OpenAPI) lista só `sign`,
   `party` e `contractor`; a página teórica "Tipos de requisitos de qualificação"
   lista `buyer`, `seller`, `witness`, `real_estate_broker` e outros. O código usa
   os da tabela; se o sandbox recusar, o envio para em `passo: "requisitos"` com o
   código e o detalhe da Clicksign na tela, envelope em rascunho. Troca em
   `ClicksignVenda.PAPEIS` (uma linha).
3. **Representante da empresa: `seller` ou `legal_representative`?** O código
   usa `seller` (Parte vendedora) para o representante da SPE. Se o jurídico
   preferir que o log mostre "Representante legal", trocar em `PAPEIS`.
4. **Formato dos eventos na API.** O exemplo da rota de eventos só mostra o
   evento `upload`; o formato de `sign` (com `data.signer.email`) vem da página do
   webhook. Quem assinou é casado por e-mail; se o formato da API for outro, a
   lista mostra "falta assinar" para todos — também com o envelope `closed`,
   que então traz o aviso `ASSINATURAS_INCOMPLETAS`. Não afeta a situação nem o
   PDF. Conferir no sandbox: se todo envelope fechado vier com esse aviso, o
   formato dos eventos é outro.
5. **Ativar já avisa os signatários?** A documentação manda notificar depois de
   ativar (passo 6); não diz se a ativação sozinha já manda e-mail. Se mandar,
   cada um recebe dois avisos — conferir no sandbox.
6. **`content_base64` de PDF grande.** A documentação não dá limite de tamanho;
   contratos gerados ficam bem abaixo de 1 MB.
7. **DELETE do rascunho.** O portal apaga o envelope em `draft` quando o envio
   falha antes de ativar. Conferir no sandbox (forçando uma falha, ex.: e-mail
   de testemunha inválido na Propriedade) que o DELETE responde 2xx e o
   envelope some; se a Clicksign recusar, a casa fica em RASCUNHO e o log
   mostra `rascunho nao apagado http <código>`.
