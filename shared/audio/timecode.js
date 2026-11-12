'use strict';
// Time parsing and formatting for Audio Studio. Pure functions, used by both the renderer and the backend.
// Accepted input: plain seconds ("75", "75.5"), MM:SS ("2:30", "2:30.25"), HH:MM:SS ("1:02:03", "01:02:03.5").
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AudioTime = factory();
})(this, function () {
  const NUM = /^\d+(\.\d+)?$/;

  // returns seconds, or null when the text is not a valid time
  function parseTime(input) {
    if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
    if (typeof input !== 'string') return null;
    const s = input.trim();
    if (!s) return null;
    if (NUM.test(s)) return parseFloat(s);
    const parts = s.split(':');
    if (parts.length < 2 || parts.length > 3 || !parts.every((p) => NUM.test(p))) return null;
    const secPart = parts[parts.length - 1];
    const sec = parseFloat(secPart);
    const min = parseInt(parts[parts.length - 2], 10);
    const hr = parts.length === 3 ? parseInt(parts[0], 10) : 0;
    if (sec >= 60) return null;                         // "1:75" is not a time
    if (parts.length === 3 && min >= 60) return null;   // "1:75:00" is not a time (but "75:00" is 75 minutes)
    return hr * 3600 + min * 60 + sec;
  }

  // "m:ss" below an hour, "h:mm:ss" otherwise; decimals only when asked for (the trimmer shows tenths/hundredths)
  function formatTime(seconds, decimals = 0) {
    let s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const f = Math.pow(10, decimals);
    s = Math.round(s * f) / f;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const sec = s - h * 3600 - m * 60;
    const secText = decimals ? sec.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.floor(sec)).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${secText}` : `${m}:${secText}`;
  }

  // FFmpeg-safe number: never exponent notation, at most 6 decimals, no trailing zeros
  function ffNum(n) {
    const v = Math.round(+n * 1e6) / 1e6;
    if (!Number.isFinite(v)) throw new Error('Not a finite number: ' + n);
    return v.toFixed(6).replace(/\.?0+$/, '') || '0';
  }

  return { parseTime, formatTime, ffNum };
});
