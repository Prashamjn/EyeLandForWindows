'use strict';
// Pure-logic tests for Audio Studio: time parsing, validation, timeline layout, filter graph. No processes.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../shared/audio/timecode.js');
const P = require('../../shared/audio/plan.js');

test('parseTime accepts seconds, MM:SS and HH:MM:SS and rejects nonsense', () => {
  assert.equal(T.parseTime('75'), 75); assert.equal(T.parseTime('75.5'), 75.5);
  assert.equal(T.parseTime('2:30'), 150); assert.equal(T.parseTime('2:30.25'), 150.25);
  assert.equal(T.parseTime('1:02:03'), 3723); assert.equal(T.parseTime('01:02:03.5'), 3723.5);
  assert.equal(T.parseTime('90:00'), 5400, 'MM:SS may exceed 59 minutes');
  for (const bad of ['', ' ', 'abc', '1:75', '1:75:00', '-5', '1:2:3:4', '1::2', '1e3', null, undefined, NaN, -1]) assert.equal(T.parseTime(bad), null, String(bad));
});
test('formatTime and ffNum', () => {
  assert.equal(T.formatTime(65), '1:05'); assert.equal(T.formatTime(3725.5, 1), '1:02:05.5'); assert.equal(T.formatTime(5.256, 2), '0:05.26');
  assert.equal(T.ffNum(1e-7), '0'); assert.equal(T.ffNum(2.5), '2.5'); assert.equal(T.ffNum(10), '10'); assert.equal(T.ffNum(0.1 + 0.2), '0.3');
});

const base = { duration: 60, start: 10, end: 40, fadeIn: { enabled: false, duration: 0 }, fadeOut: { enabled: false, duration: 0 }, output: { format: 'mp3', bitrate: 192 } };
const withFade = (o) => ({ ...base, ...o });

test('trim validation: ranges', () => {
  assert.ok(P.validateTrim(base).ok);
  assert.ok(!P.validateTrim({ ...base, start: 40, end: 10 }).ok, 'end before start');
  assert.ok(!P.validateTrim({ ...base, start: 59.99, end: 60 }).ok, 'shorter than the minimum clip');
  assert.ok(!P.validateTrim({ ...base, end: 61 }).ok, 'beyond the end');
  assert.ok(!P.validateTrim({ ...base, start: -1 }).ok);
  assert.ok(!P.validateTrim({ ...base, start: NaN }).ok);
  assert.ok(P.validateTrim({ ...base, start: 0, end: 60 }).ok);
  assert.ok(!P.validateTrim({ ...base, duration: 0 }).ok, 'unknown duration');
});
test('trim validation: fades cannot be invalid or overlap', () => {
  const f = (a, b) => withFade({ fadeIn: { enabled: true, duration: a }, fadeOut: { enabled: true, duration: b } });
  assert.ok(P.validateTrim(f(5, 5)).ok);
  assert.ok(P.validateTrim(f(15, 15)).ok, 'exactly the clip length (30 s)');
  assert.ok(!P.validateTrim(f(20, 20)).ok, 'overlap');
  assert.ok(!P.validateTrim(f(31, 0)).ok, 'longer than clip');
  assert.ok(!P.validateTrim(f(0, 3)).ok, 'enabled but zero');
  assert.ok(!P.validateTrim(f(-1, 3)).ok);
  assert.ok(P.validateTrim(withFade({ fadeIn: { enabled: false, duration: 999 } })).ok, 'a disabled fade is ignored');
  const v = P.validateTrim(f(10, 5));
  assert.equal(v.clip.maxFadeIn, 25); assert.equal(v.clip.maxFadeOut, 20);
});
test('trim validation: output settings', () => {
  assert.ok(!P.validateTrim({ ...base, output: { format: 'exe' } }).ok);
  assert.ok(!P.validateTrim({ ...base, output: { format: 'mp3', bitrate: 999 } }).ok);
  assert.ok(P.validateTrim({ ...base, output: { format: 'wav', bitDepth: 24 } }).ok);
  assert.ok(!P.validateTrim({ ...base, output: { format: 'wav', bitDepth: 8 } }).ok);
  assert.equal(P.validateTrim({ ...base, output: { format: 'mp3' } }).clip.output.bitrate, 256, 'default bitrate');
});
test('trim args: argument array, accurate trim, fades, no shell metacharacters from user text', () => {
  const v = P.validateTrim(withFade({ fadeIn: { enabled: true, duration: 2 }, fadeOut: { enabled: true, duration: 3 } }));
  const evil = '/tmp/a"; rm -rf / ;".mp3';
  const a = P.buildTrimArgs({ input: evil, output: '/tmp/o.part', clip: v.clip, outFormat: v.clip.output });
  assert.ok(Array.isArray(a)); assert.equal(a[a.indexOf('-i') + 1], evil, 'path passed as one argv element, unmodified');
  const af = a[a.indexOf('-af') + 1];
  assert.equal(af, 'atrim=start=10:end=40,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2,afade=t=out:st=27:d=3');
  assert.ok(a.includes('libmp3lame') && a.includes('192k') && !a.includes('copy'));
});

