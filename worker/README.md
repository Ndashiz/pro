# LazyPO auth gate — Cloudflare Worker

Server-side gate that prevents `/lazypo/*.html` from being served to
visitors without a valid Supabase session. Replaces the previous
JS-only client gate (`auth-gate.js`) which could be bypassed by
disabling JS or removing the overlay in DevTools.

## How it works

1. Every request to `ndashiz.be/lazypo/*` is intercepted by this Worker.
2. Public paths (login, OAuth callback, email confirm, all static
   assets `.js`/`.css`/`.svg`/`.ico`/etc.) pass through to the origin
   (GitHub Pages) untouched.
3. For everything else, the Worker reads the `lazypo_jwt` cookie, then:
   - verifies the JWT signature locally using the Supabase project's
     HS256 secret (no Supabase round-trip),
   - rejects expired or malformed tokens,
   - on success, forwards the request to GitHub Pages.
4. On failure, returns a 302 to `/lazypo/login.html?return_to=<path>`.

The cookie itself is set by `auth.js` after a successful Supabase login
and refreshed on `TOKEN_REFRESHED` events. It is cleared on signOut.

JWT verification results are cached in `caches.default` for 60s per
token to make repeat hits free.

## One-time setup

You need:
- Cloudflare account that owns the `ndashiz.be` zone.
- Node.js 18+ locally.
- The Supabase JWT secret (Dashboard → Project Settings → API → JWT Secret).

```bash
cd worker
npm i -g wrangler        # or use `npx wrangler` for one-offs

wrangler login           # opens browser, one-time auth

# Paste your Supabase JWT Secret when prompted. It will be stored
# encrypted on Cloudflare — never committed to git.
wrangler secret put SUPABASE_JWT_SECRET

wrangler deploy          # builds and uploads worker.js to the route
```

Verify the deploy:

```bash
# Without a session cookie, this should now return 302 → login.html
curl -sI https://ndashiz.be/lazypo/jira_dashboard.html | head -5
# Expected:
#   HTTP/2 302
#   location: https://ndashiz.be/lazypo/login.html?return_to=/lazypo/jira_dashboard.html
```

Public assets remain reachable:

```bash
curl -sI https://ndashiz.be/lazypo/favicon.svg | head -2
# Expected: 200
curl -sI https://ndashiz.be/lazypo/login.html | head -2
# Expected: 200
```

## Updating

```bash
cd worker
wrangler deploy   # pushes the latest worker.js
```

Cloudflare propagates the new version globally in seconds.

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

## Limits / known trade-offs

- **Token revocation latency**: when a user signs out on another
  device, their current JWT remains valid until its `exp` (default 1h).
  The cookie itself is cleared by `auth.js` locally, so the user can't
  use it from the same browser. Cross-device revocation will fully
  propagate in ≤1h. Acceptable for our threat model.
- **Module-level gate (`requireModule('jira')`) stays client-side**:
  this Worker only checks "is the user authenticated", not "does the
  user have access to module X". An authenticated user could in
  principle DevTools-hide the module lock overlay. Mitigation: keep
  sensitive data in Supabase with RLS, never in the static HTML.
- **JWT cookie is not HttpOnly**: Supabase JS sets the session
  client-side, so the cookie cannot be HttpOnly. An XSS would still
  let an attacker exfiltrate the JWT. Mitigation: strict CSP, no
  inline event handlers from user-controlled data.

## Cost

Cloudflare Workers free tier: 100,000 requests/day. LazyPO sits at
~thousands/day → free indefinitely.
