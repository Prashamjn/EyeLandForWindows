'use strict';
// Device and system notifications. The main process detects the real change (src/system), applies the category switches and
// de-duplicates; this file only presents it. Presentation depends on where the island is:
//   compact -> expands to the mini island, shows icon / title / name, collapses again
//   dashboard -> the activity area;   workspace / Control Centre -> a small banner.
// All other Control Centre events (state, progress, scan results) are forwarded on the bus for cc.js.
(() => {
  window.cc.onEvent((m) => {
    if (!m) return;
    if (m.kind === 'notify') {
      LI.notice({ id: 'dev-' + m.cat, kind: 'device', icon: m.icon, title: m.title, sub: m.sub, tone: m.tone }, Math.max(1200, m.ttl || 2800));
    }
    LI.bus.emit('cc', m);
  });
})();
