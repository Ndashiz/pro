# LazyPO

Tool to ease my life as a PO.

**Live** : <https://ndashiz.be/lazypo/>

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  ndashiz.be/lazypo/*                                             │
│                                                                  │
│   ┌────────────┐    ┌──────────────────┐    ┌────────────────┐   │
│   │  Browser   │ →  │ Cloudflare Worker│ →  │  GitHub Pages  │   │
│   │            │ ←  │  (auth gate)     │ ←  │  (static HTML) │   │
│   └────────────┘    └──────────────────┘    └────────────────┘   │
│         │                    │                                   │
│         │                    ▼                                   │
│         │           validates lazypo_jwt                         │
│         │           cookie (ES256/JWKS)                          │
│         ▼                                                        │
│   ┌────────────┐                                                 │
│   │  Supabase  │   ← session, profiles, business data (RLS)      │
│   └────────────┘                                                 │
└──────────────────────────────────────────────────────────────────┘
```

- **Hosting** : GitHub Pages, auto-deploy on push to `main`
- **CDN / edge** : Cloudflare in front of `ndashiz.be`
- **Auth gate** : Cloudflare Worker on `ndashiz.be/lazypo/*` — verifies a Supabase JWT cookie before HTML is served. See [`worker/`](worker/) and [`docs/architecture.html#security`](docs/architecture.html).
- **Backend** : Supabase (auth + Postgres + storage + realtime). All tables use RLS.
- **Frontend** : Vanilla JS, no build step. Each feature is a single HTML file.

## Documentation

- [`docs/architecture.html`](docs/architecture.html) — full technical doc (18 sections, Mermaid diagrams)
  - ★ [Security architecture](docs/architecture.html#security) — defense-in-depth layers, request flow
  - [Authentication](docs/architecture.html#auth) — Supabase + cookie lifecycle
  - [Cloudflare Worker gate](docs/architecture.html#worker-gate) — JWT validation logic + caches
  - [Threat model](docs/architecture.html#threat-model) — past vectors and mitigations
- [`worker/README.md`](worker/README.md) — Worker deployment instructions

## Repo layout

```
.
├── *.html              # Feature pages (one per feature, vanilla JS inline)
├── auth.js             # Supabase auth + cookie sync
├── auth-gate.js        # UX pre-render gate (no security, see docs)
├── sidebar.js          # Global navigation
├── session.js          # Inactivity timeout + cross-tab sync
├── demo.js             # Admin-only floating "🧪" demo button injector
├── focusfm.js          # Spotify integration (shared across pages)
├── popup.js            # "Coming soon" popup for unavailable features
├── favicon.svg         # ✦ star on navy
│
├── *.sql               # Supabase schemas (run manually in SQL Editor)
│
├── worker/             # Cloudflare Worker (auth gate)
│   ├── src/worker.js
│   ├── wrangler.toml
│   └── README.md       # Deployment instructions
│
├── docs/
│   └── architecture.html   # Full technical documentation
│
└── README.md (this file)
```

## Features

| Page | Module | Description |
|------|--------|-------------|
| `index.html` | — | Hub / product grid |
| `login.html` | (public) | Sign in / sign up |
| `account.html` | — | Profile, avatar, sign out |
| `admin.html` | admin | User approval, module access requests |
| `quiz.html` | quiz | Vocabulary quiz (NL/EN), SM-2 spaced repetition |
| `lazypo_generator.html` | scope | Scope of Work email generator |
| `sprintplanner.html` | sprint | Sprint planning + PPTX export |
| `sprintplanning.html` | sprint | Sprint planning (alt UI) |
| `jira.html` | jira | Jira hub (Query Saver, Dashboard, File Cleaner) |
| `jirarepo.html` | jira | Jira Query Saver — save/share JQL with cloud sync |
| `jira_dashboard.html` | jira | Jira Dashboard Builder — CSV/XLSX → KPIs + PPTX/PDF/HTML export |
| `livenote.html` | livenote | Live shared notes (realtime) |
| `livenote_editor.html` | livenote | Note editor |
| `feedback.html` | (auth) | User feedback channel |

## Local development

```bash
# From repo root
npx serve -l 3000 .

# Then open http://localhost:3000/index.html
```

**Local auth bypass** is OFF by default (changed in PR #112 — used to be auto-on, which was a security smell). To enable in your local browser:

```js
sessionStorage.setItem('lazypo:enableLocalBypass', '1');
location.reload();
```

Or in the page console, before reload:

```js
window.__ENABLE_LOCAL_BYPASS = true;
location.reload();
```

This injects a fake `DEV_SESSION` with `is_admin: true` and all modules allowed — UI renders, Supabase queries still fail because the token is fake.

## Deployment

### Static site (always)

Push to `main`. GitHub Pages auto-deploys in 1-2 minutes. Cloudflare cache TTL ~10 min — hard reload (`Cmd+Shift+R`) to bust.

### Cloudflare Worker (auth gate)

The Worker is deployed separately via Wrangler. See [`worker/README.md`](worker/README.md).

```bash
cd worker
wrangler deploy
```

Required once per environment :

```bash
wrangler login   # browser-based auth, one-time
```

## Security

Read [`docs/architecture.html#security`](docs/architecture.html#security) before touching the auth flow.

Key invariants:

1. **No protected HTML is served without a valid JWT cookie**. The Cloudflare Worker is the gatekeeper. Client-side JS is *never* trusted for access control.
2. **Module-level access (`requireModule('jira')`) is best-effort UX**. The real protection is RLS on Supabase tables — don't put sensitive data in static HTML expecting client gates to hide it.
3. **The Worker uses ES256 + JWKS**, not the legacy HS256 secret. If you migrate the Supabase project to a different signing algorithm, update [`worker/src/worker.js`](worker/src/worker.js) accordingly.
4. **Local dev bypass requires explicit opt-in** (`__ENABLE_LOCAL_BYPASS` flag). It can never trigger automatically in prod.

For incident retrospectives, see the [changelog](docs/architecture.html#changelog) (PR #112 in particular).
