const { app, BrowserWindow, ipcMain, screen, clipboard, Tray, Menu, nativeImage, globalShortcut, powerSaveBlocker, dialog, shell, session, protocol, net: electronNet } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const CATALOG = require('./shared/catalog.js');
const media = require('./src/media');
const pdf = require('./src/pdf');
const net = require('./src/net');
const yt = require('./src/youtube');
const cleaner = require('./src/cleaner');
const sysinfo = require('./src/sysinfo');
const speed = require('./src/speedtest');
const voice = require('./src/voice');
const { createShare } = require('./src/share');
const { uniquePath } = require('./src/util');
const { createSystem } = require('./src/system');
const IslandLogic = require('./shared/island-logic.js');
const { createAudioStudio } = require('./src/audio');
const { createLyricsService } = require('./src/lyrics');

// Keep using the existing data folder (%APPDATA%\eyeland) so settings, tasks, voice memos etc. survive the rename to
// Liquid Island. This must run before the single-instance lock, which is keyed on this folder.
app.setPath('userData', path.join(app.getPath('appData'), 'eyeland'));
if (!app.requestSingleInstanceLock()) app.quit();
// Audio preview plays through liaudio://f/<id>. Only files the user picked or dropped (and Audio Studio inspected) get an id.
protocol.registerSchemesAsPrivileged([{ scheme: 'liaudio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

// The island window is a fixed, transparent, click-through canvas. It is sized for the largest state (the 700x500 workspace)
// plus room for its shadow and is NEVER resized during animation; the island itself morphs inside it (renderer/island.css).
const W = 760, H = 620;
const nativeDir = path.join(__dirname, 'native').replace('app.asar', 'app.asar.unpacked');
const PS = (file, args) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(nativeDir, file), ...args];

const defaultShortcuts = Object.fromEntries(CATALOG.map((p) => [p.id, p.key]));
const defaults = {
  position: 'top', offsetY: 10, display: 'primary', settingsVersion: 2, accent: 'blue', animSpeed: 1, theme: 'black',
  hoverDelay: 120, overlayMs: 1800, autostart: false, clipboardHistory: false,
  focusMin: 25, breakMin: 5, notes: '', showBattery: true,
  hideInFullscreen: true, shortcuts: defaultShortcuts, coffeeMinutes: 0,
  todos: [], events: {}, colorFormat: 'hex', colorHistory: [], ocrLang: 'eng', translateTo: 'en',
  lensEngine: 'google', lensConsent: false, weatherPlace: null, tempUnit: 'c',
  // Phase 2
  expandOn: 'last', blurCollapseSec: 8, reduceMotion: false, favorites: [], pinned: ['mute', 'coffee', 'textExtract', 'colorPicker'],
  notifyBluetooth: true, notifyWifi: true, notifyVpn: true, notifyAudio: true, notifyMic: true, notifyPower: true, notifyDisplay: true, notifyBattery: true, notifyMs: 2800,
  ccMic: true, ccPower: true, ccNight: true, ccDisplay: true, ccCharging: true,
  monitorAudio: true, monitorNetwork: true, monitorBluetooth: true, monitorPower: true,
  // Phase 3 (no settings migration needed: loadSettings merges these defaults under whatever the user saved)
  hoverExpand: true, autoCollapse: true, collapseDelay: 350, motionMode: 'system',
  mediaVisualizer: true, mediaArtwork: true, lyricsEnabled: false,
  chargeSound: true, chargeVolume: 40, chargeDisconnectSound: false,
  audioFormat: 'mp3', audioBitrate: 256, audioDir: '', audioRemember: true, audioLast: {},
};
let settings = { ...defaults }, win, tray, clips = [], lastClip = '', system, audio;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
  settings = { ...defaults, ...(saved || {}) };
  settings.shortcuts = { ...defaultShortcuts, ...(settings.shortcuts || {}) };
  // One-time migration to settings v2 (Phase 2). Everything else the user saved is kept untouched. The only value changed is
  // the old default top gap (0 = flush against the screen edge, or 6), which made the island look glued to the top: it becomes 10 px.
  // A gap the user chose deliberately (anything else) is respected; the slider still goes down to 0 afterwards.
  if (saved && (saved.settingsVersion || 1) < 2) {
    if (saved.offsetY === undefined || saved.offsetY === 0 || saved.offsetY === 6) settings.offsetY = defaults.offsetY;
    settings.settingsVersion = 2;
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
  }
}
const saveFile = () => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {} };
const S = () => settings;

