# Knowledge Quiz — Documentation

> Entraîneur de vocabulaire **EN→FR** et **NL→FR** (+ verbes irréguliers néerlandais), avec répétition espacée, gamification XP, et fil multijoueur.

---

## 1. Fichiers

| Fichier | Rôle |
|---------|------|
| `quiz.html` (~313 KB) | SPA complète : UI, logique, styles, état. C'est le cœur de la feature. |
| `worker/src/worker.js` | Worker Cloudflare — vérification JWT, garde l'accès à `/pro/quiz.html`. |
| `session.js` | Détection d'activité / déconnexion après 2h d'inactivité. |
| `demo.js` | Génération de données de démo. |
| `vocab_import_onboarding.js` | Flux de premier import avec détection de doublons. |
| `vocab_duplicate_modal.js` | UI de détection de doublons de vocabulaire. |
| `feedback_modal.js` | Soumission de feedback. |
| `auth.js` | Enregistrement / permissions des modules (quiz = module autorisé par défaut). |
| `sidebar.js` | Navigation (lien vers quiz.html). |
| `apis.js` | Registre des APIs (Supabase = backend principal). |

Dépendances chargées par `quiz.html` : `session.js`, `demo.js`, `vocab_import_onboarding.js`, `vocab_duplicate_modal.js`, lib `XLSX.js`, API Pravatar (avatars).

---

## 2. Vue d'ensemble

Le Knowledge Quiz est un entraîneur de vocabulaire bilingue avec 4 onglets dans `quiz.html` :

1. **🧠 Quiz** — moteur de quiz à répétition espacée (SM-2).
2. **📚 Vocabulary** — gestion du vocabulaire perso + mots système, import/export Excel.
3. **📊 Progress** — stats, heatmap, graphiques, détail XP.
4. **🌍 Multi** — fil social, classement, Challenge Back, réactions.
5. **🔤 Verbes NL** — entraîneur de conjugaison des verbes néerlandais (intégré au même fichier).

Caractéristiques clés : répétition espacée adaptative, fil multijoueur avec Challenge Back, gamification XP + streak, classement all-time, import/export Excel, partage de vocabulaire entre utilisateurs.

---

## 3. Modèle de données

### Tables Supabase

**`vocabulary`** — le vocabulaire
- `id`, `user_id` (RLS : propre uniquement)
- `source_word` (anglais ou néerlandais), `target_translation` (français)
- `language_pair` ('EN→FR' ou 'NL→FR', legacy 'nl-fr')
- `example_sentence`, `tips` (optionnels)
- `is_system` (bool) — marque le vocabulaire fourni par le système
- RLS `own_vocabulary`

**`quiz_progress`** — répétition espacée SM-2
- `word_id`, `correct`, `attempts`, `last_tested`
- `ease_factor` (défaut 2.5, plafonné), `interval_days` (défaut 1)
- `recent` (jsonb, 10 dernières réponses 1/0 — fenêtre glissante de maîtrise, migration `quiz_progress_recent.sql`)
- unique `(user_id, word_id)`, RLS `own_progress`

**`quiz_sessions`** — fil social / multi
- `display_name`, `avatar_url`, `score`, `total`, `duration_sec`
- `mode` ('vocab' | 'verbes'), `lang`, `direction` ('forward' | 'reverse' | 'auto')
- `words` (jsonb) — snapshot des mots joués → permet le Challenge Back **cross-user** (les IDs diffèrent d'un user à l'autre)
- `word_ids` (jsonb, déprécié au profit de `words`)

