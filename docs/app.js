// ── XP config ───────────────────────────────────────────────
const XP_PER_EXERCISE     = 4;
const XP_COMPLETION_BONUS = 3;
const UNLOCK_AT           = 20;
const CHAKRA_ORDER = ['root','sacral','solar','heart','throat','third-eye','crown'];

// ── Helpers ──────────────────────────────────────────────────
function today() { return new Date().toLocaleDateString('en-CA'); }

function getLevelInfo(pct) {
  return LEVELS.find(l => pct >= l.min && pct <= l.max) || LEVELS[0];
}

function calcXP(doneCount, total) {
  let xp = doneCount * XP_PER_EXERCISE;
  if (doneCount === total) xp += XP_COMPLETION_BONUS;
  return xp;
}

function streakLabel(n) { return n > 0 ? `🔥 ${n} day${n > 1 ? 's' : ''}` : ''; }

function todayAffirmation(c) {
  const idx = Math.floor(Date.now() / 86400000) % c.affirmations.length;
  return c.affirmations[idx];
}

function parseDuration(text) {
  const m = text.match(/(\d+)[–\-]?(\d*)\s*minute/);
  const s = text.match(/(\d+)\s*second/);
  if (m) return parseInt(m[1]) * 60;
  if (s) return parseInt(s[1]);
  return null;
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2,'0')}` : `${s}s`;
}

function isUnlocked(id) {
  if (debugMode) return true;
  const idx = CHAKRA_ORDER.indexOf(id);
  if (idx <= 0) return true;
  return (state[CHAKRA_ORDER[idx - 1]]?.progress ?? 0) >= UNLOCK_AT;
}

function unlockedBy(id) {
  const idx = CHAKRA_ORDER.indexOf(id);
  if (idx <= 0) return null;
  return CHAKRA_DATA.find(c => c.id === CHAKRA_ORDER[idx - 1]);
}

function globalScore() {
  const unlocked = CHAKRA_DATA.filter(c => isUnlocked(c.id));
  if (!unlocked.length) return 0;
  return Math.round(unlocked.reduce((sum, c) => sum + (state[c.id]?.progress ?? 0), 0) / unlocked.length);
}

function weekDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString('en-CA');
  });
}

function isStreakAtRisk(ch) {
  if (!ch.streak || ch.lastDate === today()) return false;
  const y = new Date(); y.setDate(y.getDate() - 1);
  return ch.lastDate === y.toLocaleDateString('en-CA');
}

function dateLabel(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Debug ────────────────────────────────────────────────────
let debugMode = false;

// ── State ────────────────────────────────────────────────────
let state = {};

function getChakra(id) {
  if (!state[id]) state[id] = {};
  const ch = state[id];
  if (!Array.isArray(ch.doneToday))   ch.doneToday    = [];
  if (!Array.isArray(ch.history))     ch.history      = [];
  if (!ch.snapshots)                  ch.snapshots    = {};
  if (ch.baseProgress == null)        ch.baseProgress = ch.progress ?? 0;
  if (ch.progress     == null)        ch.progress     = 0;
  if (ch.streak       == null)        ch.streak       = 0;
  if (ch.lastDate     == null)        ch.lastDate     = null;
  if (ch.lastDate !== today() && ch.doneToday.length > 0) {
    ch.baseProgress = ch.progress;
    ch.doneToday    = [];
  }
  return ch;
}

function recordSnapshot(id) {
  const ch = getChakra(id);
  ch.snapshots[today()] = {
    progress:  ch.progress,
    xpEarned:  calcXP(ch.doneToday.length, CHAKRA_DATA.find(c => c.id === id)?.exercises.length ?? 3),
    exercises: [...ch.doneToday],
  };
}

// ── Persistence ──────────────────────────────────────────────
function load() {
  try { state = JSON.parse(localStorage.getItem('chakra-v3') || '{}'); }
  catch { state = {}; }
}

function save() {
  localStorage.setItem('chakra-v3', JSON.stringify(state));
  document.getElementById('last-updated').textContent =
    'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Sync to Firestore if signed in
  if (window._fb?.user) {
    window._fb.saveData(window._fb.user.uid, state).catch(console.warn);
  }
}

// ── Pull latest from Firestore ───────────────────────────────
async function pullFromFirestore() {
  if (!window._fb?.user) return;
  try {
    const cloud = await window._fb.loadData(window._fb.user.uid);
    if (cloud && Object.keys(cloud).length) {
      state = cloud;
      localStorage.setItem('chakra-v3', JSON.stringify(state));
      renderList();
      updateScoreRing();
      document.getElementById('last-updated').textContent =
        'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  } catch(e) { console.warn('Pull failed:', e); }
}

// Re-sync when tab becomes visible (e.g. switching from phone to desktop)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pullFromFirestore();
});

// Re-sync when network comes back online
window.addEventListener('online', () => pullFromFirestore());

// Poll every 10 seconds — also forces Firestore back online if it dropped
setInterval(() => {
  if (document.visibilityState === 'visible') pullFromFirestore();
}, 10000);

// ── Cross-tab sync (same browser, instant via localStorage event) ──
window.addEventListener('storage', e => {
  if (e.key !== 'chakra-v3' || !e.newValue) return;
  try {
    state = JSON.parse(e.newValue);
    renderList();
    updateScoreRing();
    document.getElementById('last-updated').textContent =
      'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (document.getElementById('modal-overlay').classList.contains('open')) renderModal();
  } catch {}
});

// ── Firebase auth integration ─────────────────────────────────
window.addEventListener('firebase-auth-changed', e => {
  updateAuthUI(e.detail.user);
  // Real-time listener handles data loading (firebase.js calls startListening)
  // If signing out, clear to localStorage state
  if (!e.detail.user) {
    load();
    renderList();
    updateScoreRing();
  }
});

// Real-time sync — fires whenever Firestore data changes on ANY device
window.addEventListener('firebase-data-updated', e => {
  const incoming = e.detail.data;
  if (!incoming || !Object.keys(incoming).length) {
    // Nothing in cloud yet — push local data up
    if (window._fb?.user) {
      window._fb.saveData(window._fb.user.uid, state).catch(console.warn);
    }
    return;
  }
  state = incoming;
  localStorage.setItem('chakra-v3', JSON.stringify(state));
  document.getElementById('last-updated').textContent =
    'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  renderList();
  updateScoreRing();
  if (activeTab === 'calendar') renderCalendar();
  if (activeTab === 'progress') renderCharts();
  // If modal is open, refresh it too
  if (document.getElementById('modal-overlay').classList.contains('open')) {
    renderModal();
  }
});

function updateAuthUI(user) {
  const area = document.getElementById('auth-area');
  if (user) {
    area.innerHTML = `
      <div class="auth-user">
        ${user.photoURL ? `<img src="${user.photoURL}" class="auth-avatar" referrerpolicy="no-referrer">` : ''}
        <span class="auth-name">${user.displayName?.split(' ')[0] ?? 'You'}</span>
        <button class="btn-signout" id="btn-signout">Sign out</button>
      </div>`;
    document.getElementById('btn-signout').addEventListener('click', () => window._fb.signOut());
  } else {
    area.innerHTML = `<button class="btn-signin" id="btn-signin">Sign in with Google</button>`;
    document.getElementById('btn-signin').addEventListener('click', doSignIn);
  }
}

async function doSignIn() {
  if (!window._fb) {
    showAuthError('Firebase not ready — try refreshing');
    return;
  }
  try {
    await window._fb.signIn();
  } catch (err) {
    console.error('Sign-in error:', err);
    if (err.code === 'auth/unauthorized-domain') {
      showAuthError('Add liljiggly.github.io to Firebase Auth → Authorized Domains');
    } else if (err.code === 'auth/popup-blocked') {
      showAuthError('Allow popups for this site and try again');
    } else {
      showAuthError(err.message ?? 'Sign-in failed — check console');
    }
  }
}

function showAuthError(msg) {
  const area = document.getElementById('auth-area');
  area.innerHTML = `<span class="auth-error">${msg}</span>`;
  setTimeout(() => updateAuthUI(null), 6000);
}

// ── Boot ─────────────────────────────────────────────────────
let focusedId = null;
let editingId = null;
let activeTab = 'chakras';

load();

if (localStorage.getItem('chakra-seen-intro')) {
  document.getElementById('intro-overlay').style.display = 'none';
  document.getElementById('app').style.display = '';
}

renderList();
updateScoreRing();
setupTabs();

// Wire initial sign-in button (replaced by updateAuthUI once Firebase loads)
document.getElementById('btn-signin')?.addEventListener('click', doSignIn);

// ── Score ring ───────────────────────────────────────────────
function updateScoreRing() {
  const score = globalScore();
  const fill  = document.getElementById('score-ring-fill');
  const circ  = 2 * Math.PI * 15.9;
  fill.style.strokeDasharray  = `${circ} ${circ}`;
  fill.style.strokeDashoffset = circ - (circ * score / 100);
  const pctEl = document.getElementById('topbar-score-pct');
  if (pctEl) pctEl.textContent = score + '%';
}

// ── Tabs ─────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById(`tab-${activeTab}`).classList.remove('hidden');
      if (activeTab === 'calendar') renderCalendar();
      if (activeTab === 'progress') renderCharts();
    });
  });
}

// ── Chakra list ──────────────────────────────────────────────
function renderList() {
  const list  = document.getElementById('chakra-list');
  const dates = weekDates();
  list.innerHTML = '';

  CHAKRA_DATA.forEach((c, i) => {
    const ch     = getChakra(c.id);
    const pct    = ch.progress;
    const lvl    = getLevelInfo(pct);
    const locked = !isUnlocked(c.id);
    const prev   = unlockedBy(c.id);
    const atRisk = isStreakAtRisk(ch);

    const row = document.createElement('div');
    row.className = `chakra-row${focusedId === c.id ? ' focused' : ''}${locked ? ' locked' : ''}`;
    row.style.setProperty('--row-color', c.color);
    row.style.animationDelay = `${i * 55}ms`;

    const dots = dates.map(d => {
      const done    = ch.history.includes(d);
      const isToday = d === today();
      return `<span class="week-dot${done ? ' done' : ''}${isToday ? ' today' : ''}"
        style="${done ? `background:${c.color}` : isToday ? `box-shadow:0 0 0 1.5px ${c.color}88` : ''}"></span>`;
    }).join('');

    if (locked) {
      row.innerHTML = `
        <div class="chakra-swatch locked-swatch" style="background:${c.color}33"></div>
        <div class="chakra-row-info">
          <div class="chakra-row-top">
            <span class="chakra-row-name" style="color:var(--muted)">${c.name}</span>
            <span class="chakra-row-sanskrit">${c.sanskrit}</span>
          </div>
          <div class="lock-msg">🔒 Reach <strong>Awakening</strong> in ${prev?.name ?? 'previous chakra'}</div>
        </div>
        <div class="chakra-row-right"><span class="lock-icon">🔒</span></div>`;
      row.addEventListener('click', () => showLockedTooltip(c, prev));
    } else {
      row.innerHTML = `
        <div class="chakra-swatch" style="background:${c.color};box-shadow:0 2px 12px ${c.color}44"></div>
        <div class="chakra-row-info">
          <div class="chakra-row-top">
            <span class="chakra-row-name">${c.name}</span>
            <span class="chakra-row-sanskrit">${c.sanskrit}</span>
          </div>
          <div class="chakra-row-bar-wrap">
            <div class="chakra-row-bar" style="width:${pct}%;background:${c.color}"></div>
          </div>
          <div class="week-dots">${dots}</div>
          ${atRisk ? `<div class="streak-risk">⚡ Practice today to keep your streak!</div>` : ''}
        </div>
        <div class="chakra-row-right">
          <span class="chakra-row-pct">${pct}%</span>
          <span class="chakra-row-level" style="color:${c.color}">${lvl.name}</span>
          ${ch.streak > 0 ? `<span class="chakra-row-streak">${streakLabel(ch.streak)}</span>` : ''}
        </div>`;
      row.addEventListener('click', () => openModal(c.id));
    }
    list.appendChild(row);
  });
}

// ── Locked tooltip ───────────────────────────────────────────
let lockedTooltipTimer = null;
function showLockedTooltip(c, prev) {
  const prevPct = state[prev?.id]?.progress ?? 0;
  const need    = Math.max(0, UNLOCK_AT - prevPct);
  document.getElementById('locked-tooltip-title').textContent = `${c.name} is locked`;
  document.getElementById('locked-tooltip-body').textContent  =
    `Complete exercises in ${prev?.name ?? 'the previous chakra'} to reach Awakening (${UNLOCK_AT}%). ` +
    (need > 0 ? `${need}% more needed — about ${Math.ceil(need / XP_PER_EXERCISE)} exercise${need > XP_PER_EXERCISE ? 's' : ''}.` : '');
  const tooltip = document.getElementById('locked-tooltip');
  tooltip.style.display = '';
  requestAnimationFrame(() => tooltip.classList.add('show'));
  clearTimeout(lockedTooltipTimer);
  lockedTooltipTimer = setTimeout(hideLockedTooltip, 5000);
}
function hideLockedTooltip() {
  document.getElementById('locked-tooltip').classList.remove('show');
  setTimeout(() => document.getElementById('locked-tooltip').style.display = 'none', 350);
}
document.getElementById('locked-tooltip-close').addEventListener('click', hideLockedTooltip);

// ── Focus ────────────────────────────────────────────────────
function focusChakra(id) {
  if (!isUnlocked(id)) return;
  focusedId = id;
  const c   = CHAKRA_DATA.find(x => x.id === id);
  const ch  = getChakra(id);
  const pct = ch.progress;
  const lvl = getLevelInfo(pct);
  const todayXP = calcXP(ch.doneToday.length, c.exercises.length);

  // document.querySelector('.panel-left').style.background =
  //   `linear-gradient(180deg, ${c.color}0d 0%, var(--card) 100%)`;
  document.getElementById('focus-dot').style.background  = c.color;
  document.getElementById('focus-dot').style.boxShadow   = `0 0 18px 5px ${c.color}88`;
  document.getElementById('focus-glow').style.background =
    `radial-gradient(ellipse at left center, ${c.color}22 0%, transparent 65%)`;
  document.getElementById('focus-glow').style.opacity    = '1';
  document.getElementById('focus-name').textContent      = `${c.name} · ${c.sanskrit}`;
  document.getElementById('focus-sub').textContent       = c.element;
  document.getElementById('focus-meta').style.display    = 'flex';
  document.getElementById('focus-level-badge').textContent = `Lv ${lvl.level} · ${lvl.name}`;
  document.getElementById('focus-level-badge').style.color = c.color;
  document.getElementById('focus-streak').textContent    = streakLabel(ch.streak);
  document.getElementById('focus-xp').textContent        = todayXP > 0 ? `+${todayXP}% today` : '';

  document.querySelectorAll('.chakra-pulse').forEach(el => el.style.display = 'none');
  const pulse = document.getElementById(`pulse-${id}`);
  if (pulse) { pulse.style.display = ''; pulse.style.stroke = c.color; }

  renderList();
}

// ── Modal ────────────────────────────────────────────────────
const overlay     = document.getElementById('modal-overlay');
const activeTimers = new Map();

function openModal(id) {
  if (!isUnlocked(id)) return;
  focusChakra(id);
  editingId = id;
  renderModal();
  overlay.classList.add('open');
  document.body.classList.add('modal-open');
}

function renderModal() {
  const c   = CHAKRA_DATA.find(x => x.id === editingId);
  const ch  = getChakra(editingId);
  const pct = ch.progress;
  const lvl = getLevelInfo(pct);
  const total   = c.exercises.length;
  const todayXP = calcXP(ch.doneToday.length, total);
  const basePct = ch.baseProgress ?? 0;
  const nextLvl = lvl.level < 5 ? LEVELS[lvl.level] : null;

  document.getElementById('modal-title').textContent     = `${c.name} Chakra`;
  document.getElementById('modal-title-2').textContent   = `${c.name} Chakra`;
  document.getElementById('modal-navbar-sub').textContent = `${c.sanskrit}${ch.streak > 0 ? ' · ' + streakLabel(ch.streak) : ''}`;
  document.getElementById('modal-sanskrit').textContent  = c.sanskrit;
  document.getElementById('modal-element').textContent   = `✦ ${c.element}`;
  document.getElementById('modal-swatch').style.background = c.color;
  document.getElementById('modal-swatch').style.boxShadow  = `0 4px 18px ${c.color}55`;
  document.getElementById('modal-streak-badge').textContent = streakLabel(ch.streak);

  const aff = document.getElementById('modal-affirmation');
  aff.textContent = `"${todayAffirmation(c)}"`;
  aff.style.borderLeftColor = c.color;

  document.getElementById('modal-level-badge').textContent = `Level ${lvl.level}`;
  document.getElementById('modal-level-badge').style.color = c.color;
  document.getElementById('modal-level-name').textContent  = lvl.name;
  document.getElementById('modal-pct').textContent         = `${pct}% towards next Level`;

  const xpBar  = document.getElementById('modal-xp-bar');
  const xpGain = document.getElementById('modal-xp-bar-gain');
  xpBar.style.width = `${basePct}%`; xpBar.style.background = c.color;
  xpGain.style.left = `${basePct}%`; xpGain.style.width = `${todayXP}%`;

  // Simple today-earned label only
  document.getElementById('xp-today-earned').textContent = todayXP > 0
    ? `+${todayXP}% earned today` : 'Complete exercises to earn XP';

  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  renderExercises(c, ch, total);
  document.getElementById('modal-summary').textContent = c.summary;
  document.getElementById('sign-blocked').textContent  = c.signs.blocked;
  document.getElementById('sign-open').textContent     = c.signs.open;
}

function renderExercises(c, ch, total) {
  const exList = document.getElementById('exercises-list');
  const banner = document.getElementById('all-done-banner');
  exList.innerHTML = '';

  c.exercises.forEach((ex, i) => {
    const done   = ch.doneToday.includes(ex.name);
    const isLast = i === total - 1;
    const dur    = parseDuration(ex.how);
    const tag    = ex.type === 'art' ? `<span class="exercise-type-tag">🎨 Art</span>` : '';
    const bonusHint = isLast && ch.doneToday.length === total - 1
      ? ` · +${XP_COMPLETION_BONUS}% completion bonus!`
      : isLast ? ` · +${XP_COMPLETION_BONUS}% bonus for all three` : '';

    const item = document.createElement('div');
    item.className = `exercise-item${done ? ' done' : ''}`;
    item.dataset.exName = ex.name;
    item.innerHTML = `
      <div class="exercise-check" style="${done ? `background:${c.color};border-color:${c.color}` : ''}">
        ${done ? '✓' : ''}
      </div>
      <div class="exercise-text">
        <div class="exercise-name">${ex.name} ${tag}</div>
        <div class="exercise-how">${ex.how}</div>
        ${dur ? `<button class="timer-btn" data-dur="${dur}" data-ex="${ex.name}">⏱ ${fmtTime(dur)}</button>` : ''}
        <div class="exercise-xp" style="color:${c.color}">
          ${done ? `✓ Done today <span class="uncheck-hint">(click to undo)</span>`
                 : `+${XP_PER_EXERCISE}% XP${bonusHint}`}
        </div>
      </div>`;

    if (activeTimers.has(ex.name)) {
      const timerBtn = item.querySelector('.timer-btn');
      if (timerBtn) replaceWithDisplay(timerBtn, ex.name, c.color);
    }

    item.addEventListener('click', e => {
      if (e.target.closest('.timer-btn')) return;
      done ? uncheckExercise(editingId, ex.name) : checkExercise(editingId, ex.name);
    });
    exList.appendChild(item);
  });

  exList.addEventListener('click', e => {
    const btn = e.target.closest('.timer-btn');
    if (!btn) return;
    e.stopPropagation();
    const color = CHAKRA_DATA.find(x => x.id === editingId)?.color ?? '#fff';
    startTimer(btn, parseInt(btn.dataset.dur), btn.dataset.ex, color);
  }, { once: true });

  banner.style.display = ch.doneToday.length === total ? '' : 'none';
}

// ── Timer ────────────────────────────────────────────────────
function startTimer(btn, durationSecs, exName, color) {
  const display = replaceWithDisplay(btn, exName, color);
  let remaining = durationSecs;
  display.textContent = fmtTime(remaining);
  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(iv); activeTimers.delete(exName);
      display.textContent = '✓ Done!';
      display.style.color = '#4ade80';
      display.style.background = 'rgba(74,222,128,0.1)';
    } else {
      display.textContent = fmtTime(remaining);
    }
  }, 1000);
  activeTimers.set(exName, iv);
}

function replaceWithDisplay(btn, exName, color) {
  const d = document.createElement('span');
  d.className = 'timer-display'; d.style.color = color; d.dataset.ex = exName;
  btn.replaceWith(d); return d;
}

// ── Check / Uncheck ──────────────────────────────────────────
function checkExercise(chakraId, exerciseName) {
  const c  = CHAKRA_DATA.find(x => x.id === chakraId);
  const ch = getChakra(chakraId);
  if (ch.doneToday.includes(exerciseName)) return;

  const prevLevel = getLevelInfo(ch.progress).level;
  if (ch.doneToday.length === 0) ch.baseProgress = ch.progress;

  ch.doneToday.push(exerciseName);
  ch.progress = Math.min(100, ch.baseProgress + calcXP(ch.doneToday.length, c.exercises.length));

  const t = today();
  if (ch.lastDate !== t) {
    const prev = new Date(); prev.setDate(prev.getDate() - 1);
    ch.streak   = ch.lastDate === prev.toLocaleDateString('en-CA') ? (ch.streak || 0) + 1 : 1;
    ch.lastDate = t;
  }
  if (!ch.history.includes(t)) ch.history.push(t);
  if (ch.history.length > 90)  ch.history = ch.history.slice(-90);
  recordSnapshot(chakraId);

  save();
  renderModal();
  focusChakra(chakraId);
  renderList();
  updateScoreRing();

  const newLevel = getLevelInfo(ch.progress).level;
  if (newLevel > prevLevel) showLevelUpToast(c, newLevel);
}

function uncheckExercise(chakraId, exerciseName) {
  const c  = CHAKRA_DATA.find(x => x.id === chakraId);
  const ch = getChakra(chakraId);
  const idx = ch.doneToday.indexOf(exerciseName);
  if (idx === -1) return;

  ch.doneToday.splice(idx, 1);
  ch.progress = Math.min(100, ch.baseProgress + calcXP(ch.doneToday.length, c.exercises.length));

  if (ch.doneToday.length === 0) {
    ch.history  = ch.history.filter(d => d !== today());
    ch.lastDate = null;
    ch.streak   = Math.max(0, ch.streak - 1);
    delete ch.snapshots[today()];
  } else {
    recordSnapshot(chakraId);
  }

  if (activeTimers.has(exerciseName)) {
    clearInterval(activeTimers.get(exerciseName));
    activeTimers.delete(exerciseName);
  }

  save();
  renderModal();
  focusChakra(chakraId);
  renderList();
  updateScoreRing();
}

// ── Level up toast ───────────────────────────────────────────
function showLevelUpToast(c, newLevel) {
  const toast = document.getElementById('levelup-toast');
  document.getElementById('toast-title').textContent = `${c.name} — Level ${newLevel}!`;
  document.getElementById('toast-body').textContent  = `You've reached ${LEVELS[newLevel - 1].name}`;
  toast.style.display = '';
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.style.display = 'none', 400); }, 3500);
}

