-- ════════════════════════════════════════════════════════════════════
-- VISION · banco próprio dentro de um Postgres COMPARTILHADO
--
-- Tudo do Vision vive no schema "vision" e o servidor conecta com o usuário
-- "vision_app", que só tem permissão de ler/gravar dados nesse schema. Este
-- script:
--   - não altera, não lê e não dá permissão em nada fora de "vision";
--   - não usa extensões, triggers, funções, publicações nem RLS de outros;
--   - não mexe em papéis existentes (só cria vision_app);
--   - pode rodar de novo sem efeito (if not exists);
--   - para se já existir um schema "vision" que não seja do Vision.
--
-- Rodar MANUALMENTE no SQL Editor do Supabase. Não use `supabase db push`
-- deste repositório: isso mexeria no histórico de migrations do outro sistema.
-- Antes, troque TROQUE_ESTA_SENHA por uma senha forte.
--
-- Remover o Vision por completo, sem tocar no resto:
--   drop schema vision cascade; drop role vision_app;
-- ════════════════════════════════════════════════════════════════════

-- 0. Trava: não reaproveita um schema "vision" de outro sistema
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'vision')
     and not exists (
       select 1 from pg_tables where schemaname = 'vision' and tablename = 'demands'
     )
     and exists (select 1 from pg_tables where schemaname = 'vision') then
    raise exception 'Já existe um schema "vision" com tabelas que não são do Vision. Nada foi alterado.';
  end if;
end $$;

-- 1. Usuário dedicado: só faz login, sem nenhum poder extra
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vision_app') then
    create role vision_app login password 'TROQUE_ESTA_SENHA'
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
      -- folga para o pooler do Supabase (o app em si usa até 3)
      connection limit 20;
  end if;
end $$;
alter role vision_app set search_path = vision;

-- 2. Schema próprio. A API do Supabase (anon/authenticated) não o enxerga: ele
--    não entra na lista de schemas expostos e não recebe grants para eles.
create schema if not exists vision;
revoke all on schema vision from public;

-- 3. Tabelas
create table if not exists vision.clients (
  id            text primary key,          -- clientId do War, ou "nome:<slug>" sem cadastro
  war_client_id text unique,
  name          text not null,
  instagram     text,
  drive         text,                      -- drive fixo do cliente
  squad         text,
  gestor        text,
  raw           jsonb,                     -- objeto "cliente" do último webhook
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists vision.demands (
  id                text primary key,      -- id da demanda no War
  client_id         text not null references vision.clients(id) on update cascade,
  client_name       text not null,
  title             text not null default '',
  priority          text,
  video_count       integer not null default 1,
  drive_editados    text,
  drive_materiais   text,
  briefing          text not null default '',
  briefing_text     text,
  instagram         text,
  gestor            text,
  solicitante       text,
  editor            text,                  -- "webdesigner" do War: só exibido
  squad             text,
  categoria         text,
  status            text not null,
  due_date          text,
  notas             jsonb not null default '[]',
  status_permitidos jsonb not null default '[]',
  callback_url      text,
  war_created_at    timestamptz,
  war_updated_at    timestamptz,
  status_changed_at timestamptz,
  sync_state        text not null default 'ok',   -- ok | error (devolução ao War)
  sync_error        text,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists demands_client_idx on vision.demands (client_id);
create index if not exists demands_status_idx on vision.demands (status);

create table if not exists vision.demand_videos (
  demand_id       text not null references vision.demands(id) on delete cascade,
  index           integer not null,        -- 1..quantidadeVideos
  project_id      text,                    -- receita em media/projects/<id>
  drive_file_id   text,
  drive_file_url  text,
  delivered_at    timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (demand_id, index)
);
create index if not exists demand_videos_project_idx on vision.demand_videos (project_id);

create table if not exists vision.demand_events (
  id              bigserial primary key,
  demand_id       text not null,
  direction       text not null,           -- in (do War) | out (para o War)
  kind            text not null,           -- created | updated | status | note
  status          text,
  previous_status text,
  by              text,
  payload         jsonb,
  ok              boolean not null default true,
  error           text,
  attempts        integer not null default 1,
  created_at      timestamptz not null default now()
);
create index if not exists demand_events_demand_idx on vision.demand_events (demand_id, created_at);

create table if not exists vision.notifications (
  id         bigserial primary key,
  demand_id  text not null,
  kind       text not null,                -- demand | note
  title      text not null,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recent_idx on vision.notifications (created_at desc);

-- tokens de integrações (Google Drive)
create table if not exists vision.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- login próprio do Vision (não usa auth.users do Supabase, que é do outro sistema)
create table if not exists vision.users (
  id            text primary key,
  name          text not null,
  email         text not null unique,      -- sempre minúsculo
  password_hash text not null,             -- scrypt$<sal>$<hash>
  role          text not null default 'editor',  -- admin | editor
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 4. Permissões: vision_app lê/grava dados SÓ no schema vision (sem DDL)
grant usage on schema vision to vision_app;
grant select, insert, update, delete on all tables in schema vision to vision_app;
grant usage, select on all sequences in schema vision to vision_app;

-- 5. Papéis da API do Supabase não tocam nas tabelas do Vision, mesmo que o
--    projeto tenha permissões padrão amplas (só age se os papéis existirem)
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema vision from %I', r);
      execute format('revoke all on all sequences in schema vision from %I', r);
      execute format('revoke all on schema vision from %I', r);
    end if;
  end loop;
end $$;

-- 6. RLS ligado com uma política que libera só o vision_app. Funciona igual se
--    o projeto tiver uma regra que liga RLS em toda tabela nova.
do $$
declare t text;
begin
  foreach t in array array['clients', 'demands', 'demand_videos', 'demand_events', 'notifications', 'settings', 'users'] loop
    execute format('alter table vision.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies where schemaname = 'vision' and tablename = t and policyname = 'vision_app_all'
    ) then
      execute format(
        'create policy vision_app_all on vision.%I for all to vision_app using (true) with check (true)', t
      );
    end if;
  end loop;
end $$;
