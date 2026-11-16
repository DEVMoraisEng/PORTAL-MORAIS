-- =====================================================================
-- oc_conferencia · PORTAL-MORAIS — 16/11/2026
-- Conferência de compras (OC) no Mapa de Obras. Rodar UMA vez no SQL Editor
-- do projeto Supabase ORÇADO/REALIZADO (o mesmo das medições da semana).
--
-- Quem escreve:
--   - o robô do servidor (robo_mc_ocs.py), com a service key: cria a linha de
--     cada OC nova dos fornecedores da lista e atualiza os campos do Mais
--     Controle (aprovação, status da compra, cancelada) e o resultado do robô;
--   - o Apps Script do portal (MapaObras.gs, ações ocLista / ocResponder):
--     a resposta do engenheiro (SIM / NÃO), quem respondeu e quando.
-- Nenhuma política de RLS: só a service key (servidor e Apps Script) lê e grava.
-- =====================================================================
create table if not exists public.oc_conferencia (
  oc_id            uuid primary key,              -- id da OC no Mais Controle
  numero           integer,                       -- Nº da OC
  fornecedor       text not null,
  acao             text not null check (acao in ('APROVAR', 'PARCELA')),
  obra             text,                          -- obra / centro de custo da OC no MC
  descricao        text,
  criada_em        date,                          -- data de criação da OC no MC
  aprovacao_mc     text,                          -- como está no MC (código)
  status_compra_mc text,
  cancelada        boolean not null default false,
  resposta         text check (resposta in ('SIM', 'NAO')),   -- SERVIÇO FINALIZADO?
  respondido_por   text,
  respondido_em    timestamptz,
  robo_situacao    text check (robo_situacao in ('SIMULADO', 'FEITO', 'ERRO')),
  robo_msg         text,
  robo_em          timestamptz,
  robo_tentativas  integer not null default 0,
  anexos           integer,                       -- arquivos na aba Arquivos da OC (NF anexada) — null = não conferido
  anexos_nomes     text,
  anexos_em        timestamptz,
  visto_em         timestamptz not null default now(),        -- última vez que o robô viu a OC no MC
  criado_em        timestamptz not null default now()
);

create index if not exists oc_conferencia_pendentes on public.oc_conferencia (resposta, robo_situacao);
create index if not exists oc_conferencia_criada on public.oc_conferencia (criada_em desc);

alter table public.oc_conferencia enable row level security;

-- 16/11 (tarde): se a tabela já tinha sido criada antes das colunas de anexos
alter table public.oc_conferencia add column if not exists anexos integer;
alter table public.oc_conferencia add column if not exists anexos_nomes text;
alter table public.oc_conferencia add column if not exists anexos_em timestamptz;