const trk = (d, o = {}) => ({ duration: d, ...o });
const merge = (tracks, transitions, output = { format: 'mp3' }) => P.validateMerge({ tracks, transitions, output });
test('merge validation: needs two tracks', () => { assert.ok(!merge([trk(10)], []).ok); assert.ok(merge([trk(10), trk(10)], [{ type: 'none' }]).ok); });
test('merge: layout and total duration for none / fade / crossfade', () => {
  const v = merge([trk(30), trk(20), trk(40)], [{ type: 'crossfade', duration: 5 }, { type: 'fade', duration: 2 }]);
  assert.ok(v.ok, v.errors.join('|'));
  assert.deepEqual(v.layout.clips.map((c) => [c.offset, c.end]), [[0, 30], [25, 45], [45, 85]]);
  assert.equal(v.layout.total, 85);
  assert.equal(merge([trk(10), trk(10)], [{ type: 'none' }]).layout.total, 20);
  assert.equal(merge([trk(10), trk(10)], [{ type: 'fade', duration: 2 }]).layout.total, 20, 'fade never overlaps');
});
test('merge: trimmed clips use their own length', () => {
  const v = merge([trk(100, { start: 10, end: 40 }), trk(50, { start: 5 })], [{ type: 'crossfade', duration: 4 }]);
  assert.equal(v.plan.tracks[0].duration, 30); assert.equal(v.plan.tracks[1].duration, 45); assert.equal(v.layout.total, 71);
});
test('merge: a transition longer than either neighbour is rejected', () => {
  assert.ok(!merge([trk(10), trk(100)], [{ type: 'crossfade', duration: 12 }]).ok);
  assert.ok(!merge([trk(100), trk(10)], [{ type: 'fade', duration: 12 }]).ok);
  assert.ok(!merge([trk(10), trk(10)], [{ type: 'crossfade', duration: 10 }]).ok, 'the whole clip is not allowed (needs a margin)');
  assert.ok(!merge([trk(10), trk(10)], [{ type: 'crossfade', duration: 0.01 }]).ok);
  assert.ok(!merge([trk(100), trk(100)], [{ type: 'crossfade', duration: 31 }]).ok);
});
test('merge: a middle track cannot have two overlaps that collide', () => {
  assert.ok(!merge([trk(30), trk(8), trk(30)], [{ type: 'crossfade', duration: 5 }, { type: 'crossfade', duration: 5 }]).ok);
  assert.ok(merge([trk(30), trk(10), trk(30)], [{ type: 'crossfade', duration: 5 }, { type: 'crossfade', duration: 5 }]).ok, 'exactly fits');
  assert.ok(!merge([trk(30, { fadeIn: 0 }), trk(10, { fadeIn: 6 }), trk(30)], [{ type: 'none' }, { type: 'fade', duration: 5 }]).ok, 'own fade-in 6 + transition 5 > 10');
});
test('merge: a fade/crossfade owns its edge, so the per-track fade there is not stacked', () => {
  const v = merge([trk(30, { fadeOut: 4 }), trk(30, { fadeIn: 4 })], [{ type: 'crossfade', duration: 6 }]);
  assert.equal(v.plan.tracks[0].fadeOut, 0); assert.equal(v.plan.tracks[1].fadeIn, 0);
  assert.equal(v.plan.tracks[0].tailFrom, 'crossfade'); assert.equal(v.plan.tracks[1].headFrom, 'crossfade');
  const n = merge([trk(30, { fadeOut: 4 }), trk(30, { fadeIn: 4 })], [{ type: 'none' }]);
  assert.equal(n.plan.tracks[0].fadeOut, 4); assert.equal(n.plan.tracks[1].fadeIn, 4);
});
test('merge: volume range and maxTransition', () => {
  assert.ok(!merge([trk(10, { volume: 2.5 }), trk(10)], [{ type: 'none' }]).ok);
  assert.ok(merge([trk(10, { volume: 0 }), trk(10, { volume: 2 })], [{ type: 'none' }]).ok);
  const v = merge([trk(30), trk(12), trk(30)], [{ type: 'crossfade', duration: 5 }, { type: 'none' }]);
  assert.equal(P.maxTransition(v.plan, 1), 12 - 5 > 0 ? 7 : 0, 'second transition limited by the first one on the shared track');
  assert.equal(P.maxTransition(v.plan, 0), 12 - 0 - 0.01 > 0 ? 11.9 : 0 , 'first transition bounded by the short middle track');
});
test('merge graph: fades inside clips, joins by concat/acrossfade, limiter only when needed', () => {
  const v = merge([trk(30), trk(20), trk(40)], [{ type: 'fade', duration: 2 }, { type: 'crossfade', duration: 5, curve: 'smooth' }]);
  const g = P.buildMergeGraph(v.plan).filter;
  assert.match(g, /\[0:a\]atrim=start=0:end=30.*afade=t=out:st=28:d=2\[a0\]/);
  assert.match(g, /\[1:a\].*afade=t=in:st=0:d=2\[a1\]/s, 'fade-in on the second clip');
  assert.match(g, /\[a0\]\[a1\]concat=n=2:v=0:a=1\[mix1\]/);
  assert.match(g, /\[mix1\]\[a2\]acrossfade=d=5:c1=qsin:c2=qsin\[mix2\]/);
  assert.match(g, /alimiter=limit=0\.97:level=0\[out\]$/);
  const plain = P.buildMergeGraph(merge([trk(10), trk(10)], [{ type: 'none' }]).plan).filter;
  assert.ok(!/alimiter/.test(plain), 'no limiter without crossfade or gain above 100%');
  // REGRESSION against the reference script: the second fade must be positioned from ITS OWN clip, not from the running mix
  const three = merge([trk(30), trk(20), trk(40)], [{ type: 'fade', duration: 2 }, { type: 'fade', duration: 2 }]);
  const g3 = P.buildMergeGraph(three.plan).filter;
  assert.match(g3, /\[1:a\].*afade=t=in:st=0:d=2,afade=t=out:st=18:d=2\[a1\]/, 'middle clip fades at 0 and (20-2)');
  assert.match(g3, /\[2:a\].*afade=t=in:st=0:d=2\[a2\]/);
});
test('merge args: each input is one argv element', () => {
  const v = merge([trk(10), trk(10)], [{ type: 'none' }], { format: 'wav', bitDepth: 24 });
  const a = P.buildMergeArgs({ inputs: ['/a b/1.mp3', '/a b/2.mp3'], output: '/o.part', plan: v.plan, outFormat: v.output });
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '-i'), ['/a b/1.mp3', '/a b/2.mp3']);
  assert.ok(a.includes('pcm_s24le'));
});
