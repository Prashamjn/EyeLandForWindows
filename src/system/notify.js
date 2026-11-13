// Turns a change in system state into a short notice for the island. Pure functions (unit-tested in tools/tests).
// Rules: nothing on the first reading (prev == null), nothing when the state did not change, at most one notice per change.
const MODE_LABEL = { efficiency: 'Best power efficiency', balanced: 'Balanced', performance: 'Best performance' };
const AUDIO_HEADSET = /head(phone|set)|buds|airpods|earbud|earphone|pods/i;
// Windows reports an endpoint form factor (3 = headphones, 5 = headset); the name is only a fallback for older drivers
const HEADSET_FORMS = new Set([3, 5]);
const audioIcon = (name, form) => (HEADSET_FORMS.has(form) || AUDIO_HEADSET.test(name || '') ? 'headphones' : 'speaker');
const n = (cat, id, icon, title, sub, tone) => ({ cat, id, icon, title, sub: sub || '', tone: tone || '' });

function audio(prev, next) {
  if (!prev || !prev.available || !next || !next.available) return [];
  const ids = new Set(prev.outputs.map((o) => o.id));
  const added = next.outputs.filter((o) => !ids.has(o.id));
  const nowIds = new Set(next.outputs.map((o) => o.id));
  const removed = prev.outputs.filter((o) => !nowIds.has(o.id));
  const changedDefault = prev.outId !== next.outId;
  if (added.length) {
    const a = added.find((o) => o.id === next.outId) || added[0];
    return [n('audio', 'audio', audioIcon(a.name, a.form), a.name + ' connected', a.id === next.outId ? 'Now the sound output' : 'Sound output', 'success')];
  }
  if (removed.length) return [n('audio', 'audio', audioIcon(removed[0].name, removed[0].form), removed[0].name + ' disconnected', changedDefault && next.outName ? 'Switched to ' + next.outName : '', '')];
  if (changedDefault && next.outName) return [n('audio', 'audio', audioIcon(next.outName, (next.outputs.find((o) => o.id === next.outId) || {}).form), 'Switched to ' + next.outName, 'Sound output', '')];
  return [];
}
function mic(prev, next) {
  if (!prev || !next || !prev.present || !next.present || prev.muted === next.muted) return [];
  return [n('mic', 'mic', next.muted ? 'micOff' : 'mic', next.muted ? 'Microphone muted' : 'Microphone on', next.name, next.muted ? 'warn' : 'success')];
}
function wifi(prev, next) {
  if (!prev || !next) return [];
  if (prev.radio !== next.radio && (next.radio === 'on' || next.radio === 'off')) return [n('wifi', 'wifi', next.radio === 'on' ? 'wifi' : 'wifiOff', next.radio === 'on' ? 'Wi-Fi enabled' : 'Wi-Fi disabled', '', next.radio === 'on' ? 'success' : '')];
  if (next.state === 'connecting' && prev.state !== 'connecting') return [n('wifi', 'wifi', 'wifi', 'Connecting to network…', '', '')];
  if (next.state === 'connected' && (prev.state !== 'connected' || prev.ssid !== next.ssid)) return [n('wifi', 'wifi', 'wifi', 'Connected to ' + next.ssid, 'Wi-Fi', 'success')];
  if (prev.state === 'connected' && next.state === 'disconnected') return [n('wifi', 'wifi', 'wifiOff', 'Disconnected from Wi-Fi', prev.ssid, '')];
  return [];
}
function bluetooth(prev, next) {
  if (!prev || !next) return [];
  if (prev.radio !== next.radio && (next.radio === 'on' || next.radio === 'off')) return [n('bluetooth', 'bt', 'bluetooth', next.radio === 'on' ? 'Bluetooth enabled' : 'Bluetooth disabled', '', next.radio === 'on' ? 'success' : '')];
  if (next.radio !== 'on') return [];
  const before = new Map(prev.devices.map((d) => [d.id, d]));
  for (const d of next.devices) {
    const was = before.get(d.id);
    if (was && was.connected === d.connected) continue;
    if (!was && !d.connected) continue;
    if (!was && prev.radio !== 'on') continue;                  // radio just came back on: the list is not news
    return [n('bluetooth', 'bt', d.kind === 'audio' ? 'headphones' : 'bluetooth', d.name + (d.connected ? ' connected' : ' disconnected'), 'Bluetooth', d.connected ? 'success' : '')];
  }
  return [];
}
function vpn(prev, next) {
  if (!prev || !next || !next.installed || prev.connected === next.connected) return [];
  return [n('vpn', 'vpn', next.connected ? 'vpn' : 'vpnOff', next.connected ? 'Proton VPN connected' : 'Proton VPN disconnected', '', next.connected ? 'success' : '')];
}
function powermode(prev, next) {
  if (!prev || !next || !next.supported || !prev.supported || prev.mode === next.mode || !MODE_LABEL[next.mode]) return [];
  return [n('power', 'powermode', 'gauge', 'Power mode: ' + MODE_LABEL[next.mode], '', '')];
}
function battery(prev, next, flags = {}) {
  if (!prev || !next || !next.hasBattery) return [];
  // re-arm the one-shot alerts first, so a charger event in the same update cannot leave them stuck
  const pc = next.percent;
  if (pc != null && (next.ac || pc > 20)) flags.low = false;
  if (pc != null && (next.ac || pc > 10)) flags.crit = false;
  if (prev.ac !== next.ac && next.ac != null && prev.ac != null) {
    return [n('battery', 'battery', next.ac ? 'plug' : 'battery', next.ac ? 'Charger connected' : 'Charger disconnected', next.percent != null ? next.percent + '%' : '', next.ac ? 'success' : '')];
  }
  const p = next.percent;
  if (p != null && !next.ac) {
    if (p <= 10 && !flags.crit) { flags.crit = true; return [n('battery', 'battery-low', 'battery', 'Battery critically low', p + '% remaining', 'warn')]; }
    if (p <= 20 && p > 10 && !flags.low) { flags.low = true; return [n('battery', 'battery-low', 'battery', 'Battery low', p + '% remaining', 'warn')]; }
  }
  return [];
}
function displays(prev, next) {
  if (!prev || !next) return [];
  const a = new Map(prev.map((d) => [d.id, d])), b = new Map(next.map((d) => [d.id, d]));
  const added = next.filter((d) => !a.has(d.id)), removed = prev.filter((d) => !b.has(d.id));
  if (added.length) return [n('display', 'display', 'display', added[0].label + ' connected', `${added[0].w}×${added[0].h}`, 'success')];
  if (removed.length) return [n('display', 'display', 'display', removed[0].label + ' disconnected', '', '')];
  const ch = next.find((d) => { const o = a.get(d.id); return o && (o.w !== d.w || o.h !== d.h || o.hz !== d.hz); });
  if (ch) return [n('display', 'display', 'display', 'Display settings changed', `${ch.w}×${ch.h} · ${ch.hz} Hz`, '')];
  return [];
}
const CAT_SETTING = { bluetooth: 'notifyBluetooth', wifi: 'notifyWifi', vpn: 'notifyVpn', audio: 'notifyAudio', mic: 'notifyMic', power: 'notifyPower', display: 'notifyDisplay', battery: 'notifyBattery' };
const enabled = (cat, settings) => settings[CAT_SETTING[cat]] !== false;

