// SIMULATED native helpers for tests on Linux. They speak the same JSON-lines protocol as native/*.ps1 and keep an in-memory
// "system", so the app's real IPC, validation, helper manager, cache and notification code is exercised. They prove NOTHING about
// real Windows behaviour (Core Audio, WLAN, Bluetooth, power); that needs the PowerShell helpers on a Windows 11 machine.
const readline = require('readline');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
exports.emit = (ev, data) => out({ ev, data });
exports.serve = (handler, onReady) => {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    try {
      if (m.cmd === '__sim') { out({ rid: m.rid, ok: true, data: true }); return exports.emit(m.ev, m.data); }   // test hook: inject an event
      const data = await handler(m);
      out({ rid: m.rid, ok: true, data });
    } catch (e) { out({ rid: m.rid, ok: false, error: e.message, code: e.code || 'failed' }); }
  });
  rl.on('close', () => process.exit(0));
  // test-only control channel: the harness appends {ev,data} lines to $LI_MOCK_CTL/<name>.ctl to simulate changes made outside the app
  const ctl = process.env.LI_MOCK_CTL && require('path').join(process.env.LI_MOCK_CTL, require('path').basename(process.argv[1], '.js') + '.ctl');
  if (ctl) { const fs = require('fs'); let off = 0; try { off = fs.statSync(ctl).size; } catch {} setInterval(() => { try { const b = fs.readFileSync(ctl); if (b.length > off) { b.slice(off).toString().split('\n').filter(Boolean).forEach((l) => { const m = JSON.parse(l); exports.emit(m.ev, m.data); }); off = b.length; } } catch {} }, 80); }
  out({ ev: 'ready', data: null });
  if (onReady) onReady();
};
exports.fail = (code, msg) => Object.assign(new Error(msg), { code });
