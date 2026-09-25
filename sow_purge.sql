-- LazyPO — purge « Scope of Work » (incident du 2026-09-25)
-- À exécuter à la main dans Supabase → SQL Editor. Idempotent, sans retour.
--
-- Supprime tout ce que le module Scope of Work (lazypo_generator.html)
-- affiche ou stocke côté serveur, pour TOUS les utilisateurs :
--   1. sow_drafts        — brouillons d'e-mail SoW (en-têtes, destinataires,
--                          signature, objectifs, epics)
--   2. profiles.pi       — les epics/features importées de Jira, qui
--                          alimentent le SoW (le PI garde ses dates,
--                          sprints et releases)
-- Les blocs 3 et 4 sont OPTIONNELS (autres contenus d'origine pro).

-- ───────── 0. Constat avant purge ─────────
select (select count(*) from public.sow_drafts)                          as sow_drafts_rows,
       (select count(*) from public.profiles
         where jsonb_array_length(coalesce(pi->'features','[]'::jsonb)) > 0) as profiles_with_epics;

-- ───────── 1. Brouillons de Scope of Work ─────────
do $$
begin
  if to_regclass('public.sow_drafts') is not null then
    truncate table public.sow_drafts;
  end if;
end$$;

-- ───────── 2. Epics du PI (features Jira) ─────────
update public.profiles
   set pi = jsonb_set(pi, '{features}', '[]'::jsonb)
 where pi ? 'features'
   and jsonb_array_length(coalesce(pi->'features','[]'::jsonb)) > 0;

-- ───────── 3. (optionnel) requêtes JQL sauvegardées + liens Jira ─────────
-- truncate table public.jira_queries;

-- ───────── 4. (optionnel) notes de réunion LiveNote ─────────
-- truncate table public.livenote_docs;

-- ───────── Vérification ─────────
select (select count(*) from public.sow_drafts)                          as sow_drafts_rows,
       (select count(*) from public.profiles
         where jsonb_array_length(coalesce(pi->'features','[]'::jsonb)) > 0) as profiles_with_epics;
