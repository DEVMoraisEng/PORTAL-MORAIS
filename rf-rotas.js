/* rf-rotas.js — PORTAL-MORAIS · 25/09/26 (16h)
 * ---------------------------------------------------------------------------
 * Manda as ações de Atividades, Processos, Arquivos, Portal e Aniversários
 * para a implantação de ESCRITA do Apps Script.
 *
 * Por quê: medido no navegador, a implantação de LEITURA estava levando 44 s
 * para responder até o ping (e devolvendo página de erro do Google), enquanto
 * a de ESCRITA respondia em 2 s. A LEITURA segue com o que já era dela (obras,
 * vendas, documentos…); estas telas novas passam a usar só a ESCRITA — onde
 * também mora o gatilho que deixa o retrato das atividades pronto.
 *
 * Tem que ser carregado DEPOIS do app.js (usa a lista ACOES_NA_ESCRITA dele).
 * v7 (28/09): faixa própria para chat e Mural (ver o fim do arquivo).
 * v12 (16/10): atvOutraAbrir/atvOutraGravar (atividade de outra aba editada aqui).
 * v13 (21/10): atvComentarioExcluir (excluir comentário pelo portal).
 * ------------------------------------------------------------------------ */
(function(){
  try{
    if(typeof ACOES_NA_ESCRITA==="undefined"||!Array.isArray(ACOES_NA_ESCRITA)) return;
    ["procLista","procCriar","procUpdate","blocos","blocoUpdate","blocoNovo","blocoExcluir",
     "atvMinhas","atvOutras","atvAlertas","atvEquipe","atvDetalhe","atvAbrir","atvCriar","atvUpdate",
     "atvComentarios","atvComentarioNovo","atvModelos","atvModeloUpdate","atvModeloExcluir","atvModeloCriar",
     "atvOp","atvPortal","aniversariantes",
     /* v5 */ "atvMural","procLote","atvLote","blocoAnexar","ckLista","ckCriar","ckMarcar","ckExcluir",
     /* v6 (28/09) */ "atvMuralCheck", /* v7 */ "atvAnexoUrl", /* v8 */ "atvDelta", /* v9 */ "blocoMover", /* v10 */ "blocoAnexarUrl", "blocoAnexarDoSupa",
     /* v12 (16/10) — atividade de outra aba aberta/gravada na aba Atividades */ "atvOutraAbrir", "atvOutraGravar",
     /* v13 (21/10) — excluir comentário pelo portal */ "atvComentarioExcluir"
    ].forEach(a=>{ if(ACOES_NA_ESCRITA.indexOf(a)<0) ACOES_NA_ESCRITA.push(a); });
  }catch(e){}
})();

/* v7 (28/09 tarde) — FAIXA PRÓPRIA PARA O CHAT E O MURAL
 * O navegador manda uma requisição por vez em cada faixa. Comentário, baixa
 * no Mural e a conferência "criou?" ficavam atrás do pré-carregamento das
 * atividades (até 60 s) — era o "enviando…" que não acabava. Agora andam numa
 * terceira faixa, ainda pela implantação de ESCRITA, que nunca espera leitura
 * longa. */
(function(){
  try{
    if(typeof _faixas!=="object"||typeof faixaDe!=="function"||typeof API_ESCRITA==="undefined"||!API_ESCRITA) return;
    /* v8 (28/09 noite): atvUpdate também — a baixa não espera o pré-carregamento */
    /* v9 (28/09 fim do dia): Mural, aniversários e checklists também — são o que a tela mostra primeiro */
    const CHAT=["atvComentarios","atvComentarioNovo","atvComentarioExcluir","atvAnexoUrl","atvOp","atvMuralCheck","atvUpdate",
                "atvMural","aniversariantes","ckLista","atvModelos"];
    if(!_faixas.chat) _faixas.chat={ max:1, emVoo:0, fila:[] };
    const original=faixaDe;
    faixaDe=function(action){ return CHAT.indexOf(action)>=0 ? _faixas.chat : original(action); };
  }catch(e){}
})();

