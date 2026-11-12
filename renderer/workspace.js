'use strict';
// Workspace: hosts plugin pages (and the Control Centre) inside the island, and owns navigation between
// the dashboard, plugin pages and the Control Centre. There is no separate plugin window anywhere.
//
//   route = { type: 'dash' } | { type: 'plugin', id } | { type: 'cc', pane }
//
// A plugin page is a module registered with Plugins.register({ id, mount(root, ctx) }) that returns an optional cleanup
// function (see renderer/plugin-host.js). The same pages the old plugin window showed are mounted here unchanged.
(() => {
  const { $, el, icon } = LI;
  const host = $('#pluginHost'), ccRoot = $('#ccRoot'), body = $('#wkBody');
  const title = $('#wkTitle'), ico = $('#wkIco'), key = $('#wkKey');
  const bBack = $('#wkBack'), bHome = $('#wkHome'), bClose = $('#wkClose'), bFav = $('#wkFav'), bPin = $('#wkPin'), bLock = $('#wkLock');
  const banner = $('#wkBanner');

  bBack.innerHTML = icon('left'); bHome.innerHTML = icon('home'); bClose.innerHTML = icon('chevUp');
  bFav.innerHTML = icon('star'); bPin.innerHTML = icon('pinOn'); bLock.innerHTML = icon('lockOpen');

  let route = { type: 'dash' }, cleanup = null, token = 0;
  const PINNED_DEFAULT = ['mute', 'coffee', 'textExtract', 'colorPicker'];

  /* ---------- on-demand libraries (kept out of the always-running island's startup) ---------- */
  const DEPS = { compress: ['pdf'], convert: ['pdf'], print: ['pdf'], qr: ['qr'], share: ['qr'] };
  const SRC = { pdf: 'plugins/vendor/pdf.min.js', qr: 'plugins/vendor/qrcode.js' };
  const loaded = {};
  const loadScript = (name) => (loaded[name] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = SRC[name];
    s.onload = () => { if (name === 'pdf' && window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'plugins/vendor/pdf.worker.min.js'; res(); };
    s.onerror = () => { delete loaded[name]; rej(new Error('Could not load a required component (' + name + ')')); };
    document.head.append(s);
  }));

  /* ---------- the shell around a page ---------- */
  function setHeader({ id, name, iconId, keyText, canFav }) {
    title.textContent = name; ico.innerHTML = icon(iconId); key.hidden = !keyText; key.textContent = keyText || '';
    bFav.hidden = bPin.hidden = !canFav;
    if (canFav) paintFavPin(id);
  }
  function paintFavPin(id) {
    const fav = (LI.S.favorites || []).includes(id), pin = (LI.S.pinned || PINNED_DEFAULT).includes(id);
    bFav.classList.toggle('on', fav); bFav.title = fav ? 'Remove from favourites' : 'Add to favourites'; bFav.innerHTML = icon(fav ? 'starF' : 'star');
    bFav.classList.toggle('fill', fav);
    bPin.classList.toggle('on', pin); bPin.title = pin ? 'Unpin from Home' : 'Pin to Home';
  }
  const list = (k, dflt) => [...(LI.S[k] || dflt || [])];
  function saveList(k, v) { LI.S[k] = v; api.saveSettings({ [k]: v }); LI.bus.emit('settings', LI.S); }
  bFav.addEventListener('click', () => {
    if (route.type !== 'plugin') return;
    const f = list('favorites'); const i = f.indexOf(route.id); i >= 0 ? f.splice(i, 1) : f.push(route.id);
    saveList('favorites', f); paintFavPin(route.id);
  });
  bPin.addEventListener('click', () => {
    if (route.type !== 'plugin') return;
    let p = list('pinned', PINNED_DEFAULT); const i = p.indexOf(route.id);
    if (i >= 0) p.splice(i, 1); else { p.push(route.id); if (p.length > 4) p = p.slice(-4); }     // Home has room for four
    saveList('pinned', p); paintFavPin(route.id);
  });
  bBack.addEventListener('click', () => back());
  bHome.addEventListener('click', () => toDash('home'));
  bClose.addEventListener('click', () => LI.island.close());
  bLock.addEventListener('click', () => LI.island.setLocked(!LI.island.locked));
  LI.bus.on('lock', (on) => { bLock.classList.toggle('on', on); bLock.setAttribute('aria-pressed', String(on)); bLock.title = on ? 'Pinned open. Click to unpin' : 'Keep expanded'; bLock.innerHTML = icon(on ? 'lock' : 'lockOpen'); });

  function swapIn(node, dir) {
    [host, ccRoot].forEach((n) => { n.hidden = n !== node; });
    body.scrollTop = 0;
    LI.motion.enter(node, dir === 'back' ? 'back' : 'up');          // navigation transition (Web Animations, scaled by motion speed, off when reduced)
  }
  function unmountPlugin() {
    token++;                                          // any mount still in flight is discarded
    if (cleanup) { try { cleanup(); } catch (e) { console.error('[plugin cleanup]', e); } cleanup = null; }
    host.replaceChildren();
  }

  /* ---------- navigation ---------- */
  function toDash(view) {
    unmountPlugin();
    if (LI.cc && LI.cc.leave) LI.cc.leave();
    route = { type: 'dash' };
    LI.island.setMode('dash');
    LI.dashboard.show(view || LI.dashboard.current());
    if (LI.island.state !== 'full') return;
  }

  async function openPlugin(id, payload) {
    const catalog = await api.catalog().catch(() => []);
    const meta = catalog.find((c) => c.id === id) || (window.CATALOG || []).find((c) => c.id === id);
    const plugin = typeof Plugins !== 'undefined' ? Plugins.map.get(id) : null;
    if (LI.cc && LI.cc.leave) LI.cc.leave();
    if (route.type === 'plugin' && route.id === id && cleanup) {          // already open: just bring it forward
      if (payload) LI.bus.emit(id + ':open', payload);
      LI.island.setMode('work'); LI.island.show(); return;
    }
    unmountPlugin();
    const my = token;
    route = { type: 'plugin', id };
    setHeader({ id, name: meta ? meta.name : id, iconId: id, keyText: meta && meta.key, canFav: id !== 'shortcuts' });
    LI.island.setMode('work'); LI.island.show();
    swapIn(host);

    const root = el('div', { class: 'pw-page' });
    host.append(root);
    const slow = setTimeout(() => { if (my === token && !root.children.length) root.append(state('spinner', 'Loading', null, true)); }, 140);
    try {
      if (!plugin) throw new Error('This plugin is not available.');
      await Promise.all((DEPS[id] || []).map(loadScript));
      const pctx = { ...ctx, meta, refreshCatalog: () => LI.dashboard.refreshCatalog() };
      const c = await plugin.mount(root, pctx);
      if (my !== token) { try { c && c(); } catch {} return; }              // user navigated away while it was loading
      cleanup = typeof c === 'function' ? c : null;
      root.querySelector('.pw-state')?.remove();
      if (payload) LI.bus.emit(id + ':open', payload);
    } catch (e) {
      if (my !== token) return;
      console.error('[plugin]', id, e);
      root.replaceChildren(state('warn', 'This page could not be opened', (e && e.message) || 'Unknown error', false, () => { route = { type: 'dash' }; openPlugin(id, payload); }));
    } finally { clearTimeout(slow); }
  }
  function state(ic, t, sub, spin, retry) {
    const s = el('div', { class: 'pw-state' + (spin ? ' pw-spin' : '') }, el('span', { html: icon(ic) }), el('span', { class: 't', text: t }));
    if (sub) s.append(el('span', { text: sub }));
    if (retry) s.append(el('button', { class: 'btn', text: 'Try again' }));
    if (retry) s.querySelector('button').addEventListener('click', retry);
    return s;
  }

  function openCC(pane) {
    unmountPlugin();
    route = { type: 'cc', pane: pane || null };
    LI.island.setMode('work'); LI.island.show();
    swapIn(ccRoot);
    setHeader({ id: 'cc', name: 'Control Centre', iconId: 'control', canFav: false });
    LI.cc.mount(ccRoot, pane || null);
  }
  // called by the Control Centre as it moves between its overview and detail panes
  function ccPane(pane, name, iconId) {
    if (route.type !== 'cc') return;
    route.pane = pane;
    setHeader({ id: 'cc', name: name || 'Control Centre', iconId: iconId || 'control', canFav: false });
  }

  function back() {
    if (route.type === 'plugin') return toDash('plugins');
    if (route.type === 'cc') { if (route.pane && LI.cc.back()) return; return toDash('home'); }
    LI.island.close();
  }
  function escape() { route.type === 'dash' ? LI.island.close() : back(); }

  /* ---------- running a plugin by id (grid, Home pins, tray, global shortcuts all end up here) ---------- */
  function run(id) {
    const p = (window.CATALOG || []).find((c) => c.id === id);
    if (!p) return;
    openPlugin(id);
  }

  /* ---------- transient messages inside the workspace ---------- */
  let bannerT = 0;
  function showBanner({ icon: ic, title: t, sub, tone }, ttl) {
    banner.dataset.tone = tone || '';
    banner.replaceChildren(el('span', { class: 'b-ico', html: icon(ic || 'check') }),
      el('span', { class: 'b-body' }, el('div', { class: 'b-t', text: t || '' }), sub ? el('div', { class: 'b-s', text: sub }) : null));
    banner.hidden = false; void banner.offsetWidth; banner.classList.add('on');
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { banner.classList.remove('on'); bannerT = setTimeout(() => { banner.hidden = true; }, 300); }, ttl || 2400);
  }
  const inWork = () => LI.island.state === 'full' && LI.island.mode === 'work';
  LI.toast = (msg, err) => {
    if (inWork()) return showBanner({ icon: err ? 'warn' : 'check', title: msg, tone: err ? 'err' : 'success' }, err ? 4200 : 2200);
    LI.activity.show({ id: 'toast', kind: 'notice', icon: err ? 'warn' : 'check', title: msg, tone: err ? 'warn' : '', mini: 'text' }, { ttl: err ? 4200 : 2400 });
  };
  // device / system notifications: banner inside a workspace, otherwise the activity area or the mini island
  LI.notice = (n, ttl) => {
    if (inWork()) return showBanner(n, ttl);
    LI.activity.show({ id: n.id || 'notice', kind: n.kind || 'notice', icon: n.icon, title: n.title, sub: n.sub, tone: n.tone, mini: 'text' }, { ttl });
  };

  LI.bus.on('settings', () => { if (route.type === 'plugin') paintFavPin(route.id); });

  LI.workspace = { route: () => route, toDash, openPlugin, openCC, ccPane, back, escape, run, PINNED_DEFAULT };
})();
