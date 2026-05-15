-- ═══════════════════════════════════════════════════════════════
--  PLAYER PROFILE POPUP — open RLS so any user can view any other
--  player's XP state and daily XP breakdown.
--
--  À exécuter UNE FOIS dans Supabase → SQL Editor → New query → Run.
--  Idempotent : peut être ré-exécuté sans risque.
--
--  Tables concernées :
--    - user_xp_state    : total_xp, current_streak_days …
--    - xp_daily_log     : breakdown XP jour-par-jour
--
--  (quiz_sessions / quiz_session_comments / profiles sont déjà
--   publiquement lisibles puisque le feed multi les affiche.)
-- ═══════════════════════════════════════════════════════════════

-- ─── user_xp_state : public read ─────────────────────────────────
alter table public.user_xp_state enable row level security;

drop policy if exists "user_xp_state_public_read" on public.user_xp_state;
create policy "user_xp_state_public_read"
  on public.user_xp_state
  for select
  using (true);

-- (les policies INSERT/UPDATE existantes ne sont PAS modifiées —
--  seul l'utilisateur lui-même peut écrire dans sa propre ligne.)


-- ─── xp_daily_log : public read ──────────────────────────────────
alter table public.xp_daily_log enable row level security;

drop policy if exists "xp_daily_log_public_read" on public.xp_daily_log;
create policy "xp_daily_log_public_read"
  on public.xp_daily_log
  for select
  using (true);


-- ─── Vérifications ───────────────────────────────────────────────
-- Doit renvoyer 2 lignes : user_xp_state_public_read + xp_daily_log_public_read
select schemaname, tablename, policyname, cmd
from   pg_policies
where  tablename in ('user_xp_state', 'xp_daily_log')
  and  policyname like '%_public_read';
