// The backend must not report success until a fresh read from the helper shows the requested state.
// The mock helpers here only exercise OUR confirmation logic (they can "lie": reply OK without changing anything). They prove nothing about Windows.
const test = require('node:test');
const assert = require('node:assert');
process.env.LI_SETTLE_MS = '600';
const { makeSystem } = require('./fixtures/sys-harness');

const audioMock = (lie) => `
  if (m.cmd === 'get') return { audio: { available: true, volume: S.v == null ? 30 : S.v, muted: !!S.m, outId: S.out || 'A', outName: S.out || 'A', outputs: [] }, mic: { present: true, muted: !!S.mic } };
  if (m.cmd === 'setVolume') { ${lie ? '' : 'S.v = m.value;'} return true; }
  if (m.cmd === 'setMute') { ${lie ? '' : 'S.m = m.muted;'} return true; }
  if (m.cmd === 'setOutput') { ${lie ? '' : 'S.out = m.id;'} return { audio: { available: true, volume: 30, muted: false, outId: S.out || 'A', outName: S.out || 'A', outputs: [] }, mic: { present: true, muted: false } }; }
  if (m.cmd === 'setMicMute') { ${lie ? '' : 'S.mic = m.muted;'} return true; }
  throw L.fail('unknown', m.cmd);`;

test('honest helper: operations succeed and the cache holds what Windows reported', async () => {
  const t = makeSystem({ audio: audioMock(false) });
  try {
    assert.deepStrictEqual((await t.sys.call('audio.setVolume', { value: 55 })).ok, true);
    assert.strictEqual((await t.sys.call('state.all', {})).data.audio.volume, 55);
    assert.strictEqual((await t.sys.call('audio.setMute', { muted: true })).ok, true);
    assert.strictEqual((await t.sys.call('audio.setOutput', { id: '{0.0.0.00000000}.{aaaaaaaa-0000-0000-0000-000000000001}' })).ok, true);
    assert.strictEqual((await t.sys.call('mic.setMute', { muted: true })).ok, true);
  } finally { t.stop(); }
});

test('lying helper: "OK" without a real change becomes an unverified error that says what Windows reports', async () => {
  const t = makeSystem({ audio: audioMock(true) });
  try {
    const v = await t.sys.call('audio.setVolume', { value: 80 });
    assert.deepStrictEqual([v.ok, v.code], [false, 'unverified']); assert.match(v.error, /reports the volume as 30%/);
    const m = await t.sys.call('audio.setMute', { muted: true });
    assert.deepStrictEqual([m.ok, m.code], [false, 'unverified']);
    const o = await t.sys.call('audio.setOutput', { id: '{0.0.0.00000000}.{aaaaaaaa-0000-0000-0000-000000000002}' });
    assert.deepStrictEqual([o.ok, o.code], [false, 'unverified']); assert.match(o.error, /still reports/);
  } finally { t.stop(); }
});

test('radio switches are verified against a fresh read', async () => {
  const net = (lie) => `if (m.cmd === 'get') return { wifi: { radio: S.on ? 'on' : 'off', state: 'disconnected' }, vpn: null }; if (m.cmd === 'setRadio') { ${lie ? '' : 'S.on = m.on;'} return true; } throw L.fail('unknown', m.cmd);`;
  const good = makeSystem({ net: net(false) }), bad = makeSystem({ net: net(true) });
  try {
    assert.strictEqual((await good.sys.call('wifi.setPower', { on: true })).ok, true);
    assert.strictEqual((await good.sys.call('state.all', {})).data.wifi.radio, 'on');
    const r = await bad.sys.call('wifi.setPower', { on: true });
    assert.deepStrictEqual([r.ok, r.code], [false, 'unverified']); assert.match(r.error, /Wi-Fi radio as off/);
  } finally { good.stop(); bad.stop(); }
});

test('a superseded slider request is not reported as a failure', async () => {
  const t = makeSystem({ audio: `if (m.cmd === 'get') return { audio: { available: true, volume: S.v == null ? 30 : S.v, muted: false, outId: 'A', outName: 'A', outputs: [] }, mic: null };
    if (m.cmd === 'setVolume') { await new Promise((r) => setTimeout(r, m.value === 40 ? 150 : 0)); S.v = m.value; return true; } throw L.fail('unknown', m.cmd);` });
  try {
    const [a, b] = await Promise.all([t.sys.call('audio.setVolume', { value: 40 }), t.sys.call('audio.setVolume', { value: 70 })]);
    assert.strictEqual(b.ok, true); assert.strictEqual(a.ok, true);          // the older request is superseded, not "unverified"
    assert.strictEqual((await t.sys.call('state.all', {})).data.audio.volume, 70);
  } finally { t.stop(); }
});

test('a recovered helper clears its stale "unavailable" marker (renderer relies on the helper "up" event)', async () => {
  const t = makeSystem({ net: `if (m.cmd === 'get') return { wifi: { radio: 'on', state: 'disconnected' }, vpn: null }; throw L.fail('unknown', m.cmd);` });
  try { const r = await t.sys.call('state.all', {}); assert.deepStrictEqual(r.data.unavailable, {}); } finally { t.stop(); }
});