/* ---------- messaging ---------- */
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
// There is a single UI window now (the island), so "broadcast" only skips the window that made the change.
const broadcast = (ch, data, except) => { if (win && !win.isDestroyed() && win.webContents !== except) win.webContents.send(ch, data); };
const toast = (t) => send('toast', t);
function saveSettings(partial, except) {
  settings = { ...settings, ...partial };
  try { if (partial && 'lyricsEnabled' in partial) { lyricsKey = lyricsNoTl = ''; if (lastMedia) onMedia(lastMedia); } } catch { /* lyrics not initialised yet */ }
  saveFile();
  broadcast('settings', settings, except);
}

/* ---------- island window ---------- */
// The window itself sits `offsetY` px from the screen edge (the island is flush with the top of the window), so the physical window
// and what you see always agree. The target display is the primary one unless a connected display was chosen in Settings.
function targetDisplay() {
  const want = settings.display;
  if (want && want !== 'primary') { const d = screen.getAllDisplays().find((x) => String(x.id) === String(want)); if (d) return d; }
  return screen.getPrimaryDisplay();
}
function place() {
  if (!win || win.isDestroyed()) return;
  const b = targetDisplay().bounds;
  const off = Math.max(0, Math.min(60, Math.round(+settings.offsetY || 0)));
  const w = Math.min(W, b.width), h = Math.min(H, b.height - off);
  const x = Math.round(b.x + (b.width - w) / 2);
  const y = settings.position === 'bottom' ? b.y + b.height - h - off : b.y + off;
  win.setBounds({ x, y, width: w, height: h });
}

function createWindow() {
  win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true);
  place();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => updateIsland());
  screen.on('display-metrics-changed', place);
  screen.on('display-added', place);
  screen.on('display-removed', place);
}

/* ---------- show/hide: full-screen apps and screen capture ---------- */
let fullscreen = false, capturing = false, ignoreFsUntil = 0;
function updateIsland() {
  if (!win || win.isDestroyed()) return;
  const fs_ = fullscreen && Date.now() > ignoreFsUntil;
  const show = !capturing && !(settings.hideInFullscreen && fs_);
  if (show && !win.isVisible()) win.showInactive();
  if (!show && win.isVisible()) win.hide();
}
function hideForCapture(on) {
  capturing = on;
  if (!on) { ignoreFsUntil = Date.now() + 900; setTimeout(updateIsland, 950); }
  updateIsland();
}

/* ---------- opening things inside the island (plugin pages, Control Centre). There is no separate plugin window. ---------- */
function openInIsland(opts) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible() && !capturing) win.showInactive();      // an explicit request (shortcut / tray) shows it even over a full-screen app
  send('open-panel', opts || {});
}
const openPlugin = (id, payload) => openInIsland({ plugin: id, payload });

/* ---------- cursor tracking (hover detection: the island window ignores mouse events until it is expanded) ----------
   Adaptive: 33 ms only while the cursor is near the island window, 100 ms in the wider area, 250 ms when far away. When the cursor
   leaves the neighbourhood ONE final 'far' message is sent (so the renderer collapses) and nothing more is sent until it returns. */
