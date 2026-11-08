// Run with LI_SETTINGS='{"theme":"graphite","position":"bottom","offsetY":0,"eyeColor":"#ff0000","todos":[{"id":"a","text":"Buy milk","done":false},{"id":"b","text":"Call Sam","done":false}]}'
const fs = require('fs'), path = require('path');
const ok = (n, c, x = '') => console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`);
module.exports = async (c) => {
  await c.wait(900);
  const th = await c.ev("document.body.dataset.theme + '/' + document.body.dataset.accent + '/' + document.body.dataset.edge");
  ok('legacy settings: saved theme kept, accent defaults to blue, old default offsetY 0 migrated to a 10 px gap (floating capsule)', th === 'graphite/blue/floating', th);
  const tasks = await c.ev("LI.S.todos.map(t => t.text).join('|')");
  ok('legacy settings: existing tasks preserved', tasks === 'Buy milk|Call Sam', tasks);
  const win = c.island(); const b = win.getBounds(); const d = require('electron').screen.getPrimaryDisplay().bounds;
  ok('position=bottom: window sits 10 px above the bottom edge', b.y + b.height === d.y + d.height - 10, JSON.stringify(b));
  await c.ev("LI.island.open()"); await c.wait(1000); await c.shot('40_legacy_bottom_full');
  const rect = JSON.parse(await c.ev("JSON.stringify(document.getElementById('island').getBoundingClientRect())"));
  ok('bottom position: island anchored to window bottom and grows upward', Math.abs(rect.bottom - 620) < 1 && rect.height > 380, JSON.stringify({ top: rect.top, bottom: rect.bottom }));
  await c.ev("LI.island.close()"); await c.wait(700); await c.shot('41_legacy_bottom_compact');
  const disk = JSON.parse(fs.readFileSync(path.join(c.app.getPath('userData'), 'settings.json'), 'utf8'));
  ok('legacy eyeColor key is left untouched on disk (harmless, not deleted)', disk.eyeColor === '#ff0000');
};
