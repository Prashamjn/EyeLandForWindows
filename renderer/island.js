'use strict';
// Island state machine: compact <-> mini <-> full, and (when full) mode "dash" (dashboard) or "work" (a plugin page or the
// Control Centre). All the morphing is CSS (see island.css), driven by data-state / data-mode here.
//
// "Pinned" = full + work mode. While pinned the island does not close when the cursor leaves (you are using a plugin), the
// window becomes focusable so the keyboard works and native dialogs attach to it, and it only collapses on Back/Esc/Collapse
// or after the window has been unfocused for `blurCollapseSec`. Background activity never takes keyboard focus.
(() => {
  const { $ } = LI;
  const island = $('#island');
  const mIco = $('#mIco'), mFill = $('#mFill'), mTitle = $('#mTitle'), mSub = $('#mSub'), mVal = $('#mVal');
  const cIco = $('#cIco'), cTimer = $('#cTimer');
  let state = 'compact', mode = 'dash', inside = false, interactive = false, pinned = false, hoverT = 0, leaveT = 0, miniT = 0, blurT = 0;

  const setInteractive = (on) => { if (on !== interactive) { interactive = on; api.setInteractive(on); } };
  function syncPin() {
    const want = state === 'full' && mode === 'work';
    if (want === pinned) return;
    pinned = want; api.setFocusable(want);
    if (!want) clearTimeout(blurT);
  }
  const setState = (s) => { state = s; island.dataset.state = s; syncPin(); };
  function setMode(m) { mode = m; island.dataset.mode = m; syncPin(); }

  /* ---------- mini ---------- */
  function paintMini(a) {
    const kind = a.mini || (typeof a.progress === 'number' ? 'bar' : 'text');
    island.dataset.mini = kind;                          // set before the state flips so the shell animates to the right size
    island.dataset.tone = a.tone || '';
    mIco.innerHTML = LI.iconHtml(a);
    mTitle.textContent = a.title || '';
    mSub.textContent = a.sub || ''; mSub.hidden = !a.sub;
    mFill.style.width = (typeof a.progress === 'number' ? LI.clamp(a.progress) : 0) + '%';
    mVal.textContent = a.value || '';
  }
  function mini(a, ttl) {
    if (state === 'full') return;                        // the activity area / workspace banner already shows it
    paintMini(a);
    setState('mini');
    clearTimeout(miniT);
    miniT = setTimeout(() => { if (state === 'mini') setState('compact'); }, ttl);
  }

  /* ---------- full ---------- */
  // show(): just expand (no routing). open(): expand and optionally route to a dashboard view, plugin or Control Centre.
  function show() {
    clearTimeout(miniT); clearTimeout(leaveT); clearTimeout(blurT);
    LI.dashboard.onOpen();
    setState('full');
    LI.activity.refresh();
  }
  function open(opts = {}) {
    const W = LI.workspace;
    if (opts.plugin) W.openPlugin(opts.plugin, opts.payload);
    else if (opts.cc) W.openCC(opts.cc === true ? undefined : opts.cc);
    else if (opts.view) W.toDash(opts.view);
    else if (state !== 'full' && W.route().type !== 'dash' && LI.S.expandOn === 'home') W.toDash();   // default is to resume where you were
    show();
  }
  const typing = () => !!document.activeElement && document.activeElement.id === 'taskInput';
  function scheduleClose() {
    clearTimeout(leaveT);
    leaveT = setTimeout(() => { if (!inside && !typing() && !pinned) close(); }, 350);
  }
  function close() { clearTimeout(leaveT); clearTimeout(blurT); setState('compact'); setInteractive(false); }

  // clicking another app while a plugin is open: collapse after a grace period (the page stays mounted, so nothing is lost)
  window.addEventListener('blur', () => {
    const s = +LI.S.blurCollapseSec;
    if (!pinned || !(s > 0)) return;
    clearTimeout(blurT);
    blurT = setTimeout(() => { if (pinned && !document.hasFocus() && !inside) close(); }, s * 1000);
  });
  window.addEventListener('focus', () => clearTimeout(blurT));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state !== 'full') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.value && e.target.dataset.escClears) return;
    LI.workspace.escape();
  });

  /* ---------- compact indicators (only while something is running) ---------- */
  function indicators({ coffee, timerText, timerRunning }) {
    cIco.hidden = !coffee; cIco.innerHTML = coffee ? LI.icon('coffee') : '';
    cTimer.hidden = !timerText; cTimer.textContent = timerText || ''; cTimer.classList.toggle('running', !!timerRunning);
    island.toggleAttribute('data-busy', !!(coffee || timerText));
  }

  /* ---------- position / edge ----------
     The Electron window itself is placed `offsetY` px from the screen edge (main.js place()), so the island sits flush at the
     edge of its transparent canvas; here we only choose which edge and whether the outer silhouette is a full pill. */
  function layout() {
    const S = LI.S, off = +S.offsetY || 0, bottom = S.position === 'bottom';
    document.body.dataset.pos = bottom ? 'bottom' : 'top';
    document.body.dataset.edge = off === 0 ? (bottom ? 'bottom-flush' : 'top-flush') : 'floating';
    island.style.top = bottom ? 'auto' : '0'; island.style.bottom = bottom ? '0' : 'auto';
  }

  /* ---------- hover: the main process polls the cursor and sends window-relative coordinates ---------- */
  function onCursor({ x, y }) {
    const r = island.getBoundingClientRect();
    const pad = state === 'full' ? 12 : 8, gap = (+LI.S.offsetY || 0), bottom = LI.S.position === 'bottom';
    // the gap between the screen edge and the capsule counts as part of the target (Fitts's law: you can slam the cursor to the edge)
    const hit = x >= r.left - pad && x <= r.right + pad
      && y >= r.top - pad - (bottom ? 0 : gap) && y <= r.bottom + pad + (bottom ? gap : 0);
    if (hit && !inside) {
      inside = true; clearTimeout(leaveT); clearTimeout(blurT);
      if (state !== 'full') { clearTimeout(hoverT); hoverT = setTimeout(open, LI.S.hoverDelay ?? 120); }
    } else if (!hit && inside) {
      inside = false; clearTimeout(hoverT);
      if (state === 'full') scheduleClose();
    }
    setInteractive(state === 'full' && hit);
  }

  LI.island = {
    get state() { return state; }, get mode() { return mode; }, get pinned() { return pinned; },
    open, show, close, mini, indicators, layout, onCursor, scheduleClose, setMode, isInside: () => inside,
  };
})();
