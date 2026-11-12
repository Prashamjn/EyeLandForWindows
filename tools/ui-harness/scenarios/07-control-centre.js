// Phase 2: Control Centre + device notifications, against SIMULATED native helpers (see mock-native/lib.js).
// Verifies the app's real renderer, preload, IPC, validation, helper manager, state cache and notification logic.
// It does NOT verify real Windows behaviour.
const fs = require('fs'), path = require('path'), os = require('os');
const R = []; const ok = (n, c, x = '') => { R.push(!!c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
const CTL = process.env.LI_MOCK_CTL;
const inject = (name, ev, data) => fs.appendFileSync(path.join(CTL, name + '.ctl'), JSON.stringify({ ev, data }) + '\n');
module.exports = async (c) => {
  const ev = c.ev, wait = c.wait;
  await wait(9500);                                    // helpers start staggered (700 ms apart); notices are suppressed for ~8 s after launch
  await ev(`window.__n = []; const o = LI.notice; LI.notice = (n, t) => { window.__n.push(n.title + (n.sub ? ' | ' + n.sub : '')); return o(n, t); }; 0`);
  const notices = async () => ev('window.__n.slice()');
  const clear = () => ev('window.__n.length = 0; 0');
  const tile = (id) => ev(`(() => { const t = document.querySelector('.tile[data-pane="${id}"]'); return t ? t.querySelector('.t-title').textContent + ' / ' + t.querySelector('.t-sub').textContent : null; })()`);
  const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); 0`);

  // ---------- open from the bottom navigation ----------
  await ev("LI.island.open(); 0"); await wait(500);
  await click('#nav [data-view="control"]'); await wait(1200);
  ok('bottom-nav Control Centre opens the workspace', await ev("LI.island.mode === 'work' && LI.workspace.route().type === 'cc' && !document.getElementById('ccRoot').hidden && document.getElementById('wkTitle').textContent === 'Control Centre'"));
  ok('Wi-Fi tile shows the real network name', (await tile('wifi')) === 'Wi-Fi / Home Wi-Fi', await tile('wifi'));
  ok('Bluetooth tile shows the connected device', (await tile('bt')) === 'Bluetooth / MX Master', await tile('bt'));
  ok('VPN tile shows Proton VPN status (not connected)', (await tile('vpn')) === 'VPN / Proton VPN · Off', await tile('vpn'));
  ok('Battery tile shows percentage and charging', (await tile('battery')) === 'Battery / 64% · Charging', await tile('battery'));
  ok('Microphone tile shows the default device', (await tile('mic')).includes('Microphone Array'), await tile('mic'));
  ok('Power mode tile shows Balanced', (await tile('power')) === 'Power mode / Balanced', await tile('power'));
  ok('Display tile shows resolution', /×.*/.test(await tile('display')), await tile('display'));
  ok('Night Light tile is honest (Open Settings, no fake status)', (await tile('night')) === 'Night Light / Open Settings');
  ok('Sound output row shows the default device', await ev("document.getElementById('ccOutN').textContent === 'Speakers (Realtek Audio)'"));
  await c.shot('50_control_centre');

  // ---------- volume / mute / brightness (round trip through IPC -> helper -> event -> UI) ----------
  await ev("(() => { const r = document.getElementById('ccVol'); r.value = 72; r.dispatchEvent(new Event('input')); })(); 0"); await wait(500);
  ok('volume slider -> helper -> state event (72)', await ev("LI.cc.state.audio.volume === 72 && document.getElementById('ccVolN').textContent === '72'"));
  await click('.cc-ib[data-act="mute"]'); await wait(400);
  ok('mute button mutes via the helper', await ev("LI.cc.state.audio.muted === true && document.getElementById('ccVolN').textContent === 'Muted'"));
  await click('.cc-ib[data-act="mute"]'); await wait(400);
  ok('mute button unmutes', await ev("LI.cc.state.audio.muted === false"));
  inject('audio', 'audio', { audio: { available: true, volume: 15, muted: false, outId: '{0.0.0.00000000}.{aaaa-1}', outName: 'Speakers (Realtek Audio)', outputs: [{ id: '{0.0.0.00000000}.{aaaa-1}', name: 'Speakers (Realtek Audio)', default: true }, { id: '{0.0.0.00000000}.{bbbb-2}', name: 'Sony WH-1000XM5', default: false }] }, mic: { present: true, muted: false, name: 'Microphone Array (Realtek Audio)' } });
  await wait(400);
  ok('volume changed OUTSIDE the app (keyboard keys) updates the slider', await ev("document.getElementById('ccVol').value === '15'"));
  await ev("(() => { const r = document.getElementById('ccBri'); r.value = 40; r.dispatchEvent(new Event('input')); })(); 0"); await wait(600);
  ok('brightness slider -> helper -> event', await ev("LI.cc.state.bri === 40"));
  inject('power', 'brightness', { value: null }); await wait(300);
  ok('no controllable panel: brightness row is hidden (no false claim)', await ev("document.getElementById('ccBriRow').hidden === true"));
  inject('power', 'brightness', { value: 55 }); await wait(300);

  // ---------- sound output switching ----------
  await click('.cc-out'); await wait(500);
  ok('output picker lists both devices and marks the default', await ev("[...document.querySelectorAll('.cc-pane .li-row')].map(r => r.textContent).join('|').includes('Sony WH-1000XM5') && document.querySelector('.cc-pane .li-row.on').textContent.includes('Speakers')"));
  await clear(); await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Sony')).click(); 0"); await wait(600);
  ok('selecting an output switches the default (helper confirmed)', await ev("LI.cc.state.audio.outName === 'Sony WH-1000XM5'"));
  ok('notification: "Switched to Sony WH-1000XM5"', (await notices()).some((n) => n.startsWith('Switched to Sony WH-1000XM5')), JSON.stringify(await notices()));
  await c.shot('51_cc_audio');

  // ---------- Wi-Fi ----------
  await ev("LI.cc.go(null); 0"); await click('.tile[data-pane="wifi"] .t-main'); await wait(2200);
  const rows = await ev("[...document.querySelectorAll('.cc-pane .cc-list .li-row')].map(r => r.querySelector('b').textContent + ':' + r.querySelector('small').textContent)");
  ok('Wi-Fi pane lists discovered networks with status', rows.length === 4 && rows[0] === 'Home Wi-Fi:Connected' && rows.includes('Cafe Guest:Secured') && rows.includes('Open Hotspot:Open'), rows.join(' | '));
  await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Cafe Guest')).click(); 0"); await wait(300);
  ok('secured unknown network shows a password field (type=password)', await ev("!!document.querySelector('.pw-form input[type=password]')"));
  ok('Connect is disabled until a plausible password is entered', await ev("document.querySelector('.pw-form .btn.primary').disabled === true"));
  await c.shot('52_cc_wifi_password');
  await clear();
  await ev("(() => { const i = document.querySelector('.pw-form input'); i.value = 'wrong-pass-1'; i.dispatchEvent(new Event('input')); document.querySelector('.pw-form .btn.primary').click(); })(); 0"); await wait(1200);
  ok('wrong password -> failure message shown, not "connected"', await ev("document.querySelector('.cc-note.bad') && document.querySelector('.cc-note.bad').textContent.toLowerCase().includes('could not connect') && LI.cc.state.wifi.ssid === 'Home Wi-Fi'"));
  ok('notification: "Could not connect"', (await notices()).some((n) => n.startsWith('Could not connect')), JSON.stringify(await notices()));
  await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Cafe Guest')).click(); 0"); await wait(300);
  await clear();
  await ev("(() => { const i = document.querySelector('.pw-form input'); i.value = 'correct-pass'; i.dispatchEvent(new Event('input')); document.querySelector('.pw-form .btn.primary').click(); })(); 0"); await wait(1500);
  ok('correct password connects (state event from Windows, not UI guess)', await ev("LI.cc.state.wifi.state === 'connected' && LI.cc.state.wifi.ssid === 'Cafe Guest'"));
  const n1 = await notices();
  ok('notifications: "Connecting to network…" then "Connected to Cafe Guest"', n1.some((n) => n.startsWith('Connecting to network')) && n1.some((n) => n.startsWith('Connected to Cafe Guest')), JSON.stringify(n1));
  await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Corp')).click(); 0"); await wait(300);
  ok('enterprise network is not faked: explains and points to Windows', await ev("document.querySelector('.cc-note.bad').textContent.includes('work or school')"));
  await clear(); await ev("[...document.querySelectorAll('.cc-pane .btn')].find(b => b.textContent === 'Disconnect').click(); 0"); await wait(600);
  ok('Disconnect works and notifies', (await ev("LI.cc.state.wifi.state === 'disconnected'")) && (await notices()).some((n) => n.startsWith('Disconnected from Wi-Fi')), JSON.stringify(await notices()));
  await clear(); await ev("document.querySelector('.cc-pane .t-sw').click(); 0"); await wait(700);
  ok('Wi-Fi switch off -> radio off + notification + list hidden', (await ev("LI.cc.state.wifi.radio === 'off'")) && (await notices()).some((n) => n === 'Wi-Fi disabled'), JSON.stringify(await notices()));
  await ev("document.querySelector('.cc-pane .t-sw').click(); 0"); await wait(700);
  ok('Wi-Fi switch back on', await ev("LI.cc.state.wifi.radio === 'on'"));

  // ---------- Bluetooth ----------
  await ev("LI.cc.go('bt'); 0"); await wait(1200);
  const mine = await ev("[...document.querySelectorAll('.cc-pane .li-row')].map(r => r.querySelector('b').textContent + ':' + r.querySelector('small').textContent)");
  ok('Bluetooth pane lists paired devices with real state', mine.includes('Galaxy Buds:Paired') && mine.includes('MX Master:Connected'), mine.join(' | '));
  ok('discovery lists nearby unpaired devices', mine.some((r) => r.startsWith('Keychron K2')), mine.join(' | '));
  await clear(); await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Galaxy Buds')).querySelector('.btn').click(); 0"); await wait(700);
  ok('Connect -> device shown connected only after the state event', await ev("LI.cc.state.bt.devices.find(d => d.name === 'Galaxy Buds').connected === true"));
  ok('notification: "Galaxy Buds connected"', (await notices()).some((n) => n.startsWith('Galaxy Buds connected')), JSON.stringify(await notices()));
  await clear(); await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Galaxy Buds')).querySelector('.btn').click(); 0"); await wait(700);
  ok('Disconnect -> notification "Galaxy Buds disconnected"', (await notices()).some((n) => n.startsWith('Galaxy Buds disconnected')), JSON.stringify(await notices()));
  await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Keychron')).querySelector('.btn').click(); 0"); await wait(700);
  ok('Pair adds the device to My devices', await ev("LI.cc.state.bt.devices.some(d => d.name === 'Keychron K2')"));
  ok('low-energy device offers no fake connect button', await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('MX Master')).textContent.includes('Auto')"));
  await c.shot('53_cc_bluetooth');
  await clear(); await ev("document.querySelector('.cc-pane .t-sw').click(); 0"); await wait(700);
  ok('Bluetooth off -> "Bluetooth disabled"', (await notices()).includes('Bluetooth disabled'), JSON.stringify(await notices()));
  await ev("document.querySelector('.cc-pane .t-sw').click(); 0"); await wait(600);

  // ---------- VPN ----------
  await ev("LI.cc.go('vpn'); 0"); await wait(400);
  ok('VPN pane explains the Proton limitation honestly', await ev("document.querySelector('.cc-pane').textContent.includes('cannot connect or disconnect it')"));
  await clear(); inject('net', 'vpn', { installed: true, version: '3.5.0', running: true, adapter: 'ProtonVPN', connected: true, launch: __filename }); await wait(500);
  ok('VPN adapter up -> "Proton VPN connected" (observed, not clicked)', (await notices()).includes('Proton VPN connected'), JSON.stringify(await notices()));
  await clear(); inject('net', 'vpn', { installed: true, version: '3.5.0', running: true, adapter: 'ProtonVPN', connected: true, launch: __filename }); await wait(400);
  ok('same VPN state again does not notify twice', (await notices()).length === 0);
  inject('net', 'vpn', { installed: true, version: '3.5.0', running: true, adapter: 'ProtonVPN', connected: false, launch: __filename }); await wait(500);
  ok('VPN down -> "Proton VPN disconnected"', (await notices()).includes('Proton VPN disconnected'));
  await c.shot('54_cc_vpn');
  inject('net', 'vpn', { installed: false, running: false, adapter: null, connected: true, launch: null }); await wait(500);
  await ev("LI.cc.go(null); 0"); await wait(300);
  ok('not installed never shows connected', (await tile('vpn')) === 'VPN / Proton VPN not installed', await tile('vpn'));
  const op = await ev("cc.call('vpn.openApp', {})");
  ok('open-app when not installed fails with a clear code', op.ok === false && op.code === 'not_installed', JSON.stringify(op));

  // ---------- power mode, battery, mic, night light, display ----------
  await ev("LI.cc.go('power'); 0"); await wait(400);
  await clear(); await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Best performance')).click(); 0"); await wait(600);
  ok('power mode switch applied and confirmed', await ev("LI.cc.state.powermode.mode === 'performance'"));
  ok('notification: "Power mode: Best performance"', (await notices()).includes('Power mode: Best performance'), JSON.stringify(await notices()));
  await ev("[...document.querySelectorAll('.cc-pane .li-row')].find(r => r.textContent.includes('Best power efficiency')).click(); 0"); await wait(700);
  ok('a mode Windows refuses is NOT shown as active', await ev("LI.cc.state.powermode.mode === 'performance' && document.querySelector('.cc-pane .li-row.on').textContent.includes('Best performance')"));
  await clear(); inject('power', 'battery', { hasBattery: true, ac: false, charging: false, percent: 19, minutes: 75, saver: false }); await wait(500);
  const nb = await notices();
  ok('charger unplugged -> notification', nb.some((n) => n.startsWith('Charger disconnected')), JSON.stringify(nb));
  inject('power', 'battery', { hasBattery: true, ac: false, charging: false, percent: 18, minutes: 70, saver: false }); await wait(400);
  ok('battery low fires once (19% crossing) and not again at 18%', (await notices()).filter((n) => n.startsWith('Battery low')).length === 1, JSON.stringify(await notices()));
  await ev("LI.cc.go('battery'); 0"); await wait(300);
  ok('battery pane shows real time remaining', await ev("document.querySelector('.cc-pane').textContent.includes('1 h 10 min')"));
  await clear(); await ev("LI.cc.go(null); 0"); await wait(300); await ev("document.querySelector('.tile[data-pane=mic] .t-sw').click(); 0"); await wait(600);
  ok('microphone mute via helper + notification', (await ev("LI.cc.state.mic.muted === true")) && (await notices()).some((n) => n.startsWith('Microphone muted')), JSON.stringify(await notices()));
  await ev("document.querySelector('.tile[data-pane=mic] .t-sw').click(); 0"); await wait(400);
  await ev("LI.cc.go('night'); 0"); await wait(300);
  ok('Night Light pane: states the limitation, offers Windows Settings', await ev("document.querySelector('.cc-pane').textContent.includes('undocumented registry') && [...document.querySelectorAll('.cc-pane .btn')].some(b => b.textContent === 'Open Windows Settings')"));
  await ev("LI.cc.go('display'); 0"); await wait(300);
  ok('Displays pane lists monitors with resolution and refresh rate', await ev("/\\d+×\\d+ · (\\d+|\\?) Hz/.test(document.querySelector('.cc-pane .li-row').textContent)"));
  await c.shot('55_cc_displays');

  // ---------- notification categories can be disabled; de-duplication ----------
  await ev("LI.cc.go(null); 0");
  c.ipcMain.emit('noop'); await ev("api.saveSettings({ notifyWifi: false }); LI.S.notifyWifi = false; 0"); await wait(300);
  await clear(); inject('net', 'wifi', { adapter: true, state: 'connected', ssid: 'Silent Net', signal: 50, radio: 'on' }); await wait(500);
  ok('disabled category (Wi-Fi) produces no notification, state still updates', (await notices()).length === 0 && await ev("LI.cc.state.wifi.ssid === 'Silent Net'"), JSON.stringify(await notices()));
  await ev("api.saveSettings({ notifyWifi: true }); 0"); await wait(300);

  // ---------- security: validation + channel allowlist ----------
  const bad = [
    ['unknown op', 'audio.explode', {}], ['volume NaN', 'audio.setVolume', { value: 'abc' }], ['ssid too long', 'wifi.connect', { ssid: 'x'.repeat(40), security: 'open' }],
    ['bad security', 'wifi.connect', { ssid: 'a', security: 'rm -rf' }], ['bad device id', 'audio.setOutput', { id: '"; calc.exe; "' }], ['bad bt id', 'bt.connect', { id: 'a b;c' }], ['bad mode', 'power.setMode', { mode: 'turbo' }],
  ];
  for (const [n, op, arg] of bad) { const r = await ev(`window.cc.call(${JSON.stringify(op)}, ${JSON.stringify(arg)})`); ok('rejected: ' + n, r.ok === false && (r.code === 'invalid'), JSON.stringify(r)); }
  ok('volume 500 is clamped to 100, not passed through', (await ev("cc.call('audio.setVolume', { value: 500 })")).ok === true && await ev("(async()=>{await new Promise(r=>setTimeout(r,300)); return LI.cc.state.audio.volume === 100})()"));
  const blocked = await ev("window.eyeland.invoke('app:quit').then(() => 'allowed', (e) => 'blocked: ' + e.message)");
  ok('preload refuses channels outside ey:/ov:', blocked.startsWith('blocked'), blocked);
  ok('preload bridge has no raw ipcRenderer or require', await ev("typeof require === 'undefined' && typeof ipcRenderer === 'undefined' && typeof process === 'undefined'"));
  ok('node integration is off in the island', await ev("typeof module === 'undefined'"));

  // ---------- notification presentation: compact island expands, then collapses ----------
  await ev("LI.island.close(); LI.workspace.toDash('home'); 0"); await wait(900);
  ok('island is compact before the event', await ev("LI.island.state === 'compact'"));
  inject('bt', 'bt', { radio: 'on', devices: [{ id: 'Bluetooth#buds', name: 'Galaxy Buds', connected: true, paired: true, kind: 'audio', le: false }, { id: 'Bluetooth#mouse', name: 'MX Master', connected: true, paired: true, kind: 'peripheral', le: true }, { id: 'Bluetooth#kb', name: 'Keychron K2', connected: true, paired: true, kind: 'peripheral', le: false }] });
  await wait(700);
  ok('device event expands the compact island to the notification (mini)', await ev("LI.island.state === 'mini' && document.getElementById('mTitle').textContent === 'Galaxy Buds connected'"), await ev("document.getElementById('mTitle').textContent"));
  ok('notification does not take keyboard focus (window not focusable)', await ev("LI.island.workFocus === false"));
  await c.shot('56_notification_mini');
  await wait(3600);
  ok('notification collapses back to compact on its own', await ev("LI.island.state === 'compact'"));
  console.log('[TEST] summary pass=' + R.filter(Boolean).length + ' fail=' + R.filter((x) => !x).length);
};
