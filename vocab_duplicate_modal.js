/**
 * vocab_duplicate_modal.js — Détection de doublons et UX de fusion
 *
 * Règle de doublon (cas d'égalité) :
 *   norm(source_word) === norm(other.source_word)  AND  language_pair égales
 *   (case-insensitive, trim ; on garde les accents — "café" ≠ "cafe")
 *
 * Expose `window.vocabDuplicate`:
 *   - findDuplicate(incoming, vocab)           → existing | null
 *   - findDuplicatesBulk(incomings, vocab)     → { duplicates: [{incoming, existing, diff}], fresh: [incoming] }
 *   - mergeForUpdate(existing, incoming)       → patch object (champs non vides à mettre à jour)
 *   - showPrompt({ existing, incoming, onUpdate, onKeep, onCancel })
 *   - showBulkPrompt({ duplicates, freshCount, onApplyAll, onSkipAll, onPerItem, onCancel })
 *   - normWord(s)                              → string normalisé pour comparaison
 */
(function () {
  'use strict';

  /* ─────────────────────────── Helpers ─────────────────────────── */
  function normWord(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }

  function findDuplicate(incoming, vocab) {
    if (!incoming || !incoming.source_word) return null;
    const ns = normWord(incoming.source_word);
    const lp = incoming.language_pair || '';
    return (vocab || []).find(w =>
      normWord(w.source_word) === ns &&
      (w.language_pair || '') === lp
    ) || null;
  }

  function findDuplicatesBulk(incomings, vocab) {
    // Detect both:
    //   (a) incoming words that match an existing vocab row
    //   (b) collisions inside the same import batch (first-seen wins,
    //       subsequent occurrences are flagged as duplicates of the first)
    const fresh = [];
    const duplicates = [];
    const seenInBatch = new Map(); // key = norm+lp → incoming
    (incomings || []).forEach(inc => {
      const ex = findDuplicate(inc, vocab);
      const key = normWord(inc.source_word) + '||' + (inc.language_pair || '');
      const dupInBatch = seenInBatch.get(key);
      if (ex) {
        duplicates.push({ incoming: inc, existing: ex, diff: computeDiff(ex, inc), source: 'db' });
      } else if (dupInBatch) {
        duplicates.push({ incoming: inc, existing: dupInBatch, diff: computeDiff(dupInBatch, inc), source: 'batch' });
      } else {
        fresh.push(inc);
        seenInBatch.set(key, inc);
      }
    });
    return { duplicates, fresh };
  }

  function computeDiff(existing, incoming) {
    const fields = ['target_translation', 'example_sentence', 'tips'];
    const out = {};
    fields.forEach(f => {
      const a = (existing && existing[f]) || '';
      const b = (incoming && incoming[f]) || '';
      out[f] = {
        before: a,
        after: b,
        changed: !!b && b !== a,            // incoming non-empty AND different
        cleared: !!a && !b,                  // incoming would erase existing (we don't allow this on merge)
        same: a === b,
      };
    });
    return out;
  }

  function mergeForUpdate(existing, incoming) {
    // Only patch with non-empty incoming values that differ from existing.
    // Empty incoming fields don't erase the original.
    const patch = {};
    ['target_translation', 'example_sentence', 'tips'].forEach(f => {
      const inc = incoming && incoming[f];
      if (inc != null && String(inc).trim() && inc !== (existing && existing[f])) {
        patch[f] = inc;
      }
    });
    return patch;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ─────────────────────────── CSS ─────────────────────────── */
  const css = `
    .vd-backdrop {
      position: fixed; inset: 0; z-index: 10200;
      background: rgba(0,0,0,0.62); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      opacity: 0; pointer-events: none;
      transition: opacity .22s ease;
    }
    .vd-backdrop.show { opacity: 1; pointer-events: all; }

    .vd-modal {
      background: #111111;
      border: 1px solid rgba(251,191,36,.35);
      border-radius: 18px;
      padding: 24px 26px 20px;
      width: 100%; max-width: 720px;
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(251,191,36,.08);
      transform: scale(0.96);
      transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1);
      font-family: 'DM Sans', 'Segoe UI', sans-serif;
      color: #e0e0e0;
    }
    .vd-backdrop.show .vd-modal { transform: scale(1); }

    .vd-header { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
    .vd-icon {
      width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      background: rgba(251,191,36,.1);
      border: 1px solid rgba(251,191,36,.3);
    }
    .vd-titles { flex: 1; min-width: 0; }
    .vd-title { font-size: 16px; font-weight: 700; color: #f0f0f0; margin-bottom: 3px; }
    .vd-sub {
      font-size: 11px; color: #fbbf24; letter-spacing: .08em;
      text-transform: uppercase; font-family: 'DM Mono', monospace;
    }
    .vd-close {
      margin-left: 4px; flex-shrink: 0;
      width: 28px; height: 28px; border-radius: 8px;
      background: none; border: 1px solid #2a2a2a; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: #555; font-size: 13px;
      transition: background .15s, color .15s;
    }
    .vd-close:hover { background: #1e1e1e; color: #aaa; }

    .vd-divider { height: 1px; background: #1e1e1e; margin: 0 0 14px; }

    .vd-msg { font-size: 13.5px; color: #c0c0c0; line-height: 1.55; margin-bottom: 14px; }
    .vd-msg strong { color: #f0f0f0; }

    /* Side-by-side comparison */
    .vd-compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 580px) { .vd-compare { grid-template-columns: 1fr; } }

    .vd-card {
      background: #0c0c0c;
      border: 1px solid #1e1e1e;
      border-radius: 12px;
      padding: 14px 16px;
      display: flex; flex-direction: column; gap: 10px;
      min-width: 0;
    }
    .vd-card.existing { border-color: rgba(96,165,250,.25); }
    .vd-card.incoming { border-color: rgba(251,191,36,.35); }

    .vd-card-label {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      font-family: 'DM Mono', monospace;
      font-weight: 700;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .vd-card.existing .vd-card-label { color: #60a5fa; }
    .vd-card.incoming .vd-card-label { color: #fbbf24; }

    .vd-source {
      font-size: 18px; font-weight: 700; color: #f0f0f0;
      word-break: break-word;
    }
    .vd-field {
      display: flex; flex-direction: column; gap: 2px;
      font-size: 12.5px;
    }
    .vd-field-label {
      font-size: 10px; color: #6b6b6b; text-transform: uppercase;
      letter-spacing: .08em; font-family: 'DM Mono', monospace;
    }
    .vd-field-value {
      color: #c0c0c0;
      word-break: break-word;
      line-height: 1.45;
    }
    .vd-field-value.empty { color: #555; font-style: italic; }
    .vd-field.changed .vd-field-value {
      background: rgba(251,191,36,.12);
      border-left: 2px solid #fbbf24;
      padding: 4px 8px;
      border-radius: 0 6px 6px 0;
      color: #fde68a;
    }
    .vd-field.changed .vd-field-label {
      color: #fbbf24;
    }
    .vd-field.changed .vd-field-label::after {
      content: ' (modifié)';
      font-style: italic;
      opacity: .8;
    }

    /* Diff summary line */
    .vd-diff-summary {
      font-size: 12.5px; color: #888;
      background: rgba(255,255,255,.02);
      border: 1px dashed #2a2a2a;
      border-radius: 8px;
      padding: 9px 12px;
      margin-bottom: 16px;
    }
    .vd-diff-summary strong { color: #fbbf24; }
    .vd-diff-summary.identical { border-color: rgba(96,165,250,.2); color: #aaa; }

    .vd-actions {
      display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;
      margin-top: 4px;
    }
    .vd-btn {
      font-family: inherit; font-size: 13px;
      padding: 9px 18px; border-radius: 9px;
      border: 1px solid #2a2a2a;
      background: #1a1a1a; color: #e0e0e0;
      cursor: pointer;
      transition: background .15s, border-color .15s, transform .1s;
      display: inline-flex; align-items: center; gap: 6px;
      white-space: nowrap;
    }
    .vd-btn:hover  { background: #232323; border-color: #3a3a3a; }
    .vd-btn:active { transform: scale(.98); }
    .vd-btn.primary {
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      border-color: #fbbf24; color: #111; font-weight: 700;
    }
    .vd-btn.primary:hover { background: linear-gradient(135deg, #d97706, #f59e0b); }
    .vd-btn.ghost  { background: transparent; }
    .vd-btn.success {
      background: linear-gradient(135deg, #059669, #10b981);
      border-color: #10b981; color: #fff; font-weight: 600;
    }

    /* Bulk variant */
    .vd-modal.bulk { max-width: 640px; }
    .vd-bulk-stats {
      display: flex; gap: 10px; margin-bottom: 16px;
    }
    .vd-stat {
      flex: 1;
      background: #0c0c0c;
      border: 1px solid #1e1e1e;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .vd-stat-value {
      font-size: 22px; font-weight: 700; line-height: 1;
      margin-bottom: 3px;
    }
    .vd-stat-label {
      font-size: 11px; color: #888; text-transform: uppercase;
      letter-spacing: .05em;
    }
    .vd-stat.dup    .vd-stat-value { color: #fbbf24; }
    .vd-stat.fresh  .vd-stat-value { color: #10b981; }

    .vd-bulk-list {
      max-height: 260px;
      overflow-y: auto;
      background: #0c0c0c;
      border: 1px solid #1e1e1e;
      border-radius: 10px;
      padding: 6px 8px;
      margin-bottom: 16px;
    }
    .vd-bulk-row {
      padding: 8px 10px;
      border-bottom: 1px solid #161616;
      font-size: 12.5px;
      color: #b0b0b0;
      display: flex; align-items: center; gap: 10px;
    }
    .vd-bulk-row:last-child { border-bottom: none; }
    .vd-bulk-row .vd-bulk-word {
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: #e0e0e0; font-weight: 500;
    }
    .vd-bulk-row .vd-bulk-tag {
      font-size: 10px; padding: 2px 6px; border-radius: 4px;
      font-family: 'DM Mono', monospace;
      letter-spacing: .04em;
    }
    .vd-bulk-row .vd-bulk-tag.db    { background: rgba(96,165,250,.12);  color: #60a5fa; }
    .vd-bulk-row .vd-bulk-tag.batch { background: rgba(168,85,247,.12);  color: #a78bfa; }
  `;
  (function injectCss() {
    if (document.getElementById('vd-styles')) return;
    const s = document.createElement('style');
    s.id = 'vd-styles';
    s.textContent = css;
    document.head.appendChild(s);
  })();

  /* ─────────────────────────── DOM ─────────────────────────── */
  let _backdrop = null;

  function ensureBackdrop() {
    if (_backdrop) return _backdrop;
    _backdrop = document.createElement('div');
    _backdrop.className = 'vd-backdrop';
    document.body.appendChild(_backdrop);
    return _backdrop;
  }

  function closeBackdrop() {
    if (!_backdrop) return;
    _backdrop.classList.remove('show');
    const bd = _backdrop;
    setTimeout(() => { if (bd) bd.innerHTML = ''; }, 240);
  }

  /* ─────────────────────────── Single-word prompt ─────────────────────────── */
  function showPrompt({ existing, incoming, onUpdate, onKeep, onCancel }) {
    const diff = computeDiff(existing, incoming);
    const patch = mergeForUpdate(existing, incoming);
    const hasChanges = Object.keys(patch).length > 0;

    const bd = ensureBackdrop();

    const fieldHtml = (label, key, card) => {
      const d = diff[key];
      const value = card === 'existing' ? d.before : d.after;
      const isEmpty = !value;
      // Mark "changed" only on the incoming card to highlight the new value
      const changedCls = (card === 'incoming' && d.changed) ? ' changed' : '';
      return `
        <div class="vd-field${changedCls}">
          <div class="vd-field-label">${label}</div>
          <div class="vd-field-value${isEmpty ? ' empty' : ''}">${isEmpty ? '—' : escapeHtml(value)}</div>
        </div>
      `;
    };

    const cardHtml = (which) => {
      const obj = which === 'existing' ? existing : incoming;
      const lbl = which === 'existing'
        ? `<span>📚</span> DÉJÀ DANS TA LISTE`
        : `<span>✦</span> NOUVEAU`;
      return `
        <div class="vd-card ${which}">
          <div class="vd-card-label">${lbl}</div>
          <div class="vd-source">${escapeHtml(obj.source_word || '')}</div>
          ${fieldHtml('Traduction', 'target_translation', which)}
          ${fieldHtml('Exemple',    'example_sentence',    which)}
          ${fieldHtml('Tips',       'tips',                which)}
        </div>
      `;
    };

    const changedFields = Object.keys(patch).map(k => ({
      target_translation: 'la traduction',
      example_sentence:   'l\'exemple',
      tips:               'les tips',
    }[k])).filter(Boolean);

    const summaryHtml = hasChanges
      ? `<div class="vd-diff-summary">
           Les nouvelles infos vont écraser <strong>${changedFields.join(', ')}</strong> de l'original.
         </div>`
      : `<div class="vd-diff-summary identical">
           Les deux entrées sont identiques — rien à mettre à jour.
         </div>`;

    const updateBtn = hasChanges
      ? `<button class="vd-btn primary" data-vd-act="update">Mettre à jour l'original</button>`
      : ``;

    bd.innerHTML = `
      <div class="vd-modal" role="dialog" aria-modal="true" aria-labelledby="vd-title">
        <div class="vd-header">
          <div class="vd-icon">🔁</div>
          <div class="vd-titles">
            <div class="vd-title" id="vd-title">Ce mot existe déjà dans ta liste</div>
            <div class="vd-sub">Doublon détecté</div>
          </div>
          <button class="vd-close" data-vd-act="close" aria-label="Fermer">✕</button>
        </div>
        <div class="vd-divider"></div>
        <p class="vd-msg">
          Tu as déjà <strong>${escapeHtml(existing.source_word)}</strong>
          (${escapeHtml(existing.language_pair || '')}) dans ta liste. La liste de
          vocabulaire ne peut pas contenir de doublons. Que veux-tu faire ?
        </p>
        <div class="vd-compare">
          ${cardHtml('existing')}
          ${cardHtml('incoming')}
        </div>
        ${summaryHtml}
        <div class="vd-actions">
          <button class="vd-btn ghost" data-vd-act="cancel">Annuler & corriger</button>
          <button class="vd-btn" data-vd-act="keep">Garder l'original</button>
          ${updateBtn}
        </div>
      </div>
    `;
    requestAnimationFrame(() => bd.classList.add('show'));

    const closeAnd = (cb) => { closeBackdrop(); if (typeof cb === 'function') cb(); };
    bd.querySelector('[data-vd-act="close"]').onclick  = () => closeAnd(onCancel);
    bd.querySelector('[data-vd-act="cancel"]').onclick = () => closeAnd(onCancel);
    bd.querySelector('[data-vd-act="keep"]').onclick   = () => closeAnd(onKeep);
    const updEl = bd.querySelector('[data-vd-act="update"]');
    if (updEl) updEl.onclick = () => closeAnd(() => { if (typeof onUpdate === 'function') onUpdate(patch); });
    bd.onclick = (e) => { if (e.target === bd) closeAnd(onCancel); };
  }

  /* ─────────────────────────── Bulk prompt (Excel import) ─────────────────────────── */
  function showBulkPrompt({ duplicates, freshCount, onApplyAll, onSkipAll, onPerItem, onCancel }) {
    const bd = ensureBackdrop();
    const dupCount = duplicates.length;

    const listHtml = duplicates.slice(0, 50).map(d => {
      const tag = d.source === 'batch'
        ? `<span class="vd-bulk-tag batch" title="Doublon à l'intérieur du fichier importé">DANS LE FICHIER</span>`
        : `<span class="vd-bulk-tag db" title="Déjà présent dans ta liste">DÉJÀ EN BASE</span>`;
      const changed = Object.keys(mergeForUpdate(d.existing, d.incoming)).length;
      const sub = changed > 0
        ? `<span style="color:#888;font-size:11.5px;">→ ${changed} champ${changed>1?'s':''} à mettre à jour</span>`
        : `<span style="color:#666;font-size:11.5px;">→ identique</span>`;
      return `
        <div class="vd-bulk-row">
          <span class="vd-bulk-word">${escapeHtml(d.incoming.source_word || '')}</span>
          ${sub}
          ${tag}
        </div>
      `;
    }).join('');
    const moreHtml = duplicates.length > 50
      ? `<div class="vd-bulk-row" style="justify-content:center;color:#666;">… et ${duplicates.length - 50} autres</div>`
      : '';

    bd.innerHTML = `
      <div class="vd-modal bulk" role="dialog" aria-modal="true" aria-labelledby="vd-bulk-title">
        <div class="vd-header">
          <div class="vd-icon">📦</div>
          <div class="vd-titles">
            <div class="vd-title" id="vd-bulk-title">Doublons détectés dans l'import</div>
            <div class="vd-sub">Choisis comment les traiter</div>
          </div>
          <button class="vd-close" data-vd-act="close" aria-label="Fermer">✕</button>
        </div>
        <div class="vd-divider"></div>
        <div class="vd-bulk-stats">
          <div class="vd-stat fresh">
            <div class="vd-stat-value">${freshCount}</div>
            <div class="vd-stat-label">Nouveaux mots</div>
          </div>
          <div class="vd-stat dup">
            <div class="vd-stat-value">${dupCount}</div>
            <div class="vd-stat-label">Doublon${dupCount>1?'s':''}</div>
          </div>
        </div>
        <p class="vd-msg">
          ${freshCount > 0 ? `Les <strong>${freshCount}</strong> nouveaux mots seront ajoutés dans tous les cas.` : 'Aucun mot nouveau dans ce fichier — uniquement des doublons.'}
          Pour les <strong>${dupCount}</strong> doublon${dupCount>1?'s':''}, choisis l'action globale :
        </p>
        <div class="vd-bulk-list">
          ${listHtml}
          ${moreHtml}
        </div>
        <div class="vd-actions">
          <button class="vd-btn ghost" data-vd-act="cancel">Annuler l'import</button>
          <button class="vd-btn" data-vd-act="skipAll">Ignorer les doublons</button>
          <button class="vd-btn" data-vd-act="perItem">Décider un par un</button>
          <button class="vd-btn primary" data-vd-act="applyAll">Tout mettre à jour</button>
        </div>
      </div>
    `;
    requestAnimationFrame(() => bd.classList.add('show'));

    const closeAnd = (cb) => { closeBackdrop(); if (typeof cb === 'function') cb(); };
    bd.querySelector('[data-vd-act="close"]').onclick    = () => closeAnd(onCancel);
    bd.querySelector('[data-vd-act="cancel"]').onclick   = () => closeAnd(onCancel);
    bd.querySelector('[data-vd-act="skipAll"]').onclick  = () => closeAnd(onSkipAll);
    bd.querySelector('[data-vd-act="applyAll"]').onclick = () => closeAnd(onApplyAll);
    bd.querySelector('[data-vd-act="perItem"]').onclick  = () => closeAnd(onPerItem);
    bd.onclick = (e) => { if (e.target === bd) closeAnd(onCancel); };
  }

  /* ─────────────────────────── Per-item chain (bulk → one by one) ─────────────────────────── */
  /**
   * Cycle through duplicates one at a time using showPrompt.
   * Resolves with a Map<existingId, patch> of updates the user accepted.
   */
  function runPerItemChain(duplicates) {
    return new Promise((resolve) => {
      const decisions = new Map(); // existing.id → patch (only when user chose update)
      let i = 0;
      const next = () => {
        if (i >= duplicates.length) return resolve(decisions);
        const d = duplicates[i++];
        showPrompt({
          existing: d.existing,
          incoming: d.incoming,
          onUpdate: (patch) => {
            if (d.existing && d.existing.id) decisions.set(d.existing.id, patch);
            next();
          },
          onKeep:   () => next(),
          onCancel: () => next(),  // treat cancel = skip this one
        });
      };
      next();
    });
  }

  /* ─────────────────────────── Export ─────────────────────────── */
  window.vocabDuplicate = {
    findDuplicate,
    findDuplicatesBulk,
    mergeForUpdate,
    computeDiff,
    showPrompt,
    showBulkPrompt,
    runPerItemChain,
    normWord,
  };
})();
