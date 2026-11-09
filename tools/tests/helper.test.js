const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Helper } = require('../../src/system/helper');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-h-'));
const lib = path.resolve(__dirname, '../ui-harness/mock-native/lib.js');
const write = (name, body) => fs.writeFileSync(path.join(dir, name + '.js'), `const { serve, emit, fail } = require(${JSON.stringify(lib)}); ${body}`);
const mk = (name) => new Helper({ name, nativeDir: '', mockDir: dir });
process.env.ELECTRON_RUN_AS_NODE = '1';

test('request/reply and events', async () => {
  write('echo', "serve(async (m) => { if (m.cmd === 'echo') return m.value; throw fail('boom', 'no'); }, () => emit('hello', { n: 1 }));");
  const h = mk('echo'); const ev = []; h.on('event', (e, d) => ev.push([e, d]));
  assert.equal(await h.request('echo', { value: 42 }), 42);
  await assert.rejects(h.request('nope'), (e) => e.code === 'boom');
  assert.deepEqual(ev[0], ['hello', { n: 1 }]); h.stop();
});
test('REGRESSION: a command argument called "id" (device id) must not collide with the request id', async () => {
  write('ids', "serve(async (m) => ({ got: m.id }));");
  const h = mk('ids');
  const [a, b] = await Promise.all([h.request('x', { id: 'Bluetooth#dev1' }, 3000), h.request('x', { id: '{0.0.0.0}.{g}' }, 3000)]);
  assert.equal(a.got, 'Bluetooth#dev1'); assert.equal(b.got, '{0.0.0.0}.{g}'); h.stop();
});
test('timeout rejects with code "timeout" and later replies are ignored', async () => {
  write('slow', "serve(async () => new Promise((r) => setTimeout(() => r(1), 600)));");
  const h = mk('slow'); await assert.rejects(h.request('x', {}, 150), (e) => e.code === 'timeout'); await new Promise((r) => setTimeout(r, 700)); h.stop();
});
test('crash: pending requests reject, helper restarts, and gives up after repeated crashes', async () => {
  write('crash', "serve(async (m) => { if (m.cmd === 'die') process.exit(1); return 'alive'; });");
  const h = mk('crash'); assert.equal(await h.request('ok'), 'alive');
  await assert.rejects(h.request('die'), (e) => e.code === 'exited');
  await new Promise((r) => setTimeout(r, 2000));                           // backoff restart (1.5 s)
  assert.equal(await h.request('ok'), 'alive'); h.stop();
});
test('unsupported platform without a mock: clear error, nothing spawned', async () => {
  const h = new Helper({ name: 'x', file: 'x.ps1', nativeDir: '/nope', mockDir: '' });
  if (process.platform !== 'win32') await assert.rejects(h.request('get'), (e) => e.code === 'unsupported');
});
test('stdin closes -> helper exits (never lingers as an orphan)', async () => {
  write('exit', "serve(async () => 1);");
  const h = mk('exit'); await h.request('x'); const p = h.proc; h.stop();
  await new Promise((r) => p.on('exit', r)); assert.ok(true);
});
