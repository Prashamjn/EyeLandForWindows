'use strict';
// Shared helpers and state for the island renderer. Everything hangs off one namespace: window.LI.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // tiny DOM builder. Text always goes through textContent, so media titles, place names etc. can never inject markup.
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;            // trusted markup only (our own icons)
      else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c)); });
    return n;
  };

  const icon = (id) => ICONS.svg(id);
  const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const volIcon = (v, muted) => (muted ? 'volMute' : v <= 0 ? 'vol0' : v <= 50 ? 'vol1' : 'vol2');
  // colour swatch used as an icon (only accepts a plain hex colour)
  const swatch = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? `<i class="swatch" style="background:${c}"></i>` : null);
  const iconHtml = (a) => (a.color && swatch(a.color)) || icon(a.icon);

  // tiny event bus. The main process never echoes a settings change back to the window that made it, and the island, the
  // plugin pages and the Control Centre all live in this one window, so they share changes through here.
  const bus = (() => {
    const map = new Map();
    return {
      on(ev, cb) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(cb); return () => map.get(ev).delete(cb); },
      emit(ev, data) { (map.get(ev) || []).forEach((cb) => { try { cb(data); } catch (e) { console.error('[bus]', ev, e); } }); },
    };
  })();

  // reduced motion: either the OS preference or the Liquid Island setting
  const reduceMotion = () => !!(window.LI && LI.S && LI.S.reduceMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.LI = {
    $, $$, el, icon, iconHtml, clamp, debounce, volIcon, swatch, bus, reduceMotion,
    S: {},                                        // settings mirror. Replaced IN PLACE (LI.setSettings) so references stay valid
    setSettings(next) { for (const k of Object.keys(LI.S)) delete LI.S[k]; Object.assign(LI.S, next); return LI.S; },
    state: { vol: null, muted: false, bri: null, media: { title: '', artist: '', app: '', playing: false }, clips: [], coffee: false },
  };
})();