let lastPt = { x: -1, y: -1 }, farSent = false, pollTimer = null;
function pollCursor() {
  let ms = 250;
  try {
    if (win && !win.isDestroyed() && win.isVisible()) {
      const p = screen.getCursorScreenPoint(), b = win.getBounds();
      const z = IslandLogic.pollInterval(p, b); ms = z.ms;
      if (z.zone === 'far') {
        if (!farSent) { farSent = true; send('cursor', { x: -9999, y: -9999, far: true }); }
      } else {
        const moved = p.x !== lastPt.x || p.y !== lastPt.y;
        if (moved || farSent) { lastPt = p; farSent = false; send('cursor', { x: p.x - b.x, y: p.y - b.y }); }
      }
    }
  } catch (e) { console.error('[cursor]', e.message); }
  pollTimer = setTimeout(pollCursor, ms);
}
pollTimer = setTimeout(pollCursor, 100);

/* ---------- native dialogs hold the island open (the renderer must not collapse under a file picker) ----------
   Every dialog goes through these wrappers. Native Windows permission prompts that do not come from Electron cannot be detected
   directly; the window-blur logic in renderer/island.js covers them (see docs). */
let dialogDepth = 0;
for (const fn of ['showOpenDialog', 'showSaveDialog', 'showMessageBox']) {
  const orig = dialog[fn].bind(dialog);
  dialog[fn] = async (...a) => {
    if (dialogDepth++ === 0) send('hold', { key: 'dialog', on: true });
    try { return await orig(...a); } finally { if (--dialogDepth === 0) send('hold', { key: 'dialog', on: false }); }
  };
}

/* ---------- native helpers ---------- */
function lineReader(proc, onLine) {
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
}
let procs = [];
function keepAlive(file, args, onLine) {
  const start = () => {
    const p = spawn('powershell.exe', PS(file, args), { windowsHide: true });
    procs.push(p);
    lineReader(p, onLine);
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => console.error(`[${file}]`, String(d).trim()));
    p.on('error', (e) => console.error(`[${file}] could not start:`, e.message));
    p.on('exit', () => { procs = procs.filter((x) => x !== p); if (!app.isQuitting) setTimeout(start, 3000); });
  };
  start();
}
function startWatchers() {
  // volume, brightness, battery, Wi-Fi, Bluetooth and VPN are event-driven and live in src/system; here only the two scripts
  // that have no event source: full-screen detection (checked twice a second) and the media session.
  keepAlive('sys.ps1', ['-Mode', 'watch'], (l) => {
    const [kind, a] = l.split('|');
    if (kind === 'fs') { fullscreen = a === '1'; updateIsland(); }
  });
  keepAlive('media.ps1', [], (l) => { try { const m = JSON.parse(l); send('media', m); onMedia(m); } catch {} });
}
// the island's volume / brightness sliders and the Mute quick action
ipcMain.on('system-set', (_e, { target, value }) => {
  if (target === 'vol') system.call('audio.setVolume', { value });
  else if (target === 'bri') system.call('bri.set', { value });
  else if (target === 'mute') system.call('audio.setMute', { muted: !(system.cache.audio && system.cache.audio.muted) });
});
ipcMain.handle('cc:call', (_e, op, arg) => system.call(op, arg));
ipcMain.handle('ey:displays', () => require('./src/system/display').snapshot().map(({ id, label, primary }) => ({ id, label, primary })));
ipcMain.on('media-key', (_e, cmd) => execFile('powershell.exe', PS('sys.ps1', ['-Mode', 'key', '-Target', String(cmd)]), { windowsHide: true }, () => {}));

/* ---------- island window interaction ---------- */
ipcMain.on('interactive', (_e, on) => win && win.setIgnoreMouseEvents(!on));
ipcMain.on('focusable', (_e, on) => { if (!win) return; win.setFocusable(!!on); if (on) win.focus(); });
ipcMain.on('quit', () => app.quit());

