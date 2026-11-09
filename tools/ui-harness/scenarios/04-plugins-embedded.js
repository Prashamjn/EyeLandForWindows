// Phase 2: every plugin opens INSIDE the island (no hub window). Runs the real main.js, preload, renderer and plugin pages.
const R = []; const ok = (n, c, x = '') => { R.push(!!c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
module.exports = async (c) => {
  await c.wait(900);
  const cat = await c.ev('api.catalog()');
  ok('catalog has 21 entries (20 plugins + Shortcuts page)', cat.length === 21, 'n=' + cat.length);
  ok('catalog groups are the Phase 2 categories', [...new Set(cat.map((p) => p.group))].join(' | ') === 'Screen Tools | Productivity | Files & Utilities | Connectivity | System', [...new Set(cat.map((p) => p.group))].join(' | '));
  ok('exactly one app window exists (no plugin hub)', c.wins().length === 1, c.wins().map((w) => w.webContents.getURL().split('/').pop()).join());

  // plugin grid: all 20 reachable by category
  await c.ev("LI.island.open({ view: 'plugins' }); 0"); await c.wait(700);
  const groups = await c.ev("[...document.querySelectorAll('.pl-cat')].map(b => b.textContent)");
  ok('plugin navigation lists the five categories', groups.join() === 'Screen Tools,Productivity,Files & Utilities,Connectivity,System', groups.join());
  const reach = [];
  for (const g of groups) { await c.ev(`document.querySelector('.pl-cat[data-cat="${g}"]').click(); 0`); await c.wait(40); reach.push(...await c.ev("[...document.querySelectorAll('.pl-card')].map(b => b.dataset.id)")); }
  ok('all 20 plugins are reachable from the grid', reach.length === 20 && new Set(reach).size === 20, reach.length + ' cards');

  // open every plugin (all 21 pages) through the real grid/route, check it rendered inside the island
  const bad = [];
  for (const p of cat) {
    await c.ev(`LI.workspace.openPlugin(${JSON.stringify(p.id)}); 0`); await c.wait(650);
    const r = JSON.parse(await c.ev(`JSON.stringify({ mode: LI.island.mode, state: LI.island.state, route: LI.workspace.route(), title: document.getElementById('wkTitle').textContent,
      kids: document.querySelector('#pluginHost .pw-page') ? document.querySelector('#pluginHost .pw-page').children.length : -1,
      err: !!document.querySelector('#pluginHost .pw-state .btn'), host: !document.getElementById('pluginHost').hidden, focusable: LI.island.pinned })`));
    const good = r.mode === 'work' && r.state === 'full' && r.route.id === p.id && r.title === p.name && r.kids > 0 && !r.err && r.host && r.focusable;
    if (!good) bad.push(p.id + ' ' + JSON.stringify(r));
    if (c.wins().length !== 1) bad.push(p.id + ' opened another window');
  }
  ok('all 21 plugin pages render inside the island with their own title', bad.length === 0, bad.join(' ; '));

  // back navigation + state restore
  await c.ev("LI.workspace.openPlugin('calc'); 0"); await c.wait(500);
  await c.ev("document.getElementById('wkBack').click(); 0"); await c.wait(500);
  ok('Back returns to the dashboard Plugins view', await c.ev("LI.workspace.route().type === 'dash' && LI.island.mode === 'dash' && document.querySelector('.vw.on').dataset.view === 'plugins' && !LI.island.pinned"));
  ok('plugin page was unmounted (no leftover DOM)', await c.ev("document.getElementById('pluginHost').children.length === 0"));
  await c.ev("LI.workspace.openPlugin('calc'); 0"); await c.wait(400);
  await c.ev("document.getElementById('wkHome').click(); 0"); await c.wait(400);
  ok('Home button returns to dashboard Home', await c.ev("LI.island.mode === 'dash' && document.querySelector('.vw.on').dataset.view === 'home'"));
  await c.ev("LI.workspace.openPlugin('calc'); 0"); await c.wait(400);
  await c.ev("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await c.wait(400);
  ok('Esc goes back one level (plugin -> dashboard)', await c.ev("LI.island.mode === 'dash' && LI.island.state === 'full'"));

  // functional checks on real plugin code (not just "it mounts")
  await c.ev("LI.workspace.openPlugin('todo'); 0"); await c.wait(500);
  await c.ev("(() => { const i = document.querySelector('#pluginHost input.input'); i.value = 'Phase 2 task'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })(); 0"); await c.wait(400);
  ok('Tasks plugin: adds a task and it shows in the page', await c.ev("document.querySelector('#pluginHost').textContent.includes('Phase 2 task')"));
  ok('Tasks plugin: change reaches LI.S through the shared settings object', await c.ev("(LI.S.todos || []).some(t => t.text === 'Phase 2 task')"));
  await c.ev("document.getElementById('wkBack').click(); LI.dashboard.show('tasks'); 0"); await c.wait(400);
  ok('dashboard Tasks view sees the task added in the plugin page (shared bus)', await c.ev("document.querySelector('.vw[data-view=tasks]').textContent.includes('Phase 2 task')"));
  const saved = JSON.parse(require('fs').readFileSync(require('path').join(c.app.getPath('userData'), 'settings.json'), 'utf8'));
  ok('task persisted to settings.json by the main process', (saved.todos || []).some((t) => t.text === 'Phase 2 task'));

  await c.ev("LI.workspace.openPlugin('calc'); 0"); await c.wait(500);
  await c.ev("(() => { const i = document.querySelector('#pluginHost input'); i.value = '12*(3+4)'; i.dispatchEvent(new Event('input')); })(); 0"); await c.wait(300);
  ok('Calculator plugin evaluates 12*(3+4) = 84', await c.ev("document.querySelector('#pluginHost').textContent.includes('84')"));
  await c.ev("LI.workspace.openPlugin('qr'); 0"); await c.wait(600);
  await c.ev("(() => { const t = document.querySelector('#pluginHost textarea, #pluginHost input.input'); t.value = 'https://example.com'; t.dispatchEvent(new Event('input')); })(); 0"); await c.wait(900);
  ok('QR plugin: lazy-loads its library and draws a code', await c.ev("typeof qrcode === 'function' && !!document.querySelector('#pluginHost canvas')"));
  await c.ev("LI.workspace.openPlugin('print'); 0"); await c.wait(700);
  ok('Print plugin: pdf.js loaded on demand (not at start-up)', await c.ev("typeof pdfjsLib !== 'undefined'"));

  // favourites + pins
  await c.ev("LI.workspace.openPlugin('weather'); 0"); await c.wait(500);
  await c.ev("document.getElementById('wkFav').click(); document.getElementById('wkPin').click(); 0"); await c.wait(300);
  const s2 = JSON.parse(require('fs').readFileSync(require('path').join(c.app.getPath('userData'), 'settings.json'), 'utf8'));
  ok('favourite + pin persist in settings.json', (s2.favorites || []).includes('weather') && (s2.pinned || []).includes('weather'), JSON.stringify([s2.favorites, s2.pinned]));
  await c.ev("document.getElementById('wkBack').click(); 0"); await c.wait(300);
  ok('Plugins grid gains a Favourites tab', await c.ev("[...document.querySelectorAll('.pl-cat')].some(b => b.textContent === 'Favourites')"));
  await c.ev("LI.dashboard.show('home'); 0"); await c.wait(200);
  ok('Home quick actions follow the 4 pinned items (last one is Weather)', await c.ev("[...document.querySelectorAll('#quick .qa-btn')].map(b => b.dataset.id).join() === 'coffee,textExtract,colorPicker,weather'"));

  // an opening plugin page that fails must show an error state, not break the island
  await c.ev("Plugins.map.get('speed').mount = () => { throw new Error('boom'); }; LI.workspace.openPlugin('speed'); 0"); await c.wait(500);
  ok('a plugin that throws shows an error state with Try again', await c.ev("!!document.querySelector('#pluginHost .pw-state .btn') && document.querySelector('#pluginHost').textContent.includes('boom')"));
  await c.ev("document.getElementById('wkBack').click(); 0"); await c.wait(300);
  ok('island still works after a plugin failure', await c.ev("LI.island.state === 'full' && LI.island.mode === 'dash'"));

  // result of a screen scan is delivered into the page inside the island (this is what main.js sends after the capture overlay closes)
  await c.ev("LI.island.close(); LI.workspace.toDash('home'); 0"); await c.wait(600);
  c.send('open-panel', { plugin: 'translate', payload: { text: 'Hola mundo desde la pantalla' } }); await c.wait(900);
  ok('screen-scan result opens Translate inside the island with the scanned text', await c.ev("LI.island.mode === 'work' && LI.workspace.route().id === 'translate' && [...document.querySelectorAll('#pluginHost textarea, #pluginHost input')].some(e => e.value.includes('Hola mundo desde la pantalla'))"));
  c.send('toast', { icon: 'check', text: 'Text ready to translate' }); await c.wait(400);
  ok('plugin toasts show as a banner inside the workspace (not lost in the hidden activity area)', await c.ev("document.getElementById('wkBanner').classList.contains('on') && document.getElementById('wkBanner').textContent.includes('Text ready to translate')"));

  // screenshots
  for (const [id, name] of [['todo', '40_plugin_tasks'], ['screen', '41_plugin_x'], ['convert', '42_plugin_convert'], ['sysinfo', '43_plugin_system']]) {
    if (!cat.find((p) => p.id === id)) continue;
    await c.ev(`LI.island.open({ plugin: ${JSON.stringify(id)} }); 0`); await c.wait(900); await c.shot(name);
  }
  console.log('[TEST] summary pass=' + R.filter(Boolean).length + ' fail=' + R.filter((x) => !x).length);
};
