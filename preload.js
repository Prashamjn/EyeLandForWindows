const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Every subscription returns an unsubscribe function, so views can clean up and never double-subscribe.
const on = (ch, cb) => { const f = (_e, data) => cb(data); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

/* ---------- island API ---------- */
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSettings: (s) => ipcRenderer.send('settings-save', s),
  setInteractive: (v) => ipcRenderer.send('interactive', !!v),
  setFocusable: (v) => ipcRenderer.send('focusable', !!v),
  setSystem: (target, value) => ipcRenderer.send('system-set', { target: String(target), value: Number(value) || 0 }),
  media: (cmd) => ipcRenderer.send('media-key', String(cmd)),
  copyClip: (text) => ipcRenderer.send('clip-copy', String(text)),
  clearClips: () => ipcRenderer.send('clip-clear'),
  quit: () => ipcRenderer.send('quit'),
  displays: () => ipcRenderer.invoke('ey:displays'),
  onCursor: (cb) => on('cursor', cb),
  onSystem: (cb) => on('system', cb),
  onMedia: (cb) => on('media', cb),
  onClips: (cb) => on('clips', cb),
  onSettings: (cb) => on('settings', cb),
  onOpenPanel: (cb) => on('open-panel', cb),          // { view?, plugin?, payload?, cc? }
  onToast: (cb) => on('toast', cb),
  onCoffee: (cb) => on('coffee', cb),
  catalog: () => ipcRenderer.invoke('ey:catalog'),
  run: (id) => ipcRenderer.invoke('ey:run', String(id)),
});

/* ---------- Control Centre: a fixed list of operations; arguments are validated again in the main process ---------- */
const CC_OPS = new Set([
  'state.all', 'audio.setVolume', 'audio.setMute', 'audio.setOutput', 'mic.setMute', 'bri.set',
  'wifi.scan', 'wifi.setPower', 'wifi.connect', 'wifi.disconnect',
  'bt.setPower', 'bt.scan', 'bt.stopScan', 'bt.connect', 'bt.disconnect', 'bt.pair',
  'power.setMode', 'vpn.openApp', 'night.openSettings', 'display.openSettings', 'settings.open',
]);
contextBridge.exposeInMainWorld('cc', {
  call: (op, arg) => (CC_OPS.has(op) ? ipcRenderer.invoke('cc:call', op, arg) : Promise.resolve({ ok: false, code: 'invalid', error: 'Unknown operation' })),
  onEvent: (cb) => on('cc:event', cb),
});

/* ---------- plugin pages and the screen overlays ----------
   Plugin pages need many "ey:*" channels (files, convert, print, ...). They are all handled in main.js; anything outside the
   ey:/ov: namespaces, or any channel that is not a plain name, is refused here instead of being forwarded. */
const OK_CH = /^(ey|ov):[A-Za-z0-9:_-]+$/;
const INVOKE_EXTRA = new Set(['settings-get']);
const SEND_EXTRA = new Set(['settings-save']);
const ON_EXTRA = new Set(['coffee']);
const refuse = (ch) => new Error('Blocked channel: ' + ch);
contextBridge.exposeInMainWorld('eyeland', {
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  invoke: (ch, ...a) => (OK_CH.test(ch) || INVOKE_EXTRA.has(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(refuse(ch))),
  send: (ch, ...a) => { if (OK_CH.test(ch) || SEND_EXTRA.has(ch)) ipcRenderer.send(ch, ...a); },
  on: (ch, cb) => (OK_CH.test(ch) || ON_EXTRA.has(ch) ? on(ch, cb) : () => {}),
});
