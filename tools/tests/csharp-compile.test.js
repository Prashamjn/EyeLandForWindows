// Compiles every native C# source set with Mono's mcs, or Windows PowerShell's Add-Type when Mono is unavailable.
// Why: Windows PowerShell's Add-Type turns some warnings into errors ("Warning as Error: The field 'LiWlan.last' is assigned but its value
// is never used"), which makes a helper crash at start-up. A Phase 3 change shipped exactly that because warnings were not checked.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const haveMcs = spawnSync('mcs', ['--version'], { encoding: 'utf8' }).status === 0;
const haveWindowsPowerShell = process.platform === 'win32'
  && spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;
const cs = path.join(__dirname, '..', '..', 'native', 'cs');
const common = path.join(__dirname, '..', '..', 'native', 'lib', 'common.ps1');
const SETS = { audio: ['Audio.cs'], net: ['Wlan.cs'], bt: ['Bluetooth.cs', 'WinRtEvents.cs'], power: ['Power.cs'] };
// mcs-only false positives in Phase 2 code that Windows csc accepts (the helper starts on Windows): a Timer kept referenced against GC, and an out-parameter handle.
const ALLOWED = [/LiPower\.effHandle/, /LiPower\.slow/];

for (const [name, files] of Object.entries(SETS)) {
  test(`native C# "${name}" compiles with no warnings (C# 5)`, { skip: !haveMcs && !haveWindowsPowerShell && 'mcs (Mono) and Windows PowerShell are not installed' }, () => {
    let r;
    if (haveMcs) {
      const out = path.join(os.tmpdir(), `li-${name}-${process.pid}.dll`);
      r = spawnSync('mcs', ['-langversion:5', '-warn:4', '-target:library', `-out:${out}`, '-r:System.dll', '-r:System.Core.dll', 'LiIO.cs', ...files], { cwd: cs, encoding: 'utf8' });
      fs.rmSync(out, { force: true });
    } else {
      const escapedCommon = common.replace(/'/g, "''");
      const sourceFiles = files.map((file) => `'${file}'`).join(',');
      const command = `. '${escapedCommon}'; Import-LiSource @(${sourceFiles}); 'compiled'`;
      r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8' });
    }

    const output = (r.stdout || '') + (r.stderr || '');
    assert.strictEqual(r.status, 0, output);
    if (!haveMcs) assert.match(output, /compiled/, output);
    const warnings = output.split('\n').filter((l) => /warning CS\d+/i.test(l) && (haveMcs ? !ALLOWED.some((a) => a.test(l)) : true));
    assert.deepStrictEqual(warnings, [], 'compiler warnings (Windows Add-Type can promote these to errors):\n' + warnings.join('\n'));
  });
}
