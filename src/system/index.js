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
  const chargeGate = N.createChargeGate();
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
    else if (ev === 'bt-events') console.error(`[cc] bluetooth events: ${d.mode}${d.errors && d.errors.length ? ' (' + d.errors.join(' | ') + ')' : ''}`);       // 'polling' means a WinRT subscription failed: the reason is here
  });
  H.power.on('event', (ev, d) => {
    if (ev === 'battery') {
      const prev = cache.battery;
      apply('battery', d, (p, n) => N.battery(p, n, batteryFlags));
      const kind = N.chargerEvent(prev, d);                               // real event only: never on the first reading, never while merely connected
      if (kind) {                                                          // rare, so every outcome is logged (visible in the terminal that runs `npm start`)
        const gate = !quiet && chargeGate(kind), pol = gate ? N.chargePolicy(kind, settings(), cache.audio) : null;
        console.error(`[charge] ${kind}: ` + (quiet ? 'ignored (start-up quiet period)' : !gate ? 'ignored (duplicate within 4 s)' : pol.play ? `sound sent (volume ${Math.round(pol.volume * 100)}%)` : `no sound (${pol.why})`));
        if (pol && pol.play) send('charge-sound', { kind, volume: pol.volume });
      }
    }
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

  /* ---------- authoritative state: nothing is reported as done until Windows says so ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const REFRESH = {                                    // re-read one domain from its helper and publish what Windows really reports
    audio: async () => { const r = await H.audio.request('get'); apply('audio', r.audio, N.audio); apply('mic', r.mic, N.mic); },
    net: async () => { const r = await H.net.request('get'); apply('wifi', r.wifi, N.wifi); apply('vpn', r.vpn, N.vpn); },
    bt: async () => { const r = await H.bt.request('get'); apply('bt', r, N.bluetooth); },
    power: async () => {
      const r = await H.power.request('get');
      apply('battery', r.battery, (p, n) => N.battery(p, n, batteryFlags)); apply('powermode', r.powermode, N.powermode);
      cache.bri = r.brightness; cache.briError = r.brightnessError || null; cc({ kind: 'state', key: 'bri', data: r.brightness }); cc({ kind: 'state', key: 'briError', data: cache.briError });
    },
  };
  // check() returns null when the cache shows the requested state, otherwise a sentence saying what Windows reports instead.
  async function settle(domain, check, { timeout = 4000, step = 250 } = {}) {
    const end = Date.now() + (Number(process.env.LI_SETTLE_MS) || timeout); let why;        // LI_SETTLE_MS: tests only
    for (;;) {
      await REFRESH[domain]();
      why = check(); if (!why) return true;
      if (Date.now() >= end) throw Object.assign(new Error(why), { code: 'unverified' });
      await sleep(step);
    }
  }
  const latest = {};                                    // slider-style operations: only the newest request is verified (older ones are superseded, not failed)
  const newest = (key) => { const mine = (latest[key] = (latest[key] || 0) + 1); return () => latest[key] === mine; };
  const btDev = (id) => ((cache.bt && cache.bt.devices) || []).find((d) => d.id === id);

  async function run(op, args) {
    switch (op) {
      case 'state.all': return stateAll();
      case 'audio.setVolume': {
        const mine = newest('vol'); await H.audio.request('setVolume', args); if (!mine()) return true;
        await settle('audio', () => (cache.audio && Math.abs(cache.audio.volume - args.value) <= 1 ? null : `Windows reports the volume as ${cache.audio ? cache.audio.volume : '?'}%.`)); return true;
      }
      case 'audio.setMute': await H.audio.request('setMute', args); await settle('audio', () => (cache.audio && cache.audio.muted === args.muted ? null : `Windows reports the sound as ${cache.audio && cache.audio.muted ? 'muted' : 'not muted'}.`)); return true;
      case 'audio.setOutput': {
        const r = await H.audio.request('setOutput', args, 15000);                 // the helper returns the state Windows reports after the switch
        apply('audio', r.audio, N.audio); apply('mic', r.mic, N.mic);
        await settle('audio', () => (cache.audio && cache.audio.outId === args.id ? null : `Windows still reports "${cache.audio && cache.audio.outName}" as the default output.`)); return true;
      }
      case 'mic.setMute': await H.audio.request('setMicMute', args); await settle('audio', () => (cache.mic && cache.mic.muted === args.muted ? null : `Windows reports the microphone as ${cache.mic && cache.mic.muted ? 'muted' : 'not muted'}.`)); return true;
      case 'bri.set': {
        const mine = newest('bri'); await H.power.request('setBrightness', args); if (!mine()) return true;
        await settle('power', () => (typeof cache.bri === 'number' && Math.abs(cache.bri - args.value) <= 2 ? null : `Windows reports the brightness as ${cache.bri == null ? 'unavailable' : cache.bri + '%'}.`), { timeout: 3000 }); return true;
      }
      case 'wifi.scan': {
        const r = await H.net.request('networks', { rescan: true }, 15000);
        return r && r.limited && r.reason === 'location_denied' ? { ...r, action: actionFor('location_denied') } : r;     // scanning refused: saved networks only, with the fix offered
      }
      case 'wifi.setPower': await H.net.request('setRadio', args, 25000); await settle('net', () => (cache.wifi && cache.wifi.radio === (args.on ? 'on' : 'off') ? null : `Windows reports the Wi-Fi radio as ${cache.wifi && cache.wifi.radio}.`)); return true;
      case 'wifi.connect': cc({ kind: 'progress', key: 'wifi', phase: 'connecting', ssid: args.ssid });
        try { await H.net.request('connect', args, 40000); }
        catch (e) { notice([{ cat: 'wifi', id: 'wifi', icon: 'wifiOff', title: 'Could not connect', sub: args.ssid || '', tone: 'warn' }]); throw e; }        // the helper's own failure event is suppressed while it waits, so say it here          // the helper itself waits for Windows' completion + verifies the adapter (<= 28 s)
        await settle('net', () => (cache.wifi && cache.wifi.state === 'connected' && (args.profile || !cache.wifi.ssid || cache.wifi.ssid === args.ssid) ? null : `Windows reports Wi-Fi as "${cache.wifi && cache.wifi.state}"${cache.wifi && cache.wifi.ssid ? ' on "' + cache.wifi.ssid + '"' : ''}.`)); return true;
      case 'wifi.disconnect': await H.net.request('disconnect', {}, 15000); await settle('net', () => (cache.wifi && cache.wifi.state === 'connected' ? 'Windows still reports a Wi-Fi connection.' : null)); return true;
      case 'bt.setPower': await H.bt.request('setRadio', args, 25000); await settle('bt', () => (cache.bt && cache.bt.radio === (args.on ? 'on' : 'off') ? null : `Windows reports the Bluetooth radio as ${cache.bt && cache.bt.radio}.`)); return true;
      case 'bt.scan': return H.bt.request('scan', args);
      case 'bt.stopScan': return H.bt.request('stopScan');
      case 'bt.connect': await H.bt.request('connect', args, 30000); await settle('bt', () => (btDev(args.id) && btDev(args.id).connected ? null : 'Windows does not report the device as connected.')); return true;
      case 'bt.disconnect': await H.bt.request('disconnect', args, 30000); await settle('bt', () => (btDev(args.id) && btDev(args.id).connected ? 'Windows still reports the device as connected.' : null)); return true;
      case 'bt.pair': await H.bt.request('pair', args, 75000); await settle('bt', () => (btDev(args.id) ? null : 'Windows does not list the device as paired.'), { timeout: 5000 }); return true;
      case 'power.setMode': await H.power.request('setMode', args); await settle('power', () => (cache.powermode && cache.powermode.mode === args.mode ? null : `Windows reports the power mode as "${cache.powermode && cache.powermode.mode}".`)); return true;
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
