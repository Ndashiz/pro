-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Multi : snapshot des mots dans quiz_sessions
-- ───────────────────────────────────────────────────────────────────
-- Pourquoi : la colonne word_ids stocke des UUID propres à la table
-- vocabulary du joueur qui a posté la session. Comme chaque user a sa
-- propre copie des mots (même pour les mots système, à cause de la
-- RLS), un autre user qui clique "Challenge Back" ne retrouve aucun
-- de ces UUID dans son propre vocabulaire → bouton inutile.
-- Solution : stocker un snapshot des mots (source, target, lang…)
-- pour que le Challenge Back puisse construire le quiz directement
-- sans lookup côté receveur.
-- ═══════════════════════════════════════════════════════════════════

alter table public.quiz_sessions
  add column if not exists words jsonb;

comment on column public.quiz_sessions.words is
  'Snapshot des mots utilisés dans la session [{source_word, target_translation, language_pair, example_sentence, tips}, …]. Permet à Challenge Back de fonctionner cross-user.';