// ── Modal close ──────────────────────────────────────────────
function closeModal() {
  overlay.classList.remove('open');
  document.body.classList.remove('modal-open');
  activeTimers.forEach(iv => clearInterval(iv));
  activeTimers.clear();
}
document.getElementById('modal-close').addEventListener('click', closeModal);
// Click overlay background to close (desktop only — mobile has no visible overlay)
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

// ── SVG clicks ───────────────────────────────────────────────
document.querySelectorAll('.chakra-hit').forEach(el => {
  el.addEventListener('click', () => {
    const id = el.dataset.id;
    isUnlocked(id) ? openModal(id) : showLockedTooltip(CHAKRA_DATA.find(c => c.id === id), unlockedBy(id));
  });
});

// ── Debug ────────────────────────────────────────────────────
document.getElementById('btn-debug').addEventListener('click', () => {
  debugMode = !debugMode;
  const btn = document.getElementById('btn-debug');
  btn.textContent = debugMode ? 'Debug ON' : 'Debug';
  btn.style.color = debugMode ? '#f59e0b' : '';
  btn.style.borderColor = debugMode ? '#f59e0b44' : '';
  renderList(); updateScoreRing();
});

// ── Intro ────────────────────────────────────────────────────
document.getElementById('btn-begin').addEventListener('click', () => {
  localStorage.setItem('chakra-seen-intro', '1');
  const intro = document.getElementById('intro-overlay');
  intro.style.transition = 'opacity 0.6s'; intro.style.opacity = '0';
  setTimeout(() => { intro.style.display = 'none'; document.getElementById('app').style.display = ''; }, 600);
});
document.getElementById('btn-tutorial').addEventListener('click', () => {
  const intro = document.getElementById('intro-overlay');
  intro.style.transition = 'none'; intro.style.opacity = '0'; intro.style.display = 'flex';
  requestAnimationFrame(() => { intro.style.transition = 'opacity 0.3s'; intro.style.opacity = '1'; });
});

