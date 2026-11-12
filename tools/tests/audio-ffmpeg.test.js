'use strict';
// Real-FFmpeg integration tests for Audio Studio (Linux sandbox / CI). They generate audio, run the real service and then
// MEASURE the decoded output (duration, loudness over time, gaps), so they prove the processing, not just the exit code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ff = require('../../src/audio/ffmpeg.js');
const { createAudioStudio } = require('../../src/audio/index.js');

const BIN = ff.resolveBinary();
const skip = BIN ? false : 'no ffmpeg available';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'li-audio-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// exact-amplitude sine (lavfi `sine` has a fixed low level): amp is the peak amplitude, 1 = full scale
const gen = (name, secs, { f = 440, amp = 0.5, ch = 2, rate = 44100 } = {}) => {
  const p = path.join(tmp, name);
  const e = `${amp}*sin(2*PI*${f}*t)`;
  const r = spawnSync(BIN, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=${ch === 1 ? e : e + '|' + e}:s=${rate}:d=${secs}`, p]);
  assert.equal(r.status, 0, String(r.stderr)); return p;
};
// decode to mono 8 kHz and return RMS per 50 ms window (0..1)
const rmsWindows = (file, win = 0.05) => {
  const r = spawnSync(BIN, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const b = r.stdout, n = Math.floor(b.length / 2), per = Math.round(8000 * win), out = [];
  for (let s = 0; s + per <= n; s += per) { let a = 0; for (let i = 0; i < per; i++) { const v = b.readInt16LE((s + i) * 2) / 32768; a += v * v; } out.push(Math.sqrt(a / per)); }
  return out;
};
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mk = (events = []) => createAudioStudio({ defaultDir: () => path.join(tmp, 'out'), emit: (e) => events.push(e) });
const SINE_RMS = 0.5 / Math.SQRT2;   // rms of a 0.5-amplitude sine
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m || ''} expected ${b} +-${t}, got ${a}`);

test('inspect: duration, codec, tags; wav and mp3', { skip }, async () => {
  const a = gen('tone10.wav', 10);
  const mp3 = path.join(tmp, 'tagged.mp3');
  spawnSync(BIN, ['-y', '-v', 'error', '-i', a, '-metadata', 'title=Test Song', '-metadata', 'artist=Someone', '-b:a', '128k', mp3]);
  const S = mk(); const w = await S.probe(a), m = await S.probe(mp3);
  near(w.duration, 10, 0.05); assert.equal(w.codec, 'pcm_s16le'); assert.equal(w.sampleRate, 44100);
  near(m.duration, 10, 0.2); assert.equal(m.tags.title, 'Test Song'); assert.equal(m.tags.artist, 'Someone'); assert.ok(m.size > 0 && m.id.length === 16);
});
test('inspect: rejects missing, empty, non-audio, relative and NUL paths with clear codes', { skip }, async () => {
  const S = mk(); const txt = path.join(tmp, 'x.txt'); fs.writeFileSync(txt, 'hello world, not audio'); const empty = path.join(tmp, 'e.mp3'); fs.writeFileSync(empty, '');
  await assert.rejects(S.probe(path.join(tmp, 'nope.mp3')), { code: 'not-found' });
  await assert.rejects(S.probe(empty), { code: 'bad-input' });
  await assert.rejects(S.probe(txt), (e) => ['bad-input', 'no-audio'].includes(e.code));
  await assert.rejects(S.probe('relative.mp3'), { code: 'invalid' });
  await assert.rejects(S.probe('/tmp/a\0b'), { code: 'invalid' });
  await assert.rejects(S.probe(tmp), { code: 'invalid' });
});
test('waveform peaks: right length, silence is flat, a tone is loud', { skip }, async () => {
  const S = mk(); const tone = gen('w.wav', 4, { amp: 0.8 });
  const r = await S.waveform(tone, 200);
  assert.equal(r.peaks.length, 200); assert.ok(Math.min(...r.peaks) > 150, 'a full-scale-ish tone everywhere');
  const sil = path.join(tmp, 'sil.wav'); spawnSync(BIN, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', sil]);
  assert.ok(Math.max(...(await S.waveform(sil, 100)).peaks) <= 1);
});

test('trim: accurate start/end (not keyframe-bound), original untouched', { skip }, async () => {
  const src = gen('t1.wav', 20), before = sha(src), S = mk();
  const r = await S.exportTrim('j1', { input: src, start: 3.25, end: 9.75, fadeIn: { enabled: false }, fadeOut: { enabled: false }, output: { format: 'wav' }, name: 'trim1' });
  near(r.duration, 6.5, 0.02, 'duration'); assert.ok(r.inputsUntouched); assert.equal(sha(src), before);
  assert.notEqual(path.resolve(r.output), path.resolve(src));
  const w = rmsWindows(r.output); near(w[10], SINE_RMS, 0.03); near(w[w.length - 2], SINE_RMS, 0.03);
});
test('trim: fade in and fade out are real (measured), and combine', { skip }, async () => {
  const src = gen('t2.wav', 20), S = mk();
  const r = await S.exportTrim('j2', { input: src, start: 2, end: 12, fadeIn: { enabled: true, duration: 3 }, fadeOut: { enabled: true, duration: 3 }, output: { format: 'wav' }, name: 'fades' });
  const w = rmsWindows(r.output); const at = (s) => w[Math.min(w.length - 1, Math.round(s / 0.05))];
  assert.ok(at(0.1) < SINE_RMS * 0.15, 'starts near silence'); near(at(1.5), SINE_RMS * 0.5, 0.05, 'half way up the fade-in');
  near(at(5), SINE_RMS, 0.03, 'full level in the middle'); near(at(8.5), SINE_RMS * 0.5, 0.05, 'half way down'); assert.ok(at(9.9) < SINE_RMS * 0.15, 'ends near silence');
});
test('trim: only fade out leaves the start at full level', { skip }, async () => {
  const src = gen('t3.wav', 8), S = mk();
  const r = await S.exportTrim('j3', { input: src, start: 0, end: 8, fadeIn: { enabled: false }, fadeOut: { enabled: true, duration: 2 }, output: { format: 'wav' }, name: 'fo' });
  const w = rmsWindows(r.output); near(w[2], SINE_RMS, 0.03); assert.ok(w[w.length - 2] < SINE_RMS * 0.3);
});
test('trim: every output format this FFmpeg can write exports, probes and has the right codec', { skip }, async () => {
  const S = mk(); const src = gen('t4.wav', 5); const caps = await S.capabilities();
  assert.equal(caps.available, true); const ids = caps.formats.map((f) => f.id);
  for (const need of ['mp3', 'wav', 'flac']) assert.ok(ids.includes(need), need + ' available');
  const codec = { mp3: 'mp3', m4a: 'aac', ogg: 'vorbis', opus: 'opus', flac: 'flac', wav: 'pcm_s16le' };
  for (const f of ids) {
    const r = await S.exportTrim('fmt-' + f, { input: src, start: 1, end: 3.5, fadeIn: { enabled: true, duration: 0.5 }, fadeOut: { enabled: false }, output: { format: f }, name: 'fmt-' + f });
    const info = await S.probe(r.output);
    assert.equal(info.codec, codec[f], f); near(info.duration, 2.5, 0.15, f); assert.ok(r.output.endsWith('.' + (f === 'm4a' ? 'm4a' : f)), f);
  }
});
test('trim: bitrate is honoured for MP3; WAV 24-bit', { skip }, async () => {
  const S = mk(); const src = gen('t5.wav', 6);
  const lo = await S.exportTrim('b1', { input: src, start: 0, end: 6, output: { format: 'mp3', bitrate: 128 }, name: 'lo' });
  const hi = await S.exportTrim('b2', { input: src, start: 0, end: 6, output: { format: 'mp3', bitrate: 320 }, name: 'hi' });
  assert.ok(hi.size > lo.size * 1.8, `320k (${hi.size}) should be much larger than 128k (${lo.size})`);
  const w24 = await S.exportTrim('b3', { input: src, start: 0, end: 2, output: { format: 'wav', bitDepth: 24 }, name: 'w24' });
  assert.equal((await S.probe(w24.output)).codec, 'pcm_s24le');
});
test('output safety: never overwrites, never writes over an input, rejects bad names, cleans partials', { skip }, async () => {
  const S = mk(); const src = gen('t6.wav', 3); const dir = path.join(tmp, 'safe');
  const a = await S.exportTrim('s1', { input: src, start: 0, end: 2, output: { format: 'wav' }, name: 'same', dir });
  const b = await S.exportTrim('s2', { input: src, start: 0, end: 2, output: { format: 'wav' }, name: 'same', dir });
  assert.notEqual(a.output, b.output); assert.match(path.basename(b.output), /^same \(1\)\.wav$/);
  const before = sha(src);
  const c = await S.exportTrim('s3', { input: src, start: 0, end: 2, output: { format: 'wav' }, name: 't6', dir: tmp });
  assert.notEqual(path.resolve(c.output), path.resolve(src)); assert.equal(sha(src), before, 'input bytes unchanged');
  for (const bad of ['a/b', 'a\\b', 'x:y', 'con', 'what?', 'tail.']) await assert.rejects(S.exportTrim('s4', { input: src, start: 0, end: 1, output: { format: 'wav' }, name: bad, dir }), { code: 'invalid' }, bad);
  await assert.rejects(S.exportTrim('s5', { input: src, start: 0, end: 1, output: { format: 'wav' }, name: 'ok', dir: 'relative/dir' }), { code: 'invalid' });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('li-partial')), [], 'no partial files left');
});
test('trim: invalid requests are rejected before FFmpeg runs', { skip }, async () => {
  const S = mk(); const src = gen('t7.wav', 5);
  await assert.rejects(S.exportTrim('v1', { input: src, start: 4, end: 2, output: { format: 'wav' }, name: 'x' }), { code: 'invalid' });
  await assert.rejects(S.exportTrim('v2', { input: src, start: 0, end: 4, fadeIn: { enabled: true, duration: 3 }, fadeOut: { enabled: true, duration: 3 }, output: { format: 'wav' }, name: 'x' }), { code: 'invalid' });
  await assert.rejects(S.exportTrim('v3', { input: src, start: 0, end: 4, output: { format: 'exe' }, name: 'x' }), { code: 'invalid' });
});

