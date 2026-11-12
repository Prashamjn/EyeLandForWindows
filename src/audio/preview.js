'use strict';
// Serving audio files to the <audio> element through liaudio://. Chromium needs HTTP Range support to seek; net.fetch on file:// does not
// answer Range requests, so it is implemented here (pure parser + streaming slice).
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.oga': 'audio/ogg', '.weba': 'audio/webm', '.webm': 'audio/webm', '.mp4': 'audio/mp4' };
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

// "bytes=a-b" | "bytes=a-" | "bytes=-n"  ->  { start, end } (inclusive) | null (no/ignored header) | 'unsatisfiable'
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());           // a single range only; multi-range requests are served whole
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = parseInt(m[2], 10); if (!(n > 0)) return 'unsatisfiable'; start = Math.max(0, size - n); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
  if (!(start >= 0) || start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

// Response for a file path and a Request
function serve(file, request) {
  let st; try { st = fs.statSync(file); } catch { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  const base = { 'Content-Type': mimeFor(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const r = parseRange(request.headers.get('range'), st.size);
  if (r === 'unsatisfiable') return new Response('', { status: 416, headers: { ...base, 'Content-Range': `bytes */${st.size}` } });
  if (r) {
    const body = Readable.toWeb(fs.createReadStream(file, { start: r.start, end: r.end }));
    return new Response(body, { status: 206, headers: { ...base, 'Content-Length': String(r.end - r.start + 1), 'Content-Range': `bytes ${r.start}-${r.end}/${st.size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(st.size) } });
}

module.exports = { parseRange, serve, mimeFor };
