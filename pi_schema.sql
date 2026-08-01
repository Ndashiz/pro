-- LazyPO — PI Settings (the Program Increment, synced to Supabase)
-- Run this once in your Supabase SQL editor.
-- Safe to re-run (idempotent).
--
-- The PI is one document per user, so it lives as a jsonb column on
-- `profiles` rather than in its own table — the same shape as
-- profiles.countdowns, profiles.overview_widgets and profiles.todo_tasks.
--
-- Until this runs, pi.js keeps working from localStorage: the cloud write
-- fails, is caught, and the page reports "saved on this device only".
-- Running it turns the PI into a cross-device single source of truth.

-- ───────── Column ─────────
alter table public.profiles
  add column if not exists pi jsonb not null default '{}'::jsonb;

comment on column public.profiles.pi is
  'LazyPO Program Increment — the single source of truth read by pi.html, '
  'gantt.html, sprintplanner.html and lazypo_generator.html. Shape (v1): '
  '{ v, name, start, end, sprintLen, '
  'releases:[{id,name,date}], '
  'features:[{id,key,name,description,benefits[],fixVersion,epic,epicKey,order,source,offset}], '
  'testing:[{id,label,start,end}], off:[{id,name,reason,start,end}], '
  'sprintMeta:{}, fileName, updatedAt }. '
  'All dates are plain YYYY-MM-DD strings; `end` is the last day, inclusive. '
  'Sprints are derived from start/end/sprintLen, never stored. '
  '`source` is "jira" or "manual" — a re-import overrides the former and '
  'preserves the latter.';

-- ───────── Row-Level Security ─────────
-- No new policy is needed: public.profiles already has RLS enabled and its
-- existing owner policies cover every column. This block only verifies that,
-- so a misconfigured project fails loudly here instead of leaking a PI.
do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles' and rowsecurity = true
  ) then
    raise exception
      'public.profiles does not have row level security enabled — refusing to '
      'add profiles.pi. Run users_schema.sql first.';
  end if;
end$$;