// ════════════════════════════════════════════════════════════
// ── CALENDAR ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let selectedDay = null;

function renderCalendar() {
  const label  = document.getElementById('cal-month-label');
  const grid   = document.getElementById('cal-grid');
  const detail = document.getElementById('cal-day-detail');

  label.textContent = new Date(calYear, calMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Legend
  const legend = document.getElementById('cal-legend');
  legend.innerHTML = CHAKRA_DATA.map(c =>
    `<div class="cal-legend-item">
       <span class="cal-legend-dot" style="background:${c.color}"></span>${c.name}
     </div>`
  ).join('');

  // Build grid
  const firstDay = new Date(calYear, calMonth, 1);
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
  // Monday-first offset
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  grid.innerHTML = '';
  const todayStr = today();

  // Empty cells before month start
  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dateObj = new Date(calYear, calMonth, d);
    const dateStr = dateObj.toLocaleDateString('en-CA');
    const isFuture = dateStr > todayStr;
    const isToday  = dateStr === todayStr;

    // Which chakras were practiced this day?
    const practiced = CHAKRA_DATA.filter(c => {
      const ch = getChakra(c.id);
      return ch.history.includes(dateStr);
    });

    const cell = document.createElement('div');
    cell.className = `cal-cell${isToday ? ' today' : ''}${isFuture ? ' future' : ''}${selectedDay === dateStr ? ' selected' : ''}`;
    cell.dataset.date = dateStr;
    cell.innerHTML = `
      <span class="cal-day-num">${d}</span>
      <div class="cal-dots">
        ${practiced.map(c => `<span class="cal-dot" style="background:${c.color}" title="${c.name}"></span>`).join('')}
      </div>`;

    if (!isFuture) {
      cell.addEventListener('click', () => {
        selectedDay = dateStr;
        renderCalendar(); // re-render to update selection
        showDayDetail(dateStr);
      });
    }
    grid.appendChild(cell);
  }

  // Show or hide detail panel
  if (selectedDay) showDayDetail(selectedDay);
  else detail.style.display = 'none';
}

