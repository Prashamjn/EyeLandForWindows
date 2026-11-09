const test = require('node:test');
const assert = require('node:assert');
const { V } = require('../../src/system/validate');
const { makeSystem } = require('./fixtures/sys-harness');

test('wifi.connect validator: saved profiles, scan-less networks, bad input', () => {
  const ok = V['wifi.connect']({ ssid: 'Home', security: 'wpa2', known: true, profile: 'Home 2', password: '' });
  assert.deepStrictEqual([ok.profile, ok.known], ['Home 2', true]);
  assert.strictEqual(V['wifi.connect']({ ssid: 'Cafe', security: 'open' }).profile, '');
  assert.throws(() => V['wifi.connect']({ ssid: 'X', security: 'unknown', known: false }), /saved one/);          // 'unknown' only for saved profiles
  assert.throws(() => V['wifi.connect']({ ssid: 'X', security: 'wpa2', known: false, profile: 'P' }), /Profile name/);   // a profile name only with a saved network
  assert.throws(() => V['wifi.connect']({ ssid: 'X', security: 'wpa2', known: true, profile: 'a\u0000b' }), /Profile name/);
  assert.throws(() => V['wifi.connect']({ ssid: 'X', security: 'rot13' }), /security/);
  for (const s of ['wep', 'wpa', 'owe', 'enterprise']) assert.ok(V['wifi.connect']({ ssid: 'X', security: s }));
});

test('wifi.scan: when Windows refuses scanning the saved networks and the fix are returned, not an empty list', async () => {
  const t = makeSystem({ net: `if (m.cmd === 'get') return { wifi: null, vpn: null };
    if (m.cmd === 'networks') return { networks: [{ ssid: 'Home 2', profile: 'Home 2', known: true, limited: true, security: 'unknown' }], limited: true, reason: 'location_denied', scanCode: 5, listCode: 5 };
    throw L.fail('unknown', m.cmd);` });
  try {
    const r = await t.sys.call('wifi.scan', {});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.limited, true);
    assert.strictEqual(r.data.networks.length, 1);
    assert.deepStrictEqual(r.data.action, { op: 'settings.open', page: 'location', label: 'Open location settings' });
  } finally { t.stop(); }
});

test('helper errors reach the caller with code, message, detail and the fix action', async () => {
  const t = makeSystem({ net: `if (m.cmd === 'get') return { wifi: null, vpn: null }; throw Object.assign(new Error('Windows blocks location'), { code: 'location_denied' });` });
  try {
    const r = await t.sys.call('wifi.scan', {});
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'location_denied'); assert.strictEqual(r.error, 'Windows blocks location');
    assert.strictEqual(r.action.page, 'location');
    const bad = await t.sys.call('wifi.connect', { ssid: 'x', security: 'rot13' });
    assert.deepStrictEqual([bad.ok, bad.code], [false, 'invalid']);
  } finally { t.stop(); }
});
