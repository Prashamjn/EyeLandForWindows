const { serve, emit, fail } = require('./lib');
let wifi = { adapter: true, state: 'connected', ssid: 'Home Wi-Fi', signal: 88, radio: 'on' };
let vpn = { installed: true, version: '3.5.0', running: true, adapter: 'ProtonVPN', connected: false, launch: __filename };
const nets = () => [
  { ssid: 'Home Wi-Fi', signal: 88, secure: true, security: 'wpa2', connected: wifi.state === 'connected' && wifi.ssid === 'Home Wi-Fi', known: true, connectable: true },
  { ssid: 'Cafe Guest', signal: 60, secure: true, security: 'wpa2', connected: wifi.state === 'connected' && wifi.ssid === 'Cafe Guest', known: false, connectable: true },
  { ssid: 'Open Hotspot', signal: 40, secure: false, security: 'open', connected: false, known: false, connectable: true },
  { ssid: 'Corp', signal: 70, secure: true, security: 'enterprise', connected: false, known: false, connectable: true },
];
const push = () => emit('wifi', wifi);
serve(async (m) => {
  switch (m.cmd) {
    case 'get': return { wifi, vpn };
    case 'networks': return { networks: nets() };
    case 'connect': {
      if (m.ssid === 'Cafe Guest' && !m.known && m.password !== 'correct-pass') {
        // Same contract as the real helper since Phase 3: connect BLOCKS until Windows reports the outcome and fails with a typed error.
        throw fail('connect_failed', 'Windows could not connect to "' + m.ssid + '": The network security key is incorrect. The password may be wrong.');
      }
      wifi = { ...wifi, state: 'connecting' }; push();
      await new Promise((r) => setTimeout(r, 400));                 // blocking like the real helper: the reply comes after the connection is up
      wifi = { ...wifi, state: 'connected', ssid: m.ssid }; push();
      return true;
    }
    case 'disconnect': wifi = { ...wifi, state: 'disconnected', ssid: null }; push(); return true;
    case 'setRadio': wifi = { ...wifi, radio: m.on ? 'on' : 'off', state: m.on ? 'disconnected' : 'disconnected', ssid: null }; push(); return true;
    case 'vpn': return vpn;
    case '__vpn': vpn = { ...vpn, ...m.patch }; emit('vpn', vpn); return true;
    default: throw fail('unknown', 'Unknown command');
  }
}, () => { push(); emit('vpn', vpn); });
