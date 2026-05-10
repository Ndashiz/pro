/* ═══════════════════════════════════════════════════════════════════
   LazyPO — auth-gate.js
   ───────────────────────────────────────────────────────────────────
   PRE-RENDER SYNCHRONOUS AUTH GATE
   Empêche le "flash" du contenu protégé avant que l'auth soit validée.

   Inclure dans <head> AVANT tout autre script et AVANT tout contenu
   visible. Aucune dépendance — script autonome ~40 lignes.

   Comportement :
     1. Si pas de token Supabase en localStorage → redirect immédiat
        vers login.html (avant tout parse DOM, donc 0 flash).
     2. Si token présent → cache <html> via CSS injecté synchronement,
        puis révèle au lazypo:profile event (auth confirmée par auth.js).
     3. Safety net : révèle après 3s si l'event n'arrive jamais.
     4. Skip sur localhost / 127.0.0.1 (le dev bypass d'auth.js prend
        le relais — pas de gate sur le dev environnement).

   La sécurité réelle reste assurée par les RLS Supabase ; ce gate ne
   fait QU'AMÉLIORER l'UX en évitant le flash de contenu protégé.
═══════════════════════════════════════════════════════════════════ */
(function () {
  var hn = location.hostname;
  if (hn === 'localhost' || hn === '127.0.0.1' || hn === '0.0.0.0') return;

  // Supabase JS v2 storage key — `sb-<projectRef>-auth-token`
  var KEY = 'sb-hrvxhnmtvzvrsmmmmtsv-auth-token';
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (_) {}

  var probablyAuthed = false;
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      // Accept if shape looks right ; auth.js fera la vraie vérification
      // côté serveur (refresh token, RLS, etc.). On garde un test laxiste
      // ici pour ne PAS rediriger un utilisateur dont le access_token est
      // juste expiré mais qui a un refresh_token utilisable.
      if (parsed && (parsed.access_token || parsed.refresh_token)) {
        probablyAuthed = true;
      }
    } catch (_) {}
  }

  if (!probablyAuthed) {
    // Hard redirect — aucun DOM n'est encore parsé, aucun flash possible
    location.replace('login.html');
    return;
  }

  // Token présent → cache <html> jusqu'à ce que auth.js confirme via
  // l'event lazypo:profile. CSS injecté avant tout paint.
  var style = document.createElement('style');
  style.id = 'lazypo-auth-gate';
  style.textContent =
    'html{visibility:hidden!important;background:#0c0c0c!important}' +
    'html.lazypo-auth-ok{visibility:visible!important;background:initial!important}';
  (document.head || document.documentElement).appendChild(style);

  function reveal() {
    document.documentElement.classList.add('lazypo-auth-ok');
    document.removeEventListener('lazypo:profile', reveal);
  }
  document.addEventListener('lazypo:profile', reveal);

  // Safety net : si l'event n'arrive pas en 3s (profil HS, fetch lent),
  // on révèle quand même — RLS protège le contenu côté serveur.
  setTimeout(reveal, 3000);
})();
