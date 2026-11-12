'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const L = require('../../shared/island-logic.js');

const rect = { left: 330, right: 430, top: 0, bottom: 30 };            // compact pill, 100x30 centred at x=380
test('hitTest: pad and top gap count, transparent margins do not', () => {
  assert.ok(L.hitTest({ x: 380, y: 15 }, rect, { pad: 8, gap: 10 }));
  assert.ok(L.hitTest({ x: 380, y: -10 }, rect, { pad: 8, gap: 10 }), 'the gap above the capsule (Fitts)');
  assert.ok(!L.hitTest({ x: 380, y: -30 }, rect, { pad: 8, gap: 10 }), 'beyond gap + pad');
  assert.ok(!L.hitTest({ x: 200, y: 15 }, rect, { pad: 8, gap: 10 }), 'transparent window margin to the left');
  assert.ok(L.hitTest({ x: 337, y: 15 }, rect, { pad: 8 })); assert.ok(!L.hitTest({ x: 320, y: 15 }, rect, { pad: 8 }));
  assert.ok(!L.hitTest({ x: 1, y: 1 }, null)); assert.ok(!L.hitTest(null, rect));
});
test('hitTest: bottom edge mirrors the gap', () => {
  const r = { left: 330, right: 430, top: 590, bottom: 620 };
  assert.ok(L.hitTest({ x: 380, y: 630 }, r, { pad: 8, gap: 10, bottom: true })); assert.ok(!L.hitTest({ x: 380, y: 590 - 12 }, r, { pad: 8, gap: 10, bottom: true }));
});
test('hitTest: while growing, the union with the target size is used (no false "left")', () => {
  const small = { left: 330, right: 430, top: 0, bottom: 30 };      // still a pill
  const pt = { x: 380 + 250, y: 300 };                              // inside the future 700x500 panel
  assert.ok(!L.hitTest(pt, small, { pad: 8 }), 'without the target it would read as outside');
  assert.ok(L.hitTest(pt, small, { pad: 8, target: { w: 700, h: 500 } }));
  assert.ok(!L.hitTest({ x: 380 + 400, y: 300 }, small, { pad: 8, target: { w: 700, h: 500 } }), 'outside the final panel is still outside');
});
test('hitTest: while shrinking, the old (larger) rect keeps counting until it has shrunk', () => {
  const big = { left: 30, right: 730, top: 0, bottom: 500 };
  assert.ok(L.hitTest({ x: 700, y: 400 }, big, { pad: 8, target: { w: 124, h: 30 } }), 'union includes the current large rect');
});
test('holds: begin/end, refresh, expiry by max age, run()', async () => {
  let t = 0; const h = L.createHolds({ now: () => t, defaultMaxAge: 1000 });
  assert.equal(h.active(), false); h.begin('a'); assert.equal(h.active(), true); h.end('a'); assert.equal(h.active(), false);
  h.begin('a'); t = 999; assert.equal(h.active(), true); t = 1001; assert.equal(h.active(), false, 'forgotten hold expires');
  h.begin('b', 5000); t = 5000; assert.equal(h.active(), true); h.begin('b', 5000); t = 9000; assert.equal(h.active(), true, 'begin refreshes'); t = 10001; assert.equal(h.active(), false);
  h.begin('x'); h.begin('y'); h.end('x'); assert.deepEqual(h.keys(), ['y']);
  let during; await h.run('job', (async () => { during = h.active(); })()); assert.equal(during, true); assert.ok(!h.keys().includes('job'), 'released after the work finishes');
  await assert.rejects(h.run('bad', Promise.reject(new Error('x')))); assert.ok(!h.keys().includes('bad'), 'released even when the work fails');
});
const base = { autoCollapse: true, state: 'full', inside: false, locked: false, holds: false, editableFocused: false, sinceInputMs: 1e9, sinceKeyMs: 1e9 };
test('decideCollapse: collapses from every screen when nothing blocks it', () => assert.deepEqual(L.decideCollapse(base), { collapse: true, reason: 'left' }));
test('decideCollapse: each blocker', () => {
  const no = (o, why) => { const r = L.decideCollapse({ ...base, ...o }); assert.equal(r.collapse, false, why); assert.equal(r.reason, why); };
  no({ autoCollapse: false }, 'disabled'); no({ state: 'compact' }, 'not-full'); no({ inside: true }, 'inside'); no({ locked: true }, 'locked');
  no({ holds: true }, 'hold'); no({ editableFocused: true, sinceInputMs: 2000 }, 'typing'); no({ sinceKeyMs: 300 }, 'keyboard');
});
test('decideCollapse: an abandoned focused input stops blocking after the idle grace', () => {
  assert.equal(L.decideCollapse({ ...base, editableFocused: true, sinceInputMs: 16000 }).collapse, true);
  assert.equal(L.decideCollapse({ ...base, editableFocused: true, sinceInputMs: 5000, inputIdleMs: 4000 }).collapse, true);
});
test('decideCollapse: auto-collapse off never collapses by hover', () => assert.equal(L.decideCollapse({ ...base, autoCollapse: false }).collapse, false));
test('clampDelay', () => { assert.equal(L.clampDelay('abc', 350, 100, 2000), 350); assert.equal(L.clampDelay(5, 350, 100, 2000), 100); assert.equal(L.clampDelay(9999, 350, 100, 2000), 2000); assert.equal(L.clampDelay(500, 350, 100, 2000), 500); });
test('pollInterval: fast near the window, slow far away', () => {
  const b = { x: 580, y: 10, width: 760, height: 620 };
  assert.equal(L.pollInterval({ x: 900, y: 300 }, b).zone, 'near'); assert.equal(L.pollInterval({ x: 900, y: -20 }, b).zone, 'near', 'just above the window (the gap)');
  assert.equal(L.pollInterval({ x: 200, y: 300 }, b).zone, 'mid'); const f = L.pollInterval({ x: 3000, y: 2000 }, b); assert.equal(f.zone, 'far'); assert.ok(f.ms >= 200);
});

