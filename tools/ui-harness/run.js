// Test harness: boots the repo's real main.js with an isolated userData dir, then runs a scenario script.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = process.env.LI_ROOT || path.resolve(__dirname, '..', '..'), SCRIPT = process.env.LI_SCRIPT, OUT = process.env.LI_OUT || '/home/claude/shots';
fs.mkdirSync(OUT, { recursive: true });
require(path.join(ROOT, 'main.js'));
const PINNED_UD = app.getPath('userData');   // what main.js itself chose, before the harness redirects it
const ud = process.env.LI_UD || fs.mkdtempSync(path.join(os.tmpdir(), 'li-ud-'));
if (process.env.LI_SETTINGS) fs.writeFileSync(path.join(ud, 'settings.json'), process.env.LI_SETTINGS);
app.setPath('userData', ud);                       // after main.js's own pin: tests never touch real data
const log = (...a) => console.log('[harness]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(1500);
  const wins = () => BrowserWindow.getAllWindows();
  const island = () => wins().find((w) => /renderer[\\/]index\.html/.test(w.webContents.getURL()));
  const ctx = {
    PINNED_UD, appData: app.getPath('appData'), app, ipcMain, wins, island, wait, log, ROOT,
    ev: (code, w = island()) => w.webContents.executeJavaScript(code),
    send: (ch, d, w = island()) => w.webContents.send(ch, d),
    shot: async (name, w = island()) => { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); log('shot', name, JSON.stringify(img.getSize())); },
  };
  try { await require(SCRIPT)(ctx); } catch (e) { console.log('[harness] SCRIPT ERROR', e && e.stack || e); process.exitCode = 1; }
  log('done'); app.exit(process.exitCode || 0);
});
// surface renderer errors
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, level, msg, line, src) => { if (level >= 2) console.log(`[renderer:${level}]`, msg, `(${String(src).split('/').slice(-2).join('/')}:${line})`); });
  wc.on('render-process-gone', (_ev, d) => console.log('[harness] RENDER GONE', d.reason));
});
