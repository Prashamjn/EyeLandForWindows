// Control Centre backend: owns the native helpers, keeps a cache of system state, validates every request from the renderer,
// and turns real state changes into island notifications. Only this module talks to the helpers.
const fs = require('fs');
const { Helper } = require('./helper');
const { V } = require('./validate');
const N = require('./notify');
const display = require('./display');
const { SETTINGS, actionFor } = require('./errors');

function createSystem({ nativeDir, send, settings, openExternal, openPath }) {
  const mockDir = process.env.LI_NATIVE_MOCK || '';
  const H = {
    audio: new Helper({ name: 'audio', file: 'audio.ps1', nativeDir, mockDir }),
    net: new Helper({ name: 'net', file: 'net.ps1', nativeDir, mockDir }),
    bt: new Helper({ name: 'bt', file: 'bt.ps1', nativeDir, mockDir }),
    power: new Helper({ name: 'power', file: 'power.ps1', nativeDir, mockDir }),
  };
  const FLAG = { audio: 'monitorAudio', net: 'monitorNetwork', bt: 'monitorBluetooth', power: 'monitorPower' };
  const cache = { audio: null, mic: null, wifi: null, vpn: null, bt: null, battery: null, powermode: null, bri: undefined, briError: null, displays: null };
  const batteryFlags = {};
  const dedupe = N.createDeduper();
  const cc = (payload) => send('cc:event', payload);
  let quiet = true;                                   // no notices during the first moments after start-up

  function notice(list) {
    for (const x of list) {
      if (quiet || !N.enabled(x.cat, settings()) || !dedupe(x)) continue;
      cc({ kind: 'notify', ...x, ttl: settings().notifyMs || 2800 });
    }
  }
  function apply(key, next, differ) {
    const prev = cache[key]; cache[key] = next;
    cc({ kind: 'state', key, data: next });
    if (differ) notice(differ(prev, next));
  }

  /* ---------- events from the helpers ---------- */
  H.audio.on('event', (ev, d) => {
    if (ev !== 'audio' || !d) return;
    if (d.available === false) return apply('audio', { available: false, error: d.error }, null);
    apply('audio', d.audio, N.audio); apply('mic', d.mic, N.mic);
    send('system', { kind: 'vol', value: d.audio.volume, muted: !!d.audio.muted });        // keeps the Phase 1 volume activity working
  });
  H.net.on('event', (ev, d) => {
    if (ev === 'wifi') apply('wifi', d, N.wifi);
    else if (ev === 'vpn') apply('vpn', d, N.vpn);
    else if (ev === 'wifi-progress') { cc({ kind: 'progress', key: 'wifi', ...d }); if (d.phase === 'failed') notice([{ cat: 'wifi', id: 'wifi', icon: 'wifiOff', title: 'Could not connect', sub: d.ssid || '', tone: 'warn' }]); }
  });
  H.bt.on('event', (ev, d) => {
    if (ev === 'bt') apply('bt', d, N.bluetooth);
    else if (ev === 'bt-scan') cc({ kind: 'scan', key: 'bt', data: d });
  });
  H.power.on('event', (ev, d) => {
    if (ev === 'battery') apply('battery', d, (p, n) => N.battery(p, n, batteryFlags));
    else if (ev === 'powermode') apply('powermode', d, N.powermode);
    else if (ev === 'brightness') { cache.bri = d.value; cache.briError = d.error || null; cc({ kind: 'state', key: 'bri', data: d.value }); cc({ kind: 'state', key: 'briError', data: cache.briError }); send('system', { kind: 'bri', value: d.value }); }
  });
  for (const [k, h] of Object.entries(H)) {
    h.on('down', () => cc({ kind: 'helper', helper: k, up: false }));
    h.on('up', () => cc({ kind: 'helper', helper: k, up: true }));
    h.on('failed', () => cc({ kind: 'helper', helper: k, up: false, failed: true }));
  }

  /* ---------- monitoring (event-driven helpers are started staggered so start-up has no CPU spike) ---------- */
  let started = false;
  function applyMonitoring() {
    const S = settings(); let delay = 0;
    for (const [k, flag] of Object.entries(FLAG)) {
      if (S[flag] === false) { if (H[k].running) H[k].stop(); } else if (!H[k].running && H[k].supported) { setTimeout(() => H[k].start(), delay); delay += 700; }
    }
    if (!started) { started = true; setTimeout(() => { quiet = false; }, delay + 6000); }
  }
  function refreshDisplays() {
    const next = display.snapshot(), prev = cache.displays; cache.displays = next;
    cc({ kind: 'state', key: 'displays', data: next });
    if (prev) notice(N.displays(prev, next));
  }

  /* ---------- requests from the renderer ---------- */
  const DOMAIN = { audio: 'audio', mic: 'audio', wifi: 'net', vpn: 'net', bt: 'bt', battery: 'power', powermode: 'power', bri: 'power' };
  async function stateAll() {
    const unavailable = {};
    const need = [];
    if (cache.audio === null) need.push(['audio', H.audio.request('get').then((r) => { cache.audio = r.audio; cache.mic = r.mic; })]);
    if (cache.wifi === null) need.push(['net', H.net.request('get').then((r) => { cache.wifi = r.wifi; cache.vpn = r.vpn; })]);
    if (cache.bt === null) need.push(['bt', H.bt.request('get').then((r) => { cache.bt = r; })]);
    if (cache.battery === null) need.push(['power', H.power.request('get').then((r) => { cache.battery = r.battery; cache.powermode = r.powermode; cache.bri = r.brightness; cache.briError = r.brightnessError || null; })]);
    const res = await Promise.allSettled(need.map((x) => x[1]));
    res.forEach((r, i) => { if (r.status === 'rejected') unavailable[need[i][0]] = { code: r.reason.code, message: r.reason.message }; });
    for (const [k, h] of Object.entries(H)) if (!h.supported) unavailable[k] = { code: 'unsupported', message: 'This feature needs Windows.' };
    if (!cache.displays) cache.displays = display.snapshot();
    return { ...cache, night: { status: 'unknown', direct: false }, unavailable };
  }

  async function run(op, args) {
    switch (op) {
      case 'state.all': return stateAll();
      case 'audio.setVolume': return H.audio.request('setVolume', args);
      case 'audio.setMute': return H.audio.request('setMute', args);
      case 'audio.setOutput': return H.audio.request('setOutput', args);
      case 'mic.setMute': return H.audio.request('setMicMute', args);
      case 'bri.set': return H.power.request('setBrightness', args);
      case 'wifi.scan': {
        const r = await H.net.request('networks', { rescan: true }, 15000);
        return r && r.limited && r.reason === 'location_denied' ? { ...r, action: actionFor('location_denied') } : r;     // scanning refused: saved networks only, with the fix offered
      }
      case 'wifi.setPower': return H.net.request('setRadio', args, 25000);
      case 'wifi.connect': cc({ kind: 'progress', key: 'wifi', phase: 'connecting', ssid: args.ssid }); return H.net.request('connect', args, 40000);         // the helper itself waits for Windows' completion + verifies the adapter (<= 28 s)
      case 'wifi.disconnect': return H.net.request('disconnect', {}, 15000);
      case 'bt.setPower': return H.bt.request('setRadio', args, 25000);
      case 'bt.scan': return H.bt.request('scan', args);
      case 'bt.stopScan': return H.bt.request('stopScan');
      case 'bt.connect': return H.bt.request('connect', args, 30000);
      case 'bt.disconnect': return H.bt.request('disconnect', args, 30000);
      case 'bt.pair': return H.bt.request('pair', args, 75000);
      case 'power.setMode': return H.power.request('setMode', args);
      case 'vpn.openApp': {
        const v = cache.vpn || (H.net.supported ? await H.net.request('vpn').catch(() => null) : null);
        if (!v || !v.installed) throw Object.assign(new Error('Proton VPN is not installed on this PC.'), { code: 'not_installed' });
        if (!v.launch || !fs.existsSync(v.launch)) throw Object.assign(new Error('Could not find the Proton VPN shortcut. Open it from the Start menu.'), { code: 'no_shortcut' });
        const err = await openPath(v.launch); if (err) throw new Error(err);
        return true;
      }
      case 'night.openSettings': await openExternal('ms-settings:nightlight'); return true;
      case 'display.openSettings': await openExternal('ms-settings:display'); return true;
      case 'settings.open': await openExternal(SETTINGS[args.page]); return true;
    }
    throw Object.assign(new Error('Unknown operation'), { code: 'invalid' });
  }
  // IPC entry point: never throws across the bridge
  async function call(op, arg) {
    if (typeof op !== 'string' || !V[op]) return { ok: false, code: 'invalid', error: 'Unknown operation' };
    try { return { ok: true, data: await run(op, V[op](arg)) }; }
    catch (e) {
      const code = e.code || 'failed';
      if (e.detail) console.error(`[cc] ${op} failed: ${code}: ${e.message} [${e.detail}]`);      // diagnostics only: the request arguments (a Wi-Fi password) are never logged
      return { ok: false, code, error: e.message || 'Something went wrong', detail: e.detail, action: actionFor(code) };
    }
  }

  function shutdown() { Object.values(H).forEach((h) => h.stop()); }
  return { call, applyMonitoring, refreshDisplays, shutdown, helpers: H, cache };
}
module.exports = { createSystem };
