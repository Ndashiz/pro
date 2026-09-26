/* ═════════════════════════════════════════════════════════════════════
   LazyPO — Cloudflare Worker auth gate
   ─────────────────────────────────────────────────────────────────────
   ⚠ LOCKDOWN (2026-09-25) — /pro/* is DEAD.
   Every request under DEAD_PREFIXES (or exactly DEAD_EXACT) is answered
   with a bare synthetic 404 straight from the edge: no origin fetch, no
   redirect, no cache. The GitHub Pages site behind it is unpublished as
   well, so the origin answers 404 on its own. The app is being re-homed
   under APP_PREFIX (/lazypo2/) — step 2 of the incident plan, see
   worker/README.md « Lockdown ».

   Remote switches: public.app_settings in Supabase (written from Jarvis)
   can turn the whole site into a 404 (site_disabled) or make a module's
   pages vanish (livenote_disabled). Read with the public key, cached 30 s,
   fail-open. See app_settings_schema.sql.

   Runs in front of GitHub Pages (the origin). Intercepts every request
   to APP_PREFIX*.html (and APP_PREFIX itself) and verifies a Supabase
   JWT cookie BEFORE serving the HTML. Static assets (.js/.css/.svg/.ico)
   and a few explicitly-public pages (login, OAuth callback, email
   confirm, the favicon) pass through untouched.

   JWT verification supports:
     • ES256 — current Supabase default (asymmetric, verified via JWKS)
     • HS256 — legacy fallback (SUPABASE_JWT_SECRET Worker secret)

   JWKS is fetched from Supabase and cached in caches.default for 1h.
   Individual JWT verification results are cached for 60s per token.

   Failure modes — all redirect to APP_PREFIX + login.html with a 302:
     • missing cookie
     • cookie value is not a valid JWT shape
     • JWT signature invalid (forged / wrong key)
     • JWT expired
     • Unexpected exception (fail-closed)
═════════════════════════════════════════════════════════════════════ */

// ── Dead paths ──────────────────────────────────────────────────────
// The old home of the app. Anything here no longer exists: bare 404,
// never proxied to the origin, never redirected to a login page.
const DEAD_PREFIXES = ['/pro/'];
const DEAD_EXACT    = new Set(['/pro']);

// ── Live app ────────────────────────────────────────────────────────
// Where the gate lives. Must match the GitHub Pages project path
// (repo name), the cookie Path in auth.js and the Spotify redirect URI.
const APP_PREFIX   = '/lazypo2/';
const LOGIN_PATH   = APP_PREFIX + 'login.html';
const COOKIE_NAME  = 'lazypo_jwt';
const SUPABASE_URL = 'https://hrvxhnmtvzvrsmmmmtsv.supabase.co';
const JWKS_URL     = SUPABASE_URL + '/auth/v1/.well-known/jwks.json';

// Pages that MUST stay accessible without a session
const PUBLIC_PAGES = new Set([
  APP_PREFIX + 'login.html',
  APP_PREFIX + 'email_confirm.html',
  APP_PREFIX + 'spotify-callback.html',
  // quiz.html is framed by the Jarvis front, which may not carry the gate
  // cookie on the very first load. A 302 there would navigate the IFRAME to
  // the login page, so the HTML is served ungated and quiz.html runs its own
  // in-place login gate. Nothing sensitive ships in the markup — all data
  // comes from Supabase, where RLS is the real boundary.
  APP_PREFIX + 'quiz.html',
]);

// File extensions that are static assets — never gated
const PUBLIC_EXTENSIONS = /\.(js|css|svg|ico|png|jpg|jpeg|gif|webp|woff2?|ttf|map|txt)$/i;

// Path prefixes that are always public (well-known, etc.)
const PUBLIC_PREFIXES = [APP_PREFIX + '.well-known/'];

// ── Remote switches (Supabase public.app_settings, written from Jarvis) ──
// Read with the publishable key (public-read policy), cached FLAGS_TTL s.
// Fail-open: when Supabase cannot be reached the last value seen within
// FLAGS_STALE s applies, else "all off" — a Supabase hiccup must never take
// the site down. See app_settings_schema.sql.
const SUPABASE_ANON = 'sb_publishable_Mj-FuPZcN_oTeLQ0ME84yQ_uulPdJ4c'; // same public key as auth.js
const FLAGS_URL     = SUPABASE_URL + '/rest/v1/app_settings?select=key,value';
const FLAGS_TTL     = 30;      // seconds a fresh copy is reused
const FLAGS_STALE   = 86400;   // seconds the fallback copy is kept
// Pages that disappear (404) when a switch is on.
const FLAG_PAGES = {
  livenote_disabled: new Set([APP_PREFIX + 'livenote.html', APP_PREFIX + 'livenote_editor.html']),
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url  = new URL(request.url);
      const path = url.pathname;

      // 0. Dead paths — the retired /pro/ home. Bare 404, nothing else.
      if (isDeadPath(path)) {
        return notFound();
      }

      // 1. Only gate APP_PREFIX paths. Anything else, pass through.
      if (!path.startsWith(APP_PREFIX)) {
        return fetch(request);
      }

      // 1b. Remote switches: whole site off, or a module's pages off.
      const flags = await getFlags(ctx);
      if (flags.site_disabled) {
        return notFound();
      }
      for (const key in FLAG_PAGES) {
        if (flags[key] && FLAG_PAGES[key].has(path)) return notFound();
      }

      // 2. Static assets and public pages — pass through with security headers.
      if (isPublicPath(path)) {
        return addSecurityHeaders(await fetch(request));
      }

      // 3. Read JWT from cookie.
      const jwt = readCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
      if (!jwt) {
        return redirectToLogin(url);
      }

      // 4. Verify JWT (signature + expiry). Cached for 60s per token.
      const valid = await verifyJwt(jwt, env.SUPABASE_JWT_SECRET, ctx);
      if (!valid) {
        return redirectToLogin(url);
      }

      // 5. Authorized — forward to origin with security headers.
      return addSecurityHeaders(await fetch(request));
    } catch (err) {
      console.error('[lazypo-worker] error:', err && err.stack || err);
      // A dead path stays dead even when something above blew up.
      try { if (isDeadPath(new URL(request.url).pathname)) return notFound(); } catch {}
      return redirectToLogin(new URL(request.url));
    }
  },
};

