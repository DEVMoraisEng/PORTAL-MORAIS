# Troca de fiadores e termos em envelope próprio — especificação (18/11/2026)

Origem: unidade 40 do Reserva dos Ipês. A fiadora 2 desistiu com o envelope em andamento; depois a fiadora 1 também foi
trocada. A troca foi feita à mão por um `temp.gs` (pacote `apps-script-producao/PORTAL-VENDA-subir-1811-troca-fiador-un40`
fora do repositório). Esta especificação leva isso para o portal, para qualquer venda do condomínio. O código da rotina de
hoje (temp.gs + remendo do `assinaturaEstado_`) é a referência de comportamento medido.

## Fatos medidos (18/11/2026, produção)
- Na API v3, cada **documento** do envelope fica `closed` quando o último assinante dele assina, mesmo com o envelope
  ainda `running`. Na unidade 40, contrato, memorial e projeto estavam `closed`; só os 2 termos estavam `running`.
- `PATCH /envelopes/{id}/documents/{doc}` com `status: canceled` cancela um documento `running` (já usado pelo Cancelar).
- Não dá para criar requisito nem documento num envelope `running` (403). Termos novos exigem envelope novo.
- O contrato não cita fiador pelo nome; os termos sim (qualificação, quadro e assinaturas). Trocar fiador = refazer os termos.
- Os termos de confissão não citam o sinal (conferido nos PDFs). Contrato e termos repetem as parcelas pré/pós-chaves e balões.
- O `assinaturaEstado_` de hoje trata `docs[0]` como contrato; num envelope só de termos guardaria um termo em
  CONTRATO ASSINADO (remendo de 18/11 corrige: contrato só quando `docs[0]` é contrato; termo cancelado não é colhido).
- O gerador (`ContratoVenda.faltasContrato`) barra sinal vencido e a regra "ato + 30 + 60 + 90" (14/11). Ao refazer termos
  de um contrato já gerado essas travas não podem valer (o contrato manda).
- A cota diária de UrlFetch da conta está no limite (18/11). Teste de ponta a ponta: poucos casos, espaçados, parando no
  primeiro erro de cota.

## Decisões do dono (18/11/2026, uma a uma)
1. A troca vale **a qualquer momento**, também com o contrato ainda em assinatura (dois envelopes abertos ao mesmo tempo).
2. Quem pode: **quem já pode enviar contrato para assinatura** (mesma permissão de `assinaturaEnviar`; perfil TESTES não).
   Antes de executar, a tela mostra o que será cancelado e quem recebe os termos novos.
3. A venda só conta como **ASSINADA** quando contrato **e** termos estiverem assinados por todos. VGV, ASSINOU E ARMAZENOU
   CONTRATO, lançamento/anexos do Mais Controle e ZIP esperam os termos.
4. Fiador novo entra pelo bloco **Fiadores** da aba Contrato, com **documento obrigatório** e a **conferência por IA** de
   nome e CPF; só depois o envio dos termos fica liberado.
5. Envelope dos termos em **duas colunas novas** do Notion: `ASSINATURA TERMOS - ENVELOPE ID` e
   `ASSINATURA TERMOS - SITUAÇÃO` (texto), na BANCO DE DADOS VENDAS CONDOMÍNIO (teste e produção).
6. Travas de data do sinal não valem ao refazer termos. Cada troca vira uma linha no HISTÓRICO DO CONTRATO.
7. Publicação: o dono cola e implanta (o push/deploy em produção pelo Claude é barrado). Pacote = versão no ar + só esta
   mudança. Script para criar as colunas, rodado pelo dono.
8. O que já foi assinado por todos fica **travado e visível**: quem assinou, quando, e botão para ver o PDF assinado.

Em aberto (não bloqueia): unidade 40 ficou com ASSINOU E ARMAZENOU CONTRATO = SIM antes desta regra. Não mexer sem o dono.

## Modelo
- Colunas atuais `ASSINATURA - ENVELOPE ID / SITUAÇÃO / CONTRATO ASSINADO` = **envelope do contrato** (contrato, memorial,
  projeto e, no envio normal, os termos).
- Colunas novas = **envelope de termos** (só existe depois de uma troca). Termos assinados continuam nas colunas
  `CONFISSÃO PRÉ-CHAVES - ASSINADA` / `CONFISSÃO PÓS-CHAVES - ASSINADA`.
- **Situação combinada** (regra pura, testada em node):
  - documentos do contrato (contrato, memorial, projeto) = os não cancelados do envelope do contrato;
  - termos = os termos não cancelados do envelope de termos, se houver; senão os do envelope do contrato;
  - `ASSINATURA - SITUAÇÃO` = ASSINADO só quando todos esses estão `closed`; RECUSADO/EXPIRADO/CANCELADO do envelope do
    contrato seguem como hoje; enquanto faltar algo = ENVIADO;
  - estado extra só para a tela: `contratoAssinado: true` quando os documentos do contrato estão `closed` e os termos não.
- `ASSINATURA TERMOS - SITUAÇÃO` = a situação do envelope de termos, com a mesma tabela de hoje.

