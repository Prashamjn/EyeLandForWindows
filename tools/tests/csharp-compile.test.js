// Compiles every native C# source set with Mono's mcs (C# 5, the language level of Windows PowerShell 5.1) and FAILS on any warning.
// Why: Windows PowerShell's Add-Type turns some warnings into errors ("Warning as Error: The field 'LiWlan.last' is assigned but its value
// is never used"), which makes a helper crash at start-up. A Phase 3 change shipped exactly that because warnings were not checked.
// Mono is not Windows csc: this is a cheap early gate; the real gate is tools/windows/compile-native.ps1 on Windows (CI).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const have = spawnSync('mcs', ['--version'], { encoding: 'utf8' }).status === 0;
const cs = path.join(__dirname, '..', '..', 'native', 'cs');
const SETS = { audio: ['Audio.cs'], net: ['Wlan.cs'], bt: ['Bluetooth.cs', 'WinRtEvents.cs'], power: ['Power.cs'] };
// mcs-only false positives in Phase 2 code that Windows csc accepts (the helper starts on Windows): a Timer kept referenced against GC, and an out-parameter handle.
const ALLOWED = [/LiPower\.effHandle/, /LiPower\.slow/];

for (const [name, files] of Object.entries(SETS)) {
  test(`native C# "${name}" compiles with no warnings (C# 5)`, { skip: !have && 'mcs (Mono) not installed' }, () => {
    const out = path.join(os.tmpdir(), `li-${name}-${process.pid}.dll`);
    const r = spawnSync('mcs', ['-langversion:5', '-warn:4', '-target:library', `-out:${out}`, '-r:System.dll', '-r:System.Core.dll', 'LiIO.cs', ...files], { cwd: cs, encoding: 'utf8' });
    fs.rmSync(out, { force: true });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const warnings = (r.stdout + r.stderr).split('\n').filter((l) => /warning CS/.test(l) && !ALLOWED.some((a) => a.test(l)));
    assert.deepStrictEqual(warnings, [], 'compiler warnings (Windows Add-Type can promote these to errors):\n' + warnings.join('\n'));
  });
}
