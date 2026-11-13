'use strict';
// Audio Trimmer: waveform timeline with start/end markers, exact time inputs, playback preview (with fade preview),
// separate Fade In / Fade Out, and an export that re-encodes accurately (never overwrites the original).
Plugins.register({
  id: 'audioTrim',
  async mount(root, c) {
    const { h } = c, A = AudioUI, P = A.P, T = A.T;
    root.append(c.head(c.meta.name, 'Cut a section out of an audio file. The original is never changed.'));
    const stage = h('div', { class: 'au' }); root.append(stage);

    let status = null, info = null, peaks = null, start = 0, end = 0, previewSel = true, running = null, disposed = false, raf = 0, peakToken = 0, out = null, jobId = null;
    const fadeIn = { enabled: false, duration: 2 }, fadeOut = { enabled: false, duration: 2 };
    const audio = new Audio(); audio.preload = 'metadata';
    const E = {};                                              // elements of the editor, filled by build()
    const fmt = (s, d = 1) => T.formatTime(s, d);

    /* ---------- loading ---------- */
    const dz = c.dropZone('Drop an audio file here, or click to browse', { filters: A.AUDIO_FILTERS, multi: false, onFiles: (f) => load(f[0]) });
    dz.classList.add('au-drop');
    const note = h('div', { class: 'au-msg', role: 'status' });
    stage.append(dz, note);
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => { if (!info || e.target.closest('.drop')) return; e.preventDefault(); const f = [...e.dataTransfer.files].map((x) => window.eyeland.pathFor(x)).filter(Boolean); if (f[0]) load(f[0]); });

    async function load(path) {
      if (running) return;
      note.className = 'au-msg'; note.replaceChildren(h('div', { class: 'li-indet' }), h('span', { class: 'small muted' }, 'Reading the file'));
      try {
        const i = await A.call(c.ey, 'ey:audio:probe', path);
        if (disposed) return;
        info = i; start = 0; end = i.duration; peaks = null; fadeIn.enabled = fadeOut.enabled = false;
        audio.src = 'liaudio://f/' + i.id; audio.load();
        await build();
        loadPeaks(i);
      } catch (e) { if (!disposed) { note.className = 'au-msg bad'; note.textContent = A.friendly(e); } }
    }
    async function loadPeaks(i) {
      const t = ++peakToken; E.wave.classList.add('loading');
      try { const r = await A.call(c.ey, 'ey:audio:peaks', i.path, 700); if (t === peakToken && !disposed) { peaks = r.peaks; paintWave(); } }
      catch (e) { if (t === peakToken && !disposed) E.waveNote.textContent = 'The waveform could not be drawn (' + e.message + '). You can still trim by time.'; }
      finally { if (t === peakToken && !disposed) E.wave.classList.remove('loading'); }
    }

    /* ---------- editor ---------- */
    async function build() {
      out = out || await A.outputPanel(c, { name: '' });
      out.setName(A.stem(info.name) + ' (trimmed)');
      stage.replaceChildren();
      const tags = info.tags || {};
      const title = [tags.title, tags.artist].filter(Boolean).join(' · ');
      const card = h('div', { class: 'au-file' },
        h('span', { class: 'au-file-ico', html: ICONS.svg('music') }),
        h('div', { class: 'grow' }, h('div', { class: 'trunc au-name', title: info.path }, info.name), h('div', { class: 'small faint trunc' }, A.fileMeta(info, c.fmtBytes) + (title ? '  ·  ' + title : ''))),
        h('button', { class: 'btn sm', onclick: () => c.pick(A.AUDIO_FILTERS, false).then((f) => f[0] && load(f[0])) }, 'Change'));

      // timeline
      E.wave = h('div', { class: 'au-tl', tabindex: -1 });
      E.cv = h('canvas', { class: 'au-wave', 'aria-hidden': 'true' });
      E.sel = h('div', { class: 'au-sel' });
      E.hs = h('div', { class: 'au-h s', role: 'slider', tabindex: 0, 'aria-label': 'Start marker', title: 'Start' }, h('i'));
      E.he = h('div', { class: 'au-h e', role: 'slider', tabindex: 0, 'aria-label': 'End marker', title: 'End' }, h('i'));
      E.ph = h('div', { class: 'au-ph' });
      E.waveNote = h('div', { class: 'au-wnote small faint' });
      E.wave.append(E.cv, E.sel, E.ph, E.hs, E.he, h('div', { class: 'li-indet au-wload' }));
      const labels = h('div', { class: 'au-tl-labels small faint mono' }, h('span', {}, '0:00'), E.waveNote, h('span', {}, fmt(info.duration, 0)));

      // time inputs
      E.tStart = A.timeInput(h, { value: start, label: 'Start time', onCommit: (v) => setStart(v) });
      E.tEnd = A.timeInput(h, { value: end, label: 'End time', onCommit: (v) => setEnd(v) });
      E.len = h('span', { class: 'mono au-len' }, '');
      const useHead = (which) => h('button', { class: 'btn sm', title: 'Use the playhead position', onclick: () => (which === 's' ? setStart(audio.currentTime) : setEnd(audio.currentTime)) }, 'Playhead');
      const times = h('div', { class: 'au-times' },
        h('label', {}, h('span', { class: 'label' }, 'Start'), h('div', { class: 'row' }, E.tStart.el, useHead('s'))),
        h('label', {}, h('span', { class: 'label' }, 'End'), h('div', { class: 'row' }, E.tEnd.el, useHead('e'))),
        h('div', {}, h('span', { class: 'label' }, 'Selection'), E.len));

      // transport
      E.play = h('button', { class: 'au-tbtn primary', title: 'Play / pause (Space)', 'aria-label': 'Play', onclick: togglePlay });
      const stop = h('button', { class: 'au-tbtn', title: 'Stop', 'aria-label': 'Stop', onclick: stopPlay, html: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></svg>' });
      E.time = h('span', { class: 'mono au-clock' }, '0:00.0 / ' + fmt(info.duration));
      const selOnly = h('input', { type: 'checkbox', checked: true, onchange: () => { previewSel = selOnly.checked; } });
      const transport = h('div', { class: 'au-transport' }, E.play, stop, E.time, h('span', { class: 'grow' }), h('label', { class: 'au-chk small muted', title: 'Play only the selected region, with the fades applied' }, selOnly, 'Selection only'));
      paintPlayIcon();

      // fades
      const fadeRow = (label, st, key) => {
        const other = () => (key === 'in' ? fadeOut : fadeIn), otherRow = () => (key === 'in' ? E.fo : E.fi);
        const chk = h('input', { type: 'checkbox', 'aria-label': label + ' on', onchange: () => {
          st.enabled = chk.checked; ctl.setEnabled(st.enabled);
          if (st.enabled) {                                      // make room: a sensible default, and the other fade gives way if the two would overlap
            const clip = clipDur(), d = Math.max(0.1, Math.min(2, Math.floor((clip / 2) * 10) / 10));
            st.duration = d; ctl.set(d, true);
            const o = other();
            if (o.enabled && o.duration + d > clip) { o.duration = Math.max(0.1, Math.floor((clip - d) * 100) / 100); otherRow().ctl.set(o.duration, true); }
          }
          refreshFades(); update();
        } });
        const ctl = A.secondsControl(h, { label, value: st.duration, max: () => (key === 'in' ? maxIn() : maxOut()), onChange: (v) => { st.duration = v; refreshFades(); update(); } });
        ctl.setEnabled(false); ctl.set(st.duration, true);
        return { chk, ctl, el: h('div', { class: 'au-fade' }, h('label', { class: 'au-chk' }, chk, h('span', { class: 'au-fl' }, label)), ctl.range, h('span', { class: 'row small muted' }, ctl.num, 's')) };
      };
      E.fi = fadeRow('Fade in', fadeIn, 'in'); E.fo = fadeRow('Fade out', fadeOut, 'out');
      const fades = h('div', { class: 'card au-card' }, h('h3', {}, 'Fades'), E.fi.el, E.fo.el);

      // output + actions
      E.msg = h('div', { class: 'au-msg', role: 'status', 'aria-live': 'polite' });
      E.bar = h('div', { class: 'bar au-bar', hidden: true }, h('i'));
      E.exp = h('button', { class: 'btn primary', onclick: doExport }, 'Export');
      E.cancel = h('button', { class: 'btn danger', hidden: true, onclick: () => c.ey.invoke('ey:audio:cancel', jobId) }, 'Cancel');
      E.result = h('div', { class: 'au-result', hidden: true });
      out.onChange(update);
      const output = h('div', { class: 'card au-card' }, h('h3', {}, 'Export'), out.el, h('div', { class: 'row au-actions' }, E.exp, E.cancel, E.msg), E.bar, E.result);

      stage.append(card, h('div', { class: 'card au-card' }, E.wave, labels, times, transport), fades, output);
      wireTimeline();
      requestAnimationFrame(() => { paintWave(); update(); });
    }

    const clipDur = () => Math.max(0, end - start);
    const maxIn = () => Math.max(0, Math.min(P.MAX_FADE, clipDur() - (fadeOut.enabled ? fadeOut.duration : 0)));
    const maxOut = () => Math.max(0, Math.min(P.MAX_FADE, clipDur() - (fadeIn.enabled ? fadeIn.duration : 0)));
    // only ENABLED fades are clamped to the available room (a disabled one keeps its value for when it is switched on)
    function refreshFades() { if (!E.fi) return; for (const [st, r] of [[fadeIn, E.fi], [fadeOut, E.fo]]) { if (!st.enabled) continue; r.ctl.set(st.duration, true); st.duration = r.ctl.get(); } }

    function setStart(v) { if (!info) return false; if (v < 0 || v > info.duration - P.MIN_CLIP) return false; if (v > end - P.MIN_CLIP) end = Math.min(info.duration, v + P.MIN_CLIP); start = v; refreshFades(); update(); return true; }
    function setEnd(v) { if (!info) return false; if (v > info.duration + 0.001 || v < P.MIN_CLIP) return false; v = Math.min(v, info.duration); if (v < start + P.MIN_CLIP) start = Math.max(0, v - P.MIN_CLIP); end = v; refreshFades(); update(); return true; }

    /* ---------- drawing and validation ---------- */
    const pct = (t) => (t / info.duration) * 100 + '%';
    let paintQ = 0;
    function paintWave() { if (paintQ || !E.cv) return; paintQ = requestAnimationFrame(() => { paintQ = 0; if (!disposed && info && E.cv.isConnected) A.drawWave(E.cv, peaks, { start, end, duration: info.duration }); }); }
    function validation() { return P.validateTrim({ duration: info.duration, start, end, fadeIn, fadeOut, output: out.ready ? out.get().output : { format: 'mp3' } }); }
    // `keep` = refresh without discarding the last export status (finish / cancel / error); any user change calls update() and clears it
    function update(keep) {
      if (!info || !E.sel) return;
      if (keep !== true) status = null;
      E.sel.style.left = pct(start); E.sel.style.width = ((end - start) / info.duration) * 100 + '%';
      E.hs.style.left = pct(start); E.he.style.left = pct(end);
      E.hs.setAttribute('aria-valuenow', start.toFixed(2)); E.he.setAttribute('aria-valuenow', end.toFixed(2));
      E.tStart.set(start); E.tEnd.set(end); E.len.textContent = fmt(end - start, 2);
      const v = validation(); E.fi.ctl.range.max = String(Math.max(0.1, maxIn())); E.fo.ctl.range.max = String(Math.max(0.1, maxOut()));
      const bad = !v.ok || !out.ready || !out.get().name;
      E.exp.disabled = !!running || bad;
      if (!running) {
        if (status) { E.msg.className = 'au-msg' + status.cls; E.msg.textContent = status.text; }
        else { E.msg.className = 'au-msg' + (v.ok ? '' : ' bad'); E.msg.textContent = out.ready ? (v.ok ? '' : v.errors[0]) : 'FFmpeg is not available.'; }
      }
      paintWave();
    }

    /* ---------- timeline interaction ---------- */
    function wireTimeline() {
      const at = (e) => { const r = E.wave.getBoundingClientRect(); return Math.max(0, Math.min(info.duration, ((e.clientX - r.left) / r.width) * info.duration)); };
      const drag = (el, apply) => {
        el.addEventListener('pointerdown', (e) => { if (running) return; e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); });
        el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) apply(at(e)); });
        const up = (e) => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); el.classList.remove('drag'); };
        el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        el.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (!d || running) return; e.preventDefault(); apply((el === E.hs ? start : end) + d * (e.shiftKey ? 1 : 0.1), true); });
      };
      drag(E.hs, (t, kb) => setStart(Math.max(0, Math.min(t, end - P.MIN_CLIP)))); drag(E.he, (t) => setEnd(Math.min(info.duration, Math.max(t, start + P.MIN_CLIP))));
      let scrub = false;
      E.wave.addEventListener('pointerdown', (e) => { if (e.target.closest('.au-h')) return; scrub = true; E.wave.setPointerCapture(e.pointerId); seek(at(e)); });
      E.wave.addEventListener('pointermove', (e) => { if (scrub) seek(at(e)); });
      E.wave.addEventListener('pointerup', () => { scrub = false; });
    }
    function seek(t) { audio.currentTime = t; tick(); }

    /* ---------- playback ---------- */
    const SVG = { play: ICONS.svg('play'), pause: ICONS.svg('pauseF') };
    function paintPlayIcon() { if (!E.play) return; E.play.innerHTML = audio.paused ? SVG.play : SVG.pause; E.play.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause'); E.play.classList.add('fill'); }
    async function togglePlay() {
      if (!info) return;
      if (!audio.paused) { audio.pause(); return; }
      if (previewSel && (audio.currentTime < start - 0.01 || audio.currentTime >= end - 0.02)) audio.currentTime = start;
      try { await audio.play(); } catch (e) { E.msg.className = 'au-msg bad'; E.msg.textContent = 'This file cannot be previewed here (' + (e.message || 'playback error') + '). Exporting still works.'; }
    }
    function stopPlay() { audio.pause(); audio.currentTime = previewSel ? start : 0; tick(); }
    function tick() {
      if (!info || !E.ph) return;
      const t = audio.currentTime || 0;
      E.ph.style.left = pct(Math.min(t, info.duration)); E.time.textContent = fmt(t) + ' / ' + fmt(info.duration);
      if (!audio.paused) {
        if (previewSel && t >= end - 0.005) { audio.pause(); audio.currentTime = start; return tick(); }
        // fade preview: the element volume follows the same linear ramps the export applies, inside the selection
        let g = 1;
        if (t >= start && t <= end) { if (fadeIn.enabled && fadeIn.duration > 0 && t < start + fadeIn.duration) g *= (t - start) / fadeIn.duration; if (fadeOut.enabled && fadeOut.duration > 0 && t > end - fadeOut.duration) g *= (end - t) / fadeOut.duration; }
        audio.volume = Math.max(0, Math.min(1, g));
        raf = requestAnimationFrame(tick);
      }
    }
    audio.addEventListener('play', () => { paintPlayIcon(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
    audio.addEventListener('pause', () => { paintPlayIcon(); cancelAnimationFrame(raf); audio.volume = 1; tick(); });
    audio.addEventListener('ended', () => { paintPlayIcon(); });
    audio.addEventListener('error', () => { if (info && E.msg) { E.msg.className = 'au-msg bad'; E.msg.textContent = 'This file cannot be previewed here. Exporting still works.'; } });
    const onKey = (e) => { if (e.code === 'Space' && info && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement && document.activeElement.tagName)) { e.preventDefault(); togglePlay(); } };
    window.addEventListener('keydown', onKey);

    /* ---------- export ---------- */
    async function doExport() {
      const v = validation(); if (!v.ok || running) return;
      audio.pause();
      const o = out.get();
      const req = { input: info.path, start, end, fadeIn: { ...fadeIn }, fadeOut: { ...fadeOut }, output: o.output, dir: o.dir, name: o.name };
      await A.runExport(c, 'ey:audio:trim', req, {
        begin(id) { running = id; jobId = id; stage.classList.add('au-busy'); E.exp.disabled = true; E.cancel.hidden = false; E.bar.hidden = false; E.bar.firstChild.style.width = '0%'; E.result.hidden = true; status = null; E.msg.className = 'au-msg'; E.msg.textContent = 'Starting'; },
        progress(d) { if (d.phase === 'verify') E.msg.textContent = 'Checking the result'; else { E.bar.firstChild.style.width = (d.percent || 0) + '%'; E.msg.textContent = Math.round(d.percent || 0) + '%'; } },
        done(r) {
          status = { cls: ' ok', text: 'Done' };
          E.result.hidden = false; E.result.replaceChildren(h('div', { class: 'grow' }, h('div', { class: 'trunc', title: r.output }, r.output.split(/[\\/]/).pop()), h('div', { class: 'small faint' }, fmt(r.duration, 2) + '  ·  ' + c.fmtBytes(r.size) + '  ·  original untouched')), h('button', { class: 'btn sm', onclick: () => c.ey.invoke('ey:reveal', r.output) }, c.icon('folder'), 'Show in folder'));
        },
        fail(e) { status = { cls: e.code === 'cancelled' ? '' : ' bad', text: A.friendly(e) }; },
      });
      running = null; jobId = null; stage.classList.remove('au-busy'); E.cancel.hidden = true; E.bar.hidden = true; E.exp.disabled = false; update(true);
    }

    return () => {                                              // cleanup when the page closes
      disposed = true; cancelAnimationFrame(raf); cancelAnimationFrame(paintQ); window.removeEventListener('keydown', onKey);
      audio.pause(); audio.removeAttribute('src'); audio.load();
      if (jobId) c.ey.invoke('ey:audio:cancel', jobId);       // an export that nobody can see anymore is stopped
    };
  },
});
