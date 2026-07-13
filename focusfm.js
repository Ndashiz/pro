/* ═══════════════════════════════════════════════════════════════════
   LazyPO — Focus FM v2  |  Spotify Integration
   ───────────────────────────────────────────────────────────────────
   SETUP (one-time, ~3 min)
   1. developer.spotify.com → Create app
      Redirect URI: https://ndashiz.be/lazypo/spotify-callback.html
   2. Paste your Client ID below (and in spotify-callback.html)
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────────── */
  const CLIENT_ID    = '0dfc3d28793c44a1a33146961974c867';
  const REDIRECT_URI = 'https://ndashiz.be/pro/spotify-callback.html';
  const SCOPES = [
    'streaming','user-read-email','user-read-private',
    'user-read-playback-state','user-modify-playback-state',
    'user-read-currently-playing','playlist-read-private',
    'playlist-read-collaborative','user-library-read',
  ].join(' ');

  /* ── Curated smart playlists by mood ───────────────────────────── */
  const SMART_PLAYLISTS = [
    { id: '37i9dQZF1DWZeKCadgRdKQ', label: 'Deep Focus',   emoji: '🧠', mood: 'focus'  },
    { id: '37i9dQZF1DX9sIqqvKsjEf', label: 'Peaceful Piano',emoji: '🎹', mood: 'focus'  },
    { id: '37i9dQZF1DWWQRwui0ExPn', label: 'Lofi Beats',   emoji: '☕', mood: 'chill'  },
    { id: '37i9dQZF1DX4WYpdgoIcn6', label: 'Chill Hits',   emoji: '🌊', mood: 'chill'  },
    { id: '37i9dQZF1DX76Wlfdnj7AP', label: 'Beast Mode',   emoji: '⚡', mood: 'energy' },
    { id: '37i9dQZF1DXdxcBWuJkbcy', label: 'Power Hour',   emoji: '🔥', mood: 'energy' },
    { id: '37i9dQZF1DX8NTLI2TtZa6', label: 'Night Owl',    emoji: '🦉', mood: 'chill'  },
    { id: '37i9dQZF1DWXRqgorJj26U', label: 'Rock Classics', emoji: '🎸', mood: 'energy' },
  ];

  /* ── Storage keys ───────────────────────────────────────────────── */
  const K = {
    access:       'fm_access_token',
    refresh:      'fm_refresh_token',
    expiry:       'fm_token_expiry',
    vol:          'fm_volume',
    expanded:     'fm_expanded',
    lastPlaylist: 'fm_last_playlist',
    focusMode:    'fm_focus_mode',
    plTab:        'fm_playlist_tab',
    wasPlaying:   'fm_was_playing',
    shown:        'fm_shown',   // '1' = bar visible, '0' / absent = hidden
  };

  /* ── State ──────────────────────────────────────────────────────── */
  let player       = null;
  let deviceId     = null;
  let isPaused     = true;
  let track        = null;   // current Spotify track object
  let progressMs   = 0;
  let durationMs   = 1;
  let progTimer    = null;
  let isExpanded   = false;
  let userPlaylists = [];
  let playlistsLoaded = false;

  /* ══════════════════════════════════════════════════════════════════
     TOKEN MANAGEMENT
  ══════════════════════════════════════════════════════════════════ */
  const saveTokens = ({ access_token, refresh_token, expires_in }) => {
    localStorage.setItem(K.access,  access_token);
    if (refresh_token) localStorage.setItem(K.refresh, refresh_token);
    localStorage.setItem(K.expiry, Date.now() + expires_in * 1000);
  };
  const getAccess  = () => localStorage.getItem(K.access);
  const getRefresh = () => localStorage.getItem(K.refresh);
  const isExpired  = () => {
    const exp = parseInt(localStorage.getItem(K.expiry) || '0');
    return exp > 0 && Date.now() > exp - 60000; // if no expiry stored, assume still valid
  };

  async function refreshToken() {
    const rt = getRefresh(); if (!rt) return false;
    try {
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type:'refresh_token', refresh_token:rt, client_id:CLIENT_ID }),
      });
      // Only clear tokens if Spotify explicitly rejects the refresh token (invalid/revoked).
      // On network errors or server errors, keep existing tokens and try with what we have.
      if (r.status === 400 || r.status === 401) { clearTokens(); return false; }
      if (!r.ok) return false; // server/network error — keep tokens, try anyway
      saveTokens(await r.json()); return true;
    } catch { return false; } // network offline — keep tokens
  }

  function clearTokens() {
    [K.access, K.refresh, K.expiry].forEach(k => localStorage.removeItem(k));
  }

  async function ensureToken() {
    if (!getAccess()) return false;
    if (isExpired()) return refreshToken();
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════
     SPOTIFY API
  ══════════════════════════════════════════════════════════════════ */
  async function api(path, opts = {}) {
    if (!await ensureToken()) return null;
    const r = await fetch(`https://api.spotify.com/v1${path}`, {
      ...opts,
      headers: { Authorization:`Bearer ${getAccess()}`, 'Content-Type':'application/json', ...(opts.headers||{}) },
    });
    if (r.status === 204) return {};
    if (!r.ok) return null;
    return r.json().catch(() => ({}));
  }

  async function loadUserPlaylists() {
    if (playlistsLoaded) return;
    const data = await api('/me/playlists?limit=20');
    if (data?.items) {
      userPlaylists = data.items.filter(p => p && p.name);
      playlistsLoaded = true;
    }
  }

  async function playPlaylist(id) {
    if (!deviceId) return;
    localStorage.setItem(K.lastPlaylist, id);
    await api('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ context_uri: `spotify:playlist:${id}`, device_ids: [deviceId] }),
    });
  }

  async function quickPlay() {
    const last = localStorage.getItem(K.lastPlaylist);
    if (last) { playPlaylist(last); return; }
    playPlaylist(SMART_PLAYLISTS[0].id); // default: Deep Focus
  }

  /* ══════════════════════════════════════════════════════════════════
     PKCE OAUTH
  ══════════════════════════════════════════════════════════════════ */
  function randB64url(n = 32) {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }
  async function sha256url(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  async function startOAuth() {
    if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID') {
      alert('⚠️ Paste your Spotify Client ID in focusfm.js first.\ndeveloper.spotify.com → create app → copy Client ID');
      return;
    }
    // Mark bar as shown so it reappears after OAuth redirect
    localStorage.setItem(K.shown, '1');
    const v = randB64url(64), ch = await sha256url(v), st = randB64url(16);
    localStorage.setItem('fm_pkce_verifier', v);
    localStorage.setItem('fm_pkce_state', st);
    localStorage.setItem('fm_return_url', location.href);
    location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: CLIENT_ID, response_type:'code', redirect_uri: REDIRECT_URI,
      code_challenge_method:'S256', code_challenge: ch, scope: SCOPES, state: st,
    });
  }

  function disconnect() {
    try { player?.disconnect(); } catch(_) {}
    player = null; deviceId = null; isPaused = true; track = null;
    clearInterval(progTimer); clearTokens();
    userPlaylists = []; playlistsLoaded = false;
    isExpanded = false;
    setFocusMode(false);
    render();
  }

  /* ══════════════════════════════════════════════════════════════════
     WEB PLAYBACK SDK
  ══════════════════════════════════════════════════════════════════ */
  function initSDK() {
    const go = () => {
      player = new Spotify.Player({
        name: 'LazyPO Focus FM',
        getOAuthToken: async cb => {
          const ok = await ensureToken();
          const token = getAccess();
          if (ok && token) { cb(token); } // only give SDK a valid token
          // if no valid token, don't call cb — SDK will retry via authentication_error
        },
        volume: parseFloat(localStorage.getItem(K.vol) || '0.7'),
      });
      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        // Resume playback seamlessly if music was playing before navigation
        const wasPlaying = localStorage.getItem(K.wasPlaying) === '1';
        localStorage.removeItem(K.wasPlaying);
        api('/me/player', { method:'PUT', body: JSON.stringify({ device_ids:[device_id], play: wasPlaying }) });
        loadUserPlaylists();
      });
      player.addListener('player_state_changed', state => {
        if (!state) return;
        const prev = track?.id;
        isPaused    = state.paused;
        track       = state.track_window?.current_track || null;
        progressMs  = state.position;
        durationMs  = state.duration || 1;
        if (track?.id !== prev && track) showTrackToast(track);
        updateLive(); startTick();
      });
      player.addListener('authentication_error', async () => {
        // Try to refresh before giving up — authentication_error can fire on transient issues
        const refreshed = await refreshToken();
        if (refreshed) {
          // Got a fresh token — reconnect the SDK player
          player?.connect();
        } else {
          // Refresh truly failed (401/400) — tokens already cleared by refreshToken()
          render();
        }
      });
      player.addListener('account_error', () => toast('Spotify Premium required for in-browser playback'));
      player.connect();
    };

    if (window.Spotify?.Player) { go(); return; }
    const prev = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => { if(prev) prev(); go(); };
    if (!document.querySelector('script[src*="spotify-player"]')) {
      const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(s);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     CONTROLS
  ══════════════════════════════════════════════════════════════════ */
  const togglePlay = () => player?.togglePlay();
  const nextTrack  = () => player?.nextTrack();
  const prevTrack  = () => player?.previousTrack();
  const seek       = r  => player?.seek(Math.floor(r * durationMs));
  async function setVol(v) {
    await player?.setVolume(v); localStorage.setItem(K.vol, v);
    const ico = document.getElementById('_fm_vol_ico');
    if (ico) ico.textContent = v < 0.05 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
  }

  /* ══════════════════════════════════════════════════════════════════
     FOCUS MODE
  ══════════════════════════════════════════════════════════════════ */
  function setFocusMode(on) {
    localStorage.setItem(K.focusMode, on ? '1' : '0');
    document.documentElement.classList.toggle('fm-focus-mode', on);
    const btn = document.getElementById('_fm_focus_btn');
    if (btn) {
      btn.textContent = on ? '⚡ Focus ON' : '⚡ Focus Mode';
      btn.classList.toggle('fm-focus-on', on);
    }
  }
  function toggleFocusMode() {
    setFocusMode(localStorage.getItem(K.focusMode) !== '1');
  }
  const isFocusMode = () => localStorage.getItem(K.focusMode) === '1';

  /* ══════════════════════════════════════════════════════════════════
     PROGRESS
  ══════════════════════════════════════════════════════════════════ */
  function startTick() {
    clearInterval(progTimer);
    if (isPaused) return;
    progTimer = setInterval(() => {
      progressMs = Math.min(progressMs + 500, durationMs);
      updateProgress();
    }, 500);
  }
  const fmt = ms => { const s = Math.floor((ms||0)/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };

  /* ══════════════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS
  ══════════════════════════════════════════════════════════════════ */
  function initKeys() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const isInput = ['INPUT','TEXTAREA','SELECT'].includes(tag) ||
                      document.activeElement?.isContentEditable;
      if (isInput) return;
      if (!getAccess()) return;

      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') { e.preventDefault(); nextTrack(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft')  { e.preventDefault(); prevTrack(); }
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     TRACK CHANGE TOAST
  ══════════════════════════════════════════════════════════════════ */
  function showTrackToast(t) {
    let el = document.getElementById('_fm_track_toast');
    if (!el) {
      el = document.createElement('div');
      el.id = '_fm_track_toast';
      document.body.appendChild(el);
    }
    const art = t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
    el.innerHTML = `
      ${art ? `<img src="${esc(art)}" class="ftt-art" alt="">` : '<div class="ftt-art ftt-art-ph">🎵</div>'}
      <div class="ftt-info">
        <div class="ftt-label">Now playing</div>
        <div class="ftt-track">${esc(t.name)}</div>
        <div class="ftt-artist">${esc(t.artists?.map(a=>a.name).join(', ') || '')}</div>
      </div>`;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function toast(msg) {
    let el = document.getElementById('_fm_toast');
    if (!el) { el = document.createElement('div'); el.id = '_fm_toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  /* ══════════════════════════════════════════════════════════════════
     CSS
  ══════════════════════════════════════════════════════════════════ */
  function injectCSS() {
    if (document.getElementById('_fm_css')) return;
    const s = document.createElement('style'); s.id = '_fm_css';
    s.textContent = `
/* ─── Focus FM ─────────────────────────────────────── */

/* Mini player — floating, bottom-right (above demo FAB) */
#_fm_mini {
  position: fixed; bottom: 84px; right: 16px; z-index: 300;
  display: flex; align-items: center; gap: 8px;
  background: #161616; border: 1px solid #282828;
  border-radius: 14px; padding: 8px 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
  font-family: 'DM Sans', sans-serif;
  min-width: 240px; max-width: 380px;
  cursor: default;
  transition: box-shadow 0.2s, border-color 0.2s;
  animation: fm-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
}
#_fm_mini:hover { border-color: #333; box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06); }
@keyframes fm-pop { from { opacity:0; transform:scale(0.85) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }

/* Art */
.fm-mini-art { width:40px; height:40px; border-radius:8px; object-fit:cover; flex-shrink:0; }
.fm-mini-art-ph { width:40px; height:40px; border-radius:8px; background:linear-gradient(135deg,#1db954,#0a3d1f); display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }

/* Track info */
.fm-mini-info { flex:1; min-width:0; }
.fm-mini-track { font-size:12px; font-weight:600; color:#f0f0f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fm-mini-artist { font-size:11px; color:#6b6b6b; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fm-mini-idle-label { font-size:13px; font-weight:600; color:#f0f0f0; }
.fm-mini-idle-sub { font-size:11px; color:#555; margin-top:1px; }

/* Mini buttons */
.fm-mini-btn {
  background:none; border:none; color:#808080; cursor:pointer;
  width:28px; height:28px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  flex-shrink:0; transition:color 0.15s, background 0.15s;
}
.fm-mini-btn:hover { color:#fff; background:rgba(255,255,255,0.08); }
.fm-mini-play { background:rgba(255,255,255,0.1); color:#fff; }
.fm-mini-play:hover { background:rgba(255,255,255,0.18); }
.fm-mini-expand { color:#555; }
.fm-mini-expand:hover { color:#fff; }

/* Connect btn (idle state) */
.fm-connect-chip {
  display:flex; align-items:center; gap:7px;
  background:#1db954; color:#000; border:none;
  border-radius:20px; padding:6px 14px;
  font-family:'DM Sans',sans-serif; font-size:12px; font-weight:700;
  cursor:pointer; flex-shrink:0;
  transition:background 0.15s, transform 0.15s;
}
.fm-connect-chip:hover { background:#1ed760; transform:scale(1.04); }

/* ─── Expanded panel ─────────────────────────────── */
#_fm_panel {
  position: fixed; bottom: 148px; right: 16px; z-index: 299;
  width: 320px;
  background: #141414; border: 1px solid #282828;
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05);
  font-family: 'DM Sans', sans-serif;
  color: #f0f0f0; overflow: hidden;
  transform-origin: bottom right;
  animation: fm-expand 0.28s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes fm-expand { from { opacity:0; transform:scale(0.85) translateY(16px); } to { opacity:1; transform:scale(1) translateY(0); } }

/* Panel header */
.fm-ph { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 0; }
.fm-ph-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#555; }
.fm-ph-close { background:none; border:none; color:#555; cursor:pointer; font-size:16px; line-height:1; padding:2px; border-radius:5px; transition:color 0.15s; }
.fm-ph-close:hover { color:#f0f0f0; }

/* Art + info */
.fm-art-wrap { padding:16px 16px 12px; display:flex; align-items:center; gap:14px; }
.fm-panel-art { width:64px; height:64px; border-radius:10px; object-fit:cover; box-shadow:0 4px 16px rgba(0,0,0,0.5); flex-shrink:0; }
.fm-panel-art-ph { width:64px; height:64px; border-radius:10px; background:linear-gradient(135deg,#1db954,#0a3d1f); display:flex; align-items:center; justify-content:center; font-size:28px; flex-shrink:0; }
.fm-track-name { font-size:14px; font-weight:700; color:#f0f0f0; line-height:1.3; }
.fm-track-artist { font-size:12px; color:#6b6b6b; margin-top:3px; }
.fm-quick-play { margin-top:8px; display:flex; align-items:center; gap:5px; background:rgba(29,185,84,0.12); border:1px solid rgba(29,185,84,0.25); color:#1db954; border-radius:7px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer; transition:background 0.15s; white-space:nowrap; }
.fm-quick-play:hover { background:rgba(29,185,84,0.22); }

/* Seek */
.fm-seek { padding:0 16px 10px; }
.fm-seek-bar { height:4px; background:#2a2a2a; border-radius:2px; cursor:pointer; position:relative; margin-bottom:5px; }
.fm-seek-fill { height:100%; background:#fff; border-radius:2px; pointer-events:none; transition:width 0.35s linear; }
.fm-seek-bar:hover .fm-seek-fill { background:#1db954; }
.fm-seek-bar::before { content:''; position:absolute; top:-8px; bottom:-8px; left:0; right:0; }
.fm-seek-times { display:flex; justify-content:space-between; font-size:10px; color:#555; font-family:'DM Mono',monospace; }

/* Controls */
.fm-ctrl { display:flex; align-items:center; justify-content:center; gap:6px; padding:0 16px 12px; }
.fm-btn { background:none; border:none; color:#808080; cursor:pointer; border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; transition:color 0.15s, background 0.15s; }
.fm-btn:hover { color:#fff; background:rgba(255,255,255,0.07); }
.fm-btn-play { width:44px; height:44px; background:#fff; color:#000; transition:transform 0.15s, background 0.15s; }
.fm-btn-play:hover { background:#e0e0e0; transform:scale(1.07); }

/* Volume */
.fm-vol-row { display:flex; align-items:center; gap:8px; padding:0 16px 14px; }
.fm-vol-ico { font-size:13px; color:#555; cursor:default; user-select:none; }
input.fm-vol-slider { -webkit-appearance:none; flex:1; height:4px; border-radius:2px; background:#2a2a2a; outline:none; cursor:pointer; }
input.fm-vol-slider::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:#fff; cursor:pointer; }
input.fm-vol-slider:hover { background:#3a3a3a; }

/* Divider */
.fm-sep { height:1px; background:#1e1e1e; margin:0 16px; }

/* Playlist tabs */
.fm-pl { padding:12px 16px 0; }
.fm-pl-tabs { display:flex; gap:4px; margin-bottom:10px; background:#0f0f0f; border-radius:8px; padding:3px; }
.fm-pl-tab { flex:1; background:none; border:none; color:#555; font-family:'DM Sans',sans-serif; font-size:11.5px; font-weight:600; cursor:pointer; border-radius:6px; padding:5px 8px; transition:background 0.15s, color 0.15s; }
.fm-pl-tab.active { background:#222; color:#f0f0f0; }
.fm-pl-list { max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; margin-bottom:12px; }
.fm-pl-list::-webkit-scrollbar { width:3px; }
.fm-pl-list::-webkit-scrollbar-thumb { background:#2a2a2a; border-radius:2px; }
.fm-pl-item { display:flex; align-items:center; gap:10px; padding:7px 8px; border-radius:8px; cursor:pointer; transition:background 0.15s; border:none; background:none; width:100%; text-align:left; color:#f0f0f0; }
.fm-pl-item:hover { background:#1e1e1e; }
.fm-pl-item.playing { background:rgba(29,185,84,0.1); }
.fm-pl-emoji { font-size:15px; flex-shrink:0; width:20px; text-align:center; }
.fm-pl-img { width:28px; height:28px; border-radius:5px; object-fit:cover; flex-shrink:0; }
.fm-pl-name { font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
.fm-pl-play { font-size:10px; color:#1db954; flex-shrink:0; opacity:0; transition:opacity 0.15s; }
.fm-pl-item:hover .fm-pl-play { opacity:1; }

/* Footer */
.fm-panel-foot { display:flex; align-items:center; gap:8px; padding:10px 16px 14px; border-top:1px solid #1e1e1e; }
.fm-device { font-size:11px; color:#444; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fm-focus-btn { background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.2); color:#fbbf24; border-radius:7px; padding:5px 10px; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; transition:background 0.15s; }
.fm-focus-btn:hover, .fm-focus-btn.fm-focus-on { background:rgba(251,191,36,0.2); }
.fm-disc-btn { background:none; border:1px solid #2a2a2a; color:#444; border-radius:7px; padding:5px 9px; font-size:11px; cursor:pointer; white-space:nowrap; transition:border-color 0.15s, color 0.15s; }
.fm-disc-btn:hover { border-color:#f87171; color:#f87171; }

/* ─── Track change toast ─────────────────────────── */
#_fm_track_toast {
  position:fixed; bottom:160px; right:16px; z-index:400;
  display:flex; align-items:center; gap:10px;
  background:#1c1c1c; border:1px solid #2a2a2a;
  border-radius:12px; padding:10px 14px;
  box-shadow:0 8px 24px rgba(0,0,0,0.6);
  font-family:'DM Sans',sans-serif;
  opacity:0; transform:translateX(20px); pointer-events:none;
  transition:opacity 0.25s, transform 0.25s;
  max-width:280px;
}
#_fm_track_toast.show { opacity:1; transform:translateX(0); }
.ftt-art { width:36px; height:36px; border-radius:6px; object-fit:cover; flex-shrink:0; }
.ftt-art-ph { width:36px; height:36px; border-radius:6px; background:linear-gradient(135deg,#1db954,#0a3d1f); display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
.ftt-label { font-size:10px; color:#1db954; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; }
.ftt-track { font-size:12px; font-weight:600; color:#f0f0f0; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
.ftt-artist { font-size:11px; color:#6b6b6b; }

/* ─── General toast ──────────────────────────────── */
#_fm_toast {
  position:fixed; bottom:100px; left:50%; transform:translateX(-50%) translateY(8px);
  background:#1c1c1c; border:1px solid #2a2a2a; color:#f0f0f0;
  padding:8px 16px; border-radius:8px; font-size:13px;
  opacity:0; pointer-events:none; z-index:500;
  font-family:'DM Sans',sans-serif; white-space:nowrap;
  transition:opacity 0.2s, transform 0.2s;
}
#_fm_toast.show { opacity:1; transform:translateX(-50%) translateY(0); }

/* ─── Focus Mode ─────────────────────────────────── */
html.fm-focus-mode .sb-nav .sb-item:not(.active) { opacity:0.35; }
html.fm-focus-mode #_fm_mini { border-color:#fbbf24; box-shadow:0 0 20px rgba(251,191,36,0.15); }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════ */
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function getMiniEl() { let e = document.getElementById('_fm_mini'); if (!e){e=document.createElement('div');e.id='_fm_mini';document.body.appendChild(e);} return e; }
  function getPanelEl() { let e = document.getElementById('_fm_panel'); if (!e){e=document.createElement('div');e.id='_fm_panel';document.body.appendChild(e);} return e; }

  function render() {
    renderMini();
    if (isExpanded) renderPanel(); else closePanelEl();
  }

  function renderMini() {
    const el = getMiniEl();
    const connected = !!getAccess();

    if (!connected) {
      el.innerHTML = `
        <div class="fm-mini-art-ph">🎵</div>
        <div class="fm-mini-info">
          <div class="fm-mini-idle-label">Focus FM</div>
          <div class="fm-mini-idle-sub">Your Spotify, always on</div>
        </div>
        <button class="fm-connect-chip" id="_fm_connect_btn">
          <svg width="12" height="12" viewBox="0 0 168 168" fill="currentColor"><path d="M84 0C37.6 0 0 37.6 0 84s37.6 84 84 84 84-37.6 84-84S130.4 0 84 0zm38.5 121.2c-1.6 2.6-5 3.4-7.6 1.8C94.1 110.3 67.9 107.4 37.1 114.5c-3 .7-5.9-1.1-6.6-4.1-.7-3 1.1-5.9 4.1-6.6 33.7-7.7 62.7-4.4 86.1 9.8 2.6 1.6 3.4 5 1.8 7.6zm10.3-22.8c-2 3.2-6.2 4.2-9.4 2.2C99.6 85.9 63.4 81.6 35.3 90.2c-3.5 1-7.1-1-8.1-4.4-1-3.5 1-7.1 4.4-8.1 32.1-9.8 72-5 99.1 11.7 3.2 2 4.2 6.2 2.1 9zm.9-23.7C108.9 57.8 62 56.3 34.2 64.3c-4.1 1.2-8.5-1.1-9.8-5.3-1.2-4.1 1.1-8.5 5.3-9.8C60 40.4 111 42.1 138.6 58c3.8 2.2 5.1 7 2.9 10.7-.2.3-.5.6-.8 1z"/></svg>
          Connect
        </button>
        <button class="fm-mini-btn fm-mini-dismiss" id="_fm_mini_dismiss" title="Masquer" style="margin-left:2px;opacity:.45;font-size:13px;">✕</button>`;
      el.querySelector('#_fm_connect_btn')?.addEventListener('click', startOAuth);
      el.querySelector('#_fm_mini_dismiss')?.addEventListener('click', e => { e.stopPropagation(); hideMini(); });
      return;
    }

    const art  = track?.album?.images?.[0]?.url;
    const name = track?.name || '—';
    const by   = track?.artists?.map(a=>a.name).join(', ') || '—';

    el.innerHTML = `
      ${art ? `<img class="fm-mini-art" src="${esc(art)}" alt="">` : '<div class="fm-mini-art-ph">🎵</div>'}
      <div class="fm-mini-info">
        <div class="fm-mini-track" title="${esc(name)}">${esc(name)}</div>
        <div class="fm-mini-artist">${esc(by)}</div>
      </div>
      <button class="fm-mini-btn" id="_fm_mini_prev" title="Previous (⌘←)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
      </button>
      <button class="fm-mini-btn fm-mini-play" id="_fm_mini_play" title="${isPaused?'Play':'Pause'}">
        ${isPaused
          ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
          : '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}
      </button>
      <button class="fm-mini-btn" id="_fm_mini_next" title="Next (⌘→)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="m6 18 8.5-6L6 6v12zm2-6zm8.5-6H18v12h-1.5z"/></svg>
      </button>
      <button class="fm-mini-btn fm-mini-expand" id="_fm_mini_expand" title="${isExpanded?'Collapse':'Expand'}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="${isExpanded?'18 15 12 9 6 15':'6 9 12 15 18 9'}"/>
        </svg>
      </button>
      <button class="fm-mini-btn fm-mini-dismiss" id="_fm_mini_dismiss" title="Masquer" style="opacity:.35;font-size:13px;">✕</button>`;

    el.querySelector('#_fm_mini_prev')?.addEventListener('click', e => { e.stopPropagation(); prevTrack(); });
    el.querySelector('#_fm_mini_play')?.addEventListener('click', e => { e.stopPropagation(); togglePlay(); });
    el.querySelector('#_fm_mini_next')?.addEventListener('click', e => { e.stopPropagation(); nextTrack(); });
    el.querySelector('#_fm_mini_expand')?.addEventListener('click', e => { e.stopPropagation(); toggleExpand(); });
    el.querySelector('#_fm_mini_dismiss')?.addEventListener('click', e => { e.stopPropagation(); hideMini(); });
  }

  function hideMini() {
    localStorage.setItem(K.shown, '0');
    const el = document.getElementById('_fm_mini');
    if (el) el.style.display = 'none';
    closePanelEl();
  }

  function showMini() {
    localStorage.setItem(K.shown, '1');
    const el = getMiniEl();
    el.style.display = '';
    render();
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
    localStorage.setItem(K.expanded, isExpanded ? '1' : '0');
    render();
    if (isExpanded) { loadUserPlaylists().then(() => renderPlaylistTab()); }
  }

  function closePanelEl() {
    const el = document.getElementById('_fm_panel');
    if (el) el.remove();
  }

  function renderPanel() {
    const el = getPanelEl();
    const art  = track?.album?.images?.[0]?.url;
    const name = track?.name || '—';
    const by   = track?.artists?.map(a=>a.name).join(', ') || '—';
    const pct  = durationMs > 0 ? (progressMs/durationMs*100).toFixed(2) : 0;
    const vol  = parseFloat(localStorage.getItem(K.vol)||'0.7');
    const lastPl = localStorage.getItem(K.lastPlaylist);

    el.innerHTML = `
      <div class="fm-ph">
        <div class="fm-ph-title">🎵 Focus FM</div>
        <button class="fm-ph-close" id="_fp_close">✕</button>
      </div>
      <div class="fm-art-wrap">
        ${art?`<img class="fm-panel-art" src="${esc(art)}" alt="">`:'<div class="fm-panel-art-ph">🎵</div>'}
        <div style="min-width:0;flex:1">
          <div class="fm-track-name" title="${esc(name)}">${esc(name)}</div>
          <div class="fm-track-artist">${esc(by)}</div>
          <button class="fm-quick-play" id="_fp_qplay">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            Quick Play
          </button>
        </div>
      </div>
      <div class="fm-seek">
        <div class="fm-seek-bar" id="_fp_seek">
          <div class="fm-seek-fill" id="_fp_fill" style="width:${pct}%"></div>
        </div>
        <div class="fm-seek-times">
          <span id="_fp_pos">${fmt(progressMs)}</span>
          <span>${fmt(durationMs)}</span>
        </div>
      </div>
      <div class="fm-ctrl">
        <button class="fm-btn" id="_fp_prev" title="Previous (⌘←)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button class="fm-btn fm-btn-play" id="_fp_play" title="Play / Pause (Space)">
          ${isPaused
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}
        </button>
        <button class="fm-btn" id="_fp_next" title="Next (⌘→)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m6 18 8.5-6L6 6v12zm2-6zm8.5-6H18v12h-1.5z"/></svg>
        </button>
      </div>
      <div class="fm-vol-row">
        <span class="fm-vol-ico" id="_fm_vol_ico">${vol<0.05?'🔇':vol<0.5?'🔉':'🔊'}</span>
        <input type="range" class="fm-vol-slider" id="_fp_vol" min="0" max="1" step="0.02" value="${vol}">
      </div>
      <div class="fm-sep"></div>
      <div class="fm-pl">
        <div class="fm-pl-tabs">
          <button class="fm-pl-tab${(localStorage.getItem(K.plTab)||'suggested')==='mine'?' active':''}" data-tab="mine">My Playlists</button>
          <button class="fm-pl-tab${(localStorage.getItem(K.plTab)||'suggested')!=='mine'?' active':''}" data-tab="suggested">✨ Suggested</button>
        </div>
        <div class="fm-pl-list" id="_fp_pl_list">
          <div style="text-align:center;color:#444;font-size:12px;padding:16px">Loading…</div>
        </div>
      </div>
      <div class="fm-panel-foot">
        <div class="fm-device">📱 ${deviceId ? 'LazyPO Focus FM' : 'No device'}</div>
        <button class="fm-focus-btn${isFocusMode()?' fm-focus-on':''}" id="_fm_focus_btn">${isFocusMode()?'⚡ Focus ON':'⚡ Focus Mode'}</button>
        <button class="fm-disc-btn" id="_fp_disc">Disconnect</button>
      </div>`;

    // Wire
    el.querySelector('#_fp_close')?.addEventListener('click', toggleExpand);
    el.querySelector('#_fp_prev')?.addEventListener('click', prevTrack);
    el.querySelector('#_fp_play')?.addEventListener('click', togglePlay);
    el.querySelector('#_fp_next')?.addEventListener('click', nextTrack);
    el.querySelector('#_fp_disc')?.addEventListener('click', () => { if(confirm('Disconnect Spotify?')) disconnect(); });
    el.querySelector('#_fm_focus_btn')?.addEventListener('click', toggleFocusMode);
    el.querySelector('#_fp_qplay')?.addEventListener('click', quickPlay);

    el.querySelector('#_fp_seek')?.addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect();
      seek((e.clientX - r.left) / r.width);
    });
    el.querySelector('#_fp_vol')?.addEventListener('input', e => setVol(parseFloat(e.target.value)));

    el.querySelectorAll('.fm-pl-tab').forEach(btn => btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      localStorage.setItem(K.plTab, tab);
      el.querySelectorAll('.fm-pl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
      renderPlaylistTab();
    }));

    renderPlaylistTab();
  }

  function renderPlaylistTab() {
    const list = document.getElementById('_fp_pl_list');
    if (!list) return;
    const tab = localStorage.getItem(K.plTab) || 'suggested';
    const lastPl = localStorage.getItem(K.lastPlaylist);

    if (tab === 'mine') {
      if (!playlistsLoaded || userPlaylists.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#444;font-size:12px;padding:16px">No playlists found</div>';
        return;
      }
      list.innerHTML = userPlaylists.map(p => {
        const img = p.images?.[0]?.url ? `<img class="fm-pl-img" src="${esc(p.images[0].url)}" alt="">` : '<div class="fm-pl-emoji">🎵</div>';
        return `<button class="fm-pl-item${p.id===lastPl?' playing':''}" data-id="${esc(p.id)}">
          ${img}<span class="fm-pl-name">${esc(p.name)}</span>
          <span class="fm-pl-play">▶</span></button>`;
      }).join('');
    } else {
      list.innerHTML = SMART_PLAYLISTS.map(p =>
        `<button class="fm-pl-item${p.id===lastPl?' playing':''}" data-id="${esc(p.id)}">
          <span class="fm-pl-emoji">${p.emoji}</span>
          <span class="fm-pl-name">${esc(p.label)}</span>
          <span class="fm-pl-play">▶</span></button>`
      ).join('');
    }

    list.querySelectorAll('.fm-pl-item').forEach(btn =>
      btn.addEventListener('click', () => {
        playPlaylist(btn.dataset.id);
        list.querySelectorAll('.fm-pl-item').forEach(b => b.classList.remove('playing'));
        btn.classList.add('playing');
      })
    );
  }

  /* ── Live updates without full re-render ── */
  function updateLive() {
    // Mini play button
    const mp = document.getElementById('_fm_mini_play');
    if (mp) mp.innerHTML = isPaused
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    // Panel play button
    const pp = document.getElementById('_fp_play');
    if (pp) pp.innerHTML = isPaused
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    // If track changed, full re-render (art + name)
    const tn = document.querySelector('.fm-mini-track');
    if (tn && tn.getAttribute('title') !== (track?.name||'—')) { render(); return; }

    updateProgress();
  }

  function updateProgress() {
    const pct = durationMs > 0 ? (progressMs/durationMs*100).toFixed(2) : 0;
    const fill = document.getElementById('_fp_fill'); if (fill) fill.style.width = pct + '%';
    const pos  = document.getElementById('_fp_pos');  if (pos)  pos.textContent  = fmt(progressMs);
  }

  /* ══════════════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════════════ */
  function boot() {
    const page = location.pathname.split('/').pop().toLowerCase();
    if (page === 'login.html' || page === 'spotify-callback.html') return;

    injectCSS();

    // Restore expanded state
    isExpanded = localStorage.getItem(K.expanded) === '1';

    // Only show the bar if the user explicitly opened it before
    // (FocusFM bar is hidden by default until the user clicks the FocusFM button)
    if (localStorage.getItem(K.shown) === '1') {
      render();
    }
    initKeys();

    // Save playback state before page navigation so next page can resume
    window.addEventListener('beforeunload', () => {
      localStorage.setItem(K.wasPlaying, isPaused ? '0' : '1');
    });

    if (isFocusMode()) document.documentElement.classList.add('fm-focus-mode');

    if (getAccess()) {
      ensureToken().then(ok => {
        if (ok) {
          initSDK();
        } else if (getAccess()) {
          // Refresh failed (network/server error) but we still have an access token —
          // try the SDK anyway. authentication_error will fire if truly invalid.
          initSDK();
        } else {
          // Token was explicitly cleared (401/400) — must reconnect
          render();
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ── Public API ── */
  window.FocusFM = {
    saveTokens,
    CLIENT_ID,
    REDIRECT_URI,
    isPlaying: () => !isPaused,
    toggle: () => toggleExpand(),
    open:   () => { showMini(); if (!isExpanded) toggleExpand(); },
  };
})();
