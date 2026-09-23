# SPEC — Quiz : corriger un mot & flagger une question depuis l'Error Review

Fiche de travail pour une session Claude Code sur `~/Documents/lazypo` (repo `Ndashiz/pro`).
Lis **`CLAUDE.md`** avant de toucher quoi que ce soit — les invariants prod y sont, ils ne sont
pas répétés ici. Ce fichier décrit **quoi** construire et **quelles décisions sont déjà prises**.

Tout se passe dans **`quiz.html`** (vanilla JS, tout inline, pas de build, pas de bundler).

---

## 0. Décisions actées (ne pas les rediscuter)

| Sujet | Décision |
|---|---|
| Où on peut corriger un mot | **Écran Error Review uniquement** (`#quiz-review`, fin de session). Pas sur le feedback immédiat pendant le quiz. |
| Recalcul du score | **Aucun.** Corriger un mot met à jour le vocabulaire pour les prochaines fois ; la réponse reste comptée fausse, `quiz_progress` n'est pas retouché. |
| Stockage des flags | **Colonnes sur `vocabulary`** — pas de nouvelle table, pas de passage par le module feedback. Conséquence assumée : un seul flag actif par mot, pas d'historique. |

**Non-objectifs** (ne pas les implémenter sans demander) : exclure automatiquement les mots
flaggés du tirage du quiz, écran d'admin des flags, notification, undo du score.

---

## 1. Pré-requis SQL — à lancer à la main

Comme tout `.sql` du repo : **rien ne s'applique automatiquement**, c'est copié-collé dans le
SQL Editor Supabase. Committer ne déploie pas la migration.

```sql
-- Migration : flag d'un mot de vocabulaire (à lancer une fois)
alter table public.vocabulary add column if not exists flagged_at  timestamptz;
alter table public.vocabulary add column if not exists flag_reason text;
alter table public.vocabulary add column if not exists flag_note   text;
```

`flag_reason` reste un `text` libre côté base, mais l'UI n'écrit que ces quatre valeurs :
`wrong_translation`, `typo`, `bad_example`, `other`.

Pas de nouvelle policy RLS : `own_vocabulary` (`auth.uid() = user_id`) couvre déjà ces colonnes.

**À répercuter aussi** dans le bloc de schéma commenté en tête de `quiz.html` (~ lignes 110-130),
sous les lignes `-- Migration (run once if table already exists)`. C'est la seule doc de schéma
qui vit à côté du code.

---

## 2. Feature A — corriger le mot sans quitter la review

### Le besoin

Sur l'écran Error Review, l'utilisateur voit `❌ Your answer` vs `✅ Correct answer`. Quand il
n'est pas d'accord avec la correction (traduction discutable, faute de frappe dans sa liste,
formulation à ajuster), il doit pouvoir **éditer la ligne de vocabulaire sur place**. Il ne doit
à aucun moment être sorti de la review : pas de navigation, pas de changement d'onglet, pas de
perte de `reviewIndex`, pas de redémarrage de session.

### UI

Dans `#quiz-review` (markup ~ ligne 2278-2305), insérer une barre d'actions **entre**
`.review-compare` et `.review-actions` :

```html
<div class="review-tools" id="review-tools">
  <button class="btn-ghost" id="review-btn-edit">✏️ Fix this word</button>
  <button class="btn-ghost" id="review-btn-flag">🚩 Flag</button>
</div>
```

Sous cette barre, un panneau d'édition replié par défaut (`display:none`), **pas une modale
plein écran** — l'écran est affiché dans une iframe côté Jarvis, une modale centrée sur le
viewport se placerait mal :

- `input` → `source_word`, prérempli
- `input` → `target_translation`, prérempli
- `input` → `example_sentence`, prérempli, optionnel
- boutons `Save` / `Cancel`

L'écran Error Review est en **anglais** — garder les libellés en anglais (le reste du fichier
mélange FR/EN, on suit le voisinage immédiat).

### Comportement

1. **Garde-fou `word.id === null`** — les mots de Challenge Back sont un snapshot cross-user sans
   `id` (cf. `recordAnswer`, qui `return` dessus). Dans ce cas : masquer les deux boutons.
