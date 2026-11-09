// Manages one long-running native helper (PowerShell host speaking JSON lines; see native/cs/LiIO.cs).
//  - started lazily, one process per domain, so a failing helper never takes anything else down
//  - request() resolves with the reply data or rejects with an Error that has .code
//  - unexpected exits restart with backoff; after repeated crashes it stays down and reports "failed"
//  - the request id travels as "rid" (commands have their own "id" arguments, e.g. a device id)
//  - requests are never logged (they can contain a Wi-Fi password)
// For tests, LI_NATIVE_MOCK=<dir> runs <dir>/<name>.js under Node instead of PowerShell (same protocol).
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');

class Helper extends EventEmitter {
  constructor({ name, file, nativeDir, mockDir }) {
    super();
    Object.assign(this, { name, file, nativeDir, mockDir });
    this.proc = null; this.wanted = false; this.ready = false; this.nextId = 1; this.pending = new Map();
    this.crashes = []; this.failed = false; this.restartT = 0; this.buf = '';
  }
  get supported() { return !!this.mockDir || process.platform === 'win32'; }
  get running() { return !!this.proc; }

  start() {
    this.wanted = true;
    if (this.proc || this.failed || !this.supported) return;
    let cmd, args, env = process.env;
    if (this.mockDir) { cmd = process.execPath; args = [path.join(this.mockDir, this.name + '.js')]; env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; }
    else {
      cmd = 'powershell.exe';
      args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.nativeDir, this.file)];
    }
    const p = spawn(cmd, args, { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p; this.ready = false; this.buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => this._data(String(d)));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => console.error(`[native:${this.name}]`, String(d).trim().slice(0, 400)));
    p.stdin.on('error', () => {});
    p.on('error', (e) => { console.error(`[native:${this.name}] could not start:`, e.message); });
    p.on('exit', (code) => this._exit(p, code));
  }
  _data(chunk) {
    this.buf += chunk; let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.ev === 'ready') { this.ready = true; this.emit('up'); continue; }
      if (m.ev) { this.emit('event', m.ev, m.data); continue; }
      const q = this.pending.get(m.rid); if (!q) continue;
      this.pending.delete(m.rid); clearTimeout(q.t);
      if (m.ok) q.res(m.data); else q.rej(Object.assign(new Error(m.error || 'Failed'), { code: m.code || 'failed', detail: m.detail }));
    }
  }
  _exit(p, code) {
    if (this.proc !== p) return;
    this.proc = null; this.ready = false;
    for (const [, q] of this.pending) { clearTimeout(q.t); q.rej(Object.assign(new Error('The helper stopped'), { code: 'exited' })); }
    this.pending.clear();
    this.emit('down');
    if (!this.wanted) return;
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 120000).concat(now);
    if (this.crashes.length >= 5) { this.failed = true; console.error(`[native:${this.name}] giving up after repeated crashes (exit ${code})`); this.emit('failed'); return; }
    this.restartT = setTimeout(() => this.start(), Math.min(30000, 1500 * 2 ** (this.crashes.length - 1)));
  }
  request(cmd, args = {}, timeout = 20000) {
    if (!this.supported) return Promise.reject(Object.assign(new Error('This feature needs Windows.'), { code: 'unsupported' }));
    if (this.failed) return Promise.reject(Object.assign(new Error('This feature is not available right now.'), { code: 'failed' }));
    this.start();
    return new Promise((res, rej) => {
      const id = this.nextId++;
      const t = setTimeout(() => { this.pending.delete(id); rej(Object.assign(new Error('Windows did not respond in time.'), { code: 'timeout' })); }, timeout);
      this.pending.set(id, { res, rej, t });
      try { this.proc.stdin.write(JSON.stringify({ ...args, rid: id, cmd }) + '\n'); } catch (e) { clearTimeout(t); this.pending.delete(id); rej(Object.assign(new Error('The helper is not running'), { code: 'exited' })); }
    });
  }
  stop() {
    this.wanted = false; clearTimeout(this.restartT);
    if (this.proc) { try { this.proc.stdin.end(); } catch {} const p = this.proc; setTimeout(() => { try { p.kill(); } catch {} }, 800); }
  }
}
module.exports = { Helper };
