-- LazyPO — Scope of Work drafts (synced to Supabase, auto-deleted after 7 days)
-- Run this once in your Supabase SQL editor.
-- Safe to re-run (idempotent).
--
-- A draft is the complete state of the SoW email form — header fields,
-- signature, objectives, epics and theme — saved under a name so an
-- unfinished email can be picked up again later, from any device.
--
-- Drafts are temporary: a row is deleted 7 days after its last save
-- (`updated_at`). Saving a draft again renews the week. The purge runs
-- twice: a pg_cron job here (nightly) and, belt and braces, the client
-- deletes anything expired when it lists the drafts.
--
-- Until this runs, lazypo_generator.html keeps working from localStorage:
-- the cloud call fails, is caught, and the draft is flagged « cet appareil »
-- (this device only) — with the same 7-day purge, client-side.

-- ───────── Table ─────────
create table if not exists public.sow_drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.sow_drafts is
  'LazyPO Scope of Work drafts — one row per saved draft of the SoW email '
  'generator (lazypo_generator.html). `data` shape (v1): '
  '{ v, theme, fields:{<input id>: value}, objectives:[text], '
  'epics:[{name,ticket,desc,benefits[],release}] }. '
  'Several drafts may share a name; the client de-duplicates by name. '
  'Rows are purged 7 days after updated_at (pg_cron job sow_drafts_purge).';

create index if not exists sow_drafts_user_updated_idx
  on public.sow_drafts (user_id, updated_at desc);

-- ───────── Auto-update updated_at ─────────
create or replace function public.touch_sow_drafts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_touch_sow_drafts on public.sow_drafts;
create trigger trg_touch_sow_drafts
  before update on public.sow_drafts
  for each row execute function public.touch_sow_drafts_updated_at();

-- ───────── Row-Level Security ─────────
alter table public.sow_drafts enable row level security;

drop policy if exists "sow_drafts_owner_all" on public.sow_drafts;
create policy "sow_drafts_owner_all"
  on public.sow_drafts
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ───────── Purge after 7 days ─────────
-- Same mechanism as livenote_temp_cleanup.sql. pg_cron ships with Supabase;
-- if it is not enabled on the project (Dashboard → Database → Extensions →
-- pg_cron), this block only prints a notice and the client-side purge does
-- the job on its own.
create or replace function public.purge_sow_drafts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  with deleted as (
    delete from public.sow_drafts
    where updated_at < now() - interval '7 days'
    returning id
  )
  select count(*) into deleted_count from deleted;
  if deleted_count > 0 then
    raise notice 'purge_sow_drafts: % draft(s) removed', deleted_count;
  end if;
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) — sow_drafts are purged client-side only', sqlerrm;
    return;
  end;

  perform cron.unschedule(jobid) from cron.job where jobname = 'sow_drafts_purge';
  -- Every night at 03:17 UTC.
  perform cron.schedule('sow_drafts_purge', '17 3 * * *', 'select public.purge_sow_drafts()');
end$$;