2. Ouvrir le panneau ne touche **ni** `reviewIndex`, **ni** l'affichage des autres blocs.
3. `Save` appelle une fonction dédiée, **pas** `updateWord()` :

```js
async function reviewSaveWord(id, patch) { /* … */ }
```

   Pourquoi pas `updateWord()` : elle enchaîne `loadVocab()` (repagination complète du
   vocabulaire) puis `renderVocab()`. En pleine review c'est un aller-retour réseau inutile et un
   re-render d'un onglet caché.

   `reviewSaveWord` doit :
   - `update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', currentUser.id).select()`
   - reprendre le **garde 0-ligne** de `updateWord` : `data.length === 0` → toast
     `Modification bloquée — vérifie les RLS policies Supabase`. Sans `.select()`, un refus RLS
     passe pour un succès.
   - **muter l'objet mot en place** (`Object.assign(wordRef, patch)`) plutôt que réassigner :
     `reviewQueue[i].word`, `sessionAnswers[i].word`, `quizQueue[i].word` et l'entrée du tableau
     global `vocab` pointent vers le même objet. Une mutation en place les met tous à jour d'un
     coup ; une réassignation en laisserait la moitié périmés.
   - poser un flag `vocabDirty = true`, et déclencher `loadVocab() + renderVocab()` **une seule
     fois**, plus tard — au retour sur l'onglet vocabulaire ou dans `showSummary()`. Jamais
     pendant la review.
   - rappeler `showReviewItem()` pour rafraîchir `#review-asked` / `#review-correct`.
   - toast explicite sur la décision « pas de recalcul » :
     `Mot corrigé — le score de cette session n'est pas recalculé.`
4. **Clavier** : `Enter` = Save, `Escape` = Cancel. Attention — le handler global du quiz
   (`btn-check` / `btn-next` sur `Enter`, ~ ligne 4067-4075) ne doit pas se déclencher pendant
   que le panneau est ouvert : `stopPropagation()` sur les inputs du panneau, ou un garde
   `if (reviewEditOpen) return;`. Un `Enter` qui saute à la question suivante en plein milieu
   d'une correction, c'est exactement le bug à éviter.
5. `source_word` et `target_translation` vides → refus + toast, comme `submitAddWord()`.

---

## 3. Feature B — flagger une question

### Le besoin

Signaler qu'une question est mauvaise (traduction fausse, coquille, phrase d'exemple hors sujet)
sans forcément savoir par quoi la remplacer. C'est le complément de la Feature A : *corriger*
quand on sait, *flagger* quand on ne sait pas.

### UI

