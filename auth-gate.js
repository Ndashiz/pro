/* ═══════════════════════════════════════════════════════════════════
   LazyPO — auth-gate.js (client-side UX layer)
   ───────────────────────────────────────────────────────────────────
   THIS IS NOT A SECURITY BOUNDARY. The actual gate is a Cloudflare
   Worker on ndashiz.be/lazypo/* that verifies a Supabase JWT cookie
   before the HTML is ever served. See worker/src/worker.js.

   What this script does for the user:
     1. If no Supabase session token is present in localStorage AND no
        session cookie is present → redirect to login.html immediately,
        before any DOM is parsed, to avoid a flash.
     2. If a token IS present → hide <html> via CSS until auth.js
        emits the `lazypo:profile` event (auth.js has confirmed the
        session is real). If the event never fires within 5s, redirect
        to login.html (fail-closed — better to bounce a slow page than
        leak protected content).
     3. Skip the gate on http://localhost — auth.js dev bypass handles
        local dev. Explicit protocol check guards against
        https://localhost.X.com style hostname tricks.

   Reasons we removed the previous "reveal after 3s no matter what"
   safety net:
     • RLS only protects the database, not the static HTML
     • A slow Supabase = full page leak
     • Now that the Worker gates HTML delivery, "fail-closed" here is
       safe — a real user with a real session will see the page within
       100-500ms ; a 5s redirect is only triggered when something is
       broken anyway.
═══════════════════════════════════════════════════════════════════ */
(function () {
  var hn = location.hostname;
  if (location.protocol === 'http:' && (hn === 'localhost' || hn === '127.0.0.1' || hn === '0.0.0.0')) return;

  // Supabase JS v2 storage key — `sb-<projectRef>-auth-token`
  var SB_KEY = 'sb-hrvxhnmtvzvrsmmmmtsv-auth-token';
  var probablyAuthed = false;

  try {
    var raw = localStorage.getItem(SB_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      // Require BOTH access_token and a numeric expires_at in the future.
      // The previous version accepted any object with an access_token OR
      // refresh_token — trivially forgeable by setting a fake localStorage
      // value. The Worker still does the real check; this is just to
      // avoid a useless redirect flash.
      if (parsed
          && typeof parsed.access_token === 'string'
          && parsed.access_token.split('.').length === 3
          && typeof parsed.expires_at === 'number'
          && parsed.expires_at > Math.floor(Date.now()/1000)) {
        probablyAuthed = true;
      }
    }
  } catch (_) {}

  if (!probablyAuthed) {
    // Hard redirect — before any DOM is parsed, no flash possible.
    // Carry a return_to so login.html can bounce back after success.
    var here = location.pathname + location.search;
    var sep = here.indexOf('?') >= 0 ? '&' : '?';
    location.replace('login.html' + sep + 'return_to=' + encodeURIComponent(here));
    return;
  }

  // Token shape looked plausible. Hide <html> while auth.js confirms
  // the session is real (it will fetch the user profile from Supabase
  // and dispatch lazypo:profile when done).
  var style = document.createElement('style');
  style.id = 'lazypo-auth-gate';
  style.textContent =
    'html{visibility:hidden!important;background:#0c0c0c!important}' +
    'html.lazypo-auth-ok{visibility:visible!important;background:initial!important}';
  (document.head || document.documentElement).appendChild(style);

  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    document.documentElement.classList.add('lazypo-auth-ok');
    document.removeEventListener('lazypo:profile', reveal);
  }
  document.addEventListener('lazypo:profile', reveal);

  // Fail-closed safety net: if auth.js never confirms within 5s,
  // assume the session is broken and bounce to login. We never reveal
  // protected content "just because" — the Worker is the real gate,
  // and if its cookie isn't here, the page wouldn't have been served
  // in the first place. This timeout is purely a UX rescue for cases
  // where auth.js itself failed to load or run.
  setTimeout(function () {
    if (revealed) return;
    var here = location.pathname + location.search;
    var sep = here.indexOf('?') >= 0 ? '&' : '?';
    location.replace('login.html' + sep + 'return_to=' + encodeURIComponent(here));
  }, 5000);
})();
