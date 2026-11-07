'use strict';
// Entry point: loads settings, then connects every main-process event exactly once.
(() => {
  const { $ } = LI;

  /* ---------- settings -> DOM ---------- */
  LI.applySettings = (prev) => {
    const S = LI.S;
    document.body.dataset.theme = S.theme || 'black';
    document.body.dataset.accent = S.accent || 'blue';
    document.documentElement.style.setProperty('--speed', S.animSpeed || 1);
    LI.island.layout();
    LI.panels.onSettings();
    LI.dashboard.onSettings(!!prev);
  };

  /* ---------- main-process events (registered once; the preload bridge has no unsubscribe, so never register twice) ---------- */
  api.onCursor(LI.island.onCursor);
  api.onOpenPanel((d) => LI.island.open(d || {}));
  api.onSystem((m) => LI.dashboard.onSystem(m));
  api.onClips((list) => LI.panels.onClips(list));
  api.onSettings((s) => { const prev = LI.S; LI.S = s; LI.applySettings(prev); });
  api.onCoffee((on) => LI.dashboard.setCoffee(on));

  // plugin results from the main process: { icon, text, color }
  const TOAST_ICON = { copy: 'copy', check: 'check', warn: 'warn', search: 'lens', coffee: 'coffee' };
  api.onToast(({ icon, text, color }) => {
    if (LI.island.state === 'full') LI.island.close();                  // results appear after you act elsewhere on screen
    LI.activity.show({
      id: 'notice', kind: 'notice', icon: TOAST_ICON[icon] || 'check', color: icon === 'color' ? color : undefined,
      title: text, tone: icon === 'warn' ? 'warn' : '', mini: 'text',
    }, { ttl: Math.max(2200, LI.S.overlayMs || 1800) });
  });

  /* ---------- media ---------- */
  const mediaActivity = (m) => ({
    id: 'media', kind: 'media', icon: 'music', title: m.title, sub: m.artist || m.app || '', mini: 'media',
    controls: [
      { id: 'prev', icon: 'prev', label: 'Previous', onClick: () => api.media('prev') },
      { id: 'play', icon: m.playing ? 'pauseF' : 'play', label: m.playing ? 'Pause' : 'Play', primary: true, onClick: () => api.media('play') },
      { id: 'next', icon: 'next', label: 'Next', onClick: () => api.media('next') },
    ],
  });
  let mediaSeen = false;
  api.onMedia((m) => {
    m = m || {};
    const prev = LI.state.media; LI.state.media = m;
    LI.activity.setBase('media', m.title ? mediaActivity(m) : null);
    // a new track while playing gets a brief mini presentation (never on the very first reading at startup)
    if (mediaSeen && m.title && m.playing && m.title !== prev.title) LI.island.mini(mediaActivity(m), 3200);
    mediaSeen = true;
  });

  /* ---------- battery: small readout in the clock card + a charging notice when the power state changes ---------- */
  if (navigator.getBattery) navigator.getBattery().then((b) => {
    LI.dashboard.setBattery(b.level, b.charging);
    b.addEventListener('levelchange', () => LI.dashboard.setBattery(b.level, b.charging));
    b.addEventListener('chargingchange', () => {
      LI.dashboard.setBattery(b.level, b.charging);
      LI.activity.show({
        id: 'battery', kind: 'battery', icon: b.charging ? 'batteryCharge' : 'battery', title: b.charging ? 'Charging' : 'On battery',
        sub: Math.round(b.level * 100) + '%', tone: b.charging ? 'success' : '', mini: 'text',
      }, { ttl: 2600 });
    });
  }).catch(() => {});

  /* ---------- boot ---------- */
  (async () => {
    LI.S = await api.getSettings();
    LI.panels.buildSettings();
    LI.applySettings();
    LI.panels.setTimerMode('focus'); LI.panels.paintClips(); LI.panels.paintTasks();
    LI.dashboard.paintSystem(); LI.dashboard.paintClock(); LI.dashboard.paintWeather();
    LI.dashboard.show('home');
    try { LI.dashboard.setCoffee(await window.eyeland.invoke('ey:coffee')); } catch {}
    LI.dashboard.refreshCatalog();
    LI.dashboard.loadWeather();
  })();
})();