/* ---------- clipboard history (opt-in) ---------- */
setInterval(() => {
  if (!settings.clipboardHistory) return;
  let t; try { t = clipboard.readText(); } catch { return; }
  if (!t || t === lastClip) return;
  lastClip = t;
  clips = [t, ...clips.filter((c) => c !== t)].slice(0, 15);
  send('clips', clips);
}, 900);
ipcMain.on('clip-copy', (_e, t) => { lastClip = t; clipboard.writeText(t); });
ipcMain.on('clip-clear', () => { clips = []; send('clips', clips); });

/* ---------- coffee mode ---------- */
let coffeeId = null, coffeeTimer = null;
function setCoffee(on) {
  if (on && coffeeId === null) {
    coffeeId = powerSaveBlocker.start('prevent-display-sleep');
    if (settings.coffeeMinutes > 0) coffeeTimer = setTimeout(() => setCoffee(false), settings.coffeeMinutes * 60000);
  }
  if (!on && coffeeId !== null) { powerSaveBlocker.stop(coffeeId); coffeeId = null; clearTimeout(coffeeTimer); }
  broadcast('coffee', coffeeId !== null);
  toast({ icon: 'coffee', text: coffeeId !== null ? 'Coffee mode on, screen stays awake' : 'Coffee mode off' });
}

/* ---------- screen plugins ---------- */
const capture = require('./src/capture')({ settings: S, saveSettings: (p) => saveSettings(p), toast, hideForCapture, openPlugin, send });
capture.register(ipcMain);

function runPlugin(id) {
  switch (id) {
    case 'textExtract': return capture.start('text');
    case 'lens': return capture.start('lens');
    case 'colorPicker': return capture.start('color');
    case 'draw': return capture.start('draw');
    case 'coffee': return setCoffee(coffeeId === null);
    default: return openPlugin(id);
  }
}
const shortcutRun = (id) => (id === 'translate' ? capture.start('translate') : runPlugin(id));

