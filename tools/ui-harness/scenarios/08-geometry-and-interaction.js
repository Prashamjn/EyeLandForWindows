// Phase 2: window geometry (top gap), pill silhouette, pinning / focus, hit-testing, blur-collapse, motion.
// Multi-monitor placement is exercised by stubbing Electron's screen API (SIMULATED displays; no second physical monitor here).
const R = []; const ok = (n, c, x = '') => { R.push(!!c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
module.exports = async (c) => {
  const { screen } = require('electron'); const win = c.island(); const ev = c.ev, wait = c.wait;
  await wait(900);
  const prim = screen.getPrimaryDisplay().bounds;
  const save = async (p) => { await ev(`api.saveSettings(${JSON.stringify(p)}); Object.assign(LI.S, ${JSON.stringify(p)}); LI.bus.emit('settings', LI.S); 0`); await wait(350); };

  // ---- top gap: the WINDOW is placed at the offset, not just padded with CSS
  let b = win.getBounds();
  ok('default top gap is 10 px: window y = screen top + 10', b.y === prim.y + 10, JSON.stringify(b));
  ok('window is horizontally centred and 760x620 (stable canvas)', b.width === 760 && b.height === 620 && b.x === Math.round(prim.x + (prim.width - 760) / 2));
  const geo = JSON.parse(await ev("(() => { const r = document.getElementById('island').getBoundingClientRect(); const cs = getComputedStyle(document.getElementById('island')); return JSON.stringify({ top: r.top, w: r.width, h: r.height, edge: document.body.dataset.edge, radius: cs.borderTopLeftRadius + '/' + cs.borderBottomRightRadius }); })()"));
  ok('island sits flush at the top of its window (no CSS margin used)', geo.top === 0, JSON.stringify(geo));
  ok('floating capsule: all four corners fully rounded (no square silhouette)', geo.edge === 'floating' && parseFloat(geo.radius.split('/')[0]) >= geo.h / 2 - 1 && geo.radius.split('/')[0] === geo.radius.split('/')[1], geo.radius);
  ok('visible gap between the screen edge and the capsule = 10 px', b.y + geo.top - prim.y === 10);
  await c.shot('60_compact_with_gap');

  await save({ offsetY: 30 }); b = win.getBounds();
  ok('Settings top gap 30 -> window moves to y = 30', b.y === prim.y + 30, 'y=' + b.y);
  await save({ offsetY: 0 }); b = win.getBounds();
  ok('top gap 0 -> flush with the edge and the silhouette becomes the docked shape', b.y === prim.y && await ev("document.body.dataset.edge === 'top-flush'"), 'y=' + b.y);
  await save({ offsetY: 10, position: 'bottom' }); b = win.getBounds();
  ok('bottom edge: window bottom = screen bottom - 10', b.y + b.height === prim.y + prim.height - 10, JSON.stringify(b));
  ok('bottom edge: island anchored to the window bottom', await ev("document.getElementById('island').getBoundingClientRect().bottom === window.innerHeight"));
  await save({ position: 'top' });

  // ---- simulated multi-display
  const realAll = screen.getAllDisplays, realPrim = screen.getPrimaryDisplay;
  const D1 = { id: 111, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1, label: 'Left' };
  const D2 = { id: 222, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, size: { width: 2560, height: 1440 }, scaleFactor: 1, label: 'Right 4K-ish' };
  screen.getAllDisplays = () => [D1, D2]; screen.getPrimaryDisplay = () => D1;
  await save({ display: '222' }); b = win.getBounds();
  ok('[simulated] chosen display 222 -> island centred on that display', b.x === 1920 + Math.round((2560 - 760) / 2) && b.y === 10, JSON.stringify(b));
  screen.getAllDisplays = () => [D1]; screen.emit('display-removed', {}, D2); await wait(300); b = win.getBounds();
  ok('[simulated] chosen display unplugged -> falls back to primary, gap kept', b.x === Math.round((1920 - 760) / 2) && b.y === 10, JSON.stringify(b));
  screen.getAllDisplays = () => [D1, D2]; screen.emit('display-added', {}, D2); await wait(300); b = win.getBounds();
  ok('[simulated] display plugged back in -> placed on it again (setting remembered)', b.x === 1920 + Math.round((2560 - 760) / 2), JSON.stringify(b));
  D2.bounds = { x: 1920, y: 0, width: 1920, height: 1080 }; screen.emit('display-metrics-changed', {}, D2, ['bounds']); await wait(300); b = win.getBounds();
  ok('[simulated] resolution change recalculates position', b.x === 1920 + Math.round((1920 - 760) / 2), JSON.stringify(b));
  screen.getAllDisplays = realAll; screen.getPrimaryDisplay = realPrim; await save({ display: 'primary' });
  ok('display list for Settings is available', (await ev('api.displays()')).length >= 1);

  // ---- no window resize during any animation
  const sizes = []; const sampler = setInterval(() => sizes.push(win.getBounds().width + 'x' + win.getBounds().height), 16);
  await ev("LI.island.open(); 0"); await wait(500); await ev("LI.workspace.openPlugin('calc'); 0"); await wait(700); await ev("LI.workspace.openCC(); 0"); await wait(700); await ev("LI.island.close(); 0"); await wait(700);
  clearInterval(sampler);
  ok('BrowserWindow is never resized during compact/full/plugin/Control Centre transitions', new Set(sizes).size === 1, [...new Set(sizes)].join());

  // ---- dashboard -> workspace morph: monotonic, no overshoot, many frames
  await ev("LI.workspace.toDash('home'); LI.island.open(); 0"); await wait(900);
  const s = await ev(`new Promise(res => { const i = document.getElementById('island'), out = []; const t0 = performance.now(); (function f(){ const r = i.getBoundingClientRect(); out.push([r.width, r.height]); if (performance.now()-t0 < 900) requestAnimationFrame(f); else res(out); })(); LI.workspace.openPlugin('calc'); })`);
  const ws = s.map((x) => x[0]), hs = s.map((x) => x[1]);
  ok('dashboard -> plugin: grows to 700x500 smoothly, no overshoot', Math.abs(ws[ws.length - 1] - 700) < 1 && Math.abs(hs[hs.length - 1] - 500) < 1 && Math.max(...ws) <= 700.5 && Math.max(...hs) <= 500.5 && ws.every((w, i) => i === 0 || w >= ws[i - 1] - 0.01), `max ${Math.max(...ws).toFixed(1)}x${Math.max(...hs).toFixed(1)}`);
  ok('dashboard -> plugin: spread over many frames', s.filter((x) => x[0] > 621 && x[0] < 699).length >= 6, s.filter((x) => x[0] > 621 && x[0] < 699).length + ' in-between frames');

  // ---- workspace focus vs collapse. PHASE 3 (DELIBERATE CHANGE): this used to assert that moving the cursor away does NOT close an open
  // plugin (the keyboard-focus "pin" also blocked collapse). Now focus and collapse are separate: a plugin keeps the window focusable,
  // and the island collapses from it when the cursor leaves. The user's explicit Pin (lock) is what keeps it open (scenario 10).
  await ev("LI.workspace.openPlugin('calc'); 0"); await wait(600);
  ok('plugin open => window focusable (keyboard works, native dialogs can attach)', win.isFocusable() === true);
  const r0 = JSON.parse(await ev("JSON.stringify(document.getElementById('island').getBoundingClientRect())"));
  c.send('cursor', { x: Math.round(r0.left + r0.width / 2), y: Math.round(r0.top + 200) }); await wait(150);
  ok('cursor over the open plugin: stays open', await ev("LI.island.state === 'full' && LI.island.isInside()"));
  c.send('cursor', { x: 5, y: 600 }); await wait(150);
  ok('cursor just left: still open during the grace period', await ev("LI.island.state === 'full'"));
  await wait(900);
  ok('moving the cursor away CLOSES an open plugin after the grace period (was: stayed open)', await ev("LI.island.state === 'compact'"));
  await ev("LI.workspace.openPlugin('calc'); 0"); await wait(600);
  await ev("LI.island.close(); 0"); await wait(500);
  ok('collapsed => window not focusable again (background activity never steals focus)', win.isFocusable() === false);
  const rect = JSON.parse(await ev("JSON.stringify(document.getElementById('island').getBoundingClientRect())"));
  const cx = Math.round(rect.left + rect.width / 2);
  c.send('cursor', { x: cx, y: -6 }); await wait(500);
  ok('hovering the 10 px gap above the capsule (screen edge) opens it (Fitts)', await ev("LI.island.state === 'full'"));
  ok('reopened by hover => resumes the plugin page you were on (default)', await ev("LI.workspace.route().type === 'plugin' && LI.workspace.route().id === 'calc'"));
  c.send('cursor', { x: 5, y: 600 }); await wait(500);
  await ev("LI.island.close(); 0"); await wait(300);
  c.send('cursor', { x: cx, y: -40 }); await wait(500);
  ok('cursor far above (outside the pad) does not open it', await ev("LI.island.state === 'compact'"));

  // ---- setting: start at Home instead of resuming
  await save({ expandOn: 'home' }); await ev("LI.island.open(); 0"); await wait(600);
  ok('expandOn=home -> reopening returns to the dashboard and unmounts the plugin', await ev("LI.workspace.route().type === 'dash' && document.getElementById('pluginHost').children.length === 0"));
  await save({ expandOn: 'last' });

  // ---- collapse after window loses focus (page stays mounted)
  await save({ blurCollapseSec: 1 });
  await ev("LI.workspace.openPlugin('todo'); 0"); await wait(600);
  await ev("window.dispatchEvent(new Event('blur')); 0"); await wait(1600);
  ok('unfocused for blurCollapseSec -> island collapses', await ev("LI.island.state === 'compact'"));
  ok('...but the plugin page is still mounted (nothing lost)', await ev("document.getElementById('pluginHost').children.length > 0 && LI.workspace.route().id === 'todo'"));
  await save({ blurCollapseSec: 0 }); await ev("LI.island.open(); window.dispatchEvent(new Event('blur')); 0"); await wait(1500);
  ok('blurCollapseSec=0 -> never auto-collapses', await ev("LI.island.state === 'full'"));

  // ---- motion
  await save({ reduceMotion: true });
  const dur = await ev("getComputedStyle(document.getElementById('island')).transitionDuration");
  ok('reduce motion setting makes transitions instant', parseFloat(dur) < 0.001 && await ev("document.body.classList.contains('reduce-motion')"), dur);
  await save({ reduceMotion: false });
  ok('motion speed setting scales animation (--speed)', await (async () => { await save({ animSpeed: 2 }); return (await ev("getComputedStyle(document.documentElement).getPropertyValue('--speed').trim()")) === '2'; })());
  await save({ animSpeed: 1 });

  // ---- keyboard / focus
  await ev("LI.workspace.openCC(); 0"); await wait(700);
  ok('Control Centre tiles are real buttons (keyboard focusable)', await ev("[...document.querySelectorAll('.cc-over .t-main, .cc-over .t-sw')].every(b => b.tagName === 'BUTTON')"));
  await ev("document.querySelector('.tile[data-pane=power] .t-main').focus(); 0");
  await ev("document.activeElement.click(); 0"); await wait(400);
  ok('Esc inside a Control Centre pane goes back to the overview, then Home', await (async () => { await ev("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await wait(300); const a = await ev("LI.workspace.route().type === 'cc' && !LI.workspace.route().pane"); await ev("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await wait(300); return a && await ev("LI.workspace.route().type === 'dash'"); })());
  console.log('[TEST] summary pass=' + R.filter(Boolean).length + ' fail=' + R.filter((x) => !x).length);
};
