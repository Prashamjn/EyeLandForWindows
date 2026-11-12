'use strict';
// Island state machine: compact <-> mini <-> full, and (when full) mode "dash" (dashboard) or "work" (a plugin page or the
// Control Centre). All the morphing is CSS (see island.css), driven by data-state / data-mode / data-dir set here.
//
// Two things that used to be fused are now separate (Phase 3):
//   workFocus  full + work mode: the window is focusable so the keyboard works and native dialogs attach. It says NOTHING about
//              collapsing: the island collapses from every screen when the cursor leaves.
//   locked     the user's deliberate Pin: keeps the island expanded. In-memory only, never the default. Released by the Collapse
//              button, by Esc on the dashboard, or by pressing Pin again.
// Whether to collapse is decided by IslandLogic.decideCollapse (shared/island-logic.js, unit-tested): the cursor, locked, holds
// (LI.hold: native dialogs, drags, exports, long Control Centre calls), a focused text input in use, and very recent typing.
(() => {
  const { $ } = LI;
  const IL = IslandLogic;
  const island = $('#island');
  const mIco = $('#mIco'), mFill = $('#mFill'), mTitle = $('#mTitle'), mSub = $('#mSub'), mVal = $('#mVal');
  const cIco = $('#cIco'), cTimer = $('#cTimer'), cViz = $('#cViz');
  let state = 'compact', mode = 'dash', inside = false, interactive = false, workFocus = false, locked = false;
  let hoverT = 0, leaveT = 0, miniT = 0, blurT = 0, lastKeyAt = 0, lastInputAt = 0;
  const RANK = { compact: 0, mini: 1, full: 2 };
  const now = () => performance.now();

  /* ---------- settings (read live, so changes apply immediately) ---------- */
  const hoverExpand = () => LI.S.hoverExpand !== false;
  const autoCollapse = () => LI.S.autoCollapse !== false;
  const collapseDelay = () => IL.clampDelay(LI.S.collapseDelay, 350, 100, 2000);
  const openDelay = () => IL.clampDelay(LI.S.hoverDelay, 120, 0, 600);

  const setInteractive = (on) => { if (on !== interactive) { interactive = on; api.setInteractive(on); } };
  function syncFocus() {
    const want = state === 'full' && mode === 'work';
    if (want === workFocus) return;
    workFocus = want; api.setFocusable(want);
    if (!want) clearTimeout(blurT);
  }
  function setState(s) {
    if (s !== state) island.dataset.dir = RANK[s] > RANK[state] ? 'expand' : 'collapse';
    state = s; island.dataset.state = s; syncFocus();
  }
  function setMode(m) {
    if (m !== mode && state === 'full') island.dataset.dir = 'nav';          // dashboard <-> workspace: same state, different size
    mode = m; island.dataset.mode = m; syncFocus();
  }

  /* ---------- the deliberate lock (Pin) ---------- */
  function setLocked(v) {
    v = !!v; if (v === locked) return;
    locked = v; island.dataset.locked = v ? '1' : '';
    LI.bus.emit('lock', locked);
    if (!locked && state === 'full' && !inside) scheduleClose();
  }

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

  /* ---------- collapse ---------- */
  const editable = () => {
    const a = document.activeElement; if (!a || a === document.body) return false;
    if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
    return a.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset|color|file|image)$/i.test(a.type);
  };
  const situation = () => ({ autoCollapse: autoCollapse(), state, inside, locked, holds: LI.hold.active(), editableFocused: editable(), sinceInputMs: now() - lastInputAt, sinceKeyMs: now() - lastKeyAt });
  function tryClose() {
    const d = IL.decideCollapse(situation());
    if (d.collapse) return close();
    if (['hold', 'typing', 'keyboard'].includes(d.reason)) leaveT = setTimeout(tryClose, 300);   // something temporary is in the way: look again shortly
  }
  // the cursor left: wait the grace period, then decide (called by hover logic, the task input blur handler and when a hold ends)
  function scheduleClose(ms) {
    clearTimeout(leaveT);
    if (!autoCollapse() || state !== 'full') return;
    leaveT = setTimeout(tryClose, ms == null ? collapseDelay() : ms);
  }
  function close() { clearTimeout(leaveT); clearTimeout(blurT); clearTimeout(hoverT); locked = false; island.dataset.locked = ''; LI.bus.emit('lock', false); setState('compact'); setInteractive(false); }
  LI.bus.on('hold', () => { if (state === 'full' && !inside && !LI.hold.active()) scheduleClose(); });   // a hold ended while the cursor is away

  // another app took focus while a workspace is open (never while holds are active: a native dialog also blurs the window)
  window.addEventListener('blur', () => {
    const s = +LI.S.blurCollapseSec;
    if (state !== 'full' || locked || !(s > 0) || !workFocus) return;
    clearTimeout(blurT);
    const check = () => {
      if (state !== 'full' || locked || document.hasFocus() || inside) return;
      if (LI.hold.active()) { blurT = setTimeout(check, 1000); return; }
      close();
    };
    blurT = setTimeout(check, s * 1000);
  });
  window.addEventListener('focus', () => clearTimeout(blurT));

  window.addEventListener('keydown', (e) => {
    lastKeyAt = now(); if (editable()) lastInputAt = lastKeyAt;
    if (e.key !== 'Escape' || state !== 'full') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.value && e.target.dataset.escClears) return;
    LI.workspace.escape();
  }, true);
  document.addEventListener('input', () => { lastInputAt = now(); }, true);
  document.addEventListener('focusin', () => { if (editable()) lastInputAt = now(); }, true);
  // a file being dragged over the island (from Explorer) must not collapse it mid-drop; the hold has a short maximum age
  let dragDepth = 0;
  window.addEventListener('dragenter', () => { dragDepth++; LI.hold.begin('drag', 20000); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) LI.hold.end('drag'); });
  window.addEventListener('drop', () => { dragDepth = 0; LI.hold.end('drag'); });
  window.addEventListener('dragend', () => { dragDepth = 0; LI.hold.end('drag'); });
  // with hover expansion switched off, a click on the capsule opens it
  island.addEventListener('click', () => { if (!hoverExpand() && state !== 'full') open(); });

  /* ---------- compact indicators (only while something is running) ---------- */
  function indicators({ coffee, timerText, timerRunning, playing, media }) {
    cIco.hidden = !coffee; cIco.innerHTML = coffee ? LI.icon('coffee') : '';
    cTimer.hidden = !timerText; cTimer.textContent = timerText || ''; cTimer.classList.toggle('running', !!timerRunning);
    const viz = !!media && LI.S.mediaVisualizer !== false;     // present only while a session exists; animated only while it is actually playing
    cViz.hidden = !viz; cViz.dataset.play = viz && playing ? '1' : '0';
    island.toggleAttribute('data-busy', !!(coffee || timerText || viz));
  }

  /* ---------- position / edge ---------- */
  function layout() {
    const S = LI.S, off = +S.offsetY || 0, bottom = S.position === 'bottom';
    document.body.dataset.pos = bottom ? 'bottom' : 'top';
    document.body.dataset.edge = off === 0 ? (bottom ? 'bottom-flush' : 'top-flush') : 'floating';
    island.style.top = bottom ? 'auto' : '0'; island.style.bottom = bottom ? '0' : 'auto';
  }

  /* ---------- hover: the main process polls the cursor and sends window-relative coordinates ---------- */
  const px = (name) => parseFloat(getComputedStyle(island).getPropertyValue(name));
  function onCursor({ x, y, far }) {
    const r = island.getBoundingClientRect();
    const bottom = LI.S.position === 'bottom';
    // the size the island is morphing TO (--w/--h), so a cursor already inside the final panel never reads as "left"
    const target = { w: px('--w'), h: px('--h') };
    const hit = !far && IL.hitTest({ x, y }, r, { pad: state === 'full' ? 12 : 8, gap: +LI.S.offsetY || 0, bottom, target });
    if (hit && !inside) {
      inside = true; clearTimeout(leaveT); clearTimeout(blurT);
      if (state !== 'full' && hoverExpand()) { clearTimeout(hoverT); hoverT = setTimeout(open, openDelay()); }
    } else if (!hit && inside) {
      inside = false; clearTimeout(hoverT);
      if (state === 'full') scheduleClose();
    }
    // the window only catches mouse events while the cursor is on the visible island (and, in click-to-open mode, on the capsule)
    setInteractive(hit && (state === 'full' || !hoverExpand()));
  }

  LI.island = {
    get state() { return state; }, get mode() { return mode; }, get workFocus() { return workFocus; }, get locked() { return locked; },
    open, show, close, mini, indicators, layout, onCursor, scheduleClose, setMode, setLocked, isInside: () => inside,
    decision: () => IL.decideCollapse(situation()),
  };
})();
