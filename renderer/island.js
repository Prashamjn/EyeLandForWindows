'use strict';
// Island state machine: compact <-> mini <-> full. All the morphing is CSS (see island.css), driven by data-state here.
(() => {
  const { $ } = LI;
  const island = $('#island');
  const mIco = $('#mIco'), mFill = $('#mFill'), mTitle = $('#mTitle'), mSub = $('#mSub'), mVal = $('#mVal');
  const cIco = $('#cIco'), cTimer = $('#cTimer');
  let state = 'compact', inside = false, interactive = false, hoverT = 0, leaveT = 0, miniT = 0;

  const setState = (s) => { state = s; island.dataset.state = s; };
  const setInteractive = (on) => { if (on !== interactive) { interactive = on; api.setInteractive(on); } };

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
    if (state === 'full') return;                        // the activity area already shows it
    paintMini(a);
    setState('mini');
    clearTimeout(miniT);
    miniT = setTimeout(() => { if (state === 'mini') setState('compact'); }, ttl);
  }

  /* ---------- full ---------- */
  function open(opts = {}) {
    clearTimeout(miniT); clearTimeout(leaveT);
    if (opts.view) LI.dashboard.show(opts.view);
    LI.dashboard.onOpen();
    setState('full');
    LI.activity.refresh();
  }
  const typing = () => !!document.activeElement && document.activeElement.id === 'taskInput';
  function scheduleClose() {
    clearTimeout(leaveT);
    leaveT = setTimeout(() => { if (!inside && !typing()) close(); }, 350);
  }
  function close() { clearTimeout(leaveT); setState('compact'); setInteractive(false); }

  /* ---------- compact indicators (only while something is running) ---------- */
  function indicators({ coffee, timerText, timerRunning }) {
    cIco.hidden = !coffee; cIco.innerHTML = coffee ? LI.icon('coffee') : '';
    cTimer.hidden = !timerText; cTimer.textContent = timerText || ''; cTimer.classList.toggle('running', !!timerRunning);
    island.toggleAttribute('data-busy', !!(coffee || timerText));
  }

  /* ---------- position / edge ---------- */
  function layout() {
    const S = LI.S, off = S.offsetY || 0, bottom = S.position === 'bottom';
    document.body.dataset.edge = off === 0 ? (bottom ? 'bottom-flush' : 'top-flush') : 'floating';
    island.style.top = bottom ? 'auto' : off + 'px';
    island.style.bottom = bottom ? off + 'px' : 'auto';
  }

  /* ---------- hover: the main process polls the cursor and sends window-relative coordinates ---------- */
  function onCursor({ x, y }) {
    const r = island.getBoundingClientRect();
    const pad = state === 'full' ? 12 : 8;
    const hit = x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    if (hit && !inside) {
      inside = true; clearTimeout(leaveT);
      if (state !== 'full') { clearTimeout(hoverT); hoverT = setTimeout(open, LI.S.hoverDelay ?? 120); }
    } else if (!hit && inside) {
      inside = false; clearTimeout(hoverT);
      if (state === 'full') scheduleClose();
    }
    setInteractive(state === 'full' && hit);
  }

  LI.island = { get state() { return state; }, open, close, mini, indicators, layout, onCursor, scheduleClose, isInside: () => inside };
})();
