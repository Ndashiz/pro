# LazyPO auth gate — Cloudflare Worker

> ## ⚠ Lockdown — 2026-09-25
>
> **`ndashiz.be/pro/*` is dead.** Work flagged a data leak through LazyPO,
> so the whole `/pro/` home was taken down:
>
> - **Edge** — the Worker answers a bare, anonymous **404** on `/pro/*` and
>   `/pro` (`DEAD_PREFIXES` / `DEAD_EXACT` in `src/worker.js`): no origin
>   fetch, no login redirect, `Cache-Control: no-store`.
> - **Origin** — the GitHub Pages site of `Ndashiz/pro` is **unpublished**
>   (`gh api -X DELETE repos/Ndashiz/pro/pages`), so the origin answers 404
>   too, even for someone bypassing Cloudflare.
>
> **Step 2 — re-home under `/lazypo2/`.** The gate already lives on
> `APP_PREFIX = '/lazypo2/'` with its own route in `wrangler.toml`, so the
> Worker needs no second deploy. What remains is outside the Worker:
> rename the repo to `lazypo2` and re-enable Pages, switch the app's
> hard-coded `/pro/` paths (cookie `Path` in `auth.js`, `login.html`'s
> `next` check, the Spotify redirect URI in `focusfm.js` /
> `spotify-callback.html`), add `https://ndashiz.be/lazypo2/**` to the
> Supabase Auth redirect allow-list, update the Spotify dashboard redirect
> URI, and point the Jarvis quiz iframe at `/lazypo2/quiz.html`.
>
> To deploy this lockdown: `cd worker && wrangler login && wrangler deploy`.
> To roll it back: drop `/pro/` from `DEAD_PREFIXES`, set `APP_PREFIX`
> back to `/pro/`, redeploy, and re-enable Pages.

Server-side gate that prevents `<APP_PREFIX>*.html` (today `/lazypo2/`, formerly `/pro/`) from being served to
visitors without a valid Supabase session. Replaces the previous
JS-only client gate (`auth-gate.js`) which could be bypassed by
disabling JS or removing the overlay in DevTools.

It is also where the app's **security headers and CSP** are injected —
GitHub Pages cannot set headers, so the Worker is the only place they
can come from.

## How it works

