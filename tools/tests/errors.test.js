const test = require('node:test');
const assert = require('node:assert');
const { V } = require('../../src/system/validate');
const { actionFor, SETTINGS } = require('../../src/system/errors');

test('settings.open accepts only whitelisted pages', () => {
  for (const page of Object.keys(SETTINGS)) assert.deepStrictEqual(V['settings.open']({ page }), { page });
  for (const bad of [undefined, null, {}, { page: 'toString' }, { page: 'ms-settings:privacy-location' }, { page: 'https://evil.example' }, { page: '__proto__' }]) assert.throws(() => V['settings.open'](bad), /Unknown settings page/);
});
test('every action points at a whitelisted settings page', () => {
  for (const code of ['location_denied', 'radio_denied']) { const a = actionFor(code); assert.ok(a && SETTINGS[a.page], code); assert.strictEqual(a.op, 'settings.open'); }
  assert.strictEqual(actionFor('failed'), null); assert.strictEqual(actionFor(undefined), null);
});
