'use strict';
// Thin, safe FFmpeg layer for Audio Studio. Every process is started with an ARGUMENT ARRAY (never through a shell).
// ffprobe is not shipped by ffmpeg-static, so inspection uses ffmpeg itself: `-i` for stream info, `-f ffmetadata` for tags,
// and a decode to raw PCM for waveform peaks. Nothing here touches the renderer.
const { spawn } = require('child_process');
const path = require('path');
const { unpacked } = require('../util');

let override = null;
function resolveBinary() {
  if (override) return override;
  if (process.env.LI_FFMPEG) return process.env.LI_FFMPEG;
  try { const p = require('ffmpeg-static'); if (p) return unpacked(p); } catch { /* not installed */ }
  return null;
}
const setBinary = (p) => { override = p; };

class AudioError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail || ''; }
}

// run ffmpeg and collect output. `signal` is an AbortSignal; aborting kills the process and rejects with code 'cancelled'.
function exec(args, { signal, onStdout, onStderr, collectStdout = false, maxStdout = 8 * 1024 * 1024 } = {}) {
  const bin = resolveBinary();
  if (!bin) return Promise.reject(new AudioError('no-ffmpeg', 'FFmpeg is not available. Reinstall Liquid Island or run npm install.'));
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return reject(new AudioError('no-ffmpeg', 'FFmpeg could not be started.', e.message)); }
    let err = '', out = '', cancelled = false, settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; if (signal) signal.removeEventListener('abort', onAbort); fn(v); };
    const onAbort = () => { cancelled = true; try { p.kill('SIGKILL'); } catch { /* already gone */ } };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    p.stdout.on('data', (d) => { if (onStdout) onStdout(d); if (collectStdout && out.length < maxStdout) out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { const s = d.toString('utf8'); err = (err + s).slice(-6000); if (onStderr) onStderr(s); });
    p.on('error', (e) => done(reject, new AudioError(e.code === 'ENOENT' ? 'no-ffmpeg' : 'spawn', e.code === 'ENOENT' ? 'FFmpeg was not found.' : 'FFmpeg could not be started.', e.message)));
    p.on('close', (code) => {
      if (cancelled) return done(reject, new AudioError('cancelled', 'Cancelled'));
      if (code === 0) return done(resolve, { stdout: out, stderr: err });
      done(reject, explain(err, code));
    });
  });
}

// turn FFmpeg's last words into something a person can act on; the raw tail is kept in `detail`
function explain(stderr, code) {
  const lines = String(stderr).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || `FFmpeg exited with code ${code}`;
  const t = stderr;
  let c = 'ffmpeg', m = 'FFmpeg could not process this audio.';
  if (/No such file or directory/i.test(t)) { c = 'not-found'; m = 'A file could not be found.'; }
  else if (/Permission denied|Access is denied/i.test(t)) { c = 'permission'; m = 'Windows denied access to the file or folder.'; }
  else if (/No space left|not enough space/i.test(t)) { c = 'disk-full'; m = 'There is not enough free disk space.'; }
  else if (/Invalid data found|could not find codec parameters|moov atom not found|does not contain any stream/i.test(t)) { c = 'bad-input'; m = 'This file could not be read as audio. It may be damaged or not an audio file.'; }
  else if (/Unknown encoder|Encoder .* not found|Unrecognized option|Codec not currently supported/i.test(t)) { c = 'no-encoder'; m = 'This FFmpeg build cannot write the chosen format.'; }
  else if (/Output file does not contain any stream|matches no streams|Stream map .* matches no streams/i.test(t)) { c = 'no-audio'; m = 'The file has no audio stream.'; }
  else if (/Invalid argument|Error (initializing|reinitializing) filter|Error parsing filter|Invalid filtergraph/i.test(t)) { c = 'filter'; m = 'The audio settings were rejected by FFmpeg.'; }
  return new AudioError(c, m, last);
}

