// Runs the real native/lib/common.ps1 request loop under PowerShell with a C# class that throws every kind of exception.
// Windows: powershell.exe (5.1, the runtime the app uses). Elsewhere: pwsh (set LI_PWSH to its path) or the test is skipped.
// Verifies error TRANSPORT (code + message survive PowerShell's exception wrapping). It does not call any Windows API.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const bin = process.env.LI_PWSH || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const have = spawnSync(bin, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0;
const fixture = path.join(__dirname, 'fixtures', 'errtest.ps1');

function run(cmds) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
    const replies = {}; let buf = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('timeout. stderr: ' + err)); }, 90000);
    p.stderr.on('data', (d) => { err += d; });
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.ev === 'ready') cmds.forEach((c, n) => p.stdin.write(JSON.stringify({ rid: n + 1, cmd: c }) + '\n'));
        else if (m.rid) { replies[cmds[m.rid - 1]] = m; if (Object.keys(replies).length === cmds.length) { clearTimeout(t); p.stdin.end(); resolve(replies); } }
      }
    });
    p.on('error', reject);
  });
}

test('errors thrown from C# keep their code and message through PowerShell', { skip: !have && `no PowerShell found (${bin})`, timeout: 120000 }, async () => {
  const r = await run(['typed', 'com', 'plain', 'deep', 'pstyped', 'task', 'ok', 'old']);
  assert.deepStrictEqual([r.typed.ok, r.typed.code, r.typed.error], [false, 'password', 'Enter the network password.']);
  assert.strictEqual(r.com.code, 'com');
  assert.match(r.com.error, /The device is busy/); assert.match(r.com.error, /0x80070005/);
  assert.deepStrictEqual([r.plain.code, r.plain.error], ['failed', 'plain failure']);
  assert.deepStrictEqual([r.deep.code, r.deep.error], ['location_denied', 'Location is off.']);   // typed error nested inside another exception
  assert.deepStrictEqual([r.pstyped.code, r.pstyped.error], ['timeout', 'Windows did not respond in time.']);
  assert.strictEqual(r.task.code, 'password');                                                        // AggregateException from a failed Task
  assert.deepStrictEqual([r.ok.ok, r.ok.data], [true, 7]);
  assert.ok(r.typed.detail && !/Enter the network password/.test(r.typed.detail), 'detail names exception types only');
  // regression marker: the Phase 2 test ([LiError] on the outer exception) really was wrong for C#-thrown errors
  assert.strictEqual(r.old.data.code, 'failed'); assert.match(r.old.data.message, /^Exception calling/);
});
