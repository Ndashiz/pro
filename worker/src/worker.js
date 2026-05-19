/* ═════════════════════════════════════════════════════════════════════
   LazyPO — Cloudflare Worker auth gate
   ─────────────────────────────────────────────────────────────────────
   Runs in front of GitHub Pages (the origin). Intercepts every request
   to /lazypo/*.html (and /lazypo/) and verifies a Supabase JWT cookie
   BEFORE serving the HTML. Static assets (.js/.css/.svg/.ico) and a few
   explicitly-public pages (login, OAuth callback, email confirm, the
   favicon) pass through untouched.

   JWT verification is done locally using the Supabase project's HS256
   secret stored as a Worker secret (SUPABASE_JWT_SECRET). No round-trip
   to Supabase per request. Results are cached in caches.default for 60s
   per token to make repeat hits free.

   Failure modes — all redirect to /lazypo/login.html with a 302:
     • missing cookie
     • cookie value is not a valid JWT shape
     • JWT signature invalid (forged / wrong secret)
     • JWT expired
     • Unexpected exception (fail-closed)
═════════════════════════════════════════════════════════════════════ */

const LOGIN_PATH = '/lazypo/login.html';
const APP_PREFIX = '/lazypo/';
const COOKIE_NAME = 'lazypo_jwt';

// Pages that MUST stay accessible without a session
const PUBLIC_PAGES = new Set([
  '/lazypo/login.html',
  '/lazypo/email_confirm.html',
  '/lazypo/spotify-callback.html',
]);

// File extensions that are static assets — never gated
const PUBLIC_EXTENSIONS = /\.(js|css|svg|ico|png|jpg|jpeg|gif|webp|woff2?|ttf|map)$/i;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // 1. Only gate /lazypo/* paths. Anything else, pass through.
      if (!path.startsWith(APP_PREFIX)) {
        return fetch(request);
      }

      // 2. Static assets and public pages — pass through.
      if (isPublicPath(path)) {
        return fetch(request);
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

      // 5. Authorized — forward to origin (GitHub Pages, automatic loop
      //    avoidance: CF won't run the Worker again on a sub-fetch of its
      //    own route).
      return fetch(request);
    } catch (err) {
      // Fail closed. Better to break the app than to leak content.
      console.error('[lazypo-worker] error:', err && err.stack || err);
      return redirectToLogin(new URL(request.url));
    }
  },
};

/* ── Routing helpers ─────────────────────────────────────────────── */

function isPublicPath(path) {
  if (PUBLIC_PAGES.has(path)) return true;
  if (PUBLIC_EXTENSIONS.test(path)) return true;
  // /lazypo/ root is gated (it serves index.html which is protected)
  // /lazypo (no slash) is also gated — but CF Pages usually 301s to /lazypo/ anyway
  return false;
}

function redirectToLogin(originalUrl) {
  const loc = new URL(LOGIN_PATH, originalUrl.origin);
  // Pass return target so login.html can bounce back after success.
  // Only carry the path (no host) to prevent open-redirect.
  const target = originalUrl.pathname + originalUrl.search;
  if (target && target !== LOGIN_PATH) {
    loc.searchParams.set('return_to', target);
  }
  return new Response(null, {
    status: 302,
    headers: {
      'Location': loc.toString(),
      'Cache-Control': 'no-store',
      'X-LazyPO-Gate': 'redirect',
    },
  });
}

/* ── Cookie parsing ──────────────────────────────────────────────── */

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  const prefix = name + '=';
  for (const p of parts) {
    if (p.startsWith(prefix)) {
      try {
        return decodeURIComponent(p.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/* ── JWT verification (HS256 via Web Crypto) ─────────────────────── */

async function verifyJwt(token, secret, ctx) {
  if (!secret) {
    // Misconfiguration — fail closed. Don't silently let traffic through.
    console.error('[lazypo-worker] SUPABASE_JWT_SECRET is not configured');
    return false;
  }

  // Token cache — keyed by last 24 chars of the JWT signature (enough to
  // uniquely identify a token). Stored in caches.default with 60s TTL.
  const cacheKey = new Request('https://lazypo-jwt-cache/' + token.slice(-24));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.status === 200;
  }

  let valid = false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    // Decode header — must be HS256, alg=HS256, typ=JWT
    const header = JSON.parse(base64UrlToString(headerB64));
    if (header.alg !== 'HS256') return false;

    // Decode payload — check exp and basic shape
    const payload = JSON.parse(base64UrlToString(payloadB64));
    if (typeof payload.exp !== 'number') return false;
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;
    if (!payload.sub) return false; // no user id → reject

    // Verify HMAC-SHA256 signature
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const sig = base64UrlToBytes(sigB64);
    valid = await crypto.subtle.verify('HMAC', key, sig, data);
  } catch (err) {
    console.warn('[lazypo-worker] JWT parse error:', err && err.message);
    valid = false;
  }

  // Cache result for 60s (both valid and invalid — saves CPU on retries)
  const cacheResponse = new Response(valid ? 'ok' : 'bad', {
    status: valid ? 200 : 401,
    headers: { 'Cache-Control': 'max-age=60' },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  return valid;
}

function base64UrlToString(b64url) {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

function base64UrlToBytes(b64url) {
  // base64url → base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