test('cancel: kills FFmpeg, removes the partial file, reports cancelled, and a new job can start', { skip }, async () => {
  const big = path.join(tmp, 'big.wav');
  spawnSync(BIN, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=300:r=44100:d=5400', '-ac', '2', big], { maxBuffer: 1 << 20 });
  const ev = []; const S = mk(ev); const dir = path.join(tmp, 'cancel');
  const p = S.exportTrim('c1', { input: big, start: 0, end: 5400, output: { format: 'flac' }, name: 'big', dir });
  const t0 = Date.now(); while (!ev.some((e) => e.phase === 'run') && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 25));
  assert.ok(S.busy()); assert.ok(S.cancel('c1'));
  await assert.rejects(p, { code: 'cancelled' });
  assert.equal(S.busy(), false); assert.ok(ev.some((e) => e.phase === 'cancelled'));
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], 'neither partial nor final file remains');
  assert.equal(S.cancel('c1'), false, 'cancelling again is harmless');
  const ok = await S.exportTrim('c2', { input: gen('after.wav', 2), start: 0, end: 1, output: { format: 'wav' }, name: 'after', dir });
  assert.ok(fs.existsSync(ok.output));
});
test('only one export at a time', { skip }, async () => {
  const big = path.join(tmp, 'big.wav'); const S = mk(); const dir = path.join(tmp, 'busy');
  const first = S.exportTrim('k1', { input: big, start: 0, end: 5400, output: { format: 'flac' }, name: 'a', dir });
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(S.exportTrim('k2', { input: big, start: 0, end: 10, output: { format: 'wav' }, name: 'b', dir }), { code: 'busy' });
  S.cancel('k1'); await assert.rejects(first, { code: 'cancelled' });
});
test('progress events are monotonic and end in done', { skip }, async () => {
  const ev = []; const S = mk(ev); const src = gen('prog.wav', 60);
  await S.exportTrim('p1', { input: src, start: 0, end: 60, output: { format: 'mp3', bitrate: 320 }, name: 'prog' });
  const pc = ev.filter((e) => e.phase === 'run').map((e) => e.percent);
  assert.ok(pc.every((v, i) => i === 0 || v >= pc[i - 1]), 'monotonic'); assert.equal(ev[ev.length - 1].phase, 'done'); assert.equal(ev[ev.length - 1].percent, 100);
});