Le bouton `🚩 Flag` de la même barre. Au clic, un petit sélecteur de motif inline (même zone que
le panneau d'édition, les deux ne sont jamais ouverts en même temps) :

| Valeur écrite | Libellé UI |
|---|---|
| `wrong_translation` | Wrong translation |
| `typo` | Typo / spelling |
| `bad_example` | Bad example sentence |
| `other` | Something else |

Plus un champ note libre optionnel (`flag_note`, ~200 caractères, tronqué côté client).

### Comportement

- Écrit via le même chemin que `reviewSaveWord` :
  `{ flagged_at: new Date().toISOString(), flag_reason, flag_note }`.
- Si le mot est **déjà flaggé** (`word.flagged_at` non nul) : le bouton s'affiche `🚩 Flagged`
  en état actif, et le clic propose de **retirer** le flag
  (`{ flagged_at: null, flag_reason: null, flag_note: null }`).
- Même garde `word.id === null` que la Feature A.
- Le flag ne change **rien** au score ni au SRS.
- **Rendre le flag visible ailleurs** : dans `renderVocabRow()` (~ ligne 3662), ajouter un petit
  badge `🚩` sur les lignes flaggées. Sinon le flag est un trou noir : posé une fois, jamais revu.

*Optionnel, seulement si ça reste court* : ajouter `flagged` aux valeurs de `sourceFilter`
(~ ligne 3583) pour filtrer la liste sur les mots flaggés.

---

## 4. Fichiers touchés

| Fichier | Quoi |
|---|---|
| `quiz.html` | Tout le code. Bloc schéma ~110-130 · CSS `.review-*` · markup `#quiz-review` ~2278-2305 · JS `reviewSaveWord` près de `updateWord` ~3078 · section `REVIEW FLOW` ~4400-4475 |
| `KNOWLEDGE_QUIZ.md` | Doc FR du module quiz — décrire les deux nouveaux gestes |
| `docs/architecture.html` | §05 : ajouter `flagged_at` / `flag_reason` / `flag_note` à la table `vocabulary`. §18 `#changelog` : entrée à la main. **Ne pas** toucher `#auto-commits`, il est régénéré à chaque push. |

Un seul commit, style conventionnel avec scope puis clause em-dash, par ex. :

```
feat(quiz/review): corriger ou flagger un mot sans quitter la review — édition inline + flag sur vocabulary
```

---

## 5. Pièges spécifiques à ce chantier

Ceux de `CLAUDE.md` s'appliquent (pas de CDN, pas de redirect en iframe, pas de framework). En
plus, propres à cette feature :

- **Ne pas appeler `loadVocab()` pendant la review.** C'est une repagination complète.
- **Ne pas réassigner les objets mots**, muter en place — références partagées entre `vocab`,
  `quizQueue`, `reviewQueue` et `sessionAnswers`.
- **Toujours `.select()` après un `update`**, sinon un refus RLS ressemble à un succès.
- **`word.id` peut être `null`** (Challenge Back). Les deux boutons doivent disparaître, pas
  planter.
- **Pas de `confirm()` / `alert()`** pour la suppression du flag — l'écran tourne en iframe,
  utiliser une confirmation inline ou un second clic.
- **L'écran est déjà dense** en 375px de large. Les deux boutons + le panneau doivent tenir sans
  pousser `.review-actions` hors de l'écran.

---

## 6. Checklist de test manuel

Local : `npx serve -l 3000 .` (pas de Worker, donc pas de CSP et pas de gate ; le bypass auth est
opt-in via `sessionStorage.setItem('lazypo:enableLocalBypass','1')`, mais il donne une session
factice — pour tester les écritures Supabase il faut un vrai login).

- [ ] Session avec au moins 2 fautes → la review s'ouvre, la barre d'actions est là
- [ ] `Fix this word` → champs préremplis avec les bonnes valeurs, y compris en mode `cloze`
- [ ] Save → toast, `#review-correct` reflète la nouvelle valeur, on est **toujours** sur le même
      item de review, `reviewIndex` inchangé
- [ ] `Enter` dans un champ enregistre et **ne saute pas** à la question suivante
- [ ] `Escape` ferme sans écrire
- [ ] Le mot corrigé apparaît à jour dans l'onglet vocabulaire après la fin de session
- [ ] Le mot corrigé ressort avec la nouvelle valeur dans une session suivante
- [ ] Flag → motif → toast ; rechargement de la page → le mot est toujours flaggé
- [ ] Re-clic sur un mot flaggé → proposition de retirer le flag, qui fonctionne
- [ ] Badge 🚩 visible dans la liste de vocabulaire
- [ ] Un mot Challenge Back (`id` null) : aucun des deux boutons n'est affiché, pas d'erreur console
- [ ] Score de session identique avant/après une correction (décision actée)
- [ ] `quiz.html` chargé en iframe depuis Jarvis : la review ne redirige pas vers `login.html`,
      le panneau tient dans le cadre

---

## 7. Déploiement

Le statique part par `git push` sur `main` → GitHub Pages, 1-2 min plus ~10 min de cache
Cloudflare. Prod : <https://ndashiz.be/pro/quiz.html> (bien `/pro/`).

**Le Worker n'est pas concerné** par ce chantier — aucun `wrangler deploy` nécessaire.

La migration SQL doit être passée **avant** le push, sinon les écritures de flag échouent en prod
sur colonne inconnue. Prévoir la dégradation : si `flagged_at` n'existe pas encore, l'erreur
Supabase doit produire un toast lisible, pas une exception non catchée.