/* ── Routing helpers ─────────────────────────────────────────────── */

function isDeadPath(path) {
  if (DEAD_EXACT.has(path)) return true;
  return DEAD_PREFIXES.some(p => path.startsWith(p));
}

// Deliberately anonymous: no app name, no branding, no link. A visitor
// (or a scanner) must see a page that simply does not exist.
const NOT_FOUND_HTML = '<!doctype html>\n'
  + '<html lang="en"><head><meta charset="utf-8">\n'
  + '<title>404 Not Found</title>\n'
  + '<meta name="robots" content="noindex, nofollow">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
  + 'font:16px/1.5 system-ui,-apple-system,sans-serif;color:#333;background:#fafafa}'
  + 'main{text-align:center;padding:24px}h1{font-size:48px;font-weight:600;margin:0 0 8px}p{margin:0;color:#666}</style>\n'
  + '</head><body><main><h1>404</h1><p>Not Found</p></main></body></html>\n';

function notFound() {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      'Content-Type':                'text/html; charset=utf-8',
      'Cache-Control':               'no-store',
      'X-Robots-Tag':                'noindex, nofollow',
      'X-Content-Type-Options':      'nosniff',
      'Referrer-Policy':             'strict-origin-when-cross-origin',
      'Strict-Transport-Security':   'max-age=31536000',
      'Content-Security-Policy':     "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}

/* ── Remote switches ─────────────────────────────────────────────── */

async function getFlags(ctx) {
  const cache    = (typeof caches !== 'undefined') ? caches.default : null;
  const freshReq = new Request('https://lazypo-flags-cache/fresh');
  const staleReq = new Request('https://lazypo-flags-cache/stale');

  if (cache) {
    try {
      const fresh = await cache.match(freshReq);
      if (fresh) return await fresh.json();
    } catch {}
  }

  let flags = null;
  try {
    const res = await fetch(FLAGS_URL, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
    });
    if (res.ok) {
      const rows = await res.json();
      flags = {};
      for (const r of (Array.isArray(rows) ? rows : [])) flags[r.key] = r.value === true;
    } else {
      console.warn('[lazypo-worker] flags fetch failed:', res.status);
    }
  } catch (err) {
    console.warn('[lazypo-worker] flags fetch error:', err && err.message);
  }

  if (!flags) {
    // Supabase unreachable: reuse the last copy if we still have one.
    if (cache) {
      try {
        const stale = await cache.match(staleReq);
        if (stale) return await stale.json();
      } catch {}
    }
    return {};
  }

  if (cache) {
    const body = JSON.stringify(flags);
    const put = (req, ttl) => cache.put(req, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + ttl },
    }));
    ctx.waitUntil(Promise.all([put(freshReq, FLAGS_TTL), put(staleReq, FLAGS_STALE)]));
  }
  return flags;
}

function isPublicPath(path) {
  if (PUBLIC_PAGES.has(path)) return true;
  if (PUBLIC_EXTENSIONS.test(path)) return true;
  if (PUBLIC_PREFIXES.some(p => path.startsWith(p))) return true;
  return false;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://sdk.scdn.co",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://hrvxhnmtvzvrsmmmmtsv.supabase.co",
  "connect-src 'self' https://hrvxhnmtvzvrsmmmmtsv.supabase.co wss://hrvxhnmtvzvrsmmmmtsv.supabase.co https://accounts.spotify.com https://api.spotify.com wss://dealer.spotify.com",
  "media-src 'self'",
  // Allow embedding from the same origin AND the Jarvis front, which lives on
  // its own subdomain jarvis.ndashiz.be (cross-origin but same-site). Every
  // other origin stays blocked (clickjacking protection preserved).
  "frame-ancestors 'self' https://jarvis.ndashiz.be",
  "upgrade-insecure-requests",
].join('; ');

