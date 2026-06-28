/**
 * countdown.js — Composant Progress Bars / Countdown LazyPO
 *
 * Priorité de chargement :
 *  1. FALLBACK_PROJECTS (rendu immédiat, données en dur)
 *  2. Supabase profiles.countdowns (remplace dès que l'auth est prête)
 *
 * Migration Supabase (une fois) :
 *  ALTER TABLE public.profiles
 *    ADD COLUMN IF NOT EXISTS countdowns jsonb DEFAULT '[]';
 */
(function () {

  /* ═══════════════════════════════════════════════════
     FALLBACK DATA
  ═══════════════════════════════════════════════════ */
  var FALLBACK_PROJECTS = [
    { name: 'REACH',       date: '2026-06-03', color: 'ring-amber', totalDays: 180 },
    { name: 'PI PLANNING', date: '2026-06-15', color: 'ring-white', totalDays: 90  },
  ];

  var COLORS = ['ring-amber', 'ring-blue', 'ring-green', 'ring-white'];
  var CIRCUMFERENCE = 2 * Math.PI * 44;
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ═══════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════ */
  function getDaysLeft(targetDate) {
    var now = new Date(); now.setHours(0,0,0,0);
    var target = new Date(targetDate + 'T00:00:00');
    return Math.ceil((target - now) / 86400000);
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return MONTHS[d.getMonth()] + ' ' + String(d.getDate()).padStart(2,'0') + ', ' + d.getFullYear();
  }

  /* ═══════════════════════════════════════════════════
     CARD BUILDER
  ═══════════════════════════════════════════════════ */
  function buildCard(p, index) {
    var days      = getDaysLeft(p.date);
    var total     = p.totalDays || Math.max(Math.abs(days) + 30, 90);
    var progress  = Math.max(0, Math.min(1, days / total));
    var offset    = CIRCUMFERENCE * (1 - progress);
    var overdue   = days < 0;
    var imminent  = !overdue && days <= 7;
    var stateClass = overdue ? 'overdue' : imminent ? 'imminent' : '';
    var color     = p.color || COLORS[index % COLORS.length];

    return [
      '<div class="countdown-card ' + stateClass + '" style="animation-delay:' + (0.4 + index * 0.1) + 's">',
      '  <div class="ring-wrap ' + color + '">',
      '    <svg class="ring-svg" viewBox="0 0 100 100">',
      '      <circle class="ring-bg" cx="50" cy="50" r="44"/>',
      '      <circle class="ring-progress" cx="50" cy="50" r="44"',
      '        stroke-dasharray="' + CIRCUMFERENCE + '"',
      '        stroke-dashoffset="' + offset + '"/>',
      '    </svg>',
      '    <div class="ring-center">',
      '      <div class="ring-days">' + Math.abs(days) + '</div>',
      '      <div class="ring-sub">' + (overdue ? 'DAYS OVER' : 'DAYS LEFT') + '</div>',
      '    </div>',
      '  </div>',
      '  <div class="countdown-name">' + p.name + '</div>',
      '  <div class="countdown-date">' + formatDate(p.date) + '</div>',
      '</div>'
    ].join('\n');
  }

  /* ═══════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════ */
  function renderCountdown(projects) {
    var grid = document.getElementById('countdownGrid');
    if (!grid) return;
    if (!projects || !projects.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = projects.map(buildCard).join('');
  }

  /* ═══════════════════════════════════════════════════
     LOAD FROM SUPABASE
  ═══════════════════════════════════════════════════ */
  async function loadFromSupabase() {
    if (!window.sb) return false;
    try {
      var res = await window.sb.auth.getUser();
      var user = res.data && res.data.user;
      if (!user) return false;
      var r = await window.sb.from('profiles').select('countdowns').eq('id', user.id).single();
      if (r.data && Array.isArray(r.data.countdowns) && r.data.countdowns.length) {
        renderCountdown(r.data.countdowns);
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ═══════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════ */

  // 1. Afficher le fallback hard-coded immédiatement (no network call)
  renderCountdown(FALLBACK_PROJECTS);

  // 2. Remplacer par les données Supabase dès que l'auth est prête
  document.addEventListener('lazypo:profile', function() {
    loadFromSupabase();
  });

  // 3. Public API — account.html appelle ceci après une sauvegarde
  window.CountdownManager = {
    reload: function() { return loadFromSupabase(); }
  };

})();
