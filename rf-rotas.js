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
 * ------------------------------------------------------------------------ */
(function(){
  try{
    if(typeof ACOES_NA_ESCRITA==="undefined"||!Array.isArray(ACOES_NA_ESCRITA)) return;
    ["procLista","procCriar","procUpdate","blocos","blocoUpdate","blocoNovo","blocoExcluir",
     "atvMinhas","atvOutras","atvAlertas","atvEquipe","atvDetalhe","atvAbrir","atvCriar","atvUpdate",
     "atvComentarios","atvComentarioNovo","atvModelos","atvModeloUpdate","atvModeloExcluir","atvModeloCriar",
     "atvOp","atvPortal","aniversariantes",
     /* v5 */ "atvMural","procLote","atvLote","blocoAnexar","ckLista","ckCriar","ckMarcar","ckExcluir",
     /* v6 (28/09) */ "atvMuralCheck", /* v7 */ "atvAnexoUrl", /* v8 */ "atvDelta", /* v9 */ "blocoMover"
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
    const CHAT=["atvComentarios","atvComentarioNovo","atvAnexoUrl","atvOp","atvMuralCheck","atvUpdate",
                "atvMural","aniversariantes","ckLista","atvModelos"];
    if(!_faixas.chat) _faixas.chat={ max:1, emVoo:0, fila:[] };
    const original=faixaDe;
    faixaDe=function(action){ return CHAT.indexOf(action)>=0 ? _faixas.chat : original(action); };
  }catch(e){}
})();
