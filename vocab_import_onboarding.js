/**
 * vocab_import_onboarding.js — Onboarding du premier import de vocabulaire
 *
 * Expose `window.vocabImport`:
 *   - maybeShowFormatInfo(onContinue) : si jamais importé, affiche la popup
 *     d'info format + déclenche onContinue à la fermeture du popup
 *   - showFormatError(onRetry)        : popup d'erreur si format invalide
 *   - celebrateFirstImport(opts)      : popup de félicitations + confettis
 *   - hasCompletedFirstImport()       : bool (localStorage)
 *   - markFirstImportComplete()       : enregistre le statut
 *   - awardFirstImportXp(amount)      : upsert direct dans user_xp
 *   - downloadExample(format)         : 'xlsx' | 'csv' — télécharge un modèle
 *
 * Dépendances supposées globales (déjà chargées par quiz.html):
 *   - window.currentUser  (objet utilisateur Supabase, peut être null)
 *   - window.sb           (client Supabase)
 *   - window.XLSX         (SheetJS, pour le téléchargement .xlsx de l'exemple)
 */
(function () {
  'use strict';

  /* ─────────────────────────── Config ─────────────────────────── */
  const KEY_PREFIX = 'lazypo:firstVocabImportDone:';
  const KEY_AT_PREFIX = 'lazypo:firstVocabImportAt:';
  const FIRST_IMPORT_XP_BONUS = 50;

  /* ────────────────────── Status persistence ──────────────────── */
  function userKey(base) {
    const uid = (window.currentUser && window.currentUser.id) || 'anon';
    return base + uid;
  }

  function hasCompletedFirstImport() {
    try { return localStorage.getItem(userKey(KEY_PREFIX)) === '1'; }
    catch (_) { return false; }
  }

  function markFirstImportComplete() {
    try {
      localStorage.setItem(userKey(KEY_PREFIX), '1');
      localStorage.setItem(userKey(KEY_AT_PREFIX), new Date().toISOString());
    } catch (_) { /* quota or private mode — ignore */ }
  }

  /* ────────────────────── XP bonus (server) ───────────────────── */
  async function awardFirstImportXp(amount) {
    const xp = (typeof amount === 'number' ? amount : FIRST_IMPORT_XP_BONUS);
    if (!window.currentUser || !window.sb) return false;
    try {
      // 1. Read current total_xp (may not exist yet)
      const { data: existing } = await window.sb
        .from('user_xp')
        .select('total_xp')
        .eq('user_id', window.currentUser.id)
        .maybeSingle();
      const newTotal = (existing && existing.total_xp ? existing.total_xp : 0) + xp;

      // 2. Upsert total_xp
      const { error: upErr } = await window.sb.from('user_xp').upsert({
        user_id:    window.currentUser.id,
        total_xp:   newTotal,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (upErr) throw upErr;

      // 3. Log in xp_daily_log (merge with today's existing log if any)
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingLog } = await window.sb
        .from('xp_daily_log')
        .select('xp_earned, breakdown')
        .eq('user_id', window.currentUser.id)
        .eq('date', today)
        .maybeSingle();
      const baseXp = (existingLog && existingLog.xp_earned) || 0;
      const baseBd = (existingLog && existingLog.breakdown) || {};
      await window.sb.from('xp_daily_log').upsert({
        user_id:   window.currentUser.id,
        date:      today,
        xp_earned: baseXp + xp,
        breakdown: Object.assign({}, baseBd, { first_import: xp }),
      }, { onConflict: 'user_id,date' });

      // 4. Refresh in-memory cache used by reconciliation if available
      if (window.userXpState) window.userXpState.total_xp = newTotal;
      return true;
    } catch (e) {
      console.warn('[vocabImport] awardFirstImportXp failed', e);
      return false;
    }
  }

  /* ───────────────────── Example file template ────────────────── */
  const EXAMPLE_ROWS = [
    { source_word: 'resilience',  target_translation: 'résilience',              language_pair: 'EN→FR', example_sentence: 'Resilience is key to success.',     tips: '' },
    { source_word: 'benchmark',   target_translation: 'référence / jalon',       language_pair: 'EN→FR', example_sentence: 'This sets the benchmark.',           tips: '' },
    { source_word: 'leverage',    target_translation: 'levier / tirer parti de', language_pair: 'EN→FR', example_sentence: 'We can leverage this opportunity.', tips: 'Penser à "levier" en français' },
    { source_word: 'de fiets',    target_translation: 'vélo',                    language_pair: 'nl-fr', example_sentence: 'Ik ga op de fiets naar school.',     tips: '' },
    { source_word: 'het weer',    target_translation: 'la météo / le temps',     language_pair: 'nl-fr', example_sentence: 'Het weer is mooi vandaag.',          tips: '' },
  ];
  const EXAMPLE_COLS = ['source_word', 'target_translation', 'language_pair', 'example_sentence', 'tips'];

  function downloadExample(format) {
    format = format === 'csv' ? 'csv' : 'xlsx';
    if (format === 'xlsx' && typeof window.XLSX === 'undefined') {
      console.warn('[vocabImport] XLSX not loaded — falling back to CSV');
      format = 'csv';
    }
    if (format === 'csv') {
      const esc = v => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [EXAMPLE_COLS.join(',')];
      EXAMPLE_ROWS.forEach(r => lines.push(EXAMPLE_COLS.map(c => esc(r[c])).join(',')));
      // BOM for Excel UTF-8 recognition
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lazypo-vocab-exemple.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      const ws = window.XLSX.utils.json_to_sheet(EXAMPLE_ROWS, { header: EXAMPLE_COLS });
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Vocabulary');
      window.XLSX.writeFile(wb, 'lazypo-vocab-exemple.xlsx');
    }
  }

  /* ──────────────────────────── CSS ───────────────────────────── */
  const css = `
    .vio-backdrop {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
      opacity: 0; pointer-events: none;
      transition: opacity 0.25s ease;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .vio-backdrop.show { opacity: 1; pointer-events: all; }

    .vio-modal {
      background: #111111;
      border: 1px solid #1e1e1e;
      border-radius: 18px;
      padding: 26px 28px 22px;
      max-width: 580px; width: 100%;
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(96,165,250,0.08);
      transform: scale(0.96);
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
      font-family: 'DM Sans', 'Segoe UI', sans-serif;
      color: #e0e0e0;
    }
    .vio-backdrop.show .vio-modal { transform: scale(1); }
    .vio-modal.error    { border-color: rgba(239,68,68,.4); }
    .vio-modal.celebrate{ border-color: rgba(96,165,250,.4); text-align: center; padding: 38px 32px 28px; }

    .vio-header { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
    .vio-icon {
      width: 48px; height: 48px; border-radius: 12px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px;
      background: rgba(96,165,250,0.1);
      border: 1px solid rgba(96,165,250,0.2);
    }
    .vio-modal.error .vio-icon {
      background: rgba(239,68,68,0.1);
      border-color: rgba(239,68,68,0.3);
    }
    .vio-titles { flex: 1; min-width: 0; }
    .vio-title { font-size: 16px; font-weight: 700; color: #f0f0f0; margin-bottom: 3px; }
    .vio-sub {
      font-size: 11px; color: #60a5fa; letter-spacing: .08em;
      text-transform: uppercase; font-family: 'DM Mono', monospace;
    }
    .vio-modal.error .vio-sub { color: #f87171; }
    .vio-close {
      margin-left: 4px; flex-shrink: 0;
      width: 28px; height: 28px; border-radius: 8px;
      background: none; border: 1px solid #2a2a2a; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: #555; font-size: 13px;
      transition: background .15s, color .15s;
    }
    .vio-close:hover { background: #1e1e1e; color: #aaa; }

    .vio-divider { height: 1px; background: #1e1e1e; margin: 0 0 16px; }

    .vio-msg { font-size: 13.5px; color: #c0c0c0; line-height: 1.6; margin-bottom: 14px; }
    .vio-msg strong { color: #f0f0f0; font-weight: 600; }

    .vio-table-wrap {
      background: #0c0c0c;
      border: 1px solid #1e1e1e;
      border-radius: 10px;
      overflow-x: auto;
      margin-bottom: 10px;
    }
    .vio-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'DM Mono', 'SF Mono', Menlo, monospace;
      font-size: 11.5px;
    }
    .vio-table th {
      text-align: left; padding: 8px 10px;
      color: #60a5fa; font-weight: 600;
      border-bottom: 1px solid #1e1e1e;
      white-space: nowrap;
      background: rgba(96,165,250,0.04);
    }
    .vio-table td {
      padding: 7px 10px;
      color: #b0b0b0;
      border-bottom: 1px solid #161616;
      white-space: nowrap;
    }
    .vio-table tr:last-child td { border-bottom: none; }
    .vio-table th.req::after { content: ' *'; color: #ef4444; }

    .vio-legend {
      font-size: 11.5px; color: #888; margin-bottom: 16px; line-height: 1.5;
    }
    .vio-legend .req-dot { color: #ef4444; font-weight: 700; }

    .vio-example-btns {
      display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;
    }

    .vio-actions {
      display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;
      margin-top: 4px;
    }
    .vio-btn {
      font-family: inherit; font-size: 13px;
      padding: 9px 18px; border-radius: 9px;
      border: 1px solid #2a2a2a;
      background: #1a1a1a; color: #e0e0e0;
      cursor: pointer;
      transition: background .15s, border-color .15s, transform .1s;
      display: inline-flex; align-items: center; gap: 6px;
      white-space: nowrap;
    }
    .vio-btn:hover  { background: #232323; border-color: #3a3a3a; }
    .vio-btn:active { transform: scale(.98); }
    .vio-btn.primary {
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      border-color: #60a5fa; color: #fff; font-weight: 600;
    }
    .vio-btn.primary:hover { background: linear-gradient(135deg, #2563eb, #3b82f6); }
    .vio-btn.ghost { background: transparent; }

    /* ── Celebration ── */
    .vio-celebrate-icon {
      font-size: 64px; line-height: 1;
      animation: vio-pop .6s cubic-bezier(0.34,1.56,0.64,1) both;
      margin-bottom: 14px;
    }
    .vio-celebrate-title {
      font-size: 22px; font-weight: 700; color: #f0f0f0; margin-bottom: 8px;
      animation: vio-rise .5s ease-out .15s both;
    }
    .vio-celebrate-sub {
      font-size: 14px; color: #b0b0b0; margin-bottom: 20px; line-height: 1.5;
      animation: vio-rise .5s ease-out .25s both;
    }
    .vio-celebrate-stats {
      display: flex; justify-content: center; gap: 14px; margin-bottom: 22px;
      flex-wrap: wrap;
      animation: vio-rise .5s ease-out .35s both;
    }
    .vio-stat {
      background: rgba(96,165,250,0.08);
      border: 1px solid rgba(96,165,250,0.25);
      border-radius: 12px;
      padding: 10px 22px;
      min-width: 100px;
    }
    .vio-stat-value { font-size: 24px; font-weight: 700; color: #60a5fa; line-height: 1; }
    .vio-stat-label {
      font-size: 11px; color: #888; text-transform: uppercase;
      letter-spacing: .05em; margin-top: 4px;
    }
    .vio-stat.xp .vio-stat-value { color: #fbbf24; }
    .vio-stat.xp { background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.25); }

    @keyframes vio-pop {
      0%   { transform: scale(0);   opacity: 0; }
      60%  { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1);   opacity: 1; }
    }
    @keyframes vio-rise {
      from { transform: translateY(8px); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }

    /* ── Confetti ── */
    .vio-confetti-host {
      position: fixed; inset: 0; pointer-events: none; z-index: 10001;
      overflow: hidden;
    }
    .vio-confetti {
      position: absolute; top: -20px;
      width: 8px; height: 14px;
      opacity: 0;
      animation: vio-fall 2.6s ease-in forwards;
    }
    @keyframes vio-fall {
      0%   { opacity: 1; transform: translate3d(0, -20px, 0) rotate(0); }
      100% { opacity: 0; transform: translate3d(var(--dx, 0px), 110vh, 0) rotate(var(--rot, 720deg)); }
    }

    @media (max-width: 520px) {
      .vio-modal { padding: 22px 18px 18px; }
      .vio-modal.celebrate { padding: 30px 20px 22px; }
      .vio-stat { padding: 8px 16px; min-width: 80px; }
      .vio-actions { justify-content: stretch; }
      .vio-actions .vio-btn { flex: 1; justify-content: center; }
    }
  `;
  (function injectCss() {
    if (document.getElementById('vio-styles')) return;
    const s = document.createElement('style');
    s.id = 'vio-styles';
    s.textContent = css;
    document.head.appendChild(s);
  })();

  /* ─────────────────────────── DOM ────────────────────────────── */
  let _backdrop = null;

  function ensureBackdrop() {
    if (_backdrop) return _backdrop;
    _backdrop = document.createElement('div');
    _backdrop.className = 'vio-backdrop';
    document.body.appendChild(_backdrop);
    return _backdrop;
  }

  function closeBackdrop() {
    if (!_backdrop) return;
    _backdrop.classList.remove('show');
    const bd = _backdrop;
    setTimeout(() => { if (bd) bd.innerHTML = ''; }, 260);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderFormatTable() {
    const head = `
      <tr>
        <th class="req">source_word</th>
        <th class="req">target_translation</th>
        <th>language_pair</th>
        <th>example_sentence</th>
        <th>tips</th>
      </tr>
    `;
    const body = EXAMPLE_ROWS.slice(0, 3).map(r => `
      <tr>
        <td>${escapeHtml(r.source_word)}</td>
        <td>${escapeHtml(r.target_translation)}</td>
        <td>${escapeHtml(r.language_pair)}</td>
        <td>${escapeHtml(r.example_sentence)}</td>
        <td>${escapeHtml(r.tips || '—')}</td>
      </tr>
    `).join('');
    return `
      <div class="vio-table-wrap">
        <table class="vio-table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="vio-legend">
        <span class="req-dot">*</span> = colonne <strong>obligatoire</strong>.
        Les autres sont facultatives. Le fichier doit être au format
        <strong>.xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong>,
        avec les en-têtes en première ligne.
      </div>
    `;
  }

  function bindExampleButtons(scope) {
    const xlsxBtn = scope.querySelector('[data-vio-dl="xlsx"]');
    const csvBtn  = scope.querySelector('[data-vio-dl="csv"]');
    if (xlsxBtn) xlsxBtn.onclick = () => downloadExample('xlsx');
    if (csvBtn)  csvBtn.onclick  = () => downloadExample('csv');
  }

  /* ─────────────── Popup 1 : Format info (1st time) ─────────────── */
  function maybeShowFormatInfo(onContinue) {
    onContinue = typeof onContinue === 'function' ? onContinue : function () {};
    if (hasCompletedFirstImport()) {
      onContinue();
      return;
    }
    const bd = ensureBackdrop();
    bd.innerHTML = `
      <div class="vio-modal info" role="dialog" aria-modal="true" aria-labelledby="vio-info-title">
        <div class="vio-header">
          <div class="vio-icon">📋</div>
          <div class="vio-titles">
            <div class="vio-title" id="vio-info-title">Premier import de vocabulaire</div>
            <div class="vio-sub">Format attendu</div>
          </div>
          <button class="vio-close" data-vio-act="close" aria-label="Fermer">✕</button>
        </div>
        <div class="vio-divider"></div>
        <p class="vio-msg">
          Pour que tes mots soient correctement chargés, ton fichier doit contenir
          au minimum les colonnes <strong>source_word</strong> et
          <strong>target_translation</strong>. Voici un aperçu d'un fichier valide :
        </p>
        ${renderFormatTable()}
        <div class="vio-example-btns">
          <button class="vio-btn ghost" data-vio-dl="xlsx">⬇ Télécharger l'exemple .xlsx</button>
          <button class="vio-btn ghost" data-vio-dl="csv">⬇ .csv</button>
        </div>
        <div class="vio-divider"></div>
        <div class="vio-actions">
          <button class="vio-btn ghost" data-vio-act="cancel">Annuler</button>
          <button class="vio-btn primary" data-vio-act="continue">
            J'ai compris — choisir mon fichier
          </button>
        </div>
      </div>
    `;
    requestAnimationFrame(() => bd.classList.add('show'));
    const close = () => closeBackdrop();
    bd.querySelector('[data-vio-act="close"]').onclick  = close;
    bd.querySelector('[data-vio-act="cancel"]').onclick = close;
    bd.querySelector('[data-vio-act="continue"]').onclick = () => {
      closeBackdrop();
      onContinue();
    };
    bindExampleButtons(bd);
    bd.onclick = (e) => { if (e.target === bd) close(); };
  }

  /* ─────────────── Popup 2 : Format error ─────────────── */
  function showFormatError(onRetry) {
    const bd = ensureBackdrop();
    bd.innerHTML = `
      <div class="vio-modal error" role="dialog" aria-modal="true" aria-labelledby="vio-err-title">
        <div class="vio-header">
          <div class="vio-icon">⚠️</div>
          <div class="vio-titles">
            <div class="vio-title" id="vio-err-title">Format de fichier non reconnu</div>
            <div class="vio-sub">Import annulé</div>
          </div>
          <button class="vio-close" data-vio-act="close" aria-label="Fermer">✕</button>
        </div>
        <div class="vio-divider"></div>
        <p class="vio-msg">
          Ton fichier ne contient pas les colonnes attendues, ou est illisible.
          Vérifie que les en-têtes <strong>source_word</strong> et
          <strong>target_translation</strong> sont bien présents (en minuscules,
          sans accents), et que le fichier est au format .xlsx, .xls ou .csv.
        </p>
        ${renderFormatTable()}
        <div class="vio-example-btns">
          <button class="vio-btn ghost" data-vio-dl="xlsx">⬇ Télécharger l'exemple .xlsx</button>
          <button class="vio-btn ghost" data-vio-dl="csv">⬇ .csv</button>
        </div>
        <div class="vio-divider"></div>
        <div class="vio-actions">
          <button class="vio-btn ghost" data-vio-act="cancel">Fermer</button>
          <button class="vio-btn primary" data-vio-act="retry">Réessayer</button>
        </div>
      </div>
    `;
    requestAnimationFrame(() => bd.classList.add('show'));
    const close = () => closeBackdrop();
    bd.querySelector('[data-vio-act="close"]').onclick  = close;
    bd.querySelector('[data-vio-act="cancel"]').onclick = close;
    bd.querySelector('[data-vio-act="retry"]').onclick  = () => {
      closeBackdrop();
      if (typeof onRetry === 'function') onRetry();
    };
    bindExampleButtons(bd);
    bd.onclick = (e) => { if (e.target === bd) close(); };
  }

  /* ─────────────── Popup 3 : Celebration ─────────────── */
  function spawnConfetti(count) {
    count = count || 48;
    const host = document.createElement('div');
    host.className = 'vio-confetti-host';
    document.body.appendChild(host);
    const colors = ['#60a5fa', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#fb923c', '#22d3ee'];
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'vio-confetti';
      const x   = Math.random() * 100;
      const dx  = (Math.random() - 0.5) * 240;
      const rot = (Math.random() > .5 ? 1 : -1) * (360 + Math.random() * 720);
      const delay = Math.random() * 0.4;
      const dur   = 2.2 + Math.random() * 0.9;
      c.style.left = x + '%';
      c.style.background = colors[i % colors.length];
      c.style.borderRadius = (Math.random() > .5 ? '50%' : '2px');
      c.style.animationDelay = delay + 's';
      c.style.animationDuration = dur + 's';
      c.style.setProperty('--dx', dx + 'px');
      c.style.setProperty('--rot', rot + 'deg');
      host.appendChild(c);
    }
    setTimeout(() => host.remove(), 4500);
  }

  function celebrateFirstImport(opts) {
    opts = opts || {};
    const wordCount = typeof opts.wordCount === 'number' ? opts.wordCount : 0;
    const xp = typeof opts.xp === 'number' ? opts.xp : FIRST_IMPORT_XP_BONUS;

    spawnConfetti();

    const bd = ensureBackdrop();
    const xpBlock = xp > 0 ? `
      <div class="vio-stat xp">
        <div class="vio-stat-value">+${xp}</div>
        <div class="vio-stat-label">XP bonus</div>
      </div>` : '';
    bd.innerHTML = `
      <div class="vio-modal celebrate" role="dialog" aria-modal="true" aria-labelledby="vio-cel-title">
        <div class="vio-celebrate-icon">🎉</div>
        <div class="vio-celebrate-title" id="vio-cel-title">Premier import réussi !</div>
        <div class="vio-celebrate-sub">
          Bravo, ton vocabulaire est en place. Prêt à enchaîner les quiz pour le maîtriser ?
        </div>
        <div class="vio-celebrate-stats">
          <div class="vio-stat">
            <div class="vio-stat-value">${wordCount}</div>
            <div class="vio-stat-label">Mot${wordCount > 1 ? 's' : ''}</div>
          </div>
          ${xpBlock}
        </div>
        <div class="vio-actions" style="justify-content:center;">
          <button class="vio-btn primary" data-vio-act="start">Lancer un quiz !</button>
          <button class="vio-btn ghost" data-vio-act="later">Plus tard</button>
        </div>
      </div>
    `;
    requestAnimationFrame(() => bd.classList.add('show'));
    const close = () => closeBackdrop();
    bd.querySelector('[data-vio-act="later"]').onclick = close;
    bd.querySelector('[data-vio-act="start"]').onclick = () => {
      closeBackdrop();
      const startBtn =
        document.getElementById('btn-start-quiz') ||
        document.getElementById('quiz-start') ||
        document.querySelector('[data-action="start-quiz"]');
      if (startBtn) startBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    bd.onclick = (e) => { if (e.target === bd) close(); };
  }

  /* ─────────────────────────── Export ─────────────────────────── */
  window.vocabImport = {
    maybeShowFormatInfo: maybeShowFormatInfo,
    showFormatError:     showFormatError,
    celebrateFirstImport: celebrateFirstImport,
    hasCompletedFirstImport: hasCompletedFirstImport,
    markFirstImportComplete: markFirstImportComplete,
    awardFirstImportXp: awardFirstImportXp,
    downloadExample: downloadExample,
    FIRST_IMPORT_XP_BONUS: FIRST_IMPORT_XP_BONUS,
  };
})();
