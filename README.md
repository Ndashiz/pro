# LazyPO

Tool to ease my life as a PO.

**Live** : <https://ndashiz.be/lazypo2/>
**Repo** : `Ndashiz/lazypo2` (renamed twice, `lazypo` → `pro` → `lazypo2` — the local clone is still `~/Documents/lazypo`)

> The public path is `/lazypo2/`. Both `/pro/` (retired on 2026-09-25 after a
> data-leak alert at work — the Worker answers a bare 404 there, see
> [`worker/README.md`](worker/README.md)) and the older `/lazypo/` are dead.
> The Worker route, the cookie `Path` and the Spotify redirect URI moved with it.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  ndashiz.be/lazypo2/*                                                │
│                                                                  │
│   ┌────────────┐    ┌──────────────────┐    ┌────────────────┐   │
│   │  Browser   │ →  │ Cloudflare Worker│ →  │  GitHub Pages  │   │
│   │            │ ←  │  (auth gate)     │ ←  │  (static HTML) │   │
│   └────────────┘    └──────────────────┘    └────────────────┘   │
│         │                    │                                   │
│         │                    ▼                                   │
│         │           validates lazypo_jwt cookie                  │
│         │           (ES256 via JWKS, HS256 fallback)             │
│         │           + injects CSP / security headers             │
│         ▼                                                        │
│   ┌────────────┐                                                 │
│   │  Supabase  │   ← session, profiles, business data (RLS)      │
│   └────────────┘                                                 │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ iframe (same-site, cross-origin)
                   ┌──────────┴───────────┐
                   │  jarvis.ndashiz.be   │  embeds /lazypo2/quiz.html
                   └──────────────────────┘
```

- **Hosting** : GitHub Pages, auto-deploy on push to `main`
- **CDN / edge** : Cloudflare in front of `ndashiz.be` (~10 min cache TTL)
- **Auth gate** : Cloudflare Worker on `ndashiz.be/lazypo2/*` — verifies a Supabase JWT cookie before HTML is served, and adds the CSP + security headers. See [`worker/`](worker/) and [`docs/architecture.html#worker-gate`](docs/architecture.html).
- **Remote switches** : three kill switches in Supabase `app_settings` (`site_disabled`, `livenote_disabled`, `livenote_files_disabled`), flipped from Jarvis (Settings → LazyPO). The Worker turns the site or the LiveNote pages into a 404, `auth.js` hides the module and blocks file transfers, RLS locks the table and the bucket. See `app_settings_schema.sql` and `CLAUDE.md`.
- **Backend** : Supabase (auth + Postgres + storage + realtime). All tables use RLS.
- **Frontend** : Vanilla JS, no build step, no bundler. Each feature is a single HTML file with inline JS/CSS.
- **Third-party libs are vendored**, never loaded from a CDN — the Worker CSP is `script-src 'self'` and would block them. See [Vendored libraries](#vendored-libraries).

## Documentation

- [`docs/architecture.html`](docs/architecture.html) — full technical doc, French, 19 sections + Mermaid diagrams
  - ★ [Security architecture](docs/architecture.html#security) — defense-in-depth layers, request flow
  - [Authentication](docs/architecture.html#auth) — Supabase + cookie lifecycle
  - [Cloudflare Worker gate](docs/architecture.html#worker-gate) — JWT validation, public paths, CSP
  - [Quiz embed / Jarvis](docs/architecture.html#embed) — iframe integration and session isolation
  - [Threat model](docs/architecture.html#threat-model) — past vectors and mitigations
  - [★ Dernières modifs](docs/architecture.html#changelog) — hand-written changelog
- [`KNOWLEDGE_QUIZ.md`](KNOWLEDGE_QUIZ.md) — deep dive on the quiz module (SRS, XP, multi, grammar, embed)
- [`worker/README.md`](worker/README.md) — Worker deployment instructions
- [`CLAUDE.md`](CLAUDE.md) — conventions and invariants for agent sessions

## Repo layout

```
.
├── *.html              # Feature pages (one per feature, vanilla JS inline)
├── auth.js             # Supabase auth, cookie sync, module permissions
├── auth-gate.js        # UX pre-render gate (NOT security — see docs)
├── sidebar.js          # Global navigation + SPA transitions
├── session.js          # Inactivity timeout + cross-tab sync
├── pi.js               # The Program Increment — single source of truth (window.LazyPI)
├── countdown.js        # Home progress bars / project countdowns
├── demo.js             # Admin-only floating "🧪" demo-data button injector
├── focusfm.js          # Spotify integration (shared drawer, all pages)
├── popup.js            # "Coming soon" popup for unavailable features
├── apis.js             # External service registry (home page reads the count)
├── feedback.js         # Feedback board logic
├── feedback_modal.js   # Feedback submission modal
├── vocab_import_onboarding.js   # Quiz: first-import flow
├── vocab_duplicate_modal.js     # Quiz: duplicate detection UI
├── favicon.svg         # ✦ star on navy
│
├── *.min.js / fonts/   # Vendored third-party libs (see below)
├── *.sql               # Supabase schemas & migrations (run manually)
│
├── worker/             # Cloudflare Worker (auth gate)
│   ├── src/worker.js
│   ├── wrangler.toml
│   └── README.md
│
├── docs/
│   └── architecture.html   # Full technical documentation
│
├── .github/workflows/
│   └── update-docs.yml     # Stamps architecture.html on push to main
│
├── .well-known/security.txt
├── .nojekyll               # so GitHub Pages serves .well-known/
└── README.md (this file)
```

## Features

| Page | Module | Description |
|------|--------|-------------|
| `index.html` | — | Hub / product grid, project countdowns, todo widget |
| `login.html` | (public) | Sign in / sign up |
| `email_confirm.html` | (public) | Post-signup email confirmation landing |
| `spotify-callback.html` | (public) | Spotify OAuth callback |
| `pi.html` | (auth) | **PI Settings** — the Program Increment defined once: dates, derived sprints, releases, features (Jira import + manual), Excel round-trip, today-relative cockpit |
| `account.html` | — | Profile, avatar, countdowns, sign out |
| `admin.html` | admin | User approval, module access requests, notifications |
| `quiz.html` | quiz | Knowledge Quiz — vocabulary (EN/NL→FR), SM-2 spaced repetition, XP, multi feed, NL grammar (23 chapters), NL irregular verbs |
| `lazypo_generator.html` | scope | Scope of Work email generator (.eml / HTML export) · named drafts, auto-deleted 7 days after their last save ([`sow_drafts_schema.sql`](sow_drafts_schema.sql)) |
| `sprintplanner.html` | sprint | Sprint planning + PPTX export |
| `jira.html` | jira | Jira hub (Query Saver, Dashboard, PI Timeline, File Cleaner) |
| `jirarepo.html` | jira | Jira Query Saver — save/share JQL with cloud sync |
| `jira_dashboard.html` | jira | Jira Dashboard Builder — CSV/XLSX → KPIs + PPTX/PDF/HTML export |
| `gantt.html` | jira | PI Timeline — Gantt view of the program increment |
| `jira_filecleaner.html` | jira | File Cleaner — Jira « Export Excel (all fields) » HTML → clean .xlsx (features with description / benefit / notes split, items attached to their feature, releases, report, raw table) |
| `gif_repo.html` | — | GIF Repo — paste, label, copy; sorted by usage (Supabase Storage) |
| `livenote.html` | livenote | Live shared notes (Supabase realtime) |
| `livenote_editor.html` | livenote | Note editor |
| `feedback.html` | (auth) | Feedback board — suggest, upvote, comment |

Sidebar-only entries with no page of their own:

- **Minute Hub** (`minutehub`) — placeholder, shows the "coming soon" popup
- **Focus FM** (`focusfm`) — a drawer injected by `focusfm.js`, not a page
- **Documentation** — admin-only link to `docs/architecture.html`

Gateable modules (`profiles.allowed_modules`): `scope`, `sprint`, `jira`, `livenote`, `minutehub`, `focusfm`. `quiz` is granted to every new user by default.

> `pi.html` is deliberately **not** a gateable module — it gates on `LazyAuth.requireAuth()`.
> The PI feeds `scope`, `sprint` *and* `jira` at once, so hiding it behind any one of them
> would lock a user out of the definition their own tools read.

## The PI — one definition, every view

`pi.js` owns the Program Increment and exposes it as `window.LazyPI`. `pi.html` is the only
place it is edited; `gantt.html`, `sprintplanner.html`, `lazypo_generator.html` and the
`index.html` cockpit widget all read from it and keep no copy of their own.

- **Storage** — `localStorage['lazypo_pi_v1']` is the synchronous working copy;
  `profiles.pi` (jsonb) is the cross-device source of truth. `LazyPI.get()` is synchronous and
  never returns `null`, because pages render before `auth.js` has even loaded; the cloud copy
  arrives later and re-broadcasts `lazypo:pi`.
- **Run [`pi_schema.sql`](pi_schema.sql) once** in the Supabase SQL editor to add the column.
  Until you do, everything still works — the cloud write fails, is caught, and the page reports
  *"This device only"*.
- **Dates** are plain `YYYY-MM-DD` strings and `pi.end` is the **last day, inclusive**.
  `LazyPI.buildSprints()` returns each sprint's `end` **exclusive** plus `endInclusive` for
  display — mixing the two is a one-day drift waiting to happen.
- **Sprints are derived, never stored.** A PI that doesn't divide into whole sprints is
  flagged, not rounded (`LazyPI.sprintFit()`).
- **`gantt.html`'s standalone export** strips every `<script src>`, so `LazyPI` is absent in an
  exported file. Every use of it in that page is behind a `HAS_PI` guard and the export keeps
  working offline exactly as before.

> `sprintplanning.html` is an **orphan** — nothing links to it; `sprintplanner.html` is the live one.

## Vendored libraries

Every third-party dependency is committed to the repo and served from our own
origin. This is deliberate and load-bearing:

- the Worker CSP is `script-src 'self' 'unsafe-inline' https://sdk.scdn.co` — a CDN `<script src>` is **blocked outright**;
- it removes the supply-chain risk of a compromised CDN injecting JS into the app.

`supabase.min.js`, `xlsx.min.js`, `pptxgen.min.js`, `html2pdf.min.js`, `papaparse.min.js`, `three.min.js`, `vanta.net.min.js`, `codemirror*`, plus DM Sans / DM Mono under `fonts/` (declared in `fonts.css`).

**Never replace a vendored lib with a CDN URL.** It has been reintroduced by merges twice already (`629f154`, `8abda52`) and breaks the page silently in prod while working fine locally, where no CSP applies. The only external script allowed is the Spotify Web Playback SDK.

## Local development

```bash
npx serve -l 3000 .
```

Then open <http://localhost:3000/index.html>.

There is no build step — edit the HTML/JS and reload.

**Local auth bypass** is OFF by default (changed in PR #112 — it used to be auto-on, which was a security smell). To enable it in your browser:

```js
sessionStorage.setItem('lazypo:enableLocalBypass', '1');
location.reload();
```

Or, in the console before reload:

```js
window.__ENABLE_LOCAL_BYPASS = true;
location.reload();
```

This injects a fake `DEV_SESSION` with `is_admin: true` and all modules allowed — the UI renders, but Supabase queries still fail because the token is fake. Only `localhost` / `127.0.0.1` are eligible; it can never trigger in prod.

Note that locally there is **no Worker**, so there is no CSP and no server-side gate. A page that works locally can still break in prod (see [Vendored libraries](#vendored-libraries)).

## Deployment

### Static site

Push to `main`. GitHub Pages auto-deploys in 1-2 minutes. Cloudflare cache TTL is ~10 min — hard reload (`Cmd+Shift+R`) to bust it.

### Cloudflare Worker (auth gate)

The Worker deploys separately via Wrangler — pushing to `main` does **not** update it. See [`worker/README.md`](worker/README.md).

```bash
cd worker && wrangler deploy
```

Required once per environment:

```bash
wrangler login
```

## Jarvis embed

`quiz.html` is embedded as a native module in the Jarvis front (`jarvis.ndashiz.be`),
cross-origin but same-site. Three things make that work:

1. **CSP** `frame-ancestors 'self' https://jarvis.ndashiz.be`, and the Worker
   *deletes* `X-Frame-Options` (XFO cannot express "this one other subdomain").
2. **`/lazypo2/quiz.html` is in the Worker's `PUBLIC_PAGES`** — it is served ungated.
   A 302 would have navigated the *iframe* to the login page. Nothing sensitive
   ships in the markup; RLS on Supabase is the real boundary.
3. **The embed runs its own Supabase session.** When framed, `auth.js` uses the
   storage key `sb-lazypo-embed-auth-token`, writes no gate cookie, and skips the
   inactivity timeout. Signing out of LazyPO cannot kill the embed's session, and
   vice versa. `quiz.html` renders an **in-place** login card rather than
   navigating; anything that calls `LazyAuth.requireAuth()` must first await
   `window.__qzEmbedAuth` or it will race the gate and bounce the iframe.

See [`KNOWLEDGE_QUIZ.md`](KNOWLEDGE_QUIZ.md) and [`docs/architecture.html#embed`](docs/architecture.html).

## Security

Read [`docs/architecture.html#security`](docs/architecture.html#security) before touching the auth flow.

Key invariants:

1. **No protected HTML is served without a valid JWT cookie.** The Cloudflare Worker is the gatekeeper. Client-side JS is *never* trusted for access control — `auth-gate.js` is UX only.
2. **`/lazypo2/quiz.html` is a deliberate exception** and is served ungated for the Jarvis embed. Do not put anything sensitive in its markup.
3. **Module-level access (`requireModule('jira')`) is best-effort UX.** The real protection is RLS on Supabase tables — don't put sensitive data in static HTML expecting client gates to hide it.
4. **The Worker verifies ES256 via Supabase JWKS, with HS256 as a fallback** (`SUPABASE_JWT_SECRET`). Both paths are live in [`worker/src/worker.js`](worker/src/worker.js); if you migrate the Supabase project's signing algorithm, check both.
5. **Local dev bypass requires explicit opt-in** (`__ENABLE_LOCAL_BYPASS`). It can never trigger automatically in prod.
6. **The gate cookie is not HttpOnly** — Supabase sets the session client-side, so it can't be. An XSS could exfiltrate the JWT; that's why the CSP is strict and libs are vendored.

For incident retrospectives, see the [changelog](docs/architecture.html#changelog) (PR #112 in particular).