// suppress an identical notice that repeats within a few seconds (drivers often raise the same change twice)
function createDeduper(windowMs = 4000) {
  const seen = new Map();
  return (notice, now = Date.now()) => {
    const k = notice.cat + '|' + notice.title + '|' + notice.sub;
    if (seen.has(k) && now - seen.get(k) < windowMs) return false;
    seen.set(k, now); return true;
  };
}
/* ---------- charger sound ---------- */
// A real charger event: both readings known, AC state flipped, device has a battery. The very first reading never counts.
function chargerEvent(prev, next) {
  if (!prev || !next || !next.hasBattery || prev.ac == null || next.ac == null || prev.ac === next.ac) return null;
  return next.ac ? 'connect' : 'disconnect';
}
// Should that event make a sound? Settings, notification preference and system mute are all respected. volume is 0..1.
function chargePolicy(kind, S, audioState) {
  if (!kind || !S) return { play: false, why: 'no-event' };
  if (S.chargeSound === false) return { play: false, why: 'sound-off' };
  if (kind === 'disconnect' && !S.chargeDisconnectSound) return { play: false, why: 'disconnect-off' };
  if (S.notifyBattery === false) return { play: false, why: 'notifications-off' };
  if (audioState && audioState.muted) return { play: false, why: 'system-muted' };
  const v = Math.min(100, Math.max(0, Number.isFinite(+S.chargeVolume) ? +S.chargeVolume : 40)) / 100;
  return v > 0 ? { play: true, volume: v } : { play: false, why: 'volume-zero' };
}
// Windows can report one plug-in as several power events; the same kind inside `windowMs` is ignored.
function createChargeGate(windowMs = 4000, now = Date.now) {
  let last = { kind: null, at: -Infinity };
  return (kind) => { const t = now(); if (!kind || (kind === last.kind && t - last.at < windowMs)) return false; last = { kind, at: t }; return true; };
}

module.exports = { chargerEvent, chargePolicy, createChargeGate, audio, mic, wifi, bluetooth, vpn, powermode, battery, displays, enabled, createDeduper, MODE_LABEL };
