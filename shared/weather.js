// Weather helpers for the island dashboard. Same data source as the Weather plugin (Open-Meteo, fetched through
// the existing "ey:fetch-json" IPC handler, location from "ey:ip-location" or the saved "weatherPlace" setting).
// Nothing here fabricates data: parse() throws on a malformed response so the UI can show an error state.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WX = factory();
})(this, function () {
  const GLYPHS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
    partly: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1M2 8h1M4 4l.7.7M12 4l-.7.7"/><path d="M9 20h9a4 4 0 0 0 0-8 5 5 0 0 0-9.4 1A3.5 3.5 0 0 0 9 20z"/>',
    partlyNight: '<path d="M8.5 3a3.4 3.4 0 1 0 3.9 4.6A3.4 3.4 0 0 1 8.5 3z"/><path d="M9 20h9a4 4 0 0 0 0-8 5 5 0 0 0-9.4 1A3.5 3.5 0 0 0 9 20z"/>',
    cloud: '<path d="M7 19h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1A3.6 3.6 0 0 0 7 19z"/>',
    fog: '<path d="M4 9h16M3 13h18M6 17h12"/>',
    rain: '<path d="M7 14h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1A3.6 3.6 0 0 0 7 14zM8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    snow: '<path d="M12 3v18M4 7.5l16 9M20 7.5l-16 9"/>',
    storm: '<path d="M7 13h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1A3.6 3.6 0 0 0 7 13zM12 13l-2 4h3l-2 4"/>',
    off: '<path d="M7 19h10a4 4 0 0 0 1.6-7.6M4 4l16 16M7.4 12A3.6 3.6 0 0 0 7 19"/>',
  };

  // WMO weather interpretation codes -> label + glyph
  function describe(code, isDay = true) {
    if (code === 0) return { text: isDay ? 'Clear' : 'Clear night', glyph: isDay ? 'sun' : 'moon' };
    if (code <= 2) return { text: 'Partly cloudy', glyph: isDay ? 'partly' : 'partlyNight' };
    if (code === 3) return { text: 'Overcast', glyph: 'cloud' };
    if (code <= 48) return { text: 'Fog', glyph: 'fog' };
    if (code <= 57) return { text: 'Drizzle', glyph: 'rain' };
    if (code <= 67) return { text: 'Rain', glyph: 'rain' };
    if (code <= 77) return { text: 'Snow', glyph: 'snow' };
    if (code <= 82) return { text: 'Rain showers', glyph: 'rain' };
    if (code <= 86) return { text: 'Snow showers', glyph: 'snow' };
    return { text: 'Thunderstorm', glyph: 'storm' };
  }

  const svg = (glyph, cls) => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}>${GLYPHS[glyph] || GLYPHS.off}</svg>`;

  function url(place, fahrenheit) {
    const q = `latitude=${encodeURIComponent(place.lat)}&longitude=${encodeURIComponent(place.lon)}`
      + '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
    return `https://api.open-meteo.com/v1/forecast?${q}${fahrenheit ? '&temperature_unit=fahrenheit' : ''}`;
  }

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // Strict: throws if the essentials are missing. High/low are optional (null when absent).
  function parse(d, fahrenheit) {
    const c = d && d.current;
    if (!c || num(c.temperature_2m) === null || num(c.weather_code) === null) throw new Error('Malformed weather response');
    const isDay = c.is_day === undefined ? true : !!c.is_day;
    const w = describe(c.weather_code, isDay);
    const hi = d.daily && Array.isArray(d.daily.temperature_2m_max) ? num(d.daily.temperature_2m_max[0]) : null;
    const lo = d.daily && Array.isArray(d.daily.temperature_2m_min) ? num(d.daily.temperature_2m_min[0]) : null;
    return { temp: Math.round(c.temperature_2m), text: w.text, glyph: w.glyph, hi: hi === null ? null : Math.round(hi), lo: lo === null ? null : Math.round(lo), unit: fahrenheit ? 'F' : 'C' };
  }

  return { GLYPHS, describe, svg, url, parse };
});
