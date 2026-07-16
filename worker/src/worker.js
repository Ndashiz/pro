/* ═════════════════════════════════════════════════════════════════════
   LazyPO — Cloudflare Worker auth gate
   ─────────────────────────────────────────────────────────────────────
   Runs in front of GitHub Pages (the origin). Intercepts every request
   to /pro/*.html (and /pro/) and verifies a Supabase JWT cookie
   BEFORE serving the HTML. Static assets (.js/.css/.svg/.ico) and a few
   explicitly-public pages (login, OAuth callback, email confirm, the
   favicon) pass through untouched.

   JWT verification supports:
     • ES256 — current Supabase default (asymmetric, verified via JWKS)
     • HS256 — legacy fallback (SUPABASE_JWT_SECRET Worker secret)

   JWKS is fetched from Supabase and cached in caches.default for 1h.
   Individual JWT verification results are cached for 60s per token.

   Failure modes — all redirect to /pro/login.html with a 302:
     • missing cookie
     • cookie value is not a valid JWT shape
     • JWT signature invalid (forged / wrong key)
     • JWT expired
     • Unexpected exception (fail-closed)
═════════════════════════════════════════════════════════════════════ */

const LOGIN_PATH   = '/pro/login.html';
const APP_PREFIX   = '/pro/';
const COOKIE_NAME  = 'lazypo_jwt';
const SUPABASE_URL = 'https://hrvxhnmtvzvrsmmmmtsv.supabase.co';
const JWKS_URL     = SUPABASE_URL + '/auth/v1/.well-known/jwks.json';

// Pages that MUST stay accessible without a session
const PUBLIC_PAGES = new Set([
  '/pro/login.html',
  '/pro/email_confirm.html',
  '/pro/spotify-callback.html',
  '/pro/quiz.html',
]);

// File extensions that are static assets — never gated
const PUBLIC_EXTENSIONS = /\.(js|css|svg|ico|png|jpg|jpeg|gif|webp|woff2?|ttf|map|txt)$/i;

// Path prefixes that are always public (well-known, etc.)
const PUBLIC_PREFIXES = ['/pro/.well-known/'];

export default {
  async fetch(request, env, ctx) {
    try {
      const url  = new URL(request.url);
      const path = url.pathname;

      // 0. Embed session API — Jarvis iframe auto-login (no user interaction).
      if (path === '/pro/api/embed-session' && request.method === 'POST') {
        return handleEmbedSession(request, env);
      }

      // 1. Only gate /pro/* paths. Anything else, pass through.
      if (!path.startsWith(APP_PREFIX)) {
        return fetch(request);
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
      return redirectToLogin(new URL(request.url));
    }
  },
};

/* ── Routing helpers ─────────────────────────────────────────────── */

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

/* ── Embed session API ──────────────────────────────────────────── */

const EMBED_ALLOWED_ORIGINS = new Set([
  'https://jarvis.ndashiz.be',
  'https://ndashiz.be',
]);

async function handleEmbedSession(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!EMBED_ALLOWED_ORIGINS.has(origin)) {
    return new Response('forbidden', { status: 403 });
  }

  if (!env.SUPABASE_JWT_SECRET) {
    return new Response(JSON.stringify({ error: 'jwt secret not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const svcToken = await signHS256({
      sub: '00000000-0000-0000-0000-000000000000',
      role: 'service_role',
      iss: SUPABASE_URL + '/auth/v1',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, env.SUPABASE_JWT_SECRET);

    const profilesRes = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?select=id&limit=1', {
        headers: {
          'apikey': env.SUPABASE_ANON_KEY || '',
          'Authorization': 'Bearer ' + svcToken,
        },
      }
    );
    if (!profilesRes.ok) {
      return new Response(JSON.stringify({ error: 'profile lookup failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    const profiles = await profilesRes.json();
    if (!profiles.length) {
      return new Response(JSON.stringify({ error: 'no user found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const userId = profiles[0].id;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await signHS256({
      sub: userId,
      role: 'authenticated',
      iss: SUPABASE_URL + '/auth/v1',
      aud: 'authenticated',
      iat: now,
      exp: now + 3600,
    }, env.SUPABASE_JWT_SECRET);

    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: accessToken,
      expires_in: 3600,
      token_type: 'bearer',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'internal' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function signHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const h = bytesToBase64Url(enc.encode(JSON.stringify(header)));
  const p = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(h + '.' + p));
  return h + '.' + p + '.' + bytesToBase64Url(new Uint8Array(sig));
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