/* ---------- inspection ---------- */
const hms = (h, m, s) => (+h) * 3600 + (+m) * 60 + parseFloat(s);
function parseInfo(stderr) {
  const info = { duration: 0, bitrate: 0, codec: '', sampleRate: 0, channels: '', hasAudio: false, hasArtwork: false, container: '' };
  const c = /^Input #0, ([^,]+(?:,[^,\s]+)*?), from /m.exec(stderr);
  if (c) info.container = c[1].split(',')[0];
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  if (d) info.duration = hms(d[1], d[2], d[3]);
  const b = /bitrate:\s*(\d+)\s*kb\/s/.exec(stderr);
  if (b) info.bitrate = +b[1];
  const a = /Stream #0:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: ([^,\s(]+)[^,]*, (\d+) Hz, ([^,]+)/.exec(stderr);
  if (a) { info.hasAudio = true; info.codec = a[1]; info.sampleRate = +a[2]; info.channels = a[3].trim(); }
  info.hasArtwork = /Stream #0:\d+.*: Video: .*\(attached pic\)/.test(stderr);
  return info;
}
// -f ffmetadata output: "key=value" lines with backslash escapes; keys are case-insensitive
function parseTags(text) {
  const tags = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith(';') || line.startsWith('[')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).toLowerCase(), v = line.slice(i + 1).replace(/\\(.)/g, '$1').trim();
    if (v && !(k in tags)) tags[k] = v.slice(0, 300);
  }
  return tags;
}

async function inspect(file, { signal } = {}) {
  let info, tags = {};
  try {
    const r = await exec(['-hide_banner', '-nostdin', '-i', file, '-map_metadata', '0', '-f', 'ffmetadata', '-'], { signal, collectStdout: true });
    info = parseInfo(r.stderr); tags = parseTags(r.stdout);
  } catch (e) {
    if (e.code === 'cancelled' || e.code === 'no-ffmpeg') throw e;
    // `-i` with no output exits non-zero but still prints the stream info: try that before giving up
    let text = '';
    try { await exec(['-hide_banner', '-nostdin', '-i', file], { signal, onStderr: (s) => { text += s; } }); } catch { /* expected */ }
    info = parseInfo(text);
    if (!info.hasAudio) throw e.code === 'bad-input' || e.code === 'no-audio' ? e : new AudioError('bad-input', 'This file could not be read as audio.', e.detail);
  }
  if (!info.hasAudio) throw new AudioError('no-audio', 'The file has no audio stream.');
  if (!(info.duration > 0)) info.duration = await measure(file, { signal });         // some streams do not state a duration: decode once to measure
  return { ...info, tags };
}

// decode to null and read the final timestamp (only used when the container has no duration)
async function measure(file, { signal } = {}) {
  let last = 0;
  await exec(['-hide_banner', '-nostdin', '-i', file, '-vn', '-f', 'null', '-', '-progress', 'pipe:1', '-nostats'], {
    signal, onStdout: (d) => { for (const m of d.toString().matchAll(/out_time_us=(\d+)/g)) last = Math.max(last, +m[1] / 1e6); },
  });
  return last;
}

// Waveform: decode to mono 8 kHz signed 16-bit PCM and keep the loudest sample of each bucket (streaming: constant memory).
async function peaks(file, buckets, duration, { signal } = {}) {
  const n = Math.max(16, Math.min(4000, Math.floor(buckets) || 600));
  const rate = 8000, total = Math.max(1, Math.floor(duration * rate));
  const per = total / n, out = new Uint8Array(n);
  let idx = 0, carry = null;
  await exec(['-hide_banner', '-nostdin', '-i', file, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-acodec', 'pcm_s16le', '-'], {
    signal,
    onStdout: (buf) => {
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      const len = buf.length - (buf.length % 2);
      if (len !== buf.length) carry = buf.subarray(len);
      for (let o = 0; o < len; o += 2) {
        const v = Math.abs(buf.readInt16LE(o)), b = Math.min(n - 1, Math.floor(idx / per));
        const q = Math.min(255, Math.round((v / 32768) * 255));
        if (q > out[b]) out[b] = q;
        idx++;
      }
    },
  });
  return Array.from(out);
}

// which output encoders this FFmpeg build really has (cached)
let encoderCache = null;
async function encoders() {
  if (encoderCache) return encoderCache;
  const r = await exec(['-hide_banner', '-encoders'], { collectStdout: true });
  const set = new Set();
  for (const l of r.stdout.split(/\r?\n/)) { const m = /^\s[A-Z.]{6}\s(\S+)/.exec(l); if (m) set.add(m[1]); }
  return (encoderCache = set);
}
const resetCaches = () => { encoderCache = null; };

// run an export. Parses `-progress pipe:1`; `expected` is the output duration in seconds.
function render(args, { expected, signal, onProgress } = {}) {
  let buf = '';
  return exec(args, {
    signal,
    onStdout: (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m && expected > 0 && onProgress) onProgress(Math.max(0, Math.min(99, (+m[1] / 1e6 / expected) * 100)));
      }
    },
  });
}

module.exports = { AudioError, exec, render, inspect, peaks, encoders, resolveBinary, setBinary, resetCaches, parseInfo, parseTags, explain };
