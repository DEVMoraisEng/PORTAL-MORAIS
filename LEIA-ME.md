# Pacote completo — 23/09/2026 (rodada de melhorias + revisão de todas as telas)

## O que é NOVO nesta entrega (ainda não está no GitHub / Apps Script)

| Arquivo | Mudança |
|---|---|
| `app.js` | Dicas (tooltip + aria-label) em todos os botões, abas e filtros de TODAS as telas; tabelas com 60+ linhas só desenham o que está na tela; rotas de escrita das obras pela ESCRITA. |
| `sw.js` | Cache do service worker **v35** (obrigatório: sem isso o navegador continua servindo as telas antigas). |
| `obras.html` | Abre sempre em Obras; contas prontas na abertura (guardadas no navegador); busca na conta; aba Contas bancárias; investidores só consulta; dicas; índice de atividades por obra. |
| `index.html`, `vendas.html`, `ligacoes.html`, `pos-obra.html`, `simulacoes.html`, `analise.html`, `analise-dados.html`, `documentos.html` | `app.js?v=33` (para pegar o app.js novo). |
| `login.html`, `demandas.html`, `servicos.html` | Dicas nos botões (não carregam o app.js). |
| `apps-script/Codigo-LEITURA.gs` e `Codigo-ESCRITA.gs` | **r50**: LOGINS filtrado pelo login (não lê a base inteira a cada login/renovação); opções de select em cache nas gravações de Ligações/Vendas. |

## Já está no GitHub / Apps Script (vai junto só para ficar completo)
`ligacoes.html`, `pos-obra.html`, `simulacoes.html` (conteúdo já publicado; só mudou o `?v=33`),
`fetch_obras.py`, `espelhar_anexos.py`, `robo_mc_clientes.py`, `robo_mc_contas.py`, `robo_mc_obras.py`,
`robo_mc_comum.py`, `tests/*`, `.github/workflows/*`, `apps-script/Melhorias.gs` (m3).

## Ordem
1. **GitHub:** suba tudo (Add file → Upload files, arrastando as pastas). Os que já estavam iguais não geram mudança.
2. **Apps Script:** `Codigo-LEITURA.gs` no PORTAL-LEITURA e `Codigo-ESCRITA.gs` no PORTAL-ESCRITA → salvar → Implantar → Gerenciar implantações → lápis → **Nova versão**. O `?action=ping` tem que mostrar `"versao":"2026-09-23 r50"`.
3. Nas telas: **Ctrl+F5** uma vez. O service worker v35 troca o cache sozinho.

## Revisão feita nas telas
- Paginação: Notion → Apps Script e Notion → build já paginam (100 por página). As telas leem o dist/ inteiro, o que é o certo para os volumes atuais (96 obras, 731 ligações).
- N+1 corrigidos no r50: banco LOGINS lido inteiro para achar uma pessoa (login, renovação de acessos, senha ADM, distrato) e esquema da base baixado a cada gravação de select.
- Não mexi (mudam o desenho): fila única de leitura do Apps Script (mover leituras curtas para a ESCRITA no app.js), fontes do Google hospedadas fora do repositório, espelho no Supabase para as fotos do Pós Obra.
