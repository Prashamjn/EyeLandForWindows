#!/usr/bin/env node
'use strict';
// Liquid Island - Audio Studio verification for REAL Windows (also runs on Linux/macOS).
//
// Uses the PRODUCTION modules (src/audio/*, the same FFmpeg that ships with the app) and MEASURES the decoded output:
// trim accuracy, fade in / fade out, volume, crossfade length and gap, every output format, cancellation, original files untouched.
//
//   node tools/windows/audio-studio-check.js
//
// Output: console summary + diagnostics/audio-studio-<timestamp>.json. Exit code 1 if any check failed.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const ff = require('../../src/audio/ffmpeg');
const { createAudioStudio } = require('../../src/audio');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`); };
const near = (a, b, t) => Math.abs(a - b) <= t;

(async () => {
  const BIN = ff.resolveBinary();
  const env = { platform: process.platform, arch: process.arch, node: process.version, ffmpeg: BIN };
  console.log('Liquid Island Audio Studio check', JSON.stringify(env));
  if (!BIN) { check('FFmpeg is available', false, 'ffmpeg-static is not installed (run npm install)'); return finish(env); }
  const ver = spawnSync(BIN, ['-version'], { encoding: 'utf8' }); env.ffmpegVersion = (ver.stdout || '').split(/\r?\n/)[0];
  check('FFmpeg starts', ver.status === 0, env.ffmpegVersion);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'li-audio-check-')), out = path.join(tmp, 'out');
  const S = createAudioStudio({ defaultDir: () => out });
  const caps = await S.capabilities(); env.formats = caps.formats.map((f) => f.id);
  check('encoders available for MP3, WAV and FLAC (the required formats)', ['mp3', 'wav', 'flac'].every((f) => env.formats.includes(f)), 'available: ' + env.formats.join(', '));
  console.log('INFO  formats this FFmpeg build can write: ' + env.formats.join(', '));

  const gen = (name, secs, f = 440, amp = 0.5) => { const p = path.join(tmp, name), e = `${amp}*sin(2*PI*${f}*t)`; const r = spawnSync(BIN, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=${e}|${e}:s=44100:d=${secs}`, p]); if (r.status) throw new Error(String(r.stderr)); return p; };
  const rms = (file, t, len = 0.4) => { const r = spawnSync(BIN, ['-v', 'error', '-ss', String(t), '-t', String(len), '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 26 }).stdout; let a = 0; const n = r.length / 2; if (!n) return NaN; for (let i = 0; i < n; i++) { const v = r.readInt16LE(i * 2) / 32768; a += v * v; } return Math.sqrt(a / n); };
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const NOM = 0.5 / Math.SQRT2;

  const a = gen('a.wav', 12, 440), b = gen('b.wav', 8, 880), ha = sha(a), hb = sha(b);
  const info = await S.probe(a);
  check('probe: duration and codec', near(info.duration, 12, 0.05) && info.codec === 'pcm_s16le', `${info.duration}s ${info.codec}`);
  const w = await S.waveform(a, 300);
  check('waveform peaks computed', w.peaks.length === 300 && Math.min(...w.peaks) > 100);

  const t1 = await S.exportTrim('chk-trim', { input: a, start: 2, end: 10, fadeIn: { enabled: true, duration: 2 }, fadeOut: { enabled: true, duration: 2 }, output: { format: 'wav' }, name: 'trim', dir: out });
  check('trim: exact length (8 s)', near(t1.duration, 8, 0.03), t1.duration.toFixed(3));
  check('trim: fade in is real (start near silent, 1 s in about half level, middle full)', rms(t1.output, 0, 0.1) < NOM * 0.15 && near(rms(t1.output, 0.8, 0.2), NOM * 0.5, 0.06) && near(rms(t1.output, 4, 0.2), NOM, 0.04), `${rms(t1.output, 0, 0.1).toFixed(3)} / ${rms(t1.output, 0.8, 0.2).toFixed(3)} / ${rms(t1.output, 4, 0.2).toFixed(3)}`);
  check('trim: fade out is real (end near silent)', rms(t1.output, 7.85, 0.1) < NOM * 0.2, rms(t1.output, 7.85, 0.1).toFixed(3));
  check('trim: original file untouched', sha(a) === ha && t1.inputsUntouched);

  for (const f of env.formats) {
    try { const r = await S.exportTrim('chk-' + f, { input: a, start: 1, end: 4, output: { format: f }, name: 'fmt-' + f, dir: out }); const i = await S.probe(r.output); check(`format ${f}: exports and reads back`, near(i.duration, 3, 0.2), `${i.codec} ${i.duration.toFixed(2)}s`); }
    catch (e) { check(`format ${f}: exports and reads back`, false, e.message + ' ' + e.detail); }
  }

  const m1 = await S.exportMerge('chk-xf', { tracks: [{ path: a }, { path: b }], transitions: [{ type: 'crossfade', duration: 4, curve: 'smooth' }], output: { format: 'wav' }, name: 'xf', dir: out });
  check('merge crossfade: length = 12 + 8 - 4 = 16 s', near(m1.duration, 16, 0.05), m1.duration.toFixed(3));
  check('merge crossfade: no silence gap through the overlap', [6.5, 7.5, 8.5, 9.5].every((t) => rms(m1.output, t, 0.3) > NOM * 0.5), [6.5, 7.5, 8.5, 9.5].map((t) => rms(m1.output, t, 0.3).toFixed(3)).join(' '));
  const m2 = await S.exportMerge('chk-fade', { tracks: [{ path: a }, { path: b }], transitions: [{ type: 'fade', duration: 2 }], output: { format: 'mp3', bitrate: 192 }, name: 'fade', dir: out });
  check('merge fade (MP3): length = 20 s, dip at the join', near(m2.duration, 20, 0.25) && rms(m2.output, 11.9, 0.15) < NOM * 0.2, `${m2.duration.toFixed(2)}s dip=${rms(m2.output, 11.9, 0.15).toFixed(3)}`);
  check('merge: originals untouched', sha(a) === ha && sha(b) === hb);

  const big = path.join(tmp, 'big.wav'); spawnSync(BIN, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=300:r=44100:d=1200', '-ac', '2', big], { maxBuffer: 1 << 20 });
  const ev = []; const S2 = createAudioStudio({ defaultDir: () => out, emit: (e) => ev.push(e) });
  const job = S2.exportTrim('chk-cancel', { input: big, start: 0, end: 1200, output: { format: 'flac' }, name: 'cancel', dir: out }).then(() => 'finished', (e) => e.code);
  const t0 = Date.now(); while (!ev.some((e) => e.phase === 'run') && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 25));
  S2.cancel('chk-cancel'); const outcome = await job;
  check('cancel: FFmpeg is stopped and reports "cancelled"', outcome === 'cancelled', outcome);
  check('cancel: no partial or final file left behind', !fs.readdirSync(out).some((f) => /^\..*li-partial|^cancel/.test(f)));
  fs.rmSync(big, { force: true });
  check('output names never overwrite: second export gets "(1)"', (await S.exportTrim('chk-n2', { input: a, start: 0, end: 1, output: { format: 'wav' }, name: 'trim', dir: out })).output.endsWith('trim (1).wav'));

  fs.rmSync(tmp, { recursive: true, force: true });
  finish(env);
})().catch((e) => { check('script ran to completion', false, e.stack || e.message); finish({}); });

function finish(env) {
  const failed = results.filter((r) => !r.pass);
  const dir = path.join(__dirname, '..', '..', 'diagnostics'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `audio-studio-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ env, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Report: ${file}`);
  process.exit(failed.length ? 1 : 0);
}