function addSecurityHeaders(response) {
  const ct = response.headers.get('Content-Type') || '';
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options',         'nosniff');
  // No X-Frame-Options: it cannot express "allow jarvis.ndashiz.be" (cross-origin
  // but same-site). CSP frame-ancestors (below) is the modern, precise gate and
  // supersedes XFO where both exist — we drop XFO so no browser blocks the embed.
  newHeaders.delete('X-Frame-Options');
  newHeaders.set('Referrer-Policy',                'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy',             'camera=(), microphone=(), geolocation=()');
  newHeaders.set('Strict-Transport-Security',      'max-age=31536000');
  // Only add CSP on HTML responses — avoids breaking JS/CSS MIME parsing
  if (ct.includes('text/html')) {
    newHeaders.set('Content-Security-Policy', CSP);
  }
  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers:    newHeaders,
  });
}

function redirectToLogin(originalUrl) {
  const loc    = new URL(LOGIN_PATH, originalUrl.origin);
  const target = originalUrl.pathname + originalUrl.search;
  if (target && target !== LOGIN_PATH) {
    loc.searchParams.set('next', target);
  }
  return new Response(null, {
    status: 302,
    headers: {
      'Location':                    loc.toString(),
      'Cache-Control':               'no-store',
      'X-Content-Type-Options':      'nosniff',
      'Referrer-Policy':             'strict-origin-when-cross-origin',
      'Strict-Transport-Security':   'max-age=31536000',
    },
  });
}

/* ── Cookie parsing ──────────────────────────────────────────────── */

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts  = cookieHeader.split(/;\s*/);
  const prefix = name + '=';
  for (const p of parts) {
    if (p.startsWith(prefix)) {
      try { return decodeURIComponent(p.slice(prefix.length)); }
      catch { return null; }
    }
  }
  return null;
}

/* ── JWT verification ────────────────────────────────────────────── */

async function verifyJwt(token, hs256Secret, ctx) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header  = JSON.parse(base64UrlToString(headerB64));
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch { return false; }

  // Basic payload checks
  if (typeof payload.exp !== 'number') return false;
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;
  if (!payload.sub) return false;

  // Token cache — keyed by last 24 chars of the JWT signature.
  const cacheKey = new Request('https://lazypo-jwt-cache/' + token.slice(-24));
  const cache    = caches.default;
  const cached   = await cache.match(cacheKey);
  if (cached) return cached.status === 200;

  let valid = false;
  try {
    if (header.alg === 'ES256') {
      valid = await verifyES256(headerB64, payloadB64, sigB64, header.kid, ctx);
    } else if (header.alg === 'HS256') {
      if (!hs256Secret) {
        console.error('[lazypo-worker] SUPABASE_JWT_SECRET is not configured (needed for HS256)');
        return false;
      }
      valid = await verifyHS256(headerB64, payloadB64, sigB64, hs256Secret);
    } else {
      console.warn('[lazypo-worker] unsupported JWT alg:', header.alg);
      return false;
    }
  } catch (err) {
    console.warn('[lazypo-worker] JWT verify error:', err && err.message);
    valid = false;
  }

  const cacheResponse = new Response(valid ? 'ok' : 'bad', {
    status: valid ? 200 : 401,
    headers: { 'Cache-Control': 'max-age=60' },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  return valid;
}

/* ── ES256 (ECDSA P-256 + SHA-256) via Supabase JWKS ────────────── */

async function verifyES256(headerB64, payloadB64, sigB64, kid, ctx) {
  const jwk = await getJwk(kid, ctx);
  if (!jwk) {
    console.warn('[lazypo-worker] no JWK found for kid:', kid);
    return false;
  }

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['verify'],
  );

  const data = new TextEncoder().encode(headerB64 + '.' + payloadB64);
  const sig  = base64UrlToBytes(sigB64);

  return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
}

// Fetches + caches the JWKS, returns the JWK matching `kid` or null.
async function getJwk(kid, ctx) {
  const cache    = caches.default;
  const cacheReq = new Request(JWKS_URL);

  let jwks;
  const cached = await cache.match(cacheReq);
  if (cached) {
    jwks = await cached.json();
  } else {
    const res = await fetch(JWKS_URL);
    if (!res.ok) {
      console.error('[lazypo-worker] JWKS fetch failed:', res.status);
      return null;
    }
    const body = await res.text();
    jwks = JSON.parse(body);
    // Cache for 1 hour
    ctx.waitUntil(cache.put(cacheReq, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
    })));
  }

  return (jwks.keys || []).find(k => k.kid === kid) || null;
}

/* ── HS256 (HMAC-SHA256) — legacy fallback ───────────────────────── */

async function verifyHS256(headerB64, payloadB64, sigB64, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false, ['verify'],
  );
  const data = new TextEncoder().encode(headerB64 + '.' + payloadB64);
  const sig  = base64UrlToBytes(sigB64);
  return await crypto.subtle.verify('HMAC', key, sig, data);
}

/* ── Base64url helpers ───────────────────────────────────────────── */

function base64UrlToString(b64url) {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

function base64UrlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