function showDayDetail(dateStr) {
  const detail   = document.getElementById('cal-day-detail');
  const practiced = CHAKRA_DATA.filter(c => getChakra(c.id).history.includes(dateStr));

  if (!practiced.length) {
    detail.style.display = '';
    detail.innerHTML = `<h4>${dateLabel(dateStr)}</h4><p style="color:var(--muted);font-size:.82rem">No practice recorded this day.</p>`;
    return;
  }

  detail.style.display = '';
  detail.innerHTML = `<h4>${dateLabel(dateStr)}</h4>` +
    practiced.map(c => {
      const snap = getChakra(c.id).snapshots?.[dateStr];
      const xpLine = snap ? ` <span style="color:${c.color};font-size:.72rem">+${snap.xpEarned}% XP</span>` : '';
      const exLine = snap?.exercises?.length
        ? `<div style="font-size:.72rem;color:var(--muted);margin-top:2px">${snap.exercises.join(', ')}</div>`
        : '';
      return `<div class="cal-detail-row">
        <span class="cal-detail-dot" style="background:${c.color}"></span>
        <div style="flex:1">
          <span style="font-weight:600">${c.name}</span>${xpLine}
          ${exLine}
        </div>
      </div>`;
    }).join('');
}

document.getElementById('cal-prev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  selectedDay = null; renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  selectedDay = null; renderCalendar();
});

