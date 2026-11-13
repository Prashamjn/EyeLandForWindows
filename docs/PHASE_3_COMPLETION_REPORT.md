# Phase 3 completion report: Priorities 2, 3 and 4, media, charger sound, settings

Branch: `feature/phase-3-dynamic-feedback-audio-studio-p234` (continuation of `feature/phase-3-dynamic-feedback-audio-studio` @ `aa78a73`). Nothing was pushed.

## Status labels (used throughout)
* **Implemented**: code exists.
* **Compiled**: built by a compiler/parser (PowerShell parse, `mcs -warn:4` with warnings as failures).
* **Tested (Linux)**: automated test passes in the Linux sandbox; the text says what it covers.
* **Windows verified**: run by you on Windows, or by CI on a real Windows runner. **Nothing in Phase 3 is Windows verified.** No new Windows results were provided (section 2.4 was empty), so every Priority 1 item that was unverified is still unverified.
* **Not yet verified**: needs Windows or hardware.

## 1. Phase 2 / branch source verification
Cloned the repository and confirmed: the feature branch exists; `af52db1` ("Fix from first Windows run ...") is in its history (and in `origin/main`); the branch tip is `aa78a73`; `origin/main` has one extra commit (`b41903c`) that changes no files relative to `aa78a73`, and a trial merge of this work into it is conflict-free. Baseline before my changes: 39 unit tests (33 pass, 6 skipped without PowerShell/Mono). **I listed the two Priority 1 documents but did not re-read them line by line**, and I did not rebuild or touch Priority 1.

## 2. Control Centre (Priority 1)
Not changed except that its long operations (Wi-Fi connect/scan/power, Bluetooth connect/pair/power, sound output switch) now hold the island open (`LI.hold.run`, 90 s maximum). Scenario 07 (69 checks, simulated helpers) still passes. Windows status unchanged: audio switch and power helper measured earlier by you; Wi-Fi, Bluetooth, VPN adapter logic, WLAN radio notification, WinRT event fix and the CI workflow remain **Not yet verified**. The unexplained Phase 2 sound-output failure is still unexplained.

