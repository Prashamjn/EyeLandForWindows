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

  window.LI = {
    $, $$, el, icon, iconHtml, clamp, debounce, volIcon, swatch,
    S: {},                                        // settings mirror (replaced whenever settings change)
    state: { vol: null, muted: false, bri: null, media: { title: '', artist: '', app: '', playing: false }, clips: [], coffee: false },
  };
})();
