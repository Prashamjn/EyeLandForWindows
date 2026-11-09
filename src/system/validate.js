// Argument validation for every Control Centre operation. The renderer is not trusted to send well-formed values;
// anything that fails here never reaches a native helper.
const bad = (m) => Object.assign(new Error(m), { code: 'invalid' });
const int = (v, lo, hi, what) => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') throw bad(`${what} must be a number`); const n = Number(v); if (!Number.isFinite(n)) throw bad(`${what} must be a number`); return Math.min(hi, Math.max(lo, Math.round(n))); };
const bool = (v, what) => { if (typeof v !== 'boolean') throw bad(`${what} must be true or false`); return v; };
const str = (v, re, what, max = 400) => { if (typeof v !== 'string' || v.length === 0 || v.length > max || !re.test(v)) throw bad(`${what} is not valid`); return v; };

const AUDIO_ID = /^\{[0-9a-fA-F.]+\}\.\{[0-9a-fA-F-]+\}$/;                 // MMDevice endpoint id
const BT_ID = /^[\w&#:.{}\\-]+$/;                                           // device instance path, e.g. Bluetooth#Bluetooth...
const MODES = ['efficiency', 'balanced', 'performance'];
const SECURITY = ['open', 'wpa2', 'wpa3', 'enterprise', 'owe'];

const ssid = (v) => {
  if (typeof v !== 'string' || !v.length || Buffer.byteLength(v, 'utf8') > 32 || /[\u0000-\u001f]/.test(v)) throw bad('Network name is not valid');
  return v;
};

// each validator returns the cleaned argument object that is sent on
const V = {
  'state.all': () => ({}),
  'audio.setVolume': (a) => ({ value: int(a && a.value, 0, 100, 'Volume') }),
  'audio.setMute': (a) => ({ muted: bool(a && a.muted, 'Mute') }),
  'audio.setOutput': (a) => ({ id: str(a && a.id, AUDIO_ID, 'Device') }),
  'mic.setMute': (a) => ({ muted: bool(a && a.muted, 'Mute') }),
  'bri.set': (a) => ({ value: int(a && a.value, 0, 100, 'Brightness') }),
  'wifi.scan': () => ({}),
  'wifi.setPower': (a) => ({ on: bool(a && a.on, 'Wi-Fi state') }),
  'wifi.connect': (a) => {
    const security = a && a.security;
    if (!SECURITY.includes(security)) throw bad('Unknown security type');
    const out = { ssid: ssid(a.ssid), security, known: a.known === true, password: '' };
    if (a.password != null) {
      if (typeof a.password !== 'string' || a.password.length > 64 || /[\u0000-\u001f]/.test(a.password)) throw bad('Password is not valid');
      out.password = a.password;
    }
    return out;
  },
  'wifi.disconnect': () => ({}),
  'bt.setPower': (a) => ({ on: bool(a && a.on, 'Bluetooth state') }),
  'bt.scan': () => ({ seconds: 12 }),
  'bt.stopScan': () => ({}),
  'bt.connect': (a) => ({ id: str(a && a.id, BT_ID, 'Device') }),
  'bt.disconnect': (a) => ({ id: str(a && a.id, BT_ID, 'Device') }),
  'bt.pair': (a) => ({ id: str(a && a.id, BT_ID, 'Device') }),
  'power.setMode': (a) => { if (!MODES.includes(a && a.mode)) throw bad('Unknown power mode'); return { mode: a.mode }; },
  'vpn.openApp': () => ({}),
  'night.openSettings': () => ({}),
  'display.openSettings': () => ({}),
};
module.exports = { V, OPS: Object.keys(V) };