## Servidor (PORTAL-VENDA)
- `assinaturaEstado_` lê o envelope do contrato e, se houver, o de termos. Colhe **por documento**: contrato fechado →
  CONTRATO ASSINADO (mesmo com envelope `running`); termo fechado → coluna ASSINADA dele; cancelado nunca. A colheita
  identifica o contrato pelo tipo (`ClicksignVenda.tipoDoDocumento`), nunca pela posição.
- Pós-assinatura (`assPosAssinatura_`, `mcAnexosPosAssinatura_`, ZIP, `ASS_AGUARDANDO_`) só quando a situação combinada
  vira ASSINADO pela primeira vez.
- Vigia (`AssinaturaVigia`) acompanha também o envelope de termos (mesmo intervalo; sem chamada a mais quando não há).
- **Registro do que foi assinado**: Propriedade `ASS_HIST_<pageId>` (JSON pequeno, sem e-mail/CPF): por envelope, os
  documentos (tipo, nome, status) e os signatários (papel, nome mascarado, data). Gravada quando um documento fecha ou na
  troca. A tela lê daqui — zero chamada à Clicksign para o bloco "Já assinado".
- Ação **`trocarFiadoresPrevia`** (só lê): confere permissão, que a venda é do condomínio com termos, faltas dos fiadores
  (ConfissaoVenda.faltas + Clicksign.faltasAssinatura), documento anexado em DOC. FIADOR n de cada fiador **alterado** e
  conferência por IA sem divergência nele; devolve o que será cancelado (termos e envelope), quem assina os termos novos
  (papel + nome mascarado) e os avisos ignorados do sinal.
- Ação **`trocarFiadoresGerar`**: gera os termos novos (mesmo gerador, `cfdGerarTermos_`) ignorando só as travas de data
  do sinal (filtro dentro da execução, como no temp de 18/11) e devolve os nomes para a tela ler as posições das
  assinaturas (RubricasVenda, como no envio normal).
- Ação **`trocarFiadoresEnviar`** (sob LockService, retomável pela Propriedade `TROCA_TERMOS_<pageId>`):
  1. confere que os termos gerados têm o carimbo da prévia;
  2. cancela os termos `running` do envelope em que estão (envelope do contrato ou de termos anterior);
  3. cria envelope novo só com os termos: compradores (e cônjuges), vendedora, testemunhas, fiadores (e cônjuges);
     nunca o corretor; requisitos pelo `documentosDoSignatario`; assinaturas posicionadas com o que a tela leu;
  4. grava `ASSINATURA TERMOS - ENVELOPE ID / SITUAÇÃO = ENVIADO`, papéis/requisitos (Trocar e-mail funciona), notifica;
  5. linha no histórico ("trocou os fiadores: … termos antigos cancelados, termos novos no envelope …").
  Ordem segura: nada é cancelado antes de os termos novos existirem; erro de cota devolve `COTA_GOOGLE_ESGOTADA`.
- Reenviar link, Trocar e-mail e Cancelar passam a aceitar `doc: "TERMOS"` (envelope de termos). Cancelar o envelope de
  termos não toca no contrato.
- Fiadores: o bloco deixa editar com envelope aberto **só** no modo "Trocar fiadores" (hoje `assEnvelopeAberto_` trava).

## Tela (vendas.html / assinatura-ui.js / venda-dossie.js)
- Seção "Enviar contrato via Clicksign":
  - **Já assinado** (travado): por documento fechado, quem assinou e a data, e "Ver PDF assinado" (ação existente
    `verDocumentoAssinado`, que passa a aceitar documento fechado com envelope `running`). Sem botão de mudar nada.
  - **Em assinatura**: as pessoas que faltam, com Trocar e-mail e Reenviar link (do envelope certo).
  - Situação "Contrato assinado — termos de confissão em assinatura" quando `contratoAssinado`.
  - Botão **Trocar fiadores** (permissão de enviar): abre o bloco Fiadores editável → exige documento + conferência →
    Gerar termos novos (abre para ver) → confirmação com o que será cancelado e quem recebe → Enviar.
- Celular: regra do CLAUDE.md (360/375/414 + desktop, `scrollWidth`, 44 px, input 16 px, print 375x812 de cada tela tocada).

## Unidade 40 (migração, no pacote)
O envelope de 14/11 (contrato, memorial e projeto `closed`; termos `canceled`) volta para `ASSINATURA - ENVELOPE ID`, e o envelope
dos termos novos vai para `ASSINATURA TERMOS - ENVELOPE ID` com ENVIADO. Os ids ficam só no temp.gs do pacote, fora do
repositório. Função de migração com prévia; o dono roda.

## Testes
- node (`venda/testes/*.test.mjs`): situação combinada (todas as combinações), quem assina os termos (sem corretor, com
  cônjuge de fiador), colheita por tipo (contrato fora de `docs[0]`, termo cancelado), filtro das travas do sinal (só as
  duas frases), prévia da troca (documento faltando, conferência divergente, permissão), registro ASS_HIST sem dado pessoal.
- Ponta a ponta no PORTAL-VENDA-TESTE + sandbox: 1 venda do Brain Teste, contatos da Morais, no máximo 2 rodadas, parando
  no primeiro erro de cota. Roteiro para o dono (ele clica e assina no sandbox).

## Fora do escopo
Aditivo de contrato; troca de comprador; casa de rua (não tem termos).