/* ---------- keyboard shortcuts ---------- */
const registered = new Map();
function applyShortcut(id) {
  const old = registered.get(id);
  if (old) { try { globalShortcut.unregister(old); } catch {} registered.delete(id); }
  const key = settings.shortcuts[id];
  if (!key) return { ok: true };
  try {
    const ok = globalShortcut.register(key, () => shortcutRun(id));
    if (!ok) return { ok: false, error: 'Already used by another app' };
    registered.set(id, key);
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Not a valid shortcut' }; }
}
function registerAll() { const errors = {}; for (const p of CATALOG) { const r = applyShortcut(p.id); if (!r.ok) errors[p.id] = r.error; } return errors; }
ipcMain.handle('ey:shortcut-set', (_e, id, key) => {
  if (key) for (const [other, k] of Object.entries(settings.shortcuts)) if (other !== id && k && k.toLowerCase() === key.toLowerCase()) return { ok: false, error: 'Already used by ' + (CATALOG.find((c) => c.id === other) || {}).name };
  const prev = settings.shortcuts[id];
  settings.shortcuts = { ...settings.shortcuts, [id]: key };
  const r = applyShortcut(id);
  if (!r.ok) { settings.shortcuts[id] = prev; applyShortcut(id); return r; }
  saveSettings({ shortcuts: settings.shortcuts });
  return { ok: true };
});
ipcMain.handle('ey:shortcut-errors', () => registerAll());

/* ---------- generic IPC ---------- */
ipcMain.handle('settings-get', () => settings);
ipcMain.on('settings-save', (e, s) => {
  const old = settings;
  saveSettings(s, e.sender);
  place();
  app.setLoginItemSettings({ openAtLogin: !!settings.autostart });
  if (!settings.clipboardHistory) { clips = []; send('clips', clips); }
  if (old.hideInFullscreen !== settings.hideInFullscreen) updateIsland();
  if (['monitorAudio', 'monitorNetwork', 'monitorBluetooth', 'monitorPower'].some((k) => old[k] !== settings[k])) system.applyMonitoring();
});
ipcMain.handle('ey:catalog', () => CATALOG.map((p) => ({ ...p, key: settings.shortcuts[p.id] || '' })));
ipcMain.handle('ey:run', (_e, id) => runPlugin(id));
ipcMain.handle('ey:coffee', () => coffeeId !== null);
ipcMain.handle('ey:fetch-json', (_e, url) => net.fetchJSON(url));
ipcMain.handle('ey:ip-location', () => net.ipLocation());
ipcMain.handle('ey:translate', (_e, text, to, from) => net.translate(text, to, from));

ipcMain.handle('ey:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('ey:copy-image', (_e, dataUrl) => { clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)); return true; });
ipcMain.handle('ey:save-dialog', async (e, { defaultName, filters, base64, text }) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(app.getPath('downloads'), defaultName || 'file'), filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, base64 != null ? Buffer.from(base64, 'base64') : String(text || ''));
  return r.filePath;
});
ipcMain.handle('ey:write-file', (_e, { dir, name, base64 }) => {
  fs.mkdirSync(dir, { recursive: true });
  const p = uniquePath(path.join(dir, name));
  fs.writeFileSync(p, Buffer.from(base64, 'base64'));
  return p;
});
ipcMain.handle('ey:pick', async (e, { filters, multi }) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('ey:readfile', (_e, p) => {
  const st = fs.statSync(p);
  if (st.size > 400 * 1024 * 1024) throw new Error('File is too large');
  return fs.readFileSync(p).toString('base64');
});
ipcMain.handle('ey:fileinfo', (_e, p) => { const st = fs.statSync(p); return { size: st.size, name: path.basename(p), dir: path.dirname(p), ext: media.extOf(p), category: media.category(media.extOf(p)) }; });
ipcMain.handle('ey:reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('ey:open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('ey:open-external', (_e, u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); });

/* ---------- files: convert, compress, print ---------- */
ipcMain.handle('ey:ff:targets', (_e, p) => { const c = media.category(media.extOf(p)); return { category: c, targets: media.TARGETS[c] || [] }; });
ipcMain.handle('ey:convert', async (e, { id, input, to }) => {
  const cat = media.category(media.extOf(input));
  const emit = (d) => e.sender.send('ey:progress', d);
  if (to === 'pdf') {
    const { dir, name } = path.parse(input);
    const out = uniquePath(path.join(dir, name + '.pdf'));
    let buf;
    if (cat === 'doc') buf = await pdf.docToPdf(input);
    else {
      const ext = media.extOf(input), mime = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', tif: 'tiff', tiff: 'tiff' }[ext] || 'png';
      const img = nativeImage.createFromPath(input);
      const src = ['jpeg', 'png'].includes(mime) ? `data:image/${mime};base64,${fs.readFileSync(input).toString('base64')}` : 'data:image/png;base64,' + img.toPNG().toString('base64');
      const { width, height } = img.getSize();
      buf = await pdf.pagesToPdf([src], { paper: 'A4', landscape: width > height, margin: 8 });
    }
    fs.writeFileSync(out, buf);
    emit({ id, percent: 100 });
    return { output: out, before: fs.statSync(input).size, after: buf.length };
  }
  return media.convert({ id, input, to }, emit);
});
ipcMain.handle('ey:compress', (e, a) => media.compress(a, (d) => e.sender.send('ey:progress', d)));
ipcMain.handle('ey:ff:cancel', (_e, id) => media.cancel(id));
ipcMain.handle('ey:pages-to-pdf', async (_e, { pages, opts }) => (await pdf.pagesToPdf(pages, opts || {})).toString('base64'));
ipcMain.handle('ey:doc:topdf', async (_e, p) => (await pdf.docToPdf(p)).toString('base64'));
ipcMain.handle('ey:print:printers', async () => { const l = await win.webContents.getPrintersAsync(); return l.map((p) => ({ name: p.name, display: p.displayName || p.name, isDefault: !!p.isDefault })); });
ipcMain.handle('ey:print:run', async (e, { mode, pages, opts }) => {
  if (mode === 'pdf') {
    const buf = await pdf.pagesToPdf(pages, { paper: opts.paper, landscape: opts.landscape, margin: opts.margin, gray: opts.color === false });
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: path.join(app.getPath('documents'), 'Print.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { cancelled: true };
    fs.writeFileSync(r.filePath, buf);
    return { path: r.filePath };
  }
  await pdf.printPages(pages, opts);
  return { ok: true };
});
ipcMain.handle('ey:print:office', (_e, { file, printer }) => new Promise((resolve, reject) => {
  const q = (s) => String(s).replace(/'/g, "''");
  const cmd = printer ? `Start-Process -FilePath '${q(file)}' -Verb PrintTo -ArgumentList '"${q(printer)}"'` : `Start-Process -FilePath '${q(file)}' -Verb Print`;
  execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }, (err) => (err ? reject(err) : resolve(true)));
}));

/* ---------- voice, youtube, cleaner, system, speed, share ---------- */
ipcMain.handle('ey:voice:list', () => voice.list());
ipcMain.handle('ey:voice:save', (_e, a) => voice.save(a));
ipcMain.handle('ey:voice:read', (_e, id) => voice.read(id));
ipcMain.handle('ey:voice:delete', (_e, id) => voice.remove(id));
ipcMain.handle('ey:voice:rename', (_e, id, name) => voice.rename(id, name));
ipcMain.handle('ey:voice:export', async (e, id, format, name) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: path.join(app.getPath('music'), `${(name || 'memo').replace(/[<>:"/\\|?*]/g, '_')}.${format}`), filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  if (r.canceled || !r.filePath) return null;
  return voice.exportAs(id, format, r.filePath);
});

