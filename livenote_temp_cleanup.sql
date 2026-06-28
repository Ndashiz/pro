-- ════════════════════════════════════════════════════════════════════
-- LazyPO — Cleanup automatique du bucket livenote-temp
-- ────────────────────────────────────────────────────────────────────
-- À exécuter UNE FOIS dans Supabase SQL Editor.
--
-- POURQUOI :
--   Le code client utilise un setInterval pour supprimer les fichiers
--   à expiration. Si toutes les fenêtres LiveNote du document sont
--   fermées avant cette expiration, le fichier reste éternellement
--   sur Supabase Storage (et sa metadata dans livenote_docs.shared_files).
--
--   Ce job pg_cron garantit qu'aucun fichier ne survit plus de ~90 sec
--   après son upload, quelle que soit l'activité côté client. Aucune
--   trace ne persiste après ce délai.
--
-- ARCHITECTURE :
--   - Job 1 : supprime les objets storage.objects vieux de > 2 min
--             (le TTL côté client est 30 sec, on garde 90s de marge)
--   - Job 2 : nettoie les entrées orphelines dans livenote_docs.shared_files
--             (entries dont expiresAt est passé)
--   - Les deux jobs tournent toutes les minutes via pg_cron
-- ════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- Étape 1 : activer pg_cron
-- ───────────────────────────────────────────────────────────────────
-- Si l'extension n'est pas dispo sur ton projet Supabase, l'active via :
--   Dashboard → Database → Extensions → recherche "pg_cron" → Enable
create extension if not exists pg_cron;


-- ───────────────────────────────────────────────────────────────────
-- Étape 2 : fonction de nettoyage du bucket Storage
-- ───────────────────────────────────────────────────────────────────
-- Supprime tous les fichiers du bucket livenote-temp créés il y a plus
-- de 2 minutes. Supabase Storage est en sync avec storage.objects :
-- supprimer une row supprime aussi le binaire derrière (S3).
create or replace function public.cleanup_livenote_temp_files()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  deleted_count int;
begin
  with deleted as (
    delete from storage.objects
    where bucket_id = 'livenote-temp'
      and created_at < now() - interval '2 minutes'
    returning id
  )
  select count(*) into deleted_count from deleted;

  if deleted_count > 0 then
    raise notice 'cleanup_livenote_temp_files: % file(s) removed', deleted_count;
  end if;
end;
$$;


-- ───────────────────────────────────────────────────────────────────
-- Étape 3 : fonction de nettoyage des metadata DB orphelines
-- ───────────────────────────────────────────────────────────────────
-- Pour chaque ligne de livenote_docs, filtre le tableau shared_files
-- pour ne garder que les entrées dont expiresAt est dans le futur.
-- Les fichiers déjà supprimés du Storage par le job 2.5 ne devraient
-- pas rester dans la metadata.
create or replace function public.cleanup_livenote_orphan_metadata()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  doc record;
  cleaned jsonb;
begin
  for doc in
    select short_id, shared_files
    from livenote_docs
    where shared_files is not null
      and jsonb_typeof(shared_files) = 'array'
      and jsonb_array_length(shared_files) > 0
  loop
    select coalesce(jsonb_agg(entry), '[]'::jsonb) into cleaned
    from jsonb_array_elements(doc.shared_files) entry
    where (entry->>'expiresAt')::bigint > extract(epoch from now()) * 1000;

    if cleaned <> doc.shared_files then
      update livenote_docs set shared_files = cleaned where short_id = doc.short_id;
    end if;
  end loop;
end;
$$;


-- ───────────────────────────────────────────────────────────────────
-- Étape 4 : scheduler les jobs (toutes les minutes)
-- ───────────────────────────────────────────────────────────────────
-- Si tu réexécutes ce SQL, les anciens schedule du même nom seront écrasés
-- automatiquement par cron.schedule.
select cron.schedule(
  'cleanup-livenote-storage',
  '* * * * *',  -- toutes les minutes
  $$ select public.cleanup_livenote_temp_files(); $$
);

select cron.schedule(
  'cleanup-livenote-metadata',
  '* * * * *',
  $$ select public.cleanup_livenote_orphan_metadata(); $$
);


-- ════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS (à lancer à part pour confirmer)
-- ────────────────────────────────────────────────────────────────────
-- 1. Lister les jobs cron actifs :
--      select jobname, schedule, command, active from cron.job;
--    → tu dois voir cleanup-livenote-storage et cleanup-livenote-metadata
--
-- 2. Voir les 10 dernières exécutions (succès / échec) :
--      select jobname, status, start_time, end_time, return_message
--      from cron.job_run_details
--      order by start_time desc
--      limit 10;
--
-- 3. Forcer une exécution manuelle pour tester :
--      select public.cleanup_livenote_temp_files();
--      select public.cleanup_livenote_orphan_metadata();
--
-- 4. Vérifier qu'il ne reste rien de vieux dans le bucket :
--      select id, name, created_at
--      from storage.objects
--      where bucket_id = 'livenote-temp'
--        and created_at < now() - interval '2 minutes';
--    → doit retourner 0 ligne après quelques exécutions du cron.
--
-- POUR SUPPRIMER les jobs (rollback) :
--      select cron.unschedule('cleanup-livenote-storage');
--      select cron.unschedule('cleanup-livenote-metadata');
-- ════════════════════════════════════════════════════════════════════
