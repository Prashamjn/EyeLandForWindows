const { serve, emit, fail } = require('./lib');
let battery = { hasBattery: true, ac: true, charging: true, percent: 64, minutes: null, saver: false };
let powermode = { supported: true, mode: 'balanced', source: 'ac' };
let bri = 70;
serve(async (m) => {
  switch (m.cmd) {
    case 'get': return { battery, powermode, brightness: bri };
    case 'setMode': if (m.mode === 'efficiency' && battery.ac) throw fail('unavailable', 'This power mode is not available on this PC right now.'); powermode = { ...powermode, mode: m.mode }; emit('powermode', powermode); return true;
    case 'setBrightness': bri = m.value; emit('brightness', { value: bri }); return true;
    default: throw fail('unknown', 'Unknown command');
  }
}, () => { emit('battery', battery); emit('powermode', powermode); emit('brightness', { value: bri }); });
