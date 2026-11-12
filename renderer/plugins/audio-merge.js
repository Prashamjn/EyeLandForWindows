'use strict';
// Audio Merger: several tracks, each with volume / trim / fades, joined by No transition, Fade or Crossfade. Every limit comes from
// shared/audio/plan.js (the same code the export uses), so an invalid transition cannot be chosen and the timeline is what gets rendered.
Plugins.register({
  id: 'audioMerge',
  async mount(root, c) {
    const { h } = c, A = AudioUI, P = A.P, T = A.T;
    root.append(c.head(c.meta.name, 'Join tracks one after another, with fades or crossfades between them. Your files are never changed.'));
    const stage = h('div', { class: 'au' }); root.append(stage);

    const tracks = [], trans = [];                             // trans[i] sits between tracks[i] and tracks[i+1]
    let cur = null, running = null, jobId = null, disposed = false, dragId = null, playing = null, stopAt = 0;
    const R = new Map();                                        // track id -> refs to its live elements
    const audio = new Audio(); audio.preload = 'metadata';
    const fmt = (s, d = 1) => T.formatTime(s, d);
    const defTrans = () => ({ type: 'none', duration: 3, curve: 'linear' });

    /* ---------- skeleton ---------- */
    const note = h('div', { class: 'au-msg', role: 'status' });
    const dz = c.dropZone('Drop audio files here, or click to add tracks', { filters: A.AUDIO_FILTERS, multi: true, onFiles: addFiles });
    dz.classList.add('au-drop', 'sm');
    const list = h('div', { class: 'au-tracks' });
    const tlHead = h('div', { class: 'row sp' }, h('h3', { style: 'margin:0' }, 'Timeline'), h('span', { class: 'mono small muted' }, ''));
    const tl = h('div', { class: 'au-mtl', role: 'img', 'aria-label': 'Merged timeline' });
    const tlTotal = tlHead.lastChild;
    const timelineCard = h('div', { class: 'card au-card' }, tlHead, tl);
    const out = await A.outputPanel(c, { name: 'Merged audio' });
    const msg = h('div', { class: 'au-msg', role: 'status', 'aria-live': 'polite' });
    const bar = h('div', { class: 'bar au-bar', hidden: true }, h('i'));
    const exp = h('button', { class: 'btn primary', onclick: doExport }, 'Export');
    const cancel = h('button', { class: 'btn danger', hidden: true, onclick: () => c.ey.invoke('ey:audio:cancel', jobId) }, 'Cancel');
    const result = h('div', { class: 'au-result', hidden: true });
    const outCard = h('div', { class: 'card au-card' }, h('h3', {}, 'Export'), out.el, h('div', { class: 'row au-actions' }, exp, cancel, msg), bar, result);
    out.onChange(refresh);
    stage.append(dz, note, list, timelineCard, outCard);

    // dropping files anywhere on the page adds them, but dragging a track to reorder it must not be taken for a file drop
    root.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('application/x-li-track')) e.preventDefault(); });
    root.addEventListener('drop', (e) => { if (e.dataTransfer.types.includes('application/x-li-track') || e.target.closest('.drop')) return; e.preventDefault(); const f = [...e.dataTransfer.files].map((x) => window.eyeland.pathFor(x)).filter(Boolean); if (f.length) addFiles(f); });

    /* ---------- tracks ---------- */
    async function addFiles(paths) {
      if (running) return;
      const bad = [];
      for (const p of paths) {
        if (tracks.length >= P.MAX_TRACKS) { bad.push(`Only ${P.MAX_TRACKS} tracks fit in one merge.`); break; }
        note.className = 'au-msg'; note.textContent = 'Reading ' + p.split(/[\\/]/).pop();
        try {
          const info = await A.call(c.ey, 'ey:audio:probe', p);
          if (disposed) return;
          tracks.push({ id: c.uid(), path: p, name: info.name, info, start: 0, end: null, volume: 100, fadeIn: 0, fadeOut: 0, open: false });
          if (tracks.length > 1) trans.push(defTrans());
        } catch (e) { bad.push(`${p.split(/[\\/]/).pop()}: ${A.friendly(e)}`); }
      }
      note.className = 'au-msg' + (bad.length ? ' bad' : ''); note.textContent = bad.join('  ·  ');
      paintList();
    }
    const clipOf = (t) => ({ start: t.start, end: t.end == null ? t.info.duration : t.end });
    function removeTrack(i) { stopPreview(); const [t] = tracks.splice(i, 1); trans.splice(Math.min(i, trans.length - 1), trans.length ? 1 : 0); R.delete(t.id); paintList(); }
    function move(i, j) { if (j < 0 || j >= tracks.length || i === j) return; stopPreview(); const [t] = tracks.splice(i, 1); tracks.splice(j, 0, t); paintList(); }

    /* ---------- model and validation ---------- */
    function model() {
      return { tracks: tracks.map((t) => ({ duration: t.info.duration, start: t.start, end: clipOf(t).end, volume: t.volume / 100, fadeIn: t.fadeIn, fadeOut: t.fadeOut })), transitions: trans.map((x) => ({ ...x })), output: out.ready ? out.get().output : { format: 'mp3' } };
    }

    /* ---------- list (rebuilt only when the structure changes) ---------- */
    function paintList() {
      list.replaceChildren(); R.clear();
      if (!tracks.length) list.append(h('div', { class: 'empty' }, 'Add at least two tracks to start.'));
      tracks.forEach((t, i) => {
        list.append(trackCard(t, i));
        if (i < tracks.length - 1) list.append(transitionRow(i));
      });
      cur = null; refresh();
    }

    function trackCard(t, i) {
      const refs = {}; R.set(t.id, refs);
      const grip = h('span', { class: 'au-grip', title: 'Drag to reorder', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="1.3"/><circle cx="15" cy="7" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="17" r="1.3"/><circle cx="15" cy="17" r="1.3"/></svg>' });
      refs.idx = h('span', { class: 'au-idx mono' }, String(i + 1));
      refs.dur = h('span', { class: 'mono small muted au-cd' }, '');
      refs.play = h('button', { class: 'btn icon sm fill', title: 'Preview this track', 'aria-label': 'Preview track ' + (i + 1), onclick: () => togglePreview(t, refs) }, ' ');
      refs.play.innerHTML = ICONS.svg('play');
      const up = h('button', { class: 'btn icon sm', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, i - 1), html: ICONS.svg('chevUp') });
      const down = h('button', { class: 'btn icon sm au-flip', title: 'Move down', 'aria-label': 'Move down', disabled: i === tracks.length - 1, onclick: () => move(i, i + 1), html: ICONS.svg('chevUp') });
      const more = h('button', { class: 'btn icon sm' + (t.open ? ' on' : ''), title: 'Track settings', 'aria-label': 'Track settings', 'aria-expanded': String(t.open), onclick: () => { t.open = !t.open; body.hidden = !t.open; more.classList.toggle('on', t.open); more.setAttribute('aria-expanded', String(t.open)); if (t.open) refresh(); }, html: ICONS.svg('sliders') });
      const rm = h('button', { class: 'btn icon sm', title: 'Remove track', 'aria-label': 'Remove track', onclick: () => removeTrack(tracks.indexOf(t)), html: ICONS.svg('close') });
      const head = h('div', { class: 'au-th' }, grip, refs.idx, h('div', { class: 'grow' }, h('div', { class: 'trunc au-name', title: t.path }, t.name), h('div', { class: 'small faint trunc' }, A.fileMeta(t.info, c.fmtBytes))), refs.dur, refs.play, up, down, more, rm);

      // settings
      const vol = h('input', { type: 'range', min: 0, max: 200, step: 1, value: t.volume, 'aria-label': 'Volume' });
      const volN = h('input', { class: 'input mono au-num', type: 'number', min: 0, max: 200, step: 1, value: t.volume, 'aria-label': 'Volume percent' });
      const setVol = (v) => { v = Math.max(0, Math.min(200, Math.round(+v || 0))); t.volume = v; vol.value = volN.value = v; refresh(); };
      vol.addEventListener('input', () => setVol(vol.value)); volN.addEventListener('change', () => setVol(volN.value));
      refs.tS = A.timeInput(h, { value: t.start, label: 'Trim start', onCommit: (v) => { const e = clipOf(t).end; if (v < 0 || v > t.info.duration - P.MIN_CLIP || v > e - P.MIN_CLIP) return false; t.start = v; refresh(); } });
      refs.tE = A.timeInput(h, { value: clipOf(t).end, label: 'Trim end', onCommit: (v) => { if (v > t.info.duration + 0.001 || v < t.start + P.MIN_CLIP) return false; t.end = v >= t.info.duration - 0.001 ? null : v; refresh(); } });
      const reset = h('button', { class: 'btn sm', title: 'Use the whole track', onclick: () => { t.start = 0; t.end = null; refresh(); } }, 'Whole track');
      refs.fi = A.secondsControl(h, { label: 'Fade in', value: t.fadeIn, max: () => { const k = cur && cur.plan.tracks[tracks.indexOf(t)]; return k ? Math.max(0, k.duration - k.tail) : 0; }, onChange: (v) => { t.fadeIn = v; refresh(); } });
      refs.fo = A.secondsControl(h, { label: 'Fade out', value: t.fadeOut, max: () => { const k = cur && cur.plan.tracks[tracks.indexOf(t)]; return k ? Math.max(0, k.duration - k.head) : 0; }, onChange: (v) => { t.fadeOut = v; refresh(); } });
      refs.fiNote = h('span', { class: 'small faint' }); refs.foNote = h('span', { class: 'small faint' });
      const body = h('div', { class: 'au-tb', hidden: !t.open },
        h('div', { class: 'au-grid' },
          h('div', {}, h('span', { class: 'label' }, 'Volume'), h('div', { class: 'row' }, vol, h('span', { class: 'row small muted' }, volN, '%'))),
          h('div', {}, h('span', { class: 'label' }, 'Trim'), h('div', { class: 'row' }, refs.tS.el, h('span', { class: 'faint' }, 'to'), refs.tE.el, reset)),
          h('div', {}, h('span', { class: 'label' }, 'Fade in'), h('div', { class: 'row' }, refs.fi.range, h('span', { class: 'row small muted' }, refs.fi.num, 's')), refs.fiNote),
          h('div', {}, h('span', { class: 'label' }, 'Fade out'), h('div', { class: 'row' }, refs.fo.range, h('span', { class: 'row small muted' }, refs.fo.num, 's')), refs.foNote)),
        h('div', { class: 'small bad', role: 'alert' }, ''));
      refs.err = body.lastChild;

      const card = h('div', { class: 'au-track', draggable: 'true', 'data-id': t.id }, head, body);
      card.addEventListener('dragstart', (e) => { dragId = t.id; e.dataTransfer.setData('application/x-li-track', t.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { dragId = null; card.classList.remove('dragging'); list.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
      card.addEventListener('dragover', (e) => { if (!dragId || dragId === t.id) return; e.preventDefault(); const r = card.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2; card.classList.toggle('drop-before', before); card.classList.toggle('drop-after', !before); });
      card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
      card.addEventListener('drop', (e) => { if (!dragId) return; e.preventDefault(); const r = card.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2; const from = tracks.findIndex((x) => x.id === dragId); let to = tracks.indexOf(t) + (before ? 0 : 1); if (from < to) to--; dragId = null; move(from, to); });
      return card;
    }

    function transitionRow(i) {
      const tr = trans[i], refs = { i };
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Transition ' + (i + 1) });
      refs.btns = [['none', 'None'], ['fade', 'Fade'], ['crossfade', 'Crossfade']].map(([k, n]) => { const b = h('button', { 'data-t': k, onclick: () => { if (b.disabled) return; tr.type = k; if (k !== 'none') { const m = cur ? P.maxTransition(cur.plan, i) : 3; tr.duration = Math.max(0.1, Math.min(tr.duration || 3, m || 0.1)); } refresh(); } }, n); seg.append(b); return b; });
      refs.dur = A.secondsControl(h, { label: 'Transition duration', value: tr.duration, max: () => (cur ? P.maxTransition(cur.plan, i) : 0), onChange: (v) => { tr.duration = v; refresh(); } });
      refs.curve = h('select', { class: 'input au-curve', 'aria-label': 'Crossfade curve', onchange: () => { tr.curve = refs.curve.value; refresh(); } }, Object.entries(P.CURVES).map(([k, v]) => h('option', { value: k }, v.label)));
      refs.curve.value = tr.curve;
      refs.err = h('span', { class: 'small bad', role: 'alert' });
      refs.opts = h('div', { class: 'row au-topts' }, refs.dur.range, h('span', { class: 'row small muted' }, refs.dur.num, 's'), refs.curve);
      const row = h('div', { class: 'au-trans' }, h('span', { class: 'au-tlab small faint' }, 'Then'), seg, refs.opts, refs.err);
      R.set('t' + i, refs);
      return row;
    }

    /* ---------- live refresh (values only; no rebuild, so focus is never lost) ---------- */
    function refresh() {
      if (disposed) return;
      cur = P.validateMerge(model());
      // 1) bring the MODEL back inside the limits (a neighbour changed, a track was trimmed...), then validate again
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        tracks.forEach((t, i) => {
          const k = cur.plan.tracks[i], own = (f) => f === 'fade' || f === 'crossfade', fl = (v) => Math.max(0, Math.floor(v * 100) / 100);
          if (!own(k.headFrom) && t.fadeIn > fl(k.duration - k.tail)) { t.fadeIn = fl(k.duration - k.tail); changed = true; }
          if (!own(k.tailFrom) && t.fadeOut > fl(k.duration - k.head)) { t.fadeOut = fl(k.duration - k.head); changed = true; }
        });
        trans.forEach((tr, i) => {
          if (tr.type === 'none') return;
          const m = P.maxTransition(cur.plan, i);
          if (m < 0.1) { tr.type = 'none'; changed = true; } else if (tr.duration > m + 1e-9) { tr.duration = m; changed = true; } else if (tr.duration < 0.1) { tr.duration = 0.1; changed = true; }
        });
        if (!changed) break;
        cur = P.validateMerge(model());
      }
      const plan = cur.plan;
      // 2) paint the controls FROM the model
      tracks.forEach((t, i) => {
        const r = R.get(t.id), k = plan.tracks[i]; if (!r) return;
        r.idx.textContent = String(i + 1); r.dur.textContent = fmt(k.duration, 1);
        r.tS.set(t.start); r.tE.set(clipOf(t).end);
        for (const [ctl, note, own, from, label] of [[r.fi, r.fiNote, t.fadeIn, k.headFrom, 'start'], [r.fo, r.foNote, t.fadeOut, k.tailFrom, 'end']]) {
          const owned = from === 'fade' || from === 'crossfade';
          ctl.setEnabled(!owned); ctl.set(own, true); note.textContent = owned ? `The ${from} transition controls the ${label} of this track.` : '';
        }
        r.err.textContent = cur.perTrack[i][0] || '';
      });
      plan.transitions.forEach((tr, i) => {
        const r = R.get('t' + i); if (!r) return;
        const m = P.maxTransition(plan, i);
        r.btns.forEach((b) => { const on = b.dataset.t === trans[i].type; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.disabled = b.dataset.t !== 'none' && m < 0.1; b.title = b.disabled ? 'These tracks are too short for a transition' : ''; });
        r.opts.hidden = trans[i].type === 'none'; r.curve.hidden = trans[i].type !== 'crossfade';
        if (trans[i].type !== 'none') { r.dur.set(trans[i].duration, true); r.dur.range.min = '0.1'; }
        r.err.textContent = cur.perTransition[i][0] || '';
      });
      paintTimeline();
      const named = out.ready && out.get().name;
      exp.disabled = !!running || !cur.ok || !named;
      if (!running && !result.dataset.keep) {
        const hint = tracks.length < 2;
        msg.className = 'au-msg' + (!cur.ok && !hint ? ' bad' : ''); msg.textContent = !out.ready ? 'FFmpeg is not available.' : cur.ok ? '' : hint ? '' : cur.errors[0];
      }
    }

    function paintTimeline() {
      tl.replaceChildren();
      const L = cur.layout; tlTotal.textContent = tracks.length ? 'Total ' + fmt(L.total, 1) : '';
      if (!tracks.length || !(L.total > 0)) { tl.append(h('div', { class: 'au-mtl-empty small faint' }, 'Your merged timeline appears here')); return; }
      L.clips.forEach((cl, i) => {
        const k = cur.plan.tracks[i], t = tracks[i];
        const head = Math.max(k.fadeIn, k.headFrom === 'crossfade' ? k.head : 0), tail = Math.max(k.fadeOut, k.tailFrom === 'crossfade' ? k.tail : 0);
        const b = h('div', { class: 'au-blk lane' + (i % 2), title: `${i + 1}. ${t.name}  ${fmt(cl.offset, 1)} to ${fmt(cl.end, 1)}` }, h('span', { class: 'trunc' }, `${i + 1}  ${t.name}`));
        b.style.left = (cl.offset / L.total) * 100 + '%'; b.style.width = Math.max(0.4, (cl.duration / L.total) * 100) + '%';
        b.style.setProperty('--hf', Math.min(100, (head / cl.duration) * 100) + '%'); b.style.setProperty('--tf', Math.min(100, (tail / cl.duration) * 100) + '%');
        if (!cur.perTrack[i].length) b.classList.add('ok'); else b.classList.add('bad');
        tl.append(b);
      });
      cur.plan.transitions.forEach((tr, i) => {                    // marker where a fade / crossfade sits
        if (tr.type === 'none') return;
        const a = L.clips[i], n = L.clips[i + 1];
        const from = tr.type === 'crossfade' ? n.offset : a.end - tr.duration, to = tr.type === 'crossfade' ? a.end : a.end + tr.duration;
        const m = h('div', { class: 'au-mark ' + tr.type, title: `${tr.type === 'crossfade' ? 'Crossfade' : 'Fade'} ${fmt(tr.duration, 1)} s` });
        m.style.left = (from / L.total) * 100 + '%'; m.style.width = Math.max(0.5, ((to - from) / L.total) * 100) + '%'; tl.append(m);
      });
    }

    /* ---------- preview of a single track (its trimmed region, at its volume, with its own fades) ---------- */
    function stopPreview() { audio.pause(); if (playing) { playing.refs.play.innerHTML = ICONS.svg('play'); } playing = null; }
    async function togglePreview(t, refs) {
      if (playing && playing.t === t) return stopPreview();
      stopPreview();
      const k = cur.plan.tracks[tracks.indexOf(t)];
      audio.src = 'liaudio://f/' + t.info.id; audio.currentTime = k.start; stopAt = k.end; playing = { t, refs, k };
      refs.play.innerHTML = ICONS.svg('pauseF');
      try { await audio.play(); } catch (e) { stopPreview(); note.className = 'au-msg bad'; note.textContent = 'This track cannot be previewed here. Exporting still works.'; }
    }
    audio.addEventListener('timeupdate', () => {
      if (!playing) return; const { k, t } = playing, x = audio.currentTime;
      if (x >= stopAt - 0.03) return stopPreview();
      let g = Math.min(1, t.volume / 100); const rel = x - k.start;
      if (k.fadeIn > 0 && rel < k.fadeIn) g *= rel / k.fadeIn; if (k.fadeOut > 0 && k.duration - rel < k.fadeOut) g *= (k.duration - rel) / k.fadeOut;
      audio.volume = Math.max(0, Math.min(1, g));
    });
    audio.addEventListener('ended', stopPreview);

    /* ---------- export ---------- */
    async function doExport() {
      if (running || !cur.ok) return;
      stopPreview();
      const o = out.get();
      const req = { tracks: tracks.map((t) => ({ path: t.path, start: t.start, end: clipOf(t).end, volume: t.volume / 100, fadeIn: t.fadeIn, fadeOut: t.fadeOut })), transitions: trans.map((x) => ({ type: x.type, duration: x.duration, curve: x.curve })), output: o.output, dir: o.dir, name: o.name };
      await A.runExport(c, 'ey:audio:merge', req, {
        begin(id) { running = id; jobId = id; stage.classList.add('au-busy'); exp.disabled = true; cancel.hidden = false; bar.hidden = false; bar.firstChild.style.width = '0%'; result.hidden = true; result.dataset.keep = '1'; msg.className = 'au-msg'; msg.textContent = 'Starting'; },
        progress(d) { if (d.phase === 'verify') msg.textContent = 'Checking the result'; else { bar.firstChild.style.width = (d.percent || 0) + '%'; msg.textContent = Math.round(d.percent || 0) + '%'; } },
        done(r) { msg.className = 'au-msg ok'; msg.textContent = 'Done'; result.hidden = false; result.replaceChildren(h('div', { class: 'grow' }, h('div', { class: 'trunc', title: r.output }, r.output.split(/[\\/]/).pop()), h('div', { class: 'small faint' }, fmt(r.duration, 1) + '  ·  ' + c.fmtBytes(r.size) + '  ·  originals untouched')), h('button', { class: 'btn sm', onclick: () => c.ey.invoke('ey:reveal', r.output) }, c.icon('folder'), 'Show in folder')); },
        fail(e) { msg.className = 'au-msg' + (e.code === 'cancelled' ? '' : ' bad'); msg.textContent = A.friendly(e); },
      });
      running = null; jobId = null; stage.classList.remove('au-busy'); cancel.hidden = true; bar.hidden = true; delete result.dataset.keep; refresh();
      if (msg.textContent === 'Done') msg.textContent = '';
    }

    paintList();
    return () => { disposed = true; audio.pause(); audio.removeAttribute('src'); audio.load(); if (jobId) c.ey.invoke('ey:audio:cancel', jobId); };
  },
});
