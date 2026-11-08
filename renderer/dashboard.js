'use strict';
// Dashboard area: view switching, clock, weather, quick actions, system sliders, plugin navigation.
(() => {
  const { $, $$, el, icon, volIcon, debounce } = LI;
  const ey = window.eyeland;                              // generic bridge (same one the plugin hub uses)

  /* ================= views + nav ================= */
  // 'control' is not a dashboard view: it opens the Control Centre workspace (LI.workspace.openCC)
  const VIEWS = [
    ['home', 'home', 'Home'], ['plugins', 'grid', 'Plugins'], ['control', 'control', 'Control Centre'], ['timer', 'timer', 'Timer'],
    ['clips', 'clipboard', 'Clipboard'], ['tasks', 'todo', 'Tasks'], ['settings', 'sliders', 'Settings'],
  ];
  const nav = $('#nav');
  let currentView = 'home';
  VIEWS.forEach(([id, ic, label]) => nav.append(el('button', { 'data-view': id, title: label, 'aria-label': label, html: icon(ic) })));
  function show(id) {
    if (id === 'control') return LI.workspace.openCC();
    currentView = id;
    $$('.vw').forEach((v) => v.classList.toggle('on', v.dataset.view === id));
    $$('button', nav).forEach((b) => b.classList.toggle('on', b.dataset.view === id));
  }
  nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });

  /* ================= clock (local system time; re-aligns itself to the minute) ================= */
  const clockTime = $('#clockTime'), clockDay = $('#clockDay'), clockDate = $('#clockDate');
  let clockT = 0;
  function paintClock() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(d);
    const t = parts.filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal').map((p) => p.value).join('').trim();
    const ap = (parts.find((p) => p.type === 'dayPeriod') || {}).value;
    clockTime.textContent = t;
    if (ap) clockTime.append(el('span', { class: 'clock-ap', text: ap }));
    clockDay.textContent = d.toLocaleDateString(undefined, { weekday: 'long' });
    clockDate.textContent = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    clearTimeout(clockT);
    clockT = setTimeout(paintClock, 60000 - (Date.now() % 60000) + 40);   // next minute boundary, recomputed every time (survives sleep / clock changes)
  }

  /* ================= battery chip ================= */
  const bat = $('#battery');
  function paintBattery(level, charging) {
    if (LI.S.showBattery === false || level == null) { bat.hidden = true; return; }
    bat.hidden = false; bat.classList.toggle('charging', !!charging);
    bat.innerHTML = icon(charging ? 'batteryCharge' : 'battery');
    bat.append(Math.round(level * 100) + '%');
  }

  /* ================= weather (existing backend: ey:ip-location, ey:fetch-json, weatherPlace, tempUnit) ================= */
  const wxEl = $('#weather');
  let wx = { status: 'loading', data: null, place: null, err: null, at: 0, key: '', busy: false, lastTry: 0 };
  let ipPlace = null, ipAt = 0;
  const wxKey = () => JSON.stringify([LI.S.weatherPlace || null, (LI.S.tempUnit || 'c')]);
  const tag = (e, kind) => { const x = e instanceof Error ? e : new Error(String(e)); x.kind = kind; return x; };

  function paintWeather() {
    wxEl.replaceChildren();
    if (wx.status === 'ok' && wx.data) {
      const d = wx.data;
      wxEl.append(
        el('div', { class: 'wx-top', html: icon('pin') }, ),
        el('div', { class: 'wx-main' },
          el('div', { class: 'wx-temp' }, d.temp + '°', el('span', { class: 'clock-ap', text: d.unit })),
          el('span', { class: 'wx-glyph', html: WX.svg(d.glyph) })),
        el('div', { class: 'wx-bot' }, el('span', { text: d.text }),
          d.hi != null && d.lo != null ? el('span', {}, 'H ', el('b', { text: d.hi + '°' }), '  L ', el('b', { text: d.lo + '°' })) : null));
      wxEl.firstChild.append(el('span', { text: wx.place || 'Your location' }));
      return;
    }
    const loading = wx.status === 'loading';
    const msg = loading ? ['Loading weather', 'Fetching your local forecast']
      : wx.err === 'location' ? ['Location unavailable', 'Choose a city in the Weather plugin']
      : wx.err === 'data' ? ['Weather unavailable', 'The service sent an unexpected response']
      : ['Weather unavailable', 'Check your internet connection'];
    wxEl.append(el('div', { class: 'wx-state' },
      el('span', { html: WX.svg('off') }), el('span', { class: 't', text: msg[0] }), el('span', { text: msg[1] }),
      loading ? null : el('button', { class: 'link-btn', id: 'wxRetry', text: 'Try again' })));
  }
  wxEl.addEventListener('click', (e) => { if (e.target.id === 'wxRetry') loadWeather(true); });

  async function loadWeather(force = false) {
    if (wx.busy) return;
    const key = wxKey(), now = Date.now();
    if (!force && wx.key === key) {
      if (wx.status === 'ok' && now - wx.at < 10 * 60e3) return;          // fresh enough
      if (wx.status === 'error' && now - wx.lastTry < 30e3) return;       // do not hammer while offline
    }
    wx.busy = true; wx.lastTry = now;
    if (wx.status !== 'ok' || wx.key !== key) { wx = { ...wx, status: 'loading', key }; paintWeather(); }
    const f = (LI.S.tempUnit || 'c') === 'f';
    try {
      let place = LI.S.weatherPlace;
      if (!place) {
        if (!ipPlace || now - ipAt > 60 * 60e3) { try { ipPlace = await ey.invoke('ey:ip-location'); ipAt = Date.now(); } catch (e) { throw tag(e, 'location'); } }
        place = ipPlace;
      }
      if (!place || !Number.isFinite(+place.lat) || !Number.isFinite(+place.lon)) throw tag('no coordinates', 'location');
      let raw; try { raw = await ey.invoke('ey:fetch-json', WX.url(place, f)); } catch (e) { throw tag(e, 'network'); }
      let data; try { data = WX.parse(raw, f); } catch (e) { throw tag(e, 'data'); }
      wx = { ...wx, status: 'ok', data, place: place.name || '', err: null, at: Date.now(), key };
    } catch (e) {
      wx = { ...wx, status: 'error', err: e.kind || 'network', key };
    } finally {
      wx.busy = false; paintWeather();
      if (wxKey() !== key) loadWeather(true);                              // the place or unit changed while we were loading
    }
  }
  setInterval(() => loadWeather(), 15 * 60e3);                             // keeps data fresh; cheap no-op when still fresh

  /* ================= system: volume + brightness ================= */
  const volRange = $('#volRange'), briRange = $('#briRange'), volNum = $('#volNum'), briNum = $('#briNum');
  const first = { vol: true, bri: true };
  let dragging = false;
  const sys = LI.state;
  const paintSlider = (r, v) => { r.value = v; r.style.setProperty('--p', v + '%'); };

  function paintSystem() {
    const vol = sys.vol ?? 0;
    if (!dragging) { paintSlider(volRange, sys.muted ? 0 : vol); paintSlider(briRange, sys.bri ?? 0); }
    volNum.textContent = sys.muted ? 'Muted' : vol;
    briNum.textContent = sys.bri ?? '';
    $('#volIcon').innerHTML = icon(volIcon(vol, sys.muted));
    $('#briIcon').innerHTML = icon('sun');
    updateQuick();
  }
  const pushVol = debounce((v) => api.setSystem('vol', v), 60);
  const pushBri = debounce((v) => api.setSystem('bri', v), 120);
  [[volRange, pushVol, volNum], [briRange, pushBri, briNum]].forEach(([r, push, num]) => {
    r.addEventListener('pointerdown', () => { dragging = true; });
    r.addEventListener('input', () => { r.style.setProperty('--p', r.value + '%'); num.textContent = r.value; push(+r.value); });
  });
  window.addEventListener('pointerup', () => { dragging = false; });            // one listener, not one per slider

  function onSystem(m) {
    const ttl = () => LI.S.overlayMs || 1800;
    if (m.kind === 'vol') {
      const changed = m.value !== sys.vol || m.muted !== sys.muted;
      sys.vol = m.value; sys.muted = m.muted; paintSystem();
      if (changed && !first.vol) LI.activity.show({ id: 'volume', kind: 'volume', icon: volIcon(m.value, m.muted), title: 'Volume', value: m.muted ? 'Muted' : m.value + '%', progress: m.muted ? 0 : m.value }, { ttl: ttl() });
      first.vol = false;
    } else if (m.kind === 'bri') {
      if (m.value === null) { sys.bri = null; $('#briRow').hidden = true; return; }            // no brightness control on this display
      const changed = m.value !== sys.bri;
      sys.bri = m.value; paintSystem();
      if (changed && !first.bri) LI.activity.show({ id: 'brightness', kind: 'brightness', icon: 'sun', title: 'Brightness', value: m.value + '%', progress: m.value }, { ttl: ttl() });
      first.bri = false;
    }
  }

  /* ================= quick actions: the plugins the user pinned (default: mute, coffee, text, colour) ================= */
  const quick = $('#quick');
  const PSEUDO = { mute: { label: () => (sys.muted ? 'Unmute' : 'Mute'), icon: () => volIcon(sys.vol ?? 0, sys.muted), on: () => sys.muted, run: () => api.setSystem('mute', 0) } };
  const pinnedList = () => (LI.S.pinned || LI.workspace.PINNED_DEFAULT).slice(0, 4);
  const qaItem = (id) => {
    if (PSEUDO[id]) return PSEUDO[id];
    const p = pl.items.find((x) => x.id === id) || (window.CATALOG || []).find((x) => x.id === id);
    if (!p) return null;
    const short = { textExtract: 'Text', colorPicker: 'Color', youtube: 'YouTube', compress: 'Reducer', convert: 'Convert', sysinfo: 'System', todo: 'Tasks', share: 'Share' }[id];
    return {
      label: () => short || p.name, icon: () => id, on: () => id === 'coffee' && LI.state.coffee,
      run: () => {
        // screen overlays and the Coffee toggle are instant; everything else opens its page inside the island
        if (p.kind === 'action') { api.run(id); LI.island.close(); } else if (p.kind === 'toggle') api.run(id); else LI.workspace.openPlugin(id);
      },
    };
  };
  let qaSig = '';
  function updateQuick() {
    const ids = pinnedList();
    if (ids.join() !== qaSig) {
      qaSig = ids.join();
      quick.replaceChildren(...ids.map((id) => el('button', { class: 'qa-btn', 'data-id': id })));
    }
    ids.forEach((id) => {
      const q = qaItem(id), b = quick.querySelector(`[data-id="${id}"]`); if (!q || !b) return;
      b.innerHTML = icon(q.icon()) + `<span>${q.label()}</span>`;
      b.classList.toggle('on', !!(q.on && q.on()));
      b.setAttribute('aria-pressed', q.on ? String(!!q.on()) : 'false');
      b.setAttribute('aria-label', q.label());
    });
  }
  quick.addEventListener('click', (e) => { const b = e.target.closest('.qa-btn'); const q = b && qaItem(b.dataset.id); if (q) q.run(); });

  /* ================= plugin navigation (reads the existing catalog; execution stays in the main process) ================= */
  const plCats = $('#plCats'), plGrid = $('#plGrid');
  const pl = { cat: null, items: [], sig: '' };
  async function refreshCatalog() {
    let cat; try { cat = (await api.catalog()).filter((p) => p.id !== 'shortcuts'); } catch { return; }     // shortcuts page lives in Settings
    const sig = JSON.stringify(cat.map((p) => [p.id, p.key]));
    if (sig === pl.sig) return;
    pl.sig = sig; pl.items = cat;
    const groups = [...new Set(cat.map((p) => p.group))];
    if (pl.cat !== FAV && !groups.includes(pl.cat)) pl.cat = groups[0];
    paintPlugins(); updateQuick();
  }
  const FAV = 'Favourites';
  function paintPlugins() {
    const favs = (LI.S.favorites || []).filter((id) => pl.items.some((p) => p.id === id));
    const groups = [...(favs.length ? [FAV] : []), ...new Set(pl.items.map((p) => p.group))];
    if (!groups.includes(pl.cat)) pl.cat = groups[0];
    plCats.replaceChildren(...groups.map((g) => el('button', { class: 'pl-cat' + (g === pl.cat ? ' on' : ''), 'data-cat': g, role: 'tab', 'aria-selected': String(g === pl.cat), text: g })));
    const shown = pl.cat === FAV ? favs.map((id) => pl.items.find((p) => p.id === id)) : pl.items.filter((p) => p.group === pl.cat);
    plGrid.replaceChildren(...shown.map((p) => el('button', {
      class: 'pl-card' + (p.id === 'coffee' && LI.state.coffee ? ' on' : ''), 'data-id': p.id,
      title: p.name + (p.key ? `  (${p.key})` : '') + (p.desc ? `\n${p.desc}` : ''), 'aria-label': p.name,
      html: icon(p.id),
    }, el('span', { text: p.name }), p.key ? el('small', { text: p.key }) : null)));
  }
  plCats.addEventListener('click', (e) => { const b = e.target.closest('.pl-cat'); if (b) { pl.cat = b.dataset.cat; paintPlugins(); } });
  plGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.pl-card'); if (!b) return;
    LI.workspace.openPlugin(b.dataset.id);                                // every plugin opens inside the island
  });

  /* ================= coffee mode state (comes from the main process) ================= */
  function setCoffee(on) {
    LI.state.coffee = on; document.body.classList.toggle('coffee', on);
    const c = plGrid.querySelector('[data-id="coffee"]'); if (c) c.classList.toggle('on', on);
    updateQuick(); LI.panels && LI.panels.indicators();
  }

  /* ================= lifecycle hooks used by the island ================= */
  function onOpen() { paintClock(); refreshCatalog(); loadWeather(); }
  function onSettings(prev) {
    paintBattery(batteryLevel, batteryCharging);
    paintPlugins(); updateQuick();
    if (prev && wxKey() !== wx.key) loadWeather(true);
  }
  let batteryLevel = null, batteryCharging = false;
  function setBattery(level, charging) { batteryLevel = level; batteryCharging = charging; paintBattery(level, charging); }

  LI.dashboard = { show, current: () => currentView, onOpen, onSettings, onSystem, setCoffee, setBattery, loadWeather, refreshCatalog, paintClock, paintSystem, paintWeather };
})();
