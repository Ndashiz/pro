/**
 * pi.js — the Program Increment, once, for the whole tool.
 *
 * LazyPO used to carry three PI definitions that never spoke to each other:
 * gantt.html kept one in `lazypo_gantt_v1`, jira_dashboard.html kept another in
 * `jiraDashboardPI_v1`, and sprintplanner.html read two DOM inputs that died on
 * reload. This module owns the single definition every page reads from.
 *
 * Loading priority — the same shape as countdown.js:
 *  1. localStorage `lazypo_pi_v1`  (synchronous, rendered immediately)
 *  2. Supabase `profiles.pi`       (replaces it as soon as auth is ready)
 *
 * Migration Supabase (run once, by hand, in the SQL editor — see pi_schema.sql):
 *  ALTER TABLE public.profiles
 *    ADD COLUMN IF NOT EXISTS pi jsonb NOT NULL DEFAULT '{}'::jsonb;
 *
 * ── Two constraints this file must keep ──────────────────────────────────
 *  1. `get()` is SYNCHRONOUS and never returns null. gantt.html runs
 *     `load(); renderAll();` at parse time, before auth.js even exists.
 *     Remote data arrives later and re-broadcasts `lazypo:pi`.
 *  2. Never write the string "LazyAuth" + ".requireModule(" contiguously in
 *     this file. gantt.html's standalone export inlines pi.js and strips any
 *     script containing that marker — it would delete itself.
 */
