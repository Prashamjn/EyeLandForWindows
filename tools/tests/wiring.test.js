// Guards the Control Centre wiring: every operation must exist in the preload allow-list, the validators, run(), and a PowerShell handler.
// Phase 3 audit: this layer was verified correct; this test keeps it that way. It does NOT test Windows behaviour (see tools/windows/diagnose.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const preload = rd('preload.js'), index = rd('src/system/index.js');
const preOps = [...preload.match(/CC_OPS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([\w.]+)'/g)].map((m) => m[1]);
const { V } = require('../../src/system/validate');
const runCases = {}; for (const m of index.matchAll(/case '([\w.]+)':([^\n]*)/g)) runCases[m[1]] = m[2];
const handled = {};
for (const h of ['audio', 'net', 'bt', 'power']) handled[h] = new Set([...rd(`native/${h}.ps1`).matchAll(/^\s+'(\w+)'\s*[{]/gm)].map((m) => m[1]));

test('preload allow-list and validators list exactly the same operations', () => {
  assert.deepStrictEqual([...preOps].sort(), Object.keys(V).sort());
});
test('every operation has a case in run()', () => {
  for (const op of preOps) assert.ok(runCases[op], `run() has no case for ${op}`);
});
test('every helper command sent by run() is handled by the matching .ps1 file', () => {
  for (const op of preOps) {
    const m = /H\.(\w+)\.request\('(\w+)'/.exec(runCases[op] || ''); if (!m) continue;
    assert.ok(handled[m[1]].has(m[2]), `${op}: native/${m[1]}.ps1 does not handle "${m[2]}"`);
  }
});
test('IPC channel names agree between preload, main and the backend', () => {
  assert.match(preload, /ipcRenderer\.invoke\('cc:call'/);
  assert.match(rd('main.js'), /ipcMain\.handle\('cc:call'/);
  assert.match(preload, /on\('cc:event'/);
  assert.match(index, /send\('cc:event'/);
});
