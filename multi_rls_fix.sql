-- ════════════════════════════════════════════════════════════════════
-- LazyPO — Fix RLS Multi (feed + leaderboard cross-user)
-- ────────────────────────────────────────────────────────────────────
-- À exécuter UNE FOIS dans Supabase SQL Editor (Dashboard → SQL Editor → New).
--
-- Symptômes corrigés :
--   1. Le classement Multi ne montre que MOI (les autres joueurs absents)
--   2. Les sessions des autres joueurs n'apparaissent pas dans le fil
--   3. Les réactions / commentaires des autres ne s'affichent pas
--
-- Cause : RLS active sur quiz_sessions / quiz_session_reactions /
--         quiz_session_comments / xp_daily_log, mais policies SELECT
--         trop strictes (auth.uid() = user_id) → chaque user ne voit
--         que ses propres rows.
--
-- Modèle voulu :
--   - READ  : tout authentifié peut lire (Multi est un fil PUBLIC)
--   - WRITE : un user n'écrit / modifie / supprime QUE ses propres rows
--
-- Le script est IDEMPOTENT (drop+recreate) → safe à relancer.
-- ════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- DIAGNOSTIC — État actuel des policies (lance ça AVANT le fix)
-- ───────────────────────────────────────────────────────────────────
-- Tu devrais voir des SELECT policies avec `qual = '(auth.uid() = user_id)'`
-- sur les tables Multi. C'est elles le problème.
select
  tablename,
  policyname,
  cmd as op,
  qual as using_clause,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'quiz_sessions',
    'quiz_session_reactions',
    'quiz_session_comments',
    'xp_daily_log'
  )
order by tablename, cmd, policyname;


-- ════════════════════════════════════════════════════════════════════
-- ⚠️  À PARTIR D'ICI : ÉCRITURES — relis avant d'exécuter
-- ════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- 1. quiz_sessions  — fil d'activité Multi
-- ───────────────────────────────────────────────────────────────────
alter table public.quiz_sessions enable row level security;

drop policy if exists quiz_sessions_select_all     on public.quiz_sessions;
drop policy if exists quiz_sessions_select_own     on public.quiz_sessions;
drop policy if exists quiz_sessions_select         on public.quiz_sessions;
drop policy if exists "Allow all to select"        on public.quiz_sessions;

drop policy if exists quiz_sessions_insert_own     on public.quiz_sessions;
drop policy if exists quiz_sessions_insert         on public.quiz_sessions;
drop policy if exists quiz_sessions_update_own     on public.quiz_sessions;
drop policy if exists quiz_sessions_delete_own     on public.quiz_sessions;

create policy quiz_sessions_select_all on public.quiz_sessions
  for select using (auth.role() = 'authenticated');

create policy quiz_sessions_insert_own on public.quiz_sessions
  for insert with check (auth.uid() = user_id);

create policy quiz_sessions_update_own on public.quiz_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy quiz_sessions_delete_own on public.quiz_sessions
  for delete using (auth.uid() = user_id);


-- ───────────────────────────────────────────────────────────────────
-- 2. quiz_session_reactions — 👍 / réactions sur les sessions
-- ───────────────────────────────────────────────────────────────────
alter table public.quiz_session_reactions enable row level security;

drop policy if exists quiz_session_reactions_select_all  on public.quiz_session_reactions;
drop policy if exists quiz_session_reactions_select_own  on public.quiz_session_reactions;
drop policy if exists quiz_session_reactions_select      on public.quiz_session_reactions;

drop policy if exists quiz_session_reactions_insert_own  on public.quiz_session_reactions;
drop policy if exists quiz_session_reactions_update_own  on public.quiz_session_reactions;
drop policy if exists quiz_session_reactions_delete_own  on public.quiz_session_reactions;

create policy quiz_session_reactions_select_all on public.quiz_session_reactions
  for select using (auth.role() = 'authenticated');

create policy quiz_session_reactions_insert_own on public.quiz_session_reactions
  for insert with check (auth.uid() = user_id);

create policy quiz_session_reactions_update_own on public.quiz_session_reactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy quiz_session_reactions_delete_own on public.quiz_session_reactions
  for delete using (auth.uid() = user_id);


-- ───────────────────────────────────────────────────────────────────
-- 3. quiz_session_comments — commentaires sur les sessions
-- ───────────────────────────────────────────────────────────────────
alter table public.quiz_session_comments enable row level security;

drop policy if exists quiz_session_comments_select_all  on public.quiz_session_comments;
drop policy if exists quiz_session_comments_select_own  on public.quiz_session_comments;
drop policy if exists quiz_session_comments_select      on public.quiz_session_comments;

drop policy if exists quiz_session_comments_insert_own  on public.quiz_session_comments;
drop policy if exists quiz_session_comments_update_own  on public.quiz_session_comments;
drop policy if exists quiz_session_comments_delete_own  on public.quiz_session_comments;

create policy quiz_session_comments_select_all on public.quiz_session_comments
  for select using (auth.role() = 'authenticated');

create policy quiz_session_comments_insert_own on public.quiz_session_comments
  for insert with check (auth.uid() = user_id);

create policy quiz_session_comments_update_own on public.quiz_session_comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy quiz_session_comments_delete_own on public.quiz_session_comments
  for delete using (auth.uid() = user_id);


-- ───────────────────────────────────────────────────────────────────
-- 4. xp_daily_log — log journalier pour le classement XP
-- ───────────────────────────────────────────────────────────────────
alter table public.xp_daily_log enable row level security;

drop policy if exists xp_daily_log_select_all  on public.xp_daily_log;
drop policy if exists xp_daily_log_select_own  on public.xp_daily_log;
drop policy if exists xp_daily_log_select      on public.xp_daily_log;

drop policy if exists xp_daily_log_insert_own  on public.xp_daily_log;
drop policy if exists xp_daily_log_update_own  on public.xp_daily_log;
drop policy if exists xp_daily_log_delete_own  on public.xp_daily_log;

-- Lecture publique-authentifiée pour alimenter le leaderboard Multi
create policy xp_daily_log_select_all on public.xp_daily_log
  for select using (auth.role() = 'authenticated');

-- Écritures restent strictement par user
create policy xp_daily_log_insert_own on public.xp_daily_log
  for insert with check (auth.uid() = user_id);

create policy xp_daily_log_update_own on public.xp_daily_log
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy xp_daily_log_delete_own on public.xp_daily_log
  for delete using (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════
-- POST-CHECK — Relance le diagnostic en haut pour confirmer que les
-- 4 tables ont bien une policy SELECT avec `auth.role() = 'authenticated'`
-- et 3 policies (insert/update/delete) avec `auth.uid() = user_id`.
--
-- Test rapide côté UI :
--   1. Recharge la page Multi
--   2. Le leaderboard doit afficher tous les joueurs actifs (pas que toi)
--   3. Le fil d'activité doit montrer les sessions des autres joueurs
-- ════════════════════════════════════════════════════════════════════
