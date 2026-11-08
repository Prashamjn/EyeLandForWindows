// Plugin host: tiny DOM helper, plugin registry and the shared context every plugin page receives.
// Plugin pages are mounted by renderer/workspace.js inside Liquid Island itself (there is no separate plugin window).
// Plugins talk to the main process only through this `ey` bridge. Settings changes made anywhere in the island are
// delivered through the in-renderer bus, because the main process never echoes a change back to the window that made it.
const ey = {
  ...window.eyeland,
  on: (ch, cb) => {
    if (ch === 'settings') return LI.bus.on('settings', cb);
    if (ch === 'translate:text') return LI.bus.on('translate:open', cb);     // "scan screen" result is delivered to the open page
    return window.eyeland.on(ch, cb);
  },
};

const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
  if (value !== undefined) el.value = value;
  return el;
};

const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = +n || 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return (i === 0 ? n.toFixed(0) : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
};
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
const uid = () => Math.random().toString(36).slice(2, 10);

const Plugins = { map: new Map(), register(p) { this.map.set(p.id, p); } };

const ctx = {
  ey, h, fmtBytes, fmtTime, uid,
  get S() { return LI.S; },                         // one settings object for the whole island (updated in place)
  icon: (id) => h('span', { html: ICONS.svg(id), style: 'display:inline-flex' }),
  save(partial) { Object.assign(LI.S, partial); ey.send('settings-save', partial); LI.bus.emit('settings', LI.S); },
  toast: (msg, err) => LI.toast(msg, err),
  // the workspace header already shows the plugin's name and icon, so a page only adds its one-line description
  head: (_title, desc) => h('p', { class: 'ph', hidden: !desc }, desc || ''),
  async pick(filters, multi = true) { return ey.invoke('ey:pick', { filters, multi }); },
  // drop zone that accepts files by drag and drop or click-to-browse
  dropZone(label, { filters, multi = true, onFiles }) {
    const z = h('div', { class: 'drop' }, label);
    z.addEventListener('click', async () => { const f = await ctx.pick(filters, multi); if (f.length) onFiles(f); });
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => {
      e.preventDefault(); z.classList.remove('over');
      const f = [...e.dataTransfer.files].map((x) => webUtils_path(x)).filter(Boolean);
      if (f.length) onFiles(multi ? f : f.slice(0, 1));
    });
    return z;
  },
};
// Dropped File objects expose their path through the preload bridge in recent Electron builds; fall back to File.path.
function webUtils_path(file) { return (window.eyeland.pathFor && window.eyeland.pathFor(file)) || file.path || ''; }

// PDF helpers (pdf.js is vendored, so everything works offline)
// (pdf.js and the QR generator are loaded on demand by renderer/workspace.js, which also points pdf.js at its worker)
const b64ToBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
ctx.loadPdf = async (b64) => pdfjsLib.getDocument({ data: b64ToBytes(b64), isEvalSupported: false }).promise;
ctx.renderPage = async (doc, n, scale, type = 'image/jpeg', q = 0.9) => {
  const page = await doc.getPage(n), vp = page.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: c, viewport: vp }).promise;
  return { url: cv.toDataURL(type, q), w: cv.width, h: cv.height };
};
ctx.b64ToBytes = b64ToBytes;
