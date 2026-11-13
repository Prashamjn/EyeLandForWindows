// Phase 3: hover expansion, collapse from EVERY screen, hit-testing, holds, pin, typing, settings, and the motion system.
// The cursor is driven through the real 'cursor' IPC channel (window-relative coordinates), exactly as main.js sends it.
const R = []; const ok = (n, c, x = '') => { R.push(!!c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
module.exports = async (c) => {
  const win = c.island(), ev = c.ev, wait = c.wait;
  await wait(900);
  const save = async (p) => { await ev(`api.saveSettings(${JSON.stringify(p)}); Object.assign(LI.S, ${JSON.stringify(p)}); LI.bus.emit('settings', LI.S); 0`); await wait(200); };
  const st = () => ev("LI.island.state");
  const rect = async () => JSON.parse(await ev("JSON.stringify(document.getElementById('island').getBoundingClientRect())"));
  const cur = (x, y) => c.send('cursor', { x, y });
  const away = () => c.send('cursor', { x: 5, y: 600 });
  const center = async (dy = 40) => { const r = await rect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + dy), r }; };
  const reset = async () => { await ev("LI.hold.keys().forEach(k => LI.hold.end(k)); LI.island.close(); 0"); away(); await wait(500); };
  const openAt = async (what) => { await ev(what + '; 0'); await wait(700); const p = await center(60); cur(p.x, p.y); await wait(200); };

  /* ---------- defaults ---------- */
  ok('defaults: hover expansion on, auto-collapse on, delay 350 ms, motion follows the OS', await ev("LI.S.hoverExpand === true && LI.S.autoCollapse === true && LI.S.collapseDelay === 350 && LI.S.motionMode === 'system'"));
  ok('pin is not on by default and is not a saved setting', await ev("LI.island.locked === false && !('locked' in LI.S)"));

  /* ---------- hover opens, with the right dir/duration ---------- */
  await reset();
  let p = await center(15); cur(p.x, p.y); await wait(60);
  ok('cursor on the pill does not open instantly (open delay 120 ms)', (await st()) === 'compact');
  await wait(250);
  ok('cursor on the pill expands it', (await st()) === 'full');
  ok('expansion is flagged as "expand" and uses the expand duration (0.3 s)', await ev("(() => { const i = document.getElementById('island'); return i.dataset.dir === 'expand' && getComputedStyle(i).transitionDuration.split(',')[0].trim() === '0.3s'; })()"));
  await c.shot('70_hover_expanded');

  /* ---------- collapse from EVERY screen ---------- */
  const screens = [
    ['dashboard: home', "LI.island.open({ view: 'home' })"], ['dashboard: plugins', "LI.island.open({ view: 'plugins' })"], ['dashboard: timer', "LI.island.open({ view: 'timer' })"],
    ['dashboard: clipboard', "LI.island.open({ view: 'clips' })"], ['dashboard: tasks', "LI.island.open({ view: 'tasks' })"], ['Settings', "LI.island.open({ view: 'settings' })"],
    ['Control Centre', "LI.workspace.openCC()"], ['Audio Trimmer', "LI.workspace.openPlugin('audioTrim')"], ['Audio Merger', "LI.workspace.openPlugin('audioMerge')"],
    ['Calculator plugin', "LI.workspace.openPlugin('calc')"], ['Weather plugin', "LI.workspace.openPlugin('weather')"], ['Translate plugin (autofocuses a text field)', "LI.workspace.openPlugin('translate')"],
    ['Shortcuts page', "LI.workspace.openPlugin('shortcuts')"],
  ];
  for (const [name, code] of screens) {
    await reset(); await openAt(code);
    const before = await ev("LI.island.state === 'full'");
    away(); await wait(150);
    const grace = await ev("LI.island.state === 'full'");           // still inside the 350 ms grace period
    await wait(900);
    ok(`collapses after the cursor leaves: ${name}`, before && grace && (await st()) === 'compact', `before=${before} grace=${grace} now=${await st()}`);
  }

  /* ---------- internal movement never collapses; margins are not interactive ---------- */
  await reset(); await openAt("LI.workspace.openCC()");
  const r = await rect(); let stayed = true;
  for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.5, 0.5], [0.02, 0.5], [0.98, 0.5], [0.5, 0.02], [0.5, 0.98]]) { cur(Math.round(r.left + r.width * fx), Math.round(r.top + r.height * fy)); await wait(60); if ((await st()) !== 'full') stayed = false; }
  await wait(600);
  ok('moving between internal areas (corners, edges, header, body) never collapses it', stayed && (await st()) === 'full');
  cur(Math.round(r.left - 40), Math.round(r.top + r.height / 2)); await wait(1000);
  ok('a transparent window margin 40 px outside the island counts as outside: it collapses', (await st()) === 'compact');
  await reset();
  cur(100, 300); await wait(400);
  ok('transparent margins are not interactive: hovering them never opens the island', (await st()) === 'compact');

  /* ---------- short excursions are forgiven ---------- */
  await reset(); await openAt("LI.island.open({ view: 'home' })");
  away(); await wait(120); const q = await center(60); cur(q.x, q.y); await wait(700);
  ok('leaving for 120 ms and coming back (inside the grace period) does not collapse', (await st()) === 'full');

  /* ---------- growth-aware hit-testing ---------- */
  await reset();
  p = await center(15); cur(p.x, p.y); await wait(135);                 // the open delay just elapsed: the island is still growing
  const mid = await rect();
  cur(p.x + 250, 300);                                                    // inside the FINAL panel, outside the pill/current rect
  await wait(60);
  ok('mid-morph the island is still small (test is meaningful)', mid.height < 400, 'h=' + Math.round(mid.height));
  await wait(800);
  ok('a cursor already inside the final panel is never read as "left" while it grows', (await st()) === 'full' && await ev("LI.island.isInside()"));
  await reset();

  /* ---------- grace period + auto-collapse settings ---------- */
  await save({ collapseDelay: 900 }); await openAt("LI.island.open({ view: 'home' })"); away(); await wait(500);
  const still = (await st()) === 'full'; await wait(900);
  ok('collapse delay setting (900 ms): open at 500 ms, closed after ~1.4 s', still && (await st()) === 'compact');
  await save({ collapseDelay: 350, autoCollapse: false }); await reset(); await openAt("LI.island.open({ view: 'home' })"); away(); await wait(1500);
  ok('auto-collapse off: the island stays open after the cursor leaves', (await st()) === 'full');
  await ev("LI.island.close(); 0"); await wait(300);
  ok('...and the Collapse action still closes it', (await st()) === 'compact');
  await save({ autoCollapse: true });
  await save({ collapseDelay: 99999 });
  ok('collapse delay is clamped (max 2000 ms) when read', await ev("(() => { const t = performance.now(); return IslandLogic.clampDelay(LI.S.collapseDelay, 350, 100, 2000) === 2000; })()"));
  await save({ collapseDelay: 350 });

  /* ---------- hover expansion off: click to open ---------- */
  await save({ hoverExpand: false }); await reset();
  p = await center(15); cur(p.x, p.y); await wait(500);
  ok('hover expansion off: hovering the pill does not open it', (await st()) === 'compact');
  await ev("document.getElementById('island').click(); 0"); await wait(500);
  ok('hover expansion off: a click on the pill opens it', (await st()) === 'full');
  await save({ hoverExpand: true }); await reset();

  /* ---------- holds ---------- */
  await openAt("LI.island.open({ view: 'home' })"); await ev("LI.hold.begin('test-export'); 0"); away(); await wait(1500);
  ok('an active hold (e.g. an export) keeps the island open', (await st()) === 'full');
  await ev("LI.hold.end('test-export'); 0"); await wait(1000);
  ok('...and when the hold ends the island collapses (cursor is away)', (await st()) === 'compact');
  await reset(); await openAt("LI.island.open({ view: 'home' })"); await ev("LI.hold.begin('forgotten', 700); 0"); away(); await wait(500);
  const heldEarly = (await st()) === 'full'; await wait(1500);
  ok('a forgotten hold expires by its maximum age and cannot keep the island open forever', heldEarly && (await st()) === 'compact');
  await reset(); await openAt("LI.island.open({ view: 'home' })"); c.send('hold', { key: 'dialog', on: true }); await wait(100); away(); await wait(1400);
  const dialogHeld = (await st()) === 'full';
  c.send('hold', { key: 'dialog', on: false }); await wait(1000);
  ok('a native dialog (hold event from main.js) keeps it open; closing the dialog lets it collapse', dialogHeld && (await st()) === 'compact');
  await reset(); await openAt("LI.island.open({ view: 'home' })");
  await ev("(async () => { window.__run = LI.hold.run('job', new Promise((res) => { window.__done = res; })); })(); 0"); away(); await wait(1200);
  const runHeld = (await st()) === 'full'; await ev("window.__done(1); 0"); await wait(1000);
  ok('LI.hold.run holds while a promise is pending and releases when it settles', runHeld && (await st()) === 'compact');

  /* ---------- typing ---------- */
  await reset(); await openAt("LI.island.open({ view: 'tasks' })");
  await ev("(() => { const i = document.getElementById('taskInput'); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); i.value = 'a'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 0");
  away(); await wait(1800);
  ok('a text field in active use (typing) keeps the island open', (await st()) === 'full');
  await ev("document.getElementById('taskInput').blur(); 0"); await wait(2500);
  ok('...and after the field loses focus it collapses', (await st()) === 'compact');
  await reset(); await openAt("LI.workspace.openPlugin('translate')"); away(); await wait(1300);
  ok('a plugin that merely autofocuses its field (no typing) does NOT hold the island open', (await st()) === 'compact');

  /* ---------- pin / lock ---------- */
  await reset(); await openAt("LI.workspace.openPlugin('calc')");
  await ev("document.getElementById('wkLock').click(); 0"); await wait(100);
  ok('the Pin button locks the island open (aria-pressed, island data-locked)', await ev("LI.island.locked === true && document.getElementById('wkLock').getAttribute('aria-pressed') === 'true' && document.getElementById('island').dataset.locked === '1'"));
  away(); await wait(1500);
  ok('pinned: stays open from a plugin when the cursor leaves', (await st()) === 'full');
  await ev("LI.workspace.toDash('home'); 0"); await wait(300); away(); await wait(1200);
  ok('pinned: stays open on the dashboard too', (await st()) === 'full');
  ok('the dashboard has its own Pin button showing the locked state', await ev("document.querySelector('.nav-lock').classList.contains('lit')"));
  await ev("window.dispatchEvent(new Event('blur')); 0"); await save({ blurCollapseSec: 1 }); await ev("window.dispatchEvent(new Event('blur')); 0"); await wait(1800);
  ok('pinned: exempt from collapse-on-blur', (await st()) === 'full');
  await ev("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0"); await wait(500);
  ok('Esc at Home releases the pin and collapses', (await st()) === 'compact' && await ev("LI.island.locked === false"));
  await save({ blurCollapseSec: 0 });
  await reset(); await openAt("LI.workspace.openPlugin('calc')"); await ev("LI.island.setLocked(true); document.getElementById('wkClose').click(); 0"); await wait(500);
  ok('the explicit Collapse button releases the pin and collapses', (await st()) === 'compact' && await ev("LI.island.locked === false"));
  ok('the pin is in memory only: nothing about it was written to settings.json', !('locked' in JSON.parse(require('fs').readFileSync(require('path').join(require('electron').app.getPath('userData'), 'settings.json'), 'utf8'))));

  /* ---------- keyboard focus separate from collapse ---------- */
  await reset(); await openAt("LI.workspace.openPlugin('calc')");
  ok('work mode => workFocus (window focusable) but locked is false: the two are independent', await ev("LI.island.workFocus === true && LI.island.locked === false") && win.isFocusable());
  await reset();

  /* ---------- motion system ---------- */
  const dur = (anim) => ev(`(() => { const i = document.getElementById('island'); i.dataset.dir = '${anim}'; return getComputedStyle(i).transitionDuration.split(',')[0].trim(); })()`);
  ok('island durations: expand 0.3 s, collapse 0.24 s, navigation 0.21 s (within the 250-350 / 200-300 / 180-240 ms ranges)', (await dur('expand')) === '0.3s' && (await dur('collapse')) === '0.24s' && (await dur('nav')) === '0.21s');
  await save({ animSpeed: 2 });
  ok('animation speed 2x halves every island duration (0.15 / 0.12 / 0.105 s)', (await dur('expand')) === '0.15s' && (await dur('collapse')) === '0.12s' && (await dur('nav')) === '0.105s');
  await save({ animSpeed: 1 });
  ok('the pill collapse uses a different easing than expansion', await ev("(() => { const i = document.getElementById('island'); i.dataset.dir = 'collapse'; const a = getComputedStyle(i).transitionTimingFunction; i.dataset.dir = 'expand'; return a !== getComputedStyle(i).transitionTimingFunction; })()"));
  const anim = JSON.parse(await ev("(() => { const e = document.createElement('div'); document.body.append(e); const a = LI.motion.enter(e, 'up'); const t = a && a.effect.getTiming(); const kf = a && a.effect.getKeyframes(); e.remove(); return JSON.stringify({ made: !!a, dur: t && t.duration, easing: t && t.easing, from: kf && kf[0].opacity, to: kf && kf[1].opacity }); })()"));
  ok('LI.motion.enter: Web Animations API, 210 ms, opacity 0 -> 1, decelerating easing', anim.made && anim.dur === 210 && +anim.from === 0 && +anim.to === 1 && /cubic-bezier\(0\.32, 0\.72, 0, 1\)/.test(anim.easing), JSON.stringify(anim));
  ok('LI.motion durations are scaled by animation speed (UI 150 ms at 1x, 75 ms at 2x)', await ev("(() => { const a = LI.motion.ms('ui'); LI.S.animSpeed = 2; const b = LI.motion.ms('ui'); LI.S.animSpeed = 1; return a === 150 && b === 75; })()"));
  // Reduced motion: the Reduce motion setting, and the OS preference (emulated through the DevTools protocol)
  await save({ reduceMotion: true });
  ok('Reduce motion setting: body class set, enter() returns no animation, durations collapse to ~0', await ev("document.body.classList.contains('reduce-motion') && LI.motion.enter(document.body, 'up') === null && parseFloat(getComputedStyle(document.getElementById('island')).transitionDuration) < 0.001"));
  await save({ reduceMotion: false });
  ok('without the setting, motion is on', await ev("!document.body.classList.contains('reduce-motion') && LI.motion.status().reduced === false"));
  const dbg = win.webContents.debugger; dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await wait(300);
  ok('OS "Animation effects off" (emulated): motion is reduced by default (respect the OS)', await ev("LI.motion.status().os === true && LI.motion.status().reduced === true && document.body.classList.contains('reduce-motion')"));
  ok('...and Settings shows the effective state and the reason', await ev("LI.panels.syncSettings(), /Motion is reduced now\\. Windows animation effects are off/.test(document.querySelector('[data-info=motion]').textContent)"), await ev("document.querySelector('[data-info=motion]').textContent"));
  await save({ motionMode: 'always' });
  ok('override "Always animate": animations run even though the OS asks for reduced motion', await ev("LI.motion.status().reduced === false && !document.body.classList.contains('reduce-motion') && LI.motion.enter(document.body, 'up') !== null") && (await dur('expand')) === '0.3s');
  ok('...and Settings says so', await ev("LI.panels.syncSettings(), /Motion is on now\\. Windows animation effects are off, but Liquid Island is set to always animate/.test(document.querySelector('[data-info=motion]').textContent)"), await ev("document.querySelector('[data-info=motion]').textContent"));
  await save({ motionMode: 'system' });
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); await wait(300); dbg.detach();
  ok('back to the OS preference: motion on again', await ev("LI.motion.status().reduced === false"));

  /* ---------- cursor channel is quiet when nothing moves ---------- */
  let n = 0; const orig = win.webContents.send.bind(win.webContents); win.webContents.send = (ch, ...a) => { if (ch === 'cursor') n++; return orig(ch, ...a); };
  await wait(1500); win.webContents.send = orig;
  ok('the main process sends at most a couple of cursor messages in 1.5 s while the cursor is still', n <= 2, 'n=' + n);

  console.log(`[TEST] SUMMARY ${R.filter(Boolean).length}/${R.length} passed`);
};
