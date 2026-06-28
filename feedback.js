/* ═══════════════════════════════════════════════════════════════════
   feedback.js — Logique de la page Feedback
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── State ── */
  const state = {
    session: null,
    profile: null,
    isAdmin: false,
    feedbacks: [],
    upvotedIds: new Set(),
    likedCommentIds: new Set(),
    view: 'all',
    filters: { status: '', component: '', type: '', sort: 'upvotes' },
    detailFeedback: null,
    detailComments: [],
    pendingNewId: sessionStorage.getItem('lf:newFeedbackId') || null
  };
  sessionStorage.removeItem('lf:newFeedbackId');

  /* Wait for LazyFeedback to be loaded (script order ensures it; safety net) */
  function ready(fn){
    if (window.LazyFeedback?.__loaded) return fn();
    setTimeout(() => ready(fn), 30);
  }

  ready(boot);

  async function boot() {
    state.session = await window.LazyAuth.requireAuth();
    if (!state.session) return;

    try {
      state.profile = await window.LazyAuth.getProfile(state.session.user.id);
    } catch (_) { state.profile = null; }
    state.isAdmin = !!state.profile?.is_admin;

    populateFilters();
    bindUI();
    await loadAll();

    document.addEventListener('lazypo:feedback-created', (e) => {
      const fb = e.detail;
      state.feedbacks.unshift(fb);
      state.pendingNewId = fb.id;
      switchView('all');
      render();
    });
  }

  /* ════════════════════════ UI BIND ════════════════════════ */
  function bindUI() {
    document.getElementById('btnNewRequest').addEventListener('click', () => {
      window.LazyFeedback.openSubmissionModal({
        onSubmitted: (fb) => {
          state.feedbacks.unshift(fb);
          state.pendingNewId = fb.id;
          switchView('all');
          render();
        }
      });
    });

    document.querySelectorAll('.fb-tab').forEach(t => {
      t.addEventListener('click', () => switchView(t.dataset.view));
    });

    ['filterStatus','filterComponent','filterType','filterSort'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        state.filters.status    = document.getElementById('filterStatus').value;
        state.filters.component = document.getElementById('filterComponent').value;
        state.filters.type      = document.getElementById('filterType').value;
        state.filters.sort      = document.getElementById('filterSort').value;
        render();
      });
    });

    document.getElementById('detailOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'detailOverlay') closeDetail();
    });
    document.getElementById('pickerOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'pickerOverlay') closePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.fb-lightbox')) { document.querySelector('.fb-lightbox').remove(); return; }
      if (document.getElementById('pickerOverlay').style.display !== 'none') closePicker();
      else if (document.getElementById('detailOverlay').classList.contains('open')) closeDetail();
    });
  }

  function populateFilters() {
    const C = window.LazyFeedback.CONFIG;
    const sStatus = document.getElementById('filterStatus');
    C.STATUSES.forEach(s => {
      const o = document.createElement('option');
      o.value = s.value; o.textContent = s.label;
      sStatus.appendChild(o);
    });
    const sComp = document.getElementById('filterComponent');
    C.COMPONENTS.forEach(c => {
      const o = document.createElement('option');
      o.value = c.value; o.textContent = c.label;
      sComp.appendChild(o);
    });
    const sType = document.getElementById('filterType');
    C.TYPES.forEach(t => {
      const o = document.createElement('option');
      o.value = t.value; o.textContent = `${t.icon} ${t.label}`;
      sType.appendChild(o);
    });
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.fb-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.getElementById('viewAll').hidden  = view !== 'all';
    document.getElementById('viewMine').hidden = view !== 'mine';
    render();
  }

  /* ════════════════════════ DATA LOAD ════════════════════════ */
  async function loadAll() {
    const sb = window.sb;

    const { data: feedbacks, error } = await sb
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[feedback] load error', error);
      document.getElementById('kanban').innerHTML = `<div class="fb-loading" style="color:#f87171;">Error: ${esc(error.message)}</div>`;
      return;
    }
    state.feedbacks = feedbacks || [];

    /* fetch user's upvotes */
    const { data: ups } = await sb
      .from('feedback_upvote')
      .select('feedback_id')
      .eq('user_id', state.session.user.id);
    state.upvotedIds = new Set((ups || []).map(u => u.feedback_id));

    render();
  }

  /* ════════════════════════ RENDER ════════════════════════ */
  function render() {
    if (state.view === 'all') renderKanban();
    else renderMyList();
  }

  function applyFilters(list) {
    const f = state.filters;
    let arr = list;
    if (f.status)    arr = arr.filter(x => x.status === f.status);
    if (f.component) arr = arr.filter(x => x.component === f.component);
    if (f.type)      arr = arr.filter(x => x.type === f.type);
    return arr;
  }

  function applySort(list) {
    const arr = [...list];
    switch (state.filters.sort) {
      case 'newest':   return arr.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      case 'oldest':   return arr.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      case 'comments': return arr.sort((a,b) => (b.comment_count||0) - (a.comment_count||0));
      case 'upvotes':
      default:         return arr.sort((a,b) => (b.upvote_count||0) - (a.upvote_count||0));
    }
  }

  function renderKanban() {
    const C = window.LazyFeedback.CONFIG;
    const filtered = applySort(applyFilters(state.feedbacks));
    const root = document.getElementById('kanban');
    root.innerHTML = '';

    C.KANBAN_COLUMNS.forEach(col => {
      const cards = filtered.filter(f => col.statuses.includes(f.status));
      const colEl = document.createElement('div');
      colEl.className = 'fb-col';
      colEl.dataset.col = col.id;
      colEl.innerHTML = `
        <div class="fb-col-header">
          <span>${col.icon} ${esc(col.label)}</span>
          <span>${cards.length}</span>
        </div>
        <div class="fb-col-cards" data-col-cards="${col.id}"></div>
      `;
      root.appendChild(colEl);
      const cardsEl = colEl.querySelector('.fb-col-cards');
      if (cards.length === 0) {
        cardsEl.innerHTML = `<div class="fb-col-empty">No requests here yet.</div>`;
      } else {
        cards.forEach(fb => cardsEl.appendChild(buildCard(fb)));
      }
      attachColumnDnD(colEl, col);
    });

    if (state.pendingNewId) {
      const card = root.querySelector(`.fb-card[data-id="${state.pendingNewId}"]`);
      if (card) {
        card.classList.add('fresh');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      state.pendingNewId = null;
    }
  }

  function buildCard(fb) {
    const C = window.LazyFeedback.CONFIG;
    const draggable = state.isAdmin;
    const card = document.createElement('div');
    card.className = 'fb-card';
    card.dataset.id = fb.id;
    card.dataset.status = fb.status;
    card.dataset.draggable = String(draggable);
    if (draggable) card.draggable = true;

    const upvoted = state.upvotedIds.has(fb.id);
    const inProgress = ['accepted','ongoing','postponed','blocked'].includes(fb.status);
    const handled = ['done','refused'].includes(fb.status);

    card.innerHTML = `
      <div class="fb-card-title-row">
        <span class="fb-card-type-icon">${esc(window.LazyFeedback.typeIcon(fb.type))}</span>
        <div class="fb-card-title">${esc(truncate(fb.title, 60))}</div>
      </div>
      <div class="fb-card-meta">
        <span class="fb-pill component">${esc(window.LazyFeedback.componentLabel(fb.component))}</span>
        ${(inProgress || handled) ? `<span class="fb-pill status-${esc(fb.status)}">${esc(window.LazyFeedback.statusLabel(fb.status))}</span>` : ''}
      </div>
      <div class="fb-card-author">${esc(fb.author_nickname)} · ${esc(relTime(fb.created_at))}</div>
      <div class="fb-card-bottom">
        <span class="fb-card-stat ${upvoted ? 'upvoted' : ''}">👍 ${fb.upvote_count || 0}</span>
        <span class="fb-card-stat">💬 ${fb.comment_count || 0}</span>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (card.classList.contains('dragging')) return;
      openDetail(fb.id);
    });

    if (draggable) {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', fb.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    }
    return card;
  }

  function attachColumnDnD(colEl, col) {
    if (!state.isAdmin) return;
    colEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      colEl.classList.add('drag-target');
    });
    colEl.addEventListener('dragleave', (e) => {
      if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('drag-target');
    });
    colEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      colEl.classList.remove('drag-target');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const fb = state.feedbacks.find(x => x.id === id);
      if (!fb) return;
      if (col.statuses.includes(fb.status)) return; // same column
      handleColumnDrop(fb, col);
    });
  }

  function renderMyList() {
    const list = state.feedbacks
      .filter(f => f.author_id === state.session.user.id)
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const root = document.getElementById('mylist');
    root.innerHTML = '';
    if (list.length === 0) {
      root.innerHTML = `
        <div class="fb-empty">
          <h3>You haven't submitted any requests yet</h3>
          <p>Spotted a bug or have an idea? Click below to share it.</p>
          <button class="btn-new" onclick="document.getElementById('btnNewRequest').click()">＋ New request</button>
        </div>`;
      return;
    }
    list.forEach(fb => {
      const c = document.createElement('div');
      c.className = 'fb-mycard';
      const editable = isWithinEditWindow(fb);
      c.innerHTML = `
        <div class="fb-mycard-main" data-id="${esc(fb.id)}">
          <div class="fb-mycard-title">${esc(window.LazyFeedback.typeIcon(fb.type))} ${esc(fb.title)}</div>
          <div class="fb-mycard-meta">
            <span class="fb-pill status-${esc(fb.status)}">${esc(window.LazyFeedback.statusLabel(fb.status))}</span>
            <span class="fb-pill component">${esc(window.LazyFeedback.componentLabel(fb.component))}</span>
            <span class="fb-pill">👍 ${fb.upvote_count||0}</span>
            <span class="fb-pill">💬 ${fb.comment_count||0}</span>
            <span style="font-size:11px;color:var(--muted);">${esc(relTime(fb.created_at))}</span>
          </div>
        </div>
        <div class="fb-mycard-actions">
          ${editable ? `<button class="fb-icon-btn" data-edit="${esc(fb.id)}" title="Edit (within 1h of publication)">✏️</button>` : ''}
          <button class="fb-icon-btn danger" data-del="${esc(fb.id)}" title="Delete">🗑️</button>
        </div>
      `;
      root.appendChild(c);
      c.querySelector('.fb-mycard-main').addEventListener('click', () => openDetail(fb.id));
      c.querySelector('[data-del]')?.addEventListener('click', () => deleteFeedback(fb));
      c.querySelector('[data-edit]')?.addEventListener('click', () => editFeedback(fb));
    });
  }

  function isWithinEditWindow(fb) {
    if (fb.author_id !== state.session.user.id && !state.isAdmin) return false;
    const ageMs = Date.now() - new Date(fb.created_at).getTime();
    return ageMs < 60 * 60 * 1000;
  }

  function editFeedback(fb) {
    if (!isWithinEditWindow(fb)) {
      window.LazyFeedback.showToast('Edit window expired (1h after publication).', { error: true });
      return;
    }
    window.LazyFeedback.editFeedback({
      feedback: fb,
      onUpdated: (row) => {
        const i = state.feedbacks.findIndex(x => x.id === row.id);
        if (i >= 0) state.feedbacks[i] = row;
        render();
      }
    });
  }

  async function deleteFeedback(fb) {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    const { error } = await window.sb.from('feedback').delete().eq('id', fb.id);
    if (error) { window.LazyFeedback.showToast(error.message, { error: true }); return; }
    state.feedbacks = state.feedbacks.filter(x => x.id !== fb.id);
    if (state.detailFeedback?.id === fb.id) closeDetail();
    render();
    window.LazyFeedback.showToast('Request deleted.');
  }

  /* ════════════════════════ DETAIL MODAL ════════════════════════ */
  async function openDetail(feedbackId) {
    const fb = state.feedbacks.find(x => x.id === feedbackId);
    if (!fb) return;
    state.detailFeedback = fb;
    state.detailComments = [];
    document.getElementById('detailOverlay').classList.add('open');
    renderDetail(fb);

    const { data: comments } = await window.sb
      .from('feedback_comment')
      .select('*')
      .eq('feedback_id', fb.id)
      .order('created_at', { ascending: true });
    state.detailComments = comments || [];

    const { data: likes } = await window.sb
      .from('feedback_comment_like')
      .select('comment_id')
      .eq('user_id', state.session.user.id)
      .in('comment_id', state.detailComments.map(c => c.id).length ? state.detailComments.map(c => c.id) : ['00000000-0000-0000-0000-000000000000']);
    state.likedCommentIds = new Set((likes || []).map(l => l.comment_id));

    renderDetailComments();
  }

  function closeDetail() {
    document.getElementById('detailOverlay').classList.remove('open');
    state.detailFeedback = null;
    state.detailComments = [];
  }

  function renderDetail(fb) {
    const C = window.LazyFeedback.CONFIG;
    const upvoted = state.upvotedIds.has(fb.id);
    const inProgressOrHandled = !['submitted'].includes(fb.status);
    const shotsHTML = (fb.screenshots || []).map(s =>
      `<div class="fb-shot" data-url="${esc(s.url)}"><img src="${esc(s.url)}" alt="${esc(s.filename||'')}"></div>`
    ).join('');
    const historyHTML = (fb.status_history || []).map(h => `
      <div class="fb-history-item">
        <span class="fb-history-dot"></span>
        <span><strong style="color:var(--text);">${esc(window.LazyFeedback.statusLabel(h.status))}</strong>${h.by_nickname ? ` · by ${esc(h.by_nickname)}` : ''} · ${esc(relTime(h.at))}</span>
      </div>`).join('');

    const refusalHTML = fb.status === 'refused' && fb.refusal_reason
      ? `<div class="fb-detail-section">
           <div class="fb-refusal"><strong>Refused</strong>${esc(fb.refusal_reason)}</div>
         </div>` : '';

    const adminHTML = state.isAdmin ? `
      <div class="fb-admin-panel">
        <h4>🛡️ Admin actions</h4>
        <div class="fb-admin-row">
          <div class="lf-field" style="display:flex;flex-direction:column;gap:6px;">
            <label class="fb-filter-label">Status</label>
            <select class="fb-select" id="adminStatus">
              ${C.STATUSES.map(s => `<option value="${esc(s.value)}" ${s.value===fb.status?'selected':''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
          <div class="lf-field" style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:200px;">
            <label class="fb-filter-label">Refusal reason (if Refused)</label>
            <textarea class="fb-comment-input" id="adminReason" style="min-height:40px;" placeholder="Required when status = Refused">${esc(fb.refusal_reason || '')}</textarea>
          </div>
          <button class="fb-admin-save" id="adminSave">Save</button>
        </div>
      </div>` : '';

    const isOwner = fb.author_id === state.session.user.id;
    const editBtn = isOwner && isWithinEditWindow(fb)
      ? `<button class="fb-icon-btn" id="detailEdit" title="Edit (within 1h)">✏️</button>` : '';
    const delBtn  = (isOwner || state.isAdmin)
      ? `<button class="fb-icon-btn danger" id="detailDel" title="Delete">🗑️</button>` : '';

    const html = `
      <div class="fb-detail-header">
        <div class="fb-detail-top">
          <div class="fb-detail-title">${esc(window.LazyFeedback.typeIcon(fb.type))} ${esc(fb.title)}</div>
          <div class="fb-detail-actions">
            <button class="fb-upvote-btn ${upvoted?'active':''}" id="detailUpvote">👍 <span id="upvoteCount">${fb.upvote_count||0}</span></button>
            ${editBtn}
            ${delBtn}
            <button class="fb-detail-close" id="detailClose">×</button>
          </div>
        </div>
        <div class="fb-detail-meta-row">
          <span class="fb-pill component">${esc(window.LazyFeedback.componentLabel(fb.component))}</span>
          <span class="fb-pill">${esc(window.LazyFeedback.typeLabel(fb.type))}</span>
          <span class="fb-pill status-${esc(fb.status)}">${esc(window.LazyFeedback.statusLabel(fb.status))}</span>
        </div>
        <div class="fb-detail-author">By <strong>${esc(fb.author_nickname)}</strong> · ${esc(relTime(fb.created_at))}</div>
      </div>
      <div class="fb-detail-body">
        <div class="fb-detail-section">
          <h4>Description</h4>
          <div class="fb-description">${esc(fb.description)}</div>
        </div>

        ${shotsHTML ? `
        <div class="fb-detail-section">
          <h4>Screenshots</h4>
          <div class="fb-shots">${shotsHTML}</div>
        </div>` : ''}

        ${(fb.status_history || []).length ? `
        <div class="fb-detail-section">
          <h4>Status history</h4>
          <div class="fb-history">${historyHTML}</div>
        </div>` : ''}

        ${refusalHTML}

        ${adminHTML}

        <div class="fb-detail-section">
          <h4>💬 Comments (<span id="commentCount">${fb.comment_count||0}</span>)</h4>
          <div class="fb-comments-list" id="commentsList">
            <div class="fb-loading" style="padding:14px;">Loading…</div>
          </div>
          <div class="fb-comment-input-wrap">
            <textarea class="fb-comment-input" id="commentInput" maxlength="${C.LIMITS.COMMENT_MAX}" placeholder="Write a comment… use @nickname to ping"></textarea>
            <div class="fb-comment-row">
              <span class="fb-comment-counter" id="commentCounter">0/${C.LIMITS.COMMENT_MAX}</span>
              <button class="fb-comment-post" id="commentPost">Post</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('detailBody').innerHTML = html;

    /* bind */
    document.getElementById('detailClose').addEventListener('click', closeDetail);
    document.getElementById('detailUpvote').addEventListener('click', () => toggleUpvote(fb));
    document.getElementById('detailEdit')?.addEventListener('click', () => editFeedback(fb));
    document.getElementById('detailDel')?.addEventListener('click', () => deleteFeedback(fb));

    /* shots → lightbox */
    document.querySelectorAll('#detailBody .fb-shot').forEach(el => {
      el.addEventListener('click', () => openLightbox(el.dataset.url));
    });

    const ci = document.getElementById('commentInput');
    const cc = document.getElementById('commentCounter');
    ci.addEventListener('input', () => {
      const n = ci.value.length;
      cc.textContent = `${n}/${C.LIMITS.COMMENT_MAX}`;
      cc.classList.toggle('over', n > C.LIMITS.COMMENT_MAX);
    });
    document.getElementById('commentPost').addEventListener('click', () => postComment(fb));

    if (state.isAdmin) {
      document.getElementById('adminSave').addEventListener('click', () => adminSave(fb));
    }
  }

  function renderDetailComments() {
    const list = document.getElementById('commentsList');
    if (!list) return;
    if (state.detailComments.length === 0) {
      list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:6px 4px;">No comments yet — be the first.</div>`;
      return;
    }
    list.innerHTML = '';
    state.detailComments.forEach(c => list.appendChild(buildComment(c)));
  }

  function buildComment(c) {
    const liked = state.likedCommentIds.has(c.id);
    const isOwner = c.author_id === state.session.user.id;
    const canModify = isOwner || state.isAdmin;
    const el = document.createElement('div');
    el.className = 'fb-comment';
    el.dataset.id = c.id;
    el.innerHTML = `
      <div class="fb-comment-head">
        <span class="fb-comment-author">${esc(c.author_nickname)}</span>
        ${c.is_admin_comment ? `<span class="fb-admin-badge">Admin</span>` : ''}
        <span class="fb-comment-time">· ${esc(relTime(c.created_at))}${c.edited_at ? ' · edited' : ''}</span>
      </div>
      <div class="fb-comment-body">${renderMentions(c.body)}</div>
      <div class="fb-comment-bottom">
        <button class="fb-like-btn ${liked?'active':''}" data-act="like">👍 <span>${c.like_count||0}</span></button>
        ${canModify ? `<button class="fb-comment-edit" data-act="edit">✏️ Edit</button>` : ''}
        ${canModify ? `<button class="fb-comment-del"  data-act="del">🗑️ Delete</button>` : ''}
      </div>
    `;
    el.querySelector('[data-act="like"]').addEventListener('click', () => toggleCommentLike(c, el));
    el.querySelector('[data-act="edit"]')?.addEventListener('click', () => editComment(c, el));
    el.querySelector('[data-act="del"]')?.addEventListener('click', () => deleteComment(c));
    return el;
  }

  function renderMentions(text) {
    return esc(text).replace(/@([A-Za-z0-9_\-\.]+)/g, '<span class="fb-mention">@$1</span>');
  }

  /* ════════════════════════ ACTIONS ════════════════════════ */
  async function toggleUpvote(fb) {
    const userId = state.session.user.id;
    const isUp = state.upvotedIds.has(fb.id);
    const btn = document.getElementById('detailUpvote');
    const cnt = document.getElementById('upvoteCount');
    btn.disabled = true;
    try {
      if (isUp) {
        const { error } = await window.sb.from('feedback_upvote').delete().eq('feedback_id', fb.id).eq('user_id', userId);
        if (error) throw error;
        state.upvotedIds.delete(fb.id);
        fb.upvote_count = Math.max(0, (fb.upvote_count||0) - 1);
        btn.classList.remove('active');
      } else {
        const { error } = await window.sb.from('feedback_upvote').insert({ feedback_id: fb.id, user_id: userId });
        if (error) throw error;
        state.upvotedIds.add(fb.id);
        fb.upvote_count = (fb.upvote_count||0) + 1;
        btn.classList.add('active');
      }
      cnt.textContent = fb.upvote_count;
      // Update list view
      render();
    } catch (e) {
      window.LazyFeedback.showToast(e.message || 'Could not update vote.', { error: true });
    } finally {
      btn.disabled = false;
    }
  }

  async function postComment(fb) {
    const ci = document.getElementById('commentInput');
    const C = window.LazyFeedback.CONFIG;
    const body = ci.value.trim();
    if (!body) return;
    if (body.length > C.LIMITS.COMMENT_MAX) {
      window.LazyFeedback.showToast(`Comment too long (max ${C.LIMITS.COMMENT_MAX}).`, { error: true });
      return;
    }
    const btn = document.getElementById('commentPost');
    btn.disabled = true;
    try {
      const nickname = state.profile?.username || state.session.user.email?.split('@')[0] || 'User';
      const { data, error } = await window.sb
        .from('feedback_comment')
        .insert({
          feedback_id: fb.id,
          author_id: state.session.user.id,
          author_nickname: nickname,
          is_admin_comment: state.isAdmin,
          body
        }).select('*').single();
      if (error) throw error;
      state.detailComments.push(data);
      fb.comment_count = (fb.comment_count||0) + 1;
      ci.value = '';
      document.getElementById('commentCounter').textContent = `0/${C.LIMITS.COMMENT_MAX}`;
      document.getElementById('commentCount').textContent = fb.comment_count;
      renderDetailComments();
      render();
    } catch (e) {
      window.LazyFeedback.showToast(e.message || 'Could not post comment.', { error: true });
    } finally {
      btn.disabled = false;
    }
  }

  async function toggleCommentLike(c, el) {
    const userId = state.session.user.id;
    const liked = state.likedCommentIds.has(c.id);
    const btn = el.querySelector('[data-act="like"]');
    const span = btn.querySelector('span');
    btn.disabled = true;
    try {
      if (liked) {
        const { error } = await window.sb.from('feedback_comment_like').delete().eq('comment_id', c.id).eq('user_id', userId);
        if (error) throw error;
        state.likedCommentIds.delete(c.id);
        c.like_count = Math.max(0, (c.like_count||0) - 1);
        btn.classList.remove('active');
      } else {
        const { error } = await window.sb.from('feedback_comment_like').insert({ comment_id: c.id, user_id: userId });
        if (error) throw error;
        state.likedCommentIds.add(c.id);
        c.like_count = (c.like_count||0) + 1;
        btn.classList.add('active');
      }
      span.textContent = c.like_count;
    } catch (e) {
      window.LazyFeedback.showToast(e.message || 'Could not toggle like.', { error: true });
    } finally {
      btn.disabled = false;
    }
  }

  async function editComment(c, el) {
    const newBody = prompt('Edit comment:', c.body);
    if (newBody == null) return;
    const trimmed = newBody.trim();
    if (!trimmed) return;
    if (trimmed.length > window.LazyFeedback.CONFIG.LIMITS.COMMENT_MAX) {
      window.LazyFeedback.showToast('Comment too long.', { error: true }); return;
    }
    const { data, error } = await window.sb
      .from('feedback_comment')
      .update({ body: trimmed })
      .eq('id', c.id)
      .select('*').single();
    if (error) { window.LazyFeedback.showToast(error.message, { error: true }); return; }
    Object.assign(c, data);
    renderDetailComments();
  }

  async function deleteComment(c) {
    if (!confirm('Delete this comment?')) return;
    const { error } = await window.sb.from('feedback_comment').delete().eq('id', c.id);
    if (error) { window.LazyFeedback.showToast(error.message, { error: true }); return; }
    state.detailComments = state.detailComments.filter(x => x.id !== c.id);
    if (state.detailFeedback) {
      state.detailFeedback.comment_count = Math.max(0, (state.detailFeedback.comment_count||0) - 1);
      const cnt = document.getElementById('commentCount');
      if (cnt) cnt.textContent = state.detailFeedback.comment_count;
    }
    renderDetailComments();
    render();
  }

  /* ════════════════════════ ADMIN ════════════════════════ */
  async function adminSave(fb) {
    const btn = document.getElementById('adminSave');
    const newStatus = document.getElementById('adminStatus').value;
    const reason = document.getElementById('adminReason').value.trim();
    if (newStatus === 'refused' && !reason) {
      window.LazyFeedback.showToast('Refusal reason is required.', { error: true });
      return;
    }
    if (btn) {
      if (btn.dataset.busy === '1') return; // already saving
      btn.dataset.busy = '1';
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    const payload = { status: newStatus };
    payload.refusal_reason = newStatus === 'refused' ? reason : null;
    try {
      const { data, error } = await window.sb.from('feedback')
        .update(payload).eq('id', fb.id).select('*').single();
      if (error) {
        console.error('[feedback] adminSave update error:', error, 'payload:', payload, 'fb.id:', fb.id);
        window.LazyFeedback.showToast(
          (error.code ? `[${error.code}] ` : '') + (error.message || 'Update failed.'),
          { error: true }
        );
        return;
      }
      if (!data) {
        console.error('[feedback] adminSave: no row returned (RLS or missing id?)', { fbId: fb.id, payload });
        window.LazyFeedback.showToast('Update silently failed — no row returned (RLS?).', { error: true });
        return;
      }
      Object.assign(fb, data);
      state.detailFeedback = fb;
      renderDetail(fb);
      renderDetailComments();
      render();
      window.LazyFeedback.showToast('Updated.');
    } catch (e) {
      console.error('[feedback] adminSave threw:', e);
      window.LazyFeedback.showToast(e?.message || 'Unexpected error.', { error: true });
    } finally {
      // The original button is gone after renderDetail(), but if we returned
      // before re-rendering (error path), the same button is still around.
      const stillThere = document.getElementById('adminSave');
      if (stillThere) {
        stillThere.dataset.busy = '';
        stillThere.disabled = false;
        stillThere.textContent = 'Save';
      }
    }
  }

  /* ════════════════════════ DnD HANDLERS ════════════════════════ */
  function handleColumnDrop(fb, col) {
    if (col.id === 'in_progress') {
      openPicker({
        title: `Move "${truncate(fb.title, 40)}" to In progress`,
        options: [
          { value: 'accepted',  label: 'Accepted' },
          { value: 'ongoing',   label: 'Ongoing' },
          { value: 'postponed', label: 'Postponed' },
          { value: 'blocked',   label: 'Blocked' }
        ],
        onPick: (status) => updateFeedbackStatus(fb, status)
      });
    } else if (col.id === 'handled') {
      openPicker({
        title: `Move "${truncate(fb.title, 40)}" to Handled`,
        options: [
          { value: 'done',    label: 'Done' },
          { value: 'refused', label: 'Refused', requireReason: true }
        ],
        onPick: (status, reason) => updateFeedbackStatus(fb, status, reason)
      });
    } else if (col.id === 'new') {
      if (confirm('Move back to New? This will reset the status.')) {
        updateFeedbackStatus(fb, 'submitted');
      }
    }
  }

  function openPicker({ title, options, onPick }) {
    const overlay = document.getElementById('pickerOverlay');
    const body = document.getElementById('pickerBody');
    overlay.style.display = 'flex';
    let chosen = null;
    function render() {
      body.innerHTML = `
        <h3>${esc(title)}</h3>
        <div class="fb-picker-options">
          ${options.map(o => `<button class="fb-picker-opt" data-v="${esc(o.value)}" ${chosen===o.value?'style="border-color:var(--accent);background:rgba(59,130,246,0.1);"':''}>${esc(o.label)}${o.requireReason ? ' <span style="font-weight:500;color:var(--muted);">(reason required)</span>' : ''}</button>`).join('')}
        </div>
        ${chosen && options.find(o => o.value === chosen)?.requireReason ? `
          <textarea class="fb-picker-textarea" id="pickerReason" placeholder="Refusal reason (required)"></textarea>` : ''}
        <div class="fb-picker-actions">
          <button class="fb-picker-btn cancel" id="pickerCancel">Cancel</button>
          <button class="fb-picker-btn save"   id="pickerSave" ${!chosen?'disabled style="opacity:0.5;cursor:not-allowed;"':''}>Confirm</button>
        </div>
      `;
      body.querySelectorAll('.fb-picker-opt').forEach(b => {
        b.addEventListener('click', () => { chosen = b.dataset.v; render(); });
      });
      body.querySelector('#pickerCancel').addEventListener('click', closePicker);
      body.querySelector('#pickerSave').addEventListener('click', () => {
        if (!chosen) return;
        const opt = options.find(o => o.value === chosen);
        const reason = opt?.requireReason ? body.querySelector('#pickerReason')?.value.trim() : null;
        if (opt?.requireReason && !reason) {
          window.LazyFeedback.showToast('Reason is required.', { error: true });
          return;
        }
        closePicker();
        onPick(chosen, reason);
      });
    }
    render();
  }

  function closePicker() {
    document.getElementById('pickerOverlay').style.display = 'none';
    document.getElementById('pickerBody').innerHTML = '';
  }

  async function updateFeedbackStatus(fb, status, refusal_reason = null) {
    const payload = { status };
    payload.refusal_reason = status === 'refused' ? refusal_reason : null;
    try {
      const { data, error } = await window.sb.from('feedback')
        .update(payload).eq('id', fb.id).select('*').single();
      if (error) {
        console.error('[feedback] updateFeedbackStatus error:', error, 'payload:', payload, 'fb.id:', fb.id);
        window.LazyFeedback.showToast(
          (error.code ? `[${error.code}] ` : '') + (error.message || 'Status update failed.'),
          { error: true }
        );
        return;
      }
      if (!data) {
        console.error('[feedback] updateFeedbackStatus: no row returned', { fbId: fb.id, payload });
        window.LazyFeedback.showToast('Status update silently failed — no row returned (RLS?).', { error: true });
        return;
      }
      Object.assign(fb, data);
      if (state.detailFeedback?.id === fb.id) {
        state.detailFeedback = fb;
        renderDetail(fb);
        renderDetailComments();
      }
      render();
      window.LazyFeedback.showToast(`Moved to ${window.LazyFeedback.statusLabel(status)}.`);
    } catch (e) {
      console.error('[feedback] updateFeedbackStatus threw:', e);
      window.LazyFeedback.showToast(e?.message || 'Unexpected error.', { error: true });
    }
  }

  /* ════════════════════════ Lightbox ════════════════════════ */
  function openLightbox(url) {
    const el = document.createElement('div');
    el.className = 'fb-lightbox';
    el.innerHTML = `<img src="${esc(url)}" alt="">`;
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }

  /* ════════════════════════ Helpers ════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function relTime(d) {
    const t = new Date(d).getTime();
    if (Number.isNaN(t)) return '';
    const diff = (Date.now() - t) / 1000;
    if (diff < 45)        return 'just now';
    if (diff < 90)        return '1 min ago';
    if (diff < 3600)      return `${Math.round(diff/60)} min ago`;
    if (diff < 5400)      return '1 h ago';
    if (diff < 86400)     return `${Math.round(diff/3600)} h ago`;
    if (diff < 172800)    return 'yesterday';
    if (diff < 2592000)   return `${Math.round(diff/86400)} days ago`;
    if (diff < 5184000)   return '1 month ago';
    if (diff < 31536000)  return `${Math.round(diff/2592000)} months ago`;
    return `${Math.round(diff/31536000)} years ago`;
  }
})();