// ════════════════════════════════════════════════════════════
// ── CHARTS ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════
let chartInstances = {};

function renderCharts() {
  Chart.defaults.color = '#7a7a99';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

  renderRadarChart();
  renderActivityChart();
  renderBarsChart();
}

function renderRadarChart() {
  const ctx = document.getElementById('chart-radar').getContext('2d');
  if (chartInstances.radar) chartInstances.radar.destroy();

  // Always show all 7 — locked chakras show as 0 and dimmed
  chartInstances.radar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: CHAKRA_DATA.map(c => c.name),
      datasets: [{
        data:            CHAKRA_DATA.map(c => isUnlocked(c.id) ? getChakra(c.id).progress : 0),
        backgroundColor: 'rgba(139,92,246,0.15)',
        borderColor:     'rgba(139,92,246,0.8)',
        borderWidth:     2,
        pointBackgroundColor: CHAKRA_DATA.map(c => isUnlocked(c.id) ? c.color : 'rgba(255,255,255,0.15)'),
        pointBorderColor:     '#fff',
        pointRadius:     5,
        pointHoverRadius: 7,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 20, display: false },
          grid:  { color: 'rgba(255,255,255,0.07)' },
          angleLines: { color: 'rgba(255,255,255,0.07)' },
          pointLabels: { font: { size: 11 }, color: '#aaa' },
        },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderActivityChart() {
  const ctx = document.getElementById('chart-activity').getContext('2d');
  if (chartInstances.activity) chartInstances.activity.destroy();

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toLocaleDateString('en-CA');
  });

  const counts = days.map(d =>
    CHAKRA_DATA.filter(c => isUnlocked(c.id) && getChakra(c.id).history.includes(d)).length
  );

  const labels = days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

  chartInstances.activity = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: counts.map(n =>
          n === 0 ? 'rgba(255,255,255,0.05)' :
          n <= 2  ? 'rgba(139,92,246,0.4)' :
          n <= 4  ? 'rgba(139,92,246,0.65)' : 'rgba(139,92,246,0.9)'
        ),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { min: 0, max: 7, ticks: { stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => `${ctx.raw} chakra${ctx.raw !== 1 ? 's' : ''} practiced` }
      }},
    },
  });
}

function renderBarsChart() {
  const ctx = document.getElementById('chart-bars').getContext('2d');
  if (chartInstances.bars) chartInstances.bars.destroy();

  const sorted = [...CHAKRA_DATA].sort((a, b) =>
    (getChakra(b.id).progress) - (getChakra(a.id).progress)
  );

  chartInstances.bars = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(c => c.name),
      datasets: [{
        data:            sorted.map(c => getChakra(c.id).progress),
        backgroundColor: sorted.map(c => isUnlocked(c.id) ? c.color + 'cc' : c.color + '33'),
        borderColor:     sorted.map(c => isUnlocked(c.id) ? c.color : 'transparent'),
        borderWidth:     1,
        borderRadius:    6,
        borderSkipped:   false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => v + '%' } },
        y: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const c = sorted[ctx.dataIndex];
          const lvl = getLevelInfo(ctx.raw);
          return ` ${ctx.raw}% · ${lvl.name}${isUnlocked(c.id) ? '' : ' 🔒'}`;
        }}},
      },
    },
  });
}
