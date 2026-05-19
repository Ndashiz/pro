/* ═══════════════════════════════════════════════════════════════════
   LazyPO — auth.js  |  Shared authentication + user widget module
   ───────────────────────────────────────────────────────────────────
   SUPABASE SETUP  (run once in Supabase SQL Editor)
   ───────────────────────────────────────────────────────────────────

   -- 1. Profiles table
   create table public.profiles (
     id          uuid references auth.users(id) on delete cascade primary key,
     username    text,
     avatar_url  text,
     is_admin    boolean default false,
     created_at  timestamptz default now()
   );
   alter table public.profiles enable row level security;
   create policy "own_profile" on public.profiles
     using (auth.uid() = id) with check (auth.uid() = id);

   -- 2. Storage bucket  (Dashboard → Storage → New bucket)
   --    Name: avatars   |  Public: ON
   --    Then add these policies in SQL Editor:
   create policy "avatars_public_read" on storage.objects
     for select using (bucket_id = 'avatars');
   create policy "avatars_upload" on storage.objects
     for insert with check (
       bucket_id = 'avatars' and
       auth.uid()::text = (storage.foldername(name))[1]
     );
   create policy "avatars_update" on storage.objects
     for update using (
       bucket_id = 'avatars' and
       auth.uid()::text = (storage.foldername(name))[1]
     );
   create policy "avatars_delete" on storage.objects
     for delete using (
       bucket_id = 'avatars' and
       auth.uid()::text = (storage.foldername(name))[1]
     );
═══════════════════════════════════════════════════════════════════ */

