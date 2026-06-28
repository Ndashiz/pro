-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Users / Module Access / Admin Notifications
-- À exécuter une fois dans Supabase SQL Editor.
--
-- Ce script ajoute :
--   1. profiles.allowed_modules  (text[])  — modules autorisés
--   2. table module_access_requests        — demandes d'accès
--   3. table admin_notifications           — notifs in-app pour admins
--   4. triggers : auto-création profile + notif admin sur signup
--   5. RLS adaptée
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. profiles : allowed_modules + backfill
-- ───────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists allowed_modules text[] not null default array['quiz']::text[];

-- Admins : tous les modules (cohérent avec leur rôle)
update public.profiles
   set allowed_modules = array['quiz','scope','sprint','jira','livenote','minutehub','focusfm']::text[]
 where is_admin = true;

-- Utilisateurs existants : on leur garde au moins quiz
update public.profiles
   set allowed_modules = array['quiz']::text[]
 where allowed_modules is null or array_length(allowed_modules, 1) is null;

-- Policies admin sur profiles (besoin pour la page admin)
drop policy if exists "admin_read_profiles"   on public.profiles;
drop policy if exists "admin_update_profiles" on public.profiles;

create policy "admin_read_profiles" on public.profiles
  for select using (public.is_admin(auth.uid()));

create policy "admin_update_profiles" on public.profiles
  for update using (public.is_admin(auth.uid()));

-- ───────────────────────────────────────────────────────────────────
-- 2. module_access_requests
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.module_access_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  module_id   text not null,
  status      text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  message     text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);

-- Empêche les doublons "pending" pour le même couple user/module
create unique index if not exists module_access_pending_uniq
  on public.module_access_requests (user_id, module_id)
  where status = 'pending';

create index if not exists module_access_user_idx
  on public.module_access_requests (user_id);

alter table public.module_access_requests enable row level security;

drop policy if exists "user_read_own_requests"    on public.module_access_requests;
drop policy if exists "user_create_own_requests"  on public.module_access_requests;
drop policy if exists "admin_read_all_requests"   on public.module_access_requests;
drop policy if exists "admin_update_requests"     on public.module_access_requests;

create policy "user_read_own_requests" on public.module_access_requests
  for select using (auth.uid() = user_id);

create policy "user_create_own_requests" on public.module_access_requests
  for insert with check (auth.uid() = user_id);

create policy "admin_read_all_requests" on public.module_access_requests
  for select using (public.is_admin(auth.uid()));

create policy "admin_update_requests" on public.module_access_requests
  for update using (public.is_admin(auth.uid()));

-- ───────────────────────────────────────────────────────────────────
-- 3. admin_notifications
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.admin_notifications (
  id              uuid primary key default gen_random_uuid(),
  type            text not null,             -- 'signup' | 'access_request' | …
  title           text not null,
  body            text,
  link            text,
  related_user_id uuid references auth.users(id) on delete set null,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists admin_notifs_unread_idx
  on public.admin_notifications (is_read, created_at desc);

alter table public.admin_notifications enable row level security;

drop policy if exists "admin_read_notifs"    on public.admin_notifications;
drop policy if exists "admin_update_notifs"  on public.admin_notifications;

create policy "admin_read_notifs" on public.admin_notifications
  for select using (public.is_admin(auth.uid()));

create policy "admin_update_notifs" on public.admin_notifications
  for update using (public.is_admin(auth.uid()));

-- ───────────────────────────────────────────────────────────────────
-- 4a. Trigger sur auth.users : crée le profile + notif admin
-- ───────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_username text;
begin
  meta_username := nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), '');

  -- Crée la ligne profile si absente (defaults : allowed_modules = ['quiz'])
  -- Le username vient des metadata si fourni au signup, sinon NULL (sera dérivé de l'email côté UI)
  insert into public.profiles (id, username)
  values (new.id, meta_username)
  on conflict (id) do update
    set username = coalesce(public.profiles.username, excluded.username);

  -- Notifie les admins
  insert into public.admin_notifications (type, title, body, link, related_user_id)
  values (
    'signup',
    'Nouvel utilisateur',
    coalesce(meta_username || ' (' || new.email || ')', new.email, 'Un utilisateur') || ' vient de s''inscrire sur LazyPO.',
    'admin.html',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ───────────────────────────────────────────────────────────────────
-- 4b. Trigger sur module_access_requests : notifie l'admin
-- ───────────────────────────────────────────────────────────────────
create or replace function public.handle_access_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_addr text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select email into email_addr from auth.users where id = new.user_id;

  insert into public.admin_notifications (type, title, body, link, related_user_id)
  values (
    'access_request',
    'Demande d''accès module',
    coalesce(email_addr, 'Un utilisateur') || ' demande l''accès à « ' || new.module_id || ' ».',
    'admin.html',
    new.user_id
  );

  return new;
end;
$$;

drop trigger if exists on_access_request_created on public.module_access_requests;
create trigger on_access_request_created
  after insert on public.module_access_requests
  for each row execute procedure public.handle_access_request();

-- ───────────────────────────────────────────────────────────────────
-- 5. RPC : approve_access_request — atomique (status + allowed_modules)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.approve_access_request(req_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.module_access_requests%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select * into r from public.module_access_requests where id = req_id and status = 'pending';
  if not found then
    raise exception 'Request not found or not pending';
  end if;

  update public.profiles
     set allowed_modules = (
       select array(select distinct unnest(coalesce(allowed_modules, array[]::text[]) || array[r.module_id]))
     )
   where id = r.user_id;

  update public.module_access_requests
     set status = 'approved',
         decided_at = now(),
         decided_by = auth.uid()
   where id = req_id;
end;
$$;

create or replace function public.reject_access_request(req_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  update public.module_access_requests
     set status = 'rejected',
         decided_at = now(),
         decided_by = auth.uid()
   where id = req_id and status = 'pending';
end;
$$;

grant execute on function public.approve_access_request(uuid) to authenticated;
grant execute on function public.reject_access_request(uuid)  to authenticated;