## 3. Hover system (Priority 2)
**The bug and the fix.** `syncPin` fused two ideas, so any plugin page pinned the island open. They are now separate in `renderer/island.js`: `workFocus` (window focusable for the keyboard; says nothing about collapsing) and `locked` (the user's deliberate Pin).

| Piece | Where | Notes |
|---|---|---|
| Decision logic | `shared/island-logic.js` | Pure: `hitTest`, `decideCollapse`, `createHolds`, `pollInterval`, `clampDelay`. |
| State machine / timers | `renderer/island.js` | Grace period (default 350 ms, 100 to 2000), open delay, retry every 300 ms while something temporary blocks collapse. |
| Hit-testing | `island.js` `onCursor` | Real `getBoundingClientRect()` + pad + top gap, and the **union with the target size** (`--w`/`--h`) while the island is morphing, so a cursor inside the final panel never reads as "left". Transparent margins are outside. |
| Holds | `renderer/hold.js` | `LI.hold.begin/end/run(key)`, every hold has a maximum age. Users: native dialogs (`main.js` wraps `showOpenDialog`, `showSaveDialog`, `showMessageBox`, 10 min max), drags (20 s max), Audio Studio exports (1 h max), Control Centre calls (90 s). |
| Typing | `island.js` | A focused text field blocks collapse for 10 s after the last *deliberate* use (click into it or key press); 1.2 s after any key. A plugin that merely autofocuses a field does **not** hold the island (my first version did; scenario 10 caught it). |
| Pin | workspace header + Home nav | In memory only; released by the Collapse button, Esc on Home, or the lock again; exempt from collapse-on-blur. |
| Hover off | Settings | Click the capsule to open. |
| Adaptive polling | `main.js` | 33 ms only near the window, 100 ms in the wider area, 250 ms far; one final `far` message on leaving; nothing sent while the cursor is still. |

**Tested (Linux):** 11 unit tests of the logic (`tools/tests/island-logic.test.js`, which also holds 3 charger-policy tests); scenario 10 (60 checks, real Electron, cursor driven through the real IPC channel): collapse from 13 screens, internal sweeps, 40 px margin, a 120 ms excursion, growth-aware hit-test, delay setting, auto-collapse off, hover off + click, holds (active, expiry by max age, dialog event, promise), typing, autofocus not holding, pin (plugin and Home, Home pin button, blur exemption, Esc, Collapse button, not persisted), idle message count.
**Not yet verified:** real Windows cursor/DPI/multi-display behaviour (a simulated multi-display change is in scenario 08 only), real native dialogs, and **native Windows permission prompts, which cannot be detected**; the island may collapse on window-blur after "Collapse after (s)" (default 8 s). Use `tools\windows\run-hover-log.ps1`.

## 4. Motion system (Priority 3)
`renderer/tokens.css` (durations/easings), `renderer/motion.js` (`LI.motion`, Web Animations API, no new dependency), `renderer/island.css`. Durations: UI 150, navigation 210, expand 300, collapse 240, notification 260 ms, all divided by animation speed. Expand and collapse have separate durations and easings (`data-dir`). Navigation (dashboard, Control Centre, plugin to plugin, Audio Trimmer/Merger opening) uses `LI.motion.enter`; indeterminate progress and pulse classes exist (`.li-indet`, `.li-pulse`); media bars use CSS only while playing.

**Why you saw no hover animation (hypothesis, not confirmed on your PC):** a `@media (prefers-reduced-motion)` rule removed all animation, and Windows "Animation effects: off" makes Chromium report that preference. I removed the media rule; one JS switch (`LI.motion`) now decides, from the OS preference and Settings. Settings > Motion shows the effective state with the reason, and "Always animate" overrides the OS (default: respect it).
**Tested (Linux):** computed `transition-duration` per direction and at 2x speed; animation timing/keyframes via `getAnimations`-level checks on `LI.motion.enter`; reduced motion by setting and by *emulated* OS preference via DevTools protocol; override; the Settings status text.
**Not verified:** subjective smoothness (I only inspected static screenshots; no human watched it move), real GPU behaviour, the Windows switch itself.

## 5. Audio Studio (Priority 4)
### Architecture
* `shared/audio/timecode.js`, `shared/audio/plan.js`: pure validation, layout and FFmpeg filter-graph construction, **shared by the renderer and the main process**, so the UI limits, the timeline and the export are the same code.
* `src/audio/ffmpeg.js`: argument-array process runner (`spawn`, never a shell), inspection, waveform peaks (streamed PCM, constant memory), encoder detection, progress parsing, error classification, cancel via `AbortSignal`.
* `src/audio/index.js`: the service. Re-validates everything the renderer sends, derives durations from the files themselves, refuses non-absolute / NUL / non-file / empty / oversized inputs, validates file names (Windows reserved names and characters), never overwrites (unique names, never an input), writes to a hidden partial file, **re-reads the result** and checks its duration before renaming it into place, removes partial files on any failure, one export at a time.
* `src/audio/preview.js` + `liaudio://` protocol: only files the user picked (id table) can be played; HTTP Range implemented by hand because `net.fetch` on `file://` ignores it (found by testing: seeking would not have worked).
* UI: `renderer/plugins/audio-common.js`, `audio-trim.js`, `audio-merge.js`, `renderer/audio.css`. Catalog group **Audio Studio**.

### Python or Node decision
**Node.** `AudioMixer.py` is a filter-graph builder around `ffmpeg`; nothing in it needs Python, so Python is neither required nor bundled. The mixer was ported to `plan.js`; the CLI, prompts, folders and console output were dropped. Bundling a Python runtime would have added tens of MB and a second process model for no benefit.

### Reference-script bug found and fixed (not copied)
`AudioMixer.py` applies a "fade" transition to the *running mix* but computes the fade-out start from the previous *single song's* duration, so from the second transition on the fade lands in the wrong place. The port applies fades per clip before joining. Regression test: `merge fade chain` (dips measured at exactly 10 s and 20 s). Also: `AudioCutter.py` uses `-c copy` (keyframe-bound, no fades); the Trimmer re-encodes with `atrim`, which is exact but decodes from the start of the file (a late start in a very long file costs decode time).

### Behaviour decisions to know about
* A Fade or Crossfade transition **owns** the edge it touches; the per-track fade on that edge is disabled and ignored (stacking two fades would attenuate twice). The UI says so.
* A middle track's two overlaps (or fades) must fit inside it; limits come from `maxTransition`, so an invalid transition cannot be entered. Invalid ones are also rejected by the backend.
* Crossfade curves: Linear and Smooth (equal power). A limiter (`alimiter=limit=0.97:level=0`) is added only when a crossfade or gain above 100 % exists.
* Closing the page while an export runs cancels it. One export at a time.
* The FFmpeg binary's encoders are detected at run time; the UI offers only formats that FFmpeg can really write.
* Status messages (done / cancelled / error) persist until the user changes something. (A real bug found by the UI scenario: errors disappeared immediately.)

### FFmpeg and licensing
Reuses the existing `ffmpeg-static` (already a dependency; unpacked from asar by the existing `asarUnpack`). Nothing is downloaded at run time; the binary is fetched by npm at install time. **Licence: the bundled build is GPL-3.0** (its `ffmpeg.LICENSE` is GPLv3; the Linux build reports `--enable-gpl --enable-version3`). That is fine for personal use; **redistributing the app means shipping that licence and offering the corresponding source**, so decide before distributing. There is **no ffprobe**: inspection uses `ffmpeg -i`, `-f ffmetadata` and PCM decoding (no new binary; `ffprobe-static` would add another GPL binary). The Windows `ffmpeg-static` binary is a different build from the Linux one tested here (6.1.1 vs 7.0.2): its encoder list is **Not yet verified** (the Windows CI and `npm run diag:audio` will show it).

### Tested (Linux, real FFmpeg, measuring decoded samples)
Unit: time parsing, validation (ranges, fades, overlaps, formats), layout, graph, argv safety, Range parser. Integration (23 tests): duration/codec/tags, rejection of bad paths, waveform, trim accuracy at 3.25 to 9.75 s, fade in/out measured per 50 ms window, all six formats probed back, bitrate honoured, 24-bit WAV, never-overwrite and name rules, cancel (process killed, no files left, next job starts), one-at-a-time, monotonic progress, merge none/fade/crossfade (lengths, no gap, dips, linear and smooth), per-track volume/trim/fades, limiter (peak <= 0.97 FS), mixed sample rates and mono/stereo, inputs byte-identical, missing FFmpeg. UI scenario 11 (55 checks): both plugins through real mouse events, the real protocol (206/404, `<audio>` duration and seek), export, cancel, leave-page cancel, reorder by arrows and drag, remove, live timeline total, and measured output of a UI-driven merge.
**Not verified:** audible playback (no sound device in the sandbox; decode and seek are tested), Windows paths with non-ASCII names, very large files, the Merger's own Cancel button (the Trimmer's is tested; the backend is shared), Windows FFmpeg behaviour.

