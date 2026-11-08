const { serve, emit, fail } = require('./lib');
let radio = 'on';
let devices = [{ id: 'Bluetooth#buds', name: 'Galaxy Buds', connected: false, paired: true, kind: 'audio', le: false }, { id: 'Bluetooth#mouse', name: 'MX Master', connected: true, paired: true, kind: 'peripheral', le: true }];
const state = () => ({ radio, devices });
const push = () => emit('bt', state());
serve(async (m) => {
  switch (m.cmd) {
    case 'get': return state();
    case 'setRadio': radio = m.on ? 'on' : 'off'; push(); return true;
    case 'scan': setTimeout(() => emit('bt-scan', { done: false, devices: [{ id: 'Bluetooth#kb', name: 'Keychron K2', paired: false }] }), 150); setTimeout(() => emit('bt-scan', { done: true, devices: [{ id: 'Bluetooth#kb', name: 'Keychron K2', paired: false }] }), 400); return true;
    case 'stopScan': return true;
    case 'connect': { const d = devices.find((x) => x.id === m.id); if (!d) throw fail('not_found', 'That device is not paired with this PC.'); if (d.name === 'Galaxy Buds' && globalThis.__fail) throw fail('not_connected', 'Windows did not confirm a connection.'); d.connected = true; push(); return true; }
    case 'disconnect': { const d = devices.find((x) => x.id === m.id); d.connected = false; push(); return true; }
    case 'pair': devices.push({ id: m.id, name: 'Keychron K2', connected: true, paired: true, kind: 'peripheral', le: false }); push(); return true;
    default: throw fail('unknown', 'Unknown command');
  }
}, push);
