-- ════════════════════════════════════════════════════════════════════
-- LazyPO — Audit RLS Supabase
-- ────────────────────────────────────────────────────────────────────
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL Editor → New).
-- Aucune écriture, juste des SELECT — safe à lancer en prod.
--
-- Ce que tu vas voir :
--   Q1. Tables où RLS n'est PAS activée → URGENT à fixer
--   Q2. Tables avec RLS activée mais AUCUNE policy → tout est bloqué
--       (légitime sur certaines tables admin, mais à vérifier)
--   Q3. Policies trop permissives (USING true / NULL / public) → URGENT
--   Q4. Vue d'ensemble de toutes les policies pour review humaine
--
-- Comment fixer ce que les requêtes remontent :
--   - RLS désactivée → ALTER TABLE public.<nom> ENABLE ROW LEVEL SECURITY;
--   - Pas de policy → CREATE POLICY ... USING (auth.uid() = user_id);
--   - Policy trop large → DROP POLICY <nom> ON public.<table>;
--                          puis recrée avec une condition stricte
-- ════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- Q1. Tables PUBLIQUES sans RLS
-- ───────────────────────────────────────────────────────────────────
-- Ces tables sont lisibles par n'importe quel client authentifié
-- (même n'importe quel anonyme si l'API key anon a select).
-- Si une de ces tables apparaît, c'est probablement un oubli.
--
-- Tables attendues SANS RLS chez LazyPO : aucune.
-- Si vide → ✅ tout va bien.
select schemaname, tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and rowsecurity = false
order by tablename;


-- ───────────────────────────────────────────────────────────────────
-- Q2. Tables avec RLS activée mais AUCUNE policy
-- ───────────────────────────────────────────────────────────────────
-- Quand RLS est active sans policy, tout est bloqué (deny by default).
-- C'est sûr (rien n'est exposé) mais signale soit :
--   - Une table admin/service qui n'a pas besoin d'accès client (OK)
--   - Un oubli d'avoir créé les policies (à corriger)
select t.tablename
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
  and t.rowsecurity = true
  and p.policyname is null
order by t.tablename;


-- ───────────────────────────────────────────────────────────────────
-- Q3. Policies SUSPECTES (potentiellement trop permissives)
-- ───────────────────────────────────────────────────────────────────
-- Détecte les policies qui ne filtrent pas sur auth.uid() OU qui
-- utilisent USING true / qual=true. Si une policy SELECT sur une
-- table sensible (vocabulary, profiles…) apparaît ici, c'est un trou.
--
-- ATTENTION aux faux positifs : certaines tables sont LÉGITIMEMENT
-- lisibles par tous les authentifiés (quiz_sessions, comments,
-- reactions). Le but : revue humaine, pas auto-fix.
select
  tablename,
  policyname,
  cmd as operation,
  roles,
  case
    when qual = 'true' or qual is null then '⚠️  AUCUNE CONDITION (everyone matches)'
    when qual not ilike '%auth.uid()%' then '⚠️  Pas de filtre auth.uid()'
    else '✓ filtre auth.uid() présent'
  end as verdict,
  qual as full_using_clause
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or qual is null or qual not ilike '%auth.uid()%')
order by tablename, policyname;


-- ───────────────────────────────────────────────────────────────────
-- Q4. Vue d'ensemble — toutes les policies (pour review)
-- ───────────────────────────────────────────────────────────────────
-- Liste exhaustive : table, nom de policy, opération (SELECT/INSERT/
-- UPDATE/DELETE/ALL), filtre USING et filtre WITH CHECK.
-- Utile pour faire un check global après ajout d'une nouvelle table.
select
  tablename,
  policyname,
  cmd as operation,
  qual         as using_clause,
  with_check   as with_check_clause
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;


-- ───────────────────────────────────────────────────────────────────
-- Q5. BONUS — Inventaire complet des tables + nombre de policies
-- ───────────────────────────────────────────────────────────────────
-- Tableau de bord rapide : 1 ligne par table, RLS on/off, nombre de
-- policies. Permet de repérer en un coup d'œil les anomalies.
select
  t.tablename,
  t.rowsecurity as rls,
  count(p.policyname) as policy_count
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.tablename;
