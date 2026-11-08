const test = require('node:test'), assert = require('node:assert');
const N = require('../../src/system/notify');
const o = (id, name, d) => ({ id, name, default: !!d });
const A = (outId, outputs) => ({ available: true, outId, outName: outputs.find((x) => x.id === outId).name, outputs });
const spk = o('1', 'Speakers'), buds = { ...o('2', 'Sony WH-1000XM5'), form: 3 };   // form 3 = headphones (Windows endpoint form factor)

test('first reading and unchanged state never notify', () => {
  assert.deepEqual(N.audio(null, A('1', [spk])), []);
  assert.deepEqual(N.audio(A('1', [spk]), A('1', [spk])), []);
  assert.deepEqual(N.wifi({ radio: 'on', state: 'connected', ssid: 'H' }, { radio: 'on', state: 'connected', ssid: 'H' }), []);
  assert.deepEqual(N.vpn({ installed: true, connected: true }, { installed: true, connected: true }), []);
});
test('audio: new default device = one "connected" notice; switching and removal', () => {
  const r = N.audio(A('1', [spk]), A('2', [spk, buds]));
  assert.equal(r.length, 1); assert.equal(r[0].title, 'Sony WH-1000XM5 connected'); assert.equal(r[0].icon, 'headphones');
  assert.equal(N.audio(A('2', [spk, buds]), A('1', [spk, buds]))[0].title, 'Switched to Speakers');
  assert.equal(N.audio(A('2', [spk, buds]), A('1', [spk]))[0].title, 'Sony WH-1000XM5 disconnected');
});
test('wifi: enable/disable, connect, disconnect, connecting', () => {
  const w = (radio, state, ssid) => ({ radio, state, ssid });
  assert.equal(N.wifi(w('on', 'connected', 'A'), w('off', 'disconnected'))[0].title, 'Wi-Fi disabled');
  assert.equal(N.wifi(w('off', 'disconnected'), w('on', 'disconnected'))[0].title, 'Wi-Fi enabled');
  assert.equal(N.wifi(w('on', 'disconnected'), w('on', 'connecting'))[0].title, 'Connecting to network…');
  assert.equal(N.wifi(w('on', 'connecting'), w('on', 'connected', 'Home Wi-Fi'))[0].title, 'Connected to Home Wi-Fi');
  assert.equal(N.wifi(w('on', 'connected', 'Home'), w('on', 'disconnected'))[0].title, 'Disconnected from Wi-Fi');
});
test('bluetooth: radio, device connect/disconnect, radio-on list is not news', () => {
  const d = (connected) => ({ id: 'x', name: 'Galaxy Buds', connected, kind: 'audio' });
  assert.equal(N.bluetooth({ radio: 'on', devices: [d(false)] }, { radio: 'on', devices: [d(true)] })[0].title, 'Galaxy Buds connected');
  assert.equal(N.bluetooth({ radio: 'on', devices: [d(true)] }, { radio: 'on', devices: [d(false)] })[0].title, 'Galaxy Buds disconnected');
  assert.equal(N.bluetooth({ radio: 'on', devices: [] }, { radio: 'off', devices: [] })[0].title, 'Bluetooth disabled');
  assert.deepEqual(N.bluetooth({ radio: 'off', devices: [] }, { radio: 'on', devices: [d(true)] }).map((x) => x.title), ['Bluetooth enabled']);
});
test('vpn: only when installed; never claims connected otherwise', () => {
  assert.deepEqual(N.vpn({ installed: false, connected: false }, { installed: false, connected: true }), []);
  assert.equal(N.vpn({ installed: true, connected: false }, { installed: true, connected: true })[0].title, 'Proton VPN connected');
  assert.equal(N.vpn({ installed: true, connected: true }, { installed: true, connected: false })[0].title, 'Proton VPN disconnected');
});
test('battery: charger events, low and critical fire once and re-arm', () => {
  const f = {}; const b = (p, ac) => ({ hasBattery: true, ac, percent: p });
  assert.equal(N.battery(b(50, true), b(50, false), f)[0].title, 'Charger disconnected');
  assert.equal(N.battery(b(22, false), b(20, false), f)[0].title, 'Battery low');
  assert.deepEqual(N.battery(b(20, false), b(19, false), f), []);
  assert.equal(N.battery(b(11, false), b(10, false), f)[0].title, 'Battery critically low');
  N.battery(b(10, false), b(60, true), f);                                   // charged: re-armed
  assert.equal(N.battery(b(22, false), b(20, false), f)[0].title, 'Battery low');
});
test('mic, power mode, displays', () => {
  assert.equal(N.mic({ present: true, muted: false, name: 'Mic' }, { present: true, muted: true, name: 'Mic' })[0].title, 'Microphone muted');
  assert.equal(N.powermode({ supported: true, mode: 'balanced' }, { supported: true, mode: 'performance' })[0].title, 'Power mode: Best performance');
  const d = (id, w) => ({ id, label: 'D' + id, w, h: 1080, hz: 60 });
  assert.equal(N.displays([d(1, 1920)], [d(1, 1920), d(2, 2560)])[0].title, 'D2 connected');
  assert.equal(N.displays([d(1, 1920), d(2, 2560)], [d(1, 1920)])[0].title, 'D2 disconnected');
  assert.equal(N.displays([d(1, 1920)], [d(1, 2560)])[0].title, 'Display settings changed');
});
test('category switches and de-duplication', () => {
  assert.equal(N.enabled('vpn', { notifyVpn: false }), false); assert.equal(N.enabled('vpn', {}), true);
  const dd = N.createDeduper(4000), x = { cat: 'a', title: 't', sub: '' };
  assert.equal(dd(x, 0), true); assert.equal(dd(x, 1000), false); assert.equal(dd(x, 4500), true);
});
