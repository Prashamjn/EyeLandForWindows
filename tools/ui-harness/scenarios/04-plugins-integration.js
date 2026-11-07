const R = []; const ok = (n, c, x = '') => { R.push(c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
const SPECIAL = ['textExtract', 'lens', 'colorPicker', 'draw', 'coffee'];     // handled natively by main, no hub page
module.exports = async (c) => {
  await c.wait(800);
  const cat = await c.ev("api.catalog()");
  ok('catalog returns 21 entries (20 plugins + Shortcuts page)', cat.length === 21, 'n=' + cat.length);
  await c.ev("LI.island.open(); LI.dashboard.show('plugins'); 0"); await c.wait(900);
  const groups = await c.ev("[...document.querySelectorAll('.pl-cat')].map(b => b.textContent)");
  ok('island plugin nav lists all categories', groups.join() === 'Screen,Productivity,Files,Network,System', groups.join());
  // every plugin must be reachable from a category in the island
  const reach = [];
  for (const g of groups) { await c.ev(`document.querySelector('.pl-cat[data-cat="${g}"]').click(); 0`); await c.wait(60); reach.push(...await c.ev("[...document.querySelectorAll('.pl-card')].map(b => b.dataset.id)")); }
  ok('all 20 plugins discoverable in the island grid', reach.length === 20 && new Set(reach).size === 20, reach.join());
  const hubWin = () => c.wins().find((w) => /hub[\\/]index\.html/.test(w.webContents.getURL()));
  const hubIds = reach.filter((id) => !SPECIAL.includes(id));
  let n = 0;
  for (const id of hubIds) {
    // click the real card (it lives in whichever category tab is active)
    await c.ev(`(() => { const g = ${JSON.stringify(cat.find((p) => p.id === id).group)}; document.querySelector('.pl-cat[data-cat="'+g+'"]').click(); document.querySelector('.pl-card[data-id="${id}"]').click(); })(); 0`);
    await c.wait(700);
    const h = hubWin(); const title = h ? await h.webContents.executeJavaScript("(document.querySelector('#view .ph h1')||{}).textContent || ''") : '';
    const failed = h ? await h.webContents.executeJavaScript("/failed to load/.test(document.getElementById('view').textContent)") : true;
    const want = cat.find((p) => p.id === id).name;
    const pass = !!h && !failed && title.trim() === want;
    if (pass) n++; else ok(`plugin "${id}" opens in hub`, false, `title="${title}" want="${want}" failed=${failed}`);
    await c.ev("LI.island.open(); LI.dashboard.show('plugins'); 0"); await c.wait(150);
  }
  ok(`${hubIds.length} hub-based plugins each mount their own page via island card`, n === hubIds.length, `${n}/${hubIds.length}`);
  // coffee: card -> main -> 'coffee' event -> island state + toast
  await c.ev("document.querySelector('.pl-cat[data-cat=\"Productivity\"]').click(); document.querySelector('.pl-card[data-id=\"coffee\"]').click(); 0"); await c.wait(700);
  ok('coffee card toggles main-process coffee mode and island reflects it', await c.ev("LI.state.coffee === true && document.querySelector('.pl-card[data-id=\"coffee\"]').classList.contains('on')"));
  await c.ev("document.querySelector('.pl-card[data-id=\"coffee\"]').click(); 0"); await c.wait(500);
  ok('coffee card toggles back off', await c.ev("LI.state.coffee === false"));
  // hub look
  const h = hubWin(); await c.ev("api.openHub('weather'); 0"); await c.wait(900);
  await c.shot('30_hub_weather', h); h.setSize(1000, 680);
  await c.ev("api.openHub('todo'); 0"); await c.wait(600); await c.shot('31_hub_todo', h);
  console.log('[TEST] summary pass=' + R.filter(Boolean).length + ' fail=' + R.filter((x) => !x).length);
};
