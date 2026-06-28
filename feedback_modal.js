/* ═══════════════════════════════════════════════════════════════════
   feedback_modal.js — Modal de soumission Feedback global
   ───────────────────────────────────────────────────────────────────
   Chargé par sidebar.js sur toutes les pages.
   Expose window.LazyFeedback :
     - CONFIG : limites + listes (composants, types, statuts, colonnes Kanban)
     - openSubmissionModal({ onSubmitted })
     - editFeedback({ feedback, onUpdated })
     - listComponents() — retourne CONFIG.COMPONENTS
     - statusLabel(status), typeLabel(type), componentLabel(value)
═══════════════════════════════════════════════════════════════════ */
(function () {
  if (window.LazyFeedback && window.LazyFeedback.__loaded) return;

  /* ───────────────────────── CONFIG ─────────────────────────── */
  const CONFIG = {
    LIMITS: {
      TITLE_MAX: 80,
      DESCRIPTION_MAX: 1500,
      COMMENT_MAX: 500,
      SCREENSHOT_MAX_SIZE_MB: 5,
      SCREENSHOT_MAX_COUNT: 5,
      SCREENSHOT_ALLOWED_TYPES: ['image/png', 'image/jpeg'],
      EDIT_WINDOW_MIN: 60
    },
    TYPES: [
      { value: 'new_feature', label: 'New feature', icon: '🆕' },
      { value: 'bug',         label: 'Bug detected', icon: '🐛' },
      { value: 'other',       label: 'Other',        icon: '💬' }
    ],
    COMPONENTS: [
      { value: 'scope',        label: '✉️ Scope of Work' },
      { value: 'sprint',       label: '📋 Sprint Planning' },
      { value: 'jira',         label: '🎫 Jira' },
      { value: 'livenote',     label: '📝 LiveNote' },
      { value: 'minutehub',    label: '📝 Minute Hub' },
      { value: 'quiz',         label: '🧠 Knowledge Quiz' },
      { value: 'quiz_vocab',   label: '🧠 Quiz · Vocabulary' },
      { value: 'quiz_practice',label: '🧠 Quiz · Quiz' },
      { value: 'quiz_progress',label: '🧠 Quiz · Progress' },
      { value: 'quiz_verbes',  label: '🧠 Quiz · Verbes NL' },
      { value: 'quiz_multi',   label: '🧠 Quiz · Multi' },
      { value: 'focusfm',      label: '🎵 Focus FM' },
      { value: 'account',      label: '👤 My Account' },
      { value: 'sidebar',      label: '🧭 Sidebar / Navigation' },
      { value: 'general',      label: '🌐 General / Other' }
    ],
    STATUSES: [
      { value: 'submitted', label: 'Submitted', column: 'new'         },
      { value: 'accepted',  label: 'Accepted',  column: 'in_progress' },
      { value: 'ongoing',   label: 'Ongoing',   column: 'in_progress' },
      { value: 'postponed', label: 'Postponed', column: 'in_progress' },
      { value: 'blocked',   label: 'Blocked',   column: 'in_progress' },
      { value: 'done',      label: 'Done',      column: 'handled'     },
      { value: 'refused',   label: 'Refused',   column: 'handled'     }
    ],
    KANBAN_COLUMNS: [
      { id: 'new',         icon: '📥', label: 'New',         statuses: ['submitted'] },
      { id: 'in_progress', icon: '🔄', label: 'In progress', statuses: ['accepted','ongoing','postponed','blocked'] },
      { id: 'handled',     icon: '✅', label: 'Handled',     statuses: ['done','refused'] }
    ],
    BUCKET: 'feedback-screenshots'
  };

  /* ───────────────────────── helpers ─────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  function statusLabel(s){ return CONFIG.STATUSES.find(x => x.value === s)?.label || s; }
  function typeLabel(t){ const x = CONFIG.TYPES.find(y => y.value === t); return x ? `${x.icon} ${x.label}` : t; }
  function typeIcon(t){ return CONFIG.TYPES.find(x => x.value === t)?.icon || '💬'; }
  function componentLabel(v){ return CONFIG.COMPONENTS.find(x => x.value === v)?.label || v; }

  /* ───────────────────────── CSS ─────────────────────────── */
  const css = `
  .lf-modal-overlay {
    position: fixed; inset: 0; z-index: 9000;
    background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    opacity: 0; pointer-events: none;
    transition: opacity 0.2s ease;
    font-family: 'DM Sans', sans-serif;
  }
  .lf-modal-overlay.open { opacity: 1; pointer-events: all; }

  .lf-modal {
    background: #161616; border: 1px solid #2a2a2a;
    border-radius: 16px;
    width: 100%; max-width: 620px;
    max-height: 90vh; overflow-y: auto;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6);
    transform: translateY(12px) scale(0.98);
    transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1);
  }
  .lf-modal-overlay.open .lf-modal { transform: translateY(0) scale(1); }

  .lf-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 22px 28px 18px;
    border-bottom: 1px solid #222;
  }
  .lf-modal-title {
    font-size: 17px; font-weight: 700; color: #f0f0f0;
    display: flex; align-items: center; gap: 10px;
  }
  .lf-modal-close {
    width: 32px; height: 32px; border-radius: 8px;
    background: transparent; border: 1px solid #2a2a2a;
    color: #6b6b6b; font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .lf-modal-close:hover { background: #1c1c1c; color: #f0f0f0; }

  .lf-modal-body { padding: 22px 28px; display: flex; flex-direction: column; gap: 18px; }

  .lf-field { display: flex; flex-direction: column; gap: 6px; }
  .lf-label {
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: #6b6b6b;
    display: flex; align-items: center; justify-content: space-between;
  }
  .lf-counter { font-size: 11px; color: #555; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .lf-counter.warn { color: #f59e0b; }
  .lf-counter.over { color: #ef4444; }

  .lf-input, .lf-select, .lf-textarea {
    width: 100%; padding: 11px 14px;
    background: #0e0e0e; border: 1px solid #232323;
    border-radius: 10px; color: #f0f0f0;
    font-family: 'DM Sans', sans-serif; font-size: 14px;
    transition: border-color 0.15s, background 0.15s;
    outline: none;
  }
  .lf-input:focus, .lf-select:focus, .lf-textarea:focus {
    border-color: #3b82f6; background: #111;
  }
  .lf-input.invalid, .lf-select.invalid, .lf-textarea.invalid { border-color: #ef4444; }
  .lf-textarea { resize: vertical; min-height: 110px; line-height: 1.5; }
  .lf-select {
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6b6b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
    background-repeat: no-repeat; background-position: right 12px center;
    padding-right: 36px;
  }

  .lf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 600px) { .lf-row { grid-template-columns: 1fr; } }

  .lf-drop {
    border: 2px dashed #2a2a2a; border-radius: 10px;
    padding: 18px; text-align: center; cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    color: #6b6b6b; font-size: 13px;
  }
  .lf-drop:hover, .lf-drop.drag-over {
    border-color: #3b82f6; background: rgba(59,130,246,0.07); color: #60a5fa;
  }
  .lf-drop input { display: none; }
  .lf-drop strong { color: #f0f0f0; }

  .lf-thumbs { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .lf-thumb {
    position: relative; width: 78px; height: 78px;
    border-radius: 8px; overflow: hidden;
    border: 1px solid #2a2a2a; background: #0e0e0e;
  }
  .lf-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .lf-thumb-rm {
    position: absolute; top: 4px; right: 4px;
    width: 20px; height: 20px; border-radius: 50%;
    background: rgba(0,0,0,0.75); border: none; color: #fff;
    cursor: pointer; font-size: 12px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
  }
  .lf-thumb-rm:hover { background: #ef4444; }

  .lf-error {
    font-size: 12px; color: #ef4444;
    padding: 8px 12px; background: rgba(239,68,68,0.08);
    border: 1px solid rgba(239,68,68,0.25); border-radius: 8px;
  }

  .lf-modal-footer {
    display: flex; justify-content: flex-end; gap: 10px;
    padding: 16px 28px 22px;
    border-top: 1px solid #222;
  }
  .lf-btn {
    padding: 10px 20px; border-radius: 10px;
    font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
    cursor: pointer; transition: all 0.15s; border: 1px solid transparent;
  }
  .lf-btn-secondary {
    background: transparent; border-color: #2a2a2a; color: #f0f0f0;
  }
  .lf-btn-secondary:hover { background: #1c1c1c; }
  .lf-btn-primary {
    background: #3b82f6; color: #fff;
  }
  .lf-btn-primary:hover { background: #2563eb; }
  .lf-btn-primary:disabled, .lf-btn-secondary:disabled {
    opacity: 0.55; cursor: not-allowed;
  }
  .lf-spin {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff;
    border-radius: 50%; animation: lf-spin 0.7s linear infinite;
    margin-right: 8px; vertical-align: -2px;
  }
  @keyframes lf-spin { to { transform: rotate(360deg); } }

  /* Toast */
  .lf-toast {
    position: fixed; top: 20px; right: 20px; z-index: 9500;
    background: #161616; border: 1px solid #2a2a2a;
    border-left: 3px solid #22c55e;
    border-radius: 10px;
    padding: 14px 18px;
    color: #f0f0f0; font-family: 'DM Sans', sans-serif; font-size: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    display: flex; align-items: center; gap: 10px;
    opacity: 0; transform: translateX(20px);
    transition: opacity 0.22s, transform 0.22s;
    pointer-events: none;
  }
  .lf-toast.show { opacity: 1; transform: translateX(0); pointer-events: all; }
  .lf-toast.error { border-left-color: #ef4444; }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = '__lf_modal_styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ───────────────────────── Toast ─────────────────────────── */
  function showToast(msg, opts = {}) {
    const t = document.createElement('div');
    t.className = 'lf-toast' + (opts.error ? ' error' : '');
    t.innerHTML = `<span>${opts.error ? '⚠️' : '🎉'}</span><span>${esc(msg)}</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, opts.duration || 3000);
  }

  /* ─────────────────── Submission / Edit modal ──────────────────── */
  let activeModal = null;

  async function openSubmissionModal(opts = {}) {
    return openFormModal({ mode: 'create', ...opts });
  }
  async function editFeedback(opts = {}) {
    return openFormModal({ mode: 'edit', ...opts });
  }

  async function openFormModal(opts) {
    let session;
    if (window.LazyAuth?.requireAuth) {
      session = await window.LazyAuth.requireAuth();
    } else {
      const r = await window.sb.auth.getSession();
      session = r.data.session;
    }
    if (!session) { window.location.href = 'login.html'; return; }

    let nickname = 'User';
    if (session.__dev) {
      nickname = 'dev';
    } else {
      try {
        const { data: prof } = await window.sb.from('profiles').select('username').eq('id', session.user.id).single();
        nickname = prof?.username || session.user.email?.split('@')[0] || 'User';
      } catch (_) {}
    }

    const isEdit = opts.mode === 'edit';
    const fb     = opts.feedback || null;
    if (isEdit && (!fb || fb.author_id !== session.user.id)) {
      showToast('Vous ne pouvez modifier que vos propres requêtes.', { error: true });
      return;
    }

    if (activeModal) { activeModal.remove(); activeModal = null; }

    const overlay = document.createElement('div');
    overlay.className = 'lf-modal-overlay';
    overlay.innerHTML = renderFormHTML({ isEdit, fb });
    document.body.appendChild(overlay);
    activeModal = overlay;
    requestAnimationFrame(() => overlay.classList.add('open'));

    /* ── State ── */
    const screenshots = isEdit ? [...(fb.screenshots || [])] : [];
    const newFiles = [];
    let busy = false;

    const $ = (sel) => overlay.querySelector(sel);
    const closeBtn  = $('.lf-modal-close');
    const cancelBtn = $('#lfCancel');
    const submitBtn = $('#lfSubmit');
    const titleEl   = $('#lfTitle');
    const compEl    = $('#lfComponent');
    const typeEl    = $('#lfType');
    const descEl    = $('#lfDescription');
    const errEl     = $('#lfErr');
    const titleCnt  = $('#lfTitleCount');
    const descCnt   = $('#lfDescCount');
    const dropArea  = $('#lfDrop');
    const fileInput = $('#lfFile');
    const thumbsEl  = $('#lfThumbs');

    function close() {
      if (busy) return;
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); if (activeModal === overlay) activeModal = null; }, 200);
    }

    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', escListener);
    function escListener(e){ if (e.key === 'Escape' && activeModal === overlay) { close(); document.removeEventListener('keydown', escListener); } }

    function updateCounter(el, counter, max) {
      const len = el.value.length;
      counter.textContent = `${len}/${max}`;
      counter.classList.toggle('warn', len > max * 0.85 && len <= max);
      counter.classList.toggle('over', len > max);
    }

    titleEl.addEventListener('input', () => updateCounter(titleEl, titleCnt, CONFIG.LIMITS.TITLE_MAX));
    descEl.addEventListener('input',  () => updateCounter(descEl,  descCnt,  CONFIG.LIMITS.DESCRIPTION_MAX));
    updateCounter(titleEl, titleCnt, CONFIG.LIMITS.TITLE_MAX);
    updateCounter(descEl,  descCnt,  CONFIG.LIMITS.DESCRIPTION_MAX);

    /* placeholder erase on focus (description) */
    let descPlaceholderRestored = false;
    descEl.addEventListener('focus', () => { if (!descEl.value) descEl.placeholder = ''; });
    descEl.addEventListener('blur', () => {
      if (!descEl.value && !descPlaceholderRestored) {
        descEl.placeholder = 'Soyez précis afin que le développeur sache quoi faire';
      }
    });

    /* file handling */
    function renderThumbs() {
      thumbsEl.innerHTML = '';
      const all = [
        ...screenshots.map(s => ({ kind: 'remote', url: s.url, ref: s })),
        ...newFiles.map(f => ({ kind: 'local',  ref: f }))
      ];
      all.forEach((item, idx) => {
        const t = document.createElement('div');
        t.className = 'lf-thumb';
        const url = item.kind === 'local' ? URL.createObjectURL(item.ref) : item.url;
        t.innerHTML = `<img src="${esc(url)}" alt=""><button type="button" class="lf-thumb-rm" data-idx="${idx}" data-kind="${item.kind}">×</button>`;
        thumbsEl.appendChild(t);
      });
      thumbsEl.querySelectorAll('.lf-thumb-rm').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = +btn.dataset.idx;
          const kind = btn.dataset.kind;
          if (kind === 'remote') {
            screenshots.splice(0, screenshots.length, ...screenshots.filter((_,j) => {
              const remoteIdx = j;
              return remoteIdx !== i;
            }));
          } else {
            const localIdx = i - screenshots.length;
            newFiles.splice(localIdx, 1);
          }
          renderThumbs();
        });
      });
    }
    renderThumbs();

    function addFiles(list) {
      const max = CONFIG.LIMITS.SCREENSHOT_MAX_COUNT;
      const total = screenshots.length + newFiles.length;
      for (const f of list) {
        if (screenshots.length + newFiles.length >= max) {
          setError(`Maximum ${max} screenshots.`);
          break;
        }
        if (!CONFIG.LIMITS.SCREENSHOT_ALLOWED_TYPES.includes(f.type)) {
          setError(`Format non supporté (${f.name}). PNG ou JPG uniquement.`);
          continue;
        }
        if (f.size > CONFIG.LIMITS.SCREENSHOT_MAX_SIZE_MB * 1024 * 1024) {
          setError(`Fichier trop volumineux (${f.name}, max ${CONFIG.LIMITS.SCREENSHOT_MAX_SIZE_MB} Mo).`);
          continue;
        }
        newFiles.push(f);
      }
      renderThumbs();
    }

    fileInput.addEventListener('change', (e) => {
      addFiles(e.target.files);
      fileInput.value = '';
    });
    dropArea.addEventListener('click', () => fileInput.click());
    dropArea.addEventListener('dragover',  (e) => { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragleave', ()  => dropArea.classList.remove('drag-over'));
    dropArea.addEventListener('drop', (e) => {
      e.preventDefault(); dropArea.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });

    function setError(msg) {
      if (!msg) { errEl.style.display = 'none'; errEl.textContent = ''; return; }
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }

    submitBtn.addEventListener('click', async () => {
      setError(null);
      [titleEl, compEl, typeEl, descEl].forEach(el => el.classList.remove('invalid'));
      const title = titleEl.value.trim();
      const component = compEl.value;
      const type = typeEl.value;
      const description = descEl.value.trim();
      let bad = false;
      if (!title)              { titleEl.classList.add('invalid'); bad = true; }
      if (title.length > CONFIG.LIMITS.TITLE_MAX) { titleEl.classList.add('invalid'); bad = true; }
      if (!component)          { compEl.classList.add('invalid');  bad = true; }
      if (!type)               { typeEl.classList.add('invalid');  bad = true; }
      if (!description)        { descEl.classList.add('invalid');  bad = true; }
      if (description.length > CONFIG.LIMITS.DESCRIPTION_MAX) { descEl.classList.add('invalid'); bad = true; }
      if (bad) { setError('Merci de remplir tous les champs requis correctement.'); return; }

      busy = true;
      submitBtn.disabled = true; cancelBtn.disabled = true;
      submitBtn.innerHTML = `<span class="lf-spin"></span>${isEdit ? 'Saving…' : 'Publishing…'}`;

      try {
        // 1. Upload new screenshots
        let feedbackId = isEdit ? fb.id : uuid();
        const uploaded = [];
        if (newFiles.length) {
          await Promise.all(newFiles.map(async (file) => {
            const ext = (file.name.split('.').pop() || 'png').toLowerCase();
            const fname = `${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
            const path = `${session.user.id}/${feedbackId}/${fname}`;
            const { error: upErr } = await window.sb.storage.from(CONFIG.BUCKET).upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw upErr;
            const { data: pu } = window.sb.storage.from(CONFIG.BUCKET).getPublicUrl(path);
            uploaded.push({
              id: uuid(),
              url: pu.publicUrl,
              filename: file.name,
              size_bytes: file.size,
              uploaded_at: new Date().toISOString()
            });
          }));
        }
        const finalScreenshots = [...screenshots, ...uploaded];

        let row;
        if (isEdit) {
          const { data, error } = await window.sb.from('feedback')
            .update({
              title, component, type, description,
              screenshots: finalScreenshots
            })
            .eq('id', fb.id)
            .select('*').single();
          if (error) throw error;
          row = data;
        } else {
          const payload = {
            id: feedbackId,
            author_id: session.user.id,
            author_nickname: nickname,
            title, component, type, description,
            status: 'submitted',
            screenshots: finalScreenshots,
            status_history: [{
              status: 'submitted',
              at: new Date().toISOString(),
              by: session.user.id,
              by_nickname: nickname
            }]
          };
          const { data, error } = await window.sb.from('feedback').insert(payload).select('*').single();
          if (error) throw error;
          row = data;
        }

        showToast(isEdit ? 'Request updated!' : '🎉 Request published!');
        // Release the busy lock BEFORE close() — otherwise close() returns
        // early because of `if (busy) return;` and the modal stays open.
        busy = false;
        close();

        if (typeof opts.onSubmitted === 'function') opts.onSubmitted(row);
        if (typeof opts.onUpdated   === 'function') opts.onUpdated(row);

        // Redirect to feedback page if not already there (only on create)
        if (!isEdit) {
          const onFeedbackPage = /\/feedback\.html$/i.test(location.pathname) || location.pathname.endsWith('feedback.html');
          if (!onFeedbackPage) {
            sessionStorage.setItem('lf:newFeedbackId', row.id);
            window.location.href = 'feedback.html';
          } else {
            // Notify the page so it can animate the new card
            document.dispatchEvent(new CustomEvent('lazypo:feedback-created', { detail: row }));
          }
        }
      } catch (err) {
        console.error('[feedback]', err);
        setError(err.message || 'Erreur lors de la publication.');
        busy = false;
        submitBtn.disabled = false; cancelBtn.disabled = false;
        submitBtn.innerHTML = isEdit ? 'Save changes' : 'Publish';
      }
    });

    titleEl.focus();
  }

  function renderFormHTML({ isEdit, fb }) {
    const compsHtml = CONFIG.COMPONENTS.map(c =>
      `<option value="${esc(c.value)}" ${fb && fb.component === c.value ? 'selected' : ''}>${esc(c.label)}</option>`
    ).join('');
    const typesHtml = CONFIG.TYPES.map(t =>
      `<option value="${esc(t.value)}" ${fb && fb.type === t.value ? 'selected' : ''}>${esc(t.icon + ' ' + t.label)}</option>`
    ).join('');

    return `
      <div class="lf-modal" role="dialog" aria-modal="true">
        <div class="lf-modal-header">
          <div class="lf-modal-title">💡 ${isEdit ? 'Edit request' : 'New improvement request'}</div>
          <button class="lf-modal-close" aria-label="Close">×</button>
        </div>
        <div class="lf-modal-body">
          <div class="lf-field">
            <div class="lf-label">
              <span>Title</span>
              <span class="lf-counter" id="lfTitleCount">0/${CONFIG.LIMITS.TITLE_MAX}</span>
            </div>
            <input id="lfTitle" type="text" class="lf-input" maxlength="${CONFIG.LIMITS.TITLE_MAX}"
              placeholder="A short, clear summary"
              value="${esc(fb?.title || '')}">
          </div>

          <div class="lf-row">
            <div class="lf-field">
              <div class="lf-label"><span>Component</span></div>
              <select id="lfComponent" class="lf-select">
                <option value="" ${!fb ? 'selected' : ''}>— Select —</option>
                ${compsHtml}
              </select>
            </div>
            <div class="lf-field">
              <div class="lf-label"><span>Type</span></div>
              <select id="lfType" class="lf-select">
                <option value="" ${!fb ? 'selected' : ''}>— Select —</option>
                ${typesHtml}
              </select>
            </div>
          </div>

          <div class="lf-field">
            <div class="lf-label">
              <span>Description</span>
              <span class="lf-counter" id="lfDescCount">0/${CONFIG.LIMITS.DESCRIPTION_MAX}</span>
            </div>
            <textarea id="lfDescription" class="lf-textarea" maxlength="${CONFIG.LIMITS.DESCRIPTION_MAX}"
              placeholder="Soyez précis afin que le développeur sache quoi faire">${esc(fb?.description || '')}</textarea>
          </div>

          <div class="lf-field">
            <div class="lf-label"><span>Screenshots <span style="text-transform:none;font-weight:500;color:#555;">(optional, PNG/JPG, max ${CONFIG.LIMITS.SCREENSHOT_MAX_SIZE_MB}\u00a0Mo each, ${CONFIG.LIMITS.SCREENSHOT_MAX_COUNT} max)</span></span></div>
            <div class="lf-drop" id="lfDrop">
              <input type="file" id="lfFile" accept="image/png,image/jpeg" multiple>
              <div>📎 Drop images here or <strong>browse</strong></div>
            </div>
            <div class="lf-thumbs" id="lfThumbs"></div>
          </div>

          <div class="lf-error" id="lfErr" style="display:none;"></div>
        </div>
        <div class="lf-modal-footer">
          <button class="lf-btn lf-btn-secondary" id="lfCancel" type="button">Cancel</button>
          <button class="lf-btn lf-btn-primary"   id="lfSubmit" type="button">${isEdit ? 'Save changes' : 'Publish'}</button>
        </div>
      </div>
    `;
  }

  /* ─────────────────────── Public API ─────────────────────── */
  window.LazyFeedback = {
    __loaded: true,
    CONFIG,
    openSubmissionModal,
    editFeedback,
    statusLabel,
    typeLabel,
    typeIcon,
    componentLabel,
    showToast,
    esc,
    uuid
  };
})();
