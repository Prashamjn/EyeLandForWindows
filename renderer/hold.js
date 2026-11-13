'use strict';
// Collapse holds: reasons the island must not auto-collapse right now (native file dialog, drag in progress, an export running,
// a long Control Centre call...). Each hold has a MAXIMUM AGE so a forgotten hold can never keep the island open forever.
//   LI.hold.begin(key, maxAgeMs?)   LI.hold.end(key)   LI.hold.run(key, promise, maxAgeMs?)
(() => {
  const holds = IslandLogic.createHolds({ defaultMaxAge: 5 * 60 * 1000 });
  const wrap = (fn, name) => (...a) => { const r = fn(...a); try { console.debug('[hover] ' + JSON.stringify({ t: Math.round(performance.now()), kind: 'hold-' + name, key: a[0], active: holds.keys() })); } catch { /* tracing only */ } LI.bus.emit('hold', holds.keys()); return r; };
  LI.hold = {
    begin: wrap((k, max) => holds.begin(k, max), 'begin'),
    end: wrap((k) => holds.end(k), 'end'),
    async run(k, p, max) { LI.hold.begin(k, max); try { return await p; } finally { LI.hold.end(k); } },
    active: () => holds.active(),
    keys: () => holds.keys(),
  };
})();
