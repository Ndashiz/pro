-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Quiz : fenêtre glissante des dernières réponses par mot
-- ───────────────────────────────────────────────────────────────────
-- Pourquoi : la « maîtrise » d'un mot était mesurée sur le ratio
-- lifetime correct/attempts. Un mot raté 3 fois au début puis réussi
-- 10 fois affichait 77% et restait « fragile » à vie — les vieux
-- échecs plombaient définitivement le score.
-- Solution : stocker les 10 dernières réponses (1 = correct, 0 = raté)
-- dans une colonne jsonb. La maîtrise (≥80%), les mots « fragiles »
-- (<60%) et l'XP de maîtrise se calculent sur cette fenêtre glissante
-- dès qu'elle contient ≥3 réponses (sinon fallback sur le lifetime).
-- Le front (quiz.html) est rétro-compatible : si cette migration n'a
-- pas été appliquée, il retombe automatiquement sur le ratio lifetime.
-- ═══════════════════════════════════════════════════════════════════

alter table public.quiz_progress
  add column if not exists recent jsonb default '[]'::jsonb;

comment on column public.quiz_progress.recent is
  'Fenêtre glissante des 10 dernières réponses pour ce mot : [1,0,1,1,…] (1 = correct, 0 = raté). Utilisée pour la maîtrise/fragilité à la place du ratio lifetime.';
