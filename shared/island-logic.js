'use strict';
// Pure decision logic for the island's hover / collapse behaviour. No DOM, no Electron, no timers of its own (a clock is injected),
// so every rule here is unit-tested (tools/tests/island-logic.test.js) and the renderer / main process only wire it up.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.IslandLogic = factory();
})(this, function () {
  /* ---------- hit-testing ----------
     rect: the island's CURRENT visible rectangle (window coordinates). target: {w,h} it is growing/shrinking to (read from --w/--h).
     While the island is mid-morph the cursor counts as "inside" if it is inside the union of the current rect and the target rect, so
     a pointer already resting where the final panel will be never reads as having left. The gap between the screen edge and the
     capsule (offsetY) is part of the target on the anchored side (Fitts's law). Transparent window margins are NOT part of it. */
  function targetRect(rect, target, bottom) {
    if (!target || !(target.w > 0) || !(target.h > 0)) return rect;
    const cx = (rect.left + rect.right) / 2, left = cx - target.w / 2, right = cx + target.w / 2;
    return bottom ? { left, right, bottom: rect.bottom, top: rect.bottom - target.h } : { left, right, top: rect.top, bottom: rect.top + target.h };
  }
  function hitTest(pt, rect, { pad = 8, gap = 0, bottom = false, target = null } = {}) {
    if (!pt || !rect) return false;
    const t = targetRect(rect, target, bottom);
    const L = Math.min(rect.left, t.left), R = Math.max(rect.right, t.right), T = Math.min(rect.top, t.top), B = Math.max(rect.bottom, t.bottom);
    return pt.x >= L - pad && pt.x <= R + pad && pt.y >= T - pad - (bottom ? 0 : gap) && pt.y <= B + pad + (bottom ? gap : 0);
  }

  /* ---------- holds: reasons the island must not collapse ----------
     begin(key, maxAgeMs) / end(key). A hold older than its maxAge is ignored and removed, so a forgotten hold can never keep the island
     open forever. begin() on an existing key refreshes it (and its max age). */
  function createHolds({ now = Date.now, defaultMaxAge = 5 * 60 * 1000 } = {}) {
    const m = new Map();
    const purge = () => { const t = now(); for (const [k, h] of m) if (t - h.at > h.max) m.delete(k); };
    return {
      begin(key, maxAge) { m.set(String(key), { at: now(), max: maxAge > 0 ? maxAge : defaultMaxAge }); },
      end(key) { return m.delete(String(key)); },
      active() { purge(); return m.size > 0; },
      keys() { purge(); return [...m.keys()]; },
      clear() { m.clear(); },
      async run(key, promise, maxAge) { this.begin(key, maxAge); try { return await promise; } finally { this.end(key); } },
    };
  }

  /* ---------- the collapse decision ----------
     Everything the renderer knows at the moment the grace period ends. Returns { collapse, reason }.
     reason (when not collapsing): 'enabled' | 'not-full' | 'inside' | 'locked' | 'hold' | 'typing' | 'keyboard'. */
  function decideCollapse(s) {
    if (s.autoCollapse === false) return { collapse: false, reason: 'disabled' };
    if (s.state !== 'full') return { collapse: false, reason: 'not-full' };
    if (s.inside) return { collapse: false, reason: 'inside' };
    if (s.locked) return { collapse: false, reason: 'locked' };
    if (s.holds) return { collapse: false, reason: 'hold' };
    // a focused editable control blocks collapse only while it is in use; an abandoned one stops blocking after `inputIdleMs`
    if (s.editableFocused && s.sinceInputMs < (s.inputIdleMs ?? 15000)) return { collapse: false, reason: 'typing' };
    if (s.sinceKeyMs < (s.keyGraceMs ?? 1200)) return { collapse: false, reason: 'keyboard' };
    return { collapse: true, reason: 'left' };
  }

  // clamp helper used for the user-set delays
  const clampDelay = (v, dflt, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };

  /* ---------- adaptive cursor polling (main process) ----------
     p: cursor in screen DIPs; b: island window bounds. Fast (33 ms) only near/over the window, slower further away, idle when far.
     Returns { ms, zone } with zone 'near' | 'mid' | 'far'. */
  function pollInterval(p, b, { margin = 70 } = {}) {
    const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
    const d = Math.hypot(dx, dy);
    if (d <= margin) return { ms: 33, zone: 'near' };
    if (d <= 500) return { ms: 100, zone: 'mid' };
    return { ms: 250, zone: 'far' };
  }

  return { hitTest, targetRect, createHolds, decideCollapse, clampDelay, pollInterval };
});