## 6. Media, lyrics, charger sound
* **Media** (`native/media.ps1`, `renderer/media.js`): artwork (96 px JPEG, fetched once per track with up to 4 retries; validated before it reaches the page), app name, status, previous/next/play disabled when the player says unsupported, timeline (`dur`, `pos`, `updated`). **Compiled (PowerShell 7 parse only)**; the WinRT/System.Drawing calls were never run, **Not yet verified on Windows.**
* **Visualizer**: three CSS bars in the capsule; animates only while the session reports "playing", settles when paused, hidden when no session; paused (not running) while the island is expanded. Tested (Linux): computed `animation-name/play-state` in each state.
* **Lyrics: implemented, off by default.** Source: LRCLIB (`lrclib.net`, community database, open API, no key; sends artist and track title). It is the only source I would call reliable *enough* because it carries real per-line timestamps. Rules enforced and unit-tested (9 tests): plain lyrics are never used; the match must be within 3 s of the track length (and requires the player to report a duration); an instrumental or fewer than 3 timed lines is rejected; one line at a time, never paragraphs; the last line does not linger; nothing is shown without a real playback position; a different track's lyrics are never shown; failures say "No synced lyrics". **Findings and caveats:** I confirmed the API shape from public client documentation and source, but I could **not call lrclib.net from the sandbox**, so live behaviour and coverage are untested; YouTube Music's reported position accuracy in a browser is unknown; many tracks will have no synced lyrics. Treat it as experimental.
* **Charger sound**: detection reuses the notification logic (needs two known readings, an AC flip, a battery present; never on the first reading, never while merely connected; 4 s duplicate guard); policy honours the sound toggle, disconnect (off by default), battery-notification preference, system mute and volume (default 40 %); sound is synthesised in `renderer/chime.js` (original, no files) and failures are swallowed. Tested (Linux) through the real main-process path with the mock power helper (scenario 12). **Not verified:** real Windows power events, real speakers.

