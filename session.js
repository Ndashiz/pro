/* ═══════════════════════════════════════════════════════════════════
   LazyPO — session.js  |  User activity detection & session security
   ───────────────────────────────────────────────────────────────────
   SUPABASE SETUP  (run once in Supabase SQL Editor)
   ───────────────────────────────────────────────────────────────────

   -- Run once in Supabase SQL Editor
   create table public.user_sessions (
     id          uuid default gen_random_uuid() primary key,
     user_id     uuid references auth.users(id) on delete cascade not null,
     device_info text,
     last_seen   timestamptz default now(),
     created_at  timestamptz default now(),
     is_active   boolean default true
   );
   alter table public.user_sessions enable row level security;
   create policy "own_sessions" on public.user_sessions
     using (auth.uid() = user_id) with check (auth.uid() = user_id);

═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Skip on auth/callback pages ───────────────────────────────── */
  const _page = location.pathname.split('/').pop().toLowerCase();
  if (_page === 'login.html' || _page === 'spotify-callback.html') return;

  /* ── Constants ──────────────────────────────────────────────────── */
  const INACTIVITY_TIMEOUT  = 2 * 60 * 60 * 1000;  // 2h
  const MAX_SESSION_DURATION = 8 * 60 * 60 * 1000; // 8h
  const HEARTBEAT_MS        = 2 * 60 * 1000;        // 2min
  const WARN_BEFORE_MS      = 5 * 60 * 1000;        // warn 5min before timeout

  /* localStorage key for persisted activity — survives tab/browser close.
     Without this, lastActivity was reset to now() on every page boot, so
     "2h inactivity" could never trigger if the browser was closed in
     between. With this, we record the actual last interaction timestamp
     and check it on boot to enforce the limit across sessions. */
  const ACTIVITY_KEY = 'lazypo:lastActivity';

  /* ── State ──────────────────────────────────────────────────────── */
  let lastActivity   = Date.now();
  let sessionStart   = Date.now();
  let sessionDbId    = null;
  let heartbeatTimer = null;
  let warnShown      = false;
  let warnEl         = null;

  /* ── localStorage helpers ───────────────────────────────────────── */
  function persistActivity(ts) {
    try { localStorage.setItem(ACTIVITY_KEY, String(ts)); } catch (_) {}
  }
  function readPersistedActivity() {
    try {
      const raw = localStorage.getItem(ACTIVITY_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (_) { return 0; }
  }
  function clearPersistedActivity() {
    try { localStorage.removeItem(ACTIVITY_KEY); } catch (_) {}
  }

  /* ── Activity tracking ──────────────────────────────────────────── */
  function onActivity() {
    lastActivity = Date.now();
    persistActivity(lastActivity);
    hideWarning();
  }

  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  ACTIVITY_EVENTS.forEach(evt => {
    document.addEventListener(evt, onActivity, { passive: true });
  });

  /* Quand l'onglet redevient visible (retour de mise en veille du Mac,
     changement d'onglet, etc.) on NE veut PAS reset le compteur — sinon
     le simple fait de rouvrir l'ordi efface 2h d'absence. À la place :
     on vérifie le timestamp persisté et on force la déconnexion si
     l'inactivité a dépassé le seuil. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (isMusicPlaying()) return; // exception musique = activité
    const reference = readPersistedActivity() || lastActivity;
    if (Date.now() - reference >= INACTIVITY_TIMEOUT) {
      forceLogout('inactivity_persistent');
    }
    // Pas de mise à jour de lastActivity : seule une VRAIE interaction
    // (souris, clavier, scroll, click) compte comme reset.
  });

  /* ── Music detection ────────────────────────────────────────────── */
  function isMusicPlaying() {
    return window.FocusFM?.isPlaying?.() === true;
  }

  /* ── Device info ────────────────────────────────────────────────── */
  function getDeviceInfo() {
    const ua = navigator.userAgent;
    const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
    const deviceType = mobile ? 'Mobile' : 'Desktop';

    let browser = 'Unknown';
    if (/Edg\//i.test(ua))       browser = 'Edge';
    else if (/OPR\//i.test(ua))  browser = 'Opera';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua))  browser = 'Safari';

    return `${deviceType} \u00b7 ${browser}`;
  }

  /* ── Wait for window.sb ─────────────────────────────────────────── */
  async function waitForSb(retries = 10, delay = 300) {
    for (let i = 0; i < retries; i++) {
      if (window.sb) return window.sb;
      await new Promise(r => setTimeout(r, delay));
    }
    return null;
  }

  /* ── Register session in DB ─────────────────────────────────────── */
  async function registerSession() {
    const sb = await waitForSb();
    if (!sb) return;

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    const userId    = session.user.id;
    const deviceInfo = getDeviceInfo();
    const now       = new Date().toISOString();

    // Reuse an existing active session for the same device instead of creating a duplicate
    const { data: existing } = await sb.from('user_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('device_info', deviceInfo)
      .eq('is_active', true)
      .order('last_seen', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Update last_seen on the existing session
      sessionDbId = existing.id;
      await sb.from('user_sessions')
        .update({ last_seen: now })
        .eq('id', sessionDbId);
    } else {
      // First session from this device — create a new row
      const { data, error } = await sb.from('user_sessions').insert({
        user_id:     userId,
        device_info: deviceInfo,
        last_seen:   now,
        is_active:   true,
      }).select('id').single();

      if (!error && data) {
        sessionDbId = data.id;
      }
    }

    // Cleanup stale sessions (inactive + older than 24h)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await sb.from('user_sessions')
      .delete()
      .eq('user_id', userId)
      .eq('is_active', false)
      .lt('last_seen', cutoff);
  }

  /* ── Force logout ───────────────────────────────────────────────── */
  async function forceLogout(reason) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    clearPersistedActivity();

    if (sessionDbId && window.sb) {
      await window.sb.from('user_sessions')
        .update({ is_active: false })
        .eq('id', sessionDbId);
    }

    if (window.sb) await window.sb.auth.signOut();
    window.location.href = 'login.html?reason=' + reason;
  }

  /* ── Heartbeat ──────────────────────────────────────────────────── */
  async function heartbeat() {
    if (!window.sb) return;

    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      return;
    }

    // Multi-onglets safety : si un autre onglet LazyPO est actif et a
    // mis à jour le timestamp localStorage, on l'adopte ici pour ne pas
    // logger out par erreur cet onglet (qui croit être inactif).
    const persistedTs = readPersistedActivity();
    if (persistedTs > lastActivity) lastActivity = persistedTs;

    const inactive = Date.now() - lastActivity;
    const age      = Date.now() - sessionStart;

    if (age >= MAX_SESSION_DURATION) {
      forceLogout('max_session');
      return;
    }

    if (inactive >= INACTIVITY_TIMEOUT && !isMusicPlaying()) {
      forceLogout('inactivity');
      return;
    }

    if (inactive >= INACTIVITY_TIMEOUT - WARN_BEFORE_MS && !isMusicPlaying() && !warnShown) {
      const minutesLeft = Math.round((INACTIVITY_TIMEOUT - inactive) / 60000);
      showWarning(minutesLeft);
      return;
    }

    // Still active — update last_seen
    if (sessionDbId) {
      await window.sb.from('user_sessions')
        .update({ last_seen: new Date().toISOString(), is_active: true })
        .eq('id', sessionDbId);
    }
  }

  /* ── Warning UI ─────────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('_sess_css')) return;
    const s = document.createElement('style');
    s.id = '_sess_css';
    s.textContent = `
#_sess_warn {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(80px);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #1c1c1c;
  border: 1px solid #f59e0b;
  border-radius: 12px;
  padding: 14px 18px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.15);
  font-family: 'DM Sans', sans-serif;
  max-width: 360px;
  width: calc(100vw - 48px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease, transform 0.3s ease;
}
#_sess_warn.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: all;
}
#_sess_warn .sw-icon {
  font-size: 20px;
  flex-shrink: 0;
  line-height: 1.2;
}
#_sess_warn .sw-body {
  flex: 1;
  min-width: 0;
}
#_sess_warn .sw-title {
  font-size: 13px;
  font-weight: 700;
  color: #f59e0b;
  margin-bottom: 4px;
}
#_sess_warn .sw-msg {
  font-size: 12px;
  color: #a0a0a0;
  line-height: 1.5;
  margin-bottom: 10px;
}
#_sess_warn .sw-msg strong {
  color: #f0f0f0;
}
#_sess_warn .sw-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  background: rgba(245,158,11,0.15);
  border: 1px solid rgba(245,158,11,0.4);
  border-radius: 7px;
  color: #f59e0b;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
#_sess_warn .sw-btn:hover {
  background: rgba(245,158,11,0.25);
}
    `;
    document.head.appendChild(s);
  }

  function createWarnEl() {
    if (document.getElementById('_sess_warn')) return document.getElementById('_sess_warn');
    const el = document.createElement('div');
    el.id = '_sess_warn';
    el.innerHTML = `
      <div class="sw-icon">&#9201;</div>
      <div class="sw-body">
        <div class="sw-title">Session expiring soon</div>
        <div class="sw-msg">You'll be logged out in <strong id="_sess_min">5 min</strong> due to inactivity.</div>
        <button class="sw-btn" id="_sess_stay">Stay logged in</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#_sess_stay').addEventListener('click', () => {
      onActivity();
    });
    return el;
  }

  function showWarning(minutesLeft) {
    warnShown = true;
    warnEl = createWarnEl();
    const minEl = document.getElementById('_sess_min');
    if (minEl) minEl.textContent = minutesLeft + ' min';
    // Force reflow before adding class for transition
    warnEl.offsetHeight;
    warnEl.classList.add('visible');
  }

  function hideWarning() {
    warnShown = false;
    if (warnEl) {
      warnEl.classList.remove('visible');
    }
  }

  /* ── Boot ───────────────────────────────────────────────────────── */
  async function boot() {
    const sb = await waitForSb();
    if (!sb) return;

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    injectCSS();

    /* Enforce inactivity timeout across browser/tab closes by reading the
       last activity timestamp persisted to localStorage. If the user has
       been inactive for more than INACTIVITY_TIMEOUT (even with the browser
       closed in between), force a logout immediately — no chance to use
       the app on resume. */
    const persistedTs = readPersistedActivity();
    const now = Date.now();
    if (persistedTs > 0) {
      const inactiveMs = now - persistedTs;
      if (inactiveMs >= INACTIVITY_TIMEOUT) {
        await forceLogout('inactivity_persistent');
        return;
      }
      lastActivity = persistedTs;
    } else {
      lastActivity = now;
      persistActivity(lastActivity);
    }

    sessionStart = now;

    await registerSession();

    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ── Public API ─────────────────────────────────────────────────── */
  window.LazySession = {
    getSessions: async () => {
      if (!window.sb) return [];
      const { data: { session } } = await window.sb.auth.getSession();
      if (!session) return [];
      const { data } = await window.sb
        .from('user_sessions')
        .select('*')
        .eq('user_id', session.user.id)
        .order('last_seen', { ascending: false });
      return data || [];
    },

    revokeSession: async (id) => {
      if (!window.sb) return;
      await window.sb.from('user_sessions')
        .update({ is_active: false })
        .eq('id', id);
    },

    getCurrentSessionId: () => sessionDbId,
  };

})();
