# CLAUDE.md

Working notes for agent sessions on LazyPO. Read [`README.md`](README.md) for
the tour; this file is the "don't get burned" list.

## `/pro/` is dead — don't bring it back

On 2026-09-25 work flagged a data leak through LazyPO and the whole
`ndashiz.be/pro/` home was retired the same day: the Worker answers an
anonymous 404 on `/pro/*` and `/pro` (`DEAD_PREFIXES` in
`worker/src/worker.js`, `no-store`, never proxied) and GitHub Pages was
unpublished. On 2026-09-26 the repo was renamed `Ndashiz/pro` →
`Ndashiz/lazypo2` and Pages re-enabled, so the app lives at
**`ndashiz.be/lazypo2/`**. `sow_purge.sql` is the server-side purge of the
Scope of Work data (drafts + PI epics) that went with it — run by hand, like
every `.sql` here.

Never re-add a `/pro/` Worker route, and never point the gate (`APP_PREFIX`),
the cookie `Path` in `auth.js`, the `next` check in `login.html`, the Spotify
redirect URI or the Jarvis quiz iframe back at `/pro/`.


## What this is

Personal PO toolbox. **Vanilla JS, no build step, no bundler, no package.json
at the root.** Each feature is one self-contained HTML file with its JS and CSS
inline. Shared behaviour lives in the top-level `*.js` files (`auth.js`,
`sidebar.js`, `session.js`, …), pulled in with plain `<script src>`.

Don't introduce a framework, a bundler, or a build step without being asked.

- **Prod** : <https://ndashiz.be/lazypo2/> — note `/lazypo2/`; `/pro/` (retired 2026-09-25, see above) and `/lazypo/` are dead paths
- **Repo** : `Ndashiz/lazypo2` (renamed twice, `lazypo` → `pro` → `lazypo2`; local clone is still `~/Documents/lazypo`)
- **Backend** : Supabase (auth + Postgres + storage + realtime), RLS everywhere
- **Edge** : Cloudflare Worker on `ndashiz.be/lazypo2/*` — auth gate + security headers, plus a bare 404 on `/pro/*`

## The three things that break prod

### 1. Never load a lib from a CDN

The Worker serves `script-src 'self' 'unsafe-inline' https://sdk.scdn.co`. A
`<script src="https://cdn…">` **works locally and is blocked in prod** — locally
there is no Worker, so no CSP.

Every dependency is vendored in the repo (`supabase.min.js`, `xlsx.min.js`,
`pptxgen.min.js`, `html2pdf.min.js`, `papaparse.min.js`, `three.min.js`,
`vanta.net.min.js`, `codemirror*`, fonts under `fonts/`). Merges have
reintroduced CDN URLs twice already (`629f154`, `8abda52`). The Spotify Web
Playback SDK is the only allowed external script.

### 2. An embedded page must never redirect to `login.html`

`quiz.html` is framed by the Jarvis front (`jarvis.ndashiz.be`). Any redirect
navigates **the iframe itself**, swapping the embedded module for the full
LazyPO login page.

- In `quiz.html`, anything calling `LazyAuth.requireAuth()` must first
  `await window.__qzEmbedAuth`. Skipping that races the gate, sees a `null`
  session and bounces the iframe — the exact bug behind `cef5166` / `3eba74b`.
- When framed, `auth.js` runs on its own Supabase client
  (`storageKey: 'sb-lazypo-embed-auth-token'`), writes **no** gate cookie, and
  `session.js` inactivity handling is skipped. Don't "unify" these sessions —
  the isolation is the fix (`b83a4ac`), not an accident.
- `/lazypo2/quiz.html` is in the Worker's `PUBLIC_PAGES` and is served **ungated**.
  Never put anything sensitive in its markup; RLS is the real boundary.

### 3. Pushing to `main` does not deploy the Worker

Two separate deploy paths:

| What | How | Delay |
|---|---|---|
| Static site | `git push` → GitHub Pages | 1-2 min (+ ~10 min Cloudflare cache) |
| Worker | `cd worker && wrangler deploy` | seconds |

Editing `worker/src/worker.js` changes nothing in prod until `wrangler deploy`
is run. Simon runs it — you generally can't.