(function () {
  'use strict';

  var STORE_KEY = 'lazypo_pi_v1';
  var DAY       = 86400000;
  var SAVE_WAIT = 1200;

  /* Legacy stores we adopt on first run, richest first. */
  var LEGACY_GANTT = 'lazypo_gantt_v1';
  var LEGACY_DASH  = 'jiraDashboardPI_v1';

  /* ═══════════════════════════════════════════════════
     DATE HELPERS
     Dates are plain 'YYYY-MM-DD' strings everywhere; Date objects only
     exist inside these helpers and inside render code. Never store
     toISOString() output — it shifts by timezone.
  ═══════════════════════════════════════════════════ */
  function parseD(s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : s;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  function isoD(d) {
    if (!d) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function today() { var n = new Date(); n.setHours(0, 0, 0, 0); return n; }
  /** Whole days from a to b. Both are midnight-local, so no DST fractions. */
  function daysBetween(a, b) { return Math.round((b - a) / DAY); }

  function uid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* older Safari */ }
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  /* ═══════════════════════════════════════════════════
     THE SHAPE
  ═══════════════════════════════════════════════════ */
  function DEFAULT() {
    return {
      v: 1,
      name: '',
      start: '',
      end: '',            // last day of the PI, INCLUSIVE (what a human types)
      sprintLen: 14,
      releases: [],       // {id, name, date}
      features: [],       // {id, key, name, description, benefits[], fixVersion, epic, epicKey, order, source, offset}
      testing: [],        // {id, label, start, end}
      off: [],            // {id, name, reason, start, end}
      sprintMeta: {},     // { "<index>": {...} } — keyed by numeric sprint index
      fileName: '',
      updatedAt: ''
    };
  }

  /* Fill in anything a stored/imported PI is missing, so callers can index
     freely without guarding every array. Mutates and returns `pi`. */
  function normalise(pi) {
    var d = DEFAULT();
    if (!pi || typeof pi !== 'object') return d;
    Object.keys(d).forEach(function (k) {
      if (pi[k] === undefined || pi[k] === null) pi[k] = d[k];
    });
    ['releases', 'features', 'testing', 'off'].forEach(function (k) {
      if (!Array.isArray(pi[k])) pi[k] = [];
    });
    if (typeof pi.sprintMeta !== 'object' || Array.isArray(pi.sprintMeta)) pi.sprintMeta = {};
    pi.sprintLen = Number(pi.sprintLen) || 14;

    pi.releases.forEach(function (r) {
      if (!r.id) r.id = uid();
      r.name = String(r.name == null ? '' : r.name);
      r.date = String(r.date == null ? '' : r.date);
    });
    pi.features.forEach(function (f, i) {
      if (!f.id) f.id = uid();
      // gantt.html called it `title`; the PI calls it `name`.
      if (f.name == null && f.title != null) f.name = f.title;
      f.name        = String(f.name == null ? '' : f.name);
      f.key         = String(f.key == null ? '' : f.key);
      f.description = String(f.description == null ? '' : f.description);
      f.fixVersion  = String(f.fixVersion == null ? '' : f.fixVersion);
      f.epic        = String(f.epic == null ? '' : f.epic);
      f.epicKey     = String(f.epicKey == null ? '' : f.epicKey);
      // benefits is always an array — lazypo_generator.html calls .map() on it
      // unguarded and a scalar would blank the whole form.
      if (!Array.isArray(f.benefits)) {
        f.benefits = f.benefits ? splitBenefits(f.benefits) : [];
      }
      f.source = (f.source === 'manual' || f.source === 'jira') ? f.source : 'manual';
      f.order  = Number.isFinite(f.order) ? f.order : i;
      f.offset = Number(f.offset) || 0;
    });
    return pi;
  }

  /** "a, b; c" → ['a','b','c'] — the lazypo_generator.html:534 convention. */
  function splitBenefits(raw) {
    return String(raw == null ? '' : raw)
      .split(/[,;|]|\r?\n/)
      .map(function (b) { return b.trim(); })
      .filter(Boolean);
  }

  /* ═══════════════════════════════════════════════════
     SPRINT GRID  (derived, never stored)
  ═══════════════════════════════════════════════════ */

  /** The exclusive upper bound of the PI: the day after the last day. */
  function endExclusive(pi) {
    var e = parseD(pi && pi.end);
    return e ? addDays(e, 1) : null;
  }

  /**
   * Sprints tile the window from `start`, one every `sprintLen` days.
   * `end` is EXCLUSIVE on each sprint; `endInclusive` is the last working
   * day, which is what you print. The final sprint is clipped to the PI end
   * when the window doesn't divide evenly — sprintFit() reports that.
   */
  function buildSprints(pi) {
    pi = pi || get();
    var s = parseD(pi.start), e = endExclusive(pi);
    if (!s || !e || e <= s) return [];
    var len = Number(pi.sprintLen) || 14;
    var out = [], cur = s, i = 0;
    while (cur < e && i < 60) {
      var end = addDays(cur, len);
      if (end > e) end = e;
      out.push({
        index: i,
        name: 'S' + (i + 1),
        start: cur,
        end: end,                      // exclusive
        endInclusive: addDays(end, -1),
        days: daysBetween(cur, end),
        partial: daysBetween(cur, end) !== len
      });
      cur = end; i++;
    }
    return out;
  }

  /**
   * Does the window divide into whole sprints? §3.2 of the spec: a PI is
   * normally a whole number of sprints, so we flag it rather than round.
   */
  function sprintFit(pi) {
    pi = pi || get();
    var s = parseD(pi.start), e = parseD(pi.end);
    var len = Number(pi.sprintLen) || 14;
    if (!s || !e || e < s) {
      return { valid: false, totalDays: 0, sprintCount: 0, whole: true, remainderDays: 0, len: len };
    }
    var totalDays = daysBetween(s, e) + 1;          // inclusive of both ends
    var full      = Math.floor(totalDays / len);
    var remainder = totalDays % len;
    return {
      valid: true,
      totalDays: totalDays,
      sprintCount: remainder ? full + 1 : full,
      fullSprints: full,
      whole: remainder === 0,
      remainderDays: remainder,
      len: len,
      /** The end date that would make the PI whole (round up to the next sprint). */
      suggestedEnd: remainder ? isoD(addDays(s, (full + 1) * len - 1)) : isoD(e)
    };
  }

  /** Sprint containing a date, clamped into the grid. -1 when there is no grid. */
  function sprintIndexOf(date, pi) {
    var sprints = Array.isArray(pi) ? pi : buildSprints(pi);
    var d = parseD(date);
    if (!sprints.length || !d) return -1;
    for (var i = 0; i < sprints.length; i++) {
      if (d >= sprints[i].start && d < sprints[i].end) return i;
    }
    return d < sprints[0].start ? 0 : sprints.length - 1;
  }

  /**
   * Where a feature has to land to make its release train: the sprint
   * immediately before the release. Matches gantt.html's semantics so its
   * stored `offset` values keep meaning the same thing.
   */
  function defaultSprintIndex(releaseDate, pi) {
    var i = sprintIndexOf(releaseDate, pi);
    if (i < 0) return -1;
    return Math.max(0, i - 1);
  }

  /* ═══════════════════════════════════════════════════
     FIX VERSION → RELEASE
     Same resolution ladder as the Scope of Work importer
     (lazypo_generator.html:445 matchRelease): exact name first, then the
     month / quarter / date tokens, EN + FR, accent-insensitive.
  ═══════════════════════════════════════════════════ */
  var MONTHS_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  var MONTHS_FR = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];

  function deburr(s) {
    var str = String(s == null ? '' : s);
    return str.normalize ? str.normalize('NFD').replace(/[̀-ͯ]/g, '') : str;
  }
  function canon(s) { return deburr(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  /** Month (0-11) and year mentioned in a free-text fix version, or null. */
  function parseFixMonth(raw) {
    var s = canon(raw);
    if (!s) return null;
    var month = -1;
    for (var i = 0; i < 12; i++) {
      // 3-letter stem catches "Apr", "avr.", "September 26"
      var en = MONTHS_EN[i], fr = MONTHS_FR[i];
      if (s.indexOf(en) !== -1 || s.indexOf(fr) !== -1 ||
          new RegExp('\\b' + en.slice(0, 3) + '\\b').test(s) ||
          new RegExp('\\b' + fr.slice(0, 3) + '\\b').test(s)) { month = i; break; }
    }
    var ym = /\b(20\d{2})\b/.exec(s) || /\b(\d{2})['’]?\b/.exec(s);
    var year = null;
    if (ym) { year = +ym[1]; if (year < 100) year += 2000; }

    // Numeric forms: 2026-04, 04/2026, 16/04/26
    if (month < 0) {
      var iso = /\b(20\d{2})[-\/](\d{1,2})\b/.exec(s);
      if (iso) { year = +iso[1]; month = +iso[2] - 1; }
    }
    if (month < 0) {
      var dmy = /\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})\b/.exec(s);
      if (dmy) { month = +dmy[2] - 1; year = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3]; }
    }
    if (month < 0 || month > 11) return null;
    return { month: month, year: year };
  }

  /** Quarter mentioned in a fix version ("Q3 26'"), or null. */
  function parseQuarter(raw) {
    var m = /\bq([1-4])\b/.exec(canon(raw));
    return m ? +m[1] : null;
  }

  /**
   * Resolve a fix version string to one of the PI's releases.
   * Returns the release object, or null when nothing matches — the caller
   * surfaces that as "unmapped" so the user can link it by hand.
   */
  function matchRelease(fixVersion, pi) {
    pi = pi || get();
    var releases = pi.releases || [];
    var raw = String(fixVersion == null ? '' : fixVersion).trim();
    if (!raw || !releases.length) return null;

    var c = canon(raw);
    var i;
    // 1. exact, case- and accent-insensitive
    for (i = 0; i < releases.length; i++) {
      if (canon(releases[i].name) === c) return releases[i];
    }
    // 2. one contains the other ("April 2026" vs "Monthly Release April 2026")
    for (i = 0; i < releases.length; i++) {
      var rc = canon(releases[i].name);
      if (rc && (rc.indexOf(c) !== -1 || c.indexOf(rc) !== -1)) return releases[i];
    }
    // 3. same month (+ year when both state one) as the release date
    var fm = parseFixMonth(raw);
    if (fm) {
      for (i = 0; i < releases.length; i++) {
        var rd = parseD(releases[i].date);
        if (!rd) continue;
        if (rd.getMonth() === fm.month && (fm.year == null || rd.getFullYear() === fm.year)) {
          return releases[i];
        }
      }
    }
    // 4. same quarter
    var q = parseQuarter(raw);
    if (q) {
      for (i = 0; i < releases.length; i++) {
        var qd = parseD(releases[i].date);
        if (qd && Math.floor(qd.getMonth() / 3) + 1 === q) return releases[i];
      }
    }
    return null;
  }

  /** The release a feature belongs to, or null. */
  function releaseForFeature(feature, pi) {
    return feature ? matchRelease(feature.fixVersion, pi) : null;
  }

  /** The target date a feature is positioned by — its release date. */
  function targetDate(feature, pi) {
    var r = releaseForFeature(feature, pi);
    return r && r.date ? r.date : '';
  }

  /** Features in user-controlled order. */
  function featuresSorted(pi) {
    pi = pi || get();
    return pi.features.slice().sort(function (a, b) {
      return (a.order == null ? 0 : a.order) - (b.order == null ? 0 : b.order);
    });
  }

  /** Distinct epics, in first-seen order — the Gantt colours by index. */
  function epics(pi) {
    pi = pi || get();
    var seen = [], out = [];
    featuresSorted(pi).forEach(function (f) {
      var k = f.epic || '';
      if (!k) return;
      var c = canon(k);
      if (seen.indexOf(c) === -1) { seen.push(c); out.push(k); }
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════
     COCKPIT — today-relative context (spec §7)
  ═══════════════════════════════════════════════════ */
  function cockpit(pi) {
    pi = pi || get();
    var s = parseD(pi.start), e = parseD(pi.end), now = today();
    var fit = sprintFit(pi);
    var out = {
      hasPI: !!(s && e && e >= s),
      name: pi.name || '',
      status: 'none',        // none | before | during | after
      totalDays: fit.totalDays,
      daysElapsed: 0,
      daysRemaining: 0,
      pctThrough: 0,
      sprintCount: fit.sprintCount,
      whole: fit.whole,
      remainderDays: fit.remainderDays,
      currentSprint: null,
      nextRelease: null,
      lateReleases: []
    };
    if (!out.hasPI) return out;

    if (now < s)      out.status = 'before';
    else if (now > e) out.status = 'after';
    else              out.status = 'during';

    out.daysElapsed   = Math.max(0, Math.min(fit.totalDays, daysBetween(s, now) + (now >= s ? 1 : 0)));
    out.daysRemaining = out.status === 'after' ? 0 : Math.max(0, daysBetween(now, e) + 1);
    out.pctThrough    = fit.totalDays ? Math.max(0, Math.min(100, (out.daysElapsed / fit.totalDays) * 100)) : 0;

    if (out.status === 'during') {
      var sprints = buildSprints(pi);
      var idx = sprintIndexOf(now, sprints);
      var sp = sprints[idx];
      if (sp) {
        out.currentSprint = {
          index: idx,
          number: idx + 1,
          name: sp.name,
          of: sprints.length,
          start: isoD(sp.start),
          end: isoD(sp.endInclusive),
          totalDays: sp.days,
          dayInSprint: daysBetween(sp.start, now) + 1,
          daysLeft: Math.max(0, daysBetween(now, sp.endInclusive) + 1)
        };
      }
    }

    // Next upcoming release: the earliest dated release still ahead of today.
    var dated = (pi.releases || [])
      .filter(function (r) { return !!parseD(r.date); })
      .sort(function (a, b) { return parseD(a.date) - parseD(b.date); });
    for (var i = 0; i < dated.length; i++) {
      var rd = parseD(dated[i].date);
      if (rd >= now) {
        out.nextRelease = {
          id: dated[i].id,
          name: dated[i].name,
          date: dated[i].date,
          daysAway: daysBetween(now, rd),
          features: (pi.features || []).filter(function (f) {
            var m = matchRelease(f.fixVersion, pi);
            return m && m.id === dated[i].id;
          }).length
        };
        break;
      }
    }
    out.lateReleases = dated.filter(function (r) { return parseD(r.date) < now; });
    return out;
  }

  /* ═══════════════════════════════════════════════════
     STORE
  ═══════════════════════════════════════════════════ */
  var _pi = null;
  var _saveTimer = null;
  var _readOnly = false;
  var _quotaWarned = false;
  var _resolveReady;
  var _ready = new Promise(function (res) { _resolveReady = res; });
  var _readyDone = false;

  function readLocal() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && typeof raw === 'object') return normalise(raw);
    } catch (e) { /* corrupt — fall through to the legacy adoption */ }
    return null;
  }

  function writeLocal(pi) {
    if (_readOnly) return true;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(pi));
      return true;
    } catch (e) {
      // gantt.html swallows this in an empty catch; we surface it instead —
      // a silently-dropped write looks exactly like a saved one.
      if (!_quotaWarned) {
        _quotaWarned = true;
        console.warn('[pi] local write failed — the PI is too large for localStorage', e);
      }
      emit('error', { message: 'Local save failed (storage full).' });
      return false;
    }
  }

  /**
   * First run only: adopt whichever PI the old pages left behind. gantt's blob
   * is the richest (window + releases + features + testing + off) so it wins;
   * the dashboard's window is the fallback.
   */
  function adoptLegacy() {
    var pi = null;
    try {
      var g = JSON.parse(localStorage.getItem(LEGACY_GANTT) || 'null');
      if (g && g.pi && (g.pi.start || g.pi.end)) {
        pi = normalise({
          name: '',
          start: g.pi.start || '',
          end: g.pi.end || '',
          sprintLen: g.sprintLen || 14,
          fileName: g.fileName || '',
          releases: (g.releases || []).map(function (r) {
            return { id: r.id || uid(), name: r.name || '', date: r.date || '' };
          }),
          features: (g.features || []).map(function (f, i) {
            return {
              id: f.id || uid(), key: f.key || '', name: f.title || f.name || '',
              description: '', benefits: [], fixVersion: f.fixVersion || '',
              epic: '', epicKey: '', order: i, source: 'jira', offset: f.offset || 0
            };
          }),
          testing: g.testing || [],
          off: g.off || []
        });
      }
    } catch (e) { /* ignore */ }

    if (!pi) {
      try {
        var d = JSON.parse(localStorage.getItem(LEGACY_DASH) || 'null');
        if (d && (d.start || d.end)) {
          pi = normalise({ start: d.start || '', end: d.end || '', sprintLen: 14 });
        }
      } catch (e) { /* ignore */ }
    }
    if (pi) pi.updatedAt = new Date().toISOString();
    return pi;
  }

  function get() {
    if (!_pi) {
      _pi = readLocal() || adoptLegacy() || normalise(DEFAULT());
    }
    return _pi;
  }

  function emit(source, extra) {
    var detail = { pi: _pi, source: source };
    if (extra) Object.keys(extra).forEach(function (k) { detail[k] = extra[k]; });
    try {
      document.dispatchEvent(new CustomEvent('lazypo:pi', { detail: detail }));
    } catch (e) { /* very old browser */ }
  }

  /**
   * Shallow-merge a patch into the PI. Writes locally at once (so a reload
   * never loses an edit) and pushes to Supabase on a trailing debounce.
   */
  function save(patch, opts) {
    var pi = get();
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) { pi[k] = patch[k]; });
    }
    normalise(pi);
    pi.updatedAt = new Date().toISOString();
    writeLocal(pi);
    emit((opts && opts.source) || 'edit');
    scheduleRemote();
    return pi;
  }

  /** Replace the whole PI (import, Excel round-trip, reset). */
  function replace(next, opts) {
    _pi = normalise(JSON.parse(JSON.stringify(next || DEFAULT())));
    _pi.updatedAt = new Date().toISOString();
    writeLocal(_pi);
    emit((opts && opts.source) || 'edit');
    scheduleRemote();
    return _pi;
  }

  /* ── Supabase ──────────────────────────────────────────────── */
  function scheduleRemote() {
    if (_readOnly) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(pushRemote, SAVE_WAIT);
  }

  async function currentUser() {
    if (!window.sb) return null;
    try {
      var res = await window.sb.auth.getUser();
      return (res.data && res.data.user) || null;
    } catch (e) { return null; }
  }

  async function pushRemote() {
    if (_readOnly) return false;
    var user = await currentUser();
    if (!user) {
      // Signed out, or offline. Every path out of here has to emit something —
      // a save that ends without a terminal event leaves the UI on "Saving…"
      // forever, which reads as "still working" rather than "done, locally".
      emit('local');
      return false;
    }
    try {
      var r = await window.sb.from('profiles').update({ pi: get() }).eq('id', user.id);
      if (r.error) {
        // Most likely cause: pi_schema.sql was never run. Local storage keeps
        // working, so the feature degrades to single-device rather than break.
        console.warn('[pi] cloud save failed —', r.error.message,
                     '(has pi_schema.sql been run in the Supabase SQL editor?)');
        emit('error', { message: 'Cloud save unavailable — saved on this device only.' });
        return false;
      }
      emit('synced');
      return true;
    } catch (e) {
      console.warn('[pi] cloud save failed', e);
      return false;
    }
  }

  async function pullRemote() {
    var user = await currentUser();
    if (!user) return false;
    try {
      var r = await window.sb.from('profiles').select('pi').eq('id', user.id).single();
      if (r.error || !r.data) return false;
      var remote = r.data.pi;
      if (!remote || typeof remote !== 'object' || !Object.keys(remote).length) {
        // Nothing in the cloud yet — seed it from whatever we have locally.
        var local = get();
        if (local.start || local.features.length || local.releases.length) await pushRemote();
        return false;
      }
      remote = normalise(remote);
      var localPi = get();
      // Last write wins. A remote copy with no timestamp is older than any
      // local edit we can date, and vice versa.
      var rt = Date.parse(remote.updatedAt || '') || 0;
      var lt = Date.parse(localPi.updatedAt || '') || 0;
      if (rt >= lt) {
        _pi = remote;
        writeLocal(_pi);
        emit('remote');
        return true;
      }
      await pushRemote();
      return false;
    } catch (e) {
      console.warn('[pi] cloud load failed', e);
      return false;
    }
  }

  async function hydrate() {
    var ok = false;
    try { ok = await pullRemote(); } catch (e) { /* offline */ }
    if (!_readyDone) { _readyDone = true; _resolveReady(get()); }
    return ok;
  }

  /* ═══════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════ */

  // 1. Local copy is available synchronously, from the first line of any page.
  get();

  // 2. Cloud copy replaces it once auth has settled. auth.js broadcasts
  //    lazypo:profile; sidebar.js re-broadcasts it from cache on SPA nav, so
  //    the handler has to be idempotent — pullRemote() is.
  document.addEventListener('lazypo:profile', function () { hydrate(); });

  // 3. A page loaded with a session already in memory never sees that event.
  setTimeout(function () {
    if (!_readyDone && window.sb) hydrate();
    else if (!_readyDone) { _readyDone = true; _resolveReady(get()); }
  }, 1500);

  window.LazyPI = {
    STORE_KEY: STORE_KEY,
    DEFAULT: DEFAULT,
    normalise: normalise,

    get: get,
    save: save,
    replace: replace,
    reload: hydrate,
    push: pushRemote,
    get ready() { return _ready; },

    /** The gantt standalone export sets this so an offline copy on the same
        origin can never write back to the live PI. */
    setReadOnly: function (v) { _readOnly = !!v; },
    isReadOnly: function () { return _readOnly; },

    onChange: function (fn) {
      var h = function (e) { fn(e.detail.pi, e.detail); };
      document.addEventListener('lazypo:pi', h);
      return function () { document.removeEventListener('lazypo:pi', h); };
    },

    buildSprints: buildSprints,
    sprintFit: sprintFit,
    sprintIndexOf: sprintIndexOf,
    defaultSprintIndex: defaultSprintIndex,
    endExclusive: endExclusive,

    matchRelease: matchRelease,
    releaseForFeature: releaseForFeature,
    targetDate: targetDate,
    parseFixMonth: parseFixMonth,
    featuresSorted: featuresSorted,
    epics: epics,
    splitBenefits: splitBenefits,

    cockpit: cockpit,

    parseD: parseD,
    isoD: isoD,
    addDays: addDays,
    daysBetween: daysBetween,
    uid: uid,
    canon: canon
  };

})();
