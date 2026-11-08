// Run with different LI_SETTINGS / LI_EXPECT (see tools/ui-harness/README.md).
const fs = require('fs'), path = require('path');
const R = []; const ok = (n, c, x = '') => { R.push(!!c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
const subset = (want, have) => want && typeof want === 'object' && !Array.isArray(want) ? Object.entries(want).every(([k, v]) => subset(v, have && have[k])) : JSON.stringify(want) === JSON.stringify(have);
module.exports = async (c) => {
  await c.wait(1200);
  const want = JSON.parse(process.env.LI_EXPECT || '{}');
  const live = await c.ev('api.getSettings()');                       // what the app is actually running with
  const file = path.join(c.app.getPath('userData'), 'settings.json');
  const b = c.island().getBounds(), prim = require('electron').screen.getPrimaryDisplay().bounds;
  ok(`offsetY ${want.offsetY}: live setting and the real window position agree`, live.offsetY === want.offsetY && b.y === prim.y + want.offsetY, `live=${live.offsetY} y=${b.y}`);
  if (want.migrated) { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); ok('migration was written back once (settingsVersion 2)', saved.settingsVersion === 2 && saved.offsetY === want.offsetY); }
  else ok('no settings file is created or rewritten just by starting the app', !want.noFile || !fs.existsSync(file));
  for (const [k, v] of Object.entries(want.keep || {})) ok(`user data kept: ${k}`, subset(v, live[k]), JSON.stringify(live[k]).slice(0, 80));
  ok('Phase 2 defaults are present in the running settings', live.notifyBluetooth === true && live.expandOn === 'last' && Array.isArray(live.pinned) && live.monitorAudio === true && live.settingsVersion === 2);
  console.log('[TEST] summary pass=' + R.filter(Boolean).length + ' fail=' + R.filter((x) => !x).length);
};
