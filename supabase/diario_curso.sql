-- =====================================================================
-- diario_curso · PORTAL-MORAIS — 23/11/2026
-- Diário do Curso Revit dos estagiários (diario-curso.html, menu REUNIÕES).
-- Rodar UMA vez no SQL Editor do projeto Supabase ORÇADO/REALIZADO
-- (o mesmo do orc_previas e do bucket "atividades").
-- Quem lê e grava: só o Apps Script do portal (apps-script/DiarioCurso.gs, projeto
-- PORTAL-LEITURA) com a service key. RLS ligado e SEM política: o navegador não
-- acessa nada direto, nem as tabelas nem os prints.
-- =====================================================================

-- Um estagiário = um diário. A linha nasce sozinha na 1ª vez que ele abre a página.
create table if not exists public.diario_estagiarios (
  login      text primary key,                 -- login do portal (minúsculo)
  nome       text,                             -- nome da pessoa no LOGINS
  fora       jsonb not null default '[]',      -- módulos que NÃO fazem parte da ementa dele (ex.: ["A1-01"])
  ativo      boolean not null default true,    -- false = some da visão do ADM (estágio acabou)
  criado_em  timestamptz not null default now()
);

-- Relatórios do diário. "pagina" = quinzena (1 = 24/11 a 08/12/2026, 2 = 09/12 a 23/12, ...).
create table if not exists public.diario_registros (
  id         uuid primary key default gen_random_uuid(),
  login      text not null,
  pagina     integer not null,
  texto      text not null default '',
  fotos      jsonb not null default '[]',      -- caminhos no bucket diario-curso
  criado_em  timestamptz not null default now(),
  editado_em timestamptz
);
create index if not exists diario_registros_login_pag on public.diario_registros (login, pagina);

-- Aulas concluídas (check da ementa). "pagina" = quinzena em que foi marcada:
-- depois que a página trava, o check não pode mais ser desmarcado.
create table if not exists public.diario_checks (
  login     text not null,
  item      text not null,                     -- id da aula, ex.: "A1-03-07"
  feito_em  timestamptz not null default now(),
  pagina    integer not null,
  primary key (login, item)
);

alter table public.diario_estagiarios enable row level security;
alter table public.diario_registros   enable row level security;
alter table public.diario_checks      enable row level security;

-- Bucket PRIVADO dos prints (o portal mostra por link assinado).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diario-curso', 'diario-curso', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

-- Conferência rápida depois de rodar:
--   select count(*) from public.diario_estagiarios;   -- 0 no começo
--   select id, public from storage.buckets where id = 'diario-curso';   -- public = false