## The PI is defined once (`pi.js`)

`pi.js` owns the Program Increment as `window.LazyPI`; `pi.html` is the only place it is
edited. `gantt.html`, `sprintplanner.html`, `lazypo_generator.html` and the `index.html`
cockpit widget read it and keep no copy. Four rules:

1. **`LazyPI.get()` must stay synchronous and never return `null`.** `gantt.html` runs
   `load(); renderAll();` at parse time, before `auth.js` exists. Remote data arrives later
   via `lazypo:profile` → `lazypo:pi`.
2. **`pi.end` is the last day, INCLUSIVE.** `buildSprints()` returns `end` *exclusive* plus
   `endInclusive`. Mixing them is a silent one-day drift.
3. **Never write `LazyAuth` + `.requireModule(` contiguously in `pi.js`.** `gantt.html`'s
   standalone export strips any script containing that marker — it would delete itself.
   The same export strips every `<script src>`, so `LazyPI` is *absent* in an exported file:
   every use in `gantt.html` sits behind the `HAS_PI` guard.
4. **`pi.html` gates on `requireAuth()`, not a module id** — the PI feeds `scope`, `sprint`
   and `jira` at once. Don't add `pi` to `GATED_MODULES`.

`pi_schema.sql` adds `profiles.pi jsonb` and, like every other `.sql` here, is run by hand.
Without it the feature degrades to localStorage-only rather than breaking.

## Conventions

- **Commits** — conventional style with a scope, then an em-dash clause:
  `feat(grammar): module grammaire unifié — cartes, quiz, XP, multi-feed`,
  `fix(quiz/embed): auth gate in-place — stop the iframe bouncing to login.html`.
  French and English both appear; match the file you're touching.
- **Docs** — `README.md` and `worker/README.md` are English;
  `docs/architecture.html` and `KNOWLEDGE_QUIZ.md` are French. Keep it that way.
- **SQL** — `*.sql` files at the root are **run manually** in the Supabase SQL
  Editor. Nothing applies them automatically; committing one changes nothing.
  Several live tables (`user_xp`, `xp_daily_log`, `grammar_progress`,
  `quiz_sessions`, `user_sessions`, …) have no `.sql` file at all —
  `docs/architecture.html` §05 is the closest thing to a schema reference.
- **Access control** — `requireModule('x')` is UX only. Real protection is RLS.
  Gateable modules: `scope`, `sprint`, `jira`, `livenote`, `minutehub`,
  `focusfm`. `quiz` is on by default for new users.

## Local development

```bash
npx serve -l 3000 .
```

No Worker, so **no CSP and no server-side gate** locally. Auth bypass is
opt-in only:

```js
sessionStorage.setItem('lazypo:enableLocalBypass', '1'); location.reload();
```

It injects a fake admin session — the UI renders, Supabase calls still fail
(the token is fake). Only `localhost` / `127.0.0.1`; it can never fire in prod.

## Documentation map

| File | Scope |
|---|---|
| `README.md` | Overview, features, deploy, security invariants |
| `docs/architecture.html` | Full technical doc, FR, 19 sections + Mermaid |
| `KNOWLEDGE_QUIZ.md` | Quiz module deep dive (SRS, XP, multi, grammar, embed) |
| `worker/README.md` | Worker behaviour, headers, deploy, rollback |

`docs/architecture.html` §18 (`#changelog`) is **hand-written** — edit it when
you ship something notable. The `#auto-commits` block below it is generated by
`.github/workflows/update-docs.yml` (via `.github/scripts/update_docs.py`);
don't hand-edit that block, it gets overwritten on every push to `main`.

## Loose ends

- `sprintplanning.html` is an orphan — nothing links to it; `sprintplanner.html`
  is live. Left in place deliberately, don't "fix" it without asking.
- `.htaccess` / `.htaccess.security` are OVH leftovers. Hosting is GitHub Pages;
  they do nothing.
- Figure numbers in `docs/architecture.html` have pre-existing duplicates
  (two Fig. 9, two Fig. 10, two Fig. 12). They're never cross-referenced in
  prose, so it's cosmetic.