/* v11 (30/09) — TERCEIRA IMPLANTAÇÃO E DUAS REQUISIÇÕES POR FAIXA
 * 1) Medido nas Execuções: o Apps Script RODA execuções ao mesmo tempo (duas
 *    começando no mesmo segundo, as duas concluídas). A fila do navegador
 *    (uma por faixa) era mais restrita que o servidor: qualquer pedido lento
 *    segurava todos os outros da mesma faixa. Agora são DUAS por faixa.
 * 2) API_ATIVIDADES: cole abaixo a URL /exec de um TERCEIRO projeto Apps Script
 *    (cópia do PORTAL-ESCRITA, PAPEL "ESCRITA", mesmas Propriedades do script).
 *    Tudo de Atividades, Processos, Arquivos, Mural e Aniversários passa a ir
 *    para ele, numa faixa própria — Propostas e Vendas ficam na ESCRITA e param
 *    de disputar lugar com o portal de atividades. Vazio = continua tudo na
 *    ESCRITA, como hoje. Depois de copiar, mova o acionador rfAquecerAtividades
 *    para o projeto novo (e apague-o na ESCRITA). A cota diária de UrlFetch da
 *    conta continua sendo uma só. */
const API_ATIVIDADES = "https://script.google.com/macros/s/AKfycbwmGaVaSo9kt2gIdpEbRof0WAoDFmamQjV87v5Vn2YTBGNXV1s_NmMFfGMNyEqIm0ut/exec";   // <<< URL /exec do projeto PORTAL-ATIVIDADES (opcional)
(function(){
  try{
    if(typeof _faixas!=="object") return;
    Object.keys(_faixas).forEach(k=>{ if(_faixas[k]&&_faixas[k].max<2) _faixas[k].max=2; });
    if(!API_ATIVIDADES||typeof urlDe!=="function"||typeof ACOES_NA_ESCRITA==="undefined") return;
    const RF=["procLista","procCriar","procUpdate","blocos","blocoUpdate","blocoNovo","blocoExcluir",
      "atvMinhas","atvOutras","atvAlertas","atvEquipe","atvDetalhe","atvAbrir","atvCriar","atvUpdate",
      "atvComentarios","atvComentarioNovo","atvModelos","atvModeloUpdate","atvModeloExcluir","atvModeloCriar",
      "atvOp","atvPortal","aniversariantes","atvMural","procLote","atvLote","blocoAnexar","ckLista","ckCriar",
      "ckMarcar","ckExcluir","atvMuralCheck","atvAnexoUrl","atvDelta","blocoMover","blocoAnexarUrl","blocoAnexarDoSupa",
      "atvOutraAbrir","atvOutraGravar","atvComentarioExcluir"];
    const urlAntes=urlDe;
    urlDe=function(action){ return RF.indexOf(action)>=0 ? API_ATIVIDADES : urlAntes(action); };
    if(!_faixas.atv) _faixas.atv={ max:2, emVoo:0, fila:[] };
    const faixaAntes=faixaDe;
    faixaDe=function(action){ const f=faixaAntes(action); return (RF.indexOf(action)>=0 && f!==_faixas.chat) ? _faixas.atv : f; };
  }catch(e){}
})();

/* v9 (16/10) — FAIXA SÓ PARA "ABRIR/GRAVAR ATIVIDADE DE OUTRA ABA"
 * Medido ao vivo: o servidor responde em 2–5 s, mas a janela ficava 20–30 s em
 * "Abrindo a atividade…" porque o pedido esperava, na faixa do chat, o Mural,
 * os aniversários e os checklists que a tela carrega ao abrir. Agora tem faixa
 * própria (mesma implantação PORTAL-ATIVIDADES) e não espera ninguém. */
(function(){
  try{
    if(typeof _faixas!=="object"||typeof faixaDe!=="function") return;
    if(!_faixas.outra) _faixas.outra={ max:2, emVoo:0, fila:[] };
    const antes=faixaDe, SO=["atvOutraAbrir","atvOutraGravar"];
    faixaDe=function(action){ return SO.indexOf(action)>=0 ? _faixas.outra : antes(action); };
  }catch(e){}
})();
