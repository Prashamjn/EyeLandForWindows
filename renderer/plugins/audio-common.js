'use strict';
// Shared pieces for Audio Trimmer and Audio Merger: backend calls, time inputs, waveform drawing, the output panel and the export
// runner. Pure validation/timeline logic lives in shared/audio/plan.js (same code the main process uses to build FFmpeg arguments).
window.AudioUI = (() => {
  const T = AudioTime, P = AudioPlan;
  const AUDIO_FILTERS = [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'mka', 'mp4', 'webm'] }, { name: 'All files', extensions: ['*'] }];

  // every backend answer is { ok, data } | { ok:false, code, error, detail }: turn failures into Errors that keep the code and detail
  async function call(ey, ch, ...a) {
    const r = await ey.invoke(ch, ...a);
    if (!r || !r.ok) { const e = new Error((r && r.error) || 'Audio Studio failed'); e.code = r && r.code; e.detail = r && r.detail; throw e; }
    return r.data;
  }
  let capsP = null;
  const caps = (ey) => (capsP ||= call(ey, 'ey:audio:caps').catch((e) => { capsP = null; return { available: false, error: e.message, formats: [] }; }));

  const fileMeta = (i, fmtBytes) => [T.formatTime(i.duration, 1), fmtBytes(i.size), (i.codec || '').toUpperCase() + (i.bitrate ? ' ' + i.bitrate + ' kbps' : ''), i.sampleRate ? (i.sampleRate / 1000).toFixed(i.sampleRate % 1000 ? 1 : 0) + ' kHz' : '', i.channels || ''].filter(Boolean).join('  ·  ');
  const stem = (name) => name.replace(/\.[^.]+$/, '');

  // time field: shows m:ss.s, accepts seconds / MM:SS / HH:MM:SS; on invalid input it flags and restores the last good value
  function timeInput(h, { value = 0, label, onCommit, decimals = 1 }) {
    const inp = h('input', { class: 'input mono au-time', type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': label || 'Time', autocomplete: 'off' });
    let good = value;
    const paint = () => { inp.value = T.formatTime(good, decimals); inp.classList.remove('invalid'); };
    const commit = () => { const v = T.parseTime(inp.value); if (v == null) { inp.classList.add('invalid'); setTimeout(paint, 700); return; } const ok = onCommit ? onCommit(v) : true; if (ok === false) { inp.classList.add('invalid'); setTimeout(paint, 700); } };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } else if (e.key === 'Escape') { paint(); e.stopPropagation(); inp.blur(); } });
    inp.addEventListener('blur', commit); inp.addEventListener('focus', () => inp.select());
    paint();
    return { el: inp, set(v) { good = v; if (document.activeElement !== inp) paint(); } };
  }

  // number + slider pair for a duration in seconds (fades, transitions); `max` is re-read on every change so it always reflects the limits
  function secondsControl(h, { label, value = 0, max, step = 0.1, onChange }) {
    const range = h('input', { type: 'range', min: 0, max: 1, step, 'aria-label': label + ' slider' });
    const num = h('input', { class: 'input mono au-num', type: 'number', min: 0, step, 'aria-label': label });
    const set = (v, silent) => { const m = max(); v = Math.max(0, Math.min(m, Math.round(v * 100) / 100)); range.max = String(Math.max(m, step)); range.value = String(v); num.value = String(v); if (!silent && onChange) onChange(v); return v; };
    range.addEventListener('input', () => set(+range.value));
    num.addEventListener('change', () => set(+num.value || 0));
    return { range, num, set, get: () => +num.value || 0, setEnabled(on) { range.disabled = num.disabled = !on; }, refresh() { set(+num.value || 0, true); } };
  }

  // waveform on a canvas: loud bars inside [start,end] are accent coloured, the rest muted
  function drawWave(cv, peaks, { start = 0, end = 0, duration = 1 } = {}) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
    const cs = getComputedStyle(cv), accent = cs.getPropertyValue('--accent').trim() || '#5B9DFF', muted = cs.getPropertyValue('--track').trim() || 'rgba(255,255,255,.2)';
    if (!peaks || !peaks.length) return;
    const n = Math.max(1, Math.floor(w / 3)), mid = hgt / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
      let m = 0; for (let k = a; k < b; k++) if (peaks[k] > m) m = peaks[k];
      const amp = Math.max(1.5, (m / 255) * (hgt * 0.46)), t = ((i + 0.5) / n) * duration;
      g.fillStyle = t >= start && t <= end ? accent : muted;
      g.fillRect(i * 3, mid - amp, 2, amp * 2);
    }
  }

  // output panel: format, quality, file name, folder. get() returns what the backend needs (it validates again).
  async function outputPanel(c, { name = '' } = {}) {
    const { h } = c, S = c.S, cp = await caps(c.ey);
    const root = h('div', { class: 'au-out' });
    if (!cp.available) { root.append(h('div', { class: 'au-warn' }, 'FFmpeg is not available, so audio cannot be processed. ' + (cp.error || ''))); return { el: root, get: () => null, ready: false, setName() {}, onChange() {} }; }
    let dir = S.audioRemember !== false ? S.audioDir || '' : '';
    const fmt = h('select', { class: 'input', 'aria-label': 'Format' }, cp.formats.map((f) => h('option', { value: f.id }, f.label)));
    const q = h('select', { class: 'input', 'aria-label': 'Quality' });
    const qWrap = h('label', {}, h('span', { class: 'label' }, 'Quality'), q);
    const nameInp = h('input', { class: 'input', type: 'text', value: name, maxlength: 120, spellcheck: 'false', 'aria-label': 'File name', placeholder: 'File name' });
    const dirTxt = h('span', { class: 'small faint trunc au-dir', title: '' });
    const listeners = new Set();
    const wanted = S.audioRemember !== false && cp.formats.some((f) => f.id === S.audioFormat) ? S.audioFormat : cp.formats.some((f) => f.id === 'mp3') ? 'mp3' : cp.formats[0].id;
    fmt.value = wanted;
    const cur = () => cp.formats.find((f) => f.id === fmt.value);
    function fillQuality(keep) {
      const f = cur(); q.replaceChildren();
      if (f.bitrates) { f.bitrates.forEach((b) => q.append(h('option', { value: b }, b + ' kbps'))); q.value = String(keep && f.bitrates.includes(keep) ? keep : (S.audioRemember !== false && f.bitrates.includes(S.audioBitrate) ? S.audioBitrate : f.defaultBitrate)); qWrap.hidden = false; }
      else if (f.bitDepths) { f.bitDepths.forEach((b) => q.append(h('option', { value: b }, b + '-bit'))); q.value = '16'; qWrap.hidden = false; }
      else qWrap.hidden = true;
    }
    fillQuality();
    const paintDir = () => { const d = dir || cp.defaultDir; dirTxt.textContent = d; dirTxt.title = d; };
    paintDir();
    const remember = () => { if (S.audioRemember !== false) { const p = { audioFormat: fmt.value, audioDir: dir }; if (cur().bitrates) p.audioBitrate = +q.value; c.save(p); } listeners.forEach((f) => f()); };
    fmt.addEventListener('change', () => { fillQuality(+q.value); remember(); });
    q.addEventListener('change', remember); nameInp.addEventListener('input', () => listeners.forEach((f) => f()));
    const pick = h('button', { class: 'btn sm', onclick: async () => { const d = await c.ey.invoke('ey:audio:folder'); if (d) { dir = d; paintDir(); remember(); } } }, c.icon('folder'), 'Change');
    root.append(
      h('div', { class: 'au-out-row' }, h('label', {}, h('span', { class: 'label' }, 'Format'), fmt), qWrap, h('label', { class: 'grow' }, h('span', { class: 'label' }, 'File name'), nameInp)),
      h('div', { class: 'au-out-row au-dirrow' }, h('span', { class: 'small muted' }, 'Save to'), dirTxt, pick));
    return {
      el: root, ready: true,
      get() { const f = cur(); const o = { format: f.id }; if (f.bitrates) o.bitrate = +q.value; if (f.bitDepths) o.bitDepth = +q.value; return { output: o, dir, name: nameInp.value.trim() }; },
      setName(n) { nameInp.value = n; }, onChange(fn) { listeners.add(fn); },
    };
  }

  // runs one export with progress, a hold (the island must not collapse mid-export), cancel and a result row. Returns the data or null.
  async function runExport(c, channel, req, ui) {
    const id = c.uid();
    ui.begin(id);
    const off = c.ey.on('ey:audio:progress', (d) => { if (d && d.id === id) ui.progress(d); });
    try {
      const data = await LI.hold.run('audio-export', call(c.ey, channel, id, req), 60 * 60 * 1000);
      ui.done(data); c.toast('Saved ' + data.output.split(/[\\/]/).pop()); return data;
    } catch (e) { ui.fail(e); return null; } finally { off(); }
  }
  const friendly = (e) => (e.code === 'cancelled' ? 'Cancelled' : e.message + (e.detail && e.detail !== e.message && e.code !== 'invalid' ? '  (' + e.detail + ')' : ''));

  return { AUDIO_FILTERS, call, caps, fileMeta, stem, timeInput, secondsControl, drawWave, outputPanel, runExport, friendly, P, T };
})();