ipcMain.handle('ey:yt:status', () => yt.status());
ipcMain.handle('ey:yt:install', (e) => yt.install((d) => e.sender.send('ey:yt:install', d)));
ipcMain.handle('ey:yt:update', () => yt.update());
ipcMain.handle('ey:yt:info', (_e, url) => yt.info(url));
ipcMain.handle('ey:yt:download', (e, a) => yt.download(a, (d) => e.sender.send('ey:yt:progress', d)));
ipcMain.handle('ey:yt:cancel', (_e, id) => yt.cancel(id));

ipcMain.handle('ey:clean:scan', (_e, o) => cleaner.scan(o));
ipcMain.handle('ey:clean:run', (e, o) => cleaner.clean(o, (d) => e.sender.send('ey:clean:progress', d)));

ipcMain.handle('ey:sys:stats', () => sysinfo.stats());
ipcMain.handle('ey:sys:details', () => sysinfo.details());
ipcMain.handle('ey:sys:disks', () => sysinfo.disks());

ipcMain.handle('ey:speed:run', (e) => speed.run((d) => e.sender.send('ey:speed', d)));
ipcMain.handle('ey:speed:cancel', () => speed.cancel());

const share = createShare((snap) => send('ey:share:update', snap));
ipcMain.handle('ey:share:ips', () => share.lanIps());
ipcMain.handle('ey:share:start', (_e, { mode, files, ip }) => share.start({ mode, files, ip, dir: path.join(app.getPath('downloads'), 'Eyeland Received') }));
ipcMain.handle('ey:share:stop', () => share.stop());
ipcMain.handle('ey:share:snapshot', () => share.snapshot());