/* ---- charger sound policy (src/system/notify.js) ---- */
const N = require('../../src/system/notify.js');
test('chargerEvent: only a real flip, never the first reading', () => {
  const b = (ac) => ({ hasBattery: true, ac, percent: 50 });
  assert.equal(N.chargerEvent(null, b(true)), null, 'first reading'); assert.equal(N.chargerEvent(b(false), b(true)), 'connect'); assert.equal(N.chargerEvent(b(true), b(false)), 'disconnect');
  assert.equal(N.chargerEvent(b(true), b(true)), null, 'still connected: no repeat'); assert.equal(N.chargerEvent(b(null), b(true)), null, 'unknown previous state');
  assert.equal(N.chargerEvent(b(false), { hasBattery: false, ac: true }), null, 'desktop without a battery');
});
test('chargePolicy: toggle, disconnect off by default, notifications, mute, volume', () => {
  const S = { chargeSound: true, chargeVolume: 40, chargeDisconnectSound: false };
  assert.deepEqual(N.chargePolicy('connect', S, {}), { play: true, volume: 0.4 });
  assert.equal(N.chargePolicy('disconnect', S, {}).play, false); assert.equal(N.chargePolicy('disconnect', { ...S, chargeDisconnectSound: true }, {}).play, true);
  assert.equal(N.chargePolicy('connect', { ...S, chargeSound: false }, {}).why, 'sound-off'); assert.equal(N.chargePolicy('connect', { ...S, notifyBattery: false }, {}).why, 'notifications-off');
  assert.equal(N.chargePolicy('connect', S, { muted: true }).why, 'system-muted'); assert.equal(N.chargePolicy('connect', { ...S, chargeVolume: 0 }, {}).why, 'volume-zero');
  assert.equal(N.chargePolicy('connect', { ...S, chargeVolume: 500 }, {}).volume, 1); assert.equal(N.chargePolicy('connect', { chargeSound: true }, {}).volume, 0.4, 'default volume');
});
test('createChargeGate: the same event inside the window is ignored, a different one is not', () => {
  let t = 0; const g = N.createChargeGate(4000, () => t);
  assert.equal(g('connect'), true); t = 1000; assert.equal(g('connect'), false); assert.equal(g('disconnect'), true); t = 6000; assert.equal(g('disconnect'), true); assert.equal(g(null), false);
});
