// WinRT event bridge: LiWinRt attaches to generic TypedEventHandler-style events by reflection and re-raises them on LiHub, which PowerShell
// can subscribe to (Register-ObjectEvent cannot subscribe to WinRT events itself). Uses WinRT-SHAPED fakes: it proves our binding, signalling and
// error reporting. It does not prove the real WinRT projection accepts the same call; that is checked by diagnose.js on Windows.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const bin = process.env.LI_PWSH || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const have = spawnSync(bin, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0;
const fixture = path.join(__dirname, 'fixtures', 'winrt-events.ps1');

function session() {
  const p = spawn(bin, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
  const events = [], waiters = new Map(); let buf = '', n = 0, ready;
  const isReady = new Promise((r) => { ready = r; });
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.ev === 'ready') ready(); else if (m.ev) events.push(m); else if (m.rid && waiters.has(m.rid)) waiters.get(m.rid)(m);
    }
  });
  return {
    events, close: () => p.kill(),
    ask: async (cmd) => { await isReady; const rid = ++n; return new Promise((res, rej) => { waiters.set(rid, res); setTimeout(() => rej(new Error('timeout ' + cmd)), 60000); p.stdin.write(JSON.stringify({ rid, cmd }) + '\n'); }); },
    waitFor: async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const f = events.find(fn); if (f) return f; await new Promise((r) => setTimeout(r, 50)); } return null; },
  };
}

test('WinRT-shaped events reach PowerShell through LiHub; unsubscribe and failures behave', { skip: !have && `no PowerShell (${bin})`, timeout: 150000 }, async () => {
  const s = session();
  try {
    const sub = (await s.ask('subscribe')).data;
    assert.deepStrictEqual([sub.radio, sub.watcher, sub.count], [null, null, 2]);                     // both subscribed, no error text
    await s.ask('fire');
    const radio = await s.waitFor((e) => e.ev === 'signal' && e.data.tag === 'btradio');
    assert.ok(radio, 'radio StateChanged signal arrived'); assert.strictEqual(radio.data.extra, 'Off');   // sender.State is carried along
    const added = await s.waitFor((e) => e.ev === 'signal' && e.data.tag === 'scan:le:Added');
    assert.ok(added, 'watcher Added signal arrived'); assert.deepStrictEqual([added.data.id, added.data.name], ['dev-9', 'Beats']);
    assert.strictEqual((await s.ask('unsub')).data.count, 1);                                          // scan:* removed, btradio kept
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(!s.events.some((e) => e.ev === 'signal' && e.data.id === 'ignored'), 'no signal after unsubscribe');
    const bad = (await s.ask('bad')).data;
    assert.match(bad.missing, /NoSuchEvent.*not found/); assert.match(bad.nulltarget, /no object/);   // reasons are returned, nothing throws
  } finally { s.close(); }
});
