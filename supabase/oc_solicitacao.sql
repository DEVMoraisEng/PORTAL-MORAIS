-- =====================================================================
-- oc_solicitacao · PORTAL-MORAIS — 19/11/2026
-- Rodar UMA vez no SQL Editor do projeto Supabase ORÇADO/REALIZADO (o
-- mesmo da oc_conferencia). Pode rodar de novo sem estragar nada.
--
-- 1) Aba "Solicitações sem OC" do Mapa de Obras: solicitações de compra com
--    pelo menos um item de Bancada, Janela, Calhas/Rufos ou Portão que ainda
--    não virou OC. Quem escreve é o robô ocs do servidor (robo_mc_ocs.py);
--    o Apps Script (MapaObras.gs, ação ocSolicitacoes) só lê.
-- 2) Data da solicitação de cada OC da Conferência de OC (colunas novas na
--    oc_conferencia).
-- Nenhuma política de RLS: só a service key (servidor e Apps Script).
-- =====================================================================
create table if not exists public.oc_solicitacao (
  sol_id          text primary key,               -- id da solicitação no Mais Controle
  numero          integer,                        -- Nº da solicitação
  obra            text,                           -- obra da solicitação no MC
  criada_em       date,                           -- data da solicitação no MC
  aprovacao_mc    text,
  categorias      text,                           -- Bancada · Janela · Calhas e rufos · Portão
  itens           text,                           -- itens desses materiais ainda sem OC
  pendente        boolean not null default true,  -- algum desses itens ainda sem OC
  resolvida_em    timestamptz,                    -- quando o robô viu a OC criada (sai da aba)
  visto_em        timestamptz not null default now(),
  primeiro_visto  timestamptz not null default now()
);

create index if not exists oc_solicitacao_pendentes on public.oc_solicitacao (pendente, criada_em);

alter table public.oc_solicitacao enable row level security;

alter table public.oc_conferencia add column if not exists solicitacao_numero integer;
alter table public.oc_conferencia add column if not exists solicitacao_em date;
