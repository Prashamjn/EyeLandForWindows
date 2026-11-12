'use strict';
// Synced lyrics from LRCLIB (https://lrclib.net, a community database with an open API, no key). Rules:
//  * ONLY lyrics that carry real per-line timestamps are used. Plain (unsynced) lyrics are never shown;
//  * a result must plausibly be the same recording (duration within a few seconds), otherwise it is rejected;
//  * the renderer shows at most ONE line at a time and only while the player reports a real playback position.
// The track name and artist are sent to lrclib.net, so the feature is OFF by default (Settings > Media).
const BASE = 'https://lrclib.net/api';

// "[01:23.45] text" (also [mm:ss] and [mm:ss.xxx], several stamps on one line, and an optional [offset:+ms] tag)
function parseLrc(text) {
  if (typeof text !== 'string') return [];
  const out = []; let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const o = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i.exec(raw);
    if (o) { offset = +o[1] / 1000; continue; }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
      out.push({ t: Math.max(0, +m[1] * 60 + +m[2] + frac - offset), text: lyric.slice(0, 200) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// index of the line active at `pos` seconds, or -1 before the first line (binary search)
function lineAt(lines, pos) {
  let lo = 0, hi = lines.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= pos) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

// "Song (Official Video)" -> "Song"; "Artist - Topic" / "ArtistVEVO" -> "Artist"
function cleanTitle(t) { return String(t || '').replace(/\s*[(\[](official|lyrics?|audio|video|music video|visuali[sz]er|remaster(ed)?( \d{4})?|hd|4k)[^)\]]*[)\]]/gi, '').replace(/\s+/g, ' ').trim(); }
function cleanArtist(a) { return String(a || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').split(/\s*[,&]\s*|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim(); }

function closeInLength(rec, dur, tol = 3) { return !(dur > 0) || !(rec && rec.duration > 0) || Math.abs(rec.duration - dur) <= tol; }

function usable(rec, dur) {
  if (!rec || rec.instrumental) return null;
  if (!closeInLength(rec, dur)) return null;
  const lines = parseLrc(rec.syncedLyrics);
  return lines.filter((l) => l.text).length >= 3 ? lines : null;       // fewer than 3 lines is not a lyric sheet
}

// getJSON(url) -> parsed JSON, throws on HTTP errors (a 404 means "not found")
async function fetchSynced({ title, artist, album, duration }, getJSON) {
  const t = cleanTitle(title), a = cleanArtist(artist);
  if (!t) return { status: 'unavailable', reason: 'no-title' };
  const q = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try {
    try {
      const rec = await getJSON(`${BASE}/get?${q({ track_name: t, artist_name: a, album_name: album || undefined, duration: duration > 0 ? Math.round(duration) : undefined })}`);
      const lines = usable(rec, duration); if (lines) return { status: 'ok', lines, source: 'lrclib' };
    } catch (e) { if (!/HTTP 404/.test(e.message)) throw e; }
    const list = await getJSON(`${BASE}/search?${q({ track_name: t, artist_name: a || undefined })}`);
    for (const rec of Array.isArray(list) ? list.slice(0, 10) : []) { const lines = usable(rec, duration); if (lines && (!rec.trackName || cleanTitle(rec.trackName).toLowerCase() === t.toLowerCase())) return { status: 'ok', lines, source: 'lrclib' }; }
    return { status: 'unavailable', reason: 'not-found' };
  } catch (e) { return { status: 'unavailable', reason: 'network', detail: e.message }; }
}

// small cache of results (including misses) so the same track is never requested twice
function createLyricsService({ getJSON, max = 60 }) {
  const cache = new Map();
  return {
    async get(track) {
      const key = [cleanArtist(track.artist), cleanTitle(track.title), Math.round(track.duration || 0)].join('|').toLowerCase();
      if (cache.has(key)) return cache.get(key);
      const r = await fetchSynced(track, getJSON);
      if (r.reason !== 'network') { cache.set(key, r); if (cache.size > max) cache.delete(cache.keys().next().value); }   // a network failure is retried next time
      return r;
    },
  };
}

module.exports = { parseLrc, lineAt, cleanTitle, cleanArtist, fetchSynced, createLyricsService, closeInLength };
