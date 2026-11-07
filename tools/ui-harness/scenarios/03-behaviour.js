const fs = require('fs'), path = require('path');
const R = {}; const ok = (name, cond, extra = '') => { R[name] = !!cond; console.log(`[TEST] ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
module.exports = async (c) => {
  const { app } = c; const ud = app.getPath('userData');
  const win = c.island();
  await c.wait(700);

  // ---- main-process window properties
  const b = win.getBounds(); const disp = require('electron').screen.getPrimaryDisplay().bounds;
  ok('window: 700x460, horizontally centred, top edge', b.width === 700 && b.height === 460 && b.x === Math.round(disp.x + (disp.width - 700) / 2) && b.y === disp.y, JSON.stringify(b));
  ok('window: always on top, visible, transparent frameless', win.isAlwaysOnTop() && win.isVisible());
  ok('main.js pins userData to <appData>/eyeland (existing data folder)', c.PINNED_UD === path.join(c.appData, 'eyeland'), c.PINNED_UD);

  // ---- A. hover through the real cursor IPC channel (window-relative coords)
  const rect = JSON.parse(await c.ev("JSON.stringify(document.getElementById('island').getBoundingClientRect())"));
  const cx = Math.round(rect.left + rect.width / 2), cy = Math.round(rect.top + rect.height / 2);
  c.send('cursor', { x: cx, y: cy }); await c.wait(450);
  ok('hover on compact island opens full state', (await c.ev("LI.island.state")) === 'full');
  c.send('cursor', { x: 5, y: 440 }); await c.wait(900);
  ok('moving away closes back to compact', (await c.ev("LI.island.state")) === 'compact');

  // ---- B. animation: sample island width every frame
  const sample = (js) => c.ev(`new Promise(res => { const i = document.getElementById('island'), out = []; const t0 = performance.now(); (function f(){ out.push([Math.round(performance.now()-t0), i.getBoundingClientRect().width, i.getBoundingClientRect().height]); if (performance.now()-t0 < 900) requestAnimationFrame(f); else res(out); })(); ${js} })`);
  let s = await sample("LI.island.open()");
  const ws = s.map((x) => x[1]), hs = s.map((x) => x[2]);
  const mono = ws.every((w, i) => i === 0 || w >= ws[i - 1] - 0.01) && hs.every((h, i) => i === 0 || h >= hs[i - 1] - 0.01);
  ok('expand: width/height monotonic (no jitter, no bounce)', mono);
  ok('expand: never overshoots final size (620x388)', Math.max(...ws) <= 620.5 && Math.max(...hs) <= 388.5, `max ${Math.max(...ws).toFixed(1)}x${Math.max(...hs).toFixed(1)}`);
  ok('expand: reaches 620x388', Math.abs(ws[ws.length - 1] - 620) < 1 && Math.abs(hs[hs.length - 1] - 388) < 1);
  ok('expand: spread over many frames (not a jump)', s.filter((x) => x[1] > 124.5 && x[1] < 619).length >= 12, `${s.filter((x) => x[1] > 124.5 && x[1] < 619).length} in-between frames`);
  s = await sample("LI.island.close()");
  const wc = s.map((x) => x[1]);
  ok('collapse: monotonic shrink back to 124 wide', wc.every((w, i) => i === 0 || w <= wc[i - 1] + 0.01) && Math.abs(wc[wc.length - 1] - 124) < 1);

  // ---- C. activity listeners: one event must produce exactly one activity (no duplicate listeners)
  await c.ev("window.__n = 0; const o = LI.activity.show; LI.activity.show = function(){ window.__n++; return o.apply(this, arguments); }; 0;");
  c.send('system', { kind: 'vol', value: 10, muted: false }); await c.wait(100);       // first reading
  c.send('system', { kind: 'vol', value: 20, muted: false }); await c.wait(150);
  ok('one volume event -> exactly one activity.show', (await c.ev("window.__n")) === 1, 'n=' + (await c.ev("window.__n")));
  await c.wait(2300);

  // ---- D. brightness unsupported hides the slider row
  c.send('system', { kind: 'bri', value: null }); await c.wait(100);
  ok('brightness unsupported -> slider row hidden', await c.ev("document.getElementById('briRow').hidden === true"));

  // ---- E. reduced motion (emulated via CDP)
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.wait(100);
  const dur = await c.ev("getComputedStyle(document.getElementById('island')).transitionDuration");
  ok('reduced motion: island transitions effectively disabled', /^0\.00?1?s|^1e-05s|^0s/.test(dur.split(',')[0].trim()) || parseFloat(dur) < 0.001, dur);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  win.webContents.debugger.detach();

  // ---- F. coffee + timer compact indicators
  c.send('coffee', true); await c.wait(700);
  ok('coffee on -> compact shows cup + widens (busy)', await c.ev("document.getElementById('island').hasAttribute('data-busy') && !document.getElementById('cIco').hidden"));
  await c.shot('20_compact_coffee');
  c.send('coffee', false); await c.wait(300);
  await c.ev("LI.dashboard.show('timer'); document.getElementById('timerToggle').click()"); await c.wait(900);
  ok('timer running -> compact shows countdown', await c.ev("!document.getElementById('cTimer').hidden && /^\\d\\d:\\d\\d$/.test(document.getElementById('cTimer').textContent)"), await c.ev("document.getElementById('cTimer').textContent"));
  await c.shot('21_compact_timer');
  await c.ev("LI.island.open()"); await c.wait(1000);
  await c.ev("LI.dashboard.show('home')"); await c.wait(300);
  await c.shot('22_full_timer_activity');
  // fast-forward the clock past the end of the focus session
  await c.ev("(() => { window.__realNow = Date.now; const real = Date.now.bind(Date); Date.now = () => real() + 26 * 60 * 1000; })()"); await c.wait(800);
  ok('timer finish -> completion notice shown + rolls to Break', (await c.ev("document.getElementById('actTitle').textContent")) === 'Focus complete' && await c.ev("document.querySelector('[data-tmode=break]').classList.contains('on')"));
  await c.shot('23_full_timer_done');
  await c.ev("(() => { Date.now = window.__realNow; })()");
  await c.ev("LI.island.close()"); await c.wait(700);

  // ---- G. persistence: add a task through the UI, change settings, verify on disk
  await c.ev("LI.dashboard.show('tasks'); const i = document.getElementById('taskInput'); i.value = 'Ship Liquid Island'; document.getElementById('taskAdd').click();"); await c.wait(300);
  await c.ev("(() => { const t = document.getElementById('f_theme'); t.value = 'light'; t.dispatchEvent(new Event('input')); const a = document.getElementById('f_accent'); a.value = 'green'; a.dispatchEvent(new Event('input')); })()"); await c.wait(500);
  const disk = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  ok('settings persisted: task, theme, accent written to settings.json', disk.todos[0].text === 'Ship Liquid Island' && disk.theme === 'light' && disk.accent === 'green', JSON.stringify({ theme: disk.theme, accent: disk.accent }));
  ok('old eyeColor setting no longer written for new installs', !('eyeColor' in disk));
  await c.ev("LI.island.open(); LI.dashboard.show('home')"); await c.wait(1000);
  await c.shot('24_light_green');
  await c.ev("(() => { const t = document.getElementById('f_theme'); t.value = 'black'; t.dispatchEvent(new Event('input')); const a = document.getElementById('f_accent'); a.value = 'blue'; a.dispatchEvent(new Event('input')); })()"); await c.wait(300);

  // ---- H. leak check: 60 open/close + activity cycles
  const nodes0 = await c.ev("document.getElementsByTagName('*').length"); const heap0 = await c.ev("performance.memory.usedJSHeapSize");
  for (let i = 0; i < 60; i++) { await c.ev("LI.island.open(); LI.activity.show({id:'t',kind:'notice',icon:'check',title:'x'+Math.random()},{ttl:50}); LI.panels.paintClips(); LI.panels.paintTasks(); LI.island.close()"); await c.wait(25); }
  await c.wait(600);
  const nodes1 = await c.ev("document.getElementsByTagName('*').length"); const heap1 = await c.ev("performance.memory.usedJSHeapSize");
  ok('no DOM growth after 60 open/close/activity cycles', nodes1 - nodes0 <= 2, `nodes ${nodes0} -> ${nodes1}`);
  ok('JS heap growth small after 60 cycles (< 3 MB)', heap1 - heap0 < 3e6, `${((heap1 - heap0) / 1e6).toFixed(2)} MB`);

  // ---- I. idle CPU
  await c.ev("LI.island.close()"); await c.wait(1500);
  app.getAppMetrics(); await c.wait(5000);
  const m = app.getAppMetrics().map((x) => `${x.type}:${x.cpu.percentCPUUsage.toFixed(1)}%`).join('  ');
  const rend = app.getAppMetrics().filter((x) => x.type === 'Tab').map((x) => x.cpu.percentCPUUsage);
  ok('idle CPU: renderer < 2% over 5 s (software-rendered Xvfb)', Math.max(0, ...rend) < 2, m);
  console.log('[TEST] summary', JSON.stringify(R));
};