**`quiz_session_comments`** — commentaires sous chaque session (sert aussi à publier le résultat d'un Challenge Back).

**`quiz_session_reactions`** — réactions emoji `fire` / `muscle` / `clap`, clé `(session_id, user_id, type)`.

**`user_xp`** — XP & streak
- `total_xp` (cumul, jamais décrémenté), `current_streak_days`, `last_active_date`
- `last_reconciled_date`, `today_new_words`, `awarded_streak_milestones` (int[]), `mastered_word_ids` (uuid[])

**`xp_daily_log`** — historique XP par jour
- `(user_id, date)`, `xp_earned`, `breakdown` (jsonb par règle) → alimente la heatmap.

**`vocab_shares`** — partage de vocabulaire entre utilisateurs
- `sender_id`, `recipient_id`, `payload` (jsonb `{v, words:[{s,t,l,e?,p?}]}`), `status` ('pending'|'accepted'|'declined')

**`profiles`** — `username`, `avatar_url` (affichage classement & fil).

### localStorage

| Clé | Contenu |
|-----|---------|
| `lazypo_quiz_log` | Array `{date, words, correct, durationSec}` — calcul de streak local (fallback 28 j si `xp_daily_log` indispo). |
| `lazypo_verbs_progress` | Progression verbes NL `{verbId: {correct, attempts, …}}`. |
| `lazypo_new_intro` | `{date, count}` — nouveaux mots introduits aujourd'hui (plafond SRS 15/jour, par device). |
| `lazypo:lastActivity` | Timestamp d'activité (timeout de session). |

---

## 4. Sources des questions

1. **Vocabulaire système** (`is_system: true`) — 1000+ mots néerlandais (`dutch_vocabulary.sql`), catégories : nombres, jours, mois, saisons, couleurs, corps, famille, nourriture, animaux, nature, maison, vêtements, transport, école/travail, santé, sports, technologie. Lisible par tous via RLS.
2. **Vocabulaire utilisateur** (`is_system: false`) — ajout manuel EN/NL → FR, détection de doublon sur `(source_word, language_pair)`.
3. **Construction du quiz** (`buildQuizQueue()`) — filtre par paire de langue, système/user, taux de réussite ; option « mots ratés / fragiles » ; shuffle aléatoire ; direction forward / reverse / auto (50/50).

> **Pas d'intégration IA/LLM.** Les questions viennent du vocabulaire pré-chargé (SQL) et des traductions saisies par l'utilisateur. Aucune génération ni correction par LLM.

---

## 5. Scoring, répétition espacée & XP

### Répétition espacée (SM-2) — `recordAnswer()` + `buildQuizQueue()`
- Correct : `correct++`, `ease_factor += 0.1` (**plafonné à 2.5**), `interval_days × ease_factor`.
- Incorrect : `ease_factor = max(1.3, ease_factor − 0.2)`, `interval_days` revient à 1.
- **File SRS réelle** : `buildQuizQueue()` priorise (1) les mots **dus** (`last_tested + interval_days` dépassé, les plus fragiles d'abord), puis (2) les **nouveaux** mots (max 15/jour, compteur localStorage `lazypo_new_intro`), puis (3) les mots vus non dus en remplissage.
- Bannière « 🔔 N mots à réviser aujourd'hui » sur l'écran de setup (`#due-banner`).
- **Fenêtre glissante** : colonne `quiz_progress.recent` (jsonb, 10 dernières réponses 1/0 — migration `quiz_progress_recent.sql`). La maîtrise (≥80 %), les mots fragiles (<60 %) et l'XP de maîtrise se calculent sur cette fenêtre dès ≥3 réponses (`wordRate()`), sinon fallback ratio lifetime. Rétro-compatible si la migration n'est pas appliquée.

### Correction des réponses — `checkAnswer()`
- Exact (insensible à la casse) → ✓ Correct. Alternatives séparées par `" / "`.
- **« Accepté »** : accents ignorés + article initial ignoré (le/la/les/l'/un/une/des · de/het/een · the/a/an) via `normalizeAnswer()` — la forme exacte est rappelée dans le feedback.
- **« Proche »** : 1 typo (distance Damerau-Levenshtein = 1, transpositions incluses : « chein » → « chien »).

### Phrases à trous (cloze) — `buildClozeItem()`
- Option « 🧩 Mix (~1/3) » sur l'écran de setup (`#cloze-pills`, défaut : off).
- Quand la phrase d'exemple contient le mot source, ~1 question sur 3 devient un texte à trou : la phrase avec `_____`, la traduction affichée en indice, réponse = la forme réelle dans la phrase.
- La review des erreurs affiche la phrase à trou et le mot attendu (direction `cloze`).

### Règles XP (réconciliation 1×/jour UTC — `runXpReconciliation()`)

| Règle | XP | Déclencheur |
|-------|----|-------------|
| Paliers de streak | 30 × (jour/5) | Tous les 5 jours consécutifs (5→30, 10→60…) |
| 5 mots/jour | 25 | ≥5 nouveaux mots ajoutés aujourd'hui |
| Quiz parfait | 20 / session | 100 % à un quiz |
| Quiz long | 15 / session | ≥20 questions dans une session |
| Maîtrise d'un mot | 10 / mot (cap 50/j) | Taux ≥80 % (≥3 tentatives) |
| Récupération | 15 / mot | Mot faible repassé >75 % |
| Diversité modes | 10 | Joué 'vocab' ET 'verbes' aujourd'hui |
| Diversité directions | 10 | Forward ET reverse (vocab) aujourd'hui |
| 1er commentaire social | 5 | 1er commentaire sur la session d'un autre |

Sources de vérité : `user_xp.total_xp` (cumul) et `xp_daily_log` (détail par jour).

### Classement
- All-time par `total_xp`, départage par % moyen (`totalScore/totalPossible`).
- Top 5 affiché ; user courant affiché à part si hors top 5.

### Streak
- `user_xp.current_streak_days` ; reset si pas de quiz le jour même / consécutif. Fallback `computeStreak()` depuis `lazypo_quiz_log`.

---

## 6. Multijoueur & Challenge Back

### Fil social
- Paginé (20 sessions/page, lazy load), tri par date.
- Affiche nom, avatar, score/%, mode, ancienneté, nb commentaires.
- Réactions 🔥 / 💪 / 👏, commentaires imbriqués.
- Bouton Challenge Back visible si le snapshot `words` existe.

### Flux Challenge Back
1. Le quiz est rempli avec les **mots exacts** joués par l'autre user (cross-user safe via `words`).
2. L'utilisateur rejoue le même défi.
3. Résultats côte à côte « Moi » vs joueur d'origine → verdict Victoire 🏆 / Défaite / Égalité.
4. Option : publier le résultat en commentaire sur la session d'origine.
5. Option : ajouter les mots joués à son propre vocabulaire.

Implémentation : `launchChallengeQuiz(wordSnapshots, wordIdsFallback, originalMeta)` règle `challengeContext`. Fallback (sessions pré-snapshot) : recherche des IDs dans le vocab courant. La session de challenge n'est pas auto-postée (publication manuelle).

### Démo (admin only)
- `loadMultiDemoFeed()` génère 100 fausses sessions (noms, scores, réactions, commentaires). Challenge Back désactivé en démo.

---

## 7. Flux UI/UX

**Setup quiz** : paire de langue → direction → nombre de questions (5/10/20/50) → filtres (système, ratés/fragiles) → Start.

**Quiz actif** : timer 30 s par question, exemple + tip optionnels, saisie + Enter/Check, feedback ✅/❌, auto-advance, compteur de streak.

**Fin de session** : Review des erreurs (si présentes) → résumé (score, %, temps, badge streak) → panneau d'ajout (si Challenge Back) → auto-post au fil (sauf mode Challenge).

**Vocabulary** : formulaire d'ajout rapide, import/export Excel, actions bulk, table triable (mot, traduction, langue, taux, niveau), filtres.

**Progress** : carte streak, stats (mots totaux, maîtrisés, taux), donut système/user, barres EN↔NL, heatmap 28 jours.

**Multi** : classement (top 5 + user), fil scroll infini, réactions, Challenge Back, commentaires.

---

## 8. État & fonctions clés

```javascript
let vocab = []              // vocabulaire user + système
let progress = {}           // { wordId → {correct, attempts, ease_factor, …} }
let currentUser = null
let quizQueue = []          // items du quiz courant
let quizIndex = 0
let quizMode = 'auto'       // forward | reverse | auto
let sessionAnswers = []     // { word, correct, skipped, givenAnswer, direction }
let challengeContext = null // défini quand Challenge Back actif
let quizTimer = null        // intervalle du compte à rebours 30 s
```

| Fonction | Rôle |
|----------|------|
| `startQuizTimer()` | Compte à rebours 30 s, skip auto à 0. |
| `showQuestion()` | Rendu de la question courante. |
| `checkAnswer()` | Validation, enregistrement, mise à jour SM-2. |
| `advanceQuiz()` | Question suivante ou fin de session. |
| `endSession()` | Stats, post au fil, review/résumé. |
| `buildQuizQueue()` | Filtre + shuffle du vocabulaire. |
| `recordAnswer(wordId, isCorrect)` | Upsert `quiz_progress` (logique SM-2). |
| `postMultiSession()` | INSERT dans `quiz_sessions`. |
| `launchChallengeQuiz()` | Mise en place du Challenge Back. |
| `publishChallengeResult()` | Publie le score en commentaire. |
| `runXpReconciliation()` | Évaluation/attribution XP quotidienne. |
| `multiLoadFeed()` | Fetch paginé du fil + hydratation réactions. |
| `multiLoadLeaderboard()` | Agrégation `user_xp` + `quiz_sessions`. |

### Import/Export Excel
- **Export** (`XLSX.js`) : colonnes source, target, langue, exemples, tips, correct, attempts, ease_factor, last_tested.
- **Import** : lecture .xlsx, détection de doublons (insensible à la casse sur `(source_word, language_pair)`), upsert vocabulary + quiz_progress.

---

## 9. Authentification & permissions

- Accès à `/pro/quiz.html` gardé par le Worker Cloudflare (`worker.js`) — validation JWT, JWKS cachée 1h, redirection vers `/login` si invalide.
- Module `quiz` dans `allowed_modules` (défaut pour nouveaux users).
- Supabase Auth (email/mot de passe ou OAuth). RLS : chaque user ne lit/écrit que ses propres données.

---

## 10. Performance & cache

- Cache du fil multi : TTL ~2 min (refresh manuel pour invalider).
- Pagination : 20 sessions/page.
- Chargement du vocabulaire : paginé au-delà de la limite 1000 lignes Supabase.
- Démo : bypass de la DB, données en mémoire.

---

## 11. Architecture

```
quiz.html (SPA, vanilla JS, CSS variables, sans framework)
 ├─ 4 onglets : Quiz | Vocab | Progress | Multi (+ Verbes NL)
 ├─ État : vocab[], progress{}, session
 └─ Intégrations : Supabase, XLSX.js, Pravatar
        │
Supabase ── Auth · 9 tables + RLS · Storage (avatars)
        │
Cloudflare Worker ── JWT · cache JWKS 1h · redirect /login
```

---

## 12. Historique git (thèmes principaux)

Commits notables (récent → ancien) :

- `b541521` fix(quiz/multi) : sync cross-user du fil + leaderboard
- `f56c9b0` Merge PR #92 : fix quiz review cleanup
- `87cf79c` fix(quiz) : masquer Error Review au démarrage d'un nouveau quiz
- `43bd592` fix(quiz) : race condition au boot — `currentUser` null
- `e2b03d4` feat(quiz/vocab) : onboarding premier import + détection de doublons
- `c400e66` feat(quiz/share) : filtre langue, select/deselect all, partage direct
- `960be76` feat(quiz) : multi demo admin, Challenge Back fin de partie, vocab share
- `fab0727` feat(multi) : ajouter les mots Challenge Back à son vocabulaire
- `0c1ffad` fix(quiz) : formulaire d'ajout vocab — champ source adaptatif unique
- `37e0d3a` / `d92098a` fix(vocab) : suppression de la pagination
- `25eed19` feat(vocab) : refonte complète de l'onglet Vocabulary
- `0ad486d` feat(quiz) : option 50 questions
- `2209e44` feat(vocab) : filtre mots ratés/fragiles + marquage visuel + impression
- `33ef103` refactor : intégration des verbes NL dans quiz.html (4e onglet)
- `8febfb4` feat : verbes irréguliers NL + hint visible par défaut
- `f35a472` feat : écran de review des erreurs + stats gamifiées (streak, heatmap, temps)
- `93a9a8d` feat : countdowns projet personnalisables + carte Knowledge Quiz sur l'accueil

**Thèmes** : features social multijoueur (Challenge Back, réactions, classement), système XP/gamification, partage de vocabulaire, intégration verbes NL, sécurité cross-user, corrections de race conditions.