1. Every request to `ndashiz.be/pro/*` is intercepted by this Worker.
2. Public paths pass through to the origin (GitHub Pages) untouched:
   - static assets — `.js` `.css` `.svg` `.ico` `.png` `.jpg` `.gif` `.webp` `.woff2` `.ttf` `.map` `.txt`
   - `/pro/login.html`, `/pro/email_confirm.html`, `/pro/spotify-callback.html`
   - `/pro/quiz.html` — **deliberately ungated**, see [Public quiz](#public-quiz)
   - anything under `/pro/.well-known/`
3. For everything else, the Worker reads the `lazypo_jwt` cookie, then:
   - checks the payload (`exp` in the future, `sub` present),
   - verifies the signature locally — no Supabase round-trip:
     - **ES256** (current Supabase default) against the project JWKS,
     - **HS256** (legacy) against the `SUPABASE_JWT_SECRET` Worker secret,
   - rejects any other `alg`, and any malformed or expired token,
   - on success, forwards the request to GitHub Pages.
4. On failure — missing cookie, bad shape, bad signature, expiry, or an
   unexpected exception (fail-closed) — returns a 302 to
   `/pro/login.html?next=<path>`.
5. Every response that reaches the origin gets the security headers added
   (see below).

The cookie itself is set by `auth.js` after a successful Supabase login
and refreshed on `TOKEN_REFRESHED` events. It is cleared on signOut.
The Worker only *verifies* tokens — it never mints them.

Caching:

- **JWKS** is fetched from Supabase and cached in `caches.default` for 1h.
- **Per-token verification results** are cached for 60s, keyed on the last
  24 chars of the signature, so repeat hits are free.

## Headers injected

Applied to every proxied response:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000` |
| `X-Frame-Options` | **deleted** (see below) |
| `Content-Security-Policy` | on `text/html` responses only |

The CSP is `default-src 'self'` with `script-src 'self' 'unsafe-inline'
https://sdk.scdn.co`, Supabase allowed on `connect-src`/`img-src`, and
Spotify on `connect-src`.

> **`script-src 'self'` means no CDN.** Every third-party lib must be
> vendored in the repo. A `<script src="https://cdn…">` is blocked in prod
> while working fine locally, where no Worker and no CSP exist.

`frame-ancestors` is `'self' https://jarvis.ndashiz.be`. `X-Frame-Options`
is explicitly **deleted** rather than set: XFO cannot express "allow this
one other subdomain" (`jarvis.ndashiz.be` is cross-origin but same-site),
and a `SAMEORIGIN` XFO would make some browsers block the embed even
though CSP allows it. Clickjacking protection is preserved by
`frame-ancestors` — every other origin stays blocked.

## Public quiz

`/pro/quiz.html` is in `PUBLIC_PAGES` and is served **without** the gate.

This is intentional. The Jarvis front frames it, and on the very first
load that iframe may not carry the gate cookie — a 302 would navigate the
*iframe itself* to the login page, replacing the embedded module with the
full LazyPO login screen. Instead the HTML is served ungated and
`quiz.html` runs its own in-place login gate.

Nothing sensitive ships in that markup: all data comes from Supabase,
where RLS is the real boundary.

## One-time setup

You need:
- Cloudflare account that owns the `ndashiz.be` zone.
- Node.js 18+ locally.
- The Supabase JWT secret, **only if you still need the HS256 fallback**
  (Dashboard → Project Settings → API → JWT Secret). Projects on the
  current ES256 default do not need it — the Worker fetches the JWKS.

```bash
cd worker
npm i -g wrangler        # or use `npx wrangler` for one-offs

wrangler login           # opens browser, one-time auth

# Optional — HS256 fallback only. Stored encrypted on Cloudflare,
# never committed to git.
wrangler secret put SUPABASE_JWT_SECRET

wrangler deploy          # builds and uploads worker.js to the route
```

Verify the deploy:

```bash
curl -sI https://ndashiz.be/pro/jira_dashboard.html | head -5
```

Expected:

```
HTTP/2 302
location: https://ndashiz.be/pro/login.html?next=/pro/jira_dashboard.html
```

Public paths remain reachable:

```bash
curl -sI https://ndashiz.be/pro/favicon.svg | head -2
curl -sI https://ndashiz.be/pro/login.html | head -2
curl -sI https://ndashiz.be/pro/quiz.html | head -2
```

All three should return `200`.

Check the headers are landing:

```bash
curl -sI https://ndashiz.be/pro/login.html | grep -i "content-security-policy\|strict-transport\|x-frame"
```

You should see a CSP and HSTS, and **no** `x-frame-options`.

## Updating

```bash
cd worker
wrangler deploy   # pushes the latest worker.js
```

Cloudflare propagates the new version globally in seconds.

> Pushing to `main` deploys the **static site only**. The Worker is a
> separate deploy — changing `worker/src/worker.js` does nothing until you
> run `wrangler deploy`.

## Rolling back

```bash
wrangler rollback                  # interactive — pick a previous version
# or
wrangler deployments list          # find a known-good deployment ID
wrangler rollback <deployment-id>  # roll back to that exact version
```

## Local dev

```bash
cd worker
wrangler dev   # spins up the worker locally on http://localhost:8787
```

Note: in local dev you'll hit a stubbed origin, not GitHub Pages. The
gate logic itself is testable (try with/without a valid JWT in the
`Cookie` header).

Serving the site with `npx serve` from the repo root bypasses the Worker
entirely — no gate, no CSP.

## Limits / known trade-offs

- **Token revocation latency**: when a user signs out on another
  device, their current JWT remains valid until its `exp` (default 1h).
  The cookie itself is cleared by `auth.js` locally, so the user can't
  use it from the same browser. Cross-device revocation will fully
  propagate in ≤1h. Acceptable for our threat model.
- **60s verification cache**: a token that is revoked upstream can still
  be accepted for up to a minute after the last successful check.
- **Module-level gate (`requireModule('jira')`) stays client-side**:
  this Worker only checks "is the user authenticated", not "does the
  user have access to module X". An authenticated user could in
  principle DevTools-hide the module lock overlay. Mitigation: keep
  sensitive data in Supabase with RLS, never in the static HTML.
- **JWT cookie is not HttpOnly**: Supabase JS sets the session
  client-side, so the cookie cannot be HttpOnly. An XSS would still
  let an attacker exfiltrate the JWT. Mitigation: strict CSP, vendored
  libs, no inline event handlers built from user-controlled data.
- **`quiz.html` is ungated** — by design, see [Public quiz](#public-quiz).

## Cost

Cloudflare Workers free tier: 100,000 requests/day. LazyPO sits at
~thousands/day → free indefinitely.
