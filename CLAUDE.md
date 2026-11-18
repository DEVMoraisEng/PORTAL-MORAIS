
## REGRAS TRAVADAS — leia antes de mexer em status de venda
Antes de alterar qualquer lógica de VENDIDA / RESERVADA / DISPONÍVEL do mapa de vendas das casas de rua, leia
`REGRAS-TRAVADAS.md`. Se o pedido muda uma regra de lá: **não altere** — responda que a regra foi travada pelo
Morais (11/11/2026), diga qual é a regra atual e peça a confirmação dele. Não ajuste o teste
`tests/test_mapa_casa_de_rua.py` para fazer a mudança passar.

## Conferência de celular — vale para TODO o portal
Regra do dono (18/11/2026), depois de a aba Propostas do `simulacoes.html` abrir com 861 px num celular de 375 px.

- Toda alteração de tela, tela nova, janela/modal nova, tabela nova ou coluna nova só está **pronta** depois de
  conferida em **360x800, 375x812 e 414x896**, além do desktop (1366x768 e 1920x1080).
- Critérios:
  - sem rolagem horizontal da página: `document.documentElement.scrollWidth <= window.innerWidth`;
  - tabela larga rola **dentro** do próprio contêiner (`overflow-x:auto`), sem esticar a página;
  - modal e janela fixa cabem na largura da tela e rolam na vertical;
  - campos empilham;
  - alvo de toque com pelo menos **44 px**;
  - fonte de input com **16 px** ou mais (para o iPhone não dar zoom).
- A entrega de qualquer mudança visual inclui o resultado do teste de `scrollWidth` de cada tela e **um print em
  375x812 de cada tela tocada**.
- Se uma tela existente já falhar nesses critérios, **avisar antes de continuar** em vez de ignorar.

Armadilha que causou o caso de 18/11: item de `grid`/`flex` tem `min-width:auto` e cresce até a largura da
tabela de dentro, mesmo com o `.tbl-wrap` rolando — a página inteira estica e o celular aumenta o `innerWidth`.
Cartão que contém tabela larga dentro de grid/flex precisa de `min-width:0`. Para achar o culpado, procure o
elemento mais externo que passa da tela sem nenhum ancestral com `overflow-x` diferente de `visible`.
