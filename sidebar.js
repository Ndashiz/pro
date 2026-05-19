/**
 * sidebar.js — Composant sidebar LazyPO
 *
 * Comportement :
 *  - Réduit (64px) par défaut → icônes seulement
 *  - Élargi (260px) au survol → icônes + labels visibles
 *  - Description de l'item visible au survol de l'item (sidebar déjà élargie)
 *  - Pas de badge de statut — tous les items ont le même style
 */
(function () {

  /* ═══════════════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════════════ */
  const ITEMS = [
    {
      id: 'home',
      icon: '🏠',
      label: 'Home',
      url: 'index.html',
      desc: 'Back to the LazyPO main page.'
    },
    { divider: true },
    {
      id: 'scope',
      icon: '✉️',
      label: 'Scope of Work',
      url: 'lazypo_generator.html',
      desc: 'Generate professional Scope of Work emails. Export as .eml ready for Outlook.'
    },
    {
      id: 'sprint',
      icon: '📋',
      label: 'Sprint Planning',
      url: 'sprintplanner.html',
      desc: 'Plan your sprints and auto-generate your presentation slides.'
    },
    {
      id: 'jira',
      icon: '🎫',
      label: 'Jira',
      url: 'jira.html',
      desc: 'Query Saver, Dashboard and File Cleaner for your Jira workflow.'
    },
    {
      id: 'livenote',
      icon: '📝',
      label: 'LiveNote',
      url: 'livenote.html',
      desc: 'Éditeur collaboratif en temps réel — écrivez ensemble, instantanément.'
    },
    {
      id: 'minutehub',
      icon: '📝',
      label: 'Minute Hub',
      url: null,
      desc: 'Centralise all your meeting notes in one click.'
    },
    {
      id: 'quiz',
      icon: '🧠',
      label: 'Knowledge Quiz',
      url: 'quiz.html',
      desc: 'Build your EN/NL vocabulary with spaced repetition quizzes.'
    },
    {
      id: 'focusfm',
      icon: '🎵',
      label: 'Focus FM',
      url: null,
      onClick: "window.FocusFM?.open()",
      desc: 'Spotify integration — play your playlists without leaving the app.'
    },
    { divider: true },
    {
      id: 'feedback',
      icon: '💡',
      label: 'Feedback',
      url: 'feedback.html',
      desc: 'Suggest improvements, vote on ideas, follow what\'s coming next.'
    },
    { divider: true },
    {
      id: 'admin',
      icon: '🛡️',
      label: 'Admin',
      url: 'admin.html',
      adminOnly: true,
      desc: 'Notifications, demandes d\'accès et gestion des utilisateurs.'
    },
    {
      id: 'docs',
      icon: '📖',
      label: 'Documentation',
      url: 'docs/architecture.html',
      newTab: true,
      adminOnly: true,
      desc: 'Architecture technique, schémas ER et flux système — admins uniquement.'
    }
  ];

  /* IDs des items qui sont des modules gateables (allowed_modules)         */
  const GATED_MODULES = new Set(['scope','sprint','jira','livenote','minutehub','focusfm']);

  /* ═══════════════════════════════════════════════════
     ACTIVE PAGE DETECTION
  ═══════════════════════════════════════════════════ */
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';
  function isActive(item) {
    if (!item.url) return false;
    return item.url === currentFile || (currentFile === '' && item.url === 'index.html');
  }

  /* ═══════════════════════════════════════════════════
     CSS
  ═══════════════════════════════════════════════════ */
  const css = `
    /* ── Shell ── */
    .sb {
      position: fixed; left: 0; top: 0; height: 100vh;
      width: 64px;
      background: #111111;
      border-right: 1px solid #222222;
      z-index: 200;
      overflow: hidden;
      display: flex; flex-direction: column;
      padding: 24px 0 20px;
      transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sb:hover { width: 260px; }

    /* Subtle blue line on right edge */
    .sb::after {
      content: '';
      position: absolute; top: 15%; right: -1px; bottom: 15%;
      width: 1px;
      background: linear-gradient(to bottom, transparent, rgba(59,130,246,0.35), transparent);
      pointer-events: none;
    }

    /* ── Logo ── */
    .sb-logo-wrap {
      display: flex; align-items: center;
      height: 44px; margin-bottom: 28px;
      padding: 0 16px;
      min-width: 260px; /* prevent shrinking inside overflow:hidden */
      text-decoration: none;
      flex-shrink: 0;
    }
    .sb-logo-star {
      font-family: 'Permanent Marker', cursive;
      font-size: 24px; color: #60a5fa;
      width: 32px; flex-shrink: 0; text-align: center; display: block;
      text-shadow: 0 0 12px rgba(96,165,250,0.4);
    }
    .sb-logo-name {
      font-family: 'Permanent Marker', cursive;
      font-size: 24px; color: #fff; letter-spacing: 1px;
      text-shadow: 2px 2px 0 rgba(59,130,246,0.4);
      margin-left: 10px;
      opacity: 0;
      transition: opacity 0.18s ease 0.06s;
      white-space: nowrap;
    }
    .sb:hover .sb-logo-name { opacity: 1; }

    /* ── Nav list ── */
    .sb-nav {
      display: flex; flex-direction: column;
      gap: 2px; padding: 0 8px;
    }

    /* ── Divider ── */
    .sb-divider {
      height: 1px; background: #1e1e1e;
      margin: 8px 8px;
      min-width: 244px;
      opacity: 0;
      transition: opacity 0.18s ease;
    }
    .sb:hover .sb-divider { opacity: 1; }

    /* ── Item wrapper ── */
    .sb-item { position: relative; min-width: 244px; }

    /* ── Link / Button row ── */
    .sb-item-link {
      display: flex; align-items: center;
      gap: 12px; padding: 8px 8px;
      color: #5a5a5a; font-size: 14px; font-weight: 500;
      text-decoration: none; border: none; background: none;
      border-radius: 8px; cursor: pointer;
      width: 100%; text-align: left;
      transition: color 0.15s, background 0.15s;
      position: relative;
      min-width: 244px;
      font-family: 'DM Sans', sans-serif;
    }
    .sb-item:hover .sb-item-link {
      color: #f0f0f0; background: #1a1a1a;
    }
    .sb-item.active .sb-item-link {
      color: #f0f0f0; background: #1c1c1c;
    }
    /* Active left bar */
    .sb-item.active .sb-item-link::before {
      content: '';
      position: absolute; left: -8px; top: 18%; bottom: 18%;
      width: 2px; background: #60a5fa; border-radius: 2px;
      box-shadow: 0 0 8px rgba(96,165,250,0.7);
    }

    /* ── Icon ── */
    .sb-icon {
      width: 32px; height: 32px; border-radius: 8px;
      background: #232323;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; flex-shrink: 0;
      transition: background 0.15s;
    }
    .sb-item.active .sb-icon { background: rgba(59,130,246,0.14); }
    .sb-item:hover   .sb-icon { background: #2a2a2a; }

    /* ── Label ── */
    .sb-label {
      opacity: 0;
      transition: opacity 0.18s ease 0.06s;
      white-space: nowrap; overflow: hidden;
      flex: 1;
    }
    .sb:hover .sb-label { opacity: 1; }

    /* ── Description (visible on item hover when sidebar is expanded) ── */
    .sb-desc {
      max-height: 0; overflow: hidden;
      padding: 0 8px 0 52px; /* aligned under label */
      font-size: 11.5px; color: #555; line-height: 1.5;
      transition: max-height 0.22s ease, padding-bottom 0.22s ease, color 0.22s;
      white-space: normal;
      min-width: 244px;
    }
    .sb:hover .sb-item:hover .sb-desc {
      max-height: 56px; padding-bottom: 8px; color: #777;
    }

    /* ── Spacer + Footer ── */
    .sb-spacer { flex: 1; }
    .sb-footer {
      display: flex; align-items: center;
      padding: 0 16px; gap: 10px;
      min-width: 244px;
    }
    .sb-footer-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #60a5fa; box-shadow: 0 0 6px rgba(96,165,250,0.6);
      animation: sb-pulse 2.5s ease infinite; flex-shrink: 0;
    }
    @keyframes sb-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.45; transform: scale(0.65); }
    }
    .sb-footer-text {
      font-size: 12px; color: #4a4a4a; white-space: nowrap;
      opacity: 0; transition: opacity 0.18s ease;
    }
    .sb-footer-text strong { color: #555; }
    .sb:hover .sb-footer-text { opacity: 1; }

    /* ── Mobile burger ── */
    .sb-burger {
      display: none;
      position: fixed; top: 16px; left: 16px; z-index: 300;
      width: 40px; height: 40px; border-radius: 10px;
      background: #1c1c1c; border: 1px solid #2a2a2a;
      cursor: pointer; align-items: center; justify-content: center;
      flex-direction: column; gap: 5px;
    }
    .sb-burger span {
      display: block; width: 18px; height: 2px;
      background: #f0f0f0; border-radius: 2px;
      transition: all 0.25s ease;
    }
    .sb-burger.open span:nth-child(1) { transform: rotate(45deg) translate(2.5px, 2.5px); }
    .sb-burger.open span:nth-child(2) { opacity: 0; }
    .sb-burger.open span:nth-child(3) { transform: rotate(-45deg) translate(2.5px, -2.5px); }

    .sb-overlay {
      display: none; position: fixed; inset: 0; z-index: 190;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
    }
    .sb-overlay.open { display: block; }

    .sb-close-btn {
      display: none;
      position: absolute; top: 14px; right: 14px;
      width: 30px; height: 30px; border-radius: 7px;
      background: #1c1c1c; border: 1px solid #2a2a2a;
      cursor: pointer; align-items: center; justify-content: center;
      color: #666; font-size: 14px;
    }

    /* ── Body offset (desktop) — donne de la place à la sidebar fixe ── */
    @media (min-width: 769px) {
      body { padding-left: 64px !important; }
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .sb {
        transform: translateX(-100%);
        width: 260px !important; /* always full width on mobile */
        transition: transform 0.28s ease;
      }
      .sb.open { transform: translateX(0); }
      .sb-burger     { display: flex; }
      .sb-close-btn  { display: flex; }
      /* Labels and desc always visible on mobile */
      .sb-logo-name,
      .sb-label,
      .sb-footer-text,
      .sb-divider { opacity: 1 !important; }
      .sb.open .sb-item:hover .sb-desc { max-height: 56px; padding-bottom: 8px; color: #777; }
    }

    /* ── Slide-in animation ── */
    .sb-item { animation: sb-in 0.38s ease both; }
    .sb-item:nth-child(1) { animation-delay: 0.04s; }
    .sb-item:nth-child(2) { animation-delay: 0.08s; }
    .sb-item:nth-child(3) { animation-delay: 0.12s; }
    .sb-item:nth-child(4) { animation-delay: 0.16s; }
    .sb-item:nth-child(5) { animation-delay: 0.20s; }
    .sb-item:nth-child(6) { animation-delay: 0.24s; }
    @keyframes sb-in {
      from { opacity: 0; transform: translateX(-10px); }
      to   { opacity: 1; transform: translateX(0); }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'sb-styles';
  styleEl.textContent = css + `
    /* ── Admin-only items: hidden until profile confirms is_admin ── */
    .sb-admin-only { display: none; }
    .sb-admin-only.sb-admin-visible { display: block; }
    /* Subtle gold tint for admin item icon */
    .sb-admin-only.sb-admin-visible .sb-icon { background: rgba(251,191,36,.10); }
    .sb-admin-only.sb-admin-visible .sb-item-link { color: #6b6b4a; }
    .sb-admin-only.sb-admin-visible:hover .sb-item-link { color: #fef3c7; }
    .sb-admin-only.sb-admin-visible:hover .sb-icon { background: rgba(251,191,36,.18); }

    /* ── Locked module items (no access) ── */
    .sb-item.sb-locked .sb-icon { opacity: 0.45; }
    .sb-item.sb-locked .sb-item-link { color: #444; }
    /* Pending requests : slightly less dimmed than locked, yellow icon */
    .sb-item.sb-pending .sb-icon { opacity: 0.65; }
    .sb-item.sb-pending .sb-item-link { color: #6a6a4a; }
    /* Lock span is rendered for every gated module but hidden until the
       sb-locked OR sb-pending class is applied. */
    .sb-item .sb-lock { display: none; }
    .sb-item.sb-locked .sb-lock,
    .sb-item.sb-pending .sb-lock {
      display: block;
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      font-size: 11px; opacity: 0;
      transition: opacity 0.18s ease;
    }
    .sb:hover .sb-item.sb-locked .sb-lock { opacity: 0.7; }
    .sb:hover .sb-item.sb-pending .sb-lock { opacity: 0.95; }
    .sb-item.sb-pending .sb-lock { color: #fbbf24; }

    /* ── Account avatar slot (swaps emoji for photo when available) ── */
    .sb-icon-avatar { position: relative; overflow: hidden; }
    .sb-icon-avatar .sb-avatar-img {
      position: absolute; inset: 0;
      width: 100%; height: 100%; object-fit: cover;
      border-radius: inherit;
      display: none;
    }
    .sb-icon-avatar.has-photo .sb-avatar-img { display: block; }
    .sb-icon-avatar.has-photo .sb-icon-fallback { display: none; }
    .sb-icon-avatar.has-photo { background: transparent; }
    .sb-item:hover .sb-icon-avatar.has-photo,
    .sb-item.active .sb-icon-avatar.has-photo { background: transparent; }

    /* ── Admin notif badge ── */
    .sb-item .sb-notif-badge {
      position: absolute; top: 4px; left: 28px;
      min-width: 16px; height: 16px; padding: 0 5px;
      border-radius: 8px; background: #ef4444; color: #fff;
      font-size: 10px; font-weight: 700; line-height: 16px;
      text-align: center; box-shadow: 0 0 0 2px #111111;
      display: none;
    }
    .sb-item .sb-notif-badge.show { display: inline-block; }
  `;
  document.head.appendChild(styleEl);

  /* Swap the "My Account" sidebar icon for the user's avatar photo.
     Only flip to has-photo once the image loads — otherwise a broken URL
     would leave a blank square instead of the 👤 fallback. */
  function _applyAccountAvatar(avatarUrl) {
    const slot = document.querySelector('[data-sb-id="account"] .sb-icon-avatar');
    if (!slot) return;
    const img = slot.querySelector('.sb-avatar-img');
    if (!img) return;
    if (!avatarUrl) {
      slot.classList.remove('has-photo');
      img.removeAttribute('src');
      return;
    }
    img.onload  = () => slot.classList.add('has-photo');
    img.onerror = () => { slot.classList.remove('has-photo'); img.removeAttribute('src'); };
    img.src = avatarUrl;
  }

  /* Show admin-only items + handle module locks once profile resolves */
  document.addEventListener('lazypo:profile', function (e) {
    const detail = e.detail || {};
    if (detail.isAdmin) {
      document.querySelectorAll('.sb-admin-only').forEach(el => {
        el.classList.add('sb-admin-visible');
      });
    }
    _applyAccountAvatar(detail.avatar);
    const allowed = new Set(detail.allowedModules || ['quiz']);
    const pending = new Set(detail.pendingModules || []);
    document.querySelectorAll('[data-sb-id]').forEach(el => {
      const id = el.getAttribute('data-sb-id');
      if (!GATED_MODULES.has(id)) return;
      const hasAccess = detail.isAdmin || allowed.has(id);
      const isPending = !hasAccess && pending.has(id);
      el.classList.toggle('sb-locked',  !hasAccess && !isPending);
      el.classList.toggle('sb-pending', isPending);
      const icon = el.querySelector('.sb-lock');
      if (icon) icon.textContent = isPending ? '⏳' : '🔒';
    });
  });

  /* Admin notification count → red badge on Admin item */
  document.addEventListener('lazypo:admin-notifs', function (e) {
    const unread = e.detail?.unread || 0;
    const adminItem = document.querySelector('[data-sb-id="admin"]');
    if (!adminItem) return;
    let badge = adminItem.querySelector('.sb-notif-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sb-notif-badge';
      adminItem.querySelector('.sb-item-link')?.appendChild(badge);
    }
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('show', unread > 0);
  });

  /* ═══════════════════════════════════════════════════
     HTML BUILDER
  ═══════════════════════════════════════════════════ */
  function buildItem(item) {
    if (item.divider) return '<div class="sb-divider"></div>';

    const active      = isActive(item) ? ' active' : '';
    const adminClass  = item.adminOnly ? ' sb-admin-only' : '';
    const tag         = item.url ? 'a' : 'button';
    const hrefAttr    = item.url ? `href="${item.url}"` : 'type="button"';
    const targetAttr  = item.newTab ? 'target="_blank" rel="noopener"' : '';
    const clickAttr   = !item.url
      ? `onclick="${item.onClick || `window.showUnavailablePopup && window.showUnavailablePopup('${item.label}')`}"`
      : '';
    const lockSpan    = GATED_MODULES.has(item.id) ? '<span class="sb-lock">🔒</span>' : '';

    // The account icon is a special slot: when the user has an avatar URL
    // (broadcast via lazypo:profile), we swap the emoji for the photo.
    const iconHtml = item.id === 'account'
      ? `<div class="sb-icon sb-icon-avatar">
           <img class="sb-avatar-img" alt="">
           <span class="sb-icon-fallback">${item.icon}</span>
         </div>`
      : `<div class="sb-icon">${item.icon}</div>`;

    return `
      <div class="sb-item${active}${adminClass}" data-sb-id="${item.id}">
        <${tag} class="sb-item-link" ${hrefAttr} ${targetAttr} ${clickAttr}>
          ${iconHtml}
          <span class="sb-label">${item.label}</span>
          ${lockSpan}
        </${tag}>
        <div class="sb-desc">${item.desc}</div>
      </div>`;
  }

  const html = `
    <button class="sb-burger" id="sb-burger" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
    <div class="sb-overlay" id="sb-overlay"></div>

    <aside class="sb" id="sb-sidebar">
      <a href="index.html" class="sb-logo-wrap" aria-label="LazyPO — Home">
        <span class="sb-logo-star">✦</span>
        <span class="sb-logo-name">LazyPO</span>
      </a>
      <button class="sb-close-btn" id="sb-close" aria-label="Fermer">✕</button>

      <nav class="sb-nav" aria-label="Navigation principale">
        ${ITEMS.map(buildItem).join('\n')}
      </nav>

      <div class="sb-spacer"></div>
      <div class="sb-footer">
        <div class="sb-footer-dot"></div>
        <div class="sb-footer-text">v2.0 · <strong>100% local</strong></div>
      </div>
    </aside>`;

  /* ═══════════════════════════════════════════════════
     INJECT
  ═══════════════════════════════════════════════════ */
  document.body.insertAdjacentHTML('afterbegin', html);

  /* Lazy-load the global feedback submission modal so the
     "New request" sidebar entry works from any page. */
  if (!document.querySelector('script[data-lazy-feedback]') && !window.LazyFeedback) {
    const fbScript = document.createElement('script');
    fbScript.src = 'feedback_modal.js';
    fbScript.dataset.lazyFeedback = '1';
    fbScript.async = false;
    document.head.appendChild(fbScript);
  }

  /* ═══════════════════════════════════════════════════
     MOBILE LOGIC
  ═══════════════════════════════════════════════════ */
  const sidebar  = document.getElementById('sb-sidebar');
  const burger   = document.getElementById('sb-burger');
  const overlay  = document.getElementById('sb-overlay');
  const closeBtn = document.getElementById('sb-close');

  function openSidebar()  { sidebar.classList.add('open'); overlay.classList.add('open'); burger.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); burger.classList.remove('open'); }

  burger.addEventListener('click',  () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
  overlay.addEventListener('click', closeSidebar);
  closeBtn.addEventListener('click', closeSidebar);

  /* ═══════════════════════════════════════════════════
     SPA NAVIGATION — keeps Spotify playing across pages
  ═══════════════════════════════════════════════════ */

  // Scripts that must NOT be re-executed on navigation (already live in memory)
  const SPA_SKIP = [
    'sidebar.js','auth.js','focusfm.js','session.js',
    'countdown.js','popup.js','demo.js','apis.js','feedback_modal.js',
    'supabase-js','three.r134','vanta.net',
  ];

  // IDs of elements that must survive body replacement
  const SPA_PERSIST = [
    'sb-burger','sb-overlay','sb-sidebar',
    '_fm_mini','_fm_panel','_fm_track_toast','_fm_toast','_sess_warn',
    '_fm_css','sb-styles',
  ];

  function _updateActiveItem(url) {
    const curr = url.split('/').pop() || 'index.html';
    document.querySelectorAll('[data-sb-id]').forEach(item => {
      const a = item.querySelector('a[href]');
      item.classList.toggle('active', !!a && a.getAttribute('href') === curr);
    });
  }

  /**
   * Wraps an inline script's body in an IIFE so its top-level `let` /
   * `const` / `class` declarations stay local. This prevents
   * "Can't create duplicate variable" SyntaxError when SPA-navigating
   * back to a page (or to a page that shares variable names with the
   * one we came from). Top-level `function` and `var` declarations are
   * re-exposed on `window` afterwards so existing inline `onclick=`
   * handlers keep working.
   *
   * The wrapper also monkey-patches `document.addEventListener` for the
   * duration of the script so that any `DOMContentLoaded` (or `load`)
   * listener registered by the page fires *immediately* — the real
   * event has already been dispatched once at the original page load
   * and won't fire again on SPA navigation, which would leave page-
   * level state (e.g. `currentSession`) un-initialised.
   */
  function _wrapInlineForSpa(code) {
    if (!code || !code.trim()) return code;
    const fnMatches  = [...code.matchAll(/^[ \t]*(?:async[ \t]+)?function[ \t]+(\w+)/gm)];
    const varMatches = [...code.matchAll(/^[ \t]*var[ \t]+(\w+)/gm)];
    const names = [...new Set([...fnMatches, ...varMatches].map(m => m[1]))];
    const exposeCode = names.length
      ? '\n' + names.map(n => `try{window.${n}=${n};}catch(_){}`).join('\n')
      : '';
    return `(function(){
  var _origAddDoc = document.addEventListener;
  var _origAddWin = window.addEventListener;
  function _patchedAdd(target, orig) {
    return function(ev, cb, opts) {
      if ((ev === 'DOMContentLoaded' || ev === 'load') && typeof cb === 'function') {
        try { Promise.resolve().then(function(){ cb(new Event(ev)); }); }
        catch(e) { console.error('[spa-init]', e); }
        return;
      }
      return orig.call(target, ev, cb, opts);
    };
  }
  document.addEventListener = _patchedAdd(document, _origAddDoc);
  window.addEventListener   = _patchedAdd(window, _origAddWin);
  try {
${code}
${exposeCode}
  } finally {
    document.addEventListener = _origAddDoc;
    window.addEventListener   = _origAddWin;
  }
}).call(window);`;
  }

  async function _spaNavigate(url) {
    // Detach persisted elements before wiping body
    const saved = SPA_PERSIST
      .map(id => document.getElementById(id))
      .filter(Boolean)
      .map(el => { el.remove(); return el; });

    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('fetch ' + r.status);
      const html = await r.text();
      const doc  = new DOMParser().parseFromString(html, 'text/html');

      // Update title
      document.title = doc.title;

      // Swap page-scoped <style> blocks in <head>
      document.querySelectorAll('head style[data-spapage]').forEach(s => s.remove());
      doc.querySelectorAll('head style').forEach(st => {
        const cl = st.cloneNode(true);
        cl.setAttribute('data-spapage', '1');
        document.head.appendChild(cl);
      });

      // Replace body content
      document.body.innerHTML = doc.body.innerHTML;

      // Restore persisted elements
      saved.forEach(el => document.body.appendChild(el));

      // Re-run page scripts in order (skip shared ones)
      const tasks = [];
      doc.body.querySelectorAll('script').forEach(s => {
        if (s.src) {
          if (SPA_SKIP.some(m => s.src.includes(m))) return;
          if (document.querySelector(`script[src="${s.src}"]`)) return;
          tasks.push({ type: 'ext', src: s.src });
        } else if (s.textContent.trim()) {
          tasks.push({ type: 'inline', code: s.textContent });
        }
      });

      for (const t of tasks) {
        await new Promise(res => {
          const el = document.createElement('script');
          if (t.type === 'ext') {
            el.src = t.src; el.onload = res; el.onerror = res;
          } else {
            el.textContent = _wrapInlineForSpa(t.code);
          }
          document.body.appendChild(el);
          if (t.type === 'inline') res();
        });
      }

      history.pushState({ spa: url }, document.title, url);
      window.scrollTo(0, 0);
      _updateActiveItem(url);
      closeSidebar();

      // Re-broadcast cached auth events so page-level listeners (e.g.
      // countdown.js, sidebar lock state, etc.) re-trigger their data
      // loads. These events normally fire only once at initial page
      // load and would otherwise be missed entirely on SPA navigation.
      try {
        if (window.LazyAuth?.__profile) {
          document.dispatchEvent(new CustomEvent('lazypo:profile', {
            detail: window.LazyAuth.__profile
          }));
        }
        if (window.LazyAuth?.__adminUnread != null) {
          document.dispatchEvent(new CustomEvent('lazypo:admin-notifs', {
            detail: { unread: window.LazyAuth.__adminUnread }
          }));
        }
      } catch (e) { console.error('[spa-rebroadcast]', e); }

    } catch (_) {
      // Fallback: restore elements + hard navigate
      saved.forEach(el => document.body.appendChild(el));
      location.href = url;
    }
  }

  // Intercept sidebar link clicks
  document.addEventListener('click', e => {
    const link = e.target.closest('.sb-item-link[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || /^https?:\/\//.test(href) || href.startsWith('#')) return;
    if (link.target === '_blank') return; // let browser handle new-tab links
    e.preventDefault();
    _spaNavigate(href);
  }, true);

  // Handle browser back/forward
  window.addEventListener('popstate', e => {
    _spaNavigate(e.state?.spa || location.href);
  });

  // Register current page so popstate works on first back
  history.replaceState({ spa: location.href }, document.title, location.href);

})();
