const fs = require('fs'), path = require('path');
const ok = (n, c, x = '') => console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`);
module.exports = async (c) => {
  await c.wait(900);
  const th = await c.ev("document.body.dataset.theme + '/' + document.body.dataset.accent + '/' + document.body.dataset.edge");
  ok('legacy settings: saved theme kept, new accent defaults to blue, offsetY 0 -> flush edge', th === 'graphite/blue/bottom-flush', th);
  const tasks = await c.ev("LI.S.todos.map(t => t.text).join('|')");
  ok('legacy settings: existing tasks preserved', tasks === 'Buy milk|Call Sam', tasks);
  const win = c.island(); const b = win.getBounds(); const d = require('electron').screen.getPrimaryDisplay().bounds;
  ok('position=bottom: window sits on bottom edge', b.y + b.height === d.y + d.height, JSON.stringify(b));
  await c.ev("LI.island.open()"); await c.wait(1000); await c.shot('40_legacy_bottom_full');
  const rect = JSON.parse(await c.ev("JSON.stringify(document.getElementById('island').getBoundingClientRect())"));
  ok('bottom position: island anchored to window bottom and grows upward', Math.abs(rect.bottom - 460) < 1 && rect.height > 380, JSON.stringify({ top: rect.top, bottom: rect.bottom }));
  await c.ev("LI.island.close()"); await c.wait(700); await c.shot('41_legacy_bottom_compact');
  const disk = JSON.parse(fs.readFileSync(path.join(c.app.getPath('userData'), 'settings.json'), 'utf8'));
  ok('legacy eyeColor key is left untouched on disk (harmless, not deleted)', disk.eyeColor === '#ff0000');
};
