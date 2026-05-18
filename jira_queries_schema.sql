-- LazyPO — Jira Query Saver (synced to Supabase + Realtime)
-- Run this once in your Supabase SQL editor.
-- Safe to re-run (idempotent).

-- ───────── Table ─────────
create table if not exists public.jira_queries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  query         text not null,
  tag           text not null default 'DPnxt',
  copy_count    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  jira_link     text
);

-- Add column if upgrading from an earlier version of this schema
alter table public.jira_queries add column if not exists jira_link text;

create index if not exists jira_queries_user_id_idx on public.jira_queries (user_id);

-- ───────── Auto-update updated_at ─────────
create or replace function public.touch_jira_queries_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_touch_jira_queries on public.jira_queries;
create trigger trg_touch_jira_queries
  before update on public.jira_queries
  for each row execute function public.touch_jira_queries_updated_at();

-- ───────── Row-Level Security ─────────
alter table public.jira_queries enable row level security;

drop policy if exists "jira_queries_owner_all" on public.jira_queries;
create policy "jira_queries_owner_all"
  on public.jira_queries
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ───────── Realtime support ─────────
-- replica identity full ensures DELETE events include the full row
-- (needed by the client to know which row vanished)
alter table public.jira_queries replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jira_queries'
  ) then
    alter publication supabase_realtime add table public.jira_queries;
  end if;
end$$;
