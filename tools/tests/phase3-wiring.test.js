'use strict';
// Static wiring checks for Phase 3: things that break silently if someone edits one side only.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const main = read('main.js'), preload = read('preload.js'), html = read('renderer/index.html');

test('every script and stylesheet referenced by index.html exists', () => {
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) assert.ok(fs.existsSync(path.join(ROOT, 'renderer', m[1])), m[1]);
});
test('script order: shared logic and core before hold/motion before island; audio-common before the audio plugins', () => {
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]); const at = (n) => order.indexOf(n);
  assert.ok(at('../shared/island-logic.js') < at('core.js') && at('core.js') < at('hold.js') && at('hold.js') < at('motion.js') && at('motion.js') < at('island.js'));
  assert.ok(at('../shared/audio/plan.js') > at('../shared/audio/timecode.js'));
  assert.ok(at('plugins/audio-common.js') < at('plugins/audio-trim.js') && at('plugins/audio-common.js') < at('plugins/audio-merge.js') && at('app.js') > at('media.js') && at('app.js') > at('chime.js'));
});
test('the two Audio Studio plugins are in the catalog (group Audio Studio), registered, and have icons', () => {
  const cat = require('../../shared/catalog.js'); const list = cat.CATALOG || cat.catalog || cat;
  const items = Array.isArray(list) ? list : list.items || Object.values(list);
  for (const id of ['audioTrim', 'audioMerge']) {
    const e = items.find((x) => x.id === id); assert.ok(e, id + ' in catalog'); assert.equal(e.group, 'Audio Studio');
    assert.ok(read(`renderer/plugins/${id === 'audioTrim' ? 'audio-trim' : 'audio-merge'}.js`).includes(`id: '${id}'`), id + ' registered');
    assert.ok(new RegExp(`${id}:\\s*'`).test(read('shared/icons.js')), id + ' icon');
  }
  assert.equal(new Set(items.map((x) => x.id)).size, items.length, 'catalog ids are unique');
});
test('main.js wraps every native dialog so the island is held open, and sends hold events the preload and renderer consume', () => {
  assert.match(main, /for \(const fn of \['showOpenDialog', 'showSaveDialog', 'showMessageBox'\]\)/); assert.match(main, /send\('hold', \{ key: 'dialog', on: true \}\)/); assert.match(main, /send\('hold', \{ key: 'dialog', on: false \}\)/);
  assert.match(preload, /onHold: \(cb\) => on\('hold', cb\)/); assert.match(read('renderer/app.js'), /api\.onHold\(/);
});
test('the cursor poll is adaptive and ends with one far message', () => {
  assert.match(main, /IslandLogic\.pollInterval/); assert.match(main, /far: true/); assert.doesNotMatch(main, /setInterval\([^)]*getCursorScreenPoint/);
});
test('audio IPC channels in main.js and the renderer agree; the renderer cannot run arbitrary processes', () => {
  const used = new Set([...read('renderer/plugins/audio-common.js').matchAll(/'(ey:audio:[a-z-]+)'/g), ...read('renderer/plugins/audio-trim.js').matchAll(/'(ey:audio:[a-z-]+)'/g), ...read('renderer/plugins/audio-merge.js').matchAll(/'(ey:audio:[a-z-]+)'/g)].map((m) => m[1]));
  for (const ch of used) assert.ok(main.includes(`'${ch}'`), ch + ' handled in main.js');
  const code = (read('src/audio/ffmpeg.js') + read('src/audio/index.js') + read('src/audio/preview.js')).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /shell:\s*true|\bexecSync\b|\bexecFileSync\b|\bexecFile\b|child_process'\)\.exec\b|\{[^}]*\bexec\b[^}]*\} = require\('child_process'\)/, 'no shell execution in Audio Studio');
  assert.match(code, /const \{ spawn \} = require\('child_process'\)/, 'only spawn (argument arrays) is imported');
  assert.match(read('src/audio/ffmpeg.js'), /spawn\(bin, args, \{ windowsHide: true/);
  assert.doesNotMatch(preload, /ey:audio/, 'no special audio privileges in preload: it only forwards whitelisted channel names');
});
test('preview protocol is registered as privileged before ready and CSP allows it', () => {
  assert.match(main, /registerSchemesAsPrivileged\(\[\{ scheme: 'liaudio'/); assert.match(html, /media-src 'self' blob: liaudio:/); assert.match(main, /protocol\.handle\('liaudio'/);
});
test('the old fused "pinned" flag is gone from the renderer and tests', () => {
  for (const f of ['renderer/island.js', 'renderer/workspace.js', 'renderer/panels.js', 'renderer/dashboard.js']) assert.doesNotMatch(read(f), /island\.pinned|\bpinned\b\s*=/, f);
  for (const f of fs.readdirSync(path.join(ROOT, 'tools/ui-harness/scenarios'))) assert.doesNotMatch(read('tools/ui-harness/scenarios/' + f), /island\.pinned/, f);
});
test('the reduced-motion media query no longer silently disables animation (one JS-controlled switch)', () => {
  const css = ['renderer/island.css', 'renderer/tokens.css', 'renderer/workspace.css', 'renderer/dashboard.css', 'renderer/plugins.css', 'renderer/audio.css'].map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');   // comments may mention it
  assert.doesNotMatch(css, /@media\s*\(prefers-reduced-motion/); assert.match(read('renderer/motion.js'), /prefers-reduced-motion: reduce/);
});
test('Phase 3 settings have defaults in main.js and need no settings migration', () => {
  for (const k of ['hoverExpand', 'autoCollapse', 'collapseDelay', 'motionMode', 'mediaVisualizer', 'mediaArtwork', 'lyricsEnabled', 'chargeSound', 'chargeVolume', 'chargeDisconnectSound', 'audioFormat', 'audioBitrate', 'audioDir', 'audioRemember']) assert.match(main, new RegExp(`\\b${k}:`), k);
  assert.match(main, /\.\.\.defaults, \.\.\.\(saved/); assert.doesNotMatch(main, /settingsVersion:\s*3/);
  assert.match(main, /lyricsEnabled: false/, 'lyrics send the track name to a third party: off by default');
});
test('no browser storage APIs in the new renderer code (artifact rule does not apply, but the app keeps state in settings only)', () => {
  for (const f of ['hold.js', 'motion.js', 'media.js', 'chime.js', 'plugins/audio-common.js', 'plugins/audio-trim.js', 'plugins/audio-merge.js']) assert.doesNotMatch(read('renderer/' + f), /localStorage|sessionStorage|indexedDB/, f);
});
test('every C# file in native/cs is covered by the compile tool (warnings treated as errors)', () => {
  const cs = fs.readdirSync(path.join(ROOT, 'native/cs')).filter((f) => f.endsWith('.cs')); const tool = read('tools/windows/compile-native.ps1');
  assert.ok(cs.includes('LiIO.cs'));
  // LiIO.cs is the shared base that common.ps1 (Import-LiSource) prepends to EVERY helper set; every other file must be in a set
  assert.match(read('native/lib/common.ps1'), /LiIO\.cs/);
  for (const f of cs.filter((x) => x !== 'LiIO.cs')) { assert.ok(tool.includes(`'${f}'`), f + ' is compiled by compile-native.ps1'); assert.ok(read('tools/tests/csharp-compile.test.js').includes(`'${f}'`), f + ' is compiled by the mcs warnings-as-errors test'); }
});
