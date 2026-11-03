# Anexos da venda no Mais Controle — rotas do ERP (03/11/2026)

Lido no código PÚBLICO do site do ERP (`https://acessar.maiscontroleerp.com.br/main-fda470be49cfcd90.js`, baixado
em 03/11/2026 sem login e sem cookie). Nada foi chamado no ERP para escrever este arquivo. Base:
`https://legacy-api.maiscontroleerp.com.br/maiscontrole/services` (`LEGACY` no `erp.py`).

[CERTO] = visto no código do site ou já usado pelo robô. [SUPOSIÇÃO] = sem prova ao vivo.

## 1. A aba "Arquivos" do Orçamento (`#/estimate/<id>/files`)

- Estado `base.planningEdit` com `url:"/estimate/{planningId}"`, filho `base.planningEdit.files` (`url:"/files"`), que
  desenha `<attached-files-tab entity-id="$ctrl.entityId" origin="PLANNING" …>` com
  `entityId = planningCtrl.planning.work.id` — **[CERTO]**: as pastas do Orçamento são da OBRA (id da obra), origem
  `PLANNING`. Não existe origem `ESTIMATE`/`BUDGET` para arquivos (as origens de pasta do bundle: PLANNING,
  MANAGEMENT, ESTIMATE_MODEL, QUOTATION, PURCHASE_ORDER, PURCHASE_REQUEST, DAILY_FIELD_REPORT, WORK_MEASUREMENT,
  CONTRACT, CONTRACT_MEASUREMENT, MANAGEMENT_REPORT, TRADE_RECEIVABLE(_READJUSTED), …).
- Listar as pastas: `FolderService.getAllByRoutine = Restangular.one("folder").customGETLIST("", {id, origin})`
  → `GET /folder?id=<obra>&origin=PLANNING` — **[CERTO]** (a mesma rota que o anexo do contrato já usa com
  `TRADE_RECEIVABLE_READJUSTED`).
- Cada pasta traz `name` (renomear = `PATCH /folder/{id}/rename?name=`) e a lista `files`; o componente lê
  `_.flatMap(m.folders, t => t.files)` e monta cada arquivo com `{id, name, type, extension, url, sizeInBytes, …}`
  — **[CERTO]** quanto aos nomes dos campos; **[SUPOSIÇÃO]** que `name` às vezes vem sem a extensão (por isso o
  robô compara `name` e `name + extension`).
- Criar pasta (o robô NÃO faz): `POST /folder` com `{name, position, origin:"PLANNING", work:{id}}`.

## 2. Subir o arquivo (o mesmo do anexo do contrato, já provado em produção)

1. `GET /system-configuration` → `filesBucketURL`, `filesAccessKey` — [CERTO];
2. `GET /file/{folderId}/check-storage-capacity/{bytes}` → `{exceedStorageCapacity, totalStorageCapacity}`
   (`FilesService.checkStorageCapacity`; a tela confere antes de cada envio e lê esses dois campos) — [CERTO];
3. `POST /file?folderId=<pasta>` com `{name, type, sizeInBytes}` (`FilesService.save`) → `{id, key, policy,
   signature, saved}` — [CERTO];
4. POST no bucket S3 (`AWSAccessKeyId`, `acl=private`, `success_action_status=201`, `key`, `policy`, `signature`,
   `file`) — [CERTO];
5. `PATCH /file/set-temporary?fileId=<id>&temporary=false` (`FilesService.toggleIsTemporaryFile`) — [CERTO]. A tela
   só chama isto no `$dropletSuccess` (depois do S3): o registro nasce temporário no passo 3.
6. Falhou o 4 ou o 5: o registro já existe com o nome. O robô apaga com `DELETE /file/delete-batch?fileIds=<id>`
   (`FilesService.removeBatch = one("file").one("delete-batch").customDELETE("",{fileIds})`, o "Remover" da tela) —
   [CERTO] rota; se não apagar, a situação manda apagar à mão. A lista de pastas não mostra (no código da tela) um
   campo `temporary`; o robô ignora arquivo com `temporary: true` ou `sizeInBytes` 0 SE vierem — [SUPOSIÇÃO] sobre o
   que o servidor devolve para um registro temporário.

## 3. Contrato no recebimento da venda

`GET /sales/{id}` → `tradeReceivable.id` → `GET /folder?id=<tr>&origin=TRADE_RECEIVABLE_READJUSTED` (a pasta da
venda; `attached-files-mini … origin="TRADE_RECEIVABLE_READJUSTED"` na tela da venda) — [CERTO], já usado.
O pedido de anexo NÃO cria a pasta só para conferir: sem pasta = nada anexado ainda; ao anexar, cria como antes.

## O que o robô faz (venda/mc/anexos.py, pedido "mc-anexos" da fila do servidor)

- contrato: nome = `regras.nome_do_contrato` (o mesmo do lançamento). Já na pasta → não sobe;
- ZIP: obra = sempre o ENDEREÇO da venda ("CONDOMÍNIO …", a mesma obra do lançamento; sem obra fixa por variável); pasta = `MC_PASTA_CONTRATOS_VENDA` ou "Contratos Venda" (nome comparado sem
  acento/caixa). Pasta faltando → a situação pede para criar; nunca cria. Arquivo com o mesmo nome → não sobe;
- grava só com `--aplicar` (pedido com aplicar E fila `pode_gravar` E `_central\VENDA_APLICAR.txt`);
- só pelo Chrome do porteiro (`MC_VIA=porteiro`): sem ele, recusa (`SO_PELO_PORTEIRO`).
