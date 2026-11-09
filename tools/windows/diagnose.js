#!/usr/bin/env node
'use strict';
// Liquid Island - Control Centre diagnostics for REAL Windows.
//
// Runs the production native helpers (src/system/helper.js -> powershell.exe -> native/*.ps1 -> native/cs/*.cs) exactly as the app does,
// and after every operation re-reads the real state from Windows ("did it actually change?"). Nothing is simulated.
//
//   node tools/windows/diagnose.js                  read-only: environment, permissions, helper start-up, state, validators
//   node tools/windows/diagnose.js --audio-switch   also switch the default sound output to another device, verify, restore
//   node tools/windows/diagnose.js --wifi-toggle    also turn Wi-Fi off and on (you lose connectivity for a few seconds)
//   node tools/windows/diagnose.js --bt-toggle      also turn Bluetooth off and on
//   node tools/windows/diagnose.js --bt-scan        also run a 10 s Bluetooth discovery
//   node tools/windows/diagnose.js --power-mode     also switch the Windows power mode, verify, restore
//   node tools/windows/diagnose.js --brightness     also change brightness by 5 %, verify, restore
//   node tools/windows/diagnose.js --all            every optional test above
//
// Output: a console summary and diagnostics/cc-diagnose-<timestamp>.json (contains your SSIDs / device names: review before sharing).
// For development without Windows: --mock tools/ui-harness/mock-native runs the SAME harness against the Node mocks. That only tests this
// script, never Windows.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Helper } = require('../../src/system/helper');
const { V } = require('../../src/system/validate');

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--all') || argv.includes(f);
const mockAt = argv.indexOf('--mock');
const mockDir = mockAt >= 0 ? path.resolve(argv[mockAt + 1] || '') : '';
const nativeDir = path.join(__dirname, '..', '..', 'native');
const isWin = process.platform === 'win32';
const t0 = Date.now();

