'use strict';
// The dynamic activity area. An "activity" is plain data:
//   { id, kind, icon | color, title, sub?, progress? (0-100), value?, tone? ('success'|'warn'),
//     mini? ('bar'|'text'|'media'), controls? [{ id, icon, label, primary?, onClick }] }
// Providers (volume, brightness, media, timer, notices...) only call LI.activity.show() or LI.activity.setBase().
// Future activity types need no change here or in the dashboard.
//
// Selection rule (deliberately simple in Phase 1, no prioritisation engine):
//   1. the most recent transient activity (volume, brightness, notice...) until its ttl ends,
//   2. otherwise the first persistent one in BASE_ORDER (media, then focus timer),
//   3. otherwise a quiet empty state.
(() => {
  const { $, iconHtml, clamp } = LI;
  const root = $('#activity'), tile = $('#actTile'), title = $('#actTitle'), sub = $('#actSub');
  const track = $('#actTrack'), fill = $('#actFill'), val = $('#actVal'), ctrls = $('#actCtrls');

  const BASE_ORDER = ['media', 'timer'];
  const EMPTY = { id: 'empty', kind: 'empty', icon: 'inbox', title: 'Nothing happening', sub: 'Volume, media and notifications appear here' };
  const bases = {};
  let transient = null, tId = 0, shown = null, sig = '';

  const current = () => transient || BASE_ORDER.map((k) => bases[k]).find(Boolean) || EMPTY;

  function paint() {
    if (LI.island.state !== 'full') return;          // nothing visible: repainted when the island opens
    const a = current();
    const swap = !shown || shown.id !== a.id;
    shown = a;
    root.dataset.kind = a.kind || 'notice';
    root.dataset.tone = a.tone || '';
    tile.innerHTML = iconHtml(a);
    title.textContent = a.title || '';
    const subChanged = sub.textContent !== (a.sub || '');
    sub.textContent = a.sub || ''; sub.hidden = !a.sub;
    if (subChanged && !swap && a.kind === 'media') LI.motion.enter(sub, 'up', { dur: 'ui' });   // a new lyric line / status fades in with a few px of movement
    const hasP = typeof a.progress === 'number';
    track.hidden = !hasP; if (hasP) fill.style.width = clamp(a.progress) + '%';
    val.textContent = a.value || ''; val.hidden = !a.value;

    const list = a.controls || [];
    const s = list.map((c) => `${c.id}:${c.icon}:${c.primary ? 1 : 0}:${c.disabled ? 1 : 0}`).join('|');
    if (s !== sig) {                                   // rebuild buttons only when their shape changes
      sig = s;
      ctrls.replaceChildren(...list.map((c, i) => {
        const b = document.createElement('button');
        b.className = 'act-btn fill' + (c.primary ? ' primary' : '');
        b.dataset.i = i; b.title = c.label; b.setAttribute('aria-label', c.label);
        b.innerHTML = LI.icon(c.icon); b.disabled = !!c.disabled;
        return b;
      }));
    }
    if (swap) { root.classList.remove('swap'); void root.offsetWidth; root.classList.add('swap'); }
  }
  // one delegated listener, resolved against the activity currently on screen
  ctrls.addEventListener('click', (e) => {
    const b = e.target.closest('.act-btn'); if (!b || !shown) return;
    const c = (shown.controls || [])[+b.dataset.i]; if (c && c.onClick) c.onClick();
  });

  LI.activity = {
    // transient: shows in the activity area and (unless mini:false) as a mini island while the island is compact
    show(a, { ttl = 1800, mini = true } = {}) {
      transient = a; clearTimeout(tId);
      tId = setTimeout(() => { if (transient === a) { transient = null; paint(); } }, ttl);
      paint();
      if (mini) LI.island.mini(a, ttl);
    },
    // persistent: stays until replaced or cleared (pass null)
    setBase(id, a) { bases[id] = a || null; paint(); },
    refresh: paint,
    current,
  };
})();
