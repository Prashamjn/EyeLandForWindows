const { serve, emit, fail } = require('./lib');
const outputs = [{ id: '{0.0.0.00000000}.{aaaa-1}', name: 'Speakers (Realtek Audio)' }, { id: '{0.0.0.00000000}.{bbbb-2}', name: 'Sony WH-1000XM5', form: 3 }];
let a = { available: true, volume: 35, muted: false, outId: outputs[0].id, outName: outputs[0].name };
let mic = { present: true, muted: false, name: 'Microphone Array (Realtek Audio)', id: 'm1', level: 80 };
const state = () => ({ audio: { ...a, outputs: outputs.map((o) => ({ ...o, default: o.id === a.outId })) }, mic });
const push = () => emit('audio', state());
serve(async (m) => {
  switch (m.cmd) {
    case 'get': return state();
    case 'setVolume': a.volume = m.value; if (m.value > 0) a.muted = false; push(); return true;
    case 'setMute': a.muted = m.muted; push(); return true;
    case 'setMicMute': mic = { ...mic, muted: m.muted }; push(); return true;
    case 'setOutput': { const o = outputs.find((x) => x.id === m.id); if (!o) throw fail('failed', 'That device is not available'); a.outId = o.id; a.outName = o.name; push(); return true; }
    default: throw fail('unknown', 'Unknown command');
  }
}, push);