/* ---------- synced lyrics (opt-in: Settings > Media). One request per new track; only timestamped lyrics are ever forwarded. ---------- */
const lyricsSvc = createLyricsService({ getJSON: (u) => require('./src/net').fetchJSON(u, { timeout: 8000 }) });
let lyricsKey = '', lyricsNoTl = '', lastMedia = null;
function onMedia(m) {
  lastMedia = m;
  if (!settings.lyricsEnabled || !m || !m.title) { if (lyricsKey || lyricsNoTl) { lyricsKey = lyricsNoTl = ''; send('lyrics', { key: '', status: 'off' }); } return; }
  const key = [m.app, m.artist, m.title].join('|');
  if (key === lyricsKey) return;
  // without a track length the match cannot be checked, and without a timeline the lines cannot be synchronised: say so, never guess
  if (!(m.dur > 0)) { if (lyricsNoTl !== key) { lyricsNoTl = key; send('lyrics', { key, status: 'unavailable', reason: 'no-timeline' }); } return; }
  lyricsNoTl = ''; lyricsKey = key;
  send('lyrics', { key, status: 'loading' });
  lyricsSvc.get({ title: m.title, artist: m.artist, album: m.album, duration: m.dur }).then((r) => {
    if (key !== lyricsKey) return;                                          // the track changed while we were waiting
    send('lyrics', { key, status: r.status, reason: r.reason, lines: r.status === 'ok' ? r.lines : undefined });
  });
}

/* ---------- Audio Studio (Audio Trimmer + Audio Merger). FFmpeg runs as a child process, so the UI never blocks. ---------- */
const audioReply = async (fn) => {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, code: e.code || 'error', error: e.message || 'Audio Studio failed', detail: e.detail || '' }; }
};
ipcMain.handle('ey:audio:caps', () => audioReply(() => audio.capabilities()));
ipcMain.handle('ey:audio:probe', (_e, p) => audioReply(() => audio.probe(p)));
ipcMain.handle('ey:audio:peaks', (_e, p, n) => audioReply(() => audio.waveform(p, n)));
ipcMain.handle('ey:audio:trim', (_e, id, req) => audioReply(() => audio.exportTrim(String(id), req)));
ipcMain.handle('ey:audio:merge', (_e, id, req) => audioReply(() => audio.exportMerge(String(id), req)));
ipcMain.handle('ey:audio:cancel', (_e, id) => audio.cancel(String(id)));
ipcMain.handle('ey:audio:folder', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.audioDir || app.getPath('music') });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

/* ---------- tray ---------- */
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Liquid Island');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open dashboard', click: () => openInIsland({}) },
    { label: 'Open plugins', click: () => openInIsland({ view: 'plugins' }) },
    { label: 'Open Control Centre', click: () => openInIsland({ cc: true }) },
    { label: 'Quit Liquid Island', click: () => app.quit() },
  ]));
  tray.on('click', () => openInIsland({}));
}

app.whenReady().then(() => {
  loadSettings();
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  app.setLoginItemSettings({ openAtLogin: !!settings.autostart });
  system = createSystem({ nativeDir, send, settings: S, openExternal: (u) => shell.openExternal(u), openPath: (p) => shell.openPath(p) });
  audio = createAudioStudio({ defaultDir: () => settings.audioDir || path.join(app.getPath('music'), 'Liquid Island'), emit: (d) => send('ey:audio:progress', d), uniquePath });
  protocol.handle('liaudio', (req) => {
    const p = audio.resolvePreview(decodeURIComponent(new URL(req.url).pathname.slice(1)));
    if (!p) return new Response('Not found', { status: 404 });
    return electronNet.fetch(pathToFileURL(p).toString(), { headers: req.headers });   // forwards Range, so seeking works
  });
  createWindow(); createTray(); startWatchers();
  system.applyMonitoring(); system.refreshDisplays();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => system.refreshDisplays());
  const errs = registerAll();
  if (Object.keys(errs).length) console.warn('[shortcuts] could not register:', errs);
});
app.on('second-instance', () => openInIsland({}));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { app.isQuitting = true; share.stop(); if (audio) audio.shutdown(); if (system) system.shutdown(); procs.forEach((p) => { try { p.kill(); } catch {} }); });
app.on('window-all-closed', () => app.quit());
