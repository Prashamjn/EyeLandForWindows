'use strict';
// Regression tests for the Phase 3 media-helper freeze: the first version fetched artwork inside the main loop with an unbounded wait, so a
// player that never answered froze the helper and "Now Playing" went silent. These tests pin the fix. WinRT itself only exists on Windows,
// so the behavioural test runs the REAL Await function from native/media.ps1 against a stub operation.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
// git on Windows checks files out with CRLF line endings: normalise so the patterns below behave the same everywhere
const src = fs.readFileSync(path.join(ROOT, 'native', 'media.ps1'), 'utf8').replace(/\r\n/g, '\n');
const ps = ['pwsh', 'powershell'].find((c) => { try { return spawnSync(c, ['-NoProfile', '-Command', '1'], { timeout: 20000 }).status === 0; } catch { return false; } });

test('media.ps1: no unbounded wait anywhere', () => {
  assert.doesNotMatch(src, /\.Wait\(\s*-1\s*\)/, 'Wait(-1) blocks forever');
  assert.match(src, /function Await\(\$op, \$type, \$ms = \d+\)/); assert.match(src, /if \(-not \$t\.Wait\(\$ms\)\) \{ return \$null \}/);
});
test('media.ps1: the essentials are emitted BEFORE any artwork work, and a failing iteration cannot end the loop', () => {
  const loop = src.slice(src.indexOf('while ($true)'));
  assert.ok(loop.indexOf('Emit $obj') > 0 && loop.indexOf('Emit $obj') < loop.indexOf('Get-Art $p'), 'track info goes out first');
  assert.match(loop, /\} catch \{ Log \('loop error: '/, 'one bad iteration is logged, not fatal');
  assert.match(src, /Get-Art\(\$p\)[\s\S]*Await \(\$p\.Thumbnail\.OpenReadAsync\(\)\)[^\n]* 2500/, 'artwork read is time limited');
  assert.match(src, /artwork disabled/, 'artwork failing to load only disables artwork');
});
test('media.ps1: the Await function returns null on a hung operation instead of hanging, and returns real results', { skip: ps ? false : 'no PowerShell' }, () => {
  const fn = /function Await[\s\S]*?\n\}\n/.exec(src)[0];
  const script = `${fn}
$asTaskGeneric = New-Object psobject
$asTaskGeneric | Add-Member -MemberType ScriptMethod -Name MakeGenericMethod -Value { param($t) $m = New-Object psobject; $m | Add-Member -MemberType ScriptMethod -Name Invoke -Value { param($a, $b) $global:next }; $m }
$global:next = [System.Threading.Tasks.Task]::Delay(30000)
$sw = [System.Diagnostics.Stopwatch]::StartNew(); $r = Await 'op' ([int]) 400; $ms = $sw.ElapsedMilliseconds
$global:next = [System.Threading.Tasks.Task]::FromResult([int]42)
$v = Await 'op' ([int]) 400
Write-Output ('RESULT hung=' + ($null -eq $r) + ' ms=' + $ms + ' value=' + $v)`;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'li-media-')), 't.ps1'); fs.writeFileSync(f, script);
  const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', timeout: 60000 });
  const m = /RESULT hung=(\w+) ms=(\d+) value=(\d+)/.exec(r.stdout); assert.ok(m, 'script output: ' + r.stdout + r.stderr);
  assert.equal(m[1], 'True', 'a hung operation yields $null'); assert.ok(+m[2] < 3000, 'and returns after about the timeout, not after 30 s (took ' + m[2] + ' ms)'); assert.equal(m[3], '42');
});
test('Power.cs polls the AC flag every 2 s so a plug / unplug does not depend on SystemEvents or the 60 s read', () => {
  const cs = fs.readFileSync(path.join(ROOT, 'native', 'cs', 'Power.cs'), 'utf8');
  assert.match(cs, /PollAc\(\)/); assert.match(cs, /2000, 2000\)/); assert.match(cs, /p\.ac == lastAc\) return/); assert.match(cs, /SystemEvents\.PowerModeChanged/, 'the event is still used when it works');
});
test('every charger decision is logged (so a silent chime can be explained from the terminal)', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'src', 'system', 'index.js'), 'utf8');
  for (const t of ['start-up quiet period', 'duplicate within 4 s', 'sound sent', 'no sound (']) assert.ok(idx.includes(t), t);
});