## 7. Settings
New sections (existing ones kept; `settingsVersion` stays 2; defaults merge under saved values): Hover behaviour, Motion (with live status and pin help), Media, Charging, Audio Studio (format, quality, folder with Choose/Reset, remember last). Tested: all controls present, live write to `settings.json`, legacy files (Phase 1 file, fresh install, user-chosen offset) via seeded scenarios 05 and 09, which now also assert the Phase 3 defaults.

## 8. Test results
| Suite | Result |
|---|---|
| `node --test tools/tests/*.test.js` | **114 tests, 114 pass, 0 skipped** (with PowerShell 7.4.6 and Mono `mcs` installed; the 6 tests that need them include the real-PowerShell error transport, WinRT bridge and the C# compile with warnings as failures). Without them: 6 skipped. |
| UI scenarios 00 to 12, full run | 319 checks pass; the 6 failures are scenarios 05 and 09 run **without** their required `LI_SETTINGS` seed, and they fail identically on the untouched baseline `aa78a73`. |
| `tools/ui-harness/run-migration.sh` (05 and 09 with seeds, 3 variants) | all pass. |
| `node tools/windows/audio-studio-check.js` (on Linux) | 21/21. |
| Idle CPU (scenario 12, collapsed, nothing playing, 3 s) | 2.67 % summed over all Electron processes under Xvfb software rendering. **No baseline comparison was made**, so this is a measurement, not a regression proof. |

**Scenario changes made deliberately:** 04 (catalog 21 to 23 entries, five to six categories, 20 to 22 reachable, 21 to 23 pages; `pinned` to `workFocus`); 07 (`pinned` to `workFocus`); **08** (the assertion "moving the cursor away does NOT close an open plugin" is replaced by "it closes after the grace period", plus checks for the grace period and for focus without lock; note the old assertion only passed because the simulated cursor never entered the island); 09 (extra Phase 3 defaults assertion). No test was weakened otherwise.
**Test bugs I made and fixed along the way** (listed so you can judge the suite): wrong expected loudness from the `sine` generator, selectors that matched by element type, comparing keyframe strings with numbers, a readout that included neighbouring text, a harness that never put the cursor on the island.
**Real defects found by the tests and fixed:** preview Range requests ignored (seeking broken); error/cancel messages vanishing; a disabled fade clamped to 0 so enabling it later failed; `maxTransition` losing 0.1 s to floating point; autofocus holding the island open; the first version of the busy-state check in scenario 11 asserting nothing (`busy || true`), which I removed rather than keep a test that cannot fail.

## 9. Files
Added: `shared/island-logic.js`, `shared/audio/{timecode,plan}.js`, `src/audio/{ffmpeg,index,preview}.js`, `src/lyrics.js`, `renderer/{hold,motion,media,chime}.js`, `renderer/plugins/audio-{common,trim,merge}.js`, `renderer/audio.css`, `tools/tests/{audio-plan,audio-ffmpeg,island-logic,lyrics,phase3-wiring}.test.js`, `tools/ui-harness/scenarios/1{0,1,2}-*.js`, `tools/ui-harness/run-{all,migration}.sh`, `tools/windows/{audio-studio-check.js,run-hover-log.ps1}`, two docs.
Modified: `main.js`, `preload.js`, `native/media.ps1`, `renderer/{island,workspace,panels,dashboard,app,activity,core,cc}.js`, `renderer/{tokens,island,workspace,dashboard}.css`, `renderer/index.html`, `shared/{catalog,icons}.js`, `src/system/{index,notify}.js`, `package.json`, `.github/workflows/windows-native.yml` (adds `npm ci`; runs the audio tests and `audio-studio-check` on a Windows runner; **never run**), `README.md`, scenarios 04/07/08/09.
No C# files were added or changed; every existing one still compiles with warnings treated as errors (mcs, C# 5).

## 10. Known limitations
Everything under "Not yet verified" above; native permission prompts are undetectable; the Trimmer decodes from the file start; one export at a time; lyrics experimental; GPL FFmpeg redistribution; the trace (`LI_HOVER_LOG`) is for diagnostics only; Phase 4/5 items and the DSP engine were not started.

## 11. How to run
`npm install`, `npm start`. Tests: `npm run test:unit`; `tools/ui-harness/run-all.sh` (needs Xvfb and the Electron libraries, see `tools/ui-harness/README.md`); `tools/ui-harness/run-migration.sh`. Windows: `docs/PHASE_3_WINDOWS_TEST_GUIDE.md`.
