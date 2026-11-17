-- =====================================================================
-- orc_previas · PORTAL-MORAIS — 16/11/2026
-- Planilha prévia do orçamento de cada obra (aba "3D e Orçamento" da janela da obra).
-- Rodar UMA vez no SQL Editor do projeto Supabase ORÇADO/REALIZADO (o mesmo do catálogo mc_*).
-- Quem lê e grava: só o Apps Script do portal (MapaObras.gs, ações orcPreviaLer / orcPreviaSalvar),
-- com a service key. Sem política de RLS: o navegador não acessa direto.
-- =====================================================================
create table if not exists public.orc_previas (
  obra_id   text primary key,              -- id da obra no Notion, sem traços
  obra      text,                          -- endereço (só para quem olhar a tabela)
  dados     jsonb not null,                -- {linhas:[...], mult:{...}, modelo:"...", gerado_em, ...}
  salvo_por text,
  salvo_em  timestamptz not null default now(),
  versao    integer not null default 1
);
alter table public.orc_previas enable row level security;

-- 17/11/2026 (mo16): estado do "Enviar ao Mais Controle" — travado, quem pediu, situação do robô do servidor,
-- cópia de segurança do orçamento que estava no MC e histórico de envios/desbloqueios (só a senha da Paula destrava).
alter table public.orc_previas add column if not exists envio jsonb;
