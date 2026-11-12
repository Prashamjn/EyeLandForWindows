'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const L = require('../../src/lyrics.js');

test('parseLrc: stamps, fractions, multiple stamps, offset, ordering, metadata lines ignored', () => {
  const l = L.parseLrc('[ar:Someone]\n[00:12.00]Hello\n[00:17.5]Second\n[01:02]Third\n[00:05.123][00:30.1]Chorus\n\n[00:40.00]\n');
  assert.deepEqual(l.map((x) => x.text), ['Chorus', 'Hello', 'Second', 'Chorus', '', 'Third']);
  assert.deepEqual(l.map((x) => x.t), [5.123, 12, 17.5, 30.1, 62, 40].sort((a, b) => a - b).map((v) => v));
  assert.equal(L.parseLrc('[offset:+500]\n[00:10.00]x')[0].t, 9.5, 'a positive offset makes lines earlier');
  assert.deepEqual(L.parseLrc('no stamps at all\nsecond line'), []); assert.deepEqual(L.parseLrc(null), []);
});
test('lineAt: before first, exact, between, after last', () => {
  const l = [{ t: 5, text: 'a' }, { t: 10, text: 'b' }, { t: 20, text: 'c' }];
  assert.equal(L.lineAt(l, 0), -1); assert.equal(L.lineAt(l, 5), 0); assert.equal(L.lineAt(l, 9.99), 0); assert.equal(L.lineAt(l, 10), 1); assert.equal(L.lineAt(l, 999), 2); assert.equal(L.lineAt([], 3), -1);
});
test('cleaning of titles and artists', () => {
  assert.equal(L.cleanTitle('Song Name (Official Video)'), 'Song Name'); assert.equal(L.cleanTitle('Song [Remastered 2011]'), 'Song'); assert.equal(L.cleanTitle('Song (feat. X)'), 'Song (feat. X)');
  assert.equal(L.cleanArtist('Artist - Topic'), 'Artist'); assert.equal(L.cleanArtist('ArtistVEVO'), 'Artist'); assert.equal(L.cleanArtist('A, B'), 'A');
});
const synced = '[00:01.00]one\n[00:05.00]two\n[00:09.00]three\n[00:12.00]four';
test('fetchSynced: exact hit with matching length', async () => {
  const urls = []; const r = await L.fetchSynced({ title: 'T', artist: 'A', album: 'Al', duration: 200 }, async (u) => { urls.push(u); return { duration: 201, syncedLyrics: synced, plainLyrics: 'x' }; });
  assert.equal(r.status, 'ok'); assert.equal(r.lines.length, 4); assert.match(urls[0], /\/get\?track_name=T&artist_name=A&album_name=Al&duration=200/);
});
test('fetchSynced: plain-only lyrics are NEVER used (not accurate without timestamps)', async () => {
  const r = await L.fetchSynced({ title: 'T', artist: 'A', duration: 200 }, async (u) => (/\/get/.test(u) ? { duration: 200, plainLyrics: 'a\nb\nc\nd', syncedLyrics: null } : []));
  assert.deepEqual([r.status, r.reason], ['unavailable', 'not-found']);
});
test('fetchSynced: a different recording (length off by more than 3 s) is rejected', async () => {
  const r = await L.fetchSynced({ title: 'T', artist: 'A', duration: 200 }, async (u) => (/\/get/.test(u) ? { duration: 260, syncedLyrics: synced } : []));
  assert.equal(r.status, 'unavailable');
});
test('fetchSynced: instrumental and too-short sheets are rejected; 404 falls back to search; search needs the same title', async () => {
  assert.equal((await L.fetchSynced({ title: 'T', duration: 100 }, async () => ({ instrumental: true, duration: 100 }))).status, 'unavailable');
  assert.equal((await L.fetchSynced({ title: 'T', duration: 100 }, async (u) => (/\/get/.test(u) ? { duration: 100, syncedLyrics: '[00:01.00]a\n[00:02.00]b' } : []))).status, 'unavailable');
  const hit = await L.fetchSynced({ title: 'Real Song', artist: 'A', duration: 100 }, async (u) => { if (/\/get/.test(u)) throw new Error('HTTP 404'); return [{ trackName: 'Other', duration: 100, syncedLyrics: synced }, { trackName: 'Real Song', duration: 101, syncedLyrics: synced }]; });
  assert.equal(hit.status, 'ok');
  const miss = await L.fetchSynced({ title: 'Real Song', duration: 100 }, async (u) => { if (/\/get/.test(u)) throw new Error('HTTP 404'); return [{ trackName: 'Other', duration: 100, syncedLyrics: synced }]; });
  assert.equal(miss.status, 'unavailable');
});
test('fetchSynced: network failure is reported as such and is not cached', async () => {
  let calls = 0; const S = L.createLyricsService({ getJSON: async () => { calls++; throw new Error('boom'); } });
  const a = await S.get({ title: 'T', artist: 'A', duration: 100 }); await S.get({ title: 'T', artist: 'A', duration: 100 });
  assert.equal(a.reason, 'network'); assert.equal(calls, 2, 'one request per attempt, retried the second time because failures are not cached');
  let n = 0; const S2 = L.createLyricsService({ getJSON: async (u) => { n++; return /\/get/.test(u) ? { duration: 100, syncedLyrics: synced } : []; } });
  await S2.get({ title: 'T', artist: 'A', duration: 100 }); await S2.get({ title: 'T', artist: 'A', duration: 100 }); assert.equal(n, 1, 'a success is cached');
});
test('fetchSynced: empty title is unavailable without any request', async () => { let n = 0; const r = await L.fetchSynced({ title: '  ' }, async () => { n++; }); assert.equal(r.status, 'unavailable'); assert.equal(n, 0); });
