// Builds a real createSystem() (real Helper manager, validators, cache, IPC entry point) on top of tiny in-test mock helpers.
// The mocks only test OUR Node logic (confirmation, error propagation, caching). They prove nothing about Windows.
const fs = require('fs'), os = require('os'), path = require('path');
// Electron's screen module is the only Electron import in src/system; give plain Node a one-display stand-in.
const Module = require('module'); const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { screen: { getPrimaryDisplay: () => ({ id: 1 }), getAllDisplays: () => [{ id: 1, bounds: { width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1, displayFrequency: 60, internal: true, label: 'Test' }] } } : origLoad.call(this, req, ...rest); };
const LIB = path.join(__dirname, '..', '..', 'ui-harness', 'mock-native', 'lib.js');
const DEFAULT = (name) => `const L = require(${JSON.stringify(LIB)}); L.serve(async (m) => { if (m.cmd === 'get') return ${name === 'net' ? '{ wifi: null, vpn: null }' : name === 'audio' ? '{ audio: null, mic: null }' : name === 'bt' ? '{ radio: "off", devices: [] }' : '{ battery: null, powermode: null, brightness: null }'}; throw L.fail("unknown", m.cmd); });`;
exports.makeSystem = (bodies = {}, { settings = {} } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-mock-'));
  for (const n of ['audio', 'net', 'bt', 'power']) fs.writeFileSync(path.join(dir, n + '.js'), bodies[n] ? `const L = require(${JSON.stringify(LIB)}); const S = {}; L.serve(async (m) => { ${bodies[n]} });` : DEFAULT(n));
  process.env.LI_NATIVE_MOCK = dir;
  const events = [];
  const { createSystem } = require('../../../src/system/index.js');
  const sys = createSystem({ nativeDir: dir, send: (ch, p) => events.push([ch, p]), settings: () => ({ ...settings }), openExternal: async () => {}, openPath: async () => '' });
  return { sys, events, dir, stop: () => { sys.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); } };
};