/* ---------------- merger ---------------- */
const mergeReq = (tracks, transitions, extra = {}) => ({ tracks, transitions, output: { format: 'wav' }, name: 'mix', dir: path.join(tmp, 'mix'), ...extra });
test('merge none: total = sum, both tones present, joined without a gap', { skip }, async () => {
  const a = gen('m1.wav', 5, { f: 440 }), b = gen('m2.wav', 4, { f: 880 }), S = mk();
  const r = await S.exportMerge('m1', mergeReq([{ path: a }, { path: b }], [{ type: 'none' }]));
  near(r.duration, 9, 0.03); const w = rmsWindows(r.output);
  assert.ok(Math.min(...w.slice(2, -2)) > SINE_RMS * 0.9, 'no silence anywhere (no gap, no dip)');
});
test('merge fade: dip at the join, total = sum (no overlap)', { skip }, async () => {
  const a = gen('f1.wav', 8), b = gen('f2.wav', 8), S = mk();
  const r = await S.exportMerge('m2', mergeReq([{ path: a }, { path: b }], [{ type: 'fade', duration: 2 }]));
  near(r.duration, 16, 0.03); const w = rmsWindows(r.output); const at = (s) => w[Math.round(s / 0.05)];
  assert.ok(at(7.98) < SINE_RMS * 0.1 && at(8.05) < SINE_RMS * 0.1, 'silent exactly at the join'); near(at(4), SINE_RMS, 0.03); near(at(12), SINE_RMS, 0.03);
  near(at(7), SINE_RMS * 0.5, 0.06, 'half way down at 1 s before the join'); near(at(9), SINE_RMS * 0.5, 0.06, 'half way up 1 s after');
});
test('merge fade chain: the SECOND fade lands at the second join (reference-script bug regression)', { skip }, async () => {
  const t = ['c1', 'c2', 'c3'].map((n) => gen(n + '.wav', 10)), S = mk();
  const r = await S.exportMerge('m3', mergeReq(t.map((p) => ({ path: p })), [{ type: 'fade', duration: 2 }, { type: 'fade', duration: 2 }]));
  near(r.duration, 30, 0.04); const w = rmsWindows(r.output); const at = (s) => w[Math.round(s / 0.05)];
  assert.ok(at(9.98) < SINE_RMS * 0.1 && at(19.98) < SINE_RMS * 0.1, 'dips exactly at 10 s and 20 s');
  near(at(15), SINE_RMS, 0.03, 'middle of track 2 is untouched'); near(at(5), SINE_RMS, 0.03); near(at(25), SINE_RMS, 0.03);
});
test('merge crossfade: length = a + b - d, no silence gap, no clipping, both tones audible in the overlap', { skip }, async () => {
  const a = gen('x1.wav', 10, { f: 440, amp: 0.8 }), b = gen('x2.wav', 10, { f: 1000, amp: 0.8 }), S = mk();
  for (const curve of ['linear', 'smooth']) {
    const r = await S.exportMerge('m4' + curve, mergeReq([{ path: a }, { path: b }], [{ type: 'crossfade', duration: 4, curve }], { name: 'xf-' + curve }));
    near(r.duration, 16, 0.04, curve); const w = rmsWindows(r.output); const nom = 0.8 / Math.SQRT2;
    const region = w.slice(Math.round(6.4 / 0.05), Math.round(9.6 / 0.05));
    assert.ok(Math.min(...region) > nom * 0.5, `${curve}: no gap or deep hole in the overlap (min ${Math.min(...region).toFixed(3)})`);
    assert.ok(Math.max(...w) < 0.98 / Math.SQRT2 * 1.45 + 0.01, `${curve}: loudness bounded`);
    // peak (sample) check: never above full scale thanks to the limiter
    const pcm = spawnSync(BIN, ['-v', 'error', '-i', r.output, '-ac', '1', '-f', 's16le', '-'], { maxBuffer: 1 << 28 }).stdout; let pk = 0; for (let i = 0; i < pcm.length; i += 2) pk = Math.max(pk, Math.abs(pcm.readInt16LE(i)));
    assert.ok(pk <= 32767 * 0.98, `${curve}: peak ${pk} <= 0.97 FS (limiter)`);
  }
});
test('merge: per-track volume, trim and fade-in/out are all reflected', { skip }, async () => {
  const a = gen('v1.wav', 10, { amp: 0.8 }), b = gen('v2.wav', 10, { amp: 0.8 }), S = mk();
  const r = await S.exportMerge('m5', mergeReq([{ path: a, volume: 0.5, start: 2, end: 8 }, { path: b, volume: 1, start: 0, end: 5, fadeOut: 2 }], [{ type: 'none' }]));
  near(r.duration, 11, 0.04); const w = rmsWindows(r.output); const full = 0.8 / Math.SQRT2;
  near(w[Math.round(3 / 0.05)], full * 0.5, 0.03, 'track 1 at 50%'); near(w[Math.round(8 / 0.05)], full, 0.04, 'track 2 at 100%'); assert.ok(w[w.length - 2] < full * 0.2, 'track 2 fades out at the very end');
});
test('merge: gain above 100% is limited, not clipped', { skip }, async () => {
  const a = gen('g1.wav', 3, { amp: 0.9 }), b = gen('g2.wav', 3, { amp: 0.9 }), S = mk();
  const r = await S.exportMerge('m6', mergeReq([{ path: a, volume: 2 }, { path: b, volume: 2 }], [{ type: 'none' }]));
  const pcm = spawnSync(BIN, ['-v', 'error', '-i', r.output, '-ac', '1', '-f', 's16le', '-'], { maxBuffer: 1 << 26 }).stdout; let pk = 0; for (let i = 0; i < pcm.length; i += 2) pk = Math.max(pk, Math.abs(pcm.readInt16LE(i)));
  assert.ok(pk <= 32767 * 0.98, 'peak ' + pk);
});
test('merge: mixed formats / sample rates / mono + stereo join cleanly; 4 tracks; inputs untouched', { skip }, async () => {
  const p = [gen('z1.wav', 3, { rate: 22050, ch: 1 }), gen('z2.wav', 3, { rate: 48000 }), gen('z3.wav', 3, { rate: 44100 }), gen('z4.wav', 3, { rate: 16000, ch: 1 })];
  const mp3 = path.join(tmp, 'z3.mp3'); spawnSync(BIN, ['-y', '-v', 'error', '-i', p[2], mp3]); p[2] = mp3;
  const hashes = p.map(sha), S = mk();
  const r = await S.exportMerge('m7', mergeReq(p.map((x) => ({ path: x })), [{ type: 'none' }, { type: 'crossfade', duration: 1 }, { type: 'fade', duration: 1 }], { output: { format: 'flac' } }));
  near(r.duration, 11, 0.1); assert.deepEqual(p.map(sha), hashes); assert.ok(r.inputsUntouched);
  const info = await S.probe(r.output); assert.equal(info.sampleRate, 44100); assert.match(info.channels, /stereo/);
});
test('merge: invalid input is rejected with the exact reason', { skip }, async () => {
  const a = gen('i1.wav', 5), b = gen('i2.wav', 5), S = mk();
  await assert.rejects(S.exportMerge('e1', mergeReq([{ path: a }], [])), { code: 'invalid' });
  await assert.rejects(S.exportMerge('e2', mergeReq([{ path: a }, { path: b }], [{ type: 'crossfade', duration: 6 }])), (e) => e.code === 'invalid' && /longer than/.test(e.message));
  await assert.rejects(S.exportMerge('e3', mergeReq([{ path: a }, { path: path.join(tmp, 'gone.wav') }], [{ type: 'none' }])), { code: 'not-found' });
  assert.equal(S.busy(), false);
});
test('missing FFmpeg is reported, not thrown as a crash', async () => {
  const old = ff.resolveBinary(); ff.setBinary('/definitely/not/ffmpeg'); ff.resetCaches();
  try { const S = mk(); const c = await S.capabilities(); assert.equal(c.available, false); await assert.rejects(S.probe(path.join(tmp, 'x.txt')), (e) => ['no-ffmpeg', 'not-found'].includes(e.code)); }
  finally { ff.setBinary(null); ff.resetCaches(); }
});
test('error explanations map FFmpeg messages to actionable codes', () => {
  assert.equal(ff.explain('x: Permission denied', 1).code, 'permission'); assert.equal(ff.explain('No space left on device', 1).code, 'disk-full');
  assert.equal(ff.explain('Invalid data found when processing input', 1).code, 'bad-input'); assert.equal(ff.explain('whatever', 1).code, 'ffmpeg');
});
