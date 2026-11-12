'use strict';
// Audio Studio service (main process). The renderer can only ask for these fixed operations; each argument is validated
// here again, because the renderer is never trusted. Heavy work happens in FFmpeg child processes, so the UI stays responsive.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ff = require('./ffmpeg');
const Plan = require('../../shared/audio/plan.js');
const { AudioError } = ff;

const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_FILE = 8 * 1024 * 1024 * 1024;

function createAudioStudio({ defaultDir, emit = () => {}, uniquePath } = {}) {
  const known = new Map();             // id -> { path, size, mtimeMs }: only files the user picked/dropped can be previewed
  const jobs = new Map();              // jobId -> AbortController
  const inspected = new Map();         // path|size|mtime -> info (re-reading a file costs a process; the cache is tiny)

  const uniq = uniquePath || ((p) => {
    if (!fs.existsSync(p)) return p;
    const { dir, name, ext } = path.parse(p); let i = 1;
    while (fs.existsSync(path.join(dir, `${name} (${i})${ext}`))) i++;
    return path.join(dir, `${name} (${i})${ext}`);
  });

  function checkInput(p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) throw new AudioError('invalid', 'The file path is not valid.');
    if (!path.isAbsolute(p)) throw new AudioError('invalid', 'The file path must be absolute.');
    let st;
    try { st = fs.statSync(p); } catch { throw new AudioError('not-found', 'The file could not be found. It may have been moved or deleted.'); }
    if (!st.isFile()) throw new AudioError('invalid', 'That is not a file.');
    if (st.size === 0) throw new AudioError('bad-input', 'The file is empty.');
    if (st.size > MAX_FILE) throw new AudioError('invalid', 'The file is too large.');
    return st;
  }
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

  async function probe(file) {
    const st = checkInput(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    let info = inspected.get(key);
    if (!info) { info = await ff.inspect(file); inspected.set(key, info); if (inspected.size > 64) inspected.delete(inspected.keys().next().value); }
    let id = [...known.entries()].find(([, v]) => v.path === file)?.[0];
    if (!id) { id = crypto.randomBytes(8).toString('hex'); known.set(id, { path: file }); if (known.size > 200) known.delete(known.keys().next().value); }
    return { id, path: file, name: path.basename(file), size: st.size, ...info };
  }
  const resolvePreview = (id) => (known.get(String(id)) || {}).path || null;

  async function waveform(file, buckets) {
    const info = await probe(file);
    return { duration: info.duration, peaks: await ff.peaks(file, buckets, info.duration) };
  }

  async function capabilities() {
    let enc; try { enc = await ff.encoders(); } catch (e) { return { available: false, error: e.message, formats: [] }; }
    const formats = Object.entries(Plan.FORMATS).filter(([, f]) => enc.has(f.encoder)).map(([id, f]) => ({ id, label: f.label, lossy: f.lossy, bitrates: f.bitrates || null, defaultBitrate: f.defaultBitrate || null, bitDepths: f.bitDepths || null }));
    return { available: true, formats, defaultDir: defaultDir ? defaultDir() : '' };
  }

  // output location: a folder (created if needed) and a file name WITHOUT directory parts; never an existing file, never an input
  function resolveOutput({ dir, name, format }, inputs) {
    const f = Plan.FORMATS[format];
    const folder = dir || (defaultDir && defaultDir());
    if (!folder || typeof folder !== 'string' || !path.isAbsolute(folder)) throw new AudioError('invalid', 'Choose an output folder.');
    let base = String(name || '').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
    if (!base) base = 'audio';
    if (INVALID_NAME.test(base) || base.endsWith('.') || base.endsWith(' ')) throw new AudioError('invalid', 'The file name contains characters Windows does not allow (\\ / : * ? " < > |).');
    if (RESERVED.test(base)) throw new AudioError('invalid', `"${base}" is a reserved Windows name.`);
    if (base.length > 120) throw new AudioError('invalid', 'The file name is too long.');
    try { fs.mkdirSync(folder, { recursive: true }); } catch (e) { throw new AudioError('permission', 'The output folder could not be created.', e.message); }
    try { fs.accessSync(folder, fs.constants.W_OK); } catch { throw new AudioError('permission', 'The output folder is not writable.'); }
    const wanted = path.join(folder, `${base}.${f.ext}`);
    const final = uniq(wanted);                                                     // never overwrite anything that exists (an input included)
    if (inputs.some((i) => same(real(i), real(path.dirname(final)) + path.sep + path.basename(final)))) throw new AudioError('invalid', 'The output would overwrite one of the input files.');
    const partial = path.join(folder, `.${path.basename(final, '.' + f.ext)}.${crypto.randomBytes(4).toString('hex')}.li-partial.${f.ext}`);
    return { final, partial };
  }

  async function ensureEncoder(format) {
    const enc = await ff.encoders();
    if (!enc.has(Plan.FORMATS[format].encoder)) throw new AudioError('no-encoder', `This FFmpeg build cannot write ${Plan.FORMATS[format].label}.`);
  }

  // shared export pipeline: run -> verify the REAL result -> move into place; always clean the partial file
  async function runJob(jobId, { args, partial, final, expected, inputs }) {
    if (jobs.has(jobId)) throw new AudioError('busy', 'This export is already running.');
    if (jobs.size >= 1) throw new AudioError('busy', 'Another export is still running. Wait for it or cancel it.');
    const ac = new AbortController(); jobs.set(jobId, ac);
    const started = Date.now();
    const sig = (p) => { try { const x = fs.statSync(p); return `${x.size}:${x.mtimeMs}`; } catch { return 'missing'; } };
    const before = inputs.map(sig);
    try {
      emit({ id: jobId, phase: 'start', percent: 0 });
      let last = -1;
      await ff.render(args, { expected, signal: ac.signal, onProgress: (p) => { const r = Math.round(p); if (r !== last) { last = r; emit({ id: jobId, phase: 'run', percent: p }); } } });
      emit({ id: jobId, phase: 'verify', percent: 99 });
      let st; try { st = fs.statSync(partial); } catch { throw new AudioError('ffmpeg', 'FFmpeg finished but no file was written.'); }
      if (!st.size) throw new AudioError('ffmpeg', 'FFmpeg wrote an empty file.');
      const out = await ff.inspect(partial);                                        // read the result back: do not trust the exit code alone
      const tol = Math.max(0.35, expected * 0.02);
      if (Math.abs(out.duration - expected) > tol) throw new AudioError('verify', `The exported file is ${out.duration.toFixed(2)} s long but ${expected.toFixed(2)} s was expected.`);
      if (ac.signal.aborted) throw new AudioError('cancelled', 'Cancelled');
      fs.renameSync(partial, final);
      const res = { ok: true, output: final, size: st.size, duration: out.duration, expected, tookMs: Date.now() - started, inputsUntouched: inputs.every((p, i) => sig(p) === before[i]) };
      emit({ id: jobId, phase: 'done', percent: 100, output: final });
      return res;
    } catch (e) {
      try { fs.rmSync(partial, { force: true }); } catch { /* best effort */ }
      emit({ id: jobId, phase: e.code === 'cancelled' ? 'cancelled' : 'error', error: e.message });
      throw e;
    } finally { jobs.delete(jobId); }
  }

  async function exportTrim(jobId, req) {
    const file = req && req.input;
    const src = await probe(file);
    const v = Plan.validateTrim({ duration: src.duration, start: req.start, end: req.end, fadeIn: req.fadeIn, fadeOut: req.fadeOut, output: req.output });
    if (!v.ok) throw new AudioError('invalid', v.errors[0], v.errors.join(' '));
    await ensureEncoder(v.clip.output.format);
    const o = resolveOutput({ dir: req.dir, name: req.name, format: v.clip.output.format }, [file]);
    const args = Plan.buildTrimArgs({ input: file, output: o.partial, clip: v.clip, outFormat: v.clip.output });
    return runJob(jobId, { args, partial: o.partial, final: o.final, expected: v.clip.duration, inputs: [file] });
  }

  async function exportMerge(jobId, req) {
    const list = Array.isArray(req && req.tracks) ? req.tracks : [];
    if (list.length < 2) throw new AudioError('invalid', 'Add at least two tracks to merge.');
    if (list.length > Plan.MAX_TRACKS) throw new AudioError('invalid', `At most ${Plan.MAX_TRACKS} tracks can be merged at once.`);
    const infos = [];
    for (const t of list) infos.push(await probe(t && t.path));                      // durations come from the files, never from the renderer
    const merged = { tracks: list.map((t, i) => ({ duration: infos[i].duration, start: t.start, end: t.end, volume: t.volume, fadeIn: t.fadeIn, fadeOut: t.fadeOut })), transitions: req.transitions || [], output: req.output };
    const v = Plan.validateMerge(merged);
    if (!v.ok) throw new AudioError('invalid', v.errors[0], v.errors.join(' '));
    await ensureEncoder(v.output.format);
    const inputs = list.map((t) => t.path);
    const o = resolveOutput({ dir: req.dir, name: req.name, format: v.output.format }, inputs);
    const args = Plan.buildMergeArgs({ inputs, output: o.partial, plan: v.plan, outFormat: v.output });
    return runJob(jobId, { args, partial: o.partial, final: o.final, expected: v.layout.total, inputs });
  }

  function cancel(jobId) { const ac = jobs.get(jobId); if (!ac) return false; ac.abort(); return true; }
  function shutdown() { for (const ac of jobs.values()) ac.abort(); jobs.clear(); }

  return { probe, waveform, capabilities, exportTrim, exportMerge, cancel, shutdown, resolvePreview, busy: () => jobs.size > 0 };
}

module.exports = { createAudioStudio };
