-- Extra info sur un mot du vocabulaire (temps du verbe, pluriel, préposition…).
-- Jamais affichée pendant la question — seulement à la correction (feedback,
-- Error Review, liste des mots ratés du résumé), pour ne rien dévoiler avant
-- la réponse. Différent de `tips`, qui est un indice montré PENDANT la question.
--
-- À exécuter une fois dans le SQL Editor Supabase (rien ne l'applique tout seul).
-- Sans cette colonne, l'ajout / la correction d'un mot avec une extra info
-- échoue côté Supabase (colonne inconnue) — à lancer AVANT de déployer quiz.html.
alter table public.vocabulary add column if not exists extra_info text;

comment on column public.vocabulary.extra_info is
  'Infos complémentaires révélées uniquement à la correction (ex. : liep – gelopen). Pas un indice : voir tips.';

-- Pas de nouvelle policy : own_vocabulary couvre déjà la colonne.
