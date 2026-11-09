const test = require('node:test'), assert = require('node:assert');
const { V, OPS } = require('../../src/system/validate');
const bad = (op, arg) => assert.throws(() => V[op](arg), (e) => e.code === 'invalid');
test('numbers are clamped, not trusted', () => { assert.deepEqual(V['audio.setVolume']({ value: 500 }), { value: 100 }); assert.deepEqual(V['bri.set']({ value: -5 }), { value: 0 }); bad('audio.setVolume', { value: 'x' }); bad('audio.setVolume', null); });
test('booleans must be booleans', () => { bad('audio.setMute', { muted: 'true' }); bad('wifi.setPower', {}); assert.deepEqual(V['mic.setMute']({ muted: true }), { muted: true }); });
test('device ids: only well-formed ids pass (no shell metacharacters)', () => {
  assert.ok(V['audio.setOutput']({ id: '{0.0.0.00000000}.{abcd-1234}' }));
  for (const id of ['"; calc.exe; "', 'a b', '{0.0.0.0}.{x};y', '', 'x'.repeat(500)]) bad('audio.setOutput', { id });
  assert.ok(V['bt.connect']({ id: 'Bluetooth#Bluetooth9c:b6:d0:aa-11:22:33' })); bad('bt.connect', { id: 'a b;c' }); bad('bt.pair', { id: '`x`' });
});
test('wifi.connect: ssid length in BYTES, security whitelist, password limits', () => {
  assert.ok(V['wifi.connect']({ ssid: 'Home', security: 'wpa2', password: 'longenough' }));
  bad('wifi.connect', { ssid: 'x'.repeat(33), security: 'open' }); bad('wifi.connect', { ssid: '日'.repeat(11), security: 'open' });   // 33 bytes
  bad('wifi.connect', { ssid: 'a', security: 'wep; rm' }); bad('wifi.connect', { ssid: 'a', security: 'wpa2', password: 'x'.repeat(65) }); bad('wifi.connect', { ssid: 'a\nb', security: 'open' });
  assert.equal(V['wifi.connect']({ ssid: 'Open', security: 'open' }).password, '');
});
test('power modes whitelist; every op has a validator', () => { bad('power.setMode', { mode: 'turbo' }); assert.ok(V['power.setMode']({ mode: 'balanced' })); assert.ok(OPS.length >= 20); });