(function () {
  /* ── Config ──────────────────────────────────────────────────── */
  const SUPABASE_URL  = 'https://hrvxhnmtvzvrsmmmmtsv.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_Mj-FuPZcN_oTeLQ0ME84yQ_uulPdJ4c';
  const LOGIN_PAGE    = 'login.html';
  const ACCOUNT_PAGE  = 'account.html';

  /* ── Local dev bypass ────────────────────────────────────────
     On localhost / 127.0.0.1, if the user has no real Supabase
     session we serve a stub "dev" session so the UI renders
     without login. Database calls still fail (invalid token) —
     this is for visual / flow testing only.
     Set window.__DISABLE_LOCAL_BYPASS = true (or sessionStorage
     key 'lazypo:disableLocalBypass') to opt out and use the
     normal auth flow even on localhost.
  ────────────────────────────────────────────────────────────── */
  // Local dev bypass — narrowly scoped:
  //   • only on the three loopback hostnames
  //   • only on http: (prod is always https) — defence in depth against
  //     a CF Worker / Pages routing surprise
  //   • only when EXPLICITLY enabled via window.__ENABLE_LOCAL_BYPASS
  //     (defaults to off). Set this in your local dev tooling, never in
  //     a committed file. To verify: open DevTools on localhost and run
  //     `window.__ENABLE_LOCAL_BYPASS = true; location.reload()`.
  //   • can also be disabled at any time via sessionStorage.
  const _localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
  const IS_LOCAL = _localHosts.has(location.hostname)
                && location.protocol === 'http:'
                && (window.__ENABLE_LOCAL_BYPASS === true
                    || sessionStorage.getItem('lazypo:enableLocalBypass') === '1')
                && sessionStorage.getItem('lazypo:disableLocalBypass') !== '1';
  const DEV_SESSION = IS_LOCAL ? {
    __dev: true,
    access_token: 'dev-bypass',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now()/1000) + 3600,
    user: {
      id: '00000000-0000-0000-0000-000000000099',
      email: 'dev@local',
      role: 'authenticated',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString()
    }
  } : null;
  if (IS_LOCAL) {
    console.warn('[LazyAuth] 🔧 Local dev bypass active — UI will render without login.\n' +
                 '            Supabase queries will fail until you sign in for real.\n' +
                 '            To disable: sessionStorage.setItem("lazypo:disableLocalBypass","1") + reload.');
  }

  const { createClient } = supabase;
  window.sb = createClient(SUPABASE_URL, SUPABASE_ANON);

  /* ── Inject widget CSS once ──────────────────────────────────── */
  const css = document.createElement('style');
  css.textContent = `
  /* ─────────────────────── user widget ─────────────────────── */
  .sidebar-footer { padding: 0 4px; }

  .user-widget { position: relative; width: 100%; }

  .user-trigger {
    display: flex; align-items: center; gap: 10px;
    width: 100%; padding: 8px 10px;
    background: transparent; border: 1px solid transparent;
    border-radius: 10px; cursor: pointer; color: var(--text);
    transition: background 0.15s, border-color 0.15s; text-align: left;
    font-family: 'DM Sans', sans-serif;
  }
  .user-trigger:hover { background: var(--surface2); border-color: var(--border2); }

  .u-avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; overflow: hidden; position: relative;
    box-shadow: 0 0 0 2px rgba(96,165,250,0.2);
  }
  .u-avatar img {
    width: 100%; height: 100%; object-fit: cover;
    position: absolute; inset: 0;
  }
  .u-avatar-fallback {
    font-size: 13px; font-weight: 700; color: #fff;
    font-family: 'DM Sans', sans-serif; line-height: 1;
    position: relative; z-index: 1;
  }

  .u-info { flex: 1; min-width: 0; }
  .u-name {
    display: flex; align-items: center; gap: 5px;
    font-size: 13px; font-weight: 600; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    line-height: 1.3;
  }
  .u-email {
    font-size: 11px; color: var(--muted); display: block;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    line-height: 1.3;
  }

  .badge-admin {
    font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
    padding: 2px 6px; border-radius: 20px; text-transform: uppercase;
    background: rgba(139,92,246,0.15); color: #c084fc;
    border: 1px solid rgba(192,132,252,0.25); flex-shrink: 0;
  }

  .u-chevron {
    flex-shrink: 0; color: var(--muted);
    transition: transform 0.2s ease;
  }
  .user-widget.open .u-chevron { transform: rotate(180deg); }

  /* ─── dropdown ─── */
  .u-menu {
    position: absolute; bottom: calc(100% + 6px); left: 0; right: 0;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 10px; padding: 4px;
    box-shadow: 0 -8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
    opacity: 0; pointer-events: none;
    transform: translateY(6px); transition: opacity 0.15s, transform 0.15s;
    z-index: 300;
  }
  .u-menu.open { opacity: 1; pointer-events: all; transform: translateY(0); }

  .u-menu-item {
    display: flex; align-items: center; gap: 9px;
    width: 100%; padding: 9px 12px;
    font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
    color: var(--text); background: transparent; border: none;
    border-radius: 8px; cursor: pointer; text-decoration: none;
    transition: background 0.12s; white-space: nowrap;
  }
  .u-menu-item:hover { background: rgba(255,255,255,0.05); }
  .u-menu-item.danger { color: #f87171; }
  .u-menu-item.danger:hover { background: rgba(239,68,68,0.1); }
  .u-menu-sep { height: 1px; background: var(--border); margin: 4px 2px; }

  /* ─── guest btn ─── */
  .auth-guest-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 10px 12px;
    background: var(--accent); color: #fff; border-radius: 10px;
    font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
    text-decoration: none; transition: background 0.15s, transform 0.15s;
    border: none; cursor: pointer;
  }
  .auth-guest-btn:hover { background: #2563eb; transform: translateY(-1px); }
  `;
  document.head.appendChild(css);

  /* ── Boot ────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', boot);

  /* If the user uploaded an avatar at signup, login.html stashed it as a
     dataURL in localStorage (Storage RLS needs an authenticated session,
     which signUp doesn't provide when email confirmation is on). On first
     login we flush that to Storage and persist the URL on profiles. */
  async function _flushPendingAvatar() {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session || session.__dev) return;
    const email = (session.user.email || '').toLowerCase();
    if (!email) return;
    const key = 'lazypo:pendingAvatar:' + email;
    const dataUrl = localStorage.getItem(key);
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const ext  = (blob.type.split('/')[1] || 'png').replace('jpeg','jpg');
      const file = new File([blob], `avatar.${ext}`, { type: blob.type });
      const url  = await window.LazyAuth.uploadAvatar(session.user.id, file);
      await window.LazyAuth.saveProfile(session.user.id, { avatar_url: url });
    } catch (_) { /* swallow — best effort */ }
    localStorage.removeItem(key);
  }

  /* ── Session cookie (read by the Cloudflare Worker gate) ─────────
     The Worker on ndashiz.be/lazypo/* requires a `lazypo_jwt` cookie
     containing a valid Supabase access_token to serve any non-public
     HTML. We set/refresh/clear this cookie in sync with the Supabase
     session — Supabase JS still stores its session in localStorage as
     usual, we just mirror the access_token into a cookie scoped to
     /lazypo so the edge can read it. */
  const SESSION_COOKIE = 'lazypo_jwt';
  // Cookie path mirrors where the Worker is deployed in prod (/lazypo/*).
  // In local dev the site is served from /, so use / and skip the Secure
  // flag (browsers reject Secure cookies on http://localhost).
  function _cookiePath() {
    return location.pathname.startsWith('/lazypo/') ? '/lazypo' : '/';
  }
  function _setSessionCookie(session) {
    if (!session || !session.access_token) return;
    if (session.__dev) return; // never write the dev-bypass token to a cookie
    const expiresIn = Number(session.expires_in) > 0
      ? Number(session.expires_in)
      : 3600;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${SESSION_COOKIE}=${encodeURIComponent(session.access_token)}` +
      `; Path=${_cookiePath()}` +
      `; Max-Age=${expiresIn}` +
      `; SameSite=Lax` +
      secure;
  }
  function _clearSessionCookie() {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${SESSION_COOKIE}=; Path=${_cookiePath()}; Max-Age=0; SameSite=Lax` + secure;
  }

  async function boot() {
    await _flushPendingAvatar();

    // Hydrate the cookie from the current session on every page load so
    // a still-valid Supabase session that predates the Worker rollout
    // immediately gets gated correctly on the next navigation.
    try {
      const { data: { session } } = await window.sb.auth.getSession();
      if (session) _setSessionCookie(session);
      else _clearSessionCookie();
    } catch (_) {}

    await renderNavUser();
    window.sb.auth.onAuthStateChange(async (event, session) => {
      // Keep the cookie in sync with Supabase's session state
      if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) {
        _setSessionCookie(session);
      }
      if (event === 'SIGNED_OUT') {
        _clearSessionCookie();
        if (!IS_LOCAL) window.location.href = LOGIN_PAGE;
      }
      if (event === 'SIGNED_IN') {
        await _flushPendingAvatar();
        renderNavUser();
      }
    });

    // Dynamically load session manager for authenticated users
    const { data: { session } } = await window.sb.auth.getSession();
    if (session && !document.querySelector('script[src="session.js"]')) {
      const s = document.createElement('script');
      s.src = 'session.js';
      document.head.appendChild(s);
    }
  }

  /* ── Render sidebar footer ───────────────────────────────────── */
  async function renderNavUser() {
    const footer = document.querySelector('.sb-footer');
    if (!footer) return;

    let { data: { session } } = await window.sb.auth.getSession();
    if (!session && IS_LOCAL) session = DEV_SESSION;

    if (!session) {
      footer.innerHTML = `
        <a href="${LOGIN_PAGE}" class="auth-guest-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          Sign in
        </a>`;
      return;
    }

    /* fetch profile — graceful if table doesn't exist yet */
    let profile = null;
    if (session.__dev) {
      profile = {
        id: session.user.id, username: 'dev', avatar_url: null, is_admin: true,
        allowed_modules: ['quiz','scope','sprint','jira','livenote','minutehub','focusfm']
      };
    } else {
      try {
        const { data } = await window.sb
          .from('profiles').select('*').eq('id', session.user.id).single();
        profile = data;
      } catch (_) {}
    }

    /* ── approval check ── */
    if (profile && profile.is_approved === false) {
      await window.sb.auth.signOut();
      window.location.href = LOGIN_PAGE + '?pending=1';
      return;
    }

    const email    = session.user.email || '';
    const username = profile?.username || email.split('@')[0] || 'User';
    const avatar   = profile?.avatar_url || null;
    const isAdmin  = profile?.is_admin || false;
    const initial  = username[0].toUpperCase();
    const allowedModules = Array.isArray(profile?.allowed_modules)
      ? profile.allowed_modules
      : ['quiz'];

    /* Fetch user's pending requests so sidebar can show an hourglass icon
       on modules waiting for admin validation. Rejected/approved requests
       are NOT included — rejected falls back to the default 🔒 icon. */
    let pendingModules = [];
    if (!session.__dev) {
      try {
        const { data: reqs } = await window.sb
          .from('module_access_requests')
          .select('module_id')
          .eq('user_id', session.user.id)
          .eq('status', 'pending');
        pendingModules = (reqs || []).map(r => r.module_id);
      } catch (_) {}
    }

    /* Cache profile + broadcast to other modules (sidebar, page guards, …) */
    window.LazyAuth.__profile = { isAdmin, username, email, avatar, allowedModules, pendingModules };
    document.dispatchEvent(new CustomEvent('lazypo:profile', {
      detail: { isAdmin, username, email, avatar, allowedModules, pendingModules }
    }));

    /* Admin extras : fetch unread notification count + expose */
    if (isAdmin && !session.__dev) {
      try {
        const { count } = await window.sb
          .from('admin_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('is_read', false);
        const unread = count || 0;
        window.LazyAuth.__adminUnread = unread;
        document.dispatchEvent(new CustomEvent('lazypo:admin-notifs', {
          detail: { unread }
        }));
      } catch (_) {}
    }

    footer.innerHTML = `
      <div class="user-widget" id="authWidget">
        <button class="user-trigger" onclick="window.__authToggleMenu(event)">
          <div class="u-avatar">
            ${avatar ? `<img src="${esc(avatar)}" alt="" onerror="this.remove()">` : ''}
            <div class="u-avatar-fallback">${esc(initial)}</div>
          </div>
          <div class="u-info">
            <span class="u-name">
              ${esc(username)}
              ${isAdmin ? '<span class="badge-admin">Admin</span>' : ''}
            </span>
            <span class="u-email">${esc(email)}</span>
          </div>
          <svg class="u-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div class="u-menu" id="authMenu">
          <a href="${ACCOUNT_PAGE}" class="u-menu-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
            My Account
          </a>
          <div class="u-menu-sep"></div>
          <button class="u-menu-item danger" onclick="window.__authSignOut()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </div>`;

    /* close on outside click */
    setTimeout(() => {
      document.addEventListener('click', _closeOnOutside, { capture: true });
    }, 0);
  }

  function _closeOnOutside(e) {
    const w = document.getElementById('authWidget');
    if (w && !w.contains(e.target)) _closeMenu();
  }

  function _closeMenu() {
    document.getElementById('authMenu')?.classList.remove('open');
    document.getElementById('authWidget')?.classList.remove('open');
  }

  /* ── Global handlers ─────────────────────────────────────────── */
  window.__authToggleMenu = function (e) {
    e.stopPropagation();
    const menu   = document.getElementById('authMenu');
    const widget = document.getElementById('authWidget');
    if (!menu) return;
    const opening = !menu.classList.contains('open');
    menu.classList.toggle('open', opening);
    widget?.classList.toggle('open', opening);
  };

  window.__authSignOut = async function () {
    // Clear persisted activity so the next login starts with a fresh timer
    // (otherwise an old stale timestamp could force-logout immediately on
    // the next sign-in via session.js boot check).
    try { localStorage.removeItem('lazypo:lastActivity'); } catch (_) {}
    // Clear the Worker-gate cookie BEFORE Supabase signOut so even if the
    // navigation races the SIGNED_OUT event, the next request is rejected.
    _clearSessionCookie();
    await window.sb.auth.signOut();
    window.location.href = LOGIN_PAGE;
  };

  /* ── Public API ──────────────────────────────────────────────── */
  window.LazyAuth = {
    /** Redirect to login if no session, else return session */
    requireAuth: async () => {
      const { data: { session } } = await window.sb.auth.getSession();
      if (session) return session;
      if (IS_LOCAL) return DEV_SESSION;
      window.location.href = LOGIN_PAGE; return null;
    },
    /** Re-render the sidebar user widget — call after avatar/username changes */
    refreshNavUser: () => renderNavUser(),
    /** Fetch a user's profile row */
    getProfile: async (userId) => {
      if (IS_LOCAL && DEV_SESSION && userId === DEV_SESSION.user.id) {
        return { id: userId, username: 'dev', avatar_url: null, is_admin: true };
      }
      const { data } = await window.sb.from('profiles').select('*').eq('id', userId).single();
      return data;
    },
    /** Upsert profile fields */
    saveProfile: async (userId, fields) => {
      // Try UPDATE first (works when row already exists and covers all RLS scenarios)
      const { data: updated, error: upErr } = await window.sb
        .from('profiles')
        .update(fields)
        .eq('id', userId)
        .select('id');

      if (upErr) return { error: upErr };

      // If no row was updated (first-time user), INSERT
      if (!updated || updated.length === 0) {
        const { error: insErr } = await window.sb
          .from('profiles')
          .insert({ id: userId, ...fields });
        return { error: insErr };
      }

      return { error: null };
    },
    /**
     * Upload an avatar and return its publicly-accessible URL.
     *
     * Strategy:
     *  1. Use a UNIQUE filename per upload (timestamp-based) — sidesteps
     *     browser cache, lets old photos coexist briefly, and avoids
     *     race-y "upsert" semantics that have bitten us in the past.
     *  2. Pre-flight check : confirm the bucket exists with a list().
     *     If the bucket is missing, throw an explicit error before
     *     wasting a network upload.
     *  3. Upload as INSERT (no upsert needed thanks to the unique name).
     *  4. Get the public URL and probe it with HEAD — catches the case
     *     where the bucket isn't actually public or the public_read
     *     policy is missing (otherwise we'd save an unreadable URL).
     *  5. Best-effort cleanup of older avatar files in this user's
     *     folder so the bucket doesn't grow forever. Cleanup failures
     *     are non-fatal — the new avatar is what matters.
     */
    uploadAvatar: async (userId, file) => {
      // Sanitise extension
      const rawExt = (file.name.split('.').pop() || 'png').toLowerCase();
      const ext = /^(jpg|jpeg|png|gif|webp)$/.test(rawExt) ? rawExt : 'png';
      const filename = `${Date.now()}.${ext}`;
      const path = `${userId}/${filename}`;

      // 1. Pre-flight: bucket reachable?
      try {
        const probe = await window.sb.storage.from('avatars').list(userId, { limit: 1 });
        if (probe.error && /not found|does not exist/i.test(probe.error.message || '')) {
          throw new Error('Le bucket "avatars" n\'existe pas dans Supabase Storage. Crée-le (Public ON).');
        }
      } catch (e) {
        if (e.message?.includes('bucket')) throw e;
        // Other list errors are non-fatal — we'll surface them via the upload step.
      }

      // 2. Upload (unique filename → no upsert needed)
      const { error: upErr } = await window.sb.storage
        .from('avatars')
        .upload(path, file, {
          upsert: false,
          contentType: file.type || `image/${ext}`,
          cacheControl: '3600',
        });
      if (upErr) {
        throw new Error(`Upload échoué : ${upErr.message}. Vérifie les policies RLS du bucket "avatars".`);
      }

      // 3. Public URL
      const { data: pu } = window.sb.storage.from('avatars').getPublicUrl(path);
      const publicUrl = pu?.publicUrl;
      if (!publicUrl) {
        throw new Error('Impossible de générer une URL publique. Le bucket "avatars" doit être marqué Public.');
      }

      // 4. Verify the URL is actually reachable.
      //    We use <img> rather than fetch() because Supabase Storage
      //    returns CORS-blocked errors for cross-origin HEAD requests
      //    even when the public read policy is missing — fetch would
      //    swallow that as a TypeError and we'd never know. <img> tags
      //    aren't subject to that constraint and give us a clean
      //    onload / onerror signal.
      const reachable = await new Promise((resolve) => {
        const probe = new Image();
        const timeout = setTimeout(() => resolve(false), 8000);
        probe.onload  = () => { clearTimeout(timeout); resolve(true); };
        probe.onerror = () => { clearTimeout(timeout); resolve(false); };
        // Cache-bust to force a fresh fetch
        probe.src = publicUrl + (publicUrl.includes('?') ? '&' : '?') + 'v=' + Date.now();
      });
      if (!reachable) {
        throw new Error(
          'La photo a été uploadée mais elle n\'est pas accessible publiquement. ' +
          'Étapes à vérifier dans Supabase :\n' +
          '  1. Storage → bucket "avatars" → activer "Public bucket"\n' +
          '  2. SQL Editor : créer la policy avatars_public_read si elle manque\n' +
          'Voir le message d\'aide complet dans la console.'
        );
      }

      // 5. Best-effort cleanup of older files for this user
      try {
        const { data: existing } = await window.sb.storage.from('avatars').list(userId);
        if (Array.isArray(existing) && existing.length > 0) {
          const toDelete = existing
            .filter(f => f.name && f.name !== filename)
            .map(f => `${userId}/${f.name}`);
          if (toDelete.length) {
            await window.sb.storage.from('avatars').remove(toDelete);
          }
        }
      } catch (_) { /* non-fatal */ }

      return publicUrl;
    },
  };

  /* ── Auth guard popup ───────────────────────────────────────── */
  function _injectPopupStyles() {
    if (document.getElementById('__authPopupStyles')) return;
    const s = document.createElement('style');
    s.id = '__authPopupStyles';
    s.textContent = `
    #authGuardOverlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: __fadeIn 0.2s ease;
    }
    @keyframes __fadeIn { from { opacity: 0; } to { opacity: 1; } }

    #authGuardCard {
      background: #161616; border: 1px solid #2a2a2a;
      border-radius: 18px; padding: 36px 32px;
      max-width: 400px; width: 100%;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      animation: __slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes __slideUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }

    #authGuardCard .ag-icon {
      width: 52px; height: 52px; border-radius: 14px;
      background: rgba(59,130,246,0.12); border: 1px solid rgba(96,165,250,0.2);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px; font-size: 22px;
    }
    #authGuardCard h2 {
      font-family: 'DM Sans', sans-serif; font-size: 18px; font-weight: 700;
      color: #f0f0f0; margin-bottom: 10px;
    }
    #authGuardCard p {
      font-family: 'DM Sans', sans-serif; font-size: 14px; color: #6b6b6b;
      line-height: 1.6; margin-bottom: 28px;
    }
    #authGuardCard .ag-btn-login {
      display: block; width: 100%; padding: 12px;
      background: #3b82f6; color: #fff; border: none;
      border-radius: 10px; font-family: 'DM Sans', sans-serif;
      font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none;
      transition: background 0.15s;
    }
    #authGuardCard .ag-btn-login:hover { background: #2563eb; }
    #authGuardCard .ag-btn-back {
      display: block; margin-top: 12px;
      font-family: 'DM Sans', sans-serif; font-size: 13px; color: #6b6b6b;
      background: none; border: none; cursor: pointer; text-decoration: none;
      transition: color 0.15s;
    }
    #authGuardCard .ag-btn-back:hover { color: #f0f0f0; }
    `;
    document.head.appendChild(s);
  }

  function _showAuthPopup() {
    _injectPopupStyles();
    if (document.getElementById('authGuardOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'authGuardOverlay';
    overlay.innerHTML = `
      <div id="authGuardCard">
        <div class="ag-icon">🔒</div>
        <h2>Sign in required</h2>
        <p>You need to sign in to your account to access this feature.</p>
        <a href="login.html" class="ag-btn-login">Sign in</a>
        <a href="index.html" class="ag-btn-back">← Back to home</a>
      </div>`;
    document.body.appendChild(overlay);
    // block scroll
    document.body.style.overflow = 'hidden';
  }

  window.LazyAuth.requireAuthOrPopup = async () => {
    const { data: { session } } = await window.sb.auth.getSession();
    if (session) return session;
    if (IS_LOCAL) return DEV_SESSION;
    window.location.href = LOGIN_PAGE; return null;
  };

  /* ── Module access guard ─────────────────────────────────────── */
  /* Module catalogue — labels shown in the lock screen.            */
  const MODULE_LABELS = {
    scope:     'Scope of Work',
    sprint:    'Sprint Planning',
    jira:      'Jira',
    livenote:  'LiveNote',
    minutehub: 'Minute Hub',
    quiz:      'Knowledge Quiz',
    focusfm:   'Focus FM',
  };

  async function _fetchAllowedModules(userId) {
    if (window.LazyAuth.__profile?.allowedModules)
      return window.LazyAuth.__profile.allowedModules;
    if (IS_LOCAL && DEV_SESSION && userId === DEV_SESSION.user.id)
      return ['quiz','scope','sprint','jira','livenote','minutehub','focusfm'];
    try {
      const { data } = await window.sb
        .from('profiles').select('allowed_modules,is_admin').eq('id', userId).single();
      if (data?.is_admin) {
        return ['quiz','scope','sprint','jira','livenote','minutehub','focusfm'];
      }
      return Array.isArray(data?.allowed_modules) ? data.allowed_modules : ['quiz'];
    } catch (_) { return ['quiz']; }
  }

  function _injectLockStyles() {
    if (document.getElementById('__moduleLockStyles')) return;
    const s = document.createElement('style');
    s.id = '__moduleLockStyles';
    s.textContent = `
    #moduleLockOverlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.78); backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px; animation: __fadeIn 0.2s ease;
      font-family: 'DM Sans', sans-serif;
    }
    #moduleLockCard {
      background: #161616; border: 1px solid #2a2a2a;
      border-radius: 18px; padding: 36px 32px;
      max-width: 440px; width: 100%; text-align: center;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      animation: __slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);
    }
    #moduleLockCard .ml-icon {
      width: 56px; height: 56px; border-radius: 14px;
      background: rgba(251,191,36,0.10); border: 1px solid rgba(251,191,36,0.25);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px; font-size: 24px;
    }
    #moduleLockCard h2 { font-size: 18px; font-weight: 700; color: #f0f0f0; margin-bottom: 10px; }
    #moduleLockCard p  { font-size: 14px; color: #8a8a8a; line-height: 1.6; margin-bottom: 22px; }
    #moduleLockCard textarea {
      width: 100%; padding: 10px 12px; margin-bottom: 16px;
      background: #1c1c1c; border: 1px solid #2a2a2a;
      border-radius: 10px; color: #f0f0f0; font: inherit; resize: vertical;
      min-height: 64px; outline: none;
    }
    #moduleLockCard textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
    #moduleLockCard .ml-btn-request {
      display: block; width: 100%; padding: 12px;
      background: #3b82f6; color: #fff; border: none;
      border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;
      transition: background 0.15s;
    }
    #moduleLockCard .ml-btn-request:hover { background: #2563eb; }
    #moduleLockCard .ml-btn-request:disabled { opacity: 0.6; cursor: not-allowed; }
    #moduleLockCard .ml-btn-back {
      display: block; margin-top: 12px; background: none; border: none;
      color: #6b6b6b; font: inherit; cursor: pointer; text-decoration: none;
    }
    #moduleLockCard .ml-btn-back:hover { color: #f0f0f0; }
    #moduleLockCard .ml-status {
      font-size: 13px; padding: 10px 12px; border-radius: 8px;
      margin-bottom: 14px; display: none;
    }
    #moduleLockCard .ml-status.show { display: block; }
    #moduleLockCard .ml-status.pending {
      background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.25); color: #fcd34d;
    }
    #moduleLockCard .ml-status.success {
      background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.25); color: #86efac;
    }
    #moduleLockCard .ml-status.error {
      background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5;
    }
    `;
    document.head.appendChild(s);
  }

  async function _showModuleLockOverlay(moduleId) {
    _injectLockStyles();
    if (document.getElementById('moduleLockOverlay')) return;
    const label = MODULE_LABELS[moduleId] || moduleId;
    const overlay = document.createElement('div');
    overlay.id = 'moduleLockOverlay';
    overlay.innerHTML = `
      <div id="moduleLockCard">
        <div class="ml-icon">🔒</div>
        <h2>Accès restreint — ${esc(label)}</h2>
        <p>Ce module n'est pas inclus dans ton accès par défaut. Demande l'accès à l'admin et tu seras notifié dès qu'il aura validé.</p>
        <div class="ml-status" id="mlStatus"></div>
        <textarea id="mlMessage" placeholder="Pourquoi as-tu besoin de ce module ? (optionnel)"></textarea>
        <button class="ml-btn-request" id="mlRequest">Demander l'accès</button>
        <a href="index.html" class="ml-btn-back">← Retour à l'accueil</a>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    /* Pré-remplit l'état si une requête existe déjà */
    try {
      const { data: { session } } = await window.sb.auth.getSession();
      if (session && !session.__dev) {
        const { data: existing } = await window.sb
          .from('module_access_requests')
          .select('status, created_at')
          .eq('user_id', session.user.id)
          .eq('module_id', moduleId)
          .order('created_at', { ascending: false })
          .limit(1);
        const last = existing?.[0];
        if (last?.status === 'pending') _setLockStatus('pending', 'Demande déjà envoyée — en attente de validation.');
      }
    } catch (_) {}

    document.getElementById('mlRequest').addEventListener('click', async () => {
      const btn = document.getElementById('mlRequest');
      const msg = document.getElementById('mlMessage').value.trim();
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        const { data: { session } } = await window.sb.auth.getSession();
        if (!session) throw new Error('Non connecté');
        const { error } = await window.sb.from('module_access_requests').insert({
          user_id: session.user.id, module_id: moduleId, message: msg || null,
        });
        if (error) {
          // 23505 = unique violation → demande déjà pending
          if (error.code === '23505') {
            _setLockStatus('pending', 'Demande déjà en attente.');
          } else { throw error; }
        } else {
          _setLockStatus('success', 'Demande envoyée ! L\'admin a été notifié.');
        }
      } catch (e) {
        _setLockStatus('error', e.message || 'Erreur lors de l\'envoi.');
      } finally {
        btn.disabled = true; btn.textContent = 'Demande envoyée';
      }
    });
  }

  function _setLockStatus(kind, text) {
    const el = document.getElementById('mlStatus');
    if (!el) return;
    el.className = 'ml-status show ' + kind;
    el.textContent = text;
  }

  /** Returns session if user has the module, otherwise locks the page. */
  window.LazyAuth.requireModule = async function (moduleId) {
    const { data: { session } } = await window.sb.auth.getSession();
    const liveSession = session || (IS_LOCAL ? DEV_SESSION : null);
    if (!liveSession) { window.location.href = LOGIN_PAGE; return null; }

    const allowed = await _fetchAllowedModules(liveSession.user.id);
    if (allowed.includes(moduleId)) return liveSession;

    _showModuleLockOverlay(moduleId);
    return null;
  };

  window.LazyAuth.canAccess = async function (moduleId) {
    const { data: { session } } = await window.sb.auth.getSession();
    const liveSession = session || (IS_LOCAL ? DEV_SESSION : null);
    if (!liveSession) return false;
    const allowed = await _fetchAllowedModules(liveSession.user.id);
    return allowed.includes(moduleId);
  };

  /** Expose flags for other modules / debugging */
  window.LazyAuth.isLocal    = IS_LOCAL;
  window.LazyAuth.devSession = DEV_SESSION;

  /** Public helpers — call after a successful signIn / signOut to make
      sure the Worker-gate cookie is in sync without waiting for the
      onAuthStateChange event to fire. */
  window.LazyAuth.setSessionCookie   = _setSessionCookie;
  window.LazyAuth.clearSessionCookie = _clearSessionCookie;

  /* ── Util ────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