const report = { tool: 'liquid-island-cc-diagnose', startedAt: new Date().toISOString(), mock: !!mockDir, env: {}, checks: [], helperStderr: [], events: [] };
const COLORS = { PASS: '\x1b[32m', FAIL: '\x1b[31m', WARN: '\x1b[33m', INFO: '\x1b[36m', SKIP: '\x1b[90m' };
function check(area, name, status, detail) {
  report.checks.push({ area, name, status, detail: detail === undefined ? null : detail });
  const d = detail === undefined ? '' : ' - ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
  console.log(`${COLORS[status] || ''}${status.padEnd(4)}\x1b[0m [${area}] ${name}${d.length > 300 ? d.slice(0, 300) + '…' : d}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, step = 250) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }

// helper stderr is where PowerShell/C# failures surface; keep it for the report
const origErr = console.error;
console.error = (...a) => { const s = a.join(' '); report.helperStderr.push(s); origErr(`\x1b[90m  stderr: ${s}\x1b[0m`); };

/* ---------- one real helper ---------- */
function open(name, file) {
  const h = new Helper({ name, file, nativeDir, mockDir });
  h.on('event', (ev, data) => report.events.push({ at: Date.now() - t0, helper: name, ev, data: JSON.stringify(data || null).slice(0, 200) }));
  return h;
}
async function boot(h, ms = 45000) {
  const up = new Promise((res) => h.once('up', () => res(true)));
  h.start();
  const ok = await Promise.race([up, sleep(ms).then(() => false)]);
  if (!ok) check(h.name, 'helper starts (compiles C#, prints ready)', 'FAIL', `no "ready" within ${ms / 1000}s. See helperStderr in the report (Add-Type compile errors appear there).`);
  else check(h.name, 'helper starts (compiles C#, prints ready)', 'PASS');
  return ok;
}
// Runs a request the way index.js does: validated with the production validator first, so a validator that rejects a real value is caught.
async function ask(h, op, cmd, raw, timeout) {
  const t = Date.now();
  let args;
  try { args = V[op](raw); } catch (e) { return { ok: false, stage: 'validator', code: e.code, error: e.message, ms: 0 }; }
  try { return { ok: true, data: await h.request(cmd, args, timeout), ms: Date.now() - t }; }
  catch (e) { return { ok: false, stage: 'helper', code: e.code, error: e.message, ms: Date.now() - t }; }
}
const why = (r) => `${r.stage}:${r.code || ''} ${r.error}`;

/* ---------- environment ---------- */
function environment() {
  const build = Number(String(os.release()).split('.').pop()) || 0;
  report.env = { platform: process.platform, release: os.release(), build, node: process.version, arch: process.arch, mock: !!mockDir };
  check('env', 'platform', isWin || mockDir ? 'PASS' : 'FAIL', isWin ? `Windows build ${build}` : mockDir ? 'non-Windows with --mock (harness self-test only)' : 'This tool needs Windows 11. Use --mock only to test the tool itself.');
  if (!isWin) return;
  check('env', 'Windows 11 24H2 or newer (Wi-Fi location gating applies)', build >= 26100 ? 'INFO' : 'INFO', build >= 26100 ? `build ${build}: Wi-Fi scan/connection APIs need location permission` : `build ${build}: location gating of Wi-Fi APIs not expected`);
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString(); $ExecutionContext.SessionState.LanguageMode'], { encoding: 'utf8', timeout: 20000 });
  const lines = String(ps.stdout || '').trim().split(/\r?\n/);
  report.env.powershell = lines[0]; report.env.languageMode = lines[1];
  check('env', 'Windows PowerShell 5.1 available', ps.status === 0 && /^5\.1/.test(lines[0] || '') ? 'PASS' : 'WARN', lines[0] || ps.error?.message || 'powershell.exe did not run');
  check('env', 'PowerShell language mode allows Add-Type', lines[1] === 'FullLanguage' ? 'PASS' : 'FAIL', lines[1] || 'unknown (ConstrainedLanguage blocks the C# helpers)');
  const reg = (key, name = 'Value') => { const r = spawnSync('reg.exe', ['query', key, '/v', name], { encoding: 'utf8' }); const m = /REG_SZ\s+(\S+)/.exec(String(r.stdout || '')); return m ? m[1] : null; };
  const CS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
  const consent = { location: reg(CS + '\\location'), locationDesktopApps: reg(CS + '\\location\\NonPackaged'), radios: reg(CS + '\\radios'), radiosDesktopApps: reg(CS + '\\radios\\NonPackaged') };
  report.env.consent = consent;
  check('env', 'Location consent (Wi-Fi scan needs "Let desktop apps access your location")', consent.locationDesktopApps === 'Deny' || consent.location === 'Deny' ? 'WARN' : 'INFO', consent);
  check('env', 'Radios consent', consent.radios === 'Deny' || consent.radiosDesktopApps === 'Deny' ? 'WARN' : 'INFO', consent);
}

/* ---------- Wi-Fi raw API codes (what the helper swallows today) ---------- */
function wlanProbe() {
  if (!isWin) return;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'probe-wlan.ps1')], { encoding: 'utf8', timeout: 60000 });
  let p = null; try { p = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop()); } catch { /* reported below */ }
  if (!p) return check('wifi', 'raw Native Wifi API probe', 'FAIL', { stdout: String(r.stdout).slice(0, 300), stderr: String(r.stderr).slice(0, 400) });
  report.env.wlanProbe = p;
  check('wifi', 'WlanScan return code', p.scan === 0 ? 'PASS' : p.scan === -1 ? 'SKIP' : 'FAIL', `${p.scan} (5 = ERROR_ACCESS_DENIED)`);
  check('wifi', 'WlanGetAvailableNetworkList return code', p.availableList === 0 ? 'PASS' : p.availableList === -1 ? 'SKIP' : 'FAIL', `${p.availableList} -> ${p.networkCount} networks`);
  check('wifi', 'WlanQueryInterface(current_connection) return code', p.queryCurrentConnection === 0 || p.queryCurrentConnection === 5023 ? 'PASS' : p.queryCurrentConnection === -1 ? 'SKIP' : 'FAIL', `${p.queryCurrentConnection} (0 connected, 5023 not connected, 5 access denied)`);
}

/* ---------- domains ---------- */
async function audio() {
  const h = open('audio', 'audio.ps1'); if (!(await boot(h))) return h;
  const g = await ask(h, 'state.all', 'get', {}, 20000);
  if (!g.ok) { check('audio', 'get state', 'FAIL', why(g)); return h; }
  const { audio: a, mic: m } = g.data;
  check('audio', 'get state', a && a.available !== false ? 'PASS' : 'FAIL', { volume: a && a.volume, muted: a && a.muted, default: a && a.outName, outputs: ((a && a.outputs) || []).map((o) => o.name) });
  const rejected = ((a && a.outputs) || []).filter((o) => { try { V['audio.setOutput']({ id: o.id }); return false; } catch { return true; } });
  check('audio', 'validator accepts every real endpoint id', rejected.length ? 'FAIL' : 'PASS', rejected.map((o) => o.id));
  check('audio', 'microphone', m && m.present ? 'INFO' : 'WARN', m);
  if (a && a.available !== false) {            // set volume to its current value: proves the write path with no visible change
    const r = await ask(h, 'audio.setVolume', 'setVolume', { value: a.volume }, 10000);
    check('audio', 'setVolume (to current value)', r.ok ? 'PASS' : 'FAIL', r.ok ? `${r.ms} ms` : why(r));
  }
  if (has('--audio-switch')) {
    const target = ((a && a.outputs) || []).find((o) => !o.default);
    if (!target) check('audio', 'switch default output', 'SKIP', 'only one active output device');
    else {
      const evBefore = report.events.length;
      const r = await ask(h, 'audio.setOutput', 'setOutput', { id: target.id }, 15000);
      if (!r.ok) check('audio', `switch default output to "${target.name}"`, 'FAIL', why(r));
      else {
        const now = await until(async () => { const x = await ask(h, 'state.all', 'get', {}, 8000); return x.ok && x.data.audio.outId === target.id ? x.data.audio : null; }, 4000);
        check('audio', `Windows default output is now "${target.name}" (re-read from Windows)`, now ? 'PASS' : 'FAIL', now ? `${r.ms} ms` : 'helper replied OK but Windows still reports the old default device');
        const evSeen = report.events.slice(evBefore).some((e) => e.helper === 'audio' && e.ev === 'audio');
        check('audio', 'helper pushed an "audio" event after the switch (UI refresh path)', evSeen ? 'PASS' : 'FAIL', evSeen ? '' : 'no event within the verify window: the UI would stay stale');
      }
      const back = await ask(h, 'audio.setOutput', 'setOutput', { id: a.outId }, 15000);
      check('audio', 'restore original default output', back.ok ? 'PASS' : 'FAIL', back.ok ? a.outName : why(back));
    }
  }
  return h;
}

async function net() {
  const h = open('net', 'net.ps1'); if (!(await boot(h))) return h;
  const g = await ask(h, 'state.all', 'get', {}, 30000);
  if (!g.ok) { check('wifi', 'get state', 'FAIL', why(g)); return h; }
  const { wifi: w, vpn } = g.data;
  check('wifi', 'get state', 'INFO', w);
  if (w && w.state === 'connected' && !w.ssid) check('wifi', 'connected but SSID is unreadable', 'WARN', `ssidError=${w.ssidError}. The UI says "Connected" and offers the location-settings fix; nothing is invented`);
  if (w && w.radioError) check('wifi', 'radio query error is reported (not hidden as "unsupported")', 'WARN', w.radioError);
  const n = await ask(h, 'wifi.scan', 'networks', {}, 30000);
  if (!n.ok) check('wifi', 'scan networks', 'FAIL', why(n));
  else if (n.data.limited) check('wifi', 'scan networks', 'WARN', `Windows refused scanning (${n.data.reason}, scan=${n.data.scanCode}, list=${n.data.listCode}); the helper fell back to ${n.data.networks.length} saved networks and reported it`);
  else check('wifi', 'scan networks', n.data.networks.length ? 'PASS' : 'WARN', n.data.networks.length ? `${n.data.networks.length} networks, ${n.ms} ms` : '0 networks. Compare with the raw WlanGetAvailableNetworkList code above: if it is 5 the helper is hiding an access-denied error');
  const bad = (n.ok ? n.data.networks : []).filter((x) => { try { V['wifi.connect']({ ssid: x.ssid, security: x.security, known: x.known, password: '' }); return false; } catch { return true; } });
  check('wifi', 'validator accepts every scanned network as a connect request', bad.length ? 'FAIL' : 'PASS', bad.map((x) => x.ssid));
  const known = (n.ok ? n.data.networks : []).filter((x) => x.known);
  check('wifi', 'saved networks reported (needed for one-click connect)', 'INFO', known.map((x) => x.ssid));
  check('vpn', 'Proton VPN state (compare with the Proton app yourself)', vpn && vpn.installed ? 'INFO' : 'WARN', vpn);
  if (has('--wifi-toggle')) {
    const was = w.radio;
    if (was !== 'on' && was !== 'off') check('wifi', 'toggle radio', 'SKIP', `radio state is "${was}"`);
    else {
      const flip = async (on) => {
        const r = await ask(h, 'wifi.setPower', 'setRadio', { on }, 30000);
        if (!r.ok) return check('wifi', `setRadio(${on ? 'on' : 'off'})`, 'FAIL', why(r));
        const ok = await until(async () => { const x = await ask(h, 'state.all', 'get', {}, 10000); return x.ok && x.data.wifi.radio === (on ? 'on' : 'off'); }, 8000, 500);
        check('wifi', `Wi-Fi radio is really ${on ? 'on' : 'off'} (re-read from Windows)`, ok ? 'PASS' : 'FAIL', ok ? `${r.ms} ms` : 'helper replied OK but the radio state did not change');
      };
      await flip(was !== 'on'); await flip(was === 'on');
    }
  }
  return h;
}

async function bt() {
  const h = open('bt', 'bt.ps1'); if (!(await boot(h))) return h;
  const g = await ask(h, 'state.all', 'get', {}, 40000);
  if (!g.ok) { check('bt', 'get state', 'FAIL', why(g)); return h; }
  check('bt', 'get state', 'INFO', { radio: g.data.radio, devices: g.data.devices.map((d) => ({ name: d.name, connected: d.connected, le: d.le })) });
  const badIds = g.data.devices.filter((d) => { try { V['bt.connect']({ id: d.id }); return false; } catch { return true; } });
  check('bt', 'validator accepts every real paired-device id', badIds.length ? 'FAIL' : 'PASS', badIds.map((d) => d.id));
  if (has('--bt-toggle') && (g.data.radio === 'on' || g.data.radio === 'off')) {
    const was = g.data.radio;
    for (const on of [was !== 'on', was === 'on']) {
      const r = await ask(h, 'bt.setPower', 'setRadio', { on }, 30000);
      if (!r.ok) { check('bt', `setRadio(${on ? 'on' : 'off'})`, 'FAIL', why(r)); continue; }
      const ok = await until(async () => { const x = await ask(h, 'state.all', 'get', {}, 15000); return x.ok && x.data.radio === (on ? 'on' : 'off'); }, 8000, 500);
      check('bt', `Bluetooth radio is really ${on ? 'on' : 'off'} (re-read from Windows)`, ok ? 'PASS' : 'FAIL', ok ? `${r.ms} ms` : 'helper replied OK but state did not change');
    }
  }
  if (has('--bt-scan')) {
    const before = report.events.length;
    const r = await ask(h, 'bt.scan', 'scan', {}, 15000);
    if (!r.ok) check('bt', 'discovery', 'FAIL', why(r));
    else { await sleep(11000); const seen = report.events.slice(before).filter((e) => e.ev === 'bt-scan'); check('bt', 'discovery (classic devices only; LE is not scanned)', seen.length ? 'PASS' : 'WARN', `${seen.length} scan events. Put a device in pairing mode first.`); await ask(h, 'bt.stopScan', 'stopScan', {}); }
  }
  return h;
}

async function power() {
  const h = open('power', 'power.ps1'); if (!(await boot(h))) return h;
  const g = await ask(h, 'state.all', 'get', {}, 30000);
  if (!g.ok) { check('power', 'get state', 'FAIL', why(g)); return h; }
  const { battery: b, powermode: pm, brightness: bri } = g.data;
  check('power', 'battery', b ? 'INFO' : 'FAIL', b);
  check('power', 'power mode', pm && pm.supported ? 'INFO' : 'WARN', pm);
  check('power', 'brightness (null = no controllable internal panel)', 'INFO', bri);
  if (has('--power-mode') && pm && pm.supported && ['efficiency', 'balanced', 'performance'].includes(pm.mode)) {
    const target = pm.mode === 'balanced' ? 'performance' : 'balanced';
    for (const mode of [target, pm.mode]) {
      const r = await ask(h, 'power.setMode', 'setMode', { mode }, 15000);
      if (!r.ok) { check('power', `setMode(${mode})`, 'FAIL', why(r)); continue; }
      const x = await ask(h, 'state.all', 'get', {}, 10000);
      check('power', `Windows power mode is really "${mode}"`, x.ok && x.data.powermode.mode === mode ? 'PASS' : 'FAIL', x.ok ? x.data.powermode : why(x));
    }
  }
  if (has('--brightness') && typeof bri === 'number') {
    const target = bri > 50 ? bri - 5 : bri + 5;
    for (const v of [target, bri]) {
      const r = await ask(h, 'bri.set', 'setBrightness', { value: v }, 15000);
      if (!r.ok) { check('power', `setBrightness(${v})`, 'FAIL', why(r)); continue; }
      const ok = await until(async () => { const x = await ask(h, 'state.all', 'get', {}, 10000); return x.ok && Math.abs(x.data.brightness - v) <= 1; }, 3000);
      check('power', `Windows brightness is really ${v}`, ok ? 'PASS' : 'FAIL', ok ? `${r.ms} ms` : 'WMI accepted the call but the level did not change');
    }
  }
  return h;
}

(async () => {
  console.log(`\nLiquid Island Control Centre diagnostics${mockDir ? '  [MOCK: harness self-test, NOT Windows]' : ''}\n`);
  environment();
  if (!isWin && !mockDir) { fs.mkdirSync('diagnostics', { recursive: true }); return finish([]); }
  wlanProbe();
  const hs = [];
  for (const fn of [audio, net, bt, power]) { try { hs.push(await fn()); } catch (e) { check(fn.name, 'harness error', 'FAIL', e.stack || e.message); } }
  finish(hs);
})();

function finish(hs) {
  for (const h of hs) if (h) h.stop();
  const count = (s) => report.checks.filter((c) => c.status === s).length;
  report.summary = { pass: count('PASS'), fail: count('FAIL'), warn: count('WARN'), skip: count('SKIP'), seconds: Math.round((Date.now() - t0) / 100) / 10 };
  const dir = path.join(__dirname, '..', '..', 'diagnostics'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `cc-diagnose-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.warn} warnings, ${report.summary.skip} skipped (${report.summary.seconds}s)\nReport: ${file}\n`);
  setTimeout(() => process.exit(report.summary.fail ? 1 : 0), 1200);
}
