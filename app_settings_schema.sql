-- LazyPO — Réglages globaux (interrupteurs) pilotés depuis Jarvis
-- À exécuter une fois dans Supabase → SQL Editor. Idempotent.
--
-- Trois interrupteurs, lus par le Worker (edge), par auth.js (front) et
-- par des policies RLS restrictives (base) :
--   site_disabled            → tout ndashiz.be/lazypo2/* répond 404 (Worker, ~30 s de cache)
--   livenote_disabled        → LiveNote disparaît de la sidebar, ses pages répondent 404,
--                              la table livenote_docs est verrouillée
--   livenote_files_disabled  → plus de transfert de fichiers dans LiveNote
--                              (drop / collage d'images) : UI + policy sur le bucket
--
-- Qui écrit ?
--   • Jarvis, via la RPC set_app_setting(key, value, secret) : clé publishable
--     + un secret partagé rangé dans app_settings_secret (table sans aucune
--     policy, donc illisible par l'API — seule la RPC, security definer, la lit).
--   • un admin LazyPO connecté (policy is_admin) — pour un futur admin.html.
-- Qui lit ? tout le monde (anon + authenticated) : ce sont des flags, rien de sensible.

-- ───────── 1. Table + valeurs par défaut ─────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default 'false'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

comment on table public.app_settings is
  'LazyPO global switches (site_disabled, livenote_disabled, livenote_files_disabled). '
  'Written from Jarvis through set_app_setting(); read by the Worker, auth.js and RLS.';

insert into public.app_settings (key, value) values
  ('site_disabled',           'false'::jsonb),
  ('livenote_disabled',       'false'::jsonb),
  ('livenote_files_disabled', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_read_all" on public.app_settings;
create policy "app_settings_read_all"
  on public.app_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write"
  on public.app_settings for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ───────── 2. app_flag('key') → boolean ─────────
-- false si la clé manque ou n'est pas un booléen. Utilisable dans les policies.
create or replace function public.app_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when jsonb_typeof(value) = 'boolean' then (value)::boolean else false end
      from public.app_settings where key = p_key
  ), false);
$$;
grant execute on function public.app_flag(text) to anon, authenticated;

-- ───────── 3. Secret partagé avec Jarvis ─────────
create table if not exists public.app_settings_secret (
  id      int  primary key default 1 check (id = 1),
  secret  text not null
);
alter table public.app_settings_secret enable row level security;
revoke all on public.app_settings_secret from anon, authenticated;
-- (aucune policy : la table est invisible via l'API REST)

-- ⚠ UNE FOIS, à la main : génère le secret et copie-le dans Jarvis
--   (variable LAZYPO_SETTINGS_SECRET du backend). Relancer cette requête
--   fait tourner le secret.
--
-- insert into public.app_settings_secret (id, secret)
--   values (1, encode(gen_random_bytes(24), 'hex'))
--   on conflict (id) do update set secret = excluded.secret
--   returning secret;

-- ───────── 4. RPC set_app_setting(key, value, secret) ─────────
create or replace function public.set_app_setting(p_key text, p_value jsonb, p_secret text)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.app_settings;
begin
  if p_secret is null
     or not exists (select 1 from public.app_settings_secret where secret = p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_key not in ('site_disabled', 'livenote_disabled', 'livenote_files_disabled') then
    raise exception 'unknown setting: %', p_key using errcode = '22023';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'value must be a boolean' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_by)
  values (p_key, p_value, 'jarvis')
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = 'jarvis'
  returning * into r;
  return r;
end$$;
grant execute on function public.set_app_setting(text, jsonb, text) to anon, authenticated;

-- ───────── 5. Verrous côté base (policies RESTRICTIVES, donc en ET) ─────────
-- LiveNote coupé → plus aucune lecture / écriture de livenote_docs via l'API.
-- Ajouté seulement si la table a déjà le RLS activé : activer le RLS ici, sans
-- connaître les policies existantes, pourrait verrouiller tout le monde.
do $$
begin
  if to_regclass('public.livenote_docs') is null then
    raise notice 'livenote_docs absente — verrou livenote_disabled non posé';
  elsif not (select relrowsecurity from pg_class where oid = 'public.livenote_docs'::regclass) then
    raise notice 'livenote_docs sans RLS — verrou livenote_disabled non posé (le Worker et le front le font)';
  else
    execute 'drop policy if exists "livenote_docs_flag_gate" on public.livenote_docs';
    execute $p$
      create policy "livenote_docs_flag_gate" on public.livenote_docs
        as restrictive for all to anon, authenticated
        using (not public.app_flag('livenote_disabled'))
        with check (not public.app_flag('livenote_disabled'))
    $p$;
  end if;
end$$;

-- Transfert de fichiers coupé → plus d'upload dans le bucket livenote-temp.
drop policy if exists "livenote_temp_upload_flag_gate" on storage.objects;
create policy "livenote_temp_upload_flag_gate"
  on storage.objects as restrictive for insert
  to anon, authenticated
  with check (bucket_id <> 'livenote-temp' or not public.app_flag('livenote_files_disabled'));

-- ───────── Vérification ─────────
select key, value, updated_at, updated_by from public.app_settings order by key;
