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
 * ------------------------------------------------------------------------ */
(function(){
  try{
    if(typeof ACOES_NA_ESCRITA==="undefined"||!Array.isArray(ACOES_NA_ESCRITA)) return;
    ["procLista","procCriar","procUpdate","blocos","blocoUpdate","blocoNovo","blocoExcluir",
     "atvMinhas","atvOutras","atvAlertas","atvEquipe","atvDetalhe","atvAbrir","atvCriar","atvUpdate",
     "atvComentarios","atvComentarioNovo","atvModelos","atvModeloUpdate","atvModeloExcluir","atvModeloCriar",
     "atvOp","atvPortal","aniversariantes"
    ].forEach(a=>{ if(ACOES_NA_ESCRITA.indexOf(a)<0) ACOES_NA_ESCRITA.push(a); });
  }catch(e){}
})();
