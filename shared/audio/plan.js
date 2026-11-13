'use strict';
// Audio Studio planning: validation, timeline layout and FFmpeg filter-graph construction. PURE: no I/O, no processes.
// The renderer uses it for live validation and the timeline; the main process uses the very same code to build the FFmpeg
// arguments, so what the UI shows is what gets rendered.
//
// Port of the reference scripts (AudioCutter.py / AudioMixer.py), with these deliberate differences:
//  * accurate re-encoding instead of `-c copy` (stream copy cannot fade and cuts only on keyframes);
//  * per-clip fades are applied BEFORE joining. The reference applied a "fade" transition to the running mix, using the
//    previous song's own duration as the offset, which fades in the wrong place from the second transition onwards;
//  * every constraint (fade vs clip length, crossfade vs both neighbours, head + tail overlap) is validated up front.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./timecode.js'));
  else root.AudioPlan = factory(root.AudioTime);
})(this, function (T) {
  const { ffNum } = T;

  const MIN_CLIP = 0.1;            // shortest clip that can be exported, seconds
  const MAX_FADE = 60;             // longest single fade, seconds
  const MAX_TRANSITION = 30;
  const EPS = 1e-6;
  const MAX_TRACKS = 50;

  // format table. `encoder` is checked against `ffmpeg -encoders` at run time; the UI only offers what is really available.
  const FORMATS = {
    mp3:  { label: 'MP3',          ext: 'mp3',  encoder: 'libmp3lame', muxer: 'mp3',  lossy: true,  bitrates: [128, 192, 256, 320], defaultBitrate: 256 },
    m4a:  { label: 'M4A (AAC)',    ext: 'm4a',  encoder: 'aac',        muxer: 'ipod', lossy: true,  bitrates: [128, 192, 256, 320], defaultBitrate: 256 },
    ogg:  { label: 'OGG Vorbis',   ext: 'ogg',  encoder: 'libvorbis',  muxer: 'ogg',  lossy: true,  bitrates: [128, 192, 256, 320], defaultBitrate: 192 },
    opus: { label: 'Opus',         ext: 'opus', encoder: 'libopus',    muxer: 'ogg',  lossy: true,  bitrates: [64, 96, 128, 192, 256], defaultBitrate: 128, sampleRate: 48000 },
    flac: { label: 'FLAC',         ext: 'flac', encoder: 'flac',       muxer: 'flac', lossy: false },
    wav:  { label: 'WAV',          ext: 'wav',  encoder: 'pcm_s16le',  muxer: 'wav',  lossy: false, bitDepths: [16, 24] },
  };
  const CURVES = {                  // crossfade curves (FFmpeg acrossfade c1/c2 names)
    linear: { label: 'Linear', c: 'tri' },
    smooth: { label: 'Smooth (equal power)', c: 'qsin' },
  };

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;

  function validateOutput(o, errors) {
    const f = FORMATS[o && o.format];
    if (!f) { errors.push(`Unsupported output format "${o && o.format}".`); return null; }
    const out = { format: o.format };
    if (f.lossy) {
      const b = o.bitrate == null ? f.defaultBitrate : +o.bitrate;
      if (!f.bitrates.includes(b)) errors.push(`${f.label} bitrate must be one of ${f.bitrates.join(', ')} kbps.`);
      out.bitrate = b;
    } else if (f.bitDepths) {
      const d = o.bitDepth == null ? 16 : +o.bitDepth;
      if (!f.bitDepths.includes(d)) errors.push('WAV bit depth must be 16 or 24.');
      out.bitDepth = d;
    }
    return out;
  }

  /* ================= Audio Trimmer ================= */
  // in: { duration, start, end, fadeIn: {enabled, duration}, fadeOut: {enabled, duration}, output: {format, bitrate?, bitDepth?} }
  // out: { ok, errors[], clip: {start, end, duration, fadeIn, fadeOut, maxFadeIn, maxFadeOut, output} }
  function validateTrim(p) {
    const errors = [];
    const dur = num(p && p.duration), start = num(p && p.start), end = num(p && p.end);
    if (!(dur > 0)) errors.push('The source duration is unknown.');
    if (Number.isNaN(start) || start < 0) errors.push('Start time is not valid.');
    if (Number.isNaN(end)) errors.push('End time is not valid.');
    if (dur > 0 && start >= 0 && start >= dur - EPS) errors.push('Start time is beyond the end of the audio.');
    if (dur > 0 && end > dur + 0.001) errors.push('End time is beyond the end of the audio.');
    if (!Number.isNaN(start) && !Number.isNaN(end) && end - start < MIN_CLIP - EPS) errors.push(`The selection must be at least ${MIN_CLIP} s long.`);
    const clipEnd = dur > 0 ? Math.min(end, dur) : end;
    const clipDur = r6(clipEnd - start);
    const fi = p && p.fadeIn && p.fadeIn.enabled ? num(p.fadeIn.duration) : 0;
    const fo = p && p.fadeOut && p.fadeOut.enabled ? num(p.fadeOut.duration) : 0;
    if (Number.isNaN(fi) || fi < 0) errors.push('Fade in duration is not valid.');
    if (Number.isNaN(fo) || fo < 0) errors.push('Fade out duration is not valid.');
    if (p && p.fadeIn && p.fadeIn.enabled && fi <= 0) errors.push('Fade in is on but its duration is 0.');
    if (p && p.fadeOut && p.fadeOut.enabled && fo <= 0) errors.push('Fade out is on but its duration is 0.');
    if (fi > MAX_FADE || fo > MAX_FADE) errors.push(`A fade cannot be longer than ${MAX_FADE} s.`);
    if (clipDur > 0) {
      if (fi > clipDur + EPS) errors.push('Fade in is longer than the selection.');
      if (fo > clipDur + EPS) errors.push('Fade out is longer than the selection.');
      if (fi + fo > clipDur + EPS && fi <= clipDur + EPS && fo <= clipDur + EPS) errors.push('Fade in and fade out would overlap. Shorten one of them.');
    }
    const output = validateOutput(p && p.output, errors);
    const maxIn = Math.max(0, Math.min(MAX_FADE, r6(clipDur - fo))), maxOut = Math.max(0, Math.min(MAX_FADE, r6(clipDur - fi)));
    return { ok: errors.length === 0, errors, clip: { start, end: clipEnd, duration: clipDur, fadeIn: fi || 0, fadeOut: fo || 0, maxFadeIn: maxIn, maxFadeOut: maxOut, output } };
  }

  function outputArgs(out) {
    const f = FORMATS[out.format];
    const a = ['-c:a', f.encoder];
    if (f.lossy) a.push('-b:a', out.bitrate + 'k');
    if (out.format === 'wav' && out.bitDepth === 24) a[1] = 'pcm_s24le';
    if (out.format === 'flac') a.push('-compression_level', '5');
    if (out.format === 'm4a') a.push('-movflags', '+faststart');
    return a;
  }

  // the filter for one clip: trim, restart timestamps, optional volume, optional fades
  function clipFilter({ start, end, duration, volume = 1, fadeIn = 0, fadeOut = 0, rate, normalise = false }) {
    const f = [`atrim=start=${ffNum(start)}:end=${ffNum(end)}`, 'asetpts=PTS-STARTPTS'];
    if (normalise) f.push(`aresample=${rate}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    if (Math.abs(volume - 1) > 1e-9) f.push(`volume=${ffNum(volume)}`);
    if (fadeIn > 0) f.push(`afade=t=in:st=0:d=${ffNum(fadeIn)}`);
    if (fadeOut > 0) f.push(`afade=t=out:st=${ffNum(Math.max(0, duration - fadeOut))}:d=${ffNum(fadeOut)}`);
    return f.join(',');
  }

  // argument array for one trim export (no shell, no string concatenation of user text). `output` is the final partial path.
  function buildTrimArgs({ input, output, clip, outFormat }) {
    const f = FORMATS[outFormat.format];
    const filter = clipFilter({ start: clip.start, end: clip.end, duration: clip.duration, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut });
    return ['-hide_banner', '-nostdin', '-y', '-i', input, '-vn', '-sn', '-dn', '-map', '0:a:0', '-af', filter, '-map_metadata', '0',
      ...(f.sampleRate ? ['-ar', String(f.sampleRate)] : []), ...outputArgs(outFormat), '-f', f.muxer, '-progress', 'pipe:1', '-nostats', output];
  }

  /* ================= Audio Merger ================= */
  // tracks: [{ duration (source), start?, end?, volume? (1 = 100%), fadeIn?, fadeOut? }]
  // transitions: [{ type: 'none'|'fade'|'crossfade', duration?, curve? }]  (tracks.length - 1 of them)
  // Rule: a transition of type fade or crossfade OWNS the edge it touches, so the per-track fade on that edge is ignored
  // (stacking two fades would attenuate twice). The UI disables those per-track fields; `plan.tracks[i].headFrom/tailFrom` say why.
  function normaliseMerge(p) {
    const tracks = (p && p.tracks) || [];
    const transitions = [];
    for (let i = 0; i < tracks.length - 1; i++) {
      const t = (p.transitions && p.transitions[i]) || { type: 'none' };
      const type = ['none', 'fade', 'crossfade'].includes(t.type) ? t.type : 'none';
      transitions.push({ type, duration: type === 'none' ? 0 : +t.duration || 0, curve: CURVES[t.curve] ? t.curve : 'linear' });
    }
    const list = tracks.map((t, i) => {
      const dur = num(t.duration), start = t.start == null ? 0 : num(t.start), endRaw = t.end == null ? dur : num(t.end);
      const end = dur > 0 ? Math.min(endRaw, dur) : endRaw;
      const prev = transitions[i - 1], next = transitions[i];
      const headT = prev && prev.type !== 'none' ? prev.duration : 0, tailT = next && next.type !== 'none' ? next.duration : 0;
      const ownIn = Math.max(0, +t.fadeIn || 0), ownOut = Math.max(0, +t.fadeOut || 0);
      return {
        start, end, duration: r6(end - start), source: dur, volume: t.volume == null ? 1 : +t.volume,
        // fades actually applied inside the clip: a 'fade' transition is rendered as clip fades, a 'crossfade' by acrossfade (none here)
        fadeIn: !headT ? ownIn : (prev.type === 'fade' ? headT : 0), fadeOut: !tailT ? ownOut : (next.type === 'fade' ? tailT : 0),
        headFrom: headT ? prev.type : (ownIn ? 'track' : null), tailFrom: tailT ? next.type : (ownOut ? 'track' : null),
        head: headT || ownIn, tail: tailT || ownOut,                              // total length of each edge's fade/overlap
        ownIn, ownOut,
      };
    });
    return { tracks: list, transitions };
  }

  function validateMerge(p) {
    const errors = [], perTrack = [], perTransition = [];
    const n = (p && p.tracks && p.tracks.length) || 0;
    if (n < 2) errors.push('Add at least two tracks to merge.');
    if (n > MAX_TRACKS) errors.push(`At most ${MAX_TRACKS} tracks can be merged at once.`);
    const plan = normaliseMerge(p || {});
    plan.tracks.forEach((t, i) => {
      const e = [];
      const label = `Track ${i + 1}`;
      if (!(t.source > 0)) e.push(`${label}: the duration is unknown.`);
      if (Number.isNaN(t.start) || t.start < 0) e.push(`${label}: start is not valid.`);
      if (Number.isNaN(t.end)) e.push(`${label}: end is not valid.`);
      if (t.source > 0 && t.start >= t.source - EPS) e.push(`${label}: start is beyond the end of the track.`);
      if (!Number.isNaN(t.start) && !Number.isNaN(t.end) && t.end - t.start < MIN_CLIP - EPS) e.push(`${label}: the clip must be at least ${MIN_CLIP} s long.`);
      if (!(t.volume >= 0 && t.volume <= 2)) e.push(`${label}: volume must be between 0% and 200%.`);
      if (t.ownIn > MAX_FADE || t.ownOut > MAX_FADE) e.push(`${label}: a fade cannot be longer than ${MAX_FADE} s.`);
      if (t.duration > 0) {
        if (t.fadeIn > t.duration + EPS) e.push(`${label}: fade in is longer than the clip.`);
        if (t.fadeOut > t.duration + EPS) e.push(`${label}: fade out is longer than the clip.`);
        // head + tail must fit inside the clip, otherwise the fades (or the two overlaps of a middle track) collide
        if (t.head + t.tail > t.duration + EPS) e.push(`${label}: its start and end fades/overlaps (${ffNum(t.head)} s + ${ffNum(t.tail)} s) are longer than the clip (${ffNum(t.duration)} s).`);
      }
      perTrack.push(e); errors.push(...e);
    });
    plan.transitions.forEach((t, i) => {
      const e = [], a = plan.tracks[i], b = plan.tracks[i + 1];
      if (t.type !== 'none') {
        const label = `Transition ${i + 1} to ${i + 2}`;
        if (!(t.duration >= 0.1 - EPS)) e.push(`${label}: duration must be at least 0.1 s.`);
        if (t.duration > MAX_TRANSITION + EPS) e.push(`${label}: duration cannot exceed ${MAX_TRANSITION} s.`);
        if (a && t.duration > a.duration - 0.01 + EPS) e.push(`${label}: longer than track ${i + 1}'s clip.`);
        if (b && t.duration > b.duration - 0.01 + EPS) e.push(`${label}: longer than track ${i + 2}'s clip.`);
      }
      perTransition.push(e); errors.push(...e);
    });
    const out = validateOutput(p && p.output, errors);
    const layout = mergeLayout(plan);
    return { ok: errors.length === 0, errors, perTrack, perTransition, plan, layout, output: out };
  }

  // largest transition length allowed between track i and i+1 given its neighbours (for sliders)
  function maxTransition(plan, i) {
    const a = plan.tracks[i], b = plan.tracks[i + 1];
    if (!a || !b) return 0;
    const prev = plan.transitions[i - 1], next = plan.transitions[i + 1];
    const aOther = prev && prev.type !== 'none' ? prev.duration : a.ownIn;      // the other edge of track i
    const bOther = next && next.type !== 'none' ? next.duration : b.ownOut;
    const m = Math.min(MAX_TRANSITION, a.duration - aOther, b.duration - bOther, a.duration - 0.01, b.duration - 0.01);
    return Math.max(0, Math.floor(m * 10 + 1e-6) / 10);          // tenths of a second; the epsilon absorbs floating-point error (8 - 7.9 is 0.0999...)
  }

  // where every clip sits on the output timeline, and the total length
  function mergeLayout(plan) {
    let cursor = 0; const clips = [];
    plan.tracks.forEach((t, i) => {
      const tr = plan.transitions[i - 1];
      const overlap = tr && tr.type === 'crossfade' ? tr.duration : 0;
      const offset = i === 0 ? 0 : cursor - overlap;
      const d = Number.isFinite(t.duration) ? t.duration : 0;
      clips.push({ index: i, offset: r6(offset), duration: d, end: r6(offset + d) });
      cursor = offset + d;
    });
    return { clips, total: r6(cursor) };
  }

  // filter graph. Per-clip fades are inside each clip chain; joins are concat (none/fade) or acrossfade (crossfade).
  function buildMergeGraph(plan, rate = 44100, { limiter = true } = {}) {
    const filters = [];
    plan.tracks.forEach((t, i) => {
      filters.push(`[${i}:a]${clipFilter({ start: t.start, end: t.end, duration: t.duration, volume: t.volume, fadeIn: t.fadeIn, fadeOut: t.fadeOut, rate, normalise: true })}[a${i}]`);
    });
    let cur = '[a0]';
    plan.transitions.forEach((tr, i) => {
      const next = `[a${i + 1}]`, out = `[mix${i + 1}]`;
      if (tr.type === 'crossfade') {
        const c = CURVES[tr.curve].c;
        filters.push(`${cur}${next}acrossfade=d=${ffNum(tr.duration)}:c1=${c}:c2=${c}${out}`);
      } else filters.push(`${cur}${next}concat=n=2:v=0:a=1${out}`);
      cur = out;
    });
    // a soft ceiling so crossfade overlaps and gain above 100% cannot clip. level=0 turns the limiter's auto-levelling off.
    const needsLimit = limiter && (plan.tracks.some((t) => t.volume > 1) || plan.transitions.some((t) => t.type === 'crossfade'));
    if (needsLimit) { filters.push(`${cur}alimiter=limit=0.97:level=0[out]`); cur = '[out]'; }
    return { filter: filters.join(';'), label: cur };
  }

  function buildMergeArgs({ inputs, output, plan, outFormat }) {
    const f = FORMATS[outFormat.format];
    const rate = f.sampleRate || 44100;
    const g = buildMergeGraph(plan, rate);
    return ['-hide_banner', '-nostdin', '-y', ...inputs.flatMap((p) => ['-i', p]), '-filter_complex', g.filter, '-map', g.label,
      ...outputArgs(outFormat), '-f', f.muxer, '-progress', 'pipe:1', '-nostats', output];
  }

  return { FORMATS, CURVES, MIN_CLIP, MAX_FADE, MAX_TRANSITION, MAX_TRACKS, validateTrim, validateMerge, normaliseMerge, maxTransition, mergeLayout, buildTrimArgs, buildMergeArgs, buildMergeGraph, clipFilter, outputArgs };
});
